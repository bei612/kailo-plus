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
