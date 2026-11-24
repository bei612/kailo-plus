// Leave the deployment as found for the next run: routines deleted, Agent and Workspace limits cleared, open
// approval requests of this run withdrawn, the documents and tasks the Agents made in steps 30 and 32 deleted, the
// personal documents step 04 made (for 90) deleted by their owners, and the round's channel (22) deleted by alice, who
// made it. Channels cannot be archived (the product offers leave and delete only); a left channel would stay in W's
// content search, which ③ reads, so it is deleted.
// Accounts and the seed documents stay. Earlier runs left those documents and tasks behind, and ③'s research then
// summarized twelve copies of them instead of the seeds (2026-11-24); the screenshots and logs are the evidence.
import { findDocs } from '../lib/ui.mjs';
import { DOC_TITLE } from './30-ring3-doc.mjs';
import { TASK_TITLE } from './32-ring3-task.mjs';
import { PERSONAL_TITLE, PRIVATE_TITLE } from './04-personal-docs.mjs';
import { roundChannels } from './22-channel.mjs';

/** Every document and task whose title starts with `title` (each run adds a suffix to the document's). */
async function made(h, title, user = 'alice') {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return findDocs(h, user, new RegExp(`^${escaped}`));
}

export default {
  id: '99-cleanup',
  title: '清理：例程、额度、未决审批、Agent 建的文档与任务、本轮频道',
  covers: [],
  users: ['alice', 'bob'],
  after: ['00', '01', '02', '03', '04', '05', '10', '20', '21', '22', '30', '31', '32', '40', '50', '51', '60', '70', '80', '81', '82', '83', '84', '90'],
  locks: { 'ws:alice': 's', 'ws:bob': 's', chan: 'x', approvals: 'x', 'agent:tg-research': 'x' },
  est: 60,
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
    for (const [user, title] of [['alice', DOC_TITLE], ['alice', TASK_TITLE], ['alice', PRIVATE_TITLE], ['bob', PERSONAL_TITLE]]) {
      const ids = new Set((await made(h, title, user)).map((d) => d.id));
      if (title === PRIVATE_TITLE && h.S.privateDoc) ids.add(h.S.privateDoc);
      if (title === PERSONAL_TITLE && h.S.bobPersonalDoc) ids.add(h.S.bobPersonalDoc);
      for (const id of ids) {
        const r = await h.api(user, 'DELETE', `/dss/documents/${id}`);
        h.log('delete', title, id, r.status);
      }
      const left = await made(h, title, user);
      h.check(`已删除《${title}》`, left.length === 0, left.map((d) => d.id));
    }
    // The round's channel, and any an earlier round that stopped before 99 left.
    if (h.S.W) {
      const ids = new Set((await roundChannels(h)).map((c) => c.id));
      if (h.S.chanId) ids.add(h.S.chanId);
      for (const id of ids) h.log('delete channel', id, (await h.api('alice', 'DELETE', `/dss/channels/${id}`)).status);
      const left = await roundChannels(h);
      h.check('已删除本轮频道', left.length === 0, left.map((c) => c.id));
    }
    // The personal documents and the channel are gone: a later --only 90 is blocked until 04 makes new documents, and a
    // later --only 30-90 until 22 makes a new channel, instead of reading these.
    for (const k of ['privateDoc', 'privateMark', 'bobPersonalDoc', 'bobPersonalMark', 'chan', 'chanId']) delete h.S[k];
    h.check('清理完成', true);
  },
};
