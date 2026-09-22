# Agent 记忆体系设计

本文定义 Agent 如何保存协作历史、恢复运行会话、携带跨 Session 长期记忆以及消费企业知识。实体字段以 `03` 为权威，Agent 配置与安装以 `17` 为权威，运行安全以 `12` 为权威。

## 1. 源码边界与唯一权威

Buzz 已定义 NIP-AE Agent Engrams：Agent 签名的 `kind:30174` addressable event 以 NIP-44 v2 加密，按 `(agent pubkey, owner pubkey, slug)` 选择最新 head；`core` 保存 identity/rules/goals，`mem/*` 保存冷条目。Buzz ACP 已在新 session 前读取 core，区分确认缺失与读取失败，并且不做中途刷新（SF-BUZ-16/17/18/19、SS-BUZ-ENGRAM）。

Codex app-server 已提供持久 ThreadStore/Rollout，可用 thread ID 恢复并分页读取 turn/item（SF-COD-09）。Codex 还有默认关闭的自动 Memory Pipeline，它会从 rollout 抽取记忆并产生 runtime-local 的全局文件工作区（SF-COD-10）。一期不启用该 Pipeline，避免它与 NIP-AE 形成两个长期记忆权威（DD-65）。

WeKnora 也已提供原生个人 Memory，它以 tenant+caller subject 持久化、能后台抽取会话并注入 WeKnora chat pipeline，但存储 scope 不含 Kailo AgentInstallation。一期只使用 WeKnora enterprise knowledge，不启用该 Memory 路由、抽取与 prompt 注入（SF-WEK-16、DD-65）。

## 2. 五层记忆模型

| 层 | 保存内容 | 唯一权威 | 作用域 | 读取方式 |
|---|---|---|---|---|
| Collaboration History | Channel/Thread/DM 消息、回复和附件引用 | Buzz Relay | Community/Channel 与消息上下文 | 按 Relay 消息/线程查询；当前轮只取有界上下文 |
| Runtime Session History | 一次 AgentSession 内的 turn/item、tool result 和 rollout | Codex ThreadStore/Rollout | 一个 `runtime_thread_id` | `thread/resume` 与分页 history API |
| Agent Core Memory | 每个新 Session 都需要看见的最小长期状态 | Buzz Relay NIP-AE `core` head | AgentInstallation 的 `(agent, counterparty)` pair | 新 Session 创建前读取一次并固定 event ID |
| Agent Cold Memory | 按 topic 分割的长期细节 | Buzz Relay NIP-AE `mem/*` head | 同上 | 通过受治理 memory tool 按 slug 读取；不全量注入 |
| Enterprise Knowledge | 可共享文档、chunk、引用与可选图谱 | WeKnora | KnowledgeBase Resource/Asset | 按 KnowledgeBase `consume` 授权检索 |

一条信息只能按其职责进入一个权威：聊天事实不自动升格为长期记忆，Codex rollout 不自动合并进 NIP-AE，WeKnora 知识不复制到 `mem/*`。Agent 使用企业知识后，只有在受治理的 memory Action 中主动存储的简短衍生结论才进入 `mem/*`，且不替代原 KnowledgeBase citation。

## 3. Tenant、Workspace、身份与 owner

```text
Tenant CONTROL BuzzIdentity
          │ NIP-AE p / encryption counterparty
          │
Workspace AgentInstallation Resource (HUMAN owner)
          ├─ AgentPrincipal
          ├─ AGENT BuzzIdentity
          ├─ AgentMemoryBinding(agent identity, CONTROL identity)
          └─ AgentSession → Codex durable thread + pinned core event
```

- 每个 Installation 有独立 AGENT pubkey，因此在同一 Tenant CONTROL counterparty 下仍然形成独立 NIP-AE namespace。同一 Agent Definition 安装到另一 Workspace 时不共享长期记忆（DD-66）。
- NIP-AE 协议中的 `owner` 在平台领域中固定命名为 Memory Counterparty。它使用 Tenant CONTROL protocol identity，仅承担 NIP-44 对手与受限读取，不是 accountable owner。
- Installation Resource 的 `owner_principal_id` 仍是唯一 active HUMAN owner。HUMAN owner 转移只改 Core/SpiceDB 责任与权限，不改 NIP-AE pair，因此不会因人员变更重加密全部记忆。
- AgentMemoryBinding 只保存 Buzz identity binding 与已观测 head ref，不保存明文。NIP-AE event 是内容权威；Core 不维护第二份 slug/value 副本。
- NIP-AE 是 Community-global 且没有 Channel tag（SF-BUZ-19）。Workspace 隔离依靠“每 Installation 独立 Agent pubkey”而不是为 engram 虚构 Channel scope。

## 4. Prompt 优先级与 Session 生命周期

运行时优先级固定为：

```text
Platform security / authorization / tool and model projection
  > immutable AgentVersion instructions + RuntimeProfile
  > current authenticated user input inside admitted scope
  > explicitly delimited Agent Core Memory context
  > bounded Relay conversation context + cold memory/tool results
```

NIP-AE 内容是 Agent 自身保存的上下文，不是 system policy、developer instructions 或授权指令。Core 中出现的“启用工具”、“改模型”、“忽略审批”等文本没有治理效力；Codex 实际能力只来自 AgentRuntimeProjection 与每次 fresh Admission（DD-67）。

新 Session 与恢复流程：

1. Core 从触发 event 解析 Tenant、Workspace、Installation 和精确 AgentVersion/projection generation。
2. Core 验证 Installation、AgentMemoryBinding 与两个 Buzz identity 同 Tenant 且 ACTIVE。
3. 新 AgentSession 在创建非 ephemeral Codex thread 前读取 NIP-AE `core`。成功时固定 `core_memory_event_id`；确认不存在时固定 `NONE + ABSENT`；传输/验签/解密/解析/超时时固定 `NONE + UNREADABLE`。Kailo 的 Session scope 是 `03` 设计定义的 `(workspace_id, root_event_id)`，与 Buzz ACP 默认的 `channel` SessionPolicy 不同（SF-BUZ-24）；core 读取次数与 `agent_memory_read_count` 计量按 Kailo scope 发生，不沿用 Buzz 默认。
4. 有效 core 以 `turn/start.additionalContext` 的保留 source key `kailo.agent-memory.core` 作为明确分隔的外部 memory context 进入首个 turn，不写入 AgentVersion `developer_instructions`。`ABSENT` 注入固定 bootstrap context，要求 Agent 先向当前 HUMAN 了解自身 identity/goals，core 写入仍经 memory Action 与审批。`UNREADABLE` 不注入“无记忆”提示，也不触发覆盖写（SF-COD-16）。
5. 活跃 Session 始终使用固定的 core event，不中途刷新。core 更新只影响之后创建的 Session。
6. 进程重启时用 `runtime_thread_id` 调用 Codex `thread/resume`；不从 Relay 消息重建已持久的 Codex rollout，也不从内存 ACP queue 恢复。

Relay 线程上下文和 Codex Session 历史不重复全量注入：Relay 只为新触发提供线程/DM 的有界协作事实，Codex ThreadStore 保存 Agent 已处理该 Session 的持久上下文。

## 5. Memory Action 与读写规则

所有显式记忆操作的 target 都是 AgentInstallation Resource，slug 只是受验证的子对象标识，不创建新 Resource/Asset。

| Action | HUMAN 入口 | AGENT 入口 | permission / approval | 权威结果 |
|---|---|---|---|---|
| `agent.memory.core.read` | Memory 详情页 | Session 创建时的内部权威查询 | HUMAN 要求 Installation `read`；内部查询继承已准入 Invocation，不递归创建 child Action | NIP-AE core head/body |
| `agent.memory.core.replace` | HUMAN owner 编辑 | Agent 提出变更 | HUMAN 要求 `update`；Agent 还要求 `memory_policy=AGENT_WITH_APPROVAL` 与本次 Temporal Approval | 新 core head event |
| `agent.memory.entry.list` | Memory 列表 | 受治理 memory tool | `read`；Agent 只能枚举自身 Installation pair | NIP-AE best-effort head tuple snapshot |
| `agent.memory.entry.read` | Memory 详情 | 受治理 memory tool | `read`；Agent 只能读自身 pair | 指定 slug head/body |
| `agent.memory.entry.set/patch/remove` | HUMAN owner 编辑 | active Invocation 内的 memory tool | HUMAN 要求 `update`；Agent 还要求 `cold_write=INVOCATION_SCOPED` | 新 value head 或 tombstone head |

固定规则：

- slug 只允许 `core` 或 NIP-AE `mem/...` 语法，不接受路径穿越、自报 Agent pubkey/owner pubkey 或自报 Relay URL。
- NIP-AE event 的协议 signer 始终是 Installation 的 AGENT BuzzIdentity。HUMAN 管理操作中，HUMAN 是 Action actor/accountable owner；BFF 在完成 admission 后使用该 AGENT identity 代签协议 event，不伪造 HUMAN 能以 owner key 写 NIP-AE。
- NIP-44 明文上限是 65,535 bytes；admission 以序列化后完整 JSON body 校验，不只校验用户字符串。
- 写入前必须读当前 head，依 NIP-AE 生成严格更新的 `created_at`，发布后重读 head 对账。重读不是本 event 时返回 `CONFLICT`，不静默重试覆盖。
- `remove` 发布 `value:null` tombstone。不依赖 Relay 执行 NIP-09 实体删除，不声称已清除 archival history。
- NIP-AE listing 通过 `(until,before_id)` 复合游标完整分页；走到末尾显示 `COMPLETE`，超过客户端 10000 条显式上界显示 `BOUND_EXCEEDED`，传输、验签或解密失败显示 `UNKNOWN`。枚举结果不实施“总条目数/总字节”严格 Quota（SF-BUZ-07）。

## 6. 八维治理与业务可观测性

| 维度 | 记忆合同 |
|---|---|
| Tenant | AgentMemoryBinding 的 Installation、AGENT identity、CONTROL counterparty、ActionExecution、UsageEvent 必须同 Tenant；跨 Tenant 读写不存在。 |
| Workspace | 记忆通过独立 Installation identity 归属一个 Workspace；NIP-AE event 本身不伪造 Channel tag。Agent 只能在安装 Workspace 的 active Invocation 中使用。 |
| Authorization | HUMAN 管理操作检查 Installation `read/update/manage`；Agent 还要求 active Installation/AgentPrincipal/Channel binding 和自身 memory policy。Memory 文本不授权。 |
| Approval | HUMAN 直接操作依 ActionDefinition 的 ApprovalMode；Agent 修改 core 固定要求 `AGENT_WITH_APPROVAL` 与参数冻结的 Temporal Approval。Approval 不补足 permission 或失效 Installation。 |
| Workflow | 普通 read/cold write 是已准入 Invocation 内的同步 child action；Agent core replace 的等待/决定/消费由 Temporal ApprovalWorkflow 承接。AgentTaskWorkflow 保存 Invocation 生命周期，Codex thread 只保存 runtime 对话。 |
| Capacity/Quota/Billing | 读写继承 Invocation CapacityLease；在 publish 前执行 memory Action 的 QuotaMode。OpenMeter 计量 `agent_memory_read_count`、`agent_memory_write_count`、`agent_memory_plaintext_bytes`，subject 固定 Tenant/Workspace/Installation/operation。协议 body 上限是硬拒绝，listing 不支撑严格总存量 Quota。 |
| Operation Audit | 每个显式 read/write/list/conflict 记录 actor、initiating HUMAN、Installation、action、slug digest、old/new event ID、bytes、decision 与 outcome。Audit 不存 slug 明文、profile/value、Nostr 私钥或 NIP-44 ciphertext。Session 内部 core fetch 作为 Invocation evidence，不递归创建新 Action。 |
| Business Observability | operation timeline 显示 `FOUND/ABSENT/UNREADABLE`、读写延迟、Relay ack、verification、conflict、bytes、Quota/Approval 状态和 event evidence ref；仅对有 `read/audit` 的 HUMAN 展示，不展示记忆正文。 |

## 7. 客户端交互、主题与 i18n

`Agents > Installation > Memory` 是 BUZZ_NATIVE 管理页，不嵌入 CLI、Relay 页或 Codex UI。页面只调用 BFF 语义 API，不接收 Nostr 私钥、raw filter 或 raw signed event。

| 区域 | 展示与操作 |
|---|---|
| Overview | Installation、HUMAN owner、Workspace、Agent identity 指纹、Memory Counterparty 指纹、binding 状态和最新 core event ref |
| Core | core 正文的受权查看/编辑、当前 head 时间、Session 生效边界；明确提示“仅新 Session 生效” |
| Cold memory | slug 列表、head 时间、单条查看/编辑/tombstone；枚举截断时显示确定状态 |
| Sessions | Buzz root event、Codex thread ID、固定 core event、AgentVersion/projection generation 和 resume 状态 |
| Operations | 受权的 Approval、Quota、read/write/conflict 和 usage 时间线；默认不显示正文 |

全部管理页使用 Buzz ThemeProvider/CSS variables 与 `AppLocale(en/zh-CN) + MessageKey/t`。`FOUND`、`ABSENT`、`UNREADABLE`、`CONFLICT`、`BOUND_EXCEEDED`、`HEAD_AHEAD_OF_RELAY` 等都是后端结构化 code，页面用本地化文案解释；记忆正文保持原文，不自动翻译。Agent 没有独立 theme/locale 配置。

## 8. 失败、并发与撤权语义

- `ABSENT` 只在 Relay 确认返回空集合时成立。非空候选无法验签/解密/解析、传输失败或超时都是 `UNREADABLE`，不触发 onboarding 覆盖写。
- 发布成功但重读的 head 不是本 event 时返回 `CONFLICT`，保留两个 event ref 作 evidence，由 HUMAN 重新读 head 后决定；不自动 last-write-wins 重发。
- 观测 head 的 `created_at` 超前 Relay 当前 900 秒准入窗口时，AgentMemoryBinding 进入 `HEAD_AHEAD_OF_RELAY`，拒绝新写入，不改写 timestamp、不删 head；待同步时钟使窗口重新成立后再对账。全部 signer 副本使用同步时钟（SF-BUZ-29）。
- Workspace/Installation 进入非 ACTIVE 后立即拒绝新读写和新 Session。已开始 Invocation 在每次 memory tool call 前 fresh Check；进程内已解密上下文不再暴露给其他 Session。
- Agent Buzz key/CONTROL key 撤销或不可用使 AgentMemoryBinding 进入 `ERROR/REVOKED`，新 Session fail closed。NIP-AE 没有权威 version chain 或 key rotation migration，因此不声称旧 ciphertext 已重加密。
- Tenant CONTROL key 能解密该 Tenant 全部 Installation 对应的 engram，这是选用稳定 Tenant counterparty 的确定信任边界；它不下放到 Browser/Agent runtime，仅在 BFF memory adapter 的受权读路径中使用；生产托管按 DD-72：以 KV v2 版本存于该 Tenant 的 OpenBao namespace，只由 Core signer 以短 TTL token 读取并驻留内存。
- NIP-AE 不定义自动 relay-set 迁移。一期不登记“自动迁移 Agent memory” Action；Relay 替换前没有经源码证明的 head republish/verify 合同时，该变更不得宣称记忆无损。

## 9. 能力状态与明确排除

| 能力 | 状态 | 依据/门禁 |
|---|---|---|
| Buzz NIP-AE 客户端加解密/head/读写与 Relay 存储/读取 gate | `UPSTREAM_SUPPORTED` | SF-BUZ-16/18/19 |
| Buzz ACP 新 session core 读取、缓存与错误区分 | `UPSTREAM_SUPPORTED` | SF-BUZ-17 |
| Codex durable thread 恢复与分页历史 | `UPSTREAM_SUPPORTED` | SF-COD-09 |
| `SERVER_CODEX` 的 NIP-AE memory adapter 与 Memory 管理面 | `ADAPTER_REQUIRED` | SS-BUZ-ENGRAM、SS-WEB-01 |
| 生产 NIP-AE 读写 | `ADAPTER_REQUIRED: SS-BUZ-ENGRAM` | Agent/CONTROL Nostr 私钥按 DD-72 托管于 OpenBao；服务端 engram adapter 复用 `buzz-core::engram` |
| Agent 修改 core 的持久审批 | `DESIGN_DEFINED` | ApprovalWorkflow 由 DD-69 的 Application Worker 承接 |
| Codex 自动 Memory Pipeline | `EXCLUDED` | SF-COD-10、DD-65；防止第二长期记忆权威 |
| WeKnora 原生个人 Memory | `EXCLUDED` | SF-WEK-16、DD-65；其 tenant+caller scope 与 Kailo AgentInstallation memory namespace 不同 |
| OpenViking/独立向量记忆服务 | `EXCLUDED` | REQ-20、紧凑性；NIP-AE 承担 Agent 长期记忆，WeKnora 承担企业知识 |

Buzz 本地 `buzz-agent::Session.history` 与 handoff summary 不进入一期记忆链：源码证明它们是 `LOCAL_ACP` 的进程内历史且无 `session/load`，而一期运行时是 `SERVER_CODEX`（SF-BUZ-21）。
