# RB-06 usage 或 audit 缺口的定位与补录边界

`07-运行与运维基线.md` §6 第 6 项。Audit 与 Usage 记录不可删改（`07` §4）；外部副作用的结果按 `DD-48`、`DD-81` 收敛。

## 适用范围

- **Audit**：`audit.audit_event`，只追加（`audit_event_append_only` 触发器拒绝 UPDATE 与 DELETE），`event_key` 唯一。当前拓扑的写入点：

  | 动作 | 写入方式 | 缺口的形态 |
  |---|---|---|
  | 消息发布（`workspace.message.publish`） | 发送前 DISPATCH，结果 OUTCOME，结果不明由对账追加 RECONCILIATION（`DD-81`） | 只有 DISPATCH 而无结论：结果不明或结论写入失败 |
  | 设备公钥登记、成员与 scope 状态跃迁 | 与业务状态同一事务 | 不存在：事务要么都成、要么都不成 |
  | 身份解析被拒（AUTHENTICATION） | 被拒之后单独写入，失败只记日志 | 拒绝已生效而没有审计 |

- **Usage**：无适用对象。OpenMeter 与 UsageEvent 属于 Stage 4（`02-纵向交付路线.md` §6），当前拓扑没有任何计量写入。

## 触发信号

- `platform.publish.unsettled` 大于 0 且 `platform.publish.unsettled_oldest_age` 超过 `PUBLISH_RESULT_SETTLE_SECONDS` 加一个对账周期；
- `platform.publish.reconciled{outcome}` 出现 `QUERY_FAILED`、`CONTROL_UNREADABLE`、`WRITE_FAILED`、`EVIDENCE_MISSING` 或 `EVENT_UNOBSERVABLE`；
- Core 日志「发布前审计未写入，不发送」（发布因审计不可写而被拒）、「发布结果审计未写入，留给对账」、「认证拒绝审计未写入」「认证拒绝审计未提交」；
- 用户在界面上看到「发送结果待确认」及操作号。

## 判定依据

按 operation 取全部审计：

```sql
select event_type, action_key, result_code, occurred_at, evidence_refs,
       event_type in ('OUTCOME', 'RECONCILIATION')
       and not (event_type = 'RECONCILIATION' and result_code = 'NOT_DELIVERED'
                and action_key in (
                  'workspace.message.publish', 'conversation.message.publish',
                  'conversation.hide', 'conversation.reopen',
                  'workspace.channel.topic.publish', 'pulse.publish'
                )) as usable_terminal_result
from audit.audit_event
where operation_id = '<operation id>'
order by occurred_at, id;
```

| 结果 | 判定 |
|---|---|
| DISPATCH → OUTCOME | 同一次发送的明确响应；`ACCEPTED` 为接受，`REJECTED` 为拒绝，`NOT_DELIVERED` 为接收事件前的确定拒绝 |
| DISPATCH → RECONCILIATION `ACCEPTED` | 已取得原事件或该动作专用的肯定证据；不保证消息此刻仍可见 |
| 上述六类动作的 RECONCILIATION `NOT_DELIVERED` | 历史普通查询空产生的假阴性，原行保留但不算终态；没有其他有效结论时仍待对账 |
| 只有 DISPATCH，年龄在 settle 窗口内 | 正在等待，不是缺口 |
| 只有 DISPATCH 或仅有上述历史假阴性，年龄超出窗口加一个周期 | 持续未决：看 `platform.publish.reconciled` 的 outcome，按下文登记并继续核查；不按超时改为失败 |
| 没有任何审计，而消息在 Relay 上存在 | 越过 BFF 写入（原生端直连发布不经 Core，属设计内，见下）或缺陷 |

`usable_terminal_result` 与当前 Core 对这六类历史行的过滤一致；原始审计仍全部展示。
做终态数量、最近结论或未决列表统计时必须使用同一过滤，不能只按有无 RECONCILIATION 计数。
普通 `/query` 会隐藏软删除事件，先前通过时间检查的 writer 也可能尚未提交；查询成功但为空，
即使已过 settle 窗口，也不能证明从未送达。原 `publish_reconcile` 窗口内记 `PENDING`，过窗记
`EVENT_UNOBSERVABLE`，都不追加确定失败。后续取得肯定证据才以包含原 operation/event 的独立
幂等审计键追加 `ACCEPTED`，不改写或删除旧假阴性，也不伪造原来缺失的 DISPATCH。

原生端设备以自己的私钥直连 Relay 发布（`DD-75`），Core 不在路径上，这类消息**没有也不应有** Core 的发布审计；它们以设备公钥归属到本人（成员页的公钥列表）。

## 可执行步骤

1. **审计不可写导致发布被拒**（`DEPENDENCY_UNAVAILABLE`）：这是 fail closed，不是缺口——消息没有发出。恢复 Core 数据库的写入后发布自动恢复，不需要补录。
2. **只有 DISPATCH、或仅有上述历史假阴性而对账无有效结论**：
   - `QUERY_FAILED`：Relay 不可达或查询失败，恢复 Relay 后下一轮继续；
   - `CONTROL_UNREADABLE`：该 Tenant 的 CONTROL SecretRef 不可读，按 RB-02 处理；
   - `WRITE_FAILED`：对账已查到结论但写不进审计，恢复数据库写入后下一轮重写（`event_key` 唯一，重写不会重复）；
   - `EVIDENCE_MISSING`：DISPATCH 缺 event id 或原 scope/actor 证据不足，按缺陷升级，不猜补。
   - `EVENT_UNOBSERVABLE`：已过诊断窗口但普通查询仍无肯定证据，保持 UNKNOWN。登记 Tenant、原 operation/event ID、原动作与 scope、最近观察及时间、Core 值班负责人和下次核查时间；恢复依赖后由同一对账消费者继续，不重签或换键。资料替换、删除、撤权或历史丢失不能作为未送达证明。
   - `EVIDENCE_PARTIAL`：DISPATCH 带有不可识别种类的存量证据；不可识别条目只留在 DISPATCH 原行，不阻止按其余可核实的肯定证据结算；无肯定证据仍保持未决。持续出现说明仍有写入方产出契约外的证据种类，按缺陷升级。
3. **认证拒绝审计缺失**：日志中的「认证拒绝审计未写入」只说明这次拒绝没有留痕，拒绝本身已生效。记录时间窗与原因（数据库不可写），作为事件报告附件；不补录。
4. **疑似越过 BFF 的消息**：确认发布者公钥是否为某人的设备公钥（`identity.buzz_identity_binding` 中 `custody = 'CLIENT'`）。是则属设计内；不是则按 RB-05 第 5 步（roster `unexpected`）处理。

## 不可执行的动作

1. **补录边界**：只追加由权威证据推导出的 RECONCILIATION，证据必须能按 ID 复核（Relay 上的 event id）。不补写 OUTCOME，不为没有 DISPATCH 的动作补 DISPATCH，不编造 operation、actor 或结果——那会让审计为一件无从核验的事背书。
2. 不 UPDATE 或 DELETE 任何审计行，不临时禁用 `audit_event_append_only` 触发器。
3. 不由系统替用户重发结果不明的消息（`DD-48`）。原键回读仍 UNKNOWN 时保持原操作与签名事件；历史假阴性不得授权重签。只有原发送的明确 OUTCOME 证明 `NOT_DELIVERED` 时，原入口才按既有准入允许该键重新发起；不要换键或绕过入口「帮用户送达」（`DD-81`）。
4. 不把 `PUBLISH_RESULT_SETTLE_SECONDS` 调到 Relay 时间漂移窗口（900 秒）以下来加快结论（`07` §1）。

## 完成判据

- 每个被调查的 operation 有经上述过滤的有效结论，或仍明确标为未决，并登记证据边界、责任人与下次核查时间；
- `platform.publish.unsettled` 与未决登记一致；超窗条目仍保留且可继续查证，不以清零指标作为关闭事件的理由；
- 认证拒绝审计的缺失时间窗已记入事件报告。

## 演练记录

2026-09-23，本地拓扑（以下保留当时观察；第 2 项的普通查询空判失败已被当前判据替代，不作为新版本通过证据）：

1. **审计不可写**（`core/verify/drill-audit-gap.sh`）：以临时触发器让审计插入失败，经 BFF 发布得到 `503 {"class":"PRECONDITION","reason":"DEPENDENCY_UNAVAILABLE"}`，这条消息在 Relay 历史中出现 0 次；删除触发器后发布成功，审计为 `DISPATCH/DISPATCHED → OUTCOME/ACCEPTED`。**反向演练**：把 Core 改为 DISPATCH 失败后照发，同一演练得到 HTTP 200 且消息出现在 Relay 上——正是「成功但不可核验」；还原后恢复。
2. **对账三种结论**（`web_transport.rs::unsettled_publishes_are_reconciled_by_event_id`，随 `run-integration.sh` 运行）：真实发出的 event id → `ACCEPTED`；从未发出且超出 settle 窗口 → `NOT_DELIVERED`；从未发出且在窗口内 → 不写结论。把对账改为「查不到即未送达」时该用例当场失败。
3. 真实浏览器走查中 Relay 停机时发布，界面显示「发送结果待确认」与操作号，审计只有 DISPATCH；其后续收敛见 RB-07 的演练记录。

2026-10-26 运维订正：当前消费者以 `publish_reconcile.rs::reconciliation_result` 的肯定证据为准，
历史假阴性的扫描、度量、保留与重试过滤分别由既有真实 PostgreSQL 回归
`historical_absence_remains_pending_and_retained_until_positive_correction` 和
`publication_history_keeps_real_outcomes_and_distinct_operations` 覆盖；实际 live 对账继续沿
`core/verify/run-integration.sh` 的既有用例验收。固定源码、执行结果与尚未部署边界按各批回执记录；
本次文档订正没有运行 live 演练，不把 9 月结果改写为新 PASS。
