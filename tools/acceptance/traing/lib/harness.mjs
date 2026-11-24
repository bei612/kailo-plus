// The acceptance harness: one playwright-core browser, one zh-CN context per test user, session-backed API calls,
// per-step checks and screenshots. Accounts, cookies and run state are kept in 0600 files under state/;
// passwords are generated here and never logged.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { brief, Blocked, readJson, redact, writeSecretJson } from './util.mjs';

export function loadConfig(env = process.env) {
  const dir = env.SUITE_DIR || path.dirname(path.dirname(new URL(import.meta.url).pathname));
  const runId = env.RUN_ID || new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
  return {
    dir,
    runId,
    base: (env.KAILO_URL || 'https://192.168.0.149').replace(/\/$/, ''),
    authInternal: env.AUTH_INTERNAL_URL || 'http://authentication-service:8080',
    openmeter: env.OPENMETER_URL || 'http://openmeter:8888/api/v1',
    mailpit: env.MAILPIT_URL || 'http://mailpit:8025',
    locale: env.ACC_LOCALE || 'zh-CN',
    stateDir: path.join(dir, 'state'),
    shotsDir: path.join(dir, 'shots', runId),
    resultsDir: path.join(dir, 'results', runId),
    // Optional 0600 JSON {"email","password"} of an existing platform administrator, used when bootstrap is closed.
    adminAccountFile: env.ADMIN_ACCOUNT_FILE || '',
    accountDomain: env.ACC_DOMAIN || '',
    askTimeoutS: Number(env.ASK_TIMEOUT_S || 600),
    headless: env.HEADED !== '1',
  };
}

export async function createHarness(cfg, { chromium } = {}) {
  fs.mkdirSync(cfg.stateDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(cfg.stateDir, 0o700);
  fs.mkdirSync(cfg.shotsDir, { recursive: true });
  fs.mkdirSync(cfg.resultsDir, { recursive: true });
  const ACC = path.join(cfg.stateDir, 'accounts.json');
  const RUN = path.join(cfg.stateDir, 'run.json');
  const secrets = () => [process.env.KAILO_INTERNAL_API_KEY, process.env.KAILO_PLATFORM_BOOTSTRAP_TOKEN,
    ...Object.values(h.acc).map((a) => a?.password)];
  let rec = null; // the step being recorded
  const browser = chromium ? await chromium.launch({ headless: cfg.headless }) : null;
  const users = {};

  const h = {
    cfg,
    browser,
    users,
    acc: readJson(ACC, {}),
    S: readJson(RUN, {}),
    BASE: cfg.base,
    saveAccounts() { writeSecretJson(ACC, h.acc); },
    saveState() { writeSecretJson(RUN, h.S); },

    log(...a) {
      const s = redact(a.map((x) => (typeof x === 'string' ? x : brief(x, 2000))).join(' '), secrets());
      console.log(`[${rec?.id ?? '-'}] ${s}`);
      rec?.log.push(s);
    },
    /** Record one assertion of the step; a step passes when all its checks hold. */
    check(name, ok, detail) {
      const c = { name, ok: !!ok, detail: detail === undefined ? undefined : redact(brief(detail, 1500), secrets()) };
      rec?.checks.push(c);
      console.log(`[${rec?.id ?? '-'}] ${c.ok ? 'PASS' : 'FAIL'} ${name}${c.detail ? ' :: ' + c.detail : ''}`);
      return c.ok;
    },
    /** Something worth a look that does not fail the step (best-effort UI paths). */
    warn(name, detail) {
      rec?.warnings.push({ name, detail: brief(detail ?? '', 800) });
      console.log(`[${rec?.id ?? '-'}] WARN ${name} ${brief(detail ?? '', 800)}`);
    },
    /** State an earlier step must have left; otherwise this step is blocked. */
    need(...keys) {
      const miss = keys.filter((k) => k.split('.').reduce((o, p) => (o == null ? o : o[p]), h.S) == null);
      if (miss.length) throw new Blocked(`missing state ${miss.join(', ')} (run the earlier steps first)`);
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),

    async ctxFor(name) {
      if (users[name]) return users[name];
      const st = path.join(cfg.stateDir, `${name}.json`);
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 },
        locale: cfg.locale, timezoneId: 'Asia/Shanghai', storageState: fs.existsSync(st) ? st : undefined });
      const page = await ctx.newPage();
      const hook = (p) => {
        p.on('response', (r) => { if (r.status() >= 400 && rec) rec.net.push(`${new Date().toISOString().slice(11, 19)} ${name} ${r.status()} ${r.request().method()} ${r.url().split('?')[0]}`); });
        p.on('pageerror', (e) => { const s = String(e?.stack || e).slice(0, 600); users[name]?.pageErrors.push(s); rec?.pageErrors.push(`${name}: ${s}`); });
      };
      hook(page); ctx.on('page', hook);
      users[name] = { name, ctx, page, pageErrors: [], save: async () => { await ctx.storageState({ path: st }); fs.chmodSync(st, 0o600); } };
      return users[name];
    },
    u(name) { if (!users[name]) throw new Blocked(`user ${name} has no browser context`); return users[name]; },

    async provision(name, email, first, last) {
      const password = crypto.randomBytes(18).toString('base64') + 'Aa1';
      const r = await fetch(`${cfg.authInternal}/internal/accounts`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-auth-key': process.env.KAILO_INTERNAL_API_KEY },
        body: JSON.stringify({ email, email_verified: true, password, first_name: first, last_name: last }) });
      h.log('provision', name, email, r.status);
      if (!r.ok) throw new Error(`provision ${name} ${r.status} ${brief(await r.text(), 300)}`);
      h.acc[name] = { email, password, first, last };
      h.saveAccounts();
    },

    /** Keycloak sign-in through the web login, as a person does it. */
    async login(name, account) {
      const u = await h.ctxFor(name);
      const a = account || h.acc[name];
      const page = u.page;
      // A fresh sign-in: drop any old session first. A context that still holds one is taken into the app, whose live
      // connections never let the network idle, so wait for the load and the sign-in button instead.
      await u.ctx.clearCookies().catch(() => {});
      await page.goto(`${cfg.base}/app/login`, { waitUntil: 'load' });
      await page.getByRole('button', { name: /^(Continue|继续)$/ }).click({ timeout: 30000 });
      await page.waitForURL(/\/idp\/realms\/kailo\//, { timeout: 30000 });
      await page.waitForLoadState('networkidle');
      const user = page.locator('input[name=username]');
      if (await user.count()) await user.fill(a.email);
      const pw = page.locator('input[name=password]');
      if (!(await pw.isVisible().catch(() => false))) { await page.locator('form').first().evaluate((f) => f.requestSubmit()); await pw.waitFor({ timeout: 30000 }); }
      await pw.fill(a.password);
      await Promise.all([page.waitForURL((x) => x.origin === cfg.base && x.pathname.startsWith('/app'), { timeout: 60000 }),
        page.locator('form').first().evaluate((f) => f.requestSubmit())]);
      await page.waitForTimeout(6000);
      await u.save();
      h.log('login', name, page.url());
      return u;
    },

    /** A signed-in context for `name`: the saved session, or a fresh Keycloak login when it has expired. */
    async session(name) {
      const u = await h.ctxFor(name);
      const r = await u.ctx.request.fetch(`${cfg.base}/auth/team/workspaces`, { failOnStatusCode: false });
      if (r.status() === 401 || r.status() === 403) await h.login(name);
      return users[name];
    },

    async shot(page, label, opts = {}) {
      const file = `${rec?.id ?? 'x'}--${label}.png`;
      await page.screenshot({ path: path.join(cfg.shotsDir, file), ...opts }).catch((e) => h.warn('screenshot', e.message));
      rec?.shots.push(file);
      return file;
    },
    async text(page) { return (await page.innerText('body').catch(() => '')).replace(/\n{2,}/g, '\n'); },

    /** An API call with `name`'s browser session (cookies), as the web client makes it. */
    async api(name, method, p, body, headers = {}, renewed = false) {
      const u = h.u(name);
      const r = await u.ctx.request.fetch(cfg.base + p, { method, data: body === undefined ? undefined : body,
        headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers }, failOnStatusCode: false });
      const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
      // An expired session (runs last over an hour) is renewed once, as the web client renews it, then the call repeats.
      if (r.status() === 401 && !renewed) { h.log('session renewed after 401', name, p); await h.session(name); return h.api(name, method, p, body, headers, true); }
      return { status: r.status(), body: j, headers: r.headers() };
    },
    /** The same call with no session at all. */
    async anon(method, p, body) {
      const { request } = await import('playwright-core');
      const rc = await request.newContext({ ignoreHTTPSErrors: true });
      try {
        const r = await rc.fetch(cfg.base + p, { method, data: body, failOnStatusCode: false });
        return { status: r.status(), body: await r.text() };
      } finally { await rc.dispose(); }
    },
    /** A service-internal call on kailo_internal (OpenMeter, mailpit); never with a user's credentials. */
    async fetchJson(url, init) {
      const r = await fetch(url, init); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
      return { status: r.status, body: j };
    },

    /** Render an API answer as a page and screenshot it, so the evidence sits next to the UI shots. */
    async jsonShot(name, p, label) {
      const pg = await h.u(name).ctx.newPage();
      try {
        const r = await h.api(name, 'GET', p);
        const pretty = typeof r.body === 'string' ? r.body : JSON.stringify(r.body, null, 2);
        await pg.setContent(`<meta charset="utf-8"><pre style="font:13px monospace;white-space:pre-wrap;padding:16px">${name} · GET ${p} → ${r.status}\n\n${pretty.slice(0, 60000).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`);
        await h.shot(pg, label, { fullPage: true });
        return r;
      } finally { await pg.close(); }
    },

    _begin(step) {
      rec = { id: step.id, title: step.title, covers: step.covers || [], status: 'running', startedAt: new Date().toISOString(),
        checks: [], warnings: [], shots: [], log: [], net: [], pageErrors: [] };
      return rec;
    },
    async _end(status, error) {
      for (const n of Object.keys(users)) await users[n].save().catch(() => {});
      h.saveState();
      const r = rec; rec = null;
      r.endedAt = new Date().toISOString();
      r.seconds = Math.round((Date.parse(r.endedAt) - Date.parse(r.startedAt)) / 1000);
      r.status = status ?? (r.checks.length && r.checks.every((c) => c.ok) ? 'pass' : 'fail');
      if (!r.checks.length && !error && status == null) r.error = 'step recorded no checks';
      r.failed = r.checks.filter((c) => !c.ok).map((c) => c.name);
      if (error) r.error = redact(String(error.stack || error).slice(0, 2000), secrets());
      r.net = [...new Set(r.net)].slice(-60);
      r.pageErrors = r.pageErrors.slice(-20);
      return r;
    },
    async close() { if (browser) await browser.close().catch(() => {}); },
  };
  return h;
}
