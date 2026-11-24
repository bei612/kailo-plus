// Ring ③b (TE-01): two seed documents in W, then @资料员 searches and reads them and answers with a summary citing
// their titles (no empty reply).
import { AGENTS, ask, newDoc, setCurrent } from '../lib/ui.mjs';

export const SEEDS = [
  ['TG 续约风险清单', '重点客户续约风险：华东区三家客户预算收紧；两家客户对报表功能不满意，需要在 12 月前给出改进计划。'],
  ['TG 产品反馈周报 第 46 周', '本周收到 12 条反馈：导出速度慢（5 条）、移动端通知延迟（4 条）、希望支持中文日期格式（3 条）。'],
];

export default {
  id: '31-ring3-research',
  title: '环③ Agent 查资料并汇总（无空回复，TE-01）',
  covers: ['环③', 'TE-01'],
  users: ['alice'],
  async run(h) {
    h.need('chan', 'W');
    const a = h.u('alice').page;
    await setCurrent(h, 'alice', h.S.W);
    h.S.seeds = h.S.seeds || {};
    for (const [title, body] of SEEDS) {
      if (h.S.seeds[title]) continue;
      const d = await newDoc(h, a, title, body);
      h.S.seeds[title] = d.id;
    }
    await h.shot(a, 'seed-doc');
    h.check('两篇种子文档已建', Object.keys(h.S.seeds).length === 2 && Object.values(h.S.seeds).every(Boolean), h.S.seeds);
    await h.sleep(20000); // let search indexing catch up
    const r = await ask(h, 'alice', h.S.chan, AGENTS.research,
      '请查一下工作区里和客户续约、产品反馈相关的文档和任务，读完后给我一段汇总，并列出你引用的文档标题。',
      'research', /(续约|反馈)[\s\S]*(汇总|风险|周报)/);
    h.check('资料员给出非空回复', r.answered, r.after.slice(0, 300));
    h.check('回复无失败', r.ok, r.after.slice(0, 300));
    h.check('汇总引用了种子文档', /续约风险清单|产品反馈周报/.test(r.after), r.after.slice(0, 400));
  },
};
