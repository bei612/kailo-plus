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

## 清单可复现

清单由 `tools/upstream_manifest.py export` 从开发分支导出（HEAD `463d59637c265052e99ea7f1d7a4559eab9121cf`）。
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

## 未覆盖

- iOS 未构建、未核验：需要 macOS/Xcode。iOS 原生侧仍有 Huddle 音频、推送扩展、年龄信号等上游
  代码，Dart 侧已不调用；删除与验证要在具备 Xcode 的环境里完成。
- 安装包的受控构建流水线尚未建立，`artifact_digest` 为 none。
