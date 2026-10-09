// The original Cells Promote/Job consumers own this operation's first claim,
// side effects and durable revision. Observation never repeats a native copy.
import { Refused, exactKeys, nonempty, canonical, freshPep, fixedUrl, secret,
  readMeasurements } from '../../../client-kit/adapter/protocol.mjs';
import { claimsForNode } from './node-execution.mjs';
import { actorConfiguration, nativeJsonFetch } from './native-actor.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const writeAction = 'file_storage.write@v1';

export function writeConfiguration(value, config) {
  if (!exactKeys(value, ['nativeJobId', ...(value?.usageMeasurements === undefined ? [] : ['usageMeasurements'])])
    || !nonempty(value.nativeJobId) || value.nativeJobId.trim() !== value.nativeJobId
    || !config.management?.validation?.actionVersions.some(action => action.actionKey === writeAction)) throw new Refused(503);
  readMeasurements(value.usageMeasurements, 0);
  return Object.freeze(JSON.parse(canonical(value)));
}

function parsed(raw) {
  let value;
  try { value = JSON.parse(raw); } catch { throw new Refused(400); }
  if (canonical(value) !== raw) throw new Refused(400);
  return value;
}

function writeInput(args) {
  if (!exactKeys(args, ['target', 'input']) || !exactKeys(args.target, ['resourceId']) || !UUID.test(args.target.resourceId)
    || !exactKeys(args.input, ['resourceId', 'nativeObjectRef', 'nativeRevision', 'displayName', 'mediaType'])
    || args.input.resourceId !== args.target.resourceId
    || !['nativeObjectRef', 'nativeRevision', 'displayName', 'mediaType'].every(field => nonempty(args.input[field]))) throw new Refused(400);
  const reference = parsed(args.input.nativeObjectRef);
  if (!exactKeys(reference, ['nodeUuid', 'publish']) || !UUID.test(reference.nodeUuid)
    || reference.publish !== false) throw new Refused(400);
  return reference.nodeUuid;
}

function admittedResource(config, admitted, claims, node) {
  const resource = admitted.targetResource;
  if (!config.management?.validation || !resource || resource.resourceId !== claims.target_id
    || resource.nativeRef !== node || resource.nativeInstanceRef !== config.management.validation.nativeInstanceRef
    || resource.nativeScopeRef !== config.nativeWorkspaceId) throw new Refused(403);
  return resource;
}

function nativeResult(config, native, key, target, input, nativeId) {
  const execution = native?.execution;
  if (!exactKeys(execution, ['idempotencyKey', 'nativeType', 'platformStatus', 'cancelCapability', 'lastObservedAt',
    ...(Object.hasOwn(execution ?? {}, 'nativeId') ? ['nativeId'] : []),
    ...(Object.hasOwn(execution ?? {}, 'terminalAt') ? ['terminalAt'] : [])])
    || execution.idempotencyKey !== key || execution.nativeType !== 'version' || execution.cancelCapability !== 'UNSUPPORTED'
    || !nonempty(execution.lastObservedAt) || !Number.isFinite(Date.parse(execution.lastObservedAt))
    || !['UNKNOWN', 'RUNNING', 'SUCCEEDED'].includes(execution.platformStatus)) throw new Refused(503);
  if (execution.platformStatus !== 'SUCCEEDED') {
    if (!exactKeys(native, ['execution']) || Object.hasOwn(execution, 'nativeId') || Object.hasOwn(execution, 'terminalAt')
      || nativeId !== undefined) throw new Refused(503);
    return {execution};
  }
  if (!exactKeys(native, ['execution', 'contentReference', 'contentBytes']) || !nonempty(execution.nativeId)
    || !nonempty(execution.terminalAt) || !Number.isFinite(Date.parse(execution.terminalAt))
    || !Number.isSafeInteger(native.contentBytes) || native.contentBytes < 0
    || !exactKeys(native.contentReference, ['resourceId', 'nativeObjectRef', 'nativeRevision', 'displayName', 'mediaType'])
    || native.contentReference.resourceId !== target || !UUID.test(native.contentReference.nativeObjectRef)
    || native.contentReference.nativeRevision !== execution.nativeId
    || !['displayName', 'mediaType'].every(field => nonempty(native.contentReference[field]))
    || (nativeId !== undefined && nativeId !== execution.nativeId)) throw new Refused(503);
  if (input && (native.contentReference.nativeObjectRef !== writeInput({target:{resourceId:target}, input})
    || execution.nativeId === input.nativeRevision
    || ['displayName', 'mediaType'].some(field => native.contentReference[field] !== input[field]))) throw new Refused(503);
  const result = {execution, resultJson:'{}', contentReference:native.contentReference};
  if (Buffer.byteLength(canonical(result)) > config.maxBodyBytes) throw new Refused(503);
  return result;
}

export async function executeWrite(config, deadline, raw, key, token) {
  if (!config.write) throw new Refused(503);
  const request = parsed(raw);
  if (!exactKeys(request, ['actionKey', 'idempotencyKey', 'arguments']) || request.actionKey !== writeAction
    || !UUID.test(key) || request.idempotencyKey !== key) throw new Refused(400);
  const args = request.arguments;
  const node = writeInput(args);
  const claims = await claimsForNode(config, token, args, 'execute', [writeAction]);
  if (claims.idempotency_key !== key || !UUID.test(claims.external_execution_id)) throw new Refused(401);
  const resource = admittedResource(config, await freshPep(config, deadline, token, args, claims, 'execute'), claims, node);
  const base = fixedUrl(config.cellsRestBaseUrl); base.pathname = `${base.pathname.replace(/\/$/, '')}/`;
  const nativePath = `n/node/${node}/versions/${encodeURIComponent(args.input.nativeRevision)}/promote`;
  const nativeURL = new URL(nativePath, base);
  if (nativeURL.pathname !== `${base.pathname}${nativePath}`) throw new Refused(400);
  const native = await nativeJsonFetch(actorConfiguration(config, token, args, claims), deadline,
    nativeURL, {
      method:'POST', headers:{authorization:`Bearer ${await secret(config.cellsBearerFile)}`,
        'content-type':'application/json', 'idempotency-key':key}, body:canonical({Publish:false}),
    });
  const current = await claimsForNode(config, token, args, 'execute', [writeAction]);
  const after = admittedResource(config, await freshPep(config, deadline, token, args, current, 'execute'), current, node);
  if (canonical(resource) !== canonical(after)) throw new Refused(403);
  return nativeResult(config, native, key, claims.target_id, args.input);
}

export async function observeWrite(config, deadline, raw, key, token, operation = 'observe') {
  if (!config.write || !['observe', 'extract_usage'].includes(operation)) throw new Refused(503);
  const args = parsed(raw);
  if (!exactKeys(args, ['externalExecutionId', 'idempotencyKey', 'nativeType',
    ...(Object.hasOwn(args ?? {}, 'nativeId') ? ['nativeId'] : [])]) || !UUID.test(key) || args.idempotencyKey !== key
    || !UUID.test(args.externalExecutionId) || args.nativeType !== 'version'
    || (Object.hasOwn(args, 'nativeId') && !nonempty(args.nativeId))) throw new Refused(400);
  const claims = await claimsForNode(config, token, args, operation, [writeAction]);
  await freshPep(config, deadline, token, args, claims, operation);
  const base = fixedUrl(config.cellsRestBaseUrl); base.pathname = `${base.pathname.replace(/\/$/, '')}/`;
  const native = await nativeJsonFetch(actorConfiguration(config, token, args, claims), deadline, new URL('jobs/user', base), {
    method:'POST', headers:{authorization:`Bearer ${await secret(config.cellsBearerFile)}`, 'content-type':'application/json',
      'x-kailo-native-operation':operation}, body:canonical({JobIDs:[config.write.nativeJobId], LoadTasks:'Any'}),
  });
  const result = nativeResult(config, native, key, claims.target_id, undefined, args.nativeId);
  const current = await claimsForNode(config, token, args, operation, [writeAction]);
  await freshPep(config, deadline, token, args, current, operation);
  if (operation === 'observe') return result;
  if (result.execution.platformStatus !== 'SUCCEEDED' || !Array.isArray(config.write.usageMeasurements)
    || config.write.usageMeasurements.length === 0) throw new Refused(503);
  return {externalExecutionId:args.externalExecutionId, idempotencyKey:key, nativeType:'version',
    nativeId:result.execution.nativeId, measurements:readMeasurements(config.write.usageMeasurements, native.contentBytes)
      .map(entry => ({...entry, occurredAt:result.execution.terminalAt}))};
}
