// Ring ③ setup: alice invites bob and carol from Settings (zh-CN invite dialog, TE-16), mail through mailpit;
// bob joins from Settings, carol from the e-mailed link.
import { englishLeaks } from '../lib/util.mjs';
import { L, settings, setCurrent, workspaces } from '../lib/ui.mjs';

export const INVITE_EN = ['Enter email address', 'Add another', 'Send invite', 'Send invites', 'Invite workspace members', 'Copy link', 'Invite link'];

export default {
  id: '20-invite',
  title: '邀请 bob、carol 加入 W（中文邀请框 TE-16，邮件 + 设置页加入）',
  covers: ['环②：3 人', 'TE-16'],
  users: ['alice', 'bob', 'carol'],
  async run(h) {
    h.need('W', 'domain');
    const a = h.u('alice').page;
    await setCurrent(h, 'alice', h.S.W);
    await settings(h, a, 'team');
    await a.getByText(L.invite).first().click(); await a.waitForTimeout(3000);
    const dlgText = await a.locator('[role=dialog]').innerText().catch(() => '');
    await h.shot(a, 'invite-dialog');
    const leaks = englishLeaks(dlgText, INVITE_EN);
    h.check('邀请框为中文（无英文残留）', leaks.length === 0, leaks.length ? leaks : dlgText.slice(0, 300));
    const t0 = Date.now();
    await a.getByPlaceholder(L.emailPh).last().fill(h.acc.bob.email);
    await a.getByText(L.addAnother).click(); await a.waitForTimeout(800);
    await a.getByPlaceholder(L.emailPh).last().fill(h.acc.carol.email);
    await h.shot(a, 'invite-filled');
    await a.locator('[role=dialog] button').filter({ hasText: L.sendInvite }).last().click();
    await a.waitForTimeout(4000);
    await h.shot(a, 'invite-sent');
    let mails = [];
    for (let i = 0; i < 12 && mails.length < 2; i++) {
      await a.waitForTimeout(5000);
      const m = (await h.fetchJson(`${h.cfg.mailpit}/api/v1/messages?limit=50`)).body;
      mails = (m.messages || []).filter((x) => Date.parse(x.Created) > t0 - 5000 && x.To.some((t) => [h.acc.bob.email, h.acc.carol.email].includes(t.Address)));
    }
    h.check('两封邀请邮件送达 mailpit', mails.length >= 2, mails.map((x) => [x.To[0]?.Address, x.Subject]));
    if (mails[0]) {
      const p = await h.u('alice').ctx.newPage();
      await p.goto(`${h.cfg.mailpit}/view/${mails[0].ID}.html`, { waitUntil: 'load' }).catch(() => {});
      await p.waitForTimeout(1500); await h.shot(p, 'invite-email', { fullPage: true });
      const full = (await h.fetchJson(`${h.cfg.mailpit}/api/v1/message/${mails[0].ID}`)).body;
      h.check('邀请邮件无 macro 品牌', !/macro\.com|\bmacro\b/i.test(full.HTML || ''), (full.Subject || '').slice(0, 100));
      await p.close();
    }
    // bob: Settings → 通用 → 加入
    const b = h.u('bob').page;
    await settings(h, b, 'team');
    const join = b.getByRole('button', { name: L.join }).first();
    if (await join.count()) { await join.click(); await b.waitForTimeout(5000); } else h.warn('bob has no join button on Settings');
    await h.shot(b, 'bob-joined');
    // carol: the e-mailed link
    const c = h.u('carol').page;
    const cm = mails.find((x) => x.To.some((t) => t.Address === h.acc.carol.email));
    if (cm) {
      const full = (await h.fetchJson(`${h.cfg.mailpit}/api/v1/message/${cm.ID}`)).body;
      const link = (full.HTML || full.Text || '').match(/https:\/\/[^"\s]*team-invite\?id=[0-9a-f-]+/)?.[0];
      h.check('carol 邮件含邀请链接', !!link);
      if (link) {
        await c.goto(link, { waitUntil: 'load' }); await c.waitForTimeout(5000);
        await h.shot(c, 'carol-invite-page');
        await c.getByRole('button', { name: L.accept }).first().click().catch((e) => h.warn('carol accept', e.message));
        await c.waitForTimeout(5000); await h.shot(c, 'carol-after-accept');
      }
    }
    for (const n of ['bob', 'carol']) {
      const ws = await workspaces(h, n);
      h.check(`${n} 已是 W 成员`, ws.some((w) => w.id === h.S.W), ws.map((w) => [w.name, w.role]));
      await setCurrent(h, n, h.S.W);
    }
  },
};
