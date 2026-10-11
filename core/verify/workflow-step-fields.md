# 原工作流步骤配置字段恢复

## 来源、实际消费者与四步边界

固定官方 Buzz `779af8886caae1317b4de962082429867ab61503` 的 `desktop/src/features/workflows/ui/WorkflowStepCard.tsx::StepConfigFields`、`WorkflowStepCard` 是本批来源；`desktop/src/features/workflows/ui/WorkflowFormBuilder.tsx::WorkflowFormBuilder` 第 943 行实际使用该模块。当前共享 `workflow-form-canvas.tsx::WorkflowFormCanvas` 使用 `workflow-steps.tsx::WorkflowStepCard`，Web/Desktop 没有另写第二份页面。

1. 权威：用户原版一致性要求、`.design/06` 自动化治理及 `.design/07` 两端共源边界。当前延时误用了原本用于 Run controls timeout 的滑杆，失焦还会把零秒改为一秒；原 delay 分支实际是文本 Input。本批恢复原实际输入与文案，不以简化替代原交互。
2. 影响：仅共享步骤配置、其现有父层消费者检查及中英同源词条/Dart 投影。`AutomationStep` 契约、`supportedSteps`、YAML 读写、Core 准入和 Temporal 执行均不改；仍通过原 `onUpdate` 返回真实步骤。空名称沿现有可选字段省略语义，不新增空值 wire 格式。
3. 副作用：无请求、权限、写执行或计量变化。审批仍选择真实 policy id/version，不恢复原上游任意 from 字符串；未知/锁定状态仍由原 disabled 投递封锁操作。未支持的 timeout、condition、私聊、webhook 不新增控件/动作；原 WorkflowDurationField 文件及其他真实消费者不删除。
4. 异常：非末尾合法 delay 的 `0s` 仍为零秒，失焦不修改；非法或未完成时长作为草稿保留，现有 supportedSteps/提交准入拒绝，不伪造默认值。纯 delay/末尾 delay 不因输入变化变成合法执行。无新持久状态、重试、副作用或错误分类，UNKNOWN 沿既有父层治理保持不判终态。

## 逐字段原版对应

| 原 StepConfigFields / WorkflowStepCard | 当前恢复 | 授权适配或剩余边界 |
| --- | --- | --- |
| delay Input，`e.g. 5s, 1m, 1h` | 原文本输入/autoCapitalize/占位，无 slider 或 onBlur 改值 | 原执行准入未变 |
| send_message `Message text`、原 textarea class 与部署模板示例 | 复用已有 WorkflowTemplateTextarea，同一 onValueChange | 固定投递所选 workflow channel，保留受治理模板解析范围 |
| send_message 频道说明 | 原 `Messages post to the workflow channel selected above.` | 不新增自由覆盖 scope 输入 |
| request_approval message placeholder | 原 `Approval request message`、autoCapitalize | approver/deadline 仍由现有 policy 版本决定 |
| add_reaction emoji placeholder | 原 `e.g. thumbsup` | 不误用只属于 reaction trigger 的 WorkflowEmojiField，未增加 trigger |
| set_channel_topic placeholder | 原 `New channel topic` | 保留既有真实执行与清空语义说明 |
| Step details / Name (optional) / Step ID / reference | 原四项文案及名称、ID 占位 | 空可选名称仍按现有合同省略；步骤 ID 仍原校验 |

这是已有受支持步骤字段的原样恢复/共源迁移；policy 和 scope 投递是已授权治理差异。未支持原生动作与 Run controls 保留为缺失，不能称整个 WorkflowStepCard 已 100% 还原。

## 实际证据与未验边界

四源增量 `+127/-20`，基线逐字保存在 `/volumes/data/kailo/tmp/ui-workflow-step-fields.5EOtIY/base`；交叉复核后以 apply_patch 精确落入正式工作树，不改公共暂存五文件、作者解析批或 c381 运行快照。集中验证尚在准备，源码写入不代表验收。

- 原受限 SDK `kailo-agent-receipt-xvkujx` 预检仅 `sleep infinity`，4 CPU、8 GiB RAM、8 GiB memory+swap；宿主 available 25 GiB。未新建 SDK 或运行编译。
- 首次输入复制发现私有 UI 树不含 tools/Dart contracts；原命令 `python3 tools/gen-platform-i18n.py` 实际 exit 2（找不到脚本），日志 `/volumes/data/kailo/tmp/ui-workflow-step-fields.5EOtIY/i18n-generate.log`。未修改生成器，未据此声称通过。
- 修正为正式原 generator 和实际两侧 contracts，保留本批私有 TS catalog；受限 SDK cwd `/evidence/step-fields-i18n.RbhjV4`，同原命令最终会话 65281 实际 exit 0，输出 `Generated client-kit/dart/lib/shared/platform/reason_text.dart`、`Generated client-kit/dart/lib/shared/platform/platform_text.dart`。日志 `i18n-generate-final.log` 同目录。只把实际九新增/四纠正词条的生成差异以 apply_patch 接回私有 Dart；与原生成物 cmp exit 0。
- 对正式 apps 运行 `git apply --check --whitespace=error /volumes/data/kailo/tmp/ui-workflow-step-fields.5EOtIY/owned-source.patch`，实际 exit 0，仅证明适用。
- 实现后在现有 `workflow-form-canvas.test.tsx` 补六个真实 inspector 用例（两个中英延时、一个消息、三个其他动作），并修正原 Step details 定位及原名称/ID 文案断言。检查未执行；没有类型、DOM、生产反证/还原或文档门禁通过结论。
- 没有新版候选截图，没有构建、提交、推送或部署。旧线上图不用于证明本批。

## 三批集中验证（2026-10-10）

频道选择器、消息派生作者与本批步骤字段共用一次冻结输入：`/evidence/agent-activity-native.Lkr7rT/apps`，由正式 contracts/platform/Web 消费源同步并以 checksum dry-run 核对无差异。原 SDK 为 4 CPU、8 GiB RAM 与同额 memory+swap、UID/GID 1000:1000，实际镜像 `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`；启动前只有 sleep、宿主 available 24 GiB，未安装依赖、未新建镜像或改原超时。

原集中会话 84879 实际退出 1，日志 `/volumes/data/kailo/tmp/ui-workflow-step-fields.5EOtIY/three-batches-validation.log`，SHA-256 `989ca5e4e8dec2618f53b33d37cda42f085e806a349d5241b8dd0596533f211c`：

- shared 生产 `node node_modules/typescript/bin/tsc --noEmit` 退出 0。
- shared 检查类型 `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.test.json` 退出 2：新增频道检查第 112 行 TS2532。正式及私有副本改为 `selectedOptions[0]?.disabled`，仍必须 `toBe(true)`，无 option 不会通过，未降低类型或业务断言。
- Web 同原 tsc 退出 2：本轮私有 `@client-kit/platform` 链接错误地跨到 shared 的 React 19.3.0 类型，Web 原锁和缓存实际为 19.2.18。依原 `file:` 安装布局恢复私有包副本，src 完整 diff、package cmp 均为 0；不改 MessageContent、正式锁或类型规则。
- 原 shared Vitest 两文件 `test/workflow-channel.test.tsx test/workflow-form-canvas.test.tsx` 退出 1，60.01s、0 tests、2 errors。原 Web 三文件 `MessageAuthorProfile.test.tsx ChannelThreadPane.test.tsx InboxThreadPane.test.tsx` 退出 1，60.07s、0 tests、3 errors。均 `Failed to start forks worker / Timeout waiting for worker to respond`，transform/setup/import/tests/environment 为 0ms；没有业务断言结果。停止 DOM 重试，不变更 timeout/pool，生产破坏/还原未执行，不能伪称检查已抓住业务回归。

84879 终态后，上述单点及实际依赖布局纠正完成，再同步主线当时正式 TS 生成物（Session/Invocation 时间按原 RFC3339 字符串合同），SHA-256 `7a1394053765a092cfad4c18f98c7c698a38db37e4755dff91fa28dca41f066f`、cmp 0。新会话 77883 仅顺序补 shared 生产/检查类型与 Web 类型，三项分别退出 0，总退出 0；日志同目录 `three-batches-types-final.log`。未热改活跃检查输入，不用旧类型结果替代新生成物验收。

浏览器按原操作手册与 bootstrap 的既有 VERIFY_USER、owner-only verify_user_password 投递完成正常 IdP 表单登录；未重置账号、注入 Cookie 或输出凭据。真实 session 读取 200，但 build-info 为 `BUZZ_WEB sha256:9e1bd3032cefb32ac76fc5e64e9ed0fa7d8b45091acfe2e5556d990b407e1761`、`2026-10-09T15:39:24.407Z`，仍为旧 4c099 部署。无本批候选截图、实际浏览器交互或 Windows 验收，不重复旧截图冒充新证据；没有新构建、提交、推送或部署。

## 四批 DOM 收口（2026-10-10）

主线程纳入安装卡两源后，按授权在同一原 SDK 集中执行一次六文件 DOM。预检 SDK 只有 sleep，4 CPU/8 GiB/同额 memory+swap、UID 1000 与上述镜像/缓存不变；宿主 available 22 GiB、I/O pressure 明显，原 Wren 类型和 Codex 构建属于其他已运行受限作业，未重启或叠加镜像。正式 Web/source checksum dry-run 无差异，shared 仅安装卡 agents.tsx/agent-library.test.tsx 两项，同步后逐文件 cmp 0；Web 的原 file: 实体包同步同一 agents.tsx。合同 SHA 仍为 `7a1394053765a092cfad4c18f98c7c698a38db37e4755dff91fa28dca41f066f`。不重跑已有类型，不热改在途输入。

原会话 58377 总退出 1，日志 `/volumes/data/kailo/tmp/ui-installation-card.kHaSw1/four-batches-dom.log`，SHA-256 `c486eb57ef59fcf2ccc625c26a4707eeb3233922d99f7be8de6e8ddd21878f5f`。两项按顺序执行：

```text
client-kit/ts/platform$ node node_modules/vitest/vitest.mjs run test/workflow-channel.test.tsx test/workflow-form-canvas.test.tsx test/agent-library.test.tsx
SHARED_DOM_EXIT=1 — 60.34s, 0 tests, 3 errors
web-client/web$ node node_modules/vitest/vitest.mjs run src/platform/ui/MessageAuthorProfile.test.tsx src/platform/ui/ChannelThreadPane.test.tsx src/platform/ui/InboxThreadPane.test.tsx
WEB_DOM_EXIT=1 — 63.17s, 0 tests, 3 errors
```

六个文件分别报 `Failed to start forks worker` / `Timeout waiting for worker to respond`，两轮 transform/setup/import/tests/environment 均为 0ms。Web 主进程曾为 D 状态、累计 CPU 0 后才进入 RUN；不据此把全部失败归因某单一环境原因。没有业务用例实际执行，因而不做无意义的生产变异来伪称负向已通过；没有调整 Vitest timeout/pool 或再起重试。结束后 SDK 只剩 sleep。源码写入、原类型 0、DOM 未验收、旧部署截图四种证据严格分开；本次没有提交、部署或新版截图。

## 后续实际消费者收口（2026-10-10）

原 SDK 在 Cells 正/负/还原结束后重新预检；同一 69408 先实际执行 DM 两文件 20/20，再执行 workflow-channel 8、workflow-form-canvas 29、agent-library 14，合计 51/51。共享生产/检查类型和 Web/Native 类型均 0。Web 三文件实际 57 通过/6 失败；针对六项实际原因修正后的 46083 Web 四文件仍 0 用例/4 worker 启动错误，仅最终 Web 类型 0，不改写该失败。完整命令、输入及日志见[DM 同批收口](dm-unread-overflow.md#同批真实头像及删除证据收口2026-10-10)。

实现后 30542 在私有生产源恢复 delay range、清空跨频道审批、安装卡 UUID 和绕过头像宿主；只有 sidebar/agent-library 实际执行并出现两项精确失败，form-canvas/channel/conversation-sidebar worker 未启动，不能声称 delay/审批反证成立。所有生产变异逐字还原 cmp 0，实际运行的两文件还原 22/22 exit 0；其余不重复重试。原 58377/77883 的 0-case 记录保留，不提高 timeout/pool，也不以类型/模拟 Image 代替新版本视觉或设备验收。
