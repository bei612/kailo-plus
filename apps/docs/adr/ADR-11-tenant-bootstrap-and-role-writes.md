# ADR-11：Tenant 与首位 admin 的部署引导，以及 Core 写角色关系

- 状态：已接受
- 日期：2026-09-24
- 决策者：Kailo 实施工程负责人

## 背景

Stage 2 的审批链要求「另一位 Tenant admin」批准高影响动作，而产品里没有任何人能成为
admin：授予 admin 的动作不存在，测试靠 zed 直接写 SpiceDB。`DD-82` 已把角色定为
SpiceDB relationship、授予与撤销定为同步 Governed Action，并规定有效 Tenant admin
不得为空。剩下两件 `.design` 没有定下的工程选择：

1. **第一位 admin 从哪里来。** `.design` 没有 `tenant.create` 动作，没有定义 Tenant 的
   发起方（`.design/06` §1 只说建立走 `TENANT_LIFECYCLE`）；成员邀请受 `GAP-IDN-01`
   阻断，`.design/09` §5 要求「首次认证的 Human 只有在已有 provisioning fact 时建立
   TenantMembership」。`DD-82` 只给出约束：部署引导只能在有效 admin 为空时写入一位。
   它以什么形态执行，是这里要定的。
2. **Core 怎么写 SpiceDB。** ADR-10 只让 Core 做 Check；关系写入此前都在 Worker 的
   Activity 里。角色写入是一次同步的关系写（`DD-09`：不包装 Workflow），而且「最后一位
   admin」的判定必须与写入在同一个串行点内完成。

约束：部署引导不得成为后门——不能有可从网络触达的入口、不能向已有 admin 的 Tenant
追加 admin；每一步必须留下 ActionExecution 与 AuditEvent（`apps/AGENTS.md` 规则 9）；
Tenant 与成员的建立必须走既有生命周期 Workflow（`DD-01`、`DD-45`）。

## 候选方案

### 引导的形态

- **Core 容器内的一次性子命令**（`kailo-core bootstrap-tenant`）：只有能在 Core 容器内
  执行命令的人能调用，而这个人已掌握部署（库、secret、镜像），不产生新的权限面。
  不取 OpenBao 的一次性投递、不监听端口。可重入，中断后以同一参数重跑。
- **启动时读部署配置自动引导**：同样只有部署者能改，但 Core 的启动路径本已承担一次性
  投递的消费，把多步生命周期挂在启动上会让「起不来」与「引导没完成」混在一起；配置
  留在 `.env` 里，还会被误以为可以随时改名换人。
- **service API 上的引导端点**：网络可达，需要另一套认证；它就是后门的形状，排除。
- **Platform Catalog Tenant 内的 platform admin 以 Governed Action 建 Tenant**：要先有
  Catalog Tenant 的 platform admin，同一个「第一个人」问题只是上移了一层；`.design`
  也没有登记这样的动作。

### Core 写关系的方式

- **沿用 ADR-10 的 HTTP gateway**，增加 `WriteRelationships` 与 `ReadRelationships`
  两个方法：同一枚 preshared key、同一个内网端口，不新增依赖。
- **交给 Worker 的 Activity**：角色写入就要包成 Workflow，违背 `DD-09`；「最后一位 admin」
  的判定在 Core、写入在 Worker，二者之间留缝。

## 决策

1. 部署引导为 Core 容器内的一次性子命令：

   ```sh
   docker compose --env-file .env -f compose.yaml exec -T core-bff kailo-core bootstrap-tenant \
     --slug <slug> --name <显示名> --admin-subject <IdP subject> \
     --admin-display-name <显示名> --wait-seconds <秒>
   ```

   - 发起方是 Catalog Tenant 下的 SERVICE Principal（`identity.service_principal`，
     audience `kailo-deployment-bootstrap`），每一步的 ActionExecution 与 AuditEvent 都归到
     它，关联 ID 取 Tenant ID；
   - Tenant 以 `PROVISIONING` 建立并经 `TENANT_LIFECYCLE` 开通；首位成员的外部身份登记在
     部署 IdP（`HUMAN_OIDC_ISSUER`/`HUMAN_OIDC_CLIENT_ID`，即浏览器登录所用的那一对）下，
     这就是 `.design/09` §5 的 provisioning fact；成员经 `MEMBERSHIP_PROJECTION` 开通；
   - admin 关系在 Tenant 行锁内写入，写前再判一次「有效 admin 为空」；
   - 有效 admin 非空时不登记身份、不建成员、不写关系，以退出码 4（`INERT`）返回；生命
     周期未在 `--wait-seconds` 内完成时以退出码 3（`PENDING`）返回，重跑继续；
   - 已撤权的人不由引导恢复（恢复成员属于 `GAP-IDN-01` 阻断的入口）。

   同一形态兼作「有效 admin 为空」时的恢复手段：`kailo.tenant.without_effective_admin`
   大于 0 时，部署者以一位现有成员的 subject 执行引导即可 0→1；它不能动已有 admin 的
   Tenant。

2. Core 经 ADR-10 的同一条 HTTP gateway 写与读关系（`core/crates/kailo-core/src/spicedb.rs`
   的 `write`/`read`）。读取以 `fullyConsistent` 翻页读到底（`SPICEDB_READ_PAGE_LIMIT` 只
   约束单页），流中出现 error 行或满页无游标都按结果不明处理。写入非 2xx 按结果不明，
   以同一意图重发（TOUCH/DELETE 幂等）。

3. 「有效 admin 不得为空」的串行点是 `identity.tenant` 的行锁：撤 admin、授 admin 与撤
   TenantMembership 三类动作的落定与派发都在该锁内判定并完成写入。它只在同一个 Core 库
   上成立；这正是 ADR-01 的单库前提。

## 后果

正面：真实用户可以成为 admin，审批链在产品里可用；引导没有网络入口；每个 admin 都能
追溯到一次引导或一次受治理授予。

负面：引导需要部署者进入容器；Tenant 成员除首位外仍无产品入口（`GAP-IDN-01`），邀请
闭合前一个 Tenant 只有引导出的那一位成员。Core 对 SpiceDB 的依赖从
「只读判定」扩大到「写角色关系」，gateway 端口的可用性成为角色动作的前提。

锁定：角色关系由 Core 写、成员关系由 Worker 写；二者都只写固定 schema 的 relation。

## 替换边界

出现以下任一即重新评估：`.design` 登记 `tenant.create` 或 Catalog 内的 platform admin
动作（引导退为只建 Catalog 的那一位）；`GAP-IDN-01` 闭合（首位成员改走邀请，引导只写
admin）；Core 拆出多实例且不共享同一库（行锁不再是串行点，需要 SpiceDB 写前置条件或
分布式锁）。替换只动 `tenant_bootstrap.rs`、`roles.rs` 与 `spicedb.rs`，Governed Action 的
定义与审计形状不变。

## 不改变的事

本 ADR 不改变 SpiceDB 的权威地位、固定 schema（`.design/03` §5）、`DD-82` 的约束，也不
开放任何 `GAP-IDN-01` 阻断的入口；它只选择部署引导的执行形态与 Core 写关系的传输。
