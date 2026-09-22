# Worker → Core service API 的认证与投影核验

对应 `01-工程结构与模块边界.md` §4（Worker 经 Core service API 做状态投影）
与 `.design/06` §3.1（`ProjectTaskState` 按 `event_id` 单调去重）。

## 为什么是独立监听端口

AgentGateway 的路由是 `pathPrefix: /`，整条路径整体转发给 BFF。把服务面挂在
同一个 listener 上，等于让任何完成 OIDC 登录的用户能打到成员状态的写入口。
端口隔离让这件事在拓扑层就不成立，而不是只靠代码里的一个认证分支。

实测（2026-09-22，`app` 与 `edge` 网络内发起）：

| 请求 | 结果 |
|---|---|
| BFF 端口上的 `/service/v1/task-projections` | `404`——路由根本不在那个 router 上 |
| 经网关的 `/service/v1/task-projections` | `302`，重定向到 OIDC 登录；登录后也只会撞上 BFF 的 404 |

## 认证：audience 与 azp 两条都核

Worker 持自己的 OIDC client（`kailo-worker`）以 client_credentials 取令牌。
原先 `kailo-core` 一个客户端同时充当 Core 与 Worker 的服务身份，与 `01` §9
「Core/Worker/adapter 各自使用最小 service identity」相悖，也让 Core 无法分辨
「谁来敲的」。拆开后两者的 Temporal `permissions` 也不同：Core 只有
`write`/`read`，Worker 多一个 `worker`——只有它 poll Workflow Task 并 Respond。

`aud` 说明「这张票是开给 Core 的」（由 `kailo-worker` 上的 audience mapper 写入），
`azp` 说明「是谁来敲的」。两条都要：同 realm 内别的客户端也可能被配上同一 audience。

算法白名单取自 JWKS 中密钥自身声明的算法，不读令牌头里的 `alg`——那是攻击者
可控字段，按它选算法就是 alg 混淆（HMAC 冒充，甚至 `none`）。

## 实测结果

| 请求 | 结果 |
|---|---|
| 无 `Authorization` | `401` |
| 用 `kailo-core` 的令牌（`aud` 含 `kailo-core`，但 `azp` 不符） | `401` |
| Worker 令牌 + 未登记的 workflow | `404`——`WorkflowRef` 由 Core 在 Start 前建，Worker 不能替它建（`DD-48`） |
| Worker 令牌 + 已登记的 workflow，`eventId=10` | `200 {"applied":true,"lastEventId":10}` |
| 重复同一事件 | `200 {"applied":false,"lastEventId":10}` |
| 更旧的事件 `eventId=5` | `200 {"applied":false,"lastEventId":10}` |
| 更新的事件 `eventId=11` | `200 {"applied":true,"lastEventId":11}` |
| 请求体不合法 | `400` |

第二条是关键：Core 自己的服务令牌打不开这个门。最小 service identity 不是
文档措辞，它在这里有可观测的效果。

重复与乱序返回 `200` 而不是错误：Activity 重试到达同一结果，把它写成失败会让
调用方无谓重试。库里的终值经 `psql` 复核为 `11|TERMINAL`，不是只看响应。

依赖不可用（数据库、JWKS）返回 `503` 而不是 4xx：结果不明不是拒绝，写成 4xx
会让可恢复故障在 Activity 侧被当作永久失败（`06` §5.1 的
`NonRetryableErrorTypes` 只收 4xx 类）。

核验用的 Tenant/Principal/ActionExecution/WorkflowRef/TaskProjection 行已全部
删除，三张表复核为 `0/0/0`。
