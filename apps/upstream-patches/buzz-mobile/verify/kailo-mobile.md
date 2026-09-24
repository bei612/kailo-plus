# buzz-mobile：Kailo 一期版本的核验

## 范围

基线 block/buzz `779af8886caae1317b4de962082429867ab61503` 的 `mobile/`（Flutter/Dart，SF-MOB-01/02）。
Mobile 不是组件宿主、不承载文档编辑（REQ-21）：一期交付登录、协作数据平面（被授予的 private
Channel 里的 kind 9 消息，本机持钥直连 Relay，DD-75）与成员、本人审计、本人设备三页管理面视图。
深链进入未交付的能力返回稳定 reason code `SURFACE_CAPABILITY_UNAVAILABLE` 并指向 Web/Desktop
（V-SCN-65），不以内嵌 WebView 承载。

删除的上游能力（`remove_paths` 与补丁）：Agent 页面、Workflows、Huddle、自建 Channel 与 DM 入口
（含 DM 模型与 TTL Channel）、Component host、编辑器、表情回应与消息编辑/删除、提醒、输入中提示、
邀请、推送、年龄门禁、社区切换、成员目录搜索，以及对应的路由、菜单、依赖与 Android 原生代码。

Kailo 接入在 `mobile/lib/shared/kailo/` 与 `mobile/lib/features/kailo/`：RFC 8252 PKCE 登录（私有
URI scheme 回调，IdP 登记见 `core/verify/native-identity.md`）、刷新令牌进安全存储、401 刷新一次
重试一次、只代发 `/api/v1/`、NIP-98 持钥证明登记设备、结果不明显示为待确认。BFF 回应的类型来自
`contracts/` 的 Dart 生成物，构建时经 `vendor_files` 放入。

## 清单可复现

按本清单从基线重建源树（删除 130 条登记路径、打 `0001-kailo-mobile.patch`、放入 2 个生成物），
与开发分支 `kailo` 的最终树逐文件比对：完全一致（2026-09-24）。

## 实测（2026-09-24，开发分支 HEAD 加 kailo 仓库当前契约生成物）

| 检查 | 结果 |
|---|---|
| `flutter analyze` | `No issues found!` |
| `flutter test -j 8` | `+1137 ~2: All tests passed!`（跳过的是 benchmark 与需环境变量的 e2e；上游原为 +2251 ~4，减少的均为已删功能的测试） |
| `flutter build apk --debug` | 成功，`app-debug.apk` |
| `core/verify/native-e2e.sh mobile <源码树>` | `All tests passed!`：登录 → 设备登记 → ACTIVE → 取连接事实 → 直连 Relay 发 kind 9 → 自建 Channel 被拒 → 撤销后被拒（Relay 回 `restricted: channel access revoked`） |

破坏核验（均已还原并复验通过）：持钥证明去掉 session 标签、把结果不明当成功 → `kailo_link_test`
失败；去掉提及候选的成员限制 → channels_provider 测试失败；深链分发放过不可用链接 → 测试失败；
已读写入把 409 当成功 → 测试失败；e2e 把「自建 Channel」换成普通 kind 9 → 报「设备不得自建 Channel」。

## 未覆盖

- iOS 未构建、未核验：需要 macOS/Xcode。iOS 原生侧仍有 Huddle 音频、推送扩展、年龄信号等上游
  代码，Dart 侧已不调用；删除与验证要在具备 Xcode 的环境里完成。
- 安装包的受控构建流水线尚未建立，`artifact_digest` 为 none。
