# 2026-10-09 Web 9edf 页面局部实拍

## 版本与操作边界

2026-10-09 12:23–12:35 UTC，沿已正常 SSO 的独立 `header-restoration` 会话，用已安装 `playwright-cli` 导航、截图，并逐张用图片查看器打开复核。入口是实际部署的 `/app/`。浏览器正常刷新后读回 `platform-build-info.json`：

- 固定源码：`9edf456a172200fae22adc9ab15e975109ab26b8`。
- Web 镜像：`sha256:bf7f0b6925730f4615565c8c2a61f40c515bfb4a40cd3662a6518f21abb4d0f2`。
- 浏览器 buildId：`sha256:c3763fade6473c689a81b44070488c678e4c492fa84757909df16da73efe317a`，`reportedAt=2026-10-09T11:29:59.929Z`。

第一次同源版本读取失败，正常 reload 后读取成功；没有注入 Cookie、替换 API、重置身份或关闭安全限制。仅导航已有消息、线程、动态与工作流记录；没有发送消息、运行/保存工作流、创建项目/频道、改变角色或触发 Agent。四个原 Experiments 偏好起点均关闭；仅通过原 UI 临时开启查看入口，最后恢复关闭并正常刷新，实读四个 `aria-checked` 均为 `false`。语言从中文切英文再恢复中文，刷新后 `zh-CN` radio 实读 `checked=true`；其余外观偏好未修改。最终 `playwright-cli console error` 输出 `Total messages: 0 (Errors: 0, Warnings: 0)`。

此批 29 张原件全部打开：27 张稳定局部状态、1 张正常点击失败后的状态、1 张 reload 中的过渡状态。29 不是页面完整验收数；未部署的录音、音频播放器与后续 Inbox 修复不在此镜像，Web 也不是 Windows/Mobile 验收。

正常打开原 Inbox 行沿现有自动读标记消费者，画面 badge 从 10 变为 9；没有直接调用写 API 或绕过 CAS，也没有将正常阅读引起的读状态变化隐瞒为“所有业务状态未变”。以上还原仅指语言与四个原客户端 Experiments 偏好。

## 实际结果与固定原版对照

原版依据是 Buzz `779af8886caae1317b4de962082429867ab61503` 下的完整模块，而非相似页面：

- `desktop/src/features/home/ui/InboxListPane.tsx::renderItem`、`InboxDetailPane.tsx::InboxDetailPane`：真实线程和 DM 两语言详情、头像、标题与原 Composer 可见；点击真实正文后 DM 详情成功，标题可导航到真实 DM。线程标题实际打开授权频道、根消息与回复深链。未测试发送/编辑/删除/全部筛选。
- `InboxListPane.tsx::renderItem` 原 unread 是独立 `span`，与 timestamp 处于 `gap-1.5` flex 容器；线上 Web 传入两个相邻字符串，实拍出现 `2 unread4 days ago` / `2 条未读4 天前`。这是真实共享迁移遗漏，不是已授权治理差异；源码纠正及后置检查单独交付，本批图保留修改前事实。
- 原 row 的全行键盘按钮在 `z-0`，真实指针内容层在 `z-10`。CLI 直接 click `Open inbox item from seam-verifier` 正常超时（5000 ms），未 force；固定原模块也采用同一双层委托，不能仅据该 CLI 命中失败擅自重新设计原行。之后点击实际可见正文正常打开，失败图与成功图分别保留。
- `desktop/src/features/home/ui/HomeView.tsx`、`desktop/src/features/profile/ui/UserProfilePanelFrame.tsx::UserProfilePanelFrame` 的真实作者资料消费者：个人资料标题与关闭 icon 未出现旧遮挡；实际头像可见。资料正文无名称的状态未伪造为已填名或 presence。
- 原 Projects 的分区/布局空态、原 Pulse 两条历史动态/回复在两语言可见。项目非空卡片、Git 内容与写操作没有数据/没有执行，不验收。
- 原 Workflows 在频道恢复验收工作区为空；实际切换至 Kailo 后出现两张已有记录。创建弹层可打开并以 Escape 正常关闭；原表单当前明确显示 `No active executor on this page`，不能称创建/运行可用，也未验收完整步骤和运行轨迹。
- 现有 7 个设置入口实拍：Profile、Appearance、Notifications、Keyboard shortcuts、Custom emoji、Invitations、Experiments。Notifications 明确显示浏览器权限 blocked，没有授权覆盖/浏览器 flag。快捷键图只覆盖当前可见部分，不推定下方分区缺失。Custom emoji 仅空态，未上传/保存。
- `desktop/src/features/profile/useAvatarUpload.ts::handleFileChange` / `uploadFile` 和原 `ProfileAvatarEditor.tsx::handleFiles` 选文件会立即上传；本次仅正常展开、关闭图片选择器，没有选文件/拖图/上传/保存，没有声称无图账号完成裁剪。原实际行为决定验收边界，不拦路由或修改 callback 伪造“选图但不上传”。
- `desktop/src/features/community-members/ui/CommunityMembersSettingsCard.tsx::CommunityMembersSettingsCard` / `RelayMemberRow` 与 `CommunityInviteDialog.tsx::CommunityInviteDialog`：当前 Settings Invitations 仍是重复描述与治理邀请简表，不等原成员列表/搜索/角色/加入日期/直接邀请/链接弹窗。现存 `TenantInvitations` 消费 DD-83 审批兑换；Workspace member 目录不能冒充完整社区 roster，缺可信 owner/加入日期/原 direct-add 消费者就不生成假动作。

原样保留、共享迁移、逐项授权接缝、缺失需恢复仍须逐处证实。本轮没有重新扫描全量队列；这些局部图不能将历史 full-diff 队列改称全量页面一致。未覆盖全部路由/所有状态、非空 Projects、完整 Agent 配置与执行、全部 Workflow 生命周期、外部组件页面、手机和 Windows 安装包。

## 可复核命令

使用 `rtk proxy playwright-cli -s=header-restoration`，调用正常 `reload`、`click`、`press Escape`、`snapshot`、`screenshot --filename=<原件路径>`、只读 `eval` 与 `console error`。典型真实消费者操作：

```text
click getByTestId('feature-toggle-workflows') / projects / pulse / forum
click getByTestId('settings-back-to-app')
click getByTestId('sidebar-platform-projects') / pulse / workflows
click getByText('KAILO-DM-20261006-1555：seam-verifier 已收到，并通过同一私聊回复。', { exact: true })
click getByTestId('home-inbox-context-title')
click getByTestId('profile-avatar-edit')
click getByTestId('profile-avatar-done')
click getByRole('radio', { name: '简体中文', exact: true })
```

`Create workflow` 精确英文按钮查找没有命中；真实按钮是原 `new-workflow-card`（Create automation），正常打开后未保存/运行。最后正常 reload 的过渡图没有覆盖成成功图，重新点击原 Experiments 导航后另存稳定状态。所有截图操作命令退出码 0，但 CLI 可在退出 0 中报告点击错误，所以以上真实错误不能据退出码归为成功。

## 原件与 SHA256

除第一张外，目录均为 `/volumes/data/kailo/tmp/buzz9edf-pages-20261009.hprSJV/`；第一张为 `/volumes/data/kailo/tmp/kailo-9edf-settings-profile-20261009-1224.png`。以下每张均实际打开；哈希由真实原件 `sha256sum` 读回。

| 原件 | SHA256 |
| --- | --- |
| kailo-9edf-settings-profile-20261009-1224.png | ee1ddb31444ea09b0516d9c500c7e5633a03d8a58fa15ce5a601add17efe3ef7 |
| settings-appearance-zh.png | df6b9b4f43a5a883e1f846e7759d03b353a950a84107affad74cfcc7d51fe1f2 |
| settings-appearance-en.png | 9f6b203ba973c7573137dcf28de6e2f630684ecd12ed8e480994242f431e9492 |
| settings-shortcuts-en.png | b283c3aed22d9e641872de24a5dfb1676c902779c5ac7f54edeb1ea0244d133e |
| settings-notifications-en.png | b68f9231e0f516ee71aa6f12a739ce5734733d1bdbca0f722b8515771cf3e79d |
| settings-experiments-en-before.png | fa81607d90cb7499b367b77e9d3a6b71f6f1a31ac280a81f87483eba8375c0bf |
| channel-en-features-on.png | 475c45dd90a09bd9680dfe22d1fb736a2332d02c02758c2889703a5c5171d5ae |
| inbox-en-thread-detail.png | 20e4f3b868ed08cbecb957880ef71fc7565910c79f24644ec91dc330e9f0beb6 |
| inbox-en-dm-detail.png（点击失败后，仍为线程） | ce639504669b001da1d70718467d01f9c937bfb1d208c9d099cd403d770c5acc |
| projects-en.png | 4f05b53235967123e34ded259dbd50f2a18071a19f515a1747e08c67f5f6c67d |
| pulse-en.png | e0f8ef8b13bbaa3a2e1064510e67eeadc928d626192d96337d710cbbe418c4e9 |
| workflows-en.png | 2970d0dc3fc463680141e185fb265e5c03690270b719b108051720b35a036f2f |
| workflow-create-en-noexecutor.png | 29023e4c968043e618af6b812d6f8706994c47ef926b4c7606963aed7357a7b1 |
| inbox-en-dm-visible-row.png | a331aa78e0db509ca2b7e783602ed815ea66fc5e9b45213658e1697a6708f1c6 |
| channel-en-thread-route.png | 3a6e7535b027fbdf139732327f985b4053610219981d436a27ee1b101b156aa5 |
| profile-menu-en.png | 4d37a295f865415358efc385a0163bf83da2a73b83a4473affd9d5c47bc6219e |
| settings-custom-emoji-en.png | 1f11b52cfc4287ffd78f52b33c71efb940d22df5c0e305e334c49490e8de670e |
| settings-invitations-en.png | 694c6ad4b3701d57677be7c4baebe9f3ae283e5f7c027edd745320fc4807b313 |
| projects-zh.png | fddc1f81f20fd63b8d48f16acf34d360861f184b130adacc4f9c11e155f71cb4 |
| pulse-zh.png | a8caab3dec87692f2a0fa27e26ac1ce02dadf9d4902afd04dce1f5eb11df1e59 |
| workflows-zh.png | 9c62c84b94fe82f57a7768504298abc30c1da725452f599f0370beab8063516d |
| inbox-dm-zh.png | 6cd55a877da53573368b12974d90140334eaf7e5b529529272af4754a0de3136 |
| search-zh.png | db77d47d973f9235123809a5dc0960cb6b67dc0afbcd9400626cdfa630a49166 |
| inbox-author-profile-zh.png | 9ad58fbd590b55ffb01d9d7d9de429d6ca6c7a8cac3439d7463b5c425c6451b3 |
| dm-main-zh.png | b41f9d8eb2ae94fa366579b44d8ad7ee8558f93a42fd8e85c4b3ee53077ef30b |
| avatar-selector-zh-no-file.png | 222fb642fc59c47e653de60e29c99d617842baa432d4af35afa84bbb8114f440 |
| settings-experiments-zh-restored.png（reload 过渡，非完成态） | 43854d297980288119499e79f7a414159e51bb410950389104857e69081a0f69 |
| settings-experiments-zh-restored-stable.png | 333ab3eee6e303e3c5fede71e08bf661f4a346fdd18c8720260546402a89cc61 |
| settings-appearance-zh-restored.png | b4af9cb78b00050af2bcca30429e63a4b7f46659a1642d2b0e99fc403cedad50 |

## 实拍后的 Inbox 源码纠偏（未部署）

权威：固定 `779af8886caae1317b4de962082429867ab61503:desktop/src/features/home/ui/InboxListPane.tsx::InboxListPane/renderItem` 的 unread 独立 `span` 与 `gap-1.5`；用户授权中英词条保持，不发明新布局。影响面已 `rg` 找全：Web `InboxPane.tsx` 传译文字符串、Native `InboxListPane.tsx` 原先自包 span。共享 `InboxRow` 现在独占原 `home-inbox-unread-count` span，Native 移除重复包裹，两个真实宿主同一页面子项，不留双份呈现。

副作用/异常：仅 JSX flex 子项归属，现有 `unreadCount > 1` 门控、dot、时间、原可见正文委托、profile 触发及读标记 CAS 完全不变。不写新状态/实体，不复制正文，不改变六类错误/UNKNOWN/撤权身份 fencing。无 unread 时仍无 count 子项；20 项原目标也复核相邻聚合、异 scope、旧身份晚到与未知读回执消费者。数据库/契约/四语言格式没有变更，不新增轮换/配额/工作流权威。

3 个清洁 owned 路径，源/检查 `+35/-6`（不是恢复完成率）：

| 路径 | SHA256 |
| --- | --- |
| client-kit/ts/platform/src/react/inbox-row.tsx | 056d5f16a7bcee6aff7b34425b1bc79a67d4fd5e6dc52198adf4d566c09e0d41 |
| client-kit/ts/platform/test/inbox.test.tsx | 85d08b840a9ed399fcdbce97a0b65559b16da0037c49db9b9d2a47732ee4979a |
| collaboration/desktop/src/features/home/ui/InboxListPane.tsx | 07a1deac03fe1eb4645afb90c30e6ec6681f028e26101f9efab44f6ef3f014ab |

实际原 SDK `kailo-agent-receipt-xvkujx` 复用现有候选/依赖，执行前 inspect/top/cgroup：4 CPU、8 GiB、仅 sleep，host available 30.9 GB / memory PSI 0；Node heap 3072 MiB、threads 1 worker。旧 `oom=2/oom_kill=2` 基线未增加。未安装/新镜像/Cargo/Go/Dart生成/full/bundle。原共享直依赖 6 文件 cmp0；最终 3 正式输入与候选、两宿主安装目录 shared row 全 cmp0。

日志原件目录 `/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/profile-settings-ortsoo.DRR20F/inbox-unread-gap-20261009.OiPie5/`，原始命令为 `positive-command.txt` / `negative-command.txt` / `restored-command.txt`，结果：

- `52082` 正向 exit 0：原 `node node_modules/vitest/vitest.mjs run test/inbox.test.tsx --pool=threads --maxWorkers=1`，20/20；shared/Web/Native 原 `tsc --noEmit` 分别 0（`positive.log`、`shared-types.log`、`web-types.log`、`native-types.log`）。
- 正式实现后，私有生产 `InboxRow` 精确撤掉独立 span；`88302` 同原目标 exit 1，2 失败/18 通过，真实缺少 count 子项产生 `Cannot read properties of null (reading 'textContent')`（`negative.log`）。不是编译/worker/环境失败，不把其他失败冒充命中。
- 私有生产字节 apply_patch 还原、formal/candidate cmp0；`48775` 同原目标 exit 0，20/20（`restored.log`）。没有增大超时/删除检查或篡改业务 API。

以上是源码/原专项检查点；本报告 9edf 实拍保留旧字符串粘连，不声称新修复已有浏览器视觉验收。邀请原完整模块仍是上节已证缺项，此批没有以删除重复标题冒充原系统恢复。完整全量差异分类和生产门禁没有因此局部检查变绿；阶段提交/后续集中部署仍由主代理执行。
