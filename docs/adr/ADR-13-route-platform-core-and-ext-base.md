# ADR-13：交付路线重排——平台核心链只含 Agent 与协作，组件底座改为可选扩展

- 状态：已接受
- 日期：2026-09-29
- 决策者：Kailo 实施工程负责人

## 背景

用户给出的最高判据（`DD-87`）：Kailo 的核心是多人多 Agent 协作管理平台，平台可以只有 Agent
与协作、什么都没有；内置的云盘、知识库、问数等服务只为 Agent 提供数据或工具，数据平面完全解耦，
管理平面经平台前端集成，接入完全经配置与协议，可替换。

旧路线的 Stage 3「Component Catalog、运行时 Host、Adapter Protocol 与能力契约」位于平台核心链
中间，Stage 5（Agent）与平台一期收口都以它为前提。这与判据冲突：没有任何业务能力服务的部署
也必须先交付组件目录、宿主、Adapter Protocol、ActionToken 与示例组件，平台收口被组件机制阻断。
同时 Stage 4 含服务读取边的 Quota 与第三方接入验收，Stage 5 含示例组件的 Tool 路径，也都把组件
机制带进了平台核心链。

约束：

- 平台门禁只含平台核心的接缝与阻断项，零业务能力 binding 部署必须通过全部平台门禁（`DD-91`）；
- 不在无产出方时预建实体或执行记录（`02-纵向交付路线.md` §4 对 ExternalExecution 的既有规则）；
- `tenant.delete` 按平台事实增量注册（`DD-99`）；
- 已实现的 Stage 1、Stage 2 不回退其已验证内容；`DD-106` 给 Stage 1 新增关闭 Buzz 自带 workflow 的退出门禁项（`V-SCN-84`），该项闭合前 Stage 1 退出门禁重新打开、不算通过。

## 候选方案

- **维持旧 Stage 3 在核心链中**：与判据冲突，排除。
- **把旧 Stage 3 整体移到 Stage 5 之后仍留在核心链**：收口仍依赖组件机制，排除。
- **拆分旧 Stage 3**：平台事实部分留在核心链，组件与能力契约部分成为可选扩展底座 `EXT-BASE`，
  业务能力扩展只依赖它。采用。

## 决策

1. 平台核心链为 Stage 0–5 与平台一期收口，收口只依赖 Stage 5。Stage 0–2 不变。
2. 新 Stage 3「平台事实与 Tenant 生命周期」只含 Tenant 删除、受限会话与 TenantLifecycleSnapshot，
   为当时已存在的平台事实类别（Core 事实、SpiceDB relationship、Buzz Community 与 roster、OpenBao
   Tenant namespace）登记销毁处理器（`DD-99`）。
3. 平台核心 ResourceType 的 Resource/Asset、owner 转移与多 owner 审批随首个产出方进入 Stage 5。
   协调者原定把它们放在 Stage 3；但全部平台核心 ResourceType（Agent、Skill、Tool、`llm_route`、
   `automation`）都在 Stage 5 首次出现，Stage 3 没有 Resource 产出方，按「不在无产出方时预建」
   的既有规则，它们与首个产出方同 Stage 交付。`V-SCN-34`、`35`、`37` 的 owner 部分相应归 Stage 5。
4. Stage 4 只含 Quota、Usage 与观测；服务读取边的 Quota 与第三方接入验收移入 `EXT-BASE`。
5. Stage 5 为 Agent 核心：Agent 各实体、Codex runtime、`AgentTaskWorkflow`、`PLATFORM_NATIVE`
   工具（Core 自托管 MCP 端点，登记为网关 MCP target，经 ExtMcp PEP，`DD-105`）、`SS-AGW-ADMIN`
   与 `SS-AGW-PEP`、会话级 bearer、Delegation、CapacityLease、NIP-AE 记忆，以及用户可见自动化
   （`DD-107`）。
6. 新设可选扩展 `EXT-BASE`「组件与能力契约底座」，依赖 Stage 4 与 Stage 5，不阻断收口：Catalog、
   宿主、Adapter Protocol、ApplicationBinding、Platform Port Router、ActionToken、服务读取边及其
   Quota、SDK 与第三方接入面、示例组件（`DD-101`）及其 Tool 路径、ExternalExecution。未启用它时
   平台端口按部署配置解析；启用时首个 PlatformProviderBinding 由部署引导 0→1 写入（`DD-108`）。
7. `EXT-FILE`、`EXT-KNOW`、`EXT-DATA` 只依赖 `EXT-BASE`。
8. `DD-87` 归 Stage 0，作为全路线约束；`SS-AGW-ADMIN` 只归 Stage 5；`SS-WEB-PRESENTATION` 归
   Stage 1（全部内置页面的主题与 i18n 依赖它）；组件宿主两条接缝归 `EXT-BASE`，不再是平台门禁。
9. 追溯记录的 `stage` 取值增加 `EXT-BASE`。

## 后果

- 平台一期收口可以在不交付任何组件机制的情况下判定，零业务能力 binding 部署就是未启用 `EXT-BASE`
  的部署。
- 风险一：Stage 3 在 Stage 5 之前没有 Resource，`tenant.delete` 的 `ALL_AFFECTED_OWNERS` 集合为空，
  审批只含 Tenant admin；Stage 5 起随平台核心 ResourceType 自动纳入。验收以此为准，不以空集合
  声称 owner 审批已被验证。
- 风险二：Stage 1–5 以部署配置直连平台服务，`EXT-BASE` 启用时才切换到 Port Router。切换前后的
  连接目标必须一致，由部署引导把部署配置原样登记为首个 binding 保证，不在切换时改地址或凭据。
- 风险三：`AI_GATEWAY` 与 `METERING_BILLING` 在 `EXT-BASE` 之前不进入 `platform_port_keys`；这不影响
  Stage 4、Stage 5 的功能，因为此前没有 PlatformProviderBinding。
- 门禁影响：`tools/check.sh` 规则 5 的 `valid_stages` 已加入 `EXT-BASE`，与 `apps/06` §1 的单元集合一致。
- 设计文档同步：`.design/02` 的 `DD-99`（注册切片）、`DD-100`、`DD-101` 与新增 `DD-102`–`DD-108`，
  `.design/16` 的 `V-SCN-39` 拆分、`V-SCN-83`、`V-SCN-84`，`05-设计覆盖矩阵.md` 的全部归属。

## 重新评估条件

- 出现一个只能由组件模型提供、而 Agent 核心链必须依赖的平台语义（即 `EXT-BASE` 的某项成为
  Stage 5 退出门禁的前提）时，重新评估拆分边界；
- Stage 5 需要跨 Tenant 或跨服务的数据面访问、无法以平台自带工具与会话级 bearer 表达时，重新
  评估 ActionToken 是否前移；
- 平台一期收口的生产部署要求 Port Router 才能满足高可用或凭据轮换时，重新评估 `EXT-BASE`
  的可选性。
