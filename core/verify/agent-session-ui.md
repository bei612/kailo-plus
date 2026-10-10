# Agent Session / Invocation 治理详情读取

## 权威、影响与边界

- `.design/17` §8、`.design/19` §4、DD-47/65：Core 只返回原 Session / Invocation 元事实；原生会话正文仍由 Codex 持有。本批不复制 prompt、tool result、reasoning 或凭据，不调用 runtime ensure/start/history。
- 源码基准为 apps `590431e4b8a88691350b4b91121622e628067cea`。Web/Desktop 既有 InstallationDetail 共用 `client-kit/ts/platform/src/react/agents.tsx`；新增消费者只经共用 BFF client 请求父级已授权安装的 Session 页、明确 root/generation 的 Invocation 页。管理面身份和权限由原 BFF 重验。
- 固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的 `desktop/src/features/agents/ui/ManagedAgentSessionPanel.tsx::SessionHeader` 提供 header 布局来源。本批属于已授权 Codex 治理接入差异，不是原完整 Session / Transcript 面板恢复；不以记录中的 RUNNING 快照充当持续 Working 信号。
- 未恢复项继续包括原 BotActivityBar 的真实 working 消费、AgentSessionThreadPanel、Transcript 正文/原始事件、原生历史分页和真实取消交互。现有 result exposure 不允许仅凭 Installation read 下发其他 HUMAN 的受委托工具结果；不提供假空 observer 或伪 ACP 事件来掩盖此边界。
- 读取失败不是空列表；未知枚举、畸形时间、跨安装/工作区记录和重复 cursor 拒绝呈现。被权限过滤后的空 Invocation 页仍可沿实际 nextCursor 翻页。刷新/前台恢复重读时移除旧内容，PlatformProvider 原身份/客户端切换重置消费者；不增加第二订阅或执行权威。
- 状态优先级为 observation、UNKNOWN、cancelPending、其余原持久状态；请求取消不当作已取消。只有 `canReadTask === true` 才呈现原任务入口，否则保留 AE 引用；TaskDetail 仍经自己的 fresh 读取。Core 记录时间不当作原生 item 时间。
- 中英词条仅追加同源目录，再由原 `tools/gen-platform-i18n.py` 投影 Dart；没有新手写 wire 类型、数据库或上传合同。

## 实际执行记录

私有输入位于 `/volumes/data/kailo/tmp/agent-activity-native.Lkr7rT/apps`；原受限 SDK 的副本位于 `/evidence/agent-activity-native.Lkr7rT/apps`，实际 Docker 限额为 4 CPU / 8 GiB / 同额 memory+swap。执行前确认 SDK 仅 sleep，主机 available 23 GiB；没有新建镜像或构建实例。

第一次集中作业 81805：原 Dart 词条生成成功，随后共享 `tsc --noEmit` 退出 2，DOM 未启动。真实诊断为 `agents.tsx` 的 12 条 description 字段缺失；父级交付的生成快照未包含基准已入库的 Automation description schema，不能删除原消费者求通过。日志为 `/volumes/data/kailo/tmp/agent-activity-native.Lkr7rT/shared-final.log`。此失败保留，后续由完整合同输入重新生成，尚不据此声明类型/交互通过。

本批没有新增部署、浏览器截图或 Windows 设备验收；不能用旧线上页面证明候选。源码写入、检查终态、提交/push 与部署分别报告。

父级用完整正式 contracts 重生成后，87991 的原 Dart 词条生成成功；该 SDK PATH 没有 `pnpm`，作业随后退出 127，尚未执行 Node 检查。保留 `/volumes/data/kailo/tmp/agent-activity-native.Lkr7rT/shared-complete-contracts.log`，没有安装工具或修改 SDK。

33273 改为直接执行原 package.json 内的同一 Node 命令，完整契约输入取自父级 `current-contracts.EHOgJJ` 冻结树；原 contracts test 类型检查通过、roundtrip 56/56（0 failed、0 skipped），包含新 Agent sessions/native control 消费。随后共享平台生产和 test 两次 TypeScript 检查均退出 0，才进入单文件 DOM 检查。日志为 `/volumes/data/kailo/tmp/agent-activity-native.Lkr7rT/shared-complete-final.log`；记录此节时 DOM 尚在执行，不能把类型通过称为交互验收。

33273 最终退出 1，DOM 实际运行 19 项（11 pass / 8 fail）。8 项均是本批事后夹具错误地把未知/畸形响应断言为 `role=alert`；原 `ReadFailure` 对不明结果使用 `role=status`，只有确定拒绝才使用 alert。本批未改产品或原错误词条，修正断言为实际 status 与原“result is unknown”文案，仍要求跨 scope/畸形记录不显示、重复 cursor 不续读。

23423 单文件 DOM 复验退出 0，19/19。随后仅在 SDK 私有 `InstallationSessions.tsx` 删除安装/工作区匹配、UNKNOWN 优先、canReadTask 按钮保护，38907 同一 19 项实际退出 1（15 pass / 4 fail），分别捕获两类跨 scope 呈现、未知被取消中覆盖、audit-only 任务按钮泄漏。按原字节还原后 `cmp` 退出 0；35273 同一检查再次退出 0、19/19。正式 apps 与候选生产文件未参与变异。

上述三次执行使用原 `node node_modules/vitest/vitest.mjs run test/agent-sessions.test.tsx --maxWorkers=1`；没有更改 timeout、pool、组件实现或断言来让生产反证通过。最终夹具字符串纠正后的 DOM 已运行，类型证据对应纠正前同一生产代码和生成物，不把它声明成最后一次 fixture 字节的重新类型检查。

日志均位于 `/volumes/data/kailo/tmp/agent-activity-native.Lkr7rT/`：

| 文件 | SHA-256 | 实际结果 |
| --- | --- | --- |
| shared-final.log | `8b1ebb1b95be75f42f4d6e75abdc0bd0157d97ff38cabcb014cc6a336059e745` | 81805 exit 2，旧生成输入缺 description |
| shared-complete-contracts.log | `8f5c1b065b505e2130560cca1a72a3eac7087386e7a1c238a284ac9c43c62895` | 87991 exit 127，SDK 无 pnpm |
| shared-complete-final.log | `c084502af0d856c548a1f74e03fcc8c7d6fc2d446c3fdc02faad28207db0f9e3` | 33273 类型通过、roundtrip 56/56、DOM 11/19 |
| dom-final.log | `88901293720b145a6e9ffa4774e2dc7c340e815bd1568e4be8e9b2c2898138e2` | 23423 exit 0，19/19 |
| dom-production-negative.log | `7b86f0f82247e55211d8f4433c35fc61ec54ed0f3dc623e3dd6fa8ae4a7c4851` | 38907 exit 1，真实生产变异 4 failed |
| dom-restored.log | `08a7a463a8418ffb16b462ea4ca3fbdc9a4f5d3b6e707aee7787d9ae3c611d37` | 35273 exit 0，还原 19/19 |

本批未运行全局 check 或单独重建文档环境；由主线程将准确候选统一收口。没有截图、构建、部署或安装验收增量，不声明原版完整恢复。
