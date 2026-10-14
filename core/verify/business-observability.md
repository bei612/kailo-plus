# 业务操作与用量账单视图核验

对应 `V-REQ-10`、`.design/14` §2/§7/§8、`.design/11` §4/§6/§7、`V-SCN-27`、`V-SCN-44`
与 `apps/02` §6 Stage 4 目标链的 `committed usage/entitlement/billing projection → operation timeline`。

## 权威与边界

| 事实 | 权威 | 本视图如何取 |
|---|---|---|
| 谁发起、谁执行、在哪个范围、动作与目标 | `admission.action_execution`（根 operation） | 直接读，不含参数正文 |
| 审批与长任务阶段 | ApprovalProjection、WorkflowRef、TaskProjection | 复用本人任务的同一 `TASK_SELECT/TASK_FROM` 与 `observation()` |
| 用量事件投递 | Core `outbox.usage_event` | 只读 `settlement_status`、冻结 quantity；COMMITTED 仅表示 OpenMeter 按 ID/source 查到 `stored_at` |
| committed usage、entitlement/credit、invoice | OpenMeter 原生 API（Core-only 认证） | 每次请求直接查询，不写回 Core，不在 Core 聚合成账本 |

`GET /api/v1/operations?scope=mine` 只返回本人发起或实际执行的根操作；
`scope=tenant|workspace`、`GET /api/v1/operations/summary` 与 `GET /api/v1/usage-billing`
都先确认 Workspace 属于当前 Tenant，再对该范围 `audit` 做 `FullyConsistent` 判定
（与范围审计共用 `audit_views::authorize_scope`）；无权 403，判定不明 503。

## 确定状态，不补零

- 阶段（`BusinessOperationPhase`）与共用任务页同序：投影不明/落后优先为 `UNKNOWN`/
  `PROJECTION_DELAYED`，其次准入、派发、Workflow 终态；无 Workflow 的同步动作派发后为
  `APPLIED`，取消控制只算 `CANCEL_REQUESTED`。
- 用量状态（`OperationUsageState`）：无事件时按动作定义 `obs_usage_source` 与派发事实给出
  `NOT_METERED`/`NOT_DISPATCHED`/`BILLING_UNAVAILABLE`；有事件时 `UNKNOWN` 优先于 `FAILED`，
  再到 `SETTLEMENT_PENDING`（PENDING_PUBLISH/ACCEPTED），全部 COMMITTED 才是 `COMMITTED`。
- 耗时只取确定终态：Workflow 终态取 TaskProjection 终态写回时间（含兜底对账收敛的写回，
  因此长时间待对账的调用会如实拉长平均值），同步动作取同一 operation 的 DISPATCH/OUTCOME
  审计时间（审计按 operation 追加，`action_execution_id` 可空）；等待、运行、不明、撤销不计入平均值，但单列计数。
- meter：原生 meter 未声明 `workspace_id` 维度时 Workspace 视图显示
  `WORKSPACE_DIMENSION_UNAVAILABLE`，不按时间或 outbox 推算；查询成功且无数据显示
  `NO_COMMITTED_USAGE`；查询失败显示 `UNAVAILABLE`，三者都不给数值。
- 额度与账单是 Customer 级事实，Workspace 视图显示 `TENANT_SCOPE_ONLY`；没有 invoice
  显示「尚无账单，不表示已结算或金额为零」，invoice status 按原文映射已知值，未知值原样显示。

## 部署与业务验收

见下方按日期追加的实际记录；源码写入、CI 检查、部署与真实 SSO 页面复核分别记录。
