import { Refused, exactKeys, nonempty, canonical, freshPep, fixedUrl, secret,
  readMeasurements } from '../../../client-kit/adapter/protocol.mjs';
import { claimsForNode } from './node-execution.mjs';
import { actorConfiguration, nativeJsonFetch } from './native-actor.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const shareAction = 'file_storage.share@v1';

export function shareConfiguration(value, config) {
  if (!exactKeys(value, ['nativeJobId', 'usageMeasurements']) || !nonempty(value.nativeJobId)
    || value.nativeJobId.trim() !== value.nativeJobId
    || !config.management?.validation?.actionVersions.some(action => action.actionKey === shareAction)
    || !Array.isArray(value.usageMeasurements) || value.usageMeasurements.length === 0
    || value.usageMeasurements.some(item => item?.quantitySource !== 'COUNT')) throw new Refused(503);
  // One acknowledged share revocation; file bytes are never deleted.
  readMeasurements(value.usageMeasurements, 0);
  if (!config.cellShare) throw new Refused(503);
  return Object.freeze(JSON.parse(canonical(value)));
}

function parsed(raw) {
  let value;
  try { value = JSON.parse(raw); } catch { throw new Refused(400); }
  if (canonical(value) !== raw) throw new Refused(400);
  return value;
}

function shareInput(args) {
  if (!exactKeys(args, ['target', 'input']) || !exactKeys(args.target, ['resourceId']) || !UUID.test(args.target.resourceId)
    || !exactKeys(args.input, ['resourceId', 'nativeShareRef', 'operation'])
    || args.input.resourceId !== args.target.resourceId || args.input.operation !== 'REVOKE'
    || !UUID.test(args.input.nativeShareRef)) throw new Refused(400);
  return args.input;
}

function admittedResource(config, admitted, claims) {
  const resource = admitted.targetResource;
  if (!config.management?.validation || !resource || resource.resourceId !== claims.target_id
    || !UUID.test(resource.nativeRef) || resource.nativeInstanceRef !== config.management.validation.nativeInstanceRef
    || resource.nativeScopeRef !== config.nativeWorkspaceId) throw new Refused(403);
  // The original nativeActor consumer verifies each selected UUID beneath
  // this precise resource/root using the native user's ACLs.
  return resource;
}

function nativeResult(config, native, key, nativeId) {
  const execution = native?.execution;
  if (!exactKeys(native, ['execution']) || !exactKeys(execution, ['idempotencyKey', 'nativeType', 'platformStatus', 'cancelCapability', 'lastObservedAt',
    ...(Object.hasOwn(execution ?? {}, 'nativeId') ? ['nativeId'] : []),
    ...(Object.hasOwn(execution ?? {}, 'terminalAt') ? ['terminalAt'] : [])])
    || execution.idempotencyKey !== key || execution.nativeType !== 'job' || execution.cancelCapability !== 'UNSUPPORTED'
    || !nonempty(execution.lastObservedAt) || !Number.isFinite(Date.parse(execution.lastObservedAt)) || Date.parse(execution.lastObservedAt) > Date.now()
    || !['UNKNOWN', 'SUCCEEDED'].includes(execution.platformStatus)) throw new Refused(503);
  if (execution.platformStatus !== 'SUCCEEDED') {
    if (Object.hasOwn(execution, 'nativeId') || Object.hasOwn(execution, 'terminalAt') || nativeId !== undefined) throw new Refused(503);
    return {execution};
  }
  if (execution.nativeId !== key || (nativeId !== undefined && nativeId !== key)
    || !nonempty(execution.terminalAt) || !Number.isFinite(Date.parse(execution.terminalAt))
    || Date.parse(execution.terminalAt) > Date.parse(execution.lastObservedAt)) throw new Refused(503);
  const result = {execution, resultJson:'{}'};
  if (Buffer.byteLength(canonical(result)) > config.maxBodyBytes) throw new Refused(503);
  return result;
}

export async function executeShare(config, deadline, raw, key, token) {
  if (!config.share) throw new Refused(503);
  const request = parsed(raw);
  if (!exactKeys(request, ['actionKey', 'idempotencyKey', 'arguments']) || request.actionKey !== shareAction
    || !UUID.test(key) || request.idempotencyKey !== key) throw new Refused(400);
  const args = request.arguments, input = shareInput(args);
  const claims = await claimsForNode(config, token, args, 'execute', [shareAction]);
  if (claims.idempotency_key !== key || !UUID.test(claims.external_execution_id)) throw new Refused(401);
  const resource = admittedResource(config, await freshPep(config, deadline, token, args, claims, 'execute'), claims);
  const base = fixedUrl(config.cellsRestBaseUrl); base.pathname = `${base.pathname.replace(/\/$/, '')}/`;
  const native = await nativeJsonFetch(actorConfiguration(config, token, args, claims), deadline, new URL(`share/link/${input.nativeShareRef}`, base), {
    method:'DELETE', headers:{authorization:`Bearer ${await secret(config.cellsBearerFile)}`, 'content-type':'application/json', 'idempotency-key':key},
  });
  const current = await claimsForNode(config, token, args, 'execute', [shareAction]);
  const after = admittedResource(config, await freshPep(config, deadline, token, args, current, 'execute'), current);
  if (canonical(resource) !== canonical(after)) throw new Refused(403);
  return nativeResult(config, native, key);
}

export async function observeShare(config, deadline, raw, key, token, operation = 'observe') {
  if (!config.share || !['observe', 'extract_usage'].includes(operation)) throw new Refused(503);
  const args = parsed(raw);
  if (!exactKeys(args, ['externalExecutionId', 'idempotencyKey', 'nativeType', ...(Object.hasOwn(args ?? {}, 'nativeId') ? ['nativeId'] : [])])
    || !UUID.test(key) || args.idempotencyKey !== key || !UUID.test(args.externalExecutionId) || args.nativeType !== 'job'
    || (Object.hasOwn(args, 'nativeId') && args.nativeId !== key)) throw new Refused(400);
  const claims = await claimsForNode(config, token, args, operation, [shareAction]);
  await freshPep(config, deadline, token, args, claims, operation);
  const base = fixedUrl(config.cellsRestBaseUrl); base.pathname = `${base.pathname.replace(/\/$/, '')}/`;
  const native = await nativeJsonFetch(actorConfiguration(config, token, args, claims), deadline, new URL('jobs/user', base), {
    method:'POST', headers:{authorization:`Bearer ${await secret(config.cellsBearerFile)}`, 'content-type':'application/json', 'x-kailo-native-operation':operation},
    body:canonical({JobIDs:[config.share.nativeJobId], LoadTasks:'Any'}),
  });
  const result = nativeResult(config, native, key, args.nativeId);
  const current = await claimsForNode(config, token, args, operation, [shareAction]);
  await freshPep(config, deadline, token, args, current, operation);
  if (operation === 'observe') return result;
  if (result.execution.platformStatus !== 'SUCCEEDED') throw new Refused(503);
  return {externalExecutionId:args.externalExecutionId, idempotencyKey:key, nativeType:'job', nativeId:result.execution.nativeId,
    measurements:readMeasurements(config.share.usageMeasurements, 0).map(entry => ({...entry, occurredAt:result.execution.terminalAt}))};
}
