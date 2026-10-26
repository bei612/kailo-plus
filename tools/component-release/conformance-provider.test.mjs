// node --test tools/component-release/conformance-provider.test.mjs
// Ephemeral signer and simulated contexts only; never the Core conformance
// identity, a production binding or a real native instance.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { canonical } from '../../client-kit/adapter/protocol.mjs';
import { openProvider } from './conformance-provider.mjs';

const digest = (value) => createHash('sha256').update(canonical(value)).digest('hex');

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function fixture(t, change = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'conformance-provider-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const write = async (name, value, mode = 0o600) => {
    const path = join(dir, name);
    await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value), { mode });
    await chmod(path, mode);
    return path;
  };
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const kid = '7';
  const jwksFile = await write('jwks.json', { keys: [{ ...publicKey.export({ format: 'jwk' }), kid, alg: 'ES256', use: 'sig' }] }, 0o644);
  const id = { tenant: randomUUID(), workspace: randomUUID(), binding: randomUUID(), actor: randomUUID(), denied: randomUUID(),
    resource: randomUUID(), node: randomUUID(), policy: randomUUID(), external: randomUUID(), scope: randomUUID() };
  const native = createServer((request, response) => {
    if (change.weknoraToken) {
      response.setHeader('content-type', 'application/json');
      if (request.url !== `/api/v1/knowledge-bases/${id.node}` || request.headers.authorization !== 'Bearer native-fixture-bearer'
        || request.headers['x-api-key'] !== undefined) { response.writeHead(403).end('{}'); return; }
      response.end(JSON.stringify({ success: true, data: { id: id.node } })); return;
    }
    const match = /^\/v2\/n\/node\/([0-9a-f-]{36})\?Flags=WithMetaDefaults$/.exec(request.url);
    response.setHeader('content-type', 'application/json');
    if (!match || request.headers.authorization !== 'Bearer native-fixture-bearer' || match[1] !== id.node) {
      response.writeHead(404).end('{}');
      return;
    }
    response.end(JSON.stringify({ Uuid: id.node, Type: 'LEAF', Path: 'root/conformance.txt' }));
  });
  const nativeOrigin = await listen(native);
  t.after(() => native.close());
  const business = { tenantId: id.tenant, workspaceId: id.workspace, actionKey: 'file_storage.read@v2', actionDefinitionVersion: 1,
    targetType: 'RESOURCE', targetId: id.resource, resultExposurePolicyId: id.policy, resultExposurePolicyVersion: 1,
    authorizationMinZedToken: 'isolated-revision', externalExecutionId: id.external };
  const identity = { artifactDigest: 'a'.repeat(64), issuer: 'https://isolated.invalid/issuer', audience: 'isolated-adapter',
    tokenSeconds: 30, secretLocator: 'platform/kv/isolated', secretVersion: 7, secretAudience: 'core', privateKeyField: 'privateKey',
    jwksFile, contexts: [
      { caseKey: 'file_storage:1:native_file', stepKey: 'read', operation: 'execute', actorPrincipalId: id.actor, ...business },
      { caseKey: 'file_storage:1:native_file', stepKey: 'permission-denied:read', operation: 'execute', actorPrincipalId: id.denied, ...business },
      { caseKey: 'protocol_handshake', stepKey: 'handshake', operation: 'handshake', tenantId: id.tenant, workspaceId: id.workspace,
        actorPrincipalId: id.actor, actionKey: 'application_binding.create', actionDefinitionVersion: 1, targetType: 'APPLICATION_BINDING',
        targetId: id.binding, authorizationMinZedToken: 'isolated-revision' },
    ] };
  const clientSecretFile = await write('client-secret', 'isolated-client-secret-value');
  const config = { mode: 'CONFORMANCE_ONLY', listenHost: '127.0.0.1', listenPort: 1,
    productionActionAudience: change.productionAudience ?? 'kailo-adapter-file-storage',
    identityFile: await write('identity.json', identity),
    bindingFile: await write('binding.json', { bindingId: id.binding, tenantId: id.tenant, workspaceId: id.workspace, bindingGeneration: 3,
      nativeInstanceRef: 'isolated-cells', nativeScopeRef: id.scope, serviceClientId: 'isolated-client',
      serviceClientSecretFile: clientSecretFile, artifactDigest: 'a'.repeat(64) }),
    targetsFile: await write('targets.json', { resources: { [id.resource]: { nativeType: 'node', nativeRef: id.node } } }),
    nativeCheck: change.weknoraToken
      ? { kind: 'weknora', apiBaseUrl: `${nativeOrigin}/`, tokenFile: await write('bearer', 'native-fixture-bearer') }
      : { kind: 'cells', restBaseUrl: `${nativeOrigin}/v2/`, bearerFile: await write('bearer', 'native-fixture-bearer') },
    requestTimeoutMs: 3000, requestMaxBytes: 65536 };
  if (change.nativeTask) {
    // DD-124(7): the rendered candidate declares a native task deadline for the
    // probed action (read stands in for Cells delete; only the declaration matters).
    config.releaseManifestFile = await write('manifest.json', { adapterBuildRef: 'a'.repeat(64), actionDefinitions: [
      { actionKey: 'file_storage.read@v2', executionMode: 'TEMPORAL', nativeTaskExecutionTimeoutSeconds: 3600 }] }, 0o644);
    config.nativeTaskTypes = change.nativeTaskTypes ?? { 'file_storage.read@v2': 'job' };
  }
  const configFile = await write('provider.json', config);
  const provider = await openProvider(configFile);
  const origin = await listen(provider.server);
  t.after(() => provider.close());
  const token = (claims) => {
    const now = Math.floor(Date.now() / 1000);
    const body = { jti: randomUUID(), iss: identity.issuer, aud: identity.audience, iat: now, exp: now + 30, ...claims };
    const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid, typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify(body)).toString('base64url');
    const signature = sign('sha256', Buffer.from(`${header}.${payload}`), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    return `${header}.${payload}.${signature}`;
  };
  const bearer = async () => {
    const response = await fetch(`${origin}/oidc/token`, { method: 'POST', body: 'grant_type=client_credentials',
      headers: { authorization: `Basic ${Buffer.from('isolated-client:isolated-client-secret-value').toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded' } });
    assert.equal(response.status, 200);
    return (await response.json()).access_token;
  };
  const args = { target: { resourceId: id.resource }, input: { resourceId: id.resource, nativeObjectRef: id.node,
    nativeRevision: 'v1', displayName: 'conformance.txt', mediaType: 'text/plain' } };
  const executeClaims = (actor) => ({ tenant_id: id.tenant, workspace_id: id.workspace, actor_principal_id: actor,
    initiating_human_principal_id: actor, operation_id: randomUUID(), action_execution_id: randomUUID(),
    action_key: 'file_storage.read@v2', action_definition_version: 1, target_type: 'RESOURCE', target_id: id.resource,
    normalized_parameter_hash: digest(args), authorization_min_zed_token: 'isolated-revision',
    result_exposure_policy_id: id.policy, result_exposure_policy_version: 1, external_execution_id: id.external,
    idempotency_key: randomUUID() });
  const pep = async (body, auth) => fetch(`${origin}/service/v1/adapter/pep_check`, { method: 'POST',
    headers: { authorization: `Bearer ${auth ?? await bearer()}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const admission = async (body) => fetch(`${origin}/service/v1/adapter/request_native_task_execution_admission`, { method: 'POST',
    headers: { authorization: `Bearer ${await bearer()}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { id, args, token, executeClaims, pep, bearer, origin, write, configFile, config, admission };
}

test('allowed execute context receives the observed native reference after a fresh native read', async (t) => {
  const f = await fixture(t);
  const claims = f.executeClaims(f.id.actor);
  const response = await f.pep({ bindingId: f.id.binding, actionToken: f.token(claims), operation: 'execute', argumentsJson: canonical(f.args) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { actionExecutionId: claims.action_execution_id, operationId: claims.operation_id,
    authorizationMinZedToken: 'isolated-revision', bindingGeneration: 3,
    targetResource: { resourceId: f.id.resource, nativeType: 'node', nativeRef: f.id.node, nativeInstanceRef: 'isolated-cells',
      nativeScopeRef: f.id.scope } });
});

test('permission-denied actor receives Core\'s closed DENIED body and no native read', async (t) => {
  const f = await fixture(t);
  const response = await f.pep({ bindingId: f.id.binding, actionToken: f.token(f.executeClaims(f.id.denied)), operation: 'execute',
    argumentsJson: canonical(f.args) });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { class: 'DENIED', reason: 'PERMISSION_DENIED' });
});

test('changed arguments, unknown context, unauthenticated caller and read-edge routes are refused without a decision', async (t) => {
  const f = await fixture(t);
  const changed = { ...f.args, input: { ...f.args.input, nativeRevision: 'v2' } };
  for (const [label, body, status] of [
    ['hash mismatch', { bindingId: f.id.binding, actionToken: f.token(f.executeClaims(f.id.actor)), operation: 'execute', argumentsJson: canonical(changed) }, 403],
    ['no observe context', { bindingId: f.id.binding, actionToken: f.token({ ...f.executeClaims(f.id.actor),
      normalized_parameter_hash: digest({ operation: 'observe', arguments: f.args }) }), operation: 'observe', argumentsJson: canonical(f.args) }, 403],
    ['other binding', { bindingId: f.id.workspace, actionToken: f.token(f.executeClaims(f.id.actor)), operation: 'execute', argumentsJson: canonical(f.args) }, 400],
    ['session variant', { protocolSessionId: f.id.external, bindingId: f.id.binding, actionToken: 'x', operation: 'execute', argumentsJson: '{}' }, 400],
  ]) {
    const response = await f.pep(body);
    assert.equal(response.status, status, label);
    assert.deepEqual(await response.json(), {}, label);
  }
  assert.equal((await f.pep({}, 'forged-bearer')).status, 401);
  const grant = await fetch(`${f.origin}/service/v1/adapter/request_read_grant`, { method: 'POST',
    headers: { authorization: `Bearer ${await f.bearer()}` }, body: '{}' });
  assert.equal(grant.status, 404);
});

test('delivered facts are pinned: drift after start and production audience reuse fail closed', async (t) => {
  const f = await fixture(t);
  await f.write('targets.json', { resources: {} });
  const response = await f.pep({ bindingId: f.id.binding, actionToken: f.token(f.executeClaims(f.id.actor)), operation: 'execute',
    argumentsJson: canonical(f.args) }, 'not-yet-issued');
  assert.equal(response.status, 503);
  await assert.rejects(fixture(t, { productionAudience: 'isolated-adapter' }));
});

test('native task admission hands back the admitted probe token unchanged, pending until its pep_check (DD-124(7))', async (t) => {
  const f = await fixture(t, { nativeTask: true });
  const claims = f.executeClaims(f.id.actor);
  const probe = f.token(claims);
  const request = (deadline, execution = {}) => ({ bindingId: f.id.binding, actionExecutionId: claims.action_execution_id,
    execution: { externalExecutionId: f.id.external, idempotencyKey: claims.idempotency_key, nativeType: 'job',
      nativeId: claims.idempotency_key, ...execution }, nativeTaskDeadline: deadline });
  const early = new Date(Date.now() + 60_000).toISOString();
  let response = await f.admission(request(early));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { state: 'PENDING_REFERENCE', nativeTaskDeadline: early });

  const before = Date.now();
  response = await f.pep({ bindingId: f.id.binding, actionToken: probe, operation: 'execute', argumentsJson: canonical(f.args) });
  assert.equal(response.status, 200);
  const answer = await response.json();
  const deadline = answer.nativeTaskDeadline;
  assert.equal(new Date(Date.parse(deadline)).toISOString(), deadline);
  assert.ok(Date.parse(deadline) >= Math.floor(before / 1000) * 1000 + 3600_000 && Date.parse(deadline) <= Date.now() + 3600_000);
  // A later pep_check of the same probe never moves the frozen deadline.
  response = await f.pep({ bindingId: f.id.binding, actionToken: probe, operation: 'execute', argumentsJson: canonical(f.args) });
  assert.equal((await response.json()).nativeTaskDeadline, deadline);

  response = await f.admission(request(deadline));
  assert.equal(response.status, 200);
  const exp = JSON.parse(Buffer.from(probe.split('.')[1], 'base64url').toString()).exp;
  assert.deepEqual(await response.json(), { state: 'ADMITTED', actionToken: probe, argumentsJson: canonical(f.args),
    expiresAt: new Date(exp * 1000).toISOString(), nativeTaskDeadline: deadline });

  response = await f.admission(request(deadline, { nativeId: undefined }));
  assert.deepEqual(await response.json(), { state: 'PENDING_REFERENCE', nativeTaskDeadline: deadline });
  for (const [label, body] of [
    ['extended deadline', request(new Date(Date.parse(deadline) + 1000).toISOString())],
    ['other idempotency key', request(deadline, { idempotencyKey: randomUUID() })],
    ['other native type', request(deadline, { nativeType: 'node' })],
  ]) {
    response = await f.admission(body);
    assert.equal(response.status, 403, label);
    assert.deepEqual(await response.json(), {}, label);
  }
  // The permission-denied replay is refused and leaves no retained probe.
  const denied = f.executeClaims(f.id.denied);
  response = await f.pep({ bindingId: f.id.binding, actionToken: f.token(denied), operation: 'execute', argumentsJson: canonical(f.args) });
  assert.equal(response.status, 403);
  response = await f.admission({ ...request(early), actionExecutionId: denied.action_execution_id,
    execution: { externalExecutionId: f.id.external, idempotencyKey: denied.idempotency_key, nativeType: 'job', nativeId: 'x' } });
  assert.deepEqual(await response.json(), { state: 'PENDING_REFERENCE', nativeTaskDeadline: early });
});

test('without a declared native task the admission route does not exist; undeclared types fail closed (DD-124(7))', async (t) => {
  const f = await fixture(t);
  const response = await f.admission({});
  assert.equal(response.status, 404);
  const answer = await f.pep({ bindingId: f.id.binding, actionToken: f.token(f.executeClaims(f.id.actor)), operation: 'execute',
    argumentsJson: canonical(f.args) });
  assert.equal(Object.hasOwn(await answer.json(), 'nativeTaskDeadline'), false);
  await assert.rejects(fixture(t, { nativeTask: true, nativeTaskTypes: {} }));
  await assert.rejects(fixture(t, { nativeTask: true, nativeTaskTypes: { 'file_storage.read@v2': 'job', 'file_storage.delete@v2': 'job' } }));
});


test('forward native observation uses the delivered OIDC session without an API key', async (t) => {
  const f = await fixture(t, { weknoraToken: true });
  const response = await f.pep({ bindingId: f.id.binding, actionToken: f.token(f.executeClaims(f.id.actor)),
    operation: 'execute', argumentsJson: canonical(f.args) });
  assert.equal(response.status, 200);
  await f.write('bearer', 'rotated-without-refresh');
  const rejected = await f.pep({ bindingId: f.id.binding, actionToken: f.token(f.executeClaims(f.id.actor)),
    operation: 'execute', argumentsJson: canonical(f.args) });
  assert.notEqual(rejected.status, 200);
});
