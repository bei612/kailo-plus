# SS-BUZ-SERVER-CLIENT 运行期核验：NIP-42 会话复用、NIP-11 上界、限流预算

对应 `apps/docs/acceptance/stage-1.md` §2 中 `SS-BUZ-SERVER-CLIENT` 的缺口「按 (principal, active session)
复用 NIP-42 会话」与「固定 NIP-11 上界与限流预算」没有核验记录。已有证据（CLIENT 身份不代签、roster
内外发布、roster 投影重复收敛、stream 的 snapshot/generation）见 `collaboration/fork/verify/server-client.md`
与 `web-relay-core.md`，本文不重复。

实测日期 2026-09-29（UTC 09:50–09:54），本地拓扑 `deploy/local`（compose 项目 `kailo-local`）。
Relay 镜像 `collaboration-relay@sha256:e4c34134…`，没有设置任何 `BUZZ_RATE_LIMIT_*` 或
`BUZZ_MAX_*`（读 `/proc/<pid>/environ` 的变量名，只列名不列值），因此全部用上游缺省值。
核验期间没有改代码、配置、compose，也没有重启服务。

## 请求入口与主体

`oidc-edge.md` 第 0 节记录：此刻经网关的已登录请求都会被 header 名错位拒绝。因此本文的请求
都**直连 BFF** `127.0.0.1:58081`，带运行中 BFF 认的已验证身份 header。这与集成测试
（`VERIFY_BFF_URL`）是同一入口、同一个 router，走完整的会话、准入、代签与审计。

主体用遗留夹具 Tenant `vc8652adc`（subject `verify-f311f55a`，Workspace `daf286a0-…`，
Community host `vc8652adc.kailo.local:8090`，该主体的 Relay pubkey `7658f4ec…`）。它是 stage-1 §7
已登记待删的四个夹具 Tenant 之一。选它是因为不必再新建 Tenant 或 Workspace（一期 Workspace 不可删，`DD-46`）。
本次在它的 Channel 里留下 2 条 kind 9 消息（审计 ACCEPTED 各一条），另有 3 次发布被 Relay 拒绝（审计 REJECTED）。

观测手段：Relay 日志中的 `WebSocket connection established/closed`、`NIP-42 auth successful`
（`buzz-relay/src/connection.rs`、`handlers/auth.rs`）和 `HTTP bridge request`；Relay 指标
`buzz_ws_connections_total{community}`、`buzz_ws_connections_active`、
`buzz_ws_authenticated_connections_active`、`buzz_admission_rejections_total`
（容器内 `curl localhost:9102/metrics`）；Relay 限流计数键
`buzz:<community>:ratelimit:<pubkey>:api`（`buzz-replay` 容器内 `redis-cli`）。

## 1. NIP-42 会话复用

设计依据：`apps/02` Stage 1「按 `(principal, active session)` 复用 NIP-42 会话，写入与历史查询走无状态
NIP-98」；`.design/09`「BFF Relay 连接模型」要求默认总连接上限 10000 与 tier 限额作为容量输入，
不能靠无限增开每 Principal 连接绕过；`SF-BUZ-28`。上游接缝 `buzz-acp/src/relay.rs::HarnessRelay`
在同一条已认证连接上执行多次 `subscribe_channel`（固定 commit `779af888…` 已核对）。

步骤（同一 principal、同一 PlatformSession）：

```text
GET  /api/v1/session                               -> platformSessionId cb9a97b3…
GET  /api/v1/workspaces/daf286a0-…/stream  （流 1，保持）
GET  /api/v1/workspaces/daf286a0-…/stream  （2 秒后，流 2，保持）
GET  /api/v1/session                               -> platformSessionId 仍为 cb9a97b3…
POST /api/v1/workspaces/daf286a0-…/messages        -> 200 {eventId, operationId}
GET  /api/v1/workspaces/daf286a0-…/messages        -> 200
关闭两条流
```

Relay 日志（pubkey 截断）：

```text
09:51:02.345 HTTP bridge request            7658f4ec0658 /query 200   <- 流 1 的 snapshot
09:51:02.385 WebSocket connection established 3aec3244
09:51:02.391 NIP-42 auth successful         3aec3244 7658f4ec0658
09:51:04.328 HTTP bridge request            7658f4ec0658 /query 200   <- 流 2 的 snapshot
09:51:04.329 WebSocket connection established f061c098
09:51:04.331 NIP-42 auth successful         f061c098 7658f4ec0658
09:51:07.512 HTTP bridge request            7658f4ec0658 /query 200   <- 历史查询（NIP-98）
09:51:09.608 WebSocket connection closed    f061c098
09:51:09.608 WebSocket connection closed    3aec3244
```

指标：两条流打开时 `buzz_ws_connections_active 2`、`buzz_ws_authenticated_connections_active 2`、
`buzz_ws_connections_total{community="vc8652adc…"}` 从 0 变为 2；关闭后 active 归 0。
发布和历史查询期间连接数不变，发布走 `/events`（NIP-98）。

| 设计要求 | 实测 | 结论 |
|---|---|---|
| 写入与历史查询走无状态 NIP-98 | 发布只见 `/events`，查询只见 `/query`，都不开 WebSocket | 符合 |
| 同一 (principal, active session) 复用 NIP-42 会话 | 同一 PlatformSession 的两条流各开一条 WebSocket、各做一次 NIP-42 AUTH | **不符** |

实现原因（源码）：`core/crates/collab-bridge/src/stream.rs::subscribe` 每次调用都执行 `connect_async`、
等待 challenge、签发 AUTH 并发送单个 REQ，`Subscription` 被丢弃时关闭连接；
`platform-core/src/stream.rs::open_stream` 每个 SSE 请求调用一次 `subscribe`。仓库中没有按
principal 或 session 缓存连接的结构。影响：连接数与该主体打开的标签页、重连次数成正比，没有上界；
这正是 `.design/09` 所说的「靠增开每 Principal 连接绕过」容量输入。另外，会话中途的 AUTH 挑战按
`web-relay-core.md` 的设计是关流重建，这条与复用并不冲突。

## 2. NIP-11 上界

设计依据：`.design/09`「BFF Relay 连接模型」（BFF 使用 NIP-11 快照与自身更严格配置的交集；10
filters/REQ、1000 limit、1024 subscription、512 KiB frame；单 event content ≤ 256 KiB；5 秒内完成 AUTH；
digest、抓取时间、Relay origin 三者不一致即 `RECONCILING` 并关闭新 stream）；`SF-BUZ-28`；`apps/07` §1。

`GET http://127.0.0.1:8090/info`，`Host: vc8652adc.kailo.local:8090`：

```json
"limitation": {"max_message_length": 524288, "max_subscriptions": 1024, "max_filters": 10,
               "max_limit": 1000, "max_subid_length": 256, "auth_required": true,
               "restricted_writes": true, ...},
"supported_nips": [1,2,10,11,16,17,23,25,29,33,38,42,50,56,43]
```

四个 Community（`kailo-verify`、`kailo-catalog`、`vc8652adc`、`v53941c2e`）的 `/info` 按
`tenant_lifecycle.rs::canonical_digest` 同一规则（键排序、紧凑 JSON、SHA-256）重算，前 16 位都是
`bd6687406fc62d36`，与 `projection.tenant_buzz_binding.nip11_snapshot_digest` 一致。

| 上界 | Relay（NIP-11 / 源码） | Core 的值 | 结论 |
|---|---|---|---|
| filters/REQ | 10 | `collab-bridge::stream::MAX_FILTERS_PER_REQ = 10`（编译期常量）；stream 实际发 1 个 filter | 数值符合；该值不取自快照 |
| 查询 limit | 1000 | `BFF_MESSAGE_PAGE_LIMIT=200` | 符合（取更严） |
| subscription/连接 | 1024 | 每条连接 1 个 REQ | 符合；但见第 1 节，连接数本身没有上界 |
| frame | 524288 | Core 的写入不走 WS frame；实测 600 KiB 正文的 HTTP 发布到达 Relay 的 content 检查 | 不适用于当前写路径 |
| event content | 256 KiB（`ingest.rs` `MAX_EVENT_CONTENT_BYTES`） | BFF **没有**预检；axum `Json` 缺省正文上限 2 MiB | 见下方超限实测 |
| AUTH 时限 | 5 秒（`connection.rs::AUTH_TIMEOUT`） | `BFF_STREAM_AUTH_TIMEOUT_SECONDS=20`（等 challenge 的上界），收到 challenge 立即回 AUTH | 实测 AUTH 在建连后 2–6 ms 内完成；配置值大于 Relay 时限，不相容但无害 |
| 快照与运行期一致 | digest 只在 `verify_tenant_buzz`（`RECONCILING → ACTIVE`）时写入 | stream、查询、发布路径**不**比对 digest，也不从快照取上界 | **不符**：Relay 改小上界后，Core 不会进入 `RECONCILING`，也不会关新 stream |

超限实测（同一主体，`POST /api/v1/workspaces/daf286a0-…/messages`，带 `idempotency-key`）：

| 正文 | BFF 回应 | Relay 日志 | 审计 |
|---|---|---|---|
| 正常 | `200 {eventId, operationId}` | `/events 200 accepted:true` | DISPATCH + ACCEPTED |
| 300 KiB | `403 {"class":"DENIED","reason":"PUBLISH_REJECTED","operationId":…}` | `/events 400 "invalid: content exceeds maximum size of 262144 bytes (got 307200)"` | DISPATCH + REJECTED |
| 600 KiB | 同上 `403 DENIED PUBLISH_REJECTED` | 同上（got 614400） | 同上 |

结论：fail closed 成立，没有假装成功，结果也是确定的 REJECTED（Relay 在 ingest 前拒绝）。但分类
**不符合 `apps/06` §4**：大小上界属于 `LIMIT`（典型 `PAYLOAD_TOO_LARGE`），实现给的是 `DENIED`（不可重试的
权限类）。原因在 `collab-bridge/src/bridge.rs::IdentityClient::deliver`：所有 4xx 一律映射为
`Delivery::Rejected`，`web_transport.rs::publish_message` 再把 `Rejected` 固定映射为
`403 DENIED PUBLISH_REJECTED`。另外 BFF 没有先按 256 KiB 预检，超限请求照样占用 Relay 的 API 预算，
并写入一条 DISPATCH 审计。

## 3. 限流预算

设计依据：`.design/09`（`RateLimitConfig` 的 human/agent tier 限额作为容量输入）；`apps/02` Stage 1
「固定 NIP-11 上界与限流预算」；`SF-BUZ-28`；上游 `buzz-auth/src/rate_limit.rs::RateLimitConfig`
（`human_api_calls_per_min=300`、`human_messages_per_min=60`、`human_ws_events_per_sec=10`；固定 commit
与二开树一致）。HTTP bridge 的 `/events`、`/query`、`/count` 共用每 (Community, pubkey) 每分钟
`human_api_calls_per_min` 一个固定窗口（`api/bridge.rs::enforce_http_admission`），超出回 `429`。

Core 侧：`platform-core` 与 `collab-bridge` 中没有任何限流预算配置或计数，也没有对 `429` 的专门处理
（全文检索 `rate`、`429`、`TOO_MANY` 只在 `client_keys.rs` 自己的登记上限处出现）。

步骤：等该 pubkey 的限流键过期（窗口重新开始），然后连续发 `GET /api/v1/workspaces/daf286a0-…/messages`
（每次恰好对应一次 Relay `/query`），直到第一次非 200；随后立即发一条消息，并开一条流。

| 观测 | 结果 |
|---|---|
| 第 1–300 次查询 | `200`（Relay `/query 200` × 300） |
| 第 301 次（开始后 2.9 秒） | BFF `503`，**空正文**；Redis 计数 `301`、TTL 57 秒；Relay `/query 429`，BFF 日志 `查询历史失败 … HTTP 429 rate-limited: quota exceeded; retry in 57s` |
| 紧接着发布 | BFF `403 {"class":"DENIED","reason":"PUBLISH_REJECTED","operationId":…}`；Relay `/events 429`；BFF 日志 `Relay 拒绝发布 … HTTP 429` |
| 紧接着开流 | `200 text/event-stream`，随即 `event: closed`、`data: upstream-unavailable`，`retry: 2000`（snapshot 的 `/query` 被 429） |
| Relay 指标 | `buzz_admission_rejections_total{transport="http",reason="quota"} 4` |

| 设计要求 | 结论 |
|---|---|
| Relay 按 tier 限额执行限流 | 符合：缺省 300 次/分钟/pubkey，第 301 次被拒 |
| Core 固定自身的限流预算，不把压力透传给 Relay | **不符**：Core 没有预算，唯一的执行点是 Relay 的 429 |
| 超出时 fail closed，不假装成功 | 符合：三条路径都没有返回成功，也没有盲目重发 |
| 按 `apps/06` §4 分类（`LIMIT`，可按策略重试） | **不符**：查询回 `503` 空正文（无 class/reason）；发布回 `DENIED PUBLISH_REJECTED`（声明不可重试，审计记 REJECTED）；流以 `upstream-unavailable` 关闭，浏览器按 `retry: 2000` 每 2 秒重连，每次重连的 snapshot 查询都会继续消耗同一个 pubkey 的预算 |

预算是按 (Community, pubkey) 计的：同一个人的全部标签页、流重连、历史查询与发布共用 300 次/分钟。
加上第 1 节的「每条流一条连接」，一个用户多开几个页面、断线重连几轮，就可能把自己限流。

## 发现（未修，交协调者）

1. **NIP-42 会话不复用**（不符 `apps/02` Stage 1 条目）。复现：见第 1 节，两条流 → 两次 AUTH、两条连接。
   影响：每个主体的连接数没有上界，Relay 的 10000 总连接上限可能被少数用户耗尽。
2. **限流与大小超限的错误分类不符合 `apps/06` §4**。复现：见第 2、3 节。影响：界面与告警把可恢复的
   `LIMIT` 当成权限拒绝（`DENIED`）或无分类的 503。发布被 429 拒绝后，审计记为 REJECTED，本身是正确的
   确定结果，但 reason 不对。
3. **Core 没有固定的限流预算**；**NIP-11 快照只在 binding 激活时核对，运行期不参与上界计算与一致性判定**。
   影响：Relay 改变上界或限额时 Core 不会察觉，也不会按 `.design/09` 进入 `RECONCILING`。
4. **BFF 不按 256 KiB 预检正文**。超限请求消耗 Relay 预算，并各写一条 DISPATCH 审计。
5. 环境：此刻经网关的已登录请求被 header 名错位拒绝（`oidc-edge.md` 第 0 节），所以本文全部直连 BFF。
