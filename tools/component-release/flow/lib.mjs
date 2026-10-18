// Shared helpers for the governed component-release flow (batch F; V-SCN-18,
// V-SCN-47, V-SCN-49, DD-70/88/94). Same conventions as the CI node's
// ~/kailo-acceptance/collab/lib.mjs: one browser context per account, normal
// Keycloak login on the deployed Web origin, credentials read from owner-only
// files into memory only, never printed. Every write goes through the product
// BFF (`POST /api/v1/actions`, `POST /api/v1/approvals/{id}/decision`,
// `POST /api/v1/invitations/redeem`); nothing here writes SQL, OpenBao or IdP
// state except accounts already created by ~/kailo-acceptance/accounts.py.
//
// Idempotency: every ActionCommand idempotencyKey is a UUIDv5 of the purpose,
// the exact target and an explicit --attempt (default 1). A retry of the same
// run therefore re-sends the same key and Core returns the original operation.
// Use a new --attempt only after the previous operation is terminal and was
// DENIED/EXPIRED/FAILED and you have read why.
//
// Environment (all optional):
//   KAILO_WEB                  Web origin (default http://192.168.0.193:58090)
//   KAILO_PLAYWRIGHT_PACKAGE   package.json whose node_modules has playwright
//                              (default /volumes/kailo/apps/package.json)
//   KAILO_CHROME               Chrome executable (default /usr/bin/google-chrome)
//   KAILO_FLOW_ACCOUNTS_DIR    <name>.env files with KAILO_ACCEPT_USER/PASSWORD
//                              (default ~/kailo-acceptance/accounts)
//   KAILO_DEPLOY_DIR           live deploy/local (default /volumes/kailo/apps/deploy/local);
//                              "platform-admin" = PLATFORM_ADMIN_USER from its
//                              .env + secrets/platform_admin_password
//   KAILO_FLOW_OUT             screenshot directory (default ~/kailo-acceptance/component-flow/out)
import { createRequire } from 'node:module';
import { readFileSync, lstatSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { canonical, digest, uuidv5 } from '../render.mjs';

export { canonical, digest, uuidv5 };

const HOME = process.env.HOME;
export const ORIGIN = process.env.KAILO_WEB ?? 'http://192.168.0.193:58090';
export const OUT = process.env.KAILO_FLOW_OUT ?? `${HOME}/kailo-acceptance/component-flow/out`;
const ACCOUNTS = process.env.KAILO_FLOW_ACCOUNTS_DIR ?? `${HOME}/kailo-acceptance/accounts`;
const DEPLOY = process.env.KAILO_DEPLOY_DIR ?? '/volumes/kailo/apps/deploy/local';
// Fixed namespace of flow idempotency keys and planned binding identifiers.
export const FLOW_NAMESPACE = '0b6f3f53-5c43-4f1e-9a43-6a3f1c0e2d71';
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const TERMINAL_TASK = new Set(['COMPLETED', 'FAILED', 'CANCELED', 'TERMINATED', 'TIMED_OUT']);
export const ENDED_GATE = new Set(['DENIED', 'EXPIRED', 'REVOKED']);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class FlowError extends Error {
  constructor(message, exitCode = 1) { super(message); this.exitCode = exitCode; }
}

// --key value argument parser; flags listed in `booleans` take no value.
export function parseArgs(argv, known, booleans = []) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) throw new FlowError(`unexpected argument ${key}`, 2);
    const name = key.slice(2);
    if (booleans.includes(name)) { out[name] = true; continue; }
    if (!known.includes(name) || argv[i + 1] === undefined || Object.hasOwn(out, name)) {
      throw new FlowError(`invalid argument ${key}`, 2);
    }
    out[name] = argv[++i];
  }
  return out;
}

export function attempt(args) {
  const value = Number(args.attempt ?? 1);
  if (!Number.isSafeInteger(value) || value < 1) throw new FlowError('--attempt must be a positive integer', 2);
  return value;
}

export const key = (...parts) => uuidv5(FLOW_NAMESPACE, parts.join('\u001f'));

// Owner-only regular file, not a symlink, owned by the caller.
export function privateText(path) {
  const info = lstatSync(path);
  if (!info.isFile() || (info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid())) {
    throw new FlowError(`${path} must be a regular owner-only (0600/0400) file of the current user`, 2);
  }
  return readFileSync(path, 'utf8');
}

function envFile(text) {
  return Object.fromEntries(text.split('\n').filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
}

// Non-secret keys of the live platform .env (never echo the whole file).
export function deployEnv(...names) {
  const env = envFile(readFileSync(join(DEPLOY, '.env'), 'utf8'));
  return Object.fromEntries(names.map((name) => [name, (env[name] ?? '').replace(/^["']|["']$/g, '')]));
}

export function account(name) {
  if (name === 'platform-admin') {
    const env = envFile(readFileSync(join(DEPLOY, '.env'), 'utf8'));
    const user = (env.PLATFORM_ADMIN_USER ?? '').replace(/^["']|["']$/g, '');
    if (!user) throw new FlowError('PLATFORM_ADMIN_USER missing from the live deploy .env', 2);
    return { user, pass: privateText(join(DEPLOY, 'secrets', 'platform_admin_password')).trim() };
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new FlowError(`invalid account name ${name}`, 2);
  const env = envFile(privateText(join(ACCOUNTS, `${name}.env`)));
  if (!env.KAILO_ACCEPT_USER || !env.KAILO_ACCEPT_PASSWORD) throw new FlowError(`${name}.env is incomplete`, 2);
  return { user: env.KAILO_ACCEPT_USER, pass: env.KAILO_ACCEPT_PASSWORD };
}

let browser;
export async function launch() {
  if (!browser) {
    const require = createRequire(process.env.KAILO_PLAYWRIGHT_PACKAGE ?? '/volumes/kailo/apps/package.json');
    const { chromium } = require('playwright');
    browser = await chromium.launch({ executablePath: process.env.KAILO_CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  }
  return browser;
}
export async function close() { await browser?.close(); browser = undefined; }

// Normal Keycloak login through the deployed gateway. Returns the page and a
// screenshot helper; the session view is read separately (it may be 403 for
// an invitee whose membership is not ACTIVE yet).
export async function login(name, tag) {
  const b = await launch();
  const ctx = await b.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const { user, pass } = account(name);
  await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#username', { timeout: 30000 });
  await page.fill('#username', user);
  await page.fill('#password', pass);
  await Promise.all([page.waitForURL((u) => u.toString().startsWith(ORIGIN), { timeout: 60000 }), page.click('#kc-login')]);
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  mkdirSync(OUT, { recursive: true });
  let n = 0;
  const shot = async (label) => {
    const p = `${OUT}/${tag}-${String(++n).padStart(2, '0')}-${label}.png`;
    await page.screenshot({ path: p, fullPage: true }).catch(() => {});
    return p;
  };
  return { ctx, page, shot, name };
}

// Same-origin fetch from the logged-in page (gateway session cookie, Origin /
// Sec-Fetch-Site same-origin satisfy the gateway CSRF policy). Request bodies
// are never logged; responses never carry secret values.
export async function api(session, method, path, body) {
  const result = await session.page.evaluate(async ([m, u, b]) => {
    const response = await fetch(u, { method: m, credentials: 'include', redirect: 'manual',
      headers: b === null ? {} : { 'content-type': 'application/json' }, body: b === null ? undefined : b });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON */ }
    return { status: response.status, body: json, text: json === null ? text.slice(0, 200) : undefined };
  }, [method, path, body === undefined ? null : JSON.stringify(body)]);
  if (result.status === 0 || (result.status >= 300 && result.status < 400)) {
    throw new FlowError(`${method} ${path}: session expired or redirected to the IdP (status ${result.status})`);
  }
  return result;
}

export async function sessionView(session) {
  return api(session, 'GET', '/api/v1/session');
}

export async function requireSession(session) {
  const view = await sessionView(session);
  if (view.status !== 200 || !UUID.test(view.body?.tenantId ?? '') || !UUID.test(view.body?.tenantPrincipalId ?? '')) {
    throw new FlowError(`${session.name}: no ACTIVE platform session (status ${view.status}, ${view.body?.reason ?? view.text ?? ''})`);
  }
  return view.body;
}

// Read every page of an offset-paginated list.
export async function readAll(session, path, field) {
  const rows = [];
  let offset = 0;
  for (let i = 0; i < 100; i++) {
    const separator = path.includes('?') ? '&' : '?';
    const page = await api(session, 'GET', `${path}${separator}offset=${offset}`);
    if (page.status !== 200 || !Array.isArray(page.body?.[field])) {
      throw new FlowError(`GET ${path}: status ${page.status} ${page.body?.reason ?? page.text ?? ''}`);
    }
    rows.push(...page.body[field]);
    if (page.body.nextOffset === undefined) return { rows, last: page.body };
    offset = page.body.nextOffset;
  }
  throw new FlowError(`GET ${path}: too many pages`);
}

const SUBMITTED = new Set([200, 202]);
export async function submit(session, command, label) {
  if (!UUID.test(command.idempotencyKey ?? '')) throw new FlowError('idempotencyKey must be a UUID', 2);
  const response = await api(session, 'POST', '/api/v1/actions', command);
  const view = response.body ?? {};
  log({ step: label, actionKey: command.actionKey, idempotencyKey: command.idempotencyKey, status: response.status,
    actionExecutionId: view.actionExecutionId, gateState: view.gateState, dispatchState: view.dispatchState,
    approvalWorkflowId: view.approvalWorkflowId, workflowId: view.workflowId, reason: view.reason, class: view.class });
  if (!SUBMITTED.has(response.status) || !UUID.test(view.actionExecutionId ?? '')) {
    throw new FlowError(`${command.actionKey} refused: status ${response.status} ${view.class ?? ''} ${view.reason ?? response.text ?? ''}`);
  }
  return view;
}

// Poll the initiator's TaskView until it is terminal or the deadline passes.
export async function waitTask(session, actionExecutionId, { seconds = 900, label = 'task' } = {}) {
  const deadline = Date.now() + seconds * 1000;
  let last;
  while (Date.now() < deadline) {
    const r = await api(session, 'GET', `/api/v1/tasks/${actionExecutionId}`);
    if (r.status === 200) {
      last = r.body;
      const done = ENDED_GATE.has(last.gateState)
        || (last.workflowKind === undefined && last.taskStatus === undefined && last.gateState === 'ALLOWED' && last.dispatchState === 'DISPATCHED')
        || (TERMINAL_TASK.has(last.taskStatus) && !last.observation);
      if (done) {
        log({ step: label, actionExecutionId, gateState: last.gateState, dispatchState: last.dispatchState,
          approvalStatus: last.approvalStatus, taskStatus: last.taskStatus, reason: last.reason });
        return last;
      }
    }
    await sleep(3000);
  }
  log({ step: label, actionExecutionId, timedOut: true, gateState: last?.gateState, approvalStatus: last?.approvalStatus,
    taskStatus: last?.taskStatus, observation: last?.observation, waitingReason: last?.waitingReason });
  throw new FlowError(`${label}: not terminal within ${seconds}s; re-run the same command (same key) to keep waiting`, 3);
}

// Approver side: find the exact approval (by workflow id) among the approvals
// this approver is eligible for, then decide. Resending is safe (Core fixes
// the update id to workflowId:principalId).
export async function approve(approver, approvalWorkflowId, { seconds = 300, expectActionKey } = {}) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const own = await api(approver, 'GET', `/api/v1/approvals/${encodeURIComponent(approvalWorkflowId)}`);
    if (own.status === 200) {
      const view = own.body;
      if (expectActionKey && view.actionKey !== expectActionKey) {
        throw new FlowError(`approval ${approvalWorkflowId} is ${view.actionKey}, expected ${expectActionKey}`);
      }
      if (['APPROVED', 'CONSUMED'].includes(view.status)) { log({ step: 'approval', approvalWorkflowId, status: view.status }); return view; }
      if (['DENIED', 'EXPIRED', 'CANCELLED', 'INVALIDATED'].includes(view.status)) {
        throw new FlowError(`approval ${approvalWorkflowId} is ${view.status}`);
      }
      const decided = await api(approver, 'POST', `/api/v1/approvals/${encodeURIComponent(approvalWorkflowId)}/decision`, { decision: 'APPROVE' });
      log({ step: 'approval-decision', approver: approver.name, approvalWorkflowId, status: decided.status,
        admitted: decided.body?.admitted, outcome: decided.body?.status, reason: decided.body?.reason });
      if (decided.status === 200 && decided.body?.admitted) return decided.body;
      if (decided.status === 403) throw new FlowError(`${approver.name} is not an eligible approver: ${decided.body?.reason ?? ''}`);
    }
    await sleep(3000);
  }
  throw new FlowError(`approval ${approvalWorkflowId} not decided within ${seconds}s`, 3);
}

export function log(entry) {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}

// Run a flow body with uniform exit codes: 0 done, 1 refused/failed,
// 2 invalid invocation/input, 3 still converging (re-run the same command).
export async function main(body) {
  try {
    await body();
    await close();
    process.exit(0);
  } catch (error) {
    await close().catch(() => {});
    const code = error instanceof FlowError ? error.exitCode : 1;
    log({ error: String(error?.message ?? error).split('\n')[0].slice(0, 400), exitCode: code });
    process.exit(code);
  }
}

// Rendered release directory produced by tools/component-release/render.mjs.
export function renderedRelease(dir) {
  const registration = JSON.parse(readFileSync(join(dir, 'registration.json'), 'utf8'));
  if (Object.keys(registration).sort().join(',') !== 'bindingConfigSchemaJson,manifestJson,packageJson') {
    throw new FlowError(`${dir}/registration.json is not a render.mjs output`, 2);
  }
  const manifest = JSON.parse(registration.manifestJson);
  if (!UUID.test(manifest.id ?? '') || JSON.stringify(manifest).includes('{{')) {
    throw new FlowError(`${dir} still has template placeholders`, 2);
  }
  return { registration, manifest, manifestDigest: digest(manifest) };
}
