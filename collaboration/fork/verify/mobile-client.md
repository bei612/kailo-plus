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
