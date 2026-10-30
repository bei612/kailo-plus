# 知识库原生页面 release 版本（DD-127、DD-133(5)）

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
