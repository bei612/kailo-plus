# Projects 原签名公告终态证据

2026-10-07；集中 Projects 创建批次的交叉复核修正。不是生产发布或 UI 验收。

## 四步影响结论

1. 权威为 `.design/09` 原版 Projects 公告与内容边界、DD-81 的同意图对账。固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的 `crates/buzz-relay/src/handlers/ingest.rs::ingest_event_inner/required_scope_for_kind` 要求真实签名、本人 actor 与原 ReposWrite；公告仍是 Community 数据面，不根据 buzz-channel 元数据另造 Workspace 权限。原 home Channel 的创建仍走 WorkspaceCreate，与公告写入分开。
2. 缺口是新增 CREATE_PROJECT/CREATE_REPOSITORY 沿旧 `event_exists` 只信查询 JSON 的 id 就结算成功。修正仅限 `publish_reconcile.rs::observe_delivery` 的 Projects 分支，以及 `collab-bridge/src/projects.rs::publication_observed`；其他 event_exists 消费者不变。既有 DISPATCH 的 operation_id、event_id、actor 精确关联 `admission.publish_attempt`，取得原 message_kind。原 TENANT 删除只接 kind 5；新 CHANNEL/home 创建只接 30621/30617，不凭返回事件自报 kind 决定动作。
3. 返回值必须是唯一完整 Nostr Event，冻结 ID、当前已准入 actor 和冻结 kind 全部吻合，并复用 `Event::verify` 重算事件 hash 与验签。使用已锁定 nostr 0.44.8 `src/event/mod.rs::Event::verify/verify_with_ctx/verify_id`，checksum `40ff7b77ef428b40aa2834a6acbae38a0e104c98b306208ca4b87a420d579a4b`，未手写密码学。只看字段 `{id: expected}` 不再成立；没有复制正文、增加契约/字段、签名、重发或第二执行权威。
4. 空数组只是当前不可观察，原 Projects 分支仍返回 `PROJECT_EVENT_UNOBSERVABLE` 并保持 UNKNOWN，不将可替换公告已消失当未送达。缺少原 publish_attempt、错误 scope-kind、多个事件、畸形 JSON、错误作者/ID/kind、伪造正文或签名均不结算成功。依赖失败沿既有 UNKNOWN 与对账度量；前后身份检查及保留原 DISPATCH 的机制未改。旧 kind 5 使用已有 message_kind 与原 actor 读取，不迁移旧数据。

同文件创建校验的名称/描述上限改为 `LazyLock` 读取既有 `contracts/api/projects_publish_request.schema.json` 的 maxLength，保持原 SDK 的 UTF-8 字节计数；上限缺失或不合法即拒绝，不增加客户端阈值。该 schema 的编译输入包装由主线同步至 `.dockerignore`、`core/Dockerfile`、`tools/release.sh`；此窄验证不证明 release 镜像已经构建。

实际查询同时发送冻结的 `ids` 和 `kinds`，不依赖宽泛的 kindless 过滤。固定上游同 commit 的 `crates/buzz-relay/src/handlers/req.rs::p_gated_filters_authorized` 对非空 kindless ids 存在豁免，不能把旧查询泛称必然 403；本次显式 kind 按工程 Relay 查询守则收窄结果。

## 实际验证

复用受限 SDK `kailo-agent-receipt-xvkujx`，CPU 4 核、8 GiB，`/cache/rust-target`；未新建整树快照、未部署。运行前确认没有并发 Cargo，宿主约 18 GiB 可用内存、Data 约 3.4 GiB 空闲。日志位于 `/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/workflow-native-template.s3JDP1/`。

- 实现后 `cargo test --offline --locked -j16 -p collab-bridge --lib projects::tests`：`projects-receipt.log` 4 passed、0 failed、17 filtered；含三种原 kind 的正向与上述证据不匹配/伪造场景，另三项为已有创建/删除语义。
- 仅在私有 SDK 输入删除 `event.verify()` 判断，再运行同命令：`projects-receipt-mutation.log` 3 passed、1 failed、17 filtered，退出 101；`publication_receipt_verifies_frozen_actor_kind_hash_and_signature` 抓到“保留 ID/签名但替换正文”的伪造事件。正式源码未受破坏；恢复后逐字节 cmp 并 touch 私有输入，避免 Cargo 沿旧 mtime 复用变异二进制。
- 恢复并改为契约读取上限后，同测试命令 `projects-receipt-restored.log`：4 passed、0 failed、0 ignored、17 filtered，退出 0。
- `cargo clippy --offline --locked -j16 -p collab-bridge --lib -- -D warnings`：`projects-receipt-bridge-clippy.log` 退出 0。首轮 Core clippy `projects-receipt-core-clippy.log` 退出 0。
- 最终显式 kind 查询输入：`rustfmt --edition 2021 --config skip_children=true --check crates/collab-bridge/src/projects.rs crates/platform-core/src/publish_reconcile.rs`（`projects-receipt-fmt.log`）退出 0；`cargo clippy --offline --locked -j16 -p platform-core --bin platform-core -- -D warnings`（`projects-receipt-core-clippy-final.log`）退出 0。

未运行真实数据库 DISPATCH→Relay→对账端到端场景；窄检查不证明已部署可用。不另跑全局构建，最终全局校验与发布由主线集中收口。


## 2026-10-26：Core 原发布冻结范围与 writer 肯定观察

本节对应先行设计 `design-authority@c4d338bce1c97d0dfde18da42e66a9064f12668c` 的 `09`「Core 原发布的范围与肯定证据」、DD-81 与 DD-142。上面的 10 月 7 日记录保留其当时范围；本批新 BFF 发布及对账改用以下接缝，不把先前普通 `/query` 记录算作新接缝验收。

### 实现与数据边界

- `web_transport::publish` 在原幂等 claim 的短事务内，通过实际消费者 `persist_publication_dispatch` 同时冻结 `admission.publish_attempt.delivery_scope` 和追加原 DISPATCH。固定字段为 Community ID、Tenant binding version、目标 Channel/binding version、实际签名事件 pubkey/kind/native channel，以及 owner 代改 Agent 消息的原 Installation ID；只存标识与版本，不存正文或 tags。
- 事件范围按实际签名与既有已验证目标链计算：频道 reaction/deletion 的 `e` 目标确定原生 channel，缺失目标拒绝；Pulse 与原 Projects 全局事件保持原生 channel 为空，Workspace 创建公告仍冻结其准入目标 binding。Hide/Reopen 记录实际 41012/41010，不以幂等字段的旧默认 9 替代。
- 只有新 Web 发布使用 `IdentityClient::deliver_scoped`：`/events?community=<canonical UUID>` 与唯一 NIP-98 community tag 绑定同一 Community；ACK 的 event_id 与 community_id 都匹配才判接受。原 Native 1631 和其他 unscoped 调用不变。
- `publish_reconcile::observe_delivery` 经原身份调用只读 `POST /events/observation`；request 仅 event_id/community_id，response 严格为 event_id/community_id/pubkey/kind/channel_id 五项。Core 比对全部冻结事实，并在请求前后重查成员、绑定、原作者或 owner/Installation；追加 ACCEPTED 前再以短事务锁本地准入事实。私聊只用原 HUMAN 身份，Agent owner 操作仅在 Workspace 使用原 CONTROL 读取元数据。
- 原 Agent key 读取与锁定的对账消费者共用 `OWNED_AGENT_KEY_SQL`：Installation、AGENT Principal、Resource、SERVER key、Channel binding 都必须 ACTIVE，且原 owner 与 fresh SpiceDB manage 成立；锁覆盖 Installation 和 Principal 行。保留最初 bound-key 读取选中的 Installation，不接受外部 I/O 期间换出的另一 Installation。
- 新迁移 `20261101020000` 只新增可空 JSONB；历史 NULL 不从当前 Host、当前身份或旧 message_kind 回填。down 在任何非 NULL 冻结范围存在时明确拒绝，避免删除 UNKNOWN 原意图的唯一范围事实。

### 固定源码与真实验证

固定产品源码 `afe53b8e766617513a84f8ddd3a53a6e1bff5957`，来自 GitHub 固定对象导出。沿原不可变 tools SDK `sha256:3007729eb192341a4f004a88e42e1e66c94fc67d763acfc96568bd7311116018`、Data 原 Cargo 缓存；实际限额为 SDK 4 CPU / 16 GiB、独立 PostgreSQL 1 CPU / 2 GiB，swap 上限各等于 memory。没有启动或停止共享业务服务。

证据目录为 CI `/volumes/data/kailo/verification/buzz-r10/publication-scope-afe53b8e766617513a84f8ddd3a53a6e1bff5957-r2/`；`receipt.json` SHA-256 为 `0c68dba1d07a32db968dcd70bd644482774d56cbe2058c9f4f50c8a0aea6068a`。同 SHA 不带 `-r2` 的目录保存首次正向与空库 down/up；两个目录的日志摘要均登记在 receipt。

| 原消费者/门禁 | 实际结果 |
|---|---|
| collab-bridge `scoped_publication_tests` | 2/2，通过真实 HTTP 发送验证 NIP-98 签名、payload/URL/Community tag、同作者发送 ACK 与严格 observation 响应；不冒称已连真实 Relay |
| platform-core `web_transport::tests::publication_` | 6/6，其中 4 项用实际 PG：原历史审计、BFF scope+DISPATCH 原子写、owner/Installation/Principal 停用、成员/绑定/私聊投影失效；另 2 项验证实际事件 kind/channel 和逐字段证据匹配 |
| platform-core `publish_reconcile::` | 3/3，包含原历史假阴性扫描/保留的实际 PG 消费者，旧 NULL/缺字段范围拒绝，以及普通查询空仍未知 |
| 新迁移 | 空库 up/down/up 退出 0；已有 scope 时直接执行原 down SQL 被拒绝，回滚后 scope 完整保留 |
| 相关 Clippy / 格式 | collab-bridge 与 platform-core `--all-targets -- -D warnings` 退出 0；最终 `cargo fmt --all --check` 退出 0 |

三次破坏均只发生在 CI 私有导出，测试与入库源码不变：移除 ACK Community 比较，实际 HTTP 断言发现错误 ACCEPTED；移除 Installation ACTIVE 过滤，实际 PG 断言发现 DISABLED Installation 仍被选中；将 BFF 实际 scope UPDATE 改为空值，实际 PG 读回无法取得冻结范围。各次均为原消费者失败、退出 101。逐字恢复后再次运行上述 11 项全部通过，所有五个 Rust/迁移文件又与固定 GitHub blob 逐字核对；SDK、PG 和专网清理后回读均为空。

前置失败如实保留：`e804f11d2` 的 Agent fixture 缺 HUMAN identity/member，被原 Resource owner 约束拒绝（23514）；仅补齐既有生命周期夹具事实后重验，不放宽约束或断言。同固定 `afe53b8e7` 的首次命令在 11 项正向通过、Community 反向实际失败并恢复后，因 SDK 无 `rg` 日志筛选工具退出 127；临时脚本改用 `grep`，在独立 `-r2` 日志继续故障与恢复检查。

### 尚未代表的交付范围

本分支仍沿基线的 `state.http` 字段，主集成须接入已经独立实现的受限 `state.relay_http` 后核对。Relay writer 含软删观察、native 授权/ban、历史 kind 5 NULL scope 拒绝等属于主线独立实现和真实 Relay/PG 检查；本节不把 HTTP 测试服务器当完整 Core→Relay 部署验收。

没有发布产物、部署或真实三端操作验收。观察缺失、拒绝、purge、不可观察的 41010/41012 或历史 NULL scope 都保持 UNKNOWN；本批只闭合新冻结范围的肯定证据消费，不证明权威缺失，也不宣称完整 DD-81 或旧未知操作已经全部收敛。
