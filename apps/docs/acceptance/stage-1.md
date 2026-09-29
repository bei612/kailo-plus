# Stage 1 验收报告：身份、Tenant/Workspace 与三端协作

- 报告日期：2026-09-29
- 核对基线：提交 `9566ac0`（目录重构 `076681d` 之后的 release 登记）
- 依据：`02-纵向交付路线.md` §3 的验收映射与退出门禁、§1.1 端交付规则；`03-验证发布与验收门禁.md` §9
- 证据口径：只引用核验记录、追溯记录与提交说明中写明的实际执行结果；路径相对 `apps/`。核验记录中早于目录重构的测试路径仍写作 `core/crates/kailo-core/…`，现对应 `core/crates/platform-core/…`

## 结论

**不能关闭。** 退出门禁「七个接缝各有接缝成立的可复核证据」对 `SS-WEB-PRESENTATION` 不成立，`SS-AGW-OIDC`、`SS-BUZ-SERVER-CLIENT` 各有一部分要求没有证据；「登录、logout、断线恢复端到端通过」按 §1.1「每个端各自成立」的硬规则在 Desktop 与 Mobile 上没有 logout 与断线恢复证据；`V-SCN-70` 在核验记录中被明确登记为生产阻断。关闭条件见「关闭前必须补齐」。

追溯记录中 Stage 1 的七条能力记录已是 `status: shipped`（`platform.session`、`platform.pages`、`collab.channel.message`、`collab.channel.media`、`collab.user_state`、`identity.client_keys`、`lifecycle.tenant_workspace_membership`）。它们是能力级登记，本报告不据此认定 Stage 关闭，也不提出新的 status 变更。

## 1. 范围与未进入范围

范围：OIDC 登录与会话、Tenant/Workspace 与成员生命周期、SpiceDB 与 Relay roster 投影、Web 经 BFF 的频道读写与媒体、原生端设备公钥登记与本机签名直连 Relay、Web 托管身份与 operator 身份轮换、基础审计、Relay 治理与关闭 Buzz 自带 workflow（`DD-106`），以及本 Stage 自带的 OpenBao 与 Temporal 最小底座。

未进入范围（按 §3「明确限制」）：Agent、组件 remote module 与业务能力 binding；Tenant delete（Stage 3）与 Workspace delete（一期不注册，`DD-46`）；Tenant CONTROL 身份的 key revoke/rotate（`GAP-BUZ-01`，入口回 `409`，`core/crates/platform-core/tests/server_keys.rs` 断言）；EvidenceRef 按当前权限解析（Stage 2）。

## 2. 接缝与 GAP

| 接缝 | 状态 | 证据 | 缺口 |
|---|---|---|---|
| `SS-AGW-OIDC` | 部分成立 | `model-gateway/fork/verify/oidc-header-projection.md` L31–48（无会话 302、伪造 header 到达后端 0 次、有会话只穿过 issuer/subject）；`core/verify/identity-chain.md` L6–17（直连 BFF 缺 header 403 `IDENTITY_HEADER_MISSING`、伪造 403 `IDENTITY_UNKNOWN`）、L84–102（logout 200、SSE `closed: session-revoked`）；`core/verify/native-identity.md` L13–22 | cookie 前缀/大小与 CORS fail-closed 没有核验记录 |
| `SS-WEB-RELAY` | 成立 | `collaboration/fork/verify/web-relay-core.md` L25–32、L96–103、L148–149（2026-09-23）；`web-client/fork/verify/web-surface.md` L23–24（构建产物中 `wss://`、`ws://`、`nsec1`、`relayUrl` 0 次）、L60（走查只有网关与 IdP 两个 origin、CSP 违规 0） | — |
| `SS-BUZ-SERVER-CLIENT` | 部分成立 | `collaboration/fork/verify/server-client.md` L15–21（CLIENT 身份不代签、roster 外 pubkey 被拒、roster 内返回 event id）、L41–53（roster 投影重复收敛） | 「按 (principal, active session) 复用 NIP-42 会话」与「固定 NIP-11 上界与限流预算」没有核验记录 |
| `SS-WEB-01` | 成立 | `web-client/fork/verify/web-surface.md` 走查 L16、L51–52；Desktop `collaboration/fork/verify/desktop-client.md` L8、L127–129；Mobile（只读）`collaboration/fork/verify/mobile-client.md` L143–147、L248–249 | — |
| `SS-WEB-PRESENTATION` | **未闭合** | 只有增量：`web-surface.md` L147–175（Web 聊天时间接入共用目录，Vitest 14 项、24 步走查）；`mobile-client.md` L184–214（共享文案） | `web-surface.md` L155–156 明写「本增量不声称三端整体同源」，`mobile-client.md` L200 明写「主题与日期/复数语义的全端统一尚未闭合」；没有 ThemeProvider/CSS variables 复用的核验；该接缝不在任何追溯记录的 `seams` 中 |
| `SS-BUZ-OPERATOR` | 成立 | `collaboration/fork/verify/operator-provisioning.md` L16–22；RB-02 步骤 F 于 2026-09-24、2026-09-26 演练 | 核验产生的 Community 无法删除（同文 L40–45），随 Stage 3 的删除引擎处理 |
| `SS-BUZ-GOVERNANCE`（含 `DD-106`） | 成立，运行期证据有一项不足 | `collaboration/fork/verify/governance.md` L61–78（`members_cannot_govern_the_community` 12 项）、L83–91（五个单元测试，含启动自检）、L105–113（门禁破坏六处）；提交 `c4a597f` 说明「relay self-check passed in the local topology」 | 「成员消息不触发 workflow run」只有单元级证据（kind:9 放行到后续检查），没有运行期观察；记录本身未写实测日期；L115–122 登记仍按 Tenant 隔离的读面（kind 13534、按 hash 读媒体） |

GAP：`GAP-BUZ-01` 仍存在，入口拒绝行为已由测试断言；`GAP-IDN-01` 已由 `DD-83` 闭合（Stage 2 的邀请链交付）。

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
| `V-SCN-70` | 无 | 迁移 `20260928130000_server_key_provision_fence`；`native-identity.md` L151–154 明写不证明写入期间撤权、暂停与竞争，L168–178 登记「没有经过治理且经 OpenBao metadata 查证的孤儿版本销毁入口」为**生产阻断** | — | **未闭合** |
| `V-SCN-84` | 无独立记录，证据挂在 `lifecycle.tenant_workspace_membership` 的 `governance.md` | 见 §2 `SS-BUZ-GOVERNANCE` | Relay | 通过，运行期一项证据不足 |

代码与 artifact：七条 S1 追溯记录的 `release.artifacts` 登记 `core` `sha256:7e9b800d…`、`web-client` `sha256:b9a953fa…`、`model-gateway` `sha256:174afd82…`、`collaboration-relay` `sha256:e4c34134…`（提交 `9566ac0` 登记；core 的构建与 SBOM/provenance 见 `core/verify/release-artifacts.md`「2026-09-29」段，二开产物由重构后的树重建，摘要与来源记录一致由 `seam` 核对）。Desktop 安装包 `desktop-client` `sha256:14e4cc9c…` 登记在 S2 记录中；Mobile 发布产物登记为阻断（见 §8）。

## 4. 实际执行的验证命令和结果

| 时间与出处 | 命令 | 结果 |
|---|---|---|
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

没有容量实测。NIP-11 上界、BFF 限流预算与并发连接数没有核验记录（`07-运行与运维基线.md` 只登记要求）。已登记的收敛上界是配置项：`BUZZ_NIP43_RECONCILE_INTERVAL_SECS`（默认 60 秒）、`BFF_STREAM_READMIT_SECONDS`、`BFF_STREAM_RETRY_MILLIS`。走查计时：登录 270 ms，BFF 重启恢复 134661 ms，发布结果不明 19214 ms（`walkthrough/summary.json`）。

## 8. 已知限制及其 UI 表达

- Tenant CONTROL key revoke/rotate：入口回 `409`（`GAP-BUZ-01`）。
- Mobile 未交付能力：深链返回 `SURFACE_CAPABILITY_UNAVAILABLE`（`mobile-client.md` L11）。
- 原生端设备登记任务曾显示「Allowed, not started yet」而设备已 ACTIVE（`desktop-client.md` L135、`mobile-client.md` L121 的 2026-09-29 观察）：**已闭合**。`ccb0a36` 由 `record_dispatch` 统一记录派发结果、迁移 `20260929110000_dispatch_state_backfill` 回填存量，`tests/native_client.rs` 断言登记后 `dispatchState` 为 `DISPATCHED`；重构后反转 `record_direct_launch` 判断的破坏核验在该断言处失败，还原后 31 批通过（`core/verify/functional-layout-regression.md`）。修复后未在安装包上重新观察。
- Mobile release 签名缺 upload keystore：`collaboration/fork/upstream.yaml` 的 `mobile-client` 产物登记为 `blocked`；现有 APK 为 Debug 证书的 profile 构建，不是发布产物。
- iOS、macOS 与 Windows 安装包无构建环境，未构建；Desktop 只有 Linux `.deb`，未做代码签名。
- 产品显示名按 `DD-111` 的三端下发已在源码实现（BFF `GET /api/v1/platform-info`、Web 静态入口注入、原生端登录后读取并按服务器缓存、安装包显示名由 `build_args` 注入，见 `07-运行与运维基线.md`），尚无部署后的真实拓扑走查，`desktop-client` 需按新源码重建。
- 内部标识去掉产品名的迁移（ADR-17）尚在进行，不影响本 Stage 的行为证据，但其落地会改动 workflow ID 前缀与 Search Attribute，届时需重跑 replay 与集成。
- 失败保留的四个夹具 Tenant（`53941c2e…`、`c8652adc…`、`060e8796…`、`b5ca5ffa…`，出处 `core/verify/secret-ref-rehome.md` L517、L538–540 与 `identity-chain.md` L182–184）仍在本地 Core 与 OpenBao 中，待 Stage 3 的 `tenant.delete` 删除。

## 9. 发布、回滚和数据保留结论

- 发布：服务端产物按 digest 登记（§3），`core`/`worker` 的构建输入、SBOM 与 provenance 见 `core/verify/release-artifacts.md`「2026-09-29」段；本地镜像未推送共享 registry，未签名（ADR-06 在出现共享 registry 时启用）。
- 回滚：服务端按 digest 回退（RB-09、RB-04 演练 2026-09-23）；原生端回退是发布新版本（ADR-06），尚无发布链。
- 数据保留：本 Stage 不删除 Tenant 数据；RB-10 灾备演练恢复通过。夹具 Tenant 见 §8。

## 关闭前必须补齐

1. `SS-WEB-PRESENTATION`：三端主题语义、locale 与 message key 同源的接缝证据（含 ThemeProvider/CSS variables 复用），并登记进追溯记录的 `seams`。
2. `SS-AGW-OIDC`：cookie 前缀/大小与 CORS fail-closed 的核验记录。
3. `SS-BUZ-SERVER-CLIENT`：NIP-42 会话复用与 NIP-11 上界、限流预算的核验记录。
4. Desktop 与 Mobile 各自的 logout 与断线恢复端到端证据；安装包上撤权后发布被 Relay 拒绝的观察。
5. `V-SCN-70`：受治理的孤儿版本销毁/终结入口，以及写入期间撤权、暂停、竞争的故障注入演练。
6. `V-SCN-84`：运行期「成员消息不触发 workflow run」的观察，并为该场景建立追溯记录。

以下不阻断关闭，但须在一期收口前解决：Mobile release 签名、iOS 与 macOS/Windows 安装包、四个夹具 Tenant 的删除、ADR-17 迁移后的重验、重构后安装包端到端的复跑。
