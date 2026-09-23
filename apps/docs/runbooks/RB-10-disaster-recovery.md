# RB-10 灾难恢复全流程演练

`07-运行与运维基线.md` §6 第 10 项。恢复顺序、不可删改的记录与「对账完成前不恢复用户可达入口」以 `07` §4 为准。

## 适用范围

当前拓扑的全部权威与各自的备份方式：

| 权威 | 内容 | 备份 | 恢复 |
|---|---|---|---|
| OpenBao | secret 版本、AppRole、策略、audit 设置 | raft 快照（`bao operator raft snapshot save`） | 新节点初始化后 `raft snapshot restore -force`，以原分片解封 |
| Core 数据库 | scope、binding、准入、投影、审计 | `pg_dumpall --clean --if-exists` | 同一镜像的空实例上执行转储 |
| Buzz Relay 数据库 | Community、Channel、消息、roster | `pg_dumpall` | 同上 |
| Relay 媒体（MinIO） | 附件字节 | 停写后复制数据目录 | 解包到空数据目录 |
| Temporal 数据库 | Workflow history 与 visibility | `pg_dumpall`（含 `temporal` 与 `temporal_visibility`） | 同上 |
| SpiceDB | schema 与关系 | **`zed backup create`（批量导出 API）** | 空库迁移后 `zed backup restore`（批量导入 API） |
| IdP（本地 Keycloak） | 用户与其稳定 ID | 停写后复制数据目录 | 容器创建后、启动前放回 |

SpiceDB 不能按 SQL 转储恢复：它的 revision 是 Postgres 事务 id，恢复到另一个集群后已存关系全部不可见，新的写入还会与恢复出的事务表冲突而中止（`SF-SPZ-06`，演练中实际撞到）。

不在备份范围内：`deploy/local/secrets/`（解封分片、root token、各服务凭据）——部署拓扑中它们由外部密钥源持有，不与数据放在一起，灾难后仍在；本地 registry——它是按 digest 引用的产物仓库，不是业务权威。

工具：`deploy/local/dr-backup.sh <目录>`、`deploy/local/dr-restore.sh <目录>`；演练编排 `core/verify/drill-dr.sh`。

## 触发信号

- 任一权威的存储丢失、损坏或不可恢复（卷被删除、磁盘故障、误删数据目录）；
- 主机或整个部署不可用且需要在新环境上重建；
- 定期演练（生产发布前，以及每次新增权威进入拓扑之后）。

## 判定依据

1. 丢失的是哪些权威：逐个检查上表中的存储。只丢失一个权威时，仍按固定顺序恢复它及其后的对账，不把其他权威回退到备份时刻——那会丢掉备份之后的合法变化。
2. 备份是否可用：`sha256sum -c SHA256SUMS` 通过，且每个文件非空。校验不通过的备份不用于恢复（`dr-restore.sh` 会拒绝）。
3. secrets 是否仍在：解封分片与 root token 丢失时，OpenBao 快照无法解封，本 runbook 不适用，按 P0 升级。

## 可执行步骤

1. **备份**（定期，或在已知风险操作之前）：`deploy/local/dr-backup.sh <目录>`。备份目录含凭据与全部业务数据，权限 700，存放位置与 secrets 同级管控。
2. **关闭入口**：`docker compose stop agentgateway`。恢复与对账完成前，任何用户不可达。
3. **恢复**：`deploy/local/dr-restore.sh <目录>`。顺序固定：OpenBao → Core 数据库 → Relay 数据库、Temporal 数据库、SpiceDB、MinIO、IdP → 启动其余服务（公开入口除外）。脚本在备份校验不通过、任一步失败时停止。
4. **入口关闭时核验**，全部满足才继续：
   - Core 各表计数与备份时一致（审计、Tenant、WorkflowRef、BuzzIdentityBinding）；
   - 备份前发出的消息在 Relay 上可读；
   - 一次新的代签发布成功（Core 从恢复的 OpenBao 取私钥）；
   - SpiceDB 中已知关系存在（`zed relationship read --consistency-full`）；
   - Temporal 中已完成的 Workflow 可按 `KailoTenantId` 查到；
   - IdP 用户 ID 与备份前一致（否则 Core 的 ExternalIdentity 对不上，所有人都无法登录）；
   - 两个 roster 对账周期内没有「roster 与成员事实不一致」；
   - `kailo.workflow_ref.*` 与 `kailo.publish.unsettled` 没有新增的 `UNKNOWN`。
5. **开放入口**：`docker compose up -d agentgateway`。
6. **验收**：`core/verify/run-integration.sh` 与 `core/verify/web-walkthrough.sh` 通过。
7. 确认恢复成立后，按保留策略处理本次使用的备份。

## 不可执行的动作

1. 不在核验通过前开放入口（`07` §4）。
2. 不按 SQL 转储恢复 SpiceDB（`SF-SPZ-06`）。
3. 不把恢复后出现的 `UNKNOWN`、搁浅或漂移「清理掉」——它们按 RB-03、RB-05、RB-07 处置；不删除任何历史 Action、Workflow、Audit 或外部执行记录（`07` §4）。
4. 不在恢复成功被核验之前删除备份：那时它是唯一的数据来源。
5. 不以 `openbao-init.sh` 初始化一个新的空 OpenBao 来「恢复」：那会生成新的解封分片与 root token 并丢掉全部 secret 版本，所有 SecretRef 不可读。

## 完成判据

- 第 4 步全部核验通过，入口已开放；
- 集成核验与浏览器走查通过；
- 备份按保留策略处理，演练记录已追加。

## 演练记录

2026-09-23，本地拓扑，`core/verify/drill-dr.sh`：

1. **第一次演练失败，环境重建**：OpenBao 的状态探测把 `bao status` 在封存时的非零退出码混进了输出，恢复在第一步超时；同时演练脚本在失败时删除了备份目录——本地数据只能从头引导重建（全部是核验夹具与平台引导数据，可重建）。由此确定两条：状态探测先取输出再解析；**备份只在恢复核验通过后删除**（「不可执行的动作」第 4 条）。重建时又撞出两处全新部署才会出现的缺陷，均已修正：compose 要求 `secrets/openbao-core.env` 存在而写它的正是 `openbao-init.sh`（`bootstrap.sh` 先放空文件）；新建的 Temporal namespace 在缓存刷新前不可见，Search Attribute 登记失败（初始化任务改为等待其可见）。
2. **第二次演练，8 项核验中 SpiceDB 一项失败**：SpiceDB 按 `pg_dumpall` 恢复后关系全部不可见，新写入因事务表冲突而中止（`SF-SPZ-06`）。入口保持关闭，备份保留。SpiceDB 的备份与恢复改为 `zed backup create/restore`。
3. **第三次演练通过**：备份 7 个权威 → 删除 4 个数据卷、OpenBao 与 MinIO 数据目录与 IdP 容器 → 按顺序恢复（SpiceDB 经批量导入恢复 3 条关系）→ 入口关闭时 8 项核验全部通过：计数 `72/2/4/2` 前后一致、灾难前的消息仍在 Relay 上、恢复后代签发布 HTTP 200、SpiceDB 归属关系 1 条、Temporal 已完成 Workflow 可查、IdP 用户 ID 不变、两个对账周期内 roster 零不一致 → 开放入口。随后 `run-integration.sh` 全过、浏览器走查 14/14。
