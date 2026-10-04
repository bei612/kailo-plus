# AgentDefinition 与 Resource owner 实现核验

## 2026-10-03 10:46 UTC 源码阶段 push 与最终固定输入检查

源码与后置检查阶段已普通 push 为
`b16e6dea2a03128956028bb12d4fd3c2c33242c4`；本地与远端 main 精确一致。
相对 `4b44ac6b266345fbc19e3c315df5c3d9bd0af00b` 为 81 文件、8608+/660-。
三处 UNKNOWN 修复与实际新 Web 来源已在该提交，不包含 NEXT ReplyPolicy、
nullable-list 生成器修正或无认证提供方创建增量。push 没有额外图谱或构建门禁。

新 Win11 原 helper 13848 实际退出 0，原 MSVC release 3m28s、NSIS x64 导出完成；
15,087,570 字节文件独立 SHA 与原 record 为
`b05f16f10dcde1e0044959ab7f18f2a4c4482ec2596278825659293b141f2725`。
真实安装包 source/artifact 更新后，固定树
`a7b752937d5536ff6b1189defca5ffa42d3264e3` 的原
`tools/check.sh --full`（session 43116）实际退出 0，输出末尾 `全部通过。`。
SDK 10ad、实际 4CPU/8GiB、swap0、Cargo16、Data 缓存；
没有宿主工具链、GitNexus、降低 Cargo 并行度或重建已完成的客户端。
142 schema、四侧生成与兼容、Core/Worker 与 replay、18 条追溯、
六份上游来源和六个当前源码产物通过；本次供应链检查实际发现两组证明。
数据库及实际 `.env` 预检仍 SKIP，三项外部演练 ignored，未安装 gitleaks 而用原内置扫描。

原件：`/volumes/data/kailo/tmp/codex-agent-management-close-20261003.8e3wdG/full-final.log`，
SHA-256 `233641a20064aa24729531f7b14e2b3e1faefb21ed1830f1002178f0e9d01e06`。
阶段文档快路径原件 `checkpoint-docs.log` 实际退出 0，SHA-256
`5d23f7540db9acdcf1ed31577d2e0850f2cc83effeecb43e033f44c15f5e2ca8`。
此前 full1、修正 full0 与两次断言错误均保留，不用本次结果改写历史。
安装包仍 unsigned，未 Win11 安装/登录/持钥；尚未部署本管理批或执行真实
Agent/LLM/工具/Memory/计量终态，生产就绪与端侧验收门禁未解除。

## 2026-10-03 10:05 UTC 完整检查通过与 UNKNOWN 真实修复

固定树 `0c07ea4e6c8031ce0dac47403c676c597fda58cc` 的原
`tools/check.sh --full` 实际退出 0。原件
`codex-agent-management-close-20261003.8e3wdG/full-corrected.log`
SHA-256 为 `7168e61efcf5f96237bdb3c62ef0809f3e05859add72141eebae42577ca69605`。
132 schema、四侧兼容、Core/Go/TS/Dart、replay、18 条追溯、20 份发布证明、
六份来源和 28 服务静态边界通过。数据库与真实配置仍 SKIP，三项外部演练
ignored、gitleaks 未安装，Win11 unsigned/设备与 Mobile 签名缺口未关闭。
本结果不证明 Installation ACTIVE、真实模型调用、计量或三端业务验收。

实现后交叉复核定位到同一 TS 管理页三处真实错误：首次请求已 UNKNOWN，
后续同键重查返回 403/409 却释放原 intent 和锁。现在 Installation、
Delegation 和 Version 共用原状态语义，重查失败不改变原未知结果，
不生成替代幂等键；首次明确拒绝仍按原行为解锁。
依据为 AGENTS 规则10、06 §4 与 DD-25/50/66/67；影响仅为三个现有管理消费者，
不变更契约、事务、权限、Workflow、SecretRef 或 Mobile 只读边界。
并发沿原 inFlight，原 AE/operation 不符仍保持未知，只有同一请求可核验结果
才解除未知；权限撤回后的拒绝不能用来推断已派发动作的终态。

先修生产逻辑，再在既有 pages 文件追加12项检查。三消费者类型检查和原平台
完整目标 148/148 实际退出 0；私有 SDK 中删除三处生产 UNKNOWN catch guard，
六项 UNKNOWN/TransportError→403→409 用例实际失败，Vitest 退出 1。
精确还原源后，三类型与完整148项再次退出 0。源
`agents.tsx` SHA 为
`837ce00e541ff886cad8cc0900075a12bee5371e1390ffd01893f3d87be1cd29`，
后置检查最终 SHA 为
`f1e91fcd4c80b6d3c9cdb05e571e921249c8b1d5b99b27a40b9d4edc4f0bf55f`。
原件位于 `codex-shared-management-unknown-fix-20261003.Ew1h5v`：
`sdk-mutation-unknown-guards.log` SHA 为
`51692f39310a38c65bc4fee3b2c7d0c6a19f63ad77266d09dd673909bd6c74d2`，
`sdk-restored-final.log` SHA 为
`e534e8550feea30701f8a59f6d58754ff58afb59611f93ae149c8c484604f277`。
首次导出遗漏不存在的 .npmrc，以及随后测试断言误解编辑表单的导航锁和
错写 Cancel 文案的失败均保留，不改记生产反例或通过；还原后验证已终结。
上述新 TS 修复不在前述完整检查树中，对应原 Web/Win11 helper 正在集中构建；
本批源码与后置核验作阶段提交；Win11 新包尚未完成，最终 full 与部署另据实际结果记录。

## 2026-10-03 09:25 UTC 实现后支持边界与真实 Gateway 产物

Installation 选定格式化源码 SHA-256 为
`c4b6810ae183890c0481dab5aff55de4cbf9dfcdb0b3ca01536a532813003d10`。
原不可变检查 SDK 中单个既有 binary 目标实际 0→101→0：
`partial_fields_converge_without_claiming_unimplemented_policy` 正常与还原均
1 passed、56 filtered；仅删除生产支持 guard 后伪 reply 断言实际失败。
原件位于 `codex-installation-effective-evidence-20261003.s7ruVj`，
`sdk-baseline-bin.log` SHA-256 为
`9f01eb71ba19783caa01640f1597cc8ddc4c30b4685ebf87e8f6069fcb2c0f37`，
`sdk-mutation.log` 为
`13b588606da3431168b83199803a369be09db1a8f80bf89b97de663694453043`，
`sdk-restored.log` 为
`466e4262c51cc28bdd949945c12b2f82a70dcaa94eba272632adcab415720505`。
首个误用 --lib 的 101 不是 guard 反例，原日志保留。SDK 已清理，源逐字还原；
这不是其余56项、真实安装、Capacity并发或 Agent 首 turn 验收。

Gateway 原产物输入失配仅为 htpasswd fork README 的 CRLF/LF 字节：Git 实际
LF 与选定导出相同，四个 Rust 源未变。沿原 helper 以真实 LF 输入重新完成，
source 为 `sha256:c606f8245b8af8b5172b8feb9f5f24a781750dc41c4aac05e69bc41265967fe5`，
artifact 为 `sha256:14bf9f878fbca870361171331ac4401f7c3fa5cd8168c665ae9061a4b2a674e7`。
helper 实际退出 0，registry GET 200，header 与 manifest 字节摘要一致。
原件 `codex-agent-management-web-win-20261003.yUA7u9/gateway-lf-helper.log`
SHA-256 为 `f700d89df9fd70020438214d1672dda58350917f2f0b1d0baae1719afdc7da93`。
只同步真实 metadata、Compose 与两条实际引用；不改 attributes、不伪造摘要，
Web/Win11 不重建。下文 f300/14dc 是原历史产物记录，仍保留其真实边界。
当前尚未再次完整检查、Git 提交或部署；ReplyPolicy 与真实 LLM/用量链未验收。

## 2026-10-03 09:01 UTC 选定树完整检查失败与修正

固定树 `47bb3fe503620fc097cd174989b70e8e434afffd` 原 full 实际退出 1。
原件 `codex-agent-management-close-20261003.8e3wdG/full.log` SHA-256 为
`d47854f8dbbf757cb7946b28a81ef662d19a5f955f67fd059e38aa671c499cab`。
失败包括 invitation 的 Params 消费遗漏、S5 记录混入 S1/S3 决策、旧 provenance
检查遗漏实际 release 的 Runtime buildArgs，以及 Gateway 构建输入换行失配。
四侧、132 schema 兼容、Go/TS/Dart、replay、文档与部署静态边界通过；
数据库与真实部署配置 SKIP 不改记通过，Core 编译失败不算业务检查通过。

选定 invitation 已补原生成参数的 None 消费；追溯保留 S5 决策，跨阶段依赖
通过原验证记录关联，不改变设计覆盖矩阵、能力状态或入口。发布证明的原检查
现按每个产物对应 commit 的真实 release 脚本、Runtime manifest 与 OCI 依赖
核对 buildArgs；locator 仍是发布配置，不写死地址，也不改历史产物证明。
在受限 SDK 中同时破坏 Runtime 构建参数和依赖为另一真实镜像摘要，原检查块
退出 1；原字节复制还原、cmp 与原检查块退出 0。原件同目录
`provenance-mutated.log` SHA 为
`30d69e6effedbd4f9e7b6a0b9701a68798b7742d1095c4ef11768ef65441b994`，
`provenance-restored.log` 为
`0038a7380a1abbbd687dd23b6badf200c4aba623c9e09c7f4637ecc96ae9aec7`。
这是原 Python 产物核对块的结果，不是完整 supply/full 或新 release 通过。
前两次窄 SDK 调用的工作目录与缓存投递错误保留，未改产品源码迁就它们。

Installation 原窗口依据 DD-25/50/66/67/69 和设计17 §3–5，按实际消费者
逐字段更新 EffectiveField：Capacity 消费 immutable Version 的 parallelism，
Task 消费同版本的 native-time turnLimits；Memory 只支持 HUMAN_ONLY+DISABLED。
初始化与查证共用同一支持谓词，已有部分投影不阻断后续字段收敛；未知字段、
不支持的 Memory 与 ReplyPolicy 均拒绝，不借 requested hash 冒充运行事实。
Runtime config/read、fresh authorization、固定 generation/hash 与锁内 CAS
仍是写入边界；ReplyPolicy 未映射，ACTIVE/首 turn 仍关闭。原窄窗口与四步
事实位于 `codex-runtime-effective-window-20261003.32sDIx/handoff.md`。
修正后集中 full、Git 提交与部署尚未完成，不继承上轮失败树的通过项。

## 2026-10-03 08:26 UTC 数据库、产物与恢复错误传播增量

已实现的管理批在独立空库完成 55→54→53→55、原 SQLx prepare --check、44 项枚举
核对及 Version 4 / Installation 5 / Delegation 4 共 13 条实际 SQL 执行，均退出 0。
真实 Installation 列变异报 42703、枚举约束变异令原检查退出 1；精确还原均为 0。
原件在 `/volumes/data/kailo/tmp/codex-agent-management-db-20261003.op9BvB/`，
`handoff.md` SHA-256 为
`e4942ddcb41efc7096cb5832432b1fb8ed0b2245bc611d48e404c3beca8d4140`。
九个 domain 表仍为零对象；不把 SQL 或 ACTIVE 目录行当授权、创建或业务 E2E。

随后 `model_route.rs` 修正原已派发恢复的错误出口：配置/SecretRef、缺冻结 hash、
fresh/projection/Check 不可查证走原 `creation_unknown`，同一 AE 持久 UNKNOWN 审计；
未派发拒绝保留原行为，恢复不重写 native。原 dispatch 只记录并吞返回错误，
原重放读取同 AE；此前这些出口可留下 NOT_DISPATCHED，而不是已证实自动改成失败。
数据库本身不可用时不能伪称 UNKNOWN 已提交；既有持久 fence 防止重派，沿原对账收敛。
单源窗口 81+/44-，原件在
`/volumes/data/kailo/tmp/codex-route-unknown-propagation-20261003.QJ8pYZ/`。
diff/reverse-apply 检查均为 0；原受限 SDK 单文件 rustfmt 退出 0，实际最终源 SHA 为
`52f21696d18c4273670b834f7f37aea67d1f90e2e6e681a8be0654f5579f0da8`。
最新修复尚未集中编译，不继承旧 SDK 或上述空库的验收范围。

新 Web 原 helper 退出 0、registry HTTP200 与 manifest digest 相等；source 为
`ae932dd5126a68bb120361d2851b3f43983838f47e2bb93930ccb70d13aeffed`，
artifact 为 `d4f30d4ec9a5c21594fc361557e4bdd181eb1f4588a971b2ac028cc8cf6f2857`。
原件 `codex-agent-management-web-win-20261003.yUA7u9/web-helper-corrected.log`
SHA-256 为 `c1332b9dcb8a4d1b8f1c43ca18899ba56b66c41f8c153712661831836bfa087b`。
首次 registry 参数重复端口导致 helper 1 的日志保留；没有改源码迁就参数错误。
Win11 原 helper 退出 0；2255 个输入 source 为
`d4a48dddf3f6d8d55e2edfd0b20736dcc7981f5c5d882d5c888f8eff591e4d17`，
15,087,391 字节 NSIS 包 artifact 为
`d8a87009a238d8ba787b0510e777086fb49885c0dbd0bc977bf3090bdffd9db4`。
同目录 `win-helper.log` SHA 为
`eb5f955640465cd9ac382395abe622ba435b8ae1259105b822bc8038e33d87e2`；
原日志明确跳过 signing，未安装或设备验收，不解除生产发布门禁。
本批新 Gateway/Web 未部署、完整门禁与提交尚未完成。
真实 CHECK、模型/用量、Agent 工具/主动 Memory、删除及设备链仍未验收；
不把没有适用封闭产出方/可证上界的 STRICT 登记变成额外前置条件（ADR-14）。

## 2026-10-03 07:53 UTC 管理后端与原生模型投递收口

本节记录已实现代码及后置检查，不新增产品要求。权威为 DD-13/37/70/71/99/100、
设计03 §9 与设计17 §9；Core 只持有原 Resource/ActionExecution、SecretRef 与
投影引用，原 OpenBao 保持秘密权威，AgentGateway 保持原生配置权威。

原 Core SDK 集中 clippy 最终退出 0，workspace 检查汇总 131 passed、3 ignored。
原件在 `/volumes/data/kailo/tmp/codex-agent-management-core-sdk-20261003.5f3C7V/`；
`clippy-final.log` SHA-256 为
`9684c78c4cc26841452f13a7d2d4b595e729c08b4b01d91d67cfd37b6b0b606c`，
`cargo-test.log` 为
`2f4ed225ef2a6548bc77b9405777fa6ff2130a4c56b54a7ee7e6715b322f75c5`。
真实数据库配置未投递，依赖外部服务的早返与 ignored 不记 E2E。

随后仅修正 `model_route.rs` 两处真实语义错误：冻结 SecretRef 消费配置的同租户
namespace/mount 与确切 locator，不要求不存在写者的 Provider 专用路径；首次和
UNKNOWN 恢复共用原 fresh authorization、audit 与确切版本读取，恢复 hash 必须
匹配原持久 intent。失效或未知保持原 UNKNOWN，不重派 Gateway 写入。原 AE、
Tenant、Resource/intent 锁序、Provider/Model revision/hash、审批、投影与退休路径
不变；不引入秘密写者、注册表或新状态。44 行新增、18 行删除，冻结源 SHA-256 为
`bb816c1588d9ff897bcf3770ed74588b3b4beea1f123bb93dff1f1d2129da917`。
这两处修正尚未重新编译或真实运行；不能继承前述 SDK 的通过结果。
随后原 SDK 的单文件格式检查先退出 1，机械格式化后退出 0；语义不变，
本批实际源 SHA-256 为
`f14a6ea8792b386666eb38d1db110d8388968bc9f53784289c7fc38f2af05259`。

原 Gateway helper 首次编译退出 1：新 `Path<Uuid>` 不满足当前固定 UUID 的
serde 条件。现沿原 router 使用 `Path<String>` 后严格解析，非法、非 canonical
或 nil UUID 仍拒绝，不更改依赖或权限。修正后原 release helper 退出 0，source
`14dcdee04d6f6a18cbe506505bd6d3c51cf134aaefe207d0459503c3ca98fd99`，
artifact `f3008585dadda509afc738dd28de925e37019abe64a100b3d928fe071a3a91a0`。
原件在 `/volumes/data/kailo/tmp/codex-route-native-delivery-20261003.5lJP72/`。
原两个 UI 检查直接消费新 handler，baseline 与精确还原均 2/2、退出 0。
将真实 create 拒绝回应破坏为 200，检查报 `200 != 403`；删除真实空 secret 拒绝，
检查报 `503 != 400`，两次 Cargo 均退出 101。第一次仅删冗余 guard 未破坏拒绝
性质而仍通过，原日志保留、不计有效负向。这不是 Provider/配置事务或 HTTP E2E。

选定输入的原四侧生成、原能力注册表生成及比对均退出 0，后者为 18 能力、
18 个封闭 workflow kind。新 Web/Win11 打包、两对迁移与实际查询、完整门禁、
Git 提交/push 和部署尚未收口；真实 Agent、严格额度、工具/主动 Memory 与
三端设备验收仍未通过，结果不明不渲染为成功或失败。

## 2026-10-03 07:14 UTC 共享 Agent 管理与 Mobile 只读历史检查

本节为实现后的检查事实，依据 REQ-08/21、DD-24/25/36/53/74/75 和设计17 §8；
不另立页面、治理权限、版本状态、主题或验收要求。此前各节的失败、SKIP 与
历史产物保留原范围，不能据本节窄 PASS 宣称 Stage 5、设备或业务 E2E 通过。

### 共享 Version/Installation/Grant 真实消费

Web/Desktop 继续消费同一 `AgentDefinitionsPage` 与原 ActionClient、生成合同。
Version 目录和配置分页、真实 Profile/受权 Route 选择、exact DRAFT 修改及
EXPLICIT 发布已经实现；缺 `canUpdate/canPublish` 或合法来源时不生成写入口。
Installation/Grant 复用原治理动作，UNKNOWN 保留同一 immutable command 与
幂等键；后续返回的 AE/operation 不匹配不能解锁或生成替代请求。权限仍由
Core fresh 查证，UI 不作授权权威，也不通过保存或发布推断可执行。

不可变 SDK `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`
在实际 UID1000:1000、4 CPU/8 GiB/swap0 与原 Data 缓存运行。原共享包、Web、
Desktop 三消费者 typecheck 均退出 0；原 pages 的管理目标 20/20、退出 0。
七次实际生产变异分别破坏分页游标、Route 选择、publish 显式确认、缺权限、
UNKNOWN 原键、Installation exact 引用和 Grant exact 引用；均退出 1，逐次
SHA 还原后同一 20 项目标退出 0。正式源未变异，没有新增业务对象或夹具。

原件目录为 `/volumes/data/kailo/tmp/codex-shared-management-sdk-20261003.ZKfIHW/`：
`ui-baseline.log` 保留初次类型退出 2，`ui-corrected.log` 保存三类型通过及首次
导出漏既有 vector 的失败；`ui-full-target-final.log` 保留 144 通过、1 个旧
theme scanner 失败。七组 `mutation-v2-*.log`、`restored-v2-*.log` 及
`mutation-receipt.json` 保存实际 1/0；还原 `agents.tsx` SHA-256 为
`fe1410de7684349ae92a1868d203919bfb4862b8b765c85d855139eace373c90`。
初次逆变异匹配另一同形表达式的 SHA 失配亦保留，核完整 diff 后已精确还原；
没有把该失配或依赖投递错误改记为产品负向通过。

### 原生主题检查纠偏与完整目标收口

DD-36/53 要求沿用 Buzz 原生主题，不禁止宿主选择的 Shiki token 颜色。
固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/shared/ui/markdown/CodeBlock.tsx::SyntaxHighlightedCode` 为实际来源。
现有 theme describe 通过 AST 核 exported 同名共享函数、`codeToTokens` 的 theme、
token cache/map 和 exact 属性 `style={token.color ? { color: token.color } : undefined}`，
并核 Desktop/Web 的 ThemeProvider→`resolveShikiThemeName`→共享 highlighter
调用链。只从扫描输入移除该已核属性，仍扫描其余完整组件和全部原禁用模式，
不是按文件/函数豁免，不新增 palette、样式注入或独立主题。生产源只删除原
`rounded-2xl` 已覆盖的冗余 radius；原 CSS、高亮及 Desktop hook/ref 保持。

原 `pnpm --dir client-kit/ts/platform test`（含 test TypeScript compilation）
完整七文件 145/145、退出 0。私有同文件新增独立颜色 style 后原扫描断言退出 1；
还原 SHA 后两项 theme 检查退出 0。将原 token 色改成字面色后 exact 来源断言
退出 1；再次 SHA 还原后完整 145/145、退出 0。两次实际失败而非 harness 失败，
证明例外没有放行同文件新 style 或 native 属性内的字面颜色。

原件在 `/volumes/data/kailo/tmp/codex-message-theme-source-20261003.zVCYMC/`：
`platform-positive.log` 与 `platform-restored.log` 均为 0；
`theme-mutation-independent-style.log`、`theme-mutation-native-literal.log` 均为 1。
最终完整日志 SHA-256 为
`b6b3917017d06910213eb5ebd5d11ef82026cbaa69730d59f27a9c005701ae87`。
formal/SDK 两源字节一致，diffcheck 0；源码 07:00:13 UTC 冻结，SDK 终态 0、
OOMfalse 并已清理。此项没有重跑三消费者类型或构建/部署。

### Mobile 只读历史与批次边界

Mobile 原 Definition 详情增加受权 Version 历史，沿真实 BFF 分页与生成 Dart
类型，保持原 exactPublished 读取；Installation/Grant/Memory 仍只读。
当前原 pages 73/73；历史字段校验、未知枚举、分页三组生产变异实际非零，
逐次精确还原后 format、analyze 和完整 73 项均退出 0。原件在
`/volumes/data/kailo/tmp/codex-version-mobile-current-20261003.FcF3LO/` 的
`mutation-history-validation.log`、`mutation-history-enum.log`、
`mutation-history-pagination.log` 与 `restored-history-final.log`；最终日志
SHA-256 为 `4f23761580cac6d54246547eb9f91abfd8869d3aff591c02c1f0b1d24256fc65`。
这不是 Mobile 设备/签名或新 ModelRoute 合同业务验收。

本次核对时 main/远端 main 为 `4b44ac6b266345fbc19e3c315df5c3d9bd0af00b`：
上一 Memory 批 ab27→4b 为 81 文件 +8282/-599，原 full 0、实际
Core/Worker/Web/Relay 部署与 53 条迁移已有独立记录。本节后续共享管理源码
未因此记为已提交/部署。Core 管理集中 clippy 两轮 101 保留，修正后 SDK 44114
正在 clippy→test、尚无终态；Gateway 原 helper 82517 仍在构建，不记成功。
18 条追溯顶层 status 为 7 shipped/11 in_progress，release.gate 为
7 shipped/7 ready/1 closed/3 blocked_until_seams_closed，不是 18 项完成。
真实 Agent/Memory/用量业务验收、STRICT、Agent 工具与 Memory caller、
Win11/Mobile 设备验收仍未闭合；HUMAN writer 与正常 turn 结算已有实现，
不误记为尚未开发。Cells/WeKnora/Wren 未接入且属于可选 EXT，平台仍未生产就绪。

## 2026-10-03 HUMAN Memory 三项读取：实现后的窄证据

本刀实现 `agent.memory.core.read`、`agent.memory.entry.list` 与
`agent.memory.entry.read`，由既有 BFF Installation 路径和 Web/Desktop 的同一
共享 TS Installation 页面实际消费。依据 DD-66/67/68、`19` §3—7，四步结论如下：

1. 原生权威：固定 Buzz 提交 `779af8886caae1317b4de962082429867ab61503`
   的 `crates/buzz-core/src/engram.rs::{validate_and_decrypt,select_head}`、
   `crates/buzz-acp/src/relay.rs::RestClient::query_raw_all` 与
   `desktop/src/features/agent-memory/ui/MemorySection.tsx` 是协议、读取及交互依据。
   本地原 `buzz-core` 验证入口增加同一次解密的原始 plaintext 字节结果，旧入口
   仍供已有调用方使用；原分页逻辑收敛到 `buzz-core::relay::query_raw_all`，
   RestClient 和 Core CONTROL IdentityClient 共同消费。Core 保留受控 Host、
   NIP11、ApiBudget 与动态上界，不另写存储、检索、密码学、同步或 Memory 权威。
2. 调用与权限：复用同一 ServiceState、Governance/ActionExecution、HUMAN
   与 active 生命周期/Installation/Resource 权限及受控双方 SecretRef。
   三个生成 schema 同时有真实 Core writer 和 TS reader，正文只在 no-store
   HTTP 回应与已展开组件内存中存在，关闭即卸载。UI 沿原 MemorySection 的
   折叠条目布局接 BFF，不带原 Tauri/本地钥匙/cache，也不注册写入或运行权限。
3. 副作用与计量：原生读取后，两个真实 meter 事件进入原 `outbox.usage_event`，
   source 为 `BUZZ_AGENT_MEMORY`、关联原 AE，不造 Invocation/model trace。
   count 与原生 JSON plaintext bytes 使用唯一 AE/meter ID，经原 OpenMeter
   publish/stored 消费查证，再重验 scope、binding、SecretRef、meter 与 native head
   才披露正文；202、缺映射、配置 warning 或未知均不据此返回正文。不存正文、
   ciphertext、私钥或 slug 明文；`contentBytes` 仅校验返回文字的 UTF-8 长度，
   不是原生 JSON billing bytes。必填总读取时限由唯一运行配置投递，不给默认值。
4. 错误与恢复：BOUND/UNKNOWN/UNREADABLE 不伪报 ABSENT 或空库存；原始
   byte count、复合游标顺序/重复/超页/超界与跨 Workspace 拒绝均有实现后
   断言。原生长期记忆仍只在 Relay，Model/Quota/账单没有第二权威。

不可变 SDK `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`
使用 launcher UID:GID、原 4 CPU/8 GiB、memory+swap 8 GiB 和 Data 缓存；
未自行设置或降低 Cargo 并行度。原四侧生成/检查和 registry 生成实际退出 0；
初轮 Bridge 未用 import、不存在的 BillingUnavailable 枚举及旧快照 normal-turn
布尔式三次 Cargo 101 均保留，分别修正真实源/选定已冻结消费者后，Core
all-target clippy `-D warnings` 与原 normal-turn 六项检查实际退出 0。

原生 Bridge 两项游标检查、Buzz engram 34 项和 ACP 原分页消费一项均通过；
shared/Web/Desktop 三消费者类型检查为 0。新增 Memory 四项通过，但第一次
共享整套 113 项为 112 通过、1 项继承 theme scanner 在原 GFM `style` 命中失败，
没有修改 scanner 或 GFM 呈现使其过关。随后错误 `pnpm test -- -t` 的整套重跑
同样失败，属于过滤投递错误，原件保留；修正调用后四项为 4/4，其他 109 项
明确 filtered。Go 原 contracts round-trip 与 Dart 原九项检查实际退出 0。

主动破坏重新序列化 byte count、原复合游标倒序拒绝及跨 Workspace 拒绝后，
三个检查分别在编译成功后真实断言失败（SDK 101、101、1）；每次还原原 SHA，
对应最终 1/1、2/2、4/4 为 0。原始日志在
`/volumes/data/kailo/tmp/codex-memory-feature-sdk-20261003.sdcocM/` 的
`byte-mutation/byte-restored`、`cursor-mutation/cursor-restored`、
`ui-mutation/ui-restored`，以及 `core-final`、`native-ui`、`roundtrip-final`。
所有变异只发生于该私有快照，正式源码未被变异。

同表迁移在独立空库的原 migrate/SQLx、两层回退/再前进、44 枚举核对及实际
CHECK 破坏/回滚还原已为 0，原件为
`codex-agent-billing-window-20261003.cH0WCz/{sdk,validation,catalog-check,migration-catalog}.log`。
这不证明原生 BFF→Memory→OpenMeter→正文披露 E2E。仅 Memory 的 17 文案从
真实 HEAD i18n 用原 generator 生成检查，排除继承 native 文案/generator 改动；
首次 Dart 基线误含工具截断显示文字的错误 patch 保留，已用原生 Git stdout
与 blob SHA 重做并 apply-check，不修改产品以迁就错误证据。

本刀没有 full、产物构建/来源登记、提交或部署，旧 Web/Desktop/Relay digest
不覆盖本次 shared/native 变化。Memory 写入由独立后续窗口负责，Mobile
Memory 管理页、真实原生读取与 billing/disclosure、三端设备验收均未由本刀
验收；这些窄 PASS 不代表 Stage 5 或生产可用。

## 本批固定树全量收口

实现与负向恢复完成后，原 `tools/check.sh --full` 对固定树
`641f5cf0ef5d8a0e33515739303b33cff7b2f49b` 实际退出 0。
原件 `bOjEqV/full.log` SHA-256
`888d3185ba0019361836c9c280fe6dbaeb341f599835f4eac0d9564ffc1a288f`。
121 schema、四侧生成与兼容、真实数据库前进/回退/再前进、SQLx、44 项
命名枚举约束、workspace 检查、replay、18 条追溯与供应链均通过。
实际 `.env` 预检 SKIP；Catalog bootstrap、approval CAN 与 Relay outage
三项 ignored；内置 secret 扫描无命中但未安装 gitleaks。外部集成早返不算
业务验收，Desktop 旧 h2 构建失败与 Mobile keystore 缺失仍属于该冻结树的
发布边界。独立新 Win11 包不反改此回执；后追加证据只运行原文档快路径。

## 2026-10-02 22:40 UTC 本批 Automation 管理与原生回复检查

Automation 已沿原治理入口实现五项管理命令及 BFF 列表/详情，共享 TS 管理页和
Mobile 只读页复用同一生成合同。权威是 REQ-23、DD-107、设计 05 §2.9；本刀
不新增 Schedule/Webhook/手动运行，不更换 Temporal，不建立第二份 Registry。
新准入只消费 ENABLED 与当前 pin；已准入 Invocation 在 PAUSED/DISABLED 下
消费原冻结版本、Installation、Grant 和 generation，真实撤权或代际变化仍拒绝。
首 turn 的空 native-turn 阶段与 completed reply 的确切 turn/固定 event ID 阶段
互斥；每次外部查证后按真实数据库时钟复读已锁 Grant，不借锁冻结到期时刻。
Resource/Asset 及失败创建的同 AE、两 native 删除证明和完整空关系集归属已有
生命周期；管理读取不执行 quota、health 或对账。写者为原 Core，读取者为生成
TS/Dart 合同；50th 迁移原回退/再前进退出 0，当前无旧在线 writer 或历史数据
兼容窗口，不新增旧读链。Core 不复制协作正文，UNKNOWN 不渲染成功或失败。

实现之后追加的六项 Automation 检查实际基线和最终均为 6/6，SDK 退出 0。
其中真实 PostgreSQL EXPLAIN 核查原 RUN/FROZEN 查询与原锁目标，直接消费原
SQL 谓词核查 240 个准入/在途组合和 720 个首 turn/回复阶段组合；独立库无
业务行，不能将这些检查称为真实运行。逐次破坏 MENTION 字段、线程唯一目标、
显式确认、Version 正数、暂停后在途状态和 exact native-turn fence，六次均
编译成功后指定断言失败（Cargo/SDK 101，原启动 wrapper 1）。每次立即恢复
`automation.rs` SHA-256
`2ecd1e2cf6d48211ffa461944bea8088a5fa374aa74dfe193e44dce37ea0320b`；
最终 `automation-evidence-restored.log` SHA-256
`c4d8d6c2625793705a51882800a6ff59dfc85f9144e5b9d4c22a20a0cf6975b1`。
原件在 `/volumes/data/kailo/tmp/codex-automation-integration-20261002.bOjEqV/`，
六个 `automation-mutation-*.log` 均保留，不以 wrapper 的退出码改写 Cargo 结果。
初轮接线中途编译缺少 publish_reply 的 101 和未投递 DESIGN 时 registry 生成
拒绝均保留；它们不是预期反例。冻结实现后检查通过；registry 使用真实相邻
设计路径再次生成退出 0，没有修改产品以迎合私有目录投递错误。

原生回复的三项 Task 与一项 Bridge 后实现检查基线、最终都实际退出 0。
未知/缺失 phase、未来 completedAt、固定签名时间三次变异分别触发原指定断言
失败（Cargo/docker-exec 101），逐次 SHA 还原再通过；最终日志
`/volumes/data/kailo/tmp/codex-task-bridge-mutations-20261002.iPZsYz/final.log`
SHA-256 `7b4698aba11c0fa00f38b73721228a0b7b38bd40626745ccf4bbdbea00d93784`。
Task 恢复 SHA `0d9ed40379ade47bb5fc10c92c9f973da33d321de497a5e8a068a80c92c9d9bb`，
Bridge 恢复 SHA `3f2d4a0801ed785c1ed6b5f313c655eab50504a8b3701f8a576be1d44ad21452`。
初轮实际 SDK 指出的弃用 as_u64 已机械改为原 API as_secs，最终检查无该警告；
本次唯一持久修正只在原检查的一行。初次 TMPDIR 拒绝、基线及变异引入的警告
均保留，不能把容器编排进程清理退出码 137 当作检查退出码或 OOM。
资源复用不可变 SDK `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`
与已有 4 CPU/8 GiB、Data 缓存，实际检查 OOM 为零，没有宿主工具链或新 checker。

共享 UI 三消费者类型及原 98 项检查、Mobile 原 25 项与四文件 analyze 均通过；
Thread→CHANNEL 分别被真实 TypeScript/Dart 工具拒绝，精确还原后再通过。
完整原件与失败/还原边界见现有 Web/Mobile 核验记录。本节不证明真实
Codex→Relay 回复、完整 billing、Memory 写入、通用 replyPolicy、模型 Route
产出方、公开 Installation/Grant、Win11 安装、三端或生产部署已经完成。

## 2026-10-02 本批 Agent 原生回复生产者：已实现、业务尚未验收

本节记录私有候选 `bOjEqV/apps` 的最新实现；下文历史检查只覆盖各自当时
冻结范围，不验证本节新增回复代码。本批沿用 REQ-03/06/23、DD-37/47/48/107、
`09` §3、`12` §6、`17` §7/10 与 `19` 的正文及引用边界，没有新增动作、
ReplyPolicy 语义、审批权威、Workflow 或公开运行入口。

### 四步影响与实现事实

1. 权威与原生依据：固定 Codex 提交
   `7498521d288b9b3b96ffba4eedf089d8d6e06a84` 的
   `codex-rs/app-server-protocol/src/protocol/v2/thread_data.rs::Turn`、
   `codex-rs/app-server-protocol/src/protocol/v2/item.rs::ThreadItem::AgentMessage` 与
   `codex-rs/protocol/src/models.rs::MessagePhase` 提供 full items、原生完成时间
   和封闭的 `commentary`/`final_answer`。`native_reply` 要求 completed、完整
   items、唯一非空 final、确定且合法的原生时间；任何 AgentMessage 的未知或
   缺失 phase、异步 delivery/questions、重复 final 均拒绝，不以另一个 final
   掩盖未知事实。AutomationVersion 已冻结的 `TRIGGER_THREAD` 是本刀唯一结果
   目标；仅支持消息/@提及触发，不解释任意 `AgentVersion.replyPolicy` 字符串。
2. 调用与准入：已有 `AgentTask.advance -> observe` 在同 Invocation/native
   thread/turn/clientId 关联和 completed 事实下调用真实生产者。两次事务均
   核同 AE、Tenant/Workspace、Installation、pin Version、projection generation、
   AGENT 身份与原 Temporal Activity；复用 `automation::fresh_reply` 同一准入
   实现，分别消费未冻结回复和已冻结确切 event ID，并在外发前重验当前
   Grant/scope/权限/Quota。没有复用首 turn 的 null-turn 准入绕过回复条件。
3. 副作用与证据：复用 collab-bridge 的原 OpenBao AGENT 代签、原 Relay
   publish/query。固定 Buzz 提交 `779af8886caae1317b4de962082429867ab61503`
   的 `crates/buzz-relay/src/api/bridge.rs::submit_event` 与
   `crates/buzz-core/src/nip10.rs::ThreadMarkers::resolve` 是接受和 root/source
   取证接缝。kind 9 的时间取原生 completedAt，root/source 取冻结 Invocation；
   先持久固定 event ID 和原 operation 的 AGENT DISPATCH，再且仅在当前请求
   外发已签 event。确认必须包含同一 event ID；原生查询须证明单一确切 ID、
   AGENT 作者、签名、Channel 和 root/source。Core 仅存引用与类型化审计元数据，
   不保存输出正文、签名完整 event 或复制 Codex/Relay 历史。
4. 幂等、取消与终态：每次外发前重查同 Temporal Activity、cancel 和固定意图。
   已有 event ID 的后续观察只查原 ID；崩溃或发送结果不明不重签、不生成新 ID、
   不重跑 turn/model。原生 accepted/HTTP 202 都不是 Invocation 终态；缺确切
   Relay 证明保持 UNKNOWN。即使回复已查证，完整 billing completeness 未闭合
   仍保留 BILLING_UNAVAILABLE，不写 Invocation COMPLETED，不伪造计费成功。

### 本批检查事实与未验收边界

已在实现之后追加三项 Task 原函数断言和现有 Bridge 检查中的一项离线签名
断言：完整 final/原生时间、未知或缺 phase、重复 final/异步消息，以及固定
时间/正文/root/source 的 kind 9 ID。三个私有 mutation diff 分别破坏 phase
拒绝、未来原生时间拒绝和固定签名时间；只读 apply-check 已通过。本节最初
写入时四项断言和三个变异尚未运行；随后实际运行结果以上方 22:40 UTC 记录
为准。源码窄 `git diff --check` 实际退出 0，不等同真实业务验收。

本刀三条源码与检查路径于 22:23:13 UTC 停写；before、精确窗口差异和三个
mutation diff 位于
`/volumes/data/kailo/tmp/codex-agent-native-reply-before-20261002.6MWGhs/`。
没有执行真实 Codex turn→Relay 回复端到端、Win11/三端运行或生产部署；完整
bill commit、Memory 读写与结果暴露验收、通用 replyPolicy 投递、llm_route
治理 producer 均不由本刀宣称已交付。Installation ready/ACTIVE 与全部运行
链仍须各自事实闭合；本节不是 Stage 5 完成或公开入口开放证明。

## 2026-10-02 实现范围与权威

本批是 Stage 5 的首个 Core 平台 Resource 实现，不是 Buzz Desktop 本地
Agent 存储的服务端化。权威为 `.design/03` §4、Agent 实体段、`05` §2.8、
`10` 审批与撤权，以及 `DD-24/25/45/47/99/100`。

已写入的链路是 `agent.definition.create/update`、同 Tenant 的 BFF 列表与详情、
`resource.transfer_owner`，及其必需的成员撤权与 Tenant 销毁衔接。Definition
只保存设计的五个字段；Core Resource 的 native ID 是自身 ID、无 application
binding、无 home Workspace。没有建立 Asset、Version、Installation、模型路由、
运行时或另一套 Agent 注册表。未发布的 version pointer 保持空。

所有写入复用既有 Governance、ActionExecution、幂等键、审批和审计事务。
创建和投影前先持久化 Resource 与同一个 ActionExecution 引用；原生
SpiceDB 写入结果不明时，保存同一 AE 的 UNKNOWN 与审计，由既有治理对账器
对账，不分配新请求或工作流。投影未闭合时不开放 Resource 读写。

owner 转移按现有 SYNC 动作与另一位 Tenant admin 的审批执行，owner 必须为
同 Tenant 的 active HUMAN。创建、转入与撤权共用 Tenant、Principal 和
TenantMembership 行锁；REVOKING 成员在实际 Resource owner 转出前不能进入
REVOKED，Tenant 销毁方向除外。未创建应用 Resource 或 Asset 时不虚构对象。

Tenant 删除冻结真实 Resource owner/version；审批 fresh 校验同一冻结对象、
当前 Core owner、成员资格及 SpiceDB relationship。销毁按冻结对象逐一删除
SpiceDB 关系并回读为空，随后将 Core Resource/Definition 留为不可用墓碑，
不删除 ActionExecution、审批和审计事实。

## 结果不明与终态证据复核

`agent_definition::dispatch` 对已有 desired 投影的恢复是对已发生副作用的
对账，不是重发；终态仍要求 FullyConsistent 权限读取的非空 ZedToken，并写入
既有终态审计。原生 read/check/write 失败均保存 UNKNOWN，不能以 SQL 回滚
把已经发出的请求重新描述为尚未派发。

取消创建时复用现有原生删除：只有删除 progress 为 COMPLETE、关系回读为空
且修订引用非空，才清除投影意图并进入 ABORTED。转移失效则恢复 Core 冻结的
旧 owner 投影并回读完全相等；未查证时仍为 UNKNOWN。旧 SpiceDB `check`
只接受 HAS_PERMISSION 与 NO_PERMISSION，CONDITIONAL 和未知枚举返回
Unavailable，不作为确定拒绝或成功。

## 实际镜像内检查

使用已有不可变 SDK `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`。
执行前检查活跃构建及压力；容器内核回读 CPU 2、memory 8 GiB、swap 0，
Cargo 并行度未降低，派生缓存只在 `/volumes/data`。

- `tools/gen.sh` 四侧生成实际退出 0；没有手写生成类型。
- 首次 Core check 的两处 identity 字段引用错误已改为实际
  `tenant_principal_id`，不是增加身份回退。
- 两次 clippy 原始退出 101 引用了旧 SecretStore metadata。容器内源文件
  SHA-256 `08d895104a97bebaf7a63c6632b4ab1a2e264231f19212f6970ea04aa98904a6`
  与实际工程相同，PlatformKey、owns_platform_key、delete_tenant 符号均存在。
  仅清理该包的派生缓存后，workspace clippy 退出 0；未改 SecretStore 源码。
- 同一容器 `cargo test --manifest-path core/Cargo.toml --workspace` 退出 0：
  106 passed、3 ignored。未提供 DATABASE_URL 的既有集成检查会早返，
  不将其计为新 AgentDefinition、owner 转移或删除的业务正向验收。

本地原始证据目录为
`/volumes/data/kailo/agent-definition-sdk-20261002.gSgpJt`，包含四侧生成、
原编译失败、容器内源 SHA/符号及 `core-clean-secret-clippy-test.log`。
首次 `gen-registry.py` 因 SDK 未挂载设计目录退出 1，未绕过该要求。

### 全新隔离库与契约检查

随后使用 Compose 已固定的 PostgreSQL 镜像
`sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`
建立本批独立空库。数据库名和用户取自已有部署配置，随机凭据经 Docker
受控 stdin 投递，不打印、不进入 argv；仅发布回环随机端口。PG 限额为
CPU 2、memory 1 GiB、memory+swap 1 GiB；检查 SDK 为 CPU 2、memory 8 GiB、
内核 swap 0。未连接或修改本地业务数据库。

仅调用原 `tools/check.sh` 的 `step_migrate`、`step_contract`、`step_trace`
和原文档检查，不改其实现，以实际 FAIL 变量退出；这不是 `--full`。
SQLx 与 Cargo 在 SDK PATH 中存在，DATABASE_URL 非空，库在迁移前的
catalog 表数为 0。最终整次窄检查退出 0，原始日志为上述目录的
`fresh-scope-tcp-migrate-contract-trace-docs.log`：

- 39 条迁移，包含 `20261002010000_agent_definition`；前进、回退、再前进
  三步 PASS，没有将 migrate SKIP 计为通过。
- `cargo sqlx prepare --check --workspace` PASS；40 个命名枚举约束与
  `contracts/enums/` 逐值相等。
- 四侧生成物同步 PASS；相对 `contracts-v0.1.0` 无破坏性变更，检查
  90 个 schema、匹配 3 个历史 schema。
- 18 条追溯与注册表校验 PASS，文档完整检查退出 0。
- 迁移后 Resource 与 AgentDefinition 行数均为 0；只核对已有三条真实
  ActionDefinition 已由迁移登记，没有创建业务样例。

Go、TypeScript、Dart 的既有 round-trip 随后另在相同固定 SDK 执行，CPU 2、
memory 4 GiB、内核 swap 0，生产源码只读、独立 Data 缓存、网络关闭。
Dart 只复制现有文件至 Data、离线取得依赖，没有新增样例或测试。
`three-sides-roundtrip.log` 记录 Go `internal/contracts` 通过、TypeScript
类型检查与 1 项 round-trip 通过、Dart 2 项既有检查通过；整次退出 0。
加上前述 Rust workspace 中的既有 round-trip，四侧已有双向序列化检查均
通过。这些既有 canary 检查不是新 AgentDefinition 对象的业务正向验收。

### 失败、纠正与清理

原错误未改写为通过：

- 首个临时 PG 因 sudo 环境隔离未取得密码而启动失败；随后改为官方
  stdin 环境投递，没有启用 trust 或放宽认证。
- 原检查 main 的依赖准备因 pnpm 非 TTY 拒绝清理 modules 而退出 2，
  迁移未运行；记录在 `fresh-migrate-contract-trace-docs.log`。
- 首次直接 source 原检查函数时，原脚本顶层的 `$0` 相对目录使工作目录
  错落 `/workspace`，迁移和契约 SKIP、追溯 FAIL，实际退出 1；记录在
  `fresh-scope-migrate-contract-trace-docs.log`。纠正执行目录后重新核验，
  未改生产检查。
- 一次 PG 初始化期间的 socket readiness 误判临时启动实例已就绪，SDK
  连接中断，实际退出 2；记录在
  `fresh-scope-corrected-migrate-contract-trace-docs.log`。最终只在真正 TCP
  readiness 成立后执行迁移。
- 本轮部分 SDK 默认以 root 写共享 Rust 派生缓存，造成正常 pre-push 的
  Permission denied；这是执行归属错误，不是产品源码问题。批次负责人
  仅修复该项目 Rust 缓存的归属。后续共享缓存容器必须显式使用 launcher
  当前 UID:GID，不能默认 root；本记录不把正在重试的 push 写成成功。

本 lane 自有 SDK 与临时 PG 容器均已精确删除，并确认 Docker inspect 不再
找到它们；其他服务和业务库未动。原始日志、before 差异、临时 PG 数据目录
与契约副本仍保留于 Data，不声称这些磁盘数据也已清理。本刀逐文件差异为
该证据目录的 `owned-window.diff`，用于区分继承改动，不代替提交边界复核。

## 影响门禁与发布边界

本批编辑前使用 c478169a 时点的同一原生 schema-4 current 图谱。
SpiceDB read 的 CRITICAL、write 与 Params 的 HIGH 已在编辑前告警；
动态 BFF/构造/新文件 UNKNOWN 用实际源码消费与同 Tenant scope 核对补证，
不解释为零风险。PDG 有界结果和原始失败均保留。原图不证明新代码完整覆盖，
提交前统一刷新与 detect 由批次负责人完成。

当前 `agent.definition_management` 的 exposure 为 none，runtime routes/actions
为空，现有注册表闸门不生成用户入口。没有部署这一 Core 切片、没有新增
测试业务对象或夹具，也没有真实浏览器/API 的创建→审批→转移→撤权→删除
端到端验收。现有编译与迁移证据不替代这些业务验收或 Stage 5 退出门禁。

## 2026-10-02 原生增量契约登记纠偏

随后发现平台原生 `agent.definition` 的 `incremental_contracts` 仍为空数组。
本刀只纠正这条已存在消费者的登记：迁移登记完整的
`NATIVE_INTERNAL` / `NATIVE` 契约，说明稳定键、修订、删除、对账触发和
readiness 语义；数据库拒绝空登记。`agent_definition::prewrite` 在原有类型
登记检查中同时要求该原生契约存在，不建立另一套准入或注册权威。
没有改 Resource owner、审批、派发或投影逻辑，也没有创建 Version、
LLMRoute、RuntimeProfile 或运行时入口。

编辑前使用 e4c544fd 时点的原生 current 图谱；`prewrite` 的 HIGH（7 个受影响
符号，直接调用方 `Governance::allow_in_tx`）已明确告警。迁移和新领域文件
UNKNOWN 由真实 SQLx 迁移入口、治理调用和模块注册补证，不记为零风险。
原始影响记录为
`/volumes/data/kailo/tmp/codex-agent-prerequisite-impact-20261002.R3Od8p.log`。
本刀写入之后图谱自然落后；该前置记录不替代最终提交门禁。

### 实际检查与反向证据

使用同一不可变 SDK、显式 UID:GID `1000:1000`、CPU 2、memory 8 GiB、
内核 swap 0 和 Data 缓存。临时 PostgreSQL 使用前述固定镜像，CPU 2、
memory 1 GiB，仅回环随机端口，未使用业务数据库。原检查函数及原 Cargo
命令没有修改，也没有新增测试、样例或夹具。

- `migrate-registration-final.log`：原 `step_migrate` 前进、回退、再前进 PASS；
  包含本次纠正后的 39 条迁移，SQLx 离线数据同步 PASS、40 个命名枚举约束
  PASS；真实登记读取为 `1|NATIVE_INTERNAL|NATIVE`。
- `migrate-registration-raw-prepare.log`：在该隔离库事务内把登记改为 `[]`，
  原约束确实报错，退出 1；只把真实登记的 role 改为其它既定值时，同一
  生产 JSONPath 准入谓词返回 `f`，回滚后返回 `t`。未保留被破坏的登记。
- `contracts-cache-clippy-final.log`：`cargo fmt --manifest-path core/Cargo.toml
  --all --check` 与 `cargo clippy --manifest-path core/Cargo.toml -p platform-core
  --offline -- -D warnings` 实际退出 0，整次 `sdk_terminal=0`。
- 工程与 SDK 副本的 `agent_definition.rs` SHA-256 都为
  `c0153938e6a8de78b8f30f415b9e85fae37ea53b3718d17d0b39ec9cdb03e9dd`，
  迁移都为 `a8259f72b616949a1cbb38a0eea9f1d3e3c41ed18b7a9cc3538cd8725c53a338`。
  最终 SDK 和该次 PG 容器已经精确删除，Docker inspect 确认不存在；日志与
  本 lane 的 Data 副本保留，未清理其他缓存或服务。

本次原始日志均在
`/volumes/data/kailo/agent-prerequisite-sdk-20261002.4isiSf`。原失败保留：
首次 shell 引号错误在启动容器前退出 2；随后一次 sudo 环境隔离导致
DATABASE_URL 未投递，迁移 SKIP，不算通过；私有源码副本漏实际注册表导致
SQLx 编译失败，补入原文件而非合成配置后才通过；首次 fmt 漏原命令的
`--all` 退出 1。后续 clippy 退出 101 指向旧 contracts 派生产物：容器内
当前源确实含 `PlatformSessionAccessMode` 并与工程 SHA 相同，随后只执行
`cargo clean -p contracts`，删除该包的 132 个派生文件后检查通过，未改类型
或放宽检查。第一次清理 launcher 因 SDK 不含 `rg` 在执行清理前退出 127，
之后仅将只读符号诊断改用已安装的 `grep`，没有安装或修改 SDK。

这些结果只证明本次登记与生产准入判据纠偏，不是 AgentDefinition 业务
端到端、AgentVersion 发布、模型调用或运行时验收，也不是 `--full` 通过。

## 2026-10-02 派发前 Tenant ACTIVE 谓词纠偏

本刀关联 `DD-96`、`.design/03` 的 Tenant 状态与 `06` §7.2：暂停首先
停止组件投影与 Resource/Asset 创建。原 `roles::lock_tenant` 只读取行存在性，
不能作为 `agent_definition::dispatch` 的 Tenant ACTIVE 事实。

派发现直接锁定同一 Tenant 行并读取 `state = 'ACTIVE'`，缺失行按 false
处理；AE → Tenant → Resource 的锁序不变。非 ACTIVE 不完成成功投影，
仍复用原 `abort_projection` 恢复冻结 owner 或删除创建投影，原生结果未查证
时保持 UNKNOWN。不改公共 helper、准入权威、API/schema 或关闭入口。

编辑前原生 upstream impact 为 LOW，6 个受影响符号，直接调用方为
`Governance::dispatch_inner`；原始退出 0 的记录为
`/volumes/data/kailo/tmp/codex-agent-dispatch-impact-20261002.log`。
本刀没有新增测试或夹具；格式、静态检查与原 SDK 验证由批次负责人集中
执行，此记录时尚未取得本刀验证结果，不复用此前结果宣称通过或业务验收。

随后本刀进入固定树 `254e071fe529f565bb854e4483390c1087f5ef7e`，原
`tools/check.sh --full` 在不可变 SDK、4 CPU、8 GiB、swap 0 下实际退出 0；
包含格式、静态检查、四侧既有验证、契约兼容、replay、追溯与文档门禁。
原日志为 `/volumes/data/kailo/tmp/codex-core-functional-closure-254e-full-20261002.37trEJ.log`。
未投递 DATABASE_URL 与 `.env`，迁移演练和真实部署预检均 SKIP；此前
37 迁移隔离库证据属于修正前源码，不能当作本刀数据库通过。未取得
暂停 Tenant 派发分支的业务运行证据，尚未提交、正式构建或部署。

## 2026-10-02 11:53 UTC AgentVersion 契约生成事实

AgentVersion/Asset 的契约、迁移与治理/投影处理器源码已写入；冻结的 16 个
输入文件在生成前后摘要一致。原 `tools/gen.sh` 在不可变 SDK 镜像
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`、
实际 4 CPU/8 GiB、无额外 swap 的容器中产出 Rust、Go、TypeScript、Dart
契约；`GEN_ATTACH_EXIT=0`、`GEN_CONTAINER_EXIT=0`，六项生成物摘要回读一致，
其中两项既有 i18n 输出字节未改变。未手写共享类型或新增生成入口。

原始日志为 `/volumes/data/kailo/tmp/codex-agent-version-generated-20261002.YBWlJF/gen.log`，
SHA-256 为 `8db2b7eaec12d4d98a98a0963e56b36f5dd8d42a6fb7f73f0fac9c062e86c5fa`；
输入冻结清单为
`/volumes/data/kailo/tmp/codex-agent-version-owned-before-20261002.2jUk6e/source-frozen.sha256`。
本项只证明源生成，不是 AgentVersion 的集成编译、迁移、双向序列化与兼容
验证或业务验收。owner/成员撤权与 Tenant 删除等实际消费方尚未收口，
RuntimeProfile/llm_route 实际目录事实尚缺，公开入口保持关闭；未提交或部署，
不复用前文 `254e071f…` 的 full 宣称本增量通过。

## 2026-10-02 12:32 UTC AgentVersion 消费链实现增量

本节记录实现后的事实，不是新增规格。依据 `DD-24/25/45/47`、领域模型
`03` 与 Agent 管理 `17`：Version 是已有 Definition 下的 Asset，owner 是
active HUMAN；本批没有创建第二注册表、额度或审批权威，也没有安装或启动 Agent。

写入前已对全部实际目标完成原生 context/upstream impact，原件为
`/volumes/data/kailo/tmp/codex-agent-version-consumer-impact-20261002-resolved.jsonl`，
实际退出 0。索引根是 apps，固定 HEAD `8ec78ed4…`、runner schema 4，
官方 status 与 typed context 的身份相同且 incomplete reasons 为空。
owner 校验 CRITICAL，冻结清单、审批输入与 BFF 资格 HIGH 已在编辑前告警。
部分入口的 impact 为 UNKNOWN 或 lower-bound；真实 BFF/service 路由、Worker
CoreAPI 和 SQL/map 消费由源码补证，不把零入边或没有流程输出当作没有调用。
原生索引本身报告流程预算与部分语言覆盖缺失，不能声称全工程图谱审查完整。

三个队友分别写入 Definition/SpiceDB、成员撤权、邀请准入消费；负责人写入
治理/BFF/Tenant 删除和 Version 派发复核。准确变化为：

- Definition 查询真实 published pointer；不再固定返回 None。
- 冻结 Resource 与 Asset 的实际 owner/version，任一 pending projection 拒绝；
  重核双方状态、active HUMAN/TenantMembership、父 Resource 与两类原生投影。
- 既有快照分别持久化两类引用；审批输入、fresh 资格和 BFF 生命周期身份
  都消费这两类引用。未知 targetType、重复引用与版本冲突不转为授权。
- 成员最终撤权同事务核对 Resource/Asset owner 和未收敛投影，保留 Tenant
  销毁例外与原 409/503、会话撤销、版本及审计行为。
- 邀请准入仅补新 Params 的三个 None，不创建 Asset、Version 或新业务动作。
- Tenant 删除沿原生 SpiceDB 删除完成、非空 revision 与空集合回读，纳入
  冻结 Asset；真实外部证据齐全后，先清 Definition pointer，再将 Version
  退役、Asset/Resource 墓碑化，保留历史 FK、Operation、Usage 与 Audit。
- Version 派发重新读取父 Resource owner 的 ACTIVE 事实，不以投影命中代替
  身份与成员状态；无法查证仍 fail closed，UNKNOWN 不渲染为成功或失败。

锁与事务仍归既有 ActionExecution/Tenant/Resource/Asset，未改 Workflow type
或终态证据权威。ActionCommand 新字段可选，历史空 Asset 快照数组仍可读取；
新共享类型来自 contracts 原生成器。当前没有旧版在线 writer，历史数据迁移
兼容窗口无适用对象；新迁移非空 Asset 时确定停止回退，不能静默丢弃版本权威。
三端管理面仍一律经 BFF，Web/Desktop 不新增两套实现，Mobile 不增加写入口。

本记录时各实际源码 diffcheck 退出 0，正在选择排除独立 CHECK/NIP-11 的集成
输入；本批尚无 SDK、迁移、业务闭环、提交、release 或部署通过声明。前文
原 full 和原四侧生成均只证明各自记录的输入，不能替代本次消费者的验收。
没有新增测试、夹具、检查脚本或伪 ACTIVE RuntimeProfile/llm_route；目录事实
缺失仍拒绝，Installation、Codex turn、工具用量、记忆与自动化仍未交付。

## 2026-10-02 12:45 UTC 集成编译接线纠正

本批选定输入重新运行原 `tools/gen.sh` 与格式化，实际退出均为 0；
随后原 clippy 实际退出 101，发现三处接线错误：两个消费者错误地使用
顶层 `AgentVersionContent`，实际 ActionCommand/View 引用生成类型
`ContentClass`；Version 消费的既有冻结目标版本方法未开放 crate 可见性。
原失败保留于
`/volumes/data/kailo/tmp/codex-agent-version-gen-clippy-20261002.gxu8tq/verify.log`。

实现只改为消费真正的生成引用类型，并让冻结版本方法为 `pub(crate)`；
未手改生成物、复制结构、变更契约含义或放宽授权。选定输入与正式代码
同样修正，原全量检查与独立空库检查随后集中重跑，结果单独登记。

## 2026-10-02 12:58 UTC 集成与空库结果

本批原 `tools/check.sh --full` 实际退出 1，完整原件为
`/volumes/data/kailo/tmp/codex-agent-version-selected-full-20261002.wPL3eW/full.log`，
SHA-256 `73cbf77b6de1afd7b15f12962c3e1b01920a9012bb46b294e487dec2ca11869d`。
格式、clippy、Go vet、TypeScript/Dart 静态检查、四侧已有验证、history replay、
四侧生成同步、108 个 schema 与三份历史契约兼容、文档与静态安全检查均通过。
已有双向序列化 canary 不覆盖新增 Version 业务 payload，不把它写成业务验收。

失败分列，不改成通过：追溯误将 S1/S2 的 `DD-45/47` 写成 S5 归属，现移除
这两个归属项，仍在本记录保留它们的共用治理依据；检查输入未挂载既有
Core/Worker dist 证明；新契约的 Web/Win11 实际输入与旧 artifact 来源不符。
另有 launcher 全局 Git 环境污染只读上游的仓库选择，不能据该失败宣称
上游 commit 缺失。后续用原入口纠正 Git/dist 投递，并正式重建受影响产物，
不修改门禁、源码摘要或断言绕过。实际 `.env`、gitleaks 与 Mobile 签名边界
仍按原输出保留；尚无新增提交、正式 Core/Worker release 或业务部署。

独立空库原 `tools/check.sh migrate` 实际退出 0：38 条迁移已应用，含
`20261002110000` AgentVersion；前进、末条回退、再前进与 workspace SQLx
离线核对通过，41 项命名枚举约束与契约逐值相等。没有旧在线 writer，
没有创建测试业务对象。原件为
`/volumes/data/kailo/tmp/codex-agent-version-fresh-db-20261002.MOuD6a/original-migrate.log`，
SHA-256 `ce1446caba578f51708bb765db50132a06cd3f12e70f4ff1208bc01d2e406683`。

迁移后的附加只读计数命令有 shell 引号错误，使外层 SDK 容器退出 1，
不是原迁移失败；失败原文保留。仅重取计数，原生 psql 实际退出 0，
Resource、AgentDefinition、Asset、AgentVersion 行数均为 0；原件为同目录
`post-migrate-facts-retry.log`，SHA-256
`fc2d93116f91e52efcadcaa7c13ab4978675cbf5347646ecdbb5ee9dcd5212b2`。
SDK 与 PG、唯一网络均已精确清理，Data 原件保留，不声称磁盘数据已删除。

## 2026-10-02 13:30 UTC 后实现图谱与 Web 产物事实

图谱原生 worker 崩溃和不被支持的 `--workers 0` 失败原件均保留。
使用同一固定 runner 的受支持 `--workers 1` 重试，实际退出 0；源码根与
Git 根均为 `/volumes/kailo/apps`，没有升级、修改工具或索引外层工作区。
原件 `codex-agent-version-final-worker1-graph-20261002.log` 位于 Data 临时目录，
SHA-256 `830f97a5ecd59f6b1f37880d975f2a57fca29366ecee2551089a798f754e6b5c`。
随后原 status 与 typed context 核得 HEAD `8ec78ed4…`、runner schema 4、
身份 current、content drift current、incomplete reasons 为空。

后实现原 explain/PDG 查询定位 Version 派发、冻结 owner 与 BFF 资格。
Version 文件 controls 返回全部 194 条；flows 首次只返回 200/278 条，
断言实际失败，原失败保留，没有当作干净结果。随后通过原只读 Cypher
枚举该文件的实际变量，用原 pdg_query 的 variable 参数逐项查询 63 个
变量，全部结果无截断、计数合计精确为 278；三处 owner/资格目标查询也
未截断。完整原件为
`/volumes/data/kailo/tmp/codex-agent-version-post-implementation-pdg-partitioned-20261002.jsonl`，
SHA-256 `de9f27a2503a5c60e3b9f99a0a8e9f87d6b9e2885cf0c6e2ce29c23b71b37706`。
没有上调上限、修改引擎或豁免 PDG 截断。零 taint finding 不证明没有风险；
原生流程预算、动态调用与语言覆盖缺失仍保留，不称全工程安全审查完整。

共享生成合同实际改变 Web 构建输入，原 Web helper 已完成构建、registry
push 和原 record，实际退出 0；source `e01a495e…`、artifact `0f5039d6…`。
Compose、13 份既有追溯与 upstream 的真实引用已经同步，完整依据见
[Web 核验](../../web-client/fork/verify/web-surface.md) 本日增量。
本条记录时 Win11 同源重建仍在原 helper 中，不冒称已产生新包。新 Web 未部署；
本批仍未提交或取得最终 full/detect，通过源码检查不等于新增业务验收。

## 2026-10-02 13:52 UTC 客户端来源收敛

随后原 Win11 helper 已真实退出 1：Tauri Windows 打包在下载
`https://index.crates.io/2/h2` 时发生网络低速超时，尚未产出新安装包，
没有执行成功的 Desktop record。历史 `9aef4725…` 包不属于当前
`9255e0e8…` 源码，不能把旧包重新标为新来源。

当前 Desktop 来源登记按已有 manifest 的缺产物状态撤回，原失败日志、
旧包与历史来源证据保留，具体原文见
[Desktop 记录](../../collaboration/fork/verify/desktop-client.md)。
这没有修改验证工具、构建输入、依赖或运行语义，也不解除 Win11 发布
与安装验收；本批实现继续收口，Windows 缺包不再被隐瞒或用于无限等待。

## 2026-10-02 14:01 UTC 最终集成收口

最终选定树 `7de76d450c4b54086a79841cf9a866a9c13aeaf2` 在同一不可变
SDK 镜像内实际运行原 `tools/check.sh --full`，`FULL_EXIT=0`，外层 SDK
和 attach 均退出 0；20 个选定源码和四侧生成物的 SHA-256 逐项核对一致。
源码、Git 与检查范围均为独立 apps，正常只读 Git 投递使固定上游基准
真实可解析，没有修改验证工具、缩减来源或使用全局 Git 变量影响证据。

原日志：
`/volumes/data/kailo/tmp/codex-agent-version-selected-final-full-20261002.BkGKqU/full.log`，
SHA-256 `460b33a9b62c5217523c7dcee7b99c6785dc138dff542854c248265b5fbcd366`。
格式/静态检查、四侧既有验证、108 schema 与 3 份历史契约兼容、replay、
17 条追溯、文档及现有安全不变式全部通过。full 内没有提供 DATABASE_URL
和实际部署 `.env`，两项明确 SKIP；独立空库迁移/SQLx/41 约束的实际
结果以上述各自日志为准。内置 secret 扫描通过，但未安装 gitleaks。

Desktop 当前来源为 blocked/none，Mobile 缺 release 签名，原输出明确
记录两端阻断；分端门禁通过不解除这些发布条件。新 Web 产物未部署，
Core/Worker 未由本树构建部署，Agent 公开入口和新增业务场景未验收；
没有改变能力状态或将检查通过写成生产就绪。此前失败与旧产物证据保留。

## 2026-10-02 16:35 UTC Definition-only 共享客户端增量

本次直接消费已经实现的 Definition 管理链，不增加 Agent 注册权威、API、
数据库对象或运行策略。依据 `.design/17` §6–8 与 `DD-24/25/45`，稳定定义、
版本发布、Workspace 安装及运行授权是不同准入点；定义创建/显示名更新不需要
启动 runtime。`resource.transfer_owner` 仍按 `.design/05` §2.8 走既有审批，
Core 的目标查询通过 `catalog.agent_definition` 限定真实 Resource。

既有追溯记录只登记 Definition 列表/详情与 Version 的三条只读 BFF 路由，以及
`agent.definition.create`、`agent.definition.update`、`resource.transfer_owner`
三个已有动作。BFF 的 `exposed_route` 已有实际消费，不另建路由；没有登记
Version 写动作、删除、Installation、Invocation、Skill、Tool 或模型管理入口。
能力目录仍须由原 `tools/gen-registry.py` 生成，不手写生成物。

Web 与 Desktop 都挂载 `client-kit/ts/platform/src/react/agents.tsx` 的同一份
`AgentDefinitionsPage`；宿主只接既有导航、图标与内容分支。Desktop 的
`PLATFORM_SECTIONS` 改为直接引用共享导航目录，不再维护第二份枚举。
共享客户端从生成的 Definition/Page/Version 与 ActionCommand/Submission
契约读取字段；没有改契约或手写第二份领域类型。列表/详情读取失败不是空列表，
未知状态或不完整 Resource 事实不显示为就绪；当前 published pointer 的 Version
读取每次仍由 BFF 执行 fresh read 与父 Resource/Asset 投影核对。

写表单复用现有语义色、Button/Table、useLoad、幂等键、Task 状态解读和
writeFailure 规则。核对面板冻结实际读取的 Resource ID/version 与命令；创建
仅写稳定标识/显示名，更新仅写显示名，owner 转移仅引用新的 HUMAN Principal。
权限、成员资格、审批、Quota/Capacity 与版本冲突仍由 Core 重查。
网络结果不明、派发 UNKNOWN、EVALUATING 或尚未派发的 ALLOWED 不渲染为
成功/失败，不取消冻结意图，只允许以同一幂等键重查原请求；列表翻页或刷新不
卸载此意图。已登记回应只展示 Operation/ActionExecution 引用，并指向既有
Tasks/Approvals 查证，页面重入时也读取本人仍在进行的定义任务。

所有新增文案进入共享 `en/zh-CN` 消息表，继承宿主主题；未新增 Mobile 组件宿主
或写界面。新增共享文案的 Dart 投影仍需原生成入口集中生成；不手改生成物。

本刀改前字节与精确差异存于
`/volumes/data/kailo/tmp/codex-definition-ui-window-20261002.BS2o8R/`。
源码检索已核对两真实宿主、BFF、治理参数、原 ACTIVE ActionDefinition 与审批
目录；GitNexus 按用户当前要求暂停。已运行选定已跟踪路径的 `git diff --check`，
退出 0；新增文件的 no-index 检查无空白错误输出，其差异退出码不作为编译通过。
没有运行 SDK、类型检查、React/浏览器验证、注册表生成、文案生成、构建、
业务端点演练或部署；这些由主线在实际选定输入上集中执行。

当前追溯记录仍为 `in_progress`，release gate 保持
`blocked_until_seams_closed`，没有借旧 Web/Desktop 或 Core 摘要冒充本刀产物。
exposure 的源码登记不等于当前运行版本已开放；须原生成、实际新来源产物与
端点验证收口后才能发布。此前空库、full 通过及入口关闭的历史记录均保留，
不改记为本次业务验收；本刀未提交、未 push、未部署，不宣称 Stage 5 完成。

### 2026-10-02 16:56 UTC 同窗口消费纠偏

实现后复核发现原表单将任务读取失败当作零条在途请求，而且在途 owner 转移
只有提示，未阻止同一 Resource 的新意图。现已直接修正该判定：原任务读取
pending、失败、未知 gate/dispatch/task 枚举或缺少关联引用时，不准备新请求；
同 Definition ID 的修改/转移仍在进行时必须先查证，创建在途时不另发创建。
这些是客户端防重复交互，不替代 Core 的 fresh 权限、审批和版本核验。
结果不明的原意图仍保留冻结命令与幂等键，只重查原请求；任务与审批仍由
原 BFF 消费，没有新建状态权威或存储层。已有任务可手动刷新查证，不设置
新的超时或自动重发。回应含未知 reason 也视为不明，不展示确定成功/失败。

已登记回应会关闭旧详情，再从实际目录读取新的 owner/version；不在客户端
乐观修改 owner。新的 owner 与旧 owner 相同不准备转移。当前 published
pointer 只接受实际 PUBLISHED Version；读取期间遇到 DRAFT/RETIRED 或不一致
关联时显示读取失败并允许刷新，不把矛盾生命周期渲染成已发布。没有 pointer
仍是合法的“尚无已发布版本”，并非读取失败。未使用的 Draft/Retired 显示分支
和文案已删除，未加入 Version 列表或运行入口。

本次共享新增消息为 34 项。原生成入口为 `python3 tools/gen-registry.py`
及其 `--check`，和 `python3 tools/gen-platform-i18n.py` 及其 `--check`。
后者必须调用 Dart formatter，按禁止宿主工具链的约束，本 lane 未运行生成，
交由主线在已有受限 SDK 中集中执行；无契约改动，不手写四语言类型。
生成产物是否一致、编译和真实端点结果以主线实际日志为准，不提前记通过。

现有 fork manifest 的 source/artifact 摘要只证明其实际构建版本。共享 TS 改动
进入 Web/Desktop 的真实构建输入，registry 改动进入 Core 的 release 输入；
旧摘要不能证明本刀。原 release/build-upstream 入口须实际构建并登记最终来源，
再同步 trace 的产物引用。本刀未填入假摘要或以源码 exposure 代替已部署事实。
原 before 保留，纠偏后精确窗口继续存于同一 Data 证据目录；产品源码于
16:56:54 UTC 停写。选定已跟踪路径 `git diff --check` 再次退出 0，仍没有 SDK、
浏览器/业务正向验收、构建、提交、push 或部署。

### 2026-10-02 17:23 UTC Definition-only 候选实际验证与 Web 构建

本节追加已发生的结果，不覆盖上述写作时尚未执行的历史。唯一输入为
`/volumes/data/kailo/tmp/codex-definition-ui-head-20261002.q85LI1/candidate`，
从 apps HEAD `d994b2e8dab0eb19889720fef0f3cc9763c95dc9` 精确选入上述
Definition-only 11 路径；原私有 tree 为
`8f49dbd1f4cda38902949d1168b29606e4a90166`，生成及既有检查修正后的 tree 为
`5923b19a450bef265d2feedb7c2152a81bb19c58`。这些是输入 tree，不冒称提交。
未选入正式工作树的 Installation、Invocation、Quota 或 Gateway 后续增量。

实际 SDK 为
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
UID/GID 为 1000:1000，镜像内 Node 为 v24.21.0。执行前核查现有构建与
CPU/内存压力；实际 cgroup 为 4 CPU、8 GiB、swap 0，缓存与临时目录均在
Data。没有调用宿主 Node/Dart、执行只读上游或修改检查工具。原 registry
生成及 `--check` 均退出 0，17 条能力、18 个封闭 Workflow kind 校验成立；
原 i18n 生成及 `--check` 均退出 0，Mobile 文案投影与共享 TypeScript 同源。
实际变化只在既有 capability registry 和 Dart platform_text 投影，无 DTO 变更。

共享包类型检查退出 0，原 7 文件 77 项检查通过；Desktop 类型检查退出 0。
首次 Desktop 原完整检查为 2282 项、2281 通过、1 失败，SDK 实际退出 1：
`fontSizePreference.test.mjs` 仍读取已迁走的 Desktop typography 路径，报
`ENOENT`，不是 OOM。实际 Desktop/Web 都已引用共享 typography；因此只把
这份既有检查的读取路径改为真实共享 CSS，没有复制旧 CSS、新增用例或夹具。
续跑该原检查为 9 项通过、退出 0；Web 原 `npm ci`、类型检查与 4 文件 14 项
检查均退出 0，包含 MessageContent 的 5 项既有 SSR。未重复共享检查、生成
或整个 Desktop 检查，不把首次失败改记为完整 Desktop 退出 0。

修正检查后只在 Data 候选将共享 CSS 的真实 rem 投影临时破坏为 `1px`，
同一原检查实际 8 通过、1 失败、退出 1，确实命中 root rem 断言。随后按
原字节还原，CSS SHA-256 恢复为
`a70c922ca8ea648f818bff79fe0c05d65004a1a3d72eab6303d85d49275b24ad`，
同一 SDK/同一检查重新 9 项通过、退出 0。正式 CSS 未写，候选无破坏残留；
只有上述既有检查的一行路径同步入实际实现范围。

原 `tools/build-upstream.sh web-client` 实际退出 0，完成镜像内 tsc/Vite、
OCI load、registry push 与原 record。使用既有 kailo-core-data builder，
实际 8 CPU、16 GiB、swap 0，缓存为 Data 的 buildkit-core-state；发布地址
只来自唯一部署 `.env` 的 REGISTRY_HOST，没有改配方、限额或新建服务。
原 helper 写回 source
`sha256:ef73ee2c0a29dc27746ed6219357ea9f99d862a90afaf38ab9b6dd3f0f3a89db`
及 artifact
`sha256:ad4bcec7044b5ce55a219aff4d37ce35f9e9db2a0025e977d4a71a6ac69b61b0`。
构建报告 npm audit 0；大 chunk 警告完整保留，不上调阈值或伪造来源。

原件均在上述 q85LI1 的 `logs/`：`sdk.log`、`sdk-exit.log`、
`sdk-remaining.log`、`sdk-remaining-exit.log`、`css-negative.log`、
`css-negative-exit.log`、`css-restored.log`、`css-restored-exit.log`、
`web-build.log` 与 `web-build-exit.log`；各实际容器限额另存于同目录。
原 helper 的完整 BuildKit 日志是 `tmp/build-web-client.HAb7Bu.log`。
`web-build.log` SHA-256 为
`8f503754b133d54f6181445dffe4a1e345cad71a86fd58a517c976ead63d9223`。
本 lane 创建的三份 SDK 容器已清理，日志保留；没有清理其他容器或缓存。

既有检查不包含新增 Definition 表单的业务正向、撤权、审批或 UNKNOWN 场景，
不得据类型/SSR/构建称其业务通过。本节没有数据库、真实登录或 BFF 端点演练，
也没有 Win11 包或安装验证；Mobile 没有加入组件宿主。Core release 输入因
registry 变化仍须由主线实际收口；仅新 Web 镜像不证明运行中 BFF 已开放。
本刀尚未执行集中 full、提交、push 或部署，release gate 与 Stage 状态不提升。

### 2026-10-02 17:37 UTC 同一候选集中门禁收口

实际构建之后，Data 候选仅将 Compose 和 13 份既有 trace 的有效 Web
产物指针同步为上述真实 `ad4bcec7…`，Definition 记录也只登记这一实际
Web artifact。未借用 Core/Desktop 旧摘要，仍保留 `in_progress` 与
`blocked_until_seams_closed`；历史验证正文中的旧摘要不全局替换。
原 `upstream_manifest.resolve/source_digest` 重算仍等于已登记的
`ef73ee2c…`，这些配置/追溯变动未改变 Web 构建输入，不重复构建。

最终业务及登记输入 tree 为
`67fc8e3d10582473578aad67e619dd5b68262193`，29 路径，逐项字节校验一致。
在同一不可变 SDK、4 CPU/8 GiB/swap 0、Cargo 并行度 16、Data 缓存与
host network 下，执行未修改的原 `tools/check.sh --full`，实际退出 0，
attach 退出 0、无 OOM。源码只来自该 tree 的独立导出，不含正式脏工作树。
应用 Git 和只读上游 Git 各自解析，不执行 `.references` 中的程序。

首次 full 因 SDK 全局 Git 环境误投递，将只读上游查询也指向 apps 对象库，
错误报告 Codex 基准不可解析。实际中止退出 137、无 OOM；它不是完整
full 通过，也不能据此认为固定上游 commit 缺失。没有修改门禁或产品源码，
修正投递后仅在启动前的单条命令解析私有 tree，进入原 full 前清除全局 Git
变量；正常只读 Git 投递的完整重跑退出 0。两次原日志均保留。

最终格式/静态检查、四侧生成与已有测试、108 schema 与 3 份历史契约兼容、
Workflow replay、设计文档、17 份追溯/18 种 Workflow kind、18 份既有
产物元数据、6 份上游来源和 4 份当前来源产物、安全不变式及 runbook 均通过。
没有 DATABASE_URL，实际迁移演练和 SQLx 在线核对明确 SKIP；没有实际部署
`.env`，运行配置预检明确 SKIP；未安装 gitleaks，只通过现有内置扫描。
原输出保留 Windows 无当前包和 Mobile 缺 release 签名的阻断，不能用该
full 退出 0 解除两端发布条件或替代 Definition 新业务场景验收。

原件仍在上述 q85LI1 `logs/`：首次 `full.log`、`full-exit.log`；最终
`full-corrected.log`、`full-corrected-exit.log`、`full-corrected-limits.log`，
以及 `full-container-terminal-states.log`。最终完整日志 SHA-256 为
`f7b8d9fded928f17dc7d42c4ac09077f8dfae21f0c57bb6ae8bf6c8749e56b58`。
full 所验证的完整补丁、29 路径与字节表分别保留为 q85LI1 下的
`full-verified-window.patch`、`full-verified-owned-paths.txt`、
`full-verified-selected.sha256`。之后只追加本节事实记录，不改变已验证源码
或产物输入；提交、push、Core 发布和部署由主线另行收口。

### 2026-10-02 17:48 UTC 阶段提交与远端核对

上述 29 路径已提交为 `91a5eb2e779593ea8cfb38e10ec6c04886f88138`，
提交树为 `aa7ea2602e557e38380117ff1560efadd62e88ee`。普通
`git push origin main` 实际退出 0，远端 main 从 `d994b2e8…` 更新至
`91a5eb2e…`；随后 `git ls-remote --heads origin main` 回读同一完整 commit。
追加事实记录后的原 `tools/check-docs.sh` 对提交树退出 0，日志为
`/volumes/data/kailo/tmp/tmp.jEJlwE0JCa.check.log`。没有触发 pre-push
全量检查、额外构建或部署。本次提交不包含仍在开发的 Installation、
Capacity、Session、Memory 或 Gateway 增量，不能外推其验收结果。

## 2026-10-02 18:12 UTC Installation 与原生 Memory 消费事实

本节只追加已经写入的消费链，不把前述 Definition-only 提交的 full 或 Web
构建结果外推到本批。依据为 `DD-25/50/66/67/72/99`、`.design/03` §7、
`.design/17` §6–7、`.design/19` §3–4/§8 与 `SS-BUZ-ENGRAM`；适用场景为
`V-SCN-23/59`，这里只记录实现，未将这两个业务场景记为通过。

### 已有 Installation 意图与激活消费

`agent_installation.rs::target/prewrite/start/create_projection/initialize`
复用 Resource、ActionExecution 和 `ComponentTaskWorkflow(kind=AGENT_INSTALLATION)`。
创建固定实际 Workspace、Definition Resource/version 与 PUBLISHED Version
Asset/version，Resource 的责任 owner 是 ACTIVE HUMAN；独立 AGENT Principal、
Buzz identity、DISABLED Channel binding 与 PENDING runtime generation 均属于
同一安装，不从 HUMAN WorkspaceMembership 推断 Agent 授权。
`20261002190000_agent_installation_create.up.sql` 登记的管理创建动作明确为
`capacity=NONE、quota=NONE、meters=[]`，不因此开放 Codex 回合或模型用量。

AGENT 密钥写入前已有持久 Resource projection ActionExecution。现有
`read_or_write_provision_key` 使用固定 Tenant locator 与 CAS=0 后回读，
不为结果不明另分配 locator 或 pubkey。`create_projection` 在原 Tenant/
Workspace/ActionExecution 事务中绑定同 Tenant CONTROL counterparty，调用
`agent_memory::reconcile`；返回 false 时仍提交真实 ERROR/UNKNOWN 观测，
不投影 Channel roster 或把失败当作空记忆。Memory 成立后才对账 SpiceDB
Resource/workspace 关系、fresh discover 与真实 Relay/Channel roster。

`initialize` 对原 PROVISIONING/PENDING 意图先核原管理准入、实际 Workflow
启动事实与 fresh HUMAN 权限，再消费 `model_route::provision`、审计就绪的
SecretStore 读取和 Supervisor `ensure`/原生配置回读。ACTIVE 同代恢复使用
原模型 binding，不制造新代。原网络调用后的 snapshot、Tenant/Workspace、
发起者/owner 成员行锁、授权与 projection generation 再次核对后，才可在
同一事务 CAS 激活 Resource、Installation、runtime projection 与 Channel
binding。原生初始化只证明实际加载的字段；`verify_projection` 不把缺少策略
消费者的 RuntimeProfile 内容全部标成 effective。缺事实继续保持非就绪。

### SS-BUZ-ENGRAM 的真实读边

上游基准重新以只读 Git 核验为完整 commit
`779af8886caae1317b4de962082429867ab61503`。可解析来源是该 Buzz 仓库中的
`crates/buzz-core/src/engram.rs::{conversation_key,d_tag,validate_and_decrypt,select_head,NIP44_PLAINTEXT_MAX}`、
`crates/buzz-acp/src/relay.rs::RestClient::query_raw_all` 与
`crates/buzz-acp/src/engram_fetch.rs::{fetch_core_body,decode_core_body}`；实际
证据目录为 `/volumes/kailo/.references/buzz`。没有执行其中的程序。

新 `collab-bridge/src/memory.rs::Reader` 直接依赖 apps 中的同源 `buzz-core`，
不复制加解密、slug/HMAC 或 head 算法。CONTROL 用现有 NIP-98 读取同一
Installation AGENT/counterparty pair；fresh NIP-11 给出页上界，原复合
`until/before_id` 游标走到末尾才 COMPLETE。完整页序、重复 ID、签名、
原生 envelope、解密和完整 plaintext bytes 任一不成立均拒绝；恰到 listing
上界仍作一条探测，超过上界是 BOUND_EXCEEDED，不伪装为完整空集合。
head 选择保留原生 timestamp/event ID 规则，不改写未来 head 或迁移 ciphertext。

`platform-core/src/agent_memory.rs::{Config::from_env,reconcile,read_core}`
消费既有 AgentMemoryBinding。Config 三项上界均必填且无源码默认值；body
还受上游导出的 NIP-44 上界约束。binding 查询锁定实际 Tenant/Workspace、
HUMAN owner/成员、AGENT、CONTROL 与原 Memory 行；PROVISIONING 只允许原
同 scope ALLOWED 创建意图及已启动的 AGENT_INSTALLATION Workflow。
双 SecretRef 的 locator/version/audience/pubkey、audit gate 和当前 Relay
NIP-11 snapshot 均实际重验，缺失不回退共享身份。成功枚举产生
COMPLETE/CONSISTENT/ACTIVE；超前 head 产生 HEAD_AHEAD_OF_RELAY/ERROR；
不可查证为 UNKNOWN/ERROR，确定撤销为 REVOKED。只 CAS 写 binding/head
引用和观测状态，原生明文不进入数据库、审计、history 或错误字符串。

新 Session 读取函数区分实际 Found、确认空集合 Absent 与原生不可读 None；
身份、scope、secret 或 projection 失效仍是拒绝，不降为 Absent。当前
`agent_session.rs` 已有真实调用点，但此记录不把正在集成的 Session 持久 pin、
首轮 memory context、恢复或用量链声称为已验收。Memory 写入、core 审批、
cold 工具和 Memory 管理入口不在本刀实现范围，`V-SCN-60` 未验收。

Memory 四个实际路径于 17:55:48 UTC 停写，原 before/after 字节在
`/volumes/data/kailo/tmp/codex-agent-memory-before-20261002.9KfWj4/`。
两新模块 SHA-256 分别为
`a03a9f534eb0048d5d544f2c30c6c2bcb61c5208d9b9a1a8dca146cace20330a`
与 `4594188d4e69c92dca45c1cb1438cec8f7496ec75c7e88f1431bdec49f8fc598`。
其余两条仅为 collab-bridge 现有 Cargo path dependency 与 lib module export；
继承的 `limits` export 不算本刀。`git diff --check` 实际退出 0；本 lane
没有启动 SDK、生成、格式化、编译、真实记忆/安装演练或部署。主线集中
SDK 的后续结果单独记录；目前未提交或 Git push，不宣布 Stage 5 完成。

### 2026-10-02 19:14 UTC 集中消费者批次证据

以下是上述实现之后的冻结批记录，不把正在开发的下一批混入验收。

- 权威：沿用 DD-47/48/65/66/67/70/71 与 SS-COD-CONFIG、SS-BUZ-ENGRAM；
  Core 只存平台治理事实与 thread/head/lease 等引用，不复制记忆或消息正文。
  AgentTask 使用 Temporal 的原 Workflow/Activity，不另建执行权威。
- 影响：安装 ActionExecution/ComponentTask、AGENT 身份/Memory binding、
  runtime projection、Session、Invocation 消费和 CapacityLease 共用原事务与
  scope；Worker 的 heartbeat/attempt/run input 和四侧生成物一并冻结。
  全新空库没有旧 writer，历史数据兼容无适用对象；公开动作仍只有已有
  Definition 管理及 Version 读取，不开放安装或执行。Web/Desktop 使用同一 TS。
- 副作用：Session 先落 STARTING 再 thread/start，结果不明只查证原引用；
  已知 thread 不是已派发 turn。Capacity 回收同时消费原生与 Temporal 终态，
  观测超时或缺证据不释放单位。原生 Memory 超前 head 在 inspect/read 两边拒绝，
  不改写为 Absent；Gateway 缺用量关联不推进非空输入游标。
- 边界：重复 Activity 只续同 run/holder/attempt，背压返回等待；取消 accepted、
  空 history、部分投影和上游未知状态不构成业务成功或失败。撤权后的安全收尾
  不发起新 turn；四项未有真实策略消费者的运行字段仍不可 active。
  DENIED/BLOCKED/PRECONDITION/LIMIT/CONFLICT/UNKNOWN 沿用 06 §4，UNKNOWN 不终结。

冻结目录为 `/volumes/data/kailo/tmp/codex-agent-batch-20261002.UGTzYB`。
`sdk-core-frozen.log` 实际退出 0、OOMKilled=false：SQLx prepare、全目标
clippy 与 Rust 既有检查通过。Worker vet/test、46 条独立空库迁移的前进、
最后一条回退与重进记录在同目录前序日志；这不是实际部署库或新增业务验收。
独立 PostgreSQL `catalog-check-restored.log` 位于
`/volumes/data/kailo/tmp/codex-agent-task-catalog-evidence-20261002.fMTAy3`，
SHA-256 为 `e9fca2a9e2e264ff08a7d1a2da74b58a211a2de3c807efe306b753837b683a29`。
实际 48 个约束、三个 scope trigger 和零业务对象；NULL 原生终态、缺双侧终态
引用的 RELEASED 均拒绝。事务内删除实际 Invocation 约束后相同检查确实报
SQLSTATE 23514，ROLLBACK 后原检查再次通过；未留下业务种子或删除实际数据。

首次选定树 `full.log` 实际退出 1，漏选能力注册表、Compose 产物 pin 以及
Web 来源不一致均按真实来源修正。Rust 的真实失败随后由原 lint 输出定位为
空 `CARGO_BUILD_JOBS` 投递；未设置就不传，不调低并行度。最终 full 独立留存，
数据库演练与实际部署配置缺投递时仍 SKIP，不把它们改记 PASS。

本批不包含正在开发的 Delegation、Usage audit/commit 或 Installation 查询。
首轮 Invocation、模型执行/回复、完整计费、记忆写入、自动化与三端业务闭环
仍缺实证，未以编译、HTTP 接受、镜像 push 或健康检查解除发布阻断。

### 2026-10-02 AgentTask 已有 Reply 引用只读消费

此节记录实现后的源代码事实，不是新增 Reply 策略或运行入口。

1. 权威：DD-47/48、03 AgentInvocation 与 12/17/19 的原生引用边界。
   Codex 固定提交 `7498521d288b9b3b96ffba4eedf089d8d6e06a84` 的
   `codex-rs/app-server-protocol/src/protocol/v2/item.rs::ThreadItem::UserMessage`
   给出 `clientId`；现有 `Supervisor::turns` 读取 full items。Task 现在即使
   已持有 turn ID，也要求同一个 turn 内唯一的 Invocation clientId，未知状态、
   缺关联、重复关联或不完整页不构成 native terminal 证据。正文不落 Core。
2. 影响：原 `AgentTask.advance -> observe` 消费持久 `reply_event_id`，
   仅在 native completed 后查证；它不生成 Reply ID、签名、发布或重跑模型。
   原 AE operation 的 AGENT DISPATCH 必须带同 Reply ID、AGENT pubkey 与
   ActionExecution 引用，并与 Tenant、Workspace、安装、pin Version 和
   projection generation 联合核对。任意一条引用缺失都不能称送达。
3. 副作用：`IdentityClient::channel_reply_exists` 使用原认证 `/query`，
   回应必须为单一确切 ID、kind 9、固定 AGENT 作者且原生签名有效。
   Channel 标签唯一；root/parent 使用 apps 同源 `buzz_core::nip10` 解析，
   必须等于 Invocation 的 root/source。查询后再次锁原 Invocation 并核对
   同一 DISPATCH/身份/scope 引用，才追加稳定键的 RECONCILIATION/ACCEPTED；
   审计只继承原引用，不保存消息或 Codex 正文。空查询、身份不可读、回应错误
   或并发引用变化仍待对账，不解释为拒绝、未送达或允许第二次发布。
4. 终态：Reply 观察不制造新授权；撤权后的读取只收尾已有意图。仍沿原
   Capacity native/Temporal 双侧释放，Activity 可结束不等于 Invocation 完成。
   原 Reply ID 未有送达证据保持 UNKNOWN；即使已查证送达，缺 per-turn 用量
   completeness 证据仍为 BILLING_UNAVAILABLE，未写 COMPLETED。

当前 `AgentVersion.replyPolicy` 和 RuntimeProfile 仅能表达策略键集合，没有
已验收的键到 thread/broadcast 原生语义投递。Buzz 固定提交
`779af8886caae1317b4de962082429867ab61503` 的
`crates/buzz-persona/src/resolve.rs::ResolvedPersona` 是两个独立布尔事实
`thread_replies`/`broadcast_replies`，不能擅自映射为 THREAD 默认值。
没有合法 Reply 发布路径时仍 CAPABILITY_BLOCKED；本刀未添加没有调用方的
正文解析或发布方法，也未把 `replyPolicy` 记作 effective。

实现窗口的原始三文件 before 位于
`/volumes/data/kailo/tmp/codex-agent-reply-owned-before-20261002.AiUi6Y/`。
本 lane 只运行源差异与 `git diff --check`（实际 0）；没有执行 SDK、格式化、
编译、数据库、真实 Relay Reply、Codex turn 或端到端演练，也没有图谱、
提交、部署或 push。新发布、合法 Invocation producer、完整计费与
RuntimeProfile 投递仍未验收，不因本只读消费者宣称 Agent 运行交付完成。

### 2026-10-02 原生首 turn 与两类实际用量的集中集成

此记录产生于实现之后，不重定义已有自动化或计量合同。

- 权威：DD-47/48/107、05 §2.9 与 03 §8。自动化 owner 是 HUMAN，实际 actor
  是已 pin Installation 的 AGENT；模型 token 只来自 durable Gateway，运行次数只来自
  唯一查证的原生 turn。复核 OpenMeter 完整 commit
  `6d76d8a6fa90fbbab2d41035d31df2acec7ad3af` 的
  `openmeter/meter/parse.go::ParseEvent`：COUNT 原生计为一，不读取 value property；
  `api/v3/handlers/meters/convert.go::ToAPIMeterAggregation` 与
  `api/v3/openapi.yaml::MeterAggregation` 的 API 值是 `count/sum`。
- 影响：原 Supervisor 的 `turn/start`、Task 的 CREATED 消费、Session 冻结 Memory
  引用、Automation Relay producer、同一 AE/Delegation/CHECK/Capacity、原 trace/usage
  outbox 与审计查证。Web/Desktop 只用共源 Installation GET，Mobile 只读管理。
  未发布迁移尚无旧 writer、原私有空库无模型 trace/usage，历史兼容无适用对象；
  回退拒绝有持久 trace/usage 的库，不删除真实使用记录。
- 副作用：写前派发意图先提交，AE→Tenant→Invocation 锁序下在原 guard 内 fresh，
  不另开锁自身的事务。冻结 Automation template 与临时触发正文分别成为原生 text
  input，不发明插值，不把正文写入 Core、审计或 Temporal history。
  同一 native meter 集合精确分离 automation count 与模型 token sum，CHECK 仍检查
  全部已登记 meter，不删计数 meter 绕过限制。
- 终结与异常：缺授权、binding、native startedAt、meter 或终态证据仍拒绝或 UNKNOWN。
  `AGENT_INVOCATION` 的稳定 ID/time/body 与已查证 native turn 绑定；模型事件继续
  使用原生 durable seq/ID。二者共用唯一 outbox 与已有治理周期，202 只 ACCEPTED，
  精确事件 stored_at 才 COMMITTED；投递不明保持原 ID 对账，告警归原用量 runbook。
  未有 per-turn 全集完成证据时不宣称完整计费或 Invocation COMPLETED。
  错误仍用 06 §4 六分类，撤权、重入、未知状态和恢复无连续 activity 事实不降级成功。

共享 UI 选定树实际 98 项通过；scope、Version pin、generation 三次私有破坏均有
断言失败，逐次还原后 9 项通过。原始 `ui-final.log` 位于
`/volumes/data/kailo/tmp/codex-agent-next-batch-20261002.reqvgM/`，SDK 退出 0。
前两次错误按钮 label 的失败输出保留；无关既有 theme 检查不混入本批。
这只是管理面呈现证据，不代替浏览器、Win11、Mobile 签名或 Agent 业务闭环。

### 2026-10-02 20:43 UTC 同批纠偏与实际输出

并行复核在实现后确认并直接修正四个可达问题：触发 HUMAN 与 owner 不同时的
成员撤权竞态；Session/Capacity 持 DB fence 等 Process 与旧派发反向持锁的循环；
Process 等待跨过 Grant/lease 期限；Workflow 已关闭而 native turn 已存在时的运行
计数漏消费。现在都是原 AE→Tenant→Invocation/成员 fence→Process，同一事务
在 idle-read 后重验；CHECK HTTP 后用 `clock_timestamp()` 再读真实 Grant/lease。
同一原 Usage 对账只读查证 fixed thread/turn、唯一 Invocation clientId 与 native
startedAt，补同一稳定 count/outbox；不改 Invocation 业务终态或重发 turn。

`agent_model_trace.invocation_meter_projection` 原 CHECK 对缺 key 的 `{}` 会得
SQL NULL、被 PostgreSQL 接受，已改为整体 `IS TRUE`。这是同一未发布迁移的
fail-closed 修正，不新增状态、历史窗口或第二 meter。原私有空库末三条迁移
实际回退/重进，49 条到 `20261002230000`；Agent Session/Invocation/lease 均零行。
复用原 catalog 检查核对 25 个实际 CHECK 标量边界，主动移除新 meter CHECK 后
报 SQLSTATE 23514，ROLLBACK 后原检查再次通过。没有向业务表插入假对象。

本批原件均位于 `codex-agent-next-batch-20261002.reqvgM`：

| 原件 | 实际结果 | SHA-256 |
|---|---|---|
| `sdk-final.log` | SQLx prepare、clippy、workspace 退出 0；两种 policy/runtime 变异各断言失败、按 SHA 还原且原检查通过；SDK 0 | `0d3d07c3f723d33e7faf8a28f9de816119d09626f36d94712dfa8356da91c9c0` |
| `ui-final.log` | 98 项通过；scope/pin/generation 变异各断言失败，还原后 9 项通过；SDK 0 | `bdf8288829be42d7fe4d56a9515fa9ac4bee2b729ad3767d475c366d65a5f26f` |
| `mobile-sdk-mutations.log` | 原固定 Flutter 3.41.7 镜像、非 root；12 项与四种实际变异/还原，SDK 0 | `2dbd52695a3ff189badbe438bc1692324fb657482bb0423432a3b0a431487008` |
| `web-build.log` | 原 Web helper、registry push 0，真实 artifact `13841511…`/source `28eb2fd4…` | `178009db3097f525c6ff531d2f08322a8b0d07da221e6c51017006696d8b86b1` |

DB 的 `db-final.log` 与 `catalog-final.log` 保留完整原输出。Core 初轮实际失败包括
未读字段/大 tuple、`url` 未导入及旧 Refusal 显示/类型接线，均修正实现而非压掉
warning；原错误留在 `sdk-integrated-restored.log` 等文件。Mobile 初轮原镜像
权限失败和第一次变异错误 cwd 的日志保留，最终执行的是非 root 私有缓存与
apps 根下 apply；不以工具失败冒充断言抓错。

当前仍无新 Web 部署或 Codex/Relay/OpenMeter 全链真实业务验收。模型 Route
的原生 Hybrid ConfigResource 能力已亲核固定
`1f7ebbf87cbdbe9517f6f181221879d04dc50692` 的
`crates/agentgateway/src/ui.rs::upsert_config_resources` 与
`crates/agentgateway/src/config_store.rs::ConfigResourceStore::upsert_prepared`；
阻断不是上游不支持，而是设计 03 §7、05 §2.8、17 的 `TENANT_ONLY` 模型管理
尚未冻结 Action/审批/配置输入归属，不能借应用 `resource.create` 改义。
工具治理、回复策略投递、Memory 写入、Automation 管理与完整计费仍未交付。
这些缺口不把本批检查通过改写成一期或 18 项目标全部通过，也不阻塞其他已定
功能独立开发；原 runtime artifact 由另一队友唯一构建，不重复启动。

### 2026-10-02 阶段全量收口

选定树 `9c18676a5b49e95a9647a06b77bee2e0eb8e3bf2` 实际运行原
`tools/check.sh --full`，退出码 0，输出末行 `全部通过。`。
原件 `full-restored.log` 的 SHA-256 为
`95daa606a86434c66f569989d11c7ab4c3bddff6bfbf0ea2460057331c5935d9`。
117 个 schema、四侧生成/序列化与兼容、既有检查、Temporal replay、18 条追溯、
18 个供应链产物、6 份上游来源/4 个当前源产物、28 个服务静态边界实际通过。

初轮 `full.log` 退出 1，原件摘要
`31f6159afd3da71481d4350d1672c9c1ec6a3d494cd640329e955c5307b2296b`：
AutomationRun 不是冻结实体、DD-99 不归 S5、13 份既有 Web 追溯还指旧产物。
实体/DD 与产物登记按原权威改正，没有修改领域代码或重复 Web 构建。
初轮真实失败不抹除；第二轮与最后文档快路径单列。

full 内实际数据库演练因未提供 DATABASE_URL 明确 SKIP；前述私有空库 49 条迁移
与实际 SQL 边界证据另列，不能称为业务运行演练。实际 `.env` 预检也 SKIP，
内置 secret 扫描未安装 gitleaks；Win11 当前包与 Mobile 签名缺口仍是 NOTE。
最后新增的这段证据与根入口说明仅经原 `check-docs.sh` 文档快路径复核，
不外推成全工作树、下一批 Automation 五动作、部署或一期生产验收。

## 2026-10-02 23:47 UTC Runtime 五项受控投递与启动拒绝证据

本节记录实现后的私有验证与正式源码窄同步，不重定义 RuntimeProfile。
输入是 clean commit `c242384a644dbd21b8b8a98fa0c09a8b2038f8b4` 加本刀四路径，
私有证据于 23:41:58 UTC 冻结，正式同步仅应用核对后的差异；模板与 start-core
已匹配最终字节，两个 Rust 文件按窄 hunk 合入，没有整文件覆盖继承变化。
原件目录为 `/volumes/data/kailo/tmp/codex-runtime-delivery-check-20261002.mnQHbI/`。

### Runtime 四步结论

1. 权威：沿用 DD-47、DD-66、DD-67、设计 12/17 与现有
   `contracts/domain/runtime_profile_directory.schema.json`。五项配置只来自原
   `.env` 投递与 Config 消费，不生成默认 profile、模型 route、Secret 或注册表。
   四侧 generated 正文及目录 schema 与 c242 的 SHA 全部一致，未手写生成合同。
2. 影响：`.env.example` 声明五项可选整组配置；唯一 `start-core.sh` 用同一个
   Compose consumer 合入临时配置。`Supervisor::from_env` 与 Version 发布复用
   `agent_version::runtime_profile_directory`，保留既有 ACTIVE/ENABLED、能力和 pin
   核验。共享生成类型回写 JSON 必须与输入相等，拒绝三层合同静默丢弃的额外键，
   不维护另一张字段表或第二份目录权威。
3. 副作用：配置全缺省时不注入空值；完整投递只挂载已存在的受控 state root 与
   profiles 文件，后者只读，`create_host_path=false`。临时配置仍由原启动函数消费
   并清理，不创建目录正文、ACTIVE profile 或业务对象。原 OpenBao 一次性 wrapping
   链保持。私有验证只复用已有 50 迁移库/网络做 SQLx 核对，本刀无迁移、无新 PG
   或业务行写入，未启动正式 Core 或 Agent。
4. 异常与边界：全缺省关闭，partial、空值、非法路径/数值、畸形 JSON、缺必填字段
   和三层额外键拒绝。空目录解析成功仅说明配置可解析，不说明存在 ACTIVE profile；
   未验证真实 Runtime 初始化、Installation ready、模型/工具执行或生产部署。
   未把这些配置证据外推为 Agent 全链、三端或 Stage 退出验收。

### Runtime 实际命令、破坏与还原

最终私有 SDK 使用不可变镜像
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
UID:GID 为 1000:1000，实际 cpu.max 为 400000/100000，memory.max 为
8589934592、memory.swap.max 为 0，Data 缓存；执行前核对原安全预检和实际限额。
DATABASE_URL 只在内存/标准输入投递，不回显值。原 SDK2676 的 Config.Env 没有
CARGO_BUILD_JOBS，最终原样保留缺省；早期 baseline 的16来自此前人工执行配置，
并非该原容器元数据，没有把它改成产品必填项或降低并行度。

23:38:04 至 23:40:56 UTC 的 `final-narrow-sdk.log` 实际 exec 退出 0：
`bash -n deploy/local/start-core.sh`、原 `bootstrap.sh --validate-config`、
`cargo fmt --all --check`、原 `cargo sqlx prepare --check --workspace`、
全目标 clippy `-D warnings` 及既有 Runtime 模块五项检查均为 0。
from_env 检查实际覆盖 20 个情形，在独立子进程调用原生产函数，未 spawn Codex。
日志 SHA-256 为
`82b424b12ddddb218c66d21c49ea34a41405b9ef92c15c8c631aacdd1385c2c2`。

实现后逐次破坏原生产 guard：全缺省返回、partial 整组判定、目录解析调用、
额外键等值判定，四次均编译后实际 Cargo 101；分别在 all-absent、缺 binary、
relative-profile-path、extra-directory-field 断言处失败。每次立即按四文件 SHA
精确还原并复测退出 0，原件为 `mutation-01.log` 至 `mutation-04.log` 及各自
`*-restored.log`、`*-restored.sha256.log`，不以 wrapper 的预期退出码代替 Cargo 结果。

早期新建网络被 daemon 地址池耗尽拒绝的1、错误要求缺省 Cargo jobs 导致启动1、
初轮 fmt1 均保留于原件；后续直接复用原库/网络、保留缺省并由原 formatter 修正。
它们不算业务反例或产品阻断。三个自有验证容器已清理，原 SDK/PG/网络未动；
proof 的 idle 容器被 stop 后退出137，与检查 exec0 分开记录，实际 OOM 为0。

相对 c242 的唯一四路径补丁为 `source-vs-c242.diff`，SHA-256
`f150f6497b9e26d11af13c15091c8989b12734103a7a23a459af3f976e5fb060`；
四文件字节见 `source-final.sha256`，原日志摘要见 `evidence.sha256`，
generated 未变证明见 `generated-unchanged.log`。正式四文件与私有最终 SHA 完全一致，
窄 diffcheck 退出0。本次没有 full、release、提交或部署；新增本节尚未另行运行文档
门禁，不借旧全量回执声称当前整批通过。

## 2026-10-03 Runtime 与 Core 打包集中验证事实

本次私有源以 `c242384a` 为底，选入 11 个代码/元数据路径与本记录的一段已有
Runtime 证据，固定树为 `e998d4212c936e1cbf42477fe7bf24859c3776cf`。
00:19:22 至 00:23:48 UTC 运行原 `bash tools/check.sh --full` 一次，attach 与
容器终态均为 0，OOM 为 false。原日志位于
`/volumes/data/kailo/tmp/codex-runtime-win-packaging-full-20261003.EQx6D6/full.log`，
SHA-256 为 `ee5552cf46bbc9d244985eff1237704331ba6d4100a7fddd8495ed7b47adedd2`。
终态 12/12 输入、4/4 生成物一致，全部 tracked 输入未变，diffcheck 为 0；
本节在 full 后追加，仅由原 docs 快路径验证，不外推为该原树已经含有本节。

### 本次四步影响结论

- 权威：DD-47、DD-66/67 与既有 RuntimeProfileDirectory、ActionSubmission 合同；
  不改设计、generated 正文、权限或状态。五项配置沿现有 Config/原启动入口投递。
- 影响：Core 已有编译期 `include_str!` 消费 `contracts/api/action_submission.schema.json`，
  早期原 release 的 Cargo 101 是归档与镜像上下文未包含该真实输入，不是合同或
  业务逻辑错误。现有 `.dockerignore` 放行、`core/Dockerfile` COPY 与
  `tools/release.sh` git archive 三处已同步同一文件；没有删 CI/编译检查迎合产物。
- 副作用：本次只有原 SDK 验证和独立验证库的原末条迁移往返，没有 release、
  部署、业务对象、凭据签发或默认 profile。源与既有 Win11 元数据分别取其窄窗口，
  未带入正式树的其他继承变化；没有重复原生 Runtime、Web 或 Win11 构建。
- 边界：全缺省关闭、partial、畸形目录及未知键拒绝；先前四次生产 guard 破坏
  的真实失败与 SHA 还原记录保留。没有从 parser/类型检查推导 ACTIVE、模型
  正向调用、工具、Memory 写入、结算或 Agent 业务链已经验收。

### 实际环境、通过项与未覆盖项

不可变 SDK 为 `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
UID:GID 1000:1000；create 后 start 前原限额核验为 4 CPU、8 GiB memory=swap，
实际 cpu.max=400000/100000、memory.max=8589934592、memory.swap.max=0。
使用原 Data 缓存与原验证 PG/网络；原 SDK2676 未设 CARGO_BUILD_JOBS，本次仍缺省。
DATABASE_URL 仅在内存/标准输入投递，无全局 Git 定位变量或宿主 SDK。

格式、clippy、Go/TS/Dart 静态检查与原四侧验证、128 schema 兼容、Workflow replay、
文档/18 条追溯、供应链与原 seam 检查全部通过。原 PG 原样恢复后仍为 50 条成功迁移，
前进、回退末条、再前进与 SQLx、44 项枚举约束真实通过；没有新建库、网桥或业务夹具。
原容器此前停机是外部 daemon 事件，不归因本次 SDK。自有 SDK 已终态 0 后清理，
原 PG、原配置 SDK、Data 源与日志保留。

实际部署 `deploy/local/.env` 未投递，原预检 SKIP；Catalog bootstrap、approval CAN、
Relay outage 三项 ignored，未安装 gitleaks，仅内置扫描。Win11 unsigned 测试包未实机
安装或业务验收，Mobile release 签名仍阻断。本次不改变生产门禁、Stage 退出状态，
也不把外部集成检查的早返计作真实业务闭环。

## 2026-10-03 已部署 Web 的真实定义创建与回读

本次业务走查使用已部署的 Core/Worker 源码提交
`67b48b7c027317efb59533ee9dcb5bc9b4a1a892` 与 Web `6f54ce3744408aa3adfa898ec639b9fad1ef4438774a0869f21b33e722d298ce`，
不把后续 Memory、Gateway 或正常 turn 工作树增量计为已部署。
01:51:49–01:51:50 UTC 现有首位管理员经原 OIDC 登录，在共用 Agents 页面填写
定义、查看原确认面板并提交一次 `agent.definition.create`；没有直接写业务数据库、
创建运行 profile、安装或触发模型，也没有用零条目列表替代创建验收。

原 UI 业务脚本在固定浏览器镜像
`sha256:6446946a1d9fd62d9ae501312a2d76a43ee688542b21622056a372959b65d63d`
内实际退出 0；口令仅由受控只读文件提供，原件不保存口令或 cookie。
实际入口为 `http://192.168.0.193:58090`，不是 HTTPS 验收。

| 真实消费 | 实际结果 |
|---|---|
| 原 `POST /api/v1/actions` | HTTP 200；AE `797b83d1-0361-4564-bf3b-3142b4824065`，operation `39ba2a10-92b7-49b0-ac86-ddb2ab7c0169`，ALLOWED/DISPATCHED |
| 同页面定义回读 | Resource `88325239-707e-471c-89c7-f7675e341928`，ACTIVE、version 2；名称与 stableSlug 和原提交一致，owner 为实际 HUMAN |
| 原 Task 回读 | HTTP 200；同 AE、operation、action 与 Resource，不捏造 Workflow 或 observation 终态 |
| 原生审计只读核对 | 同 operation/target 的 INTENT(EVALUATING)、DECISION(ALLOWED)、DISPATCH(DISPATCHED) 三行；原 `psql` SELECT 实际退出 0 |
| 浏览器实际呈现 | 原左侧导航与新定义行实际渲染；pageErrors 为 0，原件含实际截图 |

原始业务输入与观察在
`/volumes/data/kailo/tmp/codex-live-agent-definition-20261003.qsiGq3/`：
`intent.json` SHA-256 `9b0a3d1e6583df1795039943a45508d723a691cea46de50babc80455be0d4479`，
`observation.json` SHA-256 `0312716a3c873502a2bcb28e3e22de0c60d4692f0ce896b8b2bd5ee302affbc6`；
`native-audit.log` SHA-256 `45f8b8ba05bf7b341cd865273fc0c59a8821a8612e5c44a84460c9d9ae9e7795`。
审计 SELECT 可按上述 operation_id 重查，不把数据库核对称为 Audit UI/API 验收。

该真实定义是保留的合法开发业务对象；本次只证明定义创建、呈现、回读及同链审计，
不证明 AgentVersion/Installation、Memory、Codex turn、OpenMeter、严格预留、
工具审批、Win11 或 Mobile 设备业务闭环，也不解除一期生产发布门禁。

## Memory HUMAN 写入与客户端消费集成（2026-10-03）

本节记录已经实现的调用链，不新建规格、Memory 服务或第二账本。
权威为 DD-66/67/68、设计19 §5/6/8与原统一 Action、Installation Resource scope。
四个 owner 写键 core.replace、entry.set、entry.patch、entry.remove 只经原
`/api/v1/actions`，目录为 SYNC/NONE/CHECK；Mobile 不写，AGENT 写工具不生成。

实际 writer 为 `agent_memory_write.rs`，复用原准入、fresh authorization、
OpenMeter CHECK、ActionExecution/Operation/Audit 与 UsageEvent。
签名加密、head 判定和严格补丁复用 Buzz commit
`779af8886caae1317b4de962082429867ab61503` 的
`crates/buzz-core/src/engram.rs::{build_event,conversation_key,validate_and_decrypt_with_size}`；
`crates/buzz-cli/src/commands/mem.rs::cmd_patch` 的严格原位置 verifier/hash
已归入同一 buzz-core，CLI 旧副本删除，Core 由 collab-bridge 消费。

影响与副作用：Core 只持 scope、固定 event/head、摘要、字节数和外部证据引用；
value、slug、patch、密文与密钥不持久化。唯一写前意图冻结原 event，
后续同 key 或后台只观察原 ID；发布后原生 head 不匹配即 CONFLICT，不自动重发。
两条原生 count/plaintext_bytes 用量均 observed stored 才 DISPATCHED，
202、未知 ACK/head、计量未 stored 均 UNKNOWN，沿原治理批次/时限与 RB-05 收敛。
owner、CHECK 与旧 head/base 拒绝现沿同一 AE/Audit 留证；未知依赖保持
EVALUATING/NOT_DISPATCHED，仅没有 native intent 的准入可按原超时 EXPIRED，
已签名 intent 不以该超时误判为失败。同一已拒 key 保留冻结 reason/class。
撤权、暂停、并发重入、未知枚举和缺 projection/secret 均拒绝新副作用，
不把 UNKNOWN 展示为成功或失败；没有旧在线 writer 兼容窗口。

独立 writer 回执在 `codex-human-memory-write-20261003.FfQQps/`：
原四侧 gen/--check、53 条空库迁移回退再前进、SQLx、44 命名约束均 0；
主动删除被检查约束实际 SQLSTATE23514，事务还原后 0；
原 CLI 严格补丁 5/5、生产 guard 破坏 101、按 SHA 还原后 5/5。
审计修正的原 all-targets clippy 为 0；最后准入过期选批与 EXPIRED 同 key 返回
在该日志之后修改，只由本批集中验证覆盖，旧 clippy 不证明新事务业务通过。

当前 writer SHA 为 `93b8706256d4c2d5fd842827e74c2642b804532045477707708a21a57c6f20ba`，
reconcile 为 `7b310801109766c12eb5083d95652255d3f15b95547023f2fd7ea81d03f76d73`。
TS 与 Mobile 原页面各 63/63、Web/Desktop 类型检查及 Dart analyze 实际 0，
日志与 22 路径输入摘要见 `codex-memory-ui-selected-verify-20261003.pxMZ6I/`。
只生成了同源 13 条缺失 Dart 文案，不用旧主题或其他未运行检查填充通过。

真实 HUMAN Installation/owner 四写、Relay ACK/head冲突、OpenBao exact AGENT secret、
OpenMeter 两事件 stored 的整体链未验收；没有造业务 seed、重置数据库、
安装 Win11 包或部署本 writer。正常 turn 与取消的原 native 用量证据另见
[持久用量记录](../../model-gateway/fork/verify/durable-usage.md)。

### 当前功能树集中验证与产物收口

固定候选 commit `98df24a41284d92c692c2742770ab45945c05b28`、tree
`e5234981243519b30e24eea0818a5ee196e4bc2a` 的原 `tools/check.sh --full`
实际退出 1。原日志为
`/volumes/data/kailo/tmp/codex-memory-delivery-20261003.BES8UA/full.log`，
SHA-256 `c12f7e32b62aa4771d5717b71d4111d3a7b50abdf6bd48dcdb99355310cba016`。
原容器内 fmt/clippy、Go/TS/Dart 静态检查、四侧生成与兼容、既有验证、replay、
文档和安全边界检查均通过。三项外部演练 ignored；数据库与实际部署配置预检
明确 SKIP，不以早返的集成检查声称真实业务 E2E。

失败输出是两处 trace 的 Gateway artifact digest 不符，以及 Relay、Win11
artifact 的 source_digest 不符。前者仍引用旧 `63a5123…`，现仅将这两处引用
对齐已正式构建并部署的 `471fa4e9…`，不重建 Gateway。后者由共享 Buzz 与
客户端的本批源码变化导致，按原构建入口生成真实产物后才能解除；不手改摘要、
不删构建输入、不将旧安装包称为当前源码产物。

来源修正的四步结论：权威为工程基线 §2 与 ADR-06/15/16 的实际来源合同，
不改变产品设计；影响限于两条 trace 的既有 Gateway 引用与本批证据，runtime
已使用同一真实 digest，没有 schema/Workflow/数据库兼容变化；无新外部副作用、
默认值或第二权威，不改变 fail-closed；缺真实产物继续明确失败，设备与签名、
UNKNOWN 业务终态、真实 Agent/Memory/计量闭环仍未验收。

### 同源 Relay 与 Win11 原产物已生成

上述 full1 原件保留不改。随后从已实施私有 commit
`55a248e0872055fbb03bcafd083710028c4efef8` 的同一冻结源码分别调用原 Relay 与
Win11 helper，两者完整退出 0；没有重建源码摘要未变的 Web97、Runtime、Core 或 Worker。
Relay 的 1118 个输入 source 为 `e68add606d98c362e49f9a9fbf33cc4deb24936d065e1ac4f5ef456e79ec30fe`，
artifact 为 `d42f83fa0dadcd78c4ad721047433a9a7c8e522767edd96cb326d641c5dd0056`；
Win11 的 2255 个输入 source 为 `af6418a4394f1ddff402ef968eaaa45c4319fbc7e843c87cef42dc026c4602ee`，
artifact 为 `5378f3703e0208a6f727357f72b59e7e81836889adf0ff54990f8c718badecce`。
两份原源码回执前后逐字相等，Relay 原 registry manifest 独立读回 HTTP200、SHA 相等；
NSIS 包为 15,076,978 字节且未签名。完整原件与 SHA 清单在
`codex-memory-relay-win-artifacts-20261003.SosEFm/`。

四步结论：依据仍是工程基线 §2 与 ADR-06/15/16 的实际来源合同；
影响只限来源四摘要、现有 Relay trace/pin 与证据，不改变业务/schema/Workflow 权威；
外部副作用仅原 registry 上传和 Data 测试包产出，不替换服务、不修改数据库；
原 full1、UNKNOWN 对账、三项 ignored、数据库/实际配置 SKIP 与设备/签名阻断均保留。
修正指针的固定树 `433be885faead1e95072e10ca447d36b660a1fa7` 随后仅运行一次原
`tools/check.sh --full`，完整退出 0。原日志
`/volumes/data/kailo/tmp/codex-memory-artifact-close-20261003.iEBtsF/full.log` 的 SHA-256 为
`b6557aced681ee364ede8f722761a1e7a4c76835267f09d29962b95efa738210`。
128 schema、四侧、Core/replay、18 条追溯、18 份供应链产物证明及 6 份来源均通过。
输入树与全部 Git blob 列表前后逐字相等；blob 列表 SHA-256 为
`2d53fec44f0a05c9b8243013ce6df375be3cf509e2f86d6bc481a983ce3c87f2`。
原 SDK 为 `10ad51…`、UID 1000:1000、实际 4CPU/8GiB/swap0；没有新建 SDK 或重跑构建。
未提供 DATABASE_URL 和部署 .env，实际数据库/配置演练仍 SKIP；Catalog 新库、
Approval 续跑、Relay 故障撤权三项外部演练 ignored，不把早返检查计为业务验收。
公开提交、Core/Worker 本批 release、部署及真实 HUMAN Memory/计量/Agent E2E 仍未发生。

### 2026-10-03 首轮触发的目录生产缺口

源码核对发现 `automation::definition` 已强制加载 `automation.run`，但原迁移
仅登记五个管理动作，没有运行定义的生产方。本批在原 Core 启动路径调用
`automation::register_run`，由受控配置 `AUTOMATION_RUN_METERS_JSON` 显式投递
meter key，Capacity pool 复用原 `AGENT_CAPACITY_POOL_KEY`。不提供默认模型
meter，不创建 Customer、原生 meter、feature、entitlement、业务对象或授予权限。

四步影响结论：

- 权威为 `.design/05` §2.9、DD-107 与 `03` ActionDefinition：固定 RESOURCE、
  TARGET_HOME_WORKSPACE、execute、AgentTaskWorkflow、PLATFORM_SLOT、CHECK，
  meter 必须包含 `automation.run` 和模型 meter；仍无 BFF 手动运行入口。
- writer 是原 Core 的部署初始化，reader 仍为原 automation 管理启用、触发准入、
  Delegation 与执行核验链。同一目录不另建注册表；无共享契约、表字段或 Workflow
  输入格式变化。已有定义不覆盖、不复活，配置不一致拒绝启动，不改冻结版本。
- 配置数组先校验完整、非空、唯一并排序；缺省不登记且原 consumer 拒绝执行。
  注册不代表原生 meter 可用；每次准入与派发仍检查真实 Customer、meter、额度、
  fresh 权限与 Delegation。使用 OpenMeter committed usage 作为计量权威，
  不将 Gateway 请求日志当账单，不增加前端身份或秘密。
- 并发初始化由原主键与单 ACTIVE 唯一索引收敛；相同配置幂等，冲突保留原定义并
  拒绝新实例启动。未知策略/配置缺失按 CAPABILITY_BLOCKED 关闭，数据库不可用
  不被记为业务失败或成功。运行期 UNKNOWN、撤权、重复触发和额度耗尽仍由原
  统一准入与 AgentTask 路径处理。零 Tool 回合不依赖 MCP 凭据；此变更不放宽三端
  BFF/Relay 边界，也不开放 Mobile 组件宿主。

这是已写入的首轮生产接线，不是线上可用声明。本批 SDK、动态 SQL、真实触发与
用量闭环的结果分别追加实际回执，历史 full 结果不能替代本批验收。

同批 Customer 缺口：原 `tenant_bootstrap::run` 遇到已有效的相同 HUMAN admin
便直接返回，而原生 Customer 只有 PROVISIONING 生命周期生产方。现在原部署
CLI 的该分支先执行 `ensure_metering_customer`，沿原 `tenant.bootstrap`
AE/Operation 调用唯一 `tenant_lifecycle::reconcile_customer`，不重启已终态
Workflow、不更改 Tenant/成员/admin 状态。依据 `03` §8、`11`、DD-38/82；
没有 schema、外部 API 或 Workflow 输入增量。冻结 Tenant/namespace/admin/
external identity 与参数 hash，AE→Tenant 锁序重验 ACTIVE HUMAN 和 fresh
Tenant manage；副作用前提交意图，同一原生 key 查不明只对账，不重复 POST。
Customer 原生 ID/key/ACTIVE 读回和 binding 同事务成立才记确定派发；binding
存在而原生对象消失时不重建。Core 仅保留关联与审计，不保存额度或用量正文。

冻结基线 `f535e7d07843119b01ee30a1625fb459c44edd82` 的两 Customer 源、
automation 源和 main 单行接线共 4 路径、+457/-37；canonical diff SHA-256
`3fbd730935a2c0c23b2f2e9c09e12c895cd33685bdba8b9feff91c63c280a84c`。
固定 SDK `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`
中最终 rustfmt --check、原 all-target Clippy 和三组定向检查退出 0，
9 passed、1 ignored。先前私有快照漏带 main 接线导致 dead_code 的失败日志保留；
仅选入实际调用后通过，不抑制 lint。检查中 bootstrap/NIP-11/roster 原单元不
覆盖新 Customer HTTP 或权限并发，不把这些数量算作 Customer 业务通过。

新增实际 SQL 机械提取为 8 条，在既有隔离 PostgreSQL 中全部 PREPARE/EXPLAIN
通过后 ROLLBACK；无业务对象写入，不等同运行新事务分支。实际删除
`parse_run_meters` 的必含 `automation.run` 保护，原检查报错并退出 101，
精确还原后退出 0。最终 automation 源摘要
`d46e3529b5a294599913d52c9fc8f630720eb1094b4715980ae40eb50df1a25d`。
原件目录 `/volumes/data/kailo/tmp/codex-active-customer-sdk-20261003.G9a2eG/`，
日志为 `restored-final.log`、`parser-mutation.log`、`sql-prepare-explain.log`。
CPU 4、memory 8 GiB、实际 swap 0、Cargo 16；最终 OOM/max 事件为 0。
尚未运行本批 full、正式构建部署、真实 Customer 对账与 Agent 首轮计量闭环。

### 2026-10-03 运行配置发布与真实 BFF 回读

本节只记录本次运行配置发布，不以历史空目录结论覆盖新状态，也不把配置
可选等同于 Installation 或 Invocation 就绪。依据 `03` §7、`17` §5–6、
DD-26/69/70/71：RuntimeProfile 是平台发布的能力合同，Installation 则在
创建后生成专属凭据，经 Codex initialize 和投影核验才允许 ACTIVE。
要求前者发布前先有后者的运行成功证据会形成循环前提。

- 影响面：仅将原 operator 的 thread-only SERVER_CODEX 候选由 DISABLED
  发布为 ACTIVE，沿既有 `AGENT_RUNTIME_PROFILES_FILE` 投递。零能力需求、
  threadReplies=true、broadcastReplies=false 和显式 1/300/600 上界均沿用
  原候选；没有生成业务 Resource、权限、Delegation 或默认租户。
- 目录 writer 是受控部署，reader 为版本配置/发布和 Installation 原消费者；
  不改变 schema、API 或数据库，不增加三端身份路径。新 Profile 不替代
  每次安装和外部副作用前的 fresh authorization，不使未知结果变成成功。
- 原候选 SHA-256 为
  `ef77f1a240a404b6e801a81922ae1e5a12299aab75b7c37e03be23eaa10b7ea3`；
  实际投递及 Core 内只读挂载读回 SHA-256 均为
  `5149bbbacbb29f3ac7b3540b4928970c0d49ba542cf0184947d5ff87af242709`。
  单文件 bind 在宿主替换后需重新挂载；原 `start-core.sh --no-build` 以
  fresh wrapping 重建 Core，实际退出 0，未构建镜像或替换 Worker。
- Core 镜像保持
  `sha256:0b4299137ebe516a99f8e05763cd106ed952ae8a08ef40817ae1c1a829a0339d`，
  新容器 `20c963ca2e4e`，healthz 实际 200。真实 HUMAN/FULL 会话下
  AgentDefinition `88325239-707e-471c-89c7-f7675e341928` 的版本配置 BFF
  实际 200、canCreate=true、resourceVersion=2：唯一 Profile 为
  `server-codex-thread-only-uat`，唯一模型 Route 为
  `eb0d3d98-b49f-4002-b9b4-f00023ea35ab`，native revision=1。

原件目录 `/volumes/data/kailo/tmp/codex-runtime-profile-publish-20261003.VtmqFm/`：
`start-core.exit`、`profile-mount-readback.log`、`core-health.log`、
`bff-configuration-readback-restored.log` 与 `bff-readback-restored.exit`。
首次浏览器启动因依赖默认浏览器版本与镜像不同失败，未发业务请求；复用镜像
已安装 Chrome 后回读退出 0，没有安装或构建浏览器。这里尚无真实 Installation
ACTIVE、普通 mention、模型首轮、回复或计量终态证据；full 历史失败仍保留。

随后 17:59 UTC 创建前配置 GET 返回 503，18:02 UTC 同一只读复查仍返回
`UNKNOWN/DEPENDENCY_UNAVAILABLE`；Core 原错误为“模型原生投影或凭据查证未闭合”。
Definition 与空版本列表 GET 为 200，但三个创建/发布/安装 POST 均未发送。
因此首次配置 200 不是入口稳定或安装成功证据；尚未证实具体依赖失败根因，
不以扩大超时、绕过原生查证或改数据库状态处置。
同目录 `version-installation-actions.log`、`bff-configuration-once-recheck.log`
保留两次失败，`handoff.md` SHA-256 为
`e7e8bf550aae34138cfae10ecf34af40a5dae37b66e2386e1e7b8c6f8d5c740a`。

### 2026-10-03 共享管理页发布后安装候选刷新

本批依据设计 `17` §2/3/6/8：发布版本后按 BFF 当前权限和精确版本重新读取
安装候选，发布不改变已有 Installation 的 pin。原缺陷是 Version 已递增
`versionRevision`，安装候选读取却只按 Workspace/offset 缓存；管理区刷新也只读
Workspace。首次空候选及退休后旧候选因此会滞留，直到用户切换或重载页面。

- 影响面：Web/Desktop 共用的 `AgentDefinitionsPage` 将已有版本 revision 传给
  安装管理，并与原安装 revision 共同进入候选读取键；原刷新按钮递增原 revision。
  没有新增发布状态、组件 remount、API/schema/迁移或 Mobile 写入口。
- 权威和副作用：候选、canCreate、精确 pin 仍来自原 BFF；已记录的版本动作仅触发
  回读，不把 DISPATCHED 解释成安装成功，也不添加默认 Profile/模型/权限。
- 异常：组件保持挂载，UNKNOWN 安装的原命令和幂等键不变；其他版本动作触发
  候选回读时仍保留未知呈现。空页、读失败、分页与服务端六类错误沿用原处理。
  不增加业务状态、后台重放、副作用或第二份权威。

选定基准 `2b58aa82d55fd7e17ccadf78ba33596bbc92f372`，两源路径 +57/-10；
生产 `agents.tsx` 仅 +7/-7。原 SDK 内执行共享包 typecheck 和既有 pages 的
`AgentDefinitionsPage governed Version Installation Grant` 组：39 passed、
116 skipped、退出 0。实际去掉私有生产代码的候选 revision 键后，发布候选与
UNKNOWN 场景的回读次数两项断言失败，退出 1；按原字节恢复、cmp 0 后同目标
39 passed、116 skipped、退出 0。最初私有依赖缺项导致的退出 2 原件保留，
之后只按原 frozen lock 离线补齐私有依赖，未改锁或包版本。

原件目录 `/volumes/data/kailo/tmp/codex-agent-management-refresh-20261003.fy7VXI/`，
含 `baseline-dependencies/`、`mutation/`、`restored/`；最终恢复日志 SHA-256
`0ff0f21892ba520352ff3ef75a95e26e6ff8aedfd6dcfc4feb1a2a2d78ebb3e6`。
实际生产变异只发生于私有导出，正式两源未被破坏。上述是源码与协议夹具证据，
不是在线 BFF、Codex 或 Installation E2E；未运行本批 full、客户端构建或部署，
不覆盖历史完整检查失败、设备或生产验收缺口。

### 2026-10-03 19:23 UTC 首个版本发布与安装真实准入

Gateway 修复产物 `b9e3bf8d…` 部署后，原 HUMAN/FULL 会话重新读取 Definition、
空版本历史及版本配置均为 200。首轮操作脚本使用了非 UUID 幂等键，原准入
在解析键时返回 422/PRECONDITION/INVALID_PARAMETERS，未进入 ActionExecution
创建；没有放宽校验。纠正为原契约 UUID 后重新读取历史仍为空，再发出新意图。

原 Definition `88325239-707e-471c-89c7-f7675e341928` 的版本
`cc099e7c-74d6-48a8-86c2-63bb878551ea` 实际从 DRAFT/version 2，经显式发布
读回 PUBLISHED/version 3，ordinal 1，configHash
`71015605ae785d3bbb148e45e661b9b2f1584a13ff5e35805e5904037ff3ac44`。
内容使用已投递 thread-only Profile、受权 Route、零 Tool/Skill、HUMAN_ONLY/
DISABLED Memory 策略及既定 1/300/600；不另立运行配置或权限。
创建 ActionExecution 为上述版本 ID，Operation
`e2761c44-d1fb-412b-96e9-e434094a4e1b`；发布 ActionExecution
`51d70376-46a5-4127-b280-f25c1a587c90`，Operation
`e324190a-edab-4adf-b24b-0ed4e642af0f`。

候选目录实际 canCreate=true，返回该确切 PUBLISHED Asset。原安装动作准入后
创建 Installation `8f240978-34bb-437d-97ee-498a30e67e86`、Agent Principal
`45f6fe8b-113f-4d2d-8ee3-f95b635732ac`；ActionExecution
`991c2ceb-e3f7-4413-883b-db97fe01e8e3`，Operation
`3d9839ca-85bd-4baf-8cbf-9336ff43c535`，Workflow
`platform:AGENT_INSTALLATION:6179e160-6055-4e9a-ae63-1793509c230c:8f240978-34bb-437d-97ee-498a30e67e86:1`。
三个实际 UUID 幂等键分别为 `1c8ae196-3fe3-4dbe-bb87-5018e8ff7d19`、
`d3cbaa10-b368-404e-816f-d361b09fd16d`、`7d888641-531c-481d-94eb-fdd44b6b052b`。

随后安装详情读回 PROVISIONING、projection PENDING/generation 1，频道 binding
DISABLED；任务 RUNNING/UNKNOWN_EXTERNAL_RESULT。Core 原生初始化记录
DependencyUnavailable，没有 Codex 子进程。只保留原 Workflow 对账，不重新
创建、改 SQL 状态或把 DISPATCHED 当安装完成。普通 mention、模型首轮、回复与
用量终态仍无验收证据；本批未新增 schema、迁移或安全策略。

原件 `/volumes/data/kailo/tmp/codex-gateway-reactor-delivery-20261003.DtznEx/`：
`version-installation-live.log`（422）SHA-256
`1f8a2345fb86eb8b2262c07367481a6bd3005f346390943370fbf823eee2cfd5`；
`version-installation-uuid-live.log`（脚本退出 0）SHA-256
`480bc275d8dbe9eba81c6f367a11d271fac33860227a63fbc2c971bee4086d84`；
`installation-readback.log`（只读脚本退出 0）SHA-256
`5793b8128c77425ac49be89ee5b8bf44f89ac4efce94a10e4df09da64ba8c38c`。

### 2026-10-03 安装 WorkflowRef scope 漏写修复

上述同一安装的只读核查确认：WorkflowRef 的 AE、Operation、Tenant、type/kind、
固定 Workflow ID 与原执行一致，但 workspace_id 为 NULL；同 AE 与 Installation
均有准确 Workspace。原 `model_route::installation_scope` 因此正确拒绝，发生于
模型凭据意图和 Codex spawn 之前。原 Version/projection hash 重算一致；OpenMeter
原生 Customer 缺省 usageAttribution 已被既有代码正确接受，不作无依据修改。

四步变更结论：

- 权威：设计 `03/06` 的冻结执行身份和派生 WorkflowRef、`17` 的 Installation
  链决定行为；AE 是正本，不在 Runtime 另建 scope 或默认 Workspace。
- 影响：原 `start_typed`、`prewrite` 两 writer 继承同 AE 的 workspace；治理、
  server_keys、task_rerun、Automation 共用调用保留。两条 INSERT 的 SQLx 元数据
  经真实数据库重新生成并替换旧文件，无 API/schema/Workflow 输入或上游改动。
  Web/Desktop/Mobile 继续读取原 BFF 状态，不增加入口或客户端权限判断。
- 副作用：原模型 scope guard 不变。既有有界对账循环仅按同 AE、Tenant、Operation、
  固定 Workflow ID、登记 type/kind 与同 Tenant Workspace 证明补齐 NULL；不覆盖
  非 NULL 冲突，不重 Start、不改 run/state/history、不建立新投影权威。
- 边界：纯 Tenant NULL、跨 Tenant 生命周期与不匹配身份不推断；重复修复不增版本。
  仅锁 WorkflowRef，避免 Automation 持 AE 等待池内写入时的反向锁链。scope 冲突
  只 Describe 原 ID 并轮转既有观察尝试时间，不写 TaskProjection；保留错误度量，
  不让最旧错误占满 batch。无新状态，收敛周期与责任沿原对账配置及 runbook；
  授权/租户暂停仍由原消费门禁拒绝，不因 scope 补齐变成成功或恢复权限。
  不新增错误类别；数据冲突和依赖不可查证分别保持冲突/UNKNOWN 语义。

不可变 SDK `10ad51a2…`、4 CPU/8 GiB、Cargo 并行 16；独立 PostgreSQL 完成
57 条迁移，SQLx prepare 退出 0，离线 Clippy `-D warnings` 退出 0。
实现后的原数据库目标实际 1 passed/78 filtered，覆盖两原写者、幂等补齐、冲突、
错误身份和持 AE 锁并发；分别破坏 prewrite scope、Start scope、operation guard、
AE 锁四处均退出 101，逐字还原后的同一目标退出 0。两修改模块的 2021 格式与
diff 检查退出 0。首次快照漏 buzz-core，以及宽快照含既有格式差异的失败保留，
选定提交不纳入这些无关脏内容；冲突 Describe 分支只有源码复核，不称动态验收。

证据根 `/volumes/data/kailo/tmp/codex-installation-runtime-rootcause-20261003.e4agxD/`，
完整说明为 `handoff.md`，恢复目标为 `restored-final.log`、静态检查为
`clippy-final.log`，四项破坏分别见 `mutation-prewrite.log`、`mutation-start.log`、
`mutation-operation.log`、`mutation-ae-lock.log`。没有直接修改线上库或重建安装；
修复的源码验证不证明线上原安装已恢复，部署与恢复读回单独记录。

集中检查原件位于
`/volumes/data/kailo/tmp/codex-workflow-scope-delivery-20261003.ry3CqV/`。
首轮 `full.log` 因隔离数据库容器的无外网 namespace 导致 pnpm EAI_AGAIN，
准备阶段退出 2；恢复原 host 检查网络后的 `full-network-corrected.log`
实际退出 1：四语言静态检查与验证、契约、Workflow replay 通过，trace 因本地
`dist/` 未收录上一批 Core/Worker 原 SPDX/provenance 失败。将 `853u9M/apps/dist`
的四份既有证明逐字复制并 `cmp` 通过后，使用同一源码 tree 复跑；没有改摘要、
生成替代证明或关闭检查。该 full 不投递线上数据库凭据，迁移演练与实际部署
配置预检均明确 SKIP；上述独立数据库验证不替代完整在线演练。

最终 `full-proofs-restored.log` 对固定 tree
`2c503b0c202fe183db521b79f323007404cec241` 的原 `tools/check.sh --full`
实际退出 0，末行“全部通过”：18 条追溯、26 个发布产物证明、6 份上游来源通过。
补写本节结果仅走原文档快路径，不再次编译；未将该结果提升为生产或设备验收。

### 同批 Core 实际部署与原安装恢复观察

上述源码与验证已提交并普通 push 为
`eef540705af9de3a2dd338ea7f5e8129f29bdee4`（9 文件、+432/-47），远端 main
读回一致。原 clean-commit release 的 Core artifact 为
`sha256:50ab55f3a02224619ab1927d1c00c5bd6ce0245d9fabb536f6c30006ecec222e`；
SPDX 92 个包、provenance 的 subject、源码 commit、原依赖锁摘要均核对一致。
registry push 退出 0，独立 GET 为 200，manifest 原始字节摘要与发布摘要一致。
Runtime 仍复用 `ad13c952…`，没有重建或修改其权限。

原配置预检与 `start-core.sh --no-build` 均退出 0；新 Core 容器
`1e686f0cc5c79b8d7e3f475095bb6c9fb691a0071f7e2b6a18953eabb54cdeea`
启动于 `2026-10-03T20:24:54.051428524Z`，实际镜像为上述 digest，healthz 200。
部署前后 24 个运行服务比较只有 Core 的 ID、image、启动时间改变，Worker、
Web、Gateway 和其他 20 个运行服务未变。本批无新迁移，不重复迁移或初始化。
初次 inspect 请求不存在的 Health 字段返回模板错误，改为实际 State 字段和
原 healthz 后取得上述证据；不将模板错误当业务启动失败。

20:25:48 的只读采样证明同一 WorkflowRef workspace 已补齐、version 3，原 run
`01a10338-aa45-7574-b043-a76f1e89c13f` 不变；模型 binding 从零条推进至 generation 1
PENDING，secret_version 已存在且 native_dispatch_started=true，原生 key ID/revision
尚无读回。Installation/Resource 仍 PROVISIONING、Runtime projection PENDING，
Task RUNNING/UNKNOWN_EXTERNAL_RESULT，无 Codex 子进程；本次修复越过 scope
阻点，但不因此宣称安装、模型首轮、普通触发、回复或计量闭合。
真实浏览器登录与共享 Agent 管理页读取退出 0，相关 BFF 200、pageerror 0，
安装仍显示 Being installed，未把结果不明渲染为成功。

发布原件为
`/volumes/data/kailo/tmp/codex-workflow-scope-core-worker-release-20261003.BIpjWH/`
的 `release.log`、`core-push.log`、`core-proof-readback.log` 和 `apps/dist/` 两份
Core 原证明；部署原件为上述 `ry3CqV/` 中的 `start-core.log`、`core-health.log`、
`live-before.txt`、`live-after.txt`、`management-after.log`；恢复采样为上述
`e4agxD/recovery-after-deploy-1.log`。仅按真实产物更新 Compose Core pin 与原
14 条 trace 引用，不修改旧工作树的其他配置或将 Worker 新构建等同已部署。

随后原 release 完整退出 0；Worker artifact
`sha256:555a0d33a1b68cadfba17f10cdb27908880982fd68d9d43fde12c69010ca6f61`
也已 push、registry GET 200、SPDX/provenance 核对通过，但不替换未改源码的
线上 Worker。原 release 输入 Git archive 前后 SHA 完全一致、clean HEAD/tree
不变，原 builder OOM 计数为 0；准备阶段全仓文件摘要因 tracked symlink 退出
123 的失败保留，实际来源按原 release archive 输入核验，不修工具绕过。

## 2026-10-03 Runtime 恢复锁序与同一 thread 投影回读

本节为实现后的源码与窄验证记录，尚未进行本批集中 full、产物构建或部署。
仅修改 `agent_runtime.rs` 及 `main.rs` 的唯一停机调用；不改 Session/Invocation
业务模型、权限、迁移、原安装状态或原生 thread/turn 引用。

四步变更结论：

- 权威：设计 `12/17/19` 的 Installation/RuntimeProjection fence、持久 Session
  身份与 UNKNOWN 只观察恢复路径不变。固定 Codex
  `7498521d288b9b3b96ffba4eedf089d8d6e06a84` 的
  `codex-rs/app-server-protocol/src/protocol/v2/thread.rs` 中
  `ThreadStartResponse`、`ThreadResumeResponse` 均具有 model、cwd、
  approvalPolicy、approvalsReviewer；只读上游，未执行或修改引用工程。
- 影响：ensure、call、start_turn、last_activity_at、stop 与健康扫描共用原安装的
  本机 Process 槽。start/resume 在同一 Process 锁内核验既有投影字段；
  `healthy_installations` 调用签名不变，`stop_all` 移除不用的 pool 参数，
  `main.rs` 唯一调用同步调整。retirement 仍先 stop、再取得原 ownership。
- 副作用：全局 map 锁只定位/快照；清理先使原 Process 拒绝新调用，冻结其
  generation/ownership，释放 Process 锁后用原 ownership 连接写 UNKNOWN，
  确认原子进程退出才清空槽。不新取池连接，不让同代替换越过旧写入；
  stop_all 忽略空槽，且只更新实际持有的那一代，不把旧 key 当进程归属。
- 异常：取消保留原 retiring Process，后续扫描可继续；退出不明仍拒绝新调用。
  ownership 连接永久失效时明确记录 UNKNOWN 未写成，确认子进程退出后保持
  原有可清理行为，不永久卡槽。原 DISPATCHING/RUNNING 的持久引用仍沿
  `agent_task::advance` 的 resume/history 分支，不进入仅 CREATED 可走的
  first_turn；投影缺失或漂移返回 Protocol，不回退创建 thread。

复用固定 SDK `10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
Rust/Cargo 1.90.0、Cargo 并行 16、4 CPU/8 GiB/swap0；隔离 PostgreSQL 为
2 CPU/1 GiB/swap0、network none，总预算 6 CPU/9 GiB。每次 Cargo 前检查
实际进程、CPU/内存压力与容器限额，内存 PSI 为 0；使用 Data 私有快照与独立
reflink target，没有重建 SDK、争用公共 target 或向线上数据库写入。

实际命令均由 `rtk` 调用既有受限 SDK，结果如下：

- `cargo test -p platform-core --bin platform-core recovery_releases_slot_before_row_wait_and_resume_checks_loaded_projection -- --ignored --nocapture`
  初始及补齐停机断言后均退出 0；真实 PG 行锁/advisory lock 与受控 stdio
  覆盖池连接耗尽、取消恢复、同代替换、断 ownership 后子进程退出及原引用保留、
  8 种 resume 字段缺失/漂移、合法 resume、空槽和不同代际停机边界。
- 私有源码三次真实生产变异使用同一目标、未改测试预期：恢复旧持锁顺序在
  Process 等待处超时（2.29 秒），跳过 resume 校验接受错误 model（1.15 秒），
  将清槽条件改回 recorded && stopped 后坏连接永久卡槽（1.47 秒）；均退出 101。
  每次用补丁还原，最终源码与格式化原件 `cmp` 一致后才复跑。
- `cargo test -p platform-core --bin platform-core agent_runtime::activity_tests -- --include-ignored --nocapture`
  最终退出 0，7 passed、73 filtered，1.12 秒，包含原迟到消息活动时钟检查。
- `cargo clippy -p platform-core --bin platform-core --tests -- -D warnings`
  退出 0，36.47 秒；选定 Runtime 的 `rustfmt --edition 2021 --check` 与
  正式两源码 `git diff --check` 退出 0。选定源码排除继承的单行 assert 格式脏改，
  正式工作树仍保留该用户增量，不声称它本身已通过格式检查。

证据根 `/volumes/data/kailo/tmp/codex-runtime-session-scope-20261003.UQJGvp/`：
`runtime-baseline.log`、`runtime-final-baseline.log`、`mutation-row-lock.log`、
`mutation-resume.log`、`mutation-dead-ownership.log`、`runtime-restored.log`、
`runtime-clippy.log`、`runtime-format.log`；原件摘要见 `evidence.sha256`。
可选定补丁为 `canonical-runtime.patch`，规范 Runtime 源码 SHA-256 为
`8f04ccfbd3c8f665ae1c78d25b33295f966bc6a63d6c222a78154c6bb502f539`。
该数据库只是隔离的最小并发锁夹具，不是完整迁移演练；stdio 子进程不是
真实 Codex/model，不含凭据，不能把上述通过算作线上恢复、Agent 首轮或设备 E2E。

### 23:28 UTC 固定四路径集中检查回执

本轮基线为 `a6716fe42d18a2054ee8a6325ffe063530dbf6d0`；唯一原 full 输入
是 tree `060453005d77317a9661119973892d8dfe948b34`（不是新增 commit），
4 路径、+586/-65。只包含上述两个规范源码与 README/本节，排除继承 assert
格式差异及其他工作树增量；检查前后四路径 SHA 全部一致。

从 apps 根运行原 `./tools/check.sh --full`，使用 `CHECK_SOURCE_REF` 指向该树，
`TMPDIR=/volumes/data/kailo/tmp`、`CHECK_CPUS=4`、`CHECK_MEMORY=8g`、
`CHECK_NETWORK=host`、`CHECK_CACHE_ROOT=/volumes/data/kailo/check-cache`、
`CARGO_BUILD_JOBS=16`、`BUILDX_BUILDER=kailo-core-data`。原 launcher 复用
上述 immutable `10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
实际 UID/GID=1000:1000、cpu.max=400000/100000、memory.max=8589934592、
memory.swap.max=0，实际 Cargo jobs=16；未重建镜像或修改限额/并行度。

session 56205 实际退出 0，末行“全部通过”。完整原件
`/volumes/data/kailo/tmp/codex-runtime-recovery-full-20261003.R457c7/full.log`，
SHA-256 `7eb3532cf47a5558270a567366f85c309325437014e3b990f686c657d568d63c`；
原 launcher 日志 `/volumes/data/kailo/tmp/tmp.ClYsDg25EX.check.log`，
SHA-256 `eb760b8034caabdfb9a2913417ee901c5daf9d550dec8f9d48c739c0fcc73b66`。
自有 SDK 已由原 launcher 清理，没有部署、线上数据写入或构建产物。

未提供 DATABASE_URL，实际迁移演练 SKIP；未投递 ignored `.env`，实际部署
配置预检 SKIP。五个需要显式数据库/运维条件的演练保持 ignored，包含上文
已单独实际验证的 Runtime recovery 目标；不把本次 full 当成它再运行一次。
未安装 gitleaks，仅原内置扫描通过。完整 full 通过不替代真实 Codex/模型、
线上 crash recovery、Agent 首轮、普通触发或设备验收。此后仅更新本刀 README
摘要与追加本回执，再用原文档快路径核对，不为记录文字重跑 full。

## 2026-10-03 AgentTask 未绑定 turn 的跨页恢复

本刀基于 `d4e86374b6917244c4d911cb38c40b545266af5b`，仅修改
`core/crates/platform-core/src/agent_task.rs`（+214/-8，无继承改动）；
`agent_session.rs` 核对后不改。以下为实现后证据，尚未部署，不代表真实
Automation 首轮、Codex IPC 或 Relay 回复端到端验收。

四步影响：

1. 权威：遵守 `.design/12` §2/§6、`17` §5/§10、`05` §2.9 既有原生恢复及
   `automation.run` 政策。只读 Codex 固定 commit
   `7498521d288b9b3b96ffba4eedf089d8d6e06a84`，完整路径
   `/volumes/kailo/.references/codex/codex-rs/app-server-protocol/src/protocol/v2/thread.rs`，
   `ThreadTurnsListParams` / `ThreadTurnsListResponse` 明确 opaque cursor 与 null EOF；
   不新增权限、默认审批或普通 mention/manual 入口。
2. 影响面：原 `advance` 在缺少 `runtime_turn_id` 时每次从第一页开始，原 `observe`
   又拒绝非末页，导致丢失 `turn/start` 回执的多页历史无法恢复。本次在原
   `Supervisor::observation_timeout` 总预算内读完所有页，再把唯一候选交给未改的
   `observe` CAS；与 `gateway_usage::invocation_started_at` 既有分页语义对照，
   不提取跨模块抽象。已绑定 turn、Session 创建/恢复、原生 start、准入、回复及计量不改。
3. 副作用：分页只读原 thread；局部 `UnboundTurnHistory` 仅保留一个候选及已见 cursor，
   不落库部分候选/游标，不引入业务状态或注册表。必须读到 EOF 才证明 clientId 唯一；
   绑定、取消和回复仍走原 Invocation/Session/generation 守卫；无匹配保留 UNKNOWN。
4. 异常：缺字段、非法 UUID、未知 status/itemsView、页内/跨页重复 clientId、循环或
   非法 cursor、原生错误及总预算耗尽均保留原 UNKNOWN/intent/thread，不重发
   `turn/start`；没有新增硬编码时限、页数上限或迁移。

复用已有 `kailo-installation-scope-sdk-e4agxd`，固定镜像
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
Rust/Cargo 1.90.0、Cargo16，实际 4 CPU / 8 GiB / swap0。每次 Cargo 前执行原
container-safety 资源/进程/压力预检；未新建 SDK、降低并行或运行 full/build。
使用私有 `/evidence/runtime-session-UQJGvp/core` 与其 `target`，
`CARGO_NET_OFFLINE=true SQLX_OFFLINE=true`，不消费生产数据库。

实际命令与退出：

- `cargo test -p platform-core --bin platform-core agent_task::reply_tests -- --nocapture`：
  `baseline.log` 退出 0，8 passed / 75 filtered。
- 仅私有生产源码恢复“非末页直接 UNKNOWN”，断言不改，同目标
  `mutation-first-page.log` 退出 101，6 passed / 2 failed。
- 还原分页后移除跨页候选唯一性守卫，断言不改，同目标
  `mutation-uniqueness.log` 退出 101，7 passed / 1 failed。
- 两变异均以 `apply_patch` 精确还原，正式/私有源码 `cmp` 一致；同目标
  `restored.log` 退出 0，8 passed / 75 filtered。
- 固定 SDK `rustfmt --edition 2021 --check crates/platform-core/src/agent_task.rs`
  及正式 `git diff --check` 退出 0；
  `cargo clippy -p platform-core --bin platform-core --tests -- -D warnings`
  实际退出 0，41.66s。

原件目录 `/volumes/data/kailo/tmp/codex-agent-turn-recovery-20261003.AuWqo9`。
冻结源码/`agent_task.final.rs` SHA-256
`5342c8a887402dee5497faeda40fdb745decd2fc1518b0d71f19065f934109b8`；
`agent-task.patch` SHA-256
`5bb353e434743f8fdeb50545165a353a02a2bf060b630af32123edd875c06589`。
日志 SHA-256：

| 原件 | SHA-256 |
| --- | --- |
| baseline.log | `5f27e6c45e24e42ebee3b4359f0de0eac10816853fb6952dd975122c49fafbd2` |
| mutation-first-page.log | `fc39f0cb40afeae49f367765660fedd0650afa58c1757815c1114a3c36e82173` |
| mutation-uniqueness.log | `ab577a98ec8c0361a957ba04a62c6f1d9c564e7b23b20b5936c6f86bd2f02494` |
| restored.log | `fd3891721594b40cadb1f2f68ba1a79a0bd15251988ce53ca57095729f42a14e` |
| clippy.log | `c9dd5edf979529283d97768658306dadd6bd0dd475900f2b33558ed6eb34dc5f` |
| format.log | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

三个新增测试验证真实生产分页解析：候选等待 EOF、后页候选、opaque cursor 原样传递、
无候选、页内/跨页重复、循环游标、缺字段/未知枚举，并复用原 native reply 提取。
这不是实际 Codex IPC/history、PostgreSQL CAS、Relay 投递或 OpenMeter 结算；
总预算耗尽在实际 `advance` 读循环受控，但本组解析测试未动态触发该超时。
未重放安装、写生产 SQL、提交或部署；后续由主线集中 full/交付，不以本组窄验证
宣称未补定政策的普通触发或真实 Agent 首轮已经闭环。

### 2026-10-03 automation.run 可选配置同源投递纠偏

原 `start-core.sh` 已在非空 `AUTOMATION_RUN_METERS_JSON` 时生成专属 Compose
overlay；线上 UNSET 不能归因于该 launcher 不支持投递。本次只补基础
`compose.yaml` 的 `${AUTOMATION_RUN_METERS_JSON:-}` Core 环境投影，同时移除
launcher 的重复 overlay/清理分支，保留 Runtime overlay 与原 wrapping。
Compose 从唯一 `--env-file .env` 自行解析，不依赖 sudo 保留该 shell 变量。

四步结论：权威为 `05` §2.9/DD-107 的 CHECK 与显式 meter pin、工程 `07` §2
唯一配置来源；影响限两部署文件，实际 reader 仍是 `automation::register_run`；
副作用仅配置渲染，未选择或创建 meter/feature/entitlement、写实际 `.env` 或部署；
缺席/空配置仍由既有 reader 返回 None、不登记运行 Action，非法非空配置仍拒绝。

原 `bootstrap.sh --validate-config`、`bash -n start-core.sh`、`git diff --check`
均退出 0。原 `docker compose config --no-env-resolution --format json core-bff`
只投影检查目标变量：缺席、空值及非空协议负例 `[]` 均逐字一致，退出 0；
原 launcher overlay 的 `[]` 与新基础投影等价，退出 0。`[]` 不含任何 meter，
只验证传输，不执行 Core 登记或计量准入。仅 Data 副本删除真实投影行后，
环境存在性断言实际退出 1；按原字节恢复 cmp0/SHA 相等后投影检查退出 0。
bootstrap 本身不检测该删除，不能将这次投影断言冒称完整预检或业务验收。

原件 `/volumes/data/kailo/tmp/codex-automation-meter-forwarding-20261003.qBJ6ka/`；
两源窄 patch SHA-256 `400bee61d63c3dcc9e3368dc87cd427f4d9729066b9cdf82df9dd68d6f42b4fb`。
未运行 full/build/SDK、部署、登记原生用量或真实 AgentInvocation；原生 meter 库存
为空的计量配置缺口未解除，不能据此称首轮可用。本记录由收口负责人集中验证。

### 2026-10-03 AgentTask 分页与可选 meter 投递集中收口回执

以 `d4e86374b6917244c4d911cb38c40b545266af5b` 为底，只选本刀 AgentTask、
Compose/start-core、README 与本记录五路径；原 Compose 三处继承差异未选入。
检查固定树 `076f35b1c1d82b0825191e33827258cec5198836`，没有消费流动工作树。

原命令 `bash tools/check.sh --full`，显式 `CHECK_SOURCE_REF` 为上述树；
`TMPDIR=/volumes/data/kailo/tmp CHECK_CPUS=4 CHECK_MEMORY=8g CHECK_NETWORK=host`，
`CHECK_CACHE_ROOT=/volumes/data/kailo/check-cache CARGO_BUILD_JOBS=16`；
没有投递 `DATABASE_URL` 或真实 `deploy/local/.env`。资源预检无 Cargo/rustc 作业，
原固定 SDK `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
UID1000:1000；实际 `cpu.max=400000 100000`、`memory.max=8589934592`、
`memory.swap.max=0`、Cargo16、OOM 事件为 0。

原 session 58118 实际退出 0；原件
`/volumes/data/kailo/tmp/codex-agent-turn-meter-close-20261003.gDQyrE/full.log`，
SHA-256 `a4d772a153f76a0c84ca5784c4e37504249e301dad19a3c40d5572875cfe9b50`。
fmt/Clippy、Go/TS/Dart 静态与验证、143 schema 四侧同步、Workflow replay、
18 条追溯/18 workflow kind、供应链与文档门禁均通过；Core 80 passed / 3 ignored，
另外两项运维演练 ignored。实际数据库迁移演练及实际部署配置预检明确 SKIP；
未安装 gitleaks，仅原内置扫描通过。原 launcher 已清理唯一检查容器。

三生产源终态 SHA 与选定输入一致；本次没有迁移、原生配置或业务对象写入。
线上只有五个 Automation 管理 Action，无 `automation.run`、Invocation/Automation
记录；OpenMeter meter/feature/entitlement 各为 0。普通触发完整安全政策、真实
meter/额度投递及 Agent 模型首轮/回复/用量 E2E 未闭合；源码检查不填补这些事实。
没有构建、部署或设备验收。此后仅更新 README 摘要与追加本回执，再运行原
文档快路径，不为证据文字重新执行 full。

### 2026-10-04 普通 Agent 模型计量分流：实现与定向验收

基准为 `8b3882d35b84b2c0d6bfcb29321c62c7a44f82d4`。本刀只实现
`gateway_usage.rs`、`openmeter.rs` 与 `20261004002000_agent_invoke_model_usage`
上下迁移，四路径 +623/-42；原 OpenMeter 两处继承格式差异未选入。
精确补丁为 `/volumes/data/kailo/tmp/codex-agent-invoke-billing-20261004.Ss6wwe/canonical-head.patch`，
SHA-256 `de8549141161d3ba3c49547a8cc5246ebd3f2865d7400ddfd1b62949817ce113`。

四步结论：权威为 `03` §8、`11` 与 DD-21/38/51，普通 `agent.invoke` 只消费
实际模型 SUM，不能套用 Automation COUNT；真实影响为 `prepare`、
`recheck_dispatch`、`record_invocation_usage`、`committed_turn` 同一调用链及
原 trace guard。Action、Invocation Automation 引用对及 AE target 必须一致：
`automation.run` 保留原非空 COUNT，`agent.invoke` 仅允许 SQL NULL 计数投影。
副作用仍以原生完整请求集、逐条 exact outbox ID、`stored_at` 和既有审计为权威，
Scope/Grant/Capacity/最终真实时钟与 Quota 核验未削弱；空页/202 不等于零用量或结算。
旧 Automation writer 保持兼容，普通登记、消费者与迁移须同批投递；存在普通 trace
时 down 在 DDL 前明确拒绝，不删除用量或历史事实。

复用原不可变 SDK `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
实际 4CPU/8Gi/swap0、UID1000:1000，命令显式 `CARGO_BUILD_JOBS=16`。
原 `cargo test --offline --locked -p platform-core --bin platform-core gateway_usage::usage_tests`
基线 9 passed；私有生产分流分别改成拒绝普通 NULL、接受 Automation NULL，
两次实际退出 101，各 8 passed / 1 failed，逐字还原。原 Clippy 首轮实际 101
为查询 tuple 的 `type_complexity`，改用真实 `FromRow` 查询结果后，最终 session
22263 退出 0：9 passed、两源 rustfmt check 0、Clippy `-D warnings` 0。
原测试日志只含 stdout，编译/Clippy stderr 留于实际工具回执，目录中的
`clippy-console-receipt.txt` 明确是转录而非原始完整日志。

沿原私有 PG 新建唯一验收库 `agent_invoke_billing_ss6wwe`，未使用作者库或业务库；
原 SQLx 58 条迁移前进、仅末条回退、再前进退出 0。最小同 Scope 测试夹具保留
全部原 FK/CHECK/trigger，仅 PROVISIONING/PENDING 引用，无原生凭据、meter 或模型用量；
实际插入一条 SQL NULL 普通 trace 后，原 down 退出 1，提示必须保留该事实。
schema/data dump 除原 pg_dump 随机 restrict 元命令外逐字相等；原 SQLx 清理该
唯一临时库退出 0，原 PG/SDK/网络未删除。这是约束与回滚验收，不是模型调用。

上述原件在 `Ss6wwe`：最终 `restored-clippy-repaired.log` SHA-256
`54cb39c78180a923e74423325e3d50bd85212488f40d45b15f6e30a63f8cbe48`；
`migrations-run-revert-run.log` 为 `38facf1820a77f9ba9fdde027b764c90601bb3ec03c730f1915c434e40012699`，
`ordinary-trace-down-refusal.log` 为 `ea04b0cb8e4e6778406f7f470387c2e5665626908c4b0780be6727058f3c0039`。
本阶段尚未运行组合批 full/SQLx prepare、发布或部署普通入口。生产原生 meter/credit
配置尚缺，不等于禁止后续使用明确隔离的验收 Tenant、原生 meter/entitlement 与真实
模型调用进行端到端验收；当前定向检查未证明该 E2E、设备或生产计费可用。

### 2026-10-04 普通调用生产者：冻结与组合定向证据

本刀复用 `03`/`05`/`12`/`17` 的既有普通 mention/manual 要求，不再将 Action
登记字段误判为必须新增产品政策。真实链为签名 Relay HUMAN 事件 → 同一
Session/Invocation/AE/Grant → 原 AgentTask/Runtime/native turn；manual 仅引用
本人已持久消息，与 mention 按原 source event/Installation 共用唯一幂等事实。
先冻结真实权限、CHECK、PLATFORM_SLOT 和版本/代际，再执行副作用；配置缺席
不登记 `agent.invoke`，不写默认权限、meter 或额度。Automation 仍以原 action
与非空 Automation 引用对进入原链，普通调用不借其 executor 或 COUNT。
未知 Start/回复仍按原 thread/turn/WorkflowRef 观察，不改 ID、重建根或重复 turn。

固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的只读来源为
`.references/buzz/crates/buzz-acp/src/relay.rs::{query,query_raw,query_raw_all,send_subscribe}`
与 `.references/buzz/crates/buzz-core/src/nip10.rs::{ThreadMarkers::resolve,parse_thread_markers}`；
相对证据根为 `/volumes/kailo`。Codex 来源仍为
`7498521d288b9b3b96ffba4eedf089d8d6e06a84`，本批未改 native 协议。
普通 canonical 为 `yK1eTV/canonical-owned.patch`，20 路径 +1750/-66，SHA-256
`4741ced8d4bc15d1db3c0502fd6bdee3646daaf407e63b2394184e922da544be`；
包含唯一 executionPermission schema 与合并四侧，权限代码另片合入，不重复生成。

实际原件 `/volumes/data/kailo/tmp/codex-agent-invoke-20261004.yK1eTV/`：
原 binary 89 passed / 4 ignored、Clippy 0、12 源 fmt check 0、四侧 gen 0；
参数匹配两处生产 guard 破坏实际 101、2 项断言失败，旧 ComponentTask 专用查询
恢复后真实隔离 PG 断言实际 101；原字节恢复后 binary/PG 通过。早期类型转换、
变异编译写法与 lint 失败保留，不计作有效负向或最终通过。随后合并权限 DTO 的
组合 binary 92 passed / 4 ignored、Clippy 0；隔离库 59 迁移末条往返与当前
19 SQL PREPARE/ROLLBACK 通过，均为定向证据而非本批 full 或在线业务。
REVOKED/UNKNOWN 的原 open/count/age 统计两行另片合入，原只读 aggregate 实证
包含该行并排除 ABORTED/DISPATCHED；未改变驱动循环或创建第二监控权威。

### 2026-10-04 Installation 自身 execute 显式授权：实现后证据

四步影响结论：

1. 权威：03§5 的 Resource executor/share、17§6/8 的安装不等于授权和 Agent 权限管理；授予复用 05§2.8 grant_read 的确切 owner 审批，撤销复用明确确认的收窄路径。仅 HUMAN、同 Tenant/Workspace、确切 Installation 的持久唯一 AGENT，不接受客户端 subject，不授予模型/Tool/其它 Resource 或 admin。
2. 真实调用：原 `/api/v1/actions` → Governance 两个 Semantic → 同模块 installation_permission gate/prewrite/dispatch → 原 SpiceDB executor Touch/Delete 与 native 读回；TARGET_OWNER 只由此 grant 消费。原 Installation query 给可选 executionPermission，原 Web/Desktop AgentDefinitionsPage 共用 InstallationExecute 与 client.submitAction。Delegation 目录允许后端真实 agent.invoke 且 target 必须当前 Installation；无新 Route/Workflow/权限权威。
3. 副作用：原 AE/Operation 参数冻结 owner/version/唯一 Agent；审批前后版本查证分开，外发前检查批准、消费时限及 owner 资格。撤销仅给同 Installation、同冻结 generation 的普通 agent.invoke 记录原 cancel_pending，沿既有 Task/native/usage 收敛，不影响 Automation/其它 Grant。UI 将授权、委托和运行条件明确分离，GET Refresh 不派写，UNKNOWN 保持原键。
4. 异常：缺/未知权限投影、撤权、暂停、审批失效或不认识的策略均拒绝。新 revoke 与旧 grant UNKNOWN 相撞不能以瞬时 absence 证明旧 Touch 不会迟到；保留确切 AE/Installation pending fence 和原 operation，重入只 native 查证，不重写或生成替代请求。该分支沿原 RB-05 open/oldest_open_age、治理周期与 ADMISSION_EVALUATION_TIMEOUT_SECONDS + 两个周期告警（WAITING 以原策略 expires_in 为界），超界由 Core 值班负责人依 RB-07 留操作号、最近核查/下一次核查时间并升级实施负责人；禁止人工改库清 fence。REVOKED/UNKNOWN 的原统计纳入由 ordinary 作者另交独立两行补丁，无新增指标或调度框架。

后端原件见 `/volumes/data/kailo/tmp/codex-agent-invoke-20261004.yK1eTV/permission-validation-handoff.md`。首次组合编译真实 101（误读 Definition 两字段、Workflow owner DTO 类型），已修为 exact catalog 查询和四字段转换；随后新模块 3 项 0，删除 owner_policy 的 action==GRANT 真生产 guard 后 2 pass/1 fail、101，格式化源逐字恢复。最终合并 DTO 的 binary 92 pass/4 ignored、Clippy-Dwarnings 0，03000 forward/down/up 与当前实际 19 SQL PREPARE/ROLLBACK 0；临时空库无业务 seed，已删除。三项审批断言属于新 Rust 模块，不是被排除的继承 governance.tsx ApprovalPanel 变更或其验收。

共享 UI 原页 6 项定向检查 0；删除 InstallationExecute 的 Installation+Workspace key 后旧回执泄漏断言真实失败（Vitest 1，不是编译失败），恢复 agents.tsx SHA 83b21a9d93461273b1b3a5e5a322a72275a752eb3da3558ff10a93fb4dd1528e 后 6 pass/120 filtered、0。共享生产与检查 TypeScript、Web、Desktop typecheck 全 0。Desktop 首次缺依赖/离线默认 store 失败原件保留；使用原 collaboration pnpm11.4.0/frozen lock 与已存在 `/cache/pnpm-memory-read` 后成功，未改锁。原 8b i18n generator 对本批 10 keys 生成/检查 0，原 registry 生成/检查 0；没有选入继承 generator/Dart/ApprovalPanel 改动。

以上不是 full、真实 SpiceDB 授予/撤销、Temporal owner 审批、进行中 Codex cancel/usage 联合 E2E、客户端产物或部署通过。完整 full 由收口负责人单次执行；未解除 Agent 运行与真实用量验收边界。
审计缺口另沿原 RB-06 按 operation/evidence_refs 定位，由治理责任人处理；
不补造 OUTCOME/usage、不删除 fence、审计或 checkpoint 来消除未决事实。

### 2026-10-04 普通调用与权限批集中检查：源码阶段回执

以 8b 为底，普通、模型 SUM 分流、Installation execute/UI 与自有记录选定为
37 路径 +4038/-146，固定检查树 `58b4e93b9ffc54214078fde697cff60853d8ec0e`。
共享 Governance 窄合并，schema/四侧只选一次；旧 Runtime/OpenMeter/Compose、
ApprovalPanel、生成器及发布记录的继承差异未纳入。默认 Git index 未动。

原 `bash tools/check.sh --full`，`CHECK_SOURCE_REF` 精确上述树，Data 缓存、
固定 10ad SDK、实际 4CPU/8Gi/swap0、UID1000:1000、显式 Cargo16、OOM 0。
首次 session 68286 在 pnpm 依赖准备退出 2；复用已验实 warm store 后 session
28341 在 Dart pub.dev 准备退出 2，两次均未进入门禁。未改源码/锁/检查器或全局
DNS；按原已成功 host/PUB_CACHE 执行配置恢复，最终 session 23139 实际退出 1。
原 launcher 已清理三次自有检查容器，未删除共享 SDK 或原私有 PG。

最终原件 `/volumes/data/kailo/tmp/codex-agent-invoke-selected-20261004.y6aUqf/full-host.log`，
SHA-256 `c7aee775bbaeef96f4ee64bdcd2df7e3afdf773e70684c97c5c92f561d489637`。
fmt/Clippy、Go/TS/Dart 静态、四侧生成同步及既有 canary round-trip、143 schema
相对 contracts-v0.1.0 的兼容检查（匹配 3 个历史 schema）、四语言验证均通过；
Core binary 92 passed / 4 ignored。Workflow replay、18 追溯/18 kind、28 产物
供应链、安全静态与文档通过；未安装 gitleaks，仅原内置扫描通过。
该兼容结果不外推为全部新旧业务 payload 的端到端验证。

仅 seam 两项真实失败：Web 登记 `e6fe9478955d95079f997432941cc5859f4eada2bd6fdee278c9ce5bfdbe7b7f`，
当前输入 `ab052e9ebb4e5d711851e773beb5958a7fb78ce8bbdd536fc57f9915b59fd19e`；
Win11 登记 `5a85c94e4be590901cb5fd127bab76c43d7a3ac3b9d973b06ffcde0a0d57eb45`，
当前输入 `bed08156b752485f403d8ac3b923613e59b25fa6bdfe81f67c8f02d498f38d1e`。
不手改摘要、不继承旧产物为当前源码，不重复源码检查；两端原 helper 交付另批收口。

本次 host 执行未投递 DATABASE_URL 或真实 `.env`，实际迁移/SQLx 与部署预检
明确 SKIP；前述 59 迁移往返、19 PREPARE 和普通 trace 不可逆验证为独立隔离
定向证据，不能冒称本次 full 已跑数据库。原拟用于 full 的唯一空库
`agent_invoke_full_y6auqf` 未运行迁移，已用原 SQLx 精确删除；原 PG 保留。
本批只作源码阶段记录，不称 full 0、客户端产物/部署/设备或真实模型联合 E2E
通过。生产 meter/credit 尚缺与可继续原生隔离验收分开；本轮之后仅 docs 快路径。

### 2026-10-04 普通 Core 投递与显式授权：02:07 UTC 回读

固定源码 `13a8af775afb5232a5ce590bd9d5750cbb0f1a73` 的 Core 原发布与 registry
读回退出 0；原 forward migration 57→59、`start-core.sh --no-build` 退出 0，
healthz 200、原受监督 Codex child 恢复。仅 Core 被替换，既有 Installation
`8f240978-34bb-437d-97ee-498a30e67e86` 仍 ACTIVE generation 1，固定 Version
`cc099e7c-74d6-48a8-86c2-63bb878551ea` 与 hash 不变，部署后首次只读 Invocation
为 0。发布/资源/卷及其它容器证据见 [release-artifacts](release-artifacts.md)；
不重复安装、Workflow 或模型 turn，不将在线 59 迁移冒称前节 full 内数据库通过。

真实 HUMAN owner 经原 BFF 登录后，02:05 的 `agent.installation.execute.grant`
返回原 AE `470da843-a8f3-45e1-b721-24fbaa325ae7`、WAITING/NOT_DISPATCHED；
02:06 原 owner_requirement APPROVE admitted=true。首次准备脚本把 owner 误读
成 roleRequirements，guard 退出 1 且未 POST；纠正为原 owner 合同后退出 0，
没有放宽服务端策略。02:07 原任务读回 CONSUMED/ALLOWED/DISPATCHED，
Installation resourceVersion 3、executionPermission requested/effective 均为 true。

随后仅一次原 `agent.delegation.grant` Explicit Confirmation：AE
`50efa700-ca10-4394-822a-7a81ecd2037e`、Operation
`89da8cf6-7bf9-483c-83e1-0a7b5c4ed85e`；Delegation
`a1d9a1ca-af8b-4df6-9f87-ab36e5037964` 读回 ACTIVE、version 1、uses 0/maxUses 1、
expiresAt `2026-10-04T03:35:00Z`。唯一 scope 为原 `agent.invoke@1`、确切上述
Installation、CONSUME_ONLY/PLATFORM_METADATA_ONLY；没有授予 Tool、模型管理或
其它 Resource。原生隔离 meter `uat_kailo_verify_total_tokens_20261004` 及
10000 totalTokens 硬限额由运维预先投递，非生产默认额度，不自动延长。

原件目录 `/volumes/data/kailo/tmp/codex-agent-invoke-20261004.yK1eTV/`，SHA-256：
`bff-execute-grant.log` 为 `fba9314294ecbdff1505e4b6138cf43e42aad5b4073dc091cb83c79eacc606c4`；
未 POST 的 `bff-execute-approval.log` 为 `4be4c206cc7cd38baeda09fff7bc004b21b54157c158b23e187bcdaccd9dac3f`；
`bff-execute-approval-owner.log` 为 `7c2d21b3351870f471dfa333e78dbf01304e2ba8425f838f25c3994bf8011aed`；
`bff-delegation-grant.log` 为 `2f83160feaf372149595c456b65fada04fd01dbc1b4c2cab1c8b8bd338b5fa3c`。
三次肯定路径退出 0，失败准备原件保留。

四步结论：权威仍为 03/05§2.8/11/17 的原 Resource、Approval、Delegation 与原生
计量；影响为同一安装的显式 execute 和单次冻结 scope，不增加授权权威；副作用
只经原 Action/BFF/owner 审批，不直改业务状态或默认授权；未知结果仍保留原引用。
截至此回读没有模型请求、频道回复或 stored usage 终态；Web 原消息生产者缺失
mention 标签的修复属另一批，不继承本节为普通首轮、生产计费或设备 E2E 通过。

### 2026-10-04 Web 根消息 MENTION：源码接缝与后置验证

权威：`.design/12` §2、`17` §2/§7 允许普通顶层 Channel mention；固定 Buzz
`779af8886caae1317b4de962082429867ab61503` 的
`desktop/src-tauri/src/events.rs::build_message_with_client_tags` 在无 thread_ref 时只写
h、mention_tags 与媒体；`crates/buzz-core/src/nip10.rs::ThreadMarkers::resolve` 无 reply
marker 即顶层。原 Web Composer→publishMessage→BFF 原发布只产 h+imeta，缺 p，
故不能用旧 POST messages 的成功冒称 mention 成功；本批不新增 thread 编辑器。

影响：唯一 `WebPublishMessageRequest` schema 及四侧生成物新增
mentionInstallationIds。Web 从原受权 Installation 分页目录明确选择 UUID；BFF
在原 Tenant/Workspace 内 fresh 核 ACTIVE Installation/AGENT、当前 generation 与
MENTION Channel binding，恰好一把合法 SERVER key 后才签 p。附件原 URL/hash/type/size
校验保留。选择失效、目录未知或跨 Workspace 不清选择后偷偷发普通消息；
agent.invoke 的执行权限、Delegation、Quota/Capacity 仍独立裁决，不因 mention 授权。

异常与兼容：原 publish_attempt 新增排序去重 UUID[] 引用，旧 writer 缺省空集；
初读与并发 claim 冲突均对比原目标。同 key 还须匹配原 DISPATCH audit 唯一 Workspace，
缺失/重复/异 scope 拒绝；同 scope 原 ACCEPTED 准确回读，不因后来撤权改判旧结果。
UNKNOWN 不重发，NOT_DELIVERED 保持原 CAS。迁移 `20261004004000_web_message_mentions`
down 遇非空引用明确停止，不丢幂等事实；不保存正文/hash，不改原生 Desktop 身份链。

实际验证复用固定 SDK `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
4 CPU/8 GiB/无额外 swap、Cargo16。原 `collab-bridge --lib mention_tests` 1 passed、
`platform-core --bin platform-core web_transport::tests` 6 passed，Clippy `-D warnings`
与两源 rustfmt check 均退出 0。私有生产删 p、放开目标比对、放开 Workspace 比对
三变异分别退出 101；逐字还原/cmp 后最终原目标通过。初次快照依赖缺项及本刀
SpiceDbError 调用边界编译错误原件保留，修正后才记通过。

隔离 network-none PG 新库真实 60 迁移成功；原 resolver/insert/replay SQL PREPARE，
同 key 不覆盖目标、旧空集、原 ACCEPTED 唯一 Workspace、非空 down 拒绝以及清理
本夹具后 down/up 均有实际回执。最终精确删除本私有库并读回 0，未写生产 SQL。
原 tools/gen.sh 经现有 `/cache/npm` 生成四侧退出 0（此前 EAI_AGAIN/ENOTCACHED 原文保留）。
两个公共样例经原四侧 roundtrip 入口实际验证：Rust 2 tests、Go 2 主 test/2 子 case、
TS 3 tests 与类型检查、Dart 4 tests 均通过，覆盖 mentions+attachments 与旧 content-only；
生成差异仅新增两个类型，无既有字段删除。Web 原类型检查与 14 tests 退出 0；
这不是新 Composer 的动态浏览器用例或 Relay/Codex 首轮 E2E。

原件 `/volumes/data/kailo/tmp/codex-agent-invoke-20261004.yK1eTV/`：
`mention-final-scope-core.log`、`mention-mutations.log`、`mention-scope-mutation.log`、
`mention-final-pg.log`、`mention-generation-cached.log`、`mention-four-side-roundtrip*.log`；
TS 冻结原件 `/volumes/data/kailo/tmp/codex-mention-ts-review-20261004.T5kzbg/ts-targeted-frozen.log`。
选定 canonical SHA-256 `88794896845ce2aaa29eccc782bed0be652c00f29ab830fb3ce12326edcb2d07`，
相对 `f81f6ca84d5d4773920a3e7744eb24614376551f` 为 18 files +679/-52，排除继承
stream/openStream/i18n 差异。此处仅源码与窄验证；未 full、构建、部署或发送真实消息，
不将前节已完成的授权与 Delegation 当作本节原生执行、回复或计量终态。

四侧本类型反例随后已实际闭合：只在私有同一样例把 mentionInstallationIds 改成
unknownMentionIds，原四入口分别退出 Rust 101 / Go 1 / TS 1 / Dart 1，均命中字段
丢失/未知接口字段断言（`mention-four-side-mutation.log`）。样例逐字恢复并 cmp，
SHA-256 `b66b72c310cd0f8321ac44e83329c6dab70bbc14bdb84cda7a3a8f8047462616`，
四原入口最终复跑全部退出 0（`mention-four-side-restored.log`）；未改生产输入或重跑 Core 主包/full。

### 2026-10-04 02:54 UTC：MENTION 原页面首发与原生拒绝

源码 `b2829522227d7f17053228835c9fac61734a04ef` 的 Core `cae7005b…` 与 Web
`69a956b6…` 已经原构建、独立 registry 读回及限定服务投递。在线迁移 60，
原安装 ACTIVE generation 1、固定 Version/hash 未变。ADR-09 明确保留宿主提及
接线；此次 Web 选择控件不是 Desktop 共用控件，不声称整个 Composer 单源。

原受控浏览器以原 OIDC 登录同一隔离 Tenant/HUMAN，在真实页面选择 Workspace
与 Installation，再点一次发送；未直接调用模型或生成原生 tags 绕过 BFF。
意图 `8577b796-5f7b-489c-894d-ae08548d562d` 的目标为原安装
`8f240978-34bb-437d-97ee-498a30e67e86`，返回 HTTP 403、DENIED/PUBLISH_REJECTED，
Operation `04d4210b-af84-4556-ad47-64a8ec974e22`。Core 02:54:27.762234 UTC
原日志原因是 Relay `HTTP 400 {"error":"restricted: not a channel member"}`。
这是确定拒绝，不是 UNKNOWN、成功或模型调用失败；没有重发、改授权或追加额度。

只读采样 Invocation 0、Session 0；Delegation
`a1d9a1ca-af8b-4df6-9f87-ab36e5037964` ACTIVE、uses 0/maxUses 1、仍于 03:35 UTC
到期。原件目录 `/volumes/data/kailo/tmp/codex-agent-invoke-20261004.yK1eTV/`：
`bff-mention-ui-first-send.log` 实际退出 1（PUBLISH_NOT_CONFIRMED）；
`first-turn-baseline.log` 只读退出 0，SHA-256
`9d42afbb477422bd639c8d3acc2a6d39e091de5a34753ab69e9665e7ea04033d`。
该回执未证明 Relay 发布、AgentInvocation、模型首轮、频道回复或 stored usage
任一正向终态；成员准入拒绝仍需沿原身份/投影权威定位，不放宽准入充当通过。

后续沿原权威确认：该 HUMAN 只有管理权限，没有 WorkspaceMembership，原生
拒绝符合边界，不修改生产授权逻辑。02:59:12 UTC 由同一 HUMAN 经原
`POST /api/v1/actions` 显式执行 `workspace.member.add`，ActionExecution
`19045819-7c6d-4667-95d3-38c75c5ecec3`、Operation
`566ba2f2-8810-4ea6-8289-16ac854c95d1` ALLOWED/DISPATCHED；原 Temporal
MEMBERSHIP_PROJECTION 收敛为 TERMINAL/COMPLETED，membership
`cadb4300-d6d3-412f-9c77-09816024fcee` ACTIVE v2，无观察缺口。
原件 `bff-workspace-explicit-join.log`、`publish-membership-joined.log` 均退出 0。

03:00:14 UTC 重新核 ACTIVE 成员、公钥、安装与未消耗单次 Delegation 后，页面
发送新的明确意图 `210f8d1c-347f-4d07-adaf-473edd0df879`；不是重放 UNKNOWN。
原 BFF HTTP 200，Operation `2f388115-2b12-42cc-9164-e725a6455698`，Relay 准确
回读 event `2f0844e4a88272160e01f8826f9528381fd882c1f033810ea1397997fb0805e2`，
kind 9、同 Workspace h、准确 AGENT p、没有伪造 thread/e tag。
`bff-mention-ui-member-send.log` 实际退出 0，仅证明消息发布，不是整个 Agent E2E。

原只读 `first-turn-observe-1.log` 确认 Invocation
`4cfe99fe-1e45-46d2-834b-411027412a9d`，Session ACTIVE，Codex thread
`01a104da-e960-7ed0-b2a3-7d047d88792e`、turn `01a104da-ef92-7c32-91a9-70a742645180`
native_status completed；AgentTask 仍 RUNNING/UNKNOWN_EXTERNAL_RESULT、reply NULL，
usage_event 0，Delegation uses 1/maxUses 1。Core 冻结 trace
`c0cf9530367e4505860a9e4eb1a0108a`；Gateway 原请求
`01a104db-1d99-7e81-9e50-e28a0baff358` HTTP 200、input 8726/output 37/total 8763，
native usage_outbox seq 1，但 request_logs/usage_dispatches 的 trace_id 均 NULL。
因此保持终态未确认，不凭 principal 或时间反向归属、不回填旧账、不重发模型；
修复追踪传播与对账此旧回合是不同事项，不因源码修正自动把本条改记为成功。

同一固定 b282 输入的 Web/Win 原 helper 分别仅运行一次，均退出 0。
Web source `daff300fdc8af1625d67b8b82dbcfe298fb01aa9371b62c06445551c1d74ee17`
（98 输入），artifact `69a956b6748661c8c15263c7838e34d7065bbe6e58f951891a6bdf10f289520f`；
registry HEAD/GET、manifest SHA 与 RepoDigest 一致。02:53:47 UTC 仅 buzz-web 替换，
其余容器 ID/image/state 比对一致；新容器 healthy、匿名入口仍为原 OIDC 302。
Win source `a5a15c115d9ca77aae3bde19ce9a3cb12f14f013c874cc1e8e6b3b5b2af73c70`
（2259 输入），原生 x64 NSIS 包 15,112,383 bytes，artifact SHA
`526e951cfeb5e0f651c108aad0542a936339bef857a145e76cd755122c474194`。
源码摘要与 Cargo.lock 前后均一致；unsigned 签名 SKIP，未作 Win11 安装或设备验收。
原件目录 `/volumes/data/kailo/tmp/codex-agent-mention-client-delivery-20261004.yz97Gk/`，
`handoff.md` SHA `0b682a520ad72286b019dc1a4a17568384072f4e1cd21eadc7d2ce48c357bb62`；
Web helper log SHA `20b568da97ba3361d50443feba0b4bd7b44c25a4b26fe829b2da4d043efae607`，
Desktop helper log SHA `d52541fb9dc7dbfe50d549358e4d2b2c7ed8d3fc1a2c7e07a7072303e30686eb`。
编译、来源与服务健康不解除上述 trace/usage/回复终态缺口或三端生产门禁。

## 2026-10-04 03:11 UTC：原生 trace 传播缺口的限定修复（未部署）

首个已接受 mention 的 Invocation `4cfe99fe-1e45-46d2-834b-411027412a9d`
已有原生 completed turn；Gateway HTTP 200 记录
`01a104db-1d99-7e81-9e50-e28a0baff358` 的 input/output/total 为
8726/37/8763，原生 usage_outbox seq=1，但 request 与 dispatch 的 trace 均 NULL。
Core 冻结 trace `c0cf9530367e4505860a9e4eb1a0108a` 因此不能归因；
Invocation/回复/用量不宣称完成，不按时间或 Principal 回填原生引用。

四步影响：权威仍是原 Codex W3C propagation 与 Gateway durable usage；
只改 Runtime 的原生配置投递及 config/read 查证，复用 Core 既有
`OTEL_EXPORTER_OTLP_ENDPOINT` 的 HTTP `/v1/traces`，不新增身份或关联表。
副作用仅启用既有 Collector trace pipeline；原生 log/metrics exporter
显式 none、log_user_prompt=false，不采用上游 Statsig 默认外发。
缺配置、未知协议或回读不符拒绝初始化；旧 NULL trace、单次 Delegation
uses=1 与已发生的 8763 tokens 保持不变，本次不再发消息或模型请求。

固定 Codex `7498521d288b9b3b96ffba4eedf089d8d6e06a84`：
`codex-rs/core/src/config/otel.rs::resolve_config` 默认 trace none；
`codex-rs/app-server/src/otel_reloader.rs::layers` 只有 tracer 存在才装层；
`codex-rs/otel/src/trace_context.rs::span_w3c_trace_context` 与
`codex-rs/http-client/src/client.rs::trace_headers` 消费当前原生 span。
配置 enum/字段来自 `codex-rs/config/src/types.rs`；
原 `Config::additional` 保留 config/read 的 otel 字段。

复用原 10ad SDK，4 CPU/8 GiB、memory+swap 8 GiB、Cargo16，执行前原
container-safety 预检通过。原目标
`cargo test --manifest-path core/Cargo.toml -p platform-core --bin platform-core agent_runtime::activity_tests -- --nocapture`
退出 0：7 passed、1 既有隔离 DB 专用场景 ignored。私有源码把实际
native_trace_verified 改为无条件 true，同新增目标真实失败 101；
逐字还原后原目标再过，`cargo clippy --manifest-path core/Cargo.toml -p platform-core --bin platform-core -- -D warnings`
及私有单文件 rustfmt --check 均 0。未重跑 Core full 或数据库锁场景。
已部署 Codex 原二进制 SHA
`be14b6a4245d2e416727c0afc6f28bc8c953c2cb054ff84b39c8877d06116265`
在同 SDK 独立 CODEX_HOME 仅 initialize→config/read，生产 guard 的字段
实读一致、退出 0；未创建 thread/turn、无模型凭据。首次私有断言因 native
额外默认 headers={}、tls=null 的字典精确比较退出 1，保留原件；
改为与生产相同逐字段断言后通过，未据此修改生产配置。

全部原件在 `/volumes/data/kailo/tmp/codex-agent-invoke-20261004.yK1eTV/`：
`trace-runtime-restored.log` SHA
`4c868ac837eb9c2a39d0fb344cd9758927016d75db9a52c45da99d66a69d91a0`；
`trace-runtime-mutant.log` SHA
`536d942a0b0e95fd7a7346db851b06f9b53416b2b48a677c7a7a138da7ed59f4`；
`trace-native-readback-final.log` SHA
`d3af2876cc405516308d8cdf3616809026e14693cb89dc26b87f29da88d7dd51`。
owned canonical 仅 Runtime +94 行及 07 §1 表项 +1 行，排除两文件继承脏改；
SHA `5091c93307bce1d1b19d1999f34ecbbcfdbc9aea023480e96e7e99c40782630e`。
本次原生配置回读不等于修复后真实模型 E2E；下一次受权回合与旧回合未知账须分别验收。

后续隔离传播实证复用同一原生 Codex 二进制与独立 CODEX_HOME，模型及
Collector 均指向私有回环接收端，无生产凭据。RPC fixture trace
`8b11ad9ac81e44adb400e31740cfd354` 与唯一模型 HTTP 的 traceparent trace ID
逐字一致；接收端明确 HTTP 400，Authorization 不存在，生产模型调用 0。
进程与接收端已退出。这只证明原生传播接缝，不代表模型或业务成功。
原件 `trace-native-http-propagation-final.log` SHA
`cb771d4ddbde8de045b43194889137dc07f166dd80f53e8353b632567f69e1cd`，
同上 yK1eTV 目录。首次 inline 命令因 shell 引号错误退出 1，未启动子进程；
修正私有命令后实证退出 0，生产源码不变。

集中检查树 `02cac43772830864fd8da1c3d3e301d49b9fca1a` 的原
`./tools/check.sh --full` 退出 1：四语言静态与测试、契约兼容、Workflow replay、
seam、安全边界及文档检查通过；14 条 Core trace 的发布产物证据没有投递到
检查挂载的正式 ignored dist，报“digest 在 dist/ 中没有对应的发布产物”。
不将该结果改写为通过，不改变门禁；实际数据库演练及部署配置检查分别因
未投递 DATABASE_URL、deploy/local/.env 而 SKIP。原日志
`/volumes/data/kailo/tmp/codex-mention-selected-20261004.YtxgqE/full.log` SHA
`6c0f95d646cf79b7e5ec6481f0070756345c3cc78e7abfd6937f6aaa26b57cf6`。

原两份 Core SBOM/provenance 核对 b282 源 commit、cae700 产物及 ad13 Runtime 后，
仅复制到正式 ignored dist 并 cmp 通过，未重建或修改检查规则。包含上述证据追加的
树 `311a29212fae412900e4cd5ebe157b3893b9ac02` 再运行原 `./tools/check.sh --full`
退出 0，末行“全部通过。”；29 个产物 digest 的 SBOM/provenance 与锁摘要一致，
18 条追溯、144 schema 兼容及四侧验证通过。实际数据库/配置 SKIP、隔离数据库
专用 ignored、未安装 gitleaks、Win11 未签名/设备未验收及 Mobile 签名缺口保留。
日志 `full-proof-delivered.log` 位于同一 YtxgqE 目录，SHA
`0324567501ad15d1e3eb0f83f7b5367816e40f0e42a8ac7d02d4f0f4633b6f2b`。
本段只是检查后追加回执，随后走原文档检查，不再次编译。

### 03:47 UTC 部署后原浏览器读回

Runtime 修复已提交并普通 push 为 `99dd3ebba3d278ca2c373b390909d72c0a4d5cbd`。
仅 Core 部署 `sha256:50bd7f19299544399da452481be06ff312dd11c486ccaff8edbbe691cccafd16`；
构建、原生回读及部署边界见发布记录。原浏览器 OIDC→BFF 只读脚本退出 0：
同一 Installation ACTIVE generation 1/resourceVersion 3/configHash 不变；
原 task RUNNING/BILLING_UNAVAILABLE，原消息一条、关联回复零条；原委托
EXPIRED version 2、uses 1/maxUses 1。没有 POST、重发消息或模型请求。
原件 `/volumes/data/kailo/tmp/codex-native-trace-core-delivery-20261004.7a3Hd1/bff-after-core-read.log`
SHA `2edb5ebc7f84af2d4b6fc91de11f9f424fd2e0e999752d0e5ebf1f16e52479cf`。
本结果证明部署后原身份/安装仍可读，不证明旧未知账恢复或新模型回合完成。

## 2026-10-04 04:01 UTC：新受权回合 trace 贯通，缺少 assistant 终态正文

原部署 `99dd3ebba3d278ca2c373b390909d72c0a4d5cbd`，Core 镜像
`sha256:50bd7f19299544399da452481be06ff312dd11c486ccaff8edbbe691cccafd16`。
同一隔离验收 Tenant 使用独立单次 Delegation
`c8b46dff-4116-4891-a597-5b66c403c989`（maxUses=1，05:00 UTC 过期），
原生 OpenMeter 临时 grant `01M42H46PRDAX03ZGNCPZ0546Y` 为 10000 totalTokens、
一小时且不续期。新 grant 创建 201；BFF 委托和原页面单次 mention 发送均退出 0。
未扩展旧委托或旧预算，未改 sole `.env`、生产默认额度或治理准入。

- 源事件：`d0b497817e3b5c421309f6b89502bc31b973b8df80fa9e80dc1db0eb674e01c6`。
- Invocation：`b74498cd-a9f6-48ea-8b7d-7ed592ea8e79`；ActionExecution：
  `e37f1f27-e4c1-499f-98ab-7719795c3d3e`。
- 原生 thread：`01a10512-94fa-72f0-a271-bdf4cf5aa8c2`；turn：
  `01a10512-9812-7f82-a6b2-6f6476ae1412`。
- Core / Gateway request / durable dispatch 三者 trace 均为
  `314bb1b1d4cf4c6cbab5a06ad7d2bda4`；Gateway 稳定 request ID
  `01a10512-9853-7d23-b116-08193ed383de`，outbox seq=2。
- Gateway HTTP 200，input 8740 / output 132 / total 8872 tokens；
  原生 task_started 时间 1791086467，task_complete 时间 1791086472。

04:02 UTC 读回 native_status=completed，但 Invocation 为 RUNNING、
waitingReason=UNKNOWN_EXTERNAL_RESULT、reply_event_id 为空、usage_event 0，
Delegation uses=1。原生持久 history 仅 UserMessage 与 Reasoning，没有
AgentMessage；task_complete 的 last_agent_message 为空。04:10 UTC 原 lease
为 UNKNOWN，native_release_confirmed_at 与 terminal_event_id/at 均空。
这些观测不构成已回复、已计量或业务成功，不能从 HTTP 200 猜测终态。

当前路由的 provider formats 为 responses，baseUrl 为用户指定模型服务的
`/v1`，实际请求 `/v1/responses`，是 Responses→Responses 直通而非 Chat 转换。
原 request log 没有 payload；按原生 response ID
`resp_ba35dd7743a1d41f` 只读回查返回 404 / invalid_request_error。
现有证据不能区分 provider 只输出 reasoning 与流缺少可识别消息事件，
因此不在 Gateway 猜改转换、不公开 reasoning、不补造 assistant 消息、不重发模型。
该历史响应进一步判因需要原始 SSE 或 provider 已有日志；2026-10-04 用户明确
该服务为第三方，无法提供服务端权限。该证据缺口保留，不再向用户索取其没有的
权限，不据此停止独立客户端、自动化和组件开发。后续受权新调用的兼容性查证
只使用 Kailo/Gateway/Codex 可观察边界；它不能补证或重放本次历史回合。

原件目录：`/volumes/data/kailo/tmp/codex-agent-invoke-20261004.yK1eTV/post-99dd/`。
`native-terminal-shape.log` SHA
`0e0e1d06deed807356ac6ab55b71fc46f4cd774e0c250ddf898e17a4e4ad1ec9`；
`gateway-response-shape-5.log` SHA
`3e0bbfa4c6b5523b27fe29c0fd0b426f57b369f945409ff894774ba60672d1ed`；
`provider-response-readback.log` SHA
`9c48a3c32991757128faea957c7a019dee4fceb282e0170cad4097836e2647ae`。
首次浏览器只读命令因私有 browser-tmp 目录不存在而在启动前退出 1；
补齐目录后原命令退出 0，不曾因此重复发送业务消息。

### 已写入的原生回复兼容修正：四步影响与边界

1. 权威：固定 Codex `7498521d288b9b3b96ffba4eedf089d8d6e06a84` 的
   `codex-rs/app-server/src/thread_state.rs::ThreadState::track_current_turn_event`
   选择最后一条非空 `final_answer` 或无 phase AgentMessage；
   `codex-rs/protocol/src/models.rs::MessagePhase` 保留旧 provider 的可选 phase。
   Core 原先要求唯一显式 final_answer 是适配错误，不是新增产品语义。
2. 影响面：只修 `agent_task::native_reply` 的原生 full-history 消费及其原测试；
   Web/Desktop/Mobile 均消费同一受治理 Relay 回复，不新增前端或契约字段，
   无数据库迁移、旧格式迁移或新存储权威。
3. 副作用：completed、原生时间、唯一 Invocation/turn 关联、消息 ID、错误与
   async question/delivery 守卫不变；不将 commentary 或 reasoning 当回复，
   不改变回复签名、审计、权限、Relay 发送与查证路径。
4. 异常：空回复仍 UNKNOWN；合法缺省 phase 与未知枚举区分，未知字符串或
   非字符串/非 null phase 仍拒绝；多条合法消息按原生最后非空规则消费。
   本次 reasoning-only 回合仍不能提取回复。实现之后补原测试，实际运行结果
   另记；本节不宣称编译、验收、发布或部署通过。

### 2026-10-04：原生终态独立释放与计量的实现后验收

1. 权威：`.design/11` §2–4 将 Capacity、实际 Usage 与回复结果分开。
   原调用在 `publish_reply` 不可核验时提前返回，既未结束 holder Activity，
   也未进入 `committed_turn`；上述实际 completed/UNKNOWN/usage 0 证明该死路。
   修复沿原 native turn CAS → `begin_release` → 原 Activity terminal 对账
   → RELEASED → 同 `committed_turn` 精确请求全集/stored_at → 原回复/业务终态。
2. 影响面：仅 `agent_task.rs` 的 observe、终态提交与回复 Activity 校验；
   不改 Capacity/Temporal 权威、Gateway correlation、计量 identity、Workflow、
   schema、注册目录或旧游标。终态提交仍同事务重核原 scope、turn、lease、
   UsageEvent 全集与 stored_at；原生回复兼容修正一并验证。
3. 副作用：原生执行结束即请求释放；只有原 Activity terminal 证据才能归还
   units。后续回复使用已 RELEASED 的原 lease，不再占 runtime slot；两处
   发送前校验仍核同 Invocation/generation、当前 run/Activity 的真实 Started、
   精确 attempt、native heartbeat 与 cancel，再执行原两道 fresh 授权。
   所有用量仍来自既有 durable Gateway 请求，不以 reasoning/通知伪造回复或账。
4. 异常：缺时间/回复、计量不可用不再扣住已结束 runtime 的 slot；缺/未知
   Activity 仍 fail closed。缺 final message 仍 UNKNOWN，不改为成功；缺 trace
   的旧 seq=1 不归因、不跳过，新 seq=2 也必须取得原完整计量证据。此修复
   尚未部署，未声称两笔真实 UNKNOWN 已自然收敛或产品端到端已成功。

冻结基底 `aa19c8fe39cb7e71aa01c354a4a121e05c881998`，单模块私有树
`fbd6d83689777cc2f188833b9cf917d64042a373`，260+/66−；不含在写 Schedule、
共享审批 TS 或继承脏改。沿原 SDK `10ad51a…`、4 CPU/8 GiB/no extra swap、
Cargo 16，04:19 预检 MemAvailable 41.35 GB、memory PSI 0。实际命令：
`cargo test --manifest-path core/Cargo.toml -p platform-core --bin platform-core agent_task:: -- --nocapture`
初轮 12 passed/exit 0；包含 reply_tests 9 项及 RELEASED 后 Activity 身份/心跳
3 项。私有生产变异一恢复仅显式 final_answer，原目标 8 passed/1 failed/101；
变异二将精确 native attempt 改为任意正值，原目标 2 passed/1 failed/101。
两次均 apply_patch 精确还原、cmp 0；最终同目标 12 passed/0、
`cargo clippy --manifest-path core/Cargo.toml -p platform-core --bin platform-core -- -D warnings`
退出 0（23.29s），原 rustfmt 单文件 check 0。第二变异首次执行因容器名末字母
大小写误写而 exit 1，未进入 Cargo；纠正到原容器后的 101 才是有效破坏证据。

原件目录 `/volumes/data/kailo/tmp/codex-installation-runtime-rootcause-20261003.e4agxD/terminal-settlement-9CWZMX/`：
`agent-task-final.rs` SHA `0e12f6b08127af2dc9870e67669b33015a27111ba5b5a8fe47a6bd840ea9fd91`；
`canonical.patch` SHA `ef66b2e13accda6fb7de2495cf894bd30fd7bc4de147c2f946d776939e954ddb`；
`baseline.log` SHA `98e90e903d7543c49dea38989958fcd341e7f868db0a8f1d019e9c7cd063dd87`；
`mutant-final-only.log` SHA `5f83edf804df68f96a30a8639719b612b97725872b49440f81d260261596600a`；
`mutant-activity-attempt-corrected.log` SHA `b783e21f34611ae47fc4cd14c70d5552ffda15f969c6bc36122382c9b656e66f`；
`restored-final.log` SHA `c69b1a4557956a7c36d4f85122238622ba99b25f88068d3f1d9d303a66e6eda2`。
这是源级定向与生产变异证据，尚非真实 Temporal release→OpenMeter stored_at→
Relay 回复端到端回执；没有新增模型请求、预算、授权或生产数据修补。

集中候选 `b92d74350a4057283748435000b4587c6a0ef251` 的原
`./tools/check.sh --full` 实际退出 0，末行“全部通过。”；候选相对 aa19
为 3 文件 +387/-67，不含 Schedule、审批 TS 或其他继承工作区改动。
检查镜像 `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
实际 4 CPU/8 GiB、memory+swap 同值、Cargo16、Data 缓存；执行前原预检通过。
144 schema 四侧生成/兼容、Core/Worker/TS/Dart 验证与 replay、18 条追溯、
30 个产物来源及原 seam 检查通过。实际迁移演练无 DATABASE_URL、部署配置
无 `.env`，均 SKIP；隔离数据库及显式演练 ignored、gitleaks 未安装、
Win11 签名/设备与 Mobile 签名仍缺，不宣称生产或真实业务通过。
日志 `/volumes/data/kailo/tmp/codex-terminal-settlement-batch-20261004.36Gp7X/full.log`，
SHA `6cb1196787da8593f6c445f68a6f9a2b5217be9335dff64cabace5a31b7ee70b`。
独立窄复核未发现该冻结修复窗口的新缺陷；此后只追加检查事实并走原文档快路径，
不重建镜像、不重跑整批编译，也不把未验证的并行 Schedule 纳入该通过声明。

## 2026-10-04 Session 首轮记忆三态消费修正

实现依据为 `.design/19` §4、§7，`DD-65/68/92`、`SF-BUZ-17`、
`SF-COD-16`，沿本追溯的 `SS-BUZ-ENGRAM/SS-COD-APP`，不新增记忆权威。
四步影响结论：

1. 权威：Buzz native core head/body 仍唯一持久记忆；Codex thread 保存已消费的
   运行上下文。原 `first_turn` 把 `None` 当执行阻断，偏离已冻结的 UNREADABLE
   语义；原 ABSENT 不投递引导，同样遗漏已有要求，不是新增功能范围。
2. 影响：`agent_task.rs` 的首轮调用、事务内冻结记忆匹配及上下文选择，
   `agent_session::fixed_core` 的首次/继续会话判定，及原 `agent_memory::observe`
   的前提与内容读取超时分类。`birth/read_core/agent_runtime::start_turn`
   已逐调用点核对；无契约、数据库迁移、Workflow
   类型或三端独立实现。Web/Desktop/Mobile 继续经同一服务端 Invocation 路径。
3. 副作用：FOUND 只消费原固定 event 的 profile；ABSENT 注入固定引导，要求先
   向当前 HUMAN 了解 identity/goals，任何 core 写入仍须原 memory Action 与
   所需审批，不注入上游 `buzz mem set` 命令。UNREADABLE 不注入任何记忆提示，
   不写、不覆盖、不重新选 head。上下文沿原 reserved key、kind=untrusted，
   不写入 AgentVersion developer instructions。
4. 边界：只有冻结为 UNREADABLE 且无 event 的 Session 可无记忆启动；FOUND
   取回失败、event 不同、未知状态与不一致 state/event 仍拒绝 dispatch。
   冻结 ABSENT 在重试时仍 ABSENT；DISPATCHING 后仍只查同一 native 请求，
   不重复模型执行。身份、scope、binding、SecretRef、投影、AE、Activity/lease
   与 fresh authorization 原门禁不放宽；读取失败不推断写成功/失败。
   失配沿原 RUNTIME_ADMISSION_UNAVAILABLE，结果不明沿 UNKNOWN_EXTERNAL_RESULT；
   UNREADABLE 本身是已定义的外部上下文状态，不伪装为认证或额度失败。

实现后窄复核发现同一 ACTIVE Session 后续 Invocation 也调用 `first_turn`，
故既有 FOUND 与新增 ABSENT 均须限制为 Session 首 turn，而非每次 Invocation。
同 scope/version/generation 的已持久 native turn 引用用于证明继续会话；
只有 thread 引用不能证明首轮上下文已消费。首次派发结果不明时不跳过或重注入，
准备 dispatch 时在原 Session 锁内复核，继续会话不重新读取 core。
另核到原外层 timeout 把 audit、密钥、NIP-11 投影读取超时也归为 Native，
这在允许 UNREADABLE 继续后会错误放宽安全前提。现沿同一配置截止时间分段：
前提超时仍 Binding/refusal，只有完成前提后的 native 内容超时才是 UNREADABLE；
不增加超时值、默认值或第二次时间预算。原报告的 Binding 错误也不被重分类。

重新核对的只读上游：Buzz commit
`779af8886caae1317b4de962082429867ab61503`，
`crates/buzz-acp/src/engram_fetch.rs::{build_core_section,fetch_core_body,decode_core_body}`
及 `ONBOARDING_NUDGE`；Codex commit
`7498521d288b9b3b96ffba4eedf089d8d6e06a84`，
`codex-rs/app-server-protocol/src/protocol/v2/turn.rs::{TurnStartParams,AdditionalContextEntry,AdditionalContextKind}`。
本次没有执行 `.references` 内容，没有新增 MCP 路径、memory 写入口、模型调用
或计量权威。实现后在原 binary 中形成 11 项相关断言（deadline 3、Session
phase 3、上下文及冻结复核 5）；执行结果按下述实际轮次记录，尚未提交或部署。

后续组合快照 `automation-schedule/apps` 的原 all-targets Clippy 已退出 0；
首次 Core binary 检查总计 110 passed/2 failed/4 ignored。上述记忆相关的 11 项
全部通过：超时分类 3、Session 首轮/继续/不明 3、上下文及冻结复核 5。
整轮仍为退出 101，两项失败在本批 CHANNEL 映射的旧 configuration profile
断言，不能把这 11 项通过外推为整批验收；生产变异、最终还原及 full 另据实际
结果收口。原件 `codex-automation-schedule-20261004.2uaAPZ/targets-baseline.log`
与 `core-corrected.log` 均保留。

## 2026-10-04 共用 Schedule 管理消费者定向证据

基底 `ed9cc16c89c2c82ec75487bb1d95de8e3fe63719`，该 UI 选定树
`2298a5dd56d20884dbe27b761430939362b1fbd4`，4 文件 +289/-20。
依据 `DD-107`、设计 03 §7/06 §9，沿原 Web/Desktop 共用 Agents 页面接入
SCHEDULE 显式间隔、偏移、catchup 参数和 CHANNEL 结果；不新增调度器或 Web UI。
只消费同 pin/generation 后端提供的 `automationResultTargets`，缺失、重复、
未知或不含 CHANNEL 时不允许创建/发布/启用 Schedule，不以该目录事实授予执行、
委托或额度。切换到 thread-only Installation 后，保留表单不能继续提交。
MENTION/CHANNEL_MESSAGE 仍使用 TRIGGER_THREAD；未知写结果仍只重查原冻结命令。
Mobile 只有同源生成文案，没有新增组件或编辑宿主。

原生 catchup 最小值来源为 Temporal
`d94e34a1ebba5410a2e7d07119a76896909591aa`，
`service/worker/scheduler/workflow.go::defaultTweakables.MinCatchupWindow` 与
`scheduler.getCatchupWindow`；无业务默认间隔、默认预算或假能力。
变更影响为原共享 React 消费者、TS 文案与同源 Dart 文案、原 pages 检查；
后端仍重复进行真实准入。非 Schedule 的旧持久 JSON 形状保留，schema 和四侧
生成由同批后端统一交付，单独 UI 树不是可发布整批。

原 SDK `10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
UID/GID 1000:1000，4 CPU/8 GiB/no extra swap、Data 源与缓存，原资源预检 0。
在固定快照使用原 `pnpm --dir client-kit/ts/platform typecheck` 与 `test`：
最终 7 文件、219 项通过，包括 Schedule 20 项及原审批 21 项。
私有生产变异把 TRIGGER_THREAD 错当 CHANNEL，原 Schedule 目标退出 1，
3 failed/17 passed；apply_patch 精确恢复、cmp 0 后同组合再次退出 0。
原 `gen-platform-i18n.py --check` 与 Dart format check 均 0。
首次 PATH 漏 Dart 退出 1、实际生成 enum 更名引起 TS2305 退出 2、固定快照漏
原 Tailwind fixture 退出 1，均保留；纠正投递及真实 consumer 后才得到通过。
选定 Dart 窄增量不包含继承的 locale/time-helper 改动，不修改原生成器。

原件目录：
`/volumes/data/kailo/tmp/codex-installation-runtime-rootcause-20261003.e4agxD/schedule-ui-EjsSpi/`。
`canonical.patch` SHA `8b4c30cd6cb99c0d556bb11cbebb9629dbd194a936e3eebbcb866d94206272fb`；
`mutation-native-target.log` SHA `bda37ebbea804cb7a038e407cf4a3ce12295f964b196b858beeb87f606b6f394`；
`restored.log` SHA `8199f3efc3ee0d1039239f17cf0978698465798de12e0769098e9aef9b4663f7`。
这是 shared consumer 与模拟 BFF 边界的定向证据，不是实际 Schedule 创建、
Temporal/Agent/Relay 业务端到端、full、产物、设备或部署验收。

## 2026-10-04 原生 Schedule 后端与 Worker 组合验证

本批沿 `DD-107`、设计 03 §7、06 §3.1/§9 实现 Temporal 原生 interval
Schedule，不建立 Core 计时器。新计划、暂停、恢复和删除沿原管理 ActionExecution
保存派发意图；UNKNOWN 仅 Describe 原 native ID，不重新创建。计划启动后的
首 Activity 核对 native scheduler identity、原生计划时间、输入与 Workflow 链，
同 Automation 与 nominal time 沿原准入和 Invocation 去重。Scope 生命周期
沿原 Activity 暂停/恢复计划，管理 PAUSED/DISABLED 不被恢复成 ENABLED。

影响面是 Automation 原管理/查询、Tenant/Workspace 生命周期、AgentTask 来源
及频道回复、原 Temporal/Worker 调用、七个新增与两个扩展 schema、四侧生成物
和同源界面。Schedule 来源显式区分于 BUZZ_EVENT，不伪造 Nostr 根事件；
CHANNEL 结果用真实 Invocation 引用防止同秒同内容碰撞。原普通消息输入和
Workflow 类型保留，ContinueAsNew 沿同一注册名与原 typed payload；计划续跑
只添加收窄取消的 `cancelPending`，不获得新的准入或模型派发权。

Worker 原先缺少准入 Activity 注册，且首准入 ACK 丢失后会过早退出；现均已
修正。只有明确的同源 admitted=false 才结束拒绝，transport/ACK 错误沿既有
有界 Activity 与 durable timer 继续核对，取消也须先找回原 Invocation 再收尾。
身份、scope、权限、委托、额度、Activity 与终态证据仍由原治理路径核验；
缺失或未知不降级为默认身份、重复执行或假成功。没有增加生产预算或模型调用。

组合验证原件目录：
`/volumes/data/kailo/tmp/codex-automation-schedule-20261004.2uaAPZ/`。
首次 Clippy 因直接引用未声明的 prost_types 失败；改用已引入的官方 proto
Duration 和标准 Duration 转换，不新增依赖。首次迁移错误地重复处理已经拆分
的来源唯一索引，纠正为保留现存索引后，第 61 条迁移 forward/down/up 退出 0。
`migrations-corrected.log` SHA
`16c97d29d91883a37976f7fae7e6565fc068bad57697a75d87b690d4928d606d`。
42 条主要 SQL、10 条变更 SQL 和 2 条 Installation reader SQL 的实际
PREPARE/ROLLBACK 均通过；它们不是生产 Schedule 端到端。

修正两项旧 CHANNEL 映射期望后，原 Core binary 112 passed/4 ignored，
Bridge 8 passed，Worker 全包及既有 replay 全部退出 0。
`targets-corrected.log` SHA
`b9cc5e83ce773b46ca95a228fbe61f7a42d4a81b39f139234b63427a2ce3e668`。
私有生产变异移除 interval 下界、降级前置超时和移除记忆 phase 守卫，原检查
实际 109 passed/3 failed/4 ignored、退出 101；
`core-production-mutation-corrected.log` SHA
`af514c6e7db52eaf45b91927a05fcb80594b1129790a51b5754195cbac2357d4`。
把准入错误改成直接返回，原 Worker 三项确切失败、退出 1；
`worker-production-mutation.log` SHA
`420a6b7dbbfaca9a3ddced8ba9311774d5d49801e95b9bd2da87546d81bb7b86`。
错置 CHANNEL 的 Invocation 引用也触发原断言失败、退出 101；
`bridge-production-mutation.log` SHA
`4ceef78347829f3b8b38169e23750da336c81d6000715d9aa0f516bbd89e7d08`。
生产源按原字节恢复；最终修正后的验证结果另记，不把首次通过冒称最终全量。

交叉复核另发现 native Describe 会规范化 Keyword 搜索属性元数据和 NORMAL
TaskQueue kind，导致未显式构造这些字段时 exact action equality 永远不成立。
本批按原生字段修正构造，保留严格比较；另修正 Session 对明确派发前拒绝
与真正未确认派发的区分。两者不改变上述初轮结果，也不伪造已部署回执。
对应只读证据已重新解析：Temporal commit
`d94e34a1ebba5410a2e7d07119a76896909591aa`，
`service/frontend/workflow_handler.go::{validateStartWorkflowArgsForSchedule,annotateSearchAttributesOfScheduledWorkflow}`、
`common/enums/defaults.go::SetDefaultTaskQueueKind`、
`common/searchattribute/search_attirbute.go::ApplyTypeMap`。

最终冻结恢复回执：原 SDK session 45703 实际退出 0，Core 113 passed/
4 ignored（Memory 11 项均通过）、Bridge 8 passed、all-target Clippy
`-D warnings`、Worker 全包、原 replay 及 6 项新增 AgentTask 断言全部通过。
`targets-restored-final.log` SHA
`b52ad3d6b1636f20c9548a34142e7eaf5f69992c0213dc73953dcaa402c01a0b`；
37 路径生产源清单 `source-final.sha256` 的 SHA
`d07747ba6aa88605491450112ec1d5022f8ea6f2897190fde11c0dd4b9af1cee`。
两次 native Describe 形状生产变异（旧 Normal/Keyword 值与单独错误 metadata）
均实际退出 101，原字节还原后上述最终检查通过；不是仅比较自造成功常量。
最终 canonical 相对 ed9 为 37 路径 +3698/-328，SHA
`552a64b21ba851d26b832f0381409591e4e04486a7971d2f09b8476b3812570a`，
干净原生 ed9 导出 apply check、路径集合比对及 diffcheck 均 0。

明确派发前 FAILED 的排除只针对同 scope 的原 `agent.invoke` AE
`ALLOWED/ABORTED`、turn/native status/reply 全空且无 model trace 的事实；
不能泛化为所有 FAILED 都没执行。生产 SQL 在隔离库实际 READ ONLY
PREPARE、EXPLAIN、ROLLBACK 通过，未造业务对象或冒称真实状态迁移已验收；
`memory-phase-final-prepare.log` SHA
`d7827bcd09535f7e73b44602f4b72a25852f8db1f6c465f4ccfeeecc6af85d45`。

这次阶段源码提交/push 不等待 Win11 安装包，不把产物检查变成普通 push
前置动作。Web 固定客户端输入树 `644b04df139a67f1e63198464805bd2366a1a003`
原 helper 已退出 0，registry HEAD/GET 均 200，独立 manifest 摘要均为
`sha256:12dea304f8d399c5a27cee861efb97eb5222aff43a9d0e0eac425455a2b30aa1`。
Win11 原同批 helper 仍执行；本批原 full、设备及实际 Schedule/Agent 业务
未完成，不将定向检查、registry push 或 Git push 写成生产就绪。

### 同批客户端产物终态与源码阶段提交

源码阶段提交 `e7a5e50bc176994e4e6c74850474a4e81ccba292` 已普通 push；
远端 main 独立读回相同完整 commit。相对 ed9 为 62 文件 +4370/-383。
上述“仍执行”是源码提交时点，不代表后续 Win11 构建失败。

同一固定客户端树的原 Win11 helper session 76507 最终退出 0，原 NSIS
安装包 15115840 字节，SHA-256
`4f1b6ed3c7522473119f28879fce7b78337a56923722df377c4e2ab6b461a430`。
来源摘要 `58c65dbf0a054834445a37bb273b762bff81ff11d9c2adb3a2c424ca7d5b369a`
包含 2259 个实际输入；构建前后来源与 Cargo.lock 比对均为 0。沿原构建入口
和既有受限 builder 执行，未更改配方、并行度或限额，未重复构建。
原日志位于
`/volumes/data/kailo/tmp/codex-schedule-client-delivery-20261004.JRVeHM/desktop-client-helper.log`，
SHA-256 `0c5c232bb661903ee0ed2347a878a17306d8edae77dfcc9c32fd2b92e41505f4`。
安装包已复制到正式 ignored dist 并逐字比对；替换前文件保存在
`/volumes/data/kailo/tmp/codex-schedule-final-20261004.sbZpN7/desktop-client-before.exe`。
只选入 Desktop 来源记录的 source/artifact 两字段，没有夹带继承的其它来源改动。
Web/Desktop 共用平台主体未分叉；Mobile 没有新增组件或文档编辑宿主。
本节仅记录构建终态：Win11 未签名、未作设备安装或业务验收；Web 未因构建
自动部署，真实 Agent 回复与 Schedule 业务终态仍不能由安装包摘要替代。

同批固定候选 tree `d1a691e5f3a72c6b67dcab2f17a5b9a1cb9b1c11`（e7 源码、
上述 Desktop 两字段与交付说明）的原 `./tools/check.sh --full` session 52688
实际退出 0。检查镜像仍为
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
4 CPU/8 GiB、memory+swap 相等，Cargo jobs 16 与 Data 缓存由执行配置投递。
151 schema 四侧同步和历史兼容、Rust/Go/TS/Dart 验证、原 Workflow replay、
18 条追溯、来源/安全/文档检查通过；日志
`/volumes/data/kailo/tmp/codex-schedule-final-20261004.sbZpN7/full.log` 的 SHA-256
为 `29b390e97b0b2f488352188cb3ba30ed67b12951c06c4fe7d75c748907c439fc`。
实际数据库演练（无 DATABASE_URL）和部署配置预检（无 .env）均 SKIP；
显式隔离场景仍 ignored、gitleaks 未安装、客户端签名与设备缺口仍保留。
同批另发现 Mobile 原读取器拒绝 CHANNEL、详情页将非 MENTION 显示为频道消息，
且仍引用旧生成枚举；该 Flutter 具体消费者不在上述生成库检查覆盖范围内，
修正进入下一源码批。本节不将 full 0 外推为 Mobile 页面或真实模型回复通过。

### 2026-10-04 06:18–06:31 UTC：固定 e7 三服务部署与原回合结算读回

固定源码 `e7a5e50bc176994e4e6c74850474a4e81ccba292` 的原
`tools/release.sh` 一次顺序构建 Core、Worker，session 45439 实际退出 0；
没有混入后续 MCP/Mobile 开发，也没有重建 Runtime。原 builder
`kailo-core-data` 实际 8 CPU/16 GiB、memory+swap 相等，Data 缓存不变。
Core 复用 Runtime `ad13c952e20c134c70cc4ba0293e2d568aa98641fe16ede4cceb2671d10887ec`。

| 产物 | SHA-256 |
|---|---|
| Core | `2052ea7ea693af5755b61746744ef6fb61128b33eeff34054b225131f0002df2` |
| Worker | `a393942f72249da5d3d5593913771df0da1e6258bd22c6c78d38d163a991f9ca` |
| Web | `12dea304f8d399c5a27cee861efb97eb5222aff43a9d0e0eac425455a2b30aa1` |

两镜像 registry HEAD/GET 均 200，header、manifest 字节 SHA、RepoDigest
一致；原 SPDX/provenance 两组的 subject、e7 commit、锁摘要与 Runtime
参数查证通过。四个原件复制到正式 ignored dist 后逐字比对 0，未删除旧证据。
Web/Win11 来源为同批固定客户端树 644b04df；Win11 原 helper 0、包摘要
`4f1b6ed3c7522473119f28879fce7b78337a56923722df377c4e2ab6b461a430`，
仍未签名、未作 Win11 安装或设备业务验收。前述 full 0 与
`dbd53da14baddae7f93e850cca4db7147f318093` 收口记录不被改写为业务成功。

部署前只读证明：在线 60 条迁移全成功，AutomationDefinition、enabled、
Schedule reference/version 都是 0；仅两条原 Invocation，native 均 completed，
Capacity 均 RELEASED，未确认 native 回合数为 0。三目标服务环境在内存中逐项
与既有容器比对无变化，sole `.env` 与 runtime profiles 前后 SHA 相同。
仅调用原 `migrate_core_database` forward 05000 到 61，实际退出 0；
无 down、seed 或业务 SQL 修改。存在 Schedule 引用/history/intent 时原 down
明确拒绝，本次未执行回滚。

原 `start-core.sh --no-build` 首次在最前 registry 只读检查因私有 `.design`
路径缺失而退出 1，尚未取 wrapping 或替换 Core；确认旧容器未变后，投递原工具
已有的 DESIGN 路径，原入口带新 OpenBao wrapping 退出 0。随后原
`compose up --no-deps --force-recreate --no-build worker` 退出 0；两者就绪后
才同样替换 Web，退出 0。06:18:44 Core `9754e340…`、Worker `4cd61e31…`
running；Core healthz 200、唯一 Codex 子进程恢复，Worker 原生 Started Worker
记录为 kailo-component-task。06:20:46 Web `123391a4…` running/healthy，
镜像原 healthcheck 端口 8080 上 `/app/healthz` 与 `/app/` 均 HTTP 200。
第一次 HTTP 探测错误使用 80 而 connection-refused，按原镜像端口纠正后通过，
没有因此重启服务。平台范围仅这三项替换，其余 25 个平台容器及 5 个数字人
容器的 ID/image/status/StartedAt 均不变。全 Docker 比较另观察到并行 Mobile
SDK 容器独立替换，故不声称所有 Docker 容器未变。

06:28:42 Core READ ONLY 与 06:30:30 Gateway READ ONLY 进一步核实：

- b74498cd 原 Invocation/Task FAILED、Workflow TERMINAL，native completed、
  cancel_pending=true、reply 为空，原 turn ID 未变。唯一模型 SUM UsageEvent
  `25653806-ee26-54fe-802c-65822e059c2c` 对应原 Gateway request
  `01a10512-9853-7d23-b116-08193ed383de` / seq 2，数量 8872、COMMITTED，
  stored_at 为 05:00:44 UTC。06:31:18 原 OpenMeter 精确 source/id/subject/type
  GET 返回 200、唯一同内容事件、totalTokens=8872、validation_errors 0。
  该时间早于本次部署，不将既有结算倒记成本次新执行。冻结 Action 为 agent.invoke /
  CHECK、无 COUNT 投影；不能把模型 SUM 结算说成 STRICT reservation 或调用次数收费。
- 旧 4cfe99fe 仍 RUNNING/BILLING_UNAVAILABLE、无 UsageEvent/回复；原 Gateway
  seq 1 的 request/dispatch trace 仍均 NULL，8763 tokens 事实未改。
  `agentgateway-durable-usage-tail` cursor 仍 0，更新时间仍为 10-03 00:54:58。
  RB-06 的未归因阻断仍在，不按 principal/time 猜归因、不跳游标、不重放。

04:01 原生 history 的 UserMessage/Reasoning、缺 AgentMessage 和空
last_agent_message 证据保持成立。现在可以确认真实 8872 用量已经存储并收口为
失败任务，不能宣称已有真实 Agent 回复。缺失原 provider SSE/body 的既有回执
不足以证明 Gateway 丢失 assistant，也不足以指定新的转换修复；本轮不猜改源码。
没有新增预算、Delegation、消息、模型调用、Automation/Schedule 或旧 UNKNOWN 重试。

原件目录：
`/volumes/data/kailo/tmp/codex-schedule-core-worker-delivery-20261004.na5lep/`。
`release.log` SHA 为
`1d4876e83a07cf0514971b30b38384307a0af019c653c78724a4ff7f8e8c657d`；
`handoff.md` 保存全部构建、迁移、部署原命令和真实失败边界；
`settlement-readback.log`、`gateway-usage-readback-corrected.log` 与
`openmeter-stored-usage-readback.log` 保存上述最新只读证据。

### 2026-10-04：共享 Tool 目录与版本引用消费（源码，尚未部署）

本批直接扩展 Web/Desktop 共用平台包，没有新建 Web 页面副本。目录只消费
生成的 PlatformToolPage；版本保存实际
选择的 Tool 引用，不再固定写空数组。PROVISIONING、无 consume 权限或无法查证
的引用不能提交；旧引用保持可见，必须明确移除，不静默丢弃。Skill 入口仍关闭。

- 权威与影响：DD-24/49/105、设计 17 的声明/绑定/执行分离；BFF 是目录写者，
  共享 TS 是管理消费者，Dart 文案由同一 TS 原生成器产出。未改业务契约正文，
  消费后端本批四侧生成物；Mobile 未增加管理动作、组件宿主或编辑入口。
- 副作用：只读目录与版本引用不授予记忆读权限、ToolBinding 或 Delegation。
  复核发现 Tool 创建动作没有冻结策略，已撤掉共享页登记表单、写入命令及专属锁；
  不用实施裁决补充设计权限，不改 `.design` 迁就实现。
- 边界：分页可为空但必须单调，未知枚举/无效摘要/重复资源拒绝；跨页选择保持。
  BFF 客户端身份更换时由共享 Provider 重建消费者子树，旧异步回执不进入新身份；
  语言变化不改变身份。错误仍消费既有六类分类，403/404 与 UNKNOWN 分开显示。

以下是撤回登记表单之前的历史验证，不证明撤回后的最终候选通过。
固定 SDK `10ad51a2…`、4 CPU/8 GiB、无额外 swap、Data 缓存内执行原
`pnpm --filter @client-kit/platform test`：类型检查及 237 项检查退出 0。
初轮曾 230 通过/4 失败：新目录把确定的 403/404 误显示为 UNKNOWN；已将原
AgentReadFailure 收为共享 ReadFailure 并直接复用，未删除原断言。
私有快照实际移除 Provider 身份隔离、移除 UNKNOWN 拒绝保护，分别捕获 2 项失败，
两处逐字恢复后同一 237 项全部通过。原 `gen-platform-i18n.py` 生成及 `--check`
退出 0，正式 Dart 文件保留原有其他未提交改动，只合入真实生成文案增量。

原件目录为
`/volumes/data/kailo/tmp/codex-installation-runtime-rootcause-20261003.e4agxD/tool-ui.AGEadQ/`。
恢复日志 `restored-final.log` SHA-256 为
`e903e5de3c692a9a5b59e922e905defee8a7393daa507111ed1db19b1e898fb4`；
两个实际失败日志为 `mutation-scope.log`、`mutation-unknown.log`。
本节不是 Core/MCP 端到端、整批 full、构建或部署证据，不提高业务完成状态。

撤回未冻结创建动作后，原 SDK 中实际生成的新 DTO 与共享 TS 原检查为
254 passed/8 files、退出 0。仅在私有生产 `tools.tsx` 重新加入登记 form，
原目录检查实际 1 failed/10 passed、退出 1；撤销变异并与正式源码逐字比较后，
同目录 11 项退出 0。创建专属检查随已删除的实现移除，未削弱目录/身份隔离检查。
原件为 `/volumes/data/kailo/tmp/codex-installation-runtime-rootcause-20261003.e4agxD/tool-create-withdrawal-fvG7yl/`，
`ui-baseline.log` SHA `e95c9bc3f95444b9a84561446b173fd5099dde217eb1f9284eb89cad95dc7952`，
`ui-mutation.log` SHA `873c41a72ae986ec2c024a28cf9c67237264860234cf53472e09d62cec2fcdc4`，
`ui-restored.log` SHA `5540f78cae0cac1850dbc430747fca6ab066667a255db771daaad44e2107e60c`。

### 2026-10-04：自身安装记忆读取授权消费（源码，尚未部署）

依据 `.design/05` §2.8 的 `resource.grant_read/revoke_read` 与 `17` 的
Installation 权限边界，共享 TS 直接复用原安装执行权限控件：授权目标来自
BFF 的确切 Installation 与 Agent，不允许浏览器另选 Principal；授予进入原
TARGET_OWNER 审批，撤销走显式确认。`read` 不代表 Tool `consume`、Delegation
或其他安装的读取权，不创建第二套权限权威。

影响限于生成的可选 `AgentInstallationView.readPermission` 的读取、共享权限
控件和同源文案。旧回应缺该字段时不渲染读取授权入口，字段存在但布尔值等形状
不合法时拒绝消费；无需前端数据迁移。与 execute 共用意图锁，避免同一安装上的
两种权限操作在界面并发提交；Core 仍重新判断权限、版本和状态。
等待审批不显示为权限生效，UNKNOWN 保留原幂等键与确切目标，刷新和后续 403
不能把原副作用误判为失败。错误复用原六类处理，没有新错误类别或默认授权。
Web/Desktop 仍使用同一主体；Mobile 仅更新原生成文案，不新增写入口。

私有快照从 `56ee0bbcfc5a8bcb0cd1b1e4e2c9dc985e39b6a3` 导出后放入本批真实
Tool/read schema 与共享源码，固定 SDK 内运行原 `tools/gen.sh` 四侧生成退出 0。
原 `pnpm --filter @client-kit/platform test` 的类型检查及 241 项检查退出 0。
随后在私有快照实际去掉命令的 `principalId`，两项检查失败、退出 1；恢复后再
去掉 `readPermission` 形状校验，一项检查失败、退出 1。两处逐字恢复并与正式
源码 `cmp` 一致后，原 241 项再次通过，`gen-platform-i18n.py --check` 退出 0。
正式 Dart 只合入该原生成器的九条读取授权文案，保留已有其他未提交改动。

证据位于
`/volumes/data/kailo/tmp/codex-installation-runtime-rootcause-20261003.e4agxD/tool-read-ui.HdaCOl/`：
`generate.log`、`baseline.log`、`mutation-principal.log`、`mutation-permission.log`、
`restored-final.log`、`i18n-check.log`；恢复日志 SHA-256 为
`3e695b18ec0a540bd7bc23a387f53e41a3cb3906d0f3cc7890a714fee49d9ab7`。
这是共享消费者的验证，不证明后端权限投影、ExtMcp、整批 full 或实际部署通过。

### 2026-10-04：原生 Memory 读取 Tool 消费与隔离 SQL 验收

本节为固定选定树 `bc33b124ef78d85ebea6ed1f2eb11214350e4fb8` 后的事后证据；
不改变旧部署、真实回合或历史检查结果。本批尚未部署，集中 full 结果由主线另记。

1. 权威：设计 03 §7、12 §3–4/DD-105、17 与 19 §5，支持既有原生
   `agent.memory.entry.list/read` 的治理消费。原候选自行登记的
   `tool.definition.create` 完整策略没有冻结依据，已撤回其生产者、命令字段和
   共享页入口；上述设计段落不能作为该创建策略的授权依据。
2. 影响：`agent_tool::{install_bindings,invocation_tools,tool_admission}`、
   `agent_tool_pep::Policy`、`agent_tool_runtime::configuration` 与
   `agent_memory::{prepare_tool_read,execute_tool_read,disclose_tool_result}`
   接入既有 Invocation、父/子 AE 同 Operation、独立服务身份及内存 Session 票。
   `gateway_usage::committed_turn` 同时核对模型事件与 child 两个冻结 meter；
   全部原生 stored_at、安装/turn/审计证据仍须可核验，未知来源不被过滤成成功。
3. 副作用：Tool Catalog 与 Binding 不授予 consume/discover/read 或 Delegation；
   read 仍走原 owner 审批生产者，执行前与披露前均重查权限。票据只在进程内及
   当前 thread 配置传递，不进入审计、数据库或日志；没有新增 Memory 写工具。
4. 边界：原零 Tool 路径无新凭据依赖；非空工具的显式 consume/discover 授权
   生产策略仍缺，NO_PERMISSION/fresh check 保持关闭，不暗授关系。同 turn、
   同工具和参数的原 DISPATCHED child 仍阻止重放，即使前次已结束也不猜新调用；
   固定 ExtMcp 消息不提供稳定 MCP 请求 ID，本批未建立第二调用标识权威。

固定 AgentGateway `1f7ebbf87cbdbe9517f6f181221879d04dc50692`：
`crates/protos/proto/ext_mcp.proto::{McpRequest,McpResponse}`、
`crates/agentgateway/src/mcp/guardrails/client.rs::{apply_header_mutation,build_metadata}`；
沿原 SET 后 REMOVE 顺序，响应 metadata 由原 CEL 显式投递而非假设自动回送。
固定 Codex `7498521d288b9b3b96ffba4eedf089d8d6e06a84`：
`codex-rs/config/src/mcp_types.rs::RawMcpServerConfig` 与
`codex-rs/app-server-protocol/src/protocol/v2/thread.rs::{ThreadStartParams,ThreadResumeParams}`。
原生 slug/hash 复用 Buzz `779af8886caae1317b4de962082429867ab61503`
`crates/buzz-core/src/engram.rs::{validate_slug,value_hash}`，不另造算法。

原 SDK 10ad、4 CPU/8 GiB、UID 1000、无额外 swap，Cargo jobs 16、Data target；
原 `cargo test -p platform-core --bin platform-core` 的 agent_tool、
service_auth::gateway_tests、capability_contract::registration_tests、
memory_tool_tests 与 usage_tests::memory_child_set_requires_both_frozen_meters_and_certain_same_turn
共 21 项退出 0；随后 Clippy 首轮 101，修正后原 fmt/Clippy -D warnings 退出 0。
私有候选合并破坏 Session sub、Gateway 最大 TTL、登记/审批分离三个生产守卫，
三个真实断言失败、退出 101；随后三源逐字恢复 cmp 0，恢复 canonical 交集中 full。
未额外伪报一次恢复目标或真实 MCP E2E。网络、编译、非法 slug 夹具与初轮 Clippy
失败日志均保留。组合原件目录：
`/volumes/data/kailo/tmp/codex-installation-runtime-rootcause-20261003.e4agxD/mcp-combined-jG0sIv/`。
`targeted-final.log` SHA `6bfb0a36f8e54d9667b7f44874cd11d5d858bd4adf3322ef0cb27967946b0c2a`；
`clippy-corrected.log` SHA `3142225800436720c3770ecfb6838b3852c71f53e4226392e638b15bc0d86463`；
`mutation-batch.log` SHA `54f51c6b6de4483c5ba86b007966fa16e6d03aecd5e946de33a700ed0207fac9`。

独占隔离库 `capability_family_rsfdrk`、PG `1ac30ea5e2af`，不使用业务库。
沿原 SDK/SQLx，仅把 DATABASE_URL 的 dbname 换为该库，执行
`sqlx migrate run --source /evidence/capability-family-RSFDrk/migrations`：
补 11000/12000，现 67 条 up 退出 0。再将原 12000 down、11000 down、
11000 up、12000 up 依次交 native `psql -X --single-transaction --set ON_ERROR_STOP=1`
执行，退出 0。隔离 Tool/usage 表为空，未删除事实；不能外推为有已发生工具用量时可回滚。
实际生产模块抽取的 105 条 SQL 在原 `BEGIN READ ONLY; PREPARE …; ROLLBACK;`
全部退出 0；两处参数按真实 Rust bind 指定 UUID/text 与 timestamptz OID，保留
此前裸 PREPARE 类型推导失败，不改生产 SQL 来适配证据。库与 SDK 已释放，保留供主线 full。
原件目录 `/volumes/data/kailo/tmp/codex-native-memory-tool-20261004.e1McEQ/`：
`migrations-up.log` SHA `df9995b2876c862576c57cf01f78a453d88928c874bb05726817744b9cca5788`；
`migrations-down-up.log` SHA `b06520b56d2fc4b75e9fda09150e3e1bbe6f8d558d71236850d39a67dc914a2c`；
`actual-module-prepare-final.log` SHA `2cc692f0e6d072da90ff464d762fe4428b2dfac81d88178bef0a2654ce841f82`。
没有模型、Memory 生产读取、MCP 两相运行、quota 业务或部署验收；不提高业务完成状态。

### 2026-10-04：原生 MCP 会话配置冷恢复纠偏

固定 Codex `7498521d288b9b3b96ffba4eedf089d8d6e06a84` 的
`codex-rs/app-server/src/request_processors/thread_processor.rs::resume_running_thread`
对已有订阅的 loaded thread 忽略新配置，原生同步 shutdown 超时也可返回 hot resume。
因此 resume 成功不证明 Session 票或工具集合已更新；只重复调用该 RPC 不成立。

影响限于 `agent_session::resume_for_dispatch`、`agent_runtime::refresh_thread`
及 Capacity 的原观察调用。仅确切 CREATED、无 turn/trace/native_status、无取消，
且同 Session 无在途或不明调用时，在原 AE→Tenant→Session 锁与 fresh 授权下更新。
观察、取消、Capacity 收尾保持原无配置 resume，不卸载执行现场或重启 Installation。

原生 idle 只允许 unsubscribe，ACK 不记为卸载完成。沿原 Activity 轮转，后续读回
同 thread 的 notLoaded 与完整 loaded/list 缺席，才用相同 ID 冷恢复内存配置。
配置投递存在但工具集合变空时同样清理旧集合；整组未投递的原零 Tool 恢复不新增依赖。
等待不写 Invocation/Session UNKNOWN，原 CREATED 仍可轮转；未知响应、部分列表、
活动 thread 或超时拒绝继续，永不发替代 turn。原生卸载由上述固定 commit 的
`codex-rs/app-server/src/request_processors/thread_lifecycle.rs::UnloadingState`
及 `unload_thread_without_subscribers` 执行，仅 Shutdown Complete 后移除对应运行实例；
没有新增定时器、会话权威、落盘票据或自设超时。

原 SDK `10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`
内，`agent_runtime::activity_tests` 9 passed/1 ignored；原隔离 PG 与真实 stdio
目标显式运行后 1 passed，Clippy -D warnings 退出 0。私有生产变异同时删除
ACK 停止与 loaded-ID 拒绝，两项断言实际失败、退出 101；原字节恢复 cmp 0。
一次性 `runtime_recovery_verify_cespor` 测试库已清理，原证据与其他演练库保留。
原件 `/volumes/data/kailo/tmp/codex-mcp-cold-resume-20261004.cespoR/`，
`targeted.log` SHA `1bff879dd99c0874a74dfe603d348333b64f364a7ff47438ad65a108a82e6ce4`；
`mutation.log` SHA `6fdd4e0ba49f7de5f853899044c4220cb4f6ccc46f2ea7366a4c3b5df058bb92`。
这是受控 stdio/隔离数据库证据，不是实际 Codex/MCP/模型业务验收，未部署或重放旧回合。

### 2026-10-04：撤回未冻结 Tool 登记动作后的迁移复验

前述 Tool 登记动作撤回后，重新冻结全部 134 份 SQL；09000–13000 的十份
up/down 与 `bc33b124ef78d85ebea6ed1f2eb11214350e4fb8` 逐文件一致，
08000 使用不登记创建 Action 的版本。此前含登记动作的迁移回执不外推到此版本。

在既有隔离 PostgreSQL 中新建一次性空库 `tool_withdrawal_final_verify`，
原 SDK 执行 `sqlx migrate run --source migrations`、六次原
`sqlx migrate revert --source migrations`、再次 migrate run，
成功迁移计数实查为 67 → 61 → 67，最终退出 0；Tool Action 目录读回为零行。
首次日志保留 67 次成功前进后 psql 取证连接配置失败；先核实已完成迁移，
只纠正连接环境再继续回退与前进，没有修改 checksum 或重放未明副作用。

各 down 的已存在业务事实拒绝条件仍保留；本次为空库往返，未重新执行有数据的
负向边界，不意味着已填充部署可回退。仅删除本任务一次性测试库，原生目录读回
已不存在；其他演练库、业务库、SDK 与原件保留，未部署。
原件目录：
`/volumes/data/kailo/tmp/codex-installation-runtime-rootcause-20261003.e4agxD/withdrawal-migrate.YFIUAq/`。
`migration.log` SHA `af13a6c8706e23d36cf9c7f0a93f7444de665c8dba5c99fff3add7e271bc579e`；
`down-up-complete.log` SHA `23bc274f701e1cf55391ad0f043baa63cc10895f3507914875afb1af526c7d9c`；
`source.sha256` SHA `5fa9fcf717644346319c7d961e9081a45069a54845532082dc9a7b919e8a3c41`。

### 2026-10-04：撤回后共享 Web 产物

固定源码树 `bc997abb306b2ffe62da32274460083a98187cfc` 经原发布入口构建 Web，
退出 0；101 个真实输入的 source digest 为
`sha256:6eb04fa249de1404f4b7346e61b024e01afa4e29878ed1f374961bdd7a8ec32f`。
artifact 为 `sha256:fd617659f3545e6f1d57d9fb12317220ee5ac6d1a2fcbbb56b1dee8df1ee4640`，
原 registry HEAD/GET 均 200，响应正文 SHA 与 Docker RepoDigest 精确相同。
官方来源清单、Compose pin 与十五份既有追溯引用同步，不手改源码摘要。
这仅是构建与来源登记，运行容器仍为此前 `12dea304…`，未部署。
原件目录 `/volumes/data/kailo/tmp/codex-tool-client-readonly-delivery-20261004.6CIKke/`，
`web-helper.log` SHA `bb8a8e2c415149d27d76b4b3ca36b4976cb30d25aa97172ebb07f7699e8a1832`。
Win11 打包与最终整批检查另记其实际结果，不由 Web 成功推定通过。

### 2026-10-04：原生 Tool 与能力契约整批检查收口

固定候选 `148a4b49bf8a0308167ed1799367145253a0f0c6` 相对
`56ee0bbcfc5a8bcb0cd1b1e4e2c9dc985e39b6a3` 为 112 文件、+10334/-445。
原 `./tools/check.sh --full` 在原 SDK 10ad、4 CPU/8 GiB、Cargo jobs 16 与
既有 Data 缓存内实际退出 0；未构建或部署新产品镜像。

- Rust/Go/TypeScript/Dart 静态与既有验证、151 个 schema 的四侧生成及兼容、
  原 Workflow replay、19 条追溯、六份来源与六个当前源码产物均通过。
- Core 单元 136 passed/4 ignored；另有审批续跑、Relay outage 两项外部
  演练 ignored。未投递 DATABASE_URL 或实际部署配置，这两步骤 SKIP；
  其他依赖外部配置而早返的检查不作为实际业务链验收。未安装 gitleaks，
  仅内置秘密扫描通过。Win11 签名/设备与 Mobile release 签名仍阻断。
- 前一候选 `55661145bf7635a6bec974dbbc269395e12d4844` 的 full 退出 1，
  唯一失败为 `07` 第 88 行 MD012 双空行。两树仅该文档删除一个空行，
  原失败不改记通过；没有通过改检查、缩减源码或改 artifact 摘要消除失败。
- 本回执追加后只运行原文档快路径；原生 Tool consume 授权缺口、真实 Agent
  回复、组件 release/binding 和三端业务验收仍未闭合，不因 full 通过而开放。

失败原件：`/volumes/data/kailo/tmp/codex-native-tool-final-full-20261004.KfFrg1/full.log`，
SHA-256 `2a6d6f333e13e0756f11eafce672c2a971c8c0a2dd060f2ae812f637e15caf3f`。
最终原件：`/volumes/data/kailo/tmp/codex-native-tool-corrected-full-20261004.EfWrnN/full.log`，
SHA-256 `8eb3c092fbf2504650183aa42de26420e8e7da6c5c4bf788f4c45f5b40450d0e`。

## 独立 Workflows 的本人运行历史（2026-10-04）

设计 `e0900662dea78a48c65cbfdd54508314947b8512` 的 `06` §9.1、REQ-23、
DD-107 要求独立 Workflows 与关联运行历史。本批后端 16 文件 +1092/-148，
已按窄补丁合入并逐文件 SHA 核对一致；尚未提交、构建或部署。

1. 权威与范围：沿原 ActionExecution、WorkflowRef、TaskProjection、UsageEvent；
   原 TaskView 为当前 HUMAN 本人发起的任务，不把 Automation 的 read 权限扩张
   为他人任务读取权限，页面标题为“我的运行历史”。
2. 影响：新只读 `/api/v1/automations/{resource_id}/runs` 每页重查 Workspace
   准入、owner/projection 与 FullyConsistent resource read。原两条运行生产者
   已冻结 Automation 为 AE.target_id，因此在数据库 LIMIT 前按 action、target、
   Workspace 过滤；不截取全局 Tasks 后再过滤，也不依赖 Invocation 必须存在。
   新增两份响应 schema 并由原生成器产出四侧；旧 Tasks 线格式与控制权限不变。
3. 副作用：没有新历史表、迁移、Workflow kind 或执行入口。进度只取原投影，
   用量只返回同 Tenant/Workspace/Operation 的 UsageEvent ID；引用存在不证明
   已结算，空集合不证明零用量，不输出消息正文、凭据或原始 Temporal history。
4. 异常：created_at/id 稳定倒序分页，游标绑定 Tenant/HUMAN/Automation/Workspace；
   非法或串 scope 游标拒绝，不回退首页。原 task_view 决定 UNKNOWN/投影迟滞，
   AgentTask 的 kind 缺省保持合法，不补造枚举；查询失败不渲染为真实空页。

隔离证据根目录为
`/volumes/data/kailo/tmp/codex-installation-runtime-rootcause-20261003.e4agxD/workflow-history-qWNMzd/`；
`canonical.patch` SHA-256
`d3fce4ebb4cb4b42687e17d40a7a79cb654835813698dee619f5eff0f395474c`。
使用同批现有 SDK `10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
实核 4 CPU/8 GiB/swap 0/UID 1000，复用 Data 缓存，没有宿主工具链或新构建。

- 原生成及 `--check`、既有 registry 生成/比对、Clippy 均退出 0；四语言各一项
  新响应往返实际通过，覆盖 UNKNOWN、进度、用量引用、游标与空页。
- `cargo test --locked -p platform-core run_history_tests -- --include-ignored --nocapture`
  实际 3 passed，含新隔离空库的生产 SELECT，而非只检查 SQL 字符串。
- 私有撤掉 target 精确谓词及 cursor Automation 隔离，实际 2 failed/退出 101；
  逐字恢复后 3 passed、格式检查 0。失败日志 `mutation.log` SHA-256
  `a97532f1fbbc0d98178938c6a25efb2d75a1c0cfb3e63874fe08d57929c2a1fd`；
  恢复日志 `restored.log` SHA-256
  `b277791f0c0d95a97eeb3e0db54cab10a0a553e5bab0f163d4fec675d581378d`。
- 初次生成缺输入和 PG 连接投递失败如实保留；纠正输入后通过，不据环境失败
  宣称守卫有效。唯一临时测试库已删除并读回不存在，可重新创建，不涉及业务数据。

这些是查询、契约及隔离恢复证据，不是在线 BFF/SpiceDB 授权、真实 Automation
运行、三端设备或整批 full 验收；用户可见页面与产物由同批另行交付。

## 2026-10-04：原生 Memory 子调用的用量入库修正

权威仍为 DD-65/67/105、设计 19 §5–6 的 Buzz 原生 Memory 与既有
Invocation、UsageEvent、Audit；没有新增记忆存储、检索器或工作流。
生产 `agent_memory.rs::record_memory_usage` 为 Agent 子调用写入父 Invocation，
但旧 `usage_native_source_shape` 要求 Memory 的 Invocation 为空，实际拒绝该行。
另一个实际矛盾是 SQL 用 Rust 变体 `BuzzEventId` 匹配审计，而既有契约在线值为
`BUZZ_EVENT_ID`，因此带原生 head 引用的读取也被错误拒绝。

迁移 `20261004015500` 只解除 Memory 的该空值限制，并修正原守卫三处枚举匹配；
完整父子 AE、Invocation、scope、actor、native head、meter 与审计守卫保留。
HUMAN 的空 Invocation 仍合法，跨 scope/orphan、错误 meter/native turn/seq 仍拒绝。
不改契约、API 或 Workflow history；不补造既有失败用量、不重复执行原生读写。
回滚遇到新格式的 Invocation 或非空 native event 引用时明确停止，不删除权威事实。
用量仍走原 outbox 的重试与对账；终态证据缺失仍不得显示成功。

实现后在现有隔离 PostgreSQL 容器的新空库 `memory_usage_shape_20261004` 执行
全部当前 up 迁移，退出 0，不修改在线业务库。实际约束的 10 项输入、实际守卫的
三处枚举谓词正反共 6 项、真实 orphan usage INSERT 的拒绝均通过。
主动回滚约束后，同一检查退出 3：`native source shape mismatch`；还原后再换回
旧原生函数，同一检查退出 3：`contract wire kind rejected`；最终还原检查退出 0。
原件位于 `/volumes/data/kailo/tmp/codex-memory-usage-shape-20261004.uwqHX4/`，
包括 `verify.sql`、`verify.log`、`mutation-shape.log`、`mutation-wire-kind.log`、
`restored.log`。事务包装产生的嵌套 BEGIN/ROLLBACK 警告保留，均无持久业务写入。

以上不替代完整授权子调用的真实正向 E2E、Relay 或模型回复验收；回滚对含新格式
业务行的停止条件已写入，但未以真实完整业务夹具演练。此次未部署迁移。

## 2026-10-04：Inbox / Workflows 与 Memory 修正整批门禁

固定候选 `0bd70a9070913e3770760d7d397ecd9e061fb705` 相对
`a535179baea0fc92f8515d32102288262e4161a6` 为 72 文件 +4427/-596。
原 `./tools/check.sh --full` 实际退出 0。检查镜像为 `10ad51a2…`，实际
4 CPU/8 GiB/swap 0，复用 Data 缓存；未运行 GitNexus，未重复产品构建。
四侧静态与验证、163 个 schema 生成/兼容、Workflow replay、19 条追溯、
供应链与六个当前源码产物的来源核验均通过。

Core 单元为 140 passed/5 ignored，另两项外部演练 ignored；未提供
DATABASE_URL 与实际部署配置，因此全量迁移/SQLx prepare、配置预检 SKIP。
依赖外部配置而早返的用例不作实际业务验收；未安装 gitleaks，仅内置扫描通过。
本节不将包构建、source 一致或 full 0 代替真实 Agent 回复、组件 binding、
Win11 设备与签名、Mobile release 或生产验收。

之前候选 `85af74880e361716584e1875f7b6086e1ae05d53` 误纳工作区历史文档，
在静态检查阶段主动停止，退出 137，不是 OOM 或通过；将无关内容仅从私有提交
索引排除，原工作树未回退，修正候选再执行上述 full。可执行源码没有因该纠正改变。
原件目录 `/volumes/data/kailo/tmp/codex-workflows-delivery-20261004.IVUu4U/`：
停止的 `full.log` SHA `8db231e714f90133de6ce435b459f8e9099fecf1695a29d6f1e27f4e1d5cc313`；
最终 `full-selected.log` SHA `4f07e5a9dc03a9572dcd577ef948f0dec012db2d39a0d1e5046f02c9c4afcc7b`。
回执与 README 状态更新只走原文档快路径，不重编译本批产品。

## 2026-10-04：POST_MESSAGE 原链实现与隔离证据

候选基底 `acbab8036911922c0dad4b4d28c7bb8e13c03afc`，tree
`8aa144d6e408d7fbef3857512d6883b1cf6415bd`，26 文件 +1738/-65；源码已进入
正式工作树，不含已有无关修改。本节不是提交、部署或真实消息发送回执。

四步结论：

1. 权威为 DD-107、设计 `05` §2.9、`06` §9/9.1：POST_MESSAGE 复用原
   automation.run、AgentTaskWorkflow、Installation 身份与 Delegation；不创建
   新动作策略、工作流种类、消息存储、模型 trace 或计量权威。
2. 影响原 Relay/Schedule 准入、AgentTask、Session 首轮判断、OpenMeter COUNT、
   AutomationVersion 契约和共用管理表单。仅精确 frozen version 的 POST_MESSAGE
   使用 automation.run COUNT 与 Capacity NONE；AGENT_TURN 保留模型与 slot 门禁。
   四侧生成契约同步；16000 迁移保留 15500 的 Memory shape 与 BUZZ_EVENT_ID 修正。
3. 发布前在同一既有 Invocation 上以 CAS 固定签名事件 ID 与无正文意图；唯一
   获胜者再次检查权限、binding、额度和实际 Temporal Activity attempt 后投递。
   COUNT 的稳定 ID 避免重复计量，Relay 精确查证与原生 stored_at 缺一不可完成。
4. 意图落存后、deliver 调用前的确定拒绝可记录 NOT_DELIVERED；超时、崩溃、
   撤销中断或查证缺事件都不能推断未投递，保持 UNKNOWN 且不重发。原 Task/Workflow
   继续负责查证；本批没有承诺无法证明的有限时间自动终结。含新 POST 事实时 down
   明确停止，禁止以回滚抹掉外部副作用证据。

Session 原 SQL 曾把无 native turn 的已完成 POST 当成未绑定模型 dispatch，
阻断之后的首个真实回合。现仅排除同租户、Workspace、Automation、automation.run
ActionExecution 精确关联且无 native/model trace 的 frozen POST；未知动作与
矛盾模型证据仍拒绝，不伪造 Memory 已消费事实或新增 Session 状态。

隔离 SDK 固定镜像 `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
实际 4 CPU/8 GiB/swap 0、Data 缓存，Cargo 保持 16 jobs。实际结果：

```text
cargo fmt / cargo clippy -D warnings                 exit 0
automation::management_evidence                      7 passed
agent_task::                                        19 passed
agent_session::memory_phase_tests                    3 passed
Rust / TypeScript / Go / Dart contract roundtrip     exit 0
shared pages                                        188 passed
shared typecheck / i18n / registry                   exit 0
SQLx 70 up; 16000 down/up                            exit 0
16000 down with persisted POST evidence              exit 1 (expected refusal)
```

生产逻辑变异：移除 COUNT 发布证据约束，原 PG 检查退出 3；移除 native attempt
相等检查，原 Rust 断言退出 101；移除 UNKNOWN 的 Operation/AE 关联检查，共享 UI
两断言失败；破坏真实 Memory phase SQL，PG 检查退出 3。逐字还原后各目标退出 0。
POST 样本改成未知 action 字段时四语言解码均拒绝，恢复后往返通过；首轮 Dart
依赖缺失退出 65 不计有效变异，补齐原离线依赖后实际解码失败退出 1。
真实 PG 事务也拒绝意图漂移、伪造模型 turn、过早完成及无发布证据 COUNT。
这些是有真实约束的合成关系事实，不是生产 Relay/OpenMeter E2E。

原件目录 `/volumes/data/kailo/tmp/codex-installation-runtime-rootcause-20261003.e4agxD/post-message-RGXfe7/`：
`canonical.patch` SHA `d0a080152a553f17218dcbfce3e1f701f95be5d3750325c47db82b45d11c4272`；
`handoff.md`、`source.sha256`、`evidence.sha256`、`final-core.log`、`final-clients.log`、
`final-session.log`、`session-phase-restored.log` 保存命令、原始失败和恢复结果。
两份自有合成数据库已精确删除，名称读回 0，其他数据库与生产数据未动。
未运行新整批 full，未构建产物、发送真实模板消息、续授权或重放旧模型调用。

WEBHOOK 专属阻断：设计 `06` §9 要求异步消费触发正文，`04` 存储权威表与
`05` §7 禁止 Core/审计/Temporal history 代存；当前 SourceRef 只有 Relay 事件与
原生 Schedule 来源，没有已冻结的 webhook payload 持久/恢复权威。
`agent_task::source_message` 因此不能凭 delivery ID 恢复正文。保持该入口不存在，
不新增无调用方验签代码或借密钥/可选业务存储绕过。审批关卡也不在本候选完成范围。

### POST_MESSAGE 交叉复核修正

COUNT 消费者支持原生 `$.automation_resource_id` 分组，原候选却遗漏该字段。
现在 `record_count` 从同一锁定 Invocation 读取非空 Automation UUID，同时写入
dimensions 和 CloudEvent；16000 的原精确约束核对同一字段，不取客户端或最新版本。
最终源码 tree `9be52b40ba26ead79558ef75a0045cda263a03a9` 相对上述基底为
26 文件 +1739/-65；增量两文件 +5/-4，不改变发布重试、UNKNOWN 或其他计量分支。

原 SDK 中 fmt 与 POST Rust 目标退出 0，1 passed。隔离库原 70 条迁移通过，
COUNT 正向 1 项、负向 6 项通过；删除实际目标守卫后退出 3，报告
`TEST FAILURE: count missing automation target accepted`，原函数逐字恢复后再退出 0。
自有隔离库已删除并读回不存在，未修改线上数据库。
原件同目录 `count-target-handoff.md`；增量 patch SHA
`2ccd7dd4fa34c67c247e9067cfc370bc945a89415b43d155feaa2f761b12e135`，
最终 Rust 日志 SHA `40cd4ee2a44cdb111169a637c07185653e90b833dbd97d75f53c0228b2e568df`。

### Mobile 同批只读消费

按 REQ-21、设计 `17` §8 与 DD-107，Mobile 仍只通过 BFF 读取，不新增管理写入口。
原 provider 已改用生成的封闭 ActionKind，保留 scope、版本和模板检查；详情页对
AGENT_TURN/POST_MESSAGE 使用同源文案。未知枚举仍解码失败，不展示模板正文。
变更三文件 +56/-2，包含实现后补充的双动作、双语言只读及未知动作五项场景。

固定 Flutter 3.41.7/Dart 3.11.5 镜像 `644e3cea…`、实际 4 CPU/8 GiB/swap 0 中，
原 format、analyze 退出 0，pages/read_state 两目标共 99 passed。首轮仅新增检查闭包
格式失败，保留该退出 1；纠正机械格式后通过。恢复旧 AGENT_TURN-only 生产限制、
错置 POST_MESSAGE 展示文案两次变异各令双语言断言失败，均退出 1；逐字还原后
format/analyze/99 项再次退出 0。生成物、锁文件和三源摘要还原一致。
原件 `/volumes/data/kailo/tmp/codex-mobile-post-consumer-20261004.COYIcL/handoff.md`，
最终日志 SHA `82df70d3e14b22a61a7832d7baaf084b28a115a3141103c0677de4e5512a4921`。
本次是模拟 BFF 的真实 widget 检查，不是设备、真实发布或签名验收；自有 SDK 已删除，
证据保留，服务和业务数据未动。

### Relay 触发与版本回读的消费遗漏

主线全引用复核发现原候选仍有两处 AGENT_TURN-only 限制：
`automation::inspect` 拒绝消息/提及触发的 POST_MESSAGE，
`automation_query::versions` 拒绝回读其版本。这会让表单与执行器已有支持却无法使用。
两处实际消费者已修为同一封闭动作集合，未知动作、审批未实现、scope 与触发限制
保留；模型专属 `turn_template` 和模型回复读取的 AGENT_TURN 条件不移除。
这属于 DD-107 已定范围内的消费缺口，不改契约、迁移、UI 输入或运行数据。
定向验证与最终合并门禁须以本修正后的树为准，不沿用前述候选通过记录。

修正后的生产入口分别调用原模块私有守卫，版本动作由既有生成 ContentAction
解码，未知字段和空模板继续拒绝。最终增量 tree
`517fdc310913dd889de75df53268322df05bd280`，相对上述 `9be52b40…` 为三文件
+86/-16。原 post_message 过滤目标 4 passed；将两生产守卫恢复为旧单动作限制后
2 failed、退出 101；逐字还原后同目标 4 passed，fmt 和 Clippy `--tests -D warnings`
退出 0。未以此声称真实 Relay 端到端发送通过。
同目录 `relay-reader-increment.patch` SHA
`e712c8997d95091300c5c618bfdc95bb35f21eff8c30adff5b5191ed53d515ef`；
`relay-reader-restored.log` SHA `20e78cc6d48706ff497b4ea9b567b4d7d452dd2377feaab462e9fd56e923af57`。

### 同批 Web 产物

选定源码在独立交付树沿原 `tools/build-upstream.sh web-client` 构建退出 0；
实际 builder 为既有 `kailo-core-data`，8 CPU/16 GiB/swap 0、Data 持久缓存。
没有为小修正重建客户端：上述两后端入口修正和 Mobile 不改变 Web 输入。
原 helper 登记 source `9abde23f874d145c5218d41d57313705ffd07aad7cc4c48bf61491297dd792f9`，
artifact `616c02549f3b4f7d13d6a68165aa31720960897c15d5e4ca8e3b2c8a34de1ac0`；
registry manifest 独立 GET 的 SHA-256、image ID 与 RepoDigest 一致。
日志 `/volumes/data/kailo/tmp/codex-post-message-delivery-20261004.E3t8Tv/web-build.log`，
SHA `6457c7df8c64ff6fb466ce63717aee665485989c683dcc0b393940362a2bc146`。
本段记录构建与来源，不是新 Web 部署或真实模板消息的业务终态。

### 同批 Win11 产物与输入闭合

同一交付树的原 `tools/build-upstream.sh desktop-client` 已实际退出 0；没有重启或
另开第二次构建。原 Windows x64 NSIS 包为 15,114,394 字节，source
`27fcae1e610a8a7de0f9cbc0d4ef9f919074a7a6f92bd05a2d28caa95c8872e1`，artifact
`712e4667df1a180b54dbf1642ddc67d6fa211a896565888468c97424206ccb23`。
2,267 个实际输入的路径、类型与字节摘要前后 cmp 退出 0；原 pnpm 与 Desktop
Cargo 两锁 SHA-256 校验均为 OK，没有构建中升级锁或源码。

包位于 `/volumes/data/kailo/tmp/codex-post-message-delivery-20261004.E3t8Tv/apps/dist/desktop-client/Kailo_0.5.23_x64-setup.exe`。
同目录上级交付原件 `desktop-build.exit` 为 0，`desktop-inputs-result.log` 留存输入核对；
`desktop-build.log` SHA 为 `7cbad88abb53e850f05c686b7fa841e327ec3332bd6fb52253b20b9b181a4217`。
实际执行者仍为既有 8 CPU/16 GiB/swap 0 的受限 BuildKit 与 Data 缓存。
冷 APT 安装实际耗时 1,045 秒；原 Rust release 2 分 24 秒、NSIS 生成成功。
上游 dead-code、跨平台打包与跳过签名警告保留；本包未签名、未在 Win11 安装运行，
不能据此关闭设备、真实模板发布或生产门禁。仅同步产物来源，不部署本批服务。

### 模板消息整批门禁回执

相对 `ea06cf9da925a5eec23591d14e61658764ef2093`，冻结树
`d3d8722f54bfac38115d77df007a4b281dc5efd2` 为 49 文件 +2071/-103。
原 `./tools/check.sh --full` 实际退出 0；本次只执行一次，没有重打产品镜像。
SDK 为 `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
实际 4 CPU/8 GiB/swap 0、Cargo 16，缓存仍在 Data 卷。
Rust/Go/TypeScript/Dart、167 个 schema 同步及兼容、Workflow replay、19 条追溯、
六份来源、32 个产物与原安全门禁通过。Core 单元 144 passed、5 ignored；另两项
外部演练 ignored。依赖外部配置而早返的目标不计业务验收。

未提供 `DATABASE_URL` 的实际迁移演练、导出树没有 `.env` 的实际部署预检均 SKIP；
隔离库迁移证据见本批前文，不将其冒充本次全量入口的实际数据库演练。
内置秘密扫描通过但未安装 gitleaks。Win11 签名/设备验收、Mobile release 签名及
真实 Relay/OpenMeter 模板发送终态仍未闭合。没有部署服务或修改线上业务数据。
原件 `/volumes/data/kailo/tmp/codex-post-message-delivery-20261004.E3t8Tv/full.log`，
SHA-256 `59cd18c81bd4db0be233437c559e7223f25ab10bd1b9a226be9016b09c43236b`。
追加回执只走原文档快路径；实际提交与 push 以 Git 历史为准。

## 2026-10-04 Automation 步骤审批合并候选

### 权威、影响与异常

设计 `05` §2 的可选版本审批和冻结 owner/role/target，`06` 的原 ApprovalWorkflow、
FreshApprovalAdmission 与 AgentTask 首次副作用门禁是本次实现依据（DD-107）。
不新增审批权威、默认策略或 Workflow kind。AutomationVersion 的可选 `{id,version}`
引用由同 Tenant、`automation.run`、RESOURCE 的真实策略目录写入并冻结；旧版没有
该字段时保持原字节与无步骤审批行为，未知字段、错属或无效策略拒绝。

影响面包含原版本创建/读取/触发、AgentTask advance、原治理资格/consume、共享
Workflows 表单和 Mobile BFF 只读详情。迁移 17000 保留原 Memory 动作族锁与约束，
补齐同 Tenant 策略与唯一子动作关系；已存在策略/版本/子动作引用时停止回退。
Worker 以固定子 ID、REJECT_DUPLICATE 和 ABANDON 接原 ApprovalWorkflow，父任务
续跑不产生另一审批实例。结果不明只观察同一子动作，不启动另一个模型回合。

审批门禁先于 POST_MESSAGE 发布意图及 AGENT_TURN Capacity、Memory、原生执行。
fresh 权限、Delegation、quota 和原 consume 继续重验。取消/拒绝仅在 CAS 证实
Invocation 没有执行事实时，与子动作关闭同事务提交；已派发的任务仍走原观察与
取消路径。策略被撤销、身份/投影/外部证据不可核验不回退无审批，不把 UNKNOWN
当成功或失败；错误仍归原六类，未新增第七类。没有额外业务正文持久化。

### 实际验证与证据

作者冻结树 `290985fe5a209a81fb4591a179db244a45d89102`，基底
`75eac99e74670ecde7de38879c451fe5b2c59449`；源补丁 25 文件 +1407/-101，
四侧生成不在该补丁内，主线合并组件契约后使用原 `tools/gen.sh` 统一生成。
原件目录 `/volumes/data/kailo/tmp/codex-installation-runtime-rootcause-20261003.e4agxD/step-approval-uO83oN/`，
`handoff.md`、`final.sha256` 留存精确命令、补丁和日志摘要。

- 既有受限 SDK 镜像 `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
  4 CPU/8 GiB/swap 0、Cargo 16、Data 缓存；没有宿主项目工具链或产品构建。
- 原 `cargo fmt --all --check`、`cargo test -p platform-core automation:: -- --include-ignored`
  和 `cargo clippy -p platform-core --all-targets -- -D warnings` 退出 0；11 项通过，
  显式投递隔离数据库，不把未投递依赖的早返当通过。
- 原 Go AgentTask/Approval 目标和契约 Automation 目标退出 0。最初夹具误把 SDK
  测试环境 drain ABANDON child 的结束时刻当父终态，实际失败保留；改为读取父终态
  时间后 `go-restored-terminal-clock.log` 通过，没有改变生产行为迎合夹具。
- 共享 TypeScript 类型检查退出 0，原 pages 192 项通过；当时 TS 契约往返 6 项、
  Dart 7 项通过。隔离 PG 71 条迁移前进、空引用 17000 回退/再前进退出 0；已有
  真实引用时原回退退出 1，报告 `Automation step approval references exist; stop rollback`。
- 删除 SQL 同 Tenant 守卫后实际断言退出 3，删除 Core 策略 tenant 谓词后退出 101，
  关闭 Worker 子流程启动后退出 1，删共享已选策略可用性守卫后 3 项失败、退出 1。
  逐字恢复后上述目标均通过。初次无效 SQL 变异与 Go 夹具退出 143 原件保留，
  不作为有效捕错证据。自有数据库已精确清理并读回不存在。

Mobile 独立三路径 +144/-1，原件
`/volumes/data/kailo/tmp/codex-mobile-step-approval-20261004.xJCHuV/handoff.md`。
真实详情解码器先核对原 JSON 引用的字段、UUID 与版本，再调用同一生成类型；显式
null、未知字段等不会被生成解码器擦掉后伪装为合法。原 format/analyze 与两既有
pages/read_state 目标退出 0，116 项通过；两个生产变异分别造成 1 和 4 项失败，
逐字还原后 116 项再次通过。最终日志 SHA
`fec501b02cbaa6574ba125ca923060fef141c929930f01c1883c4ab610912a29`。
这是模拟 BFF 的 widget 证据，不是设备、实际审批、APK/iOS 或签名验收。

主线合并只调整 Go 生成枚举引用为合并契约的准确符号，不改线协议值。原生成和
`--check` 退出 0，日志 `codex-component-post-integration-20261004.jHCT3k/step-generation-offline.log`
位于 Data 临时根。首次无网络容器的 npx 试图请求 registry，终止本次自有生成进程
退出 143；使用已有缓存的 offline 执行通过，没有升级依赖或修改生成工具。

没有调用真实 BFF 决策、生产 Temporal child、SpiceDB 或模型/Relay 执行；没有
上线步骤审批。策略目录依赖运维显式投递的合法既有策略，当前不自动开通。
WEBHOOK 正文权威缺口仍独立阻断；本批不增 webhook 入口或影子正文存储。

### 步骤批准消费前的资格纠正

合并后交叉复核发现：步骤批准后若批准者失去角色，原 consume 仅变更状态，
不能证明执行前仍满足冻结条件。依据设计 `05` §5，修复复用原
`FreshApprovalAdmission`，在 `automation.run` 子审批消费前逐人重查，并用原
`satisfied()` 重算 owner 与每项 `minDistinct`；不改写不可变决定。确定撤权或
人数不足进入 INVALIDATED；依赖不可用留在原期限内查证，不消费、不派发。
超时或并发失效优先于迟到 Activity，续跑保留原决定与截止时间。

改动仅 Worker 两路径 +165/-1。`approval-consume-fresh` 的 GetVersion 保持
旧 history；已 CONSUMED 不再查证。范围仅限首次副作用前消费的步骤审批：其他
原动作在 dispatch 后消费，本次不改变其命令序列，也不声称全平台审批已整改。
没有 Core、契约、迁移或客户端变化，因此未重新构建 Web/Desktop。

原受限 SDK 中 `gofmt`、`go test ./... -count=1 -timeout=120s` 与
`go vet ./...` 全部退出 0，包含既有 replay。撤权、角色集合缩水、两人阈值跌破、
依赖不可用、旧版本、非 automation 路径及已消费重入均有实际断言。
将生产 fresh 条件破坏为恒假后五个断言失败，退出 1；逐字恢复后原全包与 vet
再次退出 0。首次窄快照缺 samples 的实际退出 1 保留，补齐同源输入后通过，
没有更改产品以绕过检查。这是模拟 Activity 的 Temporal SDK 验证，不是真实
SpiceDB/Temporal E2E。

原件 `/volumes/data/kailo/tmp/codex-installation-runtime-rootcause-20261003.e4agxD/approval-consume-fresh/`。
最终 `final.log` SHA-256
`6d0a5ad606e169014ab8f3da4e1edbcae6e8001d3d256ccc55a3652a090c553f`；
`scoped-mutation.log` SHA-256
`4502e0ca28fa7504f726c04c5e3e4218766ecd7d43763acac6b816c19739e9fd`。

### 本批共享客户端产物

组件登记与步骤审批共用原 Web/Desktop TypeScript 主体。Win11 仅运行一次原
`tools/build-upstream.sh desktop-client`，实际退出 0；原受限 BuildKit 8 CPU/
16 GiB/swap 0，Data 缓存，未变更限额或 Cargo 并行度。2269 个输入前后逐字一致，
pnpm/Cargo 锁未变；独立导出的选定树 `3b82ceea39337e70144ec7d26a722e1df3e21cd7`
沿原工具计算的全部输入也与构建快照一致，不以正式脏工作树代替选定源码。

source `sha256:9e52f5337c3b67515ba8371869098368c2654bedcb5da36603be45af093ccfa9`；
安装包 `Kailo_0.5.23_x64-setup.exe`，15118736 字节，artifact
`sha256:4edf3d34902c7c5ed9b0158d3cde1c5eb37564c9a06a852a3891e80254292874`。
原件目录 `codex-component-post-integration-20261004.jHCT3k/` 位于 Data 临时根，
`desktop-build.log` SHA-256
`fdb6295559332062e750d1f96e6038bcd72910e8072273263dc0d013a3ebc69c`。
原生 dead-code、chunk 体积和跨平台未签名警告保留；未在 Win11 安装运行，
不能据此关闭设备或生产门禁。Web 同批一次构建与 registry 回读结果见
[组件登记记录](component-release-registration.md)；两份产物均未据此部署。

### 同 Session 并发派发前的 idle 重核

本批基准 `9273f48cb042ad866d2c173e77b8d11b80423e6d`，仅两处 Core 源码及本记录。
依据设计 `03` 的 Invocation/Session 固定归属、`05` 的副作用前 fresh 与 `17` 的
Installation 隔离：同频道不同 Installation 仍各有 Session；问题只在同一
Installation/root 的两个 CREATED Invocation 先后通过 resume 的 idle 观察时。

1. 原 `resume_for_dispatch` 释放 Session 锁后，另一调用可能先绑定 RUNNING turn；
   第二调用的 `prepare_dispatch` 只重核 MemoryPhase，Continued 并不能证明 idle。
2. 原生固定 Codex `7498521d288b9b3b96ffba4eedf089d8d6e06a84` 的
   `codex-rs/app-server/src/request_processors/turn_processor.rs::turn_start_inner`
   同时允许 Started/Steered 返回 turn；Kailo 原 native idle 守卫必须保留，不能放宽。
3. 本修复提取并复用原 idle SQL，在 `prepare_dispatch` 的既有 Session 锁内、
   CREATED→DISPATCHING CAS/审计提交之前再调用。保持原 AE→Tenant→Session 锁序，
   sibling 查询不加行锁；busy、缺失或读取未知均不提交新派发/trace。
4. `RuntimeError::Unknown` 仍沿原 first_turn 返回 Running/UNKNOWN_EXTERNAL_RESULT，
   Invocation 保持 CREATED；Worker 用同一 InvocationID 轮询并续跑，不创建新请求。
   已 DISPATCHING/UNKNOWN 的原不明结果不重发、不改成确定失败。

真实执行使用原固定 SDK `10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
4 CPU/8 GiB/swap 0，Cargo16；复用私有 `runtime-session-UQJGvp/target`，未写公共
Rust target。执行前 host 可用内存约 37.9 GiB、memory PSI 0，未见既有 Cargo/rustc。
原隔离 PG `kailo-installation-scope-pg-e4agxd` 为 2 CPU/1 GiB/swap 0；仅新库
`session_dispatch_znimzr` 用原 SQLx 迁入 73 项（至 `20261004018000`），退出 0。
检查夹具全在事务内回滚，最终该库 Tenant/Invocation 数均为 0；未碰运行库。

原目标 `cargo test --locked -p platform-core agent_session:: -- --include-ignored`
基线退出 0，4 项通过，其中一项实际 PG 调用原 idle SQL，覆盖迟到 sibling turn、
不同 Installation/root、UNKNOWN、缺失 native completion 与确定 native failed。
私有将生产 `if !certain` 改为 `if false && !certain` 后，同 PG 断言真实失败，
退出 101；逐字恢复并 cmp 0。恢复组合原 rustfmt --check、Session 4 项、AgentTask
19 项及 `cargo clippy --locked -p platform-core --bin platform-core -- -D warnings`
全部退出 0（handle `73986`）；随后仅纠正一处测试注释，不改变执行代码。
Core Cargo.lock 与基准逐字摘要相同。

原件目录：
`/volumes/data/kailo/tmp/codex-installation-runtime-rootcause-20261003.e4agxD/multi-installation-zniMZR/`。
`session-baseline.log` SHA-256
`20adc4f60c22b72b1fbfb8b21e854b5b821a29246809e0857424d0af877fbbb5`；
`session-busy-mutation.log` SHA-256
`544fb568058d0f9a8d9b95357043b30ff20c9464dc9c4c2ceb3db819d8709e81`；
`restored-final.log` SHA-256
`edbd6b68fcbfa0103a58b972cc368b3e390c5a7a96867b69fd6622251a54e1e5`。

覆盖边界：PG 断言直接执行生产 idle helper，并非真实 `prepare_dispatch`/ServiceState
联合夹具；删除该新消费调用本身不会使这些断言失败。锁内实际调用、事务早退及
Worker 同 Invocation 等待由源码链核对；尚未验证真实多消息并发、Temporal/Codex/
Relay/OpenMeter 联合 E2E。本批没有模型调用、live 权限/额度/配置变更、契约迁移
变更、full、产品构建或部署，不将原生状态或取消请求伪装为业务终态。

## 自动化与历史调用现场核对（2026-10-04）

17:49–17:56 UTC，基准 `9273f48cb042ad866d2c173e77b8d11b80423e6d`。
本项只读取正常 OIDC/BFF 和原 Core/OpenMeter 事实，没有源码、权限、配置、
额度或业务数据写入，没有模型调用、编译或部署。

- 权威：设计 `05` §2.9 的 `automation.run` 使用原 COUNT meter；`06` §9
  的模板消息沿 Relay/Schedule、原 AgentTask 与 fresh Delegation 执行，
  不要求 Codex 或模型 Capacity；不能以手动伪造触发或借用 Installation 权限替代。
- 影响面：sole `.env` 的 `AUTOMATION_RUN_METERS_JSON` 经原 Compose 传给
  Core，`automation::configured_run_meters/register_run` 负责固定目录登记；
  原 OpenMeter Customer、feature/entitlement 为额度权威。现有配置链没有缺项，
  空配置按设计不登记，没有新增工具、默认 meter 或第二计量实现。
- 实际身份为 FULL、Workspace ACTIVE、两个 Installation ACTIVE，Automation
  列表为空且 canCreate=true；现有 Grant 均过期。八项正常 BFF GET 全部 200，
  只证明当前读取，不证明对尚不存在的 Automation Resource 已有执行授权。
- Core 与 OpenMeter 均以 `BEGIN READ ONLY` / `ROLLBACK` 查询。当前没有
  `automation.run` Action、COUNT meter、对应 feature 或该租户 entitlement；
  唯一原生 meter 为模型 SUM，不能复用为执行次数。因此在触发之前停止，未创建
  定义或 Grant，不声称 Relay/Temporal/OpenMeter 联合终态通过。
- 首次 BFF 观察脚本误读 `principalId`，退出 1；首次 SQL 使用不存在的
  `catalog.workspace`，退出 3；纠正为原契约字段与真实表后均退出 0。
  这两次是观察命令错误，原件保留，不记为产品故障或成功验收。

自动化原件：
`/volumes/data/kailo/tmp/codex-post-message-live-20261004.gCzRvI/`。
`handoff.md` SHA-256 `7eb06ca6aa69a65d0d047a0a3ca85c8783db9938be4c2a31c82120ce35c6626b`；
`bff-preconditions-corrected.log` SHA-256
`308d98105f6489f1f0c262a12c6fe85330cbaeee1fe39aa0a78743ad26c62974`；
`core-metadata-corrected.log` SHA-256
`d9b904839bd95c6a58d7f890083aa48ee378915f43aac30296eac7ba396f60e7`。

同轮历史调用查证：`4cfe99fe-1e45-46d2-834b-411027412a9d` native completed，
业务仍 RUNNING / BILLING_UNAVAILABLE，没有可归属的 UsageEvent；
`b74498cd-a9f6-48ea-8b7d-7ed592ea8e79` 为 FAILED / Workflow TERMINAL，
唯一 8872 tokens 事件为 COMMITTED。二者都没有有效回复，Capacity 都为 RELEASED；
Gateway 用量 tail cursor 仍为 0。不能以 native completed 推断业务成功，不能
把别的事件补给缺归因调用、弱化结算守卫或重放原调用；继续沿原 RB-06 对账边界处置。
原只读命令退出 0，原件
`/volumes/data/kailo/tmp/codex-agent-terminal-readback-20261004.TVmhGa/settlement-readback.log`，
SHA-256 `328a32ca5abfe6fd898c4c41ec8906150e1f82348a3b036a367581026049b1fc`。
