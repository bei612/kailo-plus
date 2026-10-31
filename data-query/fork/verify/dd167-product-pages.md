# DD-167 数据建模组件页产品化（V-SCN-300–304）

设计：`.design/20-Kailo视觉设计系统.md` §15、`.design/07-组件接入标准.md` §4.8.10。
分支 `feat/component-frontend-overhaul-wren`（基线 `f88c2fff8`，含 DD-167 桥接与 DD-165 计量）。
release：`fork/release/manifest.native-page.json` `1.7.0-native-page`，追加
`frontendPresentationContract.preferences = [appearance.listDensity]`（与云盘、知识工程逐字相同）。

## 改动

| 能力 | 实现 |
|---|---|
| 产品名 | `kailoI18n` componentName 数据建模 / Data Modeling（`<title>`、管理提示、分享通知、额度拒绝） |
| 信息架构 | 页头标签 问答 · 看板 · 知识 · API（API 仅管理员，`hooks/useKailoPage.ts` `KAILO_TABS`）；看板不再是窗格行；知识页工具栏分段“问答对 / 指令”；知识、API、看板不再有列表窗格 |
| 线程窗格 | `components/sidebar/Home.tsx`：窗格头 40（Overline + 总数 + 新建图标按钮）、行 32、↑↓/Enter、行内“更多”悬停出现、底部紧凑分页 `‹ x / y ›`；服务端分页 GraphQL `threadPage(pagination:{offset,limit})` → `{items,total,hasMore}`，按最近活动倒序（`threadRepository.listPageByRecentActivity`），页码在路由 `tp` |
| 重命名 | 声明 `prompt` 特性；`kailoHost.prompt()` → `KailoEmbed.prompt()`，宿主不支持时自绘 Kailo 样式对话框；结果经 Kailo toast |
| 列表 | `components/kailo/KailoList.tsx`：工具栏（300 ms 去抖检索、筛选、清除筛选）、分页条（共 N 条、第 x / y 页、页码含省略、上一页/下一页、每页 20/50/100）；`hooks/useListRoute.ts` 把 page/size/q/筛选写入路由查询（shallow replace）；问答对、指令为有界集合客户端计数分页；API 记录服务端分页，筛选 类型/状态/时间/对话，详情为无遮罩侧板 |
| 状态 | 首次读取同形骨架行；刷新 2 px brand 进度条（10 s 后“仍在载入…”），窗格与知识列表翻页保留旧行降到 60%；读失败内联“未能载入…”+原因类别+重试（`classifyLoadError`），线程与看板读失败不再跳回 /home；403/`KAILO_ADMIN_REQUIRED` 为锁形“你没有访问…的权限 / 请联系管理员”；筛选为空“没有符合条件的…”+清除筛选；读操作网络错误不再弹 toast（只对 mutation 弹） |
| 主题/语言/字号 | `useKailoSession` 订阅 `onChange`（theme/locale/fontSize/zoom）与 `onPreferencesChange`（listDensity → `<html data-kailo-list-density>`，行 40/32）；`styles/kailo/product.less` 把 antd 各组件字号改为 `--kailo-text-*`，controls/overlay/chart 及 styled 组件中写死的 px 字号改为令牌；`#__next` 与浮层内容施加 `zoom: var(--kailo-zoom)`，满屏高度改 `--kailo-vh`；语言切换只换 Next locale，不重载页面与数据 |
| 图表 | `components/chart/theme.ts`：运行时读令牌构造 Vega 配置（画布透明、文字 foreground/muted、网格与轴线 border、系列 chart-1…5 及其明暗变体、`--kailo-font-sans`、字号乘 type scale、去视图边框），`presentationKey` 变化即重绘 |
| SQL/代码 | ace `tomorrow` 类的 Kailo 明暗配色（`product.less` §14），编辑器与代码块同源 |
| DD-165 | 服务端额度拒绝文案改“数据建模”；前端按 `extensions.decision` 用当前 Kailo 语言出文案（`usageRefusalKey`），不再依赖服务端语言 |

兼容：GraphQL 新增 `threadPage`/`ThreadPage`（`threads` 保留）；客户端 `Threads` 操作改读 `threadPage`。
API 记录为私有数据，刷新时不保留旧行（身份核验前不显示上一身份的行），以骨架代替。

## 测试

见下节“CI 结果”。新增 `src/kailoList.test.ts`（分页/路由状态/错误分类/额度文案/图表令牌主题）；
更新 `kailoAdminSurface.test.ts`（版本 1.7.0、四个标签）、`kailoIntegration.test.ts`、`kailoNotifications.test.ts`、
`kailoUsage.test.ts`（产品名）、`viewMetadata.test.ts`（antd mock 增加 Select）。

## CI 结果

（待补）
