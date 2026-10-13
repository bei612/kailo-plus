# Agent 指令字段与显式不可用频道

本批为独立私有增量，基于本轮正式工作树逐文件保存前像；不覆盖公共暂存词条、
此前 Agent/Workflows 改动或默认频道路由修复。主线程已按精确增量合入正式源码及
独立候选，公共索引未变；该历史实施阶段尚未提交或部署，当前收口见末节。

## 权威与影响

- 原版恢复依据：Buzz `779af8886caae1317b4de962082429867ab61503`，
  `desktop/src/features/agents/ui/AgentDefinitionDialog.tsx::AgentDefinitionDialog` 的
  instructions 字段。既有共享布局、Textarea 和编辑状态保持，仅恢复原文
  `Agent instructions` 与 `Describe what this agent should do.`；中文由同源词条提供。
- 实际消费：共享 `agents.tsx::VersionAction` 的 `instructions` 状态仍进入已有
  `agent.version.create/update` 冻结请求，保留版本、权限、审批、UNKNOWN 与原始指令正文。
  Web/Desktop 共用这一字段；治理详情的既有 Instructions 标签不受本批影响。
  无契约、持久化或权限变化，Dart 只沿原生成器投影两条词条。
- 显式频道空态属于 Web 宿主治理适配（DD-75），不是把 Buzz Web 上游
  `a6766c482533d028582d0efcfd3740769f86217c` 与 Desktop 恢复基准混为一谈。
  `PlatformApp.tsx::SignedIn` 在目录读成功但显式目标不在目录时，复用已有
  `platform.linkChannelUnavailable`；没有指定目标且目录为空仍显示 `platform.noWorkspace`。

## 副作用与边界

不修改目录查询、频道 descriptor 准入或显式 URL 不回退规则；目录错误/加载中、
已知非成员提示保持原分支。未知或无权目标不据此区分其存在性，不显示全 Tenant
无工作区，也不选择其他频道。空指令仍由既有表单与服务端拒绝；版本发布只读、
失效配置、审批等待和结果不明均沿原逻辑。本批没有外部写入、异步状态或新终态。

原 Agent identity/description/advanced/preview 已有共享模块，不重复移植。
原 `AgentInstanceEditDialog` 的 harness/env、owner-only、auto-restart 配置缺少等价的
已授权安装编辑合同，本批不生成替代控件。Working、Session 原完整界面与 Transcript
正文消费仍未恢复；已有治理元事实不能算作原面板还原。

## 实际证据

- 实现后更新原 `pages.test.tsx` 的三个真实创建/编辑字段消费者，保留请求正文、
  审批和 UNKNOWN 断言；新增原占位文案断言。`PlatformApp.test.tsx` 保留拒绝查询及
  不回退断言，并区分显式未知目标和真正零目录。
- 原受限 SDK `kailo-agent-receipt-xvkujx`：执行前仅 sleep，4 CPU/8 GiB，宿主可用
  25 GiB、memory PSI avg10=0。原 `python3 tools/gen-platform-i18n.py`（70718）退出 0，
  输出两份 Generated；`reason_text.dart` 与前像完全相同，platform_text 仅本批两词条。
- 源补丁 6 路径 `+36/-9`，SHA-256
  `d444ee30fb91fd580ccc9a4b923d1d21594f9e756a500f2471285e0b58702aac`，
  正式树 `git apply --check` 退出 0。
- 集中原作业 98485 实际退出 1：共享 `tsc --noEmit` 与 Web `tsc --noEmit` 均退出 0；
  原 `pages.test.tsx` 的三个创建/编辑用例在 worker 启动阶段超时，`no tests`、退出 1，
  不是产品断言失败或成功。原 `PlatformApp.test.tsx` 的三个显式/空目录消费者
  实际 3 passed/36 skipped、退出 0；耗时 87.18s，import 46.41s、environment 32.06s、
  tests 57ms。未修改原超时、runner、断言强度或依赖。
- 原实际命令（同一受限 SDK，工作目录 `/evidence/agent-activity-native.Lkr7rT/apps`）：
  先在 `client-kit/ts/platform` 运行 `node node_modules/typescript/bin/tsc --noEmit` 和
  `node node_modules/vitest/vitest.mjs run test/pages.test.tsx -t 'creates a draft only from explicitly selected|updates exact DRAFT content|preserves a historical description'`，
  再在 `web-client/web` 运行同样类型命令和
  `node node_modules/vitest/vitest.mjs run src/platform/ui/PlatformApp.test.tsx -t 'does not substitute a default channel|distinguishes an empty directory'`。
  五份手写源同步后逐项 cmp 0；Web 的既有 file: 安装实体副本同步同源后 cmp 0。
- 真实生产反证 39029 在私有副本撤回 `chosen` 的不可用文案分支，运行同一个
  Web 三用例命令：日志实际为 2 failed/1 passed/36 skipped，失败落在原第 419 行的
  不可用频道文案断言；接管时执行句柄已失效，因此不补造该句柄的退出码。
  2026-10-11 主线程按正式源码恢复私有副本，逐字节 cmp 退出 0；原命令 34340
  实际 3 passed/36 skipped、退出 0（2.93s），未改变超时、依赖或断言。
  负向日志 SHA-256 为 `12f3bf6997c8d649b0ca9f48f11109e0b973ee70256a5e23ca13825d63e45138`；
  还原日志为同目录 `channel-restored.log`，SHA-256 为
  `ef5e7f9ef949523bd4a1d8252f25ec5665ee8400990b17bfa3212076aaeaefa5`。
- 实际日志位于 `/volumes/data/kailo/tmp/agent-field-unavailable.i3QpWk/validation.log`
  与同目录 `channel-negative.log`。未构建、未部署，不能用已运行 e2fd 镜像验证此修复。
- 2026-10-11 继续运行三个 Agent 字段消费者：首次 2 passed/1 failed、退出 1。
  失败是旧断言仍在安装卡片查找版本 ID，而该信息已迁入真实安装详情；没有放宽
  Version 读取权限或恢复卡片上的非原版字段。检查现在关闭编辑弹窗、点击原
  View installation，再从实际详情验证固定版本不变，并继续断言只有一次写请求。
  原三用例复验 44756 为 3 passed/267 skipped、退出 0（3.86s）。日志分别为
  同目录 `agent-fields-restored.log`、`agent-fields-final.log`。jsdom 的 scrollTo
  未实现警告保留；这不是浏览器滚动交互或全量页面验收。
- 失败来源是已实际打开的 e2fd 图 24，原文件为
  `/volumes/data/kailo/tmp/ui-deployed-e2fd-20261010.sOY1Dh/24-explicit-unknown-channel.png`。
  该图证明修复前错误提示，不是新候选截图；Agent 本批字段也没有新版截图验收。

## 2026-10-13 当前主干上的精确收口

本轮基准为 `49f961b1aa9b3bdb52af38682806d4c25127d8a4`。前文保留历史实施与
失败，不将其“尚未提交”外推到所有相关文件：显式频道不可用分支已在本轮 HEAD
的 `PlatformApp.tsx::SignedIn`，此次不重复提交或验证该分支。

当前只收五路径：共享 `agents.tsx::VersionAction` 的 label/placeholder 两行，
TS 权威两词条、原生成 Dart 对应两词条、`pages.test.tsx` 三个实际字段消费者，
以及本回执。固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/features/agents/ui/AgentDefinitionDialog.tsx` 第 780/791 行已只读核对，
原英文及布局对应不变。无新权限、请求字段、状态或副作用；原冻结请求、版本 pin、
历史 description 原字节与一次写入断言保持。公共 i18n 暂存、其他词条、Automation、
其他安装与样式检查的脏差异均不进入候选，不修改正式公共 index。

独立 Data 输入与日志为
`/volumes/data/kailo/tmp/web-tooltip-shared.zzIWe9/agent-instructions-close.2mPDU0`。
由 HEAD 导出原 client-kit、两个实际宿主及原生成器，仅应用上述精确增量。
首次导出用了不存在的 EmojiBurstProvider 路径，命令退出 2，未执行验证；随后使用
原 `collaboration/desktop/src/shared/ui/EmojiBurstProvider.tsx`。没有改产品迁就快照。

复用 `kailo-inbox-forum-r5kqbx` 原检查镜像 `10ad51a2…`，实际 UID1000、
2CPU/4GiB、memory.swap.max=0、network none；源码、依赖、tmp/cache 均在 Data。
开始前仅 sleep，MemAvailable 35,545,892 kB、memory PSI avg10=0，未有 Cargo/Go
编译；未新建 SDK、安装依赖或构建镜像。原 Node24.21.0、TS5.9.3、Vitest4.1.11。

原 `python3 tools/gen-platform-i18n.py` 和 `--check` 均退出 0；Dart 生成物
对 HEAD 仅新增两个 enum 与两个双语值，`reason_text.dart` 对 HEAD 同字节。
共享原 `tsc --noEmit` 与 `tsc --noEmit -p tsconfig.test.json` 都成功，然后第一轮
Vitest 收集因快照缺 Desktop Tailwind 输入退出 1、no tests；会话 71752 整体退出 1。
一次补齐固定 HEAD Desktop 原输入后，不修改规则、超时或用例。

实际消费者命令在私有 `apps/client-kit/ts/platform` 中执行：

```sh
node ../../../node_modules/vitest/vitest.mjs run test/pages.test.tsx \
  -t 'creates a draft only from explicitly selected|updates exact DRAFT content|preserves a historical description'
```

80531 正向实际退出 0，3 passed/267 skipped。仅在私有原生产文件撤回本批 label
与 placeholder，4223 实际退出 1：三项全部失败，分别命中空 placeholder 和两个
`Missing real control Agent instructions`，不是仅检查常量存在。原字节还原并与
正式生产文件 cmp0 后，93522 同命令实际退出 0，3 passed/267 skipped。
原 jsdom scrollTo 未实现告警保留，不冒称浏览器滚动或安装包验收。

| 日志 | SHA-256 |
| --- | --- |
| positive.log（含首次输入失败） | `57c85a53797f96657b56394898a7c0f7deb129aeae4bd96e0c6d4c132b019fd2` |
| positive-complete-input.log | `fd09b7b1c18eefaae2292c1acc9d395496d8a26b17335c43676f0734f3ffc741` |
| mutation.log | `0d5fea4ff183477c52c4a746478fab59eaab6a599c6cf5a5358801978cc62adc` |
| restored.log | `d48be31f92bb99351347078bd981b9c19a1416660564eca0853b9299fa25cde3` |

结束回读 SDK 仅原 sleep。公共已暂存 binary patch SHA256 前后均为
`f1ed787026ac9598d4068ce1be11ec6b8c0e56e310e170da545f278132fcd11e`。
上述 owner 验证阶段没有 commit/push、构建、部署或新版正常 SSO 业务验收。
主线已复核完整五路径差异及固定原 label/placeholder，保留公共暂存的其他内容，
按选定私有 index 集成；实际提交/push 以原 Git 日志为准，日志位于
`/volumes/data/kailo/tmp/agent-instructions-main-close.68QxkR/`。
不将三项 DOM 通过写成整个 Agents、原版全量恢复或生产验收完成。
