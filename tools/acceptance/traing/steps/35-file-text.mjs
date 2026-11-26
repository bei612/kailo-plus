// FILE-03: the text of an uploaded file is extracted and indexed, so the file is found by what it says. The PDF 34
// uploaded carries a one-time token in its text: DSS serves its extracted text (GET /dss/documents/{id}/text-content,
// written by document_text_extractor) and search finds it by that token in its content (search_upload_handler).
// Kailo's storage-event routes to both handlers are inactive until they are deployed (kailo/worker/storageevents,
// kailo/deploy/temporal.compose.yaml), so this step stays red until they are.
import { findDocs } from '../lib/ui.mjs';

export default {
  id: '35-file-text',
  title: '上传文件的文本抽取与内容检索（FILE-03）',
  covers: ['FILE-03'],
  users: ['alice'],
  after: ['34'],
  locks: { 'ws:alice': 's' },
  est: 150,
  async run(h) {
    h.need('files.pdf');
    const { id, token: tk } = h.S.files.pdf;
    const t0 = Date.now(); let t = { status: 0, body: null };
    while (Date.now() - t0 < 120000) {
      t = await h.api('alice', 'GET', `/dss/documents/${id}/text-content`);
      if (t.status === 200 && String(t.body?.text ?? '').includes(tk)) break;
      await h.sleep(5000);
    }
    h.check('PDF 的文本已抽取（text-content 含令牌）', t.status === 200 && String(t.body?.text ?? '').includes(tk), { status: t.status, text: String(t.body?.text ?? t.body ?? '').slice(0, 160) });
    let r = null; let hit = false;
    for (let i = 0; i < 12 && !hit; i++) {
      r = await h.api('alice', 'POST', '/dss/search?page_size=20', { query: tk, match_type: 'partial', search_on: 'content' });
      hit = r.status === 200 && JSON.stringify(r.body?.results ?? []).includes(id);
      if (!hit) await h.sleep(5000);
    }
    h.check('按正文内容能搜到该 PDF', hit, { status: r?.status, results: (r?.body?.results || []).length });
    // The file itself is still found by name (FILE-01), so a red check above is about extraction, not the upload.
    h.check('PDF 仍在云盘中（按名称）', (await findDocs(h, 'alice', new RegExp(tk))).some((d) => d.id === id));
    await h.jsonShot('alice', `/dss/documents/${id}/text-content`, 'text-content');
  },
};
