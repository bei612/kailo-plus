// SRCH-01: finding work again. alice writes a document with a one-time token in its title; the search service
// indexes it (POST /dss/search), and she finds it in the ⌘K / Ctrl+K palette (CommandMenu.tsx, results role=option)
// and opens it from there, on the 搜索 page (/app/search) and under 最近 (/app/recent). She stars it from the file
// menu (文件操作 → 收藏, SplitFileMenu.tsx), and her favourites (GraphQL Favorites) list it.
import { gql, token, track } from '../lib/collab.mjs';
import { newDoc } from '../lib/ui.mjs';

/** POST /dss/search for `q` until a result names document `id` (or the time is up); the polls it took. */
async function searchUntil(h, user, q, id, maxS = 120) {
  const t0 = Date.now(); let r = null;
  while ((Date.now() - t0) / 1000 < maxS) {
    r = await h.api(user, 'POST', '/dss/search?page_size=20', { query: q, match_type: 'partial', search_on: 'name_content' });
    if (r.status === 200 && JSON.stringify(r.body?.results ?? []).includes(id)) return { found: true, seconds: Math.round((Date.now() - t0) / 1000), status: r.status };
    await h.sleep(3000);
  }
  return { found: false, status: r?.status, body: JSON.stringify(r?.body ?? '').slice(0, 300) };
}

export default {
  id: '33-search',
  title: '搜索：新文档可被检索、⌘K 打开、搜索页、最近、收藏（SRCH-01）',
  covers: ['SRCH-01'],
  users: ['alice'],
  after: ['03'],
  locks: { 'ws:alice': 's' },
  est: 180,
  async run(h) {
    h.need('W');
    const tk = token('TGS');
    const title = `TG 检索验收 ${tk}`;
    const a = h.u('alice').page;
    const doc = await newDoc(h, a, title, `本周采购事项的检索验收记录，关键词 ${tk}。`);
    track(h, 'doc', doc.id);
    h.check('新建文档', !!doc.id, doc.url);
    if (!doc.id) return;
    await a.waitForTimeout(3000);

    const s = await searchUntil(h, 'alice', tk, doc.id);
    h.check('搜索服务能检索到新文档（POST /dss/search）', s.found, s);

    // ⌘K / Ctrl+K: type the token, the document is a result, Enter opens it.
    await a.goto(`${h.BASE}/app/home`, { waitUntil: 'load' }); await a.waitForTimeout(4000);
    await a.locator('body').click({ position: { x: 900, y: 120 } });
    await a.keyboard.press('ControlOrMeta+k'); await a.waitForTimeout(1500);
    const palette = a.locator('[data-command-menu]').first();
    const open = await palette.waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
    h.check('Ctrl+K 打开命令面板', open);
    if (open) {
      const field = palette.locator('textarea').first();
      h.check('命令面板输入框为中文（搜索...）', /搜索/.test((await field.getAttribute('placeholder').catch(() => '')) || ''));
      await field.fill(tk); await a.waitForTimeout(4000);
      // The document's own result (its title), not the 搜索“<token>” row that leads the list and also holds the token.
      const opts = palette.getByRole('option').filter({ hasText: title });
      const shown = (await opts.count()) > 0;
      h.check('命令面板结果中有该文档', shown, (await palette.innerText().catch(() => '')).slice(0, 200));
      await h.shot(a, 'palette');
      if (shown) {
        await opts.first().click();
        await a.waitForURL((u) => u.href.includes(doc.id), { timeout: 15000 }).catch(() => {});
        h.check('从命令面板打开该文档', a.url().includes(doc.id), a.url());
      }
    }

    // The 搜索 page (/app/search, input [data-soup-search]).
    await a.goto(`${h.BASE}/app/search`, { waitUntil: 'load' }); await a.waitForTimeout(5000);
    const box = a.locator('[data-soup-search]').first();
    if (await box.count()) {
      await box.click(); await box.fill(tk).catch(async () => { await a.keyboard.type(tk); });
      await a.waitForTimeout(5000);
    } else h.warn('search page input [data-soup-search] not found');
    h.check('搜索页列出该文档', (await h.text(a)).includes(title));
    await h.shot(a, 'search-page');

    // Favourite it from the document's file menu.
    await a.goto(`${h.BASE}/app/drive/md/${doc.id}`, { waitUntil: 'load' }); await a.waitForTimeout(6000);
    await a.getByRole('button', { name: /^(文件操作|File actions)$/ }).first().click(); await a.waitForTimeout(1200);
    await h.shot(a, 'file-menu');
    await a.getByRole('menuitem', { name: /^收藏/ }).first().click()
      .catch(() => a.getByText(/^收藏$/).first().click()).catch((e) => h.warn('favorite item', e.message));
    await a.waitForTimeout(3000);
    let fav = null;
    for (let i = 0; i < 5; i++) {
      fav = await gql(h, 'alice', 'query { user { id favorites { entityId entityType } } }');
      if (JSON.stringify(fav.data ?? '').includes(doc.id)) break;
      await h.sleep(2000);
    }
    h.check('收藏列表含该文档', JSON.stringify(fav?.data ?? '').includes(doc.id), { status: fav?.status, errors: fav?.errors });

    await a.goto(`${h.BASE}/app/recent`, { waitUntil: 'load' }); await a.waitForTimeout(6000);
    h.check('“最近”列出该文档', /\/app\/recent/.test(a.url()) && (await h.text(a)).includes(title), a.url());
    await h.shot(a, 'recent');
  },
};
