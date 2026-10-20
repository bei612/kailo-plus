# ADR-21：契约生成物的类型表示、类型复用与命名

- 状态：已接受（补充 ADR-03 的生成方式；ADR-03 的生成方向、入库与校验决策不变）
- 日期：2026-10-20
- 决策者：Kailo 实施工程负责人

## 背景

ADR-03 规定四侧类型由 `contracts/` 经 `tools/gen.sh`（quicktype 23.0.171）生成。近期多次 CI 失败与返工
都来自生成物与线上数据或彼此之间不一致，而不是来自 schema 本身：

1. **date-time**：12 份 schema 用了 `format: date-time`（`contracts/README.md` §1 本已把它排除在子集外，
   但未被执行）。quicktype 把它生成为 TS `Date`、Go `time.Time`、Dart `DateTime`，Rust 则是 `String`。
   BFF 的 JSON 里只有字符串，TS 以 `--just-types` 生成、没有任何转换器，于是类型声明是 `Date`、运行时
   拿到的是字符串；测试夹具只能写 `new Date(...)` 才能通过类型检查，与生产数据形状相反。Dart 的
   `DateTime.toIso8601String()` 把 `...:00Z` 改写为 `...:00.000Z`，往返不等价。
2. **`$ref` 目标被另起类型名**：分页回应的 `items` 以 `$ref` 指向视图 schema，四侧却都多出一个同形
   类型（`HuddlePageItem` 对 `HuddleView`、`GrantElement`、`EventElement` 等，每侧约 40 个）。调用方
   只能逐字段搬运（`huddle.rs::page_item`）或经 `serde_json::to_value/from_value` 中转
   （`delegation_query.rs`）。CI 节点实测根因：各 schema 的 `$id` 是相对 `contracts/` 的路径
   （`api/huddle_view.schema.json`），而 `gen.sh` 在工程根以 `contracts/api/...` 传入顶层文件；
   quicktype 加载顶层用命令行路径、解析 `$ref` 用 `$id` 基准，两条路径到达同一文件被当成两个位置。
3. **命名**：TS/Go 写 `WebGIFItem`、`MCPResultKind`，Rust/Dart 写 `WebGifItem`、`McpResultKind`；没有
   `title` 的内联 object/enum 由 quicktype 按属性名推断类型名，冲突时各语言分别加
   `Purple`/`Fluffy`/`Class`/`Element`/`Enum` 等前后缀（例如同一类型 Rust 叫 `ReferenceElement`、TS 叫
   `ContentReferenceElement`）；取值相同的枚举被 quicktype 合并后拼出 `ProjectsGitQueryReView`
   这类名字。新增任何一个 schema 都会改变推断名的冲突集合，既有类型随之改名。

## 决策

### 1. date-time：线上与四侧生成物一律是 RFC3339 字符串

- 线格式：RFC3339 字符串。Core 产生的时间戳为 UTC、以 `Z` 结尾；个别契约另有精度要求的（例如协议写入
  观测的秒粒度 UTC，`.design/18`）由该契约的消费者校验，不由类型承担。
- schema 继续写 `"type": "string", "format": "date-time"`，作为文档与 schema 校验器的取值约束。
- 生成：`gen.sh` 对四侧统一加 `--no-date-times`，四侧都生成字符串类型（Rust `String`、Go `string`、
  TS `string`、Dart `String`）。生成物与线上数据逐字一致，四侧往返按字节等价。
- 解析：需要时间运算或比较的调用方在自己的领域边界上解析（Rust `chrono`/`time` 的 RFC3339 解析、Go
  `time.Parse(time.RFC3339Nano, …)`、TS `Date.parse`、Dart `DateTime.parse`），解析失败按该契约的错误
  处理。不选择在 BFF 客户端统一解析为 `Date`：Web、Desktop 与 Mobile 都只把时间交给格式化与排序，
  统一解析会让生成类型与线格式再次分叉，且 Rust、Go 没有对应的「客户端」层。
- 取代 `contracts/README.md` §1 对 `format: date-time` 的排除：它现在属于子集，含义即上述字符串约定。

### 2. `$ref` 目标在四侧只对应一个类型名

`gen.sh` 先运行 `tools/contracts-prepare.py`，在临时目录写出参与生成的 schema 副本，quicktype 只读
这份副本（`contracts/` 本身不变）：

- 删除每个文件根部的 `$id`，`$ref` 一律按文件路径解析；并在副本目录内以相对路径传入顶层文件。同一份
  schema 无论经顶层还是 `$ref` 到达都是同一个类型，名字取其 `title`。
- 实验比较过的其他办法：只在 `contracts/` 目录内运行可消除大部分重复，但依赖每个 `$id` 与路径一致
  （现有 3 个文件不一致，其中一个是 `urn:`）；把所有 schema 合并为一个 `definitions` 文档需要改写
  全部 `$ref`，收益相同而改写面更大；quicktype 23.0.171 没有控制 `$ref` 复用的选项。

### 3. 命名规则

- **规范类型名**：每个具名类型（带属性的 object、字符串 enum/const）的名字是 schema 的 `title`。
  - 文件根必须有 `title`。
  - 没有 `title` 的内联 object/enum/const 由预处理补上：`<所属类型名><属性名 PascalCase>`；数组元素再
    加 `Item`；`$defs`/`definitions` 用键名；`oneOf`/`anyOf`/`allOf` 分支与所属类型是同一个类型。
    作者需要更好的名字时在 schema 中显式写 `title`。
  - 取值集合相同的枚举在 quicktype 中是同一个类型。预处理把它们统一为一个名字：有作者命名时取作者的
    名字，否则取路径序第一处的生成名；两个不同的作者命名落在同一取值集合上时生成失败，由作者合并到
    `enums/` 下的一个枚举或区分取值。被多处使用的枚举仍应按 `contracts/README.md` §1 放进 `enums/`。
  - 同一个 `title` 只能出现在形状相同的 schema 上（同一类型在多处内联）；同名异形时生成失败。
- **各语言**：
  - Rust、TypeScript、Dart：类型名逐字等于规范类型名，缩写按普通单词处理（`WebGifItem`、
    `McpResultKind`）。TS 为此使用 `--acronym-style camel`（quicktype 的 `pascal` 选项实际写成全大写）。
  - Go：规范类型名按 Go 惯例把 quicktype 内置缩写表中的词全大写（`WebGIFItem`、`MCPResultKind`、
    字段 `ID`、`TTL`、`URL`）。quicktype 的 Go 后端没有关闭开关，且这是 Go 的通行写法；映射是机械的，
    跨语言检索时忽略大小写即可对齐。
  - 字段名：Rust 为 snake_case，Go 为 PascalCase（含缩写规则），TS 与线上 JSON 键逐字相同，Dart 为
    lowerCamel；枚举成员名由各语言后端按惯例生成，取值始终是线上字面量。
- 结果（CI 节点实测，见「验证」）：Rust、TS、Dart 三侧类型名集合完全相同；Go 只在缩写大小写上不同；
  不再出现 `Element`、`Class`、`Purple`/`Fluffy` 一类的冲突名。

### 4. 迁移

- 一次性迁移，不保留两套类型：生成器改动、四份生成物与全部调用方在同一合并批次进入主干，旧类型名不
  留别名或兼容层。被删除的旧名在调用方中出现即编译失败，由编译器列全清单。
- 删除为绕开上述问题写的转换代码：例如 `huddle.rs` 的 `page_item` 逐字段搬运、`delegation_query.rs`
  的 `from_value` 中转、TS 测试里为满足 `Date` 类型写的 `new Date(...)`、Go/Dart 中把生成的时间类型
  再格式化回字符串的代码。
- 线格式不变：只有生成物的类型名与时间字段的本地类型变化，JSON 键与值不变，无数据库迁移、无
  Workflow history 兼容问题（时间字段在 history 中本就是 RFC3339 字符串，现在按字符串反序列化）。
- 生成物只由 `kailo-ci gen <commit>` 产出后应用，不手写。
- 多处内联、取值相同的枚举在 schema 中补作者 `title`（本次为协议会话的 `ProtocolSessionMode`、
  `ProtocolSessionTheme`、`ProtocolSessionLocale`），不让客户端常用的类型落到路径序生成名上；只加
  `title`，字段、必填与取值不变。
- 不在本次范围：Core 中把库内 jsonb 与类型化视图拼成 `json!` 再 `from_value::<contracts::…>` 校验整页的
  写法（`automation_query.rs`、`agent_memory.rs`、`component_release.rs`、`platform_views.rs` 的
  `DiscoverableWorkspace` 等）是对库内 JSON 的契约校验，不依赖重复类型名，留待各自模块改为类型化构造。

## 后果

正面：生成类型与线上数据一致，测试夹具与生产数据同形；`$ref` 指向的类型在四侧只有一个名字，调用方
不再逐字段转换；类型名由 schema 结构确定，新增 schema 不会让既有类型改名（同值枚举无作者命名时取路径序第一处
的生成名，是唯一例外，应以作者 `title` 消除）；Rust/TS/Dart 类型名逐字相同。

负面：本次迁移改名面大；需要时间运算的调用方要自己解析字符串；生成链路多一个预处理步骤；Go 的类型名
仍与其他三侧在缩写大小写上不同。

## 替换边界

更换生成器或升级 quicktype 时，以「四侧类型名集合（Go 按缩写规则归一后）相同、无重复同形类型、时间字段
为字符串」为验收条件重新运行比较；预处理脚本只依赖 JSON Schema 本身，不依赖 quicktype 内部。

## 验证

CI 节点（quicktype 23.0.171，与 `gen.sh` 固定版本相同）在 `fe06d26e5` 的 `contracts/` 上实测：
原生成每侧 689 个类型，新生成每侧 556 个（Dart 另有生成器自带的 `EnumValues` 辅助类）；
`HuddlePage.items` 在四侧都是 `HuddleView` 的数组；四侧不再出现 `Date`、`time.Time`、`DateTime`。

迁移在 CI 节点的固定 SDK 镜像（`tools/check.Dockerfile` 配方）内、对分支提交重新生成后核对：
`tools/gen.sh` 与 `--check` 退出 0；Rust `cargo check --all-targets`、`clippy -D warnings`、
`cargo test --workspace --bins --lib` 与 `-p contracts` 通过；Go `go build`、`go vet`、`go test ./...`
（含 replay 回归）与 `gofmt` 通过；TypeScript `pnpm -r typecheck`、`pnpm -r test`、Web `typecheck` 与
vitest 通过；Dart `dart analyze`、`dart test`（四侧 round-trip 现在逐字节相等，删除了按「同一时刻」
比较的归一化）通过。Desktop 在该镜像中缺 Tauri 依赖，只核对到迁移文件无类型错误；Mobile 需要 Flutter
SDK，该镜像没有，Mobile 的改名与时间字段改动按源码逐处核对，需在 Mobile 构建中复核。需要数据库的
集成测试由合并后的 verify/full 承担。

## 不改变的事

本 ADR 不改变 `.design` 的任何权威划分与能力状态，不改变 ADR-03 的生成方向、生成物入库、round-trip、
同步与兼容校验，也不改变任何 schema 的线格式。
