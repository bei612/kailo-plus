// Web 端真实浏览器走查的浏览器半边（由 web-walkthrough.sh 调用）。
//
// 每一步都对应 Web 端一条会出错的真实路径，断言失败即退出非零。
// 全程记录请求来源、控制台错误与 CSP 违规：Browser 只应与网关同源（DD-39），
// 登录期间另外到达 IdP。

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

const { values: a } = parseArgs({
  options: {
    "gateway-port": { type: "string" },
    "keycloak-port": { type: "string" },
    user: { type: "string" },
    "password-file": { type: "string" },
    "compose-file": { type: "string" },
    "retry-millis": { type: "string" },
    fixture: { type: "string" },
    out: { type: "string" },
  },
});
for (const [k, v] of Object.entries(a)) if (!v) throw new Error(`缺少 --${k}`);

// 浏览器按部署里的名字访问网关与 IdP（OIDC redirect 与 issuer 都是这两个名字），
// 解析到本机发布端口。两个名字取自调用方已载入的 OIDC 配置，不另写一份。
const gateway = new URL(process.env.OIDC_REDIRECT_URI).origin;
const idp = new URL(process.env.OIDC_ISSUER).origin;
const map = (origin, port) => {
  const u = new URL(origin);
  return `MAP ${u.host} 127.0.0.1:${port}`;
};

const browser = await chromium.launch({
  args: [
    `--host-resolver-rules=${map(gateway, a["gateway-port"])}, ${map(idp, a["keycloak-port"])}`,
  ],
});
const page = await browser.newPage();
const origins = new Set();
const consoleErrors = [];
const cspViolations = [];
page.on("request", (r) => origins.add(new URL(r.url()).origin));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const text = m.text();
  (text.includes("Content Security Policy") ? cspViolations : consoleErrors).push(text);
});
page.on("pageerror", (e) => consoleErrors.push(String(e)));
// 控制台的「Failed to load resource」不带 URL；失败响应单独记下地址，
// 每一条都要能说清来历，而不是笼统地归为「预期的噪音」。
const failedResponses = [];
page.on("response", (r) => {
  if (r.status() >= 400) failedResponses.push(`${r.status()} ${r.request().method()} ${r.url()}`);
});

const steps = [];
const step = async (name, fn) => {
  const started = Date.now();
  try {
    await fn();
  } catch (e) {
    // 失败时留下现场：截图、页面上的状态文案、到此为止的控制台错误
    // 页面可能正在导航：截图失败不能掩盖真正的错误
    await page
      .screenshot({ path: path.join(a.out, "failed.png"), fullPage: true, timeout: 5_000 })
      .catch(() => undefined);
    const shown = await page.getByRole("status").allInnerTexts().catch(() => []);
    console.error(`✗ ${name}\n  URL: ${page.url()}\n  status: ${JSON.stringify(shown)}`);
    console.error(`  console errors: ${JSON.stringify(consoleErrors.slice(-10), null, 2)}`);
    throw e;
  }
  steps.push({ name, ms: Date.now() - started });
  console.log(`✓ ${name}`);
};
const shot = (name) => page.screenshot({ path: path.join(a.out, `${name}.png`), fullPage: true });
const status = page.getByRole("status");
// 浏览器语言为 en（Playwright 默认），断言用英文文案
const SYNCED = "Synced";
// 等待上界：BFF 重启与 SSE 重连间隔之和再加余量。间隔来自部署，不另设常量。
const retry = Number(a["retry-millis"]);
const bound = retry * 10 + 30_000;

await step("未登录访问 /app/ 被带到 IdP，登录后回到 /app/", async () => {
  await page.goto(`${gateway}/app/`);
  if (!page.url().startsWith(idp)) throw new Error(`应被带到 IdP，实际 ${page.url()}`);
  await page.fill("#username", a.user);
  await page.fill("#password", fs.readFileSync(a["password-file"], "utf8").trim());
  await Promise.all([page.waitForURL(`${gateway}/app/**`), page.click("#kc-login")]);
});

await step("会话与 Workspace 解析，频道流进入已同步", async () => {
  await page.getByRole("combobox", { name: "Workspace" }).waitFor();
  await status.filter({ hasText: SYNCED }).waitFor({ timeout: bound });
  const name = await page.locator("header span").first().innerText();
  if (/^[0-9a-f]{8}$/.test(name)) throw new Error(`头部显示的是 ID 片段而非显示名：${name}`);
  await shot("01-channel-synced");
});

const nonce = `walkthrough-${Date.now()}`;
const message = page.getByRole("list", { name: "Channel" });
const input = page.getByRole("textbox", { name: "Message" });

await step("发送消息：经 BFF 代签，由流回显后才出现，作者显示为成员名", async () => {
  await input.fill(`${nonce} first`);
  await input.press("Enter");
  const item = message.getByRole("listitem").filter({ hasText: `${nonce} first` });
  await item.waitFor({ timeout: bound });
  // 回显可能先于发布响应到达（Relay 先广播、BFF 后返回），所以等草稿清空，
  // 而不是在回显那一刻就断言
  await page.waitForFunction(
    (el) => el instanceof HTMLInputElement && el.value === "",
    await input.elementHandle(),
    { timeout: bound },
  );
  const text = await item.innerText();
  if (/^[0-9a-f]{8}…/.test(text)) throw new Error(`作者应显示为成员名，实际 ${text}`);
  await shot("02-message-echoed");
});

await step("发送失败：草稿保留、明确报错，不假装已发出", async () => {
  const url = `**/api/v1/workspaces/*/messages`;
  await page.route(url, (r) =>
    r.request().method() === "POST" ? r.fulfill({ status: 503 }) : r.continue(),
  );
  await input.fill(`${nonce} rejected`);
  await input.press("Enter");
  await page.getByRole("alert").waitFor();
  if ((await input.inputValue()) !== `${nonce} rejected`) throw new Error("发送失败时草稿必须保留");
  if (await message.getByText(`${nonce} rejected`).count())
    throw new Error("被拒绝的消息不得出现在列表里");
  await shot("03-send-failed");
  await page.unroute(url);
  await input.fill("");
});

await step("BFF 重启：状态如实离开已同步，恢复后续流并能继续收发", async () => {
  execFileSync("docker", ["compose", "-f", a["compose-file"], "stop", "core-bff"], {
    stdio: "ignore",
  });
  await page.waitForFunction(
    (synced) => document.querySelector('[role="status"]')?.textContent !== synced,
    SYNCED,
    { timeout: bound },
  );
  const during = await status.innerText();
  await shot("04-bff-down");
  // Core 的引导凭据是一次性投递（DD-70）：原样 start 会拿着已消费的 wrapping
  // token 启动并被拒。重启一律经 start-core.sh 现取投递。
  execFileSync("bash", [path.join(path.dirname(a["compose-file"]), "start-core.sh")], {
    stdio: "ignore",
  });
  await status.filter({ hasText: SYNCED }).waitFor({ timeout: bound });
  await input.fill(`${nonce} after-restart`);
  await input.press("Enter");
  await message
    .getByRole("listitem")
    .filter({ hasText: `${nonce} after-restart` })
    .waitFor({ timeout: bound });
  // 重连后首条消息仍在：snapshot 或续流都不得丢掉断线前的历史
  await message.getByRole("listitem").filter({ hasText: `${nonce} first` }).waitFor();
  steps.push({ name: "断线期间的状态文案", value: during });
  await shot("05-after-restart");
});

await step("发布结果不明：Relay 不可达时显示待确认与操作号，不说成功也不说失败", async () => {
  execFileSync("docker", ["compose", "-f", a["compose-file"], "stop", "buzz-relay"], {
    stdio: "ignore",
  });
  await input.fill(`${nonce} unknown`);
  await input.press("Enter");
  const alert = page.getByRole("alert");
  await alert.filter({ hasText: "not confirmed" }).waitFor({ timeout: bound });
  const text = await alert.innerText();
  // 操作号是查证入口（06 §4）：没有它，「待确认」就无从确认
  if (!/[0-9a-f]{8}-[0-9a-f]{4}-/.test(text)) throw new Error(`待确认提示缺操作号：${text}`);
  if (/Send failed/.test(text)) throw new Error("结果不明不得说成失败");
  if ((await input.inputValue()) !== `${nonce} unknown`) throw new Error("结果不明时草稿必须保留");
  if (await message.getByText(`${nonce} unknown`).count())
    throw new Error("未确认的消息不得出现在列表里");
  steps.push({ name: "结果不明的提示", value: text });
  await shot("05b-publish-unknown");
  execFileSync("docker", ["compose", "-f", a["compose-file"], "start", "buzz-relay"], {
    stdio: "ignore",
  });
  await status.filter({ hasText: SYNCED }).waitFor({ timeout: bound });
  // Relay 恢复后原样再点发送：同一次发送意图带同一个幂等键，BFF 回答原操作的
  // 结论（仍待确认、同一个操作号），而不是再发一条（DD-81）
  const reference = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0];
  await input.press("Enter");
  await page.waitForTimeout(retry);
  const again = await alert.innerText();
  if (!reference || !again.includes(reference))
    throw new Error(`重发应回答原操作 ${reference}，实际：${again}`);
  if (await message.getByText(`${nonce} unknown`).count())
    throw new Error("重发不得产生一条新消息");
  steps.push({ name: "结果不明后重发", value: again });
  await input.fill("");
});

// 1×1 PNG。Relay 按内容校验图片，不能拿任意字节冒充 image/png。
const PNG_1X1 = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c63f8cfc0000003010100c9fe92ef0000000049454e44ae426082",
  "hex",
);
const walkStarted = Math.floor(Date.now() / 1_000);
const userState = () =>
  page.evaluate(() => fetch("/api/v1/user-state").then((r) => r.json()));

await step("附件：图片经 BFF 代签上传、随消息发出，再经 BFF 同源读取渲染", async () => {
  await page.getByTestId("attach-input").setInputFiles({
    name: "probe.png",
    mimeType: "image/png",
    buffer: PNG_1X1,
  });
  await page.getByRole("list", { name: "Attachments" }).getByText("probe.png").waitFor({ timeout: bound });
  await input.fill(`${nonce} with-image`);
  await input.press("Enter");
  const item = message.getByRole("listitem").filter({ hasText: `${nonce} with-image` });
  await item.waitFor({ timeout: bound });
  const img = item.locator("img");
  await img.waitFor({ timeout: bound });
  await page.waitForFunction(
    (el) => el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0,
    await img.elementHandle(),
    { timeout: bound },
  );
  const src = await img.getAttribute("src");
  if (!src?.startsWith("/api/v1/workspaces/")) throw new Error(`图片必须经 BFF 读取，实际 ${src}`);
  await page.getByRole("list", { name: "Attachments" }).waitFor({ state: "detached", timeout: bound });
  await shot("06-image-message");
});

await step("收藏与静音：写入 Core 用户状态，刷新页面后仍在", async () => {
  const star = page.getByRole("button", { name: "Star this workspace" });
  const mute = page.getByRole("button", { name: /^Mute this workspace/ });
  await star.click();
  await page.waitForFunction(() =>
    document.querySelector('button[aria-label="Star this workspace"]')?.getAttribute("aria-pressed") === "true",
  );
  await mute.click();
  await page.waitForFunction(() =>
    document.querySelector('button[aria-label^="Mute this workspace"]')?.getAttribute("aria-pressed") === "true",
  );
  await page.reload();
  await status.filter({ hasText: SYNCED }).waitFor({ timeout: bound });
  if ((await star.getAttribute("aria-pressed")) !== "true") throw new Error("刷新后收藏丢失");
  if ((await mute.getAttribute("aria-pressed")) !== "true") throw new Error("刷新后静音丢失");
  const option = await page.getByRole("combobox", { name: "Workspace" }).locator("option").first().innerText();
  if (!option.startsWith("★ ")) throw new Error(`收藏的 Workspace 应排在最前并标记，实际 ${option}`);
  const state = await userState();
  const pref = Object.values(state.workspacePreferences)[0];
  if (!pref?.updatedAt || Number.isNaN(Date.parse(pref.updatedAt)))
    throw new Error(`偏好必须带库时钟写入的 updatedAt，实际 ${JSON.stringify(pref)}`);
  await shot("07-starred-muted");
});

await step("已读：频道同步且页面可见时，已读位置推进到最新消息", async () => {
  await page.waitForFunction(
    (since) =>
      fetch("/api/v1/user-state")
        .then((r) => r.json())
        .then((s) => Object.values(s.readContexts).some((v) => Date.parse(v) / 1_000 >= since)),
    walkStarted,
    { timeout: bound, polling: 500 },
  );
  const state = await userState();
  const values = Object.values(state.readContexts);
  if (!values.every((v) => /Z$/.test(v))) throw new Error(`已读时间必须是 UTC，实际 ${values}`);
});

await step("成员页：本人 ACTIVE，协议身份按上游统一形式缩写", async () => {
  await page.getByRole("button", { name: "Members" }).click();
  const row = page.getByRole("row").filter({ hasText: "ACTIVE" });
  await row.first().waitFor();
  const roles = page.getByTestId("role-members");
  await roles.getByText("Administrator roles").waitFor();
  await roles.getByText("Tenant admin", { exact: true }).first().waitFor();
  await roles.getByRole("button", { name: "Grant" }).first().waitFor();
  await shot("08-members");
});

await step("审计页：本人的消息发布有记录，且不含正文", async () => {
  await page.getByRole("button", { name: "Audit" }).click();
  await page.getByRole("row").filter({ hasText: "workspace.message.publish" }).first().waitFor();
  if (await page.getByText(nonce).count()) throw new Error("审计页不得出现消息正文");
  await shot("09-audit");
});

await step("设备页：列出本人登记的原生设备，未登记时如实说明", async () => {
  await page.getByRole("button", { name: "Devices" }).click();
  await page.getByText("No devices yet").waitFor();
  await shot("10-devices");
});

// 两条审批由夹具备好（verify_workspace --governance）：核验用户自己发起、待别人批准
// 的一条，与别人发起、待核验用户批准的一条。
const fixture = JSON.parse(fs.readFileSync(a.fixture, "utf8"));
const bff = (method, url, body) =>
  page.evaluate(
    ([m, u, b]) =>
      fetch(u, {
        method: m,
        headers: b ? { "Content-Type": "application/json" } : {},
        body: b ? JSON.stringify(b) : undefined,
      }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) })),
    [method, url, body],
  );
const approvalPath = (wf) => `/api/v1/approvals/${encodeURIComponent(wf)}`;
// 列表之外没有推送：看不到就按「刷新」再读，直到上界
const refreshUntil = async (locator) => {
  const deadline = Date.now() + bound;
  while (!(await locator.count())) {
    if (Date.now() > deadline) throw new Error("等待列表出现条目超时");
    await page.getByRole("button", { name: "Refresh" }).click();
    await page.waitForTimeout(1_000);
  }
};

await step("任务页：本人的待审批任务如实显示；撤回需确认、经 BFF，结论以服务端为准", async () => {
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: "tenant.member.revoke" });
  await refreshUntil(row.filter({ hasText: "Waiting for approval" }));
  await row.getByRole("button", { name: "tenant.member.revoke" }).click();
  const detail = page.getByTestId("task-detail");
  await detail.getByText("Waiting for approval. (WAITING_APPROVAL)").waitFor();
  // operation 是查证入口：详情必须给出
  if (!/[0-9a-f]{8}-[0-9a-f]{4}-/.test(await detail.innerText()))
    throw new Error("任务详情缺 operation ID");
  await detail.getByText("Organization admin: at least 1").waitFor();
  await detail.getByRole("button", { name: "Withdraw request" }).click();
  await detail.getByText("The action will not be carried out").waitFor();
  await detail.getByRole("button", { name: "Confirm" }).click();
  await detail.getByRole("status").filter({ hasText: "The request is now: Withdrawn." }).waitFor({ timeout: bound });
  // 结论已确定而写回可能还没到 Core：此刻不得再给撤回（投影仍可能是未决）
  if (await detail.getByRole("button", { name: "Withdraw request" }).count())
    throw new Error("撤回已确定后仍给出撤回");
  // 任务的门禁由审批写回推进：按「刷新」重读，直到投影追上（收敛上界内）
  const withdrawn = detail.getByText("The request was withdrawn. (APPROVAL_WITHDRAWN)");
  const deadline = Date.now() + bound;
  while (!(await withdrawn.count())) {
    if (Date.now() > deadline) throw new Error("撤回后任务门禁未在上界内更新");
    await detail.getByRole("button", { name: "Refresh" }).first().click();
    await page.waitForTimeout(1_000);
  }
  const task = await bff("GET", `/api/v1/tasks/${fixture.myTask}`);
  if (task.body?.gateState !== "REVOKED" || task.body?.reason !== "APPROVAL_WITHDRAWN")
    throw new Error(`撤回后门禁应为 REVOKED/APPROVAL_WITHDRAWN，实际 ${JSON.stringify(task)}`);
  await shot("11a-task-withdrawn");
});

await step("审批页：待我审批可见；批准需确认、经 Temporal Update，同值幂等、冲突值拒绝", async () => {
  await page.getByRole("button", { name: "Approvals", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: "tenant.member.revoke" });
  // 「待我审批」用低延迟一致性：刚写入的 admin 关系可能要等一个 quantization 窗口
  await refreshUntil(row);
  await row.getByRole("button", { name: "tenant.member.revoke" }).click();
  const detail = page.getByTestId("approval-detail");
  await detail.getByRole("button", { name: "Approve" }).click();
  await detail.getByText("cannot be changed afterwards").waitFor();
  await detail.getByRole("button", { name: "Confirm" }).click();
  const recorded = detail.getByRole("status").filter({ hasText: "Your decision “Approve” is recorded" });
  await recorded.waitFor({ timeout: bound });
  const outcome = await recorded.innerText();
  const path = `${approvalPath(fixture.approvalForMe)}/decision`;
  const same = await bff("POST", path, { decision: "APPROVE" });
  if (same.status !== 200 || same.body?.decision !== "APPROVE")
    throw new Error(`同值重发应幂等地拿回原决定，实际 ${JSON.stringify(same)}`);
  const conflict = await bff("POST", path, { decision: "DENY" });
  if (conflict.status !== 409 || conflict.body?.reason !== "DUPLICATE_DECISION")
    throw new Error(`冲突值应以 DUPLICATE_DECISION 拒绝，实际 ${JSON.stringify(conflict)}`);
  steps.push({ name: "批准后的回应", value: outcome });
  await shot("11b-approval-decided");
});

await step("邀请：admin 签发的链接只显示一次、列表不含凭据、撤回需确认；兑换页读完 fragment 即清掉", async () => {
  await page.getByRole("button", { name: "Members", exact: true }).click();
  const section = page.getByTestId("tenant-invitations");
  await section.waitFor({ timeout: bound });
  const label = `walkthrough ${nonce}`;
  await section.getByLabel("Who is this for?").fill(label);
  await section.getByRole("button", { name: "Create invitation link" }).click();
  const issued = section.getByTestId("issued-invitation");
  await issued.waitFor({ timeout: bound });
  const link = await issued.getByRole("textbox").inputValue();
  const credential = new URL(link).hash.slice(1);
  if (!/^[0-9a-f]{64}$/.test(credential)) throw new Error(`链接的 fragment 不是一次性凭据：${link.replace(credential, "<凭据>")}`);
  // 链接必须落在 Web 的兑换页：网关只把 /app 前缀交给 Web，其余到 BFF
  const target = new URL(link);
  if (target.origin !== gateway || target.pathname !== "/app/invite")
    throw new Error(`邀请链接不在 Web 兑换页（${gateway}/app/invite），实际 ${target.origin}${target.pathname}——检查 TENANT_INVITATION_LINK_BASE`);
  const row = section.getByRole("row").filter({ hasText: label });
  await row.waitFor({ timeout: bound });
  if ((await section.getByRole("table").innerText()).includes(credential)) throw new Error("邀请列表里出现了凭据");
  await shot("11c-invitation-issued");
  await row.getByRole("button", { name: "Withdraw" }).click();
  await section.getByText("Its link will stop working").waitFor();
  await section.getByRole("button", { name: "Confirm" }).click();
  await row.filter({ hasText: "Withdrawn" }).waitFor({ timeout: bound });

  // 兑换页：以核验用户（已是成员）打开已撤回的链接——凭据从地址栏清掉、只进请求体，
  // 服务端的拒绝以用户能懂的话加 reason code 显示
  const seen = [];
  const onRequest = (r) => seen.push(r.url());
  page.on("request", onRequest);
  await page.goto(link);
  await page.getByTestId("invitation-redeem").waitFor({ timeout: bound });
  if (page.url().includes("#")) throw new Error(`兑换页没有清掉 fragment：${page.url().replace(credential, "<凭据>")}`);
  await page.getByLabel("Your name").fill("Walkthrough");
  await page.getByRole("button", { name: "Use this invitation" }).click();
  const alert = page.getByTestId("invitation-redeem").getByRole("alert");
  await alert.filter({ hasText: "could not be used" }).waitFor({ timeout: bound });
  const text = await alert.innerText();
  if (!/\((INVITATION_REVOKED|INVITEE_ALREADY_MEMBER)\)/.test(text))
    throw new Error(`已撤回的邀请应被拒绝并给出 reason code，实际 ${text}`);
  page.off("request", onRequest);
  if (seen.some((u) => u.includes(credential))) throw new Error("凭据出现在了请求 URL 里");
  steps.push({ name: "兑换已撤回的邀请", value: text });
  await shot("11d-redeem-rejected");
  await page.goto(`${gateway}/app/`);
  await page.getByRole("combobox", { name: "Workspace" }).waitFor({ timeout: bound });
});

await step("浏览器不能自称原生端：网关移除伪造的入口标识（DD-78）", async () => {
  // 标识若穿过网关，BFF 会越过入口检查、转而判持钥证明无效；两个 reason 因此
  // 能区分「网关移除了它」与「它到达了 BFF」。
  const reply = await page.evaluate(() =>
    fetch("/api/v1/identity/client-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-kailo-client-surface": "native" },
      body: JSON.stringify({ proof: {} }),
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) })),
  );
  if (reply.status !== 403 || reply.body?.reason !== "NATIVE_SURFACE_REQUIRED")
    throw new Error(`伪造的原生入口标识应被网关移除，实际 ${JSON.stringify(reply)}`);
  steps.push({ name: "伪造原生入口标识的回应", value: reply.body.reason });
});

await step("注销：撤掉 Core 会话与网关 cookie；再次进入是一次新的登录", async () => {
  const session = () =>
    page.evaluate(() =>
      fetch("/api/v1/session").then((r) => (r.ok ? r.json() : { status: r.status })),
    );
  const gatewayCookie = async () =>
    (await page.context().cookies(gateway)).find((c) => c.name.startsWith("agw_oidc_s_"))?.value;
  const before = await session();
  const cookieBefore = await gatewayCookie();
  if (!before.platformSessionId || !cookieBefore) throw new Error("注销前应有会话与网关 cookie");

  // 注销后浏览器经 IdP 回到 /app/。IdP 自己的会话若还在，这一程不要求口令
  // （SF-AGW-23、.design/09）——那不是 Kailo 的会话，下面要证明的是 Kailo 侧
  // 旧会话已失效、旧 cookie 已清除，重新进入得到的是新会话。
  // 离开平台页后要么停在 IdP 登录页，要么被 IdP 的存活会话直接放回来——
  // 那是 IdP 自己的策略，这里两种都接受。必须等一次真实的导航提交之后再
  // 判断落点：点击的那一刻 URL 还是 /app/，按 URL 等会立刻「等到」。
  await Promise.all([
    page.waitForEvent("framenavigated", {
      predicate: (f) => f === page.mainFrame(),
      timeout: bound,
    }),
    page.getByRole("button", { name: "Sign out" }).click(),
  ]);
  await page.waitForLoadState("networkidle");
  let reentry;
  if (new URL(page.url()).origin === idp) {
    await page.locator("#username").waitFor({ timeout: bound });
    reentry = "IdP 要求重新输入口令";
    await shot("10-idp-login-after-sign-out");
    await page.fill("#username", a.user);
    await page.fill("#password", fs.readFileSync(a["password-file"], "utf8").trim());
    await Promise.all([page.waitForURL(`${gateway}/app/**`), page.click("#kc-login")]);
  } else {
    reentry = "IdP 会话仍在，未要求口令";
  }
  await page.waitForLoadState("networkidle");
  const after = await session();
  const cookieAfter = await gatewayCookie();
  if (cookieAfter === cookieBefore) throw new Error("注销后网关 cookie 未被清除");
  if (after.platformSessionId === before.platformSessionId)
    throw new Error("重新进入后沿用了注销前的会话");
  fs.writeFileSync(path.join(a.out, "revoked-session.txt"), `${before.platformSessionId}\n`);
  steps.push({ name: "注销后重新进入", value: `${reentry}；得到新会话` });
  await shot("12-after-reentry");
});

await browser.close();

const allowed = new Set([gateway, idp]);
const stray = [...origins].filter((o) => !allowed.has(o));
const summary = {
  steps,
  origins: [...origins].sort(),
  strayOrigins: stray,
  consoleErrors,
  failedResponses,
  cspViolations,
};
fs.writeFileSync(path.join(a.out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
if (stray.length || cspViolations.length) {
  console.error("出现了网关与 IdP 以外的来源，或 CSP 违规");
  process.exit(1);
}
