# 既有 AgentTurn 动作沿原工作流画布呈现

本批是共享 Web/Desktop 消费者修复，不是新增工作流执行类型。Mobile 不变。
基于 main `39c0f45c8801576a2cd006c5eb5ce658c18d1f05`，排除原工作树其他 Instructions 文案、
Agent 安装详情、页面检查与契约脏改；默认频道修复已由此前提交独立收口。

## 权威与完整影响面

`.design/03` 的 AutomationVersion、REQ-24/DD-107 要求旧单动作版本按原格式保留、
新步骤版本不得降为单动作。既有 `contracts/domain/automation_version_content.schema.json`
明确区分 `action: {kind: AGENT_TURN|POST_MESSAGE, template}` 与 format 2/3 `steps`。
本批没有改契约、生成代码、持久化、审批、Temporal 或执行链。

固定 Buzz `779af8886caae1317b4de962082429867ab61503`：
`desktop/src/features/workflows/ui/WorkflowFormBuilder.tsx::WorkflowNode/WorkflowFormBuilder`
提供节点、连线、原 inspector、选择与 Escape；
`desktop/src/features/workflows/ui/workflowStepDescription.ts::workflowStepDescription`
提供紧凑引用摘要。该上游没有 AgentTurn action；它是 Kailo 已存在的治理接入差异，
不能声称恢复了一个上游本来就有的 AgentTurn 步骤。

检索 `WorkflowFormCanvas`、`AutomationAction`、`workflowAction` 和实际 Workflows 消费者后，
根因是 `AutomationAction` 将 AgentTurn 分支直接渲染为平铺的 trigger/textarea，
绕过其余动作已使用的原画布。本次所有形式共用原画布；父组件仍是唯一草稿及提交权威。

| 差异分类 | 本批精确范围 |
| --- | --- |
| 原样保留 | 既有节点/箭头样式、原窄屏 inspector 动画与 FocusScope、原步骤行为 |
| 共享迁移 | 复用已有 `WorkflowFormCanvas`，不为 Web/Desktop 另做页面 |
| 已授权治理改造 | 将既有单 `action` 投影成一个原节点，原模板字段在 inspector 内编辑；scope、executor、动作选择和审批仍走原消费者 |
| 缺失需恢复 | 其余上游完整工作流动作、触发类型、实时执行证据不由本批冒充补齐 |

单动作没有伪造 `AutomationStep` ID/类型，也不提供不被现有合同执行的混合步骤菜单。
其模板直接回到 `AutomationAction` 的原 state；查看、选中和关闭 inspector 不改旧版本内容。
原版本 YAML 仍保留 `action`、不写 `steps` 或 `formatVersion`。

## 副作用与异常边界

画布没有服务端写入；新 pane 只是当前编辑器选择，关闭 inspector/编辑器即终结。
空模板保持无效草稿，原准入拒绝提交；换 workspace 仍清除旧 executor 并重新读取准入。
页面不自行增加资源范围、凭据、审批人或额度；既有拒绝、读取失败、未知结果分类不变。
取消编辑保留原 discard 确认；UNKNOWN 已确认请求不允许丢弃，并保留相同幂等身份重查。
提交正文仍由原 `prepare/submit` 生成，不把画布节点序号当执行步骤证据。

## 实际验证及未验范围

Data 私有候选和日志：`/volumes/data/kailo/tmp/web-agent-canvas.Al8mM8/`。
预检 MemAvailable 43 GiB；原 SDK 镜像在 4 CPU / 8 GiB / 512 PID / network none
容器运行，依赖只读挂载既有 Data 目录，不安装、不改超时、不构建镜像。

- 作业 85753：生产 `tsc --noEmit`、检查 `tsc -p tsconfig.test.json --noEmit` 均通过；
  `vitest run test/workflow-actions.test.tsx test/workflow-form-canvas.test.tsx --no-file-parallelism`
  41 + 29 项通过，exit 0。中英文实际编辑、表单/YAML 往返及原 UNKNOWN 重试成立。
- 作业 84123：只在私有生产候选破坏 Agent 模板 onChange，选择新增中英文消费者；
  两例都真实失败（节点没有编辑内容），exit 1。恢复后作业 68374 两例通过。
- 作业 68374：原频道选择 8、定义 33、删除 5 项通过，exit 0；随后 pages suite 因
  私有输入未导出 Desktop tailwind 配置而 0 用例失败，未算通过。
- 首次 SDK 少现有依赖链接而 exit 1；补原链接后检查自身发现 command 可空类型错误，
  增加实际存在性断言后已通过。日志保留 `validation.log`、`validation-linked.log`。
- `pages-consumer.log` 保留定时消费者 54 通过 / 6 失败；原检查直接访问现在收于 inspector
  的字段，已按实际节点点击接线。`pages-consumer-corrected.log` 保留 59 通过 / 1 失败：
  重开原定时 inspector 后，上游 `WorkflowScheduleFields` 的 `forceCustomCron` 局部 UI
  选择不跨卸载保存；已选中的 radio 再点击也不触发 change。`pages-consumer-final.log`
  同样保留 59 通过 / 1 失败。检查改为先编辑动作、再打开触发节点连续编辑原 cron 控件，
  不假设两个 inspector 同时挂载；没有修改该上游行为、提交准入、输入值或日期断言。
- 作业 63047：`vitest run test/pages.test.tsx -t "shared Automation schedule consumer"`
  60 项全部通过、210 项未选，exit 0；日志 `pages-consumer-node-order.log`。
  这是定点消费者验证，不冒称整个 pages suite 或全局检查通过。

没有执行新 `check.sh --full`，没有 Windows 安装包/设备验收。
尚未发布本批，正常账号的修复后截图应随两小批一次 Web 发布取得；不能将既有
`web-client/fork/verify/release-20261011-21fa9.md` 的修复前截图算作本批视觉通过。
当前不能声称全部 Workflows、全页面或一期生产就绪。
