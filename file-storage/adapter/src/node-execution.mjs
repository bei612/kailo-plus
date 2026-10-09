// FILE_STORAGE business actions use the original HUMAN/AGENT AE. SERVICE
// self-pull has a different signed envelope and keeps its own SOURCE receipt.
import { createHash } from 'node:crypto';
import { Refused, exactKeys, nonempty, canonical, verifiedClaims, freshPep, fixedUrl, secret, readMeasurements } from '../../../client-kit/adapter/protocol.mjs';
import { nativeFile, nativeRevisionListing } from './service-read.mjs';
import { nativeDocumentNode } from './query-revision.mjs';
import { actorConfiguration, nativeJsonFetch } from './native-actor.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const nodeActions = Object.freeze(['file_storage.read@v1', 'file_storage.list@v1',
  'file_storage.list_revisions@v1', 'file_storage.export@v1']);

export function readExecutionConfiguration(value) {
  if (!exactKeys(value, ['nativeJobId', 'usageMeasurements']) || !nonempty(value.nativeJobId)
    || value.nativeJobId.trim() !== value.nativeJobId || !Array.isArray(value.usageMeasurements)) throw new Refused(503);
  readMeasurements(value.usageMeasurements, 0);
  return Object.freeze(JSON.parse(canonical(value)));
}

function readTaskResult(native, key, target, input, nativeId, revisions) {
  const execution = native?.execution;
  const terminal = execution?.platformStatus === 'SUCCEEDED';
  if (!exactKeys(native, terminal ? ['execution', 'found', 'contentBytes', 'contentSha256', 'measurements',
    ...(revisions ? [] : ['contentReference'])] : ['execution', 'found'])
    || typeof native.found !== 'boolean' || !exactKeys(execution, ['idempotencyKey', 'nativeType', 'platformStatus', 'cancelCapability', 'lastObservedAt',
      ...(terminal ? ['nativeId', 'terminalAt'] : [])]) || execution.idempotencyKey !== key || execution.nativeType !== 'node'
    || execution.cancelCapability !== 'UNSUPPORTED' || !['UNKNOWN', 'RUNNING', 'SUCCEEDED'].includes(execution.platformStatus)
    || !nonempty(execution.lastObservedAt) || !Number.isFinite(Date.parse(execution.lastObservedAt))) throw new Refused(503);
  if (!terminal) {
    if ((!native.found && execution.platformStatus !== 'UNKNOWN') || nativeId !== undefined) throw new Refused(503);
    return native;
  }
  const reference = native.contentReference;
  if (!native.found || !UUID.test(execution.nativeId) || !nonempty(execution.terminalAt) || !Number.isFinite(Date.parse(execution.terminalAt))
    || !Number.isSafeInteger(native.contentBytes) || native.contentBytes < 0 || !/^[a-f0-9]{64}$/.test(native.contentSha256)
    || !Array.isArray(native.measurements) || (revisions && native.contentBytes <= 0)
    || (!revisions && (!exactKeys(reference, ['resourceId', 'nativeObjectRef', 'nativeRevision', 'displayName', 'mediaType'])
      || reference.resourceId !== target || reference.nativeObjectRef !== execution.nativeId
      || !['nativeRevision', 'displayName', 'mediaType'].every(field => nonempty(reference[field]))
      || (input && canonical(reference) !== canonical(input))))
    || (revisions && input && execution.nativeId !== input.nativeObjectRef)
    || (nativeId !== undefined && execution.nativeId !== nativeId)) throw new Refused(503);
  return native;
}

async function nativeReadTask(config, deadline, token, args, claims, key, operation) {
  const base = fixedUrl(config.cellsRestBaseUrl); base.pathname = `${base.pathname.replace(/\/$/, '')}/`;
  const native = await nativeJsonFetch(actorConfiguration(config, token, args, claims), deadline, new URL('jobs/user', base), {
    method:'POST', headers:{authorization:`Bearer ${await secret(config.cellsBearerFile)}`, 'content-type':'application/json',
      'idempotency-key':key, 'x-kailo-native-operation':operation},
    body:canonical({JobIDs:[config.readExecution.nativeJobId], LoadTasks:'Any'}),
  });
  const result = readTaskResult(native, key, claims.target_id, operation === 'execute' ? args.input : undefined, args.nativeId,
    claims.action_key === 'file_storage.list_revisions@v1');
  if (result.execution.platformStatus === 'SUCCEEDED'
    && canonical(readMeasurements(config.readExecution.usageMeasurements, result.contentBytes)) !== canonical(result.measurements)) throw new Refused(503);
  return result;
}

export async function claimsForNode(config, token, args, operation, actions = nodeActions) {
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
  // The recursive directory operation still has no one-key native completion
  // producer. Two matching current traversals are not a retained execution.
  // SERVICE's separately receipted desired-set listing is unchanged.
  if (listing || !config.readExecution) throw new Refused(503);
  const nativeConfig = actorConfiguration(config, token, args, claims);
  const nativeArgs = {input: args.input, authorizationTargetNativeRef: resource.nativeRef};
  let result;
  let references;
  let readReceipt;
  if (!UUID.test(claims.external_execution_id)) throw new Refused(401);
  const previous = await nativeReadTask(config, deadline, token, args, claims, key, 'execute');
  if (previous.found) {
    const current = await claimsForNode(config, token, args, 'execute');
    await freshPep(config, deadline, token, args, current, 'execute');
    // The retained receipt is evidence, not permission to fetch bytes again.
    return {execution: previous.execution};
  }
  if (revisions) {
    const listed = await nativeRevisionListing(nativeConfig, deadline, nativeArgs, claims);
    readReceipt = await nativeReadTask(config, deadline, token, args, claims, key, 'execute');
    if (readReceipt.execution.platformStatus !== 'SUCCEEDED' || readReceipt.contentBytes !== listed.bytes.length
      || readReceipt.contentSha256 !== createHash('sha256').update(listed.bytes).digest('hex')) throw new Refused(503);
    const items = listed.items;
    // Reuse the already-consumed typed citation result, not SERVICE's complete
    // desired-set/receipt format. Core verifies these references before its
    // original result policy discloses them; it creates no file directory.
    result = {citations: items};
    references = items.length === 0 ? {} : {contentReferences: items};
  } else {
    const file = await nativeFile(nativeConfig, deadline, nativeArgs, claims);
    readReceipt = await nativeReadTask(config, deadline, token, args, claims, key, 'execute');
    if (readReceipt.execution.platformStatus !== 'SUCCEEDED' || readReceipt.contentBytes !== file.bytes.length
      || readReceipt.contentSha256 !== createHash('sha256').update(file.bytes).digest('hex')) throw new Refused(503);
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
  await nativeDocumentNode(nativeConfig, deadline, {nativeObjectRef: args.input.nativeObjectRef,
    authorizationTargetNativeRef: resource.nativeRef}, current);
  const final = await claimsForNode(config, token, args, 'execute');
  const admittedFinal = await freshPep(config, deadline, token, args, final, 'execute');
  if (canonical(resourceForNode(config, admittedFinal, final, args)) !== canonical(resource)) throw new Refused(403);
  const response = {execution: readReceipt.execution,
    resultJson: canonical(result), ...references};
  // JSON escaping and typed references count toward the actual response
  // budget, not merely the native byte length measured during download.
  if (Buffer.byteLength(canonical(response), 'utf8') > config.maxBodyBytes) throw new Refused(503);
  return response;
}

export async function observeNode(config, deadline, raw, key, token, operation = 'observe') {
  let args;
  try { args = JSON.parse(raw); } catch { throw new Refused(400); }
  if (!exactKeys(args, ['externalExecutionId', 'idempotencyKey', 'nativeType',
    ...(Object.hasOwn(args ?? {}, 'nativeId') ? ['nativeId'] : [])])
    || !UUID.test(args.externalExecutionId) || !UUID.test(key) || args.idempotencyKey !== key
    || args.nativeType !== 'node' || (args.nativeId !== undefined && !UUID.test(args.nativeId))) throw new Refused(400);
  if (!['observe', 'extract_usage'].includes(operation)) throw new Refused(400);
  const claims = await claimsForNode(config, token, args, operation);
  await freshPep(config, deadline, token, args, claims, operation);
  if (config.readExecution && ['file_storage.read@v1', 'file_storage.export@v1', 'file_storage.list_revisions@v1'].includes(claims.action_key)) {
    const native = await nativeReadTask(config, deadline, token, args, claims, key, operation);
    const current = await claimsForNode(config, token, args, operation);
    await freshPep(config, deadline, token, args, current, operation);
    if (operation === 'observe') return {execution:native.execution};
    if (native.execution.platformStatus !== 'SUCCEEDED') throw new Refused(503);
    const expected = readMeasurements(config.readExecution.usageMeasurements, native.contentBytes);
    if (expected.length === 0 || canonical(expected) !== canonical(native.measurements)) throw new Refused(503);
    return {externalExecutionId:args.externalExecutionId, idempotencyKey:key, nativeType:'node', nativeId:native.execution.nativeId,
      measurements:native.measurements.map(value => ({...value, occurredAt:native.execution.terminalAt}))};
  }
  if (operation === 'extract_usage') throw new Refused(503);
  const current = await claimsForNode(config, token, args, operation);
  await freshPep(config, deadline, token, args, current, operation);
  // Fixed Cells GET/Lookup has no operation-key completion lookup. A current
  // node or a second read cannot prove that the original response completed.
  // Keep its original EE UNKNOWN; never replay bytes or borrow PAT history.
  return {execution: {idempotencyKey: key, nativeType: 'node',
    ...(args.nativeId === undefined ? {} : {nativeId: args.nativeId}), platformStatus: 'UNKNOWN',
    cancelCapability: 'UNSUPPORTED', lastObservedAt: new Date().toISOString()}};
}
