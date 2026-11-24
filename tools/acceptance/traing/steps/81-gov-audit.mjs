// Governance: the audit in its four scopes (design 04 §4.4) — mine (我的操作记录), Workspace (团队→审计), platform
// (管理→审计日志), entity (活动与审计) — each in the UI and through the API with its access rule, and the export list.
import { audit, settings } from '../lib/ui.mjs';
import { DOC_TITLE } from './30-ring3-doc.mjs';

export default {
  id: '81-gov-audit',
  title: '治理：审计四个范围（本人/工作区/平台/实体）与导出列表',
  covers: ['D-05', 'feat/governance-ui', 'TE-13'],
  users: ['alice', 'bob', 'carol', 'dave'],
  after: ['02', '03', '20', '30', '80'],
  locks: { 'ws:alice': 's', 'ws:bob': 's', 'ws:carol': 's', 'ws:dave': 's', 'platform-roles': 's' },
  est: 120,
  async run(h) {
    h.need('W');
    const a = h.u('alice').page; const b = h.u('bob').page;
    const pages = [['bob', 'my-activity', /我的操作记录/], ['alice', 'team-audit', /审计/], ['alice', 'audit-log', /审计日志/]];
    for (const [n, slug, re] of pages) {
      const p = h.u(n).page;
      await settings(h, p, slug, 6000);
      await h.shot(p, `${n}-${slug}`, { fullPage: true });
      const t = await h.text(p);
      h.check(`${slug} 页面加载（${n}）`, re.test(t) && !/无法加载审计记录/.test(t), t.slice(0, 200));
    }
    const mine = await audit(h, 'bob', { mine: true, limit: 50 });
    h.check('本人范围 API（bob mine）200 且有事件', mine.status === 200 && mine.events.length > 0, mine.status);
    const team = await audit(h, 'alice', { teamId: h.S.W, limit: 200 });
    h.check('工作区范围 API（alice teamId=W）200 且有事件', team.status === 200 && team.events.length > 0, team.status);
    const jobs = team.events.filter((e) => /\/internal\/jobs/.test(`${e.actionKey}`));
    h.check('审计无 /internal/jobs 刷屏（TE-13）', jobs.length === 0, jobs.length);
    h.check('非成员 dave 读 W 审计 403', (await audit(h, 'dave', { teamId: h.S.W, limit: 5 })).status === 403);
    const plat = await audit(h, 'alice', { limit: 50 });
    h.check('平台范围 API（alice 管理员）200', plat.status === 200, plat.status);
    h.check('无角色的 carol 读平台审计 403', (await audit(h, 'carol', { limit: 5 })).status === 403);
    if (h.S.docId) {
      const ent = await audit(h, 'alice', { targetType: 'document', targetId: h.S.docId, limit: 100 });
      h.check('实体范围 API（文档）200 且有事件', ent.status === 200 && ent.events.length > 0, `${ent.status} ${ent.events.length}`);
      h.log('doc audit', ent.events.slice(0, 10).map((e) => [e.eventType, e.actionKey, e.decision, e.actorId]));
      let opened = false;
      for (const list of ['/app/home', '/app/drive']) {
        if (opened) break;
        await a.goto(`${h.BASE}${list}`, { waitUntil: 'load' }); await a.waitForTimeout(6000);
        const row = a.getByText(h.S.docTitle ?? DOC_TITLE, { exact: true }).first();
        if (!(await row.count())) continue;
        await row.click({ button: 'right' }); await a.waitForTimeout(1500);
        const it = a.getByRole('menuitem', { name: /^活动与审计$/ }).or(a.getByText(/^活动与审计$/)).first();
        if (await it.count()) { await it.click(); await a.waitForTimeout(4000); opened = true; } else await a.keyboard.press('Escape');
      }
      await h.shot(a, 'entity-audit');
      h.check('文档行的右键菜单打开“活动与审计”', opened);
      if (!opened) { await h.jsonShot('alice', `/dss/audit/events?targetType=document&targetId=${h.S.docId}&limit=50`, 'entity-audit-api'); }
      else h.check('实体“活动与审计”对话框有内容', /活动与审计/.test(await h.text(a)));
    }
    await settings(h, b, 'my-activity', 6000);
    await h.shot(b, 'bob-exports', { fullPage: true });
    if (h.S.export) h.check('导出列表显示已完成并可下载', /已完成/.test(await h.text(b)) && (await b.getByRole('button', { name: /^下载$/ }).count() + await b.getByRole('link', { name: /^下载$/ }).count()) > 0);
  },
};
