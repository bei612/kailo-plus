# DD-85 遗留身份 SecretRef 归位核验

2026-09-27，开发中；本记录不表示能力已发布或 `V-SCN-69` 已闭合。

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
