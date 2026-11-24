// Governance: 管理→额度 — the platform administrator picks a shared Workspace with the Workspace picker, sees its
// usage and sets its monthly quota in the UI (then restores it); a member sees 团队→用量与额度 read-only and cannot set it.
import { L, setCurrent, settings } from '../lib/ui.mjs';
import { TEAM } from './03-workspaces.mjs';

export default {
  id: '82-gov-quota',
  title: '治理：额度页（平台工作区选择器、设额度）与成员只读用量页',
  covers: ['D-02', 'D-08', 'feat/governance-ui'],
  users: ['alice', 'bob'],
  after: ['02', '03', '20'],
  locks: { 'ws:alice': 's', 'ws:bob': 's', 'quota:W': 'x', 'platform-roles': 's' },
  est: 120,
  release: { 'quota:W': 60 },
  async run(h) {
    h.need('W');
    const pw = await h.api('alice', 'GET', `/dss/platform/workspaces?search=${encodeURIComponent('TG 安林')}`);
    h.check('平台工作区搜索 API 返回 W', pw.status === 200 && JSON.stringify(pw.body).includes(h.S.W), pw.status);
    h.check('成员不能列平台工作区', [401, 403].includes((await h.api('bob', 'GET', '/dss/platform/workspaces')).status));
    const before = (await h.api('alice', 'GET', `/dss/quota/teams/${h.S.W}`)).body;
    h.log('quota before', before);
    const a = h.u('alice').page;
    await settings(h, a, 'quotas', 6000);
    await h.shot(a, 'quotas-page');
    await a.getByRole('button', { name: L.pickWorkspace }).first().click().catch(() => a.getByText(L.pickWorkspace).first().click());
    await a.waitForTimeout(1500);
    const search = a.getByPlaceholder(/^搜索工作区$/).first();
    if (await search.count()) { await search.fill('TG 安林'); await a.waitForTimeout(2500); }
    await h.shot(a, 'workspace-picker');
    await a.getByText(TEAM.alice, { exact: true }).last().click(); await a.waitForTimeout(4000);
    await h.shot(a, 'workspace-quota');
    h.check('选中 W 后显示其用量与额度', /本月|用量与额度|token/.test(await h.text(a)));
    try {
      const inp = a.getByLabel(/每月 token 数/).first();
      await inp.fill('50000000'); await a.waitForTimeout(500);
      await a.getByRole('button', { name: L.save }).last().click(); await a.waitForTimeout(4000);
      await h.shot(a, 'workspace-quota-saved');
      const now = (await h.api('alice', 'GET', `/dss/quota/teams/${h.S.W}`)).body;
      h.check('界面设置 W 月度额度 50,000,000', Number(now?.monthlyTokens) === 50000000, now);
    } finally {
      const r = await h.api('alice', 'PUT', `/dss/quota/teams/${h.S.W}`, { monthlyTokens: before?.monthlyTokens ?? null });
      h.check('恢复 W 额度', r.status < 300, r.status);
      // W's quota is as found again: Agent steps (quota:W shared) may run from here on.
      h.unlock('quota:W');
    }
    // Design 04 §5.6: 用量与额度 is read-only for a Workspace's administrators and settable by platform administrators;
    // a plain member has no entry. bob is a member of W and the owner (administrator) of his own Workspace.
    const b = h.u('bob').page;
    await settings(h, b, 'team', 6000);
    await h.shot(b, 'bob-W-settings-member');
    h.check('W 的普通成员没有“用量与额度”入口', !/用量与额度/.test(await h.text(b)));
    const bobWs = h.S.ws?.[`bob:${TEAM.bob}`];
    if (bobWs) {
      // bob's current Workspace leaves W for this section only: no other step of bob's runs meanwhile.
      await h.exclusive('ws:bob', async () => {
        await setCurrent(h, 'bob', bobWs);
        try {
          await settings(h, b, 'team-usage', 6000);
          await h.shot(b, 'bob-own-ws-team-usage');
          h.check('工作区管理员（非平台管理员）看到只读额度（由平台管理员设置）', /额度由平台管理员设置/.test(await h.text(b)));
          h.check('工作区管理员改本工作区额度 403', (await h.api('bob', 'PUT', `/dss/quota/teams/${bobWs}`, { monthlyTokens: 1 })).status === 403);
        } finally { await setCurrent(h, 'bob', h.S.W); }
      });
    } else h.check('bob 自己的工作区已记录', false, Object.keys(h.S.ws || {}));
    h.check('成员改 W 额度 403', (await h.api('bob', 'PUT', `/dss/quota/teams/${h.S.W}`, { monthlyTokens: 1 })).status === 403);
  },
};
