# Agent 管理平面设计

本文只定义 Agent 管理平面。实体字段以 `03` 为准，治理顺序以 `05` 为准，运行与工具安全以 `12` 为准。Agent 管理属于 Platform Core/BFF 既有 Catalog，不增加 Agent Registry、独立 control plane 或第二授权引擎（DD-24）。

## 1. 源码边界

Buzz 已经提供两层可复用语义，但没有一期所需的服务端 Agent 管理平面：

- `AgentDefinition` 与 `ManagedAgentRecord` 均位于 `desktop/src-tauri/src/managed_agents/types.rs`：前者表达 slug、展示身份、system prompt、runtime、model/provider、触发默认值、并行度与来源，后者表达独立 pubkey、backend、运行状态和 persona source version（SF-BUZ-11）。它们是 Desktop 本地存储/命令模型，不是 Relay 或 buzz-web 的服务端 CRUD API。
- Persona resolver 能解析 identity、instructions、runtime/model、channel subscription、triggers、MCP、skills 和 env；但 hooks/skills 在当前 Buzz 源码中只保留字段、未接入执行（SF-BUZ-12）。
- Buzz effective config 位于 Desktop Tauri，已区分 Definition、Global、Legacy 来源和 orphaned instance；Desktop UI 只在 local Agent 运行中、连接正常且空闲时按配置漂移 stop/start（SF-BUZ-13/14）。该策略不能直接充当 Web/服务端 projection controller。

Codex 提供实际服务端投影接缝：role config/developer instructions（SF-COD-06）、skill roots/list/enable/change notification（SF-COD-07）、MCP server/tool allow-list、timeout 与逐工具 approval mode（SF-COD-08）。AgentGateway 提供版本化 ConfigResource 与 MCP/LLM PEP，但其管理 router 本身没有认证 middleware（SF-AGW-01/02、SS-AGW-PEP）。

由此得到确定边界：Buzz Relay 保留 Agent 协作身份、Persona event、频道消息语义与 NIP-AE engram 权威；SS-BUZ-AGENT-MODEL 只提供 Desktop Definition/record/effective/source/drift 的确定字段和判定接缝，Desktop file/Tauri/host process/restart 不进入服务端链。SS-BUZ-ENGRAM 是 `SERVER_CODEX` 读写 NIP-AE 的独立适配接缝。这些服务端适配属于 `ADAPTER_REQUIRED`，不得标记 `UPSTREAM_SUPPORTED`。Core 是 Agent Definition/Version/Installation 与统一治理权威；Buzz NIP-AE 是 Agent 长期记忆权威；Codex 是一期服务端 runtime 及 Session 历史权威；AgentGateway 是工具/模型执行投影和调用时 PEP。AgentRegistry 不在运行链中（SF-BUZ-16/17、SF-COD-09、DD-65）。

## 2. 管理层级

```text
Tenant
  ├─ Agent Definition Resource (HUMAN owner)
  │    └─ Agent Version Asset 1..n (immutable after PUBLISHED)
  ├─ Skill Definition Resource (HUMAN owner)
  │    └─ Skill Version Asset 1..n (immutable after PUBLISHED)
  ├─ Tool Resource / LLM Route Resource
  └─ Workspace
       └─ Agent Installation Resource (HUMAN owner)
            ├─ exact Agent Version
            ├─ one AgentPrincipal + BuzzIdentityBinding
            ├─ AgentMemoryBinding + NIP-AE core/mem namespace
            ├─ ChannelAgentBinding
            ├─ ToolBinding / Skill selection / Model route
            └─ AgentRuntimeProjection generation
```

- Agent 在 Tenant 定义，避免每个 Workspace 复制 Persona；Definition 的稳定身份与已发布行为版本分离。
- Workspace 安装确定版本，不安装“latest”。发布新版本不会改变任何 Installation。
- 一期 Workspace 与 Buzz Channel 一对一，因此 ChannelAgentBinding 不再创建新 scope；它只控制 mention/manual-assignment 触发。
- 一个 Installation 只有一个 AgentPrincipal 和一个独立 Buzz pubkey。跨 Workspace 复用同一 Definition 时建立不同 Installation/Principal，不共享权限、委托、会话、额度或运行状态。
- Skill 与 Tool 是独立受治理 Resource；AgentVersion 只声明期望版本/工具，Workspace Installation 再决定是否绑定。

## 3. Agent Version 管理内容

一个版本只允许声明下列内容：

| 类别 | Version requested 值 | 不由 Version 决定 |
|---|---|---|
| 身份与 Persona | display identity、说明、instructions、reply policy | Tenant membership、Buzz roster、owner |
| 运行时 | RuntimeProfile key、turn limits、parallelism | runtime slot、host credential、进程权限 |
| 模型 | 一个 `llm_route` Resource 引用、模型参数边界 | provider URL/key、最终 route authorization、费用权限 |
| Skill | 精确 SkillVersion Asset 引用 | Skill owner 授权、artifact materialization、工具授权 |
| 工具 | Tool Resource 声明集合 | ToolBinding、Resource permission、Delegation、Approval |
| 触发 | mention/manual-assignment 默认值 | Workspace 是否安装、Channel 是否启用 |
| 记忆 | core write mode、cold write mode | 记忆正文、NIP-AE key/counterparty、HUMAN owner、当前 head |

DRAFT 可编辑；PUBLISHED 后内容与 `config_hash` 不变；RETIRED 禁止新安装但不改写仍被历史 Invocation 引用的事实。Agent 的 stable slug、HUMAN owner 与 published-version pointer 属于 Definition Resource，不塞入版本正文。

不得把 Buzz Persona 的任意 `env_vars` 原样开放给 Web 管理员。Buzz 源码把 env 视为 runtime-specific opaque 字段（SF-BUZ-11/12），而一期 Web 禁止 host process/local credential；因此 `SERVER_CODEX` 只接受 RuntimeProfile 明确列出的受控字段，Secret 只能引用 `SecretRef`。

## 4. Effective Agent Config

Core 对每个 Installation 生成一份可解释的静态运行投影，不让 runtime 自己拼接平台策略：

```text
AgentVersion requested
∩ active Workspace Installation
∩ ChannelAgentBinding
∩ SkillVersion/ToolBinding/LLM Route binding
∩ AgentPrincipal SpiceDB discover/consume/execute
∩ AgentGateway projection
∩ RuntimeProfile capability
= AgentRuntimeProjection effective
```

每个静态字段均返回 `requested / effective / source / reason_code`。不存在“继承后看不出来源”的黑箱：Buzz 已证明字段来源可显式区分（SF-BUZ-13），Core 将该原则扩展到 Workspace 与治理约束（DD-27）。

Memory policy 只收窄 Agent 对自身 Installation 记忆的写入能力，不进入 Tool/Resource permission 并集。AgentRuntimeProjection 固定 `core_write/cold_write` 的 effective 值；当前 core event 与 cold value 是运行时 native state，不进入 projection config hash。记忆分层与优先级以 `19` 为准。

具体用户触发或委托时，再以同一行的静态 effective 值进入 ActionDecision：

```text
AgentRuntimeProjection effective
∩ initiating HUMAN current permission/delegable permission
∩ DelegationScope + ResultExposurePolicy
∩ Approval decision
∩ CapacityLease + OpenMeter quota decision
∩ AgentGateway call-time PEP
= invocation capability decision
```

管理页可以把两层结果并排展示，但不能把 `WAITING_APPROVAL/QUOTA_BLOCKED/CAPACITY_BLOCKED` 写回 projection 或 config hash；这些 reason 来自当前预览/Invocation 的 ActionDecision。

固定 reason code：

| Reason | 确定含义 |
|---|---|
| `NOT_BOUND` | Version 声明了资源，但 Workspace/Installation 未绑定 |
| `NO_PERMISSION` | 当前 Principal 对目标缺规范 permission |
| `NO_DELEGATION` | Agent 动作缺有效用户委托或不在 scope |
| `WAITING_APPROVAL` | 参数固定的 ApprovalWorkflow 尚未终结 |
| `QUOTA_BLOCKED` | OpenMeter entitlement/credit 或严格 reservation 拒绝 |
| `CAPACITY_BLOCKED` | 平台 runtime slot 未取得 |
| `PROJECTION_FAILED` | Gateway、Skill root 或 runtime config 投影未对账 |
| `RUNTIME_NOT_READY` | runtime 未就绪或旧 generation 正在 drain |
| `NOT_AVAILABLE_ON_WEB` | profile 依赖 Desktop/Mobile/local host |
| `NOT_SUPPORTED_BY_RUNTIME` | selected runtime 不实现声明能力 |
| `DISABLED` | Definition、Version、Installation、binding 或资源已停用 |

Reason 只解释结果，不替代 ActionDecision。运行时只收到 effective 子集，不收到被拒绝的 Secret、工具或 Resource 列表。

## 5. RuntimeProfile 与一期 Codex 投影

RuntimeProfile 是平台随版本发布的能力合同：

| Profile | 一期状态 | 能力边界 |
|---|---|---|
| `SERVER_CODEX` | `ADAPTER_REQUIRED: SS-COD-RUNTIME` | app-server、Responses→AgentGateway、skill roots、Streamable HTTP MCP 的上游接缝成立；Core supervisor、AgentTaskWorkflow（DD-69）与凭据链（DD-70/71）完成对账前不 active |
| `LOCAL_ACP` | `EXCLUDED` | Buzz local backend 依赖 Desktop 本地执行面，一期 Web 不进入运行链 |
| `REMOTE_PROVIDER` | `EXCLUDED` | 固定源码没有一期所选 provider/substrate 与完整治理合同 |

`SERVER_CODEX` 投影固定满足：

- Installation 独立 runtime state/isolation ref；无用户 cwd、local environment 或平台运维 credential。
- Installation 的 CODEX_HOME 配置中不创建 local environment，这是跨 resume 的承重封堵；`thread/start.environments=[]` 与 Core 从不发送 `turn/start.environments` 是纵深防御。client `initialize` 仍声明 experimental API 以发送 thread/start 空数组；`shell_tool=false` 只作纵深防御，Core 不调用三个 host RPC（SF-COD-03/04/11/12，DD-15）。
- model provider 只指向已授权 AgentGateway Responses route（SF-COD-05、SF-AGW-04）。
- MCP 只含有效 ToolBinding 交集，使用 `enabled_tools/disabled_tools`、timeout 与 approval mode 再收窄（SF-COD-08）。
- SkillVersion artifact 以 digest 验证后进入 Installation 专属只读 root；Core 用 `skills/extraRoots/set` 与 `skills/list(force_reload)` 核对发现结果。`skills/config/write` 只改变 Codex 本地启用投影，不改变 Platform Resource/permission（SF-COD-07）。
- Codex thread 固定为非 ephemeral 并持久回填 AgentSession `runtime_thread_id`；新 Session 从 AgentMemoryBinding 读取一次 NIP-AE core 并固定 event ID。Codex MemoryTool 固定关闭，不建第二长期记忆投影（SF-COD-09/10、DD-65/67）。

Buzz Persona 的 `skills` 当前未接执行（SF-BUZ-12），因此一期不声称“写入 Buzz Persona skills 即完成安装”。Buzz Persona 是行为语义来源，Codex skill root 才是 `SERVER_CODEX` 执行投影。

### SERVER_CODEX runtime 归属

Codex Runtime Supervisor 是 Platform Core 内的受治理模块，不是新的权威服务。每个 active Installation 恰有一个受监督 app-server 进程：Core 先创建 Installation 专属 runtime 目录，以该绝对目录设置 `CODEX_HOME`，并把 `sqlite_home` 固定到同一目录内；目录、进程与 IPC endpoint 均不得由 Browser、Agent prompt 或组件 manifest 指定（SF-COD-15、SS-COD-RUNTIME）。

Core 负责 spawn、存活探测、崩溃重启与排空。启动前写入 AgentVersion instructions、Gateway/MCP projection、skill root 和 OpenBao 解析后的进程环境；就绪条件是 app-server initialize 成功且 projection generation 与进程加载值一致。未就绪时 Installation 保持 `PROVISIONING` 或 `ERROR`，EffectiveField reason 固定 `RUNTIME_NOT_READY`，不得接受新 trigger。升级、撤权或停用先停止新 turn，以 `turn/interrupt` 中断已知在途 turn、以 `config/mcpServer/reload` 重建 MCP client；两者都不能抹除已经写入 rollout 的结果（SF-COD-14）。排空结束后 Core 终止进程并保留受治理的 durable thread state，直到对应 Installation 的保留规则允许删除。

## 6. 发布、安装、升级与回滚

### 发布

```text
DRAFT AgentVersion
→ validate referenced Resource/Asset and RuntimeProfile schema
→ owner/permission/Approval when policy requires
→ freeze config_hash
→ PUBLISHED
```

发布只产生可安装版本，不创建 AgentPrincipal、Gateway route、runtime 或 Workspace 权限。

### 安装

```text
select exact PUBLISHED version + Workspace
→ create AgentInstallation Resource with HUMAN owner
→ create AgentPrincipal/BuzzIdentity binding
→ bind AGENT identity to Tenant CONTROL identity as AgentMemoryBinding
→ establish SpiceDB workspace relationship + Buzz Channel roster
→ establish Channel/Tool/Skill/Model bindings
→ governance admission
→ build PENDING projection
→ reconcile Gateway/skill/runtime
→ ACTIVE
```

SpiceDB workspace relationship 投影及 fresh `discover` Check、Buzz Channel roster、active ChannelAgentBinding、AgentMemoryBinding 与 runtime generation 任一未闭合时，Installation 保持 `PROVISIONING/ERROR`，菜单可显示管理错误，但 Channel 不发现、不触发。AgentPrincipal 不建立 HUMAN WorkspaceMembership；Installation 是其 Workspace 归属事实（DD-50/66）。

### 升级与回滚

升级或回滚都固定目标 PUBLISHED version，生成新 projection generation。新 generation 完成对账后，Installation pointer 原子切换；之后的新触发只使用新 generation。已开始 Invocation 固定旧 version/generation 并自然结束，符合 Buzz 只在 Agent 空闲后应用漂移配置的安全方向（SF-BUZ-14）；`DRAINING` 只用于 AgentInstallation。旧 AgentRuntimeProjection 保持不再被选择的 `ACTIVE` 历史 generation，待其 Invocation 结束后转 `REVOKED`。

权限撤销、Delegation 到期、Quota 拒绝或工具 route 撤销不是“等 turn 结束的配置升级”。这些事件按 `10` fresh check：立即禁止尚未发生的外部副作用、停止新触发并关闭已知连接；已发生的 usage/audit 保留。

## 7. 八维治理贯穿

| 维度 | Definition/Version | Installation/Invocation |
|---|---|---|
| Tenant | Agent/Skill Resource 与 Version Asset 同 Tenant；Definition 不跨 Tenant 发布 | Workspace、Principal、bindings、target Resources 必须同 Tenant |
| Workspace | Tenant 级定义显式 `home_workspace=NONE`；发布不隐式授权 Workspace | Installation 固定一个 Workspace；Channel trigger 不建立新 scope |
| Authorization | create/update/publish/retire 检查 Resource `create/update/manage` 和 Asset 权限 | discover/trigger/execute/tool/result 每阶段 fresh Check；Version 声明不授予权限 |
| Approval | 发布、owner transfer、敏感配置变更按 ActionDefinition 决定 | 高风险工具、升级/回滚与 owner 相关动作绑定参数 hash 的 Temporal Approval；Component binding 停用固定引用 `05` §2.4 的 NONE，native delete 另立受审批 Action |
| Workflow | 同请求无等待的草稿读取/编辑可为 SYNC | publish/install/upgrade/turn/tool child action 中需要持久生命周期的部分由 Temporal 承接 |
| Capacity/Quota/Billing | 发布本身按明确 `NONE` 或管理 meter | Codex slot 用 CapacityLease；工具用量按 native source、模型用量按 SS-AGW-USAGE 闭合后的 durable source 写 OpenMeter；按 Agent/Installation 归集 |
| Operation Audit | 记录 owner、版本、config hash、引用变化、批准与发布结果 | 记录 effective generation、trigger、delegation、tool/model、approval、runtime/native refs、reply 与 usage；不存 prompt/body |
| Business Observability | 展示版本采用分布、投影错误和治理状态 | 展示 turn/工具/等待/失败、Gateway token/cost、Quota/Capacity、reply 和 terminal；按 `read/audit` 过滤 |

Memory 不是第九个独立治理维度；它的 binding、Session、read/write 必须同时经过本表八维。具体 Action、meter、Audit 最小字段和 Business Observability 状态以 `19` 为准。

Agent 与 Skill 的 accountable owner 始终是 active HUMAN。AgentPrincipal 可以是 actor/producer，不能批准自己的动作、转移 owner 或成为 Resource/Asset owner。

## 8. 客户端管理交互

三端的 `Agents` 内置模块只调用 BFF 语义 API，不直连 Codex、AgentGateway，也不调用 Buzz Desktop 上游自带的 managed-agents Tauri command——后者只作语义来源，不作运行路径（SS-WEB-01、SF-WEB-01、SS-BUZ-AGENT-MODEL）。Buzz Mobile 上该模块按 REQ-21 为只读。页面结构在三端一致，固定为：

| 页面 | 核心内容 | 权限 |
|---|---|---|
| Agent 列表 | Tenant Agent、owner、published version、Workspace 安装数、状态 | `discover` |
| Definition | identity、instructions、RuntimeProfile、版本历史、publish/retire | `read/update/manage` |
| Installation | Workspace、exact version、AgentPrincipal、Channel trigger、runtime state | Installation Resource `read/manage` |
| Capabilities | model、skills、tools、Resources 的 requested/effective/source/reason 矩阵 | `read`；敏感 evidence 需 `audit` |
| Delegation & Approval | 谁可委托什么、有效期/次数、等待中的审批 | `delegate/approve` |
| Operations & Usage | Invocation/Workflow、tool/model/native refs、token/cost、Quota/Capacity | `read/audit` 与 ResultExposurePolicy |
| Memory | core、cold-memory slug、Session 固定 core event、读写/冲突/usage；不默认暴露正文 | Installation Resource `read/update/audit` |

表单预览必须先显示将创建的 Version、影响的 Installation、权限/owner/审批、Quota/Capacity 与投影差异。保存 DRAFT 不等于发布，发布不等于安装，安装不等于已授权，Projection ACTIVE 不等于某次工具调用必然获准。

Agents、Capabilities、Delegation、Approval、Operations 与 Usage 全部属于 `BUZZ_NATIVE` surface：实时继承 Buzz resolved theme/CSS variables，所有 label、reason code、validation、状态、空态和确认文案进入 `AppLocale(en/zh-CN) + MessageKey/t`。Codex、AgentGateway 或 Buzz native error 只作为受权 evidence 展开，不成为未本地化的主状态；Agent 定义不保存自己的主题或 locale（REQ-08、SF-WEB-03、DD-36）。

## 9. AgentGateway 管理边界

Core 是 Agent/Tool/LLM requested/effective 配置的唯一写入者，AgentGateway ConfigResource 是执行投影：

```text
Core AgentRuntimeProjection
→ SS-AGW-ADMIN authenticated Core-only management boundary
→ AgentGateway ConfigResource create/update/delete
→ store version + change subscription reload
→ read-back/hash reconciliation
→ projection ACTIVE
```

不使用 xDS 反向写配置（SF-AGW-03），不允许 Browser、Agent 或 Tenant admin 直接访问当前无 auth middleware 的 `/api/config/resources`、`POST /api/config`（覆写配置文件）与 `llm.settings`/`mcp.settings`（SF-AGW-02、SS-AGW-ADMIN），也不通过 AgentRegistry 中转（DD-29）。SS-AGW-ADMIN 未闭合时 Gateway 管理投影不得 active；内网或 CORS 不作替代。Gateway route/policy 被人工或外部过程改变时，read-back hash 不一致使 projection `ERROR`，Core 停止新触发，不从 Gateway 反向生成业务授权。

## 10. 停用与失败语义

- Version retire：禁止新安装；现存 Installation 继续固定旧版本，直到显式升级、回滚或停用。
- Installation disable：先停 discovery/trigger，再撤 Tool/Skill/LLM projection，取消等待动作并按真实能力 drain/cancel runtime；不删除 Definition、历史 Invocation、Usage 或 Audit。
- Definition disable：阻止其全部新安装/升级，并对各 Installation 执行同一停用收敛；不跨 Workspace 合并状态。
- Skill/Tool/LLM Route 撤销：effective matrix 立即给出确定 reason；受影响 projection 重建。Skill 缺工具依赖时只禁用该 skill/tool 路径，不自动扩大权限或切换替代工具。
- projection 超时：状态为 `ERROR/PROJECTION_FAILED`，不得以旧配置响应新触发；运行中旧 Invocation 仍按撤权规则做副作用 fresh check。
- runtime 回应成功但 Buzz reply 发布失败：Invocation 不标成功；保留 runtime outcome 与 reply failure evidence，由原 operation 对账，不能另建无关联回复。
- core 读取失败：区分 `ABSENT` 与 `UNREADABLE`，后者不注入 onboarding 也不覆盖写；已建 Session 不因新 head 静默改变。
- memory 写入冲突：发布后重读不是本 event 则记 `CONFLICT`，不自动重发；Workspace/Installation 撤权后每次 memory tool fresh Check 拒绝新操作（SF-BUZ-16/17、DD-67/68）。

## 11. 明确排除

- AgentRegistry、AgentTeams、WeKnora Agent/skill/sandbox 不承担一期 Agent 管理或 runtime 权威。
- AgentGateway 不保存 Agent Definition、owner、Delegation、Approval、Quota 或 Audit 权威。
- Buzz Persona pack 不是平台授权包；其 MCP、skill、env 字段不能绕过 Catalog/RuntimeProfile。
- 一期 Web 不提供 local ACP、browser shell、computer-use、Desktop credential 或 arbitrary runtime/plugin upload。
- 不为 Agent 管理拆出 Registry、Policy、Deployment、Skill 或 Projection 微服务；这些都是现有 Core Catalog/Admission/Projection 内的领域对象。
- 不引入 OpenViking 或 Codex 自动 Memory Pipeline；Buzz NIP-AE 是 Agent 跨 Session 长期记忆的唯一权威（DD-65）。
