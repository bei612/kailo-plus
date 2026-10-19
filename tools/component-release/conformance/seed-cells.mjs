#!/usr/bin/env node
// Stage 2 of tools/component-release/conformance-run.sh for Cells: create,
// through the original Cells APIs only, the native objects that the frozen
// FILE_STORAGE vectors reference, inside the isolated conformance instance,
// and record what Cells actually returned (07 §8A: "模拟…资源…只在独立验证部署内
// 引导"; no SQL, no direct store write, no invented id).
//
//   folders  REST v2 POST n/nodes/create (Type COLLECTION; Cells mints the UUID)
//   files    S3 gateway PUT /io/<slug>/<path> with X-Amz-Meta-Create-Resource-Uuid
//            (the vector's node UUID; gateway/restv2/api-create.go,
//            common/nodes/models/structs.go)
//   drafts   S3 PUT by the conformance actor's own native user with
//            X-Amz-Meta-Draft-Mode=true and X-Amz-Meta-Create-Version-Id (the
//            vector's draft revision; handler-version.go
//            routeUploadToContentRevision); promote later checks owner, ETag,
//            display name and media type (restv2/native-write-execution.go)
//
// It runs BEFORE the isolated instance receives its platform native-action
// delivery (afterwards Cells only accepts governed native writes), and it
// refuses unless vector-requirements.mjs reported satisfiable=true: an
// unmintable head revision or share link is never approximated.
//
// V2 vectors (DD-124, file_storage@2): the requirements list case
// preconditions by native role instead of vector identities. The seed creates
// each through the same native entries (a share link through the original
// REST PUT /a/share/link, whose Uuid Cells mints) and records, per
// <category>:<version>:<caseKey>/key, exactly the identity Cells returned:
//   node   LEAF Uuid confirmed by GET n/node/{Uuid}; a node the case writes is
//          created by the actor's draft-mode upload, so it has no published
//          revision before the governed promote
//   draft  that upload's draft VersionId, the node's only listed revision
//   share  the ShareLink.Uuid of Cells' own create response for a link on the
//          binding root (the only root a governed revoke admits)
// These values are only Core's PRECONDITION inputs (fixture.preconditions);
// they never become an expectation, and no CAPTURE value exists before Core's
// run. A node/draft id this seed proposes is a fresh random UUID that Cells
// must acknowledge, never a value taken from the vectors.
//
// Usage: node tools/component-release/conformance/seed-cells.mjs --seed /abs/seed.json
// seed.json (owner-only):
// { "requirementsFile":"/abs/requirements.json", "cellsOrigin":"http://<isolated cells>",
//   "cellsExternal":"<that instance's CELLS_EXTERNAL>" (S3 uploads are signed for this host and
//                   sent to cellsOrigin: Cells' proxy rewrites Host to it; cells-s3.mjs),
//   "restBasePath":"/v2/", "restV1BasePath":"/a/" (V2 share preconditions),
//   "workspaceSlug":"<existing native workspace slug>",
//   "rootName":"kailo-conformance-<run>", "adminTokenFile":"/abs PAT (native admin)",
//   "actorTokenFile":"/abs PAT of the native user linked to the conformance actor",
//   "s3Secret":"gatewaysecret", "timeoutMs":<int>, "out":"/abs/native-facts.json" }
// PATs come from the native `cells admin user token` command of that instance.

import { randomUUID } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { constants, closeSync, openSync, writeSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { externalOrigin, s3Put } from './cells-s3.mjs';

class Refusal extends Error {}
const fail = (message) => { throw new Refusal(message); };

async function ownerOnly(path, json = true) {
  if (!isAbsolute(path ?? '')) fail('absolute owner-only input required');
  const entry = await lstat(path);
  if (entry.isSymbolicLink() || !entry.isFile() || (entry.mode & 0o077) !== 0) fail(`${path}: owner-only regular file required`);
  const text = await readFile(path, 'utf8');
  return json ? JSON.parse(text) : text.trim();
}

async function main() {
  const flag = process.argv.indexOf('--seed');
  if (flag < 0 || process.argv.length !== 4) fail('usage: seed-cells.mjs --seed /abs/seed.json');
  const seed = await ownerOnly(process.argv[flag + 1]);
  const requirements = await ownerOnly(seed.requirementsFile);
  if (requirements.component !== 'file-storage' || requirements.satisfiable !== true) {
    fail('vector requirements are not satisfiable through the native Cells API; seeding refused');
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(seed.workspaceSlug ?? '') || !/^[a-z0-9][a-z0-9-]*$/.test(seed.rootName ?? '')
    || !isAbsolute(seed.out ?? '') || !Number.isSafeInteger(seed.timeoutMs) || seed.timeoutMs <= 0) fail('seed.json invalid');
  const origin = new URL(seed.cellsOrigin);
  let external;
  try { external = externalOrigin(seed.cellsExternal); } catch { fail('seed.json invalid: cellsExternal must be the native external origin (CELLS_EXTERNAL)'); }
  const rest = new URL(seed.restBasePath, origin);
  const admin = await ownerOnly(seed.adminTokenFile, false);
  const actor = await ownerOnly(seed.actorTokenFile, false);
  const signal = () => AbortSignal.timeout(seed.timeoutMs);
  const restCall = async (method, path, body, token = admin) => {
    const response = await fetch(new URL(path, rest), { method, redirect: 'manual', signal: signal(),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok) fail(`${method} ${path}: native HTTP ${response.status}`);
    return response.json();
  };
  const put = async (path, text, mediaType, meta, token) => {
    // Sent to the internal origin, signed for the external host the gateway verifies (cells-s3.mjs).
    const status = await s3Put({ origin, external, path: `/io/${seed.workspaceSlug}/${path}`, body: text,
      headers: { 'content-type': mediaType, ...meta }, accessKey: token, secretKey: seed.s3Secret, signal: signal() });
    if (status !== 200) fail(`PUT ${path}: native HTTP ${status}`);
  };
  const node = (uuid) => restCall('GET', `n/node/${uuid}?Flags=WithMetaDefaults`);
  const created = async (path, type) => {
    const value = await restCall('POST', 'n/nodes/create', { Inputs: [{ Locator: { Path: `${seed.workspaceSlug}/${path}` }, Type: type }], Recursive: true });
    const uuid = value?.Nodes?.[0]?.Uuid ?? fail(`create ${path}: no native node returned`);
    return node(uuid);
  };

  const req = requirements.requirements;
  const root = await created(seed.rootName, 'COLLECTION');
  const workspaceId = root.ContextWorkspace?.Uuid ?? fail('root folder has no native workspace');
  const formats = new Set((requirements.formats ?? []).map((item) => item.formatVersion));
  if (formats.has('V2')) {
    if (formats.size !== 1) fail('V1 and V2 vector requirements cannot be seeded together');
    const v1 = seed.restV1BasePath === undefined ? undefined : new URL(seed.restV1BasePath, origin);
    const facts = await seedV2({ seed, req, root, workspaceId, restCall, put, node, created, v1, admin, actor, signal });
    const fd = openSync(seed.out, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try { writeSync(fd, `${JSON.stringify(facts, null, 2)}\n`); } finally { closeSync(fd); }
    process.stdout.write(`${JSON.stringify({ nativeFacts: seed.out, resources: Object.keys(facts.targets.resources).length,
      preconditions: facts.preconditions.length })}\n`);
    return;
  }
  const resources = {};
  const observed = { folders: [], files: [], drafts: [] };
  let folderIndex = 0;
  for (const folder of req.filter((entry) => entry.kind === 'cells-folder')) {
    const value = await created(`${seed.rootName}/listing-${folderIndex += 1}`, 'COLLECTION');
    resources[folder.resourceId] = { nativeType: value.Type, nativeRef: value.Uuid };
    observed.folders.push({ resourceId: folder.resourceId, nativeRef: value.Uuid, empty: folder.emptyListing });
  }
  const nodes = new Map();
  for (const entry of req.filter((e) => e.kind === 'cells-node')) {
    const known = nodes.get(entry.nativeRef) ?? { resourceIds: new Set() };
    known.resourceIds.add(entry.resourceId);
    nodes.set(entry.nativeRef, known);
  }
  for (const entry of req.filter((e) => e.kind === 'cells-node-name')) Object.assign(nodes.get(entry.nativeRef) ?? fail('named node not required'), { displayName: entry.displayName, mediaType: entry.mediaType });
  const draftContent = req.find((e) => e.kind === 'cells-draft-content' && e.displayName !== undefined);
  for (const [uuid, info] of nodes) {
    if (!info.displayName || !info.mediaType) fail(`node ${uuid}: no vector display name/media type`);
    const draft = req.find((e) => e.kind === 'cells-draft-revision' && e.nativeRef === uuid);
    const text = req.find((e) => e.kind === 'cells-draft-content')?.text ?? fail('no vector content for the draft');
    if (draftContent && (draftContent.displayName !== info.displayName || draftContent.mediaType !== info.mediaType)) fail('export metadata differs from the node');
    const path = `${seed.rootName}/${info.displayName}`;
    await put(path, text, info.mediaType, { 'x-amz-meta-create-resource-uuid': uuid }, admin);
    const leaf = await node(uuid);
    if (leaf.Uuid !== uuid || leaf.Type !== 'LEAF' || leaf.ContextWorkspace?.Uuid !== workspaceId) fail(`node ${uuid} was not created with the vector identity`);
    for (const resourceId of info.resourceIds) {
      if (resources[resourceId] && resources[resourceId].nativeRef !== uuid) fail(`resource ${resourceId} maps to two native objects`);
      resources[resourceId] = { nativeType: leaf.Type, nativeRef: uuid };
    }
    observed.files.push({ nativeRef: uuid, path });
    if (draft) {
      await put(path, text, info.mediaType, { 'x-amz-meta-draft-mode': 'true', 'x-amz-meta-create-version-id': draft.revision }, actor);
      const versions = await restCall('POST', `n/node/${uuid}/versions`, { FilterBy: 'VersionsAll', Offset: 0, Limit: 0, Flags: ['WithMetaNone'] }, actor);
      const found = (versions.Versions ?? []).filter((v) => v.VersionId === draft.revision);
      if (found.length !== 1 || found[0].Draft !== true || !found[0].ETag) fail(`draft ${draft.revision} was not acknowledged by Cells`);
      observed.drafts.push({ nativeRef: uuid, revision: draft.revision, etag: found[0].ETag });
    }
  }
  for (const entry of req.filter((e) => e.kind === 'platform-resource')) {
    if (!resources[entry.resourceId]) fail(`resource ${entry.resourceId} has no observed native object`);
  }
  const facts = { component: 'file-storage', nativeWorkspaceId: workspaceId, nativeRootRef: root.Uuid,
    targets: { resources }, observed };
  const fd = openSync(seed.out, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try { writeSync(fd, `${JSON.stringify(facts, null, 2)}\n`); } finally { closeSync(fd); }
  process.stdout.write(`${JSON.stringify({ nativeFacts: seed.out, resources: Object.keys(resources).length })}\n`);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// DD-124 V2: create every case precondition through Cells' own entries and
// record only the identities Cells returned for it.
async function seedV2({ seed, req, root, workspaceId, restCall, put, node, created, v1, admin, actor, signal }) {
  const values = new Map(); // "<caseKey>/<key>" -> native identity
  const preconditions = [];
  const observed = { folders: [], files: [], drafts: [], shares: [] };
  const record = (entry, value) => {
    const id = `${entry.caseKey}/${entry.key}`;
    if (values.has(id) || typeof value !== 'string' || !value) fail(`${id}: no unique native identity`);
    values.set(id, value);
    preconditions.push({ caseKey: entry.caseKey, key: entry.key, value });
  };
  const all = req.filter((entry) => entry.kind === 'cells-precondition');
  const drafts = all.filter((item) => item.role === 'draft');
  let index = 0;
  for (const entry of all.filter((item) => item.role === 'node')) {
    // One private folder per precondition keeps equal display names apart.
    index += 1;
    const folderPath = `${seed.rootName}/precondition-${index}`;
    const folder = await created(folderPath, 'COLLECTION');
    const path = `${folderPath}/${entry.displayName}`;
    const proposed = randomUUID();
    const draft = drafts.filter((item) => item.caseKey === entry.caseKey && item.node === entry.key);
    if (draft.length > 1) fail(`${entry.key}: one draft precondition per node`);
    if (draft.length === 1) {
      // A node whose draft the case writes is created by the conformance
      // actor's own draft-mode upload (handler-version.go PutObject ->
      // routeUploadToContentRevision): Cells acknowledges the node and its
      // owner draft, and no published revision exists before the governed
      // promote, so the write's revision is the only one it later lists.
      const proposedDraft = randomUUID();
      await put(path, draft[0].text, entry.mediaType, { 'x-amz-meta-create-resource-uuid': proposed,
        'x-amz-meta-draft-mode': 'true', 'x-amz-meta-create-version-id': proposedDraft }, actor);
      const leaf = await restCall('GET', `n/node/${proposed}?Flags=WithMetaDefaults`, undefined, actor);
      if (leaf?.Uuid !== proposed || leaf.Type !== 'LEAF' || leaf.ContextWorkspace?.Uuid !== workspaceId) fail(`${entry.key}: Cells did not acknowledge the draft node`);
      const versions = await restCall('POST', `n/node/${proposed}/versions`, { FilterBy: 'VersionsAll', Offset: 0, Limit: 0, Flags: ['WithMetaNone'] }, actor);
      const listed = versions.Versions ?? [];
      if (listed.length !== 1 || listed[0].VersionId !== proposedDraft || listed[0].Draft !== true || !listed[0].ETag) {
        fail(`${entry.key}: Cells did not acknowledge exactly the actor's draft as the node's only revision`);
      }
      record(entry, leaf.Uuid);
      record(draft[0], listed[0].VersionId);
      observed.drafts.push({ caseKey: entry.caseKey, key: draft[0].key, nativeRef: leaf.Uuid, revision: listed[0].VersionId, etag: listed[0].ETag });
    } else {
      await put(path, entry.text, entry.mediaType, { 'x-amz-meta-create-resource-uuid': proposed }, admin);
      const leaf = await node(proposed);
      if (leaf.Uuid !== proposed || leaf.Type !== 'LEAF' || leaf.ContextWorkspace?.Uuid !== workspaceId) fail(`${entry.key}: Cells did not acknowledge the created file`);
      record(entry, leaf.Uuid);
    }
    observed.folders.push({ nativeRef: folder.Uuid, path: folderPath });
    observed.files.push({ caseKey: entry.caseKey, key: entry.key, nativeRef: values.get(`${entry.caseKey}/${entry.key}`), path });
  }
  for (const entry of drafts) {
    if (!values.has(`${entry.caseKey}/${entry.key}`)) fail(`${entry.key}: draft node was not created`);
  }
  for (const entry of all.filter((item) => item.role === 'share')) {
    if (!v1) fail('restV1BasePath is required to create share preconditions');
    // The governed revoke admits only links rooted in the binding root
    // (idm/share/native-link.go nativeShareIntent); share the root itself.
    const target = root.Uuid;
    const response = await fetch(new URL('share/link', v1), { method: 'PUT', redirect: 'manual', signal: signal(),
      headers: { authorization: `Bearer ${actor}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ShareLink: { Label: `kailo-conformance-${entry.key}`, RootNodes: [{ Uuid: target }],
        Permissions: ['Preview', 'Download'], ViewTemplateName: 'pydio_unique_strip' } }) });
    if (!response.ok) { await response.body?.cancel(); fail(`share ${entry.key}: native HTTP ${response.status}`); }
    const link = await response.json();
    if (!UUID.test(link?.Uuid ?? '') || !(link.RootNodes ?? []).some((item) => item?.Uuid === target)) fail(`share ${entry.key}: Cells returned no link for the node`);
    record(entry, link.Uuid);
    observed.shares.push({ caseKey: entry.caseKey, key: entry.key, nativeRef: target, link: link.Uuid });
  }
  const resources = {};
  let listing = 0;
  for (const entry of req.filter((item) => item.kind === 'platform-resource')) {
    if (entry.class !== 'observed' || !entry.nativeObject) fail(`resource ${entry.resourceId} has no seedable native object`);
    let value;
    if (entry.nativeObject.root) value = { nativeType: root.Type, nativeRef: root.Uuid };
    else if (entry.nativeObject.emptyFolder) {
      if (resources[entry.resourceId]) continue;
      const folder = await created(`${seed.rootName}/listing-${listing += 1}`, 'COLLECTION');
      value = { nativeType: folder.Type, nativeRef: folder.Uuid };
      observed.folders.push({ resourceId: entry.resourceId, nativeRef: folder.Uuid, empty: true });
    } else {
      const ref = values.get(`${entry.caseKey}/${entry.nativeObject.precondition}`) ?? fail(`resource ${entry.resourceId}: precondition not created`);
      value = { nativeType: 'LEAF', nativeRef: ref };
    }
    if (resources[entry.resourceId] && JSON.stringify(resources[entry.resourceId]) !== JSON.stringify(value)) fail(`resource ${entry.resourceId} maps to two native objects`);
    resources[entry.resourceId] = value;
  }
  const expected = all.length;
  if (preconditions.length !== expected) fail('not every precondition received a native identity');
  return { component: 'file-storage', formatVersion: 'V2', nativeWorkspaceId: workspaceId, nativeRootRef: root.Uuid,
    targets: { resources }, preconditions, observed };
}

main().catch((error) => {
  process.stderr.write(`seed-cells: ${error instanceof Refusal ? error.message : 'native seeding failed; partial objects stay in the isolated instance only'}\n`);
  process.exitCode = 1;
});
