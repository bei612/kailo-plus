// Ring ④ (TE-04/TE-14): @任务协调 (Codex) renders a confirmation card; it shows in the channel (or its session),
// alice confirms it in the UI, the agent continues; the server takes the confirm exactly once: the same actionId again is
// a duplicate, a different actionId is refused (409 SURFACE_ALREADY_SUBMITTED, or SURFACE_ALREADY_ACTED on a
// once-per-person card), an outsider is refused.
import { uuid7 } from '../lib/util.mjs';
import { AGENTS, L, ask, audit, waitChannel } from '../lib/ui.mjs';

export default {
  id: '40-ring4-card',
  title: '环④ Codex 出卡显示、人确认一次、换 actionId 不能二次确认（TE-04/TE-14）',
  covers: ['环④', 'TE-04', 'TE-14', 'TE-06'],
  users: ['alice', 'bob', 'dave'],
  after: ['22'],
  locks: { 'ws:alice': 's', 'ws:bob': 's', 'ws:dave': 's', chan: 's', 'quota:W': 's', 'agent:tg-task': 'x' },
  est: 480,
  async run(h) {
    h.need('roundChannel', 'chan');
    const a = h.u('alice').page;
    const acts = [];
    const onReq = (req) => { if (/\/surfaces\/[^/]+\/actions$/.test(req.url().split('?')[0]) && req.method() === 'POST') acts.push({ url: req.url(), body: req.postData() }); };
    a.on('request', onReq);
    const msg = '需要大家确认一件事：第二轮上门拜访是否从 12 月 15-20 日改到 12 月 16-21 日。请用 RenderSurface 在频道里出一张确认卡片（标题“确认调整上门拜访时间”，按钮“确认调整”和“不调整”），只需要林安确认一次；收到确认后在频道里回复结果。';
    const r = await ask(h, 'alice', h.S.chan, AGENTS.task, msg, 'card', /确认调整|不调整|卡片/);
    h.check('任务协调出卡回合无失败', r.ok, r.after.slice(0, 300));
    // The card is in this mention's thread row. A channel card draws lazily (LazyDecorator, within 400px of the
    // viewport) and shows only its fallback text before that, and concurrent steps keep posting below it: scroll the
    // row's card into view and wait for the drawn card's button there. The fallback is this reply's own session.
    const row = a.locator('[data-channel-thread-row]').filter({ hasText: r.marker }).last();
    const card = row.locator('section[aria-label="确认调整上门拜访时间"], [data-a2ui-card]').last();
    if (await card.count()) await card.scrollIntoViewIfNeeded().catch(() => {});
    // Visible is decided once, by a wait: a bare count() is one instant, and the button can be gone for a moment while
    // the row redraws as messages arrive below it (B9 r2: counted 0 between two counts > 0 while 51's routine posted).
    const shows = (loc) => loc.first().waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false);
    let btn = row.getByRole('button', { name: /^确认调整$/ });
    let where = 'channel';
    let visible = await shows(btn);
    if (!visible) {
      const open = row.getByText(L.openSession).last();
      if (await open.count()) { await open.click(); await a.waitForTimeout(8000); where = 'session'; }
      btn = a.getByRole('button', { name: /^确认调整$/ });
      visible = await shows(btn);
    }
    await h.shot(a, `card-visible-${where}`);
    h.check('卡片按钮可见（TE-04）', visible, where);
    if (!visible) { a.off('request', onReq); return; }
    const respP = a.waitForResponse((x) => /\/surfaces\/[^/]+\/actions$/.test(x.url().split('?')[0]) && x.request().method() === 'POST', { timeout: 30000 }).catch(() => null);
    await btn.last().click();
    const resp = await respP;
    await a.waitForTimeout(4000);
    await h.shot(a, 'card-confirmed');
    a.off('request', onReq);
    h.check('界面确认成功（服务端 2xx）', resp && resp.status() < 300, resp && `${resp.status()} ${(await resp.text().catch(() => '')).slice(0, 200)}`);
    const act = acts.at(-1);
    if (!act) { h.check('捕获到确认请求', false); return; }
    const url = new URL(act.url);
    const p = url.pathname;
    h.S.card = { path: p.replace(/\/actions$/, '') };
    const body = JSON.parse(act.body);
    const same = await h.api('alice', 'POST', p, body);
    h.check('同一 actionId 重试：按重复处理（不再生效）', same.status < 300 || same.status === 409, `${same.status} ${JSON.stringify(same.body).slice(0, 200)}`);
    const other = await h.api('alice', 'POST', p, { ...body, actionId: uuid7() });
    // Design 11 §4: a card the first action claims refuses another with SURFACE_ALREADY_SUBMITTED; a once-per-person card
    // (perPrincipalOnce, which the Agent may choose) refuses the same person's second action with SURFACE_ALREADY_ACTED.
    const policy = (await h.api('alice', 'GET', h.S.card.path)).body?.actionPolicy ?? {};
    const refusal = policy.perPrincipalOnce ? 'SURFACE_ALREADY_ACTED' : 'SURFACE_ALREADY_SUBMITTED';
    h.check(`换 actionId 再确认被拒（409 ${refusal}）`, other.status === 409 && other.body?.code === refusal, `${other.status} ${JSON.stringify(other.body).slice(0, 200)} policy ${JSON.stringify(policy)}`);
    const dave = await h.api('dave', 'POST', p, { ...body, actionId: uuid7() });
    h.check('非成员确认被拒（403/404）', dave.status === 403 || dave.status === 404, dave.status);
    const sf = await h.api('alice', 'GET', h.S.card.path);
    h.log('surface', JSON.stringify(sf.body).slice(0, 500));
    h.check('卡片状态为已提交', /submitted/i.test(JSON.stringify(sf.body)), sf.status);
    const cont = await waitChannel(h, 'alice', h.S.chan, /(已确认|确认调整|已调整|16-21|16 日)/, Date.now() + 300000, '收到确认后在频道里回复结果');
    await h.shot(a, 'agent-continued');
    h.check('确认后 Agent 继续并回复结果', !!cont.at && /(任务协调)/.test(cont.text), cont.text.slice(0, 300));
    const sid = p.match(/agent-sessions\/([^/]+)/)?.[1];
    h.S.cardSession = sid;
    const ev = await audit(h, 'alice', { targetType: 'agent_session', targetId: sid, limit: 100 });
    h.log('card audit', ev.events.map((e) => [e.eventType, e.actionKey, e.decision, e.resultCode, e.actorId]));
    h.check('卡片动作进入审计', ev.status === 200 && ev.events.length > 0, ev.status);
  },
};
