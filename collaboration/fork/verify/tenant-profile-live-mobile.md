# DD-158 Mobile 跨会话资料读取与失效

本批从集成源码 `9e983f42126be45e3cea62d689d225a604bc4917` 建立独立验证分支。
只接续 Mobile 原生消费者、实际显示和回归，不修改 API 或四侧生成物，未打包或部署。
Core 的有界读取、PostgreSQL 通知及 Web/Desktop 证据由集成批分别核验。

## 消费与清空边界

`tenantProfileLiveProvider` 沿本人 NativeSession 请求原 BFF 资料读边，按 Core
返回的版本等待更新。前后台与恢复网络沿原 `AppLifecycleNotifier`，不另起定时
轮询配置。NativeSession 的 `credentialGeneration` 和 provider disposal 共同
阻止旧身份回包；调用方使用 `unwrapPrevious()`，不把刷新前的其他身份值作当前值。

实际检查发现：StreamProvider 收到后续 403 后直接结束，会继续持有此前的
`AsyncData<TenantProfileView>`，`unwrapPrevious()` 也不能清除它。本批改为可空
的本地流：403、登录过期和已换登录代际明确产生空快照、失效原 session view，
然后停止。没有伪造空 TenantProfileView，没有把客户端状态作为权限权威，也不
通过 `invalidateSelf()` 制造持续 403 请求循环。

频道名称/图标及主题预览区分加载态与明确的 `AsyncData(null)`。后者不再回退到
登录时缓存的 Community 名称或 NIP-11 图标，使用原同源「社区」文案和中性头像。
新会话读取仍经原生 BFF；普通加载态保留原合法占位。

## 固定 SDK 与失败记录

使用原 Flutter 3.41.7 / Dart 3.11.5 不可变 SDK：
`ghcr.io/cirruslabs/flutter:3.41.7@sha256:644e3cea0a8440ce75804b67ceab77b16a87b39d9e9d89b07aceca7a98af1aa3`。
按工程入口预检资源并回读 2 CPU / 4 GiB 限额，只导出 GitHub 固定提交的
`collaboration/mobile` 和 `client-kit/dart`，使用原持久 pub 缓存。

- 固定 `9e983f421`：冻结 pub 成功；原 formatter 修改三文件，analyze 指出四处
  缺少花括号，退出 1，尚未执行用例。
- 固定 `19971ba47`：格式与 analyze 通过，原定 7 项通过；删除更新快照的实际
  `yield` 后跨会话用例超时失败，原文件逐字/SHA 恢复后 7 项再次通过。随后新增
  403 实际消费者探针失败：期待空值，实际仍为 TenantProfileView，保留失败证据。
- 固定 `b65c90b07`：冻结 pub、格式零变化、analyze、10 项全部通过。移除四处
  清空输出后，403、过期及替换登录的三项分别失败；逐字/SHA 恢复后 10 项通过。
  该检查也保留原更新快照反向失败/恢复通过的证据。

日志根为 `/volumes/data/kailo/verification/buzz-r10/`，上述记录分别位于
`flutter-profile-live-9e983f42126be45e3cea62d689d225a604bc4917/`、
`flutter-profile-live-19971ba47/` 与 `flutter-profile-live-b65c90b07/`。
每个目录保留 `check.log`、`result.log`、`preflight.log` 和 `limits.log`。

## 最终显示消费者终态

固定 `f23d2de522e237a6d0be08b01beb844a4439c5d7`，同一原 SDK 和限额：

- `flutter pub get --enforce-lockfile` 成功，锁文件与 Git 原件 SHA-256 相同：
  `1fd2b3b4e6c11a372b79eff70d8b81b1cddbdef81a0ccaff7ac38966bc82033d`。
- `dart format --output=none --set-exit-if-changed` 检查 12 文件，零修改；
  原 `flutter analyze --no-pub` 检查 11 个路径，无问题。
- 6 项 live consumer、原 4 项表单/控制器及 1 项真实 ThemePickerPage 组件检查，
  共 **11 passed**。组件接受空快照后，旧 live 名称、缓存名称、emoji 和图标均消失。
- 临时关闭实际 preview 的 terminal 保护，组件检查因出现 `Cached identity`
  失败；生产源码逐字及 SHA-256 还原后，同一组件检查通过。
- live/provider 与其检查文件和 `b65c90b07` 字节相同，前述两组反向证据继续适用；
  没有重复改动测试预期或省略原 NativeSession 的代际保护。

脚本最终 `source=f23d2de52 mode=profile-display exit=0`；原件目录
`/volumes/data/kailo/verification/buzz-r10/flutter-profile-display-f23d2de52/`。
该目录 `check.log` SHA-256 为
`1a3272dfc9cae19521238cf77d00b763d64ac8fb0c81ffc3f727f55c73c65be1`；
`flutter-profile-live-b65c90b07/check.log` SHA-256 为
`ad6bd7e481e785406df13377d43a53cffcbba3c6891e47fa8f21937cc25482d7`。
结束后实际回读本批 Flutter 容器为空；不占联合 Core 验证窗口。

## 验证适用范围

原生流用原 NativeSession HTTP consumer 对 scripted BFF，确认独立凭据、更新
版本查询、清图标、后台晚到结果丢弃、前台/恢复网络重新读取、终端失效清空；
这不是实际两台手机连接已部署 Core 的验收。原四项资料表单/控制器检查验证确认、
同键重试、冲突重读和身份退休。实际 ThemePickerPage 回归检查的是生产组件，
资料流和 Community 缓存由夹具注入，不代替 Core 权限或真机运行。

仍需集成联合门禁、正式 Mobile 包与真机前后台/网络切换、真实会话并发编辑及
图库权限验证。无本批 artifact digest，不声称完整 DD-158 或 V-SCN-261 已交付。
