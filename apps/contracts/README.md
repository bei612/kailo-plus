# Contracts

`contracts/` 是 `.design/03-领域模型与权限模型.md` 的可执行投影，也是 Rust、Go、TypeScript、Dart 四侧类型的**唯一权威**（ADR-02、ADR-03）。它不是第二权威：与 `.design` 冲突时以 `.design` 为准。

## 1. 可用的 JSON Schema 子集

ADR-03 要求四门语言由同一 schema 生成。四个生成器支持的构造不同，取交集是硬约束——写出某一侧生成不出来的 schema，会在该端接入时才暴露。

子集**不以文字声明定义，以 `canary.schema.json` 定义**：该文件穷举允许使用的每一种构造，四侧生成器必须全部生成成功并通过 round-trip。子集即「canary 能过的东西」。

允许的构造：

| 构造 | 说明 |
|---|---|
| `type`: `object`/`string`/`integer`/`number`/`boolean`/`array` | 基础类型；不使用 `null` 类型，可空以 `?` 后缀字段加 `required` 省略表达 |
| `properties` + `required` | 对象字段；未在 `required` 中的字段是可选 |
| `enum`（字符串字面量） | 封闭枚举，一律定义在 `enums/` 并以 `$ref` 引用 |
| `$ref`（同仓相对路径） | 跨文件引用；不使用远程 `$ref` |
| `items`（单一 schema） | 同构数组 |
| `format`: `date-time`/`uuid` | 仅这两种 |
| `description` | 生成为各语言的文档注释 |
| `additionalProperties: false` | 所有对象必须显式关闭 |

禁止的构造（任一生成器支持不足或语义在四侧不一致）：

`oneOf`/`anyOf`/`allOf`、元组式 `items` 数组、`patternProperties`、`additionalProperties` 为 schema、`if`/`then`/`else`、`not`、`dependentSchemas`、`const`、数值/字符串约束（`minimum`、`maxLength`、`pattern` 等）。

约束不是不需要，而是**不由 schema 承担**：值域约束属于领域规则，由 Core 在 Admission 中校验并映射到 `06-工程基线规范.md` §4 的 `DENIED` 或 `CONFLICT`，不依赖各语言生成器各自实现的校验。

变体类型（原本会用 `oneOf` 表达的）一律改为「封闭枚举 tag + 各变体字段全部可选」的平坦结构，由领域代码按 tag 解释。这牺牲了 schema 层的穷尽性，换取四侧生成结果一致。

## 2. 目录

| 目录 | 内容 |
|---|---|
| `enums/` | 全部封闭枚举与 reason code，单点定义 |
| `domain/` | `.design/03` 的实体与状态 |
| `api/` | BFF query / semantic command / stream |
| `adapter/` | Adapter Protocol |
| `component-host/` | Component manifest 与 Host API |
| `workflow/` | Workflow input、Update/Signal、projection、ExternalExecution |

## 3. 改动流程

改 schema 后运行 `tools/check.sh contracts`：重新生成四侧、比对工作树无 diff、跑 canary 与 round-trip、与上一个已发布版本做兼容比对。生成物入库，改动在 PR 中可见。

新增枚举值对读取端是破坏性的，除非读取端已实现未知值降级；四侧的降级形态见 ADR-03。
