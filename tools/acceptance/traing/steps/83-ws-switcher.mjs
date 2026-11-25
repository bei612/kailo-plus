// TE-15 / F-09: carol, member of W and owner of her own Workspace, switches with the sidebar Workspace switcher; the
// server's current Workspace and the settings page follow (one current-Workspace source), and she switches back.
import { setCurrent, settings, workspaces } from '../lib/ui.mjs';
import { TEAM } from './03-workspaces.mjs';

async function switchTo(h, p, name) {
  await p.goto(`${h.BASE}/app/home`, { waitUntil: 'load' }); await p.waitForTimeout(6000);
  const sw = p.getByRole('button', { name: /^工作区：/ }).first();
  const trigger = (await sw.count()) ? sw : p.getByText(/^工作区：/).first();
  await trigger.click(); await p.waitForTimeout(2000);
  const menu = await h.text(p);
  await h.shot(p, `switcher-menu-to-${name.replace(/\s+/g, '')}`);
  await p.getByRole('menuitem', { name: new RegExp(name) }).first().click()
    .catch(() => p.getByText(name, { exact: true }).last().click());
  // The confirmation is a transient toast (4.5 s): read it as soon as it shows, within the same 4 s bound.
  await p.getByText(/已切换到/).first().waitFor({ timeout: 4000 }).catch(() => {});
  const toast = await h.text(p);
  await h.shot(p, `switched-to-${name.replace(/\s+/g, '')}`);
  return { menu, toast };
}

export default {
  id: '83-ws-switcher',
  title: '工作区切换器：切换后服务端 current 与设置页一致（TE-15）',
  covers: ['TE-15', 'F-09'],
  users: ['carol'],
  after: ['03', '20'],
  locks: { 'ws:carol': 'x' },
  est: 90,
  async run(h) {
    h.need('W', 'ws');
    const own = h.S.ws[`carol:${TEAM.carol}`];
    await setCurrent(h, 'carol', h.S.W);
    const c = h.u('carol').page;
    const r1 = await switchTo(h, c, TEAM.carol);
    h.check('切换器列出全部工作区（含个人工作区）', r1.menu.includes(TEAM.carol) && r1.menu.includes(TEAM.alice) && /个人工作区/.test(r1.menu), r1.menu.slice(0, 300));
    h.check('切换提示“已切换到”', /已切换到/.test(r1.toast));
    let cur = (await workspaces(h, 'carol')).find((w) => w.current);
    h.check('服务端 current 为 carol 自己的工作区', cur?.id === own, cur?.name);
    await settings(h, c, 'team', 6000);
    await h.shot(c, 'settings-after-switch');
    const st = await h.text(c);
    h.check('设置页团队与 current 一致', st.includes(TEAM.carol) && !st.includes(`团队 · ${TEAM.alice}`), st.slice(0, 300));
    await switchTo(h, c, TEAM.alice);
    cur = (await workspaces(h, 'carol')).find((w) => w.current);
    h.check('切回 W', cur?.id === h.S.W, cur?.name);
  },
};
