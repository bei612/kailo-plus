// 平台页与原生登录引导的文案。key 只在这里定义一次：Web 的消息表把它并入自己的表
// （同一个 key 不在两处各写一份），Desktop 直接用这里的翻译。
//
// 契约枚举（reason code、审批状态、决定、审批选择器）的文案按枚举穷举：契约新增一个
// 值时这里编译不过，逼着给出说明，而不是让新值悄悄落进一个笼统的「出错了」。code
// 本身是稳定标识，界面同时显示文案与 code（apps/06 §4）。

import {
  ApprovalDecision,
  ApprovalSelector,
  ApprovalStatus,
  AuditEventType,
  BuzzIdentityState,
  EvidenceAuthority,
  EvidenceKind,
  EvidenceUnavailableReason,
  ReasonCode,
  TenantState,
  TenantInvitationStatus,
  TenantMembershipState,
  WorkspaceMembershipState,
  WorkspaceState,
} from "@client-kit/contracts";

export type PlatformLocale = "en" | "zh-CN";

// 相对时间与复数的语义只有这一份；Dart 生成物从这里投影阈值和单数 locale。
export const platformTimeSeconds = {
  minute: 60,
  hour: 3600,
  day: 86400,
  month: 2592000,
} as const;

export const platformPluralOneLocales = ["en"] as const;

// “昨天/明天/上个月/下个月”是日历特例，不依赖语言的语法复数类别。
export const platformSpecialRelativeUnits = ["day", "month"] as const;

// 频道日期分组与近期线程摘要共享同一个日历日带；Dart 从这里生成该阈值。
export const platformCalendarWeekdayBandDays = 7 as const;

// 主题模式集合与各模式的文案 key：三端宿主的主题偏好只在这三种之间取值（DD-53），主题本身
// 归宿主（Web/Desktop 的 ThemeProvider 与根 CSS variables，Mobile 的 Flutter Theme），平台页只用
// 宿主主题的语义色。本段须是合法 JSON，Dart 生成物由 tools/gen-platform-i18n.py 从这里投影。
export const platformThemeModeKeys = {
  "light": "platform.theme.modeLight",
  "dark": "platform.theme.modeDark",
  "system": "platform.theme.modeSystem"
} as const satisfies Record<string, PlatformMessageKey>;

export type PlatformThemeMode = keyof typeof platformThemeModeKeys;

export function platformPluralForm(locale: PlatformLocale, count: number): "one" | "other" {
  return platformPluralOneLocales.some((candidate) => candidate === locale) && count === 1
    ? "one"
    : "other";
}

type Message = { readonly en: string; readonly "zh-CN": string };

export const platformMessages = {
  "capabilities.title": { en: "Capability contracts", "zh-CN": "能力契约" },
  "capabilities.boundary": { en: "Catalog contracts define replaceable component capabilities. An active contract does not activate a component, binding or Tool permission.", "zh-CN": "Catalog 契约定义可替换的组件能力。契约生效不代表组件、binding 或 Tool 权限已启用。" },
  "capabilities.document": { en: "Registration document (JSON)", "zh-CN": "登记文档（JSON）" },
  "capabilities.documentHelp": { en: "Provide the complete registration document, including actual schemaDocuments and testVectorsJson. Core validates and fixes their digests; supplying hashes alone is insufficient.", "zh-CN": "提交完整登记文档，包含实际 schemaDocuments 和 testVectorsJson。Core 校验并固定摘要，不能只提供摘要。" },
  "capabilities.invalid": { en: "The registration document is not valid JSON or lacks required contract fields.", "zh-CN": "登记文档不是有效 JSON，或缺少必需的契约字段。" },
  "capabilities.register": { en: "Review contract registration", "zh-CN": "预览契约登记" },
  "capabilities.approve": { en: "Request contract approval", "zh-CN": "申请批准契约" },
  "capabilities.deprecate": { en: "Review contract deprecation", "zh-CN": "预览弃用契约" },
  "capabilities.registerWarning": { en: "Registration creates a draft only. It does not activate a capability or install a component.", "zh-CN": "登记只创建草稿，不激活能力，也不安装组件。" },
  "capabilities.approveWarning": { en: "Another Catalog tenant administrator must approve. Submission is not approval; an active contract is immutable.", "zh-CN": "必须由另一位 Catalog Tenant 管理员批准。提交不构成批准；生效后的契约不可变。" },
  "capabilities.deprecateWarning": { en: "Reject new releases using this contract. Existing bindings remain available; their data is not deleted.", "zh-CN": "拒绝新 release 使用此契约；已有 binding 继续可用，不删除其数据。" },
  "capabilities.none": { en: "No capability contracts on this page.", "zh-CN": "本页没有能力契约。" },
  "capabilities.key": { en: "Category / version", "zh-CN": "能力类别／版本" },
  "capabilities.schemaDigest": { en: "Schema set digest", "zh-CN": "Schema 集合摘要" },
  "capabilities.suiteDigest": { en: "Conformance suite digest", "zh-CN": "一致性套件摘要" },
  "capabilities.draft": { en: "Draft", "zh-CN": "草稿" },
  "capabilities.active": { en: "Active contract", "zh-CN": "契约已生效" },
  "capabilities.deprecated": { en: "Deprecated", "zh-CN": "已弃用" },
  "capabilities.retired": { en: "Retired", "zh-CN": "已退役" },
  "platform.title": { en: "Platform", "zh-CN": "平台" },
  "platform.workspace": { en: "Workspace", "zh-CN": "工作区" },
  "platform.workspaces": { en: "Workspaces", "zh-CN": "工作区" },
  "workspace.create.title": { en: "Create workspace", "zh-CN": "创建工作区" },
  "workspace.create.name": { en: "Workspace name", "zh-CN": "工作区名称" },
  "workspace.create.slug": { en: "Workspace identifier", "zh-CN": "工作区标识" },
  "workspace.create.slugHint": {
    en: "Use lowercase English letters, digits and hyphens; start with a letter or digit.",
    "zh-CN": "使用小写英文字母、数字和连字符，以字母或数字开头。",
  },
  "workspace.create.recorded": {
    en: "Request recorded, not confirmed complete. Check Tasks for the outcome, then refresh your workspace list. Execution: {execution}; operation: {operation}; admission: {gate}; dispatch: {dispatch}.",
    "zh-CN": "请求已登记，不代表创建完成。请到任务页查看结果，完成后刷新工作区列表。执行：{execution}；操作：{operation}；准入：{gate}；派发：{dispatch}。",
  },
  "workspace.create.unknown": {
    en: "The result is unknown. Retry only this same request; do not start a new creation. Operation: {operation}.",
    "zh-CN": "结果不明。只能重查原请求，不要另发一笔创建。操作：{operation}。",
  },
  "workspace.create.retry": { en: "Retry same request", "zh-CN": "重查原请求" },
  "workspace.create.inFlight": { en: "Creations still in progress", "zh-CN": "进行中的创建" },
  "workspace.create.inFlightItem": {
    en: "{status} · operation {operation}",
    "zh-CN": "{status} · 操作 {operation}",
  },
  "workspace.create.inFlightUnavailable": {
    en: "Could not check creations in progress. Check Tasks before creating again.",
    "zh-CN": "无法读取进行中的创建。再次创建前请先到任务页确认。",
  },
  "workspace.lifecycle.suspend": { en: "Suspend", "zh-CN": "暂停" },
  "workspace.lifecycle.restore": { en: "Restore", "zh-CN": "恢复" },
  "workspace.lifecycle.confirmSuspend": {
    en: "Suspend workspace {name}? Members cannot enter it until it is restored; its content, owners and permissions are kept. The final result is shown in Tasks.",
    "zh-CN": "暂停工作区 {name}？恢复前成员无法进入，其中的内容、所有者与权限都保留。最终结果请到任务页查看。",
  },
  "workspace.lifecycle.confirmRestore": {
    en: "Restore workspace {name}? It reopens only after reconciliation completes. The final result is shown in Tasks.",
    "zh-CN": "恢复工作区 {name}？对账完成后才重新开放。最终结果请到任务页查看。",
  },
  "workspace.lifecycle.recorded": {
    en: "Request recorded; this does not mean it has finished. Check Tasks for the result. Operation: {operation}.",
    "zh-CN": "请求已登记，不代表已完成。请到任务页查看结果。操作：{operation}。",
  },
  "workspace.lifecycle.unknown": {
    en: "Result unknown. Only re-check the same request; do not submit another. Operation: {operation}.",
    "zh-CN": "结果不明。只能重查原请求，不要另发一笔。操作：{operation}。",
  },
  "workspace.lifecycle.aborted": {
    en: "Request recorded but not carried out ({reason}). Operation: {operation}.",
    "zh-CN": "请求已登记但未执行（{reason}）。操作：{operation}。",
  },
  "workspace.lifecycle.rejected": { en: "Request rejected: {reason}", "zh-CN": "请求被拒绝：{reason}" },
  "workspace.lifecycle.retry": { en: "Retry same request", "zh-CN": "重查原请求" },
  "tenants.title": { en: "Organizations", "zh-CN": "组织" },
  "tenants.none": { en: "No organizations on this page.", "zh-CN": "本页没有组织。" },
  "tenants.name": { en: "Organization", "zh-CN": "组织" },
  "tenants.slug": { en: "Identifier", "zh-CN": "标识" },
  "tenants.suspend": { en: "Suspend", "zh-CN": "暂停" },
  "tenants.restore": { en: "Restore", "zh-CN": "恢复" },
  "tenants.confirmSuspend": {
    en: "Suspend organization {name} ({slug})? All its members lose access at once and every connection to its collaboration space is closed; its content, owners, permissions and keys are kept. The final result is shown in Tasks.",
    "zh-CN": "暂停组织 {name}（{slug}）？其全部成员立即失去访问，协作空间的全部连接被断开；内容、所有者、权限与密钥都保留。最终结果请到任务页查看。",
  },
  "tenants.confirmRestore": {
    en: "Restore organization {name} ({slug})? It reopens only after reconciliation completes. The final result is shown in Tasks.",
    "zh-CN": "恢复组织 {name}（{slug}）？对账完成后才重新开放。最终结果请到任务页查看。",
  },
  "platform.tab.members": { en: "Members", "zh-CN": "成员" },
  "platform.tab.agents": { en: "Agents", "zh-CN": "Agent" },
  "agents.none": { en: "No definitions visible on this page.", "zh-CN": "本页没有可见的定义。" },
  "agents.memory.title": { en: "Agent memory", "zh-CN": "Agent 记忆" },
  "agents.memory.readOnly": { en: "Read through Core authorization. This page cannot write memory or grant runtime permissions.", "zh-CN": "经 Core 授权读取。本页不写入记忆，也不授予运行权限。" },
  "agents.memory.governed": { en: "Read through Core authorization. Only the current human owner can submit governed memory updates; memory never grants runtime permissions.", "zh-CN": "经 Core 授权读取。仅当前 HUMAN 所有者可提交受治理的记忆更新；记忆不授予运行权限。" },
  "agents.memory.newEntry": { en: "Read a cold entry before editing (mem/...)", "zh-CN": "编辑前读取冷条目（mem/...）" },
  "agents.memory.replace": { en: "Replace core memory", "zh-CN": "替换核心记忆" },
  "agents.memory.set": { en: "Set entry value", "zh-CN": "设置条目内容" },
  "agents.memory.patch": { en: "Apply strict patch", "zh-CN": "应用严格补丁" },
  "agents.memory.remove": { en: "Write tombstone", "zh-CN": "写入墓碑" },
  "agents.memory.value": { en: "Memory value", "zh-CN": "记忆内容" },
  "agents.memory.patchText": { en: "Unified diff against the displayed native value", "zh-CN": "针对已展示原生内容的 unified diff" },
  "agents.memory.baseHash": { en: "Native base hash", "zh-CN": "原生内容基底 hash" },
  "agents.memory.tombstoneWarning": { en: "Publish value:null for this exact head. Archival history is not physically deleted.", "zh-CN": "针对这个精确 head 发布 value:null；不会物理删除历史存档。" },
  "agents.memory.review": { en: "Submit this frozen value and head once. An unknown result can only re-check the same request, never sign or publish a replacement.", "zh-CN": "仅提交本次冻结的内容与 head。结果不明只能查证同一请求，不会重新签名或发布替代事件。" },
  "agents.memory.recorded": { en: "Core returned this request's governed outcome. Inspect Tasks and Audit for its evidence. Execution: {execution}; operation: {operation}.", "zh-CN": "Core 已返回本请求的治理结果。请到任务和审计页查证。执行：{execution}；操作：{operation}。" },
  "agents.memory.inFlight": { en: "Existing memory request still needs reconciliation; no replacement is available.", "zh-CN": "已有记忆请求仍待对账，不能另发替代请求。" },
  "agents.memory.open": { en: "Read memory", "zh-CN": "读取记忆" },
  "agents.memory.close": { en: "Close memory", "zh-CN": "关闭记忆" },
  "agents.memory.core": { en: "Core memory", "zh-CN": "核心记忆" },
  "agents.memory.cold": { en: "Cold memory", "zh-CN": "冷记忆" },
  "agents.memory.newSessions": { en: "Only new sessions read the current core head. Existing sessions keep their fixed event.", "zh-CN": "仅新 Session 读取当前 core head；已有 Session 保留原固定事件。" },
  "agents.memory.slug": { en: "Entry", "zh-CN": "条目" },
  "agents.memory.head": { en: "Native head", "zh-CN": "原生 head" },
  "agents.memory.found": { en: "Found", "zh-CN": "已找到" },
  "agents.memory.absent": { en: "Confirmed absent", "zh-CN": "确认缺失" },
  "agents.memory.unreadable": { en: "Unreadable; absence is not confirmed", "zh-CN": "不可读；尚未确认缺失" },
  "agents.memory.tombstone": { en: "Tombstone", "zh-CN": "墓碑" },
  "agents.memory.none": { en: "Complete snapshot contains no cold entries.", "zh-CN": "完整快照中没有冷记忆条目。" },
  "agents.memory.unknown": { en: "Listing is unknown; this is not an empty inventory.", "zh-CN": "列表结果不明，不代表空库存。" },
  "agents.memory.boundExceeded": { en: "Native enumeration bound exceeded; completeness is not confirmed.", "zh-CN": "原生枚举超过上界，未确认完整性。" },
  "agents.memory.readEntry": { en: "Read entry", "zh-CN": "读取条目" },
  "agents.definitionOnly": { en: "Manage stable definitions and exact versions here. Creating a definition or saving a draft does not publish, install or run an agent.", "zh-CN": "此处管理稳定定义与精确版本。创建定义或保存草稿不等于发布、安装或运行 Agent。" },
  "agents.name": { en: "Display name", "zh-CN": "显示名" },
  "agents.slug": { en: "Stable identifier", "zh-CN": "稳定标识" },
  "agents.owner": { en: "Owner", "zh-CN": "所有者" },
  "agents.resourceVersion": { en: "Resource version", "zh-CN": "资源版本" },
  "agents.publishedVersion": { en: "Published version", "zh-CN": "已发布版本" },
  "agents.noPublishedVersion": { en: "No published version.", "zh-CN": "尚无已发布版本。" },
  "agents.installation.candidates": { en: "Published installation sources", "zh-CN": "已发布安装来源" },
  "agents.installation.candidatesReadOnly": { en: "Read-only exact published versions authorized on this page. This directory does not create an installation or authorize execution.", "zh-CN": "只读展示本页受权的精确已发布版本。目录不创建安装，也不授予执行权限。" },
  "agents.delegation.readOnly": { en: "Read-only delegation records and exact scopes. Recorded state, expiry and uses do not prove current invocation authorization.", "zh-CN": "只读委托记录与精确 Scope。记录状态、期限和次数不证明当前 Invocation 已获授权。" },
  "agents.delegation.scopes": { en: "Exact scopes", "zh-CN": "精确 Scope" },
  "agents.delegation.targetsReadOnly": { en: "Authorized scope directory", "zh-CN": "受权 Scope 目录" },
  "agents.delegation.exposure": { en: "Result exposure", "zh-CN": "结果暴露" },
  "agents.delegation.outputSchemaHash": { en: "Output schema hash", "zh-CN": "输出契约摘要" },
  "agents.delegation.redaction": { en: "Redaction policy", "zh-CN": "裁剪策略" },
  "agents.version.assetVersion": { en: "Asset version", "zh-CN": "Asset 版本" },
  "agents.delegation.version": { en: "Grant version", "zh-CN": "Grant 版本" },
  "agents.delegation.noMaximumUses": { en: "No explicit use-count limit; expiry still applies.", "zh-CN": "无显式次数上限，到期时间仍生效。" },
  "agents.delegation.exposure.consumeOnly": { en: "Consume only", "zh-CN": "仅消费" },
  "agents.delegation.exposure.read": { en: "Read", "zh-CN": "读取" },
  "agents.delegation.exposure.export": { en: "Export", "zh-CN": "导出" },
  "agents.delegation.tool": { en: "Tool reference", "zh-CN": "Tool 引用" },
  "agents.definitionReady": { en: "Definition ready", "zh-CN": "定义就绪" },
  "agents.open": { en: "View definition", "zh-CN": "查看定义" },
  "agents.create": { en: "Create definition", "zh-CN": "创建定义" },
  "agents.update": { en: "Change display name", "zh-CN": "修改显示名" },
  "agents.transfer": { en: "Transfer ownership", "zh-CN": "转移所有权" },
  "agents.newOwner": { en: "New owner's principal ID", "zh-CN": "新所有者的 Principal ID" },
  "agents.ownerHint": { en: "Select an active human member of this organization. Core checks membership and permission again; ownership transfer requires another organization administrator's approval.", "zh-CN": "请选择本组织的有效 HUMAN 成员。Core 会重新核对成员资格与权限；所有权转移需要另一位组织管理员审批。" },
  "agents.review": { en: "Review request", "zh-CN": "核对请求" },
  "agents.confirm": { en: "Submit governed request", "zh-CN": "提交受治理请求" },
  "agents.cancel": { en: "Cancel request", "zh-CN": "取消请求" },
  "agents.retry": { en: "Re-check same request", "zh-CN": "重查原请求" },
  "agents.previewCreate": { en: "Create the stable definition {name} ({slug}) owned by your current human identity. No version, installation, permission grant or runtime is created.", "zh-CN": "创建稳定定义 {name}（{slug}），由当前 HUMAN 身份负责。不创建版本、安装、授权或运行时。" },
  "agents.previewUpdate": { en: "Change only the display name of {resource} at resource version {version} to {name}. Published version content and installations are unchanged.", "zh-CN": "仅将资源 {resource} 的版本 {version} 的显示名改为 {name}。已发布版本正文与安装均不改变。" },
  "agents.previewTransfer": { en: "Transfer definition {resource} at resource version {version} from {owner} to {next}. Approval is required. No agent version or installation is created.", "zh-CN": "将定义 {resource} 的资源版本 {version} 的所有者从 {owner} 转给 {next}。需要审批，不创建 Agent 版本或安装。" },
  "agents.admission": { en: "Core rechecks scope, permission, approval, quota and capacity according to the registered action policy. A request is not a runtime authorization.", "zh-CN": "Core 按登记的动作策略重查 scope、权限、审批、额度与容量。提交请求不构成运行授权。" },
  "agents.recorded": { en: "Request recorded. Check Tasks for its outcome and Approvals for ownership transfer. Execution: {execution}; operation: {operation}.", "zh-CN": "请求已登记。请到任务页查看结果；所有权转移可到审批页查看。执行：{execution}；操作：{operation}。" },
  "agents.unknown": { en: "Outcome is not confirmed. Re-check only this same request or inspect Tasks; do not submit a replacement. Operation: {operation}.", "zh-CN": "结果尚未确认。只能重查原请求或到任务页查证，不要另发一笔。操作：{operation}。" },
  "agents.inFlight": { en: "Existing definition requests in progress", "zh-CN": "仍在进行的定义请求" },
  "agents.inFlightUnavailable": { en: "Could not confirm existing requests. Refresh this view or inspect Tasks; new requests remain blocked until confirmation.", "zh-CN": "无法确认已有请求。请刷新本页或到任务页查证；完成查证前不能另发请求。" },
  "agents.version.published": { en: "Published", "zh-CN": "已发布" },
  "agents.version.draft": { en: "Draft", "zh-CN": "草稿" },
  "agents.version.retired": { en: "Retired", "zh-CN": "已退役" },
  "agents.version.history": { en: "Version history", "zh-CN": "版本历史" },
  "agents.version.configurationPages": { en: "Authorized configuration pages", "zh-CN": "受权配置分页" },
  "agents.version.none": { en: "No authorized versions on this page.", "zh-CN": "本页没有受权可见的版本。" },
  "agents.version.boundary": { en: "Drafts are editable; published versions are immutable. Saving or publishing does not install an agent, change existing installations, or authorize execution.", "zh-CN": "草稿可编辑，已发布版本不可变。保存或发布不会安装 Agent、改变已有安装或授予执行权限。" },
  "agents.version.create": { en: "Create version draft", "zh-CN": "创建版本草稿" },
  "agents.version.edit": { en: "Edit draft", "zh-CN": "编辑草稿" },
  "agents.version.publish": { en: "Publish exact draft", "zh-CN": "发布精确草稿" },
  "agents.version.retire": { en: "Retire exact published version", "zh-CN": "退役精确已发布版本" },
  "agents.version.createUnavailable": { en: "This action has no authorized configuration source or registered permission. No default profile or route is supplied.", "zh-CN": "此动作缺少受权配置来源或已登记权限。不提供默认运行配置或路由。" },
  "agents.version.currentHumanOwner": { en: "Current active human identity", "zh-CN": "当前有效 HUMAN 身份" },
  "agents.version.avatar": { en: "Avatar URL (optional metadata)", "zh-CN": "头像 URL（可选元数据）" },
  "agents.version.description": { en: "Persona description (optional)", "zh-CN": "Persona 说明（可选）" },
  "agents.version.replyPolicy": { en: "Reply policy declared by this runtime profile", "zh-CN": "此运行配置声明的回复策略" },
  "agents.version.parallelism": { en: "Requested parallelism", "zh-CN": "声明的并行度" },
  "agents.version.idleTimeout": { en: "Idle timeout (seconds)", "zh-CN": "空闲超时（秒）" },
  "agents.version.maxDuration": { en: "Maximum turn duration (seconds)", "zh-CN": "回合最长时限（秒）" },
  "agents.version.coreWrite": { en: "Requested core memory write policy", "zh-CN": "声明的核心记忆写入策略" },
  "agents.version.coldWrite": { en: "Requested cold memory write policy", "zh-CN": "声明的冷记忆写入策略" },
  "agents.version.coreHumanOnly": { en: "Human only", "zh-CN": "仅 HUMAN" },
  "agents.version.coreApproval": { en: "Agent with approval", "zh-CN": "Agent 须经审批" },
  "agents.version.coldDisabled": { en: "Agent writes disabled", "zh-CN": "禁用 Agent 写入" },
  "agents.version.coldInvocation": { en: "Invocation scoped", "zh-CN": "限定 Invocation" },
  "agents.version.triggers": { en: "Requested trigger defaults (not enabled channel bindings)", "zh-CN": "声明的触发默认值（不启用频道绑定）" },
  "agents.version.manualAssignment": { en: "Manual assignment", "zh-CN": "人工分派" },
  "agents.version.capabilities": { en: "Requested capability contracts", "zh-CN": "声明的能力合同" },
  "agents.version.toolsUnavailable": { en: "Skill publication is unavailable. Tool references request capabilities; they do not grant permissions, bind an installation or authorize execution.", "zh-CN": "Skill 发布尚不可用。Tool 引用仅声明需求，不授予权限、不建立安装绑定，也不授权执行。" },
  "agents.tools.title": { en: "Platform tools", "zh-CN": "平台原生工具" },
  "agents.tools.boundary": { en: "Read-only tool catalog. A version reference grants no memory access, ToolBinding or delegation. Every invocation is admitted separately.", "zh-CN": "只读工具目录。版本引用不授予记忆读取权限、ToolBinding 或委托。每次调用仍须单独准入。" },
  "agents.tools.none": { en: "No visible registered tools on this page.", "zh-CN": "本页没有可见的已登记工具。" },
  "agents.tools.provisioning": { en: "Registration awaiting verification", "zh-CN": "登记等待查证" },
  "agents.tools.available": { en: "May be requested in a version", "zh-CN": "可在版本中声明需求" },
  "agents.tools.unavailable": { en: "Unavailable for this version; remove the reference or verify its permission and registration.", "zh-CN": "此版本当前无法使用该引用；请移除，或查证其权限与登记状态。" },
  "agents.tools.selected": { en: "Requested tools", "zh-CN": "声明的工具需求" },
  "agents.tools.remove": { en: "Remove reference", "zh-CN": "移除引用" },
  "agents.version.saveReview": { en: "Save only this draft content. Core validates the declared sources and freezes its hash; installations and runtime projections are unchanged. Management quota/capacity is NONE; scope and permission are rechecked.", "zh-CN": "仅保存此草稿正文。Core 查证声明来源并固定摘要；已有安装和运行投影不变。管理额度/容量为 NONE，scope 与权限仍重查。" },
  "agents.version.publishReview": { en: "Explicitly publish this exact draft and hash. The request contains no replacement content. The definition's published pointer changes; existing installations remain pinned. No approval workflow, quota or capacity is required by this registered management action.", "zh-CN": "显式发布这个精确草稿与摘要。请求不携带替代正文，仅改变定义的已发布指针；已有安装仍固定原版本。此已登记管理动作无审批 Workflow、额度或容量要求。" },
  "agents.version.retireReview": { en: "Explicitly retire only this published version to prohibit new installations. Existing installations and in-flight invocations keep their exact immutable version; history, usage and audit remain. If this is the definition's published pointer, it is cleared without selecting a replacement. This Asset manage action has no approval workflow, quota or capacity requirement; Core rechecks scope and permission.", "zh-CN": "显式退役这个已发布版本，禁止新安装。已有安装和在途 Invocation 保留精确不可变版本，历史、用量和审计不删除。若定义的已发布指针指向此版，仅清空而不选择替代版本。此 Asset manage 动作无审批 Workflow、额度或容量要求，Core 仍重查 scope 与权限。" },
  "agents.version.inFlight": { en: "Existing version requests still require reconciliation", "zh-CN": "已有版本请求仍待对账" },
  "agents.version.ordinal": { en: "Version number", "zh-CN": "版本序号" },
  "agents.version.runtimeProfile": { en: "Requested runtime profile", "zh-CN": "声明的运行配置" },
  "agents.installation.title": { en: "Workspace installations", "zh-CN": "工作区安装" },
  "agents.installation.readOnly": { en: "Read-only installation records. An active record or projection is not proof that a process is currently healthy or that an invocation is authorized.", "zh-CN": "只读安装记录。安装或投影处于 ACTIVE 不证明进程此刻健康，也不代表某次调用已获授权。" },
  "agents.installation.management": { en: "Create an installation from an exact published version. Recorded installation and projection states do not prove runtime health or authorize an invocation.", "zh-CN": "选择精确已发布版本创建安装。安装与投影的记录状态不证明运行时健康，也不授权某次调用。" },
  "agents.installation.create": { en: "Install published Agent version", "zh-CN": "安装已发布 Agent 版本" },
  "agents.installation.noPublished": { en: "No authorized published Agent version on this page.", "zh-CN": "本页没有已获安装来源授权的已发布 Agent 版本。" },
  "agents.installation.createUnavailable": { en: "Installation creation is not available to this identity in this workspace.", "zh-CN": "当前身份在此工作区没有可用的安装创建动作。" },
  "agents.installation.notReady": { en: "This request creates an installation pinned to the displayed version. Provisioning, authorization and runtime readiness are separate; dispatch does not mean the Agent is ready to run.", "zh-CN": "此请求创建固定到所示版本的安装。建立投影、授权与运行时就绪是独立事实；请求已派发不等于 Agent 可运行。" },
  "agents.delegation.open": { en: "View delegation grants", "zh-CN": "查看委托授权" },
  "agents.execute.title": { en: "Agent self-installation execute permission", "zh-CN": "Agent 自身安装执行权限" },
  "agents.read.title": { en: "Agent self-installation memory read permission", "zh-CN": "Agent 自身安装记忆读取权限" },
  "agents.read.boundary": { en: "This grants this agent read access only to its own installation memory. It grants no Tool consume permission, delegation or access to another installation.", "zh-CN": "仅授予此 Agent 读取自身安装记忆的权限，不授予 Tool consume、委托或其他安装的访问权限。" },
  "agents.read.effective": { en: "Fresh memory read check passed for this installation", "zh-CN": "自身安装记忆 fresh read 已通过" },
  "agents.read.notEffective": { en: "Self-installation memory read is not effective", "zh-CN": "自身安装记忆读取权限未生效" },
  "agents.read.unverified": { en: "Memory read permission cannot be verified. No permission action is offered.", "zh-CN": "记忆读取权限不可查证，不提供权限操作。" },
  "agents.read.grant": { en: "Review memory read grant", "zh-CN": "预览授予记忆读取权限" },
  "agents.read.revoke": { en: "Review memory read revocation", "zh-CN": "预览撤销记忆读取权限" },
  "agents.read.approval": { en: "The exact installation owner must approve. Submission does not grant memory read permission.", "zh-CN": "须由此安装的确切 owner 审批，提交不构成记忆读取授权。" },
  "agents.read.revokeWarning": { en: "Revoke only this agent's self-installation reader relationship. Pending grants are invalidated; each subsequent memory read must pass a fresh permission check.", "zh-CN": "仅撤销此 Agent 自身安装的 reader 关系。待处理授予会失效；后续每次记忆读取必须重新通过权限校验。" },
  "agents.execute.open": { en: "View self-installation permission", "zh-CN": "查看自身安装权限" },
  "agents.execute.boundary": { en: "This permission applies only to this installation. It grants no model, tool or other resource access. Delegation, human permissions, quota and runtime readiness remain separate requirements.", "zh-CN": "此权限仅适用于自身安装，不授予模型、工具或其他资源权限。委托、HUMAN 权限、额度与运行就绪仍是独立条件。" },
  "agents.execute.effective": { en: "Fresh execute check passed for this installation", "zh-CN": "自身安装 fresh execute 已通过" },
  "agents.execute.notEffective": { en: "Self-installation execute is not effective", "zh-CN": "自身安装执行权限未生效" },
  "agents.execute.unverified": { en: "Execute permission cannot be verified. No permission action is offered.", "zh-CN": "执行权限不可查证，不提供权限操作。" },
  "agents.execute.grant": { en: "Review execute grant", "zh-CN": "预览授予执行权限" },
  "agents.execute.revoke": { en: "Review execute revocation", "zh-CN": "预览撤销执行权限" },
  "agents.execute.approval": { en: "The exact installation owner must approve. Submission does not grant execution permission.", "zh-CN": "须由此安装的确切 owner 审批，提交不构成执行授权。" },
  "agents.execute.revokeWarning": { en: "Revoke only this agent's self-installation executor relationship. Pending grants are invalidated and existing ordinary invocations receive cancellation requests; cancellation is not a terminal result.", "zh-CN": "仅撤销此 Agent 自身安装的 executor 关系。待处理授予会失效，已有普通 Invocation 记录取消请求；取消请求不是终态。" },
  "agents.delegation.title": { en: "Installation delegation grants", "zh-CN": "安装的委托授权" },
  "agents.delegation.none": { en: "No delegation grants on this page.", "zh-CN": "本页没有委托授权记录。" },
  "agents.delegation.noTarget": { en: "No authorized action target on this page. No default scope is granted.", "zh-CN": "本页没有已获授权的动作目标，不授予默认范围。" },
  "agents.delegation.target": { en: "Exact governed action and target", "zh-CN": "确切受治理动作与目标" },
  "agents.delegation.validFrom": { en: "Valid from", "zh-CN": "生效时间" },
  "agents.delegation.expiresAt": { en: "Expires at", "zh-CN": "到期时间" },
  "agents.delegation.localTime": { en: "Enter this device's local time. The confirmation displays the exact UTC times.", "zh-CN": "按此设备的本地时间填写，确认时展示精确 UTC 时间。" },
  "agents.delegation.invalidPeriod": { en: "Expiry must be later than the valid-from time.", "zh-CN": "到期时间必须晚于生效时间。" },
  "agents.delegation.maxUses": { en: "Maximum uses", "zh-CN": "最多使用次数" },
  "agents.delegation.noUseLimit": { en: "No explicit use-count limit (blank); expiry still applies.", "zh-CN": "留空表示无显式次数上限，到期时间仍生效。" },
  "agents.delegation.uses": { en: "Recorded uses", "zh-CN": "已记录使用次数" },
  "agents.delegation.grantor": { en: "Human grantor", "zh-CN": "HUMAN 授权人" },
  "agents.delegation.revoke": { en: "Review revocation", "zh-CN": "预览撤销" },
  "agents.delegation.admission": { en: "This exact grant does not add permissions or start a turn. Core rechecks this installation, action, target, expiry and result exposure before effects. An unknown result keeps the same grant and request IDs.", "zh-CN": "此精确委托不增加权限，也不启动回合。Core 在副作用前重查安装、动作、目标、有效期与结果暴露。结果不明时保留原授权与请求 ID。" },
  "agents.delegation.state.active": { en: "Active grant record", "zh-CN": "授权记录为 ACTIVE" },
  "agents.delegation.state.revoking": { en: "Revoking", "zh-CN": "撤销中" },
  "agents.delegation.state.revoked": { en: "Revoked", "zh-CN": "已撤销" },
  "agents.delegation.state.expired": { en: "Expired", "zh-CN": "已到期" },
  "agents.installation.none": { en: "No installations you may read on this page.", "zh-CN": "本页没有你可读取的安装。" },
  "agents.installation.noWorkspace": { en: "No active workspace is available to this identity.", "zh-CN": "当前身份没有可进入的 ACTIVE 工作区。" },
  "agents.installation.id": { en: "Installation", "zh-CN": "安装" },
  "agents.installation.definition": { en: "Definition reference", "zh-CN": "定义引用" },
  "agents.installation.version": { en: "Exact version reference", "zh-CN": "精确版本引用" },
  "agents.installation.principal": { en: "Agent identity", "zh-CN": "Agent 身份" },
  "agents.installation.open": { en: "View installation", "zh-CN": "查看安装" },
  "agents.installation.projection": { en: "Recorded runtime projection", "zh-CN": "已记录的运行投影" },
  "agents.installation.generation": { en: "Projection generation", "zh-CN": "投影代数" },
  "agents.installation.activeGeneration": { en: "Active generation pointer", "zh-CN": "ACTIVE 代数指针" },
  "agents.installation.notRecorded": { en: "Not recorded; readiness is not confirmed.", "zh-CN": "尚未记录，未确认就绪。" },
  "agents.installation.channel": { en: "Channel binding", "zh-CN": "频道绑定" },
  "agents.installation.triggers": { en: "Configured triggers", "zh-CN": "已配置的触发方式" },
  "agents.installation.trigger.mention": { en: "Mention", "zh-CN": "提及" },
  "agents.installation.trigger.manual": { en: "Manual assignment", "zh-CN": "手工指派" },
  "agents.installation.state.provisioning": { en: "Being installed", "zh-CN": "正在安装" },
  "agents.installation.state.active": { en: "Active installation record", "zh-CN": "安装记录为 ACTIVE" },
  "agents.installation.state.draining": { en: "Draining", "zh-CN": "正在排空" },
  "agents.installation.state.disabled": { en: "Disabled", "zh-CN": "已停用" },
  "agents.installation.state.error": { en: "Needs attention", "zh-CN": "需要处理" },
  "agents.installation.projection.pending": { en: "Projection pending", "zh-CN": "投影待收敛" },
  "agents.installation.projection.active": { en: "Active projection record", "zh-CN": "投影记录为 ACTIVE" },
  "agents.installation.projection.error": { en: "Projection needs attention", "zh-CN": "投影需要处理" },
  "agents.installation.projection.revoked": { en: "Projection revoked", "zh-CN": "投影已撤销" },
  "agents.installation.principal.active": { en: "Active identity", "zh-CN": "身份已启用" },
  "agents.installation.principal.disabled": { en: "Disabled identity", "zh-CN": "身份已停用" },
  "agents.installation.channel.active": { en: "Enabled channel binding", "zh-CN": "频道绑定已启用" },
  "agents.installation.channel.disabled": { en: "Disabled channel binding", "zh-CN": "频道绑定已停用" },
  "agents.installation.channel.error": { en: "Channel binding needs attention", "zh-CN": "频道绑定需要处理" },
  "agents.installation.resource.provisioning": { en: "Resource being provisioned", "zh-CN": "资源正在建立" },
  "agents.installation.resource.active": { en: "Active resource", "zh-CN": "资源已启用" },
  "agents.installation.resource.unknown": { en: "Resource outcome unknown", "zh-CN": "资源结果不明" },
  "agents.installation.resource.failed": { en: "Resource failed", "zh-CN": "资源失败" },
  "agents.installation.resource.retained": { en: "Retained read-only resource", "zh-CN": "保留的只读资源" },
  "agents.installation.resource.deleting": { en: "Resource being deleted", "zh-CN": "资源正在删除" },
  "agents.installation.resource.deleted": { en: "Deleted resource", "zh-CN": "资源已删除" },
  "agents.version.modelRoute": { en: "Requested model route", "zh-CN": "声明的模型路由" },
  "agents.version.instructions": { en: "Instructions", "zh-CN": "指令" },
  "agents.version.hash": { en: "Configuration hash", "zh-CN": "配置摘要" },
  "agents.automation.title": { en: "Automations", "zh-CN": "自动化" },
  "agents.automation.scope": { en: "Manage immutable versions and governed state. No manual run or external-trigger controls.", "zh-CN": "管理不可变版本与受治理状态；不提供手动运行或外部触发入口。" },
  "agents.automation.none": { en: "No readable, materialized automation in this workspace", "zh-CN": "该工作区没有可读取且已物化的自动化" },
  "agents.automation.state.draft": { en: "Draft", "zh-CN": "草稿" },
  "agents.automation.state.enabled": { en: "Enabled", "zh-CN": "已启用" },
  "agents.automation.state.paused": { en: "Paused", "zh-CN": "已暂停" },
  "agents.automation.state.disabled": { en: "Disabled", "zh-CN": "已停用" },
  "agents.automation.version.retired": { en: "Retired", "zh-CN": "已退役" },
  "agents.automation.create": { en: "Create automation", "zh-CN": "创建自动化" },
  "agents.automation.publish": { en: "Publish a new version", "zh-CN": "发布新版本" },
  "agents.automation.enable": { en: "Enable", "zh-CN": "启用" },
  "agents.automation.pause": { en: "Pause", "zh-CN": "暂停" },
  "agents.automation.disable": { en: "Disable", "zh-CN": "停用" },
  "agents.automation.executor": { en: "Executor installation", "zh-CN": "执行器安装" },
  "agents.automation.noExecutor": { en: "No active executor on this page", "zh-CN": "本页没有有效执行器" },
  "agents.automation.select": { en: "Choose a verified record", "zh-CN": "选择已查证的记录" },
  "agents.automation.trigger": { en: "Trigger", "zh-CN": "触发方式" },
  "agents.automation.channelMessage": { en: "Channel message", "zh-CN": "频道消息" },
  "agents.automation.schedule": { en: "Temporal schedule", "zh-CN": "Temporal 定时触发" },
  "agents.automation.everySeconds": { en: "Interval (seconds)", "zh-CN": "间隔（秒）" },
  "agents.automation.offsetSeconds": { en: "Offset (seconds)", "zh-CN": "偏移（秒）" },
  "agents.automation.catchupWindowSeconds": { en: "Catch-up window (seconds)", "zh-CN": "补偿窗口（秒）" },
  "agents.automation.scheduleRules": { en: "Enter all three values explicitly: a positive interval, an offset below the interval, and a catch-up window of at least 10 seconds. Overlapping runs are skipped.", "zh-CN": "请显式填写三项：正数间隔、小于间隔的非负偏移、至少 10 秒的补偿窗口；重叠运行将被跳过。" },
  "agents.automation.channel": { en: "Workspace channel", "zh-CN": "工作区频道" },
  "agents.automation.scheduleUnavailable": { en: "This executor has no verified channel reply capability. Scheduling is unavailable.", "zh-CN": "该执行器没有已查证的频道回复能力，无法定时运行。" },
  "agents.automation.prefix": { en: "Optional text prefix", "zh-CN": "文本前缀（可选）" },
  "agents.automation.template": { en: "Instruction template", "zh-CN": "指令模板" },
  "agents.automation.resultTarget": { en: "Result target", "zh-CN": "结果目标" },
  "agents.automation.thread": { en: "Trigger thread", "zh-CN": "触发线程" },
  "agents.automation.pinned": { en: "Pinned version", "zh-CN": "固定版本" },
  "agents.automation.grant": { en: "Verified delegation", "zh-CN": "已查证委托" },
  "agents.automation.noVersion": { en: "No readable version on this page", "zh-CN": "本页没有可读取的版本" },
  "agents.automation.noGrant": { en: "No valid delegation on this page; enable is unavailable", "zh-CN": "本页没有有效委托，不提供启用入口" },
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
  "platform.time.unavailable": { en: "Time unavailable", "zh-CN": "时间不可用" },
  "platform.time.now": { en: "now", "zh-CN": "现在" },
  "platform.time.absolute": {
    en: "{month}/{day}/{year} {hour}:{minute}",
    "zh-CN": "{year}年{month}月{day}日 {hour}:{minute}",
  },
  "platform.time.past.second.one": { en: "{count} second ago", "zh-CN": "{count} 秒前" },
  "platform.time.past.second.other": { en: "{count} seconds ago", "zh-CN": "{count} 秒前" },
  "platform.time.future.second.one": { en: "in {count} second", "zh-CN": "{count} 秒后" },
  "platform.time.future.second.other": { en: "in {count} seconds", "zh-CN": "{count} 秒后" },
  "platform.time.past.minute.one": { en: "{count} minute ago", "zh-CN": "{count} 分钟前" },
  "platform.time.past.minute.other": { en: "{count} minutes ago", "zh-CN": "{count} 分钟前" },
  "platform.time.future.minute.one": { en: "in {count} minute", "zh-CN": "{count} 分钟后" },
  "platform.time.future.minute.other": { en: "in {count} minutes", "zh-CN": "{count} 分钟后" },
  "platform.time.past.hour.one": { en: "{count} hour ago", "zh-CN": "{count} 小时前" },
  "platform.time.past.hour.other": { en: "{count} hours ago", "zh-CN": "{count} 小时前" },
  "platform.time.future.hour.one": { en: "in {count} hour", "zh-CN": "{count} 小时后" },
  "platform.time.future.hour.other": { en: "in {count} hours", "zh-CN": "{count} 小时后" },
  "platform.time.past.day.one": { en: "yesterday", "zh-CN": "昨天" },
  "platform.time.past.day.other": { en: "{count} days ago", "zh-CN": "{count} 天前" },
  "platform.time.future.day.one": { en: "tomorrow", "zh-CN": "明天" },
  "platform.time.future.day.other": { en: "in {count} days", "zh-CN": "{count} 天后" },
  "platform.time.past.month.one": { en: "last month", "zh-CN": "上个月" },
  "platform.time.past.month.other": { en: "{count} months ago", "zh-CN": "{count} 个月前" },
  "platform.time.future.month.one": { en: "next month", "zh-CN": "下个月" },
  "platform.time.future.month.other": { en: "in {count} months", "zh-CN": "{count} 个月后" },
  "chat.time.today": { en: "Today", "zh-CN": "今天" },
  "chat.time.yesterday": { en: "Yesterday", "zh-CN": "昨天" },
  "chat.time.justNow": { en: "just now", "zh-CN": "刚刚" },
  "chat.time.at": { en: "{day} at {time}", "zh-CN": "{day} {time}" },
  "chat.time.weekdayDate": { en: "{weekday}, {date}", "zh-CN": "{weekday}，{date}" },
  "chat.time.on": { en: "on {date}", "zh-CN": "{date}" },
  "chat.time.lastReply": { en: "last reply {time}", "zh-CN": "上次回复{time}" },
  "chat.thread.replyCount.one": { en: "{count} reply", "zh-CN": "{count} 条回复" },
  "chat.thread.replyCount.other": { en: "{count} replies", "zh-CN": "{count} 条回复" },
  "chat.thread.unreadCount": { en: "{count} new", "zh-CN": "新增 {count} 条" },
  "chat.thread.view": { en: "View thread", "zh-CN": "查看话题" },
  "chat.thread.aria.open": {
    en: "View thread with {replies}",
    "zh-CN": "查看有{replies}的话题",
  },
  "chat.thread.aria.openLast": {
    en: "View thread with {replies}, {lastReply}",
    "zh-CN": "查看有{replies}的话题，{lastReply}",
  },
  "platform.type": { en: "Type", "zh-CN": "类型" },
  "platform.action": { en: "Action", "zh-CN": "动作" },
  "platform.result": { en: "Result", "zh-CN": "结果" },
  "platform.audit.none": { en: "No actions recorded yet.", "zh-CN": "还没有记录到动作。" },
  "platform.audit.myTitle": { en: "My activity log", "zh-CN": "我的活动记录" },
  "platform.audit.scope.title": { en: "Scope audit", "zh-CN": "范围审计" },
  "platform.audit.scope.explain": {
    en: "Events in the organization or one workspace. Evidence shows only its kind; open an item to look up its ID.",
    "zh-CN": "组织或单个工作区内的审计事件。证据只列种类，点开一项才查询其 ID。",
  },
  "platform.audit.scope.select": { en: "Audit scope", "zh-CN": "审计范围" },
  "platform.audit.scope.tenant": { en: "Whole organization", "zh-CN": "整个组织" },
  "platform.audit.scope.tenantDenied": {
    en: "You do not have audit permission for the whole organization. Choose a workspace.",
    "zh-CN": "你没有整个组织的审计权限，可选择一个工作区。",
  },
  "platform.audit.scope.chooseWorkspace": { en: "Choose a workspace", "zh-CN": "选择工作区" },
  "platform.audit.scope.workspacesFailed": {
    en: "Couldn't load workspaces — the list is unknown.",
    "zh-CN": "未能载入工作区列表，结果不明。",
  },
  "platform.audit.scope.denied": {
    en: "You do not have audit permission for this scope.",
    "zh-CN": "你没有该范围的审计权限。",
  },
  "platform.audit.scope.none": {
    en: "No events recorded in this scope.",
    "zh-CN": "该范围内还没有审计事件。",
  },
  "platform.audit.scope.loadMore": { en: "Load more", "zh-CN": "加载更多" },
  "platform.audit.scope.evidence": { en: "Evidence", "zh-CN": "证据" },
  "platform.audit.scope.tenantLevel": { en: "Organization", "zh-CN": "组织" },
  "platform.audit.scope.unrecognizedKind": {
    en: "Unrecognized evidence",
    "zh-CN": "无法识别的证据",
  },
  "platform.audit.scope.restricted": { en: "Restricted", "zh-CN": "受限" },
  "platform.audit.scope.version": { en: "version {version}", "zh-CN": "版本 {version}" },
  "platform.audit.scope.unavailable": {
    en: "Unavailable: {reason}",
    "zh-CN": "不可用：{reason}",
  },
  "platform.audit.scope.notFound": {
    en: "Unavailable: the original record no longer exists.",
    "zh-CN": "不可用：原记录已不存在。",
  },
  "platform.audit.scope.unavailableUnknown": {
    en: "This evidence is unavailable.",
    "zh-CN": "该证据不可用。",
  },
  "platform.members.none": {
    en: "This workspace has no members.",
    "zh-CN": "该工作区没有成员。",
  },
  "platform.members.countOne": { en: "{count} member", "zh-CN": "{count} 位成员" },
  "platform.members.countOther": { en: "{count} members", "zh-CN": "{count} 位成员" },
  "platform.members.keyCountOne": { en: "{count} key", "zh-CN": "{count} 把密钥" },
  "platform.members.keyCountOther": { en: "{count} keys", "zh-CN": "{count} 把密钥" },
  "roles.title": { en: "Administrator roles", "zh-CN": "管理员角色" },
  "roles.none": { en: "No eligible members on this page.", "zh-CN": "本页没有符合条件的成员。" },
  "roles.tenant": { en: "Tenant admin", "zh-CN": "租户管理员" },
  "roles.workspace": { en: "Workspace admin", "zh-CN": "工作区管理员" },
  "roles.grant": { en: "Grant", "zh-CN": "授予" },
  "roles.revoke": { en: "Revoke", "zh-CN": "撤销" },
  "roles.lastAdmin": {
    en: "Cannot revoke the last effective tenant admin (LAST_TENANT_ADMIN).",
    "zh-CN": "不能撤销最后一位有效租户管理员（LAST_TENANT_ADMIN）。",
  },
  "roles.submitted": {
    en: "Action {action} was submitted (execution {execution}). Check Tasks for its final result.",
    "zh-CN": "动作 {action} 已提交（执行 {execution}）。请到任务页确认最终结果。",
  },
  "roles.unknown": {
    en: "Whether the action was accepted is unknown (operation {operation}). Check Tasks before trying again.",
    "zh-CN": "动作是否被接受尚不明确（操作 {operation}）。重试前请先查看任务页。",
  },
  "roles.rejected": { en: "Role change rejected: {reason}", "zh-CN": "角色变更被拒绝：{reason}" },
  "roles.confirm": {
    en: "Submit {action} for {member}? The final result is shown in Tasks.",
    "zh-CN": "为 {member} 提交 {action}？最终结果请到任务页查看。",
  },
  "roles.scopeTenantOnly": {
    en: "Current scope: whole organization. Workspace {name} is not active, so its roles cannot be managed now.",
    "zh-CN": "当前作用域：整个组织。工作区 {name} 未处于正常状态，暂不能管理其角色。",
  },
  "roles.next": { en: "Next page", "zh-CN": "下一页" },
  "roles.previous": { en: "Previous page", "zh-CN": "上一页" },
  "secretRehome.title": { en: "Legacy identity keys", "zh-CN": "旧身份密钥归位" },
  "secretRehome.explain": {
    en: "Move the existing key reference into this tenant's vault. The public identity and channel history stay unchanged.",
    "zh-CN": "将现有密钥引用归入本租户的密钥库；公钥身份和频道历史不变。",
  },
  "secretRehome.none": { en: "No legacy identity references on this page.", "zh-CN": "本页没有旧身份引用。" },
  "secretRehome.kind": { en: "Identity kind", "zh-CN": "身份类型" },
  "secretRehome.pubkey": { en: "Public key", "zh-CN": "公钥" },
  "secretRehome.move": { en: "Move reference", "zh-CN": "归位引用" },
  "secretRehome.confirm": {
    en: "Move the key reference for {pubkey}? This does not rotate the key. Confirm explicitly; the final result is shown in Tasks.",
    "zh-CN": "归位公钥 {pubkey} 的密钥引用？这不会轮换密钥。请明确确认；最终结果在任务页查看。",
  },
  "secretRehome.submitted": {
    en: "Migration submitted (execution {execution}). Check Tasks for the final result.",
    "zh-CN": "归位任务已提交（执行 {execution}）。请到任务页确认最终结果。",
  },
  "secretRehome.unknown": {
    en: "Submission outcome unknown (operation {operation}). Check Tasks or retry the same intent; no new key will be created.",
    "zh-CN": "提交结果不明（操作 {operation}）。请查看任务或重试同一意图；不会生成新的幂等键。",
  },
  "secretRehome.rejected": { en: "Migration rejected: {reason}", "zh-CN": "归位被拒绝：{reason}" },
  "platform.devices.none": {
    en: "No devices yet. Sign in on a desktop or mobile device to add one.",
    "zh-CN": "还没有设备。在桌面端或移动端登录即可添加。",
  },
  "platform.devices.explain": {
    en: "Each device holds its own key. Revoking one stops only that device.",
    "zh-CN": "每台设备各持自己的密钥。撤销只停用那一台设备。",
  },
  "platform.devices.added": { en: "Added", "zh-CN": "添加于" },
  "platform.devices.thisDevice": { en: "This device", "zh-CN": "本机" },
  "platform.devices.revoke": { en: "Revoke", "zh-CN": "撤销" },
  "platform.devices.myTitle": { en: "My devices", "zh-CN": "我的设备" },
  "platform.devices.registered": { en: "Registered devices", "zh-CN": "已登记设备" },
  "platform.devices.registeredAt": {
    en: "{state} · registered {time}",
    "zh-CN": "{state} · 登记于 {time}",
  },
  "platform.devices.revokeTitle": { en: "Revoke device", "zh-CN": "撤销设备" },
  "platform.devices.revokeThisConfirm": {
    en: "This device will lose access to your workspaces and be signed out.",
    "zh-CN": "本机将失去工作区访问权限，并退出登录。",
  },
  "platform.devices.revokeOtherConfirm": {
    en: "That device will lose access to your workspaces.",
    "zh-CN": "该设备将失去工作区访问权限。",
  },
  "platform.devices.stateAfterRevoke": {
    en: "Device status: {state}.",
    "zh-CN": "设备状态：{state}。",
  },
  "platform.devices.revokeUnknown": {
    en: "The revocation result is unknown (operation {operation}). Reload to check.",
    "zh-CN": "撤销结果不明（操作 {operation}）。请刷新后确认。",
  },
  "platform.devices.revokeRejected": {
    en: "The revocation was rejected: {reason}",
    "zh-CN": "撤销被拒绝：{reason}",
  },

  "platform.notMember": {
    en: "Your account is not a member of any organization yet. If you were invited, open your invitation link.",
    "zh-CN": "你的账号还不是任何组织的成员。如果你收到了邀请，请打开邀请链接。",
  },
  "platform.refresh": { en: "Refresh", "zh-CN": "刷新" },
  "platform.back": { en: "Back", "zh-CN": "返回" },
  "platform.confirm": { en: "Confirm", "zh-CN": "确认" },
  "platform.cancel": { en: "Cancel", "zh-CN": "取消" },
  "platform.settings.organization": { en: "Organization", "zh-CN": "组织" },
  "platform.settings.close": { en: "Close settings", "zh-CN": "关闭设置" },
  "platform.settings.appearance": { en: "Appearance", "zh-CN": "外观" },
  "platform.settings.theme": { en: "Theme", "zh-CN": "主题" },
  "platform.theme.appearanceDescription": {
    en: "Choose how {name} looks and feels.",
    "zh-CN": "选择{name}的界面外观。",
  },
  "platform.theme.styleDescription": {
    en: "Choose the colors used throughout {name}.",
    "zh-CN": "选择{name}使用的配色。",
  },
  "platform.theme.modeLight": { en: "Light", "zh-CN": "浅色" },
  "platform.theme.modeDark": { en: "Dark", "zh-CN": "深色" },
  "platform.theme.modeSystem": { en: "System", "zh-CN": "跟随系统" },
  "platform.theme.accentColor": { en: "Accent color", "zh-CN": "强调色" },
  "platform.theme.accentNeutral": { en: "Neutral accent color", "zh-CN": "中性强调色" },
  "platform.theme.accentBlue": { en: "Blue accent color", "zh-CN": "蓝色强调色" },
  "platform.theme.accentCyan": { en: "Cyan accent color", "zh-CN": "青色强调色" },
  "platform.theme.accentGreen": { en: "Green accent color", "zh-CN": "绿色强调色" },
  "platform.theme.accentOrange": { en: "Orange accent color", "zh-CN": "橙色强调色" },
  "platform.theme.accentRed": { en: "Red accent color", "zh-CN": "红色强调色" },
  "platform.theme.accentPink": { en: "Pink accent color", "zh-CN": "粉色强调色" },
  "platform.theme.accentLilac": { en: "Lilac accent color", "zh-CN": "淡紫色强调色" },
  "platform.theme.accentPurple": { en: "Purple accent color", "zh-CN": "紫色强调色" },
  "platform.theme.accentIndigo": { en: "Indigo accent color", "zh-CN": "靛蓝色强调色" },
  "platform.theme.homePreview": { en: "Home preview", "zh-CN": "首页预览" },
  "platform.theme.chatPreview": { en: "Chat preview", "zh-CN": "聊天预览" },
  "platform.theme.closePreview": { en: "Close preview", "zh-CN": "关闭预览" },
  "platform.theme.apply": { en: "Set", "zh-CN": "应用" },
  "platform.theme.appearanceCycle": {
    en: "{mode} appearance. Double tap to change.",
    "zh-CN": "{mode}外观。双击切换。",
  },
  "platform.theme.scrubber": { en: "Theme {index} of {count}", "zh-CN": "第 {index} 个主题，共 {count} 个" },
  "platform.theme.communitySample": { en: "Community", "zh-CN": "社区" },
  "platform.settings.connection": { en: "Server connection", "zh-CN": "服务器连接" },
  "platform.settings.copyDeviceKey": { en: "Copy device public key", "zh-CN": "复制设备公钥" },
  "platform.settings.identityUnavailable": { en: "Identity unavailable", "zh-CN": "身份不可用" },
  "platform.settings.deviceKey": { en: "Device key", "zh-CN": "设备密钥" },
  "platform.settings.keyCopied": { en: "Pubkey copied", "zh-CN": "公钥已复制" },
  "platform.settings.signOutConfirm": {
    en: "This disconnects this device from your workspaces. The device stays registered; signing in again reconnects it.",
    "zh-CN": "这会断开本机与工作区的连接。设备仍保持登记，再次登录即可重新连接。",
  },
  "platform.reasonWithCode": { en: "{text} ({code})", "zh-CN": "{text}（{code}）" },

  "tasks.none": {
    en: "You have not started any governed action yet.",
    "zh-CN": "你还没有发起过受治理的动作。",
  },
  "tasks.title": { en: "Task", "zh-CN": "任务" },
  "tasks.myTitle": { en: "My tasks", "zh-CN": "我的任务" },
  "tasks.created": { en: "Started", "zh-CN": "发起于" },
  "tasks.operation": { en: "Operation", "zh-CN": "操作" },
  "tasks.execution": { en: "Action execution", "zh-CN": "动作执行" },
  "tasks.target": { en: "Target", "zh-CN": "目标" },
  "tasks.workflow": { en: "Workflow", "zh-CN": "Workflow" },
  "tasks.waitingReason": { en: "Waiting for", "zh-CN": "正在等待" },
  "tasks.reason": { en: "Reason", "zh-CN": "原因" },
  "tasks.approval": { en: "Approval", "zh-CN": "审批" },
  "tasks.cancelRequest": { en: "Request cancellation", "zh-CN": "请求取消" },
  "tasks.confirmCancel": {
    en: "Request cancellation of this running task? A submitted request is not a canceled task; wait for its final status.",
    "zh-CN": "请求取消这项运行中的任务？请求已提交不等于任务已取消，仍须等待最终状态。",
  },
  "tasks.cancelSubmitted": {
    en: "Cancellation control recorded under operation {operation}; the original task is not yet confirmed canceled.",
    "zh-CN": "取消控制已记录为操作 {operation}；原任务尚未确认取消。",
  },
  "tasks.cancelUnknown": {
    en: "Cancellation request outcome is unknown (operation {operation}). Check the control task, or resend the same intent.",
    "zh-CN": "取消请求结果不明（操作 {operation}）。请检查控制任务，或原样重发同一次意图。",
  },
  "tasks.cancelSendAgain": { en: "Resend same request", "zh-CN": "重发同一次请求" },
  "tasks.cancelRejected": {
    en: "Cancellation request rejected: {reason}",
    "zh-CN": "取消请求被拒绝：{reason}",
  },
  "tasks.rerunRequest": { en: "Run again", "zh-CN": "重新运行" },
  "tasks.confirmRerun": {
    en: "Start a new governed run of this closed task? It receives a new action and workflow; any required approval must be granted again.",
    "zh-CN": "为这项已结束的任务发起一次新的受治理执行？它会取得新的动作与 Workflow；原任务要求的审批必须重新完成。",
  },
  "tasks.rerunSubmitted": {
    en: "Rerun control recorded under operation {operation}. Open the new task for approval and final status:",
    "zh-CN": "重跑控制已记录为操作 {operation}。请打开新任务查看审批与最终状态：",
  },
  "tasks.rerunUnknown": {
    en: "Rerun request outcome is unknown (operation {operation}). Check the control task, or resend the same intent.",
    "zh-CN": "重跑请求结果不明（操作 {operation}）。请检查控制任务，或原样重发同一次意图。",
  },
  "tasks.rerunRejected": {
    en: "Rerun request rejected: {reason}",
    "zh-CN": "重跑请求被拒绝：{reason}",
  },
  "tasks.status.evaluating": { en: "Being evaluated", "zh-CN": "正在判定" },
  "tasks.status.waitingApproval": { en: "Waiting for approval", "zh-CN": "等待审批" },
  "tasks.status.denied": { en: "Not allowed", "zh-CN": "未获准" },
  "tasks.status.revoked": { en: "Withdrawn or no longer allowed", "zh-CN": "已撤回或不再获准" },
  "tasks.status.expired": { en: "Expired", "zh-CN": "已过期" },
  "tasks.status.notStarted": { en: "Allowed, not started yet", "zh-CN": "已获准，尚未开始" },
  "tasks.status.aborted": { en: "Stopped before it took effect", "zh-CN": "生效前已中止" },
  "tasks.status.started": { en: "Started", "zh-CN": "已开始" },
  "tasks.status.applied": { en: "Applied", "zh-CN": "已生效" },
  "tasks.status.cancelRequestAccepted": {
    en: "Cancellation request accepted; awaiting task outcome",
    "zh-CN": "取消请求已接收，等待任务终态",
  },
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
  "approvals.pendingTitle": { en: "Waiting for my approval", "zh-CN": "等待我审批" },
  "approvals.mobileReadOnly": {
    en: "To approve, deny or withdraw, use the web or desktop app.",
    "zh-CN": "请在网页端或桌面端批准、拒绝或撤回。",
  },
  "approvals.expiresAt": { en: "Expires {time}", "zh-CN": "{time} 到期" },
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

  "invitations.title": { en: "Invitations", "zh-CN": "邀请" },
  "invitations.explain": {
    en: "An invitation link lets one person ask to join this organization. After they use it, an admin confirms it is really them (in Approvals).",
    "zh-CN": "一条邀请链接让一个人申请加入本组织。对方使用后，由管理员在「审批」中确认确实是本人。",
  },
  "invitations.inviteeLabel": { en: "Who is this for?", "zh-CN": "邀请谁？" },
  "invitations.inviteeHint": {
    en: "A name you will recognize when confirming. It is not checked.",
    "zh-CN": "确认时你能认出的称呼，不做校验。",
  },
  "invitations.issue": { en: "Create invitation link", "zh-CN": "生成邀请链接" },
  "invitations.issued": {
    en: "Invitation link for {label} (expires {expires}). It is shown only this once — copy it now. If it is lost, withdraw this invitation and create a new one.",
    "zh-CN": "给 {label} 的邀请链接（{expires}到期）。它只显示这一次，请立即复制；丢失即撤回并重新生成。",
  },
  "invitations.copy": { en: "Copy link", "zh-CN": "复制链接" },
  "invitations.copied": { en: "Copied", "zh-CN": "已复制" },
  "invitations.noLink": {
    en: "The invitation exists, but its link can no longer be shown. Withdraw it and create a new one.",
    "zh-CN": "邀请已存在，但链接无法再显示。请撤回后重新生成。",
  },
  "invitations.issueUnknown": {
    en: "Whether the invitation was created is not known (operation {operation}). Refresh the list; if it appears without a link you have, withdraw it and create a new one.",
    "zh-CN": "邀请是否已生成尚不明确（操作 {operation}）。请刷新列表；若出现了你没拿到链接的邀请，撤回后重新生成。",
  },
  "invitations.issueRejected": { en: "The invitation was not created: {reason}", "zh-CN": "邀请未生成：{reason}" },
  "invitations.none": { en: "No invitations yet.", "zh-CN": "还没有邀请。" },
  "invitations.invitee": { en: "For", "zh-CN": "邀请对象" },
  "invitations.redeemer": { en: "Used by (self-reported)", "zh-CN": "使用者（自报）" },
  "invitations.confirmation": { en: "Confirmation", "zh-CN": "确认" },
  "invitations.withdraw": { en: "Withdraw", "zh-CN": "撤回" },
  "invitations.confirmWithdraw": {
    en: "Withdraw the invitation for {label}? Its link will stop working.",
    "zh-CN": "撤回给 {label} 的邀请？该链接将失效。",
  },
  "invitations.withdrawUnknown": {
    en: "Whether the invitation was withdrawn is not known (operation {operation}). Refresh to check.",
    "zh-CN": "邀请是否已撤回尚不明确（操作 {operation}）。请刷新确认。",
  },
  "invitations.withdrawRejected": {
    en: "The invitation was not withdrawn: {reason}",
    "zh-CN": "邀请未撤回：{reason}",
  },
  "invitations.forApproval": {
    en: "Invitation for “{label}”, used by someone who calls themselves “{name}”. Confirm it is really them before approving.",
    "zh-CN": "给「{label}」的邀请，使用者自称「{name}」。批准前请以其他方式确认确实是本人。",
  },

  "redeem.title": { en: "Join an organization", "zh-CN": "加入组织" },
  "redeem.explain": {
    en: "You were sent an invitation. Tell the admin who you are; they will confirm it before you get access.",
    "zh-CN": "你收到了一份邀请。告诉管理员你是谁，管理员确认后你才会获得访问权限。",
  },
  "redeem.displayName": { en: "Your name", "zh-CN": "你的名字" },
  "redeem.submit": { en: "Use this invitation", "zh-CN": "使用邀请" },
  "redeem.noCredential": {
    en: "This page did not receive an invitation. If you came from an invitation link, open the link again now that you are signed in.",
    "zh-CN": "本页没有收到邀请。如果你是从邀请链接来的，请在登录后再打开一次该链接。",
  },
  "redeem.unknown": {
    en: "Whether the invitation was used is not known. Submitting again is safe.",
    "zh-CN": "邀请是否已使用尚不明确。再次提交是安全的。",
  },
  "redeem.again": { en: "Submit again", "zh-CN": "再次提交" },
  "redeem.rejected": { en: "The invitation could not be used: {reason}", "zh-CN": "邀请无法使用：{reason}" },
  "redeem.mine": { en: "My invitations", "zh-CN": "我的邀请" },
  "redeem.waiting": {
    en: "Waiting for an admin of {tenant} to confirm it is you. You can close this page and come back later.",
    "zh-CN": "等待 {tenant} 的管理员确认是你本人。你可以先关闭本页，稍后再来。",
  },
  "redeem.evaluating": { en: "Your request to join {tenant} is being evaluated.", "zh-CN": "加入 {tenant} 的请求正在判定。" },
  "redeem.provisioning": { en: "Confirmed. Your access to {tenant} is being set up.", "zh-CN": "已确认，正在开通你在 {tenant} 的访问权限。" },
  "redeem.active": { en: "You are a member of {tenant}.", "zh-CN": "你已是 {tenant} 的成员。" },
  "redeem.ended": { en: "Your invitation to {tenant} has ended: {reason}", "zh-CN": "你加入 {tenant} 的邀请已终结：{reason}" },
  "redeem.other": { en: "{tenant}: {state}", "zh-CN": "{tenant}：{state}" },
  "redeem.continue": { en: "Continue", "zh-CN": "继续" },
  "redeem.nativeHint": {
    en: "If you were invited, open your invitation link in the browser and sign in there. Once an admin confirms it, check again here.",
    "zh-CN": "如果你收到了邀请，请在浏览器中打开邀请链接并登录；管理员确认后，回到这里重新确认。",
  },

  "native.config.title": { en: "Connect to your server", "zh-CN": "连接服务器" },
  "native.config.explain": {
    en: "Enter the addresses your administrator gave you. Nothing is filled in for you: a guessed address would receive your sign-in and device key.",
    "zh-CN": "填写管理员提供的地址。这里不预填任何值：猜测的地址会拿到你的登录与设备密钥。",
  },
  "native.config.nativeApiUrl": { en: "Native entry URL", "zh-CN": "原生入口地址" },
  "native.config.oidcIssuer": { en: "Sign-in issuer (OIDC)", "zh-CN": "登录 issuer（OIDC）" },
  "native.config.oidcClientId": { en: "Client ID", "zh-CN": "客户端 ID" },
  "native.config.server": { en: "Server: {host}", "zh-CN": "服务器：{host}" },
  "native.config.invalidUrl": {
    en: "{field} is not a valid URL.", "zh-CN": "{field} 不是有效的网址。",
  },
  "native.config.invalidScheme": {
    en: "{field} must use HTTP or HTTPS.", "zh-CN": "{field} 必须使用 HTTP 或 HTTPS。",
  },
  "native.config.invalidExtras": {
    en: "{field} must not include a query or fragment.", "zh-CN": "{field} 不能包含查询参数或片段。",
  },
  "native.config.invalidUserInfo": {
    en: "{field} must not include user information.", "zh-CN": "{field} 不能包含用户信息。",
  },
  "native.config.clientIdRequired": {
    en: "Client ID is required.", "zh-CN": "必须填写客户端 ID。",
  },
  "native.config.save": { en: "Save and continue", "zh-CN": "保存并继续" },
  "native.config.saving": { en: "Saving…", "zh-CN": "正在保存…" },
  "native.config.edit": { en: "Change connection settings", "zh-CN": "修改连接设置" },
  "native.config.rejected": {
    en: "These settings were not accepted.",
    "zh-CN": "设置未被接受。",
  },
  "native.signIn.title": { en: "Sign in", "zh-CN": "登录" },
  "native.signIn.titleNamed": { en: "Sign in to {name}", "zh-CN": "登录{name}" },
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
  "native.signIn.failed": { en: "Sign-in did not complete.", "zh-CN": "登录未完成。" },
  "native.status.unconfigured": {
    en: "The server is not set up on this device.", "zh-CN": "本机尚未配置服务器连接。",
  },
  "native.status.signedOut": { en: "Signed out.", "zh-CN": "已退出登录。" },
  "native.status.awaitingActivation": {
    en: "Waiting for this device to be added to your workspaces…",
    "zh-CN": "正在等待本机加入你的工作区…",
  },
  "native.status.linked": { en: "Connected.", "zh-CN": "已连接。" },
  "native.relay.connected": { en: "Connected", "zh-CN": "已连接" },
  "native.relay.waiting": { en: "Waiting to reconnect", "zh-CN": "等待重新连接" },
  "native.relay.connecting": { en: "Connecting", "zh-CN": "正在连接" },
  "native.relay.helperPrompt": {
    en: "Complete any prompts opened by the reconnect helper to continue.",
    "zh-CN": "请完成重新连接助手打开的提示以继续。",
  },
  "native.relay.reconnecting": { en: "Reconnecting", "zh-CN": "正在重新连接" },
  "native.relay.connect": { en: "Connect to relay", "zh-CN": "连接 Relay" },
  "native.relay.clickToConnect": { en: "Click to connect", "zh-CN": "点击连接" },
  "native.relay.dismissNotification": {
    en: "Dismiss relay notification", "zh-CN": "关闭 Relay 通知",
  },
  "native.relay.unreachable": { en: "Can't reach the relay", "zh-CN": "无法连接 Relay" },
  "native.status.failed": { en: "Could not connect.", "zh-CN": "未能连接。" },
  "native.status.outcomeUnknown": {
    en: "The outcome is not known yet.", "zh-CN": "结果尚不明确。",
  },
  "native.error.httpOutcomeUnknown": {
    en: "The server answered HTTP {status}; the outcome is not known.",
    "zh-CN": "服务器返回 HTTP {status}；结果尚不明确。",
  },
  "native.error.unavailable": {
    en: "The server could not be reached; the outcome is not known.",
    "zh-CN": "无法连接服务器；结果尚不明确。",
  },
  "native.error.contract": {
    en: "The server answered outside the contract; the outcome is not known.",
    "zh-CN": "服务器的响应不符合契约；结果尚不明确。",
  },
  "native.error.sessionEnded": {
    en: "Your sign-in has ended.", "zh-CN": "你的登录已失效。",
  },
  "native.error.signInAgain": { en: "Sign in again", "zh-CN": "重新登录" },
  "native.unavailable.title": { en: "Not available here", "zh-CN": "此处不可用" },
  "native.device.registering": {
    en: "Registering this device…",
    "zh-CN": "正在登记本机…",
  },
  "native.device.pending": {
    en: "This device is being added ({state}). This usually takes a moment; check again to continue.",
    "zh-CN": "正在添加本机（{state}），通常片刻即可完成；完成后点「重新确认」继续。",
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
    en: "Couldn't connect to your community.",
    "zh-CN": "未能连接 Community。",
  },
  "native.send.rejected": {
    en: "Not sent: the server refused this message. Your text is kept.",
    "zh-CN": "未发送：服务器拒绝了这条消息。内容已保留。",
  },
  "native.send.rateLimited": {
    en: "Not sent: you are sending too fast. Try again in {seconds} s. Your text is kept.",
    "zh-CN": "未发送：发送过于频繁，请 {seconds} 秒后再试。内容已保留。",
  },
  "native.send.rateLimitedNoHint": {
    en: "Not sent: you are sending too fast. Try again shortly. Your text is kept.",
    "zh-CN": "未发送：发送过于频繁，请稍后再试。内容已保留。",
  },
  "native.send.notConnected": {
    en: "Not sent: this device is not connected to the server. Your text is kept.",
    "zh-CN": "未发送：本机尚未连接服务器。内容已保留。",
  },
  "native.send.outcomeUnknown": {
    en: "Delivery not confirmed. Your text is kept; sending it again unchanged will not post it twice.",
    "zh-CN": "未确认送达。内容已保留；原样再次发送不会重复发出。",
  },
  "native.sync.reconnecting": {
    en: "Not synced: reconnecting to the server. Messages shown may be out of date.",
    "zh-CN": "未同步：正在重新连接服务器，显示的消息可能不是最新。",
  },
  "native.sync.rejected": {
    en: "Not synced: the server no longer accepts this device.",
    "zh-CN": "未同步：服务器已不再接受本机。",
  },
  "native.signOut.serverUnconfirmed": {
    en: "Signed out on this device. The server did not confirm that your sign-in was ended; it will expire on its own.",
    "zh-CN": "本机已退出。服务器未确认结束登录，它将按有效期自行失效。",
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

export const invitationStatusMessages = {
  [TenantInvitationStatus.Issued]: { en: "Not used yet", "zh-CN": "尚未使用" },
  [TenantInvitationStatus.Expired]: { en: "Expired", "zh-CN": "已过期" },
  [TenantInvitationStatus.Redeemed]: { en: "Used", "zh-CN": "已使用" },
  [TenantInvitationStatus.Revoked]: { en: "Withdrawn", "zh-CN": "已撤回" },
} as const satisfies Record<TenantInvitationStatus, Message>;

export const tenantMembershipStateMessages = {
  [TenantMembershipState.Invited]: { en: "Awaiting confirmation", "zh-CN": "待确认" },
  [TenantMembershipState.Provisioning]: { en: "Being set up", "zh-CN": "正在开通" },
  [TenantMembershipState.Active]: { en: "Member", "zh-CN": "成员" },
  [TenantMembershipState.Revoking]: { en: "Being removed", "zh-CN": "正在移除" },
  [TenantMembershipState.Revoked]: { en: "Not a member", "zh-CN": "非成员" },
  [TenantMembershipState.Error]: { en: "Needs attention", "zh-CN": "需要处理" },
} as const satisfies Record<TenantMembershipState, Message>;

export const workspaceMembershipStateMessages = {
  [WorkspaceMembershipState.Provisioning]: { en: "Being set up", "zh-CN": "正在开通" },
  [WorkspaceMembershipState.Active]: { en: "Member", "zh-CN": "成员" },
  [WorkspaceMembershipState.Revoking]: { en: "Being removed", "zh-CN": "正在移除" },
  [WorkspaceMembershipState.Revoked]: { en: "Not a member", "zh-CN": "非成员" },
  [WorkspaceMembershipState.Error]: { en: "Needs attention", "zh-CN": "需要处理" },
} as const satisfies Record<WorkspaceMembershipState, Message>;

export const workspaceStateMessages = {
  [WorkspaceState.Provisioning]: { en: "Being set up", "zh-CN": "正在建立" },
  [WorkspaceState.Active]: { en: "Active", "zh-CN": "正常" },
  [WorkspaceState.Suspending]: { en: "Being suspended", "zh-CN": "正在暂停" },
  [WorkspaceState.Suspended]: { en: "Suspended", "zh-CN": "已暂停" },
  [WorkspaceState.Restoring]: { en: "Being restored", "zh-CN": "正在恢复" },
  [WorkspaceState.Error]: { en: "Needs attention", "zh-CN": "需要处理" },
} as const satisfies Record<WorkspaceState, Message>;

export const tenantStateMessages = {
  [TenantState.Provisioning]: { en: "Being set up", "zh-CN": "正在建立" },
  [TenantState.Active]: { en: "Active", "zh-CN": "正常" },
  [TenantState.Suspending]: { en: "Being suspended", "zh-CN": "正在暂停" },
  [TenantState.Suspended]: { en: "Suspended", "zh-CN": "已暂停" },
  [TenantState.Restoring]: { en: "Being restored", "zh-CN": "正在恢复" },
  [TenantState.Deleting]: { en: "Being deleted", "zh-CN": "正在删除" },
  [TenantState.Deleted]: { en: "Deleted", "zh-CN": "已删除" },
  [TenantState.Error]: { en: "Needs attention", "zh-CN": "需要处理" },
} as const satisfies Record<TenantState, Message>;

export const buzzIdentityStateMessages = {
  [BuzzIdentityState.PendingSecret]: { en: "Preparing key", "zh-CN": "正在准备密钥" },
  [BuzzIdentityState.Reconciling]: { en: "Being added", "zh-CN": "正在接入" },
  [BuzzIdentityState.Active]: { en: "Active", "zh-CN": "有效" },
  [BuzzIdentityState.Revoking]: { en: "Being removed", "zh-CN": "正在撤销" },
  [BuzzIdentityState.Revoked]: { en: "Revoked", "zh-CN": "已撤销" },
} as const satisfies Record<BuzzIdentityState, Message>;

export const auditEventTypeMessages = {
  [AuditEventType.Authentication]: { en: "Authentication", "zh-CN": "认证" },
  [AuditEventType.Session]: { en: "Session", "zh-CN": "会话" },
  [AuditEventType.Intent]: { en: "Intent", "zh-CN": "意图" },
  [AuditEventType.Decision]: { en: "Decision", "zh-CN": "决策" },
  [AuditEventType.Approval]: { en: "Approval", "zh-CN": "审批" },
  [AuditEventType.Dispatch]: { en: "Dispatch", "zh-CN": "派发" },
  [AuditEventType.Outcome]: { en: "Outcome", "zh-CN": "结果" },
  [AuditEventType.Revocation]: { en: "Revocation", "zh-CN": "撤权" },
  [AuditEventType.Reconciliation]: { en: "Reconciliation", "zh-CN": "对账" },
  [AuditEventType.Access]: { en: "Access", "zh-CN": "访问" },
} as const satisfies Record<AuditEventType, Message>;

export const evidenceKindMessages = {
  [EvidenceKind.ActionExecutionID]: { en: "Action execution", "zh-CN": "动作执行" },
  [EvidenceKind.AdmitActionExecutionID]: { en: "Admitting action execution", "zh-CN": "准入动作执行" },
  [EvidenceKind.ApprovalPolicy]: { en: "Approval policy", "zh-CN": "审批策略" },
  [EvidenceKind.ApprovalWorkflowID]: { en: "Approval workflow", "zh-CN": "审批流程" },
  [EvidenceKind.BuzzDeletionInventoryDigest]: { en: "Buzz deletion inventory digest", "zh-CN": "Buzz 删除清单摘要" },
  [EvidenceKind.BuzzDeletionRequestID]: { en: "Buzz deletion request", "zh-CN": "Buzz 删除请求" },
  [EvidenceKind.BuzzEventID]: { en: "Buzz event", "zh-CN": "Buzz 事件" },
  [EvidenceKind.BuzzPubkey]: { en: "Buzz public key", "zh-CN": "Buzz 公钥" },
  [EvidenceKind.DeploymentBootstrap]: { en: "Deployment bootstrap", "zh-CN": "部署初始化" },
  [EvidenceKind.ExternalSubjectSha256]: { en: "External account fingerprint", "zh-CN": "外部账号指纹" },
  [EvidenceKind.OriginalActionExecutionID]: { en: "Original action execution", "zh-CN": "原动作执行" },
  [EvidenceKind.PlatformSessionID]: { en: "Platform session", "zh-CN": "平台会话" },
  [EvidenceKind.SecretRefRehomeID]: { en: "Key reference move", "zh-CN": "密钥引用归位" },
  [EvidenceKind.SpicedbRelationship]: { en: "Permission relationship", "zh-CN": "权限关系" },
  [EvidenceKind.SpicedbZedtoken]: { en: "Permission snapshot", "zh-CN": "权限快照" },
  [EvidenceKind.TemporalFirstRunID]: { en: "First workflow run", "zh-CN": "流程首次运行" },
  [EvidenceKind.TemporalRunID]: { en: "Workflow run", "zh-CN": "流程运行" },
  [EvidenceKind.TemporalWorkflowID]: { en: "Workflow", "zh-CN": "流程" },
  [EvidenceKind.TenantDeleteSubprocessID]: { en: "Organization deletion subprocess", "zh-CN": "组织删除子流程" },
  [EvidenceKind.TenantInvitationID]: { en: "Organization invitation", "zh-CN": "组织邀请" },
  [EvidenceKind.TenantLifecycleSnapshotID]: { en: "Organization lifecycle snapshot", "zh-CN": "组织生命周期快照" },
  [EvidenceKind.TenantMembershipID]: { en: "Organization membership", "zh-CN": "组织成员资格" },
  [EvidenceKind.UsageEventID]: { en: "Usage delivery event", "zh-CN": "用量投递事件" },
  [EvidenceKind.OpenmeterEventID]: { en: "OpenMeter event", "zh-CN": "OpenMeter 事件" },
  [EvidenceKind.AgentgatewayUsageID]: { en: "Gateway durable usage", "zh-CN": "网关持久用量" },
  [EvidenceKind.TraceID]: { en: "Model dispatch trace", "zh-CN": "模型派发 Trace" },
} as const satisfies Record<EvidenceKind, Message>;

export const evidenceAuthorityMessages = {
  [EvidenceAuthority.Core]: { en: "Platform core", "zh-CN": "平台核心" },
  [EvidenceAuthority.Buzz]: { en: "Buzz", "zh-CN": "Buzz" },
  [EvidenceAuthority.Oidc]: { en: "Sign-in provider", "zh-CN": "登录身份源" },
  [EvidenceAuthority.Spicedb]: { en: "Permission service", "zh-CN": "权限服务" },
  [EvidenceAuthority.Temporal]: { en: "Workflow engine", "zh-CN": "流程引擎" },
  [EvidenceAuthority.Openmeter]: { en: "OpenMeter", "zh-CN": "OpenMeter" },
  [EvidenceAuthority.Agentgateway]: { en: "AgentGateway", "zh-CN": "AgentGateway" },
} as const satisfies Record<EvidenceAuthority, Message>;

export const evidenceUnavailableReasonMessages = {
  [EvidenceUnavailableReason.NotFound]: {
    en: "the original record no longer exists",
    "zh-CN": "原记录已不存在",
  },
  [EvidenceUnavailableReason.Restricted]: {
    en: "restricted evidence you are not authorized to view",
    "zh-CN": "受限证据，你无权查看",
  },
  [EvidenceUnavailableReason.Unrecognized]: {
    en: "the evidence kind is not recognized",
    "zh-CN": "证据种类无法识别",
  },
  [EvidenceUnavailableReason.Unverifiable]: {
    en: "its source cannot confirm that it still exists",
    "zh-CN": "权威源无法核实其仍存在",
  },
} as const satisfies Record<EvidenceUnavailableReason, Message>;

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
    en: "This account is not recognized.",
    "zh-CN": "无法识别这个账号。",
  },
  [ReasonCode.IdentityUnknown]: {
    en: "This account is not recognized.",
    "zh-CN": "无法识别这个账号。",
  },
  [ReasonCode.TenantMembershipNotActive]: {
    en: "Your membership in this organization is not active.",
    "zh-CN": "你在该组织的成员资格未生效。",
  },
  [ReasonCode.TenantNotActive]: {
    en: "This organization is suspended or not available right now.",
    "zh-CN": "该组织已暂停或当前不可用。",
  },
  [ReasonCode.SessionNotActive]: {
    en: "Your session is no longer active.",
    "zh-CN": "你的会话已失效。",
  },
  [ReasonCode.TenantSelectionNotAvailable]: {
    en: "Your account belongs to more than one organization, which cannot be chosen between yet.",
    "zh-CN": "你的账号属于多个组织，目前还不能在其间选择。",
  },
  [ReasonCode.NativeSurfaceRequired]: {
    en: "This must be done in the desktop or mobile app.",
    "zh-CN": "这一步只能在桌面端或移动端完成。",
  },
  [ReasonCode.ClientKeyProofInvalid]: {
    en: "The server did not accept this device's key proof.",
    "zh-CN": "服务器未接受本机的密钥证明。",
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
  [ReasonCode.BindingNotActive]: {
    en: "The connection required for this operation is not active. Nothing was executed; try again later.",
    "zh-CN": "此操作所需的连接尚未生效，本次未执行；请稍后再试。",
  },
  [ReasonCode.RateLimited]: {
    en: "Too many requests right now. Nothing was done; wait a moment and try again.",
    "zh-CN": "请求过于频繁，本次未执行；请稍候再试。",
  },
  [ReasonCode.QuotaExhausted]: {
    en: "This operation has no available entitlement or quota. Nothing was executed.",
    "zh-CN": "此操作没有可用授权额度，本次未执行。",
  },
  [ReasonCode.PayloadTooLarge]: {
    en: "The content is larger than the server accepts. Nothing was sent; shorten it and try again.",
    "zh-CN": "内容超过服务器允许的大小，本次未发出；请缩短后再试。",
  },
  [ReasonCode.PublishRejected]: { en: "The message was rejected.", "zh-CN": "消息被拒绝。" },
  [ReasonCode.PublishResultUnknown]: {
    en: "Whether the message was delivered is not known yet.",
    "zh-CN": "消息是否送达尚不明确。",
  },
  [ReasonCode.SurfaceCapabilityUnavailable]: {
    en: "This is not available here. Continue in the web or desktop app.",
    "zh-CN": "此处不提供该功能，请在网页端或桌面端继续。",
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
  [ReasonCode.InvitationNotFound]: {
    en: "This invitation link is not valid. Check that you copied all of it.",
    "zh-CN": "邀请链接无效，请确认复制完整。",
  },
  [ReasonCode.InvitationExpired]: {
    en: "This invitation has expired. Ask for a new one.",
    "zh-CN": "邀请已过期，请向邀请人索取新的邀请。",
  },
  [ReasonCode.InvitationRevoked]: {
    en: "This invitation was withdrawn. Ask for a new one.",
    "zh-CN": "邀请已被撤回，请向邀请人索取新的邀请。",
  },
  [ReasonCode.InvitationAlreadyRedeemed]: {
    en: "This invitation has already been used.",
    "zh-CN": "邀请已被使用。",
  },
  [ReasonCode.InviteeAlreadyMember]: {
    en: "You are already a member of this organization.",
    "zh-CN": "你已经是该组织的成员。",
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
