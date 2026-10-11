# 原搜索命中导航的 HTTP 宿主恢复

2026-10-11。关联 DD-75、SS-WEB-RELAY 与用户固定原版一致性要求；
归属既有 Buzz Client Surface／Web BFF 协作接缝。

## 实际页面与固定来源

普通受控 OIDC 账号在实际 HTTP 入口检查在线源码
`5548c88b0382b1467b7a4d1d83f4178856866ccf`，浏览器 build-info 为
`sha256:8166db92380310dc9680678b0cd6bb12bc9574ac1ef74cda29119c38380d5ae0`。
同一真实双图消息已完成图库前后切换、115% 缩放、下载、Escape 关闭及焦点返回。
下载事件没有失败，文件 SHA-256 为
`6373a5d305fde15f660dfd8c24067d0535f30cead4c71f1c192b8e44259c1024`。
图库按固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/shared/ui/markdown.tsx::ImageZoomOverlay` 核对原工具栏、键盘与焦点行为；
本批没有图库源码改动，不将这些通过外推到图片复制或其他消息功能。

搜索实际既有 DM 消息后点击结果，搜索关闭但仍留在原频道，显示
“未能载入，结果不明。”。目录、conversation 和搜索读取实际均返回 200；
浏览器 `isSecureContext=false`、`typeof crypto.randomUUID="undefined"`、
`typeof crypto.getRandomValues="function"`。重复点击仍失败，未替换浏览器 Crypto。

固定同一 Buzz commit 的完整路径
`desktop/src/app/navigation/searchHighlightNavigation.ts::createSearchHighlightNavigation`
原样调用 `crypto.randomUUID()`。当前共享迁移保留了这一调用，Web
`web-client/web/src/app/platform-navigation.ts::navigationState` 在真正导航前生成
激活标识，所以非空搜索 query 会在 HTTP 宿主中抛错；普通无 query 链接没有该分支。
这与另批线程来源行的原生频道标识改写无关，不重复修改来源链接。

## 改动、权威与异常边界

唯一生产修改位于
`client-kit/ts/platform/src/react/search/searchHighlightNavigation.ts`：复用既有
`governance.ts::newIdempotencyKey` 的强随机 UUID v4 实现。仅使用其纯 UUID 函数，
没有创建治理意图或另一幂等账本，不加 Math.random／时间戳降级。
差异分类为共享迁移上的已授权宿主适配；原查询 trim、空查询行为、解析规则、
消息定位、重复点击新激活、布局与文案不变。Desktop 原导航薄 re-export 消费同一函数；
Mobile 原生端无变化，不生成组件入口或 WebView。

激活状态由既有导航写入同会话 history，原消息消费者读取，不进入 URL、Core
或业务数据库；切换会话后原 scope 检查仍拒绝旧状态。Web
`PlatformApp::openSearchChannel` 的新鲜目录、当前身份 owner generation、ACTIVE
conversation 和实际参与人检查全部未改，后续 BFF 仍真实授权。撤权、未知状态、
读取失败均不绕过准入；随机源不可用仍抛错而不是伪造成功。没有契约、迁移、
审批、quota、Workflow、外部副作用、终态或兼容窗口新增。

## 实现后的窄验证与破坏验证

Data 原件 `/volumes/data/kailo/tmp/web-search-http.Qz5Bqf`；复用固定 SDK
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
4 CPU、8 GiB memory 与同额 memory+swap、512 PID、UID/GID 1000、无网络。
依赖及输入全部来自已有 Data 缓存和固定 main 导出，只覆盖这两个源码／检查文件。
执行前已核对现有构建、内存和 CPU；容器实际限额已读回。

- `node node_modules/typescript/bin/tsc --noEmit`：`TYPECHECK_EXIT=0`。
- `node node_modules/vitest/vitest.mjs run src/app/platform-navigation.test.tsx
  --no-file-parallelism`：24 passed，`TEST_EXIT=0`，原件 `positive.log`。
  既有真实 TanStack router 消费者检查增加 HTTP 无 randomUUID 的环境参数，
  同时验证频道／DM 路由、UUID 格式、每次激活不同、history 恢复、不把查询写进 URL
  以及会话切换隔离，不 mock 掉生产导航函数。
- 只在私有实际消费包中恢复旧 `crypto.randomUUID()` 后，运行同一套件的
  `-t "carries the original search activation"`：exit 1，secure 1 passed、HTTP
  1 failed、22 skipped；真实调用栈出现 `TypeError: crypto.randomUUID is not a function`，
  导航高亮断言收到 undefined。原件 `negative-randomUUID.log`。
- 还原后 `cmp` 与正式生产文件相同；同一命令 exit 0，2 passed／22 skipped，
  原件 `restored.log`。没有改变超时、断言或浏览器运行时来获得通过。
- Desktop 原独立入口：`node --import ./test-loader.mjs --experimental-strip-types
  --test src/app/navigation/searchHighlightNavigation.test.mjs
  src/app/navigation/searchHitNavigation.test.mjs`：7 passed、0 failed、exit 0，
  原件 `desktop.log`；新增导入的现有 contracts 可解析，原取消／强制重复激活语义保留。
  这不是 Windows 安装包验收。

## 截图证据和未覆盖边界

原件目录 `/volumes/data/kailo/tmp/web-core-visual.qMJ6ew`：
`01-image-gallery-first.png`、`02-image-gallery-second.png`、
`03-image-gallery-zoom.png`、`05-gallery-closed-channel.png` 为对应图库状态；
`06-search-dm-results.png` 是真实命中，`08-search-dm-navigation-failed.png` 是失败。
各图已打开视觉复核；`04` 是关闭动画，不作关闭完成证据；`07` 虽文件名含
highlight，实际上仍为失败频道，不作高亮通过证据。`08` SHA-256 为
`f08fb747788ec5d55575c673978d26d1da29c775205be234c2c67d379c51141a`。
未发送消息、上传图片或发布工作流。当前截图是修复前现网，不是修复后浏览器验收。

源码候选基于 `2cfa7be4751915501ee8f70f81621ab40adc752a`，只选入共享函数、
既有 Web 导航检查和本回执。公共五个已有暂存 blob、其余脏改和发布 pin 不变。
未新建 builder、安装依赖、构建发布或重复全量检查；不声明原版全量一致、
Windows／Mobile 设备验收、三组件接入或生产就绪。
