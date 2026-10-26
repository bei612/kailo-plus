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
