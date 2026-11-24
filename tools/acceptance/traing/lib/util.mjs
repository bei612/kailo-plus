// Pure helpers of the train-g acceptance suite: no browser, no network. Covered by selftest.mjs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** A UUIDv7 (time-ordered), as the web client mints action ids and request ids. */
export function uuid7(now = Date.now()) {
  const b = crypto.randomBytes(16);
  const t = BigInt(now);
  for (let i = 0; i < 6; i++) b[i] = Number((t >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

/** Every object nested in `v` (arrays and objects, depth first) for which `pred` holds. */
export function deepFind(v, pred, out = [], seen = new Set()) {
  if (v && typeof v === 'object') {
    if (seen.has(v)) return out;
    seen.add(v);
    if (!Array.isArray(v) && pred(v)) out.push(v);
    for (const x of Array.isArray(v) ? v : Object.values(v)) deepFind(x, pred, out, seen);
  }
  return out;
}

/** The title-like field of an entity object, whatever the service calls it. */
export function titleOf(o) {
  return o?.documentName ?? o?.document_name ?? o?.name ?? o?.title ?? o?.taskName ?? null;
}

/** Entities in `body` whose title matches `re` and that carry an id. */
export function findByTitle(body, re) {
  return deepFind(body, (o) => typeof (o.id ?? o.documentId ?? o.document_id) === 'string' && re.test(String(titleOf(o) ?? '')))
    .map((o) => ({ id: o.id ?? o.documentId ?? o.document_id, title: titleOf(o), raw: o }));
}

/**
 * The English strings of `english` still visible in `text` (TE-16 zh-CN checks). Matched as whole phrases so a
 * product name such as "Kailo Codex" or an identifier is not counted.
 */
export function englishLeaks(text, english) {
  const t = ` ${String(text).replace(/\s+/g, ' ')} `;
  return english.filter((s) => {
    const esc = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^A-Za-z])${esc}([^A-Za-z]|$)`).test(t);
  });
}

/** Text of a channel after our own message `msg` (what the Agents answered to it). */
export function afterMessage(text, msg) {
  const s = String(text); const i = s.lastIndexOf(msg);
  return i < 0 ? '' : s.slice(i + msg.length);
}

/** A one-time marker for one prompt of one run, so its answer is read after THAT message only. */
export function oneTimeMarker(runId, label) {
  return `〔验收 ${runId}·${label}·${Math.random().toString(36).slice(2, 8)}〕`;
}

/**
 * Whether `after` holds a non-empty answer by `agentName`: the name, then at least `min` visible characters that are
 * not just the name again or a "thinking" placeholder (TE-01 empty replies).
 */
export function hasAnswer(after, agentName, min = 12) {
  const i = after.indexOf(agentName);
  if (i < 0) return false;
  const rest = after.slice(i + agentName.length).replace(/\s+/g, '').replace(/(思考中|正在思考|Thinking)[.…]*/g, '');
  return rest.length >= min;
}

export const FAILURE_RE = /(没有完成|未能完成|出错了|出现错误|发生错误|CONTEXT_EXHAUSTED|internal error|Something went wrong|empty response|-32602|NO_PERMISSION|还不是本频道的成员)/i;

/** Parse `--only a,b --from x --to y --list --dry-run --stop-on-fail`. */
export function parseArgs(argv) {
  const a = { only: null, from: null, to: null, list: false, dryRun: false, stopOnFail: false, skip: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--only') a.only = argv[++i].split(',').filter(Boolean);
    else if (k === '--skip') a.skip = argv[++i].split(',').filter(Boolean);
    else if (k === '--from') a.from = argv[++i];
    else if (k === '--to') a.to = argv[++i];
    else if (k === '--list') a.list = true;
    else if (k === '--dry-run') a.dryRun = true;
    else if (k === '--stop-on-fail') a.stopOnFail = true;
    else throw new Error(`unknown argument ${k}`);
  }
  return a;
}

/** The steps `args` selects, in file order. A step is named by its id or by its id's numeric prefix. */
export function selectSteps(steps, args) {
  const hit = (s, n) => s.id === n || s.id.split('-')[0] === n;
  let out = steps;
  if (args.only) out = out.filter((s) => args.only.some((n) => hit(s, n)));
  if (args.from) { const i = out.findIndex((s) => hit(s, args.from)); out = i < 0 ? [] : out.slice(i); }
  if (args.to) { const i = out.findIndex((s) => hit(s, args.to)); out = i < 0 ? out : out.slice(0, i + 1); }
  if (args.skip.length) out = out.filter((s) => !args.skip.some((n) => hit(s, n)));
  return out;
}

/** Write JSON readable by the owner only (accounts, session cookies, run state). */
export function writeSecretJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

/** Strip anything that looks like a credential from a log line (passwords never reach logs; this is a backstop). */
export function redact(s, secrets = []) {
  let out = String(s);
  for (const x of secrets) if (x && x.length >= 6) out = out.split(x).join('***');
  return out.replace(/("?(password|token|secret|cookie|authorization)"?\s*[:=]\s*)"[^"]*"/gi, '$1"***"');
}

/** Short one-line form of any value for the step log. */
export function brief(v, n = 400) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return (s ?? String(v)).replace(/\s+/g, ' ').slice(0, n);
}

/** The next UTC minute at least `leadMs` ahead, as `{ date, hhmm, iso }`. */
export function minuteAhead(leadMs, now = Date.now()) {
  const d = new Date(now + leadMs);
  if (d.getUTCSeconds() || d.getUTCMilliseconds()) { d.setUTCSeconds(0, 0); d.setTime(d.getTime() + 60000); }
  const hhmm = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return { date: d, hhmm, iso: d.toISOString() };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** An error that marks a step as blocked by an earlier one (missing state), not as failed. */
export class Blocked extends Error {
  constructor(msg) { super(msg); this.name = 'Blocked'; }
}
