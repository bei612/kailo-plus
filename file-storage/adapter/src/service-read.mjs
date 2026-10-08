// DD-89/SS-CEL-MATERIALIZATION. Cells remains the bytes/version authority.
// The presigned native URL never leaves this authenticated source Adapter.
import { createHash } from 'node:crypto';
import { Refused, object, exactKeys, nonempty, canonical, fixedUrl, boundedBytes,
  verifiedClaims, jsonFetch, freshPep, readMeasurements, recordReadReceipt } from '../../../client-kit/adapter/protocol.mjs';
import { nativeDocumentNode, nativeVersionSize } from './query-revision.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function readConfiguration(value) {
  if (!exactKeys(value, value?.usageMeasurements===undefined ? ['downloadOrigin'] : ['downloadOrigin','usageMeasurements'])) throw new Refused(503);
  readMeasurements(value.usageMeasurements, 0);
  const url = fixedUrl(value.downloadOrigin);
  if (url.origin !== value.downloadOrigin || url.pathname !== '/') throw new Refused(503);
  return Object.freeze({ ...value, downloadOrigin: url.origin });
}

export async function claimsForRead(config, token, args, actionKey = 'file_storage.read@v1') {
  const claims = await verifiedClaims(token, config);
  for (const key of ['jti','tenant_id','actor_principal_id','operation_id','action_execution_id','target_id']) {
    if (!UUID.test(claims[key])) throw new Refused(401);
  }
  if (claims.tenant_id !== config.tenantId || claims.target_type !== 'RESOURCE'
    || claims.action_key !== actionKey
    || (config.workspaceId !== undefined && claims.workspace_id !== config.workspaceId)
    || (claims.workspace_id !== undefined && !UUID.test(claims.workspace_id))
    || !Number.isSafeInteger(claims.action_definition_version) || claims.action_definition_version <= 0
    || !nonempty(claims.authorization_min_zed_token)
    || ['initiating_human_principal_id','agent_principal_id','delegation_id','delegation_version',
      'result_exposure_policy_id','result_exposure_policy_version'].some(key => Object.hasOwn(claims,key))
    || claims.normalized_parameter_hash !== createHash('sha256').update(canonical(args)).digest('hex')
    || args.targetType !== claims.target_type || args.targetId !== claims.target_id
    || args.input.resourceId !== claims.target_id) throw new Refused(401);
  return claims;
}

// Both actual consumers use the same UUID/version/presigned download. The
// caller retains its own signed identity, final PEP and disclosure/receipt path.
export async function nativeFile(config, deadline, args, claims) {
  const native=await nativeDocumentNode(config,deadline,{
    nativeObjectRef:args.input.nativeObjectRef,authorizationTargetNativeRef:args.authorizationTargetNativeRef,
  },claims);
  const history=await jsonFetch(config,deadline,new URL(`n/node/${args.input.nativeObjectRef}/versions`,native.base),{
    method:'POST',headers:native.headers,
    body:JSON.stringify({FilterBy:'VersionsAll',Offset:0,Limit:0,Flags:['WithPreSignedURLs']}),
  });
  if (!Array.isArray(history?.Versions)) throw new Refused(503);
  const versions=history.Versions.filter(item => item?.VersionId === args.input.nativeRevision);
  if (versions.length !== 1) throw new Refused(409);
  const version=versions[0];
  if (version.Draft === true || (version.Draft !== undefined && typeof version.Draft !== 'boolean')
    || !object(version.PreSignedGET)
    || !nonempty(version.PreSignedGET.Url)) throw new Refused(503);
  const expected=nativeVersionSize(version);
  if (expected > config.maxBodyBytes) throw new Refused(503);
  const url=new URL(version.PreSignedGET.Url);
  if (url.origin !== config.readEdge.downloadOrigin || url.username || url.password || url.hash
    || url.searchParams.get('versionId') !== version.VersionId) throw new Refused(503);
  const remaining=deadline-Date.now();
  if (remaining <= 0) throw new Refused(503);
  const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(remaining)});
  if (response.status !== 200 || !response.body || response.headers.has('content-range')) {
    await response.body?.cancel(); throw new Refused(503);
  }
  const bytes=await boundedBytes(response.body,config.maxBodyBytes);
  if (bytes.length !== expected) throw new Refused(503);
  return {bytes,nativeRevision:version.VersionId};
}

export async function readFile(config, deadline, raw, key, token) {
  if (config.readEdge === undefined) throw new Refused(503);
  let request;
  try { request=JSON.parse(raw); } catch { throw new Refused(400); }
  if (!exactKeys(request,['actionKey','idempotencyKey','arguments'])
    || request.actionKey !== 'file_storage.read@v1' || !UUID.test(request.idempotencyKey)
    || request.idempotencyKey !== key || raw !== canonical(request)) throw new Refused(400);
  const args=request.arguments;
  if (!exactKeys(args,['targetType','targetId','input','authorizationTargetNativeRef'])
    || !UUID.test(args.authorizationTargetNativeRef) || !object(args.input)
    || !UUID.test(args.input.resourceId) || !UUID.test(args.input.nativeObjectRef)
    || !nonempty(args.input.nativeRevision)) throw new Refused(400);
  const claims=await claimsForRead(config,token,args);
  if (claims.idempotency_key !== key) throw new Refused(401);
  await freshPep(config,deadline,token,args,claims,'execute');
  const file=await nativeFile(config,deadline,args,claims);
  const {bytes}=file;
  // Do not disclose buffered bytes if read permission disappeared during I/O.
  const current=await claimsForRead(config,token,args);
  await freshPep(config,deadline,token,args,current,'execute');
  // Native moves/deletes/ACL changes are not Core authorization projections.
  // Re-resolve the same UUIDs inside the fixed root and authorized subtree
  // after buffering; an earlier valid path cannot authorize final disclosure.
  await nativeDocumentNode(config,deadline,{
    nativeObjectRef:args.input.nativeObjectRef,authorizationTargetNativeRef:args.authorizationTargetNativeRef,
  },current);
  const disclosure=await claimsForRead(config,token,args);
  await freshPep(config,deadline,token,args,disclosure,'execute');
  const sha256=createHash('sha256').update(bytes).digest('hex');
  await recordReadReceipt(config,deadline,{bindingId:config.bindingId,operationId:claims.operation_id,
    role:'SOURCE',idempotencyKey:key,nativeObjectRef:args.input.nativeObjectRef,nativeRevision:file.nativeRevision,
    contentSha256:sha256,contentBytes:bytes.length,completedAt:new Date().toISOString(),
    measurements:readMeasurements(config.readEdge.usageMeasurements,bytes.length)});
  // Receipt delivery includes authenticated network I/O. A recorded SOURCE
  // receipt proves the native read, not permission to disclose its buffered
  // bytes after a withdrawal/move during that I/O. The missing RECEIVER
  // receipt remains the original operation's reconciliation responsibility.
  const final=await claimsForRead(config,token,args);
  await nativeDocumentNode(config,deadline,{
    nativeObjectRef:args.input.nativeObjectRef,authorizationTargetNativeRef:args.authorizationTargetNativeRef,
  },final);
  await freshPep(config,deadline,token,args,final,'execute');
  return {bytes,nativeObjectRef:args.input.nativeObjectRef,nativeRevision:file.nativeRevision,
    sha256,operationId:claims.operation_id};
}
