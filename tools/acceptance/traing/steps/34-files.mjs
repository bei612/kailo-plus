// FILE-02 and DOC-03: files uploaded in 云盘 open in their viewers. alice uploads, through Drive's 新建 → 上传文件 (the
// file chooser, drive-create-menu.tsx), an image, a PDF and a code file; each upload completes (location_v3 ready, as
// the deploy's upload smoke checks), opens on its own route, and renders: the image loaded (block-image), the PDF's
// first page drawn (block-pdf .pdfViewer .page canvas), the code in the editor (block-code CodeMirror .cm-content).
// What Kailo does not deploy is not asserted here: image variants (image_optimizer) and DOCX/legacy Office
// conversion (convert_service, docx_unzip_handler); 35 covers text extraction.
import { pdfBytes, pngBytes, token, track, uploadInDrive, uploadReady } from '../lib/collab.mjs';

export default {
  id: '34-files',
  title: '云盘上传：图片、PDF、代码文件的查看与预览（FILE-02、DOC-03）',
  covers: ['FILE-02', 'DOC-03'],
  users: ['alice'],
  after: ['03'],
  locks: { 'ws:alice': 's' },
  est: 240,
  async run(h) {
    h.need('W');
    const tk = token('TGF');
    const a = h.u('alice').page;
    h.S.files = {};
    const files = [
      ['image', { name: `工位平面图-${tk}.png`, mimeType: 'image/png', buffer: pngBytes(320, 200) }],
      ['pdf', { name: `采购报告-${tk}.pdf`, mimeType: 'application/pdf', buffer: pdfBytes(`Kailo purchase report ${tk}`) }],
      ['code', { name: `purchase_${tk}.py`, mimeType: 'text/x-python', buffer: Buffer.from(`# 采购清单导出 ${tk}\nprint("purchase ${tk}")\n`, 'utf8') }],
    ];
    for (const [kind, file] of files) {
      const up = await uploadInDrive(h, 'alice', file);
      track(h, 'doc', up.id);
      h.check(`上传${kind}文件并打开`, !!up.id, up.url);
      if (!up.id) continue;
      h.S.files[kind] = { id: up.id, token: tk };
      h.saveState();
      const ready = await uploadReady(h, 'alice', up.id);
      h.check(`${kind} 上传完成（内容就绪）`, ready.ok, ready.last);
      await a.goto(`${h.BASE}/app/drive/${up.type || kind}/${up.id}`, { waitUntil: 'load' }); await a.waitForTimeout(7000);
      if (kind === 'image') {
        let loaded = false;
        for (let i = 0; i < 6 && !loaded; i++) {
          loaded = await a.evaluate(() => [...document.images].some((i) => i.complete && i.naturalWidth >= 300 && i.naturalHeight >= 190)).catch(() => false);
          if (!loaded) await a.waitForTimeout(2000);
        }
        h.check('图片已显示（原图尺寸加载完成）', loaded);
        h.check('图片路由为 image', up.type === 'image', up.type);
      } else if (kind === 'pdf') {
        const page = a.locator('.pdfViewer .page canvas').first();
        h.check('PDF 首页已渲染', await page.waitFor({ state: 'visible', timeout: 30000 }).then(() => true, () => false));
      } else {
        const cm = a.locator('.cm-content').first();
        const shown = await cm.waitFor({ state: 'visible', timeout: 20000 }).then(() => true, () => false);
        h.check('代码文件在编辑器中显示内容', shown && (await cm.innerText()).includes(tk), up.type);
      }
      await h.shot(a, `${kind}-view`);
    }
  },
};
