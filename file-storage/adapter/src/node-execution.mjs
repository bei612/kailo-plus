// FILE_STORAGE business actions use the original HUMAN/AGENT AE. SERVICE
// self-pull has a different signed envelope and keeps its own SOURCE receipt.
import { createHash } from 'node:crypto';
import { Refused, exactKeys, nonempty, canonical, verifiedClaims, freshPep } from '../../../client-kit/adapter/protocol.mjs';
import { nativeListing } from './service-list.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const actions = ['file_storage.read@v1', 'file_storage.list@v1'];

async function claimsForNode(config, token, args, operation) {
  const claims = await verifiedClaims(token, config);
  for (const key of ['jti', 'tenant_id', 'actor_principal_id', 'initiating_human_principal_id',
    'operation_id', 'action_execution_id', 'target_id', 'result_exposure_policy_id']) {
    if (!UUID.test(claims[key])) throw new Refused(401);
  }
  if (claims.tenant_id !== config.tenantId || claims.target_type !== 'RESOURCE'
    || !actions.includes(claims.action_key)
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
    || !UUID.test(key) || request.idempotencyKey !== key || !actions.includes(request.actionKey)
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
  if (request.actionKey !== 'file_storage.list@v1' || !exactKeys(args.input, ['resourceId'])
    || !UUID.test(args.input.resourceId)) throw new Refused(400);
  const claims = await claimsForNode(config, token, args, 'execute');
  if (claims.action_key !== request.actionKey || (!Object.hasOwn(claims, 'agent_principal_id')
    && (claims.idempotency_key !== key || !UUID.test(claims.external_execution_id)))) throw new Refused(401);
  const admitted = await freshPep(config, deadline, token, args, claims, 'execute');
  const resource = resourceForNode(config, admitted, claims, args);
  const nativeArgs = {input: args.input, authorizationTargetNativeRef: resource.nativeRef};
  const items = await nativeListing(config, deadline, nativeArgs);
  const encoded = canonical(items);
  if (Buffer.byteLength(encoded, 'utf8') > config.maxBodyBytes) throw new Refused(503);
  if (canonical(await nativeListing(config, deadline, nativeArgs)) !== encoded) throw new Refused(409);
  const current = await claimsForNode(config, token, args, 'execute');
  const disclosed = await freshPep(config, deadline, token, args, current, 'execute');
  if (canonical(resourceForNode(config, disclosed, current, args)) !== canonical(resource)) throw new Refused(403);
  const at = new Date().toISOString();
  // FileStorageListOutput belongs to the SERVICE transfer contract. Business
  // observation exposes only the confirmed native reference/status, never a
  // second directory, file body or the component-to-component SOURCE receipt.
  return {execution: {idempotencyKey: key, nativeType: 'node', nativeId: resource.nativeRef,
    platformStatus: 'SUCCEEDED', cancelCapability: 'UNSUPPORTED', lastObservedAt: at, terminalAt: at}};
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
