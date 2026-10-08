import assert from 'node:assert/strict';
import test from 'node:test';
import { documentBridge, nativeDocumentSelection, referenceDelivery } from '../src/native-reference.mjs';

const ids = Array.from({ length: 6 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const delivery = { bindingId: ids[0], generation: 3, nativeRootRef: ids[1], nativeWorkspaceId: ids[2],
  resourceId: ids[3], resourceVersion: 4, workspaceId: ids[4], platformOrigin: 'http://192.168.0.193:3080' };
const root = { Uuid: ids[1], Type: 'COLLECTION', Path: 'documents/root', ContextWorkspace: { Uuid: ids[2] } };
const node = { Uuid: ids[5], Type: 'LEAF', Path: 'documents/root/document.docx', ContextWorkspace: { Uuid: ids[2] },
  ContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', StorageETag: 'original-etag' };
const versions = { Versions: [{ VersionId: 'old-version', IsHead: false, ETag: 'old' },
  { VersionId: 'actual-native-version', IsHead: true, ETag: 'original-etag' }] };
const action = 'file_storage.open_view@v1';

function reader(changes = {}) {
  const calls = [];
  return { calls, read: async (path, method, body) => {
    calls.push({ path, method, body });
    path = path.split('?')[0];
    if (changes.deny) throw new Error('original native ACL denied');
    if (path === `n/node/${ids[1]}`) return changes.root ?? root;
    if (path === `n/node/${ids[5]}/versions`) return changes.versions ?? versions;
    if (path === `n/node/${ids[5]}`) return calls.length > 3 ? changes.current ?? changes.node ?? node : changes.node ?? node;
    throw new Error('unexpected native route');
  } };
}

test('original native read produces the closed typed reference and frozen projection locator', async () => {
  const native = reader();
  assert.deepEqual(await nativeDocumentSelection(delivery, ids[5], action, native.read), {
    bindingId: ids[0], generation: 3, workspaceId: ids[4], resourceVersion: 4, actionKey: action, actionVersion: 1,
    reference: { resourceId: ids[3], nativeObjectRef: ids[5], nativeRevision: 'actual-native-version',
      displayName: 'document.docx', mediaType: node.ContentType },
  });
  assert.deepEqual(native.calls.map((call) => call.method), ['GET', 'GET', 'POST', 'GET']);
  assert.equal(native.calls[2].body.FilterBy, 'VersionsAll');
});

test('native denial, escaped scope, ambiguous revision and changed native evidence never export a reference', async (t) => {
  for (const changed of [
    { deny: true }, { node: { ...node, ContextWorkspace: { Uuid: ids[0] } } },
    { node: { ...node, Path: 'documents/root-other/document.docx' } }, { node: { ...node, IsRecycled: true } },
    { node: { ...node, IsDraft: true } }, { node: { ...node, IsDraft: null } },
    { node: { ...node, IsRecycled: null } }, { root: { ...root, IsRecycleBin: 0 } },
    { node: { ...node, ContentType: '' } }, { versions: { Versions: [] } },
    { node: { ...node, Path: 'documents/root/control\u0000.docx' } },
    { versions: { Versions: [versions.Versions[1], { ...versions.Versions[1], VersionId: 'another-head' }] } },
    { versions: { Versions: [{ ...versions.Versions[1], Draft: true }] } },
    { versions: { Versions: [{ ...versions.Versions[1], Draft: null }] } },
    { versions: { Versions: [{ ...versions.Versions[1], Draft: 'false' }] } },
    { versions: { Versions: [{ ...versions.Versions[0], IsHead: 'false' }, versions.Versions[1]] } },
    { versions: { Versions: [{ ...versions.Versions[1], ETag: 'another-etag' }] } },
    { current: { ...node, StorageETag: 'changed-after-observation' } },
  ]) await t.test(JSON.stringify(changed), async () => {
    await assert.rejects(nativeDocumentSelection(delivery, ids[5], action, reader(changed).read));
  });
  for (const changed of [{ ...delivery, resourceVersion: 0 }, { ...delivery, platformOrigin: 'https://platform.example/path' },
    { ...delivery, untrustedSecret: 'not-config' }]) assert.throws(() => referenceDelivery(changed));
});

test('ready before native reads finish is fenced to the exact original window and platform origin', async () => {
  let receive; const sent = [];
  const win = { addEventListener: (_type, fn) => { receive = fn; }, removeEventListener: (_type, fn) => { assert.equal(fn, receive); } };
  const opened = { closed: false, postMessage: (value, origin) => sent.push({ value, origin }) };
  let resolve; const pending = new Promise((done) => { resolve = done; });
  const stop = documentBridge(win, opened, delivery, pending);
  const ready = { source: opened, origin: delivery.platformOrigin, data: { type: 'kailo.document.ready', bindingId: ids[0], nonce: 'same-window-round' } };
  await receive({ ...ready, source: {} }); await receive({ ...ready, origin: 'http://unapproved.example' });
  const accepted = receive(ready);
  assert.equal(sent.length, 0);
  const selection = await nativeDocumentSelection(delivery, ids[5], action, reader().read);
  resolve(selection); await accepted;
  assert.deepEqual(sent, [{ origin: delivery.platformOrigin,
    value: { type: 'kailo.document.selection', nonce: 'same-window-round', selection } }]);
  stop(); await receive(ready); assert.equal(sent.length, 1);
});
