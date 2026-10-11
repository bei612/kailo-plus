# 默认频道地址与线程刷新

本批为新版 Web 实拍发现的问题修复，私有候选尚未部署，不计线上修复验收。

## 权威、影响和边界

已核对两份来源记录：`web-client/fork/upstream.yaml` 的 Web 宿主
`implementation_base_commit/evidence_commit` 均为独立 buzz-web 仓库的
`a6766c482533d028582d0efcfd3740769f86217c`；
`collaboration/fork/upstream.yaml` 的 Desktop/Mobile 主体两字段均为下述 Buzz 779af。
本次 build-info 的 e2fd 是多目录产物输入摘要，不是这两个上游 commit 的别名。
不能把共源 UI 的 Buzz 基准混称为 Web 工程来源基准。

固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/features/channels/ui/useChannelPanelHistoryState.ts::useChannelPanelHistoryState`
将线程引用留在所属频道 URL，刷新重新读取。本批是既有共享算法的 Web 宿主接线，
没有新布局、第二导航权威、合同、数据库迁移或 Desktop/Mobile 变更。

已检索 `usePlatformNavigation`、`threadHeadId`、`setThreadHeadId`、`activeRow`
与 `channel-descriptor` 的生产消费者。根因是 Web 默认 `/app/` 可以显示可信目录选定的频道，
但没有将其 ID 固定到既有 `/channels/$channelId` 路由；打开线程写入 `thread` 后，
刷新时导航读取只允许显式频道/私聊，因此丢失线程。不能直接放开默认页的 thread 读取，
否则默认频道改变可能把旧引用带进另一频道。

`PlatformApp` 仅在目录与频道 descriptor 都读取成功、均不在 fetching，且实际目录行
`isMember === true` 时调用导航规范化。`replaceDefaultChannel` 只处理默认频道；
显式频道、私聊、其他页面以及不匹配的 workspace 引用都不改写。
使用已有 navigate 的 replace，不增加历史项，保持既有 search 白名单中的 thread/message 引用。
URL 不保存正文、身份或准入证据；刷新仍由现有 BFF/频道窗口重新授权。

副作用仅为浏览器当前地址替换，无服务端写入、额度预留或未知副作用重试。
空目录、未知身份、非成员、读取失败或后台读取中不规范化；已撤权显式 URL 不回退另一频道。
继承原读取错误分类，不新增状态/错误码，不把未知结果显示为成功。
本批不恢复 profile/agentSession/channelManagement 等其余原面板 URL 功能。

## 实际验证

预检原 `kailo-agent-receipt-xvkujx` 仅 sleep，4 CPU / 8 GiB，宿主 available 25 GiB。
复用原依赖与 file: 投递路径，没有镜像构建、安装、超时或池配置修改。
输入为正式当前三个文件的精确副本加本批增量，验证目录为
`/evidence/agent-activity-native.Lkr7rT/apps/web-client/web`。

- 作业 64744：`node node_modules/typescript/bin/tsc --noEmit` exit 0；
  `node node_modules/vitest/vitest.mjs run src/app/platform-navigation.test.tsx`
  23/23，exit 0。
- 作业 32658：仅私有生产代码删除默认/显式/不同 scope 的拒绝 guard，原命令选择
  `-t "never rewrites an explicit"`；4 个实际断言失败、19 个未选，exit 1。
- 按候选原字节恢复且 cmp 0；作业 7304 原完整导航文件 23/23，exit 0。

日志在 `/volumes/data/kailo/tmp/ui-default-channel.0cTLDC/` 的
`validation.log`、`validation-negative.log`、`validation-restored.log`。
这些是实际 Router 消费者检查；PlatformApp 的新 fresh-read effect 已类型核对和源码复核，
未称完整宿主 DOM/线上端到端通过。未跑新 full，未提交或部署。

## 线上故障证据

实拍版本 source `e2fd03703af893438467954c20bf5aef154ad0b29d0914ac79143f1d624f4415`，
目录 `/volumes/data/kailo/tmp/ui-deployed-e2fd-20261010.sOY1Dh/`。
`04-index-thread-reload-missing.png` 保留实际默认页刷新丢线程；
`05-channel-route-reload-draft.png` 证明同一已有频道和根消息在显式频道地址可恢复。
不得将这些修复前截图算作本候选已修复截图。

## 2026-10-11 精确 main 候选复验

本次基于 `9d89d6826f009fd4956a518904c2714167e32a25` 的源文件组合，
只纳入上述三个路由/宿主/导航检查文件与本回执；没有纳入宿主另外两处 new-message 布局脏改。
正式树既有五个暂存 blob 保持不变。Data 私有输入与日志：
`/volumes/data/kailo/tmp/web-default-route.fRs3BG/`。

预检宿主 MemAvailable 41 GiB，无本任务并行构建；复用原 SDK 镜像与只读 Data 依赖，
`kailo-web-default-route-frs3bg` 限制 4 CPU / 8 GiB / 512 PID，network none，作业 89699：
`node node_modules/typescript/bin/tsc --noEmit && node node_modules/vitest/vitest.mjs run src/app/platform-navigation.test.tsx`
退出 0，导航 23/23 通过；没有安装依赖、修改超时或执行全局构建。
原拒绝 guard 的四例实际反证仍见上节；此次未新增检查。

刚发布的固定源码 `21fa9d7a4b336e0f3a6808d3cefeb93314c0e07f` / source
`f34c703b8bf1972ca88505a7ac6bab385d11aaf7e55199ad77c0c6cb0c04b019`
仍复现默认地址刷新丢线程，实际打开复核截图为
`/volumes/data/kailo/tmp/web-main-21fa9-release.FYhMeS/07-new-index-thread-reload-missing.png`。
同目录 `08-new-explicit-thread-draft-reload.png` 验证明示频道刷新能保留线程及本地草稿；
本修复尚未发布，不能把这两张修复前证据算作修复后通过，也不宣称全页面还原。
