import { promises as fs } from 'fs';
import path from 'path';
import { Knex } from 'knex';
import { getLogger } from '@server/utils';
import { kailoUserKey, profilePicture } from '@/utils/kailoUser';

// DD-133(4), `.design/07` §4.7.4 (Wren table): this instance reads the Core
// member directory of its native page entry binding with its own directory
// client (client credentials, `azp` = the binding's directoryClientId) and
// keeps the last completely applied snapshot:
//   - a person (issuer+subject digest) absent from the snapshot is refused at
//     the Node entry (pages, GraphQL, REST) from the next read on;
//   - tenantRole ADMIN -> Wren admin, MEMBER -> member (STANDALONE; a GOVERNED
//     instance keeps the Core binding `manage`/`discover` per request);
//   - workspaces[] create nothing and raise no role;
//   - kailo_user rows are refreshed with the Kailo display name and picture
//     and never removed (history attribution).
// Until a snapshot has been applied once the instance keeps the
// pre-directory behaviour: every signed-in Kailo user is a member, nobody is
// an admin. A failed read (503, 401/403, transport, malformed or foreign
// snapshot) changes nothing and is retried next interval; it is never taken
// as an empty directory.

const logger = getLogger('KailoMemberDirectory');
logger.level = 'info';

const ENV = {
  bindingId: 'KAILO_DIRECTORY_BINDING_ID',
  clientId: 'KAILO_DIRECTORY_CLIENT_ID',
  clientSecretFile: 'KAILO_DIRECTORY_CLIENT_SECRET_FILE',
  tokenUrl: 'KAILO_DIRECTORY_TOKEN_URL',
  coreUrl: 'KAILO_DIRECTORY_CORE_URL',
  intervalSeconds: 'KAILO_DIRECTORY_INTERVAL_SECONDS',
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SECRET_MAX_BYTES = 4 * 1024;
const TOKEN_MAX_BYTES = 64 * 1024;
const DIRECTORY_MAX_BYTES = 16 * 1024 * 1024;
const TOKEN_TIMEOUT_MS = 10_000;
const DIRECTORY_TIMEOUT_MS = 30_000;

export interface KailoDirectoryConfig {
  bindingId: string;
  clientId: string;
  clientSecretFile: string;
  tokenUrl: string;
  coreUrl: string;
  intervalSeconds: number;
  // The OIDC issuer this instance verifies (WREN_NATIVE_IDENTITY_JSON).
  issuer: string;
}

export class KailoDirectoryConfigError extends Error {}

function serviceUrl(value: string, name: string, root: boolean): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new KailoDirectoryConfigError(`${name} must be a URL`);
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (root && url.pathname !== '/')
  )
    throw new KailoDirectoryConfigError(`${name} is not a valid service URL`);
  return root ? url.origin : url.href;
}

// All five deployment keys together (the interval may be omitted) or none:
// none keeps the directory off; a partial set is a deployment error.
export function kailoDirectoryConfig(
  env: Record<string, string | undefined> = process.env,
): KailoDirectoryConfig | null {
  const value = (name: string) => {
    const raw = env[name];
    return raw === undefined || raw.trim() === '' ? undefined : raw;
  };
  const required = [
    ENV.bindingId,
    ENV.clientId,
    ENV.clientSecretFile,
    ENV.tokenUrl,
    ENV.coreUrl,
  ];
  const given = required.filter((name) => value(name) !== undefined);
  if (!given.length && value(ENV.intervalSeconds) === undefined) return null;
  if (given.length !== required.length)
    throw new KailoDirectoryConfigError(
      'member directory configuration is incomplete',
    );
  for (const name of required)
    if (value(name) !== value(name).trim())
      throw new KailoDirectoryConfigError(`${name} has surrounding spaces`);
  const bindingId = value(ENV.bindingId).toLowerCase();
  if (!UUID.test(bindingId))
    throw new KailoDirectoryConfigError(`${ENV.bindingId} must be a UUID`);
  const clientId = value(ENV.clientId);
  if (!/^[A-Za-z0-9_-]{1,255}$/.test(clientId))
    throw new KailoDirectoryConfigError(`${ENV.clientId} is invalid`);
  const clientSecretFile = value(ENV.clientSecretFile);
  if (!path.isAbsolute(clientSecretFile))
    throw new KailoDirectoryConfigError(
      `${ENV.clientSecretFile} must be an absolute path`,
    );
  const rawInterval = value(ENV.intervalSeconds) ?? '60';
  const intervalSeconds = Number(rawInterval);
  if (
    !/^\d+$/.test(rawInterval) ||
    intervalSeconds < 10 ||
    intervalSeconds > 3600
  )
    throw new KailoDirectoryConfigError(
      `${ENV.intervalSeconds} must be 10..3600`,
    );
  let issuer: string;
  try {
    issuer = JSON.parse(env.WREN_NATIVE_IDENTITY_JSON || '').issuer;
  } catch {
    issuer = undefined;
  }
  if (typeof issuer !== 'string' || !issuer)
    throw new KailoDirectoryConfigError(
      'the member directory needs the native identity issuer',
    );
  return {
    bindingId,
    clientId,
    clientSecretFile,
    tokenUrl: serviceUrl(value(ENV.tokenUrl), ENV.tokenUrl, false),
    coreUrl: serviceUrl(value(ENV.coreUrl), ENV.coreUrl, true),
    intervalSeconds,
    issuer,
  };
}

// ---- snapshot ------------------------------------------------------------

export type KailoDirectoryRole = 'ADMIN' | 'MEMBER';

export interface KailoDirectorySnapshot {
  bindingId: string;
  directoryVersion: string;
  tenant: { tenantId: string; name: string };
  workspaces: { workspaceId: string; name: string }[];
  members: {
    principalId: string;
    displayName: string;
    tenantRole: KailoDirectoryRole;
    identities: { issuer: string; subject: string; picture: string }[];
    workspaces: { workspaceId: string; role: KailoDirectoryRole }[];
  }[];
}

export class KailoDirectorySnapshotError extends Error {}

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function exactObject(value: unknown, keys: string[], what: string) {
  if (
    !isObject(value) ||
    Object.keys(value).length !== keys.length ||
    !keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  )
    throw new KailoDirectorySnapshotError(
      `${what} does not match the contract`,
    );
  return value;
}

function string(value: unknown, what: string): string {
  if (typeof value !== 'string')
    throw new KailoDirectorySnapshotError(`${what} must be a string`);
  return value;
}

function uuid(value: unknown, what: string): string {
  const text = string(value, what);
  if (!UUID.test(text.toLowerCase()))
    throw new KailoDirectorySnapshotError(`${what} must be a UUID`);
  return text.toLowerCase();
}

function role(value: unknown, what: string): KailoDirectoryRole {
  if (value !== 'ADMIN' && value !== 'MEMBER')
    throw new KailoDirectorySnapshotError(`${what} must be ADMIN or MEMBER`);
  return value;
}

function array(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value))
    throw new KailoDirectorySnapshotError(`${what} must be an array`);
  return value;
}

// contracts/api/component_member_directory.schema.json (closed objects).
export function parseKailoDirectory(
  body: unknown,
  bindingId: string,
): KailoDirectorySnapshot {
  const root = exactObject(
    body,
    ['bindingId', 'directoryVersion', 'tenant', 'workspaces', 'members'],
    'directory',
  );
  const snapshot: KailoDirectorySnapshot = {
    bindingId: uuid(root.bindingId, 'bindingId'),
    directoryVersion: string(root.directoryVersion, 'directoryVersion'),
    tenant: (() => {
      const tenant = exactObject(root.tenant, ['tenantId', 'name'], 'tenant');
      return {
        tenantId: uuid(tenant.tenantId, 'tenant.tenantId'),
        name: string(tenant.name, 'tenant.name'),
      };
    })(),
    workspaces: array(root.workspaces, 'workspaces').map((entry) => {
      const workspace = exactObject(
        entry,
        ['workspaceId', 'name'],
        'workspace',
      );
      return {
        workspaceId: uuid(workspace.workspaceId, 'workspaceId'),
        name: string(workspace.name, 'workspace.name'),
      };
    }),
    members: array(root.members, 'members').map((entry) => {
      const member = exactObject(
        entry,
        [
          'principalId',
          'displayName',
          'tenantRole',
          'identities',
          'workspaces',
        ],
        'member',
      );
      return {
        principalId: uuid(member.principalId, 'principalId'),
        displayName: string(member.displayName, 'displayName'),
        tenantRole: role(member.tenantRole, 'tenantRole'),
        identities: array(member.identities, 'identities').map((item) => {
          const identity = exactObject(
            item,
            ['issuer', 'subject', 'picture'],
            'identity',
          );
          return {
            issuer: string(identity.issuer, 'issuer'),
            subject: string(identity.subject, 'subject'),
            picture: string(identity.picture, 'picture'),
          };
        }),
        workspaces: array(member.workspaces, 'member.workspaces').map(
          (item) => {
            const membership = exactObject(
              item,
              ['workspaceId', 'role'],
              'membership',
            );
            return {
              workspaceId: uuid(membership.workspaceId, 'workspaceId'),
              role: role(membership.role, 'role'),
            };
          },
        ),
      };
    }),
  };
  if (!/^[a-f0-9]{64}$/.test(snapshot.directoryVersion))
    throw new KailoDirectorySnapshotError('directoryVersion is not a digest');
  if (snapshot.bindingId !== bindingId)
    throw new KailoDirectorySnapshotError(
      'the snapshot belongs to another binding',
    );
  return snapshot;
}

// ---- transport -------------------------------------------------------------

export class KailoDirectoryUnavailable extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;

async function boundedBody(response: Response, limit: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit)
    throw new KailoDirectoryUnavailable('response too large');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      throw new KailoDirectoryUnavailable('response too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString(
    'utf8',
  );
}

async function clientSecret(file: string): Promise<string> {
  const handle = await fs.open(file, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > SECRET_MAX_BYTES)
      throw new KailoDirectoryUnavailable('client secret file is invalid');
    const secret = (await handle.readFile('utf8')).replace(/\r?\n$/, '');
    if (!secret || /[\u0000-\u001f\u007f]/.test(secret))
      throw new KailoDirectoryUnavailable('client secret file is invalid');
    return secret;
  } finally {
    await handle.close();
  }
}

export interface KailoServiceToken {
  accessToken: string;
  // Seconds from the token response, when it states a valid one.
  expiresIn: number | null;
}

// The directory client's client-credentials token. DD-138(4), `07` §4.8.3:
// the notification delivery client (kailoNotifications) reuses it unchanged,
// since Core authenticates both with the same `azp` = directoryClientId.
export async function kailoServiceToken(
  config: Pick<
    KailoDirectoryConfig,
    'clientId' | 'clientSecretFile' | 'tokenUrl'
  >,
  doFetch: Fetch = fetch,
): Promise<KailoServiceToken> {
  const secret = await clientSecret(config.clientSecretFile);
  const basic = Buffer.from(
    `${encodeURIComponent(config.clientId)}:${encodeURIComponent(secret)}`,
  ).toString('base64');
  const response = await doFetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      authorization: `Basic ${basic}`,
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: 'grant_type=client_credentials',
    redirect: 'manual',
    cache: 'no-store',
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
  });
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => undefined);
    throw new KailoDirectoryUnavailable(
      'token request refused',
      response.status,
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(await boundedBody(response, TOKEN_MAX_BYTES));
  } catch (error) {
    if (error instanceof KailoDirectoryUnavailable) throw error;
    throw new KailoDirectoryUnavailable('token response is not JSON');
  }
  if (
    !isObject(body) ||
    typeof body.access_token !== 'string' ||
    !body.access_token ||
    typeof body.token_type !== 'string' ||
    body.token_type.toLowerCase() !== 'bearer'
  )
    throw new KailoDirectoryUnavailable('token response is not a bearer token');
  const expiresIn =
    typeof body.expires_in === 'number' &&
    Number.isFinite(body.expires_in) &&
    body.expires_in > 0
      ? body.expires_in
      : null;
  return { accessToken: body.access_token, expiresIn };
}

async function serviceToken(
  config: KailoDirectoryConfig,
  doFetch: Fetch,
): Promise<string> {
  return (await kailoServiceToken(config, doFetch)).accessToken;
}

export async function readKailoDirectory(
  config: KailoDirectoryConfig,
  doFetch: Fetch = fetch,
): Promise<KailoDirectorySnapshot> {
  const token = await serviceToken(config, doFetch);
  const url = new URL(
    `/service/v1/component-directory/bindings/${config.bindingId}/members`,
    config.coreUrl,
  );
  const response = await doFetch(url, {
    method: 'GET',
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    redirect: 'manual',
    cache: 'no-store',
    signal: AbortSignal.timeout(DIRECTORY_TIMEOUT_MS),
  });
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => undefined);
    throw new KailoDirectoryUnavailable(
      'directory read refused or unavailable',
      response.status,
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(await boundedBody(response, DIRECTORY_MAX_BYTES));
  } catch (error) {
    if (error instanceof KailoDirectoryUnavailable) throw error;
    throw new KailoDirectorySnapshotError('directory response is not JSON');
  }
  return parseKailoDirectory(body, config.bindingId);
}

// ---- convergence receipt (DD-164(4)⑥, `07` §4.7.4) -------------------------

export interface KailoDirectoryReceipt {
  schema: 1 | 2;
  directoryVersion: string;
  appliedAt: string;
  outcome: 'APPLIED' | 'FAILED';
  failures: {
    kind: 'TENANT' | 'MEMBER' | 'WORKSPACE' | 'SHARE';
    ref: string;
    reasonCode: string;
  }[];
}

// Reports the last snapshot this instance applied (or failed to apply) with
// the same directory client. The receipt grants nothing and never changes the
// directory; a refused or unavailable receipt is retried with the next read.
export async function sendKailoDirectoryReceipt(
  config: KailoDirectoryConfig,
  receipt: KailoDirectoryReceipt,
  doFetch: Fetch = fetch,
): Promise<void> {
  const token = await serviceToken(config, doFetch);
  const url = new URL(
    `/service/v1/component-directory/bindings/${config.bindingId}/receipt`,
    config.coreUrl,
  );
  const response = await doFetch(url, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(receipt),
    redirect: 'manual',
    cache: 'no-store',
    signal: AbortSignal.timeout(DIRECTORY_TIMEOUT_MS),
  });
  await response.body?.cancel().catch(() => undefined);
  if (response.status !== 204 && response.status !== 200)
    throw new KailoDirectoryUnavailable('receipt refused', response.status);
}

// ---- persisted state -------------------------------------------------------

export interface KailoDirectoryAccess {
  // A snapshot has been applied completely at least once.
  delivered: boolean;
  member: boolean;
  admin: boolean;
}

interface Entry {
  admin: boolean;
  name: string | null;
  picture: string | null;
}

// DD-138(4): one current member as offered to the share picker and the
// admin notifications (kailoNotifications / kailoShare).
export interface KailoDirectoryMemberView extends Entry {
  userKey: string;
}

const NAME_LIMIT = 200;

function displayName(value: string): string | null {
  const trimmed = value.trim();
  return trimmed &&
    trimmed.length <= NAME_LIMIT &&
    !/[\u0000-\u001f\u007f]/.test(trimmed)
    ? trimmed
    : null;
}

export class KailoMemberDirectoryStore {
  private version: string | null = null;
  private members = new Map<string, Entry>();
  private loading: Promise<void> | null = null;

  constructor(private readonly knex: Knex) {
    void this.ready().catch(() => undefined);
  }

  // The persisted snapshot is loaded before any decision; a failed load is
  // retried on the next use and every decision meanwhile fails closed.
  public ready(): Promise<void> {
    if (!this.loading)
      this.loading = this.load().catch((error) => {
        this.loading = null;
        throw error;
      });
    return this.loading;
  }

  private async load(): Promise<void> {
    const state = await this.knex('kailo_directory_state')
      .where({ id: 1 })
      .first();
    if (!state) return;
    const rows = await this.knex('kailo_directory_member')
      .leftJoin(
        'kailo_user',
        'kailo_user.user_key',
        'kailo_directory_member.user_key',
      )
      .select(
        'kailo_directory_member.user_key as user_key',
        'kailo_directory_member.admin as admin',
        'kailo_user.name as name',
        'kailo_user.picture as picture',
      );
    this.members = new Map(
      rows.map((row) => [
        row.user_key,
        {
          admin: Boolean(row.admin),
          name: row.name ?? null,
          picture: row.picture ?? null,
        },
      ]),
    );
    this.version = state.directory_version;
  }

  public get appliedVersion(): string | null {
    return this.version;
  }

  public async access(
    userKey: string | null | undefined,
  ): Promise<KailoDirectoryAccess> {
    await this.ready();
    if (this.version === null)
      return { delivered: false, member: true, admin: false };
    const entry = userKey ? this.members.get(userKey) : undefined;
    return { delivered: true, member: !!entry, admin: entry?.admin === true };
  }

  // Display data of a member once delivered (Kailo display name, picture).
  public async profile(
    userKey: string,
  ): Promise<{ name: string | null; picture: string | null } | null> {
    await this.ready();
    const entry = this.version === null ? undefined : this.members.get(userKey);
    return entry ? { name: entry.name, picture: entry.picture } : null;
  }

  // DD-138(4): the current members of the applied snapshot; null until a
  // snapshot has been delivered (nobody can be picked or notified as a member).
  public async list(): Promise<KailoDirectoryMemberView[] | null> {
    await this.ready();
    if (this.version === null) return null;
    return [...this.members].map(([userKey, entry]) => ({
      userKey,
      ...entry,
    }));
  }

  // Replace the persisted snapshot in one transaction; returns false when the
  // version is already applied. The in-memory view changes only after commit.
  public async apply(
    snapshot: KailoDirectorySnapshot,
    issuer: string,
  ): Promise<boolean> {
    await this.ready();
    if (snapshot.directoryVersion === this.version) return false;
    const members = new Map<
      string,
      Entry & {
        principalId: string;
        issuer: string | null;
        subject: string | null;
      }
    >();
    for (const member of snapshot.members) {
      for (const identity of member.identities) {
        if (identity.issuer !== issuer) continue;
        const key = await kailoUserKey(identity.issuer, identity.subject);
        const previous = members.get(key);
        members.set(key, {
          principalId: member.principalId,
          // One identity belongs to one person; a repeat keeps the strongest
          // role rather than depending on list order.
          admin: member.tenantRole === 'ADMIN' || previous?.admin === true,
          name: displayName(member.displayName),
          picture: profilePicture(identity.picture),
          // DD-138(4), `07` §4.8.3: the pair Core addresses notifications to
          // (kailo_user.issuer/subject column limits; beyond them: not stored).
          ...(identity.subject.length <= 255 && identity.issuer.length <= 2048
            ? { issuer: identity.issuer, subject: identity.subject }
            : { issuer: null, subject: null }),
        });
      }
    }
    await this.knex.transaction(async (trx) => {
      await trx('kailo_directory_member').del();
      const rows = [...members].map(([key, entry]) => ({
        user_key: key,
        principal_id: entry.principalId,
        admin: entry.admin,
      }));
      for (let i = 0; i < rows.length; i += 200)
        await trx('kailo_directory_member').insert(rows.slice(i, i + 200));
      for (const [key, entry] of members) {
        const profile = {
          name: entry.name,
          picture: entry.picture,
          issuer: entry.issuer,
          subject: entry.subject,
        };
        await trx('kailo_user')
          .insert({ user_key: key, ...profile })
          .onConflict('user_key')
          .merge({ ...profile, updated_at: trx.fn.now() });
      }
      await trx('kailo_directory_state')
        .insert({
          id: 1,
          binding_id: snapshot.bindingId,
          directory_version: snapshot.directoryVersion,
          applied_at: new Date(),
        })
        .onConflict('id')
        .merge();
    });
    this.members = new Map(
      [...members].map(([key, { admin, name, picture }]) => [
        key,
        { admin, name, picture },
      ]),
    );
    this.version = snapshot.directoryVersion;
    return true;
  }
}

// ---- periodic sync -----------------------------------------------------------

export type KailoDirectoryOutcome =
  | 'APPLIED'
  | 'UNCHANGED'
  | 'UNAVAILABLE'
  | 'REJECTED'
  | 'FAILED'
  | 'BUSY';

export class KailoMemberDirectorySync {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  // Last version reported APPLIED by this process (receipts, DD-164(4)⑥).
  private reported: string | null = null;
  private receiptWarned: string | null = null;

  constructor(
    private readonly config: KailoDirectoryConfig,
    private readonly store: KailoMemberDirectoryStore,
    private readonly doFetch: Fetch = fetch,
  ) {}

  public start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(
      () => void this.tick(),
      this.config.intervalSeconds * 1000,
    );
    this.timer.unref?.();
  }

  public stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // One read; never concurrent with itself. Only the outcome and an HTTP
  // status are logged, never the token, secret or member data.
  public async tick(): Promise<KailoDirectoryOutcome> {
    if (this.running) return 'BUSY';
    this.running = true;
    try {
      const snapshot = await readKailoDirectory(this.config, this.doFetch);
      let applied: boolean;
      try {
        applied = await this.store.apply(snapshot, this.config.issuer);
      } catch (error) {
        await this.report(snapshot, 'FAILED');
        throw error;
      }
      if (applied) logger.info('member directory snapshot applied');
      if (applied || this.reported !== snapshot.directoryVersion)
        await this.report(snapshot, 'APPLIED');
      return applied ? 'APPLIED' : 'UNCHANGED';
    } catch (error) {
      if (error instanceof KailoDirectorySnapshotError) {
        logger.warn(`member directory snapshot rejected: ${error.message}`);
        return 'REJECTED';
      }
      if (error instanceof KailoDirectoryUnavailable) {
        logger.warn(
          `member directory unavailable${error.status ? ` (HTTP ${error.status})` : ''}: ${error.message}; keeping the applied snapshot`,
        );
        return 'UNAVAILABLE';
      }
      logger.warn(
        `member directory read failed (${error?.name || 'error'}); keeping the applied snapshot`,
      );
      return 'FAILED';
    } finally {
      this.running = false;
    }
  }

  // DD-164(4)⑥: once per applied version (and once after start), never
  // blocking the sync; only the outcome is logged.
  private async report(
    snapshot: KailoDirectorySnapshot,
    outcome: KailoDirectoryReceipt['outcome'],
  ): Promise<void> {
    try {
      await sendKailoDirectoryReceipt(
        this.config,
        {
          schema: 1,
          directoryVersion: snapshot.directoryVersion,
          appliedAt: new Date().toISOString(),
          outcome,
          failures:
            outcome === 'FAILED'
              ? [
                  {
                    kind: 'TENANT',
                    ref: snapshot.tenant.tenantId,
                    reasonCode: 'APPLY_FAILED',
                  },
                ]
              : [],
        },
        this.doFetch,
      );
      this.reported = outcome === 'APPLIED' ? snapshot.directoryVersion : null;
      this.receiptWarned = null;
    } catch (error) {
      if (this.receiptWarned !== snapshot.directoryVersion)
        logger.warn(
          `member directory receipt not delivered${error?.status ? ` (HTTP ${error.status})` : ''}; retried with the next read`,
        );
      this.receiptWarned = snapshot.directoryVersion;
    }
  }
}
