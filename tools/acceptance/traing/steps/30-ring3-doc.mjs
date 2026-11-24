// Ring ③a (TE-01): @文档助理 on Codex builds a document from the discussion; a non-empty answer and the document
// exists with content.
import { AGENTS, ask, docText, findDocs } from '../lib/ui.mjs';

export const DOC_TITLE = 'TG 12 月客户回访方案';

export default {
  id: '30-ring3-doc',
  title: '环③ Agent 建文档（无空回复，TE-01）',
  covers: ['环③', 'TE-01', 'TE-03'],
  users: ['alice'],
  after: ['22'],
  locks: { 'ws:alice': 's', chan: 's', 'quota:W': 's', 'agent:tg-doc': 'x' },
  est: 300,
  async run(h) {
    h.need('roundChannel', 'chan');
    // A title of this run's own: earlier runs left documents of the base title, which made the Agent pick among
    // copies and the checks read an old one (2026-11-23).
    const title = `${DOC_TITLE}·${Date.now().toString(36).slice(-5)}`;
    h.S.docTitle = title;
    const r = await ask(h, 'alice', h.S.chan, AGENTS.doc,
      `请根据上面的讨论新建一篇文档《${title}》，写入目标、两轮回访安排、记录方式和负责人，写完在这里回复文档标题。`,
      'doc', new RegExp(`${title}|回访方案|已创建|已新建`));
    h.check('文档助理给出非空回复', r.answered, r.after.slice(0, 300));
    h.check('回复无失败/空回复', r.ok, r.after.slice(0, 300));
    let docs = [];
    for (let i = 0; i < 6 && !docs.length; i++) { docs = (await findDocs(h, 'alice', new RegExp(title))).filter((d) => d.name === undefined || d.name === title); if (!docs.length) await h.sleep(5000); }
    h.check(`文档《${title}》存在`, docs.length >= 1, docs.map((d) => d.id));
    if (!docs.length) return;
    h.S.docId = docs[0].id;
    const t = await docText(h, 'alice', h.S.docId);
    h.check('文档有正文（含回访内容）', t.status === 200 && /回访/.test(t.text) && t.text.length > 80, `${t.status} ${t.text.length}`);
    const a = h.u('alice').page;
    await a.goto(`${h.BASE}/app/drive/md/${h.S.docId}`, { waitUntil: 'load' }); await a.waitForTimeout(8000);
    await h.shot(a, 'doc-opened', { fullPage: true });
  },
};
