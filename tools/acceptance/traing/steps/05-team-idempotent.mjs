// TE-11: retrying one intended Workspace creation (same request_id) yields one team; the answer may carry
// kailo-authz-pending instead of a 503. Done as dave, whose current Workspace is put back afterwards.
import { uuid7, deepFind, UUID_RE } from '../lib/util.mjs';
import { setCurrent, workspaces } from '../lib/ui.mjs';

export default {
  id: '05-team-idempotent',
  title: '建团队重试幂等：同一 request_id 只产生一个团队（TE-11）',
  covers: ['TE-11'],
  users: ['dave'],
  async run(h) {
    const before = await workspaces(h, 'dave');
    const cur = before.find((w) => w.current)?.id;
    const name = `TG 幂等校验 ${Date.now().toString(36)}`;
    const body = { name, allow_domain_join: false, request_id: uuid7() };
    const r1 = await h.api('dave', 'POST', '/auth/team', body);
    const r2 = await h.api('dave', 'POST', '/auth/team', body);
    const r3 = await h.api('dave', 'POST', '/auth/team', body);
    const id = (r) => deepFind(r.body, (o) => typeof o.id === 'string' && UUID_RE.test(o.id))[0]?.id;
    h.log('answers', [r1, r2, r3].map((r) => [r.status, r.headers['kailo-authz-pending'] ?? '-', id(r)]));
    h.check('三次请求都成功（无 503）', [r1, r2, r3].every((r) => r.status >= 200 && r.status < 300), [r1.status, r2.status, r3.status]);
    h.check('三次返回同一团队 id', id(r1) && id(r1) === id(r2) && id(r2) === id(r3), [id(r1), id(r2), id(r3)]);
    const after = await workspaces(h, 'dave');
    const same = after.filter((w) => w.name === name);
    h.check('工作区列表里该名称恰好一个', same.length === 1, same.map((w) => w.id));
    if (cur) await setCurrent(h, 'dave', cur);
    await h.jsonShot('dave', '/auth/team/workspaces', 'dave-workspaces-after-retry');
  },
};
