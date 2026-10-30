import { getLogger } from '@server/utils';
import {
  boundedBody,
  KailoDirectoryConfig,
  kailoDirectoryConfig,
  kailoServiceToken,
} from './kailoMemberDirectory';

// DD-169(5), `.design/07` §4.8.11: credentials of a data source connection are
// held by Kailo (Core component secret custody, values in the Tenant's
// OpenBao); this instance keeps only the returned `secretId`.
//
//   POST {core}/service/v1/component-secrets/bindings/{binding}/secrets
//   POST {core}/service/v1/component-secrets/bindings/{binding}/secrets/{id}/read
//   POST {core}/service/v1/component-secrets/bindings/{binding}/secrets/{id}/retire
//
// Authentication is the member-directory client of `07` §4.7.4 (same
// client-credentials token as the directory read and notification delivery).
// Writes and retirements carry the acting admin's issuer+subject; Core checks
// that person's fresh `manage` on the binding. Values read back live only in
// this process's memory for at most five minutes and are dropped as soon as the
// secret is replaced or retired. Nothing here logs a value, a token or the
// response body: logs carry the operation, the secret id and the HTTP status.

const logger = getLogger('KailoComponentSecrets');
logger.level = 'info';

export const DATA_SOURCE_CONNECTION_PURPOSE = 'DATA_SOURCE_CONNECTION';
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 256;
const REQUEST_TIMEOUT_MS = 15_000;
const RESPONSE_MAX_BYTES = 128 * 1024;
const VALUE_MAX_BYTES = 64 * 1024;
const KEY = /^[A-Za-z0-9_]{1,64}$/;
const SECRET_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface KailoActor {
  issuer: string;
  subject: string;
}

export type SecretValue = Record<string, string>;

export interface StoredSecret {
  secretId: string;
  version: number;
}

/** Core or OpenBao could not complete the operation; nothing was stored. */
export class ComponentSecretUnavailable extends Error {
  readonly code = 'DEPENDENCY_UNAVAILABLE';
  constructor(
    readonly operation: string,
    readonly status?: number,
  ) {
    super(`component secret ${operation} unavailable`);
  }
}

/** Core refused (actor not an admin, binding not active, unknown secret). */
export class ComponentSecretRefused extends Error {
  readonly code = 'COMPONENT_SECRET_REFUSED';
  constructor(
    readonly operation: string,
    readonly status: number,
  ) {
    super(`component secret ${operation} refused`);
  }
}

export interface ComponentSecretStore {
  write(actor: KailoActor, value: SecretValue): Promise<StoredSecret>;
  read(secretId: string): Promise<SecretValue>;
  retire(actor: KailoActor, secretId: string): Promise<void>;
}

/** The shape `07` §4.8.11 accepts: 1–64 string fields, ≤ 64 KiB. */
export function validSecretValue(value: unknown): value is SecretValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length >= 1 &&
    entries.length <= 64 &&
    entries.every(([key, item]) => KEY.test(key) && typeof item === 'string') &&
    Buffer.byteLength(JSON.stringify(value)) <= VALUE_MAX_BYTES
  );
}

type Fetch = typeof fetch;

export class KailoComponentSecrets implements ComponentSecretStore {
  private token: { value: string; expiresAt: number } | null = null;
  private readonly cache = new Map<
    string,
    { value: SecretValue; expiresAt: number }
  >();

  constructor(
    private readonly config: Pick<
      KailoDirectoryConfig,
      'bindingId' | 'clientId' | 'clientSecretFile' | 'tokenUrl' | 'coreUrl'
    >,
    private readonly doFetch: Fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  public async write(
    actor: KailoActor,
    value: SecretValue,
  ): Promise<StoredSecret> {
    if (!validSecretValue(value))
      throw new ComponentSecretRefused('write', 400);
    const body = await this.call('write', '', {
      purpose: DATA_SOURCE_CONNECTION_PURPOSE,
      actor: { issuer: actor.issuer, subject: actor.subject },
      value,
    });
    if (
      !body ||
      typeof body.secretId !== 'string' ||
      !SECRET_ID.test(body.secretId) ||
      !Number.isSafeInteger(body.version) ||
      body.version <= 0
    )
      throw new ComponentSecretUnavailable('write');
    return { secretId: body.secretId, version: body.version };
  }

  public async read(secretId: string): Promise<SecretValue> {
    if (!SECRET_ID.test(secretId))
      throw new ComponentSecretRefused('read', 400);
    const cached = this.cache.get(secretId);
    if (cached && cached.expiresAt > this.now()) return { ...cached.value };
    this.cache.delete(secretId);
    const body = await this.call('read', `/${secretId}/read`, null);
    if (!body || body.secretId !== secretId || !validSecretValue(body.value))
      throw new ComponentSecretUnavailable('read');
    if (this.cache.size >= CACHE_MAX_ENTRIES)
      this.cache.delete(this.cache.keys().next().value);
    this.cache.set(secretId, {
      value: { ...body.value },
      expiresAt: this.now() + CACHE_TTL_MS,
    });
    return { ...body.value };
  }

  public async retire(actor: KailoActor, secretId: string): Promise<void> {
    if (!SECRET_ID.test(secretId))
      throw new ComponentSecretRefused('retire', 400);
    this.forget(secretId);
    await this.call('retire', `/${secretId}/retire`, {
      actor: { issuer: actor.issuer, subject: actor.subject },
    });
  }

  /** Drops a cached value (replacement or retirement). */
  public forget(secretId: string) {
    this.cache.delete(secretId);
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > this.now())
      return this.token.value;
    let issued;
    try {
      issued = await kailoServiceToken(this.config, this.doFetch);
    } catch {
      throw new ComponentSecretUnavailable('token');
    }
    const seconds = issued.expiresIn ?? 60;
    this.token = {
      value: issued.accessToken,
      expiresAt: this.now() + Math.max(seconds - 30, 0) * 1000,
    };
    return issued.accessToken;
  }

  private async call(
    operation: string,
    suffix: string,
    payload: Record<string, unknown> | null,
  ): Promise<any> {
    const url = `${this.config.coreUrl}/service/v1/component-secrets/bindings/${this.config.bindingId}/secrets${suffix}`;
    const token = await this.accessToken();
    let response: Response;
    try {
      response = await this.doFetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          ...(payload ? { 'content-type': 'application/json' } : {}),
        },
        body: payload ? JSON.stringify(payload) : undefined,
        redirect: 'manual',
        cache: 'no-store',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      logger.info(`${operation}: Core unreachable`);
      throw new ComponentSecretUnavailable(operation);
    }
    if (response.status === 401) this.token = null;
    if (response.status !== 200 && response.status !== 201) {
      await response.body?.cancel().catch(() => undefined);
      logger.info(`${operation}: Core answered ${response.status}`);
      if (response.status >= 500 || response.status === 429)
        throw new ComponentSecretUnavailable(operation, response.status);
      throw new ComponentSecretRefused(operation, response.status);
    }
    try {
      return JSON.parse(await boundedBody(response, RESPONSE_MAX_BYTES));
    } catch {
      throw new ComponentSecretUnavailable(operation);
    }
  }
}

let configured: KailoComponentSecrets | null | undefined;

/**
 * The custody client of this instance: present exactly when the member
 * directory (and thus the Kailo service identity) is configured; null for an
 * independent native deployment, which keeps the original encrypted storage.
 */
export function kailoComponentSecrets(): KailoComponentSecrets | null {
  if (configured === undefined) {
    const config = kailoDirectoryConfig();
    configured = config ? new KailoComponentSecrets(config) : null;
  }
  return configured;
}
