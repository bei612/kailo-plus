// Onboarding to the end for every person; TE-11: the onboarding page creates exactly one shared Workspace per person
// even when the authz barrier is slow (request_id idempotency, kailo-authz-pending instead of 503).
import { L, workspaces } from '../lib/ui.mjs';

export default {
  id: '01-onboard',
  title: '引导流程走完，每人恰好一个共享工作区（TE-11）',
  covers: ['TE-11'],
  users: ['alice', 'bob', 'carol', 'dave'],
  after: ['00'],
  locks: { 'ws:alice': 'x', 'ws:bob': 'x', 'ws:carol': 'x', 'ws:dave': 'x' },
  est: 120,
  async run(h) {
    for (const n of ['alice', 'bob', 'carol', 'dave']) {
      const p = h.u(n).page;
      const created = [];
      const onResp = async (r) => { if (/\/auth\/team$/.test(r.url().split('?')[0]) && r.request().method() === 'POST') created.push(`${r.status()} pending=${r.headers()['kailo-authz-pending'] ?? '-'}`); };
      p.on('response', onResp);
      if (!/\/app\//.test(p.url())) await p.goto(`${h.BASE}/app`, { waitUntil: 'load' });
      for (let i = 1; i < 20; i++) {
        await p.waitForTimeout(2500);
        if (!/\/app\/login|onboarding|welcome/.test(p.url())) break;
        await h.shot(p, `${n}-onboarding-${String(i).padStart(2, '0')}`);
        const b = p.getByRole('button', { name: L.onboarding }).first();
        if (!(await b.count())) { h.warn(`${n} onboarding has no known button`, (await h.text(p)).slice(0, 300)); break; }
        h.log(n, 'onboarding step', i, '->', (await b.innerText()).trim());
        await b.click();
      }
      await p.waitForTimeout(5000);
      p.off('response', onResp);
      await h.shot(p, `${n}-onboarding-done`);
      const ws = await workspaces(h, n);
      const shared = ws.filter((w) => w.kind !== 'personal' && /owner/i.test(String(w.role)));
      h.log(n, 'POST /team', created, 'workspaces', ws.map((w) => [w.name, w.kind, w.role, w.current]));
      h.check(`${n} 引导结束离开引导页`, !/onboarding|\/login/.test(p.url()), p.url());
      h.check(`${n} 恰好拥有一个共享工作区（无重复创建）`, shared.length === 1, shared.map((w) => w.name));
      h.check(`${n} 有个人工作区`, ws.some((w) => w.kind === 'personal'), ws.map((w) => w.kind));
    }
  },
};
