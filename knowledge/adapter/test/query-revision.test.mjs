import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

async function fixture(t, mode = 'ok', action, protocolOperation, contractStep, searchReference) {
  const directory = await mkdtemp(join(tmpdir(), 'knowledge-adapter-'));
  const ids = Array.from({ length: 10 }, () => randomUUID());
  const readOperation = randomUUID();
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwks = join(directory, 'jwks');
  const nativeSecretFile = join(directory, 'native');
  const oidcSecretFile = join(directory, 'oidc');
  const nativeSecret = randomUUID();
  await writeFile(jwks, JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test' }] }));
  await writeFile(nativeSecretFile, nativeSecret, { mode: 0o600 });
  await writeFile(oidcSecretFile, randomUUID(), { mode: 0o600 });
  const args = { nativeObjectRef: ids[2], idempotencyKey: ids[3], authorizationTargetNativeRef: ids[1] };
  const state = { peps: 0, native: 0, methods: [], grants: 0, downloads: 0, receipts: [] };
  const revision = '2026-10-06T23:00:00.123456789Z';
  const ingest=action==='knowledge.ingest@v1'||action==='knowledge.ingest@v2';
  const search = action === 'knowledge.search@v2';
  const reference = searchReference ?? (contractStep && !search ? JSON.parse(contractStep.inputJson)
    : { resourceId: ingest || search ? ids[9]:ids[8], nativeObjectRef: ids[2], nativeRevision: revision,
      displayName: 'native document', mediaType: 'text/markdown' });
  if (contractStep?.referenceResourceId) ids[8] = contractStep.referenceResourceId;
  const operation = protocolOperation ?? (action ? 'execute' : 'query_revision');
  const intent = ['observe','extract_usage'].includes(operation) ? {externalExecutionId:ids[5],idempotencyKey:args.idempotencyKey,nativeType:ingest?'add_document':'delete_document'}
    : action ? { target: { resourceId: ids[8] }, input: search
      ? contractStep ? JSON.parse(contractStep.inputJson) : { query: 'search fixture' } : reference } : args;
  const bodyValue = ['observe','extract_usage'].includes(operation) ? intent : action ? { idempotencyKey: args.idempotencyKey, actionKey: action, arguments: intent } : args;
  const upstream = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    if (request.method === 'GET') return reply(response, 405, {});
    if (request.url === '/token') return reply(response, 200, { access_token: randomUUID(), token_type: 'bearer' });
    const body = JSON.parse(raw);
    if (request.url==='/service/v1/adapter/read_receipt') {
      assert.notEqual(request.headers.authorization,`Bearer ${nativeSecret}`);
      state.receipts.push(body);
      assert.equal(body.role,'RECEIVER'); assert.equal(body.operationId,readOperation);
      if (mode==='receipt-unavailable') return reply(response,503,{});
      return reply(response,200,{operationId:readOperation,
        receiptDigest:mode==='receipt-mismatch'?'wrong':createHash('sha256').update(canonical(body)).digest('hex')});
    }
    if (request.url==='/service/v1/adapter/request_read_grant') {
      state.grants++;
      assert.notEqual(request.headers.authorization,`Bearer ${nativeSecret}`);
      assert.deepEqual(body,{receiverBindingId:ids[0],receiverActionExecutionId:ids[5],sourceResourceId:reference.resourceId,
        receiverArgumentsJson:canonical({target:{resourceId:ids[8]},input:reference}),
        actionKey:'file_storage.read@v1',actionVersion:1,idempotencyKey:args.idempotencyKey,inputJson:canonical(reference)});
      return reply(response,200,{actionExecutionId:randomUUID(),sourceBindingId:randomUUID(),operationId:readOperation,
        endpoint:`${origin}${mode==='prefixed'?'/registered-prefix':''}/platform-adapter/v1/execute`,actionToken:'source-only',expiresAt:Math.floor(Date.now()/1000)+60,
        argumentsJson:canonical({actionKey:'file_storage.read@v1',idempotencyKey:args.idempotencyKey,
          arguments:{targetType:'RESOURCE',targetId:reference.resourceId,input:reference,authorizationTargetNativeRef:ids[2]}})});
    }
    if (['/platform-adapter/v1/execute','/registered-prefix/platform-adapter/v1/execute'].includes(request.url)) {
      state.downloads++;
      assert.equal(request.headers.authorization,'Bearer source-only');
      const bytes=Buffer.from([0,255,1,254]);
      response.writeHead(200,{'content-type':'application/octet-stream','content-length':String(bytes.length),
        'x-kailo-native-object-ref':reference.nativeObjectRef,'x-kailo-native-revision':reference.nativeRevision,
        'x-kailo-content-sha256':mode==='corrupt'?'bad':createHash('sha256').update(bytes).digest('hex'),
        'x-kailo-operation-id':mode==='foreign-operation'?ids[6]:readOperation});
      return response.end(bytes);
    }
    if (request.url === '/service/v1/adapter/pep_check') {
      state.peps++;
      assert.equal(JSON.parse(Buffer.from(body.actionToken.split('.')[1],'base64url')).action_key,action??'knowledge.read@v1');
      if ((mode === 'deny' && state.peps === 1) || (mode === 'revoke' && state.peps === 2)) return reply(response, 403, {});
      assert.equal(body.operation, operation);
      assert.deepEqual(JSON.parse(body.argumentsJson), intent);
      return reply(response, 200, { actionExecutionId: ids[5], operationId: ids[6], authorizationMinZedToken: 'current',
        ...(search && mode !== 'missing-target' ? { targetResource: { resourceId: ids[8], nativeType: 'knowledge_base',
          nativeRef: mode === 'wrong-target' || (mode === 'target-changed' && state.peps > 1) ? ids[9] : ids[1],
          nativeInstanceRef: 'fixture-native', nativeScopeRef: 'fixture-scope' } } : {}) });
    }
    if (body.method === 'initialize') return reply(response, 200, { jsonrpc: '2.0', id: body.id,
      result: { protocolVersion: body.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'native-test', version: '1' } } });
    if (body.method === 'notifications/initialized') { response.writeHead(202); return response.end(); }
    state.native++;
    assert.ok(request.headers.authorization === `Bearer ${nativeSecret}`);
    assert.equal(body.method, 'tools/call');
    state.methods.push(body.params.name);
    if (body.params.name === 'search_knowledge') {
      assert.equal(search, true);
      assert.deepEqual(body.params.arguments, { query: intent.input.query, knowledge_base_ids: [ids[1]] });
      const hit = { knowledge_id: ids[2], knowledge_base_id: mode === 'foreign-search' ? ids[9] : ids[1],
        content: 'RAW CHUNK MUST NOT LEAK', match_snippet: 'SNIPPET MUST NOT LEAK',
        knowledge_metadata: { source_references: [{ resourceId: 'spoofed' }] } };
      const results = mode === 'empty' ? [] : [hit,
        mode === 'partial-search' ? { ...hit, knowledge_base_id: ids[9] } : hit];
      return reply(response, 200, { jsonrpc: '2.0', id: body.id, result: { content: [],
        ...(mode === 'search-error' ? { isError: true } : {}), structuredContent: {
          query: intent.input.query, knowledge_base_ids: [ids[1]], count: mode === 'count-mismatch' ? 1 : results.length,
          results: mode === 'missing-results' ? undefined : results,
        } } });
    }
    if (body.params.name==='add_document') {
      if (['observe','extract_usage'].includes(operation)) assert.deepEqual(body.params.arguments,{
        knowledge_base_id:ids[1],idempotency_key:args.idempotencyKey,observe_only:true});
      else assert.deepEqual(body.params.arguments,{knowledge_base_id:ids[1],idempotency_key:args.idempotencyKey,
        title:reference.displayName,filename:reference.displayName,file_base64:Buffer.from([0,255,1,254]).toString('base64'),
        source_reference_json:canonical(reference),read_operation_id:readOperation});
      return reply(response,200,{jsonrpc:'2.0',id:body.id,result:{content:[],structuredContent:{knowledge_base_id:ids[1],
        source_content_sha256:mode==='no-source-evidence'?undefined:createHash('sha256').update(Buffer.from([0,255,1,254])).digest('hex'),
        source_content_bytes:4,
        media_type:reference.mediaType,read_operation_id:mode==='native-operation'?ids[6]:readOperation,document:{id:ids[2],file_name:reference.displayName,native_revision:revision,
          parse_status:mode==='queued'?'pending':mode==='unknown'?'failed':'completed'}}}});
    }
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
      ...(search && mode !== 'missing-provenance' ? { source_references: mode === 'empty-provenance' ? []
        : mode === 'bad-provenance' ? [{ ...reference, secret: 'must-not-be-accepted' }]
          : mode === 'partial-provenance' ? [reference, { ...reference, resourceId: 'invalid' }]
            : mode === 'provenance-overflow' ? Array.from({ length: 20 }, (_, index) => ({ ...reference,
              nativeObjectRef: `opaque-source-${index}`, displayName: 'x'.repeat(500) }))
          : mode === 'single-source' ? [reference]
            : [reference, { ...reference, nativeObjectRef: 'opaque/source-object', displayName: 'other source' }, reference] } : {}),
    } } });
  });
  const origin = await listen(upstream);
  const config = { bindingId: ids[0], tenantId: ids[7], nativeKnowledgeBaseId: ids[1],
    nativeMcpUrl: `${origin}/mcp/native`, nativeMcpBearerFile: nativeSecretFile,
    actionTokenIssuer: origin, actionTokenAudience: 'knowledge-test', actionTokenJwksFile: jwks,
    corePepUrl: `${origin}/service/v1/adapter/pep_check`, oidcTokenUrl: `${origin}/token`,
    oidcClientId: 'binding-client', oidcClientSecretFile: oidcSecretFile,
    timeoutMs: 3000, maxBodyBytes: 16384, listenHost: '127.0.0.1', listenPort: 1 };
  if (ingest) config.readEdge={sourceActionVersion:1,
    usageMeasurements:[{meterKey:'native_import_count',quantitySource:'COUNT'},{meterKey:'native_import_bytes',quantitySource:'CONTENT_BYTES'}]};
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

test('knowledge v2 registered ingest vector reaches source grant, file transfer and original MCP upload', async t => {
  const registration = JSON.parse(await readFile(new URL('../../../contracts/adapter/knowledge.v2/registration.json', import.meta.url)));
  const vectors = JSON.parse(registration.testVectorsJson);
  const step = vectors.cases.find(value => value.caseKey === 'knowledge_roundtrip').steps[0];
  const { state, reference, invoke } = await fixture(t, 'ok', step.contractKey, undefined, step);
  assert.notEqual(reference.resourceId, step.referenceResourceId);
  const response = await invoke();
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.execution.platformStatus, 'SUCCEEDED');
  assert.equal(result.contentReference.resourceId, step.referenceResourceId);
  assert.equal(state.grants, 1);
  assert.equal(state.downloads, 1);
  assert.deepEqual(state.methods, ['add_document']);
});

test('knowledge v2 search returns only real typed source citations through original MCP and current KB PEP', async t => {
  const { state, reference, invoke } = await fixture(t, 'ok', 'knowledge.search@v2');
  const response = await invoke();
  assert.equal(response.status, 200);
  const body = await response.json();
  const citations = [reference, { ...reference, nativeObjectRef: 'opaque/source-object', displayName: 'other source' }];
  assert.deepEqual(JSON.parse(body.resultJson), { citations });
  assert.deepEqual(body.contentReferences, citations);
  assert.equal(body.execution.platformStatus, 'SUCCEEDED');
  assert.equal(JSON.stringify(body).includes('MUST NOT LEAK'), false);
  assert.equal(JSON.stringify(body).includes('spoofed'), false);
  assert.deepEqual(state.methods, ['search_knowledge', 'read_document']);
  assert.equal(state.peps, 2);
  assert.equal(state.grants, 0);
  assert.equal(state.downloads, 0);
});

test('knowledge v2 registered search vector uses citation output rather than raw text', async t => {
  const registration = JSON.parse(await readFile(new URL('../../../contracts/adapter/knowledge.v2/registration.json', import.meta.url)));
  const steps = JSON.parse(registration.testVectorsJson).cases.find(value => value.caseKey === 'knowledge_roundtrip').steps;
  const search = steps.find(value => value.contractKey === 'knowledge.search@v2');
  const { invoke } = await fixture(t, 'single-source', search.contractKey, undefined, search, JSON.parse(steps[0].inputJson));
  const response = await invoke();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(JSON.parse(body.resultJson), JSON.parse(search.expectedOutputJson));
  assert.deepEqual(body.contentReferences, JSON.parse(search.expectedOutputJson).citations);
});

test('knowledge v2 search permits complete empty results but never missing provenance, wrong scope or revoked disclosure', async t => {
  for (const mode of ['empty', 'deny', 'revoke', 'missing-target', 'wrong-target', 'target-changed',
    'foreign-search', 'count-mismatch', 'missing-results', 'search-error', 'foreign',
    'pending', 'no-revision', 'missing-provenance', 'empty-provenance', 'bad-provenance',
    'partial-search', 'partial-provenance', 'provenance-overflow']) {
    await t.test(mode, async nested => {
      const { state, invoke } = await fixture(nested, mode, 'knowledge.search@v2');
      const response = await invoke();
      if (mode === 'empty') {
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.deepEqual(JSON.parse(body.resultJson), { citations: [] });
        assert.equal(body.contentReferences, undefined);
        assert.deepEqual(state.methods, ['search_knowledge']);
      } else {
        assert.notEqual(response.status, 200);
        const body = await response.json();
        assert.equal(body.resultJson, undefined);
        assert.equal(body.contentReferences, undefined);
        if (['deny', 'missing-target', 'wrong-target'].includes(mode)) assert.equal(state.native, 0);
      }
      assert.equal(state.grants, 0);
    });
  }
});

test('knowledge revision uses original MCP metadata and two fresh PEP decisions', async t => {
  const { state, args, revision, invoke } = await fixture(t);
  const response = await invoke();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { nativeObjectRef: args.nativeObjectRef, nativeRevision: revision });
  assert.equal(state.peps, 2);
  assert.deepEqual(state.methods, ['read_document']);
});

test('service file import preserves its distinct read batch operation, binary bytes and read-only native observation',async t=>{
  for (const operation of ['execute','observe']) for (const mode of ['ok','queued','unknown','corrupt','revoke','foreign-operation','native-operation']) {
    if (operation==='observe' && ['corrupt','foreign-operation','native-operation'].includes(mode)) continue;
    await t.test(`${operation}/${mode}`,async nested=>{
      const {state,invoke,reference}=await fixture(nested,mode,'knowledge.ingest@v1',operation);
      const response=await invoke();
      const result=await response.json();
      if (['corrupt','revoke','foreign-operation','native-operation'].includes(mode)) {
        assert.notEqual(response.status,200);
        if (operation==='execute') assert.equal(state.native,mode==='native-operation'?1:0);
      } else {
        assert.equal(response.status,200);
        const observed=operation==='execute'?result.execution:result;
        assert.equal(observed.platformStatus,mode==='ok'?'SUCCEEDED':mode==='queued'?'RUNNING':'UNKNOWN');
        assert.equal(observed.terminalAt!==undefined,mode==='ok');
        assert.equal(state.receipts.length,mode==='ok'?1:0);
        if (operation==='execute' && mode==='ok') assert.notEqual(result.contentReference.resourceId,reference.resourceId);
      }
      assert.equal(state.grants,operation==='execute'?1:0);
      assert.equal(state.downloads,operation==='execute'?1:0);
      assert.deepEqual(state.methods,operation==='execute' && ['corrupt','revoke','foreign-operation'].includes(mode)?[]:['add_document']);
    });
  }
});

test('receiver bills only original completed parsing and exact persisted read-batch evidence',async t=>{
  for (const mode of ['ok','queued','unknown','no-source-evidence','receipt-unavailable','receipt-mismatch']) {
    await t.test(mode,async nested=>{
      const {state,invoke}=await fixture(nested,mode,'knowledge.ingest@v1','extract_usage');
      const response=await invoke();
      assert.equal(response.status,mode==='ok'?200:503);
      assert.equal(state.grants,0); assert.equal(state.downloads,0);
      assert.deepEqual(state.methods,['add_document']);
      if (mode==='ok') {
        const value=await response.json();
        assert.deepEqual(value.measurements.map(({meterKey,quantity})=>({meterKey,quantity})),[
          {meterKey:'native_import_count',quantity:1},{meterKey:'native_import_bytes',quantity:4}]);
        assert.equal(value.measurements[0].occurredAt,state.receipts[0].completedAt);
      } else if (['queued','unknown','no-source-evidence'].includes(mode)) assert.equal(state.receipts.length,0);
    });
  }
});

test('source endpoint retains its Core-controlled reverse proxy path',async t=>{
  const {state,invoke}=await fixture(t,'prefixed','knowledge.ingest@v1','execute');
  const response=await invoke();
  assert.equal(response.status,200);
  assert.equal((await response.json()).execution.platformStatus,'SUCCEEDED');
  assert.equal(state.downloads,1);
  assert.deepEqual(state.methods,['add_document']);
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

test('knowledge v2 keeps every original native action and does not rewrite the signed action key',async t=>{
  for (const operation of ['read','export','ingest','delete']) {
    await t.test(operation,async nested=>{
      const {invoke,state}=await fixture(nested,'ok',`knowledge.${operation}@v2`);
      const answer=await invoke();
      assert.equal(answer.status,200);
      assert.equal((await answer.json()).execution.platformStatus,'SUCCEEDED');
      assert.ok(state.native>0);
      assert.ok(state.peps>0);
    });
  }
  await t.test('unknown version remains denied',async nested=>{
    const {invoke,state}=await fixture(nested,'ok','knowledge.read@v3');
    assert.equal((await invoke()).status,401);
    assert.equal(state.native,0);
  });
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
