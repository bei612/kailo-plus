// The step scheduler of the train-g suite: dependency graph, resource locks, and a runner that starts every step whose
// predecessors are done and whose locks are free, up to a concurrency limit. Pure: no browser, no network (selftest.mjs).
//
// A step module declares, next to { id, title, covers, users, run }:
//   after: ['22-channel', ...]   steps (id or numeric prefix) that must have finished first: the state it reads
//                                 (h.need / h.S.*) and the order its checks rely on. Must point backwards in file order,
//                                 so --serial (file order, one at a time) is a topological order.
//   locks: { 'ws:alice': 's', 'agent:tg-task': 'x', ... }  shared (s) or exclusive (x) resources held for the whole step
//                                 (see RESOURCES); a step may also take one for a section (h.exclusive) or drop one early
//                                 (h.unlock).
//   est:   seconds the step usually takes, for the critical-path priority and the --plan estimate.
//   release: { resource: seconds }  a declared lock the step gives up early (h.unlock) and about when; for --plan.

/** The resources a step can lock, and what holding them means. */
export const RESOURCES = {
  'ws:alice': "alice's current Workspace (x: the step switches it or renames the current team; s: it relies on it being W)",
  'ws:bob': "bob's current Workspace (as ws:alice)",
  'ws:carol': "carol's current Workspace (as ws:alice)",
  'ws:dave': "dave's current Workspace (as ws:alice)",
  chan: 'the W team channel (x: membership and the discussion are set up; s: a step posts and reads its own threads)',
  'agent:tg-doc': '@文档助理 (x: one step talks to it at a time; its turns are not interleaved)',
  'agent:tg-research': '@资料员 (x: as above; 60 caps its quota at 1 token, 99 clears it)',
  'agent:tg-task': '@任务协调 (x: as above; 51 releases it once its routines are created)',
  'agent:kailo': '@Kailo 助手 (x: as above)',
  'quota:W': "W's monthly token quota (x: 82 sets and restores it; s: the step makes Agents spend W's tokens)",
  approvals: "alice's approval inbox (x: 80 asks and decides, 99 withdraws what is pending)",
  'platform-roles': 'platform roles (x: 02 grants and revokes; s: the step relies on alice admin, bob/carol without roles)',
};

/** The step an `after` entry names (its id, or its id's numeric prefix). */
export function resolveStep(steps, ref) {
  return steps.find((s) => s.id === ref) || steps.find((s) => s.id.split('-')[0] === ref) || null;
}

/**
 * The dependency graph of `steps` (file order). Dependencies on steps outside `steps` are dropped: a selection
 * (--only / --from) relies on state an earlier run left. Throws on an unknown reference or a cycle.
 * Returns { ids, deps: Map(id -> [ids]), dependents: Map(id -> [ids]), index: Map(id -> file position) }.
 */
export function buildGraph(steps, all = steps) {
  const ids = steps.map((s) => s.id);
  const sel = new Set(ids);
  const deps = new Map(); const dependents = new Map(ids.map((id) => [id, []]));
  for (const s of steps) {
    const d = [];
    for (const ref of s.after || []) {
      const t = resolveStep(all, ref);
      if (!t) throw new Error(`${s.id}: after '${ref}' names no step`);
      if (t.id === s.id) throw new Error(`${s.id}: after itself`);
      if (sel.has(t.id) && !d.includes(t.id)) d.push(t.id);
    }
    deps.set(s.id, d);
    for (const x of d) dependents.get(x).push(s.id);
  }
  const index = new Map(ids.map((id, i) => [id, i]));
  // Cycle check (Kahn).
  const indeg = new Map(ids.map((id) => [id, deps.get(id).length]));
  const q = ids.filter((id) => indeg.get(id) === 0); let seen = 0;
  while (q.length) { const id = q.shift(); seen++; for (const n of dependents.get(id)) { indeg.set(n, indeg.get(n) - 1); if (!indeg.get(n)) q.push(n); } }
  if (seen !== ids.length) throw new Error(`dependency cycle among ${ids.filter((id) => indeg.get(id) > 0).join(', ')}`);
  return { ids, deps, dependents, index };
}

/** Longest estimated path from each step to the end of the round (seconds): the critical-path priority. */
export function priorities(steps, graph) {
  const est = new Map(steps.map((s) => [s.id, Number(s.est) || 60]));
  const memo = new Map();
  const go = (id) => {
    if (memo.has(id)) return memo.get(id);
    const v = est.get(id) + Math.max(0, ...graph.dependents.get(id).map(go));
    memo.set(id, v); return v;
  };
  for (const id of graph.ids) go(id);
  return memo;
}

/** The [resource, mode] pairs a step holds for its whole run. */
export function lockReqs(step) {
  return Object.entries(step.locks || {}).map(([r, m]) => [r, m === 'x' ? 'x' : 's']);
}

/**
 * Shared/exclusive locks by owner (a step id). Re-entrant for one owner (an exclusive holder may take the resource
 * again in either mode; a sole shared holder may upgrade). `tryAll` takes a set at once or nothing and never waits
 * (the scheduler's per-step locks); `acquire` waits in FIFO order (a section inside a running step), and while it
 * waits nobody else gets a conflicting hold through `tryAll`, so it cannot starve.
 */
export class Locks {
  constructor() { this.res = new Map(); this.waiters = []; this.onChange = () => {}; }
  _e(r) { let e = this.res.get(r); if (!e) { e = { x: null, xn: 0, s: new Map() }; this.res.set(r, e); } return e; }
  can(owner, r, m) {
    const e = this.res.get(r);
    if (!e) return true;
    if (e.x != null && e.x !== owner) return false;
    if (m === 'x') return [...e.s.keys()].every((o) => o === owner);
    return true;
  }
  _queued(owner, r, m) { return this.waiters.some((w) => w.owner !== owner && w.r === r && (w.m === 'x' || m === 'x')); }
  _take(owner, r, m) { const e = this._e(r); if (m === 'x') { e.x = owner; e.xn++; } else e.s.set(owner, (e.s.get(owner) || 0) + 1); }
  holds(owner, r, m) { const e = this.res.get(r); if (!e) return false; return e.x === owner || (m !== 'x' && e.s.has(owner)); }
  holders(r) { const e = this.res.get(r); return e ? { x: e.x, s: [...e.s.keys()] } : { x: null, s: [] }; }
  tryAll(owner, reqs) {
    if (!reqs.every(([r, m]) => this.can(owner, r, m) && !this._queued(owner, r, m))) return false;
    for (const [r, m] of reqs) this._take(owner, r, m);
    return true;
  }
  acquire(owner, r, m = 'x') {
    if (this.can(owner, r, m) && !this._queued(owner, r, m)) { this._take(owner, r, m); return Promise.resolve(); }
    return new Promise((resolve) => this.waiters.push({ owner, r, m, resolve }));
  }
  /** Drop one hold of `r` in mode `m` (default: whichever `owner` has). */
  release(owner, r, m) {
    const e = this.res.get(r); if (!e) return;
    if ((m === 'x' || (m == null && e.x === owner)) && e.x === owner) { if (--e.xn <= 0) { e.x = null; e.xn = 0; } }
    else if (e.s.has(owner)) { const n = e.s.get(owner) - 1; if (n > 0) e.s.set(owner, n); else e.s.delete(owner); }
    this._wake();
  }
  /** Drop every hold of `r` by `owner` (h.unlock), or of every resource when `r` is omitted (the step ended). */
  releaseAll(owner, r) {
    for (const [k, e] of this.res) {
      if (r != null && k !== r) continue;
      if (e.x === owner) { e.x = null; e.xn = 0; }
      e.s.delete(owner);
    }
    this._wake();
  }
  _wake() {
    for (let i = 0; i < this.waiters.length; i++) {
      const w = this.waiters[i];
      const earlier = this.waiters.slice(0, i).some((v) => v.owner !== w.owner && v.r === w.r && (v.m === 'x' || w.m === 'x'));
      if (!earlier && this.can(w.owner, w.r, w.m)) { this.waiters.splice(i, 1); i--; this._take(w.owner, w.r, w.m); w.resolve(); }
    }
    this.onChange();
  }
  async with(owner, r, m, fn) { await this.acquire(owner, r, m); try { return await fn(); } finally { this.release(owner, r, m); } }
}

/**
 * Run `steps` (already selected, file order). `run(step)` resolves to a result with a `status`. Serial (limit 1, file
 * order) is the old runner exactly. In parallel the ready step on the longest remaining path starts first; a ready step
 * whose locks are busy waits while shorter ones that fit start (no step is held back for another, so a busy resource
 * never idles the round). With `stopOnFail`, once a step ends other than pass no new step starts; the running ones
 * finish and the rest are 'skipped'. Returns Map(id -> result) in completion order; `onStart(step, running)` and
 * `onEnd(step, result)` report progress.
 */
export async function runSchedule(steps, { run, limit = 4, serial = false, stopOnFail = false, locks = new Locks(), all = steps, onStart = () => {}, onEnd = () => {} }) {
  const graph = buildGraph(steps, all);
  const prio = priorities(steps, graph);
  const byId = new Map(steps.map((s) => [s.id, s]));
  const cap = serial ? 1 : Math.max(1, limit);
  // A step taking a resource exclusively that other unstarted steps share (04 on alice's current Workspace) goes first
  // and keeps it reserved while it waits: shared holders, each started by priority, would otherwise keep it out until
  // the end of the round.
  const contendedX = (id) => lockReqs(byId.get(id)).filter(([r, m]) => m === 'x'
    && [...pending].some((o) => o !== id && lockReqs(byId.get(o)).some(([r2]) => r2 === r))).map(([r]) => r);
  const order = (a, b) => (serial ? 0 : (contendedX(b).length > 0) - (contendedX(a).length > 0) || prio.get(b) - prio.get(a))
    || graph.index.get(a) - graph.index.get(b);
  const pending = new Set(graph.ids); const running = new Map(); const done = new Map();
  let stop = false; let dirty = false; let wake = null;
  const kick = () => { dirty = true; if (wake) { const w = wake; wake = null; w(); } };
  const prevOnChange = locks.onChange; locks.onChange = () => { prevOnChange?.(); kick(); };
  const start = (id) => {
    pending.delete(id);
    const s = byId.get(id);
    onStart(s, [...running.keys()]);
    running.set(id, (async () => {
      let r;
      try { r = await run(s); } catch (e) { r = { id, title: s.title, status: 'error', error: String(e?.stack || e) }; }
      running.delete(id); done.set(id, r);
      if (stopOnFail && r.status !== 'pass') stop = true;
      onEnd(s, r);
      locks.releaseAll(id); // wakes the loop
      kick();
    })());
  };
  try {
    for (;;) {
      if (!stop) {
        const ready = [...pending].filter((id) => graph.deps.get(id).every((d) => done.has(d))).sort(order);
        const reserved = new Set();
        for (const id of ready) {
          if (running.size >= cap) break;
          // Serial keeps file order strictly: the next step waits for the one before it.
          if (serial && id !== [...pending].sort((a, b) => graph.index.get(a) - graph.index.get(b))[0]) break;
          const reqs = lockReqs(byId.get(id));
          if (!reqs.some(([r]) => reserved.has(r)) && locks.tryAll(id, reqs)) start(id);
          else if (serial) break;
          else for (const r of contendedX(id)) reserved.add(r);
        }
      } else {
        for (const id of [...pending]) { pending.delete(id); const s = byId.get(id); const r = { id, title: s.title, status: 'skipped' }; done.set(id, r); onEnd(s, r); }
      }
      if (!pending.size && !running.size) break;
      if (!running.size) {
        // Nothing runs and nothing can start: locks held by no running step (cannot happen with per-step locks) or an
        // unsatisfiable dependency. Report instead of hanging.
        for (const id of [...pending]) { pending.delete(id); const s = byId.get(id); const r = { id, title: s.title, status: 'error', error: 'unschedulable: its predecessors or locks never freed' }; done.set(id, r); onEnd(s, r); }
        break;
      }
      if (!dirty) await new Promise((res) => { wake = res; });
      dirty = false;
    }
  } finally { locks.onChange = prevOnChange; }
  return done;
}

/**
 * The round on paper: run the schedule with every step taking its `est` seconds (simulated clock). Returns
 * { total, rows: [{ id, start, end }] } in start order. Early releases follow `release`; sections (h.exclusive) and
 * the Agent turns' own lock (ask) are not modelled.
 */
export async function simulate(steps, opts = {}) {
  let now = 0; const timers = []; const rows = [];
  const locks = opts.locks || new Locks();
  const tick = () => { timers.sort((a, b) => a.at - b.at); const t = timers.shift(); now = t.at; t.fire(); };
  const run = (s) => new Promise((resolve) => {
    const row = { id: s.id, start: now, end: now + (Number(s.est) || 60) }; rows.push(row);
    for (const [r, sec] of Object.entries(s.release || {})) timers.push({ at: now + sec, fire: () => locks.releaseAll(s.id, r) });
    timers.push({ at: row.end, fire: () => resolve({ id: s.id, status: 'pass' }) });
  });
  const p = runSchedule(steps, { ...opts, locks, run });
  let settled = false; p.then(() => { settled = true; });
  for (;;) {
    await new Promise((r) => setImmediate(r));
    if (settled) break;
    if (!timers.length) { await p; break; }
    tick();
  }
  return { total: Math.max(0, ...rows.map((r) => r.end)), rows };
}
