// TE-16: the invite dialog, the Agents pages and the Routines pages read in Chinese under zh-CN (no leftover English
// UI strings from the lists below; product names such as Kailo Codex are allowed).
import { englishLeaks } from '../lib/util.mjs';
import { L, settings, mainText } from '../lib/ui.mjs';
import { INVITE_EN } from './20-invite.mjs';
import { AGENTS_EN } from './21-agents.mjs';

const ROUTINES_EN = ['Routines', 'Create routine', 'New routine', 'Routine name', 'Morning brief', 'Weekdays at 9:00', 'Owned by', 'Changes not saved', 'Run now', 'Last run', 'Next run', 'Schedule'];
const AGENTS_VIEW_EN = [...AGENTS_EN, 'Agents', 'Routines', 'Your agents', 'Running', 'Idle'];

export default {
  id: '84-zh-text',
  title: '中文界面：邀请框、Agent 页、例程页（TE-16）',
  covers: ['TE-16'],
  users: ['alice'],
  after: ['21'],
  locks: { 'ws:alice': 's' },
  est: 90,
  async run(h) {
    const a = h.u('alice').page;
    const pages = [
      ['invite', async () => { await settings(h, a, 'team'); await a.getByText(L.invite).first().click(); await a.waitForTimeout(3000); return a.locator('[role=dialog]').innerText(); }, INVITE_EN],
      ['settings-agents', async () => { await settings(h, a, 'agents', 6000); return mainText(h, a); }, AGENTS_EN],
      ['agents-view', async () => { await a.goto(`${h.BASE}/app/agents`, { waitUntil: 'load' }); await a.waitForTimeout(6000); return mainText(h, a); }, AGENTS_VIEW_EN],
      ['routines', async () => { await a.goto(`${h.BASE}/app/routines`, { waitUntil: 'load' }); await a.waitForTimeout(6000); return mainText(h, a); }, ROUTINES_EN],
      ['routine-new', async () => { await a.goto(`${h.BASE}/app/routines/new`, { waitUntil: 'load' }); await a.waitForTimeout(6000); return mainText(h, a); }, ROUTINES_EN],
      ['settings-routines', async () => { await settings(h, a, 'routines', 6000); return mainText(h, a); }, ROUTINES_EN],
    ];
    for (const [label, open, en] of pages) {
      const t = await open();
      await h.shot(a, label, { fullPage: true });
      const leaks = englishLeaks(t, en);
      h.check(`${label} 无英文残留`, leaks.length === 0, leaks.length ? leaks : undefined);
      h.check(`${label} 有中文内容`, /[一-鿿]{4,}/.test(t), t.slice(0, 120));
      if (label === 'invite') await a.keyboard.press('Escape');
    }
  },
};
