// Ring ⑤ (TE-06/TE-07): @任务协调 sets a follow-up 3 minutes ahead; the reminder arrives in the channel on time
// (within [due-60 s, due+180 s]) and the follow-up is audited with the Agent as actor.
import { AGENTS, ask, audit, waitChannel } from '../lib/ui.mjs';
import { afterMessage, minuteAhead } from '../lib/util.mjs';

const MARK = '检查第一轮电话回访名单';

export default {
  id: '50-ring5-followup',
  title: '环⑤ Agent 自设跟进，到点按时提醒（TE-06/TE-07）',
  covers: ['环⑤', 'TE-06', 'TE-07', 'E-09'],
  users: ['alice'],
  async run(h) {
    h.need('chan');
    // The step names the time: "3 minutes from now" left the Agent to pick its own second, and the check measured
    // against the step's guess (2026-11-23: set for 22:45:50, reminded at 22:47:36, judged against 22:44:03).
    const at = minuteAhead(5 * 60000);
    const msg = `请用跟进工具设定一个在今天 ${at.hhmm}（UTC）到点的跟进，备注“TG 跟进：${MARK}”。设好后回复跟进时间；到点时请在这里提醒我。`;
    const r = await ask(h, 'alice', h.S.chan, AGENTS.task, msg, 'followup-set', /跟进|分钟|提醒/, 300);
    h.check('设定跟进的回合成功', r.ok, r.after.slice(0, 300));
    const due = at.date.getTime();
    // The reminder is a new Agent message in the thread after the reply: it names the note, or says it reminds.
    // An Agent rephrases the note (2026-11-24: "检查一下《TG 整理第一轮电话回访名单》"), so its exact words alone are
    // not the test; "提醒" counted after the reply is (the reply itself says it will remind, so it is the baseline).
    const occurrences = (t, word) => t.split(word).length - 1;
    const count = (t) => occurrences(t, MARK) + occurrences(t, '提醒');
    const n0 = count(r.after);
    h.log('due', new Date(due).toISOString(), 'mark count at reply', n0);
    const hit = await waitChannel(h, 'alice', h.S.chan, { test: (t) => count(t) > n0 }, due + 240000, r.marker, 10000);
    await h.shot(h.u('alice').page, 'followup-reminder');
    h.check('到点提醒已送达频道', !!hit.at, afterMessage(await h.text(h.u('alice').page), r.marker).slice(0, 400));
    if (hit.at) {
      const late = Math.round((hit.at - due) / 1000);
      h.log('reminder seen at', new Date(hit.at).toISOString(), 'offset s', late);
      h.check('按时（到点前 60 s 至到点后 180 s 内）', late >= -60 && late <= 180, `${late}s`);
    }
    const ev = await audit(h, 'alice', { actionKey: 'agent.follow_up.set', from: new Date(r.sentAt - 60000).toISOString(), limit: 50 });
    h.log('follow-up audit', ev.events.map((e) => [e.occurredAt, e.eventType, e.decision, e.actorId, e.initiatorId]));
    h.check('跟进审计 actor 为 Agent（bot|）', ev.events.some((e) => String(e.actorId).startsWith('bot|')), ev.status);
  },
};
