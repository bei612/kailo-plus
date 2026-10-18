#!/usr/bin/env node
// Batch F (prerequisite of the WeKnora release, which implements knowledge@2):
// make the Catalog capability contract knowledge@2 ACTIVE through the
// governed path only (capability_contract.register -> DRAFT, then
// capability_contract.approve with a second Catalog admin; DD-108, V-SCN-18).
//
// The deployment already holds a leftover knowledge@2 DRAFT from testing. It
// is approved only if its schemaSetDigest equals the digest Core computes for
// contracts/adapter/knowledge.v2/registration.json (same algorithm as
// capability_contract.rs registration(): schema documents keyed by their
// canonical sha256, then the canonical digest of [{digest,schema}...]).
// A differing DRAFT is never approved here; the run stops so the operator can
// retire it through its governed canDeprecate path first.
//
// Usage: node capability-contract-knowledge-v2.mjs
//          [--registration <apps>/contracts/adapter/knowledge.v2/registration.json]
//          [--approver kailo-platform-approver] [--attempt N]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { api, approve, attempt, digest, FlowError, key, log, login, main, parseArgs, readAll, requireSession, sleep, submit } from './lib.mjs';

const DEFAULT_REGISTRATION = fileURLToPath(new URL('../../../contracts/adapter/knowledge.v2/registration.json', import.meta.url));

function expectedSchemaSetDigest(registration) {
  const documents = new Map();
  for (const text of registration.schemaDocuments) {
    const parsed = JSON.parse(text);
    documents.set(digest(parsed), parsed);
  }
  // Rust BTreeMap<String,_> iterates in byte order of the hex keys.
  const ordered = [...documents.keys()].sort().map((d) => ({ digest: d, schema: documents.get(d) }));
  return digest(ordered);
}

async function contract(session, category, version) {
  const { rows } = await readAll(session, '/api/v1/platform/capability-contracts', 'contracts');
  return rows.find((row) => row.categoryKey === category && row.contractVersion === version);
}

await main(async () => {
  const args = parseArgs(process.argv.slice(2), ['registration', 'approver', 'attempt']);
  const run = attempt(args);
  const registration = JSON.parse(readFileSync(args.registration ?? DEFAULT_REGISTRATION, 'utf8'));
  const { categoryKey, contractVersion } = registration;
  if (categoryKey !== 'knowledge' || contractVersion !== 2) throw new FlowError('registration is not knowledge@2', 2);
  const expected = expectedSchemaSetDigest(registration);
  const admin = await login('platform-admin', 'contract-knowledge-v2-admin');
  const catalog = await requireSession(admin);

  let row = await contract(admin, categoryKey, contractVersion);
  log({ step: 'read', status: row?.status ?? 'ABSENT', schemaSetDigest: row?.schemaSetDigest, expectedSchemaSetDigest: expected,
    conformanceSuiteDigest: row?.conformanceSuiteDigest, registeredByActionExecutionId: row?.registeredByActionExecutionId });
  if (row && row.schemaSetDigest !== expected) {
    throw new FlowError(`knowledge@2 ${row.status} differs from the checked-in registration (schemaSetDigest); `
      + 'do not approve it — deprecate/retire it through the governed path, then re-run', 2);
  }
  if (row?.status === 'ACTIVE') { log({ step: 'done', status: 'ACTIVE' }); return; }
  if (row && row.status !== 'DRAFT') throw new FlowError(`knowledge@2 is ${row.status}; it cannot be approved`, 2);

  if (!row) {
    await submit(admin, { actionKey: 'capability_contract.register', idempotencyKey: key('capability_contract.register', catalog.tenantId, categoryKey, contractVersion, expected, run),
      explicitConfirmation: true, capabilityContractRegistration: registration }, 'register');
    for (let i = 0; i < 20 && !row; i++) { await sleep(2000); row = await contract(admin, categoryKey, contractVersion); }
    if (row?.status !== 'DRAFT' || row.schemaSetDigest !== expected) throw new FlowError('registered contract not readable as the expected DRAFT yet; re-run', 3);
  }

  const request = await submit(admin, { actionKey: 'capability_contract.approve',
    idempotencyKey: key('capability_contract.approve', catalog.tenantId, categoryKey, contractVersion, expected, run),
    capabilityContractRef: { categoryKey, contractVersion } }, 'approve-request');
  if (request.approvalWorkflowId) {
    const approver = await login(args.approver ?? 'kailo-platform-approver', 'contract-knowledge-v2-approver');
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
    throw new FlowError(`knowledge@2 still ${row?.status}; re-run the same command to keep waiting`, 3);
  }
  log({ step: 'done', status: 'ACTIVE', schemaSetDigest: row.schemaSetDigest });
});
