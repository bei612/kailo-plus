# 原频道与私聊标题复制的 Web 宿主接线

2026-10-11；DD-39、DD-75、SS-WEB-PRESENTATION，归属既有 Buzz Client Surface。

## 真实失败与固定来源

普通账号经独立 OIDC 登录已部署 Web `032b9c304c84336a52c699244992c9bc73ff55da`，
浏览器读回 buildId 为
`sha256:f530ffa636a6980aaa21aa84ef5d44c83ae47d831504e95f173614f21f0a345e`。
实际 HTTP 入口 `isSecureContext=false`、`navigator.clipboard` 为 undefined；
点击当前频道的“复制频道名称”后，页面明确出现“未能复制到剪贴板”。
`08-channel-title-copy-failed.png` 已打开作视觉核验，原件目录为
`/volumes/data/kailo/tmp/web-main-032b9c3-release.owfGjV`；同目录
`channel-copy-failed.yaml` 保留实际 toast，未把先前定位器未点中时生成的
`07-channel-title-copy-result.png` 作为操作证据。

固定 Buzz `779af8886caae1317b4de962082429867ab61503`：
`desktop/src/features/chat/ui/ChatHeader.tsx::handleCopyTitle` 通过
`desktop/src/shared/lib/clipboard.ts::writeTextToClipboard` 调用原宿主能力，
失败由原错误提示反馈。当前共享 ChatHeader 保留原页面、按钮和布局；
Web `PlatformApp.tsx::SignedIn` 的频道与 DM 标题回调却直接使用 Clipboard API，
没有消费已有 HTTP 宿主适配。这是实际宿主接线缺口，不是原按钮或页面缺失。

## 实现、影响与异常边界

直接将已存在于 `SettingsPane.tsx::WebProfileSettings` 的复制实现抽到
Web `shared/lib/clipboard.ts::writeTextToClipboard`；设置页和两个标题回调
消费同一实现。没有另写第二套 fallback，不改变 Profile 头像预览、编辑或保存。
Desktop 原生 clipboard 保持不变，Mobile 无适用对象。

Clipboard API 存在时只调用一次，权限拒绝不改走另一 API；API 不存在时沿已有
同步 click 手势调用浏览器 `execCommand`，false 或异常仍报告失败，finally 移除
临时文本域并恢复原焦点与选区。没有放宽浏览器权限、CSP、认证或用户身份。
复制的是当前已授权呈现的标题，不新增资源读取、服务动作、契约或持久化数据。
空标题仍由原 ChatHeader 拒绝，原成功/错误文案及 UNKNOWN 处理不变。
没有新的平台状态、迁移或外部业务副作用。

`PlatformApp.tsx` 与其原检查文件存在别批脏改；私有候选从主线重新应用本批
导入、两个调用及标题回调检查，不包含 new-message 布局。随后在完整复验发现
原工作区断言过时，获准仅纳入既有 emptyWorkspaces 夹具和空目录／显式失效目标
检查，匹配 HEAD 已提交的 fail-closed 呈现；不改生产授权与路由逻辑。
事后检查追加到原 PlatformApp 套件，仍渲染真实共享 ChatHeader，只捕获原回调；
覆盖频道/DM HTTP 成功、浏览器拒绝、现代 API 拒绝不降级。原 SettingsPane 的
中英文复制、拒绝、异常、焦点与临时文本域清理检查继续作为抽取回归输入。

源码 diff 校验通过。为避免重复编译，本批与 Button 的精确输入在原私有快照合并
执行一次窄验证，提交候选仍分别保留；SDK 为原 `kailo-web-thread-tooltip-sdk`，
4 CPU／8 GiB、无网络，开始前只有 sleep，无其他编译。输入与依赖均在 Data。

2026-10-11 原 session `90209` 执行：

```text
node node_modules/typescript/bin/tsc --noEmit &&
node node_modules/vitest/vitest.mjs run src/shared/ui/button.test.tsx src/platform/ui/PlatformApp.test.tsx src/platform/ui/SettingsPane.test.tsx --no-file-parallelism
```

类型检查退出 0；随后三个文件均报 `Failed to start forks worker`、
`Timeout waiting for worker to respond`。最终退出 1，`no tests`、`3 errors`，
Vitest duration 180.18s，transform/setup/import/tests/environment 均 0ms。
启动前后观察到 Data I/O 等待；此记录不把环境超时当作任何断言通过。
未修改超时、重开容器或循环重跑；正向没有执行，因此故障反证与还原复验未执行。
未运行全量门禁、构建或部署；线上失败截图不是修复后验收，也不是 Windows/Mobile
验收。Button 候选独立保留，不混入此批。

## 后续执行诊断、反证与还原

原 SDK 空闲、memory.events 的 max/oom/oom_kill 均 0，pids.current 为 3、
pids.events max 为 0；Node v24.21.0、Vitest 4.1.11、TypeScript 6.0.3 均可解析。
Web 没有覆盖默认 fork 的专用测试配置。复用已有受限 SDK，仅将上述 Vitest 命令
追加 `--pool=threads --maxWorkers=1`，保留隔离、原断言和默认 5000ms 阈值；
没有修改正式 Vitest 配置或为通过而增加超时。

`button-clipboard-threads-positive.log`（40248）实际执行 58 项，56 passed／2 failed。
本批频道/DM 复制与原个人资料中英复制均通过；失败是原工作区断言要求
`platform.noWorkspace` 而 HEAD 已呈现 `platform.linkChannelUnavailable`，以及
原表情 controller 保活用例 5000ms 超时。两项原始失败保留。
只纠正前者过时期望，增加空目录与显式失效目标的区分，仍断言 channel 查询不启用、
不选择其他默认频道；后者没有改源码、检查或阈值。

`button-clipboard-negative.log`（15916）只在私有输入将两个标题调用改回
`navigator.clipboard.writeText`，两项真实复制断言均失败（execCommand 调用数为 0）；
同批旧 Button 反证另有 8 项失败。该轮为 10 failed／10 passed／33 筛选 skipped，
退出 1。两生产文件按候选原字节恢复，cmp 0。

`button-clipboard-restored.log`（66296）重新执行 tsc 退出 0，三个原套件全部通过：
PlatformApp 45、SettingsPane 5、Button 10，共 60/60、exit 0，6.04s。
原表情用例在同一 5000ms 阈值下为 347ms。此对照不能证明执行池是先前
I/O 等待或 worker 超时的唯一原因，也不抹去原失败。
上述日志均在 `/volumes/data/kailo/tmp/web-tooltip-shared.zzIWe9`。

新增空目录区分检查的反证也只作用于私有生产输入：将既有 chosen 分支强制改成
noWorkspace 后，73257 为 2 failed／1 passed／42 筛选 skipped、exit 1；
显式失效目标被误当空目录的两种状态均被抓到。恢复候选字节 cmp 0 后，33736
同三项为 3 passed／42 skipped、exit 0。原件 `clipboard-workspace-negative.log`
与 `clipboard-workspace-restored.log`；不把筛选未执行项算通过。
