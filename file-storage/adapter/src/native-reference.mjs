// The native Cells browser reads its own nodes through the original JWT/ACL
// gateway. This Adapter typed slot exports metadata, not a platform admission.
// Core independently rechecks the supplied Resource/version, binding and scope.
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const record = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string' && value.trim() !== '' && !/[\x00-\x1f\x7f]/.test(value);
const positive = (value) => Number.isSafeInteger(value) && value > 0;
function refused() { throw new Error('native document reference unavailable'); }

export function referenceDelivery(raw) {
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!record(value) || Object.keys(value).sort().join(',') !==
    'bindingId,generation,nativeRootRef,nativeWorkspaceId,platformOrigin,resourceId,resourceVersion,workspaceId') refused();
  for (const key of ['bindingId', 'nativeRootRef', 'nativeWorkspaceId', 'resourceId', 'workspaceId']) {
    if (!uuid.test(value[key])) refused();
  }
  if (!positive(value.generation) || !positive(value.resourceVersion)) refused();
  const origin = new URL(value.platformOrigin);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== value.platformOrigin ||
    origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) refused();
  return Object.freeze({ ...value });
}

function nodePath(node, id, workspace, kind) {
  if (!record(node) || node.Uuid !== id || node.Type !== kind ||
    node.ContextWorkspace?.Uuid !== workspace || node.IsRecycled || node.IsRecycleBin || node.IsDraft ||
    !text(node.Path) || node.Path.startsWith('/') || node.Path.endsWith('/') ||
    node.Path.split('/').some((part) => !part || part === '.' || part === '..')) refused();
  return node.Path;
}

// The read callback is the ORIGINAL native authenticated REST transport, never
// the binding's INSTANCE_SERVICE credential or a browser-supplied service key.
export async function nativeDocumentSelection(delivery, nodeId, actionKey, read) {
  const fixed = referenceDelivery(delivery);
  if (!uuid.test(nodeId) || !['file_storage.open_view@v1', 'file_storage.open_edit@v1'].includes(actionKey)) refused();
  const root = await read(`n/node/${fixed.nativeRootRef}?Flags=WithVersionsAll`, 'GET');
  const rootPath = nodePath(root, fixed.nativeRootRef, fixed.nativeWorkspaceId, 'COLLECTION');
  const node = await read(`n/node/${nodeId}?Flags=WithVersionsAll`, 'GET');
  const path = nodePath(node, nodeId, fixed.nativeWorkspaceId, 'LEAF');
  if (!path.startsWith(`${rootPath}/`) || !text(node.ContentType) || !text(node.StorageETag)) refused();
  const versions = await read(`n/node/${nodeId}/versions`, 'POST', {
    FilterBy: 'VersionsAll', Offset: 0, Limit: 0, Flags: ['WithMetaNone'],
  });
  if (!record(versions) || !Array.isArray(versions.Versions)) refused();
  const seen = new Set();
  for (const version of versions.Versions) {
    if (!record(version) || !text(version.VersionId) || seen.has(version.VersionId)) refused();
    seen.add(version.VersionId);
  }
  const heads = versions.Versions.filter((version) => version.IsHead === true);
  if (heads.length !== 1 || heads[0].Draft === true || heads[0].ETag !== node.StorageETag) refused();
  // Re-read after the version observation: a move or ACL withdrawal cannot
  // leave a stale native menu selection cached as successful.
  const current = await read(`n/node/${nodeId}?Flags=WithVersionsAll`, 'GET');
  if (nodePath(current, nodeId, fixed.nativeWorkspaceId, 'LEAF') !== path ||
    current.ContentType !== node.ContentType || current.StorageETag !== node.StorageETag) refused();
  return {
    bindingId: fixed.bindingId, generation: fixed.generation, workspaceId: fixed.workspaceId,
    resourceVersion: fixed.resourceVersion, actionKey, actionVersion: 1,
    reference: { resourceId: fixed.resourceId, nativeObjectRef: nodeId,
      nativeRevision: heads[0].VersionId, displayName: path.split('/').pop(), mediaType: node.ContentType },
  };
}

// A normal Kailo window must authenticate separately. Ready messages only
// fence the selected window; neither nonce nor native session grants permission.
export function documentBridge(win, opened, delivery, selection) {
  const fixed = referenceDelivery(delivery);
  let stopped = false;
  const receive = async (event) => {
    if (stopped || event.source !== opened || event.origin !== fixed.platformOrigin ||
      !record(event.data) || Object.keys(event.data).sort().join(',') !== 'bindingId,nonce,type' ||
      event.data.type !== 'kailo.document.ready' || event.data.bindingId !== fixed.bindingId ||
      !text(event.data.nonce)) return;
    let resolved;
    try { resolved = await selection; } catch { return; }
    if (stopped || opened.closed) return;
    opened.postMessage({ type: 'kailo.document.selection', nonce: event.data.nonce, selection: resolved }, fixed.platformOrigin);
  };
  win.addEventListener('message', receive);
  return () => { stopped = true; win.removeEventListener('message', receive); };
}
