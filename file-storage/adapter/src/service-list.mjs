// DD-89/13 §4.4: enumerate the admitted native root, not a search index or a
// guessed path. No broker offset, credential or temporary URL is disclosed.
import { createHash } from 'node:crypto';
import { Refused, object, exactKeys, nonempty, canonical, fixedUrl, secret,
  jsonFetch, freshPep, readMeasurements, recordReadReceipt } from '../../../client-kit/adapter/protocol.mjs';
import { claimsForRead } from './service-read.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function nodePath(node, config) {
  if (!object(node) || !UUID.test(node.Uuid) || !['COLLECTION', 'LEAF'].includes(node.Type)
    || !nonempty(node.Path) || /[\\\x00-\x1f]/.test(node.Path)
    || node.Path.split('/').some(part => part === '.' || part === '..')
    || (node.ContextWorkspace !== undefined && node.ContextWorkspace?.Uuid !== config.nativeWorkspaceId)
    || (node.Mode !== undefined && !['Default','NodeReadOnly','LevelReadOnly'].includes(node.Mode))) throw new Refused(503);
  for (const flag of ['IsRecycled','IsRecycleBin','IsDraft']) {
    if (node[flag] !== undefined && typeof node[flag] !== 'boolean') throw new Refused(503);
  }
  return node.Path.replace(/\/$/, '');
}

function childrenCount(node) {
  if (!Array.isArray(node.FolderMeta)) throw new Refused(503);
  const counts = node.FolderMeta.filter(item => item?.Namespace === 'ChildrenCount');
  const count = counts[0]?.Value === undefined ? 0 : counts[0].Value;
  if (counts.length !== 1 || !Number.isSafeInteger(count) || count < 0) throw new Refused(503);
  return count;
}

async function nativeListing(config, deadline, args) {
  const base = fixedUrl(config.cellsRestBaseUrl);
  base.pathname = `${base.pathname.replace(/\/$/, '')}/`;
  const headers = {authorization:`Bearer ${await secret(config.cellsBearerFile)}`, 'content-type':'application/json'};
  const getNode = async id => {
    // Explicit WithMetaDefaults asks GetByUuid for folder counts without its
    // empty-flags fallback that also issues presigned URLs.
    const node = await jsonFetch(config,deadline,new URL(`n/node/${id}?Flags=WithMetaDefaults`,base),{headers});
    if (node?.Uuid !== id) throw new Refused(503);
    nodePath(node,config);
    return node;
  };
  const bindingRoot = await getNode(config.nativeRootRef);
  if (bindingRoot.Type !== 'COLLECTION' || bindingRoot.ContextWorkspace?.Uuid !== config.nativeWorkspaceId
    || bindingRoot.IsRecycled || bindingRoot.IsRecycleBin || bindingRoot.IsDraft) throw new Refused(503);
  const bindingPath = nodePath(bindingRoot,config);
  const admittedRoot = args.authorizationTargetNativeRef === config.nativeRootRef
    ? bindingRoot : await getNode(args.authorizationTargetNativeRef);
  const admittedPath = nodePath(admittedRoot,config);
  if (admittedRoot.Type !== 'COLLECTION' || admittedRoot.IsRecycled || admittedRoot.IsRecycleBin || admittedRoot.IsDraft
    || (admittedRoot.Uuid !== bindingRoot.Uuid && !admittedPath.startsWith(`${bindingPath}/`))) throw new Refused(403);
  const queue = [admittedRoot];
  const seen = new Set([admittedRoot.Uuid]);
  const items = [];
  let measuredBytes = 0;
  for (let index=0; index<queue.length; index++) {
    const folder = queue[index];
    const path = nodePath(folder,config);
    if (folder.Uuid !== admittedRoot.Uuid && !path.startsWith(`${admittedPath}/`)) throw new Refused(403);
    const expected = childrenCount(folder);
    // Fixed native LoadNodes: Limit=0 consumes the full children stream. No
    // filtered search, pagination guess or partial desired set is accepted.
    const response = await jsonFetch(config,deadline,new URL('n/nodes',base),{
      method:'POST',headers,body:JSON.stringify({Scope:{Root:{Uuid:folder.Uuid},Recursive:false},
        Offset:0,Limit:0,Flags:['WithMetaDefaults']}),
    });
    // Cells' default protojson writer omits an empty repeated Nodes field.
    // That is a complete empty set only when its independent native count is
    // zero; never reinterpret a missing non-empty or malformed response as empty.
    const nodes = object(response) && response.Nodes === undefined && expected === 0
      && Object.keys(response).every(key => ['Facets','Pagination'].includes(key))
      && (response.Facets === undefined || (Array.isArray(response.Facets) && response.Facets.length === 0))
      ? [] : response?.Nodes;
    if (!Array.isArray(nodes) || nodes.length !== expected
      || (response.Pagination !== undefined && (!object(response.Pagination)
        || (response.Pagination.Total === undefined ? 0 : response.Pagination.Total) !== expected
        || (response.Pagination.NextOffset === undefined ? 0 : response.Pagination.NextOffset) !== 0
        || (response.Pagination.CurrentOffset === undefined ? 0 : response.Pagination.CurrentOffset) !== 0))) throw new Refused(503);
    for (const node of nodes) {
      const childPath = nodePath(node,config);
      if (!childPath.startsWith(`${path}/`) || childPath.slice(path.length+1).includes('/') || seen.has(node.Uuid)) throw new Refused(503);
      seen.add(node.Uuid);
      measuredBytes += Buffer.byteLength(canonical(node),'utf8');
      if (measuredBytes > config.maxBodyBytes) throw new Refused(503);
      // Native recycle/draft objects were included in the counted listing;
      // they are intentionally not published content, not a failed fetch.
      if (node.IsRecycleBin || node.IsRecycled || node.IsDraft) continue;
      const current = await getNode(node.Uuid);
      if (nodePath(current,config) !== childPath || current.Type !== node.Type
        || current.IsRecycleBin || current.IsRecycled || current.IsDraft) throw new Refused(409);
      if (node.Type === 'COLLECTION') {
        queue.push(current);
        continue;
      }
      const versions = await jsonFetch(config,deadline,new URL(`n/node/${node.Uuid}/versions`,base),{
        method:'POST',headers,body:JSON.stringify({FilterBy:'VersionsAll',Offset:0,Limit:0,Flags:['WithMetaNone']}),
      });
      if (!Array.isArray(versions?.Versions) || !versions.Versions.length || !nonempty(node.ContentType)) throw new Refused(503);
      const ids = new Set();
      const heads = [];
      for (const version of versions.Versions) {
        if (!nonempty(version?.VersionId) || ids.has(version.VersionId)
          || (version.IsHead !== undefined && typeof version.IsHead !== 'boolean')
          || (version.Draft !== undefined && typeof version.Draft !== 'boolean')) throw new Refused(503);
        ids.add(version.VersionId);
        if (version.IsHead === true) heads.push(version);
      }
      if (heads.length !== 1 || heads[0].Draft === true) throw new Refused(503);
      items.push({resourceId:args.input.resourceId,nativeObjectRef:node.Uuid,nativeRevision:heads[0].VersionId,
        displayName:childPath.slice(path.length+1),mediaType:node.ContentType});
    }
    const after = await getNode(folder.Uuid);
    if (nodePath(after,config) !== path || childrenCount(after) !== expected) throw new Refused(503);
  }
  items.sort((a,b) => a.nativeObjectRef.localeCompare(b.nativeObjectRef));
  return items;
}

export async function listFiles(config, deadline, raw, key, token) {
  if (!config.readEdge) throw new Refused(503);
  let request;
  try { request=JSON.parse(raw); } catch { throw new Refused(400); }
  if (!exactKeys(request,['actionKey','idempotencyKey','arguments']) || request.actionKey !== 'file_storage.list@v1'
    || !UUID.test(key) || request.idempotencyKey !== key || raw !== canonical(request)) throw new Refused(400);
  const args=request.arguments;
  if (!exactKeys(args,['targetType','targetId','input','authorizationTargetNativeRef'])
    || !UUID.test(args.authorizationTargetNativeRef) || !exactKeys(args.input,['resourceId'])
    || !UUID.test(args.input.resourceId)) throw new Refused(400);
  const claims=await claimsForRead(config,token,args,request.actionKey);
  if (claims.idempotency_key !== key) throw new Refused(401);
  await freshPep(config,deadline,token,args,claims,'execute');
  const items = await nativeListing(config,deadline,args);
  const encoded = canonical(items);
  // Lookup is not a native atomic snapshot. A changed second complete traversal
  // is UNKNOWN, never a deletion set or an mtime-derived revision.
  if (canonical(await nativeListing(config,deadline,args)) !== encoded) throw new Refused(409);
  const current=await claimsForRead(config,token,args,request.actionKey);
  await freshPep(config,deadline,token,args,current,'execute');
  const bytes=Buffer.byteLength(encoded,'utf8');
  if (bytes > config.maxBodyBytes) throw new Refused(503);
  const digest=createHash('sha256').update(encoded).digest('hex');
  await recordReadReceipt(config,deadline,{bindingId:config.bindingId,operationId:claims.operation_id,
    role:'SOURCE',idempotencyKey:key,nativeObjectRef:args.authorizationTargetNativeRef,nativeRevision:digest,
    contentSha256:digest,contentBytes:bytes,completedAt:new Date().toISOString(),
    measurements:readMeasurements(config.readEdge.usageMeasurements,bytes)});
  return {resourceId:args.input.resourceId,nativeObjectRef:args.authorizationTargetNativeRef,nativeRevision:digest,
    items,listingDigest:digest,operationId:claims.operation_id};
}
