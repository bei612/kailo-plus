# DD-158(3) Tenant 显示资料

本批接入既有 ActionExecution 准入、fresh 权限与同事务结果链，目标固定为会话业务
Tenant，只接受 ACTIVE HUMAN 成员、manage@tenant、TENANT_ONLY、明确确认、
无审批 SYNC。参数闭集，名称规范化；图标是完整单个 emoji，或实际可解码的
PNG/JPEG/WebP data URL（≤96 KiB、两边均≤256 px）。同事务 Tenant version CAS
修改名称/图标；不改 slug、Community 绑定或 NIP-11。普通成员 GET 只读资料，
fresh manage 的成员才获得动作键，提交仍重新准入。

目前是尚未验证的源码候选；三端真实消费者、生成一致性、Core 编译、隔离数据库、
权限/并发与端到端交互检查仍待完成。不可据此声称 DD-158、V-SCN-261 交付。

阶段源码已补 Web/Desktop 共用资料对话框和 Mobile 设置入口/真实表单，使用同源
契约与词条。普通成员只读；管理员编辑名字、图片、表情或清除图标，必须勾选确认
后提交既有 /api/v1/actions。未知结果冻结同键同参数重试，明确冲突要求重新读取；
身份退休忽略晚到结果。图片只在本机裁剪为 256px，随治理命令提交 Core。新增实际
共享消费者与 Mobile 控制器回归源码；当前尚未运行，不是验收通过。

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
