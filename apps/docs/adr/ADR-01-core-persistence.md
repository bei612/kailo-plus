# ADR-01：Core 持久化数据库与事务、outbox、锁语义

- 状态：已接受
- 日期：2026-09-22
- 决策者：Kailo 实施工程负责人

## 背景

`01-工程结构与模块边界.md` §7 列出七项持久化要求，`AGENTS.md` 规则 6 要求 Core/BFF 保持单一模块化 Rust 服务、不拆微服务。由此产生的硬约束：

- Catalog、Admission、Projection、Reservation、Audit、Outbox 共享同一业务事务边界，跨模块写入必须在一个事务内成立或一起失败；
- 严格 reservation 需要按 Tenant 加 subject 加 meter 的键串行化，这是 `07-运行与运维基线.md` §5 点名的写热点；
- Audit 与 Usage 记录不可删改（`07` §4）；
- outbox 投递必须与业务写同事务，否则外部副作用与本地状态会分叉，产生 `06-工程基线规范.md` §4 的 `UNKNOWN` 无法收敛的情形；
- `ExternalExecution` 的对账依赖 `operation_id` 的幂等键。

本 ADR 选择数据库产品，并固定事务、outbox 与锁的语义。它不选择 ORM 或查询构造工具，那属于 ADR-02。

## 候选方案

**PostgreSQL**：单写入点。事务语义完整，`SELECT ... FOR UPDATE` 行锁直接满足串行化需求，部分索引与 `EXCLUDE` 约束可表达 reservation 的唯一性，`LISTEN/NOTIFY` 可在不引入额外组件的前提下唤醒 outbox relay。可用性与写容量受单实例上界约束。

**MySQL**：事务语义同样完整，但部分索引缺失会让 reservation 唯一性约束需要额外表达，JSON 与枚举处理相对弱，对 `.design` 中大量封闭枚举与投影结构不利。

**分布式 SQL（CockroachDB、TiDB）**：消除单写入点上界，但默认串行化隔离会把 reservation 热点变成高冲突重试，跨节点事务延迟进入每个业务写路径，本地开发拓扑也变重。当前没有任何已知容量数字支持这个代价。

## 决策

选择 **PostgreSQL 16**，单库单写入点。

- **schema 划分**：按模块分 schema（`identity`、`catalog`、`admission`、`projection`、`reservation`、`audit`、`outbox`），同一数据库、同一连接，模块边界靠 schema 与代码可见性表达，不靠独立数据库表达。
- **事务**：默认隔离级别 `READ COMMITTED`。一次业务操作的全部写入（含 outbox 插入与 audit 写入）在单个事务内完成。跨事务的"先写 A 再写 B"一律不允许。
- **outbox**：`outbox.message` 表与业务写同事务插入，携带 `operation_id` 作为幂等键。独立 relay 任务读取未投递记录并投递，投递方按 `operation_id` 去重。relay 崩溃只导致重复投递，不导致丢失，因此下游必须幂等。
- **严格 reservation**：以 `(tenant_id, subject_id, meter_id)` 为主键的行，取用前 `SELECT ... FOR UPDATE`。等待超时映射到 `LIMIT` 类，冲突映射到 `CONFLICT` 类，均按 `06-工程基线规范.md` §4 的 reason code 返回。
- **不可删改**：`audit` 与 usage 相关表不授予 `UPDATE`、`DELETE` 权限，应用连接使用的角色不持有这两项权限。
- **迁移**：遵循 `06-工程基线规范.md` §5 的 expand-migrate-contract 三步。

## 后果

正面：事务语义与锁语义直接可用，无需在应用层模拟；本地开发只需一个容器；outbox 与业务写的原子性不依赖任何额外组件。

负面：单写入点是可用性与写容量的上界；使用了 PostgreSQL 方言（部分索引、`FOR UPDATE` 语义、`LISTEN/NOTIFY`），迁移到其他数据库需要改写；reservation 热点的排队时间直接取决于单实例性能。

锁定：Core 的持久化实现绑定 PostgreSQL 方言。放弃：水平写扩展能力，以及跨区域多写拓扑。

## 替换边界

满足任一条件时重新评估：`(tenant_id, subject_id, meter_id)` 键上的排队时间在预发布基线中超出发布清单所设界限；单实例写吞吐成为路线上任一 Stage 的阻塞项；出现跨区域部署要求。

更换需要改动：Core 的 persistence crate、全部迁移文件、outbox relay 的读取与锁定语句、reservation 的加锁语句。业务模块与 contract 不受影响——这是 schema 分层而非多库的直接收益。

## 不改变的事

本 ADR 不改变 `.design` 的任何权威划分与能力状态。Core 仍是单一模块化服务，各模块不因 schema 划分而成为独立服务。

## 修订

2026-09-22：schema 列表补入 `identity`。原列表遗漏了它——`01-工程结构与模块边界.md` §3 的 Identity/Scope 模块持有 session 存储等持久状态，把这些表塞进 `catalog` 会让模块边界与 schema 边界对不上。其余六个 schema 与事务、outbox、锁语义不变。
