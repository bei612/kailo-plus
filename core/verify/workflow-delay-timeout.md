# 原 Delay 步骤显式超时的 Temporal 接入

## 依据与四步影响说明

对应 `REQ-24`、`.design/06-Temporal任务工作台.md` §9.1 与实施覆盖矩阵 `V-REQ-24`。
固定 Buzz `779af8886caae1317b4de962082429867ab61503`：
`desktop/src/features/workflows/ui/WorkflowStepCard.tsx::WorkflowStepCard` 的 Run controls / Timeout，
`desktop/src/features/workflows/ui/workflowFormTypes.ts` 的 `parseTimeoutSecs` 和步骤 YAML 解析，
`crates/buzz-workflow/src/schema.rs::Step` 的 `timeout_secs`，以及
`crates/buzz-workflow/src/executor.rs::execute_steps` 的原步骤超时行为。

1. 权威：原步骤执行控制属于既定完整工作流要求，执行权威仍是现有 Temporal AgentTask。本批只接显式 Delay 超时；原条件与其他动作超时没有真实执行消费者，仍不生成其控件。
2. 影响：共享原步骤卡片和真实 Form/YAML → `AutomationStep.timeout_secs` → Core 不可变 AutomationVersion 白名单 → `AgentTaskAdvanceResult.delayStep.timeoutSeconds` → 原 Worker 双 Timer → Core 原历史读取及 Invocation/trace。表单沿固定原 `StepFormState.timeoutSecs` 保存字符串草稿，唯一的 formContent 转换剥除 UI 字段并产出数值；非法草稿阻止 YAML 转换与发布，不由输入时格式化或 Inspector 卸载抹掉。正文、凭据、审批权威与数据库模型不变；Web/Desktop 共用同一 TS 主体，Mobile 只生成同源契约和词条，不以此声称移动工作流编辑页验收。
3. 副作用：Delay 不产生外部业务副作用。超时只有在独立 deadline 已 Fired、原 Delay 已 Canceled 且没有外部取消时成立；原既有拒绝事务仍要求未证明的副作用不存在，已接受的前序消息仍保留原 ACK。权限、审批、额度及对账不因超时而绕过。未决历史只回 UNKNOWN，不产生第二个 DelayStep 指令。
4. 边界：正整数显式预算、缺省旧字段、0/负数/小数/非法类型、超界、同轮完成、外部取消、缺始末事件和重复终态分别由白名单、双 Timer 与历史证据校验处理。旧定义不补默认值；超时不修改原 duration，不用本地 sleep、墙钟或新执行器。

## 原语义与四分类映射

| 内容 | 分类 | 本批边界 |
| --- | --- | --- |
| 原 duration、步骤顺序、模板、Step details | 原样保留 | 不把 duration 截断成 timeout |
| 原 Timeout 输入/滑杆、Run controls 折叠区 | 共享迁移 | 复用现有原 `WorkflowDurationField`，只对真实接通的 Delay 呈现 |
| 原步骤超时执行 | 已授权治理改造 | 原同步引擎替换为 AgentTask 原生双 Timer，既有 Core 读回证据决定终态 |
| 条件、非 Delay timeout、完整原管理 Sheet | 缺失需恢复 | 本批不宣称完成，不生成无消费者表单 |

原 `workflowFormTypes.ts` 的 YAML 读取要求 `timeout_secs` 是正安全整数，明确拒绝 0；
Rust `Option<u64>` 单独反序列化可容纳 0，不等于原产品允许发布 0。本批沿原产品校验。
原固定 Cargo.lock 使用 Tokio 1.52.3；其 `src/time/timeout.rs::Timeout::poll`
先轮询内部动作，后检查 deadline。因此两个 Future 同轮 ready 时完成优先，
Worker 与历史读取保持相同次序；取消则沿原 Invocation drain，不能误报步骤超时。

`STEP_TIMEOUT → LIMIT` 是本批对用户显式冻结执行预算耗尽的分类解释。
实施 `06` §4 的 LIMIT 列举 capacity/quota/entitlement/rate limit/大小上界，
并未逐字列出时间上限；本批不把网络超时或缺证据归 LIMIT，也不把整个 Workflow
的 `TIMED_OUT` 套到 AgentTask。缺 deadline 或 losing Timer 终态仍是 UNKNOWN。
后续原 observation 读取同一 native execution chain，补齐后才收敛；不重新创建 Delay。

## 兼容与实际检查记录（2026-10-11）

四侧生成仅沿原 `tools/gen.sh`，受限镜像
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
4 CPU、8 GiB RAM/同额 swap、UID 1000、network none、只读根、Data 缓存。
私有输入及日志位于 `/volumes/data/kailo/tmp/web-tooltip-shared.zzIWe9/delay-timeout.v1q3qG`。
原 5 个公共暂存 blob 未修改，不从其他工作区变更拼装证据。

- 原 `bash tools/gen.sh`：会话 56424 退出 0，Rust/Go/TS/Dart 与同源词条实际生成。
- 首格式命令使用登录 shell 重置 PATH，`rustfmt: command not found`，退出 127；改为镜像原非登录 shell，没有安装新工具。
- `go test ./workflows -run TestAgentTaskDelayDeadlineKeepsIndependentTimersAndDrainsCancel -count=1`：退出 0，deadline/completion/same-task/cancel 四场景实际执行。
- `go test ./replay-tests/... -count=1`：退出 0。是已有真实录制历史，不能称新 Delay deadline 分支已有录制生产历史。
- 首 Core 命令误用 `--lib`，退出 101：`no library targets found in package platform-core`；实际工程是 binary，后续命令按真实 `--bin platform-core` 执行。
- 首 Rust/Go 现有 contracts roundtrip：均退出 0。其后补入独立 DelayStep deadline/旧缺省样例，最终四侧往返另计，不冒用早先结果。
- 原 `tools/check.sh::step_contract`：退出 0。四侧生成同步；相对 `contracts-v0.1.0` 共检查 304 schemas、只匹配 3 个历史 schema，不能解释为所有领域均已有发布兼容证明。
- 最终四侧新增 DelayStep 样例：Rust、Go、Dart 原往返入口均退出 0；TS 原 `node --test --experimental-strip-types test/roundtrip.test.ts` 57/57 通过、退出 0。
- 原会话 49022 聚合退出 1：Core `--bin platform-core` 在执行断言前因私有快照漏带既有 `model-gateway/crates/protos/proto/ext_mcp.proto` 退出 101；该轮 Node 链因未挂载旧依赖软链接的 `/evidence` 目标报 `MODULE_NOT_FOUND`、退出 1。没有改正式 build.rs 或安装工具绕过；补回固定源码依赖的 Core 检查另计。
- 补回 HEAD 已有 proto 后，会话 41744 的 `cargo test --offline --locked --manifest-path core/Cargo.toml -p platform-core --bin platform-core delay -- --nocapture`：退出 0，5/5 通过，包括新 Delay 白名单和双 Timer 历史、原 zero-delay/readback 用例；不是完整 Core 集成或线上 Temporal 验收。
- 最终表单私有输入 `/volumes/data/kailo/tmp/web-tooltip-shared.zzIWe9/delay-timeout-ui.Ih20g1`，沿原 `kailo-web-thread-tooltip-sdk` 的 4 CPU/8 GiB 限额、Data 依赖挂载执行。`vitest run test/workflow-form-canvas.test.tsx test/workflow-definition.test.tsx --pool=threads --maxWorkers=1 --no-file-parallelism`：64/64 通过、退出 0。
- 私有反证只将 `workflowStepsContent` 的显式 timeout 转换改成删除字段：同两真实消费者的 `-t timeout` 两项均断言失败、退出 1（画布丢失预算；非法草稿错误进入 YAML）。恢复与正式源码逐字 `cmp` 后，同两完整套件再次 64/64 通过、退出 0；未修改正式源码实施反证。
- Worker 私有反证取消正常完成分支对 losing deadline Timer 的清理：原四场景检查退出 1，`completion` 明确报 `losing timer was not canceled`。Core 私有反证把已证明 deadline 的步骤状态错误写为 `cancelled`：原双 Timer 历史用例退出 101，实报 `left: cancelled / right: failed`。两私有生产文件恢复后与正式源码逐字 `cmp`。
- 恢复后的原会话 77409 聚合退出 0：`go test ./workflows -run "TestAgentTask(DelayDeadline|OrderedDelay)" -count=1` 与 `go test ./replay-tests/... -count=1` 均退出 0；Core 同一原 binary 入口 `automation_steps::tests` 5/5、`automation::steps::tests` 9/9 均退出 0。日志位于同私有输入的 `worker-restored.log`、`core-restored.log`、`core-steps-restored.log`，故障反证日志原样保留。
- 最终共享平台和 TS contracts 的 `tsc --noEmit -p tsconfig.test.json` 均退出 2：旧 Web 依赖实为 TypeScript 6.0.3，而产品 package 要求 `^5.9.3`；旧依赖缺 `@types/node`，另报既有 CSS side-effect 声明错误。实际日志分别为 `platform-typecheck.log`、`contracts-typecheck.log`。未改 tsconfig 消音，也不据 DOM/运行时往返通过声称类型全绿。

可选字段缺省不补 null；新 Worker 对无 timeout 的旧活动走原分支，显式预算使用
`agent-task-delay-step-timeout` 原 GetVersion 机制。发布需先具备支持本字段的 Worker，
再放行新 Core/UI 定义；不向仍不支持 deadline 的旧 Worker 投递新定义。

## 主线规范全量检查与参数整理

主线原 `./tools/check.sh --full` 会话 58678 已实际退出 1，日志
`/volumes/data/kailo/tmp/tmp.OPrr1jpqxI.check.log`。原入口按固定 packageManager 执行
`pnpm install --frozen-lockfile` 后，`pnpm -r typecheck` 通过，平台实际 1160 项检查通过。
此前借用 TS 6 缓存的窄类型失败作为历史保留，不能再将其称为本批当前规范类型阻断。

这轮 full 的失败包括：`automation_delay_progress`、`automation_step_history` 各有
8/7 参数的 Clippy 错误，以及 11 项已登记产物不匹配当前源码摘要。
未提供 DATABASE_URL，实际数据库迁移演练跳过；未投递 deploy/local/.env 的部署预检
同样跳过。这些产物/运行证据没有由本次源码整理消除，不能声称 full 通过。

参数整理前检索全部调用点：progress 仅 `agent_task.rs` 调用；history 仅其内部转发与
`automation/run_trace.rs` 调用。将同一冻结定义的步骤 prefix 与独立 timeout 映射
组合为既有 `automation/steps.rs::DelayTimings` 借用参数，两方法各减至 7 参数；
不复制状态、不改变 prefix 构建、不改 Timer/历史判定，也不加 lint allow。

整理后定点原会话 79198 聚合 exit 0，日志为上述私有输入的 `clippy-closure.log`。
复用同一不可变检查镜像与原 `/volumes/data/kailo/check-cache`，单次容器
`kailo-delay-clippy-close` 4 CPU、8 GiB RAM/同额 swap、UID 1000、network none、
只读根；源码/临时目录/缓存均在 Data。起动前本 lane 无编译进程，主线确认未占 Cargo 缓存。
四项修改后的生产文件先与私有输入逐字 cmp，依次执行：

- `rustfmt --edition 2021 --check` 后接 `automation/steps.rs`、`temporal/automation_steps.rs`、`agent_task.rs`、`automation/run_trace.rs`：exit 0。
- `cargo clippy --offline --locked --manifest-path core/Cargo.toml -p platform-core --all-targets -- -D warnings`：exit 0，未放宽 lint。
- `cargo test --offline --locked --manifest-path core/Cargo.toml -p platform-core --bin platform-core automation_steps::tests -- --nocapture`：5/5，exit 0。
- 同原 binary 入口 `automation::steps::tests -- --nocapture`：9/9，exit 0；前序消息前缀、旧缺省、双 Timer/取消证据继续通过。未重复新 full 或镜像构建。

本批实现、定点断言及三处私有故障反证/恢复已完成；没有本批镜像、部署、截图或 Windows 验收。
不能据生成、类型或模拟历史结果声明完整 Run controls、全量 Buzz 一致或生产就绪。
