# DD-138 第三阶段：组件管理面并入 Kailo 管理区（验证记录）

设计依据：design-authority `f3e3855c`（`.design/07` §4.8.5 管理面合同与系统级设置归属表、`03`
ComponentAdminSurfaceDeclaration、`02` DD-138(6)(9)(10)、`16` V-SCN-269/270、`20` §13.2 管理面页），随后
`5db45c5`（DD-163：知识库问答技能与 MCP 服务撤出管理面）与 `a1b5369`（文档编辑不贡献管理面）。
能力记录：`tools/traceability/component.admin_surfaces.yaml`。

## 源码范围（平台）

- 契约：`ComponentAdminSurfaceDeclaration`（`ComponentAdminCategory`、`ComponentAdminPermission`、
  `ComponentAdminAccess`）、`AdminSurfacePage`、`ApplicationNativePage.adminSurface`；四侧生成物由 CI 节点检查镜像内
  `tools/gen.sh` 与 `tools/gen-platform-i18n.py` 生成。
- Core：`component_release.rs` 登记时校验 `frontendPresentationContract.adminSurfaces`（只随 `KAILO_EMBED` 与
  `NATIVE_PAGE`，≤12，键形同偏好键且拒绝成员/角色/邀请/空间/组织类首段，分类、权限、可写性为封闭枚举，路径规则，
  中英文标题与说明长度），任一不符整体拒绝；`admin_surface.rs` 提供 `GET /api/v1/admin-surfaces`（Tenant 与所给
  Workspace 的 ACTIVE binding，逐对象 FullyConsistent `manage`，检查不可用时整体失败，不含 URL、类型键与配置）；
  `application_page.rs` 在 `?adminSurface=` 时以声明所需权限的 fresh `manage` 代替 `discover`，`url` 为 origin 加声明
  路径并附 `adminSurface`。不新增迁移、动作键、Workflow kind、SpiceDB 关系或计量。
- client-kit：`kailo-embed.js` 的 `adminSurface()`（`kailo_admin_surface` 只接受恰好一个合法键，绑定到启动路径，
  新的 Kailo 启动不带它时清除）；`WorkspaceManagementPanels`（Web 与 Desktop 共用）按 Kailo 管理分类分组列出，
  `NativeApplicationPage` 以 DD-157 外壳载入，页头“管理 › 分类 › 标题”，只读徽标，忽略组件标签条。

## 组件范围

| 组件 | 管理面（键 · 分类 · 路径 · 权限 · 可写性） | 原生控制台关闭与写拒绝（Kailo 模式，服务端） |
|---|---|---|
| 云盘 `cells@1.5.0-native-page` | `storage.dataSources` · STORAGE · `/kailo-admin/data-sources` · TENANT_MANAGE · READ_ONLY；`files.metadata` · SYSTEM · `/kailo-admin/metadata` · TENANT_MANAGE · EDITABLE | IndexHandler 在返回页面前把 `/settings`（含 `ws-settings`）与未声明或键不符的 `/kailo-admin/*` 302 到 `/`；Kailo 管理的账号写数据源、建存储桶、加密密钥与数据源重同步返回 403（部署对账的安装管理员 PAT 与启动时 `datasource ensure` 不受影响） |
| 知识库 `weknora@1.7.0-native-page` | `models.catalog` · MODELS · READ_ONLY；`storage.backends` · STORAGE · READ_ONLY；`indexing.parsers` · INDEXING · READ_ONLY；`answers.webSearch` · INTEGRATIONS · EDITABLE（均 `/platform/admin/*`、TENANT_MANAGE） | nginx（入口脚本生成）把 `/platform/settings|system|integrations|tenant` 与未声明或键不符的 `/platform/admin/*` 302 到知识库首页；`KailoManagedGuard` 以 403 `KAILO_MANAGED` 拒绝模型增删改与带密钥测试、存储/向量库/解析写、`/system/admin/*`、工作区 API key 与审计、技能目录、沙箱配置与 MCP 服务写；`PUT /models/:id/credentials` 只允许 Kailo 路由模型（DD-128 投递）；`/mcp-endpoints` 写与 `/mcp/:endpoint_id` 保留 |
| 问数 `wren@1.6.0-native-page` | `dataSources.connection` · DATA_SOURCES · `/kailo-admin/data-source`；`semantic.modeling` · DATA_SOURCES · `/kailo-admin/modeling`；`system.project` · SYSTEM · `/kailo-admin/project`（均 BINDING_MANAGE、EDITABLE） | middleware 在身份校验后把 `/modeling`、`/setup/*` 与未声明或键不符的 `/kailo-admin/*` 307 到 `/home`；业务页无建模标签、设置对话框与发布按钮，未接数据源时显示 Kailo 空态；API 调用历史只给 `manage`；学习记录接口拒绝 |

文档编辑不贡献管理面：原生管理面板已在打包时移除（DD-35），编辑器个人设置由云盘 release 声明。

## CI 记录（CI 节点，2026-10-30，分支 `feat/dd138-phase3-admin` @ `dca4f5c8`，检查镜像按该提交的 `tools/check.Dockerfile`）

- `tools/check.sh lint contract verify trace docs`（设计 `5db45c5`，发布证明库只读挂载）：lint 全部 PASS（cargo fmt/clippy、
  gofmt/vet、tsc、web-client tsc、dart analyze、wren-ui prettier/next lint/tsc、buzz web/admin-web tsc）；contract PASS（四侧生成物同步）；
  verify 中 cargo test、go test、dart test、knowledge vue-tsc 与 tsx --test、file-storage 嵌入层 vitest/eslint PASS，
  `pnpm -r test` 与 web-client vitest 各有一条与本批无关的用例在满载时超时（`snapshot-send.test.tsx`、`Composer.test.tsx`），
  同一工作区单独重跑均通过（client-kit 5 个文件 85 项含 admin-surfaces/members/kailo-embed-runtime/native-embed-host，Composer 91 项）；
  trace PASS（44 条追溯记录、能力注册表一致）；docs PASS。
- 不在 check.sh 范围内的组件测试：云盘 Go（frontend/web、discovery/config/rest、scheduler/jobs/rest、common/auth）全过；云盘 vitest
  （access.settings 管理面、kailo.embed、editor.onlyoffice）4 个文件 59 项全过；知识库 Go（CGO，middleware、handler/...、router）全过；
  问数 jest：kailoAdminRead、nativeLearning、kailoAdminSurface、viewMetadata、kailoIntegration、modeling、kailoShell 全过。
  `middleware.test.ts` 在 CI 节点因 JWKS 取钥失败而大量失败，`4009e1c6` 基线同样失败 85 项（`NATIVE_IDENTITY_UNAVAILABLE`），不作判据；
  问数关闭逻辑由 kailoAdminSurface.test.ts 与下文实拍覆盖。

## 本地构建实拍（未部署；`~/kailo-acceptance/admin-unify/{light,dark}`）

Web dist、知识库原生 UI 镜像、问数 UI 镜像与云盘 GUI 资源均由 `dca4f5c8` 在 CI 节点本地构建；Playwright 以 qa-1（Tenant 管理员）
登录生产 Web，`/app/assets` 由本地 dist 提供，知识库与问数请求转发到用本地镜像起的临时容器（问数另起一份同配置的临时原生网关），
云盘 `/plug/` 由本地资源提供；Core 的两个新读接口未部署，按本分支规则以生产 descriptor 加声明路径模拟（Core 侧由单元测试覆盖）。
明暗各 10 张：管理区按“模型/数据源/存储/索引与解析/集成/系统”分组，条目只显示声明标题与呈现类别名；九个管理面页头均为
“管理 › 分类 › 标题”，只读面带“由 Kailo 管理 · 只读”，组件只渲染单项功能。V-SCN-270 直达探测：问数 `/modeling`、`/setup/connection`、
无键或键不符的 `/kailo-admin/modeling` 落到 `/home`，带正确键放行；知识库 `/platform/settings`、`/platform/system`、无键
`/platform/admin/models`、`/platform/admin/skills`、`/platform/admin/mcp-services` 由 nginx 302 到知识库首页，`models.catalog`、
`answers.webSearch` 带键 200。云盘 `/settings` 的服务端重定向由 Go 测试覆盖（生产 Cells 未换新服务端，未实拍）。

## 合并后需要的构建与部署

Core（新路由与校验）、Web 与 Desktop（管理区与外壳）、`file-storage-service`、`knowledge-native-ui` 与 `knowledge-service`
（KailoManagedGuard）、`data-query-ui`；随后按 RB-11 以 `cells@1.5.0-native-page`、`weknora@1.7.0-native-page`、
`wren@1.6.0-native-page` 渲染、登记、审批并换绑原生页面 release。V-SCN-229/269/270 在部署后以 qa-1/2/3 复验。
