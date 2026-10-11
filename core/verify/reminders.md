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
- 缺失需恢复：原系统通知、通知轮询、应用侧栏徽标以及 Mobile 的原提醒
  消费者不在本批已完成范围；不能将已恢复列表称为整个原提醒模块完成。
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
