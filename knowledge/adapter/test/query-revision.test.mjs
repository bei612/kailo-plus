import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { canonical } from '../../../client-kit/adapter/protocol.mjs';
import { createAdapter } from '../src/query-revision.mjs';

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

async function fixture(t, mode = 'ok', action, protocolOperation) {
  const directory = await mkdtemp(join(tmpdir(), 'knowledge-adapter-'));
  const ids = Array.from({ length: 10 }, () => randomUUID());
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwks = join(directory, 'jwks');
  const nativeSecretFile = join(directory, 'native');
  const oidcSecretFile = join(directory, 'oidc');
  const nativeSecret = randomUUID();
  await writeFile(jwks, JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test' }] }));
  await writeFile(nativeSecretFile, nativeSecret, { mode: 0o600 });
  await writeFile(oidcSecretFile, randomUUID(), { mode: 0o600 });
  const args = { nativeObjectRef: ids[2], idempotencyKey: ids[3], authorizationTargetNativeRef: ids[1] };
  const state = { peps: 0, native: 0, methods: [] };
  const revision = '2026-10-06T23:00:00.123456789Z';
  const reference = { resourceId: ids[8], nativeObjectRef: ids[2], nativeRevision: revision,
    displayName: 'native document', mediaType: 'text/markdown' };
  const operation = protocolOperation ?? (action ? 'execute' : 'query_revision');
  const intent = operation === 'observe' ? {externalExecutionId:ids[5],idempotencyKey:args.idempotencyKey,nativeType:'delete_document'}
    : action ? { target: { resourceId: ids[8] }, input: reference } : args;
  const bodyValue = operation === 'observe' ? intent : action ? { idempotencyKey: args.idempotencyKey, actionKey: action, arguments: intent } : args;
  const upstream = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    if (request.method === 'GET') return reply(response, 405, {});
    if (request.url === '/token') return reply(response, 200, { access_token: randomUUID(), token_type: 'bearer' });
    const body = JSON.parse(raw);
    if (request.url === '/service/v1/adapter/pep_check') {
      state.peps++;
      if ((mode === 'deny' && state.peps === 1) || (mode === 'revoke' && state.peps === 2)) return reply(response, 403, {});
      assert.equal(body.operation, operation);
      assert.deepEqual(JSON.parse(body.argumentsJson), intent);
      return reply(response, 200, { actionExecutionId: ids[5], operationId: ids[6], authorizationMinZedToken: 'current' });
    }
    if (body.method === 'initialize') return reply(response, 200, { jsonrpc: '2.0', id: body.id,
      result: { protocolVersion: body.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'native-test', version: '1' } } });
    if (body.method === 'notifications/initialized') { response.writeHead(202); return response.end(); }
    state.native++;
    assert.ok(request.headers.authorization === `Bearer ${nativeSecret}`);
    assert.equal(body.method, 'tools/call');
    state.methods.push(body.params.name);
    if (body.params.name === 'delete_document') {
      assert.deepEqual(body.params.arguments, operation === 'observe'
        ? {knowledge_base_id:ids[1],idempotency_key:args.idempotencyKey,observe_only:true}
        : {knowledge_base_id:ids[1],knowledge_id:ids[2],expected_revision:revision,idempotency_key:args.idempotencyKey});
      const value = mode === 'ack-only' ? {deleted:true} : {
        task_id:ids[9],knowledge_id:ids[2],knowledge_base_id:mode === 'foreign' ? ids[0] : ids[1],
        native_revision:revision,state:mode === 'queued' ? 'RUNNING' : mode === 'unknown' ? 'UNKNOWN' : 'SUCCEEDED',
      };
      if (value.state === 'SUCCEEDED' && mode !== 'no-terminal') value.completed_at = new Date(Date.now()-1000).toISOString();
      return reply(response,200,{jsonrpc:'2.0',id:body.id,result:{content:[],structuredContent:value}});
    }
    if (body.params.name === 'export_document') {
      assert.deepEqual(body.params.arguments, { knowledge_id: ids[2] });
      return reply(response, 200, { jsonrpc: '2.0', id: body.id, result: { content: [], structuredContent: {
        knowledge_id: ids[2], knowledge_base_id: ids[1], native_revision: revision,
        content_base64: Buffer.from('native bytes').toString('base64'), media_type: 'text/markdown', filename: 'native.md',
      } } });
    }
    assert.equal(body.params.name, 'read_document');
    if (body.params.arguments.metadata_only !== true) {
      assert.deepEqual(body.params.arguments, { knowledge_id: ids[2], offset: 0 });
      return reply(response, 200, { jsonrpc: '2.0', id: body.id, result: { content: [], structuredContent: {
        document: { id: ids[2], native_revision: revision }, knowledge_base: { id: ids[1] },
        total_chunks: 1, fetched_chunks: 1, chunks: [{ chunk_id: ids[9], knowledge_id: ids[2], knowledge_base: ids[1], content: 'native text' }],
      } } });
    }
    assert.deepEqual(body.params.arguments, { knowledge_id: ids[2], metadata_only: true });
    return reply(response, 200, { jsonrpc: '2.0', id: body.id, result: { content: [], structuredContent: {
      document: { id: ids[2], native_revision: mode === 'no-revision' ? undefined
        : mode === 'changed' && state.native > 1 ? '2026-10-06T23:00:00.123456790Z' : revision,
        parse_status: mode === 'pending' ? 'pending' : 'completed' },
      knowledge_base: { id: mode === 'foreign' ? ids[9] : ids[1] },
    } } });
  });
  const origin = await listen(upstream);
  const config = { bindingId: ids[0], tenantId: ids[7], nativeKnowledgeBaseId: ids[1],
    nativeMcpUrl: `${origin}/mcp/native`, nativeMcpBearerFile: nativeSecretFile,
    actionTokenIssuer: origin, actionTokenAudience: 'knowledge-test', actionTokenJwksFile: jwks,
    corePepUrl: `${origin}/service/v1/adapter/pep_check`, oidcTokenUrl: `${origin}/token`,
    oidcClientId: 'binding-client', oidcClientSecretFile: oidcSecretFile,
    timeoutMs: 3000, maxBodyBytes: 16384, listenHost: '127.0.0.1', listenPort: 1 };
  const adapter = createAdapter(config);
  const endpoint = await listen(adapter);
  t.after(async () => {
    adapter.closeAllConnections(); upstream.closeAllConnections();
    await Promise.all([new Promise(resolve => adapter.close(resolve)), new Promise(resolve => upstream.close(resolve))]);
    await rm(directory, { recursive: true, force: true });
  });
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: origin, aud: config.actionTokenAudience, iat: now, exp: now + 60,
    jti: randomUUID(), tenant_id: ids[7], actor_principal_id: ids[4], initiating_human_principal_id: ids[4],
    operation_id: ids[6], action_execution_id: ids[5], target_id: ids[8], target_type: 'RESOURCE',
    action_key: action ?? 'knowledge.read@v1', action_definition_version: 1, authorization_min_zed_token: 'original',
    result_exposure_policy_id: randomUUID(), result_exposure_policy_version: 1,
    normalized_parameter_hash: createHash('sha256').update(canonical(operation === 'execute' ? intent : { operation, arguments: intent })).digest('hex') };
  if (action) { claims.idempotency_key = args.idempotencyKey; claims.external_execution_id = randomUUID(); }
  if (mode === 'foreign-token') claims.tenant_id = ids[9];
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: 'test', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  const token = `${header}.${payload}.${signature}`;
  return { state, args, reference, revision, invoke: () => fetch(`${endpoint}/platform-adapter/v1/${operation}`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': args.idempotencyKey },
    body: canonical(bodyValue),
  }) };
}

test('knowledge revision uses original MCP metadata and two fresh PEP decisions', async t => {
  const { state, args, revision, invoke } = await fixture(t);
  const response = await invoke();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { nativeObjectRef: args.nativeObjectRef, nativeRevision: revision });
  assert.equal(state.peps, 2);
  assert.deepEqual(state.methods, ['read_document']);
});

test('conditional delete and observation require retained native terminal evidence',async t=>{
  for(const operation of ['execute','observe']) for(const mode of ['ok','queued','unknown','ack-only','no-terminal','foreign','revoke']) {
    await t.test(`${operation}/${mode}`,async nested=>{
      const {state,invoke}=await fixture(nested,mode,'knowledge.delete@v1',operation);
      const response=await invoke();
      const body=await response.json();
      if(['ack-only','no-terminal','foreign','revoke'].includes(mode)) {
        assert.notEqual(response.status,200);
        assert.equal(body.execution,undefined);
      } else {
        assert.equal(response.status,200);
        const observation=operation==='execute'?body.execution:body;
        assert.equal(observation.platformStatus,mode==='ok'?'SUCCEEDED':mode==='queued'?'RUNNING':'UNKNOWN');
        assert.equal(observation.terminalAt !== undefined,mode==='ok');
        if(operation==='execute') assert.equal(body.resultJson,mode==='ok'?'{}':undefined);
      }
      assert.deepEqual(state.methods,['delete_document']);
    });
  }
});

test('actual read/export consume the signed typed reference and native content', async t => {
  for (const action of ['knowledge.read@v1', 'knowledge.export@v1']) {
    await t.test(action, async nested => {
      const { state, reference, invoke } = await fixture(nested, 'ok', action);
      const response = await invoke();
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.execution.platformStatus, 'SUCCEEDED');
      assert.equal(result.execution.nativeId, reference.nativeObjectRef);
      assert.deepEqual(result.contentReference, reference);
      assert.equal(state.peps, 2);
      assert.deepEqual(JSON.parse(result.resultJson), action === 'knowledge.read@v1' ? { text: 'native text' }
        : { contentBase64: Buffer.from('native bytes').toString('base64'), mediaType: 'text/markdown', filename: 'native.md' });
    });
  }
});

test('native pending, later revision and permission loss never yield a terminal read', async t => {
  for (const mode of ['pending', 'changed', 'revoke']) {
    await t.test(mode, async nested => {
      const { invoke } = await fixture(nested, mode, 'knowledge.read@v1');
      const response = await invoke();
      assert.notEqual(response.status, 200);
      const result = await response.json();
      assert.equal(result.execution, undefined);
      assert.equal(result.resultJson, undefined);
    });
  }
});

test('scope, revision evidence and post-read revocation fail closed', async t => {
  for (const mode of ['deny', 'revoke', 'foreign', 'no-revision', 'foreign-token']) {
    await t.test(mode, async nested => {
      const { state, invoke } = await fixture(nested, mode);
      const response = await invoke();
      assert.notEqual(response.status, 200);
      assert.equal((await response.json()).nativeRevision, undefined);
      if (mode === 'deny' || mode === 'foreign-token') assert.equal(state.native, 0);
    });
  }
});
