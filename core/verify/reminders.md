# 原版 Inbox 提醒与本人加密事件接线

本记录是 REQ-24 的阶段源码证据，不是完整 Buzz 恢复、生产发布或三端验收。

## 固定来源与四步边界

1. 权威：DD-72／DD-75／DD-77 的身份托管边界及 SS-WEB-RELAY。固定 Buzz
   `779af8886caae1317b4de962082429867ab61503` 的
   `desktop/src/features/reminders/lib/reminderService.ts::parseReminderContent`、
   `parseNotBefore`、`createReminder`、`completeReminder`、`snoozeReminder`、
   `cancelReminder`，以及同目录 `reminderFilters.ts`、`timePresets.ts` 和
   `desktop/src/features/reminders/ui/RemindMeLaterDialog.tsx`、
   `RemindersPanel.tsx`、`SnoozeMenu.tsx` 是本批原语义与呈现来源。
   `desktop/src/features/home/ui/HomeView.tsx`、`InboxListPane.tsx` 和
   `desktop/src/features/messages/ui/MessageRow.tsx` 提供实际列表与触发入口。
2. 影响：共同 TypeScript 主体承载原弹窗、预设、完成／稍后提醒／取消和
   Inbox 混排行。Web 经 BFF 使用当前本人 ACTIVE SERVER key；Desktop 沿
   `desktop/src-tauri/src/commands/identity.rs` 的原 NIP-44 自加解密语义，
   只使用当前本机 CLIENT key。仅新增三份 typed BFF 契约与原发布账本 kind
   CHECK；不引入 Reminder 数据表、平台 Workflow 或第二提醒状态权威。
3. 副作用：正文和预览只在原 Relay 的本人签名 kind 30300 密文中持久化。
   Core 的 publish_attempt／DISPATCH 沿既有引用与摘要记录，不写明文。
   解密得到的 target 不是身份或授权；读取原消息先后均经当前 channel/scope
   检查，资料与导航也使用现有真实授权消费者。查询返回前重查身份与准入。
4. 异常：未知 status、坏密文和畸形 target 按原解析规则忽略；错误签名、
   非本人事件或错误 kind 不作为查询结果。达到实际 Relay 查询上限返回
   LIMIT，不把截断页当完整快照。未知发布回执继续 UNKNOWN；新 head 或
   expiration 导致原 eventId 不可见不证明未投递，不重签、不重发。
   租户／身份／scope 变化关闭后续读取与写入。并发原替换事件仍由 Relay
   timestamp/eventId 规则裁决，本批未声称跨会话原子 compare-and-swap。

## 原样、迁移与授权差异

- 共享迁移：原筛选分组、时间预设、Reminder 弹窗／菜单／详情与 Inbox
  混排消费者；Web/Desktop 共用这些实现，不另造缩减的提醒后台。
- 共享迁移：固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的
  `desktop/src/features/messages/ui/MessageRow.tsx::MessageRow` 原
  `hasActiveReminder`／`bg-blue-500/10` 接入共用
  `client-kit/ts/platform/src/react/messages/MessageRowSurface.tsx::MessageRowSurface`。
  Web 的 ChannelPane／ChannelThreadPane 和 Desktop 的 MessageRow 直接消费同一实现。
  写入者仍是现有 RemindMeLaterProvider 的 scope/pubkey 隔离查询，行只读取 pending
  target eventId 集合；done／cancelled、空集合及无 Provider 不显示底色。
  此呈现补齐没有字段迁移、旧格式、新状态或写副作用，不更改权限／额度／发布对账，
  `apps/06` §4 的既有错误传播不变；不把蓝色底色当作执行成功证明。
  Mobile 消费者及三端设备验收仍未完成。
- 已授权治理改造：原写服务拆到两个既有宿主；Web 在 Core 读取实际原消息
  生成预览，Native 在当前 Relay 会话重新读取。原自加解密使用 NIP-44 v2；
  Web 不读取 CLIENT 私钥，Native 不使用 SERVER 私钥。
- 已授权治理改造：原 200 条常量查询改为运行时投递上限并拒绝潜在截断；
  原可替换事件更新先核当前签名 head；原写调用接已有发布幂等／对账。
  本地恢复引用只有 scope/pubkey、幂等 key、已签名 eventId 和请求摘要，不存
  正文、ciphertext、完整签名事件或私钥；重启后只观察原引用，缺证据不另发事件。
  摘要直接复用已安装的 `nostr-tools/nip98::hashPayload`，覆盖 operation、
  eventId、sourceEventId、channelId、notBefore、note；恢复槽缺少摘要或请求
  改变时保留原槽并返回 UNKNOWN，不把原 SNOOZE 的成功冒充新 CANCEL 成功。
- 已授权治理改造：Core 的旧 ACCEPTED 返回点同样调用 `confirm_accepted`，
  按原 publish_attempt.event_id 读取本人签名密文。CREATE 核当前来源 scope
  及请求实际字段，更新核已发表的 status／not_before 与原 parent_event_id；
  不读取已被替换的父 head、不向审计增加正文或正文摘要。原 event 不可核时
  UNKNOWN、请求语义不符时 CONFLICT，均不重新派发。
- 已授权语言适配：沿唯一 TS 词条与原 Dart 生成路径提供中文／英文。
- 缺失需恢复：原系统通知的水印、通知发送、音效以及 Mobile 的原提醒
  消费者仍未恢复；原侧栏徽标与共享查询刷新见下文后续批次，不能将列表
  和计数恢复称为整个原提醒模块完成。
  Native 资料沿原 getUsersBatch 保留真实 isAgent 头像形状；Web 原
  WebProfileView 不提供该字段，Agent 头像形状不计已恢复，不能凭公钥猜身份。

## 已执行检查

独立输入与日志：
`/volumes/data/kailo/tmp/web-tooltip-shared.zzIWe9/reminder-consumers.RcN79Y`；
四侧与 Core 输入：
`/volumes/data/kailo/tmp/cells-native-closure.KxbRvt/receiver-worker.W4qug0/reminder-generation.MN6PXF`。
沿现有 4 CPU／8 GiB SDK、Data 缓存执行，没有新增镜像或全量构建。

- 共享原 React 消费者 7/7，Web 原 Inbox 48/48，Native 原发布意图 13/13，
  均 exit 0。私有关闭 UNKNOWN 恢复守卫后共享 6 passed／1 failed、exit 1；
  恢复原字节后 7/7、exit 0。React act 警告保留。
- 随后修正恢复槽未绑定请求语义的问题；末版共享实际消费者 8/8、原测试
  tsconfig 类型检查 exit 0。私有去掉摘要守卫，改请求和改动作两项实际失败，
  6 passed／2 failed、exit 1；旧缺摘要槽同样拒绝，未删安全断言。
  还原与正式源码 cmp 0 后同一套件 8/8、exit 0。
- 共享与 Web TypeScript 检查 exit 0。Native 第一次类型检查发现本批漏接
  原 `KIND_EVENT_REMINDER`，修复后只剩 `localStorageSweep.ts:340` 的
  Timer 类型冲突；同容器、同依赖、同 tsconfig 的固定 HEAD 基线也仅报
  同一错误。Native 两次 exit 2 不改记整端类型通过。
- 原 `tools/gen.sh` 在 receiver SDK 两次 exit 255；原 bash trace 与直接
  Dart 回读证实其默认 `/.dart-tool` 遇只读根文件系统，不是代码断言失败。
  改用原 closure 的现有工具目录，同一冻结输入四侧生成完成；随后 i18n
  检出 `Completed`／`completed` 的 Dart key 冲突。统一 group 词条后原
  `tools/gen-platform-i18n.py` exit 0，未改 HOME 或另建工具环境。
- TypeScript `tsc --noEmit -p tsconfig.test.json` 与原 Node Reminder 往返
  1/1；Rust `cargo test --locked --offline -p contracts reminder_wire` 1/1；
  Go `go test ./internal/contracts -run TestReminderWire -count=1 -v` 1/1；
  Dart `dart test test/roundtrip_test.dart --name 'Reminder wire'` 1/1，均 exit 0。
  这四项是新样例定向往返，不冒称整个兼容门禁或全量检查通过。
- 私有生成类型把 ReminderView 的 notBefore 错改名后，TypeScript 原类型
  检查 exit 2（实际消费者读字段报 TS2339），Go 和 Dart 原往返分别 exit 1，
  明确捕获该字段丢失。恢复生成字节后 TypeScript 类型＋往返 exit 0，Go／
  Dart 同一原往返各 1/1、exit 0；未修改正式生成物来制造通过。
- Native 末版 getUsersBatch 原消费者的类型回读仍 exit 2，仅保留基线已有的
  localStorageSweep Timer 冲突，没有新增 ReminderHost 错误。
- 最终同批修正该 Desktop 门禁的唯一类型声明：固定 Buzz
  `779af8886caae1317b4de962082429867ab61503` 的
  `desktop/src/shared/lib/localStorageSweep.ts::startLocalStorageSweep`
  原用 `typeof window.setInterval`。迁移环境混入 Node overload 后改取
  `Window["setInterval"]` 的返回类型；属于宿主类型适配，不声称逐字原样。
  影响仅类型擦除，无运行时、持久状态、迁移或六类错误行为变化，Web／Mobile
  无代码变化。原 Desktop `./node_modules/.bin/tsc --noEmit -p tsconfig.json`
  与 `node --experimental-strip-types --test src/shared/lib/localStorageSweep.test.mjs`
  13/13 均通过，64373 exit 0；此前相同输入依赖的基线失败日志仍保留。
  实际日志 `native-timer-correction.log` 的 SHA-256 为
  `178813593f1e1b5a12cc9808b867f6ceac432d6c4a58d3e57eb56dce80c3a03a`。
- 原 `tools/gen-registry.py` 在独立小输入 exit 0（25 能力、20 封闭 kind），
  产物只增加 collab.reminders 三路由与一动作；在途 Core 输入未热替换，
  此登记不单独证明最终 BFF 已上线可达。
- 基于主线 `55cced4d6de4da9be15a7ce74156337dac0187ae` 与本批精确 schema／
  TS 词条，在独立 `reminder-final-gen.KgEYGx` 再运行原生成入口 exit 0；
  四侧保留已提交 receiver 字段，Dart 词条与候选逐字节相同，未覆盖公共生成物。
- 最终生成输入的 Go／Dart Reminder 往返各 1/1、exit 0。TS 首次误调用
  旧 Web `.bin/tsc`（6.0.3）退出 2；保留 `ts-roundtrip-final.log`。改回本批
  原命令 `node node_modules/typescript/bin/tsc`（5.9.3）后类型与同一往返
  1/1、exit 0，没有更改类型配置、断言或安装依赖。
- 桥接 `cargo test --locked --offline -p collab-bridge reminder` 1/1、exit 0，
  实际验证 NIP-44 明文往返、异身份、错误 kind、损坏密文及 CLIENT custody
  拒绝；首轮 Timestamp 弃用警告保留，后续末版结果单独记录。
- 首轮 Core 命令漏加 `--bin platform-core`，因此额外编译原有集成目标；
  SDK 实测接近 8 GiB 硬上限、OOM 为零。经主线确认后只向本条 Cargo、
  rustc 及链接子进程发送 TERM，原句柄 70509 实际 exit 143，Core 零断言。
  未清缓存、未改变 Cargo 并行度，后续限于最终输入的原二进制定向验证。
- 随后原句柄 58348 exit 101：私有输入遗漏已提交的
  `contracts/adapter/file_storage.v1/registration.json`，`include_str!` 编译失败，
  Core 零断言，后续顺序检查没有执行；没有修改正式读取逻辑。补入同一 HEAD
  的原文件并冻结本批 ACCEPTED 修复后，在同一 SDK 执行最终定向检查。
- 最终聚合句柄 80984 exit 0：`platform-core --bin platform-core reminders::`
  两项通过；`generated_registry_closes_unreleased_user_entries` 一项通过；
  `collab-bridge --lib reminder` 一项通过；`contracts --test roundtrip reminder_wire`
  一项通过。均使用 `cargo test --locked --offline`，没有编译所有 HTTP 集成目标。
  实际桥接检查包含 NIP-44、本人签名、篡改时间戳拒绝与 custody 边界。
- 私有输入删除 CREATE 的 note 比较后，原签名明文／请求语义断言实际失败，
  31662 exit 101、0 passed／1 failed；正式源码没有修改。还原后 cmp 0，
  原 `reminders::` 两项通过，74543 exit 0。该反证证明语义检查能捕获误认，
  不将已复核的 HTTP 调用接线冒充实际 HTTP 请求验收。
- 最初 Web SDK 执行命令漏投递 TMPDIR，实际 Node 临时目录为容器 `/tmp`；
  源码、日志和依赖均在 Data，但不能声称此前所有临时写入均在 Data。
  后续命令明确设置 Data 私有 TMPDIR 与 npm cache，不通过重跑覆盖原记录。

## 尚未取得的验收

频道提醒底色的后续定向验证复用上述同一 SDK 和私有输入：
`node node_modules/typescript/bin/tsc --noEmit -p tsconfig.test.json` 与
`vitest run test/reminders.test.tsx test/message-row.test.tsx`，82421 exit 0，
分别 9/9 和 17/17。首轮错误调用 `.bin/tsc` 实际为 6.0.3，CSS side-effect
import 的 TS2882 导致 79770 exit 2；项目原 5.9.3 通过，没有放松类型配置。
仅在私有输入移除原底色 class 后，相同消费者断言报 `expected false to be true`，
30329 exit 1（1 failed、8 因定向筛选 skipped）；精确恢复后与正式源码 cmp 0，
4364 exit 0、26/26。原输出保留 React 异步更新的 act 警告，不声明无警告。
日志为同目录 `channel-reminder-tint-positive.log`、`channel-reminder-tint-toolchain.log`、
`channel-reminder-tint-mutation.log`、`channel-reminder-tint-restored.log`。
这只是原共享消费者的状态／class 验证，不是浏览器像素或真实提醒发布验收；
未为该小改动重复运行全量、部署或重新生成契约。

Core 首轮中止和第二轮漏依赖失败均保留；末版语义检查与注册消费者已执行，
不等同真实部署的 BFF／Relay 联调。
原 `core/crates/platform-core/tests/web_transport.rs` 新增真实 HTTP 恢复场景，
复用原生命周期夹具，覆盖相同意图、改 note／时间、SNOOZE 改 CANCEL 及
旧可替换事件不可见；本批未编译或执行该集成目标，不用旧线上 Core 跑出
HTTP 成功作为替代。迁移实际
up/down、真实 Relay 成员 kind 投递、真实 BFF 授权与发布对账、原生安装包、
新版浏览器操作和截图均未在本批完成。当前在线 Web 仍是
`9d718234b74b688d9b81816f9b67470d4fc80440`，不能用其旧图认领这些源码。
本批未运行新的 `check.sh --full`，未部署；已知全量失败与生产发布阻断继续保留。

## 2026-10-12 原侧栏到期提醒徽标

本节是独立后续源码检查点，不改变以上各次检查的输入和失败记录。

1. 权威与四类差异：固定 Buzz `779af8886caae1317b4de962082429867ab61503`
   的 `desktop/src/features/reminders/hooks.ts::useDueReminderBadgeCount`、
   `desktop/src/app/AppShell.tsx::AppShell` 在原 feed 计数上相加到期提醒；
   `desktop/src/features/sidebar/ui/AppSidebarPinnedHeader.tsx::AppSidebarPinnedHeader`
   保留 Inbox 激活时的提醒计数及 99 显示上限。原样保留现有徽标 JSX、样式、
   原 `countDue` 的 pending／notBefore 判据；共享迁移原
   `desktop/src/features/reminders/lib/reminderNotificationPoll.ts::startReminderNotificationPoll`
   到共同提醒模块，文件与固定源逐字节相同。原 30 秒间隔不是本批新增产品配置。
   原 `desktop/src/features/reminders/useReminderNotifications.ts::useReminderNotifications`
   中的共享查询失效刷新迁入唯一共同 Provider 消费的徽标 hook；只迁移刷新，
   不伪装已经接通通知发送、水印或音效。没有复制第二份提醒状态权威。
2. 影响：共同 `AppSidebarPrimaryMenu` 消费现有 RemindMeLaterProvider，
   Web PlatformApp 和 Desktop AppShell／AppSidebar 只投递现有 homeBadgeEnabled。
   同一 scope/pubkey 查询负责列表、消息底色及徽标，没有新增数据接口、契约、
   持久状态或三端迁移。和原版一样，关闭徽标只隐藏该计数，不停止其他消费者
   正在使用的提醒查询；Inbox 激活不抑制到期提醒数。
3. 副作用：授权治理接缝不变，刷新仍调用当前 SERVER／CLIENT 宿主的既有
   query。查询拒绝后不继续暴露旧计数／pending 底色，不把隐藏数字视作成功读取。
   dataUpdatedAt 使内容不变的成功回读也重算到期时间，避免 React Query 的
   结构共享使数字停在加载时。没有新增发布、副作用重试、审计正文或凭据路径。
4. 异常：空集合为零；done／cancelled 不计数；未来提醒跨 notBefore 后在原
   调度下一次成功回读时增加；原查询失败继续使用既有错误路径，不生成成功终态。
   scope／pubkey 变化清理旧 interval，旧请求完成只写其原 query key，不进入
   新身份徽标；卸载沿原返回清理函数取消 interval。未新增六类错误或状态枚举。

实际检查使用原 `kailo-web-thread-tooltip-sdk`：4 CPU、8 GiB，memory+swap
总限额等于内存（无额外 swap）。开始时只有 sleep，MemAvailable 约 33.7 GiB。
源码／依赖挂载、TMPDIR 和 npm cache 都指向既有 Data 路径，没有新增镜像、
安装依赖、全局构建或整树导出。源码输入沿原 `reminder-consumers.RcN79Y` 复用；
本批日志独立保存于
`/volumes/data/kailo/tmp/web-tooltip-shared.zzIWe9/reminder-badge.qntxlD`。

- 首轮 46460 exit 1：共享类型通过；两套件 21 passed／2 failed，新增侧栏
  场景因 jsdom 缺少 matchMedia 在挂载失败。补入既有 sidebar-shell 相同的
  浏览器 fixture，不改正式响应式逻辑或检查超时。`positive.log` 原件保留。
- 22012 exit 0：`node node_modules/typescript/bin/tsc --noEmit -p tsconfig.test.json`，
  `node node_modules/vitest/vitest.mjs run test/reminders.test.tsx test/sidebar-shell.test.tsx --no-file-parallelism`
  共 23/23，随后 Web／Desktop 原 `./node_modules/.bin/tsc --noEmit -p tsconfig.json`
  都通过。日志 `positive-fixture-corrected.log`。后续没有重复两宿主类型检查。
- 将取消证据改成真实 `useReminderMutations.cancel` → publish → invalidate →
  query 消费，并加入切身份前在途旧查询晚返回检查。21890 exit 2：fixture 的
  字符串不符合生成的 ReminderStatus；改用既有 parseReminderContent 构造后，
  93848 共享类型与同两套件 23/23、exit 0。分别保留 `positive-final.log` 和
  `positive-final-typed.log`，没有放宽生成类型或断言。
- 实际 React 消费者使用原 interval，推进 30 秒虚拟时钟验证同一未变 head
  到期后 2 → 3；关闭为无徽标，重新开启恢复；真实取消回读后 3 → 2；
  100 个到期提醒显示 99；切身份清计数且旧 timer／晚返回不串入；拒绝读取
  后清除已有徽标。这是 DOM／查询边界证据，不是 HTTP 或真实用户提醒投递验收。
- 私有输入同时移除 poll 的 invalidate 及计数 isSuccess 守卫，61633 exit 1：
  原两断言分别捕获查询未刷新（预期两次、实为一次）及拒绝后旧数字仍存在；
  21 passed／2 failed，日志 `mutation.log`。恢复所有九路径与正式源码 cmp 0，
  18479 同两套件 23/23、exit 0，日志 `restored.log`。React act 警告保留。

全量缺项保持：固定原 `desktop/src/features/home/lib/inbox.ts::buildInboxItems`
消费的 needs_action 来自 46010／40007。当前
`collaboration/crates/buzz-db/src/store/feed.rs::build_needs_action_query` 保留读方，
但 Core／Worker 没有该审批／流提醒事件生产接缝；固定原
`crates/buzz-workflow/src/executor.rs` 的 approval 分支本身也未完成该生产逻辑。
这属于仍需适配的原功能，不等于永久禁止；不以 30300 或 Core 审批列表冒充它，
不新增空筛选菜单。原系统通知完整流水线、Mobile 原提醒消费者依旧缺失。
本批未部署、未取新版浏览器截图、未验收 Windows／Mobile；现网仍是上述
9d718 固定版本，旧图不作为本批徽标证据。主线统一文档门禁；本批未新运行 full，
此前 full 失败与发布阻断不由这些定向通过解除。

主线集中运行原 `bash tools/check-docs.sh /workspace/.design`，90068 exit 0，
七部分全部通过；镜像 `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
实际 2 CPU／2 GiB、无额外 swap、UID 1000、network none，源码只读，缓存与
临时文件位于 Data。原件 `/volumes/data/kailo/tmp/reminder-badge-docs.JnHGfR/check-docs.log`，
SHA-256 `fd80c99ee061f794b23f66fb4d4335b6ebb23582d56ffff0d254697d44edf617`。
该入口覆盖顶层实施文档、docs 与设计语料，不直接扫描本回执；本回执由主线
对照命令输出与完整 diff 复核。没有把文档通过计为 full 或线上提醒验收。
