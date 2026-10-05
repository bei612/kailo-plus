# 外部服务接入管理客户端

## 变更边界

关联 `.design/03` §3、`07` §4.6、DD-88/94。此批把已存在的
ApplicationBinding 创建、作用域查询、停用消费者连接到 Web/Desktop 共用的
`WorkspaceManagementPanels`。不实现外部服务内部管理，不复制 Cells、WeKnora 或
Wren 的后台，不将停用 Kailo binding 等同于关闭服务或删除数据。

### 动手前四步结论

1. 权威：ApplicationBinding 生命周期与元数据在 Core；执行沿原 ComponentTask，
   外部服务继续独立运行。用户明确的独立服务边界已进入设计权威
   `a689650732d05621b63cd20ac589c555b6617ac9`。原生页面承载与接入管理面不同，
   下述追加实现复用独立服务已有页面，而不复制其后台。
2. 影响：读取由 `application_binding_read.rs` 经 BFF 提供，调用方为共享
   `createBffClient.applicationBindings`；两个 React 宿主通过已有
   `WorkspaceManagementPanels` 消费同一组件。写入为原 `ActionCommand`
   的 `applicationBindingCreate` 或 `applicationBindingId/version`，不增加
   替代动作、工作流、凭据存储或数据库 writer。API 形状来自四语言契约；
   此客户端改动无数据库迁移，旧客户端不消费新查询。
3. 副作用：客户端的 `canCreate/canDisable` 仅控制呈现，实际动作仍重新准入。
   确认前只读；停用固定所读 binding version。投递结果不明锁定请求与作用域，
   后续查证复用同一幂等键。HTTP 接受不是 ACTIVE/DISABLED，不把任务提交当终态。
   元数据查询不回显 native 配置、SecretRef 列表或 service credential；创建表单
   保留管理员本次输入的配置与契约内引用，不提供密码或令牌正文的输入字段。
4. 边界：空列表明确为空，读取失败和未知枚举不显示为空；跨 Workspace 返回被拒用；
   ACTIVE 缺 projection generation 被拒用。分页沿服务器游标，不造客户端上限。
   双击由同一发送锁排除；并发版本变化由 Core CONFLICT 判定。超时后保留 UNKNOWN，
   撤权后的查询拒绝不能倒推前次写入失败。租户/Workspace 暂停、审批和配额变化沿
   原 BFF/Admission 处理，不在客户端缓存授权或补默认值。六类错误仍由原
   `ReadFailure`、`writeFailure`、`ReasonCode` 与 TaskDetail 展示，未增加错误类别。

## 三端与异常行为

- Web 和 Desktop 使用同一 TypeScript 组件与 BFF client，没有新增两套页面。
- 此页管理 Kailo 接入，已批准原生页面由独立承载区打开，不持有 Relay signer。
  原 Web 代签与 Desktop 本机持钥协作链不变。
- Mobile 不新增组件页面或内嵌 WebView；共享词条由原 i18n 生成器同步，词条存在
  不等于开放入口。
- 部分接入、崩溃重启、投影延迟和停用对账由原 binding Workflow 收敛；客户端只
  显示实际状态与本次 ActionExecution 任务引用，不实现第二套恢复调度。

## 实现后证据与验收范围

已加入现有 Vitest 工程的 `application-bindings.test.tsx`：真实共享组件发起原
BFF 请求，核对创建内容保持、精确版本停用、UNKNOWN 同键查证、作用域锁定、
跨 scope/未知状态/缺投影/缺权限字段拒用以及错误凭据字段拒用。

2026-10-05，在既有 SDK 镜像
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`
内执行；实际 CPU 4、memory/swap 各 6 GiB、UID 1000，源码和缓存位于 Data。
`bash tools/gen.sh` 四侧生成退出 0，原 pnpm frozen-lockfile 安装退出 0。
`pnpm --filter @client-kit/platform test` 包含 TypeScript 检查及现有 Vitest：
最终 12 文件、317 项通过，退出 0。初次业务检查为 316 通过、1 失败：新面板
在没有 Workspace 时多显示了无意义的选择器；已改为仅显示组织级文字，未删除
原页面断言。此前容器缺 HOME 导致 Dart 写入 `/.dart-tool` 被拒、退出 255，
按原检查入口配置容器后恢复；没有修改产品代码来掩盖执行环境错误。

实现后把 `validBindingPage` 的 Workspace 等值守卫临时移除，执行
`pnpm exec vitest run test/application-bindings.test.tsx`，实际 4 通过、1 失败、
退出 1；错误为跨 scope 页面出现 textarea，预期 null。用 apply_patch 恢复
原守卫后，同命令实际 5 项通过、退出 0。没有留下变异源码。

原日志位于 Data 私有候选 `application-binding-20261005.YVnkF3` 的父级记录：

- `binding-ui-tests.log` SHA-256
  `51aa9f072cd12f5c4e74c4ccbc8151f5c5c308df4fbd65e2b7c179706c444e8e`。
- `binding-ui-mutation.log` SHA-256
  `f135f4201bae3d97c378d5f0416c086c81cc50921fa68a2186a6aa9a4435092e`。
- `binding-ui-restored.log` SHA-256
  `e97f464369b7aeba2896c4b9546d2cc007810a9b5137f9091ceb7024a36cb1e9`。

这些定向证据不是合并批次的全量门禁、真实外部 binding 成功或部署完成。
后续机器契约变更仍须合批重新生成和兼容验证。原生管理页面嵌入、多连接选择
和个人授权路径不在这份接入管理客户端证据中冒充已交付。

## 独立原生页面追加实现

权威为设计 `07` §4.6 与 `03` 的 NATIVE_PAGE 合同。实现前影响复核覆盖
ComponentRelease 准入、ApplicationBinding 列表、BFF 页面引用、共享 React、
Desktop NativeSession/命令注册、Web CSP 与原 bootstrap 配置投递。
没有新建服务管理系统、工作流、凭据通道或后台内容代理。

- 列表的发现权限与接入的管理权限分开：scope discover 与原 Workspace 准入
  决定能否读取；原 CREATE/DISABLE evaluate 独立决定管理按钮，实际写入再次准入。
- 页面请求仅接受 binding ID。BFF 读取同租户 ACTIVE binding、批准 release 与
  同 generation 的 ACTIVE projection，核对配置/manifest digest、当前 scope
  与 fresh discover；地址只能来自 binding 配置，origin 必须属于批准 release
  与部署 NATIVE_PAGE_ORIGINS 的交集，排除平台自身 origin。
- 四侧新增 ApplicationNativePage 只含页面引用和许可来源；列表 hasNativePage
  是可选能力事实，旧客户端可不使用。无正文、令牌、SecretRef 或内部配置投影。
- Web/Desktop 共用入口与加载/拒绝状态。Web 是跨来源 sandbox frame，禁止
  顶层导航与弹窗，no-referrer；不修改第三方 frame-ancestors。Desktop 以固定
  binding 标签的独立窗口承载，只有主窗口可发起，逐次导航校验许可来源与登录
  generation，不授予该窗口平台 IPC；注销销毁窗口，构建后复核注销竞态。
- 刷新或回到平台焦点重新查权限，查证中移除旧 frame；拒绝、配置缺失、未知或
  不匹配引用不显示成功。外部服务自己的会话撤销仍由它负责，不冒称关闭窗口
  已退出其会话。Mobile 不增加页面入口或 WebView。
- PUBLIC_ORIGIN 与 NATIVE_PAGE_ORIGINS 从同一部署配置投递；后者默认空只关闭
  嵌入，不停止独立服务或工具。bootstrap 拒绝 CSP 指令、通配来源、重复来源、
  平台同源、非规范端口及控制字符，Caddy 仅扩展 frame-src，不放宽 script-src。

追加代码的后置断言覆盖同一共享页面的地址解析、原生宿主只收 binding ID、
刷新撤权移除 frame，以及错误 binding/generation/origin 的拒绝。上文 317 项
通过发生于该追加实现之前，不能用它证明原生页面已验收或实际服务已允许嵌入。

2026-10-05 06:53 UTC，追加实现的四侧生成全部退出 0；共享 TypeScript 检查与
Vitest 为 12 文件、320 项通过，退出 0。仍使用上文固定 SDK、4 CPU/6 GiB、
Data 缓存、network none。首次容器漏传既有 npm 缓存配置，生成命令报
`EAI_AGAIN registry.npmjs.org`；停止该已明确失败的执行后，按既有
`npm_config_cache=/cache/npm` 加离线模式重跑成功，没有联网升级依赖或修改契约
规避错误。原 NativeBootstrap 检查仍输出 React act 警告，未掩盖。

06:54 UTC，主动移除页面 origin 属于 allowedOrigins 的生产守卫；同一真实组件
检查得到 7 passed/1 failed、退出 1，错误为 `expected true to be false`。
用 apply_patch 还原后，同检查 8 passed、退出 0；未留下变异。
追加日志与 SHA-256：

- `native-page-cached.log`：`2b39dbdc1ed243fc133ba839ae3b84f236320616477f8e1c30522143ebe05c77`。
- `native-page-mutation.log`：`a03f7e55e7e3a9e9f1fdddbc734f45985d81d38cc8a7cd89761403cf2bb6ce03`。
- `native-page-restored.log`：`e4ec54e60180fed60ef898e398e4fa63dc540607c6db064658ed2ac0cf9a5650`。

该回执不覆盖后端组合编译、实际第三方登录/CSP、Desktop 设备、全量检查或部署。

06:56 UTC，在相同受限 SDK 中只读挂载真实部署 `.env`，原
`bootstrap.sh --validate-config` 与显式的两个合法来源均退出 0；四组非法来源
（通配、CSP 分号、路径、重复）均被原入口拒绝，检查批次退出 0。
未修改运行环境或生成凭据。`bash -n` 与新增两端 Rust 文件格式化退出 0。
日志 `native-page-config.log` SHA-256
`e97f05884513d72337bd391f40292e2853339d98186b2ae96d327e51c757c30f`。

## 合批契约与后端检查

同日将已交付 `43471e5df07a5a0e4a94b1e21ba77784fbdec7fb` 的既有增量并入候选，
保留本批接入改动；历史已交付改动不重复计为本批功能。四语言原 round-trip
消费者增加 binding observation、external execution reference 与 native page 三份样例，
核对嵌套映射、可选字段缺席、generation 与精确 origin 不丢失。

固定受限 SDK 的 `cargo test --locked --offline -p platform-core -p contracts`
通过：契约 10 项，Core 单元 178 项通过、9 项 ignored；其他原集成检查的结果与
显式忽略保留于日志。紧随其后的 Clippy 退出 101，六处错误涉及 tuple 类型、
惰性 Option、测试模块位置与冗余借用；不能将此命令批记作全通过。
此回执发生在后续派发事务修正之前，不证明该修正已验收。

`pnpm --filter @client-kit/contracts test` 的类型检查与 11 项检查、
`go test ./internal/contracts`、`dart test test/roundtrip_test.dart` 的 12 项检查
均退出 0。原 `tools/check-docs.sh /workspace/.design` 全部通过。
这不是契约兼容比对、全量门禁、第三方端到端或设备验收。

07:26 UTC，以 apply_patch 暂时移除 Dart 生成序列化器中的 secretRefDigest、
nativeId、projectionGeneration 三处实际字段，原 round-trip 命令得到 9 passed、
3 failed，退出 1；三个新增样例分别抓到丢字段。恢复后同命令 12 passed、退出 0。
生成文件恢复前后 SHA-256 均为
`eb6e45af769728f9914cf7fb6226e3c321f9ed291d027d8bb7a669ca95e4c97c`，无变异残留。

原日志位于上述同一 Data 候选父目录：

- `application-core-tests.log`：`8463f7985c786bfe1199a2ebad3014ecc248772ca96c7916986542739247c597`。
- `application-wire-check.log`：`088e8181261b23e17fdeebd147cc8128e233a88e9592a58c16613aaa7cd006c7`。
- `application-wire-mutation.log`：`ae698f3555a7d988e900fe337c12cc931c257ffd7e69c7dd7cd0f6db1da8f19c`。
- `application-wire-restored.log`：`e62688fa536caad0da85ecd99247034c3f86af3fee5c5e4f802dd4e98a1870b9`。

## 独立页面弹窗与 Wren UI 来源核对（2026-10-05）

本节对应 DD-87、`07` §4.6 的原生页面，不改变在线编辑的独立合同。
以 `d343a33ed491f12f60efbddfd973a1053461c8ef` 为实现基准，Desktop 原先
对所有 `on_new_window` 请求返回 Deny，因而不能把原生页面已经能打开等同于
该服务所有页面交互已保留。现有 `native_page.rs` 候选复用同一个窗口构造函数，
将批准来源的弹窗交给锁定 Tauri 原生 `window_features` / NewWindowResponse::Create。

四步影响说明：权威是独立页面保持原生功能与宿主隔离；影响面仅原生页面窗口、
导航和既有 NativeSession generation，Web 仍使用共用入口的 frame，Mobile 无入口；
不增加管理 API、Action、Workflow、数据副本、IPC capability 或配置项；初始和后续
URL 均校验精确批准来源、HTTP(S) 与无 URL 凭据，创建前后校验同一会话 generation，
子窗口保留原前缀而被现有注销关闭逻辑覆盖。来源外目标、未知会话和创建失败不放行。
此处窗口打开不是业务动作成功回执，也不注销第三方自身账号。

受限原 SDK（4 CPU / 8 GiB）内该 Rust 文件格式检查通过，`git diff --check` 通过。
当前 SDK 的 GTK/WebKit 依赖探测退出 1，未启动注定缺依赖的 Desktop 编译，未安装
宿主工具链。本增量尚未经过完整 Desktop 编译、Win11 设备交互或生产变异验证；
未发布、未部署，不借此前包和 frame 检查覆盖它。原生 `about:blank` 脚本弹窗、
第三方登录跳转、上传下载以及弹窗会话继承的实际行为均不据格式检查宣称通过。

用户另提供了完整 GenBI App 源码。已只读核验
`WrenAI-ui-0.32.2` 的 tag `release/ui/0.32.2` 精确指向
`c5f02a0391c87420dba78632dcd86073710deb72`：
`wren-ui/package.json` 的 version 为 0.32.2，
`wren-ui/src/pages/api/graphql.ts::bootstrapServer` 初始化原 Apollo 服务，
`wren-ui/next.config.js::nextConfig` 使用 standalone 输出，
`docker/docker-compose.yaml::services` 包含 UI、AI Service、Engine、Ibis 与 Qdrant。
Engine gitlink 精确为 `47ca29ebba291100ba5d70ce1790f9887eaed7a0`；
其 `mcp-server/app/wren.py::{query,deploy,get_full_manifest}` 及 stdio 入口
不是当前 `871118e94f1525c401d867074c05e7e8eefca1cc` 的 Python v2 工具合同。

整套源和子模块已从用户提供目录复制至只读证据位置
`/volumes/kailo/.references/WrenAI-ui-0.32.2`，原目录与现有 WrenAI 均保留。
两套工作树干净，排除 Git 元数据后的逐文件比对退出 0；包含 Git 元数据的首次
比对退出 1，差异仅为 status 刷新的两份 index，不是源码差异。
该 tag 的 `docker/.env.example` 仍填 `WREN_UI_VERSION=0.32.0`，不能把样例标签
当成 0.32.2 的配套产物证明。当前未运行该目录内容、未混接 v2 引擎、未部署 GenBI；
源码存在不证明 UI 身份隔离、iframe 兼容或完整原生功能验收。

### 共享 Web 独立打开入口

同一 `NativeApplicationPage` 在取得当前 binding 的有效 BFF descriptor 后，
为 Web 提供新标签打开原生服务的入口；Desktop 仍只把 binding ID 交给原生 host，
不在主窗口导航到第三方。入口和 frame 使用同一份校验结果，重新读取失败或撤权
时同时移除。链接不带 opener 或 Referer，不转发平台 token，不放宽 frame sandbox，
也不把第三方无法嵌入误报为业务服务故障。文案沿既有 TypeScript→Dart 生成链。

实际验证在 `kailo-native-page-sdk-4rbmbz` 中运行，固定 SDK 镜像为
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
4 CPU / 4 GiB、无额外 swap，缓存与候选均位于 Data 卷。执行前检查了实际容器限额、
并发进程及主机可用内存。首次生成因未设置 SDK HOME 导致 Dart 缓存写入根路径而
退出 255；按原缓存位置设置 HOME 后，`tools/gen-platform-i18n.py` 退出 0。

首次 `pnpm --filter @client-kit/platform test -- application-bindings` 完成类型检查，
但该参数实际启动了其他测试文件，结果为 `42 passed / 6 errors`、退出 1；
错误为 `[vitest-pool-runner]: Timeout waiting for worker to respond`，不记通过。
原件保存在 Data 候选父目录 `native-page-shared.log`。
之后从原 package 运行 `pnpm exec vitest run test/application-bindings.test.tsx`：
`Test Files 1 passed; Tests 8 passed`，退出 0。

实现后的反例将实际链接 `target` 从 `_blank` 改为 `_self`，同命令得到
`AssertionError: expected '_self' to be '_blank'`、`1 failed / 7 passed`，退出 1。
还原源码后同命令 `8 passed`、退出 0（09:33:46 UTC），没有变异残留。
这些结果只覆盖共享入口、拒绝与撤权渲染，不证明第三方原生认证、完整页面、
Desktop 弹窗或设备行为；本增量尚未提交、构建或部署。

### 2026-10-05 联合批共享客户端实际产物

上述共享入口随后随冻结联合批执行原 `tools/build-upstream.sh web-client`，
再串行执行 `tools/build-upstream.sh desktop-client`；执行句柄 95729 实际退出 0。
使用原受限 BuildKit（8 CPU、16 GiB memory 与 memory+swap）及 Data 缓存，
两客户端各执行一次构建，不在每个源码修改后重新打包。

Web source 为 `sha256:32fb6887b1f0b529d5b103c7913a1f2052609e3658598b076c3e9fdaf43415f8`，
实际 registry artifact 为 `sha256:3336de5375dccfbcb72865e4ad44bf1e2799136779cf00830c8b64861fd4d173`。
Windows source 为 `sha256:7b89dba2d4a4fdb66a4be4504c1e8b085b0db20321bcbd519a8273c2a9b7ac50`，
NSIS 文件 `dist/desktop-client/Kailo_0.5.23_x64-setup.exe` 的实际 SHA256 为
`620e6d3b6b976ca70022de22b9d5e93eacb1edd91f24f743665bda1a474c784a`。
原 helper 已写回来源登记，未手改源码摘要冒充新构建。

原件目录为 `/volumes/data/kailo/tmp/codex-application-core-worker-release-20261005.2Co1Ge/`。
`assembly-web-build.log` SHA256 为 `c63064a2328c687b19e080ce9678c802fd6173656da49c9c8d5cd05f74767d2d`；
`assembly-windows-build.log` SHA256 为 `6d5a7191c85934b5df3a0594a701fbdc5a6d42b3f83532b2f6f72aa626ec507d`。
chunk 大小、两个 Rust 未使用项、跨平台编译及跳过签名警告均保留。
本记录不宣称新产物部署、原生组件登录、Win11 实机、Mobile 或完整业务验收通过。
