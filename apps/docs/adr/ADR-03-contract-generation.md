# ADR-03：Core 与 Worker 的 contract 生成策略

- 状态：已接受
- 日期：2026-09-22
- 决策者：Kailo 实施工程负责人

## 背景

ADR-02 把 `contracts/` 的 JSON Schema 定为唯一权威。Core（Rust）、Worker（Rust）、Buzz Web（TypeScript）与各 adapter 都要从它取得类型。`00-实施总纲.md` Stage 0 退出条件要求「所有语言绑定通过 schema round-trip 与兼容检查，不存在同名异义枚举」。

`06-工程基线规范.md` §5 另有一条容易被忽略的约束：**枚举值的新增对读取端是破坏性的，除非读取端已实现未知值降级**。生成策略必须在类型层面把这条落实，而不是靠每个调用点自觉处理。

Worker 还有一条独有约束：`06` §5 要求 Workflow 的任何变更都必须通过录制 history 的 replay 回归。Worker 侧的类型若与 Core 不同源，历史 history 的反序列化会在升级时静默改变语义。

## 候选方案

**生成物入库**：`contracts/` 改动后运行生成器，生成结果一并提交，CI 校验「重新生成后无 diff」。审阅者能在 PR 里直接看到类型变化。

**构建期生成、不入库**：仓库更干净，但类型变化在 code review 中不可见，且每个开发环境与 CI 都要装齐生成器。

**各语言手写类型 + 一致性测试**：灵活，但把「不存在同名异义枚举」退化成测试覆盖问题，与退出条件的措辞不符。

## 决策

**生成物入库**，由统一检查入口校验同步。

- **生成方向**：`contracts/**/*.schema.json` → Rust 类型（`core/crates/contracts/src/generated/`）与 TypeScript 类型（`web/packages/contracts/src/generated/`）。生成目录只由生成器写入，文件头声明不得手工编辑。
- **Core 与 Worker 同源**：Worker 与 Core 依赖同一个 `contracts` crate，不各自生成。Workflow 与 Activity 的输入输出类型只从该 crate 取得。
- **封闭枚举的降级**：每个来自 `contracts/enums/` 的枚举一律生成带兜底分支的类型——Rust 生成 `#[non_exhaustive]` 枚举加 `Unknown(String)` 变体，TypeScript 生成联合类型加 `string & {}` 兜底。调用点必须处理兜底分支，这由编译器强制，而不是由评审强制。兜底分支的运行时行为按 `06-工程基线规范.md` §4 映射到 `UNKNOWN` 类，禁止当作成功或失败处理。
- **round-trip 校验**：每个 schema 生成一组样例，在 Rust 与 TypeScript 两侧各做一次「反序列化再序列化」，结果必须与样例逐字段相等。校验随统一检查入口执行。
- **同步校验**：统一检查入口重新运行生成器并比对工作树，出现 diff 即失败。
- **兼容校验**：与上一个已发布版本的 schema 比对，破坏性变更必须伴随新版本号，规则见 `06-工程基线规范.md` §5。

## 后果

正面：类型变化在 PR 中可见；Core 与 Worker 不分叉；未知枚举值的降级由编译器强制而非约定；新语言接入只需新增一个生成目标。

负面：改契约要多跑一步生成并提交结果；生成目录会在 PR 中产生体量较大的 diff；生成器本身成为需要版本锁定的依赖。

锁定：`contracts/` 的 JSON Schema 方言。放弃：在业务代码里就地定义类型的便利。

## 替换边界

接入一门无可用 JSON Schema 生成器的语言时重新评估。更换生成器需要改动生成目录与统一检查入口的对应步骤，`contracts/` 本身与业务代码不受影响。

## 不改变的事

本 ADR 不改变 `.design` 的任何权威划分与能力状态。生成物在任何情况下都不构成第二权威；生成物与 `contracts/` 冲突时以 `contracts/` 为准，`contracts/` 与 `.design/03` 冲突时以 `.design` 为准。
