import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { canonical, createAdapter, queryDigest } from '../src/query-revision.mjs';

const ids = Array.from({ length: 12 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
const args = { idempotencyKey: 'same-original-query', nativeObjectRef: ids[3] };

test('original HUMAN PAT observe/cancel use metadata only and the same scoped UUID', async (t) => {
  const argumentsValue = { protocolSessionId: ids[7], nativeObjectRef: ids[3], idempotencyKey: ids[7] };
  for (const operation of ['observe', 'cancel']) {
    await t.test(operation, async (nested) => {
      const { state, invoke } = await setup(nested, { arguments: argumentsValue, operation, human: true });
      const answer = await invoke({ path: `/platform-adapter/v1/${operation}` });
      assert.equal(answer.status, 200);
      assert.deepEqual(await answer.json(), { protocolSessionId: ids[7], nativeObjectRef: ids[3], nativeState: 'ABSENT' });
      assert.equal(state.peps, 2);
      assert.deepEqual(state.nativeReads, [`/v2/auth/token/document/${ids[7]}/${ids[3]}`]);
      assert.equal(state.queries.length, 0);
    });
  }
});

test('PAT unknown, extra secret fields or unconfirmed DELETE are never absence', async (t) => {
  const argumentsValue = { protocolSessionId: ids[7], nativeObjectRef: ids[3], idempotencyKey: ids[7] };
  for (const change of [
    { operation: 'observe', nativeStatus: 503 },
    { operation: 'observe', nativeObservation: { protocolSessionId: ids[7], nativeObjectRef: ids[3], nativeState: 'ABSENT', accessToken: 'must-not-disclose' } },
    { operation: 'cancel', nativeObservation: { protocolSessionId: ids[7], nativeObjectRef: ids[3], nativeState: 'ACTIVE',
      nativeSessionRef: ids[7], expiresAt: new Date(Date.now() + 60000).toISOString() } },
  ]) {
    await t.test(change.operation, async (nested) => {
      const { invoke } = await setup(nested, { arguments: argumentsValue, human: true, ...change });
      const answer = await invoke({ path: `/platform-adapter/v1/${change.operation}` });
      assert.equal(answer.status, 503);
      assert.deepEqual(await answer.json(), { error: 'adapter request refused' });
    });
  }
});

test('an Agent or unavailable original-ref PEP cannot use PAT lifecycle', async (t) => {
  const argumentsValue = { protocolSessionId: ids[7], nativeObjectRef: ids[3], idempotencyKey: ids[7] };
  const agent = await setup(t, { arguments: argumentsValue, operation: 'cancel' });
  assert.equal((await agent.invoke({ path: '/platform-adapter/v1/cancel' })).status, 401);
  assert.equal(agent.state.nativeReads.length, 0);
  const denied = await setup(t, { arguments: argumentsValue, operation: 'cancel', human: true,
    pep: (_state, response) => reply(response, 403, {}) });
  assert.equal((await denied.invoke({ path: '/platform-adapter/v1/cancel' })).status, 503);
  assert.equal(denied.state.nativeReads.length, 0);
});

test('original accepted save verifies its exact historical VersionId, never another head', async (t) => {
  const writeObservation = { phase: 'ACCEPTED', correlationRef: 'original-write', editors: 'human',
    baseModifiedAt: '2026-10-05T00:00:00Z', bytesWritten: 7, nativeEtag: 'accepted-native-etag', resultRevision: 'accepted-version' };
  const argumentsValue = { idempotencyKey: ids[7], nativeObjectRef: ids[3],
    protocolReconcile: { protocolSessionId: ids[7], baseRevision: 'original-base', writeObservation } };
  const versions = { Versions: [{ VersionId: 'different-current-head', IsHead: true, Size: '123', ETag: 'later' },
    { VersionId: 'accepted-version', Size: '7', ETag: 'accepted-native-etag' }] };
  const { state, invoke } = await setup(t, { arguments: argumentsValue, human: true, versions });
  const answer = await invoke();
  assert.equal(answer.status, 200);
  assert.deepEqual(await answer.json(), { nativeObjectRef: ids[3], nativeRevision: 'accepted-version',
    protocolSessionId: ids[7], correlationRef: 'original-write' });
  assert.equal(state.peps, 2);
  for (const version of [{ VersionId: 'accepted-version', Size: '7', ETag: 'other' },
    { VersionId: 'accepted-version', Size: '8', ETag: 'accepted-native-etag' },
    { VersionId: 'different', Size: '7', ETag: 'accepted-native-etag', IsHead: true },
    { VersionId: 'accepted-version', Size: '7', ETag: 'accepted-native-etag', Draft: true }]) {
    await t.test('mismatching native writer evidence', async (nested) => {
      const fixture = await setup(nested, { arguments: argumentsValue, human: true, versions: { Versions: [version] } });
      assert.equal((await fixture.invoke()).status, 503);
    });
  }
});

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
  const requestArguments = changes.arguments ?? args;
  const operation = changes.operation ?? 'query_revision';
  const directory = await mkdtemp(join(tmpdir(), 'file-storage-adapter-'));
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwksFile = join(directory, 'jwks.json');
  const nativeSecret = randomBytes(32).toString('hex');
  const oidcSecret = randomBytes(32).toString('hex');
  await writeFile(jwksFile, JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test-current', alg: 'ES256', use: 'sig' }] }), { mode: 0o600 });
  await writeFile(join(directory, 'native-credential'), nativeSecret, { mode: 0o600 });
  await writeFile(join(directory, 'oidc-credential'), oidcSecret, { mode: 0o600 });
  const state = { peps: 0, nativeReads: [], queries: [], redirectReads: 0, receipts: [] };
  const root = { Uuid: ids[2], Type: 'COLLECTION', Path: 'documents/root', ContextWorkspace: { Uuid: ids[1] } };
  const target = { Uuid: ids[3], Type: 'LEAF', Path: 'documents/root/file.txt', ContextWorkspace: { Uuid: ids[1] } };
  const versions = { Versions: [{ VersionId: 'older', MTime: '999999', IsHead: false },
    { VersionId: 'head-native-version', IsHead: true, PreSignedGET: { Url: 'must-not-disclose' }, ContentHash: 'not-a-revision' }] };
  const upstream = createServer(async (request, response) => {
    if (request.url === '/hosting/discovery') {
      state.discoveryReads = (state.discoveryReads ?? 0) + 1;
      response.writeHead(changes.discoveryStatus ?? 200, { 'content-type': 'application/xml' });
      return response.end(changes.discovery ?? `<wopi-discovery><net-zone name="external-http"><app name="word">
        <action ext="docx" name="edit" urlsrc="${origin}/hosting/wopi/word/edit?&lt;thm=THEME_ID&amp;&gt;&lt;ui=UI_LLCC&amp;&gt;"/>
        <action ext="docx" name="view" urlsrc="${origin}/hosting/wopi/word/view?&lt;thm=THEME_ID&amp;&gt;&lt;ui=UI_LLCC&amp;&gt;"/>
      </app></net-zone></wopi-discovery>`);
    }
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
      assert.equal(parsed.operation, operation);
      assert.deepEqual(JSON.parse(parsed.argumentsJson), requestArguments);
      if (changes.pep) return changes.pep(state, response, parsed);
      return reply(response, 200, { actionExecutionId: ids[7], operationId: ids[6], authorizationMinZedToken: `fresh-${state.peps}` });
    }
    if (request.url === '/service/v1/adapter/read_receipt') {
      assert.equal(request.headers.authorization,'Bearer ephemeral-fixture-oidc');
      let body=''; for await (const chunk of request) body+=chunk;
      const receipt=JSON.parse(body); state.receipts.push(receipt);
      assert.equal(state.peps,2);
      if (changes.receiptStatus) return reply(response,changes.receiptStatus,{});
      return reply(response,200,{operationId:receipt.operationId,
        receiptDigest:changes.wrongReceipt?'wrong':createHash('sha256').update(canonical(receipt)).digest('hex')});
    }
    if (request.url === '/redirect-target') {
      state.redirectReads += 1;
      return reply(response, 200, versions);
    }
    if (request.url === '/native-bytes?versionId=frozen-version' && changes.serviceRead) {
      assert.equal(request.headers.authorization, undefined);
      state.downloads = (state.downloads ?? 0) + 1;
      response.writeHead(200, {'content-type':'application/octet-stream'});
      response.end(Buffer.from([0,255,1,254]));
      return;
    }
    assert.equal(request.headers.authorization, `Bearer ${nativeSecret}`);
    state.nativeReads.push(request.url);
    if (changes.serviceList && request.url === `/v2/n/node/${ids[2]}?Flags=WithMetaDefaults`) {
      state.rootReads=(state.rootReads??0)+1;
      if (changes.rootAfter && state.rootReads >= (changes.rootAfterRead ?? 2)) return reply(response,200,changes.rootAfter);
      return reply(response,200,changes.root ?? {...root,FolderMeta:[{Namespace:'ChildrenCount',Value:1}]});
    }
    if (changes.serviceList && request.url === `/v2/n/node/${ids[3]}?Flags=WithMetaDefaults`) {
      return reply(response,200,changes.target ?? {...target,ContentType:'text/plain'});
    }
    if (changes.serviceList && request.url === '/v2/n/nodes') {
      let body=''; for await (const chunk of request) body+=chunk;
      assert.deepEqual(JSON.parse(body),{Scope:{Root:{Uuid:ids[2]},Recursive:false},Offset:0,Limit:0,Flags:['WithMetaDefaults']});
      state.listings=(state.listings??0)+1;
      return reply(response,changes.listStatus??200,changes.listResponse ?? {Nodes:[changes.target ?? {...target,ContentType:'text/plain'}]});
    }
    if (request.url === '/v2/auth/token/document') {
      assert.equal(request.method, 'POST');
      let body = '';
      for await (const chunk of request) body += chunk;
      state.patCreates = [...(state.patCreates ?? []), JSON.parse(body)];
      response.setHeader('x-kailo-native-session-ref', changes.nativeSessionRef ?? ids[7]);
      return reply(response, changes.nativeStatus ?? 200, { AccessToken: 'one-native-pat-fixture' });
    }
    if (request.url === `/v2/auth/token/document/${ids[7]}/${ids[3]}`) {
      assert.equal(request.method, operation === 'cancel' ? 'DELETE' : 'GET');
      return reply(response, changes.nativeStatus ?? 200, changes.nativeObservation ?? {
        protocolSessionId: ids[7], nativeObjectRef: ids[3], nativeState: 'ABSENT',
      });
    }
    if (request.url === `/v2/n/node/${ids[2]}?Flags=WithVersionsAll`) return reply(response, 200, changes.root ?? root);
    if (request.url === `/v2/n/node/${ids[3]}?Flags=WithVersionsAll`) return reply(response, 200, changes.target ?? target);
    if (request.url === `/v2/n/node/${ids[10]}?Flags=WithVersionsAll`) return reply(response, 200, changes.authorized ?? {
      Uuid: ids[10], Type: 'COLLECTION', Path: 'documents/root/authorized', ContextWorkspace: { Uuid: ids[1] },
    });
    if (request.url === `/v2/n/node/${ids[3]}/versions`) {
      assert.equal(request.method, 'POST');
      let body = '';
      for await (const chunk of request) body += chunk;
      state.queries.push(JSON.parse(body));
      if (changes.redirect) { response.writeHead(302, { location: '/redirect-target' }); return response.end(); }
      return reply(response, changes.nativeStatus ?? 200, changes.versions ?? (changes.serviceList
        ? {Versions:[{VersionId:changes.changeDuringList && state.listings>1?'changed-version':'frozen-version',IsHead:true}]}
        : changes.serviceRead
        ? {Versions:[{VersionId:'frozen-version',Size:'4',PreSignedGET:{Url:`${origin}/native-bytes?versionId=frozen-version`}}]}
        : versions));
    }
    return reply(response, 404, {});
  });
  const origin = await listen(upstream);
  const config = { bindingId: ids[0], tenantId: ids[4], workspaceId: ids[5], nativeWorkspaceId: ids[1], nativeRootRef: ids[2],
    cellsRestBaseUrl: `${origin}/v2`, cellsBearerFile: join(directory, 'native-credential'),
    actionTokenIssuer: `${origin}/issuer`, actionTokenAudience: 'file-storage-private-adapter', actionTokenJwksFile: jwksFile,
    corePepUrl: `${origin}/service/v1/adapter/pep_check`, oidcTokenUrl: `${origin}/oidc/token`, oidcClientId: 'binding-client',
    oidcClientSecretFile: join(directory, 'oidc-credential'), timeoutMs: 3000, maxBodyBytes: 65536, listenHost: '127.0.0.1', listenPort: 1,
    ...(changes.documentLaunch ? { documentLaunch: { cellsPublicOrigin: origin, documentServerOrigin: origin } } : {}),
    ...(changes.serviceRead || changes.serviceList ? {readEdge:{downloadOrigin:origin,
      ...(changes.usageMeasurements ? {usageMeasurements:changes.usageMeasurements}:{})}} : {}) };
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
      authorization_min_zed_token: 'original', normalized_parameter_hash: createHash('sha256')
        .update(canonical({ operation, arguments: requestArguments })).digest('hex'),
      ...(changes.human ? { actor_principal_id: ids[9], agent_principal_id: undefined,
        action_key: 'file_storage.open_edit@v1', delegation_id: undefined, delegation_version: undefined,
        result_exposure_policy_id: undefined, result_exposure_policy_version: undefined } : {}),
      ...(changes.serviceRead || changes.serviceList ? {action_key:changes.serviceList?'file_storage.list@v1':'file_storage.read@v1',agent_principal_id:undefined,
        initiating_human_principal_id:undefined,delegation_id:undefined,delegation_version:undefined,
        result_exposure_policy_id:undefined,result_exposure_policy_version:undefined,idempotency_key:ids[7],
        normalized_parameter_hash:createHash('sha256').update(canonical(requestArguments)).digest('hex')} : {}), ...change };
    const encodedHeader = Buffer.from(JSON.stringify({ alg: 'ES256', kid: 'test-current', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signature = sign('sha256', Buffer.from(`${encodedHeader}.${payload}`), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    return `${encodedHeader}.${payload}.${signature}`;
  }
  async function invoke(options = {}) {
    return fetch(`${adapterOrigin}${options.path ?? '/platform-adapter/v1/query_revision'}`, {
      method: 'POST', headers: { authorization: `Bearer ${options.token ?? token()}`, 'content-type': 'application/json',
        'idempotency-key': options.key ?? requestArguments.idempotencyKey }, body: options.raw ?? canonical(requestArguments),
    });
  }
  return { state, token, invoke, target };
}

test('SERVICE source read returns exact binary version only after both fresh permission checks', async (t) => {
  const argumentsValue={targetType:'RESOURCE',targetId:ids[10],authorizationTargetNativeRef:ids[2],
    input:{resourceId:ids[10],nativeObjectRef:ids[3],nativeRevision:'frozen-version',displayName:'file.bin',mediaType:'application/octet-stream'}};
  const request={actionKey:'file_storage.read@v1',idempotencyKey:ids[7],arguments:argumentsValue};
  const fixture=await setup(t,{operation:'execute',arguments:argumentsValue,serviceRead:true});
  const result=await fixture.invoke({path:'/platform-adapter/v1/execute',key:ids[7],raw:canonical(request)});
  assert.equal(result.status,200);
  assert.deepEqual(Buffer.from(await result.arrayBuffer()),Buffer.from([0,255,1,254]));
  assert.equal(result.headers.get('x-kailo-native-revision'),'frozen-version');
  assert.equal(result.headers.get('x-kailo-content-sha256'),createHash('sha256').update(Buffer.from([0,255,1,254])).digest('hex'));
  assert.equal(fixture.state.peps,2);
  assert.equal(fixture.state.downloads,1);
  assert.equal(result.headers.get('location'),null);
  assert.equal(fixture.state.receipts.length,1);
  assert.equal(fixture.state.receipts[0].role,'SOURCE');
  assert.equal(fixture.state.receipts[0].contentBytes,4);
  assert.equal(fixture.state.receipts[0].nativeObjectRef,ids[3]);
  assert.deepEqual(fixture.state.receipts[0].measurements,[]);
  const denied=await setup(t,{operation:'execute',arguments:argumentsValue,serviceRead:true,
    pep:(state,response)=>reply(response,state.peps===2?403:200,{actionExecutionId:ids[7],operationId:ids[6],authorizationMinZedToken:'fresh'})});
  const revoked=await denied.invoke({path:'/platform-adapter/v1/execute',key:ids[7],raw:canonical(request)});
  assert.equal(revoked.status,503);
  assert.deepEqual(await revoked.json(),{error:'adapter request refused'});
  assert.equal(denied.state.downloads,1);
  assert.equal(denied.state.receipts.length,0);
  for (const change of [{initiating_human_principal_id:ids[9]},{idempotency_key:ids[8]},{tenant_id:ids[8]}]) {
    const refused=await fixture.invoke({path:'/platform-adapter/v1/execute',key:ids[7],raw:canonical(request),token:fixture.token(change)});
    assert.equal(refused.status,401);
  }
});

test('source bytes require the exact persisted receipt acknowledgment and actual native measurements',async t=>{
  const argumentsValue={targetType:'RESOURCE',targetId:ids[10],authorizationTargetNativeRef:ids[2],
    input:{resourceId:ids[10],nativeObjectRef:ids[3],nativeRevision:'frozen-version',displayName:'file.bin',mediaType:'application/octet-stream'}};
  const request={actionKey:'file_storage.read@v1',idempotencyKey:ids[7],arguments:argumentsValue};
  for (const change of [{},{wrongReceipt:true},{receiptStatus:503}]) {
    await t.test(JSON.stringify(change),async nested=>{
      const item=await setup(nested,{operation:'execute',arguments:argumentsValue,serviceRead:true,...change,
        usageMeasurements:[{meterKey:'native_read_count',quantitySource:'COUNT'},{meterKey:'native_read_bytes',quantitySource:'CONTENT_BYTES'}]});
      const result=await item.invoke({path:'/platform-adapter/v1/execute',key:ids[7],raw:canonical(request)});
      assert.equal(result.status,Object.keys(change).length?503:200);
      assert.deepEqual(item.state.receipts[0].measurements,[{meterKey:'native_read_count',quantity:1},{meterKey:'native_read_bytes',quantity:4}]);
      if (result.status!==200) assert.deepEqual(await result.json(),{error:'adapter request refused'});
    });
  }
});

test('SERVICE directory discovery uses counted complete native listings and exact version heads', async (t) => {
  const argumentsValue={targetType:'RESOURCE',targetId:ids[10],authorizationTargetNativeRef:ids[2],input:{resourceId:ids[10]}};
  const request={actionKey:'file_storage.list@v1',idempotencyKey:ids[7],arguments:argumentsValue};
  const fixture=await setup(t,{operation:'execute',arguments:argumentsValue,serviceList:true});
  const response=await fixture.invoke({path:'/platform-adapter/v1/execute',key:ids[7],raw:canonical(request)});
  assert.equal(response.status,200);
  const raw=await response.text();
  const result=JSON.parse(raw);
  assert.equal(raw,canonical(result));
  assert.deepEqual(result.items,[{resourceId:ids[10],nativeObjectRef:ids[3],nativeRevision:'frozen-version',displayName:'file.txt',mediaType:'text/plain'}]);
  const encoded=canonical(result.items);
  assert.equal(result.listingDigest,createHash('sha256').update(encoded).digest('hex'));
  assert.equal(fixture.state.listings,2);
  assert.equal(fixture.state.peps,2);
  assert.equal(fixture.state.receipts.length,1);
  assert.equal(fixture.state.receipts[0].nativeObjectRef,ids[2]);
  assert.equal(fixture.state.receipts[0].nativeRevision,result.listingDigest);
  assert.equal(fixture.state.receipts[0].contentBytes,Buffer.byteLength(encoded));
  assert.equal(JSON.stringify(result).includes('PreSigned'),false);
});

test('SERVICE directory discovery cannot report partial, hidden, changed or unauthorized items as a deletion set', async (t) => {
  const argumentsValue={targetType:'RESOURCE',targetId:ids[10],authorizationTargetNativeRef:ids[2],input:{resourceId:ids[10]}};
  const request={actionKey:'file_storage.list@v1',idempotencyKey:ids[7],arguments:argumentsValue};
  for (const changes of [
    {listStatus:503}, {listResponse:{Nodes:[]}}, {changeDuringList:true},
    {target:{Uuid:ids[3],Type:'LEAF',Path:'other/root/secret.txt',ContentType:'text/plain'}},
    {target:{Uuid:ids[3],Type:'LEAF',Path:'documents/root/file.txt',ContentType:'text/plain',Mode:'NodeWriteOnly'}},
    {versions:{Versions:[{VersionId:'unknown-head'}]}},
    {pep:(state,response)=>state.peps===1 ? reply(response,200,{actionExecutionId:ids[7],operationId:ids[6],authorizationMinZedToken:'fresh'}) : reply(response,403,{})},
  ]) {
    await t.test(Object.keys(changes)[0],async nested=>{
      const fixture=await setup(nested,{operation:'execute',arguments:argumentsValue,serviceList:true,...changes});
      const response=await fixture.invoke({path:'/platform-adapter/v1/execute',key:ids[7],raw:canonical(request)});
      assert.notEqual(response.status,200);
      assert.deepEqual(await response.json(),{error:'adapter request refused'});
      assert.equal(fixture.state.receipts.length,0);
    });
  }
});

test('SERVICE discovery consumes the native omitted empty collection without inventing a missing-item set', async (t) => {
  const argumentsValue={targetType:'RESOURCE',targetId:ids[10],authorizationTargetNativeRef:ids[2],input:{resourceId:ids[10]}};
  const request={actionKey:'file_storage.list@v1',idempotencyKey:ids[7],arguments:argumentsValue};
  const root={Uuid:ids[2],Type:'COLLECTION',Path:'documents/root',ContextWorkspace:{Uuid:ids[1]},FolderMeta:[{Namespace:'ChildrenCount'}]};
  for (const listResponse of [{},{Pagination:{}},{Nodes:[]},{Facets:[]}]) {
    await t.test(JSON.stringify(listResponse),async nested=>{
      const fixture=await setup(nested,{operation:'execute',arguments:argumentsValue,serviceList:true,root,listResponse});
      const response=await fixture.invoke({path:'/platform-adapter/v1/execute',key:ids[7],raw:canonical(request)});
      assert.equal(response.status,200);
      const result=await response.json();
      assert.deepEqual(result.items,[]);
      assert.equal(result.listingDigest,createHash('sha256').update('[]').digest('hex'));
      assert.equal(fixture.state.listings,2);
      assert.equal(fixture.state.peps,2);
      assert.equal(fixture.state.receipts.length,1);
      assert.equal(fixture.state.receipts[0].contentBytes,2);
      assert.equal(fixture.state.receipts[0].nativeRevision,result.listingDigest);
      assert.equal(fixture.state.nativeReads.some(path=>path.endsWith('/versions')),false);
    });
  }
  for (const change of [
    {root:{...root,FolderMeta:[{Namespace:'ChildrenCount',Value:1}]}},
    {rootAfter:{...root,FolderMeta:[{Namespace:'ChildrenCount',Value:1}]}},
    {root:{...root,FolderMeta:[]}},
    {root:{...root,FolderMeta:[{Namespace:'ChildrenCount',Value:null}]}},
    {root:{...root,FolderMeta:[{Namespace:'ChildrenCount',Value:'0'}]}},
    {listResponse:{Nodes:null}}, {listResponse:{Nodes:{}}},
    {listResponse:{Facets:null}}, {listResponse:{Facets:['unexpected filtered result']}},
    {listResponse:{error:'not a native collection'}},
    {listResponse:{Pagination:null}}, {listResponse:{Pagination:'invalid'}},
    {listResponse:{Pagination:{Total:null}}}, {listResponse:{Pagination:{NextOffset:null}}},
    {listResponse:{Pagination:{CurrentOffset:null}}},
    {listResponse:{Pagination:{Total:1}}}, {listResponse:{Pagination:{NextOffset:1}}},
    {pep:(state,response)=>state.peps===1 ? reply(response,200,{actionExecutionId:ids[7],operationId:ids[6],authorizationMinZedToken:'fresh'}) : reply(response,403,{})},
  ]) {
    await t.test(`refuse ${Object.keys(change)[0]} ${JSON.stringify(change)}`,async nested=>{
      const fixture=await setup(nested,{operation:'execute',arguments:argumentsValue,serviceList:true,root,listResponse:{},...change});
      const response=await fixture.invoke({path:'/platform-adapter/v1/execute',key:ids[7],raw:canonical(request)});
      assert.notEqual(response.status,200);
      assert.equal(fixture.state.receipts.length,0);
    });
  }
});

test('SERVICE empty discovery refuses native root changes at the final traversal read', async (t) => {
  const argumentsValue={targetType:'RESOURCE',targetId:ids[10],authorizationTargetNativeRef:ids[2],input:{resourceId:ids[10]}};
  const request={actionKey:'file_storage.list@v1',idempotencyKey:ids[7],arguments:argumentsValue};
  const root={Uuid:ids[2],Type:'COLLECTION',Path:'documents/root',ContextWorkspace:{Uuid:ids[1]},FolderMeta:[{Namespace:'ChildrenCount'}]};
  for (const change of [{IsDraft:true},{IsRecycled:true},{IsRecycleBin:true},{Type:'LEAF'},{ContextWorkspace:undefined}]) {
    await t.test(JSON.stringify(change),async nested=>{
      const fixture=await setup(nested,{operation:'execute',arguments:argumentsValue,serviceList:true,
        root,listResponse:{},rootAfterRead:4,rootAfter:{...root,...change}});
      const response=await fixture.invoke({path:'/platform-adapter/v1/execute',key:ids[7],raw:canonical(request)});
      assert.equal(fixture.state.rootReads,4);
      assert.equal(fixture.state.listings,2);
      assert.equal(response.status,503);
      assert.deepEqual(await response.json(),{error:'adapter request refused'});
      assert.equal(fixture.state.receipts.length,0);
    });
  }
});

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

test('HUMAN execute selects ONLYOFFICE native discovery and posts one scoped native PAT', async (t) => {
  for (const mode of ['VIEW', 'EDIT']) {
    await t.test(mode, async (nested) => {
      const input = { protocolSessionId: ids[7], reference: { nativeObjectRef: ids[3], nativeRevision: 'head-native-version' },
        authorizationTargetNativeRef: ids[10], admittedMode: mode, theme: 'DARK', locale: 'zh-CN',
        expiresAt: new Date(Date.now() + 60000).toISOString(), idempotencyKey: ids[7] };
      const fixture = await setup(nested, { operation: 'execute', arguments: input, human: true, documentLaunch: true,
        target: { Uuid: ids[3], Type: 'LEAF', Path: 'documents/root/authorized/report.docx', ContextWorkspace: { Uuid: ids[1] } } });
      const answer = await fixture.invoke({ path: '/platform-adapter/v1/execute',
        token: fixture.token({ action_key: mode === 'EDIT' ? 'file_storage.open_edit@v1' : 'file_storage.open_view@v1' }) });
      assert.equal(answer.status, 200);
      const result = await answer.json();
      assert.equal(result.execution.nativeId, ids[7]);
      const descriptor = JSON.parse(result.resultJson).launchDescriptor;
      const action = new URL(descriptor.actionUrl);
      assert.equal(action.pathname, `/hosting/wopi/word/${mode.toLowerCase()}`);
      assert.equal(action.origin, descriptor.editorOrigin);
      assert.equal(action.searchParams.get('thm'), '2');
      assert.equal(action.searchParams.get('lang'), 'zh-CN');
      assert.equal(action.searchParams.get('ui'), 'zh-CN');
      assert.equal(action.searchParams.get('dchat'), '1');
      assert.equal(action.searchParams.get('usid'), ids[7]);
      assert.equal(new URL(action.searchParams.get('wopisrc')).pathname, `/wopi/files/${ids[3]}`);
      assert.equal(action.searchParams.has('access_token'), false);
      assert.deepEqual(descriptor.formFields, { access_token: 'one-native-pat-fixture', access_token_ttl: String(Date.parse(input.expiresAt)) });
      assert.equal(fixture.state.peps, 2);
      assert.equal(fixture.state.discoveryReads, 1);
      assert.deepEqual(fixture.state.patCreates, [{ Path: 'documents/root/authorized/report.docx', ClientID: ids[7] }]);
    });
  }
});

test('ONLYOFFICE disclosure rejects a changed editor origin or unconfirmed PAT reference', async (t) => {
  const input = { protocolSessionId: ids[7], reference: { nativeObjectRef: ids[3], nativeRevision: 'head-native-version' },
    authorizationTargetNativeRef: ids[10], admittedMode: 'EDIT', theme: 'LIGHT', locale: 'en',
    expiresAt: new Date(Date.now() + 60000).toISOString(), idempotencyKey: ids[7] };
  for (const change of [{ discovery: '<wopi-discovery><net-zone><app><action ext="docx" name="edit" urlsrc="https://unregistered.invalid/hosting/wopi/word/edit"/></app></net-zone></wopi-discovery>' },
    { nativeSessionRef: ids[0] }]) {
    await t.test(Object.keys(change)[0], async (nested) => {
      const fixture = await setup(nested, { operation: 'execute', arguments: input, human: true, documentLaunch: true,
        target: { Uuid: ids[3], Type: 'LEAF', Path: 'documents/root/authorized/report.docx', ContextWorkspace: { Uuid: ids[1] } }, ...change });
      assert.equal((await fixture.invoke({ path: '/platform-adapter/v1/execute' })).status, 503);
      assert.equal(fixture.state.patCreates?.length ?? 0, change.discovery ? 0 : 1);
    });
  }
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
  assert.equal((await invoke({ path: '/platform-adapter/v1/execute' })).status, 503);
  assert.equal(state.peps, 4);
});

test('general Resource queries resolve signed authorization root before disclosing its native descendant head', async (t) => {
  const requestArguments = { authorizationTargetNativeRef: ids[10], ...args };
  const { state, invoke } = await setup(t, { arguments: requestArguments,
    target: { Uuid: ids[3], Type: 'LEAF', Path: 'documents/root/authorized/nested/file.txt', ContextWorkspace: { Uuid: ids[1] } } });
  const response = await invoke();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { nativeObjectRef: ids[3], nativeRevision: 'head-native-version' });
  assert.equal(state.peps, 2);
  assert.equal(state.nativeReads.length, 4);
});

test('binding-wide scope cannot substitute for the original authorized Resource subtree', async (t) => {
  const authorized = { Uuid: ids[10], Type: 'COLLECTION', Path: 'documents/root/authorized', ContextWorkspace: { Uuid: ids[1] } };
  const requestArguments = { authorizationTargetNativeRef: ids[10], ...args };
  for (const change of [
    { target: { Uuid: ids[3], Type: 'LEAF', Path: 'documents/root/authorized-other/file.txt', ContextWorkspace: { Uuid: ids[1] } } },
    { authorized: { ...authorized, Path: 'documents/foreign' } },
    { authorized: { ...authorized, ContextWorkspace: { Uuid: ids[0] } } },
    { authorized: { ...authorized, IsRecycled: true } },
    { authorized: { ...authorized, Type: 'LEAF' } },
  ]) {
    await t.test(JSON.stringify(change), async (nested) => {
      const { state, invoke } = await setup(nested, { arguments: requestArguments, ...change });
      assert.notEqual((await invoke()).status, 200);
      assert.equal(state.queries.length, 0);
    });
  }
});

test('Asset scope never becomes a general subtree and authorization root is covered by token hash', async (t) => {
  const scoped = { authorizationTargetNativeRef: ids[10], ...args };
  const { state, token, invoke } = await setup(t, { arguments: scoped });
  assert.equal((await invoke({ token: token({ target_type: 'ASSET' }) })).status, 403);
  assert.equal(state.queries.length, 0);
  const mismatched = JSON.stringify({ ...scoped, authorizationTargetNativeRef: ids[2] });
  assert.equal((await invoke({ raw: mismatched })).status, 401);
  const exact = await setup(t, { arguments: { authorizationTargetNativeRef: ids[3], ...args } });
  assert.equal((await exact.invoke({ token: exact.token({ target_type: 'ASSET' }) })).status, 200);
});
