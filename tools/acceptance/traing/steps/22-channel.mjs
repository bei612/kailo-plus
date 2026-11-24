// Ring ③ setup: a fresh W team channel for this round with the three people and four Agents (@kailo included), and a
// short discussion by all three people that the Agents work from.
//
// Each round makes its own channel, the way a team starts a channel for a piece of work (POST /channels with the
// Workspace, the call the New channel dialog makes), and 99 deletes it again. Until 2026-11-24 every round re-posted
// the discussion and all Agent replies into W's one team channel, so by b34 the workspace content search ③ runs was
// hundreds of stale channel messages, and the channel's recent messages the Agents are prompted with pointed at tasks
// earlier rounds had deleted (b34 r3 step 31: @资料员 chased one and never concluded).
import { AGENTS, inviteBots, say } from '../lib/ui.mjs';

export const DISCUSSION = [
  ['alice', '我们来定一下 12 月的客户回访计划：目标是回访 30 家重点客户，收集续约意向和产品反馈。'],
  ['bob', '我建议分两轮：第一轮 12 月 1-10 日电话回访，第二轮 12 月 15-20 日上门拜访前 10 家。'],
  ['carol', '反馈要统一记录在表格里，按“续约意向 / 主要问题 / 改进建议”三栏汇总，12 月 22 日前出总结。'],
  ['alice', '同意。负责人：电话回访周博，上门拜访林安，汇总陈可。'],
];

/** The round channels' names: this prefix and the run id. */
export const CHANNEL_PREFIX = 'TG 客户回访 ';

/** `user`'s channels (GET /comms/channels, every page). */
export async function channels(h, user) {
  const out = [];
  let cursor = '';
  for (let i = 0; i < 20; i++) {
    const r = await h.api(user, 'GET', `/dss/comms/channels?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    if (r.status !== 200) break;
    out.push(...(r.body?.items || []));
    cursor = r.body?.next_cursor;
    if (!cursor) break;
  }
  return out;
}

/** The round channels of W that alice made and no run deleted (a round stopped before 99). */
export async function roundChannels(h) {
  return (await channels(h, 'alice')).filter((c) => c.team_id === h.S.W && (c.name || '').startsWith(CHANNEL_PREFIX));
}

export default {
  id: '22-channel',
  title: '本轮团队频道：在 W 新建，3 人 + 4 个 Agent，三人讨论',
  covers: ['环②：频道里 3 人 + 多个 Agent'],
  users: ['alice', 'bob', 'carol'],
  after: ['20', '21'],
  locks: { 'ws:alice': 's', 'ws:bob': 's', 'ws:carol': 's', chan: 'x' },
  est: 180,
  async run(h) {
    h.need('W');
    // A round that stopped before 99 left its channel: delete it first, so this round's search sees this round only.
    for (const c of await roundChannels(h)) h.log('stale round channel', c.id, c.name, (await h.api('alice', 'DELETE', `/dss/channels/${c.id}`)).status);
    // The three people of W are the channel's first members, as the dialog's invite page adds them.
    const team = await h.api('alice', 'GET', '/auth/team');
    h.check('alice 当前工作区是 W', team.body?.team?.id === h.S.W, team.body?.team?.id);
    const people = (team.body?.members || []).map((m) => m.user_id).filter((id) => String(id).startsWith('macro|'));
    h.check('W 有三位成员', people.length === 3, people.length);
    const name = `${CHANNEL_PREFIX}${h.cfg.runId}`;
    const made = await h.api('alice', 'POST', '/dss/channels', { channel_type: 'team', name, team_id: h.S.W, auto_join_team: false, participants: people });
    const id = made.body?.id;
    h.check(`在 W 新建本轮团队频道「${name}」`, made.status < 300 && /^[0-9a-f-]{36}$/.test(id || ''), made.status);
    if (!id) return;
    // Channel ownership (TG-23, E-03): the channel is W's, so W's Agents may be added and triggered in it.
    const listed = (await channels(h, 'alice')).find((c) => c.id === id);
    h.check('频道属于 W', listed?.team_id === h.S.W, listed && { team_id: listed.team_id, channel_type: listed.channel_type });
    const a = h.u('alice').page;
    await a.goto(`${h.BASE}/app/channels/${id}`, { waitUntil: 'load' }); await a.waitForTimeout(5000);
    const m = a.url().match(/\/app\/(?:channels|channel)\/([0-9a-f-]{36})/);
    h.check('打开本轮频道', m?.[1] === id, a.url());
    if (m?.[1] !== id) return;
    h.S.chan = a.url().split('?')[0]; h.S.chanId = id;
    await h.shot(a, 'team-channel');
    const t = await inviteBots(h, 'alice', h.S.chan, Object.values(AGENTS).map((x) => x.handle), 'participants');
    const cb = await h.api('alice', 'GET', `/dss/channels/${h.S.chanId}/bots`);
    const handles = JSON.stringify(cb.body);
    for (const ag of Object.values(AGENTS)) h.check(`频道内有 @${ag.handle}`, handles.includes(ag.handle) || t.includes(ag.name), cb.status);
    const detail = await h.api('alice', 'GET', `/dss/channels/${h.S.chanId}`);
    const members = JSON.stringify(detail.body?.participants || []);
    h.check('频道内有三位成员', people.every((p) => members.includes(p)), detail.status);
    for (const [n, msg] of DISCUSSION) await say(h, n, h.S.chan, msg);
    const c = h.u('carol').page;
    await c.goto(h.S.chan, { waitUntil: 'load' }); await c.waitForTimeout(6000);
    await h.shot(c, 'discussion-carol-view');
    await h.shot(a, 'discussion-alice-view');
    const ct = await h.text(c);
    h.check('carol 看到三人的讨论', DISCUSSION.every(([, msg]) => ct.includes(msg.slice(0, 12))));
  },
};
