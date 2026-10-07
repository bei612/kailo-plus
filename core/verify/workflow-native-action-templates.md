# 原工作流主题与回应模板执行恢复

2026-10-07；源码与窄验证回执，不是完整 Workflows、发布或三端验收。

## 四步影响结论

1. 权威：REQ-23/24、`.design/06` §9/9.1。固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的 `crates/buzz-workflow/src/executor.rs::resolve_step_templates` 明确对 `SetChannelTopic.topic`、`AddReaction.emoji` 调用同一 `resolve_template`。原来的 Kailo `agent_task/post_message.rs::publish` 只对发送消息展开模板，另两个动作直接签配置字符串；这是缺失需恢复，不是新需求。复用已迁入 `collab-bridge/src/workflow_template.rs::resolve_template/TriggerContext` 的原解析实现，不启用上游第二执行引擎。
2. 影响面：既有 AutomationVersion 的冻结 steps/action → 原 AgentTaskWorkflow → Core `post_message::publish/native_template/render_native_content` → Buzz SDK 签名 → `reply_event_id`/DISPATCH 审计 → `reconcile_reply` → `reaction_matches/topic_matches` → 原 OpenMeter 计数与终态。源消息仍按已准入的 source ID、root、当前频道及 sourcePubkey 读取；不让正文指定身份、权限或目标。Web/Desktop 的共享原字段、BFF、Worker、契约、数据库结构和权限均未增加或替换。
3. 副作用：展开在冻结意图及唯一发送之前完成。重试沿既有 reply_event_id 查证，不重新读取可变源内容、不重展模板、不重发。回执不能再把已展开值与配置里的原模板字符串直接比较；模板动作改用已冻结事件 ID、原签名、AGENT、kind、频道/来源 tags 的共同证明，字面值仍精确比较。Nostr 0.44.8 `src/event/mod.rs::Event::verify/verify_with_ctx/verify_id` 会从 pubkey、时间、kind、tags、content 重算 ID 后校验签名，不是信任查询 JSON 的 id 字段。既有 `core/migrations/20261007090000_automation_topic.up.sql::catalog.guard_post_message` 禁止更改持久意图与 reply_event_id；未新增正文副本、hash 字段、审计账本或迁移。
4. 边界：空 topic 是原版清空操作；空/超长回应与非法模板 filter 在发送前拒绝为 `INVALID_PARAMETERS`，上限来自既有合同。缺源证据/依赖不明不发送，按原错误分类返回拒绝或 `UNKNOWN_EXTERNAL_RESULT`。源文本不递归求值，未知变量保留原模板行为。发送前继续复核权限、binding、计量和 Temporal Activity fence；发送后的撤权仍允许只读核验已经发生的副作用。并发 CAS、取消、配额与暂停机制未改；无法查证的签名事件不报告成功或失败，也不推进下一步。

## 兼容与范围

- 旧版本 action、配置 hash、post_message_intent 格式和 meter 格式不变；旧字面值及旧在途事件继续读取。新 Core 恢复模板语义后，旧 Core 会把展开结果与原模板比较并停在未知；运行中回退前必须停用受影响模板定义并确认在途已收敛，不允许旧 Core 接管未完成模板动作，更不能清掉 intent 重发。
- 这批恢复的是既有 topic/reaction 两个真实执行消费者，不等于七类动作全交付。`send_dm`、`call_webhook` 仍缺已治理的目标/工具绑定与完整执行接缝；topic/reaction 混合多副作用顺序、其他触发种类也不由本批宣称完成。现合同 emoji 字段本身仍有既定长度约束，因此超长模板表达式尚不等同上游任意表达式；本批不擅自放宽合同。
- 未改变或新造 UI，没有新翻译、入口或浏览器截图；无桌面、Mobile、真实 Relay/Temporal 端到端验收。本批从固定原源码定位并恢复缺项，但不是全 Workflows 差异清零的证明。

## 验证记录

复用 `kailo-agent-receipt-xvkujx` 的 `message-edit.AGX058/apps`，CPU 4 核、内存/交换总限额 8 GiB，运行前检查并发、宿主可用内存与磁盘；不建整树快照、不安装依赖、不全局构建。日志目录：`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/workflow-native-template.s3JDP1/`。

- 首次 `cargo test --offline --locked -j16 -p platform-core --bin platform-core agent_task::post_message::post_message_tests` 退出 101：并行 Projects 新调用为四参，私有旧 `projects.rs` 仅两参，`core.log` 保留原错误；只在私有输入隔离该队友变更后，`core-isolated.log` 为 5 passed、1 ignored（需要专用已迁移数据库）、364 filtered。随后队友统一同步 Projects 输入，联合验证作为最终口径；不把运行中被更新的输入当作最终固定证据。
- `cargo test --offline --locked -j16 -p collab-bridge --lib`：联合输入 `bridge-joint.log` 为 20 passed；增加同 ID 替换 topic tags 的断言后，最终 `bridge-restored.log` 仍 20 passed、0 failed。其中三项是同批 Projects 的原生构建检查，不记作新增工作流能力。
- 实现后私有快照故意让 topic/reaction 保留未展开字符串，`core-mutation.log` 为 4 passed、1 failed、1 ignored；断言明确得到 `{{trigger.author}}: {{trigger.text}}` 而非预期展开值。移除两处 `event.verify()` 后，`bridge-mutation.log` 抓到伪造 reaction 正文及同 ID 替换合法 topic tags；同次为 Projects 队友破坏 buzz-channel tag 的检查也失败，总计 17 passed、3 failed。没有破坏正式文件。
- 恢复三个文件后逐字 `cmp`，并 touch 私有输入避免 Cargo 复用旧 mtime：`core-restored.log` 为 5 passed、0 failed、1 ignored，`bridge-restored.log` 为 20 passed、0 failed。联合 `cargo test --offline --locked -j16 -p contracts --test roundtrip projects_publication` 1 passed、42 filtered，日志 `projects-roundtrip.log`，属于队友契约批次，不表示本批改了契约。
- `cargo clippy --offline --locked -j16 -p platform-core --bin platform-core -- -D warnings` 首轮 `clippy.log` 退出 101：抽出模板消费后嵌套 else/if 可折叠；已直接合并分支，不增加 allow 或绕过检查。
- 最终 `rustfmt --check --edition 2021 --config skip_children=true` 两个拥有文件退出 0；`clippy-final.log` 退出 0；另跑 `cargo clippy --offline --locked -j16 -p collab-bridge --lib -- -D warnings` 退出 0，`bridge-clippy.log`。同一固定输入再次运行上述 Core 窄测试，`core-final.log` 为 5 passed、0 failed、1 ignored。数据库 ignored 项没有执行，不计为通过。本批不另跑全局 `check.sh --full` 或发布，由主线在集中集成批次收口。
