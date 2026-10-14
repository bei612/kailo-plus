# Capacity holder 保留期与丢失 thread 的确定终结

2026-10-14。关联 `.design/03` §8（PLATFORM_SLOT、UNKNOWN 不回收 units）、`.design/04` §11（外部超时先用 native ref 对账）、`.design/12` §1–2、`.design/17` §5、`DD-15/48/65`、`apps/06` §4 的 `UNKNOWN/PRECONDITION`。

## 现场事实（只读查询）

- Invocation `db6dfccb-f0db-409a-8ed6-d81e64e277d9`（安装 `2989b1ec-…`）`status=UNKNOWN`，`runtime_turn_id/native_status/reply_event_id` 均为空；`projection.agent_model_trace`、`outbox.usage_event` 均无该 Invocation 记录。审计只有 2026-10-05 19:55:31 的 `agent-turn:…:intent DISPATCH_INTENT`。
- 当时部署的 `57adcd16` 中 `start_turn` 先提交 `gateway_usage::prepare_turn` 写前 trace，失败即返回、不发 `turn/start`；`0238a858` 起 trace 与 DISPATCHING 同事务。没有 trace 即没有 `turn/start`（与 `record_turn_in_transaction` 的 not-sent 谓词一致）。
- Session thread `01a10da2-801f-7ee1-acba-5f89804f0110` 在该安装 `CODEX_HOME/sessions` 下没有 rollout，只有 writer lock；Gateway `request_logs` 中该安装身份 `858cef63-…` 最后一次请求是 10-05 16:57:56，之后没有任何模型请求。
- CapacityLease `c5a575d4-…` `state=UNKNOWN`，已持久 holder terminal `terminal_event_id=13 / 2026-10-05 20:04:45`；其 holder run `01a10da2-7b63-79ac-aeb7-4f329e633ab0` 已被 namespace retention（72h）清除：`temporal workflow show -r 01a10da2-…` 返回 `workflow execution not found`。
- 结果：每次 Advance 在 `acquire_or_renew` 重读已清除的旧 run history，得到 `Capacity authority unavailable`，永远到不了 native 观察；该 lease 占住全局 2 槽之一，并使同安装（parallelism=1）的 4 个 CREATED Invocation 自 10-06 起只能得到 `Exhausted`。

## 修改

1. `capacity.rs`：lease 已在同一 pool→lease 锁下持久的 holder terminal 即为该 holder 的 Temporal 终态证据。handover（`recover_unstarted`）与周期 `reconcile` 先使用它，只有没有持久终态时才读 history；从不以缺失 history 推断终态。
2. `agent_runtime.rs`：`thread_absent` 只把固定 Codex 对这一精确 thread 的 `thread/resume` 回答 `no rollout found for thread id <id>`（原有精确分类 `THREAD_NOT_FOUND`）当作 durable thread 不存在；超时、传输及其它原生错误一律保持不明。Core 不调用 thread/archive，也不删除 rollout。
3. `agent_task.rs`：`DISPATCHING/UNKNOWN` 且无 turn/native/reply/消息意图/trace/usage，并且原 Session thread 原生确定不存在时，Invocation 终结为 `FAILED`，写 `RECONCILIATION / DISPATCH_NOT_SENT` 审计（ActionExecution、Workflow 引用）。Session 不得替换已绑定 thread，因此不新建 thread 重发；不写零用量。
4. `capacity.rs` 释放谓词：确定未派发的 `FAILED` 与原有确定未派发的 `CANCELED` 同等进入释放（无写前 trace 即无 native turn）。

## 部署后应观察到的收敛

- `db6dfccb` 下一次 Advance：Capacity 返回 `held=false` 后进入 Session 恢复；`thread/resume` 得到 THREAD_NOT_FOUND → Invocation `FAILED`，lease `c5a575d4` → `RELEASED`，Workflow 以 Failed 关闭。审计新增 `7aa3b12d-…:agent-turn:db6dfccb-…:lost-thread`。
- 安装 `2989b1ec` 不再被 parallelism 堵塞；原 CREATED 的 `dd871fd9/2bc7a1f0/894f4ee2/1e255507` 按原 Relay 事件和有效委托依次重新准入派发（这是原持久触发的既定恢复，不是重放）。
- 若 `thread/resume` 回答不是该精确分类（例如安装 runtime 未运行），Invocation 保持 UNKNOWN，日志不再是 `Capacity holder 不可查证`，而是原 native 观察的不明结果。

## 验证边界

本批只做源码与 CI lint/verify；未在开发机编译或运行。实际收敛须部署后按上节逐项只读回查，未部署前不声称已收敛。
