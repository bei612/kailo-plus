# DD-151：静音排除与 Mobile 原论坛通知消费者

本批只恢复既有通知路径；未构建安装包、部署或执行 APNs/FCM 真机验收。
`DD-151`、`DD-75/80`、`V-SCN-249/250` 的整体交付状态仍为进行中。

## 固定来源与语义核查

上游固定为 `779af8886caae1317b4de962082429867ab61503`。以下均为只读源证据：

- `desktop/src/features/notifications/lib/shouldNotify.ts::shouldNotifyForEvent`
  与 `mobile/lib/features/channels/unread_badge/should_notify_for_event.dart`
  均先广播、再本人提及、再频道静音。Desktop 的
  `shouldNotifyChannelMutes.test.mjs` 明确断言静音频道中的提及和广播仍通知。
- `mobile/lib/shared/relay/nostr_models.dart::EventKind.channelMessageEventKinds`、
  `desktop/src/shared/constants/kinds.ts::CHANNEL_MESSAGE_EVENT_KINDS` 和
  `migrations/0040_push_message_kinds.sql::enqueue_push_match_job`
  的真实消息集合均为 `9/40002/45001/45003`。`1111` 只见于
  `VISION_PROJECTS.md` 的未来 NIP-22 描述，没有在这些实际通知生产/消费集合中。
- 当前 Desktop 的 `events.rs::build_message_for_surface`、
  `commands/messages.rs::send_channel_message` 与 Web 的
  `collab-bridge/src/bridge.rs::message_kind` 已产生 `45001/45003`。
  Relay `handlers/governance.rs::check_event_kind` 消费显式部署白名单。
  2026-10-26 只读两套现存 Relay 配置均允许 `45001/45003`，不含 `1111`；
  此配置观察不证明本批已部署或这些事件已实际发送。

核查时设计 `DD-151` 明确排除静音，`V-SCN-249` 要求静音后再次被提及不推送；
它与“沿原 shouldNotifyForEvent 次序”的表述存在冲突。本批遵循明确排除句和场景，
只改 Core push：本人消息、频道/线程静音先排除，再判断提及/私聊/关注或本人线程。
已读仍由原派发检查消费 Core read-context。Web/Desktop 原通知行为不改变。
设计例子和勿扰范围由设计权威单独订正，不为当前实现反改验收条件。

## 恢复范围

Core `push/decide.rs` 纳入四个原消息 kind；原 `scan::Window` 自动消费同一集合。
定向用例覆盖静音提及、静音广播、静音私聊/线程及论坛帖/评论的通知和未读上下文。
该 Core 增量仅在本批运行原 SDK rustfmt；编译、数据库及合批检查由集成批记录。

Mobile 从固定上游恢复 `features/forum/` 原五模块：帖子卡片、帖子列表、完整线程、
模型与 Relay 读写。保留原媒体/提及/作者头像、发帖、回复、本人删除及空态。
频道入口经原 `ChannelDetailPage` 进入论坛，推送的回复 ID 先沿同频道真实事件祖先
定位根帖，再显示原全文线程并滚到目标回复；不以流消息摘要代替论坛。
列表保留原版最近 50 帖与刷新范围，不将其称为全部历史分页交付。

接缝变化如下：

- 所有读使用现有身份的 Relay 查询；按 channel 验证目标，拒绝跨频道、缺失和循环祖先。
  线程复用已有 `depth_limit/thread_cursor/thread_cursor_id` 协议读取后续页面，
  同秒 200 条之后继续读取，未另造消息权威。
- 发帖/回复复用既有 `SendMessage` 的同一已签名事件重试规则；明确保留 `45001/45003`。
  草稿捕获 Relay/key 与 NativeSession 登录代际，重新登录不能发送旧草稿。
  删除复用 `messageMutationsProvider`，拒绝/结果不明保持原页面并给出同源文案。
- 原作者资料取平台目录；文案取既有同源 Dart 目录。未手工修改生成物。来源清单只移除已实际恢复的两条 forum 缺失路径。
  论坛读位置仍写原 read-state 消费链，没有新未读权威。

## 原 SDK 检查

最终产品源为 `8047b742d7826c4066aecd28aa610738fa4ed98a`，从 GitHub 固定取源。
使用原 Flutter 3.41.7 / Dart 3.11.5 镜像：
`ghcr.io/cirruslabs/flutter:3.41.7@sha256:644e3cea0a8440ce75804b67ceab77b16a87b39d9e9d89b07aceca7a98af1aa3`。
容器为 2 CPU、4 GiB，swap 同上限；实际限额与 MemAvailable 均已回读。
宿主未执行项目 SDK。依赖采用 `flutter pub get --enforce-lockfile`。

最终固定源结果：15 个文件格式 0 变化、7 个 analyze 路径无问题、76/76 检查通过。
检查包含原版模型/组件、实际频道到论坛入口、远端回复定位、同秒跨页、跨频道与
循环祖先拒绝、同事件发送重试、换社区和同 key 重新登录的旧草稿拒绝。

实际反向在独立导出中将 `ForumThreadPage` 的 `initialScrollIndex` 强制为 0，
真实 `ChannelDetailPage → ForumThreadPage` 组件检查因找不到第 70 条目标回复失败；
逐字恢复后同一用例通过，源码 SHA-256 前后均为
`924bfde3e11bd123323faf34dfa59a011dc405c19b9d612f6db661a26dbf0461`。
`pubspec.lock` SHA-256 为
`1fd2b3b4e6c11a372b79eff70d8b81b1cddbdef81a0ccaff7ac38966bc82033d`。

原日志位于 CI
`/volumes/data/kailo/verification/buzz-r10/flutter-forum-final-8047b742d/check.log`，
SHA-256 为 `be9596b13bf474ba2e238ff702b295b98abcc05f1578c7f007100ee382f0c918`。
同目录保留 `preflight.log`、`limits.log`、`result.log`。运行容器已退出删除，
实际 Docker 回读本批容器为空。上述是模型/组件定向验证，没有真实设备或外部供应商调用。

已有失败保留：`82f06881b` 原 analyze 发现被移除的旧测试 transport 名称和格式规则；
`6ecfd14b2` 实际原版模型/组件检查发现共享词条变量丢失，以及需适配同源文案和
原生桥字段的夹具。修复后 `16bb9c479` 为 75/75，新增登录代际检查后
`049e98132` 为 76/76；这些历史结果不替代最终固定源回执。

## 勿扰与原生发布边界

固定集成底版 `4f673a032` 的 iOS `Runner/AppDelegate.swift::startPushRegistration`
只申请 `.alert/.badge/.sound`；entitlements 没有 critical-alert，NotificationService
未设置 `interruptionLevel`，Core APNs payload 仅 `sound=default`，未要求绕过系统设置。
这不是 Core 读取系统勿扰状态；当前 Core presence 也没有 DND 权威或对应用户偏好。
没有真机验证，不能称勿扰投递场景通过。

Android 当时 `MainActivity.kt` 没有 `buzz/push`/FCM 消费者，Manifest 无通知 service，
Dart 注册仍固定 `APNS`。Core FCM sender 不代表 Android 已接通。Android 原生桥、
平台选择、未配置时正确关闭、两平台签名包及真实后台/冷启动通知仍为下一批缺口。

本批不添加制品 digest，也不解除 `collab.mobile_push` 的发布门禁。

上游 status 原工具在隔离树因相邻 `.references` 不存在无法比较；只读指定实际证据根后，
开发用户读取 `UPDATE_TASKS.json` 被权限拒绝。本批未修改证据树权限；固定源码对照
采用前述既有 commit，不将该 status 尝试记为成功。
