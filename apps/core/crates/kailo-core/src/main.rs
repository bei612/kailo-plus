//! Platform Core/BFF 入口。
//!
//! 单一部署单元、单一业务事务边界（`AGENTS.md` 规则 6）。模块按
//! `01-工程结构与模块边界.md` §3 以 crate 与可见性划分，不走网络、不引消息总线。

mod audit;
mod bff;
mod client_keys;
mod component_task;
mod identity_projection;
mod membership_lifecycle;
mod membership_projection;
mod membership_state;
mod native;
mod oidc;
mod platform_bootstrap;
mod platform_views;
mod publish_reconcile;
mod roster_reconcile;
mod scope_state;
mod service_api;
mod service_auth;
mod stream;
mod task_projection;
mod telemetry;
mod temporal;
mod tenant_lifecycle;
mod user_state;
mod web_transport;
mod workflow_reconcile;

use std::net::SocketAddr;

use sqlx::postgres::PgPoolOptions;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt().json().init();
    // 运维信号的导出先于一切：启动期的失败也要能被看见（ADR-05）
    let meter_provider = telemetry::init()?;

    // 配置一律显式提供：缺任一项拒绝启动，不回退默认值（GOAL 的硬编码红线）
    let database_url = std::env::var("DATABASE_URL").map_err(|_| "缺少 DATABASE_URL")?;
    let listen: SocketAddr = std::env::var("BFF_LISTEN")
        .map_err(|_| "缺少 BFF_LISTEN")?
        .parse()?;

    let pool = PgPoolOptions::new()
        .max_connections(
            std::env::var("CORE_DB_MAX_CONNECTIONS")
                .map_err(|_| "缺少 CORE_DB_MAX_CONNECTIONS")?
                .parse()
                .map_err(|_| "CORE_DB_MAX_CONNECTIONS 必须是正整数")?,
        )
        .connect(&database_url)
        .await?;

    // BFF 与 service API 分开监听。网关的路由是 pathPrefix: /，整体转发给
    // BFF；把 Worker 的写入口挂在同一端口上，等于让任何已登录用户能打到它。
    // 端口隔离让这件事在拓扑层就不成立，而不是只靠代码里的认证分支。
    let service_listen: SocketAddr = std::env::var("SERVICE_LISTEN")
        .map_err(|_| "缺少 SERVICE_LISTEN")?
        .parse()?;
    // 平台引导先于监听：没有 operator 身份就永远创建不了任何 Tenant，
    // 此时「起来但做不了事」比拒绝启动更糟——前者要等到第一次建 Tenant 才暴露。
    let secrets = std::sync::Arc::new(kailo_secrets::SecretStore::from_env()?);
    let catalog_tenant = platform_bootstrap::ensure(
        &pool,
        &secrets,
        &platform_bootstrap::BootstrapConfig::from_env()?,
    )
    .await?;

    // Service API 与 BFF 共用同一个 Temporal 客户端：两边启动的是同一种
    // ComponentTaskWorkflow，令牌缓存也只该有一份。
    let temporal = std::sync::Arc::new(
        temporal::TemporalClient::from_env(oidc::TokenSource::from_env()?).await?,
    );
    // 兜底对账：修补漏写的 Workflow 终态投影并发出收敛度量（06 §3.1）
    workflow_reconcile::spawn(
        pool.clone(),
        std::sync::Arc::clone(&temporal),
        &opentelemetry::global::meter("kailo-core"),
        workflow_reconcile::Config::from_env()?,
    );

    let service_state = service_api::ServiceState {
        pool: pool.clone(),
        auth: std::sync::Arc::new(service_auth::ServiceAuth::from_env()?),
        secrets: std::sync::Arc::clone(&secrets),
        catalog_tenant,
        secret_mount: format!(
            "{}/{}",
            std::env::var("OPENBAO_PLATFORM_NAMESPACE")
                .map_err(|_| "缺少 OPENBAO_PLATFORM_NAMESPACE")?,
            std::env::var("OPENBAO_KV_MOUNT").map_err(|_| "缺少 OPENBAO_KV_MOUNT")?
        ),
        secret_audience: std::env::var("OPENBAO_SERVICE_IDENTITY")
            .map_err(|_| "缺少 OPENBAO_SERVICE_IDENTITY")?,
        community_domain: std::env::var("BUZZ_COMMUNITY_DOMAIN")
            .map_err(|_| "缺少 BUZZ_COMMUNITY_DOMAIN")?,
        relay_transport: std::env::var("BUZZ_RELAY_TRANSPORT")
            .map_err(|_| "缺少 BUZZ_RELAY_TRANSPORT")?,
        http: reqwest::Client::new(),
        temporal: std::sync::Arc::clone(&temporal),
    };

    // roster 与成员事实的对账度量（07 §3）。它用 CONTROL 身份读 roster，与
    // service API 共用同一份依赖。
    roster_reconcile::spawn(
        service_state.clone(),
        &opentelemetry::global::meter("kailo-core"),
        roster_reconcile::Config::from_env()?,
    );

    // 结果不明的消息发布按 event id 对账成确定结果（DD-81）
    publish_reconcile::spawn(
        service_state.clone(),
        &opentelemetry::global::meter("kailo-core"),
        publish_reconcile::Config::from_env()?,
    );

    let bff_state = bff::BffState {
        pool: pool.clone(),
        temporal,
        client_key_proof_window_seconds: std::env::var("BFF_CLIENT_KEY_PROOF_WINDOW_SECONDS")
            .map_err(|_| "缺少 BFF_CLIENT_KEY_PROOF_WINDOW_SECONDS")?
            .parse()
            .map_err(|_| "BFF_CLIENT_KEY_PROOF_WINDOW_SECONDS 必须是秒数")?,
        client_keys_per_principal: std::env::var("BFF_CLIENT_KEYS_PER_PRINCIPAL")
            .map_err(|_| "缺少 BFF_CLIENT_KEYS_PER_PRINCIPAL")?
            .parse()
            .map_err(|_| "BFF_CLIENT_KEYS_PER_PRINCIPAL 必须是正整数")?,
        relay_native_url_template: {
            let t = std::env::var("BUZZ_RELAY_NATIVE_URL_TEMPLATE")
                .map_err(|_| "缺少 BUZZ_RELAY_NATIVE_URL_TEMPLATE")?;
            // authority 必须恰好是 {host}：没有占位符就是一个固定地址，所有 Tenant
            // 会被连到同一个 Community；占位符旁再带端口或 userinfo，客户端发出的
            // Host 就不再是 Community host（Relay 只剥 :80/:443，其余端口属于
            // host，SF-BUZ-41）。非默认端口写进 BUZZ_COMMUNITY_DOMAIN。
            let rest = t
                .strip_prefix("wss://{host}")
                .or_else(|| t.strip_prefix("ws://{host}"));
            if !matches!(rest, Some(r) if r.is_empty() || r.starts_with('/')) {
                return Err("BUZZ_RELAY_NATIVE_URL_TEMPLATE 必须形如 ws[s]://{host}[/path]".into());
            }
            t
        },
        session_ttl_seconds: std::env::var("PLATFORM_SESSION_TTL_SECONDS")
            .map_err(|_| "缺少 PLATFORM_SESSION_TTL_SECONDS")?
            .parse()
            .map_err(|_| "PLATFORM_SESSION_TTL_SECONDS 必须是秒数")?,
        secrets: std::sync::Arc::clone(&secrets),
        http: reqwest::Client::new(),
        relay_transport: std::env::var("BUZZ_RELAY_TRANSPORT")
            .map_err(|_| "缺少 BUZZ_RELAY_TRANSPORT")?,
        message_page_limit: std::env::var("BFF_MESSAGE_PAGE_LIMIT")
            .map_err(|_| "缺少 BFF_MESSAGE_PAGE_LIMIT")?
            .parse()
            .map_err(|_| "BFF_MESSAGE_PAGE_LIMIT 必须是数字")?,
        relay_ws_url: std::env::var("BUZZ_RELAY_WS_URL").map_err(|_| "缺少 BUZZ_RELAY_WS_URL")?,
        stream_buffer: std::env::var("BFF_STREAM_BUFFER")
            .map_err(|_| "缺少 BFF_STREAM_BUFFER")?
            .parse()
            .map_err(|_| "BFF_STREAM_BUFFER 必须是数字")?,
        stream_readmit_seconds: std::env::var("BFF_STREAM_READMIT_SECONDS")
            .map_err(|_| "缺少 BFF_STREAM_READMIT_SECONDS")?
            .parse()
            .map_err(|_| "BFF_STREAM_READMIT_SECONDS 必须是秒数")?,
        stream_retry_millis: std::env::var("BFF_STREAM_RETRY_MILLIS")
            .map_err(|_| "缺少 BFF_STREAM_RETRY_MILLIS")?
            .parse()
            .map_err(|_| "BFF_STREAM_RETRY_MILLIS 必须是毫秒数")?,
        media_max_bytes: std::env::var("BFF_MEDIA_MAX_BYTES")
            .map_err(|_| "缺少 BFF_MEDIA_MAX_BYTES")?
            .parse()
            .map_err(|_| "BFF_MEDIA_MAX_BYTES 必须是字节数")?,
    };

    let bff = tokio::net::TcpListener::bind(listen).await?;
    let service = tokio::net::TcpListener::bind(service_listen).await?;
    tracing::info!(bff = %listen, service = %service_listen, "listening");

    let shutdown = || async {
        let _ = tokio::signal::ctrl_c().await;
    };
    // 任一监听退出即整体退出：只剩半边可用会让调用方看到不一致的可用性。
    tokio::try_join!(
        axum::serve(bff, bff::router(bff_state)).with_graceful_shutdown(shutdown()),
        axum::serve(service, service_api::router(service_state)).with_graceful_shutdown(shutdown()),
    )?;
    // 退出前把缓冲中的指标送出去
    if let Err(e) = meter_provider.shutdown() {
        tracing::warn!(error = %e, "指标导出未能完成");
    }
    Ok(())
}
