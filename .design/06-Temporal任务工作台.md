# Temporal 任务工作台

Temporal 是 Approval 与用户可见持久 Workflow 的唯一生命周期权威。任务工作台是 Buzz Client Surface 对 Temporal 和 ExternalExecution 的受权投影，三端共用同一份 BFF 投影，不是第二套 Workflow 引擎。

## 1. 使用边界

| 动作 | 处理 |
|---|---|
| 无副作用读取、普通 Buzz event、同请求简单 CRUD | 不创建 Workflow |
| `SOURCE_BOUND_PROTOCOL` surface 的正常协议会话（打开、读取、保存） | `PROTOCOL` Action + ProtocolSession；不为 surface loading/dirty/close 创建 Workflow |
| Approval | `ApprovalWorkflow` |
| Agent turn/invocation | `AgentTaskWorkflow`，input 固定 Installation、AgentVersion 与 projection generation |
| 自动化运行（REQ-23） | Governed Action `automation.run` + `AgentTaskWorkflow`，input 另固定 AutomationVersion 与触发源；审批关卡是其 child `ApprovalWorkflow`，`SCHEDULE` 触发由 Temporal Schedule 启动该 Workflow；不新增 kind（§9、DD-107） |
| Buzz Relay 自带 workflow | 在 Kailo 部署中关闭（DD-106），不作为 Workflow、Approval 或定时权威 |
| native async task、长时/多步/跨服务、timer/signal/cancel、UNKNOWN 对账 | `ComponentTaskWorkflow` |
| 跨服务数据获取 | 不建平台 Workflow 或 Schedule；接收方按 DD-89 经授权自行拉取，平台只治理授权 Governed Action 与显式 Tool 读写 |
| Resource 导出/导入 | 源、目标 Tenant 分别建立 `ComponentTaskWorkflow(kind=RESOURCE_EXPORT\|RESOURCE_IMPORT)`；不存在跨 Tenant Workflow input |
| Tenant 建立/暂停/恢复/销毁 | `ComponentTaskWorkflow(kind=TENANT_LIFECYCLE)`；销毁 input 固定 TenantLifecycleSnapshot 与各组件 ExternalExecution |
| Workspace 建立/暂停/恢复 | `ComponentTaskWorkflow(kind=WORKSPACE_LIFECYCLE)`，input 固定 Workspace ID/version 和 Buzz/SpiceDB projection refs；暂停/恢复固定映射 Channel archive/unarchive，不注册 delete |
| Tenant/Workspace 成员建立/撤权 | `ComponentTaskWorkflow(kind=MEMBERSHIP_PROJECTION\|MEMBERSHIP_REVOCATION)`，input 固定 `TENANT\|WORKSPACE` target type、membership ID/version 和 SpiceDB/Buzz projection refs |
| 原生设备公钥登记/撤销；Web 托管 HUMAN 身份的 key revoke 与重建 | `ComponentTaskWorkflow(kind=BUZZ_IDENTITY_PROJECTION)`，input 固定 pubkey 与 binding version；方向由 binding 状态决定（`RECONCILING` 投入、`REVOKING` 移出），覆盖 relay roster 与该 Principal 全部 ACTIVE Workspace 的 Channel roster（DD-79）；只接受 `kind=HUMAN` 的 binding，CONTROL 轮换受 GAP-BUZ-01 阻断（`09` 的 key revoke/rotate 行） |
| 遗留业务 Tenant 私钥的 SecretRef 归位 | `ComponentTaskWorkflow(kind=SECRET_REF_REHOME)`，input 固定 ActionExecution ID、SecretRefRehome ID、Tenant、pubkey 与原 binding version；Activity 仅从已冻结旧版本读取、向该 Tenant 独立目标 locator 写入一次并回读，随后以 CAS 切 binding generation、按旧 generation 终态证据退役原版本。写入结果不明只查证目标 locator，不自动重写；复制后切换被确定拒绝则销毁目标版本 1 并查证后失败，不留未引用副本；不改变公钥或 Relay roster（DD-85） |
| ComponentRelease 登记/批准/撤销 | `ComponentTaskWorkflow(kind=COMPONENT_RELEASE)`，input 固定按 `admission_path` 取证的来源标识（`BUILTIN_REFERENCE` 为 source commit，`EXTERNAL` 为 vendor、artifact version 与 artifact digest，DD-94(1)）、manifest/API range、全部合同与 artifact digest；审批决定仍由 ApprovalWorkflow 承接 |
| PlatformProviderBinding 建立/升级/回滚 | `ComponentTaskWorkflow(kind=COMPONENT_BINDING)`，input 固定 `binding_kind=PLATFORM_PROVIDER`、port、binding、old/new release、old/new generation 与 provider projection refs |
| ApplicationBinding 建立/升级/回滚 | `ComponentTaskWorkflow(kind=COMPONENT_BINDING)`，input 固定 `binding_kind=APPLICATION`、binding、old/new release、old/new generation、native scope 与全部投影 refs；类别内换成另一实现是新 binding 的建立加旧 binding 的 `COMPONENT_DISABLE`，不是同一 binding 的 generation 切换（DD-88） |
| Core 授权引用首次登记（`resource.create`） | 复用 `ComponentTaskWorkflow(kind=RESOURCE_PROVISION)`；input 固定 Resource ID/version、type_key、ApplicationBinding ID/version、release/generation、引用来源及证据。写 SpiceDB relationship 并复检后，已有对象只核同一冻结引用与 binding/native scope 的可复核证据，不发 CREATE；证据不明保持 `UNKNOWN`，只查原引用。明确 `REMOTE_ADAPTER` 原生创建才沿原 Resource ID 幂等 `CREATE`、未知只 `LOOKUP/ABSENT_FENCED` 流程；不重放 CREATE、不换幂等键（DD-98） |
| 两类 Binding 停用 | `ComponentTaskWorkflow(kind=COMPONENT_DISABLE)`，input 固定 binding kind/ID/version 和受影响 refs |
| 协议会话结果不明的对账 | `ComponentTaskWorkflow(kind=PROTOCOL_SESSION_RECONCILE)`，input 固定 ProtocolSession ref（ID/version）、实现 binding refs、base revision 与 native correlation；查证手段为该 binding 经 Adapter Protocol `query_revision` 提供的 revision 查询（DD-90） |
| AgentInstallation 建立/升级/停用的多投影收敛 | `ComponentTaskWorkflow(kind=AGENT_INSTALLATION)`，input 固定 Installation ID/version、exact AgentVersion、projection generation、AgentPrincipal/BuzzIdentity、SpiceDB 与 Channel roster refs |
| 业务能力实现登记的 Resource 版本发布/下线的运行时收敛 | `ComponentTaskWorkflow(kind=CAPABILITY_VERSION_PUBLISH)`，只适用于在 release 中声明 `versioned_model=SUPPORTED` 的实现（DD-90）；input 固定 Resource 版本、artifact digest、实现 binding refs、SecretRef 与该版本的运行时与工具端点 refs |

“贯穿全局”指需要等待、恢复、控制和审批的生命周期统一由 Temporal 承接，不把每次 API/Check/聊天机械包装成 Workflow（DD-09）。

## 2. 源码确定的运行约束

- Server 提供 Start/Signal/Update/Cancel/Poll/Respond 和 Activity heartbeat/completion（SF-TMP-01）。
- Server 不执行应用 Workflow 逻辑；Application Worker 必须 Poll Workflow Task 并 Respond（SF-TMP-02）。
- Activity 可调用 Codex 与业务能力实现的 remote adapter 等外部 service，但“外部 service”不能取代 Worker。`SOURCE_BOUND_PROTOCOL` 正常协议会话不经 Worker；只有已登记的持久转换、审批或 UNKNOWN reconcile 进入 Workflow。
- 当前 Nexus dispatcher 拒绝 External target，一期不使用 Nexus 规避 Worker（SF-TMP-03，DD-10）。
- 周期任务使用 Temporal Schedule 的 Create/Update/Patch/Delete/List 与暂停/恢复，不在 Core 另建 cron 状态机（SF-TMP-05）。
- Application Worker 使用 `.references` 中的 `temporal-sdk-go v1.48.0`（Kailo 独立选定；Server `go.mod` 依赖 `v1.44.0`，SF-TMP-04），不指定其他 SDK，不手写 Poll/Respond 协议。两者经 gRPC 互通，以真实连通性及录制 history 重放验证兼容，不从版本号推断。确定性契约固定：时间与并发只用 `workflow.Now/Sleep/NewTimer/NewSelector/Go`，派生值经 `MutableSideEffect` 固化，行为变更以 `GetVersion` changeID 门控，发布前对录制 history 用 `WorkflowReplayer` 回归，重放失败即阻断发布；`WorkflowPanicPolicy` 固定 `BlockWorkflow`（SF-TSDK-02/08、SF-TMP-08、DD-69）。本文全部 Workflow 类型为 `DESIGN_DEFINED`；Worker 实现并通过回归前不得 active。
- Approval 决定与参数确认经 Update 进入 Workflow；`UpdateHandlerOptions.Validator` 只能做确定性状态判断（已终结、重复/冲突决定、过期、approver 在冻结名单内），权限类检查必须在 handler 体内经 Activity 完成——validator 运行在只读 dispatcher 且重放时跳过（SF-TSDK-09）。取消固定使用 `RequestCancelWorkflowExecution`，Workflow 以 `workflow.NewSelector` 监听 `ctx.Done()` 后在 `workflow.NewDisconnectedContext` 上完成 native cancel、observe-to-terminal、CapacityLease 释放与最终投影，再以 `temporal.NewCanceledError` 终结；Signal 只用于无需同步拒绝语义的通知。

## 3. Namespace、身份与 history

- 一个 application namespace 承载所有 Tenant 的业务/Approval Workflow；不用 per-Tenant namespace 制造额外管理面。自定义 Search Attribute 固定只登记三个 Keyword：`PlatformTenantId`、`PlatformWorkspaceId`、`PlatformWorkflowKind`，经 `AddSearchAttributes` 在 namespace 上一次性注册；名称前缀 `Platform` 是协议常量，不随部署显示名变化（DD-111）。此前以旧名 `KailoTenantId`、`KailoWorkspaceId`、`KailoWorkflowKind` 注册的三个 SA 在一次性迁移窗口内只读不写：按 SA 列举时新旧两组都查，窗口关闭后不再查询，注册保留在 namespace 中（apps ADR-17）。SQL 标准可见性下全部自定义 Keyword 共用固定数量的预分配列，超出即 `InvalidArgument`；单值与整表另有大小上限。其余投影字段只存在 Core TaskProjection，不做 Search Attribute。
- Search Attribute 不是 Tenant 隔离边界：同 namespace 内任何持 Temporal 凭据者都能跨 Tenant 查询。隔离仍由 Core/BFF 的 scope guard 承担，Temporal 凭据只发给 Core/Worker。
- Browser、AgentGateway 和应用组件没有 Temporal 凭据。Core/Worker 在 Start/Signal/Update/Cancel 前用当前 ExecutionContext 做 Action Admission。
- history 只保存 ID、version、parameter hash、状态与受限 reference；正文、Secret、完整 prompt/response、SQL 和敏感结果不进 history。
- history 是**运行期**生命周期权威，不是永久档案：namespace retention 到期后整个 execution 被删除。因此 Approval/Task 的终态、决定人、决定时间与 evidence refs 必须在 Workflow 终结前由 Activity 幂等写入 Core（键 `workflow_id + decision event id`）；retention 值在部署时固定并作为运行前提登记。retention 之后 Core 投影是唯一可查事实，且仍不接受直接改状态。
- 单个 workflow 的 history 事件数、总字节与 pending Activity 数都有 Server 上限。按清单 fan-out 的 kind（`TENANT_LIFECYCLE`、`COMPONENT_DISABLE`、`AgentTaskWorkflow` 等）必须分批：每批 pending Activity 有固定上界，批次结束检查 `GetContinueAsNewSuggested()`/`GetCurrentHistoryLength()`，为真则用 `workflow.NewContinueAsNewError` 携带（snapshot ID、已完成游标、冻结 input）继续。continue-as-new 保留同一 workflow ID，WorkflowRef 与 TaskProjection 按 workflow ID 而非 run ID 聚合。

```text
workflow_type/version, workflow_id/run_id
action_execution_id, operation_id
tenant_id, workspace_id | NONE
initiator/actor/agent/delegation IDs
resource/component_binding kind+ID
action_version, parameter_hash
content_ref | NONE, correlation_id
```

Workflow 运行中不得换 Tenant、Workspace、Resource、binding kind/ID/generation 或 parameter hash。意图改变时建立新 ActionExecution/Workflow。

### 3.1 Core 如何得知 Workflow 状态

Temporal 不向 Core 推送状态，Nexus 又按 DD-10 排除，因此投影必须由 Workflow 自己写回：每个 Workflow 在每次对外可见的状态跃迁与终结前调用 `ProjectTaskState` Activity，把 `(workflow_id, run_id, event_id, status, waiting_reason, progress, refs…)` 幂等 upsert 进 Core，按 `event_id` 单调去重；该 Activity 的重试策略把 4xx 类错误列入 `NonRetryableErrorTypes`。Workflow 未完成最后一次投影即不视为 terminal。

Core 以已预写的 WorkflowRef 为有界轮转清单，按每条引用的固定 workflow ID 调 Describe/History 修补漏写的 TaskProjection；这是兜底而非主路径（SF-TMP-07、DD-48）。普通任务不得以 `ListWorkflowExecutions` 的空结果证明 Workflow 未启动：该 API 读取 Visibility，而 Describe 读取 History（SF-TMP-12）。工作台以最近一次权威观测判断投影是否落后；观测超时或缺失时显示 `PROJECTION_DELAYED`，不得伪造完成。未预写 WorkflowRef 的 Schedule run 按下文的单独合同回填。

Core 在 Temporal Start 前持久化唯一 WorkflowRef 与固定 workflow ID。workflow ID 一律取 `platform:<kind>:<tenant_id>:<primary_entity_id>:<entity_version>`，使"不分配第二个业务 workflow ID"可被机械校验；前缀 `platform` 是协议常量，不随部署显示名变化（DD-111）。此前以旧前缀 `kailo:` 预写的 WorkflowRef 不改写主键，在一次性迁移窗口内按原 ID 继续对账到终态；窗口在旧前缀 WorkflowRef 全部终态且超过 namespace retention、按旧名 SA 查询无结果时关闭，此后只接受 `platform:` 前缀（apps ADR-17）。

至多一次启动不能依赖 Server 的 request-ID 去重：SDK 每次 Start 都填新的 `RequestId`，而 `SignalWithStart` 一类 API 默认 `AllowDuplicate`（SF-TSDK-10）。因此 Start 固定携带 `WorkflowIDReusePolicy=REJECT_DUPLICATE`、`WorkflowIDConflictPolicy=FAIL`、`WorkflowExecutionErrorWhenAlreadyStarted=true`，收到 `WorkflowExecutionAlreadyStarted` 即视为已启动成功并回填 run ID，不再 Describe。

Start 返回不明时只用该 ID 调 Describe/History。Describe 返回 NotFound 只有在 WorkflowRef 的创建时间仍处于 namespace retention 窗口内时才可解释为"未启动"；超出窗口按 `UNKNOWN` 处理，不重试 Start——已完成并过保留期的执行同样返回 NotFound（SF-TMP-07、SF-TSDK-10、DD-48）。

Schedule 触发的 run 是唯一例外：workflow ID 由 Server scheduler 组成为 `<action workflow id>-<RFC3339 nominal time>`，Core 不预写 WorkflowRef，而在 run 出现后经 `ScheduleHandle.Describe` 或按预定义 Search Attribute 的 `ListWorkflowExecutions` 回填。

## 4. ApprovalWorkflow

```text
REQUESTED → WAITING → APPROVED | DENIED | EXPIRED | CANCELLED
APPROVED → CONSUMED | INVALIDATED
```

Workflow input 冻结 ActionExecution、ActionDefinition version、target、parameter hash、ApprovalPolicy version、affected owner ID/version 与各角色最少人数。决定经 Update 进入，并严格分两层（SF-TSDK-09）：`UpdateHandlerOptions.Validator` 在只读 dispatcher 下运行且**重放时整段跳过**，因此只做确定性的 workflow 状态判断——Approval 是否已终结、该 approver 是否已有不可变决定（同值幂等、冲突值拒绝）、`workflow.Now()` 是否已过冻结的 `expires_at`、approver 是否在 input 冻结的 `affected_owner_refs`/`role_requirements` 内；它不得调度 Activity、不得做 side effect，因此**不能**在其中做 SpiceDB Check。active HUMAN、fresh `approve` permission、selector/owner 对账与职责分离由 update handler 体内调用的 `FreshApprovalAdmission` Activity 完成，检查不通过时作为一条"决定被拒绝"的 history 事件记录，而不是 pre-history 拒绝。Update ID 固定为 `<approval_workflow_id>:<approver_principal_id>`，由 Server 侧去重。每人一个不可变决定，任一有效 DENY 终结为 `DENIED`。全部 owner/角色要求满足后才 `APPROVED`；主动作执行前再做完整准入，成功 dispatch 后一次性 `CONSUMED`，事实或权限变化则 `INVALIDATED`。`APPROVED` 之后 Workflow 继续运行等待 Core 的两个 Update：`consume`（Update ID = `<action_execution_id>:consume`，幂等，Validator 只校验当前处于 `APPROVED` 且该 Update ID 未被消费，Core 在 dispatch 成功后才发）与 `invalidate`（携带失效原因 code）。同时启动 `consume_deadline` timer，超时自动 `INVALIDATED`。没有这条输入通道时 `CONSUMED`/`INVALIDATED` 永远不会出现在 history，投影也就无从产生。ApprovalProjection 只由 Temporal history 投影，不接受直接改状态（DD-47）。

Codex MCP approval seam 在工具调用前暂停：`SERVER_CODEX` 固定启用 `ToolCallMcpElicitation`，approval policy 不能是 `Never`，由 `mcpServer/elicitation/request` 映射到 ApprovalWorkflow（SF-COD-01、SS-COD-APP）。Temporal 决定后 Runtime 回应 Codex，真正 MCP 调用仍经 AgentGateway fresh PEP；feature 关闭时的 `requestUserInput` fallback 不作为一期统一审批协议。

## 5. 三种顶层 Workflow

| 类型 | 责任 |
|---|---|
| `ApprovalWorkflow` | admission/step approval |
| `AgentTaskWorkflow` | Codex turn、tool child action、usage、cancel、Buzz reply；自动化运行的 Agent 回合或模板消息（§9） |
| `ComponentTaskWorkflow` | 组件异步/多步动作与 ExternalExecution |

业务差异由 ActionDefinition、Workflow input 和 Adapter 表达，不为某个能力类别或产品建只转发一次 API 的浅 Workflow。AgentTaskWorkflow 始终固定触发时的 AgentVersion 与 projection generation；Installation 升级不修改运行中 history。Child Agent 只在有独立生命周期、独立频道回复或脱离 parent turn 继续时建立新 AgentTaskWorkflow。

`ComponentTaskWorkflow` kind 只允许两类（DD-90）：平台生命周期类 `RESOURCE_EXPORT`、`RESOURCE_IMPORT`、`TENANT_LIFECYCLE`、`WORKSPACE_LIFECYCLE`、`MEMBERSHIP_PROJECTION`、`MEMBERSHIP_REVOCATION`、`BUZZ_IDENTITY_PROJECTION`、`SECRET_REF_REHOME`、`AGENT_INSTALLATION`；通用组件类 `COMPONENT_RELEASE`、`COMPONENT_BINDING`、`COMPONENT_DISABLE`、`COMPONENT_ACTION`、`RESOURCE_PROVISION`（Core 引用登记与明确的原生创建共用，DD-98）、`PROTOCOL_SESSION_RECONCILE`、`CAPABILITY_VERSION_PUBLISH`。它们都不增加顶层 Workflow 引擎或新工作台；任何 kind 都不以某个业务能力服务的存在为前提，也不以产品命名。`DOCUMENT_RECONCILE`、`MODEL_PUBLISH`、`MATERIALIZATION` 已撤销。

`COMPONENT_ACTION` 承接 Kailo HUMAN 从平台发起、需 native task 或 ExternalExecution 对账的 APPLICATION 能力契约动作。原 ActionExecution 冻结确切 ActionDefinition/version、target、parameter hash 与 binding/release/generation，原 WorkflowRef 在 Start 前落盘；首个副作用前完成原审批、fresh 权限/额度检查，并建立同 operation 的 ExternalExecution 与稳定幂等键。Workflow 只携带引用、版本与 hash，不保存 SQL、提示正文或结果正文；真实 native 终态、已声明用量与审计按原链收敛，结果不明只观察原执行，不换 key 或重发。确实同请求完成且无 native task、无需 ExternalExecution 对账的 `SYNC` 动作不为此创建 Workflow；独立原生管理页面的内部 API 不被强制劫持为平台动作。

### 5.1 Activity 选项纪律

SDK 要求每个 Activity 至少设置 `ScheduleToCloseTimeout` 或 `StartToCloseTimeout`，而 Server 默认重试策略是无限次。因此每类 Activity 必须显式固定：`StartToCloseTimeout`、`ScheduleToCloseTimeout`、`RetryPolicy{MaximumAttempts, NonRetryableErrorTypes}`；所有长时 `observe` 型 Activity（组件 native task 的观察）必须设 `HeartbeatTimeout` 并周期 `RecordHeartbeat`，用 `HeartbeatDetails` 保存 native 游标以便 worker 重启后续跑。

任何"结果不明"的外部 dispatch 必须返回 `NonRetryableApplicationError`（类型固定为 `UNKNOWN_EXTERNAL_RESULT`），否则默认重试会把它自动重放——这与 ExternalExecution 的"无 native ref 不自动重放"直接冲突。对账是另一个 Activity，按 ExternalExecution 的 idempotency key 发起。`ADMISSION_DENIED`、`BINDING_FAIL_CLOSED` 同样列入 `NonRetryableErrorTypes`。

## 6. ExternalExecution

```text
start(operation_id, normalized_args)
  → immediate_result | native_execution_ref
observe(native_execution_ref)
  → native_status/progress/result_ref
cancel(native_execution_ref)
  → accepted | unsupported | current_state
```

- Temporal 不替换 native task：cancel/observe/heartbeat 能力由能力契约与 manifest 声明，并由一致性套件验证；Workflow 只使用已声明且验证通过的能力（DD-88）。
- native status 原样保留，平台 status 由固定 Adapter/release version 映射。`accepted` 只是取消请求被接受，不是终止事实。
- 声明不支持 native cancel 的实现，其 ExternalExecution 取消结果固定 `UNSUPPORTED`。Workflow 只停止等待并丢弃迟到结果，不终止共享 runtime，不声称 native 执行已取消。
- callback/observer 核对 binding、native ref、event identity/sequence 和 scope；重放/乱序不重复推进或计量。
- 每次真实 native 副作用在 dispatch 前建立 ExternalExecution，冻结 Tenant/Workspace、binding version、request digest 与稳定 idempotency key。响应不明时允许 `native_id=NONE` 并进入 `UNKNOWN`；只有 ActionDefinition 已登记的 native query/dedupe seam 能补回 native ref 或证明未发生，不能因无 ID 自动重放（DD-48）。
- `SOURCE_BOUND_PROTOCOL` 的保存是 ProtocolSession 协议操作，不是 native task。能力契约登记的结果证据被接受且确认新 revision 才在原 Action 内终结；写入或 revision 结果不明才创建 `ComponentTaskWorkflow(kind=PROTOCOL_SESSION_RECONCILE)`，固定 session ref、实现 binding refs、base revision 与 correlation，按该 binding 的能力契约/Adapter 登记的查证手段对账，不重新触发组件保存。内置参考实现的查证方式见 `18`。

## 7. 跨 Tenant 转移与 Tenant 生命周期

### 7.1 两段 export/import

```text
source Tenant session
→ RESOURCE_EXPORT: source export permission + owner approval
→ source-Tenant ExportPackage Asset(READY, owner, format/version, digest)
→ 受权 HUMAN 下载 package

target Tenant session
→ HUMAN 重新上传 package bytes
→ RESOURCE_IMPORT: target create permission + format/digest validation
→ 新 native object → 新 Resource/Asset → 新 HUMAN owner
```

- 两段链使用不同 PlatformSession、ExecutionContext、operation ID、ActionExecution 和 Workflow。平台不把源 Tenant 的 Resource ID、ACL、owner、native ID、URL 或 token 写入目标授权模型。
- ExportPackage 是源 Tenant 内的持久 Asset，只有 `READY` 且当前 `export/read` 许可通过时可下载。Import 重算 digest，只使用当前 ComponentRuntimeProjection 固定的 ComponentRelease/Adapter contract 声明的 format/version。
- 指定的目标 owner 不是 importer 时，该 active HUMAN 在创建前批准；创建后的 relationship 只在目标 Tenant 内生成。源对象后续变更/删除不推进目标对象，目标对象也不回写源 Tenant。
- 未同时登记导出格式、导入 API、稳定 digest 和失败/删除语义的 ResourceType 不暴露 export/import Action。这两个 Workflow 为 `DESIGN_DEFINED`（DD-69）；ResourceType 未登记格式时仍不暴露 Action。

### 7.2 Tenant 暂停、恢复与销毁

```text
ACTIVE → SUSPENDING → SUSPENDED → RESTORING → ACTIVE
                              └→ DELETING → DELETED
                                      └→ ERROR/UNKNOWN → reconcile
```

1. `SUSPENDING` 由平台 Catalog scope 的 Governed Action 置位（DD-96），首先停新 Action、stream、Agent trigger、Schedule、组件投影与 Resource/Asset 创建，再经 operator API 归档该 Tenant 的 Buzz Community 以断开全部连接（SF-BUZ-43）。
2. `SUSPENDED` 不发 native delete；因而可经新的 Catalog scope Governed Action 进入 `RESTORING`：先对账 secret/binding、SpiceDB、Gateway route 与组件 scope，再解档 Community 并回读，随后经该 host 按 Core 事实收敛 relay roster 与各 Workspace 的 Channel roster（暂停中 Workspace 只剩 CONTROL），全部一致才 `ACTIVE`；解档之后任一步失败时先重新归档再进入 `ERROR`，不留下已解档的 `ERROR` Tenant（DD-96）。
3. Tenant delete 由 Tenant admin 经受限会话从 `SUSPENDED` 发起（DD-96），准入时冻结 TenantLifecycleSnapshot；进入 `DELETING` 前，Tenant admin 批准销毁意图；snapshot 内每个不同 active HUMAN owner 对自己负责的 Resource/Asset ID+version digest 批准。相同 owner 的多个对象可合并一个 digest 决策，但不能省略任一不同 owner。
4. 冻结 snapshot 时为平台核心销毁链与 snapshot 中每个 ApplicationBinding 各建立一条 TenantDeleteSubprocess（`03` §4）。平台核心销毁链（`PLATFORM_CORE_CHAIN`）删除平台核心自有 ResourceType 与 Core 事实，不适用保留。其中 Buzz Community 与 roster 由上游整 Community 删除引擎经 Buzz 删除执行器真实删除（DD-109、SS-BUZ-COMMUNITY-DELETE）：`irreversible_dispatch_started=TRUE` 持久化且 DISPATCH 审计落库后才 `submit`，以 TenantDeleteSubprocess ID 为 `requested_by` 保证重试不建第二个请求，对冻结 inventory digest `approve` 后运行到 `retention_pending`，再以 `GET /operator/communities` 回读 CONTROL 名下已无该 host；`blocked`、不可达或结果不明时 `PLATFORM_CORE_CHAIN` 停在 `UNKNOWN`，由运维修复后 `unblock`，带外 `abort` 后以同一子流程重新提交。Community 归档是暂停手段，不是删除，不得作为该类别的处理结果。已声明删除能力的实现（`NATIVE_DELETE`）的每个 delete 调用使用稳定 `(tenant_lifecycle_snapshot_id, component_binding_id, native_ref)` 幂等键并登记 ExternalExecution；返回不明、取消未证实或对账未闭合时该子流程停在 `UNKNOWN` 并 fail closed 持续对账，其他子流程照常推进。声明 `retain_on_tenant_delete` 的实现（`RETAIN_ON_TENANT_DELETE`）不发 native delete，只撤 binding、撤凭据、保留审计并登记待人工处置，子流程进入 `RETAINED_DECLARED`。停在 `UNKNOWN` 的 `NATIVE_DELETE` 子流程只能由该业务 Tenant 的 admin 经 owner 审批的 Governed Action 处置为 `RETAINED_BY_DECISION`；处置不改写 binding 或 release 的声明字段，处置与理由进入审计。任一子流程未到终态时不把 Tenant 标为 `DELETED`。
5. 第一个不可逆 native delete 调用前可 cancel 回 `SUSPENDED`。`irreversible_dispatch_started=TRUE` 后不提供 restore 动作；只允许 rerun/reconcile 继续未结束的删除。
6. `DELETED` 只在全部 TenantDeleteSubprocess 到达终态（`DELETED/RETAINED_DECLARED/RETAINED_BY_DECISION`）、relationship/roster/route 撤销已对账、usage 已结算且 AuditEvent/tombstone 已持久时成立。删除 Workflow 不删 AuditEvent、UsageEvent、WorkflowRef 或 retained native evidence。Buzz 侧上游不删除的 Community 墓碑行、删除请求与检查点记录、未物理回收的共享 CAS 媒体与 Git 字节作为平台保留项登记在完成审计中；`DELETED` 对 Buzz 的含义是 Community 范围的行、tenant 对象前缀与缓存已删除并经上游逻辑缺席验证，不宣称共享字节已擦除（DD-109）。

业务能力实现不阻断 Tenant 销毁（DD-91）：声明了删除能力的实现执行其 native 删除子流程，声明 `retain_on_tenant_delete` 的实现只撤 binding 与凭据、保留审计并登记待人工处置；GAP-LCM-01 只作用于实现自身的删除能力声明。某个已声明删除能力的子流程失败或结果不明时，该子流程按 fail closed 持续对账，其他子流程照常推进；Tenant 只在全部子流程到达终态、或该业务 Tenant 的 admin 经 owner 审批的 Governed Action 把停在 `UNKNOWN` 的子流程处置为 `RETAINED_BY_DECISION`（不改写 binding 的声明字段，处置与理由进入审计）后，才进入 `DELETED`。Tenant delete Action 的注册按平台事实增量成立（DD-99）：平台核心销毁链由按平台事实类别登记的销毁处理器组成（Core 事实与平台核心自有 ResourceType、SpiceDB relationship、Buzz Community 与 roster、OpenBao Tenant namespace、OpenMeter Customer 数据、AgentGateway 投影），注册时已存在的每个类别都有经验证的处理器即可注册，之后新增的类别必须与其处理器同一构建登记；snapshot 中出现当前构建没有处理器的类别时 delete 准入拒绝，准入后才出现缺失时 `PLATFORM_CORE_CHAIN` 停在 `UNKNOWN` 并 fail closed。业务能力实现的删除缺口不阻断注册；注册前 Catalog 不登记该 Action，不存在从 `SUSPENDED` 进入 `DELETING` 的可执行转换。

### 7.3 Workspace 暂停与恢复

```text
ACTIVE → SUSPENDING → SUSPENDED → RESTORING → ACTIVE
                 \→ ERROR          \→ ERROR
```

`SUSPENDING` 在 Core 先使 Workspace scope fail closed，关闭 BFF stream、Agent trigger、Tool/menu discovery 和该 Workspace 的 Temporal Schedule；Workflow 随后查证 binding，把 Channel roster 清空为只剩 CONTROL 再 archive Buzz Channel，使原生端的读写一并关闭（DD-97）。Resource、Asset、owner 与 relationships 全部保留。`RESTORING` 从 Tenant scope 发起，依次对账 binding、SpiceDB、Channel unarchive、按 Core 事实重建 Channel roster（ACTIVE 成员与 Agent 的 ACTIVE 身份，DD-97）与 Schedule，全部一致后才 `ACTIVE`。Buzz 的 DELETE_GROUP 只软删除 Channel/discovery，不覆盖平台 Resource/Asset/binding/owner，当前不注册 Workspace delete Action（SF-BUZ-15、DD-46）。

Workspace 成员撤权不执行业务数据删除；它只使 WorkspaceMembership 进入 `REVOKING`，先 fail closed，再撤 SpiceDB workspace relationship 和 Buzz Channel roster，对账后 `REVOKED`。Tenant 成员撤权先撤 PlatformSession/全部 Workspace scope，再完成 owner 转移、SpiceDB tenant relationship 和 Buzz relay roster 撤销；有 active Resource/Asset owner 引用时不得 `REVOKED`，Tenant 销毁 Workflow 除外。恢复访问必须建立新 membership version 并重走建立对账，不把旧 relationship 缓存改回 allow（DD-45）。

## 8. 任务工作台投影

TaskProjection 字段以 `03` 为权威，最小包含 Tenant/Workspace、workflow type/version/kind、发起者/actor、Resource、workflow/run/parent、status/progress/waiting reason、ExternalExecution、Approval、Usage、Asset、audit refs、trace/native observation refs 和 observation gap 状态。

Web 只提供 `signal/update/cancel/rerun`。所有命令是 Governed Action 并 fresh Check；`rerun` 创建新 ActionExecution/Workflow，不改写旧 history。普通用户不进 temporal-ui。

一期任务取消与重跑只对已登记专属控制 ActionDefinition 的原动作开放（DD-84）。请求只给原 ActionExecution ID，BFF 不接受客户端自报 Workflow ID；控制 ActionExecution 的 target 是原动作 ID，原 target 与执行 scope 由 Core 读取原动作确定。取消在派发前重查本人身份、原权限、WorkflowRef 与 Temporal 运行事实；向固定原 Workflow ID 发送 `RequestCancelWorkflowExecution` 前先冻结首次 run ID 与 UNKNOWN 意图。RPC 成功也会是目标已结束或已有取消请求的 no-op；只有沿固定执行链在 history 中查到匹配控制 ID 的取消事件，才能把控制动作记为请求已记录，且不得显示原任务已取消。缺事件、查询失败或响应不明均不能证明请求未发出，保持 UNKNOWN。原执行仍 OPEN 且首次 run ID 未变时才以同一控制 ID 重试；原执行已关闭而无肯定证据时保持 UNKNOWN 并按 RB-07 告警。重跑在派发前重新核对原动作的审批要求、Temporal 关闭事实与终态投影、目标版本及收敛状态，新批准和新 Workflow 均属于新控制动作。控制可用性由 BFF 从当前权威事实给出，客户端隐藏按钮不能代替提交时的重新准入；Mobile 保持只读（REQ-21）。

任务列表、审批箱、详情、waiting reason、状态、错误、进度、用量与控制确认都是 `BUZZ_NATIVE` surface：主题实时继承 Buzz ThemeProvider/CSS variables；状态码、reason code 和错误分类以参数进入 Buzz `MessageKey/t`，不直接把 Temporal/组件英文错误当界面文案。Tenant/Workspace、权限和结果暴露仍由 BFF 决定，主题/i18n 不改变工作流状态（REQ-08、SF-WEB-03、DD-36）。

只有 Temporal terminal、ExternalExecution 对账、required usage/audit 均已记录时，产品才显示任务完成。Projection 落后不改变控制事实。

## 9. 自动化

用户可见的自动化（REQ-23）由本工作台承接，Buzz Relay 自带的 workflow 在 Kailo 部署中关闭（DD-106）。实体以 `03` §7 的 AutomationDefinition/AutomationVersion 为准，动作登记见 `05` §2.9。

```text
trigger（HUMAN 消息 / @提及 / Temporal Schedule / webhook）
→ automation.run admission（owner 为 initiator，执行 Installation 的 AgentPrincipal 为 actor，Delegation fresh）
→ AgentTaskWorkflow(input: AutomationVersion, Installation, AgentVersion, projection generation, trigger_source_id)
→ [child ApprovalWorkflow：版本固定的 ApprovalPolicy]
→ AGENT_TURN：Codex 回合 | POST_MESSAGE：以 Installation 的 Buzz 身份发布模板消息
→ 回帖到触发 Thread 或 Workspace Channel + usage/audit/TaskProjection
```

- 消息与 @提及触发复用 Agent 触发的 Relay 持久事件与 IngressCheckpoint（DD-04）；只有 HUMAN 身份发布的事件参与匹配，AGENT 与 CONTROL 身份的事件（含自动化自己的回帖）不匹配，因此不形成自触发循环。
- 消息与 webhook 触发由 Core 先写 ActionExecution 与 WorkflowRef，workflow ID 为 `platform:automation_run:<tenant_id>:<automation_resource_id>:<trigger_source_id>`，再按 §3.1 的 Start 纪律启动。
- `SCHEDULE` 触发使用 Temporal Schedule（SF-TMP-05），overlap 固定 `SKIP`，action 直接启动 `AgentTaskWorkflow`；run 的 workflow ID 由 scheduler 组成，其首个 Activity 调 Core 完成 `automation.run` 准入并按 §3.1 的 Schedule 例外回填 ActionExecution 与 WorkflowRef，准入拒绝时 Workflow 以拒绝原因终结、不产生副作用。Schedule 只在 AutomationDefinition `ENABLED` 时存在，`PAUSED` 时暂停，`DISABLED`、Workspace 暂停与 Tenant 暂停或销毁时按各自流程暂停或删除（§7.2、§7.3）。
- `WEBHOOK` 触发经 AgentGateway 公开路由进入 BFF：校验 HMAC-SHA256 签名（覆盖时间戳与正文）、5 分钟时间窗与 delivery ID 去重后才建立 ActionExecution；签名不符直接拒绝并只计入度量。正文作为不可信触发内容进入模板上下文，不能携带 Tenant、Workspace、Principal 或权限。
- 审批关卡是 step approval：child ActionExecution 与 child ApprovalWorkflow 在第一个副作用之前，父 Workflow 等待结果；拒绝或过期时该次运行以对应原因终结。
- 每次运行在准入时 fresh 检查 owner、执行 Installation、Delegation、Workspace 状态与 Quota；`AGENT_TURN` 经 CapacityLease 取得 Codex slot，其余同普通 Agent 回合。运行进入任务工作台，与其他 Workflow 同一投影、控制与观测规则。

### 9.1 Workflows 产品页

Workflows（工作流）是 Web/Desktop 左侧导航的独立平台核心页面，不是 Agents 页内的附属区域，也不以 Tasks、Approvals 或 Temporal UI 代替。两端使用同一 TypeScript 页面主体、Buzz 主题与 i18n；仅宿主导航接入不同，所有管理读写经 BFF。该入口不依赖任何业务能力 binding；页面可见不授予对象访问或执行权限。

- 定义列表按当前授权 Workspace 查询 AutomationDefinition，展示 owner、状态、已固定版本与执行 Installation 引用；无定义显示真实空状态，鉴权失败、依赖不可用或投影落后不得显示成“没有工作流”。
- 创建、版本查看与发布、启用、暂停、停用只消费 `05` §2.9 已登记的管理动作；已发布版本不可原地修改，编辑内容形成新版本，启用固定已发布版本。提交时由服务端重查权限、scope 和版本事实，不信任页面缓存。
- 配置以 DD-107 的 AutomationVersion 为权威。表单与 YAML 必须覆盖同一组合同字段并可相互切换；编辑已发布内容形成新版本。解析失败、未知字段或未知枚举保留编辑内容并拒绝提交，不把无法表示的字段静默丢弃，不执行任意 YAML 指令或恢复 Buzz 原生 workflow 引擎。
- 复制从有权读取的定义配置进入原创建过程，默认新 DRAFT、新 HUMAN owner；不复制 pin、启用状态、Schedule、webhook 密钥、委托授权、审批或运行历史。目标 Workspace、Installation 与 Delegation 均沿原准入重新查证；没有来源读取权或目标创建权则拒绝。
- 复制与 YAML 编辑不要求新增执行引擎或 Workflow kind。删除、手动触发与多步骤执行同样不能通过页面绕过领域动作、审批、幂等与持久执行语义；不能用恢复页面宣称原版全部行为已经等价。
- Run History（运行历史）是该自动化关联的 ActionExecution、WorkflowRef 与 TaskProjection 的授权视图，展示运行状态、等待原因、进度与用量引用，并进入同一 Tasks/Approvals 详情查看执行与审批轨迹；不另建运行、审批或审计权威，不向浏览器暴露原始 Temporal history、密钥或模型提示正文。
- UNKNOWN、投影落后与部分结果沿用本章终态纪律；控制动作仅按 §8 已登记范围开放，不因历史列表存在而增加重放、取消或重跑权限。Mobile 仅提供 REQ-21 允许的只读视图，不提供定义编辑、发布、启停或运行控制。
