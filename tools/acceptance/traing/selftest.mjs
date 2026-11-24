// Dry-run of the suite without the stack: the pure helpers, the harness bookkeeping (checks, results, 0600 state),
// the UI helpers against a stubbed session, the zh-CN label patterns against the train-g zh-Hans strings, and the
// step modules (ids, titles, covers, order). usage: node selftest.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as U from './lib/util.mjs';
import { createHarness, loadConfig } from './lib/harness.mjs';
import * as UI from './lib/ui.mjs';
import { loadSteps } from './run-all.mjs';

let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };

await t('uuid7 format and time order', () => {
  const a = U.uuid7(1000), b = U.uuid7(2000);
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.ok(a.slice(0, 13) < b.slice(0, 13));
});
await t('deepFind / findByTitle', () => {
  const body = { data: { documents: [{ id: 'd1', documentName: 'TG 12 月客户回访方案' }, { id: 'd2', name: '别的' }], nested: [{ x: { document_id: 'd3', title: 'TG 12 月客户回访方案（副本）' } }] } };
  const f = U.findByTitle(body, /TG 12 月客户回访方案/);
  assert.deepEqual(f.map((x) => x.id), ['d1', 'd3']);
  assert.equal(U.deepFind(body, (o) => o.id === 'd2').length, 1);
});
await t('englishLeaks whole phrases only', () => {
  assert.deepEqual(U.englishLeaks('添加 Agent · Add agent · 在 Kailo Codex 中', ['Add agent', 'Codex agent']), ['Add agent']);
  assert.deepEqual(U.englishLeaks('Routines 例程', ['Routine']), []);
  assert.deepEqual(U.englishLeaks('例程\nRoutine name', ['Routine name']), ['Routine name']);
});
await t('afterMessage / hasAnswer / FAILURE_RE', () => {
  const page = '安林 请新建文档 文档助理 已创建《TG 12 月客户回访方案》，包含目标与两轮安排。';
  const after = U.afterMessage(page, '请新建文档');
  assert.ok(U.hasAnswer(after, '文档助理'));
  assert.ok(!U.hasAnswer(' 文档助理 思考中…', '文档助理'));
  assert.ok(U.FAILURE_RE.test('回合没有完成：CONTEXT_EXHAUSTED'));
  assert.ok(!U.FAILURE_RE.test('已创建任务'));
});
await t('parseArgs / selectSteps', async () => {
  const a = U.parseArgs(['--only', '30,40-ring4-card', '--stop-on-fail']);
  assert.deepEqual(a.only, ['30', '40-ring4-card']); assert.ok(a.stopOnFail);
  assert.throws(() => U.parseArgs(['--bogus']));
  const steps = await loadSteps();
  assert.deepEqual(U.selectSteps(steps, a).map((s) => s.id), ['30-ring3-doc', '40-ring4-card']);
  const r = U.selectSteps(steps, U.parseArgs(['--from', '80', '--to', '82', '--skip', '81']));
  assert.deepEqual(r.map((s) => s.id), ['80-gov-approvals', '82-gov-quota']);
});
await t('minuteAhead lands on a whole minute ahead', () => {
  const now = Date.parse('2026-11-22T03:07:31.200Z');
  const m = U.minuteAhead(6 * 60000, now);
  assert.equal(m.iso, '2026-11-22T03:14:00.000Z'); assert.equal(m.hhmm, '03:14');
  assert.equal(U.minuteAhead(60000, Date.parse('2026-11-22T03:07:00.000Z')).hhmm, '03:08');
});
await t('redact and brief', () => {
  assert.equal(U.redact('pw hunter2secret here', ['hunter2secret']), 'pw *** here');
  assert.match(U.redact('{"password":"abc"}'), /"password":"\*\*\*"/);
  assert.equal(U.brief({ a: 'x  y' }), '{"a":"x y"}');
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'traing-selftest-'));
await t('writeSecretJson is 0600, state dir 0700', () => {
  const f = path.join(tmp, 'state', 'x.json');
  U.writeSecretJson(f, { a: 1 });
  assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  assert.deepEqual(U.readJson(f), { a: 1 });
});
await t('loadConfig defaults and overrides', () => {
  const c = loadConfig({ SUITE_DIR: tmp, RUN_ID: 'r1', KAILO_URL: 'https://example.test/' });
  assert.equal(c.base, 'https://example.test'); assert.equal(c.resultsDir, path.join(tmp, 'results', 'r1'));
  assert.equal(c.locale, 'zh-CN');
});
const cfg = loadConfig({ SUITE_DIR: tmp, RUN_ID: 'r1', KAILO_URL: 'https://example.test' });
const h = await createHarness(cfg);
await t('harness bookkeeping: pass, fail, blocked, error', async () => {
  h._begin({ id: 'a', title: 'A' }); h.check('one', true); let r = await h._end(); assert.equal(r.status, 'pass');
  h._begin({ id: 'b', title: 'B' }); h.check('one', true); h.check('two', false, { why: 1 }); r = await h._end();
  assert.equal(r.status, 'fail'); assert.deepEqual(r.failed, ['two']);
  h._begin({ id: 'c', title: 'C' }); r = await h._end(); assert.equal(r.status, 'fail'); assert.match(r.error, /no checks/);
  h._begin({ id: 'd', title: 'D' });
  try { h.need('chan'); assert.fail('need should throw'); } catch (e) { assert.equal(e.name, 'Blocked'); r = await h._end('blocked', e); }
  assert.equal(r.status, 'blocked');
  h.S.chan = 'x'; h.S.bots = { research: 'b1' }; h.need('chan', 'bots.research');
  h.saveState();
  assert.equal(fs.statSync(path.join(tmp, 'state', 'run.json')).mode & 0o777, 0o600);
});
await t('harness api through a stubbed session; UI helpers parse answers', async () => {
  const calls = [];
  const answers = {
    '/auth/team/workspaces': [{ id: 'w1', name: 'TG 安林团队', kind: 'team', role: 'owner', current: true }, { id: 'p1', name: '个人', kind: 'personal', role: 'owner' }],
    '/dss/documents?limit=200': { error: false, data: { documents: [{ id: 'd1', documentName: 'TG 续约风险清单' }] } },
    '/dss/documents/list': { data: [{ id: 'd1', name: 'TG 续约风险清单' }, { id: 'd9', name: 'TG 续约风险清单 2' }] },
  };
  h.users.alice = { name: 'alice', pageErrors: [], save: async () => {}, ctx: { request: { fetch: async (url, init) => {
    const p = url.replace(cfg.base, '');
    calls.push([init.method, p, init.data]);
    const body = p.startsWith('/dss/audit/events') ? { events: [{ actorId: 'bot|b1', decision: 'DENY' }] } : answers[p] ?? { ok: true };
    return { status: () => 200, text: async () => JSON.stringify(body), headers: () => ({}) };
  } } } };
  h._begin({ id: 'e', title: 'E' });
  assert.equal((await UI.workspaces(h, 'alice')).length, 2);
  assert.equal(await UI.setCurrent(h, 'alice', 'w1'), 200);
  assert.deepEqual(calls.at(-1), ['PUT', '/auth/team/current', { team_id: 'w1' }]);
  assert.deepEqual((await UI.findDocs(h, 'alice', /TG 续约风险清单/)).map((d) => d.id), ['d1', 'd9']);
  const ev = await UI.audit(h, 'alice', { targetType: 'bot', targetId: 'b1', from: null, limit: 5 });
  assert.equal(calls.at(-1)[1], '/dss/audit/events?targetType=bot&targetId=b1&limit=5');
  assert.equal(ev.events[0].decision, 'DENY');
  h.check('stub', true); await h._end();
});
await t('zh-CN label patterns match the train-g zh-Hans strings', () => {
  const zh = { addAgent: '添加 Agent', createAgent: '创建 Agent', codex: '在 Kailo Codex 中', teamVisibility: '团队', invite: '邀请工作区成员',
    emailPh: '输入邮箱地址', addAnother: '再添加一个', sendInvite: '发送 2 个邀请', participants: '参与者', searchBots: '按名称或句柄搜索机器人',
    inviteBot: '邀请机器人', openSession: '打开会话', approve: '批准', exportEvents: '导出事件', exportSubmit: '申请导出',
    pickWorkspace: '选择工作区…', edit: '编辑', ok: '确定', save: '保存', login: '继续', join: '加入' };
  for (const [k, v] of Object.entries(zh)) assert.ok(UI.L[k].test(v), `${k} !~ ${v}`);
  assert.ok(!UI.L.addAgent.test('添加 Agent 到频道'));
  assert.equal(new Set(Object.values(UI.AGENTS).map((a) => a.handle)).size, 4);
});
await t('step modules: unique ids, titles, covers, users', async () => {
  const steps = await loadSteps();
  assert.ok(steps.length >= 20);
  assert.equal(new Set(steps.map((s) => s.id)).size, steps.length);
  for (const s of steps) {
    assert.ok(/[一-鿿]/.test(s.title), `${s.id} title in Chinese`);
    assert.ok(Array.isArray(s.covers), `${s.id} covers`);
    for (const u of s.users || []) assert.ok(['alice', 'bob', 'carol', 'dave'].includes(u), `${s.id} user ${u}`);
  }
  const covered = new Set(steps.flatMap((s) => s.covers.join(' ').match(/TE-\d+|环[①-⑦]/g) || []));
  for (const need of ['环①', '环②', '环③', '环④', '环⑤', '环⑥', '环⑦', 'TE-01', 'TE-02', 'TE-03', 'TE-04', 'TE-05', 'TE-08', 'TE-09', 'TE-11', 'TE-12', 'TE-14', 'TE-15', 'TE-16'])
    assert.ok(covered.has(need), `nothing covers ${need}`);
});
await h.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`SELFTEST_OK ${n} groups`);
