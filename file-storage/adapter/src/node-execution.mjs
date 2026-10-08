// FILE_STORAGE business actions use the original HUMAN/AGENT AE. SERVICE
// self-pull has a different signed envelope and keeps its own SOURCE receipt.
import { createHash } from 'node:crypto';
import { Refused, exactKeys, nonempty, canonical, verifiedClaims, freshPep } from '../../../client-kit/adapter/protocol.mjs';
import { nativeListing } from './service-list.mjs';
import { nativeFile, nativeRevisionListing } from './service-read.mjs';
import { nativeDocumentNode } from './query-revision.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const nodeActions = Object.freeze(['file_storage.read@v1', 'file_storage.list@v1',
  'file_storage.list_revisions@v1', 'file_storage.export@v1']);

async function claimsForNode(config, token, args, operation) {
  const claims = await verifiedClaims(token, config);
  for (const key of ['jti', 'tenant_id', 'actor_principal_id', 'initiating_human_principal_id',
    'operation_id', 'action_execution_id', 'target_id', 'result_exposure_policy_id']) {
    if (!UUID.test(claims[key])) throw new Refused(401);
  }
  if (claims.tenant_id !== config.tenantId || claims.target_type !== 'RESOURCE'
    || !nodeActions.includes(claims.action_key)
    || (config.workspaceId !== undefined && claims.workspace_id !== config.workspaceId)
    || (claims.workspace_id !== undefined && !UUID.test(claims.workspace_id))
    || !Number.isSafeInteger(claims.action_definition_version) || claims.action_definition_version <= 0
    || !Number.isSafeInteger(claims.result_exposure_policy_version) || claims.result_exposure_policy_version <= 0
    || !nonempty(claims.authorization_min_zed_token)
    || claims.normalized_parameter_hash !== createHash('sha256')
      .update(canonical(operation === 'execute' ? args : {operation, arguments: args})).digest('hex')) throw new Refused(401);
  if (Object.hasOwn(claims, 'agent_principal_id')) {
    if (!UUID.test(claims.agent_principal_id) || claims.actor_principal_id !== claims.agent_principal_id
      || !UUID.test(claims.delegation_id) || !Number.isSafeInteger(claims.delegation_version)
      || claims.delegation_version <= 0) throw new Refused(401);
  } else if (claims.actor_principal_id !== claims.initiating_human_principal_id
    || ['delegation_id', 'delegation_version'].some(key => Object.hasOwn(claims, key))) throw new Refused(401);
  return claims;
}

function resourceForNode(config, admitted, claims, args) {
  const resource = admitted.targetResource;
  const fixed = config.management?.validation;
  if (!fixed || !resource || resource.resourceId !== claims.target_id || args.target.resourceId !== claims.target_id
    || args.input.resourceId !== claims.target_id || !UUID.test(resource.nativeRef)
    || resource.nativeInstanceRef !== fixed.nativeInstanceRef
    || resource.nativeScopeRef !== config.nativeWorkspaceId) throw new Refused(403);
  return resource;
}

function requestValue(raw, key) {
  let request;
  try { request = JSON.parse(raw); } catch { throw new Refused(400); }
  if (!exactKeys(request, ['actionKey', 'idempotencyKey', 'arguments'])
    || !UUID.test(key) || request.idempotencyKey !== key || !nodeActions.includes(request.actionKey)
    || !exactKeys(request.arguments, ['target', 'input'])
    || !exactKeys(request.arguments.target, ['resourceId']) || !UUID.test(request.arguments.target.resourceId)) throw new Refused(400);
  // Core hashes the typed arguments, not HTTP property order. SERVICE calls
  // still require their original canonical read-grant transport unchanged.
  return request;
}

export async function executeNode(config, deadline, raw, key, token) {
  if (!config.readEdge) throw new Refused(503);
  const request = requestValue(raw, key);
  const args = request.arguments;
  const listing = request.actionKey === 'file_storage.list@v1';
  const revisions = request.actionKey === 'file_storage.list_revisions@v1';
  const exporting = request.actionKey === 'file_storage.export@v1';
  if (!exactKeys(args.input, listing ? ['resourceId'] : revisions ? ['resourceId', 'nativeObjectRef']
    : ['resourceId', 'nativeObjectRef', 'nativeRevision', 'displayName', 'mediaType'])
    || !UUID.test(args.input.resourceId) || (!listing && (!UUID.test(args.input.nativeObjectRef)
      || (!revisions && !['nativeRevision', 'displayName', 'mediaType'].every(field => nonempty(args.input[field])))))) throw new Refused(400);
  const claims = await claimsForNode(config, token, args, 'execute');
  if (claims.action_key !== request.actionKey || claims.idempotency_key !== key
    || (!Object.hasOwn(claims, 'agent_principal_id') && !UUID.test(claims.external_execution_id))) throw new Refused(401);
  const admitted = await freshPep(config, deadline, token, args, claims, 'execute');
  const resource = resourceForNode(config, admitted, claims, args);
  const nativeArgs = {input: args.input, authorizationTargetNativeRef: resource.nativeRef};
  let result;
  let references;
  if (listing || revisions) {
    const list = () => revisions ? nativeRevisionListing(config, deadline, nativeArgs, claims)
      : nativeListing(config, deadline, nativeArgs);
    const items = await list();
    if (canonical(await list()) !== canonical(items)) throw new Refused(409);
    // Reuse the already-consumed typed citation result, not SERVICE's complete
    // desired-set/receipt format. Core verifies these references before its
    // original result policy discloses them; it creates no file directory.
    result = {citations: items};
    references = items.length === 0 ? {} : {contentReferences: items};
  } else {
    const file = await nativeFile(config, deadline, nativeArgs, claims);
    if (exporting) {
      // The existing knowledge export result encodes an immediate authorized
      // response, not another native blob or a Core-persisted body. No lossy
      // decoding, presigned URL or source credential crosses this boundary.
      result = {contentBase64:file.bytes.toString('base64'),mediaType:args.input.mediaType,filename:args.input.displayName};
    } else {
      // Preserve UTF-8 including BOM; never guess text from a binary file.
      let text;
      try { text = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(file.bytes); }
      catch { throw new Refused(503); }
      result = {text};
    }
    references = {contentReference: {...args.input}};
  }
  const current = await claimsForNode(config, token, args, 'execute');
  const disclosed = await freshPep(config, deadline, token, args, current, 'execute');
  if (canonical(resourceForNode(config, disclosed, current, args)) !== canonical(resource)) throw new Refused(403);
  if (!listing) {
    await nativeDocumentNode(config, deadline, {nativeObjectRef: args.input.nativeObjectRef,
      authorizationTargetNativeRef: resource.nativeRef}, current);
    const final = await claimsForNode(config, token, args, 'execute');
    const admittedFinal = await freshPep(config, deadline, token, args, final, 'execute');
    if (canonical(resourceForNode(config, admittedFinal, final, args)) !== canonical(resource)) throw new Refused(403);
  }
  const at = new Date().toISOString();
  const response = {execution: {idempotencyKey: key, nativeType: 'node',
    nativeId: listing ? resource.nativeRef : args.input.nativeObjectRef,
    platformStatus: 'SUCCEEDED', cancelCapability: 'UNSUPPORTED', lastObservedAt: at, terminalAt: at},
    resultJson: canonical(result), ...references};
  // JSON escaping and typed references count toward the actual response
  // budget, not merely the native byte length measured during download.
  if (Buffer.byteLength(canonical(response), 'utf8') > config.maxBodyBytes) throw new Refused(503);
  return response;
}

export async function observeNode(config, deadline, raw, key, token) {
  let args;
  try { args = JSON.parse(raw); } catch { throw new Refused(400); }
  if (!exactKeys(args, ['externalExecutionId', 'idempotencyKey', 'nativeType',
    ...(Object.hasOwn(args ?? {}, 'nativeId') ? ['nativeId'] : [])])
    || !UUID.test(args.externalExecutionId) || !UUID.test(key) || args.idempotencyKey !== key
    || args.nativeType !== 'node' || (args.nativeId !== undefined && !UUID.test(args.nativeId))) throw new Refused(400);
  const claims = await claimsForNode(config, token, args, 'observe');
  await freshPep(config, deadline, token, args, claims, 'observe');
  const current = await claimsForNode(config, token, args, 'observe');
  await freshPep(config, deadline, token, args, current, 'observe');
  // Fixed Cells GET/Lookup has no operation-key completion lookup. A current
  // node or a second read cannot prove that the original response completed.
  // Keep its original EE UNKNOWN; never replay bytes or borrow PAT history.
  return {execution: {idempotencyKey: key, nativeType: 'node',
    ...(args.nativeId === undefined ? {} : {nativeId: args.nativeId}), platformStatus: 'UNKNOWN',
    cancelCapability: 'UNSUPPORTED', lastObservedAt: new Date().toISOString()}};
}
