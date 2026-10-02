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
| `format`: `uuid` | 仅此一种。`uuid` 在四侧都映射为字符串且原样往返 |
| `description` | 生成为各语言的文档注释 |
| `additionalProperties: false` | 所有对象必须显式关闭 |

禁止的构造（任一生成器支持不足或语义在四侧不一致）：

`oneOf`/`anyOf`/`allOf`、元组式 `items` 数组、`patternProperties`、`additionalProperties` 为 schema、`if`/`then`/`else`、`not`、`dependentSchemas`、`const`、数值/字符串约束（`minimum`、`maxLength`、`pattern` 等）。

**`format: date-time` 也被排除**，这是 canary 实测的结果而非预设：Dart 的 `DateTime.toIso8601String()` 强制补足毫秒，`2026-09-22T16:30:00Z` 往返后变成 `...:00.000Z`，与另外三侧不等价。时间戳一律按普通 `string` 传输，约定 RFC3339，取值合法性由 Core 在 Admission 校验。

约束不是不需要，而是**不由 schema 承担**：值域约束属于领域规则，由 Core 在 Admission 中校验并映射到 `06-工程基线规范.md` §4 的 `DENIED` 或 `CONFLICT`，不依赖各语言生成器各自实现的校验。

变体类型（原本会用 `oneOf` 表达的）一律改为「封闭枚举 tag + 各变体字段全部可选」的平坦结构，由领域代码按 tag 解释。这牺牲了 schema 层的穷尽性，换取四侧生成结果一致。

## 2. 目录

| 目录 | 内容 |
|---|---|
| `enums/` | 全部封闭枚举与 reason code，单点定义 |
| `domain/` | `.design/03` 的实体与状态 |
| `api/` | BFF query / semantic command / stream |
| `adapter/` | Adapter Protocol（与能力类别无关的线协议层） |
| `adapter/<category>.vN/` | 能力契约 schema：`<category>` 为 Catalog 登记的能力类别键，预置 `file_storage`、`knowledge`、`data_query`（`DD-102`、`DD-103`），`vN` 为契约版本。按 `.design/07` §2.4 的 v1 契约键固定参数/结果 schema、错误映射与到 SpiceDB permission 的映射，是该契约与其一致性套件的唯一权威；契约键增删或语义变化只以新版本目录发布（`DD-88`）。schema 文件随 `EXT-BASE` 的能力模型实现建立 |
| `component-host/` | Component manifest 与 Host API |
| `workflow/` | Workflow input、Update/Signal、projection、ExternalExecution |

## 3. 改动流程

改 schema 后运行 `tools/gen.sh` 更新四侧并提交生成物；`tools/check.sh contract` 重新生成到临时位置并校验同步，以及按 `contracts-v*` 发布 tag 做现有兼容比对。四侧 canary round-trip 在 `tools/check.sh verify` 的既有验证中执行，不由 `contract` 单步代跑。无发布 tag 时兼容比对输出无基线适用对象；具体生成范围与证据边界见 ADR-03。

新增枚举值对读取端是破坏性的，除非读取端已实现未知值降级；当前四侧生成与解析行为见 ADR-03，不能把静态类型或常量集合当作统一的未知值运行时保护。

能力契约 schema 与其他目录遵守同一子集与生成规则；契约键、`type_key` 与枚举值不得含实现产品名，实现来源只记在 `component_type_key`（`DD-88`）。
