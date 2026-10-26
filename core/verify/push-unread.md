# DD-151 Mobile 推送未读角标

本批从 `f551157f08ddcf7b57c5fdbce4526e2153fc05fd` 接续既有未提交角标实现。
尚未合并、打包、部署或完成 APNs/FCM 真机验收；原 SDK 定向验证结果见下。

## 实际读写链

- `user_state.rs::mark_read` 仍以本人可见性核验和 version CAS 写 RFC3339
  `identity.collaboration_user_state.read_contexts`；Mobile 的
  `shared/platform/platform_read_state.dart` 与共享 TS `react/use-inbox-state.ts`
  消费同一个读权威。本批不改变读 API。
- `push/worker.rs::run_tenant` 在每位接收者发送前重新读取已读位置，已读消息不推送。
  `push/decide.rs::read_position` 对回复取线程与频道两位置较新者。
- `push/unread.rs::preview` 只读现有投影，为候选载荷计算角标；准备发送、缺配置、
  限速折叠、无效设备和失败不会留下已推送消息。首次设备 `Delivered` 后短事务保存
  事件，随后另一设备失败不撤销；事件 ID 主键确保同秒不同消息分开、同消息重放去重。
- 每读上下文保留最新 999 条，角标封顶 999；不能全局裁掉其他频道的旧未读消息。
  `tenant_delete.rs::finish` 随 Tenant 删除清理派生表。
- APNs `aps.badge` / FCM `notification_count` 使用这个值；载荷仍无消息正文。
  全新未发布迁移可回退删除派生表，无旧版在线 writer 兼容对象。

## 验证与限制

新增真实 PostgreSQL 回归调用同一 `preview` / `record` SQL，覆盖同秒事件、重复事件、
仅预览不写、接收者隔离、线程/频道读位置、999 边界及跨频道保留。用隔离迁移库的
`PUSH_TEST_DATABASE_URL` 显式运行 ignored 测试；未设置时不算通过。

本刀不声称 exactly-once。provider 接受与 Core 提交派生投影之间仍存在崩溃窗口，
失败重试也可能处于提供方结果不明。既有 Tenant cursor 事务仍持有每 Tenant
advisory lock 跨整个轮询投递；本刀不新增跨 HTTP 的投影事务或行锁。
后续须沿既有 DD-151 派生数据与检查点补持久发送意图和结果不明收敛，不能将这个
限制当作永久交付豁免。设备授权逐次核验、勿扰、真实提供方回执与客户端徽标归零
仍需与完整 DD-151 消费者验收，不由这组数据库回归证明。

## 固定源码验证回执（2026-10-26）

固定 `412a2b07b`，来自已推送 `feat/buzz-restore-r10` 的 Git 导出树，未混入
后续 DD-158 工作区增量。原 `tools/check.Dockerfile` 的不可变 SDK
`sha256:3007729eb192341a4f004a88e42e1e66c94fc67d763acfc96568bd7311116018`
（Cargo 1.90.0）使用原 `tools/container-safety.sh` 启动前回读限额；
SDK 4 CPU / 16 GiB，独立 PostgreSQL 1 CPU / 2 GiB、tmpfs 数据目录。
沿原 CI Docker 配置与容量缓存运行，未使用宿主 Cargo。

- `cargo fmt --manifest-path core/Cargo.toml --all --check`：退出 0。
- 原 `sqlx migrate run/revert/run --source core/migrations`：全量前进、
  `20261031040000_push_unread` 回退与再前进均退出 0。
- `cargo test --locked --manifest-path core/Cargo.toml -p platform-core push:: -- --include-ignored`：
  **15 passed、0 failed、0 ignored**；包含上文实际数据库 SQL 回归。
  其他 integration binaries 的过滤后 0 项不计作新增验收。
- `cargo clippy --locked --manifest-path core/Cargo.toml -p platform-core --all-targets -- -D warnings`：退出 0。
- `cd core && cargo sqlx prepare --check --workspace`：退出 0。

原始日志 `/volumes/data/kailo/verification/buzz-r10/push-check.log`，最终回执
`push-check-result.log`；`push-check-preflight.log`、`push-check-limits.log` 和
`push-pg-limits.log` 保存资源读回。检查结束后已回读确认 SDK、PG 容器及其独立
网络全部清理。上述数据库回归验证的是实际派生表读写，不替代真实 APNs/FCM
发送、手机点击跳转、provider 崩溃窗口恢复或三端验收。

## 独立集成候选依赖（2026-10-26）

以 `356df4087` 为基，仅选 `e02bb6ab8` 的 DD-151 基础与
`5149d6c38`、`412a2b07b`、`7babfa63d`，保留集成版设计覆盖与 DD-159。
基础依赖包括六份推送 schema、sample 与四侧生成，Core BFF/worker、
OpenBao 令牌读取、设备撤销及 Tenant 清理、两组可逆迁移，以及 Mobile 原生
APNs 桥、通知开关、token 刷新与通知点击深链。未选择 Activity 或其他 Mobile
功能祖先。此前固定 `412a2b07b` 的结果不等于本候选的验证结果；本候选仍待
原 SDK Core/数据库、四侧生成和 Flutter 实际消费者检查。

推送能力单独登记为 `collab.mobile_push` / `in_progress`，不继承
`identity.client_keys` 的历史 shipped 或 artifact。iOS 通知扩展正文读取仍为
独立 WIP，Android 注册桥、真实设备接收、凭据轮换、发送意图持久化与结果不明
收敛尚未闭合；未构建 Mobile release、未部署共享服务。

固定 `abea20391` 的原 SDK 四侧生成/一致性与 Dart 文案一致性检查退出 0。
首次 registry 因集成基线已有 `collab.local_archive` 缺少能力归属行退出 1；
补入真实未发布边界后，固定 `fb1a0b905` 的 registry 生成与校验均退出 0。
原件为 `/volumes/data/kailo/verification/buzz-r10/push-integrated-gen.log` 和
`push-integrated-registry.log`，资源均为原 SDK 1 CPU / 2 GiB。此前导出设计对象
未 fetch 导致脚本退出 2，补取相同设计 pin 后重跑；不改设计或绕过校验。
集成 Core/数据库与 Flutter 消费者仍待实际运行。

## 实际集成树 Core 验证（2026-10-26）

固定 `090e208dc`（以 `356df4087` 集成基线接入上述依赖），原不可变 check SDK
4 CPU / 16 GiB + 全新独立 PostgreSQL 1 CPU / 2 GiB、原容量缓存：

- Core workspace fmt 退出 0；全库迁移、push_unread 回退再前进退出 0。
- `cargo test --locked --manifest-path core/Cargo.toml -p platform-core push:: -- --include-ignored`：
  **15 passed、0 failed、0 ignored**，其中真实 PostgreSQL 同秒事件/重复设备/
  read_contexts/999 回归实际执行。其他二进制过滤 0 项不计新增通过。
- Core `--all-targets` Clippy `-D warnings` 与 workspace SQLx prepare check 均退出 0。

第一次定向导出漏掉 Cargo 实际引用的 `collaboration/examples/countdown-bot`
workspace 清单，fmt 在 metadata 阶段退出 1；补齐同 commit 的 examples 后
重跑上述完整定向入口，最终退出 0。未修改 Cargo workspace 或降低检查范围。
原件 `push-integrated-check.log` 保存输入缺失失败，
`push-integrated-check-complete-input.log` 和 `push-integrated-check-result.log`
保存最后成功；同目录 limits/preflight 记录资源读回。容器/PG/独立网络已清理。
Flutter 消费者、真机推送与持久发送意图恢复仍未验收；未部署。

## 原 Flutter 消费者终态（2026-10-26）

固定集成候选 `029b8fbc5`（基于根集成 `356df4087`，不带 Activity 祖先），
原 Flutter 3.41.7 镜像
`sha256:644e3cea0a8440ce75804b67ceab77b16a87b39d9e9d89b07aceca7a98af1aa3`，
2 CPU / 4 GiB、原资源 helper。锁定 pub 依赖、七文件格式零差异、六路径
analyze 全通过；`test/features/settings/push_registration_test.dart` **7 passed**。
含真实 notifier 的旧身份读/写结果晚到隔离：身份切换后原请求成功不能覆盖新身份
状态；配置未就绪、设备签名注册、CAS 冲突重读、未知结果重读、点击只携带 ID
进入深链管线亦通过。固定 6c/7b 曾因测试代码缺花括号而 analyzer 退出 1，
未绕过规则，原件保留。最终日志
`/volumes/data/kailo/verification/buzz-r10/flutter-push-029b8fbc5/`
中 check/result/preflight/limits，容器随脚本清理。

Core 源码未随这一 Mobile 批变化，仍对应上述固定 `090e208dc` 的原 SDK/真实
数据库通过证据。未进行 APNs/FCM 真机与系统权限、后台点击、签名打包或部署验收；
发送成功至本地投影落库之间的结果不明窗口仍待持久发送意图与恢复收敛，不宣称
exactly-once，DD-151 仍为进行中。
