# DD-81 普通发布的数据库屏障与保留证据

日期：2026-10-26。设计权威为 `3635890d5fde0dad94ec29e0c1f49d99ae67dd09`
的 09「普通发布的权威缺失」、修正后的 SF-BUZ-40 与 03 的原发布证据合同；归属
DD-81、DD-160、SS-BUZ-GOVERNANCE。上游固定 Buzz
`779af8886caae1317b4de962082429867ab61503`。本批不建立送达账本，也不改变
HTTP 准入、业务 actor、重试授权或普通查询的含义。

## 固定来源与实现

实现基线为 `11ad2fff18d57604eda738471e98aedb1d212992`，分支为
`codex/publication-db-fence-20261026`。先选择共享类型提交
`dd8a36849bdc988f8ff1b76d6e046cc42cfb833e`，本分支对应提交为
`fe931308de08e0a82232cd7f7cc310b316adebb3`；集成方已有原共享提交时不重复选择。数据库实际验证源码为
`3d013ef8f77d4e3c67f85a0c18ac90607176e07a`。独立数据库增量是
`fe931308d..3d013ef8f`，6 文件、701 行新增、26 行删除；证据文档另行提交。

- `migrations/0048_publication_writer_fence.sql` 在 Community 原记录增加
  `publication_epoch UUID NOT NULL DEFAULT gen_random_uuid()`。父表的
  `events_publication_fence` BEFORE INSERT 触发器覆盖现有和后续分区、直接 SQL
  及 COPY；普通非替换 kinds 1/5/7/9/1618/1621/1630/1632/1633/9002/40003/45001/45003
  使用 960 秒存储窗，1631 保留 900 秒。取得同 Community/event ID 的事务锁后，
  用 PostgreSQL `clock_timestamp()` 按秒重新检查，锁保留至事务结束。没有 GUC
  或 Channel NULL 豁免；原 ingest 900 秒入口检查保持不变。
- 1631 继续使用原 `kailo:1631:<community>:<event>` 锁，其他适用事件使用
  `kailo:publication:<community>:<event>`。已存在且内容、作者、时间、kind、标签
  与 Channel 相同的事件，包括软删除行，保留原 ON CONFLICT 幂等路径。新的签名
  epoch 标签若存在，必须唯一、二元素且与 Community 的规范 UUID 相等；旧无标签
  写入仍可使用原存储窗口，但不取得新缺失证明。
- `crates/buzz-db/src/store/publication.rs` 新增 `Db::publication_policy` 与
  `Db::publication_settlement`。实际父表、所有已附加分区、触发器启用状态、形状、
  函数体及执行方式均须匹配入库迁移；旧 schema、缺列、禁用或空转函数不提供
  settled。观察期间使用表锁排除触发器 DDL，正常 INSERT 的 RowExclusive 锁仍可并行。
- 查证在 writer 的 READ COMMITTED 事务中先取得事件锁，再以新语句读取包括软删除
  的事件；逐项匹配共享 `PublicationClaim` 并验证原签名。存在但无法重建的行直接
  报错，不能沿通用读取器的 `None` 回退成缺失。Community 必须 ACTIVE；epoch
  以原行锁保护，屏障在观察前后重新检查，数据库观察时刻严格过窗才可 settled。
  原 1631 正证据不要求历史事件具有 epoch，但缺失结论要求签名中的当前 epoch。
- 原 `runtime/replica_fence.rs::verify_floor_guard_behavior` 的测试事件改为 kind 0，
  保留其刻意验证超时 Channel NULL 豁免与提交期 floor 的原功能；不把 960 秒
  副本 floor 当成普通缺失证明。原迁移集合检查精确更新到 48，保留 47/48 版本断言。
- `schema/schema.sql` 与 `scripts/reconcile-schema-after-pgschema.sql` 同步原
  声明式 schema 和分区重新附加入口，避免另一个既有建库入口遗漏 epoch 或触发器。

## 实际检查

最终执行读取 GitHub 固定对象 `3d013ef8f77d4e3c67f85a0c18ac90607176e07a`，
原检查 SDK 为
`sha256:3007729eb192341a4f004a88e42e1e66c94fc67d763acfc96568bd7311116018`。
原 `collaboration/rust-toolchain.toml` 在容器内选择 Rust/Cargo 1.95；未修改锁文件、
未使用宿主 Cargo 或安装宿主 SDK。执行前运行原 `container_resource_preflight`，
create 后、start 前以原 `container_verify_limits` 读回实际限额。

SDK 为 2 CPU、16 GiB memory/memory+swap；独立 PostgreSQL 为 1 CPU、2 GiB，
PGDATA 使用 1 GiB tmpfs、独立 network，无共享库或 Redis。SDK 使用既有
`/volumes/data/kailo/check-cache/relay-rust-target` 与 Cargo registry/git 缓存；
源码及 TMPDIR 位于 `/var/lib/kailo-ci/tmp/publication-db-fence`。最小固定导出包含
Cargo、原 toolchain、crates、migrations、schema、scripts、原 `.github`、examples、
NIP 文档和工具 registry，不导出完整客户端树。实际 SDK 终态 exit 0、OOMKilled=false；
容器、PG 与独立网络退出后已再次回读确认不存在。

| 命令范围 | 实际结果 |
|---|---|
| 原 SDK rustfmt，选定 DB 文件 | exit 0；最终 Rust 1.95 `rustfmt --check` 再次通过 |
| `cargo test --offline --locked --lib -p buzz-core publication::` | 2 passed，282 filtered，exit 0 |
| `cargo test --offline --locked --lib -p buzz-db store::publication::tests -- --ignored --test-threads=1` | 10 passed，388 filtered，exit 0 |
| `cargo test --offline --locked --lib -p buzz-db -- --test-threads=1` | 128 passed、270 ignored，exit 0；不将 ignored 计为通过 |
| `cargo clippy --offline --locked -p buzz-db --all-targets -- -D warnings` | exit 0 |

10 项真实 PostgreSQL 检查覆盖原 1631 提交/回滚等待与 READ COMMITTED 观察、
相同 ID 的有效替代签名、原事件和删除事件再被软删除、迟到 1631 拒绝；新增覆盖
所有适用 kind 的 raw SQL 窗口、无 GUC/global 写入、保留通知 900–960 秒区间、
COPY、原 floor 行为探针、普通迟到 writer、同事件事务等待、软删除及旧 epoch
幂等重复、父表/实际子分区禁用、空转函数、缺 epoch 列、旧 epoch 缺失拒绝和损坏
保留行。raw SQL 消费者有意绕过 Rust 插入 helper，证明数据库边界；没有启动旧版
Relay 二进制，不能把它描述为旧产物在线升级验收。

反向检查仅在隔离源码导出中临时移除 settlement 的 epoch 匹配条件；
`ordinary_settlement_refuses_disabled_guard_old_schema_and_old_epoch` 实际
0 passed、1 failed、exit 101，失败原因为 `old epoch must never authorize a resend`。
逐字恢复后再次执行上述 10 项 PG 检查，全部通过。还原文件的 SHA-256 与 Git 源码一致：
`ca5179b2bb6970ccced72f878e41210b288775eb9d008f2081205f4a9993ee8a`。

原始日志根为 `/volumes/data/kailo/verification/publication-db-fence/`；最终记录在
`3d013ef8f77d4e3c67f85a0c18ac90607176e07a-check/`，包含 preflight、SDK/PG limits、
complete、negative-epoch、restored.sha256、state、exit 和 cleanup 日志。
同目录 `inner.sh` 保留实际命令与反向/还原步骤。

## 保留的失败与交付边界

- `d9282a899...-check`：缺原 toolchain 输入，SDK 默认 Rust 1.90 无法编译要求
  Rust 1.94 的 SQLx 0.9，exit 101；该轮只运行了共享类型 2 项。
- `d9282a899...-check-retry1`：已使用 Rust 1.95，但最小导出缺原 schema/scripts
  include_str 输入，且一个新增测试动态 DDL 未按 SQLx 0.9 标注已审计，exit 101。
  后者明确只使用 PostgreSQL regclass 返回的标识符，修正后重新验证。
- `43f4163aa...-format`：无网络格式容器自动请求尚未安装的 1.95，exit 1。
  沿原格式入口从工程根运行 SDK 自带 rustfmt 后 exit 0；最终 1.95 检查仍实际执行。
- `d99b18dda...-check`：共享 2 项及 PG 10 项通过；正常库测试 126 passed、2 failed、
  270 ignored，因旧迁移总数仍为 46、导出缺原 `.github/workflows`。精确修正到
  实际 48 并补齐同源输入后，最终固定版本正常库检查 128 passed。

本批是数据库实现与隔离验证，不是整个 DD-81 完成。HTTP 双签名准入、Core 原
DISPATCH 元事实与永久 Audit 证明、Native 新签名 epoch 的生产消费、合批 Relay
HTTP/Redis 检查、部署及真实三端业务另行交付。恢复、导入或禁用触发器时必须
关闭写入和缺失查证，重建屏障并轮换 epoch 后才可重开；本批没有执行生产恢复或
部署，也没有把普通 query 空、权限拒绝或超时记为确定未送达。
