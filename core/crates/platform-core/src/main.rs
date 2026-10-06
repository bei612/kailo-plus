//! Platform Core/BFF 入口。
//!
//! 单一部署单元、单一业务事务边界（`AGENTS.md` 规则 6）。模块按
//! `01-工程结构与模块边界.md` §3 以 crate 与可见性划分，不走网络、不引消息总线。

mod action_token;
mod agent_definition;
mod agent_installation;
mod agent_installation_query;
mod agent_invocation;
mod agent_memory;
mod agent_policy;
mod agent_runtime;
mod agent_session;
mod agent_task;
mod agent_tool;
mod agent_tool_mcp;
mod agent_tool_pep;
mod agent_tool_runtime;
mod agent_tool_session;
mod agent_version;
mod agent_version_query;
mod application_binding;
mod application_catalog;
mod application_execution;
mod application_page;
mod application_tool;
mod audit;
mod audit_views;
mod automation;
mod automation_query;
mod bff;
mod capability_contract;
mod capability_registry;
mod capacity;
mod client_keys;
mod component_conformance_identity;
mod component_release;
mod component_task;
mod delegation_query;
mod external_human;
mod gateway_usage;
mod governance;
mod governance_api;
mod governance_reconcile;
mod identity_projection;
mod invitation;
mod membership_lifecycle;
mod membership_projection;
mod membership_state;
mod model_route;
mod native;
mod oidc;
mod openmeter;
mod platform_bootstrap;
mod platform_build_info;
mod platform_info;
mod platform_keys;
mod platform_views;
mod publish_reconcile;
mod resource_provision;
mod role_reconcile;
mod roles;
mod roster_reconcile;
mod scope_state;
mod secret_ref_rehome;
mod server_identity;
mod server_keys;
mod service_api;
mod service_auth;
mod spicedb;
mod stream;
mod task_projection;
mod task_rerun;
mod telemetry;
mod temporal;
mod tenant_bootstrap;
mod tenant_delete;
mod tenant_lifecycle;
mod user_state;
mod web_transport;
mod workflow_reconcile;

use std::net::SocketAddr;

use sqlx::postgres::PgPoolOptions;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, Layer};
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::fmt::layer()
                .json()
                .with_filter(tracing_subscriber::filter::LevelFilter::INFO)
                .with_filter(tracing_subscriber::filter::filter_fn(|metadata| {
                    telemetry::safe_log_target(metadata.target())
                })),
        )
        .init();

    // 部署引导（DD-82、ADR-11）：不监听任何端口、不取 OpenBao 投递，做完即退出。
    // 只有能在 Core 容器内执行命令的人能走到这里。
    let argv: Vec<String> = std::env::args().collect();
    if argv.get(1).map(String::as_str) == Some("bootstrap-tenant") {
        let outcome = tenant_bootstrap::run(tenant_bootstrap::Args::parse(&argv[2..])?).await?;
        println!("{}", serde_json::to_string(&outcome)?);
        // 退出码让脚本不必解析输出就知道要不要重跑：PENDING 重跑以继续；INERT 说明
        // 该 Tenant 已有其他有效 admin，引导什么也没做
        std::process::exit(match outcome.state {
            "COMPLETED" => 0,
            "PENDING" => 3,
            _ => 4,
        });
    }

    // 运维信号的导出先于一切：启动期的失败也要能被看见（ADR-05）
    let meter_provider = telemetry::init()?;

    // 配置一律显式提供：缺任一项拒绝启动，不回退默认值（GOAL 的硬编码红线）
    let platform_info = std::sync::Arc::new(platform_info::from_env()?);
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

    let agent_runtime = agent_runtime::Supervisor::from_env()?.map(std::sync::Arc::new);
    let capacity = std::sync::Arc::new(capacity::Capacity::from_env()?);
    let agent_memory =
        std::sync::Arc::new(agent_memory::Config::from_env().map_err(|_| "Agent memory 配置无效")?);

    // BFF 与 service API 分开监听。网关的路由是 pathPrefix: /，整体转发给
    // BFF；把 Worker 的写入口挂在同一端口上，等于让任何已登录用户能打到它。
    // 端口隔离让这件事在拓扑层就不成立，而不是只靠代码里的认证分支。
    let service_listen: SocketAddr = std::env::var("SERVICE_LISTEN")
        .map_err(|_| "缺少 SERVICE_LISTEN")?
        .parse()?;
    // 平台引导先于监听：没有 operator 身份就永远创建不了任何 Tenant，
    // 此时「起来但做不了事」比拒绝启动更糟——前者要等到第一次建 Tenant 才暴露。
    let secrets = std::sync::Arc::new(secret_store::SecretStore::from_env()?);
    // OpenBao 的 audit fail-closed 只在至少一个 device 启用时成立（SF-OBA-06）。
    // 零 device 时一切取用照常通过、不留痕，因此在取用任何 secret 之前实际读一次
    // 清单：为空或读不到都拒绝启动（DD-70「拒绝进入 serving 状态」）。
    let audit = std::sync::Arc::new(secret_store::AuditObserver::from_env()?);
    // 引导凭据以 response wrapping 一次性投递（DD-70）：这里消费它们换出 service
    // token。wrapping token 已被消费、过期或来路不对都按泄漏处理，拒绝启动。
    secrets
        .connect()
        .await
        .map_err(|e| format!("OpenBao 引导凭据不可用，拒绝启动: {e}"))?;
    let outcome: Result<(), Box<dyn std::error::Error>> = async {
        audit
            .connect()
            .await
            .map_err(|e| format!("OpenBao audit 观察凭据不可用，拒绝启动: {e}"))?;
        match audit.enabled_devices().await {
            Ok(0) => return Err("OpenBao 没有启用任何 audit device：取用不留痕，拒绝启动".into()),
            Ok(n) => tracing::info!(devices = n, "OpenBao audit device 已启用"),
            Err(e) => {
                return Err(format!("读取 OpenBao audit device 清单失败，拒绝启动: {e}").into())
            }
        }
        let catalog_tenant = platform_bootstrap::ensure(
            &pool,
            &secrets,
            &audit,
            &platform_bootstrap::BootstrapConfig::from_env()?,
            &reqwest::Client::new(),
        )
        .await?;
        converge_tenant_namespaces(&pool, &secrets).await?;

        // Service API 与 BFF 共用同一个 Temporal 客户端：两边启动的是同一种
        // ComponentTaskWorkflow，令牌缓存也只该有一份。
        let temporal = std::sync::Arc::new(
            temporal::TemporalClient::from_env(oidc::TokenSource::from_env()?).await?,
        );
        // 兜底对账：修补漏写的 Workflow 终态投影并发出收敛度量（06 §3.1）
        workflow_reconcile::spawn(
            pool.clone(),
            std::sync::Arc::clone(&temporal),
            &opentelemetry::global::meter("platform-core"),
            workflow_reconcile::Config::from_env()?,
        );

        // 治理内核：准入、审批与派发（.design/05 §1）。BFF 与 service API 共用一份——
        // 审批投影写回（service）与语义命令（BFF）推进的是同一批 ActionExecution。
        let openmeter = std::sync::Arc::new(openmeter::OpenMeter::from_env()?);
        let governance = std::sync::Arc::new(governance::Governance {
            pool: pool.clone(),
            temporal: std::sync::Arc::clone(&temporal),
            spicedb: spicedb::SpiceDb::from_env(reqwest::Client::new())?,
            secrets: std::sync::Arc::clone(&secrets),
            audit: std::sync::Arc::clone(&audit),
            openmeter: std::sync::Arc::clone(&openmeter),
            cfg: governance::GovernanceConfig::from_env()?,
        });
        automation::register_run(&governance).await?;
        agent_invocation::register(&governance).await?;
        governance::task_control::register(&governance).await?;
        // 角色 relationship 以成员事实为准对账，并度量没有有效 admin 的 Tenant（DD-82）
        role_reconcile::spawn(
            std::sync::Arc::clone(&governance),
            &opentelemetry::global::meter("platform-core"),
            role_reconcile::Config::from_env()?,
        );

        let worker_service_auth = std::sync::Arc::new(service_auth::ServiceAuth::from_env()?);
        let gateway_service_auth =
            service_auth::GatewayServiceAuth::from_env(&worker_service_auth)?
                .map(std::sync::Arc::new);
        if let Some(auth) = &gateway_service_auth {
            auth.validate_configuration()
                .await
                .map_err(|_| "Gateway service 公钥投递不可核验")?;
        }
        let agent_tool_sessions = agent_tool_session::SessionSigner::from_env(
            &worker_service_auth,
            gateway_service_auth.as_deref(),
        )?
        .map(std::sync::Arc::new);
        let service_state = service_api::ServiceState {
            pool: pool.clone(),
            auth: worker_service_auth,
            gateway_service_auth,
            agent_tool_sessions,
            secrets: std::sync::Arc::clone(&secrets),
            audit: std::sync::Arc::clone(&audit),
            catalog_tenant,
            secret_audience: std::env::var("OPENBAO_SERVICE_IDENTITY")
                .map_err(|_| "缺少 OPENBAO_SERVICE_IDENTITY")?,
            community_domain: std::env::var("BUZZ_COMMUNITY_DOMAIN")
                .map_err(|_| "缺少 BUZZ_COMMUNITY_DOMAIN")?,
            relay_transport: std::env::var("BUZZ_RELAY_TRANSPORT")
                .map_err(|_| "缺少 BUZZ_RELAY_TRANSPORT")?,
            deletion_transport: tenant_delete::DeletionTransport::from_env()?,
            openmeter: std::sync::Arc::clone(&openmeter),
            http: reqwest::Client::new(),
            temporal: std::sync::Arc::clone(&temporal),
            governance: std::sync::Arc::clone(&governance),
            agent_runtime: agent_runtime.clone(),
            capacity,
            agent_memory,
        };
        // roster 与成员事实的对账度量（07 §3）。它用 CONTROL 身份读 roster，与
        // service API 共用同一份依赖。
        roster_reconcile::spawn(
            service_state.clone(),
            &opentelemetry::global::meter("platform-core"),
            roster_reconcile::Config::from_env()?,
        );

        // 结果不明的消息发布按 event id 对账成确定结果（DD-81）
        publish_reconcile::spawn(
            service_state.clone(),
            &opentelemetry::global::meter("platform-core"),
            publish_reconcile::Config::from_env()?,
        );

        let bff_state = bff::BffState {
            memory_service: service_state.clone(),
            platform_info,
            pool: pool.clone(),
            temporal,
            governance,
            client_key_proof_window_seconds: std::env::var("BFF_CLIENT_KEY_PROOF_WINDOW_SECONDS")
                .map_err(|_| "缺少 BFF_CLIENT_KEY_PROOF_WINDOW_SECONDS")?
                .parse()
                .map_err(|_| "BFF_CLIENT_KEY_PROOF_WINDOW_SECONDS 必须是秒数")?,
            client_keys_per_principal: std::env::var("BFF_CLIENT_KEYS_PER_PRINCIPAL")
                .map_err(|_| "缺少 BFF_CLIENT_KEYS_PER_PRINCIPAL")?
                .parse()
                .map_err(|_| "BFF_CLIENT_KEYS_PER_PRINCIPAL 必须是正整数")?,
            client_key_recheck_millis: {
                let value: i64 = std::env::var("BFF_CLIENT_KEY_RECHECK_MILLIS")
                    .map_err(|_| "缺少 BFF_CLIENT_KEY_RECHECK_MILLIS")?
                    .parse()
                    .map_err(|_| "BFF_CLIENT_KEY_RECHECK_MILLIS 必须是正整数毫秒数")?;
                if !(1..=i32::MAX as i64).contains(&value) {
                    return Err("BFF_CLIENT_KEY_RECHECK_MILLIS 必须在 1..=2147483647 之间".into());
                }
                value
            },
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
                    return Err(
                        "BUZZ_RELAY_NATIVE_URL_TEMPLATE 必须形如 ws[s]://{host}[/path]".into(),
                    );
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
            relay_sessions: {
                let ws_url =
                    std::env::var("BUZZ_RELAY_WS_URL").map_err(|_| "缺少 BUZZ_RELAY_WS_URL")?;
                let buffer: usize = std::env::var("BFF_STREAM_BUFFER")
                    .map_err(|_| "缺少 BFF_STREAM_BUFFER")?
                    .parse()
                    .map_err(|_| "BFF_STREAM_BUFFER 必须是数字")?;
                let auth_timeout: u64 = std::env::var("BFF_STREAM_AUTH_TIMEOUT_SECONDS")
                    .map_err(|_| "缺少 BFF_STREAM_AUTH_TIMEOUT_SECONDS")?
                    .parse()
                    .map_err(|_| "BFF_STREAM_AUTH_TIMEOUT_SECONDS 必须是秒数")?;
                std::sync::Arc::new(collab_bridge::stream::RelaySessions::new(
                    &ws_url,
                    std::time::Duration::from_secs(auth_timeout),
                    buffer,
                ))
            },
            relay_budget: {
                let calls: usize = std::env::var("BFF_RELAY_API_BUDGET")
                    .map_err(|_| "缺少 BFF_RELAY_API_BUDGET")?
                    .parse()
                    .map_err(|_| "BFF_RELAY_API_BUDGET 必须是正整数")?;
                let window: u64 = std::env::var("BFF_RELAY_API_BUDGET_WINDOW_SECONDS")
                    .map_err(|_| "缺少 BFF_RELAY_API_BUDGET_WINDOW_SECONDS")?
                    .parse()
                    .map_err(|_| "BFF_RELAY_API_BUDGET_WINDOW_SECONDS 必须是秒数")?;
                std::sync::Arc::new(
                    collab_bridge::limits::ApiBudget::new(
                        calls,
                        std::time::Duration::from_secs(window),
                    )
                    .map_err(|e| e.to_string())?,
                )
            },
            relay_nip11: {
                let ttl: u64 = std::env::var("BFF_RELAY_NIP11_TTL_SECONDS")
                    .map_err(|_| "缺少 BFF_RELAY_NIP11_TTL_SECONDS")?
                    .parse()
                    .map_err(|_| "BFF_RELAY_NIP11_TTL_SECONDS 必须是秒数")?;
                let transport = std::env::var("BUZZ_RELAY_TRANSPORT")
                    .map_err(|_| "缺少 BUZZ_RELAY_TRANSPORT")?;
                std::sync::Arc::new(
                    collab_bridge::limits::Nip11Cache::new(
                        &transport,
                        std::time::Duration::from_secs(ttl),
                    )
                    .map_err(|e| e.to_string())?,
                )
            },
            message_max_content_bytes: {
                let max: usize = std::env::var("BFF_MESSAGE_MAX_CONTENT_BYTES")
                    .map_err(|_| "缺少 BFF_MESSAGE_MAX_CONTENT_BYTES")?
                    .parse()
                    .map_err(|_| "BFF_MESSAGE_MAX_CONTENT_BYTES 必须是字节数")?;
                if max == 0 {
                    return Err("BFF_MESSAGE_MAX_CONTENT_BYTES 必须为正".into());
                }
                max
            },
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

        // The SAME tick/batch also observes fixed Memory write IDs. BFF state
        // contributes its existing controlled Relay budget, never a new clock.
        governance_reconcile::spawn(
            service_state.clone(),
            bff_state.clone(),
            &opentelemetry::global::meter("platform-core"),
            governance_reconcile::Config::from_env()?,
            gateway_usage::Ingress::from_env(&opentelemetry::global::meter("platform-core"))?,
        );

        let bff = tokio::net::TcpListener::bind(listen).await?;
        let service = tokio::net::TcpListener::bind(service_listen).await?;
        tracing::info!(bff = %listen, service = %service_listen, "listening");

        let shutdown = || async {
            #[cfg(unix)]
            {
                let mut terminate =
                    match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                    {
                        Ok(signal) => signal,
                        Err(error) => {
                            tracing::error!(error = %error, "注册 SIGTERM 停机信号失败");
                            return;
                        }
                    };
                tokio::select! {
                    _ = tokio::signal::ctrl_c() => {},
                    _ = terminate.recv() => {},
                }
            }
            #[cfg(not(unix))]
            {
                let _ = tokio::signal::ctrl_c().await;
            }
        };
        // 任一监听退出即整体退出：只剩半边可用会让调用方看到不一致的可用性。
        let serve = async {
            tokio::try_join!(
                axum::serve(bff, bff::router(bff_state)).with_graceful_shutdown(shutdown()),
                axum::serve(service, service_api::router(service_state))
                    .with_graceful_shutdown(shutdown()),
            )
        };
        // service token 按 lease 续期。续期被确定拒绝（令牌被撤销或过期）时手里已没有
        // 能重新登录的凭据：继续服务只会让每个要 secret 的动作失败，还看不出原因。
        // 退出并说明原因，由部署重新投递引导凭据（RB-02 步骤 A/C）。
        tokio::select! {
            served = serve => { served?; }
            e = secrets.keep_alive() => {
                return Err(format!("OpenBao service token 失效，退出: {e}").into());
            }
            e = audit.keep_alive() => {
                return Err(format!("OpenBao audit 观察 token 失效，退出: {e}").into());
            }
        }
        // 退出前把缓冲中的指标送出去
        if let Err(e) = meter_provider.shutdown() {
            tracing::warn!(error = %e, "指标导出未能完成");
        }
        Ok(())
    }
    .await;

    let runtime_shutdown = match &agent_runtime {
        Some(runtime) => runtime.stop_all().await,
        None => Ok(()),
    };

    // 两个 AppRole 位于不同 namespace；即使其中一个撤销失败也必须尝试另一个。
    // connect 失败的会话没有 lease，revoke_current 对它是确定的空操作。
    let audit_revocation = audit.revoke_current().await;
    let secret_revocation = secrets.revoke_current().await;
    if audit_revocation.is_err() || secret_revocation.is_err() {
        if let Err(error) = &outcome {
            tracing::error!(error = %error, "Core 退出前已有错误");
        }
        return Err(format!(
            "OpenBao service token 撤销未确认，拒绝正常退出: audit={audit_revocation:?}, platform={secret_revocation:?}"
        )
        .into());
    }
    if runtime_shutdown.is_err() {
        return Err("Agent runtime 停机尚未确认；原 Invocation 保持 UNKNOWN".into());
    }
    outcome
}

/// Tenant 子 namespace 的 Core AppRole 按启动时投递的 app 网段绑定（DD-70）。网段随部署变化时，
/// 已有 Tenant 的角色只有在其业务流程恰好调用 `ensure_tenant` 时才会重写，其余取用全部失败且无人
/// 察觉。因此在服务前对每个未删除的 Tenant 收敛一次：幂等写入并回读。单个 Tenant 失败不阻止其他
/// Tenant 服务，它的取用继续 fail closed，并记日志与度量；下次启动或业务流程再次调用时继续收敛。
async fn converge_tenant_namespaces(
    pool: &sqlx::PgPool,
    secrets: &secret_store::SecretStore,
) -> Result<(), Box<dyn std::error::Error>> {
    let tenants: Vec<uuid::Uuid> = sqlx::query_scalar(
        "select id from identity.tenant where state not in ('DELETING','DELETED')",
    )
    .fetch_all(pool)
    .await?;
    let failed = opentelemetry::global::meter("platform-core")
        .u64_gauge("platform.secret_store.tenant_converge_failed")
        .with_description("启动时 Tenant 子 namespace 收敛失败的数量")
        .build();
    let mut failures = 0u64;
    for tenant in &tenants {
        if let Err(e) = platform_keys::ensure_tenant_namespace(pool, secrets, *tenant).await {
            failures += 1;
            tracing::error!(%tenant, error = %e, "Tenant 子 namespace 收敛失败，其密钥取用保持拒绝");
        }
    }
    failed.record(failures, &[]);
    tracing::info!(
        tenants = tenants.len(),
        failures,
        "Tenant 子 namespace 已按当前部署收敛"
    );
    Ok(())
}
