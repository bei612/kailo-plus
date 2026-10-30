# 知识库：协作与 AI 只有 Kailo 一套（DD-163）

设计权威：design-authority `5db45c5fd`（`02` DD-163、`07` §4.8.8 裁定表、`08` §5、`16` V-SCN-271/272）。
本文件记录知识库在 Kailo 模式（`config.KailoEnabled()`；前端 `isKailoMode()`）下的执行方式与证据。组件不以
Kailo 模式运行时，下列功能保持上游原状。

## 裁定与执行

| 原生功能 | 裁定 | 服务端 | 页面 |
|---|---|---|---|
| 对话：内置“快速问答”的检索问答 | (c) 保留 | `/knowledge-chat` 照常；`agent_id` 只能为空或 `builtin-quick-answer`，带其他 agent、共享来源 `agent_source_tenant_id` 或 `agent_enabled=true` 的请求 `403`（`internal/handler/session/kailo_converge.go`） | 输入区不渲染 Agent 选择与模式切换；store 恒按快速问答、非 Agent 模式取值（含本地存储与旧会话恢复，`stores/settings.ts`）；请求只走 `/knowledge-chat`（`views/chat/index.vue`） |
| 问答设置（快速问答选用的已投影对话模型、检索范围、联网搜索） | (c) 业务设置 | `PUT /agents/builtin-quick-answer` 保留（原 RBAC：管理员） | 快速问答未就绪时：管理员在对话页内打开“问答设置”（复用 `AgentEditorModal`，不跳到 Agent 页）；成员只看到“请联系管理员完成问答设置” |
| “Agent”标签：自定义 Agent 创建、编辑、复制、删除、共享 | (b) Kailo Agent + 知识工具 | `POST /agents`、`POST /agents/:id/copy`、`PUT`/`DELETE /agents/:id`（快速问答的 `PUT` 除外）、`/agents/:id/shares*`、`/shared-agents*`、`/organizations/:id/agent-shares`、`/organizations/:id/shared-agents` 全部 `403` | 部署能力 `agents=false`：菜单、路由守卫与命令面板分组不出现；Kailo 页头分区只有“对话”“知识库”；`/platform/agents` 回到 `/platform/creatChat`；命令面板不再保留 `open-agents` |
| Agent 模式与其运行面（工具审批、MCP 授权、沙箱终端与桌面、本地浏览器、steer） | (b) | `/agent-chat*`、`/agent/*`、`/sessions/:id/steer*`、`/sessions/:id/sandbox/*`（含全局认证之前注册的终端与桌面 WebSocket）、`/sessions/:id/local-browser`、`/local-browser/*`、`/me/browser*` `403` | 无入口；Wiki 页的“修复助手”（内置 wiki fixer 的 Agent 运行）不渲染 |
| 知识工具 `ask`（MCP 发布面） | 通道保留 | Kailo 模式下不论端点配置哪个 agent，一律以快速问答作答（`internal/mcpserver/tools_ask.go`） | — |
| “产物”库 | (b) | `/artifacts*`、`/sessions/:id/artifacts*`、消息产物与下载 `403` | 分区与菜单不出现；`/platform/artifacts` 回到对话首页 |
| 长期记忆 | (a) | `/memory/*` 与 `PUT /tenants/kv/memory-config` `403`；记忆服务在 Kailo 模式下视空间开关为关，不抽取、不注入（`internal/application/service/memory/service.go::workspaceConfig`） | 个人与空间记忆设置不出现（个人项早已隐藏，设置对话框由 DD-138(6) 关闭） |
| IM 集成 | (a) | `/im/callback/:channel_id`（全局认证之前）、`/agents/:id/im-channels`、`/im-channels*`、`/wechat/*` `403`；Kailo 模式启动时不加载、不启动任何渠道，`StartChannel` 返回 `ErrIMClosedByKailo`（`internal/im/service.go`） | 部署能力 `integrations.im=false` |
| 网页嵌入 | (a) | `/embed-frame-policy`、`/embed/:channel_id/*`（全局认证之前）、`/agents/:id/embed-channels`、`/embed-channels*` `403` | 部署能力 `integrations.embed=false` |
| 问答技能、MCP 服务、联网搜索、沙箱的实例配置 | (d) DD-138(6) | 不在本批关闭；技能与 MCP 服务的管理面撤下与写接口关闭由 DD-138 第三阶段执行（`07` §4.8.5 归属表已随 DD-163 修订），联网搜索保留为管理面 | — |
| 原生 MCP 发布面 `/mcp/:endpoint_id`、`/mcp-endpoints` | 通道保留 | 不关闭：前者是 Kailo Agent 知识工具与“搜索全部”的后端，后者被发布流程（`tools/component-release/flow/receiver-knowledge-native.mjs`）用于建立端点 | — |

服务端关闭由 `internal/middleware/kailo_converge.go::KailoConvergeGuard` 统一执行，挂在引擎上、早于任何路由注册
（`internal/router/router.go`），因此在全局 `Auth` 之前注册的 IM 回调、嵌入公开接口、沙箱 WebSocket 与本地浏览器
接口同样被拒绝；拒绝体与 DD-133/138 一致：`403 {"error":"Managed by Kailo","code":"KAILO_MANAGED"}`。

## 数据

关闭项的数据（`custom_agents`、`agent_shares`、`message_artifacts`、`memory_*`、`im_channels`、`embed_channels`
等）留在库中，不删除、不迁移，关闭后没有接口读出。会话与消息保留可读；绑定自定义 Agent 的旧会话继续提问时按快速
问答进行（store 恢复旧会话状态后同样归一到快速问答）。

## 测试

- Go：`internal/middleware/kailo_converge_test.go`（每条关闭路由 Kailo 模式 `403`、非 Kailo 模式放行；保留路由放行）、
  `internal/handler/session/kailo_converge_test.go`（agent 标识、共享来源与 Agent 模式拒绝）、
  `internal/application/service/memory/kailo_converge_test.go`（已开启的空间记忆在 Kailo 模式下不写、不召回）、
  `internal/im/kailo_converge_test.go`（不加载、不启动渠道）、`internal/router/kailo_converge_test.go`（部署能力）、
  `internal/mcpserver/kailo_converge_test.go`（`ask` 只用快速问答）。
- 前端（`tsx --test`）：`src/kailo/converge.test.ts`（分区、菜单、路由、Agent 选择归一、端点、问答设置入口），
  `src/kailo/shell.test.ts` 与 `src/kailo/surface.test.ts` 随之更新（页头分区只剩“对话”“知识库”，命令面板不含 `open-agents`）。
- CI 节点运行结果与截图见下节。

## CI 节点结果（2026-10-30，分支 `feat/converge-native-collab-ai`，源码取自 GitHub）

脚本：CI 节点 `~/scratch/converge/kn-test.sh`（源码经 `git archive` 取自分支提交；Go 用知识库服务构建镜像同一
`golang:1.26-bookworm@sha256:a688600c…`，CGO 开启；前端用 `node:24-bookworm-slim@sha256:ba849c60…`）。

- Go（提交 `99d769e5f`）：`gofmt -l` 无输出；`go vet` 通过；`go test ./internal/middleware/ ./internal/handler/...
  ./internal/router/ ./internal/im/ ./internal/mcpserver/ ./internal/application/service/memory/` 8 个包全部 `ok`；
  `-run Kailo -v` 中本批 6 个新测试与既有 `TestKailoManagedGuard…` 全部 PASS。
- 前端：`tsx --test src/kailo/*.test.ts` 47/47 通过；全部 `src/**/*.test.ts` 784/784 通过；`vue-tsc --build` 退出 0；
  `vite build` 退出 0。
- 截图（本地构建产物）：CI 节点 `~/kailo-acceptance/converge-native/knowledge/{light,dark}/`。Playwright 以
  kailo-qa-1 登录 Kailo，打开知识库原生页；文档、`config.js`、`kailo-embed.js` 与 API 仍取部署的服务，入口模块与全部
  代码块由本地 `vite build` 产物提供（`report.json` 记录被替换的资源）。明暗两套各 4 张：知识库列表、对话页、直接打开
  `/platform/agents` 与 `/platform/artifacts`。结果：Kailo 页头分区只有“对话”“知识库”；对话输入区只有附件、@ 与模型
  选择，没有 Agent 选择与模式切换；两条已关闭路由都回到 `/platform/creatChat`；页面无脚本错误。服务端的关闭以上述
  Go 测试为证，部署后的接口实测随组件重建与发布进行。
