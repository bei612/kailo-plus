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

## 原卡片启停与步骤栈恢复（2026-10-07）

1. 权威与差异：按固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的完整 `desktop/src/features/workflows` 文件清单定位共享迁移；本批实际逐行恢复的是 `desktop/src/features/workflows/ui/WorkflowCard.tsx::StatusToggle/ActionTile/ActionTileStack`、`desktop/src/features/workflows/ui/workflowDefinition.ts::getWorkflowActionTiles` 与 `desktop/src/features/workflows/ui/WorkflowActionsMenu.tsx::WorkflowActionsMenu`。此前卡片把原 Switch 删为 Badge、把所有原生步骤都画为消息图标，属于缺失需恢复；现在迁入共享 `workflow-card-actions.tsx`，原尺寸、颜色、前三步反向叠层、reduced-motion 与运行意图动画保留。此记录不把文件清单检索等同于整个 Workflows 已逐行归类或完全恢复。
2. 影响面：有权读取的同一 AutomationVersionContent → 原动作栈；卡片 Switch → `AutomationCard.openAction` fresh detail/版本/权限复核 → `AutomationAction` 原显式版本与委托选择/确认 → BFF `automation.enable/disable` → 既有 `automation.rs::management_prewrite/management_dispatch` 与 Temporal 管理链。没有新执行器、合同、状态、迁移、权限或服务端修改；继承的 temporal 文件不属于本批。原 menu `showEnabledToggle=false` 消除卡片重复开关，不删除详情的既有管理操作。
3. 副作用与授权差异：只读图标不触发动作，运行动画表示用户意图而非成功；开关不乐观翻转，不直接写原版本地定义。保留设计 `06` §9.1 要求的 owner/pin/executor/版本等治理元数据，真实 PAUSED/DISABLED/DRAFT 状态也在该区可见，不以一个关闭开关混淆。原 top-right 只恢复原 Switch 与 menu；这些元数据及显式治理确认是明确接入差异，不宣称整卡与官方无差异。回应图片沿现有已鉴权 customEmoji/mediaPaths 消费，不从原始 Relay URL 绕过身份或读未授权正文。
4. 边界：读取失败、无管理权、缺发布版本或有效委托时不能开启；启停前重新读取，撤权/版本变化拒绝打开提交。请求进行中锁定入口，Workspace/版本切换丢弃迟到读取；服务端重验、审批、quota、幂等与在途终态机制不变。UNKNOWN 返回仍保留原状态和待查证操作，既不成功也不失败。未知动作合同仍 fail closed，未开放 send_dm/call_webhook，也未伪造运行轨迹。Web/Desktop 共用此实现；Mobile 没有新增宿主页面，两个中英 aria 词条按原生成器同步 Dart。

验证使用既有 `/evidence/message-edit.AGX058/apps` 受限 SDK（4 CPU/8 GiB），执行前无并发编译、宿主可用内存 31 GiB、Data 空闲 3.3 GiB；不新建快照、不编 Rust、不下载。日志目录同上，命令为原 `tools/gen-platform-i18n.py` / `--check`、共享 `tsc --noEmit -p tsconfig.test.json`、`vitest run test/workflow-actions.test.tsx test/workflow-template.test.tsx`。

- 首轮 `card-toggle-final.log`：生成与 check/type 均通过，29 passed/1 failed；失败是旧断言仍查询 menuitemcheckbox（`expected undefined to be 'true'`）。已按固定原卡片 Switch 位置改断言，`card-toggle-restored.log` 37 passed。
- 私有 `workflow-card-actions.tsx` 故意断开开关回调、把前三步改为四步，`card-toggle-mutation.log` 27 passed/3 failed，退出 1；确认启停真实消费者与原叠层上限能抓到破坏。恢复正式字节并 cmp 后，`card-toggle-final-restored.log` check/type 退出 0、37 passed。
- 可见状态复核最初把模态框对背景的 `aria-hidden` 误当成视觉隐藏，`card-toggle-visible-state.log` 36 passed/1 failed（`expected <div data-aria-hidden="true" …> to be null`）；改为检查视觉隐藏 `.sr-only/[hidden]`，不放宽产品语义。私有输入把真实状态改为 sr-only，`card-state-mutation.log` 1 failed/29 skipped，退出 1。还原后 `card-final.log` 最终 type 退出 0、37 passed，退出 0；六个产品/检查输入与正式文件 cmp 全部退出 0，`git diff --check` 退出 0。

本批没有浏览器截图、真实 Temporal/Relay/数据库启停、Windows/Mobile 设备或全量检查；不据 jsdom 操作与类型通过声称发布、全量 diff 完成或生产验收。

## 原末步与唯一步骤删除恢复（2026-10-07）

1. 权威：固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的 `desktop/src/features/workflows/ui/WorkflowFormBuilder.tsx::removeStep` 对任一步执行 filter 删除，`desktop/src/features/workflows/ui/WorkflowStepCard.tsx::WorkflowStepCard` 提供原删除控件。共享表单却只给非末步传入 onRemove，使末步/唯一副作用无法删除；该限制不是 Temporal 治理要求。本批补齐该实际编辑链，不增按钮样式、不扩大动作合同。
2. 影响：共享 AutomationAction 的 steps 草稿 → 原删除 → 表单/YAML 同一内容 → 原 `automation.publish_version` → 不变的 Core `automation.rs::management_content` / `automation/steps.rs::supported` → 原冻结版本及 Temporal 执行。删除会同步现存末步的模板或清空，避免 steps 为空后 legacy action 分支重新使用被删副作用的缓存文本。未删除步骤保持原顺序和 ID，不重编号或重写模板引用；旧已发布版本/配置 digest 不变，修改仍生成新版本。
3. 副作用：删除是未提交草稿变化，不立即取消运行、发事件或清除历史。删空/尾部仅延时等不完整配置可以暂存于当前编辑器并原样往返 YAML，但不能通过内容校验/Review 发布；用户显式输入或添加新的有效动作后，才沿原确认与治理链提交。已确认/UNKNOWN 操作仍冻结，不因编辑草稿重发。权限、scope、绑定、审批、quota 与结果对账没有新旁路或权威副本。
4. 边界：单消息、多个消息及中间延时、唯一回应/主题均可删除；删除后切换为另一已准入动作不保留旧正文。顺序与末步限制继续由现有 shared supportedSteps 与 Core 校验：format 2 的前置延时/审批加末个消息/回应/主题，format 3 的有序多消息/延时及首个副作用前审批；不将删除能力说成七动作任意混排、逐步骤超时或全量原 FormBuilder 恢复。未知/未来步骤引用沿原模板解析语义，不因删除自动映射到其他步骤。三端合同未改，Web/Desktop 继续同一表单，Mobile 无新增页面。

验证在既有 SDK 4 CPU/8 GiB 中运行，开始前无并发编译、宿主 available 23 GiB、Data 3.3 GiB，不创建快照、不编 Rust、不改 i18n。沿上述日志目录：`remove-step-initial.log` type 退出 0、39 passed/1 failed，原文 `No QueryClient set, use QueryClientProvider to set one`；新增回应卡片场景使最小测试宿主首次读取表情缓存。核实 Web `web-client/web/src/main.tsx` 与 Desktop `collaboration/desktop/src/app/App.tsx` 实际均提供 QueryClientProvider 后，仅将测试宿主接入同一 Provider，不给产品添加另一缓存。`remove-step-consumer.log` 40 passed，退出 0。私有输入故意不在删空时清空模板，`remove-step-mutation.log` 30 passed/3 failed，退出 1，证明旧副作用复活会被三个实际编辑场景捕获；正式源码未破坏，还原并 cmp 退出 0。

最终 `remove-step-final.log` 的共享 `tsc --noEmit -p tsconfig.test.json` 与 `vitest run test/workflow-actions.test.tsx test/workflow-template.test.tsx` 均退出 0，40 passed（33 actions + 7 template）；产品/检查输入与正式文件 cmp、`git diff --check` 均退出 0。

此批只交付删除→空/部分草稿→重新添加→表单/YAML→治理请求的消费者恢复；没有真实 Temporal/Relay、数据库、Playwright 页面截图、Windows/Mobile 或发布验证。完整上游模块仍有未恢复项，不能称完整还原。

## 原未保存变更确认恢复（2026-10-07）

1. 权威：固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的 `desktop/src/features/workflows/ui/WorkflowDialog.tsx::WorkflowDialog/handleOpenChange/closeDialog` 提供 dirty 判别、Keep editing/Discard changes 确认与 beforeunload 提醒。原共享 AutomationAction 的 X/Escape 无条件关闭，遗漏真实未保存交互。本批直接迁入该确认，使用 `desktop/src/shared/ui/alert-dialog.tsx::AlertDialogContent/AlertDialogHeader/AlertDialogFooter/AlertDialogTitle/AlertDialogDescription` 的原默认面板、布局和已共享 modal motion/backdrop；未迁入无调用方的 textured API。
2. 影响：同一 AutomationAction 的初始化后的 typed form/raw YAML 草稿 → dirty 判断 → 原确认 → 保留或明确丢弃。创建窗口再次打开也执行原初始化，避免同一 edit=null 时复用已被丢弃的草稿；未改变冻结版本、发布动作、BFF、Core/Worker、Temporal、合同、数据库或执行权限。初始比较在原字段初始化批次后建立，不把异步读取到的审批/Installation 元数据当作用户修改；只切换表单/YAML而不改内容不弹确认。未完成/非法 YAML 原文同样受保护。
3. 副作用：Keep editing 不关闭、不写入；Discard changes 只关闭未确认草稿，下次从原可读版本重新初始化。已有 intent/busy/UNKNOWN 始终不能通过该确认丢弃，仍按同一 idempotencyKey 重查；确认/提交后的状态恢复沿既有权威。dirty 或已冻结请求注册 beforeunload，让浏览器按自身规则提示；干净关闭/明确丢弃后解除。没有新增持久草稿正文、第二工作流或账本。
4. 边界：本批覆盖同源弹窗 X/Escape、继续编辑、明确丢弃、创建重开与 beforeunload handler；没有声称补齐原 TanStack 路由 blocker、Web/Desktop 全局菜单跳转或 Windows 原生关窗确认。两宿主路由接缝仍须分别验收，浏览器是否展示 beforeunload 提示取决于其策略与用户激活；jsdom event.defaultPrevented 不等于真实浏览器截图证据。原四个文案中英同源，Dart 生成与同批快捷操作词条一并完成，不混写 settings 实现。

既有 SDK 4 CPU/8 GiB，开始前无编译，宿主 available 32 GiB、Data 3.3 GiB；不下载、不建快照、不编 Rust。`discard-initial.log` 原 i18n 生成/check 通过，type 退出 2：私有快照旧 `settings.tsx:68` 仍引用已删除 `platform.settings.deviceAppearance`。经 settings 负责人确认，将其正式 settings.tsx 同步到验证输入，不修改产品迁就旧词条；`discard-consumer.log` 44 passed。追加创建重开场景后，私有输入故意绕过 requestClose 的 dirty 确认，`discard-mutation.log` 35 passed/3 failed，退出 1；正式输入未破坏，恢复后 cmp 退出 0。

`discard-final.log` 的生成 check 通过，type 退出 2，原文 `Module '"./settings"' has no exported member 'ThemeModeControl'`（旧 theme-settings-controls/settings.test 两处，另一个旧回调隐式 any）。经 settings 负责人确认，仅同步其正式 theme-settings-controls.tsx、settings.test.tsx、appearance-settings.tsx 对应输入，不更改产品或另建快照。最终 `discard-restored-final.log` 的 `python3 tools/gen-platform-i18n.py --check`、`tsc --noEmit -p tsconfig.test.json`、`vitest run test/workflow-actions.test.tsx test/workflow-template.test.tsx` 均退出 0，45 passed（38 actions + 7 template）。本批产品与测试输入恢复到正式字节，本批路径 `git diff --check` 退出 0；全工作区检查另报告 4 个非本批 emoji/messages 文件的 EOF 空行，不混入此批修复。Dart 包含本批 4 个确认词条和同批 settings 6 个快捷操作词条，统一生成而非手写第二翻译源。

未运行真实浏览器页面截图、Windows/Mobile 或发布验收，不据此宣称全量 Workflows 或全部导航保护已恢复。

## 原工作流路由离开保护恢复（2026-10-07）

1. 权威：REQ-24、DD-74/75、`.design/06-Temporal任务工作台.md` §9.1；固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的 `desktop/src/features/workflows/ui/WorkflowDialog.tsx::WorkflowDialog` 使用原 TanStack `useBlocker` 的 resolver，保留编辑时 reset、明确丢弃时 proceed。本批补齐上一节已明确的真实宿主路由接缝，不改原确认布局、不建立第二路由或工作流引擎。
2. 影响：共享 `AutomationAction` 草稿/冻结意图 → 宿主 `useBlocker` → 同一 `WorkflowDiscardDialog`。Web `web-client/web/src/platform/ui/PlatformApp.tsx::SignedIn` 的导航沿 `web-client/web/src/app/platform-navigation.ts::usePlatformNavigation`，Desktop `collaboration/desktop/src/app/routes/platform.$section.tsx::PlatformRouteComponent` 的导航沿原 `collaboration/desktop/src/app/navigation/useAppNavigation.ts::useAppNavigation`；两侧复用原 Router/History，只持共享编辑状态与 resolver，产品 UI 和判断不分别复制。原 workspace 下拉立即清 edit/open 会在路由被拒后丢草稿，已改为仅在已接受 selection 改变时收尾，不把目录加载期间短暂无 row 当作离开。
3. 副作用：Keep editing 取消原导航并保留 workspace、原始表单/YAML；Discard changes 继续原被阻导航，不创建另一跳转。已 Review 的 intent、busy 和 UNKNOWN 均不提供可丢弃确认，阻止导航但保留当前原动作与同一 idempotencyKey 的查询；拒绝导航不是动作失败。守卫卸载时清理宿主状态，干净页面可正常切换，没有新增持久正文、Core/Worker 写入、schema 或权限。
4. 边界：原 pane-only 例外保留，但只有其他 search 字段完全不变才成立，不能同时更换 workspace/protocol scope 来避开保护。内部链接、菜单/快捷键所调用的同一 Router、workspace search 和历史前进后退均消费 blocker；外部整页离开仍沿上一节 beforeunload，窗口关闭提示服从宿主策略。Mobile 不承载定义编辑；无新增 Mobile 入口。native 设备退出、浏览器进程崩溃、SSO 强制失效并非可被此路由守卫阻止的正常导航，不宣称已有设备验收。

验证沿既有 `message-edit.AGX058/apps` 的 4 CPU/8 GiB SDK，开始前无编译，available 30 GiB、Data 3.3 GiB，无新快照、依赖下载、Rust 或镜像构建。日志沿本文件前述 `workflow-native-template.s3JDP1` 目录：

- `route-initial.log` type 退出 2：两 host 的 npm file 依赖为旧拷贝，报 `has no exported member 'workflowBlocksNavigation'` 与两个已提交快捷键模块缺失；仅同步当前共享包输入至原验证副本。另一个测试的 literal `/audit` 不匹配已注册路由类型，改用注册路由参数。`route-consumer.log`、`route-final-types.log` 则分别是旧 SettingsPane/SettingsPane.test 消费已删除词条和 WorkspaceNotifications，精确同步已提交对应文件，不改正式产品迁就 SDK。
- `route-runtime.log` 13 passed/14 failed、`route-consumer-fixed.log` 20 passed/7 failed：新场景误用 Create workflow 文本查找原只有图标的 Create automation 卡片，改为真实原卡片定位；既有 SSR 隔离壳增加 create-channel-dialog 和 router mock，真实路由场景不 mock router 或 Workflows。
- `route-observed.log` 3 passed/5 failed：取消导航后错误等待未完成 navigate promise、遗漏 Tasks 读取夹具，以及 MemoryHistory 后退未进入 blocker。按已锁定 TanStack 源码，MemoryHistory 的 POP 不调用 blocker；改用 Web 实际 `createBrowserHistory`、Desktop 实际 `createHashHistory` 验证前进后退，不改产品或模拟出假的 POP 拦截。`route-browser-consumer.log` 8 passed；补齐 HashHistory 场景后 `route-joint-final.log` Web 类型通过、28 passed（9 路由 + 9 原导航 + 10 SSR 壳）、共享类型通过且 45 passed；随后 Desktop 启动器因私有旧 pnpm compiler 路径不存在退出 1。
- `route-desktop-type.log` 用同 SDK 既有 profile 编译器读取此快照，type 退出 2：本批用默认参数组件的 ComponentProps 推导属性时漏掉 undefined，已改为明确共享 WorkflowNavigation 类型；另一个旧 ProjectsScreen 四参调用按正式五参源码同步，未修改 Projects 产品代码。
- 实现后仅在私有 Web file 依赖把 `workflowBlocksNavigation` 改为恒 false，`route-mutation.log` 9 failed、退出 1；scope、UNKNOWN、实际 Browser/HashHistory 后退等真实消费者均捕获旁路。正式源码没有被破坏，还原私有文件后与正式 cmp 退出 0。

最终 `route-restored-final.log` 串行执行下列命令，全部退出 0：Web `./node_modules/.bin/tsc --noEmit`；`vitest run src/app/workflow-navigation.test.tsx src/platform/ui/PlatformApp.test.tsx src/app/platform-navigation.test.tsx` 为 28 passed；共享 `tsc --noEmit -p tsconfig.test.json` 与 `vitest run test/workflow-actions.test.tsx test/workflow-template.test.tsx` 为 45 passed；Desktop 在该快照工作目录复用 `/evidence/profile-settings-ortsoo.DRR20F/apps/collaboration/desktop/node_modules/.bin/tsc --noEmit`。7 个源码/检查输入与正式文件 cmp 全部退出 0，本批路径 `git diff --check` 退出 0。没有修改 package exports、i18n、依赖锁或生成契约。

上述 Router/History + 共享页面场景在 jsdom 实际运行，不等于 Windows 安装包、真实浏览器截图或全页面视觉验收；浏览器 popstate 异步回调产生的 React act 提示保留于日志，没有屏蔽。全量检查、部署与安装包不属于本批验证，不宣称 Workflows 全量原版恢复。

## 原手动触发到运行历史定位恢复（2026-10-07）

1. 权威：REQ-24、DD-74/75、`.design/06-Temporal任务工作台.md` §9.1。固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的 `desktop/src/features/workflows/ui/WorkflowDetailPanel.tsx::WorkflowDetailPanel/handleTrigger` 消费返回的 runId，自动选择真实历史，未读到时保留原待持久轨迹提示。本批恢复这条已缺失的交互，不恢复原执行引擎；原提示布局保留，文案授权改为“请求已记录”而非“运行已创建”，防止准入回执冒充业务完成。
2. 影响：`client-kit/ts/platform/src/react/agents.tsx::AutomationAction/AutomationManagement/AutomationList` → `client-kit/ts/platform/src/react/workflows.tsx::WorkflowsPage/AutomationRunHistory` → 既有 `WorkflowRunTrace/TaskDetail`。提交仍是同一 `automation.run`；仅已校验 ALLOWED/DISPATCHED 的 ActionSubmission 携带冻结 resource/workspace 和执行引用定位原历史。Core `core/crates/platform-core/src/automation_query.rs::run_query` 仍为当前本人、scope、原根 ActionExecution 的授权读模型；没有修改 schema、Core、Worker 或存储正文。两端共用相同生产组件，Mobile 不新增运行控制。
3. 副作用：UNKNOWN/EVALUATING/尚未派发保留原意图与幂等键，不关闭编辑器或虚构运行。确定拒绝不显示 run-created 等待提示，原因仍可见；原查询包含拒绝的根动作，但这不表示 Temporal 已运行。空历史暂保留已有回执和对账提示，只刷新原读路径，不重发。相同 execution ID 却不同 operation 的投影拒绝展示，不以 ID 单字段匹配接入另一动作。投影自己的 UNKNOWN 优先于矛盾 COMPLETED，沿既有 taskPhase 显示真实不确定状态。
4. 边界：切换已接受的 workspace 清除旧详情/运行定位；事后交互检查发现原已确认回执在关闭 dialog 后仍跨 scope 遗留，现随 scope 清理，但冻结不确定意图不清除。关闭再打开详情仍查授权数据，读拒绝/不可用不视为空历史。前端新增状态只为当前页面的定位引用，不是新运行权威；撤权后由现有 BFF 拒绝读取。没有新增重跑、取消、权限或任意步骤轨迹能力。

本批对照固定原 workflow 模块目录及上述详情、运行轨迹、触发消费者，差异归类：已有列表/运行卡片/轨迹样式继续共享迁移；原 runId 自动定位与等待区由本批恢复；原 Relay run/approvals 查询替换为既有 ActionSubmission/AutomationRunPage/Tasks 属已授权治理改造。原完整 Definition 展示、表单画布及任意步骤 trace 等其余差异仍未全量闭合，本批不宣称整个模块 100% 还原。

验证复用已有 `message-edit.AGX058/apps`，Docker `kailo-agent-receipt-xvkujx` 实查 4 CPU/8 GiB；运行前无编译，宿主 available 30 GiB、Data 3.3 GiB。没有新快照、安装依赖、Rust/镜像构建。以下日志均在 `/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/workflow-native-template.s3JDP1/`：

- `run-history-initial.log`：shared tsc 退出 0，48 passed/3 failed；两个断言误用旧英文和 alert（未知读取的原组件实际为 status），一个捕获上述旧回执跨 scope 问题。修实现及断言后 `run-history-fixed.log` 为 50 passed/1 failed，余下一项是 `Could not load` 与实际 `Couldn't load this` 文案不匹配；没有修改产品文案迁就检查。
- `run-history-consumer.log`：新增 8 项实际共享页面消费者全部通过。覆盖触发→对应运行→原任务读取、缺投影→刷新、同意图 UNKNOWN 重试、错 operation 拒绝、矛盾终态、scope 清理、明确拒绝、中英等待提示。
- `run-history-mutation.log`：只在私有 SDK 输入删除自动选择和 operation 核对，真实 5 failed/3 passed、退出 1；恢复正式字节后 cmp 退出 0。正式产品未被破坏。
- `run-history-restored-final.log`：`tsc --noEmit -p tsconfig.test.json`、`vitest run test/workflow-run-history.test.tsx test/workflow-actions.test.tsx test/workflow-template.test.tsx` 全部退出 0，53 passed（8 新历史 + 38 原动作 + 7 原模板）；生产两文件与新检查文件的 SDK 输入 cmp 均退出 0，本批 `git diff --check` 退出 0。`workflows.runRecorded` 中英源词条由主线合入，同源 Dart 生成由主线集中完成，不手写另一个翻译源。

源码与 jsdom 交互检查不等于实际浏览器截图、Windows/Mobile 或 Temporal 线上业务验收。本批未部署、未打包、未运行 full；两宿主集中候选类型及词条生成结果以主线记录为准，不将历史已有通过冒充本批执行。

## 原 Definition 完整展示与固定版本编辑恢复（2026-10-07）

1. 权威：REQ-24、DD-74/75、`.design/06-Temporal任务工作台.md` §9.1。固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的 `desktop/src/features/workflows/ui/WorkflowDetailPanel.tsx::WorkflowDetailPanel` 在详情中以原 h4/pre 和 `JSON.stringify(workflow.definition, null, 2)` 展示完整定义。本批直接保留该标题/JSON 结构及全部原 class，而不是再造摘要表单或执行引擎。
2. 影响：`client-kit/ts/platform/src/react/agents.tsx::AutomationDetail` 已有授权 AutomationDetailView → 精确 pinnedVersionAssetId 对应的 AutomationVersion → 同一标题、完整 Definition 和原编辑入口。此前标题取 pin、编辑隐式取 versions[0]，在新发布版本尚未启用时会编辑错配置。现编辑与既有复制沿同一 fresh reader，明确传回同一个 Asset 的完整 content；副作用仍由原 AutomationAction 发布新版本完成。Web/Desktop 共源，合同、Core/Worker、持久正文及权限权威未改变。
3. 副作用：查看只消费已授权的完整配置，没有新写请求、复制账号、浏览器直接执行或 HTML 注入（React 文本显示）。已有管理权只控制入口，打开编辑前仍查 fresh canManage 与 resourceVersion；权限撤销、版本前进、Asset 消失均不打开旧配置。原复制保持读取来源后进入独立创建语义，不复制 pin 或授权。
4. 边界：有 pin 时绝不替换为最新版本；当前授权分页缺 pin，原标题显示不可用、完整 Definition 不渲染、编辑禁用，沿既有版本分页找到 pin 后恢复，不增加上游没有的选择器。无 pin 的 DRAFT 沿原最新可读版本显示与编辑，不编造执行 pin。JSON 保留已合同化全部字段，包括 filter、多步、模板及空值，不限于摘要中原本可见的少量字段；未知合同字段仍由既有有效性校验拒绝。Mobile 不增加编辑入口。

官方 workflow 模块目录核验为 67 个文件；本批只闭合此前明确的 Definition 缺失和详情编辑错位。原 JSON 样式与字段呈现归为原样复用/共享迁移；不可变 pin、Asset 分页和 fresh 权限复核归为授权治理差异；其余表单画布、任意步骤执行与完整轨迹仍不能据此宣称 100% 恢复。没有新菜单、版本选择控件、复制按钮或附加卡片布局。

原 SDK `message-edit.AGX058/apps` 实查 4 CPU/8 GiB，执行前无其他编译，宿主 available 30 GiB、Data 3.3 GiB；不创建快照、不下载依赖、不编 Rust/镜像。日志位于本文件前述 `workflow-native-template.s3JDP1`：`definition-initial.log` 的共享 type 与 62 项首次全部退出 0；`definition-mutation.log` 只在私有输入把 pin 改为 versions[0] 并移除编辑 fresh 管理权/资源版本核对，8 failed/1 passed、退出 1。正式文件未被破坏，恢复后 cmp 退出 0。

最终 `definition-restored-final.log` 运行 `tsc --noEmit -p tsconfig.test.json` 与 `vitest run test/workflow-definition.test.tsx test/workflow-run-history.test.tsx test/workflow-actions.test.tsx test/workflow-template.test.tsx`，全部退出 0，62 passed（9 Definition + 8 历史 + 38 动作 + 7 模板）。新增场景实走原共享详情、表单/YAML、现有分页和 fresh 读取，覆盖中英原 JSON 完整样式/内容、HTML 不执行、pin 非列表首项、缺 pin、不固定草稿、分页找到 pin、撤权/版本变化/丢失拒绝。`workflows.definition` 同源词条由主线集中生成 Dart；没有手写第二语言源。

本批没有浏览器截图、Windows/Mobile、实际 Temporal 发布或完整门禁验收；源码/局部消费者验证不等于所有页面已恢复或已部署。主线统一提交、词条生成及两宿主集中验证另记。

## 原表单节点画布与检查器恢复（2026-10-07）

1. 权威：REQ-24、DD-74/75、`.design/06-Temporal任务工作台.md` §9.1。固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的 `desktop/src/features/workflows/ui/WorkflowFormBuilder.tsx::WorkflowNode/WorkflowFormBuilder/InspectorTypeMenu` 及 `desktop/src/features/workflows/ui/WorkflowStepCard.tsx::WorkflowStepCard` 是本批节点、箭头、原位添加菜单、右侧检查器、窄屏 FocusScope、动画、bare/showHeader/disabled 的复用来源。上游完整 workflows 目录 67 文件仍作为差异范围，不以本批局部变更替代全量完成判断。
2. 影响：共享 `workflow-form-canvas.tsx::WorkflowFormCanvas` 只持有节点选择；真实 steps 仍由 `agents.tsx::AutomationAction` 持有，经同一 formContent、YAML、合同校验及冻结 ActionCommand 发布。恢复选择/修改、指定位置插入、删除后相邻节点选择、动作切换清除无关字段、ID 改名继续编辑的实际消费链。Web/Desktop 共源，不改契约、Core、Worker、Temporal 或 Mobile。已确认 UNKNOWN 仍沿原锁定/幂等流程，不可关闭冒充终态。实际检查另发现 footer Close 绕过已有 requestClose，现与顶部 X 使用同一个原弃稿确认。
3. 副作用：查看旧 POST_MESSAGE 虚拟节点不写入步骤、不改变原格式；只有真实编辑/添加后才按既有格式提交，新消息序列使用 formatVersion 3。审批仍只能在首个效果前且消费授权可用策略；反应/主题保持当前运行时终端约束。未闭合 send_dm、call_webhook、步骤条件/timeout 不出现伪执行入口；没有恢复 Buzz 执行引擎或第二工作流权威。
4. 边界：空步骤和末尾 delay 可以继续编辑，但原发布校验拒绝不完整序列；删除选中节点依次选前项、后项、trigger。切换动作只保留 id/name 与目标动作字段；重命名不丢失检查器，窄屏 Escape 关闭检查器而不提交。草稿 footer Close 必须 Keep editing 保留或明确 Discard 后清理；执行不确定期间不提供该丢弃路径。AgentTurn 保持既有 Kailo 授权扩展编辑器。节点富摘要/emoji、原 URL pane 深链及任意七动作和完整轨迹仍未全量恢复，不声明 100%。

分类：原节点/箭头/菜单/检查器 class、布局与动画为共享迁移；既有 AutomationVersion/policy/resultTarget 与可执行动作边界为已授权治理改造；节点详情字段复用原 StepCard 结构，不再沿旧平铺步骤增加替代按钮。上述尚未恢复项不从交付目标删除。

FocusScope 是原检查器实际调用依赖。上游 `desktop/package.json` 为 `^1.1.8`，当前锁及原 Dialog 已固定 `1.2.0`；共享包显式 peer/dev 声明 `1.2.0`，pnpm 只补 importer，复用已有完整 integrity/snapshot。Web lock 只更新 `node_modules/@client-kit/platform.peerDependencies`，不增加 Web 根包未声明的 direct dependency。

验证复用原 `message-edit.AGX058/apps`，容器 `kailo-agent-receipt-xvkujx` 实查 4 CPU/8 GiB；末轮开始无其他编译、宿主 available 32 GiB、Data 3.3 GiB。不新建源码快照、不下载、不编 Rust/镜像。日志均位于 `/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/workflow-native-template.s3JDP1/`：

- `canvas-lock.log` 的离线 metadata 路径未命中；`canvas-lock-cached.log`/`canvas-lock-current.log` 又因无关 virtua metadata 失败。没有联网绕过。按已有锁中的实际 FocusScope snapshot 补 importer 后，`canvas-lock-frozen.log` 的 `pnpm install --offline --frozen-lockfile --ignore-scripts --filter @client-kit/platform --store-dir /cache/pnpm-memory-read` 退出 0，3 reused/0 downloaded。SDK node_modules 实为指向既有 profile-settings 目录的符号链接，安装过程中发现后通知主线协调，未改源码目录。`canvas-web-lock-dry-run.log` 的 `npm ci --dry-run --offline --ignore-scripts --no-audit --no-fund` 退出 0，只校验不实际重装。
- `canvas-initial.log`/`canvas-consumers.log` 保留缺依赖、下拉菜单旧导入、测试 Element.disabled 类型错误；修正实际依赖/既有导入和检查类型后 `canvas-consumers-fixed.log` 为 71 passed。新增旧格式和改名场景后，`canvas-final-positive.log`/`canvas-id-positive.log` 记录测试错误匹配菜单及等待 200ms 短于原动画 240ms 的失败；仅改精确选择器及等待，没有改产品动画迁就检查。
- `canvas-mutation.log` 只在私有 SDK 将插入改为末尾 push、删除后选择改为 null，真实 3 failed/7 passed、退出 1。正式源码未被破坏；恢复字节后 cmp 为 0。`canvas-restored-final.log` 的共享 `tsc --noEmit -p tsconfig.test.json` 及五文件 Vitest 为 73 passed、退出 0。
- `canvas-pages-consumers.log` 为 59 passed/1 failed，暴露上述 footer 直接关闭；修正后 `canvas-joint-final.log` 共享 tsc 与五文件 73 项通过，旧 pages fixture 仍直接关闭已选择 executor 的草稿，59 passed/1 failed。将该 fixture 改为实际弃稿确认，不绕过 guard；`canvas-pages-final.log` 的 `vitest run test/pages.test.tsx -t "shared Automation schedule consumer"` 退出 0，60 passed/206 skipped（其他 describe 本轮明确未跑）。该测试文件原有非 Workflows 主题场景脏差异不归本批，交付独立 `canvas-pages-owned.patch`，不整文件暂存。

本批没有实际浏览器截图、Windows/Mobile 设备验收、部署/安装包或全量门禁执行。源码写入及 jsdom 消费者证据不等于画布已发布或全模块原版一致。中英源词条及 Dart 同源生成由主线集中收口。

## 原画布配置摘要与表情节点恢复（2026-10-07）

1. 权威：REQ-24、`.design/06-Temporal任务工作台.md` §9.1 要求名称、条件、动作摘要来自同一个授权版本。重新核对固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的完整 67 文件 workflows 目录及 `desktop/src/features/workflows/ui/WorkflowFormBuilder.tsx::WorkflowNode/WorkflowFormBuilder`、`desktop/src/features/workflows/ui/workflowStepDescription.ts::workflowStepDescription/configuredStepDetail`、`desktop/src/features/workflows/ui/workflowDuration.ts::formatDurationSecondsVerbose`。本批将此前仅 name/actionLabel 的节点补回原配置摘要、动作副标题及表情图标，不重设计卡片。
2. 影响：同一 `WorkflowFormCanvas.steps` → 原摘要规则 → 原 WorkflowNode 的 label/description/subtitle/icon；检查器修改立即反映在同一草稿摘要。发送消息/主题/审批使用原 Unicode 引号及空白归一，延时调用原 parser 和 verbose formatter，保留官方 MAX_DETAIL_LENGTH=42 的显示截断；截断只影响呈现，提交内容与 name 不改写。原反应节点用真实 emoji 代替编号，正文仍为原动作标签，可访问 label 保留名称/emoji。只导出并复用原共享 `workflow-card-actions.tsx::ActionEmoji`，不复制自定义表情读缓存或远端图片访问逻辑。
3. 副作用：不改 AutomationVersion、ActionCommand、Core/Temporal、quota、审批或 UNKNOWN 终态；没有新增写请求。自定义表情仍必须经过既有 BFF 有签名的目录读取和 admitted mediaPaths，缺映射只显示 shortcode，不直接请求源 URL。正文仍由 React 转义，不因摘要包含 HTML 而执行。未给当前合同没有的 channel/approver 身份拼造标签，也未开放 DM/webhook 执行。
4. 边界：空值使用原动作名，非法时长保留原始编辑摘要而不伪造有效时长；有名称加 detail 时沿原 `name · detail`，没有配置时不增加重复 subtitle。中文/英文 duration 单复数来自同一 i18n 源；触发条件作者头像、排程富摘要与原 URL pane 深链仍未闭合，当前 Canvas 只接收到 trigger kind，本批不编造其余数据。

差异分类：已有节点主体为共享迁移；本批五动作摘要/原副标题 class/emoji 位置为原缺失恢复；类型及本地化、媒体映射沿授权治理适配；七动作中的未闭合执行与上述 trigger/深链仍是剩余差距。不增加节点状态或把名称/配置展示称为运行成功。

验证继续复用 4 CPU/8 GiB 的既有 SDK，开始时无其他编译、宿主 available 31 GiB、Data 3.3 GiB；没有新快照、安装/下载或 Rust/镜像。原日志目录 `workflow-native-template.s3JDP1`：`summary-initial.log` 的 shared `tsc --noEmit -p tsconfig.test.json` 与五个原工作流检查文件退出 0、83 passed；随后补真实签名 custom emoji 的映射允许/拒绝消费者。`summary-mutation.log` 在私有 Canvas 将摘要退回 actionLabel 并强制反应使用编号，真实 12 failed/10 passed、退出 1。正式源码未改坏，恢复后 cmp 退出 0。

`summary-restored-final.log` 的共享类型检查退出 0，85 项中 84 passed/1 failed：新增映射正向用例只等待 Promise，未等待 React Query 的 scheduled notification；修正该检查等待真实通知任务，不改产品。`summary-media-final.log` 的 `vitest run test/workflow-form-canvas.test.tsx` 退出 0，22 passed；其余四文件 63 项在前一轮通过，没有为检查等待改动重跑整批。四个实现/检查输入最终 cmp 及限定 diff whitespace 检查均退出 0。本批正式修改范围为三个工作流生产模块、一份原 Canvas 检查及本回执；源时长十词条由主线合入并统一生成 Dart，不占有其他共享脏文件。

未运行完整门禁、未部署、未做浏览器全页面截图或 Windows/Mobile 设备验收；不以本批摘要已恢复声明整个原版体验一致。
