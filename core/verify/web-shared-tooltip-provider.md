# Web 根提示框的原版共享消费

2026-10-11。关联 DD-39、DD-75、SS-WEB-PRESENTATION 与用户原版一致性要求；
归属既有 Buzz Client Surface，不新增页面、按钮或可配置项。

## 固定来源、差异分类与影响面

固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的完整路径
`desktop/src/shared/ui/tooltip.tsx::TooltipProvider` 默认等待 500ms、skip delay 为 0；
`desktop/src/main.tsx` 的根 Provider 不覆盖该默认值。现有共享
`client-kit/ts/platform/src/react/sidebar/tooltip.tsx` 已保留这一原实现；
对官方文件的完整 diff 仅有来源注释和宿主 `cn` 导入改为现有 `tailwind-merge`。
Desktop 的 `collaboration/desktop/src/shared/ui/tooltip.tsx` 已薄导出该共享模块。

Web 的 `web-client/web/src/main.tsx` 却消费另一份
`web-client/web/src/shared/ui/tooltip.tsx`，并强制 300ms。该本地模块的唯一生产
调用是根 Provider；因此不能把它未被消费的旧 Content 颜色说成已观察到的线上色差。
本批直接删除重复实现，改为与 Desktop 相同的薄导出；根入口不再覆盖原默认值。
共享 Tooltip 主体、原样式、触发器、正文和各业务调用方均不改。

既有全量台账
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/current-main-diff.nNHzVS/collaboration-dd399f93f584.classification.tsv`
中的 `desktop/src/shared/ui/tooltip.tsx` 历史分类是“缺失需恢复（尚未证明保留或授权）”。
此处逐文件核对后归为“共享迁移”，并补齐 Web 根消费者；这不重新分类整个 main
文件，也不把该历史台账其余未证明项标成已恢复。Web 自身固定基线仍是
`a6766c482533d028582d0efcfd3740769f86217c`，此差异属于用户明确要求的两端共源迁移。

## 权威、副作用与异常边界

这是原版支持、既定共源迁移的剩余消费缺口；没有被阻断能力的入口生成。
影响仅为 Web 根提供给原 Tooltip 的交互参数；侧栏自己的共享 Provider 不变。
没有字段、数据 writer/reader、迁移、契约、工作流、API 或外部副作用变化；
Browser BFF、Desktop 本机持钥及管理面边界均不改，Mobile 无适用对象。
认证、scope、binding、额度、撤权、UNKNOWN 和六类业务错误分类没有新分支。
原 Tooltip 的显式 props 覆盖、卸载清理及 Radix 行为直接复用，不另加计时实现。

## 实现后的窄验证

原件 `/volumes/data/kailo/tmp/web-tooltip-shared.zzIWe9`。固定候选从
`ba32bc6efde2f455da0d6429b55988609e25e119` 导出 Web/共享实际源码，未复制完整仓库；
后续 main 至 `8ec54d517c17157e8f5a3e14a6eb9ed37d795309` 没有修改这批源码输入。
复用既有依赖与 SDK
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
实际 4 CPU、8 GiB memory 与同额 memory+swap、512 PID、UID/GID 1000、无网络。
全部输入、依赖、临时输出位于 Data；没有新建 builder 或镜像构建。

- `node node_modules/typescript/bin/tsc --noEmit` 首轮退出 0。
- 首轮实际 main 启动检查因测试宿主没有正式必需的 `platform-display-name` meta
  退出 1；只补齐测试宿主输入，生产拒绝规则未修改，见 `positive.log`。
- `node node_modules/vitest/vitest.mjs run src/main.test.tsx --no-file-parallelism`
  退出 0，1 passed，见 `positive-fixture.log`。导入真实 Web main、真实根
  Provider 和 Radix；仅替换 App 内容、主题宿主与 Toaster，不 mock 提示框。
  验证 499ms 不出现、500ms 出现，离开后相邻触发器仍完整等待；不是源码字符串断言。
- 只在私有快照恢复旧 300ms 参数，同一套件退出 1，1 failed，见
  `negative-old-delay.log`；499ms 断言捕获真实已打开的 tooltip DOM。
  没有修改超时或断言。之后恢复默认 Provider，`cmp` 确认与工作区文件相同。
- 首次还原复验类型仍退出 0，交互套件因测试体内模块 transform 用时 5.35s，
  超过原 5000ms 用例期限而退出 1，见 `restored.log`。宿主初始化现移到测试模块
  加载阶段，行为测试只计实际指针与计时交互；不修改期限、断言或产品实现。
- 初始化结构调整后的原单套件复验曾因宿主大量 I/O 阻塞而未返回，期间按主线协调
  停止追加 Docker 查询和编译，保留原作业句柄。阻塞消退后从原句柄取回真实退出码
  0：1 passed，行为用例 189ms、模块 import 2.74s，见 `positive-module-init.log`。
  工作区三个源码文件与该私有输入逐字 `cmp` 一致，不用此前通过覆盖这次终态。
- 最终集中复验复用同镜像、同 Data 挂载及限额：`tsc --noEmit` 退出 0；
  `vitest run src/main.test.tsx src/platform/ui/InboxThreadPane.test.tsx
  src/platform/ui/ChannelThreadPane.test.tsx --no-file-parallelism` 退出 0，
  3 files／46 passed（提示框 1、Inbox 线程 24、频道线程 21），见
  `final-thread-tooltip.log`。该私有输入另精确包含主线的 `useWorkspaceThread.ts`
  与 `InboxThreadPane.test.tsx` 修复，逐文件 `cmp` 一致；这两路径由主线独立收口，
  不混入本提示框四文件候选，也不把它们的检查当作生产业务验收。
- 主线随后进行线程故障反证并还原后的集中复验退出 1，见 `thread-restored.log`：
  两个线程套件 45 passed，但提示框套件 fork worker 启动超时，提示框断言没有执行；
  不能用前轮 46 passed 覆盖本轮失败。
- 核对同一 SDK 仍为 4 CPU／8 GiB、主机可用内存 36 GiB 后，仅复验
  `vitest run src/main.test.tsx --no-file-parallelism`，未新建容器或修改超时。
  原句柄实际返回退出 0，1 passed，用例 181ms、模块 import 19.13s、总计 44.78s，
  见 `main-after-thread-restored.log`。三个提示框源码输入仍与工作区逐字一致。
  四文件候选随后重放到主线线程修复提交
  `4a69f20c8c15b260f19f6a95558cc3a887695936`，保留该提交全部原路径。

本批未运行全量门禁、构建、部署或生成新的浏览器截图；不把 jsdom 检查当作真实
页面视觉或 Windows/Mobile 安装包验收，也不据此声明全量原版一致或生产就绪。
现网仍是已记录的固定 032b9c3 Web 产物，本批不改其发布 pin。
