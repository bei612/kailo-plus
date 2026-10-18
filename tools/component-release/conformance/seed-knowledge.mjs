#!/usr/bin/env node
// Seed of tools/component-release/receiver-run.sh for knowledge@3 (DD-124(3)(4),
// 07 §8A): create every case precondition of the frozen knowledge vectors
// inside the isolated receiver deployment, only through original entries, and
// record exactly the identities those entries returned. Nothing here writes
// SQL, simulates a receipt or produces an expectation.
//
//   --phase native    (before the APPROVED source release receives its platform
//                     native-action delivery) source files of the source
//                     Resources' native folders: S3 gateway PUT with a fresh
//                     proposed node UUID that Cells must acknowledge; the head
//                     revision is the one Cells lists for that node
//   --phase governed  (after receiver-run.sh bootstrap) each source_file /
//                     source_revision pair is confirmed by one actual contract
//                     read of the source release through the isolated Core
//                     (HUMAN file_storage.read@v2, COMPLETED), and only then
//                     recorded; import configurations are WeKnora file_storage
//                     data sources of the receiver knowledge base created
//                     through WeKnora's own /api/v1/datasource entry. A
//                     retiring configuration first completes one native batch
//                     that imports a source file, which is then deleted through
//                     the source release's governed file_storage.delete@v2
//
// Usage: node tools/component-release/conformance/seed-knowledge.mjs --phase native|governed --seed /abs/seed.json
// seed.json (owner-only):
// { "requirementsFile":"/abs vector-requirements output (component knowledge, satisfiable)",
//   "registrationFile":"/abs contracts/adapter/knowledge.v3/registration.json",
//   "cellsOrigin":"http://<isolated source Cells>", "restBasePath":"/v2/", "workspaceSlug",
//   "adminTokenFile":"/abs native admin PAT", "s3Secret":"gatewaysecret",
//   "sourceFolders":{ "<category>:<version>:<caseKey>/<source Resource precondition key>":"<folder path>" },
//                    (the native folder each source Resource precondition is registered over)
//   "gatewayOrigin":"http://<isolated authenticated gateway>/", "humanTokenFile":"/abs isolated session",
//   "bootstrapFile":"/abs receiver-run.sh bootstrap.json (Resource preconditions the isolated Core's
//                    real resource.create returned, Resource versions after the read grants)",
//   "resultExposurePolicyId", "resultExposurePolicyVersion", "fileStorageActionVersion",
//   "weknoraOrigin":"http://<isolated WeKnora app>/", "weknoraApiKeyFile":"/abs", "knowledgeBaseId",
//   "retiredText":"<fixture text of the retired source file>",
//   "timeoutMs":<int>, "waitSeconds":<int>,
//   "nativeOut":"/abs/native-seed.json", "out":"/abs/native-facts.json" }

import { randomUUID, createHash, createHmac } from 'node:crypto';
import { constants, closeSync, openSync, writeSync } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { analyseV2, parseVectors } from './vector-v2.mjs';

class Refusal extends Error {}
const fail = (message) => { throw new Refusal(message); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ownerOnly(path, json = true) {
  if (!isAbsolute(path ?? '')) fail('absolute owner-only input required');
  const entry = await lstat(path);
  if (entry.isSymbolicLink() || !entry.isFile() || (entry.mode & 0o077) !== 0) fail(`${path}: owner-only regular file required`);
  const text = await readFile(path, 'utf8');
  return json ? JSON.parse(text) : text.trim();
}

function createOnly(path, value) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try { writeSync(fd, `${JSON.stringify(value, null, 2)}\n`); } finally { closeSync(fd); }
}

// Same AWS SigV4 (UNSIGNED-PAYLOAD) as seed-cells.mjs for the Cells S3 gateway.
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
  const { host, ...sent } = lower;
  return { ...sent, authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` };
}

// Every precondition of the frozen knowledge vectors with the source Resource
// precondition each one belongs to (the step input that sends it). DD-124(4):
// Resource preconditions themselves are the bootstrap's resource.create ids.
function plan(registration, requirements) {
  if (requirements.component !== 'knowledge' || requirements.satisfiable !== true) {
    fail('knowledge vector requirements are not satisfiable; seeding refused');
  }
  const analysed = analyseV2(parseVectors(registration), `knowledge@${registration.contractVersion}`);
  const out = [];
  for (const vectorCase of analysed.cases) {
    const caseKey = `${registration.categoryKey}:${registration.contractVersion}:${vectorCase.caseKey}`;
    for (const precondition of vectorCase.preconditions) {
      if (['receiver_resource', 'source_resource'].includes(precondition.kind)) {
        out.push({ caseKey, key: precondition.key, kind: precondition.kind, properties: precondition.properties });
        continue;
      }
      const sending = vectorCase.steps.find((step) => step.bindings.some((b) => b.side === 'INPUT'
        && b.source === 'PRECONDITION' && b.key === precondition.key));
      const source = sending?.bindings.find((b) => b.side === 'INPUT' && b.source === 'PRECONDITION'
        && ['/sourceResourceId', '/resourceId'].includes(b.pointer));
      const resource = vectorCase.preconditions.find((item) => item.key === source?.key && item.kind === 'source_resource');
      if (!resource) fail(`${caseKey}/${precondition.key}: no source Resource precondition is sent with it`);
      out.push({ caseKey, key: precondition.key, kind: precondition.kind, properties: precondition.properties,
        sourceKey: `${caseKey}/${resource.key}`, step: sending });
    }
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--phase' || !['native', 'governed'].includes(args[1]) || args[2] !== '--seed') {
    fail('usage: seed-knowledge.mjs --phase native|governed --seed /abs/seed.json');
  }
  const phase = args[1];
  const seed = await ownerOnly(args[3]);
  if (!Number.isSafeInteger(seed.timeoutMs) || seed.timeoutMs <= 0 || !Number.isSafeInteger(seed.waitSeconds) || seed.waitSeconds <= 0
    || !isAbsolute(seed.nativeOut ?? '') || !isAbsolute(seed.out ?? '') || !/^[a-z0-9][a-z0-9-]*$/.test(seed.workspaceSlug ?? '')) {
    fail('seed.json invalid');
  }
  const preconditions = plan(JSON.parse(await readFile(seed.registrationFile, 'utf8')), await ownerOnly(seed.requirementsFile));
  const signal = () => AbortSignal.timeout(seed.timeoutMs);
  const origin = new URL(seed.cellsOrigin);
  const rest = new URL(seed.restBasePath, origin);
  const admin = await ownerOnly(seed.adminTokenFile, false);
  const cells = async (method, path, body) => {
    const response = await fetch(new URL(path, rest), { method, redirect: 'manual', signal: signal(),
      headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok) fail(`${method} ${path}: native HTTP ${response.status}`);
    return response.json();
  };
  // A file created through the Cells gateway with a proposed node UUID that
  // Cells must acknowledge, and the single published revision Cells lists.
  const createFile = async (folder, name, text, mediaType) => {
    const proposed = randomUUID();
    const url = new URL(`/io/${seed.workspaceSlug}/${folder}/${name}`, origin);
    const headers = sigv4('PUT', url, { 'content-type': mediaType, 'x-amz-meta-create-resource-uuid': proposed }, admin, seed.s3Secret);
    const response = await fetch(url, { method: 'PUT', redirect: 'manual', signal: signal(), headers, body: text });
    await response.body?.cancel();
    if (response.status !== 200) fail(`PUT ${folder}/${name}: native HTTP ${response.status}`);
    const leaf = await cells('GET', `n/node/${proposed}?Flags=WithMetaDefaults`);
    if (leaf?.Uuid !== proposed || leaf.Type !== 'LEAF') fail(`${folder}/${name}: Cells did not acknowledge the created file`);
    const versions = await cells('POST', `n/node/${proposed}/versions`, { FilterBy: 'VersionsAll', Offset: 0, Limit: 0, Flags: ['WithMetaNone'] });
    const published = (versions.Versions ?? []).filter((version) => version.Draft !== true);
    if (published.length !== 1 || !nonempty(published[0].VersionId)) fail(`${folder}/${name}: Cells lists no single published revision`);
    return { nativeObjectRef: proposed, nativeRevision: published[0].VersionId, path: `${folder}/${name}` };
  };
  const folderOf = (sourceKey) => {
    const folder = seed.sourceFolders?.[sourceKey];
    if (typeof folder !== 'string' || !/^[A-Za-z0-9._/-]+$/.test(folder) || folder.includes('..')) fail(`no native folder for source Resource ${sourceKey}`);
    return folder;
  };

  if (phase === 'native') {
    const files = [];
    for (const item of preconditions.filter((entry) => entry.kind === 'source_file')) {
      const revision = preconditions.find((entry) => entry.caseKey === item.caseKey && entry.kind === 'source_revision')
        ?? fail(`${item.caseKey}: source_file without source_revision`);
      const file = await createFile(folderOf(item.sourceKey), item.properties.displayName, revision.properties.text, item.properties.mediaType);
      files.push({ caseKey: item.caseKey, fileKey: item.key, revisionKey: revision.key, sourceKey: item.sourceKey,
        displayName: item.properties.displayName, mediaType: item.properties.mediaType, ...file });
    }
    const retiring = preconditions.filter((entry) => entry.kind === 'retiring_import_config');
    const retired = [];
    for (const item of retiring) {
      if (!nonempty(seed.retiredText)) fail('retiredText is required for a retiring import configuration');
      const file = await createFile(folderOf(item.sourceKey), `retired-${randomUUID()}.md`, seed.retiredText, 'text/markdown');
      retired.push({ caseKey: item.caseKey, key: item.key, sourceKey: item.sourceKey, ...file });
    }
    createOnly(seed.nativeOut, { component: 'knowledge', phase: 'native', files, retired });
    process.stdout.write(`${JSON.stringify({ nativeSeed: seed.nativeOut, files: files.length, retired: retired.length })}\n`);
    return;
  }

  const native = await ownerOnly(seed.nativeOut);
  if (native.phase !== 'native') fail('native seed record required before the governed phase');
  const human = await ownerOnly(seed.humanTokenFile, false);
  const gateway = new URL(seed.gatewayOrigin);
  const core = async (method, path, body) => {
    const response = await fetch(new URL(path, gateway), { method, redirect: 'manual', signal: signal(),
      headers: { authorization: `Bearer ${human}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    let value = null;
    try { value = JSON.parse(text); } catch { /* non-JSON */ }
    return { status: response.status, body: value };
  };
  const bootstrap = await ownerOnly(seed.bootstrapFile);
  if (bootstrap.mode !== 'CONFORMANCE_ONLY' || bootstrap.setup !== 'READY' || !Array.isArray(bootstrap.preconditions)) {
    fail('isolated bootstrap is not READY');
  }
  // The Resource ids the isolated Core's real resource.create returned.
  const resourceOf = (key) => {
    const at = key.lastIndexOf('/');
    const found = bootstrap.preconditions.filter((item) => item.caseKey === key.slice(0, at) && item.key === key.slice(at + 1));
    if (found.length !== 1 || !UUID.test(found[0].value ?? '')) fail(`${key}: the bootstrap registered no Resource for it`);
    return found[0].value;
  };
  // One governed HUMAN action of the source release through the isolated
  // Core's own endpoint, idempotent by its key; only COMPLETED is accepted.
  const governed = async (actionKey, resourceId, component, key) => {
    const version = (bootstrap.resources ?? []).find((item) => item.resourceId === resourceId && item.role === 'SOURCE')?.version;
    if (!Number.isSafeInteger(version)) fail(`source Resource ${resourceId} was not bootstrapped`);
    const submitted = await core('POST', 'api/v1/actions', { actionKey, idempotencyKey: key, resourceId, resourceVersion: version,
      componentAction: { actionVersion: seed.fileStorageActionVersion, ...component,
        resultExposurePolicyId: seed.resultExposurePolicyId, resultExposurePolicyVersion: seed.resultExposurePolicyVersion } });
    const id = submitted.body?.actionExecutionId;
    if (![200, 202].includes(submitted.status) || !UUID.test(id ?? '')) fail(`${actionKey} refused by the isolated Core: HTTP ${submitted.status}`);
    const deadline = Date.now() + seed.waitSeconds * 1000;
    while (Date.now() < deadline) {
      const task = await core('GET', `api/v1/tasks/${id}`);
      const view = task.body ?? {};
      if (task.status === 200 && (['DENIED', 'EXPIRED', 'REVOKED'].includes(view.gateState)
        || ['FAILED', 'CANCELED', 'TERMINATED', 'TIMED_OUT'].includes(view.taskStatus))) fail(`${actionKey} ended ${view.gateState}/${view.taskStatus}`);
      if (task.status === 200 && view.taskStatus === 'COMPLETED' && !view.observation) return id;
      await sleep(3000);
    }
    return fail(`${actionKey} ${id} not COMPLETED within ${seed.waitSeconds}s; re-run (same key)`);
  };
  const key = (...parts) => {
    const hash = createHash('sha256').update(['seed-knowledge', seed.knowledgeBaseId, ...parts].join('\u001f')).digest('hex');
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-${((parseInt(hash[16], 16) & 3) | 8).toString(16)}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  };
  const apiKey = await ownerOnly(seed.weknoraApiKeyFile, false);
  const weknora = async (method, path, body) => {
    const response = await fetch(new URL(path, seed.weknoraOrigin), { method, redirect: 'manual', signal: signal(),
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok) fail(`WeKnora ${method} ${path}: native HTTP ${response.status}`);
    const value = await response.json();
    return value?.data ?? value;
  };
  const dataSource = async (resourceId, name) => {
    const created = await weknora('POST', 'api/v1/datasource', { knowledge_base_id: seed.knowledgeBaseId, name, type: 'file_storage',
      config: { type: 'file_storage', resource_ids: [resourceId] }, sync_mode: 'incremental' });
    if (!UUID.test(created?.id ?? '')) fail(`WeKnora returned no data source for ${resourceId}`);
    return created.id;
  };

  const values = [];
  const observed = { reads: [], dataSources: [], batches: [], deletes: [] };
  // DD-124(4): Resource preconditions are exactly the bootstrap's returned ids.
  for (const item of preconditions.filter((entry) => ['receiver_resource', 'source_resource'].includes(entry.kind))) {
    values.push({ caseKey: item.caseKey, key: item.key, value: resourceOf(`${item.caseKey}/${item.key}`) });
  }
  for (const file of native.files) {
    const resourceId = resourceOf(file.sourceKey);
    const reference = { resourceId, nativeObjectRef: file.nativeObjectRef, nativeRevision: file.nativeRevision,
      displayName: file.displayName, mediaType: file.mediaType };
    const read = await governed('file_storage.read@v2', resourceId, { inputReference: reference }, key('read', file.nativeObjectRef));
    values.push({ caseKey: file.caseKey, key: file.fileKey, value: file.nativeObjectRef },
      { caseKey: file.caseKey, key: file.revisionKey, value: file.nativeRevision });
    observed.reads.push({ caseKey: file.caseKey, actionExecutionId: read, nativeObjectRef: file.nativeObjectRef });
  }
  for (const item of preconditions.filter((entry) => entry.kind === 'retiring_import_config')) {
    const retired = native.retired.find((entry) => entry.caseKey === item.caseKey && entry.key === item.key)
      ?? fail(`${item.caseKey}/${item.key}: no retired source file was created`);
    const resourceId = resourceOf(item.sourceKey);
    const id = await dataSource(resourceId, `kailo-conformance-${item.key}`);
    const log = await weknora('POST', `api/v1/datasource/${id}/sync`);
    const deadline = Date.now() + seed.waitSeconds * 1000;
    let status = log?.status;
    while (status === 'running' && Date.now() < deadline) {
      await sleep(3000);
      status = (await weknora('GET', `api/v1/datasource/logs/${log.id}`))?.status;
    }
    if (status !== 'success') fail(`${item.key}: native batch ended ${status}; the import configuration is not retiring`);
    const deleted = await governed('file_storage.delete@v2', resourceId, { inputJson: JSON.stringify({ nativeObjectRefs: [retired.nativeObjectRef],
      removePermanently: true, resourceId }) }, key('delete', retired.nativeObjectRef));
    values.push({ caseKey: item.caseKey, key: item.key, value: id });
    observed.dataSources.push({ caseKey: item.caseKey, key: item.key, id });
    observed.batches.push({ dataSourceId: id, syncLogId: log.id, status });
    observed.deletes.push({ actionExecutionId: deleted, nativeObjectRef: retired.nativeObjectRef });
  }
  for (const item of preconditions.filter((entry) => entry.kind === 'import_config')) {
    const id = await dataSource(resourceOf(item.sourceKey), `kailo-conformance-${item.key}`);
    values.push({ caseKey: item.caseKey, key: item.key, value: id });
    observed.dataSources.push({ caseKey: item.caseKey, key: item.key, id });
  }
  for (const item of preconditions) {
    if (!values.some((value) => value.caseKey === item.caseKey && value.key === item.key)) fail(`${item.caseKey}/${item.key}: kind ${item.kind} was not seeded`);
  }
  createOnly(seed.out, { component: 'knowledge', formatVersion: 'V2', preconditions: values, observed });
  process.stdout.write(`${JSON.stringify({ nativeFacts: seed.out, preconditions: values.length })}\n`);
}

function nonempty(value) { return typeof value === 'string' && value.trim() !== ''; }

main().catch((error) => {
  process.stderr.write(`seed-knowledge: ${error instanceof Refusal ? error.message : 'seeding failed; partial objects stay in the isolated deployment only'}\n`);
  process.exitCode = 1;
});
