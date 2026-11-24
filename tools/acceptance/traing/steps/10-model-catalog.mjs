// Model layer prerequisite of the Codex rings (TE-10 / TE-09 / TE-03). After the deploy's model-catalog-sync job the catalog carries the release's
// default Responses rewrites (flatten-tool-namespaces, complete-replayed-messages) as a revision by
// svc|model-catalog-sync, with no manual edit. Then 管理→模型: edit a provider, change and change back a rewrite,
// 确定 — no page error (the Solid update loop overflowed the stack in train e), nothing saved.
import { L, settings } from '../lib/ui.mjs';

const NEED = ['flatten-tool-namespaces', 'complete-replayed-messages'];

export default {
  id: '10-model-catalog',
  title: '模型目录经部署同步含 flatten/complete-replayed-messages；编辑→确定不崩溃（TE-10/TE-09）',
  covers: ['TE-10', 'TE-09', 'TE-03'],
  users: ['alice'],
  async run(h) {
    const v = await h.api('alice', 'GET', '/dss/platform/models');
    h.check('GET /dss/platform/models 200', v.status === 200, v.status);
    const doc = v.body?.document;
    const providers = doc?.providers || [];
    const chat = providers.find((p) => p.name === 'default-chat') || providers.find((p) => (p.responses_rewrites || []).length);
    h.log('providers', providers.map((p) => [p.name, p.responses_rewrites]));
    for (const rw of NEED) h.check(`default-chat 含 ${rw}`, (chat?.responses_rewrites || []).includes(rw), chat?.responses_rewrites);
    const hist = v.body?.history || [];
    h.log('history', hist.slice(0, 8).map((x) => [x.revision, x.createdBy, x.createdAt, x.comment?.slice(0, 60)]));
    const sync = hist.find((x) => x.createdBy === 'svc|model-catalog-sync');
    h.check('存在 svc|model-catalog-sync 写入的修订', !!sync, hist.map((x) => x.createdBy));
    const manual = hist.filter((x) => x.createdBy !== 'svc|model-catalog-sync' && sync && Date.parse(x.createdAt) > Date.parse(sync.createdAt));
    h.check('同步之后无人工修订（无需手工编辑）', manual.length === 0, manual.map((x) => [x.revision, x.createdBy]));
    h.check('服务已应用最新修订', v.body?.appliedRevision === v.body?.revision, [v.body?.revision, v.body?.appliedRevision]);
    h.S.modelRevision = v.body?.revision;

    const a = h.u('alice').page;
    const errs = [];
    const onErr = (e) => errs.push(String(e?.stack || e).slice(0, 400));
    a.on('pageerror', onErr);
    await settings(h, a, 'models', 6000);
    await h.shot(a, 'models-page', { fullPage: true });
    await a.getByRole('button', { name: L.edit }).first().click(); await a.waitForTimeout(3000);
    const dlg = a.locator('[role=dialog]');
    await h.shot(a, 'edit-dialog');
    const toggle = dlg.getByText('flatten-tool-namespaces', { exact: true });
    if (await toggle.count()) {
      await toggle.click(); await a.waitForTimeout(800);
      await toggle.click(); await a.waitForTimeout(800);
    } else h.warn('rewrite toggle not found in the dialog');
    await h.shot(a, 'edit-dialog-toggled-back');
    await dlg.getByRole('button', { name: L.ok }).click(); await a.waitForTimeout(3000);
    await h.shot(a, 'after-confirm', { fullPage: true });
    const stillOpen = await dlg.count();
    const body = await h.text(a);
    a.off('pageerror', onErr);
    h.check('编辑→确定无页面错误（无栈溢出）', errs.length === 0, errs[0]);
    h.check('确定后对话框关闭', stillOpen === 0, stillOpen);
    h.check('确定后模型页仍可用', /模型/.test(body) && /角色/.test(body), body.slice(0, 200));
    // Leave without saving; the stored revision must be unchanged.
    await a.goto(`${h.BASE}/app/home`, { waitUntil: 'load' }); await a.waitForTimeout(2000);
    const w = await h.api('alice', 'GET', '/dss/platform/models');
    h.check('未保存：修订号不变', w.body?.revision === v.body?.revision, [v.body?.revision, w.body?.revision]);
    await h.jsonShot('alice', '/dss/platform/models', 'catalog-api');
  },
};
