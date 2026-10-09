# 2026-10-09 a8c1 设置／成员／频道菜单只读实拍

## 运行版本与操作边界

- 实拍时间：2026-10-09 02:24–02:31 UTC；已安装 `/usr/local/bin/playwright-cli -s=header-restoration`，普通 seam-verifier 身份，1920×1080。
- 实际线上源码 `a8c1cc8cc9a61334acf4bb4ed776a16992a37d35`，不是本轮尚未发布的 Dialog 依赖纠正。
- 开始前会话已过期，页面内 build-info fetch 被重定向到 IdP 并触发 CSP connect-src 拒绝；没有输出口令或在报告复制 OIDC state/nonce。随后正常 top-level `goto http://192.168.0.193:58090/app/`，现有合法 IdP SSO 自动续会话，无凭据输入、Cookie 注入、重置或浏览器安全 flag。
- 续会话后及结束时真实 GET `/app/platform-build-info.json` 均为 200；buildId `sha256:0269a07631509d28ade623f38e4dac6fa229e363f153c92fb10780bf4b770127`，reportedAt `2026-10-09T01:48:14.103Z`。发布回执对应 image `sha256:871dc5b0719889d6e4cee4eab17540015c48f58385ce86910680d7e80de00ac1`。
- 只正常点击、悬停、切换已有页面/标签、打开菜单与头像编辑器。未填写资料/邀请、上传、保存、发送消息、创建账号/频道、选择角色动作、修改偏好或触发 Agent。
- 生成 21 个截图文件、20 个不同 SHA256；“已加入”复拍与首次同字节，不重复计为不同状态。全部逐张用图片工具打开复核。
- 本轮不运行 SDK、构建、生成、全检或全树 diff；不修改冻结 5 个输入。仅新增本回执，交主代理集中文档检查与提交。

## 实际页面结果与固定官方对照

源码对照基准全部为 Buzz `779af8886caae1317b4de962082429867ab61503`。这是实际运行图加固定源码结构/调用对照，不是运行原版同分辨率截图的逐像素比对，也不证明整文件/整页面一致。

| 本轮状态 | 固定官方路径／符号 | 实际结果与边界 |
| --- | --- | --- |
| 频道头部、已有消息 | `desktop/src/features/channels/ui/ChannelScreenHeader.tsx::ChannelScreenHeader` | 已有验收频道正常呈现标题/图标与两图消息；当前 Web `PlatformApp.tsx` 只接 `ChatHeader` 标题、描述、图标及复制。原 `ChannelMembersBar`、管理/成员切换、Buzz Term 等完整原消费者未接齐，不称完整头部还原；截图文件名含 members 不代表已呈现成员栏。 |
| 频道分区更多／排序 | `desktop/src/features/sidebar/ui/CustomChannelSection.tsx::SectionActionsMenu` | 正常打开“排序”，显示“最近活动／名称”，当前名称已选；未选择/更改排序。原自定义分区等其他消费者未因此验收。 |
| 频道右键／复制子菜单 | `desktop/src/features/sidebar/ui/ChannelContextMenu.tsx::ChannelContextMenuItems/CopyChannelSubmenu` | 实际有复制名称/ID、标为未读、静音、收藏；只打开，不执行。原移动分区、离开、归档、删除等消费者仍不在当前 Web 菜单，不能以隐藏入口证明原目标已交付。 |
| 频道浏览全部／已加入／归档 | `desktop/src/features/channels/ui/ChannelBrowserDialog.tsx::ChannelBrowserDialog` | 全部及已加入显示授权目录返回的两个真实公开频道，归档为真实空态；原搜索/标签/创建行布局可见。未创建/加入/退出/归档，私有频道不由公开浏览目录推断缺失。 |
| 成员非空列表 | `desktop/src/features/community-members/ui/CommunityMembersSettingsCard.tsx::RelayMemberRow/HoverMemberIdentity` | 两个真实成员，seam-verifier 头像加载；目录名/公钥 hover 与实际管理菜单可见。平台 Principal/多协议键及组织/频道角色不是原 Relay role；原 added 日期/owner 等缺少可信事实时未伪造，不称整卡一致。 |
| 成员资料 | `desktop/src/features/profile/ui/UserProfilePanel.tsx::UserProfilePanel`、`UserProfilePanelSections.tsx::ProfileSummaryView` | 实际头像与公钥显示，Profile kind0 显示名称/简介未设置；目录姓名不能冒充已保存资料字段。Agent tabs、Follow、presence 等原完整资料消费者仍未齐。 |
| 成员管理菜单 | `desktop/src/features/community-members/ui/CommunityMembersSettingsCard.tsx::RelayMemberRow` | 实际授权投影允许撤组织管理员、授频道管理员、移除频道/组织成员；仅展开，不选择。本轮不验证审批/变更执行。 |
| 个人菜单 | `desktop/src/features/profile/ui/ProfilePopover.tsx::ProfilePopover` | 实际菜单只有设置和平台退出；原 presence chooser/custom status/theme 等并未完整恢复，退出是既定平台会话接缝。未退出。 |
| 个人资料／头像编辑器 | `desktop/src/features/settings/ui/ProfileSettingsCard.tsx::ProfileSettingsCard` | 原头像预览、编辑徽章、三个模式 tab、图片选择器/完成及资料/身份分组呈现。只打开图片模式，不选文件/链接、不完成保存；Web 不读取本机私钥。 |
| 外观 | `desktop/src/features/settings/ui/SettingsPanels.tsx::ThemeSettingsCard`、`AppearanceSettingsControls.tsx` | 中文“系统”无旧换行，主题/字号/密度及预览呈现，语言为已授权适配；macOS 玻璃选项在 Web 不可用。未更改任何选项；截图是当前视口，不等于下方所有项均操作过。 |
| 通知 | `desktop/src/features/settings/ui/NotificationSettingsCard.tsx::NotificationSettingsCard` | 原桌面/声音/提示音/角标分组呈现，真实浏览器权限被阻止并明确红色提示。未授权限/切开关/播放音效，不称实际送达验收。 |
| 快捷键 | `desktop/src/features/settings/ui/KeyboardShortcutsCard.tsx::KeyboardShortcutsCard` | 原分类行与实际当前宿主快捷键可见，包含标当前/全部已读；未执行会写读状态的快捷键。截图只覆盖视口，不称每项键盘行为通过。 |
| 自定义表情 | `desktop/src/features/custom-emoji/ui/CustomEmojiSettingsCard.tsx::CustomEmojiSettingsCard` | 原上传/名称/保存分组可见，当前本人表情为真实空态；未上传/保存，不称创建或非空列表已验收。 |
| 邀请 | `desktop/src/features/community-members/ui/CommunityMembersSettingsCard.tsx::CommunityMembersSettingsCard`、`CommunityInviteDialog.tsx::CommunityInviteDialog` | 现网仍是平台组织邀请表单/表格，双标题与说明重复；不是原成员/邀请卡的完整还原。真实两条已使用邀请可读，未生成邀请或操作确认。 |
| 实验功能 | `desktop/src/features/settings/ui/ExperimentalFeaturesCard.tsx::ExperimentalFeaturesCard` | 四个已有原页面开关均关闭，未切换。原第五项 managedProfiles 缺真实消费者，仍缺；原 16 分区目前仅 7 分区，不把本轮 7 页实拍称全设置恢复。 |

## 浏览器命令与结束状态

沿正常 CLI `click/hover/press Escape/screenshot`，频道右键只使用真实按钮的 `click({button:'right'})`；没有 force click、DOM/style 修改、mock route、直接业务写 API 或假数据。

```text
playwright-cli -s=header-restoration goto http://192.168.0.193:58090/app/
playwright-cli -s=header-restoration screenshot --filename=/volumes/kailo/.playwright-cli/<下表文件>
playwright-cli -s=header-restoration run-code <page.request.get 实际 build-info，仅返回 status/buildId/reportedAt>
playwright-cli -s=header-restoration eval <只读 body pointerEvents/dialog count/lang>
playwright-cli -s=header-restoration console error
```

结束返回成员页，所有菜单/浏览弹窗已正常关闭，`body.style.pointerEvents=""`、dialog 0、lang=zh-CN；当前页 console error 汇总 0。该 0 不抹除开始时过期会话触发的真实 CSP 拒绝，也不验证新修复的 dirty discard 或双层 Keep editing：必须等新 Web buildId 后重验。

本轮未验：新 Dialog 单副本修复、设置写入/上传与通知送达、频道创建/管理/归档/删除、成员变更、原余下 9 设置分区、完整 Agent/Workflows、无 ACTIVE binding 的三个组件页面、Windows/Mobile。完整 union 仍引用 a8c1 原回执的 5314 路径台账；本轮没有重算或将其当当前 main 全量完成。

## 原件与 SHA256

目录全部为 `/volumes/kailo/.playwright-cli/`；下表文件均已实际打开，不是 DOM 检查替代图像。joined-settled 是同状态/同 hash 复拍。

| 文件 | SHA256 |
| --- | --- |
| `kailo-ui-20261009-maina8c-channel-header-members-readonly.png` | `60d2ed416aa08721b2dd95590ab10669de54525648b44e3137d0fb4c2ac9114d` |
| `kailo-ui-20261009-maina8c-channel-section-menu-readonly.png` | `0b24cefa64b95df52ea69874e259bcaa5ab7ac9bba13a1f3d029d1648558524f` |
| `kailo-ui-20261009-maina8c-channel-sort-menu-readonly.png` | `80b9a853415ff9448d6f37262c5a9cde8ba249e468f82c02d319b424472ed908` |
| `kailo-ui-20261009-maina8c-members-readonly.png` | `8d62829f3bb89115906ce59c92ad70a56baf26b1988e8fc776274dff1fb63a90` |
| `kailo-ui-20261009-maina8c-member-profile-readonly.png` | `c636e2befa401e159fe55666d72f8d1cf093c6681328882b13ab4783408061ba` |
| `kailo-ui-20261009-maina8c-member-management-menu-readonly.png` | `94d18fd2a63354df9db15000501350178e2a6995c38f5fb66d14309405a8183d` |
| `kailo-ui-20261009-maina8c-personal-menu-readonly.png` | `46955ccdfad757e6205ae129cde612adadc5df71d7522857c07558228b8cb440` |
| `kailo-ui-20261009-maina8c-settings-profile-readonly.png` | `7e8974d69d52798bc624f9f2ef5a4fb1a385e107b877c82335c148ba2f507177` |
| `kailo-ui-20261009-maina8c-settings-avatar-editor-readonly.png` | `02c521f442ba0f9cded2ac9a7668c419ede4e8feede488b450059eb18110975e` |
| `kailo-ui-20261009-maina8c-settings-appearance-readonly.png` | `fa9ecec292f81fa95f1529ef2c9f464690a7235a1ce57b3deba3649a1bde1125` |
| `kailo-ui-20261009-maina8c-settings-notifications-readonly.png` | `e7ea2e5780c719d7d9792c95666a946ff230715c00a57073756344a669bc3126` |
| `kailo-ui-20261009-maina8c-settings-shortcuts-readonly.png` | `fdab3b83e62eaa15b74bb5a2145d1f87782e658cb4b4e77d128d3e8922f0be93` |
| `kailo-ui-20261009-maina8c-settings-custom-emoji-empty-readonly.png` | `ef07f0932f551ef9679d6d5820bf9ff2a2f6d509f7d63d39cc702a30159d72fc` |
| `kailo-ui-20261009-maina8c-settings-invites-readonly.png` | `cb8db95ac4e700519fad9e51c880ccf3736c7265b0476fa65a0d572c61222df8` |
| `kailo-ui-20261009-maina8c-settings-experiments-readonly.png` | `c77c744aaba54a4248f5e1bf2c20881302681ae9323dd08a2cfa6116dc78ae8f` |
| `kailo-ui-20261009-maina8c-channel-browser-all-readonly.png` | `7945a045f65fe0abdae27fc6ecfc398b2f880cffa95d0f55a088d69309101a25` |
| `kailo-ui-20261009-maina8c-channel-browser-joined-readonly.png` | `f0fe518b0ea473cea145c92c7833e41c0b42a04c0dbbb64171e45b6128f22131` |
| `kailo-ui-20261009-maina8c-channel-browser-joined-settled-readonly.png` | `f0fe518b0ea473cea145c92c7833e41c0b42a04c0dbbb64171e45b6128f22131` |
| `kailo-ui-20261009-maina8c-channel-browser-archived-empty-readonly.png` | `b3e596ff3316fd2eefb415b171d1d24a2d3b866918c03e619b362ab85052c2fe` |
| `kailo-ui-20261009-maina8c-channel-context-menu-readonly.png` | `e7dfbfc2c680f463e177dfe9337b6e2face8045cd8854b487a852407751b9167` |
| `kailo-ui-20261009-maina8c-channel-copy-submenu-readonly.png` | `7035c8de92e16858da2119213f193dcdf1e12e970367c8da85fe89b80b64c5a1` |
