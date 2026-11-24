// Ring ⑦ (TE-05): @Kailo edits the Agent-made document twice in the same conversation (the second edit hit
// CONTEXT_EXHAUSTED in train e); both edits land. The document's graph shows the related entities.
import { AGENTS, ask, docText } from '../lib/ui.mjs';
import { DOC_TITLE } from './30-ring3-doc.mjs';

export default {
  id: '70-ring7-doc-edit',
  title: '环⑦ @Kailo 两次修改文档均成功（TE-05），关系图可见',
  covers: ['环⑦', 'TE-05', 'TE-06'],
  users: ['alice'],
  after: ['30'],
  locks: { 'ws:alice': 's', chan: 's', 'quota:W': 's', 'agent:kailo': 'x' },
  est: 600,
  async run(h) {
    h.need('roundChannel', 'chan', 'docId');
    const r1 = await ask(h, 'alice', h.S.chan, AGENTS.kailo, `请在文档《${h.S.docTitle ?? DOC_TITLE}》末尾追加一节“风险与应对”，写两条风险和对应措施，完成后回复。`, 'edit-1', /风险|已追加|已更新/, 400);
    h.check('第一次修改回合成功', r1.ok, r1.after.slice(0, 300));
    const t1 = await docText(h, 'alice', h.S.docId);
    h.check('文档含“风险与应对”', /风险与应对/.test(t1.text), t1.status);
    const r2 = await ask(h, 'alice', h.S.chan, AGENTS.kailo, `请再次修改文档《${h.S.docTitle ?? DOC_TITLE}》：把第二轮上门拜访时间改为 12 月 16 日—21 日，并在文末加一行“更新：第二轮时间已调整”。完成后回复。`, 'edit-2', /已更新|已修改|已调整|16/, 400);
    h.check('第二次修改回合成功（无 CONTEXT_EXHAUSTED）', r2.ok, r2.after.slice(0, 300));
    const t2 = await docText(h, 'alice', h.S.docId);
    h.check('文档含“第二轮时间已调整”', /第二轮时间已调整/.test(t2.text), t2.text.slice(-200));
    h.check('第一次修改仍在', /风险与应对/.test(t2.text));
    const a = h.u('alice').page;
    await a.goto(`${h.BASE}/app/drive/md/${h.S.docId}`, { waitUntil: 'load' }); await a.waitForTimeout(8000);
    await h.shot(a, 'doc-after-two-edits', { fullPage: true });
    await a.goto(`${h.BASE}/app/graph/document/${h.S.docId}`, { waitUntil: 'load' }); await a.waitForTimeout(10000);
    await h.shot(a, 'doc-graph');
    const g = await h.text(a);
    h.check('关系图页可打开', !/无法加载|出错|not found/i.test(g.slice(0, 400)), g.slice(0, 200));
  },
};
