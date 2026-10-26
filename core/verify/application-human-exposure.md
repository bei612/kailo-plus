# HUMAN application ResultExposurePolicy

关联：03 §6（ResultExposurePolicy 最大边界与求交）、DD-88/94（已批准 release 与原 binding 生命周期）、DD-134(6)（HUMAN 工具测试调用）。这是一项既有 Core 实体的生产者实现，不增加策略管理动作或授权服务。

## 实现与边界

旧实现只有 `delegation::prewrite` 随 grant scope 写 ResultExposurePolicy；它的 APPLICATION scope 要求 ACTIVE binding/ToolBinding。原 HUMAN componentAction 与 Cells 原生动作配置却已要求策略 ID，导致第一套 binding 启动前缺少合法生产者。同 schema 的 grant 策略或自动准入的模拟 UUID 不能填补此缺口。

`application_binding::prewrite` 已通过原 scope、fresh 权限与目标门禁后，在写入 PROVISIONING binding/PENDING runtime 的同一事务调用 `human_exposure::materialize`。它逐项读取固定 APPROVED release 的 actionDefinitions，只接受原 mode/output schema/redaction 声明，物化到既有 `catalog.result_exposure_policy`。原 TEMPORAL 准入会在 prewrite **之后**将该 ActionExecution 写为 ALLOWED，再一起提交；数据库约束不错误地提前要求这一后置状态。

新增 nullable 归属列为 tenant（原字段）、binding、release、generation、actionKey/actionVersion。新策略固定 version 1，唯一约束确保幂等重入仍使用同一 ID。全空归属保留 Delegation 原语义；全有归属受 tenant/binding、runtime/release 外键及已批准声明约束。已有 immutable trigger 同时保护新归属；HUMAN 策略不允许删除或从 RETIRED 恢复。撤销绑定时仅退役自身策略；没有按 schema 查找或复用其它策略。

HUMAN componentAction、PROTOCOL_PEER 测试调用准入及后者 PEP 两相都验证确切归属。目标权限、输出 schema/redaction、正常 binding/tenant/workspace 生命周期门禁继续由原消费者执行。固定 old generation 引用不擅自换到新 generation；普通新准入仍取当前 ACTIVE projection。未 ACTIVE 的绑定即使已有策略也不能执行。原 AGENT Delegation 路径不改成 HUMAN 规则。

`ApplicationBindingPage.bindings[].humanActionPolicies` 是公开控制元数据。ACTIVE binding 在原 fresh discover 范围内给出固定引用；PROVISIONING/ERROR 的 PENDING 引用仅向原 canCreate 管理者给出，以便投递 native-action 配置。Gateway 工具列表从确切 binding/generation/action/version 策略取得 testCall 引用，移除任取同 schema 策略的旧查询。API 是可选字段扩展；四侧类型仅由原 `tools/gen.sh` 生成。

## 验证状态

2026-10-26 固定源码 `6f3d89cfabe795b51bf53d395065e58044ae5e52` 已通过以下原 SDK 检查，最终容器 exit 0、OOMKilled=false。CI 从 GitHub 直接 fetch 固定对象后在 CI 本机归档，没有从开发机上传源码包。详见 [原始回执摘要](application-human-exposure-20261026.json)。

- `cargo fmt --manifest-path core/Cargo.toml --all --check`；原 `bash tools/gen.sh --check` 四侧一致。
- `sqlx migrate run` → `revert --target-version 20261029020000` → `run`；新迁移最终编号 `20261031060000`，已与并行分支协调，未部署中间编号。
- `cargo test --locked --offline --manifest-path core/Cargo.toml -p platform-core application_binding::human_exposure:: -- --include-ignored --nocapture`：2 项通过，其中 1 项实际连接独占 PostgreSQL 调用原 producer 和管理读取 SQL。
- 同入口 `application_tool_human::`：5 项通过；不把筛选出的 0-test 集成测试程序计入测试数。
- `cargo clippy --locked --offline --manifest-path core/Cargo.toml -p platform-core --all-targets -- -D warnings`；`cd core && cargo sqlx prepare --check --workspace -- --locked --offline` 均退出 0。
- 另从固定源码提取 Gateway 原 `TOOL_LIST`，在同迁移库实际 PREPARE/执行/ROLLBACK，退出 0；此项只验证真实 SQL 与表结构，不声称已有 Tool 行、真实 HUMAN 权限或业务调用。

SDK 固定 image 为 `sha256:3007729eb192341a4f004a88e42e1e66c94fc67d763acfc96568bd7311116018`，4 CPU、16 GiB（swap 同限）、512 PIDs、只读 root、cap-drop ALL、no-new-privileges；独立内部网络只连接本批 1 CPU/512 MiB PostgreSQL，使用原固定 postgres digest。生成阶段为同 SDK 1 CPU/2 GiB、无网络。target 是本批独有 `/volumes/data/kailo/conformance/checks/human-exposure-19735ceca/target`，没有复用其他候选的目标缓存。完整 command、容器状态、日志与 SHA-256 保留在 CI `/volumes/data/kailo/conformance/checks/human-exposure-6f3d89cfa/`。完成后仅删除本批明确列出的 9 个 SDK/PG 容器与 1 个网络，`cleanup.json` 保留 docker ps/network 空回读，窗口已交还并行实现。

保留的真实失败：初次原 Dart formatter 退出 255，诊断确认它尝试写只读 `/.dart-tool`，并非业务或连接成功；给其独立可写目录后原脚本通过。早期 CI 归档遗漏 collaboration workspace 依赖/示例目录，PG 缺可写 tmp 且未使用该原镜像的 postgres UID 70，均在运行环境纠正。`19735ceca` 首次完整编译发现新测试 Connection/Acquire::begin 歧义；`84e2ad26d` 编译通过后原数据库约束拒绝夹具 EVALUATING+DISPATCHED，随后将夹具改为真实 EVALUATING/NOT_DISPATCHED 初态及后续 ALLOWED/DISPATCHED，未放宽约束。各次日志保留在相应 `human-exposure-*` 检查目录，不能回写为通过。

新增原数据库回归使用独占隔离库的既有 `application-execution-base.sql`/dispatch fixture；只暂停 fixture 在 PENDING 阶段以调用实际 Rust producer。覆盖事务回滚、幂等 ID、未 ACTIVE 拒绝、错误 tenant/binding/release/generation/action/version、同 schema 无归属策略拒绝、内容不可变/删除禁止/退役后不可恢复，以及 PENDING 仅管理读取固定引用、ACTIVE 后同一引用、跨 Tenant 空读取。该夹具不是产品 bootstrap，不证明真实 Catalog 审批或原生执行。

## 未闭合项

- 当前源码只有初次 application binding 的 runtime writer，未发现已实现 upgrade writer；本变更不伪造升级入口，也未验证真实升级在途动作。
- 已有无归属策略不自动转成 HUMAN 策略，不替旧绑定猜测身份；当前全新开发库没有已发布旧 writer，迁移下行遇到已有归属策略时明确拒绝，需停止回滚。
- 接收方自动化还需利用原 HUMAN 管理读取取得引用，在 binding 准入与 adapter 启动之间完成 native-action 配置，然后再走真实 model delivery、activation、seed、inputs、driver。
- 未启动新 receiver 栈，未重启或删除旧栈，未部署生产，未将这些定向验证计为三组件端到端或 V-SCN 验收。
