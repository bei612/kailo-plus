// Ring ⑤ (T-08, routine-agent-access): in the conversation @任务协调 creates a one-off Routine a few minutes ahead and
// a recurring one every 5 minutes; both run on time through Temporal, as the Agent: run history on time, and the audit
// of the runs names the Agent (bot|…) as actor, not the owner. Both are deleted afterwards.
import { deepFind, minuteAhead } from '../lib/util.mjs';
import { AGENTS, ask, audit } from '../lib/ui.mjs';

const ONCE = 'TG 一次性提醒';
const CRON = 'TG 周期汇总';

async function routines(h) {
  const r = await h.api('alice', 'GET', '/scheduled-action/scheduled-actions');
  return deepFind(r.body, (o) => typeof o.id === 'string' && typeof o.name === 'string');
}

/** A routine by id (a one-off routine that already ran is no longer in the active list). */
async function routine(h, id) {
  const r = await h.api('alice', 'GET', `/scheduled-action/scheduled-actions/${id}`);
  return r.status === 200 ? deepFind(r.body, (o) => o.id === id && typeof o.name === 'string')[0] ?? null : null;
}

/** Routine ids the Agent linked in its reply (/app/routines/<id>). */
function linkedIds(text) {
  return [...new Set([...String(text).matchAll(/\/app\/routines\/([0-9a-f-]{36})/g)].map((m) => m[1]))];
}

/** Run records of a routine: objects with a start time, as `{ start, ok, raw }`. */
async function runs(h, id) {
  const r = await h.api('alice', 'GET', `/scheduled-action/scheduled-actions/${id}/history`);
  const rows = deepFind(r.body, (o) => Object.keys(o).some((k) => /start/i.test(k) && typeof o[k] === 'string' && !Number.isNaN(Date.parse(o[k]))));
  return rows.map((o) => {
    const k = Object.keys(o).find((x) => /start/i.test(x) && typeof o[x] === 'string');
    const ok = o.is_success ?? o.isSuccess ?? o.success ?? (/(fail|error)/i.test(String(o.status ?? '')) ? false : o.status ? /succ|complete|done|ok/i.test(String(o.status)) : null);
    return { start: Date.parse(o[k]), ok, raw: o };
  });
}


/**
 * The audit of a run window: events on the routine itself, else (when the run's events target what it touched) the
 * events of the Agent in the window. The routine runs as the Agent when there are such events and none on the routine
 * names another actor.
 */
async function runAudit(h, id, fromMs, toMs) {
  const from = new Date(fromMs).toISOString(); const to = new Date(toMs).toISOString();
  const own = await audit(h, 'alice', { targetType: 'scheduled_action', targetId: id, from, to, limit: 100 });
  const bot = h.S.bots?.task ? await audit(h, 'alice', { actorId: `bot|${h.S.bots.task}`, from, to, limit: 100 }) : { events: [] };
  const ownActors = own.events.map((e) => e.actorId);
  const ok = (own.events.length > 0 || bot.events.length > 0) && ownActors.every((x) => String(x).startsWith('bot|'));
  return { ok, own: own.events, bot: bot.events };
}

export default {
  id: '51-ring5-routines',
  title: '环⑤ 对话中定下的一次性/周期例程按时以 Agent 身份运行（审计 actor=bot）',
  covers: ['环⑤', 'T-08', 'routine-agent-access', 'TE-06'],
  users: ['alice'],
  after: ['21', '22'],
  locks: { 'ws:alice': 's', chan: 's', 'quota:W': 's', 'agent:tg-task': 'x' },
  est: 960,
  release: { 'agent:tg-task': 420 },
  async run(h) {
    h.need('chan');
    // Lead time covers an Agent turn on a 32k-window model (2026-11-23: 490 s), so the run is checked at its time.
    const at = minuteAhead(12 * 60000);
    const msg = `我们说定了：请用 Routine 工具建两个例程。①一次性：名称“${ONCE}”，今天 ${at.hhmm}（UTC）执行一次，内容是在本频道发“TG 提醒：请检查回访名单”。②周期：名称“${CRON}”，每 5 分钟执行一次（cron */5 * * * *，UTC），内容是在本频道发“TG 周期汇总：回访进度检查”。建好后回复两个例程的名称和执行时间。`;
    const r = await ask(h, 'alice', h.S.chan, AGENTS.task, msg, 'routines-create', new RegExp(`${ONCE}|${CRON}|已创建`));
    h.check('建例程的回合成功', r.ok, r.after.slice(0, 300));
    let list = await routines(h);
    let once = list.find((x) => x.name === ONCE); const cron = list.find((x) => x.name === CRON);
    if (!once) {
      for (const id of linkedIds(r.after)) { const x = await routine(h, id); if (x?.name === ONCE) { once = x; break; } }
      if (once) h.log('once found by the reply link (no longer in the active list)', once.id);
    }
    h.check('一次性例程已建', !!once, list.map((x) => x.name));
    h.check('周期例程已建', !!cron);
    h.S.routines = [once?.id, cron?.id].filter(Boolean);
    for (const x of [once, cron].filter(Boolean)) h.log(x.name, JSON.stringify(x).slice(0, 700));
    h.check('例程归属 Agent（记录 bot）', [once, cron].filter(Boolean).every((x) => JSON.stringify(x).includes(h.S.bots?.task ?? '__none__') || /"(agent_?id|bot_?id|agentId|botId)":"[0-9a-f-]{36}"/i.test(JSON.stringify(x))), h.S.bots?.task);
    // From here the step only waits for the scheduled runs (their own Agent sessions) and reads their records: other
    // steps may talk to @任务协调 meanwhile.
    h.unlock('agent:tg-task');
    const a = h.u('alice').page;
    await a.goto(`${h.BASE}/app/routines`, { waitUntil: 'load' }); await a.waitForTimeout(6000);
    await h.shot(a, 'routines-list');
    try {
      if (once) {
        // Due at `at`, or at once when it was created after that time (the scheduler catches up).
        const due = Math.max(at.date.getTime(), Date.parse(once.created_at ?? once.createdAt ?? 0) || 0);
        const until = due + 180000;
        let hit = null;
        while (Date.now() < until && !hit) { await h.sleep(20000); hit = (await runs(h, once.id)).find((x) => x.start >= at.date.getTime() - 5000); }
        h.log('once runs', (await runs(h, once.id)).map((x) => [new Date(x.start).toISOString(), x.ok]));
        h.check('一次性例程按时运行（到点后 120 s 内开始）', hit && hit.start <= due + 120000, hit && `${new Date(hit.start).toISOString()} due ${new Date(due).toISOString()}`);
        h.check('一次性例程运行成功', hit && hit.ok !== false, hit?.raw);
        const ev = await runAudit(h, once.id, at.date.getTime() - 5000, at.date.getTime() + 300000);
        h.log('once audit', ev.own.map((e) => [e.occurredAt, e.eventType, e.actionKey, e.decision, e.actorId]), 'bot events', ev.bot.length);
        h.check('一次性例程运行审计 actor 为 Agent（bot|）', ev.ok, ev.own.map((e) => e.actorId));
      }
      if (cron) {
        const created = Date.now();
        const next = Math.ceil(created / 300000) * 300000;
        let hit = null;
        while (Date.now() < next + 180000 && !hit) { await h.sleep(20000); hit = (await runs(h, cron.id)).find((x) => x.start >= next - 5000); }
        h.log('cron runs', (await runs(h, cron.id)).map((x) => [new Date(x.start).toISOString(), x.ok]));
        h.check('周期例程在 5 分钟边界按时运行', hit && hit.start <= next + 120000, hit && new Date(hit.start).toISOString());
        h.check('周期例程运行成功', hit && hit.ok !== false, hit?.raw);
        const ev = await runAudit(h, cron.id, next - 5000, next + 240000);
        h.log('cron audit', ev.own.map((e) => [e.occurredAt, e.eventType, e.actionKey, e.decision, e.actorId]), 'bot events', ev.bot.length);
        h.check('周期例程运行审计 actor 为 Agent（bot|）', ev.ok, ev.own.map((e) => e.actorId));
      }
      await a.goto(h.S.chan, { waitUntil: 'load' }); await a.waitForTimeout(6000);
      await h.shot(a, 'channel-after-runs');
      if (!/TG 提醒：请检查回访名单|TG 周期汇总：回访进度检查/.test(await h.text(a))) h.warn('routine output not visible in the channel (runs may post in the Agent session instead)');
      for (const id of h.S.routines) {
        await a.goto(`${h.BASE}/app/routines/${id}`, { waitUntil: 'load' }); await a.waitForTimeout(5000);
        await h.shot(a, `routine-${id.slice(0, 8)}`);
      }
    } finally {
      for (const id of h.S.routines || []) h.log('delete routine', id, (await h.api('alice', 'DELETE', `/scheduled-action/scheduled-actions/${id}`)).status);
      list = await routines(h);
      h.S.routines = list.filter((x) => x.name === ONCE || x.name === CRON).map((x) => x.id);
    }
  },
};
