# Codex：SS-COD-TRACE 补丁与 SS-COD-RUNTIME/SS-COD-APP 固定配置核验

基线 openai/codex@`7498521d288b9b3b96ffba4eedf089d8d6e06a84`（`.design/02` §1 Codex 行）。源树由
`UPSTREAM_MIRROR=<本机 openai/codex 克隆> tools/build-upstream.sh --source-only <目录> codex` 重建，与开发树逐文件比对只差 vendor 目标 `kailo/`。以下路径相对 `codex-rs/`。

## 1. SS-COD-TRACE：模型请求带 Core 的 operation trace

补丁 `0001-model-request-traceparent.patch`：

- `model-provider-info/src/lib.rs::ModelProviderInfo::build_header_map` 在合并 `http_headers`/`env_http_headers` 之后调用 `codex_otel::inject_span_w3c_trace_headers(&tracing::Span::current(), &mut headers)`。上游这个函数原先只在 `exec-server/src/client/route_aware_http_client.rs::RouteAwareHttpRequestRunner::run` 调用。
- `model-provider-info/Cargo.toml` 增加 `codex-otel`、`tracing`（测试另加 `opentelemetry`、`opentelemetry_sdk`、`tracing-opentelemetry`、`tracing-subscriber`），`Cargo.lock` 随之更新。依赖不成环：`codex-otel` 不依赖 `codex-model-provider-info`。
- 新增测试 `model_provider_info_tests.rs::test_api_provider_propagates_host_trace_context`：把一个 span 的 parent 设成宿主给的 traceparent，然后调用 `to_api_provider`。断言 header 中的 trace-id 与宿主相同、span-id 不同（是子 span），并且静态 header 保持不变。

调用链：Core 在 `turn/start` 的 JSON-RPC 请求里带 `trace.traceparent`，经过 `app-server/src/app_server_tracing.rs::attach_parent_context` 和 `core/src/session/handlers.rs::submission_dispatch_span`，turn span 由 `core/src/tasks/mod.rs` 在 dispatch span 下创建。每次请求都会走 `core/src/client.rs::current_client_setup` → `ModelProvider::api_provider` → `to_api_provider` → `build_header_map`。所以注入发生在每一次模型请求上，并且位于 `model_client.stream_responses_api` span 内。

前提是配置了 OTel trace：只有设置 `[otel] trace_exporter` 时，app-server 才会安装 tracing layer（`app-server/src/otel_reloader.rs::layers`），span 才有 OTel context。没配置时 `inject_span_w3c_trace_headers` 不写任何 header，行为与上游相同，usage 归因仍按 DD-21 取 `NONE`。

结果：

| 检查 | 结果 |
|---|---|
| `cargo test -p codex-model-provider-info` | 30 passed |
| 去掉注入行后重跑 | 新测试 FAILED（`model request should carry traceparent`），其余 29 个通过；还原后 30 passed |
| `cargo test -p codex-model-provider` | 87 passed |
| `cargo clippy -p codex-model-provider-info --tests`、`cargo fmt --check` | 无告警 |
| `cargo build --locked -p codex-app-server --bin codex-app-server` | 通过 |
| 端到端：stdio 驱动 app-server，`turn/start` 带 `trace.traceparent=00-4bf92f35…4736-00f067aa0ba902b7-01`，provider `base_url` 指向记录 header 的代理 | `/v1/responses` 请求头为 `traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-37da96396bc75519-01`，trace-id 与 Core 给的一致 |

## 2. SS-COD-RUNTIME / SS-COD-APP：只靠配置

固定配置在 `config/` 下，经 vendor_files 放进源树，再由 `packaging/Dockerfile` 装入镜像：

| 文件 | 镜像内位置 | 作用层 |
|---|---|---|
| `requirements.toml` | `/etc/codex/requirements.toml` | system requirements：管理员强制，优先于 CODEX_HOME 配置和 `thread/start` 覆写（`config/src/loader/mod.rs::system_requirements_toml_file`） |
| `config.toml` | `/etc/codex/config.toml` | system 配置层（`SYSTEM_CONFIG_TOML_FILE_UNIX`） |
| `environments.toml` | `/usr/share/kailo/codex/environments.toml` | Core 在 spawn 前原样写入每个 Installation 的 `CODEX_HOME/environments.toml` |

逐项核验。实测做法：在私有 mount namespace 里把 `/etc/codex` overlay 成上表内容，以普通用户身份经 stdio 驱动 debug 版 `codex-app-server`。

| 能力 | 配置 | 源码依据 | 实测 |
|---|---|---|---|
| local environment | `environments.toml`：`include_local = false`、`default = "none"` | CODEX_HOME 下没有 environments.toml 时，会回退到 `CODEX_EXEC_SERVER_URL` 的旧行为，未设置即包含 local（`exec-server/src/environment_toml.rs::environment_provider_from_codex_home`、`environment_provider.rs::DefaultEnvironmentProvider::snapshot_inner`）。`include_local` 缺省也是 true。因此“不配 environment”必须写成显式文件。镜像另设 `ENV CODEX_EXEC_SERVER_URL=none` 覆盖回退路径 | 见下面各行 |
| 模型 shell/exec、apply_patch、view_image | 同上；`thread/start.environments=[]` | `core/src/tools/spec_plan.rs::add_shell_tools/add_core_utility_tools` 都以 `environment_mode.has_environment()` 为前提。未知的 environment id 会被跳过（`core/src/environment_selection.rs`，`skipping unknown turn environment`） | 发给模型的 tools 只有 `request_user_input, multi_agent_v1, get_goal, create_goal, update_goal, skills, web_search`，没有 exec/shell/apply_patch/view_image |
| `command/exec`、`process/spawn`、`thread/shellCommand` | 同上 | `command_exec_processor.rs::require_local_environment`、`process_exec_processor.rs::require_local_environment`、`thread_processor.rs::thread_shell_command_inner` | 三者都返回 `local environment is not configured`；`fs/readFile` 返回 `local filesystem is not configured` |
| ToolCallMcpElicitation | requirements `[features] tool_call_mcp_elicitation = true` | `features/src/lib.rs`（key `tool_call_mcp_elicitation`，Stable，默认开）；`core/src/mcp_tool_call.rs::request_mcp_tool_user_approval` | `experimentalFeature/list` 为 true |
| 审批能到达 host | requirements `allowed_approval_policies = ["on-request"]`、`allowed_approvals_reviewers = ["user"]`；system config 取同值 | `Never` 会让需要审批的调用被拒或被自动放行（`codex-mcp/src/mcp/mod.rs::mcp_permission_prompt_is_auto_approved`）；`auto_review` 会把审批交给子 Agent | `thread/start approvalPolicy=never` 生效后仍是 `on-request`；`config/read` 为 `on-request`/`user` |
| MemoryTool | requirements `[features] memories = false` | `memories/write/src/start.rs::start_memories_startup_task`、`ext/memories/src/extension.rs` 都以 `Feature::MemoryTool` 为开关 | CODEX_HOME 配置写 `memories = true`，或 `thread/start` 覆写 `features.memories`，有效值仍为 false。对照组不挂 `/etc/codex` 时为 true |
| shell_tool（纵深） | requirements `[features] shell_tool = false` | `add_shell_tools` | 有效值 false，覆写无效 |
| remote control、login shell | requirements `allow_remote_control = false`、`allow_login_shell = false` | `app-server/src/lib.rs` 的 `RemoteControlPolicy::DisabledByRequirements` | 未单独实测 |

配置层面没有关不掉的项，没有为此打补丁。

## 3. 核验中观察到的部署相关事实

- 用验证端点（vLLM，模型 `qwen`）跑 turn，结果是 `failed`：`Unexpected message role.`（400）。直接请求该端点可以复现：Responses 输入里的 `developer` 角色被拒，`system`/`user` 正常。Codex 的 Responses 请求固定会携带 developer 消息，因此该端点不能直接作为 Codex 的 provider 后端。
- 启动时 Codex 会从网络拉取插件目录，写到 `CODEX_HOME/.tmp/plugins`。这是与模型无关的出网行为。
- 模型可见工具里仍有 `web_search`、`multi_agent_v1`、`request_user_input` 与 goals，不在本切片范围内，只在此登记。
- `build-upstream.sh` 在登记了 `build_dockerfile` 时按“安装包”处理（`--output type=local`，要求恰好 1 个文件）。本镜像是运行镜像，最后阶段导出的是整个根文件系统，不满足这个条件，所以本清单的 `artifact_digest` 为 `none`。
