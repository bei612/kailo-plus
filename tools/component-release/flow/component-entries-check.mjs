#!/usr/bin/env node
// Batch F/G acceptance probe for 07 §4.6 / V-SCN-49 / V-SCN-33: each member
// account logs in normally, the left sidebar group
// [data-testid=native-application-entries] shows the expected entries
// (云盘 / 知识库 / 问数 by capability category), clicking one shows
// section[data-testid=native-application-page] with the cross-origin iframe
// whose src is exactly the BFF native-page descriptor URL, and the iframe
// document loads. Screenshots go to $KAILO_FLOW_OUT for visual review (an
// iframe element is not business acceptance; open the images).
//
// Optional revocation check (MUTATING, governed): --revoke-binding <id> lets
// --revoke-account (default admin) submit application_binding.disable for the
// current version, then verifies the entry disappears for the first account
// and the descriptor is refused. Re-enabling needs a NEW binding
// (component-bind.mjs --attempt N+1); there is no undo.
//
// DD-127 native page entries enable no category; the sidebar labels them by
// componentTypeKey, so expect them as type:<componentTypeKey> (e.g. type:cells).
//
// Usage: node component-entries-check.mjs --expect file_storage,knowledge[,data_query][,type:<componentTypeKey>]
//          [--accounts kailo-qa-1,kailo-qa-2,kailo-qa-3] [--workspace-id <uuid>]
//          [--revoke-binding <uuid> [--revoke-account admin] [--attempt N]]
import { api, attempt, FlowError, key, log, login, main, parseArgs, readAll, requireSession, sleep, submit, UUID, waitTask } from './lib.mjs';

const LABELS = { file_storage: '云盘', knowledge: '知识库', data_query: '问数' };
const IFRAME = 'section[data-testid="native-application-page"] iframe[title="服务工作区"]';
const labelOf = (key) => LABELS[key] ?? (key.startsWith('type:') && key.length > 5 ? key.slice(5) : undefined);

async function entries(session, expected, workspaceId) {
  const scope = workspaceId ? `?workspaceId=${workspaceId}` : '';
  const { rows } = await readAll(session, `/api/v1/application-bindings${scope}`, 'bindings');
  const visible = rows.filter((b) => b.state === 'ACTIVE' && b.hasNativePage === true);
  const byCategory = {};
  for (const binding of visible) {
    byCategory[`type:${binding.componentTypeKey}`] = binding;
    for (const c of binding.capabilityCategories) byCategory[c.category] = binding;
  }
  return { visible, byCategory, missing: expected.filter((c) => !byCategory[c]) };
}

async function checkAccount(name, expected, workspaceId) {
  const session = await login(name, `entries-${name}`);
  await requireSession(session);
  const result = { account: name, entries: [] };
  const { byCategory, missing, visible } = await entries(session, expected, workspaceId);
  result.apiVisible = visible.map((b) => ({ bindingId: b.bindingId, componentTypeKey: b.componentTypeKey, categories: b.capabilityCategories.map((c) => c.category) }));
  if (missing.length) result.apiMissing = missing;
  const page = session.page;
  await page.goto(`${process.env.KAILO_WEB ?? 'http://192.168.0.193:58090'}/app/`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  const group = page.locator('[data-testid="native-application-entries"]').first();
  await group.waitFor({ timeout: 30000 }).catch(() => {});
  await session.shot('sidebar');
  for (const category of expected) {
    const entry = { category, label: labelOf(category) };
    const binding = byCategory[category];
    const button = group.getByRole('button', { name: entry.label, exact: true });
    entry.sidebarVisible = await button.count() > 0;
    if (binding && entry.sidebarVisible) {
      const descriptor = await api(session, 'GET', `/api/v1/application-bindings/${binding.bindingId}/native-page`);
      entry.descriptorStatus = descriptor.status;
      entry.descriptorOrigin = descriptor.body?.origin;
      await button.first().click();
      const frame = page.locator(IFRAME).first();
      await frame.waitFor({ timeout: 30000 }).catch(() => {});
      entry.route = new URL(page.url()).pathname;
      entry.iframeSrc = await frame.getAttribute('src').catch(() => null);
      entry.srcMatchesDescriptor = Boolean(descriptor.body?.url) && entry.iframeSrc === descriptor.body.url;
      const handle = await frame.elementHandle().catch(() => null);
      const content = await handle?.contentFrame().catch(() => null);
      if (content) {
        entry.iframeLoaded = await content.waitForLoadState('load', { timeout: 30000 }).then(() => true).catch(() => false);
        entry.iframeUrlOrigin = (() => { try { return new URL(content.url()).origin; } catch { return null; } })();
      }
      await sleep(2500);
      entry.screenshot = await session.shot(`page-${category}`);
    }
    result.entries.push(entry);
  }
  result.ok = result.entries.every((e) => e.sidebarVisible && e.descriptorStatus === 200 && e.srcMatchesDescriptor && e.iframeLoaded);
  await session.ctx.close();
  return result;
}

await main(async () => {
  const args = parseArgs(process.argv.slice(2), ['expect', 'accounts', 'workspace-id', 'revoke-binding', 'revoke-account', 'attempt']);
  const expected = (args.expect ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!expected.length || expected.some((c) => !labelOf(c))) throw new FlowError('--expect takes file_storage,knowledge,data_query or type:<componentTypeKey>', 2);
  const accounts = (args.accounts ?? 'kailo-qa-1,kailo-qa-2,kailo-qa-3').split(',').map((s) => s.trim()).filter(Boolean);
  const results = [];
  for (const name of accounts) {
    const result = await checkAccount(name, expected, args['workspace-id']);
    log({ step: 'account', ...result });
    results.push(result);
  }
  if (args['revoke-binding']) {
    if (!UUID.test(args['revoke-binding'])) throw new FlowError('--revoke-binding must be a UUID', 2);
    const admin = await login(args['revoke-account'] ?? 'admin', 'entries-revoke');
    await requireSession(admin);
    const scope = args['workspace-id'] ? `?workspaceId=${args['workspace-id']}` : '';
    const binding = (await readAll(admin, `/api/v1/application-bindings${scope}`, 'bindings')).rows.find((b) => b.bindingId === args['revoke-binding']);
    if (!binding) throw new FlowError('binding not found in this scope', 2);
    if (binding.state === 'ACTIVE') {
      const submitted = await submit(admin, { actionKey: 'application_binding.disable',
        idempotencyKey: key('application_binding.disable', binding.bindingId, binding.version, attempt(args)),
        explicitConfirmation: true, applicationBindingId: binding.bindingId, applicationBindingVersion: binding.version,
        ...(args['workspace-id'] ? { workspaceId: args['workspace-id'] } : {}) }, 'disable');
      await waitTask(admin, submitted.actionExecutionId, { seconds: 900, label: 'disable-task' }).catch((e) => { if (e.exitCode !== 3) throw e; });
    }
    const category = binding.capabilityCategories.map((c) => c.category).find((c) => LABELS[c]) ?? `type:${binding.componentTypeKey}`;
    const probe = await login(accounts[0], `entries-after-revoke-${accounts[0]}`);
    await requireSession(probe);
    let gone = false;
    let descriptor;
    for (let i = 0; i < 40 && !gone; i++) {
      descriptor = await api(probe, 'GET', `/api/v1/application-bindings/${binding.bindingId}/native-page`);
      await probe.page.goto(`${process.env.KAILO_WEB ?? 'http://192.168.0.193:58090'}/app/`, { waitUntil: 'domcontentloaded' });
      await probe.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
      const remaining = await probe.page.locator('[data-testid="native-application-entries"]').getByRole('button', { name: labelOf(category), exact: true }).count();
      gone = descriptor.status !== 200 && remaining === 0;
      if (!gone) await sleep(5000);
    }
    const shot = await probe.shot('after-revoke');
    log({ step: 'revocation', bindingId: binding.bindingId, entryRemoved: gone, descriptorStatus: descriptor?.status, descriptorReason: descriptor?.body?.reason, screenshot: shot });
    if (!gone) throw new FlowError('entry still visible or descriptor still served after disable', 1);
  }
  if (!results.every((r) => r.ok)) throw new FlowError('one or more accounts did not see a loading entry; see the per-account log and screenshots', 1);
});
