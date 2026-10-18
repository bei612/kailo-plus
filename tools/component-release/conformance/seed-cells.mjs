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
// Usage: node tools/component-release/conformance/seed-cells.mjs --seed /abs/seed.json
// seed.json (owner-only):
// { "requirementsFile":"/abs/requirements.json", "cellsOrigin":"http://<isolated cells>",
//   "restBasePath":"/v2/", "workspaceSlug":"<existing native workspace slug>",
//   "rootName":"kailo-conformance-<run>", "adminTokenFile":"/abs PAT (native admin)",
//   "actorTokenFile":"/abs PAT of the native user linked to the conformance actor",
//   "s3Secret":"gatewaysecret", "timeoutMs":<int>, "out":"/abs/native-facts.json" }
// PATs come from the native `cells admin user token` command of that instance.

import { createHash, createHmac } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { constants, closeSync, openSync, writeSync } from 'node:fs';
import { isAbsolute } from 'node:path';

class Refusal extends Error {}
const fail = (message) => { throw new Refusal(message); };

async function ownerOnly(path, json = true) {
  if (!isAbsolute(path ?? '')) fail('absolute owner-only input required');
  const entry = await lstat(path);
  if (entry.isSymbolicLink() || !entry.isFile() || (entry.mode & 0o077) !== 0) fail(`${path}: owner-only regular file required`);
  const text = await readFile(path, 'utf8');
  return json ? JSON.parse(text) : text.trim();
}

function sigv4(method, url, headers, accessKey, secretKey) {
  const amzDate = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const all = { ...headers, host: url.host, 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD', 'x-amz-date': amzDate };
  const names = Object.keys(all).map((name) => name.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(all).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
  const canonicalUri = url.pathname.split('/').map((part) => encodeURIComponent(decodeURIComponent(part))).join('/');
  const request = [method, canonicalUri, '', ...names.map((name) => `${name}:${lower[name]}`), '', names.join(';'), 'UNSIGNED-PAYLOAD'].join('\n');
  const scope = `${day}/us-east-1/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(request).digest('hex')].join('\n');
  let key = Buffer.from(`AWS4${secretKey}`);
  for (const part of [day, 'us-east-1', 's3', 'aws4_request']) key = createHmac('sha256', key).update(part).digest();
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  // Host is signed but sent by fetch itself from the same URL.
  const { host, ...sent } = lower;
  return { ...sent, authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` };
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
    const url = new URL(`/io/${seed.workspaceSlug}/${path}`, origin);
    const headers = sigv4('PUT', url, { 'content-type': mediaType, ...meta }, token, seed.s3Secret);
    const response = await fetch(url, { method: 'PUT', redirect: 'manual', signal: signal(), headers, body: text });
    await response.body?.cancel();
    if (response.status !== 200) fail(`PUT ${path}: native HTTP ${response.status}`);
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

main().catch((error) => {
  process.stderr.write(`seed-cells: ${error instanceof Refusal ? error.message : 'native seeding failed; partial objects stay in the isolated instance only'}\n`);
  process.exitCode = 1;
});
