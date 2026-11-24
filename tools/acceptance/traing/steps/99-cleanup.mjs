// Leave the deployment as found for the next run: routines deleted, Agent and Workspace limits cleared, open
// approval requests of this run withdrawn, and the documents and tasks the Agents made in steps 30 and 32 deleted.
// Accounts and the seed documents stay. Earlier runs left those documents and tasks behind, and ③'s research then
// summarized twelve copies of them instead of the seeds (2026-11-24); the screenshots and logs are the evidence.
import { findDocs } from '../lib/ui.mjs';
import { DOC_TITLE } from './30-ring3-doc.mjs';
import { TASK_TITLE } from './32-ring3-task.mjs';

/** Every document and task whose title starts with `title` (each run adds a suffix to the document's). */
async function made(h, title) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return findDocs(h, 'alice', new RegExp(`^${escaped}`));
}

export default {
  id: '99-cleanup',
  title: '清理：例程、额度、未决审批、Agent 建的文档与任务',
  covers: [],
  users: ['alice'],
  async run(h) {
    for (const id of h.S.routines || []) {
      const r = await h.api('alice', 'DELETE', `/scheduled-action/scheduled-actions/${id}`);
      h.check(`删除例程 ${id}`, r.status < 300 || r.status === 404, r.status);
    }
    h.S.routines = [];
    if (h.S.bots?.research) h.check('资料员额度已清除', (await h.api('alice', 'PUT', `/dss/quota/bots/${h.S.bots.research}`, { monthlyTokenLimit: null })).status < 300);
    const pend = await h.api('alice', 'GET', '/dss/approvals?inbox=mine&limit=50');
    for (const x of pend.body?.requests || pend.body?.items || []) {
      if (/WAITING/i.test(JSON.stringify(x.gateState ?? x.state ?? ''))) h.log('withdraw', x.id, (await h.api('alice', 'POST', `/dss/approvals/${x.id}/withdraw`)).status);
    }
    for (const title of [DOC_TITLE, TASK_TITLE]) {
      for (const d of await made(h, title)) {
        const r = await h.api('alice', 'DELETE', `/dss/documents/${d.id}`);
        h.log('delete', title, d.id, r.status);
      }
      h.check(`已删除 Agent 建的《${title}》`, (await made(h, title)).length === 0, (await made(h, title)).map((d) => d.id));
    }
    h.check('清理完成', true);
  },
};
