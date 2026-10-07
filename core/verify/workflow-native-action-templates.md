# 原工作流主题与回应模板执行恢复

2026-10-07；源码与窄验证回执，不是完整 Workflows、发布或三端验收。

## 四步影响结论

1. 权威：REQ-23/24、`.design/06` §9/9.1。固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的 `crates/buzz-workflow/src/executor.rs::resolve_step_templates` 明确对 `SetChannelTopic.topic`、`AddReaction.emoji` 调用同一 `resolve_template`。原来的 Kailo `agent_task/post_message.rs::publish` 只对发送消息展开模板，另两个动作直接签配置字符串；这是缺失需恢复，不是新需求。复用已迁入 `collaboration/crates/buzz-core/src/workflow_template.rs::resolve_template/TriggerContext`、由 `collab-bridge/src/lib.rs` 重导出的原解析实现，不启用上游第二执行引擎。
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

## 前序消息输出增量（2026-10-07）

1. 固定同一上游 `crates/buzz-workflow/src/executor.rs::dispatch_action` 的 SendMessage 真实返回 `{sent,event_id}`，后续 `execute_steps` 把它加入 step_outputs；`desktop/src/features/workflows/ui/workflowTemplateVariables.ts::workflowTemplateVariables` 提供原 Previous steps 菜单。此前 Core `native_template` 总给原解析器空 HashMap，导致实际已接通的多消息步骤无法消费前序结果。本批按原数据形状补齐消费者。SendDm 在固定 executor.rs:655–658 本身返回 NotImplemented；现 `.design/03` 自动化结果位置与 `.design/09` HUMAN 私聊投影不能证明任意 Agent 私聊已获准，因此没有制造 send_dm 按钮或绕过接缝。
2. 影响是原冻结 AutomationVersion → 原 AgentTaskWorkflow → 同 Invocation 的 automation_step_event_ids 与 `catalog.automation_step_accepted` → 前序消息输出 → 原模板解析器 → 同一签名/派发/对账链。只有全部前序消息已具有同 operation、actor、scope 的 ACCEPTED 正向审计才映射 `sent:true`，否则沿既有 UNKNOWN 停止，不凭数组中有 event_id 就冒充送达；既有 CAS 与数据库 append-only guard 仍在派发前重验。无新表、状态、正文、契约、计量或第二工作流权威，Worker 执行历史不变。
3. Web/Desktop 仍共用原模板控件；只给当前步骤传入其前序步骤，恢复原分组及 sent/event_id 两个真实输出。原 `workflowFormTypes.ts::nextStepId` 迁入共享 workflow-steps，替换错误使用请求 UUID 的步骤 ID，让默认 step_1/step_2 可被原变量选择器识别；正常编号保持原样，对用户自定义非安全整数后缀忽略、max+1 溢出时从 1 找空位，避免原 Number 不再递增导致循环卡死，不扩大或限制合同。Action idempotencyKey 不变，旧已冻结步骤 ID 不迁移、不改写。delay/webhook/reaction 结果没有已接通消费者，因此不虚构这些变量。中英追加三个同源词条，无新页面或布局。
4. 没有前序事件则输出为空；无 ACK 的前序事件不能暴露输出；未知或未来变量保留原解析器字面量语义，不生成结果，也不递归求值。取消、在途撤权、Tenant 暂停、额度和结果不明仍在原 Activity fence/准入/对账路径处理。重试不重算已派发的消息。旧 Core 会将新使用的前序模板作为字面值发送，因此有此模板的启用定义/在途执行必须停用并收敛后才能回退旧 Core；不能把无 schema 变化说成执行语义完全兼容。

这批实现后沿同一受限 SDK 窄验证。运行前无并发 Cargo、20 GiB 宿主可用内存、Data 3.4 GiB 空闲；不建整树快照、不联网安装。日志沿上述目录：

- `prior-message-output-core.log`：原 Core post_message_tests 6 passed、0 failed、1 ignored（需要专用迁移数据库）、364 filtered。
- `prior-message-output-type-final.log`：共享 `tsc --noEmit -p tsconfig.test.json` 退出 0；`prior-message-output-ui-final.log`：原 workflow-template 与 workflow-actions 33 passed，含真实编辑表单→前序变量选择→YAML→既有治理请求，以及中文/英文、默认步骤 ID。
- 私有输入故意关闭前序 ACCEPTED 检查，`prior-message-output-core-mutation.log`：新增消费者检查 0 passed、1 failed，退出 101，确认缺 ACK 不能被当作输出；正式文件未破坏。
- 私有共享 agents.tsx 断开 previousSteps 传递，`prior-message-output-ui-mutation.log`：26 passed、1 failed，真实编辑表单无法选择前序输出时原断言失败，退出 1。恢复原字节后 `prior-message-output-ui-restored.log`：33 passed，退出 0。
- 恢复 Core 原字节并 touch 私有输入后 `prior-message-output-core-restored.log`：6 passed、0 failed、1 ignored，退出 0；`prior-message-output-core-clippy.log`：原 `cargo clippy --offline --locked -j16 -p platform-core --bin platform-core -- -D warnings` 退出 0。正式 Core 输入与已验证快照 cmp 退出 0。
- 步骤编号数字边界补齐后 `prior-message-output-safe-id.log`：34 passed；私有输入移除溢出后从 1 找空位的逻辑，`prior-message-output-safe-id-mutation.log`：6 passed、1 failed，退出 1，证明极大后缀检查实际生效。共享 SDK 与 Projects 队友变异时段有交错，`prior-message-output-safe-id-type.log` 虽退出 0，不作为最终联合输入的类型证据。
- 步骤编号恢复并 cmp 退出 0 后，`prior-message-output-safe-id-restored.log` 为 7 passed；Projects 私有输入也恢复后再运行共享类型检查，`prior-message-output-type-restored-final.log` 退出 0。新增三个 i18n 词条的 Dart 同源生成由主线与同批其他词条集中完成，不把此处 TypeScript 通过视为生成已完成。

未运行真实 Temporal/Relay/数据库端到端协作、浏览器截图、Windows/Mobile 或全量检查，不据以上局部结果声称全 Workflows 恢复或已发布。
