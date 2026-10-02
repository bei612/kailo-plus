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

改 schema 后用镜像内原 `tools/gen.sh` 生成四侧，再运行 `tools/check.sh contract`：检查生成物同步及与上一个已发布版本的兼容；canary 与 round-trip 由既有 `verify` 步骤承担。生成物入库，改动在 PR 中可见。执行环境遵守工程根 `07-运行与运维基线.md` §2.1，不调用宿主工具链。

新增枚举值对读取端是破坏性的，除非读取端已实现未知值降级；四侧的降级形态见 ADR-03。

能力契约 schema 与其他目录遵守同一子集与生成规则；契约键、`type_key` 与枚举值不得含实现产品名，实现来源只记在 `component_type_key`（`DD-88`）。

## 4. 本次实际生成记录（2026-10-02 UTC）

基线 `e4c544fdb63d5e54fe775d58e684249166c89543` 的独立 Data 候选 `codex-delete-commit-candidate-20261002.KBSv5P` 选择已写的 Tenant 删除/AgentDefinition 真实消费所需 schema，不复制其他 Quota 或会话功能。四项删除 EvidenceKind、Advance 请求/结果、子流程枚举及实际 Resource/定义/ActionCommand 消费由同一 schema 生成 Rust、Go、TypeScript、Dart 类型；四项证据文案来自共用 TypeScript i18n，Mobile catalog 由原入口同步。

真实消费揭示两项不能被“生成成功”掩盖的边界：`enums/` 不单独传给生成器，孤立 `PlatformSessionAccessMode` 不会输出类型；Core 实际 `E0432` 后纳入现有 Session schema 必填 `accessMode` 与 `$ref`，原入口重新生成。同名 `FAILED` 使 Go 生成名改为 `TaskStatusFAILED`，已同步五处现有消费者，JSON 值不变。Customer-only 的既有错误映射还实际报缺 `BindingNotActive`、`RateLimited`；候选只接入这两枚举和同源文案，不含 Quota 新功能。

Session 闭合后的 `tools/gen.sh`、`tools/gen.sh --check` 实际退出 0，四侧与 Mobile catalog 同步；不可变镜像 `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，实际 2 CPU/4 GiB、无额外 swap。原件 `/volumes/data/kailo/tmp/codex-delete-candidate-final-gen-20261002.gbGlPy/{preflight,limits,generate,exit}.log`。此前两次 Core 编译 101 与 Worker 消费失败 1 保留于 [Tenant 删除记录](../core/verify/tenant-deletion.md)；没有手写类型、修改生成器或新增夹具绕过真实消费者。

两项 Customer reason code 纳入后，原 `gen → --check` 再次实际退出 0，四侧与 Mobile catalog 同步；同一不可变 SDK、UID/GID 1000、实际 2 CPU/4 GiB、无额外 swap，原件 `/volumes/data/kailo/tmp/codex-delete-candidate-reasons-gen-20261002.1ReYtS/{preflight,limits,generate,exit}.log`。此前 Worker 0 不是这一版生成字节的再验证，不重复计通过。

这次生成校验不是四侧双向序列化、历史兼容、完整 Core 编译或业务链验收；这些由批末已有门禁分别取实际证据。候选尚未提交或部署，旧产物不能仅因 schema 名称相同就视为使用了本次生成字节。
