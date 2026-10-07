// 平台 BFF 管理平面客户端（DD-39、DD-77/79、SS-WEB-01），Web 与 Desktop 共用。
//
// 请求与回应的形状取自 contracts 的生成物（ADR-02/03）：已在 contracts 定义的形状
// 这里不另写一份。身份由网关验证后投影给 BFF，这里没有任何可自报的身份字段。

import type {
  WebMessageQuery,
  WebMessageCursor,
  WebChannelView,
  ActionCommand,
  ActionSubmission,
  ConversationPage,
  ConversationParticipantPage,
  ConversationPreferenceRequest,
  ApplicationBindingPage,
  ApplicationReadResourcePage,
  ApplicationReadResourceDirection,
  ApplicationNativePage,
  AgentDefinitionPage,
  AgentDefinitionView,
  AgentInstallationPage,
  AgentInstallationCandidatePage,
  AgentDelegationPage,
  AgentDelegationTargetPage,
  AgentInstallationView,
  AgentMemoryReadView,
  AgentMemoryEntryPage,
  AgentVersionView,
  AgentVersionPage,
  AgentVersionConfigurationPage,
  AutomationPage,
  AutomationDetailView,
  AutomationRunPage,
  ApprovalControlOutcome,
  ApprovalDecision,
  ApprovalDecisionOutcome,
  ApprovalDecisionRequest,
  ApprovalView,
  AuditEventPage,
  CapabilityContractPage,
  ComponentReleasePage,
  ClientKeyStatus,
  ClientKeyView,
  EvidenceView,
  InvitationRedemptionRequest,
  InvitationRedemptionView,
  LegacySecretRefPage,
  NativeCommunityFacts,
  OwnAuditEntry,
  PlatformInfo,
  PlatformToolPage,
  PlatformSessionView,
  PlatformTenantPage,
  ProtocolSessionView,
  RoleMemberPage,
  RoleWorkspacePage,
  TaskView,
  TenantInvitationView,
  WorkspaceMemberView,
  WorkspaceView,
  DiscoverableWorkspacePage,
  ReadMarkRequest,
  UserStateVersion,
  WebProfileView,
  WebProfileUpdateRequest,
  WebCustomEmojiMutation,
  WebCustomEmojiView,
} from "@client-kit/contracts";
import type { CollaborationUserState } from "./inbox";
import { PlatformSessionAccessMode } from "@client-kit/contracts";
import { type BffRequest, type BffTransport, unwrap } from "./transport";

export type BffClient = ReturnType<typeof createBffClient>;

export function createBffClient(transport: BffTransport) {
  const call = async <T>(request: BffRequest): Promise<T> =>
    unwrap<T>(request, await transport.send(request));
  const get = <T>(path: string) => call<T>({ method: "GET", path });

  return {
    transport,
    profile: () => get<WebProfileView>("/api/v1/profile"),
    customEmoji: () => get<WebCustomEmojiView>("/api/v1/custom-emoji"),
    updateCustomEmoji: (body: WebCustomEmojiMutation) => call<{ eventId: string; operationId: string }>({ method: "PUT", path: "/api/v1/custom-emoji", body }),
    messageAuthorProfile: (workspaceId: string, eventId: string) => get<WebProfileView>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/messages/${encodeURIComponent(eventId)}/author-profile`),
    memberProfile: (workspaceId: string, principalId: string, pubkey: string) => get<WebProfileView>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(principalId)}/profiles/${encodeURIComponent(pubkey)}`),
    conversationMessageAuthorProfile: (conversationId: string, eventId: string) => get<WebProfileView>(`/api/v1/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(eventId)}/author-profile`),
    updateProfile: (body: WebProfileUpdateRequest) => call<{ eventId: string; operationId: string }>({ method: "PUT", path: "/api/v1/profile", body }),

    /** 部署的公开平台信息（DD-111）：界面上的产品名只取自这里，不写在客户端里。 */
    platformInfo: () => get<PlatformInfo>("/api/v1/platform-info"),

    /** 当前会话。撤权后下一次调用即 403——会话不由客户端持有，不需要它主动丢弃。 */
    session: async () => {
      const session = await get<PlatformSessionView>("/api/v1/session");
      // 未知或旧回应缺字段不是任何一种可用会话，不猜默认准入模式（DD-96）。
      if (
        session?.accessMode !== PlatformSessionAccessMode.Full &&
        session?.accessMode !== PlatformSessionAccessMode.LifecycleRestricted
      ) {
        throw new Error("会话响应缺少受支持的 accessMode");
      }
      return session;
    },

    /**
     * 撤销本次 PlatformSession 并关闭它的流。Web 必须在网关 logout 之前调它：网关的
     * logout 是短路的，请求到不了后端（SF-AGW-21）。
     */
    logout: () => call<{ revoked: boolean }>({ method: "POST", path: "/api/v1/logout" }),

    /** 我能进的 Workspace。列表已排除进不去的——列出一个点进去 403 的比不列更糟。 */
    workspaces: () => get<WorkspaceView[]>("/api/v1/workspaces"),
    discoverableWorkspaces: (cursor?: string) => get<DiscoverableWorkspacePage>(`/api/v1/discoverable-workspaces${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
    conversations: (cursor?: string) => get<ConversationPage>(`/api/v1/conversations${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
    conversationParticipants: (cursor?: string) => get<ConversationParticipantPage>(`/api/v1/conversation-participants${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),

    /** Integration metadata only; credentials and native administration stay server-side. */
    applicationNativePage: (bindingId: string) => get<ApplicationNativePage>(`/api/v1/application-bindings/${encodeURIComponent(bindingId)}/native-page`),
    /** Original actor's fresh-authorized metadata; never recovers a launch credential. */
    protocolSession: (sessionId: string) => get<ProtocolSessionView>(`/api/v1/protocol-sessions/${encodeURIComponent(sessionId)}`),
    applicationBindings: (workspaceId?: string, offset = 0) => {
      const query = new URLSearchParams({ offset: String(offset) });
      if (workspaceId !== undefined) query.set("workspaceId", workspaceId);
      return get<ApplicationBindingPage>(`/api/v1/application-bindings?${query}`);
    },
    applicationReadResources: (bindingId: string, direction: ApplicationReadResourceDirection, offset = 0) => {
      const query = new URLSearchParams({ direction, offset: String(offset) });
      return get<ApplicationReadResourcePage>(`/api/v1/application-bindings/${encodeURIComponent(bindingId)}/read-resources?${query}`);
    },

    collaborationUserState: () => get<CollaborationUserState>("/api/v1/user-state"),
    setConversationPreference: (id: string, body: ConversationPreferenceRequest) =>
      call<UserStateVersion>({ method: "PUT", path: `/api/v1/user-state/conversations/${encodeURIComponent(id)}`, body }),
    workspaceChannel: (workspaceId: string) => get<WebChannelView>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/channel`),
    workspaceMessages: (workspaceId: string, options?: WebMessageQuery) => {
      const query = new URLSearchParams();
      for (const [name, value] of Object.entries(options ?? {})) {
        if (value !== undefined) query.set(name, String(value));
      }
      return get<{ events: unknown; nextCursor?: WebMessageCursor }>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/messages${query.size ? `?${query}` : ""}`);
    },
    markRead: (body: ReadMarkRequest) =>
      call<UserStateVersion>({ method: "PUT", path: "/api/v1/user-state/read", body }),

    /** Tenant 稳定定义；列表逐项经 discover 过滤，详情和 Version 由 BFF fresh read。 */
    agentDefinitions: (offset?: number) =>
      get<AgentDefinitionPage>(`/api/v1/agent-definitions${offset ? `?offset=${offset}` : ""}`),
    platformTools: (offset = 0) =>
      get<PlatformToolPage>(`/api/v1/platform-tools?offset=${offset}`),
    agentDefinition: (resourceId: string) =>
      get<AgentDefinitionView>(`/api/v1/agent-definitions/${encodeURIComponent(resourceId)}`),
    agentVersion: (assetId: string) =>
      get<AgentVersionView>(`/api/v1/agent-versions/${encodeURIComponent(assetId)}`),
    agentVersions: (resourceId: string, offset?: number) =>
      get<AgentVersionPage>(`/api/v1/agent-definitions/${encodeURIComponent(resourceId)}/versions${offset !== undefined ? `?offset=${offset}` : ""}`),
    agentVersionConfiguration: (resourceId: string, offset?: number) =>
      get<AgentVersionConfigurationPage>(`/api/v1/agent-definitions/${encodeURIComponent(resourceId)}/version-configuration${offset !== undefined ? `?offset=${offset}` : ""}`),

    /** Installation 是独立 Workspace Resource；读取不创建安装或启动 runtime。 */
    agentInstallations: (workspaceId: string, offset?: number) => {
      const query = new URLSearchParams({ workspaceId });
      if (offset !== undefined) query.set("offset", String(offset));
      return get<AgentInstallationPage>(`/api/v1/agent-installations?${query}`);
    },
    agentInstallation: (resourceId: string) =>
      get<AgentInstallationView>(`/api/v1/agent-installations/${encodeURIComponent(resourceId)}`),

    /** 实际受权的确切 PUBLISHED 安装来源；不从定义的当前指针选默认版本。 */
    agentInstallationCandidates: (workspaceId: string, offset?: number) => {
      const query = new URLSearchParams({ workspaceId });
      if (offset !== undefined) query.set("offset", String(offset));
      return get<AgentInstallationCandidatePage>(`/api/v1/agent-installation-candidates?${query}`);
    },

    /** 原 Grant 与受权 exact scopes；权限和实际调用方均由 Core 重查。 */
    agentDelegations: (resourceId: string, offset?: number) =>
      get<AgentDelegationPage>(`/api/v1/agent-installations/${encodeURIComponent(resourceId)}/delegations${offset !== undefined ? `?offset=${offset}` : ""}`),
    agentDelegationTargets: (resourceId: string, offset?: number) =>
      get<AgentDelegationTargetPage>(`/api/v1/agent-installations/${encodeURIComponent(resourceId)}/delegation-targets${offset !== undefined ? `?offset=${offset}` : ""}`),

    /** DD-66/68: BFF alone owns CONTROL custody and native pair selection. */
    agentMemoryCore: (resourceId: string) =>
      get<AgentMemoryReadView>(`/api/v1/agent-installations/${encodeURIComponent(resourceId)}/memory/core`),
    agentMemoryEntries: (resourceId: string) =>
      get<AgentMemoryEntryPage>(`/api/v1/agent-installations/${encodeURIComponent(resourceId)}/memory/entries`),
    agentMemoryEntry: (resourceId: string, slug: string) => {
      const query = new URLSearchParams({ slug });
      return get<AgentMemoryReadView>(`/api/v1/agent-installations/${encodeURIComponent(resourceId)}/memory/entry?${query}`);
    },

    /** Automation 管理引用；不存在手动运行、轮换或外部触发入口。 */
    automations: (workspaceId: string, offset?: number) => {
      const query = new URLSearchParams({ workspaceId });
      if (offset !== undefined) query.set("offset", String(offset));
      return get<AutomationPage>(`/api/v1/automations?${query}`);
    },
    automation: (resourceId: string, versionOffset?: number, delegationOffset?: number) => {
      const query = new URLSearchParams();
      if (versionOffset !== undefined) query.set("versionOffset", String(versionOffset));
      if (delegationOffset !== undefined) query.set("delegationOffset", String(delegationOffset));
      return get<AutomationDetailView>(`/api/v1/automations/${encodeURIComponent(resourceId)}?${query}`);
    },
    /** Exact Automation + current initiator history; an opaque cursor never grants access. */
    automationRuns: (resourceId: string, cursor?: string) => {
      const query = new URLSearchParams();
      if (cursor !== undefined) query.set("cursor", cursor);
      const suffix = query.size ? `?${query}` : "";
      return get<AutomationRunPage>(`/api/v1/automations/${encodeURIComponent(resourceId)}/runs${suffix}`);
    },

    /** 成员按人聚合：`pubkeys` 是此人全部 ACTIVE 的 Buzz 公钥（DD-77）。 */
    members: (workspaceId: string) =>
      get<WorkspaceMemberView[]>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/members`),

    /** DD-82：管理候选人来自 Tenant 成员事实，角色来自 SpiceDB；游标按 Principal ID。 */
    roleMembers: (workspaceId?: string, cursor?: string) => {
      const query = new URLSearchParams();
      if (workspaceId) query.set("workspaceId", workspaceId);
      if (cursor) query.set("cursor", cursor);
      const suffix = query.size > 0 ? `?${query}` : "";
      return get<RoleMemberPage>(`/api/v1/role-members${suffix}`);
    },

    /** 有界的角色管理 Workspace 选择；它不等于可进入频道的 Workspace 列表。 */
    roleWorkspaces: (offset?: number) =>
      get<RoleWorkspacePage>(`/api/v1/role-workspaces${offset ? `?offset=${offset}` : ""}`),

    /** DD-96：Platform Catalog 会话的业务 Tenant 管理视图；非 Catalog 或无权即 403。 */
    platformTenants: (offset?: number) =>
      get<PlatformTenantPage>(`/api/v1/platform/tenants${offset ? `?offset=${offset}` : ""}`),
    capabilityContracts: (offset = 0) =>
      get<CapabilityContractPage>(`/api/v1/platform/capability-contracts?offset=${offset}`),
    componentReleases: (offset = 0) =>
      get<ComponentReleasePage>(`/api/v1/platform/component-releases?offset=${offset}`),

    /** DD-85：只列当前 Tenant 可归位的旧 SERVER 身份，不返回 SecretRef 或密钥。 */
    legacySecretRefs: (cursor?: string) =>
      get<LegacySecretRefPage>(
        `/api/v1/identity/legacy-secret-refs${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      ),

    /** 基础审计页只看自己的动作；范围视图见 auditEvents。 */
    ownAudit: () => get<OwnAuditEntry[]>("/api/v1/audit"),

    /**
     * 范围审计：当前 Tenant（或其中一个 Workspace）的事件，调用方须对该范围持有 audit
     * permission（无权 403，判定不明 503）。证据只给槽位，稳定 ID 经 auditEvidence 取。
     */
    auditEvents: (workspaceId?: string, cursor?: string) => {
      const query = new URLSearchParams();
      if (workspaceId) query.set("workspaceId", workspaceId);
      if (cursor) query.set("cursor", cursor);
      const suffix = query.size > 0 ? `?${query}` : "";
      return get<AuditEventPage>(`/api/v1/audit/events${suffix}`);
    },

    /** 单条证据解引用：每次 fresh 授权；不可用时只有原因，没有任何 ref 内容。 */
    auditEvidence: (eventId: string, index: number) =>
      get<EvidenceView>(
        `/api/v1/audit/events/${encodeURIComponent(eventId)}/evidence/${encodeURIComponent(String(index))}`,
      ),

    /** 本人的原生设备。登记只能在设备上完成；查看与撤销在任一端都可以。 */
    clientKeys: () => get<ClientKeyView[]>("/api/v1/identity/client-keys"),

    /** 撤销一台设备：只移出这一把公钥，Relay 随即拒绝它；其他设备与 Web 不受影响。 */
    revokeClientKey: (pubkey: string) =>
      call<ClientKeyStatus>({
        method: "DELETE",
        path: `/api/v1/identity/client-keys/${encodeURIComponent(pubkey)}`,
      }),

    /** 原生端直连 Relay 的连接事实；只对原生入口开放（DD-75/78）。 */
    nativeCommunity: () => get<NativeCommunityFacts>("/api/v1/native/community"),

    /** 本人发起的受治理动作，新的在前（.design/06 §9）。 */
    tasks: () => get<TaskView[]>("/api/v1/tasks"),

    /** 一项本人的任务；别人的与不存在的是同一个回答（TARGET_NOT_FOUND）。 */
    task: (actionExecutionId: string) =>
      get<TaskView>(`/api/v1/tasks/${encodeURIComponent(actionExecutionId)}`),

    /** 待我审批：未决、我尚未决定、我此刻能满足某个选择器。 */
    pendingApprovals: () => get<ApprovalView[]>("/api/v1/approvals"),

    /** 一项审批：发起者、已决定者或此刻合格的审批者可见。 */
    approval: (workflowId: string) =>
      get<ApprovalView>(`/api/v1/approvals/${encodeURIComponent(workflowId)}`),

    /**
     * 提交本人的决定（Temporal Update）。approver 由会话决定，不在请求里。同一人
     * 重发同一决定得到原结论，因此结果不明时可以原样重发；不同决定以
     * DUPLICATE_DECISION 拒绝。
     */
    decide: (workflowId: string, decision: ApprovalDecision) =>
      call<ApprovalDecisionOutcome>({
        method: "POST",
        path: `/api/v1/approvals/${encodeURIComponent(workflowId)}/decision`,
        body: { decision } satisfies ApprovalDecisionRequest,
      }),

    /**
     * 语义命令（Governed Action）。准入、审批与派发全在服务端；回应只说本次 operation
     * 的门禁与派发状态，不是业务终态。幂等键由调用方为「一次意图」生成，重发用同一个。
     */
    submitAction: (command: ActionCommand) =>
      call<ActionSubmission>({ method: "POST", path: "/api/v1/actions", body: command }),

    /** 本 Tenant 的邀请；只对持有 Tenant manage 的人开放，其余 403（DD-83）。 */
    invitations: () => get<TenantInvitationView[]>("/api/v1/invitations"),

    /**
     * 兑换邀请：凭据只进请求体，不进 URL。不要求 PlatformSession——兑换者此刻还不是
     * 成员。同一人重复兑换回答原结果，因此结果不明时可以原样重发。
     */
    redeemInvitation: (request: InvitationRedemptionRequest) =>
      call<InvitationRedemptionView>({
        method: "POST",
        path: "/api/v1/invitations/redeem",
        body: request,
      }),

    /** 本人兑换过的邀请与进度。 */
    redemptions: () => get<InvitationRedemptionView[]>("/api/v1/invitations/redemptions"),

    /** 发起者撤回仍未决的审批请求（REQUESTED/WAITING → CANCELLED）。 */
    withdraw: (workflowId: string) =>
      call<ApprovalControlOutcome>({
        method: "POST",
        path: `/api/v1/approvals/${encodeURIComponent(workflowId)}/withdraw`,
      }),
  };
}
