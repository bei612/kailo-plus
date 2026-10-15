# Projects 原版创建与治理接线

2026-10-07。本记录对应 `.design/09-统一身份与Buzz协议投影.md` §3、DD-80、DD-81；不是完整 Projects 产品或生产发布验收。

## 来源、影响与权威

- 固定来源：Buzz `779af8886caae1317b4de962082429867ab61503`，`desktop/src/features/projects/projectCreation.ts::buildProjectBootstrapTemplates`、`projectDtagFromName`，以及 `desktop/src/features/projects/createProject.ts::createProject`。前者完整迁入 `client-kit/ts/platform/src/react/projects/projectCreation.ts`，实际 `diff -u` 只有 kinds import 从宿主别名迁到共享模块的差异。
- 原生 home Channel → kind 30621 project → kind 30617 default repository 仍由原 Relay 持有。创建频道沿已有 Workspace 写链；本次 semantic publication 只接项目和仓库两条公告，不新建项目数据库、工作流或注册表。
- 请求由共享四侧契约产生。Web 经 BFF 以真实 SERVER actor 签名；Desktop 本机 CLIENT 签名；共同使用原始名称、描述、slug、频道引用、仓库 coordinate 和 listed/unlisted 标签语义。
- CREATE 的 workspaceId 必须通过已有 Workspace 实时 scope、成员、binding 准入；不能以管理面可见替代 `isMember`。频道 ID 来自准入结果，不接受请求提供 owner 或原始 tags。Relay 继续裁决原生 `ReposWrite`。DELETE 仍须针对真实签名的当前 coordinate head，不删除频道或仓库。

## 副作用、异常与兼容

- 发布前仍先持久化原有 `admission.publish_attempt`／DISPATCH；Native 保存原已签名 eventId。UNKNOWN 重进只观察同一 eventId，不新签、不重发。project、repository 的回执核对原 kind 与 actor；Native 进一步核对 content/tags 与冻结意图。
- 查询时当前 actor 已存在的 coordinate 返回冲突；这不是跨会话并发创建的原子保证。固定上游 `crates/buzz-relay/src/handlers/ingest.rs::ingest_event_inner` 调用 `crates/buzz-db/src/store/replaceable.rs::replace_parameterized_event` 的 `Unconditional` 替换路径，坐标锁按 timestamp/eventId 决定新 head；两个不同 key 同坐标同时先查为空仍可能创建两个频道并覆盖公告。原 `createProject` 也为先查再发。本次没有以 Core 私有锁冒充两端都成立的 create-if-absent，没有宣称并发验收通过。
- 空名称、无 ASCII slug、原版 UTF-8 字节上限、非法 workspace、未知操作及混合 DELETE/CREATE 字段拒绝；租户／成员撤销、准入失败、回执不可读均不渲染成功。逐步恢复由共享创建调用方保留原 key／已完成阶段，不能因仓库步骤结果不明再建频道。
- 对账只读取原 eventId；可替换公告因更新或删除而不可见时仍为 `PROJECT_EVENT_UNOBSERVABLE`，不据此判断从未执行，不重放。沿已有对账责任和处置入口，没有引入新状态或独立终态权威。
- 新增前向迁移 `20261007190000_publish_project_kinds`，只扩展原 `admission.publish_attempt.message_kind` CHECK 接受 30617／30621；无新增数据库字段或 Workflow history。存在这两类发布记录时 down 明确停止，不删除或改写原幂等／对账身份。原 DELETE JSON 保持可读；先部署迁移和识别新契约的 Core，再启用对应客户端。生成四侧已入工作树，旧 Core 拒绝新操作，不能宣称反向支持新能力。

## 已执行证据

受限 SDK 为既有 `kailo-agent-receipt-xvkujx`：4 CPU、8 GiB，镜像 `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，复用 `/volumes/data` 缓存。证据目录 `/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/message-edit.AGX058/`。

- `tools/gen.sh && tools/gen.sh --check`：四侧生成与同步检查 exit 0。
- TypeScript contracts `npm test`：47 passed，exit 0，`projects-contract-ts-restored.log`。首次原 roundtrip 手写字段映射遗漏新增字段失败，更新真实生成接口字段映射后通过；失败不计成功。
- Go `go test ./internal/contracts -run TestProjectsPublicationRoundtrip -count=1`：exit 0，`projects-contract-go.log`。
- Dart `dart test test/roundtrip_test.dart --name 'Projects publication'`：1 passed，exit 0，`projects-contract-dart.log`。
- Native 原 `relayClientUnconfirmedResend.test.mjs`：12 passed，exit 0，`projects-create-native.log`。把已实现的查询回执判定故意退化为仅接受 kind 5 后，项目／仓库恢复检查真实失败（11 passed、1 failed，exit 1，`projects-create-native-mutation.log`）；恢复原文件后 12 passed、exit 0，`projects-create-native-restored.log`。
- 联合 Rust 验证日志在同 evidence 根的 `workflow-native-template.s3JDP1/`：`bridge-restored.log` 20 passed（含 Projects 三条）、`core-restored.log` 5 passed／1 DB ignored、`projects-roundtrip.log` 1 passed／42 filtered，均 exit 0。`bridge-mutation.log` 中把创建模板的真实 home Channel 标签改错，Projects bootstrap 断言失败；与两条 workflow 破坏合计 17 passed／3 failed、exit 101。恢复后联合通过，未将共享输入中途替换前的第一轮运行作为最终证据。
- 数据库验证仅使用已有隔离 PostgreSQL `kailo-buzz-full-pg-uOp8YM/scope_verify`（2 CPU／2 GiB）；核验起点迁移为 20261006190000。事务内先应用其后与发布记录相关的 edit/delete/native-kind 三条正式迁移，再演练本次 up → down → up，exit 0（`projects-migration-up-down-up.log`）。真实插入 30617／30621／原 9 成功，未允许的 30622 仍被 CHECK 拒绝，exit 0（`projects-migration-insert.log`）。已有项目记录时 down 输出 `Project publication attempts exist; retain their reconciliation schema`，exit 3（`projects-migration-down-blocked.log`）。故意执行 down 退回旧约束后，同样真实插入失败 `violates check constraint publish_attempt_message_kind_check`、exit 3（`projects-migration-mutation.log`）；恢复 up 后同一插入检查再次 exit 0（`projects-migration-restored.log`）。所有事务回滚，复核记录数 0、原约束未变，未修改在线业务库。
- 固定官方模板 `diff -u` exit 1 为预期 import 迁移差异，不表示运行验收。选定变更 `git diff --check` exit 0。
- 尝试在既有 SDK 输入运行 `bash tools/check.sh contract`，exit 2：依赖准备的 npm 输出 `EACCES: permission denied, mkdir '/tooling'`，见 `projects-contract-check.log`。该输入的 `git rev-parse --show-toplevel`／发布 tag 查询也明确报非 Git 仓库；未建立额外 Git 或修改工具入口，发布基线兼容比对没有执行，不能以四侧 roundtrip 通过代替。
- 随后复用同不可变镜像启动 2 CPU／4 GiB 短命容器，源码根、`.git`、`.design` 只读挂载，无网络且不安装依赖。加载原 `tools/check.sh` 定义后直接调用原 `step_contract`：相对 `contracts-v0.1.0` 无破坏性变更（281 schema，匹配 3 个历史 schema），该兼容比较通过。单步整体仍 exit 1：本次 `gen.sh --check` 在临时 Dart 文件格式化处 exit 255，未完成同步判定，不能称为已经证实生成物差异。原 `check-docs.sh` 完整 exit 0：277 引用、87 实体／115 DD／29 SS、87 场景闭合，两侧 markdownlint 0 issues。日志 `/volumes/data/kailo/tmp/projects-contract-docs-20261007.F6tx33/contract.log`、`docs.log`、`gen-check-detail.log`。这是原单步函数与文档检查，不是 `check.sh --full`。
- 发布基线只匹配 3 个历史 schema，不证明旧 Core 能读取新增 CREATE 操作；部署仍遵循上文 Core 先行。另对当前本次请求 schema 与四侧生成文件逐一 `cmp`，均与先前 `gen.sh --check` exit 0 的 `workflow-condition-gen.qjLXyz` 输入／产物一致；同样对当前 281 个 schema 文件逐一比较，全部一致。该既有输入真实生成同步通过的事实与本次格式化失败分别保留，不把失败改记为成功。

## 未验收与发布边界

本记录不证明浏览器创建实操、三个独立用户协作、Desktop 安装包或 Mobile 已验收；本批没有部署和重新打包。契约历史比较及其有限范围见上文，不能替代最终全量检查。

当前本地配置 `BUZZ_MEMBER_EVENT_KINDS` 尚未包含 30621／30617。该配置未被本次源码变更隐式放宽；部署创建功能时必须沿原受控配置投递包含这两个原生公告 kind，并验证实际 Relay 准入及 NIP-11 投影。原 Relay／SDK 缓存和页面已编译不能替代这项运行事实。

## 共享创建界面与端到端范围

原版 `desktop/src/features/projects/ui/CreateProjectFormContent.tsx`、
`CreateProjectFormSettings.tsx`、`ProjectBrowserDialog.tsx` 的表单外壳、名称／描述、
频道可见性、listed/unlisted 控件与 browse/create 切换接回同一共享主体；
两端只保留传输和导航宿主差异。`projectCreation.ts` 为共享迁移，表单尚不是
整个原版的等价恢复：原模板、团队、persona 消费者及 Git／任务能力仍是明确缺项，
不是从交付要求删除。本批只恢复已有真正执行链对应的部分，不作完整页面验收。

`createProject.ts` 把原主频道→项目→默认仓库顺序接到既有 workspace.create
Action、实际 Task 终态和两个原生公告；`useCreateProject` 在同一宿主 scope 内保留
原 Action 和公告幂等引用。只对已证实未发出的拒绝允许原步骤重试；丢失回执、
失权、错误 kind／作者／原模板内容均不能宣布成功或重新创建主频道。目录最终
回读核对两个原事件 ID、模板 tags/content 与事件 hash，不以“看到项目名”
判断创建完成。卸载及 scope 变化后停止后续写入；创建完成后的导航失败与创建
失败分开显示，不重复创建。新增中英词条沿原 TS→Dart 路径生成，未维护第二份词库。

共享界面实际验证目录为 `/volumes/data/kailo/tmp/settings-scale-20261007.VXUSoG/`。
`projects-final-three-side.log` 记录共享源与测试、Web、Desktop 的
`tsc --noEmit` 全部退出 0；原 Projects 两个测试文件 38 passed。
实现后分别移除成员检查、最终 hash 核验和完成按钮锁定，实际 3 failed，
恢复后通过（`projects-creation-mutation.log`）；另移除异步导航错误反馈，
实际 1 failed，恢复后该项 1 passed（`projects-navigation-mutation.log`、
`projects-navigation-restored.log`）。变异文件与正式源码 `cmp` 退出 0，
没有屏蔽日志中的 React act 警告。这些是实际消费者的隔离验证，不是浏览器
截图、真实 Relay 完整创建或 Windows 设备验证。

Core 读取已有请求契约作为公告元数据长度来源，保持上游 UTF-8 字节语义；
`.dockerignore`、`core/Dockerfile`、`tools/release.sh` 同时纳入这一编译期输入。
`bash -n tools/release.sh` 退出 0；未执行本批镜像构建，不能当作产物已验证。

本批工作区整体 `git diff --check` 实际退出 2：四个继承的 custom-emoji／messages
文件有 EOF 空行；本批选定代码路径检查退出 0，未混入这些无关修改。
`check.sh --full` 本批未执行；Data 实际仅余约 3.4 GiB，未再复制完整源码树和
启动全局编译去消耗不足的缓存空间。窄验证、文档通过不改记为全量通过。

## 原版 Coding agent 选择与真实安装（后续批次）

2026-10-07。继续固定 Buzz `779af8886caae1317b4de962082429867ab61503`，
`desktop/src/features/projects/ui/CreateProjectFormSettings.tsx::CreateProjectFormSettings`
的 Coding agent 行以及 `desktop/src/features/projects/createProject.ts::createProject`
在 project/repository 完成后调用 `addRequestedAgents` 的实际顺序。

动手前影响与边界核对：

- 权威：`.design/17-Agent管理平面设计.md` §2、§6、§8。Persona 不另建注册表，
  AgentDefinition/Version/Installation 与既有 `agent.installation.create` 才是平台权威。
  原 `personas[].displayName` 映射到已发布 Version 的 `content.personaIdentity.displayName`；
  原 `agentPersonaId` 映射到明确选中的 `agentVersionAssetId`，展示该固定 ordinal；
  原本机 `createChannelManagedAgents` 调用改为已有 BFF Action + Temporal 安装。
- 影响面：共源 CreateProjectFormContent、创建恢复 helper、useCreateProject 的 scope
  生命周期，以及已有 agentDefinitions/agentVersion/agentInstallationCandidates/
  agentInstallation 查询。未增加 Core 实体、契约字段、Agent 注册表或 Workflow。
  原 Settings 行的位置（Project list 后）、Dropdown、类名、None 与选项交互保留；
  版本标示和治理失败中文/英文状态属于上述授权差异。Web/Desktop 同一调用方。
- 副作用：先实际确认原 project + default repository，再申请安装。选择项不是授权；
  新 home 生效后重新读取该 Workspace 有权安装的候选，只匹配选定的固定 Version，
  不自动转向更新版本。Core 原动作继续执行权限、审批、额度及审计，客户端不代授权限。
- 异常：零候选允许原 None；目录失败不编造 Persona。分页不前进/重复定义拒绝。
  安装参数和 key 在发送前保存，ACK 丢失只向 Core 恢复原 command/key；已收到回执
  只读原 task。未终态、回执不可读、scope/version/generation 不符不显示成功。
  终态拒绝与安装尚未确认分别展示，均保留已建项目恢复记录，不重建 home 或公告。
  Installation 终态沿既有 Agent 管理/Temporal 收敛和处置入口，不新加状态机或超时配置。
  页面离开/scope 更换后 scoped client 不继续发动作；现有无 Agent 的恢复记录兼容。

安装完成同时要求同 ActionExecution/operation/Workspace、Temporal AGENT_INSTALLATION
COMPLETED、实际 Installation 固定 Version/ACTIVE、其 active generation 与 ACTIVE
projection 一致，并有 ACTIVE Channel binding。Channel ID 是查询的投影事实，
不把 `channelId === workspaceId` 引入新授权限制。当前 home 创建执行器
`core/crates/platform-core/src/tenant_lifecycle.rs::provision_workspace_buzz` 使用 Workspace ID
创建 Channel，既有绑定则复用原值；此事实不扩大为所有历史绑定的契约。

受限验证仍使用同一 4 CPU / 8 GiB SDK 与私有 `message-edit.AGX058/apps`，未构建镜像，
未运行 `.references` 内容。日志在前述 XvkUjX evidence 根目录：

- `projects-agent-type.log`：首次 test tsc 退出 2，fixture 的 send mock 被推断为只接受
  Workspace 回应；改用既有 BffTransport send 类型后，`projects-agent-type-final.log`
  退出 0。不是修改正式契约或屏蔽类型错误。
- `projects-agent-test.log`：41 passed / 1 failed；SDK 中 SidebarProjectsSection 仍为上一批
  前的旧副本，缺少正式已提交的导航失败反馈。同步当前正式消费者后，
  `projects-agent-restored.log` 为 42 passed，退出 0。
- `projects-agent-mutation.log`：在私有实际被调用的 projectAgent.ts 去掉 generation
  对应关系检查，41 passed / 1 failed，退出 1；恢复后与正式文件 `cmp` 退出 0。
  本批新增证据覆盖原 Coding agent 行位置/冻结版本、真实安装等待、版本撤回不替换、
  scope/version/generation/channel 不符、丢 ACK 同 key 恢复及不重复原项目公告。
  `projects-agent-final.log` 恢复后为 42 passed，退出 0；保留原日志中的 React act 警告。
- 交叉复核后新增 stale assetVersion 不重建、UNKNOWN observation/dispatch 不能渲染失败，
  以及真实原 Dropdown 选择提交；`projects-agent-reviewed-type.log` test tsc 退出 0。
  `projects-agent-reviewed-test.log` 首次 45 passed / 1 failed：隔离交互没有等原名称框
  autofocus，就打开菜单，焦点转移使菜单关闭；等待真实初始焦点后再操作，不改生产逻辑，
  `projects-agent-reviewed-restored.log` 为 46 passed，退出 0。
  合并主动破坏 generation 核对、UNKNOWN 保留、Dropdown onValueChange 三处实际调用，
  `projects-agent-reviewed-mutation.log` 为 43 passed / 3 failed，退出 1；逐处恢复，
  四个正式 Projects 源文件与 SDK `cmp` 全部退出 0，
  `projects-agent-reviewed-final.log` 为 46 passed，退出 0。

这些是实际共享消费者的隔离执行证据，不是在线服务、浏览器截图、Windows 或 Mobile
安装验收。本批未运行全量构建/部署；提交与发布由主线统一收口。原 Team 和 Template
仍依赖上游本机配置消费者，尚未接入平台既有治理，未以假选项冒充恢复；Coding agent
这一个真实链完成不能证明整个 Projects 已 100% 还原。

## 2026-10-12 原 Tasks 创建：Core 与发布对账接入

本批尚在验证，不是部署验收或完整 Projects 恢复声明。基底为
`f022696008fc73b6dbab8673e5eb6d5ae05913ee`；原 UI、契约和 Bridge 与本节
Core 变更合批收口，不另造任务数据库或执行引擎。

动手前的四步结论：

1. 权威：沿 `.design/09`、REQ-24、DD-39、DD-75、DD-81。固定 Buzz
   `779af8886caae1317b4de962082429867ab61503` 的
   `desktop/src/features/projects/issueMutations.ts::publishProjectIssue` 和
   `desktop/src/features/projects/projectIssues.mjs::buildGitIssueTags`
   定义 kind 1621 的正文与原 a/p/subject/t 标签。Community 原准入决定消息权限；
   仓库的 buzz-channel 元数据不是 Workspace 授权，也不要求发起人等于仓库 owner。
2. 影响：既有 ProjectsPublishRequest 增加 CREATE_ISSUE 与 title/body/category；
   targetEventId 指已验签的 kind 30617 仓库 head，不是原 Repository.id 坐标。
   Web 继续经 BFF 代签，Native 继续本机签名直连 Relay。Core 原
   publish_attempt、同键恢复、外部发布对账复用；新迁移仅扩展原 message_kind
   约束。旧操作字段组合仍拒绝混用；线上旧版本不支持新操作，不能提前开放入口。
3. 副作用：Core 只保存原发布意图和事件引用，不保存任务正文或正文摘要。
   已 ACCEPTED 的同键请求仍向 Relay 读原作者、原事件并核对瞬时输入，
   不把换正文请求返回成旧成功。读取前后重验当前准入和密钥主体；缺少签名终态
   返回 UNKNOWN/PUBLISH_RESULT_UNKNOWN，不补发，不将 HTTP ACK 当业务成功。
4. 边界：空/多条仓库事件、坏签名、非当前 head 在发送前拒绝；title 沿原
   JavaScript UTF-16 长度，body 沿原 trim 和现有实例消息字节上限。
   重复投递、进程重启与结果不明复用原意图/对账，不增加第二套重试状态机。
   迁移回滚遇到任一 1621 发布记录即停止，不能丢弃在途终态证据。

异常继续按 `06` §4 分类：认证/scope/成员撤销为 DENIED；未开放准入为 BLOCKED；
binding、secret、projection 与 readiness 缺失为 PRECONDITION；大小/既有额度或
背压为 LIMIT；head/同键内容冲突为 CONFLICT；发出后无可信终态为 UNKNOWN。
本批不新增审批、额度预留或租户暂停状态机，也不声称对这些原链路做了新增在线验收。
共享 UI 必须消费原 isOutcomeUnknown（含 BFF ErrorClass.Unknown），不能只识别网络
TransportError；该项在实现后交叉复核中发现，已改用原统一分类函数。
Native 三个旧操作同时在原校验处拒绝混入 title/body/category，不增加第二校验链。
原共享消费者 45/45、Native 18/18，以及两侧类型检查均退出 0；原件为
`/volumes/data/kailo/tmp/web-tooltip-shared.zzIWe9/project-issue-create.hfLmuC/outcome-restored.log`，
尾行 `TYPES=0 DOM=0 NATIVE_TYPES=0 NATIVE=0`。新增分类及混用字段的私有破坏验证
14598 退出 1；精确还原后的 32361 退出 0，分类 4/4、Native 5/5，详情见本节末尾。

当前实际验证：

- 原 SDK `kailo-receiver-observe-sdk-w4qug0`，4 CPU / 8 GiB、无额外 swap，
  workspace、Cargo registry/git/target 与临时目录均在 Data；未构建或加载新镜像。
- Core 三个源文件 `rustfmt --check` 退出 0；选定路径 `git diff --check` 退出 0。
  公共工作区其他旧差异不混入本批。
- 会话 59697：Bridge 与 Core 本批四源 `rustfmt --check --edition 2021`，以及
  `cargo clippy --locked --offline -p collab-bridge --no-deps -- -D warnings`
  均退出 0；没有降低 Cargo 并行度或取消检查规则。
- 原 `cargo test --locked --offline -p collab-bridge projects::`：
  `test result: ok. 6 passed; 0 failed`。SDK 与正式 Bridge 源码 `cmp` 退出 0。
  同一会话 80488 后续 Core 定向检查退出 0：`5 passed; 0 failed; 437 filtered out`。
  这五项是原 Projects 读取/过滤边界检查，编译包含本批写链，但不冒称已执行
  新增 `confirm_accepted_issue` 的真实 Relay/数据库路径。
  收口检查发现该私有快照另含旧 custom_emoji、main 和 schedule_calendar 差异，
  因此 80488 不能证明精确提交树已通过。主线只把这些私有无关输入还原为本批
  HEAD，并保留正式公共工作区原修改；对齐后的检查须单独记录实际终态。
- 对齐后会话 24621 实际退出 0：原 Core Projects 检查仍为 5/5、437 filtered，
  随后的 `cargo clippy --locked --offline -p platform-core --bin platform-core
  --no-deps -- -D warnings` 退出 0。正式三个 Core 文件和 Bridge 与私有已验
  输入一致；该范围之外的 Core 源码已对齐原 HEAD，不再借旧脏改证明本批。
- 原 `cargo test --locked --offline -p contracts --test roundtrip
  projects_publication_preserves_native_metadata_and_exact_head_reference`
  会话 15172 退出 0，`1 passed; 0 failed; 55 filtered out`。
  四语言原 Projects 往返至此均通过；不是线上跨端发布验收。
- 首次 Cargo 指向旧缓存时 offline 缺 png，在线重试遭 DNS 失败；改为已有 Data
  cargo-registry/git 的私有 CARGO_HOME 后完成上述 Bridge 检查，未下载新依赖。
- 隔离数据库 `project_issue_oj3nac` 原 `sqlx migrate run` → `revert` → `run`
  会话 22561 退出 0：117 条迁移完成，末条 `20261012050000` 的 migrate、
  revert、再 migrate 均输出 Applied。未改业务数据库，不代表在线发布验收。
- 同一隔离库用事务内的 PROVISIONING Tenant、DISABLED HUMAN 两行最小 FK
  夹具验证：1621 实际插入退出 0；有该记录时原 down 退出 3，明确报
  `Issue publication attempts exist; retain their reconciliation schema`。
  事务内移除 CHECK 的 1621 项后同样插入退出 3，命中
  `publish_attempt_message_kind_check`；回滚后恢复正向退出 0。
  tenant/principal/publish_attempt 最后均为 0 行，正式约束仍含 1621。
  四份原件在 `/volumes/data/kailo/tmp/project-issue-migration-boundary.ebkadn/`
  的 `positive.log`、`down-refusal.log`、`mutation-check-rejects.log`、`restored.log`。
- 原生成输入 `create-issue-gen.KgHorL` 的 `tools/gen.sh --check` 会话 25023
  退出 0，四侧生成与 Mobile 词条同步通过。原 `step_contract` 的历史比较代码
  在 2 CPU/2 GiB、只读、无网络的短命 SDK 内原样执行，真实 Git/tag 与候选输入
  均只读；退出 0：316 个 schema、匹配 3 个历史 schema，相对
  `contracts-v0.1.0`（`0ecbdc17984f0cfed36b7c7b8605c3f0532db3c0`）
  无破坏性变更。日志为
  `/volumes/data/kailo/tmp/create-issue-compatibility.dDGF6o/historical-compatibility.log`。
  该有限历史比较不证明旧 Core 能消费 CREATE_ISSUE，也不替代 full。
- 原 `tools/check-docs.sh /workspace/.design` 会话 88323 退出 0，七段全部通过；
  沿用已缓存镜像的 2 CPU/2 GiB 检查容器，源码只读，缓存和临时目录在 Data。

发布边界：运行配置的成员事件准入尚未开放 1621，未修改该配置；必须与对应
Core/Native/Relay 发布验收一起投递。本批没有真实浏览器任务创建截图、Windows
或 Mobile 安装验证，未执行最终 `check.sh --full`，未声明在线任务创建可用。

## 2026-10-12 原 Task 创建：契约与 Bridge 实现回执片段

四步结论：

1. 权威：`.design/03` 的 Buzz Community/event 权威与原 Projects 完整恢复要求。
   固定 Buzz `779af8886caae1317b4de962082429867ab61503`：
   `desktop/src/features/projects/issueMutations.ts::publishProjectIssue` 以 1621、
   `body.trim()` 和 `projectIssues.mjs::buildGitIssueTags` 发布；后者生成
   `a=30617:<repo owner>:<d>`、`p=repo owner`、trim subject 和 category 的 t tag，
   标题按 JavaScript UTF-16 长度限制 256。该版本
   `crates/buzz-sdk/src/builders.rs::build_git_issue` 使用 UTF-8 字节标题限制及固定
   64 KiB 正文限制，不等同原页面消费者，因此复用原 EventBuilder 生成同一原事件，
   不更改 SDK，不增加另一协议。
2. 影响：原 ProjectsPublishRequest 增加 CREATE_ISSUE、title/body/category；
   targetEventId 为既有仓库 head id，三个新字段对旧 operation 禁止，旧字段对
   CREATE_ISSUE 禁止。body 必填且可空，标题非空且 trim 后不超过 256 UTF-16 单元。
   category 仅 issue/change-request/improvement。四侧由原 tools/gen.sh 生成；
   原 projects-publication.sample.json 保留全部旧请求并追加三类 Issue。
   TS 原往返投影增加三字段，Go/Dart/Rust 原往返直接消费同一扩展样本。
3. 副作用：Bridge 只构造/核对原 Relay 事件，不保存正文/hash、不派发外部请求。
   publication_builder 对原 repo 事件核对 id、30617、签名和非空 d；当前签名 actor
   可以不同于 repo owner，必须 channel_id=None，不能借 repo 的 buzz-channel 获得
   Workspace 权限。Core 另查当前 head、执行 fresh 准入、正文/NIP-11 限制和原发布账本。
   issue_publication_matches 核对已接受原 1621 签名、原 a/p 坐标与四 tag、trim
   title/body/category；Core 另比对持久 parent_event_id，避免同 key 换正文假成功，
   不依赖已被替换的旧 repo head 再次可读。publication_observed 对 1621 仍要求精确
   id/actor/kind/签名；结果不明只观察，不从此函数重发。
4. 边界：缺字段、混用字段、未知类别、空标题、UTF-16 超限、坏签名、错误目标/id/kind、
   缺 d 和非空 channel 拒绝；合法空正文、非空正文、中文/代理对标题、非 repo owner
   的当前 actor 保持原行为。缺发布证据仍 UNKNOWN；实际 runtime member_event_kinds
   未投递 1621/30617/30621，此源码检查不等于线上准入或浏览器创建验收。

精确实现候选原基底 `13273932c77164d8498d9f5e8341230d286e3ee3`，
tree `230b82c564d405b9b785e726cda5d8ac69b7d2b9`，8 路径 +450/-14。
公开生成文件原已有其他 dirty，仅机械选入本批实际生成的 Issue hunks，不覆盖旧内容；
私有候选四生成采用 HEAD 全部 schema 加本批唯一 schema 的原完整生成输出，
不含原公共 Rust roundtrip 的其他 dirty。生产 bridge 与此候选逐字相同。

资源与生成：原 schema SDK 为 2 CPU/4 GiB/equal swap、UID 1000，开始仅 sleep；
宿主 available 约 34 GiB。首次21046离线 ENOTCACHED，继而63963 exit255 无输出，
都保留为环境失败，不能推断 schema 不成立。按主线指定换用已存在的
`kailo-wren-query-sdk-itgs2n`，实核 4 CPU/4 GiB/equal swap、UID 1000、开始仅 sleep，
其原 HOME=/cache/home 未修改。/cache 与 /work 均来自 Data，不安装依赖或新建镜像。
已缓存 quicktype 23.0.171 仅通过私有 node_modules 链接复用。

准确私有生成根：
`/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N/create-issue-gen.KgHorL`。
容器路径 `/work/create-issue-gen.KgHorL`。

```sh
docker exec -w /work/create-issue-gen.KgHorL -e npm_config_offline=true -e npm_config_cache=/cache/npm kailo-wren-query-sdk-itgs2n bash tools/gen.sh
```

原82284真实 exit0，Dart/Rust/TypeScript/Go 四侧均 OK；i18n 原后续消费者也完成。
本批没有手工编写生成类型，也没有把生成成功当作四语言往返成功。

实际往返与原消费者边界：

- TypeScript：原 `test/roundtrip.test.ts`，过滤 `^Projects publication`，
  `node --test --experimental-strip-types --test-name-pattern="^Projects publication" test/roundtrip.test.ts`。
  正向 1/1。私有最小破坏只从原投影去掉 body，fc0842 exit1，确实捕获三个新增
  Issue 的空/非空 body 丢失；原样恢复并与正式测试 cmp0，431e3f exit0、1/1。
- Go：原 Worker `go test ./internal/contracts -run '^TestProjectsPublicationRoundtrip$' -count=1`，
  GOCACHE=/cache/go-build、GOMODCACHE=/cache/go-mod、GOPROXY=off。
  原25564中 Go 子命令实际输出 `ok apps/worker/internal/contracts 0.001s`，退出0。
  外层25564最后因随后 Dart 输入缺失退出1，不能称整条25564成功。
- Dart：同 SDK `dart pub get --offline` 成功；首次原test因小快照漏现有
  `lib/shared/contracts/contracts.dart` 导出入口而失败，未改产品。复制同 HEAD 原出口后，
  `dart test test/roundtrip_test.dart --plain-name "Projects publication preserves native metadata and exact head reference"`
  原78267真实 exit0、1/1。
- Rust：四侧生成已经成功；主线原80488前半运行 Bridge `projects::`，主线确认
  当前源码与SDK cmp0、6/6通过。该会话后续 Core 5/5、退出 0，未另开重复 Cargo。
  Rust contracts 原 `projects_publication_preserves_native_metadata_and_exact_head_reference`
  随后由主线会话 15172 实际执行，退出 0、1/1，55 filtered；不是以生成或
  Bridge 用例冒充该往返通过。
- 新 Bridge 两个原消费者用例覆盖真实构造/签名/验签、三类别、空/非空正文、不同
  repo owner/actor、幂等内容差异和原 UTF-16 标题边界；原 receipt 用例增加1621。
  未执行在线 Relay/BFF 真实发布，未修改 runtime allowlist。

私有日志（均在上述生成根）及 SHA-256：

- `ts-mutation.log`：`b9060f10538d11171d58660b066b37f193486911a4c4eeff7b7bbeba71ad6673`。
- `ts-restored.log`：`71552a186c7b642b43b9defb9b760b807c359eee0e98092ff25ae4001366577f`。
- `dart-restored.log`：`d4cb0b30e893fdf5b5f4f49fc6cae1e9e5ccf2398778629f62d1d777bfde7637`。

生成和首轮 Go/TS 输出原件为本席工具会话82284/25564，不另编造不存在的日志文件。
本片段是实现后证据，不是新规格；未提交/部署，不替代主线合批 Core、迁移与文档门禁。

该八文件候选已按原相同 blob 重定位到
`f022696008fc73b6dbab8673e5eb6d5ae05913ee`，私有 `rebased.index` 树为
`5cd5748e593f4353fdcacdee35e99472eb63b5ed`，原句柄 11720 退出 0。
主线初次整合候选在 `/volumes/data/kailo/tmp/project-issue-integration.Aj97eH/index`，
原句柄 66924 退出 0、28 路径 +1429/-33、diff 检查通过；这是后续回执更新前的
候选统计，不是已提交或已部署产物。公共索引原三项 +32/-135 保持不变。

### 2026-10-12 原 Tasks 创建共享 UI 与 Native 消费者

前端候选基底 6b905437a884d74057d5af31e30e099ecfd81566，14 路径 +741/-12；不含主线 Rust/schema/四侧生成。本段供主线追加原 projects-creation.md，不并发改该回执。

#### 四步影响与异常

1. 权威：固定 Buzz 779af8886caae1317b4de962082429867ab61503 的 desktop/src/features/projects/ui/CreateProjectIssueDialog.tsx::CreateProjectIssueDialog、desktop/src/features/projects/ui/CreateProjectWorkItemDialog.tsx::CreateProjectWorkItemDialog、desktop/src/features/projects/issueMutations.ts::publishProjectIssue/useCreateProjectIssueMutation 决定原表单及 kind 1621 载荷。Web SERVER 经 BFF，Desktop CLIENT 本机签名/Community Relay 准入不变。
2. 影响：ProjectChannelHome Tasks 创建动作进入 ProjectHomeWorkspaceSheet 原 Dialog，经既有 ProjectsHost.publish，再由 loadProjectWorkItems fresh 精确回读进入共享 Issue 详情。Repository.id 是 owner:dtag，不是事件 ID；targetEventId 取 fresh 目录中已验证的 kind 30617 原始 head.id。Native 再验证签名与当前 coordinate head，沿既有 publishProjectIntent 持有/恢复同事件；不借 workspace 或 ReposWrite 权限。
3. 副作用：原 success toast 延至作者/body/tags/repo/current viewer 回读一致且选中详情之后。浏览器只保存 scope/project/repo 下意图键、请求摘要及事件引用，不保存正文/签名事件；不是 Core 审计正文摘要。坏 JSON、存储异常、变更输入、回读缺失或不符保持 UNKNOWN，不换意图重发。
4. 边界：空/无权目录无创建动作；原双击锁只提交一次；scope abort 后不选详情、不成功反馈。ACK 丢失/重启仅观察原 event ID；恢复需用户重输相同原输入，因为不保存正文。确认详情后才释放意图。Mobile 仅生成同源词条，没有创建入口/设备验收。

#### 原版四类映射

- 原样保留：两原 Dialog 的结构/class、类别/仓库/标题/正文、焦点、submitInFlightRef；desktop/src/features/projects/projectIssues.mjs::buildGitIssueTags 原 a/p/subject/t 标签顺序。
- 共享迁移：上述两个 Dialog 与实际 Sheet/header 消费；desktop/src/features/projects/projectModels.ts::selectProjectRepository。Web/Desktop 共用 React 主体，Native 仅签名/Relay 适配。
- 已授权治理改造：原 mutation 接既有 typed CREATE_ISSUE；fresh scope/head、意图引用、同事件 UNKNOWN 恢复、回读与成功反馈顺序；原英语经 TS 唯一词条生成 Dart，本批只 15 key 增量。公开 TS/Dart 旧暂存和未暂存修改未覆盖。
- 缺失需恢复：PR 创建、任务更新/指派/关闭、Git/Files 相邻功能仍未接；本批未部署、未真实浏览器创建、未 Windows/Mobile 验收，不称完整 Projects。

#### 实际检查与失败保留

证据目录 /volumes/data/kailo/tmp/web-tooltip-shared.zzIWe9/project-issue-create.hfLmuC。既有 kailo-web-thread-tooltip-sdk 为 4 CPU/8 GiB、memory+swap 总限额等于内存（无额外 swap）、UID1000；检查前只有 sleep，可用内存约33GiB。TMPDIR/npm cache 均在 Data 的 /candidate/reminder-consumers.RcN79Y 子目录，无新镜像/安装/全量。原脚本 positive.sh 串行分别记录：

```text
platform: node node_modules/typescript/bin/tsc --noEmit -p tsconfig.test.json
platform: node node_modules/vitest/vitest.mjs run test/project-inbox.test.tsx --no-file-parallelism
web: ./node_modules/.bin/tsc --noEmit
desktop: ./node_modules/.bin/tsc --noEmit -p tsconfig.json
desktop: node --import ./test-loader.mjs --experimental-strip-types --test src/features/platform/projectsTransport.test.mjs src/shared/api/relayClientUnconfirmedResend.test.mjs
```

- 64542 exit1，positive.log：误使用公共旧 generated 脏内容导致类型错误；遗漏 selectProjectRepository、测试类型及 repository.id/head.id 混淆导致6个 DOM 失败。修正真实源/调用，私有输入采用主线 HEAD+新schema 原完整生成，未覆盖公共 generated。
- 52613 exit1，restored.log：共享/Web/Native类型分别0，共享41/41；Native16/17。坏签名 fixture spread 带入 nostr-tools 内部 verified Symbol，改真实 wire JSON 序列化后排除该标记，未改生产验签。37992 exit0，native-final.log 17/17。
- 89740 私有删除回读正文相等校验，exit1，40pass/1fail（wrong-body被接受）；还原cmp0，80921 exit0，restored-final.log 41/41。
- 94670 私有删除签名前 current head.id 比对，exit1，3pass/1fail（替换head未拒绝）；还原cmp0，15992 exit0，native-restored.log 17/17。
- i18n.log 首次 login shell 重置 PATH，exit1/Dart formatter unavailable；改沿同 Wren SDK 原非login sh、原 HOME/PATH，47877 exit0，i18n-restored.log。原 python3 tools/gen-platform-i18n.py 及 --check 全通过；独立 HEAD+15词条输入，TS15/Dart48行精确增量，无工具变更。
- React act 警告保留。DOM/Native签名测试使用隔离fixture，不等于真实 Relay/Core HTTP 跨端验收。Core结果由主线另列，本检查未运行最终full，未更新部署/截图状态。

源码私有候选 final.index，tree e395212e1f1220a70bba85f1d2b2a73590ea25f9；source.patch SHA256 ac0a38de5ec9d8c800c574f9e3c59bdff59d4eea6f7ae605b4cca90c9970ad06。原公共index不变。

#### 同批交叉复核纠偏

原 CreateProjectIssueDialog.handleCreate 只判断 TransportError，遗漏 BffError(ErrorClass.Unknown)；本批改复用原 isOutcomeUnknown，不造第二错误体系。BFF UNKNOWN、网络 UNKNOWN 与已有本地 UNKNOWN 后恢复被拒均保持结果不明；首次发布前明确 DENIED 可清理未发意图并显示原创建失败文案。原 UI 使用 inline errorMessage，不新增 toast 或布局。

Native 原 CREATE_PROJECT/CREATE_REPOSITORY/DELETE 校验同步拒绝 title/body/category 混用，保持既有合同一致。直接修改原两个校验分支，不新增包装层；实际消费者覆盖三个操作的三个专属字段均在读取/准入/签名/发布之前被拒。

- 88590 exit2/outcome-final.log：新增检查误写不存在的 ErrorClass.Permission，按原生成枚举纠正为 Denied，保留原失败。
- 70650 exit1/outcome-positive.log：类型0、41通过/4失败，检查误查 toast.error；固定原组件实际消费为 inline errorMessage，改断言真实 DOM 文案，不改生产呈现。
- 7522 exit0/outcome-restored.log：共享类型0、原45/45、Native类型0、原18/18；末行 TYPES=0 DOM=0 NATIVE_TYPES=0 NATIVE=0。
- 14598 exit1/outcome-mutation.log：私有恢复旧 instanceof catch 后原分类4项2通过/2失败（BFF UNKNOWN被误报失败）；私有删除Native字段拒绝后原5项4通过/1失败（准入调用1而非0）。未降低超时/断言。
- 正式源码精确还原两处私有变异且 cmp0，32361 exit0/outcome-restored-final.log：原分类4/4（其余41项本次过滤，已由7522通过），Native原5/5；DOM_RESTORED=0 NATIVE_RESTORED=0。所有本批非词条源与私有已验输入再次逐路径cmp0，类型及其它同字节证据沿用7522/52613，不重复全量。

## 2026-10-12 原 Tasks 评论发布：Core 与 Bridge 消费者

本节记录源码实现，当前尚未完成本批生成、编译、原消费者正反验证或部署。
不以此前任务创建、只读评论或旧契约往返结果覆盖本批评论写入。

四步影响结论：

1. 权威为 `.design/09` §3 的原 Projects/Relay 事件边界及 DD-81 发布意图。
   固定 Buzz `779af8886caae1317b4de962082429867ab61503`，
   `desktop/src/features/projects/hooks.ts::createProjectIssueComment`、
   `desktop/src/features/projects/hooks.ts::useCreateProjectIssueCommentMutation` 和
   `desktop/src/features/projects/projectIssues.mjs::nextProjectIssueCommentCreatedAt`：
   kind 1，正文 trim，原 e/root、a，repo owner→issue author→原 recipients→mentions
   的 lowercase Set 顺序；时间为 now 与同作者历史评论时间加一的最大值。
   不从 issueMutations.ts 推导评论行为，不借仓库引用授予 Git 或 Workspace 权限。
2. 既有 ProjectsPublishRequest 增加 CREATE_ISSUE_COMMENT、mentions、原附件类型；
   targetEventId 指向真实 1621，body 为宿主已组成的完整 Markdown。旧操作拒绝评论
   专属字段。四侧沿原生成入口，原样本追加带媒体评论，TS 原字段投影同步两字段；
   不手写另一套类型。Bridge 原 sign_project 消费新分支，Core 原 publish_project、
   publication_target 和 publish_reconcile 消费同一 kind 1。原数据库约束已允许 1，
   不新增表或迁移；Core 的 publish_attempt 仍仅保存身份、目标和事件引用。
3. Core 在签名前读验签 issue、真实仓库 head 和同 issue/repo/当前协议作者的
   最新评论；Bridge 再核同一证据。当前用户、scope、Relay 准入、正文大小、
   NIP-11、签名前 fresh 和原 DISPATCH 均沿已有消费者。媒体仅复用原 render 的
   当前 Community 校验与 imeta，不再追加第二份 Markdown；原外部 GIF 的空 hash
   附件沿原 buildImetaTags 只保留 Markdown、不签 imeta，非空 hash 仍严查本地来源。
   同 key 已接受请求
   回读原签名评论和不可变 issue，核瞬时正文、mentions 与媒体，不存正文或正文摘要；
   不要求今日 repo head 仍相同。UNKNOWN 只走原事件对账，早于最新时间选择返回。
4. 空白正文、混用字段、错误目标、坏签名、跨 issue/repo/作者、媒体异源拒绝。
   同 Human 的不同协议钥匙不合并为同作者；最新评论缺证据或读取失败不能重发。
   递增时间溢出拒绝。缺/旧事件不能报成功；原先已允许的独立创建/删除组合保持。
   暂未运行真实 Core/Relay HTTP、并发多用户或设备安装验收，也未更新线上产物。

本批源码八路径局部 `git diff --check` 已 exit 0；这仅是差异格式检查。
原集中生成由主线调度，首次 SDK 出现 shim disconnected 后输出不齐，不能记生成通过。
新增原 Bridge 评论/签名/回执用例和 Core 媒体消费者用例均在实现之后补入，等待同一
最终输入的受限 SDK 验证及私有破坏、字节还原结果。本节不宣称完整 Tasks 已恢复。

交叉复核发现并在原消费者修正：当前及固定 Buzz 的
`crates/buzz-relay/src/handlers/req.rs::filter_to_query_params` 仅将小写 e 下推 SQL，
`crates/buzz-relay/src/api/bridge.rs::query_events` 在 SQL LIMIT 后做 a/E 过滤。
故最新时间读取不能用 a/E + limit 1 将空结果解释为无历史。Core 原 latest_comment
改用真实 kind 1/当前作者下推查询、现有 NIP-11 max_limit 与原 until/before_id
复合游标逐页读取；每页验签、核排序和严格前进，再按原 issue/repository 匹配。
kind 1 在原 ingest 中为 global-only，不借此访问 channel 内容。原 query 预算或请求
失败直接拒绝，不静默截断为完整历史。两页大写 E、相同秒事件及重复游标检查已补入
原 Core 测试，但当前还没有执行结果。

同一发布后的必要回读也存在 a 后过滤短页误判：Core 原 query_inner 的
WORK_ITEM_ACTIVITY 现在先按其原全局 kind 集合读取 SQL 页，复用上述原 keyset
验签、顺序和游标校验，再按首 a 筛入当前请求仓库。输出填满原 NIP-11 cap 或
未过滤历史真正耗尽才返回；对外 ProjectsPage 及 since/until 合同、其它 view 不变。
原共享 enumerateProjectEvents 的同秒边界拒绝仍保留。新增原 Core HTTP fixture
实际调用 IdentityClient::query→work_item_activity_page，首 SQL 页是其它仓库、
第二页才是目标评论；检查真实第二次请求 until/before_id，尚未执行，不当线上验收。

### 本批后置验证读回（2026-10-12）

上述“尚未执行”为实现时检查点。随后实际使用已有不可变 SDK
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
UID/GID 1000、4 CPU；契约容器 4 GiB，Rust 容器 8 GiB，memory+swap 总限额
均等于内存，无网络、只读根，源码、依赖、target、临时目录及日志均在 Data。
未修改 HOME，未安装新镜像；Dart 实际写入的 `/.dart-tool` 单独绑定 Data。
检查前核对构建进程与 CPU/内存压力，原 containerd 预复制暂停，不并发写同一
Rust target。四侧输入是当前 HEAD 的完整 schema 加本批请求与样例；独立候选
保留 HEAD 已有消息作者类型，不把公共生成文件中原有的其他 dirty 删除带入。

- 原 `tools/gen.sh` 和 `tools/gen.sh --check` 均退出 0，Rust/Go/TypeScript/Dart
  同步及 Mobile 同源词条检查通过。首次退出 255 的原因是只读根拒绝创建
  `/.dart-tool`，并非契约已被证明错误；修正实际挂载后保留原生成脚本重跑。
- TypeScript 原 `Projects publication` 1/1、Go 原
  `TestProjectsPublicationRoundtrip`、Dart 原 `Projects publication` 1/1，均退出 0。
  私有输入暂时删除 TS 字段投影中的 mentions/attachments，原断言实际退出 1、
  0 passed/1 failed；原样恢复并 cmp 0 后，1/1、退出 0。
- 原 `step_contract` 实际退出 0：四侧同步，相对 `contracts-v0.1.0` 无破坏性变更，
  316 schema、匹配 3 个历史 schema。历史匹配范围不证明旧 Core 能消费新操作；
  上线仍须先更新 Core，再更新提供新写入的 Web/Desktop。
- `cargo test --locked --offline -p collab-bridge projects:: -- --nocapture`：8/8。
  `cargo test --locked --offline -p platform-core --bin platform-core project -- --nocapture`：
  19 passed、7 ignored、419 filtered；7 项独立数据库演练明确未执行，不记通过。
  本批媒体、同秒游标和两页实际 HTTP 消费者均在 19 项中通过。
- Rust 原 contracts 的 `projects_publication_preserves_native_metadata_and_exact_head_reference`
  1/1 通过，55 项过滤。四侧往返均有本批样例，不借之前任务创建结果充数。
- 首次 Rust 格式检查退出 1，实际容器 rustfmt 纠正后编译通过；首次 clippy
  退出 101，指出只取第二段时无需 splitn，改原表达式为 split，不添加 allow。
  `cargo clippy --locked --offline -p collab-bridge -p platform-core --all-targets -- -D warnings`
  修正后实际退出 0。

契约日志根为
`/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N/issue-comment-gen.fyljf9`，
对应 `contract-positive.log`、`contract-compatibility.log`、`contract-ts-mutation.log`
及 `contract-ts-restored.log`。Rust 首次/格式修正日志为
`/volumes/data/kailo/tmp/project-issue-comments.DbJdB5/rust-positive.log` 和
`rust-formatted-positive.log`；修正后 clippy 日志为
`/volumes/data/kailo/tmp/cells-native-closure.KxbRvt/receiver-worker.W4qug0/tasks-comment-clippy-restored.log`。
这些均为源码与原消费者验证，不是新部署、真实三人多 Agent 协作或设备验收。

### 同批原评论 UI / Native 消费者（2026-10-12）

1. 权威：沿 REQ-24、DD-75/77 与设计 `09` Community 协作面，固定 Buzz
   `779af8886caae1317b4de962082429867ab61503` 的
   `desktop/src/features/projects/hooks.ts::createProjectIssueComment` /
   `useCreateProjectIssueCommentMutation`、
   `desktop/src/features/projects/ui/ProjectIssuesPanel.tsx::ProjectIssueDetail`
   / `issueMembers`。不把 kind 1 评论改为 Workspace 或 ReposWrite 操作。
2. 影响：共享 ProjectIssueDetail 的原 ForumComposer 经首页 WorkspaceSheet、
   Projects 目标页、Inbox 三条真实父链使用同一 ProjectsHost。Web 传原正文与附件，
   Native 已拼好媒体 Markdown；既有 Host 回调增加实际宿主标识，Tasks 只补一次媒体
   Markdown，不改变原 Pulse 正文。成员包含原 Agent，不据成员展示推导执行权限。
3. 副作用：先持久化 scoped key / 请求摘要 / event 引用，正文不进恢复槽；原 typed
   publication 发出后精确回读本人、kind、正文、e/a/p/imeta tags 与 reducer 评论 id，
   才清理引用、更新列表/详情并显示原成功通知。UNKNOWN 只观察同 key / 同 event。
4. 异常：双点不重入，空正文拒绝；坏 JSON、Storage 拒绝、改写恢复请求保持 UNKNOWN。
   fresh 读取失败隐藏正文，scope 卸载 abort 后晚响应不清理、不显示成功。Native
   复用原 enumerateProjectEvents，在原 runtime limit 下整页验签后筛选 e/E 与仓库；
   同秒 bucket 无法证明完整时拒绝，不用固定放大 limit 掩盖历史遗漏。

四类原版差异分别是：原样保留评论末尾 `px-6 pb-6 pt-4`、ForumComposer
`border border-border/60 bg-background/45`、成员来源、原 e→a→p→imeta 次序；
共享迁移原评论详情、原媒体 helper 和事件 reducer，三个入口与双端同源；已授权治理
适配为 BFF SERVER / Native CLIENT、typed 附件校验、持久意图、fresh 授权、UNKNOWN
与中英词条，未伪造缺 hash 的 imeta；assignment/status 写入、PR 评论、Git、完整管理
页、Mobile 评论、原全局 mention 搜索仍为独立缺项，不宣称本批完整恢复。

使用原 `kailo-web-thread-tooltip-sdk`（上述固定 SDK 镜像），4 CPU / 8 GiB，
memory+swap 总限额等于内存（无额外 swap），UID 1000、network none。检查前可用
内存 37 GiB，无 Cargo/rustc/Vitest/tsc 检查进程；仅启动该原 sleep 容器，不启动其余
数据库依赖 SDK。TMPDIR 与 npm cache 显式指向 Data 私有输入；不改 HOME、不安装
依赖。实际 Node 24.21.0、TypeScript 5.9.3、Vitest 4.1.11。TS 合同使用上述原生成
目录的完整文件，cmp 0，没有覆盖公共 generated 或原三项 staged。

串行脚本与日志位于
`/volumes/data/kailo/tmp/web-tooltip-shared.zzIWe9/project-issue-comment-check/`：

- 共享原 `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.test.json`；
  `node node_modules/vitest/vitest.mjs run test/project-inbox.test.tsx --no-file-parallelism`。
- Web 原 `./node_modules/.bin/tsc --noEmit`；
  `node node_modules/vitest/vitest.mjs run src/platform/ui/PulsePane.test.tsx --no-file-parallelism`。
- Native 原 `./node_modules/.bin/tsc --noEmit -p tsconfig.json`；
  `node --import ./test-loader.mjs --experimental-strip-types --test src/features/platform/projectsTransport.test.mjs src/shared/api/relayClientUnconfirmedResend.test.mjs`。

首轮 `17547` exit 1：共享新 mock 返回 Promise 未标注，Web 新检查误从未导出的入口
导入 ForumComposer；分别纠正既有 ProjectsHost 类型与真实 host 导入，不放宽生产
接口。共享 48/48、Native 类型 0，但 Native 24/25 还揭示实际恢复白名单漏 kind 1；
原 `relayClientSession.ts::publishProjectIntent` 仅增加这一原 kind，调用方本人验签、
正文/tags 精确比对与 UNKNOWN 同事件观察均保留。原失败 `positive.log` 不覆盖。

末版 `39734` exit 0：三处类型均 0、共享 48/48、Web 14/14、Native 25/25。
保留既有 React act 警告。仅私有副本移除恢复白名单 kind 1，`19041` exit 1，
原评论 UNKNOWN 同事件恢复断言失败（24 passed/1 failed）；apply_patch 还原且
cmp 0 后，`4275` exit 0、25/25。末版 20 个非词条源/检查文件与正式字节 cmp 0，
词条与精确私有候选 cmp 0，未改变超时。三份末版日志 SHA256：
`final-positive.log` 为 `8f6a32087780703146aa26ec27ac9d1f095b18f462d78d36f90293133821574d`；
`native-negative.log` 为 `87c2bfe71173385300ea6a97d7481d54397c9026f5c1afe67bf67afea7f90f18`；
`native-restored.log` 为 `52af8a57ffb14fc35039f5a27cdfd2bb2250a5d414778ba08901fc5e3f637ef1`。
Native Relay 为签名事件夹具，DOM 为真实共享组件加宿主夹具；不替代线上 HTTP、
Windows 设备或真实评论验收。本批未构建/部署、未截图，既有 full 失败门禁仍保留。

主线补充同批 Bridge 反证：私有副本移除原 imeta 拼接，原 8 项变为 7 passed /
1 failed、exit 101；apply_patch 还原且 cmp 0 后 8/8、exit 0。原日志为
`/volumes/data/kailo/tmp/cells-native-closure.KxbRvt/receiver-worker.W4qug0/tasks-comment-bridge-mutation.log`
及同目录 `tasks-comment-bridge-restored.log`。当前 full 配方对应的 `7c1a` SDK 标签
不存在，只有本次实际使用的旧 `10ad` image；这是独立环境门禁，不重新打 tag 冒充
规范 full 已运行或通过。

2026-10-12 07:07 UTC 对末版代码树
`1d4b27f730552ff99fbd5f9c21b931fdd425eec4` 实际执行原
`./tools/check.sh --full`，投递 `CHECK_CPUS=4`、`CHECK_MEMORY=8g`、
`CHECK_NETWORK=none`、Data 上的 `CHECK_CACHE_ROOT` 与 `TMPDIR`，使用原配置的
`BUILDX_BUILDER=kailo-core-data`。原入口输出：

```text
ERROR: no builder "kailo-core-data" found
容器执行拒绝：无法读取已有 builder：kailo-core-data
```

日志为 `/volumes/data/kailo/tmp/project-issue-comments.DbJdB5/full.log`。
当前配方 `7c1a6a138f80e2490b77617fba9525f0a7ca42bdc527eac9129f0204f4328f10`
对应镜像不存在；没有重标旧 SDK、没有启动新镜像构建。原脚本清理自身导出目录
完成后，07:29 UTC 原句柄实际返回 exit 2；全量门禁未通过，而非通过或跳过。
后续同 daemon 双身份核对确认：该 builder 登记在 sudo 身份下且已停止，普通
Docker 身份看不到登记。已有容器及其 Data 缓存仍在，不是需要新建 builder；
后续须统一原 Docker 调用身份并恢复已有受限节点，再取得正确配方镜像。
本批只允许记录源码检查点，不据此发布、增加实际业务验收完成度或声明生产就绪。

最终退出码补记后，原 `tools/check-docs.sh /volumes/kailo/.design` 在既有
`10ad` SDK 内实际 exit 0，七节全部通过。容器只读挂载实际工程和设计，
UID 1000、2 CPU、2 GiB memory=memory+swap、network none；临时目录及 npm
离线缓存均绑定 Data。日志为
`/volumes/data/kailo/tmp/tasks-comment-final-docs.Mzss3f/docs-cached.log`。
首轮遗漏 npm 缓存投递，停在 npx 准备阶段后主动终止、exit 137；没有 OOM 或
文档通过结论。修正实际 mount 后完成的是文档门禁，不是重新执行或通过 full。

### 2026-10-12 原 Reviews 普通评论共享闭环

固定输入为 `236bdbf3e688424e1ede3a2e556e71e0236187fa` 加本批精确增量；
固定上游为 Buzz `779af8886caae1317b4de962082429867ab61503`。
依据 REQ-24、DD-75、DD-77、DD-80；不扩展仓库管理或 Review 决策权限。

1. 原权威：`desktop/src/features/projects/hooks.ts::createProjectPullRequestComment`
   和 `useCreateProjectPullRequestCommentMutation` 发布普通 kind 1 评论，根为
   已签 kind 1618 PR，不是 kind 1621 Task；原
   `desktop/src/features/projects/ui/ProjectPullRequestsPanel.tsx::ProjectPullRequestDetail`
   经 `handleCommentSubmit` 消费原 ForumComposer。
2. 调用影响：共享 `ProjectPullRequestDetail` 同时由 `ProjectsView`、
   `ProjectInboxDetail`、`ProjectHomeWorkspaceSheet` 的原详情分支消费，
   本批逐一接入已有 ProjectsHost。原 e/root、a/repository、保序去重 p、
   imeta 与正文媒体保留；正文只追加一次媒体 markdown。普通 PR 评论没有
   decision，因此使用原签名时间，不借用 Tasks 的上一条评论时间递增。
3. 治理适配：唯一 `ProjectsPublishRequest` 增加
   `CREATE_PULL_REQUEST_COMMENT`，原四侧生成入口生成类型。Core/Web 和
   Native 同验签 kind 1618 目标及当前仓库坐标，沿已有本人签名/托管钥、
   Community MessagesWrite 准入与 publish intent；不扩大 ReposWrite，
   不添加正文数据库或正文审计字段。`comment_target_kind` 将两种根精确区分，
   既有 ACCEPTED 恢复仍读原事件核对实际正文和 tags。
4. 失败与状态：先持久化原未确认引用和请求摘要，再调用真实发布宿主；
   双点拒绝、UNKNOWN 保留同 key/event、编辑重试拒绝，空回读或正文不符
   不成功、不清引用；只有精确活动回读后才清理并显示原成功反馈。
   scope 卸载/撤权终止当前页面反馈，未证明目标归属不允许派发。

四类差异：原样保留原 composer 的 `px-6 pb-6 pt-4` 外壳与
`border border-border/60 bg-background/45` 呈现、原成员集合和普通评论
e/a/p/imeta 次序；共享迁移是原三详情消费同一评论实现和同源词条，
已删除无生产消费者的旧 `buildProjectIssueCommentTags` 别名，Task/PR
实际消费同一个 `buildProjectCommentTags`；授权治理差异是 typed operation、
fresh 读授权、持久未决意图与精确回读确认，不另造界面；仍缺 inline comments、
request-changes/review decisions、Git 相关能力及其执行消费者，不能称 Reviews
完整恢复。Mobile 本批只有生成契约，不等于页面已消费。

验证输入位于 `/volumes/data/kailo/tmp/web-tooltip-shared.zzIWe9/project-pr-comment.N4cguf`。
所有工具复用原 SDK 镜像 `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
非 root、network none、Data 源/缓存/tmp；Web 与轻量四侧检查 2 CPU/4 GiB，
Core 4 CPU/8 GiB，memory+swap 总限额等于内存（无额外 swap）。不改 HOME，
不装新依赖、不新增镜像、不降低 Cargo 并行；唯一 Cargo 窗口在队友检查终态后取得。

- 原 `bash tools/gen.sh` 28228 实际 exit 0，四侧全部生成；输入是 HEAD
  contracts 加本批 schema/sample，未覆盖公共四个继承脏生成文件；无新词条，
  私有 i18n 伴随投影不进入本批。
- 原聚合 87815 exit 1：共享 TS 5.9.3 `tsc --noEmit -p tsconfig.test.json`、
  Web `tsc --noEmit`、Native `tsc --noEmit -p tsconfig.json` 均 exit 0；
  Native `node --import ./test-loader.mjs --experimental-strip-types --test
  src/features/platform/projectsTransport.test.mjs src/shared/api/relayClientUnconfirmedResend.test.mjs`
  28/28，TS 原 Projects publication 往返 1/1。原 DOM 57/59，PR 成功反馈
  读取设备语言而非宿主 locale，且失败后 spy 未清理影响后续 Task 用例。
- 51512 的测试清理顺序调整导致 43/59，另有 2 个未处理错误，实际 exit 1；
  该调整引入额外语言存储项，已撤回，不修改原 intent 数量断言。正式 PR Body
  改为既有 `useUiT` 消费宿主语言，测试增加原 spy 清理；32823 原共享类型与
  `vitest run test/project-inbox.test.tsx --no-file-parallelism` 实际 exit 0，
  59/59。随后旧别名删除，45156 类型加原 `-t "PR|comment"` 11/11 exit 0，
  48 个无关用例未在这次窄验执行。保留原 React act 警告，不提高超时。
- 私有副本仅删除最终 readback 的 `published.content !== body`，83899
  `-t "keeps PR UNKNOWN"` 精确 1 failed/exit 1：错误正文被误认成功。
  apply_patch 还原、与正式源码 cmp 0，13626 同一用例 1 passed/exit 0；
  未对生产数据或公共源码做变异。
- `rustfmt --edition 2021` 25852 exit 0，仅整理本批三个 Rust 文件。
  首轮 Core 聚合 41327 exit 1：私有快照漏 collab-bridge 的本地
  buzz-core/buzz-sdk 依赖，四条命令均 manifest 加载 exit 101、无断言执行；
  只补固定 HEAD 原依赖，不改生产 Cargo 配置，失败保留于 `core-positive.log`。
- 5376 原聚合实际 exit 1：Bridge 8/9，新真实签名用例证明自身 p 被底层
  builder 删除；Core test 与 clippy 各 exit 101，原因是私有输入缺原
  `tools/registry/capabilities.yaml`，没有执行 Core 断言。Rust contracts 原
  `projects_publication_preserves_native_metadata_and_exact_head_reference`
  1/1 exit 0。该轮后先释放共享 Cargo 窗口，不把失败静默重记为成功。
  下轮前已一次核对 Cargo 本地 path、全部 literal include 与 build.rs：
  直接取现有干净 236b 发布树原 registry；另从同 HEAD 取原 buzz-sdk
  `collaboration/docs/nips/NIP-MP.fixtures.json`，其为 SDK 自己的测试引用；
  其余 Core/契约/SQL 与原 ext_mcp.proto 已完整，不改 registry 或 build.rs。
- Go 原 `go test ./internal/contracts -run '^TestProjectsPublicationRoundtrip$'
  -count=1 -v` 1/1、原兼容片段 316 schema/3 历史匹配均 exit 0；67205
  聚合 exit 1 是 Dart 私有输入缺 `lib/shared/contracts/contracts.dart` 原导出，
  尚无 Dart 断言执行。仅补 HEAD 该导出后33719原
  `dart test test/roundtrip_test.dart --name "Projects publication preserves"`
  1/1 exit 0；不修改生成代码或更换样例，未重跑已过 Go/兼容。

实际签名检查还暴露底层 SDK 默认删除自身 p 标签：普通评论的原 recipients
明确包含仓库/PR 作者及 mentions，签名者属于此集合时不能静默删除。
`comment_publication_builder` 已沿现有 nostr `allow_self_tagging()` 保留原 tags；
原 Bridge 断言保留，未把期望改为丢标签。Core
`core/crates/collab-bridge/src/bridge.rs::sign_project` 实际消费该 builder。
Native `collaboration/desktop/src-tauri/src/commands/identity.rs::sign_event`
统一保留传入 tags，不增加 kind/e/a 产品特判；全量八处实际
`signRelayEvent` 调用覆盖消息、提醒、Projects 四分支、Pulse 和私聊显隐，
未发现依赖删除自身 p 的调用；无 p 的分支不受影响，项目精确回读不再被
签名层改标签。消息编辑自己的提及过滤仍由原独立 helper 负责。
这项是宿主签名语义的授权纠偏，不声称固定上游 identity 原文件已经具有该调用。
Native 文件原 `rustfmt --edition 2021 --check` exit 0，仅为解析/格式证据；
本批未编译 Tauri Rust、未做设备运行验收，不以 TS signer 夹具代替。

完整私有输入补齐且签名修正后，原 SDK 末轮 9930 实际 exit 0：
`cargo test --locked --offline -p collab-bridge projects::tests -- --nocapture`
9/9，通过原自身 p 标签断言；
`cargo test --locked --offline -p platform-core --bin platform-core projects::tests -- --nocapture`
7/7；`cargo clippy --locked --offline -p platform-core --bin platform-core -- -D warnings`
exit 0，三个本批 Rust 文件 `rustfmt --edition 2021 --check` 亦 exit 0。
日志为上述私有目录的 `core-final.log`，SHA256
`258781cd11ed2bba5cd0f5ba56b5bc4c70252453a7510b3123dd28bfa422141c`。
这轮没有重复已通过的 UI、四侧往返或全量检查；Core 仅运行原 projects 单元
消费者，不扩大为 HTTP/SpiceDB/Relay 端到端验收。5376 的真实签名失败与
本轮同断言恢复分别保留，共享正文匹配另有上述私有变异/还原证据。

此处只记录源码和隔离原消费者证据；本批尚未部署，旧在线 Web 截图不用于认领
新 PR 评论。既有 full 制品摘要失败门禁未被本批定向结果替代。

## 2026-10-15 发布点 c1e0dda7 实拍复验与剩余差距分界

部署为主线程发布点 `c1e0dda7`（Core `f7b4fdb7`、Web `eab92f1e`），包含 `944ee8c8`、
`0f61edc1`、`207fd498`、`158a7255`、`8b5f50b3`、`3f8ed782`。CI 节点 Playwright 经真实 SSO，
每个账号先在「设置 → 实验功能」打开工作流／项目／动态／论坛四个开关；截图在 CI 节点
`~/kailo-acceptance/pi-out/ver/`，已拷回开发机逐张查看。

- 所有者（seam-verifier）在 `pi-1015b` 创建任务「复验任务 1015v」：直接进入任务详情，页面与弹窗
  均无“结果不明”。Relay 读回 kind 1621 `995077571278fc03…`，标签含 `a`（30617 坐标）、
  `p`（仓库 owner 本人）、`subject`、`t=issue`，即 `944ee8c8` 的自身接收人修复在线生效。
- 同一任务「分配给我」后右栏为“已分配给我”、受派人 1；Relay kind 1 `fed8d69f…`（`e root`、`a`、`p`、
  `t=assignment`）。评论「复验评论 1015v」进入时间线，Relay kind 1 `984d64f9…`，评论框清空。
- Activity：介绍与动态卡片上下排列（`0f61edc1`），Repositories 分区（我的，网格／列表、宿主图标、
  `0 次提交 · 0 个审阅 · 1 个任务`）、仓库菜单“复制链接”、项目菜单“复制链接／删除项目”均在线可见。
- Inbox：kailo-qa-2 在「多人多Agent协作验收1014」提及 kailo-qa-1（kind 9 `c1746eeb…`，`p`→qa-1）；
  qa-1 打开收件箱即按原宽屏自动选中最新提及并打开详情，回复 kind 9 `da56ef2d…`（`e reply`）
  进入线程后输入框清空（`207fd498` 生效）。

### 剩余差距：哪些能做、哪些不能自行做

依据固定 Buzz `779af8886caae1317b4de962082429867ab61503` 与设计 09「原版 Projects 的公告与内容边界」。

| 项 | 上游事实 | 分类与下一步 |
| --- | --- | --- |
| 任务（Issue）状态流转 | `desktop/src/features/projects` 不发布 Issue 状态；`projectIssues.mjs` 只把已有 1630–1633 解析为状态。 | 原版本无此 UI，属原样保留，不新增“任务状态”写入。 |
| Review（PR）生命周期 open/draft/closed | `pullRequestReviews.ts::updateProjectPullRequestStatus` 签发 1630/1633/1632（`e root`、`a`、owner 与作者 `p`），只信 PR 作者或仓库 owner；1631 merged 排除（走 git）。Relay `required_scope_for_kind` 为 `MessagesWrite`。 | 缺失需恢复。需新增 typed 发布操作（契约、Bridge、BFF、Native 同链，保留 UNKNOWN 对账），并由主线程在 `BUZZ_MEMBER_EVENT_KINDS` 准入 1630/1632/1633。目前线上没有 PR（原版 PR 由 git 推送创建），完成后也只能先做源码与单元验证。 |
| Git 内容（概览／文件／提交／README／diff） | 原版由 Desktop Tauri 命令（`shared/api/projectGit.ts` → `src-tauri/src/commands/project_git_*`）经 Relay git transport 读取，Relay 侧 `api/git/binding.rs::resolve_repo_binding`、`transport.rs::authorize_git_read` 授权。Kailo fork 在 `collaboration/fork/upstream.yaml` 移除了这些命令。 | 设计 09 将其列为恢复范围，但必须保留原绑定与内容授权。Desktop：以本人 CLIENT identity 走原 Relay git 授权恢复，属缺失需恢复（原生工作量）。Web：没有 Tauri，需要 BFF/Core 以本人 SERVER identity 代读，设计 09 未定义该读取链，不能自行新增，须先有设计决定。 |
| 不允许的替代 | 设计 09：目录可见不等于仓库内容可读，公告写入、Added、`tenant.discover` 都不授予 Git 内容权限。 | 不得据公告/目录/Added 推断内容可读，不得接受客户端任意 Relay filter，不得伪造提交数或文件树。 |
| 本地仓库动作（终端、打开目录、clone/push/pull/merge、分支） | 只存在于 Desktop 原生命令。 | Web 原样不提供；Desktop 随上行 Git 恢复一并缺失。 |

本节只记录在线实拍与上游/设计分界；未新增代码，不把这些截图当 Git 内容或 Review 状态验收。
