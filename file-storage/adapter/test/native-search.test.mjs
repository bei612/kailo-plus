// DD-138(5), .design/07 §4.8.4 / §5.2: adapter `search` operation.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { canonical, createAdapter } from '../src/query-revision.mjs';
import { nativePagePath } from '../src/native-search.mjs';
import { componentPath } from '../../../client-kit/adapter/protocol.mjs';

const ids = Array.from({ length: 16 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const kailoWorkspace = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const binding = ids[0], nativeWorkspace = ids[1], root = ids[2], folder = ids[3], outside = ids[4], tenant = ids[5], workspace = ids[6];

async function listen(server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return `http://127.0.0.1:${server.address().port}`;
}

function reply(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

function post(url, headers, body) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: 'POST', headers }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : undefined }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

const hits = [
  { Uuid: ids[8], Type: 'LEAF', Path: `binding/${kailoWorkspace}/Q3 Plan/预算 #1?.docx`, Modified: '1760000000' },
  { Uuid: ids[9], Type: 'COLLECTION', Path: `binding/${kailoWorkspace}/预算`, Modified: '1760000100' },
  { Uuid: ids[10], Type: 'LEAF', Path: `binding/${kailoWorkspace}/recycle_bin/预算.txt` },
  { Uuid: ids[11], Type: 'LEAF', Path: `binding/${kailoWorkspace}/old 预算.txt`, IsRecycled: true },
  { Uuid: ids[12], Type: 'LEAF', Path: 'binding/elsewhere/预算.txt' },
  { Uuid: ids[13], Type: 'LEAF', Path: `binding/${kailoWorkspace}/../预算.txt` },
];

async function setup(t, changes = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'file-storage-search-'));
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwksFile = join(directory, 'jwks.json');
  const nativeSecret = randomBytes(32).toString('hex');
  await writeFile(jwksFile, JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'ES256', use: 'sig' }] }), { mode: 0o600 });
  await writeFile(join(directory, 'native-credential'), nativeSecret, { mode: 0o600 });
  await writeFile(join(directory, 'oidc-credential'), randomBytes(32).toString('hex'), { mode: 0o600 });
  const state = { reads: [], searches: [] };
  const nodes = {
    [root]: { Uuid: root, Type: 'COLLECTION', Path: 'binding', ContextWorkspace: { Uuid: nativeWorkspace, Slug: 'kailo-binding' } },
    [folder]: { Uuid: folder, Type: 'COLLECTION', Path: `binding/${kailoWorkspace}`, ContextWorkspace: { Uuid: nativeWorkspace, Slug: 'kailo-binding' } },
    [outside]: { Uuid: outside, Type: 'COLLECTION', Path: 'common-files/x', ContextWorkspace: { Uuid: ids[15], Slug: 'common-files' } },
  };
  const upstream = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${nativeSecret}`);
    assert.equal(request.headers['x-kailo-native-execution'], undefined);
    if (changes.nativeStatus) return reply(response, changes.nativeStatus, {});
    const read = request.url.match(/^\/v2\/n\/node\/([0-9a-f-]+)\?Flags=WithMetaDefaults$/);
    if (request.method === 'GET' && read) {
      state.reads.push(read[1]);
      return nodes[read[1]] ? reply(response, 200, nodes[read[1]]) : reply(response, 404, {});
    }
    if (request.method === 'POST' && request.url === '/v2/n/nodes') {
      let raw = '';
      for await (const chunk of request) raw += chunk;
      state.searches.push(JSON.parse(raw));
      return reply(response, 200, { Nodes: hits, Pagination: { Total: hits.length } });
    }
    return reply(response, 404, {});
  });
  const origin = await listen(upstream);
  const config = { bindingId: binding, tenantId: tenant, workspaceId: workspace, nativeWorkspaceId: nativeWorkspace, nativeRootRef: root,
    cellsRestBaseUrl: `${origin}/v2`, cellsRestV1BaseUrl: `${origin}/a`, cellsBearerFile: join(directory, 'native-credential'),
    actionTokenIssuer: `${origin}/issuer`, actionTokenAudience: 'kailo-adapter-file-storage', actionTokenJwksFile: jwksFile,
    corePepUrl: `${origin}/service/v1/adapter/pep_check`, oidcTokenUrl: `${origin}/oidc/token`, oidcClientId: 'binding-client',
    oidcClientSecretFile: join(directory, 'oidc-credential'), timeoutMs: 3000, maxBodyBytes: 65536, listenHost: '127.0.0.1', listenPort: 1 };
  const adapter = createAdapter(config);
  const adapterOrigin = await listen(adapter);
  t.after(async () => {
    adapter.closeAllConnections(); upstream.closeAllConnections();
    await Promise.all([new Promise((resolve) => adapter.close(resolve)), new Promise((resolve) => upstream.close(resolve))]);
    await rm(directory, { recursive: true, force: true });
  });
  const args = { idempotencyKey: ids[7], query: '预算', limit: 10, locale: 'ZH_CN', resources: [
    { resourceId: ids[14], nativeType: 'folder', nativeId: folder },
    { resourceId: ids[13], nativeType: 'folder', nativeId: outside },
    { resourceId: ids[12], nativeType: 'model', nativeId: 'published/model' },
  ], ...changes.args };
  function token(change = {}) {
    const now = Math.floor(Date.now() / 1000);
    const claims = { iss: config.actionTokenIssuer, aud: config.actionTokenAudience, iat: now - 1, exp: now + 59,
      jti: ids[15], tenant_id: tenant, workspace_id: workspace, binding_id: binding, actor_principal_id: ids[11],
      token_use: 'COMPONENT_SEARCH', projection_generation: 3, authorization_min_zed_token: 'zed-fresh',
      normalized_parameter_hash: createHash('sha256').update(canonical(args)).digest('hex'), ...change };
    const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: 'k1', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signature = sign('sha256', Buffer.from(`${header}.${payload}`), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    return `${header}.${payload}.${signature}`;
  }
  const invoke = (options = {}) => post(`${adapterOrigin}/platform-adapter/v1/search`, {
    authorization: `Bearer ${options.token ?? token()}`, 'content-type': 'application/json',
    'idempotency-key': options.key ?? args.idempotencyKey, ...options.headers }, options.raw ?? canonical(args));
  return { state, invoke, token, args };
}

test('valid Search Token and body return sanitized FILE/FOLDER results inside the named folder only', async (t) => {
  const { state, invoke } = await setup(t);
  const answer = await invoke();
  assert.equal(answer.status, 200);
  const enc = encodeURIComponent;
  assert.deepEqual(answer.body, { results: [
    { kind: 'FILE', path: `/ws-kailo-ws-${kailoWorkspace}/${enc('Q3 Plan')}/${enc('预算 #1?.docx')}`, title: '预算 #1?.docx',
      summary: '/Q3 Plan', updatedAt: new Date(1760000000 * 1000).toISOString() },
    { kind: 'FOLDER', path: `/ws-kailo-ws-${kailoWorkspace}/${enc('预算')}`, title: '预算', summary: '/',
      updatedAt: new Date(1760000100 * 1000).toISOString() },
  ] });
  for (const item of answer.body.results) assert.equal(componentPath(item.path), true);
  // The foreign-workspace node was read but never searched; the non-UUID ref never reached Cells.
  assert.deepEqual(state.reads.sort(), [root, folder, outside].sort());
  assert.equal(state.searches.length, 1);
  assert.deepEqual(state.searches[0], { Scope: { Root: { Uuid: folder }, Recursive: true }, Filters: { Text: { Term: '预算' } },
    Offset: 0, Limit: 10, Flags: ['WithMetaDefaults'] });
});

test('wrong binding, workspace, body hash or token use is 401 before any native call', async (t) => {
  for (const change of [{ binding_id: ids[9] }, { workspace_id: ids[9] }, { normalized_parameter_hash: '0'.repeat(64) },
    { token_use: 'ACTION' }, { action_execution_id: ids[9] }, { exp: Math.floor(Date.now() / 1000) + 600 }]) {
    await t.test(Object.keys(change)[0], async (nested) => {
      const { state, invoke, token } = await setup(nested);
      const answer = await invoke({ token: token(change) });
      assert.equal(answer.status, 401);
      assert.deepEqual(answer.body, { error: 'adapter request refused' });
      assert.equal(state.reads.length + state.searches.length, 0);
    });
  }
});

test('browser context and non-canonical body are refused', async (t) => {
  const { state, invoke, args } = await setup(t);
  assert.equal((await invoke({ headers: { origin: 'https://kailo.example' } })).status, 403);
  assert.equal((await invoke({ headers: { cookie: 'session=1' } })).status, 403);
  assert.equal((await invoke({ raw: JSON.stringify(args, null, 1) })).status, 400);
  assert.equal((await invoke({ key: ids[9] })).status, 400);
  assert.equal(state.reads.length, 0);
});

test('an unavailable native source is 503, never an empty result', async (t) => {
  const { invoke } = await setup(t, { nativeStatus: 500 });
  assert.equal((await invoke()).status, 503);
});

test('native page paths are encoded Cells routes inside the binding root only', () => {
  assert.equal(nativePagePath('binding', 'kailo-binding', 'binding'), '/ws-kailo-binding');
  assert.equal(nativePagePath('binding', 'kailo-binding', 'binding/a b/c?d=token#x'), '/ws-kailo-binding/a%20b/c%3Fd%3Dtoken%23x');
  assert.equal(nativePagePath('binding', 'kailo-binding', `binding/${kailoWorkspace.toUpperCase()}/f.txt`),
    `/ws-kailo-ws-${kailoWorkspace}/f.txt`);
  assert.equal(nativePagePath('binding', 'kailo-binding', 'bindingx/f.txt'), undefined);
  assert.equal(nativePagePath('binding', 'kailo-binding', 'other/f.txt'), undefined);
  assert.equal(nativePagePath('binding', 'bad/slug', 'binding/f.txt'), undefined);
  assert.equal(componentPath(nativePagePath('binding', 'kailo-binding', 'binding/a b/c\\d')), true);
});
