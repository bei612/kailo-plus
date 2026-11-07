# Session / Invocation 原事实读取

本批是已有 Installation 管理详情的只读消费者，不是原版 Transcript、Working bar 或完整 Agent 会话体验的完成记录。基准 `590431e4b8a88691350b4b91121622e628067cea`；未部署，未做新页面截图或原生设备验收。

## 变更依据与影响

1. 权威：`.design/17` §7–8、`.design/19` §4、DD-47/65。Session/Invocation 仍是原 `catalog.agent_session` / `catalog.agent_invocation`，执行权威仍为 Temporal，正文仍属于原 Codex。新 GET 不调用 runtime start、ensure、resume 或 rollout 读取。原 UI 来源为 Buzz `779af8886caae1317b4de962082429867ab61503` 的 `desktop/src/features/agents/ui/ManagedAgentSessionPanel.tsx::SessionHeader`；新增治理详情不能据此声称原会话面板已还原。
2. 影响面：原 BFF 两个 Installation 子路由、原 Installation 的 `read_view`、原任务 `observation`、四个 JSON Schema、四侧生成物及共源管理详情。没有新表、状态、注册表、Workflow、凭据或迁移；旧 Session generation 保留，游标不改写旧记录。原任务详情仍独立实时授权，`canReadTask` 只控制当前发起人的入口。
3. 副作用：查询只读。每页解析真实 HUMAN，复用 Workspace 准入和 Installation fresh read；Invocation 只返回本人执行或实际 AE 目标的 fresh audit 允许项。Automation 的 AE 目标不同于 Installation 时，不能拿 Installation 权限代替。没有 runtime 正文、prompt、tool result、reasoning、secret 或成本暴露。
4. 异常：非法游标、筛选或 generation 为前置条件拒绝；身份/scope/权限缺失拒绝；数据库、SpiceDB、投影事实或未知枚举不可核验即不可用。游标绑定 Tenant/HUMAN/Workspace/Installation/root/generation；分页采用配置上限和原记录稳定键，无新硬编码阈值。过滤后空页保留 nextCursor，重复 GET 无执行副作用。返回前重读身份及 Installation；UNKNOWN、投影落后和 cancelPending 复用原任务事实，不呈现为成功或已取消。响应 no-store。

Web 与 Desktop 使用同一管理面 BFF 和 TypeScript 消费者。Mobile 仅获得同源生成契约，不据此宣称原生 Session 页面已交付；它仍非组件宿主。

## 实际检查及边界

- 原生成入口 `bash tools/gen.sh`：以正式 `apps/contracts` 完整冻结输入执行，Rust、Go、TypeScript、Dart 四侧均 `OK`，exit 0。SDK image `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，实际 4 CPU / 8 GiB、Cargo 16，缓存与临时输入在 Data 盘。
- 原注册表生成器：`python3 tools/gen-registry.py` 输出 `24 条能力，20 个封闭 workflow kind 参与校验`，exit 0；只新增两条原能力下的 GET 路由，不创建新能力权威。
- 首次生成使用了过时的私有契约快照，错误移除了已有 Workflow description；UI tsc 实际 exit 2。已改为正式完整契约重新生成，保留原 description 消费者，未弱化类型检查。旧 Core 检查在缓存读取阶段终止，exit 143，不能计为通过。
- `contracts/samples/agent-session-control.sample.json` 是实现之后的四侧往返样例，覆盖 UNKNOWN、审计读者无任务入口、可选原生引用缺省，以及原 ContentReference 与本批元数据 inputJson 两种输入。
- 当前记录不证明实库授权、运行中撤权、分页并发、原生设备、完整上游 UI 一致性或生产就绪。全量门禁和上述验收仍独立成立，不能以生成成功替代。

## 2026-10-10 本批定向终态

同一受限 SDK 的 `/tmp/human-reader.gcbX3d` 完整冻结输入实际执行：

- `cargo test -p platform-core --bin platform-core agent_session_query::tests --locked --offline`：4/4。
- `cargo test -p platform-core --bin platform-core application_action::tests --locked --offline`：3 passed、1 ignored。忽略项需要已迁移隔离数据库，不算实库准入通过。
- 只在 SDK 私有生产副本移除游标 scope 匹配及 control_metadata 字符串限制，两条原检查分别 exit 101，捕获跨 scope 游标与正文输入放行。按原字节还原、`cmp` exit 0 后，同一检查分别 4/4、3 passed / 1 ignored。
- `cargo clippy -p platform-core --bin platform-core --locked --offline -- -D warnings`：exit 0。
- 最终样例的 Rust contracts：2 个 adapter PEP 与 48 个 roundtrip 全通过；Go `go test ./internal/contracts` exit 0；Dart `dart test test/roundtrip_test.dart` 48/48；TypeScript 原 `node --test --experimental-strip-types "test/**/*.test.ts"` 56/56、exit 0。共享页面类型与交互另见 [同源 UI 回执](agent-session-ui.md)。

保留失败：首个新样例遗漏 ContentReference 必填 displayName/mediaType，Rust 实际 47 pass / 1 fail；补齐原合同字段后通过。Dart 随后捕获样例时间被原 DateTime 序列化规范为毫秒精度，修正样例使用规范格式后 48/48，没有更改生成类型或忽略字段。四侧串行命令最后的 TS 相对目录错误使外层 exit 1，前三侧已通过；独立 TS 命令又因误用未安装 tsx 而 exit 1，随后改用原 package.json 的 Node strip-types 命令 56/56。未安装新工具或改变产品以迁就执行环境。

日志目录 `/volumes/data/kailo/tmp/component-delivery-commit.CVKZK5`：

| 日志 | SHA-256 | 结果 |
| --- | --- | --- |
| core-guards-negative.log | `d1ab93856eba0250b73cd999d1ebc1ad55169effc5f709ef4c19db5bcccc2cef` | 两条生产变异均 exit 101 |
| core-restored-contracts.log | `f5417edb258bd89ba7882977096eb4cec784ad37b3fe13d97d2de733fa2f22e0` | Core 还原与 clippy 通过；Dart 原样例失败 |
| four-side-final.log | `07cc1141c7ca459afddf322a2179862e15c1db9f230155e3b23aa8e3582c028e` | Rust/Go/Dart 通过，TS 工作目录错误 |

最终 TS 独立输出在 `ts-roundtrip-restored.log`，实际 56 passed / 0 failed。
上一冻结 f9784f9b92f8279e3293999c04c97d8e0baaddde 的全量检查实际 exit 1，包括旧 Core stream、共享 Workflow 检查及产物来源不匹配；不是本批通过证据。本批源码未部署，不改变三组件 release/binding 的阻断状态。

## 2026-10-10 当前业务状态复核

通过原 `platform-local-core-db-1` 的 `psql -X -v ON_ERROR_STOP=1`，使用容器既有
数据库身份执行 `BEGIN READ ONLY`，读取原 Invocation 与 CapacityLease，最后
`COMMIT`，实际退出 0。未读取密码、正文、工具结果或密钥，未修改业务记录。
第一次带状态筛选的命令因 shell 引号转义错误退出 1；随后使用无字符串筛选的
原表连接取得下面的实际结果，不把失败命令记为验收通过。

- installation `2989b1ec-f3fa-468d-89c5-4a8be226c97c` 仍有四条 CREATED；
  旧 Invocation `db6dfccb-f0db-409a-8ed6-d81e64e277d9` 与 lease 均 UNKNOWN。
  lease 有 terminal event 13，但 native_release_confirmed_at 仍为空，最近
  updated_at 为 `2026-10-10T19:13:42.866618Z`。没有清理占用、重放或扩大容量。
- installation `f66a3b3e-589e-4c27-965c-8d2b4cebb995` 最近已完成的 Invocation
  仍为 `ab1c154a-58f3-4d9f-bc39-8e87788f21a0`；其 lease RELEASED，具有
  terminal event 13 与 `2026-10-09T13:18:25.468167Z` 的原生释放证据。
  本轮没有发起新消息，历史完成记录不是新的双 Agent 协作验收。
- 更早的 Invocation `4cfe99fe-1e45-46d2-834b-411027412a9d` 为 RUNNING，
  lease 已 RELEASED。容量释放不是 Invocation 的业务完成证明；现有
  `capacity.rs::confirm_closed_native` 明确把 Reply/Usage 终态留给原消费者。
  本次没有据 lease 推断或人工写入业务成功/失败。

`playwright-cli` 实查两个旧协作浏览器会话已处于正常 IdP 登录页；
`kailo-ui-status` 仍有旧 Workflows DOM，但直接会话 GET 已重定向 IdP，被
页面的 `connect-src 'self'` 拒绝。这个裸 GET 不是原客户端的完整会话恢复链，
既不证明客户端恢复错误，也不证明旧 DOM 仍有有效授权。不放宽 CSP、注入
Cookie 或把残留页面当作当前读验收。当前多人多 Agent 稳定协作仍未证明。

## 2026-10-10 会话时间戳四侧往返纠正

既定权威是 ADR-03 与 `contracts/README.md` §1：RFC3339 时间按普通字符串
传输，不使用 `format: date-time`。`AgentSessionView.createdAt` 与
`AgentInvocationView.createdAt/updatedAt` 错用了该 format；Go 生成的
`time.Time` 将原样例 `.000Z` 序列化成 `Z`。这是时间字节被改写，不是字段
丢失或时间点变化，也不能靠把样例改成某一语言偏好的格式解决。

影响面为两份 schema、原四侧生成类型及现有 Session/Invocation 往返消费者。
Core 从原数据库 DateTime 字段输出 RFC3339，未接受新的客户端时间写入；
Web/Desktop 原共享 TypeScript 字符串消费者不变，Mobile 未另建类型或页面。
恢复普通字符串不会扩大 Session、Invocation 或 rollout 读取权限，不变更
枚举、分页、native 引用、Workflow history、数据库、取消或 UNKNOWN 语义。
缺省字段仍保持缺省；原样例、往返断言及未知状态拒绝检查均不放宽。

实际修复后的 Worker 枚举专项命令先通过 `go vet ./...`，随后
`go test ./... -count=1` 在上述两个既有往返子用例失败，整体退出 `1`；
workflows 与 replay-tests 已通过。原始输出位于
`/volumes/data/kailo/tmp/component-delivery-commit.CVKZK5/worker-enum-corrected.log`。
这份最终毫秒样例的失败优先于前文串行过程中的 Go 通过描述：此前通过不能
证明后改的最终样例四侧都通过。现已按合同移除三处 date-time format，原
受限 SDK 的 `tools/gen.sh` 实际退出 `0`，四份生成物已回写；Go 与 Dart
恢复字符串，TypeScript 从 Date 恢复 string，Rust 原本就是 String，仅增注释。
日志为同目录 `session-contract-gen.log`。串行复验的
`session-contract-four-side.log` 已实际记录 Worker 所有 Go 包（含 contracts、
workflows、replay-tests）通过，Dart 原往返 48/48、TypeScript 原检查类型及
56/56 用例通过。原句柄 `63418` 随后取得共享构建锁，Rust contracts 的
48 项往返和 2 项 adapter PEP 往返全部通过；原 `tools/gen.sh --check`
确认 Dart/Rust/TypeScript/Go 四侧与 Mobile 同源目录均同步，串行作业最终
退出 `0`。这是该冻结输入的四侧往返与生成同步，不替代最终合并树的全量
检查及契约兼容比对。没有修改正式生成文件来绕过生成器，也未改样例或
测试期望。

### 同轮旧冻结树的全量检查失败边界

`CHECK_SOURCE_REF=c381e68b783b1860c510128126bba3c9a58556b9` 的原
`./tools/check.sh --full` 于 2026-10-10 执行；输入固定在随后 Worker 枚举、
会话时间戳及共享 UI 修复之前，不在运行过程中替换源文件。原始日志为
`/volumes/data/kailo/tmp/component-delivery-commit.CVKZK5/full-component-final.log`，
容器日志为 `/volumes/data/kailo/tmp/tmp.VmTkwMk5Q7.check.log`。

已取得的实际结果包括 Rust fmt/clippy、生产 TypeScript 类型、Dart analyze、
四侧生成同步、302 个 schema 的历史兼容及 Cargo 检查通过；真实数据库迁移
因未提供 `DATABASE_URL` 跳过。旧输入的 `go vet`、`go test` 失败；上述随后
修复的定向通过不会将这两个旧失败改记为通过。

同轮共享平台 Vitest 实际为 136 passed / 1 failed，另有 46 个未处理的
worker 启动错误。`profile-assets.test.ts` 的原头像资源输出用例报
`Test timed out in 5000ms`，其余启动错误为
`Timeout waiting for worker to respond`；`pnpm -r test` 因此退出 1。
未放宽超时、移除断言或把未启动文件算作通过。后续 Dart 检查通过，replay
仍失败；追溯的文档六项、24 条记录及能力注册表校验通过。随后入口进入
供应链步骤。该冻结输入已明确失败，且不覆盖当前修复；为避免继续占用
I/O，负责人核对容器的完整 ID、固定 SDK、实际 `bash tools/check.sh --full`
及进程后，主动停止唯一对应的检查容器
`07a1472886d9c7b96613cbd2c7638bf98ecab9c5decfcba7fe838daf7fa44360`。
原入口执行自身清理；没有停止 Runtime BuildKit、队友 SDK 或其他项目。
供应链及后续 seam/security/docs 未完成，不记通过，也不把主动停止写成
自然完成的全量检查。外层日志 SHA-256 为
`d87785429d48a1dadfe38ebea95a141a2cf09f3f8423f312086d907d2cafc49b`，
容器日志为 `2ca6e2a14b0733351eaa1e0c511d9a87d9a1222f9cc73ff15afa9a002f3096ee`。
该失败输入及旧部署截图均不证明最新集成树已验收。
原入口清理完成后，句柄 `45041` 实际退出 `137`；这是上述主动停止的
终态，不是 OOM 诊断、检查通过或当前候选树的验证结果。

### 2026-10-11 后续冻结输入的 Core 静态检查

原冻结 Git tree `bd47a6a1e19bd78ee6981cc08f095fd1a30579c8` 的 Core 检查
句柄 76727 已实际退出 0，输出 `CLIPPY_EXIT=0`。实际命令为
`cargo clippy --offline --manifest-path core/Cargo.toml --all-targets -- -D warnings`，
使用固定 SDK `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
容器 `kailo-component-core-clippy` 的实际限额为 4 CPU、8 GiB，源和 Cargo 缓存均在 Data。
日志 `core-clippy-bd47-protos.log` 位于前述批次目录，SHA-256 为
`b6c74114067ea7a1b7c46076c306f1d62dc17727b43e271f83352a9ac1d2bd5a`。

前一个句柄 75051 退出 101：私有导出漏了同树的
`model-gateway/crates/protos/proto/ext_mcp.proto`，报该文件不在 include path。
补齐同一冻结树的原 proto 输入后才执行上述复验；没有改产品编译逻辑或弱化 clippy。
最终完成耗时 19m02s；收到编译完成文字时进程尚未退出，直到取得 0 才记通过。
该证据只关闭这份输入的 Core 静态检查失败，既不重写此前全量失败，也不证明
实库、旧 UNKNOWN 任务、三人多 Agent、最新 Web 修正或生产发布已验收。


## 2026-10-11 时间戳合同及 PEP 往返收口

本批基准 `032b9c304c84336a52c699244992c9bc73ff55da`，只选择两个时间戳
schema、原四侧生成物和既有 PEP 往返消费者，不混入工作区其他组件合同。

1. 权威：ADR-03、`contracts/README.md` §1 已排除 `format: date-time`。
   Session 的 createdAt 和 Invocation 的 createdAt/updatedAt 恢复普通字符串，
   仍由 Core 输出 RFC3339；不通过改样例或忽略毫秒掩盖 Go 的字节改写。
2. 影响：Core 原数据库 DateTime 输出、四侧生成类型、现有 Session/Invocation
   往返及共享 TypeScript 读取。Web/Desktop 共源，Mobile 只更新生成类型；
   无数据库迁移、Workflow history 或新写入。线格式字段及值不变，Go/Dart
   消费者不再重新格式化字符串。PEP 的既有可选 bindingGeneration 保持可选，
   往返重建对象补回该字段，旧响应缺省仍保持缺省。
3. 副作用：本批不改变认证、scope、授权、审批、quota、执行或审计，不新增
   状态和第二权威，不改变原生引用、正文边界或 UNKNOWN 呈现。
4. 异常：不改变原分页、撤权、超限和结果不明规则；时间字段仍为必填字符串，
   未知状态沿原封闭枚举拒绝。旧数据无需迁移；旧端虽可读取同一 RFC3339
   线格式，仍存在旧时间格式化行为，因此不把源码提交算作旧客户端已修复。

固定 `2cfa7be4751915501ee8f70f81621ab40adc752a` 的
`./tools/check.sh --full` 实际退出 1，日志
`/volumes/data/kailo/tmp/tmp.JTUyo9lFQI.check.log`。Go 原
`TestAgentSessionsAndNativeControlRoundtrip` 的 sessions/invocations 子用例
捕获 `.000Z` 被改成 `Z`；TypeScript 原 PEP 往返捕获 bindingGeneration 丢失。
这两项失败是本批直接原因，不降低断言。

该全量另有 Relay 移除路径仍存在和 11 项 source/artifact 不匹配；数据库
迁移及真实部署配置预检跳过。这些独立问题不因本批窄修复而变成通过。
没有新部署、Windows/Mobile 安装包或三组件业务验收。

### 本批四侧定向验证

选择提交的实现差异已在主干 `4bc73369666644a05bf79369922d8b7ebc54c199`
上复核。复用固定 SDK `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
实际 4 CPU / 8 GiB、缓存及私有导出均在 Data；未使用宿主工具链。

- `bash tools/gen.sh` 与 `bash tools/gen.sh --check`：四側生成及一致性均通过。
- `go test ./internal/contracts`：退出 0。
- 原 TypeScript `node --test --experimental-strip-types "test/**/*.test.ts"`：57/57。
- `dart test`：59/59；`cargo test --offline -p contracts`：2 个 adapter PEP 与 49 个 roundtrip 全通过，退出 0。

失败保留：首次手动创建的 SDK 缺少原入口的可写运行目录，Dart formatter
因 `/.dart-tool` 权限错误退出 255。复用原受限 SDK 后消除该环境错误，
没有修改产品或格式化器。首轮四侧导出又缺少既有
`client-kit/test-vectors/presentation.json`，Dart 51 passed / 1 load failure，
外层退出 1；补齐同一主干的原夹具后重跑 Dart/Rust 才得到上述终态。

日志目录：`/volumes/data/kailo/tmp/cells-native-closure.KxbRvt/contract-roundtrip.GC1u34`。
`four-side.log` SHA-256 为 `2df00a5523a81429474ce1be97c6bbf403a3299b64285d30e73bfaff0cffc69f`；
`dart-rust-final.log` SHA-256 为 `9214efe3e8b9a57f385fc74a70c2edec9b555cc8ab48563300d01f2236ede76e`。
这些定向结果不覆盖实库、运行时授权或完整上游页面验收，也不替代全量门禁。

同一候选实现树的原 `tools/check.sh contract` 输出四侧同步 PASS；
相对 `contracts-v0.1.0` 无破坏性变更，检查 302 个 schema、匹配 3 个历史 schema。
日志 `/volumes/data/kailo/tmp/tmp.ZUHbNqr4Mj.check.log`，SHA-256 为
`709089eb5b2512f6996b3aa507e6d062794cca525dd6a203044cace83b30c2d7`。
同受限容器的原 `tools/check-docs.sh /workspace/.design` 七项通过、退出 0；
检查 277 个设计引用、87 个实体、115 条 DD、29 条 SS 和 87 个场景。
