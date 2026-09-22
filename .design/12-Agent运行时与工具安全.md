# Agent 运行时与工具安全

## 1. 运行边界

Agent Definition、Version、Installation、RuntimeProfile 与 EffectiveAgentConfig 以 `03`、`17` 为权威。本文件只约束一期 `SERVER_CODEX` 执行面；它不把 Codex 固化为长期唯一 runtime（DD-26）。

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

Codex `ModelProviderInfo` 支持 custom `base_url + WireApi::Responses`（SF-COD-05），AgentGateway 支持 OpenAI Responses route、模型 authorization/rate-limit 与配置数据库后的 request log（SF-AGW-04/06/07）。因此 AgentInstallation 的模型 provider 固定指向已授权 `llm_route`；不允许 Agent/prompt 改 provider base URL、provider credential 或 gateway identity。每次 turn 先检查 `llm_route:execute`。原始 request log 只作观测；actual token/cost 只有 SS-AGW-USAGE 闭合后的 durable Gateway usage 才可结算（SF-AGW-09、DD-17/21）。

平台不宣称 Codex 自身实现了 Tenant sandbox；租户隔离依赖每 Installation 进程/状态边界、无 host capability 与窄 MCP allow-list 同时成立。

## 2. 会话历史与长期记忆

`SERVER_CODEX` 不使用 Buzz ACP 进程内 queue/history 作恢复权威。AgentSession 必须创建非 ephemeral Codex thread，并持久保存 `runtime_thread_id`；进程恢复用 `thread/resume`，历史读取用 `thread/turns/list`/`thread/items/list`（SF-COD-09）。Relay 仍是 Channel/Thread/DM 协作事实权威，只为当前触发提供受界 thread/DM 上下文；普通顶层 Channel 消息不虚构全频道 prompt 历史（SF-BUZ-07/20）。

跨 Session 长期记忆只使用 AgentInstallation 的 Buzz NIP-AE `core + mem/*`，具体分层、binding、Action、prompt 优先级与错误语义以 `19` 为准。新 Session 创建前读一次 core并固定 event ID，活跃 Session 不中途刷新；冷记忆只经 memory tool 按需读取。core 以 `turn/start.additionalContext` 的保留 source key `kailo.agent-memory.core` 注入，绝不占用 `developer_instructions`；后者只承载不可变 AgentVersion instructions。记忆不修改 AgentRuntimeProjection、permission、Delegation、Approval 或 Quota（SF-COD-09/16、DD-65/67）。

Codex `Feature::MemoryTool` 一期固定关闭；其 rollout 抽取与 `$CODEX_HOME/memories` 合并不进入 Kailo 长期记忆链（SF-COD-10、DD-65）。

## 3. 工具发现不等于授权

```text
AgentVersion declared tools
∩ Catalog ToolDefinition
∩ active ApplicationBinding/Resource
∩ ChannelAgentBinding
∩ ToolBinding
∩ SpiceDB discover/consume
∩ DelegationScope
→ AgentGateway projection
→ Codex enabled_tools
```

Tool 出现只证明可请求，不证明某个参数/目标可执行。真正调用前仍做 parameter normalization、SpiceDB、Delegation、Approval、Capacity、Quota 和 exposure 准入。Codex `enabled_tools/disabled_tools` 只是前置收窄层（SF-COD-02）。

SkillVersion 也不授予工具：Codex skill metadata 可声明 tool dependencies（SF-COD-07），但只有依赖工具同时进入上述交集时 skill 才有效；否则 EffectiveAgentConfig 返回确定 reason。Skill artifact 只能从 Installation 专属只读 root 被发现，不能借 skill 内容引入任意 MCP、shell 或 credential。

WeKnora 的普通检索与 `query_knowledge_graph` 都投影为同一 KnowledgeBase Resource 下的 consume tools（SF-WEK-05），不因工具名不同绕过 KB permission/result exposure。WeKnora 自身不是 MCP server（仓库内的 MCP 代码是它作为 client 调用外部的实现），因此这两个 tool 的传输固定为：Kailo 的 WeKnora remote adapter 托管一个 Streamable HTTP MCP endpoint 并注册为 AgentGateway 的 MCP target，形态与 Wren 相同，从而 ExtMcp 的请求/响应两相 PEP 对它同样生效；adapter 内部以已授权 scope 调用 WeKnora 的 hybrid-search 与 knowledge 读取 REST 接口。禁止让 consume tool 绕开 AgentGateway 直接由 Core 调 adapter——那样 exposure 过滤就没有执行点。Wren 每个 SemanticModel version 是一个固定 Streamable HTTP MCP target，经 AgentGateway 路由；Tool 参数只能选择已授权 SemanticModel Resource，不能把 project/profile/connector secret 作为参数（SF-WRN-01、DD-12）。Materialization tool 只接受已存在 binding ID 和受限动作：run/pause/resume/purge 分别映射不同 ActionDefinition；Agent 不能临时指定任意 Cells root、WeKnora KB 或 pipeline code。

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

ActionToken 的封闭 claims 形态保持不变，但适用范围收窄为 **Core/Worker 作为调用方**的那些跳（Core→remote adapter、Core→组件 native API），那里 Core 能逐请求签发。

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
- Agent 发起的知识物化、模型发布、quota adjustment 等高风险动作保持 initiating HUMAN、Delegation 与 endpoint owner 审批；Agent 不能成为 approval approver 或通过连续 tool calls拆分规避 parameter hash。

## 7. 阻断与排除

| 项 | 结论 |
|---|---|
| Temporal tool approval | `DESIGN_DEFINED`（DD-69）；执行前 PEP `ADAPTER_REQUIRED: SS-AGW-PEP` |
| Gateway/provider/Codex credential 托管 | OpenBao（DD-70）；Gateway 经 Agent file sink，Codex 经 Core spawn 时注入进程 env（DD-71） |
| 长存 MCP bearer 原地轮换 | GAP-AGW-01；结束旧 turn/client 收敛 |
| NIP-AE Agent/CONTROL 私钥托管 | OpenBao KV v2 + Core signer（DD-72）；transit 无 secp256k1，签名不在 OpenBao 内完成 |
| Agent 修改 core | Temporal ApprovalWorkflow（DD-68/69） |
| Codex 自动 Memory Pipeline、OpenViking | 一期 `EXCLUDED`；NIP-AE 是唯一 Agent 长期记忆权威 |
| 桌面 computer-use、微信、游戏、host shell（`thread/shellCommand`、`process/spawn`、`command/exec`） | 一期 `EXCLUDED` |
