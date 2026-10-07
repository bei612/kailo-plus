import { createHash } from 'node:crypto';
import { Refused, object, nonempty, exactKeys, canonical, fixedUrl, boundedBody,
  verifiedClaims, secret, jsonFetch, freshPep } from '../../../client-kit/adapter/protocol.mjs';
export { Refused, object, nonempty, exactKeys, canonical, fixedUrl, boundedBody,
  secret, jsonFetch, freshPep } from '../../../client-kit/adapter/protocol.mjs';
import { createServer } from 'node:http';
import { documentConfiguration, launchDocument } from './document-launch.mjs';
import { documentLifecycle } from './document-lifecycle.mjs';
import { readConfiguration, readFile } from './service-read.mjs';

// The fixed Cells REST v2 read seam and original DOCUMENT PAT launch share this
// binding adapter. Neither implies release activation or tool registration.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const QUERY_PATH = '/platform-adapter/v1/query_revision';

export function queryDigest(argumentsValue) {
  // The original collab_bridge::limits::canonical_json rule; query fields are
  // strings, so number / cross-language floating point conversion is absent.
  return createHash('sha256').update(canonical({ operation: 'query_revision', arguments: argumentsValue })).digest('hex');
}

export function configuration(value) {
  const required = ['bindingId', 'tenantId', 'nativeWorkspaceId', 'nativeRootRef',
    'cellsRestBaseUrl', 'cellsBearerFile', 'actionTokenIssuer', 'actionTokenAudience',
    'actionTokenJwksFile', 'corePepUrl', 'oidcTokenUrl', 'oidcClientId',
    'oidcClientSecretFile', 'timeoutMs', 'maxBodyBytes', 'listenHost', 'listenPort'];
  if (!object(value) || required.some((key) => !Object.hasOwn(value, key))
    || Object.keys(value).some((key) => ![...required, 'workspaceId', 'documentLaunch', 'readEdge'].includes(key))) throw new Refused(503);
  for (const key of ['bindingId', 'tenantId', 'nativeWorkspaceId', 'nativeRootRef']) {
    if (!UUID.test(value[key])) throw new Refused(503);
  }
  if (value.workspaceId !== undefined && !UUID.test(value.workspaceId)) throw new Refused(503);
  for (const key of required.filter((key) => !['timeoutMs', 'maxBodyBytes', 'listenPort'].includes(key))) {
    if (!nonempty(value[key])) throw new Refused(503);
  }
  for (const key of ['timeoutMs', 'maxBodyBytes', 'listenPort']) {
    if (!Number.isSafeInteger(value[key]) || value[key] <= 0) throw new Refused(503);
  }
  if (value.listenPort > 65535) throw new Refused(503);
  for (const key of ['cellsRestBaseUrl', 'corePepUrl', 'oidcTokenUrl', 'actionTokenIssuer']) fixedUrl(value[key]);
  const pep = fixedUrl(value.corePepUrl);
  if (pep.pathname !== '/service/v1/adapter/pep_check') throw new Refused(503);
  for (const key of ['cellsBearerFile', 'actionTokenJwksFile', 'oidcClientSecretFile']) {
    if (!value[key].startsWith('/')) throw new Refused(503);
  }
  return Object.freeze({ ...value, ...(value.readEdge === undefined ? {} : {readEdge:readConfiguration(value.readEdge)}), ...(value.documentLaunch === undefined ? {}
    : { documentLaunch: documentConfiguration(value.documentLaunch) }) });
}

function requestValue(raw, key) {
  let value;
  try { value = JSON.parse(raw); } catch { throw new Refused(400); }
  const keys = ['nativeObjectRef', 'idempotencyKey'];
  if (object(value) && Object.hasOwn(value, 'authorizationTargetNativeRef')) keys.push('authorizationTargetNativeRef');
  if (object(value) && Object.hasOwn(value, 'protocolReconcile')) keys.push('protocolReconcile');
  if (!exactKeys(value, keys) || !UUID.test(value.nativeObjectRef)
    || (value.authorizationTargetNativeRef !== undefined && !UUID.test(value.authorizationTargetNativeRef))
    || !nonempty(value.idempotencyKey) || /[\r\n]/.test(value.idempotencyKey)
    || value.idempotencyKey !== key) throw new Refused(400);
  // Core emits canonical JSON. Exact comparison also rejects duplicate keys,
  // which JSON.parse alone would silently resolve to their last value.
  if (raw !== canonical(value)) throw new Refused(400);
  return value;
}

export async function verifyToken(token, config, args, operation = 'query_revision') {
  try {
    const claims = await verifiedClaims(token, config);
    for (const key of ['jti', 'tenant_id', 'actor_principal_id',
      'initiating_human_principal_id', 'operation_id', 'action_execution_id', 'target_id']) {
      if (!UUID.test(claims[key])) throw new Refused(401);
    }
    if (claims.tenant_id !== config.tenantId
      || (config.workspaceId !== undefined && claims.workspace_id !== config.workspaceId)
      || (claims.workspace_id !== undefined && !UUID.test(claims.workspace_id))
      || !['RESOURCE', 'ASSET'].includes(claims.target_type)
      || !nonempty(claims.action_key) || !nonempty(claims.authorization_min_zed_token)
      || !Number.isSafeInteger(claims.action_definition_version) || claims.action_definition_version <= 0
      || claims.normalized_parameter_hash !== createHash('sha256')
        .update(canonical({ operation, arguments: args })).digest('hex')) throw new Refused(401);
    if (Object.hasOwn(claims, 'agent_principal_id')) {
      // The original Agent path still requires its exact delegation and
      // result policy; adding a HUMAN launch query does not weaken it.
      if (operation !== 'query_revision' || !UUID.test(claims.agent_principal_id) || !UUID.test(claims.delegation_id)
        || claims.actor_principal_id !== claims.agent_principal_id
        || !UUID.test(claims.result_exposure_policy_id)
        || !Number.isSafeInteger(claims.result_exposure_policy_version) || claims.result_exposure_policy_version <= 0
        || !Number.isSafeInteger(claims.delegation_version) || claims.delegation_version <= 0) throw new Refused(401);
    } else if (claims.actor_principal_id !== claims.initiating_human_principal_id
      || !['file_storage.open_view@v1', 'file_storage.open_edit@v1'].includes(claims.action_key)
      || ['delegation_id', 'delegation_version', 'result_exposure_policy_id',
        'result_exposure_policy_version'].some((key) => Object.hasOwn(claims, key))) {
      throw new Refused(401);
    }
    // This is only signature/scope validation. Both actor shapes must still
    // pass the binding-authenticated Core PEP before any native lookup.
    return claims;
  } catch (error) {
    if (error instanceof Refused) throw error;
    throw new Refused(401);
  }
}

function nativePath(value) {
  if (!nonempty(value) || value.includes('\\') || /[\x00-\x1f]/.test(value)
    || value.split('/').some((part) => part === '.' || part === '..')) throw new Refused(503);
  return value.replace(/\/$/, '');
}

function nativeNode(value, id, workspaceId, type) {
  if (!object(value) || value.Uuid !== id || value.Type !== type
    || !object(value.ContextWorkspace) || value.ContextWorkspace.Uuid !== workspaceId
    || value.IsRecycled === true || value.IsRecycleBin === true) throw new Refused(503);
  for (const flag of ['IsRecycled', 'IsRecycleBin']) {
    if (value[flag] !== undefined && typeof value[flag] !== 'boolean') throw new Refused(503);
  }
  return nativePath(value.Path);
}

export async function nativeDocumentNode(config, deadline, args, claims) {
  if (claims.target_type === 'ASSET' && args.authorizationTargetNativeRef !== undefined
    && args.authorizationTargetNativeRef !== args.nativeObjectRef) throw new Refused(403);
  const bearer = await secret(config.cellsBearerFile);
  const base = fixedUrl(config.cellsRestBaseUrl);
  base.pathname = `${base.pathname.replace(/\/$/, '')}/`;
  const headers = { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' };
  const nodeUrl = (id) => new URL(`n/node/${id}?Flags=WithVersionsAll`, base);
  // UUID lookup resolves the fixed binding root before reading its member.
  // WithVersionsAll does not request pre-signed URLs; no path comes from input.
  const root = await jsonFetch(config, deadline, nodeUrl(config.nativeRootRef), { headers });
  const rootPath = nativeNode(root, config.nativeRootRef, config.nativeWorkspaceId, 'COLLECTION');
  let authorized;
  let authorizedPath;
  if (args.authorizationTargetNativeRef !== undefined) {
    authorized = args.authorizationTargetNativeRef === config.nativeRootRef ? root
      : await jsonFetch(config, deadline, nodeUrl(args.authorizationTargetNativeRef), { headers });
    if (!['COLLECTION', 'LEAF'].includes(authorized?.Type)) throw new Refused(503);
    authorizedPath = nativeNode(authorized, args.authorizationTargetNativeRef, config.nativeWorkspaceId, authorized.Type);
    if (authorized.Uuid !== config.nativeRootRef && !authorizedPath.startsWith(`${rootPath}/`)) throw new Refused(403);
  }
  const target = authorized?.Uuid === args.nativeObjectRef ? authorized
    : await jsonFetch(config, deadline, nodeUrl(args.nativeObjectRef), { headers });
  const targetPath = nativeNode(target, args.nativeObjectRef, config.nativeWorkspaceId, 'LEAF');
  if (!targetPath.startsWith(`${rootPath}/`)) throw new Refused(403);
  if (authorized) {
    if (authorized.Type === 'LEAF' ? authorized.Uuid !== target.Uuid
      : !targetPath.startsWith(`${authorizedPath}/`)) throw new Refused(403);
  }
  return { path: targetPath, target, base, headers };
}

export async function nativeDocumentTarget(config, deadline, args, claims) {
  const { path: targetPath, base, headers } = await nativeDocumentNode(config, deadline, args, claims);
  const response = await jsonFetch(config, deadline, new URL(`n/node/${args.nativeObjectRef}/versions`, base), {
    method: 'POST', headers,
    // Fixed c57f02f... NodeVersions reads Query directly, not {Query: ...}.
    // Limit zero asks the native list for all entries. A bounded response must
    // contain exactly one declared head; neither MTime nor ETag fills a gap.
    body: JSON.stringify({ FilterBy: 'VersionsAll', Offset: 0, Limit: 0, Flags: ['WithMetaNone'] }),
  });
  if (!object(response) || !Array.isArray(response.Versions) || !response.Versions.length) throw new Refused(503);
  const ids = new Set();
  const heads = [];
  for (const version of response.Versions) {
    if (!object(version) || !nonempty(version.VersionId) || ids.has(version.VersionId)
      || (version.IsHead !== undefined && typeof version.IsHead !== 'boolean')) throw new Refused(503);
    ids.add(version.VersionId);
    if (version.IsHead === true) heads.push(version.VersionId);
  }
  if (heads.length !== 1) throw new Refused(503);
  return { head: heads[0], path: targetPath };
}

async function originalWriteRevision(config, deadline, args, claims) {
  const frozen = args.protocolReconcile;
  const evidence = frozen?.writeObservation;
  if (!exactKeys(frozen, ['protocolSessionId', 'baseRevision', 'writeObservation'])
    || frozen.protocolSessionId !== args.idempotencyKey || !UUID.test(frozen.protocolSessionId)
    || !nonempty(frozen.baseRevision) || claims.agent_principal_id !== undefined
    || claims.action_execution_id !== frozen.protocolSessionId
    || args.authorizationTargetNativeRef !== undefined
    || !exactKeys(evidence, ['phase', 'correlationRef', 'editors', 'baseModifiedAt',
      'bytesWritten', 'nativeEtag', 'resultRevision']) || evidence.phase !== 'ACCEPTED'
    || !nonempty(evidence.correlationRef) || !nonempty(evidence.nativeEtag)
    || !nonempty(evidence.resultRevision) || !Number.isSafeInteger(evidence.bytesWritten)
    || evidence.bytesWritten < 0 || typeof evidence.editors !== 'string'
    || !nonempty(evidence.baseModifiedAt) || !Number.isFinite(Date.parse(evidence.baseModifiedAt))) {
    throw new Refused(403);
  }
  // This query checks the native result of this already attempted writer,
  // not a new read permission. Its signed immutable reference still has to
  // resolve inside the same native binding root/Workspace, with no byte read.
  const { base, headers } = await nativeDocumentNode(config, deadline, args, claims);
  const value = await jsonFetch(config, deadline, new URL(`n/node/${args.nativeObjectRef}/versions`, base), {
    method: 'POST', headers,
    body: JSON.stringify({ FilterBy: 'VersionsAll', Offset: 0, Limit: 0, Flags: ['WithMetaNone'] }),
  });
  if (!object(value) || !Array.isArray(value.Versions)) throw new Refused(503);
  const ids = new Set();
  let accepted;
  for (const version of value.Versions) {
    if (!object(version) || !nonempty(version.VersionId) || ids.has(version.VersionId)) throw new Refused(503);
    ids.add(version.VersionId);
    if (version.VersionId !== evidence.resultRevision) continue;
    // The native REST schema uses int64 JSON strings. Only an exact canonical
    // decimal encoding of the bounded metadata is accepted; no number guess.
    if (version.ETag !== evidence.nativeEtag || version.Size !== String(evidence.bytesWritten)
      || version.Draft === true || (version.Draft !== undefined && typeof version.Draft !== 'boolean')) {
      throw new Refused(503);
    }
    accepted = version.VersionId;
  }
  if (accepted === undefined) throw new Refused(503);
  return { nativeObjectRef: args.nativeObjectRef, nativeRevision: accepted,
    protocolSessionId: frozen.protocolSessionId, correlationRef: evidence.correlationRef };
}

export function createAdapter(rawConfig) {
  const config = configuration(rawConfig);
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'POST' || ![QUERY_PATH, '/platform-adapter/v1/execute',
        '/platform-adapter/v1/observe', '/platform-adapter/v1/cancel'].includes(request.url)) throw new Refused(404);
      if (request.headers['content-type'] !== 'application/json' || typeof request.headers.authorization !== 'string'
        || !request.headers.authorization.startsWith('Bearer ')) throw new Refused(401);
      const deadline = Date.now() + config.timeoutMs;
      const raw = await boundedBody(request, config.maxBodyBytes);
      if (['/platform-adapter/v1/observe', '/platform-adapter/v1/cancel'].includes(request.url)) {
        const operation = request.url.slice('/platform-adapter/v1/'.length);
        const value = await documentLifecycle(config, deadline, raw, request.headers['idempotency-key'],
          request.headers.authorization.slice(7), operation);
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        response.end(JSON.stringify(value));
        return;
      }
      if (request.url === '/platform-adapter/v1/execute') {
        let body;
        try { body=JSON.parse(raw); } catch { throw new Refused(400); }
        if (body?.actionKey === 'file_storage.read@v1') {
          const file=await readFile(config,deadline,raw,request.headers['idempotency-key'],request.headers.authorization.slice(7));
          response.writeHead(200,{'content-type':'application/octet-stream','cache-control':'no-store',
            'content-length':String(file.bytes.length),'x-kailo-native-object-ref':file.nativeObjectRef,
            'x-kailo-native-revision':file.nativeRevision,'x-kailo-content-sha256':file.sha256,
            'x-kailo-operation-id':file.operationId});
          response.end(file.bytes);
          return;
        }
        const value = await launchDocument(config, deadline, raw, request.headers['idempotency-key'],
          request.headers.authorization.slice(7));
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        response.end(JSON.stringify(value));
        return;
      }
      const args = requestValue(raw, request.headers['idempotency-key']);
      const token = request.headers.authorization.slice(7);
      const claims = await verifyToken(token, config, args);
      await freshPep(config, deadline, token, args, claims);
      const result = args.protocolReconcile === undefined
        ? { nativeObjectRef: args.nativeObjectRef,
          nativeRevision: (await nativeDocumentTarget(config, deadline, args, claims)).head }
        : await originalWriteRevision(config, deadline, args, claims);
      // A read can race revocation or token expiry. Never disclose a revision
      // on the strength of only the earlier PEP result.
      const currentClaims = await verifyToken(token, config, args);
      await freshPep(config, deadline, token, args, currentClaims);
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify(result));
    } catch (error) {
      if (!response.headersSent) response.writeHead(error instanceof Refused ? error.status : 503,
        { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end('{"error":"adapter request refused"}');
    }
  });
  server.requestTimeout = config.timeoutMs;
  server.headersTimeout = config.timeoutMs;
  server.timeout = config.timeoutMs;
  return server;
}
