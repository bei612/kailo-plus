# 原版工作流触发条件与作者选择恢复回执

2026-10-07；范围仅为已有消息触发器的条件编辑、作者选择、冻结条件与运行过滤，不代表完整 Workflows 或 Buzz 全量还原。尚未对本批新部署进行浏览器截图、Windows 安装包或 Mobile 实机验收。

## 固定来源与差异

上游证据目录只读：`/volumes/kailo/.references/buzz`，固定 commit `779af8886caae1317b4de962082429867ab61503`。

| 分类 | 固定上游路径与符号 | 本批处理 |
| --- | --- | --- |
| 共享迁移 | `desktop/src/features/workflows/ui/WorkflowTriggerConditions.tsx::WorkflowTriggerConditions`、`desktop/src/features/workflows/ui/workflowConditionExpression.ts::buildConditionExpressions/parseConditionExpressions` | 迁入 `client-kit/ts/platform/src/react/workflow-trigger-conditions.tsx` 与 `workflow-condition-expression.ts`，保留基础/高级模式、八种操作符及表达式语义；不另写 Web 页面 |
| 共享迁移 | `desktop/src/features/workflows/ui/WorkflowAuthorPicker.tsx::WorkflowAuthorPicker`、`desktop/src/features/workflows/ui/workflowAuthorCandidates.ts::mergeAuthorCandidateSources/filterAuthorCandidatePage` | 迁入共享作者选择组件，保留搜索、公钥/npub、分页、网格及键盘交互；仅适配现有目录调用和严格类型检查 |
| 原样保留、共享迁移 | `crates/buzz-workflow/src/executor.rs::build_eval_context/evaluate_condition` | 纯表达式能力移至 `collaboration/crates/buzz-core/src/workflow_condition.rs`；原 executor 调用共享实现。沿原 evalexpr、4096 字节表达式上限及 100ms 求值时限，不恢复原 WorkflowEngine |
| 已授权治理改造 | `.design/06` §9/9.1、REQ-23/24、DD-107 | 作者候选来自已有 BFF 成员/会话目录；Core 按已验证 HUMAN、签名公钥、原生频道 UUID 和 NIP-10 回复上下文过滤，再进入原准入与 Temporal 执行 |
| 已授权中文/英文适配 | 共享 `i18n.ts`、既有平台词条生成器 | 新增 33 个共享词条；六个下划线操作符通过显式映射使用生成器接受的 camelCase 键，未删除操作符或改生成器规则 |
| 缺失需恢复/未验收 | 固定上游完整工作流功能集合 | 本回执不覆盖其他触发类型及所有工作流页面/动作的全量恢复，也没有完整运行截图和三端操作证据 |

## 四步影响结论

1. 权威：固定上游负责原版呈现、条件表达式及交互；既定设计负责身份、scope、冻结 AutomationVersion 和 Temporal 执行。仅恢复已有 CHANNEL_MESSAGE/MENTION 的原条件能力，未增加工作流 kind、权限权威或执行引擎。
2. 影响面：共享编辑器读写可选 `trigger.filter`；契约生成到 TypeScript、Dart、Go、Rust；Core normalization 将其保存在原冻结版本 JSON，查询投影返回同值，事件匹配读取冻结值。旧 `textPrefix` 继续与 filter 作 AND。没有数据库列变更、旧版本 digest 重写或正文复制；Desktop/Web 共用页面，Mobile 仅同步合同词条，本批没有 Mobile 交互验收。
3. 副作用：匹配条件不等于授权，不短路原 HUMAN 身份、频道/scope、准入、审批、额度或撤权检查。作者由签名者而非任意事件 tag 决定。求值错误日志不记录原消息正文或表达式诊断，不增加公共服务、注册表或账本。
4. 边界：空/null/空白、超长、语法错误的 filter 拒绝为 `InvalidParameters`；SCHEDULE 不接受 filter。合法语法但未知变量、非布尔结果、运行错误或超时不触发。无 filter 保持旧行为。作者目录失败清空候选，不回退共享身份；上下文变更/晚到请求不能覆盖当前目录。幂等、在途撤权、审批后额度与结果不明仍由已有执行链处理，本批未新增持久状态或终态；相关数据库并发场景未在本次执行。

## 实际验证

沿已有 SDK 容器 `kailo-agent-receipt-xvkujx`，镜像 `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`；执行前检查在途构建和资源。cgroup CPU `400000 100000`，memory/swap 各 `8589934592`；Cargo 保留 `-j16`，使用 `/cache/rust-target`、registry/git/npm/pub/Go 缓存，未在 `.references` 构建或执行。

本批日志目录：`/volumes/data/kailo/tmp/workflow-conditions-20261007.qjLXyz/`。实际命令均在原受限 SDK 的私有源码快照运行。

| 命令/证据 | 实际输出 |
| --- | --- |
| `npm_config_cache=/cache/npm npm_config_offline=true ./tools/gen.sh && ./tools/gen.sh --check`；`generate-restored.log` | 退出 0；同步四侧合同和 Dart 平台词条 |
| `./node_modules/.bin/tsc --noEmit`、`tsc --noEmit -p tsconfig.test.json`、`vitest run test/workflow-actions.test.tsx`；`ui-types-final.log` | 退出 0，22 passed |
| `cargo test --offline --locked -j16 -p platform-core --bin platform-core automation::`；`core-final-byte-restored.log` | `34 passed; 0 failed; 5 ignored` |
| `cargo test --offline --locked -j16 -p contracts --test roundtrip`；同一日志 | `43 passed; 0 failed` |
| `cargo clippy --offline --locked -j16 -p platform-core --bins --tests -- -D warnings`；同一日志 | `Finished dev profile`，退出 0 |
| TS 原 roundtrip：`tsc --noEmit -p tsconfig.test.json && node --test --experimental-strip-types test/roundtrip.test.ts`；`contracts-js-dart-restored.log` | 48 tests / 48 pass / 0 fail |
| `PUB_CACHE=/cache/pub dart test test/roundtrip_test.dart`；同一日志 | 43 passed |
| `GOCACHE=/cache/go-build GOMODCACHE=/cache/go-mod GOPROXY=off go test ./internal/contracts`；`contracts-go.log` | `ok apps/worker/internal/contracts`，退出 0 |
| 原 `tools/check.sh` contract 兼容段，`LAST_TAG=contracts-v0.1.0`；`contracts-compat.log` | `PASS 相对 contracts-v0.1.0 无破坏性变更（281 个 schema，匹配 3 个历史 schema）` |

三个 Cargo.lock 最终仅增加 evalexpr 的必要 package/依赖边：Core +7、collaboration +1、Desktop +7 行；原 cargo 离线更新连带重解的 Windows/wasm 无关依赖已剔除。Core 使用此最小 lock 实际 `--locked` 验证；Relay/Desktop 仅 `cargo metadata --offline --locked --format-version 1 --no-deps` 通过，不算 Desktop 原生编译通过。

### 反向破坏与失败保留

- 实现之后在私有快照将条件写回变为空串：`ui-mutation.log` 实际 3 failed / 19 passed。还原：`ui-restored.log` 22 passed。
- 私有快照移除冻结 filter 并反转求值布尔：`core-mutation.log` 实际 3 failed / 31 passed / 5 ignored。还原文件首次保留旧 mtime，`core-final-restored.log` 仍运行旧 mutation 二进制而失败；对两个文件逐字节 `cmp` 一致后仅 touch 私有快照，`core-final-byte-restored.log` 重新编译并得到 34/0/5。没有为让检查通过修改正式业务语义。
- 初次生成拒绝下划线词条（`generate.log`）、初次严格 TS 索引检查失败（`ui-final.log`、`ui-types-restored.log`）已按上述恢复修复。
- `core-tests-final.log` 中把 `@@@` 误认为语法非法导致 1 failed：evalexpr 接受其为变量，已改为验证运行 false；真正不闭括号验证语法拒绝。`core-tests-restored.log` 和最终日志通过。
- 初次误用 binary 名 `core-bff`（`core-tests.log`，退出 101）、TS `tsx` 相对路径（`contracts-js-dart.log`，退出 127）保留为失败记录；最终按工程原命令运行，不安装新 SDK 或改产品依赖绕过。
- 5 个独立迁移数据库场景 ignored，不冒充已验收；本批没有另跑全量 `./tools/check.sh --full`，全量发布检查由集成批次统一执行。

## 兼容与发布边界

`filter` 是可选字段，无 filter 的旧冻结版本仍可读，已有冻结 digest 不改。四侧生成物随对应消费者同步发布。旧 Web 的 `validAutomationContent` 白名单没有 filter，会拒绝展示/编辑新内容，不能声称旧客户端完整可读。

更重要的是：旧 Core 的匹配逻辑忽略未知 filter，可能无条件触发含 filter 的版本；schema 兼容检查通过不构成执行语义兼容。当前单 Core 发布须先停止旧 Core 再启动新 Core，不能让旧消费者接管含 filter 的活动版本或在途任务。回退旧 Core 前必须停用对应定义、确认相关在途执行已收敛，并保留原冻结版本；未满足这些条件不得回退。沿原版本/发布机制处理，不新造 formatVersion 或重写历史内容。

源码验证完成不等于发布完成。本回执没有宣称本批已部署、逐页截图验收或 100% 恢复；用户可用性仍需对应部署版本实际操作证据。
