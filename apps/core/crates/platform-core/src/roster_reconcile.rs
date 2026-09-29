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

use collab_bridge::bridge::{IdentityClient, Scope};
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
            .u64_gauge("platform.roster.drift")
            .with_description(
                "roster 与 Core 已落定成员事实的差：missing 为应在而不在，unexpected 为不应在而在",
            )
            .build(),
        scopes: meter
            .u64_counter("platform.roster.reconciled")
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
    // 已暂停的 Tenant 其 Community 已归档、host 不再解析（DD-96、SF-BUZ-43）：roster
    // 读不到是设计结果，不是读取失败；它们的 roster 在恢复时按成员事实收敛
    let tenants: Vec<Uuid> = sqlx::query_scalar(
        "select b.tenant_id from projection.tenant_buzz_binding b
         join identity.tenant t on t.id = b.tenant_id
         where b.state = 'ACTIVE' and t.state <> 'SUSPENDED'",
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
        // 暂停中与已暂停 Workspace 的 Channel 期望只剩 CONTROL（DD-97）；其余按成员事实
        let workspaces: Vec<(Uuid, Uuid, String)> = sqlx::query_as(
            "select b.workspace_id, b.channel_id, w.state from projection.workspace_buzz_binding b
             join identity.workspace w on w.id = b.workspace_id
             where w.tenant_id = $1 and b.state = 'ACTIVE'",
        )
        .bind(tenant)
        .fetch_all(&state.pool)
        .await
        .map_err(|e| e.to_string())?;
        for (workspace_id, channel_id, ws_state) in workspaces {
            let suspended = matches!(ws_state.as_str(), "SUSPENDING" | "SUSPENDED");
            match compare_channel(state, &control, tenant, workspace_id, channel_id, suspended)
                .await
            {
                Ok(d) => {
                    record(metrics, "channel", &d);
                    channel.missing += d.missing;
                    channel.unexpected += d.unexpected;
                    if d.missing + d.unexpected > 0 {
                        tracing::warn!(workspace = %workspace_id, missing = d.missing,
                            unexpected = d.unexpected, "Channel roster 与成员事实不一致");
                    }
                }
                Err(e) => {
                    tracing::info!(workspace = %workspace_id, error = %e, "Channel roster 读取失败");
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

/// relay roster「应在」的集合：CONTROL（Community owner，恒在），加上该 Tenant 全部
/// ACTIVE TenantMembership 对应 Principal 的全部 ACTIVE Buzz 身份。对账度量与 Tenant
/// 恢复时的 relay roster 收敛（DD-96(4)）共用这一处。
pub(crate) async fn settled_relay_roster(
    pool: &sqlx::PgPool,
    control_pubkey: String,
    tenant: Uuid,
) -> Result<HashSet<String>, sqlx::Error> {
    // 已落定：成员关系 ACTIVE 且 binding ACTIVE；CONTROL 是 Community owner，恒在
    let mut settled: HashSet<String> = sqlx::query_scalar!(
        "select b.pubkey from identity.buzz_identity_binding b
         join identity.tenant_membership m
           on m.tenant_principal_id = b.principal_id and m.tenant_id = b.tenant_id
         where b.tenant_id = $1 and b.kind <> 'CONTROL'
           and b.state = 'ACTIVE' and m.state = 'ACTIVE'",
        tenant
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .collect();
    settled.insert(control_pubkey);
    Ok(settled)
}

/// relay 上仍在收敛中的钥匙：binding 或 TenantMembership 处于建立或撤权途中。
pub(crate) async fn unsettled_relay_roster(
    pool: &sqlx::PgPool,
    tenant: Uuid,
) -> Result<HashSet<String>, sqlx::Error> {
    Ok(sqlx::query_scalar!(
        "select b.pubkey from identity.buzz_identity_binding b
         left join identity.tenant_membership m
           on m.tenant_principal_id = b.principal_id and m.tenant_id = b.tenant_id
         where b.tenant_id = $1 and b.kind <> 'CONTROL'
           and (b.state in ('PENDING_SECRET', 'RECONCILING', 'REVOKING')
                or m.state in ('INVITED', 'PROVISIONING', 'REVOKING'))",
        tenant
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .collect())
}

async fn compare_relay(
    state: &ServiceState,
    control: &IdentityClient,
    tenant: Uuid,
) -> Result<Drift, String> {
    let settled = settled_relay_roster(&state.pool, control.pubkey_hex(), tenant)
        .await
        .map_err(|e| e.to_string())?;
    let unsettled = unsettled_relay_roster(&state.pool, tenant)
        .await
        .map_err(|e| e.to_string())?;
    let roster: HashSet<String> = control
        .roster(&state.http, Scope::Relay)
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|e| e.pubkey)
        .collect();
    Ok(diff(&roster, &settled, &unsettled))
}

/// 一个 Workspace 的 Channel roster「应在」的集合：CONTROL（Channel 的建立者与
/// owner），加上该 Workspace 全部 ACTIVE WorkspaceMembership 对应 Principal 的全部
/// ACTIVE Buzz 身份（其 TenantMembership 也须 ACTIVE）。对账度量与恢复时的 roster
/// 重建（DD-97）共用这一处，两边不会各自理解「应在」。
pub(crate) async fn settled_channel_roster(
    pool: &sqlx::PgPool,
    control_pubkey: String,
    tenant: Uuid,
    workspace: Uuid,
) -> Result<HashSet<String>, sqlx::Error> {
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
    .fetch_all(pool)
    .await?
    .into_iter()
    .collect();
    settled.insert(control_pubkey);
    Ok(settled)
}

/// 仍在收敛中的钥匙：binding 或相应成员关系处于建立或撤权途中。它们在 roster 上
/// 或不在都是那条 Workflow 的中间态，度量与恢复重建都不替它们下结论。
pub(crate) async fn unsettled_channel_roster(
    pool: &sqlx::PgPool,
    tenant: Uuid,
    workspace: Uuid,
) -> Result<HashSet<String>, sqlx::Error> {
    Ok(sqlx::query_scalar!(
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
    .fetch_all(pool)
    .await?
    .into_iter()
    .collect())
}

/// `suspended` 为真（Workspace `SUSPENDING`/`SUSPENDED`）时，期望集合只有 CONTROL：
/// 暂停按设计把 roster 清空（DD-97），此时任何其他成员都是不应在。
async fn compare_channel(
    state: &ServiceState,
    control: &IdentityClient,
    tenant: Uuid,
    workspace: Uuid,
    channel: Uuid,
    suspended: bool,
) -> Result<Drift, String> {
    let (settled, unsettled) = if suspended {
        (HashSet::from([control.pubkey_hex()]), HashSet::new())
    } else {
        (
            settled_channel_roster(&state.pool, control.pubkey_hex(), tenant, workspace)
                .await
                .map_err(|e| e.to_string())?,
            unsettled_channel_roster(&state.pool, tenant, workspace)
                .await
                .map_err(|e| e.to_string())?,
        )
    };
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
