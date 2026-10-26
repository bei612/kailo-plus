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
//   "cellsExternal":"<that Cells' CELLS_EXTERNAL>" (S3 uploads are signed for this host and sent
//                   to cellsOrigin: Cells' proxy rewrites Host to it; cells-s3.mjs),
//   "adminTokenFile":"/abs native admin PAT", "s3Secret":"gatewaysecret",
//   "sourceFolders":{ "<category>:<version>:<caseKey>/<source Resource precondition key>":"<folder path>" },
//                    (the native folder each source Resource precondition is registered over)
//   "gatewayOrigin":"http://<isolated authenticated gateway>/", "humanTokenFile":"/abs isolated session",
//   "bootstrapFile":"/abs receiver-run.sh bootstrap.json (Resource preconditions the isolated Core's
//                    real resource.create returned, Resource versions after the read grants)",
//   "admissionFile":"/abs bindings-admitted.json (original fixed per-action HUMAN references)",
//   "weknoraOrigin":"http://<isolated WeKnora app>/", "weknoraTokenFile":"/abs native OIDC session", "knowledgeBaseId",
//   (legacy operator input may instead name weknoraApiKeyFile; exactly one is required)
//   "sourceText":"<fixture UTF-8 text of each source file>" (fixture content; a RECEIVER case
//                  compares no business result, DD-124(4)),
//   "retiredText":"<fixture text of the retired source file>",
//   "timeoutMs":<int>, "waitSeconds":<int>,
//   "nativeOut":"/abs/native-seed.json", "out":"/abs/native-facts.json" }

import { createHash, randomUUID } from 'node:crypto';
import { constants, closeSync, openSync, writeSync, renameSync } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { analyseV2, parseVectors } from './vector-v2.mjs';
import { externalOrigin, s3Put } from './cells-s3.mjs';

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
  let external;
  try { external = externalOrigin(seed.cellsExternal); } catch { fail('seed.json invalid: cellsExternal must be the source Cells external origin (CELLS_EXTERNAL)'); }
  const rest = new URL(seed.restBasePath, origin);
  const admin = await ownerOnly(seed.adminTokenFile, false);
  const cells = async (method, path, body) => {
    const response = await fetch(new URL(path, rest), { method, redirect: 'manual', signal: signal(),
      headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok) fail(`${method} ${path}: native HTTP ${response.status}`);
    return response.json();
  };
  // Persist a native creation intent before any mutation. An uncertain PUT is
  // reconciled by its proposed UUID; never replayed when the object is absent.
  const progressPath = `${seed.nativeOut}.progress`;
  const seedDigest = createHash('sha256').update(JSON.stringify(seed)).digest('hex');
  let progress;
  try { progress = await ownerOnly(progressPath); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (progress && progress.seedDigest !== seedDigest) fail('retained native seed input changed');
  progress ??= { seedDigest, files: {} };
  const persist = () => {
    const next = `${progressPath}.${randomUUID()}`;
    createOnly(next, progress);
    renameSync(next, progressPath);
  };
  const createFile = async (intentKey, folder, name, text, mediaType) => {
    const request = { folder, name, mediaType, contentSha256: createHash('sha256').update(text).digest('hex') };
    let entry = progress.files[intentKey];
    if (!entry) {
      entry = progress.files[intentKey] = { request, proposed: randomUUID(), attempted: false };
      persist();
    }
    if (JSON.stringify(entry.request) !== JSON.stringify(request) || !UUID.test(entry.proposed)) fail('retained native file intent changed');
    const lookup = async () => {
      const response = await fetch(new URL(`n/node/${entry.proposed}?Flags=WithMetaDefaults`, rest), {
        redirect: 'manual', signal: signal(), headers: { authorization: `Bearer ${admin}` } });
      if (response.status === 404) return null;
      if (!response.ok) fail(`native file lookup HTTP ${response.status}`);
      return response.json();
    };
    let leaf = await lookup();
    if (!leaf) {
      if (entry.confirmed || entry.attempted) fail('retained native file is absent after submission; refusing to recreate or replay uncertain PUT');
      entry.attempted = true;
      persist();
      const status = await s3Put({ origin, external, path: `/io/${seed.workspaceSlug}/${folder}/${name}`, body: text,
        headers: { 'content-type': mediaType, 'x-amz-meta-create-resource-uuid': entry.proposed }, accessKey: admin, secretKey: seed.s3Secret, signal: signal() });
      if (status !== 200) fail(`PUT ${folder}/${name}: native HTTP ${status}`);
      leaf = await lookup();
    }
    if (leaf?.Uuid !== entry.proposed || leaf.Type !== 'LEAF') fail(`${folder}/${name}: Cells did not acknowledge the created file`);
    const versions = await cells('POST', `n/node/${entry.proposed}/versions`, { FilterBy: 'VersionsAll', Offset: 0, Limit: 0, Flags: ['WithMetaNone'] });
    const published = (versions.Versions ?? []).filter((version) => version.Draft !== true);
    if (published.length !== 1 || !nonempty(published[0].VersionId)) fail(`${folder}/${name}: Cells lists no single published revision`);
    const confirmed = { nativeObjectRef: leaf.Uuid, nativeRevision: published[0].VersionId, path: `${folder}/${name}` };
    if (entry.confirmed && JSON.stringify(entry.confirmed) !== JSON.stringify(confirmed)) fail('confirmed native file revision changed');
    entry.confirmed = confirmed;
    persist();
    return confirmed;
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
      if (!nonempty(seed.sourceText)) fail('sourceText is required for a source file');
      const file = await createFile(`${item.caseKey}/${item.key}`, folderOf(item.sourceKey), item.properties.displayName, seed.sourceText, item.properties.mediaType);
      files.push({ caseKey: item.caseKey, fileKey: item.key, revisionKey: revision.key, sourceKey: item.sourceKey,
        displayName: item.properties.displayName, mediaType: item.properties.mediaType, ...file });
    }
    const retiring = preconditions.filter((entry) => entry.kind === 'retiring_import_config');
    const retired = [];
    for (const item of retiring) {
      if (!nonempty(seed.retiredText)) fail('retiredText is required for a retiring import configuration');
      const file = await createFile(`${item.caseKey}/${item.key}`, folderOf(item.sourceKey), `retired-${createHash('sha256').update(`${item.caseKey}/${item.key}`).digest('hex').slice(0, 24)}.md`, seed.retiredText, 'text/markdown');
      retired.push({ caseKey: item.caseKey, key: item.key, sourceKey: item.sourceKey, ...file });
    }
    const record = { component: 'knowledge', phase: 'native', files, retired };
    let old;
    try { old = await ownerOnly(seed.nativeOut); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (old && JSON.stringify(old) !== JSON.stringify(record)) fail('confirmed native seed differs');
    if (!old) createOnly(seed.nativeOut, record);
    process.stdout.write(`${JSON.stringify({ nativeSeed: seed.nativeOut, files: files.length, retired: retired.length })}\n`);
    return;
  }

  const governedPath = `${seed.out}.progress`;
  let governedState;
  try { governedState = await ownerOnly(governedPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (governedState && governedState.seedDigest !== seedDigest) fail('retained governed seed input changed');
  governedState ??= { seedDigest, actions: {}, dataSources: {}, batches: {} };
  const remember = () => {
    const next = `${governedPath}.${randomUUID()}`;
    createOnly(next, governedState);
    renameSync(next, governedPath);
  };
  const native = await ownerOnly(seed.nativeOut);
  if (native.phase !== 'native') fail('native seed record required before the governed phase');
  const gateway = new URL(seed.gatewayOrigin);
  const core = async (method, path, body) => {
    const human = await ownerOnly(seed.humanTokenFile, false);
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
  const admitted = await ownerOnly(seed.admissionFile);
  const sources = admitted.bindings?.filter((item) => item.role === 'SOURCE') ?? [];
  if (admitted.mode !== 'CONFORMANCE_ONLY' || admitted.setup !== 'BINDINGS_ADMITTED'
    || admitted.environmentId !== bootstrap.environmentId || admitted.inputDigest !== bootstrap.inputDigest
    || sources.length !== 1 || sources[0].componentReleaseId !== bootstrap.sourceRelease?.releaseId) {
    fail('source fixed HUMAN admission metadata does not belong to the READY environment');
  }
  const source = sources[0];
  const policyFor = (actionKey) => {
    const refs = source.humanActionPolicies?.filter((item) => item.actionKey === actionKey) ?? [];
    if (refs.length !== 1 || refs[0].componentReleaseId !== source.componentReleaseId
      || refs[0].generation !== source.generation || !UUID.test(refs[0].resultExposurePolicyId ?? '')
      || !Number.isSafeInteger(refs[0].actionVersion) || refs[0].actionVersion <= 0 || refs[0].resultExposurePolicyVersion !== 1) {
      fail(`${actionKey}: exact source fixed HUMAN policy is missing`);
    }
    return refs[0];
  };
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
    if (!Number.isSafeInteger(version) || !(bootstrap.resources ?? []).some((item) => item.resourceId === resourceId
      && item.role === 'SOURCE' && item.bindingId === source.bindingId)) fail(`source Resource ${resourceId} was not bootstrapped`);
    const policy = policyFor(actionKey);
    const command = { actionKey, idempotencyKey: key, resourceId, resourceVersion: version,
      componentAction: { actionVersion: policy.actionVersion, ...component,
        resultExposurePolicyId: policy.resultExposurePolicyId, resultExposurePolicyVersion: policy.resultExposurePolicyVersion } };
    let retained = governedState.actions[key];
    if (!retained) { retained = governedState.actions[key] = { command }; remember(); }
    if (JSON.stringify(retained.command) !== JSON.stringify(command)) fail('retained governed seed command changed');
    let id = retained.actionExecutionId;
    if (!id) {
      // Original Core idempotency is authoritative for an uncertain admission.
      // The exact persisted key AND full command are reused; no new intent.
      const submitted = await core('POST', 'api/v1/actions', command);
      id = submitted.body?.actionExecutionId;
      if (![200, 202].includes(submitted.status) || !UUID.test(id ?? '')) fail(`${actionKey} refused by the isolated Core: HTTP ${submitted.status}`);
      retained.actionExecutionId = id;
      remember();
    }
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
  if (Boolean(seed.weknoraApiKeyFile) === Boolean(seed.weknoraTokenFile)) fail('one native WeKnora credential delivery is required');
  const weknora = async (method, path, body) => {
    const credential = await ownerOnly(seed.weknoraTokenFile ?? seed.weknoraApiKeyFile, false);
    const authorization = seed.weknoraTokenFile ? { authorization: `Bearer ${credential}` } : { 'x-api-key': credential };
    const response = await fetch(new URL(path, seed.weknoraOrigin), { method, redirect: 'manual', signal: signal(),
      headers: { ...authorization, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok) fail(`WeKnora ${method} ${path}: native HTTP ${response.status}`);
    const value = await response.json();
    return value?.data ?? value;
  };
  const dataSource = async (resourceId, purpose) => {
    const name = `kailo-conformance-${key('datasource', resourceId, purpose)}`;
    const request = { knowledge_base_id: seed.knowledgeBaseId, name, type: 'file_storage',
      config: { type: 'file_storage', resource_ids: [resourceId] }, sync_mode: 'incremental', sync_deletions: true };
    let retained = governedState.dataSources[name];
    if (!retained) { retained = governedState.dataSources[name] = { request, attempted: false }; remember(); }
    if (JSON.stringify(retained.request) !== JSON.stringify(request)) fail('retained data source intent changed');
    const list = await weknora('GET', `api/v1/datasource?kb_id=${encodeURIComponent(seed.knowledgeBaseId)}`);
    if (!Array.isArray(list)) fail('native data source listing is incomplete');
    const matches = list.filter((row) => row.name === name);
    if (matches.length > 1) fail('native data source name is ambiguous');
    let found = matches[0];
    if (!found) {
      if (retained.id || retained.attempted) fail('data source missing after submission; refusing to recreate or replay uncertain creation');
      retained.attempted = true;
      remember();
      found = await weknora('POST', 'api/v1/datasource', request);
    }
    if (!UUID.test(found?.id ?? '') || found.knowledge_base_id !== seed.knowledgeBaseId || found.type !== 'file_storage'
      || found.config?.type !== 'file_storage' || JSON.stringify(found.config?.resource_ids) !== JSON.stringify([resourceId])
      || found.sync_mode !== 'incremental' || found.sync_deletions !== true || (retained.id && retained.id !== found.id)) {
      fail('native data source does not match the original receiver intent');
    }
    retained.id = found.id;
    remember();
    return found.id;
  };
  const seedBatch = async (id) => {
    let retained = governedState.batches[id];
    if (!retained) { retained = governedState.batches[id] = { attempted: false }; remember(); }
    let log;
    if (retained.id) log = await weknora('GET', `api/v1/datasource/logs/${retained.id}`);
    else {
      const logs = await weknora('GET', `api/v1/datasource/${id}/logs?limit=2&offset=0`);
      if (!Array.isArray(logs) || logs.length > 1 || (!retained.attempted && logs.length)) fail('retiring seed has an unexpected native batch');
      log = logs[0];
      if (!log) {
        if (retained.attempted) fail('native batch submission is uncertain; refusing a second batch');
        retained.attempted = true;
        remember();
        log = await weknora('POST', `api/v1/datasource/${id}/sync`);
      }
      if (!UUID.test(log?.id ?? '')) fail('native batch returned no observed identity');
      retained.id = log.id;
      remember();
    }
    const deadline = Date.now() + seed.waitSeconds * 1000;
    while (log.status === 'running' && Date.now() < deadline) {
      await sleep(3000);
      log = await weknora('GET', `api/v1/datasource/logs/${retained.id}`);
    }
    if (log.id !== retained.id || log.data_source_id !== id || log.status !== 'success') fail('native retiring seed batch did not succeed for its source');
    return log;
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
    const log = await seedBatch(id);
    const status = log.status;
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
  const record = { component: 'knowledge', formatVersion: 'V2', preconditions: values, observed };
  let previous;
  try { previous = await ownerOnly(seed.out); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous && JSON.stringify(previous) !== JSON.stringify(record)) fail('confirmed governed seed changed');
  if (!previous) createOnly(seed.out, record);
  process.stdout.write(`${JSON.stringify({ nativeFacts: seed.out, preconditions: values.length })}\n`);
}

function nonempty(value) { return typeof value === 'string' && value.trim() !== ''; }

main().catch((error) => {
  process.stderr.write(`seed-knowledge: ${error instanceof Refusal ? error.message : 'seeding failed; partial objects stay in the isolated deployment only'}\n`);
  process.exitCode = 1;
});
