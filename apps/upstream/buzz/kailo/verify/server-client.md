# SS-BUZ-SERVER-CLIENT 接缝证据

## 符号可解析（2026-09-22）

在 `779af8886caae1317b4de962082429867ab61503` 上确认 `HarnessRelay::connect` /
`subscribe_channel` / `reconnect` 与 `RestClient::sign_nip98` / `query_raw_all` /
`submit_event` 均存在于 `crates/buzz-acp/src/relay.rs`。

Core 侧只取其 NIP-98 HTTP bridge 部分（写入与历史查询），按 `.design/09` 第 4 步
实现 per-BuzzIdentity 客户端。上游的内存 queue/seen/retry 不升格为业务可靠权威——
重试与去重由 Core 的 outbox 承担。

## 三条已实测

`core/crates/kailo-buzz/tests/bridge.rs` 对运行中的 Relay 执行：

| 性质 | 结果 |
|---|---|
| `custody=CLIENT` 的身份不被 Core 代签 | 通过。在构造阶段就失败，不发任何网络请求 |
| roster 之外的 pubkey 发布被拒 | 通过。`require_relay_membership=true` 下 roster 是协作面唯一准入执行点 |
| roster 之内发布被接受并返回 event id | 通过。id 取自 Relay 响应，不用本地算出的值 |

第一条是 `DD-75` 的落点：原生端本机持钥直连 Relay，Core 手里没有那把钥匙，
在这里尝试代签说明实现走错了路径，必须当场失败而不是用别的身份凑合。

## 实测撞出的三处上游契约

**Tenant 绑定在 Host 头，且参与签名。** Relay 按请求 Host 绑定 Community，
NIP-98 的期望 URL 是 `{scheme}://{tenant.host()}{path}`——Relay 的网络地址
不参与签名。因此客户端必须分开持有「传输地址」与「Community host」，
以后者签名并作为 Host 头（`SF-BUZ-32`）。

**Channel 标识是 UUID，不是创建事件 id。** `extract_channel_id` 只接受能解析为
UUID 的 `h` 值；传 event id 会得到「must include an h tag」这个不区分成因的错误
（`SF-BUZ-33`）。Channel UUID 要从 Relay 签发的 kind 39002 的 `d` 标签取得。

**Relay 的接受响应是 `{"accepted":true,"event_id":"..."}`。** 客户端只认它给的
id——本地算得出不等于 Relay 接受了它，而 event id 要作为 operation outcome 与
audit evidence（`.design/09` 第 6 步）。

## roster 投影面（2026-09-22）

`DD-41`/`DD-45` 的两个执行投影都落在这个接缝上：TenantMembership 投到 relay-level
roster（kind 9030/9031），WorkspaceMembership 投到 Channel roster（kind 9000/9001）。
`core/crates/kailo-buzz/tests/bridge.rs::roster_projection_converges_and_is_repeatable`
对运行中的 Relay 执行：

| 性质 | 结果 |
|---|---|
| 加入 relay roster 与 Channel roster，各重复执行两次 | 通过。两次都返回成功 |
| 撤 relay roster 与 Channel roster，各重复执行两次 | 通过。第二次是关键——上游此时返回 `member not found` |
| 撤权后该 pubkey 发布被拒 | 通过。撤的是执行点，不只是快照 |
| 普通 member 发出 roster 管理事件 | 通过。得到「未收敛」并带上游拒绝理由，不是成功 |

重复执行是必须验的：Activity 会重试、Worker 会崩溃重放，同一次投影必然被执行多次。

## 实测撞出的第四处上游契约

**roster 的成功判据只能是查证结果，不能是事件被接受。** 上游两端都不幂等：
移除已不在 roster 的目标返回错误（relay 面 `member not found`、Channel 面
`DbError::MemberNotFound`），加入已在 roster 的目标是静默 no-op 且不覆盖既有角色。
更麻烦的是拒绝本身有歧义——「移除一个已经不在 roster 的成员」这条拒绝恰恰
说明目标状态已经成立。想靠错误文本区分两类拒绝就成了对上游措辞的隐式依赖。

因此 `converge` 只把传输与签名失败当确定失败，把**全部拒绝并入「未收敛」**
并把理由带进详情，由调用方的重试上界决定何时放弃。这同时解决了 `SF-BUZ-34`：
relay-level roster 唯一的读取面是 best-effort 重建的 NIP-43 快照，同一秒内回到
此前出现过的成员集合会让重建整事务回滚，快照停留在过期值上，只有 Relay 的周期
对账能修。读到旧值是结果不明，不是拒绝，收敛上界即 `BUZZ_NIP43_RECONCILE_INTERVAL_SECS`
（已登记进 `07` §1）。
