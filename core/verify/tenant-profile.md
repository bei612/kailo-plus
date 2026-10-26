# DD-158(3) Tenant 显示资料

本批接入既有 ActionExecution 准入、fresh 权限与同事务结果链，目标固定为会话业务
Tenant，只接受 ACTIVE HUMAN 成员、manage@tenant、TENANT_ONLY、明确确认、
无审批 SYNC。参数闭集，名称规范化；图标是完整单个 emoji，或实际可解码的
PNG/JPEG/WebP data URL（≤96 KiB、两边均≤256 px）。同事务 Tenant version CAS
修改名称/图标；不改 slug、Community 绑定或 NIP-11。普通成员 GET 只读资料，
fresh manage 的成员才获得动作键，提交仍重新准入。

当前为未发布的源码候选，四侧契约/词条/注册表与三端定向消费者检查已通过（下文
记录固定源码）；Core 编译、隔离数据库与完整权限交互仍在验证。不可据此声称
DD-158、V-SCN-261 已验收。

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

仍未交付的用户操作/验收边界：运营方反馈 fresh Catalog 权限与附件/分拣真实 HTTP
链；两名管理员通过实际会话并发编辑；图片图库授权与真机/宿主打包；其他在线
会话的即时资料失效通知。当前更改后本端重读资料与既有 session view，其他会话
下次读取会得到 Core 最新事实，但没有实现跨会话实时广播，不据此声称 V-SCN-261
“全员即时一致”。没有合并 main 或部署共享服务。

固定 `4d1cfcca0`：迁移往返、Rust 编译和3项定向检查全部通过（含真实 PG
同版本并发一胜一冲突、清图标与撤权拒绝）；Clippy `-D warnings` 拒绝一处
`!Option::is_some_and` 的 nonminimal_bool，整体退出101、SQLx未执行。
`0bc6c74ed` 改为等价 `is_none_or`，不加 allow 绕过。失败原件
`profile-4d1cfcca0/profile-core-check-complete-input.log` 保留。
