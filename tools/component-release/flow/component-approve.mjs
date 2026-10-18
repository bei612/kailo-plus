#!/usr/bin/env node
// Batch F17: governed component_release.approve. The platform admin (also the
// registrar) requests approval; the distinct Catalog admin
// kailo-platform-approver decides APPROVE (TENANT_ADMIN x1, self_approval=DENY,
// approver must differ from initiator and registrar). Core also checks the
// three build-info endpoints (platform_build_info.rs) before APPROVED.
//
// Usage: node component-approve.mjs (--release-dir <rendered dir> | --release-id <uuid>)
//          [--approver kailo-platform-approver] [--attempt N]
// Idempotent: an APPROVED release is only reported; the request key is fixed
// per release/attempt, and the approver re-reads the approval before deciding.
import { approve, attempt, FlowError, key, log, login, main, parseArgs, readAll, renderedRelease, requireSession, sleep, submit, UUID, api } from './lib.mjs';

await main(async () => {
  const args = parseArgs(process.argv.slice(2), ['release-dir', 'release-id', 'approver', 'attempt']);
  const run = attempt(args);
  const releaseId = args['release-id'] ?? (args['release-dir'] ? renderedRelease(args['release-dir']).manifest.id : undefined);
  if (!UUID.test(releaseId ?? '')) throw new FlowError('--release-dir or --release-id is required', 2);
  const admin = await login('platform-admin', 'approve-admin');
  const catalog = await requireSession(admin);
  const find = async () => (await readAll(admin, '/api/v1/platform/component-releases', 'releases')).rows
    .find((row) => row.componentReleaseId === releaseId);
  let release = await find();
  log({ step: 'read', componentReleaseId: releaseId, status: release?.status ?? 'ABSENT' });
  if (release?.status === 'APPROVED') return;
  if (release?.status !== 'REGISTERED') throw new FlowError(`release must be REGISTERED (is ${release?.status ?? 'ABSENT'})`, 2);

  const request = await submit(admin, { actionKey: 'component_release.approve',
    idempotencyKey: key('component_release.approve', catalog.tenantId, releaseId, run), componentReleaseId: releaseId }, 'approve-request');
  if (request.approvalWorkflowId) {
    const approver = await login(args.approver ?? 'kailo-platform-approver', 'approve-approver');
    const member = await requireSession(approver);
    if (member.tenantId !== catalog.tenantId || member.tenantPrincipalId === catalog.tenantPrincipalId) {
      throw new FlowError('approver must be a different principal of the Catalog Tenant', 2);
    }
    await approve(approver, request.approvalWorkflowId, { expectActionKey: 'component_release.approve' });
  }
  for (let i = 0; i < 200; i++) {
    release = await find();
    if (release?.status === 'APPROVED' || release?.status === 'REJECTED') break;
    await sleep(3000);
  }
  if (release?.status !== 'APPROVED') {
    const task = await api(admin, 'GET', `/api/v1/tasks/${request.actionExecutionId}`);
    log({ step: 'approve-task', gateState: task.body?.gateState, approvalStatus: task.body?.approvalStatus, taskStatus: task.body?.taskStatus, reason: task.body?.reason });
    throw new FlowError(`release is ${release?.status}; re-run the same command to keep waiting`, release?.status === 'REJECTED' ? 1 : 3);
  }
  log({ step: 'done', componentReleaseId: releaseId, status: 'APPROVED', approvedByActionExecutionId: release.approvedByActionExecutionId });
});
