import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
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
  let requestArguments = changes.arguments ?? args;
  const business = changes.businessList || changes.businessRead;
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
      return reply(response, 200, { actionExecutionId: ids[7], operationId: ids[6], authorizationMinZedToken: `fresh-${state.peps}`,
        ...(business && operation === 'execute' ? {targetResource: {
          resourceId: ids[10], nativeType: 'folder', nativeRef: ids[2],
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
    if (request.url === '/native-bytes?versionId=frozen-version' && changes.serviceRead) {
      assert.equal(request.headers.authorization, undefined);
      state.downloads = (state.downloads ?? 0) + 1;
      await state.onDownload?.();
      response.writeHead(200, {'content-type':'application/octet-stream'});
      response.end(changes.nativeBytes ?? Buffer.from([0,255,1,254]));
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
      return reply(response, changes.nativeStatus ?? 200, changes.versions ?? (changes.serviceList
        ? {Versions:[{VersionId:changes.changeDuringList && state.listings>1?'changed-version':'frozen-version',IsHead:true}]}
        : changes.serviceRead
        ? {Versions:[{VersionId:'frozen-version',
          ...(changes.omitVersionSize?{}:{Size:Object.hasOwn(changes,'versionSize')?changes.versionSize:'4'}),
          PreSignedGET:{Url:`${origin}/native-bytes?versionId=frozen-version`}}]}
        : versions));
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
          { actionKey: 'file_storage.list@v1', actionVersion: 1 }],
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
        target_type:'RESOURCE',target_id:ids[10],action_key:changes.businessRead ? 'file_storage.read@v1' : 'file_storage.list@v1',
        delegation_id:changes.businessHuman ? undefined : ids[11], delegation_version:changes.businessHuman ? undefined : 1,
        result_exposure_policy_id:ids[9],result_exposure_policy_version:1,idempotency_key:ids[7],
        ...(changes.businessHuman ? {external_execution_id:ids[8]} : {}),
        normalized_parameter_hash:createHash('sha256').update(canonical(operation==='execute'
          ? requestArguments : {operation,arguments:requestArguments})).digest('hex')} : {}), ...change };
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
  return { state, token, invoke, target, proofFiles, requestArguments };
}

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

test('HUMAN and AGENT lists use the original business envelope and native UUID, not SERVICE receipts or Core body copies', async t => {
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
    const result = await answer.json();
    const citations=[{resourceId:ids[10],nativeObjectRef:ids[3],nativeRevision:'frozen-version',
      displayName:'file.txt',mediaType:'text/plain'}];
    assert.deepEqual(JSON.parse(result.resultJson),{citations});
    assert.deepEqual(result.contentReferences,citations);
    assert.deepEqual(Object.keys(result).sort(),['contentReferences','execution','resultJson']);
    assert.deepEqual({...result.execution,lastObservedAt:undefined,terminalAt:undefined}, {
      idempotencyKey:ids[7],nativeType:'node',nativeId:ids[2],platformStatus:'SUCCEEDED',
      cancelCapability:'UNSUPPORTED',lastObservedAt:undefined,terminalAt:undefined,
    });
    assert.ok(Number.isFinite(Date.parse(result.execution.lastObservedAt)));
    assert.equal(result.execution.terminalAt,result.execution.lastObservedAt);
    assert.equal(fixture.state.listings,2);
    assert.equal(fixture.state.peps,2);
    assert.equal(fixture.state.receipts.length,0);
    assert.equal(fixture.state.secretReads.length,0);
    assert.equal(fixture.state.queries.length,2);
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

test('empty business list is typed empty citations, not a SERVICE desired-set receipt',async t=>{
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
  assert.equal(Object.hasOwn(result,'contentReferences'),false);
  assert.equal(Object.hasOwn(result,'contentReference'),false);
  assert.equal(fixture.state.receipts.length,0);
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

test('changed native list or final business PEP never publishes a terminal observation', async t => {
  const argumentsValue = {target:{resourceId:ids[10]},input:{resourceId:ids[10]}};
  for (const changes of [
    {changeDuringList:true},
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
