// Ring ③ setup: the W team channel with the three people and four Agents (@kailo included), and a short discussion
// by all three people that the Agents work from.
import { AGENTS, inviteBots, say } from '../lib/ui.mjs';
import { TEAM } from './03-workspaces.mjs';

export const DISCUSSION = [
  ['alice', '我们来定一下 12 月的客户回访计划：目标是回访 30 家重点客户，收集续约意向和产品反馈。'],
  ['bob', '我建议分两轮：第一轮 12 月 1-10 日电话回访，第二轮 12 月 15-20 日上门拜访前 10 家。'],
  ['carol', '反馈要统一记录在表格里，按“续约意向 / 主要问题 / 改进建议”三栏汇总，12 月 22 日前出总结。'],
  ['alice', '同意。负责人：电话回访周博，上门拜访林安，汇总陈可。'],
];

export default {
  id: '22-channel',
  title: '团队频道：3 人 + 4 个 Agent，三人讨论',
  covers: ['环②：频道里 3 人 + 多个 Agent'],
  users: ['alice', 'bob', 'carol'],
  async run(h) {
    h.need('W');
    const a = h.u('alice').page;
    await a.goto(`${h.BASE}/app/channels`, { waitUntil: 'load' }); await a.waitForTimeout(5000);
    await a.keyboard.press('Escape');
    // The team channel keeps the name the Workspace had when it was created ("Tg-<yyyymmddhhmm>", from the account
    // domain), not the later rename; both are accepted.
    const label = (h.S.domain || '').split('.')[0];
    const orig = label ? label[0].toUpperCase() + label.slice(1) : '';
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const link = a.getByText(new RegExp(`^(${esc(TEAM.alice)}${orig ? '|' + esc(orig) : ''})$`)).last();
    if (await link.count()) { await link.click(); await a.waitForTimeout(5000); }
    const m = a.url().match(/\/app\/(?:channels|channel)\/([0-9a-f-]{36})/);
    h.check('找到 W 团队频道', !!m, a.url());
    if (!m) return;
    h.S.chan = a.url().split('?')[0]; h.S.chanId = m[1];
    await h.shot(a, 'team-channel');
    const t = await inviteBots(h, 'alice', h.S.chan, Object.values(AGENTS).map((x) => x.handle), 'participants');
    const cb = await h.api('alice', 'GET', `/dss/channels/${h.S.chanId}/bots`);
    const handles = JSON.stringify(cb.body);
    for (const ag of Object.values(AGENTS)) h.check(`频道内有 @${ag.handle}`, handles.includes(ag.handle) || t.includes(ag.name), cb.status);
    for (const [n, msg] of DISCUSSION) await say(h, n, h.S.chan, msg);
    const c = h.u('carol').page;
    await c.goto(h.S.chan, { waitUntil: 'load' }); await c.waitForTimeout(6000);
    await h.shot(c, 'discussion-carol-view');
    await h.shot(a, 'discussion-alice-view');
    const ct = await h.text(c);
    h.check('carol 看到三人的讨论', DISCUSSION.every(([, msg]) => ct.includes(msg.slice(0, 12))));
  },
};
