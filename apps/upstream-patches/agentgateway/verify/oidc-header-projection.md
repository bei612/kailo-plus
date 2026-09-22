# SS-AGW-OIDC 接缝证据

本文件记录接缝在固定 commit 上成立的核验，内容随每次重新核验更新。

## 符号可解析（2026-09-22）

在 `1f7ebbf87cbdbe9517f6f181221879d04dc50692` 上逐个 `git grep` 确认：

| 符号 | 文件 |
|---|---|
| `apply_request_policies` | `crates/agentgateway/src/proxy/httpproxy.rs` |
| `apply_request` | `crates/agentgateway/src/http/transformation_cel.rs` |
| `apply_header` | `crates/agentgateway/src/http/mod.rs` |
| `handle_logout` | `crates/agentgateway/src/http/oidc/browser.rs` |

## 版本差异结论

`v1.6.0-alpha.1` 缺少 `http/oidc/browser.rs`，其余 31 个被引用路径均存在。
因此本项目从固定 commit 自行构建，不使用官方发布镜像。
