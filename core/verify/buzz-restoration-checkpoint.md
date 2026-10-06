# Buzz 共享界面与受治理私聊：开发检查点

## 2026-10-06 审计状态同源中英文与未知结果呈现

实际页面截图 50 暴露了原审计页直接显示英文代码的问题；源码还把所有非
`ALLOW` 的决定都显示成负面，包括 `NONE` 和未来未知值。按 REQ-24、DD-74/75
和 `.design/03` §14，修复现有审计呈现，不新建审计或执行状态权威。

变更前四步核对：

1. 权威仍是 Core AuditEvent；`audit_event_page.schema.json` 的 decision/resultCode
   是开放字符串，不能在 UI 发明新的封闭业务枚举。
2. 影响面为共享 Web/Desktop 本人及 scope 审计表、原 Mobile 审计页和同源
   TypeScript→Dart 文案。无 API/schema/数据库/Workflow 变更，无迁移或旧读路径。
3. 只改已有 GET 的显示；不改变身份、scope、权限、投影、quota、审计写入或
   外部副作用。原始代码保留；ACCEPTED/DISPATCHED 明确不是执行完成。
4. NONE 和未知决定为中性；UNKNOWN 为结果不明，未识别结果以本地化前缀保留
   原代码；已有 ReasonCode 使用原目录。空列表、分页、认证/拒绝/UNKNOWN
   读失败继续沿原消费者，不将失败变成空数据或成功，不新增需收敛状态。

实现后，在 a54c5910144b83fa3bccb6351ac14701e214162c 的隔离源码上验证：

- 原共享包源及测试 TypeScript 检查退出 0；AuditPage 12 通过，216 非本项用例
  明确未运行。首次局部导出缺两宿主 Tailwind 配置导致 ENOENT，补齐同 commit
  文件后运行成功，没有修改测试绕过。
- 将非 ALLOW 一律负面恢复为旧错误逻辑，实际 1 失败、11 通过；断言显示
  `bg-destructive` 与预期中性不符。还原后再次 12 通过。
- 原文案生成及 `--check` 退出 0，12 个键中英文同源。Mobile 使用本地既有
  Flutter 3.41.7 镜像，4 CPU/8 GiB memory=swap、Data pub 缓存、network none，
  `pub get --offline --enforce-lockfile` 通过；两文件 analyze 为
  `No issues found!`；原页面审计筛选 3 tests passed。未下载 SDK 或重建镜像。

原件位于 Data `codex-agent-receipt-regression-20261005.XvkUjX/audit-ui.HP8Ot0`；
本项只证明源码和局部消费者，尚未发布新 Web/Windows/Mobile，也未对修复后的
页面截图。完整检查仍以前述固定树退出 1 为准，不能用本节取代全量或产品验收。

## 2026-10-06 后续逐页复核与固定树完整检查

共享回复／TTL 批 `66f2a415bbf39d0d8093d9907ffa9525a20d3e95` 与计量投递修复批
`a422b1b2e2d6b30f1f4f38831a612752ed453634` 已提交并普通推送；远端分支
`work/buzz-restoration-20261006` 独立读回 a422。相对已部署 Web 的 a59 提交，
累计 58 文件 +963/-123，不等于 58 项功能验收。新线程侧栏、公开／私有频道与
加入流程仍在开发，不包含在这两项提交或当前发布声明中。

Playwright CLI 使用正常 OIDC 会话，在现有 Web a59 上重新截取并逐张打开
`43-a59-channel-current.png` 至 `58-a59-create-channel-current.png`，原件目录为
`/volumes/data/kailo/tmp/kailo-visual-release-20261006.vlPvnU/`。未 mock API，未
创建新账号、频道或发送消息，未调用模型。实际结果：

- 43–44：频道已有头像、时间、富编辑器和保留草稿，收件箱有列表与详情分栏；
  旧验收频道标题仍为 UUID。
- 45–51：成员、Agent、工作流、任务、审批、审计、设备均可达；部分管理页仍是
  简化表单，审计仍显示英文状态码。新验收频道无 Agent 安装及自动化，不把
  当前 scope 的空列表误称租户数据丢失或功能通过。
- 52–55：资料、外观、通知、快捷键为当前可达设置页；通知权限被浏览器阻止，
  不声称系统通知交付。设置四页不代表原版全部设置已恢复。
- 56–58：私聊显示连接已断开且 stream 返回 403；新私聊可以选择另外两位真实
  人类成员，创建频道仍只有名称／描述，没有公开／私有和 TTL。
- Pulse、Projects、三组件入口尚不存在，不能为它们生成通过记录。本批截图
  不覆盖尚缺的原版页面，也不是 Win11 或 Mobile 的实机验收。

固定树 `9d1e38eeff1e83d96321b014a63a16eb82ccfe20` 原 `./tools/check.sh --full`
在 4 CPU／8 GiB SDK、Data 缓存运行并退出 1。原日志为
`/volumes/data/kailo/tmp/buzz-reply-ttl-batch.6VbSXD/tmp.UlywHVmoCi.check.log`。
实际失败：

1. Go `TestApplicationBindingProtocolRoundtrip/web-forum-channel.sample.json`：
   输入时间的 `.000Z` 被 Go 序列化为 `Z`，字节形式不符。
2. TypeScript 平台检查为 449 通过、1 失败：原版
   `channel-type-settings.tsx` 的菜单 `minWidth` 布局被禁止自建主题的检查拦截。
3. Relay、Desktop、Web 当前源码与已有产物来源摘要不同，需要真实产物，不能
   修改摘要把旧产物记为新版本。

Rust、Dart、静态检查、四侧生成同步、242 个 schema 与三份历史兼容、Temporal
replay、文档六项、追溯记录及已有产物清单检查通过。数据库迁移／SQLx 和实际
部署配置预检因没有对应输入跳过；gitleaks 未安装，只有原内置扫描结果。
前两处已在工作树修正，尚待下一实现批集中复核，未据此改写本次退出码。

本记录只同步 REQ-24、DD-39/75 的实际交付事实，不修改产品范围、状态机、
契约、权限、额度或三端认证路径。未决私聊及计量副作用继续走原对账，不重发
模型调用、不把 UNKNOWN 渲染为成功或失败。构建仍在使用网络下载部分依赖，
没有宣称已完全离线；现有 Relay 与计量构建继续原进程，没有另起重复构建。

## 12:40：共享标题／设置／预览及状态查询批投递

实现提交 `c674f5782ed918c63e691d94f60df7f3c37bb5ba` 已普通 push，远端独立读回
一致。相对 `3673b23b0dd02fe34d7be14fe725e0b350c33565` 为 42 文件 +2045/-1644，
主要为原实现迁入共用包及 Native 重导出，不是删去原功能。选定树
`dbb2740f727862aabda94ed83e66220ae8705ddf` 在独立 SDK 副本通过同源词条检查与
原 `check-docs.sh`；未混入尚未闭合的 Inbox 草稿或下一批 Agent 准入修复。

原 `tools/build-upstream.sh web-client` 在 8 CPU／16 GiB、Data 持久缓存的既有
builder 实际退出 0；产物
`587815d0cf1a4964c1342f99b24e289fc402e0e9be22a4fc9fcf9dc2a3e28389`，
source digest 为 `f7d1245d7e319dd287464bfe591378b9a5cca3e56d18070c06d913e9329f4b28`。
registry 独立 HEAD 200、摘要相同。原 Compose 仅更新 Web，命令退出 0，实际
启动时间 12:40:55 UTC，随后 healthy；Core/Worker/Relay 镜像与启动时间不变。

本次实际配方仍是 `npm ci`，并非尚在工作树的 npm 持久下载缓存改进，不能宣称
完全离线；日志报告 27 项依赖漏洞（26 moderate、1 high），尚无处置验收。
构建也明确提示原样式末尾的 spoiler `@import` 顺序错误；已在主源码移到全部
规则前，留待下一完整功能批验证发布，不将此镜像记为已修好剧透样式或完整体验。
没有为这两处再单独启动构建，也没有隐藏构建警告或修改审计结果。

原件在 Data 的 `buzz-web-preview-release-20261006.NgyUR0/`：`web-build.log`
SHA256 `297929b869b2c284db99dc4497b023e7b0740eb8b143e10c6f12ca86d30fd152`，
`web-deploy.log` SHA256
`0c9d447b0a60555ee0161b71a691ca73630ea7623b4456e6a69a3a751e0d2331`。
后续浏览器通过同一真实 OIDC 会话补拍 `32`–`38` 七张图，原件同目录
`C674-RESULTS.md`。原设置左导航可达，紧凑／丰富预览切换、刷新再进入后仍保存，
最后已还原紧凑。没有重新创建私聊、发送消息或调用模型。
频道头仍显示 UUID，侧栏名称正确：Core 读取 ActionExecution 的创建参数时未进入
原 `parameters.params`，误判无 metadata 后沿 slug 创建；不是前端应把目录名当作
Relay 权威的理由。现有私聊 stream GET 403，界面显示连接断开；旧 pending intent
随刷新消失，因此没有适用对象验证本版状态按钮，不伪造 intent 或重发 open。
这些实际失败继续计入缺口，不将原 064 版 31 组图当成本版全部页面再次验收。

## 已部署 Web 的逐页浏览器实测

2026-10-06，源提交 `064cd615a33a1f21920e99291e3a63b7b06bb6fe` 的 Web
`54928e5a5a16053ae750479c1a8a0ef6ff39d33323d24cff807aec4c8e7e3df2`
在正常本人 OIDC 会话中接受 Playwright CLI 实际操作，1440×1000。31 组编号截图
及逐页结果位于 Data 的 `kailo-visual-release-20261006.vlPvnU/RESULTS.md`。
包含频道、创建弹窗、Inbox 与线程、新私聊、成员、Agent、工作流／定义／历史、
任务、审批、审计、设备、四个设置页、折叠侧栏及中英文刷新状态。当前不存在的
Pulse、Projects、三个组件入口没有截图，不记为已验证；Win11/Mobile 不在本轮。

实际创建频道“Kailo Web 浏览器验收 20261006”，操作
`6a8ce687-b838-446f-afbe-9d8ea62ec701` 已完成；进入该频道使用共享富编辑器发送
验证文字并真实读回。另仅提交一次私聊 open，任务仍待对账，草稿保留，未视为
已送达。Playwright 点击“查看状态”实际报 `element is not enabled`，已定位为
冻结收件人的锁被误用于只读查询按钮；后续源码修复不等于本镜像已修好。

默认中文、切英文后刷新保留已实际验证；审计中的机器标识仍为英文，原版全部
文案覆盖不因此宣称完成。三个平台管理员读取接口实际返回 403，未绕过权限。
未观察到 JavaScript pageerror；这不替代全部交互验收。已打开 PNG 复核原侧栏、
真实消息、Inbox、外观及工作流，仍明确记录泛称频道标题、短公钥 Agent 名称、
缺失创建选项和简化管理布局，而非只凭 DOM 或编译认定等效。

## 新版截图后的频道标题修复（源码增量）

实际新 Web 截图 `kailo-visual-release-20261006.vlPvnU/01-channel-new-release.png`
显示频道主体已有原头像／日期／编辑器，但上方仍是泛称“频道”。沿 REQ-24、
DD-39/75，按 Buzz `779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/features/chat/ui/ChatHeader.tsx::ChatHeader` 核实原标题、说明提示、
glyph、复制按钮与状态呈现，提入共用包；Desktop 保留原本机剪贴板及频道状态，
Web 使用已准入的 `WebChannelView.name/description` 与浏览器剪贴板。

影响面是两个宿主与同一呈现组件；旧重复标题 DOM 删除，不新建数据源、协议字段
或频道权威。空标题不复制；未加载或准入失败不拿上一频道标题充当当前事实；
说明空值不生成提示，长标题沿原样截断。剪贴板失败显示既有中英文错误反馈，
不渲染为成功；动作不产生外部业务写入、额度、审批或新生命周期。
三端认证路径不变，Mobile 不引入该 TypeScript 页面。Header 的原成员管理、
Terminal 与资料交互缺口仍属于完整恢复范围，本次标题修复不冒充全部 Header。
源码写入后增加标题／说明／复制与空值两项检查，已在现有受限 SDK 实际通过；
将标题故意改为固定文本后检查真实失败，恢复后通过。双宿主类型检查通过；
尚未发布，日志与同批链接预览边界见 `web-client/fork/verify/web-surface.md`。

## 私聊状态查询修复（同批源码）

沿 REQ-24、DD-39/75 与既有 Conversation 准入语义，原问题不是收件人应该解锁，
而是只读状态查询错误复用了冻结写意图的锁。原 `useConversationOpen` 抽出已有
会话查找，供准备发送与只读 `checkStatus` 共用；`NewMessageScreen` 的状态按钮
仅在查询执行期间禁用。影响限于共享 hook、原页面与事后回归，两宿主自动消费，
没有契约、数据库、Workflow 或 Mobile 路径变更。

查询只读取同一冻结参与者集合，不创建新幂等键、不发送 `conversation.open`、
不恢复隐藏会话、不自动发送草稿。查询为空、结果不明或不可查证仍显示未完成；
查到 ACTIVE 也不伪造消息送达，真正发送继续走原准备／准入路径。重复点击由原
in-flight 锁拒绝并发，收件人仍冻结；失败不丢草稿、不放宽身份或作用域。

实现后原私聊 13 项、设置 18 项、消息头 2 项共 33 项通过。仅在 SDK 副本恢复旧
按钮禁用条件，新增两项确实失败；按原字节还原 `cmp` 退出 0 后 33 项再次通过。
原件为 Data 的
`codex-agent-receipt-regression-20261005.XvkUjX/profile-settings-ortsoo.DRR20F/`
下 `dm-theme-mutation.log` 与 `dm-theme-restored.log`。该按钮修复尚未部署，
也没有解除当前旧 Relay 上的私聊待对账问题。

## Core 构建缓存纠正（未构建验证）

前一原 release 日志显示仅缓存 Cargo registry，源码变化仍重新编译整组依赖。
依 ADR-06、07 §2.1，并复用现有 Desktop Windows 配方的缓存／导出方式，原
`core/Dockerfile` 增加锁定 target 缓存，构建成功才复制 executable 到 `/out`，
最终 runtime 从该导出读取，不将缓存或工具链复制进产物。没有新发布脚本，
运行时权威、API、契约、数据库、资源配置均不变。
并发由缓存锁串行写入，缓存缺失正常重建；编译失败不执行导出，不能把旧缓存
二进制报告为新发布成功。该增量不在已经部署的 `0d6b2833a` 中，留待下一次
必要 Core 发布实际验证；本轮不额外触发编译，不声称已经获得热缓存耗时证据。

## 2026-10-06 11:58 后续投递与来源清单修正

Core／Worker 源提交 `0d6b2833aa22151dfcd78851872a21a5f9e361d6` 的原 release
退出 0，镜像均推送且 registry 摘要独立核对一致。原部署 wrapper 与 Worker
启动退出 0，Core health 200，90 条迁移成功；其余 21 个容器不变。
原始回执为 Data 的 `buzz-core-registry-release-20261006.aq2uA1/deployment-receipt.md`。
随后仅投递已生成的共享 Web，逐页业务及视觉验收另记，不将服务健康当作功能通过。

Relay 原构建入口在编译前退出 2：来源清单仍把已部分恢复的
`desktop/src/features/forum` 登记为整块删除。现按真实上游差异改为仍缺少的子路径，
同时登记已迁入共用包的主题路径及尚缺失的 ProfilePopover；未删除任何产品源码。
原 `upstream_manifest.py diff collaboration --check` 输出清单与实际一致（965 项）、
退出 0。数量是原路径缺失／迁移事实，不是功能完成度；REQ-24 的完整恢复范围不变。
该修正只影响来源记录及构建输入校验，不改变认证、权限、状态、协议或副作用。

修正清单并固定提交 `3673b23b0dd02fe34d7be14fe725e0b350c33565` 后，Relay 原
`tools/build-upstream.sh collaboration-relay` 在已有 8 CPU／16 GiB 的 Data builder
运行，最终退出 1：`pnpm install --frozen-lockfile` 下载固定 pnpm 11.4.0 时
`UND_ERR_CONNECT_TIMEOUT`。原件
`buzz-relay-restoration-20261006.hOhSoy/relay-release-corrected.log`。
未生成或投递新 Relay，不改旧镜像的成员 kind 开关，不以新 Core/Web 代替 Relay
接缝验收；该失败只阻断此产物，其他界面恢复与真实浏览器走查继续。

2026-10-06。本记录对应第一批源码，不是部署、完整 Buzz 功能恢复或生产就绪声明。
权威为 REQ-24、DD-39/40/53/75/80/81；设计已单独提交到
`design/buzz-feature-preservation-20261006`，头为
`50515dd6e3481bcb1732d1662efc88431c716a3d`。

## 已写入范围与边界

- Web/Desktop 共享原侧栏分组、行、菜单、排序，以及资料与头像编辑、新私聊选人界面。
  复用 Buzz `779af8886caae1317b4de962082429867ab61503` 的
  `desktop/src/features/messages/ui/NewMessageScreen.tsx::NewMessageScreen`、
  `desktop/src/features/sidebar/ui/CustomChannelSection.tsx::ChannelGroupSection`、
  `desktop/src/features/profile/ui/ProfileAvatarEditor.tsx::ProfileAvatarEditor`。
  宿主只保留真实 BFF 或本机签名调用；原生端不改为服务器持钥。
- Conversation 只记录参与者及原 Relay Channel 引用，消息仍归原 Relay。
  同一 Action Admission、ComponentTaskWorkflow、SpiceDB、审计、OpenBao 与
  publish attempt/reconciler 承接新增调用，不建立另一聊天或工作流权威。
- 新 Workspace 的创建者成员事实与创建动作同事务写入；原 Temporal 生命周期
  查证 SpiceDB/Relay 成员投影后才宣布就绪。旧 history 未携带 creator 时保持
  原命令序列，不给 CONTROL 增加业务成员身份。
- SSE 复用既有 snapshot、订阅池和再准入；私聊绑定参与者与两级 binding version，
  重连取真实 snapshot。读取正文后再次核权，撤权、暂停、换钥和依赖失败关闭流。
  read_contexts 沿用同一用户状态及 CAS；该批只补 Channel 级私聊已读。

影响面包含 Core/BFF、Worker、Relay 原成员表、四侧生成契约及共享 TypeScript。
数据库新增投影表和原 Relay 投影字段，前进／回退已在隔离演练库实际运行；不改
消息正文存储，不改业务库。Mobile 的本机密钥／Relay 路径保持不变，新增 UI 不
因此获得 Mobile 验收。并发重复请求沿用冻结 idempotency key；外部结果不明不
重复执行、不显示成功或失败；HTTP 接受不等于投影完成。前端已发送但导航失败
只重试导航，不重新发送。权限与作用域缺失拒绝，不回退默认租户或共享身份。

## 实际验证

固定检查镜像为
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`。
本批 full 为四 CPU、八 GiB、Cargo 十六并行，缓存位于 Data；数据库是新建的
隔离演练库。执行 `./tools/check.sh --full`，原日志为
`/volumes/data/kailo/tmp/tmp.SQT2AP3kht.check.log`，**退出 1**。

- 通过：Rust/Go/Dart 测试、Temporal replay、数据库前进／回退／再前进、SQLx
  同步、四语言契约同步及兼容比对、安全结构与文档检查。
- 失败：Rust 格式、两处 Conversation tuple 的 clippy 类型复杂度；Dart 平台
  文案同步；TypeScript 主题检查两项；追溯产物与阶段登记；旧产物源码摘要。
- TypeScript 原命令重跑为 408 通过、2 失败。检查误把原生宿主 dark 变体和
  ring-inset 当作独立主题／颜色，同时暴露自写频道弹窗遮罩的问题。
- 后续已将两个 tuple 改为命名数据库行并格式化；后续原 Dialog 复用、主题检查、
  富编辑器、完整频道元数据和事件级私聊已读不属于这个已运行 full 的源码快照。
- pnpm 本次复用 217 包、下载零包；Dart 报告 47 项依赖变化，不能据此确认网络下载数，也不能宣称完全离线。
  实际部署配置未投递，运行配置预检跳过；未安装 gitleaks，只有内置扫描通过。

窄验证及真实破坏／还原证据见 `conversation-projection.md` 与原侧栏交接记录
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/profile-settings-ortsoo.DRR20F/sidebar-handoff.md`。
私聊授权、UNKNOWN 不重发、SSE scope fence、四侧未知字段拒绝均有失败后还原
记录；这些不替代真实多人多 Agent 或浏览器、Win11 验收。

## 未交付范围

仍需修完检查、集中构建、部署及真实客户端验收。完整富编辑器、完整频道
公开／TTL／模板、其余设置、Pulse/Projects、私聊隐藏／偏好等原功能继续恢复，
不是从需求删除。Cells/WeKnora/Wren 的独立服务集成也不在此检查点宣称完成。
该检查点不更新旧 EXE 或镜像为“最新版”。

## 第二批源码与验证（2026-10-06）

设计另行提交 `088de845e2cc173e64c624e82db73d38f04d608b`，保留完整产品范围，
区分协议 private 与产品公开频道，明确私聊偏好、原生隐藏及 TTL 归档权威。
`./tools/check-docs.sh` 退出 0，日志
`/volumes/data/kailo/tmp/tmp.RfJ4DAZFZn.check.log`。外层遗留 pre-push 错误地调用
整个 apps 检查，因缺执行配置退出；已独立完成文档检查后，仅该次设计 push
不执行遗留钩子，没有将完整检查记为通过。

本批将原富编辑器、工具栏、链接、草稿与样式移到同一共享实现；Desktop 原位置
转发，Web 删除简化输入框并保留 BFF 发布及上传。频道名称、描述和类型沿原
ActionCommand、Temporal 生命周期到 Relay 的签名元数据回读，不另建元数据表。
私聊收藏／静音复用同一用户状态 CAS；隐藏／恢复保留原 Relay 权威及原发布
幂等／UNKNOWN 对账。影响面、迁移和副作用证据见 `conversation-projection.md`
及 `membership-lifecycle.md`。

实际集中验证：共享 TypeScript 236 项、Web 20 项、Desktop 原编辑与草稿 177 项
通过，三处 TypeScript 类型检查通过；Core clippy、元数据、私聊准入、发布检查
通过；四侧序列化通过；Relay 编译及隔离 PostgreSQL 隐藏／恢复检查通过。
主动丢弃 UNKNOWN 草稿键、退回纯文本发送、绕过 binding 比较、反转 hidden_at
以及丢弃频道描述均被对应检查捕获，私有副本还原后通过。文案生成器与 Dart
输出已同步，不以旧生成物代替检查。

收口复核还修复同实例切换身份／频道时空草稿继承旧内容的问题，并阻止旧发送
回执解锁新会话。原上游无作用的选区回调已移除，保留编辑器自己的真实选区。
补充后 Composer 12 项及三处类型检查通过；私有副本回退两处错误，新增 3 项
全部失败，逐字还原后 12 项再次通过。此修复不因父组件当前使用 key 而省略。

这些是本批源码证据，不是发布验收。公开频道发现／加入、TTL 生命周期、完整
模板和 Forum 页面，以及 Web 完整附件编辑／录音等仍未恢复；不从需求中删除。
尚未部署新 Core／Relay／Web，不把旧 EXE 标为新版；真实多人多 Agent 和
Win11／浏览器验收仍需在新产物上进行。

频道元数据另已完成真实 Relay 验证：启用 `PLATFORM_INTEGRATION=1`，执行已有
`non_member_publish_is_rejected_and_member_publish_is_accepted` 二进制，实际输出
`1 passed; 0 failed; 7 filtered out`，退出 0。覆盖重复建频道、stream/forum 名称
与描述签名回读、同 ID 异描述拒绝、非成员拒绝及成员发布；独立验证 Community
已归档。首次因 operator URL 与签名 Host 不一致退出 101，未创建 Community；
第二次仅在隔离验证容器解析原 Host 到原地址，不改部署配置。完整执行及当前
旧镜像摘要记录为
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/channel-metadata.xjOQiU/relay-live-evidence.md`。

第二批集中 full 使用固定源码树 `0d295fc349b94b06670938578c59ade6215a72a0`，
日志 `/volumes/data/kailo/tmp/tmp.tcktt3EYUb.check.log`。保存本检查点时进程仍在
运行；已输出 Rust fmt/clippy、Go vet、TypeScript/Dart 静态检查、四侧生成同步、
契约兼容与数据库往返通过，Rust 测试链接仍未结束。此记录没有完整检查退出码，
不授予发布资格。后续附件与私聊菜单改动不在该固定树中，不能借用这次 full 验收。

## 第三批附件恢复：实现边界

REQ-24、DD-39/75/81 要求保留原附件交互及双宿主签名边界。原版依据为 Buzz
`779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/features/messages/lib/imetaMediaMarkdown.ts::formatImetaMediaLine`、
`buildImetaTags`，以及
`desktop/src/features/messages/ui/ComposerImageEditor.tsx::ComposerImageEditor` 和
`desktop/src/features/messages/ui/ComposerAttachments.tsx::ComposerAttachments`。
Web/Desktop 共享原附件、画笔编辑及剧透界面；Core 原 Web 发布接缝补回文件、
音频、语音 MP4 与 Agent/Team PNG 的原文件卡片表达，不将它们误当普通图片。

写入方为 Web 原共享附件操作，读取方为 BFF 生成请求类型、原 Relay imeta 校验
和原生消息渲染。`WebMessageAttachment` 增加可选 `filename`、`spoiler`，四侧已由
既有生成器生成；未增加正文表、媒体目录、状态机或 Workflow。旧请求缺省字段
保持旧语义；旧 Core 的严格契约会拒绝新字段，所以部署顺序必须先 Core 后 Web，
不能对旧 Core 开放新客户端功能。样例同时保留旧附件和携带新字段的附件。

媒体 URL 仍限定已准入 Community 的原媒体路径，拒绝异 host、userinfo、查询
和片段。Relay 原 sidecar/imeta 校验仍决定文件是否存在以及 MIME、size、filename
是否合法；Core 不复制媒体权威。文字标签沿原版转义；仅图片和视频采用原版
剧透语法，普通文件卡片不伪装隐藏。空字段保持原行为，超限仍走现有 LIMIT，
缺身份／binding／权限保持拒绝；撤权再准入、并发重发与 UNKNOWN 使用原发布
幂等及对账路径，不因附件增加而重发或宣布成功。

SDK 首次生成缺 npm 缓存环境，实际退出 1（`EACCES mkdir /.npm`）；未修改系统
权限，改用既有 `/cache/npm` 并显式 offline 后，四侧生成退出 0。这里只登记
生成结果，新增五项 Rust 检查及第三批四侧往返尚不能记为通过；第二批 full
仍使用其固定树，不覆盖本批新字段和界面。

## 第四批论坛与原版页面接线（2026-10-06）

本批实现沿 REQ-24、DD-39/75/77/80；不是新建论坛服务或另存帖子正文。
固定上游 `779af8886caae1317b4de962082429867ab61503` 的
`.references/buzz/crates/buzz-relay/src/api/bridge.rs::handle_channel_window_filter`
与 `extract_thread_cursor`，以及
`.references/buzz/desktop/src-tauri/src/commands/messages.rs::get_thread_replies`
定义实际分页行为；
`.references/buzz/crates/buzz-core/src/nip10.rs::parse_thread_markers`
继续直接复用。上述路径及符号已按固定 commit 重新检索。

四步影响结论：

1. 权威：帖子、回复、删除／反应辅助事件、39005 摘要、39006 窗口边界均由
   Relay 提供。Core 仅校验 scope、签名、绑定的 Relay author，并转换语义请求；
   不复制正文、不以返回条数推断主帖窗口终结。
2. 影响：Web 原消息请求增加可选 messageType/parentEventId，查询增加成对
   before/beforeId；四语言类型由原生成器生成。旧请求省略时仍是 stream。
   发布幂等记录增加原消息 kind 和 parent 引用，旧记录迁为 kind 9／无 parent；
   同键异 kind/parent 拒绝，不把新写动作并入旧终态。存在新语义记录时回退迁移
   明确拒绝。Core 应先于使用新字段的客户端投递。
3. 副作用：Web 仍经 BFF 本人代签；Desktop/Mobile 本机持钥与 Relay 准入不变。
   私聊不接收 Forum 类型。类型与 NIP-10 祖先矛盾、缺签名、跨频道、非绑定
   Relay 签发摘要／边界、游标残缺均拒绝；查询后再次读取权限、身份与绑定。
   新 `GET /api/v1/workspaces/{workspace_id}/channel` 读取原 39000 元数据，
   不把三端共用 Workspace 目录改成依赖 Web 托管私钥，也不从空消息猜频道类型。
4. 边界：空主帖窗口仍须有原签名 bounds；线程沿原 Native 复合游标向后读取，
   同秒 event id 为排序决胜键。分页使用运行配置、NIP-11 与原 bridge 上界的
   交集，原上界和深度从 buzz-core 共用，不新造开发限制。原两跳 aux 闭包不接收
   无关目标。重入／重复投递沿原 publish_attempt；网络不明保持 UNKNOWN，
   撤权拒绝，不据重试次数伪造成功或失败。新增的字段不是新业务状态，无另设
   清理队列；原预留、执行对账与生命周期继续负责收敛。错误仍归于 DENIED、
   BLOCKED、PRECONDITION、LIMIT、CONFLICT、UNKNOWN；畸形客户端参数拒绝 400。

当前执行证据：四侧生成两轮均退出 0（后轮加入真实 WebChannelView）；Dart
文案已同步新论坛文案。实现后新增的分页、签名、类型与频道描述检查正在进行，
不记为已验收。首次窄验证误选 `--lib`，原输出
`error: no library targets found in package platform-core`，退出 101；改为该工程
真实的 `--bin platform-core` 后执行，不改产品代码掩盖工具目标错误。

第二批原完整检查现已结束，退出 1：Rust/Go/TypeScript/Dart、Workflow replay
通过；冻结设计中的 Wren/SS/SF/COMPONENT_ACTION 追溯不闭合、conversation
缺 release digest、新 Relay/Desktop/Web 源码与旧产物来源不匹配。实际部署
配置预检明确跳过。没有重启该全量检查，也没有将它作为第四批通过依据。
第四批未部署、新 EXE 未产出；原侧栏与消息行的共享恢复同属新批，不凭源码
或局部检查宣称 Web/Desktop 原版体验已完整等效。

### 第四批集中验证回执

同一受限 SDK（4 CPU、8 GiB，Cargo 16 并行）执行结束：Core binary 单元检查
`247 passed; 0 failed; 29 ignored`；collab-bridge `3 passed; 0 failed`；Rust
契约 roundtrip `17 passed; 0 failed`。29 项 ignored 不计作通过，也不等于真实
数据库、Relay 或多人协作场景验收。此前第二次 Core 编译因 SDK 快照仍是旧版，
出现 13 个缺失符号／参数错误，退出 101；同步已提交的第二批 Core 及本批明确
修改后通过，没有为旧快照修改正式实现。失败原件仍保留。

隔离副本主动移除消息 kind/祖先、完整游标、频道签发者、窗口签发者、线程
游标顺序五处校验，原检查实际 `14 passed; 5 failed`、退出 101。随后恢复正式
源码原字节，`cmp` 退出 0，再执行上面的全部 Core 检查通过。正式源码未被
破坏；没有以忽略失败或放宽断言使检查通过。

原日志位于 Data 的
`codex-agent-receipt-regression-20261005.XvkUjX/profile-settings-ortsoo.DRR20F/`：
`forum-core.log`、`forum-core-bin.log` 保留两次执行错误，
`forum-core-mutation.log` 保存五项真实失败，
`forum-core-restored-all.log`、`forum-bridge.log`、`forum-rust-roundtrip.log`
保存还原后的结果。Go、TypeScript、Dart 契约往返及变异结果，与共享侧栏、消息行、
论坛的三侧类型检查和交互结果另见 `web-client/fork/verify/web-surface.md`。

原隔离库 `scope_verify` 实际完成新增迁移的前进、回退、再前进，退出 0；最终
90 条迁移、最新 `20261006190000`，publish_attempt 与 principal 仍为零行，
没有操作正式库。带新语义记录时的回退保护未实际演练，不把空库往返覆盖成该
场景。临时网络连接已经恢复；日志为同目录 `forum-migration-roundtrip.log`。

设计候选的原 `check-docs.sh` 最终退出 0：276 个引用、87 个实体、115 个决策、
29 个接缝、87 个场景均闭合。第一次检查因导出时中文路径被 Git 引号转义而
漏同步旧覆盖矩阵，退出 1；采用 Git 原始路径重新导出后通过，未修改矩阵凑数。
原件 `fourth-docs.log` 与 `fourth-docs-restored.log` 均保留。设计独立提交为
`3553eba86e566455ece3547f9168fa4b6124b757`，实现引用该固定版本。

实现后交叉复核发现原生 kind 7 reaction 不必携带 `h`，若只允许 kind 5 无 `h`
会使正常 Forum 整页拒绝。现按固定上游
`779af8886caae1317b4de962082429867ab61503` 的
`crates/buzz-relay/src/handlers/ingest.rs::derive_reaction_channel` 与
`reactions_do_not_require_h_tag` 修复；仍要求事件签名、无冲突 `h` 及当前页目标
闭包。新增四个正常／错频道／重复标签／无关目标断言后，19 项通过；隔离副本
退回 kind 5-only 时该检查确实失败，原字节恢复后 19 项再次通过，rustfmt 退出 0。
日志为同目录 `forum-core-native-reaction.log`、
`forum-native-reaction-mutation.log`、`forum-native-reaction-restored.log`。

设计 push 首次被外层遗留 pre-push 错误调用 apps 全量检查、因缺 TMPDIR 拒绝；
没有修改钩子或运行未受限构建。已通过文档检查的独立设计 commit 经同远端的
apps Git 发送到设计分支，远端独立读回为上述 commit；没有混入实现提交。

### 发布构建的契约输入修复

冻结源码 `dc41f86ca6e56fdbc83f6d75d5051a16a7e7f4fe` 的原 `tools/release.sh`
实际退出 1：Core 的 `conversations.rs` 中 `participants` 与 `requested` 两处 `include_str!` 找不到
`contracts/api/conversation_open_request.schema.json`。编译日志为
`/volumes/data/kailo/tmp/buzz-restoration-release-20261006.QMJMtJ/core-worker-release.log`。
这是发布上下文遗漏，不是该 JSON 契约或私聊准入失败。

权威与影响面：按 ADR-06、工程规则 17 的固定来源要求，只把现有契约加入
`tools/release.sh` 的 Git 归档、`.dockerignore` 的精确 allowlist 与
`core/Dockerfile` 的 COPY。检索 Core 的全部 schema include 后确认该路径是
本次遗漏；不扩大为整个仓库或秘密目录，不改契约内容、四侧类型及运行接口。
副作用与边界：无数据迁移、身份／权限／额度或三端行为变化；缺少文件仍导致
构建失败，不提供默认契约或绕过校验。只影响构建输入，无新增业务错误状态。
`bash -n tools/release.sh` 与上述三个文件的 `git diff --check` 均退出 0。
原构建重跑的结果须以实际进程终态为准，此记录不声明已构建或部署成功。

### 工作流草稿切换的实际界面修复

本轮 Playwright 旧版截图
`/volumes/data/kailo/tmp/kailo-visual-baseline-20261006.spZHHl/17-workflow-yaml.png`
显示：空白表单仅切换到 YAML 就出现配置错误。原实现把提交所需的完整性
`contentAvailable` 直接作为编辑期间的错误，且未改动的空草稿也无法切回表单。

按 `.design/03` 自动化定义的表单／YAML 同源合同及 DD-106/107，只修改
`AutomationAction` 的编辑状态：保存本次表单导出的 YAML，未改动时返回原
表单字段；仅显式转换失败时呈现错误。修改过的 YAML 仍须通过原完整解析与
可表示性校验，未知字段／枚举、无效执行者／策略均不丢弃或替换原文。
Web/Desktop 共用此组件，Mobile 不新增页面；没有契约、持久数据或后端变更。
提交的 `contentAvailable`、执行者、授权、审批与结果 UNKNOWN 处理保持不变；
未完成草稿、撤权、策略失效仍不可提交。切换编辑器不会发送动作，无新增
副作用或状态终结要求。定向交互检查在实现后加入，验证及变异结果另随实际
输出记录；此处不把源码修复视为新版本浏览器验收。

### 2026-10-06 共享草稿、通知与 Agent 接缝批集中结果

源码提交 `344a4b6352180527052a659070b9dce2452d3da6` 已普通 push 至
`work/buzz-restoration-20261006`，远端独立读回一致；相对
`c674f5782ed918c63e691d94f60df7f3c37bb5ba` 为 94 文件 +2783/-1587。
固定树 `ee9a7aa5995cbc7bd4c8e1c0d6c985c7b16095b0` 的原
`tools/check.sh --full` 在 4 CPU／8 GiB SDK、Data 缓存下退出 1。
原始日志位于 Data 的
`buzz-runtime-drafts-batch.102bnA/tmp.xi2Rzzyp4d.check.log`。

实际通过：Cargo fmt/clippy/test、gofmt/vet/test、TypeScript 类型检查、Dart
analyze/test、四侧生成、242 个 schema 与三份历史契约兼容、Workflow replay、
文档六项与能力注册表。实际失败：node --test，以及发布追溯和上游来源核对；
后两项包含 Web 追溯 digest 未同步、conversation 的 Core/Worker digest 无对应
dist 发布记录、Relay/Desktop/Web 新源码与旧 artifact 来源不同。不得修改摘要
冒充新产物，也不得把静态通过写成全量通过。数据库实际迁移演练和导出树部署
配置预检因没有对应输入明确 SKIP；未安装 gitleaks，不将内置扫描替代该工具。

该批尚未发布。线上 Web 仍为 c674，Core/Worker 仍为先前 0d6 批。
344 的 Core 发布在 COPY 阶段发现仍需补 Worker Activity 注册后主动取消，
退出 130，未进入本次 Cargo 编译、未产出或部署镜像。Relay 原构建因 Corepack
获取 pnpm 的 registry 连接超时退出 1，重试亦失败；没有用旧镜像冒充新源码。
随后补入的通知文案中英同源、ProjectConversation 原 Activity 注册及 Wren
DEDICATED_INSTANCE 修正，各有实现后窄验记录，不属于此固定树 full 的覆盖范围。

### 2026-10-06 13:42–14:17 UTC 实际投递与浏览器复验

前节是历史固定树结果。Core/Worker 已从干净提交
`f5f786cadcf0ad88d5fd13c2e964c92ebf0b328a` 经原 release、registry 和启动入口投递，
实际退出 0，镜像分别为 `08c62ac1e4bdc857f3599b9ba40406a8d913ff530d69fed22df9c59b4a8c4802`
与 `6e0ed202debb887725a7ef890f22b5f889cde88aa98e7a2cf442acae01d6b1d7`。
Core health200、Worker 原队列启动、原90条迁移成功；原件为 Data 的
`buzz-dm-worker-release-20261006.85FUKC/deployment-receipt.md`。原私聊
ProjectConversation 确已执行，状态自动推进至 RECONCILING，但仍返回
UNKNOWN_EXTERNAL_RESULT；截图39实际显示私聊断连、stream403，不能算可用。

Web 干净源码 `a59e2f50ae1c4f73a363816a1cece646b7116f83` 经原
`tools/build-upstream.sh web-client` 在既有8CPU/16GiB有限swap、Data缓存builder
构建退出0；原件为 `buzz-drafts-notifications-web.F37mSj/build-web-client.RyxK7J.log`。
构建真实拉取了基础镜像层，不宣称离线；存在大JS chunk警告。官方helper写回
source `92ff49c47cb4ccafe017aff6946f88535576a0ed97e1ba3479799386938c9d14` 与
artifact `4580ec22a409abcb31e3c3e4fdfbe40ab64c1ebde54fdcb2961a5409954303a6`。
registry manifest独立HEAD200且Digest一致，本机镜像存在。原Compose只执行
`up -d --no-deps --no-build --pull never buzz-web`，退出0，启动于
`2026-10-06T14:07:42.198612302Z`，healthy、RestartCount0。Web无卷、无凭据，
仍只连原app网络；本次不更新Relay或Windows。17份已有Web追溯同步实际镜像，
不改gate、不以摘要更新冒充能力或未决全量检查通过。

真实登录、未mock的Playwright截图在
`/volumes/data/kailo/tmp/kailo-visual-release-20261006.vlPvnU/`：

- `40-a59-draft-restored.png`：现有验收频道输入草稿，切到收件箱再返回，原文仍在；
  随后刷新亦读回同一草稿，未发送消息。
- `41-a59-notifications-zh.png`、`42-a59-notifications-en.png`：原共享通知布局、
  中英文标签实际显示；关闭声音、刷新并重新进入通知页后开关仍关闭，再恢复开启。
  语言验证后恢复中文。浏览器报告通知已阻止，因此没有把系统弹窗交付记为通过。
- 三张图均实际打开检查。侧栏、头像、消息行和富编辑器不再是旧文本堆叠，但
  当前旧频道标题仍是UUID、Pulse/Projects/外部服务入口及完整消息菜单仍未补齐。
  这不是原版全页面、Desktop或Mobile等效验收。

浏览器检查中的两次定位错误保留：`main`有两处造成strict-mode错误；刷新后
设置页未保持，直接找通知按钮失败。重新经原个人菜单进入设置后验证成功，
未把定位失败抹除或归为业务通过。新回复/TTL源码仍不在此发布镜像中。

Relay重试原入口退出1，日志
`buzz-drafts-notifications-web.F37mSj/build-collaboration-relay.8DPl3x.log`：
`failed to list workers ... /run/docker.sock: use of closed network connection`。
未进入编译、未产出新Relay。Agent实际新调用两份准入已ALLOWED/DISPATCHED，
其中一份native完成但BILLING_UNAVAILABLE、未发最终回帖；原OpenMeter Kafka早已
OOM退出，单服务恢复后仍存在精确事件入口去重claim而未存储的问题，继续修复，
不改账本、扩大额度或重放模型。不能称稳定三人双Agent已重新通过。

本批只同步既有DD-74/75与SS-WEB-PRESENTATION的部署事实，无新契约、权限、
租户默认值或业务状态；未决UNKNOWN保持原处理。全量检查仍以前节退出1为准，
后续窄验和真实页面检查不替代 `tools/check.sh --full`。

## 2026-10-06 15:28–15:55 UTC 实际投递和双人私聊

计量源码 a422b1b2e2d6b30f1f4f38831a612752ed453634 经原构建入口退出 0，
API/sink 限定替换为 ed8f821f2a1ee510751a68fcb41d9a09cbeff66c693fdd7ad9fffea1b1ec6907，
registry HEAD 与运行容器摘要一致、healthy，其余 26 个容器不变。停止旧生产者后，
独立核对 Kafka 精确事件缺失、消费 lag 0、原生事件 API 无记录、sink 去重键不存在，
才原子删除入口 DB0 的一个空值永久去重键；没有删除账本或其他键。
原 Core outbox 的 314ab896-17fc-5fa6-93f7-ecc0d4246f84 自动重试后于 15:30:06
COMMITTED，原生事件 API 独立回读一条，入口与 sink 的键由原流程重建。
没有重放模型或人工重新发送 CloudEvent。

原 Agent Invocation 3e7b57d0-b11e-4a69-8f81-184b09fc3612 随后仍然 FAILED：
首次回复错误使用旧 native completedAt 签名，被 Relay 拒绝时间漂移；已有 Event ID
只是发布意图而非送达证据。修复 f3b9b868b5b17569391e654b79a89bc989d8cceb
已提交推送，保留原计量时刻、首次发布持久化与后续只对账边界，尚未部署。
不回滚失败状态，不解除 UNKNOWN holder，不宣称三人双 Agent 稳定协作完成。

Relay 源码 a59e2f50ae1c4f73a363816a1cece646b7116f83 经原构建入口退出 0，
产物 c5a484b74e75d24de8f65cab625aa76b3319434bf5d34ffca6821dd39ca5ca30
已独立核对 registry 摘要并部署；15:38:56 启动、healthy。备份原库后由原
buzz-schema 执行迁移，47/47 成功，仅新增原治理 DM 投影迁移。成员允许 kind
随真实二开能力只启用 9、41010、41012，未启用尚未发布的消息编辑。
Conversation 36667917-f326-4a36-86f2-e0b31a0ea4c8 自动收敛至 ACTIVE v3，
没有手动重启任务或伪改绑定。原回执与备份在 Data 的
metering-delivery-release-20261006.hZ7KbB/receipt.md 及该目录内。

真实 Playwright 使用两个独立浏览器经原 OIDC 分别登录 bootstrap 与
seam-verifier：前者发送 15:52 私聊标记，后者实际读到并于 15:55 回复，前者
实时收到；后者刷新并重新进入同一私聊，两条消息仍在。没有 mock、共享会话
或模型调用。截图 59–64 位于
/volumes/data/kailo/tmp/kailo-visual-release-20261006.vlPvnU/，均已逐张打开：
59 记录旧登录会话 431；60 私聊同步；61 发出消息；62 对方收到；63 双向回复；
64 刷新后历史。历史私聊断连的结论只被这一具体路径的新证据更新，不外推全部功能。

实际仍有两个失败：旧会话 SSE 自动重连堆积 OIDC 事务 Cookie 导致 HTTP 431；
seam-verifier 刷新后默认验收频道 /channel 返回 503 DEPENDENCY_UNAVAILABLE，
手动进入私聊正常。两项继续修复，不把错误页或结果不明称为通过。
Web 仍为 a59 镜像，Windows 旧包未更新；新 Thread、公开频道及审计中英增量
已提交但未部署。完整检查仍为既有退出 1，不以局部通过替代整批收口。

本次只登记 DD-74/75、SS-BUZ-GOVERNANCE、SS-OMT-AUTH 已实际发生的投递，
没有新 schema、权限或默认租户；唯一删除的精确缓存键已由原流程重建。源码摘要
来自原构建 helper 的真实回执，四处 Compose pin 与两个既有来源记录同步。

## 2026-10-06 18:02 UTC 网关登录修复上线与恢复批集中验证

本批沿用 DD-74/75、SS-WEB-PRESENTATION 与原治理链，恢复原消息编辑、回复及附件
呈现、成员可见频道和当前选中频道的读取、Workflows 运行列表与详情交互。Web/Desktop
复用同一消息语义与原组件；没有第二套工作流执行器、身份或业务正文存储。编辑目标
必须属于本人及当前频道，消息结果不明保持原意图并只对账，不因重试另发副作用；
无成员频道不回退默认频道。桌面编辑意图仍为进程内状态，重启恢复未验收。

影响面覆盖共享呈现、Web BFF、原生命令、Relay 已有 kind 40003 编辑协议、Core
准入和 migration 20261006210000；协议字段为可选 edit_target，旧请求保持原义，
四侧生成物和往返同步。成员选择使用授权的 workspace 列表，不以浏览器选择代替
服务端授权。附件完整媒体属性的后续恢复和 Workflow 名称批仍在并行实现，不计入
本候选完成范围；不修改旧版本 hash 或把缺失终态证据渲染为成功。

固定候选 e14bf7619d751544c0c1671708d9baa4ceccd07c 的原
`./tools/check.sh --full` 已结束，退出 1。日志：
`/volumes/data/kailo/tmp/buzz-edit-member-full-20261006.902Ske/full.log`。
SDK 实际限额 4 CPU / 8 GiB，独立库 kailo_edit_member_e14bf7，未操作业务库。
原始结果摘录：

```text
PASS cargo clippy / gofmt / go vet / tsc --noEmit / dart analyze
PASS 四侧生成同步、242 个 schema 与 3 个历史 schema 兼容
PASS 前进、回退、再前进三步演练、sqlx 离线核对、44 个枚举约束
PASS cargo test / go test / node --test / dart test / Workflow replay
FAIL cargo fmt
FAIL 两处 Relay 与一处 metering 的旧产物引用、设计封闭列表漏列 CONVERSATION_PROJECTION
FAIL desktop-client / model-gateway / web-client 产物与本次源码不匹配
```

格式差异已用同一 SDK 的 rustfmt 处理两处 Core 文件；三个追溯引用同步已上线
真实 Relay/Metering 摘要。设计提交 4305c7578875ec13c17705f76b4a3cf35da92384
同步原生私聊的 CONVERSATION_PROJECTION 封闭列表和使用映射，并包含前置
Workflow 版本名称决定；CI pin 同步。首次修正后 trace 仍退出 1，发现新 Gateway
的两个引用未同步，以及生成器读取使用映射而非封闭列表；两项随后一并修正。
复用最小 SDK 运行文档检查因不含完整实施文档失败，保留该失败，不作为验证通过。
修正没有把以上
full 的退出 1 改写为通过，也没有在每个小修后重跑 full。
最终固定树 db5b4c02625c315122d5ab952ff8476392d9ceb4 的原 trace 单步退出 0：
文档检查通过、22 条追溯记录通过、能力注册表与追溯一致；
原件为同目录 trace-final.log。该单步不替代仍未闭合的全量发布验收。

Gateway 使用固定提交 cdc79c4a3fa8d6888e8df9ab3c28b95814bd2108 经原
tools/build-upstream.sh model-gateway 完成编译、原生 version 自检、registry push
及来源登记。原构建会话退出码未保留，不补造；完整日志、产物和 registry 摘要
已独立核对，位于
`/volumes/data/kailo/tmp/buzz-oidc-release-20261006.VdZaRV/`。
产物为 sha256:6a4c61d44263fb2385926c624f0d9a5a6e85348cbbbfa4484cd4e919508331f5，
真实源码摘要来自原 helper，不手算或弱化源码范围。构建复用 Data 缓存，仍拉取了
基础层，不能称全程离线。

18:02:16 UTC 仅 agentgateway 以该摘要重建，原 Compose up 退出 0；
前后容器清单证明其他服务未替换。匿名 SSE 连续三次均 401、无 Set-Cookie、
无重定向；没有更改额度、权限或清除用户会话。playwright-cli 经真实 OIDC 表单
正常登录并回到 /app/，频道同步成功，截图
`/volumes/data/kailo/tmp/kailo-visual-release-20261006.vlPvnU/65-gateway-6a4-normal-login.png`
已实际打开检查。Web 仍是 a59 旧产物，截图仍有 UUID 频道标题和缺少原版导航，
不把网关发布冒充新界面上线、完整 i18n 或全页面等效验收。

Web/Desktop 新源码仍须原打包和实际部署/安装；Windows 签名与安装业务验收、
Mobile 发布签名、三人双 Agent 稳定协作及三个可插拔服务全链尚未完成。Full 中
实际部署 .env 预检跳过、未安装 gitleaks 的边界保留。此提交是阶段性开发交付，
不是生产就绪声明。

## 2026-10-06 19:13 UTC 新 Core／Worker／Web 投递与逐页实看

本轮仅交付已经实现并提交的恢复批，不增加产品范围。关联 DD-74/75、
SS-BUZ-GOVERNANCE、SS-WEB-PRESENTATION；固定源码
4f5b2403fb71f6a50648768e5ae2c4b62cf25e0c，树
3c330cfc9a7c478bc2e396fbf573e26018e1afc1。原 release.sh 与
build-upstream.sh web-client 均退出 0，真实 registry HEAD 均 200 且摘要一致：

| 服务 | 实际运行 image digest |
| --- | --- |
| Core | sha256:7430056c28a729da649f880a216453a412c21e3e41e1efbaeacbe66db508c9eb |
| Worker | sha256:e47a94b9387da135ae2ce9eed034249d94b1e05f3603d95d22d66ef169637672 |
| Web | sha256:a2ce986c8375b368c43f05c7d9fb687d570219314222afa11db077af559106d8 |

构建及来源原件：
/volumes/data/kailo/tmp/buzz-edit-workflow-release-20261006.CcjKZN/release-receipt.md。
部署原件目录：
/volumes/data/kailo/tmp/buzz-edit-workflow-deploy-20261006.n7ZeJ1/。
原 start-core.sh --no-build 及指定 Worker、Relay、Web 的 Compose up 均退出 0。
仅这四个容器重建；Relay 仍用 c5a484b74e75d24de8f65cab625aa76b3319434bf5d34ffca6821dd39ca5ca30，
没有重建其他数据库或中间件。成员事件运行期清单在原 9、41010、41012 上加入
已实现的 40003；仍由 Relay 验证本人编辑目标与频道归属，未开放 Pulse 1/7/5。

投递存在一次顺序错误：新 Core 先于迁移启动，工作区读取实际报
column w.visibility does not exist，并短暂返回 503。随后复用原初始化入口的
migrate_core_database，仅执行前向迁移，退出 0：

```text
Applied 20261006200000/migrate workspace visibility (4.97833ms)
Applied 20261006210000/migrate publish message edit (2.511978ms)
Applied 20261006220000/migrate automation version name (1.508192ms)
```

只读复核 93 条、max=20261006220000、all_success=true；Core health 200。
未重置数据库、重跑业务任务或修改权限／额度。该顺序失败保留；后续此类发布必须
先按原入口完成向前兼容迁移，再投递消费新列的服务，不能把健康结果掩盖历史 503。

实际 Playwright 截图 66–80 位于
/volumes/data/kailo/tmp/kailo-visual-release-20261006.vlPvnU/，本轮逐张打开：
频道、Workflows、Inbox、成员、Agent、任务、审批、审计、设备和四类设置，
另有英文外观页。经正常 OIDC 表单登录，没有注入会话、mock 或隐藏错误节点。
设置中文→英文→中文实际切换。首次设置脚本的 URL 全局不存在和通知标题重复
导致定位报错，修正探针后继续截图，不把脚本失败算作业务通过。

本轮明确不通过的产品结论：

- 收件箱与侧栏实际显示“未能载入，结果不明”。HTTP 200 不等于消费成功；
  原因是严格消息解码器把同窗口的合法 39005/39006 辅助事件当作 kind 9 消息。
  消费端修复正在实施，本次已上线镜像不包含它。
- 旧频道 Relay 元数据仍是 UUID slug，虽侧栏显示工作区名称，标题仍错误；
  不用客户端覆盖标题伪装原生元数据已收敛。
- Agent／成员页面仍有表单和表格式简化布局；Pulse、Projects、三个组件入口
  仍缺失；Workflows 名称／运行详情的恢复不等于原版多步骤编辑全部交付。
- 个人资料、外观、通知、快捷键可呈现，但未证明原版全部设置项及全部交互
  等效；系统通知许可被浏览器阻止时实际提示，不绕过浏览器许可。
- 英文切换与中文默认有真实页面证据；任务等仍有原始 action key，
  不能声称全量文案覆盖。Windows 没有本批新包，Mobile 没有本批设备验收。
- Agent 旧未知调用仍占用并行名额，另有 native completed 而最终回复未送达的
  失败记录；新时间戳修复已随此 Core 投递，但未据此回写旧失败或释放未知占用。
  三人双 Agent 持续稳定交互仍未验收。

资源沿同一受限 BuildKit，8 CPU / 16 GiB 与 Data 缓存；本批各产品仅构建一次。
部分基础层实际拉取，不能称全程离线。最新整批 full 仍是上一节退出 1；
局部构建、迁移和页面访问不能替代完整退出门禁。

安全处置事实：正常浏览器登录调用未带 CLI --raw，工具输出回显了一份测试
管理员口令；已通过原 IdP 管理入口轮换，受控密码文件和 realm 导入记录同步，
IdP 会话注销、新口令正常登录均实测。其他两名用户未改密；不在本记录存储秘密。
Cells 的独立凭据暴露、两轮轮换和真实拒绝／三用户重登录边界，单独记录于
file-storage/fork/verify/native-identity.md；不把保留原签名公钥等同所有 JWT 即刻撤销。

## 2026-10-06 Pulse 与原版 Agent 卡片集中恢复

在已推送 `9aaa34b130fe54076a30cb741683b654f80267b1` 上合并两项实现，
没有以本文替代页面或发布验收。Pulse 共源主体、Community 读写、本人签名与
原对账链的四步影响、四语言验证、实际变异失败及剩余缺口见
`web-client/fork/verify/web-surface.md` 末节。

Agent 卡片复用 Buzz `779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/features/agents/ui/AgentIdentityCard.tsx::AgentIdentityCard`、
同目录 `CreateIdentityCard.tsx::CreateIdentityCard`、
`IdentityInitialsAvatar.tsx::IdentityInitialsAvatar` 和
`UnifiedAgentsSection.tsx::IDENTITY_CARD_GRID_CLASS`。实现放入 shared
`client-kit/ts/platform/src/react/agent-library/`，Web/Desktop 的现有
`AgentDefinitionsPage` 同时消费，不各写一份页面。

四步结论：权威为 REQ-24、DD-24/25/74/75 和设计 17；仅改变已有定义／安装
页面呈现与选择，不新增端点、状态、数据库、注册表或 Workflow。创建和编辑仍走
原治理意图，关闭表单不卸载未决动作，UNKNOWN 继续锁定。安装卡片只读取现有
授权 API 的精确 pinnedVersion，并核对 Agent 与 asset 一致；拒绝或错误版本不
借用其他 persona，保留原标识、错误及重试。原详情、版本、授权、权限与记忆
管理继续存在；原完整资料抽屉、运行轨迹、Teams/catalog 与运行控制尚未恢复。

既有受限 SDK 内共享源码和测试类型检查退出 0；AgentDefinitionsPage
94/94 通过（144 个范围外用例跳过）。移除 pin 一致性核对后错误身份用例实际
失败，恢复 cmp=0 后 94/94 通过。原件位于 Data
`header-sidebar-fix-20261006.q5aiVW/agent-library-{final,mutation}.log`。

线上额外验收：Playwright 截图 81–86 已打开复核，私聊重新进入读到历史；
经原创建页面提交公开频道“频道恢复验收 20261006”，任务完成后刷新列表、进入
新频道得到真实中文名称。操作 `a54d5db7-1d88-4926-a56d-819b10d110bc`，
不是只把 ALLOWED/DISPATCHED 当完成；没有删除验收频道。该频道只含创建者，
不作为三人多 Agent 协作验收。截图保存在 Data
`kailo-visual-release-20261006.vlPvnU/`。

此批 Pulse、Agent 卡片和已提交 Inbox 纠正尚未构建部署；运行配置未开放
Pulse kind 1/7/5。现有线上版本、旧 Windows 包和 Mobile 验收边界不变。
