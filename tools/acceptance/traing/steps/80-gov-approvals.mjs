// Governance: the approval center (D-04, design 04 §3.2). bob asks for an export of his own activity from
// 我的操作记录; it waits for a platform administrator; alice gets an approval_requested inbox item whose deep link
// opens the request in 设置→审批; she approves with a comment; the export runs and bob downloads it. alice cannot
// approve her own request (self-approval refused) and withdraws it.
import { L, settings } from '../lib/ui.mjs';

export default {
  id: '80-gov-approvals',
  title: '治理：审批中心、审批人收件箱条目与深链、批准后导出完成',
  covers: ['D-04', 'D-05', 'feat/governance-ui'],
  users: ['alice', 'bob'],
  async run(h) {
    const b = h.u('bob').page;
    await settings(h, b, 'my-activity');
    await h.shot(b, 'bob-my-activity');
    let exp = null;
    const respP = b.waitForResponse((r) => /\/audit\/exports$/.test(r.url().split('?')[0]) && r.request().method() === 'POST', { timeout: 30000 }).catch(() => null);
    const btn = b.getByRole('button', { name: L.exportEvents }).first();
    if (await btn.count()) {
      await btn.click(); await b.waitForTimeout(2000);
      await h.shot(b, 'bob-export-dialog');
      const reason = b.getByLabel(/^理由/).first();
      if (await reason.count()) await reason.fill('TG 验收：导出本人操作记录用于季度自查'); else await b.locator('[role=dialog] textarea').first().fill('TG 验收：导出本人操作记录用于季度自查');
      await b.getByRole('button', { name: L.exportSubmit }).click();
      const resp = await respP;
      if (resp) exp = await resp.json().catch(() => null);
      await b.waitForTimeout(3000);
      await h.shot(b, 'bob-export-requested');
    }
    h.check('界面申请导出（我的操作记录→导出事件）', !!exp, exp);
    if (!exp) {
      const r = await h.api('bob', 'POST', '/dss/audit/exports', { format: 'jsonl', reason: 'TG 验收：导出本人操作记录用于季度自查', mine: true });
      exp = r.body; h.log('api fallback export', r.status, exp);
    }
    h.check('导出等待审批（WAITING_APPROVAL，有 approvalId）', exp?.status === 'WAITING_APPROVAL' && !!exp?.approvalId, exp);
    if (!exp?.approvalId) return;
    h.S.export = { id: exp.id, approvalId: exp.approvalId };
    // alice's inbox: the approval_requested notification
    let item = null;
    for (let i = 0; i < 10 && !item; i++) {
      const n = await h.api('alice', 'GET', '/notification/v1/user_notifications?limit=50');
      if (JSON.stringify(n.body).includes(exp.approvalId)) item = n.body;
      else await h.sleep(5000);
    }
    h.check('审批人 alice 收件箱有该审批条目（approval_requested）', !!item);
    const a = h.u('alice').page;
    await a.goto(`${h.BASE}/app/notifications`, { waitUntil: 'load' }); await a.waitForTimeout(6000);
    await h.shot(a, 'alice-inbox');
    const entry = a.getByText(/请你审批/).first();
    let viaInbox = false;
    if (await entry.count()) {
      await entry.click(); await a.waitForTimeout(6000);
      viaInbox = a.url().includes(`approval=${exp.approvalId}`) || (/导出审计事件/.test(await h.text(a)) && (await a.getByRole('button', { name: L.approve }).count()) > 0);
      await h.shot(a, 'alice-inbox-item-opened');
    }
    h.check('收件箱条目打开审批详情（深链）', viaInbox, a.url());
    await a.goto(`${h.BASE}/app/settings/approvals?approval=${encodeURIComponent(exp.approvalId)}`, { waitUntil: 'load' }); await a.waitForTimeout(6000);
    await h.shot(a, 'approval-deep-link');
    const detail = await h.text(a);
    h.check('深链 /app/settings/approvals?approval=<id> 显示请求', /导出审计事件/.test(detail) && /季度自查/.test(detail), detail.slice(0, 300));
    const pre = await h.api('alice', 'GET', `/dss/approvals/${exp.approvalId}`);
    h.check('alice 是该请求的审批人（canDecide）', pre.body?.canDecide === true, pre.status);
    const comment = a.getByLabel(/^意见/).first();
    if (await comment.count()) await comment.fill('TG 验收：同意导出');
    await a.getByRole('button', { name: L.approve }).last().click(); await a.waitForTimeout(5000);
    await h.shot(a, 'approval-approved');
    const ap = await h.api('alice', 'GET', `/dss/approvals/${exp.approvalId}`);
    h.log('approval', JSON.stringify(ap.body).slice(0, 600));
    h.check('审批已批准', /ALLOWED|APPROVED/i.test(JSON.stringify(ap.body?.request?.gateState ?? ap.body?.gateState ?? ap.body)), ap.status);
    let done = null;
    for (let i = 0; i < 18 && !done; i++) {
      const e = await h.api('bob', 'GET', `/dss/audit/exports/${exp.id}`);
      if (e.body?.status === 'DONE') done = e.body; else if (['FAILED', 'REJECTED'].includes(e.body?.status)) { done = e.body; break; } else await h.sleep(10000);
    }
    h.check('批准后导出完成（DONE）', done?.status === 'DONE', done);
    if (done?.downloadUrl) {
      const dl = await h.u('bob').ctx.request.get(done.downloadUrl, { failOnStatusCode: false }).catch((e) => ({ status: () => 0, body: async () => Buffer.from(String(e)) }));
      const bytes = (await dl.body()).length;
      h.check('bob 能下载导出文件', dl.status() === 200 && bytes > 0, `${dl.status()} ${bytes} bytes`);
    } else h.check('导出有下载链接', false, done);
    await settings(h, b, 'approvals');
    const mineTab = b.getByText(/^我发起的$/).first();
    if (await mineTab.count()) { await mineTab.click(); await b.waitForTimeout(3000); }
    await h.shot(b, 'bob-approvals-mine');
    h.check('bob 在“我发起的”看到已批准', /已批准/.test(await h.text(b)));
    // Self-approval is refused.
    const own = await h.api('alice', 'POST', '/dss/audit/exports', { format: 'csv', reason: 'TG 验收：自审校验', teamId: h.S.W });
    if (own.body?.approvalId) {
      await a.goto(`${h.BASE}/app/settings/approvals?approval=${encodeURIComponent(own.body.approvalId)}`, { waitUntil: 'load' }); await a.waitForTimeout(6000);
      await h.shot(a, 'self-approval-refused');
      h.check('不能审批自己的请求', /你不能审批自己发起/.test(await h.text(a)));
      h.check('自己的请求 canDecide=false', (await h.api('alice', 'GET', `/dss/approvals/${own.body.approvalId}`)).body?.canDecide === false);
      const d = await h.api('alice', 'POST', `/dss/approvals/${own.body.approvalId}/decision`, { decision: 'APPROVE', comment: 'x' });
      // The governance service answers a refused decision with 200 {admitted:false, reason} (services/kailo_governance
      // approvals.rs); the request must stay undecided.
      const after = await h.api('alice', 'GET', `/dss/approvals/${own.body.approvalId}`);
      h.check('自审经 API 也被拒', (d.status >= 400 || (d.body?.admitted === false && /SELF_APPROVAL/.test(String(d.body?.reason))))
        && after.body?.canDecide === false && !/ALLOWED|APPROVED/i.test(JSON.stringify(after.body?.request?.gateState ?? after.body?.gateState ?? '')),
        { status: d.status, admitted: d.body?.admitted, reason: d.body?.reason, after: after.body?.request?.gateState ?? after.body?.gateState });
      h.log('withdraw own', (await h.api('alice', 'POST', `/dss/approvals/${own.body.approvalId}/withdraw`)).status);
    } else h.warn('alice export did not wait for approval', own.body);
  },
};
