//! Buzz roster 与 Core 成员事实的对账度量（`07` §3「每个 projection 的对账结果
//! 与不一致计数」）。
//!
//! 成员投影由 Workflow 在每次建立与撤权时收敛并查证；这里补上另一半——事后
//! 仍然一致吗。Relay 与 Channel roster 只由 CONTROL 变更（`DD-80`），不一致只
//! 可能来自 Core 的缺陷、Relay 数据恢复或越过治理的写入，每一种都必须被看见。
//!
//! 只度量、不修复：roster 的变更是带查证的投影，由 Workflow 按实体版本发起；
//! 在这里直接补写或删除，就是一条没有 ActionExecution、没有审计的旁路。
//!
//! 「应在」只取已经落定的事实：binding 为 ACTIVE、且相应成员关系为 ACTIVE。
//! 仍在收敛中的钥匙（binding 或成员关系处于建立或撤权途中）两边都不计——
//! 它们在 roster 上或不在，都是那条 Workflow 的中间态，不是漂移。

use std::collections::HashSet;
use std::time::Duration;

use kailo_buzz::bridge::{IdentityClient, Scope};
use opentelemetry::metrics::{Counter, Gauge, Meter};
use opentelemetry::KeyValue;
use uuid::Uuid;

use crate::service_api::ServiceState;
use crate::tenant_lifecycle::control_client;

pub struct Config {
    pub interval: Duration,
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let k = "ROSTER_RECONCILE_INTERVAL_SECONDS";
        let n: u64 = std::env::var(k)
            .map_err(|_| format!("缺少 {k}"))?
            .parse()
            .ok()
            .filter(|n| *n > 0)
            .ok_or_else(|| format!("{k} 必须是正整数"))?;
        Ok(Self {
            interval: Duration::from_secs(n),
        })
    }
}

struct Metrics {
    drift: Gauge<u64>,
    scopes: Counter<u64>,
}

#[derive(Default)]
struct Drift {
    missing: u64,
    unexpected: u64,
}

pub fn spawn(state: ServiceState, meter: &Meter, cfg: Config) {
    let metrics = Metrics {
        drift: meter
            .u64_gauge("kailo.roster.drift")
            .with_description(
                "roster 与 Core 已落定成员事实的差：missing 为应在而不在，unexpected 为不应在而在",
            )
            .build(),
        scopes: meter
            .u64_counter("kailo.roster.reconciled")
            .with_description("逐个 roster 的对账结果")
            .build(),
    };
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(cfg.interval);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tick.tick().await;
            if let Err(e) = pass(&state, &metrics).await {
                tracing::warn!(error = %e, "roster 对账本轮未完成");
            }
        }
    });
}

async fn pass(state: &ServiceState, metrics: &Metrics) -> Result<(), String> {
    let tenants = sqlx::query_scalar!(
        "select tenant_id from projection.tenant_buzz_binding where state = 'ACTIVE'"
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut relay = Drift::default();
    let mut channel = Drift::default();
    for tenant in tenants {
        let Ok((control, _)) = control_client(state, tenant).await else {
            // CONTROL 身份不可读：该 Tenant 的 roster 这一轮看不到，不猜
            metrics
                .scopes
                .add(1, &[KeyValue::new("outcome", "CONTROL_UNREADABLE")]);
            continue;
        };
        match compare_relay(state, &control, tenant).await {
            Ok(d) => {
                record(metrics, "relay", &d);
                relay.missing += d.missing;
                relay.unexpected += d.unexpected;
                if d.missing + d.unexpected > 0 {
                    tracing::warn!(%tenant, missing = d.missing, unexpected = d.unexpected,
                        "relay roster 与成员事实不一致");
                }
            }
            Err(e) => {
                tracing::info!(%tenant, error = %e, "relay roster 读取失败");
                metrics
                    .scopes
                    .add(1, &[KeyValue::new("outcome", "ROSTER_UNREADABLE")]);
            }
        }
        let workspaces = sqlx::query!(
            "select b.workspace_id, b.channel_id from projection.workspace_buzz_binding b
             join identity.workspace w on w.id = b.workspace_id
             where w.tenant_id = $1 and b.state = 'ACTIVE'",
            tenant
        )
        .fetch_all(&state.pool)
        .await
        .map_err(|e| e.to_string())?;
        for ws in workspaces {
            match compare_channel(state, &control, tenant, ws.workspace_id, ws.channel_id).await {
                Ok(d) => {
                    record(metrics, "channel", &d);
                    channel.missing += d.missing;
                    channel.unexpected += d.unexpected;
                    if d.missing + d.unexpected > 0 {
                        tracing::warn!(workspace = %ws.workspace_id, missing = d.missing,
                            unexpected = d.unexpected, "Channel roster 与成员事实不一致");
                    }
                }
                Err(e) => {
                    tracing::info!(workspace = %ws.workspace_id, error = %e, "Channel roster 读取失败");
                    metrics
                        .scopes
                        .add(1, &[KeyValue::new("outcome", "ROSTER_UNREADABLE")]);
                }
            }
        }
    }
    for (scope, d) in [("relay", relay), ("channel", channel)] {
        metrics.drift.record(
            d.missing,
            &[
                KeyValue::new("scope", scope),
                KeyValue::new("direction", "missing"),
            ],
        );
        metrics.drift.record(
            d.unexpected,
            &[
                KeyValue::new("scope", scope),
                KeyValue::new("direction", "unexpected"),
            ],
        );
    }
    Ok(())
}

fn record(metrics: &Metrics, scope: &'static str, d: &Drift) {
    let outcome = if d.missing + d.unexpected == 0 {
        "CONSISTENT"
    } else {
        "DRIFTED"
    };
    metrics.scopes.add(
        1,
        &[
            KeyValue::new("scope", scope),
            KeyValue::new("outcome", outcome),
        ],
    );
}

fn diff(roster: &HashSet<String>, settled: &HashSet<String>, unsettled: &HashSet<String>) -> Drift {
    Drift {
        missing: settled
            .iter()
            .filter(|k| !roster.contains(*k) && !unsettled.contains(*k))
            .count() as u64,
        unexpected: roster
            .iter()
            .filter(|k| !settled.contains(*k) && !unsettled.contains(*k))
            .count() as u64,
    }
}

async fn compare_relay(
    state: &ServiceState,
    control: &IdentityClient,
    tenant: Uuid,
) -> Result<Drift, String> {
    // 已落定：成员关系 ACTIVE 且 binding ACTIVE；CONTROL 是 Community owner，恒在
    let mut settled: HashSet<String> = sqlx::query_scalar!(
        "select b.pubkey from identity.buzz_identity_binding b
         join identity.tenant_membership m
           on m.tenant_principal_id = b.principal_id and m.tenant_id = b.tenant_id
         where b.tenant_id = $1 and b.kind <> 'CONTROL'
           and b.state = 'ACTIVE' and m.state = 'ACTIVE'",
        tenant
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| e.to_string())?
    .into_iter()
    .collect();
    settled.insert(control.pubkey_hex());
    let unsettled: HashSet<String> = sqlx::query_scalar!(
        "select b.pubkey from identity.buzz_identity_binding b
         left join identity.tenant_membership m
           on m.tenant_principal_id = b.principal_id and m.tenant_id = b.tenant_id
         where b.tenant_id = $1 and b.kind <> 'CONTROL'
           and (b.state in ('PENDING_SECRET', 'RECONCILING', 'REVOKING')
                or m.state in ('INVITED', 'PROVISIONING', 'REVOKING'))",
        tenant
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| e.to_string())?
    .into_iter()
    .collect();
    let roster: HashSet<String> = control
        .roster(&state.http, Scope::Relay)
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|e| e.pubkey)
        .collect();
    Ok(diff(&roster, &settled, &unsettled))
}

async fn compare_channel(
    state: &ServiceState,
    control: &IdentityClient,
    tenant: Uuid,
    workspace: Uuid,
    channel: Uuid,
) -> Result<Drift, String> {
    let mut settled: HashSet<String> = sqlx::query_scalar!(
        "select b.pubkey from identity.buzz_identity_binding b
         join identity.workspace_membership wm on wm.tenant_principal_id = b.principal_id
         join identity.tenant_membership m
           on m.tenant_principal_id = b.principal_id and m.tenant_id = b.tenant_id
         where b.tenant_id = $1 and wm.workspace_id = $2 and b.kind <> 'CONTROL'
           and b.state = 'ACTIVE' and wm.state = 'ACTIVE' and m.state = 'ACTIVE'",
        tenant,
        workspace
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| e.to_string())?
    .into_iter()
    .collect();
    // CONTROL 建立了该 Channel，是它的 owner
    settled.insert(control.pubkey_hex());
    let unsettled: HashSet<String> = sqlx::query_scalar!(
        "select b.pubkey from identity.buzz_identity_binding b
         left join identity.workspace_membership wm
           on wm.tenant_principal_id = b.principal_id and wm.workspace_id = $2
         left join identity.tenant_membership m
           on m.tenant_principal_id = b.principal_id and m.tenant_id = b.tenant_id
         where b.tenant_id = $1 and b.kind <> 'CONTROL'
           and (b.state in ('PENDING_SECRET', 'RECONCILING', 'REVOKING')
                or wm.state in ('PROVISIONING', 'REVOKING')
                or m.state in ('INVITED', 'PROVISIONING', 'REVOKING'))",
        tenant,
        workspace
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| e.to_string())?
    .into_iter()
    .collect();
    let channel = channel.to_string();
    let roster: HashSet<String> = control
        .roster(&state.http, Scope::Channel(&channel))
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|e| e.pubkey)
        .collect();
    Ok(diff(&roster, &settled, &unsettled))
}
