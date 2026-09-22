# SS-AGW-OIDC 接缝证据

本文件记录接缝在固定 commit 上成立的核验，内容随每次重新核验更新。

## 运行的是哪个产物

镜像由 `tools/build-upstream.sh agentgateway` 从 `.design/02` §1 的固定 commit 构建。
容器自报：

```json
{ "version": "1f7ebbf87cbd",
  "git_revision": "1f7ebbf87cbdbe9517f6f181221879d04dc50692" }
```

`git_revision` 与 evidence commit 逐字符相等，产物可追溯到证据本身。

## 符号可解析（2026-09-22）

在 `1f7ebbf87cbdbe9517f6f181221879d04dc50692` 上逐个 `git grep` 确认：

| 符号 | 文件 |
|---|---|
| `apply_request_policies` | `crates/agentgateway/src/proxy/httpproxy.rs` |
| `apply_request` | `crates/agentgateway/src/http/transformation_cel.rs` |
| `apply_header` | `crates/agentgateway/src/http/mod.rs` |
| `handle_logout` | `crates/agentgateway/src/http/oidc/browser.rs` |

`v1.6.0-alpha.1` 缺少 `http/oidc/browser.rs`，其余 31 个被引用路径均存在。
因此本项目从固定 commit 自行构建，不使用官方发布镜像。

## fail-closed：无会话

无 OIDC 会话访问网关：返回 302 跳转到授权端点，请求不到达后端。
携带伪造的 `x-kailo-oidc-subject` 与 `x-kailo-tenant` 同样是 302。
后端在整个过程中收到的含 `x-kailo` 的请求数为 **0**。

## 正向：有会话时只有两条 header 穿过

完成一次真实的 OIDC 授权码登录后，带会话并同时伪造身份 header 访问，
后端实际收到的 `x-kailo-*` 恰为两条：

```text
"x-kailo-oidc-issuer":  "http://keycloak.kailo.local:8080/realms/kailo"
"x-kailo-oidc-subject": "a9bea679-f78a-4277-859f-069cede98682"
```

伪造的 `x-kailo-oidc-subject: FORGED` 与 `x-kailo-tenant: FORGED` 均未出现：
前者被 `set` 以已验证的 `jwt.sub` 覆盖，后者在 `remove` 列表中。

`set` 的 fail-closed 由 `apply_header` 的 `(Header(k), None) => headers().remove(k)`
分支保证：CEL 求值得不到值时目标 header 被删除，而不是保留调用方自报的值。
因此两个投影目标刻意不放进 `remove`——放进去只会引入删掉正确值的风险。

## 核验时发现的一个前提

HTTP 客户端的 cookie 引擎普遍不为**单标签主机名**保存或发送 cookie。
以 Docker 服务名（`keycloak`、`agentgateway`）直接做 OIDC issuer 与 redirect
主机时，授权码流会在提交凭据一步失败并报 `Restart login cookie not found`，
且失败点距真实原因很远。本地拓扑因此给两个服务加了带点的网络别名
（`keycloak.kailo.local`、`gateway.kailo.local`），与真实部署使用 FQDN 的形状一致。

这不是接缝本身的性质，但它决定接缝能否在本地被验证，故记录于此。
