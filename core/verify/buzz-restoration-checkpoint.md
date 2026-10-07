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
