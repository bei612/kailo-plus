#!/usr/bin/env node
// Batch F16: governed component_release.register of one built-in reference
// release (BUILTIN_REFERENCE, DD-88/94, V-SCN-18) by the Catalog platform
// admin. Input is the render.mjs output directory (registration.json with the
// three exact JSON strings). Core freezes the conformance plan from the
// deployment's COMPONENT_CONFORMANCE_* delivery, whose artifactDigest must equal
// this manifest's adapterBuildRef: the candidate <COMPONENT_CONFORMANCE_DIR>/<digest>/
// installed by component-deploy.sh <component> <commit> --conformance (DD-136(2)(5)).
// A DD-127 native page entry (render.mjs --material native-page) has no
// adapter: Core freezes an empty suite and needs no conformance inputs.
//
// Usage: node component-register.mjs --release-dir <rendered dir> [--attempt N] [--wait-seconds 1800]
// Idempotent: an existing release with the same componentReleaseId is only
// reported; the register command key is derived from the manifest digest.
import { attempt, FlowError, key, log, login, main, parseArgs, readAll, renderedRelease, requireSession, sleep, submit, waitTask } from './lib.mjs';

await main(async () => {
  const args = parseArgs(process.argv.slice(2), ['release-dir', 'attempt', 'wait-seconds']);
  if (!args['release-dir']) throw new FlowError('--release-dir is required', 2);
  const run = attempt(args);
  const { registration, manifest, manifestDigest } = renderedRelease(args['release-dir']);
  const admin = await login('platform-admin', `register-${manifest.componentTypeKey}`);
  const catalog = await requireSession(admin);
  const find = async () => (await readAll(admin, '/api/v1/platform/component-releases', 'releases')).rows
    .find((row) => row.componentReleaseId === manifest.id);
  let release = await find();
  if (release) {
    log({ step: 'exists', componentReleaseId: release.componentReleaseId, componentTypeKey: release.componentTypeKey, version: release.version,
      status: release.status, manifestDigest: release.manifestDigest, expectedManifestDigest: manifestDigest, artifactDigest: release.artifactDigest });
    if (release.manifestDigest !== manifestDigest) throw new FlowError('a different manifest is registered under this id/version; bump the version', 2);
    return;
  }
  const submitted = await submit(admin, { actionKey: 'component_release.register',
    idempotencyKey: key('component_release.register', catalog.tenantId, manifest.id, manifestDigest, run),
    explicitConfirmation: true, componentReleaseRegistration: registration }, 'register');
  const task = await waitTask(admin, submitted.actionExecutionId, { seconds: Number(args['wait-seconds'] ?? 1800), label: 'register-task' });
  for (let i = 0; i < 20 && !release; i++) { release = await find(); if (!release) await sleep(3000); }
  log({ step: 'result', componentReleaseId: manifest.id, status: release?.status ?? 'ABSENT', suiteDigest: release?.suiteDigest,
    taskStatus: task.taskStatus, reason: task.reason });
  if (release?.status !== 'REGISTERED') {
    throw new FlowError('release not REGISTERED; read the task reason and the Worker conformance observation before any new --attempt');
  }
});
