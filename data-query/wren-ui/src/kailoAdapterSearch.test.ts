import { createServer, Server as HttpServer } from 'http';
import { AddressInfo } from 'net';
import { createHash, randomUUID } from 'crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import knex, { Knex } from 'knex';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { apiResolver } from 'next/dist/server/api-utils/node/api-resolver';
import {
  canonical,
  componentPath,
  searchResponse,
} from '../../../client-kit/adapter/protocol.mjs';
import {
  containsPattern,
  kailoAdapterSearch,
} from './apollo/server/services/kailoAdapterSearch';
import * as queryAdmission from './apollo/server/services/nativeQueryAdmission';
import { NativeQueryDelivery } from './apollo/server/services/nativeQueryAdmission';
import handler, {
  config as routeConfig,
} from './pages/api/platform-adapter/[operation]';

// DD-138(5), `.design/07` §4.8.4 / §5.2: the adapter `search` operation of
// the REMOTE_ADAPTER release, through the real route handler.

let mockDb: Knex;
jest.mock('./common', () => ({
  get components() {
    return { knex: mockDb };
  },
}));

const PROJECT = 5;
const TENANT = randomUUID();
const WORKSPACE = randomUUID();
const BINDING = randomUUID();
const ISSUER = 'https://core.example.test/action-token';
const AUDIENCE = 'kailo-adapter-data-query';

async function database(): Promise<Knex> {
  const db = knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  for (const name of ['model', 'view'])
    await db.schema.createTable(name, (table) => {
      table.increments('id');
      table.integer('project_id');
    });
  await db.schema.createTable('thread', (table) => {
    table.increments('id');
    table.integer('project_id');
    table.text('summary');
    table.timestamps(true, true);
  });
  await db.schema.createTable('thread_response', (table) => {
    table.increments('id');
    table.integer('thread_id');
    table.text('question');
  });
  await db.schema.createTable('dashboard', (table) => {
    table.increments('id');
    table.integer('project_id');
    table.string('name');
  });
  await db.schema.createTable('dashboard_item', (table) => {
    table.increments('id');
    table.integer('dashboard_id');
    table.string('display_name');
    table.timestamps(true, true);
  });
  await db('model').insert([
    { id: 1, project_id: PROJECT },
    { id: 2, project_id: 99 },
  ]);
  await db('view').insert({ id: 3, project_id: PROJECT });
  await db('thread').insert([
    { id: 7, project_id: PROJECT, summary: 'Revenue by region' },
    { id: 8, project_id: PROJECT, summary: 'Churn 100% check' },
    { id: 9, project_id: 99, summary: 'Revenue elsewhere' },
    { id: 10, project_id: PROJECT, summary: null },
  ]);
  await db('thread_response').insert([
    { thread_id: 7, question: 'What is revenue by region?' },
    { thread_id: 7, question: 'And by quarter?' },
    { thread_id: 10, question: 'Monthly revenue trend' },
  ]);
  await db('dashboard').insert([
    { id: 1, project_id: PROJECT, name: 'Dashboard' },
    { id: 2, project_id: 99, name: 'Other' },
  ]);
  await db('dashboard_item').insert([
    { id: 1, dashboard_id: 1, display_name: 'Revenue chart' },
    { id: 2, dashboard_id: 2, display_name: 'Revenue foreign' },
  ]);
  return db;
}

describe('DD-138(5) adapter search', () => {
  let dir: string;
  let keys: Awaited<ReturnType<typeof generateKeyPair>>;
  let delivery: NativeQueryDelivery;
  let server: HttpServer;
  let endpoint: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'kailo-search-'));
    keys = await generateKeyPair('ES256');
    const jwk = await exportJWK(keys.publicKey);
    writeFileSync(
      join(dir, 'jwks.json'),
      JSON.stringify({ keys: [{ ...jwk, kid: 'search-1', alg: 'ES256' }] }),
    );
    delivery = {
      bindingId: BINDING,
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      projectId: PROJECT,
      nativeScopeRef: String(PROJECT),
      actionTokenIssuer: ISSUER,
      actionTokenAudience: AUDIENCE,
      actionTokenJwksFile: join(dir, 'jwks.json'),
      requestMaxBytes: 65536,
    } as NativeQueryDelivery;
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  beforeEach(async () => {
    mockDb = await database();
    jest
      .spyOn(queryAdmission, 'loadQueryDelivery')
      .mockResolvedValue(delivery);
    server = createServer((request, response) => {
      void apiResolver(
        request,
        response,
        { operation: 'search' },
        { default: handler, config: routeConfig },
        {
          previewModeId: '',
          previewModeEncryptionKey: '',
          previewModeSigningKey: '',
        },
        false,
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/platform-adapter/v1/search`;
  });
  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await mockDb.destroy();
    jest.restoreAllMocks();
  });

  const request = (
    query: string,
    resources = [
      { resourceId: randomUUID(), nativeType: 'model', nativeId: '1' },
    ],
  ) => ({
    idempotencyKey: randomUUID(),
    limit: 10,
    locale: 'EN',
    query,
    resources,
  });

  const token = (args: unknown, changes: Record<string, unknown> = {}) => {
    const now = Math.floor(Date.now() / 1000);
    const claims: Record<string, unknown> = {
      iss: ISSUER,
      aud: AUDIENCE,
      iat: now,
      exp: now + 60,
      jti: randomUUID(),
      token_use: 'COMPONENT_SEARCH',
      tenant_id: TENANT,
      workspace_id: WORKSPACE,
      binding_id: BINDING,
      projection_generation: 1,
      actor_principal_id: randomUUID(),
      authorization_min_zed_token: 'zed-1',
      normalized_parameter_hash: createHash('sha256')
        .update(canonical(args))
        .digest('hex'),
      ...changes,
    };
    for (const [name, value] of Object.entries(claims))
      if (value === undefined) delete claims[name];
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'ES256', kid: 'search-1', typ: 'JWT' })
      .sign(keys.privateKey);
  };

  const call = async (
    args: any,
    bearer?: string,
    headers: Record<string, string> = {},
  ) =>
    fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': args.idempotencyKey,
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        ...headers,
      },
      body: canonical(args),
    });

  test('a valid Search Token and body return project threads and dashboard items', async () => {
    const args = request('revenue');
    const response = await call(args, await token(args));
    expect(response.status).toBe(200);
    const { results } = await response.json();
    expect(results.map((r) => [r.kind, r.path]).sort()).toEqual([
      ['DASHBOARD', '/home/dashboard'],
      ['QUESTION', '/home/10'],
      ['QUESTION', '/home/7'],
    ]);
    const thread = results.find((r) => r.path === '/home/7');
    expect(thread).toMatchObject({
      title: 'Revenue by region',
      summary: 'What is revenue by region?',
    });
    // A thread without summary is titled by its first question.
    expect(results.find((r) => r.path === '/home/10').title).toBe(
      'Monthly revenue trend',
    );
    for (const result of results) {
      expect(componentPath(result.path)).toBe(true);
      expect(Number.isFinite(Date.parse(result.updatedAt))).toBe(true);
    }
    // Other projects' threads/dashboards never appear.
    expect(JSON.stringify(results)).not.toContain('elsewhere');
    expect(JSON.stringify(results)).not.toContain('foreign');
  });

  test('LIKE wildcards in the query are literal text', async () => {
    expect(containsPattern('100%_a\\')).toBe('%100\\%\\_a\\\\%');
    const all = await kailoAdapterSearch(mockDb, delivery, request('%') as any);
    expect(all.results.map((r) => r.path)).toEqual(['/home/8']);
    const none = await kailoAdapterSearch(mockDb, delivery, request('_') as any);
    expect(none.results).toEqual([]);
  });

  test('resources outside this binding are ignored', async () => {
    for (const resources of [
      // a model of another project
      [{ resourceId: randomUUID(), nativeType: 'model', nativeId: '2' }],
      // unknown native type or malformed id
      [{ resourceId: randomUUID(), nativeType: 'thread', nativeId: '7' }],
      [{ resourceId: randomUUID(), nativeType: 'view', nativeId: '03' }],
      [{ resourceId: randomUUID(), nativeType: 'view', nativeId: '404' }],
    ]) {
      const args = request('revenue', resources);
      const response = await call(args, await token(args));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ results: [] });
    }
    // One entry of the binding (a view of the project) is enough.
    const args = request('revenue', [
      { resourceId: randomUUID(), nativeType: 'model', nativeId: '2' },
      { resourceId: randomUUID(), nativeType: 'view', nativeId: '3' },
    ]);
    expect((await (await call(args, await token(args))).json()).results).toHaveLength(3);
  });

  test.each([
    ['another binding', { binding_id: randomUUID() }],
    ['another tenant', { tenant_id: randomUUID() }],
    ['another workspace', { workspace_id: randomUUID() }],
    ['a different body hash', { normalized_parameter_hash: 'f'.repeat(64) }],
    ['another token use', { token_use: 'ACTION' }],
    ['an action target', { target_id: randomUUID() }],
    ['a lifetime over 60 s', { exp: Math.floor(Date.now() / 1000) + 120 }],
    ['another audience', { aud: 'kailo-adapter-other' }],
    ['no zed token', { authorization_min_zed_token: undefined }],
  ])('a token for %s is refused with 401', async (_name, changes) => {
    const args = request('revenue');
    const response = await call(args, await token(args, changes));
    expect(response.status).toBe(401);
  });

  test('a missing bearer is 401; a malformed or non-canonical body is 400', async () => {
    const args = request('revenue');
    expect((await call(args)).status).toBe(401);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'idempotency-key': args.idempotencyKey,
        authorization: `Bearer ${await token(args)}`,
      },
      body: JSON.stringify({ ...args, query: ' padded ' }),
    });
    expect(response.status).toBe(400);
    const mismatch = await call(args, await token(args), {
      'idempotency-key': randomUUID(),
    });
    expect(mismatch.status).toBe(400);
  });

  test.each(['cookie', 'origin'])(
    'a request with a browser %s header is refused',
    async (header) => {
      const args = request('revenue');
      const response = await call(args, await token(args), {
        [header]: 'browser',
      });
      expect(response.status).toBe(403);
    },
  );

  test('answers are sanitised to the AdapterSearchResponse shape', () => {
    const { results } = searchResponse(
      [
        { kind: 'QUESTION', title: 'ok\u0007title', path: '/home/1' },
        { kind: 'QUESTION', title: 'evil', path: '//evil.test/x' },
        { kind: 'QUESTION', title: 'token', path: '/home/1?token=x' },
        { kind: 'QUESTION', title: '', path: '/home/2' },
        { kind: 'THREAD', title: 'kind', path: '/home/3' },
      ],
      10,
    );
    expect(results).toEqual([
      { kind: 'QUESTION', title: 'ok title', path: '/home/1' },
    ]);
  });
});
