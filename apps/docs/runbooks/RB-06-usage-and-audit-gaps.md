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

- `kailo.publish.unsettled` 大于 0 且 `kailo.publish.unsettled_oldest_age` 超过 `PUBLISH_RESULT_SETTLE_SECONDS` 加一个对账周期；
- `kailo.publish.reconciled{outcome}` 出现 `QUERY_FAILED`、`CONTROL_UNREADABLE`、`WRITE_FAILED` 或 `EVIDENCE_MISSING`；
- Core 日志「发布前审计未写入，不发送」（发布因审计不可写而被拒）、「发布结果审计未写入，留给对账」、「认证拒绝审计未写入」「认证拒绝审计未提交」；
- 用户在界面上看到「发送结果待确认」及操作号。

## 判定依据

按 operation 取全部审计：

```sql
select event_type, result_code, occurred_at, evidence_refs
from audit.audit_event where operation_id = '<operation id>' order by occurred_at;
```

| 结果 | 判定 |
|---|---|
| DISPATCH → OUTCOME | 完整 |
| DISPATCH → RECONCILIATION `ACCEPTED` / `NOT_DELIVERED` | 结果不明已由对账收敛；结论来自 Relay 的实际查询 |
| 只有 DISPATCH，年龄在 settle 窗口内 | 正在等待，不是缺口 |
| 只有 DISPATCH，年龄超出窗口加一个周期 | 对账没能结论：看 `kailo.publish.reconciled` 的 outcome 找原因 |
| 没有任何审计，而消息在 Relay 上存在 | 越过 BFF 写入（原生端直连发布不经 Core，属设计内，见下）或缺陷 |

原生端设备以自己的私钥直连 Relay 发布（`DD-75`），Core 不在路径上，这类消息**没有也不应有** Core 的发布审计；它们以设备公钥归属到本人（成员页的公钥列表）。

## 可执行步骤

1. **审计不可写导致发布被拒**（`DEPENDENCY_UNAVAILABLE`）：这是 fail closed，不是缺口——消息没有发出。恢复 Core 数据库的写入后发布自动恢复，不需要补录。
2. **只有 DISPATCH 而对账无结论**：
   - `QUERY_FAILED`：Relay 不可达或查询失败，恢复 Relay 后下一轮继续；
   - `CONTROL_UNREADABLE`：该 Tenant 的 CONTROL SecretRef 不可读，按 RB-02 处理；
   - `WRITE_FAILED`：对账已查到结论但写不进审计，恢复数据库写入后下一轮重写（`event_key` 唯一，重写不会重复）；
   - `EVIDENCE_MISSING`：DISPATCH 缺 event id，按缺陷升级。
3. **认证拒绝审计缺失**：日志中的「认证拒绝审计未写入」只说明这次拒绝没有留痕，拒绝本身已生效。记录时间窗与原因（数据库不可写），作为事件报告附件；不补录。
4. **疑似越过 BFF 的消息**：确认发布者公钥是否为某人的设备公钥（`identity.buzz_identity_binding` 中 `custody = 'CLIENT'`）。是则属设计内；不是则按 RB-05 第 5 步（roster `unexpected`）处理。

## 不可执行的动作

1. **补录边界**：只追加由权威证据推导出的 RECONCILIATION，证据必须能按 ID 复核（Relay 上的 event id）。不补写 OUTCOME，不为没有 DISPATCH 的动作补 DISPATCH，不编造 operation、actor 或结果——那会让审计为一件无从核验的事背书。
2. 不 UPDATE 或 DELETE 任何审计行，不临时禁用 `audit_event_append_only` 触发器。
3. 不由系统替用户重发消息（`DD-48`）。用户在界面上重发时带同一个幂等键，BFF 回答原操作的结论而不是再发一条（`DD-81`）；不要为了「帮用户送达」绕过这个键直接调用发布。
4. 不把 `PUBLISH_RESULT_SETTLE_SECONDS` 调到 Relay 时间漂移窗口（900 秒）以下来加快结论（`07` §1）。

## 完成判据

- `kailo.publish.unsettled` 中不存在超出 settle 窗口加一个周期的条目；
- 每个被调查的 operation 要么有 OUTCOME，要么有 RECONCILIATION，要么在窗口内等待；
- 认证拒绝审计的缺失时间窗已记入事件报告。

## 演练记录

2026-09-23，本地拓扑：

1. **审计不可写**（`core/verify/drill-audit-gap.sh`）：以临时触发器让审计插入失败，经 BFF 发布得到 `503 {"class":"PRECONDITION","reason":"DEPENDENCY_UNAVAILABLE"}`，这条消息在 Relay 历史中出现 0 次；删除触发器后发布成功，审计为 `DISPATCH/DISPATCHED → OUTCOME/ACCEPTED`。**反向演练**：把 Core 改为 DISPATCH 失败后照发，同一演练得到 HTTP 200 且消息出现在 Relay 上——正是「成功但不可核验」；还原后恢复。
2. **对账三种结论**（`web_transport.rs::unsettled_publishes_are_reconciled_by_event_id`，随 `run-integration.sh` 运行）：真实发出的 event id → `ACCEPTED`；从未发出且超出 settle 窗口 → `NOT_DELIVERED`；从未发出且在窗口内 → 不写结论。把对账改为「查不到即未送达」时该用例当场失败。
3. 真实浏览器走查中 Relay 停机时发布，界面显示「发送结果待确认」与操作号，审计只有 DISPATCH；其后续收敛见 RB-07 的演练记录。
