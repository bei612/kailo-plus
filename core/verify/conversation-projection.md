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

## 客户端批次：原私聊菜单、隐藏恢复与实际静音消费

本批沿用 DD-40 的同一 CollaborationUserState CAS 以及 DD-80 的参与者会话绑定。
Web/Desktop 共用原 `ChannelGroupSection`、`ChannelRow`、`ChannelContextMenuItems`，
收藏/静音写已生成的 `ConversationPreferenceRequest`；不创建另一套菜单、偏好表
或隐藏状态。影响链为原菜单 → Core 会话偏好 → 原通知/Inbox 计数消费者，以及
原关闭按钮/重新选人 → 本人签署原 DM_HIDE/DM_OPEN → Relay 原 NIP-DV 快照。
请求字段和持久化格式未增加，三端仍可读同一 Core CAS；Mobile 未生成组件宿主入口。

Web hide/reopen 使用 BFF 本人 SERVER 签署，冻结同一 Idempotency-Key；Desktop
使用既有本机 CLIENT 签名与 Relay publisher，冻结原事件，恢复不重开参与者集合。
Native 快照同时验证 Relay 签名与本人 p/d 标签，身份/Community 切换清理宿主，
迟到操作不能转到另一身份。失败不回退 localStorage 私聊偏好。UNKNOWN 保留原
事件或请求、显示中性状态，不乐观隐藏，不导航；确定快照已隐藏当前会话才回
原 Home/Inbox，隐藏其他会话不跳转。偏好丢回执先读取当前 Core CAS，版本推进
只展示当前权威状态并解除旧请求，不以新版本覆盖另一端修改，也不伪称旧操作成功。

Desktop 的原消息/线程通知和 Inbox badge 已消费 Core conversation ID → native
channel ID 的静音映射；旧本地私聊静音不再参与决策或写入，普通频道行为不变。
目录/偏好失败、缺失或刷新中不当成未静音，只有 ACTIVE 会话参与映射。保留原版
mention/broadcast 优先于 channel mute 的规则，不擅自改变提醒语义。Web 的现有
页面标题未读提醒改读 conversationPreferences，并随同一偏好变更重新读取。
Web Inbox 当前只枚举 Workspace，尚无私聊 Inbox；未发现 Web OS Notification
消费者，本批不声称这两项或完整原 DM 头像/未读展示已恢复。

只读源码复核：Buzz `779af8886caae1317b4de962082429867ab61503`，
`/volumes/kailo/.references/buzz/desktop/src/features/sidebar/ui/SidebarSection.tsx`
的 `SidebarSection`；`/volumes/kailo/.references/buzz/desktop/src/features/sidebar/ui/ChannelContextMenu.tsx`
的 `ChannelContextMenuItems`；`/volumes/kailo/.references/buzz/desktop/src/app/AppShell.tsx`
的 `handleHideDm`；`/volumes/kailo/.references/buzz/desktop/src/features/notifications/lib/shouldNotify.ts`
的 `shouldNotifyForEvent`。
新接缝只改变授权数据来源和宿主发布方式，不复制消息正文或改变 Relay 内容权威。

既有 4 CPU/8 GiB SDK 的实际集中检查：

```text
./node_modules/.bin/tsc --noEmit -p tsconfig.test.json
exit 0
./node_modules/.bin/vitest run test/new-message.test.tsx test/pages.test.tsx --pool=threads --maxWorkers=1 --no-file-parallelism
test/new-message.test.tsx (11 tests)
test/pages.test.tsx (223 tests)
Test Files 2 passed (2)
Tests 234 passed (234)
exit 0
```

其中菜单真实点击检查 PUT 目标、CAS、静音图标、关闭及确定后导航；其余检查覆盖
Core 静音取代旧本地值、UNKNOWN 冻结发布、偏好丢 ACK 的版本收敛、原选人键盘操作
和隐藏会话恢复。SDK-only 删除 p/d viewer 校验后原用例真实报错
`expected [Function] to throw an error`，1 failed/10 skipped、退出 1；恢复正式
源且 cmp 退出 0 后，以上 234 项全部通过。初次正式用例 10 passed/1 failed 是
期望遗漏原行附加 name 字段，已修正断言，仍核验完整 Conversation binding 字段。
早期两个 worker 启动超时均是 no tests，不计入通过；一次使用 SDK 无 PATH 的
pnpm 退出 127，随后直接用已安装 `.bin`，没有新安装工具或重复构建镜像。

原始输出位于受控数据目录
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/profile-settings-ortsoo.DRR20F/dm-client-restored.log`
与同目录 `dm-visibility-mutation.log`。同批前端 agent 已实际运行 Web 类型检查、
五文件 33 项检查、Desktop 类型检查均通过；之后追加的 host 导航和失败缓存分支
由后续合批类型检查覆盖，不能混称前一轮已验证这些增量。

本批未启动全局构建、未打安装包、未部署、未替 root 提交共享工作树；尚不能据此
声称真实 Web/BFF/Relay 网络隐藏恢复、原生通知弹窗或发布门禁已经验收。

### 2026-10-06：投递前能力注册表遗漏与原入口拒绝

本轮 Core/Worker 原发布输入固定为 `0c655f40e7711541eea49347b398886a37a0c4b7`。
原 release 已构建并推送 Core `sha256:d81d3c11d234ffd54323c3696517cb4ae3fa68e1cee9e8f48f499c8fa2166fdb`
与 Worker `sha256:e798bc9830e99094a5037f2958c47ec4df3c24d22cb7f466669e6997a0fa886d`，
但投递前原 `start-core.sh --no-build` 的注册表检查拒绝，因此没有部署这两份镜像。
该失败不是业务鉴权放宽的理由，也不能通过跳过原检查启动。

固定 release clone 的 `.env/secrets/data` 安全链接到正式同一输入；两目标服务经
原 Compose 解析后，除不执行的 build 路径外与 main 当前配置逐字段相同，现有
容器环境值没有变化，OpenMeter secret 解析到同一真实文件。数据库只读返回
`90|20261006190000|t`；未重复执行迁移。备份原件 `core-before-restoration.dump`
为 682785 bytes、mode 600，没有输出其内容或连接串。

第一次 clone 调用因缺设计目录，在取一次性 OpenBao 投递前报告
`IndexError: list index out of range`；按原 CI 方法导出该 commit 固定设计
`3553eba86e566455ece3547f9168fa4b6124b757` 后，第二次原命令仍退出 1：

```text
tools/registry/capabilities.yaml 与追溯记录不一致；先生成并入库，再构建
```

用同一固定 traceability、覆盖矩阵与原 `tools/gen-registry.py` 在隔离元数据
副本生成后，差异明确只有 `collab.channel.message` 的既有路由
`/api/v1/workspaces/{workspace_id}/channel` 漏入生成物；相对 `064cd615a` 的
注册表同样仅新增这一行。不新增能力、权限、资源或后端入口。
`core/crates/platform-core/src/capability_registry.rs::registry` 经 `include_str!`
在编译期嵌入该表，所以仅改 Compose/部署文件不能让旧镜像补上路由。
原生成输出已同步主树，原 `gen-registry.py --check` 实际返回
`22 条能力，20 个封闭 workflow kind 参与校验`、退出 0；主线必须提交该真实输入
并经原 release 重发，不能把已有镜像记为包含修复。

原件位于 `/volumes/data/kailo/tmp/buzz-restoration-release-20261006.QMJMtJ/`：
`core-deploy-fixed-clone.log`、`core-deploy-pinned-design.log` 与
`registry-check.rMYr5Y/tools/registry/capabilities.yaml`。两次 start 均在获取
wrapped secret、重建 Core 前退出；没有重启 Core、Worker 或其他服务，没有
修改业务身份、容量、权限与数据。本段不声称新镜像健康或业务验收完成。

## 2026-10-06：管理可见 Workspace 不再误作默认聊天频道

权威与根因：`.design/03` §2 与 `DD-41/46/80` 区分管理 scope 与原生频道成员。
本次只读查明：报告 503 的 Workspace 与两级 Buzz binding 均 ACTIVE，39000
元数据签名及 channel 标签成立，但 seam-verifier 没有该 Workspace 的
WorkspaceMembership，Relay roster 也不含其 SERVER 身份；目录因 fresh manage
正确列出此 Workspace，Web 却将它误选为聊天频道。该用户在另一个 Workspace
有 ACTIVE membership，双人私聊也正常。因此不是全局认证失效，不通过 CONTROL
代读私有消息，不自动加人，不修改旧频道名称或业务数据。

影响面：`WorkspaceView.isMember` 可选投影读取既有 ACTIVE membership；
Core 保留全部管理可见目录与成员管理页，发现页不再把 manage 当 isMember。
消息、频道元数据、媒体、SSE、已读位置的协作准入统一要求实际成员；失去资格
仍拒绝，binding 不可查证仍失败，不伪装空频道。Web 默认先选择已加入频道，
管理-only 行仍能显式打开管理入口；公开加入仍走已有 `workspace.join`，私有
不生成自助加入。共享 Inbox/Web 活动查询/Native visibility 投影只消费成员行。
没有新实体、工作流、存储或第二聊天权威，Mobile 管理目录保持原消费。

兼容与异常：字段只由 Core 写、四语言生成类型读取；true/false/缺省三态保持。
旧客户端忽略新可选字段，新客户端将缺省视为未知而不当成员，发布顺序为 Core
先于客户端。无数据迁移；空目录保持原空态，零个已加入频道显示明确非成员状态。
切 scope、撤权、目录失败、元数据未知/签名错误均沿既有拒绝及再准入，不回退默认
Tenant，不把管理资格降为协作授权。发现页的外部读取后 fence 同时比较成员事实。

实现后定向证据：复用 4 CPU / 8 GiB 的既有 SDK 与 Data 缓存；原 `tools/gen.sh`
退出 0。Core `cargo clippy --offline --locked -j16 -p platform-core --bin platform-core
-- -D warnings` 退出 0；`web_transport::tests` 21/21，Rust roundtrip 20/20，
Go contracts 包通过，Dart roundtrip 19/19、TS roundtrip 24/24。
shared/Web/Desktop 类型检查通过，shared Inbox 11/11，Web 默认选择/侧栏 10/10。
私有副本将 `WorkspaceAdmissionEpoch::is_member` 改为恒真，新增真实消费者断言
实际 0/1 失败（exit 101）；原字节还原后 1/1 通过，未禁用检查。

首次窄验的 SDK 本地包副本落后、Dart 默认缓存不可写以及旧 SSR 夹具缺少已恢复
Profile/Conversation provider 造成的失败已原样保留；同步真实源和已有缓存、补齐
隔离夹具后得到上面的通过结果，没有以修改产品行为迁就环境。日志位于
`/volumes/data/kailo/tmp/oidc-stream-sdk-20261006.36llvb/membership-*.log`。
本批未构建或部署；当前运行实例的旧 503 不能据源码窄验宣称已线上修复。
