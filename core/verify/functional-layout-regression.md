# 功能目录重构后的全量回归（2026-09-29）

对应 ADR-16 的目录与包名重构（提交 `076681d`，`apps/` 树与其后的 `dae9abd` 相同，
`git diff --quiet 076681d dae9abd -- apps` 退出 0）。本记录只证明重构没有改变已验证的行为，
不代替任何 Stage 的验收，也不证明 Desktop/Mobile 安装包。

## 执行与结果（本地拓扑）

- `core/verify/run-integration.sh`：退出 0，31 批 `test result: ok`。重构后的第一次运行失败于测试夹具中
  仍写着 Core 的旧二进制名；把夹具改为 `platform-core` 后重跑得到上述结果（提交 `076681d` 说明：
  「A stale binary name in the integration harness was fixed」）。
- `core/verify/web-walkthrough.sh`：20/20 通过。
- `tools/check.sh --full`：在隔离数据库上退出 0（含实际迁移前进/回退演练）。

## 破坏核验：派发结果记录

`ccb0a36` 把派发结果统一由 `governance.rs::record_dispatch` 记录（直接启动的路径经
`record_direct_launch`），迁移 `20260929110000_dispatch_state_backfill` 回填存量行；
`core/crates/platform-core/tests/native_client.rs` 断言设备公钥登记后 ActionExecution 的
`dispatchState` 为 `DISPATCHED`。

重构后把 `record_direct_launch` 的判断反转并重建 Core，该用例在
「登记完成后派发状态仍未推进」处失败（`left: NOT_DISPATCHED`，`right: DISPATCHED`）；
源码还原、重建后全套集成 31 批通过。原生端设备登记任务此前显示的
「Allowed, not started yet」由此闭合（`collaboration/fork/verify/desktop-client.md`、
`mobile-client.md` 中的观察早于该修复）。

## 门禁拦截

批量替换产品名字符串时误改了 `model-gateway` 上游 UI 的两个文件（`ui/src/pages/RawConfig.tsx`、`ui/src/configMonaco.ts`：其中上游原有的 `agentgateway-config.yaml` 字样被替换）；`tools/check.sh seam` 因
`model-gateway` 产物的 `source_digest` 与当前源码不符而失败。两个文件从 `ccb0a36` 原样恢复后
`seam` 通过，产物摘要与登记一致。

## 运行时数据迁移

运行时数据目录改名为 `deploy/local/data/secret-store`（原 `openbao`）与
`deploy/local/data/collab-objects`（原 `buzz-objects`）之前，停服并备份到
`/volumes/data/kailo/backup-rename-202609290706/`（`openbao.tar`、`buzz-objects.tar`、
`keycloak-import`）。迁移后 OpenBao 解封，Compose 服务全部恢复，随后执行上述回归。

## 未被本记录证明的边界

- 未在重构后重跑 Desktop `.deb` 与 Mobile APK 的端到端；
- 未对新 Core/Worker digest 做回滚演练；
- ADR-17 的内部标识迁移不在本次范围内。

## 接手全量门禁复核（2026-09-30）

基线是 `0ec5e55209d4cc3f1839336b38c86ab85d675b4b` 之后的未提交工作树，
不是上文 `076681d` 的发布。没有以此覆盖历史结果。

- `core/verify/run-integration.sh` 退出 0：本轮 35 个测试 namespace 清理完成，
  前后 namespace 集合相等；恢复后的 Core 独立健康检查为 HTTP 200。
  平台私钥 7/7、归位 6/6、Web transport 11/11，详见同日
  `native-identity.md`、`secret-ref.md`、`secret-ref-rehome.md`。
- `tools/check.sh --full` 第一次退出 **1**，不是全绿。
  使用独立的一次性 Postgres 容器，不复用本地 Core 数据库；
  主检查 cgroup 上限为内存 8 GiB、CPU 400%，Postgres 为内存 2 GiB、CPU 1。
  退出 trap 已移除本次创建的容器，没有删除本地数据库或其他容器。
- 格式/静态检查、四侧契约兼容、真实迁移前进/回退/再前进、SQLx 离线同步、
  35 个命名约束、四语言基础验证、Workflow replay、供应链、上游 seam、
  安全不变式与 runbook 同步均通过。供应链内置扫描无命中；本机未安装 gitleaks。
- 失败在追溯步骤：13 条记录的 Web digest 与 `web-client/fork/upstream.yaml`
  不一致，其中两条同时存在 Desktop digest 不一致。能力注册表四项拒绝条件通过，
  不能抵消产物追溯失败。
- 原始输出：`/volumes/data/kailo/tmp/codex-full-gate-20260930.log`。

核对现有 Web 镜像及 Desktop 文件摘要后，仅同步 13 份追溯 YAML 的产物摘要，
没有修改能力状态、注册门禁或业务入口。第二次 `tools/check.sh --full` 的追溯步骤通过，
但初始化配置预检失败，命令退出 **1**：执行包装层以 `set -a` 导出了本地 `.env`，
预检子进程继承了 `PLATFORM_ADMIN_USER`；因此临时配置删除该字段时，
`bootstrap.sh` 仍取得父进程的值，缺字段用例没有得到预期拒绝。
原始输出：`/volumes/data/kailo/tmp/codex-full-recheck-20260930.log`。

对已有检查的定向复跑确认了环境差异，没有新建夹具或修改产品逻辑：

```bash
# 从 apps/ 执行；两条命令分别在子 shell 中运行，不改变调用者环境。
( unset PLATFORM_ADMIN_USER; ./tools/check.sh security )
# 退出 0。
( set -a; . deploy/local/.env; set +a; ./tools/check.sh security )
# 退出 1，缺 PLATFORM_ADMIN_USER 的预检用例未拒绝。
```

第三次全量执行不批量导出部署配置，并显式取消 `PLATFORM_ADMIN_USER` 的导出；
仍使用独立的一次性 Postgres、同样的 cgroup 限额与入库 SQLx 离线数据。
`tools/check.sh --full` 退出 **0**，十项全部实际运行：35 个命名约束、
四侧生成与兼容、迁移前进/回退/再前进、基础验证、replay、文档、
14 条能力追溯、18 个 Workflow kind、供应链、接缝与安全不变式均通过。
原始输出：`/volumes/data/kailo/tmp/codex-full-cleanenv-20260930.log`。
本次 Postgres 容器已移除；本机未安装 gitleaks，Mobile 发布签名仍被明确阻断。

上述通过没有消除预检的父环境继承限制，也不是新的发布证明。
`tools/check.sh` 与 `deploy/local/bootstrap.sh` 本轮未修改；
Stage 1/2 的未闭合验收项及安装包边界保持原判定。

GitNexus 索引重建退出 0，但报告 FTS 索引未建成；随后 impact 的目标名与目标路径
出现错配，按文件限定的同一目标返回 `UNKNOWN`；CLI 与 MCP 的变更分析也不一致。
这些结果不能证明改动风险低或没有调用者。当前没有据此提交整个未提交代码批次；
没有把该工具故障登记为产品的新需求或源码能力 GAP。

文档同步后的 MCP `detect_changes(scope=all, repo=kailo-plus)` 报告
151 个变更文件、52 个变更符号、108 条受影响流程，风险为 **CRITICAL**。
这是整个已有未提交批次的报告，不是仅对本轮文档改动的评判；
不以门禁通过豁免该风险，也不将它解释为目标解析错配已经修复。

## 影响分析门禁故障复核（2026-09-30）

本节只记录开发工具故障，不新增产品需求、能力或设计 GAP。
GitNexus 使用本机已有的 `1.6.12` 分发版、LadybugDB `0.18.3` 和 Node
`v24.15.0`；未修改工具源码，也未在 `.references` 运行或构建任何项目。

### 查询访问路径不一致

目标仓库明确为 `kailo-plus`（`/volumes/kailo`），旧索引仍位于
`/volumes/data/kailo/gitnexus-rebuild.RtvZfE`，更新时间为
`2026-09-30T04:57:15.716Z`，HEAD 为
`0ec5e55209d4cc3f1839336b38c86ab85d675b4b`。现有 `cypher` 工具可复核：

```cypher
MATCH (f:Function)
WHERE f.name = 'fence_and_destroy_with'
RETURN id(f), f.id, f.name, f.filePath, f.startLine;

MATCH (f:Function {
  id: 'Function:apps/core/crates/platform-core/src/platform_keys.rs:fence_and_destroy_with'
})
RETURN id(f), f.id, f.name, f.filePath, f.startLine;
```

两条查询返回相同内部节点 `{offset:104129,table:2}`，但前者的 id/filePath
指向 Codex 的 `thread-store/src/local/rollout_migration.rs`，后者正确指向
`platform_keys.rs` 的该函数；两者的 name 与 startLine=400 相同。
按 name 过滤后的数据库内聚合显示总数 1、id 等于真实 UID 的数量 0，
而同时按 name 与真实 id 过滤为 1。这不是仅在 Markdown 显示时发生的错配。

独立只读复核还确认：带 `Function` 标签的主键查询走主键扫描，按 name
及无标签 id 的查询走表扫描；现有 `context(uid=真实UID)` 实际返回 not found。
两个真实调用边以双端主键锚定分别能计数为 1，单端扩展时邻居的 id/filePath
却为空。因此不能用 UID 接口或“存在调用边”绕过失真的属性读取。
入库前缓存的涉及节点正确，原始 Function CSV 已不保留；尚不能据此把根因
断定为 CSV 字段错位、持久逻辑行损坏或某个 native 缓存实现错误。

### 上游修复包的只读差分核验

查询错配已在两个独立新进程中复现和消除，不依赖常驻 MCP 的状态。
使用官方 npm 预编译包 `@ladybugdb/core-linux-x64@0.19.0`，隔离存放在
`/volumes/data/kailo/ladybug-readonly.5zPfo2`；未修改全局 GitNexus 分发版。
两个进程均以 `Database(indexPath, 536870912, true, true)` 只读打开同一个旧索引，
单查询线程、512 MiB Node heap、2 GiB/100% cgroup，执行下列五类原有查询：

| 查询 | 0.18.3 实际结果 | 0.19.0 实际结果 |
| --- | --- | --- |
| 按 `fence_and_destroy_with` 名称查属性 | id/filePath 错指 Codex rollout | 正确指向 `platform_keys.rs` |
| 同一目标的 Function 主键查属性 | 正确 | 正确，内部 offset 与名称查询一致 |
| 按 `useFailureText` 名称查属性 | id/filePath 错指 Codex MCP status | 正确指向 TS `react/context.tsx` |
| 无标签、按真实 UID 查目标 | 空结果 | 返回正确目标 |
| 从真实目标扩展两个 CALLS 邻居 | 邻居 id/filePath 为空 | 正确返回 `fence_and_destroy_intent` 与 `freeze_operator_write` |

原始输出为 `codex-ladybug-read-018-20260930.log` 与
`codex-ladybug-read-019-20260930.log`，位于 `/volumes/data/kailo/tmp/`，
两个命令均退出 0。旧索引文件的大小 `1306558464` 与 mtime
`2026-09-30 04:57:17.856562510 +0000` 前后相同。
两版本报告的 storageVersion 分别为 42 与 43；0.19.0 实际只读打开成功，
不据此声明反向写入兼容。

上游 [PR #737](https://github.com/LadybugDB/ladybug/pull/737) 修正跨持久段的
filtered string scan 选择位置边界，并纳入
[0.19.0 发布](https://github.com/LadybugDB/ladybug/releases/tag/v0.19.0)。
发布同时包含其他查询修复；本次证明的是完整 0.19.0 包消除了上述错配，
没有单独隔离某个 commit，因此不把全部症状唯一归因于 #737。

查询读取修复不等于编辑门禁通过：旧索引未包含当前完整 PDG 和文档增量。
官方 GitNexus 1.6.12 的依赖仍固定 0.18.3，后续隔离 CLI 使用 0.19.0 属于本机
工具依赖覆盖，不能声明为 GitNexus 官方已完成该版本组合的支持。
仍需完整重建、当前 receipt、准确目标解析和完整影响分析；不沿用旧图作风险豁免。

### 完整 PDG 重建结果

七次均使用现有分析器、默认完整源范围、外部缓存和 12 GiB/400% cgroup；
未排除业务代码以制造成功，也未停止其他 K8S 或虚拟机负载。
原始日志都在 `/volumes/data/kailo/tmp/`：

| 次数 | 日志名 | 关键配置与实际结果 |
| --- | --- | --- |
| 1 | `codex-gitnexus-full-20260930.log` | 默认 worker；13 分 4 秒，12 GiB OOM |
| 2 | `codex-gitnexus-retry-20260930.log` | 4 worker、512 MiB native pool；11 分 7 秒，12 GiB OOM |
| 3 | `codex-gitnexus-stream-20260930.log` | 流式 PDG、单 parse chunk、6 GiB Node heap、512 MiB pool；13 分 14 秒，峰值 10.4 GiB，File COPY 的 buffer pool 耗尽，退出 1，不是 OOM |
| 4 | `codex-gitnexus-stream-pool-20260930.log` | 同第 3 次但 pool 为 2 GiB；15 分 14 秒，12 GiB OOM |
| 5 | `codex-gitnexus-stream-one-20260930.log` | 同第 4 次但解析 worker 为 1；19 分 45 秒，12 GiB OOM |
| 6 | `codex-gitnexus-native-full-20260930.log` | 隔离 CLI 使用官方 LadybugDB 0.19.0；未显式设 Node heap，主进程实测上限约 2 GiB，11 分 5 秒后 JS heap OOM/ABRT，峰值 3.5 GiB；不是 cgroup OOM |
| 7 | `codex-gitnexus-native-heap4-20260930.log` | 同隔离 CLI、Node heap 4 GiB、单解析 worker、2 GiB pool、full 保留与流式 PDG；29 分 8 秒，峰值 10.0 GiB，退出 0 |

低正文保留模式会关闭该分发版的流式 PDG，因此第 5 次仍为 full 保留；
没有把低保留模式记成已经使用。日志中的 715 条流程还明确报告了入口、
分支和深度截断，不能把图中没有某流程解释为源码没有该路径。

前六次没有发布新索引。第 7 次实际发布到
`/volumes/data/kailo/gitnexus-stream.0eOxnY`：974802 nodes、2222576 edges、
8817 clusters、715 flows；commit 为 `0ec5e55209d4cc3f1839336b38c86ab85d675b4b`。
完整 PDG 已登记，graph 与 FTS 均 available，runner receipt 为 schema 4，
依赖 canonicalization 为 `gitnexus-analyzer-dependency-runtime-v4`。
它仍有上述流程截断，不能据此证明某条业务路径不存在。

新鲜度复核没有被索引退出 0 代替：同一隔离 CLI 的 `status --json` 先报告一个
新增路径 `apps/collaboration/mobile/ios/BuzzPushKit/Tests/BuzzPushKitTests/Fixtures`。
只读 `git ls-tree`、`readlink -f` 与 `stat -L` 证明它是有效的目录符号链接，真实
目标为 `apps/collaboration/crates/buzz-push-gateway/tests/vectors/`；不是缺失源码。
该 CLI 的 `walkRepositoryPaths` 把别名列为 file，后续读取目录失败而未登记
`fileHashes`，所以反复产生 added。仓库 `.gitnexusignore` 只排除这一个目录别名，
真实目标及其文件仍在原完整扫描范围，没有排除业务代码或新建夹具。

随后同一 CLI 的状态已无该 added，但报告原先未跟踪的 `交接文档.md` 已删除；
本轮只读 `stat` 也确认它已不在原路径。未恢复、覆盖或删除该外部整理内容。
一次未显式设 heap 的非 force 刷新仍重新执行全树 scope resolution，因此在进入
新索引写入前主动终止本轮自己的 PID，工具 session 55192 实际退出 143；
未把该刷新记为成功，也未停止其他服务。已发布索引的 commit/indexedAt 未改变，
后续文档写入仍须统一刷新后再进行函数影响分析与提交门禁。

新 MCP CLI session 17883 的 `resources/read` 已读到上述新 storage 与相同 receipt、
`incomplete_reasons=[]`；原常驻 MCP 会话仍缓存旧 registry，不能混用它的旧图结论。
`secret-ref-rehome.md` 记录的退休事务缺陷没有在本节被修复。
本节只登记实际工具恢复与新鲜度缺口，不计为产品能力交付，也不证明已提交或 push。

### 自动资源配置刷新与编辑前复核

第 8 次非 force 刷新仍使用 4 GiB heap，在全树 scope resolution 后发生
JS heap OOM/ABRT，退出 1；未发布新索引，也不是 cgroup OOM。日志为
`codex-gitnexus-refresh-heap4-20260930.log`。

第 9 次使用同一隔离 CLI、完整范围、`--force --index-only --pdg`，保留 full
正文和流式 PDG；取消手工 heap、worker、parse chunk 与 native pool 覆写，由工具
自动选择。检查当时主机 CPU/内存及已有构建后，仅为本次分析进程使用 cgroup；
未停止其他负载。其初始内存限额为 12 GiB，依据运行压力调整本次 unit 为
16 GiB，CPUWeight=50、无 CPU quota。分析器用时 918.1 秒，unit 用时
16 分 24.519 秒，峰值 11.8 GiB，退出 0。
日志为 `codex-gitnexus-autoresource-20260930.log`；没有把工具耗时计为产品完成度。

本次发布 974777 nodes、2222552 edges、8817 clusters、715 flows；索引时间为
2026-09-30 10:03:16.226 UTC，HEAD 仍为完整
`0ec5e55209d4cc3f1839336b38c86ab85d675b4b`。同一 CLI 的 `status --json`
与新 stdio MCP 的 typed resource 在源码编辑前逐项匹配 runner identity，
状态 up-to-date、schema 4/current、`incomplete_reasons=[]`。
随后批量取得 21 个编辑目标的 upstream impact：Workspace 准入及 scope、
NativeBootstrap 的 StepView 为 HIGH，已在编辑前报告；零结果或 UNKNOWN 的
回调、常量和路由另经文本核对，没有把 UNKNOWN 当作低风险。
本次生产源码写入后图已不再新鲜，该 receipt 不替代最终图门禁。

### 三项已有合同修复后的初检

本轮没有新增需求、Workflow、配置上限、领域状态或核验 fixture。
按既有 DD-85/113/115 修正旧 ref 退役归属与销毁顺序；按 `03` HUMAN scope
合同统一列表、Relay 准入、用户状态和 stream 再准入；按 REQ-08、DD-36/53
复用三端主题 key 并停止把原始异常正文渲染到原生引导页。

- TS platform 和 Desktop typecheck、Dart client-kit analyze、既有 i18n
  生成同步检查均退出 0；共享 platform 既有测试为 86 通过、2 失败。
  两条失败仍要求显示底层错误原文，测试未被删除、放宽或伪装成通过。
- Mobile 固定 Flutter 检查在 Hermit 锁获取失败；现有 Dart 的补充分析因
  objective_c 插件要求 native-assets 退出 4，不能据此声明 Mobile 分析通过。
- 首次 Core cgroup 命令落到系统 Cargo 1.75，读取 lock v4 即退出 101。
  未改 lock 或降级工具链；显式使用当前 Rustup Cargo 1.95 后继续检查。
- `cargo clippy --all-targets -- -D warnings` 在新
  `web_transport::workspace_admissions` 的匿名五字段 tuple 触发
  `type_complexity`，退出 101。它不是编译通过；未添加 lint 忽略。
  原始输出为 `codex-core-review-rustup-20260930.log`。

以上是实现后的检查结果，不是本修复的运行终态、发布证明或 Stage 关闭。
尚未在本修复上完成全量门禁、最终图变化分析、提交或 push。

### 第二轮独立复核与有界纠偏

第 10 次完整范围刷新复用同一 CLI、full 正文保留、流式 PDG 与自动资源配置，
仍只限制本次 cgroup（16 GiB、CPUWeight=50）。分析器用时 894.2 秒，unit 用时
15 分 43.129 秒、峰值 14.2 GiB，退出 0；日志为
`codex-gitnexus-corrections-20260930.log`。发布 974864 nodes、2222885 edges、
8815 clusters、717 flows，索引时间为 2026-09-30 10:46:15.657 UTC。
它不构成产品能力进展，也不消除工具报告的流程覆盖边界。

编辑前，同一 CLI 状态和新 stdio MCP 的完整 runner receipt 再次匹配：
HEAD 为 `0ec5e55209d4cc3f1839336b38c86ab85d675b4b`，up-to-date、
contentDrift current、schema 4/current、incomplete reasons 为空。
七个密钥链符号、Workspace 查询、已读路由及现有引导检查文件的影响分析
记录在 `codex-corrections-impact-20260930.log`。共享销毁函数为 CRITICAL，
Workspace 查询为 HIGH，已先报告；UNKNOWN 的路由与检查文件经实际注册点
和现有包脚本确认，不以零调用者宣称安全。后续 StepView 的 fresh impact
也为 HIGH，直接调用方为 NativeBootstrap。

独立复核还发现归位目标的切换与销毁可交错：普通引用查询看不到未提交的新
binding，销毁先完成，切换再提交。因此旧 ref 退休归属修复不能被当作目标
并发安全证明。目标的写前意图、持久 fence 与 OPEN 到 BOUND 原子提交必须
共同遵守已有 DD-85/86/113；没有执行真实销毁来复现这个源码顺序反例。

两项已完成的有界纠偏：

- Workspace 匿名五字段 tuple 已改成私有 SQL 查询投影，SQL 列名显式 alias；
  JOIN、WHERE、bind 与资格规则未改。两文件 rustfmt 与 diff check 退出 0，
  当时尚未完整复跑 Clippy；下节全量门禁已实际通过该项。
- 原生引导的两条既有断言改用共享译文，明确禁止原始异常正文上屏；原 throw、
  输入与重试路径均保留，没有新建 fixture。共享平台类型检查、生成同步检查
  退出 0，7 个文件的 88 条既有检查全部通过；负向破坏与还原尚未执行。

设计的独立复核纠正了 DD-113 的 HUMAN locator、历史 REVOKED 引用保护与
实施阶段措辞，未引入新换钥动作。事件级用户状态可见性与 stream 的权限及
暂停恢复 generation 合同仍有未闭合项，不能由 Workspace 资格统一推导为已解决。
本轮尚无提交、push、部署或新的生产就绪声明。

### 源码纠偏后的全量门禁

2026-09-30，在 `/volumes/kailo/apps` 调用既有完整入口：

```sh
./tools/check.sh --full
```

外层为本次 `kailo-codex-source-corrections-full-20260930.service`，以 ubuntu
身份及 docker supplementary group 运行，cgroup 为 MemoryMax=8G、CPUWeight=50、
LimitCORE=0。包装使用 Compose core-db 的固定镜像，创建带本次随机名称与 label
的新 Postgres（memory=2g、cpus=1），等待 `pg_isready`，没有使用在线 Core 数据库。
部署环境只以 shell 局部方式加载、未 `set -a`；明确 unset `PLATFORM_ADMIN_USER`
与 `PLATFORM_INTEGRATION`，仅为本次隔离库派生 `DATABASE_URL`，启用
`SQLX_OFFLINE=true`，缓存、target 与 tmp 位于 data。退出 trap 只清理本次容器。

完整日志为 `/volumes/data/kailo/tmp/codex-source-corrections-full-20260930.log`。
unit 用时 6 分 30.968 秒，退出 1；CPU 时间 2 分 2.695 秒，峰值内存 989.0 MiB，
swap 峰值 0。实际结果如下，不以历史的全绿记录覆盖本轮失败：

| 步骤 | 实际结果与证据边界 |
|---|---|
| 1/10 格式与静态检查 | PASS：cargo fmt、Core cargo clippy、gofmt、go vet、TS typecheck、client-kit Dart analyze；不包含 Mobile Flutter 分析通过声明 |
| 2/10 受影响范围验证 | PASS：cargo test、go test、TS 包测试、client-kit Dart test；`PLATFORM_INTEGRATION` 未启用，不构成本修复真实服务集成运行证明 |
| 3/10 contract compatibility | FAIL：Dart/Rust/TS/Go 四侧生成均被共享 npm 缓存 EACCES/EEXIST 阻断，不能据此认定已完成生成对比；既有 platform/reason i18n 同步检查通过，相对 contracts-v0.1.0 的 90 个 schema 兼容检查通过 |
| 4/10 迁移演练 | PASS：新隔离 Postgres 前进、回退、再前进，sqlx 离线数据与迁移后的库和查询同步，35 个命名约束逐值相等；不证明生产存量数据回退 |
| 5/10 Workflow replay | PASS：现有 replay 回归，不替代升级后 Worker 镜像的在途 history 演练 |
| 6/10 追溯 | PASS：文档六项、14 条追溯的七条硬规则、能力注册表及四个构建期拒绝条件 |
| 7/10 供应链 | PASS：内置扫描无命中（未安装 gitleaks）；18 个已登记产物的 SBOM/provenance/commit/锁摘要一致，不证明当前未提交源码已生成新产物 |
| 8/10 上游 seam diff | FAIL：当前 Web/Desktop source_digest 与登记产物不一致；Mobile release 缺 upload keystore 仍为阻断，不记为 PASS |
| 9/10 安全不变式 | PASS：部署/宿主配置检查、24 个服务的网络与镜像等边界、SpiceDB schema 与设计逐字一致；不替代本轮源码修复的运行及负向验收 |
| 10/10 文档/runbook/release note | PASS：既有 runbook 逐项齐全、章节与演练记录检查 |

8/10 的原始 source_digest 对比为：

- Desktop 登记 `sha256:825aaf6a85b1976b827272ec7dcbc7b6372560ece3a7dd5e4a60d7de70ec44b6`，当前源码 `sha256:708059e4f858a3a21615e6006059d7500fae2d3fdb291056831a465f9ff33301`。
- Web 登记 `sha256:eded9400f6d7065683e251f059aa55992a21c2cf8f06b101ca6e3bbc8efe71fe`，当前源码 `sha256:b97f08c7749355cf3aaaff1ae9fa72011c08023f84dc5a4d948b6f37f3c09b2c`。

二次源码复核的归位目标写前意图、持久 fence 共享链修复已写入源码，未取得
本修复的真实服务运行验收；旧 ref 归属修复与该目标并发修复不能借历史 6/6
结果判定已验收。原生引导 7 个文件的 88 条既有检查已通过，负向破坏与完全
还原尚未执行。此前 Mobile 分析失败及 release 签名阻断仍保留。
本轮没有执行产物重建、提交、push 或部署，不登记新发布、不关闭 Stage。

### 首写 CAS、生命周期 generation 与终端拒绝修复

2026-09-30 继续修复已存在的合同缺陷，不引入新需求、状态、Workflow、接口、配置上限
或测试夹具代码。权威为 `DD-40` 的 CollaborationUserState CAS、`DD-41/46` 的
scope 生命周期及 `06-工程基线规范.md` §4 的 `DENIED`、`CONFLICT` 分类。

- `user_state.rs::upsert`：首次创建只接受 expectedVersion=0；唯一键冲突返回 409，
  不把不存在记录上的非零版本当作成功。已有记录仍是 SQL 原子版本条件更新。
- `web_transport.rs` 与 `stream.rs`：私有准入投影读取同一 SQL 快照的 Tenant 与
  Workspace version，并加入既有 generation；管理身份重连始终取完整 snapshot，
  不用相同管理角色元组断言未发生撤权再授权。原准入、未知值拒绝与 binding guard 保留。
- Web 的 `openStream` 与 `useChannelStream`：明确的 session/scope/identity revoked
  在回调前取消重开 timer 并关闭源，旧源回调被拒；当前聊天清空，复用既有 reason 译文。
  传输失败仍是结果不明，不改成撤权。浏览器 EventSource 的初始 HTTP 拒绝与传输故障
  无法由该接口区分，本轮没有改变服务端 HTTP 合同或宣称这一边界已解决。

编辑前 fresh GitNexus receipt 与完整目标影响记录在
`codex-product-targets-20260930.log`。共享 `workspace_admissions` 为 HIGH，4 个直接
调用方涉及列表、用户状态和 stream 准入，已先报告；UNKNOWN 的 enum、SQL 映射和路由
经文本注册点补核，不把零调用者视为无影响。私有字段由准入查询写、generation 读，
外部 API、数据库 schema、Workflow history 均不改变；旧 generation 不匹配时重取
snapshot，无旧数据迁移或双读权威。三端管理面仍统一经 BFF，未改原生持钥模式。

Core 三文件独立源码复核通过，但没有并发/故障注入的运行证明。
实现后的 `./tools/check.sh lint` 与 `./tools/check.sh verify` 在受限 cgroup 退出 0，
2 分 18.958 秒，日志为 `/volumes/data/kailo/tmp/codex-cas-stream-checks-20260930.log`。
包含 Core fmt/Clippy、Go、TS、client-kit Dart 静态检查及既有基础测试；
`PLATFORM_INTEGRATION` 未启用，不称为真实服务集成回归。
Web typecheck、4 文件的 14 条既有测试与两目标文件的 Biome 检查通过；Web 全包
`npm run check` 仍因现有 Caddy 模板占位符与 i18n 格式出现 11 条错误并退出 1，
未删除检查、放宽规则或改动无关文件。

现有 `start-core.sh` 构建与部署退出 0、6 分 14.760 秒，使用已受限的 data builder；
先构建、再取得一次性 wrapping 凭据，不原样 restart Core。
日志为 `/volumes/data/kailo/tmp/codex-cas-stream-core-20260930.log`。
Web 新镜像构建、配置失败与重跑、部署、20 场景走查及退出清理的实际记录见
`web-client/fork/verify/web-surface.md`「CAS 与订阅修复后的当前镜像复验」。
独立健康探测为 200。新 Web digest 为 `9f5e4b48…`；Linux Desktop 包实际构建的
digest 为 `d4b4de04…`、source_digest 为 `708059e4…`，只有构建证明，没有新安装验收。
Compose 和 13 份 Web、2 份 Desktop 追溯摘要同步，不提高能力状态。

当前五个整文件相对 HEAD 包含 CC 前置改动，不能直接作为独立提交：Core 的连接池、
limits API 又依赖私钥引导及迁移链。独立只读依赖复核不建议把约 178 个 dirty 路径
盲目全部 stage，也不把当前工作树通过当作选定提交树通过。
本节不登记新 commit、push 或正式服务端发布 provenance，Stage 1/2 保持未关闭。

### 当前产物匹配后的全量门禁与独立复核

2026-09-30，当前 Web/Desktop 产物及追溯摘要同步后，现有
`./tools/check.sh --full` 在受限 cgroup 与独立一次性 Postgres 中退出 0，
用时 3 分 18.804 秒。完整日志为
`/volumes/data/kailo/tmp/codex-cas-stream-full-20260930.log`，unit 为
`kailo-codex-cas-stream-full-20260930`。临时数据库由本轮 wrapper 创建并清理，
没有使用在线 Core 数据库；`PLATFORM_INTEGRATION` 未启用。

十项全部实际运行：格式/静态检查、四语言基础测试、四侧契约生成与 90 schema
兼容、迁移前进/回退/再前进及 35 个枚举约束、Workflow replay、文档与 14 条追溯、
18 个已有发布产物的供应链登记、5 份上游来源与 4 个当前构建产物匹配、24 个服务的
配置与安全不变式、runbook。Mobile release 的 upload keystore 缺失仍以阻断记录，
没有被解释为 Mobile 发布通过。供应链登记对应历史产物，不证明当前未提交 Core
已取得新发布 provenance。

随后两轴只读复核发现当前门禁未覆盖的确定缺陷，不能用退出 0 抵消：

- **规范轴**：`20260930120000_platform_key_retirement` 立即给 `key_kind/origin`
  加非空约束，给 binding 加 ref/status 成对约束；`20260930130000_intent_action_scope`
  删除全表 action 唯一约束。仍运行的 `0ec5e552` Core 的 intent/binding INSERT 与
  `ON CONFLICT(action_execution_id)` 不兼容。违反 `AGENTS.md` 规则 14 与
  `06-工程基线规范.md` §5 的迁移兼容窗口；空白库 up/down/up 不覆盖旧 writer。
- **要求轴**：`platform_keys.rs::retire_unrecorded_operator_keys` 首次补建意图后，
  destroy 或 metadata 失败时保留该意图；后续 LIST 因意图已存在跳过它。
  `governance_reconcile.rs` 的退役选取只包含 HUMAN，已补建的 OPERATOR 无补做路径，
  不满足 `DD-113/115` 的结果不明保持与恢复后收敛。

这是既有迁移、退役合同的实现缺陷，不新增功能、期限、开关、规格或测试夹具。
当前批次不判定为生产就绪；修正后须重新取得对应证据。

### 退休续做、媒体漂移准入与用户状态读取的源码修正

2026-09-30，本轮只落实三个已有合同的修正，未新增 schema、实体、Workflow、配置或
核验 fixture。权威分别为 `DD-113 (6)`、`DD-115 (2)(6)` 的退役引用保护与原 operation
续做，`DD-114 (1)(2)` 的 BFF 运行期 NIP-11 查证，以及 `.design/03` 第 121 行与
`DD-40` 的 CollaborationUserState 可见性、保留历史和版本合同。

- `platform_keys.rs::retire_bound_key` 在外部 delete/destroy 前检查在用引用；非 REVOKED
  binding 或 identity 仍引用该 locator 时保持原状，REVOKED 历史引用不阻断退役。
  `retire_unrecorded_operator_keys` 对同 Catalog 的 OPERATOR/BACKFILLED/BOUND、未退休且
  已冻结退役 operation 的行继续原退役链；首次 INSERT 竞争失败即跳过，不覆盖胜者或
  原退休归属。上一节的 OPERATOR 补建后无续做缺口已在源码修正，尚无本修复运行终态。
- `web_transport.rs::upload_media/fetch_media` 在向 Relay 发出媒体请求之前复用既有
  `relay_limits`，要求当前 NIP-11 与 ACTIVE binding 快照一致。缺快照、不可读或摘要
  不匹配均拒绝该次请求；BFF 不迁移 binding 状态，没有新增媒体大小或协议上限。
- `user_state.rs::get_user_state` 按当前同 Tenant 的 Workspace 资格过滤偏好与 Channel
  已读位置。读取不删除库中历史、不建空行、不改变原 `row.version`；撤权时隐藏的状态
  保留供恢复成员关系后继续使用，原 expectedVersion 写入 CAS 不变。msg/thread 的
  pass-through 权限仍未闭合，不能把 Workspace/Channel 过滤判为完整修复。

影响面为共享 `retire_bound_key` 的五个直接调用方：`revoke_member_keys`、
`retire_superseded_operator_keys`、`reconcile_retirement`、`retire_unrecorded_operator_keys`
与 `retire_server_human_key`，涉及成员撤权、身份投影、引导和治理对账。媒体两个 handler
仍由既有 BFF route 注册；用户状态 GET 保留同一全局状态版本及历史，未改变响应 schema。
编辑前影响记录为 `/volumes/data/kailo/tmp/codex-three-defects-impact-20260930.log`；
共享退役为 CRITICAL，已先告知；媒体 handler 的 UNKNOWN 已按 BFF 注册点文本补核，
不把零调用边作为安全结论。

按 `06-工程基线规范.md` §4，适用边界如下；这不是新增错误分类或响应合同：

| 错误类 | 本轮适用与边界 |
|---|---|
| DENIED | 原 session、scope、identity 准入拒绝保留；用户状态隐藏不可见 Workspace/Channel，不由此证明 msg/thread 授权已闭合。 |
| BLOCKED | 本轮无新增 BLOCKED 分支。2026-09-30 用户确认只交付全新开发环境，120000/130000 的旧 writer 兼容无适用对象，不再列为当前开发或发布阻断；参见 `06-工程基线规范.md` §5。 |
| PRECONDITION | 媒体的 binding/NIP-11 缺失、不可读或漂移沿既有 503 错误体拒绝；用户状态 SQL、映射或授权不可判定不返回未经查证的 Workspace/Channel 数据。 |
| LIMIT | 既有媒体上传大小拒绝保留；本轮未新增上限，也未将 NIP-11 漂移归为 LIMIT。 |
| CONFLICT | 补建 INSERT 输掉唯一键竞争即跳过，不替胜者决定退役；用户状态仍使用原 expectedVersion CAS 与版本冲突判据。 |
| UNKNOWN | delete/destroy 或 metadata 查证不明时保留意图与原 operation，不记 RETIRED；媒体请求发出后的结果不明仍沿原失败路径，本轮不提供回滚或 exactly-once 证明。 |

根代理在本批真实服务集成核验启动前完成以下检查，均退出 0：

```sh
# /volumes/kailo
rustfmt --check --edition 2021 apps/core/crates/platform-core/src/{platform_keys,user_state,web_transport}.rs
# /volumes/kailo/apps/core；本次 cgroup MemoryMax=8G、CPUQuota=400%
SQLX_OFFLINE=true cargo clippy -p platform-core --all-targets -- -D warnings
# /volumes/kailo/apps；Node 24，缓存与临时目录位于 /volumes/data
bash tools/check-docs.sh
# 既有 Compose 启动入口；BuildKit 限制为 16 GiB、4 核
BUILDX_BUILDER=kailo-core-data bash deploy/local/start-core.sh
```

Clippy 的 `Finished dev` 为 38.29 秒，service 为 38.382 秒；原始日志为
`/volumes/data/kailo/tmp/codex-scope-retirement-clippy-20260930.log`。rustfmt 没有独立日志。
文档门禁原始日志为
`/volumes/data/kailo/tmp/codex-scope-retirement-docs-run-20260930.log`：270 个引用闭合，
86 个实体、115 条 DD、27 条 SS，87 个 V-SCN 中 86 项映射、1 项排除，两侧 Markdown
均为 0 issues。首次 systemd 相对路径启动失败，没有据此登记检查通过。

本机 Compose 构建与启动耗时 5 分 40.521 秒，退出 0；Core 容器于
`2026-09-30T15:06:52.503511816Z` 启动，`/healthz` 返回 HTTP 200。镜像为
`sha256:47e187317c01a81ef0aa251b8a0632edc5fb7ef1cde21662ca2591f21a865b36`，日志为
`/volumes/data/kailo/tmp/codex-retirement-media-core-20260930.log`。它来自当前未提交
工作树，不是已发布 commit 的正式产物；运行入口先构建、再获取新的 wrapping 凭据，
没有复用已消费的启动凭据。仅凭启动与健康响应不判定业务验收通过。

本轮现有 `core/verify/run-integration.sh` 已执行一次，退出 1，耗时 6 分 3.364 秒，
cgroup 峰值 3.9 GiB、无 swap。Rust 22 批累计 79 passed、5 failed、3 ignored；
`secret_ref_rehome` 组为 1 passed、5 failed，分别在 locator 查证返回 503、
副本查证失败、撤权时 503、`COPY_UNKNOWN` 未切换及 `COPIED` 未收敛处失败。
脚本按原有 fail-fast 终止，后续 `server_keys`、`web_transport` 与 Go 用例没有运行，
不能登记本轮媒体或退役链通过。原始日志为
`/volumes/data/kailo/tmp/codex-retirement-media-integration-20260930.log`。

既有 EXIT 流程清理了本轮 10 个无 Core 引用的 OpenBao namespace；另外 5 个失败
对象仍有 Core 引用，保留其 namespace 和登记以供查证，没有删除历史数据。
登记目录为 `/volumes/data/kailo/tmp/tmp.BuGiIYAy80`。Core 经既有 `start-core.sh`
重新获取启动凭据恢复，相同镜像于 `2026-09-30T15:17:33.077399655Z` 启动，
独立 `/healthz` 再次返回 HTTP 200。前后 namespace 集合因这 5 个保留项不同，
不把清理流程记为全部完成；未重跑或弱化断言，失败共同原因尚未确认。

以上批次结束时业务验收未通过，提交和 push 未完成；当时 msg/thread 权限、旧 writer
兼容假设与图门禁未收口，没有据此登记生产就绪或 Stage 关闭。当时 GitNexus 查询的
checkpoint in progress、`impactedCount=null` 与 `risk=UNKNOWN` 不作为通过结果。
2026-09-30 用户随后明确只交付全新开发环境，旧 writer 兼容无适用对象；当前门禁
与源码修正以本文件后续执行记录为准，不把历史失败描述为当前仍运行的故障。

## 全新环境与消息线程用户状态收口

2026-09-30，范围仍是 `DD-40` 与 `.design/03` §2 已定的用户状态可见性、
历史保留和版本合同，以及既有 Compose 初始化入口；没有新增实体、接口、配置、
业务上限、核验 fixture 或规格。先修改原实现，再扩充现有 `web_transport.rs`
的原检查分支，未新增测试函数或另建一条产品读写路径。

`user_state.rs::get_user_state/put_read_mark` 对 msg/thread 使用当前登录人的
ACTIVE HUMAN SERVER 身份查询 Relay，不借 CONTROL 或其他人的身份证明可见性。
现有 Workspace 准入、binding/NIP-11 上界与签名查证均保留；网络读取后重新准入，
不可见事件拒绝写入，读取时隐藏而不删除保存的历史或改变状态版本。thread 另要求
真实根事件，合法 NIP-10 reply 不能作为 thread key。源码对照为
Buzz@`779af8886caae1317b4de962082429867ab61503` 的
`buzz/crates/buzz-core/src/nip10.rs::parse_thread_markers_from_parts` 与
`ThreadMarkers::resolve`，以及
`buzz/crates/buzz-relay/src/handlers/ingest.rs::resolve_nip10_thread_meta`。

改动前使用 GitNexus 分析既有 handler 与 `readable_event_ids`；
Axum 注册 handler 的 UNKNOWN 结果以原 route 注册与读写调用点补核，不以零边证明
未使用。没有新增关系授权或事件正文权威，Core 不持久化这次查证的事件正文。
适用错误仍是既有六类：DENIED 对应不可见或撤权，PRECONDITION 对应依赖或 binding
不可查证，LIMIT 保留 Relay 的已定约束，CONFLICT 保留 expectedVersion CAS；
本变更无新增 BLOCKED 或外部写入 UNKNOWN 分支。原生 CLIENT-only 路径未由本次
SERVER 身份结果证明，不声明三端全部验收。

实际执行结果：

- 修正初始化的末段依赖启动后，再次运行既有
  `deploy/local/init-local.sh --fresh --confirm-delete=platform-local`：退出 0，
  9 分 57.115 秒；六个数据库卷重新建立，35 条迁移、两次 `COMPLETED` 引导及
  自动启动网关数据库通过，没有手动补齐。完整日志为
  `/volumes/data/kailo/tmp/codex-init-local-fixed-fresh-20260930.log`。
- 当前既有 `web_transport` 在真实服务上运行：11 passed、0 failed、0 ignored，
  用例执行 100.25 秒；含真实 msg/thread 写读、CAS、不存在事件拒绝、真实 reply
  不能作为 thread、撤权拒绝与 GET 隐藏但保留历史和版本。日志为
  `/volumes/data/kailo/tmp/codex-thread-web-integration-20260930.log`。
  本轮 namespace 集合前后相等，登记目录清理；退出恢复路径调用既有
  `start-core.sh`（其中有缓存构建步骤），恢复同一镜像后独立健康 HTTP 200，
  不写成无构建的恢复。
- 运行的 Core 镜像为
  `sha256:7a9832c9364b279234e527188a6454607b3da40ef26120ef36464ef91431d4d2`，
  来自未提交工作树，只是本地运行证据，不是发布 provenance。
- 随后的 `./tools/check.sh --full` 退出 1，5 分 30.092 秒；静态检查、四语言
  基础验证、迁移前进—回退一步—再前进与 35 个命名约束、90 schema 兼容、
  replay、安全及文档通过。
  失败是四侧生成使用的共享 npm 缓存 EACCES/EEXIST、13 份 Web 摘要未同步与
  Desktop 来源摘要变更未重建。没有据此声称全量门禁通过。
  日志为 `/volumes/data/kailo/tmp/codex-thread-full-20260930.log`；专用演练库
  `kailo_codex_thread_closeout_20260930_f2a134c9` 已独立查询为不存在（计数 0）。
  后续实际修正与复验另记，不能拿历史全量通过覆盖本次失败。

独立复核确认初始化的两行修改只依赖 HEAD 已有的六卷定义、网关数据库和
`service_healthy` 依赖，不依赖本批未提交 Core/schema 变更。图谱刷新两次失败
（首次终止、其次 V8 heap OOM）后，使用同一固定 runner、仅调整 cgroup 内的
JS heap 完成：实际退出 0，27 分 03.022 秒；未换引擎、未修改工具源码。
日志为 `/volumes/data/kailo/tmp/codex-closeout-preedit-heap8-20260930.log`。
随后完成改动前影响分析；隐藏的设计与 Trellis File 未被索引，明确保留 UNKNOWN
与文本补核，不把缺覆盖写为安全证明。

同批源码证据纠正 `SS-DSK-EDITOR-WINDOW` 与 `DD-104`：本地应用自定义命令的
隔离不能只由窗口 label 推导。固定 Tauri 的 remote ACL、仅 External 的许可导航
与不授予 editor remote capability 才是已登记的接缝约束；保留内建 channel-fetch
专用分支的范围限制。未启用 editor 窗口或扩大本批交付范围，DD/SS/场景计数不变。

同批 `AdmissionFailure::into_response` 的既有两分支改用现有 ErrorBody：
拒绝仍为 403，分类为 `DENIED/PERMISSION_DENIED`，依赖不可判定仍为 503，
分类为 `PRECONDITION/DEPENDENCY_UNAVAILABLE`；binding 分支不变。不存在与无权
仍同形拒绝，不引入资源存在性信息，不重构其他 BFF 错误链。
先修原方法，再修原 `admission_failures_are_classified` 的空回应断言；没有新测试或
fixture。首次错误地使用 `--lib`，退出 101、没有运行该用例；改为实际二进制 target
`cargo test -p platform-core --bin platform-core admission_failures_are_classified`
后退出 0：1 passed、0 failed、33 filtered，编译 42.43 秒，format 与 diff 检查通过。
日志为 `/volumes/data/kailo/tmp/codex-admission-bin-focused-20260930.log`。
本次聚焦结果不替代 11 项真实服务回归，后者发生在错误体修改之前。

共享生成物的说明文字变更也改变 Desktop 构建输入；不伪改产物来源以消除门禁。
以现有 `tools/build-upstream.sh desktop-client` 单次实际构建并登记，退出 0，
输入 source 为
`sha256:9e5478cb6a34ad514e8d060152a2758e63b013da9765072a2286cd67c225b6d3`，
`dist/desktop-client/Kailo_0.5.23_amd64.deb` 实存摘要与来源登记均为
`sha256:79d983b5acb0c1ec9ec3e20610eead5b8c6809bfd9d0dda24a74d5c5e61e0e40`。
日志为 `/volumes/data/kailo/tmp/codex-desktop-current-artifact-20260930-192627.log`；
BuildKit 保持 16 GiB、4 CPU 限制。13 份 Web 追溯及两处已有 Desktop 产物引用
按真实摘要同步，不改变能力状态、Core/Worker 历史摘要或安装包验收结论。

本批门禁包装第一次复跑仍退出 1：缓存与产物已匹配，但 systemd 包装没有把用户
Rust 工具目录放入 PATH，导致 sqlx-cli 不可见、Rust 检查及 Rust 生成物比对失败；
演练库退出清理计数为 0。日志为
`/volumes/data/kailo/tmp/codex-thread-final-full-20260930.log`。
随后只在仓库外的执行包装指定本机已安装的 Cargo/rustfmt/sqlx 路径，继续运行原有
`tools/check.sh --full`，没有改检查规则或产品代码来取得通过。

修正执行包装后的本批全量门禁实际退出 0，末行「全部通过」，专用演练库的退出
清理计数为 0；日志为
`/volumes/data/kailo/tmp/codex-thread-final-full-rustpath-20260930.log`。
格式/Clippy、四侧生成与基础测试、90 schema 兼容、迁移前进—回退一步—再前进、
35 个命名约束、replay、14 份追溯与产物来源匹配、安全与文档均通过。
未启用 `PLATFORM_INTEGRATION`，不能由此关闭历史归位五项失败、原生安装验收、
发布 provenance 或 Stage 1/2。检查有适用对象的范围以原日志为准。

独立初始化修复及 `07` 的六卷和实际演练说明已提交为 `0df35623` 并推送。
推送没有绕过原 `pre-push` 钩子：其 `check.sh --full` 实际退出 0，
3 分 5.276 秒，受限 cgroup 峰值 3.0 GiB、无 swap，专用演练库清理计数为 0。
日志为 `/volumes/data/kailo/tmp/codex-init-closeout-push-20260930.log`；
远端 main 核对为 `0df3562362739f8b4e6fc1406215fb30de61b7ed`。
该提交只有初始化入口与 `07` 的选定事实说明，不含本段其他 Core、客户端、
契约、设计或产物来源增量。钩子验证的是当时工作树，不能写成这些未提交功能
已随本次推送交付，也不据此关闭 Stage 1/2。

## 共享主题与协作界面呈现增量

2026-09-30，本增量只收口 `REQ-08`、`DD-53` 与 `V-SCN-45` 已定的呈现合同：
Web ThemeProvider 使用 kit 已有的三种主题模式；Desktop 搜索与草稿时间调用现有
共享日期函数；侧栏 Relay 连接提示的九条文案进入 TypeScript 单一目录，Dart 由
既有生成器投影。没有新增设置、locale、实体、路由、业务上限或测试夹具。
主题存储键、系统配色订阅、查询与排序、draft 行为、连接状态及按钮回调均保留。
本批无 schema/API/Workflow 或数据库兼容变更，亦无外部副作用与业务终态变更；
六类业务错误保持原合同，非法日期仍由共享呈现的不可用文案处理，不另立错误码。

编辑前图谱的共享 i18n File 为 HIGH（21 个直接导入、105 个上游节点），草稿时间
函数亦为 HIGH，影响详情/列表至 HomeView；已明确提示风险并读出直接消费者。
Const 的 UNKNOWN 以生成器、类型与实际读取补核，不把零边视作未使用。
日志为 `/volumes/data/kailo/tmp/codex-theme-preedit-gates-20260930.log`。

实际验证：Web typecheck、单文件格式与现有 14 项测试退出 0；Desktop 两文件格式、
整体 typecheck 与现有日期相关 37 项测试退出 0。Desktop 首次 typecheck 退出 2，
九条错误均来自已安装 kit 副本不含新 key；按 ADR-18 原命令刷新后通过，五份
package/lock 摘要不变。Web 的原 `npm ci` 刷新也未改变 package/lock/config。
没有改 alias、版本或类型约束来消除错误。完整日志分别为
`/volumes/data/kailo/tmp/codex-ui-web-check-20260930.log`、
`/volumes/data/kailo/tmp/codex-desktop-date-typecheck-current-20260930.log`、
`/volumes/data/kailo/tmp/codex-desktop-date-unit-current-20260930.log`。
首次失败仍保留于 `codex-desktop-date-typecheck-20260930.log`，不覆盖原输出。

实现后临时删除新目录的一项中文文案，原生成同步检查实际退出 1，报缺少条目；
立即还原后退出 0，源码摘要与破坏前相同。日志为
`/volumes/data/kailo/tmp/codex-ui-i18n-discrimination-20260930.log` 与
`/volumes/data/kailo/tmp/codex-ui-i18n-restored-20260930.log`。选定暂存源的生成物
初次同步检查亦拦下不一致，按其真实源重新生成候选后通过，没有手写第二套字典。
限定独立复核未发现本批缺陷；不覆盖其他未提交源码、三端整体呈现或 Stage 关闭。

真实 Web 构建与登记退出 0，22.858 秒，source 为
`sha256:446595d00f25c90bff044ae2b806a70189806960e57c167478847ce6e2710745`，
artifact 为 `sha256:a830bba58ce86f8a0129348c32b816cf2eaf168688f18dac9e6188226b9bd9af`。
仅 `buzz-web` 以现有 Compose 命令替换，退出 0、running/healthy，未重启 Core 或数据库。
日志为 `codex-ui-web-artifact-user-20260930.log` 与 `codex-ui-web-deploy-20260930.log`。
此前两个包装失败没有进入实际构建，仍保留原日志；成功构建未修改 builder 限额。
同一真实 Web、现有核验用户的浏览器走查退出 0，5/5：系统深色、无需刷新跟随浅色、
设备浅色覆盖、设备深色覆盖、非法偏好回退系统。日志为
`/volumes/data/kailo/tmp/codex-ui-theme-runtime-20260930.log`；浏览器 finally 关闭。
没有创建业务测试对象、保存浏览器凭据或生成新测试脚本，不扩充为完整业务链验收。

Desktop 以现有构建入口单次实建并登记，退出 0，5 分 31.886 秒，source 为
`sha256:d7cd027254577c9ace4d4942400e36a21576e33fae601b27c81d1fcc04c6f4c0`，
`dist/desktop-client/Kailo_0.5.23_amd64.deb` 的实存摘要与登记同为
`sha256:b90bd3722482f9fe8bf557dbba9588d6dc966806ff8d934e3fbece88a02e1bab`。
日志为 `/volumes/data/kailo/tmp/codex-desktop-ui-current-artifact-20260930.log`。
构建使用既有受限 builder，未安装或启动该包；13 份 Web 与两处 Desktop 追溯仅同步
实际 artifact，能力状态与历史 Core/Worker 发布登记不变。

上述产物来自完整当前工作树，包括其他未提交改动，不是本批选定源码提交的发布证明。
选定暂存的七个源码文件仅包含共享主题定义、对应生成器及 Dart 投影、Web 主题、
Desktop 两处日期与侧栏文案；候选字典经原生成器同步检查通过，未混入其他 ReasonCode
或 native 状态修改。本批源码提交不登记新的发布版本，也不关闭 Stage 1/2。

## 原生显示名与外观说明收口

2026-09-30，本增量对应 `REQ-08/21`、`DD-53`、`DD-111` 及既有
`SS-WEB-PRESENTATION`：Desktop 两条外观说明以 `{name}` 消费已有 NativeSession
显示名；未取得名称时只用共享中性标题。Mobile MaterialApp 标题消费已有、按服务器
缓存的显示名，无值时使用共享中性标题；启动读屏复用共享加载文案。Mobile 两处
均使用 MaterialApp 已解析的 locale，不新建语言、配置或身份来源。
两条新说明只定义在 TypeScript，Dart 由原生成器投影；Desktop 同文件内已有的
三种主题模式文案改动一并限定复核，原处理器、偏好存储、布局和配色标识不变。

没有新增实体、API、BFF 请求、路由、审批策略、业务上限或测试夹具；无数据库、
schema、Workflow 或旧版本格式兼容变更。权限、scope、secret、projection、外部
副作用、撤权与业务终态的六类错误合同不变；本批不引入业务执行或新的终态判断。
缺少展示名称的中性文案不构成认证、准入或连接降级。

固定上游核验使用 Buzz `779af8886caae1317b4de962082429867ab61503` 的
`buzz/desktop/src/features/settings/ui/SettingsPanels.tsx::ThemeSettingsCard`、
`buzz/mobile/lib/app.dart::App` 与 `_SplashScreen`；四处硬编码均由 `git grep <commit>`
读出，与当前源码一致。没有写入 `.references` 或新增源码事实与设计决策。

修改前共享 i18n File 为 HIGH，25 个直接依赖、111 个上游节点；Dart File 为 HIGH，
23 个直接依赖、42 个上游节点，风险已提示。Desktop File 为 MEDIUM、五个直接
消费者，ThemeSettingsCard 为 LOW、直接调用者 renderSettingsSection；Mobile
File 为 LOW、直接消费者 main.dart 与现有 widget 用例。共享 Const、Desktop
选项 Const 与两处 Flutter build Method 的 UNKNOWN 由原生成器、实际读取与
Flutter 主入口补核，不把零边当作未使用。typed 与 CLI 回执同为 HEAD
`fb00856dd041ea64f0a651d748bdbe319374d3c9`、schema 4、current、无 incomplete，
查询未报告 partial 或 truncated；日志为 `codex-fb00856-head-shared-gates-20260930.log`
与 `codex-fb00856-lanes-impacts-20260930.log`。

实际检查：共享 TS 原测试命令 88/88，Dart 既有目录用例 7/7；Desktop 按 ADR-18
刷新安装副本后，单文件 Biome format/check 与整体 typecheck 均退出 0，五份
package/lock 摘要前后相等。Mobile 单文件 format、`flutter analyze --no-pub
lib/app.dart` 与已有 widget/indicator 三项回归均退出 0；没有新增测试或升级依赖。
日志为 `codex-native-name-kit-ts-20260930.log`、
`codex-native-name-kit-dart-current-20260930.log`、
`codex-desktop-theme-settings-check-20260930.log` 与
`codex-mobile-display-checks-20260930.log`，均在 `/volumes/data/kailo/tmp/`。
Dart 初次包装指定不存在的执行路径，未执行测试；原失败保留于
`codex-native-name-kit-dart-20260930.log`，随后使用已安装的真实 Dart 路径通过。

实现后临时移除一条新中文文案，原生成同步检查退出 1，明确报告目录缺少条目；
立即恢复后退出 0，源码 SHA 与破坏前严格相等。日志为
`codex-native-name-discrimination-20260930.log` 与 `codex-native-name-restored-20260930.log`。
选定暂存的 TypeScript 仅含两条新说明，其 Dart 候选由选定源及 HEAD 的原生成器
实际生成并通过 `--check`；没有混入其他 ReasonCode、native 状态或日期规则改动。
候选日志为 `codex-native-name-stage-gen-20260930.log`。

实现后的两路限定交叉复核未发现新增可复现缺陷：Desktop 两条参数文案处于实际
NativeSession Provider 下，React 以文本渲染，主题处理器不变；Mobile 仅观察已有
服务器缓存，标题回调处于 Localizations 下，不新增网络调用。此结论不覆盖其他
未提交模块或本批未运行的原生会话。

既有构建入口实际完成：Web source
`sha256:416c1e44b5be9f3a5fa55ee75548d583fcb2f4b6e889b5f2f2e7071a5e2acc53`，
artifact `sha256:b474c25ccb35f80dca16fa15d23058ca5fb86acea0a01f44f914f71cf62cf6ae`；
Desktop source
`sha256:5f85180ee19ece3230e627438d07125674c5c4cb22ffa090dc17216486a8674e`，
安装包实存摘要与登记均为
`sha256:4ce222a33e4e96db6ef58ea5af1f47e8b56c18d58f1083a9c0f7ad45739abf60`。
Web 首次构建包装遗漏原入口所需的 REGISTRY，下次仅从现有 REGISTRY_HOST 投递该值；
Desktop 首次包装使用未登记此 builder 的执行用户，随后 root 包装的 git 查询退出
128，均保留原失败输出。使用既有 builder 的实际运行环境及仅本次进程的 Git
safe-directory 配置后，原构建成功，不改产品、构建脚本、全局 Git 配置或并行度。
成功日志为 `codex-native-name-web-artifact-current-20260930.log` 与
`codex-native-name-desktop-artifact-root-20260930.log`，Desktop 5 分 5.481 秒；
BuildKit 均保持 16 GiB 限额，Web 五 CPU、Desktop 四 CPU。只替换 Compose 的
buzz-web，未重启 Core 或数据库。13 份 Web 与两处 Desktop 追溯仅同步实际摘要，
不改能力状态或历史 Core/Worker 来源。此安装包未安装、未启动；产物来自完整工作树，
不冒充本批选定源码的发布证明。文档门禁实际退出 0、Markdown 0 issues，日志为
`codex-native-name-docs-20260930.log`。

这些检查不证明真机换服务器、名称刷新、实际读屏、安装包运行或三端整体呈现；
亦不关闭 Stage 1/2、归位五项真实集成失败与 Mobile release 签名阻断。

## 2026-10-06 原版私聊 Web 传输接线

本增量落实 REQ-24、DD-75/80/81 与 `.design/09` 的参与者私聊边界，
不是第二套聊天实现。原 Relay 继续保存频道和消息，Core 只使用会话绑定引用。
`web_transport.rs` 的频道与私聊发布、读取及媒体路径共用实现，分别调用
原 Workspace guard 与 `conversations::admit`；三端管理准入不变。

影响面是 BFF 消息/媒体路由、原 `admission.publish_attempt`、DISPATCH 审计、
`publish_reconcile.rs` 与原 SERVER 身份取钥。Workspace 原路由、请求和响应保持
兼容；私聊使用独立 conversation target，审计 `workspace_id` 为空，不把私聊 ID
伪装成 Workspace。原幂等记录不迁移，回放与并发抢占均核对 DISPATCH 的 action、
target type、target ID 和 Workspace；缺记录、跨 scope 或 mention 集合变化拒绝。
私聊 HUMAN 参与者不借用 Workspace 的 Agent Installation 提及执行权限。

发送仍先持久化同一 DISPATCH/attempt 事务，再投递原签名事件；超限、重复请求、
上游拒绝和 UNKNOWN 沿原六类错误及对账路径处理，不因超时再次执行。私聊对账
不能使用 CONTROL：它不属于参与者。对账只以原 HUMAN actor 的当前有效 SERVER
身份查询原 event ID，查询前后重核参与者准入、binding version、channel、host
和 SERVER pubkey；撤权、换钥、投影变化或观察失败保留 UNKNOWN，不能把无权读取
误判为 NOT_DELIVERED。未收敛数及最老年龄进入原发布对账度量，不新增正文持久化。

消息/媒体与对账合批的受限 SDK Core `cargo check --offline --locked -j16`
已退出 0，Web transport 七项单元检查通过。私有验证副本中把私聊审计 Workspace
从空改为会话 ID 后，范围归属检查实际失败（退出 101），改动已还原。
这些证据不覆盖实际 Relay 私聊读写、跨用户/设备隔离或部署后的消息对账。

同批原版私聊界面接线确认还需要实时消息，因此复用 `stream.rs` 的 snapshot、
SSE、RelaySessions、NIP-11 上界和周期再准入；新增 conversation 路由不另建
轮询器、连接池、消息存储或执行器。scope 只取已有 Workspace 或 Conversation
准入结果，私聊 generation 绑定参与者、channel、host 及两级 binding version。
私聊授权没有可证明撤销再授予的完整 epoch，因此重连总取真实 snapshot。
取 snapshot 和建订阅之后、返回正文之前再次核验身份、会话和 scope；在途撤权、
binding 变化、暂停、换钥或依赖失败关闭流，使用原重连间隔与 closed 原因。
原频道路由和 SSE 事件格式不变，不要求旧客户端迁移；Mobile/Desktop 直连 Relay
不改为 BFF 转发。该 SSE 增量与已读接线已在同一受限 SDK 编译，相关检查合计
九项通过（stream 一项、Web transport 七项、Conversation 一项）。私有副本放开
私聊 snapshot 续用、移除请求契约校验后均失败（退出 101），还原后重新通过。

原 `user_state.rs` 的已读路径此前只识别 Workspace Channel，会拒绝真实私聊
Channel ID。现有 `read_contexts` 的读取过滤与单键 CAS 写入已加入 Conversation
当前参与者准入，复用真实 binding，不创建第二用户状态，也不把管理员当私聊成员。
撤权后过滤历史键并拒绝更新；依赖失败不返回看似完整的状态。既有键格式和版本
均兼容，不迁移数据。该新增路径的编译已包含在上述合批中，但不把单元检查当作
真实多用户已读验收；私聊 `msg:`/`thread:`
事件级已读仍未接通，不能据 Channel 已读接线宣称原版私聊细节全部恢复。

本增量未单独提交、构建或部署，不宣称原版私聊或整个 Web/Desktop 主体已恢复。
前端完整原版界面继续复用，传输接线不代替页面交付。

本批集中 `./tools/check.sh --full` 使用固定检查镜像、四 CPU/八 GiB、Cargo 十六
并行和既有 Data 缓存，实际退出 2，未进入全量编译。继承隔离演练数据库容器的
无网络 namespace 后，Dart 依赖准备报 `Got socket error trying to find package test
at https://pub.dev.`；此前 pnpm 本次复用 217 包、下载零包，不能据此声称四语言
所有依赖完全离线可用。原日志为
`/volumes/data/kailo/tmp/tmp.C8VSyL9ytb.check.log`。该失败不是全量通过，也不否定
前述已独立执行的窄验证；最终全量、提交、部署与真实客户端验收仍未完成。

同日第二次集中 full 使用同一已缓存检查镜像、四 CPU/八 GiB 和 Cargo 十六并行，
另建仅供本次迁移演练的隔离 PostgreSQL，未使用业务数据库；检查容器可联网，
pnpm 复用 217 包、下载零包，Dart 实际下载 47 包。原日志
`/volumes/data/kailo/tmp/tmp.SQT2AP3kht.check.log`，最终退出 **1**：

- Rust、Go、Dart 测试，Temporal replay，迁移前进／回退／再前进、SQLx 同步均通过。
- Rust 格式及 Conversation 两处 tuple 类型复杂度失败；随后已使用命名 DB row
  修正并格式化，不能用修改前的测试证明修改后的 clippy 已通过。
- 四语言契约生成同步，Dart 平台文案不同步；TypeScript 重跑原命令得到 408 通过、
  2 失败，分别是原 NewMessage 的宿主 dark 变体被禁止，以及 modal 黑色和
  `ring-inset` 被通用颜色规则误判。未通过删除原交互或外观来让检查变绿。
- 新私聊没有新产物 digest，平台页记录混入 S0 身份决策，两个已恢复文件仍登记为
  删除；Relay、Desktop、Web 仍是旧产物。前两种登记问题和旧产物不等于业务验收。
- 未提供实际部署 `.env`，运行配置预检明确跳过；未安装 gitleaks，只运行内置扫描。

后续源码纠正以 REQ-24/DD-53 为依据：固定 Buzz
`779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/shared/ui/dialog.tsx::DialogOverlay` 实际使用浅色黑色 10%、深色 60%，
`desktop/src/shared/ui/modalBackdrop.ts::MODAL_BACKDROP_BLUR_CLASS` 为 5px 模糊，
不是简化弹窗的固定 40% 和 blur-sm。频道创建现复用同一共享原 DialogContent，
移除自写遮罩与包裹层，保留 pending/UNKNOWN 的关闭约束、原动作准入和幂等键。
这不改变契约、存储、授权或执行器；Web/Desktop 使用同一组件，Mobile 不受此
TypeScript 改动影响。主题检查保留具体原生 dark 表达式并识别 ring-inset 为几何
属性，不放行任意颜色或第二主题。以上增量随下一实现批验证，不冒用前批快照结果。

## 2026-10-10 已部署 Web 设置页面视觉复核

使用现有 `knowledge-catalog-register` Playwright 会话，以独立 Catalog 管理员
打开个人菜单、设置、头像编辑器及个人资料、外观、通知、快捷键、自定义表情、
邀请和实验功能；没有修改账号资料、上传文件、创建邀请或启用功能。
使用 `playwright-cli screenshot` / `run-code` 保存截图后逐张打开复核。
原件位于 `/volumes/data/kailo/tmp/profile-browser-20261010.4wqx6L/`。

当前运行容器 `platform-local-buzz-web-1` 的镜像 ID 前缀为 `7ea0c5fa4cf0`，
不是当前工作树构建结果。头像编辑器实际展示图片、表情和动态头像三个选项；
个人资料、外观、通知及快捷键有对应原设置布局，不是纯文本无样式页面。
自定义表情首次截图仍是加载状态，另存并打开 `custom-emoji-loaded.png`
确认加载后的图片上传、命名和列表布局；加载态不被计作完成。
邀请截图仍有重复标题与说明，而当前
`client-kit/ts/platform/src/react/invitations.tsx::TenantInvitations` 已按
`settings` 排除内层标题，说明源码与部署呈现仍有差距，不能声称已部署最新还原。

本次只复核这些页面的可见区域，未完成内部滚动全部内容、英文切换、头像上传/
保存/刷新或动态头像摄像头操作；管理员没有业务 Workspace，未创建默认空间
绕过这一前提。部分连续导航截图保留切换动画中的侧栏高亮，不能用于像素一致性
判定。没有固定上游运行截图的逐项对照，不声称 100% 还原或三端验收。
固定源码基准仍为 Buzz `779af8886caae1317b4de962082429867ab61503`；本次重新
核验 `desktop/src/features/settings/ui/SettingsView.tsx` 的邀请权限导航与
`desktop/src/features/community-members/ui/CommunityMembersSettingsCard.tsx`
的原页面结构，但未因此把全量源码 diff 标记为完成。

## 2026-10-10 seam-verifier 已部署主页面与设置只读实拍

沿既有 `kailo-ui-status` 浏览器、原 IdP 登录表单和已投递的独立验收账号正常登录，
未注入 Cookie、重置密码或创建身份。会话接口实际返回 200。页面公开 build-info
为 `BUZZ_WEB`、`sha256:9e1bd3032cefb32ac76fc5e64e9ed0fa7d8b45091acfe2e5556d990b407e1761`，
时间 `2026-10-09T15:39:24.407Z`；对应旧部署源码
`4c099a5f9b508f7df47b9fc923fe37ab7375aa70`，不是当前候选或当前工作树。
本轮使用原 `playwright-cli` 点击现有导航、截图，并逐张用图片查看器打开复核；
没有发送消息、执行任务、改权限、上传、创建/编辑工作流或改变设置。

原图目录 `/volumes/data/kailo/tmp/ui-deployed-4c099-20261010.He6Hxx/`：

| 原图 | 实际页面/状态与证据边界 |
| --- | --- |
| `01-workflows.png` | 三个工作流卡片仍堆叠 Asset 版本、installation/owner/pin 引用；当前候选已恢复语义卡片与详情，但此图不能验收候选。 |
| `02-inbox.png`、`03-pulse.png` | 既有私聊线程与两条动态可读、原输入区/筛选存在；未发消息。动态的 npub fallback 不能在未证明存在可读 profile 时直接判错。 |
| `04-projects.png` | 项目浏览空态及网格/列表入口；没有非空项目，不能证明 ProjectDetailScreen/ProjectIssuesPanel 已可用。 |
| `05-members.png`、`06-agents.png` | 当前频道三名成员可见；一个 Agent 定义及四个安装卡可见，其中一个显示安装中、三个显示 ACTIVE 记录。卡片仍露出大量 UUID/元数据，不能笼统以治理授权豁免原版呈现差异；记录状态不证明持续执行或 Transcript 可用。 |
| `07-tasks.png` | 真实任务列表和组件动作 JSON 表单。此为 Kailo 治理管理面，不是原 ProjectIssuesPanel，也不计入其恢复。 |
| `08-approvals.png`、`09-audit.png`、`10-devices.png` | 当前待审批为空、审计历史可读、设备为空；未制造数据以取得非空截图，未以准入/派发记录宣称动作终态。 |
| `11-settings-profile.png`、`12-settings-appearance.png` | 个人资料未设置字段、身份折叠区，以及语言/主题/字号/密度可见区域；未修改或保存。 |
| `13-settings-notifications.png`、`14-settings-keybindings.png` | 通知控件及快捷键列表；通知页明确显示浏览器通知被阻止，未改变权限，不计作通知送达验收。 |
| `15-settings-custom-emoji.png` | 已加载上传/命名表单与本人表情空态；未上传/保存，不计作完整表情业务验收。 |
| `16-settings-invitations.png`、`17-settings-experimental.png` | 邀请仍有重复标题/说明，现有两条已使用邀请可读；实验功能现有状态可见，未启停。当前源码 TenantInvitations 已排除 settings 内层标题，不重复修旧部署。 |

固定对照仍为 Buzz `779af8886caae1317b4de962082429867ab61503`。本轮重新核验
`desktop/src/features/workflows/ui/WorkflowCard.tsx::WorkflowCard`、
`desktop/src/features/projects/ui/ProjectDetailScreen.tsx::ProjectDetailScreen`、
`desktop/src/features/projects/ui/ProjectIssuesPanel.tsx::ProjectIssuesPanel`、
`desktop/src/features/pulse/ui/PulseScreen.tsx::PulseScreen`、
`desktop/src/features/agents/ui/AgentsScreen.tsx::AgentsScreen`，以及
`desktop/src/features/settings/ui/SettingsScreen.tsx::SettingsScreen`、
`desktop/src/features/settings/ui/SettingsView.tsx::SettingsView`、
`desktop/src/features/settings/ui/SettingsPanels.tsx::renderSettingsSection`、
`desktop/src/features/settings/ui/ProfileSettingsCard.tsx::ProfileSettingsCard`、
`desktop/src/features/custom-emoji/ui/CustomEmojiSettingsCard.tsx::CustomEmojiSettingsCard`。
分类仍逐项区分原样保留、共享迁移、已授权治理改造、缺失需恢复；本轮截图不能
把共享迁移源码直接升级为已部署还原。三组件菜单在这些真实页面中均未出现，
没有伪造 ACTIVE binding；完整组件页面、非空项目/Issue、候选新频道选择器/
作者派生/步骤字段、英文全覆盖、全部滚动区域及 Windows/Mobile 均不在本轮验收内。
无固定上游运行截图的逐项像素/交互对照，不声称 100% 还原。
主线程随后也实际打开全部 17 张原图，复核上述部署现象；该交叉视觉复核不改变
运行版本及候选未验收边界。

### 安装卡重复引用恢复与集中验证

固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/features/agents/ui/AgentIdentityCard.tsx::AgentIdentityCard` 完整卡片
没有头像/名称/说明外另拼版本和 Principal 引用。当前 WorkflowCard 同类偏差已在
候选恢复，不重复修改旧部署；本次仅删除 InstallationIdentityCard 外两行重复
UUID，保留原共享 AgentIdentityCard，既有 InstallationDetail 仍显示同两字段。

四步结论：权威为原版一致性要求及 `.design/17` §2、§6、§8，管理详情必须保留
exact version/AgentPrincipal；影响限于原 InstallationList→card→detail，
Asset 精确 pin 读取、授权、头像宿主、状态 Badge 和治理锁未改，Web/Desktop
共源，合同/持久化/写方/Mobile 均无改动；未新增网络请求或第二状态权威，不把
ACTIVE 记录冒充 working；空态、加载 skeleton、403/错 pin/错定义、scope 切换、
UNKNOWN 与锁定继续原处理及错误分类，未新开降级或重试路径。保留治理状态、
disabled 与受权详情是明确接入差异，不等于完整原 Session/Transcript 已恢复。

生产两行删除后，在已有 agent-library.test.tsx 增加真实页面点击/授权 GET
检查，证明目标是卡片紧凑而详情仍保留引用，不删除管理功能。两源 +18/-2 已由
主线程精确落正式并 cmp，原私有补丁 SHA-256
`bb0ace44f113d7ef50a9c4b92f497159524e5c371fb033894a685a93f82ca87c`。
统一 58377 中 agent-library 与其他五文件都仅到 worker 启动失败，0 用例；
完整命令/日志见[四批 DOM 收口](workflow-step-fields.md#四批-dom-收口2026-10-10)。
未运行生产反证/还原、不重复重试，候选截图未产生；仅为源码检查点，未验收或部署。

### 安装卡后续实际消费者证据（2026-10-10）

Cells 释放同原 SDK 后，69408 的 agent-library 原 14 项真实全部通过（与 channel/form-canvas 共 51/51），非旧 58377 的 0-case。30542 私有生产中重新加入 Agent UUID，原安装卡紧凑/详情保留引用检查实际失败；该文件 13 通过/1 失败。恢复生产原字节 cmp 0 后，49671 同文件 14/14 通过（含 sidebar 共 22/22、exit 0）。完整日志、哈希和命令见[DM 同批收口](dm-unread-overflow.md#同批真实头像及删除证据收口2026-10-10)。没有模拟删除治理详情或改断言求绿；此前旧部署 17 图边界不变，仍没有此候选的浏览器或 Windows 实拍验收。
