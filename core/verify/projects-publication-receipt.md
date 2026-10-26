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
