# 原生端身份链核验

对应 `DD-77`（一人多绑定）、`DD-78`（原生端经网关专用入口以 Bearer 进入）、`DD-79`（设备公钥以
持钥证明登记、`BUZZ_IDENTITY_PROJECTION` 投影），以及 Stage 1 退出门禁中的「外来身份 header、
缺失 header 全部被拒绝」「原生端验收覆盖协作数据平面与管理平面两条路径」。

本文核验的是**平台一侧**：网关入口、Core、Worker 与 Relay 的行为。测试进程扮演原生应用——按
RFC 8252 登录 IdP、在本机生成设备密钥、自己签名直连 Relay。Desktop 与 Mobile 应用本身是各自的
交付物，不由本文证明。

## 入口

| 请求 | 结果 |
|---|---|
| 原生入口，不带令牌 | 网关 `401`，不到 BFF（`jwtAuth` `mode: strict`，`SF-AGW-24`） |
| 原生入口，伪造令牌 | 网关 `401` |
| 原生入口，PKCE 取得的访问令牌 | 令牌 `aud=kailo-bff`、`azp=kailo-native`；BFF 解析出与浏览器入口相同的 Tenant 与会话 |
| 浏览器入口，自报 `x-kailo-client-surface: native` | 网关移除该 header，BFF 回 `NATIVE_SURFACE_REQUIRED`（真实浏览器走查实测） |

最后一条的反向实测：把 `x-kailo-client-surface` 从浏览器 listener 的移除列表拿掉并重建网关，
走查在该步失败，回应变为 `CLIENT_KEY_PROOF_INVALID`——header 穿过了网关、BFF 越过了入口检查。
两个 reason 因此能区分「网关移除了它」与「它到达了 BFF」。

## Community 连接事实

原生端本机持钥直连 Relay（`DD-75`），需要知道连到哪里；Buzz Web 永远拿不到这个地址（`DD-39`）。
`GET /api/v1/native/community` 只对原生入口开放，返回该 Tenant 的 Community host 与由
`BUZZ_RELAY_NATIVE_URL_TEMPLATE` 代入它得到的 Relay 地址。Relay 按连接的 Host 绑定 Community
（`SF-BUZ-32`），因此地址的主机名必须就是 Community host——集成测试断言这一点。

| 请求 | 结果 |
|---|---|
| 原生入口 | `200`，`relayUrl` 的主机名等于 `communityHost` |
| 浏览器入口 | `403 NATIVE_SURFACE_REQUIRED` |
| 模板不含 `{host}` 时启动 Core | 拒绝启动：固定地址会把所有 Tenant 连到同一个 Community |

## 设备公钥的完整生命周期

`core/crates/kailo-core/tests/native_client.rs`，在本地拓扑上从头走到尾：

| 步骤 | 结果 |
|---|---|
| 浏览器入口提交登记 | `403 NATIVE_SURFACE_REQUIRED` |
| 持钥证明绑定别人的会话 | `403 CLIENT_KEY_PROOF_INVALID`——截获的证明不能在他人会话里重放 |
| 持钥证明的 `method` 不是 `POST` | `403 CLIENT_KEY_PROOF_INVALID` |
| 持钥证明超出时间窗 | `403 CLIENT_KEY_PROOF_INVALID` |
| 合法登记 | `202 RECONCILING`，`BUZZ_IDENTITY_PROJECTION` 投入 relay 与 Channel roster 后 `ACTIVE` |
| 同一设备重复登记 | `200 ACTIVE`，不起第二条 Workflow |
| 成员页 | 同一人名下两把公钥：Web（SERVER）与该设备（CLIENT） |
| 设备以自己的私钥**直连 Relay** 发布 | 被 Relay 接受 |
| 在浏览器入口撤销该设备 | `202 REVOKING`，Workflow 移出全部 roster 后 `REVOKED` |
| 撤销后设备再直连 Relay 发布 | **Relay 拒绝**——执行点是 roster，不是 Core 停止签名（`DD-75`） |
| 同一人经 Web 发布 | 仍成功：只撤了那一台 |
| 已撤销的公钥再次登记 | `409 CLIENT_KEY_ALREADY_BOUND`：撤销的身份不复活 |

## 直连 Relay 不等于能治理

设备持钥直连 Relay 之后，上游宽松的 NIP-29 权限就成了它可直达的旁路（`SF-BUZ-37`）：
自建 Channel、自加入别的 Workspace、读写非成员 Channel。Relay 以 `SS-BUZ-GOVERNANCE`
只接受成员发布 `BUZZ_MEMBER_EVENT_KINDS` 里的 kind，其余只收 Tenant CONTROL 签发，
Channel 一律 private（`DD-80`）。上面的生命周期里，已登记的设备能直连发消息，但自建
Channel 被 Relay 拒绝。逐项核验见 `upstream-patches/buzz/verify/governance.md`。

## 与撤权并发时不留下已撤销的钥匙

设备投影与成员撤权可能交错。设计固定两件事：撤权一方先把状态置为 `REVOKING`（成员或设备）
再动 roster；设备投影每次投入之后都回头核对这两个状态，发现撤权已开始就把刚投入的移出；置
`ACTIVE` 与「成员仍 ACTIVE」在同一条 SQL 里判定。由此任何交错下都不会留下一把已撤销却仍在
roster 上的钥匙（`core/crates/kailo-core/src/identity_projection.rs`）。

## 数据模型

`20260923040000_buzz_identity_multi_binding`：`buzz_identity_binding` 改以 `pubkey` 为主键；每人
至多一条非 `REVOKED` 的 SERVER binding（部分唯一索引）；CLIENT binding 只能是 HUMAN（CHECK）。

- 前进、回退、再前进三步演练通过（`tools/check.sh migrate`）。
- 同一人有两条 binding 时回退被拒绝：删掉其中任何一条都等于替用户撤掉一台设备。
- 尝试写入 CLIENT 托管的 CONTROL 被约束拒绝。

成员投影改为覆盖此人**全部** pubkey：建立方向投入 ACTIVE 与登记中的钥匙（撤销中的不重新加回），
撤权方向移出全部非 REVOKED 的钥匙。Web 取签名密钥时只取 SERVER 那一把——多把之后再按「第一行」
取，可能取到设备的公钥而让 Web 发布被拒。

## 门禁

`tools/check.sh security` 对每个 listener 判定：恰好挂一种认证（`oidc` 或 `jwtAuth`）；OIDC 必须
配 logout；`jwtAuth` 必须 `mode: strict`、`audiences` 非空、不保留令牌；原生入口把
`x-kailo-client-surface` 投影为固定值 `"native"`，浏览器入口必须移除它。六种违规各自破坏一次，
均报出对应条款，还原后逐字节一致。

`tools/check.sh migrate` 的枚举一致性检查在 `workflow_kind` 缺少新 kind 时报出库与契约的差异。

`worker/replay-tests` 录入了设备登记与撤销两份真实 history；在该分支多发一次状态投影即报
nondeterministic。

## IdP 登记（部署前置）

原生端是 RFC 8252 的公开客户端，部署时在 IdP 登记：不发 client secret，PKCE `S256`，redirect
只允许本机回环 `http://127.0.0.1/*`，访问令牌带 audience `OIDC_NATIVE_AUDIENCE`。本地拓扑的 realm
模板 `deploy/local/keycloak/kailo-realm.json` 即按此登记；渲染在进程内完成，secret 不上命令行。
