# Codex：SS-COD-TRACE 原生改动与 SS-COD-RUNTIME/SS-COD-APP 固定配置核验

基线 openai/codex@`7498521d288b9b3b96ffba4eedf089d8d6e06a84`（`.design/02` §1 Codex 行）。源树由
`agent-runtime/` 完整原生源码树承载，改动直接在树内；与固定上游的差异使用
`python3 tools/upstream_manifest.py diff agent-runtime --name-status` 复核（ADR-16），
不使用补丁叠加或构建时 vendor 拷贝。以下 Rust 路径相对 `agent-runtime/codex-rs/`。

## 1. SS-COD-TRACE：模型请求带 Core 的 operation trace

原生源码改动：

- `model-provider-info/src/lib.rs::ModelProviderInfo::build_header_map` 在合并 `http_headers`/`env_http_headers` 之后调用 `codex_otel::inject_span_w3c_trace_headers(&tracing::Span::current(), &mut headers)`。上游这个函数原先只在 `exec-server/src/client/route_aware_http_client.rs::RouteAwareHttpRequestRunner::run` 调用。
- `model-provider-info/Cargo.toml` 增加 `codex-otel`、`tracing`（测试另加 `opentelemetry`、`opentelemetry_sdk`、`tracing-opentelemetry`、`tracing-subscriber`），`Cargo.lock` 随之更新。依赖不成环：`codex-otel` 不依赖 `codex-model-provider-info`。
- 新增测试 `model_provider_info_tests.rs::test_api_provider_propagates_host_trace_context`：把一个 span 的 parent 设成宿主给的 traceparent，然后调用 `to_api_provider`。断言 header 中的 trace-id 与宿主相同、span-id 不同（是子 span），并且静态 header 保持不变。

调用链：Core 在 `turn/start` 的 JSON-RPC 请求里带 `trace.traceparent`，经过 `app-server/src/app_server_tracing.rs::attach_parent_context` 和 `core/src/session/handlers.rs::submission_dispatch_span`，turn span 由 `core/src/tasks/mod.rs` 在 dispatch span 下创建。每次请求都会走 `core/src/client.rs::current_client_setup` → `ModelProvider::api_provider` → `to_api_provider` → `build_header_map`。所以注入发生在每一次模型请求上，并且位于 `model_client.stream_responses_api` span 内。

前提是配置了 OTel trace：只有设置 `[otel] trace_exporter` 时，app-server 才会安装 tracing layer（`app-server/src/otel_reloader.rs::layers`），span 才有 OTel context。没配置时 `inject_span_w3c_trace_headers` 不写任何 header，行为与上游相同，usage 归因仍按 DD-21 取 `NONE`。

历史核验结果（保留原执行条件）：

下表是原核验记录，不是 2026-10-01 镜像工具链重新执行的结果，也不证明当前
运行镜像已构建、部署或 Core 的真实 Agent turn 已完成用量关联。

| 检查 | 结果 |
|---|---|
| `cargo test -p codex-model-provider-info` | 30 passed |
| 去掉注入行后重跑 | 新测试 FAILED（`model request should carry traceparent`），其余 29 个通过；还原后 30 passed |
| `cargo test -p codex-model-provider` | 87 passed |
| `cargo clippy -p codex-model-provider-info --tests`、`cargo fmt --check` | 无告警 |
| `cargo build --locked -p codex-app-server --bin codex-app-server` | 通过 |
| 端到端：stdio 驱动 app-server，`turn/start` 带 `trace.traceparent=00-4bf92f35…4736-00f067aa0ba902b7-01`，provider `base_url` 指向记录 header 的代理 | `/v1/responses` 请求头为 `traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-37da96396bc75519-01`，trace-id 与 Core 给的一致 |

## 2. SS-COD-RUNTIME / SS-COD-APP：只靠配置

固定配置在 `agent-runtime/fork/runtime-config/`，由
`agent-runtime/fork/packaging/Dockerfile` 直接装入镜像；不经过 vendor_files：

| 文件 | 镜像内位置 | 作用层 |
|---|---|---|
| `requirements.toml` | `/etc/codex/requirements.toml` | system requirements：管理员强制，优先于 CODEX_HOME 配置和 `thread/start` 覆写（`config/src/loader/mod.rs::system_requirements_toml_file`） |
| `config.toml` | `/etc/codex/config.toml` | system 配置层（`SYSTEM_CONFIG_TOML_FILE_UNIX`） |
| `environments.toml` | `/usr/share/platform/codex/environments.toml` | Core 在 spawn 前原样写入每个 Installation 的 `CODEX_HOME/environments.toml` |

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

上述配置约束保留原实测范围；没有为这些配置另写原生控制逻辑。

## 3. 核验中观察到的部署相关事实

- 用验证端点（vLLM，模型 `qwen`）跑 turn，结果是 `failed`：`Unexpected message role.`（400）。直接请求该端点可以复现：Responses 输入里的 `developer` 角色被拒，`system`/`user` 正常。Codex 的 Responses 请求固定会携带 developer 消息，因此该端点不能直接作为 Codex 的 provider 后端。
- 启动时 Codex 会从网络拉取插件目录，写到 `CODEX_HOME/.tmp/plugins`。这是与模型无关的出网行为。
- 模型可见工具里仍有 `web_search`、`multi_agent_v1`、`request_user_input` 与 goals，不在本切片范围内，只在此登记。
- 原记录中的“`build-upstream.sh` 把运行镜像当安装包”限制已不适用于当前入口。
  2026-10-01 实际读取 `tools/build-upstream.sh`：`kind: image` 使用 buildx
  `--load`，推入配置的 registry 后记录真实镜像 digest；只有安装包分支使用
  `--output type=local`。这证明入口的当前分支，不证明本运行镜像构建已成功。

## 4. 2026-10-01 当前交付边界

固定 commit 的实际复核：

```bash
git -C ../.references/codex grep -n inject_span_w3c_trace_headers 7498521d288b9b3b96ffba4eedf089d8d6e06a84 -- codex-rs/core codex-rs/model-provider-info codex-rs/otel codex-rs/exec-server
python3 tools/upstream_manifest.py diff agent-runtime --name-status
```

固定源码在 `core` 与 `model-provider-info` 没有该注入器调用；`otel` 定义、导出
注入器，`exec-server` 的 route-aware HTTP client 使用它。当前原生树的
`ModelProviderInfo::build_header_map` 已有上述注入，不再重复实现。
本次上游差异命令实际退出 0，列出 `.gitignore`、`codex-rs/Cargo.lock`、
`model-provider-info/Cargo.toml`、`model-provider-info/src/lib.rs` 与
`model_provider_info_tests.rs` 五个修改文件。

当前 `fork/runtime-config/config.toml` 只包含 approval policy/reviewer，没有
`[otel]` exporter；不能将预留给 Core 的逐 Installation 配置职责写成已完成。
来源记录的 `source_digest` 与 `artifact_digest` 均为 `none`，本轮没有重新运行
上表的 Codex SDK 检查，没有新增运行镜像或真实 Agent turn 的验收证据。
因此历史 trace 核验不解除当前 runtime、Core 生产调用链及模型用量关联的交付门禁；
缺少真实 correlation 的用量仍按 `DD-21` 取 `NONE`，不能显示为可计费。

## 5. 2026-10-06 非临时线程出生回执的持久性

本批比较基准为 `95abbc4aed07dc14d99b6d4043c049357e22758d`。
源码已写入，尚未编译或部署新的 Codex；下列原二进制实验不冒充改版验收。

四步影响结论：

1. **权威与根因**：`03` AgentSession 与 `19` §4 要求非 ephemeral thread
   按同一个 `runtime_thread_id` 恢复（SF-COD-09、DD-67）。固定上游
   `7498521d288b9b3b96ffba4eedf089d8d6e06a84` 的
   `codex-rs/app-server/src/request_processors/thread_processor.rs::thread_start_task`
   在首个 turn 前可返回尚未物化的路径；
   `codex-rs/thread-store/src/local/pending_thread_metadata_tests.rs::idle_shutdown_clears_pending_thread_metadata_without_materializing`
   明确证明空闲关闭会丢弃该待物化线程。非 ephemeral 不是已落盘的证据。
2. **影响面**：仅在原 `thread_start_task` 的非 ephemeral 成功回执前调用既有
   `ThreadStore::persist_thread(thread_id, PersistContext::Standard)`。
   同一固定 commit 的 `codex-rs/thread-store/src/store.rs::ThreadStore::persist_thread`
   规定 Standard 在返回前完成持久化；现有 LocalThreadStore 写入原 rollout，
   不新增 Core 正文、线程注册表、恢复接口、schema 或数据库迁移。
   ephemeral 分支不变。对应原 thread/start、thread/read 检查同步实际语义，
   实现后追加 Legacy/Paginated 的无模型 turn 创建、重启、同 ID 恢复用例。
3. **副作用边界**：持久化错误不返回创建成功，超时或回执丢失仍按原 UNKNOWN
   对账，不重发 turn、不释放未知 lease。曾尝试在 Core 出生阶段调用
   `thread/read(includeTurns=true)`；实测分页空线程返回 -32601，该方案已完全
   撤回，Core 保持原行为。原分页 SQLite 历史投影缺失仍拒绝，不把空数组当
   已确认历史，不扩大本批到历史投影修复。
4. **异常与收敛**：成功回执前的磁盘失败为未确认出生，沿既有出生对账处理；
   已落盘但回执未收到的线程保留原原生引用，不另造补偿重建。旧已丢失线程
   不能据 THREAD_NOT_FOUND、无 turn ID 或无 trace 推断未执行；旧 UNKNOWN
   和租约保持不动。此修复避免新的空线程出生丢失，不修复历史内容或宣称旧队列
   已收敛。安装并行度取 exact published version，当前没有原地升级安装动作，
   不通过修改不可变版本或 Capacity 判定扩大旧安装。

实际原生产二进制实验：从本批 Core 产物复制既有 `codex-app-server` 到 Data
私有证据目录 `birth-persistence.PXJHl0`，在已有 4 CPU / 8 GiB SDK 内使用独立
临时 CODEX_HOME、不可用的模型测试端点，只发送 initialize、thread/start、
thread/read 与 thread/resume，没有 model turn，不读真实 CODEX_HOME。

- 原 Paginated `thread/start` 回执路径不存在；原 `thread/read(includeTurns=true)`
  先写 rollout，随后返回 `-32601 / list_turns is not supported yet`。
  因此不能把该失败当作出生成功。冷重启后同一个线程可由原 `thread/resume`
  恢复；这验证原持久化能力，不是新代码的成功回执屏障验收。
- 最后实验原句柄 89155 退出 0：基线 `sameThreadResumed=true`；只移走独立
  测试 rollout 后 `sameThreadResumed=false, errorCode=-32600`；原字节还原，
  再次恢复 `sameThreadResumed=true`，全程 `modelTurnsSubmitted=0`。
  前两次实验失败如实保留：一轮遗漏测试 provider 名称，返回配置错误；另一轮
  在正常 resume 前取文件字节，正常追加导致比较失败。二者没有改真实会话；
  最后比较位于移走之前和恢复之后，且在下一次正常 resume 之前。
- `just fmt` 实际退出 127（既有 SDK 没有 just）；SDK 只有 Rust 1.90.0，
  native 固定 Rust 1.95.0。没有安装工具链、重复构建或执行新原生检查用例。
  三个选定 Rust 文件仅使用已有 rustfmt 的 edition 2024 解析与格式核对；
  新增重启用例、生产代码变异及改版二进制业务验证仍未执行。

真实队列事实与修复分开：新 invocation `2bc7a1f0-5bcc-4611-bfb7-2cc264a636cd`
是 CREATED、session PENDING、没有 native thread 或 lease；占用并行度的是旧
`db6dfccb-f0db-409a-8ed6-d81e64e277d9` 的 UNKNOWN lease。
不存在“新调用在 resume 旧 thread”的证据。未重放旧未知任务、修改权限或额度。

## 2026-10-10 新运行产物的出生持久性实测

原入口 `tools/build-upstream.sh agent-runtime` 的句柄 56925 已实际退出 0；
固定 Rust 1.95.0、Cargo jobs 16、原 Data BuildKit 8 CPU / 16 GiB，
release 编译及镜像导出、推送完成。来源记录保留 source_digest
`sha256:8dee2887732b4595d24a5aebefe205cd5d408986733cf49d0c15e0b697f606cb`，
artifact_digest 更新为
`sha256:dc14e75f0c843e12432ea90b3608030ca342dfc895d234988a8de0d437389908`。
本机 image inspect 的不可变摘要和 RepoDigests 均相符；原构建日志
`/volumes/data/kailo/tmp/build-agent-runtime.7neS5N.log` 保留编译告警，
没有为告警重复构建。

从该不可变镜像提取的新 codex-app-server SHA-256 为
`57f083a5f6c7431aeaab2e9f7ec39f7f678f5389cf970708e936df491a945c03`。
提取用的未启动临时容器已删除，没有删镜像、源码或业务数据。
实际验证在原 `kailo-wren-native-sdk-vuc6uo`（4 CPU / 4 GiB、无额外 swap）
内执行；开跑前仅 sleep。数据仅位于独立 Data 测试目录
`/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/native-birth-artifact.jfC0HG`。
复用原 stdio initialize → thread/start → 关闭进程 → thread/resume 流程，
明确 ephemeral=false、environments=[]、allowProviderModelFallback=false；
测试 provider 不可访问，没有发送 turn/start。

句柄 73566 实际退出 0，两种原生历史模式的输出均为：

- Legacy：出生回执时 rollout 路径存在；冷启动恢复同一
  `01a127c3-cf80-7fa2-b088-0b0545e8bdb9`，状态 idle。
- Paginated：出生回执时 rollout 路径存在；冷启动恢复同一
  `01a127c4-0d53-7963-96ac-f59a5d7a2938`，状态 idle。
- 分别只移走本实验的 rollout 后，原 thread/resume 均返回 -32600：
  Legacy 为 file does not exist，Paginated 为 no rollout found。
  finally 中原字节还原并比较一致，随后两模式均再次恢复同一 ID。
  两组输出的 modelTurnsSubmitted 均为 0。

这是新产物的出生持久性与缺失文件拒绝实证，不是完整原生 Rust 检查集、
生产镜像全部配置验收或模型 turn/计费验收。现有 Core 尚未随这枚产物重新
发布；没有热替换其二进制，没有重放旧 UNKNOWN 或释放历史租约。
分页历史读取、三个独立人类与多个 Agent 稳定协作、Skills 消费及全量发布
门禁仍须按各自实际证据收口，不能从本次同 ID 恢复推断已经交付。

