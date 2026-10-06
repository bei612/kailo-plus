# 原生私聊参与者投影

## 权威、影响面与副作用

REQ-24、DD-80 与 `.design/03`、`.design/09` 已确定：Core 仅保留
ConversationBuzzBinding、不可变 HUMAN Principal 参与者引用和当前设备钥匙投影；
Buzz 原生 `channels`、`channel_members`、消息与附件继续是会话内容权威。
不创建伪 Workspace，不把 CONTROL 加为参与者，不以 Tenant 管理权限读取私聊。

固定上游为 `779af8886caae1317b4de962082429867ab61503`：

- `crates/buzz-relay/src/handlers/command_executor.rs::handle_dm_open`：原生 DM_OPEN 接缝。
- `crates/buzz-db/src/store/dm.rs::open_dm`：原生私聊创建/查找。
- `crates/buzz-db/src/store/dm.rs::compute_participant_hash`：原版按设备钥匙集合识别会话。

适配原因是多设备与换钥不能改变人类会话身份。治理模式的 DM_OPEN 因此携带固定
channel 引用、Principal 引用、钥匙映射与单调 generation；事件和原生成员修改在同一事务。
原生非治理模式保持上游路径。CONTROL 只签投影命令，其权限不增加读取权。

管理写入沿既有 ActionAdmission、ActionExecution/outbox、ComponentTaskWorkflow
的 CONVERSATION_PROJECTION kind。消息发布沿原数据面、审计、幂等与结果对账链，
不为每条消息创建管理工作流。目录只列当前租户有效 HUMAN 与真实 ACTIVE 公钥。
Web 由本人 SERVER 身份经 BFF 读取/代签；Desktop/Mobile 仍本机持钥直连 Relay。

影响路径包括 BFF 私聊目录/消息/附件/流、原生 DM_OPEN、原 channel roster、SERVER/CLIENT
身份投影、Tenant 成员撤权与删除、发布 UNKNOWN 对账，以及四语言契约。
新增表没有旧格式数据需要回填；旧客户端不能调用新管理入口，既有 Workspace 格式不变。
Relay 新列允许旧普通频道无投影元数据，已投影私聊必须满足完整元数据约束。

## 边界与收敛

- `DENIED`：非参与者、跨租户、非 HUMAN、退出租户或停用身份均不准入。
- `BLOCKED`：非既定管理动作定义、非既定工作流类型不执行。
- `PRECONDITION`：目录空项、身份未投影、binding 不活跃或密钥不可用不伪造默认值。
- `LIMIT`：参与者数量从请求 schema 约束；消息与媒体继续使用原 Relay 运行时限制。
- `CONFLICT`：重复参与者、冻结目标不一致、过期 generation、同 generation 不同内容被拒绝。
- `UNKNOWN`：回执丢失、超时、部分投影与分区恢复继续原 channel/generation 对账，不换会话重建。

空目录返回空 items，不借用其他租户。分页使用既有配置上限；末页省略 nextCursor。
并发创建经过原 Tenant 锁与唯一参与者集合约束。设备撤销先从所有相关 DM 收敛移除，
再完成原身份退役；SERVER 激活前也必须经过会话投影。移除旧钥匙后清缓存并驱逐实时订阅。
执行中撤权与 Tenant 暂停关闭准入。恢复后按最新钥匙集合继续同一原生会话。
Web 对账用原 HUMAN signer，前后验证参与者、会话和 Tenant binding 版本；
CONTROL 无法读取不是“消息不存在”的证据。未知上游结果不宣布成功。
本次创建动作使用原目录的 NONE quota/capacity 策略，没有新增配额或测试专用上限。

新投影状态由同一 Temporal 工作流与既有身份/成员生命周期推进：
PROVISIONING → RECONCILING → ACTIVE；依赖不可用保留等待对账，使用现有有界 Activity
轮次与持久 timer，不另建轮询器。Tenant 删除把引用转 DISABLED。
取消收到之前已发出的投影仍对账，不能以取消替代外部终态证据。

## 已运行证据与交付边界

2026-10-06，Core SDK 在 4 CPU / 8 GiB cgroup 中执行：

```text
cargo check --offline --locked -j16 -p platform-core --bin platform-core
Finished `dev` profile

cargo test --offline --locked -j16 -p platform-core --bin platform-core web_transport::tests
test result: ok. 7 passed; 0 failed

cargo test --offline --locked -j16 -p platform-core --bin platform-core conversations::tests
test result: ok. 1 passed; 0 failed

go test ./workflows ./activities -run 'Conversation|WorkspaceCreator' -count=1
ok apps/worker/workflows
ok apps/worker/activities [no tests to run]
```

Core 迁移在隔离 scope_verify 数据库的事务内执行 up、down 后 ROLLBACK，退出 0。
四侧 `tools/gen.sh` 与 `tools/gen-registry.py` 退出 0。
私有验证副本把 Conversation workspace_id 的 None 改 Some 后，原发布作用域检查实际失败；
把 Worker 的会话结果 ID 核对移除后，错误会话被提前接受，检查实际失败；两处均已还原。
Worker 还原后同一检查再次通过。

以上是实现与窄验证，不是部署或三端端到端验收声明；完整 release 门禁与真实多人私聊
验收没有被这些结果替代。首次 Relay 检查因 SDK 1.90 与固定 sqlx 0.9 的 MSRV 不符失败；
未降依赖，后续验证使用本机原发布镜像中的 Rust 1.95。

同批补充验证均已通过：

```text
cargo check --offline --locked -j16 -p buzz-relay
Finished `dev` profile [unoptimized + debuginfo] target(s) in 1m 57s

cargo test --offline --locked -j16 -p buzz-db governed_dm_keeps_control_out_and_converges_rotated_keys -- --ignored --nocapture
test result: ok. 1 passed; 0 failed

cargo test --offline --locked -j16 -p platform-core --bin platform-core stream::tests
test result: ok. 1 passed; 0 failed
```

Relay 用例在单独创建的临时数据库加载当前 desired schema，验证 CONTROL 不入会话、
普通成员不能投影、换钥移除旧钥匙、相同 generation 幂等与旧 generation 拒绝。
私有副本故意反转旧钥匙移除条件后，`!keys.contains(&first)` 实际失败；还原后再次通过。
临时数据库已删除，只含本次验证数据；既有 scope_verify 与应用数据库未删除。
私有副本允许私聊 SSE 沿用游标后流检查失败，跳过参与者 schema 校验后边界检查失败；
均已还原，并包含最终 user_state 接线重新运行：stream 1、web_transport 7、conversations 1 全通过。

四侧原 round-trip 检查新增同源私聊 command、目录、分页和 projection 样例：Rust、Go、
TypeScript 与 Dart 均实际通过。向私有目录样例插入未建模字段后四侧均实际报错；
恢复同源样例后四侧再次通过。TypeScript 还运行原测试 tsconfig 的 `tsc --noEmit`。
Dart 私有验证依赖通过 `dart pub get --offline` 从现有缓存恢复，容器网络关闭。

仍未由本批证明完整原版 DM 功能或上线可用：原生 channel 已读上下文已接参与者判定，
`msg:`/`thread:` 已读上下文和 DM hide/unhide 的完整产品接线不在上述完成声明内；
真实三端端到端与统一 `tools/check.sh --full` 由主线集中验收。
