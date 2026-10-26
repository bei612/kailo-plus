# DD-151：Android 原生推送消费者与公开配置追溯

## 范围与固定来源

上游证据为 Buzz `779af8886caae1317b4de962082429867ab61503`。该树的
`mobile/lib/shared/push/push_bridge.dart`、`ios/Runner/AppDelegate.swift` 与
`mobile/lib/features/settings/settings_page/notifications_section.dart` 提供原 MethodChannel、
通知开关和点击接缝；固定原 Android 没有 FCM 注册、刷新及通知点击桥接。本批复用原接缝，
以官方 Android SDK 补足该平台，关联 DD-151、DD-75/79、V-SCN-249/250。

开发分支为 `codex/dd151-android-push-20261026`，比较基准
`8f346c19f0bbfdf0c09031ee1452927522c602dc`。本批不修改 PushRegistration 契约、数据库、
Core 准入、设备密钥托管或通知读权威，不引入原 buzz-push-gateway、第二设备授权或设备回执权威。
Core 的唯一增量为 `decide.rs::fcm_message` 的 `android.notification.tag`，继续使用原折叠键。
独立提交 `2a11253265b9aa66b9682c8a4d0638e0fcdaa385` 已由主集成选入 `de90ddee2`；
主集成后续 `push::` 联合检查尚待其独立终态，本 Android 分支不重复认领其 Core 结果。
前一证据提交说明中的 separately validated there 表述不准确，以本条尚待联合检查为准。

官方版本依据为 [Firebase Android 安装说明](https://firebase.google.com/docs/android/setup)：
本次固定 Firebase BoM `35.1.0`、Google Services Gradle plugin `4.5.0`，使用
`firebase-messaging` 主模块；原 Flutter `3.41.7`、AGP `8.11.2`、Kotlin `2.2.21` 和锁文件保持。
原 SDK 镜像为
`ghcr.io/cirruslabs/flutter:3.41.7@sha256:644e3cea0a8440ce75804b67ceab77b16a87b39d9e9d89b07aceca7a98af1aa3`。

## 实际消费者

- `AndroidPushBridge` 在既有 `buzz/push` 通道回读原生平台、OS 权限、当前 SDK token，
  请求 Android 13+ 通知权限，打开系统设置。API 24/25 使用应用详情设置入口。
  `KailoMessagingService.onNewToken` 把新 token 交给当前 Flutter 会话；没有 Flutter 时，
  后续前台刷新向 SDK 取当前值，不在 SharedPreferences 另存 token 或后台冒用退出身份登记。
- `push_registration.dart` 同时要求原生 SDK 与 Core 对应平台能力可用；Android 使用 FCM，
  不借用 APNs 能力。仍经当前 NativeSession、本设备 CLIENT 签名证明、原 appId 和 version CAS
  登记。NativeSession 代际、读代际和待处理 token 保护身份切换、晚到读取及保存期间的 token 轮换。
  结果不明仍回读原登记，不自动重复不确定写入。
- 原 app lifecycle 前台恢复会重读权限/登记，并在已启用时无权限弹窗地取当前 SDK token；
  保存中不会发起与该 PUT 竞争的刷新。iOS 对相同可选 `requestPermission` 参数保留默认 true，
  自动刷新使用 false；本批没有 iOS 设备或 Xcode 编译证据。
- [官方接收路径](https://firebase.google.com/docs/cloud-messaging/android/receive-messages)区分前台
  `onMessageReceived` 与后台 SDK 系统通知。前台使用 Core 同源本地化固定文案、原未读角标及普通
  NotificationChannel；后台点击与冷启动均从 Intent 的三项不透明 ID 进入原深链队列，频道/论坛
  内容读取仍重新授权。没有 Dart 导航订阅者时不提前 ACK；旧点击 ACK 不能清除后到的新目标。
- Android [notification.tag](https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages#androidnotification)
  用于替换通知栏已有项；原 `collapse_key` 仅作为待投递折叠依据，不能代替该字段。
  Native 前台同样按原折叠键 `notify(tag, 0, ...)`。不把供应商接受或折叠键当投递回执。
- 原设置页同时显示 Android/iOS，缺配置仍显示同源“此版本不可用”分支。Kotlin 没有独立中英文
  词条；通知正文来自 Core 原共享词条，频道名称取原部署应用名。普通 OS channel 没有 DND 绕过，
  但 Core 仍无 DND 权威；不能把 OS 呈现行为当作 DD-151 的 Core 勿扰排除已经验收。

## 原打包与发布链

部署以 `BUZZ_ANDROID_GOOGLE_SERVICES_JSON` 给出官方 Android **公开客户端** JSON，原
`tools/build-upstream.sh mobile-client` 将其作为登记的可选非密参数，原 `mobile.Dockerfile`
写入 SDK 标准 `android/app/google-services.json`。该文件不提交 Git。缺失不应用 Google Services
插件，原生能力回读不可用；已提供但畸形或 package 不匹配时由解析/官方插件拒绝。
Core FCM 服务账号、私钥、APNs 密钥绝不进入客户端；服务账号形状在传入构建参数前拒绝，
原生直接配置文件亦拒绝服务端凭据。签名四项仍走原 BuildKit secrets，缺签名仍阻断 release。

`optional_build_args` 不改变原必选参数、secret/fact 冲突和变量名拒绝规则。仅声明该字段的产物
纳入公开参数值摘要，含可选缺失、应用名和 Firebase 配置字节；摘要进入 `build_config_digest`
及原 `source_digest`，BuildKit 同时消费实际 ARG。其他历史产物的摘要算法不变。

原 release node 仅回传所选 CI environment 值的 SHA-256/缺失状态；原规划和构建复用 key 消费
同一摘要，原 `generated_metadata_diff` 写回必须匹配规划 source/config。开发机不需要配置原文，
不从环境猜测远端已构建值。队列在 CI 配置变更前启动时仍以其冻结环境构建，摘要不符会拒绝写回。

同一 source commit 的发布日志若已开始 build 或下游阶段，公开配置或关联输入 key 改变时，
`Release.plan` 在覆盖旧计划前拒绝恢复，不沿 `done(stage)` 跳过旧构建/记录，也不清日志或自动
重放 UNKNOWN。可恢复原冻结配置续跑，或以新 source commit 重新规划；只有尚未执行的只读计划
允许替换配置。没有修改实际 CI 部署配置，也没有调用 release 或部署。

## 已完成定向证据

所有执行均在原受限 SDK；未调用宿主 Node/Cargo/Go/Dart 工具链。原工具 SDK 固定为
`sha256:3007729eb192341a4f004a88e42e1e66c94fc67d763acfc96568bd7311116018`。

| 范围 | 固定源码 | 真实结果 |
| --- | --- | --- |
| Mobile 原消费者 | `76a879c218c7f9e519e0baaea9fc380249deeda6` | Flutter 3.41.7 / Dart 3.11.5，1 CPU / 4 GiB；冻结 pub、6 文件格式零变化、analyze 无问题、28 项通过 |
| Android 原生 | `d096d4a50eab218c7fb5abb8867eef14d05f7b19` | 原 Flutter SDK 2 CPU / 8 GiB，冻结 pub，debug APK 构建成功，原 AndroidPushTarget 2 项与故障恢复通过 |
| 原构建/发布工具 | `d096d4a50eab218c7fb5abb8867eef14d05f7b19` | 原工具 SDK 1 CPU / 2 GiB；4 项配置追溯、92 项原 release 检查、shell 语法及 Core 2021 edition rustfmt 通过 |

Mobile 三次真实故障注入分别把 FCM 改回 APNs、移除无导航监听者时的 ACK 保护、移除读取代际：
原消费者分别断言 `FCM/APNS`、`null/handled`、version `2/1` 不同而失败；每次逐字恢复后同一
检查通过。不是编译失败替代业务失败。恢复后 `push_registration.dart` SHA-256 为
`4792478b708d72da37a4d66edc0b0e4fe56d3f453d4657d466833ebbf21e1bd2`，
`push_bridge.dart` 为 `e3f6191092df6c81cf716e6c5632d5b312d2c5876189a5a8dd991e8ceccf3d88`。

工具两次故障注入分别去掉恢复守卫、把配置摘要从源码摘要断开：真实 run 的六种已有阶段/UNKNOWN
场景确实越过拒绝点并失败，配置变化也被错误视为同一 source 而失败；逐字恢复后对应 2 项与
4 项检查通过。恢复后 orchestrator SHA-256 为
`cad0284b505fabda4204c39d14b12f05f029053b3433cef9c8a94dce0cddb3ce`，
upstream manifest 工具为 `e45fde47c992a6adc09941a2d5f9c43ab4229d367f26e417e04843f426ea828f`。

原件位于 CI `/volumes/data/kailo/verification/buzz-r10/`：

- `flutter-android-push-final-76a879c21/check.log`：
  `426b04d3231418b0c5d27d96892b27ce550d0168052554372fbb4acb39d8ec27`。
- `android-build-config-final3-d096d4a50/check.log`：
  `6dc30befd57b95d49c1db884d201e575c79c5a10e4af6e7f1c2e8ef0cc468833`。
- `flutter-android-native5-d096d4a50/check.log`：
  `ffb4b3273bdbc72a3a07f28f33e9ce5207252ea93a381ac03125ea8f1a0b3c6c`。
- `flutter-android-native6-d096d4a50/check.log`：
  `1f38e07baf1b66a540ea8105a20885a24919c761ef3cfa434af8139c1142d5a4`。
- `flutter-android-native7-d096d4a50/check.log`：
  `a424163d667abaaa7f81396f2ec7f0bd618e9a99c9338160cb1b1d8402d3bdc8`。
- `flutter-android-native4-6766101c1/memcg-oom.log`：
  `6864e9da2e807a2a6b9f80ac58ab2f4ba38c97006e3a725647a19fbb2497e170`。

## Android 原生与发布边界

早次 Android 构建遇到 Maven TLS 下载失败；CI 原 Docker proxy 已投递给容器，但 Java 需消费
对应 systemProp，检查导出使用同一代理，没有降 TLS 或替换产品仓库/依赖。中止下载的本批临时
NDK 被隔离后由原 SDK 重取。固定 `6766101c1` 的 2 CPU / 4 GiB 原构建在 20:07 UTC 触发
memcg OOM：内核记录精确匹配检查容器 `388799cd...`，DartWorker 触发，Java PID 1604110 被杀。
该结果不计为 Kotlin 编译通过；原始失败与限额回读均保留。

同一原 SDK 以 2 CPU / 8 GiB（swap 同限）回读实际限额后，固定 `d096d4a50` 的
`flutter build apk --debug --no-pub` 641.3 秒成功，原 Gradle 原生测试亦成功。检查导出仅限制
Gradle JVM heap 1.5 GiB、metaspace 768 MiB、单 worker 和 Kotlin 进程内编译，未修改产品 Gradle
文件或依赖。debug APK 的
SHA-256 为 `ee30a78a86880e38062eeec900c0c2067e8113163298603ed1a7acae4b875c13`，
它不是签名 release 交付制品。native5 脚本随后因故障注入字段写错而退出；native6 改正脚本后
原 AndroidPushTarget 2 项通过，故意无条件清除 pending target 使其中 1 项断言失败，逐字恢复后
2 项再次通过。恢复文件 SHA-256 为
`b4726660afd73c81e5002fc0f6bcbb8c6b0cc15ba02aa0dc0bc4309acd2d662b`。两轮 memory.events
均为 oom/oom_kill 0，没有改变产品依赖或降低检查范围绕过 4 GiB 失败。

native6 的官方 `processDebugGoogleServices` 已成功，但检查脚本使用旧插件输出路径，读取 XML
时失败；原日志保留，不把脚本 exit 1 写成整体通过。接续同固定源码的 native7 使用 1 CPU / 4 GiB，
只运行官方配置任务并核对实际 `generated/res/processDebugGoogleServices/values/values.xml` 的
appId、senderId、projectId；三者吻合公开 fixture。随后仅含 `type=service_account` 的无凭据
反例由 Gradle 确定拒绝，配置文件移除，脚本整体 exit 0。该轮 oom/oom_kill 亦为 0。
所有本批 Android 容器均已清理，并回读 `docker ps -a` 确认无残留。

真实 Android/iOS 权限弹窗、系统设置返回、设备冷/热点击、供应商投递、FCM 项目与设备配置、
APNs entitlement、签名 release 和安装验收仍未提供证据；测试公开配置不能作为真实 Firebase
项目或投递成功证据。没有部署 Core、Worker、Web、Windows 或 Mobile，也没有新的发布制品 digest。
