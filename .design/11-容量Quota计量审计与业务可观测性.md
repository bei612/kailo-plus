# 容量、Quota、计量、审计与业务可观测性

## 1. 三个不可混同的概念

| 概念 | 问题 | 权威 |
|---|---|---|
| Operational Capacity | 现在是否有 runtime slot/worker 能执行 | Core CapacityLease 或 native component |
| Quota | 该 Tenant/Workspace/Resource/Agent 是否有商业额度 | OpenMeter entitlement/credit + Core 短期 QuotaReservation |
| Usage/Billing | 实际发生了什么用量与费用 | OpenMeter committed usage/plan/subscription/invoice |

OpenMeter 源码提供 entitlement、credit、meter/event、plan/subscription/invoice 及 LLM provider/model/token_type 成本（SF-OMT-01），因此它是 Quota/Usage/Billing 权威。它没有 action 级 reserve/commit/release，event ingest 返回 202（SF-OMT-02），因此 Core 只补一个短期同步 QuotaReservation，不复制账本。

## 2. Capacity

| Action 策略 | 准入语义 | 终态 |
|---|---|---|
| `NONE` | 无平台可控资源 | 只记 native outcome |
| `PLATFORM_SLOT` | 在指定 pool 获取由 Temporal Activity heartbeat 续租的 CapacityLease | Activity terminal evidence 后释放；heartbeat 超时进入 UNKNOWN 对账 |
| `NATIVE` | 不预留，调用后保留真实 429/health/job state | 不创建虚假 lease |

`PLATFORM_SLOT` 只用于平台自有 Agent（Codex）runner pool。业务能力服务、Temporal Server 与 AgentGateway upstream 不被塑造成 Core 可预留容量；业务能力动作固定 `NATIVE`，BFF 不做无接口依据的预留或并发预测，服务自身的准入降级（如编辑降为只读）作为 native 结果保留，内置参考实现的具体行为见 `08`。CapacityLease 只解决运行容量，不授予 permission 或商业额度。

Lease 的 holder_ref 固定 Workflow/Run/Activity/attempt；由 Activity `RecordHeartbeat` 在真实占用期间续租，HeartbeatTimeout 小于 lease expiry。heartbeat 超时只进入 `UNKNOWN`，不能直接把 units 回池；Activity retry 更新同一 lease 的 attempt。只有 Activity terminal evidence 成立后才 `RELEASED` 并复用 units，避免失联但仍运行的任务造成超配（SF-TSDK-04）。

## 3. Quota 准入与结算

### `CHECK`

```text
OpenMeter entitlement/credit check
→ dispatch
→ extract actual usage from native evidence or acknowledged durable Gateway usage
→ durable UsageEvent/outbox
→ OpenMeter 202 ingest
→ query/reconciliation confirms committed usage
```

### `STRICT_RESERVATION`

```text
verify all producers for Tenant+subject+meter are Core-governed
→ calculate a proven worst-case upper bound
→ serialize this Tenant+subject+meter in Core
→ read OpenMeter committed credit snapshot
→ subtract Core unsettled UsageEvent + active reservations
→ create QuotaReservation(operation, customer, meter, subject, upper_bound, snapshot ref, expiry)
→ dispatch
→ actual usage event
→ settlement confirmation
→ release/settle reservation
```

- 无法得到最坏上界的 action 不得选 `STRICT_RESERVATION`，也不得以乐观 estimate 作严格准入。
- 存在任何绕过 Core 的同 subject+meter producer 时不得选 `STRICT_RESERVATION`。该算法是 Core 的短期 admission overlay，不是 OpenMeter reserve，也不是跨系统原子事务（DD-51）。
- Reservation 只存 meter/subject/上界/expiry/state，不存 plan、余额、已承诺 usage 或 invoice。
- 外部结果 `UNKNOWN` 时保留 `SETTLEMENT_PENDING`，先对账 native state；不释放后立即重放副作用。
- OpenMeter 开源 server 固定一个 default namespace；每个 Tenant 映射其中唯一 Customer，Workspace/Resource/Agent/operation 使用带 Tenant 前缀且归属该 Customer 的 subject key/dimensions（SF-OMT-05/06、DD-38）。Core 调用同时固定 namespace、customer 与 subject；调用方不能自报或替换这些字段。OpenMeter API 在 SS-OMT-AUTH 闭合前不得 active。

## 4. Usage 幂等性

UsageEvent 以 `(tenant_id, source_type, source_id, meter_key)` 在 Core 唯一，并显式保存 Tenant、Workspace、OpenMeter Customer、subject 与受控 dimensions。OpenMeter 的去重键是 `(namespace, source, event.id)`，而相同 ledger group 可独立入账（SF-OMT-04）。因此：

1. ingest dedupe 和 sink dedupe 都必须启用，因为两者源码默认都是 false（SF-OMT-03）。
2. outbox 重试不产生新 event ID，不改 source/body/quantity/timestamp。
3. 同一 operation 可有多个可证明 native source，但同一 source+meter 只结算一次。
4. 只从具有完整持久事实的字段（字节数、任务、查询结果等能力契约声明的计量事实）发 actual usage。不可观测或存在落账前丢失路径的量不写 actual。
5. 标准远程模型调用的唯一 usage identity 是 AgentGateway 完成请求时生成的稳定 log ID，但当前 request-log DB writer 失败后清批次（SF-AGW-09）。只有 SS-AGW-USAGE 闭合为 durable acknowledged usage 后才能创建 token/page/cost UsageEvent；不同 provider 的 token 与 OCR page 使用不同 meter，不互相换算。Codex `RawResponseCompleted.response_id`、业务能力服务自带的 usage log 与原始 Gateway log 都只作 correlation/诊断 evidence（SF-AGW-06）。
6. Core 以 `IngressCheckpoint(source_key=agentgateway-durable-usage-tail)` 保存 cursor；cursor 晚写允许重复读取，稳定 log ID 防重复 UsageEvent。游标不恢复写库前已丢的记录。缺 Tenant/Workspace/operation correlation 的 durable usage 进入 reconcile，不按时间或 model 名猜归属。
7. OpenMeter 202 只把 UsageEvent 标为 `ACCEPTED`；按 ID/source 查到 event 已 `stored_at` 才标 `COMMITTED`——但 `COMMITTED` 只证明计量事件已落库，**不证明**该 Tenant+subject+meter 的 credit/entitlement 余额快照已吸收它（上游余额由持久快照推进，并专门处理迟到事件）。因此释放 settlement reservation 的条件另有两个之一：该 meter 的余额查询返回值已单调下降至少本次 `quantity`，或返回的快照时间点已不早于该事件时间。在此之前 reservation 保持占用。按 `stored_at` 就释放会让同一额度在下一次 STRICT 准入中被再次算作可用，正是 STRICT_RESERVATION 要防的超卖。`validation_errors` 与 `customer` 由 OpenMeter 在每次查询时按当时的 meter 集合与 subject→Customer 映射重算、不落库（SF-OMT-07）：首次读取出现 validation error 时 Core 记录配置告警并进入 `UNKNOWN` 并由对账动作收敛，但不据此把已 `stored_at` 的事件回退为未提交，也不在后续 meter 配置变更后重判。这不表示 invoice 已 finalized；调用失败与无法确认分别为 `FAILED/UNKNOWN`，不得显示零用量或已结算账单。

## 5. meter 来源

Core 只定义通用 Usage 上报契约，不内置任何业务能力服务的计量语义。每个业务能力 release 在 manifest 中为其动作声明 meter、actual source、结算键与 Tenant/Workspace/Resource 归属维度；归属维度只从 ActionExecution/Resource/OpenMeterBinding 构造，native payload 不能覆盖。`model_call_mode=PLATFORM_LLM_ROUTE` 的模型调用按下表 Gateway 行结算；`SELF_MANAGED_MODEL` 的模型调用由服务经 Adapter Protocol 上报 usage，以 native usage ref 为结算键，平台照常执行 Quota 与审计（DD-92）。内置参考实现的具体 meter 登记见 `08`。

| 使用面 | actual source | Tenant/Workspace 归属 | 结算键 |
|---|---|---|---|
| Codex Chat/Responses | SS-AGW-USAGE 闭合后的 durable Gateway usage | SS-COD-TRACE 闭合后由 trace→parent operation，再追加 Agent/Version/Installation dimension；闭合前 attribution=`NONE`、`BILLING_UNAVAILABLE` | stable request-log ID + provider 对应 token 或 page meter |
| 业务能力服务经 `PLATFORM_LLM_ROUTE` 的模型调用 | SS-AGW-USAGE 闭合后的 durable Gateway usage | 标准 `traceparent`/operation 头关联的 parent operation；缺失时 attribution=`NONE`，只降低成本归因精度 | stable request-log ID + provider 对应 token 或 page meter |
| 业务能力动作 | release manifest 声明的 actual source（native outcome 或经 Adapter Protocol 上报的 usage） | ActionExecution + 目标 Resource/Asset | manifest 声明的 native ref + meter |
| Buzz 普通消息 | 无商业 meter | Community/Channel | `quota=NONE` |

无法证明最坏上界的动作不使用 `STRICT_RESERVATION`；该限制是明确准入语义，不允许以 estimate 冒充硬额度。服务自身的准入降级与并发限制是 native 安全结果，不是 OpenMeter entitlement 或 permission deny。

## 6. Audit 与计费对账

AuditEvent 不是用量账本，UsageEvent 也不是安全审计。它们以 `operation_id + native source + OpenMeter event ID` 关联：

| 阶段 | Audit evidence |
|---|---|
| admission | action/version、target、parameter hash、ZedToken、delegation/approval/capacity/quota decision |
| dispatch | component binding、immutable release、projection generation、native request/ref、idempotency key、trace ID |
| outcome | native status/result ref、exposure decision |
| settlement | UsageEvent ID、OpenMeter event ID、event stored/validation evidence、reservation terminal state；invoice finalization 单独引用 billing fact |
| reconciliation/revoke | 差异、权威查询结果、人工决定 ref |

平台对外显示“用量事件已提交”要求 OpenMeter 按 ID/source 可查询到 `stored_at`，不以 202 接收或 outbox `published_at` 代替，也不以读时重算的 `validation_errors` 为条件；“用量已进入结算”以 charge/invoice 落库的 `validation_issues`（`critical`/`warning`）为稳定依据；“账单已结算”还必须引用 OpenMeter invoice finalized fact，三者不可共用一个状态（SF-OMT-07/08、DD-51）。

AgentGateway request log 不是 Platform AuditEvent：前者只证明已经成功持久化的远程模型调用 native status/token/page/cost，不能证明日志全集完整；后者证明 Tenant/Workspace、actor/initiator、permission/approval/quota 和业务目标。只有存在源码证明的 trace/request-log/operation 关联时才能归因；Codex 链在 SS-COD-TRACE 闭合前固定不归因。Platform Audit 不复制 Gateway prompt/response payload。模型用量只有 durable usage 已产生且 OpenMeter event按 ID/source 查到 `stored_at` 后显示已提交，`validation_errors` 只作配置告警；账单只有对应 OpenMeter invoice finalized 时显示已结算。

## 7. 业务可观测性与 OpenMeter 边界

业务用量/成本观测直接查询 OpenMeter entitlement、credit、committed usage、cost 与 billing；不能把这些值复制到 Core 聚合后再把聚合值当账本。

全局业务 operation view 以 `operation_id + native refs` 联合 Action/Audit、TaskProjection、Temporal/native status、AgentGateway log 和 OpenMeter usage/cost。普通 actor/Resource owner 只看受 exposure 允许的状态与自身用量；Workspace/Tenant 聚合、错误 evidence 和成本需要 `audit` 权限。完整业务事实合同与组件映射以 `14` 为权威。
