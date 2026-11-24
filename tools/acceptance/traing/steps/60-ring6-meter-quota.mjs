// Ring ⑥ (D-02/D-06/D-08, TE-12): the Agents' model calls of this run are metered in OpenMeter under W's customer;
// with @资料员's own monthly limit set to 1 token, a mention is refused in the thread with the Chinese quota notice
// (QUOTA_BLOCKED) and a DENY audit row names the Agent. The limit is removed again.
import { AGENTS, ask, audit, settings } from '../lib/ui.mjs';

export default {
  id: '60-ring6-meter-quota',
  title: '环⑥ 计量入 OpenMeter；额度拒绝在线程中提示并有 DENY 审计（TE-12）',
  covers: ['环⑥', 'D-06', 'D-08', 'TE-12'],
  users: ['alice', 'bob'],
  async run(h) {
    h.need('W', 'chan', 'bots.research');
    const OM = h.cfg.openmeter;
    const cust = await h.fetchJson(`${OM}/customers?pageSize=100`);
    const items = cust.body?.items || (Array.isArray(cust.body) ? cust.body : []);
    const mine = items.find((c) => c.key === `team:${h.S.W}`);
    h.check('OpenMeter 有 W 的 customer（team:<W>）', !!mine, `${cust.status} ${items.length}`);
    const from = h.S.runStart || new Date(Date.now() - 6 * 3600e3).toISOString();
    const q = await h.fetchJson(`${OM}/meters/model_tokens/query?from=${encodeURIComponent(from)}${mine ? '&filterCustomerId=' + mine.id : ''}`);
    const total = (q.body?.data || []).reduce((s, r) => s + Number(r.value || 0), 0);
    h.log('model_tokens since', from, q.status, total);
    h.check('本次运行的模型 token 已计量（>0）', total > 0, `${q.status} ${total}`);
    const ev = await h.fetchJson(`${OM}/events?limit=1000&from=${encodeURIComponent(from)}`);
    const evs = Array.isArray(ev.body) ? ev.body : ev.body?.items || [];
    const bad = evs.filter((e) => e.validationError || e.validationErrors?.length);
    h.check('计量事件无校验错误', bad.length === 0, `${evs.length} events, ${bad.length} invalid`);
    const a = h.u('alice').page;
    await settings(h, a, 'team-usage'); await h.shot(a, 'team-usage');

    const B = h.S.bots.research;
    const before = (await h.api('alice', 'GET', `/dss/quota/bots/${B}`)).body;
    h.log('bot quota before', before);
    h.check('普通成员不能改 Agent 额度', [403, 404].includes((await h.api('bob', 'PUT', `/dss/quota/bots/${B}`, { monthlyTokenLimit: 5 })).status));
    const set = await h.api('alice', 'PUT', `/dss/quota/bots/${B}`, { monthlyTokenLimit: 1 });
    h.check('alice 设资料员每月上限 1 token', set.status < 300, set.status);
    const t0 = new Date(Date.now() - 5000).toISOString();
    try {
      const r = await ask(h, 'alice', h.S.chan, AGENTS.research, '额度验收：请只用一句中文回复“收到”。', 'quota-blocked', /额度|QUOTA_BLOCKED/, 240);
      h.check('线程中显示中文额度提示（QUOTA_BLOCKED）', /QUOTA_BLOCKED/.test(r.after) && /(用量已达到.*上限|额度.*(用完|上限))/.test(r.after), r.after.slice(0, 300));
      h.check('Agent 未作答（被拒）', !/收到/.test(r.after), r.after.slice(0, 200));
      let deny = [];
      for (let i = 0; i < 6 && !deny.length; i++) {
        const e = await audit(h, 'alice', { targetType: 'bot', targetId: B, from: t0, limit: 50 });
        deny = e.events.filter((x) => x.decision === 'DENY' && /QUOTA_BLOCKED/.test(x.resultCode));
        if (!deny.length) await h.sleep(5000);
      }
      h.log('deny audit', deny.map((x) => [x.occurredAt, x.actionKey, x.decision, x.resultCode, x.actorId, x.initiatorId]));
      h.check('DENY 审计（ai.*，QUOTA_BLOCKED，actor=Agent）', deny.some((x) => String(x.actorId) === `bot|${B}`), deny.length);
      await h.jsonShot('alice', `/dss/audit/events?targetType=bot&targetId=${B}&from=${encodeURIComponent(t0)}`, 'deny-audit');
    } finally {
      // The acceptance baseline is no Agent limit, not whatever the run found: a run cut off between setting the
      // 1-token limit and this restore left it in place, and later runs then "restored" 1 (2026-11-23, ③ QUOTA_BLOCKED).
      const c = await h.api('alice', 'PUT', `/dss/quota/bots/${B}`, { monthlyTokenLimit: null });
      h.check('恢复资料员额度', c.status < 300, c.status);
    }
  },
};
