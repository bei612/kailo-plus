import { Refused, exactKeys, nonempty, canonical, freshPep, fixedUrl, secret,
  readMeasurements } from '../../../client-kit/adapter/protocol.mjs';
import { claimsForNode } from './node-execution.mjs';
import { actorConfiguration, nativeJsonFetch } from './native-actor.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const deleteAction = 'file_storage.delete@v1';

export function deleteConfiguration(value, config) {
  if (!exactKeys(value, ['nativeJobId', 'usageMeasurements']) || !nonempty(value.nativeJobId)
    || value.nativeJobId.trim() !== value.nativeJobId
    || !config.management?.validation?.actionVersions.some(action => action.actionKey === deleteAction)
    || !Array.isArray(value.usageMeasurements) || value.usageMeasurements.length === 0
    || value.usageMeasurements.some(item => item?.quantitySource !== 'COUNT')) throw new Refused(503);
  // This action reports one fully acknowledged operation. Recursive delete
  // does not prove the byte count of every removed descendant.
  readMeasurements(value.usageMeasurements, 0);
  return Object.freeze(JSON.parse(canonical(value)));
}

function parsed(raw) {
  let value;
  try { value = JSON.parse(raw); } catch { throw new Refused(400); }
  if (canonical(value) !== raw) throw new Refused(400);
  return value;
}

function deleteInput(args) {
  if (!exactKeys(args, ['target', 'input']) || !exactKeys(args.target, ['resourceId']) || !UUID.test(args.target.resourceId)
    || !exactKeys(args.input, ['resourceId', 'nativeObjectRefs', 'removePermanently'])
    || args.input.resourceId !== args.target.resourceId || typeof args.input.removePermanently !== 'boolean'
    || !Array.isArray(args.input.nativeObjectRefs) || args.input.nativeObjectRefs.length === 0
    || args.input.nativeObjectRefs.some(id => typeof id !== 'string' || !UUID.test(id))
    || new Set(args.input.nativeObjectRefs).size !== args.input.nativeObjectRefs.length) throw new Refused(400);
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
    || !nonempty(execution.lastObservedAt) || !Number.isFinite(Date.parse(execution.lastObservedAt))
    || !['UNKNOWN', 'SUCCEEDED'].includes(execution.platformStatus)) throw new Refused(503);
  if (execution.platformStatus !== 'SUCCEEDED') {
    if (Object.hasOwn(execution, 'nativeId') || Object.hasOwn(execution, 'terminalAt') || nativeId !== undefined) throw new Refused(503);
    return {execution};
  }
  if (execution.nativeId !== key || (nativeId !== undefined && nativeId !== key)
    || !nonempty(execution.terminalAt) || !Number.isFinite(Date.parse(execution.terminalAt))) throw new Refused(503);
  const result = {execution, resultJson:'{}'};
  if (Buffer.byteLength(canonical(result)) > config.maxBodyBytes) throw new Refused(503);
  return result;
}

export async function executeDelete(config, deadline, raw, key, token) {
  if (!config.delete) throw new Refused(503);
  const request = parsed(raw);
  if (!exactKeys(request, ['actionKey', 'idempotencyKey', 'arguments']) || request.actionKey !== deleteAction
    || !UUID.test(key) || request.idempotencyKey !== key) throw new Refused(400);
  const args = request.arguments, input = deleteInput(args);
  const claims = await claimsForNode(config, token, args, 'execute', [deleteAction]);
  if (claims.idempotency_key !== key || !UUID.test(claims.external_execution_id)) throw new Refused(401);
  const resource = admittedResource(config, await freshPep(config, deadline, token, args, claims, 'execute'), claims);
  const base = fixedUrl(config.cellsRestBaseUrl); base.pathname = `${base.pathname.replace(/\/$/, '')}/`;
  const native = await nativeJsonFetch(actorConfiguration(config, token, args, claims), deadline, new URL('n/action/delete', base), {
    method:'POST', headers:{authorization:`Bearer ${await secret(config.cellsBearerFile)}`, 'content-type':'application/json', 'idempotency-key':key},
    body:canonical({Nodes:input.nativeObjectRefs.map(Uuid => ({Uuid})), DeleteOptions:{PermanentDelete:input.removePermanently}}),
  });
  const current = await claimsForNode(config, token, args, 'execute', [deleteAction]);
  const after = admittedResource(config, await freshPep(config, deadline, token, args, current, 'execute'), current);
  if (canonical(resource) !== canonical(after)) throw new Refused(403);
  return nativeResult(config, native, key);
}

export async function observeDelete(config, deadline, raw, key, token, operation = 'observe') {
  if (!config.delete || !['observe', 'extract_usage'].includes(operation)) throw new Refused(503);
  const args = parsed(raw);
  if (!exactKeys(args, ['externalExecutionId', 'idempotencyKey', 'nativeType', ...(Object.hasOwn(args ?? {}, 'nativeId') ? ['nativeId'] : [])])
    || !UUID.test(key) || args.idempotencyKey !== key || !UUID.test(args.externalExecutionId) || args.nativeType !== 'job'
    || (Object.hasOwn(args, 'nativeId') && args.nativeId !== key)) throw new Refused(400);
  const claims = await claimsForNode(config, token, args, operation, [deleteAction]);
  await freshPep(config, deadline, token, args, claims, operation);
  const base = fixedUrl(config.cellsRestBaseUrl); base.pathname = `${base.pathname.replace(/\/$/, '')}/`;
  const native = await nativeJsonFetch(actorConfiguration(config, token, args, claims), deadline, new URL('jobs/user', base), {
    method:'POST', headers:{authorization:`Bearer ${await secret(config.cellsBearerFile)}`, 'content-type':'application/json', 'x-kailo-native-operation':operation},
    body:canonical({JobIDs:[config.delete.nativeJobId], LoadTasks:'Any'}),
  });
  const result = nativeResult(config, native, key, args.nativeId);
  const current = await claimsForNode(config, token, args, operation, [deleteAction]);
  await freshPep(config, deadline, token, args, current, operation);
  if (operation === 'observe') return result;
  if (result.execution.platformStatus !== 'SUCCEEDED') throw new Refused(503);
  return {externalExecutionId:args.externalExecutionId, idempotencyKey:key, nativeType:'job', nativeId:result.execution.nativeId,
    measurements:readMeasurements(config.delete.usageMeasurements, 0).map(entry => ({...entry, occurredAt:result.execution.terminalAt}))};
}
