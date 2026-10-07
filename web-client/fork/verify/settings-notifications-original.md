# 通知设置恢复：移除非原版重复入口

## 权威与全模块对照

归属 `REQ-24`、`DD-53`、`DD-74`、`V-REQ-24`。固定官方版本
`779af8886caae1317b4de962082429867ab61503`，只读证据 `/volumes/kailo/.references/buzz`。
本批完整阅读原 `desktop/src/features/settings/ui/NotificationSettingsCard.tsx::NotificationSettingsCard`
及 `desktop/src/features/settings/ui/SoundPicker.tsx::SoundPicker/Waveform`，对照共享
`client-kit/ts/platform/src/react/notifications/` 全部实际消费者，不只审本批 diff。

| 部分 | 差异归类与当前事实 |
|---|---|
| 通知页头、Desktop alerts、Notify while viewing | 共享迁移；原布局/开关保留，文案中英文适配；权限由 Browser Notification 或 Desktop host 真实返回 |
| Sound、mention/thread reply、SoundPicker、Badges | 共享迁移；真实 per-principal 偏好与事件消费者存在；声音 URL 改为构建资源，预览按真实播放结果显示 |
| 原 Coming-soon 展开和禁用行 | 缺失需恢复；固定上游本来就是禁用展示，不是已实现事件，本批不增加/启用其执行消费者，也不声明全量一致 |
| Web 附加 Workspace Notifications | 非原版自创重复，本批删除其独立页头、列表及重复 CAS hook，不拼入原版布局 |
| 频道静音/取消静音 | 原入口继续保留，复用固定源码 `desktop/src/features/sidebar/ui/ChannelContextMenu.tsx::ChannelContextMenuItems`；Kailo 的共享 `sidebar/channel-context-menu.tsx` 与 Web `ChannelSidebar` 有真实调用 |

原 `desktop/src/features/settings/ui/SettingsPanels.tsx::renderSettingsSection` 的通知
分支只渲染 `NotificationSettingsCard`；没有第二个工作区通知页。本批 Web 分支
恢复只渲染 `BrowserNotificationSettings`，该 adapter 渲染同一共享卡片。

原频道入口的固定证据为 `desktop/src/features/sidebar/ui/ChannelContextMenu.tsx`
`ChannelContextMenuItems` 的 `showMuteToggle` 与 `onMuteChannel/onUnmuteChannel`。
当前链为 `web-client/web/src/platform/ui/ChannelSidebar.tsx::updatePreference`
→ `PlatformApp.tsx` 的 `onSetPreference/preference.mutationFn`
→ `bff-client.ts::setWorkspacePreference`；继续携带权威 version 和保留 starred。
该入口及数据权威未删除，频道订阅渲染继续读取同一 muted。

## 改动前四步结论

1. 权威：用户禁止自创/重排原版设置，固定源码只存在一个通知卡片；静音能力原本属于频道上下文菜单，当前已有消费者。
2. 影响：删除仅 Web 设置页第二条相同偏好写入入口与其私有 hooks；原频道入口、共享通知卡片、Desktop、Mobile、contract、数据库和存量偏好不变。
3. 副作用：不删除 muted 值、不复制偏好权威、不绕 CAS。原频道路径维持 UNKNOWN/failed/pending 阻止写入及 refresh，不将未确认副作用判定为成功。
4. 边界：无频道、读取失败、结果不明、正在写入仍由原频道消费者处理；系统权限仍由已有 host 判断，不虚构 granted、不关闭通知能力。没有新增状态、超时、重试、迁移；六类业务错误映射不变。

## 交付边界

本批不修改冻结发布 worktree，不新增引擎、协议、权限或配置。移除的五项检查
专门绑定已删除的自创 WorkspaceNotifications 组件；实际保留的频道消费者补充
mute/unmute 保留 starred 与 UNKNOWN 不暴露写入口的行为验证，通知页通过真实
BrowserNotificationsProvider 验证只剩原卡片且不主动请求权限。
本批不是整个通知模块完成声明：原 Coming-soon 展示仍缺，本批未做新版浏览器
截图、Windows 设备验收、Mobile 验收或发布。验证原始输出由同批回执记录。

同步删除 `i18n.ts` 中仅供旧入口使用的 `workspaceNotifications` 与
`workspaceNotificationsDescription` 及 `muted` 三条中英文词条。已与工作流并行批协调，
仅删除这三行，不覆盖其他词条；全工程精确 key 检索结果为零，包括已有 Dart
生成物，无该键可删除。其他未被删除入口使用的词条保留。

## 实际验证

沿用既有 `kailo-agent-receipt-xvkujx` SDK（4 CPU、8 GiB cgroup，用户
`1000:1000`），执行前核对并发 Core 发布构建和内存压力，仅跑窄 TS/行为检查。
工作目录 `/evidence/profile-settings-ortsoo.DRR20F/apps/web-client/web`，原始日志
目录 `/volumes/data/kailo/tmp/settings-scale-20261007.VXUSoG`。

- `./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vitest run src/platform/ui/SettingsPane.test.tsx src/platform/ui/ChannelSidebar.test.tsx`：退出 0，2 files / 11 tests passed（`notifications-restore.log`）。
- 私有副本将通知分支故意重复渲染，并将菜单 mute 故意改成 false；同两项检查退出 1，2 failed / 9 passed（`notifications-mutation.log`）。失败分别为预期 1 个卡片却得到 2 个、预期 muted=true 却得到 false。
- 两处均准确还原，私有源文件与正式工作树 `cmp` 退出 0；同两文件再次 11 tests passed、退出 0（`notifications-restored.log`）。未修改正式权限或静音保护，不碰部署。
- 本批源码 `git diff --check` 退出 0；全局编译、全局检查及发布由主线集中，不在子批重复运行。
