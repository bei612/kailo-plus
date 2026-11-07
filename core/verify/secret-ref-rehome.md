# DD-85 遗留身份 SecretRef 归位核验

2026-09-27 起开发；2026-09-28 补齐复制后被拒的收敛并开放为 `tenant_admin`，见文末“复制后被拒与开放”。

## 归位发起者的 Tenant 归属闭合（2026-09-27）

`.design/03` §2 规定 Principal 只属于一个 Tenant，§9 的归位动作要求该业务
Tenant 的管理员发起。`actor_still_authorized` 原查询仅按 Principal ID 联接
`TenantMembership`，没有把 Principal 和 membership 的 Tenant 与
`ActionExecution.tenant_id` 等值关联；`ActionExecution` 对 Principal 只有单列
外键，因此历史或错误写入的跨 Tenant 动作能通过这道本地 ACTIVE 门禁，再进入
SpiceDB fresh Check。现已在原查询补齐两个等值条件，未新增身份模型、路由、契约
或迁移。写前不匹配时，`INTENT` 在任何 OpenBao 写入前确定拒绝；切换前不匹配时
保持 `COPIED`，不切 binding。这只是本地资格收紧，不宣称已闭合撤权后
`COPIED` 的用户 reason code 与运维收敛合同。

GitNexus 对 `actor_still_authorized` 的编辑前影响判定为 HIGH：直接调用方是
`copy_once` 与 `cutover`，间接到 `advance_inner`/`advance`；已按源码逐个核对。
在真实 PostgreSQL 上，事务内制造两个 ACTIVE Tenant、源 Tenant 的 ACTIVE
HUMAN Principal/membership 与指向另一 Tenant 的 ActionExecution：同一生产 SQL
对跨 Tenant 返回空、改回同 Tenant 返回原 Principal，事务结束回滚。受
16 GiB/500% cgroup 约束的定向 `cargo test -p kailo-core
rehome_initiator_must_belong_to_action_tenant -- --nocapture` 为 1/1 通过；故意移除
两项等值条件后同一检查退出 101，实际返回了跨 Tenant Principal；恢复后再次
1/1 通过。`./tools/check.sh --full` 在相同 cgroup 上十组退出 0：四侧测试、
契约兼容、Workflow replay、追溯、供应链、上游接缝和安全检查均通过；本次未
提供隔离 `DATABASE_URL`，第 4 组实际迁移前进/回退为 SKIP，仅配对脚本检查
通过。该核验只闭合发起者本地 Tenant 前置判定，不代替归位的响应丢失、撤权、
旧消费者和 destroy 故障链验收。

## 权威与影响面

`.design/02` 的 `DD-85`、`.design/03` §9 和 `.design/06` 的
`SECRET_REF_REHOME` 决定同一 pubkey、写前意图、目标 KV v2 首次写入、
读回、binding CAS、旧 generation 终态与旧版本 destroy 的顺序。
`apps/02` §4 将其归 Stage 2，`V-SCN-69` 是验收场景。
此刀触及 `ActionCommand`、`ActionExecution`、`WorkflowRef`、
`SecretRefRehome`、`BuzzIdentityBinding`、Worker input、共享 Web/Desktop 管理页、
OpenBao policy 与运维告警。Mobile 不提供归位写入口；协作面公钥和 Relay roster
不变。新字段与新表是添加式；旧客户端能忽略新命令字段，但旧 Core/Worker
不认识新 action/workflow kind，所以必须先升级兼容 schema，再启用动作入口。

GitNexus 对新增契约类型的 impact 为 `UNKNOWN`（索引里尚无符号），已用全仓检索
确认它只由新增 BFF 路由与生成物取用；`RoleManagement` 为 LOW，直接上游是
`WorkspaceMembersPage`；`platformMessages` 为 UNKNOWN，源码检索确认
`useT` 和 Dart 文案生成器读取它。对账器 `pass` 为 LOW，调用方是 `spawn` 与 Core
`main`；其配置结构的图风险为 UNKNOWN，源码检索确认仅由 Core `main` 装载。

## 已取得的证据

- `tools/gen.sh` 在 8 GiB/400% cgroup 下退出 0，Rust/Go/TypeScript/Dart
  契约与 Dart 文案重新生成。
- `cargo check -p kailo-core --all-targets` 在 8 GiB/400% cgroup 下退出 0。
- `pnpm --dir web/packages/platform test` 在 8 GiB/400% cgroup 下退出 0：
  6 个文件、59 个用例通过；新增用例核验无权时隐藏入口、读取失败不渲染空列表、
  显式确认、结果不明后重试复用同一幂等键。
- 隔离库 `kailo_rehome_verify_20260927` 由空库运行全部迁移，
  `20260927100000` 前进、回退、再前进均成功；隔离库演练时未修改业务 Core
  数据库，后续真实拓扑联调前已在业务库执行该迁移并完成备份。
- `tools/check-docs.sh` 七组通过。带隔离库 `DATABASE_URL` 的
  `tools/check.sh --full` 中，Rust/Go/TypeScript/Dart 静态检查与测试、
  四侧契约同步与兼容、迁移三步及 34 个枚举约束、Workflow replay、供应链、
  安全与文档检查均通过；第 8 组 seam diff 失败，因为共享契约和文案变化使
  Buzz Web/Desktop/Mobile 的 `vendor_files` 摘要与旧发布产物不一致。
- 固定 Buzz Web 基线重建并推入本地 registry。真实浏览器首次走查发现
  `WorkspaceMembersPage` 虽有归位面板，Buzz Web 实际使用的 `PlatformApp`
  成员页却未挂载；在现有 `0007-role-management.patch` 补上挂载点后重建，
  镜像 digest 为
  `sha256:7b93920fd8ecd206e9f53bfd0a69ee86ff2072a82a36579276b1292e3d1a1bf5`。
  本地 Web 容器按该 digest 重建且达到 healthy。Buzz Mobile 从固定基线仅
  重建源树并核对四份 vendor 文件，清单仍明确 `artifact_digest: none`。
  Desktop 首次安装包重建在系统盘余量降至 19 GiB 时主动取消，清单未写入未取得的
  产物；随后发现共享 TS 文件末尾空格，先修正并确认 `git diff --check` 退出 0，
  再在 16 GiB/4 CPU 的受限 BuildKit 与 2 GiB/1 CPU 外层 cgroup 下重建。
  `Buzz_0.5.23_amd64.deb` 已产出，独立 `sha256sum` 与清单同为
  `sha256:c0737422c47b5fd1266d9bec1b60b57c08558cca89d8c21bbecc7cddc69f7d73`；
  此证据只证明当前共享源码的 Linux 包可构建，未做原生会话验收。
- 本地 Core DB 的只读聚合显示 4 条历史 `verify.provision` 动作均为
  `ALLOWED / NOT_DISPATCHED`，但关联 WorkflowRef=`TERMINAL`、
  TaskProjection=`COMPLETED`。原 `consumer_terminal` 先要求 `DISPATCHED`，
  因此即使 Temporal 已关闭也会让旧版本永远停在 `SWITCHED`。已改为：
  以 `ActionExecution.id` 关联全部 WorkflowRef，以匹配的 WorkflowRef 和
  Temporal 关闭事实判终态；没有 WorkflowRef 时才按门禁与派发终态判断。
  切换清单同样通过 `action_execution_id` 关联 WorkflowRef，不依赖可空的
  `ActionExecution.temporal_workflow_id`。初次真实运行在 `COPIED` 遇到
  `syntax error at or near ")"`，只读 `PREPARE` 证实切换查询多一个右括号；
  修正后重新构建。修正前的 `cargo fmt --check`、受 8 GiB/400% cgroup 限制的
  `cargo check -p kailo-core --all-targets`、受 6 GiB/300% 限制的
  `cargo check -p kailo-core --test secret_ref_rehome` 均退出 0；最终源码由下述
  release 构建与真实测试另行验证。
- Core 在受限 BuildKit（16 GiB/4 CPU，状态卷位于 `/volumes/data`）与
  2 GiB/1 CPU 外层 cgroup 下重新构建，镜像 manifest 为
  `sha256:078eb869b3b2b3fc59c1bbbd2639050909d26c5b6e7592c8af163a28647b065f`；
  `start-core.sh` 重投一次性 OpenBao 凭据，BFF `/healthz` 为 HTTP 200。
  原先停在 `COPIED` 的固定 Workflow 不经重发自动收敛到 `RETIRED`：
  `old_ref_status=REVOKED`、`new_ref_status=ACTIVE`、冻结 4 个旧消费者，
  WorkflowRef=`TERMINAL`、TaskProjection=`COMPLETED`，binding 的 pubkey 未变、
  locator 已指向目标且 generation 增 1。OpenBao 旧 KV v2 metadata 按原版本
  回读 `destroyed=true`；只读取 metadata，未输出私钥。
- 受 12 GiB/400% cgroup 限制运行
  `cargo test --manifest-path core/Cargo.toml -p kailo-core --test secret_ref_rehome -- --nocapture`，
  退出码 0，1/1 通过（用例耗时 17.04 秒）。独立夹具验证普通成员不可枚举、
  显式确认缺失返回 422、同幂等键不新增 ActionExecution、同 pubkey、
  目标 Tenant namespace、KV v2 版本 1、旧版已销毁。
- 受 16 GiB/500% cgroup 限制、内部 Core 构建使用受限 BuildKit，运行
  `core/verify/web-walkthrough.sh /volumes/data/kailo-web-rehome-final-20260927-1`
  退出码 0；真实浏览器在成员页取得归位面板的空列表证据，原有登录、消息、
  审批、任务、邀请、注销走查仍通过。证据目录中的 `summary.json`、
  `08-members.png`、`sessions.txt`、`approvals.txt` 与 `fixture.log` 可复核；
  夹具已拆除。空列表只证明 Web 挂载与读取，不证明业务遗留引用迁移完成。
- 修正后在隔离库 `kailo_rehome_verify_20260927` 上运行受 16 GiB/500% cgroup
  限制的 `./tools/check.sh --full`，十组全部通过：四侧测试、生成物与
  78 个 schema 兼容、迁移前进/回退/再前进、Workflow replay、追溯、
  12 个产物的供应链摘要、六份上游接缝清单与安全检查均通过。

## 尚不能宣称的结果

上述成功链不等于 `V-SCN-69` 全部闭合：写入响应丢失、并发重入、撤权中断、
旧消费者未终态、旧版本 destroy 响应不明及超时运维告警尚无真实故障证据；
Worker/Mobile 没有本轮新发布产物 digest；Desktop 已有新 `.deb` 摘要但未做
原生会话验收；Web 浏览器验收及全量门禁已通过，归位动作的真实故障分支仍未完成。
旧 `platform/kv` 中业务 Tenant 的活跃 HUMAN/CONTROL 引用保持原样；
失败的两个独立测试 Tenant 与本轮成功测试留下的 OpenBao 子 namespace
仍需按 `secret-ref.md` 的离线夹具纪律精确清理，不能在 Core 持有 service token
期间在线删除。

## 本地历史夹具告警归属

2026-09-27 04:19 UTC，运行中 Core 的最近 30 秒日志有 24 条「派发未完成」；
按库中 `ALLOWED / NOT_DISPATCHED` 动作聚合，三组测试 Tenant 各有 4 条
`verify.provision`。抽查的动作属于 `vd0be7919`，其 WorkflowRef 为
`TERMINAL`，而 `catalog.action_definition` 已无 `verify.provision` 定义。
`Governance::drive` 对该状态重试派发，定义查无行后记录告警。这是此前中断的
测试夹具残留，不是本次 `identity.secret_ref.rehome` 的执行失败。三个测试 Tenant
与现存的测试子 namespace 必须在浏览器走查结束后分别确认精确归属与终态，
再按 `secret-ref.md` 的停 Core、离线清理、重新投递凭据顺序收敛；
不能在持有子 namespace service token 的 Core 运行时在线删除。

## 发布暴露边界复核（2026-09-27）

`tools/traceability/identity.secret_ref_rehome.yaml` 当前登记
`status: in_progress` 与 `exposure: none`；`tools/gen-registry.py`
在构建前以 `--check` 比对入库的 `tools/registry/capabilities.yaml`；
Core 将该注册表编入镜像，BFF 仅挂载 exposure 为 `tenant_admin` 或
`end_user` 的用户路由，Governance 在读取幂等键与数据库之前按同一份
注册表拒绝未开放的 Action。迁移中的 `ACTIVE` ActionDefinition 不能
越过此门；归位的 service API 只供已在途 Workflow 收敛。共享 Web
成员页虽挂载归位面板，但收到 BFF 的 403/404 后不渲染入口。当前
`exposure: none` 因而关闭新用户请求；它不撤销已发生的归位，也不
代替归位故障链的 `V-SCN-69` 验收。该结论只对应本次源码与构建产物，
不推断已部署的旧 Core/Web 具有同一门禁。

复核时先发现 Core Docker 构建上下文未带生成注册表；修正构建上下文、
工作目录及运行层二进制路径后，受限 BuildKit 内的 `core-bff` 发布镜像
构建退出 0，manifest digest 为
`sha256:bc61baf724fb87489b0d5c0fb7742faf3edd72a5c9f4ae2b8653be5a908101a7`。
随后检查到追溯记录仍指向旧 Desktop 安装包，按新包的
`sha256:8e14dcedcd80dacbcd23d2e990bd59f97db72ac90cffd4581c13f3fb1638e33c`
修正，`check.sh trace` 退出 0。故意改变归位追溯记录的 exposure，
`gen-registry.py --check` 退出 1 并报注册表漂移；恢复后退出 0。
Core 单元检查确认生成注册表对归位路由和动作均返回未开放；
集成检查写有列表 404 与动作 403 `CAPABILITY_BLOCKED` 的断言，
但本轮全量门禁未提供集成环境，不能算该 HTTP 路径已执行。
Web 回归检查确认 403/404 不呈现管理面板。
最终 `./tools/check.sh --full` 在 16 GiB/500% cgroup 内十组退出 0；
本轮未提供隔离 `DATABASE_URL`，实际迁移前进/回退为 SKIP，配对脚本
检查通过。随后在仅用于本项目的 `kailo-local` Docker Compose 中重建
Core，运行镜像 ID 为
`sha256:d5ea7a37fba389321d26e819cdde8035a4315153bc3579bd860dc70537cba780`；
BFF `/healthz` 返回 200。使用已有本地测试身份，`/api/v1/session`
返回 200，未开放的 SecretRef 列表返回 404，归位 Action 返回 403
与 `CAPABILITY_BLOCKED`；同一幂等键在 `admission.action_execution`
中的记录数为 0。Web 静态容器也已切换到固定摘要
`sha256:96b423034be8a238fcd244d2a54f7ca5325e273e5c7571164294eb866582c109`
且保持 healthy。以上是本地在线拒绝链证据，不是浏览器页面验收，
也不覆盖 `V-SCN-69` 的故障分支或生产发布验收。

## 未开放入口的真实浏览器复验与夹具收敛（2026-09-27）

权威为 DD-85、V-SCN-69 与能力注册表中
`identity.secret_ref_rehome: exposure: none`；本次只改现有 Web 走查的
预期和异常退出清理，不改产品 API、schema、Workflow 或客户端产物。
GitNexus 对两个走查脚本文件均返回 `UNKNOWN`，全仓文本检索确认浏览器
脚本由 `web-walkthrough.sh` 唯一调用。旧走查仍要求未发布的归位面板
出现，会把 BFF 404、Web 隐藏入口的正确行为判为失败；现要求浏览器
实际收到列表 404 且面板不可见。脚本中途停止本地 Core 或 Relay 后失败
时，shell 收尾先恢复二者及 Worker，再关闭夹具 stdin 并等待拆除结果；
Core 只经 `start-core.sh` 重新投递一次性凭据，不直接 `docker start`。

在固定 Web 镜像
`sha256:96b423034be8a238fcd244d2a54f7ca5325e273e5c7571164294eb866582c109`
上，受 16 GiB/500% cgroup 和独立受限 BuildKit 约束的完整浏览器走查
退出 0：`summary.json` 有 20 个计时场景、30 条记录，未开放列表的
GET 404 出现两次，意外 origin 与 CSP 违规均为 0；登录、消息、
BFF/Relay 故障恢复、成员、审计、审批、任务取消/重跑、邀请、注销均通过。
注销前会话为 `REVOKED`，夹具预置审批分别为 `CANCELLED` 与
`CONSUMED`。证据在
`/volumes/data/kailo-web-exposure-bjop5u/summary.json`、`08-members.png`
和 `fixture.log`。故障注入期间的 503、受拒动作的 403/409/422 仍
只按各自原因解释，不算服务一直健康。

脚本退出后 Core/Relay/Worker/Web 均运行，BFF `/healthz` 为 200；
`fixture.log` 显示 Workspace 已拆除，夹具清理断言确认 Tenant 不在
Core 数据库。只读核对发现该测试 Tenant 的 OpenBao 子 namespace 仍在；
为避免持有其 service token 的 Core 在线续期失败，先停止本地 Compose
Core，再核对该 Tenant 在 `identity.tenant`、`identity.principal`、
`identity.buzz_identity_binding`、`admission.secret_ref_rehome` 均为 0，
`bao namespace lookup` 精确指向本次测试 UUID，才删除这一个子 namespace。
删除请求获确认，后续 `namespace list` 已无此项；其他 13 项未动。
该测试 namespace 中的密钥不可恢复。Core 经 `start-core.sh` 在
16 GiB/500% cgroup 与受限 BuildKit 内重建并重投一次性凭据，运行
镜像 ID 为
`sha256:3939194b6bb145f5a8371b42564183d4aaf04950b104b4fc4166aa88a3eb6462`，
BFF `/healthz` 返回 200。浏览器夹具的 OpenBao namespace 仍需离线
人工清理；本次不把手工收敛说成夹具已自动收敛。

共享 Web 包 6 个文件、59 个用例通过。为验证隐藏入口检查确实能报错，
曾临时把该用例的 404 改成 200 空列表，同一检查退出 1，明确报告
未开放管理面板被渲染；恢复后 59/59 通过，临时改动未提交。
这些证据闭合最新 Web 镜像的未开放入口观察，不覆盖归位真实写入的
响应丢失、撤权、旧消费者与销毁结果不明故障分支，也不代替原生端验收。

## 旧版本销毁前的 audit 再检查（2026-09-27 07:00 UTC）

`SWITCHED` 与 `RETIRED` 由 Temporal 的不同轮次推进。原实现只在
`COPIED → SWITCHED` 调用 `audit_gate`，却在后续 `retire` 的
OpenBao KV v2 `destroy` 前直接使用先前结果；审计设备在两轮之间
被移除时，永久销毁会缺少当前 audit 前置。现将现有
`service_api::audit_gate` 放在 `retire` 的 `!destroyed` 分支中、
紧邻 `destroy_legacy_identity_version` 之前；读不到 audit 清单或
清单为空时返回 503，状态仍为 `SWITCHED`，旧版本不由该调用销毁，
同一 Workflow 后续继续对账。已经由 metadata 证明 destroyed 的版本
不再发起 destroy，也不因当前 audit 故障伪造新副作用。

编辑前 GitNexus 对 `retire` 判 LOW（直接调用方 `advance_inner`），
对被复用的 `audit_gate` 判 CRITICAL（其余身份/roster 路径也调用）；
共用函数只修改注释与日志措辞，未改判定语义。编译前复核本机无正在
运行的 Cargo build，内存 available 约 24 GiB、CPU pressure avg10
0.51、memory pressure avg10 0.08；在 8 GiB/400% cgroup 内运行
`cargo check -p kailo-core --all-targets` 退出 0，`cargo fmt --all
--check` 退出 0。随后在 16 GiB/500% cgroup 内运行
`./tools/check.sh --full`，十组退出 0；第 4 组未提供隔离
`DATABASE_URL`，实际迁移前进/回退为 SKIP。此证据证明源码顺序与
回归门禁，不等于已通过「审计设备失效时拒绝永久销毁」的真实故障演练；
后者仍属 `V-SCN-69` 收口项。

## 本地遗留引用来源复核（2026-09-27 06:53 UTC）

只读 Core DB 聚合显示：全部 ACTIVE、SERVER、`platform/` 的
`BuzzIdentityBinding` 共 3 条，分布在 `vd0be7919` 与 `v6b41a84f`
两个 Tenant。前者为 CONTROL 1 条、HUMAN 1 条；后者为 HUMAN 1 条。
两个 Tenant 各有 4 条 `verify.provision` ActionExecution、4 条
WorkflowRef、0 条 SecretRefRehome；各只有 1 个 `verify-*` 外部身份，
没有非 `verify-*` 外部身份。源码中的
`tests/common/mod.rs::provision_live_workspace_for` 使用
`v` 加 Tenant UUID 前 8 位生成 slug，并使用 `verify-*` subject。
这些相互独立的标记将两组旧引用归于本地集成夹具，不作为生产业务
Tenant 的迁移需求或成功证据。查询仅输出 slug、kind 与聚合计数，
没有读取或打印私钥及 SecretRef locator。

仍不得仅凭上述归属在线删除 Tenant 或 OpenBao namespace：夹具的
Workflow、Buzz binding 与 Core 持有的子 namespace service token
需要按 `secret-ref.md` 的停 Core、精确目标核验、离线清理、重新投递
凭据顺序收敛。归位能力自身的 `V-SCN-69` 故障分支和发布闸门仍未闭合。

## 退役前 binding 再核验（2026-09-27）

`DD-85` 的旧消费者终态清单只能证明切换时冻结的旧 generation 已关闭；
`SWITCHED` 到永久 destroy 是另一轮 Temporal Activity。原 `retire` 在销毁
前没有读取当前 `BuzzIdentityBinding`，因此当前 binding 若已不再指向
切换后的目标 ref，就不能据旧的冻结事实销毁源 KV 版本。现于原退役
路径增加当前 locator、目标 KV 版本、audience 和最小切换 generation
核验；不符或读不到时保持 `SWITCHED` 并返回 503，旧版本不由该调用
销毁。后续撤权或身份投影只推进 state/generation，不改写 locator，
因此 generation 继续增长时仍允许退役；源码检索中的 locator 写入
只有 `secret_ref_rehome::cutover`。这项检查不持有数据库行锁跨越
OpenBao 网络调用：当前 OpenBao HTTP 客户端没有请求超时，跨网络持锁
会引入无界阻塞。新增其他 locator 写入路径时，必须重新审查此并发
不变式，不能直接复用本次核验结论。

编辑前 GitNexus 对 `retire` 的影响判定为 LOW，直接调用方为
`advance_inner`，上游 API 为 `advance`。受 8 GiB/400% cgroup 限制的
定向测试通过 1/1；故意去掉 locator 相等条件后同一测试退出 101，
恢复后在 16 GiB/500% cgroup 内执行 `./tools/check.sh --full` 十组
退出 0，Rust/Go/TS/Dart、replay、契约及文档均通过。第 4 组的实际
迁移前进/回退因未提供隔离 `DATABASE_URL` 为 SKIP。此检查是退役
路径的额外 fail-closed 边界；尚未做「两轮之间真实改写 binding，
观察 OpenBao 旧版本未销毁」的故障演练，不能因此宣称 `V-SCN-69`
或发布暴露闸门已闭合。

随后新建独立空库 `kailo_rehome_guard_20260927` 做全量门禁。第一次
`check.sh --full` 退出 1：第 1 组先执行 SQLx 在线查询比对，空库尚未
迁移，故 SQLx、Clippy、Cargo test 失败；同轮第 4 组已把全部迁移
前进、回退、再前进并核对 34 个枚举约束。针对这同一临时库第二次
在 16 GiB/500% cgroup 内执行 `check.sh --full` 退出 0，十组全部
通过，SQLx 在线数据同步、实际迁移三步和 34 个约束均非 SKIP。
确认该临时库无连接后按确切库名删除，回读 `pg_database` 计数为 0；
业务库和旧 K8S 未触碰。临时库由迁移可重建，没有业务数据。

## OpenBao destroy 响应丢失的 metadata 判读（2026-09-27 07:32 UTC）

`.design/02` 的 `DD-85`、`.design/03` §9 与 `V-SCN-69` 要求永久
销毁结果不明时不能把 `SWITCHED` 伪报成 `RETIRED`；固定 OpenBao
`735723da5628148f232497a48a35a137b6512103` 的
`internal/builtin/logical/kv/path_destroy.go::pathDestroyWrite` 将目标
版本 metadata 的 `Destroyed` 置为 true。此次只在既有
`kailo-secrets` 测试模块追加丢失响应场景，复用原有 fake HTTP
fixture，不改运行时方法、契约、数据库、工作流、BFF 或三端。
GitNexus 对 `destroy_legacy_identity_version`、`version_destroyed`
均返回 UNKNOWN；全仓调用点检索确认该行为由 Core 的 `retire`
使用，不能将 UNKNOWN 当作无人调用。副作用边界是：传输错误只能
归入结果不明，后续从钉住版本 metadata 取确定证据；本测试不向
真实 OpenBao 发送请求，不产生可回收的外部数据，也不复制
SecretRef 权威。

fake 服务先回报 `destroyed=false`，接收一次 KV v2 destroy POST
后断开连接模拟响应丢失，下一次 metadata 回读为
`destroyed=true`。定向测试 `lost_destroy_response_can_be_resolved_by_metadata`
在 8 GiB/400% cgroup 内通过 1/1，明确断言客户端得到传输错误、
后续能读出已销毁状态，以及该测试只发出一次 POST。首次编译因
测试夹具用了本 crate 未启用的 `Uuid::new_v4` 失败；改用
`Uuid::nil` 后通过。再故意让 `version_destroyed` 忽略 metadata
而返回 false，同一测试退出 101；恢复源码、格式化后重跑通过。
在无并行 Cargo build、已检查 CPU/内存压力的前提下，受
16 GiB/500% cgroup 限制的 `./tools/check.sh --full` 十组退出 0；
四侧测试、Workflow replay、契约兼容、供应链与上游 seam 检查
均通过。第 4 组因未提供隔离 `DATABASE_URL`，实际迁移演练为
SKIP，配对回退脚本检查通过。

该 fixture 只证明 SecretStore API 在该故障形态下提供可判读
metadata；没有证明 Core `retire`、Temporal Activity 重试、
`SWITCHED → RETIRED` 投影或真实 OpenBao 的响应丢失闭环。
`V-SCN-69` 与发布暴露闸门仍未闭合，本开发工作树不能据此发布。

## 浏览器夹具的 OpenBao 子 namespace 收敛（2026-09-27）

`.design/03` §9 的 Tenant secret 隔离、`DD-85` 与本文件记录的在线
删除故障共同决定清理顺序：浏览器夹具拆除 Core/SpiceDB 记录后，
不能在 Core 仍持有该 Tenant 的 AppRole session 时删除子 namespace。
此前 `web-walkthrough.sh` 在退出时只恢复本地 Core/Relay/Worker 并等
夹具拆库，因此每次成功走查都留下一个 OpenBao 测试 namespace。
本次只修改现有浏览器走查脚本的退出路径，不新增产品 Tenant 删除入口、
数据库迁移、API、Workflow 或组件权威；GitNexus 对 shell 文件判
`UNKNOWN`，全仓检索确认浏览器脚本只由该 wrapper 调用，其他文档
只引用其命令。脚本从本次 `workspace.json` 解析规范 UUID，要求
`identity.tenant`、`identity.principal`、`identity.buzz_identity_binding`、
`admission.secret_ref_rehome` 的该 Tenant 行数均为零，并由 OpenBao
`namespace lookup` 核对精确父路径；随后只停止本地 Compose
`core-bff`，重复数据库和路径核验，才请求删除这个子 namespace。
父目录不再列出该 UUID 才算清理成立，Core 始终用 `start-core.sh`
重新投递一次性凭据。任何核验失败都拒绝删除并让走查失败；若已停
Core，仍尝试恢复。旧 K8S 和其他 namespace 均不在目标集合。

受 16 GiB/500% cgroup 与 16 GiB/5 CPU BuildKit 约束的真实浏览器
走查退出 0；证据目录为
`/volumes/data/kailo-web-namespace-53jLC7/`。`summary.json` 有
20 个计时场景、30 条记录、0 个意外 origin、0 个 CSP 违规；会话
`REVOKED`，夹具审批分别为 `CANCELLED` 与 `CONSUMED`。脚本报告
本次测试 Tenant 的子 namespace 已离线清理，之后又独立查询 Core
四张表均为 `0|0|0|0`、OpenBao 父目录不含该 UUID、BFF `/healthz`
为 HTTP 200，Core/Relay/Worker/Web 均在运行。反向验证以库中仍
存在的 ACTIVE Tenant 调用相同零引用门禁，结果为拒绝；这说明该
门禁不会把活跃 Tenant 误判成夹具垃圾。本次删除的仅是可重建的
测试子 namespace，其中测试密钥不可恢复；其他历史夹具残留不在
本次自动清理范围。该证据也不代替 `V-SCN-69` 的归位故障链。

## OpenBao 请求悬停的有界返回（2026-09-27 20:08 UTC）

`DD-48/85` 要求写入结果不明时由固定目标查证，不能盲写第二个版本。
原 `AppRoleSession::new` 使用没有请求时限的 `reqwest::Client::new()`；
OpenBao 接受请求但不结束响应时，Core 的归位 Activity 无法返回 503，
`COPY_UNKNOWN` 的下一轮观察也进不来。本次在现有 SecretStore 构造处
加入必填且正数的 `OPENBAO_HTTP_TIMEOUT_SECONDS`，由同一有界客户端
供 platform、provisioner 和 Tenant 子会话使用；audit 观察者独立构造
同样的有界客户端。超时归入原有 `SecretError::Transport`，归位逻辑
不新增写路径，不把它判断为未写入。部署配置中的时限应短于 Worker
Activity 的 StartToClose 期限；本地环境配为 5 秒，Worker 当前为
30 秒。业务源码没有固定秒数，缺失或零值时 Core 拒绝启动。

编辑前 GitNexus 对 `AppRoleSession::new` 报 CRITICAL，22 个符号、
28 条受影响流程，包含身份投影、Web 传输、归位及 audit 会话；
已核对四类生产构造点和测试夹具的全部调用。受 8 GiB/400% cgroup
限制的 `kailo-secrets` 单元检查 7/7 通过，其中悬停服务不会响应，
有界登录返回 `Transport` 且 `error.is_timeout()` 为真。故意把测试
时限改到超过假服务的悬停时间，同一检查退出 101；恢复后 7/7。
`./tools/check-docs.sh` 七组通过；受 16 GiB/500% cgroup 限制的
`./tools/check.sh --full` 十组通过，其中隔离库未提供，实际迁移演练
明确 SKIP。`docker compose config --quiet` 退出 0。

Core 在 16 GiB/5 CPU 的受限 BuildKit 与 16 GiB/500% 外层 cgroup
下重新构建并通过 `start-core.sh` 投递新的单次 OpenBao 凭据；本地
`kailo-local-core-bff-1` 运行镜像 ID 为
`sha256:320441b2bdefbda1571bb7013475cb63f3a187f33d035c3db2b062969a583712`，
BFF `/healthz` 返回 HTTP 200。本轮未制造真实 OpenBao 已提交写入而
响应悬停的网络故障，也未验证 Core/Temporal 的完整归位恢复；
`V-SCN-69`、归位能力暴露和 Stage 2 正式退出仍未闭合。

## `COPY_UNKNOWN` 固定目标恢复的真实服务链（2026-09-27）

权威仍是 `DD-85`、`.design/03` §9 与 `V-SCN-69`。本刀只增加既有
`secret_ref_rehome` 集成测试的故障夹具，不改产品状态机、API、数据库、
Workflow 或客户端。GitNexus 对新增测试函数的影响判定为 `UNKNOWN`；
全仓检索确认该测试文件由 Core 集成测试入口调用，实际 service route
与 Worker Activity 均已存在。归位能力仍为 `exposure: none`，用户
入口未开放。

在真实 Core、PostgreSQL、SpiceDB 与 OpenBao 上建立独立 Tenant，事务
冻结 `ActionExecution`、`WorkflowRef` 和 `COPY_UNKNOWN`，但不伪造
Temporal 已运行证据。首次调用 Core 的归位 service API 时，目标
KV 不存在：返回 HTTP 503，数据库仍为 `COPY_UNKNOWN`。这是对
“目标缺失不得被当作成功或重新进入写路径”的反向故障检查。随后测试
夹具对冻结的 Tenant 目标仅写入一次 KV v2 `cas:0`，模拟外部写入已
提交而响应丢失；同一 service API 后续观察并推进
`COPIED → SWITCHED → RETIRED`，重复调用保持 `RETIRED`。目标
metadata 的 `current_version` 仍为 1，identity pubkey 未变，binding
指向该目标版本。受 12 GiB/400% cgroup 限制的定向集成测试退出 0，
`cargo test -p kailo-core --test secret_ref_rehome
copy_unknown_observes_only_the_frozen_target -- --nocapture` 1/1 通过，
耗时 14.65 秒；受 8 GiB/400% cgroup 限制的定向 `cargo check` 退出 0。

测试结束后 Core 的该 Tenant 四张关键表均为 `0|0|0|0`；先停本地
Compose Core，复核 OpenBao 子 namespace 的路径精确等于本次 Tenant，
再只删除这一处可重建的测试 namespace。OpenBao 父目录已确认不再
列出该 UUID；该 namespace 内的测试密钥不可恢复。Core 通过
`start-core.sh` 重投一次性凭据后运行镜像
`sha256:857c5082eb6bfc0e6ff2c3d58dc7d3e5e015be61a10f7c55a63b4176b38a64d4`，
`/healthz` 返回 HTTP 200。这里
证明的是 Core/OpenBao service-path 的固定目标观察，未注入真实网络
响应丢失，也未启动归位 Temporal Workflow；`V-SCN-69` 的完整
Temporal/撤权/旧消费者故障链及发布暴露仍未闭合。

## `COPY_UNKNOWN` 经 Core 对账器派发的 Temporal 恢复链（2026-09-27）

在上一节同一测试夹具上，目标 KV v2 `cas:0` 写入后不再由测试直接推进
`COPIED → SWITCHED → RETIRED`。测试仅将已冻结的
`ActionExecution.updated_at` 移到部署配置的准入对账时限之外，由 Core
现有对账器派发固定 Workflow ID。真实 Worker Activity 调用 Core 归位
service API，随后查询数据库并核对 `SecretRefRehome=RETIRED`、
`ActionExecution.dispatch_state=DISPATCHED`、`WorkflowRef=TERMINAL` 与
`TaskProjection=COMPLETED`；另由 Temporal CLI 查询同一 Workflow ID，
确认 execution 状态为 `WORKFLOW_EXECUTION_STATUS_COMPLETED`。
OpenBao 目标 KV metadata 的 `current_version` 仍为 1，原 pubkey 未变，
binding 指向该目标版本。受 12 GiB/400% cgroup 限制的定向集成测试
1/1 通过，耗时 32.43 秒；受 8 GiB/400% cgroup 限制的定向
`cargo check` 退出 0。

本刀只改变已有集成测试的后半段；产品状态机、数据库、API、Workflow
与用户入口均未改。首次目标缺失的 HTTP 503/COPY_UNKNOWN 反向检查仍在。
测试 Tenant 的 Core 四张关键表清理后均为 `0|0|0|0`；停本地 Core、
复核精确路径后，删除了仅属于该测试 Tenant 的 OpenBao 子 namespace，
其中测试密钥不可恢复。未注入真实网络响应丢失，也未覆盖执行中撤权、
旧消费者和发布暴露；`V-SCN-69` 与 Stage 2 正式退出仍未闭合。

## 旧执行未终态时保留旧版本（2026-09-27）

权威为 `DD-85`、`V-SCN-69` 与 `03` 的 SecretRef 归位状态机。
只扩展上一节的独立 Tenant 集成夹具：在 Core 对账器派发前，插入一条
`EVALUATING/NOT_DISPATCHED` 的同 Tenant 测试动作，目标与归位动作
不同，不产生 native 副作用。切换到 `SWITCHED` 时，查询冻结的
`old_generation_consumer_refs` 确认该动作在清单内。趁它未终态，
主动调用既有 service API 尝试退役，得到 HTTP 503；OpenBao
metadata 显示旧 KV 版本 `destroyed=false`。把测试动作确定转为
`DENIED` 后，同一 Temporal Workflow 收敛到 `RETIRED`、
`WorkflowRef=TERMINAL`、`TaskProjection=COMPLETED`，Temporal CLI
返回 `WORKFLOW_EXECUTION_STATUS_COMPLETED`；旧版本回读为
`destroyed=true`，新目标仍只有 KV v2 版本 1。

修改前 GitNexus 对集成测试函数给出 `risk: UNKNOWN`；其调用由
`core/verify/run-integration.sh` 的 Cargo 集成测试入口及源码检索
确认，未把图谱的零调用当作安全结论。影响只限夹具断言和本记录，
无产品数据库迁移、API、Workflow、三端入口或上游 patch 变化；
能力继续 `exposure: none`。旧动作未终态、目标缺失和结果不明均不
转成成功或第二次写入；超时或外部不可查证时测试保留夹具供对账。
受 8 GiB/400% cgroup 限制的定向 `cargo check` 退出 0；受
12 GiB/400% cgroup 限制的真实集成测试 1/1 通过，耗时 22.31 秒。
主动制造的旧动作未终态分支得到 503 与 `destroyed=false`，故该
检查确实能区分“未销毁”与“已完成”。

测试 Tenant `967e7d64-c404-4629-a87d-a74537a88dfe` 的 Core 四张
关键表停服前后均为 `0|0|0|0`。精确确认 OpenBao 路径后，仅离线
删除其子 namespace，并从父目录查证消失；其中测试密钥不可恢复。
本地 Core 经 `start-core.sh` 重投一次性凭据，受限 BuildKit 生成的运行
镜像为 `sha256:356169c431f9352599a12a208e383b80f8a4ae03553561b8d34840df3790dfc0`，
BFF `/healthz` 返回 HTTP 200。
系统盘压力下另以 `uv cache clean` 清除
`/volumes/data/kailo/cache/uv` 的 107531 个可重建缓存文件
（7.5 GiB），未碰旧 K8S、业务卷或其他 namespace。
本夹具模拟的是尚在准入中的动作，不是正在读取旧私钥的真实并发
消费者；真实写入响应丢失、执行中撤权、销毁响应丢失的端到端链与
生产规模积压仍无本轮证据，`V-SCN-69` 和 Stage 2 不因此关闭。

## 复制后被拒与开放（2026-09-28）

缺陷：`COPIED` 之后若发起者失去新鲜 `manage`，或 binding 已被其他身份路径
推进 generation，原实现只回 503，Workflow 无限重试，该 Tenant namespace
里留下一份无人引用的私钥副本。`.design/02` DD-85、`03` §9、`06`、`16`
V-SCN-69 已写定唯一处置：这两类确定拒绝销毁目标 locator 版本 1，metadata
确认 `destroyed=true` 后才 `FAILED`、新 ref `DISCARDED`，binding 保持原 ref；
销毁不明保持 `COPIED` 由同一 Workflow 对账并告警。投影在途、权限判定不可得、
审计不可用仍只是暂缓。

实现：`kailo-secrets` 把 DD-86 的“CAS 0 争版本 1 → destroy → metadata 查证”
抽为共用私有函数，新增只接受 `buzz-ref-rehome/<rehome_id>` 的入口；Tenant
namespace 策略增加该前缀的 destroy。Core `discard_copy` 先过审计门、收敛
Tenant 策略（早于本策略的 namespace 没有该能力）、确认没有任何 binding
引用目标 locator，再销毁并在同一事务写 `FAILED/DISCARDED` 与
`copy-discarded` 审计。迁移 `20260928160000` 扩展 `new_ref_status` 与两条
状态约束；回滚遇到 `DISCARDED` 行时拒绝，不改写审计事实。能力
`identity.secret_ref_rehome` 开放为 `tenant_admin`，注册表单元断言与走查
“成员页”一步同步反转为“可见入口、列表如实为空”。

证据（本地拓扑，受限 BuildKit）：

- 第一次全套集成中新用例 `copied_then_rejected_destroys_the_unreferenced_copy`
  失败：Core 日志“归位副本销毁未得到查证：凭据被拒或路径不在策略内”，行保持
  `COPIED`，fail closed 生效；据此补上策略与收敛。修复后的 Core 对这条真实
  遗留行（Tenant `53941c2e-c5e1-45b6-a09e-da1b0129ecce`，其 namespace 策略早于
  本次变更）直接调用 service API：HTTP 409，行为 `FAILED|DISCARDED|1`。
- `core/verify/run-integration.sh` 退出 0，31 批 `test result: ok`，含
  `copied_then_rejected_destroys_the_unreferenced_copy`（binding 推进与发起者
  撤权两种拒绝各一轮：409、`FAILED/DISCARDED/1`、目标版本 1 `destroyed=true`
  且 `current_version=1`、binding 仍为原 ref、一条 `copy-discarded` 审计、终态
  重放 409）、`copy_unknown_observes_only_the_frozen_target` 与已开放路径的
  `legacy_server_secret_ref_is_blocked_until_exposed_then_rehomes`。
- 破坏核验：把 binding 偏离分支改回 503 不销毁并重新部署 Core，定向运行该
  用例在 “binding-moved: 复制后被拒应为确定失败” 处失败（503≠409）；源码还原
  后重新部署。
- replay：从真实已完成的 `kailo:SECRET_REF_REHOME:37b043e8-…:8dfe4b6c-…:1`
  导出 `component_task_secret_ref_rehome_history.json`（3 次 Advance：COPIED、
  SWITCHED、RETIRED），加入 `TestComponentTaskReplay`；在归位循环里插入一个
  `workflow.Sleep` 后 replay 报 TMPRL1100，还原后通过。
- `web-walkthrough.sh` 20/20 通过。
- 集成脚本修正：失败用例保留自己的夹具时，原清理立即返回，本轮其他已拆除夹具
  的 namespace 全部泄漏（本次泄漏 12 个）。现只保留仍被 Core 引用的那个 Tenant
  的 namespace 与登记，其余照常离线清理，退出码仍为失败。泄漏的 12 个已按同一
  检查（Core 四表计数为 0、路径精确匹配）停服后离线删除。

遗留：上述 `53941c2e-…` 与破坏核验保留的 `c8652adc-768c-455f-8c63-2396bc02bc19`
两个失败夹具 Tenant 仍在 Core 与 OpenBao 中，按“失败保留夹具供排查”纪律未在线
删除，待离线拆除。


## 真实响应丢失与执行中撤权的故障注入（2026-09-29）

权威为 `DD-85`、`.design/03` 的 `SecretRefRehome` 说明与 `V-SCN-69`。只增加集成用例，
不改归位状态机、数据库、API 或 Workflow。

注入手段：`tests/secret_ref_rehome.rs` 的 `DropResponseProxy` 是测试进程内的 TCP 代理，
把请求逐字节转发给本地真实 OpenBao，读到上游回应的状态行后双向断开，不向请求方交回任何
字节。它真实而非模拟：OpenBao 实际处理并回应（代理记录状态行；KV v2 写入与 `destroy` 均在
回应前同步提交，`destroy` 先写 metadata 再删版本数据，见
`openbao/internal/builtin/logical/kv/path_destroy.go`），请求方得到的只是传输错误，与 Core 在
`write_once` / `destroy_legacy_identity_version` 收到 `Transport` 时的局面相同。限制：部署中
的 Core 直连 OpenBao，不重启就不能改道，因此那次「回应丢失」的请求由测试代替 Core 发出，
随后只由真实 Core 的 service API 按冻结 locator 与 metadata 收敛。现有 `drill-*.sh` 与
集成夹具中没有可复用的回应丢弃手段（此前两个用例以 root 直接写入代表「已落盘」）。
代理自检 `drop_response_proxy_delivers_request_and_withholds_reply` 不依赖集成环境：假上游
完整收到请求体并回应 200，请求方得到错误；把代理改为转发回应后该检查以
「请求方不应收到回应：Ok(200)」失败，还原后通过。

新增用例（均需集成拓扑）：

- `lost_write_and_destroy_responses_converge_by_locator_and_metadata`：`COPY_UNKNOWN` 下目标
  缺失得 503；目标 `cas=0` 写入回应丢失后，下一次推进只查证 locator 得 `COPIED`，随后
  `SWITCHED`；待冻结的旧 generation 消费者在 Core 侧已终态，再以回应丢失的方式销毁旧版本；
  metadata 已 `destroyed=true` 而行仍 `SWITCHED`，下一次推进按 metadata 退役为 `RETIRED`，
  重放仍 `RETIRED`，`retired` 审计恰一条，目标 `current_version=1`，binding 指向目标版本 1。
- `revocation_during_rehome_never_leaves_an_unreferenced_copy`：补齐执行中撤权矩阵（既有
  `copied_then_rejected_*` 已覆盖 COPIED 后 SpiceDB 撤权与 binding 偏离）——`INTENT` 写前
  撤权得 403、`FAILED/NONE`、目标 KV 不存在、`copy-rejected` 一条；`COPY_UNKNOWN` 写入回应
  丢失后撤权，查证仍得 `COPIED`（按设计只查证目标），随后 409、`FAILED/DISCARDED/1`、目标
  版本 1 已销毁；另一位 Tenant admin 发起、COPIED 后其 Core 成员关系被撤而 SpiceDB 仍有
  admin，同样 409 并销毁副本。三处 binding 均保持原 ref。

本节提交时两条集成用例只经编译（`cargo test --workspace --no-run` 退出 0）与未开启集成
开关时的空跑，尚无真实拓扑运行结果；`V-SCN-69` 与 Stage 2 的结论不因本节改变。

## 接手真实拓扑复验（2026-09-30）

基线为 `0ec5e552` 之后接手的未提交工作树。既有 `core/verify/run-integration.sh` 中
`tests/secret_ref_rehome.rs` 为 **6 passed、0 failed、0 ignored，21.91 秒**：
`lost_write_and_destroy_responses_converge_by_locator_and_metadata`、
`revocation_during_rehome_never_leaves_an_unreferenced_copy` 及另外四项均通过。
日志为 `/volumes/data/kailo/tmp/codex-integration-20260930.log`。

这一结果替代上一节「仅编译、未在真实拓扑运行」的当前状态：真实 OpenBao 接受写入与
销毁后回应被丢弃，真实 Core 按冻结 locator、binding 与 metadata 推进；执行中撤权的
三条拒绝路径及副本销毁通过。故不能继续把这三类情况全部列为没有证据。

边界保持不变：丢回应的那次请求由测试进程发出，运行中的 Core 没有被改道；本轮不是
对 Core→OpenBao 网络链的全路径故障注入，不是生产规模积压实测。接手后尚未重跑
本增量的破坏核验与浏览器走查，`V-SCN-69` 和 Stage 2 不据此整体关闭。
全套命令退出 **0**，Rust/Go 检查均通过，35 个本轮测试 namespace 已离线清理、前后
集合相等，Core 恢复后独立 `/healthz` 为 **HTTP 200**。实际恢复镜像和显式未运行项见
`native-identity.md` 同日记录。

## 独立复核：存量 BOUND 意图的退休事务缺陷（2026-09-30，修复前）

本节记录修复前未提交工作树的源码与只读数据库核对，不是修复完成声明，也不是运行中
已经观察到约束报错的记录。权威为 `DD-85`、`DD-113` 第 6 条和 `DD-115`：存量当前
引用补建为 `BACKFILLED/BOUND`；退休审计归属必须是实际引发退休的 operation，不能
伪造原始签发 operation。

复现源码核对：

```bash
rtk proxy sed -n '50,65p' core/migrations/20260930120000_platform_key_retirement.up.sql
rtk proxy sed -n '100,115p' core/migrations/20260930120000_platform_key_retirement.up.sql
rtk proxy sed -n '812,901p' core/crates/platform-core/src/secret_ref_rehome.rs
```

迁移的 CHECK 要求 `retired_at` 非空时 `retire_operation_id` 非空；补建的旧 BOUND 行
没有退休 operation。`retire` 先调用 OpenBao destroy 并取得 metadata 证明，再仅设置
旧意图的 `retired_at`。匹配上述存量行时，该 UPDATE 违反 CHECK，Core 的 RETIRED
与审计事务回滚，而已销毁的旧版本不能回滚。下一轮重复同一 UPDATE，不能终结。
复核时的 `cutover` 也没有在切 binding 的事务中冻结旧意图的退休 operation。

只读联接 `secret_ref_rehome` 与同 Tenant、同旧 locator 的意图，实际返回：COPIED
1 条、匹配旧意图 1 条、退休 operation 为空 1 条；FAILED 1 条、匹配旧意图 1 条、
退休 operation 为空 1 条。此次没有推进这些保留行，没有销毁任何钥匙。
既有 6/6 用例在迁移之后制造 legacy binding，未建立相应旧 locator 的补建意图，
退休 UPDATE 匹配 0 行；其通过不能排除本缺陷。

历史兼容边界另行核对 `git show 0ec5e552:apps/core/crates/platform-core/src/secret_ref_rehome.rs`：
该版本的切换不创建签发意图，迁移只扫描当前 binding。因此迁移前已经 SWITCHED 的
合法历史任务能缺少旧意图；不能用补造签发事实或拒绝所有历史任务处理这一边界。
有旧意图时退休归属必须核对真实归位 operation，已有其它 operation 不得覆盖。
本缺陷修复与兼容路径核验完成前，`V-SCN-69/86` 和 Stage 2 不整体关闭。

## 退休归属冻结与历史兼容的实施（2026-09-30，运行核验待完成）

本轮只修改 `secret_ref_rehome.rs` 的 `load/cutover/retire`，增加由后两者调用的
`freeze_old_retirement`，保留原未提交的目标 BOUND 意图登记；没有新增迁移、API、
状态、Workflow、fixture 或测试。四步变更分析为：核对 DD-85/113/115 与现有 SQL；
确认编辑前影响；落实退休冻结与历史来源判别；格式检查及现有证据记录，随后由根代理
统一构建、运行验证和图门禁。

编辑前根代理已取得同一 runner 的 CLI/MCP 新鲜回执：HEAD `0ec5e552`、
2026-09-30 10:03:16 UTC 的 schema 4/current、`incomplete_reasons=[]`。
三个已有函数 impact 均 LOW，直接调用方为 `advance_inner`，经 `advance` 挂 service API。
`load` 的图结果另有同名 receiver 的下界缺口，本文内检索确认调用方仅 `advance_inner`；
不把该图下界当成全面无缺口，也不把编辑前图的新鲜度当作编辑后最终门禁。

实现后的源码条件：

- `load` 核对归位 ID 就是原 ActionExecution ID，并把实际 WorkflowRef 的
  action、Tenant、operation、type/kind 与当前绑定的 Principal/pubkey 归属关联。
  HEAD 的 Governed Action 预写原本就以同一 Workflow ID 同事务写 WorkflowRef、
  SecretRefRehome 和 `ActionExecution.temporal_workflow_id`；此要求不套用于旧消费者清单
  中 Stage 1 的直接 service 动作，原 `consumer_terminal` 判定保持不变。
- 新 `cutover` 在 binding 行锁和原 ref/generation CAS 下，要求同 Tenant/kind/Principal
  的旧 BOUND 意图；仅在退休 ID 为空或等于真实归位 operation 时冻结，与 binding CAS、
  新目标 BOUND 和 SWITCHED 同事务提交。缺行、形态不符、已退休或已有其它 operation
  都不切换，不覆盖退休归属、不伪造签发意图。
- `retire` 在旧消费者终态后短事务锁当前 binding、验证目标 ref/version/audience 与
  最小切换 generation，恢复遗漏的真实退休冻结并先提交，才查询/销毁原钉定旧版本。
  查证后仅按确切旧意图 ID、Tenant、locator 和已冻结 operation 写 RETIRED，与归位
  终态、审计同事务提交；已查证 destroyed 的版本不再次发起 destroy。
- 缺旧意图只接受完整原 DD-85 的 SWITCHED、cutover 与 SUPERSEDED/ACTIVE 事实，
  且当前目标为同 Tenant/kind/Principal 的 BACKFILLED 意图。HUMAN/CONTROL BACKFILLED
  的唯一生产写入者是 DD-113 迁移按当前 binding ref 的补建；运行期补建仅为 OPERATOR，
  其他生产写入均为 PROVISIONED。目标 PROVISIONED 缺旧意图、不匹配的既有旧行或
  不完整的 Action/Workflow 关联均在 destroy 前拒绝。历史分支不补造任何旧意图。

不使用 `cutover_at <= target.created_at`：两者的 `now()` 是各自事务起点，迁移先开始、
旧 cutover 随后完成、迁移再读取新当前 ref 的合法交错会违反该比较。切换后身份撤权或
目标意图已退休不阻断旧版本 cleanup；原 `old_version>1` 仍按 DD-85 查证该固定版本。
不持有数据库行锁跨 OpenBao 请求；并发或结果不明仍可能重试同一固定版本的 destroy，
不宣称外部副作用 exactly-once。

本轮从 `/volumes/kailo` 实际运行以下检查，均退出 0：

```bash
rtk proxy rustfmt --edition 2021 --check apps/core/crates/platform-core/src/secret_ref_rehome.rs
rtk proxy git diff --check -- apps/core/crates/platform-core/src/secret_ref_rehome.rs apps/core/verify/secret-ref-rehome.md
```

尚未编译、部署或运行本修复的真实拓扑/破坏核验，也未证明现场历史 SWITCHED 兼容链。
既有 6 个 rehome 用例在当前迁移后制造没有旧意图的 legacy binding，不能作为新 cutover
门禁的正向种子；本轮未为使其通过而放宽门禁、修改 fixture 或制造意图。
此前 6/6 结果保持其原条件范围，不扩展为本修复 PASS；最终图门禁、`V-SCN-69/86`
和 Stage 2 仍待根代理统一核验。

## 写前目标意图与副本持久 fence 的实施（2026-09-30，运行核验待完成）

本轮修正 DD-85/86/113 的 target-copy 并发缺口：先前只在切换事务 INSERT BOUND
意图，discard 的「检查无引用→外部 destroy」没有持久 fence，不能排除另一个 Core
实例在检查之后切换并绑定这份副本。本轮修改 `secret_ref_rehome.rs` 的
`actor_still_authorized/copy_once/observe_copy/cutover/discard_copy`、
`platform_keys.rs::fence_and_destroy_with` 和 `governance_reconcile.rs::pass`；
新增由 observe/cutover/discard 实际调用的 `target_copy_intent`，未修改现有审计 helper、
SecretStore、退休兼容路径或 fixture，没有新增 schema、状态、Workflow、配置或服务。

四步变更分析与实际执行顺序为：复核现有 DD/实体、意图约束与共享 fence；核对编辑前
新鲜影响回执；实现写前 OPEN、绑定条件和唯一 fence 收敛；格式/diff 检查并追加本节
事后证据。根代理提供的 #10 同 runner CLI/MCP 回执均为 HEAD `0ec5e552`、
indexedAt `2026-09-30 10:46:15 UTC`、status `up-to-date`、contentDrift `current`、
schema 4/current、`incomplete_reasons=[]`。七函数的 impact 已实际完成，原始记录在
`/volumes/data/kailo/tmp/codex-corrections-impact-20260930.log`；除共享 fence 为 CRITICAL
外均为 LOW。CRITICAL 已在编辑前告知用户，直接调用方包含 `freeze_operator_write`
和 `fence_and_destroy_intent`，影响部署引导 main 与 `provision_tenant_buzz`；不能把
编辑前回执当作编辑后最终门禁。

实现后的源码事实：

- `copy_once` 先锁真实归位 Action/Principal，核对同 Tenant 的实际 binding 归属与固定
  ComponentTaskWorkflow；以该 Action 的 operation、该 binding 的 kind/Principal 在
  `INTENT→COPY_UNKNOWN` 同事务 INSERT PROVISIONED OPEN 目标意图，再发唯一 CAS0 写入。
  SQL 唯一约束失败会回滚整个事务，不改 locator、不复用已有 fenced 意图。
- `observe_copy` 回读版本 1 与派生 pubkey 后，在登记 COPIED 的同一事务锁定并要求
  该真实目标 OPEN；历史 COPY_UNKNOWN/COPIED 缺写前意图保持 fail closed，不补造。
- `cutover` 在目标回读之前识别已持久 FENCED/DESTROYED 的副本并继续 discard；即使
  发起者后来恢复权限，也不复活副本或卡在读取已销毁目标。最终事务按原 Action、
  Principal、目标意图锁序取得同一 OPEN，再锁 binding，原 ref/generation CAS 与
  `finished_at`、旧退休 operation 冻结、SWITCHED 和审计同事务提交，不再 INSERT BOUND。
- `discard_copy` 只调用平台共享 `fence_and_destroy_intent`，CONVERGED 后才把 COPIED
  转为 FAILED/DISCARDED 并追加原 DD-85 outcome。共享链先 commit 持久 fence，再调用
  现有 `destroy_unbound_rehome_copy` 的 CAS0/版本 1/metadata 查证；未知结果不宣告失败。
  若 binding/BOUND 先提交，fence 不销毁；若 fence 先提交，cutover 不能绑定。
- 平台共享链先读取实存 AE.action_key；归位还须匹配真实 Rehome、原 AE/operation、
  同 Tenant 的 pubkey/owner/kind、固定 Workflow ID/type/kind 和 AE.temporal_workflow_id。
  已知是归位而任一因果事实不匹配直接 CONFLICT，不退回普通 CONTROL 初建销毁入口。
  HUMAN/CONTROL 副本复用同一归位销毁能力；原归位 AE 不执行初建 UNKNOWN→ABORTED。
  DESTROYED 审计沿用原 ActionDefinition 分类，追加到真实原 operation；原 Workflow
  决定任务终态。不存在新增的缺定义审计分类兜底。
- HUMAN 与 CONTROL 的两处初建意图扫描按实存同 Tenant AE.action_key 排除归位，
  不因它仍持有旧 binding 而把合法归位误判为初建孤儿。原固定归位 Workflow 继续
  重试，现有 rehome/open/overdue 指标仍保留未知结果；legacy 初建扫描原本只选初建动作。
- `actor_still_authorized` 使用既有严格 `check_bulk` 的单项 FullyConsistent Check。
  缺 revision、缺项、重复、item error 或未知 permissionship 都是不可判定，只暂缓，
  不触发 discard；只有完整确定的拒绝或已持久 fence 才进入对应清理路径。

本轮从 `/volumes/kailo` 实际执行以下检查，前两项退出 0：

```bash
rtk proxy rustfmt --edition 2021 --check apps/core/crates/platform-core/src/secret_ref_rehome.rs apps/core/crates/platform-core/src/platform_keys.rs apps/core/crates/platform-core/src/governance_reconcile.rs
rtk proxy git diff --check -- apps/core/crates/platform-core/src/secret_ref_rehome.rs apps/core/crates/platform-core/src/platform_keys.rs apps/core/crates/platform-core/src/governance_reconcile.rs apps/core/verify/secret-ref-rehome.md
rtk proxy git diff --no-index --check -- /dev/null apps/core/crates/platform-core/src/platform_keys.rs
```

`platform_keys.rs` 原已为未跟踪文件，普通 scoped diff 不展示它；第三项补充检查该
完整文件，退出 1、输出为空（no-index 对新增文件的差异退出码），不登记为退出 0。
尚未编译、部署或运行本修复的真实拓扑/并发/破坏核验，没有声称 exactly-once 外部
destroy。此前 6/6 的条件范围不变，
既有迁移后缺旧意图的 rehome 种子未修改；V-SCN-69/86、Stage 2 与最终图门禁仍未
据此关闭，后续构建及统一门禁由根代理执行。

DD-113/115 的 `20260930120000_platform_key_retirement` 与
`20260930130000_intent_action_scope` 对旧 writer 的不兼容结论保持其原实验范围。
2026-09-30 用户明确当前交付为全新开发环境，没有线上旧版或历史数据保留要求；
按 `06-工程基线规范.md` §5，旧 writer 兼容与迁移前历史形态恢复无适用对象，不作为
当前开发或发布阻断。当前生命周期创建的 SecretRef 的复制、切换、撤权、退休及持久
fence 仍须真实服务验证，不能用历史 6/6 或静态通过替代当前产物证据。

## 接手失败日志与现有核验数据形态复核（2026-10-01）

本节只记录现有失败的边界，不修改生产归位逻辑、测试数据、API、迁移或部署。
`/volumes/data/kailo/tmp/codex-retirement-media-integration-20260930.log` 中当前
`secret_ref_rehome` 的实际结果为 **1 passed、5 failed，44.22 秒**；通过的仅是
`drop_response_proxy_delivers_request_and_withholds_reply`。此前 6/6 对应更早源码和
数据条件，不能替代本次结果或证明当前 DD-113/115 集成通过。

对该日志、现有测试源码与生产 SQL 逐项核对后，失败位置与以下缺失事实一致：

- `copy_unknown_observes_only_the_frozen_target`、
  `copied_then_rejected_destroys_the_unreferenced_copy`、
  `lost_write_and_destroy_responses_converge_by_locator_and_metadata`、
  `revocation_during_rehome_never_leaves_an_unreferenced_copy` 直接写入
  `COPY_UNKNOWN`，再以核验凭据写目标 KV，没有登记同一原 Action/operation 的
  `ServerKeyProvisionIntent`。`observe_copy` 的 `target_copy_intent` 因而不能取得
  写前 OPEN 事实，不能仅凭目标版本可读补造意图或宣布 `COPIED`。
- `legacy_server_secret_ref_is_blocked_until_exposed_then_rehomes` 走真实 BFF
  准入与复制，但先把新建 binding 改指迁移后新造的部署级旧 locator，没有该旧
  locator 的 BOUND 意图。`freeze_old_retirement(false)` 在切换前拒绝，任务停在
  `COPIED`；不能为这一核验数据形态放宽 DD-113/115 的退休归属门禁。

当前全新开发数据库中，按原日志精确限定五个失败 Tenant，联接归位行与目标/旧意图
的只读查询退出 0、返回 `(0 rows)`。本轮没有重放这些原失败，没有创建新核验数据，
没有推进归位或执行任何销毁；上述源码解释不登记为当前运行成功。

随后按 `SecretStore::classify_legacy_server_identity_ref` 的部署 namespace、mount、
`buzz-human/<tenant>/…` 与 `buzz-control/<tenant>[/…]` 形态，查询全部 ACTIVE Tenant
的 ACTIVE SERVER HUMAN/CONTROL binding，实际为 **4 个 binding、0 个遗留 locator**；
`admission.secret_ref_rehome` 查询为 `(0 rows)`。只读 `psql -X -v ON_ERROR_STOP=1`
退出 0，输出存于
`/volumes/data/kailo/tmp/codex-secret-ref-rehome-applicability-20261001.3nrubv.log`；
凭据仅从既有配置与 secret 文件以内存环境传入，没有写入日志。

因此上述五项依赖遗留 locator 的核验在本次全新环境没有真实适用对象；没有补种子、
写入旧 locator 或补造 OPEN/BOUND 意图来制造这一对象，也没有删除或放弱其原断言。
第六项 `drop_response_proxy_delivers_request_and_withholds_reply` 不依赖遗留 locator，
其原日志 PASS 保留，但本轮未重新运行。六项均不因本次适用性查询变为新的运行 PASS，
当前 SecretRef 复制、切换、撤权和退休链也不由这些计数获得验收。

编辑前同一 `kailo-plus` 图谱的登记回执为 HEAD `ee4c796`、indexedAt
`2026-10-01T02:47:31.671Z`。七个现有函数的 context/impact 完成，impact 均为 LOW；
File 的 UNKNOWN 以 `service_api`、BFF、Worker 的实际调用补充，不解释为无人使用。
完整回执为 `/volumes/data/kailo/tmp/codex-secret-ref-rehome-preimpact-20261001.log`。
本轮未改生产源码、未重新构建或运行全套集成；现有核验数据条件不满足时不扩大完成
声明，`V-SCN-69/86` 和 Stage 2 不由本节整体关闭。
