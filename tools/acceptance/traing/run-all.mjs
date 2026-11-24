// Train-g acceptance runner. usage (inside the playwright container, see run.sh):
//   node run-all.mjs [--list] [--dry-run] [--only 30,40] [--from 50] [--to 70] [--skip 51] [--stop-on-fail]
// Each step in steps/ is a module `export default { id, title, covers, run(h) }`, run in file order. Per step a result
// JSON goes to results/<RUN_ID>/<id>.json (status pass|fail|error|blocked, checks, screenshots, 4xx/5xx seen, page
// errors); results/<RUN_ID>/summary.json lists them all. Run state (ids, URLs) is kept in state/run.json (0600), so a
// step can be re-run alone with --only after its predecessors passed once.
import fs from 'node:fs';
import path from 'node:path';
import { createHarness, loadConfig } from './lib/harness.mjs';
import { parseArgs, selectSteps, writeJson } from './lib/util.mjs';

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const all = await loadSteps();
  const steps = selectSteps(all, args);
  if (args.list || args.dryRun) {
    for (const s of steps) console.log(`${s.id.padEnd(28)} ${s.title}${s.covers?.length ? '  [' + s.covers.join(', ') + ']' : ''}`);
    console.log(`${steps.length} of ${all.length} steps selected${args.dryRun ? ' (dry run: modules loaded and validated, nothing executed)' : ''}`);
    return 0;
  }
  if (!process.env.KAILO_INTERNAL_API_KEY) console.warn('KAILO_INTERNAL_API_KEY is not set: account provisioning will fail');
  const cfg = loadConfig();
  const { chromium } = await import('playwright-core');
  const h = await createHarness(cfg, { chromium });
  console.log(`run ${cfg.runId} against ${cfg.base}; results ${cfg.resultsDir}`);
  const results = [];
  let stop = false;
  for (const s of steps) {
    if (stop) { results.push({ id: s.id, title: s.title, status: 'skipped' }); continue; }
    h._begin(s);
    console.log(`\n=== ${s.id} ${s.title}`);
    let r;
    try {
      // Re-attach the people the step needs (saved sessions; a fresh login when they expired).
      for (const n of s.users || []) if (h.acc[n]) await h.session(n);
      await s.run(h);
      r = await h._end();
    } catch (e) {
      r = await h._end(e?.name === 'Blocked' ? 'blocked' : 'error', e);
    }
    writeJson(path.join(cfg.resultsDir, `${s.id}.json`), r);
    console.log(`=== ${s.id} ${r.status.toUpperCase()} in ${r.seconds}s${r.failed?.length ? ' failed: ' + r.failed.join('; ') : ''}${r.error ? ' :: ' + r.error.split('\n')[0] : ''}`);
    results.push({ id: r.id, title: r.title, covers: r.covers, status: r.status, seconds: r.seconds, failed: r.failed, error: r.error?.split('\n')[0], shots: r.shots.length });
    if (args.stopOnFail && r.status !== 'pass') stop = true;
  }
  await h.close();
  const summary = { runId: cfg.runId, base: cfg.base, finishedAt: new Date().toISOString(),
    counts: results.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] || 0) + 1 }), {}), steps: results };
  writeJson(path.join(cfg.resultsDir, 'summary.json'), summary);
  console.log('\nSUMMARY', JSON.stringify(summary.counts));
  for (const r of results) console.log(`${r.status.padEnd(8)} ${r.id}${r.failed?.length ? '  ' + r.failed.join('; ') : ''}${r.error ? '  ' + r.error : ''}`);
  return results.every((r) => r.status === 'pass') ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });
}
