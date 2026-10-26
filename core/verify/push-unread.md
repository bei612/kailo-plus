# DD-151 Mobile 推送未读角标

本批从 `f551157f08ddcf7b57c5fdbce4526e2153fc05fd` 接续既有未提交角标实现。
尚未合并、打包、部署或完成 APNs/FCM 真机验收；原 SDK 定向验证待执行。

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
