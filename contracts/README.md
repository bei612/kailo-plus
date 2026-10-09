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
| `compatibility/` | 已发布合同的原始字节归档，仅用于精确识别旧授权摘要；不作为新接口或类型生成输入。`action-submission-v1.json` 来自 `20dbd472b8baa8ff775322c3c72e59f0c1f7933a:contracts/api/action_submission.schema.json`；`v2` 来自 `b9d64ad70ec0079853520faf7ab1ea4bb9830657` 同路径。旧相对 `$ref` 原样保留以保持摘要，不能将归档作为当前位置可解析的活动 schema。 |

`api/delegated_action_metadata_v1.schema.json` 是普通受委托动作的平台元数据输出合同；
通用 BFF 回应增加其他动作的可选字段不改变该合同。旧 `ActionSubmission` 的两份已发布
摘要只在 `agent.invoke`、`automation.run` 与已接入的普通 resource 动作内兼容；仍需匹配
原 action/version、target、tenant、授权期限与状态。组件工具和记忆仍核验各自输出合同，
不能借此接收其他摘要或业务内容。新授权仍只接受新目录的 v1 摘要，旧摘要只供已存在
授权的执行核验；没有迁移或重签现存 DelegationGrant。

## 3. 改动流程

改 schema 后运行 `tools/gen.sh` 更新四侧并提交生成物；`tools/check.sh contract` 重新生成到临时位置并校验同步，以及按 `contracts-v*` 发布 tag 做现有兼容比对。四侧 canary round-trip 在 `tools/check.sh verify` 的既有验证中执行，不由 `contract` 单步代跑。无发布 tag 时兼容比对输出无基线适用对象；具体生成范围与证据边界见 ADR-03。

新增枚举值对读取端是破坏性的，除非读取端已实现未知值降级；当前四侧生成与解析行为见 ADR-03，不能把静态类型或常量集合当作统一的未知值运行时保护。

能力契约 schema 与其他目录遵守同一子集与生成规则；契约键、`type_key` 与枚举值不得含实现产品名，实现来源只记在 `component_type_key`（`DD-88`）。

## 4. 文件原生写入引用的四侧交付记录（2026-10-08）

本批对应 `DD-88`／`DD-94`、design 07 §2.4 已定的
`file_storage.write@v1`，不是新建文件存储能力或执行权威。原 Cells
`gateway/restv2/api-versions.go::Handler.PromoteVersion` 已接入
`gateway/restv2/native-human-upload.go::Handler.platformPromoteVersion`：原 draft
版本、原 owner 和注册 Resource 经既有 HUMAN ActionCommand 提交。
本批 schema 固定该真实输入的 resourceId、nativeObjectRef、nativeRevision、
displayName、mediaType 五字段；正文仍留原存储。输出仅元数据，结果版本必须
沿 Adapter Protocol 原 typed ContentReference 与终态证据交付，不能以空结果、
当前 head、202 或入队 ACK 代替成功。原 nativeObjectRef 为 opaque 引用，
非空、原 actor、scope 与版本合法性由实际消费者校验，不假称 schema 已校验值域。

影响面是两份新 schema、Rust／Go／TypeScript／Dart 四份原生成物和四处原往返
检查。生成入口仍是 `tools/gen.sh`；复用原 file-storage-revision-io 样例中的
同形引用，不增加第二合同或手写类型。无数据库、旧字段、Workflow history、
迁移或客户端呈现改动；新 schema 不改变既有已发布合同。Web 仍经 BFF，
Desktop／Mobile 的管理面仍经 BFF，Mobile 不成为组件宿主。

既有受限 SDK `kailo-client-core-full-fxcd9l`，不可变镜像
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
实际 4 CPU／8 GiB、UID 1000，Data 缓存、Cargo 并行度 16。
原生成、格式、四语言定向往返及 TypeScript 类型检查均退出 0。私有 Go 生成物
故意将 NativeRevision 的 JSON tag 改为 `-`，原往返真实退出 1 并报告冻结版本
丢失；原字节还原、cmp 0 后两项 Go 往返退出 0。四侧 `gen.sh --check`
再次退出 0。日志位于 `/volumes/data/kailo/check-cache/file-write-*-20261008.log`。

原 `tools/check.sh contract` launcher 复用 294 份 pnpm 缓存、下载 0，但
`dart pub get` 在禁网环境仍尝试 pub.dev 并报 socket error，未执行合同步骤；
句柄 66916 清理结束后实际退出 2，不把此轮算通过。复用上述 SDK 和实际原
`step_contract`，显式回到
`/workspace/apps`，用本批暂存 index 的只读快照核对当前 schema 集；句柄
62239 终态 0：四侧同步，相对 `contracts-v0.1.0` 的 293 份 schema
匹配 3 份历史 schema、无破坏性变更。此前旧 index 的 193 份检查和一次错误
工作目录的「尚无 schema」跳过均不作为本批兼容证据。

本批不登记半份 FILE_STORAGE category，不激活 release／binding，不声称原
uploader、native task 执行、审批／额度、外部副作用及原页面端到端均已贯通。
缺 Resource、当前身份、权限、输入版本或真实终态继续 fail closed；不退回默认
root／tenant、不重发结果不明的写入、不伪造上传成功或零字节计量。
原生写入消费和部署须继续提供各自证据；四语言往返不代表组件或生产验收。

## 5. Tenant 成员目录的原版资料字段（2026-10-09）

固定 Buzz `779af8886caae1317b4de962082429867ab61503`，
`desktop/src/features/community-members/ui/CommunityMembersSettingsCard.tsx` 的
`RelayMemberRow` 使用 `createdAt` 呈现 Added 日期，使用成员公钥呈现身份。
Kailo 沿 `DD-82` 原 `/api/v1/role-members` 提供实际 Tenant 成员事实，
不以所选 Workspace 的成员列表冒充整个 Tenant，也不把 HUMAN 管理员映射为
Relay 的 CONTROL owner。

生产者是 `platform_views.rs::list_role_members`：`createdAt` 来自既有
`identity.tenant_membership.created_at`，是成员记录创建时间，不是审批通过或
最近激活时间；`pubkeys` 只取同 Tenant、同 HUMAN Principal 的 ACTIVE
Buzz 绑定并排序。仅 Workspace manage 不返回这两个 Tenant 资料字段。
无有效公钥时省略列表，不使用查看者、其他成员或其他 Workspace 的身份替代。
原分页、SpiceDB 角色读取和动作准入保持原路径，未增加资料写入或权限权威。

两字段均可选；时间沿本目录既定子集用 RFC3339 字符串，不用 date-time 类型。
旧回应缺省保持缺省，非空多公钥列表不拆分成多个 HUMAN。既有四侧生成解析器
忽略未知可选字段；这不代表旧版额外关闭属性的 schema 校验器接受新回应。
数据库没有新增字段、迁移或双写窗口；资料正文及头像仍属于 Buzz，目录公钥
本身不授权任意资料或媒体读取。Web/Desktop 共享消费者，Mobile 仅同步合同。

实现后扩展原四侧 member removal 往返用例，覆盖新字段及旧缺省；原
`role_management` 场景增加与数据库实际创建时间、公钥集合的对照以及
Workspace-only 管理者不泄露这两个字段的断言。后者尚无本批真实拓扑执行
结果，不能用合同往返通过替代 BFF、原版页面或设备验收。

已执行的合同证据位于
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/tenant-directory-20261009.xUdSgp/`：
`contract-native-complete-input.log` 的 Rust 指定往返用例 1 passed、Go 对应用例
退出 0；随后只在私有候选树把 Go `RoleMemberView.Pubkeys` 的 JSON tag 改为
忽略字段，原用例在 `contract-native-negative.log` 实际退出 1 并报
`Member removal permissions lost`。正式源码未施加该破坏。
还原 tag 后，`contract-final-restored-sdk-path.log` 的原 `tools/gen.sh`
四侧生成与 i18n 均成功，Go 恢复复验退出 0；最终生成物已回写本目录对应四侧。
所有执行复用已有 SDK、Data 缓存与实际 4 CPU/8 GiB cgroup，不运行宿主工具链。

一次中间调用误用 login shell 覆盖 SDK PATH，格式化工具不可见，原生成入口
在 `contract-final-restored.log` 报 `TypeScript and Dart ReasonCode enums differ`、
退出 1；修正调用环境后重新生成通过，没有修改合同检查器或绕过该错误。
旧 `tools/check.sh --full` 的 22988 轮仍因禁网下 Dart 依赖准备失败而退出 2，
不把上述限定范围证据记为全量通过。

同一 SDK 中 `cargo check --offline --locked --manifest-path core/Cargo.toml
-p platform-core --test role_management` 最终退出 0，日志
`core-directory-complete-input.log`；该结果是 Core 与既有场景的编译验证，不是
场景运行。首次私有输入漏带原 `model-gateway/crates/protos/proto`，在 build.rs
失败、退出 101，补入原固定源码依赖后重验；未新增或复制成另一协议权威。
