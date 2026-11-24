// Ring ③ setup: a fresh W team channel for this round with the three people and four Agents (@kailo included), and a
// short discussion by all three people that the Agents work from.
//
// Each round makes its own channel, the way a team starts a channel for a piece of work (the calls the New channel
// dialog makes: POST /channels with the Workspace and the creator, then the people and the Agents are added), and 99
// deletes it again, by the id this round recorded (h.S.roundChannel) and only when it still looks like a round channel. Until 2026-11-24 every round re-posted
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

/** The name of run `runId`'s round channel. */
export const roundChannelName = (runId) => `${CHANNEL_PREFIX}${runId}`;

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

/**
 * Whether channel `c` (a GET /comms/channels item) is a round channel this suite made in Workspace `W` and may delete:
 * a team channel of W that `ownerId` (alice) owns, named the prefix and one run id, that team members do not join on
 * their own and that is not named after the Workspace. The Workspace's own team channel (named after it, B-07, joined
 * by every member) never qualifies, whatever a run's state says.
 */
export function isRoundChannel(c, { W, ownerId, workspaceName }) {
  const name = c?.name || '';
  return !!(c && W && ownerId
    && c.team_id === W
    && String(c.channel_type).toLowerCase() === 'team'
    && c.owner_id === ownerId
    && c.auto_join_team !== true
    && /^TG 客户回访 \S+$/.test(name)
    && name !== workspaceName);
}

/** The round channels of W that alice made and no run deleted (a round stopped before 99). */
export async function roundChannels(h, who) {
  return (await channels(h, 'alice')).filter((c) => isRoundChannel(c, who));
}

/**
 * W's members by kind: /auth/team lists every account of the Workspace, its Agents' teammate accounts included
 * (E-17); the account directory (POST /auth/user/get_names_with_email, what the web's people/Agent split reads) flags
 * the Agents with `is_agent`.
 */
export async function workspaceMembers(h, user) {
  const team = await h.api(user, 'GET', '/auth/team');
  const ids = (team.body?.members || []).map((m) => m.user_id).filter(Boolean);
  const names = ids.length ? await h.api(user, 'POST', '/auth/user/get_names_with_email', { user_ids: ids }) : { status: 0, body: {} };
  const list = names.body?.names || [];
  const byId = new Map(list.map((n) => [String(n.id).toLowerCase(), n]));
  const known = ids.every((id) => byId.has(String(id).toLowerCase()));
  const people = list.filter((n) => n.is_agent !== true).map((n) => ({ id: n.id, email: (n.email || '').toLowerCase() }));
  const agents = list.filter((n) => n.is_agent === true).map((n) => n.id);
  return { team, teamId: team.body?.team?.id, workspaceName: team.body?.team?.name, ids, names, known, people, agents };
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
    // Nothing of an earlier run's channel is carried over: until this round's channel exists, the steps after this one
    // are blocked (h.need('roundChannel', 'chan')) instead of posting into, and 99 deleting, whatever channel the state
    // still names (rerun-g1-x, 2026-11-24: 22 failed, the later steps used the state's old W team channel and 99
    // deleted it).
    for (const k of ['chan', 'chanId', 'roundChannel']) delete h.S[k];
    h.saveState();
    const emails = ['alice', 'bob', 'carol'].map((n) => h.acc[n].email.toLowerCase());
    const w = await workspaceMembers(h, 'alice');
    h.check('alice 当前工作区是 W', w.teamId === h.S.W, w.teamId);
    if (w.teamId !== h.S.W) return;
    // W's members are its three people and its Agents' accounts; the people are the channel's people.
    h.check('W 的成员都能区分人和 Agent', w.names.status === 200 && w.known, { status: w.names.status, members: w.ids.length, resolved: (w.names.body?.names || []).length });
    const people = w.people;
    h.check('W 有三位成员（不计 Agent）', people.length === 3 && emails.every((e) => people.some((p) => p.email === e)),
      { people: people.length, agents: w.agents.length });
    const ownerId = people.find((p) => p.email === emails[0])?.id;
    if (!ownerId || people.length !== 3) return;
    const who = { W: h.S.W, ownerId, workspaceName: w.workspaceName };
    // A round that stopped before 99 left its channel: delete it first, so this round's search sees this round only.
    // Only channels that are round channels by every mark (isRoundChannel) are touched.
    for (const c of await roundChannels(h, who)) h.log('stale round channel', c.id, c.name, (await h.api('alice', 'DELETE', `/dss/channels/${c.id}`)).status);
    // What the New channel dialog sends (CreateChannelModal): a team channel of the Workspace with the creator as its
    // one participant, auto-join off. The invite page then adds the people (POST /channels/{id}/participants) and the
    // Agents are added in the participants panel; Agents are refused as people at creation.
    const name = roundChannelName(h.cfg.runId);
    const made = await h.api('alice', 'POST', '/dss/channels', { channel_type: 'team', name, team_id: h.S.W, auto_join_team: false, participants: [ownerId] });
    const id = made.body?.id;
    const created = made.status < 300 && /^[0-9a-f-]{36}$/.test(id || '');
    if (!created) h.log('create channel response', made.status, made.body);
    h.check(`在 W 新建本轮团队频道「${name}」`, created, made.status);
    if (!created) return;
    // Recorded at once, so 99 deletes it (and only it) even when a later check here fails.
    h.S.roundChannel = { id, name, runId: h.cfg.runId, W: h.S.W, ownerId, workspaceName: w.workspaceName };
    h.saveState();
    // Channel ownership (TG-23, E-03): the channel is W's, so W's Agents may be added and triggered in it.
    const listed = (await channels(h, 'alice')).find((c) => c.id === id);
    const owned = h.check('频道属于 W', listed?.team_id === h.S.W && isRoundChannel(listed, who), listed && { team_id: listed.team_id, channel_type: listed.channel_type, auto_join_team: listed.auto_join_team });
    const others = people.filter((p) => p.id !== ownerId).map((p) => p.id);
    const added = await h.api('alice', 'POST', `/dss/channels/${id}/participants`, { participants: others });
    if (added.status >= 300) h.log('add participants response', added.status, added.body);
    const invited = h.check('邀请 bob、carol 加入频道', added.status < 300, added.status);
    // The later steps get the channel only when it is this round's channel of W with the three people in it.
    if (!owned || !invited) return;
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
    const members = JSON.stringify(detail.body?.participants || []).toLowerCase();
    h.check('频道内有三位成员', people.every((p) => members.includes(String(p.id).toLowerCase())), detail.status);
    for (const [n, msg] of DISCUSSION) await say(h, n, h.S.chan, msg);
    const c = h.u('carol').page;
    await c.goto(h.S.chan, { waitUntil: 'load' }); await c.waitForTimeout(6000);
    await h.shot(c, 'discussion-carol-view');
    await h.shot(a, 'discussion-alice-view');
    const ct = await h.text(c);
    h.check('carol 看到三人的讨论', DISCUSSION.every(([, msg]) => ct.includes(msg.slice(0, 12))));
  },
};
