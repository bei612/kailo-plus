// Security setup for 90 (TE-08, E-03), before 20/21 so they need not wait for it: alice writes a document in her personal Workspace (only she can read it) and bob
// one in his. Made here, right after the Workspaces exist, because it switches their current Workspace: early nothing
// else of theirs runs, while in 90 the switch would have to wait for every other step of alice and bob to end. Each
// person's current Workspace is put back as it was. 90 checks who can and cannot read them.
import crypto from 'node:crypto';
import { newDoc, setCurrent, workspaces } from '../lib/ui.mjs';

export const PRIVATE_TITLE = 'TG 私密薪酬草案';
export const PERSONAL_TITLE = 'TG 周博个人笔记';

/** A document `title` with `body` in `user`'s personal Workspace; their current Workspace is restored. */
async function personalDoc(h, user, title, body) {
  const cur = (await workspaces(h, user)).find((w) => w.current)?.id;
  await setCurrent(h, user, h.S.ws[`${user}:personal`]);
  try {
    return await newDoc(h, h.u(user).page, title, body);
  } finally {
    if (cur) await setCurrent(h, user, cur);
  }
}

export default {
  id: '04-personal-docs',
  title: '安全前提：alice、bob 各在个人工作区建一篇仅本人可读的文档（由 90 验证）',
  covers: ['TE-08', 'E-03'],
  users: ['alice', 'bob'],
  after: ['03'],
  locks: { 'ws:alice': 'x', 'ws:bob': 'x' },
  est: 90,
  async run(h) {
    h.need('ws');
    const mark = `TGSECRET${crypto.randomBytes(4).toString('hex')}`;
    const pd = await personalDoc(h, 'alice', PRIVATE_TITLE, `仅本人可见。暗号 ${mark}，薪酬调整草案。`);
    h.S.privateDoc = pd.id; h.S.privateMark = mark;
    h.check('alice 建了个人工作区文档', !!pd.id, pd.url);
    const mark2 = `TGPERSONAL${crypto.randomBytes(4).toString('hex')}`;
    const bd = await personalDoc(h, 'bob', PERSONAL_TITLE, `个人笔记 ${mark2}`);
    h.S.bobPersonalDoc = bd.id; h.S.bobPersonalMark = mark2;
    h.check('bob 建了个人工作区文档', !!bd.id, bd.url);
  },
};
