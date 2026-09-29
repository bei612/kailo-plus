# Agent 运行时与工具安全

## 1. 运行边界

Agent Definition、Version、Installation、RuntimeProfile 与 EffectiveAgentConfig 以 `03`、`17` 为权威。本文件只约束一期 `SERVER_CODEX` 执行面。Codex 是平台核心的 Agent runtime，强集成、不可替换；RuntimeProfile 的其他取值只保留类型标识，不构成可替换承诺（DD-26/87）。

Codex app-server 提供 stdio thread/turn 协议、MCP approval 和 response usage（SF-COD-01/02、SS-COD-APP），但它的 `thread/shellCommand` 和 `process/spawn` 是 host 无沙箱通道（SF-COD-04）。因此一期运行单元固定为：

```text
AgentInstallation
  ├─ one AgentPrincipal
  ├─ one Workspace scope
  ├─ one exact AgentVersion + projection generation
  ├─ one isolated app-server process/state directory
  ├─ CODEX_HOME config has no local environment
  ├─ thread/start carries environments: []; Core never sends turn/start.environments
  │    (client initialize declares capabilities.experimentalApi = true)
  ├─ [features] shell_tool = false (defence in depth only)
  └─ only approved AgentGateway MCP servers/tools
```

Core 不调用 `command/exec`、`process/spawn`、`thread/shellCommand` 三个 host RPC，不挂载用户主机目录，不继承平台运维 credential。源码表明模型 exec 工具只在有 environment 且其它开关允许时注册，而 `apply_patch`/`view_image` 主要受 environment 存在性控制；关闭 `unified_exec`、`shell_tool` 或 `shell_type` 均不能代替无 environment（SF-COD-03/11/12）。因此 DD-15 的承重条件是 Installation 的 CODEX_HOME 配置根本不存在 local environment；`thread/start.environments=[]` 与 Core 从不发送可覆盖当前及后续 turn 的 `turn/start.environments` 是纵深防御。resume 没有 environments 字段。Core client 在 `initialize` 固定声明 experimental API 以发送 thread/start 空数组（SF-COD-03/12）。

Codex `ModelProviderInfo` 支持 custom `base_url + WireApi::Responses`（SF-COD-05），AgentGateway 支持 OpenAI Responses route、模型 authorization/rate-limit 与配置数据库后的 request log（SF-AGW-04/06/07）。因此 AgentInstallation 的模型 provider 固定指向已授权 `llm_route`；提供方类型与兼容声明只是该 `llm_route` 的 AgentGateway 配置，更换提供方不改 Codex、Core 或客户端（DD-110、SF-AGW-25）；不允许 Agent/prompt 改 provider base URL、provider credential 或 gateway identity。每次 turn 先检查 `llm_route:execute`。原始 request log 只作观测；actual token/cost 只有 SS-AGW-USAGE 闭合后的 durable Gateway usage 才可结算（SF-AGW-09、DD-17/21）。

平台不宣称 Codex 自身实现了 Tenant sandbox；租户隔离依赖每 Installation 进程/状态边界、无 host capability 与窄 MCP allow-list 同时成立。

## 2. 会话历史与长期记忆

`SERVER_CODEX` 不使用 Buzz ACP 进程内 queue/history 作恢复权威。AgentSession 必须创建非 ephemeral Codex thread，并持久保存 `runtime_thread_id`；进程恢复用 `thread/resume`，历史读取用 `thread/turns/list`/`thread/items/list`（SF-COD-09）。Relay 仍是 Channel/Thread/DM 协作事实权威，只为当前触发提供受界 thread/DM 上下文；普通顶层 Channel 消息不虚构全频道 prompt 历史（SF-BUZ-07/20）。

跨 Session 长期记忆只使用 AgentInstallation 的 Buzz NIP-AE `core + mem/*`，具体分层、binding、Action、prompt 优先级与错误语义以 `19` 为准。新 Session 创建前读一次 core并固定 event ID，活跃 Session 不中途刷新；冷记忆只经 memory tool 按需读取。core 以 `turn/start.additionalContext` 的保留 source key `platform.agent-memory.core` 注入，绝不占用 `developer_instructions`；后者只承载不可变 AgentVersion instructions。记忆不修改 AgentRuntimeProjection、permission、Delegation、Approval 或 Quota（SF-COD-09/16、DD-65/67）。

Codex `Feature::MemoryTool` 一期固定关闭；其 rollout 抽取与 `$CODEX_HOME/memories` 合并不进入 Kailo 长期记忆链（SF-COD-10、DD-65）。

## 3. 工具发现不等于授权

工具来源固定两类（DD-92）：`PLATFORM_NATIVE`（记忆、Buzz 消息、任务、审批等平台核心工具，不依赖任何 ApplicationBinding）与 `APPLICATION`（业务能力实现按能力契约键暴露的工具）。两类工具都经 MCP 与 AgentGateway ExtMcp PEP，传输不同只在 MCP target 的来源。

```text
AgentVersion requested tools
  ├─ PLATFORM_NATIVE: declared_tool_resource_ids[]
  │    ∩ Catalog ToolDefinition(source=PLATFORM_NATIVE) ∩ platform tool enabled
  └─ APPLICATION: capability_requirements[] (contract key + version)
       → 该类别 active ApplicationBinding（Workspace 级优先，其次 Tenant 级）
       → 该 binding 登记的 ToolDefinition + Resource
∩ ChannelAgentBinding
∩ ToolBinding
∩ SpiceDB discover/consume
∩ DelegationScope
→ AgentGateway projection
→ Codex enabled_tools
```

起点与 `03` §7 一致：AgentVersion 的 `declared_tool_resource_ids[]` 只引用 `PLATFORM_NATIVE` 工具；`APPLICATION` 工具只经 `capability_requirements[]` 由 ToolBinding 解析，不引用具体实现的 Tool Resource。`APPLICATION` 需求在 Workspace 内（Workspace 级与 Tenant 级 binding 均）没有 active 实现时，该工具 effective 为 `NO_PROVIDER`，不进入投影，Installation 仍可 `ACTIVE`；`PLATFORM_NATIVE` 工具的可用性不受任何业务能力 binding 影响。

Tool 出现只证明可请求，不证明某个参数/目标可执行。真正调用前仍做 parameter normalization、SpiceDB、Delegation、Approval、Capacity、Quota 和 exposure 准入。Codex `enabled_tools/disabled_tools` 只是前置收窄层（SF-COD-02）。

SkillVersion 也不授予工具：Codex skill metadata 可声明 tool dependencies（SF-COD-07），但只有依赖工具同时进入上述交集时 skill 才有效；否则 EffectiveAgentConfig 返回确定 reason。Skill artifact 只能从 Installation 专属只读 root 被发现，不能借 skill 内容引入任意 MCP、shell 或 credential。

`PLATFORM_NATIVE` 工具的传输固定为（DD-105）：

- 由 Core 自托管的 Streamable HTTP MCP 端点提供，端点位于 Core 的私有服务网络，由 Core 经 SS-AGW-ADMIN 登记为 AgentGateway 的 MCP target；Codex 只经 AgentGateway 调用，Agent 与 Codex 不能直连该端点。
- 与 `APPLICATION` 工具走同一条会话级 bearer 与 ExtMcp 两相 PEP（§4）：参数规范化、fresh SpiceDB/Delegation/Approval/Quota 准入与 `CheckResponse` exposure 过滤同样生效。
- 不需要 ApplicationBinding、adapter、Adapter Protocol 或 ActionToken：Core 端点只接受 PEP 注入的平台裁决 header（固定的 AgentGateway service 身份与该次 operation ref），据此在 Core 内执行对应 Governed Action；缺 header、身份不符或该 operation 未处于准入通过的状态时拒绝。
- 零业务能力 binding 时它们完整可用，是 V-SCN-71 中 `PLATFORM_NATIVE` 工具的执行路径。

业务能力工具按能力类别统一遵守以下条款，内置参考实现（知识检索、数据查询等）的具体映射见 `08`：

- 传输固定为 Streamable HTTP MCP，并注册为 AgentGateway 的 MCP target；MCP target 只指向平台运维域内的运行体：自托管实现可以自身作为 MCP server 直接注册，实现自身不是 MCP server 时由其 remote adapter 托管 MCP endpoint；`VENDOR_MANAGED` 实现的 MCP target 必须由其 adapter 托管，AgentGateway 不直连供应商端点，供应商凭据只投递到 adapter（DD-94(5)）。ExtMcp 的请求/响应两相 PEP 对每个业务能力工具同样生效。
- 同一能力契约下的多个工具投影到同一目标 Resource 的对应契约 permission（如 `consume`），不因工具名不同绕过 Resource permission 或 result exposure。
- Tool 参数只能引用已授权的 Resource/Asset 或 ContentReference，不接受 native project、profile、连接器 secret、存储根路径或 pipeline 代码作为参数（DD-12）。
- 禁止让业务能力工具绕开 AgentGateway 而由 Core 直接调 adapter；那样 exposure 过滤就没有执行点。Core 自身调用 adapter 只用于 Web/BFF 的 Governed Action，不作为 Agent 工具通道。
- 跨服务数据获取的授权（DD-89 为接收方 binding 的 ServicePrincipal 写入来源 Resource 的 `reader` 关系）只作为受审批的 Governed Action 暴露：Agent 可在 Delegation 范围内发起该授权，按 §6 经审批后执行，来源与目标由该动作的 parameter hash 固定；Agent 不能在授权之外临时指定来源、目标或同步逻辑。每批读取由接收方 binding 经服务读取边自行申请，不是 Agent 工具。暂停导入、撤销读取授权、停用 binding 与删除派生内容不得合并为一个 tool 或复用 action key（`07` §8.2）。

## 4. MCP 调用链

```text
Codex tool intent
→ ToolCallMcpElicitation enabled + approval policy not Never
→ mcpServer/elicitation/request when policy requires
→ Temporal ApprovalWorkflow decision
→ Core fresh admission
→ session-scoped bearer already installed on this Codex thread
→ AgentGateway Streamable HTTP MCP
→ ExtMcp CheckRequest: PEP resolves session→operation, re-normalizes params,
  recomputes hash, does fresh permission/delegation/approval/quota
→ parameter/header mutation or reject
→ selected upstream
→ ExtMcp CheckResponse: exposure filter on the JSON-RPC result
→ usage/audit
```

ExtMcp 源码请求含 method、metadata、raw params 和 incoming headers，响应能拒绝、改 params 和注入 upstream headers（SS-AGW-PEP）。stdio upstream 没有 header 注入面，不用于跨边界受治理 MCP。

`SERVER_CODEX` 固定启用 `ToolCallMcpElicitation`，逐工具 approval policy 必须选择能到达 host 的模式，禁止为需要审批的工具配置 `Never`。Core 把 `mcpServer/elicitation/request` 映射到 Temporal ApprovalWorkflow；未批准不调用 MCP。feature 关闭时的 `requestUserInput` fallback 不进入一期平台协议（SF-COD-01、SS-COD-APP）。

Codex 侧不存在逐次调用的 header 钩子：MCP client 的 Authorization 在连接构造时固定（`Resolved` bearer），`bearer_token_env_var` 又只读进程 env（SF-COD-13、GAP-AGW-01）。因此 Codex→Gateway 这一跳**不使用** per-operation ActionToken，改为两段式：

1. **会话级 bearer**。Core 为每个 AgentSession 签发短期 JWT，claims 固定 `(tenant_id, workspace_id, installation_resource_id, agent_principal_id, projection_generation, aud=<gateway MCP audience>, exp)`，经 `thread/start`/`thread/resume` 的 `config` 覆写逐 thread 注入内存（不写 `config.toml`、不进磁盘），需要更换时用 MCP 配置 reload 重新下发。它只回答"这是哪个 Installation 的哪个会话"，不含 operation、参数 hash 或 exposure。
2. **PEP 侧逐次裁决**。`CheckRequest` 已经携带 method、目标 backend、**原始 JSON-RPC params** 与过滤后的 headers，因此参数规范化与 hash 由 PEP 自己计算（`03` 本来就要求 PEP 重算而不信任来方 hash），operation/action execution 由会话 bearer 加 Core 侧按 `(session, tool, params)` 的查询解析，随后在 PEP 内完成 fresh SpiceDB/Delegation/Approval/exposure 准入。裁决结果经 `McpRequestResult.metadata` 下发给后续 filter 与 request log，供 usage/audit 归因。

ActionToken 的封闭 claims 形态保持不变，但适用范围收窄为 **Core/Worker 逐请求签发**的那些跳：Core/Worker→remote adapter，以及服务读取边上由 Core 签发、接收方持往来源实现契约端点的读取令牌（`07` §8.2）。两类跳的接收 PEP 都是业务能力实现在平台运维域内的 adapter 运行体（外部与 SaaS 实现也不例外），验签公钥与 AgentGateway 同样经 OpenBao Agent 投递；以 `PROTOCOL_PEER` 接入的实现不接收 ActionToken，不能作为服务读取边的来源方（DD-94）。Core 不直接调用任何业务能力实现的 native API。

ActionToken 在其适用的跳上采用 `03` 的封闭 claims：精确 audience、Tenant/Workspace、actor/initiating HUMAN/Agent、Delegation version、action/version、target、operation、参数 hash、exposure、最小 ZedToken 与短 expiry。ExtMcp 是可实现校验/改参/header 注入与结果过滤的源码接缝，不把此平台 PEP 误写成 AgentGateway 上游现成功能（SS-AGW-PEP、DD-49）。

Gateway 侧配置存在省略即放宽的路径，Core 投影时必须显式写满并回读字段而不只比对 hash：MCP authentication 固定 `mode: strict`、非空 audiences、required claims 至少 `exp/iss/sub/aud`；AgentGateway 只执行签名、issuer、audience 与受支持时间 claim 校验，`iat/jti`、重放、参数 hash、Delegation、exposure 与 fresh SpiceDB 全在 ExtMcp policy server 完成（SF-AGW-11/19、DD-49）。MCP RBAC 规则集为空会放行全部方法，因而必须非空；`*/list` 的请求相位不带 params，列表收窄只能在响应相位完成（SF-AGW-12/16）。

PEP 拒绝即结束调用；它不启动审批、不等待、不计费。Approval/Workflow 在 Temporal，Quota/Billing 在 OpenMeter/Core reservation，Audit 在 Core。

## 5. AgentGateway 配置面

ConfigResourceStore 能以 SQLite/Postgres 保存 MCP/LLM/traffic/UI resources，Postgres LISTEN/NOTIFY 可 reload（SF-AGW-01）。Kailo Catalog 只投影已 active ToolDefinition/Binding，不从 Gateway 反向导入业务授权。

- `/api/config/resources`、覆写配置文件的 `POST /api/config`、改监听端口/TLS 的 `llm.settings`/`mcp.settings` 与 debug/shutdown route 位于同一无认证 admin router（SF-AGW-02、SS-AGW-ADMIN）；只有 SS-AGW-ADMIN 的 Core-only service authentication 闭合后才能投影，不把内网地址或 CORS 当成认证，不暴露给 Browser/Agent/Tenant admin。
- xDS 实现是连外部 ADS 的 client（SF-AGW-03），不作 Kailo 内建组件注册协议。
- Gateway route 不自动成为 Tool；只有 `07` 注册闭环成功后才投影。
- LLM route 也不自动对全部 Agent 可见；`llm_route:discover/execute`、AgentVersion requested route、Installation binding 与 Delegation 同时成立后才生成 Codex provider projection。
- Codex 模型请求在 SS-COD-TRACE 闭合前没有由 Core operation 派生的 `traceparent`；该链的 usage correlation 固定为 `NONE`，状态显示 `BILLING_UNAVAILABLE`，不能用偶然相同的 Gateway trace 归因（SS-COD-TRACE、DD-21）。
- AgentGateway ConfigResource 只接受 Core 对 active AgentRuntimeProjection 的写入与回读对账；AgentRegistry 不参与该路径（DD-29）。

## 6. 结果与子 Agent

- MCP/raw native result 先经 ResultExposurePolicy，再进 Codex context 或 Buzz reply。`consume` 不能通过 prompt 绕过 `read/export`。执行点是 ExtMcp 的 `CheckResponse` 钩子：PEP 按该次调用已冻结的 exposure 决定放行或整体替换 JSON-RPC `result`（SS-AGW-PEP）。上游对 JSON-RPC **错误响应跳过该钩子**，因此 Kailo 侧的补充规则是：任何会携带业务正文的失败必须由 PEP 在 `CheckRequest` 阶段拒绝，或由上游 adapter 归一化为不含正文的错误码，禁止让上游把原始错误体直接回给 Codex；adapter 返回的 error 体只允许固定 reason code 与 native ref，不含行、片段或文件内容。
- Agent 产生的持久 Asset 使用 initiating HUMAN 作 accountable owner，Agent 只是 producer。
- runtime 内短命子任务归父 AgentInvocation；只有独立频道回复、独立生命周期或脱离父 turn 继续的子 Agent 才创建新 AgentInvocation/AgentTaskWorkflow。
- 一个触发以 `(tenant_id, source_event_id, installation_resource_id)` 幂等；Relay 持久 event 是恢复起点，不从 ACP 内存 queue 恢复（SF-BUZ-07/08）。
- Relay event 是 Invocation 触发/协作对账起点；已建 AgentSession 的运行会话则以 `runtime_thread_id` 恢复 Codex durable thread，不从 Relay 重放合成一份新 rollout（SF-COD-09）。
- Agent 发起的 ActionDefinition `confirmation_mode=APPROVAL` 的动作（如 §3 的跨服务读取授权、能力版本发布、quota adjustment）保持 initiating HUMAN、Delegation 与 endpoint owner 审批；Agent 不能成为 approval approver 或通过连续 tool calls拆分规避 parameter hash。

## 7. 阻断与排除

| 项 | 结论 |
|---|---|
| Temporal tool approval | `DESIGN_DEFINED`（DD-69）；执行前 PEP `ADAPTER_REQUIRED: SS-AGW-PEP` |
| Gateway/provider/Codex credential 托管 | OpenBao（DD-70）；Gateway 经 Agent file sink，Codex 经 Core spawn 时注入进程 env（DD-71） |
| 长存 MCP bearer 原地轮换 | GAP-AGW-01；结束旧 turn/client 收敛 |
| NIP-AE Agent/CONTROL 私钥托管 | OpenBao KV v2 + Core signer（DD-72）；transit 无 secp256k1，签名不在 OpenBao 内完成 |
| Agent 修改 core | Temporal ApprovalWorkflow（DD-68/69） |
| Codex 自动 Memory Pipeline、OpenViking | 一期 `EXCLUDED`；NIP-AE 是唯一 Agent 长期记忆权威 |
| 任何业务能力服务自带的 Agent、skill、sandbox、memory、会话抽取或 prompt 注入 | 平台不把它们纳入 Agent 上下文或用户入口，不承担平台 Agent runtime、工具或记忆职责；不规定服务内部是否启用（DD-92） |
| 桌面 computer-use、微信、游戏、host shell（`thread/shellCommand`、`process/spawn`、`command/exec`） | 一期 `EXCLUDED` |
