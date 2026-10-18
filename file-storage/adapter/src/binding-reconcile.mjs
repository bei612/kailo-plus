import { Refused, exactKeys, canonical, nonempty, fixedUrl, secret, freshPep, verifyBindingManagementToken } from '../../../client-kit/adapter/protocol.mjs';
import { NATIVE_FINISHED, nativeJsonFetch } from './native-actor.mjs';
import { createHash } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function cellShareConfiguration(value) {
  if (!exactKeys(value, ['nativeJobId', 'bindingGeneration']) || !nonempty(value.nativeJobId)
    || value.nativeJobId.trim() !== value.nativeJobId || !Number.isSafeInteger(value.bindingGeneration)
    || value.bindingGeneration <= 0) throw new Refused(503);
  return Object.freeze({...value});
}

// No execution or enumeration authority is inferred from a PAT. The exact
// lifecycle ActionToken is checked at Core before and after native drainage;
// an old server ignoring the proof cannot acknowledge the native observation.
export async function reconcileBinding(config, deadline, raw, key, token) {
  let args;
  try { args = JSON.parse(raw); } catch { throw new Refused(400); }
  const delivered = config.management?.validation;
  if (!delivered || !config.cellShare) throw new Refused(503);
  const expected = {bindingId:config.bindingId, generation:config.cellShare.bindingGeneration,
    configDigest:createHash('sha256').update(canonical(delivered.normalizedConfig)).digest('hex'),
    nativeInstanceRef:delivered.nativeInstanceRef, nativeScopeRef:delivered.nativeScopeRef, idempotencyKey:key};
  if (!UUID.test(key) || raw !== canonical(args) || canonical(args) !== canonical(expected)) throw new Refused(403);
  const claims = await verifyBindingManagementToken(token, config, args, 'reconcile');
  await freshPep(config, deadline, token, args, claims, 'reconcile');
  const native = {...config, nativeActorContext:{
    proof:Buffer.from(canonical({actionToken:token, argumentsJson:raw})).toString('base64url'),
    acknowledgement:`${config.tenantId}:${config.bindingId}:RECONCILE:${claims.action_execution_id}`,
  }};
  const base = fixedUrl(config.cellsRestV1BaseUrl);
  base.pathname = `${base.pathname.replace(/\/$/,'')}/`;
  const result = await nativeJsonFetch(native, deadline, new URL('jobs/user',base), {
    method:'POST', headers:{authorization:`Bearer ${await secret(config.cellsBearerFile)}`,
      'content-type':'application/json','x-kailo-native-operation':'reconcile'},
    body:canonical({JobIDs:[config.cellShare.nativeJobId],LoadTasks:'Any'}),
  });
  if (!exactKeys(result,['reference','complete','observations']) || canonical(result.reference) !== raw
    || result.complete !== true || !Array.isArray(result.observations)) throw new Refused(503);
  const keys = new Set();
  for (const item of result.observations) {
    const terminal = item?.platformStatus === 'SUCCEEDED';
    const upload = item?.nativeType === 'version';
    if (!exactKeys(item,['idempotencyKey','nativeType',...(!upload || terminal ? ['nativeId'] : []),'nativeStatus','platformStatus','cancelCapability','lastObservedAt',
      ...(terminal ? ['terminalAt'] : [])]) || !UUID.test(item.idempotencyKey) || keys.has(item.idempotencyKey)
      || (!upload && (item.nativeType !== 'job' || item.nativeId !== item.idempotencyKey))
      || (upload && terminal && !nonempty(item.nativeId)) || item.cancelCapability !== 'UNSUPPORTED'
      || !['SUCCEEDED','UNKNOWN'].includes(item.platformStatus) || !nonempty(item.nativeStatus)
      || (terminal && item.nativeStatus !== NATIVE_FINISHED)
      || !Number.isFinite(Date.parse(item.lastObservedAt))
      || (terminal && (!Number.isFinite(Date.parse(item.terminalAt)) || Date.parse(item.terminalAt)>Date.parse(item.lastObservedAt)))) throw new Refused(503);
    keys.add(item.idempotencyKey);
  }
  const current = await verifyBindingManagementToken(token, config, args, 'reconcile');
  await freshPep(config, deadline, token, args, current, 'reconcile');
  return result;
}
