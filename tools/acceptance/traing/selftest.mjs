// Dry-run of the suite without the stack: the pure helpers, the harness bookkeeping (checks, results, 0600 state, one
// scope per concurrent step), the UI helpers against a stubbed session, the zh-CN label patterns against the train-g
// zh-Hans strings, the step modules (ids, titles, covers, order), the scheduler (locks, order, stop-on-fail) and the
// step graph (no cycles, every state read has an earlier producer, the locks each step's source needs are declared).
// usage: node selftest.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as U from './lib/util.mjs';
import { createHarness, loadConfig } from './lib/harness.mjs';
import * as UI from './lib/ui.mjs';
import { loadSteps } from './run-all.mjs';
import * as SCH from './lib/schedule.mjs';

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
  assert.ok(U.FAILURE_RE.test('资料员 还不是本频道的成员，无法在这里回复。（NO_PERMISSION）'));
  assert.ok(!U.FAILURE_RE.test('读取正文被拒（HTTP 403），原因码 NO_PERMISSION_INITIATOR，我不再尝试绕过。'));
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
await t('parseArgs: --serial, --concurrency, --plan; pickRow', () => {
  const a = U.parseArgs(['--serial', '--concurrency', '3', '--plan']);
  assert.ok(a.serial && a.plan); assert.equal(a.concurrency, 3);
  assert.equal(U.parseArgs([]).concurrency, 4);
  assert.equal(U.parseArgs([], { ACC_CONCURRENCY: '6' }).concurrency, 6);
  assert.throws(() => U.parseArgs(['--concurrency', '0']));
  const rows = ['安林 讨论', '安林 @文档助理 请新建 〔验收 r·doc·a1〕 文档助理 已创建', '安林 @资料员 〔验收 r·research·b2〕'];
  assert.equal(U.pickRow(rows, '〔验收 r·doc·a1〕'), rows[1]);
  assert.equal(U.pickRow(rows, '〔验收 r·x·zz〕'), null);
});

await t('harness: a scope per concurrent step (own record, shared run state)', async () => {
  const x = h.fork(); const y = h.fork();
  assert.equal(x.S, h.S); assert.equal(y.acc, h.acc); assert.equal(x.locks, h.locks);
  x._begin({ id: 'p', title: 'P' }); y._begin({ id: 'q', title: 'Q' });
  x.check('x one', true); y.check('y one', false); x.S.fromX = 1;
  const rx = await x._end(); const ry = await y._end();
  assert.deepEqual(rx.checks.map((c) => c.name), ['x one']); assert.equal(rx.status, 'pass');
  assert.deepEqual(ry.checks.map((c) => c.name), ['y one']); assert.equal(ry.status, 'fail');
  assert.equal(h.S.fromX, 1); delete h.S.fromX;
  // A section lock is the step's own: re-entrant inside its declared lock, waits for another step's.
  h.locks.tryAll('p', [['agent:tg-task', 'x']]);
  x._begin({ id: 'p', title: 'P' }); y._begin({ id: 'q', title: 'Q' });
  let inside = false; await x.exclusive('agent:tg-task', async () => { inside = true; });
  assert.ok(inside);
  let yRan = false; const yp = y.exclusive('agent:tg-task', async () => { yRan = true; });
  await new Promise((r) => setImmediate(r)); assert.ok(!yRan);
  x.unlock('agent:tg-task'); await yp; assert.ok(yRan);
  x.check('c', true); y.check('c', true); await x._end(); await y._end();
});

await t('readAfter: parallel reads the thread of the message only; serial the page', async () => {
  const marker = '〔验收 r·doc·a1〕';
  const page = (rows) => ({ locator: () => ({ evaluateAll: async () => rows }) });
  const body = `安林 @文档助理 请新建 ${marker} 文档助理 已创建 安林 @资料员 额度验收：请只用一句中文回复“收到”。`;
  const stub = (parallel) => ({ parallel, text: async () => body });
  let r = await UI.readAfter(stub(false), page([]), marker);
  assert.ok(r.scoped); assert.match(r.after, /收到/);
  r = await UI.readAfter(stub(true), page(['别的话题', `安林 @文档助理 请新建 ${marker}\n\n文档助理 已创建`]), marker);
  assert.ok(r.scoped); assert.equal(r.after.trim(), '文档助理 已创建');
  r = await UI.readAfter(stub(true), page([]), marker);
  assert.ok(!r.scoped);
});

await t('Locks: shared/exclusive, re-entrant, all-or-nothing, FIFO waiters block new holders', async () => {
  const L = new SCH.Locks();
  assert.ok(L.tryAll('a', [['r', 's'], ['q', 'x']]));
  assert.ok(L.tryAll('b', [['r', 's']]));
  assert.ok(!L.tryAll('c', [['r', 'x']]));
  assert.ok(!L.tryAll('c', [['z', 's'], ['q', 's']])); assert.equal(L.holders('z').s.length, 0); // nothing taken
  assert.ok(L.tryAll('a', [['q', 'x']])); // re-entrant
  let got = false; const w = L.acquire('c', 'r', 'x').then(() => { got = true; });
  assert.ok(!L.tryAll('d', [['r', 's']])); // a waiting exclusive keeps new shared holders out
  L.releaseAll('a'); await new Promise((r) => setImmediate(r)); assert.ok(!got);
  L.releaseAll('b'); await w; assert.ok(got);
  assert.equal(L.holders('r').x, 'c');
  L.release('c', 'r', 'x'); assert.ok(L.tryAll('d', [['r', 's']]));
  // A sole shared holder may upgrade.
  assert.ok(L.tryAll('d', [['r', 'x']]));
});

const fake = (id, extra = {}) => ({ id, title: id, est: 60, after: [], locks: {}, run() {}, ...extra });
await t('runSchedule: dependencies, locks, limit; serial is file order; stop-on-fail; unschedulable', async () => {
  const st = [fake('00-a', { est: 10 }), fake('10-b', { after: ['00'], locks: { k: 'x' } }), fake('20-c', { after: ['00'], locks: { k: 's' } }),
    fake('30-d', { after: ['00'] }), fake('40-e', { after: ['00'] }), fake('50-f', { after: ['10', '20'], est: 5 })];
  const par = await SCH.simulate(st, { limit: 2 });
  const at = Object.fromEntries(par.rows.map((r) => [r.id, r]));
  for (const s of st) for (const d of SCH.buildGraph(st).deps.get(s.id)) assert.ok(at[s.id].start >= at[d].end, `${s.id} after ${d}`);
  assert.ok(at['10-b'].end <= at['20-c'].start || at['20-c'].end <= at['10-b'].start, 'k is exclusive');
  for (const r of par.rows) assert.ok(par.rows.filter((o) => o.start <= r.start && o.end > r.start).length <= 2, 'limit 2');
  const ser = await SCH.simulate(st, { serial: true });
  assert.deepEqual(ser.rows.map((r) => r.id), st.map((s) => s.id)); assert.equal(ser.total, 10 + 60 * 4 + 5);
  const seen = [];
  const res = await SCH.runSchedule(st, { limit: 3, stopOnFail: true, run: async (s) => { seen.push(s.id); return { id: s.id, status: s.id === '00-a' ? 'fail' : 'pass' }; } });
  assert.deepEqual(seen, ['00-a']); assert.ok([...res.values()].slice(1).every((r) => r.status === 'skipped'));
  const L = new SCH.Locks(); L.tryAll('outsider', [['k', 'x']]);
  const res2 = await SCH.runSchedule([fake('10-b', { locks: { k: 'x' } })], { locks: L, run: async () => ({ status: 'pass' }) });
  assert.equal(res2.get('10-b').status, 'error');
  assert.throws(() => SCH.buildGraph([fake('10-a', { after: ['20'] }), fake('20-b', { after: ['10'] })]), /cycle/);
  assert.throws(() => SCH.buildGraph([fake('10-a', { after: ['77'] })]), /names no step/);
  // A selection drops dependencies on steps outside it (their state is from an earlier run).
  assert.deepEqual(SCH.buildGraph([st[5]], st).deps.get('50-f'), []);
});

// The step graph, checked against each step's own source.
const SRC = path.dirname(new URL(import.meta.url).pathname);
const steps = await loadSteps();
const src = Object.fromEntries(steps.map((s) => [s.id, fs.readFileSync(path.join(SRC, 'steps', s.file), 'utf8')]));
const graph = SCH.buildGraph(steps);
const ancestors = (id, out = new Set()) => { for (const d of graph.deps.get(id)) if (!out.has(d)) { out.add(d); ancestors(d, out); } return out; };
const HANDLE = { doc: 'tg-doc', research: 'tg-research', task: 'tg-task', kailo: 'kailo' };
await t('step graph: declared, backwards, acyclic, resources known', () => {
  for (const s of steps) {
    assert.ok(Array.isArray(s.after), `${s.id} after`); assert.ok(Number(s.est) > 0, `${s.id} est`);
    assert.ok(s.locks && typeof s.locks === 'object', `${s.id} locks`);
    for (const [r, m] of Object.entries(s.locks)) { assert.ok(r in SCH.RESOURCES, `${s.id} lock ${r} unknown`); assert.ok(['s', 'x'].includes(m), `${s.id} ${r} mode ${m}`); }
    for (const r of Object.keys(s.release || {})) assert.ok(s.locks[r], `${s.id} releases ${r} it does not hold`);
    for (const ref of s.after) assert.ok(graph.index.get(SCH.resolveStep(steps, ref).id) < graph.index.get(s.id), `${s.id} after ${ref}: not earlier in file order (--serial would break)`);
  }
  const last = steps.at(-1);
  assert.equal(last.id, '99-cleanup');
  assert.equal(ancestors(last.id).size, steps.length - 1, '99-cleanup after every other step');
});
await t('step graph: every run-state read has a producer among its predecessors', () => {
  const sets = {}; const reads = {};
  for (const s of steps) {
    const code = src[s.id];
    for (const m of code.matchAll(/h\.S\.(\w+)\s*(=(?!=)|\|\|=)/g)) (sets[m[1]] ||= new Set()).add(s.id);
    reads[s.id] = new Set([...code.matchAll(/h\.S\.(\w+)/g)].map((m) => m[1]));
    for (const m of code.matchAll(/h\.need\(([^)]*)\)/g)) for (const k of m[1].matchAll(/'([\w.]+)'/g)) reads[s.id].add(k[1].split('.')[0]);
  }
  for (const s of steps) {
    const anc = ancestors(s.id);
    for (const k of reads[s.id]) {
      const prod = [...(sets[k] || [])];
      assert.ok(prod.length, `${s.id} reads h.S.${k}, which no step sets`);
      const earlier = prod.filter((p) => p !== s.id && graph.index.get(p) < graph.index.get(s.id));
      if (!prod.includes(s.id)) assert.ok(earlier.length, `${s.id} reads h.S.${k}, set only by later steps ${prod}`);
      for (const p of earlier) assert.ok(anc.has(p), `${s.id} reads h.S.${k} from ${p} but does not come after it`);
    }
  }
});
await t('step graph: the locks a step source needs are declared', () => {
  const dyn = {};
  for (const s of steps) {
    const code = src[s.id]; const L = s.locks; const users = s.users || [];
    const x = (r) => L[r] === 'x' || code.includes(`h.exclusive('${r}'`);
    for (const u of users) assert.ok(L[`ws:${u}`], `${s.id} uses ${u}: ws:${u} not declared`);
    for (const m of code.matchAll(/setCurrent\(h, ('(\w+)'|\w+), ([^)]+)\)/g)) {
      if (m[3].trim() === 'h.S.W') continue; // back to W: what every step sharing ws:<user> relies on
      for (const u of m[2] ? [m[2]] : users) assert.ok(x(`ws:${u}`), `${s.id} switches ${u}'s Workspace: ws:${u} must be exclusive`);
    }
    if (/switchTo\(/.test(code)) for (const u of users) assert.ok(x(`ws:${u}`), `${s.id} switches Workspaces in the UI`);
    if (/'(PATCH|POST)', '\/auth\/team'/.test(code)) for (const u of users) assert.ok(x(`ws:${u}`), `${s.id} creates or renames a team`);
    for (const m of code.matchAll(/\bask\(h, [^,]+, [^,]+, AGENTS\.(\w+)/g)) {
      assert.equal(L[`agent:${HANDLE[m[1]]}`], 'x', `${s.id} talks to ${m[1]}: agent:${HANDLE[m[1]]} must be declared exclusive`);
      assert.ok(L.chan && L['quota:W'], `${s.id} asks an Agent: chan and quota:W needed`);
    }
    if (/\b(say|inviteBots)\(/.test(code)) assert.equal(L.chan, 'x', `${s.id} sets up the channel: chan exclusive`);
    if (/waitChannel\(/.test(code)) assert.ok(L.chan, `${s.id} reads the channel`);
    if (/'PUT', `\/dss\/quota\/bots\/\$\{B\}`|quota\/bots\/\$\{h\.S\.bots\.research\}/.test(code)) assert.equal(L['agent:tg-research'], 'x', `${s.id} caps @资料员`);
    if (/'alice', 'PUT', `\/dss\/quota\/teams\/\$\{h\.S\.W\}`/.test(code)) assert.equal(L['quota:W'], 'x', `${s.id} sets W's quota`);
    if (/\/dss\/approvals|\/dss\/audit\/exports'/.test(code)) assert.equal(L.approvals, 'x', `${s.id} uses the approval inbox`);
    if (/'(POST|DELETE)', '\/dss\/platform\/roles'/.test(code)) assert.equal(L['platform-roles'], 'x', `${s.id} grants platform roles`);
    for (const m of code.matchAll(/h\.unlock\('([^']+)'\)/g)) assert.ok(L[m[1]] && s.release?.[m[1]], `${s.id} unlocks ${m[1]}: declare it in locks and release`);
    for (const m of code.matchAll(/h\.exclusive\('([^']+)'/g)) {
      assert.notEqual(L[m[1]], 'x', `${s.id}: section on ${m[1]} it already holds exclusively`);
      // Two steps upgrading one shared resource in sections could wait for each other.
      assert.ok(!dyn[m[1]] || dyn[m[1]] === s.id, `${m[1]} taken in sections by ${dyn[m[1]]} and ${s.id}`); dyn[m[1]] = s.id;
    }
  }
});
await t('the round on paper: dependencies and exclusive locks respected, shorter than serial', async () => {
  const par = await SCH.simulate(steps, { limit: 4 });
  const ser = await SCH.simulate(steps, { serial: true });
  const at = Object.fromEntries(par.rows.map((r) => [r.id, r]));
  assert.equal(par.rows.length, steps.length);
  for (const s of steps) for (const d of graph.deps.get(s.id)) assert.ok(at[s.id].start >= at[d].end, `${s.id} before ${d} ended`);
  const held = (s, r) => [at[s.id].start, at[s.id].start + (s.release?.[r] ?? Number(s.est))];
  for (const a of steps) for (const b of steps) {
    if (a.id >= b.id) continue;
    for (const [r, m] of Object.entries(a.locks)) {
      const m2 = b.locks[r]; if (!m2 || (m === 's' && m2 === 's')) continue;
      const [a0, a1] = held(a, r); const [b0, b1] = held(b, r);
      assert.ok(a1 <= b0 || b1 <= a0, `${a.id} and ${b.id} overlap on ${r}`);
    }
  }
  assert.ok(par.total < ser.total * 0.6, `parallel ${par.total}s vs serial ${ser.total}s`);
  console.log(`   plan: ${Math.round(par.total / 60)} min at concurrency 4, ${Math.round(ser.total / 60)} min serial`);
});

await t('round channel identity: only alice-owned TG round channels of W qualify', async () => {
  const { isRoundChannel, roundChannelName } = await import('./steps/22-channel.mjs');
  const who = { W: 'w1', ownerId: 'macro|a', workspaceName: 'TG 团队' };
  const ok = { id: 'c1', name: roundChannelName('g1'), team_id: 'w1', channel_type: 'team', owner_id: 'macro|a', auto_join_team: false };
  assert.ok(isRoundChannel(ok, who));
  for (const bad of [{ name: 'TG 团队' }, { name: 'TG 客户回访' }, { name: 'TG 客户回访 g1 extra' }, { auto_join_team: true },
    { team_id: 'w2' }, { owner_id: 'macro|b' }, { channel_type: 'private' }]) assert.ok(!isRoundChannel({ ...ok, ...bad }, who), JSON.stringify(bad));
  assert.ok(!isRoundChannel(ok, { ...who, workspaceName: ok.name }));
  assert.ok(!isRoundChannel(ok, { ...who, ownerId: undefined }));
  assert.ok(!isRoundChannel(undefined, who));
});

await h.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`SELFTEST_OK ${n} groups`);
