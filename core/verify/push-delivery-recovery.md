# DD-151 推送发送检查点与令牌退休

本批在 `cfb944e11` 最小 DD-151 集成候选上接续，仍为未发布分支实现。
Core 代码、真实隔离数据库与原 SDK 验证分别记录；不宣称 APNs/FCM 真机送达、
Mobile release 或完整 DD-151 已交付。此前角标证据见 [push-unread](push-unread.md)。

## 实际消费者与不变量

`worker::scan` 以短租约获取 Relay cursor，在事务外读取 CONTROL Relay；
`intent::enqueue` 续租并保存每个事件的设备候选引用，随后短事务提交 cursor。
失去租约的扫描者不能补写或推进；重读同一事件命中 `(tenant,device,event)` 唯一键。
消息正文不落该表；注册版本、平台、供应商目标摘要与事件引用在首次意图里冻结。
这只是 DD-151 派生投递检查点，不产生新的消息或已读权威。

`intent::claim` 使用 `SKIP LOCKED`。`CLAIMED` 尚未调用提供方，可在过期后重新
准备；外部调用前短事务转 `SENDING`，增加尝试数并预占设备限速窗口。每次发送
都重读消息、当前偏好和已读位置，再在发送边界的短事务锁定精确 Tenant/member/
CLIENT key、设备登记版本与频道资格。Relay、OpenBao、OAuth 和 provider HTTP
不持有数据库事务或连接；撤权在发送边界之前生效则不发送，之后是既有在途请求。
折叠只依据实际发送窗口，未判定资格的排队消息不能吞掉较早的提及。

`SENDING` 租约失效或请求发出后响应丢失转 `UNKNOWN`，不再由 ready consumer
领取；过期不将 UNKNOWN 改成成功或失败。同一尝试的迟到确定响应可以补结论，
旧租约不能写新尝试。`ACCEPTED` 只代表 provider 接受；回执与按事件 ID 去重的
未读投影同事务提交，写投影失败只重试已知回执，不再次 POST。撤设备/成员、
登记换版或 Tenant 删除后，旧回执不能重新建立未读投影。

只对明确暂时拒绝或尚未发出通知的失败重试，最多三次，指数退避不低于 60 秒；
APNs 5xx 不低于 15 分钟，且尊重更长的 Retry-After。所有重试沿原固定到期时间，
不重放过期通知。APNs `apns-id` 只是跟踪号，折叠键也不作为幂等证明；FCM v1
缺少有效成功 message name 的成功响应保守保留 UNKNOWN。普通 404 不等于令牌
失效，必须有 FCM 的结构化 UNREGISTERED 等证据。

依据：[APNs 响应合同](https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns)、
[FCM 错误与退避合同](https://firebase.google.com/docs/cloud-messaging/error-codes)、
[FCM send API](https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages/send)。
APNs Delivery Log 的对应查询标识仅在 development 响应提供；当前生产 API
没有按我方稳定 ID 查询全部已接受事实的接缝。本批不新增设备 receipt 权威，
不以详情读取、超时或“通常会到”消除 UNKNOWN，不声称 exactly-once。

## 登记与 SecretRef 生命周期

`push::apply` 在 OpenBao `write_once` 前提交 `admission.push_token_intent`，
只保存 version-1 独占 locator 的所有权，无 token 明文。外部写入后，在绑定事务
重新锁定本人 ACTIVE CLIENT key、Tenant 和 member；过期写者或竞争失败不能绑定。
登记替换与旧引用转 `RETIRING`、撤销与清空当前引用各自处于同一事务，不再靠日志
假定“下一次会找到”孤儿。Tenant 暂停不删除登记；删除仍沿原 namespace 销毁与
本地清理步骤，清除发送、角标和 cursor 派生数据。

`token_intent::claim_retirement` 领取超时 PREPARING 或到期 RETIRING；外部 I/O
前冻结不能绑定的状态，失败按 5 秒到 1 小时上限持久退避重试。它复用既有
`secret_store::retire_push_token` 的 CAS=0 fencing、version-1 destroy 和 metadata
查证；迟到写不能越过已占的 version 1。只有真实 `destroyed=true` 才记退休完成。
既有 SERVER key 意图带 HUMAN/CONTROL 的不同权威归属，不能伪装成设备 token
意图复用其数据库表。

## 运维与发布边界

沿 [RB-07](../../docs/runbooks/RB-07-unknown-external-results.md) 的值班责任处理
`platform.push.checkpoints{state="UNKNOWN"}`。推送自动派生意图没有伪造 HUMAN
ActionExecution；用稳定 intent UUID 查询 `projection.push_send_intent`，按原
登记审计关联设备。无确定回执时保留原态、登记责任人与下次核查时间，不直接改库
或换 UUID 重发。令牌退休失败查询 `admission.push_token_intent`，只读 SecretRef
metadata，不把 token 值输出。

新增迁移 `20261031070000_push_send_intent` 在有发送引用或未退休 token 所有权时
拒绝回退，不能为了回滚删除不明副作用。空隔离库往返与有数据时停止回退都需验证。

仍需实际 provider 凭据/轮换、真机授权/后台接收/点击与匹配 Mobile 包验收。
继承的 Relay `since + limit=500` 单页扫描在超过一页的突发流量下仍可能遗漏事件；
这属于触发消费者缺口，本批的租约和幂等检查不能证明其全量读取，仍阻断完整
DD-151 交付。勿扰、iOS 通知扩展和 Android 原生桥的边界沿原交付账本，不由这批
Core 回归代替。

## 固定来源检查

固定 `53f2ae257` 的原 SDK：fmt、全库迁移、末条回退再前进和 push **23/23**
通过；Clippy 退出 101，指出 4 处测试冗余解引用及 1 处未检查 TCP read 数量。
后续源码已修正，原失败日志保留在
`/volumes/data/kailo/verification/buzz-r10/push-intent-53f2ae257/`。

固定 `313e47676`（只含本批发送/登记闭环与验证工具），沿原不可变 SDK
`sha256:3007729eb192341a4f004a88e42e1e66c94fc67d763acfc96568bd7311116018`
及 `tools/container-safety.sh`，4 CPU / 16 GiB；独立 PostgreSQL 1 CPU / 2 GiB，
原 CI Docker 配置和容量缓存。预检 MemAvailable 约 34 GiB，实际容器限额已回读。

- Core workspace fmt 退出 0；全量迁移及 `310700` 空库回退/再前进退出 0。
- `cargo test --locked --manifest-path core/Cargo.toml -p platform-core push:: -- --include-ignored`：
  **24 passed、0 failed、0 ignored**，包含 8 项新增真实 PG 状态/事务/并发检查、
  既有真实 PG 未读检查与实际 TCP 丢响应/Retry-After 检查。
- `cargo test --locked --manifest-path core/Cargo.toml -p secret-store push_token_`：
  **1 passed**，原 HTTP consumer 对 scripted OpenBao 验证未绑定 locator CAS=0
  fencing、destroy 响应丢失后的 metadata 查证及跨前缀拒绝；不等于线上 OpenBao 演练。
- 原 `check-push-intent-recovery.sh` 临时把生产恢复分支改为重新排队，指定用例实际
  因 `PREPARED != UNKNOWN` 失败；原源码逐字恢复、SHA-256 相同后同用例通过。
  有意图数据时回退收到 `push intents must be reconciled before rollback`，符合停止条件。
- Core `--all-targets` Clippy `-D warnings` 与 workspace SQLx prepare check 均退出 0。

最终脚本 `source=313e47676 exit=0`；日志目录
`/volumes/data/kailo/verification/buzz-r10/push-intent-313e47676/` 保存完整命令输出、
preflight、SDK/PG limits 和结果。主日志 SHA-256 为
`9df02d3826c09b326106772c1d848ef82ea6f4c6196f072b4603c791f0c6bcbf`。
结束后实际回读本批 SDK、PG 与独立 network 全为空，未修改共享服务。
测试固定源码与后续纯证据文档分开提交；未合并主线、未打包、未部署。

固定证据树 `1c14a2067` 原 SDK 1 CPU / 2 GiB：三份变更文档的 markdownlint
零问题、反向检查脚本 `bash -n` 退出 0；原件
`/volumes/data/kailo/verification/buzz-r10/push-intent-docs-1c14a2067/`。
这是本批文档检查，不代替集成分支全量设计覆盖门禁。
