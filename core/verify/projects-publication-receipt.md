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
