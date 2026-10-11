# 原消息链接复制的 Web 宿主接线

2026-10-11；DD-39、DD-75、SS-WEB-PRESENTATION、SS-WEB-RELAY。

## 原版来源、实拍与差异归类

固定 Buzz `779af8886caae1317b4de962082429867ab61503`：
`desktop/src/features/messages/ui/MessageActionBar.tsx::copyMessageLink` 使用原
`buildMessageLink` 后交给 `desktop/src/shared/lib/clipboard.ts::copyTextToClipboard`；
`desktop/src/shared/ui/markdown/BuzzLinkChip.tsx::useBuzzLinkContextMenu` 的复制菜单
同样走该宿主能力。共享页面已保留原消息操作栏和链接菜单，不缺按钮；Web
`ChannelPane.tsx::copyMessageLink` 与 `BffMessageLinkHost.tsx::copyLink` 仍直接
调用 `navigator.clipboard.writeText`，没有消费已有浏览器宿主适配。
本批将这两个“缺失消费者恢复”项接回原语义，不重新实现菜单或复制机制。

普通账号经独立正常 OIDC 登录，鼠标移至实际消息行后点击“复制链接”，页面显示
“复制失败”。`22-message-copy-failed.png` 已打开视觉复核，同名 YAML 与此前
`21-message-copy-before.yaml` 保存在
`/volumes/data/kailo/tmp/web-main-032b9c3-release.owfGjV`。
浏览器实际读回 `isSecureContext=false`、`navigator.clipboard` 为 undefined；
`/app/platform-build-info.json` 的 buildId 仍为
`sha256:f530ffa636a6980aaa21aa84ef5d44c83ae47d831504e95f173614f21f0a345e`，
对应已有 `032b9c304c84336a52c699244992c9bc73ff55da` 发布。没有发送或修改消息，
浏览器已关闭；此图不是新版验收。

## 实现、影响与异常边界

两个 Web 消费者分别增加已有 `shared/lib/clipboard.ts::writeTextToClipboard`
导入，并替换原单个调用。共享菜单、channel/message/thread 参数与原反馈词条不变。
HTTP 缺 Clipboard API 时沿已存在的同步用户手势复制；false／异常仍报失败；
现代 API 明确拒绝不转用 fallback。Bff 链接菜单不再因访问 undefined 而跳过错误回调。
不改变消息目标准入、目录/作者读取、撤权、原消息链接生成或导航，不新增服务请求、
状态、数据库、契约或迁移。Desktop/Mobile 未改；富文本正文复制未纳入本批。
Pulse、作者资料、视频 review、频道侧栏等其他复制消费者仍有独立核验缺口，
不能据此声明全部复制能力完成。

## 实际验证、失败与反证

复用空闲的 `kailo-web-thread-tooltip-sdk`，4 CPU／8 GiB、无网络；开始前只有 sleep，
宿主 load 10.92、MemAvailable 33 GiB。输入和缓存均为原 Data 挂载，不新建镜像。
工作目录 `/candidate/apps/web-client/web`，日志目录
`/volumes/data/kailo/tmp/web-tooltip-shared.zzIWe9`。运行：

```text
node node_modules/typescript/bin/tsc --noEmit &&
node node_modules/vitest/vitest.mjs run src/platform/ui/ChannelPane.test.tsx src/features/chat/ui/MessageContent.test.tsx --pool=threads --maxWorkers=1 --no-file-parallelism
```

`message-link-copy-positive.log`：类型 0，54 passed／2 failed，退出 1；新增检查
未匹配原夹具的语言边界，ChannelPane 的 t 被原测试替换成 key，而 Bff 使用设备
默认中文。只纠正夹具：前者按既有 key 断言，后者显式保存／设置／还原设备语言。
`message-link-copy-corrected-positive.log`：类型 0，56 passed，退出 0。保留原
canvas getContext 未实现提示和 React act 警告，不把警告遗漏或原本测试以外的
覆盖算作通过。实际挂载原消息操作栏和 authored link 菜单，验证 HTTP 复制内容、
成功／拒绝反馈、现代 API 拒绝不降级；原导航、撤权和富文本正文检查全部保留。

私有快照仅将两个调用还原成直接 Clipboard API；原 Vitest 命令限定
`-t "copies the actual message link|uses the original channel chip"`，
`message-link-copy-negative.log` 退出 1：2 failed／54 skipped，并捕获 1 个旧链接
菜单同步 TypeError。随后恢复生产输入并逐文件 cmp，正式源码不受反证影响。
`message-link-copy-restored.log` 同一限定检查退出 0：2 passed／54 skipped。

本批未运行全量门禁、构建或部署，未取得修复后实拍或 Windows/Mobile 验收。
私有候选只包含本批两个生产接点、两个原套件扩展和本回执，保留公共暂存与其他脏改。
