//! 平台接入（`DD-75`、`DD-78`、`DD-79`）。
//!
//! 桌面端是平台的原生端：协作数据平面本机持钥直连 Relay，管理平面经网关的
//! 原生入口进 BFF。本模块只负责后一半与两者的衔接：
//!
//! - 以 RFC 8252 登录企业 IdP（系统浏览器、回环回调、PKCE S256），令牌只在 Rust
//!   侧：刷新令牌进 OS keyring，访问令牌只在内存；
//! - 用已有的设备身份（keyring 中的 Nostr 密钥）以绑定会话的 NIP-98 持钥证明
//!   登记设备公钥；
//! - 取该 Tenant 的 Community 连接事实（Relay 地址）；
//! - 为前端代发管理平面请求：前端看不到令牌，只能调用 `/api/v1/` 下的路径。

pub(crate) mod api;
pub(crate) mod commands;
pub(crate) mod config;
pub(crate) mod oidc;
pub(crate) mod native_page;

#[cfg(test)]
mod e2e;
