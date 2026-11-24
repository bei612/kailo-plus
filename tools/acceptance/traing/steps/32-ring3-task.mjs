// Ring ③c (TE-02): @任务协调 creates a task assigned to bob with a due date through the public MCP task tool.
import { AGENTS, ask, findDocs } from '../lib/ui.mjs';

export const TASK_TITLE = 'TG 整理第一轮电话回访名单';

export default {
  id: '32-ring3-task',
  title: '环③ Agent 建任务（指派、截止，TE-02）',
  covers: ['环③', 'TE-02'],
  users: ['alice', 'bob'],
  after: ['22'],
  locks: { 'ws:alice': 's', 'ws:bob': 's', chan: 's', 'quota:W': 's', 'agent:tg-task': 'x' },
  est: 240,
  async run(h) {
    h.need('roundChannel', 'chan');
    const r = await ask(h, 'alice', h.S.chan, AGENTS.task,
      `请新建一个任务《${TASK_TITLE}》，指派给周博，截止日期 12 月 1 日，描述写上要覆盖 30 家重点客户。完成后回复任务标题。`,
      'task', new RegExp(`${TASK_TITLE}|已创建|已新建|指派`));
    h.check('任务协调给出非空回复', r.answered, r.after.slice(0, 300));
    h.check('回复无失败', r.ok, r.after.slice(0, 300));
    let found = [];
    for (let i = 0; i < 6 && !found.length; i++) {
      found = [...await findDocs(h, 'alice', new RegExp(TASK_TITLE)), ...await findDocs(h, 'bob', new RegExp(TASK_TITLE))];
      if (!found.length) await h.sleep(5000);
    }
    h.check(`任务《${TASK_TITLE}》存在`, found.length >= 1, found.map((d) => d.id));
    if (found[0]) {
      h.S.taskId = found[0].id;
      h.log('task', JSON.stringify(found[0].raw).slice(0, 600));
    }
    const b = h.u('bob').page;
    await b.goto(`${h.BASE}/app/tasks`, { waitUntil: 'load' }); await b.waitForTimeout(6000);
    await h.shot(b, 'bob-tasks');
    h.check('bob 的任务列表里能看到该任务', (await h.text(b)).includes(TASK_TITLE));
  },
};
