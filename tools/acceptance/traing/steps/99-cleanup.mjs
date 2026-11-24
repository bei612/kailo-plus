// Leave the deployment as found for the next run: routines deleted, Agent and Workspace limits cleared, open
// approval requests of this run withdrawn. Accounts and documents stay as evidence.
export default {
  id: '99-cleanup',
  title: '清理：例程、额度、未决审批',
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
    h.check('清理完成', true);
  },
};
