# Stage 1 验收报告：身份、Tenant/Workspace 与三端协作

- 历史报告日期：2026-09-30
- 最新事实核对日期：2026-10-02 11:30 UTC（源码、产物、检查与运行版本核对，不是新增业务验收）
- 历史核对基线：历史发布登记包括 `9566ac0` 与其后的 `a7df56f4`；当时接手复核为 `0ec5e552` 之后的未提交工作树，历史登记不混作当时发布产物
- 依据：`02-纵向交付路线.md` §3 的验收映射与退出门禁、§1.1 端交付规则；`03-验证发布与验收门禁.md` §9
- 证据口径：只引用核验记录、追溯记录与提交说明中写明的实际执行结果；路径相对 `apps/`。核验记录中早于目录重构的测试路径仍写作 `core/crates/kailo-core/…`，现对应 `core/crates/platform-core/…`

## 2026-10-02 现状摘要

**Stage 1 仍不能关闭。** 下文 09-30/10-01 的 PASS、FAIL、命令和范围保持
历史条件，不自动成为当前版本的验收结果；旧的「当前」均指各段记录时点。

- HEAD 与实际远端 main 均为 `8ec78ed43e4a3e1fdc3f3243719cb7c1673eded6`。
  Web `ad82d6e6…` 已运行且 healthy；Core `03c24669…`、Worker `4832ccbb…`
  仍是旧运行镜像，二者没有 healthcheck，不能写成新候选已部署或三服务 healthy。
- Web/Desktop 的共享主题、导航、正文、表格、CodeBlock 与已修日期/文案已有
  实现；Desktop 注销与发送结果不明的处理也已有源码及历史限定证据，不能再
  笼统列为未开发。现有 Win11 NSIS 包 `9aef4725…` 是 unsigned 测试包，
  不是「Windows 尚未构建」，也不是签名 release 或安装、登录、协作验收。
  详见[Web 面核验](../../web-client/fork/verify/web-surface.md)与
  [Desktop 核验](../../collaboration/fork/verify/desktop-client.md)的本日记录。
- 原关闭条件中的三端整体呈现、有效对象的 CSRF 负向、NIP-42 会话复用、
  当前原生安装包 logout/断线恢复/撤权后 Relay 拒绝，以及 CLIENT-only、
  CAS/generation 等专门边界，仍须按对应版本和端取得证据；不把源码修复或
  历史 Web 11/11、Linux 安装包结果外推为当前 Win11/Mobile 通过。
- 含 Tenant ACTIVE 与 OpenMeter 412 修正的 `254e071f…` 候选已实际运行原
  `--full`，退出 0，但 DATABASE_URL 实际迁移演练与 `.env` 部署预检均
  SKIP，Mobile release 签名仍阻断。此前 Core 开发候选 `87c086a2…` 来自
  `77d02501…`，构建退出 0、未部署，不覆盖两处修正；本次 full 也不包含
  在开发的 AgentVersion 或独立 CHECK，不能外推整个未提交工作树通过。
  原日志为 `/volumes/data/kailo/tmp/codex-core-functional-closure-254e-full-20261002.37trEJ.log`。
  这些检查不关闭 Stage；正在实现的 AgentVersion 属于 Stage 5，不改变本报告结论。

## 历史结论与验证记录

2026-10-01 04:52 UTC 追加发布事实核对：本批新 Web、AgentGateway 镜像已入
本地 registry，Linux Desktop 安装包字节摘要已核对；当前 Web/Gateway 运行容器
仍使用旧 digest，新 Desktop 未安装验收。新产物基于完整未提交工作树，
不等于选定源码提交的发布证明，也不承接本报告的历史业务 PASS。
核对时 HEAD 与本地 `origin/main` 同为 `ee4c7968…`，本轮尚无新源码提交；
registry push 不是 Git push、部署或验收。完整摘要及追溯登记错配见
`core/verify/release-artifacts.md`「二开产物登记与当前运行边界」。本 Stage 仍不能关闭。

### 2026-09-30 业务验收记录（原条件保留）

以下保留当日业务证据及其限制，不以本轮新构建替代原执行条件。

当前环境已按用户授权在 2026-09-30 重新从零初始化。修正后的初始化入口无需手动
补齐网关数据库，日志与范围见 `07-运行与运维基线.md` §3。消息与线程用户状态的
Web 托管身份路径已取得当前真实服务 11/11 证据，见
`core/verify/functional-layout-regression.md`「全新环境与消息线程用户状态收口」；
不据此关闭原生 CLIENT 身份路径、其他专门边界或本 Stage。

**不能关闭。** `SS-WEB-PRESENTATION` 的共享主题与文案基础已有实现，但原生协作界面仍有可达的未翻译文案、独立日期格式及写死显示名，不能只补证据关闭；`SS-AGW-OIDC` 指定业务入口的 CSRF 负向实测、`SS-BUZ-SERVER-CLIENT` 的 NIP-42 会话复用证据尚不完整。按 §1.1「每个端各自成立」的规则，Desktop/Mobile 的 logout 与断线恢复没有当前安装包证据。`V-SCN-70` 已取得真实服务终态证据，不能再写作「没有孤儿销毁入口」；本增量的破坏核验和发布产物登记仍未完成。关闭条件见「关闭前必须补齐」。

追溯记录中 Stage 1 的七条能力记录已是 `status: shipped`（`platform.session`、`platform.pages`、`collab.channel.message`、`collab.channel.media`、`collab.user_state`、`identity.client_keys`、`lifecycle.tenant_workspace_membership`）。它们是能力级登记，本报告不据此认定 Stage 关闭，也不提出新的 status 变更。

## 1. 范围与未进入范围

范围：OIDC 登录与会话、Tenant/Workspace 与成员生命周期、SpiceDB 与 Relay roster 投影、Web 经 BFF 的频道读写与媒体、原生端设备公钥登记与本机签名直连 Relay、Web 托管身份与 operator 身份轮换、基础审计、Relay 治理与关闭 Buzz 自带 workflow（`DD-106`），以及本 Stage 自带的 OpenBao 与 Temporal 最小底座。

未进入范围（按 §3「明确限制」）：Agent、组件 remote module 与业务能力 binding；Tenant delete（Stage 3）与 Workspace delete（一期不注册，`DD-46`）；Tenant CONTROL 身份的 key revoke/rotate（`GAP-BUZ-01`，入口回 `409`，`core/crates/platform-core/tests/server_keys.rs` 断言）；EvidenceRef 按当前权限解析（Stage 2）。

## 2. 接缝与 GAP

| 接缝 | 状态 | 证据 | 缺口 |
|---|---|---|---|
| `SS-AGW-OIDC` | 部分成立 | `model-gateway/fork/verify/oidc-header-projection.md` L31–48（无会话 302、伪造 header 到达后端 0 次、有会话只穿过 issuer/subject）；`core/verify/identity-chain.md` L6–17（直连 BFF 缺 header 403 `IDENTITY_HEADER_MISSING`、伪造 403 `IDENTITY_UNKNOWN`）、L84–102（logout 200、SSE `closed: session-revoked`）；`core/verify/native-identity.md` L13–22；`oidc-edge.md`「接手复验」logout 三类来源均拒绝且原 session 不变 | cookie 与 CORS 的前缀、HttpOnly、SameSite、1764 字节实测值及 TTL 约束见 `oidc-edge.md`；csrf 策略、通用 POST 与 logout 拒绝已有实测，审批撤回与媒体上传仍缺有效对象的负向证据；超过 3800 字节只有源码证据 |
| `SS-WEB-RELAY` | 成立 | `collaboration/fork/verify/web-relay-core.md` L25–32、L96–103、L148–149（2026-09-23）；`web-client/fork/verify/web-surface.md` L23–24（构建产物中 `wss://`、`ws://`、`nsec1`、`relayUrl` 0 次）、L60（走查只有网关与 IdP 两个 origin、CSP 违规 0） | — |
| `SS-BUZ-SERVER-CLIENT` | 部分成立 | `collaboration/fork/verify/server-client.md` L15–21（CLIENT 身份不代签、roster 外 pubkey 被拒、roster 内返回 event id）、L41–53（roster 投影重复收敛）；本次 `tests/web_transport.rs` 11/11，含上界、预算与 NIP-11 漂移 | 「按 (principal, active session) 复用 NIP-42 会话」仍无完整核验记录；上界与预算回归不代表生产容量 |
| `SS-WEB-01` | 成立 | `web-client/fork/verify/web-surface.md` 走查 L16、L51–52；Desktop `collaboration/fork/verify/desktop-client.md` L8、L127–129；Mobile（只读）`collaboration/fork/verify/mobile-client.md` L143–147、L248–249 | — |
| `SS-WEB-PRESENTATION` | **未闭合** | Web 与 Desktop 已用宿主 ThemeProvider；TS 目录由既有生成器投影 Dart。后续本批 Web 复用共享主题模式，Desktop 搜索/草稿时间与九条侧栏文案改读已有 kit；Web 14、Desktop 37 与 typecheck 通过，新 Web 真实主题走查 5/5，见 `functional-layout-regression.md`「共享主题与协作界面呈现增量」 | 其他原生文案、Mobile/部分 Desktop 写死显示名及三端整体呈现仍未闭合；新 Desktop 包只有构建证明，无安装验收。接缝尚未登记到追溯 YAML，不能以本批局部核验或历史 Mobile 行号关闭整体接缝 |
| `SS-BUZ-OPERATOR` | 成立 | `collaboration/fork/verify/operator-provisioning.md` L16–22；RB-02 步骤 F 于 2026-09-24、2026-09-26 演练 | 核验产生的 Community 无法删除（同文 L40–45），随 Stage 3 的删除引擎处理 |
| `SS-BUZ-GOVERNANCE`（含 `DD-106`） | 成立，运行期证据有一项不足 | `collaboration/fork/verify/governance.md` L61–78（`members_cannot_govern_the_community` 12 项）、L83–91（五个单元测试，含启动自检）、L105–113（门禁破坏六处）；提交 `c4a597f` 说明「relay self-check passed in the local topology」 | 「成员消息不触发 workflow run」只有单元级证据（kind:9 放行到后续检查），没有运行期观察；记录本身未写实测日期；L115–122 登记仍按 Tenant 隔离的读面（kind 13534、按 hash 读媒体） |

GAP：`GAP-BUZ-01` 仍存在，入口拒绝行为已由测试断言；`GAP-IDN-01` 已由 `DD-83` 闭合（Stage 2 的邀请链交付）。

### 2026-09-30 修复前独立源码复核的范围

修复前 `NativeBootstrap.tsx` 的 `loadFailed/connectFailed/signIn.failed` 仍把原始异常正文
上屏；Desktop `TopbarSearch.tsx::formatRelativeTime` 与
`DraftsPanel.tsx::formatDraftCreatedAt` 仍独立定义英文时间语义；
`SettingsPanels.tsx` 的主题选项、侧栏连接状态和 Mobile compose 的读屏文案仍有
硬编码英文。Mobile `app.dart` 的标题与启动读屏、Desktop 主题说明仍写死 Buzz。
这些是 `REQ-08/21`、`DD-36/53/111` 范围内的实现缺口，不新增功能或另一套字典。

随后已有合同修复：Desktop 主题选项与 Mobile 主题标签复用共享主题模式/key；
原生引导页四处错误不再渲染原始异常；既有 TS 三条文案由现有生成器同步至 Dart。
platform/ Desktop typecheck、client-kit Dart analyze 与 i18n 同步检查通过，
platform 既有测试首次有 2 条失败；两条原始异常上屏断言按既有本地化合同纠正后，
7 个文件的 88 条检查均通过，负向破坏核验尚未执行。Mobile 分析门禁未通过。
上述修复在该轮尚未重新构建安装包；后续 Linux Desktop 包已重建，摘要为
`d4b4de04…`，仅有构建证明、没有新安装验收，
也未关闭其余搜索/草稿时间、侧栏/compose 文案、显示名缺口，接缝保持未闭合。
Core 的列表、Relay transport、用户状态的 Workspace 资格与 stream 再准入已复用
同一 guard；事件级用户状态可见性仍有未闭合项。后续已修正首写 CAS、暂停恢复的
generation 及明确撤权后 Web 重连，源码与现有正向走查通过，专门边界验证未完成，
见下节的当前镜像复验记录。
初次 Clippy 检查未通过，匿名查询投影改为命名类型后，本轮全量门禁的
Core Clippy 已实际通过；四语言基础测试也通过，但 `PLATFORM_INTEGRATION`
未启用，不能据此补记真实服务运行证明。
manage-only 官方会话与 Relay 连接未取得本轮运行证明；
不能用源码修复或历史集成结果关闭 Stage。

后续共享主题与协作界面呈现批次已完成上节历史缺口中的 Desktop 搜索/草稿时间、
九条侧栏 Relay 文案及 Web 共享主题模式。新 Web `a830bba5…` 已部署、真实主题
走查 5/5；新 Desktop `b90bd372…` 仅构建通过。两份产物基于完整当前工作树，
不视为选定源码提交的发布证明，亦不代替三端安装验收。其余可达文案、显示名与
整体呈现证明仍保留缺口，不把已修复的这三处继续列为当前未开发内容。

CSRF 审查核对 AgentGateway 固定 commit
`1f7ebbf87cbdbe9517f6f181221879d04dc50692` 的 `Csrf::apply` 和转发顺序，
当前浏览器的两条 route 均有单来源 CSRF 策略，未发现三条指定入口的代码漏防护。
已有当前 Web 走查证明媒体上传、本人撤回和两阶段注销的正向链路；本轮又取得
BFF logout 三类错误来源拒绝及原会话不变的证明。仍缺媒体与撤回的有效对象负向
证据，不是三条链路均无运行证据。直连 BFF 的集成测试和网关自己的 `/logout`
不能替代这项证据。

## 3. 设计/代码/验证/artifact 追溯

| 场景 | 追溯记录 | 验证证据 | 覆盖端 | 判定 |
|---|---|---|---|---|
| `V-SCN-01` | `collab.channel.message` | `web-relay-core.md` L25–30；`web-surface.md` L45 | Web | 通过 |
| `V-SCN-02` | `platform.session` | `identity-chain.md` L93–99；`web-surface.md` L58、L64–66 | Web | Web 通过；Desktop/Mobile 无 logout 证据 |
| `V-SCN-03` | `lifecycle.tenant_workspace_membership` | `core/verify/membership-lifecycle.md` L220–239（2026-09-22，连跑三次） | Core/Worker | 通过 |
| `V-SCN-13` | `platform.session` | `oidc-header-projection.md` L37–48；`identity-chain.md` L19–32 | Web | 通过 |
| `V-SCN-28` | `collab.channel.message`、`collab.channel.media` | `web-surface.md` L23–24、L48 | Web | 通过 |
| `V-SCN-29` | `collab.user_state` | `web-relay-core.md` L62–72；`web-surface.md` L49–50 | Web | 通过 |
| `V-SCN-32` | `lifecycle.tenant_workspace_membership` | `membership-lifecycle.md` L238–239；`identity-chain.md` L159–184 | Core；原生端撤权观察见 §6 | 通过 |
| `V-SCN-34`、`V-SCN-35` | 同上 | `identity-chain.md` L159–184（2026-09-29，`run-integration.sh` 31 批 ok，含 `membership_lifecycle_converges_both_directions`；两项破坏核验按预期失败） | Core | 本 Stage 部分通过；依赖 Resource owner 的部分在 Stage 5 |
| `V-SCN-43` | `governance.audit_evidence`（S2） | `core/verify/audit.md` L44–68（pre-Tenant 认证边界） | Web | 认证审计边界通过；EvidenceRef 部分归 Stage 2 |
| `V-SCN-63` | `identity.client_keys` | `native-identity.md` L42–57；`desktop-client.md` L61、L126；`mobile-client.md` L174、L247 | Desktop、Mobile | 通过 |
| `V-SCN-64` | `identity.client_keys` | `native-identity.md` L54–55；2026-09-25 源码树 `native-e2e.sh desktop`/`mobile` 各 1 passed（含撤销后被拒） | Desktop、Mobile | 源码树通过；安装包层未观察到 Relay 拒绝（§6） |
| `V-SCN-70` | `identity.client_keys` 的核验记录；该场景尚未登记到追溯 YAML | `native-identity.md`「接手复验」（2026-09-30）：`tests/server_keys.rs` 7/7，孤儿暂停、撤权、CAS 竞争、binding 胜出及不销毁反例通过 | Core/Relay/OpenBao | 真实服务正向通过；本增量破坏核验与发布登记未完成，不整体关闭 |
| `V-SCN-85` | 无独立场景登记 | `oidc-edge.md`「DD-112 落地」及「接手复验」：通用 POST 与 BFF logout 的同站跨源、跨站、错误 Origin 均 403；logout 三次拒绝后原会话保持 ACTIVE；本源正向见当前 Web 走查 | Web | logout 正反向已有证据；审批撤回、媒体上传仍缺有效对象的负向实测，未新增夹具，不整体关闭 |
| `V-SCN-84` | 无独立记录，证据挂在 `lifecycle.tenant_workspace_membership` 的 `governance.md` | 见 §2 `SS-BUZ-GOVERNANCE` | Relay | 通过，运行期一项证据不足 |

历史代码与 artifact：提交 `9566ac0` 时，七条 S1 追溯记录的 `release.artifacts` 登记 `core` `sha256:7e9b800d…`、`web-client` `sha256:b9a953fa…`、`model-gateway` `sha256:174afd82…`、`collaboration-relay` `sha256:e4c34134…`（core 的构建与 SBOM/provenance 见 `core/verify/release-artifacts.md`「功能目录重构后的发布单元」，二开产物由重构后的树重建，摘要与来源记录一致由 `seam` 核对）。Desktop 安装包 `desktop-client` `sha256:14e4cc9c…` 当时登记在 S2 记录中；Mobile 发布产物登记为阻断（见 §8）。

以上是 `9566ac0` 的历史登记，不是当前运行产物。2026-09-30 首轮 Web 走查使用
`web-client sha256:3159cff1…`；该轮 Desktop 包为 `sha256:e2720d13…`，只核对
了文件摘要、未运行安装包。追溯 YAML 已同步两者现有来源记录，能力状态没有提高。
本次 Core 仍是未提交源码的本地镜像，没有新发布 provenance。

随后提交 `a7df56f4` 已登记 Core `sha256:a52669b…`、Worker `sha256:8a05f23…`。
现存对应 SBOM/provenance 的只读补核见 `release-artifacts.md`「ADR-17 后的历史发布登记」：
两份 provenance 的源提交均为 `b592e353…`。这解释当前追溯 YAML 中的历史服务端摘要，
不把它们算作本次未提交增量或恢复镜像的发布证明；本次未重新构建或运行发布门禁。

## 4. 实际执行的验证命令和结果

| 时间与出处 | 命令 | 结果 |
|---|---|---|
| `core/verify/functional-layout-regression.md`「全新环境与消息线程用户状态收口」（2026-09-30）；日志 `codex-thread-final-full-rustpath-20260930.log` | `./tools/check.sh --full`（受限 cgroup、专用演练库） | 退出 0，全部通过；四侧生成、迁移回退一步/再前进、35 约束、14 追溯及实际产物匹配。演练库清理计数 0。真实 Web 11/11 另有日志，不把基础验证当作三端或生产发布验收；保留前两次包装/摘要失败记录 |
| `core/verify/functional-layout-regression.md`「当前产物匹配后的全量门禁与独立复核」（2026-09-30）；日志 `/volumes/data/kailo/tmp/codex-cas-stream-full-20260930.log` | `./tools/check.sh --full`（受限 cgroup、独立一次性 Postgres） | 退出 0、3 分 18.804 秒，十项实际运行；四侧生成、90 schema 兼容及当前 Web/Desktop 来源摘要匹配通过。未启用真实服务集成；不证明旧 Core 写入兼容、operator 退役失败重驱动或本轮专门边界。Mobile release 签名仍阻断 |
| `web-client/fork/verify/web-surface.md`「CAS 与订阅修复后的当前镜像复验」（2026-09-30） | `core/verify/web-walkthrough.sh`；Web 当前 digest `9f5e4b48…`，Core 当前未提交工作树 | 退出 0、1 分 46.072 秒；20 个计时场景、30 条记录通过，意外 origin/CSP 违规 0；会话 REVOKED、审批 CANCELLED/CONSUMED；临时 Tenant 与 namespace 清理、服务恢复及独立健康 200。不证明并发首写、manage-only 撤权再授权、暂停恢复旧 generation 或终端帧后重连次数 |
| `web-client/fork/verify/web-surface.md`「完整源码树上的接手浏览器复验」（2026-09-30） | `core/verify/web-walkthrough.sh`（受限 cgroup，当前 Web 镜像） | 退出 0，20 个计时场景、30 条记录，意外 origin/CSP 违规均为 0；注销/审批终态查证通过，本轮 Tenant 与 namespace 已清理；Core/Relay/Worker 恢复，BFF 健康探测 200。故障注入的 503 与拒绝响应如实保留 |
| `core/verify/functional-layout-regression.md`「接手全量门禁复核」（2026-09-30） | `tools/check.sh --full`（独立一次性 Postgres） | 首次退出 1：Web/Desktop 构建摘要已更新而 13 份能力追溯 YAML 未同步；其他门禁通过。该失败不被浏览器或集成通过抵消 |
| 同上，摘要同步后的两次复跑 | `tools/check.sh --full`（独立一次性 Postgres） | 第二次退出 1：预检继承包装层导出的 `PLATFORM_ADMIN_USER`，缺字段检查未拒绝；隔离该配置继承后第三次退出 0，十项全部实际运行，含 35 个命名约束与 14 条追溯。检查的父环境继承限制仍记录，不据此关闭本 Stage |
| `core/verify/functional-layout-regression.md`「源码纠偏后的全量门禁」（2026-09-30）；完整日志 `/volumes/data/kailo/tmp/codex-source-corrections-full-20260930.log` | 在 `/volumes/kailo/apps` 执行 `./tools/check.sh --full`（受限 cgroup、新建隔离 Postgres；`PLATFORM_INTEGRATION` 未启用） | 6 分 30.968 秒，退出 1。1/10 含 Core Clippy、2/10 四语言基础测试、4/10 迁移及 sqlx/35 约束、5/6/7/9/10 通过；3/10 四侧生成被共享 npm 缓存 EACCES/EEXIST 阻断，90 schema 兼容检查通过；8/10 当前 Web/Desktop 源码 digest 与产物不一致。Mobile release 签名仍阻断；不替代真实服务、本增量负向核验或发布证明 |
| `native-identity.md`「接手复验」（2026-09-30，未提交工作树） | `core/verify/run-integration.sh`；`tools/check.sh verify`；`tools/check-docs.sh` | 真实集成退出 0，私钥 7/7、归位 6/6、Web transport 11/11；35 个本轮 namespace 清理且前后集合相等；Core 恢复后独立 HTTP 200；四语言基础检查退出 0，文档 0 issues。本次未重跑安装包或浏览器走查，不登记新发布产物 |
| `core/verify/functional-layout-regression.md`（目录重构 `076681d` 之后） | `core/verify/run-integration.sh`；`core/verify/web-walkthrough.sh`；`tools/check.sh --full`（隔离库） | 31 批全绿（修正夹具中的旧二进制名后重跑）；走查 20/20；`check.sh --full` 退出 0；派发记录的破坏核验失败于预期断言；seam 门禁拦下误改的 model-gateway UI 文件并已恢复 |
| `core/verify/release-artifacts.md`「2026-09-29」段；提交 `9566ac0` | `tools/release.sh`（`076681d` 的 `apps/` 树）；`tools/check.sh trace`、`seam`、`supply` | core `7e9b800d…`、worker `9e7d3a6d…`，`dist/` 下有 SBOM 与 provenance；三步通过 |
| `identity-chain.md` L172–184（2026-09-29） | `run-integration.sh` | 31 批 ok；两项破坏核验失败于预期断言，还原后 31 批通过 |
| `web-surface.md` L39–58（2026-09-25）及其后复跑 | `web-walkthrough.sh` | 17/17（`walkthrough/summary.json`），其后 09-26、09-27 复跑，20 个场景版本见 L136–141 |
| `desktop-client.md` L47–61（2026-09-25） | `core/verify/native-e2e.sh desktop`；`pnpm test` | 1 passed；2290 通过 |
| `mobile-client.md` L167–174（2026-09-25） | `core/verify/native-e2e.sh mobile`；`flutter test` | 1 passed；+1142 |
| `desktop-client.md` L112–137（2026-09-29） | `.deb` 安装后在 Xvfb 下操作 | 见 §6 |
| `mobile-client.md` L224–261（2026-09-29） | profile APK 在 Android 36 模拟器 | 见 §6 |

## 5. migration 与 Workflow replay

- 迁移：`20260922181510_identity_stage1`、`20260922214500_orchestration_stage1`、`20260922230000_buzz_bindings_stage1`、`20260923010000_audit_stage1`、`20260923020000_collaboration_user_state`、`20260923040000_buzz_identity_multi_binding`、`20260923050000_workflow_kind_buzz_identity`、`20260928110000_server_key_provision_intent`、`20260928130000_server_key_provision_fence`、`20260929100000_tenant_revocation_workspace_memberships`。隔离库前进/回退/再前进见 `native-identity.md` L79 与 `core/verify/functional-layout-regression.md`（重构后隔离库 `check.sh --full` 退出 0）。只证明空白库上的前进与回退一步，不代表生产数据上的回退。
- Replay（`worker/replay-tests/baseline_test.go` 的 `TestComponentTaskReplay`）：`TENANT_LIFECYCLE`、`WORKSPACE_LIFECYCLE`、`MEMBERSHIP_PROJECTION`、`MEMBERSHIP_REVOCATION`（含 round wait 与 all relations）、`BUZZ_IDENTITY_PROJECTION`（登记与撤销）均有录制 history；`core/verify/governed-action.md` L77 记录改名破坏后报 `TMPRL1100`。

## 6. 安全、故障和恢复演练

- 身份边界：外来与缺失 header（§2 `SS-AGW-OIDC`）；Browser 不直连 Relay（`web-surface.md` L23–24、L60）；`check.sh security` 对六种违规逐一破坏（`native-identity.md` L222–225）。
- 跨 scope stream：撤权后开流 403（`web-relay-core.md` L103），已开的流收到 `closed/scope-revoked`（`identity-chain.md` L150–155），不存在的 Workspace 读消息 403。「对从未是成员的另一 Workspace 开 stream」没有单独记录。
- Start 响应不明：`governed-action.md` L53（同键重试收敛，WorkflowRef 一条，Temporal 仍是首次 run）；`membership-lifecycle.md` L232（重复启动 409）。
- 消息关联：`web-relay-core.md` L29（actor、scope、operation、`BUZZ_EVENT_ID` 与 AuditEvent 齐全）。
- Runbook 演练（本地拓扑）：RB-01（2026-09-23、09-24）、RB-02 步骤 A–F（2026-09-23 至 09-26）、RB-03 Relay 停机期间撤权收敛（2026-09-23，`CONVERGENCE_PENDING` 16 秒，恢复后 6 秒 `REVOKED`，演练参数 30/5/15）、RB-05、RB-06、RB-07 发布结果不明（2026-09-23，`503 PUBLISH_RESULT_UNKNOWN`，同键重发不产生第二条）、RB-10 灾备（2026-09-23，第三次通过，恢复后走查 14/14）。
- 原生端安装包：
  - Desktop（`desktop-client.md` L112–137，2026-09-29）：`.deb` `sha256:6ad17a43…`，PKCE 登录、设备公钥登记为 ACTIVE、本机签名 kind 9 经 Relay 被 Mobile 收到、Approvals 批准一次、撤权后收到 kind 9001 且 Channel 清空。撤权后发布被 Relay 拒绝未在安装包上观察（L131–133）。
  - Mobile（`mobile-client.md` L224–261，2026-09-29）：profile APK（Debug 证书）在模拟器上登录、设备 ACTIVE、与 Desktop 互收 kind 9；撤权后收到 kind 9001、订阅被关闭、已读写入 403。撤权后发送在客户端即被挡下，未证明 Relay 拒绝（L260–261）。
  - 两端均无 logout 与断线恢复的端到端记录。

## 7. 性能与容量边界

没有容量实测。2026-09-30 `tests/web_transport.rs` 11/11 包含 `relay_bounds_and_budget_are_enforced_before_relay`、`nip11_drift_is_reconciled_by_governance_reconciler` 与 `withdrawal_converges_while_binding_reconciling`，证明用例所覆盖的上界、预算与漂移行为，不代表生产并发容量或完整 NIP-42 会话复用。已登记的收敛上界是配置项：`BUZZ_NIP43_RECONCILE_INTERVAL_SECS`、`BFF_STREAM_READMIT_SECONDS`、`BFF_STREAM_RETRY_MILLIS`。历史走查计时：登录 270 ms，BFF 重启恢复 134661 ms，发布结果不明 19214 ms（`walkthrough/summary.json`）。

## 8. 已知限制及其 UI 表达

- Tenant CONTROL key revoke/rotate：入口回 `409`（`GAP-BUZ-01`）。
- Mobile 未交付能力：深链返回 `SURFACE_CAPABILITY_UNAVAILABLE`（`mobile-client.md` L11）。
- 原生端设备登记任务曾显示「Allowed, not started yet」而设备已 ACTIVE（`desktop-client.md` L135、`mobile-client.md` L121 的 2026-09-29 观察）：**已闭合**。`ccb0a36` 由 `record_dispatch` 统一记录派发结果、迁移 `20260929110000_dispatch_state_backfill` 回填存量，`tests/native_client.rs` 断言登记后 `dispatchState` 为 `DISPATCHED`；重构后反转 `record_direct_launch` 判断的破坏核验在该断言处失败，还原后 31 批通过（`core/verify/functional-layout-regression.md`）。修复后未在安装包上重新观察。
- Mobile release 签名缺 upload keystore：`collaboration/fork/upstream.yaml` 的 `mobile-client` 产物登记为 `blocked`；现有 APK 为 Debug 证书的 profile 构建，不是发布产物。
- iOS、macOS 与 Windows 安装包无构建环境，未构建；Desktop 只有 Linux `.deb`，未做代码签名。
- 产品显示名按 `DD-111` 的下发链已接入（BFF `GET /api/v1/platform-info`、Web 静态入口注入、原生端登录后读取并按服务器缓存、安装包显示名由 `build_args` 注入，见 `07-运行与运维基线.md`）。2026-09-30 另修正 Mobile 窗口标题/启动读屏与 Desktop 两条外观说明的四处硬编码，复用既有名称与共享目录；Mobile 单文件分析/三项回归、Desktop 整体 typecheck/单文件格式、TS 88 与 Dart 7 项均通过，见 `functional-layout-regression.md`「原生显示名与外观说明收口」。这些检查不证明真机名称刷新、换服或安装包运行；当前 Web 常规走查未逐个更换部署名称，不据此声称三端显示名完整验收。
- ADR-17 的本地迁移与重验已有 `core/verify/neutral-identifiers-migration.md` 记录；新旧 Workflow ID/SA 的一次性兼容窗口仍按 ADR 的退出条件关闭，不把保留旧 history 的 replay 解释为窗口已关闭。
- 历史失败保留的四个测试 Tenant（`53941c2e…`、`c8652adc…`、`060e8796…`、`b5ca5ffa…`，出处 `core/verify/secret-ref-rehome.md` L517、L538–540 与 `identity-chain.md` L182–184）已随获准的全新环境重建删除，不再作为 Stage 3 的清理任务；历史日志不作为当前数据现场。

## 9. 发布、回滚和数据保留结论

- 发布：历史服务端产物按 digest 登记（§3），较新的登记为 Core `a52669b…`、Worker `8a05f23…`，来源与现存 SBOM/provenance 见 `core/verify/release-artifacts.md`「ADR-17 后的历史发布登记」；它们不覆盖本次未提交增量。本地镜像未推送共享 registry，未签名（ADR-06 在出现共享 registry 时启用）。
- 回滚：服务端按 digest 回退（RB-09、RB-04 演练 2026-09-23）；原生端回退是发布新版本（ADR-06），尚无发布链。
- 数据保留：产品生命周期的保留规则不变，RB-10 的历史灾备演练记录保留；本次开发环境另经用户明确授权从零重建，历史测试 Tenant 不再存在，见 §8。

## 关闭前必须补齐

1. `SS-WEB-PRESENTATION`：修正上节所列现存文案、时间、异常呈现与显示名缺口，复用已有 kit 目录及宿主主题；再补三端主题语义、locale 与 message key 同源的接缝证据，并登记进追溯记录的 `seams`。
2. `SS-AGW-OIDC` 与 `V-SCN-85`：已有 route 策略、通用 POST 与 logout 三类错误来源拒绝，原会话未被撤销；本源正向见当前 Web 走查。补齐审批撤回、媒体上传的有效对象负向证据，并登记场景追溯，不用不存在对象或改头未生效的请求替代。
3. `SS-BUZ-SERVER-CLIENT`：补齐 NIP-42 会话复用核验；现有上界、预算与漂移真实回归不能替代完整连接模型和生产容量观察。
4. Desktop 与 Mobile 各自的 logout 与断线恢复端到端证据；安装包上撤权后发布被 Relay 拒绝的观察。
5. `V-SCN-70`：真实服务正向收敛已有证据；补齐本增量破坏核验、场景追溯与发布产物登记。
6. `V-SCN-84`：运行期「成员消息不触发 workflow run」的观察，并为该场景建立追溯记录。
7. `DD-40/41/46` 的本轮修复：Web 托管身份的消息/线程当前可见性、真实 thread root、GET 隐藏但保留历史与版本、撤权后的拒绝已经现有 `web_transport` 真实服务 11/11 查证。原生 CLIENT-only 事件的同等证据、首写并发 CAS、生命周期 generation 和终端拒绝的专门边界仍须各自查证，不以历史 shipped 登记或 Web 身份结果替代。

以下不阻断关闭，但须在一期收口前解决：Mobile release 签名、iOS 与 macOS/Windows 安装包、ADR-17 兼容窗口退出及对应重验、重构后安装包端到端的复跑。
