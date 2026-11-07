# ADR-03：Core 与 Worker 的 contract 生成策略

- 状态：已接受
- 日期：2026-09-22
- 决策者：Kailo 实施工程负责人

## 背景

ADR-02 把 `contracts/` 的 JSON Schema 定为唯一权威。按 `00-实施总纲.md` §4 的运行单元划分，取用方跨四门语言：Core/BFF 是 Rust、Application Worker 是 **Go 独立进程**、Buzz Web 与 Buzz Desktop 共用 TypeScript、Buzz Mobile 是 **Dart/Flutter**（`SF-MOB-02`），各 adapter 另有自身语言。`01-工程结构与模块边界.md` §3 明写 Rust、Go、TypeScript 与 adapter 语言不得各自维护同名但不同义的枚举，`03-验证发布与验收门禁.md` §3 的合同一致维度同样按 Rust/Go/TS/adapter 四侧比对。`00-实施总纲.md` Stage 0 退出条件要求「所有语言绑定通过 schema round-trip 与兼容检查，不存在同名异义枚举」。

Core 与 Worker 之间是**跨语言的进程边界**，不是 ADR-02 所述的进程内调用边界。二者共享的是 schema，不是任何一侧的类型定义。

`06-工程基线规范.md` §5 另有一条容易被忽略的约束：**枚举值的新增对读取端是破坏性的，除非读取端已实现未知值降级**。生成类型不等于线格式校验；本 ADR 不把尚无实现的未知值保护写成编译器已经提供的保证。

Worker 还有一条独有约束：`06` §5 要求 Workflow 的任何变更都必须通过录制 history 的 replay 回归。Workflow 的输入、Activity 参数与返回值都已序列化进 history，Worker 侧的 Go 类型若与 schema 漂移，旧 history 的反序列化会在升级时静默改变语义，而 replay 是唯一能发现它的手段。跨语言生成因此不是便利问题，是 replay 正确性的前提。

## 候选方案

**生成物入库**：`contracts/` 改动后运行生成器，生成结果一并提交，CI 校验「重新生成后无 diff」。审阅者能在 PR 里直接看到类型变化。

**构建期生成、不入库**：仓库更干净，但类型变化在 code review 中不可见，且每个开发环境与 CI 都要装齐生成器。

**各语言手写类型 + 一致性测试**：灵活，但把「不存在同名异义枚举」退化成测试覆盖问题，与退出条件的措辞不符。

## 决策

**生成物入库**，由统一检查入口校验同步。

- **生成方向**：当前 `tools/gen.sh` 用锁定的 `quicktype@23.0.171`，输入为 `contracts/canary.schema.json` 与 `domain/`、`api/`、`workflow/` 下的 schema；`enums/` 经 `$ref` 引入、不作为重复的顶层输入。输出四个目标——Rust（`core/crates/contracts/src/generated/`）、Go（`worker/internal/contracts/generated/`）、TypeScript（`client-kit/ts/contracts/src/generated/`，Web 与 Desktop 客户端共用）、Dart（`client-kit/dart/lib/shared/contracts/generated/`）（2026-09-29 按 ADR-16 更新目录）。这不是对 `contracts/` 任意子目录已被生成的声明；Adapter/Host 合同只在其真实切片接入时进入生成范围。生成目录只由生成器写入，不手工编辑。adapter 若使用第五门语言，按同一方式新增生成目标，不得手写类型。
- **Core 与 Worker 同源于 schema**：Worker 是 Go 进程，无法与 Core 共享 Rust 类型。二者的同源性由「同一份 schema、同一次生成、同一个版本号」保证，并由下面的 round-trip 与同步校验证明。Workflow 与 Activity 的输入输出类型只从生成目录取得，Worker 侧禁止手写与 Core 对应的结构体。
- **封闭枚举的实际生成行为**：2026-10-01 核对 `tools/gen.sh` 与四侧生成的 `PlatformSessionAccessMode`，不存在统一的未知值兜底生成。
  - Rust：serde 封闭枚举，未知 wire 值反序列化失败；没有 `#[non_exhaustive]` 或 `Unknown(String)` 兜底。
  - TypeScript：生成静态 `enum`/类型，`--just-types` 不生成运行时反序列化校验；不能以类型断言或编译通过证明外部 JSON 枚举合法。
  - Go：生成具名 string 类型与常量集合，未知字符串可被反序列化；没有生成 `IsKnown()`，当前统一检查入口也未配置 `exhaustive` linter。
  - Dart：生成封闭 `enum` 与值映射，未知 wire 值的查表非空断言会失败；可选枚举缺省在 `tools/gen.sh` 中处理为 null，不把未知值处理成缺省。没有生成 `unknown`、`fromWire`/`toWire` 兜底。
  - 调用方仍须遵守 `06-工程基线规范.md` §4：未知状态与结果不明不得渲染成成功或失败，不得回退默认身份、权限或动作。上述生成事实不证明全部消费点已完成这项保护；新增枚举值仍按 §5 逐端核验兼容，不自动视为安全扩展。
- **round-trip 校验**：当前四侧既有检查针对 `contracts/samples/canary.sample.json` 做「反序列化再序列化」并逐字段比较；由 `tools/check.sh verify` 执行。这证明可用 schema 子集与该样例的四侧往返，不是每个业务 schema、每个枚举或全部异常输入的自动覆盖声明。真实业务载荷的核验随其已有生产切片留下证据，不预建未使用的样例或夹具。
- **同步校验**：统一检查入口重新运行生成器并比对工作树，出现 diff 即失败。
- **兼容校验**：`tools/check.sh contract` 以最新 `contracts-v*` tag 为基线，现有脚本检查删除字段、可选改必填与删除枚举值；无基线时输出无适用对象。它不覆盖新增枚举值导致旧读取端拒绝等全部兼容问题，不能替代 `06-工程基线规范.md` §5 的逐端规则；破坏性变更必须伴随新版本号。

## 后果

正面：类型变化在 PR 中可见；Core、Worker、Web/Desktop、Mobile 四侧类型同源，生成同步可由统一入口复核；新语言接入沿用同一 schema 权威。

负面：改契约要生成并提交结果；生成目录会产生较大的 diff；生成器版本与可用 JSON Schema 子集须受控，子集以 `contracts/README.md` 与 canary 为准。四侧运行时校验并不等价，尤其 TypeScript 的静态类型与 Go 的 string 常量不会拒绝未知 wire 值；不能把生成同步或 canary 往返当作全部未知值边界已验收。

锁定：`contracts/` 的 JSON Schema 方言。放弃：在业务代码里就地定义类型的便利。

## 替换边界

接入第五门语言，或四侧生成器的支持交集无法表达某个 `.design` 合同时重新评估。更换生成器需核对生成目录、统一检查入口及实际消费代码的类型与解析变化；不能预先承诺业务代码不受影响。`contracts/` 的领域语义不随生成器改变。

## 不改变的事

本 ADR 不改变 `.design` 的任何权威划分与能力状态。生成物在任何情况下都不构成第二权威；生成物与 `contracts/` 冲突时以 `contracts/` 为准，`contracts/` 与 `.design/03` 冲突时以 `.design` 为准。
