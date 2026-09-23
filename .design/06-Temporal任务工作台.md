# Temporal 任务工作台

Temporal 是 Approval 与用户可见持久 Workflow 的唯一生命周期权威。任务工作台是 Buzz Client Surface 对 Temporal 和 ExternalExecution 的受权投影，三端共用同一份 BFF 投影，不是第二套 Workflow 引擎。

## 1. 使用边界

| 动作 | 处理 |
|---|---|
| 无副作用读取、普通 Buzz event、同请求简单 CRUD | 不创建 Workflow |
| ONLYOFFICE 正常 WOPI open/Check/Get/Put | `PROTOCOL` Action + DocumentSession；不为 iframe loading/dirty/close 创建 Workflow |
| Approval | `ApprovalWorkflow` |
| Agent turn/invocation | `AgentTaskWorkflow`，input 固定 Installation、AgentVersion 与 projection generation |
| native async task、长时/多步/跨服务、timer/signal/cancel、UNKNOWN 对账（含文档 WOPI PutFile 结果不明） | `ComponentTaskWorkflow` |
| 跨 Resource 增量物化 | `ComponentTaskWorkflow(kind=MATERIALIZATION)`，周期触发由 Temporal Schedule 承接 |
| Resource 导出/导入 | 源、目标 Tenant 分别建立 `ComponentTaskWorkflow(kind=RESOURCE_EXPORT\|RESOURCE_IMPORT)`；不存在跨 Tenant Workflow input |
| Tenant 建立/暂停/恢复/销毁 | `ComponentTaskWorkflow(kind=TENANT_LIFECYCLE)`；销毁 input 固定 TenantLifecycleSnapshot 与各组件 ExternalExecution |
| Workspace 建立/暂停/恢复 | `ComponentTaskWorkflow(kind=WORKSPACE_LIFECYCLE)`，input 固定 Workspace ID/version 和 Buzz/SpiceDB projection refs；暂停/恢复固定映射 Channel archive/unarchive，不注册 delete |
| Tenant/Workspace 成员建立/撤权 | `ComponentTaskWorkflow(kind=MEMBERSHIP_PROJECTION\|MEMBERSHIP_REVOCATION)`，input 固定 `TENANT\|WORKSPACE` target type、membership ID/version 和 SpiceDB/Buzz projection refs |
| 原生设备公钥登记/撤销 | `ComponentTaskWorkflow(kind=BUZZ_IDENTITY_PROJECTION)`，input 固定 pubkey 与 binding version；方向由 binding 状态决定（`RECONCILING` 投入、`REVOKING` 移出），覆盖 relay roster 与该 Principal 全部 ACTIVE Workspace 的 Channel roster（DD-79） |
| ComponentRelease 登记/批准/撤销 | `ComponentTaskWorkflow(kind=COMPONENT_RELEASE)`，input 固定 source commit、manifest/API range、全部合同与 artifact digest；审批决定仍由 ApprovalWorkflow 承接 |
| PlatformProviderBinding 建立/升级/回滚 | `ComponentTaskWorkflow(kind=COMPONENT_BINDING)`，input 固定 `binding_kind=PLATFORM_PROVIDER`、port、binding、old/new release、old/new generation 与 provider projection refs |
| ApplicationBinding 建立/升级/回滚 | `ComponentTaskWorkflow(kind=COMPONENT_BINDING)`，input 固定 `binding_kind=APPLICATION`、binding、old/new release、old/new generation、native scope 与全部投影 refs |
| 两类 Binding 停用 | `ComponentTaskWorkflow(kind=COMPONENT_DISABLE)`，input 固定 binding kind/ID/version 和受影响 refs |
| 文档保存结果不明的对账 | `ComponentTaskWorkflow(kind=DOCUMENT_RECONCILE)`，input 固定 DocumentSession ID/version、FileReference（含 `base_revision`）、WOPI correlation 与 Cells binding refs |
| AgentInstallation 建立/升级/停用的多投影收敛 | `ComponentTaskWorkflow(kind=AGENT_INSTALLATION)`，input 固定 Installation ID/version、exact AgentVersion、projection generation、AgentPrincipal/BuzzIdentity、SpiceDB 与 Channel roster refs |
| SemanticModelVersion 发布/下线的 runtime 与 MCP target 收敛 | `ComponentTaskWorkflow(kind=MODEL_PUBLISH)`，input 固定 SemanticModel Resource/version、`mdl_digest`、profile SecretRef 与 Gateway MCP target refs |

“贯穿全局”指需要等待、恢复、控制和审批的生命周期统一由 Temporal 承接，不把每次 API/Check/聊天机械包装成 Workflow（DD-09）。

## 2. 源码确定的运行约束

- Server 提供 Start/Signal/Update/Cancel/Poll/Respond 和 Activity heartbeat/completion（SF-TMP-01）。
- Server 不执行应用 Workflow 逻辑；Application Worker 必须 Poll Workflow Task 并 Respond（SF-TMP-02）。
- Activity 可调用 Cells/WeKnora/Wren/Codex/DocumentServer 等外部 service，但“外部 service”不能取代 Worker。DocumentServer 正常 WOPI 协议不经 Worker；只有已登记的持久转换、审批或 UNKNOWN reconcile 进入 Workflow。
- 当前 Nexus dispatcher 拒绝 External target，一期不使用 Nexus 规避 Worker（SF-TMP-03，DD-10）。
- 周期任务使用 Temporal Schedule 的 Create/Update/Patch/Delete/List 与暂停/恢复，不在 Core 另建 cron 状态机（SF-TMP-05）。
- Application Worker 使用 `.references` 中的 `temporal-sdk-go`（`v1.48.0` 与 Server `go.mod` 一致，SF-TMP-04），不指定其他 SDK，不手写 Poll/Respond 协议。确定性契约固定：时间与并发只用 `workflow.Now/Sleep/NewTimer/NewSelector/Go`，派生值经 `MutableSideEffect` 固化，行为变更以 `GetVersion` changeID 门控，发布前对录制 history 用 `WorkflowReplayer` 回归，重放失败即阻断发布；`WorkflowPanicPolicy` 固定 `BlockWorkflow`（SF-TSDK-02/08、SF-TMP-08、DD-69）。本文全部 Workflow 类型为 `DESIGN_DEFINED`；Worker 实现并通过回归前不得 active。
- Approval 决定与参数确认经 Update 进入 Workflow；`UpdateHandlerOptions.Validator` 只能做确定性状态判断（已终结、重复/冲突决定、过期、approver 在冻结名单内），权限类检查必须在 handler 体内经 Activity 完成——validator 运行在只读 dispatcher 且重放时跳过（SF-TSDK-09）。取消固定使用 `RequestCancelWorkflowExecution`，Workflow 以 `workflow.NewSelector` 监听 `ctx.Done()` 后在 `workflow.NewDisconnectedContext` 上完成 native cancel、observe-to-terminal、CapacityLease 释放与最终投影，再以 `temporal.NewCanceledError` 终结；Signal 只用于无需同步拒绝语义的通知。

## 3. Namespace、身份与 history

- 一个 application namespace 承载所有 Tenant 的业务/Approval Workflow；不用 per-Tenant namespace 制造额外管理面。自定义 Search Attribute 固定只登记三个 Keyword：`KailoTenantId`、`KailoWorkspaceId`、`KailoWorkflowKind`，经 `AddSearchAttributes` 在 namespace 上一次性注册。SQL 标准可见性下全部自定义 Keyword 共用固定数量的预分配列，超出即 `InvalidArgument`；单值与整表另有大小上限。其余投影字段只存在 Core TaskProjection，不做 Search Attribute。
- Search Attribute 不是 Tenant 隔离边界：同 namespace 内任何持 Temporal 凭据者都能跨 Tenant 查询。隔离仍由 Core/BFF 的 scope guard 承担，Temporal 凭据只发给 Core/Worker。
- Browser、AgentGateway 和应用组件没有 Temporal 凭据。Core/Worker 在 Start/Signal/Update/Cancel 前用当前 ExecutionContext 做 Action Admission。
- history 只保存 ID、version、parameter hash、状态与受限 reference；正文、Secret、完整 prompt/response、SQL 和敏感结果不进 history。
- history 是**运行期**生命周期权威，不是永久档案：namespace retention 到期后整个 execution 被删除。因此 Approval/Task 的终态、决定人、决定时间与 evidence refs 必须在 Workflow 终结前由 Activity 幂等写入 Core（键 `workflow_id + decision event id`）；retention 值在部署时固定并作为运行前提登记。retention 之后 Core 投影是唯一可查事实，且仍不接受直接改状态。
- 单个 workflow 的 history 事件数、总字节与 pending Activity 数都有 Server 上限。按清单 fan-out 的 kind（`TENANT_LIFECYCLE`、`MATERIALIZATION`、`AgentTaskWorkflow` 等）必须分批：每批 pending Activity 有固定上界，批次结束检查 `GetContinueAsNewSuggested()`/`GetCurrentHistoryLength()`，为真则用 `workflow.NewContinueAsNewError` 携带（snapshot ID、已完成游标、冻结 input）继续。continue-as-new 保留同一 workflow ID，WorkflowRef 与 TaskProjection 按 workflow ID 而非 run ID 聚合。

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

Core 另有一个按 `KailoTenantId` 的 `ListWorkflowExecutions` 对账作业修补漏写，它是兜底而非主路径；工作台因此有确定的新鲜度上界，投影落后时显示 `PROJECTION_DELAYED` 而不是伪造完成。

Core 在 Temporal Start 前持久化唯一 WorkflowRef 与固定 workflow ID。workflow ID 一律取 `kailo:<kind>:<tenant_id>:<primary_entity_id>:<entity_version>`，使"不分配第二个业务 workflow ID"可被机械校验。

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
| `AgentTaskWorkflow` | Codex turn、tool child action、usage、cancel、Buzz reply |
| `ComponentTaskWorkflow` | 组件异步/多步动作与 ExternalExecution |

业务差异由 ActionDefinition、Workflow input 和 Driver 表达，不建 Knowledge/Drive/GenBI 等只转发一次 API 的浅 Workflow。AgentTaskWorkflow 始终固定触发时的 AgentVersion 与 projection generation；Installation 升级不修改运行中 history。Child Agent 只在有独立生命周期、独立频道回复或脱离 parent turn 继续时建立新 AgentTaskWorkflow。

`MATERIALIZATION` 是 `ComponentTaskWorkflow` 的受控 kind，不是第四种顶层 Workflow。它复用同一套审批、授权重检、capacity/quota、ExternalExecution、取消、审计和工作台投影。

`RESOURCE_EXPORT`、`RESOURCE_IMPORT`、`TENANT_LIFECYCLE`、`WORKSPACE_LIFECYCLE`、`MEMBERSHIP_PROJECTION`、`MEMBERSHIP_REVOCATION`、`COMPONENT_RELEASE`、`COMPONENT_BINDING`、`COMPONENT_DISABLE`、`DOCUMENT_RECONCILE`、`AGENT_INSTALLATION` 和 `MODEL_PUBLISH` 都只是 `ComponentTaskWorkflow` kind，不增加顶层 Workflow 引擎或新工作台。

### 5.1 Activity 选项纪律

SDK 要求每个 Activity 至少设置 `ScheduleToCloseTimeout` 或 `StartToCloseTimeout`，而 Server 默认重试策略是无限次。因此每类 Activity 必须显式固定：`StartToCloseTimeout`、`ScheduleToCloseTimeout`、`RetryPolicy{MaximumAttempts, NonRetryableErrorTypes}`；所有长时 `observe` 型 Activity（Cells job、WeKnora parse、CocoIndex run）必须设 `HeartbeatTimeout` 并周期 `RecordHeartbeat`，用 `HeartbeatDetails` 保存 native 游标以便 worker 重启后续跑。

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

- Temporal 不替换 native task：Cells job 依源码查询/控制（SF-CEL-01/02），WeKnora parse 依源码持久 cancelled 并 best-effort 取消 Asynq（SF-WEK-03）。
- native status 原样保留，平台 status 由固定 Driver version 映射。`accepted` 只是取消请求被接受，不是终止事实。
- Wren 没有通用 native cancel（SF-WRN-04）；其 ExternalExecution 固定 `UNSUPPORTED`。Workflow 只停止等待并丢弃迟到结果，不终止共享 runtime，不声称数据库 query 已取消。
- callback/observer 核对 binding、native ref、event identity/sequence 和 scope；重放/乱序不重复推进或计量。
- 每次真实 native 副作用在 dispatch 前建立 ExternalExecution，冻结 Tenant/Workspace、binding version、request digest 与稳定 idempotency key。响应不明时允许 `native_id=NONE` 并进入 `UNKNOWN`；只有 ActionDefinition 已登记的 native query/dedupe seam 能补回 native ref 或证明未发生，不能因无 ID 自动重放（DD-48）。
- ONLYOFFICE WOPI PutFile 是 DocumentSession 协议操作，不是 native task。Cells 已接受 PutFile evidence 且 NodeVersions 确认新 head revision 才在原 Action 内终结；PutFile 只返回 LastModifiedTime，写入或 revision 结果不明才创建 `ComponentTaskWorkflow(kind=DOCUMENT_RECONCILE)`，固定 session/node/base revision 并查询 Cells，不重新触发 DocumentServer 保存（SF-CEL-06/07、DD-31）。

## 7. 增量物化生命周期

```text
SCHEDULED → ADMITTED → RUNNING_COCOINDEX
          → WAITING_NATIVE → RECONCILING
          → SUCCEEDED | FAILED | CANCELLED | UNKNOWN
```

- 一个 active MaterializationBinding 对应一个 Temporal Schedule；每次触发创建新的 `ComponentTaskWorkflow(kind=MATERIALIZATION)`，固定 binding ID/version、source/target IDs 与 pipeline version。Schedule 重叠策略固定为不并发运行同一 binding；手动 catch-up 也走同一准入。
- Worker Activity 先做 fresh scope/SpiceDB/owner/binding/capacity/quota 检查，再分派到固定 `coco_environment_ref/coco_app_name` 的 Rust runner，后者调用 `App::update_with_options(UpdateOptions { full_reprocess:false, live:false, ... })`。CocoIndex 没有 scheduler/API server，SDK 也不保证稳定 `db_path`（缺省静默回落 `./coco_state`），稳定绝对路径是 Core runner 义务（SF-CIX-01/04）；该分派链为 `DESIGN_DEFINED`（Activity 内调用 runner，SF-TSDK-04、DD-69）；实现前不声称 CocoIndex 与 Worker 同进程。
- keyed source snapshot、revision 和 delete semantics 来自注册的 IncrementalContract；CocoIndex 记录逐项 previous/desired/pending/owner/generation 并执行 reconcile（SF-CIX-02/03）。Core 只接收 run 摘要与 refs，不复制逐项 memo。
- Cells 文件正文以受权下载流读取；目标只调用 WeKnora 公开上传、删除、reparse API，不直接写 WeKnora 数据库、向量库或 Neo4j。WeKnora 服务层已有保留 Knowledge ID 的 `ReplaceKnowledgeFile`，但固定源码没有暴露 HTTP route；更关键的是一期 item 按 `(file_hash, file_type)` 归并，同一 target 可代表多个同内容 Cells node，不能以单 node 变化原位改写共享 Knowledge（SF-WEK-07/11、SS-WEK-MATERIALIZATION）。因此目标动作仍固定为“创建新 Knowledge 并等待 ready，成功后删除旧 Knowledge”，以 WeKnora hash 去重作为 create 的事实幂等；转换期间旧版本继续服务，失败不提前删除旧版本。`duplicate_` 且携带既有 Knowledge 的 409 视为幂等命中；其它 409 由 sink 返回错误并保留 pending，不能吞错写成已应用（SF-WEK-07/11、SF-CIX-03/06）。
- WeKnora parse/reparse 是 ExternalExecution：Activity 保存 knowledge/task ref 后观察 native 状态。取消时先停止新的 CocoIndex action，再请求 WeKnora best-effort cancel；只有 native 对账确认 terminal 后才把已启动项标终止。
- 完成条件是 CocoIndex run 已 reconcile（判据为 `update_with_options` 返回 Ok **且**各组件 `num_errors == 0`；引擎对孤儿删除失败只记日志并保留 tombstone，`update` 仍返回 Ok，因此不得把 Ok 单独当作 reconcile 完成，SF-CIX-06）、所有本次 required native execution terminal、CapacityLease 已释放、ActionDefinition 登记的 native usage 与 durable Gateway usage 已形成 UsageEvent、OpenMeter 已可按 ID/source 查到该 event 的 `stored_at`、AuditEvent 已落账（`validation_errors` 是读时重算值，只作配置告警，不作完成判据）。同一 sink 的合并 batch 失败时，引擎只沿 component 边界二分隔离；成功 sibling 可已提交，Workflow 不得把该批次解释为整体回滚，仍以各 component 结果和 `num_errors` 收敛（SF-CIX-08）。该条件只闭合本次用量事件，不等待 invoice finalized。涉及模型 meter 而 SS-AGW-USAGE 未闭合，或 OpenMeter API 的 SS-OMT-AUTH 未闭合时，该 Workflow 不得 active；任一外部结果不明进入 `UNKNOWN`，由同 binding 的对账动作收敛，不能直接显示成功（SF-OMT-07、DD-51）。
- `PAUSED` 通过 Governed Action 暂停 Temporal Schedule，只阻止后续 run；清除目标副本是单独的 owner 审批动作，进入 `DELETING`，不得把 pause/cancel 当 delete。

## 8. 跨 Tenant 转移与 Tenant 生命周期

### 8.1 两段 export/import

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

### 8.2 Tenant 暂停、恢复与销毁

```text
ACTIVE → SUSPENDING → SUSPENDED → RESTORING → ACTIVE
                              └→ DELETING → DELETED
                                      └→ ERROR/UNKNOWN → reconcile
```

1. `SUSPENDING` 首先停新 Action、stream、Agent trigger、Schedule、组件投影与 Resource/Asset 创建，再冻结 TenantLifecycleSnapshot。
2. `SUSPENDED` 不发 native delete；因而可经新 Governed Action 进入 `RESTORING`，重做 secret/binding、SpiceDB、Buzz roster、Gateway route 和组件 scope 对账，全部一致后才 `ACTIVE`。
3. 进入 `DELETING` 前，Tenant admin 批准销毁意图；snapshot 内每个不同 active HUMAN owner 对自己负责的 Resource/Asset ID+version digest 批准。相同 owner 的多个对象可合并一个 digest 决策，但不能省略任一不同 owner。
4. 每个组件 delete 调用使用稳定 `(tenant_lifecycle_snapshot_id, component_binding_id, native_ref)` 幂等键并登记 ExternalExecution。组件不支持 delete、返回不明、取消未证实或对账未闭合时停在 `ERROR/UNKNOWN`，不把 Tenant 标为 `DELETED`。
5. 第一个不可逆 native delete 调用前可 cancel 回 `SUSPENDED`。`irreversible_dispatch_started=TRUE` 后不提供 restore 动作；只允许 rerun/reconcile 继续未结束的删除。
6. `DELETED` 只在全部 registered native delete terminal、relationship/roster/route 撤销已对账、usage 已结算且 AuditEvent/tombstone 已持久时成立。删除 Workflow 不删 AuditEvent、UsageEvent、WorkflowRef 或 retained native evidence。

当前只定义上述销毁合同，不开放销毁能力：GAP-LCM-01 使全部 active ResourceType 的 native delete/terminal 集合不成立。因此当前 Tenant delete Action 不注册，不存在从 `SUSPENDED` 进入 `DELETING` 的可执行转换。

### 8.3 Workspace 暂停与恢复

```text
ACTIVE → SUSPENDING → SUSPENDED → RESTORING → ACTIVE
                 \→ ERROR          \→ ERROR
```

`SUSPENDING` 在 Core 先使 Workspace scope fail closed，关闭 BFF stream、Agent trigger、Tool/menu discovery 和该 Workspace 的 Temporal Schedule；Workflow 随后 archive Buzz Channel 并查证 Buzz/SpiceDB/binding 投影。Resource、Asset、owner 与 relationships 全部保留。`RESTORING` 从 Tenant scope 发起，依次对账 binding、membership、SpiceDB、Channel unarchive 与 Schedule，全部一致后才 `ACTIVE`。Buzz 的 DELETE_GROUP 只软删除 Channel/discovery，不覆盖平台 Resource/Asset/binding/owner，当前不注册 Workspace delete Action（SF-BUZ-15、DD-46）。

Workspace 成员撤权不执行业务数据删除；它只使 WorkspaceMembership 进入 `REVOKING`，先 fail closed，再撤 SpiceDB workspace relationship 和 Buzz Channel roster，对账后 `REVOKED`。Tenant 成员撤权先撤 PlatformSession/全部 Workspace scope，再完成 owner 转移、SpiceDB tenant relationship 和 Buzz relay roster 撤销；有 active Resource/Asset owner 引用时不得 `REVOKED`，Tenant 销毁 Workflow 除外。恢复访问必须建立新 membership version 并重走建立对账，不把旧 relationship 缓存改回 allow（DD-45）。

## 9. 任务工作台投影

TaskProjection 字段以 `03` 为权威，最小包含 Tenant/Workspace、workflow type/version/kind、发起者/actor、Resource、workflow/run/parent、status/progress/waiting reason、ExternalExecution、Approval、Usage、Asset、audit refs、trace/native observation refs 和 observation gap 状态。

Web 只提供 `signal/update/cancel/rerun`。所有命令是 Governed Action 并 fresh Check；`rerun` 创建新 ActionExecution/Workflow，不改写旧 history。普通用户不进 temporal-ui。

任务列表、审批箱、详情、waiting reason、状态、错误、进度、用量与控制确认都是 `BUZZ_NATIVE` surface：主题实时继承 Buzz ThemeProvider/CSS variables；状态码、reason code 和错误分类以参数进入 Buzz `MessageKey/t`，不直接把 Temporal/组件英文错误当界面文案。Tenant/Workspace、权限和结果暴露仍由 BFF 决定，主题/i18n 不改变工作流状态（REQ-08、SF-WEB-03、DD-36）。

只有 Temporal terminal、ExternalExecution 对账、required usage/audit 均已记录时，产品才显示任务完成。Projection 落后不改变控制事实。
