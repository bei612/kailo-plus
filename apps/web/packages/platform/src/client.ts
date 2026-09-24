// Kailo BFF 管理平面客户端（DD-39、DD-77/79、SS-WEB-01），Web 与 Desktop 共用。
//
// 请求与回应的形状取自 contracts 的生成物（ADR-02/03）：已在 contracts 定义的形状
// 这里不另写一份。身份由网关验证后投影给 BFF，这里没有任何可自报的身份字段。

import type {
  ApprovalControlOutcome,
  ApprovalDecision,
  ApprovalDecisionOutcome,
  ApprovalDecisionRequest,
  ApprovalView,
  ClientKeyStatus,
  ClientKeyView,
  NativeCommunityFacts,
  OwnAuditEntry,
  PlatformSessionView,
  TaskView,
  WorkspaceMemberView,
  WorkspaceView,
} from "@kailo/contracts";
import { type BffRequest, type BffTransport, unwrap } from "./transport";

export type BffClient = ReturnType<typeof createBffClient>;

export function createBffClient(transport: BffTransport) {
  const call = async <T>(request: BffRequest): Promise<T> =>
    unwrap<T>(request, await transport.send(request));
  const get = <T>(path: string) => call<T>({ method: "GET", path });

  return {
    transport,

    /** 当前会话。撤权后下一次调用即 403——会话不由客户端持有，不需要它主动丢弃。 */
    session: () => get<PlatformSessionView>("/api/v1/session"),

    /**
     * 撤销本次 PlatformSession 并关闭它的流。Web 必须在网关 logout 之前调它：网关的
     * logout 是短路的，请求到不了后端（SF-AGW-21）。
     */
    logout: () => call<{ revoked: boolean }>({ method: "POST", path: "/api/v1/logout" }),

    /** 我能进的 Workspace。列表已排除进不去的——列出一个点进去 403 的比不列更糟。 */
    workspaces: () => get<WorkspaceView[]>("/api/v1/workspaces"),

    /** 成员按人聚合：`pubkeys` 是此人全部 ACTIVE 的 Buzz 公钥（DD-77）。 */
    members: (workspaceId: string) =>
      get<WorkspaceMemberView[]>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/members`),

    /** 基础审计页只看自己的动作；聚合视图需要 audit permission，属于后续阶段。 */
    ownAudit: () => get<OwnAuditEntry[]>("/api/v1/audit"),

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

    /** 发起者撤回仍未决的审批请求（REQUESTED/WAITING → CANCELLED）。 */
    withdraw: (workflowId: string) =>
      call<ApprovalControlOutcome>({
        method: "POST",
        path: `/api/v1/approvals/${encodeURIComponent(workflowId)}/withdraw`,
      }),
  };
}
