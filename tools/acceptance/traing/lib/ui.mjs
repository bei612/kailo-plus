// Kailo web and API helpers shared by the steps (zh-CN first, English accepted where a string may not be translated yet,
// so a missing translation fails the TE-16 text checks, not the flow).
import { afterMessage, findByTitle, FAILURE_RE, hasAnswer, oneTimeMarker } from './util.mjs';

export const L = {
  login: /^(Continue|继续)$/,
  onboarding: /^(Get started|Continue|Skip|Skip for now|Next|Not now|Maybe later|Finish|Done|Continue with Free|Continue to workspace|开始使用|开始|继续|跳过|暂时跳过|下一步|稍后|完成|以后再说|创建团队|创建工作区|继续使用免费版|继续使用 Free|进入工作区)$/,
  invite: /^(邀请工作区成员|Invite workspace members)$/,
  emailPh: /^(输入邮箱地址|Enter email address)$/,
  addAnother: /^(再添加一个|Add another)$/,
  sendInvite: /(发送.*邀请|^Send)/,
  join: /^(加入|Join)$/,
  accept: /^(接受邀请|接受|加入|Accept|Join)$/,
  addAgent: /^(添加 Agent|Add agent)$/,
  createAgent: /^(创建 Agent|Create agent)$/,
  codex: /^(在 Kailo Codex 中|In Kailo Codex)$/,
  teamVisibility: /^(团队|Team)$/,
  // Copy fallbacks only; channel tabs are found by their stable value (channelTab below). TG-04: 成员.
  participants: /^(成员|参与者|Participants)$/,
  messagesTab: /^(消息|Messages)$/,
  searchBots: /^(按名称或句柄搜索机器人|Search bots by name or handle)$/,
  inviteBot: /^(邀请机器人|Invite bot)$/,
  openSession: /^(打开会话|Open Session)$/,
  edit: /^(编辑|Edit)$/,
  ok: /^(确定|OK|Apply)$/,
  cancel: /^(取消|Cancel)$/,
  save: /^(保存|Save)$/,
  approve: /^(批准|Approve)$/,
  exportEvents: /^(导出事件|Export events)$/,
  exportSubmit: /^(申请导出|Request export)$/,
  pickWorkspace: /^(选择工作区…|Choose a Workspace…|Pick a Workspace…)$/,
};

export const AGENTS = {
  doc: { name: '文档助理', handle: 'tg-doc', ins: '你是 Kailo 工作区的文档助理。被提及时，根据频道里的讨论用 Kailo 工具新建或修改文档，写入完整的中文内容，完成后在频道里用中文回复文档标题和要点。' },
  research: { name: '资料员', handle: 'tg-research', ins: '你是 Kailo 工作区的资料员。被提及时，用 Kailo 的搜索与读取工具查找工作区里已有的文档和任务，阅读后用中文给出简明汇总，并列出引用的文档/任务标题。' },
  task: { name: '任务协调', handle: 'tg-task', ins: '你是 Kailo 工作区的任务协调员。被提及时，按要求用 Kailo 工具创建任务、指派负责人、设置截止日期；需要稍后跟进时用跟进工具设定提醒；需要定时或周期执行的事项用 Routine 工具创建；需要人确认的事项用 RenderSurface 出确认卡片，等人确认后再执行。完成后用中文回复。' },
  kailo: { name: 'Kailo 助手', handle: 'kailo' },
};

/**
 * Open a channel tab by its stable value (features/channel/Channel/channel-tabs.ts: messages | attachments | calls |
 * participants): the tabs are a Kobalte segmented control, one radio input per tab carrying that value. The visible
 * copy (成员 / 参与者 / Participants …) is only the fallback.
 */
export async function channelTab(page, value) {
  const radio = page.locator(`[role=radiogroup] input[type=radio][value="${value}"]`).first();
  if (await radio.count()) {
    await radio.locator('xpath=..').click();
    return true;
  }
  const copy = { participants: L.participants, messages: L.messagesTab }[value];
  if (!copy) return false;
  const t = page.getByText(copy).first();
  if (!(await t.count())) return false;
  await t.click();
  return true;
}

export async function settings(h, page, slug, wait = 5000) {
  await page.goto(`${h.BASE}/app/settings${slug ? '/' + slug : ''}`, { waitUntil: 'load' });
  await page.waitForTimeout(wait);
}

export async function workspaces(h, user) {
  const r = await h.api(user, 'GET', '/auth/team/workspaces');
  return Array.isArray(r.body) ? r.body : [];
}

export async function setCurrent(h, user, teamId) {
  const r = await h.api(user, 'PUT', '/auth/team/current', { team_id: teamId });
  h.log(user, 'current ->', teamId, r.status);
  return r.status;
}

/** A new markdown document from Home (the "c" shortcut), titled `title`, with `body` typed into it. */
export async function newDoc(h, page, title, body) {
  await page.goto(`${h.BASE}/app/home`, { waitUntil: 'load' });
  await page.waitForTimeout(4000);
  await page.locator('body').click({ position: { x: 900, y: 120 } });
  await page.keyboard.press('c'); await page.waitForTimeout(1500); await page.keyboard.press('Enter');
  await page.waitForURL(/\/app\/drive\/md\//, { timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll('[contenteditable=true]').length >= 3, null, { timeout: 60000 });
  await page.waitForTimeout(1000);
  const eds = page.locator('[contenteditable=true]');
  await eds.nth(0).click(); await page.keyboard.type(title, { delay: 20 });
  await eds.nth(1).click(); await page.waitForTimeout(500);
  if (body) { await page.keyboard.type(body, { delay: 8 }); await page.waitForTimeout(3000); }
  const id = page.url().match(/\/md\/([0-9a-f-]{36})/)?.[1];
  return { url: page.url(), id };
}

export async function say(h, user, chanUrl, msg) {
  const p = h.u(user).page;
  const box = p.locator('div[role="textbox"][contenteditable="true"]').last();
  // On the channel's other tabs (参与者 etc.) the URL still starts with the channel URL but there is no composer.
  if (!p.url().startsWith(chanUrl) || !(await box.isVisible().catch(() => false))) {
    await p.goto(chanUrl, { waitUntil: 'load' }); await p.waitForTimeout(6000);
    if (!(await box.isVisible().catch(() => false))) { await channelTab(p, 'messages').catch(() => {}); await p.waitForTimeout(3000); }
  }
  await box.click(); await box.pressSequentially(msg, { delay: 15 }); await p.waitForTimeout(500);
  await p.keyboard.press('Enter'); await p.waitForTimeout(2500);
}

/**
 * Mention `agent` in the channel with `msg` and wait for its answer: `okRe` over what follows the message, a non-empty
 * reply by the agent's name (TE-01), and no failure text. Screenshots: menu, sent, result.
 */
/**
 * The Agent's turn is still running: the thread ends on its live status (the narration of a running turn can contain
 * the words a step waits for, 2026-11-23 ⑦: "Now appending the 风险与应对 section … Working on it…").
 */
const BUSY_RE = /(Working on it…|Thinking it through…|Thinking|思考中|正在处理)\s*$/;
function turnBusy(after) {
  const tail = String(after).replace(/\s*(未读通知\s*\d+\s*)?输入 @ 与 #\S+ 分享\s*$/, '').replace(/\s*未读通知\s*\d+\s*$/, '');
  return BUSY_RE.test(tail);
}

export async function ask(h, user, chanUrl, agent, msg, label, okRe, maxS = h.cfg.askTimeoutS) {
  const p = h.u(user).page;
  // Every prompt carries a one-time marker; the answer is read only after the message that carries it.
  const marker = oneTimeMarker(h.cfg.runId, label);
  const prompt = msg;
  msg = `${prompt} ${marker}`;
  await p.goto(chanUrl, { waitUntil: 'load' }); await p.waitForTimeout(5000);
  const box = p.locator('div[role="textbox"][contenteditable="true"]').last();
  let menuOk = false;
  for (let attempt = 0; attempt < 4 && !menuOk; attempt++) {
    await box.click(); await p.keyboard.press('Control+a'); await p.keyboard.press('Backspace'); await p.waitForTimeout(400);
    await box.pressSequentially('@' + agent.handle, { delay: 150 }); await p.waitForTimeout(3500);
    menuOk = (await p.getByText(agent.name, { exact: false }).count()) > 0 || (await p.locator('[role=listbox],[role=option],[role=menu]').count()) > 0;
  }
  await h.shot(p, `${label}-a-menu`);
  await p.keyboard.press('Enter'); await p.waitForTimeout(1200);
  await box.click(); await p.keyboard.press('End'); await p.waitForTimeout(300);
  await box.pressSequentially(' ' + msg, { delay: 20 }); await p.waitForTimeout(800);
  const composed = (await box.innerText()).replace(/\s+/g, ' ');
  await p.keyboard.press('Enter');
  const t0 = Date.now(); await p.waitForTimeout(4000);
  await h.shot(p, `${label}-b-sent`);
  let ok = false; let after = '';
  while ((Date.now() - t0) / 1000 < maxS) {
    await p.waitForTimeout(10000);
    after = afterMessage(await h.text(p), marker);
    if (FAILURE_RE.test(after) || (okRe.test(after) && hasAnswer(after, agent.name) && !turnBusy(after))) { ok = !FAILURE_RE.test(after); break; }
  }
  await p.waitForTimeout(6000);
  after = afterMessage(await h.text(p), marker);
  await h.shot(p, `${label}-c-result`);
  const seconds = Math.round((Date.now() - t0) / 1000);
  const answered = hasAnswer(after, agent.name);
  const failed = FAILURE_RE.test(after);
  h.log(label, 'composer', composed.slice(0, 160));
  h.log(label, 'after', seconds, 's:', after.slice(0, 900).replace(/\n/g, ' | '));
  return { ok: ok && answered && !failed, answered, failed, after, seconds, sentAt: t0, marker, sent: msg, prompt,
    markerSent: composed.includes(marker), mentioned: composed.includes(agent.handle) || composed.includes(agent.name) };
}

/** Invite the Agents `handles` into the channel through its participants panel. */
export async function inviteBots(h, user, chanUrl, handles, label) {
  const a = h.u(user).page;
  await a.goto(chanUrl, { waitUntil: 'load' }); await a.waitForTimeout(5000);
  if (!(await channelTab(a, 'participants'))) throw new Error('channel participants tab not found');
  await a.waitForTimeout(4000);
  for (const hd of handles) {
    const bi = a.getByPlaceholder(L.searchBots);
    await bi.click(); await bi.fill(''); await a.keyboard.type(hd, { delay: 80 }); await a.waitForTimeout(3000);
    const opt = a.getByText('@' + hd, { exact: true }).last();
    if (await opt.count()) {
      await opt.click(); await a.waitForTimeout(1000);
      const btn = a.getByRole('button', { name: L.inviteBot });
      // A bot already in the channel leaves the invite button disabled (re-runs).
      if (await btn.isEnabled().catch(() => false)) { await btn.click(); await a.waitForTimeout(3000); } else h.log('already in the channel', hd);
    }
    else h.warn('bot option missing', hd);
  }
  await a.reload({ waitUntil: 'load' }); await a.waitForTimeout(5000);
  await channelTab(a, 'participants'); await a.waitForTimeout(4000);
  await h.shot(a, label);
  return h.text(a);
}

/** Every Agent installation `user` can see (GET /dss/bots). */
export async function bots(h, user) {
  const r = await h.api(user, 'GET', '/dss/bots');
  return Array.isArray(r.body) ? r.body : [];
}

/** Documents (and tasks, which are documents) of `user` whose title matches `re`. */
export async function findDocs(h, user, re) {
  const out = [];
  for (const p of ['/dss/documents?limit=200', '/dss/documents/list']) {
    const r = await h.api(user, 'GET', p);
    if (r.status === 200) out.push(...findByTitle(r.body, re));
  }
  const seen = new Set();
  return out.filter((d) => !seen.has(d.id) && seen.add(d.id));
}

export async function docText(h, user, id) {
  const r = await h.api(user, 'GET', `/dss/documents/${id}/text-content`);
  return { status: r.status, text: r.body?.text ?? '' };
}

/** Poll the channel until `re` matches the text after `anchor` (or the whole page); returns when it first matched. */
export async function waitChannel(h, user, chanUrl, re, untilMs, anchor, pollMs = 15000) {
  const p = h.u(user).page;
  while (Date.now() < untilMs) {
    await p.goto(chanUrl, { waitUntil: 'load' }); await p.waitForTimeout(6000);
    const t = await h.text(p);
    const scope = anchor ? afterMessage(t, anchor) : t;
    if (re.test(scope)) return { at: Date.now(), text: scope };
    await p.waitForTimeout(pollMs);
  }
  return { at: null, text: '' };
}

/** Audit events through the governed API (`/dss/audit/events`). */
export async function audit(h, user, q) {
  const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])).toString();
  const r = await h.api(user, 'GET', `/dss/audit/events?${qs}`);
  return { status: r.status, events: Array.isArray(r.body?.events) ? r.body.events : [], body: r.body };
}

/** Text of the page minus the sidebar noise, for zh-CN checks. */
export async function mainText(h, page) {
  const m = page.locator('main, [role=main]');
  if (await m.count()) return (await m.first().innerText().catch(() => '')) || h.text(page);
  return h.text(page);
}
