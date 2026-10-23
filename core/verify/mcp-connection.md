# 用户自助连接器核验记录（DD-149、V-SCN-240–246）

本记录说明 `agent.mcp_connection` 的实现边界与已运行的检查。设计权威为
`.design` `550b9a61d0d3746b74420b33d78d8ebe4c3ad346`（`02` DD-149、`03` §7、`05` §2.15、
`07` §8B、`12` §3、`16` V-SCN-240–246、`17` 工具与连接器）。本记录不是业务验收：
分支未合并、未构建镜像、未部署；全系统验收按文末步骤在合并部署后进行。

## 领域规则

- 连接器是平台核心 ResourceType `mcp.connection` 的一对一扩展 `catalog.mcp_connection`，
  每次确认清单写入不可变 `catalog.mcp_connection_generation`（服务器信息、全部上游工具
  摘要、启用工具快照）。端点、认证方式、标识与创建动作不可改写，generation 只前进，
  `DELETED` 不可逆，每次更新 `version` 只加一（库触发器拒绝其余写法）。
- 工具是既有 ToolDefinition Resource，来源 `USER_REGISTERED_EXTERNAL`、
  `backend_ref=CORE_EXTERNAL_MCP_RELAY`、`capability_contract_key=NONE`，`action_key` 即
  调用策略（`mcp_connection.tool.invoke` 只允许 `READ_ONLY`）。Tool Resource ID 由
  上游名、标题、描述、annotations、schema、风险、策略与首次启用 generation 派生：
  任何一项变化即新工具，旧授权不覆盖（描述变化即典型的“工具篡改”）。
- 七个管理动作（`05` §2.15）SYNC、HUMAN-only、EXPLICIT、无审批与计量；有外部效果的
  create/update/rotate/delete 先在同一事务持久化 Core 事实与 `UNKNOWN` 派发，再写
  OpenBao 与 SpiceDB，最后 `DISPATCHED`+`OUTCOME`；同一幂等键只重驱原操作。
- 三个工具调用子动作只由 ExtMcp PEP 建立，是 Agent 根回合的子动作（发起者、执行者与
  Workspace 继承根动作，目标为 Installation）。“每次确认”审批人为 Installation owner
  （TARGET_OWNER，冻结 owner），“需要审批”为 Tenant 管理员；首次调用以
  `WAITING_APPROVAL` 返回，批准后同一回合同一参数摘要才派发；结果不明为 `UNKNOWN`，
  不重放。同一 Installation 可并存多条待审批工具调用（`one_pending_per_target` 索引
  排除这三个键）。

## 安全边界

- Gateway 的 MCP target 是 Core 私有 MCP 端点（Installation 平台工具 route），
  Core 中继是唯一连接第三方的组件：只带连接器自身凭据与 MCP 协议头，从不转发入站
  header，因此 Core MCP 令牌与 `x-platform-*` header 在结构上不会到达第三方（DD-137）。
- 出站：`https`；拒绝 userinfo/query/fragment、单标签与内部主机名；Core 解析后逐地址
  校验公网单播并钉定连接，拒绝重定向与代理；部署上限
  `KAILO_EXTERNAL_MCP_EGRESS_HOSTS` 与 Tenant 白名单；`KAILO_EXTERNAL_MCP_DEV_CIDRS`
  只用于开发部署。
- 凭据只以 OpenBao SecretRef 出现（每版本一个 CAS=0 locator
  `mcp-connection/<id>`，读取经 audited read 与 audit device 核对）；轮换、OAuth 刷新
  与删除销毁旧版本（Tenant KV 策略新增 `destroy/mcp-connection/*`）。命令摘要不含
  凭据值；界面只见 `credentialSet`。
- OAuth：PRM/AS 元数据发现、PKCE S256、resource 指示、动态客户端注册；`state` 只存
  SHA-256 摘要且单次使用，回调绑定发起 HUMAN，回调页 `no-store`、`no-referrer`、
  禁止嵌入且不含令牌；令牌临期或上游 401 时在连接行锁内刷新一次。
- 结果按不可信外部内容标注：来源块、文本原样、structuredContent 序列化为文本、其余
  内容类型以说明替换、`_meta.kailo.untrusted`，256 KiB 上限；PEP 响应相位只放行与中继
  记录摘要一致的结果。

## 已运行的检查（CI 节点固定检查镜像 `local/kailo-check:7c1a6a13…`）

| 检查 | 范围 | 结果 |
|---|---|---|
| `cargo fmt --all --check`、`cargo clippy -p platform-core -p secret-store --all-targets -D warnings` | 全部 Core 代码 | 均退出 0 |
| `cargo test -p platform-core --bin platform-core` | 全部单元测试（含连接器、出站、MCP 客户端、OAuth 共 40+ 项） | 745 passed，0 failed，66 ignored |
| `cargo test -p secret-store` | secret-store | 通过 |
| `sqlx migrate run → revert → run` | PostgreSQL 16 临时库（`--internal` 网络、tmpfs，用后删除） | 三步均成功，10 个动作定义与 2 条审批策略按 `05` §2.15 登记 |
| `deploy/local/mcp-connector-test/guards.sql` | 同一临时库：合法连接器/工具被接受；只读策略配写入工具、声明改写、端点改写、版本不前进、generation 改写、WORKSPACE 缺 Workspace、他人 owner 的工具、非法工具名、原生工具带连接器字段、OAuth 共享缺同意、墓碑复活 | 全部按预期拒绝，退出 0 |
| `deploy/local/mcp-connector-test/acceptance.sh` | 独立第三方实现（`server.py`，Python 标准库）两个 peer，隔离 `--internal` 网络，`DEV_CIDRS` 只含该网络；错 Key 拒绝、探测与 annotations 定级、调用、注入文本标注、旧版 SSE、生产策略下拒绝该网络/回环/元数据地址/http、Tenant 白名单、OAuth 发现→注册→授权→PKCE 交换（错 verifier、重放均拒绝）→调用→刷新轮换 | 4 passed，0 failed；容器与网络已删除 |

## 未覆盖与后续

- 需要真实 Core、SpiceDB、OpenBao、AgentGateway 与 Codex 的全链路（V-SCN-240–246 的
  界面、审批、频道调用与网关统计）未在本分支运行；合并后按发布流程构建与部署，
  再按下列步骤验收。
- 按用户各自授权（`PER_USER`）本期不实现（DD-149(6)）。
- 连接器 `WORKSPACE` 范围的成员可用性受固定 SpiceDB schema 约束：只有该 Workspace 的
  管理员可选用（DD-149(4)）。

## 合并部署后的验收步骤

1. 迁移 `20261026010000_mcp_connection` 随 Core 发布执行；回滚条件：迁移失败即停止
   发布（down 脚本在存在任何连接器事实时拒绝执行）。
2. Core 环境：`KAILO_EXTERNAL_MCP_EGRESS_HOSTS`（生产按平台管理员决定，未设置即任意
   公网主机）；验收环境另设 `KAILO_EXTERNAL_MCP_DEV_CIDRS` 为测试 peer 所在网段；
   `PUBLIC_ORIGIN` 必须是 Kailo 对外 origin（OAuth 回调）。
3. 在 CI 节点以 `server.py`（`MCP_TEST_AUTH=apikey` 与 `oauth`）各起一个 peer 接入
   平台应用网络，按 V-SCN-240–246 逐项操作：设置「连接器」添加、错 Key、定级与策略、
   全组织范围、Agent 版本选用与授权、频道调用三类工具（直接、确认、审批）、
   `touch /tmp/mcp-test-v2` 后刷新与重新确认、轮换、停用/恢复/删除、网关管理区统计、
   OAuth 弹窗与 Desktop 系统浏览器。
