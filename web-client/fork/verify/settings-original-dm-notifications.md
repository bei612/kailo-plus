# 原版设置：私信通知真实消费者恢复

## 固定源码与差异

权威为 `REQ-24`、`DD-53`、`DD-74`。只读 Buzz 固定提交
`779af8886caae1317b4de962082429867ab61503`；本批重新检查全部 16 个
`desktop/src/features/settings/ui/SettingsPanels.tsx::SettingsSection`。
全模块映射沿 `settings-original-scale.md` 的 16 行，不把路径迁移算作缺失。
通知页过去另加的 Workspace Notifications 已由 `settings-notifications-original.md`
记录删除，不再是当前差异。当前仍只有 6 个设置入口，不能声明 16 项全部恢复。

本批选择有真实调用方的原私信通知：

| 固定上游完整路径与符号 | 当前映射与分类 |
|---|---|
| `desktop/src/features/notifications/lib/sound.ts::SOUND_SLOTS/RECOMMENDED_SOUND_BY_SLOT/DEFAULT_SLOT_SOUNDS/DEFAULT_SLOT_ALERTS_ENABLED` | 共享迁移到 `client-kit/ts/platform/src/react/notifications/sound.ts`；恢复原顺序 `dm` → `mention` → `thread_reply`，DM 推荐 `unison`、默认 `flutter`、默认开启不变 |
| `desktop/src/features/settings/ui/NotificationSettingsCard.tsx::NotificationSettingsCard` | 同名共享组件；恢复原 Direct messages 行、描述、独立声音选择和开关，中文/英文为授权差异；不是新加卡片 |
| `desktop/src/features/notifications/lib/notificationFormat.ts::formatMessageNotification` | 同名共享函数；恢复 DM 发件人优先、会话名次之、中性标题及空正文回退，不把私信名称拼成公共频道 |
| `desktop/src/app/useAppShellDesktopNotifications.ts::handleDmNotification` | 原 Desktop 通知、声音、点击目标消费者恢复；系统授权仍使用既有真实 host |
| `desktop/src/features/channels/useLiveChannelUpdates.ts::handleDmEvent/dmChannelMap` | 原分支接回同一个成员频道流，保留时间栅栏、self 排除、重复投递排除、当前频道抑制；额外消费既有 Core DM mute 投影，未知授权时不通知，是授权治理差异 |
| Web `ChannelPane.tsx::receiveNotification` | 授权宿主迁移：从已准入 BFF 会话流识别真实 conversation，复用相同通知 slot 与格式，不建立新的订阅或权限权威 |

原 `needs_action` 及 4 个禁用 job 行/Coming-soon 展开仍缺失，本批没有伪造其
消费者或宣称通知页全量一致。原 Huddle-start 通知依赖尚未贯通的 Huddle 能力，
未借本批生成新的事件入口。Web 目前只有已打开会话的实时消费者，未打开会话
的全局后台 DM 通知仍缺失；Desktop 使用已有成员频道订阅。不能据此声明两端
通知覆盖完全等效。Voice、Compute、Archive、Updates 等缺对应真实宿主调用，
没有复制假开关；Projects/模板及其他并行工作不属于本批。

## 动手前四步结论

1. 权威：原 DM 行与两个通知消费者已存在固定上游，本批直接恢复该行及其执行
   调用，不创造新页面或重新设计原版布局。
2. 影响：共享每身份本地通知偏好、原 SoundPicker、Native 成员频道流、Web
   BFF 会话流与通知宿主。沿原 v2 存储缺键默认补 DM；已有 mention/thread 值及
   其他身份数据保持不变。不改契约、数据库、Core、额度、工作流或 Mobile。
3. 副作用：只通知真实新消息，不发布业务事件，不复制权威正文。沿既有系统
   permission 与当前身份、成员准入、Core 静音投影；未知投影按既有静音集合
   不发送，不从旧本地 DM mute 恢复第二权威。
4. 边界：历史回放/self/重复/未准入/已撤权/静音事件不触发新增 DM 通知，DM
   线程不再从 Native thread-reply 路径重复发桌面通知。偏好损坏沿原 sanitize，
   无新业务终态或外部执行状态；六类业务错误映射不变。系统通知失败不宣称
   消息业务发送成功，也不触发重发。

## 验证及交付边界

受限既有 SDK `kailo-agent-receipt-xvkujx`，4 CPU/8 GiB、用户 1000:1000；
工作树 `/evidence/profile-settings-ortsoo.DRR20F/apps`。执行前查并发构建与
内存，TS 与已获协调的 Rust 检查并行，不新增容器或重建依赖。
日志目录 `/volumes/data/kailo/tmp/settings-scale-20261007.VXUSoG/`。

- 共享 `tsc --noEmit`、`tsc --noEmit -p tsconfig.test.json`、
  `vitest run test/notifications.test.tsx`：退出 0，6 项通过，`dm-shared.log`。
- 添加最终 Web 消费检查之前，Web 与 Desktop 各自 `tsc --noEmit`；Web 原消费者 8 项及 Native
  `node --import ./test-loader.mjs --experimental-strip-types --test src/features/channels/useLiveChannelUpdates.test.mjs`
  11 项：退出 0，`dm-hosts.log`。Native 既有失败重试用例的预期日志保留。
- 主线最终 Web 类型检查发现新消费夹具以字符串 `"ACTIVE"` 代替合同 `ItemState.Active`
  导致类型错误；已改为生成合同枚举，最终三侧类型检查由主线重验。此前类型通过
  不覆盖这一新增夹具，不能称最终三侧已通过。
- 增加 Web 真正 `ChannelPane` 的 DM 普通消息、self、Core mute、撤权检查后，
  `vitest run src/platform/ui/ChannelPane.test.tsx src/platform/ui/BrowserNotifications.test.tsx`
  9 项通过，`dm-web-consumer-final.log`。前两轮夹具遗漏 settings 与 BFF snapshot
  分别失败 6/1 项；补齐真实消费者所需夹具，未修改产品准入保护。
- 私有 SDK 故意将 DM 默认关闭、Native 移除 Core mute 保护、Web 将 DM 错分成
  mention；同检查分别抓到 1 项失败（5/5/10 项其余通过），三条命令各退出 1，
  `dm-mutations.log`。只在私有副本破坏，正式权限保护未更改。
- 三处用 `apply_patch` 精确还原，与正式源码 `cmp` 各退出 0；共享 6、Web 9、
  Native 11 项再次全部通过、串行命令退出 0，`dm-restored.log`。
  本批生产及检查文件的 `git diff --check` 退出 0。

本批未部署，未执行新截图或 Windows 设备验收；OS 实际到达、声音和点击跳转
须随主线发布实机验收。全局 `check.sh --full`、集中词条生成和提交由主线收口。
源码实现/窄验不是生产就绪或原版 100% 恢复声明。
