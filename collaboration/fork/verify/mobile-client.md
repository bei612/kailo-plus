# buzz-mobile：Kailo 一期版本的核验

## 范围

基线 block/buzz `779af8886caae1317b4de962082429867ab61503` 的 `mobile/`（Flutter/Dart，SF-MOB-01/02）。
Mobile 不是组件宿主、不承载文档编辑（REQ-21）：一期交付登录、协作数据平面（被授予的 private
Channel 里的 kind 9 消息，本机持钥直连 Relay，DD-75）与成员、本人任务、待我审批、本人审计、本人
设备五页管理面视图。任务与审批是受权只读视图（apps/02 §4「Mobile 只读」）：不渲染撤回、批准、
拒绝入口，详情里说明到 Web/Desktop 完成；状态读法与 Web/Desktop 共用包的 `taskPhase` 逐条相同，
结果不明与投影落后显示为等待对账。
深链进入未交付的能力返回稳定 reason code `SURFACE_CAPABILITY_UNAVAILABLE` 并指向 Web/Desktop
（V-SCN-65），不以内嵌 WebView 承载。

删除的上游能力（`remove_paths` 与补丁）：Agent 页面、Workflows、Huddle、自建 Channel 与 DM 入口
（含 DM 模型与 TTL Channel）、Component host、编辑器、表情回应与消息编辑/删除、提醒、输入中提示、
邀请、推送、年龄门禁、社区切换、成员目录搜索，以及对应的路由、菜单、依赖与 Android 原生代码。

Kailo 接入在 `mobile/lib/shared/kailo/` 与 `mobile/lib/features/kailo/`：RFC 8252 PKCE 登录（私有
URI scheme 回调，IdP 登记见 `core/verify/native-identity.md`）、刷新令牌进安全存储、401 刷新一次
重试一次、只代发 `/api/v1/`、NIP-98 持钥证明登记设备、结果不明显示为待确认。BFF 回应的类型来自
`contracts/` 的 Dart 生成物与共享平台文案生成物，构建时经 `vendor_files` 放入。

## 受治理频道创建恢复（2026-10-12）

上节的删项及 2026-09-25「自建 Channel 被拒」记录是历史裁剪和设备直接发布 CONTROL 的证据，不是当前完整恢复目标。本批恢复普通用户经管理面 BFF 发起的原版频道创建；设备仍不能直接发布 CONTROL。New DM、Browse Channels 及其他删项没有在本批恢复，不称完整 launcher、频道管理或原版全量一致。固定原 Mobile 没有 Projects Task 指派页面，本批该项为「无适用对象」，不制造新页面。

### 编辑前四项核对结论

1. 权威为 DD-75、DD-80 与 `.design/09-统一身份与Buzz协议投影.md` §4。Workspace 与 Relay Channel 使用同一 ID，Core 才能发布 CONTROL；Mobile 管理面经 NativeSession/BFF，协作内容与 roster 仍以本机密钥直连 Relay。
2. 影响面为 Home 原入口、Create Channel 原 sheet、原 ActionCommand/ActionSubmission、TaskView、受权 WorkspaceView 和原 channelsProvider。没有改平台契约、数据库、工作流类型、Mobile 非组件宿主边界或共享页面权威；三条缺失文案仅加在 TS 单一目录并由原生成器生成 Dart。
3. fresh session 必须与可信 actor/tenant 一致，fresh RoleWorkspacePage.createActionKey 允许时才创建原意图。原 POST 之前持久保存参数和 key；已知执行引用只 GET，未收到引用时仅由用户以同 key、原字节 command 回查。权限错误、查询失败、UNKNOWN、投影落后不清意图，不放行换 key 创建，也不渲染成功或确定失败。
4. 并发重入不替换原意图；关闭 sheet、重挂载和进程重启恢复原参数；身份切换按 actor+tenant+运行时平台地址隔离。本机仅保存原 command 与响应引用，没有 token、Cookie、密码或独立终态。Task 必须精确匹配 AE/operation/action/workflow，且本次 target 的 Workspace/slug/member 与原生频道 roster 一致，才清本机意图并进入频道；确定结束也须先成功移除本机记录才能放行新意图。未决时没有后台重复 POST 或自造过期成功，终态继续以原 Core Task 为权威、用户显式重查。

### 固定源码差异与当前消费者

固定 Buzz commit `779af8886caae1317b4de962082429867ab61503`：`mobile/lib/features/channels/channels_page/quick_actions_launcher.dart::ChannelQuickActionsLauncher`、`mobile/lib/features/channels/channels_page/quick_actions.dart::_MorphingQuickActionsButton`、`mobile/lib/features/channels/channels_page/sheets.dart::_CreateChannelSheet`、`mobile/lib/features/home/home_page.dart::HomePage.build` 是本批实际恢复来源；`mobile/lib/features/channels/channel_management_actions.dart::ChannelActions.createChannel` 的设备直接写 CONTROL 不恢复。

- 原样保留：原 launcher 动画、表单、名称/说明、公开/私密、持续/临时及九项 TTL、键盘 Done 提交和底部导航几何。只恢复原 Create 行；没有用空 DM/Browse 行冒充原能力。
- 共享迁移：新缺的三条 Mobile 文案继续 TS→Dart 原同源路径；Mobile 页面主体仍为原 Flutter，没有搬成 WebView。
- 已授权治理改造：`collaboration/mobile/lib/features/channels/channel_management_actions.dart::ChannelActions` 复用 `workspace.create`；可信准入、原意图恢复、明确重查、精确结果回读和 UNKNOWN 中性文案取代原设备直接创建。
- 缺失需恢复：New DM、Browse Channels 与其他既有缺项仍保留；本批没有安装包、设备截图或完整视觉对照，不声明 100% 还原。

Core 依据为 apps commit `c661236d5d85dcb29fca4b7d1f8727ec4d46df7d` 的 `core/crates/platform-core/src/governance.rs::Governance::submit_with_native_origin`、`Governance::by_idempotency`、`Governance::replay`：去重作用域是 tenant/initiator/key，action 与参数不一致拒绝复用；同键回查能继续原 AE 的 decide/dispatch，不能据此宣称绝不再调用准入/派发方法。既有 Web 消费者为 `client-kit/ts/platform/src/react/roles.tsx::useWorkspaceCreate`。本批 Mobile 模拟消费者证据只证明同 key/字节、已知 AE GET-only 和结果关联，不替代 Core 在线不产生第二 AE/operation/业务执行的验收。

同批最小修复原消费者编译：`platform_views.dart` 对已有可选 interval 字段和 action 显式拒绝 null，不默认零值或空模板；没有新增 cron/多步骤 Mobile 产品支持。`_ThreadStickyDateIndex.resolve` 仅从唯一原调用方传入实际 locale，避免无 context 的索引读 Localizations；原 Channels 测试导入排除同名 SessionStatus/Theme，不改既有断言。

### 实际验证与交付界限

源码候选基于上述 apps commit，私有 index 仅 12 个 Mobile 路径，2125+/10-；独立 TS/Dart 三 key 增量另有 12 行。公共 index 和继承 theme 修改未纳入。完整 patch 位于 `/volumes/data/kailo/tmp/mobile-channel-create.tph0BR/mobile-12paths.patch`，SHA256 `62b10c70e08169de04b54ee82549ac92bb540fd78a202bd7012b70c7bdc1195c`；三 key patch 为同目录 `mobile-i18n-3keys.patch`，SHA256 `3b17cad8908d0c982fbde716a0a2a32a50a0223e5022c571c6756d782d4ddafb`。

复用本地不可变 Flutter 镜像 `sha256:644e3cea0a8440ce75804b67ceab77b16a87b39d9e9d89b07aceca7a98af1aa3`。执行前核对原构建进程、CPU/内存压力；Docker 实际 2 CPU、4294967296 字节 memory=memory+swap、UID 1000、network none，输入、SDK/pub 缓存、HOME、tmp 与日志均在 Data。未在宿主编译，未 pull/load 镜像。以下日志均在上述同一 Data 目录。

| 实际命令/证据 | 结果 |
|---|---|
| 原 `python3 tools/gen-platform-i18n.py` 及 `--check` | 生成成功；`PASS: Mobile platform and reason catalogs match the shared TypeScript source`，exit 0，见 `generator-check.log` |
| 本批生产文件原 `flutter analyze --no-pub` | `No issues found!`，见 `analyze-tests-consumer-fix.log`；后续八项分析只有新测试两条大括号 info，见失败原件 |
| 修正后新测试 `flutter analyze --no-pub test/features/channels/channel_creation_test.dart` | `No issues found! (ran in 68.6s)`，见 `final-consumers-braces-corrected.log`，exit 0 |
| 原 `flutter test --no-pub --reporter expanded`：channel_creation、channels_page、home_page 三文件 | `00:40 +34: All tests passed!`，同一最终日志、容器 exit 0；含七项治理/恢复用例及原表单打开、提交、重挂载、实际滚动点击重查和 GET 计数 |
| 私有 HEAD 三 key `git apply --cached --check`；本批 `git diff --cached --check` | 均 exit 0，公共 index 未改 |
| 只在私有输入暂删 operation 精确关联 | `mutation-operation-mismatch.log` 实际 exit 1：应抛 FormatException 却返回 Channel；恢复后 Actions SHA256 与破坏前同为 `742e6ac7d653ef797da5ee75614ee1a302b205b5831828dabc27b2ddf3c0e6a0`，最终 34 项重新通过 |

失败原件保留：`analyze-initial.log` 为首次 pub 缓存错误挂载后主动停止本人容器（137，不称 OOM）；`analyze-corrected-cache.log` 为 SessionStatus 导入冲突；`analyze-tests.log` 为新测试括号解析失败（65）；`analyze-tests-corrected.log` 为上述既有可选字段/locale/同名测试导入编译阻断；`analyze-tests-consumer-fix.log` 为原表单输入帧未泵导致一项失败；`channel-consumers.log` 为重挂载时 Hook init 读 Localizations 的真实运行断言，已改为 build 计算文案、effect 只恢复；`channel-consumers-remount-fix.log` 虽为 +8/exit 0，但屏外点击警告不能证明重查操作，最终已加入屏内滚动及 GET 计数断言；`final-analyze-consumers.log` 为新测试两条 curly_braces info、exit 1，后续加括号并在最终命令复验。没有把以上失败或未操作到的旧通过当最终验收。

交付分层：源码已写入并形成上述私有候选；仅定向模拟消费者验收通过；本批没有独立 commit/push；没有部署、APK/iOS 构建、安装包、真机或正常 SSO 在线创建验收；未运行 Flutter 全套或 `check.sh --full`，交由主线合批门禁，不能据这 34 项提高生产交付完成率。

## 受治理 New DM 恢复（2026-10-12）

本节继续纠正历史裁剪记录，只恢复原 Mobile New DM→HUMAN 收件人选择→原生私聊回读。上节「本批没有恢复 New DM」仅指频道创建批次。本批不是完整 launcher、DM 管理、Mobile 全量或原版 100% 一致验收；presence、Browse Channels、其他删项与设备视觉对照仍未恢复或未验证。

### 编辑前四项核对结论

1. 权威为 `.design/03-领域模型与权限模型.md` 的 ConversationBuzzBinding 与 `.design/09-统一身份与Buzz协议投影.md` 的 DM 投影边界：同 tenant、不可变 HUMAN Principal 集合、当前发起人必须在内、ACTIVE 绑定和 fresh discover。DM 不是 Workspace；管理面使用现有 `conversation.open`，设备不直接创建 CONTROL。
2. 影响面为原 New DM sheet/launcher、Channel DM 字段、列表/详情显示、原消息与已读消费者、NativeSession/BFF 的现有目录/Action/Task 合同及本机 Relay 原读取/签名入口。没有改契约、数据库、Core/Worker、工作流类型、Mobile 非组件宿主边界或另建身份目录；文案只增量使用原 TS→Dart 生成路径。
3. fresh FULL session、actor/tenant 与本机 CLIENT 映射必须一致。目录只消费 BFF 的 HUMAN 与其全部当前公钥，重复 Principal、公钥、分页游标、变化上限和缺失自身投影均拒绝；多公钥不膨胀成人数。Task 必须匹配本次 AE/operation/action/workflow/target，结果不明、查询失败或投影未收敛不能成为成功或确定失败。
4. 原 command/key/响应引用在 POST 前后持久保存，仅当前 actor+tenant+运行时平台地址可读取，没有 token、Cookie、密码或第二执行终态。并发重入、sheet 重挂载、重启和响应丢失不换 key；未知引用仅用户显式同字节/同 key 回查，已知引用只 GET。sheet 在原 consumer 改变时锁定并关闭，不沿用另一身份收件人。确定结束或成功也须先移除原本机意图，存储失败不能放行新提交。

### 固定源码差异与实际消费者

固定 Buzz commit `779af8886caae1317b4de962082429867ab61503`：`mobile/lib/features/channels/channels_page/sheets.dart::_NewDirectMessageSheet`、`_SelectedDmRecipientChip`，`mobile/lib/features/channels/channels_page/quick_actions.dart::_MorphingQuickActionsButton`，`mobile/lib/features/channels/channel.dart::Channel`，`mobile/lib/features/channels/channels_page/channel_tile.dart::_DmAvatar` 和 `mobile/lib/features/channels/channel_detail_page/app_bar.dart::_DmAppBarTitle` 是恢复来源。`mobile/lib/features/channels/channel_management_actions.dart::ChannelActions.openDm` 的 selected-p 直接创建与原预览目录不恢复。

- 原样保留：原菜单 New DM 卡片、收件人 To/输入/搜索结果/移除 chip、头像回退、键盘 Done、原 sheet 几何和原生 DM 消息/列表消费；没有发明摘要页面或假 Offline。
- 共享迁移：仅补 `native.quickActions.newDm`、`native.dm.searchPerson`、`native.dm.section` 三 key，由现有 TS 目录生成 Dart；不手写另一翻译权威。
- 已授权治理改造：`collaboration/mobile/lib/features/channels/direct_messages.dart::DirectMessages` 消费真实 NativeSession 管理面与 HUMAN 目录；`direct_message_actions.dart::_DirectMessageActions` 持久保存原意图并精确回读；原 native `SignedEventRelay` 仍使用本机 CLIENT 密钥。
- 缺失需恢复：presence、Browse、完整 DM/频道管理及其他历史裁剪仍缺项；本批未做完整页面截图、APK/iOS 或设备验收，不称全量一致。

Core 依据固定 apps commit `993da21e9619ddac8763778394bea07c504a8022` 的 `core/crates/platform-core/src/conversations.rs::{OPEN,participants,list,target,prewrite,advance}` 与 `core/crates/platform-core/src/governance.rs::Governance::{submit_with_native_origin,by_idempotency,replay}`。原 dedupe 为 tenant/initiator/key 与 action/参数摘要；同键回查可推进同一 AE，不等于永不再调用 decide/dispatch。Mobile 模拟消费者只证明同字节/key、已知引用 GET-only 和关联检查，不代替 Core 在线无第二 AE/operation/业务执行证据。

本次完成确认必须同时具备 Task 的当前 operation、ACTIVE Conversation 的精确 target 与 immutable participants、本机直连读取的有效 Relay 签名 39000/39002、精确完整 roster 与当前 CLIENT 准入，再刷新原 channelsProvider 回读同一个 DM。已存在 DM 的 binding.operationId 是原创建引用，允许与本次 AE.operationId 不同；不能用同名或任意可见资源代替结果。DM 作者名称消费原 UserCache 的可信 HUMAN 映射，不把 DM ID 当 Workspace 调平台成员目录。

个人 unhide 依据同一 apps commit `collaboration/crates/buzz-relay/src/handlers/command_executor.rs::{handle_dm_open,handle_dm_visibility}`：设备只签名空正文、唯一 h 的原 41010，绝不含 selected-p。签名前验证 Relay 签名且精确 viewer 的 NIP-DV 30622；原有初始 snapshot 缺失仅表示没有隐藏记录，异常 snapshot 不降级为空。必要 unhide 先持久保存原签名事件，OK 丢失后精确回读；确未应用时只显式重发同一个事件，确认已应用不重复发布。

### 实际验证与交付界限

候选及原日志在 `/volumes/data/kailo/tmp/mobile-new-dm.1gPwk4/`，输入基于上述 apps commit，公共 index、共享 TS/Dart 与继承主题修改均未覆盖。本批实现后才补原消费者用例，没有先写规格或 TDD。

复用已有不可变 Flutter 镜像 `sha256:644e3cea0a8440ce75804b67ceab77b16a87b39d9e9d89b07aceca7a98af1aa3`。每次执行前读取原构建进程与 CPU/内存压力，实际容器为 2 CPU、4294967296 字节 memory=memory+swap、UID 1000、network none；源码输入、SDK/pub 缓存、HOME、tmp 与日志均在 Data，未宿主编译、pull/load、打新 APK 或并行重量构建。

`analyze.log` 中原 `python3 tools/gen-platform-i18n.py` 及 `--check` 生成校验通过；原 18 项 `flutter analyze --no-pub` 在 `consumers-round4.log` 为 `No issues found! (ran in 32.1s)`。该次测试为 +45/-1：原 Channel Creation/Channels/Home 三文件 34 项全部通过，唯一失败是本批模拟夹具误用了契约外 observation，真实契约 parser 拒绝；已改为原 `EXTERNAL_RESULT_UNKNOWN`。失败原件未删，后续 New DM 专项结论单独记录。

修正后最终 `consumers-final.log`：18 项原 `flutter analyze --no-pub` 为 `No issues found! (ran in 76.9s)`；`flutter test --no-pub --reporter expanded test/features/channels/direct_messages_test.dart` 为 `00:01 +13: All tests passed!`，容器与外层命令实际 exit 0。覆盖 HUMAN/多公钥、错误分页/投影、响应丢失重启、原字节/key、GET-only、AE/operation/UNKNOWN、binding/roster、签名个人 unhide 丢失 OK/精确重发、actor 隔离、NIP-DV 和原收件人 widget/身份切换关闭；原 34 项没有重复运行。

仅在私有输入移除 Task operation 精确关联时，原专项实际 exit 1：应抛 FormatException 却返回 Channel，见 `mutation-operation-mismatch.log`。恢复原 Actions 字节 SHA256 `80dbc4fc9f97ea220f1427b2cb8d6d2daf3fc5dfe33fa000f73bd1db026abe6c` 后，同一专项 `+1: All tests passed!`、exit 0，见 `restored-operation-mismatch.log`；正式源码从未被破坏。17 个正式源码路径已与最终私有输入逐一 cmp 相等，独立源码 patch SHA256 `52e60098f275f617f826c939868b19148f93d83e77059de12a3ec425ddf37f54`，+1536/-79；独立三 key patch SHA256 `5c64014438a216100a90444f401b788714fc1428d914c2fe0a590b6c955c73ca`，两路径 +9。

失败原件还包括 `analyze.log` 的四项 lint、`consumers.log` 的新用例括号解析（65）与旧 nostr Keys API/大括号错误、`consumers-round3.log` 的原页面新增 loading import 与大括号错误，均直接修正实际消费者，不把失败记成通过。

首次 `check-docs.sh` 的普通 npx 调用在 network none 容器等待 npm 元数据，原前六项与设计自检已通过但命令未终结，主动停止本人容器，原 `docs-selected.log` 保留且不称 OOM/通过。后续原命令只通过 `npm_config_offline=true` 复用已有缓存，不构建或拉取工具镜像；候选 Mobile 文档按私有 HEAD 加本节检查，不纳入正式继承文档的历史 MD032。

源码写入与定向模拟消费者不等于线上可用；本批不自行 commit/push，没有部署、新安装包、真机/模拟器正常 SSO 私聊或真实多人互发验收，也未重跑 Flutter 全套和 `check.sh --full`。发布与全量门禁由主线合批，本节不据代码量或定向通过提高生产完成率。

## 受治理 DM 静音恢复（2026-10-12）

本批仅恢复原 Mobile DM 的 Mute/Unmute、列表静音标识与真实未读通知筛选。它不补 Star、sections、Browse、presence、普通频道静音、系统推送或完整 DM 管理；既有缺项没有变成空按钮。本节是实现与实际验证记录，不替代设计权威，也不声明 Mobile 完整还原或生产就绪。

### 编辑前四项核对结论

1. 权威为 DD-40、`.design/03-领域模型与权限模型.md` 的 CollaborationUserState 与 ConversationBuzzBinding、`.design/09-统一身份与Buzz协议投影.md` 的 HUMAN/CLIENT 和私聊准入。只有 Core 的 conversationPreferences 是三端偏好权威，原 NIP78 写入不恢复。
2. 影响面为原 ChannelActionsSheet、原 `_ChannelTile`、ChannelsNotifier 的历史补拉/实时事件与原 unreadBadgeProvider，管理面复用 NativeSession/BFF 和生成的 ConversationPreferenceRequest/UserStateVersion。没有改契约、数据库、Core/Worker、Relay 协议、共享文案或 Mobile 非组件宿主边界；直接消费已有 TS→Dart 的 sidebar.mute/unmute/preferenceUnknown 等词条。
3. 写前 fresh FULL actor/tenant/platform-session、本机 CLIENT、精确 ACTIVE Conversation 与 HUMAN 全公钥目录必须成立；共用 New DM 的有效签名 39000/39002 与完整 roster 核对，不把用于显示的代表公钥当完整 roster。原 AE/operation、个人 unhide 与本机内容传输不改；设置面仍经 BFF，本机 Relay 不成为另一偏好权威。
4. 每次 PUT 前必须成功持久保存原 CAS 参数，按平台地址+tenant+actor 隔离，不存凭据、正文或自造终态。重复点击串行；关闭 sheet/重启恢复原意图；actor/session 切换锁定并关闭旧 sheet、隔离旧响应。读取旧 version、异常快照或失败不默认未静音；409 首次明确拒绝不自动换 version 覆盖另一端 starred；旧 UNKNOWN 的后续 4xx 不能否定仍在途的旧 PUT，因此保留原意图，只由权威 version 推进令旧 CAS 失效。刷新/恢复只 GET，同 version 仅用户显式重查同字节 CAS；保存失败不准 PUT。没有新增后台重放或过期成功状态。

### 固定源码差异与实际消费者

固定 Buzz commit `779af8886caae1317b4de962082429867ab61503`：`mobile/lib/features/channels/channel_actions_sheet.dart::ChannelActionsSheet`、`mobile/lib/features/channels/channels_page/channel_tile.dart::_ChannelTile`、`mobile/lib/features/channels/channels_provider.dart::ChannelsNotifier` 的 `_catchUpUnreadEvents`/`_handleLiveEvent`、`mobile/lib/features/channels/unread_badge/should_notify_for_event.dart::shouldNotifyForEvent` 是本批恢复来源。

- 原样保留：原 ListTile 的 bell/bellOff、Mute/Unmute、零 contentPadding，原列表 secondary foreground 与 12px bellOff；静音不擅自把旧未读标成已读，原 broadcast/本人 mention 优先级保留。
- 共享迁移：直接消费既有同源词条，没有新增或覆盖共享 TS/Dart 翻译文件。
- 已授权治理改造：原 channelMutesProvider/NIP78 替换为 `collaboration/mobile/lib/features/channels/direct_message_preferences.dart::ConversationMuteNotifier` 的 Core readback/CAS/原意图恢复，未知与失败仅使用既有治理文案和明确重查；没有乐观成功或另一偏好账本。
- 缺失需恢复：上节及本节开头列出的其他原生管理/浏览/presence/系统推送、设备视觉对照仍未完成，不借静音专项通过删减全量目标。

已有 Core/TS 依据固定 apps commit `54306bc7d4af23495a4c318427e025df6850df1c` 的 `core/crates/platform-core/src/user_state.rs::{get_user_state,put_conversation_preference,upsert}` 与 `client-kit/ts/platform/src/react/conversations/use-conversation-state.tsx::useConversationState`。GET `/api/v1/user-state` 与 PUT `/api/v1/user-state/conversations/{id}` 使用同一共享 version；提交前 fresh GET 保留当前 starred，返回 version 必须为原版+1，仍须权威回读。更高 version 仅证明旧 CAS 不可再写，不据此声称一定是本次 PUT 成功。DENIED/PRECONDITION/LIMIT 沿既有 BFF 错误，409 为 CONFLICT；不可核验的写入、撤权中断或投影滞后保持 UNKNOWN，未开放能力为 BLOCKED，不另造错误码。

列表和通知不是无消费者字段：原 `_ChannelTile` 显示已确认 muted；ChannelsNotifier 初始/重连先读取权威，历史 catch-up 与 live 均调用原 shouldNotifyForEvent 并传 mutedChannelIds。普通私聊事件被静音过滤，原本人 mention/broadcast 仍可触发；原 unreadBadgeProvider 消费实际已观察事件。偏好不可读时不回退 unmuted，也不清掉已确认的历史未读。

### 实际验证与交付界限

候选及原日志位于 `/volumes/data/kailo/tmp/mobile-dm-mute.EBqGIR/`，固定输入基于上述 apps commit。复用既有不可变 Flutter 镜像 `sha256:644e3cea0a8440ce75804b67ceab77b16a87b39d9e9d89b07aceca7a98af1aa3`；每次执行前检查原构建进程及 CPU/内存压力，实际 2 CPU、4294967296 字节 memory=memory+swap、UID 1000、network none，输入、HOME、tmp、SDK/pub 缓存与日志均在 Data。没有宿主编译、pull/load、重建镜像或新 APK。

实现后原 `flutter test --no-pub --reporter expanded test/features/channels/direct_messages_test.dart test/features/channels/channels_provider_test.dart` 在 `verify-round5.log` 为 `00:22 +65: All tests passed!`，实际容器 exit 0、OOMKilled=false。其中原 New DM 13 项、本批静音 9 项与原 Channels 43 项；覆盖真实 action tile/list bellOff、catch-up/live/badge、starred 保留、同字节恢复、旧快照、重复点击、actor 切换、完整 roster、UNKNOWN 后续 403 与本机保存失败。测试在实现之后补充，未写先行规格或 TDD。

失败原件保留：`verify-initial.log` 为原测试 helper 一条大括号 info、exit 1；`verify-round2.log` 的生产分析无问题，但本批原 ChannelsPage 夹具缺必需构造参数，测试加载失败，原 Channels 43 项通过不能冒充整批通过；`verify-round3.log` 为新 part 四条循环大括号 info、exit 1；`verify-round4.log` 为真实 Channels 夹具未覆盖原 queryRelay 入口导致 30 秒超时、+62/-1，修正原夹具后才得到上述 +65。

终版 `verify-final.log` 的八项原 `flutter analyze --no-pub` 为 `No issues found! (ran in 58.1s)`，恢复后的原 DM 消费者为 `00:03 +22: All tests passed!`，实际容器 exit 0、OOMKilled=false；原 Channels 43 项不重复运行。普通频道不渲染静音入口也已通过原 sheet widget 断言。

主动破坏仅发生在私有输入：移除 durable save 时，存储失败用例本应没有 PUT，却出现一次 PUT，见 `mutation-persistence-unknown.log`，exit 1；恢复 save、仅移除首次/旧 UNKNOWN 区分时，原 403 用例的 pendingId 应为原 Conversation ID 却变 null，见 `mutation-old-unknown-4xx.log`，exit 1。两 guard 恢复后与原件 cmp 相等，preferences SHA256 `dbad05f3c4b55de58a50c0a7c1066500c83bfcb384d218f449638ded4330056d`，再得到上述终版 +22；正式源码从未破坏。

源码和模拟消费者通过不等于线上交付：本批不自行 commit/push，没有部署、新安装包、真机正常 SSO、跨端实际偏好或系统通知验收，未运行 Flutter 全套、`check-docs.sh` 或 `check.sh --full`。本批只运行精确候选文档 lint；原全局文档与全量门禁由主线合批，提交/push、部署分别报告，不凭代码量或定向通过提高生产完成率。

## 清单可复现

上一轮清单由 `tools/upstream_manifest.py export` 从开发分支导出（HEAD `463d59637c265052e99ea7f1d7a4559eab9121cf`）。
`UPSTREAM_MIRROR=<开发树> tools/build-upstream.sh --source-only <目录> buzz-mobile` 按本清单从基线
重建源树（删除 130 条登记路径、打 `0001-kailo-mobile.patch`、放入 4 个生成物），与开发分支
逐文件比对（内容、符号链接目标与可执行位）：4965 个已跟踪路径与 4 个 vendor 文件全部一致，差异 0（2026-09-25）。补丁导出前后分别为 1654196 与 1660294 字节，均为 174 个文件差异；两份平台文案生成物不在补丁内，补丁引用本仓库的唯一生成物。清单摘要已由 `record` 按实际字节写回。

## 实测（2026-09-25，开发分支 HEAD 加 kailo 仓库当前契约生成物）

| 检查 | 结果 |
|---|---|
| `flutter analyze` | `No issues found!` |
| `flutter test -j 8` | `+1142 ~2: All other tests passed!`（跳过 benchmark 与需环境变量的 e2e）；设备重查 8 例通过，其中旧服务端无间隔时保持待激活并允许手动重查，重复触发只发一次登记 |
| `flutter build apk --debug --no-pub` | 当前 HEAD 成功，`app-debug.apk` |
| `core/verify/native-e2e.sh mobile /tmp/mob` | 当前开发树、当前 Core 容器与真实本地拓扑：登录 → 设备登记 → ACTIVE → 取连接事实 → 直连 Relay 发 kind 9 → 自建 Channel 被拒 → 撤销后被拒；`1 passed` |

破坏核验（均已还原并复验通过）：持钥证明去掉 session 标签、把结果不明当成功 → `kailo_link_test`
失败；去掉提及候选的成员限制 → channels_provider 测试失败；深链分发放过不可用链接 → 测试失败；
已读写入把 409 当成功 → 测试失败；e2e 把「自建 Channel」换成普通 kind 9 → 报「设备不得自建 Channel」；
任务状态把 `EXTERNAL_RESULT_UNKNOWN` 当作别的 code → 「结果不明与投影落后不说成功也不说失败」失败；
Dart 契约生成物换回可选枚举取 `!` 的旧版 → 任务详情解析报 `Null check operator used on a null value`。

本次已重跑原生端端到端测试、Flutter 全套测试与 debug APK 构建；还用一次性破坏确认设备重查测试会在手动重查标志丢失时失败，随后恢复并复验通过。

## 平台文案同源增量（2026-09-25）

`web/packages/platform/src/i18n.ts` 是平台 message key、en/zh-CN 文案及五组合同枚举文案的单一来源；`tools/gen-platform-i18n.py` 现在同时生成 `kailo_reason_text.dart` 与 `kailo_platform_text.dart`。Mobile 的任务、审批只读视图使用生成 key、状态、审批选择器与决定文案；`MaterialApp` 登记 en/zh-CN 与 Flutter 本地化代理，以系统 locale 选语言。Web/Desktop 仍直接读取同一 TS 表。此增量未覆盖 Mobile 其余页面，也没有改变任务、审批的只读权限边界。

本次实测：`flutter analyze` 为 `No issues found!`；`flutter test -j 8` 为 `+1143 ~2: All tests passed!`；任务/审批专项为 `+5: All tests passed!`；本仓库 `dart test test/platform_i18n_test.dart` 为 `+4: All tests passed!`；`apps/tools/check.sh --full` 十项通过，其中隔离数据库迁移实演因未提供 `DATABASE_URL` 明确跳过。故意把生成物注释改坏后，`gen-platform-i18n.py --check` 报 `out of sync`；故意把 `EXTERNAL_RESULT_UNKNOWN` 渲染为 Completed 后，专项测试按预期失败，恢复后再次通过。此次未重建 APK，也未重跑原生端端到端测试；上表中的 APK 与 e2e 结果属于上一增量。

## 登录与连接文案增量（2026-09-25）

开发分支 HEAD `c132c2175707dbc6a94604e284766e64c8aa0da9`：登录、部署配置、连接状态、管理面错误与不可用深链改读同一 `i18n.ts` 目录；配置校验返回不带语言的 `KailoConfigIssue`。IdP、网络与非契约回应的原始异常只留作诊断证据，界面仅显示共享文案及契约 reason code，结果不明仍不当作成功或确定失败。

补丁从 1660294 增至 1667987 字节，登记删除路径仍为 130 项；`--source-only` 重建后的 4966 个已跟踪路径加 4 个 vendor 文件，内容、权限及符号链接逐项比对差异 0。Mobile 整树 `flutter analyze` 输出 `No issues found!`；专项测试为 `+13: All tests passed!`；Mobile 全量 `flutter test` 为 `+1147 ~2: All tests passed!`。故意重新把原始 IdP 详情拼回连接失败文案时，脱敏测试按预期失败，恢复后专项测试通过。`apps/tools/check.sh --full` 十项通过，数据库迁移实演因未提供隔离 `DATABASE_URL` 显式跳过。本增量未重建 APK、未重跑真实拓扑端到端，也未核验 iOS 安装包；旧产物与端到端结果不能算本增量证据。

## 成员、设备、审计文案增量（2026-09-25）

开发分支 HEAD `d323bf037ec2068143b1934b098a8ac1e66565c1`：共享 TS 文案表增加 WorkspaceMembershipState、BuzzIdentityState、AuditEventType 三组完整双语映射，并由同一生成器投递到 Mobile。成员与 Workspace 列表、设备和审计视图、设置页的组织入口改读共享 key；Web/Desktop 对应枚举视图也改读同一映射。频道成员弹层的既有断言随显示文案更新，不改变成员计数、准入或动作语义。

受控补丁由 1667987 增至 1673749 字节，删除路径仍为 130 项。`--source-only` 从固定基线重建后，4966 个已跟踪源码路径内容比对差异 0，4 个 vendor 文件与本仓库生成物一致。`gen-platform-i18n.py --check`、Web 共享包测试 50/50、Flutter 整树 analyze 与全量测试通过（结构化报告 `success=true`）；故意删除一个状态映射时生成检查失败，故意把成员状态改回原始枚举时中文组件测试失败，均已还原。此次未重建 APK、未重跑真实拓扑端到端；主题与日期/复数语义的全端统一尚未闭合。

## 设置页共享文案增量（2026-09-25）

开发分支 HEAD `c3dadcd78995ea4b206b4d38ef35faf38dfb94ce`：设置页的关闭提示、外观、主题、设备连接与密钥、复制反馈、退出确认改读共享 `i18n.ts` 的 en/zh-CN key；已有的组织、重试、取消和退出 key 直接复用。未改本机主题选择器的视觉主题目录，也未宣称日期/复数规则已统一。

受控补丁为 1677568 字节，删除路径仍为 130 项。固定基线重放后，4966 个已跟踪路径逐文件比对差异 0，生成的 Mobile 文案文件与投递文件一致。Flutter 整树分析输出 `No issues found!`；全量测试 `+1151 ~2: All other tests passed!`。新增中文设置页组件测试通过；故意将生成物中的「组织」改为错误文案后该测试按预期失败，恢复后生成器同步检查通过。`apps/tools/check.sh --full` 十项通过，实际数据库迁移演练因未提供隔离 `DATABASE_URL` 跳过。本增量未重建 APK、未重跑真实设备端到端测试，也没有 iOS 构建证据。

## 主题选择器共享文案增量（2026-09-25）

受控开发树 HEAD `e4760b08efe2df21cce4f2c62fc5f736b585f160`：主题模式、预览、关闭、应用、进度与十种强调色读屏标签均改读共享 TS 目录生成的 Dart key；主题选择与保存逻辑未变。导出补丁为 1692574 字节，删除路径仍为 130 项。从固定上游 commit 重放后，4966 个已跟踪路径的字节、文件权限与符号链接目标逐项比较差异 0；生成的 Dart 文案与 vendor 文件一致。定向 `flutter analyze` 无问题，主题页 24 项测试通过，其中中文界面测试验证主题控件和强调色读屏标签。故意改坏 Dart 生成物后，`gen-platform-i18n.py --check` 按预期报告失配；恢复后通过。`check.sh --full` 十项通过，实际数据库迁移演练因无隔离 `DATABASE_URL` 明确跳过。本增量尚无 APK/iOS 安装包或真实设备端到端证据，旧证据不得转用于本增量。

## 平台时间与复数文案增量（2026-09-25）

受控开发树 HEAD `be858936a860da2773e7fda096e7c2896236004d`：任务、审批、审计与设备视图使用共享目录生成的相对或绝对时间文案；成员与密钥计数使用同源复数规则。导出补丁为 1695411 字节。固定基线重放后，4967 个已跟踪源码路径及 4 个 vendor 文件逐项比对差异 0。Mobile 整树 `flutter analyze` 无问题；全量 `flutter test` 为 `+1156 ~2: All tests passed!`。故意改坏 Dart 生成文案后，`gen-platform-i18n.py --check` 按预期失败，恢复后重新通过。本增量未生成 APK、未做真实设备端到端或 iOS 验收，不能复用前述旧产物的结论。

## 2026-09-26 任务取消契约增量

从固定 `779af8886caae1317b4de962082429867ab61503` 重放 130 项裁剪、`0001-kailo-mobile.patch` 和四份本仓库生成物成功；重建源码的 `flutter analyze` 为 `No issues found!`，`flutter test -j 8` 为 `+1156 ~2: All other tests passed!`。`baseline.yaml` 的补丁集合摘要已更新为 `sha256:62c558207887fa21baae2b3ec932ac9baa51d98986c3cb5893f1553a58340b99`，`artifact_digest` 仍为 `none`。Mobile 的任务和审批面仍只读；本次未产出 APK、未做设备端到端验收，源码通过不代表安装包交付。

## 2026-09-28 补丁合并与共享文案同步

`d1c1a1a` 把共享文案 `platform.settings.connection` 的中文由「Kailo 连接」改为「服务器连接」，但补丁内设置页测试仍断言旧文案，本次重放源树实测 `flutter test` 有 1 例失败。开发树 `/tmp/mob` 并入原 `0002-chat-time-i18n.patch` 为独立提交，修正该断言后以 `export` 导出为唯一的 `0001-kailo-mobile.patch`（HEAD `f84c81cc8241e53e5d35ed5dde57c491d4ec32b2`，130 项删除路径，1704137 字节）。开发树 `flutter analyze` 为 `No issues found!`，`flutter test -j 8` 为 `+1156 ~2: All tests passed!`；按新清单 `--source-only` 重放的源树与开发树 HEAD 加 4 个 vendor 文件逐文件比对无差异。本轮共享文案新增的创建 Workspace 键只进入生成物，Mobile 不渲染创建入口；`artifact_digest` 仍为 none。

## 2026-09-29 Android 安装包在模拟器上的端到端

输入为 `dcafb66` 的清单（`patch_series_digest` `sha256:d592c084…`，工作树无未提交改动）。
`UPSTREAM_MIRROR=/tmp/mob tools/build-upstream.sh --source-only` 重放源树后执行 `flutter build apk --profile`
（Flutter 3.41.7），产物 `dist/buzz-mobile/buzz-mobile_profile.apk`：106,104,878 字节，SHA-256
`7ecd5f7ac7facb149a1d471e9dc81c4299ff1ce11f3e32cdc829f46b4793ab11`，Android Debug 证书签名（release 需要
upload keystore，本机没有）。

**清单的 `artifact_digest` 不是 APK。** 当前值 `sha256:53beff50…` 来自对 buzz-mobile 执行
`build-upstream.sh`：清单没有 `build_dockerfile`，脚本走了镜像分支，构建的是 monorepo 根 Dockerfile，
推入的 `127.0.0.1:55000/upstream-buzz-mobile:779af8886caa` 的入口是 `/usr/local/bin/buzz-relay`。
任何 APK 的字节摘要都不会等于它；在 Mobile 有自己的打包构建文件之前，这个值不能当 Mobile 产物摘要用。

运行环境：AVD `kailo_api36`（`system-images;android-36;google_apis;x86_64`，emulator 37.1.11，无头
`-gpu swiftshader_indirect -writable-system`），Chrome 作为系统浏览器。设备 `/system/etc/hosts` 临时加入
IdP、Relay 与 Community host 映射到 127.0.0.1，`adb reverse` 转发 8080/58091/8090 到宿主。夹具
`verify_workspace --governance` 开通 Workspace（Community `vc26bcaea.kailo.local:8090`），并由另一位
Tenant admin 经 BFF 提交需要核验用户审批的 `tenant.member.revoke`。

| 步骤 | 结果 |
|---|---|
| 首次启动 | Kailo 部署配置页，三项均为空，无默认地址 |
| 填写原生入口、issuer、`kailo-native` 后登录 | 在 Chrome 打开 Keycloak，登录后经 `xyz.block.buzz.mobile:/kailo/oauth2redirect` 回到应用，设备公钥 `eb3842a2e36b…` 登记为 ACTIVE |
| 协作面 | 列出被授予的 private Channel；发送 `mobile-apk-e2e-hello`，Relay 库里存为 kind 9，由设备公钥签名；Desktop 安装包收到这条消息，Mobile 也收到 Desktop 发出的消息 |
| 我的任务 | 列出 `tenant.member.revoke`（等待审批）与 `identity.client_key.register` |
| 待我审批 | 列出另一位 admin 提交的 `tenant.member.revoke`；页首说明到 Web/Desktop 处理；详情只有状态、目标、发起人与决定，没有批准、拒绝或撤回入口 |
| 另一位 admin 经 BFF 提交 `workspace.member.revoke` 撤掉核验用户（WorkspaceMembership → REVOKED） | Relay 以 kind 9001 把核验用户的两把设备公钥移出 Channel，关闭 Mobile 的订阅（`restricted: channel access revoked`），已读状态写入返回 403，首页变为「No conversations yet」 |
| 撤权后在仍打开的会话里发送 `mobile-after-revoke` | 没有消息进入 Relay 库，界面也没有显示失败提示 |

截图、日志与数据库查询结果在 `/volumes/data/kailo/tmp/native-evidence/`（`mobile-*.png`、
`mobile-logcat-*.txt`、`relay-db-messages.txt`、`core-*.txt`）。夹具已拆除，宿主机与设备的 hosts 已恢复。

本次观察到两处问题，都没有处理：

- 设备登记后，任务里的 `identity.client_key.register` 显示「Allowed, not started yet」。库中两条都是
  `ALLOWED`/`NOT_DISPATCHED`，但对应公钥已经 ACTIVE。
- 撤权后按发送键，消息在客户端就被挡下，不会发到 Relay，所以这一步证明不了 Relay 会拒绝撤权后的发布。
  撤权后的 Relay 侧证据只有三项：roster 移除、订阅被关闭、库中没有新消息。

## 未覆盖

- iOS 未构建、未核验：需要 macOS/Xcode。iOS 原生侧仍有 Huddle 音频、推送扩展、年龄信号等上游
  代码，Dart 侧已不调用；删除与验证要在具备 Xcode 的环境里完成。
- Mobile 没有登记的打包构建文件，清单的 `artifact_digest` 目前记的是 buzz-relay 镜像的摘要（见上节）。
  上节的 APK 用 debug 证书签名，没有做 release 签名。

## 标题与启动读屏显示名修正（2026-09-30）

`lib/app.dart` 的窗口标题复用已有 `platformDisplayNameProvider`，没有可读名称时
显示共享中性标题；启动读屏使用共享加载文案，不再写产品名。标题回调与启动界面
均使用 MaterialApp 已解析的 locale，未新增 key、Provider、配置或 BFF 请求。
认证、Relay、主题、动画及启动对账保持原行为。

受限 cgroup 内单文件格式检查、`flutter analyze --no-pub lib/app.dart`、已有
widget/indicator 三项回归均退出 0；检查日志为
`/volumes/data/kailo/tmp/codex-mobile-display-checks-20260930.log`，13.750 秒。
未改测试、未安装或升级依赖、未构建 APK，不把这三项回归写成真机名称刷新、换服、
实际读屏或当前安装包的验收。Mobile release 签名仍为原阻断。

## Automation 受权只读管理视图（2026-10-02）

本轮实现按 REQ-21、REQ-08、DD-107、`.design/17-Agent管理平面设计.md` §8，沿既有 Settings→Workspace 管理面提供 Automation 列表/详情。只消费本批生成的 Automation Page/Detail/View、封闭状态枚举与同源 en/zh-CN message keys，不增加 Dart 类型、私有文案或权限权威。实现与验证在私有候选 `/volumes/data/kailo/tmp/codex-automation-integration-20261002.bOjEqV/apps`，正式工作树与正式 Git index 未写入。

实际 4 个源码路径：

- `collaboration/mobile/lib/shared/platform/platform_views.dart`：原 NativeSession GET 的受权分页/精确 ID 消费者。
- `collaboration/mobile/lib/features/platform/platform_agent_installation_workspaces_page.dart`：既有 Workspace 选择入口中的 Automation 只读链接。
- `collaboration/mobile/lib/features/platform/platform_automations_page.dart`：受权列表、原游标前后页与详情导航。
- `collaboration/mobile/lib/features/platform/platform_automation_detail_page.dart`：Resource、owner、executor、pin、Version 与 Grant 记录及独立分页。

调用仅为 BFF `GET /api/v1/automations?workspaceId&offset` 与 `GET /api/v1/automations/{resource_id}?versionOffset&delegationOffset`。每次认证、scope、owner、native projection 与 Asset read 授权仍由 BFF fresh 核验；客户端只拒绝矛盾的 scope/ID/游标/重复数据、未知枚举、无 pin/grant 的 ENABLED、非 PUBLISHED 的已见 pinned Version、无效内容或 Grant 引用，不将本地一致性判断当授权。只读页不消费 `canCreate/canManage` 成为写入口，不生成 create/publish/enable/pause/disable/run、ActionSubmission、runtime 调用或 WebView。原 PlatformAsyncView 保留登录失效、确定拒绝与 UNKNOWN 的区别，错误不降为受权空列表；Version 内容仅是 BFF 受权返回的既有 Core 自有 AutomationVersion，临时显示而不持久化。

最终 4-path 窗口 540+/26-（含两份既有 owned 文件的 Dart 格式化），原件 `/volumes/data/kailo/tmp/codex-automation-integration-20261002.bOjEqV/mobile-window.diff`，SHA256 `0e91bb075ba63eaf80226573748ba2812c59e1e05caf907446bc3d1e140f8065`。原两文件 before 保存于 `/volumes/data/kailo/tmp/codex-automation-mobile-before-20261002.jLcomU`，两新页在窗口前不存在；最终字节清单为同一候选父目录 `mobile-source-final.sha256`。源码于 22:24:58 UTC 停写，反向 apply 检查与 `git diff --check` 实际退出 0。

### 实际窄验证与失败原件

复用固定 Flutter 3.41.7 镜像 `sha256:644e3cea0a8440ce75804b67ceab77b16a87b39d9e9d89b07aceca7a98af1aa3`、当前 UID:GID、Data 缓存和原 Flutter 工具缓存。每次按原 `container_resource_preflight` 与 `container_verify_limits` 核验，实际 Docker 限额 4 CPU/8 GiB memory=memory+swap；宿主不执行 Flutter。以下日志均位于 `/volumes/data/kailo/tmp/codex-automation-integration-20261002.bOjEqV/`：

- `mobile-readonly-verify.log`（SHA256 `69872a1dabfa070b5bcde84965edcfaa54e8db1b9a6ffd416b0bce890337b48f`）：临时执行 launcher 首次参数续行错误，退出 127，未创建 SDK；按既有数组 launcher 纠正，不改检查门禁。
- `mobile-readonly-verify-corrected-launcher.log`（`2e08a3e91531df43d108820817e8bf122283ffcf61f60404037c8ec598bbb106`）：两处 `curly_braces_in_flow_control_structures`，SDK/attach 1；直接把这两处现有条件补为完整 block，规则不变。
- `mobile-readonly-verify-braces-corrected.log`（`94388a008c6a53bf4269c681fe40cdbadd68974646962e8f6f57eca031ca4361`）：4 文件 analyze 0，既有测试实际 14 通过/11 失败。新 Automation 行仅以 workspace.name 作 subtitle，导致原 Installation 的 `tap('Ops')` 同屏出现两个精确目标；实现改为真实 name+slug 区分导航上下文，未改测试/夹具。
- `mobile-readonly-verify-navigation-corrected.log`（`b8e4cb0921bdc6437c0cac5d416daeae4d1eb6208512bb245e4e2f07de7d8eb4`）：`flutter pub get --enforce-lockfile`、四 owned 文件 `dart format`、`flutter analyze --no-pub <四文件>` 与 `flutter test --no-pub test/features/platform/platform_pages_test.dart test/shared/platform/platform_read_state_test.dart` 实际 SDK/attach 0；输出为 `No issues found!`、`+25: All tests passed!`。
- `mobile-readonly-thread-mutation.log`（`5bd3552a0c75b51dcd18a24f5ea9cf7ef36596bbea27fcc63e69e38b6ea5af64`）：通过后将 reader 的 `ResultTarget.TRIGGER_THREAD` 暂改为契约不存在的 `ResultTarget.CHANNEL`，现有分析器实际退出 1、`undefined_enum_constant`。反向补丁还原后原文件 SHA 完全相同，输出 `mutation=unsupported-thread-enum exit=1 restored=true`；同容器再次分析四文件 0，整体 SDK/attach 0。该负向只证明类型检查能发现不支持的目标，不冒称运行或业务授权已验收。

未新增测试、夹具、业务对象或独立检查脚本。25 项是已有页面/读状态回归，不是新 Automation 正向场景。未进行真实受权 Automation 列表/详情端点正向、真机交互、APK/iOS 构建、release 签名、部署或本刀提交/push；未重跑全量 Flutter/full/端到端，未把空数据库、旧安装包或上文历史产物移作本增量证据。只清理本人 4 个已退出 SDK 容器，日志、镜像、Data 缓存与其他 lane 的容器保留。

## Definition、Version 与 Memory 只读功能批（2026-10-03）

现有 Workspace 管理入口增加 Definition 分页、受权详情与 exact PublishedVersion，
Installation 详情接 Memory core/entries/entry 的原 BFF typed query；取消只展示
原 Task phase/evidence，cancel accepted 不作为已取消终态。
DD-74/75、REQ-21 与设计17/19的端边界不变：无 Memory 写、运行命令、
组件宿主、文档编辑或 WebView；未知枚举和 scope/pin 不匹配不渲染成功。

在同一选定输入的原 Flutter SDK 上，八源 dart format/check 未产生格式变化，
dart analyze 为 0，原 `platform_pages_test.dart` 实际 63/63、退出 0。
原件在 `codex-memory-ui-selected-verify-20261003.pxMZ6I/`，
`terminal-receipt.json` SHA 为
`edb98fbe8292b456aa71b865b892a545d2e42646e25ddfa72586f3c9831ed2b9`。
与共享 UI 一起记录的 22 路径最终摘要为
`d65adf01a7b4bd41c0b4a0236f4378cc0afcf677726124befabc6519293b9d9e`，
不是整个仓库或 Mobile release 的证明。13 条 Dart 文案由原同源生成器补齐。
SDK 实际4CPU/8Gi、swap0、UID1000；停止清理的 idle tail 137 与检查退出0分开，
OOMKilled=false。本轮未做新破坏、签名、真机/BFF业务 E2E或安装包构建，
不将前一输入的反例、旧25项或静态枚举检查替代这些验收。
