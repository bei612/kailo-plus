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

- `stored_at` 查证（`openmeter::same_stored_event`）把冻结 CloudEvent 与原生读回逐字段比较，
  只按原生读时投影规范化两项：`time` 按 ClickHouse 秒精度比较；`datacontenttype` 按有效内容类型
  比较——固定 OpenMeter 的 `api/v3/handlers/events/convert.go::toAPIMeteringIngestedEvent`
  不保存该属性、凡有 data 即读出 `application/json`，CloudEvents JSON 格式中缺省即同义。
  Memory 读写与 Application 用量的冻结事件不带该属性，曾因此被判 `Conflict` 而停在 `UNKNOWN`
  （2026-10-20 生产 12 条 `BUZZ_AGENT_MEMORY`，原生读回与冻结事件仅此一键不同）；
  显式非 JSON 类型、`data` 或其余属性任何差异仍是 `Conflict`。
- 同步 Memory 读写（`agent_memory::confirm_memory_usage`）披露前需要本次两条 UsageEvent 的原生
  `stored_at`。原生 202 只入 Kafka producer，sink 异步落库（生产实测 ingested→stored 约 1 s），
  所以首轮 `settle_events` 最多到 `ACCEPTED`；此后在已配置的 `AGENT_MEMORY_READ_TIMEOUT_SECONDS`
  内只按 ID/source/subject/type 轮询原生 `stored_at`、不重复投递，再由同一 `settle_events` 记
  `COMMITTED`。超时仍是 `BILLING_UNAVAILABLE`，行由治理对账继续收敛。
- 阶段（`BusinessOperationPhase`）与共用任务页同序：投影不明/落后优先为 `UNKNOWN`/
  `PROJECTION_DELAYED`，其次准入、派发、Workflow 终态；无 Workflow 的同步动作派发后为
  `APPLIED`，取消控制只算 `CANCEL_REQUESTED`。
- 用量状态（`OperationUsageState`）：无事件时按动作定义 `obs_usage_source` 与派发事实给出
  `NOT_METERED`/`NOT_DISPATCHED`/`BILLING_UNAVAILABLE`；有事件时 `UNKNOWN` 优先于 `FAILED`，
  再到 `SETTLEMENT_PENDING`（PENDING_PUBLISH/ACCEPTED），全部 COMMITTED 才是 `COMMITTED`。
- 耗时只取审计中的确定终态时间：Workflow 取与 TaskProjection 终态同名的首个 OUTCOME，
  同步动作取同一 operation 的首个 DISPATCHED 或 OUTCOME（审计按 operation 追加，
  `action_execution_id` 可空）。投影写回、兜底对账与后来的过期/撤销事件不当作终态时间；
  没有这类审计事实的操作不计时，但仍按阶段计数；等待、运行、不明、撤销不进入平均值。
- meter：原生 meter 未声明 `workspace_id` 维度时 Workspace 视图显示
  `WORKSPACE_DIMENSION_UNAVAILABLE`，不按时间或 outbox 推算；查询成功且无数据显示
  `NO_COMMITTED_USAGE`；查询失败显示 `UNAVAILABLE`，三者都不给数值。
- 额度与账单是 Customer 级事实，Workspace 视图显示 `TENANT_SCOPE_ONLY`；没有 invoice
  显示「尚无账单，不表示已结算或金额为零」，invoice status 按原文映射已知值，未知值原样显示。

## 部署与业务验收

见下方按日期追加的实际记录；源码写入、CI 检查、部署与真实 SSO 页面复核分别记录。

### 2026-10-14 源码、检查与线上 SSO 实拍

提交：`9ff7a3ae`（源码与契约）→ `5019c8d2`（kailo-ci gen `77bc0112` 四侧生成物，
artifact SHA-256 `48610af8…cae0b`）→ `25fee580`（rustfmt）→ `2280c583`（同步动作按 operation
审计计时、`usage_event_by_operation` 只读索引迁移）→ `019cb2c5`（同级视图唯一 key、终态时间只取审计）。
`25fee580` lint `a4c22c12` exit 0；`019cb2c5` lint `021c3862` 与 verify `9e6675a9` 均 SUCCEEDED exit 0
（含 `business_observability` 单测）。`25fee580` 的 verify `1e730f4c` 失败的 7 项全在 Projects 与频道管理测试，
不涉及本能力。

线上发布点 `7bcdd952`（Core `5f433c77`、Web `703dcf2b`，迁移 `20261014200000` 已应用）用正常 SSO
在 Web `/app/usage`、`/app/operations` 实拍，Playwright 脚本 `~/kailo-acceptance/metering.mjs`
（CI 节点），截图在开发机 `/tmp/kailo-dev-work/s4/`：

| 账号 | 结果 |
|---|---|
| Tenant 管理员（中文 `s4b-*`、英文 `s4en-*`） | 侧栏有「用量与账单」「业务操作」；Customer ACTIVE；committed `uat_kailo_verify_total_tokens_20261004` sum 333329、`automation.run` count 1；三个记忆 meter 显示「OpenMeter 中未登记该计量项」；额度两项 metered/可用（token：余额 0、本期 36292、超额 333329，soft-limit）；投递 38 条已入账；按结算状态 计费数据不可用 4 / 已入账 29 / 未派发 5 / 不计量 90；无 invoice 时显示「不表示已结算或金额为零」。Workspace 视图：token meter「无法归属到工作区」，额度与账单 TENANT_SCOPE_ONLY |
| 普通成员 `kailo-qa-1`（`s4qa1-*`） | `/usage-billing`、`scope=tenant|workspace`、`/operations/summary` 全部 403，页面显示「没有整个组织的审计权限」；`scope=mine` 200，只列本人一条 `workspace.join` |

独立核对：Core 只读查询同区间 `outbox.usage_event` COMMITTED 共 38 条，token 合计 333329、
`automation.run` 1，与 OpenMeter 原生查询结果一致（视图未从 outbox 推算数值）。
21:11 UTC 首次读取时 token meter 为 UNAVAILABLE，OpenMeter 日志同刻为 ClickHouse
`memory limit exceeded`；ClickHouse 由主线程修复后同一查询返回 COMMITTED，说明查询失败如实
fail closed、不补零。

实拍发现并已修复（`019cb2c5`，待下一发布点部署后复拍）：业务操作切到 Workspace 时同级
Summary/Timeline 共用 key，页面残留整个组织的聚合；同步动作终态取了后来的过期/对账事实。

未覆盖：Desktop 安装包实机、Mobile 只读视图、`identity.client_key.register` 与 `tenant.bootstrap`
在共享动作目录中没有中文/英文标签（显示「未识别的动作」与原 key）。

### 2026-10-15 发布点 c1e0dda7 复拍

线上 Core `f7b4fdb7`、Web `eab92f1e`（含 `019cb2c5`、`d1669abd`）。截图在开发机 `/tmp/kailo-dev-work/s5/`：

- Workspace 视图（`s5zh-05`、`s6en-05`）：切到「多人多Agent协作验收1014」后只剩该范围的一份聚合
  （13 项：已生效 5、已完成 5、已过期 2、进行中 1）和 13 行时间线，不再残留整个组织的聚合；
  BFF 同刻 `summary?workspaceId=` total=13。
- 耗时：同步动作 0–43.4 秒；`agent.installation.create`、`workspace.*` 等没有同名 OUTCOME 审计的
  Workflow 动作显示「尚无确定终态」/「—」，不再用投影写回时间。
- 动作标签（`crop-actions-zh`、`crop6-actions-en`）：`identity.client_key.register` 显示
  「登记设备公钥 / Register device key」，`tenant.bootstrap` 显示「初始化组织 / Bootstrap organization」。
- 普通成员 `kailo-qa-1`（`s6qa1-*`）：范围视图全部 403，「我的操作」200。
- 首轮英文的组织范围两次请求在网关按 `fcae9942` 重建的窗口内没有回应，页面显示「结果不明，可重试」，
  没有渲染成空；网关修复后重拍正常。

call_webhook 与步骤超时：截至本次核对，库中没有任何带 `webhook_request_id` 的 Invocation，
也没有新的 `automation.run`（只有 10-05 的一次），因此计量与时间线没有实际对象可验收。按源码，
每次 call_webhook 运行写一条 `automation.run` count 用量事件，维度带 `webhook_request_id`；
时间线显示为该 `automation.run` 操作及其用量行与投递状态。`httpStatus`、`requestId` 记在运行轨迹
（Workflows 运行历史），业务操作视图不展示原生结果。

### 2026-10-20 Gateway 用量入账：无数量条目终态与 Tenant 级 binding 投递形态

生产只读核查（Core R19 `81a7bded`，只按键名与计数取数，未写库、未向生产 OpenMeter 写事件）：

- 全局游标 `projection.ingress_checkpoint(source_key=agentgateway-durable-usage-tail)` 只有一行、
  `tenant_id` 为空，停在 `76`。Gateway outbox 共 250 条，`seq>76` 的 175 条全部来自问数 binding
  `3d282c0d…` 的 SERVICE 主体：130 条没有任何 usage（其中 129 条 `httpStatus` 为空，客户端 120 秒超时），
  45 条有 `totalTokens`。core-bff 每 15 秒报 `seq 78` 的“没有该 meter 的实际数量”并保留游标。
  这段时间没有 Agent 请求进入 Gateway，因此尚无 Agent 用量被实际卡住；但游标全平台共用，
  此后任何 Agent 请求的尾部入账都会排在它之后。
- `outbox.usage_event` 中仅有的 17 条 `UNKNOWN`（`component_model_tokens`，native seq 60–76）
  也是仅有的 `data` 含 null 成员（`workspace_id`）的事件；全部 `COMMITTED` 事件的 `data` 都没有 null。
  固定 metering 版本的 v3 `MeteringEvent.data` 为 `additionalProperties: {}`（不可为 null），
  请求校验器 kin-openapi `v0.149.0` 对 null 返回 `Error at "/data/workspace_id": Value is not nullable`；
  以同一 spec 与同一版本在 CI 节点本地离线复核：null 拒绝，省略或非空通过。meter 的
  `$.workspace_id` 维度对缺省成员原生取空值（`parseGroupBy`）。

修复（DD-08、DD-21、V-SCN-175）：

- `correlate` 返回入账终态：全部冻结 meter 有原生数量写 UsageEvent；否则 Agent 与 binding
  一致写同 log ID 的 `BILLING_UNAVAILABLE` 审计（binding 记在归因 operation 下）并与游标同事务前移，
  计入 `platform.gateway_usage_ingress.billing_unavailable{scope}`。binding drain 回执新增
  `billingUnavailableRequests`；HUMAN 动作与 Agent 回合的子 binding 集合不再因无数量请求失败。
- OpenMeter 投递体为冻结体的确定投影（省略 `data` 中 null 成员），stored 查证按同一投影比对；
  冻结 outbox 行不改写。投递未被受理时记录状态码与问题摘要（title、invalid parameter 的
  field/rule/原因首行，截断），不记录 detail 或任何值。

生产收敛预期：新版 Core 上线后，下一轮治理对账即从 `seq 77` 起前移游标，130 条无数量条目各得一条
`BILLING_UNAVAILABLE` 审计，45 条有数量条目写入 `component_model_tokens` UsageEvent；17 条 `UNKNOWN`
与新事件经原 settle 先 `ACCEPTED`、再查得 `stored_at` 转 `COMMITTED`。验收按上述计数逐项读回。
