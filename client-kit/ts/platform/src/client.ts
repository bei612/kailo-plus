// 平台 BFF 管理平面客户端（DD-39、DD-77/79、SS-WEB-01），Web 与 Desktop 共用。
//
// 请求与回应的形状取自 contracts 的生成物（ADR-02/03）：已在 contracts 定义的形状
// 这里不另写一份。身份由网关验证后投影给 BFF，这里没有任何可自报的身份字段。

import type {
  FeedbackAttachmentContent,
  TenantProfileView,
  FeedbackSubmissionRequest,
  FeedbackSubmissionReceipt,
  PlatformFeedbackPage,
  PlatformFeedbackTriageRequest,
  WebMessageQuery,
  WebPublishMessageRequest,
  WebInboxQuery,
  WebMessageCursor,
  WebChannelView,
  ActionCommand,
  ActionSubmission,
  ConversationPage,
  ConversationParticipantPage,
  ConversationPreferenceRequest,
  WorkspacePreferenceRequest,
  ProjectPreferenceRequest,
  ApplicationBindingPage,
  ApplicationReadResourcePage,
  ApplicationReadResourceDirection,
  AdminSurfacePage,
  ApplicationNativePage,
  AgentDefinitionPage,
  AgentDefinitionView,
  AgentCatalogOwners,
  AgentTeamPage,
  AgentTeamView,
  AgentInstallationPage,
  AgentInstallationUsePage,
  AgentAuthorDirectory,
  AgentInstallationCandidatePage,
  AgentDelegationPage,
  AgentDelegationTargetPage,
  AgentInstallationView,
  AgentInstallationToolPage,
  AgentSessionPage,
  AgentInvocationPage,
  AgentActiveTurnPage,
  AgentMemoryReadView,
  AgentMemoryEntryPage,
  AgentVersionView,
  AgentVersionPage,
  AgentVersionConfigurationPage,
  AgentImportConfigurationPage,
  AgentSnapshotImportPreview,
  AgentSnapshotUploadRequest,
  AgentTeamSnapshotImportPreview,
  AgentTeamSnapshotUploadRequest,
  ExportPackageView,
  AutomationPage,
  AutomationDetailView,
  AutomationRunPage,
  ApprovalControlOutcome,
  ApprovalDecision,
  ApprovalDecisionOutcome,
  ApprovalDecisionRequest,
  ApprovalView,
  AuditEventPage,
  BusinessOperationPage,
  BusinessOperationSummary,
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
  UsageBillingView,
  TenantQuotaPage,
  ModerationAccessView,
  ModerationReportPage,
  ModerationAuditPage,
  ModerationRestrictionPage,
  PlatformInfo,
  PlatformToolPage,
  PlatformSessionView,
  PlatformTenantPage,
  ProtocolSessionView,
  RoleMemberPage,
  RoleWorkspacePage,
  TenantMemberJoinPage,
  OwnerTransferPage,
  TaskView,
  TenantInvitationView,
  WorkspaceMemberView,
  WorkspaceView,
  DiscoverableWorkspacePage,
  ReadMarkRequest,
  UserStateVersion,
  ThreadPreferenceRequest,
  SidebarSectionRequest,
  SidebarSectionOrderRequest,
  SidebarAssignmentRequest,
  SidebarSortRequest,
  ChannelTemplateRequest,
  FollowedPrincipalRequest,
  WebProfileView,
  WebMessageAuthorQuery,
  WebMessageAuthorView,
  WebProfileUpdateRequest,
  WebCustomEmojiMutation,
  WebCustomEmojiView,
  WebWorkspaceActivityPage,
  WebWorkspaceActivityQuery,
  WebChannelCanvasView,
  WebLinkPreviewRequest,
  WebLinkPreviewSnapshotView,
  WebGifCapabilityView,
  WebGifSearchRequest,
  WebGifSearchView,
  WebGifShareRequest,
  HuddleView,
  HuddlePage,
  HuddleLifecyclePage,
  HuddleVoiceView,
  HuddleAnnouncementView,
  AgentTranscriptPage,
  AgentTranscriptEvent,
  SkillDefinitionPage,
  SkillDefinitionView,
  SkillVersionPage,
  SkillVersionView,
  SkillVersionContentView,
  SkillReferencePage,
  SkillArtifactUploadView,
  AgentInstallationSkillPage,
  GatewayAccess,
  GatewayCallDetail,
  GatewayCallKind,
  GatewayCallOutcome,
  GatewayCallPage,
  GatewayConfigHistory,
  GatewayConfigView,
  GatewayMcpBindingDraft,
  GatewayMcpBindingDraftRequest,
  GatewayMcpPeerPage,
  GatewayMcpProbeRequest,
  GatewayMcpProbeResult,
  GatewayMcpReleasePage,
  GatewayModelRoutePage,
  GatewayModelSourcePage,
  GatewayStats,
  GatewayStatsDimension,
  GatewayToolPage,
  GatewayToolTestCallResult,
  ComponentNotificationPage,
  ComponentNotificationReadRequest,
  ComponentSearchPage,
  ComponentSearchQuery,
  McpConnectionPage,
  McpConnectionProbeRequest,
  McpConnectionProbeResult,
  McpConnectionRefreshResult,
  McpConnectionView,
  McpOauthAttemptView,
  McpOauthStartRequest,
} from "@client-kit/contracts";
import type { CollaborationUserState } from "./inbox";
import { PlatformSessionAccessMode } from "@client-kit/contracts";
import { type BffRequest, type BffTransport, unwrap } from "./transport";

export type BffClient = ReturnType<typeof createBffClient>;

/** DD-134(3)：网关统计与调用列表的查询条件；区间 [from, to) 为 RFC3339。 */
export type GatewayCallQuery = {
  from: string;
  to: string;
  workspaceId?: string;
  kind?: GatewayCallKind;
  outcome?: GatewayCallOutcome;
  dimension?: GatewayStatsDimension;
  key?: string;
  cursor?: string;
  limit?: number;
};

function gatewayQuery(values: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) if (value !== undefined && value !== "") query.set(name, String(value));
  return query.size ? `?${query}` : "";
}

/** DD-125(6): state of the host's live Agent transcript stream. */
export type AgentTranscriptStreamState = "connecting" | "live" | "reconnecting" | "closed";

/**
 * Host seam for GET /api/v1/agent-installations/{id}/transcript/stream (SSE frames
 * retry/live/transcript/closed). Only a host with a live transport implements it
 * (Web: EventSource); without it the transcript is read by pages only. Returns
 * the close function. Installation `audit` is checked by Core at open and on its
 * periodic readmission; a `closed` frame with `scope-revoked` ends the stream.
 */
export type AgentTranscriptStreamOpener = (
  installationId: string,
  onEvent: (event: AgentTranscriptEvent) => void,
  onState: (state: AgentTranscriptStreamState, reason?: string) => void,
) => () => void;

export function createBffClient(transport: BffTransport) {
  // Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/profile/hooks.ts: the
  // self profile answers for 30 s and a user's profile for 60 s per pubkey before a re-read.
  // Kailo keys the same windows by the admitted path (scope, principal, pubkey); a profile
  // write or governed action drops them so a read after a profile, membership or role change
  // is never answered from before it. Read-only POST queries keep the cache.
  const profiles = new Map<string, { at: number; read: Promise<WebProfileView> }>();
  const authors = new Map<string, { at: number; read: Promise<WebMessageAuthorView["profiles"][string] | undefined> }>();
  const call = async <T>(request: BffRequest): Promise<T> => {
    if (request.method !== "GET" && (request.path === "/api/v1/profile" || request.path.startsWith("/api/v1/actions"))) { profiles.clear(); authors.clear(); }
    return unwrap<T>(request, await transport.send(request));
  };
  const get = <T>(path: string, fresh = false) => call<T>({ method: "GET", path, ...(fresh ? { fresh: true } : {}) });
  const profileRead = async (path: string, freshMs: number): Promise<WebProfileView> => {
    const now = Date.now();
    let entry = profiles.get(path);
    if (!entry || now - entry.at >= freshMs) {
      const created = { at: now, read: get<WebProfileView>(path) };
      profiles.set(path, created);
      created.read.catch(() => { if (profiles.get(path) === created) profiles.delete(path); });
      entry = created;
    }
    return structuredClone(await entry.read);
  };
  // The author of an admitted message is the original per-pubkey user profile: same 60 s
  // window, keyed by (scope, event), dropped with the profile cache. Only uncached events
  // are asked for; the answer still carries exactly the requested event IDs.
  const messageAuthors = async (kind:"workspaces"|"conversations", id:string, body:WebMessageAuthorQuery): Promise<WebMessageAuthorView> => {
    const scope = `${kind}/${id}/`, now = Date.now();
    const fresh = (eventId: string) => { const hit = authors.get(scope + eventId); return hit && now - hit.at < 60_000 ? hit : undefined; };
    const missing = body.eventIds.filter((eventId) => !fresh(eventId));
    if (missing.length > 0) {
      const read = call<WebMessageAuthorView>({method:"POST",path:`/api/v1/${kind}/${encodeURIComponent(id)}/messages/author-profiles`,
        body: missing.length === body.eventIds.length ? body : { ...body, eventIds: missing }});
      for (const eventId of missing) {
        const entry = { at: now, read: read.then((view) => view?.profiles?.[eventId]) };
        authors.set(scope + eventId, entry);
        entry.read.then((profile) => { if (profile === undefined && authors.get(scope + eventId) === entry) authors.delete(scope + eventId); },
          () => { if (authors.get(scope + eventId) === entry) authors.delete(scope + eventId); });
      }
    }
    const reads = body.eventIds.map((eventId) => [eventId, authors.get(scope + eventId)?.read] as const);
    const profiles: WebMessageAuthorView["profiles"] = {};
    for (const [eventId, read] of reads) {
      const profile = await read;
      if (profile !== undefined) profiles[eventId] = structuredClone(profile);
    }
    return { profiles };
  };
  const singleMessageAuthor = async (kind:"workspaces"|"conversations",id:string,eventId:string) => {
    const view=await messageAuthors(kind,id,{eventIds:[eventId]});
    const profile=view.profiles[eventId];
    if(!profile || Object.keys(view.profiles).length!==1) throw new Error("Missing admitted message author.");
    return profile;
  };

  return {
    transport,
    tenantProfile: (afterVersion?: number) => get<TenantProfileView>(`/api/v1/tenant/profile${afterVersion === undefined ? "" : `?afterVersion=${afterVersion}`}`, true),
    submitFeedback: (body: FeedbackSubmissionRequest) => call<FeedbackSubmissionReceipt>({ method: "POST", path: "/api/v1/feedback", body }),
    platformFeedback: (offset = 0, state?: "NEW" | "TRIAGED" | "CLOSED") => get<PlatformFeedbackPage>(`/api/v1/platform/feedback?offset=${offset}${state ? `&state=${state}` : ""}`, true),
    feedbackAttachment: (id: string) => get<FeedbackAttachmentContent>(`/api/v1/platform/feedback/${encodeURIComponent(id)}/attachment?encoding=base64`, true),
    triageFeedback: (id: string, body: PlatformFeedbackTriageRequest) => call<{ feedbackId: string; state: string; version: number }>({ method: "PUT", path: `/api/v1/platform/feedback/${encodeURIComponent(id)}`, body }),
    profile: () => profileRead("/api/v1/profile", 30_000),
    customEmoji: () => get<WebCustomEmojiView>("/api/v1/custom-emoji"),
    updateCustomEmoji: (body: WebCustomEmojiMutation) => call<{ eventId: string; operationId: string }>({ method: "PUT", path: "/api/v1/custom-emoji", body }),
    messageAuthorProfiles: (workspaceId: string, body: WebMessageAuthorQuery) => messageAuthors("workspaces",workspaceId,body),
    messageAuthorProfile: (workspaceId:string,eventId:string) => singleMessageAuthor("workspaces",workspaceId,eventId),
    memberProfile: (workspaceId: string, principalId: string, pubkey: string) => profileRead(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(principalId)}/profiles/${encodeURIComponent(pubkey)}`, 60_000),
    conversationParticipantProfile: (conversationId: string, principalId: string, pubkey: string) => profileRead(`/api/v1/conversations/${encodeURIComponent(conversationId)}/participants/${encodeURIComponent(principalId)}/profiles/${encodeURIComponent(pubkey)}`, 60_000),
    conversationMessageAuthorProfiles: (conversationId: string, body: WebMessageAuthorQuery) => messageAuthors("conversations",conversationId,body),
    conversationMessageAuthorProfile: (conversationId:string,eventId:string) => singleMessageAuthor("conversations",conversationId,eventId),
    updateProfile: (body: WebProfileUpdateRequest) => call<{ eventId: string; operationId: string }>({ method: "PUT", path: "/api/v1/profile", body }),

    /** 部署的公开平台信息（DD-111）：界面上的产品名只取自这里，不写在客户端里。 */
    platformInfo: () => get<PlatformInfo>("/api/v1/platform-info"),

    /** 当前会话。撤权后下一次调用即 403——会话不由客户端持有，不需要它主动丢弃。 */
    /** `fresh`: an identity re-check after a read; it always reaches the BFF, never a shared answer. */
    session: async (options?: { fresh?: boolean }) => {
      const session = await get<PlatformSessionView>("/api/v1/session", options?.fresh === true);
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
    discoverableWorkspaces: (cursor?: string, channelId?: string) => {
      const query = new URLSearchParams();
      if (cursor) query.set("cursor", cursor);
      if (channelId) query.set("channelId", channelId);
      return get<DiscoverableWorkspacePage>(`/api/v1/discoverable-workspaces${query.size ? `?${query}` : ""}`);
    },
    conversations: (cursor?: string) => get<ConversationPage>(`/api/v1/conversations${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
    conversationParticipants: (cursor?: string) => get<ConversationParticipantPage>(`/api/v1/conversation-participants${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),

    /** Integration metadata only; credentials and native administration stay server-side. */
    /**
     * DD-138(6): with `adminSurface` the descriptor is issued under fresh `manage` for that
     * declared admin surface and points at its fixed path (07 §4.8.5).
     */
    applicationNativePage: (bindingId: string, adminSurface?: string) =>
      get<ApplicationNativePage>(`/api/v1/application-bindings/${encodeURIComponent(bindingId)}/native-page${adminSurface === undefined ? "" : `?${new URLSearchParams({ adminSurface })}`}`),
    /** DD-138(6): admin surfaces the member freshly manages at Tenant scope and, if given, that Workspace. */
    adminSurfaces: (workspaceId?: string) =>
      get<AdminSurfacePage>(`/api/v1/admin-surfaces${workspaceId === undefined ? "" : `?${new URLSearchParams({ workspaceId })}`}`),
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
    setProjectPreference: (body: ProjectPreferenceRequest) =>
      call<UserStateVersion>({method:"PUT",path:"/api/v1/user-state/projects",body}),
    setConversationPreference: (id: string, body: ConversationPreferenceRequest) =>
      call<UserStateVersion>({ method: "PUT", path: `/api/v1/user-state/conversations/${encodeURIComponent(id)}`, body }),
    /** DD-40/DD-150(3): a Workspace channel's Star and Mute, one CAS write of both values. */
    setWorkspacePreference: (workspaceId: string, body: WorkspacePreferenceRequest) =>
      call<UserStateVersion>({ method: "PUT", path: `/api/v1/user-state/workspaces/${encodeURIComponent(workspaceId)}`, body }),
    /** Original batched channel-list activity: one Core read, one Relay request per NIP-11 filter batch. */
    workspaceActivity: (body: WebWorkspaceActivityQuery) =>
      call<WebWorkspaceActivityPage>({ method: "POST", path: "/api/v1/workspace-activity", body }),
    workspaceChannel: (workspaceId: string) => get<WebChannelView>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/channel`),
    inboxMentions: (body: WebInboxQuery = {}) =>
      call<{ events: unknown }>({method: "POST", path: "/api/v1/inbox/mentions", body}),
    workspaceMessages: (workspaceId: string, options?: WebMessageQuery) => {
      const query = new URLSearchParams();
      for (const [name, value] of Object.entries(options ?? {})) {
        // STREAM is Core's default type: omitting it gives one path per window for shared reads.
        if (value !== undefined && !(name === "messageType" && value === "STREAM")) query.set(name, String(value));
      }
      return get<{ events: unknown; nextCursor?: WebMessageCursor }>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/messages${query.size ? `?${query}` : ""}`);
    },
    conversationMessages: (conversationId: string, options?: WebMessageQuery) => {
      const query = new URLSearchParams();
      for (const [name, value] of Object.entries(options ?? {})) {
        // STREAM is Core's default type: omitting it gives one path per window for shared reads.
        if (value !== undefined && !(name === "messageType" && value === "STREAM")) query.set(name, String(value));
      }
      return get<{ events: unknown; nextCursor?: WebMessageCursor }>(`/api/v1/conversations/${encodeURIComponent(conversationId)}/messages${query.size ? `?${query}` : ""}`);
    },
    /**
     * DD-142 owned-Agent message edit (`editEventId`) through the Workspace publish route. Core
     * re-checks Installation ownership and `manage`, then signs as that Agent; `idempotencyKey`
     * names the DD-81 intent and is reused only while its outcome is unknown.
     */
    publishWorkspaceMessage: (workspaceId: string, body: WebPublishMessageRequest, idempotencyKey: string) =>
      call<{ eventId: string; operationId: string }>({ method: "POST",
        path: `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/messages`, body, idempotencyKey }),
    /** DD-142 owned-Agent message deletion (`deleteEventId`); same admission as the edit above. */
    deleteWorkspaceMessage: (workspaceId: string, body: WebPublishMessageRequest, idempotencyKey: string) =>
      call<{ eventId: string; operationId: string }>({ method: "POST",
        path: `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/messages/delete`, body, idempotencyKey }),
    markRead: (body: ReadMarkRequest) =>
      call<UserStateVersion>({ method: "PUT", path: "/api/v1/user-state/read", body }),

    // DD-125 personal preferences: same CollaborationUserState version CAS as read marks.
    // None is a Governed Action; Core re-checks every key against the caller's admission.
    setThreadPreference: (body: ThreadPreferenceRequest) =>
      call<UserStateVersion>({ method: "PUT", path: "/api/v1/user-state/threads", body }),
    setSidebarSection: (sectionId: string, body: SidebarSectionRequest) =>
      call<UserStateVersion>({ method: "PUT", path: `/api/v1/user-state/sidebar-sections/${encodeURIComponent(sectionId)}`, body }),
    deleteSidebarSection: (sectionId: string, body: UserStateVersion) =>
      call<UserStateVersion>({ method: "DELETE", path: `/api/v1/user-state/sidebar-sections/${encodeURIComponent(sectionId)}`, body }),
    setSidebarSectionOrder: (body: SidebarSectionOrderRequest) =>
      call<UserStateVersion>({ method: "PUT", path: "/api/v1/user-state/sidebar-section-order", body }),
    setSidebarAssignment: (body: SidebarAssignmentRequest) =>
      call<UserStateVersion>({ method: "PUT", path: "/api/v1/user-state/sidebar-assignments", body }),
    setSidebarSort: (body: SidebarSortRequest) =>
      call<UserStateVersion>({ method: "PUT", path: "/api/v1/user-state/sidebar-sort", body }),
    setChannelTemplate: (templateId: string, body: ChannelTemplateRequest) =>
      call<UserStateVersion>({ method: "PUT", path: `/api/v1/user-state/channel-templates/${encodeURIComponent(templateId)}`, body }),
    deleteChannelTemplate: (templateId: string, body: UserStateVersion) =>
      call<UserStateVersion>({ method: "DELETE", path: `/api/v1/user-state/channel-templates/${encodeURIComponent(templateId)}`, body }),
    setFollowedPrincipal: (body: FollowedPrincipalRequest) =>
      call<UserStateVersion>({ method: "PUT", path: "/api/v1/user-state/followed-principals", body }),

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
    /**
     * DD-131(1)(6): same-Tenant, undeleted Agent teams the caller can discover. Members list only
     * the Definitions the caller can discover (original order); the rest are a count.
     */
    agentTeams: (offset?: number) =>
      get<AgentTeamPage>(`/api/v1/agent-teams${offset ? `?offset=${offset}` : ""}`),
    agentTeam: (resourceId: string) =>
      get<AgentTeamView>(`/api/v1/agent-teams/${encodeURIComponent(resourceId)}`),
    /**
     * DD-131(6): owner names for one page of catalog entries (discoverable Definitions and teams);
     * IDs the caller cannot discover are omitted, never resolved.
     */
    agentCatalogOwners: (resourceIds: readonly string[]) =>
      get<AgentCatalogOwners>(`/api/v1/agent-catalog/owners?ids=${resourceIds.map(encodeURIComponent).join(",")}`),

    /** DD-135：Tenant 级 Skill 目录（逐项 discover 过滤）、定义与版本（fresh read；DRAFT 需版本 read）。 */
    skillDefinitions: (offset?: number) =>
      get<SkillDefinitionPage>(`/api/v1/skill-definitions${offset ? `?offset=${offset}` : ""}`),
    skillDefinition: (resourceId: string) =>
      get<SkillDefinitionView>(`/api/v1/skill-definitions/${encodeURIComponent(resourceId)}`),
    skillVersions: (resourceId: string, offset?: number) =>
      get<SkillVersionPage>(`/api/v1/skill-definitions/${encodeURIComponent(resourceId)}/versions${offset !== undefined ? `?offset=${offset}` : ""}`),
    skillVersion: (assetId: string) =>
      get<SkillVersionView>(`/api/v1/skill-versions/${encodeURIComponent(assetId)}`),
    skillVersionContent: (assetId: string) =>
      get<SkillVersionContentView>(`/api/v1/skill-versions/${encodeURIComponent(assetId)}/content`),
    /** AgentVersion 编辑器的 Skill 选择目录：本人可读的 ACTIVE 定义下的 PUBLISHED 版本。 */
    skillReferences: (offset?: number) =>
      get<SkillReferencePage>(`/api/v1/skill-references${offset ? `?offset=${offset}` : ""}`),
    /**
     * DD-135(2)(3)：校验并一次性暂存一次上传；违规以 422 回同一视图（accepted=false），
     * 不暂存字节、不创建版本。版本只经 skill.version.create 产生。
     */
    uploadSkillArtifact: async (resourceId: string, contentBase64: string): Promise<SkillArtifactUploadView> => {
      const request: BffRequest = {
        method: "POST",
        path: `/api/v1/skill-definitions/${encodeURIComponent(resourceId)}/uploads`,
        body: { contentBase64 },
      };
      const reply = await transport.send(request);
      const body = reply.body as Partial<SkillArtifactUploadView> | undefined;
      if ((reply.status === 422 || reply.status === 413) && body?.accepted === false && Array.isArray(body.violations)) {
        return body as SkillArtifactUploadView;
      }
      return unwrap<SkillArtifactUploadView>(request, reply);
    },
    /**
     * DD-131(2)、DD-143：校验一个 Agent 快照包并为本会话一次性暂存，返回导入预览；
     * 不创建对象。新 Definition 与 DRAFT 只经 agent.definition.import 产生。
     */
    uploadAgentSnapshot: (body: AgentSnapshotUploadRequest) =>
      call<AgentSnapshotImportPreview>({ method: "POST", path: "/api/v1/agent-snapshots/uploads", body }),
    /**
     * DD-131(3)：校验一个团队快照包并为本会话一次性暂存，返回导入预览；不创建对象。新 agent_team 与
     * 各成员的 Definition/DRAFT 只经 agent.team.import 产生，任一成员失败整包不提交。
     */
    uploadTeamSnapshot: (body: AgentTeamSnapshotUploadRequest) =>
      call<AgentTeamSnapshotImportPreview>({ method: "POST", path: "/api/v1/agent-team-snapshots/uploads", body }),
    /** DD-26：导入人可重选的 RuntimeProfile 与 Route（与版本配置目录同一来源）。 */
    agentImportConfiguration: (offset?: number) =>
      get<AgentImportConfigurationPage>(`/api/v1/agent-snapshots/configuration${offset !== undefined ? `?offset=${offset}` : ""}`),
    /**
     * DD-42、DD-131(2)：发起人按导出 ActionExecution 读取其 ExportPackage；包尚未预写（等待 owner 批准）时为 404。
     * 字节只在 READY 后经 `downloadPath` 下载，由宿主的受授权传输取得。
     */
    exportPackageByAction: (actionExecutionId: string) =>
      get<ExportPackageView>(`/api/v1/export-packages/by-action/${encodeURIComponent(actionExecutionId)}`, true),
    exportPackage: (assetId: string) =>
      get<ExportPackageView>(`/api/v1/export-packages/${encodeURIComponent(assetId)}`, true),
    /** DD-135(7)：Installation 的 Skill 投影状态；读取不触发投影或重试。 */
    agentInstallationSkills: (resourceId: string) =>
      get<AgentInstallationSkillPage>(`/api/v1/agent-installations/${encodeURIComponent(resourceId)}/skills`),

    /** Installation 是独立 Workspace Resource；读取不创建安装或启动 runtime。 */
    agentInstallations: (workspaceId: string, offset?: number) => {
      const query = new URLSearchParams({ workspaceId });
      if (offset !== undefined) query.set("offset", String(offset));
      return get<AgentInstallationPage>(`/api/v1/agent-installations?${query}`);
    },
    agentInstallation: (resourceId: string) =>
      get<AgentInstallationView>(`/api/v1/agent-installations/${encodeURIComponent(resourceId)}`),
    /**
     * DD-122: the current generation's requested tools and their effective ToolBinding state.
     * Read-only; tools are granted only by agent.installation.create/upgrade.
     */
    agentInstallationTools: (resourceId: string) =>
      get<AgentInstallationToolPage>(`/api/v1/agent-installations/${encodeURIComponent(resourceId)}/tools`),
    /** 05 §2.10：成员使用权目录；读取不改变授权，开关仍走统一 Action。 */
    agentInstallationUsers: (resourceId: string) =>
      get<AgentInstallationUsePage>(`/api/v1/agent-installations/${encodeURIComponent(resourceId)}/users`),

    /** Existing Session / Invocation authority only; never starts or resumes a runtime. */
    agentSessions: (resourceId: string, rootEventId?: string, cursor?: string) => {
      const query = new URLSearchParams();
      if (rootEventId !== undefined) query.set("rootEventId", rootEventId);
      if (cursor !== undefined) query.set("cursor", cursor);
      return get<AgentSessionPage>(`/api/v1/agent-installations/${encodeURIComponent(resourceId)}/sessions${query.size ? `?${query}` : ""}`);
    },
    /**
     * DD-125(6): running Agent turns of one admitted Workspace, only for Installations the reader
     * holds `audit` on (audited read). Members get no row and rely on the Agent's 20002.
     */
    agentActiveTurns: (workspaceId: string) =>
      get<AgentActiveTurnPage>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/agent-turns`, true),
    /**
     * DD-125(6), V-SCN-143: one AgentSession's Codex thread items (ascending pages, scope-bound
     * cursor). Installation `audit` only; every read is an audited sensitive read in Core, so it
     * is never answered from a shared settled read.
     */
    agentTranscript: (installationId: string, rootEventId: string, projectionGeneration: number, cursor?: string) => {
      const query = new URLSearchParams({ rootEventId, projectionGeneration: String(projectionGeneration) });
      if (cursor !== undefined) query.set("cursor", cursor);
      return get<AgentTranscriptPage>(`/api/v1/agent-installations/${encodeURIComponent(installationId)}/transcript?${query}`, true);
    },
    agentInvocations: (resourceId: string, rootEventId: string, projectionGeneration: number, cursor?: string) => {
      const query = new URLSearchParams({ rootEventId, projectionGeneration: String(projectionGeneration) });
      if (cursor !== undefined) query.set("cursor", cursor);
      return get<AgentInvocationPage>(`/api/v1/agent-installations/${encodeURIComponent(resourceId)}/invocations?${query}`);
    },

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

    /** DD-147(1)：成员可读的 Agent 作者目录（owner 行），与成员名单同一准入，不授予任何权限。 */
    agentAuthors: (workspaceId: string) =>
      get<AgentAuthorDirectory>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/agent-authors`),

    /** DD-82：管理候选人来自 Tenant 成员事实，角色来自 SpiceDB；游标按 Principal ID。 */
    roleMembers: (workspaceId?: string, cursor?: string) => {
      const query = new URLSearchParams();
      if (workspaceId) query.set("workspaceId", workspaceId);
      if (cursor) query.set("cursor", cursor);
      const suffix = query.size > 0 ? `?${query}` : "";
      return get<RoleMemberPage>(`/api/v1/role-members${suffix}`);
    },

    /**
     * DD-125(9)：新成员加入提醒。只给 Tenant manage 持有人，失去即 403 PERMISSION_DENIED。
     * 不带 after 只返回当前游标供建账；带 after（不透明游标，空串为起点）返回其后加入的其他成员，
     * hasMore 为 true 时以新 cursor 续读。每次都是 fresh 请求：撤权须在下一次读取生效。
     */
    /**
     * DD-168(2)：成员名下仍有 owner 责任的 Resource（REVOKED 前核对的同一事实）。不带参数列出撤权中
     * 且仍有名下资源的成员，带 principalId 只列该成员；只给 Tenant manage 持有人，每次 fresh。
     */
    ownerTransfers: (principalId?: string) =>
      get<OwnerTransferPage>(`/api/v1/owner-transfers${principalId ? `?principalId=${encodeURIComponent(principalId)}` : ""}`, true),
    tenantMemberJoins: (after?: string) =>
      get<TenantMemberJoinPage>(
        `/api/v1/tenant-member-joins${after === undefined ? "" : `?after=${encodeURIComponent(after)}`}`,
        true,
      ),

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

    /**
     * 业务操作时间线（.design/14 §7）：scope=mine 为本人发起或实际执行；tenant/workspace
     * 须对该范围持有 audit permission（无权 403，判定不明 503）。
     */
    operations: (scope: "mine" | "tenant" | "workspace", workspaceId?: string, cursor?: string) => {
      const query = new URLSearchParams({ scope });
      if (workspaceId) query.set("workspaceId", workspaceId);
      if (cursor) query.set("cursor", cursor);
      return get<BusinessOperationPage>(`/api/v1/operations?${query}`);
    },

    /** Tenant/Workspace 业务聚合；区间 [from, to) 为 RFC3339，需该范围 audit。 */
    operationSummary: (from: string, to: string, workspaceId?: string) => {
      const query = new URLSearchParams({ from, to });
      if (workspaceId) query.set("workspaceId", workspaceId);
      return get<BusinessOperationSummary>(`/api/v1/operations/summary?${query}`);
    },

    /** 用量与账单（.design/11 §7）：OpenMeter 事实与 Core 投递事实，需该范围 audit。 */
    usageBilling: (from: string, to: string, workspaceId?: string) => {
      const query = new URLSearchParams({ from, to });
      if (workspaceId) query.set("workspaceId", workspaceId);
      return get<UsageBillingView>(`/api/v1/usage-billing?${query}`);
    },

    // DD-134 网关管理区：全部是 BFF 只读查询（Core 以 service 凭据读 Gateway 并打码）；
    // 修改只经 submitAction 的既有动作。范围取会话 Tenant，每次服务端 fresh 授权。
    gatewayAccess: () => get<GatewayAccess>("/api/v1/gateway/access", true),
    gatewayStats: (from: string, to: string, dimension: GatewayStatsDimension, workspaceId?: string) =>
      get<GatewayStats>(`/api/v1/gateway/stats${gatewayQuery({ from, to, dimension, workspaceId })}`, true),
    gatewayCalls: (query: GatewayCallQuery) =>
      get<GatewayCallPage>(`/api/v1/gateway/calls${gatewayQuery(query)}`, true),
    gatewayCall: (callId: string) =>
      get<GatewayCallDetail>(`/api/v1/gateway/calls/${encodeURIComponent(callId)}`, true),
    gatewayTools: (from: string, to: string, offset = 0) =>
      get<GatewayToolPage>(`/api/v1/gateway/tools${gatewayQuery({ from, to, offset })}`, true),
    gatewayModelRoutes: (from: string, to: string, offset = 0) =>
      get<GatewayModelRoutePage>(`/api/v1/gateway/model-routes${gatewayQuery({ from, to, offset })}`, true),
    gatewayModelSources: () => get<GatewayModelSourcePage>("/api/v1/gateway/model-sources", true),
    gatewayMcpReleases: () => get<GatewayMcpReleasePage>("/api/v1/gateway/mcp/releases", true),
    /** 纯计算：生成需由运维加入交付目录的 binding 条目，不写任何状态。 */
    gatewayMcpBindingDraft: (body: GatewayMcpBindingDraftRequest) =>
      call<GatewayMcpBindingDraft>({ method: "POST", path: "/api/v1/gateway/mcp/binding-drafts", body }),
    /**
     * DD-134(6) 测试调用：以本人提交该工具登记的 ActionDefinition（componentAction 语义命令），
     * 准入、审批、额度与审计在服务端；结果只在本次回应按冻结的暴露策略返回，Core 不保存。
     * 结果不明时以同一幂等键原样重发只重查原执行，不重放调用。
     */
    gatewayToolTestCall: (command: ActionCommand) =>
      call<GatewayToolTestCallResult>({ method: "POST", path: "/api/v1/gateway/tool-test-calls", body: command }),
    gatewayConfig: () => get<GatewayConfigView>("/api/v1/platform/gateway/config", true),
    gatewayConfigHistory: (kind: string, id: string) =>
      get<GatewayConfigHistory>(`/api/v1/platform/gateway/config/history${gatewayQuery({ kind, id })}`, true),
    gatewayMcpPeers: () => get<GatewayMcpPeerPage>("/api/v1/platform/gateway/mcp/peers", true),
    /** 受控探测：只接受交付目录条目引用；Core 经 Gateway 临时验证 route 读 initialize 与 tools/list。 */
    gatewayMcpProbe: (body: GatewayMcpProbeRequest) =>
      call<GatewayMcpProbeResult>({ method: "POST", path: "/api/v1/platform/gateway/mcp/probes", body }),

    // DD-149 连接器：列表、详情与 OAuth 状态是 fresh 只读查询；探测与刷新是只读 POST（凭据只作
    // 一次性输入，不回显）。登记、更新、轮换、停用、恢复、删除与策略只经 submitAction（mcp_connection.*）。
    mcpConnections: () => get<McpConnectionPage>("/api/v1/mcp-connections", true),
    mcpConnection: (connectionId: string) =>
      get<McpConnectionView>(`/api/v1/mcp-connections/${encodeURIComponent(connectionId)}`, true),
    mcpConnectionProbe: (body: McpConnectionProbeRequest) =>
      call<McpConnectionProbeResult>({ method: "POST", path: "/api/v1/mcp-connections/probes", body }),
    mcpConnectionRefresh: (connectionId: string) =>
      call<McpConnectionRefreshResult>({ method: "POST", path: `/api/v1/mcp-connections/${encodeURIComponent(connectionId)}/refresh`, body: {} }),
    mcpOauthStart: (body: McpOauthStartRequest) =>
      call<McpOauthAttemptView>({ method: "POST", path: "/api/v1/mcp-connections/oauth/attempts", body }),
    mcpOauthAttempt: (attemptId: string) =>
      get<McpOauthAttemptView>(`/api/v1/mcp-connections/oauth/attempts/${encodeURIComponent(attemptId)}`, true),

    /** DD-123：本 Tenant 的平台额度（OpenMeter 唯一权威）；只对 Tenant admin 与 auditor 开放，其余 403。 */
    tenantQuotas: () => get<TenantQuotaPage>("/api/v1/tenant/quotas"),

    /** DD-125(2)：审核入口提示（fresh Tenant manage）；不读取任何审核事实。 */
    moderationAccess: () => get<ModerationAccessView>("/api/v1/moderation/access"),
    /**
     * DD-125(2)：审核队列、审核日志与限制状态是 Tenant manage 的受审计敏感读取（Core 以
     * CONTROL 经 NIP-98 读取 Relay，不复制）；其余 403。动作经 submitAction（moderation.*）。
     */
    moderationReports: (status?: "open") =>
      get<ModerationReportPage>(`/api/v1/moderation/reports${status ? `?status=${status}` : ""}`),
    moderationAudit: () => get<ModerationAuditPage>("/api/v1/moderation/audit"),
    moderationRestrictions: () => get<ModerationRestrictionPage>("/api/v1/moderation/restricted"),

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
    /** DD-125(5): approvals I initiated that reached a result (Inbox Needs action). */
    initiatedApprovals: () => get<ApprovalView[]>("/api/v1/approvals/initiated"),

    // DD-138(4), 07 §4.8.3: component notifications in the Kailo Inbox. Personal read state
    // only (no ActionExecution); Core lists items of ACTIVE bindings the caller may discover.
    /** One page, newest received first; `nextCursor` absent means no more. */
    componentNotifications: (options: { limit?: number; cursor?: string } = {}) => {
      const query = new URLSearchParams({ limit: String(options.limit ?? 50) });
      if (options.cursor !== undefined) query.set("cursor", options.cursor);
      return get<ComponentNotificationPage>(`/api/v1/inbox/component-notifications?${query}`, true);
    },
    /** Marks 1–100 of my own items read (204); foreign or invisible IDs are ignored by Core. */
    markComponentNotificationsRead: (notificationIds: readonly string[]) =>
      call<unknown>({ method: "POST", path: "/api/v1/inbox/component-notifications/read",
        body: { notificationIds: [...notificationIds] } satisfies ComponentNotificationReadRequest }),
    // DD-138(5), 07 §4.8.4: component content as a 「搜索全部」 source. Read-only query, no
    // ActionExecution and no Quota; each result is already resolved to an openable native page.
    searchComponents: (body: ComponentSearchQuery) =>
      call<ComponentSearchPage>({ method: "POST", path: "/api/v1/search/components", body }),

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

    // DD-125(4)(5) batch C3. The Canvas is read as the member and only the Tenant CONTROL
    // author is adopted; it is written by the workspace.canvas.set action above.
    channelCanvas: (workspaceId: string) =>
      get<WebChannelCanvasView>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/canvas`, true),
    /** The BFF fetches one link preview for the caller and answers its short-term snapshot. */
    linkPreview: (target: { workspaceId: string } | { conversationId: string }, request: WebLinkPreviewRequest) =>
      call<WebLinkPreviewSnapshotView>({
        method: "POST",
        path: "workspaceId" in target
          ? `/api/v1/workspaces/${encodeURIComponent(target.workspaceId)}/link-previews`
          : `/api/v1/conversations/${encodeURIComponent(target.conversationId)}/link-previews`,
        body: request,
      }),
    /** Whether the original GIF picker appears, and the registered GIF image origins. */
    gifCapability: () => get<WebGifCapabilityView>("/api/v1/gifs"),
    gifSearch: (request: WebGifSearchRequest) =>
      call<WebGifSearchView>({ method: "POST", path: "/api/v1/gifs/search", body: request }),
    /** Original best-effort share report at selection time (204). */
    gifShare: (request: WebGifShareRequest) =>
      call<unknown>({ method: "POST", path: "/api/v1/gifs/share", body: request }),

    // DD-125(3) batch C5. Huddles are written by the governed huddle.* actions above; these
    // are the caller's reads, the Web creator's 48106/48100 and the caller's own 9022 leave.
    /** In-progress Huddles (PROVISIONING or ACTIVE) of one parent Workspace or conversation. */
    huddles: (parent: { workspaceId: string } | { conversationId: string }) =>
      get<HuddlePage>("workspaceId" in parent
        ? `/api/v1/huddles?parentWorkspaceId=${encodeURIComponent(parent.workspaceId)}`
        : `/api/v1/huddles?parentConversationId=${encodeURIComponent(parent.conversationId)}`, true),
    huddle: (huddleId: string) => get<HuddleView>(`/api/v1/huddles/${encodeURIComponent(huddleId)}`, true),
    /** Verified 48100-48103 of the parent channel plus the Relay's 48104 liveness bit. */
    huddleLifecycle: (huddleId: string) =>
      get<HuddleLifecyclePage>(`/api/v1/huddles/${encodeURIComponent(huddleId)}/lifecycle`, true),
    /** Whether Web transcription and agent speech are available (original voice-only mode). */
    huddleVoice: () => get<HuddleVoiceView>("/api/v1/huddles/voice", true),
    /** The Web creator's guidelines and discovery link, signed once by the BFF and re-sent on retry. */
    huddleAnnounce: (huddleId: string) =>
      call<HuddleAnnouncementView>({ method: "POST", path: `/api/v1/huddles/${encodeURIComponent(huddleId)}/announcement` }),
    /** Original leave while other humans remain: the caller's own 9022 for the temp channel. */
    huddleLeave: (huddleId: string) =>
      call<unknown>({ method: "POST", path: `/api/v1/huddles/${encodeURIComponent(huddleId)}/leave` }),

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
