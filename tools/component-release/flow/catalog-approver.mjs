#!/usr/bin/env node
// Batch F15: make a second, distinct Catalog Tenant admin so that
// component_release.approve / capability_contract.approve can be decided by a
// principal that is neither the registrar nor the approve initiator
// (self_approval=DENY; component_release_approval.rs approver_separated).
// Only governed product paths are used:
//   platform admin  tenant.member.invite        (SYNC, one-time link)
//   approver        POST /api/v1/invitations/redeem (own gateway login)
//   platform admin  APPROVE the tenant.member.admit approval it initiated
//                   (policy TENANT_ADMIN x1, self_approval=ALLOW)
//   platform admin  tenant.admin.grant {principalId}
// The approver must never be a member of a business Tenant (one ACTIVE
// membership per human; Catalog admins must not belong to business Tenants).
//
// Precondition (CI node, once): create the IdP account and its owner-only file
//   set -a; . /volumes/kailo/apps/deploy/local/.env; set +a
//   python3 ~/kailo-acceptance/accounts.py kailo-platform-approver
//
// Usage: node catalog-approver.mjs [--approver kailo-platform-approver] [--attempt N]
// Idempotent: re-reads role members / the approver's session first; the
// invitation is only issued when the approver is not yet a member, and the
// one-time link stays in memory (if a run dies after issuing it, re-run with
// --attempt 2 to issue a fresh invitation; the stale one simply expires).
import { api, approve, attempt, close, FlowError, key, log, login, main, parseArgs, requireSession, sessionView, sleep, submit } from './lib.mjs';

async function members(session) {
  const out = [];
  let cursor;
  for (let i = 0; i < 50; i++) {
    const r = await api(session, 'GET', `/api/v1/role-members${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
    if (r.status !== 200 || !Array.isArray(r.body?.members)) throw new FlowError(`role-members: status ${r.status} ${r.body?.reason ?? ''}`);
    out.push(...r.body.members);
    if (!r.body.nextCursor) return out;
    cursor = r.body.nextCursor;
  }
  throw new FlowError('role-members: too many pages');
}

async function invitations(session) {
  const r = await api(session, 'GET', '/api/v1/invitations');
  if (r.status !== 200) throw new FlowError(`invitations: status ${r.status} ${r.body?.reason ?? ''}`);
  return Array.isArray(r.body) ? r.body : (r.body?.invitations ?? []);
}

await main(async () => {
  const args = parseArgs(process.argv.slice(2), ['approver', 'attempt']);
  const approverName = args.approver ?? 'kailo-platform-approver';
  const run = attempt(args);
  const admin = await login('platform-admin', 'catalog-approver-admin');
  const catalog = await requireSession(admin);
  log({ step: 'platform-admin-session', tenantId: catalog.tenantId, principalId: catalog.tenantPrincipalId });

  const approver = await login(approverName, 'catalog-approver-approver');
  let own = await sessionView(approver);
  if (own.status === 200 && own.body.tenantId !== catalog.tenantId) {
    throw new FlowError(`${approverName} already belongs to another Tenant ${own.body.tenantId}; it cannot become a Catalog admin`, 2);
  }

  if (own.status !== 200) {
    // Not an ACTIVE member yet: either never invited, or redeemed and waiting.
    const label = `${approverName}#${run}`;
    const existing = (await invitations(admin)).filter((row) => row.inviteeLabel === label);
    let pending = existing.find((row) => row.approvalWorkflowId && !['APPROVED', 'CONSUMED', 'DENIED', 'EXPIRED', 'INVALIDATED'].includes(row.approvalStatus));
    if (!pending && !existing.some((row) => row.redeemedAt)) {
      const issued = await submit(admin, { actionKey: 'tenant.member.invite', idempotencyKey: key('tenant.member.invite', catalog.tenantId, label, run), name: label }, 'invite');
      const link = issued.invitation?.link;
      if (!link || !link.includes('#')) {
        throw new FlowError('the one-time invitation link was not returned (already issued by an earlier run); re-run with --attempt ' + (run + 1), 3);
      }
      const credential = link.slice(link.indexOf('#') + 1);
      const redeemed = await api(approver, 'POST', '/api/v1/invitations/redeem', { credential, displayName: approverName });
      log({ step: 'redeem', status: redeemed.status, invitationId: redeemed.body?.invitationId, tenantId: redeemed.body?.tenantId,
        membershipState: redeemed.body?.membershipState, admissionGateState: redeemed.body?.admissionGateState, reason: redeemed.body?.reason });
      if (![200, 202].includes(redeemed.status) || redeemed.body?.tenantId !== catalog.tenantId) {
        throw new FlowError(`redeem refused: ${redeemed.status} ${redeemed.body?.reason ?? ''}`);
      }
    }
    // The inviter (platform admin) decides its own tenant.member.admit (ALLOW).
    for (let i = 0; i < 40 && !pending; i++) {
      pending = (await invitations(admin)).find((row) => row.inviteeLabel === label && row.approvalWorkflowId);
      if (!pending) await sleep(3000);
    }
    if (!pending) throw new FlowError('tenant.member.admit approval did not appear; re-run to continue', 3);
    await approve(admin, pending.approvalWorkflowId, { expectActionKey: 'tenant.member.admit' });
    for (let i = 0; i < 60; i++) {
      own = await sessionView(approver);
      if (own.status === 200) break;
      await sleep(5000);
    }
    if (own.status !== 200 || own.body.tenantId !== catalog.tenantId) {
      throw new FlowError(`${approverName} membership is not ACTIVE yet (status ${own.status} ${own.body?.reason ?? ''}); re-run`, 3);
    }
  }
  const principalId = own.body.tenantPrincipalId;
  log({ step: 'approver-member', principalId, tenantId: own.body.tenantId });

  let row = (await members(admin)).find((m) => m.principalId === principalId);
  if (!row?.tenantAdmin) {
    await submit(admin, { actionKey: 'tenant.admin.grant', idempotencyKey: key('tenant.admin.grant', catalog.tenantId, principalId, run), principalId }, 'grant-admin');
    for (let i = 0; i < 40 && !row?.tenantAdmin; i++) {
      await sleep(3000);
      row = (await members(admin)).find((m) => m.principalId === principalId);
    }
  }
  if (!row?.tenantAdmin) throw new FlowError('tenant.admin.grant not yet visible in role members; re-run', 3);
  const admins = (await members(admin)).filter((m) => m.tenantAdmin).map((m) => ({ principalId: m.principalId, displayName: m.displayName }));
  log({ step: 'done', catalogTenantId: catalog.tenantId, approverPrincipalId: principalId, catalogAdmins: admins });
  await close();
});
