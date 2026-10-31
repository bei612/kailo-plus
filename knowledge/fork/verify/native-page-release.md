# 知识库原生页面 release 版本（DD-127、DD-133(5)）

## 1.8.0-native-page（2026-10-30，DD-167 组件页产品化，V-SCN-300–304）

分支 `feat/component-frontend-overhaul-weknora`（基线 f88c2fff8）。`manifest.native-page.json` 升到 `1.8.0-native-page`，
`frontendPresentationContract.preferences` 新增与云盘、数据建模逐字相同的 `appearance.listDensity`（舒适 40 / 紧凑 32）。
`kailo-embed-features` 增加 `prompt`；`<title>` 与白标产品名改为“知识工程 / Knowledge Engineering”，“知识库”继续指单个对象。

| 页面或能力 | 改动（Kailo 壳内；非 Kailo 原生视图不变） |
|---|---|
| 页头标签 | 只剩 知识库 · 对话（`src/kailo/page.ts`），产物/Agent 不再是标签 |
| 知识库列表 | `src/kailo/ui/KailoKbBrowser.vue`：范围分段 全部/我创建的/共享给我/收藏（带计数）、300 ms 去抖检索、排序（最近更新/名称/创建时间）、卡片网格或表格；卡片含名称、两行说明、类型徽标（文档/问答/Wiki/待完成设置）、文档数、相对更新时间（悬停绝对时间）、所有者；更多菜单 打开→置顶→收藏→副本→设置｜删除；客户端分页（网格 24/48/96、表格 20/50/100）；`scope/q/sort/view/page/size` 写入路由 query |
| 知识库详情 | 页头面包屑“知识库 › 名称 › 文件夹”；文件夹树为 264 列表窗格；默认表格视图，行高随列表密度；服务端分页替换无限滚动（`page/size/view` 入 query，筛选/检索/换目录回第 1 页，越界回末页）；翻页保留旧行 60% + 2 px 进度条 |
| FAQ | 同样服务端分页、内联错误、筛选空态；原生面包屑与副标题在壳内隐藏 |
| 对话 | `src/kailo/ui/KailoChatPane.vue` 替换原生侧栏：窗格头“对话 + 总数 + 新建”、按时间分组、紧凑分页“‹ x / y ›”、置顶/重命名（`KailoEmbed.prompt`，宿主不支持时 `KailoPromptHost.vue` 自绘）/删除（Kailo 确认 + Toast）；新对话空态“向知识库提问” + 推荐问题 |
| 状态 | `KailoStateView.vue`：首次空/筛选空/只读空/读取错误（原因类别 + 重试，不弹 Toast、不跳回列表）/权限不足（403、`KAILO_MANAGED`、`KAILO_ADMIN_REQUIRED`，锁形插画，无重试）/未配置；`src/kailo/loadState.ts` 分类，`utils/request.ts` 为网络/超时错误附 `kind` |
| 主题/语言/字号 | `bridge.ts` 改用 `onChange`（旧运行时回落 theme/locale 监听）；TDesign `--td-font-size-*` 与 `--app-text-*` 指向 `--kailo-text-*`；覆盖层写死的字号换成令牌；Kailo 模式下 `html { zoom: var(--kailo-zoom) }`，原生字号 zoom 关闭（`useFont.ts`） |
| 列表密度 | `src/kailo/preferences.ts` 读 `getPreferences/onPreferencesChange`，写 `data-kailo-list-density` 与 `--kailo-list-row` |
| DD-165 额度 | 拒绝文案改“知识工程问答额度”；错误 `details.kailo_usage` 带决策，前端在输入框上方原位提示，文案取当前 Kailo 语言（切换即重排） |

**有界集合说明**：知识库列表在客户端分页，依据是同一空间的知识库全量本就由页面（对话的知识库选择器）一次取回；服务端未强制 ≤1000 上限，记为后续项。

**测试**（CI 节点，归档树，容器内）：见下方“结果”。

## 1.7.0-native-page（2026-10-30，DD-138(6) 管理面）

`fork/release/manifest.native-page.json` 从 `1.6.0-native-page` 升到 `1.7.0-native-page`：
`frontendPresentationContract` 新增 `adminSurfaces`（`07` §4.8.5）。manifest 内容变了，同一 id 下 Core 会拒绝，
所以必须换版本（release id 随 `weknora@1.7.0-native-page` 重新推导）；登记顺序同下文 1.3.0 节。

| key | 分类 | 路径 | 权限 | 访问 | 组件内呈现 |
|---|---|---|---|---|---|
| `models.catalog` | MODELS | `/platform/admin/models` | TENANT_MANAGE | READ_ONLY | 模型定义列表（名称、提供方、来源、上下文窗口/维度），不含端点与密钥 |
| `storage.backends` | STORAGE | `/platform/admin/storage` | TENANT_MANAGE | READ_ONLY | 文件存储与向量库定义列表，不含连接参数与凭据 |
| `indexing.parsers` | INDEXING | `/platform/admin/parsers` | TENANT_MANAGE | READ_ONLY | 解析服务连接状态与各解析引擎（可用性、文件类型） |
| `answers.webSearch` | INTEGRATIONS | `/platform/admin/web-search` | TENANT_MANAGE | EDITABLE | 原 `WebSearchSettings` |

- **撤下 `answers.skills` 与 `answers.mcpServices`（DD-163，design-authority 5db45c5 的 `07` §4.8.5 归属表与 §4.8.8）**：
  问答技能（连同其安装目标沙箱）与 MCP 服务只服务于 Kailo 模式下已关闭的 Agent 模式（`internal/middleware/kailo_converge.go`），
  因此不是管理面。`/platform/admin/skills`、`/platform/admin/mcp-services` 成为未声明路径：nginx 302 回首页，SPA 显示空态。

- **权限取 `TENANT_MANAGE`**：每个 binding 一个专用实例，但实例镜像的是整个 Kailo Tenant 的目录（Tenant 空间与
  每个 Workspace 空间，`07` §4.7.4），只有 Tenant `ADMIN` 在实例内成为 `admin`（Workspace 级 `ADMIN` 不提升原生角色）；
  这些设置作用于整个实例而不是单个 Workspace。若用 `BINDING_MANAGE`，Workspace 管理员会看到自己在组件内无权写的管理面。
- **单一事实**：声明表在 `frontend/src/kailo/adminSurface.ts`；manifest 与 `frontend/docker-entrypoint.sh` 的 nginx
  白名单各有一份，`frontend/src/kailo/adminSurface.test.ts` 校验三者一致与 Core 合同（字段顺序、键形、保留首段、路径、长度）。
- **页面**：`/platform/admin/*` 是平台外壳之外的独立路由（`src/kailo/AdminSurface.vue`），不渲染菜单、设置导航、个人菜单、
  命令面板；只认 `KailoEmbed.adminSurface()` 给出且与路径匹配的 key，否则显示“该管理项不可用”空态；内容就绪后
  `setPage({title})`。READ_ONLY 以定义列表呈现（`src/kailo/adminReadOnly.ts`），无禁用输入框。
- **原生控制台关闭（Kailo 模式）**：
  - 前端：用户菜单只剩空间行（无空间设置、模型、技能、全部设置、系统管理）；平台外壳不挂载 Settings 对话框；
    `uiStore.openSettings` 只提示“请管理员在{平台}管理区完成设置”；业务页的“去设置/添加模型/管理实例/集成渠道”入口移除，
    Agent 编辑器内的沙箱、技能设置链接与技能安装入口也移除；
    路由守卫把 `/platform/settings*`、`/platform/system*`、`/platform/integrations*`、`/platform/tenant*` 送回知识库首页。
  - nginx（返回任何页面之前）：`docker-entrypoint.sh` 在 `KAILO_MODE=true` 时生成 `/etc/nginx/kailo/admin-routes.conf`
    （`nginx.conf` 以 `include /etc/nginx/kailo/*.conf;` 引入，非 Kailo 模式只写注释）：上述前缀及 `/platform/admin/`
    其余路径 302 到 `/platform/knowledge-bases`；每个声明路径为 `location =`，`$arg_kailo_admin_surface` 不等于该路径的
    key 时 302。Go 内嵌静态服务（`internal/router/static.go`）只在 Lite 版本启用，Kailo 部署不经过它。
  - 服务端写拒绝（`internal/middleware/kailo_managed.go`，403 `KAILO_MANAGED`）：模型增删改、调试、清除凭据、
    WeKnora Cloud 凭据、旧版 KB 初始化（会用原始端点/密钥建模型）、Ollama 检查/下载与各类“带密钥测试”；向量库与存储后端的
    增删改测、默认后端、`storage-engine-config`、存储检查；`parser-engine-config`、解析引擎检查、docreader 重连；
    `/system/admin/*` 全部（系统管理员、全局设置、运行队列、平台 API key、平台审计）；工作区 API key 与 API principal 写、
    工作区审计读；DD-163 撤下的技能、沙箱与 MCP 服务的写：技能目录登记/安装/删除，沙箱配置的新建/修改/删除/workspace-policy/
    模板查询、`/sandbox-configs/:id/skills` 下全部写（上传、reinstall、guidance、stop、PATCH、DELETE）、沙箱检查，
    MCP 服务的新建/修改/删除/测试/元数据刷新/使用说明生成/凭据写/工具审批策略/OAuth 授权与吊销。
    `PUT /models/:id/credentials` 保持路由：它是 DD-128 投递通道（`fork/deploy/provision.py`），
    handler 在 Kailo 模式只允许 `managed_by=kailo-model-route` 的模型写入，其余 403。
  - 保留：模型/存储/解析的读接口、知识库与 Agent 内选择已投影模型（`PUT /initialization/config/:kbId`、`PUT /knowledge-bases/:id`）、
    技能、沙箱、MCP 服务的读接口；`answers.webSearch` 的写接口；MCP 发布（`/mcp-endpoints` 的原生写与 `/mcp/:endpoint_id`
    发布面，`08` §5）。对话历史设置在 Kailo 模式下只删入口，服务端写接口未改（业务配置，非实例运维）；记忆、渠道集成由
    DD-163 的 `kailo_converge.go` 关闭。
- **验收（发布后）**：Kailo 模式部署中
  `curl -si '<origin>/platform/settings?section=models'`、`/platform/system`、`/platform/admin/models`（无参数）、
  `/platform/admin/models?kailo_admin_surface=answers.skills`、`/platform/admin/skills?kailo_admin_surface=answers.skills` 均为 `302 Location: /platform/knowledge-bases`；
  `/platform/admin/models?kailo_admin_surface=models.catalog` 为 `200` 且返回 SPA `index.html`；
  以 Tenant admin 会话 `POST /api/v1/models`、`PUT /api/v1/tenants/kv/parser-engine-config`、`POST /api/v1/mcp-services`、
  `POST /api/v1/skills/catalog` 为 `403 KAILO_MANAGED`。

## 1.6.0-native-page（2026-10-30，验收批次 5 复验）

1.5.0（release `2a94588f-5681-517d-add3-665cc3eed71e`，`knowledge-native-ui` `sha256:92af646f…`）登记后，发布 `de21965c1`（源 `4009e1c6`，含验收批次 5 修复与 Buzz 第 11 轮）
重建该镜像为 `sha256:9940a69b…` 并已部署。manifest 升到 `1.6.0-native-page`（release id
`fe333662-3d5b-588b-abd0-3649297db515`），按 `--source-commit de21965c1e202e3bca724dcc4c97c199186d666b` 渲染、登记、审批并换绑。

## 1.5.0-native-page（2026-10-29，验收批次 5，发布 79f63671）

1.4.0（release `ce3ebc65-e30d-5a7d-a778-1f9bd045fe69`，`knowledge-native-ui` `sha256:8d903111…`）登记后，发布
`79f636714`（源 `1f932e24`，含 DD-157 第 3 轮图标修复）重建该镜像为 `sha256:92af646f…` 并已部署
（CI 节点回读 `kailo-knowledge-frontend-1` 运行该 digest）。1.4.0 不得复用，manifest 升到 `1.5.0-native-page`
（release id `2a94588f-5681-517d-add3-665cc3eed71e`），按 `--source-commit 79f636714e1bf71a2e368720a664deb4ef1e5d83`
渲染、登记、审批并换绑。

## 1.4.0-native-page（2026-10-29，验收批次 5）

`weknora@1.3.0-native-page`（release `9a641509-28f0-5d1f-8c60-52b7d9b3afb4`）登记的 `knowledge-native-ui` 为
`sha256:d274e73c…`（发布 `166fa3557`）。发布 `1dff0ea54` 的 pin 改为 `sha256:8d903111…`，并已由
`deploy/components/component-deploy.sh knowledge 1dff0ea54…` 部署（CI 节点回读 `kailo-knowledge-frontend-1` 运行该
digest）。1.3.0 已登记，不得复用，manifest 升到 `1.4.0-native-page`（release id
`ce3ebc65-e30d-5a7d-a778-1f9bd045fe69`），按 `--source-commit 1dff0ea54cd5db49eb94531a47c987d231dc5eb8` 渲染、登记、
审批并换绑。之后若有改变该 UI 镜像的合并（如 DD-157 第 3 轮），下次部署再递增版本。

## 1.3.0-native-page（2026-10-23，验收批次 3）

`weknora@1.2.0-native-page`（release `2d153bbf-00f5-508e-bf1d-cfa9dee12719`）登记于提交 `8b8dfd4e7`，当时
`knowledge/fork/upstream.yaml` 的 `knowledge-native-ui` 为 `sha256:24b11bdb…`；之后 `06a3226f1` 起改为并部署
`sha256:52d8232b…`（CI 节点只读回读：`kailo-knowledge-frontend-1` 运行该 digest），release 记录的产物摘要与实际
部署不一致。`fork/release/manifest.native-page.json` 升到 `1.3.0-native-page`（release id
`9a641509-28f0-5d1f-8c60-52b7d9b3afb4`），下一次发布后按当时的 digest 重新登记并换绑。

版本号由什么驱动（`tools/component-release/render.mjs`）：

- `version` 只来自仓库内手工维护的 `<组件>/fork/release/manifest.native-page.json`，没有任何从镜像、commit
  或构建自动推导的成分。release id = `uuidv5(434ca4dc-…, "<componentTypeKey>@<version>")`，同一版本永远是同一 id。
- 该 manifest 的 `adapterBuildRef` 槽填的是**实际提供原生页面的服务产物摘要**（`nativeServiceArtifact`），
  缺省取当时 `<组件>/fork/upstream.yaml` 中该产物的 `artifact_digest`（或 `--receipt` 显式给出）；
  `sourceCommit`、`bindingConfigSchemaDigest` 同样随渲染变化。
- Core 对同一 id 下任何内容变化都拒绝（TargetStateConflict，`component-register.mjs`：“a different manifest is
  registered under this id/version; bump the version”）。所以**原生页面服务镜像每次重建并部署后，都要递增
  manifest 版本**，再按新版本渲染、登记、审批并把 binding 换绑到新 release；旧 release 与旧 binding 不受影响。
- 顺序：所有会改变该 UI 镜像的分支合并 → CI 重建并回填 `upstream.yaml` 的 `artifact_digest` → 发布部署并回读
  运行容器 digest 与 `upstream.yaml` 一致 → `render.mjs --material native-page --source-commit <部署 commit>`
  → 登记/审批 → 换绑。若登记前又有改动该镜像的合并，再递增一次版本，不复用已登记的版本。
