// Original DOCUMENT PAT metadata/revocation only. This is not a content read,
// a launch retry, or permission to execute another native file operation.
import { Refused, exactKeys, canonical, nonempty, verifyToken, freshPep,
  secret, fixedUrl, jsonFetch } from './query-revision.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function input(raw, key) {
  let args;
  try { args = JSON.parse(raw); } catch { throw new Refused(400); }
  if (!exactKeys(args, ['protocolSessionId', 'nativeObjectRef', 'idempotencyKey'])
    || !UUID.test(args.protocolSessionId) || !UUID.test(args.nativeObjectRef)
    || args.protocolSessionId !== key || args.idempotencyKey !== key
    || raw !== canonical(args)) throw new Refused(400);
  return args;
}

function observation(value, args, operation) {
  const absent = value?.nativeState === 'ABSENT';
  if (!exactKeys(value, absent
    ? ['protocolSessionId', 'nativeObjectRef', 'nativeState']
    : ['protocolSessionId', 'nativeObjectRef', 'nativeState', 'nativeSessionRef', 'expiresAt'])
    || value.protocolSessionId !== args.protocolSessionId
    || value.nativeObjectRef !== args.nativeObjectRef
    || !['ACTIVE', 'EXPIRED', 'ABSENT'].includes(value.nativeState)
    || (operation === 'cancel' && !absent)) throw new Refused(503);
  if (!absent && (value.nativeSessionRef !== args.protocolSessionId
    || !nonempty(value.expiresAt) || !Number.isFinite(Date.parse(value.expiresAt))
    || (value.nativeState === 'ACTIVE') !== (Date.parse(value.expiresAt) > Date.now()))) {
    throw new Refused(503);
  }
  return value;
}

export async function documentLifecycle(config, deadline, raw, key, token, operation) {
  if (!['observe', 'cancel'].includes(operation)) throw new Refused(400);
  const args = input(raw, key);
  const claims = await verifyToken(token, config, args, operation);
  if (claims.agent_principal_id !== undefined
    || claims.action_execution_id !== args.protocolSessionId) throw new Refused(401);
  await freshPep(config, deadline, token, args, claims, operation);
  const bearer = await secret(config.cellsBearerFile);
  const base = fixedUrl(config.cellsRestBaseUrl);
  base.pathname = `${base.pathname.replace(/\/$/, '')}/`;
  // The native endpoint checks the same frozen PAT UUID/node/expiry against
  // Core's binding-authenticated lifecycle PEP, and returns no PAT secret.
  // DELETE is an idempotent revocation of that original UUID, never PutFile.
  const value = await jsonFetch(config, deadline,
    new URL(`auth/token/document/${args.protocolSessionId}/${args.nativeObjectRef}`, base), {
      method: operation === 'cancel' ? 'DELETE' : 'GET',
      headers: { authorization: `Bearer ${bearer}` },
    });
  const answer = observation(value, args, operation);
  const current = await verifyToken(token, config, args, operation);
  await freshPep(config, deadline, token, args, current, operation);
  return answer;
}
