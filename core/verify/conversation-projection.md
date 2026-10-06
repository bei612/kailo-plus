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

## 后续批次：私聊已读、偏好与原生隐藏状态

本节独立于上批冻结树 `92060f04713bace27686d7e2f6bfd35d066f2007` 的证据；
不把后续实现或窄检查算作该树的全量验收。

权威与影响面：DD-40 的同一 `CollaborationUserState`/版本 CAS 增加按真实
Conversation binding ID 寻址的收藏、静音；`msg:`/`thread:` 读凭据查询同时走
Workspace 与 Conversation 的原准入，使用当前 HUMAN SERVER 查询 Relay 原事件，
查询后再次比较身份与两级 binding，不把私聊 ID 填进 Workspace。权限撤销不返回正文
或残留读标记；依赖错误不当作空结果。新 JSON 列默认空对象，既有行可直接读取；
旧读取方忽略新列，下迁移在有非空偏好时拒绝，避免抹掉真实用户设置。

隐藏状态仍只有 Relay `channel_members.hidden_at` 和原 NIP-DV kind 30622；
Core 不存第二份隐藏权威。Web 的 hide/reopen 是本人 SERVER 签署原 41012/41010，
复用既有 publish attempt、审计和 UNKNOWN 对账；Native 仍本人 CLIENT 直连 Relay。
新操作不能开建成员集合，仅允许当前参与者操作已有私聊；CONTROL 不是参与者。
命令回执、hidden_at 和 relay-signed replaceable snapshot 同事务，按当前 viewer 的
原成员行串行化，重投旧隐藏回执不覆盖之后的恢复。失败回滚整笔事务，提交后的
通知中断可从原快照读取收敛，不创建新队列、工作流、偏好或聊天存储。

只读上游定位：Buzz `779af8886caae1317b4de962082429867ab61503`，
`/volumes/kailo/.references/buzz/crates/buzz-db/src/store/dm.rs` 的
`open_dm`、`hide_dm`、`unhide_dm`、`list_hidden_dms`；
`/volumes/kailo/.references/buzz/crates/buzz-relay/src/handlers/command_executor.rs`
的 `handle_dm_open`、`handle_dm_hide`、`persist_command_event`；
`/volumes/kailo/.references/buzz/crates/buzz-relay/src/handlers/side_effects.rs`
的 `publish_dm_visibility_snapshot`。这些都是原功能接线，不是另一套私聊实现。

当前批次实际窄验证（既有受限 SDK/本地固定 Rust 镜像，离线缓存，Cargo -j16）：

```text
cargo clippy --offline --locked -j16 -p platform-core --bin platform-core -- -D warnings
exit 0
cargo test --offline --locked -j16 -p platform-core --bin platform-core user_state::tests
test result: ok. 1 passed; 0 failed
cargo test --offline --locked -j16 -p platform-core --bin platform-core web_transport::tests
test result: ok. 7 passed; 0 failed
cargo check --offline --locked -j16 -p buzz-relay
Finished `dev` profile [unoptimized + debuginfo] target(s) in 47.48s
cargo test --offline --locked -j16 -p buzz-db governed_dm_keeps_control_out_and_converges_rotated_keys -- --ignored --nocapture
test result: ok. 1 passed; 0 failed
```

Core 命令由同批频道集成 agent 在共同 SDK 输入上集中运行，未另起重复 Core 构建。
私有副本把 Conversation `same_admission` 强改为 true，实际 0 passed/1 failed；
原样恢复后 1 passed，再运行发布检查 7 passed。四侧同源 preference 样例通过：
Rust 16、TypeScript 17、Dart 17、Go contracts 包 PASS。registry 已按同批输入重新生成。
新增偏好迁移在隔离 scope_verify 事务实际输出 `BEGIN / ALTER TABLE / DO /
ALTER TABLE / ROLLBACK`，退出 0，应用数据库未改动。

Relay 私有副本把 hidden_at 的 CASE 隐藏语义反转后，原实库检查实际输出
`assertion left == right failed; left: []`，0 passed/1 failed、退出 101；
恢复正式源码且 `cmp` 相同后，同一命令 1 passed/0 failed、退出 0。
实库检查覆盖本人隐藏/恢复、CONTROL 拒绝以及撤销旧钥匙后拒绝操作；不冒称已验证
真实客户端断线、同一用户跨设备显示或整个 BFF→Relay 网络链路。
临时数据库 `dm_user_state_9dbnme` 只含本次生成的验证数据，验证后已删除；
可由同一 desired schema 和原用例重建，scope_verify 与应用数据库未删除。

相对上批冻结树，本节六个主要生产文件（Relay dm/command_executor/side_effects、
Core user_state/web_transport/publish_reconcile）合计 +592/-154 行；额外包括
新请求契约、偏好 up/down 迁移、旧 SQLx 查询缓存删除以及共编的路由、registry、
四侧生成物和本文档。共享文件的频道 metadata 改动由同批频道证据单独解释。

本节不声明已部署、完整原生客户端验收或通过本批全量门禁。部署仍需先发布上述
Relay 接缝二进制，再通过既有 `BUZZ_MEMBER_EVENT_KINDS` 投递 41010/41012；仅改
运行配置不能纠正旧二进制。第 07 章 §1 已登记运行期与编译期区别。
