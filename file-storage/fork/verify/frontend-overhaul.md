# 云盘原生前端产品化（DD-167）验证记录

关联：DD-167（design-authority c1a6dd420）、`20` §15.1–15.4、`07` §4.8.10；验证场景 V-SCN-300–304。
分支 `feat/component-frontend-overhaul-cells`。本记录只描述本分支的改动与在 CI 节点上的实际运行结果；未部署到生产。

## 1. 改动（Kailo 模式；独立运行的 Cells 不变）

| 能力 | 实现 |
|---|---|
| 信息架构 | 页头标签 主页 · 所有文件 · 收藏（Kailo 绘制；顶层访问时页面以同一页头数据自绘 `KailoTopHeader`）；Kailo 模式下框内与顶层都不出现原生顶栏、图标栏与个人外壳（`RailPanel`）。所有文件 = 左侧“位置”窗格（264，可拖 220–360，窗格头 40：Overline 标题 + 计数 + 一个图标按钮）+ 工具栏 44（业务内检索 300 ms 去抖、选中时的选择操作、视图切换、排序、详情开关）+ 单行表格（名称+类型图标、修改时间（相对时间，悬停绝对时间）、大小（右对齐等宽数字）；列头 Overline，悬停/当前排序显示箭头）+ 分页条；详情侧板贴边，仅在有选中项时出现。主页 = 位置卡片（个人文件、公共文件、共享空间，显示项目数/空间数）+ “最近使用”分页列表；收藏 = 同规格列表 + 分页；搜索结果 = 名称、所在位置、修改时间的分页列表。 |
| 列表与分页 | `MetaNodeProvider` 保存服务端 `Pagination.Total`（`paginationData.count`）；Kailo 模式按每页条数请求（列表 20/50/100、网格 24/48/96，存于布局偏好 `FSTemplate.Kailo.PageSize`）；分页条“共 N 条 · 每页 n 条 · 第 x / y 页 · 上一页/页码（>7 省略）/下一页”，单页只保留总数；页码保存在 Cells 节点上下文（后退/前进回到同一页）；切换视图回到第 1 页。搜索：`SearchApi` 增加 `From`，`withSearch` 增加 page/pageSize，总数取 `Total`。行高随 `appearance.listDensity`（舒适 40 / 紧凑 32，`<html data-kailo-density>`）。 |
| 状态 | 首次读取：同形骨架（行或卡片，最多 10）；翻页/排序/刷新：保留旧行 60% 不透明 + 2 px 品牌进度条，10 s 后“仍在载入…”；空：首次为空（上传主操作）、只读成员（无创建入口，“有人分享给你后会显示在这里”）、回收站、检索无结果（小号空态）；错误：内联“未能载入…”+ 原因类别（网络不可达/服务暂不可用/请求超时/内容已不存在）+“重试”，Kailo 模式下列表读取使用静默客户端，不弹 Toast；权限不足：`RestClient.handleError` 保留 HTTP 状态，403（含 `KAILO_MANAGED`、`KAILO_ADMIN_REQUIRED`）显示锁形空态与“请所有者分享给你/请联系管理员”，不给重试。 |
| 主题/语言/字号 | `kailo-cells.js` 的 `presentation()` 增加 `fontSize/zoom/typeScale`，ThemeBuilder 的 key 含字号并以 `13 × typeScale` 重建 MUI typography；覆盖层中所有写死的 px 字号改为 `--kailo-text-*`（行高改为相对值）；`zoom` 施加在 body（应用根），浮层随之缩放；Chrome 标准化 CSS zoom 下矩形与指针坐标按 body 像素报告，保证菜单/弹出层定位正确。全部即时生效不刷新。 |
| 新建文件夹/文件 | `kailo-embed-features` 声明 `prompt`（`kailo-embed.go` 与 Go 测试）；新建文件夹走 `KailoEmbed.prompt()`（标题“新建文件夹”、标签“名称”、默认值不与现有重名、确认“新建”），宿主不支持时自绘 Kailo 样式对话框（Esc/遮罩取消、空名或超长禁用主操作）；重名/非法名/服务端错误经 Toast 说明原因，成功 Toast“已新建文件夹「名称」”。新建文档模板同样处理；页头“新建文档”为次操作。 |
| 删除结果 | 删除成功 Toast“已删除 n 项 / 已将 n 项移到回收站”，失败“未能删除：原因”；清空回收站同理。 |
| 文档编辑 | `editorConfig.customization.features.featuresTips=false`（上游 `Common.UI.FeaturesManager.isFeatureEnabled('featuresTips', true)`，web-apps Toolbar.js），`rs`（editorConfig.region）随 Kailo 语言；界面语言 `lang/ui` 与明暗主题（`thm` + `Kailo_Presentation` 消息）已随 Kailo。 |
| 发布声明 | `manifest.native-page.json` 版本 `1.6.0-native-page`，`preferences` 追加 `appearance.listDensity`（与三组件一致）。 |
| 文案 | Kailo TEXT 表新增键全部中英同源，用“你”、无感叹号、英文 sentence case，产品名“云盘 / Files”。 |

## 2. 测试（CI 节点容器）

见 §4 的原始结果。命令：`~/kailo-acceptance/component-frontend-overhaul/cells/scripts/tests.sh <branch>`（node:22-alpine 跑 assets 全量 vitest；golang:1.26.8-alpine `CGO_ENABLED=0 go test ./frontend/web/`），以 `~/kailo-acceptance/ops/ci-slot.sh` 排队执行。

新增测试：`kailo.embed/kailo-cells.test.js`（DD-167 一组：字号/缩放、密度、分页与页码省略、错误类别、删除文案与名称校验、自绘对话框与宿主 prompt、顶层页头）、`gui.ajax/.../kailo/paging.test.js`（文件夹总数、页码/每页请求）、`editor.onlyoffice/res/js/launch.test.js`（featuresTips、region）、`frontend/web/kailo-admin_test.go::TestReleaseManifestDeclaresListDensity`、`kailo-embed_test.go`（features 含 prompt）。

## 3. 构建与截图

- GUI 资源：`~/kailo-acceptance/component-frontend-overhaul/cells/scripts/build.sh`（buildx-dockerfile `--target frontend`），产物目录 `~/scratch/cfo-cells/assets-<commit12>`。
- Kailo Web（宿主侧 DD-167）：`build-web.sh` → `~/scratch/cfo-cells/web-dist`。
- 截图：`shots.mjs`（qa 账号，`/plug/` 与 `/app/assets/` 路由到本地产物，索引页注入 `prompt` 声明；403/503 以路由注入列表接口），目录 `~/kailo-acceptance/component-frontend-overhaul/cells/shots-<commit12>/<明暗>-<语言>-<字号>/`。

## 4. 结果

（见下方追记。）
