# Agent 工具接入说明：第三方 MCP、平台原生工具与权限（2026-10-15）

本文只写两类内容：线上只读实测，以及固定源码 `08e605c6e` 中可定位的实现。
设计权威是 `.design/12` §3–§5、`03` §7、`05` §2.8、`07` §2.5/§5.1/§8A、`17` §6；
本文不补充设计，也不把源码中的接线当作已上线能力。

## 1. 线上现状（2026-10-15 只读实测）

| 检查 | 结果 |
|---|---|
| core 库 `catalog.tool_definition / tool_binding / agent_tool_gateway_projection` | 0 / 0 / 0 行 |
| `catalog.component_definition / component_release / application_binding` | 0 / 0 / 0 行 |
| `catalog.capability_contract` | data_query v1、file_storage v1、knowledge v1 为 ACTIVE；knowledge v2 为 DRAFT |
| AgentGateway 库 `agw_config_resources` | 只有 `llm.*` 四类，`traffic.route` 0 条（没有任何 MCP route） |
| 安装 `1adcc667`（新研究助理）固定版本 | `declaredToolResourceIds=[]`、`capabilityRequirements=[]` |
| `GET /api/v1/platform-tools`（业务 Tenant 管理员） | 200，`{"tools":[]}`；页面「平台原生工具」显示「本页没有可见的已登记工具」 |
| `GET /api/v1/application-bindings` | 200，`bindings=[]`，`canCreate=true` |
| `GET /api/v1/platform/component-releases`、`capability-contracts` | 业务 Tenant 会话 403；Catalog Tenant 只有一位成员 `kailo-platform-admin` |
| Core 容器工具相关环境变量 | `GATEWAY_SERVICE_*`、`AGENT_TOOL_*` 全部已投递（只核对变量名）；`COMPONENT_CONFORMANCE_*` 均未投递 |

结论：目前没有任何 Agent 能拿到工具。Core 对零工具返回 `{"mcp_servers":{}}`
（`agent_tool_runtime::configuration`），Codex 不会出现 `enabled_tools`。
截图与 API 读回在 CI 节点 `~/kailo-acceptance/agent-tools/out/`（admin-01…05、admin-api.json）。

## 2. 两类工具共用的调用链（源码）

- 来源只有 `PLATFORM_NATIVE` 与 `APPLICATION`（DD-92）。两者都由 Core 在建
  thread 配置时写入 Codex `mcp_servers`：`url` 指向 AgentGateway，`Authorization`
  为会话 JWT（只在内存，`agent_tool_session`），`enabled_tools` 为本次准入后的名单，
  `default_tools_approval_mode=approve`。
- Gateway route 由 Core 经管理接口写入并读回比对：`mcpAuthentication` strict、
  非空 audiences、`requiredClaims=[exp,aud,iss,sub]`；`mcpAuthorization` 按 JWT
  scope 与工具名逐条放行；`mcpGuardrails` 指向 Core ExtMcp，`failureMode=failClosed`。
  - 原生：route `platform-agent-tools/<installation>/<generation>`，上游是 Core 私有
    `/service/v1/agent-tools/mcp`（`agent_tool_runtime::route`、`agent_tool_mcp::router`）。
  - 应用：route `application-tools/<binding>/<generation>`，名为
    `application-<binding>-<generation>`（`application_binding_gateway`）。
- ExtMcp `CheckRequest`（`agent_tool_pep::Policy::request`）：由会话 JWT 解析唯一在途
  Invocation；`tools/list` 重做工具准入；`tools/call` 规范化参数，原生走
  `agent_memory::prepare_tool_read`，应用走 `application_tool::prepare/dispatch`
  （子 ActionExecution、Delegation、审批、额度、ExternalExecution），并只把子 AE 与
  operation 引用作为 header 交给上游。`CheckResponse` 按冻结的 exposure 重建结果。
- 原生端点只接受 Gateway service 身份，并要求 header 中的子 AE 与 operation 在库中为
  `gate_state='ALLOWED'` 才执行（`agent_tool_mcp::MemoryTools::call_tool`）。

## 3. 第三方 MCP 服务按设计如何接入

第三方 MCP 只能作为 `APPLICATION` 实现接入，不能直接挂到某个 Agent 上：

1. **对上能力契约。** 工具必须对应某个 ACTIVE 能力契约里 `surface=TOOL` 的契约键，
   release 的 `toolDefinitions[].capabilityContractKey` 填该键；不在契约内的工具在
   binding 投影时被跳过（`application_binding_projection`）。没有合适契约时，Catalog
   管理员用 `capability_contract.register`（EXPLICIT，登记为 DRAFT），再由另一位
   Catalog 管理员 `capability_contract.approve`（APPROVAL）。只能使用既有固定
   permission（DD-102）。
2. **选择连接方式**（`07` §5.1，源码 `native::Connector`）：
   - `PROTOCOL_PEER`：服务本身就是 Streamable HTTP MCP，端点写在 binding 配置里，
     凭据以 SecretRef 投递为 Gateway backendAuth；上游不接收 ActionToken。
   - `REMOTE_ADAPTER`：平台运维域内的 adapter 托管 MCP 端点，Gateway 每次调用注入
     Core 签发的 ActionToken 和幂等键。SaaS（`VENDOR_MANAGED`）必须走 adapter，
     Gateway 不直连供应商端点。
3. **登记 release。** `component_release.register`：Catalog Tenant `manage`，
   EXPLICIT，经 ComponentTaskWorkflow 跑一致性套件。源码当前只接受
   `class=APPLICATION`、`admissionPath=EXTERNAL`、`platformPortKey=NONE`
   （`component_release.rs` 约 180 行）；套件读取隔离候选配置
   `COMPONENT_CONFORMANCE_ENVIRONMENT_FILE`（peer）或
   `COMPONENT_CONFORMANCE_FIXTURE_FILE`，其 `artifactDigest` 必须等于
   `adapterBuildRef`，缺失即 `CAPABILITY_BLOCKED`。
4. **批准 release。** `component_release.approve`：APPROVAL，由另一位 Catalog
   管理员批准，`self_approval=DENY`（`05` §2.8）。
5. **建立连接。** `application_binding.create`：DECLARED_WORKSPACE，Workspace 或
   Tenant `manage`，EXPLICIT。成功后 Core 为每个契约工具创建
   `tool.definition` Resource（owner 为发起人），写 Gateway route，并在 Agent
   建配置时把版本里声明的契约键解析为 ToolBinding（`application_tool::resolve_installation`）。
6. **让 Agent 用上。** AgentVersion 的 `capabilityRequirements` 写契约键（如
   `knowledge.search@v1`），不写具体 Tool Resource；安装后由发起人用
   `agent.delegation.grant`（EXPLICIT）授予包含 `toolResourceId`、动作、目标
   Resource 与结果暴露策略的 scope（`delegation::validate_application_scope`）。

## 4. 权限怎么管

| 环节 | 谁 | 校验点 |
|---|---|---|
| 契约、release 登记与批准 | Catalog Tenant 管理员；批准须另一人 | Catalog Tenant `manage` + ApprovalWorkflow |
| 建立/停用连接 | Workspace 或 Tenant 管理员 | `manage`；停用不需审批（不让撤权等审批） |
| Agent 能否看到某工具 | 发起 HUMAN 与 AgentPrincipal 同时 | Tool Resource 的 fresh `discover` + `consume`（`application_tool::configuration`、`agent_tool::bound_tools`） |
| 某次调用能否执行 | 每次 `tools/call` | DelegationScope、目标 Resource 契约 permission、审批、额度、ExtMcp 重算参数 |
| 返回什么 | `CheckResponse` | ResultExposurePolicy；`consume` 不能变成 `read/export` |

## 5. 当前卡点（实测或源码确认）

1. **AgentPrincipal 没有 Tool 的 discover/consume 来源。** 两类工具在配置阶段都要求
   AgentPrincipal 对 Tool Resource 有 fresh `discover/consume`；全仓源码没有任何路径
   为 Agent 写 `discoverer/consumer` 关系（安装只写 `NO_PERMISSION` 的 ToolBinding）。
   因此即使有 ToolDefinition，工具也会在准入时被静默剔除。设计 `12` §3、`10` 要求该
   交集，但没有冻结授予动作。
2. **原生 ToolDefinition 没有生产者。** 迁移 `20261004008000_platform_native_tool`
   明确未播种，也没有创建动作；先前的 `tool.definition.create` 因无冻结策略已撤回。
   名称受约束只允许 `agent.memory.entry.list/read`。
3. **Catalog Tenant 只有一位管理员**，release 与契约批准都要求另一人，无法闭合。
4. **线上没有投递一致性候选配置**，release 登记会在准入处 BLOCKED。
5. **知识检索**：adapter 对 `knowledge.search@v1` 返回 503，只实现 v2；v2 契约仍为
   DRAFT；`knowledge-adapter` 镜像在仓库中但未部署。

在 1、2 由设计裁决之前，任何 Agent 都不能经 AgentGateway MCP 实际使用工具。

## 6. 卡点复核（2026-10-21，只读实测 + 固定源码 `e6b791b78`）

DD-122（10-17）与 DD-134（本次）之后逐条复核第 5 节：

| 第 5 节卡点 | 现状 | 依据 |
|---|---|---|
| 1. AgentPrincipal 没有 Tool 的 discover/consume 来源 | 已解决 | DD-122(3)(5)：安装/升级授予时为 AgentPrincipal 写 `discoverer`、`consumer` 并复读（`agent_tool.rs` 的 `TOOL_RELATIONS`）；生产 `catalog.tool_binding` 有 2 行 `ACTIVE` |
| 2. 原生 ToolDefinition 没有生产者 | 已解决 | DD-122(1)：部署引导按 Tenant 逐名登记（`tenant_bootstrap.rs` 的 PLATFORM_NATIVE 登记段）；生产 `catalog.tool_definition` 有 2 条 `PLATFORM_NATIVE`/`ACTIVE` |
| 3. Catalog Tenant 只有一位管理员 | 已不成立 | 生产 Catalog Tenant 现有 2 名 `ACTIVE` HUMAN 成员（第二位为批准人账户）；其 admin 关系由 SpiceDB 权威持有，本次未读取 SpiceDB |
| 4. 线上没有投递一致性候选配置 | 仍成立 | 生产 Core 容器没有 `COMPONENT_CONFORMANCE_*` 与 `APPLICATION_ADAPTER_DIRECTORY_FILE` 环境变量（只核对变量名）；`PROTOCOL_PEER` release 登记仍会在准入处 `CAPABILITY_BLOCKED`，binding 也找不到交付目录 |
| 5. 知识检索 v1 503、v2 为 DRAFT | 与本链路无关，状态未变 | 生产 `knowledge@2` 仍为 `DRAFT` |

另外两条现状：生产 `catalog.component_release` 只有 6 条 `executionConnector.mode=NONE` 的原生页面入口 release，没有任何 `PROTOCOL_PEER` 或 `REMOTE_ADAPTER` release；AgentGateway `agw_config_resources` 只有 `llm.*` 四类，request log 共 3552 条（10-03 至 10-21）。因此“真实外部 MCP”仍需：在运维域部署固定 digest 的 MCP 服务并写入交付目录与一致性环境（卡点 4），再按 DD-134 网关管理区的向导走契约、release、批准与连接。HUMAN 直接测试调用 `PROTOCOL_PEER` 工具在 `e6b791b78` 前不存在（`application_action::facts` 只接受 `REMOTE_ADAPTER`），由 DD-134(6) 补齐。
