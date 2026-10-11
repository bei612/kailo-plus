# 原线程来源链接的 Web 原生频道导航恢复

2026-10-11。关联 DD-75、SS-WEB-RELAY、用户固定原版一致性要求；
覆盖矩阵归属沿既有 Buzz Client Surface／Web BFF 协作接缝，不新增领域能力。
本批从[完整差异台账](buzz-restoration-checkpoint.md)的
“2026-10-09 原 SentFromThreadLine／来源链接共源恢复检查点”选取已登记的
Web DM 来源深链缺口，不以这一个修复替代全量恢复。

## 固定来源、原因与影响面

固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的完整路径
`desktop/src/features/messages/ui/SentFromThreadLine.tsx::SentFromThreadLine`
将原生 `channelId` 与来源 `rootEventId` 交给 `goChannel`，没有将频道标识改写为
Kailo Workspace ID，也没有排除私聊来源行。
`desktop/src/features/messages/ui/MessageRow.tsx::MessageRow` 是原实际消费者。

共享迁移的 `client-kit/ts/platform/src/react/messages/SentFromThreadLine.tsx`
及 `SentFromThreadLink.tsx` 已保留原行、链接、标题与样式，本批不修改它们。
缺失需恢复的是 Web 宿主 `ChannelPane::openThreadReference`：旧条件禁用所有
私聊来源点击，且先把原生频道改为 Workspace ID；当前实际父消费者
`PlatformApp::openMessageLink/openSearchChannel` 已按原生频道在新鲜目录中查找，
所以旧转换也会使普通频道来源跳转不能匹配。

本批直接传递原 `ParsedMessageLink`，恢复私聊与频道两种行的原来源交互。
唯一已授权接缝仍是 Web 通过原 BFF 目录及 conversation 准入解析到其宿主路由；
不新增按钮、页面、布局、URL 协议、产品分支或另一权限权威。
Desktop 原 `goChannel` 不变；Mobile 原生端不受本 Web 宿主修改影响。

## 副作用与异常边界

来源 tag 仍由原发送链写入、原共享解析器读取；正文、作者和源消息权威未复制。
`channelId` 必须与当前已准入频道相等，live／denied／metadataPending 和原线程
编辑离开守卫全部保留。父消费者重新读取目录，核对当前身份 owner generation，
频道成员或 ACTIVE conversation 的参与人后才导航；目录失败、撤权、非参与人、
停用会话均不导航。后续源消息读取仍由原 BFF 真实鉴权，不把点击当作授权。
无来源／非法来源仍按原解析结果不生成交互；超时和读取失败沿原错误映射，
不执行副作用、不制造成功终态。无新增持久状态、迁移、契约、Workflow 或配额变化；
幂等、重放、配额预留与数据格式迁移对本次只读导航修复无新增适用对象。

## 源码与窄验证证据

精确候选最初基于 main `541f67064e41c19d99091f3a6082b730f4e6f68e`，
三个源码／检查文件 +46/-12；只有 `ChannelPane.tsx` 是生产改动（+4/-4）。
`PlatformApp.test.tsx` 只选入来源回调证据，排除该文件既有新消息、空目录及旧路由脏改。
公共暂存和部署 pin 不在候选中。
Data 原件：`/volumes/data/kailo/tmp/web-thread-reference.2YA99P`。

既有 SDK 镜像、4 CPU／8 GiB memory 及同额 memory+swap、512 PID、无网络，
只使用已有 Data 依赖。没有安装、bundle、新 builder 或全局构建。
实际命令依次是 `tsc --noEmit`、
`vitest run src/platform/ui/ChannelRead.test.tsx -t sent-from-thread --no-file-parallelism`、
`vitest run src/platform/ui/PlatformApp.test.tsx -t "pane source-link" --no-file-parallelism`。
首轮 `validation.log` exit 2：私有依赖链接指向旧 contracts，且 React 类型重复；
尚未执行用例。按既有成功目录布局使候选共享源码继承同一 Web 依赖和固定契约后，
`validation-input-aligned.log` exit 0：类型通过，真实消息行 4 passed／52 skipped，
父导航 5 passed／36 skipped。未改正式依赖锁、契约或超时。

事后反证仅在私有快照恢复旧 Workspace ID 改写，
`negative-legacy-namespace.log` exit 1，4 个消息行用例全部因
`expected channel-a / received workspace-a` 失败；第二套件因前项失败未执行。
恢复后与正式生产文件 `cmp` 相等，`validation-restored.log` 复验 exit 0：
类型通过，消息行 4 passed／52 skipped、父导航 5 passed／36 skipped。
候选导出首次误选不存在的 `tailwind.config.ts` 路径 exit 2，改为固定源码实际
`tailwind.config.js` 后导出成功；没有修改上游或重新生成工具。

本批未部署、未执行浏览器截图：当前在线 5548c88 的默认线程和 AgentTurn 截图
不能证明这个后续修复。未重复全量门禁或 Windows／Mobile 设备验收；Web 原
send-to-channel 生产者和其余完整差异仍按台账保留，不能声称 100% 还原。
