# Kailo 工程根目录

`apps` 是 Kailo 一期实现工程的根目录，包含实施合同、Core、Worker、按功能命名的二开项目（协作底座与 Desktop/Mobile 客户端、Web 客户端、模型网关、Agent 运行时与计量服务，ADR-16）、客户端共用代码（`client-kit/`）、契约、部署配置与验证工具。当前交付状态以本仓库的代码、追溯记录和门禁结果为准，不以本 README 代替验收证据。

产品语义与可行性结论由相邻的 [`.design`](../.design/README.md) 唯一定义；本目录只回答如何把已经冻结的设计安全地变成可运行系统。实施文档不得重定义 Tenant、Workspace、Resource、Action、Workflow、权限、状态或能力结论。

## 当前使用与恢复范围（2026-10-06）

- 2026-10-07 集中源码批：恢复工作流操作菜单与运行步骤轨迹、原版 Agent 管理
  弹窗和成员操作；邀请／成员读取失权不会清掉结果不明的写入。WeKnora 原生
  read/export 和条件删除接缝已实现，排队接收不算删除完成。共享前端集中实跑
  38 文件、538 项通过，文档检查退出 0；这不是全部页面、双端设备或发布验收。
  设计已纠正“单动作就是完整工作流”的范围错误：原版多步骤及七类动作都在
  恢复范围，执行仍归 Temporal。该源码批未部署，当前在线版本及旧 Windows
  包不变，三组件完整绑定和多人多 Agent 稳定协作仍未完成。

- 23:42 UTC：Projects、成员资料列表、Agent 安装升级及动态列表首入修复已形成
  同一源码批，Web/Desktop 共用实现。集中全量检查的四语言静态检查、测试、
  契约同步/兼容、迁移、Workflow replay 与安全静态检查通过，但总退出码为 1：
  追溯产物记录不一致，以及 Codex/Desktop/WeKnora/Web 的源码与既有产物不同。
  不能称全量通过或已部署。当前在线版本仍是下述 23:08 批，Projects 不在该
  发布范围；旧 Windows 包不能代表本批源码。Workflows 菜单/真实任务轨迹和
  WeKnora read/export 已有独立实现验证，未混称完整工作流或三组件完成。
  本次又实际截图查看频道与四项个人设置，尚未完成所有页面/弹窗及双端等效验收。

- 23:08 UTC：固定 `10c839d34186d4b1e72a44f83c82d7c420949e7e` 的 Core/Worker/Web
  已集中构建、推送、部署。浏览器实测又抓到 Pulse 发送的旧数据库 kind 约束遗漏，
  已补前向兼容迁移并实际投递，数据库现为 96 条成功；原页面发布、点赞、回复、
  取消赞均 200。真实截图见[恢复检查记录](core/verify/buzz-restoration-checkpoint.md)
  最新小节。入口仍为 `http://192.168.0.193:58090/app/`。
  成员/Agent/工作流仍有原版体验差距，动态虚拟列表首入空白仍须定位；三服务完整
  平台绑定、三人双 Agent 稳定协作、全量检查通过和 Windows/Mobile 新包均未交付。
  知识库合同种子已源码推送，不在本批运行镜像内。

- 22:38 UTC：50 文件实现批已提交并推送 `10c839d34186d4b1e72a44f83c82d7c420949e7e`，
  包含作者删除、消息顺序、组件 peer 凭据接线及任务/审计中英文；正在原受限
  builder 集中构建，尚未部署。完整检查本次退出 1，具体失败及后续窄验见
  [恢复检查记录](core/verify/buzz-restoration-checkpoint.md)最新小节，不称全量通过。
  Native 持久化修复另已源码提交，尚未编译投递；Projects、Agent 升级及知识库
  接入继续并行开发。下述 21:58 部署仍是在线版本，安装包与视觉验收没有随
  源码提交自动更新。

- 21:58 UTC 本批已实际投递：Core/Worker 源码固定 `433ec461456f9def7da892b270cdceb9def77fca`，
  Web 固定 `cc71bf7b10388e450a550bcf01a562b3c7527865`，数据库 94 条迁移成功。
  入口仍为 `http://192.168.0.193:58090/app/`。实际打开新版截图确认侧栏/Inbox
  读取错误消失，Pulse、Agent 卡片、作者资料及中英外观可见；成员与 Agent
  部分管理区仍非原版等效，Projects 未恢复，不能称全功能交付。
  WeKnora 新后端已部署并完成一次普通用户原生 SSO；三服务平台绑定仍未完成。
  新频道双 Agent 实测中，一份 invocation 在计量 Kafka 恢复后自动完成并可见回复，
  另一份仍被旧原生线程不存在卡住，不能称双 Agent 或三人协作稳定。
  最新截图、真实失败及恢复边界见[恢复检查记录](core/verify/buzz-restoration-checkpoint.md)
  末节。Windows/Mobile 没有本批新包或设备验收；完整检查尚无新的通过结果。

- 21:17 UTC 实际复核：源码分支与远端均为
  `0238a858f87a32b1d90eaafb5a27691321d4b5c4`，包含消息作者资料与 Agent 派发
  原子性修复，尚未部署。线上 Core/Worker/Web 仍是 19:13 批；本轮正常 OIDC
  重新登录后，Playwright 实看频道、收件箱、成员、Agent、工作流、任务、审批、
  审计、设备。收件箱和侧栏仍报“未能载入，结果不明”，成员/Agent 仍为简化
  管理表单；Pulse、Projects 和三组件入口没有上线，不称原版等效。
  上轮完整检查已退出 137，含 TypeScript 与发布追溯失败，不能继续记为执行中
  或通过；局部主题检查已修复并正反验证，不替代全量结果。完整记录见
  [恢复检查记录](core/verify/buzz-restoration-checkpoint.md)。Windows 仍为旧包。

- 20:09 UTC：原版 Pulse 与 Agent 卡片共源恢复已提交并推送为
  `fb38358d1801d48e4a7d24caf8340d4f640cab6a`，但尚未构建部署；该提交不能
  当作在线版本。现有 Web 仍运行下述 `4f5b2403`，Windows 仍是旧包。
  后续实际截图 76–86 已打开复核：中文／英文外观切换、已有私聊历史、
  新私聊成员选择和公开频道创建均有对应证据。新建公开频道任务真实完成后，
  重新载入可看到中文频道名称；这不证明三人双 Agent 稳定协作或原版全功能。
  当时集中完整检查仍在执行，现已按上方记录结束；新 Pulse、资料与提及交互须在实际
  发布后再逐页验收。细节及版本边界见[恢复检查记录](core/verify/buzz-restoration-checkpoint.md)。

- 19:13 UTC 新 Core、Worker、Web 已实际部署，源码固定为
  `4f5b2403fb71f6a50648768e5ae2c4b62cf25e0c`；Core 迁移 93 条成功，health 200。
  入口仍为 `http://192.168.0.193:58090/app/`。新 Web 已包含共享富文本消息、
  回复／编辑／媒体呈现、公开频道读取及 Workflows 名称／运行详情增量。
  实际截图 66–75 已逐张打开：频道可同步，但收件箱和侧栏读取仍报错；
  Agent／成员页仍有简化布局，Pulse、Projects、三组件入口仍缺，不能称原版等效。
  Windows 仍是旧包，Mobile 没有本批设备验收；多步骤工作流和三人双 Agent
  稳定协作尚未验收。下文较早时点只作历史，最新失败及投递顺序纠正在
  [恢复检查记录](core/verify/buzz-restoration-checkpoint.md)末节。

- 15:55 UTC 最新实际结果：Metering 与 Relay 修复镜像已限定部署；两个独立用户
  经正常 OIDC 完成双向私聊，刷新后重新进入仍读到历史，截图 59–64 已打开复核。
  旧会话 HTTP 431、默认验收频道 503 和 Agent 最终回复仍未全部修复上线。
  Web 仍为 a59，Windows 未更新；Thread、公开频道及审计中英增量已提交未部署。
  下列旧时点的“私聊断连／计量未部署”保留作历史，不代表这一具体私聊路径现状。
  完整结果与边界见[恢复检查记录](core/verify/buzz-restoration-checkpoint.md)末节。

- 后续实际逐页截图 `43`–`58` 已全部打开复核：频道、收件箱、成员、Agent、
  工作流、任务、审批、审计、设备、四类设置、私聊、新私聊和创建频道弹窗。
  当前 Web 仍为下面的 a59 版本，私聊实际断连，创建表单没有公开／私有和 TTL，
  Agent／工作流管理页仍有简化布局，Pulse、Projects 和三组件入口没有恢复。
  中文默认及英文切换已实测，但审计状态等文案覆盖不全。不能称 Web/Desktop
  全功能等效；Windows 包没有更新，Mobile 也没有本批设备验收。
  共享回复／TTL 批 `66f2a415bbf39d0d8093d9907ffa9525a20d3e95`、计量投递修复批
  `a422b1b2e2d6b30f1f4f38831a612752ed453634` 已提交推送，尚未部署验收。
  固定树 `9d1e38eeff1e83d96321b014a63a16eb82ccfe20` 的集中完整检查退出 1，
  失败和跳过项见[恢复检查记录](core/verify/buzz-restoration-checkpoint.md)。

- 14:07 UTC，Web 源码 `a59e2f50ae1c4f73a363816a1cece646b7116f83` 已通过原
  `tools/build-upstream.sh web-client` 构建并单服务部署，均退出 0；镜像为
  `4580ec22a409abcb31e3c3e4fdfbe40ab64c1ebde54fdcb2961a5409954303a6`，
  registry 摘要读回一致、容器 healthy。实际 Playwright 复验确认频道草稿切页及
  刷新仍保留，通知页中英切换生效，声音开关刷新后保存，验证后恢复中文与原开关。
  入口仍为 `http://192.168.0.193:58090/app/`。旧频道 UUID 标题、私聊未闭合、
  原版部分菜单和页面缺口仍存在，不宣称完整原版体验；本批未更新 Windows 包。
  新回复和临时频道源码不在此镜像内。截图及实际失败边界见
  [恢复检查记录](core/verify/buzz-restoration-checkpoint.md)。

- 13:42 UTC，修复版 `f5f786cadcf0ad88d5fd13c2e964c92ebf0b328a` 的 Core/Worker
  已沿原发布和启动入口投递，构建、push、部署均退出 0，registry 摘要独立读回一致。
  Core 为 `08c62ac1e4bdc857f3599b9ba40406a8d913ff530d69fed22df9c59b4a8c4802`，
  Worker 为 `6e0ed202debb887725a7ef890f22b5f889cde88aa98e7a2cf442acae01d6b1d7`；
  health 200、原 Worker 队列启动、90 条迁移均成功，其余 26 个同项目容器不变。
  原私聊 Activity 已实际执行，不再报未注册；绑定自动进入 RECONCILING，仍返回
  UNKNOWN_EXTERNAL_RESULT，不能称私聊已可用。没有重发旧任务、修改权限或额度。
  原回执见 Data 的 `buzz-dm-worker-release-20261006.85FUKC/deployment-receipt.md`。
  Web、Relay 和 Windows 包不随本次两服务投递升级。

- 共享草稿、通知、Agent 授权摘要及频道命名修正批 `344a4b6352180527052a659070b9dce2452d3da6`
  已提交并推送，Core/Worker 与 Web 草稿、通知已随后续修复批分别投递。
  固定树集中 `tools/check.sh --full` 已结束，退出 1：
  TypeScript 检查及产物追溯／来源核对未通过；Rust、Go、Dart、静态检查和文档
  检查通过。具体失败、跳过及本批后续窄验边界见
  [恢复检查记录](core/verify/buzz-restoration-checkpoint.md)。不以源码提交或局部
  通过宣称完整 Buzz、私聊、三服务或多人多 Agent 已可交付。

- 12:40 UTC，后续共享界面批 `c674f5782ed918c63e691d94f60df7f3c37bb5ba` 已构建并
  单独投递 Web，实际镜像为
  `587815d0cf1a4964c1342f99b24e289fc402e0e9be22a4fc9fcf9dc2a3e28389`，
  registry 摘要核对一致，容器 healthy。包含 Relay 频道标题读取、原版设置布局和链接
  预览文本卡片、只读私聊状态按钮；Core/Worker/Relay 未随此次 Web 投递改变。
  原 build 与 compose 均退出 0，原件在 Data 的
  `buzz-web-preview-release-20261006.NgyUR0/`。本版仍非完整 Buzz 恢复，
  未升级旧 Windows 包，也未解除私聊后端或新 Agent 权限准入阻断。
  后续 7 张实际截图确认设置左侧导航、预览模式切换和刷新保存可用，但新建频道
  标题仍显示 UUID：后端读取创建参数的层级错误，实际把 slug 写成 Relay 名称。
  现有私聊 stream 也返回 403。两项均属未完成的功能，不能以容器健康或页面渲染
  宣称已恢复；详情见同一截图目录的 `C674-RESULTS.md`。
- 11:58 UTC，本批 Core／Worker 已实际投递，原发布与部署命令均退出 0。
  Core 为 `e0a5e8103c86bdf60250ca6e7928257e194d72f70773e64ed7e7a3636116465f`，
  Worker 为 `146c1dec681ff0f2dc1469f86cc4b2a0bf7f59d6875501c7a9ed831dac2c41f3`；
  Core health 200、Worker 原队列启动、90 条迁移成功，其余 21 个容器未改变。
  随后 Web `54928e5a5a16053ae750479c1a8a0ef6ff39d33323d24cff807aec4c8e7e3df2`
  已投递，包含共享侧栏、富编辑器、Inbox 与中文默认增量。实际浏览器已完成
  当前可达页面走查、创建频道、发送并读回消息；私聊仍待对账，不记为送达。
  原 Relay 仍未升级；旧 Agent 在途任务仍有中断请求及用量关联告警，不能据此
  宣称完整私聊、论坛、稳定多人多 Agent、全部设置或原版体验已经验收。
  Windows 包仍为下述旧包。原件见 Data 的
  `buzz-core-registry-release-20261006.aq2uA1/deployment-receipt.md` 与 `web-deploy.log`。
- 本批源码的界面语言默认中文，保留完整英文词条。语言入口位于“设置 → 外观 →
  语言”，选择“简体中文”或“English”后保存在当前设备，并即时更新界面；不会清空
  正在编辑的消息草稿，不修改账号、组织或权限。新设备或清除本地偏好后仍默认中文，
  浏览器/系统语言不会覆盖已选语言。保存失败显示错误并保留原语言；本轮实际
  Web 已验证中文默认、英文切换及刷新保持。旧 Windows 包不据此获得验收，
  原版全部页面的文案恢复仍未完成。
- Web 入口：`http://192.168.0.193:58090/app/`。本轮已正常 OIDC 登录并实际
  操作上述业务页面，不再仅以匿名入口 302 为依据。登录使用已开通组织
  成员资格的本人账号；看到“不是任何组织的成员”时应核对邀请／成员开通，不
  绕过权限或换成共享身份。
- 旧 Web 登录过期后出现 431 的原因已定位为消息流重连累积临时 OIDC Cookie，
  不是账户被删除。断流检查会话、单次恢复登录与网关 SSE 拒绝重定向的修复已写入，
  Web 窄验 10/10、Gateway OIDC 18/18 通过，尚未部署。旧受影响页停止自动
  请求后，临时事务按原五分钟 TTL 自然过期即可再次打开正常登录页，不需清全站
  Cookie 或重置密码。细节见 [旧会话 431 证据](web-client/fork/verify/web-surface.md)。
- 现有 Windows 测试包：`dist/desktop-client/Kailo_0.5.23_x64-setup.exe`，
  本次实读 SHA256 为 `eddf9d1f7ebb144f9535f979dc1bc82ba66e0d13f090352c2183c64564c6a0c0`。
  它仍是上一批未签名包，不包含下述新恢复源码，不能把重新下载当作已升级。
- 原版全部页面、布局、菜单、设置和交互仍是交付范围。Web/Desktop 共用从 Buzz
  提取的实现；认证、权限、额度、计费、审计、Temporal、Codex、AgentGateway
  接入保留。恢复中不以精简页面替代，不回到未经治理的原版执行链。
- 本轮侧栏、资料／头像、创建频道、私聊接线和共享富编辑器已进入源码验证；
  频道元数据通过真实 Relay 回读，私聊偏好后端通过窄验。附件编辑与私聊菜单的
  实际客户端消费继续恢复。当前在线版本没有这些新功能的完整验收。
  使用步骤和截图必须随实际部署再更新，不将尚不可用的按钮写成可操作步骤。
- 当前 Web 可从侧栏频道分组的创建入口提交名称和描述，在任务页查到完成后，
  刷新频道列表进入新频道并发送消息；本轮已按此路径实际完成。原公开／私有、
  TTL 和模板选项尚未恢复，不能将当前创建表单称为完整原版。
  私聊已能选择真实成员，但本次 `conversation.open` 仍待对账，“查看状态”
  按钮错误禁用的源码已随 12:40 Web 投递，但私聊后端仍未查证完成；不要将草稿
  或等待状态视为消息已送达。
  逐页截图和原始回执在 Data 的
  `kailo-visual-release-20261006.vlPvnU/RESULTS.md`，原版次 31 组编号截图，
  本次后续 7 张为 `32`–`38`，各自关联实际版本，不合称全页面等效通过。
- 第二批固定源码树的完整检查已结束，退出 1；本批局部检查通过不替代完整验收。已过与未过项见
  [本批源码及验证边界](core/verify/buzz-restoration-checkpoint.md)。Cells、WeKnora、
  Wren 保持独立服务和原生管理界面；本轮不宣称三服务完整接入已经完成。

## 历史复核与投递事实（2026-10-05）

### Workflows 复制保存与停用已实际闭合

当前在线 Web 经正常 OIDC 登录，从原工作流复制配置，完成 YAML/表单
往返后实际提交 `automation.create`。BFF 回读证实只新增一个 DRAFT，
owner 为当前 HUMAN，配置与源版本一致，没有复制固定版本、启用状态或
Delegation。随后通过同一页面停用新草稿，独立回读为 DISABLED；源定义
逐字段不变，没有发送频道消息或调用模型。原浏览器操作退出 0。

这补齐的是此前只有预览证据的“复制后保存”，不是删除、手动触发、多步骤
执行或完整 Workflows 交付。新草稿保留正常审计并已停用，未直接删除数据。
原件为 Data 的 `codex-component-runtime-integration-20261005.lciVUS/workflow-copy-save.log`，
SHA256 `45c3e3e7fbb6777a4e5af824d36aa20aa17712208b3a9e7b1724bd108b2bdd60`。

### 21:48 UTC：运行时回执修复已推送，稳定协作与组件交付尚未闭合

独立运行时修复提交 `20dbd472b8baa8ff775322c3c72e59f0c1f7933a` 已普通
push，远端 main 独立读回一致；相对父提交为 6 文件 +1236/-54。
修复保留原进程所属 `thread/start`、`turn/start` 的迟到回执，持久化原生引用后
才确认消费，不重新派发结果不明的请求。原完整检查退出 0，另在 82 迁移隔离库
实际运行 7 项回归并通过；部署配置预检仍明确跳过，不能替代线上验收。
具体输入、日志摘要、失败及未覆盖范围见
[Agent 回执验证](core/verify/agent-definition.md)。

原正式 Core/Worker 发布进程仍在运行，Core 已进入 release 构建；此时尚未
导出或部署新 Core 镜像。19:55 的三 HUMAN、两 Agent 复验在等待回复 240 秒后
失败，不能沿用下方 16:58 的成功记录宣称当前稳定可用。随后只读核对的两个旧
异常任务占满 2/2 执行槽；新回执修复不补造旧进程已丢失的回执，重启也不是
原生执行已终结的证据。未盲目重发旧消息、直接修改业务状态或强制释放容量。

组件模型调用、HUMAN 动作与协议会话仍属于后续独立交付批。WeKnora 已有原生
登录和部分读取的实际证据，其新二开产物仍在导出；Cells、Wren 尚无完整部署
及业务验收。三服务保留各自原生 UI、数据库与独立生命周期，不是 Core 的启动
依赖；适配源码、局部检查和原生页面登录均不等于平台工具、模型或资源链已完成。

### 原功能批 Core/Worker 已投递（19:23 UTC）

干净 `306aa41bdfbee661572262aba6aba68cf095ef39` 的原正式发布命令退出 0；
Core/Worker 镜像已上传，registry 独立读回的 digest 与产物一致。
沿原 `start-core.sh --no-build` 重新投递一次性凭据，再启动原 Worker；
实际运行 Core 为 `sha256:9c52cc8586736b3c47d0e75b9ebbb93e09951419d9c2d5ef43b1148b15d7f453`，
Worker 为 `sha256:63c6ff561dc1a67dc26a9007201063b89fd842b61582c0fb119a09bae1fb1c6d`。
19:28 UTC Core health HTTP 200，Worker 日志确认原 Temporal 队列启动；
部署前后只有 Core/Worker 容器改变，其余 21 个项目容器 ID 不变。
本批没有新增数据库迁移，没有重建 Web、Windows、Relay 或调用模型。

Compose 的两处 pin 同步到上述实际产物，仅供复用原功能批；不表示这些镜像
含本次候选的 ProtocolSession、HUMAN 组件动作或独立组件模型接线。
新后端的业务回归与三个组件真实业务、三端设备/签名验收仍分别未完成。
原件位于 Data 的 `codex-release-306aa41-20261005.RPxWPS/`，
`core-worker-deploy.log` SHA256 为
`f685fcc38d0680733400ccfc3bec9d0171a8877d89403f1f5e91834c0765d801`。
部署命令外层 tee 不传递左侧退出码，因此以上成功依据是原 release 的实际终态、
registry 摘要、两容器镜像/启动事实与各自健康或队列回读，不以 tee 的退出码代替。

### 新共享 Web 已投递，真实运行历史读回通过（18:54–18:56 UTC）

原容器执行异常恢复后，旧 Web 在没有重启的情况下先恢复 healthy。随后仅以
干净 `306aa41` 的 Compose、唯一原 `.env` 和 `--no-deps --no-build --pull never`
投递已经构建的 Web 镜像，没有重新编译或修改业务配置。实际运行镜像为
`sha256:1f7c2596ab2c1ebe67a562f63101b00d01fd578d1a2eef534294cd0738699c18`，
新容器 healthy；前后快照中其余 22 个项目容器 ID 与镜像均未变化。
Core/Worker 仍为原已部署版本，不能把 Web 投递称为整批后端升级。

正常 OIDC 登录后的原浏览器操作退出 0：Workflows 读回原已完成运行，
页面显示 Completed、用量引用及步骤审批列；打开原任务详情仍显示 Completed。
本次不发送消息、不调用模型、不创建自动化，未伪造新运行或步骤审批对象。
新增 `stepApprovalTask` 是可选字段，旧 Core 未返回时只显示缺省占位，不推测
“无需审批”。表单/YAML、复制与外观的新增页面走查单列，不借历史读取证明全功能。

Data 原件位于 `codex-release-306aa41-20261005.RPxWPS/`：
`web-deploy.log` SHA256 为
`0c9d447b0a60555ee0161b71a691ca73630ea7623b4456e6a69a3a751e0d2331`；
`web-workflow-history.log` SHA256 为
`137552c7551ba55def1386e4678d517d3e818960f3920270f9ebd9043b840eb2`。
Windows 包已按下节投递，三组件与三端生产验收仍未完成。

随后原浏览器 surface 操作退出 0：正常登录后读取已有定义，复制到本地草稿，
切换 YAML 并确认原 CHANNEL_MESSAGE / POST_MESSAGE 配置，再切回表单读回
非空模板；未提交新草稿、发送消息或调用模型。设置页实际展开、收起原版主题
样式控件，未持久修改偏好。这只证明复制预览、编辑器切换与控件操作，不证明
复制后的保存、全部 Workflows 或全部设置功能。

两次先前操作退出 1 的原件保留：精确标签匹配包含 textarea 正文的 wrapping
label 失败；实际 DOM 已在表单、模板存在、alert 为空。按观察到的唯一 textbox
修正操作程序后通过，没有修改产品源码或重建产物。最终原件为同目录
`web-workflow-settings-surface-final.log`，SHA256
`aee553a054244e07c46c427ea42de393a515264ad45757350e0a0ffe1afb1e3d`。

### 共享 Workflows／外观 Windows 包已投递，Web 更新尚未执行（18:48 UTC）

已将 `306aa41bdfbee661572262aba6aba68cf095ef39` 登记的既有 Windows 产物
投递到 `dist/desktop-client/Kailo_0.5.23_x64-setup.exe`，没有重新编译。
文件为 15,147,110 字节，实际 SHA256 与提交内来源记录一致：
`eddf9d1f7ebb144f9535f979dc1bc82ba66e0d13f090352c2183c64564c6a0c0`。
其 source digest 为 `6f7c2b5b684020e3846c52512697f08fa4d1e48a65e53ed1034e19c16e14ca36`；
原包 `620e6d3b…` 已保留在 Data 原件目录
`codex-release-306aa41-20261005.RPxWPS/windows-delivery.BAY5bN/`，可恢复。
包仍未签名、未在 Win11 实机安装验收，不将文件投递称为三端交付完成。

18:43–18:47 UTC 只读核对发现旧 Web 容器 health 为 unhealthy，连续记录
`timed out starting health check`；Web 与 Relay 的独立空操作均在 8 秒观察上限
退出 124，Docker daemon 同时报告多个容器启动 exec 的 DeadlineExceeded。
公开 Web 入口仍返回登录跳转 302；这些证据定位到容器执行层异常，尚不足以
确定底层原因，也不能用入口可访问消除 health 异常。未重启 Docker、Core、
Relay 或其他业务，未调整健康检查超时，未执行 Web 镜像替换。

原 Core/Worker release 句柄仍在运行，不因观察超时重启；该次运行尚无成功
发布回执。新 Web 已有构建产物，投递和登录业务验收仍分别缺失。
后续组件源码独立推进，不将上述运行异常或本次包投递作为组件验收结果。

### 共享 Workflows、原版外观与组件适配批已提交（18:25 UTC）

源码 `306aa41bdfbee661572262aba6aba68cf095ef39` 已普通 push，远端 main
独立读回一致；相对 `4496c98f7981394b187ea91849e57acdac7df7ad` 为
117 文件 +10218/-2430。包含 Web/Desktop 共用表单与 YAML、工作流复制及
步骤审批导航、原 Buzz 外观控件复用、binding/generation 独立凭据、Cells
原生版本查询及 Wren 原生登录/CSRF/查询历史接线。原有未选 66 文件
+6107/-422 保留在工作区，不混入该提交。

固定树 `58299f2bfc08e1951a5652cd187bd03194a99a04` 的原
`./tools/check.sh --full` 实际退出 0；四侧生成与验证、218 个 schema、
Workflow replay、21 条追溯、供应链及当前源码产物核对通过。实际数据库演练
与部署配置预检明确 SKIP，未安装 gitleaks；Git alternates 路径警告保留，
没有将其隐藏或将独立组件、设备签名缺口改为通过。
原件为 Data 的 `codex-workflows-peer-integration-20261005.HB7iuF/full-integration-final.log`，
SHA256 `f49d8bee45b3b7efd3d202f039b452ba9c32e5aef75faafe1109290c8176bd8b`。

该提交尚未部署，下面 16:54 Core 和 14:03 Worker/Web 仍是实际运行版本。
Core/Worker 原正式发布已从干净提交启动；现有 Web/Windows/Relay 产物复用，
不重复构建。这不代表三个独立服务业务、完整 Workflows、原版全部设置或
三端生产验收完成，新的 ProtocolSession 与 HUMAN 组件动作仍在独立后续批。

### Workflows 频道消息触发与模板回复已实际完成（17:42–17:46 UTC）

当前已部署的 57ad Core 与原 Worker/Web 上，已有自动化经正常页面发布新版本、
按目录返回的确切 scope 授权并启用。随后发送一条无 Agent 提及的普通频道消息，
真实模板回复出现；唯一 Invocation 和 Task 均 COMPLETED，automation.run
计量 1 已 COMMITTED，Codex turn、模型 trace 和 CapacityLease 均为 0。
Workflows 的“我的运行历史”和原任务详情均实际显示该次 Completed。
没有重新构建或部署，没有直接写入业务库或 SpiceDB，授权期限沿已有开发配置。
实际命令、原件摘要及操作程序失败见 [Agent 验证](core/verify/agent-definition.md)
末节。这只覆盖 CHANNEL_MESSAGE → POST_MESSAGE，不等于完整 Workflows、
三组件或三端生产交付完成。

### Agent 回归已修复并恢复三人、两 Agent 协作（16:58 UTC）

源码 `57adcd1612bfd421c8b93d843deae7c4b66604bb` 已提交并 push；相对
`6112fdb6dfbdee9897a34e374988e6d79f37406c` 为 13 文件 +852/-10，选定源码的
原 `tools/check.sh --full` 退出 0。修复组件工具空集合的 SQL 列归属错误、
未派发任务的原 Capacity holder 恢复及 Schedule 管理派发状态，不跳过治理链。

16:54 UTC 仅 Core 替换为
`sha256:ff7c389aa1ac48bebb94434b095ae267e4cd71e69daa163b71b6412401098fe2`；
原 19000 迁移执行后线上 82 条、失败 0，Core 直接 health 为 200。
Worker、Web 和其余项目容器未变。原 14:48 卡住的两任务自动恢复 COMPLETED，
两条回复存在，用量 8921/9032 tokens 均 COMMITTED、两槽 RELEASED；没有重发
旧消息或直接修改业务状态。整批 release 的 Worker 步骤因上游镜像下载失败退出 1，
没有把该失败改记为整批发布成功；只部署已独立构建并核对来源的 Core。

16:56–16:58 三名独立 HUMAN 正常登录当前 Web，各发送一条同时提及两个 Agent
的新消息。每条的两条真实回复均在三人的独立页面读回；六 Invocation/Task 全部
COMPLETED、六槽 RELEASED、六条用量共 54142 tokens 全部 COMMITTED，浏览器
操作退出 0。三轮从发布到三方读回分别为 48.154、44.499、29.592 秒。
本次证明当前部署版本的三人、两 Agent 频道基本协作，不替代长期稳定性、完整
Workflows、三端设备/签名或 Cells/WeKnora/Wren 接入验收。三组件仍未交付可用。
实际命令、失败、原件摘要与边界见 [Agent 验证](core/verify/agent-definition.md)
末节；下方历史记录只保留各自时点事实。

### 14:03 UTC：6112 已部署，后续功能仍独立开发

源码 `6112fdb6dfbdee9897a34e374988e6d79f37406c` 已提交、push 并投递。
该提交的原完整检查最终退出 0，Core/Worker 原正式构建、SBOM/provenance、
三镜像 push 与 registry digest 独立读回均通过；Web 复用既有本批产物，没有重编译。
两条原迁移向前执行成功，线上从 79 增至 81 条，失败 0。仅替换 Core、Worker、
Web，其余 21 个运行中项目容器 ID 不变；Core health 200、Web healthy，
公共页面仍要求登录，Worker 开始原队列轮询。没有新增模型调用、权限或额度写入。
同批 Windows 未签名测试包已投递到原 `dist/desktop-client/Kailo_0.5.23_x64-setup.exe`，
SHA256 `620e6d3b6b976ca70022de22b9d5e93eacb1edd91f24f743665bda1a474c784a`；
旧包另存于上述发布原件目录，未重复编译，未声称 Win11 实机验收。

该次 Core 为 `sha256:c9673fc00a86eb6517c8528c0dde4302cfd5590b731581e9e80f40cfc2d46007`，
Worker 为 `sha256:36ce8000303eef14fd4ca8a53b25febea79c6ec83c7f01d0d050cff8bb8601de`，
Web 为 `sha256:3336de5375dccfbcb72865e4ad44bf1e2799136779cf00830c8b64861fd4d173`。
Data 原件为 `codex-application-core-worker-release-20261005.2Co1Ge/deployment-6112-receipt.md`。
本次未重新做登录业务验收；三组件真实服务、完整 Workflows/原版设置与三端设备
验收仍未完成。后续联合候选不在本次部署范围。下方“未部署”仅保留其记录时事实。

### 当前源码收口：原生服务完整源码与资源引用（未部署）

本次私有联合候选在已部署 `d343a33ed491f12f60efbddfd973a1053461c8ef` 上补入
PROTOCOL_PEER 真实协议消费、`resource.create / RESOURCE_PROVISION` 外部引用
生产路径、共享 NativePage 承载纠正，以及完整 WeKnora/Wren 原生源码。
HUMAN BFF 可沿原治理动作登记受控投递面已核验的原生引用，再形成原 Resource
授权根供现有 Agent Tool 消费；未增加 Agent 代发创建入口，不在 Core 新建原生对象。
WeKnora 固定 `2be7bd40631dda1dd485306038f07a62e9ee287e`，Wren 原完整 GenBI
固定 `c5f02a0391c87420dba78632dcd86073710deb72`，共 5824 个源文件入选，
不含安装依赖或运行凭据。两服务仍独立管理；源码导入不是镜像、部署或接入验收。

联合定向验证已通过：Core 189 项、单独真实 Resource 数据库目标、81 条隔离迁移、
四侧往返、Clippy 及生产反例恢复。原完整检查实际抓到结果暴露枚举漂移、追溯归属
和私有验证输入缺失，已按原权威纠正，失败原件保留；客户端源码与旧产物不符须由
真实 Web/Windows 构建补齐，尚未取得本批最终 full 退出 0。当前线上仍是下节的
09:07 投递：79 条迁移及该批 Core/Worker/Web，不能把本次 81 条隔离迁移写成线上。
真实组件发行、接入与原生页面业务验收仍未完成，Cells/WeKnora/Wren 不记为可用。
本批命令和明确跳过项见 [组件验证记录](core/verify/application-binding.md)。

### 独立组件接入基础已投递，参考服务未验收（09:07 UTC）

设计版本 `8d0c75ec177d7c7dd1a9183fe571f8c6cb6fa158` 明确独立服务边界：
Cells、WeKnora、Wren 自持管理后台、数据库与生命周期；Kailo 管理的是接入、
公共服务授权和投影，不接管其内部业务。工具仍通过 AgentGateway 注册、发现和调用。
Web/Desktop 共用接入管理页及原生页面引用，Mobile 不承载组件页面。

本批已写入 ApplicationBinding 创建/停用、原 ComponentTask 对账、Gateway 工具
投影、原 ActionToken/审批/EE/用量消费与原生页面承载。派发前计量读取失败整体
回滚，结果不明保留原 EE；未查证 ContentReference 不披露。新路由和管理动作
进入原能力目录，未另设绕过目录的路径。独立服务的业务账号和会话仍由服务管理，
页面嵌入本身不授予业务权限。

集中 Core 检查 178 通过、10 忽略，契约 10 通过，真实隔离数据库的前置失败
回滚及同请求重新准备 1 通过；这些不等于完整工具派发或组件业务验收。
四侧生成同步、历史契约兼容和 21 条追溯检查已通过。共享 Web 与未签名 Windows
包已构建；整批原完整检查及追加隔离数据库目标最终均退出 0，首次失败原件保留。
源码 `d343a33ed491f12f60efbddfd973a1053461c8ef` 的 Core、Worker、Web 已于
09:07 UTC 投递；六条原迁移实际执行成功，迁移数由 73 增至 79。Core health
为 200、Web healthy，Worker 已轮询原组件任务队列；其余 25 个容器不变。
这次没有新模型调用、权限或额度写入；不覆盖正式树其他未提交改动。
真实原生页面与三个参考服务业务尚未验收，不能以基础部署替代组件接入。
因此不能将本批页面与适配代码记为 Cells、WeKnora、Wren 已集成可用。
实际命令、失败保留与证据边界见
[接入记录](core/verify/application-binding.md)及
[共享客户端记录](core/verify/application-binding-client.md)。

本次实际镜像：Core `sha256:77a9d175a9d78b52856d18416f5e7a23fe54c5c9a1298cfb7d5ce2d9b25478dc`；
Worker `sha256:f6ba77ea30ea7fa2beafd4669bf380122cb78bc478936ef1f35a74b0ebb3cd04`；
Web `sha256:d60e187b0429a7879600ab36c09d2b83de2290169d54b0e3d8bf81f659ce1668`。
Data 原件 `codex-application-core-worker-release-20261005.2Co1Ge/deployment-receipt.md`，
SHA256 `4ad4f4e2601575808e987bdaf36e6b1dd6f37096506dcd39bdd2aef3f75e042f`。

### 三人、两 Agent 同频道真实回复已验收（05:01 UTC）

三个独立 HUMAN 正常登录 Web 后各发送一条同时提及两个 Agent 的消息，六个
Invocation/Task 与原 Temporal Workflow 全部 COMPLETED；每条消息的两条 Agent
回复均在三人的独立页面读回，七个实际模型请求的 62896 tokens 全部 COMMITTED，
六个 Capacity 全部 RELEASED。使用的安装为 `2989b1ec-f3fa-468d-89c5-4a8be226c97c`
和 `f66a3b3e-589e-4c27-965c-8d2b4cebb995`；旧无有效回复安装已正常撤 execute。
这次已证明 Web 多人、多 Agent 协作，不能再按下面历史记录称它尚未跑通。

开发租户的原生 OpenMeter entitlement 已改为 soft limit，继续真实计量；三人均
已有该组织/工作区业务 admin 和各自 exact-installation 委托；共享执行池为两槽。
未关闭身份、scope、fresh authorization、审批、用量关联和终态证据检查。

本节 05:01 的三轮回复各约 164–166 秒，其中每轮均有两段 60 秒等待；这是当时
的实测。随后 06:05 在 `640bd4` 历史构建上已完成修复后真实验收：一人发送新消息
提及两 Agent，三人独立 DOM 在 47.100–47.140 秒读回两回复；两 Invocation 均
COMPLETED，9025 和 8939 tokens 均 COMMITTED，两项 Capacity 均 RELEASED。
原件为 Data 目录 `codex-three-human-two-agent-20261005.poEa9c/` 下的
`postdeploy-latency.log`（退出 0）与 `postdeploy-observe-final.log`。这不是 09:07
`d343` 或当前联合候选的新验收，不据旧构建证据推算新版本延迟。真实命令、失败保留、终态及耗时见
[Agent 验证](core/verify/agent-definition.md)末两节。
Cells、WeKnora、Wren 仍未形成可用接入；Workflows 全功能、原 Buzz 完整设置、
Desktop/Mobile 设备、签名及长期稳定性仍不据本次六调用宣称验收或生产就绪。

### 共享设置与频道已读修复已投递（03:23 UTC）

源码 `7de631d841d72b5ac32c6f1093a278b5f8b8326a` 已提交并 push，
相对 `a714684260d261ce520f6f3a625a197c83b07e9c` 为 45 文件 +805/-111。
原完整检查和文档检查均退出 0；只替换 Web，healthy，其余 27 个项目容器与
sole `.env` 不变。Windows 测试包已更新，旧包保留，仍未签名或设备验收。
三人真实浏览器均读回原消息；各自稳定挂载 10 秒的失败窗口仅一次已读请求，
同 version 重查没有自动重发。共享高对比设置切换、刷新读回、恢复均通过。
未发新消息或调用模型；双 Agent、组件接入和一期生产就绪仍未验收。
命令、首次来源检查失败、最终通过及投递原件见
[发布记录](core/verify/release-artifacts.md)末节。

### 三人频道互通（02:08 UTC）

2026-10-05 的独立现场验收已确认同一频道三名 HUMAN 的 Tenant/Workspace
成员关系均 ACTIVE，分别经正常 OIDC 页面各发送一条普通消息，并在三方 DOM
准确读回全部三条；Invocation 数量保持 3→3。原件为 Data 目录
`codex-three-humans-20261005.wYPEYv/handoff.md` 与 `plain-channel.log`，
受控凭据不入库。原 Agent Delegation 已过期、当前原生额度为 0；本记录不代表
双 Agent 模型调用或回复验收，以下旧成员数量保留其当时事实。

### 多 Agent 选择与会话派发保护已投递（19:46 UTC）

源码 `a0defa2eb067362fb37e3e224a48b3c6b674bc4f` 已提交并 push，包含共享
多 Agent 选择、同 Session 并发派发保护、原 Buzz 字号／密度设置复用和撤权断连处理。
产物登记与来源检查修正已 push 为 `32eb863d846efde47fd1e1dc045b6f51c4704257`；
两提交相对 `9273f48cb042ad866d2c173e77b8d11b80423e6d` 共 65 文件 +2671/-530。
原完整检查和最终文档检查均退出 0，反例与跳过范围见
[发布记录](core/verify/release-artifacts.md)。

Web 已投递且真实页面可同时选择两个 Agent；Core、Worker 已按已验镜像限定替换，
Core health HTTP 200、Worker 已开始原队列轮询。配置与 73 条迁移未变，没有重放
历史任务或调用模型。Win11 原测试包已放入现有交付目录，仍未签名、未设备验收。

多人、多 Agent 真实协作仍未验收：当前频道只有一个 ACTIVE HUMAN；第二测试身份
OIDC 成功，但业务读取返回 `TENANT_MEMBERSHIP_NOT_ACTIVE`。加入普通测试成员、
本次模型测试额度及有效委托／审批仍需合法流程，不能由 ACTIVE Installation 推断。
Cells、WeKnora、Wren 未接入可用，组件与原生工具授权门禁、三端设备验收仍未关闭。

### 核心业务现场核对（17:49–17:56 UTC）

最新已提交并 push 的源码为 `9273f48cb042ad866d2c173e77b8d11b80423e6d`，
相对 `d247288b40ca443c653fee8d928f1adb0da010d5` 为 49 文件 +1509/-153；
下节的 Web/Gateway 开发预览已经部署，但多人、多 Agent 的频道协作尚未联合验收。
不能以两个 ACTIVE Installation、页面读取成功或完整检查通过代替有效回复、
权限与会话隔离、审批和用量终态的业务证据。

正常 OIDC/BFF 的当前身份、Workspace、Installation、Automation 等八项 GET
均返回 200；当前 Automation 为零。只读实查确认：运行配置
`AUTOMATION_RUN_METERS_JSON` 为空、目录未登记 `automation.run`，OpenMeter
没有该 COUNT meter、feature 或当前租户 entitlement。既有配置投递链完整，
不是环境变量丢失；该前提未投递之前不创建测试 Automation、不发消息，也不借用
模型 SUM meter。步骤审批、模板消息代码已部署仍不等于它们可以实际执行。

历史两次调用的容量均已释放；其中一条 8872 tokens 已结算但没有回复，另一条
仍因原始用量归因缺失停留在 `BILLING_UNAVAILABLE`，未重放或伪造终态。
Cells、WeKnora、Wren 仍未实际接入可用；组件 binding 合同冲突、原生工具授权、
修复后的真实模型回合及设备/签名门禁仍未关闭。现场命令、失败与范围见
[Agent 记录](core/verify/agent-definition.md)末节“自动化与历史调用现场核对”。

### Web 设置与组件目录开发预览（16:54 UTC）

共享设置批以 `d247288b40ca443c653fee8d928f1adb0da010d5` 为基准，Web/Desktop
共用外观、通知与快捷键呈现；Web 通知只使用现有 Workspace mute 状态，快捷键
只展示实际支持的 Enter，不生成浏览器系统通知、密钥或 Mobile 配对能力。
Web Members 现挂载与 Desktop 相同的管理面板，保留 Web 原 Workspace 选择，
Catalog 平台管理员可见组件登记目录。这不是 Cells、WeKnora、Wren 已接入可用。

共享客户端定向验证 220 项通过，实际破坏生产逻辑后检查失败、还原后再次通过。
原 Web 构建入口退出 0，镜像 `7cadbf96ea96fe1abfb9b3218e6b3c7cc5802839488dde5d15e90a0102eac6d9`
已限定替换 Web，healthy；其余容器、权限、数据库和 sole `.env` 未变。
本次开发预览独立于联合批完整检查、Git 提交以及 Windows 设备验收，不能据此
宣称原 Buzz 全部设置恢复或平台生产就绪。来源和原件见
[发布记录](core/verify/release-artifacts.md) 与 [Web 核验](web-client/fork/verify/web-surface.md)。

同批已定位真实模型回复缺失的协议原因：Gateway 原生转换产生的终态用量包含
`cache_write_tokens: null`，Codex 的整数解析拒绝该终态并自动重试。修复复用
Gateway 已有非流式响应的序列化规则，省略不存在的可选值，不改模型总用量或
放宽 Codex 校验。17 项原检查及真实发布版 Codex 的本地协议验证、破坏还原通过；
这些证据不是远端模型重新验收，也不修改历史失败回合。详细边界见
[模型协议核验](model-gateway/fork/verify/llm-instruction-role.md)。

17:10 UTC，该 Gateway 原构建退出 0，镜像 `b7e3d559…` 已独立核对并限定替换
Gateway，匿名公共入口继续返回登录重定向；其余容器及配置未变。没有因此重放
历史任务或追加付费模型调用，联合检查与真实回合验收仍分别记录。

随后同源 Win11 x64 测试包已由原入口生成（`aeb33abd…`，未签名、未设备验收）。
联合批固定树 `585a9afe384c1a2a7455b64204afa6472ac5e148` 的原完整检查退出 0，
首次隔离验证环境与发布登记失败原件保留；恢复只补只读证据挂载及实际摘要，
没有重建三个产品产物。73 条隔离迁移往返、SQLx、193 个 schema 兼容和上游
接缝检查均通过；十项显式演练 ignored，实际部署配置预检在 SDK 内 SKIP。
这是选定批次验收，原有 67 个脏文件不在该结论内；真实 Agent 回合、组件接入、
原 Buzz 完整功能以及三端签名／设备验收仍不宣称完成。原始命令、失败和摘要
统一见上方发布记录。

### 当前部署：模板消息、步骤审批与组件登记／批准（15:58 UTC）

已验收源码 `9fa402fbe529f3bf4ba9e77f9825413c574411e0` 已经切到本地运行环境。
原 Core/Worker 发布入口最终退出 0，两个镜像 push 与 registry 独立读回通过；
Web 复用本批已核验产物，未重复构建。原迁移入口完成四条向前迁移，实际库现有
73 条成功迁移、失败 0。37 个既有容器全部保留，仅 Core、Worker、Web 三项替换；
Core 的 BFF 健康检查 HTTP 200、Worker 开始轮询原任务队列、Web healthy。
sole `.env` 仅补发模板已有的两项构建信息观察配置，Runtime profiles 未改变。
相对上一在线源码 `acbab8036911922c0dad4b4d28c7bb8e13c03afc`，本次部署累计
140 文件 +15902/-816；这是已检查批次集中交付，不是新增一套业务实现。

这证明新版本已部署，不代表真实 Agent 回复、审批执行或外部组件已经验收。
Cells、WeKnora、Wren 仍缺实际 release/binding 接入，不能记为可用；ApplicationBinding
合同冲突、工具 consume 授权、历史缺 trace 用量、三端设备与签名门禁仍未关闭。
Workflows 全功能和原 Buzz 全部用户设置也没有补齐。真实模型与页面验证分别进行，
不以健康检查或表单出现代替业务成功。镜像、命令、失败及原件见
[发布记录](core/verify/release-artifacts.md)。以下小节保留各批发生时的状态，
其中“未部署”不覆盖本节已经确认的 15:58 UTC 部署事实。

### 历史投递尝试：基础镜像访问失败（15:14 UTC）

组件批准批已提交并 push：`9fa402fbe529f3bf4ba9e77f9825413c574411e0`，相对
`dd57f8bbf85fdf0b7b91e6e6aea445a909c0b046` 为 64 文件 +2004/-68；原完整检查
退出 0。此次用该干净提交集中发布累计源码，原 `tools/release.sh` 退出 1：
Docker Hub 的固定 Rust 基础镜像元数据请求解析到不可达 IPv6，尚未进入编译。
未改镜像来源或全局 DNS，没有重编译 Web/Win、迁移数据库、改配置或替换容器。
因此在线版本仍是下方 12:15 UTC 的版本，新源码不能记为已部署。
完整失败原件、固定输入及恢复边界见 [发布记录](core/verify/release-artifacts.md)。

### 上一部署：Inbox 与独立 Workflows 页面（12:15 UTC）

源码 `acbab8036911922c0dad4b4d28c7bb8e13c03afc` 已提交并 push；相对
`a535179baea0fc92f8515d32102288262e4161a6` 为 72 文件 +4457/-596。
该源码批已在原完整检查通过后集中发布：Core、Worker 原发布命令退出 0，
两镜像 registry 独立读回通过；Web 复用已核验产物，没有再次构建客户端。
现有数据库从 61 条向前迁移至 69 条，失败 0；仅 Core、Worker、Web 三个容器
替换，其余容器、Relay 局域网入口、原 `.env` 与 Runtime profiles 保持不变。

真实浏览器在 `http://192.168.0.193:58090/app/` 完成业务账号登录并打开 Inbox、
Workflows、Agents：相关读取接口均 HTTP 200，页面异常与 alert 均为 0。
Workflows 独立呈现 Automation 创建区，Agents 不再重复展示；没有在本次检查
发送消息、创建 Automation、修改权限或调用模型。此证据不是工作流执行终态、
真实 Agent 回复或 Win11/Mobile 设备验收。原生工具 consume 授权、模型回复、
历史缺 trace 用量、组件 release/binding 和设备验收仍未关闭；Cells、WeKnora、
Wren 不能记为已集成可用。完整产物、迁移与浏览器原件见
[发布记录](core/verify/release-artifacts.md)。

### 已提交源码：Automation 模板消息（未部署）

DD-107 的 `POST_MESSAGE` 已接入原 `automation.run` 与 AgentTaskWorkflow，
以执行 Installation 的既有 Buzz 身份发布模板，不启动 Codex、不伪造模型用量，
也不占用模型 Capacity。发布前持久化事件意图并 fresh 校验；结果不明只查证，
不重发。只有 Relay 精确事件回读与原 OpenMeter COUNT 落存都确认后才完成。
Web/Desktop 仍消费同一 Workflows 表单与四侧生成契约；Mobile 没有新增写入口。
该实现候选相对 `acbab8036911922c0dad4b4d28c7bb8e13c03afc` 为 26 文件
+1739/-65，已并入当前工作树；定向检查、四侧往返、隔离迁移和变异还原通过。
随后补齐 Relay 触发、版本回读与 Mobile 两种动作消费；共享 Web 产物已沿原入口
构建并独立核对 registry 摘要，Win11 同批原打包已退出 0，输入和锁文件未变。
安装包仍未签名、未设备验收。整批固定树 `d3d8722f54bfac38115d77df007a4b281dc5efd2`
的原 `./tools/check.sh --full` 已退出 0；数据库演练与部署配置预检仍明确跳过，
七项显式演练 ignored，不把构建和检查通过记为真实消息发送或部署完成。原件见
[Agent 记录](core/verify/agent-definition.md)。

交叉复核已补齐 COUNT 的冻结 Automation 分组字段，缺失或错属均被数据库拒绝；
Mobile 原只读详情也已接入两种动作的同源文案，仍无编辑或执行入口。

WEBHOOK 仍不生成入口：设计 `06` §9 要求异步使用请求正文，但 `04` 的存储权威
和 `05` §7 禁止把正文放入 Core、审计或 Temporal history，当前没有已定的
webhook 正文持久来源与恢复接缝。不能借 OpenBao、影子 Relay 或可选业务组件
代存；此缺口只阻断该触发，不阻断消息、定时和模板消息实现。步骤审批的源码与
隔离验证见下节；上述源码不得记作 Workflows 全范围完成。

### 同批源码：Automation 步骤审批（未部署）

AutomationVersion 可冻结同 Tenant 的既有审批策略 ID/version；原 AgentTask 在首次
外部副作用前启动原 ApprovalWorkflow 子流程，并观察其原 consume 结果。等待期间
不申请模型容量、不读取执行记忆、不派发 Codex 或模板消息；取消只有在事务确认
尚无执行事实后才同时关闭子动作。Web/Desktop 共用策略选择表单，Mobile 只读展示。
没有创建默认策略、第二套审批引擎或新的 Workflow kind；目录没有合法已投递策略
时保持为空，不借用其他动作策略。Core、Worker、共享前端、Mobile 与隔离数据库
定向验证及实际破坏还原已完成；组件登记与该批契约合并后四侧生成、同步检查通过。
完整批次检查、提交、部署和真实审批链仍须独立收口，不据此声称可以正式使用。
原始失败、验证命令和边界见 [Agent 记录](core/verify/agent-definition.md)。

### 并行源码批：可插拔组件登记（未部署）

ComponentRelease 登记已接入原 Catalog、Governed Action 与 ComponentTaskWorkflow，
通过隔离 Adapter Protocol 实际调用和原生观察生成报告，不接受用户自报通过。
Web/Desktop 共用登记面板；COMMIT 回执丢失和取消后的续跑保留原证据，不重复执行。
合并模板消息后四侧已重新生成，引用、UNKNOWN 和省略字段的往返与破坏还原已核验。
当前只覆盖无前端、无模型调用的 EXTERNAL/APPLICATION/REMOTE_ADAPTER 登记子集；
REGISTERED 不是 APPROVED 或 binding 可用；后续批准源码见下节，步骤审批见上节。
Cells、WeKnora、Wren 尚不能据此记为已集成。完整边界、失败与原件见
[组件登记记录](core/verify/component-release-registration.md)。

本批组件登记、步骤审批及撤权纠正的固定树
`9e41d5c4fc6e9b074c84a3c9eef6184660b3d1ec` 已通过原 `./tools/check.sh --full`。
相对 `75eac99e74670ecde7de38879c451fe5b2c59449`，检查时为 114 文件 +11794/-752；
实际隔离数据库迁移、SQLx、44 个枚举约束、四侧与 Workflow replay 通过。
首轮依赖准备退出 2、首次完整检查追溯登记退出 1 均保留原件，不改记通过。
Web 与 Win11 各运行一次原构建；Win11 仍未签名或设备验收。没有部署本批服务，
当前可访问版本仍是上方 12:15 UTC 的部署；完整门禁不等于业务或生产验收。

### 后续源码批：组件发行批准（未部署）

组件批准已移植到 `dd57f8bbf85fdf0b7b91e6e6aea445a909c0b046` 后的独立候选，
源码增量为 41 文件 +1324/-31（生成与本段回执之前）。共享组件目录可发起批准，
仍走原 Action Admission、ApprovalWorkflow 和 COMPONENT_RELEASE 任务；实际审批人
不得是登记人或申请人。Core 读取自身、Worker 与当前 Web 的构建事实，复核原登记
套件和当前能力契约后，同事务保存兼容观察、APPROVED 状态及审计；丢失提交回执
按同一执行读回，不重复批准。无前端、无模型的 Remote Adapter 子集边界不变。
组合树 `0980546205fc1bfa8264e0aca9a0848025933cbd` 的原完整检查已退出 0；
四侧生成/兼容、73 条隔离迁移往返、SQLx 与 Workflow replay 通过。Web 一次构建
成功；Win11 一次编译及导出成功，交付目录权限失败后仅恢复原尾步骤，没有重编译。
初次 full 退出 1 和原 Win11 helper 退出 1 均保留原件。安装包仍未签名、未设备验收；
本批未部署，不能据此把当前在线版本、binding 或参考组件记为可用。
详见 [组件批准记录](core/verify/component-release-approval.md)。

ApplicationBinding
生产签发存在冻结合同冲突：设计 `05` §2.8 的管理动作 ResultExposure=NONE，
而 `03` 的 ActionToken 强制引用仅含 CONSUME_ONLY/READ/EXPORT 的结果策略。
该冲突已提出裁决，未擅自更改设计、借用策略或开放 binding；参考组件没有绕行入口。

### 当前源码批：原生工具治理与可插拔能力契约

本批基于 `56ee0bbcfc5a8bcb0cd1b1e4e2c9dc985e39b6a3` 集中实现；现已随上述批次部署。
Core 复用 AgentGateway 原生 ExtMcp 双阶段检查、rmcp Streamable HTTP 与 Codex
原生 MCP 配置，将原 Session 身份、ToolBinding、逐次权限和 Memory 读取关联到
既有 ActionExecution/Operation、审计与用量，不建立第二套 Memory 或工具执行权威。
Web/Desktop 仍共用同一 TypeScript 管理主体；Mobile 补齐已有 Schedule 的只读呈现。
能力契约登记、审批和弃用已接入原治理路径，登记人与审批人分离；这仅是可插拔
能力的契约部分，不等于 Cells、WeKnora、Wren 已集成，也不等于 release/binding 可用。

本批撤回登记动作前，组合 Core 定向检查 21 项、Clippy、共享前端 258 项已通过。三处生产保护逻辑
的合并破坏检查实际失败并逐字恢复；数据库独立演练、前端破坏检查及原始失败
分别保留于 [Agent 记录](core/verify/agent-definition.md)和
[能力契约记录](core/verify/capability-contracts.md)。这些不是本批完整检查、
运行部署或真实 Agent 回复验收。固定树 `bc33b124ef78d85ebea6ed1f2eb11214350e4fb8`
首轮原 `check.sh --full` 退出 1：Go 审批消费者尚引用生成前的枚举符号、
新增追溯产物名与能力注册表未同步、Web/Win11 产物来源落后于本批源码。
Rust、TS、Dart、四侧契约与原安全检查通过；数据库与实际部署配置检查跳过。
Go 消费点已修正为生成的 `ApprovalDecisionAPPROVE`，不改审批值或 Workflow 历史；
对应纠正与最终回执见下文，不将首轮失败改记通过。
复核发现本批 `tool.definition.create` 的完整动作策略没有 `.design` 冻结依据，
先前实施裁决不能替代设计权威；该创建入口与专属策略已从源码撤回，不作为已交付能力。
撤回后原共享前端检查为 254 项通过；重新插入登记表单时原断言实际失败，
逐字恢复后目录目标 11 项通过。四语言契约和同源 i18n 已重新生成；新隔离空库
67 条前进、最后六条回退再前进退出 0。生成和迁移证据不替代最终整批检查。
Codex 固定版本对已加载 thread 的 resume 会忽略新配置，本批已修正为仅在
确定未派发的新轮、确认原生 thread 已卸载后更新配置；不重启 Installation，
不重放不明 turn，也不把 unsubscribe 回执当成卸载完成。
冷恢复定向 9 项及原隔离 PG/stdio 1 项通过、Clippy 0，两处生产变异实际失败后
逐字还原；这不代替新合并候选的完整检查或真实模型业务验收。
Tool consume 的显式授权缺口、真实回复缺失及三端设备/签名边界仍未关闭。
下述已部署版本和既有真实回合结论不因本批源码变化而改变。

### Desktop Relay 连通与开发组织改址（2026-10-04 09:44 UTC）

用户设备报告无法连接 Relay。实查原容器仅发布宿主回环端口，服务器经局域网
IP 访问也返回 curl 7/HTTP 000；这与 DD-75/78 的原生端直连要求冲突。
现已将 Compose 的 Relay 发布地址改为既有 `PUBLIC_BIND_ADDR`，不改原生 URL
模板、Community Host、身份或持久数据。Web 仍经 BFF，Desktop/Mobile 仍本机持钥。
影响仅为 Relay 宿主监听，没有契约、状态机、迁移或工作流变化；operator 签名目标
仍是原配置，未知 Host 不回退租户，匿名请求不因局域网可达而获得权限。

使用原部署快照仅应用这一端口改动，以 `up -d --no-deps --no-build --pull never
buzz-relay` 重建单个容器，复用 `sha256:d42f83fa0dadcd78c4ad721047433a9a7c8e522767edd96cb326d641c5dd0056`，
没有编译、拉取镜像或清理 orphan。重建期间首次探测仍为 curl 7/HTTP 000；随后
容器 healthy、局域网 IP 的 health HTTP 200。显式 DNS 覆写探针以原 Community
Host 取得 NIP-11，`auth_required=true` 且广告 NIP-43；匿名 query HTTP 401，
直接 IP Host 的 query HTTP 404。该覆写仅用于定位，不是客户端 DNS 已可用的证据。
134 个已有容器的 ID、镜像与启动时间前后比较，仅 Relay 改变；原始快照与本次
部署 Compose 位于 `/volumes/data/kailo/tmp/codex-relay-native-publish-20261004.RgOLgJ/`。

随后按用户要求，把当前业务组织的同一 Community 从旧测试域名迁至现有公开
IP authority `192.168.0.193:8090`；原生端重新读取连接事实后使用
`ws://192.168.0.193:8090`，不再依赖该组织的 `.local` DNS。
迁移先追加意图审计，再分别条件更新 Relay host 与 Core binding；Community ID、
设备/服务密钥、成员与消息未重建。Core binding 从版本 2 经 RECONCILING 版本 3，
由原 NIP-11 对账器查证为 ACTIVE 版本 4，09:43:29 UTC 保存新观察。
同一运维 operation `1be55225-2174-48f9-940f-636f53b7e0b0` 留下意图、改址及查证回执。
新 IP NIP-11 的 Relay self 未变，匿名 query 401；旧 Host query 404；IP WebSocket
握手 101（探针收到 79 字节后到达主动设定的 2 秒观察期限，curl 28，不计认证通过）。
原组织 33 条事件保持，未找到旧域名引用。其他组织未迁移，也没有默认租户回退。
这只是当前开发组织的已授权维护，不是公开 Host 修改动作；不重跑旧 Tenant 创建流程。
Windows 须退出后重新登录以刷新地址；本机旧地址草稿桶未自动迁移，签名历史不改写。
Windows 实际认证与消息接收仍须设备复验，不将服务端连通当作桌面完整验收。

同批 Win11 原构建现已退出 0：源摘要 `573744325964317ffb594da24a2b0c354dc67f583d49626e4111d9e9c8db95d4`，
EXE `206c62bfb829ca5a02874a88b14fe40f8c9c7aa85c4f3ddd23ed57386944e790`，15,115,577 字节。
本次改址本身不要求更新安装包；该包包含之前冻结的工具治理 UI 批次，未签名、未设备验收。
本批固定树 `148a4b49bf8a0308167ed1799367145253a0f0c6` 的原
`./tools/check.sh --full` 已实际退出 0：151 个 schema、四侧验证、Workflow
重放、19 条追溯和六个当前源码产物通过。此前 `55661145…` 的 full 退出 1，
唯一失败为运维文档多一个空行，修正未改变可执行源码，原失败回执保留。
实际数据库演练、部署配置预检仍 SKIP；Core 单元 136 passed/4 ignored，
另有两项外部演练 ignored，依赖外部配置而早返的检查不计业务验收。
追加此回执仅走文档快检查，不重打产品镜像；Git 提交与 push 以实际历史为准。
原件与摘要见 [整批检查回执](core/verify/agent-definition.md)。

### Inbox 共用主体源码（2026-10-04）

Web 与 Desktop 已在源码中共用 Inbox 聚合、行呈现和 Core user-state CAS 消费；
Web 消息仍由 Core 经 BFF 读取，Desktop 保留原生 Relay 消费，不在浏览器持钥。
该 Inbox 子切片为 15 文件 +1360/-371；已合入本批，Web 已部署；Win11 已打包、未设备验收。
隔离候选三套类型检查及 Shared 10/Web 18/Desktop 30 项定向检查通过，
两项生产守卫破坏验证确实失败并恢复；这些不替代合并批次 full 或设备验收。
Web 当前读取每个可访问 Workspace 的已有有界消息页，明确展示此范围；没有
宣称完整历史或实时撤权联合验收。原始证据见 [Web 面记录](web-client/fork/verify/web-surface.md)。

### Workflows 独立页面与执行边界

设计修订 `e0900662dea78a48c65cbfdd54508314947b8512` 已独立发布到
`design-authority`，CI 固定到该版本。REQ-23、DD-106/107 和设计 `06` §9.1
明确要求 Web/Desktop 左侧独立 Workflows 页面并共用 TypeScript 主体；关闭的是
Buzz 原生工作流执行链，不是取消产品入口。本批源码已把原 Automation 管理移至
独立 Workflows 页面，两宿主导入同一组件，Agents 不再重复呈现该管理区。
运行历史由 BFF 按当前用户、Tenant、Workspace 和 Automation 精确分页，复用原
TaskProjection 与 Tasks/Approvals 详情；页面明确标为“我的运行历史”，不扩大读取权限。
共享检查 286 项、Web 18 项及两宿主类型检查通过；四处生产变异触发六个断言失败，
逐字恢复后共享 286 项再次通过。后端三项定向、Clippy 与四语言往返通过，
两处生产变异实际失败并恢复。同批 Web 原构建退出 0，产物 `924abf4b…` 已从
registry 独立读回核对；Win11 原打包退出 0，未签名 EXE 摘要为
`f822e88526a1a93edf07219e5a62e1f5258113c04fc9c599c3c5928d98417f78`，
15,116,346 字节，尚未设备验收。本批固定树 `0bd70a9070913e3770760d7d397ecd9e061fb705`
的原 `./tools/check.sh --full` 已退出 0；163 个 schema、四侧验证、Workflow replay、
19 条追溯与六个当前源码产物通过。数据库全量演练和实际部署配置检查明确跳过；
Core 单元 140 passed/5 ignored，另两项外部演练 ignored，早返的外部用例不计 E2E。
本批另修正原生 Memory 子调用的用量约束和审计枚举匹配，没有另建记忆权威；
独立空库 69 条 up 通过，两项原逻辑变异被实际拒绝、还原通过。部署与浏览器
可访问结果另见本页 12:15 UTC 回执。原件见 [Web 面记录](web-client/fork/verify/web-surface.md)
及 [Agent 记录](core/verify/agent-definition.md)。

DD-106 关闭 Buzz 自带 WorkflowEngine、cron 和 workflow/webhook 路由；不保留第二套
执行权威。用户可见自动化由 DD-107 的 Core 定义/版本及 Temporal 执行承接，复用
AgentTaskWorkflow 与审批子流程。Tasks/Approvals 展示运行和审批，不等于自动化编辑器。
DD-107 冻结 CHANNEL_MESSAGE、MENTION、SCHEDULE、WEBHOOK 四种触发与 AGENT_TURN、
POST_MESSAGE 两种动作；设计范围不等于已完整交付。当前定时自动化已有源码和既有部署，
其真实业务验收与其余触发/动作的完整闭环仍须逐项证据，不能将“Temporal 已接入”
写成原版 Workflows 全功能等价完成。

### 当前 Web 登录核对（2026-10-04 08:55 UTC）

实际浏览器以业务引导账号 `kailo-bootstrap-admin` 完成 OIDC 登录，频道同步、
已有消息与七项导航正常呈现；Agents 页可读回已有定义、发布版本和 Installation。
未发送消息、创建对象、修改权限或调用模型。`seam-verifier` 仅为隔离验收账号，
其旧测试 Tenant 成员资格已撤销，不能作为正常使用账号；此前提供该账号有误。
业务账号的现有密码由 `deploy/local/secrets/bootstrap_user_password` 受控保存，
不在文档中复制。数据库读回业务 Tenant、Principal、Tenant/Workspace 成员均 ACTIVE。
本次仅证明现部署 Web 的实际登录与上述页面读取，不改变 Agent 回复、组件集成、
Win11 设备验收或生产就绪的未完成状态。

### 当前交付批：原生定时自动化与 Session 首轮记忆消费

终态结算修正已提交并普通 push：
`ed9cc16c89c2c82ec75487bb1d95de8e3fe63719`，相对
`aa19c8fe39cb7e71aa01c354a4a121e05c881998` 为 3 文件 +403/-67。
该提交的固定候选原全量检查通过，现已随下述 e7 批次部署；
部署健康不代替真实回合的回复与用量终态证据。

本批已实现并完成定向恢复验证，沿既有 `DD-107`：Temporal 原生 Schedule 创建、读回、
暂停/恢复/删除；首个 AgentTask Activity 以原生计划时间做 run admission；
Web/Desktop 共用平台页面消费真实版本和 Installation 能力，填写显式计划参数。
这是同一批后端、Worker、四侧契约及共用 UI，不增加自制调度器或第二套 Web 页面。
记忆消费同步按设计 19 修正：FOUND 使用固定 head，ABSENT 提供受治理引导，
UNREADABLE 不注入提示；仅 Session 首个 turn 消费，继续会话依赖原生历史。
共享审批页面也保留结果不明决策的原 intent，后续拒绝不伪造原动作失败。

本批源码已提交并普通 push 为
`e7a5e50bc176994e4e6c74850474a4e81ccba292`，远端 main 已独立核对一致；
相对 `ed9cc16c89c2c82ec75487bb1d95de8e3fe63719` 为 62 文件 +4370/-383。
Core 113 项通过/4 项忽略、Bridge 8 项通过，Worker
全包与既有重放、Clippy 通过，私有生产变异捕获后已精确恢复。共用 UI 219 项
通过。Web 原构建与 registry 独立读回通过，Win11 同批原打包已退出 0，
安装包摘要为 `4f1b6ed3…`；仍未签名、未作设备安装与业务验收。
本批固定候选原 `./tools/check.sh --full` 已退出 0；实际数据库演练与部署配置
预检跳过；产物与检查记录已随 `dbd53da14baddae7f93e850cca4db7147f318093`
提交并普通 push。06:18–06:20 UTC，固定 e7 源码的 Core `2052ea7e…`、
Worker `a393942f…` 与同批 Web `12dea304…` 已沿原入口限定部署，在线迁移
仅向前到 61。Core healthz 200、唯一 Codex 子进程恢复，Worker 原任务队列
已开始轮询，Web healthy 且 HTTP 200；其余 25 个平台容器不变。
没有新建自动化或调用模型，不能将这些健康回执计作 Schedule 业务验收。Mobile 对新增
Schedule/CHANNEL 的读取与展示遗漏另行修正，原 full 不替代 Flutter 页面验收。
真实 Agent 回复与用量业务终态、受治理工具调用、完整计量/额度及三端设备交付
仍须各自实际证据；Cells/WeKnora/Wren 的可选扩展未因此变成已集成。
不把 18 条追溯数量当作 18 项业务目标完成数。

### 当前回合事实：原生用量已结算，真实回复仍缺失

04:01 UTC，在已部署的 `99dd3ebba3d278ca2c373b390909d72c0a4d5cbd` Core
上完成一个新的隔离、单次受权调用。新 Invocation
`b74498cd-a9f6-48ea-8b7d-7ed592ea8e79` 的 Core trace 与 Gateway request、
durable usage dispatch trace 均为 `314bb1b1d4cf4c6cbab5a06ad7d2bda4`；
Gateway 实际 HTTP 200、input 8740/output 132/total 8872 tokens。
这证明修复后的真实追踪关联成立，不是完整业务成功。

该原生回合 completed，但 durable history 只有 UserMessage 与 Reasoning，
没有 AgentMessage，`last_agent_message` 为空。当时回复未发布、业务任务结果不明，
不能把 reasoning 当正文或再次执行模型。04:10 UTC 只读采样还发现原代码把
运行容量释放和用量结算排在回复处理之后，导致已结束回合仍持有 UNKNOWN lease。
本批已修正这一收尾顺序，并按固定 Codex 原生语义接纳合法的无 phase 回复；
定向 12 项、两次生产变异/还原、Clippy 与固定候选原全量检查通过。
后者不解决本次根本没有 assistant 消息的问题；修复现已随上述 e7 批次部署。
06:28–06:31 UTC 只读查证：b744 Invocation/Task 为 FAILED、Workflow TERMINAL、
Capacity RELEASED，仍没有回复；唯一 SUM 事件为 8872 tokens、COMMITTED，
OpenMeter 原生 GET 200 读回相同事件，stored_at 为 05:00:44 UTC、无验证错误。
这是既有回合的实际用量收口，不是本次部署新发模型或成功回复。其 frozen quota
为 CHECK，不冒称发生 STRICT reservation；旧 4cfe 的 NULL trace 与 tail 阻塞未改。
设备与签名缺口保留。
2026-10-04 用户确认模型服务为第三方、无法提供服务端访问权限；不再将该权限
作为客户端或组件开发的前提。旧响应原始 SSE 未留存，缺少回复的根因仍未确定；
后续兼容性只能在受权的新调用中从 Kailo/Gateway/Codex 可观察边界取证，
不重放旧回合、不用 reasoning 补造回复，也不把该局部阻断记作整个主体不可开发。
完整事实、外部证据缺口与新旧回合的隔离边界见
[Agent 调用记录](core/verify/agent-definition.md)。

### 历史交付时点：首个回合缺失原生 trace

普通顶层消息的 Agent 提及已提交并普通 push 为
`b2829522227d7f17053228835c9fac61734a04ef`，相对
`f81f6ca84d5d4773920a3e7744eb24614376551f` 为 18 文件 +679/-52。
原四侧契约往返、Core 定向验证、Web 类型与既有检查通过；三个生产守卫变异与
四语言未知字段反例实际失败，逐字还原后通过。此为源码及定向证据，不是 full 或业务通过。

固定上述干净提交的 Core 与 Web 原构建、registry 独立摘要读回均退出 0；
02:51 UTC 仅替换 Core 为 `cae7005b…`，在线迁移向前到 60，healthz 200；
02:53 UTC 仅替换 Web 为 `69a956b6…`，healthy。两次投递各自其余容器不变，
未改 sole `.env`、profiles、授权或预算。共用平台包与生成契约保持单源；本次
Composer 选择控件属于 Web BFF 宿主接线，不称 Desktop/Web 整个 Composer 共用
（ADR-09 保留各宿主提及处理）。Win11 x64 原 NSIS 构建随后退出 0，包摘要
`526e951c…`；仍为未签名测试包，未作 Win11 安装或设备业务验收。

02:54 UTC 真实 OIDC 登录后从页面明确选中同一安装并仅发送一次消息，
BFF 返回 `403 / DENIED / PUBLISH_REJECTED`；Core 原日志确认 Relay 返回
`HTTP 400: restricted: not a channel member`。Operation
`04d4210b-af84-4556-ad47-64a8ec974e22` 保留为确定拒绝，不盲重发或放宽成员校验。
当时只读采样 Invocation、Session 均为 0，原单次 Delegation uses 0。
根因是验收 HUMAN 没有 WorkspaceMembership；管理权限不自动授予协作成员身份。
02:59 UTC 通过原 BFF 显式 `workspace.member.add`，原 Temporal 成员投影完成，
membership ACTIVE。03:00 UTC 后续页面发送被 Relay 接受并准确回读；没有改权限逻辑。

同一根消息已产生 Invocation `4cfe99fe-1e45-46d2-834b-411027412a9d`、原生
Codex thread/turn 与 Temporal AgentTask；Codex 回报 completed，Gateway 实际
HTTP 200、input 8726/output 37/total 8763 tokens。但原生 request_logs 与
usage_dispatches 的 trace_id 均为空，Core 不能把这份用量关联为可核验终态。
Invocation 仍 RUNNING/UNKNOWN_EXTERNAL_RESULT，回复未确认、usage_event 0；
不按时间或 principal 回填关联，不盲重发、不追加或延长本次隔离预算。
当前修复范围是原生追踪传播接缝，不把 native completed 或 HTTP 200 当成业务成功。
该接缝已补齐原生 OTel 配置及回读守卫；隔离原生 HTTP 实证 trace ID 传播一致，
没有再次调用生产模型。选定树 `311a29212fae412900e4cd5ebe157b3893b9ac02`
原 `./tools/check.sh --full` 已退出 0；实际数据库/部署配置 SKIP 和设备/签名
缺口保留。03:45 UTC 修复已仅部署到 Core，镜像 `50bd7f19…`，healthz 200，
原 Supervisor 恢复唯一 Codex 子进程，其余 27 个容器未变。03:47 UTC 原浏览器
复查 Installation 仍 ACTIVE generation 1，旧任务为 RUNNING/BILLING_UNAVAILABLE，
消息一条、回复零条，旧单次委托已 EXPIRED/uses=1；没有重发调用。
旧 NULL trace 不被补造为已对账；该旧事件阻塞全局
tail，但已有按单个 Invocation 精确 trace 结算的原生消费路径，不需另造通道。
详见 [Agent 调用记录](core/verify/agent-definition.md)。

### 历史交付时点：普通调用 Core 已部署，显式授权已读回，首轮尚未验收

普通调用、Installation execute 权限和模型 SUM 分流已提交并普通 push 为
`13a8af775afb5232a5ce590bd9d5750cbb0f1a73`（37 文件 +4124/-146）。
固定干净输入的 Core 原构建、registry push/独立读回与原启动入口均退出 0；
02:02 UTC 仅替换 Core 为 `bd5c5f57…`，healthz 200，原 Codex 子进程恢复。
在线迁移只向前从 57 到 59，原 Installation 保持 ACTIVE generation 1 和固定
Version/hash，没有重建安装或重发 turn；Core 阶段其余 23 个平台容器及 5 个
既有数字人容器未变。Web 同批原 helper 已交付并限定部署 `b399d911…`，
Win11 原 helper 已产出未签名测试包；未做设备安装或设备验收。

02:05–02:07 UTC 原 BFF 链完成 execute grant → owner APPROVE →
CONSUMED/ALLOWED/DISPATCHED；安装 resourceVersion 3 的 executionPermission
requested/effective 均为 true。确切 Installation 的单次 Delegation
`a1d9a1ca-af8b-4df6-9f87-ab36e5037964` 读回 ACTIVE、uses 0/maxUses 1，
expiresAt 为 03:35 UTC。原生隔离验收 meter 与 10000 totalTokens 硬限额已由
运维投递，不是生产默认预算；本次部署未改 sole `.env` 或 profiles。

源码阶段原 full 1（仅两端产物来源落后）的历史回执仍保留，后续实际产物不能
倒填该结果为 full 0。主线选定元数据树的原 seam 检查退出 0：6 份来源/6 个
当前源码产物通过，Win11 unsigned 与 Mobile 签名 NOTE 保留；这不是新 full 0。
持久 Core/Web/Win 元数据窄补丁已由主线选入，尚待该
交付阶段提交；Web mention 标签接缝正在另一功能批补齐。截至上述回读没有
真实模型首轮、频道回复或 stored usage 终态，不将 ACTIVE 安装或显式授权
等同 Agent 已可使用；普通入口以真实调用链和后续验收为准。
详见 [Core 发布回执](core/verify/release-artifacts.md) 与
[BFF 授权记录](core/verify/agent-definition.md)。

### 历史验证时点：旧 Core 与普通调用源码阶段

Runtime 恢复与 AgentTask 分页恢复已提交并普通 push，固定输入
`8b3882d35b84b2c0d6bfcb29321c62c7a44f82d4` 的 Core 原构建、registry 读回及
原 `start-core.sh --no-build` 均退出 0，00:21 UTC 仅替换 Core 为 `c970fc9d…`，
healthz 200、受监督 Codex 进程存活；原 Installation 仍为 ACTIVE generation 1，
Invocation 仍为 0，57 条迁移不变，未重发安装或模型首轮。
本次只改私有 Compose image pin，sole `.env` 未变；运行容器已替换不等于默认
部署配置已升级，下一次无该 override 的启动不保证使用上述产物。
详见 [Core 发布回执](core/verify/release-artifacts.md)。

已提交分页修复在未绑定 turn 时读取完整原生历史，再以唯一 clientId 交给原 CAS；
原目标 8 项通过、两次生产变异分别抓住 2 项和 1 项，精确还原后 8 项通过，
格式与 Clippy 退出 0。可选 `AUTOMATION_RUN_METERS_JSON` 改由原 base Compose
统一消费，移除 start-core 的重复专属 overlay；原 start-core 此前已经能投递非空值，
线上 UNSET 不是已证实的 launcher 丢配置。该固定选定树原集中 full 已退出 0；
实际数据库演练和部署配置预检 SKIP，不外推为部署或首轮验收。

主线只读核对线上 Core：`automation.*` 仅 create、disable、enable、pause、
publish_version 五项 ACTIVE 管理 Action，没有 `automation.run`；Invocation 与
AutomationDefinition 均为 0。OpenMeter meters、features、entitlements 各为 0。
真实 meter、feature 和额度尚未投递，不能由源码虚构。本批普通 `agent.invoke`
生产者、Installation 自身 execute 权限面与共享管理 UI 已实现并冻结，定向验收
已完成；固定私有树的集中 full 实际退出 1，唯一失败维度是共享输入已变化而
Web/Win11 产物来源落后。源码静态、四语言验证/契约、replay 与追溯通过，
不是本批完整收口或发布通过。实际数据库演练与部署配置预检 SKIP；59 迁移往返
与 19 SQL PREPARE 属另一项隔离定向验收。本批尚未发布或部署；普通模型调用
只结算原生模型 SUM，不借用
`automation.run` COUNT。计量目标 9 项通过、两次生产变异实际失败、精确还原后
检查与 Clippy 通过；独占临时库迁移往返通过，有普通 trace 时回滚被拒绝且数据
未变。隔离夹具不是真实调用；线上仍未开放普通入口，未发生真实模型回合或用量终态。
生产计量配置尚缺不阻止后续在明确隔离的验收 Tenant 中使用原生 meter、
entitlement 与真实模型调用继续验收；当前源码检查尚未提供该端到端结果。
两数据库查询均为显式只读（Core 只读事务、OpenMeter 只读会话），
没有创建业务对象。详见 [AgentTask 证据](core/verify/agent-definition.md)；
普通链新源码不在上述旧 Core 镜像内；已有安装 ACTIVE 不等于 Agent 已可使用，
18 条追溯也不是 18 项业务目标全部完成。

### 历史验证时点：Runtime 恢复锁序与原生投影

Core Runtime 已修复进程清理与 Invocation 行锁的反向等待，恢复同一 thread 时
补齐既有模型、目录和审批字段回读；停机清理仅作用于本机仍持有的进程及其代际。
实现后原 Runtime 目标 7 项通过，3 次生产变异均被抓住，逐字还原后通过；
Clippy 与选定源码格式检查退出 0；本批原集中 full 已退出 0，实际数据库演练与
部署配置预检跳过。尚未构建或部署本批产物，
隔离 PostgreSQL/受控 stdio 验证不等于真实 Codex 或 Agent 首轮 E2E。
原安装完成及线上镜像事实不变，详见[Runtime 事后证据](core/verify/agent-definition.md)。

### 原生会话异步归属批：源码与验收边界

共享 TypeScript、Desktop 原生会话与 Mobile 登录链源码已集中收口：旧登录、
刷新、注销和连接结果不得覆盖后来会话；退出的服务端结果按真实确认呈现。
共享端选定代码类型检查与 170 项测试通过，私有守卫破坏分别抓住 2 项和
5 项回归，恢复后通过；Desktop 原生检查 14 通过、1 忽略，连接检查 3 通过，
Mobile 检查 31 通过、真实 E2E 1 跳过。Web 与 Win11 未签名测试包已构建，不能把
源码修复算作设备验收；[验证记录](core/verify/native-identity.md)保留
实际命令结果与边界。下文已部署 Gateway 与已完成原安装的事实不变，普通
Agent 首轮、回复、用量和生产出口仍未闭合。

本批已普通 push 为 `4dca2f355dcee8df1c563ee6d4871fd81eea474c`，相对前提交
43 文件、+2610/-318；选定树原 `check.sh --full` 退出 0，数据库演练与实际
部署配置预检跳过。22:41 UTC 仅投递 Web 镜像 `7576e989…`，容器 healthy、
内部页面与健康接口 HTTP 200，公开匿名入口返回原 OIDC 302；其余 27 个
Compose 容器未变。未做新包 Win11 安装、手机或本次浏览器登录 E2E。

### 21:23 UTC 原安装完成，Codex 进程已就绪

Gateway 模型发现修复已提交并普通 push 为
`d82f0f0613168c8080029ee292ea28dc2f1fcd59`，相对 `f3323b6c1` 为
2 文件、+237/-21。原生列表四项验证通过，恢复旧生产函数后四项均断言失败，
逐字还原后通过；Core 原模型唯一性和授权检查未放宽。
原 helper 对该干净提交构建一次并退出 0，Gateway `c5120451…` 于 21:16 UTC
限定部署；24 个运行服务中只替换 Gateway，其余 23 个未变。

原 Installation `8f240978-34bb-437d-97ee-498a30e67e86` 的 Resource、安装、
runtime generation 1、模型凭据和频道绑定均已读回 ACTIVE，Core 中真实存在
受监督的 Codex app-server 子进程。原 Workflow/run 未重建；21:23 UTC 只读
回执确认 Workflow TERMINAL、Task COMPLETED、UNKNOWN 等待原因清空。
浏览器真实登录后显示 Active installation record，相关 BFF 读取均为 200、
pageerror 为 0；稍早浏览器记录中的 Running 已由上述后续终态回执收敛。

本批固定树原 `tools/check.sh --full` 退出 0，实际部署配置预检另行通过；
没有数据库迁移，full 内迁移演练与实际配置仍按原输出 SKIP，未安装 gitleaks。
安装完成不等于 Agent 首轮成功：普通 mention/manual-assignment 的完整动作目录、
真实模型首轮、频道回复、用量收尾和三端设备/签名验收仍未闭合。没有新建安装、
重放未知操作或直接改写业务状态。完整回执见
[模型发现与原安装恢复记录](model-gateway/fork/verify/admin-authentication.md)。

### Workflow scope 修复已部署，原安装推进至模型凭据对账

`66c48e80994437685c1eaa713b93a4bac43b8207` 已普通 push，远端 main 读回一致；
相对 `c0707d8f` 为 21 文件、+156/-22。选定树的原文档检查退出 0，未重复构建。
新 Web 真实 OIDC 登录后，共享 Agent 管理页展示 Published 版本与 Being installed
安装；相关 BFF 读取均为 200、浏览器 pageerror 为 0，不把安装中记为运行成功。

原安装的只读调查确认 WorkflowRef 的 workspace_id 为空，而同 ActionExecution
具有准确 workspace；模型凭据生产者的既有 scope guard 因此拒绝。修复落在原
ComponentTask 写者和既有有界工作流对账循环：新写入继承冻结 scope，已有缺失值
须证明同一执行身份才补齐，非空冲突不覆盖，不删除 guard、不重新发起安装。
修复已提交并 push 为 `eef540705af9de3a2dd338ea7f5e8129f29bdee4`，相对上一批
9 文件、+432/-47；定向验证、集中 full 和最终文档检查均退出 0。20:24 UTC 原
启动入口已限定部署 Core `50ab55f3…`，healthz 200，其余 23 个运行服务未变。
原安装的 workspace 已由原对账补齐、原 run 保持；模型凭据意图已推进到 PENDING，
尚无原生 key 读回与 Codex 子进程，Installation 仍为 PROVISIONING，不称安装完成。
Win11 原 helper 已退出 0，详见下段。真实 Agent 首轮、
普通触发、回复、用量及三端设备验收仍未闭合，不能正式使用 Agent 的结论不变。

同批共源 Win11 x64 NSIS 安装包已生成，15,111,005 字节，SHA-256
`f7f8c8aa9a61543fdae84ff779030bf59c812bab7c8690cb1a38a7886308951e`。
原件为 `/volumes/data/kailo/tmp/codex-client-management-delivery-20261003.3RI9lm/apps/dist/desktop-client/Kailo_0.5.23_x64-setup.exe`。
2258 项实际输入和 Cargo.lock 构建前后未变，来源两字段已按原 helper 同步；
仍是未签名测试包，没有 Win11 安装运行验收，不因此关闭生产门禁。

### 19:23 UTC 版本发布成功，安装初始化仍未闭合

干净 `c0707d8fda400f4fcfd1eae9c57e494a633398d9` 的 Gateway 原 helper 已退出 0，
registry manifest 独立 SHA 与登记一致，产物为 `b9e3bf8d…`；仅替换 Gateway 后，
真实 HUMAN 的版本配置连续读回 200，未增加超时或放宽原生投影查证。
首个 AgentVersion 已经原 Action 创建、显式发布并读回 `PUBLISHED`；Installation
已准入并创建原 Temporal Workflow，但仍是 `PROVISIONING / PENDING`，任务为
`RUNNING / UNKNOWN_EXTERNAL_RESULT`，原生初始化报依赖不可查证，尚无 Codex 子进程。
这推进了真实发布链，不等于 Agent 已能回答；不重复创建或直接改业务状态。

共源 Web 原 helper 同批退出 0，`b366d565…` 已限定部署且 healthy；部署前后
只有 Gateway、Web 两服务变化，其他 26 个 Compose 容器的 ID、镜像和启动时间不变。
Win11 正沿原 helper 打包，尚无本批安装包或设备验收。新的产物引用与本节记录
尚未提交；最新完整检查的 Desktop 来源失配失败仍保留，未称 full 或生产验收通过。
实际来源、首次非 UUID 操作键被 422 拒绝及后续真实业务回执分别见
[Gateway 记录](model-gateway/fork/verify/durable-usage.md)、
[Agent 记录](core/verify/agent-definition.md)、[Web 记录](web-client/fork/verify/web-surface.md)。

### Gateway 修复源码已提交，普通触发缺项收敛

`c0707d8fda400f4fcfd1eae9c57e494a633398d9` 已普通 push，本地与远端 main 一致；
相对 `c0d32d47d` 为 6 文件、+135/-14，包含下节 Gateway 与 Mobile 修复。
固定提交树的原文档检查退出 0，不替代完整发布检查。原 Gateway 构建
`666zgmpv7tsaill2tgw7e4vtx` 的 BuildKit 实际状态为 `Canceled`，运行 3 分 56 秒，
没有新产物或部署；不能把其他项目的运行构建进程当作本次进展。

普通频道 mention/manual-assignment 已由设计 `17` §2 明确为独立入口，
ChannelAgentBinding、Invocation 幂等键及 HUMAN/Agent/Delegation 权限交集、
Temporal、Capacity、模型用量和回复边界均已有定义，不再统称运行策略缺失。
当前缺项是普通触发对应的完整 ActionDefinition 目录条目；设计 `03` §4
禁止缺省其权限、确认/审批、quota/meter、结果曝光与审计观测字段。
`05` §2.9 的 `automation.run` 专属于 Automation，不能借给普通触发。
实际代码仍只有 Automation 生产 Invocation，fresh、reply 和 usage 消费也仍
绑定该来源；安装配置成功不代表普通 @Agent 已能回答。

### 安装链依赖与 Mobile 大字号修复

共享管理页刷新修复已普通 push 为 `c0d32d47db2d63350b1dc40bfb2dc94de45ebe94`，
相对 `2b58aa82d` 为 4 文件、+156/-10；原文档检查退出 0，未构建或部署客户端。
版本配置 503 已定位到 Gateway 日志 worker 的阻塞队列等待：它暂停单线程
runtime 的 I/O，影响共用数据库池的原生配置读取。修复保留原队列、重试与排空，
不提高 Core 超时、不放宽认证或投影核验。固定 native SDK 原目标实际
7 passed、4 ignored；旧同步等待变异退出 101，逐字恢复后退出 0。
固定镜像缺 rustfmt，格式调用退出 1；未做 Clippy、构建或部署，不称安装成功。
实际命令、日志摘要及跳过边界见 [原生日志核验](model-gateway/fork/verify/durable-usage.md)。

Mobile 原频道标题 Row 的无约束 Text 已改为 Expanded 自然换行，原 Spacer 删除；
REQ-08/21、DD-74/75 对应的客户端呈现保持原文案、主题、点击与认证路径，不增加
业务状态、权限、契约或三端差异。两文件 +8/-7，原 320px/2 倍字号长列表目标
实际通过，恢复旧布局后重现 8px RenderFlex overflow、退出 1，逐字还原后退出 0；
format 与 analyze 通过。证据位于
`/volumes/data/kailo/tmp/codex-mobile-section-header-20261003.Cj9h7x/`，恢复日志
SHA-256 `9784fae5a4defdf8b10a605c87f8de1f1f80d9e1ec9ac208aae9b7af40ffe775`。
本批记录源码与定向检查，没有打包，不扩大为全部页面、语言或设备验收。

### 17:55 UTC 运行配置实际开放

原 thread-only `SERVER_CODEX` 运行配置已通过既有受控文件投递；没有把
尚不存在的 Installation 凭据或首轮成功当成配置目录发布的前提。原
`start-core.sh --no-build` 实际退出 0，仅重建 Core，镜像保持 `0b429913…`；
新容器 `20c963ca2e4e` 内只读挂载与宿主文件 SHA-256 一致，healthz 返回 200。
真实 HUMAN 登录后的版本配置 BFF 返回 200：`canCreate=true`，一个 ACTIVE
Profile 和一个已治理的模型 Route；此前同入口为 `canCreate=false`、空目录。

17:59 UTC 创建前再次读取配置返回 503，18:02 UTC 只读复查仍为
`UNKNOWN/DEPENDENCY_UNAVAILABLE`；Core 报模型原生投影或凭据查证未闭合。
尚未发出 Version 创建、发布或 Installation 写请求，不能据首次 200 称入口稳定可用。
Installation 仍须经原权限、凭据、Codex initialize、投影回读和最终状态核验。
原始部署、配置摘要与 BFF 回读见
[Agent 实施记录](core/verify/agent-definition.md)。

共享 Web/Desktop 管理页已修正另一处实际缺口：发布版本和管理区刷新现在都会
重新读取安装候选，不再保留首次读取的空目录；UNKNOWN 安装意图、原命令和幂等键
保持不变。类型检查与 39 项定向检查通过，去掉生产刷新键后两项失败，精确还原后
再次通过；116 项未选中，不计通过。本批没有构建或部署客户端，不是安装业务验收。

### 运行配置修复与客户端收口

`31d71b1c4ee002f8b392ffa14b07d1fca6dee4ca` 已提交并普通 push：运行配置目录
复用原 Version 发布裁决，只返回支持的回复策略及其原生映射，不再提供提交后必然
拒绝的选项。相对 `2ef579bdf` 为 2 文件、+119/-15。Clippy 与 8 项检查实际通过；
策略判定、映射子集两次生产变异均退出 101，逐字恢复后退出 0。未激活 Profile，未部署。

本批 Mobile 修复认证拒绝被前后台切换或迟到回调清除的问题；频道列表与详情共用
同步状态横幅。横幅自然占位，不覆盖末项。共享 TypeScript 文案生成 Dart，未另立
文案来源。初始选定检查 112 项及详情重连 1 项通过；认证 guard 破坏退出 1、恢复
退出 0。布局在 320px/1.5 倍字号下检查通过，恢复旧覆盖布局后实际失败、还原通过。
320px/2 倍字号检查另发现既有 `_SectionHeader` 横向溢出 8px，该失败保留，
不声称整页大字号、设备或 Mobile release 验收通过。最终选定补丁为 11 文件、
+412/-20，SHA-256 `715364edb3afb45fb8c447b37baa0d2dad2f3891f8faece393941b5daac6a5f2`。

原 Win11 x64 helper 对干净 `2ef579bdfc4e4cd243de835988940f07018f5833`
实际退出 0。2258 项输入摘要与 Desktop Cargo.lock 构建前后逐字一致；安装包
`Kailo_0.5.23_x64-setup.exe` 为 15110708 字节，SHA-256
`d2b0558e06be8f0b36fdac5d8e00128afc067442093f999ac3e1d384d0a9eebd`。
原件位于 `/volumes/data/kailo/tmp/codex-desktop-source-closure-20261003.NXRrHU/apps/dist/desktop-client/`。
helper 日志 SHA-256 为 `95f9bc14e953913351a505ec12312d15b9044f7eb54aa3020c920763afcb9d3b`。
它是未签名测试包，未做 Win11 安装运行验收。共享文案属于 Desktop 构建输入，
因此该包不覆盖本批 Mobile 文案后的新源码；不重写其来源摘要或据此报告完整检查通过。
本批没有重新部署服务。普通 mention、安装、真实模型首轮、回复和结算仍未贯通。
上述 Mobile 修复和客户端证据已提交并普通 push 为
`2b58aa82d55fd7e17ccadf78ba33596bbc92f372`，相对 `31d71b1c4` 为 13 文件、+439/-22。

### 16:58 UTC Customer 真实闭环与部署

`104a9104b60d5357306cfc7528d7b8188399c536` 的正式 Core/Worker 已限定部署，
实际镜像分别为 `0b429913…`、`2cb5525c…`；部署前后逐项比较只有这两个服务变化。
Core healthz 200，Worker 启动原 Temporal 队列。在线库仍为 57 条成功迁移，
本批没有新增迁移或重置数据库。

对原业务 Tenant 执行既有 `bootstrap-tenant`，首次与重复调用均实际返回
`COMPLETED`。Core 中只有一份 ACTIVE Customer binding；OpenMeter 原生集合与
单项回读均 200、同一个 Customer、总数 1。原 ActionExecution 为
ALLOWED/DISPATCHED，同一 Operation 下六条审计事件；重入不新增 Customer、
绑定或执行。完整 ID、命令结果及日志摘要见 [发布回执](core/verify/release-artifacts.md)。
这证明一个现存业务 Tenant 的 Customer 创建与重入，不证明额度、用量结算或 Agent 首轮。

桌面端原生发送导出与锁文件修复已提交并 push 为 `9387bfa2abf350c0e05506b443a1abb127c083f5`；
Kafka heap 与容器预算修复为 `f24fa6721505a6c3a190af59d04d572ef4dfe7a3`。
两提交相对 `104a9104` 合计 6 文件、+39/-4；并非六项功能验收。
原生 ACK 检查已实际通过、破坏后失败、还原后通过；Win11 实机仍未验收。
本批原完整检查实际退出 1：Desktop 产物的登记 source digest 与检查树不一致；
Core/Worker、四侧契约与隔离数据库检查通过，不用局部结果覆盖该失败。

普通频道 mention 的生产者与准入、有效 RuntimeProfile、Installation、真实模型首轮、
回复和用量收尾仍未贯通；不能称为用户已可正式使用 Agent。
Cells、WeKnora、Wren 与设备交付继续独立处理，不作为核心开发等待条件。

### 16:06 UTC 首轮入口复核与撤回

`bd7cdfc3bf4190287a37f0ef8b4e1fddc77166e5` 已普通 push；相对
`f535e7d07843119b01ee30a1625fb459c44edd82` 为 8 文件、+552/-37。
Customer 初始化与运行目录登记已进入源码提交，但尚未构建部署，不能称为首轮通过。

本次源码复核确认首轮实现存在入口偏差：
[Agent 管理设计](../.design/17-Agent管理平面设计.md) §2 明确规定
ChannelAgentBinding 的 mention/manual-assignment 与 Automation 是独立路径；
目前唯一的 `catalog.agent_invocation` 插入在 `automation.rs`，Session 建立、
Task 首轮和 Runtime 派发又依赖 `automation::fresh_invocation`。
普通频道 mention 的独立生产者尚不存在。Automation 的 executor 授权缺口
不能据此解释为普通对话的设计前置，也不能继续只修 Automation 代替普通入口。

冻结合同尚未给出普通 mention 的完整准入策略，以及 Automation executor
的显式授予/撤销动作策略；DD-82 的 HUMAN 管理员动作不能替代 Agent 资源授权。
同时，本次新增的 `tool.definition.create` 没有专属冻结策略，不能以
AgentDefinition 的确认/审批策略代用。该未提交工具入口及尚无真实消费者的
Gateway 服务身份接线已安排精确撤回，私有源码和检查原件保留；未改变已提交版本、
权限边界、业务数据或线上服务。这些是实施缺口和设计决策缺项，不是图谱阻塞。

Win11 unsigned 包有构建成功记录，但原 helper 构建中自动补写 Desktop 锁文件；
来源闭合与原生发送核验尚未完成，不能称为可复现正式包或 Win11 设备通过。
本次复核不新增业务验收通过项；以下带时间的记录保留原时点边界。

### 15:38 UTC 首轮 Agent 主线增量

`f535e7d07843119b01ee30a1625fb459c44edd82` 已普通 push，较上一提交
4 文件、+91/-3：禁用托管 Codex 的旁路 web search，并按 OpenMeter 原生
Meter key 规则接受既定 `automation.run`；原 Feature key 约束不放宽。
固定 SDK 中 Clippy、Meter 1/1、Runtime 6/6 通过；两处实际守卫破坏后均失败，
还原后通过。没有以此重复全量构建或部署，线上仍是下节列出的产物。

下一批已写入原 ACTIVE Tenant 的 Customer 初始化消费者，以及
`automation.run` 的受控配置登记与原准入消费；复用已有 AE/Operation、
Customer 对账和 ActionDefinition，不创建第二份额度或工作流权威。
两处缺口是零 Tool 首轮的实际前置，不以空目录称为就绪。集中 fmt/Clippy 通过，
定向检查 9 passed/1 ignored，8 条 SQL 的隔离库 PREPARE/EXPLAIN 通过；
运行 meter 必含项的实际守卫破坏后失败、还原后通过，尚无新业务或部署验收。
完整验证回执见 [Agent 实施记录](core/verify/agent-definition.md)。
Gateway 服务身份和 Tool 接入另批推进，不作为零 Tool 回合的依赖。
RuntimeProfile 尚未投递有效目录，真实首轮、原生额度与用量收尾、三端设备和
一期生产验收仍未完成；Cells、WeKnora、Wren 参考业务扩展仍未集成交付。

### 14:40 UTC 部署与真实创建结果

`3d8c0c11285fbf1cfa447ba21e465842ceb4abf3` 的正式 Core/Worker 及同源 Web
已经限定部署：Core `e51b71ff…`、Worker `dcbbbd6c…`、Web `42afa40d…`。
Gateway 沿用 `14bf9f87…`，只重新加载已验证配置；没有重建数据库或 Runtime。
原迁移入口向前执行两条迁移，在线库实查 57 条成功记录；Core healthz 200、
Worker 原队列启动、Web healthy、真实管理员 OIDC 登录成功。

实际 `workspace.create` 已由 Temporal 执行至 `COMPLETED`，Workspace 为 `ACTIVE`。
实际 `llm_route.create` 经原 BFF 准入生成 Resource，实查 `ACTIVE`、version 2；
Gateway 同 ID 的原生 virtual model revision 1 读回 200。模型提供方为运维配置的
Qwen 服务；该证据证明配置创建与投影，不证明模型推理或 Agent 回答。
RuntimeProfile 目录仍为空，Version 配置入口因此关闭；没有伪造 Installation 就绪。

Codex hosted web search 默认路径及 OpenMeter meter selector 的两个修复已写入后续
工作树，但不属于上述部署。真实首 turn、工具/MCP、计量收尾、Win11/Mobile 设备
及完整一期验收仍未闭合。构建来源与部署原件见
[发布回执](core/verify/release-artifacts.md)。以下各批回执保留原时点边界。

模型/回复策略与撤权批已普通 push 为 `632ccb1fc`，27文件、+1819/-289。
三端发送与 Version 退役选定源码树 `c84d321d533a0d8c15c0b82dd979c06a60013577`
相对该提交为42文件、+2465/-134（包含必需继承发送链）。四侧生成比对、Core
fmt/Clippy与70 passed/1 ignored、共享类型与原pages103/103、Desktop TS10/10、
Mobile原三目标162/162均有实际证据；退役权限守卫真实破坏失败，逐字恢复后通过。
本批新包、完整检查、部署和真实Agent首turn未验收，不据源码写入增加上线完成度。
详见[审查后批次证据](docs/acceptance/core-review-2026-10-03.md)。

审查后模型/回复策略与 Grant 撤权源码窗口已集中验证：固定源码树
`ea75ebb874c3748e8973e3d477bc55849ea1f082` 相对 `2432c0b6` 为 26 文件、
+1799/-289；包含四侧生成和独立私网 LLM 投递，不含随后 Version 退役或客户端
修复窗口。原 full 曾退出 1，格式与 Go 消费点随后已修正：Core fmt/Clippy、
70 passed / 1 ignored、Go vet/test/replay 均退出 0；五项模型检查的真实守卫
删除产生断言失败，精确还原后通过。旧 Web/Win11 产物仍落后于共用契约，
完整发布门禁未闭合，不把窄通过当 full 或部署通过。详见
[模型接入实际回执](core/verify/model-route-runtime-policy.md)。

Agent 管理源码与证据已普通 push 至 `9b2225a2d268f41902621ba0d4b1fd44f3b9a8ee`。
相对 Memory 批为 82 文件、+8690/-660 行。四个已构建目标服务已限定替换，
在线库仅 forward 至 55 条；浏览器真实 OIDC 登录成功，共享管理主体可访问。
9b 未带齐 LAN 发布绑定，运行时已消费已有 PUBLIC_BIND_ADDR 修正，源码修正
尚未进入该提交，不把它称为干净 9b 的访问证据。

全面复核固定未提交树 `a1588c071059fc66088f6c8f63777a7e92658b4a`：135 文件、
+10020/-783 行，包含历史未收口改动。确认 2 项 P1、2 项 P2：Desktop 原事件
确认、Grant 撤权停止在途 turn、未知重发拒绝的三端呈现、Mobile 回读后的去重
生命周期。未确认 P0 或新增无依据业务范围；审查不等于全仓无缺陷。
审查已结束，按不重叠模块恢复并行实现；GitNexus 未使用。

实际 RuntimeProfile 目录仍为空；真实 Installation/turn、Agent 工具与主动冷
Memory、完整模型/回复/用量闭环、Win11/Mobile 设备与签名仍未验收，不称生产就绪。
详见[完整复核记录](docs/acceptance/core-review-2026-10-03.md)。以下为历史回执，
保留当时的失败、跳过与未部署边界，不用旧结论覆盖上述实际新状态。

## 历史交付事实（2026-10-03 10:46 UTC，Agent 管理批）

源码阶段已普通 push 为 `b16e6dea2a03128956028bb12d4fd3c2c33242c4`；
相对 Memory 批为 81 文件、8608 行新增、660 行删除。Web/Desktop 共用管理主体。
随后新 Win11 原 helper 实际退出 0，unsigned x64 安装包 15,087,570 字节；
真实 source/artifact 已对齐。固定树 `a7b752937d5536ff6b1189defca5ffa42d3264e3`
的原 `tools/check.sh --full` 实际退出 0：142 schema、四侧、Core/Worker/replay、
18 条追溯、六份来源与六个当前源码产物通过。原日志 SHA-256 为
`233641a20064aa24729531f7b14e2b3e1faefb21ed1830f1002178f0e9d01e06`。
数据库和实际 `.env` 仍 SKIP、三项外部演练 ignored；未部署新管理批，
设备/签名与实际 Agent 模型、工具、Memory、用量闭环未验收，不称生产就绪。
下一批 ReplyPolicy、生成器与无认证提供方接入不在本次 full 或源码提交内。

## 本批源码阶段状态（2026-10-03 10:05 UTC，Agent 管理批）

修正后固定树 `0c07ea4e6c8031ce0dac47403c676c597fda58cc` 的原完整检查
已实际退出 0：132 schema、四侧、Core/Worker/replay、18 条追溯与真实产物来源通过。
数据库与实际配置预检仍 SKIP；Win11 unsigned、设备与 Mobile 签名缺口未关闭。
随后交叉复核发现三处 UNKNOWN 重查收到 403/409 时错误解锁，已直接修正共用 TS：
保留原 command、幂等键与未知状态，只有可核验原请求结果才能解除未知。
三消费者类型及原平台 148/148 检查退出 0；删除真实 guard 后六项检查失败，
精确 SHA 还原后同一完整目标再次退出 0。此前错误断言与失败日志保留。
该修复不在上述 full 的输入中；对应 Web/Win11 沿原 helper 集中构建，
源码与后置核验作为本批阶段提交；Win11 新安装包尚在原 helper 构建中，
最终 full 与部署未完成，不把旧 full 结果外推给新源码或标记生产就绪。
Gateway LF 产物仍为 `sha256:14bf9f878fbca870361171331ac4401f7c3fa5cd8168c665ae9061a4b2a674e7`。
Installation 支持 guard 的后置检查已实际 0→101→0；ReplyPolicy 映射与四侧生成
在独立下一批推进，当前批不能标记 ACTIVE 或首 turn 通过。
详见 [Agent 核验记录](core/verify/agent-definition.md)。

Version 配置与历史、Installation/Grant 管理、模型 Route 产出和原生凭据投递
已进入本批选定实现；Web/Desktop 继续使用同一 TypeScript 主体，Mobile 只读。
本节记录源码阶段提交，不是部署或生产就绪声明；最近实际部署仍为下节的 Memory 批。

- 集中 Core clippy 与原 workspace 检查退出 0，汇总 131 passed、3 ignored；
  没有投递真实数据库配置的早返不算业务验收。随后 ModelRoute 秘密路径与
  UNKNOWN 恢复修正尚未集中编译，不能借此前结果记为通过。
- 共享管理检查 20/20、完整共享检查 145/145；Mobile 页面 73/73。
  已记录的实际生产变异与精确还原均完成，设备与真实 Agent E2E 仍未验收。
  选定输入的原四侧生成与能力注册表生成/比对退出 0。
- Gateway 原 helper 首次编译退出 1，修正严格 UUID 路径解析后重跑退出 0，
  产出 `sha256:f3008585dadda509afc738dd28de925e37019abe64a100b3d928fe071a3a91a0`；
  两项原 handler 检查通过，错误拒绝响应与空密钥的两次有效破坏均报错，还原通过。
  新镜像未部署。新 Web 原 helper 已退出 0，registry 独立读回一致，artifact 为
  `sha256:d4f30d4ec9a5c21594fc361557e4bdd181eb1f4588a971b2ac028cc8cf6f2857`；
  Win11 原打包退出 0，15,087,391 字节 x64 NSIS 包摘要为
  `sha256:d8a87009a238d8ba787b0510e777086fb49885c0dbd0bc977bf3090bdffd9db4`；
  未签名、未安装或设备验收。本批完整门禁、提交与部署未完成。
- 全新隔离库 55 条迁移、两对回退/再前进、原 SQLx 和 44 项枚举核对退出 0；
  Version/Installation/Delegation 的 13 条真实 SQL 执行退出 0，两项破坏被拒绝并还原。
  空库不算业务验收，在线库仍沿最近已部署批的 53 条迁移。

真实 CHECK 准入、Agent 工具/主动 Memory 调用、完整模型/用量业务链、Tenant 删除与
Win11/Mobile 设备及签名验收仍未闭合。Cells、WeKnora、Wren 尚未接入，属于
可选能力扩展，不作为本批核心开发等待条件。实际日志与证据边界见
[Agent 记录](core/verify/agent-definition.md)。

STRICT 只对已有封闭产出方与可证上界的适用动作登记；不另造无调用方的额度账本，
也不把它泛化为首批 Codex/automation CHECK 链的前置条件（ADR-14）。

## 最近已交付状态（2026-10-03，Memory 功能批）

本批已正式提交并普通 push 为 `4b44ac6b266345fbc19e3c315df5c3d9bd0af00b`，
本地与远端 main 实际一致；相对 `ab27c8ed5cd4cd4c0fda8e7748a18649cfbffde4`
为 81 文件、8282 行新增、599 行删除。固定实现树原 full 退出 0，追加证据的
原文档快路径亦退出 0。Core/Worker 原 release、registry push 与独立 digest 读回均为 0；
本批 Core `577c2740…`、Worker `d10b5184…`、Web `97bc2379…`、Relay `d42f83fa…`
已限定替换，原在线库仅 forward，由 50 条迁移至 53 条全部成功。
Core healthz、Web/Relay 原健康检查通过，Worker 启动原 Task Queue。
另外原 Kafka 曾退出 137/OOM，随后同 ID 原样启动一次恢复 healthy；
原 JVM heap=1GiB、容器 limit=1GiB 未调整，重复 OOM 风险未消除。
原 full 内数据库/.env SKIP 与三项外部演练 ignored 保留；native 用量日志为空，
没有真实 Memory/计量 E2E、设备或签名验收，不称生产就绪。
本批实际构建、四份证明、启动失败与恢复边界见 [release 记录](core/verify/release-artifacts.md)。
Version 管理、Installation/Grant 生产者与模型路由后续工作树不属于该已交付批。

## 本批实现后的检查与构建历史

**仍未生产就绪。** 当前选定实现包含 Memory 原生读取与 HUMAN owner 四写动作、
正常 turn 的全集用量结算、确定无模型派发的取消收敛，以及共源客户端消费。
它们只复用原 ActionExecution、UsageEvent、Buzz NIP-AE 与 OpenMeter，不建立第二权威。
本节是实现后的交付事实，不改变原路线或增加产品要求。

- 已运行的窄验证：共享 TypeScript 原页面检查 63/63、Web/Desktop 类型检查、
  Mobile 原页面检查 63/63 与 analyze 均退出 0；这不是三端实机或业务 E2E。
  HUMAN writer 的四侧生成、隔离库 53 条迁移与 SQLx、原生严格补丁破坏/还原有独立回执。
  最后两源审计/准入过期修正只纳入本批集中检查，不借旧日志声称它已验收。
- 原 Web helper 对 98 个真实输入构建、上传并读回退出 0，artifact
  `sha256:97bc23790559a9019feaba5bb9e514d19730410b20beb9cc8dca2924823fb69e`，
  source `sha256:998c3c64308aef52bdf29eb3a2f0e05d954bface856468f6927e05a5b5535bba`。
  Compose 与 14 条实际 Web 产物引用已对齐；产物未部署，不把 registry push 当 Git push。
- 本批固定树的原 `check.sh --full` 已实际退出 1：编译、四侧生成与兼容、
  既有验证和 replay 通过；两处 Gateway 产物引用遗漏及共享 Buzz 变更后的
  Relay/Win11 来源失配失败。前者已对齐实际 `471fa4e9…`，后者须由原 helper
  真实构建，不手写 source/artifact 摘要冒充通过。数据库和实际配置预检为 SKIP。
  原失败回执见 Agent 记录；公开提交、Core/Worker release 与部署尚未完成，
  运行产物仍为下节历史版本。
- 随后原 Relay 与 Win11 helper 均完整退出 0。Relay 的 1118 个输入 source
  `e68add606d98c362e49f9a9fbf33cc4deb24936d065e1ac4f5ef456e79ec30fe`，
  artifact `d42f83fa0dadcd78c4ad721047433a9a7c8e522767edd96cb326d641c5dd0056`；
  独立 registry HTTP200 与原 manifest SHA 一致。Win11 的 2255 个输入 source
  `af6418a4394f1ddff402ef968eaaa45c4319fbc7e843c87cef42dc026c4602ee`，
  15,076,978 字节安装包 artifact
  `5378f3703e0208a6f727357f72b59e7e81836889adf0ff54990f8c718badecce`。
  两者源码摘要前后逐字相等，只同步原来源与 Relay pin；没有部署或重复构建 Web。
  Win11 包未签名、未安装运行。原 full1 历史保留，不把产物生成记为真实
  Memory、计量或设备验收。
- 修正产物指针的固定树 `433be885faead1e95072e10ca447d36b660a1fa7`
  原 `tools/check.sh --full` 实际退出 0：128 schema、四侧、Core/replay、追溯和来源均通过。
  数据库与实际配置仍 SKIP、三项外部演练 ignored；尚未公开提交、本批 release 或部署。
  原日志 SHA 和前后输入证明见 Agent 记录。
- Installation/Grant 的公开生产者、模型与工具治理、严格预留、真实 Agent/Memory/计量
  业务闭环及 Win11/Mobile 设备和签名仍有缺口。Cells、WeKnora、Wren 未完成集成，
  不以这些可选扩展缺席阻断核心功能实现。

详细来源与验证边界见 [Agent 记录](core/verify/agent-definition.md)、
[Web 记录](web-client/fork/verify/web-surface.md) 和
[Mobile 记录](collaboration/fork/verify/mobile-client.md)。
本批 Win11 来源、原日志与未验收边界见
[Desktop 记录](collaboration/fork/verify/desktop-client.md)。

## 上一批交付状态（2026-10-03 03:30 UTC）

**仍未生产就绪。** Gateway 原生持久用量批已提交并普通 push 为
`ab27c8ed5cd4cd4c0fda8e7748a18649cfbffde4`，本地与远端 main 已核对一致。
该批只包含 Gateway 的原生 dispatch/request-set 证据、来源与产物指针，
不把后续 Memory、正常 turn 或取消增量提前计入已交付范围。

- 验证：该批固定源码树的原 `tools/check.sh --full` 实际退出 0；128 schema、四侧生成与兼容、
  原验证/replay、18 条追溯与实际 Gateway 来源均通过。平台数据库和实际 `.env` 预检明确 SKIP，
  三项外部演练 ignored；签名、设备与真实 Agent 业务闭环仍未通过。
- 部署：只替换 Gateway 为 `sha256:471fa4e93689fc0a896b641decd94ca14fa7e76765899c6a8c1dea2c94e881ad`，
  原公开监听地址保持不变。匿名 `/app/` 与 `/api/v1/session` 实际均为 HTTP 302 登录跳转，
  其余 23 个 Compose 服务的容器 ID、镜像和启动时间逐个比对未变；没有重建或重置 Core、Worker、数据库。
  这是产物部署和匿名准入证据，不是模型调用、Memory 或账单业务验收。
- 正在收口的实现：Memory HUMAN 四项写动作复用 Buzz 原生签名、加密、head 与 CLI 严格补丁；
  通过原 Action 路径接入治理、一次发布和 UNKNOWN 对账。Web/Desktop 共用同一写入页面，
  Mobile Definition/Version 与 Memory 保持 BFF 只读；上述增量已合入同一私有候选，尚未提交或部署。
  Core、客户端与契约的集中验证分别留回执，不以源码合入提高生产完成度。

Gateway 构建、完整检查的失败/跳过与本次部署边界见
[原生用量记录](model-gateway/fork/verify/durable-usage.md)。此前 Core/Worker/Web 的运行产物仍为下节记录的版本。

## 上一批交付状态（2026-10-03 01:26 UTC）

**仍未生产就绪。** Runtime 配置与正式打包输入批已提交并普通 push 为
`67b48b7c027317efb59533ee9dcb5bc9b4a1a892`；该源码提交已与远端 main 核对。
源码验证、构建、部署与业务验收分别计数，下面不代表后续工作树已经通过。

- 正式构建：原 `tools/release.sh` 从干净的上述提交实际退出 0，Core 为
  `sha256:18d0f0713e4cbf7e782d68d666759422403e0cfb3223a9504be4d4580afd0c1c`，Worker 为
  `sha256:62d20be0d7d8d44b8f75d2a4a386eab448c819eb4ef8c08709a357e67af8c9a1`。
  两份 SPDX SBOM 和 provenance 已产出，均指向该提交和同一依赖锁摘要；Core 原生 Runtime
  依赖仍为已登记的 `ad13c952…`，没有重新实现 Codex。
- 实际部署：本地只替换 Core、Worker 和已构建的 Web `6f54ce37…`，没有重建或重置环境。
  Core 经原 wrapping 启动入口恢复，实际 `/healthz` 为 HTTP 200；Worker 日志确认原 Temporal
  队列启动；Web healthy。仅容器运行不能证明 Agent 执行或三端业务验收。
- 实际数据库：原生 SQLx 从该提交的迁移目录向前执行 13 条，实际库从 37 条到 50 条，
  退出 0；未清数据、未运行回退、未插入 Agent 测试对象。AgentDefinition 与 AutomationDefinition
  实查均为 0，不将零条目列表当作创建、执行或计量闭环通过。
- 浏览器实查：现有首位管理员经原 OIDC 登录成功，共用 Agent 管理页面与左侧七项导航实际
  渲染；session、workspaces、tasks、agent-definitions 的已观察请求均为 HTTP 200，页面错误
  为 0。未创建业务对象、调用模型或读取 Memory；Installation/Automation 子列表请求未观察到，
  不将页面标题呈现计为这两项业务验收，也不代替 Win11 设备验收。
- 并行开发：Memory 原生复用与 BFF 治理、Gateway 持久用量、取消收敛和正常 turn 最终结算
  正在独立窗口集中收口；后续源码不属于上述 release。Memory 写入、模型/工具治理、严格预留、
  真实 Agent 全链路以及 Win11/Mobile 设备和签名门禁仍未闭合。

原正式构建日志在 `/volumes/data/kailo/tmp/codex-automation-core-worker-release-20261002.FSYx6e/release-67b48b7c.log`，
SHA-256 `fa6dff0195aa8e6fecb1584995fda0aaf0d342c26372825c60f20eae93b1bf2e`；
实际库向前日志在 `/volumes/data/kailo/tmp/codex-live-migrate-67b48b7c.PHQkYc/forward.log`，
SHA-256 `bcee1b9831bb660f2e9a34fb8f2f3dc490ecc27cec7711057844fa5a544b8579`。
浏览器原件在 `/volumes/data/kailo/tmp/codex-live-web-67b48b7c-20261003.HHmRdh/`，
`observation.json` SHA-256 `77ec0edbcd2cf12087605355b2869e4ba0e1d1ddb797252ab4418a49f6173b70`；
同目录保存了实际截图，不保存口令或会话 cookie。
Win11 unsigned 测试包仍保留此前实际产物，不替代安装、登录、本机持钥和业务验收。

## 上一批交付状态（2026-10-02 22:28 UTC）

**仍未生产就绪。** 上一批 Agent 主线已提交并普通 push 为 `fc0c2e0dbd33af72ab5a16cd621715f3a33ad4a6`，本地与远端 main 已核对一致。本批接续实际功能，不再使用 GitNexus；集中验证和阶段提交不在小改动或 push 时重复触发。

本批 60 文件的固定树 `641f5cf0ef5d8a0e33515739303b33cff7b2f49b` 已实际运行原 `tools/check.sh --full`，退出 0；`full.log` SHA-256 为 `888d3185ba0019361836c9c280fe6dbaeb341f599835f4eac0d9564ffc1a288f`。121 schema、四侧兼容、真实数据库迁移前进/回退/再前进、SQLx 与 44 项枚举约束均通过，本次数据库不是 SKIP。实际 `.env` 预检仍 SKIP，Catalog bootstrap、approval CAN 与 Relay outage 三项 ignored，未安装 gitleaks；外部集成早返不计业务验收。该树仍保留 Desktop/Mobile 发布阻断，不借独立 Win11 构建改写已冻结回执。此回执在提交前形成，提交/push 由实际 Git 输出核对；只追加证据文档走原文档快路径，不重复源码构建。

| 范围 | 本批实际增量 | 尚未发生 |
|---|---|---|
| Automation 管理 | 原统一 Action 路径接入 create、publish_version、enable、pause、disable；不可变版本、Installation/Grant pin 与 ACTIVE 投影按真实 scope 查证 | 手动运行、Schedule、Webhook、公开 Grant/Installation 产出入口未开放；已有版本管理不等于 Agent 全链运行通过 |
| Web/Desktop | 同一 `AgentDefinitionsPage` 消费新增 BFF Automation 列表/详情及五项命令；三个消费者类型检查与共享包 98 项检查退出 0，非法 CHANNEL 枚举破坏确实报错并还原 | 未新增第二份 Web 前端；最新共用页面未在浏览器或 Win11 验收 |
| Mobile | 原 Settings 的 Workspace 管理选择增加 Automation 列表与详情，只读经 BFF；四文件 analyze 及既有 25 项检查退出 0，非法枚举破坏被分析器拒绝并还原 | 不提供命令、运行、组件宿主、编辑器或 WebView；无真实 Automation 对象、签名包或设备业务验收 |
| Agent 执行 | 原 Task 消费完整原生 final_answer 和原生完成时钟，经过两次 fresh authorization，持久化固定回复 ID 后单次外发；暂停/停用保留原冻结在途版本，真实撤权仍拒绝 | 回复未知只查证原事件，仍保留 BILLING_UNAVAILABLE；完整结算、严格预留、工具治理和 Memory 写入未完成 |
| 数据/契约 | 新增 Automation 数据约束为第 50 条迁移，原回退/再前进实际退出 0；四侧由原生成器产出。最新六项后实现检查退出 0，包含真实 PostgreSQL 解析和状态/阶段谓词 | 独立库零业务对象；不把 SQL 证据、类型检查或生成记录算作业务闭环 |
| Web 产物 | 原 helper、push 与 registry 读回退出 0：artifact `sha256:6f54ce3744408aa3adfa898ec639b9fad1ef4438774a0869f21b33e722d298ce`，97 个输入 source `sha256:8dbb98b595a7510b584fa1c50e4d0aec37be553bc998263dfbafd7b0401c58eb`，构建前后字节一致 | 尚未部署；旧运行 Core/Worker 不因新源码自动更新 |
| 原生 Runtime / Win11 | 固定 Codex 原 helper 构建与 registry 读回退出 0，Runtime artifact `sha256:ad13c952e20c134c70cc4ba0293e2d568aa98641fe16ede4cceb2671d10887ec`；本批共享 Automation 页面与生成契约的 Win11 x64 NSIS 测试包实际构建退出 0，artifact `9c8101d1…`、2254 输入 source `c14a69f5…` | Runtime 镜像缺失的构建阻断已解除，Core/Worker 本批正式 release 仍须实际运行；Win11 包未签名、未安装运行、未做设备业务验收，不据此关闭生产门禁 |

本批原件在 `/volumes/data/kailo/tmp/codex-automation-integration-20261002.bOjEqV/`。源码验证、全量门禁、提交与部署分别记录，不提前称为通过。本批变更的四步结论如下，记录已有实现，不是另立规格：

- 权威：REQ-23、DD-107 和设计 05 §2.9 固定五项管理动作及线程回复；DD-24/25、DD-65/66/67 固定 Agent pin/主体/记忆边界；DD-74/75 与 REQ-21 固定三端职责。未冻结或已阻断的入口不生成。
- 影响：ActionCommand 和 Automation typed query 的唯一 writer 是原 Core，reader 为同一 TS 主体与生成 Dart 合同；Resource/Asset/Invocation、原 ActionExecution/Audit、SpiceDB 原投影和 Temporal Task 是实际事务与副作用边界。当前全新库没有旧在线 writer，历史迁移兼容无适用对象；新字段与新类型仍经四侧生成、双向序列化和已有契约比对核验，不保留第二套旧读路径。
- 副作用：管理事务不复制协作正文、不新增额度或注册权威。回复正文只在本次内存签名调用中消费，Core 持久化原 Invocation 的固定事件 ID 与同一执行的 typed evidence；外发前两次查证且第二次持锁，原事件结果不明不重新签名或执行。
- 异常：空列表/分页继续沿原 BFF 协议；未知枚举、缺 scope/owner/binding/secret/projection、失效 Grant 或过期 Capacity fail closed。重复命令使用原幂等键，UNKNOWN 保持原键及未知呈现；暂停/停用不取消冻结在途任务，真实撤权拒绝。租户暂停、过期授权、部分副作用、崩溃残留与重复投递沿原 Task/Operation 对账，不捏造终态；责任归属现有 RB-05，时限读取既有运行配置，不引入新状态或硬编码期限。六类错误仍为 DENIED/BLOCKED/PRECONDITION/LIMIT/CONFLICT/UNKNOWN。

模型 Route 管理产出方、运行 profile 的实际投递、工具治理、通用 replyPolicy 的原生映射、严格预留与完整账单、Memory 写入、真实 Agent 业务闭环和三端发布/设备验收仍是剩余缺口。可选 Cells/WeKnora/Wren 不阻断平台核心开发；18 条追溯不是 18 项目标全部完成。详细证据见 [Agent 记录](core/verify/agent-definition.md)、[Web 记录](web-client/fork/verify/web-surface.md) 与 [Desktop 记录](collaboration/fork/verify/desktop-client.md)。

## 上一批交付状态（2026-10-02 20:43 UTC）

**仍未生产就绪。** 本批实现先行、事后集中验证，GitNexus 未使用；下一批自动化管理独立推进，不等待当前提交或 Codex 镜像构建。工具目录缺口不以无调用方的凭据或空 MCP 模块绕过。

| 范围 | 实际结果 | 交付边界 |
|---|---|---|
| Git | 上一批 `558e5a39b0be27ac206a3a382d9ddecbb14513e1` 已普通 push；当前批从它选择独立冻结树 | 当前批的提交、push 由实际 Git 输出核对；下一批改动不混入 |
| Web/Desktop | 同一 `AgentDefinitionsPage` 新增 Workspace 范围的 Installation 列表、分页及详情；98 项检查通过，scope/pin/generation 三种破坏各触发断言，逐次还原后 9 项通过 | 不是第二套 Web UI；不因此宣布浏览器、Win11 或整个三端业务验收 |
| Mobile | 原 Settings→Workspace→Installation 只读链；12 项 Flutter 检查通过，scope/pin/generation/未知分类四次实际破坏均失败并还原 | 不提供安装、运行、工具、文档编辑或 WebView；未取得签名包、设备验收 |
| Agent 执行 | 原 Relay→Automation 准入→AgentTask→固定 Session/Memory→原生首 turn 消费已接线；native startedAt/emittedAtMs 驱动空闲及总时长限制，Capacity 使用 pin Version 的 parallelism | 类型/动作未完整发布的入口仍关闭；模型 Route 管理策略、回复策略投递、工具治理、记忆写入、自动化管理仍缺闭环 |
| 用量/委托 | 原生 COUNT 与 Gateway token SUM 分源，同一稳定 outbox/audit；关闭 Workflow 的实际计数补偿、Customer subject、Delegation 管理及生命周期消费已集成 | 202 不当 COMMITTED；未知关联不捏造次数。strict reservation、per-turn 全集与最终结算未完成；公开 Delegation/运行入口不提前生成 |
| Core 集中 SDK | SQLx prepare、全目标 clippy、workspace 检查退出 0；两项新 policy/runtime 检查主动破坏后各断言失败并按 SHA 还原；49 条私有迁移、末三条回退/重进及 25 个数据库边界核对通过 | 私有 Agent 表仍零对象；不是真实 Codex/Relay/OpenMeter 执行业务验收。此前编译失败原件保留 |
| Web 构建/部署 | 原 helper 与镜像仓库 push 退出 0；artifact `sha256:13841511c9f35552e827bb1d94ad5c68bf3fcc0de921de984b75d107a4382353`，source `28eb2fd45d9ad0752b005d5c3e39c6dbc10bb80feb3e7852dbecc4edf6366c49` | 新产物未部署；仍沿上一批运行镜像。Codex 产物正在独立原 helper 构建，不能在实际成功前解除 Core release 阻断 |

本批原件位于 `/volumes/data/kailo/tmp/codex-agent-next-batch-20261002.reqvgM/`：`sdk-final.log`、`ui-final.log`、`mobile-sdk-mutations.log`、`db-final.log`、`catalog-final.log` 与 `web-build.log`。真实失败、日志摘要、四步影响解释及未覆盖范围见 [Agent 实现记录](core/verify/agent-definition.md)。`llm_route` 仍 DRAFT：设计只定实体与 Core-only 原生投影，没有冻结其管理 Action/审批/输入归属；不借应用 `resource.create` 改义绕过。

本批选定树 `9c18676a5b49e95a9647a06b77bee2e0eb8e3bf2` 的原 `tools/check.sh --full` 实际退出 0，日志 `full-restored.log`，SHA-256 `95daa606a86434c66f569989d11c7ab4c3bddff6bfbf0ea2460057331c5935d9`。初轮只在实体/DD 归属与 13 份 Web 产物引用登记处失败，原 `full.log` 保留，不把它记为通过。最后证据文档另走原文档快路径；不重建源码或 Web。18 条追溯不是用户 18 项目标完成数；full 内数据库/实际配置 SKIP、Win11/Mobile 与生产退出缺口不改记 PASS。

## 上一批交付状态（2026-10-02 15:16 UTC）

**仍未生产就绪。** 下表分别说明源码、验证、提交与部署；后文的历史记录不代表当前版本已通过同一验收。

| 范围 | 已发生的事实 | 尚未完成 |
|---|---|---|
| Git 主干 | 本地 HEAD 与远端 main 均为 `994aa3ca536d09ad8ea716c4aad1088f759f552c`，Agent Definition/Version 治理批已提交并普通 push；包含此前的 Web/Desktop 共源呈现提交 | Installation、Codex Task 与 Gateway 后续增量仍在工作树，尚未提交、push |
| 当前部署 | Web 镜像 `ad82d6e6…` healthy；Core `03c24669…`、Worker `4832ccbb…` running，两者未配置容器 healthcheck | 后续 Core/Worker 候选未部署；此 Web 版本部署后尚无新的完整登录业务走查 |
| 已验证的集成候选 | 包含 Agent Definition/Version 的选定树 `7de76d450c4b54086a79841cf9a866a9c13aeaf2` 已实际运行原 `tools/check.sh --full`，退出 0 | full 内数据库演练与实际 `.env` 预检明确 SKIP；独立空库验证单列。尚无该树的 Core/Worker 正式 release 或部署，不代表整个脏工作树通过 |
| 最新源码纠偏 | AgentDefinition 派发前锁定 Tenant 并读取真实 ACTIVE 状态；OpenMeter HTTP 412 映射到既有 Precondition 分类；两处已纳入上述 SDK 检查 | 编译与既有检查通过不等于新增业务分支已验收；两处尚无业务闭环或部署证据，412 分类没有既有可执行断言，不能声称负向验收通过 |
| Agent 主线 | Definition/Version、published pointer、owner 冻结/审批及生命周期消费已随上述提交入库；选定树最终 full 退出 0，108 schema 兼容、四侧已有验证、独立空库迁移/SQLx/41 枚举约束通过。后续 Installation 表、运行查证与 Codex supervisor/Task 代码正在接入 | 新增工作树未编译验收或部署；公开入口与业务闭环未完成，模型凭据、Delegation、Capacity、用量、记忆及自动化仍须贯通 |
| 三端 | Web/Desktop 共用 TypeScript 呈现；新 Web 构建退出 0，历史 Win11 包保留原来源 | 当前共享合同对应的 Win11 原打包退出 1：crates.io 的 h2 索引下载超时，无新包；撤回失效的当前产物登记，Win11 发布仍阻断。Mobile release 签名缺失，三端完整验收未闭合 |

各 Stage 的剩余缺口见 [交付路线最新状态](02-纵向交付路线.md)；Stage 1/2 的历史证据与最新缺口分别见 [Stage 1 报告](docs/acceptance/stage-1.md)、[Stage 2 报告](docs/acceptance/stage-2.md)。本刀源码依据及验证边界见 [AgentDefinition 记录](core/verify/agent-definition.md) 与 [计量记录](metering/fork/verify/core-authentication.md)，三端产物依据见 [Desktop 记录](collaboration/fork/verify/desktop-client.md) 与 [Web 记录](web-client/fork/verify/web-surface.md)。可选业务能力不作为平台核心发布前提；本次只同步现状，不改设计或扩大交付范围。

最新 full 的原始日志为 `/volumes/data/kailo/tmp/codex-agent-version-selected-final-full-20261002.BkGKqU/full.log`，SHA-256 `460b33a9b62c5217523c7dcee7b99c6785dc138dff542854c248265b5fbcd366`；检查固定上述 `7de76d45…` 选定树，包含 AgentVersion，不包含独立 CHECK 等未选入增量。此前 full 的失败原件保留；最终退出 0 不解除 Windows/Mobile 发布阻断，不代表新增业务或部署验收。

AgentVersion 四侧生成原始日志为 `/volumes/data/kailo/tmp/codex-agent-version-generated-20261002.YBWlJF/gen.log`；只证明既有生成入口实际产出 Rust/Go/TypeScript/Dart，不能代替其集成验证。14:29 UTC 已完成上述治理批提交与普通 push；本段 15:16 UTC 的后续状态更新仍未提交，不外推为新增实现已验收。

## 阅读顺序

1. [工程协作守则](AGENTS.md)
2. [实施总纲](00-实施总纲.md)
3. [工程结构与模块边界](01-工程结构与模块边界.md)
4. [纵向交付路线](02-纵向交付路线.md)
5. [验证、发布与验收门禁](03-验证发布与验收门禁.md)
6. [上游适配与升级](04-上游适配与升级.md)
7. [设计覆盖矩阵](05-设计覆盖矩阵.md)
8. [工程基线规范](06-工程基线规范.md)
9. [运行与运维基线](07-运行与运维基线.md)

## 三层权威

| 层 | 权威内容 | 位置 |
|---|---|---|
| 产品与架构合同 | 术语、实体、权限、状态、源码事实、接缝、阻断项 | [`.design`](../.design/README.md) |
| 工程实施合同 | 仓库边界、交付顺序、质量门禁、升级流程、设计覆盖与工件格式 | 本目录 |
| 可执行事实 | 代码、迁移、API schema、验证记录、构建锁文件、发布清单 | 本目录现有工程文件 |

发生冲突时，产品语义服从 `.design`；工程实现不得以代码现状反向改写设计。设计需要变化时，先按 `.design/AGENTS.md` 的证据纪律完成设计变更，再修改实现与测试。

## 当前确定边界

- 一期同时交付 Buzz Web、Buzz Desktop、Buzz Mobile 三端；它们是仅有的用户入口，能力按 `REQ-21` 分级。
- 用户的 Desktop 测试机为 Windows 11；交付给用户测试的桌面安装包以该平台为目标。Linux `.deb` 只作为 Linux 构建证据，不代替 Win11 安装、登录与协作验收。
- Platform Core/BFF 是单一模块化 Rust 服务，共享业务事务边界。
- Application Worker 是同仓库、独立部署的 Go 进程，使用 Temporal Go SDK `v1.48.0`；该版本是 Kailo 的选择，与 Server 内部依赖版本无关（`SF-TMP-04`）。
- Kailo 分平台核心与业务能力服务两层（`DD-87`）：平台核心强集成、不可替换，零业务能力 binding 时即是完整产品；文件存储、文档编辑、知识与数据查询是可缺席、可替换的业务能力，按能力类别与版本化能力契约接入（`DD-88`），内置的 Cells+ONLYOFFICE、WeKnora、Wren 只是参考实现。
- 平台级能力通过固定 Platform Port Client 或平台自身已编译的 driver 接入；业务能力服务只通过 Remote Adapter 或平台与该服务之间的标准协议接入，各自独立数据库与凭据（`DD-58`、`DD-93`）。
- 交付路线分平台核心链（Stage 0–5 与平台一期收口）与三个可选、互不依赖的能力扩展；一期生产总门禁只含平台核心（`DD-91`）。
- `.references` 是只读上游证据与差异来源，不是实现目录，不在其中开发、构建或打补丁。
- `BLOCKED` 能力不进入路由、菜单、Action、Tool、Workflow 或发布清单。
- `ADAPTER_REQUIRED` 能力只有在对应 `SS-*` 接缝实现、验证并形成可追溯构建产物后才能启用。

`apps/` 是唯一开发工程根，也是独立 Git 仓库根；`core/`、`worker/`、`contracts/`、`tools/` 等直接位于仓库顶层，远端沿用 `bei612/kailo-plus`。原提交与 tag 保留原路径，不重写历史。外层目录、上游证据和工具缓存不是开发项目；设计版本、历史路径与 CI/hook 边界见 [ADR-07](docs/adr/ADR-07-ci-and-branch-protection.md)。

新克隆须同时准备相邻的 `.design` 权威与只读 `.references` 证据；本工程不包含它们的正文。CI 从 [.github/workflows/check.yml](.github/workflows/check.yml) 的 `DESIGN_COMMIT` 读取固定设计版本；新增设计提交在同一远端的 `design-authority` 分支保留，完整历史检出后仍只导出其 `.design` 子树。设计变更单独复核、提交并发布，随后更新该版本，不以缺少设计目录为由跳过门禁。普通 Git push 不安装或执行本地全量检查钩子；验证在阶段收口与 CI 通过既有入口执行，网络重试不重复本地验证（ADR-07）。

## 检查

`tools/check.sh` 是阶段收口与 CI 的唯一门禁入口，不由本地 push 自动触发；宿主调用只负责启动资源受限的检查容器，不在宿主运行项目 Cargo、Go、Node 或 Dart。检查镜像定义在 [`tools/check.Dockerfile`](tools/check.Dockerfile)，按配方摘要查找，实际执行记录不可变 image ID。

执行配置提供 `TMPDIR`、`CHECK_CPUS`、`CHECK_MEMORY`、`CHECK_NETWORK` 和 `CHECK_CACHE_ROOT`；两个目录必须可写且实际位于 `/volumes/data`。镜像首次构建还需要已有受限 `BUILDX_BUILDER`，由共用 [`container-safety.sh`](tools/container-safety.sh) 核对实际 BuildKit CPU、内存、swap 与数据缓存；不退回默认 builder，不降低 Cargo 并行度。完整规则与 CI 仓库变量见 [运行与运维基线](07-运行与运维基线.md) §2.1。

配置就绪后，全部门禁或单步检查使用：

```bash
tools/check.sh --full
tools/check.sh contract
```

修改本目录任何文档后至少运行同一检查容器的文档快路径：

```bash
tools/check-docs.sh            # 默认读取 ../.design
tools/check-docs.sh /path/to/.design
```

它覆盖禁用词、相对链接、设计 ID 闭合、覆盖矩阵三项计数、`V-SCN-*` 覆盖与 markdownlint，失败以非零码退出。

## 本地环境入口

非密配置只维护 `deploy/local/.env` 一份，入库模板为 [`.env.example`](deploy/local/.env.example)。展示名、主机名、端口、realm 与数据库名分别只填一次；保留样例中的派生表达式，组件环境、回调、邀请链接和受控数据库连接串由这些输入生成，不在各组件另填副本。密钥仍留在受控文件与 OpenBao，不向前端公开整份配置。现有环境的字段迁移与适用范围见 [运行与运维基线](07-运行与运维基线.md) §2。

现有 Compose 本地拓扑由 [`deploy/local/init-local.sh`](deploy/local/init-local.sh) 统一补齐数据库迁移、密钥与上游初始化、Core/Worker 启动、首位管理员的业务 Tenant，以及 Platform Catalog Tenant 的首位平台管理员。首次执行前填写 [`deploy/local/.env.example`](deploy/local/.env.example)，其中 `BOOTSTRAP_USER` 是业务 Tenant 首位管理员，`PLATFORM_ADMIN_USER` 是 Catalog 的平台管理员（发起 Tenant 暂停与恢复，`DD-96`），`VERIFY_USER` 专供临时 Tenant 走查，三者两两不同；准备受 CPU/内存 cgroup 限额约束的 `BUILDX_BUILDER` 和固定版本镜像。重复执行不清数据；需要不可恢复地重建这个测试环境时，显式加 `--fresh --confirm-delete=platform-local`，绝不用于旧 K8S。完整前提、删除范围和验证边界见 [运行与运维基线](07-运行与运维基线.md) §2。

## 工具链

项目工具链只来自检查与发布镜像，不另装宿主 SDK。Trellis 与 GitNexus 是协作、源码检索工具，不是项目编译入口；使用当前环境已核验的 runner，不能把它们的工具缓存作为项目源码或发布输入。

本目录的工作流工具状态（`.trellis/` 下除 `spec/` 外的内容、`.claude/`、`.codex/`、`.agents/`）不进版本库，新克隆后用已有 Trellis 工具初始化：

```bash
trellis init --claude --codex -u "<你的名字>" --workflow native
```

固定使用 `native` workflow。

`.trellis/spec/` 是唯一入库的 Trellis 目录。它是从**已有代码**提炼的编码约定知识库（函数签名、字段、边界行为），提炼时机在任务完成之后，用于后续会话自动注入上下文；它不是先于实现的规格，与 `.design` 的产品合同是两回事。入库的原因是这些约定属于工程资产，必须随仓库分发并进入 code review，而不是只存在于某台机器上。

其中 [backend/quality-guidelines.md](.trellis/spec/backend/quality-guidelines.md) 与 [frontend/quality-guidelines.md](.trellis/spec/frontend/quality-guidelines.md) 已记录真实工程约定，其余模板不能据此称为已补齐。`guides/` 由 Trellis 模板提供，升级产生的差异按普通改动评审，不把自动稿覆盖当作知识库更新完成。进入 `.design` 或本目录实施文档的结论以那两处为准，`spec/` 只记录代码层面的约定，不得在其中重新定义产品语义或能力状态。

代码检索以 `rg`、源码、契约和完整 diff 为依据，GitNexus 按需辅助，不阻塞开发、提交或 push，也不在每次小改动后刷新。使用时的源码范围与证据边界见 [AGENTS.md](AGENTS.md)「代码检索与影响复核」。当前独立 Git 不依赖父仓库；根核对失败时停止工程操作，不能把外层索引或缓存安装树当作本工程的完整审查证据。

## 历史实施与验证记录

本节按发生顺序保留当时的版本、失败、跳过与验收边界；最新部署与剩余缺口以上方带时间的状态摘要为准，不把历史措辞中的“当前”外推到新版本。

**Stage 0 历史基线验收**：当时十项退出条件记录为达成，`tools/check.sh --full` 退出码 0（21 项通过、2 项无适用对象）。这是基线时点的结果，不是当前工作树、全部业务能力或生产发布的验收结论。

已就位：四门语言的契约生成与 round-trip（Rust/Go/TypeScript/Dart）、Core 的六个模块 schema 与可回滚迁移、Temporal Worker 的 history replay 回归、四层 network 的本地拓扑、追溯记录与能力注册表的校验器、上游 baseline manifest 校验、发布单元与 SBOM/provenance、阶段收口与 CI 共用的检查入口。

当时两项 SKIP 是无适用对象而非遗漏：Stage 0 尚无用户可达能力的追溯记录，runbook 当时按 `07-运行与运维基线.md` §6 的适用性判定。当前已有生产路径的追溯记录；现阶段是否通过须读取实际记录与本轮门禁，不能继续沿用 Stage 0 的零记录判断。

**Stage 2 收口与 Stage 3 实现并行，尚未生产就绪**：Stage 1 的身份与协作主链已有实现，但不能宣称其退出门禁全部闭合。`DD-70/72` 要求的 `tenants/<tenant_id>` OpenBao namespace、独立 KV/AppRole/policy/token 已在本地真实生命周期与跨 Tenant 拒绝探针中验证。2026-10-01 的归位适用性查询实查 4 个 ACTIVE SERVER binding、0 个遗留 locator、0 条归位记录；旧 `platform/kv` 历史形态恢复在本次全新环境无适用对象，不作为当前开发阻断，也不把五项历史归位 FAIL 改为 PASS，见 [SecretRef 归位核验](core/verify/secret-ref-rehome.md)。同日已在当时运行的 Core `69aaf4a2…` 上经真实邀请、Temporal 审批与成员撤权完成未来删除时间版本的原生 delete/destroy、意图退休与 403 拒绝链；该 HUMAN 正向链不覆盖其他故障或整个生命周期，见 [SecretRef 核验](core/verify/secret-ref.md)。

Stage 2 的 Governed Action、审批、角色、邀请及任务只读投影已有实现；本人任务取消与重跑已有 Core、Temporal、Worker 联调和历史 Web 走查。共用审批面板的刷新与 UNKNOWN 控制修正已构建到 Web `970e1743…` 并部署，持久 Compose pin 与官方产物登记同步。真实现有用户登录成功、Tasks/Approvals 均 200/0 条；原治理测试 14 项不直接覆盖两处修复，当前无真实适用审批对象，两处业务场景不记 PASS。镜像构建报告 3 项 npm 漏洞（2 moderate、1 high）尚无处置验收，详见 [审批面板核验](core/verify/task-view-enum-fail-closed.md)；不以新 Web 已运行代替 Stage 2 总验收。

Stage 3 的 Tenant 删除冻结、平台子流程、不可逆派发与 provider 对账已接入代码、共享契约和 Worker；Core 编译、clippy、四侧生成与隔离库 SQLx 校验通过。已准入后、不可逆派发前的清单、密钥或处理器重验失效现同事务保存 `UNKNOWN` 与审计，保留原取消分界；镜像静态与既有单元检查退出 0，但这些单元检查未执行新增事务分支。原生共享 CAS 保留量证据和真实业务验收仍未闭合，删除公开 routes/actions/workflow_kinds 为空，详见 [Tenant 删除实现记录](core/verify/tenant-deletion.md)。Desktop/Mobile 原生会话端到端证据、Stage 2 其余能力、Stage 3–5 的退出门禁、平台一期收口与三个能力扩展未交付。当前优先收口 Web，互不依赖的既定实现并行推进；以 [纵向交付路线](02-纵向交付路线.md) §1.1、§3–4 的端规则和退出门禁逐项验收，不得把编译、Web 通过或源代码写入当作三端和全阶段通过。

Stage 4 的 `SS-OMT-AUTH` 已将固定版本 OpenMeter 完整源码导入 `metering/`，在原生 v1/v3 Router hook 接入 Core-only service credential，并同步上游 Wire 生成接线。2026-10-01 完整 4519 文件输入的正式构建、六个 binary 的 `xx-verify`、registry push 与官方来源登记实际退出 0，artifact digest 为 `sha256:9881721605755f4f0ef95e340f2e8c43f05208d3d33876e3734f61d746ea6783`。同一固定镜像已部署到正式 Compose 的独立原生 Kafka、ClickHouse、PostgreSQL 拓扑，四服务 healthy、v1/v3 认证 10/10，缺失、错误、重复凭据及未认证 OPTIONS 均 401，有效凭据 200。随后 Core Customer 客户端、创建前持久化 DISPATCH 的 Tenant 生命周期消费者、六字段外部引用 projection 和逻辑退役处理器已写入；开发镜像 `03c24669…` 构建与全新 wrapping 启动均退出 0，healthz 200、Core/native namespace 一致，业务库仅向前迁移至 37 条，其余 41 个容器未变。现有三个 Tenant 全为 ACTIVE、PROVISIONING 与 OpenMeter binding 均为 0，客户创建链无现存适用对象，映射/退役端到端与 SQLx prepare 仍未验收；不改状态或造对象充当通过。Quota、CloudEvent、usage commit 与账单消费者未交付，额度与账单入口未开放；该 Core 是冻结脏工作树开发构建，不是 clean commit 正式 release，registry push 也不是 Git push。详情见 [计量认证实现记录](metering/fork/verify/core-authentication.md)，不据此宣布 Stage 4 或生产门禁通过。

同日下一批已接入原生 sink worker 与独立持久 Redis，API/sink 的双侧去重共享同一份原生 YAML、使用两个不同逻辑库，初始化入口也启动真实 sink。两个原生 `--validate` 最终退出 0；正式三个目标服务部署退出 0、healthy，认证重新通过 10/10，原有三个计量后端及其余 41 个基线容器未变。集中 `tools/check.sh --full` 退出 0，但数据库演练与 SDK 内实际 `.env` 预检明确 SKIP；真实部署输入另由原预检和原生 parser 核验。meter/customer 均为空，不声称事件去重、commit、Quota 或结算端到端通过；全部失败与还原、原生崩溃窗口和当前未提交状态见上述核验记录。

2026-10-01 Web/Desktop 共源呈现增量：原 Desktop 导航、内容面、主题与 typography 已直接进入 `client-kit`；15 个纯正文块和正文间距两端共用，保留 Web 的 BFF 媒体与原生传输边界。共享包 88 项、Web 14 项既有检查通过，Web 类型、格式、构建与 npm audit 通过，当前 audit 为 0；这不修改历史 `970e1743…` 镜像的漏洞记录。事后复核检出的有序列表起始编号和表格列对齐丢失已在同一共享实现修正，实际 SSR 通过。最终 Web 镜像 `e1938f3c…` 已登记、pin、部署且 healthy；现有用户的真实浏览器复验确认左侧五项导航、Enter 操作和跟随系统主题切换。同源 Desktop deb `426a2a29…` 正式打包通过，源码摘要前后一致，未安装运行。完整结果见 [Web 面核验](web-client/fork/verify/web-surface.md)。解析器、缓存、编辑器与宿主特化仍有差异，不宣称整体 UI 共享比例或 Stage 总验收。整批 `check.sh --full` 退出 1，Core 检查、发布摘要及上游缓存权限失败分别收口；registry push 不代表 Git 提交与 push。

同日 Relay 来源校准已由既有正式构建入口完成：共用 workspace 锁文件仍属于 Relay 的真实输入，未删减输入或手改源码摘要。构建、registry push 与官方登记退出 0，源码摘要前后一致，产物 `3700b743…` 已同步两处 Compose 指针和两份既有追溯记录；随后仅替换 `buzz-relay`，新容器 healthy，其余 21 个现有 Compose 容器的 ID、镜像与启动时间均未改变。此处不是新业务验收，也未将历史全量门禁退出 1、迁移跳过或 Mobile 未签名改记为通过；完整来源、部署与日志见 [Web 面核验](web-client/fork/verify/web-surface.md)。

2026-10-02 实现增量：Core 的 `CHECK` 准入现消费原生 Customer entitlement/credit，NONE 动作不查询计量；确认或审批满足后查询，额度不足拒绝、不可查证不伪装为成功。新增 CHECK 数据约束、共用原因码与四侧生成已通过原检查，集中 lint、四语言既有验证、契约兼容、文档与追溯均退出 0。全新隔离 PostgreSQL 的迁移前进、回退、再前进及 SQLx 离线核对也已退出 0，38 条迁移、39 个枚举约束成立；没有创建测试 Tenant 或业务定义。STRICT 和 CHECK 正向派发仍关闭，没有登记新的业务产出方或额度账本，真实额度拒绝链尚未验收（ADR-14）。Web/Desktop 的图片尺寸解析也已收为同一份既有实现，两端类型检查、Desktop 78 项与 Web 14 项既有检查通过。两项仍为未提交的源码增量，尚未构建部署，不提高 Stage 完成状态；详见上述计量与 Web 核验记录。

同日并行增量：Worker 的 owner 审批不再恒定返回不满足，按冻结 owner 与逐项角色要求共同判定；未知枚举拒绝，非 NONE 行为由 Temporal GetVersion 隔离。不可变 SDK 中的格式、静态检查、既有 workflows 与 replay 均退出 0；九份已有 Approval history 都是 NONE，不是新 owner 正向链验收，见 [owner 审批实现记录](worker/verify/approval-owner.md)。该 Worker 源码已随下述 `e4c544fd…` 提交并 push，尚未据此构建部署。Desktop 原表格 DOM 也已直接进入共用 `MessageTable`，宿主保留原 hook/ref，Web 从已有 Markdown 组件映射消费；三处类型检查、Desktop 66 项、Web 5 项既有检查和两实际消费者的现有表格 SSR 均通过。表格增量仍未提交或构建部署，不代表 Win11、浏览器业务或 Stage 5 退出门禁通过。

原生计量源码已单独提交为 `c478169a…`，四个既有产物的三份来源清单已提交为 `6d2bb152…`。两次普通 push 被原全量门禁拒绝的失败记录保留：首次是来源摘要未关联，第二次是相同产物的 Compose 与能力追溯引用仍指向旧摘要。随后 `e4c544fdb63d5e54fe775d58e684249166c89543` 收口 Worker owner 审批和对应既有来源引用；共享 pre-push 对该提交树执行 `tools/check.sh --full`，实际退出 0，普通 push 成功，远端 main 已从 `14fa7833…` 更新到 `e4c544fd…`。上述三提交不包含当前工作区的 Quota、AgentDefinition 和后续 UI 增量。全量检查的真实数据库演练未提供 `DATABASE_URL`、导出树部署配置预检未提供 `.env`，均明确 SKIP；内置秘密扫描通过但未安装 gitleaks，Mobile release 签名仍阻断。不把已 push 计为已部署、完整业务验收或 Stage 完成，原始失败与最终成功输出见上述计量实现记录。

同日 AgentDefinition 增量已复用既有 Resource、ActionExecution、SpiceDB、审批与 Tenant 生命周期，实现定义创建、更新、读取及 owner 转移；没有新增 Agent 注册权威、AgentVersion、安装或运行入口。事后复核确认的终态证据缺失、副作用后的结果不明回滚、未知权限枚举误判三处问题已修正。镜像内 workspace clippy 退出 0，既有检查 106 项通过、3 项忽略；其中依赖数据库而提前返回的检查不算新增业务验收。独立全新 PostgreSQL 实际完成 39 条迁移的前进、回退与再前进、SQLx 离线核对及 40 个枚举约束核对；四侧生成、90 个 schema 与 3 份历史契约兼容、18 条追溯及完整文档门禁均退出 0。Resource 与 AgentDefinition 行数均为 0，未造对象宣称正向通过，源码尚未提交或部署，详情见 [AgentDefinition 实现记录](core/verify/agent-definition.md)。

后续同日纠偏已将 AgentDefinition 的八字段 `NATIVE_INTERNAL/NATIVE` 增量合同登记为真实迁移输入，写入前的既有登记查询拒绝缺少该合同的类型。原隔离库迁移往返、SQLx、40 项命名约束及 fmt/clippy 实际通过；空合同写入被约束拒绝，事务内更改合同角色后准入谓词为 false，还原后为 true。Web/Desktop 代码块正文、高亮与 CSS 也已直接复用原 Desktop 实现，宿主保留复制操作与 resolved theme；三项类型检查、Desktop 66 项、Web 5 项既有检查和两真实 Markdown 消费者的 SSR 通过。两刀仍未提交或部署，不把源码/窄验证算作新浏览器业务、Win11 或 Stage 退出验收，详见上述 AgentDefinition 记录及 [Web 面核验](web-client/fork/verify/web-surface.md)。

随后 UI 的独立候选仅选择既有共享呈现与实际来源引用，不混入上述治理增量。原正式构建入口已实际退出 0，产出 Web 镜像 `ad82d6e6…` 和 Linux Desktop deb `d28520f7…`；source/artifact 由原 helper 登记，Relay 原同源 `3700b743…` 按 1118 个实际输入与 registry 原 manifest 证据复用，不重复构建。私有候选断开 Web 的共享 pre 时既有 SSR 断言确实失败，按原字节还原后通过；没有新增持久测试或夹具。记录时仍未部署该 Web 镜像，Linux 包不替代 Win11 包，也不据此宣布整体 UI 99%一致或 Stage 退出。精确来源、失败与边界见 [Web 面核验](web-client/fork/verify/web-surface.md) 末节。

### 2026-10-02 前一批阶段收口记录

上述共享呈现已提交并普通 push 为 `8ec78ed43e4a3e1fdc3f3243719cb7c1673eded6`，本地与远端 main 一致。Web `ad82d6e6…` 已限定部署且 healthy，公共入口匿名请求为 302；此版本部署后尚无新的登录业务走查，不把入口可访问当作全量业务验收。普通 push 的本地全量检查钩子已取消，阶段验证与 CI 仍保留原入口；取消钩子的源码与文档尚未提交。

后续集成候选只选择 AgentDefinition、Customer、SecretRef 退役、Tenant 删除及其真实契约消费，不混入独立的 Quota CHECK 与 NIP-11 对账增量。该候选在加入最后的审批资格修正之前，镜像内 clippy、37 条空库迁移往返、SQLx 离线核对与 40 个命名约束均已通过；没有创建业务对象。Core/Worker 开发镜像构建均退出 0，但没有 commit provenance、正式 release 或部署，且前一 Core 镜像不覆盖随后修改的审批资格代码。独立设计提交 `22b8beada030fb49df82c236ab69007a33d7701b` 已发布到同一远端的 `design-authority`，候选 CI pin 与覆盖映射随实施批单独收口。

AgentDefinition 与 Tenant 删除公开入口仍关闭；AgentVersion、Installation、Codex turn、模型与工具用量、记忆、自动化及三端完整验收仍未交付。此前各段的空库、构建与局部检查结果不改变这一边界；可选业务能力不作为平台核心发布前提。最新源码、产物、失败与未覆盖范围分别见 [AgentDefinition 记录](core/verify/agent-definition.md)、[Tenant 删除记录](core/verify/tenant-deletion.md) 和 [Web 面记录](web-client/fork/verify/web-surface.md)。

### 2026-10-03 Runtime 与打包候选集中验证回执

以 `c242384a` 为底，仅选入 Runtime 四路径、Win11 来源与记录四路径、Core 打包三路径和一份 Runtime 证据，固定树为 `e998d4212c936e1cbf42477fe7bf24859c3776cf`。00:19:22 至 00:23:48 UTC 原 `tools/check.sh --full` 实际退出 0；原件为 `/volumes/data/kailo/tmp/codex-runtime-win-packaging-full-20261003.EQx6D6/full.log`，SHA-256 `ee5552cf46bbc9d244985eff1237704331ba6d4100a7fddd8495ed7b47adedd2`。终态 12 路径和四侧生成物未变，生成合同仍与底版一致。

Core 原打包遗漏编译期实际消费的 `contracts/api/action_submission.schema.json`：现有 `.dockerignore`、`core/Dockerfile` 和 `tools/release.sh` 已补齐同一文件的上下文、COPY 与归档输入，不修改合同正文或治理行为。Runtime 五项配置仍走原 `start-core.sh`，全缺省关闭、半份和畸形拒绝；没有生成默认 profile 或宣称 Installation ACTIVE。四步影响结论及原失败见 [Agent 记录](core/verify/agent-definition.md)。

本次原库 50 条迁移、末条回退再前进、SQLx、44 枚举约束和原范围验证通过；实际部署 `.env` 预检仍 SKIP，三项显式演练 ignored，未安装 gitleaks。Win11 unsigned 包仍未安装运行或业务验收，Mobile 签名仍阻断。本回执是私有候选检查，不是 release、提交、部署或业务验收；本节追加后仅运行原文档快路径，不重复 full。
