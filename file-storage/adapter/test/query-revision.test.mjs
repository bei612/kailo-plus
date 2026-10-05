import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createAdapter, queryDigest } from '../src/query-revision.mjs';

const ids = Array.from({ length: 12 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
const args = { idempotencyKey: 'same-original-query', nativeObjectRef: ids[3] };

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

function reply(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

async function setup(t, changes = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'file-storage-adapter-'));
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwksFile = join(directory, 'jwks.json');
  const nativeSecret = randomBytes(32).toString('hex');
  const oidcSecret = randomBytes(32).toString('hex');
  await writeFile(jwksFile, JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test-current', alg: 'ES256', use: 'sig' }] }), { mode: 0o600 });
  await writeFile(join(directory, 'native-credential'), nativeSecret, { mode: 0o600 });
  await writeFile(join(directory, 'oidc-credential'), oidcSecret, { mode: 0o600 });
  const state = { peps: 0, nativeReads: [], queries: [], redirectReads: 0 };
  const root = { Uuid: ids[2], Type: 'COLLECTION', Path: 'documents/root', ContextWorkspace: { Uuid: ids[1] } };
  const target = { Uuid: ids[3], Type: 'LEAF', Path: 'documents/root/file.txt', ContextWorkspace: { Uuid: ids[1] } };
  const versions = { Versions: [{ VersionId: 'older', MTime: '999999', IsHead: false },
    { VersionId: 'head-native-version', IsHead: true, PreSignedGET: { Url: 'must-not-disclose' }, ContentHash: 'not-a-revision' }] };
  const upstream = createServer(async (request, response) => {
    if (request.url === '/oidc/token') {
      assert.equal(request.headers.authorization, `Basic ${Buffer.from(`binding-client:${oidcSecret}`).toString('base64')}`);
      return reply(response, 200, { access_token: 'ephemeral-fixture-oidc', token_type: 'Bearer' });
    }
    if (request.url === '/service/v1/adapter/pep_check') {
      state.peps += 1;
      assert.equal(request.headers.authorization, 'Bearer ephemeral-fixture-oidc');
      let body = '';
      for await (const chunk of request) body += chunk;
      const parsed = JSON.parse(body);
      assert.equal(parsed.bindingId, ids[0]);
      assert.equal(parsed.operation, 'query_revision');
      assert.deepEqual(JSON.parse(parsed.argumentsJson), args);
      if (changes.pep) return changes.pep(state, response, parsed);
      return reply(response, 200, { actionExecutionId: ids[7], operationId: ids[6], authorizationMinZedToken: `fresh-${state.peps}` });
    }
    if (request.url === '/redirect-target') {
      state.redirectReads += 1;
      return reply(response, 200, versions);
    }
    assert.equal(request.headers.authorization, `Bearer ${nativeSecret}`);
    state.nativeReads.push(request.url);
    if (request.url === `/v2/n/node/${ids[2]}?Flags=WithVersionsAll`) return reply(response, 200, changes.root ?? root);
    if (request.url === `/v2/n/node/${ids[3]}?Flags=WithVersionsAll`) return reply(response, 200, changes.target ?? target);
    if (request.url === `/v2/n/node/${ids[3]}/versions`) {
      assert.equal(request.method, 'POST');
      let body = '';
      for await (const chunk of request) body += chunk;
      state.queries.push(JSON.parse(body));
      if (changes.redirect) { response.writeHead(302, { location: '/redirect-target' }); return response.end(); }
      return reply(response, changes.nativeStatus ?? 200, changes.versions ?? versions);
    }
    return reply(response, 404, {});
  });
  const origin = await listen(upstream);
  const config = { bindingId: ids[0], tenantId: ids[4], workspaceId: ids[5], nativeWorkspaceId: ids[1], nativeRootRef: ids[2],
    cellsRestBaseUrl: `${origin}/v2`, cellsBearerFile: join(directory, 'native-credential'),
    actionTokenIssuer: `${origin}/issuer`, actionTokenAudience: 'file-storage-private-adapter', actionTokenJwksFile: jwksFile,
    corePepUrl: `${origin}/service/v1/adapter/pep_check`, oidcTokenUrl: `${origin}/oidc/token`, oidcClientId: 'binding-client',
    oidcClientSecretFile: join(directory, 'oidc-credential'), timeoutMs: 3000, maxBodyBytes: 65536, listenHost: '127.0.0.1', listenPort: 1 };
  const adapter = createAdapter(config);
  const adapterOrigin = await listen(adapter);
  t.after(async () => {
    adapter.closeAllConnections(); upstream.closeAllConnections();
    await Promise.all([new Promise((resolve) => adapter.close(resolve)), new Promise((resolve) => upstream.close(resolve))]);
    await rm(directory, { recursive: true, force: true });
  });
  function token(change = {}, key = privateKey) {
    const now = Math.floor(Date.now() / 1000);
    const claims = { iss: config.actionTokenIssuer, aud: config.actionTokenAudience, iat: now - 1, exp: now + 60,
      jti: ids[11], tenant_id: ids[4], workspace_id: ids[5], actor_principal_id: ids[8], agent_principal_id: ids[8],
      initiating_human_principal_id: ids[9], operation_id: ids[6], action_execution_id: ids[7],
      target_type: 'RESOURCE', target_id: ids[10], action_key: 'file_storage.read', action_definition_version: 1,
      delegation_id: ids[11], delegation_version: 1, result_exposure_policy_id: ids[9], result_exposure_policy_version: 1,
      authorization_min_zed_token: 'original', normalized_parameter_hash: queryDigest(args), ...change };
    const encodedHeader = Buffer.from(JSON.stringify({ alg: 'ES256', kid: 'test-current', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signature = sign('sha256', Buffer.from(`${encodedHeader}.${payload}`), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    return `${encodedHeader}.${payload}.${signature}`;
  }
  async function invoke(options = {}) {
    return fetch(`${adapterOrigin}${options.path ?? '/platform-adapter/v1/query_revision'}`, {
      method: 'POST', headers: { authorization: `Bearer ${options.token ?? token()}`, 'content-type': 'application/json',
        'idempotency-key': options.key ?? args.idempotencyKey }, body: options.raw ?? JSON.stringify(args),
    });
  }
  return { state, token, invoke, target };
}

test('HTTP protocol reaches fixed native UUID + NodeVersions and discloses only actual head VersionId', async (t) => {
  const { state, invoke } = await setup(t);
  const response = await invoke();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { nativeObjectRef: ids[3], nativeRevision: 'head-native-version' });
  assert.equal(state.peps, 2);
  assert.equal(state.nativeReads.length, 3);
  assert.deepEqual(state.queries, [{ FilterBy: 'VersionsAll', Offset: 0, Limit: 0, Flags: ['WithMetaNone'] }]);
});

test('signed scope, parameter, expiry and content-policy failures never reach native reader', async (t) => {
  const { state, token, invoke } = await setup(t);
  for (const change of [{ tenant_id: ids[0] }, { workspace_id: ids[0] }, { normalized_parameter_hash: 'other' },
    { result_exposure_policy_id: 'NONE', result_exposure_policy_version: 'NONE' },
    { exp: 1 }, { target_type: 'APPLICATION_BINDING' }, { actor_principal_id: ids[0] }]) {
    assert.equal((await invoke({ token: token(change) })).status, 401);
  }
  const { privateKey: otherKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  assert.equal((await invoke({ token: token({}, otherKey) })).status, 401);
  assert.equal(state.peps, 0);
  assert.equal(state.nativeReads.length, 0);
});

test('header/body intent mismatch and duplicate object fields fail closed', async (t) => {
  const { state, invoke } = await setup(t);
  assert.equal((await invoke({ key: 'other-intent' })).status, 400);
  assert.equal((await invoke({ raw: `{"idempotencyKey":"${args.idempotencyKey}","nativeObjectRef":"${ids[0]}","nativeObjectRef":"${ids[3]}"}` })).status, 400);
  assert.equal(state.nativeReads.length, 0);
  assert.equal(state.peps, 0);
});

test('first fresh PEP unavailability prevents native access', async (t) => {
  const { state, invoke } = await setup(t, { pep: (_state, response) => reply(response, 503, {}) });
  assert.equal((await invoke()).status, 503);
  assert.equal(state.nativeReads.length, 0);
});

test('revocation between native read and disclosure refuses the already fetched head', async (t) => {
  const { state, invoke } = await setup(t, { pep: (current, response) => current.peps === 1
    ? reply(response, 200, { actionExecutionId: ids[7], operationId: ids[6], authorizationMinZedToken: 'first-fresh' })
    : reply(response, 403, {}) });
  const response = await invoke();
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'adapter request refused' });
  assert.equal(state.peps, 2);
  assert.equal(state.nativeReads.length, 3);
});

test('PEP response must refer to exact signed original action and operation', async (t) => {
  const { state, invoke } = await setup(t, { pep: (_current, response) => reply(response, 200,
    { actionExecutionId: ids[0], operationId: ids[6], authorizationMinZedToken: 'wrong-parent' }) });
  assert.equal((await invoke()).status, 503);
  assert.equal(state.nativeReads.length, 0);
});

test('native UUID, Workspace, root segment and recycle scope are checked, never defaulted', async (t) => {
  const base = { Uuid: ids[3], Type: 'LEAF', Path: 'documents/root/file.txt', ContextWorkspace: { Uuid: ids[1] } };
  for (const target of [{ ...base, Uuid: ids[0] }, { ...base, ContextWorkspace: { Uuid: ids[0] } },
    { ...base, Path: 'documents/root-other/file.txt' }, { ...base, Path: 'documents/root/../outside/file.txt' },
    { ...base, IsRecycled: true }, { ...base, ContextWorkspace: undefined }]) {
    await t.test(JSON.stringify(target), async (nested) => {
      const { state, invoke } = await setup(nested, { target });
      assert.notEqual((await invoke()).status, 200);
      assert.equal(state.queries.length, 0);
    });
  }
});

test('missing, ambiguous or malformed native head is unknown, not mtime/ETag latest', async (t) => {
  for (const Versions of [[], [{ VersionId: 'latest-time', MTime: '999999', ETag: 'x' }],
    [{ VersionId: 'a', IsHead: true }, { VersionId: 'b', IsHead: true }],
    [{ VersionId: 'a', IsHead: true }, { VersionId: 'a' }], [{ VersionId: 'a', IsHead: 'true' }]]) {
    await t.test(JSON.stringify(Versions), async (nested) => {
      const { invoke } = await setup(nested, { versions: { Versions } });
      assert.equal((await invoke()).status, 503);
    });
  }
});

test('native redirect or malformed/oversized response is not followed or disclosed', async (t) => {
  const redirect = await setup(t, { redirect: true });
  assert.equal((await redirect.invoke()).status, 503);
  assert.equal(redirect.state.redirectReads, 0);
  const oversized = await setup(t, { versions: { Versions: [{ VersionId: 'x'.repeat(65536), IsHead: true }] } });
  assert.equal((await oversized.invoke()).status, 503);
});

test('same read intent remains fresh and unknown operations create no capability', async (t) => {
  const { state, invoke } = await setup(t);
  assert.equal((await invoke()).status, 200);
  assert.equal((await invoke()).status, 200);
  assert.equal(state.peps, 4);
  assert.equal((await invoke({ path: '/platform-adapter/v1/execute' })).status, 404);
  assert.equal(state.peps, 4);
});
