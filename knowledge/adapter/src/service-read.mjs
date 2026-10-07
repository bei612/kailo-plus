// DD-89: the receiver authenticates only as its own binding. Source credentials
// and presigned native URLs are never accepted by or disclosed to WeKnora.
import { createHash } from 'node:crypto';
import { Refused, exactKeys, nonempty, canonical, fixedUrl, boundedBytes,
  jsonFetch, serviceBearer } from '../../../client-kit/adapter/protocol.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function sourceReference(args, claims) {
  const input=args?.input;
  const keys=['resourceId','nativeObjectRef','nativeRevision','displayName','mediaType'];
  if (!exactKeys(args,['target','input']) || !exactKeys(args.target,['resourceId'])
    || args.target.resourceId!==claims.target_id || !exactKeys(input,
      input?.assetId===undefined ? keys : [...keys,'assetId'])
    || !UUID.test(input.resourceId) || !UUID.test(input.nativeObjectRef)
    || (input.assetId!==undefined && !UUID.test(input.assetId))
    || !['nativeRevision','displayName','mediaType'].every(key=>nonempty(input[key]))) throw new Refused(400);
  return input;
}

export async function sourceFile(config, deadline, reference, key, claims) {
  if (!config.readEdge) throw new Refused(503);
  const bearer=await serviceBearer(config,deadline);
  const grant=await jsonFetch(config,deadline,new URL('/service/v1/adapter/request_read_grant',config.corePepUrl),{
    method:'POST',headers:{authorization:`Bearer ${bearer}`,'content-type':'application/json'},
    body:JSON.stringify({receiverBindingId:config.bindingId,receiverActionExecutionId:claims.action_execution_id,
      receiverArgumentsJson:canonical({target:{resourceId:claims.target_id},input:reference}),
      sourceResourceId:reference.resourceId,actionKey:'file_storage.read@v1',
      actionVersion:config.readEdge.sourceActionVersion,idempotencyKey:key,inputJson:canonical(reference)}),
  });
  if (!exactKeys(grant,['actionExecutionId','operationId','sourceBindingId','endpoint','actionToken','expiresAt','argumentsJson'])
    || !UUID.test(grant.actionExecutionId) || !UUID.test(grant.sourceBindingId)
    || !UUID.test(grant.operationId) || !nonempty(grant.actionToken)
    || !Number.isSafeInteger(grant.expiresAt) || grant.expiresAt<=Math.floor(Date.now()/1000)) throw new Refused(503);
  const endpoint=fixedUrl(grant.endpoint);
  // Core resolves the complete endpoint from the controlled directory. Do not
  // discard a registered reverse-proxy path or guess the source host locally.
  let request;
  try { request=JSON.parse(grant.argumentsJson); } catch { throw new Refused(503); }
  if (!exactKeys(request,['actionKey','idempotencyKey','arguments']) || request.actionKey!=='file_storage.read@v1'
    || request.idempotencyKey!==key || grant.argumentsJson!==canonical(request)
    || request.arguments?.targetType!=='RESOURCE' || request.arguments.targetId!==reference.resourceId
    || canonical(request.arguments.input)!==canonical(reference)) throw new Refused(503);
  const remaining=Math.min(deadline-Date.now(),grant.expiresAt*1000-Date.now());
  if (remaining<=0) throw new Refused(503);
  const response=await fetch(endpoint,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(remaining),
    headers:{authorization:`Bearer ${grant.actionToken}`,'content-type':'application/json','idempotency-key':key},
    body:grant.argumentsJson});
  if (response.status!==200 || !response.body || response.headers.get('content-type')!=='application/octet-stream'
    || response.headers.get('x-kailo-native-object-ref')!==reference.nativeObjectRef
    || response.headers.get('x-kailo-native-revision')!==reference.nativeRevision
    || response.headers.get('x-kailo-operation-id')!==grant.operationId || response.headers.has('content-range')) {
    await response.body?.cancel(); throw new Refused(503);
  }
  const bytes=await boundedBytes(response.body,config.maxBodyBytes);
  if (response.headers.get('content-length')!==String(bytes.length)
    || response.headers.get('x-kailo-content-sha256')!==createHash('sha256').update(bytes).digest('hex')) throw new Refused(503);
  return {bytes,operationId:grant.operationId};
}
