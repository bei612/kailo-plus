// 平台页与原生登录引导的文案。key 只在这里定义一次：Web 的消息表把它并入自己的表
// （同一个 key 不在两处各写一份），Desktop 直接用这里的翻译。
//
// 契约枚举（reason code、审批状态、决定、审批选择器）的文案按枚举穷举：契约新增一个
// 值时这里编译不过，逼着给出说明，而不是让新值悄悄落进一个笼统的「出错了」。code
// 本身是稳定标识，界面同时显示文案与 code（apps/06 §4）。

import { ApprovalDecision, ApprovalSelector, ApprovalStatus, ReasonCode } from "@kailo/contracts";

export type PlatformLocale = "en" | "zh-CN";

type Message = { readonly en: string; readonly "zh-CN": string };

export const platformMessages = {
  "platform.title": { en: "Kailo", "zh-CN": "Kailo" },
  "platform.workspace": { en: "Workspace", "zh-CN": "工作区" },
  "platform.tab.members": { en: "Members", "zh-CN": "成员" },
  "platform.tab.audit": { en: "Audit", "zh-CN": "审计" },
  "platform.tab.devices": { en: "Devices", "zh-CN": "设备" },
  "platform.tab.tasks": { en: "Tasks", "zh-CN": "任务" },
  "platform.tab.approvals": { en: "Approvals", "zh-CN": "审批" },
  "platform.signOut": { en: "Sign out", "zh-CN": "退出" },
  "platform.sessionUnavailable": { en: "Session unavailable", "zh-CN": "会话不可用" },
  "platform.loading": { en: "Loading…", "zh-CN": "载入中…" },
  "platform.loadingWorkspaces": { en: "Loading workspaces…", "zh-CN": "正在载入工作区…" },
  "platform.noWorkspace": {
    en: "You have no workspace you can enter in this tenant",
    "zh-CN": "你在该 Tenant 下还没有可进入的工作区",
  },
  "platform.loadFailed": {
    en: "Couldn't load this — the result is unknown.",
    "zh-CN": "未能载入，结果不明。",
  },
  "platform.retry": { en: "Try again", "zh-CN": "重试" },
  "platform.member": { en: "Member", "zh-CN": "成员" },
  "platform.state": { en: "State", "zh-CN": "状态" },
  "platform.protocolIdentity": { en: "Protocol identity", "zh-CN": "协议身份" },
  "platform.time": { en: "Time", "zh-CN": "时间" },
  "platform.type": { en: "Type", "zh-CN": "类型" },
  "platform.action": { en: "Action", "zh-CN": "动作" },
  "platform.result": { en: "Result", "zh-CN": "结果" },
  "platform.audit.none": { en: "No actions recorded yet.", "zh-CN": "还没有记录到动作。" },
  "platform.members.none": {
    en: "This workspace has no members.",
    "zh-CN": "该工作区没有成员。",
  },
  "platform.devices.none": {
    en: "No devices yet. Sign in to Kailo Desktop or Mobile to add one.",
    "zh-CN": "还没有设备。在 Kailo Desktop 或 Mobile 上登录即可添加。",
  },
  "platform.devices.explain": {
    en: "Each device holds its own key. Revoking one stops only that device.",
    "zh-CN": "每台设备各持自己的密钥。撤销只停用那一台设备。",
  },
  "platform.devices.added": { en: "Added", "zh-CN": "添加于" },
  "platform.devices.thisDevice": { en: "This device", "zh-CN": "本机" },
  "platform.devices.revoke": { en: "Revoke", "zh-CN": "撤销" },
  "platform.devices.revokeUnknown": {
    en: "The revocation result is unknown (operation {operation}). Reload to check.",
    "zh-CN": "撤销结果不明（操作 {operation}）。请刷新后确认。",
  },
  "platform.devices.revokeRejected": {
    en: "The revocation was rejected: {reason}",
    "zh-CN": "撤销被拒绝：{reason}",
  },

  "platform.refresh": { en: "Refresh", "zh-CN": "刷新" },
  "platform.back": { en: "Back", "zh-CN": "返回" },
  "platform.confirm": { en: "Confirm", "zh-CN": "确认" },
  "platform.cancel": { en: "Cancel", "zh-CN": "取消" },
  "platform.reasonWithCode": { en: "{text} ({code})", "zh-CN": "{text}（{code}）" },

  "tasks.none": {
    en: "You have not started any governed action yet.",
    "zh-CN": "你还没有发起过受治理的动作。",
  },
  "tasks.created": { en: "Started", "zh-CN": "发起于" },
  "tasks.operation": { en: "Operation", "zh-CN": "操作" },
  "tasks.execution": { en: "Action execution", "zh-CN": "动作执行" },
  "tasks.target": { en: "Target", "zh-CN": "目标" },
  "tasks.workflow": { en: "Workflow", "zh-CN": "Workflow" },
  "tasks.waitingReason": { en: "Waiting for", "zh-CN": "正在等待" },
  "tasks.reason": { en: "Reason", "zh-CN": "原因" },
  "tasks.approval": { en: "Approval", "zh-CN": "审批" },
  "tasks.status.evaluating": { en: "Being evaluated", "zh-CN": "正在判定" },
  "tasks.status.waitingApproval": { en: "Waiting for approval", "zh-CN": "等待审批" },
  "tasks.status.denied": { en: "Not allowed", "zh-CN": "未获准" },
  "tasks.status.revoked": { en: "Withdrawn or no longer allowed", "zh-CN": "已撤回或不再获准" },
  "tasks.status.expired": { en: "Expired", "zh-CN": "已过期" },
  "tasks.status.notStarted": { en: "Allowed, not started yet", "zh-CN": "已获准，尚未开始" },
  "tasks.status.aborted": { en: "Stopped before it took effect", "zh-CN": "生效前已中止" },
  "tasks.status.started": { en: "Started", "zh-CN": "已开始" },
  "tasks.status.applied": { en: "Applied", "zh-CN": "已生效" },
  "tasks.status.running": { en: "Running", "zh-CN": "进行中" },
  "tasks.status.completed": { en: "Completed", "zh-CN": "已完成" },
  "tasks.status.failed": { en: "Failed", "zh-CN": "失败" },
  "tasks.status.canceled": { en: "Canceled", "zh-CN": "已取消" },
  "tasks.status.terminated": { en: "Terminated", "zh-CN": "已终止" },
  "tasks.status.timedOut": { en: "Timed out", "zh-CN": "已超时" },
  "tasks.status.unknown": {
    en: "Outcome not known yet — waiting for reconciliation",
    "zh-CN": "结果尚不明确，等待对账",
  },
  "tasks.status.delayed": {
    en: "Status may be out of date — waiting for reconciliation",
    "zh-CN": "状态可能尚未更新，等待对账",
  },

  "approvals.none": {
    en: "Nothing is waiting for your approval.",
    "zh-CN": "没有等待你审批的请求。",
  },
  "approvals.status": { en: "Approval state", "zh-CN": "审批状态" },
  "approvals.expires": { en: "Expires", "zh-CN": "到期" },
  "approvals.initiator": { en: "Requested by", "zh-CN": "发起者" },
  "approvals.requirements": { en: "Required approvals", "zh-CN": "所需批准" },
  "approvals.requirement": { en: "{selector}: at least {count}", "zh-CN": "{selector}：至少 {count} 人" },
  "approvals.decisions": { en: "Decisions", "zh-CN": "已有决定" },
  "approvals.noDecisions": { en: "No decisions yet.", "zh-CN": "还没有人决定。" },
  "approvals.approve": { en: "Approve", "zh-CN": "批准" },
  "approvals.deny": { en: "Deny", "zh-CN": "拒绝" },
  "approvals.confirmDecision": {
    en: "Record your decision “{decision}”? It cannot be changed afterwards.",
    "zh-CN": "记录你的决定「{decision}」？记录后不能更改。",
  },
  "approvals.decided": {
    en: "Your decision “{decision}” is recorded. The approval is now: {status}.",
    "zh-CN": "你的决定「{decision}」已记录。审批当前状态：{status}。",
  },
  "approvals.decisionUnknown": {
    en: "Whether your decision was recorded is not known (operation {operation}). Sending the same decision again is safe.",
    "zh-CN": "你的决定是否已记录尚不明确（操作 {operation}）。再次提交同一决定是安全的。",
  },
  "approvals.sendAgain": { en: "Send the same decision again", "zh-CN": "再次提交同一决定" },
  "approvals.decisionRejected": {
    en: "Your decision was not accepted: {reason}",
    "zh-CN": "你的决定未被接受：{reason}",
  },
  "approvals.withdraw": { en: "Withdraw request", "zh-CN": "撤回请求" },
  "approvals.confirmWithdraw": {
    en: "Withdraw this approval request? The action will not be carried out.",
    "zh-CN": "撤回这项审批请求？该动作将不会执行。",
  },
  "approvals.withdrawn": { en: "The request is now: {status}.", "zh-CN": "请求当前状态：{status}。" },
  "approvals.withdrawUnknown": {
    en: "Whether the request was withdrawn is not known (operation {operation}). Refresh to check.",
    "zh-CN": "请求是否已撤回尚不明确（操作 {operation}）。请刷新确认。",
  },
  "approvals.withdrawRejected": {
    en: "The request could not be withdrawn: {reason}",
    "zh-CN": "请求未能撤回：{reason}",
  },

  "native.config.title": { en: "Connect to Kailo", "zh-CN": "连接 Kailo" },
  "native.config.explain": {
    en: "Enter the addresses your administrator gave you. Nothing is filled in for you: a guessed address would receive your sign-in and device key.",
    "zh-CN": "填写管理员提供的地址。这里不预填任何值：猜测的地址会拿到你的登录与设备密钥。",
  },
  "native.config.nativeApiUrl": { en: "Kailo native entry URL", "zh-CN": "Kailo 原生入口地址" },
  "native.config.oidcIssuer": { en: "Sign-in issuer (OIDC)", "zh-CN": "登录 issuer（OIDC）" },
  "native.config.oidcClientId": { en: "Client ID", "zh-CN": "客户端 ID" },
  "native.config.save": { en: "Save and continue", "zh-CN": "保存并继续" },
  "native.config.saving": { en: "Saving…", "zh-CN": "正在保存…" },
  "native.config.edit": { en: "Change connection settings", "zh-CN": "修改连接设置" },
  "native.config.rejected": {
    en: "These settings were not accepted: {message}",
    "zh-CN": "设置未被接受：{message}",
  },
  "native.signIn.title": { en: "Sign in to Kailo", "zh-CN": "登录 Kailo" },
  "native.signIn.explain": {
    en: "Sign-in opens in your system browser. Come back here when it is done.",
    "zh-CN": "登录会在系统浏览器中打开，完成后回到这里。",
  },
  "native.signIn.start": { en: "Sign in", "zh-CN": "登录" },
  "native.signIn.waiting": {
    en: "Waiting for sign-in to finish in your browser…",
    "zh-CN": "正在等待浏览器中的登录完成…",
  },
  "native.signIn.cancel": { en: "Cancel", "zh-CN": "取消" },
  "native.signIn.failed": { en: "Sign-in did not complete: {message}", "zh-CN": "登录未完成：{message}" },
  "native.device.registering": {
    en: "Registering this device…",
    "zh-CN": "正在登记本机…",
  },
  "native.device.pending": {
    en: "This device is being added ({state}). This usually takes a moment.",
    "zh-CN": "正在添加本机（{state}），通常片刻即可完成。",
  },
  "native.device.unknown": {
    en: "The registration result is unknown{operation}. Check again before doing anything else.",
    "zh-CN": "登记结果不明{operation}。请先重新确认，再做其他操作。",
  },
  "native.device.rejected": {
    en: "This device could not be registered ({reason}).",
    "zh-CN": "本机无法登记（{reason}）。",
  },
  "native.device.revoked": {
    en: "This device's key has been revoked. It cannot be used again; ask your administrator.",
    "zh-CN": "本机密钥已被撤销，不能再次使用；请联系管理员。",
  },
  "native.device.check": { en: "Check again", "zh-CN": "重新确认" },
  "native.community.loading": {
    en: "Finding your community…",
    "zh-CN": "正在获取 Community 连接信息…",
  },
  "native.community.failed": {
    en: "Couldn't get your community's connection details{reason}.",
    "zh-CN": "未能取得 Community 连接信息{reason}。",
  },
  "native.connect.failed": {
    en: "Couldn't connect to your community: {message}",
    "zh-CN": "未能连接 Community：{message}",
  },
} as const;

export type PlatformMessageKey = keyof typeof platformMessages;

export const approvalStatusMessages = {
  [ApprovalStatus.Requested]: { en: "Requested", "zh-CN": "已请求" },
  [ApprovalStatus.Waiting]: { en: "Waiting for decisions", "zh-CN": "等待决定" },
  [ApprovalStatus.Approved]: { en: "Approved, not carried out yet", "zh-CN": "已批准，尚未执行" },
  [ApprovalStatus.Denied]: { en: "Denied", "zh-CN": "已拒绝" },
  [ApprovalStatus.Expired]: { en: "Expired", "zh-CN": "已过期" },
  [ApprovalStatus.Cancelled]: { en: "Withdrawn", "zh-CN": "已撤回" },
  [ApprovalStatus.Consumed]: { en: "Approved and carried out", "zh-CN": "已批准并执行" },
  [ApprovalStatus.Invalidated]: { en: "No longer valid", "zh-CN": "已失效" },
} as const satisfies Record<ApprovalStatus, Message>;

export const approvalDecisionMessages = {
  [ApprovalDecision.Approve]: { en: "Approve", "zh-CN": "批准" },
  [ApprovalDecision.Deny]: { en: "Deny", "zh-CN": "拒绝" },
} as const satisfies Record<ApprovalDecision, Message>;

export const approvalSelectorMessages = {
  [ApprovalSelector.TenantAdmin]: { en: "Organization admin", "zh-CN": "组织管理员" },
  [ApprovalSelector.WorkspaceAdmin]: { en: "Workspace admin", "zh-CN": "工作区管理员" },
  [ApprovalSelector.ResourceApprover]: { en: "Resource approver", "zh-CN": "资源审批人" },
} as const satisfies Record<ApprovalSelector, Message>;

/** reason code 的说明（apps/06 §4）。分类由错误体给出，这里只解释「为什么」。 */
export const reasonMessages = {
  [ReasonCode.IdentityHeaderMissing]: {
    en: "Kailo does not recognize this account.",
    "zh-CN": "Kailo 无法识别这个账号。",
  },
  [ReasonCode.IdentityUnknown]: {
    en: "Kailo does not recognize this account.",
    "zh-CN": "Kailo 无法识别这个账号。",
  },
  [ReasonCode.TenantMembershipNotActive]: {
    en: "Your membership in this organization is not active.",
    "zh-CN": "你在该组织的成员资格未生效。",
  },
  [ReasonCode.SessionNotActive]: {
    en: "Your Kailo session is no longer active.",
    "zh-CN": "你的 Kailo 会话已失效。",
  },
  [ReasonCode.TenantSelectionNotAvailable]: {
    en: "Your account belongs to more than one organization, which cannot be chosen between yet.",
    "zh-CN": "你的账号属于多个组织，目前还不能在其间选择。",
  },
  [ReasonCode.NativeSurfaceRequired]: {
    en: "This must be done in Kailo Desktop or Mobile.",
    "zh-CN": "这一步只能在 Kailo Desktop 或 Mobile 上完成。",
  },
  [ReasonCode.ClientKeyProofInvalid]: {
    en: "Kailo did not accept this device's key proof.",
    "zh-CN": "Kailo 未接受本机的密钥证明。",
  },
  [ReasonCode.ClientKeyLimitReached]: {
    en: "You have registered the maximum number of devices. Revoke one first.",
    "zh-CN": "你登记的设备已达上限，请先撤销一台。",
  },
  [ReasonCode.ClientKeyAlreadyBound]: {
    en: "This device key was revoked or belongs to someone else.",
    "zh-CN": "这把设备密钥已被撤销或属于他人。",
  },
  [ReasonCode.ClientKeyNotFound]: {
    en: "That device is not registered to you.",
    "zh-CN": "该设备未登记在你名下。",
  },
  [ReasonCode.DependencyUnavailable]: {
    en: "A service this depends on is unavailable.",
    "zh-CN": "所依赖的服务暂不可用。",
  },
  [ReasonCode.PublishRejected]: { en: "The message was rejected.", "zh-CN": "消息被拒绝。" },
  [ReasonCode.PublishResultUnknown]: {
    en: "Whether the message was delivered is not known yet.",
    "zh-CN": "消息是否送达尚不明确。",
  },
  [ReasonCode.SurfaceCapabilityUnavailable]: {
    en: "This is not available here. Continue in Kailo on the web or desktop.",
    "zh-CN": "此处不提供该功能，请在 Kailo Web 或 Desktop 上继续。",
  },
  [ReasonCode.CapabilityBlocked]: {
    en: "This capability is not available.",
    "zh-CN": "该能力尚未开放。",
  },
  [ReasonCode.InvalidParameters]: {
    en: "The request was incomplete or malformed.",
    "zh-CN": "请求不完整或格式不正确。",
  },
  [ReasonCode.IdempotencyKeyReused]: {
    en: "This request was already sent with different details.",
    "zh-CN": "同一请求此前已以不同内容提交过。",
  },
  [ReasonCode.ScopeGuardFailed]: {
    en: "This is outside the organization or workspace you belong to.",
    "zh-CN": "超出了你所属的组织或工作区范围。",
  },
  [ReasonCode.PermissionDenied]: {
    en: "You do not have permission to do this.",
    "zh-CN": "你没有执行此操作的权限。",
  },
  [ReasonCode.TargetNotFound]: {
    en: "It no longer exists, or you cannot see it.",
    "zh-CN": "对象已不存在，或你无权查看。",
  },
  [ReasonCode.TargetStateConflict]: {
    en: "Its current state does not allow this.",
    "zh-CN": "对象当前的状态不允许此操作。",
  },
  [ReasonCode.LastTenantAdmin]: {
    en: "The organization would be left without an admin.",
    "zh-CN": "这会让组织失去最后一位管理员。",
  },
  [ReasonCode.WaitingApproval]: { en: "Waiting for approval.", "zh-CN": "正在等待审批。" },
  [ReasonCode.ApprovalSelectorUnresolvable]: {
    en: "No one can be asked to approve this.",
    "zh-CN": "找不到可以审批此请求的人。",
  },
  [ReasonCode.ApprovalDenied]: { en: "An approver denied it.", "zh-CN": "审批人拒绝了请求。" },
  [ReasonCode.ApprovalExpired]: {
    en: "The approval expired before it was decided.",
    "zh-CN": "审批在决定前已过期。",
  },
  [ReasonCode.ApprovalWithdrawn]: { en: "The request was withdrawn.", "zh-CN": "请求已被撤回。" },
  [ReasonCode.ApprovalInvalidated]: {
    en: "The approval is no longer valid because the facts or permissions changed.",
    "zh-CN": "事实或权限已变化，审批不再有效。",
  },
  [ReasonCode.ApprovalConsumeWindowClosed]: {
    en: "The approval was not used in time.",
    "zh-CN": "审批未在时限内使用。",
  },
  [ReasonCode.ApprovalNotOpen]: {
    en: "This approval is no longer taking decisions.",
    "zh-CN": "该审批已不再接受决定。",
  },
  [ReasonCode.ApproverNotEligible]: {
    en: "You are not eligible to decide on this approval.",
    "zh-CN": "你不具备审批此请求的资格。",
  },
  [ReasonCode.SelfApprovalDenied]: {
    en: "You cannot approve your own request.",
    "zh-CN": "不能审批自己发起的请求。",
  },
  [ReasonCode.DuplicateDecision]: {
    en: "You already recorded a different decision, which cannot be changed.",
    "zh-CN": "你已记录了不同的决定，决定不能更改。",
  },
  [ReasonCode.AdmissionAbandoned]: {
    en: "The request was abandoned before it could be evaluated.",
    "zh-CN": "请求在判定完成前已被放弃。",
  },
  [ReasonCode.DispatchResultUnknown]: {
    en: "Whether it took effect is not known yet.",
    "zh-CN": "是否已生效尚不明确。",
  },
  [ReasonCode.ProjectionDelayed]: {
    en: "The status shown may be out of date.",
    "zh-CN": "显示的状态可能尚未更新。",
  },
  [ReasonCode.ExternalResultUnknown]: {
    en: "The outcome is not known yet; it is being reconciled.",
    "zh-CN": "结果尚不明确，正在对账。",
  },
} as const satisfies Record<ReasonCode, Message>;

/** 契约枚举值的文案。表按枚举穷举；取不到只可能是回应不合契约，那时如实显示原值。 */
export function enumLabel<V extends string>(
  locale: PlatformLocale,
  table: Record<V, Message>,
  value: V,
): string {
  return table[value]?.[locale] ?? value;
}

export function resolveLocale(languages?: readonly string[]): PlatformLocale {
  const preferred =
    languages ??
    (typeof navigator === "undefined"
      ? []
      : navigator.languages.length
        ? navigator.languages
        : [navigator.language]);
  return preferred[0]?.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function translate(
  locale: PlatformLocale,
  key: PlatformMessageKey,
  variables: Record<string, string | number> = {},
): string {
  return platformMessages[key][locale].replace(/\{(\w+)\}/g, (_, name: string) =>
    String(variables[name] ?? ""),
  );
}
