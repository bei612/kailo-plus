//! Platform Core/BFF 入口。
//!
//! 单一部署单元、单一业务事务边界（`AGENTS.md` 规则 6）。模块按
//! `01-工程结构与模块边界.md` §3 以 crate 与可见性划分，不走网络、不引消息总线。

mod bff;
mod membership_lifecycle;
mod membership_projection;
mod membership_state;
mod oidc;
mod service_api;
mod service_auth;
mod temporal;

use std::net::SocketAddr;

use sqlx::postgres::PgPoolOptions;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt().json().init();

    // 配置一律显式提供：缺任一项拒绝启动，不回退默认值（GOAL 的硬编码红线）
    let database_url = std::env::var("DATABASE_URL").map_err(|_| "缺少 DATABASE_URL")?;
    let listen: SocketAddr = std::env::var("BFF_LISTEN")
        .map_err(|_| "缺少 BFF_LISTEN")?
        .parse()?;

    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&database_url)
        .await?;

    // BFF 与 service API 分开监听。网关的路由是 pathPrefix: /，整体转发给
    // BFF；把 Worker 的写入口挂在同一端口上，等于让任何已登录用户能打到它。
    // 端口隔离让这件事在拓扑层就不成立，而不是只靠代码里的认证分支。
    let service_listen: SocketAddr = std::env::var("SERVICE_LISTEN")
        .map_err(|_| "缺少 SERVICE_LISTEN")?
        .parse()?;
    let service_state = service_api::ServiceState {
        pool: pool.clone(),
        auth: std::sync::Arc::new(service_auth::ServiceAuth::from_env()?),
        secrets: std::sync::Arc::new(kailo_secrets::SecretStore::from_env()?),
        relay_transport: std::env::var("BUZZ_RELAY_TRANSPORT")
            .map_err(|_| "缺少 BUZZ_RELAY_TRANSPORT")?,
        http: reqwest::Client::new(),
        temporal: std::sync::Arc::new(
            temporal::TemporalClient::from_env(oidc::TokenSource::from_env()?).await?,
        ),
    };

    let bff = tokio::net::TcpListener::bind(listen).await?;
    let service = tokio::net::TcpListener::bind(service_listen).await?;
    tracing::info!(bff = %listen, service = %service_listen, "listening");

    let shutdown = || async {
        let _ = tokio::signal::ctrl_c().await;
    };
    // 任一监听退出即整体退出：只剩半边可用会让调用方看到不一致的可用性。
    tokio::try_join!(
        axum::serve(bff, bff::router(pool)).with_graceful_shutdown(shutdown()),
        axum::serve(service, service_api::router(service_state)).with_graceful_shutdown(shutdown()),
    )?;
    Ok(())
}
