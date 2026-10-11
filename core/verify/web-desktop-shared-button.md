# Web/Desktop 原 Button 共源消费

2026-10-11；DD-39、DD-75、SS-WEB-PRESENTATION，归属既有 Buzz Client Surface。
本批是原样式恢复与共享迁移，不新增产品页面、按钮或交互。

## 固定来源与完整影响

固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/shared/ui/button.tsx::Button`、`buttonVariants` 为恢复基准。
原 `desktop/src/shared/lib/cn.ts::cn` 的扩展合并规则也同时核对。
现有 `client-kit/ts/platform/src/react/profile/buzz/shared/ui/button.tsx`
与官方完整 diff 只有来源注释和 `cn` 的相对导入；共享 `cn` 只有来源注释。
去除这两项宿主迁移差异后，两个文件与固定官方逐字比较均退出 0。

修改前 Desktop Button 仍是官方原样，共享 Profile 已使用上述原主体；但 Web
本地 Button 仍是旧 gap-2／rounded-md、outline 实边框阴影及 icon 36px。
固定官方是 gap-1.5／rounded-lg、outline border-input/40 与 hover:bg-muted/70、
icon 32px，并包含 xs/icon-xs 尺寸。Web 实际消费不是死代码：频道待读与取消、
Inbox 刷新、频道侧栏重试及作者资料错误重试都仍导入这个本地模块。

本批直接把两宿主入口改为同一薄导出，并在现有共享包 exports 增加 `./react/button`
指向已经存在的原主体；不移动 Profile 主体，不新建包装组件，不改调用方。
检索覆盖 Desktop 的 14 个导入文件、Web 的 6 个导入文件及共享现有消费者；
`ButtonProps`、`buttonVariants` 与 Slot、ref 和透传 props 仍由同一原模块提供。
Desktop 和共享 Profile 行为保持原样，Web 改回固定原版；显式 className 覆盖照旧。

历史全量账本 `collaboration-dd399f93f584.classification.tsv` 中
`desktop/src/shared/ui/button.tsx` 为逐 blob 相同的“原样保留”；本批后归为
“共享迁移”，主体与原文不变。Web 固定来源仍为
`a6766c482533d028582d0efcfd3740769f86217c`，改用 Desktop 原版主体属于用户已授权的
两端共源与原版一致性恢复，不将历史全部差异台账标为已验收。

权威和异常边界：没有业务字段、权限、scope、数据存储、迁移、工作流或网络请求变化；
原 disabled、事件处理和插槽行为不改，没有新的状态及终结机制。认证拒绝、UNKNOWN
和六类业务错误仍由原调用方负责。Mobile 无适用对象。依赖版本与 lock 不变，
只是既有 package 的导出范围增加，不生成四语言业务契约。

## 证据边界

使用既有 `kailo-web-thread-tooltip-sdk`，4 CPU／8 GiB memory 与同额 memory+swap、
UID/GID 1000、无网络，输入、依赖及日志全部留在 Data；没有新 builder 或镜像。
定向源码输入在 `/volumes/data/kailo/tmp/web-tooltip-shared.zzIWe9`，三生产路径与
测试文件复制后均与正式工作区逐字 `cmp` 相同。

首轮 `tsc --noEmit` 因事后检查直接跨目录导入 Desktop 入口而退出 2，
私有 Web 输入没有 Desktop 依赖树，报 TS2307；后续 DOM 没有执行，原件
`button-positive.log`。检查现沿宿主边界只消费 Web 与真实共享入口，Desktop/Web
薄导出另以逐字 `cmp` 验证一致；不让 Web 构建测试反依赖 Desktop 源码或依赖树。
生产实现和依赖均未为此次检查失败调整，不修改超时。
修正宿主边界后，同一命令的类型检查退出 0；后接单文件 Vitest 进程经历
磁盘 I/O 等待后实际退出 1，日志为 `button-host-boundary.log`：
`Failed to start forks worker`／`Timeout waiting for worker to respond`，
0 tests，worker 阶段 60.07s。不是 Button 断言失败，也不是交互通过。
没有修改超时、重启容器或继续循环复跑；DOM 正向、故障反证与还原复验均未闭合。

随后获准把本批与标题复制的精确输入合入同一原私有快照，只做一次批次检查。
2026-10-11 原 session `90209`：`tsc --noEmit` 退出 0，后接
`vitest run src/shared/ui/button.test.tsx src/platform/ui/PlatformApp.test.tsx src/platform/ui/SettingsPane.test.tsx --no-file-parallelism`。
三个文件均为 `Failed to start forks worker`／`Timeout waiting for worker to respond`，
最终退出 1，no tests、3 errors、180.18s，transform/setup/import/tests/environment
均 0ms。没有 Button 断言执行；未修改超时或循环重跑，故障反证与还原复验未执行。
提交候选仍与标题复制分开，合批验证不表示两批已通过或已发布。

本批没有构建或部署，未产生新版浏览器截图，未验收 Windows/Mobile 安装包。
源码逐字比较和 DOM 检查不能替代实际页面视觉验收，也不证明生产就绪。

## 后续实际断言收口

核对原 SDK 空闲、OOM/PID 配额事件均 0、依赖版本可解析后，只在原命令增加
`--pool=threads --maxWorkers=1` 做一次执行池对照，未改正式配置或超时。
40248 中 Button 10/10 实际通过；同批两个别项失败仍记录在标题复制回执，
三套件当时为 56/58、exit 1，不当成完整通过。

私有 Web Button 换回 HEAD 旧完整主体后，15916 中共享主体身份、六种原几何及
outline 共 8 项真实失败；disabled/ref/Slot 两项仍通过，未人为破坏无关行为。
同批标题复制另 2 项失败。恢复薄导出并与正式输入 cmp 0 后，66296 中
tsc 退出 0、Button 10/10、PlatformApp 45/45、SettingsPane 5/5，合计 60/60、exit 0。
日志为同一 Data 输入目录的 `button-clipboard-threads-positive.log`、
`button-clipboard-negative.log` 与 `button-clipboard-restored.log`。
这里只确认原源码对应的实际 DOM/交互断言和反证闭合；新版浏览器与双端设备仍未验收。
