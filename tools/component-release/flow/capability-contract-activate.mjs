#!/usr/bin/env node
// Make one checked-in capability contract version ACTIVE through the governed
// path only (capability_contract.register -> DRAFT, then
// capability_contract.approve decided by a second Catalog admin; DD-102/108,
// DD-124(3), V-SCN-117/18). Used for file_storage@2, knowledge@3 and data_query@2, in the
// production Catalog and, with KAILO_WEB/KAILO_DEPLOY_DIR pointing at it, in a
// 07 §8A isolated receiver deployment (tools/component-release/receiver-run.sh).
//
// Only a V2 vector document is activated: DD-124(1)-(3) leaves V1 versions
// whose vectors write implementation-generated values as literals (such as
// knowledge@2) DRAFT, to be withdrawn by capability-contract-deprecate.mjs.
// An existing DRAFT is approved only if both its schemaSetDigest and its
// conformanceSuiteDigest equal what Core computes for the checked-in
// registration (capability_contract.rs registration()/vectors()); a differing
// row stops the run instead of being approved.
//
// Usage: node capability-contract-activate.mjs
//          --registration <apps>/contracts/adapter/<category>.v<N>/registration.json
//          [--approver kailo-platform-approver] [--attempt N]
// Exit codes follow lib.mjs main(): 0 ACTIVE, 1 refused, 2 invalid input,
// 3 still converging (re-run the same command).
import { readFileSync } from 'node:fs';
import { api, approve, attempt, FlowError, key, log, login, main, parseArgs, requireSession, sleep, submit } from './lib.mjs';
import { contract, expectedSchemaSetDigest, expectedSuiteDigest } from './capability-contract.mjs';

await main(async () => {
  const args = parseArgs(process.argv.slice(2), ['registration', 'approver', 'attempt']);
  if (!args.registration) throw new FlowError('--registration <contracts/adapter/<category>.v<N>/registration.json> is required', 2);
  const run = attempt(args);
  const registration = JSON.parse(readFileSync(args.registration, 'utf8'));
  const { categoryKey, contractVersion } = registration;
  if (!/^[a-z][a-z0-9_]*$/.test(categoryKey ?? '') || !Number.isSafeInteger(contractVersion) || contractVersion < 1) {
    throw new FlowError('registration has no category/version', 2);
  }
  const label = `${categoryKey}@${contractVersion}`;
  const schemaSetDigest = expectedSchemaSetDigest(registration);
  const suite = expectedSuiteDigest(registration);
  if (suite.formatVersion !== 'V2') {
    throw new FlowError(`${label} uses ${suite.formatVersion} vectors; DD-124 activates only V2 versions`, 2);
  }
  const admin = await login('platform-admin', `contract-${categoryKey}-v${contractVersion}-admin`);
  const catalog = await requireSession(admin);

  let row = await contract(admin, categoryKey, contractVersion);
  log({ step: 'read', contract: label, status: row?.status ?? 'ABSENT', schemaSetDigest: row?.schemaSetDigest,
    expectedSchemaSetDigest: schemaSetDigest, conformanceSuiteDigest: row?.conformanceSuiteDigest,
    expectedConformanceSuiteDigest: suite.digest, registeredByActionExecutionId: row?.registeredByActionExecutionId });
  if (row && (row.schemaSetDigest !== schemaSetDigest || row.conformanceSuiteDigest !== suite.digest)) {
    throw new FlowError(`${label} ${row.status} differs from the checked-in registration; do not approve it — `
      + 'a fixed contract version is immutable, register a new version instead', 2);
  }
  if (row?.status === 'ACTIVE') { log({ step: 'done', contract: label, status: 'ACTIVE' }); return; }
  if (row && row.status !== 'DRAFT') throw new FlowError(`${label} is ${row.status}; it cannot be approved`, 2);

  if (!row) {
    await submit(admin, { actionKey: 'capability_contract.register',
      idempotencyKey: key('capability_contract.register', catalog.tenantId, categoryKey, contractVersion, schemaSetDigest, suite.digest, run),
      explicitConfirmation: true, capabilityContractRegistration: registration }, 'register');
    for (let i = 0; i < 20 && !row; i++) { await sleep(2000); row = await contract(admin, categoryKey, contractVersion); }
    if (row?.status !== 'DRAFT' || row.schemaSetDigest !== schemaSetDigest || row.conformanceSuiteDigest !== suite.digest) {
      throw new FlowError('registered contract not readable as the expected DRAFT yet; re-run', 3);
    }
  }

  const request = await submit(admin, { actionKey: 'capability_contract.approve',
    idempotencyKey: key('capability_contract.approve', catalog.tenantId, categoryKey, contractVersion, schemaSetDigest, suite.digest, run),
    capabilityContractRef: { categoryKey, contractVersion } }, 'approve-request');
  if (request.approvalWorkflowId) {
    const approver = await login(args.approver ?? 'kailo-platform-approver', `contract-${categoryKey}-v${contractVersion}-approver`);
    const member = await requireSession(approver);
    if (member.tenantId !== catalog.tenantId) throw new FlowError('approver is not in the Catalog Tenant', 2);
    await approve(approver, request.approvalWorkflowId, { expectActionKey: 'capability_contract.approve' });
  }
  for (let i = 0; i < 100; i++) {
    row = await contract(admin, categoryKey, contractVersion);
    if (row?.status === 'ACTIVE') break;
    await sleep(3000);
  }
  if (row?.status !== 'ACTIVE') {
    const task = await api(admin, 'GET', `/api/v1/tasks/${request.actionExecutionId}`);
    log({ step: 'approve-task', gateState: task.body?.gateState, approvalStatus: task.body?.approvalStatus, taskStatus: task.body?.taskStatus, reason: task.body?.reason });
    throw new FlowError(`${label} still ${row?.status}; re-run the same command to keep waiting`, 3);
  }
  log({ step: 'done', contract: label, status: 'ACTIVE', schemaSetDigest: row.schemaSetDigest, conformanceSuiteDigest: row.conformanceSuiteDigest });
});
