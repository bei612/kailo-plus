// Ring ③ setup: alice creates three team Agents on the Kailo Codex runtime from Settings → Agent (zh-CN, TE-16);
// their installations are read back through /dss/bots (ids kept for quota, audit and security steps).
import { englishLeaks } from '../lib/util.mjs';
import { AGENTS, L, bots, settings } from '../lib/ui.mjs';

export const AGENTS_EN = ['Add agent', 'Create agent', 'Your agents', 'New agent', 'Edit agent', 'Where it runs', 'Who can use it', 'Instructions', 'Private'];

export default {
  id: '21-agents',
  title: '在 Kailo Codex 上建三个团队 Agent（文档助理/资料员/任务协调）',
  covers: ['环②：多 Agent（Codex 运行时 KD-35）', 'TE-16'],
  users: ['alice'],
  after: ['03', '04'],
  locks: { 'ws:alice': 's' },
  est: 150,
  async run(h) {
    h.need('W');
    const a = h.u('alice').page;
    await settings(h, a, 'agents');
    await h.shot(a, 'settings-agents');
    const existing = await bots(h, 'alice');
    for (const key of ['doc', 'research', 'task']) {
      const ag = AGENTS[key];
      if (existing.some((b) => b.handle === ag.handle)) { h.log('exists', ag.handle); continue; }
      await settings(h, a, 'agents', 4000);
      await a.getByRole('button', { name: L.addAgent }).first().click(); await a.waitForTimeout(3000);
      const formText = await h.text(a);
      const leaks = englishLeaks(formText, AGENTS_EN);
      h.check(`新建 Agent 表单为中文（${ag.handle}）`, leaks.length === 0, leaks);
      const inputs = a.locator('input[type=text], input:not([type])');
      await inputs.nth(0).fill(ag.name); await inputs.nth(1).fill(ag.handle);
      await a.locator('div[contenteditable=true]').first().click(); await a.keyboard.type(ag.ins, { delay: 3 });
      await a.getByText(L.codex).first().click();
      await a.getByText(L.teamVisibility).last().click(); await a.waitForTimeout(500);
      await h.shot(a, `form-${key}`, { fullPage: true });
      await a.getByRole('button', { name: L.createAgent }).click(); await a.waitForTimeout(6000);
      await h.shot(a, `created-${key}`);
    }
    if (['doc', 'research', 'task'].every((k) => existing.some((b) => b.handle === AGENTS[k].handle))) {
      // Re-run with the Agents already there: still open the new-Agent form once for the zh-CN check.
      await settings(h, a, 'agents', 4000);
      await a.getByRole('button', { name: L.addAgent }).first().click(); await a.waitForTimeout(3000);
      const leaks = englishLeaks(await h.text(a), AGENTS_EN);
      h.check('新建 Agent 表单为中文（重跑时打开空表单）', leaks.length === 0, leaks);
      await h.shot(a, 'form-empty', { fullPage: true });
      await a.getByRole('button', { name: L.cancel }).last().click().catch(() => a.keyboard.press('Escape'));
    }
    const all = await bots(h, 'alice');
    // The runtime lives on the Agent (GET /dss/agents: harness / harness_id), not on the bot installation.
    const ags = await h.api('alice', 'GET', '/dss/agents');
    const agentList = Array.isArray(ags.body) ? ags.body : [];
    h.S.bots = {};
    for (const [key, ag] of Object.entries(AGENTS)) {
      const b = all.find((x) => x.handle === ag.handle);
      if (b) h.S.bots[key] = b.id;
      if (key !== 'kailo') {
        h.check(`Agent @${ag.handle} 已创建`, !!b, all.map((x) => x.handle));
        h.log(ag.handle, b && { id: b.id, kind: b.kind, status: b.status, definition: b.definition });
        const def = agentList.find((x) => x?.bot?.handle === ag.handle);
        h.check(`@${ag.handle} 运行在 Kailo Codex`, !!def && /codex/i.test(String(def.harness_id ?? def.harness)), def && { harness: def.harness, harness_id: def.harness_id, default_model: def.default_model });
      }
    }
    await settings(h, a, 'agents');
    await h.shot(a, 'agents-list', { fullPage: true });
  },
};
