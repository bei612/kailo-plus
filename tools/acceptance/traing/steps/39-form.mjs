// FORM-01: forms. alice creates a form from the launcher (新建 → 表单, Launcher.tsx: POST /dss/forms), adds a short-answer
// question in the builder (Add question → Short answer, builder-view.tsx), publishes it to anyone with the link
// (Publish → Who can respond: Anyone with the link, audience-panel.tsx), and someone without an account answers on
// the public respond page (/app/form/<id>/respond) in a browser with no session. The response is counted
// (/dss/forms/{id}/responses/summary) and alice reads it under Responses. The form builder's copy is English in this
// build (zh-CN gap, a warning here).
import { createFromMenu, idInUrl, token, track } from '../lib/collab.mjs';
import { englishLeaks } from '../lib/util.mjs';

export default {
  id: '39-form',
  title: '表单：搭建问题、公开发布、匿名填写、查看结果（FORM-01）',
  covers: ['FORM-01'],
  users: ['alice'],
  after: ['03'],
  locks: { 'ws:alice': 's' },
  est: 180,
  async run(h) {
    h.need('W');
    const a = h.u('alice').page;
    const tk = token('TGQ');
    await createFromMenu(h, a, 'form');
    await a.waitForURL(/\/app\/(drive\/)?form\/[0-9a-f-]{36}/, { timeout: 30000 }).catch(() => {});
    await a.waitForTimeout(6000);
    const id = idInUrl(a.url(), 'form');
    h.check('从新建菜单建表单并打开', !!id, a.url());
    if (!id) return;
    const f0 = await h.api('alice', 'GET', `/dss/forms/${id}`);
    h.check('表单存在（GET /dss/forms/{id}）', f0.status === 200, f0.status);
    const form = f0.body?.form ?? f0.body;
    track(h, 'form', id);
    h.check('表单的答复存入一个数据库', !!form?.databaseId, form?.databaseId);
    await h.shot(a, 'form-new');

    // A short-answer question.
    const question = `你最希望我们改进什么？${tk}`;
    await a.getByRole('button', { name: /Add question|添加问题/ }).first().click(); await a.waitForTimeout(1200);
    await a.getByRole('menuitem', { name: /^(Short answer|简答)$/ }).first().click()
      .catch(() => a.getByText(/^(Short answer|简答)$/).first().click());
    await a.waitForTimeout(2500);
    const q = a.getByLabel(/^(Question|问题)$/).first();
    const editing = await q.waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false);
    h.check('新增的问题可编辑标题', editing);
    if (editing) { await q.fill(question); await q.press('Enter'); await a.waitForTimeout(3000); }
    await h.shot(a, 'form-question');
    const leaks = englishLeaks(await h.text(a), ['Add question', 'Short answer', 'Preview', 'Publish', 'Responses', 'Settings', 'Build']);
    if (leaks.length) h.warn('表单搭建界面英文残留（zh-CN 缺口）', leaks);

    // Publish to anyone with the link.
    await a.getByRole('button', { name: /^(Publish|发布)$/ }).first().click().catch((e) => h.warn('publish button', e.message));
    await a.waitForTimeout(2000);
    await a.getByText(/^(Anyone with the link|任何拿到链接的人)$/).first().click().catch((e) => h.warn('audience option', e.message));
    await a.waitForTimeout(2500);
    await h.shot(a, 'form-publish');
    const f1 = await h.api('alice', 'GET', `/dss/forms/${id}`);
    const pub = (f1.body?.form ?? f1.body)?.audience === 'public';
    h.check('界面发布为“任何拿到链接的人可填写”', pub, (f1.body?.form ?? f1.body)?.audience);
    if (!pub) {
      // So the rest of the flow (answering, results) is still exercised; the check above stays red.
      await h.api('alice', 'PATCH', `/dss/forms/${id}`, { audience: 'public', status: 'open' });
    }
    await a.keyboard.press('Escape');

    // Someone with no account answers.
    const ctx = await h.browser.newContext({ ignoreHTTPSErrors: true, locale: h.cfg.locale, timezoneId: 'Asia/Shanghai', viewport: { width: 1440, height: 900 } });
    const answer = `希望会议室预订更方便 ${tk}`;
    try {
      const p = await ctx.newPage();
      await p.goto(`${h.BASE}/app/form/${id}/respond`, { waitUntil: 'load' }); await p.waitForTimeout(7000);
      const shown = (await p.innerText('body').catch(() => '')).includes(tk);
      h.check('匿名打开公开填写页并看到问题', shown, p.url());
      await h.shot(p, 'respond-anonymous');
      const field = p.locator('form textarea, form input[type=text], form input:not([type])').first();
      if (shown && (await field.count())) {
        await field.fill(answer); await p.waitForTimeout(600);
        await p.getByRole('button', { name: /^(Submit|提交)$/ }).first().click(); await p.waitForTimeout(5000);
        await h.shot(p, 'respond-submitted');
      } else h.check('填写页有答题输入框', false);
    } finally { await ctx.close(); }

    let sum = null;
    for (let i = 0; i < 6; i++) {
      sum = await h.api('alice', 'GET', `/dss/forms/${id}/responses/summary`);
      if (Number(sum.body?.submitted) >= 1) break;
      await h.sleep(2500);
    }
    h.check('答复已提交并计数（responses/summary）', Number(sum?.body?.submitted) >= 1, sum?.body);
    await a.reload({ waitUntil: 'load' }); await a.waitForTimeout(5000);
    await a.getByRole('tab', { name: /^(Responses|答复|回复)$/ }).first().click()
      .catch(() => a.getByText(/^(Responses|答复|回复)$/).first().click()).catch((e) => h.warn('responses tab', e.message));
    await a.waitForTimeout(5000);
    h.check('结果页显示该答复', (await h.text(a)).includes(answer));
    await h.shot(a, 'form-responses', { fullPage: true });
  },
};
