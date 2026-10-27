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

## 2026-10-26 共享事件肯定证据与集成 binary 检查

本节追加 DD-81 共享 `IdentityClient::event_exists` 的实际消费证据，不改写上面
2026-10-07 只覆盖 Projects 专用分支的范围。最终固定源码为
`438baa968815b7928193e8c7258628b64ac538d8`，初始输入为
`a833387145d1ee4d9144e53ef53fab01ea655c1f`；原 SDK 的格式输出先入库再检查，
合入主候选后对应 `c7f1b38b4` 与格式提交 `ff6109005`。

共享 helper 现在要求唯一完整 Nostr Event、精确原 ID、有效事件 hash 与签名；
空数组仍是不可观察，畸形/多条/仅自报 ID 的对象不能成为肯定证据。真实测试消费者
沿原 HTTP 查询验证 Host 与签名 NIP-98 请求，不以纯 JSON helper 代替发送路径。
这没有新增端点、权限、缺失判据、签名或重放。原查询发送与响应体读取仍缺 deadline；
其他调用方的历史普通查询空判失败另行登记，不能由本次验签通过宣称已全部修复。

原不可变 SDK
`sha256:3007729eb192341a4f004a88e42e1e66c94fc67d763acfc96568bd7311116018`
实际限额 2 CPU / 4 GiB，memory+swap 同限。check、Clippy、格式及原包检查全部
exit 0，分别 **74、9、3** 项通过（合计 86）。在检查副本关闭 `Event::verify` 后，
原消费者 **0 passed / 1 failed**、exit 101；逐字恢复为最终 GitHub blob 后，
对应 **3 passed**、exit 0，字节比对亦 exit 0。没有 PG、真实 Relay 或 Core 全量编译。
回执记录 OOMKilled=false、检查容器清理结果为空。

原回执：CI
`/volumes/data/kailo/conformance/checks/event-proof-a83338714/receipt.json`，
SHA-256 `55c517dbe671c149cfa618ac94a0ccac784ee6e2494f6de9864f80d9426feb4f`。
目录名保留初始输入，不把它误记为最终检查源码；回执内的逐阶段日志摘要可复核。

后续集成固定 `ff6109005482332eb8c3a19857fd23d2153938fd` 从 GitHub 取源，
只读挂载源码、复用原 Cargo 缓存，在同一 SDK **4 CPU / 16 GiB**（swap 同限）执行
`cargo test --locked --manifest-path core/Cargo.toml -p platform-core --bin platform-core`，
实际 **835 passed / 0 failed / 85 ignored**、exit 0；OOMKilled=false，容器清理为空。
85 项 ignored 未运行；没有 PG/live 环境，环境检查早返不算真实集成或 E2E。
该批没有重复 bridge 检查、迁移、SQLx、Clippy 或 workspace-wide 验证。

两次先前失败保留：`platform-lib-ff6109005` 请求不存在的 `--lib` 目标，exit 101；
`platform-bin-ff6109005` 独立导出遗漏编译期读取的 `tools/registry/capabilities.yaml`，
exit 101。仅从同一固定 GitHub 树补足真实输入后重跑，不以修改产品规避失败。
原回执：CI
`/volumes/data/kailo/conformance/checks/platform-bin-ff6109005-retry/receipt.json`，
SHA-256 `6be4040d85507acd03a098837abc6b284ffab6e1df82a9507870ea5f86b40ab0`；
两次失败日志及最终检查日志的摘要都保留在该回执中。

同一 `ff6109005` 的已有文档门禁使用设计
`bb41415a5241ce31564f9da01272ee6b82158c60`，原 SDK 1 CPU / 2 GiB，exit 0：
393 引用、96 实体、160 DD、30 SS、260 场景与设计 22 篇闭合，markdownlint 无问题。
原件为 CI
`/volumes/data/kailo/verification/phase1-integration/docs-ff6109005-final-docs-r2/`，
`check.log` SHA-256
`0a27b8c6e924a2952f1540274eac08c2ea52c2f121f53607a98ec57950120384`。
这些固定检查不等于最新 full、原生 writer 完整缺失查证、真实业务验收或发布。
本批只追加证据文档，没有产物、部署、数据库操作或服务变更。

## 2026-10-26 普通 Relay HTTP 有限期限（DD-81）

基准 `ff6109005482332eb8c3a19857fd23d2153938fd`。普通 HTTP 查询、发布、
roster/operator、NIP-11、moderation/GIF 与 Git info/refs 前置读取改用同一个
`relay_http` 连接池，由 ServiceState 与 BffState 共享 clone。总期限覆盖建立连接、
发送及读取响应正文；发送超时沿原 `Delivery::Unknown`，查询错误不伪装为空结果，
不修改原身份、授权、签名、幂等、对账或重试语义。

`BUZZ_RELAY_HTTP_TIMEOUT_SECONDS` 是必须显式投递的正 32 位整数秒，没有默认值。
`.env.example` 保留空值，Compose 同源传递，原 `bootstrap.sh --validate-config`、
`start-core.sh` 与 Core 构造器拒绝缺失、零、负数、畸形或越界值。启动脚本在取得
一次性凭据前校验。新增字段未投递即阻断本版启动，不使用 settle/轮询间隔代替它。

保留原 `http` 的消费者为媒体上传/下载、SpiceDB 清理以及已有独立预算的 Push
和 Memory；Push 的完整分页/lease 约束与 Memory 的完整读取/写入期限不被缩短。
SSE 的快照和附属 HTTP 查证使用新期限，增量 WebSocket、音频、组件原生长任务、
MCP、Agent Runtime、Temporal、Git 子进程继续使用各自原有传输与预算。

新增真实消费者检查在本机 TCP fixture 返回 HTTP 200 与部分 JSON 后停止正文，
分别调用原 IdentityClient.query/deliver 与 fetch_nip11；查询/NIP-11 必须失败，
发布必须 UNKNOWN，正常完整查询仍成功。启动期 platform_bootstrap::ensure 的
operator probe/轮换查证也使用同一客户端；构造提前到 OpenBao connect 之前。

固定检查源码 `fc219c4c9580b3bbacf8d2554c2a7d754ae702e8`，从 GitHub fetch 后
按固定对象导出；原 SDK
`sha256:3007729eb192341a4f004a88e42e1e66c94fc67d763acfc96568bd7311116018`，
实际回读限额 2 CPU、16 GiB memory 与 swap，原 `/volumes/data/kailo/check-cache`
及 `rust-target`，网络 none（fixture 仅容器回环）。执行前 MemAvailable 约 34 GiB、
无并发 Core 编译；21:51:27–21:53:17 UTC 终态 exit 0、OOMKilled=false，
所有本批检查容器事后实际查询为空。

- 原 SDK `cargo fmt --manifest-path core/Cargo.toml -p platform-core --check` 与
  两部署脚本 `bash -n` 退出 0；直接执行原 startup/precheck 校验段，缺失、空值、
  零、负数、符号、分数、空白、前导零、32 位溢出均拒绝，显式合法值通过。
  这是隔离的配置消费者验证，没有读取真实部署 `.env`，不冒充完整部署预检。
- `cargo test --offline --locked --manifest-path core/Cargo.toml -p platform-core
  --bin platform-core`：837 passed、0 failed、85 ignored，exit 0。没有运行
  PostgreSQL、SQLx 或真实服务 fixture；环境门控提前返回不计业务验收。
- `cargo clippy --offline --locked --manifest-path core/Cargo.toml -p platform-core
  --all-targets -- -D warnings`：exit 0。
- 仅在隔离导出树移除 `.timeout(timeout)`，运行真实
  `relay_http::tests::ordinary_relay_consumers_bound_stalled_response_bodies`：
  exit 101，失败为 `query body must reach the configured deadline: Elapsed(())`，
  不是编译失败。按原字节还原后 `relay_http::tests::` 两项全部通过，exit 0；
  还原文件与原件 SHA-256 同为
  `3fd94513007c31d0a6f86da5ada125e4397d1102d64a15c3d4b8f2eed22d63a8`。

原始日志目录：
`/volumes/data/kailo/verification/relay-http-deadline/fc219c4c9580b3bbacf8d2554c2a7d754ae702e8-check/`。
负向日志 SHA-256：
`a6ee584702fb25bf953e19b3c976bda547e6005ab019d3ef12df3c1122b62d21`。
保留首轮 `457b488bb607c480f48aa33a8ce4a987cd79c5b5-check` 的真实失败：
正常 837 项通过，但 Clippy 因新增 TCP fixture 未处理读取字节数而 exit 101，
故该轮未执行反向验证；随后修复并以上述新固定源重新通过。初次格式化使用
1 CPU/512 MiB 原 SDK，源 `0f72685397581307f12e140f6cb866d143aed592`，exit 0。

本批无 schema、API、Workflow 或权限变更；未更新运行环境、未部署，也未完成
普通事件权威缺失证明。HTTP deadline 只保证依赖等待有限，不能把超时或空读转为
NOT_DELIVERED；DD-81 的保守 UNKNOWN 与后续权威证明工作保持原边界。

## 2026-10-26 Core 原发布范围与 Relay writer 肯定证据

权威为单独提交的设计
`c4d338bce1c97d0dfde18da42e66a9064f12668c` 的 `09` Core 原发布段与 DD-80/81。
原普通查询隐藏软删除，不能查证“从未送达”；本接缝仅补包括软删除的原 writer
肯定事实。`POST /events/observation` 请求只有原 event ID 与冻结 Community，
仍走原 NIP-98 正文摘要、Host、重放与 HTTP 准入，只返回原 ID、Community、
作者、kind 与原生 Channel 五项引用。包括软删的原事件须通过 `Event::verify`。
缺失、拒绝、超时或不明历史范围保持 UNKNOWN，接口不提供 absence/settled 结论。
没有复制正文、标签、删除时间，也没有新增送达表、业务动作或执行权威。

实际发送仍使用原 `/events`，新增 scoped 形式将 Community 同时固定在签名 URL
query 和唯一 NIP-98 标签，原 ACK 同时返回同一 TenantContext 的 Community。
1631 保留其原仓库 owner 准入，其他 kind 仍经过原作者、成员与治理 ingest。
旧 unscoped 原生协议保持原语义；不能用它证明 scoped 交付。

交叉复核后补正两处实际边界。第一，durable ban 不会删除 Community/Channel
成员行，新肯定证据按原 Git proof 的 ban/已验 owner 级联规则做 fresh 拒绝；
这是证据读取较严格的准入，原普通 query 与 timeout 读取语义没有改变。第二，
原 kind:5 作者校验包含软删目标，而 Channel 推导过滤软删，重复删除已软删私聊
消息会丢失原 Channel。未来 ingest 改用同一个包括软删的目标 writer 读取；
肯定观察不把历史 NULL、错误范围或不明删除链当作 global，也不悄悄补造旧 scope。
私聊 Channel 始终要求当前真实成员，Community CONTROL 不是私聊参与者；
个人 30300 提醒只给原作者读取证据。

两批原 SDK 实际 HTTP/私有 PG/Redis 消费者，均从 GitHub 固定对象取源：

- `c3d10cfed149c31904fe4d767cc9dd5a85777d62`：SDK 2 CPU / 16 GiB，
  私有 PG 1 CPU / 2 GiB、Redis 0.5 CPU / 128 MiB，9/9 通过。
  三项破坏分别把 writer getter 改为过滤软删、关闭真实 Channel 成员校验、
  关闭 Community 匹配，均为原消费者断言失败、exit 101；逐字恢复后 9/9 通过。
- 最终 Relay 产品源码 `63590d878ee3db7d483f96df4767bbdd96d5dcee`：
  热缓存 SDK 2 CPU / 8 GiB，PG/Redis 限额同上，11/11 通过，0 ignored。
  原生 repeat-delete 实际 POST 验证原 Channel 被保留；保留的历史坏行与 NULL
  删除链被拒绝。分别关闭 fresh ban、还原错误的 kind:5 目标 getter、移除历史
  scope 校验，三项均原消费者断言失败、exit 101。逐字恢复两个生产文件后
  11/11 再通过，格式检查退出 0。

使用的原 SDK 均为
`sha256:3007729eb192341a4f004a88e42e1e66c94fc67d763acfc96568bd7311116018`；
两批实际 memory+swap 等于 memory，OOMKilled=false，检查容器、PG、Redis 与
私有网络均已清理。第一批 16 GiB 与后批 8 GiB 分开记录，不互相代替。
[固定回执](publication-writer-observation-receipts.json)保留各阶段日志摘要与限额。
CI 原回执分别在
`/volumes/data/kailo/verification/phase1-integration/observation-c3d10cfed-check/receipt.json`
（SHA-256 `88146a2dec740d8b01b8bfb1ffcd0cb02bf3b29d0e615a7b1d896455832b806a`）与
`/volumes/data/kailo/verification/phase1-integration/observation-63590d878-check/receipt.json`
（SHA-256 `9cfb1948e6482cab6f989cdf348c4673a224e4761413b2fe22d553ec5d887014`）。

这些批次没有 Core/BFF 的完整端到端消费者，不能冒称其范围冻结、404→UNKNOWN
与最终 audit 消费已经验收。Core 配套实现另取固定源码验证；普通发布的权威缺失
证明、正式制品、最新 full、真实用户业务与部署仍独立收口。

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

本节固定 `afe53b8e7` 分支沿基线的 `state.http` 字段；主集成 `83ec3ebb339ab53f65bbf7b04b1866dfbb10cd71` 已把这两条新请求接入受限 `state.relay_http`，其合批验收另记，不借本节检查代替。Relay writer 含软删观察、native 授权/ban、历史 kind 5 NULL scope 拒绝等属于主线独立实现和真实 Relay/PG 检查；本节不把 HTTP 测试服务器当完整 Core→Relay 部署验收。

没有发布产物、部署或真实三端操作验收。观察缺失、拒绝、purge、不可观察的 41010/41012 或历史 NULL scope 都保持 UNKNOWN；本批只闭合新冻结范围的肯定证据消费，不证明权威缺失，也不宣称完整 DD-81 或旧未知操作已经全部收敛。

## 2026-10-26 合批固定源码检查

最终 Core 产品集成固定 `1d0d20b5336f7f3cb124ee33bdc2972263444d6b`，原 SDK
4 CPU / 16 GiB、私有 PG 1 CPU / 2 GiB，memory+swap 同限。正常 Core 主目标
839 passed / 91 ignored；显式原消费者 Agent 5、Canvas 4、审核 6、scope 5、
history 1、reconcile 3 与 bridge 实际 HTTP 2 项全部通过。真实 PG 通过原显式
环境单独调用，ignored 与正常目标中缺少 live 环境而早返的项不算真实业务验收。
格式、完整迁移、两条新迁移在空库回退/重进、Core/bridge all-target Clippy 与
原 `cargo sqlx prepare --workspace --check` 全部退出 0。3,284 份归档输入与
固定 GitHub 对象逐字一致，包含 SQLx 缓存，没有未提交的生成物或手改缓存。

[集成回执](phase1-integration-publication-20261026.json)原字节 SHA-256 为
`3671264fad33036e39a7466034ba12cd8a7239c5ded1b9abea43fdc848a1667c`，
CI 原件在
`/volumes/data/kailo/conformance/checks/publication-integrated-1d0d20b53/receipt.json`。
本批不重复已通过的故障变异；原各固定批次分别保留其反向、恢复、前置失败和边界。
SDK/PG 均无 OOM，容器和私有网络已清理；未运行全工程 full 或部署。

Relay 最后另补真实 Pulse note/like/unlike：为保持私聊历史 NULL scope 拒绝，
不能同时把合法 global kind:7 的 UNLIKE 也拒绝。固定
`85c26ebcd1c42d5c962232b0bb103b3dfa237ad9` 在原 SDK 2 CPU / 8 GiB 与原
私有 PG/Redis 限额内，实际 scoped POST 后把 note、reaction 与 unlike 全部软删，
原 writer 观察仍成立。12/12 通过；仅关闭验证 global kind:7→kind:1 目标链的
生产分支，原消费者收到 404 而非 200、实际断言失败 exit 101；逐字恢复后
12/12 再通过。该批无 OOM、容器与网络已清理。

## 普通 writer 缺失查证与真实私聊准入

设计固定 `3635890d5fde0dad94ec29e0c1f49d99ae67dd09`，普通存储屏障的独立
固定源码与 10 项真实 PG、128 项常规 DB 结果见
[数据库屏障证据](../../collaboration/fork/verify/publication-db-fence.md)。旧入口的
900 秒检查不能单独证明迟到请求无法提交；本批复用实际 writer 事务锁、数据库
时间、包括软删除的保留行与签名 Community epoch，不增加送达账本。

Relay 集成固定 `1fde2756a4a27d226e7a5ca801312a0c832fea51`。原路由新增只读
`POST /events/settlement`，原作者与当前 CONTROL owner 分别签名同一 URL、方法、
正文和唯一 Community 标签，并分别执行重放检查。owner 只证明 Core 元数据来源，
不代替原作者的当前 Channel 资格；查证后重新核验 Host、Community、成员和 ban。
NIP-11 只有在实际父表及全部分区屏障有效时才宣告 publication policy。
原 pure-topic 只增加唯一规范 epoch 元数据标签，其余管理/未知标签仍拒绝。

最终使用原 Native SDK
`sha256:df8a3475e3e32ecf5ac79f9c12763b8ce5d4f91a75c25007fd9bfa5b282fc081`，
实际 Rust/Cargo 1.95、2 CPU / 8 GiB；独立 PG 1 CPU / 2 GiB、Redis
0.5 CPU / 128 MiB，memory 与 swap 同限，无生产凭据或数据库投递。
源码仍由 CI 从 GitHub 固定对象归档。先前原 SDK
`sha256:3007729eb192341a4f004a88e42e1e66c94fc67d763acfc96568bd7311116018`
的结果分别保留，不将两种镜像混作一次检查。

- 原 `Db::open_dm` 实际建立双人 private DM，作者与另一成员为参与者，CONTROL
  不在参与者中。新 settlement 消费者 4 项通过，覆盖独立 owner 证明、两份重放、
  软删除、旧 epoch、禁用实际 trigger 的 NIP-11、待 writer 期间撤员后的拒绝。
- Relay all-target Clippy `-D warnings`、前后 rustfmt、原恢复脚本 Bash 语法
  全部退出 0；原治理消费者 8 项通过。Clippy 检出的既有孤立 doc 注释与四处
  等价布尔表达式已修正，没有放宽 owner、TTL 或准入。
- 实际移除当前 owner attestor 检查，原合法 admin 的证明被错误接受，原断言以
  200 不等于 404 失败 101；逐字恢复后该原消费者通过。随后仅移除查证后的成员
  复核，真实待锁撤员消费者同样以 200 不等于 404 失败 101；逐字恢复后原
  delivery/observation/settlement **16/16** 全部通过。上述 4 项已包含在 16 项中。
- 3,115 个固定归档输入在执行和故障恢复后与 GitHub 原对象逐字相同。最终 SDK
  未 OOM，全部六批容器和独立网络实际清理回读均为空。

原始回执为[六批固定来源与失败记录](publication-settlement-receipt.json)，SHA-256
`f0b0819d37888b7b4e48324a55edd148daeb441fb67deca925fea603c347847d`。
CI 原件位于
`/volumes/data/kailo/verification/phase1-integration/settlement-1fde2756a-data-check-receipt.json`。
首批旧并发 fixture 在 INSERT 后持 Community 行锁、又等待自身才能释放的 Host
更新，实际锁链已保存，明确终止为 137，非 OOM；现暂停在同一原事件屏障的 INSERT
之前验证范围漂移，真实 INSERT 的提交/回滚及私聊撤员消费者保持。另两批格式失败、
原 SDK 的 ENOSPC 和最终修正前五项 Clippy 错误均保留为失败，不改写为通过。
现存 check-cache 实际绑定 NVMe；最终只把本批 target 复制至真实 Data 专属目录，
原共享缓存和 mount 未修改或重置，TMPDIR 也位于该 Data 目录。

这是 Relay/DB 原接缝与隔离消费者验收。Core 新签名范围、永久审计证明及跨 epoch
重试/保留期清理、Native 新 epoch 生产消费仍按各自固定后继候选验证，不由本批
代替。恢复脚本仅检查语法，未执行真实恢复；没有最新全工程 full、正式制品、部署
或三端实际业务验收，不宣称整个 DD-81 已完成。

该原回执 SHA-256 为
`c8b371317f8c83a42b8912480d89b98fdfac41cfe9a89e55ea19cf1390680a30`，
CI 在
`/volumes/data/kailo/verification/phase1-integration/observation-85c26ebcd-check/receipt.json`，
原字节元数据与日志摘要已加入上面的 writer 回执集合。上述仍是固定原消费者与
数据库证据，不代表真实三账号、Core→Relay 部署全链或完整权威缺失证明。

## 2026-10-27：Core 普通发布权威缺失证据与恢复隔离

固定产品源码 `1894d2784fdd4272a0caaaea746e77ea0389ce5b`，先行设计为 `design-authority@3635890d5fde0dad94ec29e0c1f49d99ae67dd09`。本批接续上面的肯定观察，不把旧普通查询为空的历史 NOT_DELIVERED 改写成新通过记录。

### 原消费者与持久事实

- 新普通发布只对共享 `publication_max_age_seconds` 支持的实际 kind 读取原可信 NIP-11 ready policy，再由原作者将唯一 epoch tag 加入最终事件签名；保留实际 created_at、正文及全部原生 tags，包括合法 self-p。原 DISPATCH 短事务同时冻结已有八项范围与可选 publication 时间/非过期/policy；不存正文、tags、凭据或签名。未支持、可替换、不存储的种类保持原签名行为和 publication 缺省，不强加新 policy 依赖。
- 原对账先查肯定观察，严格经过实际事件的共享时间窗后，才以原 HUMAN 或 ACTIVE Installation 的原 AGENT 作者及当前 Tenant CONTROL 双 NIP-98 请求 `/events/settlement`。两份证明绑定同一 URL、方法、正文和 Community；CONTROL 不替代原作者。响应逐项匹配冻结 claim，accepted 优先；否定必须同时满足 `!accepted && settled` 和完整时间/epoch 事实，拒绝或不可观察仍为 UNKNOWN。
- 新迁移 `20261101040000` 增加原审计可空 `publication_proof`，窄 append 入口在原 RECONCILIATION 同事务保存封闭 scope/settlement 元数据，并锁定当前授权与绑定。EvidenceRef 仍只存稳定引用。数据库约束拒绝缺项、额外字段、早于窗口、错 epoch/scope/kind 或有过期语义的否定证明；已有 proof 时 down 明确拒绝。
- 重签必须重新读取当前可信 policy 并匹配原证明 epoch 与全部绑定；恢复轮换 epoch 后原 proof 仍是不可改写的历史事实，不能单凭 JSON 合法性重签。原 pending 游标继续公平遍历这类操作，metrics 仅扣除本轮实际确证的范围。过期清理只接受该游标批次中再次实际观察 policy/scope/settlement 的操作；无观察保留原同键槽，避免清槽后绕过恢复隔离。原槽合法过期或被后继尝试替换后，只从原不可变 proof 恢复原范围，继续允许旧事件的肯定纠正，不从新 Host 补造范围。

### 实际定向验证

源码从 GitHub 固定对象导出，沿原 SDK `sha256:3007729eb192341a4f004a88e42e1e66c94fc67d763acfc96568bd7311116018`，SDK 4 CPU / 16 GiB、私有 PostgreSQL 1 CPU / 2 GiB，memory 与 swap 同限。发现旧 `/volumes/data/kailo/check-cache` 实为 NVMe 根盘 bind 后，只读复制原 Core target 至真实 `/dev/sda1` Data 专属目录，原缓存不改；target 与 TMPDIR 均使用真实 Data，没有安装新 Rustup 工具链。

| 原消费者/门禁 | 实际结果 |
|---|---|
| bridge scoped publication | 5/5，真实 HTTP fixture 验证 policy、双签名、严格返回值及保留原 tags |
| BFF scope/history | 6/6，包含真实 PG 同事务冻结 publication、授权失效与旧历史边界 |
| 重签 epoch 隔离 | 1/1，恢复 epoch 或绑定变化都拒绝原否定证明授权的新签名 |
| 原 reconciliation | 4/4，包含真实 PG 审计 append、不可变证据、pending/metrics/reaper；两天前的过期记录在缺当前确证时保留同键槽，fresh 集合才允许原 TTL 清理 |
| 迁移与静态检查 | 完整 up、新迁移空库 down/up、相关 all-target Clippy `-D warnings`、四个 Rust 文件的原 rustfmt 均退出 0；已有 proof 的 down 在实际 PG 被拒绝 |

五次故障只在 CI 私有导出发生：去掉 self-p 保留、破坏 CONTROL attestation header、绕过重签的当前 epoch 比较、使原 audit append 丢失 proof、绕过 reaper 的本轮确证集合。五项均由原消费者断言发现并退出 101；最后一项实际检出原同键槽被错误删除。逐字恢复后 HTTP 5 项、reconcile 4 项与重签 1 项再次通过，最终格式通过；四个 Rust 文件与两个迁移均与固定 GitHub blob 逐字相同。SDK 无 OOM，SDK/PG/私有网络已清理并回读为空，未启停共享服务。

原回执位于 CI `/volumes/data/kailo/verification/buzz-r10/publication-negative-1894d2784fdd4272a0caaaea746e77ea0389ce5b-r2-data/receipt.json`，SHA-256 为 `7b6efc9bd58c761f7fea2471911ffce830d6fc265ac187ba18e89f1ca592fa3c`，保存各阶段退出码、断言结果、实际限额与日志摘要。前置固定 `5d6195a97` 的 16 项和迁移已通过，但 Clippy 的 nonminimal_bool 失败，原日志保留；修复后才取得本节完整结果。一次 formatter 命令误抄完整 SHA，在 Git 对象核对时早停，未执行 SDK；使用实际对象 SHA 后格式检查通过，不计作消费者失败或通过。

本批是原 bridge HTTP fixture 与实际 PostgreSQL 消费者证据，不是已部署 Core→Relay 全链验收；未运行新的全工程 full、发布、部署或真实三端操作。历史缺元数据、unsupported/replaceable/nonstored kind 的否定结论仍 UNKNOWN，不宣称完整 DD-81 全部完成。固定 1894 不包含随后合入的新 NativeFacts 字段及 `native.rs` policy producer；其最终集成编译必须另记，不能借本批结果外推。
