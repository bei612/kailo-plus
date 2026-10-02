# Tenant 删除实现记录

本记录对应 `apps/02` §5、`DD-43`、`DD-91`、`DD-96`、`DD-99`、`DD-100`、`DD-109` 与 `V-SCN-31`。记录实现后成立的代码事实，不声明生产验收完成。

## 准入与不可变清单

`governance.rs` 的 `TenantDelete` 语义只接受业务 Tenant 本身的 `tenantId`，拒绝 Catalog Tenant、跨 Tenant 目标、非 `SUSPENDED` 状态、额外参数和显式确认字段。目录形状固定为业务 Tenant `manage`、`TENANT_ONLY`、`APPROVAL`、`TENANT_LIFECYCLE`，不复用 Catalog 暂停与恢复的承接执行。

`request_approval` 锁定 ActionExecution 和 Tenant 后核对版本，冻结 `admission.tenant_lifecycle_snapshot` 与一条 `subject=PLATFORM_CORE`、`mode=PLATFORM_CORE_CHAIN` 子流程。策略须为 `TENANT_ADMIN` ×1、`ALL_AFFECTED_OWNERS`、`self_approval=ALLOW`。当前 release 没有 Resource、Asset 或 ApplicationBinding 的产出方，三个 owner/binding 数组为空；不虚构 owner 事实或第二份正文权威。

物理 `frozen_inventory` 保存 Tenant ID、冻结版本与 TenantBuzzBinding 的 Community ID、host、CONTROL Principal、公钥、binding 版本。摘要为排序 JSON 的 SHA-256 小写十六进制。迁移中的触发器禁止改写冻结字段或清除已持久化的不可逆派发标记。批准后重新核对同一清单、Tenant 版本与密钥写者状态，通过才原子推进 `DELETING`、version+1 与预写 WorkflowRef。

`launch_scope` 的 `DELETE` 分支只接受 Tenant；从原 ActionExecution 查证同一个快照与平台子流程，把 `snapshotId` 放进既有 ScopeTarget。Activity 的 `tenantVersion` 是 `DELETING` 版本，即冻结的 `tenant_version + 1`。建立、暂停与恢复 input 不新增空字段，保留既有重放格式。

## 身份与可见范围

`identity::resolve` 仍只接受 `ACTIVE` Tenant。生命周期 resolver 仅用于会话展示和治理入口，BFF 每次以 FullyConsistent 检查当前 Tenant `manage`；发布 exposure 与 ACTIVE 删除定义未同时成立时，暂停 Tenant 仍被拒绝。

PlatformSession 新字段来自共享契约 `FULL`、`LIFECYCLE_RESTRICTED`。会话在 Tenant → membership 行锁内查找或建立，模式变化撤销旧会话并清除旧 Workspace 选择。普通端点与 stream 不接受受限身份；受限任务与审批查询只返回 `tenant.delete`，语义提交只接受删除及其已登记的取消控制动作。不可逆派发后取消目标判定拒绝。重跑删除入口未注册。

## 已运行与未验收的边界

`tenant_delete.rs` 已接入私有 Activity 路由，复用 `TenantLifecycleSnapshot` 与 `TenantDeleteSubprocess`，在调用 Buzz 之前原子保存不可逆标记和派发审计。Buzz 请求 ID 与摘要分别留证；冻结失败的 `submitted` 请求仅以原 `requested_by` 恢复冻结，批准者与冻结摘要匹配后才执行原生删除。SpiceDB 的精确对象删除后进行 FullyConsistent 存在性读取；OpenBao 停止该 Tenant 的续租并逐出缓存，再用父 provisioner 权限删除 namespace、查证不存在。三种外部结果均确定后才在事务内撤销 Core 身份、binding 与邀请，保留审计、WorkflowRef 与墓碑引用。结果不明保留 `UNKNOWN` 并对账，不盲目重放或转成成功。

Temporal Worker 的删除分支调用上述私有路由。取消由 Core 的持久化不可逆标记裁决，Activity 超时、provider 失联或互相矛盾的响应不生成 `FAILED` 终态；继续记录等待外部证据。响应消费者先验证共享契约的必填字段，缺失布尔字段不被解释成 `false`。

2026-10-01 已运行的证据：

- `tools/gen.sh --check` 四侧生成校验退出 0，trace 门禁检查 15 条记录退出 0。
- Worker `go test ./... -count=1` 退出 0；临时互换既有录制历史的 Activity 顺序后，重放检查实际报告 `TMPRL1100`、退出 1；恢复原实现后再次退出 0。未新建夹具或以失败测试驱动实现。
- collab-bridge 的 `cargo check`、`cargo clippy -- -D warnings`、格式与 diff 检查退出 0。
- 唯一隔离数据库执行既有 `sqlx migrate run → revert → run`，三次退出 0；回退后两张新表、冻结触发器函数与 `platform_session.access_mode` 均不存在，再前进恢复。读取字段、20 条约束、唯一索引与冻结触发器，并复用 `tools/check.sh` 的枚举门禁，39 个命名约束逐值相等。准确删除该临时库后查证 `count=0`，未触碰当前开发库。
- Core 第一次集中编译退出 101，暴露 SecretStore 续租 watch 借用冲突和既有测试初始化缺字段；二者修正后第二次编译只剩 `audit_views.rs` 未接入新增证据枚举的穷举错误，仍退出 101。接入消费者后第三次 `cargo check --locked --offline --all-targets` 退出 0：快照与子流程证据按同 Tenant、真实 `ActionExecution.operation_id` 查证；原生 Buzz 请求与摘要没有 resolver 时返回不可核验，不以 Core 保存的引用冒充原生存在性证据。
- 六处 Tenant namespace 收敛调用统一经过 `platform_keys::ensure_tenant_namespace`：以数据库 Tenant 行锁检查契约状态，并在 OpenBao 收敛期间保留锁，与进入 `DELETING` 串行；状态缺失、未知、`DELETING`、`DELETED` 均拒绝。启动、建钥、孤儿清理与退役不再仅凭进程内退休集合创建 namespace。此项已通过第三次编译，尚无运行期并发与重启验收结论。
- 四侧生成校验使用独立可写 npm 缓存后退出 0；先前缓存权限错误没有通过更改共享缓存权限绕过。另一个唯一隔离数据库完成全部向前迁移，`cargo sqlx prepare --check --workspace` 退出 0，同时报告缓存中有未被当前构建使用的查询；随后删除该临时库并查证 `count=0`。
- 本批首次 `tools/check.sh --full` 退出 1：Core 的三处显式解引用被 clippy 拒绝，TypeScript 的四个新增证据枚举缺少文案，Web 与 Desktop 工件来源摘要与当前源码不符。该次未配置 `DATABASE_URL`，迁移及依赖真实数据库的检查没有在完整门禁内执行，不把这些跳过项记作生产验收。
- 修正上述三处借用写法后，Core `cargo clippy --locked --offline --all-targets -- -D warnings` 退出 0，原始日志为 `codex-tenant-delete-clippy2-20261001.log`。该结果只闭合静态检查失败，不替代真实删除或完整门禁。
- `bootstrap.sh` 与 `secret-store-init.sh` 的 `bash -n` 退出 0；删除监听地址、端口与超时来自现有部署配置投递面，未开启实际监听或覆盖运行环境。

以上原始日志位于 `/volumes/data/kailo/tmp/`，分别为 `codex-tenant-delete-worker-go-final-20261001.log`、`codex-tenant-delete-worker-replay-mutation-20261001.log`、`codex-tenant-delete-worker-go-restored-20261001.log`、`codex-delete-client-check-20261001.log`、`codex-delete-client-clippy-20261001.log`、`codex-tenant-delete-core-check-20261001.log`、`codex-tenant-delete-core-check2-20261001.log`、`codex-tenant-delete-core-check3-20261001.log`、`codex-tenant-delete-migration-20261001.log`、`codex-tenant-delete-sqlx-current4-20261001.log`、`codex-tenant-delete-gencheck-20261001.log` 与 `codex-tenant-delete-fullcheck-20261001.log`。迁移首个连接探测因把 URI 放入 `PGDATABASE` 而退出 2，错误回显了连接串；日志已脱敏，随后改用进程内 libpq 字段完成上述演练。SQLx 缓存校验在第二个隔离库执行，不宣称当前开发库已应用新迁移；真实删除、不可逆窗口取消、provider 失联与未知结果场景尚无本记录内的验收结论。

`DD-109` 要求保留共享 CAS 对象的 count/bytes。原生冻结清单的 `PrefixManifest.object_count/total_bytes` 是被删除的 Tenant 自有前缀统计，不能作为保留共享 CAS 的统计；`retention_pending` 也不提供这两项保留量证据。当前实现只记录保留类别和未声明物理回收，不能据此认定 `SS-BUZ-COMMUNITY-DELETE` 已闭合或启用删除入口。

发布登记 `lifecycle.tenant_delete` 的 exposure 为 `none`，routes/actions/workflow_kinds 均为空。此登记只记录已有实现进度，不开放用户入口，不把源代码写入当作四类处理器或端到端验收通过。

## 已准入后的派发前失效（2026-10-01 UTC）

`DD-99(4)`、`DD-109(3)` 要求准入后的处理器缺失或结果不明保留 `UNKNOWN`。`advance_inner` 原先在冻结事实重验不匹配、密钥写者尚未收敛或删除 transport 缺失时返回冲突，事务回滚且没有子流程状态与审计。现改为在已经持有 Tenant、快照与子流程锁的同一事务调用 `mark_unknown`，保存既有 `UNKNOWN` 状态和 `RESULT_UNKNOWN` 审计，提交成功后返回 pending。`persist` 的外部未知结果分支复用同一写入，不另开嵌套事务，也不增加状态、原因码或权威数据。

该分支不设置不可逆派发标记，不调用 provider，不返回 completed 或 canceled。不可逆派发前的取消仍先执行并回到 `SUSPENDED`；原请求格式错误、版本与摘要冲突仍分别走原有 400 或 409。SQL、审计或提交失败仍返回服务不可用，不能声称已经保存 `UNKNOWN`。Worker 继续查同一子流程，pending 不生成业务终态。

本次实现后复核分为工程规范与既定设计要求两条只读检查，未发现限定改动内的确定违规；此结论不是运行期验收。镜像内执行如下命令，容器实际限额为 2 CPU、2 GiB 内存、无额外 swap；源码只读，Cargo 缓存位于 `/volumes/data/kailo/check-cache`：

```bash
cargo fmt --manifest-path core/Cargo.toml --all --check
SQLX_OFFLINE=true cargo clippy --manifest-path core/Cargo.toml -p platform-core --all-targets --locked --offline -- -D warnings
SQLX_OFFLINE=true cargo test --manifest-path core/Cargo.toml -p platform-core --bin platform-core --locked --offline
```

实际容器退出 0、`OOMKilled=false`；既有单元检查结果为 `23 passed; 0 failed; 1 ignored`。忽略项是要求显式独立 PostgreSQL 库的引导检查，不记通过。执行镜像为 `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，原始日志为 `/volumes/data/kailo/tmp/codex-tenant-delete-unknown-check-20261001.log`。没有新增夹具、测试或数据库数据；这些既有单元检查未执行新增事务分支，真实取消竞态、SQL 故障与 provider 失联仍没有业务验收结论。共享 CAS 保留量缺口不变，删除公开入口与发布 gate 继续关闭。

## 共享 CAS 保留统计的原生证据（2026-10-01 UTC）

本节针对 `DD-109(4)`，以只读 `git show`、`git grep` 与 `git ls-tree` 亲核 Buzz 固定提交 `779af8886caae1317b4de962082429867ab61503`。未执行或修改 `.references`，没有增加统计实现、删除阶段或公开入口。

| 从 `.references` 根开始的固定源码路径 | 可解析符号与实际证据 |
|---|---|
| `buzz/crates/buzz-db/src/store/deletion.rs` | `FrozenInventory`、`FrozenInventory::digest`：冻结 JSON 只有 `schema` 与 `storage`；`PrefixManifest.object_count/total_bytes` 统计对象版本及 delete marker 所属的 Tenant 前缀，不是保留的共享对象 |
| `buzz/crates/buzz-deletion/src/lib.rs` | `build_inventory`、`enumerate_tenant_prefixes`：只枚举目标 Community 的 `_meta/`、`_uploads/`、`repos/` 三个前缀的全部版本；`execute_stage` 在 `LogicallyVerified` 分支向 `DeletionStore::mark_retention_pending` 传入保留策略文字，没有共享对象数或字节数 |
| `buzz/crates/buzz-media/src/bucket_index.rs` | `BucketAggregate::finish`：`per_community.objects` 对每个 sidecar SHA 增加一，媒体 variant 与缩略图的字节参与该绑定的逻辑字节数，但缩略图不单独计对象；`classify_key` 把 Git pack、idx、manifest 归为 `Unknown`，该统计不能作为共享 CAS 物理对象数与全部字节的完成证据 |
| `buzz/crates/buzz-db/src/store/storage_accounting.rs` | `StorageAccountingLeader::save_snapshot`、`Db::load_storage_accounting_snapshot`：保存并读取异步更新的全部署 singleton 快照，不是本次原生删除请求的不可变审批清单 |
| `buzz/crates/buzz-media/src/storage.rs` | `MediaStorage::get`、`get_sidecar`、`list_prefix_versions_page`：前两者读取活动对象，后者枚举历史版本及 delete marker；该文件的公开读取方法没有按 `version_id` 读取历史 sidecar 或 repo pointer 的方法，不能仅凭版本键清单恢复历史共享引用 |
| `buzz/crates/buzz-relay/src/api/git/hydrate.rs`、`buzz/crates/buzz-relay/src/api/git/manifest.rs` | `load_pointer`、`Manifest::from_bytes`、`Manifest::validate`：现成的 pointer → digest 校验 manifest → packs 路径位于 Relay 模块；Relay 已依赖删除库，删除库不能反向链接该 Relay 模块来复用解析路径 |

可复核命令如下；上下文行号属于上述固定提交，不是当前工作树：

```bash
git -C /volumes/kailo/.references/buzz show 779af8886caae1317b4de962082429867ab61503:crates/buzz-db/src/store/deletion.rs | sed -n '503,514p;1918,1959p'
git -C /volumes/kailo/.references/buzz show 779af8886caae1317b4de962082429867ab61503:crates/buzz-deletion/src/lib.rs | sed -n '679,688p;1404,1413p'
git -C /volumes/kailo/.references/buzz show 779af8886caae1317b4de962082429867ab61503:crates/buzz-media/src/bucket_index.rs | sed -n '247,337p'
git -C /volumes/kailo/.references/buzz grep -n '^    pub .*fn get\|^    pub .*fn .*version' 779af8886caae1317b4de962082429867ab61503 -- crates/buzz-media/src/storage.rs
git -C /volumes/kailo/.references/buzz show 779af8886caae1317b4de962082429867ab61503:crates/buzz-relay/src/api/git/hydrate.rs | sed -n '245,274p'
```

缺失证据是本次冻结清单内共享 CAS 对象集合与物理字节的准确归因，包括活动引用与历史引用的统计边界，以及复用现有 Git manifest 校验的库接缝。当前冻结清单、完成检查点与全部署快照均不能证明该量；不得补零、以删除量替代保留量，或以全桶量替代目标 Tenant 的量。`SS-BUZ-COMMUNITY-DELETE` 不据此宣称闭合，`tenant.delete` 的 routes/actions/workflow_kinds 保持为空，真实删除业务仍未验收。

## 已知原生摘要的重试恢复（2026-10-01 UTC）

`DD-109(2)` 与 `03` §4 要求原生请求和摘要持久留证，恢复时继续使用同一子流程的引用。`buzz` 每轮先以 `native_reference(request_id, None)` 保存观察到的请求，再保存查证的 digest；原 SQL 整块替换 `BUZZ` 证据，因而同一请求已经保存的 digest 会先被置空。进程在第二次写入前崩溃或 SQL 失败时，后续 `Delete::result` 读不到此前确定的摘要。

本次只修改 `native_reference` 的原行更新：同一 request 且新观察没有 digest 时，在同一 SQL 更新内保留该行已有的摘要；首次观察仍保持空值，不补造摘要。不同 request（包括原生 abort 后重新提交）不沿用旧摘要。本次确定的新 digest 仍按原路径写入，`external_execution_ids` 的去重追加、稳定审计事件键、既有历史引用、事务提交与错误传播均保留。不增加字段、接口、状态或另一份原生权威。

修改前使用当前 `apps-source` 图谱执行精确 `context/impact`，`native_reference` 风险为 `LOW`，调用链为 `buzz → advance_inner → advance`；File 级结果为 `UNKNOWN`，已通过私有路由和 Worker 的实际调用补证，未把零边当作安全结论。原始输出为 `/volumes/data/kailo/tmp/codex-tenant-delete-native-ref-preimpact-20261001.log`。本节记录源码修正，不宣称崩溃窗口、真实原生删除或共享 CAS 保留量已经验收；公开删除入口保持关闭。

## 本次冻结清单的共享 CAS 证据链（2026-10-02 UTC）

本节记录 `DD-99`、`DD-100`、`DD-109(2–4)`、`V-SCN-31` 与 `apps/02` §5 的既定缺口实现，不增加删除能力、审批政策、删除阶段或公开入口。前文“没有 Resource 产出方”和“保留量缺口不变”保留的是 2026-10-01 当时范围；不能据此判断本次全工作树或其他并行切片。此处只归因本刀的原生保留统计及 Core 消费修改。

### 原错误与实际修改

被删除的 `_meta/`、`_uploads/`、`repos/` 前缀数量不能证明保留的共享 CAS 数量；活动对象读取也不能恢复历史 sidecar/pointer 引用。现有 `build_inventory` 在原 `schema/storage` 之外，以同一原生请求 Community 读取历史对象版本，计算 `retained_cas` 的 `object_count`、`total_bytes` 和 `keys_digest`，再由原 `FrozenInventory::digest` 一并绑定批准。没有新注册表、GC、删除引擎或迁移。

- `MediaStorage::get_version` 读取实际列出的 version ID；缺失或错误状态不会回退到最新对象。每份历史引用的实际读回长度还须等于对象目录的 size。
- 历史媒体 sidecar 使用原 `classify_key`、原 `BlobMeta` 与实际 ext 归因媒体对象和声明的缩略图。历史 Git pointer 使用原 manifest 解析器、原校验规则及实际 SHA-256 校验，遍历 parent 与 pack 引用，并统计存在的原生 idx 缓存。
- 归因后的精确共享键分别枚举全部版本，排除 delete marker，按 key/version 去重；物理大小取实际版本目录，不取 sidecar 声称的逻辑大小。排序后的 key/version/size 元组形成摘要，字节总和溢出、重复版本、非推进分页、缺 marker、缺引用或无法读取均拒绝，不能补零。零对象只来自完整枚举得到空集合。
- 原 Relay `api/git/manifest.rs` 的整个 codec 移至既有 `buzz-core/src/git_manifest.rs`；Relay `api/git/mod.rs` re-export 同一模块，删除旧文件。只有一个 parser。原有的媒体分类交叉检查移回 Relay 消费层，避免基础库反向依赖媒体库；未新建检查或数据。`buzz-deletion` 仅复用 workspace 已有 `sha2 0.11.0`，锁文件没有新增版本。
- 原 `retention_physical_expiry_pending` 检查点写入同一冻结摘要与保留统计。`retained_cas=None` 的历史序列化仍保持原摘要，但原 `validate_frozen_inventory` 现在在批准/执行的既有校验路径拒绝缺证据或矛盾统计。机械同步的旧测试构造没有伪造保留量；不把其 `None` 视为合法的新执行终态。
- Core `buzz` 在原生批准前要求真实冻结保留摘要；终态同时检查同一 native ID/digest、原 ActionExecution 的批准、`retention_pending`、未 blocked、唯一已完成的原保留检查点、完全相同的保留统计及 CONTROL owner host 缺席。仅统计元数据进入原 `provider_evidence`，不复制对象键清单或正文，也不持有对象库凭据。
- Core 的 BUZZ 与 completed 审计仍以原 `TenantDeleteSubprocessId`、原生请求 ID/digest 回指同事务的持久保留元数据；没有把 JSON 塞进 EvidenceRef 的 ID。`finish` 不接受缺保留统计的旧成功摘要，也不接受“共享 CAS 已物理回收”的声明；异常沿原 `UNKNOWN/RESULT_UNKNOWN` 收敛。

上述 count/bytes 是批准时冻结的、归因于目标 Community 的物理版本统计，不是完成时全桶实时量，不表示这些共享字节已被删除。Community 墓碑、批准/检查点、分离后的反馈和限流记录仍按原生合同保留。SpiceDB、OpenBao、OpenMeter 处理器继续使用原有权威与现有合流，不在本刀重写。

### 原始影响面与增量归属

统一图谱起始记录为 `e4c544fdb63d5e54fe775d58e684249166c89543`，`apps-source`、schema 4/current、`incompleteReasons=[]`，indexedAt `2026-10-02T05:17:22.981Z`。本刀没有启动 writer。原生 context/impact 的完整原件位于 `/volumes/data/kailo/tmp/`：

- `codex-tenant-delete-cas-preimpact-20261002.hmfQmv.raw.jsonl`：原消费者与目标函数；同名 `from_bytes` 的广义图边风险实际为 CRITICAL，不能当作干净图。
- `codex-tenant-delete-cas-exact-pdg-20261002.68vps6.raw.jsonl`：精确 DTO/codec context；`FrozenInventory` LOW/19，`Manifest` MEDIUM/52，`MediaStorage` Impl UNKNOWN/0。零边由源检索补证，不当作零风险。
- `codex-tenant-delete-cas-file-pdg-20261002.Fl3MfG.raw.jsonl`：Core controls 194 完整；宽 file flows 与原生 controls 页 200 有截断，明确不能当作全集。
- `codex-tenant-delete-cas-target-pdg-20261002.luGzl8.raw.jsonl`：正确名字锚定的 build/validate/execute functions；flows 分别 4/6/76，controls 分别 0/3/56，均无截断；Core durable 变量 flows 3 完整。首次不合法 limit 1000、以及 UID 被当作文件路径的空 PDG 原件保留，均不作为覆盖通过证据。新函数与跨语言隐式流不由旧图证明，实际源码、调用点与编译补证。

本刀 before 目录为 `/volumes/data/kailo/tmp/codex-tenant-delete-before-20261002.qqGpdr`；精确源码窗口为 `codex-tenant-delete-source-window-20261002.diff`，after SHA 为同名 `.sha256`。窗口源码为 `+868/-544`，包含原 codec 整体移位，不能当作等量新逻辑；不是 HEAD 以来全部脏树。范围为 Core `tenant_delete.rs`、本记录、原生 deletion/store/media/core/git 模块、原文件删除，另含三份既有测试构造的机械字段同步及 deletion Cargo.toml/lock 的最小依赖闭包。共享四语言契约未改变。

### 已运行的窄验证、失败与边界

项目检查镜像 `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82` 内的 rustfmt 已实际完成；最终三文件定点格式化退出 0。原生编译使用现有 `collaboration/Dockerfile` 的固定 Rust 1.95 bookworm 基础镜像 `sha256:6258907abe69656e41cd992e0b705cdcfabcbbe3db374f92ed2d47121282d4a1`，实际 rustc/cargo 1.95.0。执行者 UID/GID 1000，编译限额实际为 6 CPU、10 GiB、swap 0；保持 Cargo 16 jobs。缓存独占 `/volumes/data/kailo/cache/desktop-e2e-target`，没有与 Core lane 的 target 并发写入。

在真实 collaboration workspace 执行：

```bash
cargo test --locked --offline -p buzz-core git_manifest --lib
cargo test --locked --offline -p buzz-deletion -p buzz-db -p buzz-media --lib
cargo check --locked --offline -p buzz-relay --all-targets
```

容器终态实际 0，结果为 codec 23/23、buzz-db 128 passed/258 ignored、buzz-deletion 17 passed/9 ignored、buzz-media 127/127；Relay all-targets check 实际 0。日志为 `/volumes/data/kailo/tmp/codex-tenant-delete-native-compile-20261002.Twor9o/sdk-verify.log`。267 项外部环境检查没有运行；原有分类测试虽移至 Relay 并经过 all-targets 编译，本轮未执行其 Relay 二进制测试。

失败不隐藏：最初离线 SDK 因缺固定 rust-s3 git checkout 实际退出 101（`codex-tenant-delete-sdk-20261002.arMOIT/sdk-verify.log`）；锁定依赖 fetch 后，完整 codec 搬移暴露原分类检查反向依赖不可见，实际退出 101（`codex-tenant-delete-sdk-online-20261002.Imsync/sdk-verify.log`），随后只搬回原检查。首次原生基础镜像没有 rustfmt component，实际退出 1（`codex-tenant-delete-native-sdk-20261002.6mCDim/sdk-verify.log`）；没有安装组件或使用宿主 SDK 掩盖该结果。原生 clippy 未执行，不记通过。

检查敏感性在实现之后核验：只在 Data 的字节精确单文件源码快照临时反转原 codec 的 pack guard，执行原 `validate_rejects_malformed_pack_key`，实际 `1 failed`、退出 101。通过 apply_patch 还原快照后与工作树 SHA 同为 `07ec6e79f918991763fd96d4b23a71e87af59d5aae3aac67ba7d86feb1d05692`；同一既有检查 `1 passed`、退出 0。随后缺保留证据执行关闭的最终 native validator 复跑原 deletion crate，实际 17 passed/9 ignored，容器终态 0。实际限额为 4 CPU、6 GiB、swap 0；日志在 `codex-tenant-delete-parser-mutation-20261002.Y4ZqWK/{mutated.log,restored-and-final-native.log}`。工作树始终未放入破坏版本，未创建新检查、夹具、Tenant、meter 或 Customer。

本批未执行真实 S3/数据库删除、取消竞态、provider 失联、保留统计正向读回或 Core 合流业务验收；这些原有单元检查没有覆盖新增 CAS producer 的实际对象归因。Core 本刀编译、批末完整门禁、发布镜像对应性、提交/push/部署由主代理分别收口，不能以本节结果替代。公开删除 exposure 为 `none`、routes/actions/workflow_kinds 仍为空，不能宣称 Stage 3、`SS-BUZ-COMMUNITY-DELETE` 或生产就绪完成。

## 独立候选的实际消费闭合（2026-10-02 UTC）

本节只记录上述已写实现的交付整合，不增加功能或覆盖前文历史结果。候选基线为 `e4c544fdb63d5e54fe775d58e684249166c89543`，实际目录为 `/volumes/data/kailo/tmp/codex-delete-commit-candidate-20261002.KBSv5P`。源码由原 Git 的私有 index/object 隔离选择；不是另建仓库，不覆盖正式工作树，也不把整个脏工作树纳入本刀。

实际必需的消费链已经接入候选：原生冻结保留统计 → Core 同一快照与子流程 → Worker 既有 `TENANT_LIFECYCLE/DELETE` 分支及 `snapshotId` → 原私有 `AdvanceTenantDelete` Activity。新增四项删除证据枚举及对应 TypeScript 文案、Advance 请求/结果与子流程封闭枚举由 `contracts/` 同源生成，未手写四侧类型。并行的 AgentDefinition 消费同一 Resource 和 owner/version 事实；必要的 `ResourceState`、定义 query 与 ActionCommand 字段进入同一候选，不引入 AgentVersion、运行或第二份注册权威。

Customer 逻辑退役依赖真实 OpenMeter 客户端，候选部署从唯一 `.env` 投递其四个必填输入、受控 token 及 `RELAY_OPERATOR_COMMIT_WINDOW_SECONDS`，没有默认地址、共享明文凭据、Quota 正向执行或 usage producer。候选只选择已有原生 API、PostgreSQL、Kafka、ClickHouse 配置；没有将 sink/Redis 去重的另一批增量混入。本地初始化的既有 Core 迁移调用同时改为受限检查镜像路径，不使用宿主 SQLx；本轮没有调用初始化或销毁当前开发环境。

### 真实失败与修正

- 第一次四侧生成及 `--check` 实际退出 0，但独立枚举未被对象 schema 引用，Core 随后实际报 `E0432: unresolved import contracts::PlatformSessionAccessMode`，退出 101。按 `.design/03` §2，只纳入既有 `contracts/api/session.schema.json` 的必填 `accessMode` 与 `$ref`，由原生成入口产生类型；BFF 初始化实际模式，未复制整份会话增量或开放受限展示行为。原始编译输出为 `/volumes/data/kailo/tmp/codex-delete-core-validation-20261002.S93Atr/validation-preserved-env.log`。
- Worker 首次窄验证实际报 `workflows/component_task.go:275:39: undefined: generated.Failed`，退出 1。生成后的 ResourceState 与 TaskStatus 含同名 `FAILED`，原生成器为 TaskStatus 产生 `TaskStatusFAILED`。已机械同步唯一生产消费和四处既有测试断言，线格式仍为 `"FAILED"`；没有新增测试、历史或夹具。原件为 `/volumes/data/kailo/tmp/codex-delete-candidate-worker-20261002.faLez0/{go-verify,exit}.log`。
- Session 字段闭合后的 Core 窄编译仍实际报两个 `E0599`：Customer-only 的 `tenant_lifecycle::metering_error` 消费 `BindingNotActive` 与 `RateLimited`，候选 e4 契约缺两值，退出 101。只纳入这两项既有 reason code 与原文案，不纳入 `QuotaExhausted`、`PayloadTooLarge` 或 Quota 实现。该次原件为上述 `S93Atr/validation-session-contract-closed.log`；生成成功不能替代后续 Core 编译结论。
- 部署验证首次 SDK 投递因候选只读根没有 `.env` 挂载点，实际退出 1、容器码 128，产品命令未运行；原件为 `/volumes/data/kailo/tmp/codex-delete-candidate-deploy-20261002.EWfVJh/`。改为原文件只读投递后校验成功。另一次 Compose 解析实际退出 1，暴露候选选择时字符串替换错误地折叠原生 `$$` 转义，以及候选相对秘密路径未投递；保持原生字节重新选择、使用真实本地配置只读解析后退出 0，没有修改健康检查语义或启动服务。失败与还原分别保留在 `/volumes/data/kailo/tmp/codex-delete-candidate-deploy-20261002.Z0sONg/{compose-config,compose-config-restored-escaping}.log`。

### 已实际通过的窄验证

检查镜像固定为 `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，SDK 为 UID/GID 1000、缓存位于 `/volumes/data/kailo/check-cache`；启动前保存进程及 CPU/内存压力，并回读实际容器限额。没有使用宿主 Cargo、Go、Node。

- 原 `bash tools/gen.sh` 与 `bash tools/gen.sh --check` 在 Session 字段闭合后实际退出 0，Rust、Go、TypeScript、Dart 四侧同步，Mobile catalog 同步。日志为 `/volumes/data/kailo/tmp/codex-delete-candidate-final-gen-20261002.gbGlPy/{preflight,limits,generate,exit}.log`，实际 2 CPU、4 GiB、无额外 swap。最初成功但尚缺对象引用的记录 `/volumes/data/kailo/tmp/codex-delete-candidate-gen-20261002.5ZwRPk/` 保留，不能以该次生成成功证明 Core 可编译。
- Session 闭合后的 Worker `gofmt -l` 的五个实际输入均无输出，`go vet ./activities ./workflows ./replay-tests`、`go test ./workflows ./replay-tests` 实际退出 0，workflows 与既有 replay 均 `ok`。日志为 `/volumes/data/kailo/tmp/codex-delete-candidate-worker-final-20261002.n9kk40/{preflight,limits,go-verify,exit}.log`，实际 4 CPU、6 GiB、无额外 swap。此结果先于 Customer 两项 reason code 纳入，不能作为后续生成字节重新验证的结果。未新录 DELETE history，不将现有重放成功当作新删除场景验收。
- 原部署脚本语法与 `bootstrap.sh --validate-config` 实际退出 0，日志为上述 `Z0sONg/{preflight,limits,validate,exit}.log`，实际 1 CPU、512 MiB、无额外 swap。原 `docker compose config --no-env-resolution --quiet` 使用真实本地 `.env` 与原 project-directory 只读解析候选 YAML，实际退出 0，日志为 `compose-config-restored-escaping.log`。未执行 OpenMeter 原生 `--validate`、`init-local.sh`、服务 up 或数据库清理。

Customer 两项 reason code 纳入后，同一原生成入口再次实际完成 `gen → --check`，四侧及 Mobile catalog 全部同步，attach 与容器终态均为 0；原件为 `/volumes/data/kailo/tmp/codex-delete-candidate-reasons-gen-20261002.1ReYtS/{preflight,limits,generate,exit}.log`。仍为上述不可变 SDK、UID/GID 1000、实际 2 CPU/4 GiB、无额外 swap。本次没有重新跑 Worker 或完整契约门禁，不把此前的窄验证重复登记为新结果。

本节记录时，候选完整 Core 编译、独立迁移与 SQLx 验证尚无本节的通过结论，四侧 round-trip、历史兼容、批末完整门禁和最终发布产物须分别读取主代理本批真实结果。证据文档写入不改变生成输入；最终合并的 Rust/Go/TypeScript/Dart 类型、Worker 和原生 codec/lock 是各自发布产物的真实输入，不能借用早期 UI 或 Relay 产物的来源摘要冒充本候选产物。

本轮未做真实 DELETE 正向、共享 CAS 对象归因读回、四类 provider 合流、不可逆取消或故障恢复业务验收，未创建业务对象；公开删除入口仍关闭。本候选未提交、push 或部署，编译/生成/现有检查通过不等于 `SS-BUZ-COMMUNITY-DELETE`、Stage 3 或一期生产就绪完成。

### 后续精确候选的 Core 与独立数据库结果

上述“记录时尚无结论”保留原时点事实；随后同一 `KBSv5P` 候选、上述最终生成字节的原检查已经实际完成。`SQLX_OFFLINE=true cargo clippy --offline --manifest-path core/Cargo.toml --workspace --all-targets -- -D warnings` 退出 0；原件为 `/volumes/data/kailo/tmp/codex-delete-core-validation-20261002.S93Atr/clippy-closed-contract.log`，SDK UID/GID 1000、实际 4 CPU/8 GiB、无额外 swap，Cargo 16 jobs 未下调。

同批精确归属的一次性全新 PostgreSQL 实际应用 37 条迁移，最后为 `20261002010000_agent_definition`，回退该条再前进退出 0。原生 `cargo sqlx prepare --workspace` 退出 0，随后原 `step_migrate` 的配对、前进/回退/再前进、离线 SQLx 同步与 40 个命名约束逐值比对均 PASS，`EXISTING_STEP_MIGRATE_FAIL=0`，没有 migrate SKIP。原件为同目录 `migration-sqlx-closed-contract.log`；SDK 实际 8 CPU/16 GiB、临时 PG 1 CPU/1 GiB、均无额外 swap，未连接业务库。Tenant、Resource、AgentDefinition 行数均实查为 0，没有新增业务样例。

原 CLI 只淘汰 12 条本候选查询不再使用的 SQLx metadata，保留 83 条，无新增或修改 query 文件；精确删除清单为同目录 `sqlx-real-delta.txt`。没有复制正式工作树的删除清单或手改查询摘要。SDK 和本次临时 PG 已清理，原日志记录二者 `cleanup absent`；Data 候选、派生缓存和证据日志仍保留。此前第一次 `validation.log` 退出 1 是环境未完整投递造成临时 PG 未 ready，SDK 尚未启动，失败没有改记为通过。

此处 37 条仅对应精确候选，不覆盖前文工作树历史的 39 条。Core 编译/迁移/SQLx 通过仍不代表真实 DELETE、CAS 对象归因、四 provider、完整门禁、正式产物或部署通过；删除 gate 与未验收业务边界保持不变。下一次机械合并共享 UI 也不能自动继承为最终产物的来源验收。

## 冻结 HUMAN owner 的生命周期资格消费修正（2026-10-02 UTC）

实现后按已提交设计复核发现两个实际缺口：`bff::lifecycle_identity` 仅接受 Tenant `manage`，冻结的非管理员 HUMAN owner 因而在审批入口前被拒绝；`governance_api::eligible` 又只检查角色，单修会话仍无法让该 owner 查询本人相关审批。这与 `.design/03` §2、`DD-96(5)` 和 `.design/05` 的 `tenant.delete` 角色票 AND `ALL_AFFECTED_OWNERS` 不符。前文仅管理员的实现描述保留其历史时点，不作为当前实现结论。

本刀仅修改 `core/crates/platform-core/src/bff.rs`、`governance_api.rs` 和本记录。两个真实消费者复用同一内部 `lifecycle_owner_eligible`：在既有 Tenant 与 membership 锁内要求当前 ACTIVE HUMAN 成员，读取同 Tenant、同 `tenant.delete` ActionExecution、匹配当前暂停/删除阶段与 Tenant 版本的既有不可变 snapshot；只取该 principal 的非空 `AffectedOwnerRef`，再复用原 `agent_definition::validate_frozen_owners` 检查当前 Resource、版本、owner 和 FullyConsistent 权限投影。审批可见性还限定为该行的 ActionExecution，不用另一个 snapshot 的 owner 身份放行。

受限会话的角色可见性改为 FullyConsistent，不能用旧管理员投影看见无关生命周期审批；普通 FULL 列表仍采用原低延迟一致性。决定继续经过原 FreshApprovalAdmission，未替换角色计票、自批策略或 Worker 的 owner AND 规则。空清单不产生 owner 身份，但不改变零 Resource 的 ALL 集合与必需管理员角色票规则。缺失成员、snapshot、Resource 版本或 owner 投影拒绝；SQL/投影不可用传播不可用，不当作授权，也不改审批终态。未增加 public route、接口、配置、契约、SQLx 宏或另一份 owner 权威。

编辑前完整原生证据位于 `/volumes/data/kailo/tmp/`：`codex-lifecycle-owner-preimpact-20261002.n8Zaqr.raw.jsonl` 保存当前 `apps-source` schema 4、HEAD `8ec78ed43e4a3e1fdc3f3243719cb7c1673eded6`、`incompleteReasons=[]` 及三个精确目标的 context/impact；`lifecycle_identity` 为 HIGH/9，`eligible` LOW/2，原冻结校验 helper CRITICAL/9，已在编辑前告警，原 helper 未修改。`codex-lifecycle-owner-exact-pdg-20261002.1uNYua.raw.jsonl` 的宽 file controls 209 条只返回 200，不能当完整覆盖；`codex-lifecycle-owner-span-pdg-20261002.YbXzWn.raw.jsonl` 以原 `eligible` 的精确行区间补齐 CDG 26/26、REACHING_DEF 24/24。新 helper 与跨语言隐式流不由编辑前图证明，本刀未启动图谱 writer。

字节精确 before 位于 `/volumes/data/kailo/tmp/codex-lifecycle-owner-before-20261002.nI7XVJ/{wt,candidate}/`。同目录保存 `wt-bff.rs.window.diff`、`candidate-bff.rs.window.diff`、`wt-governance_api.rs.window.diff`、`candidate-governance_api.rs.window.diff` 与 `owner-source-after.sha256`。候选只合入本人窗口，逐文件新增/删除字节与正式工作树窗口一致，未整体复制含其他增量的 BFF。

### 本刀实际验证与边界

固定 SDK 为 `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，UID/GID 1000，实际 4 CPU、6 GiB、swap 0；启动前回读进程及压力，容器内回读 cgroup。正式两源 `rustfmt --edition 2021` 与 `--check` 实际退出 0，日志为 `/volumes/data/kailo/tmp/codex-lifecycle-owner-format-20261002.B3c8Rd/format.log`。

首次候选窄 clippy 实际 SDK 101、外层 1，原因是独立 CargoHome 未投递原 registry，离线解析缺 `serde_json`，尚未进入源码编译；`OOMKilled=false`，原件为 `/volumes/data/kailo/tmp/codex-lifecycle-owner-clippy-20261002.X5x0ut/clippy.log`，未把该次失败删除或记通过。投递既有 `/volumes/data/kailo/check-cache` 的 registry/git 只读缓存后，同一候选源码执行：

```bash
rustfmt --edition 2021 --check core/crates/platform-core/src/bff.rs core/crates/platform-core/src/governance_api.rs
SQLX_OFFLINE=true cargo clippy --manifest-path core/Cargo.toml -p platform-core --all-targets --locked --offline -- -D warnings
```

该次 attach、容器与外层实际均退出 0，`OOMKilled=false`；Cargo 16 jobs 未下调，独占此前候选的 `S93Atr/rust-target`，未并发写他人 target。原件为 `/volumes/data/kailo/tmp/codex-lifecycle-owner-clippy-final-20261002.RsS54W/clippy.log`。两个 SDK 均已清理，Data 缓存及证据保留。

本刀未创建业务数据、测试、夹具或检查脚本；未重跑迁移、SQLx prepare、四侧生成或完整门禁，未实际运行非管理员 owner 正向审批、撤权并发或故障恢复。窄编译不证明新动态 SQL 的运行期行为，也不继承为正式工作树全部增量已验收。公开删除入口仍关闭，本刀尚未提交、push 或部署；最终图谱、完整门禁和新 Core 产物由主代理统一收口。
