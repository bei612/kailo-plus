# Buzz 共享界面与受治理私聊：开发检查点

## 2026-10-06 23:08 UTC 发布回执与真实动态发布修复

Core、Worker、Web 已从固定源码 `10c839d34186d4b1e72a44f83c82d7c420949e7e`
集中构建、推送并限定部署。原入口均退出 0，实际镜像为：

- Core `sha256:e42e3deb0faf34fc3eec1b4daecb85d542cb94865ca2875946f9f926b67ed8cf`。
- Worker `sha256:9558629db918ca34f496d84295dfd3f558ce24af7b823e28a70ace94bda4c42b`。
- Web `sha256:dd59cc60ec1c6c4fc9369c3a43e421185a57f1e75afadf1431dfb6aca58a2717`；
  浏览器 buildId 实读 `sha256:3c06bea4921e8b9c11994d6c6906612c013103daa365b48a4c4b4b9db2b667da`。

构建与部署原日志位于
`/volumes/data/kailo/tmp/buzz-forum-locale-release-20261006.255aFn/`。
复用 Data 上受限 BuildKit 与依赖缓存；本次仍有基础层下载，不能称完全离线。
Relay 保持原 binary，仅投递已实现的 Pulse 1/7/5 与 Forum 45001/45003 运行期开关；
没有开启原生工作流引擎、管理员删除或投票。Windows/Mobile 未更新。

真实浏览器发布动态首先返回 503，Core 原日志明确为
`publish_attempt_message_kind_check` 拒绝 kind 1；同一旧约束也遗漏 kind 5/7。
四步结论：权威为 REQ-24、DD-39/81 与设计09 Pulse Community 边界；读写影响面是
原 `web_transport::publish`、`publish_reconcile` 和既有发布意图表，不改契约或
正文权威；仅增补已接入 kind 的封闭枚举，原认证、作用域、作者、目标形状、审计
与幂等全部保留。缺审计仍不发送，UNKNOWN 仍按原事件对账；新旧写入兼容，
无新状态、额度或工作流。回退遇到新 kind 记录明确拒绝，绝不删除对账身份。

直接补充 `20261007015000_publish_native_kinds`，不修改已执行迁移。
原隔离库 up/down/up 通过；实际复制原表约束的事务检查接受 1/5/7 与原消息类型，
拒绝 9005 和错误删除目标。撤回迁移后同一检查真实失败于旧 kind 约束，恢复后通过。
随后沿原初始化迁移函数，以 2 CPU/2 GiB cgroup 投递，输出
`Applied 20261007015000/migrate publish native kinds (2.858738ms)`，数据库实读
`96|20261007015000|t`。首次调用因缺 TMPDIR 退出 2、未执行迁移；
补上既有 Data 临时目录后成功。没有为这条 SQL 重编 Core/Worker/Web。

原页面复验：发布、点赞、回复、取消赞四次均返回 200，事件引用依次为
`0f8c4ad46d363cad4367cb7aecbbf31fb5b71f4733aa9075c9c29d2938ecc257`、
`8c5fa62f927745a4bd3734203bb15337c6d54354db0569f0aca9cf7ac7713daa`、
`8bd790184681b7a5def04b0be6892765b039334af7c174e64ad3c4c370e6b8d4`、
`42d26177ec0a7ea50655c0bc9e831d7ffe877c0083e591c0828ae019f61a7c31`。
已赞筛选读到原帖，回复显示原帖引用；只操作本次创建的开发验收内容，
不重放旧 Agent UNKNOWN。该结果不代替 Forum 作者删除业务验收。

Playwright 视觉目录沿用 `kailo-visual-release-20261006.vlPvnU`：
134–142 为加载后的收件箱、动态、成员、Agent、工作流、任务、审批、审计、设备，
143–145 为真实动态操作，均逐张打开。125–133 多为加载态、122 为重新登录页，
不作为相应页面通过证据。成员/Agent 管理仍有长表单堆叠，工作流仍有重复刷新；
完整原版交互、每个弹窗、双语全覆盖与 Web/Desktop 等效尚未验收。
动态图145捕捉到动态高度更新前的重叠；下一帧测量后两卡片边界分别
357–655、671–757，没有持续重叠。首入含数据的虚拟列表还出现过空白，
窗口改变尺寸后显示，仍需定位，不将这一路体验判为完整通过。

知识库合同种子源码已推送 `89f69014d2682bda65bc5f1ee77c1fa7c9a29080`，
但不在本批镜像中；Projects、升级与原生知识库后续接缝仍是未部署增量。
设计独立推送 `ce36d906e7ef8f230e2adef4b3b40ad1643caefe` 澄清同一协作根
按安装代际冻结 Session，不复制或抹去历史。旧完整检查仍退出 1；
这次真实页面和迁移证据不将其改记为通过，也不证明三人双 Agent 已稳定可用。

## 2026-10-06 22:38 UTC 批次提交与发布中状态

相对 `95abbc4aed07dc14d99b6d4043c049357e22758d`，消息作者删除、原版共享
消息排序、组件 peer 原生凭据投递及 Task/Audit 中英呈现已合为 50 文件
`+1695/-133`，提交并推送 `10c839d34186d4b1e72a44f83c82d7c420949e7e`。
共享双语 38 项、未知状态变异 3 项确实失败后还原通过；最终 shared 源/test
tsc 退出 0，最终 Core 删除守卫 27 项通过。实际 full 的固定旧树
`c75e61b84657dacf81159b94aec73d87b5e61396` 退出 1：类型索引（后续已修）、
错误隔离数据库网络及旧产物追溯；细节及原日志见 Web surface 回执。
不能把后续窄验当作完整检查通过。

设计 `503357266dbf09e7f09b5705f7be8e5137ca25b4` 已独立推送：澄清原生
Projects 公告与仓库内容授权边界，以及单进程 Agent 升级只排空、撤权才立即
中断的区别。实现 pin 提交为 `c47c766d012c0c8cc820df6da775ddeff118363a`。
原文档检查实际退出 0。

Native 出生持久化修复另行提交并推送
`1cdc4b3e2c35df8c7ab7d8bf925686cd94a0b774`，4 文件 `+144/-34`。
仅格式检查及旧二进制独立实验通过；新 Native 编译与新增用例尚未执行，不含在
当前发布输入中。旧丢失线程仅发现空锁文件，没有 rollout 或历史记录，不能据此
释放 UNKNOWN 或重放原调用。新排队调用仍不是正在恢复该旧线程。

原 `tools/release.sh` 已对干净固定 `10c839d3` 启动一次 Core/Worker 集中构建，
现有 BuildKit 8 CPU/16 GiB，复用 Data registry/target cache，Cargo 并行配置未降低。
原运行句柄 4495 和容器内 cargo/rustc 实际仍在运行；尚未获得新镜像终态，未部署。
原件在 `/volumes/data/kailo/tmp/buzz-forum-locale-release-20261006.255aFn/`。
仍拉取了部分固定基础镜像层，不称完全离线。随后 Web 构建/投递与实际截图须按
真实产物继续，不能使用现有旧截图作为本批视觉验收。Windows/Mobile 包未更新。

三个队友继续并行实施原版 Projects、Agent 单进程排空升级和 KNOWLEDGE 种子/
WeKnora Remote Adapter；三组件平台绑定、完整 Workflows、完整原版体验及稳定
三人多 Agent 协作仍未交付。以上是进度，不是一期生产就绪声明。

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

### 2026-10-06 集中检查失败与发布边界

后续提及歧义的中英文修复已提交并推送至
`d0304fed82fdca81e4a3a047dc0eba6244f045d1`，但未部署。集中检查的实际输入
仍是 `fb38358d1801d48e4a7d24caf8340d4f640cab6a`，不覆盖后续提交或在途修改。
原 `tools/check.sh --full` 已完成静态检查、契约、Cargo/Go/Dart 测试和
Workflow replay；真实数据库迁移因未投递 DATABASE_URL 而跳过，不算通过。

该轮存在两个明确失败：TypeScript 的共享页面主题检查拒绝恢复的原版卡片
配色和已有 `card` 语义色；追溯检查找不到 conversation 对应 Core/Worker
发布产物，并报告 Pulse 缺少发布 digest。单独提取 TypeScript 原始输出后，
contracts 为 25/25，共享 platform 为 471/472。不能删减原版呈现或填入
无对应产物的 digest 来通过检查。

针对主题检查的窄验有两次 worker 启动超时，均为 0 个用例实际执行，不能
称修复通过。Data 可用空间降至约 3 GiB、磁盘等待持续升高后，停止已有失败
的全量检查容器 `042487551fb99f38aab52924a1275a1e5719c0d67dffb2db67f03d3943e39051`，
最终退出码为 137，未完成 supply、seam、security 等后续步骤。只停止本轮检查，不清共享缓存、
不停止线上服务、不改认证授权或运行配置；完整失败日志保留在 Data
`pulse-agent-integration-20261006.yBMzaY/`。原脚本退出清理其自建临时源码目录，
源码可由固定 Git 输入重建；清理后 Data 可用空间约 5.1 GiB。
本轮没有完整检查退出 0 的证据。

Playwright 截图 `87-current-channel-a2ce.png` 已打开检查，实际线上仍是旧
Web 产物 `sha256:a2ce986c8375b368c43f05c7d9fb687d570219314222afa11db077af559106d8`；
截图中的侧栏载入错误与未恢复入口仍存在，不作为 Web/Desktop 原版体验
等效、每页视觉验收或三人多 Agent 稳定协作的通过证据。

本节更新后，在既有 4 CPU / 8 GiB SDK 使用固定设计
`81cf51331655c61274f95ebf0204791331fc115e` 执行 `tools/check-docs.sh`。
首次未指定已有 npm 缓存而报 ENOTCACHED（退出 1）；沿用原 `/cache/npm`
并保持离线后退出 0：277 个设计引用闭合、87 个实体、115 个 DD、29 个 SS、
87 个验收场景中 86 个已映射、1 个明确排除，两侧 markdownlint 均通过。
未安装或下载依赖。
日志分别为上述目录 `checkpoint-docs.log`、`checkpoint-docs-cached.log`；
该文档检查不替代源码、发布产物或浏览器功能验收。

本次消息头像文案改动对应 DD-53、REQ-24：固定 Buzz
`779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/shared/ui/UserAvatar.tsx::UserAvatar` 原样交互保留，共享
`client-kit/ts/platform/src/react/messages/UserAvatar.tsx::UserAvatar`
只将英文裸写的图片替代文本接入既有 `platform.profile.avatar` 中英 key。
影响读取方为消息行、线程摘要、Inbox、Pulse、Forum 与 Desktop 的原共享
包装器；locale 沿既有设备/宿主上下文，不新增偏好权威。显示名仍保持原文，
空头像不产生图片，动画/静态图均使用同一替代文本；尺寸、回退色、形状、媒体
地址解析、加载失败行为不变。无契约、数据库、Workflow 或认证授权变化，
不新增异步状态、副作用、兼容窗口或错误分类。

资源释放后，同 SDK 的主题定向检查实际通过 1 项（237 个范围外用例跳过）。
修正只承认两端已有的 `card` 语义色，以及固定 Buzz commit 的
`desktop/src/features/workflows/ui/WorkflowCard.tsx::TRIGGER_ACCENTS/ACTION_ACCENTS`
三个精确配色；每个配色必须唯一出现在现有 `AutomationCard`，其他位置不
豁免。没有改产品配色、主题或页面，也没有放开任意硬编码色。随后仅在 SDK
副本卡片追加 `bg-pink-500`，实际报 `expected [ 'pink-500' ] to deeply equal []`
并退出 1；还原后源码 SHA-256 与变异前一致，再次 1 项通过、退出 0。
原件为 `theme-mutation.log`、`theme-restored.log`，不是整套页面测试通过。

最新消息头像源码与正式 `message-row.test.tsx` 同步后，已有消息行 8 项
全部通过（`message-row-restored.log`）。早先队友 SDK 的旧夹具只有 4 项，
不将旧夹具结果冒充当前输入验收；该 8 项也不构成每页视觉或全 i18n 覆盖证明。

## 2026-10-06 21:17 UTC 源码与在线体验分账复核

四步结论：本次文档仅同步 REQ-24、DD-53/75 的实际交付证据，未改变设计、
接口、数据库、工作流或权限；影响读取方是工程使用入口和恢复验收记录。
不新增状态或副作用；源码、局部验证、提交、镜像和浏览器验收分别记录，
加载中、会话过期、空列表和结果不明不作为功能完成。未改动 `.design`。

实际本地分支及远端读回均为 `0238a858f87a32b1d90eaafb5a27691321d4b5c4`。
该提交相对 `d0304fed82fdca81e4a3a047dc0eba6244f045d1` 为 42 文件、
842 行新增、408 行删除；删除包含已由共享资料组件替代的两份重复实现，
不表示删除对应原版能力。不能把此提交或已有源码验证当作已发布。

本次 Docker 实读仍为 Core `7430056c28a729da649f880a216453a412c21e3e41e1efbaeacbe66db508c9eb`、
Worker `e47a94b9387da135ae2ce9eed034249d94b1e05f3603d95d22d66ef169637672`、
Web `a2ce986c8375b368c43f05c7d9fb687d570219314222afa11db077af559106d8`。
三者属于前述 19:13 投递批，未在本次核对中重建或替换。

Playwright 沿既有真实浏览器会话截图；第一次切到收件箱时会话过期返回 OIDC，
后续成员定位超时，不记为通过。使用原开通账号正常重新登录后继续，未 mock
响应、修改权限、重置密码或重放旧 Agent 任务。截图仍在前述 Data 视觉目录：

- `88-current-channel.png`：公开验收频道名称和共用富编辑器可见，侧栏报错。
- `90-inbox-relogin.png`、`93-workflows.png`、`94-tasks.png`、`95-approvals.png`、
  `97-devices.png` 是加载中截图，不能作为加载完成的证据。
- `91-members.png`、`92-agents.png`：实际仍为简化管理表单；`96-audit.png`
  展示真实审计列表，不能以列表存在宣称完整审计业务验收。
- 等待加载态消失后重新截图 `98-inbox-settled.png`：收件箱明确报结果不明。
- `99-workflows-settled.png`：当前新建频道的自动化为空，有创建入口；没有
  操作创建，空列表不证明已有工作流丢失或多步骤已实现。
- `100-tasks-settled.png`：真实任务列表同时存在完成、失败、进行中和取消待终态，
  未把历史已完成回合外推为当前多人多 Agent 稳定可用。
- `101-approvals-settled.png`、`102-devices-settled.png`：分别为空审批队列及有效
  设备列表，未执行审批或撤销。上述图片均实际打开检查，不仅读取 DOM。

剩余产品差距仍包括 Pulse/Projects/组件入口、完整 Agent 与资料交互、多步骤
Workflows、全站双语和 Windows/Mobile 实机验收。本次不宣称每个子页面、弹窗、
异常态或 Web/Desktop 官方等效已经验收。Data 本次约剩 6.2 GiB，已有 WeKnora
单次构建继续运行；没有启动重复编译、全量检查或清空共享缓存。

## 2026-10-06 21:58 UTC 实际发布、逐页截图与 Agent 验证

上述 21:17 时点的旧版本状态由本节后续结果更新。源码增量已普通推送：
`cc71bf7b10388e450a550bcf01a562b3c7527865` 为共源服务入口、Forum 作者资料和
频道回复状态保留，12 路径 +332/-13；`ef92cc73ccd2482f759fdc7b19ffa6843e4b2d79`
为 WeKnora 后端产物/真实单服务部署回执，2 路径 +138/-3。二者不修改设计合同。

Core/Worker 实际构建源为 `433ec461456f9def7da892b270cdceb9def77fca`；Web 唯一
构建源为 `cc71bf7b10388e450a550bcf01a562b3c7527865`，没有先构建 433 Web 再重建。
原发布入口、registry push 与三个部署入口均退出 0。镜像实际读回：

- Core `sha256:b1c8108f6e1f6c34e27d566f9010e369f07138dec32c3f8e0a11f8a5499ceb6b`。
- Worker `sha256:5bc2763db9af3298c3adee3680349ac7941ebaf8fa5946b9073e3419c2106fbf`。
- Web `sha256:b54d6bccfaa10fdd5d6c8a30746ff236052dbcfc9ff8ab74c029a6c1c469c415`。

原迁移入口先前向执行 `20261006230000_capacity_active_session_recovery`，94 条迁移
全部成功；随后 Core→Worker→Web 投递，Core health 200，Web healthy，三容器
restart count 为 0。源码锁、SBOM/provenance、registry 独立读回、真实命令与日志
在 `/volumes/data/kailo/tmp/buzz-runtime-author-release-20261006.VJnPeY/release-receipt.md`。
复用原 Data builder/cache，但确有基础层下载及依赖安装，不称完全离线。

正常 OIDC 重新登录并刷新新版后，Playwright 实际截图并逐张打开：同一 Data 视觉
目录 `/volumes/data/kailo/tmp/kailo-visual-release-20261006.vlPvnU/` 的
`109-cc71-channel.png`、`110-cc71-inbox.png`、`111-cc71-pulse.png`、
`112-cc71-agents.png`、`113-cc71-members.png`、`114-cc71-author.png`、
`115-cc71-profile-settings.png`、`116-cc71-notifications.png`、
`117-cc71-shortcuts.png`、`118-cc71-appearance.png`。

本次明确的改善：侧栏与 Inbox 的读取错误不再出现；Inbox 呈现原双栏空态，
不是全频道流水；Pulse 呈现原筛选/编辑器空态；Agent 定义恢复卡片；频道作者
可打开实际 event-scoped 资料辅助列。成员页仍是管理表单，Agent 下半部仍堆叠
治理管理区，Projects 仍缺，不能据此验收完整官方体验。资料的真实 kind-0
未设置显示名时展示原公钥回退，不假造资料。通知页实际显示浏览器通知被阻止，
不改浏览器权限冒充原生通知成功。外观页即时切英文实际读回 Appearance/Theme/
Preferences，随后恢复中文；这不是全站所有子页双语穷尽验收。

主线程随后仅从真实频道编辑器新发一条消息，选中两个已有 Agent Installation，
标记 `KAILO-CC71-20261006-2156`，明确禁止工具与外部动作，没有重发旧 UNKNOWN。
消息发送成功不等于 Agent 完成：初查两个 invocation 分别 CREATED 和
RUNNING/native completed，均无回复引用。实际只读记录及原日志定位为：

- `2bc7a1f0-5bcc-4611-bfb7-2cc264a636cd` 为 CREATED，关联 session 为 PENDING，
  自身没有 thread 或 lease。占用同一安装执行名额的是旧 UNKNOWN 调用，其原线程
  resume 报 `THREAD_NOT_FOUND`；不是新调用恢复线程失败。未释放证据不足的旧
  UNKNOWN、伪造新线程或把新调用称成功。
- `3ffbbd52-ccda-4e14-b875-e55682ed387e` 已生成，但 OpenMeter 不能投递用量。
  原 Kafka 容器实际 `OOMKilled=true`、exit 137，20:21:51 UTC 停止；API/sink
  日志为 broker DNS 不可用。保留原镜像、卷与所有业务状态，仅启动同一个 Kafka
  容器；确认本机约 31 GiB 可用内存后，把唯一 `.env` 的 Kafka 内存预算从
  2 GiB 提到 4 GiB，同步实际 cgroup memory/swap 都为 4 GiB，原 JVM heap 1 GiB
  和 CPU 2 不变。没有修改额度、计费判断、密钥或清除用量。
- Kafka 随后 healthy；原对账自动将第二份 invocation 于 21:58:17 UTC 收敛为
  COMPLETED/native completed，reply event 为
  `929ce5d337962464d96154a15c79cc2a170773f3f72d3ce3e2cb4bfab17fe557`。
  浏览器实际读到 Agent `0fe864a6…58bb` 的同标记回复，没有再次调用模型。

这是一次真实单 Agent 收尾恢复，不是双 Agent/三人稳定协作验收；另一安装的
线程恢复缺口仍由原路径修复。Kafka 本机预算属于运行投递，不提交含秘密的 `.env`。
本批仍无新 Windows/Mobile 包、全量检查通过或全部页面/弹窗的等效验收；不把
截图数量当成独立页面数量，也不把容器 healthy 当成功能完成。

补充实际逐图复核：上述视觉目录 `119-cc71-appearance-en.png` 为外观英文切换，
`120-cc71-agent-reply.png` 为新 Agent 回复。后者同时暴露频道时间顺序疑点：今天
的新消息之后还展示昨天的 Agent 回复，需要核对原版线程分组与时间排序，不能
只凭回复可见称频道细节恢复。

发布回执所在目录中的 `01-workflows.png`、`02-tasks.png`、
`03-approvals-loaded.png`、`04-audit.png`、`05-devices.png` 也已由主线程逐张打开。
工作流为选定频道空态与创建卡片，仍有重复刷新和技术文案；任务页呈现真实状态，
但动作名仍为原始技术键；审批为加载完成的空队列；审计仍有 ALLOWED、EVALUATING
等未翻译结果；设备只展示协议身份及撤销入口。本次没有执行审批、撤销或工作流
写入，不使用加载中的审批截图作为验收。这些差距仍属于未完成项。

## 2026-10-06 23:42 UTC 集中源码验证与发布边界

相对 `b08e0a0578dc7777ecec108e24d248a8348a832b`，集中实现树
`2a68468a17beb1654cad265ff26268360c2c9996` 为 75 文件、3922 行新增、373 行删除。
包含 Projects 共源目录、成员原资料行及受权读取、Agent 安装升级/代际会话隔离、
Pulse 虚拟列表首入及切回修复、能力输入的 typed reference 校验。各领域的权威、
影响与边界记录分别在 web-surface、agent-definition、capability-contracts，
不因本批合并新增需求或变更 `.design`。

原 `./tools/check.sh --full` 在 8 CPU / 16 GiB、Cargo 16 的检查容器运行，
源码与设计固定归档，数据库是独立演练库，不操作在线业务库。实际退出 1。
日志 `/volumes/data/kailo/tmp/tmp.T1QBNrAP4L.check.log` 保留完整输出：

- Rust/Go/TypeScript/Dart 静态检查与测试通过；Core 主模块 276 通过、34 忽略。
  忽略的独立数据库/运行演练不记作通过，其余 crate/integration 结果见原日志。
- 四侧生成同步，242 个 schema 的兼容比较通过（历史 tag 仅匹配 3 个 schema）。
- 迁移前进、回退、再前进和 sqlx 离线元数据通过，44 个命名枚举约束一致。
- Workflow replay、设计文档六项、安全静态检查与 runbook 检查通过。
- 失败项一：17 条 Web 追溯仍引用旧产物、私聊 Core/Worker 旧凭证未归集，以及
  Projects/Pulse 尚无 artifact 记录。既有发布记录只按实际镜像及原证明修正；
  Projects 没有新产物不能记为已发布，且不能借改变 exposure 缩减应交付功能。
- 失败项二：agent-runtime、desktop-client、knowledge-service、web-client 的
  已构建 artifact 与最新 source digest 不同。未重建则保留此失败；不手改
  source digest 冒充重建，不删除检查，不宣称新发布已完成。
- 实际运行配置预检因检查快照不带秘密 `.env` 明确 SKIP；不能作为部署通过。

原 23:08 批的 Core/Worker 四份 SBOM/provenance 从其固定提交发布目录归集至
`dist/`，没有重新生成、改写或覆盖旧文件。Docker 再次读回 Core
`e42e3deb0faf34fc3eec1b4daecb85d542cb94865ca2875946f9f926b67ed8cf`、Worker
`9558629db918ca34f496d84295dfd3f558ce24af7b823e28a70ace94bda4c42b`、Web
`dd59cc60ec1c6c4fc9369c3a43e421185a57f1e75afadf1431dfb6aca58a2717`，
与原 10c839 发布证明一致。记录指向真实既有发布，不表示本批新增源码已经上线。
追溯窄验日志 `tmp.muxGzbK60w.check.log` 中七条硬规则通过，但临时把尚未发布
Projects exposure 改 none 导致能力注册表漂移；已撤销该改动，保留其原用户入口
和发布凭证缺失状态，不以改注册表压掉失败。

Playwright 沿原普通登录会话实际截图并逐张打开同一视觉目录的
`148-current-channel.png`、`149-channel-pointer-content.png`、`150-profile.png`、
`151-appearance.png`、`152-notifications.png`、`153-shortcuts.png`。最初把
Pulse 悬停浅底误判为双选，随后实际 DOM 读回 data-active=false；移开鼠标背景
消失、移回 hover=true，确认正常交互，没有为误判改代码。设置四页可见中文
分组及中英切换入口；通知明确显示浏览器权限被阻止，不记作通知已送达。
本批不修改浏览器权限，不称所有页面、子弹窗、英文状态和 Win11 交互已验收。

## 2026-10-07 工作流、成员及组件接缝集中源码批

相对 `c9b7634fdb822558e0d00ffaf6f56bb7df9ee609`，实现树
`ac0c889e2cb73b763c16eeb0d2ce8fa842a7f352` 为 56 文件、4179 行新增、395 行删除，
不包含本节及 README 的结果记录。源码写入与发布分开记账：本批没有新部署、
Windows/Mobile 包，也没有新的全量检查退出 0。

权威与影响复核：REQ-23/24、DD-107、V-SCN-83 要求恢复原 Buzz 工作流交互，
不是把原工作流缩成单动作；固定 Buzz `779af8886caae1317b4de962082429867ab61503`
的 `crates/buzz-workflow/src/schema.rs::{WorkflowDef,Step,ActionDef,normalize_cron}`
确有多步骤及七种动作。设计提交 `86df37823219b4a1cdf094178379cbe929d8e412`
修正此前范围矛盾，旧单动作格式仅保留为已有版本兼容说明；本批菜单和步骤轨迹
不冒充已实现全部动作与触发。执行权威仍为 Temporal，未恢复 Relay 独立执行器。

本批实际实现：原工作流操作菜单、真实运行步骤轨迹、原 Agent 管理弹窗；成员
操作可用性由服务端事实投影，写入仍重新鉴权。成员／邀请页后续读取 403 不再
清掉已有 UNKNOWN；运行中、尚未派发及不匹配的 Operation/ActionExecution
不会误判终结。两端消费同一 TypeScript 主体，Mobile 未新增组件宿主。

组件身份与执行证据仍依既有接缝及 ADR-19；本批更新生产请求形状、哈希和授权
版本关联，不能借验证专用形状或共享身份放行。契约四语言生成及序列化证据在
`component-release-registration.md`。WeKnora 原生读取、导出和条件删除经过
Adapter／原 MCP 接缝；正文不复制到 Core，任务入队不代表业务完成，尚无终态
回执的删除继续待对账。下一个 Native 清理回执批不在本树内。

ActionDefinition 不可变保护的原 BEFORE UPDATE 在存储生成列求值前比较字段，
造成合法状态变更被误拒绝。前向迁移将 UPDATE 校验移到 AFTER，DELETE 仍在
BEFORE；没有豁免字段或降低正文保护。独立数据库 up/down/up、合法状态更新、
正文改写与已引用删除拒绝均实际验证；把 AFTER 改回 BEFORE 后原用例真实失败，
恢复后通过。该迁移尚未投递在线库。细节在 `governed-action.md`。

集中前端证据在 Data 的
`codex-agent-receipt-regression-20261005.XvkUjX/combined-ui.2YbUtf/`：

- 源码与测试 TypeScript 检查退出 0；依赖离线命中 293 项、下载 0。
- 首轮 529 项通过、两项失败及一套件加载失败：临时快照漏导出 presentation
  fixture、原管理员蓝色徽标被通用颜色检查误拒绝，以及主题用例并发超时。
- 补齐真实 fixture；徽标检查仅允许原版精确标签，不改原版颜色、不豁免其它
  字面颜色。固定 Buzz 同提交的
  `desktop/src/features/community-members/ui/CommunityMembersSettingsCard.tsx::RelayMemberRow`
  确为 `text-blue-500`。临时改为 blue-600 后检查实际失败，恢复源文件且 cmp 一致。
- 最后一次 `vitest run --maxWorkers=4` 实际 38 文件、538 项通过，18.25 秒，
  没有延长主题用例超时。日志 `combined-ui-restored.log`、`member-badge-mutation.log`。
- 双宿主额外 TypeScript 检查因临时依赖路径缺少 tsc 退出 127，不能记通过；
  共享包检查通过不能替代此项或真实 Windows 运行验收。

原 `tools/check-docs.sh` 对固定实现树 `1c7bbdffd1c7898eafe957ed30cd061daf0b501c`
及上述设计 pin 实跑退出 0，七项全通过，日志
`/volumes/data/kailo/tmp/tmp.7pDlsOVrOZ.check.log`。该树与本树差别是随后已单独
验证的 ActionDefinition 迁移及证据，不能将该结果夸大为本树全量检查通过。

本批没有新的逐页截图。已有 148–153 的真实截图对应上一在线版本，不用于
验收本批源码。原生运行时镜像构建仍在执行，Data 空间紧张时停止新增重构建，
保留共享缓存与原在途进程；其余源码开发及本批提交不等待构建结束。

## 2026-10-07：共享线程布局提交与固定批发布进展

原线程偏好、focus drawer 和外观控件已按 REQ-24 / DD-53 从原 Buzz 实现
移入共享 TypeScript，Desktop 原路径消费共享导出，Web 接上真实面板消费者。
提交 `7aa8a4d0348fbe224900043957e974e898040257` 已推送并从远端回读一致；
相对 `46fcd1a68b92962c37b7ac8eb37fb3411f223d7b` 是 16 文件、693 行新增、
550 行删除，删除的是被共享实现替代的副本，不是删掉线程功能。
最终共享源码、共享测试、Web、Desktop 四处 TypeScript 检查退出 0。
原设置消费者断开回调后真实失败，按原字节恢复后通过；最终 Web 拖拽宽度与
UNKNOWN 子树行为用例此前遭 worker 启动超时，仍未验收。精确记录与原日志
目录在 `web-client/fork/verify/web-surface.md`，不以类型检查替代视觉和业务验收。

当前发布输入仍固定为父提交 `46fcd1a68b92962c37b7ac8eb37fb3411f223d7b`，
没有在构建途中夹入线程布局或下一批多步骤、组件导入修改。Web 原构建入口
退出 0，source digest 为
`d923beaf529b24163c3945e3e72a6f66932fba3d61f28d74623bfc3aaf6a27f4`，
镜像为 `sha256:8ef88085fb05f7e208c54a51e23b4b2804438ec8bd962e3446ad9c7db64676ab`。
Core release 编译、镜像导出、SBOM 与 provenance 已完成并推送镜像
`sha256:1209f3ece3ed68ea4de7bb0fed53349d458dab2b27eeb7e69db5a89c91ed6626`；
同一 release 进程继续构建 Worker。两项原日志分别是 Data 下的
`tmp/build-web-client.dpLo0g.log` 和 `tmp/release-core.7DmeOL.log`。
这些是产物事实，不代表已部署或全量通过；构建确有基础层网络下载，不能声称
全离线。没有重复启动该批构建。当前线上仍为旧 `10c839d` 批。

Playwright 真实截图 `155-live-10c-channel.png`、
`157-live-10c-workflows-selected.png`、`158-live-10c-workflow-editor.png`
均已打开查看，目录为
`/volumes/data/kailo/tmp/kailo-visual-release-20261006.vlPvnU/`。
截图 156 一度误把侧栏 hover 当作选中；回读工作流 `data-active=false`，
按稳定 test id 点击后为 true、正文标题为工作流、控制台错误与警告均 0，
没有为该误判修改导航源码。旧工作流仍有重复刷新、大片空白和动作范围不足，
旧频道还存在原名称写成 UUID 的历史数据；没有伪造展示名或借截图称全功能。
本节不覆盖全页面、全部中英状态、Windows 或 Mobile；原完整检查退出 1 的
事实未改变。下一步验收必须针对实际换版后的产物重新进行。

### 同批随后实际部署（2026-10-07 01:38 UTC）

上节仍在执行的原 `tools/release.sh` 现已退出 0，Worker 镜像为
`sha256:bd8d5386f0afca7491470cf7cf7daeddf1729fec2f67ada98173ebffee1321f6`，
日志 `tmp/release-worker.kH2ta2.log`。Core/Worker 的 SBOM 与 provenance 已由
原入口生成；三镜像 registry 摘要与实际 Compose 容器镜像读回一致。发布源
仍为固定 `46fcd1a68b92962c37b7ac8eb37fb3411f223d7b`，不是后续脏工作树。

投递前停止旧 Core/Worker writer；原迁移入口在受限 4 CPU、8 GiB SDK 内
实际执行，退出 0：

```text
Applied 20261007020000/migrate capability knowledge seed (8.968072ms)
Applied 20261007030000/migrate agent installation upgrade (19.12872ms)
Applied 20261007040000/migrate action definition generated guard (1.631812ms)
```

原库回读为 99 条成功迁移，最新版本 `20261007040000`。停 writer 后的备份
位于 Data 的 `tmp/pre-release-46fcd1a.WwFUiU/core-writers-stopped.dump`，
SHA256 为 `4a6bf6ea4b5e6540f2ccfbbde1bf2c4759545b103acbc8cf60fae8deba66374c`，
不清库、不混入下一批 050 迁移。原 `start-core.sh --no-build` 使用新的一次性
OpenBao wrapping 启动 Core；随后仅替换 Worker/Web，两步均退出 0。
实际 Core `/healthz` 返回 200，Worker running、Web healthy；其他服务未重建。

同一正常 OIDC 会话刷新后，实际截图并打开查看 `159-live-46-channel.png`、
`160-live-46-projects.png`、`161-live-46-members.png`、`162-live-46-agents.png`、
`163-live-46-workflows.png`，仍在上述 Playwright 目录。Projects 搜索/排序/
网格列表控件及成员资料列表可见；当前项目为空，不能当成项目操作验收。
Agent 与 Workflows 仍有重复刷新、技术性提示及布局差距，工作流范围也未完整。
本次不将容器健康、截图或已发布 Cron 当作原版全功能、中英全覆盖、多人双 Agent
稳定协作或三组件完整集成的验收。Windows/Mobile 包未更新，完整检查仍无新 0。

### 双 Agent 实际回读与容量等待修正（2026-10-07 02:05 UTC）

正常登录 Web 后，在原 Kailo 频道仅发送一次新消息，明确选中两项已准入
Installation，没有重发旧任务、释放旧 lease 或修改商业额度。源事件为
`535a813b6d91817ccf7f8a6a7e61a5dffd7c3c567caa306e805ac21a0fc3a939`。

- Invocation `f9707351-5517-4eab-ad78-329fcdde60ce` 已为 `COMPLETED`，原生
  turn `01a11412-9e57-7df3-b352-b4014cd0f565` 为 `completed`，回复事件
  `ceda643f9a5a892d4bd29869e8bbf35eb68b9f090775aa31a55fe9f5f78a9a75` 已在
  原频道实际显示；容量已释放，用量数量 8957、状态 `COMMITTED`。
- Invocation `894f4ee2-39eb-4567-8693-88cb11ce76ec` 仍为 `CREATED`，没有
  runtime turn、lease 或 usage。该 Installation 冻结 parallelism 为 1；旧
  Invocation `db6dfccb-f0db-409a-8ed6-d81e64e277d9` 的一个 unit 仍为
  `UNKNOWN`，旧 thread 无法恢复。不能用第一条成功证明双 Agent 稳定通过。
- Worker 的实际 `AdvanceAgentTask` 日志反复显示 `CAPACITY_UNAVAILABLE`
  回包后 `context deadline exceeded`；页面投影保留 `UNKNOWN_EXTERNAL_RESULT`。
  根因是明确无 lease 的容量等待也返回 `finishActivity=false`，使观察 Activity
  持续占用至 StartToClose 超时，未将已经查证的背压原因投影给用户。

截图 `165-live-46-agent-unknown.png`、`167-live-46-latest-agent-reply.png`
位于上述 Playwright 目录，均已打开查看。频道真实回包存在，但任务页面仍有
技术标识过多与布局差距。第一次任务页探针误用 heading 定位，而页面标题为
generic；后续实际 DOM 可进入任务，不为该探针错误修改导航。

本次实现影响四步结论：

1. 权威为 `.design/11` §2 的 CapacityLease、`.design/06` §3–5 的原生
   Activity 与 TaskProjection；既定容量背压与结果不明不得混为业务失败。
2. 影响只在 Core `agent_task::advance` 的 CapacityError 消费：
   `acquire_or_renew` 的两处 Exhausted 都在确认没有现存 lease 且未分配之后；
   已有 holder 走其原续租/恢复路径。Worker 原 `finishActivity` 消费、原生
   timer 和 Web/Desktop/Mobile 原任务投影读法不变，无 schema/API 变更。
3. Exhausted 现在只结束本次观察 Activity，仍返回 RUNNING 和原容量等待码；
   不释放其他或当前 lease，不重放 invocation，不改审批、额度、模型或身份。
   Unknown/数据库错误仍不能证明没有占用，保留原观察；Rejected 仍为 409。
4. 并发与重入仍由原 pool/Installation 锁处理；超限由已投递 observation
   interval 的 Temporal timer 等待，继续沿同一 Invocation 查证。旧任务会话
   丢失、用量缺失、撤权与取消路径不被假终态覆盖。该修改不解决旧 UNKNOWN
   会话本身，亦不把后续源码修正冒充已部署验证。

源码修正后在既有 4 CPU/8 GiB SDK 与审批步骤合批验证。真实响应映射用例
`agent_task::receipt_tests::only_proven_unleased_capacity_wait_finishes_observation`
通过，覆盖 Exhausted、Unknown、数据库错误和 Rejected。随后只在 SDK 副本
把该响应的 `finish_activity` 改回 false，用例真实失败，退出 101；按原字节
还原后再次 1 项通过。主线程已比较该函数和用例文件与正式源码，`cmp` 均为 0。
原日志在 `/volumes/data/kailo/tmp/workflow-approval-20261007.fZc73u/` 的
`core-mutation.log` 与 `core-mutation-restored.log`，不是线上修复成功证据。
该检查覆盖已调用的错误响应映射，不替代 PostgreSQL 并发分配、真实 Temporal
history 或新部署的端到端验收。未新建镜像、未修改线上旧 UNKNOWN，没有新的
`check.sh --full` 退出 0。

### 审批步骤与独立组件读取导入合批（2026-10-07）

本批基准为 `f2afb73c86e263d6a0e3d4c027dce8b26af3adb4`，保留已入库的
SERVICE 资源授权及容量等待修正；合并审批候选
`ff14c0961914055412b1da5248a288e708ac2871` 与读取导入候选
`b2d1dafe140b2ae892447c35f8193cf7503efac1`，不夹带下一批授权页面、表情
工作流动作或读取终态收敛实现。权威、四步影响、上游 commit/path/symbol 及
各模块正反验证分别见 `web-client/fork/verify/web-surface.md` 的审批步骤记录
与 `knowledge/adapter/verify/native-read.md` 的 Receiver read batch 记录。

共享文件通过私有 index 合并，原正式工作树及其他队友未提交内容未覆盖。
四侧往返文件保留 SERVICE 权限、审批步骤、receiver read grant 三组消费者；
生成代码没有将文本合并成功当成正确性证明，而是从最终联合 schema 使用
原 `tools/gen.sh` 重新生成。沿原生成器的 Mobile 文案仍与共享 TypeScript
同源，没有新增一份 Web 或 Desktop 页面实现。

既有 4 CPU/8 GiB SDK、Data 缓存与 Cargo `-j16` 下实际执行：

- 原四侧生成及 `gen.sh --check` 均退出 0；中英文 Mobile 文案同步检查通过。
- TypeScript 类型检查及往返 37 项通过，Dart 往返 32 项通过，Go 原契约包
  退出 0，Rust 往返 32 项通过；联合命令 session 37397 最终退出 0。
- 原 `tools/check.sh` 的 contract 子步骤实际退出 0：四侧生成同步，270 份
  schema 相对 `contracts-v0.1.0` 无破坏性变更，匹配 3 份历史 schema。
  该旧 tag 的覆盖很窄，不将此结果扩称全部历史业务兼容或生产验收。
- 第一次独立容器 contract 子步骤的生成同步退出失败，历史兼容部分通过；
  缺少生成器诊断，不能据此断言业务生成代码有错。第二次按照原检查入口
  投递可写 HOME/XDG/Data 缓存，启动前回读 cgroup 4 CPU/8 GiB 与运行 UID，
  同一 schema 与生成字节下整个子步骤通过，session 57818 最终退出 0。

原始联合日志在
`/volumes/data/kailo/tmp/combined-import-approval-20261007.ULg0qp/`：
`combined-contracts.log`、`combined-compatibility.log` 与
`combined-compatibility-restored.log`。SDK 仅做原工具格式化；没有修改权限
或产品代码来迁就执行环境。实现后的变异与逐字还原证据沿上述两个模块记录。

本批是源码集成，不是发布或入口开放。新 SERVICE_READ 的终态、用量和过期
对账消费者尚未闭合，组件 binding 未注册，不将令牌发放当成读取/导入成功。
自动 Connector、完整工作流七动作、三人双 Agent 稳定协作、Windows/Mobile
及全页面双语视觉验收仍未完成；本批未构建镜像或部署，完整检查尚无新退出 0。
线上仍为固定 `46fcd1a68b92962c37b7ac8eb37fb3411f223d7b` 的 Core/Worker/Web。
正常浏览器会话刷新后频道再次显示已同步，实际截图并查看
`168-live-46-channel-current.png`，位于原 Playwright 目录；不把该频道截图
当成所有页面或双端已与上游等效。

该候选 tree `216e3793ef2e26c17ea40b43fdffdb98709b567c` 随后实际运行一次
原 `tools/check.sh --full`，session 83127 最终退出 **1**，原始输出保存于
`/volumes/data/kailo/tmp/tmp.yhqa10gcNh.check.log`。Core 主程序 296 项通过、
38 项隔离数据库用例 ignored；其余 Cargo、Go、Dart、Workflow replay 通过。
未投递 DATABASE_URL，实际迁移演练明确 SKIP；不将迁移文件成对称作数据库演练。
完整入口使用只读正式 Git index，报告 242 份 schema/3 历史匹配；上面的独立
contract 子步骤使用私有候选 index，报告 270 份/3 历史匹配，两者枚举范围
不同，不将完整入口的计数当成私有候选新增 schema 的覆盖证明。

本次失败中的源码静态项原因为测试模块后仍声明函数、已全字段初始化仍使用
Default，以及两个文件格式。只移动 `list_own_audit` 声明位置、删除测试中的
冗余初始化并格式化，不修改鉴权、SQL、Workflow、状态或错误分类。
修正后 SDK 内 workspace/all-targets `cargo clippy -- -D warnings` 退出 0
（session 4035），四个涉及文件的 `rustfmt --check` 退出 0。

共享 TS 原命令诊断为 549/551 通过，两项主题检查失败。
对应恢复的原样源码为 Buzz `779af8886caae1317b4de962082429867ab61503`：
`desktop/src/features/settings/ui/ProfileSettingsCard.tsx::ProfileSettingsCard`、
`desktop/src/features/settings/ui/AppearanceSettingsControls.tsx::ThreadLayoutDiagram`、
`desktop/src/features/workflows/ui/WorkflowDurationField.tsx::WorkflowDurationField`。
原检查误把属性过渡、头像内容颜色、宿主变量 SVG 与进度宽度当作第二主题，
且漏登记两端已有的 sidebar-border 映射。修正原检查的精确表达式识别，
没有删改产品样式、动画或开设通用颜色豁免；同时要求两个宿主的实际映射。
SDK 单独把头像颜色改为字面量、将 Web sidebar-border 改指另一变量，原两项
检查实际都失败（session 95690，exit 1）；还原后两文件与固定 tree 逐字 cmp 0，
原 pages 文件全部 250 项通过（session 90981，exit 0）。
原始诊断和正反结果位于同一合批日志目录，不覆盖完整检查的失败记录。

完整检查其余失败是尚未重新发布的 Web/Desktop/Cells/WeKnora 产物源码摘要
及追溯摘要不一致，Projects 缺发布摘要；保留真实阻断，不改摘要冒充新构建。
本批没有发布构建或部署，没有生产就绪声明。

已部署 `46fcd1a68b92962c37b7ac8eb37fb3411f223d7b` 实际补拍并查看
`169-live-46-tasks.png` 至 `175-live-46-agents.png`：首次任务切换截图仍是
频道，复查 170 已正常显示任务；171 审批空态、172 审计、173 设备、174
工作流、175 Agent 均为真实登录会话，不注入假数据或替代认证。
174 仍有重复标题/刷新，175 仍有技术化说明及多个刷新；172 显示部分
未识别动作，不能声称 i18n 或视觉细节完全恢复。这些照片只证明所拍页面，
不证明全部页面、所有状态或 Windows 端同等体验。

后续仅文档快路径 session 32367 在导出源码期间遇到 Data 可用空间不足，
已向本次导出的 git/tar 子进程发送 TERM，未进入编译，不把该快路径算通过。
既有完整检查的文档六项通过仍只对应 tree 216e3793；本段新增记录没有新的
文档快路径成功回执。所有源码、原始失败与截图保留；没有清理共享缓存、
数据库、镜像或其他任务目录。发布仍受上述真实失败与验收缺口约束。

## 2026-10-07 工作流 reaction、共享页面与审计文案集成

本批以 `e3a5b5b6eda9c13485c1bcf41fb9969f3fd8a4d1` 为底，合入真实
Buzz reaction 执行链、Workflows 与 Agent 原版布局恢复。相应上游固定版本、
路径、符号及实现后正反验证在 [Web 面记录](../../../web-client/fork/verify/web-surface.md)。
没有恢复未经治理的执行器，没有新建 Web 页面主体或第二工作流权威。

审计标签修复的四步结论：权威为既有动作 `conversation.hide`、
`conversation.reopen`、`pulse.publish`、`identity.profile.publish`，不新增动作；
Core 写入既有 wire key，共享 `ActionLabel` 读取同源双语词条，Web/Desktop
及生成的 Dart 文案一致，旧数据无需迁移；只修正显示，不变更授权、派发、
业务状态、额度和审计正文；空审计保持原空态，未知扩展仍用原未识别标签，
不伪造成已知动作或成功，原 wire key 保留供核验。

集成 tree `99fd668ddfee2a9ba59ae28650c1bc173beb175f` 的结果：

- 四侧生成与平台文案生成退出 0；TypeScript 往返 38 项、Dart 33 项、Go
  原契约包退出 0。联合命令首次在已通过 TS 后因错误相对目录退出 1，
  改为 SDK 绝对目录后 Dart/Go 实际退出 0，没有改业务代码迁就环境。
- 原 contract 子步骤退出 0，270 份 schema 与四侧生成同步，匹配 3 份历史
  schema 无破坏性变化；旧 tag 覆盖窄，不扩大为全部历史业务兼容。
- 共享源码和用例类型检查退出 0，原 pages 文件 255 项通过。首轮错误读取
  SDK 邻接旧契约包导致类型失败；只修正此私有快照的依赖链接，原失败保留。
- 审计标签实现后两语言 2 项通过。仅在 SDK 删去 `pulse.publish` 词条，
  两项真实失败、退出 1；逐字还原后两项通过、退出 0。
- reaction 的 Core 自动化 27 项、桥接 2 项、Rust 往返 1 项、clippy 与隔离库
  迁移验证由其冻结候选执行；不能将独立候选结果冒充这棵联合树的全量运行。

原始日志位于 `/volumes/data/kailo/tmp/workflow-reaction-integrated-20261007.8H6gmb/`，
包括 `contracts.log`、`contracts-dart-go-restored.log`、`compatibility.log`、
`shared-integrated.log`、`shared-integrated-restored.log`、`action-labels-negative.log`
与 `action-labels-restored.log`。随后 Agent 页面增量干净三方合入为
`16eebeace56b7c209255181c29112e32e7f71dc9`，未覆盖上述标签与 reaction。

本批没有构建或部署。线上仍是 `46fcd1a68b92962c37b7ac8eb37fb3411f223d7b`。
Playwright 真实会话已补拍并实际查看 `176-live-46-audit-action-label.png`、
`177-live-46-audit-loaded.png`：首次导航主体仍为频道，再点审计后显示审计；
可见旧版“发布动态”动作仍显示未识别。不能把本批源码验收记作线上视觉通过。
完整检查最近一次仍退出 1，发布摘要与真实验收缺口保持原记录；不是生产收口。

## 2026-10-07 组件读取管理、原生回执与 Web 导航合批

相对 `c9d8370ee51b47629e27eb011f60cc0e4c9d5732`，固定联合源码树为
`74084d6d385f83155efc143ede1f5f1e49df16a9`，53 文件 `+3119/-137`。
SERVICE 资源授权管理、SOURCE/RECEIVER 原生读取回执及 Web URL 导航三批
集中合并，保留上一批 reaction、原版页面与双语修正，不覆盖共享脏工作树。
四侧往返检查的并行追加冲突保留两方用例，生成物由原 `tools/gen.sh` 对
联合 schema 实际生成，不手写合成类型。

四步影响结论：

1. 权威为 DD-89 及既有 SERVICE ActionExecution、ApplicationBinding、
   Resource、ExternalExecution 和 UsageEvent。业务内容留在两个独立服务；
   Core 只保存来源、摘要、字节数、版本、回执与用量关联，没有第二数据库或账本。
2. 原连接管理面列出实际来源/接收资源元数据，写入仍用既有 grant/revoke。
   接收身份从 binding 推导，浏览器不指定 SERVICE 权威。Web/Desktop 共用页面；
   Mobile 未增加组件宿主。新增回执 schema 与迁移是加法，旧 adapter 不会提交新
   回执，不能把其行为称作新读取批次完成；回退拒绝删除已保留的原生证据。
3. 源服务与接收服务各以自身 binding 客户端提交，Core 重核角色、scope 与冻结
   binding。双方回执齐全且所需原 OpenMeter 事件已存储才记完成；接收 EE 引用
   同一用量，不重复计费。UNKNOWN、过期、缺失和重复回调沿原对账，不重放导入。
4. Web 原 TanStack 路由保存页面定位，不保存身份、权限或写意图。新鲜目录验证
   URL 中的频道/私聊对象；明确失效对象不改跳默认租户或工作区。共享宿主在导航
   时保持挂载；路由不存储或重放写意图，原 UNKNOWN 保护不改动。源码追溯和具体
   反向验证见 [Web 面记录](../../../web-client/fork/verify/web-surface.md) 与
   [原生读取记录](../../../knowledge/adapter/verify/native-read.md)。

联合树原生成及 `--check` 退出 0，TS 往返 40 项、Dart 35 项通过；原 contract
步骤退出 0，272 份 schema 与生成物同步，相对旧 tag 匹配 3 份历史 schema
无破坏性变化。不扩大旧 tag 的兼容覆盖范围。
原始日志位于 `/volumes/data/kailo/tmp/service-read-integrated-20261007.OnZQt8/`：
`generate.log`、`contracts.log`、`compatibility.log`。

同一固定联合树 Web 类型检查、导航/宿主/BFF 22 项和组件连接管理 19 项实际
通过，退出 0，日志为原 SDK `message-edit.AGX058/union-74084-web-bindings.log`。
Core 读取相关 14 项通过/3 ignored、安装权限 5 项通过/1 ignored、工作流 27 项
通过/5 ignored、Rust 合同 35 项通过、平台 all-targets clippy 零警告、Go 原契约
包退出 0。联合轮未重跑 ignored 数据库场景，不冒用先前独立 SQL 结果。
原件为 `read-receipts-20261007/union-core-fixed-input.log` 与
`union-permission-go.log`。首次投递误写协议文件路径后运行的旧输入检查、
以及首次匹配零用例的权限过滤器，均不计入这些通过数字；纠正固定树输入并
逐字核对、使用真实模块名后才取得以上结果。

本批未构建或部署，线上仍是 `46fcd1a68b92962c37b7ac8eb37fb3411f223d7b`。
没有把旧截图当作新路由上线验收。原生 WeKnora 新增 Go 消费者未在本批编译；
Data 剩余空间不足时没有强行启动该大包链接，也没有清理共享缓存或其他任务。
真实注册 binding、完整跨组件终态/计量、自动同步、三人双 Agent 稳定协作与
Win11/Mobile、全页面中英文仍未验收，最近一次完整检查退出 1 的记录不变。


### 2026-10-07 固定 Buzz 全树差异清点（非逐项功能验收）

本轮固定上游为 `779af8886caae1317b4de962082429867ab61503`，
当前 apps HEAD 为 `2012d3a2de4e976f82ceed628da8844731eae07d`。
比较对象为清点时整个 collaboration 工作树，包含并行未提交的恢复内容，
不是 HEAD 的部署证明。client-kit 不在上游 diff 的树内，另查实际共享消费者。

先完整读取 `tools/upstream_manifest.py::upstream_repo/_Index/diff`：
复用已有 `/home/ubuntu/.cache/platform/upstream/buzz.git` 对象缓存与临时 index，
固定 commit 已可解析，未 fetch、未修改或运行 .references 内容，未复制全树。
在 apps 根运行以下原入口；输出目录为
`/volumes/data/kailo/tmp/buzz-full-ui-inventory.cb0PyC/`：

- `python3 tools/upstream_manifest.py diff collaboration` → `collaboration.patch`，退出 0。
- 同命令加 `--name-status` → `name-status.log`、加 `--stat` → `stat.log`，均退出 0。
- 同命令加 `--check` → `remove-check.log`，退出 1。
- `git apply --numstat collaboration.patch` 的完整输出为 `numstat.log`；
  这里只解析原 diff，不向工作树应用补丁。

完整清单而非目录抽样：3278 个变更路径，D=2428、M=753、A=92、R=5，
33927 行增加、740638 行删除。删除中 desktop/src=1570、
desktop/src-tauri=433、mobile/lib=166；其余为构建、资源、测试等路径。
`deleted-paths.log` 逐行列出全部 2428 个删除路径；
`modified-ui-paths.tsv` 列出全部 543 个已修改原 UI 源码路径及原/现行数，
范围为 desktop/src 的 TS/TSX/JS/MJS/CSS（含同目录测试与辅助模块）
以及 mobile/lib Dart；其中 499 个缩短，44 个未缩短。
216 个文件发现共享包引用，但这不是完整迁移或等价验收结论。
五个重命名（含原/新路径与相似度）完整保留在 name-status.log，不算删除。
原补丁 SHA-256 为
`adc78ac00a06c4a80f4b09622c5b9c42b1c252ea3cff952d0f42cfb3a1323176`。

**已核共享消费者，不应误判为简单删除：**

- 原 `desktop/src/shared/ui/sidebar.tsx` 1010→7 行是共享出口；
  当前 AppSidebar 实际调用 client-kit 的 AppSidebarFrame/PrimaryMenu，
  Web PlatformApp 也消费同主体。不是“只剩七行侧栏”。
- 原 MessageTimeline 918→15、SystemMessageRow 965→16、
  ComposerAttachments 935→9：当前 Native 包装实际导入共享
  MessageTimelineSurface/SystemMessageRowSurface/ComposerAttachments；
  Web ChannelPane 同样有实际调用。完整功能仍须结合宿主验证，不仅看行数。
- 原 ProfileSettingsCard 868→27 调用共享 ProfileSettingsCard，
  仍使用本机资料 writer；共享 Settings/Appearance 与 Web 是实际消费者。
- Workflows 的 DurationField、StepCard、TemplateTextarea、ActionsMenu、
  RunTrace、CronExpressionInput 已找到共享模块及 agents.tsx/workflows.tsx
  实际调用；删除整个原 workflows 路径不能解释为这些功能均丢失，
  也不能因此宣称原全部触发条件、Webhook 编辑等都已恢复。

**最确定的剩余缺口，供下一批直接恢复；不是擅自排除需求：**

1. 设置：固定上游 `desktop/src/features/settings/ui/SettingsPanels.tsx::SettingsSection`
   有 16 类；现宿主仅 profile/appearance/notifications/shortcuts/community-members/custom-emoji。
   voice、experimental、agents、channel-templates、compute、hosted-communities、
   moderation、local-archive、mobile、updates 十类无当前设置分支。
   对应原卡片和原 IPC 是否可在治理边界直接接回须逐条实施，不自动恢复被禁执行器。
2. Inbox：原 `desktop/src/features/home/ui/InboxFilterMenu.tsx::INBOX_FILTER_OPTIONS`
   八类，现共享 inbox-surface 仅 all/mention/thread/drafts。
   project、needs_action、agent_activity、reminders 四类缺真实消费者；
   ProjectInboxDetail/ProjectInboxDetailPane、useHomePersonalInbox、
   useHiddenDmInboxNavigation 等删除路径未找到同名生产接线。
3. 侧栏：原 `AppSidebarPinnedHeader.tsx::AppSidebarPrimaryMenu` 末尾调用
   SidebarProjectsSection；现共享主菜单无此调用。
   ChannelSectionDialogs、SidebarDnd、CommunityRail 原路径删除且生产检索无消费者。
   已共享 ChannelGroupSection 只证明组呈现存在，不证明自定义分组/拖拽/社区轨完整。
4. Workflows：原 WorkflowTriggerConditions、WorkflowMessageTextConditionEditor、
   WorkflowAuthorPicker、WorkflowWebhookHeadersEditor、WorkflowWebhookSecretDialog
   路径删除，当前三侧生产检索没有对应消费者；现 supportedSteps 仍按真正执行集合拒绝
   不支持字段，不能把这些原交互算作已恢复，亦不能为显示按钮恢复第二执行权威。
5. 频道：时间线、系统行、附件与线程已定位共享主体，但 Huddle/Terminal、
   提醒等原模块仍大量删除；本轮未逐项证明其治理消费者可用。
   回应与归档冷读正在独立恢复批，不能用本清点覆盖其尚未部署的边界。
6. Mobile：166 个 lib 删除路径覆盖原 Forum、Pulse、资料编辑、反应、邀请、
   通知/push 等；本次仅全量列出，尚未逐条分类或运行验收，不能宣称三端已完整。

remove_paths 检查失败的具体登记漂移：当前整块 custom-emoji 目录及
SystemMessageAvatars.tsx、UserProfilePanelFields.tsx、UserProfilePanelSections.tsx
删除未按当前形态登记，旧六条 custom-emoji 子项不再是整块边界。
这不是据此删除需求或修改源码的授权。本任务只追加证据，
没有改功能、来源记录、构建/检查工具或声明全量门禁通过。
未逐条分类的其余路径明确保留为未核实；完整差异生成成功不等于逐项 UI/行为验收。

主线程随后按真实共享迁移与剩余缺项修正原 remove_paths 登记；同一原入口
`python3 tools/upstream_manifest.py diff collaboration --check` 复跑退出 0，
输出为同目录 `remove-check-restored.log`。只表示删除登记现已一致，不表示
ProfileFields/Sections 等原功能已恢复；未修改产物摘要，未构建或部署。

### 2026-10-07：固定全树清单续核与原侧栏未读滚动共源恢复

本节在既有全量 `collaboration-full-2646.patch`（3307 个变动路径）及固定上游树清单上续核，
不是仅检查本批 Git diff，也不把生成完整 patch 等同于 3307 项均已分类关闭。
此前清点是其记录版本的快照；后来已经恢复的 Projects 区域、工作流条件/作者/原画布等，
不能继续被旧清单算作当前仍缺失。此次定位侧栏的实际缺项后直接恢复，未新建检查脚本。

#### 权威、影响、副作用与边界（实施后的四步回执）

1. 权威：用户固定原版一致性要求；`.design/07` §4.6 / DD-87 规定共享侧栏与右侧完整组件页面。
   Buzz 固定版本为 `779af8886caae1317b4de962082429867ab61503`；
   `desktop/src/features/sidebar/lib/useUnreadOverflow.ts::deriveUnreadOverflow/useUnreadOverflow`
   提供实际 DOM 可见性、重复频道去重及最近未读滚动；
   `desktop/src/features/sidebar/ui/MoreUnreadButton.tsx::MoreUnreadButton` 提供原 pill 位置与样式。
   不是重写未读系统，也不恢复任何原工作流执行器。
2. 影响：原 Native 三个模块成为共享 reexport，Web 的
   `web-client/web/src/platform/ui/ChannelSidebar.tsx::ChannelSidebar` 从现有 BFF 消息与
   `useInboxState.readAt` 推导未读集合，交给
   `web-client/web/src/platform/ui/PlatformApp.tsx::SignedIn` 的同一共享 observer、
   `AppSidebarFrame` 原 `above/below/scrollRef` 槽；没有新存储、契约、数据库或权限入口。
   空/error workspace 数组保持稳定引用，避免投影通知反复触发宿主渲染。
3. 副作用：按钮仅对实际未读 DOM 行 `scrollIntoView`，不会发消息、修改 read position、写权限或重试 UNKNOWN。
   沿原数据先过滤当前成员；BFF 消息读取失败、已读状态尚不存在或成员撤销均输出空集合。
   Native 原有 high-priority/preview 输入保持不变，Web 不推断没有证据的 directed unread。
4. 异常：零未读不呈现按钮；上下两边分别取最近一项；重复行按频道去重且可见副本抑制 offscreen 计数；
   observer 在卸载和集合变化时断开/重绑；已读变化清除按钮；滚动不到行则无操作，不伪造成功。
   三端共源词条中文默认/英文可切换；Mobile 只获得原同源生成的词条，不新增组件宿主或声称完成 Mobile UI。

#### 全量差异中的已核实分类与尚缺项

| 固定来源或当前消费链 | 分类与实际边界 |
| --- | --- |
| `desktop/src/features/sidebar/lib/useUnreadOverflow.ts` | 原逻辑原样保留并共享迁移：新共享文件除首行来源注释外与固定版本 SHA-256 同为 `b7644e271207a2602e7f6bb55c0fe0f163172e3c9a8a253ba93fa95cfcc2eb98`；Native 原路径只 reexport。 |
| `desktop/src/features/sidebar/lib/useSidebarUnreadOverflow.ts::useSidebarUnreadOverflow`、`desktop/src/features/sidebar/ui/MoreUnreadButton.tsx::MoreUnreadButton` | 当前已治理的频道消费迁为 Web/Desktop 共源；原 pill 布局/类名保留，文案接已授权中英词条。原 DM 头像预览与 DM 优先跳转未随此批宣称恢复。 |
| `web-client/web/src/platform/ui/ChannelSidebar.tsx::ChannelSidebar` → `PlatformApp.tsx::SignedIn` | 缺失恢复：Web 原先无 sidebar overflow 消费；现在真实频道未读数据驱动原共享滚动控件。BFF 与用户状态 CAS 是已授权治理差异，未建立第二已读权威。 |
| `client-kit/ts/platform/src/react/native-application-entries.tsx::NativeApplicationEntries`、`client-kit/ts/platform/src/react/native-application-page.tsx::NativeApplicationPage` | 已授权组件入口/iframe 承载已共源；实际账号 binding 列表为空，不能把入口隐藏解释为删掉原组件 UI，也不能伪造 ACTIVE binding 或宣称完整业务已验收。 |
| `client-kit/ts/platform/src/react/conversations/conversation-list.tsx::ConversationList` | 缺失需恢复：当前 DM 行仍固定 `hasUnread/hasThreadUnread=false`，本轮未找到已接入的真实 DM 未读消费数据；不得以频道溢出恢复代替 DM 恢复。 |
| `desktop/src/features/sidebar/ui/AppSidebarPinnedHeader.tsx::AppSidebarPinnedHeader` 与原 TopbarSearch、ChannelSectionDialogs/SidebarDnd/CommunityRail | 原固定源码及 remove_paths 均已检查；搜索、分组拖拽/社区轨仍需真实共享/治理消费者，不按删除清单自动认可功能裁减。本批不造空按钮。 |

其余完整清单尚未逐项关闭，不能声称原版 100% 一致、全页面验收或一期生产就绪。

#### 已运行验证与故意破坏

沿现有 `kailo-agent-receipt-xvkujx`（4 CPU / 8 GiB）SDK、`message-edit.AGX058` 与
已授权的 `profile-settings-ortsoo.DRR20F` 候选窄验，未新建全树快照/镜像或下载依赖。
开跑前 Data 可用 3.2 GiB、主机内存可用 19 GiB；无既存 tsc/vitest/cargo 进程。

- `python3 tools/gen-platform-i18n.py` 与 `--check` 均退出 0，输出
  `PASS: Mobile platform and reason catalogs match the shared TypeScript source`；正式 Dart 仅新增三个枚举及三个映射。
- shared `tsc --noEmit -p tsconfig.test.json` 退出 0；
  `vitest run test/sidebar-unread-overflow.test.tsx`：4 passed。
- Web `tsc --noEmit` 退出 0；
  `vitest run src/platform/ui/ChannelSidebar.test.tsx src/platform/ui/PlatformApp.test.tsx`：18 passed。
- Desktop 原 `node --import ./test-loader.mjs --test`，目标
  `src/features/sidebar/lib/useUnreadOverflow.test.mjs`、`useSidebarUnreadOverflow.test.mjs` 与
  `src/features/sidebar/ui/MoreUnreadButton.test.mjs`：8 passed、0 failed。
- 私有候选只把 `scrollToNextBelow` 的方向从 `below` 改成 `above`，真实结果
  `1 failed | 3 passed`；失败为下方目标 `scrollIntoView` 调用数 0。
  还原后与正式文件 `cmp` 退出 0，重新运行 4 passed；没有修改正式产品迁就变异。
- 本批精确路径 `git diff --check` 退出 0。未运行全仓构建/全量检查、未提交/部署。

日志位于 `/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/workflow-native-template.s3JDP1/`：
`sidebar-shared-type.log`、`sidebar-shared.log`、`sidebar-web-type-final.log`、`sidebar-web-final.log`、
`sidebar-native-final.log`、`sidebar-mutation.log`、`sidebar-restored.log`。
失败如实保留：初轮 shell login 重置 PATH 导致 `FAIL: Dart formatter unavailable`，沿原非 login SDK 环境修正；
初轮新测试 fixture 缺完整 IntersectionObserverEntry 字段产生 TS2352，补真实必需字段后通过；
Native Node 旧检查不具备 window，去掉错误的浏览器 locale setter 调用，验证产品中文默认；
旧 message-edit Web installed 副本缺 `use-navigation-shortcuts` 使 PlatformApp 模块解析失败，
未改产品降级，使用已具备正式输入的 profile 候选通过。`sidebar-web-initial.log`、`sidebar-native.log` 保留这些失败。

#### 实际浏览器截图与交付边界

实际接管 `playwright-cli -s=kailo-ui-status`，为当前独立 `seam-verifier` 会话，未输出/复制凭据。
`/app/platform-build-info.json` 返回旧线上
`sha256:a484ceeba47f06e572461060c2b12353cd4646654d02fd45c04308558ebd7642`，
不是本批源码。租户及当前 workspace 的 `/api/v1/application-bindings` 均返回 HTTP 200、
`{"bindings":[],"canCreate":true}`；缺少真实已上架 binding 时不伪造组件入口或 iframe 业务验收。

本轮实际截图并经 `view_image` 打开复核：

- `.playwright-cli/current-component-entry-empty-20261007.png`：1440×1000，共享侧栏真实无组件入口。
- `.playwright-cli/sidebar-overflow-before-20261007.png`：1440×640，频道列表在滚动区域下方；旧 Web 没有本批恢复的未读导航。
- `.playwright-cli/channel-sidebar-loaded-20261007.png`：点击真实 Kailo 频道后等待已同步，消息头像/作者/线程/原 Composer 均可见；不是以首次加载骨架截图充当完成态。

截图左下资料显示名为空、状态展示 principal UUID 的实际现象已交主线核对，未越界改 Core。
本批源码/窄验完成不等于部署完成；新未读控件的实际浏览器验收、三个二开业务 iframe、
Windows 安装包与 Mobile 仍未由本轮证明。未复拍/打开的其余页面不计本轮视觉覆盖。

### 2026-10-07：原 Inbox 完整加载面 Web/Desktop 共源恢复

沿同一全树差异清单续核，确认 Native 的原 `HomeLoadingState` 完整保留，
而 Web `InboxPane` 实际目录/消息/读状态未就绪分支只渲染一行 loading 文本。
本批恢复该明确缺项，不将此五文件专项称为完整清单全量分类或原版 100% 验收。

1. 权威：用户固定原版一致性与两端页面共源要求；`.design/09` 的 Web BFF/Native
   本机身份边界不变。Buzz `779af8886caae1317b4de962082429867ab61503` 的
   `desktop/src/features/home/ui/HomeLoadingState.tsx::HomeLoadingState` 为完整来源。
2. 影响：原 116 行组件迁入 `client-kit/ts/platform/src/react/home-loading-state.tsx`，
   经已有 `inbox-surface` 出口导出；Native 同名文件改 reexport，原
   `desktop/src/features/home/ui/HomeView.tsx::HomeView` 调用不变；Web
   `web-client/web/src/platform/ui/InboxPane.tsx::InboxPane` 的真实加载分支接入。
   不改契约、API、数据存储、读状态或 Mobile，不增依赖和翻译来源。
3. 副作用：Skeleton 无输入/发送动作，不制造消息或未读事实；原五行列表、三行详情、
   响应式双栏与底部编辑区骨架原样保留。除来源注释和 Skeleton 导入路径外逐字节相同，
   归一化原源码 SHA-256 为 `7ef5e9c4ebb8f0842ddd4645f4dfaa418ea5bfb932c182c63ac516db18fa6f3d`。
4. 边界：加载结束进入原真实消息/零消息视图，失败与 read UNKNOWN 分支仍先于骨架，
   不把拒绝或结果不明变成永远加载。原 aggregation generation、卸载和撤权校验未改。

分类：原 `HomeLoadingState` 为原样保留后共享迁移；Web 一行加载文字为缺失已恢复；
BFF/Native 两条凭据读取链仍是已授权治理差异。DM 未读/头像、原搜索/分组拖拽等上一节
缺项未借此关闭，其他未分类路径仍未核实。

原受限 SDK `kailo-agent-receipt-xvkujx`（4 CPU / 8 GiB）复用
`profile-settings-ortsoo.DRR20F/apps`，开跑前主机可用内存 27095 MiB；未造快照/镜像或下载。
Web `node_modules/.bin/tsc --noEmit` 退出 0；
`node_modules/.bin/vitest run src/platform/ui/InboxPane.test.tsx` 最终 **19 passed**、退出 0。
新增五项实际消费者覆盖 pending→空/消息/读取失败/读状态失败/UNKNOWN，并断言原完整骨架。
SDK-only 将实际 Web 分支退回一行 loading，五项全部真实失败（5 failed/14 skipped，退出 1）；
还原 `cmp` 退出 0 后再次完整 19 passed，类型检查 0。
Native 原 `node --import ./test-loader.mjs --input-type=module` 实际导入同名原路径并
`renderToStaticMarkup`，确认 Native 与共享组件引用相同、三行详情/原网格/编辑区均渲染，退出 0。
初轮19项中旧 ChannelPane mock 丢失已有 `mentionPeopleFromMembers` 导出而失败；
改为保留真实 exports 后 BFF mock 又缺 `fetchUserState`，同样保留实际 exports 后通过，
未伪造 helper 或放宽产品。既有 React act 警告原样保留。

日志仍在上一节 Data 目录：`inbox-loading-type-final.log`、`inbox-loading-consumer.log`、
`inbox-loading-consumer-fixed.log`、`inbox-loading-consumer-final.log`、
`inbox-loading-mutation.log`、`inbox-loading-restored.log`。没有执行全局检查、打包、发布或 Windows/Mobile 验收。

真实 `playwright-cli -s=kailo-ui-status` 点击 Inbox 后会话过期，
`.playwright-cli/inbox-loading-baseline-20261007.png` 实际为 Keycloak 登录页，已打开核实，
不当作加载面验收。随后通过既有 VERIFY_USER 受控正常 SSO 重新登录，未打印凭据或注入 session。
实际 Inbox 空列表、过滤菜单和“提及”选择截图均打开复核：
`.playwright-cli/inbox-current-after-sso-20261007.png`、
`.playwright-cli/inbox-filter-current-20261007.png`、
`.playwright-cli/inbox-mention-empty-settled-20261007.png`。
线上 build 仍为 `sha256:a484ceeba47f06e572461060c2b12353cd4646654d02fd45c04308558ebd7642`，
不是本批源码；当前中文空态观察不能代替新加载组件部署后的逐页截图。本批源码与窄验完成，部署验收未完成。

### 2026-10-08：原私聊侧栏实际未读、读写菜单与排序共源恢复

沿既有 `collaboration-full-2646.patch` 的 3307 个差异路径继续核对原 sidebar/DM 模块，
确认原未读数、粗体、右键读/未读、Recent/A–Z 排序在共享 ConversationList 中缺失。
本批只关闭这些有真实消费者的缺项，不称全树已分类或原版 100% 还原。

1. 权威：`.design/09` §3 的参与者私聊、本人的 SERVER/CLIENT 传输与
   CollaborationUserState 唯一已读权威；UI 固定 Buzz
   `779af8886caae1317b4de962082429867ab61503`，
   `desktop/src/features/sidebar/lib/dmSidebarSort.ts::sortDmChannelsForSidebar`、
   `desktop/src/features/sidebar/ui/SidebarSection.tsx::SidebarSection/UnreadCountBadge`、
   `desktop/src/features/sidebar/ui/ChannelContextMenu.tsx::ChannelContextMenuItems`、
   `desktop/src/features/sidebar/ui/CustomChannelSection.tsx::SectionActionsMenu` 与
   `desktop/src/features/sidebar/ui/AppSidebar.tsx::AppSidebar` 为来源。
2. 影响：共享 `conversations/conversation-list.tsx` 消费真实 incoming DM 事件和
   `useInboxState`，未读按原 Channel 键而非 thread/reply 键聚合；菜单写既有 Core CAS。
   Web `web-client/web/src/platform/ui/ConversationSidebar.tsx::loadConversationSidebarActivity`
   使用既有 BFF `conversationMessages`、`inboxWindowEvents`、本人公钥目录与读后准入复核；
   `PlatformApp` 传已有 Core read projection。Native
   `collaboration/desktop/src/features/sidebar/ui/AppSidebar.tsx::DesktopConversations`
   复用既有 `collaboration/desktop/src/features/home/hooks.ts::useHomeFeedQuery` →
   `collaboration/desktop/src/features/home/nativeDmFeed.ts::loadNativeDmFeed` 已验签原 Relay 窗口，仍本机持钥。
   不改契约、Core、Relay、数据结构、生成物、i18n 或依赖。
3. 副作用：消息只在已授权客户端消费，Core 不存正文；按 event id 去重、排除本人全部
   公钥发言，不把私聊 id 当 Workspace。未读数只表示当前可信窗口内已观察到的 incoming
   消息，不冒充未加载历史总数。菜单复用原组件，顺序为 New message、分隔线、Sort；
   原 DM section 未提供 mark-all-read，未自行增加。排序仅用已有客户端 presentation
   preference `buzz-channel-sort.v1`，不是另建读状态权威。
4. 边界：空/停用/非当前参与者不读取私聊窗口；未知身份、非 hex 公钥、错误 Channel、
   循环 cursor、读期间撤权/换身份、卸载 abort 均拒绝结果。读回执 UNKNOWN 清除 badge，
   只允许原只读 refresh，不用新版本静默重写。选择一行只隐藏原 active badge，不凭点击
   假造已读；真正读/未读用已有 CAS 队列。原 Recent 的无活动/非法日期排到有活动之后，
   同时刻按真实标签/id 排序，不修改输入。

分类：52 行原 `dmSidebarSort.ts` 为共享迁移，仅来源注释、类型导入和保留行扩展字段的
TypeScript 泛型有差异，运行正文归一化 SHA-256
`78a9b9ba73414bdf525ac839a0b4ad1650f8c993a979af926abf17ca83417832` 相同。
原 badge/粗体、右键菜单及排序菜单为缺失已恢复；Core CAS 和 BFF/本机读取为明确授权治理差异。
DM 头像/在线状态仍缺可信数据消费，Native 私聊进入后的旧本地自动已读消费者尚未收敛，
不能因此宣称全部读状态跨端等效。其他未分类路径、分组拖拽、全部页面状态仍未由本批证明。

真实 `playwright-cli -s=kailo-ui-status` 在旧部署打开新消息并筛选真实收件人，
随后检查无匹配搜索；两张截图均经 `view_image` 打开：
`.playwright-cli/dm-recipient-search-current-20261008.png`、
`.playwright-cli/dm-recipient-empty-current-20261008.png`。
前者只有实际目录的 collab-third-20261005，后者原“没有匹配的用户”空态；未发送消息、
未伪造私聊。当前 seam-verifier 没有可见私聊，因此没有真实 DM 未读徽章的线上截图。
线上仍为旧 `sha256:a484ceeba47f06e572461060c2b12353cd4646654d02fd45c04308558ebd7642`，
上述两图只证明旧部署实际页面行为，不是本批候选部署/Windows/Mobile 验收。

复用受限 SDK `kailo-agent-receipt-xvkujx` 的 `profile-settings-ortsoo.DRR20F/apps`
（4 CPU / 8 GiB，启动前主机可用内存 23861 MiB），只同步本批前端文件与宿主已有
platform 依赖副本，不动 Core/契约；没有新快照、下载、镜像构建或全局检查。
实际命令与结果：共享目录 `node_modules/.bin/tsc --noEmit -p tsconfig.test.json` 0；
`vitest run test/conversation-sidebar.test.tsx test/new-message.test.tsx` **24 passed**；
Web `node_modules/.bin/tsc --noEmit` 0；
`vitest run src/platform/ui/ConversationSidebar.test.tsx src/platform/ui/PlatformApp.test.tsx`
**21 passed**；Desktop `node_modules/.bin/tsc --noEmit` 0。
新增 shared 六项实际消费者和 Web 十项读取边界覆盖真实 CAS 请求、UNKNOWN、原菜单操作、
原 Recent 顺序、本人多身份排除与准入变更；不是只验证 SSR 文案。
初轮失败保留：`TS6133: 'vi' is declared but its value is never read`、两处错误英文菜单定位
`TypeError: Cannot read properties of undefined (reading 'click')`；移除测试未用导入并匹配
真实既有 “Mark unread” / “Try again” 后通过。首轮 Desktop 因 SDK 安装副本旧 i18n
报 `TS2345: Argument of type '"sidebar.unreadCount"' is not assignable`；正式已有该词条，
仅同步真实依赖输入后通过，未为通过检查修改产品译文。

私有候选故意翻转读写方向，实际 CAS 断言报预期 20 秒却写入 9 秒，**1 failed / 5 passed**；
另移除 Web 本人排除后 incoming 列表多出自己发言，**1 failed / 9 passed**。两个变异均退出 1，
正式文件从未被破坏；还原后与正式逐字 `cmp` 退出 0，最终再次 **shared 24 passed / Web 21 passed**、
两个命令均退出 0（`*-restored.log`）。原始失败及全部命令输出在
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/workflow-native-template.s3JDP1/`
的 `dm-sidebar-*.log`；其中 `*-complete.log` 为集中正式输入验证，`*-mutation.log` 为负例。
本批无打包、发布及新安装包；全局 `check.sh --full` 本轮未运行，交主线按批次收口。

## 2026-10-08 Native DM 打开、线程和快捷键统一 Core CAS

本批实现后四步结论：

1. 权威为 `.design/09` §3、DD-40：三端 CollaborationUserState 是唯一用户状态权威，
   DM 使用原 Channel/Message/Thread 键，不冒充 Workspace。原版行为基准固定为
   `.references/buzz` commit `779af8886caae1317b4de962082429867ab61503`：
   `desktop/src/features/channels/ui/useChannelOpenReadState.ts::useChannelOpenReadState`、
   `desktop/src/features/channels/ui/useChannelUnreadState.ts::handleMarkMessageUnread`、
   `desktop/src/features/channels/useUnreadChannels.ts::useUnreadChannels`、
   `desktop/src/features/channels/unreadChannelCounts.ts::observedUnreadEventReadAt`。
   恢复的是已有打开/线程/子树/快捷键调用链，不增加页面、控件或执行权威。
2. 影响面：AppShell 创建单一 `useInboxState`，HomeView、AppSidebar、ChannelScreen 消费
   同一 Core 快照及串行 CAS；原 `useChannelActivityProjection` 转发实际 ACK。
   `useChannelOpenReadState` 等待 Core 水合，DM 不再清除旧 Inbox 本地覆盖项；
   `useChannelUnreadState` 只在真实确认后改变当前视图的手动未读展示。
   原侧栏折叠 channel/msg/thread 最大读点，经共享 `eventReadAt` 同时给两端
   ConversationList 和 Native 计数使用。原
   `desktop/src/features/home/lib/inbox.ts::buildInboxItems` 的 DM Inbox 分组按 channel
   判断（固定版本 554–574 行），与原侧栏规则不同，本批不擅改该原行为。
3. 副作用：不写第二份 DM 本地 read marker/forced-unread 权威；显式 DM 标未读用原
   CAS 降低已存在语义的 channel/msg/thread 键，避免只降低 channel 后旧线程标记压住徽标。
   旧普通频道仍消费原 manager，此剩余迁移不冒称关闭。本批无新 schema、端点、迁移、
   权限或工作流；正文留在 Relay。切换会话后的旧 thread 回调、切换 principal/Relay
   后的旧写回调与已撤销 DM 准入拒绝写入，不能回落到本地读状态。
4. 异常：空窗口不伪造最新消息；同一队列逐笔使用确认的新 version，只有精确 ACK
   才返回 true；丢 ACK、部分批次未确认或失去读代次返回 false，保留 UNKNOWN，
   不自动重发。未就绪/失败的徽标不造数字，保留已有侧栏失败或 UNKNOWN 重查提示，
   不能把未显示数字当已读。本机有限 Relay 窗口不宣称覆盖完整历史。

本人过滤沿真实 `collaboration/desktop/src/features/home/nativeDmFeed.ts::loadNativeDmFeed`：
从当前 principal 的所有 participant-directory 页收集本人全部 pubkey，验证当前 device，
对每条已验签 DM event 排除 own.has(pubkey) 后才交给 `useHomeFeedQuery` 的 activity；
最终再次核验成员和身份。时间仍为 Relay Unix seconds，Core ISO 由 seconds × 1000 写入。

实现后原入口验证（既有 `kailo-agent-receipt-xvkujx` 4 CPU/8 GiB，
`profile-settings-ortsoo.DRR20F/apps`，启动时主机 available 29206 MiB）：

- shared `tsc --noEmit -p tsconfig.test.json` 0；`vitest run test/inbox.test.tsx
  test/conversation-sidebar.test.tsx` **24 passed**。
- Desktop `node --import ./test-loader.mjs --test
  src/features/channels/nativeDmReadState.test.mjs src/features/channels/useUnreadChannels.test.mjs
  src/features/home/nativeDmFeed.test.mjs` **13 passed**；Desktop `tsc --noEmit` 0。
- Web `tsc --noEmit` 0；`vitest run src/platform/ui/ChannelSidebar.test.tsx` **7 passed**。

失败原文保留：首轮测试引用了不存在的包根出口，报 `ERR_PACKAGE_PATH_NOT_EXPORTED`，
改用已有 `/client` 导出；菜单负例初始只读过一条消息，因此实际菜单只有 Mark as read，
报 `Cannot read properties of undefined (reading 'click')`，改为真实全已读初态后检查 Mark unread。
新增 hook 方法后 Web 旧测试 fixture 报 `TS2741: Property 'eventReadAt' is missing`，
仅补该既有 fixture 的方法。Node 环境的 Tauri `transformCallback` 订阅警告也完整保留，
这不是原生 Relay/Windows 实机验收。

私有候选真实破坏：把丢失 ACK 返回值改为 true，shared **1 failed / 23 passed**、
Native **1 failed / 5 passed**，都退出 1；把 sidebar 恢复成忽略 msg/thread 的单 channel
读点，**2 failed / 6 passed**，退出 1。首次 shared 检查曾因重查后的 false 覆盖首次错误
而放过变异；已把断言移到首次 ACK 丢失后，并实际证明能抓错。首次 Native 失败后
缺少清理导致定时器保留，结束该精确测试子进程，补 afterEach 释放，负例重跑正常退出 1。
全部还原与正式文件逐字 cmp 0；原始输出位于同一既有证据目录
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/workflow-native-template.s3JDP1/`
的 `native-dm-*.log`，`reviewed-complete`/`web-restored` 是正向，
`*-mutation-ack`/`sidebar-mutation` 是负例；不删除第一轮失败记录。
还原后 `native-dm-restored-final.log` 再次 **shared 24 passed / Native 13 passed**，
命令退出 0，才冻结本批结果。

浏览器以 playwright-cli 在当前线上真实点击收件箱并截图、打开图片复核：
`/volumes/kailo/.playwright-cli/inbox-current-read-boundary-20261008.png`，显示现有 Inbox
分栏空态、中文菜单和侧栏；当前账号没有可见 DM，未造消息/私聊来替代验收。
线上仍是前述旧部署，本批无发布/Windows 安装包/实机检查；该截图不证明新 Native 已读链。
全树 3307 变动路径尚未全部分类；本批按原模块复用及授权 Core 改造补 DM 接缝，
普通频道读权威迁移、三端实际协作、全页面原版一致性仍是明确剩余项。

## 2026-10-08 原版频道／论坛创建表单与固定提交区

本批从已有全树差异清单继续追踪频道创建整个模块，而非只核本批文件；全树 3307
变动路径仍未全部分类。固定来源为 Buzz
`779af8886caae1317b4de962082429867ab61503`，本次重新以 `git show` 核验：

| 固定上游路径与符号 | 本批分类及真实消费者 |
| --- | --- |
| `desktop/src/features/sidebar/ui/CreateChannelDialog.tsx::CreateChannelDialog` | 共享迁移：两端同用 `client-kit/ts/platform/src/react/create-channel-dialog.tsx::CreateChannelDialog`；恢复频道／论坛标题及原固定底部区域 |
| `desktop/src/features/sidebar/ui/CreateChannelFormFields.tsx::CreateChannelFormFields`、`CreateChannelFormFooter` | 缺失恢复：`roles.tsx::WorkspaceCreateForm` 与 `WorkspaceCreateFormFooter` 恢复原 Name、占位符、标签／输入结构、原 Button 和 HTML form 关联；不再用简化按钮或把提交区放在滚动正文中 |
| `desktop/src/features/sidebar/lib/useCreateChannelForm.ts::useCreateChannelForm` | 共享迁移＋授权治理：`roles.tsx::useWorkspaceCreate` 恢复 fresh opening 重置、公开默认及预填光标；保留原不抢占表单内焦点的规则，宿主动画后聚焦使用已有 requestAnimationFrame；UNKNOWN 不重置命令 |
| `desktop/src/shared/ui/chooser-dialog-content.tsx::ChooserDialogContent` | 共享迁移：复用原 header／scroll／footer 类；原 `description: _description` 未渲染说明，删除此前自行显示的介绍文字及无消费者词条 |

### 2026-10-08：原 Inbox 虚拟列表实际消费者恢复与 Native 共源

从既有 3307 路径全树清单续核，固定 Buzz
`779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/features/home/ui/InboxListPane.tsx::InboxListPane` 使用原
`desktop/src/shared/ui/VirtualizedList.tsx::VirtualizedList`，行高估算 96、
稳定行键、外部滚动容器及动态测量。Web 现行消费者却直接全量 `map`，
Native 仍保留另一份原列表；本批恢复实际共源调用，不添加新的页面/菜单/业务功能。

- 原样保留：原行包装、样式、上下文菜单、头像、行动作、空态和原滚动容器。
  列表仍由 TanStack 原虚拟器按动态行高测量，不自写另一套虚拟化。
- 共享迁移：包导出既有 `src/react/forum/VirtualizedList.tsx`，
  Native 原路径只再导出同一主体，删除重复实现；实际消费者是 Native
  `InboxListPane`、`EmojiAutocomplete` 及 Web `InboxPane`，非 helper-only。
- 已授权治理改造：Web 既有 BFF 准入、signed window、Principal/scope 聚合及
  原读写动作均未改；列表稳定键消费现有 `scopeKey`，不据可见 DOM 判断准入或已读。
- 缺失需恢复→已接真实消费者：Web Inbox 长列表只挂载窗口内行，实际滚动能
  到达首屏外消息；原 Forum 的既有共享调用不变。

四步结论（REQ-24、DD-74/75、V-REQ-24、SS-WEB-PRESENTATION）：

1. 原 Inbox 布局/虚拟列表上游支持，共源呈现设计已定；不改领域语义、正文权威或执行底座。
2. 检索确认以上 Native 两调用方及 Web 实际调用方。仅包出口、Native 原路径、
   Web Inbox 与现有检查四路径变化，`+62/-189`；无契约、四侧生成、迁移或新持久状态。
   固定原列表与既有共享主体的完整 diff 仍仅有来源/导入迁移、严格索引断言及
   已验证的外部祖先 ref 订阅修正，本批不再修改原列表内部逻辑。
3. 行卸载不写已读、不改变消息聚合或授权查询，重新挂载复用既有 scope query/cache；
   原 profile 迟到/错误作者/Principal 切换检查继续通过，无第二资料或副作用权威。
4. 零条目仍是原空态；列表切换和缓存复挂由原虚拟器处理，背压/分页仍沿原读取链。
   不增加重试或中间状态，六类治理错误与 UNKNOWN 表达不变。
   Web 经 BFF、Native 本机凭据与 Relay 边界不变，Mobile 无适用 TS 消费者。

沿原 `kailo-agent-receipt-xvkujx` SDK 与已安装缓存集中窄验；inspect 实际
4 CPU、8 GiB，终验前无编译/测试进程，可用内存 19720 MiB。
未安装依赖、复制全树、构建镜像/安装包或发布。日志根沿用上一节：

- `inbox-virtual-list-first.log`：Web 类型检查通过，Inbox 首轮 18 通过／2 失败，
  原检查浏览器模拟缺真实滚动几何及 ResizeObserver `target`；只修正 jsdom 布局模拟，
  未叠生产条件迎合检查。`inbox-virtual-list-layout.log` 后实际 20 passed、退出 0。
- `inbox-virtual-list-mutation.log`：仅在 SDK 把实际 Web 调用方 overscan 退化成
  全部行，真实长列表检查报 `expected 40 to be less than 40`，1 failed／19 skipped、
  退出 1。还原后正式源码与四候选输入 `cmp` 均退出 0。
- `inbox-virtual-list-restored.log`（session 52599）：Web `tsc --noEmit`、
  Inbox/作者资料 29 项、Desktop `tsc --noEmit`、原共享虚拟列表 3 项，
  整条命令实际退出 0；React `act(...)` warning 保留在原 stderr。
- 四路径 `git diff --check` 实际退出 0；全仓 `check.sh --full` 留给主线批次收口，
  不把上述窄验写成全仓验收。

本批尚未部署或生成安装包，新增业务页面截图为零。实际 playwright-cli 当前进入
OIDC 登录页、会话失效；受控本地账号口令没有打印、写入命令行或注入 session。
因此不能用旧截图证明本批 Inbox/Native 虚拟列表呈现；新版本视觉验收尚未完成。
3307 全树路径仍未全部分类，精确未分类数未统计；project/needs_action/reminders、
完整 bot profile 及遗留 i18n 缺项仍未关闭，不能称 100% 还原或生产就绪。
| `desktop/src/features/channels/ui/ChannelBrowserDialog.tsx::ChannelCreateView` | 缺失恢复：共享 `react/channel-browser/ChannelBrowserDialog.tsx::ChannelCreateView` 使用相同表单，恢复原 `shrink-0 pb-6 pt-4` 提交区及搜索预填；UNKNOWN 阻止返回浏览或关闭 |
| `desktop/src/shared/ui/button.tsx::Button` | 原样共享控件：提交按钮消费已有 `react/profile/buzz/shared/ui/button.tsx::Button`，不再消费治理页最小按钮样式 |

### 四步影响与边界

1. 权威为原版一致性要求及 `.design/09` §3、DD-80。`workspaceVisibility=open`
   是产品发现可见性，不能改成 Relay public；本批未改 Core CONTROL 签发、Relay private、
   membership 或 scope 准入。原模板选择／创建有上游实现，但当前
   `contracts/domain/workspace_channel_create.schema.json` 无 template 字段或执行消费者，
   此缺口仍存在，不生成假菜单、不宣称模板已还原。
2. 检索全部 `useWorkspaceCreate`、`WorkspaceCreateForm` 调用：管理页、独立创建弹窗、
   浏览器创建页。仅两个频道入口传入 active／initialName；管理页仍默认 private，
   既有 slug、ActionCommand、BFF `/api/v1/actions` 均保留。Web/Desktop 共源，
   Mobile 未新增页面；六个实际词条沿原生成器投影 Dart，删除两个无消费者旧词条。
   不改四侧业务契约、存量数据、冻结命令格式或数据库。
3. UNKNOWN 保留原 command/idempotencyKey 和禁改输入；浏览器 back 原先允许离开
   未知结果，现在与 close 同样锁定，仍可同键确认。不复制频道或权限权威，不把
   `202/DISPATCHED` 解释成物化完成，不新增自动打开尚无真实频道的行为。
4. 空名称／无 capability 禁止提交；复开取消草稿恢复原默认，未知意图不随复开清空。
   论坛描述、TTL 九档及重试原意图由实际消费者检查；明确拒绝保留既有错误分类，
   受理引用仍由原任务页收敛，超时或无法判断保持 UNKNOWN。异步物化后自动进入新
   频道尚未闭合，不把当前受理提示当作原版完整创建完成体验。

### 实施后验证与截图边界

复用 `kailo-agent-receipt-xvkujx`（4 CPU／8 GiB）及既有
`/evidence/profile-settings-ortsoo.DRR20F/apps`，没有安装、镜像构建或整树导出。
日志目录为 `/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/workflow-native-template.s3JDP1/`。

- `python3 tools/gen-platform-i18n.py` 与 `--check` 实际输出
  `PASS: Mobile platform and reason catalogs match the shared TypeScript source`；
  入口 PATH 补上 SDK 已有 `/usr/lib/dart/bin`，此前缺 PATH 的一次失败为
  `FAIL: Dart formatter unavailable`，未安装新工具。最终输出见 `channel-create-i18n.log`。
- 实现后 `vitest run test/pages.test.tsx -t "shared original channel creation entry"`
  通过 9 项，另 259 项因定向选择跳过；`vitest run test/channel-navigation-shortcuts.test.tsx`
  通过 14 项。前次 JSX 多余括号报错保留 `channel-create-consumer.log`；
  两个 footer 断言误把外层 modal 容器也算正文、TTL 测试未等待焦点帧的失败保留
  `channel-create-consumer-final.log`，修正实际正文边界后检查通过。
- 私有候选故意删除 footer 的 form 关联并改坏默认可见性：`channel-create-mutation.log`
  实际 7 failed／2 passed；单独保留错误 private 默认：
  `channel-create-default-mutation.log` 实际 2 failed／7 passed，均退出 1。
  恢复正式源码并 `cmp` 为 0 后，最终用例及类型命令输出留存
  `channel-create-final-restored.log`；未对生产文件实施变异。
- 最终同一冻结输入依次执行 shared `tsc --noEmit -p tsconfig.test.json`、
  Desktop `tsc --noEmit`、Web `tsc --noEmit`；连同上述 9＋14 项恢复用例的
  整条命令退出 0（session 36421），没有拿变异输入的结果当正式通过。
- playwright-cli 真实点击线上频道浏览器→创建→临时 TTL，分别截图并打开复核：
  `/volumes/kailo/.playwright-cli/channel-browser-current-20261008.png`、
  `/volumes/kailo/.playwright-cli/channel-create-old-deployed-20261008.png`、
  `/volumes/kailo/.playwright-cli/channel-create-ttl-old-deployed-20261008.png`。
  可见旧版名称写成“工作区名称”、默认私有、临时表单提交位于滚动体底部；
  仅操作未提交草稿，不新增业务频道。截图属于本批发布前旧部署，不证明新源码已上线。

本批未执行全仓 `check.sh --full`、新部署、Windows 包或实机验收；主线集中收口。
本页创建模块仍有模板及物化后导航缺项，不能宣称全模块或三端 100% 一致。

### 2026-10-08：固定全树续核与原 Inbox 行样式/Agent 头像消费恢复

本批从已有 `collaboration-full-2646.patch` 的 3307 个变动路径续核 Inbox 原模块；
这个全树数量不是逐项分类完成数。本批仅关闭下面有真实消费者的局部缺项，
不宣称全树已分类、Inbox 全功能关闭或原版 100% 一致。

固定证据均实际用 `git show`/`git grep` 核验，未运行或改写 `.references`：

| 固定官方源码/符号（Buzz `779af8886caae1317b4de962082429867ab61503`） | 本批分类与落点 |
| --- | --- |
| `desktop/src/features/home/ui/InboxListPane.tsx::InboxLabel` | 缺失需恢复→共享迁移：`client-kit/ts/platform/src/react/inbox-row.tsx::InboxRow` 恢复原 `message-markdown`、`text-2xs`/最小 chip 高度、hover/focus 右侧动作避让、`mention-chip` 及内层 truncate；不重新设计 chip |
| `desktop/src/shared/styles/globals/markdown.css` 的 `.message-markdown .mention-chip.inbox-channel-chip` | 原样保留：已有 `client-kit/ts/platform/src/react/messages/markdown.css` 同一选择器与背景/文字规则。本批补回真实 DOM 所需的类，使已有样式成为真实消费者 |
| `desktop/src/features/home/ui/InboxListPane.tsx::InboxListPane/renderItem` | 缺失需恢复→共享迁移：补回原 pressed 行高亮、sender 包装层及两端 36px 头像；补回原 Agent squircle、人类 circle 与对应 profile trigger 圆角 |
| `desktop/src/features/home/ui/InboxListPane.tsx::InboxListPane/renderItem` 的 `agentPubkeys` | 已授权治理改造：Native `HomeView` 将已有 owned Agent 查询公钥传给 `InboxListPane`；Web `InboxPane` 消费已有 `snapshot.agentPubkeys`，不按显示名称或任意 event 流猜身份，不另造 Agent 目录 |
| `desktop/src/features/home/ui/InboxListPane.tsx::InboxListPane/renderItem` 的 read/unread/open/unread count 文案 | 已授权中英适配：Native 消费已有同源 `inbox.markRead`/`markUnread`/`open`/`openItem`/`unreadCount`，没有新词条或独立 Dart 翻译权威 |

四步结论（REQ-24、DD-74/75、V-REQ-24、SS-WEB-PRESENTATION）：

1. 权威是固定原版呈现与现有 AgentInstallation/身份目录；上述 UI 能力上游支持、设计已定，使用已有调用，不新增准入入口。
2. 影响面是共享 `InboxRow`、Native `HomeView`/`InboxListPane`、Web `InboxPane`、已导入的原 Markdown CSS 与已有 i18n。两端读共享布局，身份来自已有查询；不改 schema/API/Workflow/旧数据格式，不需迁移。
3. 纯呈现与可信身份消费，不改变读写准入、Core CAS、scope guard、签名或外部执行链。点击作者仍使用原 profile 行为，不写已读；没有正文复制、第二目录或第二状态权威。
4. 空列表、未知/缺失身份目录、撤权、late read、重复事件、版本冲突与结果不明继续走现有 Inbox 聚合与 Core state 路径。本批不新增状态；没有身份事实不显示 Agent 形状，不靠名字补身份。DENIED/BLOCKED/PRECONDITION/LIMIT/CONFLICT/UNKNOWN 六类错误语义均不改变；UNKNOWN 仍不显示成功/失败。Web 管理/状态走 BFF，Desktop 本机协作直连边界保留；Mobile 无适用 TS 呈现对象，不新增入口或翻译。

实现后窄验复用已安装依赖的 `profile-settings-ortsoo.DRR20F` 候选，不下载依赖、
不创建新全树/镜像。实际 runner `kailo-agent-receipt-xvkujx` 的 inspect 为
`NanoCpus=4000000000`、`Memory=8589934592`、running；执行前检查进程与可用内存
29584 MiB。命令在镜像内执行，未启动 Vite release build 或 Windows 打包。

- shared `node node_modules/typescript/bin/tsc --noEmit` 与 `vitest run test/inbox.test.tsx test/inbox-surface.test.tsx` 退出 0，`25 passed`（session 69155）。
- shared 候选故意删除原 `mention-chip` 类，同一实际 `InboxRow` 检查在 `test/inbox.test.tsx:361` 报 `expected false to be true`，退出 1（96319）；还原后 test tsc 与全部 25 项再次退出 0（71640）。
- Web `tsc --noEmit` 与 `vitest run src/platform/ui/InboxPane.test.tsx` 退出 0，`19 passed`（27766）；Desktop `tsc --noEmit` 退出 0（32597）。
- Web 候选故意把可信 Agent 判定改为 `false`，原 owned Agent 实际消费用例在 `InboxPane.test.tsx:226` 报 `expected 'circle' to be 'squircle'`，退出 1（9054）；还原后全部 19 项与 Desktop 最终 tsc 整条命令退出 0（41680）。
- 两个变异仅发生在验证候选，shared/Web/Native 恢复输入均与当前实现 `cmp` 退出 0。Web 测试仍有既有 `MessageAuthorProfile` 更新未包 `act(...)` 的 stderr warning；没有把 warning 隐瞒成无诊断。

playwright-cli 实际从 `kailo-ui-status` 与 `kailo-release-management` 点击 Inbox，
旧登录会话失效后均跳回 OIDC。已截取并用图像查看工具打开
`/volumes/kailo/.playwright-cli/inbox-session-expired-20261008.png`，内容是登录诊断，
不是 Inbox/新代码/Windows 截图验收。**本批新代码未部署，Inbox 本批视觉验收未完成。**

剩余缺项明确保留：原项目/needs_action/reminders filter 与其实际业务消费者、
提醒混合行及提醒动作、原 Agent bot profile 语义、Web Inbox 行真实头像加载；
Native 类型标签及 No channel link 等遗留文案也仍须按全量 i18n 恢复。
本批不生成无消费者 filter 或假 reminder 入口，不把这些原功能从交付目标删去。
全仓 `check.sh --full`、部署、Windows 包及三端实机验收本批未执行，由主线集中收口。

### 2026-10-08：原资料 hover 弹层的实际两端共享消费

沿同一固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/features/profile/ui/UserProfilePopover.tsx::UserProfilePopover` 复用原
trigger、hover 时序与 profile body；Native 删除重复呈现体，直接消费现有共享主体。
这属于共享迁移，不是删除原弹层；已有可信 `role` 消费原 Agent squircle，
姓名不提供 Agent 身份。查询仍由 Native 原 `useUserProfileQuery` 完成，
按当前 community/device scope 分键并核对返回 pubkey；面板导航和媒体映射留在宿主。
这遵循 REQ-24、DD-74/75、SS-WEB-PRESENTATION；不改治理准入、契约、数据库、
正文权威或 Workflow，也不增加持久状态。迟到旧 scope、错误作者及读取失败不展示旧资料；
Mobile 无适用 TS 对象，六类治理错误和 UNKNOWN 表达不变。

实现后原受限 SDK 内 Native 原检查 5 项、Web 原检查 24 项、共享与 Desktop 类型
检查通过；角色判定在私有候选故意破坏后实际退出 1，恢复并 cmp 退出 0。
初次 JSDOM 缺 Node 全局的检查失败保留，未修改业务代码迎合环境。
通过和破坏日志分别为既有
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/workflow-native-template.s3JDP1/`
下 `profile-popover-native-fixed.log`、`profile-popover-role-mutation.log`。
完整 bot owner/presence/运行/活动资料仍缺真实消费，不把角色形状当完整 bot profile。
本批未部署；新增页面截图验收为零，现有登录页截图不证明弹层呈现。
全量检查、Windows/Mobile 包与实机验收不在上述窄验证结果中。

### 2026-10-08：原 Inbox 作者真实头像与既有授权资料消费者闭合

固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/features/home/lib/inbox.ts::buildInboxItems` 从实际作者资料取头像，
`desktop/src/features/home/ui/InboxListPane.tsx::InboxListPane` 将 `item.avatarUrl`
传给 `desktop/src/shared/ui/UserAvatar.tsx::UserAvatar`。本批实际核对上述固定源码，
关闭 Web `InboxPane` 把所有作者头像写成空值的缺项，不重新设计头像或资料页面。

- 原样保留：共享原 `UserAvatar` 的 36px、circle/squircle、fallback、
  `no-referrer`、动态头像 poster 与 hover 播放；Inbox 的原包装层与位置不变。
- 共享迁移：Web 直接调用已有 `@client-kit/platform/react/messages::UserAvatar`，
  不另造 Web Avatar。现有同源中英 alt 词条实际切换验证，无新增翻译权威。
- 已授权治理改造：`MessageAuthorProfile.tsx::MessageAuthorAvatar` 与原 hover/panel
  共用 `useMessageAuthor`，通过既有 Workspace/Conversation 已准入事件查询资料和媒体路径。
- 缺失需恢复→已接真实消费者：`InboxPane.tsx::InboxPane` 的实际行传入当前
  `MessageAuthor`，不止增加孤立 helper；列表读头像不隐式打开资料面板或写已读状态。

四步结论（REQ-24、DD-53、DD-74/75、V-REQ-24、SS-WEB-PRESENTATION）：

1. 原头像及资料能力上游支持、设计已定；身份与资源准入仍属于平台与 Relay。
   现有 `core/crates/platform-core/src/web_transport.rs::message_author_profile_for`
   按可信上下文准入消息、读真实作者、再次准入并生成 scope 媒体映射，本批没有改变该后端。
2. 影响面仅是 Web Inbox 实际消费者及既有作者资料适配/检查四文件；共享 Avatar
   与 Native 实现未改。query key 已含 Principal、scope、作者 pubkey 和事件，头像/hover/panel
   复用同一 query/cache；既有 `web_profile_view` 契约、API、数据库、Workflow 均未改变，
   无旧数据迁移或新持久状态。
3. 返回作者必须匹配已准入事件 pubkey；pending/refetch/error、Principal/scope 切换时
   不消费旧成功资料，迟到旧 scope 响应不回填当前头像或 biography。媒体继续使用既有授权
   映射；不复制正文、账户密码、密钥或另造目录。头像仍是资料呈现，不提供执行权限。
4. 空头像保留原 fallback；读取拒绝/错误不得显示先前头像，空列表无新增调用。
   原查询去重和原列表限制沿用，不新增写操作、外部副作用或重试状态机。
   DENIED/BLOCKED/PRECONDITION/LIMIT/CONFLICT/UNKNOWN 六类语义不变，
   结果不明仍不显示成功或失败。Web 经 BFF、Native 本机凭据边界不变；
   Mobile 无适用 TS 消费者，不生成新入口。

实现后复用 `kailo-agent-receipt-xvkujx` 与已安装依赖的原候选；实际 inspect 为
4 CPU、8 GiB cgroup，最终检查前无编译/测试进程，可用内存 27353 MiB。
没有下载依赖、新建镜像、整树复制、release build 或单独部署。
日志根为
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/workflow-native-template.s3JDP1/`：

- 接线前资料适配检查实际 `9 passed`，日志 `inbox-author-avatar-first.log`；
  分别破坏返回作者校验、头像绑定、Principal query key，均真实退出 1，日志为
  `inbox-author-identity-mutation.log`、`inbox-author-avatar-mutation.log`、
  `inbox-author-principal-mutation.log`。恢复后 9 项退出 0，
  `inbox-author-avatar-restored.log`；不是以 helper-only 宣称 Inbox 功能已交付。

### 2026-10-08：原 Pulse 动态头像媒体接线与真实登录边界

沿既有全树 3307 路径差异快照续核，固定 Buzz
`779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/shared/ui/UserAvatar.tsx::UserAvatar` 在解析 `#buzz-anim=` 后分别
对海报/悬停动画调用 `rewriteRelayUrl`。原实际消费者为
`desktop/src/features/pulse/ui/NoteCard.tsx::{NoteCard,ReplyParentContext}`、
`desktop/src/features/pulse/ui/AgentActivityCard.tsx::AgentActivityCard`、
`desktop/src/features/pulse/ui/PulseView.tsx::PulseView`，并非另设计动态页面。

现存共享 `useUsersBatchQuery` 对完整 picture 做一次 host 映射，但完整动画描述串
不等于海报/动画资源键；三个原模块的五处 UserAvatar 漏传现成 `resolveMediaUrl`，
因此解析出的子资源会退回 identity resolver。既有 Core
`pulse::query`/`web_profile::avatar_media_paths` 已投递两个确切资源映射，Web
PulsePane 和 Native `features/platform/PulseScreen` 均已有真实 PulseHost.mediaUrl。
本批直接接回该 host consumer，不新建媒体代理、头像服务、身份事实或公共契约。

- 原样保留：原动态卡片、父引用、回复作者、Agent 活动与顶部输入区头像的 JSX、
  circle/squircle、尺寸、海报、悬停播放/移出还原及原发布操作。
- 共享迁移：上述五处共同消费既有 UserAvatar/PulseHost，Web 走已有 BFF 资源映射，
  Native 走原 rewriteRelayUrl，不分叉出第二份动态页面或动画实现。
- 已授权治理改造：只是将原解析后媒体重写时机接至已准入的宿主解析；不扩大查询
  scope、授权或动作集合，不补造 owner/presence/Agent role。
- 缺失需恢复→已接真实消费者：完整动画描述的两资源不再漏过既有 host resolver；
  原静态头像沿同一 resolver 保持幂等映射。

四步结论（REQ-24、DD-74/75）：原能力已有上游和实际服务生产者；影响面只有共享
NoteCard、AgentActivityCard、PulseView 与既有 pulse.test 四文件 `+97/-2`。
无契约、数据库、状态机、词条或四侧生成。这里只读原头像，不发消息/审批/额度或
其他副作用；空头像无请求，范围切换沿既有 PulseScope key 卸载，不复用旧 Principal
的缓存。失败、UNKNOWN 与既有 media 路径准入不变，Mobile 未改动、不冒称实机等效。

复用原 4 CPU/8 GiB SDK/cache，启动前 pgrep 无编译/检查进程，容器只有 sleep；
可用内存 29361 MiB、load 6.80/5.59/5.57，Data 剩 292 MiB。只同步四个精确输入
及两宿主已安装的三个实际共享模块，没有安装依赖、全树复制、镜像/产物构建或清缓存。
正式四输入及实际两宿主六安装文件共十处 `cmp` 退出 0，四路径 diff 检查退出 0。
日志仍在本章前述 `workflow-native-template.s3JDP1` 目录：

- `pulse-avatar-first.log`（session 84086）：共享 production/test 两个类型检查与
  Pulse 11 项整条退出 0。
- `pulse-avatar-mutation.log`（session 57915）：仅在私有 SDK 断开五个 resolver，
  三个新增实际 DOM 检查均收到原媒体地址而不是 BFF path，3 failed/8 skipped、
  退出 1；随后恢复与正式源码字节相同。
- `pulse-avatar-restored.log`（session 77847）：共享 production/test 类型、Pulse
  11 项及 Web 类型检查均通过，但 Native 命令错用上级 node_modules，实际总退出 1：
  `Cannot find module .../collaboration/node_modules/typescript/bin/tsc`。未改产品代码
  或安装工具；按已存在 desktop/node_modules 修正执行路径，仅重跑 Native 类型。
- `pulse-avatar-native-restored.log`（session 42475）：Native `tsc --noEmit` 实际退出
  0、日志为空；原 React act warning 在 Pulse 日志保留，没有宣称无警告或全量通过。

浏览器沿现有正常 OIDC 表单尝试一次真实 bootstrap 登录，IdP 返回
`Invalid username or password.`，未重试、重置口令或注入 cookie/session。
随后只读核对确认容器既有凭据挂载是旧 inode，当前受控 host 文件已更换；
该拒绝只证明旧挂载输入无效，不证明当前凭据或账号失效。
受控临时输入已删除并检验不存在，原 Secret 未改；没有运行原辅助脚本的发消息段。
playwright-cli 截图 `.playwright-cli/kailo-ui-20261008-oidc-input-refused.png` 已实际打开
复核：当前为英文错误登录页，不是业务页；连同此前空登录页，本轮为两个登录状态，
业务截图仍为零。服务仍是 live `sha256:d313fb1326cec59bcd4f3dc3b4785033026c43a438a41594895e6f57b5157e83`，
不是本批新源码；本批未部署、未更新安装包或运行完整门禁。
全树分类、完整 bot profile 和三个原 Inbox 筛选业务链仍未全部闭合，不称 100% 还原。
- 真实 Inbox 接线后 `tsc --noEmit` 与资料 9／Inbox 19 项整条命令退出 0，
  `inbox-author-consumer-first.log`（session 1367）。覆盖原静态头像、Conversation
  动态 poster/hover、错误作者、身份/scope 变更及迟到读取边界。
- 私有 SDK 故意将实际 Inbox 调用方退回 `UserAvatar avatarUrl={null}`，
  `InboxPane.test.tsx:194` 报 `expected undefined to be '/api/v1/workspaces/…/media/…'`，
  实际 1 failed／18 skipped、退出 1，`inbox-author-consumer-mutation.log`。
- 还原后四输入与正式源码 `cmp` 均退出 0；最终 `tsc --noEmit` 与两文件全部
  `28 passed`、整条命令退出 0（session 77551），
  `inbox-author-consumer-restored.log`；该最终输入包含中英 alt 实际切换断言。
  React `act(...)` warning 如实保留在原始 stderr，未隐藏或写成无诊断。

本批源码四文件 `+111/-9`。3307 个全树变动路径仍未逐项全部分类，精确未分类数
尚未统计；原项目/needs_action/reminders 消费者、完整 bot profile、其余遗留 i18n
仍未关闭。本批没有新增页面截图；既有登录失效截图不证明新 Inbox 呈现。
**本批未部署，原版一致性的视觉验收未完成。** 全仓检查、Windows/Mobile 包与
实机验收本批未执行，由主线集中收口；不能宣称 100% 还原或生产就绪。
### 2026-10-08：原 Forum 卡片、详情与回复真实作者头像消费者

固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/features/forum/ui/ForumPostCard.tsx::ForumPostCard` 及
`desktop/src/features/forum/ui/ForumThreadPanel.tsx::{ForumThreadPanel,ReplyRow}`
消费真实作者 `avatarUrl`。完整差异续核发现 Web `ForumPane::renderAuthor` 仍固定传
`avatarUrl={null}`；本批沿现有授权事件读取接回同一原 `UserAvatar`，不是另造头像控件。

- 原样保留：原 ForumView 卡片、详情、回复、Markdown、滚动与资料弹层主体。
- 共享迁移：继续使用已有共享 ForumView/UserAvatar；没有新增第二份页面或词条。
- 已授权治理改造：Web 通过原 `MessageAuthorAvatar` 消费已准入事件作者读取，
  Principal/workspace/event/pubkey 共同约束 query，媒体消费原 scoped media 映射。
- 缺失需恢复→已接真实消费者：卡片和回复原 sm、详情原 md 头像实际使用返回媒体；
  不通过打开资料弹层、启动私聊或发布消息触发头像读取。

四步结论（REQ-24、DD-74/75、SS-WEB-PRESENTATION、V-REQ-24）：

1. 原作者头像上游支持，Web/Native 共源呈现已定；本批只恢复 Web 的授权读适配。
2. 头像子批影响面为 ForumPane 及其既有检查两文件，`+49/-6`。卡片、详情和回复均接回；
   原作者 hover/panel 共用既有事件 query/cache。无 schema、API、数据库、Workflow、
   持久状态或四侧生成变化，Native/Mobile 输入不变。
3. 事件作者不匹配、错误、pending/refetch 不消费旧成功头像；断流立即撤除读取，
   切换 Principal/scope 继续已有隔离与迟到结果保护。不复制正文或另立资料/权限权威。
4. 空头像沿原 fallback，读取失败不伪造媒体，零帖子没有新作者调用；分页与背压
   沿原 Forum 窗口及原虚拟器。无写动作或重试状态机，六类错误和 UNKNOWN 不变。

沿原 SDK/缓存集中验证，实际容器仍 4 CPU/8 GiB，执行前无现存编译/测试进程、
可用内存 27700 MiB；没有安装依赖、整树复制、打包或部署。日志根沿上一节：

- `forum-author-avatar-first.log`：12 passed/3 failed，旧 ChannelPane 全量 mock
  遗漏真实 `mentionPeopleFromMembers`；`forum-author-avatar-harness.log` 又明确暴露
  旧 BFF mock 缺 `fetchUserState`。改为保留原导出的 partial mock，不改生产逻辑
  迎合检查。`forum-author-avatar-harness-complete.log` 后 Forum 实际 6 passed。
- `forum-author-avatar-mutation.log`：SDK 真实调用退回 `avatarUrl={null}` 后，
  媒体断言报 `expected undefined to be '/api/v1/workspaces/…/media/…'`，
  1 failed/5 skipped、实际退出 1；恢复后正式源码与候选 `cmp` 退出 0。
- `forum-author-avatar-restored.log`（session 1204）：Web `tsc --noEmit` 与
  Forum 6/作者资料 9 项合跑，整条命令实际退出 0、`15 passed`。
  React `act(...)` warning 保留原 stderr；两文件 `git diff --check` 退出 0。

头像子批新代码尚未部署、业务截图为零；过期 OIDC 页面不能代替视觉验收。
上述 15 项只覆盖头像子批，不覆盖下面随后补齐的原作者按钮文字/圆角；
完整 bot profile 及全树未分类项仍须继续恢复，不称 Forum 或全平台已 100% 还原。
全量门禁与 Windows/Mobile 实机本批未执行，
由主线集中收口，不能把本批窄验当作生产验收。

#### 同批闭合：原作者按钮呈现共源与两个真实宿主

继续完整核对上述固定源码的原按钮，而非只核新增头像 diff：原卡片为
`rounded-lg`/`font-medium`/`truncate`，原 `ReplyRow` 不截断作者，
原详情为 `rounded-xl`/`font-semibold`。现行 Native 三处统一卡片样式，
Web 使用通用 MessageAuthorText，均是原版呈现差异，现按原 JSX 复用闭合。

共享 `ForumView.tsx::ForumAuthorButton` 由 Web `ForumPane` 与 Native
`ForumScreen::ForumVisit` 两真实消费者共用；`renderAuthor` 内部呈现参数携带
原 card/detail/reply 区分，不增加平台契约、数据库字段、状态机、持久偏好或新业务动作。
原 ProfilePopover 与上述准入读取保留；Web 断流撤原 profile trigger，同时禁用原按钮，
不使缺少读取/会话证明的身份操作重新可达。原 i18n 和用户名字内容不变，无四侧生成。
完整功能批共五代码/检查路径 `+116/-22`（含头像子批），不是 helper-only：
共享 ForumView/既有 forum.test、Native ForumScreen、Web ForumPane/既有 ForumPane.test。

最终仍复用原 4 CPU/8 GiB SDK，执行前无构建/检查进程，可用内存 26510 MiB，
Data 剩 427 MiB；只同步五个精确输入和两份实际安装的共享文件，没有整树复制、
安装依赖或构建镜像/产物。五输入及两实际安装共享文件与正式源码 `cmp` 均退出 0。
日志根沿前节：

- `forum-author-original-shared-first.log`：共享 9 项通过后 shell 的 cd 层级错误，
  命令退出 1，Web 未执行；修正为已核实绝对 SDK 目录，不改产品源码或静默跳过。
- `forum-author-original-shared-mutation.log`：SDK 故意把详情退回原先统一卡片样式，
  两项新共享检查真实报 `expected false to be true`，2 failed/7 skipped、退出 1。
  `forum-author-original-web-mutation.log` 的实际 Web 详情消费者也在 `rounded-xl`
  断言报同一错误，1 failed/5 skipped、退出 1。原字节恢复后才运行最终链。
- `forum-author-original-shared-restored.log`（session 71536）：共享 production/test
  两个 `tsc --noEmit`、共享 Forum 9 项、Web `tsc --noEmit`、Forum/作者 15 项、
  Native `tsc --noEmit` 整条命令实际退出 0；共 24 项通过，原 React warning 保留。
- 五路径 `git diff --check` 退出 0。没有再运行全量检查或单独发布。

**本完整功能批仍未部署、无新版实际页面截图和 Windows/Mobile 实机验收。**
原样式类与实际消费者检查不能冒充截图或全部原版一致性；完整 bot profile、
原 Inbox 剩余筛选生产者/消费者及其余全树未分类项仍未关闭。

### 2026-10-08：原 Inbox 详情真实作者头像消费者

固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/features/home/ui/InboxMessageRow.tsx::InboxMessageRow` 已消费原
`UserAvatar` 的真实头像、`h-9 w-9 shrink-0` 与 `md` 呈现；全树清单续核发现
Web `InboxThreadPane` 仅构造无头像的 TimelineMessage，并用 identity 槽包资料弹层，
没有把现存已准入的作者头像读取接给原头像。现直接接回真实槽消费，不发明页面或按钮。

- 原样保留：Inbox 原布局、消息行、回复、私聊、游标、资料弹层及既有 Avatar。
- 共享迁移：继续消费共享 MessageRowSurface/UserAvatar，Native 原消费者不复制。
- 已授权治理改造：沿已有 MessageAuthorAvatar，按 Principal、workspace 或 conversation、
  event 与签名作者解析媒体；不取全局目录、不凭昵称/消息正文推定身份。
- 缺失需恢复→已接真实消费者：频道与私聊 Inbox 详情恢复原 md 头像；不打开资料、
  发消息或创建私聊也可完成授权头像读取。

四步结论（REQ-24、DD-74/75）：原头像上游支持；影响面仅 Web InboxThreadPane 及
既有检查两文件 `+52/-7`，无 schema、API、数据库、Workflow、持久偏好或词条变化。
Web 仍经 BFF，Native 本机凭据/Relay 原链及 Mobile 均未改动。作者不匹配、读取
失败或过期返回沿现有 helper 拒绝旧头像；断流立即卸载读取与 profile trigger，
绑定撤销沿既有消息准入删除详情，零消息没有额外读取。查询 key 隔离 Principal/scope，
不引入副作用、审批/额度重试或新终态，六类错误与 UNKNOWN 不变。

复用同一 4 CPU/8 GiB SDK 与缓存，只同步以上两精确文件；主线四侧生成结束后才
启动窄验，未与生成争用候选，未安装依赖、整树复制、打包、清缓存或部署。
原日志仍在上一节日志根：

- `inbox-detail-avatar-first.log`：Web 类型检查通过，实际 22 passed/2 failed；
  两个真实媒体 DOM 断言失败为 jsdom 未模拟 Image load。沿已有头像检查补回加载
  模拟，未改变生产逻辑；`inbox-detail-avatar-harness.log` 实际 15 passed、退出 0。
- `inbox-detail-avatar-mutation.log`：仅在 SDK 断开实际 Inbox 头像消费者，两个新增
  检查均报 `expected "vi.fn()" to be called`、Number of calls 0，2 failed/13 skipped、
  实际退出 1。随后恢复原字节，两正式输入与候选 `cmp` 均退出 0。
- `inbox-detail-avatar-restored.log`（session 16271）：Web `tsc --noEmit` 与
  InboxThreadPane 15/作者资料 9 项整条命令实际退出 0、24 passed；原 React
  `act(...)` warning 保留在 stderr，未静默屏蔽。

本批没有新版业务页面截图、部署或 Windows/Mobile 实机验收；窄验不等于全仓门禁。
原 Inbox 筛选生产者、完整 bot profile、频道/线程其他头像消费者及全树未分类差异
仍未全部闭合，不能据此声明所有头像、原版体验或生产目标完成。

### 2026-10-08：原频道、私聊与线程真实作者头像消费者

固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/features/messages/ui/MessageRow.tsx::MessageRow` 在原 `avatarNode`
消费 `message.avatarUrl`，保留 `relative shrink-0` 外层与 `shrink-0` Avatar。
全树清单续核发现 Web ChannelPane/ChannelThreadPane 的 TimelineMessage 与原资料
适配均未消费真实头像；现直接沿原 MessageRowSurface identity 槽接回既有
MessageAuthorAvatar，不重画布局、不增加页面、按钮或业务动作。

- 原样保留：原频道/私聊/线程布局、默认 md 人类头像、消息作者与相邻同作者续行
  分组、编辑、回复、反应、富文本输入、资料弹层及原事件准入。
- 共享迁移：继续使用既有共享 MessageRowSurface/UserAvatar，两 Web 实际消费者
  共用已有作者读取与缓存；Native 原消费者、Mobile 原链不变。
- 已授权治理改造：真实头像沿既有 Principal/workspace/conversation/event/签名作者
  读取，私聊使用 conversation author 路由，不退回 workspace 资料或全局目录。
- 缺失需恢复→已接真实消费者：频道、私聊及线程头像按原样显示；同作者续行不额外
  生成头像或读取。线程没有可选资料打开动作时，头像读取不凭空增加该动作。

四步结论（REQ-24、DD-74/75）：上游已支持原头像；影响面仅 ChannelPane、
ChannelThreadPane 与既有 ChannelRead/ChannelThreadPane 检查四文件 `+90/-14`。
无契约、数据库、Workflow、状态机、持久偏好或词条变化，无四侧生成。Web 仍经
BFF；作者不符、资料或媒体读取失败沿原 helper 拒绝旧头像，不复制正文或身份权威。
断流、绑定关闭/撤销卸载实际读取及 profile trigger；零消息无读取，并发缓存 key
隔离 Principal/scope。只读头像不发布消息、不新建私聊、不触发审批/额度或副作用
重试；UNKNOWN、六类错误和原失败终态不变。

仍复用原 4 CPU/8 GiB SDK/cache，启动前无构建/检查进程，可用内存 33090 MiB、
load 6.19/5.09/6.21，Data 仅余 294 MiB；只同步四个精确输入，没有安装依赖、
整树复制、新镜像、打包、清缓存或部署。日志仍位于上述
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/workflow-native-template.s3JDP1`：

- `channel-author-avatar-first.log`：Web `tsc --noEmit` 通过，48 passed/2 failed、
  退出 1。两检查把原同作者线程续行误判成两头像；保留产品分组，改正 root-only
  断言并用不同签名作者构造两头像场景；`channel-author-avatar-continuation.log`
  线程 7 项通过、退出 0。
- `channel-author-avatar-mutation.log`：只在私有 SDK 断开两个实际头像槽消费者，
  新增频道、私聊、不同作者线程三检查真实失败：媒体路径为 undefined、私聊作者
  读取 Number of calls 0，3 failed/30 skipped、退出 1。随后恢复原字节，四正式
  输入与 SDK `cmp` 均退出 0，没有修改正式源码作破坏。
- `channel-author-avatar-restored.log`（session 95746）：Web `tsc --noEmit` 与
  ChannelRead 26/线程 7/ChannelPane 8/作者资料 9 项整条命令实际退出 0、50 passed。
  原 React `act(...)` 与 linkify 初始化 warning 保留在 stderr。四路径
  `git diff --check` 退出 0。

本批没有新版业务截图、部署、完整门禁或 Windows/Mobile 实机验收；原条件/样式与
实际消费者检查不冒充图像验收。完整 bot profile（含 agent 形状/owner/presence
真实事实）、原 Inbox 剩余筛选生产者/消费者及全树未分类项仍未全部闭合。

### 2026-10-08：原线程摘要宿主媒体消费者与发送中双语状态

固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/features/messages/ui/MessageThreadSummaryRow.tsx::ParticipantAvatar`
直接使用原 UserAvatar；后者在
`desktop/src/shared/ui/UserAvatar.tsx::UserAvatar` 内对海报/动画调用 rewriteRelayUrl。
现存 Native TimelineMessageRow/MessageThreadPanel 的真实 summary 已有 avatarUrl，
但共源 UserAvatar 默认 resolver 为 identity，Native 的直接 re-export 和共享
ThreadPanelSurface 两个摘要消费者没有转送宿主解析。这不是缺头像正文生产者，
也不是需要新媒体端点；本批补回既有 rewriteRelayUrl 的实际消费链。

- 原样保留：摘要 sm/h-6 尺寸、圆形/Agent 方圆形、堆叠遮罩、海报与悬停播放、
  折叠/展开、回复计数、未读、原间距与草稿保留；不新增入口或重画布局。
- 共享迁移：共享摘要与线程只转送既有媒体 resolver，Native 两实际 adapter 接原
  rewriteRelayUrl；没有复制两套 UI，Web 未提供 resolver 的既有调用保持兼容。
- 已授权治理改造：MessageRowSurface 的原 Sending… 使用已有 buzz.sending 中英
  同源词条，保留原省略号与 pending/未分组/禁已投递操作的语义；不新增词条权威。
- 缺失需恢复→已接实际消费者：Native 主列表摘要与线程分支摘要不再漏过原媒体
  解析；这里没有补造 Web 参与者头像、agent owner 或 presence 事实。

四步结论（REQ-24、DD-74/75）：上游支持、既有 summary/profile 已生产数据；影响
面只有两 shared thread、MessageRowSurface、Native 两 adapter 与原两检查，七文件
`+79/-7`。只新增可选 UI resolver 转送，公共契约、数据库、Workflow、词条与四侧
生成均未变化。空头像/空列表无媒体读取，解析失败仍沿原 Avatar 行为，不扩大
媒体或身份集合；scope/撤权沿原宿主链，不改变写动作、副作用、重试、六类错误
或 UNKNOWN。Mobile 未改动；只读图片与 pending 文案不伪装业务终态。

沿用原 4 CPU/8 GiB SDK/cache；开始时无编译/检查进程、容器仅 sleep，可用内存
33457 MiB、load 2.73/3.70/4.55，Data 余 114 MiB。只同步七个精确文件及两宿主
六个共享模块副本，没有依赖安装、整树复制、镜像/安装包构建、缓存清理或部署。
七正式输入与 SDK、两宿主六副本共十三处 cmp 退出 0；七路径 diff 检查退出 0。
日志仍在本章既有 `workflow-native-template.s3JDP1` 目录：

- `thread-summary-first.log`：shared production 类型通过；检查夹具错用原
  buildAnimatedAvatarUrl 参数，test 类型 TS2554，整条退出 2。改正调用后
  `thread-summary-fixture.log` 为 13 passed/1 failed、退出 1：夹具错误假设原 depth0
  根节点存在折叠 guide。没有给产品补假按钮，改为真实主列表/分支摘要检查。
- `thread-summary-consumer.log`：错误从 barrel 导入 buildMainTimelineEntries，
  13 passed/1 failed、退出 1；只改为其原文件导入，不新增产品 export。
  `thread-summary-targeted.log`（session 19034）：test 类型及 14 项退出 0。
- `thread-summary-avatar-locale-mutation.log`（session 82510）：仅私有 SDK 断开
  摘要 UserAvatar resolver 并还原英文常量，两检查真实失败，2 failed/12 skipped、
  退出 1。`thread-summary-panel-mutation.log`（session 76864）：恢复前两处后，
  另断开 ThreadPanelSurface 摘要传送，1 failed/2 skipped、退出 1；错误均为原
  图片地址不同于宿主解析路径。负向日志的 React act warning 保留，未屏蔽。
- 恢复十三处原字节后，`thread-summary-restored.log`（session 72838）整条实际
  退出 0：shared production/test、Web、Native 四个 tsc --noEmit 与 14 项均通过。

本批未部署、未更新安装包、未运行全仓门禁，真实业务截图仍为零。playwright-cli
无敏感值探测返回 require/process/readFile/fs 均 undefined，不能把 Node 文件读取
写进其 sandbox 并声称安全登录；未新造 CDP/传密通道、改账户或注入会话。
全树 3307 路径尚未全量语义分类，精确未分类数未统计；Web 摘要参与者头像、
完整 bot profile、Inbox 三种筛选业务链和逐页面图像验收仍未闭合，不称 100%。

### 2026-10-08 草稿详情原操作条恢复（未部署）

本批仍以 Buzz `779af8886caae1317b4de962082429867ab61503` 为固定依据。
`desktop/src/features/messages/ui/DraftDetailPane.tsx::DraftActionBar` 的详情
操作使用 `h-8 w-8`、`size="sm"`；原列表
`desktop/src/features/messages/ui/DraftsPanel.tsx::DraftRowActionButton` 使用
`h-7 w-7`。共源迁移误把列表按钮复用于详情，缩小了原版详情控件。本批只
恢复该实际缺失，不重画页面，不将未有业务生产者的 Inbox 筛选加成空入口。

动手前边界与影响：

- 权威：用户的原版一致性红线、既定共源迁移；上游支持，属于缺失需恢复。
- 引用：检索确认 `DraftDetailSurface` 的真实消费者为
  `web-client/web/src/platform/ui/InboxDrafts.tsx` 和
  `collaboration/desktop/src/features/messages/ui/DraftDetailPane.tsx`。
  两宿主继续共用同一个详情组件，不新增独立 Web 页面实现。
- 副作用：不更改草稿存储、发布意图、身份、scope、API、错误分类或契约。
  打开/发送仍消费宿主已算出的可用性；发送仍先确认，结果不明的
  `sendIntent` 仍禁止删除，不重复执行，不将未知状态渲染为成功或失败。
- 异常：空详情、不可打开/不可发送、孤儿提示沿既有行为；确认取消不发送，
  确认后只调用既有回调。并发、撤权、额度和发布终态仍交给既有治理链，
  本批不另造状态、额度、授权或对账权威，无数据格式/迁移变化。

实现与分类（仅本批，不冒充全树分类完成）：

- 原样保留：列表的 28px 控件、详情原正文/布局、原确认交互。
- 共享迁移：在 `client-kit/ts/platform/src/react/draft-surfaces.tsx` 恢复
  `DraftDetailActionButton`、`DraftDetailActionBar`，由实际
  `DraftDetailSurface` 消费；原 32px、hover/focus 与删除色类直接来自上述
  固定原模块。
- 已授权治理改造：保留 `canOpen`、`canSend`、未决发布意图禁止删除及中英
  词条，不恢复原版未经治理的执行旁路。
- 缺失需恢复：本批恢复详情误缩小问题；完整草稿页面、Web 线程删除事实、
  尚存文案差异和逐页截图尚未全量验收，不能据此称整页 100% 一致。

两代码路径合计 `+56/-3`：上述实现及
`client-kit/ts/platform/test/draft-surfaces.test.tsx`。实现后补原实际消费者
检查，同时验证列表/详情尺寸、按钮顺序、真实打开/删除参数、发送确认、
取消及结果不明禁止删除，不以 helper 自测代替调用接通。

验证复用 `kailo-agent-receipt-xvkujx` 的既有 SDK/依赖与 4CPU/8GiB cgroup，
执行前核对在途进程、CPU/内存和 Data 空间；未新镜像、安装依赖或全树复制。
日志根为
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/workflow-native-template.s3JDP1/`：

- 首次 shared production/test 类型校验与专项 3 项通过，实际退出 0。
- 私有副本主动将详情降回 28px 并放开未决意图删除，
  `draft-detail-mutation.log` 实际退出 1，`2 failed / 1 passed`，分别抓到
  原尺寸回归和 UNKNOWN 删除破坏；正式源码未改坏。
- 恢复后 `draft-detail-restored.log`（session 87222）实际退出 0：shared
  production/test、Web、Native 四个 `tsc --noEmit` 与专项 `3 passed`。
  正式实现/检查与 SDK 以及 Web/Native 已装共享包共四处 `cmp` 均退出 0，
  两代码路径 `git diff --check` 退出 0。

本批未部署、未更新安装包、未运行全仓门禁。业务页面截图仍为零，仅有此前
两张 OIDC 登录边界图，不拿旧部署证明新源码。固定全树 3307 路径尚未全部
语义分类，准确未分类数未统计；原版全量恢复及三端实际验收仍未完成。

### 2026-10-08 原私聊草稿来源资料消费者恢复（未部署）

固定源码仍为 Buzz `779af8886caae1317b4de962082429867ab61503`：
`desktop/src/features/messages/ui/DraftsPanel.tsx::useDraftViewItems` 原本读取
当前身份及草稿所在频道参与者的真实资料，再经
`desktop/src/features/sidebar/lib/channelLabels.ts::resolveChannelDisplayLabel`
显示私聊来源。现有 Native 实现删掉了这条消费链，只显示 `channel.name`，
因此通用名 DM 未恢复为真实姓名。本批按原模块接回，并非自创私聊页面。

动手前边界与影响：

- 权威：用户原版一致性红线、共源及中文默认要求；现有 Relay 资料读取已
  支持，属于需恢复的消费者。未给缺少业务生产者的 Inbox 筛选加空入口。
- 影响：检索实际 `useDraftViewItems`、`toDraftSurfaceItem`、两端原
  `DraftListSurface`/`DraftDetailSurface` 与现有资料查询、词条生成路径。
  原 Native `Channel`/`UserProfileLookup` 沿原类型使用；Web 沿受准入的
  Conversation/participant 事实，不新增手写合同、持久化字段或迁移。
- 副作用：只恢复显示资料消费，不新增身份/权限/资料权威，不复制消息正文，
  不使持有凭据或读取到姓名等同资源授权；打开、发送、确认、UNKNOWN 意图
  禁止删除和现有宿主准入保持原链。资料 fallback 不制造 owner、在线状态。
- 异常：原通用名检测、排除自身、同名去重、最多三名后余量提示、用户自定
  群名保留及空参与者返回原名沿固定源码。资料刷新重算来源；只请求有真实
  草稿的频道参与者，不把不相关频道名单加入请求。未知目的地及执行错误
  沿原分类/准入处理，无新增状态或重试/对账权威。

本批分类与真实调用：

- 原样保留：恢复的 Native `channelLabels.ts` 对固定原文件的 diff 仅为
  两行出处注释和共享展示函数 import；通用名/身份/资料/去重逻辑未重写。
- 共享迁移：把原
  `desktop/src/features/channels/lib/dmParticipantDisplay.ts` 中实际消费的
  `getDmParticipantPreview`、`formatDmParticipantDisplayName` 搬到共享
  `react/conversations/dm-participant-display.ts`；Native 原 resolver 与 Web
  `InboxDrafts` 均实际调用，仍由原共源草稿列表和详情呈现，不另造布局。
- 已授权治理/中英适配：Native 复用现有 `useIdentityQuery` 与
  `useUsersBatchQuery`，Web 仍只在已准入绑定内解析参与者；原 `+N more`
  提示改为同源 `dm.moreParticipants` 中英词条并沿原工具生成 Dart。
- 缺失需恢复：只闭合本批草稿来源消费，不据此称整个私聊、Inbox、所有

### 2026-10-08：原 Projects 目录创建／管理实际消费者恢复

固定官方基准仍为 Buzz `779af8886caae1317b4de962082429867ab61503`。本批不再只补
Inbox 局部效果，而接回原 Projects 空态创建、网格／列表管理菜单及列表展示链。
八个代码／生成／检查路径共 +344/-26 行，未改契约、Core、组件数据或宿主业务实现。

#### 权威、影响、副作用与边界

1. 用户要求完整原版页面而保留既有治理；原
   `desktop/src/features/projects/ui/ProjectCards.tsx::EmptyState/ProjectGridCard/ProjectListRow`、
   `desktop/src/features/projects/ui/CreateProjectDialog.tsx::CreateProjectDialog` 与
   `desktop/src/features/projects/ui/ProjectListRowMenu.tsx::ProjectListRowMenu`
   是本批显示／交互依据；动作继续用现有 `useCreateProject` 与 `ProjectDeleteAction`。
   不把原 Projects 过滤列表头没有的创建加号留在当前页面；原空态创建入口恢复。
2. 实际消费者为共享 `ProjectsView::ProjectDirectory`，由
   `web-client/web/src/platform/ui/ProjectsPane.tsx` 与
   `collaboration/desktop/src/features/platform/ProjectsScreen.tsx` 直接复用。
   查询仍沿原 ProjectsHost；创建检查真实 roleWorkspaces capability，提交原工作区
   ActionCommand、项目／仓库公告并读回，不另造项目或执行权威。删除目标按
   `projectModels` 的时间戳／最小 ID 赢头规则选择，不能删除旧 revision 冒充删除当前项目。
   只有本机原身份拥有的条目显示删除菜单，最终权限仍在 Relay／Core。
3. 当前 scope 失败／刷新时不保留公告事实；无创建 capability 或读取失败无创建入口。
   UNKNOWN 沿现有冻结意图与同键观察，不因本批弹窗创建新命令；已确认创建后的导航错误
   不报成创建失败。卸载后不写新页面状态、不导航。Core 不复制正文；列表持久化只保存
   原 `buzz.projects.viewMode` 的 grid/list 设备偏好，不保存成员、权限或账号事实。
4. 空目录与过滤零结果使用不同原组件；列表描述直接复用固定原
   `desktop/src/features/projects/lib/projectsViewHelpers.ts::markdownToPlainText/listRowDescription`。
   重入、超时、撤权、未知结果、ACK 后读回失败继续由现有动作链决定，不新增状态机。
   本批无数据库／四侧契约变更；两条原英文文案补中文，同源生成 Dart，未另立翻译权威。

#### 固定原路径四类归档（本模块范围，不代表全树完成）

| 固定官方完整路径／符号 | 分类、已恢复与仍缺项 |
| --- | --- |
| `desktop/src/features/projects/ui/ProjectListRowMenu.tsx::ProjectListRowMenu` | 共享迁移；除两行来源注释和两个共享 import 路径外，原函数字节级 diff 退出 0。Web/Desktop 网格和列表均是真实消费者。 |
| `desktop/src/features/projects/ui/CreateProjectDialog.tsx::CreateProjectDialog` | 已授权治理改造；原 Dialog 关闭／busy 规则复用，附加现有冻结意图及原治理表单 back 接缝。真实空态按钮调用，不是无调用方 helper。 |
| `desktop/src/features/projects/ui/ProjectCards.tsx::EmptyState/EmptyFilteredState/ProjectGridCard/ProjectListRow` | 缺失需恢复（部分已补）；原空态、过滤空态、菜单位置／覆盖按钮与列表正文已恢复，people、activity、Git/Terminal 仍缺真实生产链，不能算整文件完成。 |
| `desktop/src/features/projects/ui/ProjectsView.tsx::ProjectsView` | 缺失需恢复（部分已补）；共源目录接回真实创建／删除，仍不是原完整 Activity/Repositories/Tasks/Reviews/Channels/详情产品页面；当前公告侧栏不当作完整原详情。 |
| `desktop/src/features/projects/lib/projectsViewHelpers.ts::readStoredViewMode/writeStoredViewMode/markdownToPlainText/listRowDescription` | 缺失需恢复（部分已补）；列明的实际调用函数已迁移，其余 Git/activity/filter 依赖未按名称复制成死代码。本批没有新增原样保留文件；未变化原文件不计入本表五条变动归档。 |

原 3307 路径历史 patch 的绝对原件未能定位，本表不把该快照称当前可复核完整清单，
也不与旧 3278 路径另一版本混算。下一步沿现有 upstream_manifest 重新导出当前完整
差异；全局未分类／未恢复准确数量仍未知，不能用此五条记录计算全仓完成比例。

#### 实施后实际验证／破坏恢复

仍复用 `kailo-agent-receipt-xvkujx` 4 CPU／8 GiB 受限 SDK 与现有缓存；检查前主机
可用内存 24 GiB、swap 0、Data 2.0 GiB，无已在跑编译进程。未新镜像／安装依赖／整树复制。
日志均在 `/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/workflow-native-template.s3JDP1/`。

- `projects-directory-candidate.log`：shared production/test 两次 tsc 退出 0；第一次
  54 项有 16 项失败，原因是本批检查把 localStorage.clear 放在 setLocale(en) 后，清掉
  检查语言，修正清理顺序后 `projects-directory-final.log` 54 passed。未改生产语言默认。
- `projects-directory-hosts.log`：Web／Native tsc 两次退出 0，原 Dart 生成及 `--check`
  输出 `PASS: Mobile platform and reason catalogs match the shared TypeScript source`。
  正式 Dart 文件为 root 所有，普通 cp 一次 Permission denied 后，用限定目标 sudo cp
  投递机械生成的十行词条差异；reason_text cmp 未变化。
- 私有候选破坏创建点击、准入、删除赢头、布局保存和过滤空态，
  `projects-directory-mutation.log` 退出 1，7 failed／1 passed／46 skipped；独立绕过
  compact description 解析，`projects-description-mutation.log` 退出 1，1 failed／53 skipped。
- 全部恢复后 `projects-directory-restored.log` 54 passed；固定原列表头复核删除非原加号
  后 `projects-directory-source-aligned.log` shared production tsc 及 54 项再次退出 0。
  两已安装共享包／SDK 正式输入与生成词条共二十次 cmp、相关 diff --check 均退出 0。
  日志保留现有 React 异步 act 警告，不把告警隐藏为零。

本批未提交／部署／更新安装包，未运行全仓门禁，由主线集中收口。新版 Projects 浏览器
与 Windows/Mobile 尚未验收。既有正常 SSO 会话另打开并实际截图复核旧 live 通知设置
`.playwright-cli/kailo-ui-20261008-live-notifications.png`（1920×1080）；现共十二张旧
live d313fb 图，十类页面及两状态，不是本批源码截图。通知权限显示已阻止，未保存偏好
或验证推送。该旧会话 console 有图片请求被转到 IdP 后受 img-src CSP 阻断的真实错误，
未放宽 CSP 或注入会话；不把布局可见称头像／全部功能／100% 原版一致性验收。

### 2026-10-08：当前固定官方全树差异重新导出及逐路径归档起点

原历史 3307 路径 patch 未能定位，不沿其数字宣称当前全量可复核。本次只运行现有
`python3 tools/upstream_manifest.py diff collaboration` 一次；官方基准为
`779af8886caae1317b4de962082429867ab61503`，导出前后 apps HEAD 都是
`8ee8e674bb8c53a0698e1ba47261acb4b91bcead`。工作树含尚未提交改动，HEAD 不代表
全部输入；下面的不可变 patch 字节才是本次差异快照，不与其他历史快照混算。

复用现有 SDK 镜像，以独立只读源码挂载、network none、4 CPU／8 GiB cgroup 导出，
没有新镜像、下载、源码整树复制、GitNexus、主 SDK 并发编译或发布。生成产物位于
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/workflow-native-template.s3JDP1/`：

- `collaboration-current-20261008.patch`：3313 差异路径，1,040,289 行、44,230,352 字节；
  SHA-256 `8f570bf7af384ddc39a9d0b28eab705489b4377c7653c183c9cccc12418a22b4`。
- `collaboration-current-20261008.numstat`：由原 patch 经 `git apply --numstat` 只读解析，
  3313 行；SHA-256 `30cb8f0d0a133fc150ce7c585de05c507276cb3222dddd506c6fcc767f8fe327`。
- `collaboration-current-20261008.classification.tsv`：3313 个差异路径逐行登记固定版本、
  路径、变动种类、分类、迁入位置与证据边界；SHA-256
  `153513977f30c3bd0aa88b50af7b8ac7701fbb8a9a8e461d9d3dd17bed5f0884`。

本表当前确实归类 27 路径：共享迁移 21、已授权治理改造 1、缺失需恢复 5，
其余 **3286 路径未分类**。其中 18 个迁移路径以固定官方 blob 与迁入文件原始字节
完全一致确认；其余九条沿上节 Projects 归档及逐文件源码对照。原文件字节被复制不自动
证明真实调用方、布局或运行验收成立，因此表中明确保留该证据边界，不把分类数量当
功能完成率。官方完整树共 5195 文件，其中同路径原 blob 一致的 1980 文件是差异表外
的原样保留事实，不混入 3313 差异路径的分母。

原 `desktop/src/features/projects/` 共 279 路径落入本次差异；旧路径删除既包括迁入共享
实现，也包括未恢复模块。不能把 `remove_paths` 当删除功能的授权，或将整个目录按
“共享迁移”一次性通过。已定位的真实缺项包括原 `ProjectDetailMetaPills`、
`projectCollection::homeRepositoriesToBind` 及其完整详情／仓库绑定调用链；未为无调用方
函数单独复制死代码。全仓尚未恢复的准确数量仍未知，不把五个已确认缺项当全部缺项。

浏览器正常会话另查看并打开复核旧 live 快捷键截图
`.playwright-cli/kailo-ui-20261008-live-shortcuts.png`；旧 live 业务截图现十三张，
十一类页面及两状态。随后点击自定义表情时会话过期，截图
`.playwright-cli/kailo-ui-20261008-live-session-expired.png` 只记录正常 IdP 登录页，
不计自定义表情页验收，不注入或重置会话。新 Projects 源码业务截图、Windows/Mobile
设备验收仍为零，未用旧 live 页面证明本次源码已部署或全部原版一致。
  侧栏或原 `dmParticipantDisplay` 其他功能已完整还原。

10 个代码/检查/生成路径合计 `+232/-3`：共享 package.json、i18n.ts、
dm-participant-display.ts、Dart platform_text.dart；Native channelLabels.ts、
DraftsPanel.tsx、DraftsPanelSources.test.mjs、原 test-loader-hooks.mjs；Web
InboxDrafts.tsx、InboxDrafts.test.tsx。生成 reason_text.dart 字节未变。

验证沿原 4CPU/8GiB SDK/cache，运行前核对进程、CPU/内存与 Data；未新建
镜像、安装依赖、全树复制、编译发布。日志根沿前小节同一个
`workflow-native-template.s3JDP1/`：

- `dm-draft-sources-first.log` 失败：原 Native Node loader 的 emoji-mart
  inert stub 缺实际依赖的 Picker 导出；只在原 loader 补该命名导出，不替代
  业务。随后 `dm-draft-sources-candidate.log` 为新检查 DOM Event 环境缺失，
  `13 passed / 2 failed`；修正检查环境后继续，不把两次失败算验收。
- `dm-draft-sources-checked.log`（session 97655）整链退出 0：Native
  `15 passed`（原谓词 13 + 中英实际消费者 2）、Web `7 passed`、Native/
  Web/shared production/shared test 四个 tsc --noEmit。Web 原有三条
  DraftEditor act 警告如实留在日志，不称零警告。
- 私有 Native 副本断开原 resolver 后，抓到两项 `DM` 不等于真实姓名的
  断言失败。首次失败 fixture 没在 finally 卸载而留定时器，仅终止本次
  检查子进程并修正清理；`dm-draft-sources-native-mutation-cleanup.log`
  重新运行自行退出 1，`2 failed`。未变更正式生产实现。
- 私有 Web 已装共享展示函数把三名误改为四名，
  `dm-draft-sources-web-mutation.log` 退出 1，`2 failed / 5 skipped`。
- 恢复两私有破坏后，`dm-draft-sources-restored.log`（session 9493）整链
  退出 0：Native 实际消费者 `2 passed`、Web `7 passed`、既有 i18n
  `--check` 通过。10 个正式输入与 SDK、两宿主共享包三文件共 16 次 cmp
  均退出 0，相关路径 git diff --check 退出 0。

本批源码仍未部署、未更新安装包、未运行全仓门禁。有效业务截图仍为零，
已有两张 OIDC 边界图不能证明新源码；Windows/Mobile 实机未验收。
3307 是既有全树差异清单快照，不是已分类完成数；准确未分类数未统计，
全量原版一致性、逐页面视觉复核和全部缺项尚未闭合，不称 100% 还原。

### 2026-10-08 原 Inbox 消息行两宿主真实消费者恢复与线上视觉复核

固定证据为 Buzz `779af8886caae1317b4de962082429867ab61503`：
`desktop/src/features/home/ui/InboxMessageRow.tsx::InboxMessageRow`、
`desktop/src/features/home/ui/InboxDetailPane.tsx::InboxMessageDetailPane`。
沿既有全树清单追踪发现 Web 详情错误使用通用 MessageRowSurface，未消费
原 Inbox 独有的行容器、日期、选中底板、continuation 与动作定位；Native
已有相同原展示主体。直接共享原模块，非重画页面或新建摘要。

动手前四步与本批分类：

- 权威：用户原版一致性/两宿主共源要求；原上游支持、现有资料读取与
  回复/反应治理链已支持，缺的是展示消费者。没有为缺生产者的筛选造入口。
- 影响：检索 InboxDetailPane/InboxMessageRow、Web InboxThreadPane、
  shared MessageRowSurface、日期/分组/反应处理、资料 BFF 实际消费者。
  只改六个 UI/检查路径；不改契约、Core、持久化、API、绑定或迁移。
- 副作用：Web 仍凭 principal/workspace/conversation/event 读取真实作者
  资料；Native 原资料弹层、Relay scope、媒体改写及反应 callback 保留。
  不复制正文权威、不创造 owner/在线状态，不放宽鉴权、不引入第二执行器。
- 边界：空详情、缺资料 fallback、未决发送/反应、撤权/中断、分页及
  UNKNOWN 意图继续沿原宿主/错误分类处理。本批不新增状态/超时/重试。
  第一条上下文即使同一作者也不折叠，其后沿原作者与时间窗规则分组。
- 原样保留：原行 article/间距、36px 头像、完整日期 title、continuation
  时间 gutter、首行/后续行动作定位与 Unicode 纯 emoji 大字号 class。
- 共享迁移：新增 `react/inbox-message-row.tsx::InboxMessageRowSurface`；
  Native `InboxMessageRow` 与 Web `InboxThreadPane` 均实际调用，非 helper-only。
- 已授权治理适配：反应仍用现有 shared useReactionHandler，真实身份/正文
  及动作经宿主既有准入链注入，不恢复未经治理的原执行方式。
- 尚未恢复：原 Agent owner/config-nudge/编辑删除的完整治理消费、custom
  shortcode emoji-only 处理、Web 原选中高亮消退，以及未支持筛选。Native
  原已存在的 avatar wrapper flex 修正保持，不据此声称逐字节原版或全量一致。

六个代码/检查路径 `+182/-206`（包含新共享文件 85 行）：
`client-kit/ts/platform/src/react/inbox-message-row.tsx`、同目录
`inbox-surface.tsx`、`client-kit/ts/platform/test/inbox-surface.test.tsx`、
`collaboration/desktop/src/features/home/ui/InboxMessageRow.tsx`、
`web-client/web/src/platform/ui/InboxThreadPane.tsx` 与其 `.test.tsx`。

沿既有 SDK/cache 与 `kailo-agent-receipt-xvkujx` 4CPU/8GiB cgroup 窄验，
运行前检查在途构建、CPU/内存、Data 空间；未新镜像、安装依赖、全树复制、
发布或全仓编译。日志根仍为
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/workflow-native-template.s3JDP1/`：

- `inbox-original-row-checked.log` 首次退出 2：共享 avatarUrl 可选值与原
  Avatar null 类型不符；改为明确 null 后继续，不把首次失败算验收。
- `inbox-original-row-candidate.log` 整链退出 0：shared production/test、
  Web、Native 四个 tsc --noEmit；共享 `11 passed`、Web 真消费者 `16 passed`。
- 私有 SDK `mx-1` 改 `mx-0` 后 `inbox-original-row-shared-mutation.log`
  退出 1，`2 failed / 9 skipped`；删首上下文边界后
  `inbox-original-row-web-mutation.log` 退出 1，`1 failed / 15 skipped`。
  恢复后的 `inbox-original-row-restored.log` 退出 0，`11 + 16 passed`。
- 复核补回纯 emoji 样式后 `inbox-original-row-final.log` 完成 shared 两个
  tsc 与 `11 passed`，后半因运行命令 cd 多一级退出 2：
  `sh: 1: cd: can't cd to ../../../../web-client/web`。不改生产代码绕过；
  `inbox-original-row-hosts-final.log` 从准确 SDK 目录续跑，仅 Web/Native
  两个 tsc 与 Web `16 passed`，退出 0。
- 私有副本关闭纯 emoji 大字号，`inbox-original-row-emoji-mutation.log`
  退出 1、`2 failed / 9 skipped`；恢复后
  `inbox-original-row-emoji-restored.log` 退出 0、共享 `11 passed`。
  六正式输入/SDK及两已装共享包共十次 cmp 和 scoped diff --check 均退出 0。

正常 SSO 视觉复核：使用当前 host 受控输入经官方 CLI 已有 Session.run
交给真实 IdP password 字段，随后正常提交登录。已核现有 daemon 未启用
saveSession；无口令字面量入 CLI 源码/参数/输出，无明文副本、账号重置、
Cookie/会话注入或新传密入口。未发送消息、保存头像或修改用户偏好。
这纠正前小节当时“有效业务截图为零”的历史边界，本轮已有十一张业务状态。

截图在 `apps/.playwright-cli/`，统一前缀 `kailo-ui-20261008-live-`：

- `channel.png`、`inbox.png`、`inbox-filters.png`、`pulse.png`；
- `projects.png`、`members.png`、`agents.png`、`workflows.png`；
- `profile-settings.png`、`avatar-dialog.png`、`appearance.png`。

十一张均以 playwright-cli 真实打开并截图，已逐张 view_image 打开复核，
九类业务视图加两个关键状态，1920×1080。当前线上镜像固定为
`sha256:d313fb1326cec59bcd4f3dc3b4785033026c43a438a41594895e6f57b5157e83`，
OCI revision 为空；是旧部署，不证明本批源码、最新 main 或 Windows 已验收。
截图可见原样式主体/侧栏/卡片/设置，亦可见部分作者短公钥与空项目/工作流；
不把列表空态、头像编辑器可打开或 HTTP 成功称作实际写入/工作流执行完成。

仍未截图/操作验收：选中 Inbox 详情、DM、新建消息、workflow 编辑/历史/
轨迹、Agent 详情、其余设置/弹窗、英文切换、组件 iframe、上传下载/撤权。
全部页面总数与精确未覆盖数未统计。新六路径未部署/未更新安装包，未运行
全仓门禁；Windows/Mobile 实机未验收。3307 仍不是逐处分类完成数，准确
未分类数未统计，不能声明完整原版一致性或生产就绪。

### 2026-10-08 原 Inbox 选中高亮消退与 custom-shortcode 消费者恢复

沿前节固定全树差异清单续核 Buzz
`779af8886caae1317b4de962082429867ab61503`，本批引用：
`desktop/src/features/home/ui/InboxDetailPane.tsx::InboxMessageDetailPane`、
`desktop/src/shared/lib/emojiOnly.ts::isEmojiOnlyMessage`、
`desktop/src/features/messages/lib/useMessageEmoji.ts::useMessageEmoji`、
`desktop/src/features/messages/ui/MessageRow.tsx::MessageRow`。不是自行设计
高亮动画或另建 shortcode 协议；前节两项明确缺口按原模块补齐。

动手前四步与本批分类（REQ-24、DD-74/75）：

- 权威：原上游已支持；Native 原高亮 effect 已存在，Web 错把选中状态
  直接当作永久高亮。共享纯 emoji 解析丢失原 shortcode 分支，两个行
  消费者没有传入消息自身 tags，通用行还缺原 custom-emoji 大字号 class。
- 影响：完整追踪 Native InboxDetailPane/InboxMessageRow、Web
  InboxThreadPane、共享 InboxMessageRowSurface/MessageRowSurface、原
  emojiOnly/useMessageEmoji、两端 Markdown 实际标签与安全媒体消费者。
  改十个 UI/检查路径；不改契约、Core、数据库、绑定、API 或词条。
- 副作用：高亮为原已有短暂显示状态，不参与授权、读取游标或发送终态。
  使用稳定 conversation/root 标识，实时消息重渲染不重启高亮；切换重置，
  1_200 ms 后消退，卸载清理 timer。该值保留原版既有封闭交互值，不是
  新增业务阈值。未触碰六类错误映射及 UNKNOWN 意图，不弱化失败关闭。
- 边界：空白、未知/未闭合 shortcode、混合正文不放大；大小写沿原规则。
  只读本消息实际 emoji tags，社区反应 palette 不能让无标签消息被放大。
  解析不请求 URL；图片呈现仍经两宿主原 Markdown/媒体授权链。
- 原样保留：原 Unicode/shortcode 判定、emoji 图片 1.45em 与 align-middle
  class、原高亮延时/清理与既有底板 transition；未新增菜单、按钮或布局。
- 共享迁移：原 useMessageEmoji 提到共享消息目录，Inbox/通用行均实际
  调用；原高亮 effect 提到 useInboxFocusHighlight，Native/Web 同时调用。
  移除 Native 原本地重复 effect，不保留双实现或 helper-only。
- 已授权治理适配：原消息仍由既有 Relay/BFF 准入生产，媒体、反应、资料、
  发布和撤权消费保持原治理路线；共享迁移仅调 import/type 和宿主调用。
- 缺失需恢复：Agent owner/config-nudge、原编辑删除完整治理消费、未支持
  Inbox 筛选等不因这两个显示缺口关闭而被算作完成；未生成无生产者入口。

十个代码/检查路径 `+135/-27`（含新 useMessageEmoji.ts 15 行）：共享
`react/inbox-surface.tsx`、`react/inbox-message-row.tsx`、
`react/messages/{emojiOnly.ts,useMessageEmoji.ts,MessageRowSurface.tsx}`、
`test/{inbox-surface.test.tsx,message-row.test.tsx}`，以及 Native
`features/home/ui/InboxDetailPane.tsx`、Web `InboxThreadPane.tsx` 和其检查。

运行前核在途构建/CPU/内存/磁盘：26 GiB 可用内存、无 swap、Data 2.1 GiB
可用，未检出 cargo/tsc/vitest 活跃任务。复用原 SDK/cache 与现有容器
`kailo-agent-receipt-xvkujx`，实际 cgroup `cpu.max=400000 100000`、
`memory.max=8589934592`；未新镜像、依赖安装、全树复制或发布。
日志沿前节 `/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/workflow-native-template.s3JDP1/`：

- `inbox-fade-shortcode-candidate.log` 整链退出 0：shared production/test、
  Web、Native 四次 tsc --noEmit；共享 `25 passed`（13 Inbox +12 MessageRow），
  Web 实际 Inbox 消费者 `18 passed`。
- 实现后的检查在私有 SDK 主动破坏：禁用 shortcode 识别，
  `inbox-shortcode-mutation.log` 退出 1、`2 failed /23 skipped`；阻止消退，
  `inbox-fade-shared-mutation.log` 退出 1、`1 failed /12 skipped`，Web 已装
  共享包同样破坏后 `inbox-fade-web-mutation.log` 退出 1、`1 failed /17 skipped`。
- 恢复全部私有副本后 `inbox-fade-shortcode-restored.log` 整链退出 0，
  `25 +18 passed`；十个正式输入/SDK与两已装共享包五文件共二十次 cmp
  全部退出 0。正式源码未被破坏，相关路径 diff --check 退出 0。

本批十路径未提交/部署/更新安装包，未运行全仓门禁；由主线集中收口。
本批无新增截图，前节十一张只证明旧线上 d313fb 镜像；新源码 Inbox 高亮/
shortcode 的实际浏览器视觉、Windows/Mobile 仍未验收。3307 全树差异尚未
全部语义分类，准确未分类数与全部页面截图覆盖总数未统计，不称 100% 还原。

### 2026-10-08：原 Projects Channels、搜索工具栏与两宿主真实消费者恢复

固定官方 Buzz `779af8886caae1317b4de962082429867ab61503`；本批二十个代码／生成／
检查路径 +1300/-50 行。实现先完成，再增加消费者检查；未新增契约、Core API、
数据库、执行权威或组件接口，没有新建检查框架、镜像、依赖安装或全树源码副本。

#### 权威、影响、副作用与边界

1. `REQ-24`、`DD-74`、`DD-75`、`DD-77` 与用户原版一致性要求决定本批：直接从
   固定官方 `desktop/src/features/projects/ui/` 迁入原行／分组／搜索／工具栏模块。
   原 `ProjectsChannelsList::ProjectsChannelsList` 的项目／仓库关联收集、去重、分组、
   token 搜索、活动排序、描述列、成员数、日期、不可用行和展开收起是显示依据；
   原 `ProjectEntityListRow::ProjectEntityListRow` 的 overlay 按钮与 peopleSlot 保持
   独立交互，未把资料按钮嵌入行按钮。原 selection→Agent 上下文消费者仍缺，不能
   将本批称完整 Projects 或 100% 原版还原。
2. 共享 `ProjectsView::ProjectDirectory` 实际调用原搜索／工具栏及 Channels 页面；
   Web `ProjectsPane`、`PlatformApp` 接入现有 BFF 频道目录与 channelActivity，
   Native `ProjectsScreen` 接原 `useChannelsQuery`、`goChannel`、`useUserProfileQuery`
   和 `UserProfilePopover`。Web 导航使用真实 workspace.id，Native 使用其真实
   channel.channelId，不能混用。共用 `loadChannelDirectory` 从原已治理 ChannelBrowser
   提取，旧浏览器亦真实消费；除检查非空 ID／频道映射唯一性外原分页校验保持。
3. 签名项目引用不是权限；Channels 只采纳当前 ACTIVE 成员目录，刷新／失败不保留
   旧目录事实，点击前再读完整目录确认 workspace/channel 对及成员资格。重复映射、
   游标循环、未知枚举、无效成员数、scope 离开全部关闭；导航重入不重复执行。
   成员头像按当前 HumanPrincipal 聚合而不是每个设备 key 算一个人，校验 Principal／
   pubkey 唯一性，只沿授权 memberProfile 和 avatarMediaPaths 读取。Native 继续
   本机身份／Relay 媒体读取，不退回 Web signer。没有构造 owner、presence、Agent
   roster 或默认租户；非本批支持的原功能仍登记缺项，不造空筛选或固定 0。
4. 空项目／空筛选沿原空态；不可访问引用不导航、不显示假日期或成员 0；网络／投影
   不明沿原 loadFailed 未知文案，不声称操作成功。读取错误分类沿 `06` §4 原六类：
   认证／撤权为 DENIED，缺实际能力为 BLOCKED，目录／投影事实不成立为 PRECONDITION，
   原限额拒绝为 LIMIT，映射冲突为 CONFLICT，读取／导航结果不明保持 UNKNOWN；
   不增加前端权威错误码。原动作审批／Quota／Temporal／外部副作用链未变，无本批
   新预留或待终结业务状态。时间显示直接迁入原 floor/clamp／七天转日期规则；十四个
   中文／英文词条沿既有 TypeScript catalog 生成 Dart，不另维护翻译。

#### 原路径逐项归档与仍缺功能

以下全部完整路径相对于上述固定官方树，目标位于
`client-kit/ts/platform/src/react/projects/`；每条都有本批真实页面消费者。

| 固定官方路径／符号 | 本批分类与边界 |
| --- | --- |
| `desktop/src/features/projects/ui/ProjectPanelState.tsx::ProjectPanelState` | 共享迁移；去来源注释及 cn import 位置后与原函数字节 cmp 退出 0。 |
| `desktop/src/features/projects/lib/projectsSearch.ts::matchesProjectsSearch` | 共享迁移；去来源注释后与原函数字节 cmp 退出 0，Channels 实际 token 搜索消费。 |
| `desktop/src/features/projects/ui/ProjectsSectionSearch.tsx::ProjectsSectionSearch` | 缺失需恢复（部分已补）；原开关／动画／焦点／Escape／清空／排序位置恢复，完整原筛选范围仍缺。 |
| `desktop/src/features/projects/ui/ProjectsToolbar.tsx::ProjectsToolbar` | 缺失需恢复（部分已补）；原样式／溢出遮罩／活动项滚入恢复；仅真实 Projects/Channels 消费，Activity/Repositories/Tasks/Reviews 未冒充已实现。 |
| `desktop/src/features/projects/ui/ProjectsListHeaderBar.tsx::ProjectsListHeaderBar/ProjectsSortSelect` | 缺失需恢复（部分已补）；原 grid/list 及创建时间／名字排序恢复，Git/activity 的 updated 排序仍缺生产链。 |
| `desktop/src/features/projects/ui/ProjectEntityListRow.tsx::ProjectEntityListRow` | 缺失需恢复（部分已补）；原显示分支／类名／响应式列与实际 peopleSlot 恢复，selection→Agent 控件未完成。 |
| `desktop/src/features/projects/ui/ProjectSelectableGroup.tsx::ProjectSelectableGroup` | 缺失需恢复（部分已补）；原标题／count／展开收起恢复，selection→Agent 组选择未完成。 |
| `desktop/src/features/projects/ui/ProjectsChannelsList.tsx::ProjectsChannelsList` | 缺失需恢复（部分已补）；完整真实频道读取／搜索／分组／导航闭合，原 Agent 参与者与 selection 上下文仍缺；HumanPrincipal 不能冒充 Agent。 |

未改原不可变差异快照；从同一 3313 路径表派生
`collaboration-current-20261008.projects-channels-classification.tsv`，只更新上述八行。
该派生表 SHA-256 `aaab73d6492c7ee49c40c91ad4b0995f9a193dc69a5d6d20d2acbdc9e6eec4c7`，
当前为共享迁移 **23**、已授权治理改造 **1**、缺失需恢复 **11**、未分类 **3278**；
合计 3313。这是原快照逐路径语义分类进展，不是新快照、全树逐处验收或功能完成率。
全仓尚未恢复总数仍未知，完整 Project 详情、Git/work-items/Terminal 等仍不能称已交付。

#### 实施后集中窄验／私有破坏恢复

仍在既有 `kailo-agent-receipt-xvkujx` 4 CPU／8 GiB SDK，镜像
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`；
开始前无编译进程、可用内存约 28 GiB／swap 0／Data 1755 MiB，已通知主线独占
开始和释放。没有以降低编译并发代替 cgroup。日志仍在上节同一受限 Data 证据目录。

- `projects-channels-first.log`：shared production/test tsc 通过；80 项初次 73 过／7 失败，
  新夹具错误使用 64hex 频道 ID，被原 UUID parser 正确拒绝。只修正夹具为 UUID。
  `projects-channels-positive.log` 后为 79 过／1 失败：资料面板刚挂载仍 Loading，
  改为等待真实返回资料文案，而非仅检查面板存在。
- `projects-channels-final.log`：shared production/test 两次 tsc 退出 0；原 Projects／
  Channels／快捷键集中 **80 passed**。旧 ChannelBrowser 专项 **3 passed／265 skipped**，
  无关页面未全跑。`projects-channels-hosts-final.log` Web tsc 通过，Native 实际发现
  data 可空与 goChannel 的 Promise<boolean> 类型；修正真实宿主空态及导航 false
  不报成功后 `projects-channels-native-final.log` Native tsc 退出 0。早期
  `projects-channels-hosts.log` 中 ../node_modules/.bin/tsc 路径不存在，已用真实 desktop
  安装目录执行，不将退出 127 当通过。
- 只在私有 SDK 副本破坏八处：搜索、排序、成员复读、Principal 头像 key、折叠、
  响应式描述列、floor 时间与频道映射唯一性；`projects-channels-private-negative.log`
  退出 1，**7 failed／5 passed**。这是联合故障检查结果，不声称每处独立故障已穷尽。
  全部六个被破坏文件重新从正式源码投递，`projects-channels-restored.log` 再次
  **80 passed**。正式源码未注入故障，检查日志保留原 React act 警告。
- 现有 Dart 生成及 `--check` 输出
  `PASS: Mobile platform and reason catalogs match the shared TypeScript source`；
  仅投递生成 platform_text.dart 的 52 行变化，reason_text cmp 未变；本批相关
  已跟踪路径 diff --check 退出 0。

本批二十路径及此回执尚未提交／部署／更新安装包，交主线阶段复核提交。全仓
`tools/check.sh --full` 本批未运行，由主线集中收口。无新增业务截图：十三张已开图
旧 live d313fb 仍只覆盖十一类页面及两状态；本批 Projects Channels 页面浏览器／
Windows／Mobile 验收为零。不能以类型通过、DOM 检查或旧截图代替新版视觉验收。

### 2026-10-08：侧栏原模块逐路径核对与正常会话边界

本节仅为已执行的源码与浏览器核对证据，没有修改上节冻结二十路径，也没有使用
主 SDK、编译、发布、安装依赖或重新导出百万行差异。固定官方仍为 Buzz
`779af8886caae1317b4de962082429867ab61503`。

| 固定官方完整路径／符号 | 实际核对结论 |
| --- | --- |
| `desktop/src/features/sidebar/ui/sidebarMenuHelpers.tsx::deferMenuAction/ContextMenuIconSlot` | 共享迁移；完整官方文件与 `client-kit/ts/platform/src/react/sidebar/sidebarMenuHelpers.tsx` 字节 cmp 退出 0；真实调用方为共享 channel-context-menu、channel-group、SidebarProjectsSection。 |
| `desktop/src/features/sidebar/ui/sidebarSectionStyles.ts::SECTION_ICON_BUTTON_CLASS/SECTION_ACTION_VISIBILITY_CLASS` | 共享迁移；完整官方文件与共享同名文件字节 cmp 退出 0；channel-group 和 SidebarProjectsSection 实际使用，不把一致文件计作已运行视觉验收。 |
| `desktop/src/features/sidebar/ui/AppSidebarPinnedHeader.tsx::AppSidebarPinnedHeader/AppSidebarPrimaryMenu` | 缺失需恢复；框架与菜单已共享，但原 TopbarSearch 的 browse/create-channel/create-agent/open-DM 生产／消费链不完整；原 Zap 工作流图标被更换，主菜单新增原文件没有的顶层 NewMessage。原完整菜单／快捷动作不能按“共享迁移”一票通过。 |
| `desktop/src/features/sidebar/ui/ChannelContextMenu.tsx::MoveToSectionSubmenu/ChannelContextMenuItems` | 缺失需恢复；当前共享 Copy、读状态、静音、收藏有两宿主真实消费者，原 Move-to-section、Leave、Archive/Delete及其能力加载／错误状态缺失；未复制上游无效回调或空权限来冒充完成。 |

基于上节同一不可变快照的派生表继续仅更新上述四行：
`collaboration-current-20261008.sidebar-classification.tsv` 位于原 Data 证据目录，SHA-256
`3ffbecb6f0bb76387163cdb14a68e9b66ee544f5ca31c3b3084cc7a3d9b6c66a`。
3313 路径当前为共享迁移 **25**、已授权治理改造 **1**、缺失需恢复 **13**、未分类
**3274**；差异表外原样保留 1980 文件保持原快照口径，不将分类当功能恢复率。

组件入口另外实查：Web `PlatformApp` 与 Native `AppSidebar` 真实消费共享
`NativeApplicationEntries`，按当前 ACTIVE／hasNativePage binding 返回的 capability
category 渲染；右侧实际消费共享 `NativeApplicationPage` iframe、批准 origin／generation
与正常独立服务认证。它不是固定 Buzz 本身已有的组件页面，因此不把这两个新治理
模块归为“官方原样页面”。本轮尚未业务登录三个服务或证明上传下载／撤权／跨组件
同步；Native Relay channel.id 与 Core workspace.id 的映射消费另已反馈主线，不能
因常见环境恰巧同 ID 就推定通用绑定成立。

`playwright-cli -s=kailo-ui-status snapshot` 实际仍在正常 IdP Sign in，未进行密码
投递、会话注入、重置或业务写入。截图
`.playwright-cli/kailo-ui-20261008-post-channels-session-expired.png` 为 1920×1080，
已打开逐图复核：只有用户名／密码登录表单。它不是新的业务页面验收；业务截图仍
为先前十三张旧 live d313fb，十一类页面与两状态。本节新的业务截图、Windows／Mobile
和三组件完整页面验收均为零，未用过期登录页补足逐页检查数量。

### 2026-10-08：Native 频道与组件入口消费真实 Workspace／Relay 映射

本批四个代码／检查路径 +234/-17 行：`client-kit/ts/platform/package.json`，以及
`collaboration/desktop/src/features/channels/hooks.ts`、同目录 `hooks.test.mjs`、
`collaboration/desktop/src/features/sidebar/ui/AppSidebar.tsx`。未修改上批冻结二十路径，
未新增契约、Core 路由、数据库、i18n 或另一份组件注册表。原页面布局与组件样式未动。

#### 权威、影响、副作用与确定边界

1. `DD-75`、`DD-80` 与既有通用 ApplicationBinding 接缝决定本批：原 Native 保持本机
   持钥直连 Relay，管理／目录与组件发现仍走 BFF。原固定官方 Buzz
   `779af8886caae1317b4de962082429867ab61503:desktop/src/features/channels/hooks.ts`
   的 `useChannelsQuery`／`refreshChannelsQuery` 签名列表、hash、快照与 recency 合并
   继续原样消费；原固定 `desktop/src/features/sidebar/ui/AppSidebar.tsx::AppSidebar`
   的共用侧栏内接已有治理组件入口，不以新菜单或替代页面补齐功能。
2. 实查 `core/crates/platform-core/src/platform_views.rs::discoverable_workspaces` 已返回
   Core `id` 与原 Relay `channel.channelId`；原 `list_workspaces` 的 `id` 不能当频道 ID。
   本次替换错误联接：`useWorkspaceChannelDirectory` 复用现有 `loadChannelDirectory`
   全分页／映射唯一性／scope 校验；`useChannelsQuery` 按 channelId 联接显示 visibility，
   `AppSidebar` 用 channel 路由的 Relay ID 或 application 路由的 Core ID 解析一次，
   向真实 `NativeApplicationEntries` 传 Core workspace.id。共享 query key 保留原
   workspaceVisibilityQueryKey 前缀，使现有 join 后失效继续成立，不复制业务权威。
3. 两消费者共用当前 community／relay／device／identity 范围的目录缓存，未知身份或
   device 不匹配关闭，pending／error／paused 不重用旧准入；迟到请求按原 AbortSignal
   与当前 scope 检查拒绝。只有 isMember 且 ACTIVE 且频道类型一致可显示公共频道。
   原生 DM 独立读取保持，不要求假 Workspace、不把 Relay 私密协议标志当产品 visibility。
   Core 与 Relay ID 偶然相同也不作为映射依据；不存在路由匹配时不回退另一命名空间。
4. 零目录／多页／读取失败／重复映射／未知枚举沿既有目录处理，撤权返回 REVOKING 即
   移除该 workspace 组件发现，旧 scope 不覆盖新 scope。目录只读无副作用，不新增审批、
   预留或在途业务状态；上传、工具、Temporal、额度与审计执行链未变。错误沿 `06` §4：
   认证／撤权 DENIED，缺能力 BLOCKED，缺映射 PRECONDITION，超限 LIMIT，重复映射
   CONFLICT，读取结果不明 UNKNOWN；不新增权威错误枚举或把未知显示为执行成功。
   字段／存储格式未变，没有旧数据迁移或旧格式双读。Web 已使用真实 Core workspace.id，
   本批未复制 Web 页面；Mobile 仍非组件宿主，未增加 WebView／组件菜单。

#### 实施后窄验与私有故障恢复

开始前检查无 Cargo／rustc／Dart／Vite／tsc 构建进程；host 可用约31 GiB、Data 1.4 GiB。
复用原 `kailo-agent-receipt-xvkujx`，cgroup cpu.max=`400000 100000`、
memory.max=`8589934592`，镜像仍为前节固定值，SDK开始／释放均已通知主线。
没有镜像构建、依赖安装、全树复制或全仓重复检查。日志位于前节同一 Data 证据目录。

- `native-workspace-ids-first.log`：原 hooks 专项 **14 passed／0 failed**。
- `native-workspace-ids-tsc.log`：Native `node_modules/.bin/tsc --noEmit` 退出 **0**。
- `native-workspace-ids-negative.log`：只在私有 SDK 副本同时破坏映射、准入、组件 ID 和
  新鲜度，**3 failed／11 passed**，退出1；未声称联合失败证明每处独立有效。
- `native-workspace-ids-membership-negative.log`：单独移除实际显示成员护栏，**1 failed**；
  `native-workspace-ids-fresh-negative.log` 单独移除 query 新鲜度，实际 Hook＋组件读取
  集成检查在 pending 复用旧目录处 **1 failed**。随后正式源码重新投递，cmp 退出0。
- `native-workspace-ids-restored.log`：原 hooks／channelSnapshot／focusRefetchPolicy 三个
  检查文件共 **33 passed／0 failed**。实际挂载 useChannelsQuery、目录 Hook 与原共享
  NativeApplicationEntries，证明多页仅一次查询、Core／Relay ID 碰撞正确分流、真实
  applicationBindings 读取 Core scope、pending／失败／撤权／scope 迟到关闭，签名缓存
  对象未被 visibility 覆写。没有把测试挂载当完整 AppSidebar 或 Windows 设备验收。

同一3313差异快照仅追加两条“缺失需恢复”归档，不把本次接缝修复当整个原文件一致。
固定原 `hooks.ts` 的 `useChannelDetailsQuery/useUpdateChannelMutation/useLeaveChannelMutation`
仍缺；固定原 `AppSidebar.tsx` 的 useChannelSections／CustomChannelSection／SidebarDndContext、
SidebarUpdateCard／HuddleProfileControl 及完整资料操作仍缺。派生表
`collaboration-current-20261008.native-workspace-classification.tsv` SHA-256
`1b0a6f7825cd56bad391d5499cb66633d8943df02d9f398828ba773378a5197d`；
当前共享迁移25、已授权治理1、已知缺失15、未分类3272，共3313，不是全量语义验收。

本批源码与回执交主线阶段提交，尚未部署／更新安装包；全仓 `tools/check.sh --full`
本批未跑，由主线集中收口。原正常会话过期，未新增业务截图；13张旧live d313fb
仅11类页面＋2状态，当前新源码业务截图／Windows／Mobile 验收仍为零。

### 2026-10-08：原 Primary Menu 与搜索真实图标消费者恢复边界

本批五个代码／检查路径 +151/-23：共享 `react/sidebar/app-sidebar-primary-menu.tsx`
与 `test/sidebar-shell.test.tsx`，Native `features/search/ui/SearchResultItem.tsx`、
`TopbarSearch.tsx` 与新 `SearchResultItem.test.mjs`。未修改主线冻结的二十个
ProjectsChannels 路径及四个 Native Workspace 映射路径。当前尚有三个冻结调用方的
`onNewMessage` prop 需在主线释放后最小删除，因此不是本批完整接线／可发布声明。

1. 权威为用户原版一致性红线与固定 Buzz
   `779af8886caae1317b4de962082429867ab61503:desktop/src/features/sidebar/ui/AppSidebarPinnedHeader.tsx::AppSidebarPrimaryMenu`：
   原版 Inbox 是首行，Workflows 用 Zap，不含顶层 NewMessage。本次共享菜单恢复这两处
   原实现；保留已有治理菜单与既有 DM 分区创建／快捷键，不改原页面、私聊路由或执行链。
   原固定 `desktop/src/features/search/ui/SearchResultItem.tsx::resultIcon` 的非 action 分支
   原样恢复；`TopbarSearch::renderSearchResultRow` 真实传入已有 channelLookup，读取实际
   forum／DM／human／agent 类型，不自行编造身份、owner、presence 或频道事实。
2. 检索五个 PrimaryMenu 调用方：两处 sidebar-shell 检查已同步，Web PlatformApp、
   Native AppSidebar 与 projects.test 的三处 prop 暂保持冻结。原 ConversationSidebar、
   DesktopConversations 与导航快捷键的 NewMessage 调用仍保留。Native 搜索唯一实际图标
   消费者已接回；它没有被声称为 Web/Desktop 全量共源搜索，Web 原搜索仍有缺项。
3. 修改只影响当前已读取数据的呈现与原导航，没有新路由、数据库字段、契约、权限权威、
   审批、额度、工作流或副作用。管理 BFF／Native 持钥 Relay 边界不变；空数据、缺频道
   映射的图标沿原 Hash，不能据此准入业务。未知／拒绝／结果不明的真实执行状态与
   `06` §4 六类错误链未改；没有新状态、旧格式兼容窗口或数据迁移。
4. 窄验覆盖真实建议列表 forum／DM 图标、点击导航、空频道映射、agent／human、身份
   selector，且回归共享 DM 创建与快捷键。没有给尚无生产者的原 action 添空回调或菜单。
   Mobile 不受本批影响，仍非组件宿主；没有 WebView、组件菜单或单独前端实现。

原 SDK 前置核对无活动 cargo／rustc／vitest／dart／tsc，host可用内存约31 GiB，Data
约1.3 GiB，memory PSI avg10=0；复用 `kailo-agent-receipt-xvkujx` 原4CPU／8GiB镜像
与缓存，cgroup cpu.max=`400000 100000`、memory.max=`8589934592`。仅机械投递五路径；
SDK占用／释放已通知主线，无新镜像、依赖安装或全树复制。日志仍在前节 Data 证据目录。

- `sidebar-primary-first.log`／`sidebar-primary-restored.log`：原 sidebar-shell、
  conversation-sidebar、navigation-shortcuts、channel-navigation-shortcuts 共
  **35 passed／0 failed**，实际 DM 分区创建与键盘入口仍通过。
- `sidebar-search-first.log`／`sidebar-search-restored.log`：原 Node loader 实际挂载
  TopbarSearch 建议行、核对原图标并点击 forum／DM 导航，共 **3 passed／0 failed**。
- 私有 SDK 单独把 Zap 换回 Workflow，`sidebar-primary-zap-negative.log` **1 failed／7 passed**；
  单独重新插顶层 NewMessage，`sidebar-primary-new-message-negative.log` **1 failed／7 passed**。
- 私有 SDK 单独把 forum 图标变 Hash，`sidebar-search-forum-negative.log` **2 failed／1 passed**；
  还原后单独把 DM 图标变 Hash，`sidebar-search-dm-negative.log` **2 failed／1 passed**。
  两次都包含真实 TopbarSearch 建议行失败，不只是 helper 断言。正式源码重新投递、两文件
  cmp均退出0，最终恢复后的35＋3项均通过。没有修改正式源码来制造故障。

当前未跑本批四侧 tsc／全仓 full：三个冻结 prop 尚未闭合，不以局部运行断言代替类型或
发布验收。固定 SearchResultItem 的原 action 类型／图标与完整 Shell／Body，TopbarSearch
的 channelLabels、DM／agent 分区、真实 browse/create动作、DM上下文及 icon variant 仍缺。
同一3313快照仅把上述两条从未分类记为缺失，派生表
`collaboration-current-20261008.search-classification.tsv` SHA-256
`442ea34cb60224a09853286fb0a93b7e65fe7619acdc80b815fc9e22ac21ee79`；
当前共享迁移25、已授权治理1、已知缺失17、未分类3270，共3313，不是全量语义验收。

本批未提交／部署／更新安装包。`playwright-cli -s=kailo-ui-status snapshot` 仍为正常
Keycloak Sign in，未投递口令、注入会话、重置账户或业务写入；新业务截图0，旧13张
live d313fb只覆盖11类页面＋2状态，不证明本批源码；Windows／Mobile本批验收0。

### 2026-10-08：Projects Channels／Native 映射／原菜单整批消费者闭合

主线释放上节冻结后，实际最小删除 Web `PlatformApp`、Native `AppSidebar`、共享
`projects.test.tsx` 三处 PrimaryMenu `onNewMessage` prop。原 ConversationSidebar、
DesktopConversations 与 useNavigationShortcuts 的 DM 创建调用均保留，没有删除私聊能力。
此前二十个 ProjectsChannels 路径、四个 Native 目录映射路径与五个原菜单／搜索路径
合为本次 **29代码／检查／生成路径 +1687/-93**；其中17跟踪路径+428/-93，十二新
文件1259行。只修改已归属路径，无新分支／worktree／契约／镜像或另一个 UI 主体。

权威与四步影响沿前三节，新增最小调用调整不改 scope、鉴权、额度、业务状态或副作用；
将先前等待冻结释放的类型接缝实际闭合，不表示 Projects／搜索所有原版缺项已恢复。
原4CPU／8GiB、uid1000 SDK开始／释放均通知主线，启动前 host可用内存31GiB、Data
约1.2GiB、memory PSI avg10=0，无活动cargo/rustc/vitest/dart/tsc，仅驻留BuildKit。
实际cgroup与镜像同上节，只投递29路径及两宿主已安装共享包的变更文件，未复制全树。

原Data证据目录下 `ui-consumers-batch-*` 为本次联合源码实际结果：

- `shared-tsc.log`、`shared-test-tsc.log`、`web-tsc.log`、`native-tsc.log`：共享
  production／test、Web、Native 四次 `tsc --noEmit` 均退出0，三处prop已无类型残留。
- `shared-restored.log`：Projects、Channels、侧栏、DM、导航快捷键和项目偏好七文件
  **106 passed／0 failed**；`browser.log` 原 ChannelBrowser **3 passed／265 skipped**。
  265为本轮无关页面明确未跑，不算全页面通过。原 React act 警告保留未隐藏。
- `native-restored.log`：真实频道 hooks、channelSnapshot、focusRefetchPolicy与搜索
  四文件 **36 passed／0 failed**，包括管理目录／组件发现消费者，而非 helper-only。
  首次 `native.log` 的两条路径误含不存在的lib目录，Node仅执行17项；沿rg找到实际
  文件后 `native-final.log` 与恢复日志均实际36项，不将早期17项冒称全组。
- `i18n.log`：原 `python3 tools/gen-platform-i18n.py --check` 退出0，实际输出
  `PASS: Mobile platform and reason catalogs match the shared TypeScript source`。
- `project-admission-negative.log`：仅在私有SDK移除 Projects 打开频道前的fresh成员
  校验，原真实撤权／详情消费者 **1 failed／11 passed**、退出1。
- `native-fresh-negative.log`：私有SDK独立移除目录pending／失败的新鲜度拒绝，真实
  Hook＋NativeApplicationEntries 在pending复用旧目录处 **1 failed／13 passed**、退出1。
  两文件从正式源码复投、cmp均0，恢复后106＋36全过；先前菜单／搜索四次独立故障
  与Projects／映射的原负向日志继续保留。正式工作树未注入故障。

整批29路径及本次回执冻结交主线完整diff复核、提交／push；截至交接尚未提交、未部署、
未更新安装包。全仓full留主线集中收口，本轮未跑。固定3313快照分类仍25共享／1授权／
17已知缺失／3270未分类，不作覆盖率。新业务截图、Windows及Mobile验收仍0；旧13张
live截图不是这批源码的视觉验收。既有完整原版缺项仍按前节明确保留，不声明100%。

### 2026-10-08：原 TopbarSearch 主体共源迁移与 Native 实际消费者恢复

此前29路径已由主线提交；本批另为 **34代码／检查／生成路径 +2524/-1698**，其中
19跟踪路径+264/-1698、十五新文件2260行，不含本节回执。删除的行是 Native 已迁入
共享的重复主体，并非删除产品能力。没有新分支／worktree／镜像／搜索权威。

1. 权威仍为用户原版一致性红线与固定 Buzz
   `779af8886caae1317b4de962082429867ab61503`。直接复用
   `desktop/src/features/search/ui/TopbarSearch.tsx::TopbarSearch` 的完整原展示主体、
   `SearchPromptPlaceholder.tsx::SearchPromptPlaceholder` 的五个原提示词与动画、
   `SearchScopeControls.tsx` 的输入／当前频道动作、`HighlightedSearchText.tsx`、
   `useSearchMenuKeyboardNavigation.ts`，以及 `lib/parseSearchOperators.ts`、
   `lib/searchMatch.ts`，迁入 `client-kit/ts/platform/src/react/search/`。
   `SearchResultItem.tsx` 只迁入有真实调用的结果类型／图标／key／selector；原
   SearchResultShell、ChannelResultBody、MessageResultBody 在固定树 git grep 只有
   定义无生产调用，本批没有新增死代码，也不将该文件声称为逐字节完整迁移。
2. 影响面检索覆盖 Native TopbarSearch、useSearchResults、两层 Sidebar、原 DTO、
   两宿主共享包与 CSS source 扫描。Native TopbarSearch 现在仅注入已有读 Hook 和
   rewriteRelayUrl，其他展示／parser 模块是共享 re-export，不再维护第二份页面。
   Channel／ChannelType／Visibility／Role、UserSearchResult 与 SearchHit 等原字段
   移入共享 `search/types.ts`，Native 只 import／re-export，未改 JSON Schema、
   序列化格式、数据库或版本兼容语义。原 buildDirectMessageIntro 迁入已有共享
   dm-participant-display，复用现有翻译 formatter。Web 尚无真实全局搜索 BFF
   生产者，本批不挂返回空数组的假引擎；共源可复用不等于 Web 已可用。
3. Native Sidebar 真实调用 useUsersBatchQuery 和 resolveChannelDisplayLabel，传入
   当前已授权目录的实际 DM 标签；浏览／创建频道接回现有 ChannelBrowser 与
   CreateChannelDialog 治理消费者，保留退出动画后的原 openAfterExit 顺序。
   没有新增 Relay 原始调用、匿名发现、第二 Agent 目录、权限或额度权威；Desktop
   持钥 Relay 与管理 BFF 边界不变。原 People 点击仍沿已有资料打开，不冒称原
   直接 DM；原 createAgent 没有治理消费者，未提供回调或伪造可用入口。
4. 六类原分区 channels／direct-messages／people／agents／messages／actions 恢复；
   DM 消息显示 Direct message 而非公开 #频道，DM 不显示频道描述；forum kind
   45003 不依赖 threadRootId 才识别为线程。保留真实目录 member/archive 约束与
   空查询建议排序、bar／icon、键盘／焦点、频道 scope 和标签匹配。空值、无事实
   的频道映射与无消费者动作不伪造事实；拒绝／错误仍沿原读链 fail closed，不
   把未知执行终态渲染成功。没有新执行状态、reservation、投影或待收敛业务数据。
   `06` §4 六类执行错误链未改；Mobile 非组件宿主边界不变。

共享 i18n 新增34条中英同源词条，含全部五个原提示词和错误／空态／分区；保持默认
中文。通过既有 tools/gen-platform-i18n.py 生成 Dart platform_text.dart，reason_text
无差异。两宿主 globals.css 均实际 `@source` 同一共享包，未另写搜索布局／样式。

仍复用原 uid1000／4CPU／8GiB SDK 与缓存，仅投递本批文件，不整树复制或装依赖；
开始／释放均已通知主线，终态无在途编译，memory.current=292667392、oom／oom_kill=0。
证据目录仍为
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/workflow-native-template.s3JDP1`。

- `topbar-search-final.log`：共享 `vitest run test/search.test.tsx
  test/sidebar-shell.test.tsx`，搜索12＋侧栏8，**20 passed／0 failed**。
- `topbar-search-native.log`：既有 Node loader 运行 SearchResultItem、searchMatch、
  parseSearchOperators、channelSearchScore 四文件，**42 passed／0 failed**；包含
  实际 Native TopbarSearch 建议行与导航，不只是 helper。
- `topbar-search-shared-tsc-final.log`、`topbar-search-shared-test-tsc.log`、
  `topbar-search-web-tsc.log`、`topbar-search-native-tsc-final.log`：共享 production／
  test、Web、Native 四次 `tsc --noEmit` 均退出0。
- `topbar-search-i18n.log`：显式复用已有 `/usr/lib/dart/bin/dart` 的 PATH，既有
  生成器生成与 `--check` 均通过，实际输出 `PASS: Mobile platform and reason
  catalogs match the shared TypeScript source`。没有安装或切换镜像。
- `topbar-search-dm-mutation.log`：只在私有 SDK 删除真实 DM 上下文分支，
  **1 failed／11 skipped**，报 `to contain 'Direct message'`，实际错误输出包含
  `Message in#Raw DM`；这十一项是明确本轮筛选未跑，不是通过。
- 独立还原后，`topbar-search-browse-mutation.log` 私有 SDK 将真实 browse 回调改为
  return，**1 failed／11 skipped**，报 `expected vi.fn() to be called once, but got
  0 times`。正式工作树没有故障改写；两次私有生产破坏均还原，最终 SDK 与正式
  源码 cmp退出0，恢复后的20项全过。原 Reduced Motion 警告保留，未隐藏。

初验失败如实保留：首轮提示词机械替换遗漏原第五词，产生 SEARCH_PROMPT_WORD_KEYS
未定义与11 failed／8 passed；核对固定原源码五词后修正。严格共享 tsc 随后发现
原正则捕获组／有界词条下标的可空推断，只按原已验证边界补非空类型；Native 首轮
tsc 报 ChannelRole 本地 import 缺失，补原类型 import 后最终通过。生成器首次因
登录 shell PATH 找不到既有 Dart 失败，恢复已有绝对路径后通过，不把失败冒充通过。

沿同一3313路径原快照派生
`collaboration-current-20261008.topbar-search-classification.tsv`，SHA-256
`16b54274b358babdcfeb1b029e67750544972d85cd907cf7fbaa1a039c3fe5fd`。
本批仅三条有完整调用证据的原 searchMatch／SearchPromptPlaceholder／SearchScopeControls
由未分类归共享迁移，useSearchResults 由未分类记已知缺失；TopbarSearch、SearchResultItem
与 PinnedHeader 更新局部恢复证据但仍归缺失，不用目录笼统归类。当前 **共享迁移28、
已授权治理1、已知缺失18、未分类3266，共3313**；仅47条已分类，不是完整语义验收。
1980条同路径字节相同在该变动表之外；3313仍是原快照，不冒称当前全树已再验收。

`playwright-cli -s=kailo-ui-status snapshot` 实际仍为正常 Keycloak 登录页；随后截图
`.playwright-cli/kailo-ui-20261008-search-session-expired.png` 已用 view_image 打开复核，
1920×1080 IdP 表单，而非业务页。没有传密／注入 Cookie／重置账号／业务写入；旧
13张 live d313fb 为11类页面＋2状态，不证明本批。新源码业务截图、Windows、Mobile
实际验收均0，未生成安装包／镜像／部署。本批全仓 full未跑，留主线集中收口。

官方完整缺项继续明确保留：Web 全局搜索真实 BFF／调用者、People 原直接 DM 消费者、
公共频道发现与合规 Agent 候选／归档事实、原 Agent 创建真实治理执行链，以及其他
原设置／菜单／页面与 Mobile 全量差异和视觉验收。本批不声称原版100%一致。
本批34路径及本节回执冻结交主线全 diff复核、提交／push；截至交接尚未提交／部署。

### 2026-10-08：原资料 Message 实际私聊消费者恢复

本批五路径 **+289/-44**，三生产文件与两检查文件；此前34路径搜索批未改。
不是重写资料页面：保留既有共享 ProfileSummaryView 的原 Message tile、原 pending
样式与 AuxiliaryPanel 承载，仅将“跳到空 compose”接回真实受治理私聊。

1. 权威是用户原版一致性红线、DD-80 与固定 Buzz
   `779af8886caae1317b4de962082429867ab61503`。该版本
   `desktop/src/features/profile/ui/useProfileInteractionActions.ts::handleMessage`
   实际执行 openDm → goChannel → onClose；
   `desktop/src/features/sidebar/ui/AppSidebarPinnedHeader.tsx::AppSidebarPinnedHeader`
   People 行实际 onOpenDm({pubkeys:[user.pubkey]})。当前资料原动作恢复前却只导航
   /messages/new，本批恢复前者；People 搜索两冻结宿主文件仍待主线释放接线。
2. 影响面检索覆盖共享 NewMessageScreen/useConversationOpen、Native 原资料面板、
   session 与频道缓存、Web/Native 两安装包共享入口和真实 ConversationVisibilityHost。
   在已有 use-conversations.ts 导出 useDirectMessageOpen，资料实际调用该同一引擎，
   不创建第二私聊注册表、权限判断或执行权威。无契约、数据库、迁移与持久格式改变。
   Web 同一共享输入经过类型检查，不代表 Web 已有 People 搜索实际消费者。
3. 原 pubkey 先经可信当前 session 与完整准入目录映射到唯一 principal，不按显示名、
   不把设备公钥当用户主键。所有分页走完，空值／歧义／自身／循环游标／目录约束变化
   都在 POST 前拒绝。沿原 conversation.open idempotencyKey、receipt、ACTIVE 读证据
   与本机签名可见性接缝执行；不走原未治理 open_dm，不共享身份，不复制消息正文。
4. accepted/UNKNOWN 保留原请求与参与者，未取得 ACTIVE 与可见性证据不能换目标、
   导航或关闭。同原请求重试保持同一 command；不明可见性写入先读权威快照，已可见
   不再重放。client/principal/visibility 替换或卸载使迟到目录、收据、读状态和签名
   返回失效；真实 owner 变化后不导航。六类执行错误沿原 BFF 处理，无新后台脏状态；
   额度／审批／撤权仍由既有治理链重验，客户端不把“已接受”当成功。Mobile 范围未变。

实现后复用原 uid1000／4CPU／8GiB SDK/cache，只投递五文件与两宿主已安装共享文件，
无新镜像、依赖安装或整树复制。开始前 host available 23637MiB、Data645MiB，SDK
memory.current79261696，CPU限额400000/100000、memory.max8589934592，无活跃编译。
结束无在途检查，memory.current299577344；oom/oom_kill=0，历史 max12244 原样保留。
证据目录仍为
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/workflow-native-template.s3JDP1`。

- `people-direct-shared-first.log` 与 `people-direct-shared-restored.log`：共享
  `vitest run test/new-message.test.tsx` 两次均 **25 passed/0 failed**，退出0；
  包括原 compose18项及新增直接消费7项，实际分页、公钥映射、UNKNOWN原请求、
  ACTIVE后切目标、可见性不重放与旧身份迟到返回，不是只检查 helper 文本。
- `people-direct-native-first.log` 与 `people-direct-native-restored.log`：既有 loader
  执行 UserProfilePanel.test.mjs，两次均 **6 passed/0 failed**，退出0；原真实
  Message tile 到实际 /channels/actual-native-channel，accepted未确认不导航／关闭，
  同时保留原资料拒绝、自身及跨scope旧返回检查。
- `people-direct-shared-tsc.log`、`people-direct-shared-test-tsc.log`、
  `people-direct-native-tsc.log`、`people-direct-web-host-tsc.log`：共享 production/test、
  Native、真实 web-client/web 四次 tsc --noEmit 退出0。最初误将最后一条命令指向
  collaboration/web，无安装的 tsc 而退出127（people-direct-web-tsc.log），已纠正
  到实际 Web 宿主与既有缓存，不把该失败当通过。没有新增词条，不需重生成 Dart。
- `people-direct-ambiguity-mutation.log`：仅私有 SDK 将唯一映射改为允许歧义，
  检查实际退出1，**1 failed/24 skipped**，报 ready “actually been called 1 times”。
- `people-direct-close-mutation.log`：独立私有 Native 生产消费者故意在确认前 onClose，
  实际退出1，**1 failed**，报关闭次数 `1 !== 0`。两处故障均还原，cmp正式源码退出0；
  还原后的25＋6整批通过。正式工作树未故障改写；git diff --check退出0。

按实际固定源码符号新增两条“缺失需恢复”，没有将局部 Message 恢复冒充整资料面板。
沿同一3313原快照机械派生 `collaboration-current-20261008.people-direct-classification.tsv`，
SHA-256 `63733d673520c37c5cae27c709d6deb5a7e03c33b453fc478f38fc187aa43857`；
旧 Topbar TSV 原样保留。现 **共享28、授权1、缺失20、未分类3264，共3313**，只有
49条已分类，1980条同路径字节相同另计，不能声明全量语义验收或原版100%一致。
UserProfilePanel 原完整 tabs/sections、Agent管理与 useProfileInteractionActions 原
huddle/wave／Agent-owner约束仍缺；Web 搜索真实BFF/消费者与其他旧缺项不因本批删除。

本批未启动登录／截图／发布，没有安全可用的新会话；当前只有正常IdP登录截图，旧
13张live图不证明新源码。新业务截图、Windows、Mobile实际验收均0，未构建安装包、
镜像或部署。全仓full、全Web/browser与Native全套未跑，交主线集中收口。本批五路径
与本节回执冻结交主线；截至交接尚未提交／push／部署，不把源码与局部检查当可用发布。

### 2026-10-08：原 People 搜索实际私聊消费者闭合

本次将前34路径搜索与五路径资料私聊合为同一 **39路径，+2983/-1748** 交付批，
含24个已跟踪修改与15个原搜索模块共享迁移新文件；不含本文件证据增量。不是新增
People 页面或替代布局。只在已释放的 AppSidebarPinnedHeader、AppSidebar 与既有
SearchResultItem.test.mjs 接完原消费者，其他冻结字节不动。原92＋67行回执原样保留。

1. 权威仍为固定 Buzz `779af8886caae1317b4de962082429867ab61503`、用户原版一致性
   红线和 DD-80。该版本 `desktop/src/features/sidebar/ui/AppSidebarPinnedHeader.tsx`
   的 `AppSidebarPinnedHeader` 原 onOpenUser 调用 onOpenDm({pubkeys:[user.pubkey]})；
   当前同一原回调已恢复，不再错误打开资料或空 compose。原 search/Sidebar 组件、
   className、People 行、菜单与点击交互不另造设计，必要执行改走既有 Kailo 治理。
2. 检索影响面为共享 TopbarSearch、Native useSearchResults/PinnedHeader/AppSidebar、
   useDirectMessageOpen、真实 session/参与者目录与 ConversationVisibilityHost，以及
   channelsQueryKey 的实际导航缓存。AppSidebar 消费 currentPrincipalId 与已有共享
   私聊引擎，完整可信身份映射、原 action/idempotency、ACTIVE 和可见性确认后才导航。
   Native 本机持钥与 BFF 管理边界不变，无 Core/契约/数据库/持久格式/词条新增。
3. 结果未知只显示既有中英文 dm.unknown，不导航或当成终态失败；重试保留同一原
   command。空 principal、公钥歧义、目录分页异常和撤权沿已有引擎拒绝，额度/审批
   由既有治理链处理，不建立第二份执行或权限权威。频道缓存失效前后分别检查
   Native community/身份 owner，切换或卸载后迟到返回不改变当前页面。
4. 共享 compose、资料 Message 与 People 使用同一个准备引擎。Web 尚无完整全局
   搜索真实 BFF/消费者，本次没有伪造 Web People 入口；Mobile 非组件宿主边界不变。
   原 create-Agent、完整资料 tabs/Agent/huddle/wave 与旧侧栏缺项继续明确记缺失。

集中窄验复用既有 SDK/cache，无新镜像、安装或整树复制。Root Core 终态释放 SDK
后仅投递检查文件；前置 CPU限额400000/100000、memory.max8589934592、
memory.current1298702336、oom/oom_kill=0，无在途 Cargo/tsc。另有76个 dart:test.dart-
通讯名，未猜来源或终止。本人 Node 全终态后立即释放 SDK给主线，
memory.current1136697344、oom/oom_kill仍0；历史 max12244 原样保留。
下列实际日志仍在同一 `workflow-native-template.s3JDP1` 证据目录：

- `people-search-native-tsc-final.log`：实际 Native tsc --noEmit退出0。首轮
  people-search-native-tsc.log 因旧 translate/resolveLocale import 替换后漏一调用
  报 TS2304，已改同源 translateCurrent，不改变文案；该失败不记通过。
- `people-search-consumer-correct-limit.log`：既有 Node loader实际挂载完整 AppSidebar、
  原 PinnedHeader/TopbarSearch 与 People 行，**5 passed/0 failed，退出0**。实际点击
  经过可信目录向既有 BFF发送一次原 conversation.open，ACTIVE后导航真实 channel；
  UNKNOWN不导航，并在再次原 People 点击时复用原 command。
- `people-search-original-callback-mutation.log`：仅私有 SDK生产 PinnedHeader 将
  onOpenUser改成 no-op，真实点击检查 **1 failed，退出1**，未达到实际导航。
- 独立还原后，`people-search-unknown-navigation-mutation.log` 私有生产 AppSidebar
  故意确认前导航，UNKNOWN检查 **1 failed，退出1**，报实际
  ['unconfirmed-private-negative'] 与期望 [] 不等。正式生产未被故障改写。
- 还原三项 SDK输入与正式源码 cmp均退出0；`people-search-native-restored-final.log`
  同一批原 channelSearchScore/parseSearchOperators/searchMatch/SearchResultItem 与
  UserProfilePanel五检查文件 **50 passed/0 failed，退出0**。git diff --check退出0。
  先前共享20、直接私聊25、资料6与四侧 tsc/i18n证据仍见前两节，不重复全仓构建。

初验 fixture失败如实保留：people-search-native-first.log为48通过/2失败，缺 JSDOM
self；consumer-first缺 IntersectionObserver；consumer-dom-complete与input-diagnostic
使用旧缓存 limit12，触发未提供宿主 invoke。核对固定原 TopbarSearch 的封闭
SEARCH_RESULT_LIMIT=40后只修正检查缓存键，consumer-correct-limit才实际通过；没有
修改生产阈值、给 invoke加旁路或把 fixture失败冒充业务失败/通过。

沿原3313快照派生 `collaboration-current-20261008.people-search-classification.tsv`，
SHA-256 `80062e892c1c0c46c502e8d01b1502d406825f7827bcd26faee5b359edf20b67`。
只更新三条实际消费者证据，仍 **共享28、授权1、缺失20、未分类3264，共3313**；
49条归类不是全量验收。旧派生文件未改，不以局部 People闭合将整个侧栏记已恢复。
本轮未重新登录/截图、构建安装包、发布镜像或部署；新业务截图、Windows、Mobile
验收均0，旧13张 live图与正常IdP截图不证明本批。全仓full、原版全量视觉与设备
验收未跑。39路径及本批三节回执冻结交主线统一复核提交，交接时未提交/push/部署；
不声称100%还原或生产就绪。

### 2026-10-08：原资料 Message 的两宿主真实消费者闭合

本批只改十路径：共享 members.tsx/test、Native PulseScreen.tsx/test.mjs、Web
PlatformApp.tsx/test、MessageAuthorProfile.tsx/test、PulsePane.tsx/test；八个已跟踪
文件 +234/-35、两个实现后检查新文件188行，合计 **十路径 +422/-35**，不含本节。
前39路径与本文件前3052行保持冻结，未把本批混入此前搜索交接。

1. 权威为用户原版一致性红线、DD-80 与固定 Buzz
   `779af8886caae1317b4de962082429867ab61503` 的
   `desktop/src/features/profile/ui/useProfileInteractionActions.ts::handleMessage`：
   原行为是 await openDm、await goChannel、再 close，runAction 保留 pending/error。
   本批沿现存原 ProfileSummary Message tile 与完整 Pulse/Profile 实际消费者恢复
   这条交互，不新建页面、按钮或替代布局，不宣称整资料页原样完成。
2. 影响面检索覆盖 Web Inbox、Channel、Forum、privateConversation、Members、Pulse
   六个实际资料直聊调用方及 Native Pulse。Web 统一使用当前可信 session actor 的
   useDirectMessageOpen，再刷新已有 conversations 并导航已确认的 conversation；
   删除无实际消费者的 initialRecipientPubkey 影子状态，保留原独立 NewMessage。
   Native Pulse 同样消费既有平台 session actor、治理私聊引擎、channelsQueryKey 和
   真实 channelId 导航，不再把资料 Message 错误导向 compose。无 Core/契约/数据库/
   格式迁移/新词条；Desktop 本机持钥读 Relay、管理面 BFF 与 Mobile 边界均不变。
3. 未另建身份、目录、权限、执行或会话权威。实际 pubkey→Principal 唯一映射、完整
   分页、可信 actor、action/idempotency、ACTIVE 与可见性仍由原共享引擎负责。
   Profile/Member 真正 await 回调，pending 期间不关闭；accepted 结果未确认时保留
   原资料面板与既有 dm.unknown 文案，不导航、不给终态成功或失败。原 Promise
   拒绝不会被宿主 catch 后吞成成功；切换作者、scope、session 或卸载后的迟到返回
   不关闭新目标、不导航新页面。普通父组件 rerender 不清除实际进行中的 pending。
4. 空 actor/目录歧义/撤权仍拒绝；重复点击由原引擎及当前目标 busy 收敛，UNKNOWN
   重试沿同一原 command，不重复副作用。额度、审批、generation、暂停及 readiness
   交既有治理链处理，不在 UI 猜终态。沿 06 §4 保留 DENIED/BLOCKED/PRECONDITION/
   LIMIT/CONFLICT/UNKNOWN 既有分类，本批不新增 reason code；huddle/wave、Agent
   owner/runtime、完整 Agent tabs 等缺实际生产者的能力没有生成假按钮或事实。

集中检查复用原 SDK/cache：kailo-agent-receipt-xvkujx，memory.max8589934592、
cpu.max400000/100000、uid1000。起跑 memory.current1065431040、oom/oom_kill0，
宿主 available约30GiB、memory PSI avg10/avg60为0，无在途 Cargo/tsc/Node检查。
只机械投递十输入，未建镜像、安装依赖或复制整树。终态 memory.current324411392，
oom/oom_kill仍0、历史max12244未变，无在途编译/Node检查，SDK已释放主线。
日志在 `/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/` 下
`workflow-native-template.s3JDP1/`，以下均为实际运行终态：

- `profile-dm-web-final.log`：原 Vitest 挂载六个真实宿主回调、原资料 tile 与实际
  Pulse/Profile，**37 passed，退出0**。最初 profile-dm-web-first.log为35通过/2失败，
  JSDOM缺原虚拟列表尺寸；只在检查沿已有Members测量fixture补尺寸后通过，未改生产
  布局/阈值。React act警告原样保留，不当作业务验收或隐藏失败。
- `profile-dm-shared-final.log`：原 members/Pulse/directDM 三文件 **47 passed，退出0**。
- `profile-dm-native-first.log`：原 Node loader实际挂载Native PulseScreen与完整共享
  Pulse/Profile Message，ACTIVE导航真实channel、UNKNOWN不关闭/导航、Community
  切换后迟到确认拒绝导航，**3 passed，退出0**，未mock关键动作处理器。
- `profile-dm-shared-tsc.log`、`profile-dm-shared-check-tsc.log`、
  `profile-dm-web-tsc.log`、`profile-dm-native-tsc.log`：既有四个 production/test
  tsconfig 的 tsc --noEmit 顺序运行，全部退出0，未重复全仓编译。
- 私有SDK实际生产故障：PlatformApp提前导航、Web Pulse与资料/Member去掉await、
  Native Pulse去掉await后的scope fence；正式源码未被破坏。原检查分别在
  `profile-dm-web-production-mutation.log` **10 failed/退出1**、
  `profile-dm-member-production-mutation.log` **2 failed/退出1**、
  `profile-dm-native-scope-mutation.log` **1 failed/退出1**，抓到假导航、假关闭和
  跨Community迟到导航，不是破坏检查后制造必然失败。
- 私有生产全部还原，十输入与正式源码cmp均0。还原后顺序重跑日志
  `profile-dm-web-restored.log` **37 passed**、`profile-dm-member-restored.log`
  **11 passed**、`profile-dm-native-restored.log` **3 passed**，整组退出0。
- 本批十路径 `git diff --check -- <十路径>` 退出0。当前全仓 diff --check退出2：

  既有未提交文件 InlineEmojiPopover.tsx:106、custom-emoji/emoji.ts:118、
  messages/editAttachments.ts:192、messages/parseImeta.ts:66各报新增EOF空行；这些不在
  本次冻结49路径内，未修改其字节，不把本批目标通过冒充全仓通过。

沿原3313快照仅派生 `collaboration-current-20261008.profile-consumers-classification.tsv`，
SHA-256 `1c4831edbc336e699fa868e26422a8bd3b8ce64b998f78f9944887dbeb937ccc`，
在同一日志目录。只更新原 useProfileInteractionActions 对应真实消费者证据；该行
因 huddle/wave/Agent-owner未全闭合仍标缺失。**共享28、授权1、缺失20、未分类3264，
共3313，只有49条已分类**，1980同路径字节相同另计，不是当前全量语义验收。
Web全局搜索真实BFF、完整Profile/Agent与其他原版缺项仍保留，不宣称100%。

本批未登录/新截图/打包/部署：新业务截图、Windows、Mobile实际验收均0，旧13张
live d313fb截图与正常IdP过期登录图不证明新源码；全仓full、全量视觉及设备验收未跑。
十路径及仅本节回执冻结交主线统一review/提交/push，交接时未提交、未部署。

### 2026-10-08：原全局搜索的共享 Web 消费者与 BFF 接线（未完成后端验收）

本批写入34路径：20个无继承重叠的已跟踪路径 +299/-430、九个新路径1182行；
main.rs 只新增 mod search 一行，四侧既有 roundtrip 文件仅各追加本查询检查
（Rust11、Go25、TypeScript6、Dart13行）。格式整理后净归属 **+1537/-430**，不含本节；
main.rs 的 custom_emoji 移位及四侧 roundtrip 的其他修改属于继承工作树，未覆盖。
上述数字以主线选定的入库差异为准，不把继承的删改混入本批。

1. 权威为 REQ-24、DD-39、DD-75/78 与既有 V-REQ-24/collab.channel.message。
   官方基准固定 `779af8886caae1317b4de962082429867ab61503`，直接复用
   `desktop/src/features/search/useSearchResults.ts::useSearchResults` 的 operators、
   debounce、排名及选中逻辑到共享 createSearchResultsReader，Native保留真实本机
   hook适配，Web注入原BFF读链。原TopbarSearch及其结果/分区/样式没有另建第二份。
   原 `desktop/src/app/useAppShellKeyboardShortcuts.ts::handleKeyDown` 的F/K语义
   移到共享 useSearchShortcuts，Home/create/browse/DM继续已有共享消费者。
2. 影响面覆盖 Web PlatformApp、原共享Topbar/reader/types及Native wrapper，新增
   WebSearchQuery schema、sample与四侧生成。Web只发送q/channelId/authors/time/limit，
   不持钥、不构造raw Relay filter。Core search.rs复用既有IdentityClient::query与
   Relay FTS，不新增搜索索引、目录、权限或消息权威；正文仅授权读过境、不落Core。
   原 `desktop/src-tauri/src/commands/messages.rs::build_search_messages_filter` 的
   search_mode=prefix及四种kind9/40002/45001/45003保持；原
   `desktop/src-tauri/src/nostr_convert.rs::search_response_from_events` 的顺序/score
   与found仍由同一结果推导。新查询为新增API，没有数据库/持久状态迁移。
3. 准入不以目录命中或admin代替读取：Core从同Tenant ACTIVE binding解析真实频道，
   Workspace必须本人ACTIVE成员、DM必须本人参与，并逐资源调用现有ReadTarget。
   搜索前后复读session、tenant、actor、SERVER身份、binding及实际返回资源准入；
   验签/重复/未知kind/跨频道/过滤漂移拒绝。浏览器结果点击先刷新真实目录，将原生
   channelId映射到实际workspace.id或ACTIVE conversation.id，保持原消息/线程focus。
   不假定ID相等、不造DM参与者pubkey/归档时间/Agent owner。无新增写动作或副作用。
4. 空合法范围只返回真实空结果，未知/不完整/歧义目录不伪装成功空列表；scope切换
   或卸载后的迟到结果拒绝使用，fresh撤权与binding漂移失败关闭。限额与frame大小
   取现有运行期NIP11/BFF配置，不新增硬编码阈值。读超时/错误沿既有六类错误与原
   搜索错误UI，不触发写入或重放；客户端聚合people/profile/目录读取错误而不降级。
   原Agent搜索/身份归档、Native公开频道目录消费者及资料名FTS完全等效仍有缺口；
   huddle无实际治理消费者，不生成空快捷动作。Mobile边界未变，未新增组件宿主。

实际执行复用原SDK `kailo-agent-receipt-xvkujx` 与缓存，uid1000:1000、4CPU、8GiB，
memorySwap同上限。前置无在途工具链，memory.current558104576、oom/oom_kill0，
Data261MiB。只投递本批文件及两宿主已有@client-kit物理依赖副本，没有新镜像、
安装依赖、整树复制或全仓构建。日志仍位于
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/`
下 `workflow-native-template.s3JDP1/`，终态如实记录：

- `web-search-four-gen.log`：原 tools/gen.sh退出0，四侧生成共108行；原i18n生成
  副作用与正式生成词条cmp0。`web-search-registry-gen.log`：原registry生成退出0，
  新搜索路由登记到现有collab.channel.message。同步--check及兼容比对本批尚未运行。
- `web-search-shared-tsc-final.log`、`web-search-web-tsc-final.log`、
  `web-search-native-tsc.log`及TS contracts tsconfig.test检查均退出0。第一次shared
  tsc存在可空participants闭包错误，改为实际局部引用后通过；第一次Web检查缺少
  候选物理包新出口及一个Pulse view枚举，准确投递/使用既有枚举后通过，没有装包。
- `web-search-web-restored.log`：Web BFF20、实际Web Topbar6、PlatformApp29，
  **55 passed，退出0**。首次web-search-web-first.log为54通过/1失败：检查只有
  root没有reply tag，不符合原getThreadReference；补原真实tag形状后通过，未改
  原解析器迎合检查。Reduced Motion警告保留，不冒充图像/浏览器验收。
- `web-search-shared-final.log`：原search12/new-message25，**37 passed，退出0**。
  `web-search-native-consumers.log`：实际Native原结果/People ACTIVE/UNKNOWN消费者，
  **5 passed，退出0**。没有把JSDOM或Node挂载说成Windows设备验收。
- `web-search-ts-roundtrip.log`、`web-search-go-roundtrip.log`、
  `web-search-dart-roundtrip.log`：原四侧roundtrip文件新增查询样例，TS/Go/Dart各1
  项通过/退出0，包含可选字段缺省与since=0；Rust尚未通过，不能称四侧已全部验收。
- 私有候选实际生产破坏：移除BFF重复event护栏、把PlatformApp workspace导航改成
  错误nativeID，原检查在 `web-search-production-fault.log` 实际 **3 failed/退出1**。
  两文件恢复后与正式源码cmp0，再跑 `web-search-web-restored.log` 55通过/退出0。
  没有破坏检查制造假失败，正式生产文件未被破坏。
- 随后对固定官方源码复核发现本批原kind遗漏：先前只包含9/40002，会丢论坛搜索。
  已将Core和Web消费者修正为原四种kind，并在既有BFF检查追加两个论坛结果用例；
  最终 `web-search-web-forum-final.log` 已实际重跑原三个目标，BFF22/Topbar6/
  PlatformApp29，**57 passed/退出0**；不再用修正前55充作最终字节验收。
  `web-search-shared-tsc-forum-final.log`、`web-search-web-tsc-forum-final.log`、
  `web-search-native-tsc-forum-final.log` 三个最终宿主类型均退出0。此次仅低写入Node，
  无Cargo/Go/Dart/生成/镜像；实际前后Data均153MiB、oom/oom_kill0，终态没有在途
  工具链，SDK再次释放。34个正式输入与候选逐文件cmp均0；Core仅同步未编译。
- `web-search-rust-roundtrip.log`：cargo test -p contracts --test roundtrip
  web_search_query_preserves_original_operators_and_optional_absence -j16 --offline
  只到Compiling contracts。主线通知同盘空间骤降后立即中止，exec71268终态130；
  cargo304918/rustc304925与shell304912复查均不存在，Data当时169→155MiB。
  不将停止写成通过，未启动Core check/链接、SQL/HTTP或full，不清理/移动缓存。

沿原3313快照只派生 `collaboration-current-20261008.web-search-classification.tsv`，
SHA-256 `b62f042cbaa7778a0b9cf97511e6f7e16cb1e44f6dfed762526dad7e58db2027`，
在同一日志目录；列为upstream_commit/path/change_kind/category/destination/evidence/
added_lines/deleted_lines。仅新核对快捷键一条及更新搜索hook证据，两者因明确缺项
仍标缺失：**共享28、授权1、缺失21、未分类3263，共3313，50条实际归档**。
1980同路径字节相同另计；这不是当前全量语义验收或100%恢复。

本批34路径尚未提交/push/部署、安装包未更新；源码是真实接线但后端尚未验收，
不开放为完成声明。没有新业务截图，Windows/Mobile验收均0；旧13张live d313fb
和最近Keycloak登录页不证明本批源码，全部页面/关键状态截图仍未完成。

#### 主线收口的格式与生成同步补核

主线在同一受限SDK及原候选执行 `rustfmt --edition 2021`，只格式化本批
search.rs；四侧roundtrip只整理本批新增查询用例的格式，不吸收继承删除和旧格式
变化。无Cargo编译、依赖安装或镜像构建。原 `tools/gen.sh --check` 使用已存在的
离线npm缓存与Data临时目录，实际退出0；`web-search-four-sync-root.log` 记录
rs/Go/TypeScript/Dart均同步，Mobile同源词条同步。该候选只含本搜索schema，
不混入队友后续新增的file_storage.delete契约。

以上补核替代前文“同步--check尚未运行”，不替代Rust roundtrip、Core类型/SQL/
HTTP、相对发布tag的兼容检查或全仓full。根复核完整选定diff，阶段入库只包含
本批34路径、下一节Agent五路径及两批新增回执；继承main.rs移位、roundtrip旧
删除、pages旧删除及本文件旧段落删除均不纳入。部署与安装包仍未更新。

### 2026-10-08 原 Agent identity-card 实际消费者与全量九路径核对

本节只记录实施后证据，不新增规格或把整个 Agent 页面标为完成。权威为
DD-24/25/26、DD-45、REQ-24 与用户固定官方原样恢复要求；版本正文仍归既有
Asset 读授权，安装仍固定原 Version，不恢复本机另一套 Agent registry/runtime。
固定源码为 Buzz `779af8886caae1317b4de962082429867ab61503`：
`desktop/src/features/agents/ui/UnifiedAgentsSection.tsx::{AgentPersonaCard,LoadingSkeleton}`、
`desktop/src/features/agents/ui/AgentIdentityCard.tsx::AgentIdentityCard`、
`desktop/src/shared/ui/identity-card-skeleton.tsx::IdentityCardSkeleton`、
`desktop/src/features/agents/lib/agentDescription.ts::effectiveAgentDescription`。
全部原文件已逐文件读及对照目的地，不把目录或此批几个改动当全树恢复。

影响面为既有 shared `AgentDefinitionsPage` 两宿主实际消费及原 Agent 验证；
不改 schema/数据库/Workflow/API/运行开关/凭据，不产生新持久状态或外部写入。
源码五路径 owned **+230/-10**：agents.tsx +38/-9、agentDescription.ts +8/-0、
原 identity-card-skeleton.tsx 新增46行、agent-library.test.tsx 新增137行，
pages.test.tsx 仅“Definition ready”断言 +1/-1。pages.test.tsx 的继承 +1/-45
不属于本批，不能整文件取其工作树差异冒充本批交付。

- 定义卡片真实读取 currentPublishedVersionAssetId，经原 `client.agentVersion`，
  校验 exact assetId/agentResourceId/PUBLISHED 与既有 Version 内容后展示原
  Persona 名称、作者描述、头像；删除无上游依据的 slug 副标题及固定 ready badge。
  未发布时只用已授权 Definition 名称/原 initials，不编造描述、模型或运行状态。
- 安装卡片仍消费 exact pinned Version；未知/越权/不匹配不借最新版本补身份。
  原作者描述 trim/空值行为恢复，不再用 resourceId 填原描述栏；原头像 host 只
  消费当前授权 Version 的既有 media projection。目录及版本 pending 直接复用
  原 identity skeleton、原三卡及 w-14/w-24、w-20/w-32、w-16/w-28 footer 宽度。
- 刷新重读原目录及 exact Version；原 useLoad key/round 抛弃旧回应，替换 client
  由原 PlatformProvider 重挂载；拒绝/不明读取仍由原 ReadFailure 区分，不当作空。
  原治理动作与 UNKNOWN 冻结意图未改变，检查证明身份展示不发 POST。
- 查到底层后纠正一处候选错误：`core/crates/platform-core/src/web_transport.rs`
  `member_profile_identity` 明确只准 HUMAN，不能给 AGENT 资料消费。曾写入的
  AGENT memberProfile 调用及临时 helper 已删除，不放宽 SQL、不造新端点、不用
  mocked profile 宣称生产者存在。实际 AGENT kind:0 profile 优先仍登记缺失；
  此前 agent-library-consumers-final/restored-final 等候选日志不算最终字节验收。

沿既有4CPU/8GiB、uid1000:1000 SDK/cache，仅小文件投递，正式五输入及两宿主
物理包消费者逐文件 cmp 均0，无整树复制/安装/镜像/Cargo/Go/Dart或生成。前置查
无编译进程，memory.current约1.16GiB、oom/oom_kill0，Data156MiB；终态无工具链
进程，memory.current约1.17GiB、oom/oom_kill0，Data154MiB，SDK已释放。
日志均在既有 `workflow-native-template.s3JDP1` 目录：

- 最终 `agent-library-final-consumers.log`：原真实共享页面+BFF读请求 **81 passed**；
  private实际生产破坏：去掉 published/pinned 两处 exact Asset/Definition 护栏，
  `agent-library-final-production-fault.log` **4 failed、退出1**，实抓身份/头像泄露。
  恢复生产文件且 cmp0后，`agent-library-final-restored.log` 再 **81 passed、退出0**。
  200项按本次 -t 明确未运行，不称全包/full；保留 JSDOM scrollTo 未实现提示。
- `agent-library-final-shared-tsc.log`、`agent-library-final-test-tsc.log`、
  `agent-library-final-web-tsc.log`、`agent-library-final-native-tsc.log` 均退出0。
  这是类型与挂载消费者证据，不替代真实后端 HTTP、浏览器或 Windows 验收。
  本批未跑 `tools/check.sh --full`、Rust/SQL、发布和安装包。

同一3313快照派生 `collaboration-current-20261008.agent-library-classification.tsv`，
SHA-256 `c0a3eba2c01cdf90b6f5c060fcd038a76ad8af409bcf9d2f7bfda1e648174d8e`，
列仍为upstream_commit/path/change_kind/category/destination/evidence/added_lines/
deleted_lines。九条原 Agent 路径逐项归档后：**共享33、授权1、缺失25、未分类3254，
共3313，59条已归档**。1980同路径字节相同另计；归档不等于逐页面业务验收。
原 UnifiedAgentsSection、agentCardAvatar 和其原检查保留缺失分类：实际 Agent
profile、runtime grouping/model label/运行控制/persona动作/完整profile尚未闭合，
不把卡片身份恢复宣称整个模块完整或“100%还原”。

Playwright实际复查 header-restoration/kailo-visual-release 均正常转到 IdP 登录页，
`.playwright-cli/kailo-ui-20261008-agent-library-session-expired.png` 已截图并打开
确认；没有注入会话、重置账户或输出凭据。新业务截图仍0，旧live d313fb的13图
不能证明本批；Web业务视觉/Windows/Mobile均未验收。本批尚未提交/push/部署，
五源码路径与本节冻结交主代理，原搜索34及其89行回执未改。

### 2026-10-08 原 Profile 头像编辑与 Native 真实资料消费者

本节为实现后证据；权威是 REQ-08/24、DD-75、设计09 §3「宿主用户资料与头像」
以及用户固定官方原样恢复要求。固定 Buzz
`779af8886caae1317b4de962082429867ab61503` 已逐文件核对：
`desktop/src/features/settings/ui/ProfileSettingsCard.tsx::ProfileSettingsCard`、
`desktop/src/features/profile/ui/ProfileAvatarEditor.tsx::ProfileAvatarEditor`、
`desktop/src/features/profile/ui/ProfileAvatarModeTabs.tsx::ProfileAvatarModeTabs`、
`desktop/src/shared/ui/segmented-control.tsx::SegmentedControl`；未把目录直接标为一致。

影响面为 shared 原资料 Card/头像 Editor/模式控件、两宿主实际 Card、Native 资料
query/mutation 与 SidebarProfileCard 既有离线头像消费；Web 继续经 BFF 代签/上传，
Desktop 继续本机签名及原 Tauri IPC。只增加同源五条中英文展示词条并由原脚本生成
Dart，不改 schema/数据库/Workflow/API/运行开关或密钥保管，不建另一份用户资料权威。
本批12源码/检查路径 **+471/-90**（11已跟踪+233/-90，新Native检查238行）；本节
只追加owned证据，不吸收本文件的继承删除。

- 原 Card 的 `profileQuery.data` 是响应式资料，而共享迁移曾将首个 prop 固定在
  useState；现保留当前 canonical save 的回读显示，并消费后续同身份 host 资料。
  另设备更新的未编辑字段同步、已编辑草稿保留，较新的 host 资料不被旧 save 回执
  覆盖；原 Edit/Done、预览、过渡、清空限制、稳定意图与 UNKNOWN 行为保留。
- 原 Editor 的「Drop or 」在 underline 外、仅「browse」下划线及 modal 的
  「Drag or browse」、两种 URL hint 恢复；中英文同源，不覆盖其他原消费者词条。
  原 SegmentedControl 的 className 和三个 cn 合并恢复（只迁移 cn import），
  原 inline AvatarModeTabs 实际传回 `w-full bg-muted`，不再丢宽度和背景覆盖。
- Native 直接消费可信 NativeSession 的本人 pubkey，既有 query/cache key 按
  Community id/Relay/pubkey 分区；异步读写在真正更新 query/localStorage 前核对
  原 owner 和 signer。头像上传前后核同一 owner，迟到旧 scope 的 URL 不进入原
  全局 avatarPresentationStore。原身份切换不复用全局 `["profile"]`，不借默认租户。
- 既有 useSelfProfileCache 实际被 SidebarProfileCard 消费；旧逻辑只在 effect 中
  重读 scope，会先渲染上一身份头像。现首帧只返回当前 Relay/pubkey 的原缓存源，
  不新建持久格式，原缓存事件/读取方式不变。实际消费者逐渲染核验而非只看最终DOM。

边界沿工程06 §4：认证/scope/权限拒绝为 DENIED，不开放原被阻断能力（BLOCKED）；
缺投递/资料/上传服务的既有错误仍为 PRECONDITION，不以占位值成功；大小与节流沿
原 LIMIT，签名/幂等冲突沿原 CONFLICT；已派发后身份变化或网络结果不明仍 UNKNOWN，
不渲染成功/失败、不再造事件重试。空资料、空头像沿原默认呈现，未知 signer 不缓存，
组件卸载/切身份后的读写回执不污染当前界面；没有新增持久状态、回收器或后台轮询。
这些客户端检查不证明 Relay/媒体服务实际认证，也不替代真实账号与设备验收。

沿原4CPU/8GiB SDK/cache，只同步本批小输入与两宿主实际物理包，没有安装、整树
复制、镜像或 Cargo/Go 构建。清理暂停解除后前置检查无编译进程，实际uid1000:1000、
memory+swap8GiB，memory.current约535MiB、oom/oom_kill0，Data296GiB；终态无本批
工具链、memory.current约777MiB、oom/oom_kill0，Data296GiB，SDK正式释放。
12个正式输入与候选、10个两宿主实际物理包输入最终cmp均0。日志位于既有
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/` 下的
`workflow-native-template.s3JDP1`：

- `profile-avatar-shared-restored.log`：原 Card 与真实原 Editor **29 passed/退出0**；
  `profile-avatar-native-restored.log`：实际 Card/hook 与原 SettingsView
  **7 passed/退出0**；`profile-avatar-web-restored.log`：既有真实 Web Card 消费者
  **13 passed/退出0**。这是最后离线 cache 首帧修正前的结果，不外推为最终字节验收。
- 清理后最终 `profile-avatar-final-shared.log` **29 passed**、
  `profile-avatar-final-web.log` **13 passed**、`profile-avatar-final-native.log`
  **8 passed**，集中句柄41507退出0；总50项包含最后cache首帧实际消费者。
- private 实际生产破坏 `profile-avatar-shared-production-fault.log` **4 failed**：
  固定首资料并移除原模式 className，真实抓到刷新/迟到回执和宽度背景丢失；按原字节
  还原后上述 shared 29通过。`profile-avatar-native-production-fault.log` **4 failed**：
  恢复全局 profile key 并移除上传 owner 守卫，抓到实际身份与 cache 串用；还原后7通过。
  单独只移除实际 post-upload owner 守卫，
  `profile-avatar-upload-production-fault.log` **1 failed/4 skipped/退出1**，
  原 presentation store 的 blob 数量实为2而非1；候选已还原，未破坏正式源码。
- 最后只移除private实际cache源守卫，
  `profile-avatar-cache-production-fault.log` **1 failed/5 skipped/退出1**，真实
  抓到切身份首帧返回「First offline identity」而非「Current offline identity」。
  原字节还原且cmp0后，`profile-avatar-final-native-restored.log` 再 **8 passed/退出0**，
  包括实际post-upload拒绝与首帧隔离；不以先前7项代替最终字节。
- shared/test/Web/Native 四个 `profile-avatar-*-tsc*.log` 曾退出0，但运行早于最后
  SegmentedControl 和 cache 首帧增量，不能写为最终类型验收。原 i18n 生成
  `profile-avatar-i18n.log` 退出0，生成 platform_text.dart；reason_text.dart cmp0。
  清理后 `profile-avatar-final-{shared,test,web,native}-tsc.log` 四份最终类型全部退出0；
  `profile-avatar-final-i18n-check.log` 的原 generator --check 退出0，输出
  `PASS: Mobile platform and reason catalogs match the shared TypeScript source`。
  该集中还原/类型/词条句柄83868实际退出0，替代暂停时尚未验收状态。
- 首轮原 Node harness 因原 AnimatedAvatarCapture 的 Vite import.meta.env 导入失败；
  未改生产代码绕过，改用原已安装 Native Vitest 入口。共享首次检查有缺 uploader/
  浏览器 API 夹具失败，补实际 host/test fixture 后通过；保留全部失败日志。JSDOM 的
  canvas 提示不算动态头像/摄像头验证。未运行 full、Rust/SQL、真实媒体/Relay 或设备。

同一3313快照派生
`collaboration-current-20261008.profile-avatar-classification.tsv`（同一日志目录），
SHA-256 `120a3ef2790f7555853a2686b4714b80dcb7498014f2fea60d9283f87f9cb9e7`；
列仍为upstream_commit/path/change_kind/category/destination/evidence/added_lines/
deleted_lines。九条原路径逐项核对后：**共享40、授权1、缺失27、未分类3245，共3313，
68条已归档**；1980同路径字节相同另计。归档不是完整语义或逐页面验收。
Profile Card 和原 PrivateKeyBackupRow 仍明确缺失：Native 没有 getNsec/backup 实际链，
Web 不应取得私钥，但不能用该边界解释 Desktop 也删除备份。未伪造按钮或导出 API；
Native 原 hooks 其余模块未全核，不计为完整归档。原 Agent profile/DM 仍未补齐。

实际 playwright-cli 旧会话正常转 IdP 登录页，
`.playwright-cli/kailo-ui-20261008-profile-session-expired.png` 已截图并打开复核；
没有注入会话、重置账户、输出口令或新登录绕行。当前源码业务截图0、Windows/Mobile
实际设备验收0；旧live d313fb的13图不证明本批。12路径尚未提交/push/部署或更新包，
不声称头像线上可用、完整资料恢复或100%原版一致。

### 2026-10-08 原 Native 私钥备份完整设置消费者

本节是实现后回执；权威为 REQ-08/24、DD-75、设计09 §3，以及用户原版恢复要求。
Native 本机持钥不同于 Web 服务端代签；Browser 不能取私钥，不能用这一边界删除
Desktop 原本的本地备份。固定 Buzz `779af8886caae1317b4de962082429867ab61503`
逐文件/符号对照如下，不把整目录记为一致：

- `desktop/src/features/settings/ui/PrivateKeyBackupRow.tsx::PrivateKeyBackupRow`；
  `desktop/src/features/settings/ui/EncryptedBackupCreator.tsx::EncryptedBackupCreator`；
  `desktop/src/features/settings/ui/BackupTestFlow.tsx::BackupTestFlow`。
- `desktop/src/features/settings/EncryptedBackupProvider.tsx::EncryptedBackupProvider`；
  `desktop/src/features/settings/lib/encryptedBackup.ts::encryptedBackupReducer`；
  `desktop/src/features/onboarding/ui/NsecMaskedDisplay.tsx::NsecMaskedDisplay`。
- `desktop/src-tauri/src/key_backup.rs` 的 `create_backup_blob`、`decrypt_ncryptsec`、
  `write_portable_backup_file`、`generate_passphrase`；
  `desktop/src-tauri/src/commands/identity.rs` 的 `get_nsec`、`create_ncryptsec_backup`、
  `verify_ncryptsec_backup`、`save_ncryptsec_copy`；
  `desktop/src-tauri/src/commands/export_util.rs::pick_save_path`。
- `desktop/src-tauri/src/egress_guard_tests.rs::
  ncryptsec_handling_is_confined_to_allowlisted_files`；原现存 Relay 拒绝逻辑与
  events inventory 不变，只准许实际恢复的 Native backup 四个源码消费者。
  此文件已有 unconfirmed.rs inventory 两行属继承修改，不在本批 owned 变更。

原 Row/Creator/TestFlow/Provider/MaskedDisplay 的布局、按钮、菜单、弹窗和流程直接
复用，只将文案迁入现有中英同源词条，并补可信本机身份及异步回执 fencing。
Native AppShell 按 device pubkey/Relay/PlatformSession key 承载原 Provider；
共享 Profile Card 只增加 Native 原 Identity details 插槽，Web 不传此槽、不出现
私钥读取或导出。原 lazy/masked Reveal、Copy、创建、系统另存为、再次下载及测试
消费者接回，不是无调用方 helper。原 400ms debounce、5分钟内存可用期和口令清空
沿上游；切身份/卸载清空，过期撤销下载与 toast，不新增持久状态或第二份密钥权威。

Native IPC 从现有 AppState signing_keys 读取，实际公钥必须等于调用方冻结的设备
公钥。创建/验证与原 identity_mutation 共用锁，原 NIP49 log18 与最短口令保留，
创建后真正解密核对公钥；验证只返回公钥/npub/是否当前身份，不返回解密私钥。
不可信备份 KDF 上限直接引用原生成 tier，超出先拒绝，不先分配任意 KDF 内存。
另存前及选择路径后均重验身份，复用原系统对话框；只写选定路径，create_new 保留
已有文件、Unix owner-only、sync+reread 后才报成功。取消不是已保存，异常不自动
覆盖或重复保存。恢复的是本地备份，不恢复未经设计允许的已登记身份替换/import。

影响面限共享展示/i18n、Native原设置/宿主/IPC/codec/依赖锁及既有检查；不改Core、
数据库、schema、Workflow、HTTP合同、平台quota或管理认证。未增加运行开关或远端
IPC capability。原 assets/eff_short_wordlist_2_0.txt 与固定官方字节相同，SHA256
`7aa57a4d3ecf6581729992bad9575bacdebf7c28378af2aec6a50f11aec326f5`。
本批26源码/检查路径 owned **+4086/-15**：16已跟踪+610/-15、新10文件3476行
（其中1296行原词表）；继承 inventory 两行不计，代码量不是完成度。

边界按工程06 §4：身份不符/锁定 DENIED，当前无该端能力 BLOCKED，原生缺钥或
格式/保存前提缺失 PRECONDITION，口令/KDF界限 LIMIT，已有文件 CONFLICT；
写入或回读无法确证时不报已保存，保持错误与原可用备份，不做盲重放。此为本地
文件行为，不产生平台 ExternalExecution；原 Relay egress guard 仍禁止备份流出。
重复点击沿原 isSaving/请求关联；旧 Reveal、生成口令、文件读取或加密完成不污染
后来的窗口/身份；未知 NIP49结构交给固定 nostr codec 拒绝，不回退明文。
这些客户端夹具不等于真实IPC、系统保存面板、三账号或设备验收。

验证复用 `kailo-agent-receipt-xvkujx`，实测4CPU/8GiB，Cargo保留-j16、
/cache/rust-target和离线缓存，不安装、下载、整树复制或新镜像。日志在既有
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/
workflow-native-template.s3JDP1`：

- `native-key-backup-state.log`：原纯reducer9 passed；命令为desktop下
  `node --experimental-strip-types --test src/features/settings/lib/encryptedBackup.test.mjs`。
- `native-key-backup-shared-card-final.log`：shared原Card21 passed，含中英文
  Web不出现私钥消费者；`native-key-backup-ui-final-bounded-restored.log`：
  实际Native Card9+SettingsView2，共11 passed。Native命令为
  `node ../../web-client/web/node_modules/vitest/vitest.mjs run
  tests/settings/ProfileSettingsCard.test.jsx tests/settings/SettingsView.test.tsx
  --maxWorkers=1 --no-file-parallelism`。JSDOM canvas提示不算摄像头或视觉验收。
- `native-key-backup-rust-final-serial-restored.log`：实际生产crypto模块13 passed，
  包含未降低log18的往返；161.73s是串行运行时间。命令
  `CARGO_TARGET_DIR=/cache/rust-target cargo test --offline --manifest-path
  /evidence/workflow-native-template.s3JDP1/native-key-backup-module/Cargo.toml
  -j16 -- --test-threads=1`。私有receipt manifest 的lib直接指向本批生产
  key_backup.rs，固定nostr0.44.7/getrandom0.2.17；它不是整个Desktop/Tauri构建。
- private真实writer改为truncate，`native-key-backup-rust-production-fault.log`
  1 failed/exit101，原已存在文件保护真实抓到覆盖。private真实Row移除迟到回执守卫，
  `native-key-backup-ui-production-fault-bounded.log` 1 failed/8 skipped/exit1，
  原界面中旧私钥存在性true而非false。恢复生产字节后上述11和13再次通过。
- 前两次UI负向直接断言React DOM与null时worker退出；容器oom和
  oom_kill从0增加到2，不算mutation命中。将同一对象断言改为Boolean存在性后
  稳定捕捉真实行为失败；最终串行无新增OOM。不把首次OOM归因并发KDF。
- `native-key-backup-{shared,web,native}-tsc.log` 三侧类型退出0；
  `native-key-backup-test-final-tsc.log` shared测试类型退出0。
  原生成器与最终 `native-key-backup-i18n-final-check.log` 退出0，输出
  `PASS: Mobile platform and reason catalogs match the shared TypeScript source`。
  原Dart同源生成入库，不改reason_text.dart；rustfmt --check退出0。
- `native-key-backup-final-inputs-diff.log`：26正式/候选输入与4两宿主物理包输入
  cmp全0，owned git diff --check退出0。最终串行句柄64323退出0，SDK已无本批
  工具链，资源终态见native-key-backup-final-resources.log，未清缓存。
- 首轮Native有Provider夹具缺口/worker启动失败，补原Provider实际上下文后通过；
  shared初次组合中upload10通过但Card worker失败，组合exit1不计整批通过。
  保留失败日志，不以初次结果替代上述最后同字节回执。

`native-key-backup-tauri-system-deps.log` 的实际pkg-config退出1，GTK3与
WebKitGTK4.1不存在；没有安装或伪造.pc绕过。因此完整Tauri IPC、原结构扫描、
系统save panel、Windows安装包及真实本机设备均未验收。未运行full或发布构建。
本节源码验收时未提交/push/部署，当前源码业务截图0，旧live d313fb13图与过期登录页不证明
本批。原Agent profile/DM、身份import、其他原页面及全部截图缺口仍在，不称100%。

同一3313历史全树快照逐路径派生
`collaboration-current-20261008.native-backup-classification.tsv`，SHA256
`f546416a2b9c3291ef491cd22e9b720c9bab9afa0b52d49d98bfbdf0654d3aaf`。
列为upstream_commit/path/change_kind/category/destination/evidence/added_lines/
deleted_lines；change_kind和行数字段仍是该快照，不冒称重导出的当前全树diff。
**原样1、共享40、授权9、缺失28、未分类3235，共3313，78条已归档**；
1980同路径字节相同另计，不能外推全量原样一致。原key_backup.rs/tests整体仍记
缺失：本批只恢复真实消费的设置备份，不把尚无消费者的原import/canonical cleanup
冒充已补齐；Profile Card整体仍缺实机/视觉完整证据。本节与26路径冻结交主代理，
继承checkpoint删除及旧inventory两行不纳入本批。

### 2026-10-08 原频道及私聊 Header 的共享真实消费者

本节为实现后回执。权威为 REQ-08/24、DD-75、设计09 §3、既有 Core
Conversation 准入，以及用户原版恢复要求。固定官方 Buzz
`779af8886caae1317b4de962082429867ab61503` 逐文件/符号核验：

- `desktop/src/features/chat/ui/ChatHeader.tsx::ChatHeader/ChannelIcon`：原标题
  baseline、频道图标、复制、状态和 system-chrome wrapper 迁入实际共源消费者。
- `desktop/src/features/channels/ui/ChannelScreenHeader.tsx::
  ChannelScreenHeader/DmHeaderParticipantStack`：原单人头像与三人预览堆叠、
  ring、重叠顺序和 +remaining 原样复用；两宿主均消费同一实现。
- `desktop/src/features/profile/ui/ProfileAvatarWithStatus.tsx::
  ProfileAvatarWithStatus`：复用原无 status 分支的 MaskedAvatarBadgeFrame 与
  ProfileAvatar，不把尚无真实 producer 的 presence 默认成 offline。
- `desktop/src/features/channels/useActiveChannelHeader.ts::useActiveChannelHeader`
  与 `desktop/src/features/channels/lib/dmParticipantDisplay.ts` 的
  getDmParticipantPreview/formatDmParticipantDisplayName：原展示规则保留，
  身份读取替换为既有可信 Core Conversation 与完整 BFF people 目录。
- `desktop/src/features/sidebar/lib/channelLabels.ts::
  isGenericDmChannelName/resolveChannelDisplayLabel`：原规则保留，只导出已有
  predicate 给实际 Header 消费，不覆盖用户原本的自定义私聊名。

影响面限共享 Header/现有目录读取、Web 实际 PlatformApp/search、Native 实际
ChannelScreen/Header/hook 及既有检查；不改契约、数据库、Workflow、权限或
计费权威。Web 仍经 BFF，Native 管理读取仍经 BFF、本机持钥 Relay 链不变；
没有新状态、注册表、服务、开关、正文副本或外部写动作。Mobile 无本批 UI
改动/设备验收，未另建翻译权威。原 i18n/clipboard/media host 继续复用。

直接按原组件恢复布局，不将设备 pubkey 数量冒充人数。当前用户必须属于实际
ACTIVE Conversation；完整目录每个 Principal 和公钥必须唯一，空目录项、未知
格式、重复/不推进游标拒绝消费。Native 按 Community、device、Principal、实际
channel 隔离读取，迟到回执有 owner 检查；Core UNKNOWN/failed、目录不完整、
身份变化或非 ACTIVE 时不渲染参与者身份。完整目录由原 Web 读取函数移入现有
use-conversations 模块，两端实际消费，不是第二份权威或无调用方 helper。

目录没有声明 canonical profile key：只有真实该频道中存在的唯一单公钥成员
才能接原 Native profile read/Popover；多设备成员用原 fallback 头像，不选第一
设备伪造 canonical 身份。Web 本批只用可信姓名/原 fallback，真实头像 profile
读取仍有缺口。组内 profile 点击只对上述有证明的成员开放。保留原作者自定义
DM 名称，普通频道继续原 ChannelGlyph，私密频道不再错画成公开 Hash。
无 profile、Presence 或 Agent 身份证据时不编造状态/owner，也不回退共享身份。

异常沿工程06 §4现有分类：失权/身份不符不暴露资料，缺准入/资源事实不消费，
目录 LIMIT/格式/游标异常保持原读取错误，UNKNOWN 不成为成功或执行失败。
本批没有写入重试、结果重放、租约或待终结持久状态；复制失败仍走原错误反馈。
本批16源码/检查路径 **+424/-62**（13已跟踪+212/-62，3新增212行）；这些是
已写入范围，不是原版完成率。完整文件清单已交主代理选择性复核/提交。

验证复用 kailo-agent-receipt-xvkujx，实测4CPU/8GiB；Node/Vitest 顺序执行、
maxWorkers=1，无 Cargo/Go、镜像、下载、安装、整树复制或全量构建。日志在
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/
workflow-native-template.s3JDP1`：

- `dm-header-shared-final-restored.log`：shared 下
  `node node_modules/vitest/vitest.mjs run test/chat-header.test.tsx
  test/conversation-sidebar.test.tsx --maxWorkers=1 --no-file-parallelism`，
  **17 passed/退出0**，含原 DOM/样式与实际可信成员解析。
- `dm-header-native-final-restored.log`：desktop 下
  `node ../../web-client/web/node_modules/vitest/vitest.mjs run
  tests/channels/ChannelScreenHeader.test.tsx --maxWorkers=1 --no-file-parallelism`，
  **8 passed/退出0**，含当前身份、原 profile 实际点击、多人预览、自定义名称及
  UNKNOWN/缺目录/换设备拒绝；多设备本人不再显示成另一个参与者。
- `dm-header-web-final-restored.log`：web 下
  `node node_modules/vitest/vitest.mjs run src/platform/ui/search.test.tsx
  src/platform/ui/PlatformApp.test.tsx --maxWorkers=1 --no-file-parallelism`，
  **39 passed/退出0**；两宿主与共享最终共64项。夹具中的 HTTP/profile 源不等于
  在线 BFF/Relay 或 Windows 实机结果，DOM 检查也不是截图验收。
- private 实际 resolver 移除成员守卫，
  `dm-header-membership-production-fault.log` **1 failed/8 skipped/退出1**，真实
  得到 Known outsider/Bob 而非 null；夹具含已知 outsider，不能靠缺目录误通过。
  private Native hook 移除 device 关联，
  `dm-header-native-identity-production-fault.log` **1 failed/7 skipped/退出1**，
  换设备仍出现 Actual peer 而非 DM。生产字节恢复后上述64项再次全部通过。
- `dm-header-{shared,test,web,native}-tsc.log` 四个最终类型检查退出0：
  shared 普通与 tsconfig.test.json、Web、Native 原 tsc --noEmit；集中句柄85347
  终态0。最终还原专项句柄71432终态0，不把较早17/7项当最终字节验收。
- `dm-header-final-inputs-diff.log`：16正式/候选与12两宿主物理包输入 cmp全0，
  owned git diff --check退出0；第一次 evidence 命令引号错误退出2保留在
  dm-header-inputs-shell-failed.log，修正命令后实际cmp通过，未改生产源码绕过。
- Web 首次 dm-header-web.log 因真实 AvatarHostProvider package subpath 未导出
  退出1；补实际 package export 后39通过，保留原失败。共享/Native首次通过后
  补已知 outsider 的真实否定夹具与自定义 DM 名检查，再按最终字节完成上述结果。
  最终SDK只有sleep，memory.events 的旧 oom/oom_kill=2不变，
  dm-header-final-resources.log留实测限额；SDK已释放。未运行full/发布/设备检查。

同一3313历史全树快照派生
`collaboration-current-20261008.dm-header-classification.tsv`，SHA256
`f49c23bf733c5233429e629a2b540fa0781431ea111fa045f1e94db935ac8bd9`。
列为upstream_commit/path/change_kind/category/destination/evidence/added_lines/
deleted_lines；change_kind/行数仍是原快照，不冒称当前重导出的全树diff。
**原样1、共享42、授权9、缺失32、未分类3229，共3313，84条已归档**；
1980同路径同字节另计。六条原路径已逐项核对，Header整体仍记缺失：
UpdateIndicator、完整actions/titleAdornment、成员/终端/Join、Agent provenance/
profile/DM、Presence producer与未接的原mode/overlay等没有被这批冒充补齐。

本轮沿 playwright-cli 正常 SSO 表单重新登录，没有注入 Cookie/session、重置
账号或打印口令。实际20张旧live截图均已打开视觉复核，路径统一为
`.playwright-cli/kailo-ui-20261008-relogin-oldlive-<name>.png`：

- channel、dm、inbox、pulse、projects、members、agents、workflows、tasks、
  approvals、audit、devices、settings（13个页面状态）。
- appearance、notifications、shortcuts、custom-emoji、invites（5个设置状态）。
- avatar-editor、profile-edit（2个实际弹窗状态，不是设备页误图）。

这些截图绑定旧线上Web镜像
`sha256:d313fb1326cec59bcd4f3dc3b4785033026c43a438a41594895e6f57b5157e83`，
不证明本批新源码。旧线上已有原主题/侧栏/圆角/消息布局，不再笼统称无样式；
旧主菜单/缺搜索/DM标题等与当前源码不同，旧外观设置差异不能重复修已恢复源码。
本轮只读取导航/打开弹窗，未做头像上传保存、偏好写入、发消息或创建工作流；
通知受浏览器权限限制。没有当前用户可访问 ACTIVE 业务 binding、Wren 无业务
runtime，三组件页面未验收，不生成假入口。新源码业务截图0、Windows/Mobile
实机0；20图不等于所有页面/关键状态/双语全覆盖，也不与旧13图重复累加。
本节源码尚未提交/push/部署或更新包；Header完整功能与全量原版一致性仍未完成。

### 2026-10-08 原快捷键定义及已读操作的共源真实消费者

本节为实现后回执，权威为 REQ-08/24、DD-75、设计09 §3、既有 Core
InboxReadState CAS 及用户原版恢复要求。固定官方 Buzz
`779af8886caae1317b4de962082429867ab61503`：

- `desktop/src/shared/lib/keyboard-shortcuts.ts::KEYBOARD_SHORTCUTS` 的全部27项
  定义和顺序，及实际消费的分组/平台键辅助，按原字节迁入共享
  `client-kit/ts/platform/src/keyboard-shortcuts.ts`；Native原模块仅转导出。
  未被使用的原 Huddle 事件常量/type 和 getPlatformKeysById 没有制造新消费者。
- `desktop/src/app/useMarkAsReadShortcuts.ts::useMarkAsReadShortcuts` 函数体与
  固定官方逐字一致，迁入共享 React 模块；原 Native AppShell 继续调用原路径的
  转导出。前景 escape surface、defaultPrevented、modifier、StrictMode 清理等
  原规则保留，不重新发明快捷键或关闭行为。
- `desktop/src/features/settings/ui/KeyboardShortcutsCard.tsx::
  KeyboardShortcutsCard` 对照后，Web删除自维护19项表，使用与Native同一完整
  注册表、原分组顺序及既有同源中英 shortcutText。当前有真实消费者的23项展示，
  含 quick-search、find-in-channel、mark-current-read、mark-all-read；原
  always-address-agent、publish-note、toggle-huddle、push-to-talk 四项真实
  消费仍缺失，完整定义保留，不能将过滤展示说成原卡完整恢复。

影响面为共享原注册表/hook、Native原转导出、Web Settings/PlatformApp/Sidebar
及已有检查；新增Web宿主读标记适配接原BFF client与同一个 useInboxState.write，
不改 Core、契约、数据库、Workflow、服务端授权或计量权威。没有新正文/状态
账本、注册表、服务、开关、凭据、时间来源或翻译权威。Web不持私钥；Native
本机持钥与管理BFF边界不变。Mobile无本批实现/实机验收，不需四侧再生成。

副作用仅复用原 read-position CAS，不用 Date.now 把未读内容跳过。Web
loadReadShortcutContexts 实际读取 session、成员workspace、分页ACTIVE
Conversation、workspaceChannel native channelId 与原消息窗口；只取真实内容
事件 createdAt，不把窗口边界元事件时间当正文时间。空窗口不写入；未知类型或
forum窗口不能证明全部root的最新回复时，在任何CAS前拒绝整个操作，保留明确
缺项。完成读取后再核 session tenant/principal/platformSessionId、成员、频道
绑定与Conversation参与者；换scope/撤权/绑定变更/未知准入拒绝消费。

原Sidebar查询把workspace ID错当Relay native channel ID核验；本批直接纠正
其真实消费者，读取workspaceChannel后用真实channelId验证事件和折叠既有
read marks。refetch旧活动不再作为可写最新事实。并发按当前owner/in-flight
守卫收敛；原读状态UNKNOWN/pending/failed禁止重复CAS，不转成成功或自动重放。
异常沿工程06 §4原错误类别，失败由既有本地化反馈呈现；没有新增持久状态。

本批13源码/检查路径 **+663/-331**（9已跟踪+86/-331、4新增577行），属于
已写入范围，不代表完成率。复用 kailo-agent-receipt-xvkujx，实际4CPU/8GiB，
Node/Vitest按maxWorkers=1集中窄验，无Cargo/Go/新镜像/安装/全量构建。
独立小候选及日志在
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/
shortcut-consumers.aJ6AF0`，不覆盖其他队友候选：

- shared-restored.log：shared下
  `node node_modules/vitest/vitest.mjs run test/channel-navigation-shortcuts.test.tsx
  --maxWorkers=1`，**16 passed/退出0**。
- web-restored.log：web下
  `node node_modules/vitest/vitest.mjs run src/platform/ui/SettingsPane.test.tsx
  src/platform/ui/ChannelSidebar.test.tsx src/platform/ui/useMarkAsReadShortcuts.test.tsx
  --maxWorkers=1`，**22 passed/退出0**。最终合计38项，包含实际BffClient与
  useInboxState写入消费者、空内容/失权/换身份/绑定变化/UNKNOWN/迟到回执。
- shared-tsc-final.log、test-tsc-final.log、web-tsc-final.log：原
  `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`，shared检查另用
  tsconfig.test.json，三个最终检查**退出0**。
- native-tsc-final.log/native-tsc-peer-final.log：Native原tsc **退出2**，实际
  `workflow-form-canvas.tsx(5,28): error TS2307: Cannot find module
  '@radix-ui/react-focus-scope' or its corresponding type declarations.`
  正式shared包及锁已固定1.2.0；独立候选沿原Native缓存graph未提供该精确包。
  较早指向shared另一React peer的候选也失败，保留native-tsc.log；修正候选
  原peer归属后仍有此缺包失败，不改生产版本、不安装/伪造declare来报通过。
  Native类型/完整IPC/Windows实机不能据Web通过而冒称通过。
- 四次private真实生产破坏分别为：改quick-search registry ID（registry-fault）、
  去除原前景Escape守卫（escape-fault）、去除真实platformSessionId比较
  （identity-fault）、Sidebar核验退回workspace.id（channel-id-fault）。四份
  .log均实际**1 failed/退出1**；恢复后以上38项全部再通过。13正式/候选输入
  cmp均0，owned git diff --check退出0。SDK已释放，memory.events旧
  oom/oom_kill=2未增加。本批full/发布/安装包及设备检查未运行。

同一3313历史全树快照派生
`collaboration-current-20261008.shortcut-classification.tsv`，SHA256
`326224bbac227f8e20971b8c03aad8553772994525599c735c09c93d2e9fc10f`。
列为upstream_commit/path/change_kind/category/destination/evidence/added_lines/
deleted_lines；**原样1、共享43、授权9、缺失33、未分类3227，共3313，86条已
归档**。历史change_kind/numstat不冒充当前重导出的完整diff；1980同路径同字节
另计。原useMark hook在该历史快照未变，不额外虚增差异表行。全量逐处分类、
缺项恢复与完整原版体验仍未完成，不能宣称100%。

主代理已独立发布固定main
`148798bc95ac47bc46319270462ab1fb064eef2a`，Web镜像
`sha256:da2ae292fb7297fd597e9db1420bd6e67135f7ae64261f66ff754d48ecb03d69`。
本轮playwright-cli沿正常SSO表单登录，不注入Cookie/session、不重置账户、
不输出口令。实际请求platform-build-info.json返回200、BUZZ_WEB、buildId
`sha256:f6cffa26a12eb0abf79e9402aa86c362a1da0ef6e8e09717709bd10e4b15f89c`。
本批13路径不在该已发布版本中，不能拿这些图证明新增读快捷键已上线。

当前22个页面/关键状态实际截图均已打开查看，统一前缀
`.playwright-cli/kailo-ui-20261008-main148798-`，下列均加.png：

- channel、dm-final、inbox-final、pulse-settled、projects-final、members-settled、
  agents-ready、workflows-ready、tasks-final、approvals-final、audit-ready、
  devices-settled、settings（13个页面状态）。
- appearance、notifications、shortcuts、custom-emoji、invites（5个设置状态）。
- avatar-editor、profile-edit（原内联编辑状态，不冒称上传/保存验收）。
- search、channel-browser（2个实际弹层；浏览频道有真实3条目录/成员数）。

首轮quickloop与部分名为settled/final的图片仍是加载骨架，已打开发现并用上述
真实内容图替代作为选定证据，不计加载图为完成页面。实际主题/侧栏/消息、Inbox
分栏、Settings原卡/头像类型/编辑呈现已看见；不再用旧d313图充当148798验收。
搜索输入seam时CLI网络实际输出
`180. [POST] /api/v1/search/messages => [404] Not Found`，console同一404；
目前仅私聊目录命中，消息全局搜索不能算已上线。通知被浏览器权限阻止，有真实
红色提示，未伪造可用权限。本轮未上传/保存头像、改变偏好、发消息或创建工作流；
自动已读属于既有页面查看行为。中文实际查看，英文全页与所有关键状态未验。
无当前用户可访问ACTIVE业务binding/Wren业务runtime，三组件页面0；Windows/
Mobile实机0。22图不是全部页面功能/双语/设备验收；头像完整保存、Agent资料/
直聊、完整Workflows、forum最新活动及四项原快捷键仍有实际缺项。此节与13路径
冻结交主代理精确复核提交，本批源码尚未提交/push/部署。

### 2026-10-08 原生媒体净化共源及真实头像上传回执

本批从实际页面失败回到原模块，不改原头像布局或创建替代上传路径。权威为
固定 Buzz `779af8886caae1317b4de962082429867ab61503`、
DD-75 本机持钥/Web BFF 代签边界及既定 UNKNOWN 语义。影响面已核原
Desktop `commands/media.rs` 三个生产调用方、Core 的个人头像与
Workspace/Conversation/Pulse 共用媒体上传、Relay descriptor、原资料 hook。
身份/scope/准入不改变；正文仍归 Relay/媒体服务，不存入 Core 第二权威。
非法/超限图片在发出前拒绝，已发出后缺终态证据不渲染成功或确定失败；
动画、EXIF、普通文件、净化后增大、重复重定向副作用与未知描述符均有实际验证。

固定上游路径与符号：

- `desktop/src-tauri/src/commands/media.rs::is_animated_image`、
  `sanitize_image_for_upload`；
- `desktop/src-tauri/src/commands/media_animated.rs::strip_animated_png_metadata`、
  `strip_animated_webp_metadata`；
- `desktop/src-tauri/src/commands/media_gif.rs::strip_gif_metadata`；
- `desktop/src-tauri/src/commands/media_snapshot_png.rs` 的原 snapshot
  PNG tEXt 保留生产实现。

上述生产逻辑迁入
`collaboration/crates/buzz-sdk/src/media.rs` 及其 `media/` 三原模块，
只有模块引用、可见性、出处与 rustfmt 差异，没有重写 PNG/EXIF/动画解析。
原 detector 与 sanitizer 对照成立；动画/GIF/snapshot 生产段与固定原模块
一致。snapshot 的两个纯检查迁入；依赖 Desktop managed_agents 的完整
share-pipeline 集成检查未迁入 SDK，也未声称该 Desktop 链通过。

Native 原 `commands/media.rs` 转导出共享 sanitizer，三个真实消费者
`process_picked_path`、`upload_profile_avatar`、
`upload_media_bytes_inner` 继续使用它；删除已迁移 animated/GIF 重复模块和
原 mod 声明，来源记录登记共享去向。Core
`IdentityClient::upload_media` 在真实共用上传链消费原 sanitizer：
字节识别为图片才净化，普通文件/视频不改；decode 沿 Tokio spawn_blocking，
原始及净化后 bytes 都检查已有运行时上限。签名 x tag、X-SHA256 与实际
净化 bytes 一致，Relay 成功 descriptor 必须匹配净化 SHA/size/图片 MIME，
不再用原始浏览器 hash 验净化结果，也没有删除回执验证来报成功。

`web_profile::upload_avatar` 与
`web_transport::upload_media_for` 都消费该共用链和媒体专用错误映射。
未发送的非法媒体为 PRECONDITION/INVALID_PARAMETERS；发送后的 3xx/5xx、
网络/回包缺失、无效 descriptor 为 UNKNOWN/EXTERNAL_RESULT_UNKNOWN；
可证拒绝的 Relay 4xx 保留原分类，不改变只读 Relay 错误映射。主代理另有
BffState HTTP client 的无重定向构造与 07 编译期策略行；这是主代理自有
hunk，不混入本批22源码路径。真实302 Location检查证明目标零请求、
零凭据转发。原共享 `useAvatarUpload` catch 消费既有
`isOutcomeUnknown` 与中英 unknownResult 词条，实际 UNKNOWN 不再显示
确定依赖失败，普通 PRECONDITION 503 不被一概改为 UNKNOWN。

本批22源码/锁/来源路径，包含4新增共享文件及2删除旧副本，总计
**+1914/-1097**（不含本节回执）。Core lock 正常解析新增17个媒体依赖包，
native-tls/whoami 的 windows-sys 选择引用有变化，没有原 package 版本升级；
collaboration 与 Native lock 仅增加 SDK 的 image/png 两依赖引用。
Native resolver 一度因离线 js-sys 元数据缺失失败，随后沿原配置解析，
剔除无关引用 churn 后以最终 Native lock 实际 --offline --locked 通过；
未编整个 Tauri，也未以 SDK 类型检查冒称 Windows IPC 验收。

实际日志根：
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/avatar-media.7vwZX6`。
既有受限 SDK `kailo-agent-receipt-xvkujx` 为4CPU/8GiB，原
`/cache/rust-target`，Cargo -j16，测试 --test-threads=1；
未新建 SDK/镜像或安装工具。最终原始命令与结果：

- `cargo test --offline --locked -j16 -p collab-bridge -p buzz-sdk --lib media -- --test-threads=1`：
  `shared-media-restored.log`，SDK 21 passed、bridge 7 passed（其中6个
  新实际媒体 HTTP 检查、1个既有 mention 检查），exit0。
- `cargo check --offline --locked -j16 -p platform-core --tests`：
  `core-media-check.log`，exit0。
- `cargo test --offline --locked -j16 -p platform-core --bin platform-core media_upload_errors_keep_unsent_invalid_and_unknown_receipts_distinct -- --test-threads=1`：
  `core-media-mapping-restored.log`，1 passed，exit0。
- Native 原 manifest 的 `cargo check --offline --locked -j16 -p buzz-sdk`：
  `native-sdk-locked.log`，exit0；`native-sdk-features.log` 实际证明
  buzz-desktop 依赖 buzz-sdk 的 media feature。
- shared 的 `node node_modules/vitest/vitest.mjs run test/profile-upload.test.tsx --maxWorkers=1`：
  `profile-upload-restored.log`，13 passed，exit0。
- shared/shared-test/Web 的
  `node node_modules/typescript/bin/tsc --noEmit -p <原 tsconfig>`：
  `shared-tsc.log`、`shared-test-tsc.log`、`web-tsc.log`，全部 exit0。
- 19个编译/类型输入的正式/候选 cmp 全0，22路径 git diff --check exit0；
  来源 YAML 与两删除路径另核实际 diff。最终 SDK 仅 sleep infinity，无本批作业。

不是只令检查通过：在私有候选上分别实际破坏生产 sanitizer 调用、
descriptor 守卫、pre/post size 守卫、无重定向 client、5xx UNKNOWN 分支、
普通文件 bytes 保持、Core UNKNOWN 映射、原 Profile UNKNOWN 消费分支。
`negative-sanitizer.log`、`negative-descriptor.log`、
`negative-size.log`、`negative-redirect.log`、
`negative-server-unknown.log`、`negative-non-image.log`、
`negative-core-unknown.log` 均 exit101；
`negative-profile-unknown.log` exit1（实际中英两检查失败）。每处均还原
同一生产对象，以上正向在还原后再通过。旧 cgroup oom=2/oom_kill=2
未增加，不把资源失败当负向命中。初轮迁移注释/import/命令选择编译失败
已纠正，原失败日志保留，不当作通过。全仓 check.sh --full 本批未运行，
由主代理聚合收口；本批未发布或制作安装包。

实际页面边界补充：Web 固定148798/source/buildId仍同上一节，不是本批
源码。原页面正常文件选择器提交上游 app-icon.png 后真实 avatar POST
返回503/PRECONDITION/DEPENDENCY_UNAVAILABLE，未继续“完成”、保存，
不算头像修改成功。输入PNG有 eXIf，当前 BFF 缺原 sanitizer 是实证缺项；
尚无新部署上传→保存→刷新结果，不能只凭源码修复宣布线上根因闭环。
失败截图
`.playwright-cli/kailo-ui-20261008-main148798-avatar-upload-failed503.png`
已打开；不盲目重复上传。另实际执行原“复制公钥”后在资料简介编辑器粘贴并
比对本用户公钥，清空草稿未保存；外观切英文后刷新仍为 en，再切回中文。
`appearance-english.png`、`profile-english.png` 同前缀已打开。
此前22选定状态加这3张共**25个实际截图状态已打开**，包含失败图，
不是25项功能通过；搜索404仍是旧 Core，三组件业务页0，Windows/Mobile
实机0，全页面双语、完整 Workflows、Agent profile/DM 等仍未全验。

同一3313历史全树差异快照的本批派生文件：
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/avatar-media.7vwZX6/collaboration-current-20261008.avatar-media-classification.tsv`，
SHA256
`cba189a0088aa23792eac1844a77f8f1a4fe144ee825c62889047883f165ea32`。
实际计数：**原样1、共享44、授权9、缺失33、未分类3226，共3313，
87条已归档**。本批仅把可核 snapshot 模块的既有行落实共享去向；
新迁移的 animated/GIF 原来不在该历史变更快照，不虚加行。原 media.rs
整条 IPC/治理差异尚未逐处归档，不能因 sanitizer 迁移把整文件标一致。
该历史 snapshot 不是当前源码重新导出的完整 diff；全量分类、缺项恢复、
新部署实际头像功能与三端体验均未完成，不能声明100%原版还原。

### 2026-10-08 当前 main 全量差异重导出及原 Copy channel ID 真实消费者

本批权威是用户原版一致性要求、DD-75、SS-BZ-01 与工程规则8/12。
固定官方 `779af8886caae1317b4de962082429867ab61503` 的完整路径
`desktop/src/features/sidebar/ui/ChannelContextMenu.tsx::CopyChannelSubmenu`
复制的是原生 `channel.id`，不是平台管理工作区 ID。当前共享原菜单保留
其分组、图标、次序、DOM和同源中英文；不新设计菜单或增加业务动作。

影响面已查 shared ChannelContextMenuItems 两宿主消费者、Web ChannelSidebar
的 workspaceChannel/messages/activity/unread/mark/preference 读写。
Web原工作区ID继续用于管理导航及偏好，仅从既有 BFF workspaceChannel
观察结果保留真实Relay ID，交给原复制动作。Native默认仍取本机原频道ID；
不改本机持钥/Relay直连边界，不新增后端、schema、权限或正文权威。
资料/消息请求失败、重新获取中、成员撤销或没有观察到ID时不复制猜测值；
原名称复制不变，读标记与偏好 UNKNOWN 准入守卫不变。重复复制只有本机
剪贴板副作用；此批没有新增平台执行状态或需要对账的远端写操作。
DENIED/PRECONDITION/LIMIT/CONFLICT/UNKNOWN 继续消费既有BFF/读偏好链，
BLOCKED无新增动作；原section/leave/archive/delete缺项仍未恢复，不能
因本批Copy接线将完整ChannelContextMenu标记一致。Mobile无适用源码变更。

四个实现后检查路径，合计 `+64/-19`：

- `client-kit/ts/platform/src/react/sidebar/channel-context-menu.tsx`
- `client-kit/ts/platform/test/sidebar.test.tsx`
- `web-client/web/src/platform/ui/ChannelSidebar.tsx`
- `web-client/web/src/platform/ui/ChannelSidebar.test.tsx`

现成 `tools/upstream_manifest.py` 的原 `_Index/diff` 机制本轮重新导出
**已提交main** `32971030d1d856b4f26b19fcff02cd4939204864`，前后commit相同。
只对临时index读取该提交的collaboration树并按原工具排除fork，不建worktree、
不执行references代码，不把继承脏文件或本批未提交改动混称当前main。
现成status退出0：官方HEAD仍为上述固定commit，没有新的Buzz上游提交。
证据目录为
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/current-main-diff.nNHzVS`。
`collaboration-main.patch` 有**3323差异路径、1040486行、44299036字节**，
SHA256 `7bdcbc85b0af1bf8f499506d0a759e66c865c18bcf917a8fd9467d5196724d37`。
原git name-status为M774/D2430/R8/A111；numstat为+37056/-743877，24条二进制。
官方5195路径中1983条同路径同字节未变，另计，不表示其功能已全验收。
旧3313快照仅保留历史证据，不再冒称本次当前完整diff。

当前 `collaboration-main.classification.tsv` 为12列：upstream_commit、
apps_commit、path、change_kind、category、destination、evidence、added_lines、
deleted_lines、upstream_path、previous_category、previous_evidence。
SHA256 `8dd62d565f7ebb7c974bd473af9d036911f066ac6105c2c95e28a19e4ef1ce9d`。
本次固定main逐文件重核**共享30、缺失2、未分类3291，共3323，32条已归档**；
原样/授权在本差异表本轮尚未归档，不等于没有此类实际差异。
重核范围包括原样式及纯帮助模块完整字节比对、已交付媒体共源模块和
ProfileAvatarEditor/helpers/types/utils/ModeTabs五模块完整diff；已知完整
设置/频道上下文菜单仍记缺失。旧87条只存previous字段作线索，不充作当前
验收计数。全量分类、所有原功能和三端实际体验仍没有完成。

运行沿既有4CPU/8GiB SDK及独立候选，Node内存3072MiB、maxWorkers=1，
只投递四源码与Web已装共享模块；未重建镜像、安装依赖或运行Cargo/full。
同证据目录的实际日志与结果：

- `sidebar-id-shared.log`：首次默认fork池一worker启动timeout，exit1；
  共享Sidebar6通过但Conversation未执行，不计整批通过。
- `sidebar-id-shared-threads.log`：原目标以threads池重跑，14通过，exit0。
- `sidebar-id-shared-tsc.log`、`sidebar-id-shared-test-tsc.log`、
  `sidebar-id-web-tsc.log`：原三个tsc --noEmit项目均exit0。
- `sidebar-id-web.log`：Web原实际消费者9通过，exit0。
- `sidebar-id-shared-negative.log`：私有副本生产Copy改回管理ID，exit1、
  1失败/5通过，断言明确预期relay-channel-one而收到workspace-one。
- `sidebar-id-web-negative.log`：worker启动timeout、0项执行，不算负向命中；
  原目标一次重试 `sidebar-id-web-negative-retry.log` exit1、1失败/8通过，
  真正抓住Web生产prop回退工作区ID（预期native-one，实际one）。
- 恢复原输入后的 `sidebar-id-shared-restored.log` 与

## 2026-10-08 原线程编辑真实消费者与0b线上冷定位复验

### 权威、影响面及边界

本批先对固定官方 Buzz `779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/features/channels/ui/useRoutedMessageEdit.ts::useRoutedMessageEdit`、
`desktop/src/features/channels/useChannelPaneHandlers.ts::useChannelPaneHandlers`、
`desktop/src/features/channels/ui/useChannelRouteTarget.ts::useChannelRouteTarget`、
`desktop/src/features/channels/useThreadTargetSync.ts::useThreadTargetSync` 和
`desktop/src/features/messages/ui/MessageThreadPanel.tsx::MessageThreadPanel`
逐模块核对，再恢复已有原编辑组件的真实调用方；没有先写规格或测试。
`GuardedChannelPane.tsx::GuardedChannelPane` 固定原版仅9行props转发，
当前Native直接消费同一lazy Pane，不凭名称假造新guard。

影响面是同一共享编辑选择/退出守卫、Native Screen→Pane→ThreadPanel、
Web Pane→ThreadPane→原Composer、原route/profile/reply切换和两侧既有编辑发布。
不新增数据库、API、reason code、工具或状态权威；原event/edit标签仍由Relay保存，
无旧数据迁移和合同格式变更。Web仍经既有BFF，Native仍本机持钥；
Mobile没有因此出现组件宿主或私钥出口。

新增shared `useChannelMessageEdit` 直接承接原同消息取消/跨主线程编辑互斥、
线程离开必须先完成或取消、身份/频道变化立即隐藏旧编辑目标；旧scope的异步回执
不能清掉新owner编辑器。Native恢复真实线程editTarget、原Composer、保存及
确认回执失效查询，route在loaded target后才清main edit，forum拒绝stream route。
Web线程行仅当前已验证本人签名者可编辑，沿原publish传准确`editEventId`，
不冒充普通reply；eventId/operationId齐全才结束，UNKNOWN/拒绝保留编辑与草稿。
没有绘制新页面、菜单、确认弹窗或空closeAgentSession。

空列表/未加载目标不定位；scope切换render立即fence；编辑进行中不离开线程；
重复保存受原busy/editing守卫约束，Web复用原request/pending链；迟到回执只清原目标。授权拒绝沿DENIED，
就绪/投影缺失沿PRECONDITION，额度/容量沿LIMIT，版本/重入沿CONFLICT，
执行结果不明沿UNKNOWN并保留原待对账证据，不将其渲染为成功或失败。
缺真实Agent Activity/会话合同的close保持BLOCKED缺项，不造假consumer。
原空编辑删除确认、deferred focus/本人末条快捷键仍缺，不声称这几个原模块全恢复。

2条提示`buzz.finishThreadEdit`/`buzz.finishEdit`在原TS词条权威追加中英，
沿原生成器生成Dart；未建立重复翻译源。17源码路径+755/-47，
包含新62行shared hook；仅格式化新增区段，不整份重排紧凑宿主。
本批恢复文件不存在过期remove_paths；仍缺的Agent会话/原编辑消费者未从目标删除。

### 实际执行、生产破坏与还原

复用`kailo-agent-receipt-xvkujx`原SDK和候选
`/evidence/profile-settings-ortsoo.DRR20F/apps`，4 CPU/8 GiB、
Node堆3072 MiB、Vitest forks/maxWorkers=1，无Cargo/Go/安装/镜像/全仓编译。
原始日志目录：
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/current-main-diff.nNHzVS`。

- Shared实际命令`vitest run test/timeline-scope.test.tsx --pool=forks --maxWorkers=1`：
  `thread-edit-shared-forks.log`及最终`thread-edit-shared-restored.log`，5/5、exit0。
- Native实际命令`node --import ./test-loader.mjs --experimental-strip-types --test src/features/channels/ui/ChannelPane.helpers.test.mjs`：
  `thread-edit-native.log`及最终`thread-edit-native-restored.log`，4/4、exit0。
- Web原命令`vitest run src/platform/ui/<目标>.test.tsx --pool=forks --maxWorkers=1`：
  最终`thread-edit-web-read-restored.log`30/30，`thread-edit-web-pane-restored.log`10/10，
  `thread-edit-web-thread-restored.log`9/9，串行终态exit0。
- Shared生产/检查、Web、Native的原`tsc --noEmit`四入口均exit0，日志分别
  `thread-edit-shared-types.log`、`thread-edit-shared-tests-types.log`（`-p tsconfig.test.json`）、
  `thread-edit-web-types.log`、`thread-edit-native-types.log`。
- `PATH=/usr/lib/dart/bin:$PATH python3 tools/gen-platform-i18n.py`及`--check`均exit0，
  `thread-edit-i18n-final.log`；reason_text原字节cmp0。首次PATH未投递导致Dart不可用的
  `thread-edit-i18n.log`真实失败保留，纠正既有PATH而非安装或换工具。
- 初次Shared threads及Web三文件cold worker超时分别保留在
  `thread-edit-shared.log`、`thread-edit-web.log`；未执行的目标不计通过。
  后者仅Thread9项曾执行，随后原目标逐文件串行运行，最终全部实际执行。
- 私有生产破坏，正式源码和检查未被破坏：删除线程离开guard，
  `thread-edit-guard-negative.log`1失败；删除旧owner fence，
  `thread-edit-owner-negative.log`1失败；Native移除root guard及改错forum守卫，
  `thread-edit-native-negative.log`2失败；Web把真实editEventId错绑root，
  `thread-edit-web-negative.log`4失败（confirmed/missing/unknown/denied）。
  四次实际测试exit1，包装调用只确认预期失败，没有拿startup失败充数。
- 每次破坏后从正式源还原；最终17源码与候选、6处shared实体包副本cmp全0。
  初轮恢复58项实际通过；末次行回复纠偏后为下述59项；scoped`git diff --check`exit0；
  cgroup max16751/oom2/oom_kill2均零增量。SDK工具链终态后已释放。

### 新部署浏览器证据与未验范围

正常SSO表单登录沿既有受控输入及官方playwright-cli Session执行；
无cookie/session注入、账户修改或口令输出。实际读
`/app/platform-build-info.json`确认固定main
`0b04bc2654e5f1b8a7942d9966ebe334927e0c86`，Web image
`sha256:f60b4fe4dbcc9b9caa3f1567e9c5b80ebea0b8db81d49790ad05f20fe1d02f5b`，
build/source`sha256:a61b2f7db919f3fe9d4aa20b136bcff530a48954847ba096ca22bf5339110672`。
真实搜索结果点击、冷根消息定位、回复线程定位及两者整页刷新，5张截图均打开复核：
`/volumes/kailo/apps/.playwright-cli/kailo-ui-20261008-main0b-search-results.png`、
`kailo-ui-20261008-main0b-search-cold-target.png`、`kailo-ui-20261008-main0b-search-thread-target.png`、
`kailo-ui-20261008-main0b-search-thread-reloaded.png`、`kailo-ui-20261008-main0b-search-cold-reloaded.png`
（后4张与首张同目录）。根消息实际y498.75、线程回复y267，
刷新等待真实virtualizer/RAF后同样在视口，不以人工scroll伪造定位。
主代理亦逐张打开5图；浏览器只读导航，没有提交新消息或外部动作。

这些图仅验已部署0b的上一批冷定位修复，不验当前17路径线程编辑；
本批待主代理提交/部署，没有新的Windows/Mobile设备验收或三组件业务页面验收。
完整diff仍是32971030d1d856b4f26b19fcff02cd4939204864快照3323路径，
40已分类=32共享迁移+8缺失需恢复，3283未分类；不是当前main逐处验收完成。
实际TSV为上述日志目录的`collaboration-main.classification.tsv`，SHA256
`1e576302dab2f1a92f25b32c025afc01c22bcdeae79c23ec8ffa12738f8f3e70`。
仍未100%还原；原Agent Activity/profile/DM、其余未核路径、全端完整交互
和三组件业务运行证据不能由本批59项源码检查或5图代替。

收口实际复核发现线程row `onReply` 仅改replyId、未清editTarget，
与固定原`useChannelPaneHandlers::handleSelectThreadReplyTarget`不一致；
最终两入口共用实际callback，同目标再次选择回root且取消编辑。
新增原ChannelRead实际菜单Edit→row Reply→同row取消目标→再选→发送链，
要求真实BFF参数为STREAM+parentEventId而非editEventId，没有只测helper。
`thread-edit-row-reply-positive.log`首次39通过/1失败为新增fixture误用展示时间；
纠正为既有RawEvent秒数后`thread-edit-row-reply-final.log`40/40、exit0。
私有仅将row `onReply`改回旧直接setReplyId，
`thread-edit-row-reply-negative.log`实际1失败，明确抓到仍显示Editing message。
原字节还原后`thread-edit-row-reply-restored.log`Web31+10+9=50/50、exit0；
加未更改的Shared5/Native4，共59项；两纠偏源与正式cmp全0。
末次原Web `tsc --noEmit`亦exit0，`thread-edit-row-reply-types.log`；OOM零增量。
  `sidebar-id-web-restored.log` 均exit0，14+9通过。四输入及Web已装共享包
  共五次cmp、scoped git diff --check均0；旧oom/oom_kill=2未增。

本批源码验收不等于浏览器或设备验收。根代理刚发布source329的Core/Web，
本批四路径不在该提交内。原浏览器会话重开进入正常IdP登录表单，将沿既有
受控正常SSO继续实际头像/搜索验收；此刻没有本批新页面截图，不以旧25状态
或过去503冒充新功能成功。Windows/Mobile实机仍未验；此批未自行提交/部署。

### 2026-10-08 main329 真实头像验收与原消息/线程搜索定位消费者

本节为实现后回执，沿 REQ-24、DD-75/77、SS-WEB-RELAY 与原版一致性要求。
动手前查明权威与影响面：URL/搜索仅提供目标引用，实际正文仍经既有 BFF
授权线程读取；Web 无私钥，Native 保留本机凭据与原路由消费者；Core、契约、
数据库、Worker、组件与 Mobile 本批不改。原共享滚动、路由根/回复投影、Web
线程查询及列表/线程/宿主消费者全部检索复核；没有新搜索引擎或读状态权威。
副作用只涉及客户端读投影、滚动与原面板选择，不发送消息、不复制正文到
Core、不开放新权限或组件入口。上下文须在当前 principal/workspace/key 下
重新读成功，等待/分页/错误/撤权不当作目标已可用；缺失祖先和循环祖先按原
有界遍历拒绝，scope 撤销移除显示、禁止启用新读。原 BFF 六类错误不重新分类，
读取异常用原 ThreadRepliesErrorCard，不把异常伪装成“消息不存在”或成功。
原发送中/编辑中守卫保留；跨 scope、空结果、分页未完成、断流恢复继续依既有
查询/流准入，不从搜索命中缓存恢复失去准入的正文。无契约/旧数据兼容迁移。

固定上游为 Buzz `779af8886caae1317b4de962082429867ab61503`：

- `desktop/src/features/channels/ui/useChannelRouteTarget.ts` 的完整
  `getThreadRouteTarget` / `getRouteMainTimelineTargetId` 函数原样迁至
  `client-kit/ts/platform/src/react/messages/thread/channelRouteTarget.ts`，
  仅路径与 export 适配。Native 删除重复函数并导入同一实现，Web 实际消费
  原根/回复/broadcast 规则与祖先展开，不造另一个路由规则。
- `desktop/src/features/messages/ui/useAnchoredScroll.ts::useAnchoredScroll`
  已迁至共享模块。真实冷搜索暴露虚拟列表 phase-1 返回 false 时仍提前标记
  handled：本批只在真正居中成功后接受，并取消尚未执行的默认底部 pin；
  已知但尚未实现到 DOM 的目标不回退底部。原视觉、阈值与布局不改。
- Web `PlatformApp` 传递现有 threadRootId；`ChannelPane` 经
  `useWorkspaceThread` 原 BFF/缓存/编辑删除闭包读取上下文，补入真实根消息，
  原回复面板处理目标回复且默认回复根消息；`ChannelThreadPane` 使用同一
  祖先解析。新增 enabled 只关闭尚未准入的 URL 读取/流，不产生新 API。

12 条源码/检查路径（新增共享 helper 一条）合计 **+292/-104**；没有自创页面、
按钮、文案、硬编码业务阈值或新依赖。具体为 shared thread helper/index/scroll、
timeline-scope 检查、Native 原 useChannelRouteTarget，以及 Web 原
useWorkspaceThread、ChannelPane/test、ChannelThreadPane/test、PlatformApp/test。

真实浏览器沿现有 playwright-cli `header-restoration` 正常 IdP 表单登录
seam-verifier，无 cookie/session 注入、改口令或共享身份，凭据不回显。
实际线上源码是 `32971030d1d856b4f26b19fcff02cd4939204864`，Web artifact
`sha256:9ce755ef160e985e259f4ecf12fac8739e0afeeef458a731e24be7fffcac24d8`，
浏览器 buildId/sourceDigest 为
`sha256:73e57641ff6dc5d09bf7ef07bdb1845826b217751b1d64344cc0ac025e63aba7`。
下列 **8 个状态**逐张截图并实际打开视觉复核，不等于全站 8 页已验收。
截图目录 `/volumes/kailo/apps/.playwright-cli/`，共同前缀
`kailo-ui-20261008-main329-`：

- `profile-before.png`、`avatar-uploaded.png`、`avatar-saved.png`、
  `avatar-reloaded.png`：原头像选择/上传/完成/保存/刷新真实通过。
  POST `/api/v1/profile/media` 200，PUT/GET profile 200，UI 原读回确认；
  刷新后实际图片 GET 200，168×168、5026 bytes，未改其他资料字段。
- `search-results.png`：POST messages search 200，实际频道/私聊/People/
  消息/线程分区有真实结果；不能由此宣称所有点击通过。
- `search-channel-target.png`：冷目标选中正确频道，但目标 y=-923.25，
  不在视口，真实 **失败**；不是页面 HTTP 成功即功能通过。
- `search-warm-target.png`：同频道已加载的真实根目标 y=479.25，在视口，
  暖目标通过；不能代表冷目标通过。
- `search-thread-missing.png`：URL 已含真实 reply/root，但原线上未消费
  threadRootId，未打开线程且错误显示未找到，真实 **失败**。

这两项真实失败推动本批实现；本批源码尚未部署，没有以这八张旧源码实拍
宣称本批修复视觉验收通过。Windows/Mobile 实机仍未验收，组件无可访问
ACTIVE 业务 binding，本轮组件业务页面截图为0，不生成假入口。

现有证据目录仍为
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/current-main-diff.nNHzVS`。
同一固定 main 的完整 patch 仍为3323差异路径；本次继续逐模块核对后分类表
`collaboration-main.classification.tsv` SHA256 为
`2c9c09f63cf6d902849daf7ab7cfb86f0b492b48087993c8d8be8f02daef4016`，
**共享31、缺失3、未分类3289，共3323，34条已重核**。
原 scroll 共享源码全 blob 对照已记共享，但上述真实行为缺陷没有算已验收；
原 channel route 完整消费者与设置/频道 context menu 仍记缺失，不把本批
未提交源码混进固定329分类结果。旧87条只作 previous 线索。没有100%还原。

运行先核 SDK `kailo-agent-receipt-xvkujx` 实际4CPU/8GiB，沿原独立候选与
缓存，Node3072MiB、Vitest threads/maxWorkers=1；无镜像/安装/Cargo/full。
原目标命令为 `node node_modules/vitest/vitest.mjs run` 加上述原检查路径，
类型为各既有 `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`
及 shared `tsconfig.test.json`。该目录保留以下真实结果：

- `search-target-shared.log`：共享3通过，exit0。
- `search-target-web.log`：首次18通过/1失败且1 suite未执行，exit1；候选缺
  已提交 useMarkAsReadShortcuts 输入，未把它算生产失败或通过。
- `search-target-route-probe.log`：确认 jsdom 零高 Virtua 不挂目标 DOM；
  保留失败，按原 ChannelRead 检查测量真实视口，不删除根 DOM 断言。
- `search-target-web-final.log`：最后 ChannelPane10、ThreadPane9、
  PlatformApp34，共53通过，exit0。
- `search-target-shared-types.log`、`search-target-web-types.log`、
  `search-target-native-types.log`、`search-target-shared-test-types.log`：
  四个既有类型项目全部exit0。
- 私有生产 scroll 分支改为 phase-1 false 也 accepted，
  `search-target-shared-negative.log` exit1、1失败/2通过，明确抓过早回执。
- 私有 PlatformApp 生产 prop 删除 threadRootId，
  `search-target-web-negative.log` exit1、目标1失败，预期actual-root而收到
  undefined；不是改检查自身制造失败。
- 私有 useWorkspaceThread 生产 enabled 守卫撤掉，
  `search-target-read-negative.log` exit1、目标1失败，明确抓禁用上下文仍发
  原 workspaceMessages 请求。未向真实业务环境注入故障。
- 恢复12源码与Web/Native已装共享3模块，18次cmp全0；
  `search-target-shared-restored.log` 3通过、`search-target-web-restored.log`
  53通过，均exit0。scoped git diff --check为0，旧oom/oom_kill=2未增。

本批12路径与本节交主代理冻结复核/提交，未自行 stage/push/部署。
全量官方分类、冷目标/线程的新版本浏览器验收与所有原功能仍未完成；
全局检查另有已报告真实失败，不以本批窄验冒称生产就绪。

### 2026-10-08 原共享页面迁移检查闭合（不增加产品功能）

本批只有 `client-kit/ts/platform/test/pages.test.tsx`，相对本批 HEAD
新增134/删除20行；268个既有检查数量不变，不新建检查框架，不修改生产
页面、契约或执行链。主代理固定329全局Node日志原有6个页面检查失败：
`/volumes/data/kailo/check-cache/full-node-32971030d-diagnostic.log`。

动手前边界与归属：

- 权威仍为 DD-24/25 的独立Asset读取、DD-36/53 的宿主主题和原版恢复
  要求；修正的是共享迁移后检查对真实生产消费者的识别，不增产品能力。
- 影响面查全 Workflows 两宿主导入/JSX、真实 QueryClientProvider、
  原 WorkflowActionTileStack、DefinitionIdentityCard/DefinitionDetail、
  两宿主Tailwind出口及共享配置。无API、数据迁移或四语言合同变更。
- 现有 +1/-45 继承改动在主代理逐hunk批准后恢复到 HEAD 原严格守卫；
  未把原侧栏边框、SVG、textarea、slider和头像精确判据删除来换通过。
  操作前原字节保存在下述证据目录 `pages-inherited-baseline.tsx`。
- 无生产副作用或新状态。读取拒绝只检查真实详情Dialog，保持既有
  UNKNOWN分类；列表卡片已授权独立Asset预读与点击后额外读取分开核对，
  403/404详情后不得新增Asset/Version目录读取，不把父资源可见当子资源权。

固定上游事实均为 Buzz `779af8886caae1317b4de962082429867ab61503`：

- `desktop/src/features/home/ui/InboxListPane.tsx::InboxLabel` 的唯一
  `min-h-[var(--inline-chip-min-height)]` 是原几何，不是任意色彩豁免。
- `desktop/src/shared/ui/markdown/CodeBlock.tsx::MarkdownCodeBlock` 原
  `borderRadius: "1rem"` 与 `SyntaxHighlightedCode` token色分别逐AST核实。
- `desktop/src/features/workflows/ui/WorkflowCard.tsx::ACTION_ACCENTS/ActionTile`
  已迁共享 workflow-card-actions；逐条核现有5个准入action原配色和真实
  消费者，其他任意裸色仍拒绝，不为了检查搬回或删除原卡片。
- `desktop/src/shared/ui/alert-dialog.tsx::AlertDialogOverlay` 的原black/60
  在草稿与工作流丢弃Dialog分别逐字核对；原
  `desktop/src/features/workflows/ui/WorkflowScheduleFields.tsx` 警告提示
  使用既有 --ui-warning/--ui-warning-bg，核实际shared config及adaptive主题。
- `desktop/src/app/useWebviewZoomShortcuts.ts::TEXT_SCALE_STORAGE_KEY` 是
  原本地偏好键。检查只排除其精确initializer、AST注释及既有React元信息，
  不把注释text-only或storage key当色彩；className和可执行表达式继续扫描。

实际执行在既有 `kailo-agent-receipt-xvkujx`，4 CPU/8 GiB，Node堆3 GiB，
Vitest threads/maxWorkers=1；无Cargo、镜像、下载、全局Node重跑或部署。
证据目录为
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/current-main-diff.nNHzVS`：

- 首次原pnpm shim调用不存在，exit127，保留
  `pages-migration-invocation-error.log`；改用已有node_modules/.bin入口，未安装。
- 原命令 `./node_modules/.bin/vitest run test/pages.test.tsx --pool=threads --maxWorkers=1`：
  `pages-migration-positive.log` 266通过/2失败；
  `pages-migration-final.log` 267通过/1失败。两次均保留原失败，后显现的
  主题误判按固定原几何/实际共享配置继续修正，未删断言。
- 最终 `pages-migration-final-2.log` 268/268、exit0；
  `./node_modules/.bin/tsc --noEmit -p tsconfig.test.json` exit0，
  `pages-migration-types.log`。jsdom原scrollTo警告不作为浏览器验收。
- 8次私有生产输入破坏，每次沿上述Vitest命令用原 `-t` 精确目标：
  `pages-import-negative.log` 删除真实共源导入，1失败；
  `pages-reaction-negative.log` 写错表情值，1失败；
  `pages-inbox-negative.log` 改错原几何变量，1失败；
  `pages-action-accent-negative.log` 改错原action配色，1失败；
  `pages-definition-read-negative.log` 在拒绝详情前额外读Asset，403/404共2失败；
  `pages-codeblock-negative.log` 改错原圆角，1失败；
  `pages-sidebar-map-negative.log` 改错sidebar-border映射，1失败；
  `pages-literal-color-negative.log` 额外添加非原红色class，1失败。
  每次真实Vitest exit1，包装调用只确认预期失败；未改检查伪造失败。
- 7个生产输入及pages输入共8次cmp全0；所有破坏还原后
  `pages-migration-restored.log` 268/268、exit0。scoped diff --check exit0；
  cgroup max16751/oom2/oom_kill2均零增量，终态docker top只剩原sleep。

两宿主Tailwind必须精确re-export同一shared config，包出口也被核实，
不拿旧候选空壳配置冒充变量映射。SDK未挂正式apps/references，故本批没有
用旧候选执行正式 upstream_manifest diff --check，交主代理原正式入口执行。
本批源码检查和本节冻结交主代理提交；不自行stage/push。
未新增业务截图，仍只有此前329线上8状态；新定位修复、全量原版一致性、
Windows/Mobile和三组件业务页面未由本批验收，不声明100%或生产就绪。

## 2026-10-08 原 routed-edit 延后焦点与本人末条快捷键真实消费者

本批依据用户的固定官方全量对照、Web/Desktop共源恢复要求，
直接迁移 Buzz `779af8886caae1317b4de962082429867ab61503`：
`desktop/src/features/channels/ui/useRoutedMessageEdit.ts::useRoutedMessageEdit`、
`desktop/src/features/channels/ui/useFocusDrawerPresence.ts::usePresenceCoverage/useFocusDrawerPresence`、
`desktop/src/features/channels/focusedThreadCloseRequest.ts::requestFocusedThreadClose/subscribeToFocusedThreadCloseRequest`、
`desktop/src/features/messages/lib/useRichTextEditor.ts::useRichTextEditor`、
`desktop/src/features/messages/ui/MessageComposer.tsx::MessageComposer`。
已逐模块核实原逻辑；不是自行设计页面或新键盘规则。

影响面与实际实现：三个原线程模块迁入既有共享thread目录，Native原路径转导出；
原ChannelPane、MessageThreadPanel、两端实际Composer与Web独立授权线程读源接回。
原主消息从focus/single线程进入编辑时，先关闭线程，等真实presence退出且主面板不被覆盖后编辑；
退出完成前原主面板保持inert。保留原跨main/thread编辑守卫、同目标切换、原关闭订阅。
ArrowUp仅在实际Tiptap空doc、无修饰键、无autocomplete时选择当前本人最新已确认非system消息；
主频道和线程各用自己的真实数据，草稿非空时不消费键盘。
Web线程选择root继续经父级原路由，不另造线程编辑或执行权威。

授权差异仅限既定宿主接缝：共享导入路径、现成中文/英文词条、
身份/频道切换时丢弃旧pending编辑；Web缺省thread数组不以假空数据代替真实独立读源。
本批无Core/API/契约/迁移、无新增数据状态和服务权威、无菜单/布局/文案设计变化。
未授权/归档/资料落后/执行中不提供新编辑准入；既有UNKNOWN和receipt处理不变。
频道、身份、线程切换及卸载丢弃旧UI选择，不保留跨scope pending。
Mobile非组件宿主与本机持钥边界不变，本批没有Mobile源码或设备验收。

源码17路径（包含3个原模块共享迁移新文件），合计+448/-62；
既有14路径+281/-62，三个共享模块131/12/24行。
`client-kit/ts/platform/package.json`只增加真实关闭订阅消费者需要的子路径export，
无新依赖或锁文件变动。候选中Shared、Native、Web三个实际platform副本均已精确同步。

原SDK `kailo-agent-receipt-xvkujx`，固定4CPU/8GiB，Node heap3072MiB，Vitest单worker。
未安装依赖、建镜像、运行Cargo/Go、全量生成或全量构建；正式源不做故障注入。
原候选 `/evidence/profile-settings-ortsoo.DRR20F/apps`；日志绝对目录：
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/current-main-diff.nNHzVS`。

实现后实际执行（上述候选对应工程cwd）：

```sh
./node_modules/.bin/vitest run test/timeline-scope.test.tsx test/custom-emoji-composer.test.tsx --pool=forks --maxWorkers=1
./node_modules/.bin/vitest run src/platform/ui/ChannelRead.test.tsx --pool=forks --maxWorkers=1
./node_modules/.bin/vitest run src/platform/ui/ChannelPane.test.tsx src/platform/ui/ChannelThreadPane.test.tsx --pool=forks --maxWorkers=1
node --import ./test-loader.mjs --experimental-strip-types --test src/features/channels/ui/ChannelPane.helpers.test.mjs
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/tsc --noEmit -p tsconfig.test.json
```

最终结果Shared15/15、Web真实读写/编辑34/34、Web相关19/19、Native4/4，
合计72项，均exit0；不是72个已部署页面。
日志依次为`routed-edit-shared-restored.log`、`routed-edit-web-restored.log`、
`routed-edit-web-related.log`、`routed-edit-native.log`。
Shared生产/检查、Web、Native四次类型检查exit0，日志为
`routed-edit-shared-types.log`、`routed-edit-shared-test-types-final.log`、
`routed-edit-web-types.log`、`routed-edit-native-types-final.log`。
Native最初TS2307为新增真实子路径export遗漏，已修正式package并同步后通过，
不以声明桩或改依赖版本规避。

首次Shared检查实际exit1（jsdom缺Range几何API），补标准测试DOM几何后恢复；
首次Web7项失败包括fixture非原始窗口倒序、captured rAF与fake timer时钟不一致。
最终使用真实Motion `frameSteps/frameData`驱动原presence动画，不mock动画组件或退出callback；
保持原断言与真实Tiptap事件。Web既有React act/linkify提示仍有，未冒称无警告。

生产破坏均限私有候选，原始失败日志保留：
删除covered守卫的首次检查没有触发effect重算而错误通过，
`routed-edit-focus-negative.log`不算负向命中；追加真实editor准入callback重渲染后，
`routed-edit-focus-negative-final.log`实际1失败，抓到覆盖期间提前编辑。
删除空doc守卫，`routed-edit-draft-negative.log`实际1失败；
删除本人pubkey过滤，`routed-edit-owner-negative.log`实际1失败（选中他人最新消息）；
断开Web主频道两处与线程一处真实Composer回调，
`routed-edit-consumer-negative.log`实际2失败，不只测未调用的helper。
全部还原后重新执行Shared15/Web34及最终检查类型，exit0。
17输入与候选、12个两宿主共享副本cmp全0，限定git diff --check exit0；
cgroup原max16751/oom2/oom_kill2均零增量，终态只有sleep infinity。
本批不重复全检；主线按集中收口执行既有全量门禁，不能把本节窄验当全检退出0。

全量对照仍以已有当前归档为准：官方上述40位commit与apps
`32971030d1d856b4f26b19fcff02cd4939204864`的3323路径快照，非本批新HEAD完整再导出。
仅将本批已逐模块核实的两个原thread模块归入共享迁移；
`collaboration-main.classification.tsv`现在34共享迁移、7缺失需恢复、3282未分类，
合计3323；41已分类不等于41已全体验验收，更不代表100%。
TSV位于上述日志目录，SHA256
`8513fea5f3ea1510fc8bd0e5d8dd6305942b0ebcbf016b4ed3b0cc22d145d933`。
未将整个RichTextEditor/Composer路径因局部恢复而改判全量一致；
原Native useRoutedMessageEdit旧路径仍不存在且已迁共享，保留remove_paths事实，
不将合法共享迁移谎称原路径恢复。

实际浏览器沿playwright-cli `header-restoration`正常IdP表单重新登录，
无Cookie/会话注入、账号重置或明文凭据输出。
重新登录后读取实际build-info为固定main
`0b04bc2654e5f1b8a7942d9966ebe334927e0c86`、
source/buildId `sha256:a61b2f7db919f3fe9d4aa20b136bcff530a48954847ba096ca22bf5339110672`。
本次五张业务截图均已实际打开视觉复核，文件位于apps/.playwright-cli：
`kailo-ui-20261008-main0b-channel-readonly-followup.png`、
`kailo-ui-20261008-main0b-inbox-followup.png`、
`kailo-ui-20261008-main0b-pulse-followup.png`、
`kailo-ui-20261008-main0b-projects-followup.png`、
`kailo-ui-20261008-main0b-projects-channels-followup.png`。
截图对应真实频道/Inbox/Pulse/Projects及项目频道；Projects当前零数据仅验证原空态，
不冒称有数据的项目/频道完整操作通过；无新发消息、创建项目或其他业务写入。
Pulse等待“全部”30秒超时是原实际词条为“所有人”，已如实保留，后续实际页面截图已打开；
不把超时描述成等待成功。Windows/Mobile仍无真实设备验收，组件页不由这些截图证明。
本批编辑源码尚未提交/部署，上述0b截图不能验本批恢复的键盘与焦点操作。
原Agent资料/直聊、Activity与其他未分类模块仍缺实证，不生成假入口或删除交付目标。

## 2026-10-08 原消息 Delete 菜单与清空编辑确认共源恢复

本批固定官方来源为 Buzz `779af8886caae1317b4de962082429867ab61503`：
`desktop/src/features/messages/ui/DeleteMessageConfirmDialog.tsx::DeleteMessageConfirmDialog`、
`desktop/src/features/messages/ui/MessageActionBar.tsx::MoreActionsMenu`、
`desktop/src/shared/ui/alert-dialog.tsx::AlertDialogContent`，以及
`desktop/src/features/channels/useChannelPaneHandlers.ts::useChannelPaneHandlers` 的
`onRequestEmptyEditDelete` 消费分支。只读原提交，不运行其中代码。
原标题、说明、按钮顺序、destructive 菜单/图标、默认弹窗布局和 modal classes
直接迁入共享 `react/messages/DeleteMessageConfirmDialog.tsx`；没有另画删除页面。
原 Native 路径恢复为共享导出且由 ChannelPane 实际导入，纠正来源 remove_paths 一条。

影响面为同一共享 ActionBar/Timeline、Native ChannelPane→Timeline/Thread→MessageRow、
两宿主真实 Composer、Web BFF 删除调用与现有中英词条生成链。
22 个代码/检查/生成路径，含两个新增原模块路径，合计 +449/-21；
本节回执单独追加，既有 checkpoint 历史删除/空行不属于本批。
精确路径及逐文件 SHA256 位于下述日志目录的
`delete-owned-paths.txt`、`delete-owned-sha256.txt`，清单 SHA256 分别为
`1e5cedd73d310b07cd88097dbe3b425374eca7c66520ea179c5227a20da7c251`、
`f85033dfea3ea3222a54b768d795ef89016355e82f21a7a3888346394a2678aa`。

Web/Desktop 共用原确认组件；主消息、线程和私聊的真实行按钮进入该确认，
清空主/线程编辑后实际 Send 按钮也进入同一个确认，不提前清空编辑或发布空消息。
取消确认保留原编辑态。只向真实本人 signer、已确认 kind9 消息提供删除，
缺身份、未确认消息、归档、未准入/中断及不活跃私聊不提供可执行删除。
Native 沿原本机持钥 `tauriMessages.ts::deleteMessage`→原 Rust delete_message；
Web 沿已有 Core 代签、同一 PublicationAccepted/AE/Relay 链，私聊使用原新准入路由
`/api/v1/conversations/{id}/messages/delete`，不误走工作区删除。
后端重新授权，UI 判断不成为权限权威；没有新注册表、删除账本或正文复制。

授权差异限于中文/英文词条、在途防重、可信 owner/scope fencing 与终态回执。
前置事实缺失停在既有 PRECONDITION/SECURITY/权限准入边界；原服务明确拒绝保留
原分类，幂等冲突不更换目标；断链/缺失确认回执为 UNKNOWN，原内容不乐观删除，
重查重用同一目标、请求正文及幂等键。UI selection 仅由确认、取消、scope 切换或
卸载终结，旧身份在途回执不能清理新身份编辑态。没有新增后端状态或迁移。
新四词条只维护 TypeScript，Mobile Dart 沿现有生成器投影；不另维护翻译权威。

实际使用原 `kailo-agent-receipt-xvkujx` SDK：4 CPU/8 GiB，Node heap3072、
Vitest maxWorkers=1，串行执行；没有 Cargo/Go、安装、镜像、bundle 或 GitNexus。
日志目录为
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/current-main-diff.nNHzVS`。
实际结果如下，均为实现后运行：

- shared `vitest run test/timeline-scope.test.tsx --maxWorkers=1`：恢复终态 9 passed/exit0，
  `delete-shared-restored.log`。
- Web `vitest run src/platform/ui/ChannelRead.test.tsx src/platform/ui/ChannelThreadPane.test.tsx
  --maxWorkers=1`：39+9=48 passed/exit0，`delete-web-ui-final.log`。
- BFF 原目标 23 passed；DM 最窄恢复目标 1 passed/22 skipped/exit0，
  `delete-web-positive-corrected.log`、`delete-bff-restored.log`。
- shared 生产/检查 tsconfig、Web、Native 四次 `tsc --noEmit` 各 exit0，
  `delete-{shared-types,shared-test-types,web-types,native-types}.log`。
- 原 `python3 tools/gen-platform-i18n.py` 与 `--check` 各 exit0，
  `delete-i18n-{generate,check}.log`；reason_text 逐字 cmp0，platform_text 新增四词条。
- 新共享文件沿原 Biome formatter，未整份重排已有宿主文件；
  22 正式输入及两宿主共享副本 cmp 全0，限定 `git diff --check` exit0。

主动破坏均仅在私有候选的真实生产对象，检查本身不改：
共享移除旧 owner 回执 fence 并误把 UNKNOWN 当拒绝，2 failed/exit1，原字节恢复后
9 passed；断开真实主/线程行 onDelete 与 empty-edit 消费分支，5 failed/exit1，
恢复后 5 passed；把实际 DM transport 改走工作区，1 failed/exit1，恢复后 1 passed。
日志为 `delete-{shared,web,bff}-{mutation,restored}.log`；原字节恢复 cmp0。
SDK cgroup max16751/oom2/oom_kill2 为旧基线，本批零增量，终态仅 sleep infinity。

失败如实保留：首轮新增 fixture 违反 Relay newest-first 被原分页守卫拒绝；
修正输入，未放宽生产；随后三个检查错误使用非线程行属性/把 banner 当 form，
改查真实行菜单及 Send 按钮。一次 Web 重叠启动主动停止 exit130；
I/O full avg10 曾为 SDK77.25/宿主46.44，两个 jsdom worker 启动超时 exit1，
主线暂停重型 builder 后原两目标成功，不把超时/停止计为通过。
额外 `dart analyze client-kit/dart/lib/shared/platform/platform_text.dart` exit255：
原 SDK 分析器创建 `/.dartServer` 被权限拒绝，`delete-dart-analyze.log`；
没有修改 HOME、装工具或伪称分析通过。上述生成同源检查独立通过。

全量分类沿已有官方上述 commit 对 apps
`32971030d1d856b4f26b19fcff02cd4939204864` 的 3323 路径快照，不重新导出百万行。
固定原字节与共享模块匹配、原 package 导出和 Native 纯导出 shim 经完整文件核对，
共实证 91 个 whole-file 候选；仅归一化本地迁移 import/export 路径、注释和格式，
保留外部依赖、函数、JSX 与字符串。189 记录见 `classification-alias-ast-results.jsonl`，
输入见 `classification-alias-inputs.json`；原字节匹配与纯 shim 证明取并集而非重复累计。
此前分类34共享→106，本批原 DeleteMessageConfirmDialog 完整迁移再增加1。
当前 `collaboration-main.classification.tsv` 为107共享迁移、7缺失需恢复、3209未分类，
合计3323；SHA256 `f4dc5d38e265c56c3322ad3b6e8056f76a8dca823c39701c67b24ecbcbb5c7aa`。
114 个已分类路径不等于114个已完整体验验收，91个文件迁移不等于全量100%还原。
尚未分类不统称治理授权；原 Report/Remind/moderation、Agent/profile/直聊与其他
原模块仍分别保留恢复目标，不因本批 Delete 完成就宣布整个 ActionBar/频道已完成。

本回执生成时尚未部署，提交/push 以后续 main 历史为准；无新版 Delete 的真实浏览器截图或端到端 Relay 删除验收；
当前在线0b与历史截图不能验本批源码。Windows/Mobile设备仍未验收。
本批未重跑 full/check-docs；主线集中收口执行原门禁，不把窄验证冒称全检通过。

## 2026-10-08 固定 main dfc7a338 官方全树 blob 对照索引

本次为无构建、无 SDK 的固定提交源码清点，不是功能/视觉验收。
只读官方 Buzz `779af8886caae1317b4de962082429867ab61503` 与 apps main
`dfc7a33835174bbaa9e43e0e335c2f12959edfeb` 的两个 `git ls-tree -r`
结果，按 `collaboration/` 原路径逐一比较 mode/type/blob ID。
没有以 worktree 脏改充作 main，也没有用历史 32971030d 快照冒充本次全量。

官方原树 5195 路径：1982 原路径 blob/mode/type 完全相同，776 原路径修改，
2437 原路径不存在；另有 119 个 Kailo-only collaboration 路径。
并集 5314 路径，原始差异 3332 路径（776 M + 2437 D + 119 A），
不折叠 rename。`collaboration/fork` 自有 20 路径不计官方产品差异。
四类加未分类的准确计数为：1982 原样保留、110 共享迁移、
0 单独归为已授权治理改造、6 已证残余缺失、3216 未分类。
未分类修改没有笼统转成“治理授权”；原路径不在也没有直接判为功能缺失。
1982 相同 blob 仅证明原源码原样保留，不证明页面已运行或功能验收通过。

精确 TSV 与既有证明索引均位于
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/current-main-diff.nNHzVS`：

- `collaboration-dfc7a3383517.classification.tsv`：5314 数据行；SHA256
  `df5d9cc72776323de5f81c379390b55afe64b346ad8cde42fe9a0c152168b3fc`。
- `collaboration-dfc7a3383517.differences.tsv`：3332 数据行；SHA256
  `517e2cd1162a0ca63e19cdbecdf4c0e42241e81ed1b25f9a30157234ca374ce8`。
- `collaboration-dfc7a3383517.identical-original-paths.tsv`：1982 数据行；SHA256
  `da2e5d83d691914351781a5433e815dc6ce6e4e18e4ab6aa61b9b9267ea806ff`。

三表列定义同源为 `upstream_commit, apps_commit, path, change_kind, category,
upstream_mode, upstream_type, upstream_blob, apps_mode, apps_type, apps_blob,
destination, evidence, historical_category`，tab 分隔，首行表头。
上游/本次 main 原树为 `buzz-779af8886c-tree.tsv`、`apps-dfc7a3383517-tree.tsv`；
后者是 apps 整树只读元数据，实际产品清点只取已声明 collaboration 范围。
迁移实证见 `dfc7a3383517-revalidated-existing-shared.tsv`、
`dfc7a3383517-revalidated-adapted-shared.tsv` 与
`classification-alias-audited-blob-ids.tsv`；110 包含 107 个此前已证迁移路径
及 3 个 Native→SDK rename 的原路径行，不将 rename 两端误算两次功能交付。
其中 40 个实际原 blob 等于迁移目的 blob、52 个既有 whole-file AST 归一化证明
核对目的模块/纯转导出字节未变、15 个既有适配模块核对固定提交或原冻结 SHA，
另 3 行为 rename 原路径；没有因为同目录或模块名相同就推定一致。

6 个已证残余缺项是官方 `desktop/src/features/channels/ui/` 下
`useChannelAgentSessions.ts` 的原 Activity/session 消费者、
`useChannelProfilePanel.ts` 与 `useChannelRouteTarget.ts` 的 Activity/session 关闭链，
以及 `desktop/src/features/channels/useChannelPaneHandlers.ts` 的 reaction 参与记录、
`desktop/src/features/settings/ui/SettingsPanels.tsx` 的原完整设置分区、
`desktop/src/features/sidebar/ui/ChannelContextMenu.tsx` 的原剩余操作。
这 6 项是上述 dfc 固定字节的已证残余，不等于剩余功能只有 6 项；
3216 未分类仍须逐模块核对，不能声称全量 diff 已验收或 100% 还原。
历史 `collaboration-main.classification.tsv` 仍指向 apps
`32971030d1d856b4f26b19fcff02cd4939204864` 的 3323 路径快照，
SHA256 `f4dc5d38e265c56c3322ad3b6e8056f76a8dca823c39701c67b24ecbcbb5c7aa`，
原件未改；其 107/7/3209 旧口径不能替代本次 5314 并集及 3332 差异统计。

## 2026-10-08 原 reaction 线程兴趣消费者与 Inbox 真实 Channel ID 恢复

本批只恢复既有原功能，不增加页面、菜单、样式、翻译或另一参与注册表。
官方依据仍为 Buzz `779af8886caae1317b4de962082429867ab61503`：
`desktop/src/features/channels/useChannelPaneHandlers.ts::handleToggleReaction`
在成功新增 reaction 后调用 `recordThreadInteraction(message.rootId ?? message.id)`；
删除 reaction 不撤销已经发生的参与事实。当前 Native 的真实生产者仍是
`collaboration/desktop/src/features/channels/useUnreadChannels.ts::recordThreadInteraction`，
沿 `AppShell`、实际 `AppShellProvider` 到两个原 main/thread 行消费者，没有替换成默认空回调。

本批实现前四项影响核对结论：

1. 权威是用户原版恢复要求、固定官方成功后回调及现有身份/Relay 准入；上游支持，宿主实际消费者缺失需适配。
   原界面组件未重画；Native 仍本机持钥，Web 仍只经既有 BFF，不创建签名、授权或存储权威。
2. 检索面覆盖 Native Pane 两行回调→已有 mutation→AppShell→原 unread/参与存储；
   Web `useChannelWindow` 原授权窗口→频道通知、Inbox 窗口/辅助事件→原分组与读标记。
   管理/profile/导航保持 Workspace ID；Relay h、bounds 与顶层读标记使用已授权 `workspaceChannel` 返回的 Channel ID。
   新 `Snapshot.channelIds` 只是当次已授权投影，不持久化，不猜两 ID 相等；无契约/数据库格式改变或数据迁移。
3. Native 仅 confirmed add 记录原 root，UNKNOWN、remove、切换身份/频道或 unmount 后晚到不记录。
   Web 从实际已授权原事件推导，不把乐观 intent 当完成；消费消息前的原 kind/scope/bounds 校验保留。
   Kind-5 目标作者/owner 准入继续由既有 Relay 负责，本批没有第二套前端权限。
4. 空/非法、外部 scope、重复 h、冒充 actor-tag、缺失/删除目标或 root 不建立兴趣；
   仅移除事件不能凭空建立历史；保留原 kind-7 的 remove 不撤销原历史兴趣。
   binding 拒绝时不读消息，最终成员复核拒绝不渲染；旧身份 binding 响应不能继续旧读取。
   发布额度、审批、执行/六类错误分类沿既有 mutation/BFF，不在本批另造状态或重新声称全路径验收。

代码写入为 11 路径 `+411/-24`，含新增共享纯模块 84 行：

- `client-kit/ts/platform/src/react/messages/index.ts`；
  `reactions/buildMessageReactions.ts`、`reactions/threadReactionInteraction.ts`；
  `client-kit/ts/platform/test/reactions.test.tsx`。
- `collaboration/desktop/src/features/channels/ui/ChannelPane.tsx`；
  `collaboration/desktop/src/features/messages/useToggleReactionMutation.test.mjs`。
- `web-client/web/src/platform/ui/ChannelPane.tsx`、`ChannelRead.test.tsx`、
  `InboxPane.tsx`、`InboxPane.test.tsx`、`inbox-events.ts`。

Web 通知真实消费 `rawEvents`，不是已过滤掉 kind-7 的显示消息数组。
Inbox 复用现有 `inboxWindowEvents` 和 `inboxReactionEvents` 的已校验 rows/aux，
不以断言把合同的 unknown events 当可信输入。顶层 mention 的读/写采用 native Channel ID，
同一实际行打开仍采用 Workspace ID；线程/消息全局事件 ID 与原 DM ID 规则不变。
页面、按钮、菜单、文案和 DOM 布局本批未改；这不是全量视觉一致性的证明。

本批证据目录（以下日志、精确 11 路径和 SHA 清单都在此）：
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/current-main-diff.nNHzVS`。
`reaction-owned-paths.txt`、`reaction-owned.sha256` 固定最终源码；
`reaction-final-input-cmp.log` 为正式/候选 11 路径及两宿主共享 6 别名，17 项全 cmp0。

复用原 `kailo-agent-receipt-xvkujx`，4 CPU / 8 GiB，Node heap 3072、Vitest 1 worker，
先核空闲进程及实际资源；未新建 SDK、安装依赖、镜像或执行 Cargo/Go/bundle。
原 Node 入口（在该容器相应原工程目录执行）与实际结果：

```sh
node --import ./test-loader.mjs --experimental-strip-types --test src/features/messages/useToggleReactionMutation.test.mjs
node node_modules/vitest/vitest.mjs run test/reactions.test.tsx --maxWorkers=1
node node_modules/vitest/vitest.mjs run src/platform/ui/InboxPane.test.tsx src/platform/ui/ChannelRead.test.tsx --maxWorkers=1
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.test.json
```

最终正向 Native 8/8、共享 19/19、Web 71/71（频道 44、Inbox 27），合计 98 项，均 exit0。
日志为 `reaction-native-final.log`、`reaction-shared-positive.log`、`reaction-web-validated-final.log`；
共享 source/test、Web、Native 四项 tsc 均 exit0，分别为
`reaction-shared-types.log`、`reaction-shared-test-types.log`、`reaction-web-types-final.log`、`reaction-native-types.log`。
共享两项类型在纯格式整理前执行；新纯模块经原缓存 Biome（`reaction-format.log`，1 file fixed），
Native 回调仅整理新增区段格式；最终字节均在下述原运行目标复验及 cmp 中固定，未重排整份宿主。

保留真实失败，不计成生产故障注入命中：首轮 Native 7 pass/1 fail 为 jsdom 缺少 rAF，
改用真实浏览器模拟动画帧后 8/8；首轮 Web 68 pass/3 fail，2 项抓到消费过滤后 events 的真实遗漏，
另 1 项是检查误写原 `Mark unread` 文案；原文案未改。Web 类型曾因 unknown events 拒绝，
已用上述原校验结果闭合。原失败分别保留在 `reaction-native-positive.log`、
`reaction-web-positive.log` 和 `reaction-web-types.log`，没有删除检查或放宽断言。

实现后私有生产破坏仅改候选、从未改正式源码：Native actual callback 改错 root 并移除晚到 owner fence，
共享移除目标 root 闭包，Web 断开 raw reaction 通知和 native-ID 读标记，并移除 unknown 数组拒绝。
`reaction-native-negative.log` 3 failed、`reaction-shared-negative.log` 1 failed、
`reaction-web-negative.log` 4 failed；三目标分别 exit1，串行脚本确认全部真实非零后 exit0。
原 5 文件保存字节恢复并比对后，`reaction-native-restored.log` 8/8、
`reaction-shared-restored.log` 19/19、`reaction-web-restored.log` 定向 13/13（58 项未重复执行），均 exit0。
最后 cgroup `oom=2/oom_kill=2` 与旧基线相同，无本批增量；已向 Wren 释放同一 SDK，没有我方在途工具链。

固定 dfc7a338 的全量索引原件没有被工作树改动追写；1982 原样/110 共享/0 独立授权/6 已证残缺/3216 未分类
仍只对应上一节固定提交。本批修的是其中 reaction 实际消费者，不宣称整个原 handler 或其余模块完成。
Web 推导限于当前已授权窗口中有真实 reaction/目标/root 的证据，不能把窗口外历史假造出来，
因此未证明与 Native 本地历史存储的所有跨设备/历史场景全等；其余原设置、Activity、Agent/Profile、
ContextMenu 等残缺及未分类项仍保留，不称 100% 还原。
本回执时 11 源码路径尚未提交/部署；当前旧 live 0b 不能验此批，没有此批新版业务截图，Windows/Mobile 未验收。
本批未重复 full/check-docs；root 原 full 的 pub.dev socket 失败为非零，不以这里的窄验替代生产门禁。

## 2026-10-08 原 Experiments 四页开关与 Forum 真实两宿主消费者

本节只记录实现后证据，不是新增规格。固定官方基准为
`779af8886caae1317b4de962082429867ab61503`；本批起点 main 为
`93cc9f0a9e1ce0838baba5213ef4060ef4f09d27`。用户要求原模块直接恢复，
Web/Desktop 共源、中文默认/英文，且无实际生产者不得生成假入口；
本人本机身份与管理经 BFF 的边界仍为 DD-75/DD-80，不把客户端开关当授权。

影响面和副作用：本批只恢复原本地 preview 偏好、原设置导航及原频道分组消费者；
未改契约、数据库、Core、Relay、Action Admission 或公共权限/额度权威。
四个开关实际影响既有 Workflows/Projects/Pulse/Forum 入口，项目子树同源隐藏；
关闭不删除页面或业务数据，原直达路由继续呈现并显示原 preview 提示。
存储损坏/未知开关沿原默认解析；原页面与治理请求保持原生产链，
结果不明的写回执、旧身份、撤权和读取失败的既有 fence 不被本地偏好绕过。

直接复用的固定官方路径/符号：

- `preview-features.json`：五项完整原 JSON 与固定官方 `git show` 的 `diff -u` 为 0。
- `desktop/src/shared/features/{types,manifest,store,resolveEnabled,useFeatureEnabled,FeatureGate}.ts[x]`：
  原默认、版本化 localStorage key、跨窗口订阅和门禁迁入共享
  `client-kit/ts/platform/src/react/features/`，两宿主实际消费同一主体。
- `desktop/src/features/settings/ui/ExperimentalFeaturesCard.tsx::ExperimentalFeaturesCard`：
  原 section、SettingsSectionHeader、SettingsOptionGroup/Row、Switch、字号和布局不重画；
  仅文案接同源中英词条。原 App/Experiments 分类接回两宿主 SettingsPanels/SettingsPane。
- `desktop/src/features/sidebar/ui/AppSidebar.tsx::AppSidebar`：
  原 Forum 分组、排序、折叠、未读、创建与实际频道选择接回；没有把论坛加入原 Stream starred 分组。
  Native 用真实本机 Channel；Web 用已获授权 workspaceChannel 的真实 channelId/channelType。
- `desktop/src/features/channels/ui/ChannelGlyph.tsx::ChannelGlyph`：
  原 Forum FileText 分支恢复至共享图标，private 仍 Lock；原项目首页 ProjectChannelIcon
  的事实/消费者尚缺，没有伪造项目首页或声称整个原符号完整恢复。

授权迁移差异逐项：共享静态 manifest 使用已固定的原 JSON 和既有类型，不新增运行时注册表；
没有为了读取随包可信 JSON 新增原 Zod 依赖。英文原文不改，新增中文与本地化 preview toast。
第五项 agentManagedProfiles 的原定义保留，但 setAgentManagedProfiles 的真实生产消费者仍缺，
不输出假生效开关；当前是 7/16 个实际设置分区，不是 16 分区或原版 100% 恢复。

Web Forum 未读不是拿 Stream 时间冒充：ChannelSidebar 的真实查询按已授权类型选择
`WebMessageType.ForumPost`，以原 `parseChannelWindowResponse(..., true)` 读取 45001 与 bounds；
`inbox-events.ts` 仍逐事件验证 scope，错误类型、错误 h、错误 bounds 均拒绝。
原 reaction/root 辅助闭包保留，read context 使用真实 native ID，
管理/导航仍 Workspace ID，未新增第二 scope 或读位置权威。
Native 真实侧栏检查使用完整 QueryClient/Platform/身份/Router/Sidebar Provider，
实际 New forum 打开原 CreateChannelDialog 并读取 `/api/v1/role-workspaces`；
该 fixture 没有创建权限，确认 0 POST，不将弹窗打开说成实际创建成功。

本批完整 35 路径清单、逐输入 SHA256 与 owned patch 位于：
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/current-main-diff.nNHzVS/`
的 `experiments-owned-paths.txt`、`experiments-input.sha256`、
`experiments-source-owned.patch`。source patch 为 35 files +671/-50，
SHA256 `fab90eb3131a11753f58b279c5afae2cb0261eb2c53d4addddaec7f2608de953`；
`git apply --reverse --check` 为 0，正式35输入及候选/两宿主物理 shared 副本逐文件 cmp 为0。
所有选中路径从本批起点到核验时 HEAD 的已提交差异为空；本节不吸收其它 inherited dirty，
尤其不包含 checkpoint 的历史删除、custom-emoji 等无关区段。

实际检查复用原 `kailo-agent-receipt-xvkujx`，4 CPU/8 GiB，
Node heap3072、Vitest maxWorkers1，开始核现存进程、HostConfig/cgroup、主机可用内存/PSI。
未安装依赖、新建环境、Cargo/Go、全量编译或 bundle。原新共享9个TS/TSX文件经现存Biome格式化；
未整份重排紧凑宿主文件。原命令在候选的对应 package 工作目录执行：

```sh
node node_modules/vitest/vitest.mjs run test/sidebar-shell.test.tsx test/projects.test.tsx test/pages.test.tsx --maxWorkers=1
node node_modules/vitest/vitest.mjs run src/platform/ui/ChannelSidebar.test.tsx src/platform/ui/SettingsPane.test.tsx src/platform/ui/ForumPane.test.tsx --maxWorkers=1
node --import ./test-loader.mjs --experimental-strip-types --test src/features/search/ui/SearchResultItem.test.mjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.test.json
PATH=/usr/lib/dart/bin:$PATH python3 tools/gen-platform-i18n.py
PATH=/usr/lib/dart/bin:$PATH python3 tools/gen-platform-i18n.py --check
```

首轮 shared 334/334（sidebar12/projects54/pages268）exit0；
最终字节恢复后 shared12/12、Web22/22（sidebar11/settings5/forum6）、Native6/6，共40/40，均exit0。
原始日志为 `experiments-shared-positive.log`、
`experiments-shared-restored.log`、`experiments-web-restored.log`、`experiments-native-restored.log`。
shared source/test、Web、Native 四项类型实际exit0，最终对应
`experiments-shared-types-restored.log`、`experiments-shared-tests-types-final.log`、
`experiments-web-types-restored.log`、`experiments-native-types-final-3.log`。
15个新中英词条沿原生成器投影至 Dart，reason_text 与正式原字节 cmp0；
生成及 --check 均exit0，日志 `experiments-i18n.log` / `experiments-i18n-restored.log`。

真实失败保留而不计作生产破坏命中：Native 首轮完整 Channel 夹具缺 description，
修正后第二轮把实际 role-workspaces 误写成 roles/workspaces；Web 新检查误写原 read key 的 channel: 前缀；
这些检查输入已按真实消费者修正，没有 mock 掉侧栏或改生产原文。
类型检查真实发现共享图标只有 Stream，继而发现管理契约 ChannelType 不含 Native DM；
按原 FileText 分支及既有完整客户端 Channel 类型恢复，不扩改 Core 合同。
还保留一次 Native tsc 路径误写 MODULE_NOT_FOUND 的调用失败；上述失败均不称通过。

实现后私有故障注入：断共享 FeatureGate、断 localStorage 持久化、将 Forum 真查询改为 STREAM、
断 Native New forum 实际回调、把 Native 实际 Forum 图标错改 Hash；
对应 `experiments-{gate,storage,forum-window,native-create,native-glyph}-negative.log`
分别2/2/1/1/1项真实失败，各exit1。每个对象从保存的生产原字节恢复后才运行最终40项，
cmp与35输入hash均0。终态 cgroup oom=2/oom_kill=2 与旧基线一致，没有本批增量。

历史固定 dfc7a338 的全量索引仍为1982原样/110共享/0独立授权/6已证残缺/3216未分类，
这里只补其中原设置/Forum真实消费者，不改写历史快照或将共享迁移视为功能验收。
Activity/session、Agent/Profile、项目完整体验、原其余设置和菜单仍有真实缺项，
项目首页图标及第五开关也明确未闭合，不能称全量原版一致。
本批35源码尚未提交/部署；新版业务截图0，待root集中共享Web候选/产物后正常SSO截图并打开复核。
旧live0b截图不证明本批，Windows/Mobile未设备验收。
本批未重复full或check-docs，不以窄验替代root原full的非零/pub.dev依赖失败。

## 2026-10-08 已部署 9bc0 Experiments 中英与 Forum 原弹窗可视复验

本节只追加上一节实现后的真实浏览器证据，不改写其当时尚未部署/截图0的历史状态。
已推送35源码批 `9de6cf7fb` 后，实际运行的固定源码为
`9bc0b023eb6e8dd7f4b73f2348aa88d8b06b0faf`；不使用旧0b/329截图证明本批。
root投递的Web镜像为
`sha256:73639ed4a0f91276dc03ca4182de143362a92bc5bd648af1df14100deadd9548`。
正常SSO后的浏览器两次GET `/app/platform-build-info.json` 均200，读回
`sha256:17b4b01ca7d31a7b3ef4d739b61cecbca8cafc382b5d729e9750c8d4a20aeb26`；与实际部署buildId相同。

复用已安装 `/usr/local/bin/playwright-cli -s=header-restoration`，1920×1080。
会话过期后以既有普通 `seam-verifier` 经正常IdP表单重新登录；
口令仅从原受控输入在内存中交给原CLI Session，不打印/复制到临时明文文件，不注入Cookie、不重置账号。
操作均为真实页面/原消费者，没有mock API、模拟业务数据或另造预览后端。

实际操作结果：

- 中文四开关原默认OFF；依次点击后四项aria-checked均true，原localStorage JSON准确保存。
- 返回应用，真实Workflows/Projects/Pulse菜单、Projects分区和Forum分区均出现；
  Projects可见目录为空，截图真实显示“暂无项目”，没有填固定项目或称非空子项通过。
- 重新进入设置并整页刷新，四开关仍ON；通过真实Appearance语言radio切English，
  Experiments标题、四项原英文名称/描述和设置导航同步切换。
- 逐项关闭并逐次返回应用，Workflows/Projects/Pulse对应菜单分别变0；
  关闭Projects时主菜单与原分区合计从2变0，关闭Forum时分区从1变0，互不误关。
- 英文OFF再次整页刷新后四项仍false，三个菜单、Projects分区和Forum分区仍均0。
- 中/英文“新建论坛”都打开原CreateChannelDialog；原名称/描述/类型/可见性/关闭/禁用提交完整呈现。
  中文实际点击临时、私有后aria-pressed均true；空名称提交保持disabled，随后关闭，没有点击创建。
- 实际Appearance radio恢复中文，并只删除本轮写入的preview偏好key恢复原null；刷新读回
  `buzz-feature-overrides-v1=null`、`buzz-locale=zh-CN`，四项OFF/入口隐藏，与检查前完全相同。

页面request观察器只记录method/path，不读请求头/正文或凭据；本轮非GET为4次
`POST /api/v1/projects/query`（现存只读目录查询），其它业务写入请求0，创建请求0。
不能将此写成“全部POST为0”。最后原CLI `console` 输出
`Total messages: 0 (Errors: 0, Warnings: 0)`；所有上述CLI操作exit0。
工具自身曾因VM无URL/Node动态import、误写settings-tab定位失败，不算产品错误或通过；
随后沿真实settings-nav与原Session调用闭合，没有新增工具或旁路。

十张实际原件均在 `/volumes/kailo/apps/.playwright-cli/`，已逐张view_image打开视觉复核：

| 文件（共同前缀 `kailo-ui-20261008-main9bc0-`） | SHA256 |
| --- | --- |
| experiments-zh-off.png | 333ab3eee6e303e3c5fede71e08bf661f4a346fdd18c8720260546402a89cc61 |
| experiments-zh-on.png | 4d0b912277fb2c14f4fc6ec984bd5372648e823abae28663431c6fccb1ff1c41 |
| sidebar-zh-on.png | fd94de931e8a551b1e26274fc319721398e77d69284244b873d0d47ca66740e3 |
| forum-dialog-zh.png | 72cb6c4acab9768085aaf8430102c2cbcc70f147e238e621351dec006cfb0421 |
| experiments-zh-refresh.png | c576cfae1dc465cf54e0ac3eabd1b24ee2fc70624a9d1053c81d412eb653d06b |
| experiments-en-on.png | 8b10dfbd20f1bcd32da29ba1498241d83a6e4bb54dc22854ce68eae52e0b9f8d |
| forum-dialog-en.png | 19e95d1795141e05bcf7b87d1118433813f87688370e18f617d9dc29594a6e15 |
| experiments-en-off.png | e753fa74d8a73218d96fdb7aac106bd505f4b3da6c4203ca08cbe6a6691c2d14 |
| sidebar-en-off-refresh.png | c028e7e7690935291c57973648e3dba243b97d7928846369a6ba2b52109f818c |
| experiments-restored-zh.png | 333ab3eee6e303e3c5fede71e08bf661f4a346fdd18c8720260546402a89cc61 |

视觉复核见原SettingsSectionHeader/OptionGroup/Row/Switch、圆角容器、原Forum表单与模糊遮罩正常呈现，
此1920×1080状态未见文字堆砌、重叠或裁切；中文恢复图与起始默认图SHA完全相同。
固定官方仍为 `779af8886caae1317b4de962082429867ab61503`，已重读
`desktop/src/features/settings/ui/ExperimentalFeaturesCard.tsx::ExperimentalFeaturesCard/FeatureRow`
核原布局/顺序；没有运行.references可执行物，不能据这10张声称原版全页像素一致。

本轮没有产品源码修改、构建/SDK作业或发布，只有本节证据追加；
未验：非空Projects子项、实际Forum创建/帖子/未读、第五managedProfiles开关及其生产者、
其余9个设置分区、Activity/Agent/Profile完整模块、三外部组件、Windows和Mobile设备。
历史dfc全量索引仍1982原样/110共享/0独立授权/6已证残缺/3216未分类，只对应该历史固定提交；
本轮不重导快照、不增加源码分类计数，不宣称100%还原或生产门禁通过。
未重复full/check-docs；由root将本节仅追加hunk集中复核入库，继承checkpoint删除不纳入。

## 2026-10-09 原图片灯箱／图库共享迁移：25 路径源码与定向证据

本节只记录当前图库批，不更改既有继承删除。关联 DD-39、DD-75、
SS-WEB-RELAY、三端主题／i18n 同源及用户固定官方原版恢复要求。
固定 Buzz 为 `779af8886caae1317b4de962082429867ab61503`；
固定 buzz-web 为 `a6766c482533d028582d0efcfd3740769f86217c`。
生成本批 owned patch 时 main 为 `db03ff3926789c7ca8c850d9f4b0825801522687`。
本节不是全树差异分类完成、发布或设备验收声明。

### 权威、影响、副作用与异常

- 上游支持：`desktop/src/shared/ui/markdown.tsx::ImageZoomOverlay/ImageBlock`、
  `markdown/ImageMosaic.tsx::ImageMosaic` 与原图库、渐进图片、菜单、缩放控件。
  直接迁移这些原完整模块到 `client-kit/ts/platform/src/react/image-lightbox/`，
  Native 原 Markdown／链接预览消费者仍沿原模块导出；Web 实际消息消费者接同一组件。
- 影响面：原灯箱开闭、滚动锁、焦点归还、键盘前后图、缩放、拖动、渐进图片、
  马赛克网格、媒体上下文菜单；两宿主仅提供复制／下载实际动作。
  13 个词条沿 TS 原权威生成 Dart；无契约、表、API、账本、正文权威或状态机变更。
- 授权接缝：Browser 仍只消费受当前 scope 约束的 imeta→BFF 内容地址，
  未背书图片保持链接，图库不加入任意远端图片；Native 保留本机原媒体动作。
  Web 复制再次经 BFF 读取，scope 替换卸载原灯箱及迟到动作反馈，不引入 Desktop IPC。
- 异常：缺媒体授权／BFF 拒绝不显示可用图片入口；加载错误撤去触发器并显示原失败态；
  隐藏剧透不可开启；空图库沿原当前图回退；上下文更换移除旧画面与副作用反馈。
  读取失败不写业务成功，复制异常仅给失败反馈；服务端既有六类错误及 UNKNOWN 语义不变。
  本批无执行写入／预留／新持久状态，相关幂等、审批间额度与在途任务无新增适用对象。

### 固定官方差异与实际恢复

新增共享 10 文件：ImageZoomOverlay、ImageBlock、imageLightbox、imageReserve、
ProgressiveImage、MediaContextMenu、ImageLightboxZoomControls、ImageGalleryStatus、
ImageMosaic、index。Native 删除的三个旧 UI 文件均已迁往共享完整实现且无旧消费者，
来源 remove_paths 只登记实际迁移；ImageMosaic、utils、imageLightbox 和菜单原路径保留精确导出。
新共享包出口、Native Markdown／链接预览、Web MessageContent 均有真实消费者，不是 helper-only。

逐项授权差异仅为共享 imports、宿主复制／下载回调、中文默认／英文词条、严格非空
图库类型及 Web 已有 BFF 媒体边界。原控件、动画、布局、圆角、键盘和网格顺序不重设计。
此前已提交 helper 比官方多出的六行 revealed-spoiler opacity 绕过没有授权，
本次删除并恢复原 `isVisibleImageLightboxTrigger` 的 `Number(style.opacity) === 0` 判定。

实际检查发现 Web 缺原 `MarkdownParagraph→ImageMosaic` 消费，
图片剧透 div 嵌在默认 p，连续图片也没有原三图网格；现已迁移原 ImageMosaic，
复用既有 classifyChildren/isImageOnlyParagraph/hasBlockMedia 与原 data-block-media wrapper。
ImageMosaic 迁移前归一 import／来源头后与固定原件 diff 0，之后只作既有 Biome 格式化。
该图库批没有重新导出全树清单；历史 dfc7 比较点的
1982 原样／110 共享／0 独立授权／6 残缺／3216 未分类不能外推为当前 main 分类完成。

### 原命令、实际终态与失败保留

复用原 `kailo-agent-receipt-xvkujx`，实际 4 CPU／8 GiB，
Node heap 3072 MiB、Vitest maxWorkers=1；启动前 top 仅 sleep，主机 available 24 GiB，
IO full avg10 4.46，cgroup oom_kill 原基线 2 未增长。没有新 SDK、下载、镜像或 bundle。
候选为 `/evidence/profile-settings-ortsoo.DRR20F/apps`；正式 25 输入／候选 cmp 全 0。

原命令（均在该受限 SDK／对应候选目录执行）：

- `python3 tools/gen-platform-i18n.py`、`--check`：0；Dart 仅新增本批 13 keys，reason_text cmp 0。
- Web：`node node_modules/vitest/vitest.mjs run src/features/chat/ui/MessageContent.test.tsx --maxWorkers=1`：
  最终 14/14，恢复后同目标 14/14，exit 0。
- Native：`node --import ./test-loader.mjs --experimental-strip-types --test --test-name-pattern="Native markdown keeps the original image trigger" src/shared/ui/markdown.test.mjs`：
  实际 Markdown SSR、原触发器与三图网格 1/1，恢复后同目标 1/1，exit 0。
- shared `tsc --noEmit`、`tsc --noEmit -p tsconfig.test.json`、Web／Native `tsc --noEmit`：各 0。
  加入 ImageMosaic 后又串行验证 shared／Web／Native 类型各 0。
- `biome format client-kit/ts/platform/src/react/image-lightbox`：最终检查 10 文件 exit 0；
  原 owned `git diff --check` 0。Native／Web旧大文件没有全份重排。
- 私有原触发器 onClick 断开：真实 Web 目标 2 failed／12 passed，exit 1。
  单独断开 Web 图片 onError 消费：真实拒绝图片用例 1 failed／13 skipped，exit 1。
  断开 Native 实际 SharedImageBlock wrapper：实际 SSR 1 failed，exit 1。
  三处按原字节还原 cmp 0，恢复后上述 Web14／Native1 均 0。
- 最早仅去掉共享内层隐藏剧透 guard 的一次试探仍 1 passed，不算负向命中，原日志保留。
  第一次共享格式检查捕获六行恢复处缩进，exit 1；修复仅空白后最终 0。
  早先组合格式入口另有缺候选配置／nested-root 配置错误，不记为完整格式通过。
- jsdom 原 SpoilerParticles 的 canvas getContext 未实现警告仍保留，不安装或模拟 canvas；
  实际 p/div hydration 警告在原段落消费者恢复后已消失。
  未运行 full、Cargo、镜像构建、发布或 Windows／Mobile 检查；不以定向目标代替全局门禁。

原件目录：
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/current-main-diff.nNHzVS/image-viewer.SYEpEQ/`。
包含 i18n-{generate,check}.log、web-positive.log、native-positive.log、四侧 *-types.log、
web-final-positive.log、native-final-positive.log、三侧 *-final-types.log、
web-hidden-guard-mutation.log、web-consumer-mutation.log、web-error-consumer-mutation.log、
native-consumer-mutation.log、web-restored.log、native-restored.log、
shared-format.log、shared-format-restored.log、i18n-final-check.log。

owned-paths.txt 为 25 路径；owned-source.patch 为 +2561/-2180，SHA-256
`4aba3d4eff558cfd51d383179180b783360633dc8381e6aeabae03af0b89650f`，
原工作树 reverse check 0。
fixed-upstream-owned-ui.patch 为固定 Buzz 8 个原 Native 路径的全文对照，不是全树分类，
SHA-256 `89e5882f52c6f121837cf60ee6e57e551c4f0af61c8bc817750b37d2ee37ef9f`。
归类为真实共享迁移和逐项宿主／BFF／i18n 接缝，不能笼统称全部已授权或 100% 一致。

本批 25 源码路径已冻结交 root 复核提交，尚未部署；没有新版业务截图。
旧线上 7e1b 的 25 张已复核截图只证明旧版已记录状态，不能验本批灯箱／网格新代码。
真实浏览器缩放、拖拽、复制／下载与当前业务图片的布局、Windows 实包、Mobile 均未验；
Mobile 不因本批 Web/Desktop 共享而增加组件宿主或绕过持钥边界。


### 2026-10-09 原 Workflows 首步骤／Inspector Escape／YAML 消费者恢复：7 路径

本批基于已推送源码 `75614a341a4f4c444bcbf28a351ea6a2c5dafe13` 的现有共享工作流实现，
直接核对固定 Buzz `779af8886caae1317b4de962082429867ab61503`；
不是将当前表单当成恢复基准，也不以本批七路径代表完整 Workflows。

#### 权威、全模块对照与四类差异

固定官方 `desktop/src/features/workflows/` 的 `git ls-tree -r` 为 67 个路径。
本批实际逐处对照的是以下原符号及现有真实消费者，没有宣称这 67 个路径均已验收：

- `desktop/src/features/workflows/ui/WorkflowDialog.tsx::WorkflowDialog`：
  原空步骤 primary action 的 `addFirstStep`、`Add first step` 标签及首个 Escape 收起 Inspector。
- `desktop/src/features/workflows/ui/WorkflowFormBuilder.tsx::WorkflowFormBuilder/WorkflowFormBuilderHandle`：
  原 `addFirstStep -> insertStep(0, "send_message")`、`closeInspector` 返回值，
  原 YAML 包装层、Textarea 的 `autoCapitalize="off"`、disabled 和原帮助文案。
- `desktop/src/shared/ui/textarea.tsx::Textarea`：
  复用已迁移的 `profile/buzz/shared/ui/textarea.tsx`，删除 YAML 模块内重复实现。
- `desktop/src/features/workflows/ui/workflowFormTypes.ts::TRIGGER_TYPES/ACTION_TYPES/SELECTABLE_ACTION_TYPES`：
  核实当前合同范围与原版仍有缺口，未通过隐藏或删除原目标将其计为完成。

四类逐项结论：

1. 原样保留：本批没有新的 whole-file 同 blob 声明；已有原 Textarea 的属性和类保持。
2. 共享迁移：原 Dialog 首步骤／Escape 与 FormBuilder handle、YAML 子树进入同一 TypeScript 主体。
   Web `PlatformApp -> WorkflowsPage -> AutomationManagement` 与
   Desktop `platform.$section -> WorkflowsPage -> AutomationManagement` 均消费此主体。
3. 已授权接缝：草稿仍为现有受控 typed/YAML 状态，不另建第二份定义；
   原首步骤按钮沿现有 workspace、创建准入、executor、任务忙态 gate，
   不能触发 Governed Action。提交／审批／quota／Temporal 链未改；
   原文案进入既有中英目录，Dart 只由原生成器投影新增两个 key。
4. 缺失需恢复：不能由本批证明完整原触发器、步骤字段、Webhook 编辑／密钥及运行轨迹。
   固定原 `TRIGGER_TYPES` 含 `reaction_added/diff_posted/webhook`，当前
   `AutomationTriggerKind` 仅 `CHANNEL_MESSAGE/MENTION/SCHEDULE`；
   原 `ACTION_TYPES` 含 `send_dm/call_webhook`，当前 `ActionEnum` 未包含二者。
   这些仍是恢复／接缝缺项，不称设计已阻断，不生成空执行入口，也不删除交付目标。

完整工程历史全量表仍为 `collaboration-dfc7a3383517.classification.tsv` 的固定比较点，
不是本批 main 的完整复核。未重导大树、不新增分类覆盖率、不声称原版 100%。

#### 影响面、副作用与边界

本批七个源码／既有检查路径 `+121/-34`，没有修改 Core、Worker、Schema、API 或数据库：

- `client-kit/ts/platform/src/react/agents.tsx`
- `client-kit/ts/platform/src/react/workflow-form-canvas.tsx`
- `client-kit/ts/platform/src/react/workflow-yaml-editor.tsx`
- `client-kit/ts/platform/src/i18n.ts`
- `client-kit/dart/lib/shared/platform/platform_text.dart`
- `client-kit/ts/platform/test/workflow-form-canvas.test.tsx`
- `client-kit/ts/platform/test/workflow-definition.test.tsx`

实际链为原创建卡片、已有准入 executor、原首步骤按钮、同一 draft/Inspector、
Escape 收起 Inspector、切 YAML 读取同一真实草稿。中英检查均无非 GET 请求。
disabled draft 不得经 handle 写入；无选中节点 closeInspector 返回 false。
忙态／已准备 intent 仍拦截关闭，原 filter picker Escape 先消费，不触发丢弃草稿。
YAML 继续沿原解析和 immutable version/pin guard；撤权、version 改变、pin 缺失不打开陈旧正文。
没有新增异步状态、外部副作用、重试、投影或额度状态，不引入新迁移／错误码。
沿 06 §4 原分类：认证／scope／权限为 DENIED；既有明确设计阻断为 BLOCKED；
executor／任务 readiness 为 PRECONDITION；quota／容量为 LIMIT；版本／幂等并发为 CONFLICT；
副作用不明仍为 UNKNOWN，既有显示／准入不变，不把不明结果变成功或失败。
Web 管理仍经 BFF、浏览器不持钥；Desktop 管理同样经 BFF，Relay 本机持钥链未改。
Mobile 仅同源文案生成，不增加工作流宿主／组件页或 WebView。

#### 实际命令、正反结果与还原

证据目录：
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/current-main-diff.nNHzVS/workflow-editor.yrqvYl/`。

复用 `kailo-agent-receipt-xvkujx`，实际 inspect 为 4 CPU／8 GiB，
`cpu.max=400000 100000`、`memory.max=8589934592`；启动前只有 sleep，
available 约 22.5 GiB。Node heap 3072 MiB、maxWorkers=1，原缓存未安装／替换。
终态 cgroup `oom=2/oom_kill=2` 与旧基线相同，无新增 OOM。

- 原目标：`vitest run test/workflow-form-canvas.test.tsx test/workflow-definition.test.tsx --maxWorkers=1`，
  `positive-original.log`：2 files、34 passed，exit 0。
- 私有生产破坏一：只移除实际 AutomationAction 到 Canvas 的 `ref={formBuilderRef}`，
  原实际弹窗中英目标各失败，节点数应为 2 实为 1；
  `negative-dialog-ref.log`：2 failed／9 skipped，exit 1，不是只破坏 helper。
- 私有生产破坏二：恢复 ref 后，只绕过实际 Dialog `closeInspector` 消费分支，
  中英目标均因 Inspector 仍存在失败；
  `negative-dialog-escape.log`：2 failed／9 skipped，exit 1。
- 两处按正式原字节还原，七输入逐一 `cmp` exit 0。
  同原两目标 `restored-original.log`：34 passed、exit 0；没有改 timeout 或放宽断言。
- Shared 生产、Shared 检查、Web、Native 依次 `tsc --noEmit`
  （检查侧另加 `-p tsconfig.test.json`）：四个 exit 0，
  `type-shared.log/type-shared-test.log/type-web.log/type-native.log`。
  两宿主实际安装的共享包四个生产文件同步且 cmp 0。
- 原 `python3 tools/gen-platform-i18n.py` 与 `--check` 均 exit 0；
  `reason_text.dart` cmp 0；只有 `workflows.addFirstStep/workflows.yamlDirect` 的 Dart 同源生成。
- 首次 Dart 尾验未设原 PUB_CACHE，`dart-i18n.log` exit 1：
  `PathAccessException: Creation failed, path = '/.pub-cache' (Permission denied)`。
  此次失败完整保留、不算通过；查明原 `tools/check.sh` 投递为 `PUB_CACHE=/cache/pub` 后，
  沿现有已缓存目录执行
  `PUB_CACHE=/cache/pub dart test --no-chain-stack-traces test/platform_i18n_test.dart`，
  `dart-i18n-original-cache.log`：8 passed、exit 0，没有安装依赖或新建缓存。
- 七路径 `git diff --check` 与源码 patch reverse check 均 exit 0。
  `owned-source.patch` SHA256：
  `2f1b88e6b8d3a6ac09871609d89adf064a05f54ea97340e1c9ef963f9639f0c6`。

#### 提交、视觉及设备边界

七源码与本段新增 EOF 冻结交 root 选择性提交，既有 checkpoint 删除不纳入。
本批没有 bundle、镜像构建、full 或部署。新源码 Playwright 业务截图为 0；
现网仍为 7e1b/50c362 的旧版，旧 25 图不能验本批首步骤／Inspector／YAML。
原 Dialog 父布局、scope 表现、全部步骤／运行详情及真实创建运行尚未完整逐状态视觉验收；
本批 DOM/类型证据不等于完整外观一致，更不等于 Windows 安装包或 Mobile 设备验收。

### 2026-10-09 工作流放弃草稿后页面指针锁：恢复固定官方单副本约束

#### 权威、根因与完整差异边界

本批由 a8c1 真实中英文截图发现的失败驱动，不是新 UI 设计：
Dialog/AlertDialog 已关闭，但 body pointer-events 仍为 none，正常个人菜单点击 30 秒超时。
原图、实际 17 张逐张复核范围及图库四次上传／两图消息事实见
[本轮实拍](../../web-client/fork/verify/screenshots-20261009-a8c1.md)。

固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的
`pnpm-workspace.yaml::overrides` 已明确将
`@radix-ui/react-dismissable-layer` 固定为 `1.1.19`。
其原 #1482 注释直接解释不同副本各自保存 body pointer-events，关闭后可能留 none。
固定 `pnpm-lock.yaml` 也只有这一层版本。
Kailo `collaboration/pnpm-workspace.yaml`／其锁已保留该约束；
迁往 apps 根 pnpm 与独立 Web npm 工作区时漏了它。

修改前实际依赖链是 Dialog 1.2.0→layer 1.1.20，
AlertDialog 1.1.23→其内部 Dialog 1.1.23→layer 1.1.19。
本批只迁回官方原约束，不降级或升级 Dialog，不更改
`AutomationAction::requestClose/onDiscard`、
`WorkflowDiscardDialog` 或原 Dialog/AlertDialog 生命周期。
不加 body 样式重置、延时、force click、绕行确认或新控制。

四类：原样保留为当前关闭 JS／布局未改；共享迁移为官方 dependency override
进入共享工作区与 Web 宿主原锁；没有新增治理改造；完整原工作流／设置／页面差异仍未恢复。
最新完整 union 仍仅固定 a8c1 比较点：5314 路径，
1978 原样保留、110 窄共享证据、0 笼统治理授权、3226 尚无充分保留或授权证明。
不把本次五路径或源码分类称为当前全树功能／像素已验收。

#### 影响面、副作用与异常

五个源码／既有检查路径 `+15/-111`：
`package.json`、`pnpm-lock.yaml`、`web-client/web/package.json`、
`web-client/web/package-lock.json`、
`client-kit/ts/platform/test/workflow-actions.test.tsx`。
两个 manifest 各加一条官方约束，pnpm 去除 1.1.20 的 package/snapshot，
四个引用收敛至 1.1.19；Web 去除三个过期嵌套 1.1.20 节点。
其它已锁 package 版本、原 virtua patch 和其既有 dependencies 分类均保留。

这条约束作用于 Web/Desktop 共源工作区及实际 Dialog、Menu、Popover、Tooltip；
Native 原 workspace 自有约束已成立，不无故改其版本。
Web Browser 不持钥、管理经 BFF；Desktop 本机持钥／管理 BFF 不变，Mobile 不增宿主能力。
不改 Schema/API、数据库、工作流执行、授权／审批／quota／审计和六类错误分类。
没有新增持久状态、重试或外部副作用。Keep editing 必须继续锁住底层编辑器；
实际丢弃两层后恢复进入前的 pointer-events。已有 busy/UNKNOWN 不出现丢弃入口，
原同意图重查保持，不将结果不明转成功／失败。

#### 实际命令、失败、破坏与还原

原件目录：
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/current-main-diff.nNHzVS/workflow-discard-layer.7LTJMH/`。
复用原 `kailo-agent-receipt-xvkujx`：4 CPU／8 GiB，Node heap 3072 MiB、单 worker；
启动前只有 sleep，宿主 available 约 23 GiB、memory PSI 0，IO full avg10 约 2%。
终态原 cgroup oom/oom_kill 仍为 2/2，无新增 OOM；没有新 SDK、bundle、镜像或 full。

- 原 pnpm 10.33.4 的 offline lock-only 首次缺默认 metadata；
  指定原 cache 后缺 virtua metadata，两个 exit 1 均保留。
  同原 resolver 用 prefer-offline lock-only 退出 0，没有全库 update；
  投递正式 workspace/virtua patch，排除无关 virtua optional 分类漂移。
- npm 11.19 的 lock-only／定向 update 虽 exit 0，但仍留下失效副本；
  原 npm ls 实际报 ELSPROBLEMS。dedupe offline 缺 lightningcss metadata，exit 1。
  只移除三个已证明过期节点后，原 npm lock-only 与 npm ls 均 exit 0，
  Dialog/Menu/Popover/Tooltip 实际全部 dedupe 到 1.1.19。
  没有删除其它依赖或手写替代模块。
- `pnpm install --frozen-lockfile --offline --ignore-scripts` 使用原 store/cache：
  exit 0，293 包缓存复用、downloaded 0；
  `npm ci --dry-run --offline --ignore-scripts --no-audit --no-fund` exit 0，
  计划仅移除三处旧副本，不把 dry-run 称为实际 Web 安装或打包。
- 原 `vitest run test/workflow-actions.test.tsx test/workflow-definition.test.tsx --maxWorkers=1 --reporter=verbose`：
  positive-original.log 为 2 files、50 passed、exit 0。
  既有真实 dirty Edit/Keep editing/Discard/Create 重开消费者检查实际 body 样式，
  原 UNKNOWN、双语草稿、首步骤和 Inspector 链保持通过。
- 私有生产破坏只恢复原 root manifest/lock 的依赖分叉，
  原 frozen/offline resolver 安装 exit 0（5 包缓存、downloaded 0），未改正式源码。
  同原 actions 目标按两个关闭用例筛选：
  negative-original-split.log 为 1 failed／1 passed／37 skipped、exit 1；
  精准命中已无两层 Dialog 但 body 为 none：`expected 'none' to be ''`。
  第二用例的通过不证明旧分叉安全；第一个真实关闭消费者已抓住目标故障。
  negative-resolution.log 证明 direct Dialog 为 layer 1.1.20、Alert 内部 Dialog 为 1.1.19。
- 两私有输入恢复后，原 frozen/offline resolver exit 0，
  同原完整两目标 restored-original.log 为 50 passed、exit 0。
  五正式输入逐一 cmp 0；restored-resolution.log 证明两条实际链同指一个 1.1.19 文件。
- Shared 生产／Shared 检查／Web／Native 四次原 tsc --noEmit 均 exit 0，
  检查侧加 -p tsconfig.test.json；type-shared.log、type-shared-test.log、
  type-web.log、type-native.log。源码 diff --check 退出 0。
- owned-source.patch SHA256：
  `9adf90b8d1780b492ba67089289c84f2be438efbedd3b811d52b393c0e005e2d`。

#### 提交与实拍边界

五输入与本节新增 EOF 冻结交 root 精确提交；checkpoint 继承删改不纳入。
本批修复尚未部署，新修复浏览器截图为 0。
已上线 a8c1 的 17 图是失败发现与旧版局部验收，不冒充修复通过；
待 root 集中发布后，再正常 SSO 复验 dirty discard→个人菜单及 Keep editing 双层状态。
未运行本批 full、镜像构建、Windows/Mobile 设备验收，不声明完整 Buzz 或生产就绪。

### 2026-10-09：原普通频道消息/子树读未读消费者（未部署）

本批为 9 个源码/原检查路径，+531/-206；未新增布局、菜单类型、业务接口或读状态权威。
Root 独立修正的 `client-kit/ts/platform/test/settings.test.tsx` 不在本批源码 patch 中。

#### 权威、影响面、副作用与边界

1. 权威：`DD-40`、`DD-75`、`SS-WEB-RELAY` 与 `.design/03` 的 UserState 权威边界不变。
   固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的
   `desktop/src/features/channels/ui/useChannelUnreadState.ts::handleMarkMessageRead/handleMarkMessageUnread`
   明确规定普通频道未读是会话覆盖，不向后写持久 marker；离开清除消息覆盖，重开清除本机 manual 来源。
   `desktop/src/features/channels/lib/subtreeCreatedAt.ts::collectReplyDescendantIds` 为原已加载子树遍历依据。
2. 影响面：共享 `forcedUnreadStore.ts::useForcedUnreadActions`、Native 原路径转导出、Web 主消息/线程行、
   SignedIn 可信身份分区及 ChannelSidebar 实际 manual 来源消费者。持久读写仍消费现有 BFF CAS；
   schema、数据库、Workflow、Core/Worker、Mobile 未改。管理导航仍 Workspace ID，marker 使用已准入真实 Channel ID。
3. 副作用：普通频道标未读不发 CAS、不降低整个频道位置；标已读逐个真实 `msg:<id>` ACK 后才清覆盖。
   身份/频道切换、后台、撤权、metadata 未定或 UNKNOWN 时不继续子树写入、不自动重放。
   UNKNOWN 的显式重试沿原 request/version；更高版本 readback 只 fence 旧意图，不伪造成功。
4. 边界：实际原行菜单覆盖主面板与线程；已加载折叠后代参与原遍历，同秒无关消息不被标未读。
   自动读不能立即覆盖手工未读；离开/重开恢复原生命周期；侧栏 manual baseline 遇更新的同步 marker 让位。
   原 store 保留既有有界本机展示缓存与多来源行为，不同步为第二份 Core 读状态权威。

#### 原版差异与准确缺项

- 原 `desktop/src/features/channels/forcedUnreadStore.ts` 的 blob 为 `e2b626042afc4a8e72cad92b90b4d759bb2e4517`。
  共享迁移仅在原 `Object.hasOwn` 守卫后的索引新增类型擦除 `!`，适配共享 `noUncheckedIndexedAccess`；
  原运行逻辑、存储格式与边界不变。精确差异为本批证据目录的 `official-forced-unread.diff`，不声明共享 blob 完全相同。
- Web 身份键来自可信 tenant/principal；持久写改接既有 BFF CAS，而非原生直接读 marker 传输。
  两宿主消费同一原 store 与原 MessageActionBar；Native 本机凭据/Relay 边界未改变。
- DM 的既有 Native `useUnreadChannels.ts::markMessagesUnread` 是 Kailo 改造，不是该固定官方版本的同名实现。
  Web DM 的可信读传输/同秒边界未在本批闭合，原恢复目标保留为缺项，不用 loaded 集合补写算法冒充等价。
- 沿用已有全量分类产物；a8c1 快照的 union 5314、原样保留 1978、共享迁移 110、授权整文件 0、
  缺失需恢复/尚未证明保留或授权 3226 仅是该旧固定比较点，不冒充当前 main 已逐处验完。

#### 实际命令、正反结果与原始日志

既有 SDK `kailo-agent-receipt-xvkujx` 实读 4 CPU/8 GiB；执行前仅 sleep，host available 24.6 GB，
IO full avg10 7.41，memory pressure avg10 0。Node heap 3072 MiB、Vitest maxWorkers=1，串行，无新 SDK/依赖安装。
候选既有源码/已安装 file-package 的真实共享闭包做最小同步与 cmp；React 19.2.8、Web Vitest 4.1.11、
原 dismissable-layer 1.1.19。共享 TS 5.9.3、Web/Native TS 6.0.3 为各自既有实际工具。

原候选 `/evidence/profile-settings-ortsoo.DRR20F/apps` 内运行：

```text
pnpm exec vitest run src/platform/ui/ChannelRead.test.tsx src/platform/ui/ChannelSidebar.test.tsx --maxWorkers=1  (web-client/web)
node --import ./collaboration/desktop/test-loader.mjs --experimental-strip-types --test collaboration/desktop/src/features/channels/forcedUnreadStore.test.mjs
pnpm exec vitest run test/settings.test.tsx --maxWorkers=1  (client-kit/ts/platform)
node <各既有工程>/node_modules/typescript/bin/tsc --noEmit -p <各既有工程>
```

- 最终正向/还原：Web 65/65（52+13）、Native 原 store 6/6、Root settings 原目标 22/22，均 exit 0；
  shared/Web/Native 三 host types 均 exit 0。最终 Web 测试导入原 `compareRelayOrder` 后类型再次 exit 0。
- 私有生产破坏：断开实际主消息/线程行的 onMarkUnread、破坏侧栏 native-ID manual 来源与实际回调，
  Web 原两目标真实 7 failed/58 passed、exit 1；未用 helper-only 检查代替行消费者。
- 私有 settings 仅删除原 App/experimental nav，原目标真实 1 failed/21 passed、exit 1。
  四生产源恢复与正式字节 cmp 全 0 后，同原目标恢复为 Web 65/65、settings 22/22、exit 0。
- 初始两轮新增同秒夹具未满足原 Relay 复合排序，Web 各 2 failed/63 passed；原校验正确拒绝，
  改用原比较函数后通过，没有放宽校验。初轮 shared 严格索引类型失败按上述类型擦除修正。
  初轮 Native pnpm 尝试其声明的包管理器自投递而 EACCES，未执行 tsc；没有安装，后用既有真实 tsc 验证 0。
  这些失败原日志保留，不计作生产保护破坏命中。既有 linkify 重复初始化 warning 未隐藏。

原始证据目录：
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/current-main-diff.nNHzVS/message-read-menu.KK6rmq`。
关键日志：`final-ordered-web.log`、`final-native.log`、`positive-settings.log`、`final-type-{shared,web,native}.log`、
`final-ordered-type-web.log`、`negative-web-consumers.log`、`negative-settings-nav.log`、
`restored-inputs.log`、`restored-web.log`、`restored-settings.log`、`final-cgroup.log`。
最终 cgroup OOM/oom_kill 仍旧基线 2，无本批增量；原 SDK 已释放。

`owned-source.patch` SHA256 `02e3a8a48aa6f165493af58622ec1197250d98094bf7da44392a26eeb0874838`，reverse check 0。
`owned-inputs.sha256` SHA256 `3352b8ed9e958f17c34f2052c2cc030b62e9fee2f0a3c151aff87d29d2d11f2e`。
9 源码与仅本节 owned EOF 冻结交 root 精确提交，checkpoint 继承删改不纳入。
本批未构建/部署、对应新版浏览器截图 0；已上线 c309 的正常 SSO 图仅证明其部署版本，
不覆盖本批读未读恢复。未运行本批 full、Windows/Mobile 设备验收，不声明全部原版还原或生产就绪。

### 2026-10-09：原会话外观行与 Inbox 类型共源恢复（源码候选未部署）

本批 12 个源码/原检查/同源词条路径，+282/-87。源码冻结交 root，未自行提交、构建或部署。
关联 `DD-40`、`DD-53`、`DD-75`、`DD-111`、`SS-WEB-RELAY` 及用户固定官方原版恢复要求。

#### 权威、影响面、副作用与边界

1. 权威：固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的
   `desktop/src/features/settings/ui/AppearanceSettingsControls.tsx::ConversationDisplaySettings/ConversationPreview`
   与 `desktop/src/features/home/lib/inbox.ts::feedHeadline/getInboxTypeLabel/isThreadActivityItem`。
   复用原 `SettingsOptionRow`、Eye、预览文案和全部类型分支，不新设计控件或布局。
2. 影响面：共享 Appearance/Inbox 模块、Native 原 lib 转用同一 formatter 与列表消费者、Web
   Inbox 实际行消费者、既有专项、TS 单源词条生成的 Dart 投影。所有 `ConversationDisplaySettings`
   调用处均传现有运行配置 `name`；`DD-111` 品牌差异不改成硬编码。schema/API/数据库/执行权威未改。
3. 副作用：formatter 只消费宿主已经准入的事件、目录频道名和资料，不扩大 feed admission、增加筛选
   入口、发现权限或写动作。原本机偏好格式/生命周期不变，不增加第二份账号、权限、读状态或工作流权威。
4. 边界：保留原项目引用校验、DM 优先、mention/needs_action、仅标记回复且非 broadcast 才算线程、
   无频道名、空 sender、未知 kind/default、空正文与根 subject 回退；不猜身份。缺生产者的项目/提醒等
   分支仅原显示函数保留，不代表实际 feed 已接通。UNKNOWN/拒绝入口没有因本批变为成功。

#### 逐项原版差异

- `ConversationDensityPreviewMessage` 和既有 `SettingsOptionRow` 对固定原函数正文比较一致。
  会话字号/密度行接回原 `SettingsOptionRow`，移除自行包出的 container/flex 布局；会话预览补回原 Eye。
  英文密度说明、第二段预览和第三段中的 DMs 直接恢复原文，中文沿单源映射；品牌只用运行配置 `{name}`。
- 原 `desktop/src/features/home/lib/projectInbox.ts::getProjectInboxReference/isProjectInboxItem` 的纯显示
  引用判断与原 inbox formatter 迁入共享 `src/inbox.ts`，原全部 kind/category 分支保留。
  Native 删除重复 formatter，`InboxListPane` 和 Web `InboxPane` 均实际消费共享函数与当前 locale。
  修复 Web 顶层活动错误套用 “Thread in”；真实线程、mention 和 DM 不被错误替换。
- 22 个原类型词条、3 个已有外观词条由 TS 权威同步到 Dart；原生成器运行，正式生成文件与候选 cmp 0。
  `reason_text.dart` cmp 0，未改 contracts。Mobile 没有 densityDescription 的页面调用方，不造新页面。
- 本批不是整个 Inbox 双语闭合：Native `lib/inbox.ts::formatInboxTypeLabel` 仍默认英文；
  `ui/InboxDetailPane.tsx:343` 实际调用未传 locale，336–349 的 Thread/Message/Open 提示仍原英文。
  `ui/HomeView.tsx:486–507` 的 Home feed unavailable/Try again 和 625–654 的回复错误/You 仍原英文，
  未在这 12 路径内修复；不能称 Native Home 全面中文闭合。
  原详情页其余迁移、缺失 feed 生产者与原 8 筛选完整能力继续列为恢复项，不生成空入口。

#### 实际命令与正反结果

复用 `kailo-agent-receipt-xvkujx`，实际 cgroup 4 CPU/8 GiB，Node heap 3072 MiB、Vitest 1 worker，串行。
执行前仅 sleep、host available 约 20 GiB、memory pressure 0；IO full 高达 66.97%，不改原超时。
正式 12 输入与候选 cmp 全 0；共享生产模块及两宿主真实已安装包副本同步，未造 stub/声明补丁。
最终 `memory.events` oom/oom_kill 仍旧基线 2/2，max 16751，无本批增量。

```text
pnpm --dir client-kit/ts/platform exec vitest run test/settings.test.tsx test/inbox.test.tsx --maxWorkers=1
pnpm --dir web-client/web exec vitest run src/platform/ui/InboxPane.test.tsx --maxWorkers=1
cd collaboration/desktop && node --import ./test-loader.mjs --experimental-strip-types --test src/features/home/lib/inbox.test.mjs
node client-kit/ts/platform/node_modules/typescript/bin/tsc --noEmit -p client-kit/ts/platform
node client-kit/ts/platform/node_modules/typescript/bin/tsc --noEmit -p client-kit/ts/platform/tsconfig.test.json
node web-client/web/node_modules/typescript/bin/tsc --noEmit -p web-client/web
node collaboration/desktop/node_modules/typescript/bin/tsc --noEmit -p collaboration/desktop
PATH=/usr/lib/dart/bin:$PATH python3 tools/gen-platform-i18n.py
PATH=/usr/lib/dart/bin:$PATH python3 tools/gen-platform-i18n.py --check
```

- 首批 78653 terminal 1：共享 Inbox 17/17；Settings fork 启动超时、0 case；Web 启动超时、0 case。
  Native 16/16；四 types 与生成/检查全部 exit 0。启动失败不算生产破坏命中，也不隐藏。
- 仅一次获准热缓存补验 76971：共享 Settings 24 + Inbox 17 = 41/41、exit 0；Web 仍启动超时
  0 case、exit 1，整批 terminal 1。未改 timeout/断言、未重复求绿，Web DOM 消费者专项本批未验。
- 私有实际生产破坏 33115：移除原 Eye、将原顶层活动回退误标为 Thread；共享真实 3 failed/38 passed、
  exit 1（中/英 Eye 两项、类型分支一项），Native 1 failed/15 passed、exit 1（真实 buildInboxItems
  输出后的原 formatter 调用）。没有仅破坏检查自身或用 mock 掩盖生产模块。
- 精确还原源与两个已安装副本，cmp 全 0；58448 terminal 0：共享 41/41、Native 16/16、
  i18n check exit 0。候选正式 12 输入再次 cmp 全 0，owned diff --check 0、source patch reverse check 0。
- 原 SDK 与 I/O 窗口已明确释放给 Wren；无本批在途工具链。不运行本批 full、镜像、Windows/Mobile 验收。

原始目录为
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/current-main-diff.nNHzVS/appearance-original.osJLfK`。
日志：`shared-positive.log`、`web-positive.log`、`native-positive.log`、`{shared,shared-test,web,native}-types.log`、
`i18n-{generate,check}.log`、`{shared,web}-warm-positive.log`、`{shared,native}-negative.log`、
`{shared,native}-restored.log`、`i18n-restored-check.log`。source patch SHA256
`29b96e07514ef2e3745352dd143e0756ee08e253043ca28917ebc8dcfc98ffce`；输入清单 SHA256
`953ec23e1487024f509b8c3588081dd6baf48d02cbd9da5b9163f82bbd35ed88`。

#### 当前固定主干全树比较点

复用已有 `export_main_diff.py`/原 `tools/upstream_manifest.py diff`，固定 main
`e5c6ada467063984a4c7f644e17e21f993a5be58` 对固定官方 779af，真实 exit 0；不包含这 12 个未提交候选。
两仓库 `git ls-tree -r` 全树 union 5314：官方 5195、collaboration 2874（排除自有 fork）。
同路径模式/type/blob 一致 1977；变动路径 3337 = M 778 + D 2440 + A 119。
原工具 -M patch 统计为 3329 files、+37724/-746261、1043580 行；rename 合并使其文件数与 union 变动路径数不同。

四类：原样保留 1977（仅源码 blob 实证）、共享迁移 111（110 个历史窄证据目的地 blob 逐个未变，
另 1 个完整 forcedUnreadStore 迁移），整文件已授权治理改造 0、缺失需恢复/尚未证明保留或授权 3226。
新 store 迁移原 blob `e2b626042afc4a8e72cad92b90b4d759bb2e4517`→共享
`375849a2e84b74825d0e0deda5658f1f2662317a`，全文仅原 hasOwn 后的类型 `!` 差异；Native 真实转导出。
3226 是恢复或逐项授权证据队列，不是已证业务缺功能数量。未逐处验收，分类不是完成率。
旧 a8c 的 5314/1978/110/3226 明确保留为历史，不能当本次主干快照。

完整原件在上述目录的父目录：`collaboration-e5c6ada46706.patch` SHA256
`838e10cd731855fa479eea0ae1ab41b1001379ae954b746e93458d3dd7f2826d`；
`collaboration-e5c6ada46706.classification.tsv` SHA256
`c2b611d26a79bade5cebd94534d4340792de2ef2fe73612f7db1da2f7cabda4e`。
TSV 14 列保留双方 commit/path/change、四类、双方 mode/type/blob、迁移目的地、证据与历史分类。
不能把原路径删除直接当功能缺失，也不能把未知差异都写成授权治理。

#### 实拍与仍未覆盖的范围

独立冻结回执 `web-client/fork/verify/screenshots-20261009-c309-settings-readonly.md` 为旧 c309 的 8 个有效状态。
另 5 个 c309 实拍均已打开：同原件目录 `kailo-ui-20261009-mainc309-` 前缀下的
`inbox-readonly.png`、`people-readonly.png`、`agents-readonly.png`、`agent-definition-readonly.png`、
`inbox-filter-readonly.png`，分别为真实 Inbox、2 个已准入成员、空 Installation/1 个 Definition、
原定义版本读取和仅 5 个已接入筛选。不是完整原 Agent profile 或原 8 筛选恢复。
独立 `screenshots-20261009-5ba-read-menu.md` 为新 5ba 的 8 张已打开实拍，真实他人既有消息
正常菜单未读→已读、BFF PUT 200/version 36 与非成员拒绝，最后恢复当前用户已读状态。
这些线上图片均不含本批外观/Inbox 源码；新版候选浏览器实拍仍 0，不能称 UI 已发布或 100% 还原。

## 2026-10-09 原 Inbox 双语真实消费者集中恢复（源码验收，未部署）

### 权威、影响面、副作用与边界

1. 权威是用户原版一致性／中文默认英文适配要求、`V-REQ-24`、
   `SS-WEB-PRESENTATION` 与 `DD-75`；固定 Buzz
   `779af8886caae1317b4de962082429867ab61503` 的
   `desktop/src/features/home/lib/inbox.ts::{feedHeadline,feedPreview,categoryLabelFor,formatInboxTypeLabel,buildInboxItems}`
   为原英语与分支依据。本批只复用显示逻辑、传递 locale；不改已定治理。
2. `rg` 找到 `buildInboxItems` 两个实际生产读方
   `desktop/src/features/home/ui/HomeView.tsx::HomeView` 与
   `desktop/src/features/sidebar/ui/ChannelActivityPopover.tsx::ChannelActivityPopover`，
   均接同源 locale。`InboxDetailPane.tsx::InboxMessageDetailPane` 消费
   `formatInboxTypeLabel(item, locale)`；`InboxListPane` 的原缺频道提示同源。
   Web `InboxPane` 行预览直接消费共享 `feedPreview(item, locale)`。
3. 本批不改身份、scope、授权、read CAS、hover、UNKNOWN、发送或事件准入；
   不增加筛选、feed 生产者、页面、接口、注册表或状态权威。需要处理的
   原禁回复原因只换同源文案，不把不可用能力变成临时按钮。
4. 原空内容与首尾空白处理全部保留，正文不翻译；原 `feedPreview` 的 trim
   必须实际进入 Web 的同一消息渲染器，否则四空格正文会成为 Markdown 代码块。
   locale 切换不重取身份；频道不存在仍禁回复。超时、撤权、旧身份迟到、
   幂等和未确认写回执沿已有治理消费者，本批没有改变其终结规则。

### 本批写入与固定源码差异归类

13 个源码／原检查／生成路径，合计 **+275/-46**；起点这些路径均无继承 dirty。
共享 `client-kit/ts/platform/src/inbox.ts::{feedPreview,categoryLabelFor}`
迁移原全部分支，删除 Native 两个缩水副本；
`buildInboxItems` 将 locale 同时送入原 headline、preview 与 category。
这部分归共享迁移，不将原路径迁移等同功能缺失。

固定原 `desktop/src/features/home/ui/InboxDetailPane.tsx::InboxMessageDetailPane`
的 Thread／Message／上下文加载／禁回复文案和
`desktop/src/features/sidebar/ui/ChannelActivityPopover.tsx::{ThreadPreviewRow,ChannelActivityPopover}`
的频道活动／未读／读标记文案保持原英语、布局和行为，只增中文适配。
原 `homeMessageCapabilities.ts::getHomeMessageCapabilities` 的既有准入 guard 未改变。
21 个同源键由原 `tools/gen-platform-i18n.py` 生成 Dart；
`reason_text.dart` 与正式文件 cmp 0，未修改 contracts 或手写第二份词条。
这部分是逐项授权的 i18n 差异，不称整文件全部治理授权。

Web 最初非空预览绕过原 trim 已纠正为直接 `feedPreview`；
实际 Inbox 行专项覆盖空态中英、首尾空白的正常段落／非代码块、语言切换不重取身份。
Native 专项覆盖实际行生产者／类型标签及真实禁回复 guard；
不是 Native 安装包或整个原 HomeView 的浏览器验收。

精确源码补丁在
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/current-main-diff.nNHzVS/inbox-locale.Ol1Dhm/owned-source.patch`，
SHA256 `1d3637903fef8e2ff09b2c383db7fcfe5db9d17c14b3ceeccb99d0af2c7aee9d`，
`git apply --reverse --check` exit 0。

### 原始运行结果与真实破坏／还原

复用 `kailo-agent-receipt-xvkujx`、候选
`/evidence/profile-settings-ortsoo.DRR20F/apps`，实际 4 CPU／8 GiB、
Node heap 3072 MiB、同一原依赖缓存；无安装、新 SDK、Cargo、bundle 或 full。
执行前容器仅 sleep，回读 `cpu.max=400000 100000`、
`memory.max=8589934592`；各阶段 `oom/oom_kill=2/2` 旧基线未增加。
冻结源码、锁定 manifests、候选和两宿主 installed shared 副本已逐字节 cmp。

原目标命令（分别在共享／Web／Native 目录执行）：

```sh
./node_modules/.bin/vitest run test/inbox.test.tsx --pool=threads --maxWorkers=1
./node_modules/.bin/vitest run src/platform/ui/InboxPane.test.tsx --pool=threads --maxWorkers=1
node --import ./test-loader.mjs --experimental-strip-types --test src/features/home/lib/inbox.test.mjs
python3 tools/gen-platform-i18n.py
python3 tools/gen-platform-i18n.py --check
node client-kit/ts/platform/node_modules/typescript/bin/tsc --noEmit -p client-kit/ts/platform
node client-kit/ts/platform/node_modules/typescript/bin/tsc --noEmit -p client-kit/ts/platform/tsconfig.test.json
node web-client/web/node_modules/typescript/bin/tsc --noEmit -p web-client/web
node collaboration/desktop/node_modules/typescript/bin/tsc --noEmit -p collaboration/desktop
```

日志原件目录为上述 `inbox-locale.Ol1Dhm`。

- 64806 编排 exit 1：gen／check exit 0；Native 18/18 exit 0；
  共享／共享检查／Web／Native 四项 `tsc --noEmit` 各 exit 0。
  共享与 Web 默认 fork worker 分别 64.12s／61.01s 启动超时，0 case、各 exit 1；
  `shared-positive.log`、`web-positive.log` 保留，不算通过。
- 29207 编排 exit 1：固定 Vitest 4.1.11 不接受 `--minWorkers`，
  两目标解析阶段 0 case、各 exit 1。保留 `shared-final-positive.log`、
  `web-final-positive.log`；Native 18/18、最终 trim 字节下 Web 类型与 i18n check exit 0。
- 核对固定原 CLI `pool/maxWorkers` 后，仅撤无效参数：
  41399 exit 0，`shared-threads-positive.log` 为 18/18，
  `web-threads-positive.log` 为实际 Inbox 28/28。
  原目标／断言／超时未放宽，threads 成功不改写旧失败或 full 结论。
- 私有原 `feedPreview` 去 trim，真实能力 guard 去掉频道集合校验；
  69150 编排 exit 0，shared 1 failed/17 passed exit 1，
  Native 2 failed/16 passed exit 1。原预览与未准入可回复被实际断言抓到，
  不是启动／类型错误，见 `shared-negative.log`、`native-negative.log`。
- 恢复共享及能力字节 cmp 0，再只把实际 Web 预览改回旧非空旁路；
  59162 编排 exit 0，Web 1 failed/27 passed exit 1，精准命中实际行
  `p` 文本断言，见 `web-negative.log`，并非只破坏未消费 helper。
- 全部 13 路径及两宿主 installed shared 恢复 cmp 0 后，
  51413 exit 0：`shared-restored.log` 18/18、
  `native-restored.log` 18/18、`web-restored.log` 28/28、
  `i18n-restored-check.log` exit 0。
  Web 目标的既有 Avatar 未包装 act 的 stderr 警告保留，未抑制。
  这 64 项定向检查不是全仓检查，也不证明未连接的 feed 来源可运行。

### 实拍、全量差异与明确剩余

独立 `web-client/fork/verify/screenshots-20261009-5ba-inbox-readonly.md`
记录本轮 5 个实际状态原件，已逐张打开；正常 SSO 的 build-info
仍是部署 `5baad5e09a6c8abeb33bbfa1904fe0ee77034b78`，
`sha256:9985c612c146a9cd611f13457ce699a740354023646d45e26ffb4c107fdfeaaa`。
实际 Inbox、筛选菜单、空草稿、作者资料及空审批只证明这些旧版本状态；
DM 线程提示、仅 5 筛选和资料标题遮挡仍是明确未验收项。

当前可复核全树快照仍是前节固定
`e5c6ada467063984a4c7f644e17e21f993a5be58` 对上述官方 779：
union 5314 路径，原样保留 1977、共享迁移 111、整文件已授权治理 0、
恢复队列／尚未证明保留或授权 3226；不是当前 main 全树逐处已验收。
本批只有上述原函数／实际读方的逐 hunk 证据，不将这 13 个路径或未知目录
整体重归为授权；3226 是未证明差异队列，不是业务功能缺失数。

本批尚未提交／部署，新源码业务截图 0；没有 Windows／Mobile 新包或设备验收。
原 Project／Needs Action／Reminder 的显示分支保留不等于 feed 生产者已接入；
原全筛选、完整 DM 详情／消息动作、Agent 资料／会话、原设置剩余分区、
日期等其他未迁移 i18n 读方仍未完整恢复。不能称整个 Inbox 双语闭合、
全量原版一致或生产就绪。源码冻结交主代理选择性收口；历史文档 dirty 不纳入。

## 2026-10-09 05:55 UTC 原 Inbox DM 详情与作者资料 split chrome 恢复

本批 15 个源码／原检查／同源生成路径，`+258/-123`，全部冻结交主代理；
未自行暂存、提交、构建镜像或部署。原件和命令日志统一位于
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/current-main-diff.nNHzVS/inbox-dm-context.LHJhoz/`。
`owned-paths.txt` 列完整 15 路径；`owned-source.patch` SHA256 为
`5022cec7494d5d5a1a112e489d6e5d5bc5966b2e1a25d03600a2e2d01ded756f`。
原 `git apply --reverse --check` 退出 0；没有吸收其他 owner 或历史 dirty。

### 固定官方来源、四步影响面与实际消费者

官方固定 `779af8886caae1317b4de962082429867ab61503`，逐模块读取以下真实符号：

- `desktop/src/features/home/ui/InboxDetailPane.tsx::InboxMessageDetailPane`：
  DM 的上下文／Open conversation／placeholder、默认空 parent、显式行回复、频道级草稿。
- `desktop/src/features/home/ui/HomeView.tsx::HomeView`：
  作者资料使用 `RightAuxiliaryPane` 与 split／transparentChrome 的真实组合。
- `desktop/src/features/channels/ui/RightAuxiliaryPane.tsx::RightAuxiliaryPane`：
  原完整 resize／reset／detached／约束分支，以及官方注释解释的 isolate／z-31。
- `desktop/src/features/profile/ui/UserProfilePanelFrame.tsx::UserProfilePanelFrame`，
  `UserProfilePanelHeaderContent.tsx::getUserProfilePanelHeaderContent`，
  `UserProfilePanelUtils.ts::PROFILE_PANEL_VIEW_TITLES`：summary 原标题是 Profile，
  原共享 Header 提供实际 X／关闭回调；并非自行新增标题或关闭按钮。

动手前四步结论：

1. 权威是用户原版恢复要求、REQ-24 与 DD-74/75；纯呈现／默认 reply target
   原版已支持，身份与成员／Conversation 准入仍沿既有治理，不扩展 Agent 直聊。
2. 检索 Native detail→HomeView 发送、Web Inbox→InboxThreadPane→Composer／BFF、
   现有 InboxDrafts→DraftEditor 和所有作者资料调用点。没有改 schema、数据库、
   Relay 正文、存储格式或旧 API；Web 原契约 optional parent 以 undefined 表达原空 parent。
3. DM 不能因为 null parent 短路授权：仍要求实际 history 成功、bounds 有效、
   ACTIVE binding、当前 Principal 是 participant、真实 channelId 相符且未被撤权。
   名字只来自当前获准目录／原消息作者，缺资料回退其真实短 pubkey，不伪造 owner/presence。
4. 空／缺 bounds／历史失败／撤权／旧身份迟到继续撤除内容或拒绝发送；
   未 ACK／UNKNOWN 仍冻结原 idempotencyKey 与 parent，不取消、改目标或重新建意图。
   旧 reply draft 显式消费其真实 parent 与原 entry.key，不静默移到新 DM 默认草稿。
   无新外部状态／事务／权威；实际错误与 UNKNOWN 沿原六类错误及既有对账，不降级成功。

Native `InboxDetailPane` 恢复 `!isDirectMessage && hasInboxThreadContext`、
默认 DM 空 parent、原 header／Open conversation、原频道级 draftKey 和 Message sender。
Web `InboxThreadPane` 消费同一共享 Composer／原 detail UI，普通 DM 不再默认回复线程；
真实 row reply 仍发送精确目标，未知回执不能切换目标。`InboxPane` 传当前获准 sender；
已有 `InboxDrafts::DraftEditor` 同时补回实际 saved parent 和 `restoreDraftKey` 消费。
没有新建 feed 来源、搜索结果或未接后端按钮。

原 `RightAuxiliaryPane` 完整共享到
`client-kit/ts/platform/src/react/messages/thread/RightAuxiliaryPane.tsx`；
Native 原路径转导出，没有双份原组件。仅 import／同源词条接缝变化，原分支／类名保留。
Web Inbox 作者真实消费者改用 split／transparentChrome 与原 z-31 wrapper，
不再让 standalone enter transform 形成被 z-30 Inbox blur 压住的 stacking context。
保留已有宽度与身份／回执 fencing，其他作者资料消费者默认 standalone 不变；
没有全局取消 blur／pointerEvents、扩大 shared AuxiliaryPanel 默认或自绘新的关闭 icon。
来源登记未错误 remove 原 `RightAuxiliaryPane`／`InboxDetailPane`；
`UserProfilePanelFrame` 完整原模块仍未恢复，不能因为本批复用其部分呈现语义而删缺项登记。

### 实际命令、失败、生产破坏与精确还原

复用 `kailo-agent-receipt-xvkujx`，实际 4 CPU／8 GiB、UID 1000，
`cpu.max=400000 100000`、`memory.max=8589934592`；Node heap 3072 MiB。
前置实际 top 仅 sleep，Host available 20593 MiB、Data 可用 280 GiB；
memory.events 旧 oom=2／oom_kill=2，结束无增量。无新 SDK／依赖／Cargo／Go／镜像。
原 manifests／锁相同，本批 15 输入与两宿主 installed shared 逐字节 cmp 0。

原目标命令：Native 在 desktop 执行
`node --import ./test-loader.mjs --experimental-strip-types --test src/features/home/lib/inbox.test.mjs`；
Web 在 web 执行原 `vitest run` 的 InboxPane／InboxThreadPane／MessageAuthorProfile／
InboxDrafts 四个既有 `.test.tsx`，`--pool=threads --maxWorkers=1`。
四 types 是 shared 源、shared `-p tsconfig.test.json`、Web 与 Native 的 `tsc --noEmit`；
词条只沿 `python3 tools/gen-platform-i18n.py` 与 `--check`，未改 contracts Dart。

- 90768 编排 exit 1：原 i18n 生成／check exit 0、Native 19/19、四 types 各 0；
  首轮 Web 65/68，3 失败。新断言未先点原行和旧 Refresh token 查找保留在日志。
  93989 Web 66/68 exit 1；80778 Inbox 26/28 exit 1，真正点原 full-row button
  后暴露 jsdom 缺 scrollIntoView。只修实际点击与既有浏览器 DOM 适配，未删断言或改超时。
- 新共享文件沿既有 Biome format：40862 exit 0；不整份重排原紧凑宿主。
  最终 85994 exit 0：Native 19/19，Web 四目标 68/68，原词条 check 0，四 types 各 0。
  最终实际输入对应 `*-final.log`，不能把前述真实失败改写为通过。
- 私有候选把两宿主默认 DM parent 改回旧非空分支：49352 编排 exit 0，
  `native-dm-negative.log` 1 failed／18 passed、真实命令 exit 1；
  `web-dm-negative.log` 3 failed／17 passed、exit 1，精确命中实际发送 parent。
  两生产文件立即从正式字节还原 cmp 0，不是编译失败或未运行 case。
- 私有共享实际 wrapper 移除 z-31，并同步实际 installed shared：47554 编排 exit 0，
  `web-pane-negative.log` 两个真实 Inbox／Profile 消费者 2 failed／39 passed、exit 1。
  正式字节、私有源和两宿主 installed shared 已全部还原 cmp 0。
- 82114 最终恢复编排 exit 0：`native-inbox-restored.log` 19/19、
  `web-consumers-restored.log` 四目标 68/68、`i18n-check-restored.log` exit 0。
  原 Avatar／DraftEditor 未包装 act 的 stderr 警告保留，未抑制；不是 full 或 Windows 验收。

### 真实截图、四分类边界与剩余

正常 SSO 会话过期后重新正常登录；首个旧 callback 实际出现 missing transaction，
正常重进 `/app/` 完成现有 IdP 握手，不注入 Cookie／session 或重置账户。
浏览器只读 build-info 200，仍是部署
`5baad5e09a6c8abeb33bbfa1904fe0ee77034b78`，buildId
`sha256:9985c612c146a9cd611f13457ce699a740354023646d45e26ffb4c107fdfeaaa`。
本轮两张截图均实际打开，主代理也已逐张打开，确认旧线上失败：

- `/volumes/kailo/.playwright-cli/kailo-ui-20261009-main5ba-dm-context-before.png`，
  SHA256 `14ad1b20d74cd97eae2d0abd1082033e828573bba6aa767946bd38bddb28bd74`。
- `/volumes/kailo/.playwright-cli/kailo-ui-20261009-main5ba-author-stacking-before.png`，
  SHA256 `dcfee1f540f9e3c67f1e7cb6404eeeb27ec9ba63dfd21d8e8fcc2df8308eb814`。

只读真实 computedStyle：资料 enter transform／z-auto 父级、header z-41 被
Inbox 共享 blur z-30 覆盖，与固定原 RightAuxiliaryPane 注释一致；未改 DOM 样式绕过。
上述图片证明旧版本缺项，不证明本批修复的图像验收。新源码业务截图仍 0。

四类逐 hunk：原 Header／X／算法未改分支保留；RightAux 全文与真实消费者为共享迁移；
当前身份／scope／BFF、optional parent 映射和同源中文为逐项授权接缝；
未恢复的原模块继续在恢复队列，不把 15 文件整体笼统归为治理授权。
完整可复核全树 TSV 仍是 e5c6ada467063984a4c7f644e17e21f993a5be58 对上述官方：
union 5314，原样 1977、共享 111、整文件授权 0、尚未证明保留或授权的恢复队列 3226。
这是历史比较点，非当前 main 全树逐处复核／功能缺失数量或完成率；本批未重导全量。

原 Composer channelType／audienceContext 在当前两宿主接口里仍没有真实消费，
未写忽略 props 冒充恢复。原 Inbox 编辑／删除及全部筛选／feed 来源、Agent 完整资料／
会话、其余设置分区和所有页面视觉仍未全面闭合；不称完整 DM 产品／原版 100%。
候选尚未提交／部署，Windows／Mobile 没有新包或设备验收；等待主线一次集中发布
后正常 SSO 重拍同两状态，不能把这批定向检查或旧图称生产就绪。

## 2026-10-09 06:05 UTC 固定 a816 已提交树全量官方差异账更新

本轮固定官方 Buzz `779af8886caae1317b4de962082429867ab61503` 对
apps `a816ea569acdce060a681c32467e4ebb4235b197` 的完整 `collaboration/` 树；
不读取 dirty 工作树作为比较对象，`fork/` 按已有工具口径排除。
原 `tools/upstream_manifest.py::diff` 的临时 index 输入替换为该 commit 的
`collaboration` tree，仍使用其原 `upstream_tree`、`git diff --cached -M --binary`
算法；不复制整树、不执行上游文件、不改工具源码、不启动 SDK／构建／图谱。
原始 diff 实际 exit 0，1,043,931 行；`git apply --stat/--numstat` 只读解析 exit 0：
rename 口径 3330 files、+37860/-746415，与下述路径 union 不是同一计数口径。

全量原件目录：
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/current-main-diff.nNHzVS/`。

- `collaboration-a816ea569acd.patch` SHA256 `cae6cd15f7f1fefc4c9627a0fee3d21e926abf9de3ea6bc784551bac39944646`。
- `collaboration-a816ea569acd.classification.tsv` SHA256 `0899a6ec5b025b4a8b808af8d3d183e4676afe3bd349acd1d76792297b66223b`。
- `right-auxiliary-official-to-a816.diff` SHA256 `51448008f254b47e4b1d66f2eb41fc17bd802cdfbdfac14ffa60dfd340eddb2d`。
- `apps-a816ea569acd-collaboration-shared-tree.tsv`／`buzz-779af8886c-a816-compare-tree.tsv`
  为两个固定 Git 树的 mode/type/blob/path 原件；迁移目标同时纳入共享 TS 与 Web 树。
- `e5c6-to-a816-classification-changes.tsv` 为旧账到新账 8 个原路径的实际 blob／分类变化。

上游 5195 路径、当前二开树 2874 路径，完整 union 5314：S1976、M779、D2440、A119，
其中 3338 路径有差异。四类账为原样保留 1976、共享迁移 112、整文件已授权治理改造 0、
缺失需恢复（尚未证明保留或授权）3226。最后一项是未完成逐处证明的恢复队列，
不是 3226 个已证功能缺失，也不是完成率／功能验收数量。
每行 14 列沿旧账：upstream_commit、apps_commit、path、change_kind、category、
两侧各 mode/type/blob、destination、evidence、historical_category。
实际机械复核 exit 0：5314 路径无重复、固定 commit 一致、全部 14 列、S 项 mode/type/blob 相同。

111 项旧迁移证据仅在原路径与全部已登记目标的 mode/type/blob 均未变化时延续，
不是目录授权或整个页面功能认证。新增 1 项是固定官方
`desktop/src/features/channels/ui/RightAuxiliaryPane.tsx::RightAuxiliaryPane` 全文迁至
`client-kit/ts/platform/src/react/messages/thread/RightAuxiliaryPane.tsx`：精确 diff 只含
导入迁移、同源中英词条及格式，Native 转导出与 Web 真实作者栏 split 消费者已在 a816。
`InboxDetailPane`／`HomeView` 等整文件其他差异仍未证明，不以本批窄接缝将整文件归为治理授权。
逐 hunk 授权身份／BFF／中文差异沿各已提交回执说明，整文件授权计数 0 不表示这些接缝不存在。

旧 e5c6／a8c1／dfc7 账保留为历史，不再称当前全量；本轮全树源码差异可复核，
但原页面／交互／非空状态／Settings 其余分区／Agent 资料及会话仍未全面逐处验收。
当前线上仍固定 5ba，a816 的 DM／作者栏新截图仍 0；等待主线新 digest 实际部署后重拍。
本轮没有新的 Windows／Mobile 包或设备验收，不声明原版 100% 或生产就绪。

## 2026-10-09 原 Composer audience／Agent 提及共源真实消费者恢复

本批固定官方 Buzz `779af8886caae1317b4de962082429867ab61503`，
仅恢复原 Composer Agent autocomplete、address locks、线程 audience、选中和发送真实读方；
不是原消息产品全量恢复。41 个源码／原检查／同源 Dart 路径冻结，+3136/-280；
根代理负责选择性提交与发布，本队友没有 stage、commit、push、镜像或 full。

动手前的权威、影响面、副作用与边界结论：

- 权威：原版一致性与中文默认／英文要求；DD-75／
  `.design/09-统一身份与Buzz协议投影.md` 的三端凭据与传输边界。
  原控件、布局和交互由下列固定符号决定，候选资格由既有 AgentInstallation 目录决定。
  Native 仍本机签名直连 Relay；Web 仍 BFF 语义提及与 Core 代签，未另造 resolver／注册表。
- 全引用追踪：Native ChannelPane／InboxDetailPane／MessageThreadPanel →
  MessageComposer → shared 原 autocomplete／address／toolbar → useMentionSendFlow；
  Web ChannelPane Composer／ChannelThreadPane／InboxThreadPane →
  同一 shared 控件与 audience。共享 use-mention-selection 和真实键盘消费者一并恢复，
  不是只增加没人读的 channelType／audienceContext props。
- 写读与兼容：useDrafts／draftMentionRefs 的 optional isAgent 仅保存用户 UI 意图，
  老草稿缺字段仍可读取，非法 flag 不当资格；不作为身份或权限权威。
  owner／channel／composer 原分区不共享账号上下文；发送仍 fresh 目录再检查。
  无数据库／contracts JSON Schema 改动；只沿原生成器生成同源 Dart 词条，
  不另维护翻译、公共 workflow、账本或 Agent 数据。
- 副作用：原 persistentAgentAudience 和自动提及偏好只存公钥／UI 选择，
  原 200 条／确认交互值从固定上游保留，不新增阈值。恢复不读取平台私钥，
  不将 Agent 当 HUMAN，不用 kind-0／is_agent 或 owner 猜资格／managed provenance，
  不将 UNKNOWN 当失败或成功，不在 Core 存消息正文。
- 确定失败边界：目录分页空值／非法或倒退 cursor、重复不同版本同 resource、
  同公钥歧义绑定、错误 workspace／channel、无 pubkey／projection／generation、
  disabled／无执行权／非 Mention channel 都拒绝候选；无实际 Workspace 不开启 Agent。
  旧身份晚到／查询失败／fetching 不暴露旧缓存资格。编辑与 DM 不自动启用线程 audience。
  发布前重新读取，撤权拒绝发布并按原 owner／revision 恢复草稿；取消／scope 切换
  不污染新 Composer。UNKNOWN 保留原内容／实际收件人／idempotency key，
  只在实际意图变化时换 key，不自动重复 Agent turn。
  错误仍沿原准入／依赖／容量／UNKNOWN 分类，不新建第二套错误权威；
  原六类完整异常矩阵、quota 在途及多 Agent 稳定运行没有据本批窄验重新宣称完成。

固定官方原模块与完整可复核差异：

- `desktop/src/features/messages/ui/MentionAutocomplete.tsx::MentionAutocomplete`：
  原行、Pin／Options／Switch／键盘、原类名和英文迁入共享 TS，Native 转导出，
  Web 删除旧 UUID 选择列表后实际消费相同控件；中文沿同源词条。
- `desktop/src/features/messages/ui/ComposerAddressControls.tsx` 与
  `desktop/src/features/messages/ui/MessageComposerToolbar.tsx::MessageComposerToolbar`：
  迁入共享 ComposerControls／Toolbar，原头像组、移除、pulse／shake、确认／布局真实接线。
- `desktop/src/features/messages/lib/persistentAgentAudience.ts`、
  `desktop/src/features/messages/lib/autoPinMentionedAgentsPreference.ts`、
  `desktop/src/features/messages/lib/stripImplicitAgentMentions.ts`：
  原全文只加来源记录，已有最大值／本地偏好／精确前缀算法不另重写。
- `desktop/src/features/messages/ui/useThreadAgentAudience.ts::useThreadAgentAudience`、
  `useAgentAddressLockPicker.ts::useAgentAddressLockPicker`、
  `useAddressMentionPulse.ts`、`useAutoPinMentionedAgents.ts::useAutoPinMentionedAgents`、
  `useAlwaysAddressShortcut.ts` 和
  `desktop/src/features/messages/lib/useMentionSelection.ts`：
  按原全文迁移，Native／Web 实际 picker、editor、root p-tags、线程／draft scope、
  first-agent preference、Cmd／Ctrl+Shift+M 接回，非影子 helper。
- 授权接缝仅为共享导入、同源中英、可信 Installation 资格／主机传输：
  新 composerAgentDirectory／useComposerAgentDirectory 消费现有
  BffClient session／workspaceChannel／members／agentInstallations／agentDefinition，
  ACTIVE resource／principal／execution／channel Mention／当前 generation 和公钥必须同在。
  Native sendflow 在原发布前 await fresh verify；Web 只向原 publish 发送实际 Installation IDs，
  不将 secret／默认租户／旧 profile 当授权。没有新增产品 API／Core 权威。
- `/volumes/data/kailo/tmp/audience-official-to-shared-final.diff` 为 12 对原模块全文 diff，
  SHA256 `3589fdd5753ed664bcbe77c6534dfc478c49abdafe6268ffd108fb764ba9245f`。
  不将其中整文件都归“共享迁移”或“治理授权”；下列剩余原依赖仍缺失需恢复。

精确 owned 源码与归属：

- `/volumes/data/kailo/tmp/audience-owned-source-final.patch`，
  SHA256 `5323c7b530f361b7be2794c9bcc7ca0d39cf9a1fbed01fa5e272e5feee307987`；
  `git apply --stat` 41 files、+3136/-280，`git apply --reverse --check` exit 0。
- 全 41 路径及逐文件 hash 在 `/volumes/data/kailo/tmp/audience-owned-source-final.sha256`，
  该清单 SHA256 `66450c3b3b40b7e9c252b21ae0c6cf0d8801b6852500eb1c60a89c02def6739c`。
  package.json 仅 10 原消费者 exports，i18n.ts 仅 21 keys，Dart 仅 84 同源生成行。
- 本批 tracked 路径在固定 a816 已交付树与冻结时 HEAD 之间的 committed diff 为零。
  起始记录未将这 41 路径列为 inherited hunk；未额外保存接手前独立 hash 快照，
  不能从现单份工作树反证未知继承。已明确继承的 custom-emoji／editAttachments／
  parseImeta 等脏改不在本 patch；checkpoint 继承删除也不纳入提交。
  以选择性 patch 与逐 hunk review 归属，不整份 stage 历史脏文件。
- 两宿主安装的 file-package 实际为副本，本轮将最终共享源码／manifest
  同步到 Web 与 Native 的实际安装包，再运行真实读方；不靠 canonical helper 独自通过。
  最后 41 formal／private 输入逐项 cmp exit 0，原受限 SDK 只剩 sleep。

原命令与真实终态（实施之后产生的证据）：

原 SDK `kailo-agent-receipt-xvkujx`，实查 4 CPU／8 GiB，Node heap 3072；
preflight available 24 GiB、memory PSI 0，最终 memory.events oom_kill 保持旧基线 2，
没有本批增加。无 Cargo／Go／下载／新依赖／镜像／新 SDK／全局编译。
只用原 Vitest threads／maxWorkers=1 与原 Node --test --test-concurrency=1。
宿主证据目录
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/profile-settings-ortsoo.DRR20F/audience-final-20261009/`。

- 最终 `75606` 串行批 exit 0：`restored-web-consumer.log` 37/37；
  `restored-native-consumers.log` 64/64，含原 Agent 行／Pin／Options 英文→中文、
  原装饰／draft refs、真实 renderHook verify→publish／拒绝草稿恢复消费者。
  React act warnings 留在 Web 原日志，没有删 assertion／case 或改 timeout。
- `restored-shared-types.log`、`restored-shared-test-types.log`、
  `restored-web-types.log`、`restored-native-types.log` 各 exit 0。
  `restored-format.log` 14 files checked、No fixes、exit 0；
  `restored-i18n-check.log` exit 0、Mobile platform/reason match shared TS。
  原 `tools/gen-platform-i18n.py` 和 --check 已 exit 0，不写重复 Dart 词条。
- Web 生产负向 `18184`：仅私有 canonical＋实际安装 Web 包去掉
  generation 一致性守卫，原 Composer invalid-generation row 断言真实
  1 failed／36 skipped、exit 1；错误显示未准入 Agent，不是启动或语法失败。
  原文件按 formal 精确 cmp 0 恢复；最终同 37 项恢复 exit 0。
- Native 生产负向 `80255`：只将实际私有 useMentionSendFlow 的 await verify
  改成不执行验证；原真实 renderHook 消费者 1 failed／exit 1，
  实际 order=[publish] 与必须 [verify,publish] 不一致。原输入 cmp 0 恢复，
  最终原 64 项恢复 exit 0。两次破坏均没有改 formal 生产源码。
- 最终原命令逐字在上述 `restored-command.txt`，
  SHA256 `11ffc06f8cc0a3e4a0d23e3d9588fa3f928bd350af921487a5628c121d37c2ea`。
  Web 命令为 `vitest run src/platform/ui/Composer.test.tsx --pool=threads --maxWorkers=1`；
  Native 为 `node --import ./test-loader.mjs --experimental-strip-types --test
  --test-concurrency=1` 后接原四个 .test.mjs；四侧类型仍各原 tsc --noEmit，
  shared test 用原 tsconfig.test.json。
- 真实前轮失败不覆盖：8504 类型 exit 2；85497 旧安装导出／类型及 Native
  59/64 exit 1；99486 Web ResizeObserver 13 failures／24 pass exit 1；
  57172／1416 全 suite 草稿内存串态 36/37 exit 1，已用原 clearAllDrafts
  补正确夹具 reset，不改生产权限；37631 isolated 1 pass 仅诊断。
  49267 worker 启动超时 0 case exit 1；57024 原候选缺 .gitignore exit 1，
  最小补原输入后 59746 format exit 0。首次最终 restore 外层引号错误 exit 2
  未执行 case，保留 restore-invocation-error.log；正确调用 75606 才是最终恢复。
  所有失败／早轮通过都不充作最终 source／full 验收。

四类账与仍需恢复的真实范围：

原未改分支“原样保留”；已逐全文 diff 的原算法／控件加两真实宿主读方为“共享迁移”；
新身份／scope／可信目录与传输／i18n 仅逐 hunk“已授权治理改造”；
其余原依赖未贯通仍“缺失需恢复”，不因继承已提交就自动授权。
最近完整 Git 树比较点仍为固定官方 779af… 对 a816ea569acdce060a681c32467e4ebb4235b197：
union 5314，原样 1976、共享 112、整文件授权 0、尚未证明保留／授权的恢复队列 3226。
这不是当前 661415e9f103bd939d2b70505e64ca188d74bde5 全树逐处复核，
3226 也不是已证功能缺失或完成率；本轮没有再重导全树或刷新图谱。

明确原剩余依赖，不冒称“整个模块完整还原”：

- 固定官方 `desktop/src/features/messages/ui/useImplicitAgentMentionProvenance.ts::
  useImplicitAgentMentionProvenance` → `useDraftPersistSnapshot.ts::persistedContent`
  原 host provenance 与 generated prefix 的草稿持久化消费者尚未迁移贯通。
  本批共享 pure strip helper 只由实际 unpin 消费，不能拿它替代该 host 闭环。
- `MessageComposerToolbar.tsx` 原 onCaptureSelection 若干真实读方、
  gifMediaController／GIF 分支、emoji 原排序、voice-note 禁用一致性仍缺失恢复，
  多数在本批前存在；没有将它们删出原目标或笼统归治理授权。
- MentionAutocomplete／ComposerControls 的原实例 managementMarker provenance
  没有可信实际消费。保留原插槽而不伪造 managed-here／elsewhere、owner 或头像；
  原 persona／team 等来源没有据本批虚造。Agent 完整资料／私聊／Activity
  以及其余设置／页面、Native 历史错误完整中文仍未全面恢复。
- 本批没有三人／多 Agent 同频道真实持续操作，没有新 Windows 安装包或
  Tauri IPC／设备证明，没有 Mobile 新包／设备验收；Node Native 不是 Windows。

本次 Avatar 原 UI 实拍尝试：

已完整读取 playwright-cli skill，仍使用独立 header-restoration 普通 seam-verifier 会话。
07:51 正常读取 /app/platform-build-info.json 实际 Failed to fetch；
关闭已开作者栏／打开个人菜单后正常 reload 跳回 IdP Sign in，不注入 Cookie、
不共享别人的会话、不重置账号，不读取／输出口令或上传／保存资料。
本轮 require／dynamic import 原 CLI 执行上下文不支持，
没有新造认证路线；AvatarEditor 尚未打开，明确未验收。
`/volumes/kailo/.playwright-cli/kailo-ui-20261009-avatar-editor-sso-expired.png`
已 screenshot 且实际 view_image 打开，SHA256
`b0099b9e921b5e7c8830994788e8a357229384b4bf5ce0f16c2197c90d5f29d7`；
只证明此次 SSO 登录边界，不算业务／头像／Audience 视觉通过。
原 a816 三张旧线上实拍沿已提交独立回执；当前新 Audience 业务截图 0，
源码尚未部署，不能用这些旧图或定向测试宣称原版 100%／生产就绪。

### 2026-10-09：原隐式 Agent 前缀→草稿快照与 Toolbar 原选择回调恢复（10 路径冻结）

本批起点为已推送 main `784d2ee9e80f09d2f720e5d0e0b85bc71492da01`。
10 个源码／原检查路径接手时均无未提交改动；package.json 只新增两个现存模块 export，
无依赖／lock／契约／词条／Dart 变更，不吸收其它工作树继承修改。
本批源码 +248/-15；只由 root 选择性提交，不自行 stage／commit／push。

四步影响面与确定行为：

1. 权威：固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的
   `desktop/src/features/messages/ui/useImplicitAgentMentionProvenance.ts::useImplicitAgentMentionProvenance`、
   `desktop/src/features/messages/ui/useDraftPersistSnapshot.ts::useDraftPersistLifecycle/persistedContent`、
   `desktop/src/features/messages/ui/MessageComposer.tsx::MessageComposerImpl/handleCaptureSelection`、
   `desktop/src/features/messages/ui/MessageComposerToolbar.tsx::MessageComposerToolbar`、
   `desktop/src/features/messages/ui/ComposerEmojiPicker.tsx::ComposerEmojiPicker`。
   复用固定实现，保持 DD-75 Native 本机签名直连与 SS-WEB-01 Browser 经 BFF，
   不改 Core／Worker／Relay 准入、注册表或执行权威。
2. 影响：共享 provenance 的 add/remove/getPrefix→两宿主真实 addressLock 回调→
   Native lifecycle cleanup 和 Web persistDraft；Toolbar→EmojiPicker trigger。
   数据写方仍原草稿 store，读方仍原编辑器恢复及发送消费者，字段形状不变。
   原 strip helper 只删除可信已记录且确实位于开头的自动 prefix，
   相同手工 @mention 保留；空 key／空 prefix 不删正文。
3. 副作用：provenance 用既有受权 audienceScope 的 owner/channel/draft 分区，
   不信 kind0/is_agent，不生成第二 scope 或自动绑定；无有效 scope 时保持空 prefix。
   Web 已捕获 publication／UNKNOWN 的 intent 仍持原完整内容和 idempotencyKey，
   不将正常草稿净化套到重放快照，不自动重发；此 Web 新专项未运行 case，不能称已验。
4. 边界：原 prepend/dedup/remove 与原 Map 淘汰规则原样复用；跨 owner/draft 不串前缀。
   原 StrictMode／A-B-A／清空权威／图片和文件保留算法不变。
   既有旧草稿格式无需迁移；没有可信 provenance 的旧正文保持原值，不猜测 @mention。
   无网络新状态或失败分类变更，原 UNKNOWN／撤权／身份切换 fence 继续 fail closed。

本批四类逐符号边界：

- 原样保留：固定原 `MessageComposer.tsx:816::handleCaptureSelection` 本来就是
  `React.useCallback(() => {}, [])`。两宿主恢复相同回调，不发明 selection 快照／权威；
  这不是新增选择能力，更不以原空 callback 声称修好了原版未提供的实现。
- 共享迁移：原 provenance 函数迁到 client-kit 单主体，只有 import/export 接缝；
  Native 原 persistedContent 与 cleanup 恢复共享 strip helper，Web 对正常草稿消费同一 helper；
  Toolbar 七处真实 mousedown／trigger 读方恢复，并恢复原 voice→emoji 顺序。
- 已授权治理改造：provenance key 用既有可信 owner/channel/draft audienceScope；
  Web 仅在非 intent 的正常草稿净化，捕获发送／UNKNOWN 快照不变，Browser 不取本机密钥。
  只归上述确定接缝，不将整份 Toolbar／EmojiPicker 残余差异概括为治理授权。
- 缺失需恢复：Toolbar 原 GIF／gifMediaController 分支、emoji 原排序、
  voice-note 禁用一致性、managementMarker 的实例 provenance 消费仍未闭合；
  本批只有 selection 调用和顺序／草稿 prefix 闭环，不称整份 Composer 原版一致。

冻结范围索引和源码原件：

`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/profile-settings-ortsoo.DRR20F/prefix-draft-20261009.C3rjzQ`

该目录 `owned-paths.txt` 精确 10 路径，`inputs.sha256` 对应正式最终字节；
`owned-source.patch` SHA256
`abe3fce4bc152968f3566e4a1a48cbd03425d00eb8b0a934069ec9e7668ee376`，
reverse check／cached check 均 0，正式与候选 10 路径逐项 cmp 0。
`official-to-current.diff` 是四个原模块完整全文 diff（588 行），SHA256
`eddb61c0dea59cd33125ebc1ba3b4b7f6ccfea88f2990b13c7665f959348bf91`；
不是只有本批 hunk，也不把其余残差默认授权。

实际运行（复用原 SDK，不新建／安装／bundle／full）：

`kailo-agent-receipt-xvkujx` 原 4 CPU／8 GiB，cpu.max=400000 100000，
memory.max=8589934592，Node heap3072，原 Vitest threads／maxWorkers=1，
原 Node test-concurrency=1；开始与结束 memory.events 的 oom=2／oom_kill=2 不增，
最终 docker top 只有原 sleep。开始时 host available 30 GiB，
I/O full avg10=56.42%，保留 I/O 与真实启动失败，不改任何检查超时。

原目标命令（工作目录分别为候选 Native/Web/client-kit）：

```sh
node --import ./test-loader.mjs --experimental-strip-types --test --test-concurrency=1 src/features/messages/ui/MessageComposerDraftImagePersist.test.mjs
node_modules/.bin/vitest run src/platform/ui/Composer.test.tsx --pool=threads --maxWorkers=1
node_modules/.bin/vitest run test/custom-emoji-composer.test.tsx --pool=threads --maxWorkers=1
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.test.json
```

- 原集中句柄 88941 终态 1：Native 实际 hook/store/StrictMode 13/13、exit 0；
  shared production/test、Web、Native 四组 types 各 0；
  Web 与 Toolbar 两目标均 worker 启动超时、0 case、各 exit 1，不记通过。
- 88941 终态后仅校准原 voice→emoji 顺序、实际七 reader 检查与原 hook 注释／格式；
  最小同步 28946 终态 0。暖尾 93986 启动时同步请求尚未由调用侧收回终态，
  下一次读取确认同步 0；该时点尚无 case，最终 10 字节 cmp 0。
- 暖尾 93986 终态 1：shared production/test types 各 0；
  Web／Toolbar 仍各 worker 启动超时 0 case／exit 1，不重复冷扫，不改 runner／超时。
  对应 `positive-*.log` 与 `final-*.log` 保留原始输出；
  两个新增 Web 的正常草稿／UNKNOWN 原 consumer 和七 reader 专项明确运行未验收。
- 真生产破坏 56135：仅私有 Native 实际安装 shared-hook 的 getPrefix 置空，
  同原目标 11 pass／2 assertion fail，exit 1；确实抓到重复自动 prefix 被落入草稿，
  不是 loader／编译／OOM 失败。正式源码没有改动。
- 原字节 apply_patch 还原、formal／installed private cmp 0 后同原目标
  13/13、exit 0。两项失败与还原见 `mutation-native-prefix.log`、
  `restored-native-prefix.log`，实际原命令分别入 `mutation-command.txt`／
  `restored-command.txt`。Web／Toolbar 没有执行 case，未把启动失败当变异命中。

全量和实际交付边界：

最近完整官方→已提交源码 union 仍固定于 a816ea569acdce060a681c32467e4ebb4235b197：
5195 原路径／2874 当前 collaboration 路径／union 5314；
原样 1976、已证共享 112、整文件已授权 0、恢复队列 3226。
该 3226 包括尚未证明保留或授权，不能当 3226 项已证功能缺失；
本批逐符号恢复证据不能冒充当前 main 全树已经归类／验收完成，不重导百万行快照。

本批无新 Playwright 业务图，原 header-restoration SSO 已过期，未继续工具排障，
不注入 Cookie／重置账号／借其它身份。线上仍 a816 buildId 88591b4d…，
此前登录页或旧业务图不验本批源码。新 10 路径未部署，Toolbar/Web 实际运行未验，
Windows／Mobile／完整 Tauri 与生产全检均未执行，不声明原版 100%／生产就绪。

### 2026-10-09：原 Toolbar 录音期间表情禁用消费者恢复（2 路径冻结）

本批起点 `d5850c53143488ecd4d24411b725a5b8b9bed2af` 的前批 10 路径已 clean；
本次两个拥有路径接手前均 clean，源码／原检查 +64/-1，无 inherited hunk。
只恢复一个固定原 receiver 条件，不称完整语音或 GIF 功能恢复。

四步结论及固定依据：

1. 权威：Buzz `779af8886caae1317b4de962082429867ab61503`，
   `desktop/src/features/messages/ui/MessageComposerToolbar.tsx:284::MessageComposerToolbar`
   原 EmojiPicker 为 `disabled={composerDisabled || isVoiceNoteRecording}`；
   下一行 `gifsDisabled={hasVoiceNoteAttachment}` 只限制 GIF，不限制普通表情。
2. 影响：共享 Toolbar 唯一源→两宿主消费者。Native 现有
   `MessageComposer.tsx::MessageComposerImpl` 从真实 voiceNote.status 写原 recording flag；
   Web 目前没有录音 producer，不新增假 callback／入口或伪录音能力。
   消息、附件、draft、quota、scope、SecretRef、签名与上传合同均未改。
3. 副作用：仅恢复已有真实禁用状态，不改变录音状态机或给 API 放权；
   有语音附件时普通表情仍可选，文件原禁用规则继续保留。
   不为缺 GIF 治理链调用 Browser 私钥／裸 Relay，也不新建代理。
4. 边界：现有原录音目标同时验证取消、StrictMode、迟到权限流释放和旧 decode fence；
   本批 receiver 证据使用其原 FakeStream/FakeRecorder 和真实 hook／共享 Toolbar／DOM，
   不 mock Toolbar 或复制 disabled 分支，不据此声称物理麦克风／Tauri Window 已验收。

逐项四分类：

- 原样保留：原录音 hook／状态机及原三项检查不变；
  原普通表情与 GIF-only 附件限制的区分保留，未把所有表情一起关闭。
- 共享迁移：shared Toolbar 已有单主体中接回原 recording 条件，
  Native 真实状态继续传入，不建立两套呈现或可配置禁用开关。
- 已授权治理改造：本次无新增治理例外；原 DD-75／SS-WEB-01 传输继续不变。
- 缺失需恢复：原 `ComposerEmojiPicker.tsx::handleGifSelect`、
  `desktop/src/features/gifs/relay.ts::relayKlipyEndpoints/fetchKlipyGifs/reportKlipyShare`
  和 gifMediaController 的完整页面仍未恢复。Relay 现有 api/gifs.rs::search/share
  不等于 Browser 已有受治理 BFF 消费链，当前 BFF／合同无相应读写消费者。
  原 best-effort share 也不能证明外部副作用终态；本批没有生成 GIF 入口。
  另已证原 `useComposerVoiceNote.tsx` 的 editTargetId 取消／迟到 upload fence、
  setEmojiPickerOpen 原关闭链在当前 Native 仍缺失，本批未扩改为完整语音交付。

原件目录：

`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/profile-settings-ortsoo.DRR20F/voice-emoji-20261009.PILFvV`

`owned-paths.txt` 精确两个路径，`inputs.sha256` 固定最终字节；
`owned-source.patch` SHA256
`b14d31deaf187e7be526f47d120f62ca9b0a025041ab89da5cf6b82ff86a273b`，
reverse／cached check 均 0，正式与候选两输入、正式与还原安装副本 cmp 0。
`official-to-current.diff` 为 Toolbar／原录音目标的完整全文 diff，391 行，
SHA256 `e7a786289a0e86f2375b933f7e43f8099e74fa8823e4f6f53aa6d2af7bc4fd52`；
其余原 Toolbar 残差仍如实保留，不将整文件归作治理授权。

实际命令及结果：

```sh
# 候选 collaboration/desktop；原 Node loader 和原目标，没有新 runner
node --import ./test-loader.mjs --experimental-strip-types --test --test-concurrency=1 src/features/messages/lib/useVoiceNoteRecorder.test.mjs
# 候选 client-kit/ts/platform
node node_modules/typescript/bin/tsc --noEmit
# 候选 Native cwd；复用现存 Web Biome，以 Native 原配置验两个拥有文件
/evidence/profile-settings-ortsoo.DRR20F/apps/web-client/web/node_modules/.bin/biome format --config-path=./biome.json /evidence/profile-settings-ortsoo.DRR20F/apps/client-kit/ts/platform/src/react/composer/features/messages/ui/MessageComposerToolbar.tsx src/features/messages/lib/useVoiceNoteRecorder.test.mjs
```

原 SDK xvkujx 实核 4 CPU／8 GiB，Node heap3072；
开始 available 27.8 GiB／memory full0.01%／I/O full3.65%／Data 可用277G。
正向 4531：4/4、exit 0；45898：shared tsc exit 0，但同请求格式入口缺失127，
总 exit 1，未把总失败说成通过。50078 从 apps 根跨工程格式因 nested-root 配置 exit 1；
43314 共享端误读候选根默认 tabs、Native 新检查行格式未收齐，各 exit 1。
没有迁移／修改任何 formatter 配置，没有整文件重排。
只修本批新检查行格式后，沿 Native 原配置最终 checked2/2、exit 0；
上述失败日志均保留于 format-*.log，最终为 format-original-config.log。

真生产破坏 23046：仅私有 Native 实际安装的 Toolbar 撤去原 recording 条件，
同原目标 3 pass／1 assertion fail、exit 1，失败实际是 emoji.disabled false≠true。
精确还原 cmp 0 后 29231：4/4、exit 0；见 mutation-native-receiver.log、
restored-native-receiver.log；不是 worker／loader／OOM 失败。
结束 SDK 仅 sleep，memory.events oom=2／oom_kill=2 与原基线相同，不增。

本批没有重跑此前 0-case Vitest、四 host 冷扫、full、镜像、安装或图谱。
本次无词条／Dart／schema／API／lock 变更。
完整全树分类仍为此前固定 a816 union5314 的历史账：
原样1976／共享112／整文件授权0／恢复队列3226，不能当当前 main 全树已核验；
恢复队列包含未证明保留或授权，不等同功能缺失条数。

本次未新登录／注入 Cookie／重置账号，没有新截图；
原 a816／登录页图不验此候选，两个源尚未部署或形成新安装包。
Web 录音、Native 物理麦克风／完整 Recorder UI、GIF 页面与 Windows/Mobile 均未验，
不声明原版全量一致／100%／生产就绪。根代理独占提交和集中发布。

## 2026-10-09 原 Composer 受控弹层与录音上下文恢复

权威：固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/features/messages/ui/useComposerVoiceNote.tsx::useComposerVoiceNote`、
`desktop/src/features/messages/ui/MessageComposerToolbar.tsx::MessageComposerToolbar`、
`desktop/src/features/messages/ui/MessageComposer.tsx::MessageComposer`。
本批归共享迁移／缺失消费者恢复，不是新的界面或执行权威；原菜单、顺序、文案、布局不变。

影响面：共享 Toolbar 改回原宿主受控 emoji state；Native 主／Forum 共用 Composer，
Web Composer 和两个已有共享检查 harness 全部传原受控 props。Native 录音上下文
同时消费 draftKey、editTargetId，切换取消，完成后再次比对才交原媒体上传链。
六条源／检查在接手点 `d619b0b06adea393ac21102ac9fe0ff4767981e5` 均 clean，
本批 +298/-19，无契约、词条、Dart、依赖、锁、Core 或新增 Web 录音 producer。

副作用／异常：录音开始由真实按钮关闭 emoji／formatting；同 draft 的编辑目标改变
也取消并释放设备，已停止 WAV 在 await 期间旧编辑上下文迟到不得上传；
同上下文完成只上传一次。原准入／授权／UNKNOWN 上传语义不变，不重传未知结果。
本批不新增状态或后台清理：继续原 recorder cancel／stop／release 生命周期。

证据目录：`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/profile-settings-ortsoo.DRR20F/voice-context-20261009.CVigGV`。
`owned-paths.txt`、`inputs.sha256`、`owned-source.patch` 固定六条最终输入，
`official-to-current.diff` 保留两个原模块全文差异；所有原命令在对应 `*-command.txt`。

原 4CPU／8GiB SDK `kailo-agent-receipt-xvkujx`，Node heap 3072、
`node --import ./test-loader.mjs --experimental-strip-types --test --test-concurrency=1 src/features/messages/lib/useVoiceNoteRecorder.test.mjs`：
首轮 7/8、exit1，真实 Popover 缺 JSDOM getComputedStyle；按已有夹具补全真实 window globals，
不 mock Toolbar／Popover／hook／recorder，最终 8/8 exit0。
首轮同批 shared prod／shared test／Web／Native 四 tsc 各 exit0；之后仅检查 MJS 的夹具／格式改变，
生产类型输入与当时一致。原 Biome 三文件先 exit1（四处新 import 换行），修后 exit0，本批六输入 diff --check0。

私有实际生产破坏与原字节还原：去掉 editTargetId 取消依赖→7/8 exit1（仍 recording）；
去掉完成后 editTargetId fence→7/8 exit1（旧 WAV 进入 upload）；
去掉 beforeStart 关闭 emoji→7/8 exit1（popup 仍 true）。
三次分别恢复 cmp0；最终 `restored-native-voice.log` 为 8/8 exit0。
最终六输入及 Native／Web 检查环境实际依赖目录中的 Toolbar 均 cmp0；SDK top 仅 sleep，
memory.current=286277632，原 oom=2／oom_kill=2 未增长。未重跑此前 0-case Vitest、full、bundle、镜像或安装。

全树账仍只到固定 a816 历史 union5314：原样1976／共享112／整文件授权0／恢复队列3226；
队列包含尚未证明保留或授权，不等同功能缺失数，不称当前 main 全量已逐处核验。
原 GIF／gifMediaController、setPendingImetaWhenIdle 与实际 paste imeta 消费者、
原 mention 清理／emoji 关闭其余读方仍有缺项；不把本批两全文模块称 100% 还原。

根代理另在已部署 a816 普通 SSO 会话通过原 Experiments 偏好启用三个原预览菜单，
并实际打开六张 `/volumes/data/kailo/tmp/kailo-original-*.png`：
experiments-off-20261009-0957、preview-sidebar-on-20261009-0958、workflows-page-20261009-0959、
projects-page-20261009-1001、workflow-create-20261009-1003、pulse-page-20261009-1005。
Pulse SHA256 `6e577b4f0e6d0e0ce913e14eb1ee499a1b72636778f958661af80cc356c068ee`，
CLI console 0 errors／0 warnings；Workflow 创建仍“本页没有有效执行器”且只四动作选项，
不能称完整 Workflows。隐藏菜单是固定官方 preview 默认 off，并未改默认值或新增入口。
这些是根代理已打开的旧 a816 实拍，不证明本批六源；本批无新截图／部署／安装包。
Web 录音、真实设备麦克风、Tauri／Windows、Mobile、完整 GIF 与全量原版一致性均未验收。

## 2026-10-09 原 Web 录音生产者共源接线（源码检查点，浏览器未验）

权威与影响：固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/features/messages/lib/useVoiceNoteRecorder.ts::useVoiceNoteRecorder`、
`desktop/src/features/messages/lib/voiceNoteWav.ts::encodeVoiceNoteWav`、
`desktop/src/features/messages/ui/VoiceNoteRecorder.tsx::VoiceNoteRecorder`、
`desktop/src/features/messages/ui/useComposerVoiceNote.tsx::useComposerVoiceNote`
迁到 `client-kit/ts/platform/src/react/composer/features/messages/` 同名四模块。
原 Native `MessageComposer` 与 Web `ChannelPane.tsx::Composer` 实际消费共享 hook，
原 Native 四实现已删除并同步来源登记；无未来兼容副本、无共享层反向 Tauri 依赖。
WAV 除来源注释外字节 hash 与官方 blob `0f41c88da77e9165226c8138b69fae8d5ae4048e` 相同；
其余模块的固定官方全文差异见本批 `official-four-modules.diff`，不宣称全 Composer 一致。

允许差异：原错误、录音 legend／按钮词条沿同一 TS 权威默认中文／英文，Dart 同源生成
新增 13 keys，reason 词条原件 cmp 0。共享媒体只读实际 pending／queued Files 与 uploadFile；
Native 队列保留原语义，Web queued 仅是正在真实 BFF 上传且尚未得到回执的 File，
入／出均在原 upload 的开始与 finally，按实际 owner 分区，不伪造已上传 imeta／空队列。
原 Mic／完成／取消／波形组件、PCM WAV 编码与时长限制不重设计、不另设阈值。

副作用与异常：DD-75 Browser 仍只调用既有 `bff-client.ts::uploadMedia`／各目的地 onUpload，
不持钥／裸连 Relay；Native 保留自己的原本机签名媒体链。无 schema、API 或执行权威变化。
实际共享 cancel／stop 保留权限请求、Strict Mode、卸载、迟到解码及 editTargetId fencing；
Web 上传 owner 包含 workspace／actor／draft／edit，旧回执不能追加进新草稿，
录音与待回执期间发送禁用，原独占语音附件判断覆盖 paste／drop／file input。
确定拒绝与 UNKNOWN 沿原媒体消费者区分；缺回执不生成卡片、不伪装成功、不自动重传。
HTTP／设备不支持 getUserMedia 沿原不可用错误，不添加浏览器 flag 或鉴权旁路。

实际验证：复用 `kailo-agent-receipt-xvkujx`，inspect／cgroup 4 CPU、8 GiB，
Node heap 3072；启动前 top 仅 sleep、host available 24 GiB、memory PSI 0；未新增环境。
最终 `64825` exit 0：原 Native 录音 8＋WAV 3 共 11/11，
shared／shared-test／Web／Native 四个 tsc 均 0；原格式六文件 0；同源生成 --check 0。
原格式第一次 exit 1 的三处新增 import／换行已按原配置修正，不整份重排宿主文件。
私有生产破坏 `76075`：WAV 头 RIFF→RIFX 触发原断言 1 fail／2 pass、exit 1；
去除 editTargetId fence 触发真实迟到录音上传断言 1 fail、exit 1；两文件精确恢复 cmp 0，
恢复原 11 项 exit 0，正式 13 个存在文件与候选 cmp 0、四删除路径双方确实不存在。
memory.events 的旧 max=16751／oom=2／oom_kill=2 未增长，无本批 OOM。

失败／未验：`88679` 与最终修正后的 `72347` Web Composer Vitest 均 worker 启动超时，
0 case、exit 1，不计通过或生产负向命中；新五个 Web 实际消费者用例均未运行。
第一次 Web tsc 的 node:buffer 类型错误已改为浏览器 FileReader 夹具，不加依赖，最终 tsc 0。
本批无新 Playwright 截图、真实麦克风／HTTP 上传回执／Windows／Mobile 设备验收。
线上仍 a816，不能用旧图证明本批；原 GIF、setPendingImetaWhenIdle／对应 paste 消费者等
既有缺项保留。无 full／bundle／镜像／安装包／部署，本批源码冻结交 root 提交。

交接：17 个源／原检查／生成／来源路径 `+945/-686`，不含其它继承 dirty 或 checkpoint 删除。
证据目录 `/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/profile-settings-ortsoo.DRR20F/web-voice-20261009.5QxZOG/` 的原 command／正负／恢复 logs、
`source-sha256.txt` 与 `owned-source.patch`；源码 patch SHA256
`84f176cbe863a6528c8a13dee3ec0ca74880aa6c09695543dcfb50ae2319ce94`。
本批四模块归共享迁移及逐项 i18n／宿主接缝，不用其替代全树逐项授权或实际功能验收；
历史 a816 全量账 5195 官方／5314 union／1976 相同／112 共享／3226 未证恢复队列
仍只是历史比较点，3226 不是已实证功能故障数，也不是本批当前 main 全量完成量。

## 2026-10-09 原 Workflow 运行历史加载／摘要恢复（源码检查点，case 未启动）

权威：固定 Buzz `779af8886caae1317b4de962082429867ab61503`，
`desktop/src/features/workflows/ui/WorkflowDetailPanel.tsx::WorkflowDetailPanel` 的运行历史分支；
既定 Temporal／BFF 仍是执行与授权权威，不恢复 Relay 原执行引擎。

影响：两宿主现有 `WorkflowsPage → AutomationManagement → AutomationRunHistory` 共用同一 TS。
仅恢复原 `Skeleton(h-16 w-full rounded-xl)`、`run.id.slice(0,8)`、绝对本地时间呈现；
消费真实 `AutomationRunPage.task.actionExecutionId/createdAt`，不新增字段、状态、持久化或 API。
完整执行 ID 仍用于选择 key、aria-label、title 与 TaskDetail 请求，短摘要不改变目标身份。
副作用：无写动作或第二权威；i18n 仅沿现有 locale／词条，不改被冻结的录音批。
边界：原 useLoad 的旧 scope／轮次响应隔离、validAutomationRuns 的 ID／operation／枚举验证、
拒绝不渲染为空、UNKNOWN 不渲染为完成等原守卫均保留；无假步骤或时长。

先实现，后追加既有 workflow-run-history 专项四个真实页面消费者用例：
中英摘要各一、等待历史→授权投影、等待历史→明确拒绝。
原 SDK `kailo-agent-receipt-xvkujx`，4 CPU／8 GiB，Node heap3072；
真实 cgroup memory.events 仍 max16751／oom2／oom_kill2，均是旧基线，本批无增长。
单轮 `94718`：`tsc --noEmit` 0；`tsc --noEmit -p tsconfig.test.json` 0；
`vitest run test/workflow-run-history.test.tsx --pool=threads --maxWorkers=1` 1，
实际 `Failed to start threads worker / Timeout waiting for worker to respond`，60.30 秒，
transform／import／tests 均 0ms，0 cases；未改超时、未重跑。
生产破坏／还原未执行：原 case 未启动，不能将另一次启动失败充作有效负向。
正式两输入与原候选 cmp0；git diff --check0；无 full／bundle／镜像／安装包。

普通 /app/ 导航真实跳回 IdP 登录页；截图已打开视觉复核：
`/volumes/kailo/.playwright-cli/kailo-ui-20261009-profile-next-login-required.png`，
SHA256 `b0099b9e921b5e7c8830994788e8a357229384b4bf5ce0f16c2197c90d5f29d7`。
无正常业务页面截图；旧 a816 Web 不包含本批；Windows／Mobile 未验收。
原 RunStatusBadge／Execution Trace 标题、任意步骤轨迹／时长仍是具体恢复缺项，
不以本批三处呈现迁移或类型通过声称完整 Workflows／全量原版一致。

交接：2 clean 源／检查路径 +59/-6，未含其它继承 dirty；
证据目录 `/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/profile-settings-ortsoo.DRR20F/workflow-history-20261009.4viaON/`，
含固定原完整模块、原命令、types／失败 log、owned-source.patch、输入 SHA。
历史 a816 全量账仍是 5314 union／1976 相同／112 共享／3226 未证恢复队列，
本批不重导全树、不把队列当已实证功能故障数或当前 main 全量验收。

## 2026-10-09 原完整音频播放器共享迁移（源码检查点，Web 页面 case 未启动）

权威：固定 Buzz `779af8886caae1317b4de962082429867ab61503`，
`desktop/src/features/messages/ui/AudioMessageAttachment.tsx::AudioMessageAttachment/renderAudioMessageAttachment`、
`desktop/src/features/messages/ui/MorphingPlayPauseIcon.tsx::MorphingPlayPauseIcon`、
`desktop/src/features/messages/lib/audioMediaLoadScheduler.ts::scheduleAudioMediaLoad/resetAudioMediaLoadScheduler`；
并按原 `desktop/src/shared/ui/markdown.tsx::createMarkdownComponents` 恢复音频段落承载。
三份原完整模块实际复制到共享 TS，不另写播放器；15 个静态 className 字面量原样相同，
波形／播放暂停／seek／速率／等待点击／失败重试／下载与移除的原布局和交互 body 保留。
全文差异逐项仅共享 import、同源中英词条与下述真实宿主接缝；源码相同不等于视觉验收。

影响：Native 原 Markdown 与 ComposerAttachments 真消费者经薄本机 IPC 适配接共享组件；
原 connectCommunity 仍真实消费同一共享 scheduler reset；两旧纯模块删除，无重复实现。
Web MessageContent 对已背书 imeta 使用原 resolveAudioAttachment／voice-note 排他／段落算法，
ChannelPane 原 ComposerAttachments 接同一 AudioAttachment；未背书远端链接仍是普通链接。
Web 只读当前 scope 的已解析同源 BFF reference，带同源凭据、拒绝 redirect，
不接 Desktop IPC、不降级到 imeta 原远端 origin。纯 hash BFF URL 没有格式扩展名：
host 消费实际已授权 imeta MIME 生成真实 Blob；Native 保留原 URL MIME 与原本机 fallback。
副作用：无 Core／Relay API／合同／注册表／账本／数据库改动；11 词条沿原生成器同步 Dart，
reason_text cmp0，未改 contracts；下载仅现有合法宿主，读取失败保留原 Retry，不报成功。
边界：原三任务上限、排队取消、活动 abort、迟到 active fence、unmount URL 回收、
一个播放源、解码失败／波形失败分别呈现均保留；旧 scope 不因重试获得新准入。
普通读失败不当外部写 UNKNOWN；本批未新增发消息或执行动作，也未变更 Web 录音安全上下文。

原 SDK kailo-agent-receipt-xvkujx，实际 4 CPU／8 GiB cgroup，Node heap3072；
memory.events max16751／oom2／oom_kill2 是旧基线，本批无增长。
24698：原 i18n generate/check 0；Native 原 audioAttachment＋scheduler 14/14 exit0；
Shared production/test、Web、Native 四 types 各0；同轮 Web MessageContent 原 Vitest
`--pool=threads --maxWorkers=1` 60.08s worker 启动超时，0 case exit1，整批exit1；
保留 web-audio.log，不改超时、不重复启动、不以类型代替这3个真实 Web 消费者 case。
私有原已安装共享 scheduler 去除实际并发守卫，原2/2检查真实失败exit1（7≠3／5≠4）；
apply_patch 精确还原 cmp0。37825：同原14/14恢复exit0，i18n check及四types均0。
最后 MIME 三输入修正后，84945 只做必要 Shared生产／Web类型，各exit0；
Native调用文件与已验字节不变、host字段可选，无再次 Native／Vitest冷扫描。
正式14个现存输入与候选cmp0、2个删除路径无旧读方；git diff --check0，
owned-source.patch reverse check0；无 full／bundle／镜像／安装包。

正常 SSO 真实回调阶段一次 build fetch 失败保留；正常 /app/ 后读回已部署9edf
buildId `sha256:c3763fade6473c689a81b44070488c678e4c492fa84757909df16da73efe317a`。
该版本不含本批或 dd399 录音／dd3 History；只读两张截图均已实际打开：
`/volumes/data/kailo/tmp/kailo-audio-lane-9edf-channel-20261009-1159.png`，
SHA256 `992c14eb2fd7622b6ce884cd2f1a2ea0acb66d9c32d68bb1e40fbc23ab3b0f6c`；
`/volumes/data/kailo/tmp/kailo-audio-lane-9edf-avatar-picker-20261009-1200.png`，
SHA256 `6f92f2660caa9a3b0715e820408227cf332528a0f2f983165c86a4efbbc384b9`。
真实频道头像／两图网格／Composer及原头像选择器展开→正常完成退出可见；
未上传或改资料，bootstrap无既有图片，裁剪Editor未进入；不是本批音频浏览器验收。
本批未部署，Web真实播放／速率／seek／授权撤回实操、Windows／Mobile均未验收。

交接16 clean源码／检查／生成输入 +1093/-758，无继承hunk；目录
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/profile-settings-ortsoo.DRR20F/audio-playback-20261009.eBLpWN/`
含三份固定原完整源码及共享全文diff、owned-paths、input SHA、原命令和正／负／还原log。
owned-source.patch SHA256 `13881b35c15b9a472edb400dc603770a79d1606c6d9429d0b6a662881c598e63`。
当前保留的全树账比较点 dd399f93f584b30d4a6301a5024c3959d4d420e6：
5314 union／1970原blob相同／115有证共享／0整文件治理授权／3229未证恢复队列；
这是历史源码比较，不是当前main全量功能／视觉验收，3229也不是已实证功能故障数。
本批三原模块归共享迁移，拒绝远端降级／MIME及中英宿主差异逐项记明，
其余原 Settings／Workflows／GIF等未恢复消费者仍保留缺口，不声称100%。

## 2026-10-09 原 Community Invitations/Tenant Members 共享恢复与4c实拍

源码 checkpoint，不是完整原版恢复、上线或生产验收。17 个本批 clean 输入
（3 新共享模块、14 修改／生成／既有检查）冻结为 +855/-76；没有吸收继承源 hunk。
原版基准固定 `779af8886caae1317b4de962082429867ab61503`，
`desktop/src/features/community-members/ui/CommunityInviteDialog.tsx::CommunityInviteDialog`、
`desktop/src/features/community-members/ui/InviteLinkSection.tsx::InviteLinkSection`、
`desktop/src/features/community-members/ui/CommunityMembersSettingsCard.tsx::{CommunityMembersSettingsCard,RelayMemberRow}`
均已读取完整原文件并留下全文差异；
`desktop/src/features/settings/ui/SettingsPanels.tsx` 的 community-members descriptor 原为 Invites + Ticket，
本批恢复现成 `communityMembers.title` 的菜单读方，未把内部 Members 分组改作外侧菜单名。

动手前四步结论：

- 权威：原布局／动画／搜索／Added／菜单顺序来自固定官方模块；
  DD-83 的一次性、服务端到期、原动作准入／审批／审计和 UNKNOWN 仍由既有 Core/BFF 消费者维护。
  原 DirectAddMemberForm 与可选多用／到期没有已开放治理能力，不生成假控件或空 callback。
- 影响面：邀请首个确认回执 → 原 Link；完整 Tenant role-members 游标目录 → 原 Card；
  Web 可信 session.tenantPrincipalId、NativeBootstrap 原会话读 → 同一 PlatformProvider／You；
  Native 原 writeTextToClipboard → 同一复制消费者。管理面两端仍 BFF，本机凭据／Relay传输不迁入 Web。
  复用原 MembersPane 游标加载逻辑，现 helper 由原 Workspace 列表和新 Tenant Card 两个真实读方调用。
  原总数／搜索基于全列表，无新增分页UI；可选 createdAt/pubkeys 由主线原合同／四侧生成，旧缺省不伪造。
- 副作用：复制只在宿主真实 ACK 后 Copied，失败／迟到回执不报成功；
  client 或可信 Principal 换代即重置整个消费 scope。成员菜单只消费服务端精确 can* 位，
  不按 admin/member 推权限，不用 Tenant admin 冒充 Relay CONTROL owner，不复制头像／资料正文。
- 边界：重复游标／重复 Principal／后续页失败／非法可选字段拒绝完整目录，不暴露可操作部分结果；
  一个 HUMAN Principal 的多 ACTIVE SERVER/CLIENT pubkeys 仍是一人，不择首key猜本人或资料授权。
  You 缺可信 Principal 即不渲染；无 metadata 即不捏造日期／key；空目录保留原空态。
  邀请关闭、隐藏、刷新或读失败不清 UNKNOWN 的原意图／幂等key；角色确认沿原治理动作，未知不当终态。

四类差异逐项边界：原输入／Button／Dialog／动画等既有共享原 primitive 本批原样复用；
三原模块的原外观结构、Link状态、完整搜索／虚拟列表／成员菜单迁入同一 TS，两真实宿主消费；
上述 DD-83、Principal映射／精确权限／本机clipboard和同源中文为已授权接缝；
原真实 Tenant avatar/profile read、NIP05／ProfilePopover、Relay CONTROL owner 呈现、
DirectAddMemberForm 原完整产品仍未恢复。不得将整文件差异笼统归治理或把 fallback Avatar 称真实头像加载。
原 community-members Native目录 remove_paths 仍是共享迁移来源事实，不以删除登记掩盖剩余缺项。

实际检查记录（最终正式17字节不可用旧候选结果代替）：

- 原受限 `kailo-agent-receipt-xvkujx`：4CPU／8GiB，Node heap3072，原 caches，
  无新SDK／依赖安装／镜像／bundle／full。旧 memory.events oom/oom_kill=2 是基线，不算本批负向命中。
- 40604：三原 UI 目标 59/60；唯一失败为既有 Ada avatar alt 断言，与原实际 alt 不符，已纠正。
  两共享 tsc 各 exit2 为已删 unused import；Web/Native tsc各0；TS member往返1/1 exit0。
  Dart失败为未设PUB_CACHE导致 /.pub-cache permission denied，未验收。
- 4496：原 i18n生成／check各0；邀请18/18，但 settings/members 各0 case、worker启动超时，UI总exit1。
  共享源码／检查 tsc各exit2为已恢复的 TransportError import；
  Web/Native tsc各exit2为候选已安装 platform副本仍旧props，不能计正式消费者通过。
  TS member往返1/1 exit0；Dart exit64：本轮误用不支持的 --no-pub，未执行case。
  原测试超时／断言没有放宽，失败日志保留。正式已补中文角色搜索、菜单实际断言及原新Card formatter。
- 最终尾验尚未执行：最小同步原两宿主实际安装副本的45300、只读top85239仍无终态。
  已观察 SDK bash2590430 Ds，内核 __flush_workqueue → cgroup_writeback_umount/cleanup_mnt；
  没有启动重复Node、重启／改mount／另建环境。最终四UI（含原bootstrap）／四types／TS-Dart往返、
  本批 production保护破坏与字节还原均尚未执行，不能把启动失败或计划记为正／负验收。
  主线33路径候选 full 尚未终态，本记录不将其记通过。

证据目录：
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/community-invite-20261009.koOleB/`。
`owned-source.patch` SHA256 `1aa0beee5a112582b0fd699aafef6ba0390fdd698d6133013c88583d76a21284`，reverse-check0；
`owned-source-paths.txt` 给精确17路径；`upstream-*.tsx` 是三份原文，
`official-shared-{CommunityInviteDialog,InviteLinkSection,CommunityMembersSettingsCard}.patch`
分别 SHA256 `6c4a21136a1275e149d893c4d773c74230e27a75109fedb7bf8cfafe35bf5848`、
`23948914378846ca322fd0094888503f75feb5280439cfed5b9bd277b933368c`、
`de0823867b97c14e6887a1cc211f02101468c0e259ad78ebe8a6bdc9a94aa9a2`。
`final-*.log` 保留4496原各阶段；`sync-kernel-wait.log` 保存只读阻塞证据。

正常 seam-verifier SSO 的4c实拍独立在
[Profile实拍回执](../../web-client/fork/verify/screenshots-20261009-4c099-profile.md)：
实际 buildId `sha256:9e1bd3032cefb32ac76fc5e64e9ed0fa7d8b45091acfe2e5556d990b407e1761`，
10原件均打开，7稳定目标／3错误页或过渡态排除；没有资料PUT／mediaPOST、上传／保存／擦除。
英语 Profile description 仍被当前 About 替换，保留缺项；未将原Editor不消费previewName说成新功能。
这些图只验已部署4c，不验新邀请／成员卡，Windows／Mobile及本批新页面视觉均未验。
全树账仍仅 dd399f93f584b30d4a6301a5024c3959d4d420e6 历史比较点：
5314 union／1970相同blob／115有证共享／0整文件治理授权／3229未证恢复队列，
不是当前main完整核验或功能故障数；本批不声明全量100%。

### 本批尾验真实终态与恢复（追加更正上述等待时点）

45300 最小安装副本同步和85239原top随后均实际exit0，两宿主platform／contracts输入cmp0。
最终85350：i18n-check0、shared生产／检查／Web／Native四tsc均0，
原TS／Dart member removal permissions往返各1/1 exit0。
该次UI69/70仍exit1：settings唯一旧断言将新增Card目录GET混入邀请总次数，
members线程0case启动超时；原错误保留。只修已有settings fixture为两个真实端点形状，
邀请GET仍精确2次、目录GET精确2次、无POST；生产16文件未变。
该检查文件Git blob `3e99faf7584c5f8ceea7f1594c89ee960d16b8c0`。

26964尾验同原settings／members目标53/53、最终检查tsc均exit0。
私有生产对象破坏：66385将目录截为第一页、把Tenant晋升位换为Workspace位、倒置可信You判定，
原members29项实际7失败／22通过、exit1，确实抓到部分目录／越权菜单／错误身份标记；
roles与Card原字节还原并分别cmp0。14280将复制失败误置Copied，
原invitations18项实际1失败／17通过、exit1，命中 expected idle received copied；Link原字节还原cmp0。
恢复54235同四个原消费者invitations／settings／members／bootstrap：4文件99/99、exit0；
memory.events仍原max16751／oom2／oom_kill2，无本批增量。stderr仍有原act／Reduced Motion提示，未隐藏。
没有修改检查超时或为通过替换被测真实组件／权限消费者。

最终17输入现在 +864/-78（含唯一既有检查纠正），全部其余源保持冻结；
`owned-source-final.patch` SHA256 `a8aafa18911541a01439dbc497cbd7a8e98835e23423a9ceed57353284cfdfe4`，reverse-check0。
原正向／失败／负向／恢复日志在同目录 settled-*／tail-*／negative-*／restored-ui.log；
前述owned-source.patch为初始冻结，不能冒称最终检查字节。原full41490仍对应旧efb树／旧计数断言，
不将最终尾验冒作该full通过。本批邀请／成员卡尚未部署或浏览器实拍，4c截图边界与剩余原版缺项不变。

## 2026-10-09 原 SentFromThreadLine／来源链接共源恢复检查点

权威与影响面：用户 2026-10-07 固定原版一致性决定、DD-75 本机持钥／Web BFF 边界；
固定 Buzz `779af8886caae1317b4de962082429867ab61503`：
`desktop/src/features/messages/ui/SentFromThreadLine.tsx::SentFromThreadLine`、
`desktop/src/shared/ui/markdown/MessageLinkPill.tsx::MessageLinkPillContents/segmentLinkLabel`、
`desktop/src/features/messages/lib/messageLinkLabel.ts::getMessageLinkLabel`。
真实生产者仍是 Native `desktop/src/features/messages/hooks.ts::useSendMessageMutation` 的原来源 tag；
Native `MessageRow.tsx` 和 Web `ChannelPane/ChannelThreadPane` 两个实际行消费者共用原呈现主体。
没有修改 Core、Relay、正文权威、契约、迁移、写准入或读状态；schema／数据兼容迁移无适用对象。

差异逐项边界：原样保留的 shared `messages/sentFromThread.ts` 与固定原路径 blob
同为 `90076c04c7e3844256dc01762d9efa8894f8e3c4`。
共享迁移原来源行全部 class、原来源链接 span/button、emoji 分段与仅文本 hover 下划线，
Native 不再保留重复渲染主体；原默认 MessageLinkPill 的 metadata/tooltip 分支没有迁移或删除。
授权差异仅中英同源词条和宿主接缝：Web 将当前已准入 native channel 映为其 Workspace 导航 key，
不从任意 tag 猜另一 scope；保留原线程编辑离开守卫，Native 仍沿原目录和 goChannel。
缺失需恢复仍包含 Web DM 的来源深链导航、Web 原 send-to-channel 生产者，以及未逐项核验的
完整 MessageLinkPill 默认分支/其他原页面；不能由本次共享迁移推论这些功能已经完成。

边界：无 channel、无来源或原非法 tag 返回 null；无可用原导航消费者走固定原版非交互 span。
撤权／中断收回真实按钮；来源 root 使用原 tag 的规范化值，不改为当前行 id，不发明引用权威。
新显示/导航无外部写副作用、无新状态或重放；目标读取仍沿既有 BFF/原生 Relay 授权路径，
没有把链接、目录命中或 DOM 显示当权限。原 dirty thread 处理不绕过、不增确认框。

本批相对已封存成员树 `aa078475bf73967cfc6c8e185327b7e112346305`：
12 源码／检查／生成路径 +294/-118，i18n 与 Dart 仅新增 3 keys，不混前批成员逻辑或继承删除。
证据目录：
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/sent-from-thread-20261009.MXo6jp`。
`owned-source.patch` SHA256 `4d86cac8b069b7ae48755635ac3b5224f7d6c8e262ddb2d0500ccdf0ffcea34e`；
12 输入逐项摘要在 `owned-source-sha256.txt`，原本批 diff-check 0；来源记录没有这两路径的过期 remove 声明。

原受限 SDK `kailo-agent-receipt-xvkujx` 回读 4 CPU/8 GiB、无额外 swap、uid1000，
使用既有候选/依赖与 Node heap3072；没有安装、镜像、bundle、全检或 GitNexus。
生成 `tools/gen-platform-i18n.py` 与 --check 均 0。
62241 首轮共享 message-row 14/14、shared 生产/检查及 Web/Native 四 tsc 均 0；
Web 原 54 项为 49 通过/5 失败：本批两个 fixture 未按 Relay newest-first 排序被原守卫拒绝，
另三个旧 mention selector 与现有同源 aria 文案不符；只纠正 fixture 排序和原精确 selector，没有改生产准入。
首轮 Native helper 命令遗漏现有 test-loader，两个文件启动失败、未执行原 case；该错误原样保留。
最终 43372 同一串行批，共享 14/14 和 shared 两 tsc 已 0；
Web threads worker `Timeout waiting for worker to respond`、0 case、exit1，不记通过或放宽超时；
记录时 Web tsc 在途、Native 原 loader/helper 与最终 tsc 尚未终态，生产负例/精确还原尚未执行。
原始命令在 `verify.sh`，输出 `positive.log/final-positive.log`；后续真实尾验单独追加，不冒称已通过。

本批没有浏览器新版实拍、没有部署、没有 Windows/Mobile 设备验收。
当前 4c099 实拍仅证明既有 Profile 的 7 个有效状态，不证明此来源行或新成员卡。
旧 dd399 全量账 5314 union（1970 原 blob、115 已证共享、0 整文件治理授权、3229 未证明恢复队列）
仍是旧比较点，不是当前 main 全量功能缺失数或全量验收；本次未重复重导全树。

### 原尾验继续结果与唯一检查导入更正

43372 的 Web tsc 随后真实 exit2：唯一 TS2305 为本批检查误导入不存在的 `i18n.t`；
只将该原 selector 的导入改为实际 `translateCurrent as t`，其精确文案／assertion与生产11文件不变。
原 loader/helper 随后 10/10、exit0；记录时该同一句柄最后 Native tsc 仍在途。
修正后的 Web 类型／两个新 Web case 尚未复验，不用首轮或0case冒称最终通过。
最终12源码补丁 `owned-source-final.patch` SHA256
`ded118e8237df248fe56bd952b321cf2a824f22fa71a91e37e777ba94101c25f`，reverse-check0；
唯一改动检查文件 SHA256 `62642175525cd5a05ba7c648ec4ece67dd9c03ad7cb589b9369dbcb779c97079`。

### 原后置终态与无效负例边界

43372 最后 Native tsc 真实 exit0，整轮 exit1；原 shared14/14、shared两tsc0、Native10/10及tsc0不变。
Web worker timeout／0case、旧检查导入 TS2305／exit2 保留，不把随后单项修正冒作整轮通过。
59154 私有候选将原来源 `messageId/threadRootId` 从 rootEventId 破坏成 channelId，
原 `target.sh shared` 又因 threads worker 启动超时执行0case、exit1，不能作为生产保护命中。
已 apply_patch 精确恢复原 root 字节，与破坏前备份及正式源两次cmp0；不重复此worker目标造绿。
正式12路径逐项 SHA256 全部OK；纠正后的 ChannelRead检查最小投递私有候选cmp0。
70849 仅原 Web `tsc --noEmit`／heap3072在途，无重复suite或第二类型进程，未有退出码不算通过。
原SDK仍4CPU／8GiB，后置 memory.events max16751／oom2／oom_kill2无增量。
原始负例 `negative-root.log`、最小类型 `final-web-types.log` 在同证据目录；后续终态另行追加。

70849 随后真实 terminal exit0；原命令 `node node_modules/typescript/bin/tsc --noEmit` 经 pipefail控制流捕获，
不是以0字节日志推断通过。纠正后的 Web 类型通过不改变此前0case／旧TS2305／整轮exit1事实。
结束后 docker top 仅sleep，memory.events仍原旧值无增量；原SDK验证窗口已释放。
本批两个新增 Web交互case与有效生产负例仍未验证，没有新版实拍／部署或Windows/Mobile设备验收。

## 2026-10-09 原 FileCard 附件卡共源恢复检查点

固定 Buzz `779af8886caae1317b4de962082429867ab61503`：`desktop/src/shared/ui/markdown/FileCard.tsx::FileCard/formatFileSize`
原 blob `889847193ec38b4ecca58fc027c63a1739edb1eb`；`desktop/src/shared/ui/markdownFileCard.ts::resolveFileCard`
原 blob `05b4f677e5607e4ffe91b2d141c5877a8f71e485`。权威为原版恢复要求、DD-75 与 SS-WEB-RELAY。
完整卡 markup/class/style/大小算法原样迁入 shared messages；Native 原卡只保留真实 download_file IPC，Web 原 MessageContent 实际附件读方接同一卡。
原分类/文件名优先级共源，Native 仅 rewriteRelayUrl；Web 仅使用当前已受权 imeta 的 hash 和 Workspace/Conversation BFF 路径，不访问标签的远端 origin。
原 `desktop/src/shared/ui/markdown.tsx::createMarkdownComponents/MarkdownAnchor` 使用 getReactNodeText；Web 原真实 label 读方现复用已共享原函数，嵌套加粗正文不再变成 [object Object]。
影响面为共享2模块/export、两 Native 消费者、Web MarkdownLink 与原两个专项，共9路径；起点全部clean，无契约/数据库/新依赖/lock变更。
共享迁移不复制附件正文或增加权限权威；下载不宣称终态成功、不自动重试。缺 imeta/hash 保持普通链接，缺 MIME 或 image/video 不误分类文件卡，缺 scope 仍拒绝。
逐差异分类：原 markup/class/size 与纯 resolver 为共享迁移；Native IPC/Web 当前授权 BFF transport 与现有同源 buzz.downloadFailed 词条为授权宿主/中文适配，非整文件笼统授权。
snapshot Import/完整 resolveSnapshotCard、视频播放器等其它原功能未在本批恢复，不以新增通用文件卡认定它们已完成。
最终源码 `owned-source.patch` SHA256 `56d7e825c957e7a8825ab53aacdf57edfbf71c8c4998a7d196b905edf7a0d2ee`，9路径 +218/-85、reverse-check0、scoped diff-check0。
原证据目录：`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/file-card-20261009.6l8WwC`。
SDK实读4CPU/8GiB/noextraSwap、heap3072；正式9输入与候选/两宿主实际已安装shared副本最小投递cmp0，无新SDK/镜像/安装。
第一次 formatter 因 Native 目录没有 Biome入口 exit1；第二次原 Web 已安装入口对 Native2文件处理，但 shared 路径误差诊断不能算四文件通过。
纠正原输入相对路径后 shared2文件 format exit0，Native格式仅回写实际两行，未重排原紧凑Web文件。
全工作树 diff-check exit2 的4个继承 EOF空行保留批外；upstream_manifest status exit0，Buzz固定基准无新提交，Worker领先75不升级。
7043 `positive.log` exit0：`python3 tools/gen-platform-i18n.py --check`0、Native原 resolver10/10、Web MessageContent19/19、shared生产/检查/Web/Native四个 tsc0。
后续仅纠正两Web输入的原嵌套label读方；46575 `final-web-positive.log`最终19/19 exit0，不能拿7043旧两Web字节替代此结果。
74151 `resolver-negative.log`真实生产filename优先级破坏：9pass/1fail exit1，原断言捕获 Q3-budget.pdf 错变 link text；原字节/Native安装副本cmp0后 `resolver-restored.log`10/10 exit0。
62996 `web-download-negative.log`仅将真实卡按钮的下载URL改成sender origin，1fail/18filtered exit1，三scope的原BFF地址断言全部捕获远端替换；不是编译失败或0case。
Web原字节与备份cmp0后85805 `web-download-restored.log`最终19/19、Web tsc各0、整体exit0；两次生产变异均只在私有候选，正式9源未改。
原目标命令：Native `node --import ./test-loader.mjs --experimental-strip-types --test src/shared/ui/markdownFileCard.test.mjs`；Web `node node_modules/vitest/vitest.mjs run src/features/chat/ui/MessageContent.test.tsx --pool=threads --maxWorkers=1`，负向只加原 `-t "real file-card button"`。
类型为各原cwd `node node_modules/typescript/bin/tsc --noEmit`，shared检查另加 `-p tsconfig.test.json`；未改超时/断言/runner。jsdom原 canvas getContext 警告保留，不安装替代依赖。
最终 memory.events仍旧 max16751/oom2/oom_kill2无增量，唯一串行窗口终态后释放；未启动full/bundle/Cargo/Go。
本批无新版页面实拍/部署、浏览器真实下载终态、Native下载设备或Windows安装包/Mobile验收；当前线上4c与本批源码明确分开。
历史全量账仍为dd399：5314 union、1970原样blob、115已证共享、0整文件授权、3229尚未证明保留或授权的恢复队列，不是当前main全量覆盖或3229项功能缺失，未声明100%。

## 2026-10-09 已部署旧版设置页面截图复核

复用既存 playwright-cli 会话 `avatar-seam-restoration`，正常 SSO 重新登录，无 Cookie 注入或认证绕过。
实际 `/api/v1/build-info` 返回 BUZZ_WEB、buildId `sha256:9e1bd3032cefb32ac76fc5e64e9ed0fa7d8b45091acfe2e5556d990b407e1761`，
reportedAt `2026-10-09T15:39:24.407Z`；部署来源仍为 `4c099a5f9b508f7df47b9fc923fe37ab7375aa70`，不代表后续 FileCard 与链接预览源码已发布。
证据 `/volumes/data/kailo/tmp/ui-live-settings-20261009.4hedkD/receipt.md` 及同目录 9 张 PNG 均实际打开视觉复核；有效覆盖 8 个页面/语言状态。
Shortcuts、Custom emoji、Invites、Experiments 各检查中文/英文；键帽分类、表情上传表单与空态、四个实验开关布局可见。
旧邀请页依旧有重复标题/说明及简化表格，不能据此验收新共享邀请页。未上传表情、创建邀请、切换实验开关或逐一触发快捷键。
`06-custom-emojis-en.png` 实为错误定位后重复的英文 Shortcuts，明确不计入表情页覆盖；正确英文表情页为 `07-custom-emoji-en-actual.png`。
错误 testid/英文定位器曾真实失败，详见原回执。正常 Appearance 切换英文后已恢复简体中文；没有把 Web 实拍称为 Windows 或 Mobile 验收。

## 2026-10-09 原链接快照媒体与完整预览灯箱共享恢复

权威为 Buzz `779af8886caae1317b4de962082429867ab61503` 的 `desktop/src/shared/lib/linkPreviewSnapshot.ts::parseLinkPreviewSnapshots`、`desktop/src/shared/ui/markdown/useMessageLinkPreviews.ts::mergeMessageLinkPreviews`、`desktop/src/shared/ui/markdown/LinkPreviewImageLightbox.tsx::LinkPreviewImageLightbox`，与 DD-80/81 的 Web 代签及租户媒体准入。不是另写页面或用摘要代替原卡片。
本批 9 源路径 +331/-208：原解析/消息顺序合并及完整画廊迁入共享主体，Native 使用薄导出；Web 恢复原图、favicon、原多图/缩放/焦点/Escape 灯箱和原 spoiler 抑制。唯一治理差异为只将严格匹配原图哈希交给当前 scope BFF，不将 authored URL 作为代理目标。不变更契约、数据库、Relay 正文或新建媒体权威。
影响面逐一检索 7 个 Web 生产 MessageContent 消费者：ChannelPane、ChannelThreadPane、InboxPane、InboxThreadPane、ForumPane 有 workspace/conversation；Pulse 经实际 onMediaUrl；InboxDrafts 有 draft.channelId 且无 snapshot tags。没有实际无 scope 的合法文本快照消费者，既有合法无媒体快照在已准入 host 下保留。
准入核对 `core/crates/platform-core/src/web_transport.rs::fetch_media_for`、Relay `handlers/ingest.rs::validate_link_preview_tags`、`handlers/imeta.rs::validate_local_image_media_pair` 与 `api/media.rs::serve_blob_for_tenant`。无 host、错误版本、缺失哈希、不匹配原图路径、缩略图/SVG、凭据/query/fragment、resolver 拒绝或抛错均不产生媒体预览；切 scope 重建 overlay，未知媒体不回退 sender origin；批内无新增持久状态。
冻结补丁 `/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/link-preview-20261009.4Q77e6/owned-source.patch`；该目录保存本批原输出。仅运行原 SDK `kailo-agent-receipt-xvkujx`，4 CPU/8 GiB，未起镜像/全量编译。源码写入不等于运行验收或部署。
第一次 `positive.log`（14698）整体 exit1：Native 6pass/2fail，原因是 `file:` 安装副本仍是旧 parser/merge；Web/shared Vitest worker 未启动、0 cases。核对后只同步已有候选的安装副本并 cmp；未改超时、runner 或降低断言。
第二次 `resolved-positive.log`（62808）真实整体 exit1：Native parser/merge 8/8；Web production、shared production、shared test、Native 四个 tsc 全 exit0；Web 与 shared Vitest 都因 worker 启动超时 exit1、0 cases，因此新画廊交互断言仍未执行，不报通过，不第三次盲重试。
原命令为 Native `node --import ./test-loader.mjs --experimental-strip-types --test src/shared/lib/linkPreviewSnapshot.test.mjs src/shared/ui/markdown/useMessageLinkPreviews.test.mjs`；Web `node node_modules/vitest/vitest.mjs run src/features/chat/ui/MessageContent.test.tsx --pool=threads --maxWorkers=1`；shared `node node_modules/vitest/vitest.mjs run test/settings.test.tsx --pool=threads --maxWorkers=1`；类型检查为各自 `node node_modules/typescript/bin/tsc --noEmit` 及 shared `-p tsconfig.test.json`。
负向仅在私有 Native 安装的真实共享 parser 将 `return typeof host === "string" ? url : host(sha256)` 改为 `return url`；`negative-resolver.log` 7pass/1fail、exit1，`the Web host receives only matching original blob hashes, never an authored URL` 实际断言抓住绕过 hash resolver，不是编译错误或 0case。还原真实实现后 `restored-resolver.log` 8/8、exit0。
尚未验收：新 Web gallery DOM 交互、新版浏览器媒体读取及截图、Windows 实机与 Mobile；未部署或发布新版包。后续完整视频审阅模块属于独立进行中的批次，不混入上述 9 源补丁，也不能把旧 4c 页面当此批新证据。

## 2026-10-09 原完整视频审阅共享恢复：源码与阶段证据

固定源仍为 Buzz `779af8886caae1317b4de962082429867ab61503`；`desktop/src/shared/ui/VideoPlayer.tsx::VideoPlayer` 实际 2206 行，blob `67036050109b8d74a0d4b775f4d884abf199dec1`，纠正早期“2073 行”的旧估计。连同 `desktop/src/features/messages/lib/videoReviewContext.ts::buildVideoReviewPresentationByMessageId`、`desktop/src/shared/ui/VideoReviewCommentMarkdown.tsx::VideoReviewCommentMarkdown`、原 Checkbox、时间码/播放状态/速度/海报/下载/菜单模块迁入 `client-kit/ts/platform/src/react/video-review`，Native 保留薄宿主。原布局、控制条、放大审阅、帧评论开关、回复与评论反应均沿原实现，不以裸 video 控件代替。
影响面包括共享 timeline 的 channelType、Native ChannelPane/TimelineMessageList/InboxDetailPane，以及 Web MessageContent 和 ChannelPane/ChannelThreadPane/InboxThreadPane/ForumPane 实际消费者。Web 使用原 Composer/EmojiPicker/MessageAuthorAvatar 及既有 BFF publish/reaction；Forum 45001/45003 沿现有 Core `web_transport.rs::read_reaction_message` 和 `channel_message_event` 准入，不增第二套消息或反应权威。
样式不是重写：固定上游 `desktop/src/shared/styles/globals/video-review.css` 与共享现文件 blob 同为 `609c857c6f811893d2b83ee8bb67cb1ba421b4b9`，`media-controls.css` 同为 `58a82ab4f586f3fc1c9e56856e047d5ed2246153`。两端现有 globals.css 均 import 共享 styles.css 且显式 `@source` 扫描安装的共享 src，不单靠页面 DOM 假设 Tailwind 会自动扫描 node_modules。实际新构建 CSS/截图仍需发布验收。
授权差异：媒体与原 NIP-71 poster/旧 thumb 只解析当前 scope 的 imeta hash，绝不将 authored URL 传入代理；无 MIME 旧视频复用原 `mediaEntry.ts::isVideoMedia`。评论头像只读当前已准入事件作者。原 optimistic 评论行删除，只有 Relay 事件流确认已发布；UNKNOWN 中性显示并保留原 Composer 草稿。原 UI 因不可发送而直接 return 的路径改为明确拒绝，防止宿主把未发送当成功清掉草稿。
Web 视频发送沿原 BFF 幂等键冻结最终时码正文、parent、附件 receipt 和安装提及；scope/principal/conversation/root 分隔本机在途草稿。超时/未知结果保留同键对账，后续拒绝不改写之前未知结果；切 scope 或撤权不刷新新 scope。不同新快捷反应不能把旧 UNKNOWN 的对账成功冒充自身成功。确认后的本机冻结草稿删除；无法取得确认保持可人工重试/对账，不自动重复副作用。无正文进入 Core、新数据库状态或契约变化。
39 条原视频词条补全默认中文/英文；原 `tools/gen-platform-i18n.py` 在受限 SDK 执行 exit0，同源投影 `client-kit/dart/lib/shared/platform/platform_text.dart`，不是另一份翻译权威。
仅使用已有 `kailo-agent-receipt-xvkujx` SDK，4 CPU/8 GiB；未起镜像。原 node 四文件批次（6850）29/29、exit0。私有已安装真实 `videoReviewContext.ts` 的 `onToggleReaction(sourceComment, emoji, remove)` 改成空 resolve 后，36353 为 9pass/1fail、exit1，实际 `restored review preserves channel type, Agent comments and actual reaction source` 断言捕获派发缺失；原字节恢复后59300为29/29、exit0。证据目录 `/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/video-review-20261009.uXWccg` 内 `reaction-negative.log`/`reaction-restored.log`。变异不落正式源码。
原命令：`node --import ./test-loader.mjs --experimental-strip-types --test src/features/messages/lib/videoReviewContext.test.mjs src/shared/ui/videoReviewTimecode.test.mjs src/shared/ui/videoPlayerState.test.mjs src/shared/ui/markdown/mediaEntry.test.mjs`；负向只运行其中原 context 检查，不改断言、runner 或超时。
三侧锁均由原包管理器生成，固定新增 Checkbox 1.3.11/fromMarkdown 2.0.3：根 pnpm10（22731）exit0、Native pnpm11（29612）exit0、Web npm（59611）exit0。根离线原报 `ERR_PNPM_NO_OFFLINE_META`，Web 离线原报 Checkbox `ENOTCACHED`；允许补元数据后才成功，不声称全程离线。Native 原 pnpm11 的 supply-chain policy 即使用 offline 仍对622锁项请求 registry，未禁用策略。Native 锁同时补当前共享 manifest 已有而旧锁漏掉的 focus-scope1.2.0 链；未改该版本。Web 随后离线安装缺 Checkbox tgz，复用私有 Native 已有同版本实际包，不重建镜像。
首个 Web tsc 命令误指不存在的 tsconfig.app.json，78020 实际 exit1/TS5058；纠正为项目现存 tsconfig.json 后12216实际检出共享词条/EmojiPicker导出及可空channelName问题，修复真实消费者后52929 Web生产类型exit0，48446 Native生产类型exit0。没有把配置错误当检查执行过。
后续合入独立 typing 接收批的冻结输入：65901因私有副本漏同步kinds.ts失败，正式源码已有20002/40008；同步后88376的Web阶段通过，shared错误入口未找到编译器，DOM未运行。14882最终Web生产类型再次通过，但shared根副本独立检查报缺lucide-react/motion/yaml等依赖及级联诊断862行、exit2，后接DOM未运行。两次私有根离线依赖恢复67796/25058均因Playwright1.63.0缓存tgz缺失exit1；不重建镜像、不修改版本、不把这次依赖失败记为shared通过。
复用Web真实安装的共享包原tsconfig，而非重装根依赖：`node node_modules/typescript/bin/tsc --noEmit -p node_modules/@client-kit/platform/tsconfig.json`。正式shared整个src对已安装副本`rsync -ani`无差异。82228实际检出VideoPlayer/mediaEntry/videoReviewTimecode的9处严格索引诊断；对split必有首项、原长度guard及固定regex capture补仅类型断言，不改变原运行时行为。最终96034全共享生产类型exit0，原输出`shared-types-installed-web-final.log`；未关闭noUncheckedIndexedAccess。最终76752同源Dart生成exit0，包含本批40词条（39新增和1既有UNKNOWN迁移）以及独立typing接收批4词条；该生成不冒充Mobile页面验收。
独立执行原Web入口 `node node_modules/vitest/vitest.mjs run src/features/chat/ui/MessageContent.test.tsx src/platform/ui/useChannelWindow.test.tsx --pool=threads --maxWorkers=1`：62827终态exit1，150.10s，两文件均报`Failed to start threads worker` / `Timeout waiting for worker to respond`，0项用例；原输出`web-dom-final.log`。不调整runner/超时或第三次盲重跑，不把SSR新增断言及typing DOM场景记为通过。
最后调用面复核实查Web `src/main.tsx` 使用React.StrictMode：视频宿主effect现每次setup明确恢复active，cleanup关闭，避免setup→cleanup→setup后误拒合法发送；原scope/root/available准入不变。同步后21640原Web `node node_modules/typescript/bin/tsc --noEmit` 最终exit0，日志`web-types-strict-mode-final.log`；正式与检查BffVideoReview字节SHA256同为`042ece771a4ce73bc98455f70e4718499015edfd5e9a58269ff117842fcbbc71`，没有新DOM运行通过证据。冻结清单为同证据目录`owned-paths.txt`的55源路径，其中package/i18n/Dart/ChannelPane同时含独立typing接收批的已声明hunk，提交须分别选择或明确合批。
本批尚无新版截图、发布或 Windows/Mobile 实机证据。原 typing 仍缺真实 Web WS 发布/ACK 接缝，由独立主线处理，未加空 props 或假 HTTP 发布；因此不能宣称全部原版细节 100% 恢复。历史全量 diff 分类仍是队列事实，不被本批替换成完成率。

## 2026-10-09 原消息引用完整呈现共享迁移：实现候选与验证边界

权威与来源：用户要求按固定官方全量 diff 补齐，关联 DD-39、SS-WEB-RELAY、DD-75；固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的 `desktop/src/shared/ui/markdown/MessageLinkPill.tsx::MessageLinkPillContents`、`BuzzLinkChip.tsx::BuzzLinkChip`、`useInlineTooltipPosition.ts::useInlineTooltipPosition` 及 `desktop/src/features/messages/lib/messageLinkMetadata.ts::summarizeMessageLinkContent` 直接迁入共享 `react/messages/message-link`，不是新设计的卡片。原默认分支的定宽频道标签、消息图标、悬浮正文/作者/相对时间、删除与不可用样式、键盘操作、右键打开/复制、删除后的线程/频道跳转均保留；sent-from-thread 继续消费上一批共享原分支。仅定位 hook 去掉来源注释后的 SHA-256 与官方同为 `92e71df6f609ccab5450b29ef51b640622edcfcf56ce14623b5ae91205c4bed9`，不以此单文件相等声明整体一致。

影响面：Native 原 MessageLinkPill、BuzzLinkChip、tooltip 定位和摘要解析改为共享消费者；Native 元数据只恢复官方原有 9/40002/45001/45003 四种消息，不替换原 Relay 查询。Web MessageContent 的原裸链接改为同一共享呈现，PlatformApp 经原搜索目录将原生 channelId 解析到真实 Workspace 或 ACTIVE、当前用户参与的 Conversation，再用原导航进入消息或线程。原先把原生 channelId 当 Workspace ID 的读法删除；没有新增账号、消息、频道、权限或正文权威。新增 16 条同源中文默认/英文消息引用词条；Mobile 不据共享词条投影宣称页面恢复。

权限与副作用：Web 主体只传递当前会话 scopeKey、已有目录和真实导航，元数据通过原 BFF 根线程查询及作者 profile 路由取得。根消息使用 parentEventId=messageId，回复使用明确 threadRootId；Forum 使用现有 ForumComment 读取链，不生成浏览器任意 Relay filter。每页核验实际事件形状及唯一 h，沿原编辑覆盖、明确删除事件处理；作者 profile 读取再次由 BFF 准入，失败不能携带旧正文继续报成功。只读客户端投影，不写 Core 正文；打开与复制原链接不是外部业务写入。

边界与六类错误：空页显示 unavailable，不猜 deleted；只有已验证的删除 tombstone 才使用原删除跳转。HTTP 400/403/404、绑定/身份/scope 拒绝、缺少合法回复根、无目录与歧义绑定均不形成可用预览；BffError 保留服务端既有 DENIED、PRECONDITION、CONFLICT、LIMIT、BLOCKED、UNKNOWN 分类，不从 HTTP 猜另一套错误类。取消或迟到回应不采纳。未知消息 kind 不渲染正文；非法或不前进的 cursor 拒绝；切会话的缓存键与 owner 隔离，query abort 后不展示旧结果。该链不产生写入终态，不把网络问题变为“消息已删除”或成功。原版无 threadRootId 的回复引用不能通过现有 BFF 根路由读到时显示不可用，未新增无授权 event lookup 绕行。

差异台账：上一批已提交 `e8e4eabd04bb2fad4c22457238722b568fdcc09f` 视频恢复只更新既有全量基表的 13 个受影响生产路径，增量文件为 `/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/current-main-diff.nNHzVS/dd399-to-e8e4-video-classification-changes.tsv`；原 `collaboration-dd399f93f584.classification.tsv` 历史基表保留，不重新计算全量统计或将未审条目改为通过。

本批证据目录 `/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/message-link-20261009.pe7wvI`，`owned-paths.txt` 列 22 个源码/词条投影路径；package.json 中独立 authors 导出属于主线，不在本批授权 hunk。使用原 `kailo-agent-receipt-xvkujx` SDK，1000:1000、4 CPU/8 GiB，镜像 `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`；没有新镜像或安装依赖。私有同步 76770 因 Data I/O 延迟后 exit0，正式 Web、Native 和实际安装共享 src 的 `rsync -ani` 均无差异。提前于同步完成启动的 19948 已终止自有 PID、exit143，无类型验收结论；随后 Web 类型句柄 96395 实际 exit2，原 `message-link-web-types-final.log` 有 4 处本批诊断：既有 pubkey 模块缺导出、目录两种目标 ID 推断成同时必填。已补实际消费者导出并按真实匹配结果生成可选目标，不修改合同或降低类型检查。

交叉复核发现 DM 深链实际不能打开：PlatformApp 漏 threadRootId，ChannelPane 排除了 conversation，ChannelThreadPane 只读写 Workspace。固定官方 `desktop/src/features/channels/ui/useChannelRouteTarget.ts::useChannelRouteTarget` 仅排除 forum，DM 根/回复同样打开原回复面板，因此本批按原完整行为连接既有 conversationMessages/publishConversationMessage、上传、媒体、作者、反应和编辑消费者，沿原当前参与者与 ACTIVE 状态准入，不以 Inbox 布局冒充原面板。旧 `!conversation` 的回复按钮/摘要/面板排除同步移除；不修改已提交视频模块，仅给既有 provider 投递同一 conversationId。撤权清除沿原查询与流边界，不把 URL 或搜索快照当正文授权。

语言切换补齐 Native 与 Web 消息摘要的 locale 缓存键，摘要请求捕获当前 locale，避免迟到中文空摘要污染英文切换。原 SDK 同源 Dart 生成句柄 74170 实际 exit0；`platform_text.dart` 新增 53 行，同一 16 词条，没有 Mobile 页面验收。最终输入同步 exit0，Web/Native/实际安装共享 src 再次 `rsync -ani` 无差异；最终 Web 类型句柄 37071 实际 exit0，日志 `message-link-dm-web-types.log` 空诊断；该输入同时含独立已提交 `8683884252ac98282163ff0d19b2095492fb99b6` Relay 作者解析链，不据此宣称该链 DOM 或三端验收。

原 Native 入口 `node --import ./test-loader.mjs --experimental-strip-types --test --test-concurrency=1 src/features/messages/lib/messageLinkMetadata.test.mjs src/features/messages/lib/messageLinkLabel.test.mjs src/features/messages/lib/messageLink.test.mjs src/shared/ui/markdown/useInlineTooltipPosition.test.mjs` 的 79023 实际 19/19、exit0，原 tooltip 使用真实 jsdom/Radix 定位检查；输出 `message-link-native-positive.log`。完整 owned diffcheck 57527 exit0。冻结源码补丁 22 路径 +1025/-636，SHA-256 `2ce50edfa6c6b4e1ebabb4fe1bc7e97fce89c29232178d98eab0ba4710115c31`，不是完成率；新增 5 条受影响原路径的候选分类存于上述台账目录 `dd399-to-message-link-candidate-classification-changes.tsv`，明确用 base commit 与候选 blob，不冒充已提交版本。

共享类型 52508 与私有 Native locale 生产反证 16587 在 23:28 UTC 均仅到容器内 `sh` 的 `Ds/flush_workqueue`，CPU 0 秒、Node 尚未启动；保留原句柄，不重复启动。随后 16587 实际终态 exit1，2 项中 1pass/1fail，原断言报 actual `No message text` / expected `无消息文本`，真实捕获生产摘要被固定为英文。反证仅修改私有实际安装共享包，不修改检查断言或正式源码；终态后已原字节还原，`cmp` 正式摘要文件 exit0。原 19 项还原检查 28317 实际 19pass/0fail、exit0，日志 `message-link-native-restored.log`，SHA-256 `7a4a3ddd9834ca6f7aef966da652ab61448db2a93b53c84eec203fd1d7a99e78`；负向日志 `message-link-locale-negative.log`，SHA-256 `9713279610a4eb84ae1dc69b652b86a578ccfed283086863c74bd786f302d1c0`。

最终共享类型 52508、Native 类型 52829 均实际 exit0，日志 `message-link-dm-shared-types.log`、`message-link-dm-native-types.log` 均为空诊断；与 Web 最终日志一样，SHA-256 均为 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。共享复用 Web 实际安装包原 tsconfig，Native 使用自身原 tsconfig，不重装依赖。原 Native 正向日志 `message-link-native-positive.log` SHA-256 `79453c468e11ef381dbfcedc2f21149d395c2d70e454072a989102d0076bc339`；较早 Web 96395 的真实失败日志 `message-link-web-types-final.log` SHA-256 `f5ba3bdcb8f5a727fa466f108ac5ed2e73015b541a0758f0c309520a76620b52`，保留失败而不覆盖。唯一 Web DOM 批次 61958 运行原 `node node_modules/vitest/vitest.mjs run src/features/chat/ui/MessageContent.test.tsx src/platform/ui/ChannelPane.test.tsx src/platform/ui/ChannelThreadPane.test.tsx src/platform/ui/useChannelWindow.test.tsx --pool=threads --maxWorkers=1` 后实际 exit1、241.21s，四文件均为 `Failed to start threads worker` / `Timeout waiting for worker to respond`；0 tests，transform/import/tests 均 0ms，不能记为业务用例通过或失败。日志 `message-link-dm-web-dom.log` SHA-256 `1acc649b1941b870e108a10e18a470a2db89ee1d4f268adbe7311c2ae95ee449`。不盲重跑或更改 runner/timeout。新版截图仍未取得；主线全量门禁独立运行，本批不重复全编译。没有新镜像、部署、Windows 安装包或 Mobile 实机验收。

## 2026-10-10 原频道深链与作者标题链接共享恢复：源码候选

本批权威为原版一致性要求、DD-39/75 与 SS-WEB-RELAY；固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的 `desktop/src/shared/ui/markdown/ChannelDeepLink.tsx::ChannelDeepLinkAnchor/MarkdownChannelReference/AuthoredDeepLinkAnchor` 完整 492 行原模块及 `desktop/src/features/messages/lib/remarkChannelDeepLinks.ts::remarkChannelDeepLinks`、`remarkMessageLinks.ts::remarkMessageLinks`、`desktop/src/shared/lib/remarkChannelLinks.ts::remarkChannelLinks` 和原前缀解析依赖直接共享迁移。不重写相似卡片，不删原菜单、悬浮元信息、键盘打开或作者自定义标题。

影响面已检索：Native 原 Markdown 的 nodeCache/组件表仍消费相同入口，入口现为薄包装；Web MessageContent、BffMessageLinkHost 连接已有 PlatformApp 目录与导航。原 Web 的 buzz://channel 经 defaultUrlTransform 被清空、裸消息/频道协议与 #频道缺原 remark 消费、自定义标题被统一替换成消息 Pill，现接原四类呈现。两端共享布局；仅宿主读取、导航、剪贴板及 13 个中英词条为授权差异。使用已有 SearchChannel 呈现类型和原 ChannelLink/MessageLink 解析器，无契约字段、数据库或持久状态变更，不造第二目录。

准入与副作用：Web 仅使用当前 tenant/principal/platformSessionId 的现有目录，将 native channelId 经已有唯一 Workspace 或当前参与者 ACTIVE Conversation 映射后交原 UI；不暴露任意 Relay 查询、不把 channelId 当 workspaceId。Native 保留原有受控 channelReference 读取；未知静态频道明确不可点击，不生成默认 openable 的假入口。当前 Web 非成员公开频道没有可用 Workspace 绑定时保持不可用，这一既有 BFF 边界明确不是“全功能等效”。未知名称仅显示原惰性标记，空目录、歧义绑定或换会话不沿用旧目标；只读导航后仍由目标页面实际 BFF 准入。目录错误沿既有 DENIED、PRECONDITION、CONFLICT、LIMIT、BLOCKED、UNKNOWN 六类处置，不把不可用当已删除或成功；本批不派发业务写入，也不新增需对账状态。

源码清单位于 `/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/channel-link-20261010.dxWKeP/owned-paths.txt`。事后检查已补至既有 MessageContent.test.tsx 与原 ChannelDeepLink.test.mjs，覆盖作者标题、裸协议、代码块、多词频道、键盘、歧义绑定、换会话以及中英文元信息；初次记录时只有正式差异检查 exit0，类型、这些交互用例和真实负向尚未执行，下面逐项保留后续实际结果与未验边界。

上一批提交 `7597036049cbb90529479c14ba853d51af39baa3` 的唯一 Web 镜像构建 44194 使用独立固定快照，本批不混入；尚无新部署、截图或安装包。本批及原消息引用 DOM 仍不具有新版截图验收，不能声明原版 100% 一致。

本批初轮串行 37224 实际 exit1：共享类型在原 `remarkMessageLinks.ts::isUnmatchedClosing` 的末字符索引报 TS2769，原四文件 Node 实际 77 项、72pass/5fail。三个元信息检查调用浏览器 locale API 却缺 window；另外两个原 SSR 仍断言英文，实际已按默认中文呈现。失败日志 `shared-types.log`、`native-positive.log` 保留。Web/Native 类型日志为空，但初轮只保存聚合退出码，不据此单独认定两侧通过。实现以原算法等价的 `charAt` 消除共享严格索引边界；检查复用真实 jsdom/setLocale，作者标题与音频原 SSR 同时执行 zh-CN/en 并保留两语精确断言，不删功能或放宽行为检查。元信息同样覆盖两语。

原 Biome 目录入口 83997 因多工程嵌套 root 配置实际 exit1；没有执行建议的配置迁移。使用同一既有工具和已有配置的单文件 stdin 格式入口 80905 实际 exit0，之后按自有清单同步 79510 exit0。原 Dart 13 词条生成 53754 exit0，只有 `platform_text.dart` 新增 47 行。冻结补丁共 21 路径 +1267/-885，`owned-source.patch` SHA-256 `78bf75a14730d6e3446abf04138cc801e6b6d58c7f9fa148ecab8f23bd7d8f30`，基准 `5e7985c24b4a26a6a54d6af2750780856c81ac36`，私有索引完整 diffcheck exit0；不含继承 custom-emoji、editAttachments、parseImeta 的 EOF 差异。必要共享类型、原 Node 与唯一 MessageContent DOM 串行 62766 已明确输出 `shared-types exit=0`；原 Node 只有 7 项解析器检查的中间输出，整批尚未终态，DOM 尚未启动，不记这些检查通过。Web/Native 单独终态、真实生产负向及还原也未取得，不记最终验收。

既有全量官方差异台账仅更新这次受影响的 6 个原路径，增量为 `current-main-diff.nNHzVS/dd399-to-channel-link-candidate-classification-changes.tsv`。`createRemarkPrefixPlugin.ts` 与 `remarkChannelLinks.ts` 的共享目标 blob 仍逐字等于固定官方；其余逐项标明原依赖导入迁移、严格索引访问以及授权宿主/治理/i18n 差异。候选记录明确携带上述 base commit 和当前 blob，不冒充已提交版本，不改动其他缺项分类，也不将共享迁移等同于功能或视觉验收。

独立固定 `7597036049cbb90529479c14ba853d51af39baa3` 的正式 Web 构建 44194 已实际 exit0，原 `tsc && vite build` 完成，保留 >500kB chunk 警告。原入口生成 artifact `sha256:c7992692a3bda71aa11acc4bf73b6c0507b1aa5613555a276fc85c2e9b912860`；Docker RepoDigest、registry manifest HEAD 200 与该摘要相符，断网只读 1CPU/128MiB 短容器读取真实 build-info exit0，buildId 为原固定输入的 `sha256:12508a2a9512cbbd40afde2ca3a179cd1e73842568e642da1c7e0867aea3d9b7`。产物来源只写回 `/volumes/data/kailo/tmp/web-main-7597036-20261009.nIt44u/apps/web-client/fork/upstream.yaml`，未修改正式指针或部署。目录下 `build-launch.log` SHA-256 `5b39e214669ae0da381439f627bd4a0f6bb4b3308d28851548444ba16f927303`，`build-web-client.0U58ZC.log` SHA-256 `65cf18f1c32d31d11cd3722b3f6d7a4eeee4fb30a09629a4d1e84bce64359731`。这个已构建版本不包含本频道批，不充当本批截图或完整生产验收。

上述 21 源路径与本节记录已作为源码检查点 `decdcefa45e925d0021974495277545c0fbec267` 提交并推送 main，不是验收完成或发布。原 62766 随后实际 exit1：共享类型 exit0；四文件 Node 79 项、78pass/1fail，英文音频 SSR 实际得到默认中文。`native-final-positive.log` SHA-256 `ef6bf498769cc10ec030b154cc4ca579f1289ad4fba786fc28c984343dccdcb6`。原 MessageContent DOM 实际 exit1、60.75s、0 tests，报 `Failed to start threads worker` / `Timeout waiting for worker to respond`，transform/setup/import/tests/environment 均 0ms；`web-dom.log` SHA-256 `7be50fc093373a78bde20189160f59b98e44cd70a3cf88aece8c55baadde821c`。这不是业务用例通过或断言失败，不盲重试、变更 runner/timeout 或用旧版页面截图补作通过。

后续实际定位：既有 `useDeviceLocale` 在 SSR 的 getServerSnapshot 固定返回中文默认值，音频本身正确消费 `useUiT`；原英文检查只改浏览器 locale，未提供真实 PlatformProvider locale。检查现接已有 Provider，不修改音频生产行为或两语精确断言。同时共享频道深链此前直接调用 `translateCurrent`，不会订阅 Provider 的语言变化；五处实际呈现消费者现接既有 `useUiT`，元信息 footer 接同一 translator，原 DOM、布局、目录准入与导航不变。作者标题的中英 SSR 特意使用与 Provider 相反的设备语言，Web 原交互用例补同一缓存正文的中英切换。该三路径 followup 为 +48/-18；未新增契约、状态、权限或翻译权威。原受限 SDK 的集中三侧类型及原 Node 批次 80239 已启动，记录时尚未终态；负向、还原、新版 DOM/截图与设备验收仍不记通过。

80239 第一项 Web 类型尚运行时，2026-10-10 01:10:51.676177668 UTC 将 Native `markdown.test.mjs` 的机械替换限制回上述两个 locale 用例，未改变其余图片/视频 SSR；当时 Node 阶段尚未启动，三侧生产输入均未改变，此后输入冻结。最终三路径补丁为 `followup-final-source.patch`，SHA-256 `03a0106bb3a9af3b5743a9577071ca994d48fc15b87cd4118768889fe09ab5dc`；正式/私有三文件逐字比较及 selected diffcheck 实际 exit0。较早 `followup-owned-source.patch` 不作为可提交候选。

80239 最终实际 exit0：Web `tsc --noEmit`、共享安装包原 `tsconfig.json` 的 `tsc --noEmit`、Native `tsc --noEmit` 各自明确 exit0；三份 `followup-*-types.log` 均为空诊断，SHA-256 均为 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。原四文件 Node 79pass/0fail/0skip，日志 `followup-native-positive.log` SHA-256 `f43b70bfa88d737f4822ea840931576bffe00afb0fdd215bab62856eb29b27ef`。四文件为 `src/shared/ui/markdown/ChannelDeepLink.test.mjs`、`src/features/messages/lib/channelLink.test.mjs`、`src/features/messages/lib/remarkChannelDeepLinks.test.mjs`、`src/shared/ui/markdown.test.mjs`，原命令使用 `node --import ./test-loader.mjs --experimental-strip-types --test --test-concurrency=1`；不重装工具链、不增加镜像或全量检查。

真实生产反证仅修改该 SDK 私有 Native 实际安装共享包：去除 `AuthoredDeepLinkAnchor` 的 `useUiT` 消费，原 markdown 检查 99719 实际 exit1、69项67pass/2fail，英文 Provider 得到中文 aria-label，中文 Provider 得到英文；`followup-locale-negative.log` SHA-256 `db4258c0d21e022cf56f77477d3997b796df7a6739eba91994d3750f50d26819`。原字节还原后再移除 `remarkChannelDeepLinks` 原句末标点剥离，原解析检查实际 exit1、2项1pass/1fail，明确捕获 URL 多出句号；`followup-parser-negative.log` SHA-256 `b82481ee50b68924f16562287dbcbf9ad0ad77ac03d8786e92cccfdbf10aed57`。两处均已原字节还原，逐一 `cmp` 正式源 exit0，未改断言或正式生产源。原四文件还原检查 9032 实际 exit0、79pass/0fail/0skip，`followup-native-restored.log` SHA-256 `69984d8297908062d7cc355ef2a564efa086aab9e035dee02760c625dc2ec5f6`。DOM worker 启动失败没有重试或改超时，新增 Provider 动态切换 DOM 用例、浏览器截图、Windows/Mobile 仍未验收；本批没有部署或安装包更新。

### 2026-10-10：恢复原版独立 diff 消息卡片、完整查看器与准入读取闭包

权威仍为固定 Buzz `779af8886caae1317b4de962082429867ab61503`。复核其 `desktop/src/features/messages/ui/{DiffMessage.tsx,DiffMessageExpanded.tsx,DiffViewer.tsx,DiffViewer.css}`、`desktop/src/features/messages/lib/parseDiff.ts::parseUnifiedDiff/getDiffTitleBadge`、`desktop/src/shared/lib/url.ts::isSafeUrl` 与 `desktop/src/shared/constants/kinds.ts` 后，完整迁移到 `client-kit/ts/platform/src/react/messages/diff/`。卡片 DOM、CSS、源仓库/commit 链接、描述与截断提示、按文件统计和标记、原始内容降级显示、统一/并排展开及关闭均沿原实现；CSS 和 URL helper 与固定官方 blob 逐字 cmp exit0。差异仅为实际共享依赖导入、已有中文默认/英文词条与严格索引访问。没有自行设计新卡片或差异解析器，沿官方原锁定 `react-diff-view@3.3.3`。

影响面为共享 `MessageRowSurface` 的真实 kind40008 分流、Web 与 Native 既有消息行消费者、Native `formatTimelineMessages::isTimelineContentEvent`、历史窗口/修复集合和 Web 打开线程动作。Native 原 `useSearchHighlightProps→MessageTimeline→TimelineMessageList→TimelineMessageRow→MessageRow` 的搜索词继续流向共享控件。Web 两个 Pane 没有搜索词上下文，`PlatformApp::openSearchChannel` 只有 eventId/threadRootId；本批不伪造搜索状态，Web 搜索定位后的 diff 词高亮仍缺。组件内带 query 的 DOM 检查不是这条 Web 全链证据。

Core 由主线独立改动 `core/crates/collab-bridge/src/bridge.rs` 与 `core/crates/platform-core/src/web_transport.rs`：`CHANNEL_TIMELINE_KINDS` 进入 stream.filter/channel_window_filter，`channel_message_event` 用于 thread root/author/read/reaction 引用，`thread_message_kinds` 在查询与回执中同集合；`mutation_target_matches` 仍等于原 WebMessageType，不放宽编辑删除目标。其正式检查结果由主线另行记录，本 UI 补丁不包含这两文件。没有 schema、迁移、新 API、新正文权威或持久状态；签名、唯一 h、scope、fresh admission、游标与未知 kind 拒绝沿既有通路。新 kind40008 发布/编辑/删除授权未接，`BUZZ_MEMBER_EVENT_KINDS` 未修改。

特别保留官方边界：40008 是独立可见 row，进入 CHANNEL_EVENT_KINDS/CHANNEL_TIMELINE_CONTENT_KINDS，不是 auxiliary edit，也不进入 CHANNEL_MESSAGE_EVENT_KINDS 或 CHANNEL_RECENCY_EVENT_KINDS。实现时曾依据当前耦合注释扩大两处触发集合，核对固定官方明确排除 diff 后已撤回自己这两处未提交改动；最终补丁只有可见/live/repair 读取集合，Native 频道活动集合原字节未变。既有 e2eBridge 含他人继承差异，仅其 `handleGetChannelReconnectRepair` 的40008单行适配入本批，未带入其余 +32/-1。

本批原件目录为 `/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/diff-message-20261010.Qi1FBk/`；`owned-paths.txt` 列23个自有完整路径，`owned-e2e.patch` 是额外一个窄 hunk，`owned-source.patch` 24 paths +1009/-14、SHA-256 `0e6d670f34d66398e9f3405e891b6a30cfd9c8102807edb5ffca99fbfdb6d6b0`，私有索引 selected diffcheck exit0。全量官方台账只更新这次6个原路径：`current-main-diff.nNHzVS/dd399-to-diff-message-candidate-classification-changes.tsv`，带 candidate base `2460adddce2518f56360ce019dff54ae5492918f` 与实际 blob。其他缺项不改分类，不把共享迁移当作全量功能/像素验收。

实际预检复用原 `kailo-agent-receipt-xvkujx` 4CPU/8GiB，原 SDK 仅 sleep，宿主 available 约27GiB；未创建镜像、builder、浏览器实例或 full。三侧锁由原 pnpm10.33.4、pnpm11.4.0、npm 生成并各自 exit0，版本和完整性与固定官方锁一致，没有手写锁。原首次根安装误指不同 store，报 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` exit1、未强制清空；按现有 .modules.yaml 的真实 store 重新调用后 exit0。缓存不完整，根实际 downloaded236、Native downloaded105，不宣称纯离线缓存复用；没有全库升级或新基础镜像。原 Dart 工具首次因 login PATH 未包含已安装 Dart 报 `Dart formatter unavailable`，随后使用镜像真实 `/usr/lib/dart/bin` 完成15词条同源投影 exit0，platform_text.dart +39，reason_text.dart 与正式原字节一致；这不等同于 Mobile 已交付 diff 查看器。

共享批次75219实际 exit0：生产 `tsc --noEmit`、`tsc --noEmit -p tsconfig.test.json` 与原 `vitest run test/message-row.test.tsx --maxWorkers=1 --reporter=verbose` 顺序完成，17pass/0fail，包含真实40008分流、展开/并排/统一/关闭、中英、原始内容/空态、安全URL及已有消息功能。日志 `shared-types-dom.log` SHA-256 `30765c2ec553abff17fe272e60f27793c8c76396cb621cb84c830b164bdf5be1`。真实生产反证仅删私有 MessageRowSurface 的40008正文分流，原同文件窄用例33874实际 exit1，但 fork worker 启动超时61.56s、0 tests；该失败不证明检查抓到了变异。`shared-row-negative.log` SHA-256 `be97d5a496481ab47cc609300a818f94b6502ace7ae63c6c1fc6c162ad10279d`。私有源已 apply_patch 还原并与正式 cmp exit0，未改断言或超时、未盲重试 DOM。

36518 最终实际 exit0：同一受限 SDK 原串行 Web `tsc --noEmit`、Native `tsc --noEmit` 各自明确 exit0，两份类型日志均为空诊断、SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。原 `formatTimelineMessages.test.mjs` 与 `relayReconnectReplay.test.mjs` 使用 `node --import ./test-loader.mjs --experimental-strip-types --test --test-concurrency=1`，42pass/0fail/0skip；`native-positive.log` SHA-256 `f0af15c7ce1b9c4490cf6813e81b72fc924ee90e4d4a270c59b5e819f03c147a`。

真实读取反证仅删除私有 `formatTimelineMessages::isTimelineContentEvent` 的40008分支，61678实际 exit1、42项40pass/2fail，分别捕获 `false !== true` 和独立消息数 `1 !== 2`；`native-negative.log` SHA-256 `c1110d1e06d85f0ff2c420dabe1322860be0ae4c8798ca3830860cd78cdf6809`。初次还原的两个 kind 分支顺序与正式不同，9322虽42/42通过，不作为原字节还原证据；校正顺序并 cmp 正式 exit0 后，40525最终实际 exit0、42pass/0fail/0skip，`native-restored-exact.log` SHA-256 `364cf349ee897ee83bd2fe14ff926d06bee1cfcf5facbac80b5fa61447cf5837`。没有修改断言、正式源或触发集合，没有再次编译/重试 DOM；初次无 sudo 的 Docker 调用报 socket permission denied、未启动检查，随后沿现有 sudo 入口执行。

原 `tools/check-docs.sh ../.design` 使用同一4CPU/8GiB SDK：第一次58889实际 exit1，日志 `check-docs.log` SHA-256 `a7cd4cda905be950fb782e57bda04c2a69dfaed65cf4c5a2b82621de61504c37`。原因是验证输入错误：旧副本缺 README 的7个已在候选 tree 内的链接目标，且误用外层历史 HEAD `50515dd6e3481bcb1732d1662efc88431c716a3d` 中的旧设计，漏掉当前权威已有的3个 Wren ID。`.design` 不是独立 Git 根；没有修改它或外层索引/历史。补齐实际候选目标并冻结当前 `.design/*.md` 21篇，逐文件 SHA-256、外层历史 blob 与工作树 blob 写入 `design-input.tsv`（16篇与该历史不同、5篇相同），SHA-256 `2d31764b0ac60aeed41312d301d73de83ef93ad652e8317865f42c1bba048e7f`，副本逐项哈希核对 exit0。实施文档和原脚本来自 apps main `2460adddce2518f56360ce019dff54ae5492918f` 加本批UI25路径候选 tree `67272212ad2482135d817292f433081fd8189b91`；未包含主线 Core2文件、未复制继承脏回执。修正输入后16121实际 exit0：链接、ID、87实体/115DD/29SS、87场景、两套markdownlint及21篇设计自检全部通过；`check-docs-corrected.log` SHA-256 `fd80c99ee061f794b23f66fb4d4335b6ebb23582d56ffff0d254697d44edf617`。两次均保留原检查规则，不删除/弱化断言；最终这段运行记录在检查后追加，未宣称外层设计差异已提交。

17项 DOM 正向及读取负向不是浏览器截图，也不替代未启动成功的 DOM 反证。该40008正文分流的 DOM 变异验收仍未闭合；本批无新部署、Windows包或 Mobile 设备验收，旧4c099部署与759产物均不含本批，不能用于宣称原版100%或生产就绪。
