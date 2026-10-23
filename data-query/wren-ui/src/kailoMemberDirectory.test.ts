import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { createHash, randomUUID, webcrypto } from 'crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import knex, { Knex } from 'knex';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import {
  kailoDirectoryConfig,
  KailoDirectoryConfig,
  KailoDirectoryConfigError,
  KailoMemberDirectoryStore,
  KailoMemberDirectorySync,
  parseKailoDirectory,
} from './apollo/server/services/kailoMemberDirectory';
import { KailoUserDirectory } from './apollo/server/services/kailoUserService';
import { KailoUserRepository } from './apollo/server/repositories/kailoUserRepository';
import { middleware } from './middleware';
import { decodeKailoUser, KAILO_USER_HEADER } from './utils/kailoUser';

/* eslint-disable @typescript-eslint/no-var-requires */
const ownership = require('../migrations/20261021000000_kailo_user_ownership');
const directoryMigration = require('../migrations/20261023000000_kailo_member_directory');
const identityMigration = require('../migrations/20261024000000_kailo_user_identity');
/* eslint-enable @typescript-eslint/no-var-requires */

if (!(globalThis as any).crypto?.subtle) (globalThis as any).crypto = webcrypto;

const ISSUER = 'https://idp.example.test/realms/kailo';
const BINDING = randomUUID();
const TENANT = randomUUID();
const WS = randomUUID();
const key = (issuer: string, subject: string) =>
  createHash('sha256')
    .update(JSON.stringify([issuer, subject]))
    .digest('hex');

type Member = {
  principalId: string;
  displayName: string;
  tenantRole: 'ADMIN' | 'MEMBER';
  identities: { issuer: string; subject: string; picture: string }[];
  workspaces: { workspaceId: string; role: 'ADMIN' | 'MEMBER' }[];
};

const member = (
  subject: string,
  role: 'ADMIN' | 'MEMBER',
  name = `name-${subject}`,
): Member => ({
  principalId: randomUUID(),
  displayName: name,
  tenantRole: role,
  identities: [
    {
      issuer: ISSUER,
      subject,
      picture: `https://kailo.example.test/api/v1/identity/avatars/${subject}`,
    },
  ],
  workspaces: [{ workspaceId: WS, role: 'MEMBER' }],
});

const snapshot = (members: Member[], version = 'a') => ({
  bindingId: BINDING,
  directoryVersion: createHash('sha256').update(version).digest('hex'),
  tenant: { tenantId: TENANT, name: 'Acme' },
  workspaces: [{ workspaceId: WS, name: 'Ops' }],
  members,
});

async function database(): Promise<Knex> {
  const db = knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  for (const name of ['thread', 'sql_pair', 'instruction', 'api_history'])
    await db.schema.createTable(name, (table) => table.increments('id'));
  await ownership.up(db);
  await directoryMigration.up(db);
  await identityMigration.up(db);
  return db;
}

// Fake IdP token endpoint and Core service listener.
class Platform {
  server: Server;
  origin = '';
  tokenStatus = 200;
  directoryStatus = 200;
  directoryBody: unknown = snapshot([]);
  rawBody: string | null = null;
  tokens = 0;
  reads = 0;
  lastAuthorization = '';
  lastBasic = '';

  async start() {
    this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.url === '/token' && req.method === 'POST') {
        this.tokens += 1;
        this.lastBasic = req.headers.authorization || '';
        res.statusCode = this.tokenStatus;
        res.setHeader('content-type', 'application/json');
        return res.end(
          JSON.stringify({
            access_token: 'directory-token',
            token_type: 'Bearer',
          }),
        );
      }
      if (
        req.url ===
          `/service/v1/component-directory/bindings/${BINDING}/members` &&
        req.method === 'GET'
      ) {
        this.reads += 1;
        this.lastAuthorization = req.headers.authorization || '';
        res.statusCode = this.directoryStatus;
        res.setHeader('content-type', 'application/json');
        return res.end(this.rawBody ?? JSON.stringify(this.directoryBody));
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((resolve) =>
      this.server.listen(0, '127.0.0.1', resolve),
    );
    this.origin = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop() {
    return new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

describe('DD-133(4) member directory configuration', () => {
  const base = {
    KAILO_DIRECTORY_BINDING_ID: BINDING,
    KAILO_DIRECTORY_CLIENT_ID: 'kailo-wren-directory',
    KAILO_DIRECTORY_CLIENT_SECRET_FILE:
      '/run/secrets/kailo_directory_client_secret',
    KAILO_DIRECTORY_TOKEN_URL: `${ISSUER}/protocol/openid-connect/token`,
    KAILO_DIRECTORY_CORE_URL: 'http://core-bff:8081',
    WREN_NATIVE_IDENTITY_JSON: JSON.stringify({ issuer: ISSUER }),
  };

  test('absent keys keep the directory off; a complete set is read', () => {
    expect(kailoDirectoryConfig({})).toBeNull();
    expect(
      kailoDirectoryConfig({ KAILO_DIRECTORY_BINDING_ID: ' ' }),
    ).toBeNull();
    expect(kailoDirectoryConfig(base)).toMatchObject({
      bindingId: BINDING,
      coreUrl: 'http://core-bff:8081',
      intervalSeconds: 60,
      issuer: ISSUER,
    });
  });

  test('a partial or invalid set refuses to start', () => {
    const { KAILO_DIRECTORY_CORE_URL: _omit, ...partial } = base;
    for (const env of [
      partial,
      { KAILO_DIRECTORY_INTERVAL_SECONDS: '60' },
      { ...base, KAILO_DIRECTORY_BINDING_ID: 'nope' },
      { ...base, KAILO_DIRECTORY_CLIENT_ID: 'a b' },
      { ...base, KAILO_DIRECTORY_CLIENT_SECRET_FILE: 'relative' },
      { ...base, KAILO_DIRECTORY_CORE_URL: 'http://core-bff:8081/x' },
      { ...base, KAILO_DIRECTORY_TOKEN_URL: 'http://u:p@idp/token' },
      { ...base, KAILO_DIRECTORY_INTERVAL_SECONDS: '5' },
      { ...base, KAILO_DIRECTORY_INTERVAL_SECONDS: '3601' },
      { ...base, WREN_NATIVE_IDENTITY_JSON: '' },
    ])
      expect(() => kailoDirectoryConfig(env)).toThrow(
        KailoDirectoryConfigError,
      );
  });

  test('the snapshot contract is closed and bound to this binding', () => {
    const good = snapshot([member('s1', 'ADMIN')]);
    expect(parseKailoDirectory(good, BINDING).members).toHaveLength(1);
    for (const bad of [
      { ...good, extra: 1 },
      { ...good, bindingId: randomUUID() },
      { ...good, directoryVersion: 'v1' },
      { ...good, members: [{ ...member('s', 'MEMBER'), tenantRole: 'OWNER' }] },
      { ...good, members: [{ ...member('s', 'MEMBER'), email: 'x@y' }] },
      { ...good, tenant: { tenantId: TENANT } },
    ])
      expect(() => parseKailoDirectory(bad, BINDING)).toThrow();
  });
});

describe('DD-133(4) periodic member directory sync', () => {
  let platform: Platform;
  let db: Knex;
  let dir: string;
  let config: KailoDirectoryConfig;

  beforeAll(async () => {
    platform = new Platform();
    await platform.start();
  });
  afterAll(() => platform.stop());

  beforeEach(async () => {
    db = await database();
    dir = mkdtempSync(join(tmpdir(), 'kailo-dir-'));
    writeFileSync(join(dir, 'secret'), 'directory-secret\n', { mode: 0o600 });
    config = {
      bindingId: BINDING,
      clientId: 'kailo-wren-directory',
      clientSecretFile: join(dir, 'secret'),
      tokenUrl: `${platform.origin}/token`,
      coreUrl: platform.origin,
      intervalSeconds: 60,
      issuer: ISSUER,
    };
    Object.assign(platform, {
      tokenStatus: 200,
      directoryStatus: 200,
      rawBody: null,
      tokens: 0,
      reads: 0,
      directoryBody: snapshot([]),
    });
  });
  afterEach(async () => {
    await db.destroy();
    rmSync(dir, { recursive: true, force: true });
  });

  const counts = async () => ({
    members: Number((await db('kailo_directory_member').count('* as n'))[0].n),
    states: Number((await db('kailo_directory_state').count('* as n'))[0].n),
  });

  test('before any snapshot everyone is a member and nobody is an admin', async () => {
    const store = new KailoMemberDirectoryStore(db);
    expect(await store.access(key(ISSUER, 'anyone'))).toEqual({
      delivered: false,
      member: true,
      admin: false,
    });
  });

  test('the first snapshot is applied with roles, profiles and the client credential', async () => {
    platform.directoryBody = snapshot([
      member('alice', 'ADMIN', 'Alice Kailo'),
      member('bob', 'MEMBER'),
      // Another issuer is not this instance's identity.
      {
        ...member('carol', 'MEMBER'),
        identities: [
          { issuer: 'https://other', subject: 'carol', picture: 'https://x/y' },
        ],
      },
    ]);
    await db('kailo_user').insert({
      user_key: key(ISSUER, 'alice'),
      name: 'IdP name',
      username: 'alice',
      email: 'a@example.test',
    });
    const store = new KailoMemberDirectoryStore(db);
    const sync = new KailoMemberDirectorySync(config, store);
    expect(await sync.tick()).toBe('APPLIED');
    expect(platform.lastBasic).toBe(
      `Basic ${Buffer.from('kailo-wren-directory:directory-secret').toString('base64')}`,
    );
    expect(platform.lastAuthorization).toBe('Bearer directory-token');
    expect(await store.access(key(ISSUER, 'alice'))).toEqual({
      delivered: true,
      member: true,
      admin: true,
    });
    expect(await store.access(key(ISSUER, 'bob'))).toEqual({
      delivered: true,
      member: true,
      admin: false,
    });
    expect((await store.access(key('https://other', 'carol'))).member).toBe(
      false,
    );
    expect((await store.access(key(ISSUER, 'mallory'))).member).toBe(false);
    const alice = await db('kailo_user')
      .where({ user_key: key(ISSUER, 'alice') })
      .first();
    expect(alice).toMatchObject({
      name: 'Alice Kailo',
      picture: 'https://kailo.example.test/api/v1/identity/avatars/alice',
      username: 'alice',
      email: 'a@example.test',
      // DD-138(4): the snapshot identity addresses Kailo notifications.
      issuer: ISSUER,
      subject: 'alice',
    });
    expect(await counts()).toEqual({ members: 2, states: 1 });
  });

  test('an unchanged version writes nothing', async () => {
    platform.directoryBody = snapshot([member('alice', 'ADMIN')]);
    const store = new KailoMemberDirectoryStore(db);
    const sync = new KailoMemberDirectorySync(config, store);
    expect(await sync.tick()).toBe('APPLIED');
    const before = await db('kailo_directory_state').first();
    await db('kailo_directory_member').update({ admin: false });
    expect(await sync.tick()).toBe('UNCHANGED');
    expect(await db('kailo_directory_state').first()).toEqual(before);
    expect((await db('kailo_directory_member').first()).admin).toBeFalsy();
  });

  test('503, 401, malformed or foreign snapshots change nothing', async () => {
    platform.directoryBody = snapshot([member('alice', 'ADMIN')]);
    const store = new KailoMemberDirectoryStore(db);
    const sync = new KailoMemberDirectorySync(config, store);
    await sync.tick();
    const version = store.appliedVersion;
    platform.directoryBody = snapshot([], 'empty');
    platform.directoryStatus = 503;
    expect(await sync.tick()).toBe('UNAVAILABLE');
    platform.directoryStatus = 401;
    expect(await sync.tick()).toBe('UNAVAILABLE');
    platform.directoryStatus = 200;
    platform.tokenStatus = 401;
    expect(await sync.tick()).toBe('UNAVAILABLE');
    platform.tokenStatus = 200;
    platform.rawBody = '{not json';
    expect(await sync.tick()).toBe('REJECTED');
    platform.rawBody = null;
    platform.directoryBody = {
      ...snapshot([], 'empty'),
      bindingId: randomUUID(),
    };
    expect(await sync.tick()).toBe('REJECTED');
    rmSync(config.clientSecretFile);
    expect(await sync.tick()).toBe('FAILED');
    expect(store.appliedVersion).toBe(version);
    expect((await store.access(key(ISSUER, 'alice'))).admin).toBe(true);
    expect(await counts()).toEqual({ members: 1, states: 1 });
  });

  test('removal, demotion and promotion follow the next snapshot; kailo_user rows stay', async () => {
    platform.directoryBody = snapshot([
      member('alice', 'ADMIN'),
      member('bob', 'MEMBER'),
    ]);
    const store = new KailoMemberDirectoryStore(db);
    const sync = new KailoMemberDirectorySync(config, store);
    await sync.tick();
    platform.directoryBody = snapshot([member('alice', 'MEMBER')], 'b');
    expect(await sync.tick()).toBe('APPLIED');
    expect(await store.access(key(ISSUER, 'alice'))).toEqual({
      delivered: true,
      member: true,
      admin: false,
    });
    expect((await store.access(key(ISSUER, 'bob'))).member).toBe(false);
    expect(
      await db('kailo_user')
        .where({ user_key: key(ISSUER, 'bob') })
        .first(),
    ).toBeTruthy();
    platform.directoryBody = snapshot(
      [member('alice', 'ADMIN'), member('bob', 'MEMBER')],
      'c',
    );
    await sync.tick();
    expect((await store.access(key(ISSUER, 'alice'))).admin).toBe(true);
    expect((await store.access(key(ISSUER, 'bob'))).member).toBe(true);
  });

  test('a restart keeps the persisted snapshot before the next read', async () => {
    platform.directoryBody = snapshot([member('alice', 'ADMIN')]);
    await new KailoMemberDirectorySync(
      config,
      new KailoMemberDirectoryStore(db),
    ).tick();
    platform.directoryStatus = 503;
    const restarted = new KailoMemberDirectoryStore(db);
    expect(await new KailoMemberDirectorySync(config, restarted).tick()).toBe(
      'UNAVAILABLE',
    );
    expect(await restarted.access(key(ISSUER, 'alice'))).toEqual({
      delivered: true,
      member: true,
      admin: true,
    });
    expect((await restarted.access(key(ISSUER, 'bob'))).member).toBe(false);
  });

  test('a delivered directory names the member at login; before it the token does', async () => {
    const repository = new KailoUserRepository(db);
    const store = new KailoMemberDirectoryStore(db);
    const users = new KailoUserDirectory(repository, store);
    const profile = {
      key: key(ISSUER, 'alice'),
      name: 'Token Name',
      username: 'alice',
      email: null,
      picture: null,
      locale: 'en',
      admin: false,
    };
    await users.remember(profile);
    expect((await db('kailo_user').first()).name).toBe('Token Name');
    platform.directoryBody = snapshot([
      member('alice', 'MEMBER', 'Kailo Alice'),
    ]);
    await new KailoMemberDirectorySync(config, store).tick();
    await new KailoUserDirectory(repository, store).remember(profile);
    expect(await db('kailo_user').first()).toMatchObject({
      name: 'Kailo Alice',
      locale: 'en',
    });
  });

  test('DD-138(4): a login stores issuer+subject only when they hash to the key', async () => {
    const repository = new KailoUserRepository(db);
    const users = new KailoUserDirectory(repository);
    const base = {
      name: 'Dana',
      username: 'dana',
      email: null,
      picture: null,
      locale: null,
      admin: false,
    };
    await users.remember({
      ...base,
      key: key(ISSUER, 'dana'),
      issuer: ISSUER,
      subject: 'dana',
    });
    // A pair that does not derive the key is never stored.
    await users.remember({
      ...base,
      key: key(ISSUER, 'erin'),
      issuer: ISSUER,
      subject: 'mallory',
    });
    // A later profile without the pair keeps the stored one.
    await users.remember({ ...base, name: 'Dana 2', key: key(ISSUER, 'dana') });
    const identities = await repository.findIdentities([
      key(ISSUER, 'dana'),
      key(ISSUER, 'erin'),
    ]);
    expect([...identities.values()]).toEqual([
      { userKey: key(ISSUER, 'dana'), issuer: ISSUER, subject: 'dana' },
    ]);
    expect(
      (
        await db('kailo_user')
          .where({ user_key: key(ISSUER, 'dana') })
          .first()
      ).name,
    ).toBe('Dana 2');
  });

  test('DD-138(4): the identity migration adds and removes issuer/subject', async () => {
    expect(await db.schema.hasColumn('kailo_user', 'issuer')).toBe(true);
    expect(await db.schema.hasColumn('kailo_user', 'subject')).toBe(true);
    await identityMigration.down(db);
    expect(await db.schema.hasColumn('kailo_user', 'issuer')).toBe(false);
    expect(await db.schema.hasColumn('kailo_user', 'subject')).toBe(false);
    expect(await db.schema.hasColumn('kailo_user', 'name')).toBe(true);
    await identityMigration.up(db);
    expect(await db.schema.hasColumn('kailo_user', 'issuer')).toBe(true);
  });

  test('the migration is reversible', async () => {
    await directoryMigration.down(db);
    expect(await db.schema.hasTable('kailo_directory_state')).toBe(false);
    expect(await db.schema.hasTable('kailo_directory_member')).toBe(false);
    expect(await db.schema.hasTable('kailo_user')).toBe(true);
    await directoryMigration.up(db);
  });
});

describe('DD-133(4) entry admission in the middleware', () => {
  let idp: Server;
  let node: Server;
  let keys: Awaited<ReturnType<typeof generateKeyPair>>;
  let settings: Record<string, string>;
  let answer: (userKey: string) => { status: number; body: unknown };
  let lookups: string[];
  const saved = { ...process.env };

  beforeAll(async () => {
    keys = await generateKeyPair('RS256');
    const jwk = await exportJWK(keys.publicKey);
    idp = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ keys: [{ ...jwk, kid: 'native' }] }));
    });
    // Stands in for the Node consumer. In the deployment the hop passes the
    // middleware again, which sets the user from the same token; here the
    // user key is derived from that token's subject directly.
    node = createServer((req, res) => {
      lookups.push(`${req.method} ${req.url} ${req.headers.authorization}`);
      const token = String(req.headers.authorization).split(' ')[1] ?? '';
      const claims = JSON.parse(
        Buffer.from(token.split('.')[1] ?? '', 'base64url').toString() || '{}',
      );
      const reply = answer(claims.sub ? key(settings.issuer, claims.sub) : '');
      res.statusCode = reply.status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(reply.body));
    });
    for (const server of [idp, node])
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
    const origin = `http://127.0.0.1:${(idp.address() as AddressInfo).port}`;
    settings = {
      issuer: `${origin}/realms/kailo`,
      audience: 'wren-browser',
      jwksUrl: `${origin}/jwks`,
      accessClaim: 'native_instances',
      accessValue: 'wren-instance',
      publicOrigin: origin,
    };
  });

  beforeEach(() => {
    lookups = [];
    delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    delete process.env.WREN_PLATFORM_BINDING_CONFIG_FILE;
    process.env.WREN_NATIVE_IDENTITY_JSON = JSON.stringify(settings);
    process.env.KAILO_DIRECTORY_BINDING_ID = BINDING;
    process.env.WREN_UI_ENDPOINT = `http://127.0.0.1:${(node.address() as AddressInfo).port}/`;
  });

  afterAll(async () => {
    process.env = saved;
    for (const server of [idp, node])
      await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const sign = (sub: string) =>
    new SignJWT({
      iss: settings.issuer,
      aud: settings.audience,
      exp: Math.floor(Date.now() / 1000) + 60,
      sub,
      native_instances: ['wren-instance'],
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'native' })
      .sign(keys.privateKey);

  const request = async (path: string, sub: string, method = 'GET') =>
    middleware(
      new NextRequest(`${settings.publicOrigin}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${await sign(sub)}`,
          origin: settings.publicOrigin,
        },
      }),
    );

  const forwardedUser = (response: Response) =>
    decodeKailoUser(
      response.headers.get(`x-middleware-request-${KAILO_USER_HEADER}`),
    );

  test('a non-member is refused for pages, GraphQL and REST', async () => {
    answer = (userKey) => ({
      status: 200,
      body: { userKey, delivered: true, member: false, admin: false },
    });
    for (const [path, method] of [
      ['/home', 'GET'],
      ['/api/graphql', 'POST'],
      ['/api/v1/ask', 'POST'],
    ]) {
      const response = await request(path, 'mallory', method);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'KAILO_NOT_MEMBER' });
    }
    expect(lookups[0]).toMatch(/^GET \/api\/kailo\/directory-access Bearer /);
  });

  test('a STANDALONE member gets the directory role; undelivered stays member', async () => {
    answer = (userKey) => ({
      status: 200,
      body: { userKey, delivered: true, member: true, admin: true },
    });
    let response = await request('/home', 'alice');
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(forwardedUser(response)?.admin).toBe(true);
    answer = (userKey) => ({
      status: 200,
      body: { userKey, delivered: false, member: true, admin: false },
    });
    response = await request('/home', 'alice');
    expect(forwardedUser(response)?.admin).toBe(false);
  });

  test('a lookup failure or an answer for another user fails closed', async () => {
    answer = () => ({ status: 503, body: { error: 'x' } });
    expect((await request('/home', 'alice')).status).toBe(503);
    answer = () => ({
      status: 200,
      body: {
        userKey: 'b'.repeat(64),
        delivered: true,
        member: true,
        admin: true,
      },
    });
    expect((await request('/home', 'alice')).status).toBe(503);
  });

  test('the lookup path itself is not looked up again; no directory, no lookup', async () => {
    answer = () => ({ status: 500, body: {} });
    const response = await request('/api/kailo/directory-access', 'alice');
    expect(response.headers.get('x-middleware-next')).toBe('1');
    delete process.env.KAILO_DIRECTORY_BINDING_ID;
    expect(
      (await request('/home', 'alice')).headers.get('x-middleware-next'),
    ).toBe('1');
    expect(lookups).toEqual([]);
  });
});
