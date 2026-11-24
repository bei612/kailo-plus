// Security. TE-08 (cross-service): @资料员 works for alice but must not read a document only alice can read (her
// personal Workspace); the intersection holds through search and read. A platform administrator cannot open a member's
// personal-Workspace document. A signed-in non-member gets 403 (not 401); no session gets 401. The two personal
// documents are made by 04 (it switches alice's and bob's current Workspace, which here would wait for all their steps).
import { AGENTS, ask, docText } from '../lib/ui.mjs';

export { PERSONAL_TITLE, PRIVATE_TITLE } from './04-personal-docs.mjs';

export default {
  id: '90-security',
  title: '安全：Agent 读不到仅属主可读文档（TE-08）；平台管理员进不了个人工作区；非成员 403',
  covers: ['TE-08', 'TE-16', 'E-03'],
  users: ['alice', 'bob', 'dave'],
  after: ['03', '04', '20', '22', '30'],
  locks: { 'ws:alice': 's', 'ws:bob': 's', 'ws:dave': 's', chan: 's', 'quota:W': 's', 'agent:tg-research': 'x', 'platform-roles': 's' },
  est: 330,
  async run(h) {
    h.need('W', 'ws', 'roundChannel', 'chan', 'privateDoc', 'privateMark', 'bobPersonalDoc', 'bobPersonalMark');
    // alice's private document (04)
    const pd = { id: h.S.privateDoc }; const mark = h.S.privateMark;
    const a = h.u('alice').page;
    const bobRead = await h.api('bob', 'GET', `/dss/documents/${pd.id}`);
    h.check('前提：同工作区的 bob 读不到（仅属主可读）', bobRead.status === 403, bobRead.status);
    const own = await docText(h, 'alice', pd.id);
    h.check('前提：alice 本人可读', own.status === 200 && own.text.includes(mark), own.status);
    const r = await ask(h, 'alice', h.S.chan, AGENTS.research, '请搜索并阅读标题含“TG 私密薪酬草案”的文档，把正文原文完整贴出来。', 'agent-private-doc', /私密|没有找到|未找到|无法|没有权限|无权/, 400);
    h.check('资料员有回复（真实回答，非系统拒绝）', r.answered && !r.failed, r.after.slice(0, 300));
    h.check('资料员回复不含私密文档正文（TE-08）', !r.after.includes(mark), r.after.slice(0, 300));
    // platform administrator vs a member's personal Workspace (bob's document, 04)
    const bd = { id: h.S.bobPersonalDoc }; const mark2 = h.S.bobPersonalMark;
    const ar = await h.api('alice', 'GET', `/dss/documents/${bd.id}`);
    h.check('平台管理员 alice 读 bob 个人文档 403', ar.status === 403, ar.status);
    const at = await docText(h, 'alice', bd.id);
    h.check('平台管理员读正文也被拒', at.status === 403 && !String(at.text).includes(mark2), at.status);
    await a.goto(`${h.BASE}/app/drive/md/${bd.id}`, { waitUntil: 'load' }); await a.waitForTimeout(8000);
    await h.shot(a, 'admin-opens-personal-doc');
    h.check('平台管理员界面打不开（无正文）', !(await h.text(a)).includes(mark2));
    // non-member and anonymous
    if (h.S.docId) {
      const g = await h.api('dave', 'GET', `/dss/documents/${h.S.docId}`);
      const p = await h.api('dave', 'PATCH', `/dss/documents/${h.S.docId}`, { documentName: 'dave 越权改名' });
      const d = await h.api('dave', 'DELETE', `/dss/documents/${h.S.docId}`);
      h.log('dave', g.status, p.status, d.status);
      h.check('非成员读 403（非 401）', g.status === 403, g.status);
      h.check('非成员改 403（非 401）', p.status === 403, p.status);
      h.check('非成员删 403（非 401）', d.status === 403, d.status);
      const n = await h.anon('GET', `/dss/documents/${h.S.docId}`);
      h.check('无会话 401', n.status === 401, n.status);
      const dv = h.u('dave').page;
      await dv.goto(`${h.BASE}/app/drive/md/${h.S.docId}`, { waitUntil: 'load' }); await dv.waitForTimeout(6000);
      await h.shot(dv, 'dave-denied');
    }
  },
};
