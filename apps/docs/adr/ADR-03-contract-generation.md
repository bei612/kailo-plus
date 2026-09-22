# ADR-03：Core 与 Worker 的 contract 生成策略

- 状态：已接受
- 日期：2026-09-22
- 决策者：Kailo 实施工程负责人

## 背景

ADR-02 把 `contracts/` 的 JSON Schema 定为唯一权威。按 `00-实施总纲.md` §4 的运行单元划分，取用方跨四门语言：Core/BFF 是 Rust、Application Worker 是 **Go 独立进程**、Buzz Web 与 Buzz Desktop 共用 TypeScript、Buzz Mobile 是 **Dart/Flutter**（`SF-MOB-02`），各 adapter 另有自身语言。`01-工程结构与模块边界.md` §3 明写 Rust、Go、TypeScript 与 adapter 语言不得各自维护同名但不同义的枚举，`03-验证发布与验收门禁.md` §3 的合同一致维度同样按 Rust/Go/TS/adapter 四侧比对。`00-实施总纲.md` Stage 0 退出条件要求「所有语言绑定通过 schema round-trip 与兼容检查，不存在同名异义枚举」。

Core 与 Worker 之间是**跨语言的进程边界**，不是 ADR-02 所述的进程内调用边界。二者共享的是 schema，不是任何一侧的类型定义。

`06-工程基线规范.md` §5 另有一条容易被忽略的约束：**枚举值的新增对读取端是破坏性的，除非读取端已实现未知值降级**。生成策略必须在类型层面把这条落实，而不是靠每个调用点自觉处理。

Worker 还有一条独有约束：`06` §5 要求 Workflow 的任何变更都必须通过录制 history 的 replay 回归。Workflow 的输入、Activity 参数与返回值都已序列化进 history，Worker 侧的 Go 类型若与 schema 漂移，旧 history 的反序列化会在升级时静默改变语义，而 replay 是唯一能发现它的手段。跨语言生成因此不是便利问题，是 replay 正确性的前提。

## 候选方案

**生成物入库**：`contracts/` 改动后运行生成器，生成结果一并提交，CI 校验「重新生成后无 diff」。审阅者能在 PR 里直接看到类型变化。

**构建期生成、不入库**：仓库更干净，但类型变化在 code review 中不可见，且每个开发环境与 CI 都要装齐生成器。

**各语言手写类型 + 一致性测试**：灵活，但把「不存在同名异义枚举」退化成测试覆盖问题，与退出条件的措辞不符。

## 决策

**生成物入库**，由统一检查入口校验同步。

- **生成方向**：`contracts/**/*.schema.json` 生成四个目标——Rust（`core/crates/contracts/src/generated/`）、Go（`worker/internal/contracts/generated/`）、TypeScript（`web/packages/contracts/src/generated/`，Buzz Web 与 Buzz Desktop 共用）、Dart（`mobile/lib/shared/contracts/generated/`）。生成目录只由生成器写入，文件头声明不得手工编辑。adapter 若使用第五门语言，按同一方式新增生成目标，不得手写类型。
- **Core 与 Worker 同源于 schema**：Worker 是 Go 进程，无法与 Core 共享 Rust 类型。二者的同源性由「同一份 schema、同一次生成、同一个版本号」保证，并由下面的 round-trip 与同步校验证明。Workflow 与 Activity 的输入输出类型只从生成目录取得，Worker 侧禁止手写与 Core 对应的结构体。
- **封闭枚举的降级**：每个来自 `contracts/enums/` 的枚举一律生成带兜底分支的类型。
  - Rust：`#[non_exhaustive]` 枚举加 `Unknown(String)` 变体，缺失分支由编译器拒绝。
  - TypeScript：字面量联合加 `string & {}` 兜底，缺失分支由编译器拒绝。
  - Go：具名 string 类型加常量集合，另生成 `IsKnown()`。Go 的 `switch` 不做穷尽性检查，因此这一侧由 `exhaustive` linter 在统一检查入口中强制，并要求每个 `switch` 显式写出 `default`。
  - Dart：`enum` 加 `unknown` 成员与 `fromWire`/`toWire`。Dart 的 `switch` 对 enum 有穷尽性检查，但仅当不写 `default` 时成立，因此生成代码不得写 `default`，由分析器保证缺失分支被拒。
  - Go 是四侧中唯一不由编译器或分析器保证穷尽性的一侧，需要 linter 补齐。
  - 兜底分支的运行时行为按 `06-工程基线规范.md` §4 映射到 `UNKNOWN` 类，禁止当作成功或失败处理。
- **round-trip 校验**：每个 schema 生成一组样例，在 Rust、Go、TypeScript、Dart 四侧各做一次「反序列化再序列化」，结果必须与样例逐字段相等，且四侧结果互等。校验随统一检查入口执行。
- **同步校验**：统一检查入口重新运行生成器并比对工作树，出现 diff 即失败。
- **兼容校验**：与上一个已发布版本的 schema 比对，破坏性变更必须伴随新版本号，规则见 `06-工程基线规范.md` §5。

## 后果

正面：类型变化在 PR 中可见；跨语言的 Core、Worker、Web/Desktop、Mobile 四侧不分叉；未知枚举值的降级在 Rust 与 TypeScript 由编译器强制而非约定；新语言接入只需新增一个生成目标。

负面：改契约要多跑一步生成并提交结果；生成目录会在 PR 中产生体量较大的 diff；生成器本身成为需要版本锁定的依赖，且需覆盖四门语言——可用的 JSON Schema 子集是四个生成器支持范围的交集，必须在编写第一个 schema 之前固定并写入 `contracts/README.md`，否则会写出某一侧生成不出来的 schema；Go 侧的枚举穷尽性依赖 linter 而非编译器，linter 失效时这层保护会静默消失，因此它在统一检查入口中不得标记为可选步骤。

锁定：`contracts/` 的 JSON Schema 方言。放弃：在业务代码里就地定义类型的便利。

## 替换边界

接入第五门语言，或四个生成器的支持交集收窄到无法表达某个 `.design` 合同时重新评估。更换生成器需要改动生成目录与统一检查入口的对应步骤，`contracts/` 本身与业务代码不受影响。

## 不改变的事

本 ADR 不改变 `.design` 的任何权威划分与能力状态。生成物在任何情况下都不构成第二权威；生成物与 `contracts/` 冲突时以 `contracts/` 为准，`contracts/` 与 `.design/03` 冲突时以 `.design` 为准。
