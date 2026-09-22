//! Platform Core/BFF 入口。
//!
//! 单一部署单元、单一业务事务边界（`AGENTS.md` 规则 6）。模块按
//! `01-工程结构与模块边界.md` §3 以 crate 与可见性划分，不走网络、不引消息总线。

mod bff;

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

    let app = bff::router(pool);
    let listener = tokio::net::TcpListener::bind(listen).await?;
    tracing::info!(addr = %listen, "bff listening");
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
