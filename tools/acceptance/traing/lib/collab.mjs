// Helpers of the parity steps (23–39): the everyday collaboration features a team uses without external accounts —
// channel messages (threads, reactions, edits, deletes, mentions, attachments, drafts, DMs), the notification inbox,
// search, Drive uploads and previews, tasks with time tracking, projects, databases and forms.
//
// What each helper reads in the web app is named next to it (apps/web/src/...); the API calls are the ones the web
// client makes, through the deployment's gateway (/dss, /notification), with the person's session.
import zlib from 'node:zlib';
import { findByTitle } from './util.mjs';

/** A short random token of this run, ASCII so search tokenizes it as one word. */
export const token = (prefix = 'TGP') => `${prefix}${Math.random().toString(36).slice(2, 8)}`;

// ---------------------------------------------------------------------------------------------------------------
// Entities the parity steps make, deleted by 99 (h.S.made.<kind> = [ids]).

/** Record entity `id` of `kind` (doc | initiative | database | form) for 99 to delete. */
export function track(h, kind, id) {
  if (!id) return;
  h.S.made ||= {};
  (h.S.made[kind] ||= []).includes(id) || h.S.made[kind].push(id);
  h.saveState();
}

/** A GraphQL call on the DSS soup endpoint (POST only: GET serves the IDE, graphql-soup.ts). */
export async function gql(h, user, query, variables = {}) {
  const r = await h.api(user, 'POST', '/dss/items/soup/graphql', { query, variables });
  return { status: r.status, data: r.body?.data, errors: r.body?.errors, body: r.body };
}

const ENTITY_MUTATION = (name) => `mutation($entities: [EntityRefInput!]!) { ${name}(entities: $entities) {
  results { __typename ... on GraphqlMutationError { errorCode message } } } }`;

/**
 * Trash, then permanently delete, entities `ids` of GraphQL type `type` (INITIATIVE, DATABASE, FORM, DOCUMENT)
 * (entity-mutations.graphql TrashEntities / DeleteEntitiesPermanently). Returns the errors of both.
 */
export async function deleteEntities(h, user, type, ids) {
  if (!ids?.length) return [];
  const entities = ids.map((id) => ({ id, type }));
  const errs = [];
  for (const m of ['trashEntities', 'deleteEntitiesPermanently']) {
    const r = await gql(h, user, ENTITY_MUTATION(m), { entities });
    if (r.status !== 200 || r.errors?.length) errs.push({ m, status: r.status, errors: r.errors });
    for (const x of r.data?.[m]?.results || []) if (x.__typename === 'GraphqlMutationError') errs.push({ m, ...x });
  }
  return errs;
}

// ---------------------------------------------------------------------------------------------------------------
// The global create launcher (key `c`, Launcher.tsx DesktopLauncher, dialog 新建), as m0/create-menu.mjs drives it.

const ENTRIES = { document: /^(Document|文档)$/, task: /^(Task|任务)$/, channel: /^(Channel|频道)$/,
  database: /^(Database|数据库)$/, form: /^(Form|表单)$/, project: /^(Project|项目)$/ };

export async function createFromMenu(h, page, entry, { attempts = 3 } = {}) {
  const name = ENTRIES[entry];
  if (!name) throw new Error(`unknown create-menu entry ${entry}`);
  if (!/\/app\/home/.test(page.url())) { await page.goto(`${h.BASE}/app/home`, { waitUntil: 'load' }); await page.waitForTimeout(4000); }
  const menu = page.getByRole('dialog', { name: /^(Create New|新建)$/ });
  for (let i = 0; i < attempts; i++) {
    await page.locator('body').click({ position: { x: 900, y: 120 } });
    await page.keyboard.press('c');
    const item = menu.getByText(name).first();
    if (await item.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false)) {
      await item.click();
      // The details layout only selects on click, the list layout runs it: Enter only into a menu still open.
      if (!(await menu.waitFor({ state: 'hidden', timeout: 1500 }).then(() => true, () => false))) await page.keyboard.press('Enter');
      return;
    }
    await page.keyboard.press('Escape');
  }
  throw new Error(`the create menu did not open after ${attempts} attempts`);
}

/** The first uuid in `url` after `/app/` (the entity a route opened). */
export const idInUrl = (url, kind = '[a-z-]+') => String(url).match(new RegExp(`/app/(?:drive/)?${kind}/([0-9a-f-]{36})`))?.[1] ?? null;

/**
 * A new task from the launcher: the composer's title (`[data-task-composer-title]`), then 创建任务. Returns its id (from
 * the route it opens, else found by its title).
 */
export async function newTask(h, user, title) {
  const p = h.u(user).page;
  await createFromMenu(h, p, 'task');
  return fillTaskComposer(h, user, title);
}

/** Type `title` into the open task composer and create the task; its id. */
export async function fillTaskComposer(h, user, title, { replace = false } = {}) {
  const p = h.u(user).page;
  const t = p.locator('[data-task-composer-title] [contenteditable="true"]').first();
  await t.waitFor({ state: 'visible', timeout: 15000 });
  await t.click();
  if (replace) { await p.keyboard.press('ControlOrMeta+a'); await p.keyboard.press('Backspace'); }
  if (title) await p.keyboard.type(title, { delay: 25 });
  await p.waitForTimeout(600);
  await p.getByRole('button', { name: /^(Create Task|创建任务)$/ }).first().click();
  await p.waitForTimeout(5000);
  let id = idInUrl(p.url(), '(?:task|tasks|md)');
  if (!id && title) {
    for (let i = 0; i < 6 && !id; i++) {
      id = (await findTitled(h, user, title))[0]?.id ?? null;
      if (!id) await h.sleep(3000);
    }
  }
  return id;
}

/** Documents and tasks of `user` titled exactly `title`. */
export async function findTitled(h, user, title) {
  const esc = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const out = [];
  for (const path of ['/dss/documents?limit=200', '/dss/documents/list']) {
    const r = await h.api(user, 'GET', path);
    if (r.status === 200) out.push(...findByTitle(r.body, new RegExp(`^${esc}$`)));
  }
  const seen = new Set();
  return out.filter((d) => !seen.has(d.id) && seen.add(d.id));
}

// ---------------------------------------------------------------------------------------------------------------
// Channel messages (crates/messages: /dss/messages/channel/{cid}; features/channel/Message).

/** The channel's top-level messages, newest first, each with `thread.preview` (GET /dss/messages/channel/{cid}). */
export async function messages(h, user, cid, limit = 50) {
  const r = await h.api(user, 'GET', `/dss/messages/channel/${cid}?limit=${limit}`);
  return { status: r.status, items: Array.isArray(r.body?.items) ? r.body.items : [] };
}

/** The message whose content holds `marker` (its replies' previews are searched too). */
export function findMessage(items, marker) {
  for (const m of items || []) {
    if (String(m?.content ?? '').includes(marker)) return m;
    for (const r of m?.thread?.preview || []) if (String(r?.content ?? '').includes(marker)) return r;
  }
  return null;
}

/** Poll until a message holding `marker` is listed (sending is asynchronous); null when it never is. */
export async function waitMessage(h, user, cid, marker, tries = 8) {
  for (let i = 0; i < tries; i++) {
    const m = findMessage((await messages(h, user, cid)).items, marker);
    if (m) return m;
    await h.sleep(2500);
  }
  return null;
}

/** A thread: { root, replies } (GET /dss/messages/channel/{cid}/threads/{rootId}). */
export async function thread(h, user, cid, rootId) {
  const r = await h.api(user, 'GET', `/dss/messages/channel/${cid}/threads/${rootId}`);
  return { status: r.status, root: r.body?.root, replies: Array.isArray(r.body?.replies) ? r.body.replies : [] };
}

/** The channel composer of `page` (Input/Root.tsx data-input-id="channel-input-<cid>"), or the page's last one. */
export function composer(page, cid) {
  const scoped = page.locator(`[data-input-id="channel-input-${cid}"] div[role="textbox"][contenteditable="true"]`);
  return { scoped, any: page.locator('div[role="textbox"][contenteditable="true"]').last() };
}

/** Open the channel `cid` on its messages tab with its composer ready; returns the composer. */
export async function openChannel(h, user, cid) {
  const p = h.u(user).page;
  await p.goto(`${h.BASE}/app/channels/${cid}`, { waitUntil: 'load' });
  await p.waitForTimeout(5000);
  const c = composer(p, cid);
  const box = (await c.scoped.count()) ? c.scoped.first() : c.any;
  await box.waitFor({ state: 'visible', timeout: 30000 });
  return box;
}

/**
 * Type `parts` into the composer and send (Enter, Input/ChannelInput.tsx). A part `{ mention: q, pick }` types `@q`,
 * waits for the mentions menu (MentionsMenu, [data-holds-prompts]) and picks the item whose text matches `pick`
 * (else the first, by Enter).
 */
export async function compose(h, user, box, parts, { send = true } = {}) {
  const p = h.u(user).page;
  await box.click();
  for (const part of parts) {
    if (typeof part === 'string') { await box.pressSequentially(part, { delay: 15 }); continue; }
    await box.pressSequentially('@' + part.mention, { delay: 120 }); await p.waitForTimeout(2500);
    const menu = p.locator('[data-holds-prompts]').last();
    const item = part.pick ? menu.getByText(part.pick).first() : null;
    if (item && (await item.count())) await item.click(); else await p.keyboard.press('Enter');
    await p.waitForTimeout(800);
  }
  await p.waitForTimeout(500);
  if (send) { await p.keyboard.press('Enter'); await p.waitForTimeout(3000); }
}

/** Bring message `id` into view and hover it, so its toolbar (Message/ActionMenu.tsx) shows. */
export async function hoverMessage(page, id) {
  const row = page.locator(`[data-message-id="${id}"]`).first();
  for (let i = 0; i < 8 && !(await row.count()); i++) { await page.mouse.move(720, 450); await page.mouse.wheel(0, -900); await page.waitForTimeout(700); }
  await row.scrollIntoViewIfNeeded().catch(() => {});
  await row.hover(); await page.waitForTimeout(700);
  return row;
}

/**
 * Click toolbar action `action` (data-message-action: reply, edit, delete, create-task, react-quick …) of message `id`.
 * Only that message's own toolbar (it renders inside the row, Message/Root.tsx → ActionMenu.tsx): a message arriving
 * meanwhile moves the list under the pointer, and the toolbar then showing is another message's (B9 r1: 23 deleted
 * the Agent prompt 70 had just sent).
 */
export async function messageAction(page, id, action, extra = '') {
  const sel = `[data-message-action="${action}"]${extra}`;
  for (let i = 0; i < 4; i++) {
    const row = await hoverMessage(page, id);
    const btn = row.locator(sel).first();
    if (await btn.isVisible().catch(() => false)) { await btn.click(); await page.waitForTimeout(1200); return; }
    await page.waitForTimeout(800);
  }
  throw new Error(`message ${id}: no ${action} action in its toolbar`);
}

/**
 * Run `fn` (open a channel composer, type, send) as the only composer of `user`: all of a person's pages share one
 * localStorage, where a channel's unsent text is one draft (Input/shared-draft.ts) a composer reads when it mounts, so
 * two steps typing as the same person at once send each other's half-typed text (B9 r1: 23 sent "@kailo" typed by 70).
 */
export function composing(h, user, fn) {
  return typeof h.exclusive === 'function' ? h.exclusive(`draft:${user}`, fn) : fn();
}

/** Whether `content` (Macro Markdown) or `mentions` of a message name user `userId`. */
export function mentionsUser(m, userId) {
  const id = String(userId).toLowerCase();
  return (m?.mentions || []).some((x) => String(x.entity_id ?? x.entityId).toLowerCase() === id)
    || String(m?.content ?? '').toLowerCase().includes(id);
}

// ---------------------------------------------------------------------------------------------------------------
// Notifications (services/notification_service, /notification/user_notifications).

/** `user`'s notifications in `states` (unseen,seen,done), newest first. */
export async function notifications(h, user, states = 'unseen,seen,done') {
  const r = await h.api(user, 'GET', `/notification/user_notifications?limit=100&states=${states}`);
  return { status: r.status, items: Array.isArray(r.body?.items) ? r.body.items : [] };
}

/** The notification of event type `type` whose metadata or entity names `id`. */
export function findNotification(items, type, id) {
  return (items || []).find((n) => n.notification_event_type === type
    && (n.entity_id === id || JSON.stringify(n.notification_metadata ?? {}).includes(id))) ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// Drive uploads (features/drive-view/drive-create-menu.tsx 新建 → 上传文件; lib/core/util/filePicker.ts adds a
// transient input[type=file], so the file goes through the file chooser).

/** Upload `file` ({ name, mimeType, buffer }) in Drive as a person does; returns { url, id, type } of what it opens. */
export async function uploadInDrive(h, user, file) {
  const p = h.u(user).page;
  await p.goto(`${h.BASE}/app/drive`, { waitUntil: 'load' }); await p.waitForTimeout(5000);
  await p.getByRole('button', { name: /^(在.*中新建文件或文件夹|New file or folder in .*)$/ }).first().click();
  await p.waitForTimeout(1200);
  const [chooser] = await Promise.all([
    p.waitForEvent('filechooser', { timeout: 15000 }),
    p.getByText(/^(上传文件|Upload files)$/).first().click(),
  ]);
  await chooser.setFiles(file);
  // Drive's 上传文件 uploads without opening (drive-host-actions.ts: upload(files, false), as upstream macro): the
  // file appears as a row of the list, named without its extension (core/util/upload.ts getFileName), and a click on
  // that row opens it inline at /app/drive/<blockType>/<id> (drive-list.tsx → openEntity → navigation.openRoot).
  const name = file.name.replace(/\.[^.]+$/, '');
  const row = p.getByRole('row').filter({ hasText: name }).first();
  let shown = false;
  for (let i = 0; i < 3 && !shown; i++) {
    shown = await row.waitFor({ state: 'visible', timeout: 30000 }).then(() => true, () => false);
    if (!shown) { await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(5000); }
  }
  if (shown) {
    await row.click();
    await p.waitForURL(/\/app\/(drive\/)?[a-z]+\/[0-9a-f-]{36}/, { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(4000);
  }
  const m = p.url().match(/\/app\/(?:drive\/)?([a-z]+)\/([0-9a-f-]{36})/);
  return { url: p.url(), type: m?.[1] ?? null, id: m?.[2] ?? null };
}

/** Poll the upload until DSS reports its content ready (location_v3, as kailo/deploy/smoke/upload-pdf.ts). */
export async function uploadReady(h, user, id, maxS = 120) {
  const t0 = Date.now(); let last = '';
  while ((Date.now() - t0) / 1000 < maxS) {
    const r = await h.api(user, 'GET', `/dss/documents/${id}/location_v3`);
    last = `${r.status} type=${r.body?.type} state=${r.body?.content?.state}`;
    if (r.status === 200 && r.body?.content?.state === 'ready') return { ok: true, last };
    await h.sleep(3000);
  }
  return { ok: false, last };
}

// ---------------------------------------------------------------------------------------------------------------
// Test files made here (no fixtures in the repo).

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A `w`×`h` RGB PNG: a two-colour diagonal split, so a rendered image is visibly not blank. */
export function pngBytes(w = 96, hgt = 64, a = [37, 99, 235], b = [250, 204, 21]) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(hgt, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 3 + 1) * hgt);
  for (let y = 0; y < hgt; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const c = x * hgt > y * w ? a : b; const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2];
    }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** A one-page PDF whose text is `text` (ASCII), as kailo/deploy/smoke/upload-pdf.ts makes it. */
export function pdfBytes(text) {
  const safe = String(text).replace(/[^\x20-\x7e]/g, '').replace(/[()\\]/g, '');
  const stream = `BT /F1 18 Tf 72 720 Td (${safe}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) pdf += `${String(o).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

// ---------------------------------------------------------------------------------------------------------------
// Properties of tasks (features/property/identifiers.ts system ids; GET /dss/properties/entities/DOCUMENT/{id}).

export const PROP = {
  ASSIGNEES: '00000001-0000-0000-0000-000000000001',
  STATUS: '00000001-0000-0000-0000-000000000002',
  DUE_DATE: '00000001-0000-0000-0000-000000000004',
  PROJECT: '00000001-0000-0000-0000-000000000014',
  TIME_LOGGED: '00000001-0000-0000-0000-000000000016',
};

/** The task's property `defId` (its value object), from the entity's properties. */
export async function taskProperty(h, user, taskId, defId) {
  const r = await h.api(user, 'GET', `/dss/properties/entities/DOCUMENT/${taskId}`);
  const list = Array.isArray(r.body?.properties) ? r.body.properties : [];
  const p = list.find((x) => (x.definition?.id ?? x.property?.definition_id ?? x.property?.property_definition_id) === defId);
  return { status: r.status, prop: p ?? null, raw: r.body };
}

/** What the parity steps made in this state (kind → ids), and forgetting it once deleted (99). */
export const madeEntities = (h) => ({ ...(h.S.made || {}) });
export function forgetMade(h, kind) { if (h.S.made) { delete h.S.made[kind]; h.saveState(); } }
