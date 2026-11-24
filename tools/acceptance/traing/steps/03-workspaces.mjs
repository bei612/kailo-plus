// Name each person's shared Workspace and remember the ids; alice's is the acceptance Workspace W.
import { setCurrent, workspaces } from '../lib/ui.mjs';

export const TEAM = { alice: 'TG 安林团队', bob: 'TG 周博团队', carol: 'TG 陈可团队', dave: 'TG 王达团队' };

export default {
  id: '03-workspaces',
  title: '各人共享工作区命名，记录工作区 id',
  covers: ['环①：Workspace'],
  users: ['alice', 'bob', 'carol', 'dave'],
  after: ['01'],
  locks: { 'ws:alice': 'x', 'ws:bob': 'x', 'ws:carol': 'x', 'ws:dave': 'x' },
  est: 30,
  async run(h) {
    h.S.ws = {};
    for (const [n, name] of Object.entries(TEAM)) {
      const own = (await workspaces(h, n)).find((w) => w.kind !== 'personal' && /owner/i.test(String(w.role)));
      if (!own) { h.check(`${n} 有自己的共享工作区`, false); continue; }
      await setCurrent(h, n, own.id);
      const r = await h.api(n, 'PATCH', '/auth/team', { name });
      h.check(`${n} 工作区改名为「${name}」`, r.status < 300, r.status);
      for (const w of await workspaces(h, n)) h.S.ws[`${n}:${w.kind === 'personal' ? 'personal' : w.name}`] = w.id;
    }
    h.S.W = h.S.ws[`alice:${TEAM.alice}`];
    h.log('workspaces', h.S.ws);
    h.check('验收工作区 W 已确定', !!h.S.W, h.S.W);
    await h.u('alice').page.goto(`${h.BASE}/app/home`, { waitUntil: 'load' }); await h.u('alice').page.waitForTimeout(5000);
    await h.shot(h.u('alice').page, 'alice-home-W');
  },
};
