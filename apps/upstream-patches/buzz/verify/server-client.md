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
