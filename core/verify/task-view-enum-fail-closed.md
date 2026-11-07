# 任务视图未知状态拒绝

2026-09-25。依据 `.design/03` §6 的 TaskProjection 派生权威、`.design/06` §9 的受权任务视图、`apps/06` §4 的 `UNKNOWN` 失败分类。此项只修复 BFF 的任务读取，不开放取消或重跑入口。

## 变更前核对

1. 权威：任务运行状态来自 Temporal/Worker 与 ExternalExecution，Core 的 TaskProjection 只读。BFF 不得把数据库中存在但不属于四语言契约的状态值解释成“没有状态”。
2. 影响面：GitNexus 对 `governance_api::task_view` 报 `LOW`，直接调用者为 `get_task` 与 `list_tasks`，涉及两条本人任务读取路径；不改数据库、契约字段、Temporal、上游源码或三端控制入口。
3. 副作用：原实现对可选 `reason_code`、`approval_status`、`workflow_kind`、`task_status` 使用 `and_then(parse)`，未知非空值静默变为 `None`。现在只允许数据库 `NULL` 映射为 `None`；未知非空值返回带 operation ID 的 `UNKNOWN/DEPENDENCY_UNAVAILABLE` 错误体，不返回可误读的 TaskView。
4. 边界：同一列表有一条未知状态时整页拒绝；详情同样拒绝。已知枚举和真正的 `NULL` 沿用原映射，投影新鲜度及终态对账规则不变。错误不触发 Start、Cancel 或重跑，也不改变任何事实。

## 实际验证

- 受限 cgroup 中的定向测试 `cargo test --manifest-path core/Cargo.toml -p kailo-core unknown_persisted_task_enums_do_not_become_absent_fields` 通过，四个非空未知枚举都被拒绝。
- 破坏验证：仅把 `task_status` 临时恢复旧 `and_then(parse)` 后，同一测试退出码 `101`，断言发现原实现返回 `Ok(TaskView { task_status: None, ... })`；随后恢复修正。
- 恢复后的 `./tools/check.sh --full` 在 `MemoryMax=16G`、`CPUQuota=500%` cgroup 中退出码 `0`，十组门禁通过。数据库迁移实演因该命令未提供 `DATABASE_URL` 而 `SKIP`；本次没有数据库迁移。
- 提交前 GitNexus `detect-changes --scope all` 报 `CRITICAL`、17 条流程，并把 `ApprovalRow/decisions` 等列为改动符号。已逐块核对 `git diff --check` 与实际 diff：生产代码只改 `task_view` 的错误回应及四个可选枚举解析，另增一个同文件单测；审批结构、查询及决定逻辑均无文本改动。图的原始索引把 `task_view` 定在旧文件 172–198 行，新增代码使后续符号行号移动，因此不能把 `CRITICAL` 直接降成“无影响”；对图给出的真实调用者 `get_task/list_tasks` 已核对共用 `task_view`，全量门禁及破坏测试覆盖这条读链。

任务取消与重跑仍需独立完成 Governed Action、BFF 控制入口、Web/Desktop 操作和 Temporal 真终态验证；此项不将其计为已完成。

## 共用审批面板控制事实修正（2026-10-01）

本节追加本次 Web/Desktop 共用 `ApprovalPanel` 的事后事实，不改变上述历史验证范围。
权威为 `.design/06` §4 的每人不可变决定、同值幂等，以及 §8 的受权工作台与
`06-工程基线规范.md` §4 的 UNKNOWN 分类；BFF 与 Temporal 仍执行 fresh admission，
客户端显示条件不成为权限或审批权威。

原面板有两处可达的不一致：打开的确认框跨刷新保留，即使回读为终态或投影不可担保，
仍绕过按钮的 `controllable` 条件；决定响应不明时该条件只排除确定成功，因而再次显示
批准与拒绝两个新意图入口。现在面板刷新先清除旧确认，确认框与按钮使用同一条件，
确定结论及 UNKNOWN 均不再提供新意图。UNKNOWN 决定仍只允许原样重发原决定，
原 Update 去重身份不变；UNKNOWN 撤回保留等待查证，不新增重试协议。

编辑前在 `apps-source`（`/volumes/kailo/apps`、HEAD `ee4c79683453b0cdc45ca5a0668338b6f977c17c`）
执行 context/impact，索引 `2026-10-01T07:48:55.354Z`、schema 4/current、
`incompleteReasons=[]`、`contentDrift=current`、`status=up-to-date`。函数 impact
为 LOW/9，直接调用者为 `ApprovalsPage` 与 `TaskDetail`；File 为 LOW/19，Web、
Desktop 与 NativeBootstrap 的共用消费链不变。完整输出为
`/volumes/data/kailo/tmp/codex-approval-panel-preimpact-20261001.Iu2hO3.log`。

SDK 验证只在既有镜像
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`
内执行。每次 `docker create` 后先回读实际 HostConfig 为 2 CPU、2147483648 字节
memory、相同 memory+swap，再 start；源导出、临时依赖和日志均在 `/volumes/data`，
不使用宿主 SDK、不修改工作树 node_modules。固定 pnpm 实际为 10.33.4，命令为：

```bash
pnpm install --frozen-lockfile
pnpm -r typecheck
pnpm --filter @client-kit/platform test
```

首轮两包 typecheck 通过，平台 test 退出 1：私有导出漏了原有 presentation test vector
与 Web/Desktop 的 tailwind 配置，两个 suite 因 ENOENT 未运行；已运行的 54 项通过，
不能解释成平台全部通过。原输出保留于
`/volumes/data/kailo/tmp/codex-approval-ui-check-20261001.YDjky4.log`。
补导出这三个既有依赖后，不改源码、测试断言或数据，再运行原平台 test，实际
**7 files / 88 tests passed、容器退出 0**；输出为
`/volumes/data/kailo/tmp/codex-approval-ui-check-restored-inputs-20261001.Exajyv.log`。
既有 NativeBootstrap 的 `act(...)` warning 保留，不把 warning 隐藏为无输出。

源与验证导出的 `governance.tsx` SHA-256 均为
`5e6de2a08a08347a77debe19c0af98b12b69fa0d16462c84e8e9ddf97d3fcedb`。
原 `governance.test.tsx` 未修改，其中 14 项通过，但其现有断言不直接覆盖本次两处
场景，因此这不是两处场景的独立运行证明；本次没有新增夹具或检查脚本。
下述 Web 产物已构建并部署；Desktop 未构建或部署本修正。本次既有回归不直接
覆盖两处场景，真实用户范围又没有适用审批对象，因此不登记为 V-SCN-68 或
Stage 2 完整验收。

### 实际 Web 产物、限定部署与浏览器结果

现有 `tools/build-upstream.sh web-client` 于 2026-10-01 实际退出 0，耗时
2m58.550s。外层 systemd 为 2 GiB/200%/swap 0；原 BuildKit builder
`kailo-core-data` 的真实容器为 16 GiB、8 CPU、memory+swap 16 GiB，缓存挂载
`/volumes/data/kailo/buildkit-core-state`。未创建 builder、改变它的限额或降低
Cargo 并行度。Node/npm 构建发生在 Dockerfile 的镜像内，临时上下文及日志在
`/volumes/data`。构建原输出报告 3 个 npm vulnerabilities（2 moderate、1 high），
未执行自动修复或把构建成功解释成漏洞验收通过。

工具自动写回 `web-client/fork/upstream.yaml` 的实际结果为：

- source digest：`sha256:00d158994f8af0029930b762fc4c2f9a8f2043eab58722a7aefbf3f08adb62ed`。
- Registry artifact digest：`sha256:970e17432d5292a22dcc921069b67829e6b2900dfa20e8f555eaa0ffcde588e0`。
- 构建日志：`/volumes/data/kailo/tmp/codex-approval-web-build-20261001.dVFaAK.log`，
  原 BuildKit 日志：`/volumes/data/kailo/tmp/build-web-client.XEcCag.log`。

实际配置中的 registry 地址从 `deploy/local/.env` 取得。仅用数据目录的 image
override 执行原 Compose `up -d --no-deps --no-build --pull never --wait buzz-web`，
退出 0。之前实际运行 Web 为 `sha256:b474c25ccb35f80dca16fa15d23058ca5fb86acea0a01f44f914f71cf62cf6ae`，
之后容器 `86605d82081a85c65ff8085e59b879bceeb704eda63468a90bd6e295f55f297e`
回读 image 为上述 `970e1743…` 且 healthy。Core、Keycloak、Relay、Worker、Gateway
五个容器的 ID 与 StartedAt 前后相同，未重启它们。部署日志为
`/volumes/data/kailo/tmp/codex-approval-web-deploy-20261001.EDSKyx/deploy.log`。
本次没有修改主 Compose 的持久 image pin；Registry push 不是 Git push，工作树
产物摘要也不是某个已提交 clean commit 的发布证明。

真实浏览器最初因本机缺域名解析出现 `ERR_NAME_NOT_RESOLVED`；CLI 退出 0
并不代表浏览器成功。随后只为本次 Chrome 进程按原 `PUBLIC_ORIGIN` 与
`OIDC_ISSUER` 配置映射 host/port，不改宿主 hosts。使用现有 BOOTSTRAP_USER
经真实 Keycloak 表单登录，登录凭据在匿名 pipe 内存中交付既有 CLI，未写入 argv、
凭据文件或日志，未手写 token/header。CLI 的 raw 输出及关闭 session logging
经本机工具源码核实，不回显执行的凭据代码。

浏览器实际加载 `/app/assets/PlatformApp-DbzF7gT3.js`，显示登录后的产品页面。
Tasks 的原 BFF GET 返回 200/0 entries，页面显示
“You have not started any governed action yet.”；Approvals 的原 BFF GET 返回
200/0 entries，页面显示 “Nothing is waiting for your approval.”。
当前用户范围没有可进入 Workspace、本人任务或待我审批；没有制造业务对象、
使用其他验证用户的专属 Tenant、注入 UNKNOWN 或改写授权。完整安全结果保留于
`/volumes/data/kailo/tmp/codex-approval-browser-20261001.cHOkIB/live-governance.log`
及同目录 `live-source.log`。

这些结果证明新 Web 已运行、真实认证和两条列表路径可用，不能证明两处审批场景
已经在真实对象上触发。刷新清除确认与 UNKNOWN 限定原决定重发的业务验收仍无
适用对象，本次不记 PASS，也不新增夹具或需求来制造适用对象。

## 共用审批原决定 UNKNOWN 保留与定向验收（2026-10-04）

本节只追加已实现事实，不改写上述历史验收。基准为
`aa19c8fe39cb7e71aa01c354a4a121e05c881998`；两份共享 TS 选定补丁
共 +105/-14，其中保留原审批刷新/控制条件的继承窗口 +13/-7。
本次新增生产修复只在 `ApprovalPanel::run`，实现后在原
`test/governance.test.tsx` 增补七项检查，不改 i18n、契约或后端。

四步结论如下：

1. 权威：`.design/06` §4、DD-47/DD-54 固定每人不可变决定与同值 Update
   去重；`06-工程基线规范.md` §4 禁止把 UNKNOWN 当成确定成功或失败。
2. 影响：Web `web-client/web/src/platform/ui/PlatformApp.tsx` 和 Desktop
   `collaboration/desktop/src/app/routes/platform.$section.tsx` 仍消费同一
   `ApprovalsPage`。`client.ts::decide` 使用原 BFF，
   `governance_api.rs::decide` 先重验会话与 scope，再以固定 Workflow/approver
   Update 身份询问 Temporal；客户端不成为权限或审批权威。
3. 副作用：曾发生 TransportError/UNKNOWN 的原决定，在同值重试期间及其后
   遇到 403/409 时保留原 outcome、决定和 operation 引用；后续准入拒绝不能
   证明原决定未发生。只有原决定的确定回应才替换未知事实；首次确定拒绝仍
   显示拒绝。刷新清除旧确认框及统一控制条件的继承修复继续保留。
4. 边界：不生成新状态、队列、幂等键、API 或替代决定。重复拒绝与投影刷新
   不解锁批准/拒绝新意图，UNKNOWN 撤回仍不新增重试协议。本节是镜像内
   交互/类型证据，尚未构建或部署，不覆盖真实 Approval/Temporal E2E 或设备。

原资源预检后使用不可变 SDK
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
实际 4 CPU/8 GiB/swap 0、UID/GID 1000:1000，源与既有依赖缓存均在 Data。
Node v24.21.0、pnpm 10.33.4，原锁文件未改，原命令为：

```bash
pnpm install --offline --frozen-lockfile --store-dir /cache/pnpm-memory-read
pnpm --dir client-kit/ts/platform typecheck
pnpm --dir client-kit/ts/platform exec tsc --noEmit -p tsconfig.test.json
pnpm --dir client-kit/ts/platform exec vitest run test/governance.test.tsx
```

基线 session 48082 退出 0：生产/检查类型均通过，21 项通过（原 14 项加七项）。
私有生产变异保持检查不变：把 `run` 的 UNKNOWN 比对改为 `rejected`，session
38883 退出 1、四项真实断言失败；删掉原 `refresh` 的 `setConfirming(null)`，
session 53384 退出 1、一项真实断言失败。两个文件逐字 cmp 0 还原后，session
38855 退出 0，生产/检查类型及 21 项检查再次通过。原失败输出保留；自有 SDK
已清理。`git diff --check` 退出 0；未运行独立 TS formatter、全平台检查或 full。

最终 `governance.tsx` SHA-256 为
`0674720e4a1de8391c7cf7034c0cac4cfb065cd78f5afe823403b22fc30a1dad`，
`governance.test.tsx` 为
`b8eb805331cb28d420224108dc4d8976d1cfe07f3b31a1a4ac95e8f557bacf8f`。
SDK 原件目录为 `/volumes/data/kailo/tmp/codex-approval-intent-20261004.9zBREL/`：

- `baseline.log`：`58cb6536199d687c8a522f8084191c7c7945828f7e96afaaa112f05790f30cf8`。
- `mutation-persistence.log`：`57f33f92096495e409052a6bd370cb470924f0fe3939e877251a5dfcede3919b`。
- `mutation-refresh.log`：`2532950ea1e5f0e35ff53afc0bd8a3848e9b14292d0c444a67681db354ee71d1`。
- `restored.log`：`1e21222f92c95eab1f1126d574d482d44275a3fc2800e9e7f108f3c8fd06965a`。
