# DD-158(3) Tenant 显示资料

本批接入既有 ActionExecution 准入、fresh 权限与同事务结果链，目标固定为会话业务
Tenant，只接受 ACTIVE HUMAN 成员、manage@tenant、TENANT_ONLY、明确确认、
无审批 SYNC。参数闭集，名称规范化；图标是完整单个 emoji，或实际可解码的
PNG/JPEG/WebP data URL（≤96 KiB、两边均≤256 px）。同事务 Tenant version CAS
修改名称/图标；不改 slug、Community 绑定或 NIP-11。普通成员 GET 只读资料，
fresh manage 的成员才获得动作键，提交仍重新准入。

当前为未发布的源码候选，四侧契约/词条/注册表、三端定向消费者和 Core 隔离数据库
检查已通过（下文记录各自固定源码）。跨会话通知、宿主缓存同步和身份失效清空已有
消费者证据；完整真实会话权限交互、多账号即时一致与实际设备尚未验收。不可据此
声称 DD-158、V-SCN-261 已交付。下列早期失败保留，最终固定结果见末节。

阶段源码已补 Web/Desktop 共用资料对话框和 Mobile 设置入口/真实表单，使用同源
契约与词条。普通成员只读；管理员编辑名字、图片、表情或清除图标，必须勾选确认
后提交既有 /api/v1/actions。未知结果冻结同键同参数重试，明确冲突要求重新读取；
身份退休忽略晚到结果。图片只在本机裁剪为 256px，随治理命令提交 Core。新增实际
共享消费者与 Mobile 控制器回归源码；其定向检查结果见下文。

固定 fbfc 原 SDK 1CPU/2GiB 四侧生成+一致性退出0，rustfmt完成；Cargo update
仅 platform-core 新增 emojis 0.9.0、phf 0.13.1、phf_shared 0.13.1、siphasher 1.0.4，
image 0.25.10复用既有锁定版本。原件 profile-gen-fbfc2584c/{check,result,limits}.log
位于 /volumes/data/kailo/verification/buzz-r10/；不含编译/运行验证。

固定 `2ff2d7a01` 原 Flutter 3.41.7 不可变镜像，2CPU/4GiB，锁定 pub 依赖、
analyze 全通过；四项实际 Mobile 控制器/表单回归 **4 passed**：普通成员不可写、
当前资料版本与明确勾选、结果不明同键重试、确定冲突强制刷新、身份退休忽略晚到
读写回应。原 formatter 将新测试的长错误对象换行，已收回入库；四文件再次格式
检查零差异。原件 `/volumes/data/kailo/verification/buzz-r10/flutter-profile-2ff2d7a01/`
的 check/result/preflight/limits。未覆盖图片图库权限与真机、Core fresh 权限全链。

共享 Web/Desktop 首次固定 `796937f7a` 原 SDK 检查在生产 TypeScript 阶段发现
新表单引用了不存在的 input 模块；已改为现有 composer/shared/ui/input，保留
`profile-front-796937f7a/profile-front.log` 失败原件。修复后重跑结果另记。

固定 `2ff2d7a01` 的原检查 SDK 1CPU/4GiB、Node heap 3GiB，冻结 pnpm 依赖，
共享 platform 生产与完整测试 TypeScript 均退出0；实际资料对话框 Vitest
**4 passed**，覆盖成员只读、确认所显示版本、丢响应及未分类503同键重试、
明确409后强制刷新。日志 `profile-front-2ff2d7a01/profile-front.log` 与 limits，
容器已清理。此为共享消费者检查，未替代 Web/Desktop 宿主打包或真实浏览器验收。

固定 `29fcab1ab` 的首轮 Core fmt、完整迁移、资料迁移回退至
`20261031040000` 后再前进通过；Rust 编译在既有 invitation.rs 显式 Params
构造处报缺 tenant_profile 字段，整体退出101，未开始用例/Clippy/SQLx。
`4d1cfcca0` 补显式 None，不改变邀请语义；失败原件保留于
`profile-29fcab1ab/profile-core-check-complete-input.log`。

早期跨会话更新源码记录（固定检查结果见末节）：既有 GET /api/v1/tenant/profile 可带
afterVersion 做有界等待，回应仍走本人 fresh 会话、成员资格和资料读取；等待与断线
恢复沿既有 BFF_STREAM_READMIT_SECONDS/BFF_STREAM_RETRY_MILLIS 部署事实。
资料写入事务使用 PostgreSQL pg_notify，提交才通知，回滚不通知；每个 Core 只用一条
LISTEN 连接，内存通知只作失效提示，丢帧或重连均重新读权威行。Web/Desktop 共用
在线读取与侧栏名称/图标，Web 根 session 状态及 Desktop session 查询同步名称。
Mobile 沿原生 BFF 与前后台生命周期读取，前台更新频道名称/图标和 session view。
本段为源码边界，不代表新增消费者、真实并发会话或实际设备已通过验收。

固定 `3771720e1f1c6ac99b8a1158e67e4312aa47ecb0` 的原 SDK 1CPU/2GiB 已完成
四侧生成/check、同源 Mobile 词条 check 与能力注册表生成/check（42 能力、20 封闭
Workflow kind），退出0。设计输入固定为 `f56cd14336af70d000862febb9e1e40f09375d6f`。
首轮 launcher 缺少设计挂载导致 registry 失败的日志保留；补齐只读设计输入后通过，
四侧类型与格式化结果已回读。原件在 CI
`/volumes/data/kailo/verification/phase1-integration/profile-3771720e1/`，
`gen.log` 为首轮失败，`gen-fixed-inputs.log` 为完成记录。尚非编译或消费者通过证明。

仍未交付的用户操作/验收边界：运营方反馈 fresh Catalog 权限与附件/分拣真实 HTTP
链；两名管理员通过实际会话并发编辑；图片图库授权与真机/宿主打包；其他实际在线
会话的即时资料更新。固定消费者检查不代替 V-SCN-261“全员即时一致”，没有合并
main 或部署共享服务。

固定 `4d1cfcca0`：迁移往返、Rust 编译和3项定向检查全部通过（含真实 PG
同版本并发一胜一冲突、清图标与撤权拒绝）；Clippy `-D warnings` 拒绝一处
`!Option::is_some_and` 的 nonminimal_bool，整体退出101、SQLx未执行。
`0bc6c74ed` 改为等价 `is_none_or`，不加 allow 绕过。失败原件
`profile-4d1cfcca0/profile-core-check-complete-input.log` 保留。

## 固定 Core 完整终态（2026-10-26）

固定 `0bc6c74ed`，原 check SDK
`sha256:3007729eb192341a4f004a88e42e1e66c94fc67d763acfc96568bd7311116018`，
原 helper 限额4CPU/16GiB与全新独立PG1CPU/2GiB，以下全部退出0：

- Core workspace fmt、全量迁移、资料迁移回退至20261031040000再前进；
- `cargo test --locked --manifest-path core/Cargo.toml -p platform-core tenant_profile -- --include-ignored`：**3 passed / 0 failed / 0 ignored**；
- Core all-target Clippy `-D warnings`、workspace SQLx prepare check。

回归覆盖规范化/闭集/明确确认、可解码图像与256px/96KiB及单emoji边界，以及实际
PostgreSQL `prewrite` 的策略拒绝、会话目标约束、更新与清除图标、slug保持不变、
同版本两个真实并发事务一胜一冲突、成员撤销后的拒绝。它不代替完整
ActionExecution HTTP准入与SpiceDB fresh权限交互；测试没有把模拟权限称为真实
权限验收。原件在 `/volumes/data/kailo/verification/buzz-r10/profile-0bc6c74ed/`：
`profile-core-check-complete-input.log`、`profile-core-check-result.log`与preflight/limits。
脚本清理后 docker 容器与网络匹配回读均为空，未启动或部署共享服务。

## 合批跨会话消费者终态（2026-10-26）

固定 `3cd4d1e00eb26514dee3727d8806b1c31614a1d1`，CI 直接从 GitHub 取源，
设计固定 `0d8f9cc11b8765e66a10b5aaa8524c4714f98a4a`。原 check SDK
`sha256:3007729eb192341a4f004a88e42e1e66c94fc67d763acfc96568bd7311116018`：

- 1 CPU / 2 GiB：原四侧生成/check、同源 Dart 词条 check、能力注册表生成/check
  退出 0，42 条能力、20 个封闭 Workflow kind。
- 1 CPU / 4 GiB：冻结两套 pnpm 依赖、共享生产/测试 TypeScript、Web 类型检查与
  Desktop 类型检查退出 0；原资料表单 4 项及 live consumer 6 项，合计 **10/10**。
- Desktop 的 live watcher 与 CommunityQueryProvider 位于不同查询缓存；真实内层
  `TenantProfileSessionCache` 只消费已有资料上下文，将更新写入实际页面缓存，不另
  起网络监听。初次读失败沿已有 query backoff 重试，在途 online 提示保留到请求结束。
- 撤权后清除当前名称/图标与 session 映射并停止；晚到结果受宿主生命周期和身份代际
  保护。客户端缓存不成为授权权威。隐藏期间旧有界 HTTP 仍可在途，不声称全局始终
  只有一个物理请求。

在同一固定导出中分别禁用内层缓存同步、撤权清空和在途 online 提示，三项真实
消费者分别失败 exit 1；生产文件逐字/SHA-256 恢复后，原两文件 **10/10** 再次通过。
最终脚本 `source=3cd4d1e00eb26514dee3727d8806b1c31614a1d1 exit=0`，
原件在 CI `/volumes/data/kailo/verification/phase1-integration/profile-3cd4d1e00/`：
`frontend.log`、`frontend-result.log`、limits 与 `negative-r2/`。第一次反向运行因
用例框架期限先于等待断言而中止，保留于 `negative/`；第二次仅延长测试框架期限，
实际等待断言与产品读取策略未改，三项均检出后恢复通过。

固定 Core `06712387a66281e3bebce328cc33f350b056d946` 的联合检查使用原 SDK
4 CPU / 16 GiB 与全新 PG 1 CPU / 2 GiB：迁移及 `310700` 回退/重进、正常
workspace、Clippy `-D warnings`、SQLx prepare check 全部通过；profile 真实 PG
**2/2**。通知只在提交后出现、同版本并发只有一个提交者、回滚无事件均有实际检查。
临时移除生产 `pg_notify` 后通知等待失败 exit 101，逐字恢复后通过。完整命令、
日志摘要和未计通过的输入错误见[联合回执](phase1-integration-core-20261026.json)。

Mobile 固定 `f23d2de522e237a6d0be08b01beb844a4439c5d7` 的原 Flutter
**11/11**，包含 ThemePickerPage 真实消费者；终端失效后旧名称与图标消失。
关闭实际显示保护可检出缓存身份残留，恢复后通过；原件与范围见
[Mobile 资料消费者](../../collaboration/fork/verify/tenant-profile-live-mobile.md)。

这些结果证明固定源码的通知及消费者行为，不证明最新合并树 full、真实多账号并发、
SpiceDB 权限全链、真机、正式制品或部署。各固定源码不合并计算成整树验收。
