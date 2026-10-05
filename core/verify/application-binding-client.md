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
