import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { canonical, configuration, createAdapter, queryDigest } from '../src/query-revision.mjs';

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
  let requestArguments = changes.arguments ?? args;
  const business = changes.businessList || changes.businessRead || changes.businessAction !== undefined;
  const businessAction = changes.businessAction ?? (changes.businessRead ? 'file_storage.read@v1' : 'file_storage.list@v1');
  const operation = changes.operation ?? 'query_revision';
  if (changes.readExecution === undefined) changes.readExecution = business && operation === 'execute'
    && ['file_storage.read@v1','file_storage.export@v1','file_storage.list_revisions@v1','file_storage.list@v1'].includes(businessAction);
  const directory = await mkdtemp(join(tmpdir(), 'file-storage-adapter-'));
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const gateway = changes.mcp ? generateKeyPairSync('ec', { namedCurve: 'prime256v1' }) : undefined;
  const jwksFile = join(directory, 'jwks.json');
  const nativeSecret = randomBytes(32).toString('hex');
  const oidcSecret = randomBytes(32).toString('hex');
  await writeFile(jwksFile, JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test-current', alg: 'ES256', use: 'sig' }] }), { mode: 0o600 });
  if (gateway) await writeFile(join(directory, 'gateway-jwks.json'), JSON.stringify({ keys: [
    { ...gateway.publicKey.export({ format: 'jwk' }), kid: 'test-current', alg: 'ES256', use: 'sig' },
  ] }), { mode: 0o600 });
  await writeFile(join(directory, 'native-credential'), nativeSecret, { mode: 0o600 });
  await writeFile(join(directory, 'oidc-credential'), oidcSecret, { mode: 0o600 });
  const state = { peps: 0, nativeReads: [], queries: [], redirectReads: 0, receipts: [] };
  const root = { Uuid: ids[2], Type: 'COLLECTION', Path: 'documents/root', ContextWorkspace: { Uuid: ids[1] } };
  const target = { Uuid: ids[3], Type: 'LEAF', Path: 'documents/root/file.txt', ContentType: 'text/plain', ContextWorkspace: { Uuid: ids[1] } };
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
      return reply(response, 200, { actionExecutionId: ids[7], operationId: ids[6], authorizationMinZedToken: `fresh-${state.peps}`,
        ...(business && operation === 'execute' ? {targetResource: {
          resourceId: ids[10], nativeType: changes.write ? 'node' : 'folder', nativeRef: changes.write ? ids[3] : ids[2],
          nativeInstanceRef: 'delivered-instance', nativeScopeRef: ids[1],
        }} : {}) });
    }
    if (request.url === '/service/v1/adapter/read_receipt') {
      assert.equal(request.headers.authorization,'Bearer ephemeral-fixture-oidc');
      let body=''; for await (const chunk of request) body+=chunk;
      const receipt=JSON.parse(body); state.receipts.push(receipt);
      assert.equal(state.peps,changes.serviceRead?3:2);
      await state.onReceipt?.();
      if (changes.receiptStatus) return reply(response,changes.receiptStatus,{});
      return reply(response,200,{operationId:receipt.operationId,
        receiptDigest:changes.wrongReceipt?'wrong':createHash('sha256').update(canonical(receipt)).digest('hex')});
    }
    if (request.url === '/redirect-target') {
      state.redirectReads += 1;
      return reply(response, 200, versions);
    }
    if (request.url === `/native-bytes?versionId=${changes.downloadRevision ?? 'frozen-version'}` && changes.serviceRead) {
      assert.equal(request.headers.authorization, undefined);
      if (changes.readExecution) {
        const proof = JSON.parse(Buffer.from(request.headers['x-kailo-native-execution'], 'base64url').toString('utf8'));
        assert.equal(proof.argumentsJson, canonical(requestArguments));
        assert.equal(request.headers['idempotency-key'], ids[7]);
      } else assert.equal(request.headers['x-kailo-native-execution'], undefined);
      state.downloads = (state.downloads ?? 0) + 1;
      await state.onDownload?.();
      if (changes.readExecution) {
        const bytes = changes.nativeBytes ?? Buffer.from([0,255,1,254]);
        state.nativeReadReceipt = {found:true, execution:{idempotencyKey:ids[7], nativeType:'node', nativeId:ids[3],
          platformStatus:'SUCCEEDED', cancelCapability:'UNSUPPORTED', lastObservedAt:'2026-10-09T00:00:00Z', terminalAt:'2026-10-09T00:00:00Z'},
          contentBytes:bytes.length, contentSha256:createHash('sha256').update(bytes).digest('hex'),
          contentReference:requestArguments.input,
          measurements:[{meterKey:'approved_read_count',quantity:1},{meterKey:'approved_read_bytes',quantity:bytes.length}]};
      }
      response.writeHead(200, {'content-type':'application/octet-stream'});
      response.end(changes.nativeBytes ?? Buffer.from([0,255,1,254]));
      return;
    }
    assert.equal(request.headers.authorization, `Bearer ${nativeSecret}`);
    state.nativeReads.push(request.url);
    if (business && (operation === 'execute' || changes.write || changes.readExecution)) {
      const proof = JSON.parse(Buffer.from(request.headers['x-kailo-native-execution'], 'base64url').toString('utf8'));
      assert.deepEqual(Object.keys(proof).sort(), ['actionToken','argumentsJson']);
      assert.equal(proof.argumentsJson, canonical(requestArguments));
      const actor = JSON.parse(Buffer.from(proof.actionToken.split('.')[1], 'base64url').toString('utf8'));
      const kind = actor.agent_principal_id === undefined ? 'HUMAN' : 'AGENT';
      assert.equal(actor.actor_principal_id, changes.businessHuman ? ids[9] : ids[8]);
      assert.equal(actor.action_key, businessAction);
      state.nativeActors = [...(state.nativeActors ?? []), {principal:actor.actor_principal_id,kind}];
      if (!changes.missingActorAck) response.setHeader('x-kailo-native-actor', changes.actorAck ??
        `${actor.tenant_id}:${ids[0]}:${kind}:${actor.actor_principal_id}`);
    } else assert.equal(request.headers['x-kailo-native-execution'], undefined);
    if (changes.readExecution && request.url === '/v2/jobs/user') {
      let raw = ''; for await (const chunk of request) raw += chunk;
      assert.equal(request.headers['x-kailo-native-operation'], operation);
      assert.equal(request.headers['idempotency-key'], ids[7]);
      assert.deepEqual(JSON.parse(raw), {JobIDs:['delivered-read-job'],LoadTasks:'Any'});
      state.readTaskQueries=(state.readTaskQueries??0)+1;
      const value = changes.readResult ? changes.readResult(state) : state.nativeReadReceipt ?? {found:false,
        execution:{idempotencyKey:ids[7], nativeType:'node', platformStatus:'UNKNOWN', cancelCapability:'UNSUPPORTED',lastObservedAt:'2026-10-09T00:00:00Z'}};
      return reply(response, changes.readTaskStatus ?? 200, value);
    }
    if (changes.write && (request.url === `/v2/n/node/${ids[3]}/versions/opaque-draft-v1/promote` || request.url === '/v2/jobs/user')) {
      let raw = ''; for await (const chunk of request) raw += chunk;
      if (operation === 'execute') {
        assert.equal(request.headers['idempotency-key'],ids[7]);
        assert.deepEqual(JSON.parse(raw),{Publish:false});
        state.promotions=(state.promotions??0)+1;
      } else {
        assert.equal(request.url,'/v2/jobs/user');
        assert.equal(request.headers['x-kailo-native-operation'],operation);
        assert.deepEqual(JSON.parse(raw),{JobIDs:['delivered-version-job'],LoadTasks:'Any'});
      }
      return reply(response,changes.nativeStatus??200,changes.writeResult??{
        execution:{idempotencyKey:ids[7],nativeType:'version',nativeId:'published-native-version',platformStatus:'SUCCEEDED',
          cancelCapability:'UNSUPPORTED',lastObservedAt:'2026-10-09T00:00:00Z',terminalAt:'2026-10-09T00:00:00Z'},
        contentReference:{resourceId:ids[10],nativeObjectRef:ids[3],nativeRevision:'published-native-version',displayName:'file.txt',mediaType:'text/plain'},contentBytes:0,
      });
    }
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
      const nativeTask=business && changes.readExecution;
      assert.deepEqual(JSON.parse(body),{Scope:{Root:{Uuid:ids[2]},Recursive:nativeTask?true:false},Offset:0,Limit:0,Flags:['WithMetaDefaults']});
      state.listings=(state.listings??0)+1;
      const value=changes.listResponse ?? {Nodes:[{...(changes.target ?? {...target,ContentType:'text/plain'}),
        ...(nativeTask?{Versions:[{VersionId:'frozen-version',IsHead:true}]}:{})}]};
      if (nativeTask) {
        assert.equal(request.headers['idempotency-key'],ids[7]);
        const bytes=Buffer.from(JSON.stringify(value));
        state.nativeReadReceipt={found:true,execution:{idempotencyKey:ids[7],nativeType:'node',nativeId:ids[2],
          platformStatus:'SUCCEEDED',cancelCapability:'UNSUPPORTED',lastObservedAt:'2026-10-09T00:00:00Z',terminalAt:'2026-10-09T00:00:00Z'},
          contentBytes:bytes.length,contentSha256:createHash('sha256').update(bytes).digest('hex'),
          measurements:[{meterKey:'approved_read_count',quantity:1},{meterKey:'approved_read_bytes',quantity:bytes.length}]};
      }
      return reply(response,changes.listStatus??200,value);
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
    if (request.url === `/v2/n/node/${ids[2]}?Flags=WithVersionsAll`) {
      await state.onNativeRoot?.();
      return reply(response, 200, changes.root ?? root);
    }
    if (request.url === `/v2/n/node/${ids[3]}?Flags=WithVersionsAll`) return reply(response, changes.nodeStatus ?? 200, changes.target ?? target);
    if (request.url === `/v2/n/node/${ids[10]}?Flags=WithVersionsAll`) return reply(response, 200, changes.authorized ?? {
      Uuid: ids[10], Type: 'COLLECTION', Path: 'documents/root/authorized', ContextWorkspace: { Uuid: ids[1] },
    });
    if (request.url === `/v2/n/node/${ids[3]}/versions`) {
      assert.equal(request.method, 'POST');
      let body = '';
      for await (const chunk of request) body += chunk;
      state.queries.push(JSON.parse(body));
      if (changes.redirect) { response.writeHead(302, { location: '/redirect-target' }); return response.end(); }
      const value = (typeof changes.versions === 'function' ? changes.versions(state) : changes.versions) ?? (changes.serviceList
        ? {Versions:[{VersionId:changes.changeDuringList && state.listings>1?'changed-version':'frozen-version',IsHead:true}]}
        : changes.serviceRead
        ? {Versions:[{VersionId:'frozen-version',
          ...(changes.omitVersionSize?{}:{Size:Object.hasOwn(changes,'versionSize')?changes.versionSize:'4'}),
          PreSignedGET:{Url:`${origin}/native-bytes?versionId=frozen-version`}}]}
        : versions);
      if (changes.readExecution && businessAction === 'file_storage.list_revisions@v1') {
        assert.equal(request.headers['idempotency-key'],ids[7]);
        const bytes=Buffer.from(JSON.stringify(value));
        state.nativeReadReceipt={found:true,execution:{idempotencyKey:ids[7],nativeType:'node',nativeId:ids[3],
          platformStatus:'SUCCEEDED',cancelCapability:'UNSUPPORTED',lastObservedAt:'2026-10-09T00:00:00Z',terminalAt:'2026-10-09T00:00:00Z'},
          contentBytes:bytes.length,contentSha256:createHash('sha256').update(bytes).digest('hex'),
          measurements:[{meterKey:'approved_read_count',quantity:1},{meterKey:'approved_read_bytes',quantity:bytes.length}]};
      }
      return reply(response,changes.nativeStatus??200,value);
    }
    return reply(response, 404, {});
  });
  const origin = await listen(upstream);
  const config = { bindingId: ids[0], tenantId: ids[4], workspaceId: ids[5], nativeWorkspaceId: ids[1], nativeRootRef: ids[2],
    ...(changes.management ? { management: changes.management } : {}),
    cellsRestBaseUrl: `${origin}/v2`, cellsBearerFile: join(directory, 'native-credential'),
    actionTokenIssuer: `${origin}/issuer`, actionTokenAudience: 'file-storage-private-adapter', actionTokenJwksFile: jwksFile,
    corePepUrl: `${origin}/service/v1/adapter/pep_check`, oidcTokenUrl: `${origin}/oidc/token`, oidcClientId: 'binding-client',
    oidcClientSecretFile: join(directory, 'oidc-credential'), timeoutMs: 3000, maxBodyBytes: 65536, listenHost: '127.0.0.1', listenPort: 1,
    ...(changes.documentLaunch ? { documentLaunch: { cellsPublicOrigin: origin, documentServerOrigin: origin } } : {}),
    ...(changes.serviceRead || changes.serviceList || changes.validation ? {readEdge:{downloadOrigin:origin,
      ...(changes.usageMeasurements ? {usageMeasurements:changes.usageMeasurements}:{})}} : {}) };
  const proofFiles = [];
  if (changes.write) config.write={nativeJobId:'delivered-version-job',usageMeasurements:[{meterKey:'approved_write_count',quantitySource:'COUNT'},{meterKey:'approved_write_bytes',quantitySource:'CONTENT_BYTES'}],...changes.writeConfig};
  if (changes.readExecution) config.readExecution={nativeJobId:'delivered-read-job',usageMeasurements:[{meterKey:'approved_read_count',quantitySource:'COUNT'},{meterKey:'approved_read_bytes',quantitySource:'CONTENT_BYTES'}],...changes.readExecutionConfig};
  let secretAgent;
  if (changes.validation) {
    const secretSocket = join(directory, 'agent.sock');
    state.secretReads = [];
    secretAgent = createServer((request, response) => {
      assert.equal(request.headers.authorization, undefined);
      assert.equal(request.headers['x-vault-token'], undefined);
      assert.equal(request.headers['x-vault-namespace'], `tenants/${ids[4]}`);
      const matching = proofFiles.find(({ entry }) => request.url === `/v1/kv/data/component/${entry.secretKey}?version=1`);
      if (!matching) return reply(response, 404, {});
      const requestId = state.duplicateSecretRead ? ids[8] : randomUUID();
      state.secretReads.push(requestId);
      reply(response, 200, { request_id: requestId, data: {
        metadata: { version: state.wrongSecretVersion ? 2 : 1, destroyed: false, deletion_time: '' },
        data: { credential: matching.value },
      } });
    });
    await new Promise((resolve, reject) => { secretAgent.once('error', reject); secretAgent.listen(secretSocket, resolve); });
    const secretDeliveries = [];
    for (const [name, value] of [['native', nativeSecret], ['oidc', oidcSecret]]) {
      const entry = { secretKey: name, locator: `tenants/${ids[4]}/kv/component/${name}`, version: 1,
        audience: `binding-${name}`, secretFile: join(directory, `${name}-credential`),
        secretSocket, secretValueKey: 'credential' };
      secretDeliveries.push(entry);
      proofFiles.push({ entry, value });
    }
    config.management = { componentReleaseId: ids[10], componentTypeKey: 'file_storage',
      artifactDigest: 'a'.repeat(64), protocolRange: '1', validation: {
        bindingVersion: 1, servicePrincipalId: ids[8], adapterServiceRef: 'delivered-adapter',
        nativeInstanceRef: 'delivered-instance', nativeScopeRef: ids[1], isolationMode: 'DEDICATED_INSTANCE',
        normalizedConfig: { nativeWorkspaceId: ids[1], nativeRootRef: ids[2] }, secretDeliveries,
        actionVersions: [{ actionKey: 'file_storage.read@v1', actionVersion: 1 },
          { actionKey: 'file_storage.list@v1', actionVersion: 1 },
          ...(changes.businessAction === undefined || ['file_storage.read@v1','file_storage.list@v1'].includes(changes.businessAction) ? [] : [{actionKey:changes.businessAction,actionVersion:1}])],
      } };
    const fixed = config.management.validation;
    if (!business) requestArguments = { bindingId: config.bindingId, bindingVersion: fixed.bindingVersion,
      tenantId: config.tenantId, workspaceId: config.workspaceId, componentReleaseId: config.management.componentReleaseId,
      servicePrincipalId: fixed.servicePrincipalId, adapterServiceRef: fixed.adapterServiceRef,
      nativeInstanceRef: fixed.nativeInstanceRef, nativeScopeRef: fixed.nativeScopeRef,
      isolationMode: fixed.isolationMode, normalizedConfig: fixed.normalizedConfig,
      configDigest: createHash('sha256').update(canonical(fixed.normalizedConfig)).digest('hex'),
      secretRefs: secretDeliveries.map(({ secretKey, locator, version, audience }) => ({ secretKey, locator, version, audience })),
      idempotencyKey: ids[7], ...changes.validationArguments };
  }
  if (changes.mcp) {
    const inputSchema = changes.businessAction === undefined
      ? {type:'object',additionalProperties:false,required:Object.keys(requestArguments.input),
      properties:Object.fromEntries(Object.keys(requestArguments.input).map(key => [key,{type:'string'}]))}
      : JSON.parse(await readFile(new URL(`../../../contracts/adapter/file_storage.v1/${businessAction.slice('file_storage.'.length,-3)}_input.schema.json`,
        import.meta.url),'utf8'));
    config.mcp = {path:'/mcp',gatewayIssuer:`${origin}/gateway-issuer`,gatewayAudience:config.actionTokenAudience,
      gatewayJwksFile:join(directory,'gateway-jwks.json'),gatewayCaller:'fixture-gateway',gatewayMaxTokenSeconds:61,
      tools:[{name:changes.businessAction === undefined ? (changes.businessRead ? 'approved-file-read' : 'approved-file-list') : 'approved-file-operation',
        actionKey:businessAction,actionVersion:1,
        inputSchema,inputSchemaDigest:createHash('sha256').update(canonical(inputSchema)).digest('hex')}]};
  }
  const adapter = createAdapter(config);
  const adapterOrigin = await listen(adapter);
  t.after(async () => {
    adapter.closeAllConnections(); upstream.closeAllConnections();
    if (secretAgent) {
      secretAgent.closeAllConnections();
      await new Promise(resolve => secretAgent.close(resolve));
    }
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
      ...(changes.management || changes.validation ? { actor_principal_id: ids[9], agent_principal_id: undefined,
        target_type: 'APPLICATION_BINDING', target_id: ids[0], action_key: 'application_binding.create',
        delegation_id: undefined, delegation_version: undefined,
        result_exposure_policy_id: undefined, result_exposure_policy_version: undefined } : {}),
      ...(changes.serviceRead || changes.serviceList ? {action_key:changes.serviceList?'file_storage.list@v1':'file_storage.read@v1',agent_principal_id:undefined,
        initiating_human_principal_id:undefined,delegation_id:undefined,delegation_version:undefined,
        result_exposure_policy_id:undefined,result_exposure_policy_version:undefined,idempotency_key:ids[7],
        normalized_parameter_hash:createHash('sha256').update(canonical(requestArguments)).digest('hex')} : {}),
      ...(business ? {actor_principal_id:changes.businessHuman ? ids[9] : ids[8],
        agent_principal_id:changes.businessHuman ? undefined : ids[8], initiating_human_principal_id:ids[9],
        target_type:'RESOURCE',target_id:ids[10],action_key:businessAction,
        delegation_id:changes.businessHuman ? undefined : ids[11], delegation_version:changes.businessHuman ? undefined : 1,
        result_exposure_policy_id:ids[9],result_exposure_policy_version:1,idempotency_key:ids[7],
        ...(changes.businessHuman || changes.write || changes.readExecution ? {external_execution_id:ids[8]} : {}),
        normalized_parameter_hash:createHash('sha256').update(canonical(operation==='execute'
          ? requestArguments : {operation,arguments:requestArguments})).digest('hex')} : {}), ...change };
    return signedClaims(claims,key);
  }
  function signedClaims(claims,key) {
    const encodedHeader = Buffer.from(JSON.stringify({ alg: 'ES256', kid: 'test-current', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signature = sign('sha256', Buffer.from(`${encodedHeader}.${payload}`), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    return `${encodedHeader}.${payload}.${signature}`;
  }
  function gatewayToken(change = {}, key = gateway.privateKey) {
    const now = Math.floor(Date.now()/1000);
    return signedClaims({iss:config.mcp.gatewayIssuer,aud:config.mcp.gatewayAudience,
      sub:config.mcp.gatewayCaller,azp:config.mcp.gatewayCaller,iat:now-1,exp:now+60,...change},key);
  }
  async function invoke(options = {}) {
    return fetch(`${adapterOrigin}${options.path ?? '/platform-adapter/v1/query_revision'}`, {
      method: 'POST', headers: { authorization: `Bearer ${options.token ?? token()}`, 'content-type': 'application/json',
        'idempotency-key': options.key ?? requestArguments.idempotencyKey }, body: options.raw ?? canonical(requestArguments),
    });
  }
  return { state, token, invoke, target, proofFiles, requestArguments, config, gatewayToken,
    adapterOrigin, privateKey };
}

test('native write executes the frozen opaque draft and only discloses a durable version reference',async t=>{
 for (const businessHuman of [false,true]) for (const mcp of [false,true]) await t.test(`${businessHuman?'HUMAN':'AGENT'} ${mcp?'SDK MCP':'HTTP'}`,async nested=>{
  const input={resourceId:ids[10],nativeObjectRef:canonical({nodeUuid:ids[3],publish:false}),nativeRevision:'opaque-draft-v1',displayName:'file.txt',mediaType:'text/plain'};
  const fixture=await setup(nested,{write:true,mcp,operation:'execute',validation:true,businessHuman,businessAction:'file_storage.write@v1',arguments:{target:{resourceId:ids[10]},input}});
  let result;
  if (mcp) {
   const {client,outgoing}=await mcpWireClient(nested,fixture);
   const listed=await client.listTools();assert.equal(listed.tools.length,1);
   outgoing.authorization=`Bearer ${fixture.token()}`;outgoing['idempotency-key']=ids[7];
   const called=await client.callTool({name:listed.tools[0].name,arguments:input});
   assert.deepEqual(called.content,[]);assert.equal(called.isError,false);result=called.structuredContent;
  } else {
   const response=await fixture.invoke({path:'/platform-adapter/v1/execute',key:ids[7],raw:canonical({actionKey:'file_storage.write@v1',idempotencyKey:ids[7],arguments:fixture.requestArguments})});
   assert.equal(response.status,200);result=await response.json();
  }
  assert.equal(result.execution.nativeType,'version');assert.equal(result.execution.platformStatus,'SUCCEEDED');
  assert.equal(result.execution.nativeId,'published-native-version');assert.equal(result.resultJson,'{}');
  assert.deepEqual(result.contentReference,{...input,nativeObjectRef:ids[3],nativeRevision:'published-native-version'});
  assert.equal(fixture.state.promotions,1);assert.equal(fixture.state.nativeReads.length,1);assert.equal(fixture.state.peps,2);
 });
});

test('native write observation and usage query original Task without replay, including empty file',async t=>{
 for (const operation of ['observe','extract_usage']) for (const businessHuman of [false,true]) await t.test(`${operation} ${businessHuman?'HUMAN':'AGENT'}`,async nested=>{
  const fixture=await setup(nested,{write:true,operation,validation:true,businessHuman,businessAction:'file_storage.write@v1',arguments:{externalExecutionId:ids[8],idempotencyKey:ids[7],nativeType:'version',nativeId:'published-native-version'}});
  const response=await fixture.invoke({path:`/platform-adapter/v1/${operation}`});assert.equal(response.status,200);
  const result=await response.json();
  if (operation==='observe') {assert.equal(result.execution.platformStatus,'SUCCEEDED');assert.equal(result.contentReference.nativeObjectRef,ids[3]);}
  else assert.deepEqual(result,{externalExecutionId:ids[8],idempotencyKey:ids[7],nativeType:'version',nativeId:'published-native-version',measurements:[{meterKey:'approved_write_count',quantity:1,occurredAt:'2026-10-09T00:00:00Z'},{meterKey:'approved_write_bytes',quantity:0,occurredAt:'2026-10-09T00:00:00Z'}]});
  assert.equal(fixture.state.promotions,undefined);assert.deepEqual(fixture.state.nativeReads,['/v2/jobs/user']);assert.equal(fixture.state.peps,2);
 });
 for (const operation of ['observe','extract_usage']) for (const platformStatus of ['RUNNING','UNKNOWN']) await t.test(`${operation} ${platformStatus}`,async nested=>{
  const execution={idempotencyKey:ids[7],nativeType:'version',platformStatus,cancelCapability:'UNSUPPORTED',lastObservedAt:'2026-10-09T00:00:00Z'};
  const fixture=await setup(nested,{write:true,operation,validation:true,businessAction:'file_storage.write@v1',arguments:{externalExecutionId:ids[8],idempotencyKey:ids[7],nativeType:'version'},writeResult:{execution}});
  const response=await fixture.invoke({path:`/platform-adapter/v1/${operation}`});
  assert.equal(response.status,operation==='observe'?200:503);
  assert.deepEqual(await response.json(),operation==='observe'?{execution}:{error:'adapter request refused'});
  assert.equal(fixture.state.promotions,undefined);assert.deepEqual(fixture.state.nativeReads,['/v2/jobs/user']);
 });
});

test('native write refuses forged references, missing signed key, unknown native receipt and post-copy revocation',async t=>{
 const input={resourceId:ids[10],nativeObjectRef:canonical({nodeUuid:ids[3],publish:false}),nativeRevision:'opaque-draft-v1',displayName:'file.txt',mediaType:'text/plain'};
 for (const scenario of ['different-node','publish-unproved','duplicate-reference-key','unknown-reference-field','missing-key-claim','wrong-key-claim','missing-ee','missing-actor-ack','native-unavailable','native-running','native-unknown','foreign-content-resource','foreign-content-node','wrong-content-version','wrong-idempotency-key','unknown-native-status','unconfirmed-native-id','missing-terminal-time','unexpected-body','revoked-after-native']) await t.test(scenario,async nested=>{
  const args={target:{resourceId:ids[10]},input:{...input}};
  if (scenario==='different-node') args.input.nativeObjectRef=canonical({nodeUuid:ids[2],publish:false});
  if (scenario==='publish-unproved') args.input.nativeObjectRef=canonical({nodeUuid:ids[3],publish:true});
  if (scenario==='duplicate-reference-key') args.input.nativeObjectRef=`{"nodeUuid":"${ids[3]}","nodeUuid":"${ids[3]}","publish":false}`;
  if (scenario==='unknown-reference-field') args.input.nativeObjectRef=canonical({nodeUuid:ids[3],publish:false,secret:'forged'});
  const pending=['native-running','native-unknown','unconfirmed-native-id'].includes(scenario);
  const execution={idempotencyKey:ids[7],nativeType:'version',platformStatus:pending?(scenario==='native-running'?'RUNNING':'UNKNOWN'):'SUCCEEDED',cancelCapability:'UNSUPPORTED',lastObservedAt:'2026-10-09T00:00:00Z',...(!pending||scenario==='unconfirmed-native-id'?{nativeId:'published-native-version'}:{}),...(!pending?{terminalAt:'2026-10-09T00:00:00Z'}:{})};
  const result={execution,...(!pending?{contentReference:{...input,nativeObjectRef:ids[3],nativeRevision:'published-native-version'},contentBytes:0}:{})};
  if (scenario==='foreign-content-resource') result.contentReference.resourceId=ids[2];
  if (scenario==='foreign-content-node') result.contentReference.nativeObjectRef=ids[2];
  if (scenario==='wrong-content-version') result.contentReference.nativeRevision='other';
  if (scenario==='wrong-idempotency-key') execution.idempotencyKey=ids[8];
  if (scenario==='unknown-native-status') execution.platformStatus='FUTURE';
  if (scenario==='missing-terminal-time') delete execution.terminalAt;
  if (scenario==='unexpected-body') result.token='must-not-disclose';
  const fixture=await setup(nested,{write:true,operation:'execute',validation:true,businessAction:'file_storage.write@v1',arguments:args,
    missingActorAck:scenario==='missing-actor-ack',nativeStatus:scenario==='native-unavailable'?503:200,writeResult:result,
    ...(scenario==='revoked-after-native'?{pep:(state,response)=>reply(response,state.peps===1?200:403,{actionExecutionId:ids[7],operationId:ids[6],authorizationMinZedToken:'fresh',targetResource:{resourceId:ids[10],nativeType:'node',nativeRef:ids[3],nativeInstanceRef:'delivered-instance',nativeScopeRef:ids[1]}})}:{})});
  const change=scenario==='missing-key-claim'?{idempotency_key:undefined}:scenario==='wrong-key-claim'?{idempotency_key:ids[8]}:scenario==='missing-ee'?{external_execution_id:undefined}:{};
  const response=await fixture.invoke({path:'/platform-adapter/v1/execute',key:ids[7],token:fixture.token(change),raw:canonical({actionKey:'file_storage.write@v1',idempotencyKey:ids[7],arguments:args})});
  if (scenario==='native-running'||scenario==='native-unknown') {assert.equal(response.status,200);assert.deepEqual(await response.json(),{execution});}
  else {assert.notEqual(response.status,200);assert.deepEqual(await response.json(),{error:'adapter request refused'});}
  assert((fixture.state.promotions??0)<=1,'unknown native response was replayed');
 });
});

test('native actor proof is mandatory on all four business read paths and cannot fall back to SERVICE or initiating HUMAN',async t=>{
  for (const actionKey of ['file_storage.read@v1','file_storage.list@v1','file_storage.list_revisions@v1','file_storage.export@v1']) {
    for (const businessHuman of [false,true]) for (const acknowledgement of ['missing','wrong-kind','wrong-principal']) {
      await t.test(`${actionKey} ${businessHuman?'HUMAN':'AGENT'} ${acknowledgement}`,async nested=>{
        const listing=actionKey==='file_storage.list@v1';
        const revisions=actionKey==='file_storage.list_revisions@v1';
        const input={resourceId:ids[10],...(listing?{}:{nativeObjectRef:ids[3]}),
          ...(!listing&&!revisions?{nativeRevision:'frozen-version',displayName:'file.txt',mediaType:'text/plain'}:{})};
        const fixture=await setup(nested,{operation:'execute',validation:true,businessHuman,
          ...(listing?{businessList:true}:actionKey==='file_storage.read@v1'?{businessRead:true}:{businessAction:actionKey}),
          serviceList:listing,serviceRead:!listing&&!revisions,nativeBytes:Buffer.from('text'),
          arguments:{target:{resourceId:ids[10]},input},missingActorAck:acknowledgement==='missing',
          ...(acknowledgement==='wrong-kind'?{actorAck:`${ids[4]}:${ids[0]}:${businessHuman?'AGENT':'HUMAN'}:${businessHuman?ids[9]:ids[8]}`}:
            acknowledgement==='wrong-principal'?{actorAck:`${ids[4]}:${ids[0]}:${businessHuman?'HUMAN':'AGENT'}:${ids[0]}`}:{})});
        const answer=await fixture.invoke({path:'/platform-adapter/v1/execute',key:ids[7],raw:canonical({
          actionKey,idempotencyKey:ids[7],arguments:fixture.requestArguments})});
        assert.equal(answer.status,503);
        assert.deepEqual(await answer.json(),{error:'adapter request refused'});
        assert.equal(fixture.state.downloads,undefined);
        assert.equal(fixture.state.receipts.length,0);
        assert.equal(fixture.state.nativeReads.length,1);
      });
    }
  }
});

test('native error mapping uses the original scoped Agent policy, six classes and no native read', async t => {
  for (const [nativeStatus, expected] of [
    [403, { class: 'DENIED', reason: 'PERMISSION_DENIED' }],
    [501, { class: 'BLOCKED', reason: 'CAPABILITY_BLOCKED' }],
    [404, { class: 'PRECONDITION', reason: 'TARGET_NOT_FOUND' }],
    [429, { class: 'LIMIT', reason: 'RATE_LIMITED' }],
    [409, { class: 'CONFLICT', reason: 'TARGET_STATE_CONFLICT' }],
    [503, { class: 'UNKNOWN', reason: 'EXTERNAL_RESULT_UNKNOWN' }],
    ['unknown-native-state', { class: 'UNKNOWN', reason: 'EXTERNAL_RESULT_UNKNOWN' }],
    [200, { class: 'UNKNOWN', reason: 'EXTERNAL_RESULT_UNKNOWN' }],
  ]) await t.test(String(nativeStatus), async nested => {
    const fixture = await setup(nested, { operation: 'map_native_status_error', arguments: {
      idempotencyKey: ids[7], nativeStatus,
      nativeError: { Code: 'E_WORKSPACE_NOT_FOUND', Title: 'must-not-disclose', Detail: 'secret:file-content',
        Source: 'private-origin', Meta: { credential: 'opaque-native-value' } },
    } });
    const response = await fixture.invoke({ path: '/platform-adapter/v1/map_native_status_error' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), expected);
    assert.equal(fixture.state.peps, 2);
    assert.deepEqual(fixture.state.nativeReads, []);
    assert.deepEqual(fixture.state.receipts, []);
  });
});

test('native error mapping refuses NONE, malformed intent, foreign scope and revoked disclosure', async t => {
  const args = { idempotencyKey: ids[7], nativeStatus: 403, nativeError: 'must-not-disclose' };
  for (const [label, changes, request, expectedStatus, peps] of [
    ['NONE management', {}, { claims: { action_key: 'application_binding.create', target_type: 'APPLICATION_BINDING',
      target_id: ids[0], actor_principal_id: ids[9], agent_principal_id: undefined, delegation_id: undefined,
      delegation_version: undefined, result_exposure_policy_id: undefined, result_exposure_policy_version: undefined } }, 401, 0],
    ['HUMAN PAT NONE', { human: true }, {}, 401, 0],
    ['missing policy', {}, { claims: { result_exposure_policy_id: undefined } }, 401, 0],
    ['missing policy version', {}, { claims: { result_exposure_policy_version: undefined } }, 401, 0],
    ['foreign tenant', {}, { claims: { tenant_id: ids[1] } }, 401, 0],
    ['foreign workspace', {}, { claims: { workspace_id: ids[1] } }, 401, 0],
    ['wrong operation hash', {}, { claims: { normalized_parameter_hash: 'f'.repeat(64) } }, 401, 0],
    ['missing signature', {}, { token: 'not-a-signed-token' }, 401, 0],
    ['different idempotency key', {}, { key: ids[1] }, 400, 0],
    ['duplicate JSON key', {}, { raw: '{"idempotencyKey":"' + ids[7] + '","nativeStatus":403,"nativeStatus":409}' }, 400, 0],
    ['unknown top-level field', {}, { raw: canonical({ ...args, secret: 'must-not-disclose' }) }, 400, 0],
    ['revoke before disclosure', { pep: (state, response) => reply(response, state.peps === 2 ? 403 : 200,
      { actionExecutionId: ids[7], operationId: ids[6], authorizationMinZedToken: 'current' }) }, {}, 503, 2],
  ]) await t.test(label, async nested => {
    const fixture = await setup(nested, { operation: 'map_native_status_error', arguments: args, ...changes });
    const { claims, ...options } = request;
    if (claims) options.token = fixture.token(claims);
    const response = await fixture.invoke({ path: '/platform-adapter/v1/map_native_status_error', ...options });
    assert.equal(response.status, expectedStatus);
    assert.deepEqual(await response.json(), { error: 'adapter request refused' });
    assert.equal(fixture.state.peps, peps);
    assert.deepEqual(fixture.state.nativeReads, []);
  });
});

test('native error mapping retains the original HUMAN business policy without borrowing PAT NONE', async t => {
  const fixture = await setup(t, { operation: 'map_native_status_error',
    arguments: { idempotencyKey: ids[7], nativeStatus: 403 } });
  const token = fixture.token({ action_key: 'file_storage.read@v1', actor_principal_id: ids[9],
    agent_principal_id: undefined, delegation_id: undefined, delegation_version: undefined });
  const response = await fixture.invoke({ path: '/platform-adapter/v1/map_native_status_error', token });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { class: 'DENIED', reason: 'PERMISSION_DENIED' });
  assert.equal(fixture.state.peps, 2);
  assert.deepEqual(fixture.state.nativeReads, []);
});

test('native write error mapping retains its delivered HUMAN policy without executing the writer', async t => {
  const fixture = await setup(t, { operation:'map_native_status_error', write:true, validation:true,
    businessHuman:true, businessAction:'file_storage.write@v1',
    arguments:{idempotencyKey:ids[7],nativeStatus:409} });
  const response = await fixture.invoke({path:'/platform-adapter/v1/map_native_status_error'});
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{class:'CONFLICT',reason:'TARGET_STATE_CONFLICT'});
  assert.equal(fixture.state.peps,2);
  assert.deepEqual(fixture.state.nativeReads,[]);
  assert.equal(fixture.state.promotions,undefined);
});

test('binding validation observes original Cells workspace and actual delivered credential receipts', async (t) => {
  const fixture = await setup(t, { validation: true, operation: 'validate_binding' });
  for (let repeat = 0; repeat < 2; repeat++) {
    const response = await fixture.invoke({ path: '/platform-adapter/v1/validate_binding' });
    assert.equal(response.status, 200);
    const value = await response.json();
    assert.equal(value.bindingId, ids[0]);
    assert.equal(value.nativeScopeRef, ids[1]);
    assert.equal(value.isolationMode, 'DEDICATED_INSTANCE');
    assert.equal(value.configDigest, fixture.requestArguments.configDigest);
    assert.equal(value.secretRefDigest, createHash('sha256').update(canonical(fixture.requestArguments.secretRefs)).digest('hex'));
    assert.deepEqual(value.secretReads.map(({ requestId, ...read }) => {
      assert.ok(fixture.state.secretReads.includes(requestId));
      return read;
    }), fixture.proofFiles.map(({ entry }) => ({
      secretKey: entry.secretKey, version: entry.version, audience: entry.audience,
    })));
    assert.deepEqual(value.executionMappings, ['read', 'list'].map(action => ({
      actionKey: `file_storage.${action}@v1`, actionVersion: 1, nativeType: 'node', cancelCapability: 'UNSUPPORTED',
    })));
    assert.equal(JSON.stringify(value).includes('credentialDigest'), false);
  }
  assert.equal(fixture.state.peps, 4);
  assert.equal(fixture.state.nativeReads.length, 2);
  assert.equal(fixture.state.queries.length, 0);
});

test('binding validation refuses forged scope, configuration, binding or credential references before native access', async (t) => {
  for (const validationArguments of [{ bindingVersion: 2 }, { nativeScopeRef: ids[2] },
    { isolationMode: 'RESOURCE_FILTER' }, { configDigest: 'b'.repeat(64) }, { secretRefs: [] },
    { nativeInstanceRef: 'other-instance' }, { extra: true }]) {
    await t.test(JSON.stringify(validationArguments), async nested => {
      const fixture = await setup(nested, { validation: true, operation: 'validate_binding', validationArguments });
      assert.equal((await fixture.invoke({ path: '/platform-adapter/v1/validate_binding' })).status, 403);
      assert.equal(fixture.state.peps, 0);
      assert.equal(fixture.state.nativeReads.length, 0);
    });
  }
});

test('binding validation rejects absent, mismatched, duplicate and rotated original Agent receipts', async (t) => {
  for (const failure of ['missing', 'digest', 'version', 'duplicate', 'native-rotation', 'final-pep-rotation']) {
    await t.test(failure, async nested => {
      let rotate;
      const fixture = await setup(nested, { validation: true, operation: 'validate_binding',
        pep: async (state, response) => {
          if (failure === 'final-pep-rotation' && state.peps === 2) await rotate();
          reply(response, 200, { actionExecutionId: ids[7], operationId: ids[6], authorizationMinZedToken: 'fresh' });
        } });
      const { entry } = fixture.proofFiles[0];
      rotate = () => writeFile(entry.secretFile, randomBytes(32).toString('hex'));
      if (failure === 'missing') await rm(entry.secretFile);
      if (failure === 'digest') await rotate();
      if (failure === 'version') fixture.state.wrongSecretVersion = true;
      if (failure === 'duplicate') fixture.state.duplicateSecretRead = true;
      if (failure === 'native-rotation') fixture.state.onNativeRoot = rotate;
      assert.equal((await fixture.invoke({ path: '/platform-adapter/v1/validate_binding' })).status, 503);
      assert.equal(fixture.state.nativeReads.length, failure.endsWith('rotation') ? 1 : 0);
    });
  }
});

test('binding validation rechecks management permission after observing the original workspace', async (t) => {
  const fixture = await setup(t, { validation: true, operation: 'validate_binding',
    pep: (state, response) => reply(response, state.peps === 2 ? 403 : 200,
      { actionExecutionId: ids[7], operationId: ids[6], authorizationMinZedToken: 'fresh' }) });
  assert.equal((await fixture.invoke({ path: '/platform-adapter/v1/validate_binding' })).status, 503);
  assert.equal(fixture.state.nativeReads.length, 1);
  assert.equal(fixture.state.peps, 2);
});

test('binding handshake checks the original Cells root and both fresh management authorizations', async (t) => {
  const management = { componentReleaseId: ids[10], componentTypeKey: 'file_storage', artifactDigest: 'a'.repeat(64), protocolRange: '1' };
  const argumentsValue = { idempotencyKey: ids[7], componentReleaseId: management.componentReleaseId,
    componentTypeKey: management.componentTypeKey, protocolRange: management.protocolRange };
  const fixture = await setup(t, { management, arguments: argumentsValue, operation: 'handshake' });
  const options = { path: '/platform-adapter/v1/handshake' };
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fixture.invoke(options);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { protocolVersion: '1', artifactDigest: management.artifactDigest });
  }
  assert.equal(fixture.state.peps, 4);
  assert.deepEqual(fixture.state.nativeReads, Array(2).fill(`/v2/n/node/${ids[2]}?Flags=WithVersionsAll`));
  assert.deepEqual(fixture.state.queries, []);
  for (const changed of [{ target_id: ids[10] }, { target_type: 'RESOURCE' }, { tenant_id: ids[10] },
    { workspace_id: undefined }, { action_key: 'application_binding.disable' }, { agent_principal_id: ids[9] },
    { result_exposure_policy_id: ids[9] }, { actor_principal_id: ids[8] }]) {
    assert.equal((await fixture.invoke({ ...options, token: fixture.token(changed) })).status, 401);
  }
  assert.equal(fixture.state.nativeReads.length, 2);
  assert.equal((await fixture.invoke({ ...options, key: ids[8] })).status, 400);
  assert.equal((await fixture.invoke({ ...options, raw: canonical({ ...argumentsValue, protocolRange: '2' }) })).status, 403);
  for (const root of [{ Uuid: ids[2], Type: 'COLLECTION', Path: 'documents/root', ContextWorkspace: { Uuid: ids[10] } },
    { Uuid: ids[2], Type: 'COLLECTION', Path: 'documents/root', ContextWorkspace: { Uuid: ids[1] }, IsRecycled: true }]) {
    await t.test('foreign or retired native root', async (nested) => {
      const denied = await setup(nested, { management, arguments: argumentsValue, operation: 'handshake', root });
      assert.equal((await denied.invoke(options)).status, 503);
      assert.equal(denied.state.peps, 1);
    });
  }
  for (const denyAt of [1, 2]) {
    await t.test('revoked management authorization', async (nested) => {
      const denied = await setup(nested, { management, arguments: argumentsValue, operation: 'handshake',
        pep: (state, response) => reply(response, state.peps === denyAt ? 403 : 200,
          { actionExecutionId: ids[7], operationId: ids[6], authorizationMinZedToken: 'fresh' }) });
      assert.equal((await denied.invoke(options)).status, 503);
      assert.equal(denied.state.nativeReads.length, denyAt - 1);
    });
  }
});

test('SERVICE source read returns exact binary version only after initial, revalidation and disclosure permission checks', async (t) => {
  const argumentsValue={targetType:'RESOURCE',targetId:ids[10],authorizationTargetNativeRef:ids[2],
    input:{resourceId:ids[10],nativeObjectRef:ids[3],nativeRevision:'frozen-version',displayName:'file.bin',mediaType:'application/octet-stream'}};
  const request={actionKey:'file_storage.read@v1',idempotencyKey:ids[7],arguments:argumentsValue};
  const fixture=await setup(t,{operation:'execute',arguments:argumentsValue,serviceRead:true});
  const result=await fixture.invoke({path:'/platform-adapter/v1/execute',key:ids[7],raw:canonical(request)});
  assert.equal(result.status,200);
  assert.deepEqual(Buffer.from(await result.arrayBuffer()),Buffer.from([0,255,1,254]));
  assert.equal(result.headers.get('x-kailo-native-revision'),'frozen-version');
  assert.equal(result.headers.get('x-kailo-content-sha256'),createHash('sha256').update(Buffer.from([0,255,1,254])).digest('hex'));
  assert.equal(fixture.state.peps,4);
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

test('SERVICE source read consumes native proto3 omitted zero without accepting malformed size or nonempty bytes',async t=>{
  const argumentsValue={targetType:'RESOURCE',targetId:ids[10],authorizationTargetNativeRef:ids[2],
    input:{resourceId:ids[10],nativeObjectRef:ids[3],nativeRevision:'frozen-version'}};
  const request={actionKey:'file_storage.read@v1',idempotencyKey:ids[7],arguments:argumentsValue};
  const empty=Buffer.alloc(0);
  const cases=[
    ['omitted zero',{omitVersionSize:true,nativeBytes:empty},200,1],
    ['explicit zero',{versionSize:'0',nativeBytes:empty},200,1],
    ['nonempty bytes with omitted size',{omitVersionSize:true},503,1],
    ['nonempty bytes with explicit zero',{versionSize:'0'},503,1],
    ['empty bytes with nonzero size',{nativeBytes:empty},503,1],
    ...[null,0,false,'','00','-1','4.0','9007199254740992','65537']
      .map(value=>[`invalid size ${JSON.stringify(value)}`,{versionSize:value,nativeBytes:empty},503,0]),
  ];
  for (const [name,change,status,downloads] of cases) await t.test(name,async nested=>{
    const fixture=await setup(nested,{operation:'execute',arguments:argumentsValue,serviceRead:true,...change,
      usageMeasurements:[{meterKey:'native_read_count',quantitySource:'COUNT'},{meterKey:'native_read_bytes',quantitySource:'CONTENT_BYTES'}]});
    const result=await fixture.invoke({path:'/platform-adapter/v1/execute',key:ids[7],raw:canonical(request)});
    assert.equal(result.status,status);
    assert.equal(fixture.state.downloads??0,downloads);
    assert.equal(fixture.state.receipts.length,status===200?1:0);
    if (status===200) {
      assert.deepEqual(Buffer.from(await result.arrayBuffer()),empty);
      assert.equal(result.headers.get('content-length'),'0');
      assert.equal(result.headers.get('x-kailo-native-revision'),'frozen-version');
      assert.equal(result.headers.get('x-kailo-content-sha256'),createHash('sha256').update(empty).digest('hex'));
      assert.equal(fixture.state.peps,4);
      assert.equal(fixture.state.receipts[0].contentBytes,0);
      assert.deepEqual(fixture.state.receipts[0].measurements,
        [{meterKey:'native_read_count',quantity:1},{meterKey:'native_read_bytes',quantity:0}]);
    } else assert.deepEqual(await result.json(),{error:'adapter request refused'});
  });
});

test('accepted zero-byte native save observes the exact version and ETag with omitted proto3 size',async t=>{
  const writeObservation={phase:'ACCEPTED',correlationRef:'zero-byte-write',editors:'human',
    baseModifiedAt:'2026-10-05T00:00:00Z',bytesWritten:0,nativeEtag:'empty-native-etag',resultRevision:'empty-version'};
  const argumentsValue={idempotencyKey:ids[7],nativeObjectRef:ids[3],
    protocolReconcile:{protocolSessionId:ids[7],baseRevision:'original-base',writeObservation}};
  for (const size of [undefined,'0',null,0,'1']) await t.test(`Size=${JSON.stringify(size)}`,async nested=>{
    const version={VersionId:'empty-version',ETag:'empty-native-etag',...(size===undefined?{}:{Size:size})};
    const fixture=await setup(nested,{arguments:argumentsValue,human:true,versions:{Versions:[version]}});
    const result=await fixture.invoke();
    assert.equal(result.status,size===undefined||size==='0'?200:503);
    const value=await result.json();
    if (result.status===200) {
      assert.equal(value.nativeRevision,'empty-version');
      assert.equal(value.protocolSessionId,ids[7]);
      assert.equal(fixture.state.peps,2);
    } else assert.deepEqual(value,{error:'adapter request refused'});
    assert.equal(fixture.state.downloads??0,0);
    assert.equal(fixture.state.receipts.length,0);
  });
});

test('SERVICE source read rechecks native UUID ownership and lifecycle after buffering before publishing a receipt', async (t) => {
  const target = { Uuid: ids[3], Type: 'LEAF', Path: 'documents/root/file.txt', ContextWorkspace: { Uuid: ids[1] } };
  const root = { Uuid: ids[2], Type: 'COLLECTION', Path: 'documents/root', ContextWorkspace: { Uuid: ids[1] } };
  const cases = [
    ['moved outside binding root', { target: { ...target, Path: 'documents/root-peer/file.txt' } }, 403],
    ['moved to another Workspace', { target: { ...target, ContextWorkspace: { Uuid: ids[8] } } }, 503],
    ['replaced node UUID', { target: { ...target, Uuid: ids[8] } }, 503],
    ['recycled file', { target: { ...target, IsRecycled: true } }, 503],
    ['unpublished file', { target: { ...target, IsDraft: true } }, 503],
    ['unknown lifecycle value', { target: { ...target, IsDraft: null } }, 503],
    ['native ACL withdrawn', { nodeStatus: 403 }, 503],
    ['native node deleted', { nodeStatus: 404 }, 503],
    ['binding root recycled', { root: { ...root, IsRecycled: true } }, 503],
    ['binding root Workspace changed', { root: { ...root, ContextWorkspace: { Uuid: ids[8] } } }, 503],
    ['authorized subtree moved away from file', {
      target: { ...target, Path: 'documents/root/authorized/file.txt' },
      authorized: { Uuid: ids[10], Type: 'COLLECTION', Path: 'documents/root/elsewhere', ContextWorkspace: { Uuid: ids[1] } },
    }, 403],
  ];
  for (const [name, patch, status] of cases) {
    await t.test(name, async (nested) => {
      const subtree = name === 'authorized subtree moved away from file';
      const argumentsValue = { targetType: 'RESOURCE', targetId: ids[10],
        authorizationTargetNativeRef: subtree ? ids[10] : ids[2],
        input: { resourceId: ids[10], nativeObjectRef: ids[3], nativeRevision: 'frozen-version' } };
      const changes = { operation: 'execute', arguments: argumentsValue, serviceRead: true,
        ...(subtree ? { target: { ...target, Path: 'documents/root/authorized/file.txt' } } : {}) };
      const fixture = await setup(nested, changes);
      fixture.state.onNativeRoot = () => {
        if (fixture.state.downloads) Object.assign(changes, patch);
      };
      const result = await fixture.invoke({ path: '/platform-adapter/v1/execute', key: ids[7],
        raw: canonical({ actionKey: 'file_storage.read@v1', idempotencyKey: ids[7], arguments: argumentsValue }) });
      assert.equal(result.status, status);
      assert.deepEqual(await result.json(), { error: 'adapter request refused' });
      assert.equal(result.headers.get('x-kailo-native-object-ref'), null);
      assert.equal(fixture.state.downloads, 1);
      assert.equal(fixture.state.peps, 2);
      assert.equal(fixture.state.receipts.length, 0);
    });
  }
});

test('SERVICE source read preserves a same-UUID rename within the authorized root and rejects revocation during final native checks', async (t) => {
  const argumentsValue = { targetType: 'RESOURCE', targetId: ids[10], authorizationTargetNativeRef: ids[2],
    input: { resourceId: ids[10], nativeObjectRef: ids[3], nativeRevision: 'frozen-version' } };
  const raw = canonical({ actionKey: 'file_storage.read@v1', idempotencyKey: ids[7], arguments: argumentsValue });
  for (const revoked of [false, true]) {
    await t.test(revoked ? 'fresh permission lost after native revalidation' : 'native rename is not a new object or revision', async (nested) => {
      const changes = { operation: 'execute', arguments: argumentsValue, serviceRead: true,
        pep: (state, response) => reply(response, revoked && state.peps === 3 ? 403 : 200,
          { actionExecutionId: ids[7], operationId: ids[6], authorizationMinZedToken: 'fresh' }) };
      const fixture = await setup(nested, changes);
      fixture.state.onNativeRoot = () => {
        if (fixture.state.downloads) changes.target = { Uuid: ids[3], Type: 'LEAF',
          Path: 'documents/root/renamed.txt', ContextWorkspace: { Uuid: ids[1] } };
      };
      const result = await fixture.invoke({ path: '/platform-adapter/v1/execute', key: ids[7], raw });
      assert.equal(fixture.state.downloads, 1);
      assert.equal(fixture.state.peps, revoked ? 3 : 4);
      assert.equal(fixture.state.queries.length, 1);
      assert.equal(fixture.state.nativeReads.length, revoked ? 5 : 7);
      assert.equal(fixture.state.receipts.length, revoked ? 0 : 1);
      assert.equal(result.status, revoked ? 503 : 200);
      if (revoked) assert.deepEqual(await result.json(), { error: 'adapter request refused' });
      else {
        assert.deepEqual(Buffer.from(await result.arrayBuffer()), Buffer.from([0, 255, 1, 254]));
        assert.equal(fixture.state.receipts[0].nativeRevision, 'frozen-version');
      }
    });
  }
});

test('SERVICE source read refuses native withdrawal during receipt delivery without disclosing buffered bytes', async (t) => {
  const target = { Uuid: ids[3], Type: 'LEAF', Path: 'documents/root/file.txt', ContextWorkspace: { Uuid: ids[1] } };
  const root = { Uuid: ids[2], Type: 'COLLECTION', Path: 'documents/root', ContextWorkspace: { Uuid: ids[1] } };
  const cases = [
    ['moved outside binding root', { target: { ...target, Path: 'documents/root-peer/file.txt' } }, 403],
    ['moved to another Workspace', { target: { ...target, ContextWorkspace: { Uuid: ids[8] } } }, 503],
    ['replaced native UUID', { target: { ...target, Uuid: ids[8] } }, 503],
    ['recycled file', { target: { ...target, IsRecycled: true } }, 503],
    ['native ACL withdrawn', { nodeStatus: 403 }, 503],
    ['native node deleted', { nodeStatus: 404 }, 503],
    ['binding root recycled', { root: { ...root, IsRecycled: true } }, 503],
    ['authorized subtree moved', {
      authorized: { Uuid: ids[10], Type: 'COLLECTION', Path: 'documents/root/elsewhere', ContextWorkspace: { Uuid: ids[1] } },
    }, 403],
  ];
  for (const [name, patch, status] of cases) {
    await t.test(name, async nested => {
      const subtree = name === 'authorized subtree moved';
      const argumentsValue = { targetType: 'RESOURCE', targetId: ids[10],
        authorizationTargetNativeRef: subtree ? ids[10] : ids[2],
        input: { resourceId: ids[10], nativeObjectRef: ids[3], nativeRevision: 'frozen-version' } };
      const changes = { operation: 'execute', arguments: argumentsValue, serviceRead: true,
        ...(subtree ? { target: { ...target, Path: 'documents/root/authorized/file.txt' } } : {}) };
      const fixture = await setup(nested, changes);
      fixture.state.onReceipt = () => Object.assign(changes, patch);
      const response = await fixture.invoke({ path: '/platform-adapter/v1/execute', key: ids[7],
        raw: canonical({ actionKey: 'file_storage.read@v1', idempotencyKey: ids[7], arguments: argumentsValue }) });
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), { error: 'adapter request refused' });
      assert.equal(response.headers.get('x-kailo-native-object-ref'), null);
      assert.equal(fixture.state.downloads, 1);
      assert.equal(fixture.state.queries.length, 1);
      assert.equal(fixture.state.receipts.length, 1);
      assert.equal(fixture.state.receipts[0].role, 'SOURCE');
    });
  }
});

test('SERVICE file and directory disclosure recheck platform permission after acknowledged receipt I/O', async t => {
  for (const serviceList of [false, true]) {
    await t.test(serviceList ? 'complete desired set withheld' : 'buffered file bytes withheld', async nested => {
      const argumentsValue = { targetType: 'RESOURCE', targetId: ids[10], authorizationTargetNativeRef: ids[2],
        input: serviceList ? { resourceId: ids[10] }
          : { resourceId: ids[10], nativeObjectRef: ids[3], nativeRevision: 'frozen-version' } };
      const actionKey = serviceList ? 'file_storage.list@v1' : 'file_storage.read@v1';
      const fixture = await setup(nested, { operation: 'execute', arguments: argumentsValue, serviceList, serviceRead: !serviceList,
        pep: (state, response) => reply(response, state.receipts.length ? 403 : 200,
          { actionExecutionId: ids[7], operationId: ids[6], authorizationMinZedToken: 'fresh' }) });
      const response = await fixture.invoke({ path: '/platform-adapter/v1/execute', key: ids[7],
        raw: canonical({ actionKey, idempotencyKey: ids[7], arguments: argumentsValue }) });
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: 'adapter request refused' });
      assert.equal(response.headers.get('x-kailo-native-object-ref'), null);
      assert.equal(fixture.state.receipts.length, 1);
      assert.equal(fixture.state.receipts[0].role, 'SOURCE');
      assert.equal(fixture.state.peps, serviceList ? 3 : 4);
      assert.equal(serviceList ? fixture.state.listings : fixture.state.downloads, serviceList ? 2 : 1);
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
  assert.equal(fixture.state.peps,3);
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
      assert.equal(fixture.state.peps,3);
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

test('revision query rejects draft nodes and malformed native state before observing a version', async (t) => {
  for (const field of ['root', 'target', 'authorized']) {
    const node = field === 'target'
      ? { Uuid: ids[3], Type: 'LEAF', Path: 'documents/root/authorized/file.txt', ContextWorkspace: { Uuid: ids[1] } }
      : { Uuid: field === 'root' ? ids[2] : ids[10], Type: 'COLLECTION',
        Path: field === 'root' ? 'documents/root' : 'documents/root/authorized', ContextWorkspace: { Uuid: ids[1] } };
    for (const flag of [{ IsDraft: true }, { IsDraft: null }, { IsDraft: 'false' },
      { IsRecycled: null }, { IsRecycleBin: 0 }]) {
      await t.test(`${field} ${JSON.stringify(flag)}`, async nested => {
        const fixture = await setup(nested, { [field]: { ...node, ...flag },
          arguments: { ...args, authorizationTargetNativeRef: ids[10] } });
        assert.equal((await fixture.invoke()).status, 503);
        assert.equal(fixture.state.peps, 1);
        assert.equal(fixture.state.queries.length, 0);
      });
    }
  }
});

test('native read Task producer closes actual read/export and never repeats the original bytes', async t => {
  for (const action of ['file_storage.read@v1','file_storage.export@v1']) {
    for (const human of [true,false]) {
      await t.test(`${action}:${human?'HUMAN':'AGENT'}`, async nested => {
        const input={resourceId:ids[10],nativeObjectRef:ids[3],nativeRevision:'frozen-version',displayName:'file.txt',mediaType:'text/plain'};
        const argumentsValue={target:{resourceId:ids[10]},input};
        const fixture=await setup(nested,{operation:'execute',arguments:argumentsValue,validation:true,
          businessRead:action==='file_storage.read@v1',...(action==='file_storage.export@v1'?{businessAction:action}:{}),
          businessHuman:human,serviceRead:true,readExecution:true,nativeBytes:Buffer.from('test')});
        const request={path:'/platform-adapter/v1/execute',key:ids[7],raw:canonical({actionKey:action,idempotencyKey:ids[7],arguments:argumentsValue})};
        const first=await fixture.invoke(request); assert.equal(first.status,200);
        const result=await first.json(); assert.equal(result.execution.platformStatus,'SUCCEEDED');
        assert.equal(result.execution.terminalAt,'2026-10-09T00:00:00Z');
        assert.deepEqual(JSON.parse(result.resultJson),action==='file_storage.read@v1'?{text:'test'}:{contentBase64:Buffer.from('test').toString('base64'),filename:'file.txt',mediaType:'text/plain'});
        assert.equal(fixture.state.downloads,1); assert.equal(fixture.state.readTaskQueries,2);
        const repeat=await fixture.invoke(request); assert.equal(repeat.status,200);
        assert.deepEqual(await repeat.json(),{execution:result.execution});
        assert.equal(fixture.state.downloads,1); assert.equal(fixture.state.queries.length,1);
        assert.equal(fixture.state.receipts.length,0);
      });
    }
  }
});

test('node observe/extract_usage consume exact original Task evidence without any file read', async t => {
  const input={resourceId:ids[10],nativeObjectRef:ids[3],nativeRevision:'original-read-version',displayName:'file.txt',mediaType:'text/plain'};
  const persisted={found:true,execution:{idempotencyKey:ids[7],nativeType:'node',nativeId:ids[3],platformStatus:'SUCCEEDED',cancelCapability:'UNSUPPORTED',
    lastObservedAt:'2026-10-09T00:00:00Z',terminalAt:'2026-10-09T00:00:00Z'},contentReference:input,contentBytes:0,
    contentSha256:createHash('sha256').update(Buffer.alloc(0)).digest('hex'),measurements:[{meterKey:'approved_read_count',quantity:1},{meterKey:'approved_read_bytes',quantity:0}]};
  for (const operation of ['observe','extract_usage']) {
    await t.test(operation,async nested=>{
      const args={externalExecutionId:ids[8],idempotencyKey:ids[7],nativeType:'node',nativeId:ids[3]};
      const fixture=await setup(nested,{operation,arguments:args,validation:true,businessRead:true,readExecution:true,readResult:()=>persisted});
      const response=await fixture.invoke({path:`/platform-adapter/v1/${operation}`,key:ids[7]}); assert.equal(response.status,200);
      const result=await response.json();
      assert.deepEqual(result,operation==='observe'?{execution:persisted.execution}:{externalExecutionId:ids[8],idempotencyKey:ids[7],nativeType:'node',nativeId:ids[3],
        measurements:persisted.measurements.map(value=>({...value,occurredAt:persisted.execution.terminalAt}))});
      assert.equal(fixture.state.downloads??0,0); assert.equal(fixture.state.queries.length,0);
      assert.equal(fixture.state.readTaskQueries,1); assert.equal(fixture.state.receipts.length,0);
    });
  }
  for (const change of [value=>({...value,measurements:[]}),value=>({...value,measurements:[...value.measurements,{meterKey:'foreign',quantity:1}]}),
    value=>({...value,measurements:value.measurements.map(m=>({...m,quantity:42}))}),value=>({...value,contentBytes:null}),
    value=>({...value,contentSha256:'not-native-evidence'}),value=>({...value,execution:{...value.execution,nativeId:ids[0]}})]) {
    await t.test('invalid/missing native evidence is not zero usage',async nested=>{
      const fixture=await setup(nested,{operation:'extract_usage',arguments:{externalExecutionId:ids[8],idempotencyKey:ids[7],nativeType:'node',nativeId:ids[3]},
        validation:true,businessRead:true,readExecution:true,readResult:()=>change(persisted)});
      assert.equal((await fixture.invoke({path:'/platform-adapter/v1/extract_usage',key:ids[7]})).status,503);
      assert.equal(fixture.state.downloads??0,0);
    });
  }
});

test('claimed or unconfirmed native reads never refetch or invent usage', async t=>{
  for (const status of ['UNKNOWN','RUNNING']) {
    await t.test(status,async nested=>{
      const input={resourceId:ids[10],nativeObjectRef:ids[3],nativeRevision:'frozen-version',displayName:'file.txt',mediaType:'text/plain'};
      const args={target:{resourceId:ids[10]},input};
      const fixture=await setup(nested,{operation:'execute',arguments:args,validation:true,businessRead:true,serviceRead:true,readExecution:true,
        readResult:()=>({found:true,execution:{idempotencyKey:ids[7],nativeType:'node',platformStatus:status,cancelCapability:'UNSUPPORTED',lastObservedAt:'2026-10-09T00:00:00Z'}})});
      const response=await fixture.invoke({path:'/platform-adapter/v1/execute',key:ids[7],raw:canonical({actionKey:'file_storage.read@v1',idempotencyKey:ids[7],arguments:args})});
      assert.equal(response.status,200); assert.equal((await response.json()).execution.platformStatus,status);
      assert.equal(fixture.state.downloads??0,0); assert.equal(fixture.state.queries.length,0);
    });
  }
});

test('business reads without the controlled native Task delivery never start a file fetch',async t=>{
  for (const action of ['file_storage.read@v1','file_storage.export@v1']) {
    await t.test(action,async nested=>{
      const input={resourceId:ids[10],nativeObjectRef:ids[3],nativeRevision:'frozen-version',displayName:'file.txt',mediaType:'text/plain'};
      const args={target:{resourceId:ids[10]},input};
      const fixture=await setup(nested,{operation:'execute',arguments:args,validation:true,readExecution:false,
        ...(action==='file_storage.read@v1'?{businessRead:true}:{businessAction:action}),serviceRead:true});
      const answer=await fixture.invoke({path:'/platform-adapter/v1/execute',key:ids[7],raw:canonical({actionKey:action,idempotencyKey:ids[7],arguments:args})});
      assert.equal(answer.status,503); assert.deepEqual(await answer.json(),{error:'adapter request refused'});
      assert.equal(fixture.state.downloads??0,0); assert.equal(fixture.state.readTaskQueries??0,0);
      assert.equal(fixture.state.nativeReads.length,0); assert.equal(fixture.state.receipts.length,0);
    });
  }
  for (const readExecutionConfig of [{nativeJobId:''},{usageMeasurements:undefined},{usageMeasurements:null},
    {usageMeasurements:[{meterKey:'delivered',quantitySource:'UNCONFIRMED'}]}]) {
    await t.test('missing/invalid controlled native Task fact is not a default',async nested=>{
      const fixture=await setup(nested,{operation:'execute',validation:true,businessRead:true});
      assert.throws(()=>createAdapter({...fixture.config,readExecution:{...fixture.config.readExecution,...readExecutionConfig}}),
        error=>error.status===503);
    });
  }
});

test('revision query requires one published head while allowing an older native draft', async (t) => {
  for (const versions of [
    [{ VersionId: 'draft-head', IsHead: true, Draft: true }],
    [{ VersionId: 'malformed-head', IsHead: true, Draft: null }],
    [{ VersionId: 'malformed-head', IsHead: true, Draft: 'false' }],
    [{ VersionId: 'head', IsHead: true }, { VersionId: 'malformed-history', Draft: 0 }],
  ]) {
    await t.test(JSON.stringify(versions), async nested => {
      const fixture = await setup(nested, { versions: { Versions: versions } });
      const response = await fixture.invoke();
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: 'adapter request refused' });
      assert.equal(fixture.state.peps, 1);
    });
  }
  const valid = await setup(t, { versions: { Versions: [
    { VersionId: 'older-draft', Draft: true, IsHead: false },
    { VersionId: 'published-head', Draft: false, IsHead: true },
  ] } });
  const response = await valid.invoke();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { nativeObjectRef: ids[3], nativeRevision: 'published-head' });
  assert.equal(valid.state.peps, 2);
});

test('draft native head cannot reach the original document PAT producer', async (t) => {
  const input = { protocolSessionId: ids[7], reference: { nativeObjectRef: ids[3], nativeRevision: 'draft-head' },
    authorizationTargetNativeRef: ids[10], admittedMode: 'EDIT', theme: 'LIGHT', locale: 'zh-CN',
    expiresAt: new Date(Date.now() + 60000).toISOString(), idempotencyKey: ids[7] };
  const fixture = await setup(t, { operation: 'execute', arguments: input, human: true, documentLaunch: true,
    target: { Uuid: ids[3], Type: 'LEAF', Path: 'documents/root/authorized/report.docx', ContextWorkspace: { Uuid: ids[1] } },
    versions: { Versions: [{ VersionId: 'draft-head', IsHead: true, Draft: true }] } });
  assert.equal((await fixture.invoke({ path: '/platform-adapter/v1/execute' })).status, 503);
  assert.equal(fixture.state.discoveryReads ?? 0, 0);
  assert.equal(fixture.state.patCreates?.length ?? 0, 0);
  assert.equal(fixture.state.peps, 1);
});

test('SERVICE frozen read refuses an unpublished native node before bytes or receipt', async (t) => {
  const argumentsValue = { targetType: 'RESOURCE', targetId: ids[10], authorizationTargetNativeRef: ids[2],
    input: { resourceId: ids[10], nativeObjectRef: ids[3], nativeRevision: 'frozen-version' } };
  const request = { actionKey: 'file_storage.read@v1', idempotencyKey: ids[7], arguments: argumentsValue };
  const fixture = await setup(t, { operation: 'execute', arguments: argumentsValue, serviceRead: true,
    target: { Uuid: ids[3], Type: 'LEAF', Path: 'documents/root/file.txt',
      ContextWorkspace: { Uuid: ids[1] }, IsDraft: true } });
  assert.equal((await fixture.invoke({ path: '/platform-adapter/v1/execute', key: ids[7], raw: canonical(request) })).status, 503);
  assert.equal(fixture.state.queries.length, 0);
  assert.equal(fixture.state.downloads ?? 0, 0);
  assert.equal(fixture.state.receipts.length, 0);
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

test('shared PEP consumer accepts optional complete native target facts and rejects malformed additions', async (t) => {
  const targetResource = { resourceId: ids[10], nativeType: 'folder', nativeRef: ids[2],
    nativeInstanceRef: 'fixture-instance', nativeScopeRef: ids[1] };
  const argumentsValue = { targetType: 'RESOURCE', targetId: ids[10], authorizationTargetNativeRef: ids[2],
    input: { resourceId: ids[10], nativeObjectRef: ids[3], nativeRevision: 'frozen-version', displayName: 'file.bin', mediaType: 'application/octet-stream' } };
  const invokeOptions = { path: '/platform-adapter/v1/execute', key: ids[7],
    raw: canonical({ actionKey: 'file_storage.read@v1', idempotencyKey: ids[7], arguments: argumentsValue }) };
  for (const supplied of [undefined, targetResource]) {
    await t.test(supplied === undefined ? 'original response' : 'extended response', async (nested) => {
      const { state, invoke } = await setup(nested, { operation: 'execute', arguments: argumentsValue, serviceRead: true,
        pep: (_current, response) => reply(response, 200,
        { actionExecutionId: ids[7], operationId: ids[6], authorizationMinZedToken: 'fresh',
          ...(supplied === undefined ? {} : { targetResource: supplied }) }) });
      assert.equal((await invoke(invokeOptions)).status, 200);
      assert.equal(state.peps, 4);
      assert.equal(state.downloads, 1);
      assert.equal(state.receipts.length, 1);
    });
  }
  for (const supplied of [null, [], {}, { ...targetResource, resourceId: 'invalid' }, { ...targetResource, resourceId: ids[0] },
    { ...targetResource, nativeType: '' }, { ...targetResource, nativeRef: ' padded ' },
    { ...targetResource, nativeInstanceRef: null }, { ...targetResource, nativeScopeRef: undefined },
    { ...targetResource, credential: 'must-not-be-accepted' }]) {
    await t.test(JSON.stringify(supplied), async (nested) => {
      const { state, invoke } = await setup(nested, { operation: 'execute', arguments: argumentsValue, serviceRead: true,
        pep: (_current, response) => reply(response, 200,
        { actionExecutionId: ids[7], operationId: ids[6], authorizationMinZedToken: 'fresh', targetResource: supplied }) });
      assert.equal((await invoke(invokeOptions)).status, 503);
      assert.equal(state.nativeReads.length, 0);
    });
  }
});

test('HUMAN and AGENT directory lists consume the original single enumeration receipt without replay', async t => {
  const argumentsValue = {target:{resourceId:ids[10]},input:{resourceId:ids[10]}};
  for (const businessHuman of [true,false]) await t.test(businessHuman ? 'HUMAN' : 'AGENT', async nested => {
    const fixture = await setup(nested, {operation:'execute',arguments:argumentsValue,validation:true,
      serviceList:true,businessList:true,businessHuman});
    // execute_prepared uses normal JSON serialization, not SERVICE canonical
    // transport. Only the original typed arguments determine the token hash.
    const answer = await fixture.invoke({path:'/platform-adapter/v1/execute',key:ids[7],raw:JSON.stringify({
      idempotencyKey:ids[7],actionKey:'file_storage.list@v1',arguments:argumentsValue,
    })});
    assert.equal(answer.status,200);
    const result=await answer.json();
    const references=[{resourceId:ids[10],nativeObjectRef:ids[3],nativeRevision:'frozen-version',displayName:'file.txt',mediaType:'text/plain'}];
    assert.deepEqual(JSON.parse(result.resultJson),{citations:references});
    assert.deepEqual(result.contentReferences,references);
    assert.equal(result.execution.nativeId,ids[2]);
    assert.equal(result.execution.platformStatus,'SUCCEEDED');
    assert.equal(fixture.state.listings,1);
    assert.equal(fixture.state.peps,3);
    assert.equal(fixture.state.receipts.length,0);
    assert.equal(fixture.state.secretReads.length,0);
    assert.equal(fixture.state.queries.length,0);
    const repeated=await fixture.invoke({path:'/platform-adapter/v1/execute',key:ids[7],raw:canonical({
      idempotencyKey:ids[7],actionKey:'file_storage.list@v1',arguments:argumentsValue,
    })});
    assert.equal(repeated.status,200);
    assert.deepEqual(await repeated.json(),{execution:result.execution});
    assert.equal(fixture.state.listings,1);
    assert.equal(fixture.state.queries.length,0);
  });
  await t.test('missing original Task delivery stays closed',async nested=>{
    const fixture=await setup(nested,{operation:'execute',arguments:argumentsValue,validation:true,
      serviceList:true,businessList:true,readExecution:false});
    const response=await fixture.invoke({path:'/platform-adapter/v1/execute',key:ids[7],raw:canonical({
      actionKey:'file_storage.list@v1',idempotencyKey:ids[7],arguments:argumentsValue,
    })});
    assert.equal(response.status,503);assert.equal(fixture.state.nativeReads.length,0);
  });
});

test('business lists require original HUMAN/AGENT actor, policy, scope, target and frozen HUMAN EE', async t => {
  const argumentsValue = {target:{resourceId:ids[10]},input:{resourceId:ids[10]}};
  for (const [businessHuman, changes] of [
    [false,{agent_principal_id:undefined}], [false,{agent_principal_id:ids[0]}],
    [false,{delegation_id:undefined}], [false,{delegation_version:0}],
    [false,{initiating_human_principal_id:undefined}], [false,{result_exposure_policy_id:undefined}],
    [false,{result_exposure_policy_version:0}], [false,{tenant_id:ids[0]}], [false,{workspace_id:ids[0]}],
    [false,{target_id:ids[0]}], [false,{normalized_parameter_hash:'0'.repeat(64)}],
    [true,{actor_principal_id:ids[8]}], [true,{delegation_id:ids[0]}],
    [true,{external_execution_id:undefined}], [true,{idempotency_key:ids[0]}],
  ]) await t.test(JSON.stringify(changes), async nested => {
    const fixture = await setup(nested, {operation:'execute',arguments:argumentsValue,validation:true,
      serviceList:true,businessList:true,businessHuman});
    const answer = await fixture.invoke({path:'/platform-adapter/v1/execute',key:ids[7],token:fixture.token(changes),
      raw:canonical({actionKey:'file_storage.list@v1',idempotencyKey:ids[7],arguments:argumentsValue})});
    assert.notEqual(answer.status,200);
    assert.equal(fixture.state.nativeReads.length,0);
    assert.equal(fixture.state.receipts.length,0);
  });
});

test('business file read exposes exact UTF-8 bytes only through the original result and typed ContentReference',async t=>{
  const reference={resourceId:ids[10],nativeObjectRef:ids[3],nativeRevision:'frozen-version',displayName:'file.txt',mediaType:'text/plain'};
  const argumentsValue={target:{resourceId:ids[10]},input:reference};
  for (const businessHuman of [true,false]) for (const text of ['完整文本\nKailo','\ufeffBOM preserved','']) {
    await t.test(`${businessHuman ? 'HUMAN' : 'AGENT'} ${JSON.stringify(text)}`,async nested=>{
      const nativeBytes=Buffer.from(text,'utf8');
      const fixture=await setup(nested,{operation:'execute',arguments:argumentsValue,validation:true,
        serviceRead:true,businessRead:true,businessHuman,nativeBytes,versionSize:String(nativeBytes.length)});
      const answer=await fixture.invoke({path:'/platform-adapter/v1/execute',key:ids[7],raw:canonical({
        actionKey:'file_storage.read@v1',idempotencyKey:ids[7],arguments:argumentsValue,
      })});
      assert.equal(answer.status,200);
      const result=await answer.json();
      assert.deepEqual(JSON.parse(result.resultJson),{text});
      assert.deepEqual(result.contentReference,reference);
      assert.equal(result.execution.nativeId,ids[3]);
      assert.equal(result.execution.platformStatus,'SUCCEEDED');
      assert.equal(result.execution.cancelCapability,'UNSUPPORTED');
      assert.equal(result.execution.terminalAt,result.execution.lastObservedAt);
      assert.deepEqual(Object.keys(result).sort(),['contentReference','execution','resultJson']);
      assert.equal(fixture.state.downloads,1);
      assert.equal(fixture.state.peps,3);
      assert.equal(fixture.state.receipts.length,0);
      assert.equal(fixture.state.secretReads.length,0);
    });
  }
});

test('business read rejects invalid UTF-8, absent frozen revision and escaped output overflow without fake text or terminal result',async t=>{
  const reference={resourceId:ids[10],nativeObjectRef:ids[3],nativeRevision:'frozen-version',displayName:'file.txt',mediaType:'text/plain'};
  for (const [label,nativeBytes,revision] of [
    ['invalid UTF-8',Buffer.from([0,255,1,254]),'frozen-version'],
    ['JSON escaping exceeds response budget',Buffer.from('"'.repeat(33000)),'frozen-version'],
    ['missing frozen revision',Buffer.from('text'),'another-revision'],
  ]) await t.test(label,async nested=>{
    const argumentsValue={target:{resourceId:ids[10]},input:{...reference,nativeRevision:revision}};
    const fixture=await setup(nested,{operation:'execute',arguments:argumentsValue,validation:true,
      serviceRead:true,businessRead:true,nativeBytes,versionSize:String(nativeBytes.length)});
    const answer=await fixture.invoke({path:'/platform-adapter/v1/execute',key:ids[7],raw:canonical({
      actionKey:'file_storage.read@v1',idempotencyKey:ids[7],arguments:argumentsValue,
    })});
    assert.notEqual(answer.status,200);
    assert.deepEqual(await answer.json(),{error:'adapter request refused'});
    assert.equal(fixture.state.receipts.length,0);
  });
});

test('business read suppresses buffered text after native move, platform revocation or final target change',async t=>{
  const reference={resourceId:ids[10],nativeObjectRef:ids[3],nativeRevision:'frozen-version',displayName:'file.txt',mediaType:'text/plain'};
  const argumentsValue={target:{resourceId:ids[10]},input:reference};
  for (const label of ['native move','permission revoked','target changed']) await t.test(label,async nested=>{
    const fixture=await setup(nested,{operation:'execute',arguments:argumentsValue,validation:true,
      serviceRead:true,businessRead:true,nativeBytes:Buffer.from('text'),
      ...(label==='native move' ? {} : {pep:(state,response)=>reply(response,
        label==='permission revoked' && state.downloads ? 403 : 200,{
          actionExecutionId:ids[7],operationId:ids[6],authorizationMinZedToken:'fresh',
          targetResource:{resourceId:ids[10],nativeType:'folder',
            nativeRef:label==='target changed' && state.peps===3 ? ids[3] : ids[2],
            nativeInstanceRef:'delivered-instance',nativeScopeRef:ids[1]},
        })})});
    if (label==='native move') fixture.state.onDownload=()=>{fixture.target.Path='documents/foreign/file.txt';};
    const answer=await fixture.invoke({path:'/platform-adapter/v1/execute',key:ids[7],raw:canonical({
      actionKey:'file_storage.read@v1',idempotencyKey:ids[7],arguments:argumentsValue,
    })});
    assert.notEqual(answer.status,200);
    assert.deepEqual(await answer.json(),{error:'adapter request refused'});
    assert.equal(fixture.state.downloads,1);
    assert.equal(fixture.state.receipts.length,0);
  });
});

test('an empty directory requires the same actual native Task byte evidence',async t=>{
  const argumentsValue={target:{resourceId:ids[10]},input:{resourceId:ids[10]}};
  const fixture=await setup(t,{operation:'execute',arguments:argumentsValue,validation:true,
    serviceList:true,businessList:true,root:{Uuid:ids[2],Type:'COLLECTION',Path:'documents/root',
      ContextWorkspace:{Uuid:ids[1]},FolderMeta:[{Namespace:'ChildrenCount'}]},listResponse:{}});
  const answer=await fixture.invoke({path:'/platform-adapter/v1/execute',key:ids[7],raw:canonical({
    actionKey:'file_storage.list@v1',idempotencyKey:ids[7],arguments:argumentsValue,
  })});
  assert.equal(answer.status,200);
  const result=await answer.json();
  assert.deepEqual(JSON.parse(result.resultJson),{citations:[]});
  assert.equal(result.contentReferences,undefined);
  assert.equal(result.execution.nativeId,ids[2]);
  assert.equal(fixture.state.nativeReadReceipt.contentBytes,2);
  assert.equal(fixture.state.listings,1);
  assert.equal(fixture.state.receipts.length,0);
});

test('directory receipt and result validation do not guess completion from a partial native response',async t=>{
 const actionKey='file_storage.list@v1';
 const argumentsValue={target:{resourceId:ids[10]},input:{resourceId:ids[10]}};
 for (const scenario of ['no-receipt','wrong-bytes','wrong-digest','foreign-root','missing-meter','pagination','duplicate-node','outside-scope','foreign-workspace','missing-head','draft-head','unknown-type','revoked-after-list','root-moved']) await t.test(scenario,async nested=>{
  const node={Uuid:ids[3],Type:'LEAF',Path:'documents/root/file.txt',ContentType:'text/plain',ContextWorkspace:{Uuid:ids[1]},Versions:[{VersionId:'frozen-version',IsHead:true}]};
  const changes={operation:'execute',arguments:argumentsValue,validation:true,serviceList:true,businessList:true};
  if (scenario==='pagination') changes.listResponse={Nodes:[node],Pagination:{NextOffset:1}};
  if (scenario==='duplicate-node') changes.listResponse={Nodes:[node,node]};
  if (scenario==='outside-scope') changes.listResponse={Nodes:[{...node,Path:'documents/foreign/file.txt'}]};
  if (scenario==='foreign-workspace') changes.listResponse={Nodes:[{...node,ContextWorkspace:{Uuid:ids[5]}}]};
  if (scenario==='missing-head') changes.listResponse={Nodes:[{...node,Versions:[{VersionId:'older'}]}]};
  if (scenario==='draft-head') changes.listResponse={Nodes:[{...node,Versions:[{VersionId:'draft',IsHead:true,Draft:true}]}]};
  if (scenario==='unknown-type') changes.listResponse={Nodes:[{...node,Type:'FUTURE'}]};
  if (['no-receipt','wrong-bytes','wrong-digest','foreign-root','missing-meter'].includes(scenario)) changes.readResult=state=>{
    if (!state.nativeReadReceipt || scenario==='no-receipt') return {found:false,execution:{idempotencyKey:ids[7],nativeType:'node',platformStatus:'UNKNOWN',cancelCapability:'UNSUPPORTED',lastObservedAt:'2026-10-09T00:00:00Z'}};
    const receipt=structuredClone(state.nativeReadReceipt);
    if (scenario==='wrong-bytes') receipt.contentBytes++;
    if (scenario==='wrong-digest') receipt.contentSha256='0'.repeat(64);
    if (scenario==='foreign-root') receipt.execution.nativeId=ids[3];
    if (scenario==='missing-meter') receipt.measurements=[];
    return receipt;
  };
  if (scenario==='revoked-after-list') changes.pep=(state,response)=>reply(response,state.listings?403:200,{actionExecutionId:ids[7],operationId:ids[6],authorizationMinZedToken:'fresh',targetResource:{resourceId:ids[10],nativeType:'folder',nativeRef:ids[2],nativeInstanceRef:'delivered-instance',nativeScopeRef:ids[1]}});
  if (scenario==='root-moved') changes.rootAfterRead=2,changes.rootAfter={Uuid:ids[2],Type:'COLLECTION',Path:'documents/elsewhere',ContextWorkspace:{Uuid:ids[5]}};
  const fixture=await setup(nested,changes);
  const response=await fixture.invoke({path:'/platform-adapter/v1/execute',key:ids[7],raw:canonical({actionKey,idempotencyKey:ids[7],arguments:argumentsValue})});
  assert.notEqual(response.status,200);assert.deepEqual(await response.json(),{error:'adapter request refused'});
  assert.equal(fixture.state.listings,1);assert.equal(fixture.state.queries.length,0);assert.equal(fixture.state.receipts.length,0);
 });
 for (const operation of ['observe','extract_usage']) await t.test(operation,async nested=>{
  const observation={externalExecutionId:ids[8],idempotencyKey:ids[7],nativeType:'node',nativeId:ids[2]};
  const receipt={found:true,execution:{idempotencyKey:ids[7],nativeType:'node',nativeId:ids[2],platformStatus:'SUCCEEDED',cancelCapability:'UNSUPPORTED',lastObservedAt:'2026-10-09T00:00:00Z',terminalAt:'2026-10-09T00:00:00Z'},contentBytes:2,contentSha256:createHash('sha256').update('{}').digest('hex'),measurements:[{meterKey:'approved_read_count',quantity:1},{meterKey:'approved_read_bytes',quantity:2}]};
  const fixture=await setup(nested,{operation,arguments:observation,validation:true,businessAction:actionKey,readExecution:true,readResult:()=>receipt});
  const response=await fixture.invoke({path:`/platform-adapter/v1/${operation}`});assert.equal(response.status,200);
  const result=await response.json();
  if (operation==='observe') assert.deepEqual(result,{execution:receipt.execution});
  else assert.deepEqual(result.measurements,receipt.measurements.map(value=>({...value,occurredAt:receipt.execution.terminalAt})));
  assert.deepEqual(fixture.state.nativeReads,['/v2/jobs/user']);assert.equal(fixture.state.listings,undefined);
 });
 await t.test('actual SDK MCP client consumes approved directory references',async nested=>{
  const fixture=await setup(nested,{operation:'execute',arguments:argumentsValue,validation:true,serviceList:true,businessList:true,mcp:true});
  const {client,outgoing}=await mcpWireClient(nested,fixture);const listed=await client.listTools();
  outgoing.authorization=`Bearer ${fixture.token()}`;outgoing['idempotency-key']=ids[7];
  const called=await client.callTool({name:listed.tools[0].name,arguments:argumentsValue.input});
  assert.equal(called.isError,false);assert.deepEqual(called.content,[]);
  assert.equal(called.structuredContent.execution.nativeId,ids[2]);
  assert.equal(JSON.parse(called.structuredContent.resultJson).citations[0].nativeObjectRef,ids[3]);
  assert.equal(fixture.state.listings,1);assert.equal(fixture.state.queries.length,0);
 });
});

test('HUMAN business ContentReference verification retains its policy and exact native revision query',async t=>{
  const argumentsValue={nativeObjectRef:ids[3],authorizationTargetNativeRef:ids[2],idempotencyKey:ids[7]};
  const fixture=await setup(t,{operation:'query_revision',arguments:argumentsValue,businessRead:true,businessHuman:true,
    versions:{Versions:[{VersionId:'frozen-version',IsHead:true}]}});
  const answer=await fixture.invoke();
  assert.equal(answer.status,200);
  assert.deepEqual(await answer.json(),{nativeObjectRef:ids[3],nativeRevision:'frozen-version'});
  assert.equal(fixture.state.peps,2);
  assert.equal(fixture.state.receipts.length,0);
  assert.equal((await fixture.invoke({token:fixture.token({result_exposure_policy_id:undefined})})).status,401);
});

test('published file revision lists consume complete native version IDs and typed references for both business actors',async t=>{
  const input={resourceId:ids[10],nativeObjectRef:ids[3]};
  const actionKey='file_storage.list_revisions@v1';
  for (const businessHuman of [false,true]) await t.test(businessHuman ? 'HUMAN' : 'AGENT',async nested=>{
    const fixture=await setup(nested,{operation:'execute',validation:true,businessAction:actionKey,businessHuman,
      arguments:{target:{resourceId:ids[10]},input},versions:{Versions:[
        {VersionId:'current-version',IsHead:true},{VersionId:'older-version'},
        {VersionId:'private-draft',Draft:true,PreSignedGET:{Url:'must-not-disclose'},OwnerName:'native-service-identity'},
      ]}});
    const answer=await fixture.invoke({path:'/platform-adapter/v1/execute',key:ids[7],raw:canonical({
      actionKey,idempotencyKey:ids[7],arguments:fixture.requestArguments,
    })});
    assert.equal(answer.status,200);
    const result=await answer.json();
    const references=['current-version','older-version'].map(nativeRevision=>({...input,nativeRevision,
      displayName:'file.txt',mediaType:'text/plain'}));
    assert.deepEqual(JSON.parse(result.resultJson),{citations:references});
    assert.deepEqual(result.contentReferences,references);
    assert.equal(result.execution.nativeId,ids[3]);
    assert.equal(result.execution.platformStatus,'SUCCEEDED');
    assert.equal(result.execution.cancelCapability,'UNSUPPORTED');
    assert.deepEqual(fixture.state.queries,[{FilterBy:'VersionsAll',Offset:0,Limit:0,Flags:['WithMetaNone']}]);
    assert.equal(fixture.state.readTaskQueries,2);
    assert.equal(fixture.state.downloads,undefined);
    assert.equal(fixture.state.peps,3);
    assert.equal(fixture.state.receipts.length,0);
    assert(!JSON.stringify(result).includes('private-draft'));
    assert(!JSON.stringify(result).includes('PreSignedGET'));
    assert(!JSON.stringify(result).includes('native-service-identity'));
    // A new native head after completion cannot repair or replace old evidence.
    fixture.target.Path='documents/root/changed-name.txt';
    const repeat=await fixture.invoke({path:'/platform-adapter/v1/execute',key:ids[7],raw:canonical({
      actionKey,idempotencyKey:ids[7],arguments:fixture.requestArguments,
    })});
    assert.equal(repeat.status,200);
    assert.deepEqual(await repeat.json(),{execution:result.execution});
    assert.equal(fixture.state.queries.length,1);
  });
});

test('native revision observation and usage retain only the original Task digest without enumerating again',async t=>{
  const actionKey='file_storage.list_revisions@v1';
  const persisted={found:true,execution:{idempotencyKey:ids[7],nativeType:'node',nativeId:ids[3],platformStatus:'SUCCEEDED',
    cancelCapability:'UNSUPPORTED',lastObservedAt:'2026-10-09T00:00:00Z',terminalAt:'2026-10-09T00:00:00Z'},
    contentBytes:17,contentSha256:'a'.repeat(64),measurements:[{meterKey:'approved_read_count',quantity:1},{meterKey:'approved_read_bytes',quantity:17}]};
  for (const operation of ['observe','extract_usage']) await t.test(operation,async nested=>{
    const argumentsValue={externalExecutionId:ids[8],idempotencyKey:ids[7],nativeType:'node',nativeId:ids[3]};
    const fixture=await setup(nested,{operation,arguments:argumentsValue,validation:true,businessAction:actionKey,
      readExecution:true,readResult:()=>persisted});
    const response=await fixture.invoke({path:`/platform-adapter/v1/${operation}`,key:ids[7]});
    assert.equal(response.status,200);
    const result=await response.json();
    assert.deepEqual(result,operation==='observe'?{execution:persisted.execution}:{...argumentsValue,
      measurements:persisted.measurements.map(m=>({...m,occurredAt:persisted.execution.terminalAt}))});
    assert.equal(fixture.state.queries.length,0);assert.equal(fixture.state.downloads,undefined);
    assert.equal(fixture.state.readTaskQueries,1);
  });
  for (const change of [value=>({...value,contentBytes:0}),value=>({...value,contentBytes:null}),
    value=>({...value,measurements:[]}),value=>({...value,contentReference:{resourceId:ids[10]}})]) {
    await t.test('unknown or forged native listing evidence is refused',async nested=>{
      const fixture=await setup(nested,{operation:'observe',arguments:{externalExecutionId:ids[8],idempotencyKey:ids[7],nativeType:'node'},
        validation:true,businessAction:actionKey,readExecution:true,readResult:()=>change(persisted)});
      assert.equal((await fixture.invoke({path:'/platform-adapter/v1/observe',key:ids[7]})).status,503);
      assert.equal(fixture.state.queries.length,0);
    });
  }
});

test('native revision lists reject malformed, incomplete, changed or unauthorized collections without download or terminal claims',async t=>{
  const actionKey='file_storage.list_revisions@v1';
  const argumentsValue={target:{resourceId:ids[10]},input:{resourceId:ids[10],nativeObjectRef:ids[3]}};
  for (const [label,changes] of [
    ['missing collection',{versions:{}}],['empty collection',{versions:{Versions:[]}}],
    ['duplicate version',{versions:{Versions:[{VersionId:'head',IsHead:true},{VersionId:'head'}]}}],
    ['unknown draft',{versions:{Versions:[{VersionId:'head',IsHead:true,Draft:'false'}]}}],
    ['unknown head',{versions:{Versions:[{VersionId:'head',IsHead:'true'}]}}],
    ['absent head',{versions:{Versions:[{VersionId:'older'}]}}],
    ['multiple heads',{versions:{Versions:[{VersionId:'head',IsHead:true},{VersionId:'other',IsHead:true}]}}],
    ['draft head',{versions:{Versions:[{VersionId:'head',IsHead:true,Draft:true}]}}],
    ['missing MIME',{target:{Uuid:ids[3],Type:'LEAF',Path:'documents/root/file.txt',ContextWorkspace:{Uuid:ids[1]}},
      versions:{Versions:[{VersionId:'head',IsHead:true}]}}],
    ['original task digest mismatches returned bytes',{readResult:state=>state.nativeReadReceipt
      ? {...state.nativeReadReceipt,contentSha256:'a'.repeat(64)}
      : {found:false,execution:{idempotencyKey:ids[7],nativeType:'node',platformStatus:'UNKNOWN',cancelCapability:'UNSUPPORTED',lastObservedAt:'2026-10-09T00:00:00Z'}}}],
    ['foreign native UUID',{target:{Uuid:ids[3],Type:'LEAF',Path:'documents/foreign/file.txt',ContentType:'text/plain',ContextWorkspace:{Uuid:ids[1]}}}],
    ['final permission withdrawn',{pep:(state,response)=>reply(response,state.peps>1?403:200,{
      actionExecutionId:ids[7],operationId:ids[6],authorizationMinZedToken:'fresh',
      targetResource:{resourceId:ids[10],nativeRef:ids[2],nativeInstanceRef:'delivered-instance',nativeScopeRef:ids[1]},
    })}],
  ]) await t.test(label,async nested=>{
    const fixture=await setup(nested,{operation:'execute',validation:true,businessAction:actionKey,
      arguments:argumentsValue,versions:{Versions:[{VersionId:'head',IsHead:true}]},...changes});
    const answer=await fixture.invoke({path:'/platform-adapter/v1/execute',key:ids[7],raw:canonical({
      actionKey,idempotencyKey:ids[7],arguments:argumentsValue,
    })});
    assert.notEqual(answer.status,200);
    assert.deepEqual(await answer.json(),{error:'adapter request refused'});
    assert.equal(fixture.state.downloads,undefined);
    assert.equal(fixture.state.receipts.length,0);
  });
});

test('file export preserves every byte including empty/non-UTF8 historical files through the original policy result',async t=>{
  const actionKey='file_storage.export@v1';
  for (const businessHuman of [false,true]) for (const bytes of [Buffer.from([]),Buffer.from([0,255,1,254]),Buffer.from('中文\n')]) {
    await t.test(`${businessHuman ? 'HUMAN' : 'AGENT'} ${bytes.length} bytes`,async nested=>{
      const input={resourceId:ids[10],nativeObjectRef:ids[3],nativeRevision:'older-binary',
        displayName:'archive.bin',mediaType:'application/octet-stream'};
      const argumentsValue={target:{resourceId:ids[10]},input};
      const fixture=await setup(nested,{operation:'execute',validation:true,businessAction:actionKey,businessHuman,
        arguments:argumentsValue,serviceRead:true,nativeBytes:bytes,downloadRevision:'older-binary',
        versions:()=>({Versions:[{VersionId:'latest-head',IsHead:true},
          {VersionId:'older-binary',Size:String(bytes.length),PreSignedGET:{
            Url:`${new URL(fixture.config.cellsRestBaseUrl).origin}/native-bytes?versionId=older-binary`,
          }}]})});
      const answer=await fixture.invoke({path:'/platform-adapter/v1/execute',key:ids[7],raw:canonical({
        actionKey,idempotencyKey:ids[7],arguments:argumentsValue,
      })});
      assert.equal(answer.status,200);
      const result=await answer.json();
      const exported=JSON.parse(result.resultJson);
      assert.deepEqual(exported,{contentBase64:bytes.toString('base64'),mediaType:input.mediaType,filename:input.displayName});
      assert.deepEqual(Buffer.from(exported.contentBase64,'base64'),bytes);
      assert.deepEqual(result.contentReference,input);
      assert.equal(result.execution.nativeId,ids[3]);
      assert.equal(result.execution.platformStatus,'SUCCEEDED');
      assert.equal(fixture.state.downloads,1);
      assert.equal(fixture.state.peps,3);
      assert.equal(fixture.state.receipts.length,0);
      assert(!JSON.stringify(result).includes('PreSignedGET'));
    });
  }
});

test('binary export rejects absent versions, unknown native fields, overflow and post-download withdrawal',async t=>{
  const actionKey='file_storage.export@v1';
  const input={resourceId:ids[10],nativeObjectRef:ids[3],nativeRevision:'frozen-version',displayName:'file.bin',mediaType:'application/octet-stream'};
  const argumentsValue={target:{resourceId:ids[10]},input};
  for (const [label,changes] of [
    ['missing frozen version',{downloadRevision:'other',versions:{Versions:[{
      VersionId:'other',Size:'4',PreSignedGET:{Url:'filled-after-fixture-listen'},
    }]}}],
    ['duplicate frozen version',{versions:{Versions:[{VersionId:'frozen-version'},{VersionId:'frozen-version'}]}}],
    ['unknown draft encoding',{versions:{Versions:[{VersionId:'frozen-version',Draft:'false'}]}}],
    ['base64 plus response exceeds budget',{nativeBytes:Buffer.alloc(50000,255),versionSize:'50000'}],
    ['permission withdrawn after download',{pep:(state,response)=>reply(response,state.downloads?403:200,{
      actionExecutionId:ids[7],operationId:ids[6],authorizationMinZedToken:'fresh',
      targetResource:{resourceId:ids[10],nativeRef:ids[2],nativeInstanceRef:'delivered-instance',nativeScopeRef:ids[1]},
    })}],
    ['native moved after download',{}],
  ]) await t.test(label,async nested=>{
    const fixture=await setup(nested,{operation:'execute',validation:true,businessAction:actionKey,
      arguments:argumentsValue,serviceRead:true,...changes});
    if (label==='missing frozen version') changes.versions.Versions[0].PreSignedGET.Url=
      `${new URL(fixture.config.cellsRestBaseUrl).origin}/native-bytes?versionId=other`;
    if (label==='native moved after download') fixture.state.onDownload=()=>{fixture.target.Path='documents/foreign/file.bin';};
    const answer=await fixture.invoke({path:'/platform-adapter/v1/execute',key:ids[7],raw:canonical({
      actionKey,idempotencyKey:ids[7],arguments:argumentsValue,
    })});
    assert.notEqual(answer.status,200);
    assert.deepEqual(await answer.json(),{error:'adapter request refused'});
    assert.equal(fixture.state.receipts.length,0);
  });
});

test('new native read actions retain exact actor/key/policy and UNKNOWN observation without reread',async t=>{
  for (const actionKey of ['file_storage.list_revisions@v1','file_storage.export@v1']) {
    await t.test(actionKey,async nested=>{
      const input=actionKey==='file_storage.export@v1'
        ? {resourceId:ids[10],nativeObjectRef:ids[3],nativeRevision:'frozen-version',displayName:'file.bin',mediaType:'application/octet-stream'}
        : {resourceId:ids[10],nativeObjectRef:ids[3]};
      const fixture=await setup(nested,{operation:'execute',validation:true,businessAction:actionKey,
        arguments:{target:{resourceId:ids[10]},input},serviceRead:true});
      const request={path:'/platform-adapter/v1/execute',key:ids[7],raw:canonical({
        actionKey,idempotencyKey:ids[7],arguments:fixture.requestArguments,
      })};
      for (const [change,status] of [[{idempotency_key:ids[0]},401],[{result_exposure_policy_id:undefined},401],
        [{delegation_id:undefined},401],[{tenant_id:ids[0]},401],[{target_id:ids[0]},503]]) {
        assert.equal((await fixture.invoke({...request,token:fixture.token(change)})).status,status,JSON.stringify(change));
        assert.equal(fixture.state.nativeReads.length,0);
      }
      const observed=await setup(nested,{operation:'observe',businessAction:actionKey,
        arguments:{externalExecutionId:ids[8],idempotencyKey:ids[7],nativeType:'node',nativeId:ids[3]}});
      const answer=await observed.invoke({path:'/platform-adapter/v1/observe',key:ids[7]});
      assert.equal(answer.status,200);
      const value=await answer.json();
      assert.equal(value.execution.platformStatus,'UNKNOWN');
      assert.equal(value.execution.nativeId,ids[3]);
      assert.equal(Object.hasOwn(value.execution,'terminalAt'),false);
      assert.equal(Object.hasOwn(value,'resultJson'),false);
      assert.equal(observed.state.nativeReads.length,0);
    });
  }
});

async function mcpWireClient(t, fixture, headers = {}) {
  const [{Client},{StreamableHTTPClientTransport}] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js'),
    import('@modelcontextprotocol/sdk/client/streamableHttp.js'),
  ]);
  const outgoing = {'x-kailo-gateway-authorization':`Bearer ${fixture.gatewayToken()}`,...headers};
  const wire = [];
  const transport = new StreamableHTTPClientTransport(new URL(`${fixture.adapterOrigin}${fixture.config.mcp?.path ?? '/mcp'}`), {
    fetch:async (url, options) => {
      const sent = new Headers(options?.headers);
      for (const [name,value] of Object.entries(outgoing)) {
        if (value === undefined) sent.delete(name);
        else sent.set(name,value);
      }
      if (typeof options?.body === 'string') wire.push(JSON.parse(options.body));
      return fetch(url,{...options,headers:sent});
    },
  });
  const client = new Client({name:'cells-native-wire-verifier',version:'1'}, {capabilities:{}});
  t.after(async () => {await client.close();});
  await client.connect(transport);
  return {client,outgoing,wire,transport};
}

test('actual SDK MCP carries published revision and binary export results in the governed typed response',async t=>{
  for (const actionKey of ['file_storage.list_revisions@v1','file_storage.export@v1']) for (const businessHuman of [false,true]) {
    await t.test(`${actionKey} ${businessHuman ? 'HUMAN' : 'AGENT'}`,async nested=>{
      const exporting=actionKey==='file_storage.export@v1';
      const input=exporting ? {resourceId:ids[10],nativeObjectRef:ids[3],nativeRevision:'frozen-version',
        displayName:'file.bin',mediaType:'application/octet-stream'} : {resourceId:ids[10],nativeObjectRef:ids[3]};
      const bytes=Buffer.from([0,255,1,254]);
      const fixture=await setup(nested,{mcp:true,operation:'execute',validation:true,businessHuman,
        businessAction:actionKey,serviceRead:true,nativeBytes:bytes,
        arguments:{target:{resourceId:ids[10]},input},
        ...(exporting?{}:{versions:{Versions:[{VersionId:'frozen-version',IsHead:true},{VersionId:'older-version'}]}})});
      const {client,outgoing,wire}=await mcpWireClient(nested,fixture);
      const {tools}=await client.listTools();
      assert.equal(tools.length,1);
      assert.deepEqual(tools[0].inputSchema,fixture.config.mcp.tools[0].inputSchema);
      outgoing.authorization=`Bearer ${fixture.token()}`;
      outgoing['idempotency-key']=ids[7];
      const result=await client.callTool({name:tools[0].name,arguments:input});
      assert.equal(result.isError,false);
      assert.deepEqual(result.content,[]);
      const typed=result.structuredContent;
      assert.equal(typed.execution.platformStatus,'SUCCEEDED');
      assert.equal(typed.execution.nativeId,ids[3]);
      if (exporting) {
        assert.deepEqual(JSON.parse(typed.resultJson),{contentBase64:bytes.toString('base64'),
          filename:input.displayName,mediaType:input.mediaType});
        assert.deepEqual(typed.contentReference,input);
      } else {
        assert.deepEqual(JSON.parse(typed.resultJson),{citations:typed.contentReferences});
        assert.deepEqual(typed.contentReferences.map(value=>value.nativeRevision),['frozen-version','older-version']);
        assert.equal(fixture.state.downloads,undefined);
      }
      assert.deepEqual(wire.find(value=>value.method==='tools/call').params,{name:tools[0].name,arguments:input});
      assert.equal(fixture.state.receipts.length,0);
    });
  }
});

test('pinned SDK MCP init/list/call consumes delivered names and original HUMAN/AGENT file results', async t => {
  for (const businessRead of [false,true]) for (const businessHuman of [false,true]) {
    await t.test(`${businessRead ? 'read' : 'list'} ${businessHuman ? 'HUMAN' : 'AGENT'}`,async nested => {
      const input = businessRead ? {resourceId:ids[10],nativeObjectRef:ids[3],nativeRevision:'frozen-version',
        displayName:'file.txt',mediaType:'text/plain'} : {resourceId:ids[10]};
      const fixture = await setup(nested,{mcp:true,operation:'execute',validation:true,businessHuman,
        businessRead,businessList:!businessRead,serviceRead:businessRead,serviceList:!businessRead,
        nativeBytes:Buffer.from('text'),arguments:{target:{resourceId:ids[10]},input}});
      const {client,outgoing,wire,transport} = await mcpWireClient(nested,fixture);
      assert.equal(transport.sessionId,undefined);
      const listed = await client.listTools();
      const definition = fixture.config.mcp.tools[0];
      assert.deepEqual(listed,{tools:[{name:definition.name,inputSchema:definition.inputSchema}]});
      assert.equal(fixture.state.nativeReads.length,0);
      assert.equal(fixture.state.peps,0);
      outgoing.authorization = `Bearer ${fixture.token()}`;
      outgoing['idempotency-key'] = ids[7];
      const called = await client.callTool({name:definition.name,arguments:input});
      assert.equal(called.isError,false);
      assert.deepEqual(called.content,[]);
      const raw = called.structuredContent;
      assert.equal(raw.execution.idempotencyKey,ids[7]);
      assert.equal(raw.execution.platformStatus,'SUCCEEDED');
      if (businessRead) {
        assert.deepEqual(JSON.parse(raw.resultJson),{text:'text'});
        assert.deepEqual(raw.contentReference,input);
        assert.equal(fixture.state.downloads,1);
      } else {
        assert.deepEqual(JSON.parse(raw.resultJson),{citations:raw.contentReferences});
        assert.equal(raw.contentReferences[0].nativeObjectRef,ids[3]);
      }
      assert.deepEqual(wire.find(value => value.method==='tools/call').params,{name:definition.name,arguments:input});
      assert.equal(fixture.state.receipts.length,0);
      assert.equal(fixture.state.secretReads.length,0);
      assert(!JSON.stringify(called).includes('PreSignedGET'));
    });
  }
});

test('MCP transport identity is mandatory on initialization and cannot borrow ActionToken or another Gateway caller',async t => {
  const fixture = await setup(t,{mcp:true,operation:'execute',validation:true,businessList:true,
    serviceList:true,arguments:{target:{resourceId:ids[10]},input:{resourceId:ids[10]}}});
  const now = Math.floor(Date.now()/1000);
  for (const [label,authorization] of [
    ['absent',undefined],['ActionToken',`Bearer ${fixture.token()}`],
    ['wrong signer',`Bearer ${fixture.gatewayToken({},fixture.privateKey)}`],
    ...[{sub:'another-caller'},{azp:'another-caller'},{iss:`${fixture.config.mcp.gatewayIssuer}/other`},
      {aud:'another-audience'},{exp:now},
      {iat:now+fixture.config.mcp.gatewayMaxTokenSeconds,exp:now+2*fixture.config.mcp.gatewayMaxTokenSeconds},{exp:now+90}]
      .map(value => [JSON.stringify(value),`Bearer ${fixture.gatewayToken(value)}`]),
  ]) await t.test(label,async nested => {
    await assert.rejects(mcpWireClient(nested,fixture,{'x-kailo-gateway-authorization':authorization}));
  });
  assert.equal(fixture.state.nativeReads.length,0);
  assert.equal(fixture.state.peps,0);
  assert.equal(fixture.state.receipts.length,0);
});

test('MCP discovery is absent without controlled config and rejects schema/action/name drift at startup',async t => {
  const fixture = await setup(t,{mcp:true,operation:'execute',validation:true,businessList:true,
    serviceList:true,arguments:{target:{resourceId:ids[10]},input:{resourceId:ids[10]}}});
  const original = fixture.config.mcp;
  const tool = original.tools[0];
  for (const changed of [
    {...original,gatewayAudience:'unrelated-audience'}, {...original,gatewayMaxTokenSeconds:0},
    {...original,path:'/platform-adapter/v1/execute'}, {...original,tools:[]},
    {...original,tools:[{...tool,inputSchemaDigest:'a'.repeat(64)}]},
    {...original,tools:[{...tool,actionKey:'file_storage.delete@v1'}]},
    {...original,tools:[{...tool,actionVersion:2}]},
    {...original,tools:[tool,tool]},
    {...original,tools:[tool,{...tool,name:'another-name'}]},
    {...original,tools:[tool,{...tool,actionKey:'file_storage.read@v1'}]},
  ]) assert.throws(() => configuration({...fixture.config,mcp:changed}), /adapter request refused/);
  const {client,outgoing} = await mcpWireClient(t,fixture);
  outgoing['x-kailo-gateway-authorization'] = undefined;
  await assert.rejects(client.listTools());
  const absent = await setup(t,{operation:'execute',validation:true,businessList:true,serviceList:true,
    arguments:{target:{resourceId:ids[10]},input:{resourceId:ids[10]}}});
  const [{Client},{StreamableHTTPClientTransport}] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js'),import('@modelcontextprotocol/sdk/client/streamableHttp.js'),
  ]);
  const absentClient = new Client({name:'absent-wire-verifier',version:'1'}, {capabilities:{}});
  t.after(async () => {await absentClient.close();});
  await assert.rejects(absentClient.connect(new StreamableHTTPClientTransport(new URL(`${absent.adapterOrigin}/mcp`),{
    requestInit:{headers:{'x-kailo-gateway-authorization':`Bearer ${fixture.gatewayToken()}`}},
  })));
  assert.equal(absent.state.nativeReads.length,0);
});

test('MCP calls keep signed action/version/key, target/hash, policy/delegation and final native authorization',async t => {
  const input = {resourceId:ids[10],nativeObjectRef:ids[3],nativeRevision:'frozen-version',displayName:'file.txt',mediaType:'text/plain'};
  for (const label of ['no action','transport as action','no key','key mismatch','version mismatch','action mismatch',
    'no policy','no delegation','unknown name','forged target','injected native URL']) await t.test(label,async nested => {
    const fixture = await setup(nested,{mcp:true,operation:'execute',validation:true,businessRead:true,serviceRead:true,
      nativeBytes:Buffer.from('text'),arguments:{target:{resourceId:ids[10]},input}});
    const changed = label==='no policy' ? {result_exposure_policy_id:undefined}
      : label==='no delegation' ? {delegation_id:undefined}
      : label==='version mismatch' ? {action_definition_version:2}
      : label==='action mismatch' ? {action_key:'file_storage.list@v1'}
      : label==='key mismatch' ? {idempotency_key:ids[8]} : {};
    const {client,outgoing} = await mcpWireClient(nested,fixture);
    if (label!=='no action') outgoing.authorization = `Bearer ${label==='transport as action' ? fixture.gatewayToken() : fixture.token(changed)}`;
    if (label!=='no key') outgoing['idempotency-key'] = ids[7];
    await assert.rejects(client.callTool({name:label==='unknown name' ? 'unapproved-tool' : fixture.config.mcp.tools[0].name,
      arguments:label==='forged target' ? {...input,resourceId:ids[8]}
        : label==='injected native URL' ? {...input,nativeUrl:fixture.adapterOrigin} : input}), error => {
      assert(error.message.includes('adapter request refused'));
      assert(!error.message.includes('frozen-version'));
      return true;
    });
    assert.equal(fixture.state.nativeReads.length,0);
    assert.equal(fixture.state.receipts.length,0);
  });
  await t.test('Gateway key withdrawal after native read suppresses buffered result',async nested => {
    const fixture = await setup(nested,{mcp:true,operation:'execute',validation:true,businessRead:true,serviceRead:true,
      nativeBytes:Buffer.from('text'),arguments:{target:{resourceId:ids[10]},input}});
    fixture.state.onDownload = () => writeFile(fixture.config.mcp.gatewayJwksFile,JSON.stringify({keys:[]}),{mode:0o600});
    const {client,outgoing} = await mcpWireClient(nested,fixture);
    outgoing.authorization = `Bearer ${fixture.token()}`;
    outgoing['idempotency-key'] = ids[7];
    await assert.rejects(client.callTool({name:fixture.config.mcp.tools[0].name,arguments:input}),/adapter request refused/);
    assert.equal(fixture.state.downloads,1);
    assert.equal(fixture.state.receipts.length,0);
  });
});

test('business target facts must be complete and fixed to the delivered instance and native scope', async t => {
  const argumentsValue = {target:{resourceId:ids[10]},input:{resourceId:ids[10]}};
  const targetResource = {resourceId:ids[10],nativeType:'folder',nativeRef:ids[2],
    nativeInstanceRef:'delivered-instance',nativeScopeRef:ids[1]};
  for (const supplied of [undefined,null,{}, {...targetResource,resourceId:ids[0]},
    {...targetResource,nativeInstanceRef:'another-instance'}, {...targetResource,nativeScopeRef:ids[0]},
    {...targetResource,nativeRef:'unverified-path'}, {...targetResource,secret:'must-not-be-disclosed'}]) {
    await t.test(JSON.stringify(supplied) ?? 'missing facts', async nested => {
      const fixture = await setup(nested, {operation:'execute',arguments:argumentsValue,validation:true,
        serviceList:true,businessList:true,pep:(_state,response)=>reply(response,200,{
          actionExecutionId:ids[7],operationId:ids[6],authorizationMinZedToken:'fresh',
          ...(supplied===undefined ? {} : {targetResource:supplied}),
        })});
      const answer = await fixture.invoke({path:'/platform-adapter/v1/execute',key:ids[7],
        raw:canonical({actionKey:'file_storage.list@v1',idempotencyKey:ids[7],arguments:argumentsValue})});
      assert.notEqual(answer.status,200);
      assert.equal(fixture.state.nativeReads.length,0);
      assert.equal(fixture.state.receipts.length,0);
    });
  }
});

test('different native directory receipt or final business PEP never discloses an unconfirmed result', async t => {
  const argumentsValue = {target:{resourceId:ids[10]},input:{resourceId:ids[10]}};
  for (const changes of [
    {readResult:state=>state.nativeReadReceipt ? {...state.nativeReadReceipt,contentSha256:'0'.repeat(64)} : {
      found:false,execution:{idempotencyKey:ids[7],nativeType:'node',platformStatus:'UNKNOWN',cancelCapability:'UNSUPPORTED',lastObservedAt:'2026-10-09T00:00:00Z'},
    }},
    {pep:(state,response)=>reply(response,state.peps===2 ? 403 : 200,{
      actionExecutionId:ids[7],operationId:ids[6],authorizationMinZedToken:'fresh',
      targetResource:{resourceId:ids[10],nativeType:'folder',nativeRef:ids[2],
        nativeInstanceRef:'delivered-instance',nativeScopeRef:ids[1]},
    })},
    {pep:(state,response)=>reply(response,200,{
      actionExecutionId:ids[7],operationId:ids[6],authorizationMinZedToken:'fresh',
      targetResource:{resourceId:ids[10],nativeType:'folder',nativeRef:state.peps===2 ? ids[3] : ids[2],
        nativeInstanceRef:'delivered-instance',nativeScopeRef:ids[1]},
    })},
  ]) await t.test(Object.keys(changes)[0],async nested=>{
    const fixture=await setup(nested,{operation:'execute',arguments:argumentsValue,validation:true,
      serviceList:true,businessList:true,...changes});
    const answer=await fixture.invoke({path:'/platform-adapter/v1/execute',key:ids[7],
      raw:canonical({actionKey:'file_storage.list@v1',idempotencyKey:ids[7],arguments:argumentsValue})});
    assert.notEqual(answer.status,200);
    assert.deepEqual(await answer.json(),{error:'adapter request refused'});
    assert.equal(fixture.state.receipts.length,0);
  });
});

test('node observation keeps a lost original read UNKNOWN and never replays native reads or PAT history', async t=>{
  for (const nativeId of [undefined,ids[2]]) await t.test(nativeId ?? 'lost native ACK',async nested=>{
    const argumentsValue={externalExecutionId:ids[8],idempotencyKey:ids[7],nativeType:'node',
      ...(nativeId===undefined ? {} : {nativeId})};
    const fixture=await setup(nested,{operation:'observe',arguments:argumentsValue,
      serviceList:true,businessList:true,businessHuman:true});
    const answer=await fixture.invoke({path:'/platform-adapter/v1/observe',key:ids[7]});
    assert.equal(answer.status,200);
    const result=await answer.json();
    assert.deepEqual({...result.execution,lastObservedAt:undefined},{idempotencyKey:ids[7],nativeType:'node',
      ...(nativeId===undefined ? {} : {nativeId}),platformStatus:'UNKNOWN',cancelCapability:'UNSUPPORTED',lastObservedAt:undefined});
    assert.ok(Number.isFinite(Date.parse(result.execution.lastObservedAt)));
    assert.equal(fixture.state.peps,2);
    assert.equal(fixture.state.nativeReads.length,0);
    assert.equal(fixture.state.receipts.length,0);
  });
});

test('SERVICE cannot borrow the business envelope and business callers cannot borrow SOURCE or PAT NONE',async t=>{
  const argumentsValue={target:{resourceId:ids[10]},input:{resourceId:ids[10]}};
  const service=await setup(t,{operation:'execute',arguments:argumentsValue,serviceList:true,validation:true,businessList:true});
  const token=service.token({initiating_human_principal_id:undefined,agent_principal_id:undefined,
    delegation_id:undefined,delegation_version:undefined,result_exposure_policy_id:undefined,result_exposure_policy_version:undefined});
  assert.equal((await service.invoke({path:'/platform-adapter/v1/execute',key:ids[7],token,
    raw:canonical({actionKey:'file_storage.list@v1',idempotencyKey:ids[7],arguments:argumentsValue})})).status,401);
  assert.equal(service.state.nativeReads.length,0);
  const sourceArgs={targetType:'RESOURCE',targetId:ids[10],input:{resourceId:ids[10]},authorizationTargetNativeRef:ids[2]};
  const human=await setup(t,{operation:'execute',arguments:sourceArgs,serviceList:true,businessList:true,businessHuman:true});
  assert.equal((await human.invoke({path:'/platform-adapter/v1/execute',key:ids[7],
    raw:canonical({actionKey:'file_storage.list@v1',idempotencyKey:ids[7],arguments:sourceArgs})})).status,401);
  assert.equal(human.state.nativeReads.length,0);
  const observation={externalExecutionId:ids[8],idempotencyKey:ids[7],nativeType:'node',nativeId:ids[2]};
  const pat=await setup(t,{operation:'observe',arguments:observation,human:true});
  assert.equal((await pat.invoke({path:'/platform-adapter/v1/observe',key:ids[7]})).status,401);
  assert.equal(pat.state.nativeReads.length,0);
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

// Execute the original browser API class, replacing module imports with its
// browser/SDK fixture only. No download implementation is copied into checks.
async function nativeDownloadFixture(failure, mobile = false) {
  const source = await readFile(new URL('../../frontend/assets/gui.ajax/res/js/core/http/PydioApi.js', import.meta.url), 'utf8');
  const state = { errors: [], downloads: [], signed: [], selections: [], copies: [], reads: [], writes: [], activeRepository: ids[9] };
  const cache = new Map();
  const repositories = new Map([[ids[9], { getSlug: () => 'documents' }],
    [ids[10], { getSlug: () => 'other-documents' }]]);
  class NativeNode {
    constructor(path, leaf = true) { this.path = path; this.leaf = leaf; this.metadata = new Map([['uuid', ids[3]], ['etag', 'native-etag']]); }
    getPath() { return this.path; }
    getLabel() { return this.path.slice(this.path.lastIndexOf('/') + 1); }
    getMetadata() { return this.metadata; }
    isLeaf() { return this.leaf; }
  }
  state.contextNode = new NativeNode('/folder', false);
  const messages = JSON.parse(await readFile(new URL('../../frontend/assets/core.pydio/i18n/zh-cn.all.json', import.meta.url), 'utf8'));
  const pydio = {
    Parameters: new Map([['ENDPOINT_S3_GATEWAY', '/io']]),
    getFrontendUrl: () => new URL('https://cells.example.invalid'),
    getPluginConfigs: () => new Map([['DOWNLOAD_ARCHIVE_FORMAT', 'zip']]),
    MessageHash: { 391: messages[391].other },
    getContextHolder: () => ({ getContextNode: () => state.contextNode }),
    user: { getActiveRepository: () => state.activeRepository, getRepositoriesList: () => repositories,
      getActiveRepositoryObject: () => repositories.get(state.activeRepository) },
    UI: { hasHiddenDownloadForm: () => true,
      sendDownloadToHiddenForm: (_selection, value) => state.downloads.push(value.presignedUrl),
      displayMessage: (kind, message) => state.errors.push({ kind, message }) },
  };
  const sandbox = {
    navigator: { userAgent: mobile ? 'iPhone' : 'Desktop' }, document: { location: { href: '' } }, window: {},
    // Existing cache cleanup is unrelated to the signing/error consumers.
    Math: Object.assign(Object.create(Math), { random: () => 1 }),
    lscache: { setBucket() {}, get: key => cache.get(key), set: (key, value) => cache.set(key, value) },
    debounce: callback => callback, AjxpNode: NativeNode,
    RestCreateSelectionRequest: class {}, TreeNode: class {},
    TreeServiceApi: class { async createSelection(request) {
      state.selections.push(request);
      if (failure === 'selection') throw new Error('native selection rejected');
      state.beforeSelectionResponse?.();
      return { SelectionUUID: ids[4] };
    } },
    awsLoader: async () => {
      if (failure === 'loader') throw new Error('native signing module unavailable');
      return { S3: class {
        getSignedUrl(operation, params) {
          if (failure === 'signer') throw new Error('native signing rejected');
          state.signed.push(JSON.parse(JSON.stringify({ operation, params })));
          return `https://cells.example.invalid/${params.Bucket}/${params.Key}?versionId=${params.VersionId || ''}`;
        }
        copyObject(params, callback) {
          state.copies.push(JSON.parse(JSON.stringify(params)));
          callback(failure === 'copy' ? new Error('native restore result unconfirmed') : null);
        }
        getObject(params, callback) {
          state.reads.push(JSON.parse(JSON.stringify(params)));
          callback(null, { Body: Buffer.from('original native text') });
        }
        putObject(params, callback) {
          state.writes.push(JSON.parse(JSON.stringify(params)));
          callback(null);
        }
      } };
    },
  };
  const Api = runInNewContext(source.replace(/^import .+$/gm, '').replace(/^export .+$/gm, 'PydioApi;'), sandbox);
  Api._PydioRestClient = { async getOrUpdateJwt() {
    if (failure === 'token') throw new Error('native session revoked');
    return 'native-current-user';
  } };
  const api = new Api();
  api.setPydioObject(pydio);
  const node = new NativeNode('/folder/file.txt');
  const selection = (unique = true, selected = node) => ({ isUnique: () => unique,
    getUniqueNode: () => selected, getSelectedNodes: () => [node, new NativeNode('/folder/other.txt')] });
  return { api, node, selection, state, sandbox, NativeNode, pydio, repositories };
}

// The four original browser consumers run together. Only browser storage, the
// REST transport and the external AWS SDK are fixtures; no upload/retry/auth
// implementation is copied from the production methods into the assertions.
async function nativeMultipartFixture() {
  const fixture = await nativeDownloadFixture();
  const {api, pydio, state, sandbox} = fixture;
  Object.assign(state, {notifications:[], parts:[], partCallbacks:[], completions:[], cleanups:[],
    sends:0, aborts:0, loads:0, refreshed:0, finished:0, timers:[], logout:[]});
  const messages = {210:'Upload error', 'html_uploader.status.error.aborted':'Upload aborted'};
  const uploaderConfig = new Map([['MULTIPART_UPLOAD_THRESHOLD','2'], ['MULTIPART_UPLOAD_PART_SIZE','2'],
    ['MULTIPART_UPLOAD_QUEUE_SIZE','1'], ['MULTIPART_UPLOAD_TIMEOUT_MINUTES','1']]);
  pydio.getPluginConfigs = () => uploaderConfig;
  pydio.notify = event => state.notifications.push(event);
  pydio.getController = () => ({fireAction:action => state.logout.push(action)});
  pydio.MessageHash['html_uploader.status.error.aborted'] = messages['html_uploader.status.error.aborted'];
  const Pydio = {getInstance:() => pydio, getMessages:() => messages};
  sandbox.Pydio = Pydio;
  const restSource = await readFile(new URL('../../frontend/assets/gui.ajax/res/js/core/http/RestClient.js', import.meta.url), 'utf8');
  const RestClient = runInNewContext(restSource.replace(/^import .+$/gm, '').replace(/^export .+$/gm, 'RestClient;'), {
    ApiClient:class {}, RestFrontSessionRequest:class {}, window:{location:{}},
  });
  const rest = new RestClient(pydio);
  state.token = {ExpiresAt:Math.floor(Date.now()/1000)+3600, AccessToken:'original-current-user'};
  rest.get = () => state.token;
  rest.store = token => {state.token=token;};
  rest.remove = () => {state.token=null;};
  rest.jwtEndpoint = async request => {
    assert.equal(request.AuthInfo.type,'refresh');
    state.refreshed++;
    return state.refresh ? state.refresh() : {data:{Token:{ExpiresAt:Math.floor(Date.now()/1000)+3600, AccessToken:'original-refreshed-user'}}};
  };
  api.constructor._PydioRestClient = rest;
  api.constructor._PydioClient = api;
  const credentials = {accessKeyId:'original-current-user'};
  class ManagedUpload {
    constructor(options) {
      this.options=options; this.parts={}; this.completeInfo={}; this.activeParts=1; this.doneParts=0;
      this.totalPartNumbers=1; this.isDoneChunking=true;
      this.service={config:{credentials}, uploadPart:params => {
        state.parts.push(params);
        return {on(){}, send:callback => state.partCallbacks.push(callback)};
      }};
      state.managed=this;
    }
    on() {}
    send(callback) {
      state.sends++; this.callback=callback;
      if(state.sendFailure) throw state.sendFailure;
      this.uploadPart(this.options.params.Body,1);
      if(state.concurrentPart) this.uploadPart(this.options.params.Body,2);
    }
    finishMultiPart() {state.completions.push(this.callback);}
    abort() {state.aborts++; this.cleanup(new Error(messages['html_uploader.status.error.aborted']));}
    cleanup(error) {
      if(this.failed) return;
      this.failed=true; state.cleanups.push(error); this.callback?.(error);
    }
    fillQueue() {}
  }
  const awsSdk={S3:{ManagedUpload}, config:{update:value => Object.assign(credentials,{accessKeyId:value.accessKeyId})},
    util:{string:{byteLength:value => value.length}, isBrowser:() => true,
      error:(error,properties) => Object.assign(error,properties)}};
  const loaderSource = await readFile(new URL('../../frontend/assets/gui.ajax/res/js/core/http/awsLoader.js',import.meta.url),'utf8');
  const load = runInNewContext(loaderSource.replace(/^import .+$/gm,'').replace('export default','')
    .replace("import(/* webpackChunkName: 'aws-sdk' */ 'aws-sdk')",'Promise.resolve(awsSdk)'), {
      PydioApi:api.constructor, awsSdk, setTimeout:callback => state.timers.push(callback),
    });
  sandbox.awsLoader = async () => {
    state.loads++;
    if(state.loaderFailure) throw state.loaderFailure;
    return load();
  };
  const observable = class {notify() {}};
  const statusSource = await readFile(new URL('../../frontend/assets/uploader.html/res/js/model/StatusItem.js',import.meta.url),'utf8');
  const StatusItem = runInNewContext(statusSource.replace(/^import .+$/gm,'').replace(/^export .+$/gm,'StatusItem;'), {
    Observable:observable, Pydio,
  });
  const itemSource = await readFile(new URL('../../frontend/assets/uploader.html/res/js/model/UploadItem.js',import.meta.url),'utf8');
  const UploadItem = runInNewContext(itemSource.replace(/^import .+$/gm,'').replace(/^export .+$/gm,'UploadItem;'), {
    StatusItem, Pydio, PydioApi:api.constructor,
    PartItem:class {getStatus() {return 'new';}},
    Configs:{getInstance:() => ({extensionAllowed(){}})},
    addEventListener(){}, window:{setTimeout:callback => state.timers.push(callback)},
  });
  const item = new UploadItem({name:'original-file.txt',size:4,length:4},fixture.node);
  item.getFullPath = () => 'documents/original-file.txt';
  const start = () => {
    const nextTimer=state.timers.length;
    item.process(() => {state.finished++;});
    // Advance only this call's original first-attempt browser timer.
    state.timers.splice(nextTimer,1)[0]();
  };
  const flush = async () => {await new Promise(resolve => setImmediate(resolve));};
  return {...fixture,rest,item,start,flush,load};
}

test('original native refresh rejects its real failure and clears the shared refresh promise', async t => {
  await t.test('refresh failure remains the original rejection, not an undefined credential',async () => {
    const {state,rest}=await nativeMultipartFixture();
    const refusal=new Error('original native refresh refused');
    state.token.ExpiresAt=0; state.refresh=async () => {throw refusal;};
    await assert.rejects(rest.getAuthToken(),error=>error===refusal);
    assert.deepEqual(state.logout,['logout']);
    state.token={ExpiresAt:0, AccessToken:'expired-original-user'}; state.refresh=null;
    assert.equal(await rest.getOrUpdateJwt(),'original-refreshed-user');
    assert.equal(state.refreshed,2);
  });
  for(const token of ['',undefined,null]) await t.test(`empty access token ${String(token)}`,async () => {
    const {state,rest}=await nativeMultipartFixture(); state.token.AccessToken=token;
    await assert.rejects(rest.getOrUpdateJwt(),error=>error==='invalid token');
  });
});

test('original native multipart session and initialization failures leave the real upload queue', async t => {
  for(const failure of ['refresh','empty token','signer loader']) await t.test(failure,async () => {
    const {state,rest,start,item,flush}=await nativeMultipartFixture();
    if(failure==='refresh') {
      state.token.ExpiresAt=0;
      state.refresh=async () => {throw new Error('native session revoked');};
    } else if(failure==='empty token') state.token.AccessToken='';
    else state.loaderFailure=new Error('original SDK unavailable');
    start(); await flush();
    assert.equal(state.sends,0);
    // Only the original bounded retry may run, and only before SDK dispatch.
    while(state.timers.length) {state.timers.shift()(); await flush();}
    assert.equal(state.sends,0);
    assert.equal(item.getStatus(),'error');
    assert.equal(state.finished,1);
    assert.equal(state.notifications.filter(value=>value==='longtask_starting').length,
      state.notifications.filter(value=>value==='longtask_finished').length);
    if(failure==='refresh') {
      assert.deepEqual(state.logout,['logout']);
      await assert.rejects(rest.getOrUpdateJwt());
    }
  });
  await t.test('confirmed pre-dispatch initialization failure retains original retry',async () => {
    const {state,start,flush,item}=await nativeMultipartFixture();
    state.loaderFailure=new Error('original SDK unavailable'); start(); await flush();
    assert.equal(state.timers.length,1); assert.equal(state.sends,0);
    state.loaderFailure=null; state.timers.shift()(); await flush();
    assert.equal(state.sends,1); assert.equal(state.parts.length,1);
    state.partCallbacks.shift()(null,{ETag:'original-part-etag'}); await flush();
    state.completions.shift()(null,{VersionId:'original-native-version'}); await flush();
    assert.equal(item.getStatus(),'loaded'); assert.equal(state.finished,1);
  });
});

test('original native multipart uncertain outcomes never automatically replay the whole file', async t => {
  for(const failure of ['part transport','complete transport','JWT before part','JWT before complete','send throw']) await t.test(failure,async () => {
    const {state,start,item,flush,rest}=await nativeMultipartFixture();
    if(failure==='JWT before part') {
      let calls=0; const original=rest.getOrUpdateJwt.bind(rest);
      rest.getOrUpdateJwt=() => ++calls===1 ? original() : Promise.reject(new Error('native session revoked'));
    }
    if(failure==='send throw') state.sendFailure=new Error('native dispatch result unconfirmed');
    start(); await flush();
    if(failure==='part transport') state.partCallbacks.shift()({message:'native part result unconfirmed',retryable:true},null);
    else if(failure==='JWT before complete') {
      rest.getOrUpdateJwt=() => Promise.reject(new Error('native session revoked'));
      state.partCallbacks.shift()(null,{ETag:'original-part-etag'});
    } else if(failure==='complete transport') {
      state.partCallbacks.shift()(null,{ETag:'original-part-etag'}); await flush();
      state.completions.shift()(new Error('native completion result unconfirmed'));
    }
    await flush();
    assert.equal(state.sends,1); assert.equal(state.parts.length,failure==='JWT before part'||failure==='send throw'?0:1);
    assert.equal(state.timers.length,0); assert.equal(item.getStatus(),'error'); assert.equal(state.finished,1);
    assert.equal(state.notifications.filter(value=>value==='longtask_finished').length,1);
  });
  await t.test('received authentication refusal retains same native part retry',async () => {
    const {state,start,item,flush}=await nativeMultipartFixture(); start(); await flush();
    state.partCallbacks.shift()({message:'native authentication refused',statusCode:401},null); await flush();
    assert.equal(state.sends,1); assert.equal(state.parts.length,2);
    assert.equal(state.parts[0].PartNumber,state.parts[1].PartNumber);
    state.partCallbacks.shift()(null,{ETag:'original-part-etag'}); await flush();
    state.completions.shift()(null,{VersionId:'original-native-version'}); await flush();
    assert.equal(item.getStatus(),'loaded'); assert.equal(state.finished,1);
  });
});

test('original native multipart token failure fences another pending part before SDK cleanup finishes', async t => {
  for(const outcome of ['pending cleanup refresh','rejected cleanup refresh']) await t.test(outcome,async () => {
    const {state,start,item,flush,rest}=await nativeMultipartFixture();
    state.concurrentPart=true;
    let calls=0, releasePart, releaseCleanup;
    const original=rest.getOrUpdateJwt.bind(rest);
    rest.getOrUpdateJwt=() => {
      calls++;
      if(calls===1) return original();
      if(calls===2) return Promise.reject(new Error('first part authentication refused'));
      if(calls===3) return new Promise(resolve=>{releasePart=resolve;});
      if(outcome==='pending cleanup refresh') return new Promise(resolve=>{releaseCleanup=resolve;});
      return Promise.reject(new Error('native cleanup authentication refused'));
    };
    start(); await flush();
    releasePart('late-other-part-token'); await flush();
    assert.equal(state.parts.length,0);
    if(releaseCleanup) {releaseCleanup('original-cleanup-token'); await flush();}
    assert.equal(state.managed.failed,true);
    assert.equal(state.managed._abortRequested,true);
    assert.equal(item.getStatus(),'error'); assert.equal(state.finished,1);
    assert.equal(state.sends,1); assert.equal(state.timers.length,0);
  });
});

test('original native multipart cancellation fences late token, part and completion callbacks', async t => {
  for(const phase of ['initial refresh','part refresh','part response','complete response','abort refresh rejection']) await t.test(phase,async () => {
    const {state,start,item,flush,rest}=await nativeMultipartFixture();
    let release;
    if(phase==='initial refresh') {
      state.token.ExpiresAt=0;
      state.refresh=() => new Promise(resolve=>{release=resolve;});
    } else if(phase==='part refresh') {
      let calls=0; const original=rest.getOrUpdateJwt.bind(rest);
      rest.getOrUpdateJwt=() => ++calls===2 ? new Promise(resolve=>{release=resolve;}) : original();
    }
    start(); await flush();
    if(phase==='complete response') {
      state.partCallbacks.shift()(null,{ETag:'original-part-etag'}); await flush();
    }
    if(phase==='abort refresh rejection') rest.getOrUpdateJwt=() => Promise.reject(new Error('native session revoked'));
    item.abort();
    if(phase==='initial refresh') release({data:{Token:{ExpiresAt:Math.floor(Date.now()/1000)+3600,AccessToken:'original-refreshed-user'}}});
    if(phase==='part refresh') release('original-refreshed-user');
    if(phase==='part response'||phase==='abort refresh rejection') state.partCallbacks.shift()({message:'late transport result',retryable:true},null);
    if(phase==='complete response') state.completions.shift()(null,{VersionId:'late-native-version'});
    await flush();
    assert.equal(item.getStatus(),'error'); assert.equal(state.finished,1); assert.equal(state.timers.length,0);
    assert.equal(state.sends,phase==='initial refresh'?0:1);
    assert.equal(state.parts.length,phase==='initial refresh'||phase==='part refresh'?0:1);
    assert.equal(state.completions.length,0);
    if(state.managed) {state.managed.uploadPart('late-part',2); state.managed.finishMultiPart(); await flush();}
    assert.equal(state.parts.length,phase==='initial refresh'||phase==='part refresh'?0:1);
  });
  for(const phase of ['initial refresh','complete response']) await t.test(`new manual attempt fences old ${phase}`,async () => {
    const {state,start,item,flush}=await nativeMultipartFixture();
    let release, oldCompletion;
    if(phase==='initial refresh') {
      state.token.ExpiresAt=0;
      state.refresh=() => new Promise(resolve=>{release=resolve;});
    }
    start(); await flush();
    if(phase==='complete response') {
      state.partCallbacks.shift()(null,{ETag:'first-original-part'}); await flush();
      oldCompletion=state.completions.shift();
    }
    item.abort(); start();
    if(release) release({data:{Token:{ExpiresAt:Math.floor(Date.now()/1000)+3600,AccessToken:'original-refreshed-user'}}});
    await flush();
    if(oldCompletion) oldCompletion(null,{VersionId:'old-late-version'});
    await flush();
    assert.equal(item.getStatus(),'loading'); assert.equal(state.finished,0);
    assert.equal(state.sends,phase==='initial refresh'?1:2);
    assert.equal(item.xhr,state.managed);
    state.partCallbacks.shift()(null,{ETag:'new-original-part'}); await flush();
    state.completions.shift()(null,{VersionId:'new-original-version'}); await flush();
    assert.equal(item.getStatus(),'loaded'); assert.equal(state.finished,1);
  });
});

test('original native download, archive, preview and version consumers use the loaded signer', async t => {
  for (const mode of ['file', 'folder', 'selection', 'mobile', 'preview', 'version', 'cache']) {
    await t.test(mode, async () => {
      const { api, node, selection, state, sandbox, NativeNode } = await nativeDownloadFixture(undefined, mode === 'mobile');
      if (mode === 'preview' || mode === 'cache') {
        const url = await api.buildPresignedGetUrl(node, null, 'image/png');
        assert.equal(url, 'https://cells.example.invalid/io/documents/folder/file.txt?versionId=');
        assert.equal(state.signed[0].params.ResponseContentDisposition, 'inline');
        assert.equal(state.signed[0].params.ResponseContentType, 'image/png');
        if (mode === 'cache') assert.equal(await api.buildPresignedGetUrl(node, null, 'image/png'), url);
      } else if (mode === 'version') {
        api.openVersion(node, 'original-opaque-revision');
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(state.signed[0].params.VersionId, 'original-opaque-revision');
        assert.equal(state.downloads.length, 1);
      } else {
        await api.downloadSelection(selection(mode !== 'selection', mode === 'folder' ? new NativeNode('/folder', false) : node));
        const url = mode === 'mobile' ? sandbox.document.location.href : state.downloads[0];
        assert.match(url, /^https:\/\/cells\.example\.invalid\/io\/documents\//);
        if (mode === 'selection') {
          assert.equal(state.selections.length, 1);
          assert.deepEqual(Array.from(state.selections[0].Nodes, value => value.Path), ['documents/folder/file.txt', 'documents/folder/other.txt']);
          assert.match(state.signed[0].params.Key, /-selection\.zip$/);
        } else if (mode === 'folder') assert.equal(state.signed[0].params.Key, 'documents/folder.zip');
      }
      assert.equal(state.signed.length, 1);
      assert.deepEqual(state.errors, []);
    });
  }
});

test('original native history and content consumers use the node workspace, not the active workspace', async t => {
  for (const mode of ['version', 'restore', 'file', 'folder', 'selection', 'plain read', 'plain write']) {
    await t.test(mode, async () => {
      const { api, node, selection, state, NativeNode } = await nativeDownloadFixture();
      node.getMetadata().set('repository_id', ids[10]);
      let completed;
      if (mode === 'version') await api.openVersion(node, 'original-opaque-revision');
      else if (mode === 'restore') await api.revertToVersion(node, 'original-opaque-revision', value => { completed = value; });
      else if (mode === 'plain read') await api.getPlainContent(node, value => { completed = value; });
      else if (mode === 'plain write') await api.postPlainTextContent(node, 'original edited content', value => { completed = value; });
      else if (mode === 'folder') {
        const folder = new NativeNode('/folder', false);
        folder.getMetadata().set('repository_id', ids[10]);
        await api.downloadSelection(selection(true, folder));
      } else {
        state.contextNode.getMetadata().set('repository_id', ids[10]);
        await api.downloadSelection(selection(mode !== 'selection'));
      }
      assert.deepEqual(state.errors, []);
      if (mode === 'restore') {
        assert.equal(state.copies.length, 1);
        assert.equal(state.copies[0].Key, 'other-documents/folder/file.txt');
        assert.equal(decodeURIComponent(state.copies[0].CopySource), 'io/other-documents/folder/file.txt?versionId=original-opaque-revision');
        assert.equal(completed, 'Copy version to original node');
      } else if (mode === 'plain read') {
        assert.equal(state.reads[0].Key, 'other-documents/folder/file.txt');
        assert.equal(completed, 'original native text');
      } else if (mode === 'plain write') {
        assert.equal(state.writes[0].Key, 'other-documents/folder/file.txt');
        assert.equal(completed, 'Ok');
      } else {
        assert.equal(state.signed.length, 1);
        assert.match(state.signed[0].params.Key, /^other-documents\//);
        if (mode === 'version') assert.equal(state.signed[0].params.VersionId, 'original-opaque-revision');
        if (mode === 'selection') assert.deepEqual(Array.from(state.selections[0].Nodes, value => value.Path),
          ['other-documents/folder/file.txt', 'documents/folder/other.txt']);
      }
    });
  }
});

test('original native workspace selection failures never fall back to the active same-path object', async t => {
  for (const invalid of ['removed', 'empty id', 'empty slug', 'missing active']) {
    for (const mode of ['version', 'restore', 'folder', 'selection', 'preview', 'plain read', 'plain write']) {
      await t.test(`${invalid}/${mode}`, async () => {
        const { api, node, selection, state, NativeNode, repositories, pydio } = await nativeDownloadFixture();
        const folder = new NativeNode('/folder', false);
        if (invalid === 'missing active') state.activeRepository = ids[11];
        else {
          node.getMetadata().set('repository_id', invalid === 'empty id' ? '' : ids[10]);
          folder.getMetadata().set('repository_id', node.getMetadata().get('repository_id'));
          if (invalid === 'removed') repositories.delete(ids[10]);
          if (invalid === 'empty slug') repositories.set(ids[10], { getSlug: () => '' });
        }
        let completed;
        if (mode === 'version') await api.openVersion(node, 'original-opaque-revision');
        else if (mode === 'restore') await api.revertToVersion(node, 'original-opaque-revision', value => { completed = value; });
        else if (mode === 'plain read') await api.getPlainContent(node, value => { completed = value; });
        else if (mode === 'plain write') await api.postPlainTextContent(node, 'original edited content', value => { completed = value; });
        else if (mode === 'preview') await assert.rejects(api.buildPresignedGetUrl(node), { message: pydio.MessageHash[391] });
        else await api.downloadSelection(selection(mode !== 'selection', mode === 'folder' ? folder : node));
        assert.deepEqual(state.signed, []);
        assert.deepEqual(state.copies, []);
        assert.deepEqual(state.reads, []);
        assert.deepEqual(state.writes, []);
        assert.deepEqual(state.selections, []);
        assert.deepEqual(state.downloads, []);
        assert.equal(completed, mode === 'plain write' ? false : undefined);
        assert.equal(state.errors.length, mode === 'preview' ? 0 : 1);
        if (state.errors.length) assert.equal(state.errors[0].message, pydio.MessageHash[391]);
      });
    }
  }
});

test('original native archive keeps its original context while selection RPC is pending', async () => {
  const { api, selection, state, NativeNode } = await nativeDownloadFixture();
  state.beforeSelectionResponse = () => {
    state.activeRepository = ids[10];
    state.contextNode = new NativeNode('/other-folder', false);
  };
  await api.downloadSelection(selection(false));
  assert.deepEqual(state.errors, []);
  assert.equal(state.signed[0].params.Key, `documents/folder/${ids[4]}-selection.zip`);
});

test('original native restore errors never close the original version panel or repeat copy', async t => {
  for (const failure of ['token', 'loader', 'copy']) {
    await t.test(failure, async () => {
      const { api, node, state } = await nativeDownloadFixture(failure);
      node.getMetadata().set('repository_id', ids[10]);
      let completed = false;
      await api.revertToVersion(node, 'original-opaque-revision', () => { completed = true; });
      assert.equal(completed, false);
      assert.equal(state.copies.length, failure === 'copy' ? 1 : 0);
      assert.equal(state.errors.length, 1);
      assert.equal(state.errors[0].kind, 'ERROR');
    });
  }
});

test('original native signing failures reject or reach the existing UI without hanging a download', async t => {
  for (const failure of ['token', 'loader', 'signer']) {
    for (const mode of ['promise', 'callback', 'download', 'version']) {
      await t.test(`${failure}/${mode}`, async () => {
        const { api, node, selection, state, sandbox } = await nativeDownloadFixture(failure);
        let callbacks = 0;
        if (mode === 'promise') {
          const pending = api.buildPresignedGetUrl(node);
          let outcome;
          pending.then(() => { outcome = 'fulfilled'; }, () => { outcome = 'rejected'; });
          await new Promise(resolve => setImmediate(resolve));
          assert.equal(outcome, 'rejected', 'completed signing dependencies must reject, not leave the caller pending');
          await assert.rejects(pending, /native /);
        }
        else if (mode === 'download') await api.downloadSelection(selection());
        else {
          if (mode === 'callback') assert.equal(api.buildPresignedGetUrl(node, () => { callbacks++; }), null);
          else api.openVersion(node, 'original-opaque-revision');
          await new Promise(resolve => setImmediate(resolve));
        }
        assert.equal(state.errors.length, mode === 'promise' ? 0 : 1);
        assert.equal(callbacks, 0, 'rejected signing cannot disclose a URL');
        if (state.errors.length) assert.equal(state.errors[0].kind, 'ERROR');
        assert.deepEqual(state.downloads, []);
        assert.equal(sandbox.document.location.href, '');
      });
    }
  }
  await t.test('selection RPC rejection', async () => {
    const { api, selection, state } = await nativeDownloadFixture('selection');
    await api.downloadSelection(selection(false));
    assert.deepEqual(state.errors, [{ kind: 'ERROR', message: 'native selection rejected' }]);
    assert.deepEqual(state.signed, []);
    assert.deepEqual(state.downloads, []);
  });
});
