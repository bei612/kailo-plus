// Train-g acceptance runner. usage (inside the playwright container, see run.sh):
//   node run-all.mjs [--list] [--plan] [--dry-run] [--only 30,40] [--from 50] [--to 70] [--skip 51] [--stop-on-fail]
//                    [--serial] [--concurrency 4]
// Each step in steps/ is a module `export default { id, title, covers, users, after, locks, est, run(h) }`. Steps run
// concurrently (lib/schedule.mjs): a step starts once the steps it names in `after` have ended and the resources in its
// `locks` are free, up to --concurrency (default ACC_CONCURRENCY or 4) at once, the longest remaining chain first; each
// gets its own page per person (lib/harness.mjs h.fork) and reads Agent answers from its own channel thread
// (lib/ui.mjs readAfter). --serial runs them one at a time in file order, as before. --plan prints the graph and the
// round on paper (every step taking its `est`). Per step a result JSON goes to results/<RUN_ID>/<id>.json (status
// pass|fail|error|blocked, checks, screenshots, 4xx/5xx seen, page errors); results/<RUN_ID>/summary.json lists them all
// in file order. Log lines carry the step id. Run state (ids, URLs) is kept in state/run.json (0600), so a step can be
// re-run alone with --only after its predecessors passed once.
import fs from 'node:fs';
import path from 'node:path';
import { createHarness, loadConfig } from './lib/harness.mjs';
import { parseArgs, selectSteps, writeJson } from './lib/util.mjs';
import { buildGraph, runSchedule, simulate } from './lib/schedule.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);

export async function loadSteps(dir = path.join(here, 'steps')) {
  const files = fs.readdirSync(dir).filter((f) => /^\d{2}[a-z]?-.*\.mjs$/.test(f)).sort();
  const steps = [];
  for (const f of files) {
    const m = (await import(path.join(dir, f))).default;
    if (!m || typeof m.run !== 'function' || !m.id || !m.title) throw new Error(`${f}: default export needs { id, title, run }`);
    if (`${m.id}.mjs` !== f) throw new Error(`${f}: id ${m.id} does not match the file name`);
    steps.push({ ...m, file: f });
  }
  return steps;
}

const mmss = (sec) => `${String(Math.floor(sec / 60)).padStart(3)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

/** The selected steps' graph and the round on paper. */
async function plan(steps, all, args) {
  const g = buildGraph(steps, all);
  console.log('\ngraph (after → step; locks: s shared, x exclusive):');
  for (const s of steps) {
    const locks = Object.entries(s.locks || {}).map(([r, m]) => `${r}:${m}`).join(' ');
    const rel = Object.entries(s.release || {}).map(([r, t]) => `${r}@${t}s`).join(' ');
    console.log(`  ${s.id.padEnd(22)} after ${(g.deps.get(s.id).join(',') || '-').padEnd(40)} ${locks}${rel ? '  releases ' + rel : ''}`);
  }
  const sim = await simulate(steps, { all, serial: args.serial, limit: args.concurrency });
  console.log(`\nplan (${args.serial ? 'serial' : `concurrency ${args.concurrency}`}; est per step, Agent turn locks and sections not modelled):`);
  for (const r of sim.rows) console.log(`  ${mmss(r.start)} → ${mmss(r.end)}  ${r.id}`);
  const serial = args.serial ? sim : await simulate(steps, { all, serial: true });
  console.log(`round ≈ ${Math.round(sim.total / 60)} min (serial ≈ ${Math.round(serial.total / 60)} min)`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2), process.env);
  const all = await loadSteps();
  const steps = selectSteps(all, args);
  buildGraph(steps, all); // unknown references and cycles fail here, before anything runs
  if (args.list || args.dryRun || args.plan) {
    for (const s of steps) console.log(`${s.id.padEnd(28)} ${s.title}${s.covers?.length ? '  [' + s.covers.join(', ') + ']' : ''}`);
    console.log(`${steps.length} of ${all.length} steps selected${args.dryRun ? ' (dry run: modules loaded and validated, nothing executed)' : ''}`);
    if (args.plan || args.dryRun) await plan(steps, all, args);
    return 0;
  }
  if (!process.env.KAILO_INTERNAL_API_KEY) console.warn('KAILO_INTERNAL_API_KEY is not set: account provisioning will fail');
  const cfg = loadConfig();
  const { chromium } = await import('playwright-core');
  const h = await createHarness(cfg, { chromium });
  h.parallel = !args.serial;
  console.log(`run ${cfg.runId} against ${cfg.base}; results ${cfg.resultsDir}; ${args.serial ? 'serial' : `up to ${args.concurrency} steps at once`}`);
  const results = new Map();
  const row = (r) => ({ id: r.id, title: r.title, covers: r.covers, status: r.status, seconds: r.seconds, failed: r.failed, error: r.error?.split('\n')[0], shots: r.shots?.length ?? 0 });
  await runSchedule(steps, {
    all, serial: args.serial, limit: args.concurrency, stopOnFail: args.stopOnFail, locks: h.locks,
    onStart(s, running) {
      console.log(`\n=== ${s.id} ${s.title}`);
      if (running.length) console.log(`[${s.id}] starts alongside ${running.join(', ')}`);
    },
    async run(s) {
      const x = h.fork();
      x._begin(s);
      let r;
      try {
        // Re-attach the people the step needs (saved sessions; a fresh login when they expired).
        for (const n of s.users || []) if (h.acc[n]) await x.session(n);
        await s.run(x);
        r = await x._end();
      } catch (e) {
        r = await x._end(e?.name === 'Blocked' ? 'blocked' : 'error', e);
      } finally {
        await x.release();
      }
      writeJson(path.join(cfg.resultsDir, `${s.id}.json`), r);
      console.log(`=== ${s.id} ${r.status.toUpperCase()} in ${r.seconds}s${r.failed?.length ? ' failed: ' + r.failed.join('; ') : ''}${r.error ? ' :: ' + r.error.split('\n')[0] : ''}`);
      results.set(s.id, row(r));
      return r;
    },
    // Steps that never ran: skipped after --stop-on-fail, or unschedulable.
    onEnd(s, r) {
      if (results.has(s.id)) return;
      if (r.status !== 'skipped') console.log(`=== ${s.id} ${r.status.toUpperCase()} :: ${r.error}`);
      results.set(s.id, r.status === 'skipped' ? { id: s.id, title: s.title, status: 'skipped' } : row({ ...r, covers: s.covers }));
    },
  });
  await h.close();
  const list = steps.map((s) => results.get(s.id) ?? { id: s.id, title: s.title, status: 'skipped' });
  const summary = { runId: cfg.runId, base: cfg.base, finishedAt: new Date().toISOString(), mode: args.serial ? 'serial' : `concurrency ${args.concurrency}`,
    counts: list.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] || 0) + 1 }), {}), steps: list };
  writeJson(path.join(cfg.resultsDir, 'summary.json'), summary);
  console.log('\nSUMMARY', JSON.stringify(summary.counts));
  for (const r of list) console.log(`${r.status.padEnd(8)} ${r.id}${r.failed?.length ? '  ' + r.failed.join('; ') : ''}${r.error ? '  ' + r.error : ''}`);
  return list.every((r) => r.status === 'pass') ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });
}
