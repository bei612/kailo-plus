// alice becomes the platform administrator: through the in-product bootstrap card while no administrator exists
// (token from the deployment's secrets, passed in a 0600 env file), else granted by an existing administrator whose
// account is in ADMIN_ACCOUNT_FILE (0600). bob gets the auditor role and loses it again (roles UI).
import fs from 'node:fs';
import { settings } from '../lib/ui.mjs';

export default {
  id: '02-platform-admin',
  title: '平台管理员（引导令牌或现有管理员授予）与平台角色界面',
  covers: ['D-03 平台角色'],
  users: ['alice', 'bob'],
  after: ['01'],
  locks: { 'ws:alice': 's', 'ws:bob': 's', 'platform-roles': 'x' },
  est: 60,
  async run(h) {
    const a = h.u('alice').page;
    let st = (await h.api('alice', 'GET', '/dss/platform/settings')).body;
    h.log('platform settings', st);
    if (!st?.canManage && st?.bootstrapOpen && process.env.KAILO_PLATFORM_BOOTSTRAP_TOKEN) {
      await settings(h, a, 'platform');
      await h.shot(a, 'bootstrap-card');
      const inp = a.locator('input[type=password]').first();
      await inp.fill(process.env.KAILO_PLATFORM_BOOTSTRAP_TOKEN);
      await a.getByRole('button', { name: /^(成为管理员|Become administrator)$/ }).click(); await a.waitForTimeout(6000);
      await h.shot(a, 'bootstrap-done', { fullPage: true });
    } else if (!st?.canManage && h.cfg.adminAccountFile) {
      const admin = JSON.parse(fs.readFileSync(h.cfg.adminAccountFile, 'utf8'));
      await h.login('admin', admin);
      const g = await h.api('admin', 'POST', '/dss/platform/roles', { email: h.acc.alice.email, role: 'admin' });
      h.check('现有平台管理员授予 alice 管理员', g.status < 300, g.status);
      await settings(h, h.u('admin').page, 'platform');
      await h.shot(h.u('admin').page, 'granted-by-existing-admin', { fullPage: true });
    }
    st = (await h.api('alice', 'GET', '/dss/platform/settings')).body;
    h.check('alice 是平台管理员（canManage）', st?.canManage === true, st);
    // Platform roles UI: grant bob auditor, then revoke.
    await settings(h, a, 'platform');
    const sec = a.locator('form').filter({ has: a.getByRole('button', { name: /^(授予|Grant)$/ }) }).last();
    await sec.locator('input').first().fill(h.acc.bob.email);
    await sec.getByRole('button', { name: /^(审计员|Auditor)$/ }).click(); await a.waitForTimeout(500);
    await sec.getByRole('button', { name: /^(授予|Grant)$/ }).click(); await a.waitForTimeout(5000);
    await h.shot(a, 'roles-bob-auditor', { fullPage: true });
    const roles = (await h.api('alice', 'GET', '/dss/platform/roles')).body?.holders || [];
    h.check('界面授予 bob 审计员', roles.some((r) => r.email === h.acc.bob.email && r.role === 'auditor'), roles.map((r) => [r.email, r.role]));
    const bobId = roles.find((r) => r.email === h.acc.bob.email)?.userId;
    const rv = await h.api('alice', 'DELETE', '/dss/platform/roles', { userId: bobId, role: 'auditor' });
    const after = (await h.api('alice', 'GET', '/dss/platform/roles')).body?.holders || [];
    h.check('撤销 bob 审计员', rv.status < 300 && !after.some((r) => r.email === h.acc.bob.email), rv.status);
    h.S.aliceUserId = after.find((r) => r.email === h.acc.alice.email)?.userId;
    h.check('bob 不能管理平台', (await h.api('bob', 'GET', '/dss/platform/settings')).body?.canManage === false);
  },
};
