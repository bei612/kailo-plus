# 新消息原全高页面的 Web 宿主恢复

2026-10-11；DD-39、DD-75、SS-WEB-PRESENTATION，归属既有 Buzz Client Surface。

## 固定来源与真实差异

固定 Buzz `779af8886caae1317b4de962082429867ab61503`：
`desktop/src/app/routes/messages.new.tsx::Route` 直接承载
`desktop/src/features/messages/ui/NewMessageScreen.tsx::NewMessageScreen`；
`desktop/src/app/AppShell.tsx::AppShell` 的 Outlet 经
`desktop/src/app/AppShellChannelSurface.tsx::AppShellChannelSurface` 进入原
ContentSurface，没有额外“新消息”标题。原 NewMessageScreen 根为
`relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden`，内部已提供
`new-message-header` 收件人栏与 `min-h-0 flex-1 bg-background` 空白主体。
现有共享 `client-kit/ts/platform/src/react/new-message.tsx::NewMessageScreen`
保留这些原布局，Web `NewMessagePage` 已消费同一共享组件。

普通账号独立 OIDC 登录后，点击侧栏“新消息”，再按 Enter 选择收件人；未发送消息。
`19-new-message-original-host-before.png` 与 `20-new-message-recipient-before.png`
均已实际打开复核，原件及同名 YAML 位于
`/volumes/data/kailo/tmp/web-main-032b9c3-release.owfGjV`。
两图可见额外“新消息”标题、原“收件人”栏和靠上的输入区；DOM 读回两个 header，
共享页面父级为 `min-h-0 flex-1 overflow-auto p-4`，未提供原全高 flex 宿主。
这两处归为“缺失需恢复”，不是获准治理改造；原共享主体归为“共享迁移”。

实际 `/app/platform-build-info.json` 返回 200，buildId 为
`sha256:f530ffa636a6980aaa21aa84ef5d44c83ae47d831504e95f173614f21f0a345e`，
对应已有 `032b9c304c84336a52c699244992c9bc73ff55da` 发布。
首次误请求无 `/app` 前缀的 build-info 得到 404／JSON 解析失败；唯一 console error
来自该诊断请求，已保留，不据此判断业务页面失败。浏览器已关闭。

## 实现、影响与异常边界

只修改 `web-client/web/src/platform/ui/PlatformApp.tsx::SignedIn` 两行：
new-message 不再添加外层标题，并与已有全高页面一样使用无 padding 的 flex 容器。
未重写原页面、收件人菜单、编辑器或布局组件，不修改 Desktop/Mobile。
身份、scope、准入、目录读取、草稿、上传和确认后导航仍由既有调用链负责。
不新增契约、持久化状态、迁移、外部业务副作用或失败降级；空收件人、上限、
准备中的会话、UNKNOWN 重试和离开页面后的迟到结果仍沿原组件处理。

原 `PlatformApp.test.tsx` 追加宿主断言：使用隔离页夹具检查容器和单标题；该夹具
不是实际原组件验收。另运行原共享 NewMessageScreen 真实套件及 NewMessagePage
真实 Composer／BFF 检查，保留各自验证边界，不把 DOM 检查冒充视觉验收。

## 实际验证与反证

复用 `kailo-web-thread-tooltip-sdk`，4 CPU／8 GiB、network=none；开始前只有 sleep，
MemAvailable 33 GiB。源码、依赖、日志均位于 Data，未新建 SDK／builder。
日志目录 `/volumes/data/kailo/tmp/web-tooltip-shared.zzIWe9`。

原命令（工作目录 `/candidate/apps/web-client/web`）：

```text
node node_modules/typescript/bin/tsc --noEmit &&
node node_modules/vitest/vitest.mjs run src/platform/ui/PlatformApp.test.tsx src/platform/ui/NewMessagePage.test.tsx --pool=threads --maxWorkers=1 --no-file-parallelism
```

`new-message-positive.log`：类型 0，53 passed／1 failed，退出 1。
失败是原 NewMessagePage 检查寻找 `Mention someone Bob`；固定官方
`desktop/src/features/messages/ui/MentionAutocomplete.tsx::MentionAutocomplete`
明确使用 `Mention ${suggestion.displayName}`，当前共享组件与 HEAD
`buzz.mentionNamed` 词条同样为 `Mention {name}`。只纠正原检查的两个选择器，
不删除真实 Composer、UNKNOWN 同 intent 重试和身份不串断言，不改生产文案。
`new-message-corrected-positive.log`：类型 0，两个文件 54 passed，退出 0。

在现有私有共享源码目录运行原 `test/new-message.test.tsx`，同一 Vitest 命令追加
`-t "shared original new-message surface"`：`new-message-shared-positive.log`
退出 0，7 passed／18 skipped（限定原新消息页面范围）；共享测试与页面源码
已按 HEAD 对象校验，未吸入工作区另一批中英文身份提示改动。

仅在私有快照恢复旧两行宿主：`new-message-negative.log` 退出 1，1 failed，
明确捕获旧 `overflow-auto p-4` 容器；再恢复全高容器但保留多余标题：
`new-message-header-negative.log` 退出 1，1 failed，捕获 header 数量 2 而非 1。
两次使用 `PlatformApp.test.tsx -t "keeps the original new-message"`，均有 45 项
因限定范围跳过，没有调整超时或改断言来通过。随后还原输入并逐字节 cmp；
`new-message-restored.log` 同一限定检查退出 0，1 passed／45 skipped。

本批未运行全量门禁、镜像构建或部署；截图是旧线上缺陷证据，不是修复后的
视觉验收，不代表 Windows/Mobile 或原版全量一致。新版本实拍须随下一次 Web
限定发布完成，不能以本批窄检查替代。
