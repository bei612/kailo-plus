//! BFF 代签发布的结果对账（`DD-81`）。
//!
//! 每次发布先落 DISPATCH 审计（带已签好的 event id）再发送；Relay 明确接受或
//! 拒绝时写 OUTCOME。结果不明、或结果写入失败时只剩 DISPATCH——这里按 event id
//! 去 Relay 查，把它收敛成确定的结果并以 RECONCILIATION 追加：
//!
//! - Relay 存着这条事件：已送达；
//! - 查不到，且签名时间已超出 Relay 的时间漂移窗口：这条事件再也不可能被接受
//!   （`SF-BUZ-40`），确定未送达；
//! - 查不到而仍在窗口内：继续等，不猜。
//!
//! 不重发：DISPATCH 之后用户可能已经重新发了一条，自动重发会造出重复消息
//! （`DD-48`「无 native 结论不自动重放」）。
//!
//! 只看 Tenant 仍在的发布。产品里 Tenant 不会被物理删除（一期不注册 Tenant
//! delete），被删的只有核验夹具；它们的 CONTROL 身份已随之删除，查询无从
//! 发起，算进待对账只会让度量永远不归零。

use crate::audit::Evidence;
use std::time::Duration;

use opentelemetry::metrics::{Counter, Gauge, Meter};
use opentelemetry::KeyValue;
use uuid::Uuid;

use crate::audit::{append, AuditEntry};
use crate::service_api::ServiceState;
use crate::tenant_lifecycle::{control_client, ProjectionDirection};
use crate::web_transport::{
    CONVERSATION_HIDE_ACTION, CONVERSATION_PUBLISH_ACTION, CONVERSATION_REOPEN_ACTION,
    PUBLISH_ACTION,
};

pub struct Config {
    pub interval: Duration,
    /// DISPATCH 之后至少等这么久仍查不到，才判定未送达。必须不小于 Relay 的
    /// 时间漂移窗口（`07` §1）
    pub settle: Duration,
    pub batch: i64,
    /// 幂等记录在其操作有结论之后再保留这么久：够用户在界面上重试，也不让它
    /// 无限增长
    pub idempotency_retention: Duration,
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let get = |k: &str| -> Result<u64, String> {
            std::env::var(k)
                .map_err(|_| format!("缺少 {k}"))?
                .parse::<u64>()
                .ok()
                .filter(|n| *n > 0)
                .ok_or_else(|| format!("{k} 必须是正整数"))
        };
        Ok(Self {
            interval: Duration::from_secs(get("PUBLISH_RECONCILE_INTERVAL_SECONDS")?),
            settle: Duration::from_secs(get("PUBLISH_RESULT_SETTLE_SECONDS")?),
            batch: i64::try_from(get("PUBLISH_RECONCILE_BATCH")?)
                .map_err(|_| "PUBLISH_RECONCILE_BATCH 超出范围".to_owned())?,
            idempotency_retention: Duration::from_secs(get(
                "PUBLISH_IDEMPOTENCY_RETENTION_SECONDS",
            )?),
        })
    }
}

struct Metrics {
    unsettled: Gauge<u64>,
    oldest_age: Gauge<u64>,
    reconciled: Counter<u64>,
}

pub fn spawn(state: ServiceState, meter: &Meter, cfg: Config) {
    let metrics = Metrics {
        unsettled: meter
            .u64_gauge("platform.publish.unsettled")
            .with_description("已 DISPATCH 而没有确定结果的消息发布数")
            .build(),
        oldest_age: meter
            .u64_gauge("platform.publish.unsettled_oldest_age")
            .with_unit("s")
            .with_description("最久一条未确定结果的发布的年龄")
            .build(),
        reconciled: meter
            .u64_counter("platform.publish.reconciled")
            .with_description("对未确定结果的发布的一次对账观察")
            .build(),
    };
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(cfg.interval);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        // Scheduling cursor only; audit remains the publication authority. An
        // unobservable replaceable profile must not starve later intents.
        let mut profile_cursor = None;
        loop {
            tick.tick().await;
            if let Err(e) =
                crate::web_profile::reconcile(&state, cfg.batch, &mut profile_cursor).await
            {
                tracing::warn!(error = %e, "Profile publication reconciliation incomplete");
            }
            if let Err(e) = pass(&state, &metrics, &cfg).await {
                tracing::warn!(error = %e, "发布结果对账本轮未完成");
            }
        }
    });
}

struct Pending {
    operation_id: Uuid,
    tenant_id: Uuid,
    workspace_id: Option<Uuid>,
    human_identity_id: Option<Uuid>,
    initiator_principal_id: Option<Uuid>,
    actor_principal_id: Option<Uuid>,
    target_id: Option<Uuid>,
    action_key: String,
    target_type: Option<String>,
    evidence_refs: Vec<Evidence>,
    event_id: String,
    settled_window_passed: bool,
}

#[derive(sqlx::FromRow)]
struct PendingRow {
    operation_id: Uuid,
    tenant_id: Uuid,
    workspace_id: Option<Uuid>,
    human_identity_id: Option<Uuid>,
    initiator_principal_id: Option<Uuid>,
    actor_principal_id: Option<Uuid>,
    target_id: Option<Uuid>,
    action_key: String,
    target_type: Option<String>,
    evidence_refs: serde_json::Value,
    event_id: Option<String>,
    settled: bool,
}

async fn pass(state: &ServiceState, metrics: &Metrics, cfg: &Config) -> Result<(), String> {
    let min_age = i64::try_from(cfg.interval.as_secs()).unwrap_or(i64::MAX);
    let settle = i64::try_from(cfg.settle.as_secs()).unwrap_or(i64::MAX);
    let rows = sqlx::query_as::<_, PendingRow>(
        r#"select d.operation_id, d.tenant_id, d.workspace_id,
                  d.human_identity_id, d.initiator_principal_id, d.actor_principal_id,
                  d.target_id, d.action_key, d.target_type, d.evidence_refs,
                  (select e->>'value' from jsonb_array_elements(d.evidence_refs) e
                    where e->>'kind' = 'BUZZ_EVENT_ID') as event_id,
                  (d.occurred_at < now() - make_interval(secs => $3::bigint)) as settled
           from audit.audit_event d
           join identity.tenant t on t.id = d.tenant_id
           where d.event_type = 'DISPATCH' and d.action_key = any($1)
             and d.occurred_at < now() - make_interval(secs => $4::bigint)
             and not exists (
                 select 1 from audit.audit_event o
                 where o.operation_id = d.operation_id
                   and o.event_type in ('OUTCOME', 'RECONCILIATION'))
           order by d.occurred_at
           limit $2"#,
    )
    .bind(
        [
            PUBLISH_ACTION,
            crate::pulse::PUBLISH_ACTION,
            crate::projects::PUBLISH_ACTION,
            CONVERSATION_PUBLISH_ACTION,
            CONVERSATION_HIDE_ACTION,
            CONVERSATION_REOPEN_ACTION,
        ]
        .as_slice(),
    )
    .bind(cfg.batch)
    .bind(settle)
    .bind(min_age)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    for r in rows {
        let Some(event_id) = r.event_id else {
            // DISPATCH 没有 event id 就无从查证。写入路径保证它总在，走到这里
            // 说明记录被别的路径写坏了：计数，不猜
            metrics
                .reconciled
                .add(1, &[KeyValue::new("outcome", "EVIDENCE_MISSING")]);
            continue;
        };
        // DISPATCH 的证据原样带到结果审计；任何一条不可识别就同样当作记录被写坏
        // DISPATCH 的证据带到结果审计。不可识别的存量条目留在 DISPATCH 原行里，
        // 不带过去也不阻止结算——否则这一行永远等不到结果，还会占住后续批次
        let items = r
            .evidence_refs
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or_default();
        let evidence_refs: Vec<Evidence> = items.iter().filter_map(Evidence::parse).collect();
        if evidence_refs.len() != items.len() {
            metrics
                .reconciled
                .add(1, &[KeyValue::new("outcome", "EVIDENCE_PARTIAL")]);
        }
        let p = Pending {
            operation_id: r.operation_id,
            tenant_id: r.tenant_id,
            workspace_id: r.workspace_id,
            human_identity_id: r.human_identity_id,
            initiator_principal_id: r.initiator_principal_id,
            actor_principal_id: r.actor_principal_id,
            target_id: r.target_id,
            action_key: r.action_key,
            target_type: r.target_type,
            evidence_refs,
            event_id,
            settled_window_passed: r.settled,
        };
        let outcome = settle_one(state, &p).await;
        metrics
            .reconciled
            .add(1, &[KeyValue::new("outcome", outcome)]);
    }

    let (n, age): (i64, i64) = sqlx::query_as(
        r#"select count(*),
                  coalesce(extract(epoch from now() - min(d.occurred_at))::bigint, 0)
           from audit.audit_event d
           join identity.tenant t on t.id = d.tenant_id
           where d.event_type = 'DISPATCH' and d.action_key = any($1)
             and not exists (
                 select 1 from audit.audit_event o
                 where o.operation_id = d.operation_id
                   and o.event_type in ('OUTCOME', 'RECONCILIATION'))"#,
    )
    .bind(
        [
            PUBLISH_ACTION,
            crate::pulse::PUBLISH_ACTION,
            crate::projects::PUBLISH_ACTION,
            CONVERSATION_PUBLISH_ACTION,
            CONVERSATION_HIDE_ACTION,
            CONVERSATION_REOPEN_ACTION,
        ]
        .as_slice(),
    )
    .fetch_one(&state.pool)
    .await
    .map_err(|e| e.to_string())?;
    metrics.unsettled.record(n.max(0) as u64, &[]);
    metrics.oldest_age.record(age.max(0) as u64, &[]);

    // 已有结论且超过保留期的幂等记录不再有用：同一个键再来，按新的发送意图处理
    let retention = i64::try_from(cfg.idempotency_retention.as_secs()).unwrap_or(i64::MAX);
    sqlx::query!(
        "delete from admission.publish_attempt a
         where a.created_at < now() - make_interval(secs => $1::bigint)
           and exists (select 1 from audit.audit_event r
                       where r.operation_id = a.operation_id
                         and r.event_type in ('OUTCOME', 'RECONCILIATION'))",
        retention
    )
    .execute(&state.pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

async fn settle_one(state: &ServiceState, p: &Pending) -> &'static str {
    let result_code = match observe_delivery(state, p).await {
        Ok(true) => "ACCEPTED",
        Ok(false) if p.settled_window_passed => "NOT_DELIVERED",
        Ok(false) => return "PENDING",
        Err(reason) => return reason,
    };
    let entry = AuditEntry {
        event_key: format!("message.publish:{}:reconciled", p.event_id),
        tenant_id: Some(p.tenant_id),
        workspace_id: p.workspace_id,
        operation_id: p.operation_id,
        event_type: "RECONCILIATION",
        human_identity_id: p.human_identity_id,
        initiator_principal_id: p.initiator_principal_id,
        actor_principal_id: p.actor_principal_id,
        action_key: &p.action_key,
        action_version: 1,
        component_type_key: "buzz",
        target_type: p.target_type.as_deref(),
        target_id: p.target_id,
        parameter_hash: "NONE",
        decision: "ALLOW",
        result_code,
        result_exposure: "NONE",
        evidence_refs: p.evidence_refs.clone(),
        correlation_id: p.operation_id,
    };
    let written = async {
        let mut tx = state.pool.begin().await?;
        append(&mut tx, entry).await?;
        tx.commit().await
    }
    .await;
    match written {
        Ok(()) => result_code,
        Err(e) => {
            tracing::warn!(error = %e, "对账结果审计未写入");
            "WRITE_FAILED"
        }
    }
}

async fn observe_delivery(state: &ServiceState, p: &Pending) -> Result<bool, &'static str> {
    if matches!(
        p.action_key.as_str(),
        crate::pulse::PUBLISH_ACTION | crate::projects::PUBLISH_ACTION
    ) {
        if p.target_type.as_deref() != Some("TENANT")
            || p.target_id != Some(p.tenant_id)
            || p.workspace_id.is_some()
        {
            return Err("EVIDENCE_MISSING");
        }
        let actor = p.actor_principal_id.ok_or("EVIDENCE_MISSING")?;
        let before = crate::pulse::admit_actor(state, p.tenant_id, actor)
            .await
            .map_err(|_| "ACTOR_UNREADABLE")?;
        let keys = crate::web_transport::server_actor_keys(
            &state.pool,
            &state.secrets,
            p.tenant_id,
            actor,
        )
        .await
        .map_err(|_| "ACTOR_UNREADABLE")?;
        let client = collab_bridge::bridge::IdentityClient::new(
            collab_bridge::bridge::Custody::Server,
            &keys.secret_key().to_secret_hex(),
            &state.relay_transport,
            &before.community_host,
        )
        .map_err(|_| "ACTOR_UNREADABLE")?;
        let exists = client
            .event_exists(&state.http, &p.event_id)
            .await
            .map_err(|_| "QUERY_FAILED")?;
        let after = crate::pulse::admit_actor(state, p.tenant_id, actor)
            .await
            .map_err(|_| "ACTOR_UNREADABLE")?;
        let current = crate::web_transport::server_actor_keys(
            &state.pool,
            &state.secrets,
            p.tenant_id,
            actor,
        )
        .await
        .map_err(|_| "ACTOR_UNREADABLE")?;
        if before != after || keys.public_key() != current.public_key() {
            return Err("ACTOR_UNREADABLE");
        }
        // Parameterized replaceable announcements can disappear after a newer
        // head or an accepted coordinate tombstone. An absent event is not
        // proof the original mutation was never delivered, even after expiry.
        if p.action_key == crate::projects::PUBLISH_ACTION && !exists {
            return Err("PROJECT_EVENT_UNOBSERVABLE");
        }
        return Ok(exists);
    }
    if p.action_key == PUBLISH_ACTION {
        if p.target_type.as_deref() != Some("CHANNEL")
            || p.workspace_id.is_none()
            || p.target_id != p.workspace_id
        {
            return Err("EVIDENCE_MISSING");
        }
        let (control, _) = control_client(state, p.tenant_id, ProjectionDirection::Establish)
            .await
            .map_err(|_| "CONTROL_UNREADABLE")?;
        return control
            .event_exists(&state.http, &p.event_id)
            .await
            .map_err(|_| "QUERY_FAILED");
    }
    if ![
        CONVERSATION_PUBLISH_ACTION,
        CONVERSATION_HIDE_ACTION,
        CONVERSATION_REOPEN_ACTION,
    ]
    .contains(&p.action_key.as_str())
        || p.target_type.as_deref() != Some("CONVERSATION")
        || p.workspace_id.is_some()
    {
        return Err("EVIDENCE_MISSING");
    }
    let (Some(conversation), Some(actor)) = (p.target_id, p.actor_principal_id) else {
        return Err("EVIDENCE_MISSING");
    };
    // CONTROL never joins a private conversation. Query only with its original
    // human actor's currently authorized SERVER identity; denial is not absence.
    let before =
        crate::conversations::admit_reconciliation(state, p.tenant_id, actor, conversation)
            .await
            .map_err(|_| "PARTICIPANT_UNREADABLE")?;
    let keys =
        crate::web_transport::server_actor_keys(&state.pool, &state.secrets, p.tenant_id, actor)
            .await
            .map_err(|_| "PARTICIPANT_UNREADABLE")?;
    let client = collab_bridge::bridge::IdentityClient::new(
        collab_bridge::bridge::Custody::Server,
        &keys.secret_key().to_secret_hex(),
        &state.relay_transport,
        &before.community_host,
    )
    .map_err(|_| "PARTICIPANT_UNREADABLE")?;
    let exists = client
        .event_exists(&state.http, &p.event_id)
        .await
        .map_err(|_| "QUERY_FAILED")?;
    let after = crate::conversations::admit_reconciliation(state, p.tenant_id, actor, conversation)
        .await
        .map_err(|_| "PARTICIPANT_UNREADABLE")?;
    let current_keys =
        crate::web_transport::server_actor_keys(&state.pool, &state.secrets, p.tenant_id, actor)
            .await
            .map_err(|_| "PARTICIPANT_UNREADABLE")?;
    if before.binding_version != after.binding_version
        || before.tenant_binding_version != after.tenant_binding_version
        || before.channel_id != after.channel_id
        || before.community_host != after.community_host
        || keys.public_key() != current_keys.public_key()
    {
        return Err("PARTICIPANT_UNREADABLE");
    }
    Ok(exists)
}
