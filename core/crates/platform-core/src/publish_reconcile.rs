//! BFF 代签发布的结果对账（`DD-81`）。
//!
//! 每次发布先落 DISPATCH 审计（带已签好的 event id）再发送；Relay 明确接受或
//! 拒绝时写 OUTCOME。结果不明、或结果写入失败时只剩 DISPATCH——这里按 event id
//! 去 Relay 查，把它收敛成确定的结果并以 RECONCILIATION 追加：
//!
//! - Relay 存着这条事件：已送达；
//! - 普通事件查询为空：仍未知，过窗也不证明从未送达。软删除会隐藏
//!   原事件及其删除事件，早先通过时间检查的 writer 也可能尚未提交。
//!   权威缺失接缝未闭合前，不据此允许同一意图新签；
//! - 依赖不可读或证据不足：继续等，不猜。
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
    owned_publication_installation, publication_binding, MessageTarget, PublicationScope,
    CONVERSATION_HIDE_ACTION, CONVERSATION_PUBLISH_ACTION, CONVERSATION_REOPEN_ACTION,
    FILTERED_PUBLICATION_ACTIONS, PUBLISH_ACTION, TOPIC_ACTION,
};

pub struct Config {
    pub interval: Duration,
    /// DISPATCH 之后的诊断结算窗，必须不小于 Relay 的时间漂移窗口（`07` §1）。
    /// 普通查询空不据此判定未送达；原生 writer 查证另需原签名时间与范围事实。
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
        let mut agent_profile_cursor = None;
        // Same scheduling-only cursor for message publications: a DISPATCH that
        // can never settle (missing evidence, unobservable replaceable event)
        // stays unsettled and counted, but must not starve later intents.
        let mut publish_cursor = None;
        loop {
            tick.tick().await;
            if let Err(e) =
                crate::web_profile::reconcile(&state, cfg.batch, &mut profile_cursor).await
            {
                tracing::warn!(error = %e, "Profile publication reconciliation incomplete");
            }
            // DD-117: Agent kind:0 publications settle by event ID within the same
            // Relay drift window; missing/stale Agent profiles are (re)published.
            if let Err(e) = crate::agent_profile::reconcile(
                &state,
                cfg.batch,
                cfg.settle,
                &mut agent_profile_cursor,
            )
            .await
            {
                tracing::warn!(error = %e, "Agent profile projection reconciliation incomplete");
            }
            // DD-125(4): CONTROL Canvas events settle by event ID within the same window.
            let canvas = crate::workspace_canvas::reconcile(&state, cfg.batch, cfg.settle);
            if let Err(e) = canvas.await {
                tracing::warn!(error = %e, "Canvas publication reconciliation incomplete");
            }
            // DD-125(5): expired link-preview snapshots leave the short-term store.
            if let Err(e) = crate::link_preview::sweep(&state.pool, cfg.batch).await {
                tracing::warn!(error = %e, "Link-preview snapshot retention incomplete");
            }
            // DD-138(4): component notifications are kept 90 days (07 §4.8.3).
            if let Err(e) = crate::component_notification::sweep(&state.pool, cfg.batch).await {
                tracing::warn!(error = %e, "Component notification retention incomplete");
            }
            if let Err(e) = pass(&state, &metrics, &cfg, &mut publish_cursor).await {
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
    occurred_at: chrono::DateTime<chrono::Utc>,
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

// Shared by the production scan, metrics, retention and isolated SQL regressions.
const PENDING_PUBLICATIONS_SQL: &str = r#"select d.operation_id, d.occurred_at, d.tenant_id, d.workspace_id,
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
                   and o.event_type in ('OUTCOME', 'RECONCILIATION')
                   and not (o.event_type='RECONCILIATION' and o.result_code='NOT_DELIVERED'
                            and o.action_key=any($7)))
             and ($5::timestamptz is null or (d.occurred_at, d.operation_id) > ($5, $6))
           order by d.occurred_at, d.operation_id
           limit $2"#;

const UNSETTLED_PUBLICATIONS_SQL: &str = r#"select count(*),
                  coalesce(extract(epoch from now() - min(d.occurred_at))::bigint, 0)
           from audit.audit_event d
           join identity.tenant t on t.id = d.tenant_id
           where d.event_type = 'DISPATCH' and d.action_key = any($1)
             and not exists (
                 select 1 from audit.audit_event o
                 where o.operation_id = d.operation_id
                   and o.event_type in ('OUTCOME', 'RECONCILIATION')
                   and not (o.event_type='RECONCILIATION' and o.result_code='NOT_DELIVERED'
                            and o.action_key=any($2)))"#;

const REAP_PUBLICATIONS_SQL: &str = "delete from admission.publish_attempt a
         where a.created_at < now() - make_interval(secs => $1::bigint)
           and (select max(r.occurred_at) from audit.audit_event r
                       where r.operation_id = a.operation_id
                         and r.event_type in ('OUTCOME', 'RECONCILIATION')
                         and not (r.event_type='RECONCILIATION' and r.result_code='NOT_DELIVERED'
                                  and r.action_key=any($2)))
               < now() - make_interval(secs => $1::bigint)";

async fn pass(
    state: &ServiceState,
    metrics: &Metrics,
    cfg: &Config,
    cursor: &mut Option<(chrono::DateTime<chrono::Utc>, Uuid)>,
) -> Result<(), String> {
    let min_age = i64::try_from(cfg.interval.as_secs()).unwrap_or(i64::MAX);
    let settle = i64::try_from(cfg.settle.as_secs()).unwrap_or(i64::MAX);
    let rows = sqlx::query_as::<_, PendingRow>(PENDING_PUBLICATIONS_SQL)
        .bind(
            [
                PUBLISH_ACTION,
                TOPIC_ACTION,
                crate::pulse::PUBLISH_ACTION,
                crate::projects::PUBLISH_ACTION,
                crate::reminders::PUBLISH_ACTION,
                CONVERSATION_PUBLISH_ACTION,
                CONVERSATION_HIDE_ACTION,
                CONVERSATION_REOPEN_ACTION,
            ]
            .as_slice(),
        )
        .bind(cfg.batch)
        .bind(settle)
        .bind(min_age)
        .bind(cursor.map(|c| c.0))
        .bind(cursor.map(|c| c.1))
        .bind(FILTERED_PUBLICATION_ACTIONS.as_slice())
        .fetch_all(&state.pool)
        .await
        .map_err(|e| e.to_string())?;

    if rows.is_empty() {
        *cursor = None;
    }
    for r in rows {
        *cursor = Some((r.occurred_at, r.operation_id));
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

    let (n, age): (i64, i64) = sqlx::query_as(UNSETTLED_PUBLICATIONS_SQL)
        .bind(
            [
                PUBLISH_ACTION,
                TOPIC_ACTION,
                crate::pulse::PUBLISH_ACTION,
                crate::projects::PUBLISH_ACTION,
                crate::reminders::PUBLISH_ACTION,
                CONVERSATION_PUBLISH_ACTION,
                CONVERSATION_HIDE_ACTION,
                CONVERSATION_REOPEN_ACTION,
            ]
            .as_slice(),
        )
        .bind(FILTERED_PUBLICATION_ACTIONS.as_slice())
        .fetch_one(&state.pool)
        .await
        .map_err(|e| e.to_string())?;
    metrics.unsettled.record(n.max(0) as u64, &[]);
    metrics.oldest_age.record(age.max(0) as u64, &[]);

    // Only authoritative conclusions release the frozen intent. Historical
    // query-only NOT_DELIVERED remains pending, including after retention.
    let retention = i64::try_from(cfg.idempotency_retention.as_secs()).unwrap_or(i64::MAX);
    sqlx::query(REAP_PUBLICATIONS_SQL)
        .bind(retention)
        .bind(FILTERED_PUBLICATION_ACTIONS.as_slice())
        .execute(&state.pool)
        .await
        .map_err(|e| e.to_string())?;
    // DD-118 branch push intents keep the same retention. Their reconciliation
    // happens on the retry itself (the ref Relay advertises), never here.
    sqlx::query(
        "delete from admission.git_push_attempt a
         where a.created_at < now() - make_interval(secs => $1::bigint)
           and exists (select 1 from audit.audit_event r
                       where r.operation_id = a.operation_id
                         and r.event_type in ('OUTCOME', 'RECONCILIATION'))",
    )
    .bind(retention)
    .execute(&state.pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

async fn settle_one(state: &ServiceState, p: &Pending) -> &'static str {
    let result_code =
        match reconciliation_result(p.settled_window_passed, observe_delivery(state, p).await) {
            Ok(result) => result,
            Err(reason) => return reason,
        };
    write_reconciliation(state, p, result_code).await
}

/// Ordinary query absence is never an authoritative non-delivery receipt.
/// All observations in this reconciler use filtered event queries. Keep their
/// absence out of the terminal audit even after the diagnostic settle window.
fn reconciliation_result(
    settled: bool,
    observed: Result<bool, &'static str>,
) -> Result<&'static str, &'static str> {
    match observed {
        Ok(true) => Ok("ACCEPTED"),
        Ok(false) if settled => Err("EVENT_UNOBSERVABLE"),
        Ok(false) => Err("PENDING"),
        Err(reason) => Err(reason),
    }
}

async fn write_reconciliation(
    state: &ServiceState,
    p: &Pending,
    result_code: &'static str,
) -> &'static str {
    let written = async {
        let mut tx = state.pool.begin().await?;
        // Local revocation/binding changes after the HTTP/fresh-authorization
        // recheck cannot race a new ACCEPTED audit row. No external I/O here.
        if result_code == "ACCEPTED" {
            let actor = p.actor_principal_id.ok_or(sqlx::Error::RowNotFound)?;
            let target = publication_target(p).map_err(|_| sqlx::Error::RowNotFound)?;
            let scope: Option<Option<serde_json::Value>> = sqlx::query_scalar(
                "select delivery_scope from admission.publish_attempt where operation_id=$1 and event_id=$2 and tenant_principal_id=$3 for share")
                .bind(p.operation_id).bind(&p.event_id).bind(actor).fetch_optional(&mut *tx).await?;
            let scope = parse_frozen_scope(scope.flatten()).map_err(|_| sqlx::Error::RowNotFound)?;
            if !crate::web_transport::locked_publication_scope_matches(&mut tx, p.tenant_id, actor, target, &scope).await? {
                return Err(sqlx::Error::RowNotFound);
            }
        }
        append(&mut tx, reconciliation_entry(p, result_code)).await?;
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

fn reconciliation_entry<'a>(p: &'a Pending, result_code: &'a str) -> AuditEntry<'a> {
    AuditEntry {
        // The legacy key may already hold a false absence conclusion. A
        // positive observation appends a distinct, idempotent correction.
        event_key: crate::web_transport::publication_event_key(
            p.operation_id,
            &p.event_id,
            "RECONCILIATION",
        ),
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
    }
}

fn publication_target(p: &Pending) -> Result<MessageTarget, &'static str> {
    match (
        p.action_key.as_str(),
        p.target_type.as_deref(),
        p.target_id,
        p.workspace_id,
    ) {
        (
            PUBLISH_ACTION | TOPIC_ACTION | crate::projects::PUBLISH_ACTION,
            Some("CHANNEL"),
            Some(target),
            Some(workspace),
        ) if target == workspace => Ok(MessageTarget::Workspace(workspace)),
        (
            CONVERSATION_PUBLISH_ACTION | CONVERSATION_HIDE_ACTION | CONVERSATION_REOPEN_ACTION,
            Some("CONVERSATION"),
            Some(id),
            None,
        ) => Ok(MessageTarget::Conversation(id)),
        (
            crate::pulse::PUBLISH_ACTION
            | crate::projects::PUBLISH_ACTION
            | crate::reminders::PUBLISH_ACTION,
            Some("TENANT"),
            Some(tenant),
            None,
        ) if tenant == p.tenant_id => Ok(MessageTarget::Pulse(tenant)),
        _ => Err("EVIDENCE_MISSING"),
    }
}

async fn frozen_scope(state: &ServiceState, p: &Pending) -> Result<PublicationScope, &'static str> {
    let actor = p.actor_principal_id.ok_or("EVIDENCE_MISSING")?;
    let scope: Option<Option<serde_json::Value>> = sqlx::query_scalar(
        "select delivery_scope from admission.publish_attempt where operation_id=$1 and event_id=$2 and tenant_principal_id=$3")
        .bind(p.operation_id).bind(&p.event_id).bind(actor).fetch_optional(&state.pool).await
        .map_err(|_| "EVIDENCE_UNREADABLE")?;
    // Never synthesize the original Community, actual kind or signer from today's
    // host / the old message_kind default. Legacy attempts remain unresolved.
    parse_frozen_scope(scope.flatten())
}

fn parse_frozen_scope(value: Option<serde_json::Value>) -> Result<PublicationScope, &'static str> {
    let value = value.ok_or("EVIDENCE_MISSING")?;
    if !value.as_object().is_some_and(|object| {
        object.len() == 8
            && [
                "target_channel_id",
                "target_binding_version",
                "event_channel_id",
                "signer_installation_id",
            ]
            .iter()
            .all(|key| object.contains_key(*key))
    }) {
        return Err("EVIDENCE_INVALID");
    }
    serde_json::from_value(value).map_err(|_| "EVIDENCE_INVALID")
}

async fn current_scope(
    state: &ServiceState,
    p: &Pending,
    target: MessageTarget,
    scope: &PublicationScope,
) -> Result<crate::web_transport::PublicationBinding, &'static str> {
    let actor = p.actor_principal_id.ok_or("EVIDENCE_MISSING")?;
    let binding = publication_binding(state, p.tenant_id, actor, target).await?;
    if !scope.matches_binding(&binding) {
        return Err("SCOPE_CHANGED");
    }
    if let Some(installation) = scope.signer_installation_id {
        let MessageTarget::Workspace(workspace) = target else {
            return Err("EVIDENCE_INVALID");
        };
        if !matches!(scope.event_kind, 5 | 40003)
            || p.action_key != PUBLISH_ACTION
            || owned_publication_installation(
                state,
                p.tenant_id,
                actor,
                workspace,
                &scope.event_pubkey,
            )
            .await?
                != installation
        {
            return Err("ACTOR_UNREADABLE");
        }
    } else {
        let author: Option<String> = sqlx::query_scalar("select pubkey from identity.buzz_identity_binding where tenant_id=$1 and principal_id=$2 and kind='HUMAN' and custody='SERVER' and state='ACTIVE'")
            .bind(p.tenant_id).bind(actor).fetch_optional(&state.pool).await.map_err(|_| "ACTOR_UNREADABLE")?;
        if author.as_deref() != Some(&scope.event_pubkey) {
            return Err("ACTOR_UNREADABLE");
        }
    }
    Ok(binding)
}

async fn observe_delivery(state: &ServiceState, p: &Pending) -> Result<bool, &'static str> {
    let target = publication_target(p)?;
    let scope = frozen_scope(state, p).await?;
    let before = current_scope(state, p, target, &scope).await?;
    let actor = p.actor_principal_id.ok_or("EVIDENCE_MISSING")?;
    // An owner may read metadata for an owned Agent's edit/delete through the
    // Workspace CONTROL identity; the original signer and Installation remain
    // frozen and checked. Private conversations never use CONTROL.
    let client = if scope.signer_installation_id.is_some() {
        let (client, host) = control_client(state, p.tenant_id, ProjectionDirection::Establish)
            .await
            .map_err(|_| "CONTROL_UNREADABLE")?;
        if host != before.community_host {
            return Err("SCOPE_CHANGED");
        }
        client
    } else {
        let keys = crate::web_transport::server_actor_keys(
            &state.pool,
            &state.secrets,
            p.tenant_id,
            actor,
        )
        .await
        .map_err(|_| "ACTOR_UNREADABLE")?;
        if keys.public_key().to_hex() != scope.event_pubkey {
            return Err("ACTOR_UNREADABLE");
        }
        collab_bridge::bridge::IdentityClient::new(
            collab_bridge::bridge::Custody::Server,
            &keys.secret_key().to_secret_hex(),
            &state.relay_transport,
            &before.community_host,
        )
        .map_err(|_| "ACTOR_UNREADABLE")?
    };
    let observation = client
        .observe_publication(&state.http, &p.event_id, scope.community_id)
        .await
        .map_err(|_| "EVENT_UNOBSERVABLE")?;
    let after = current_scope(state, p, target, &scope).await?;
    if before != after {
        return Err("SCOPE_CHANGED");
    }
    if !scope.matches_observation(&p.event_id, &observation) {
        return Err("EVIDENCE_INVALID");
    }
    // This is only positive writer evidence. 404, denial, purge, unsupported
    // ephemeral commands (41010/41012), timeout and host changes stay UNKNOWN.
    Ok(true)
}

#[cfg(test)]
mod tests {
    #[test]
    fn historical_or_partial_scope_never_uses_current_host_or_kind_defaults() {
        assert_eq!(super::parse_frozen_scope(None), Err("EVIDENCE_MISSING"));
        assert_eq!(
            super::parse_frozen_scope(Some(serde_json::json!({"message_kind":9}))),
            Err("EVIDENCE_INVALID")
        );
        let scope = super::PublicationScope {
            community_id: uuid::Uuid::new_v4(),
            tenant_binding_version: 1,
            target_channel_id: None,
            target_binding_version: None,
            event_pubkey: nostr::Keys::generate().public_key().to_hex(),
            event_kind: 1,
            event_channel_id: None,
            signer_installation_id: None,
        };
        let complete = serde_json::to_value(&scope).unwrap();
        assert_eq!(
            super::parse_frozen_scope(Some(complete.clone())).unwrap(),
            scope
        );
        for key in complete.as_object().unwrap().keys() {
            let mut partial = complete.clone();
            partial.as_object_mut().unwrap().remove(key);
            assert_eq!(
                super::parse_frozen_scope(Some(partial)),
                Err("EVIDENCE_INVALID"),
                "{key}"
            );
        }
    }

    use super::*;

    #[tokio::test]
    #[ignore = "requires PUBLISH_RECONCILE_TEST_DATABASE_URL pointing at an isolated migrated database"]
    async fn historical_absence_remains_pending_and_retained_until_positive_correction() {
        let pool =
            sqlx::PgPool::connect(&std::env::var("PUBLISH_RECONCILE_TEST_DATABASE_URL").unwrap())
                .await
                .unwrap();
        let mut tx = pool.begin().await.unwrap();
        let tenant = Uuid::new_v4();
        let principal = Uuid::new_v4();
        sqlx::query("insert into identity.tenant(id,slug,name,state) values($1,$2,'publication fixture','ACTIVE')")
            .bind(tenant).bind(format!("publication-{tenant}")).execute(&mut *tx).await.unwrap();
        sqlx::query("insert into identity.principal(id,tenant_id,kind,status) values($1,$2,'HUMAN','ACTIVE')")
            .bind(principal).bind(tenant).execute(&mut *tx).await.unwrap();
        let before: (i64, i64) = sqlx::query_as(UNSETTLED_PUBLICATIONS_SQL)
            .bind(FILTERED_PUBLICATION_ACTIONS.as_slice())
            .bind(FILTERED_PUBLICATION_ACTIONS.as_slice())
            .fetch_one(&mut *tx)
            .await
            .unwrap();
        let mut attempts = Vec::new();
        for action in FILTERED_PUBLICATION_ACTIONS {
            let operation = Uuid::new_v4();
            let event_id = operation.simple().to_string().repeat(2);
            sqlx::query("insert into admission.publish_attempt(tenant_principal_id,idempotency_key,operation_id,event_id,created_at) values($1,$2,$3,$4,now()-interval '2 days')")
                .bind(principal).bind(Uuid::new_v4()).bind(operation).bind(&event_id)
                .execute(&mut *tx).await.unwrap();
            // Historical rows are inserted as historical facts, never updated.
            for (event_type, result, key) in [
                (
                    "DISPATCH",
                    "DISPATCHED",
                    format!("publication-fixture:{operation}"),
                ),
                (
                    "RECONCILIATION",
                    "NOT_DELIVERED",
                    format!("message.publish:{event_id}:reconciled"),
                ),
            ] {
                sqlx::query("insert into audit.audit_event(id,event_key,tenant_id,operation_id,event_type,actor_principal_id,action_key,action_version,component_type_key,parameter_hash,decision,result_code,result_exposure,evidence_refs,correlation_id,occurred_at) values($1,$2,$3,$4,$5,$6,$7,1,'buzz','NONE','ALLOW',$8,'NONE',jsonb_build_array(jsonb_build_object('kind','BUZZ_EVENT_ID','value',$9::text)),$4,now()-interval '2 days')")
                    .bind(Uuid::new_v4()).bind(key).bind(tenant).bind(operation).bind(event_type)
                    .bind(principal).bind(action).bind(result).bind(&event_id)
                    .execute(&mut *tx).await.unwrap();
            }
            attempts.push(Pending {
                operation_id: operation,
                tenant_id: tenant,
                workspace_id: None,
                human_identity_id: None,
                initiator_principal_id: Some(principal),
                actor_principal_id: Some(principal),
                target_id: None,
                action_key: action.into(),
                target_type: None,
                evidence_refs: vec![Evidence::new(
                    contracts::EvidenceKind::BuzzEventId,
                    &event_id,
                )],
                event_id,
                settled_window_passed: true,
            });
        }
        let pending = sqlx::query_as::<_, PendingRow>(PENDING_PUBLICATIONS_SQL)
            .bind(FILTERED_PUBLICATION_ACTIONS.as_slice())
            .bind(10000_i64)
            .bind(900_i64)
            .bind(1_i64)
            .bind(None::<chrono::DateTime<chrono::Utc>>)
            .bind(None::<Uuid>)
            .bind(FILTERED_PUBLICATION_ACTIONS.as_slice())
            .fetch_all(&mut *tx)
            .await
            .unwrap();
        for attempt in &attempts {
            assert!(
                pending
                    .iter()
                    .any(|row| row.operation_id == attempt.operation_id),
                "historical absence must remain eligible for positive observation"
            );
        }
        let unsettled: (i64, i64) = sqlx::query_as(UNSETTLED_PUBLICATIONS_SQL)
            .bind(FILTERED_PUBLICATION_ACTIONS.as_slice())
            .bind(FILTERED_PUBLICATION_ACTIONS.as_slice())
            .fetch_one(&mut *tx)
            .await
            .unwrap();
        assert_eq!(unsettled.0, before.0 + 6);
        assert!(
            unsettled.1 >= 172800,
            "oldest unresolved intent remains visible"
        );
        sqlx::query(REAP_PUBLICATIONS_SQL)
            .bind(1_i64)
            .bind(FILTERED_PUBLICATION_ACTIONS.as_slice())
            .execute(&mut *tx)
            .await
            .unwrap();
        let retained: i64 = sqlx::query_scalar(
            "select count(*) from admission.publish_attempt where tenant_principal_id=$1",
        )
        .bind(principal)
        .fetch_one(&mut *tx)
        .await
        .unwrap();
        assert_eq!(
            retained, 6,
            "TTL cannot discard an unresolved idempotency key"
        );

        // Exercise the production audit constructor and append path. The old
        // false conclusion survives, and repeated positive evidence adds once.
        for _ in 0..2 {
            append(&mut tx, reconciliation_entry(&attempts[0], "ACCEPTED"))
                .await
                .unwrap();
        }
        let conclusions: Vec<String> = sqlx::query_scalar("select result_code from audit.audit_event where operation_id=$1 and event_type='RECONCILIATION' order by occurred_at,id")
            .bind(attempts[0].operation_id).fetch_all(&mut *tx).await.unwrap();
        assert_eq!(conclusions, ["NOT_DELIVERED", "ACCEPTED"]);
        let mut definite = reconciliation_entry(&attempts[1], "NOT_DELIVERED");
        definite.event_type = "OUTCOME";
        definite.event_key = format!("publication-fixture:{}:limited", attempts[1].operation_id);
        append(&mut tx, definite).await.unwrap();
        let after: (i64, i64) = sqlx::query_as(UNSETTLED_PUBLICATIONS_SQL)
            .bind(FILTERED_PUBLICATION_ACTIONS.as_slice())
            .bind(FILTERED_PUBLICATION_ACTIONS.as_slice())
            .fetch_one(&mut *tx)
            .await
            .unwrap();
        assert_eq!(after.0, before.0 + 4);
        sqlx::query(REAP_PUBLICATIONS_SQL)
            .bind(1_i64)
            .bind(FILTERED_PUBLICATION_ACTIONS.as_slice())
            .execute(&mut *tx)
            .await
            .unwrap();
        let retained: i64 = sqlx::query_scalar(
            "select count(*) from admission.publish_attempt where tenant_principal_id=$1",
        )
        .bind(principal)
        .fetch_one(&mut *tx)
        .await
        .unwrap();
        assert_eq!(
            retained, 6,
            "a fresh correction or LIMIT starts a complete terminal retention window"
        );
        // Insert immutable historical terminal facts, never move an audit
        // timestamp backwards. An older real outcome must not override the
        // fresh positive correction when calculating the retention age.
        for index in [0_usize, 2, 3] {
            let attempt = &attempts[index];
            sqlx::query("insert into audit.audit_event(id,event_key,tenant_id,operation_id,event_type,action_key,action_version,component_type_key,parameter_hash,decision,result_code,result_exposure,correlation_id,occurred_at) values($1,$2,$3,$4,'OUTCOME',$5,1,'buzz','NONE','ALLOW',$6,'NONE',$4,now()-interval '60 seconds')")
                .bind(Uuid::new_v4()).bind(format!("publication-fixture:{}:historical", attempt.operation_id))
                .bind(tenant).bind(attempt.operation_id).bind(&attempt.action_key)
                .bind(if index == 3 { "NOT_DELIVERED" } else { "ACCEPTED" })
                .execute(&mut *tx).await.unwrap();
        }
        sqlx::query(REAP_PUBLICATIONS_SQL)
            .bind(1_i64)
            .bind(FILTERED_PUBLICATION_ACTIONS.as_slice())
            .execute(&mut *tx)
            .await
            .unwrap();
        let retained: Vec<Uuid> = sqlx::query_scalar(
            "select operation_id from admission.publish_attempt where tenant_principal_id=$1",
        )
        .bind(principal)
        .fetch_all(&mut *tx)
        .await
        .unwrap();
        assert_eq!(retained.len(), 4);
        for index in [0_usize, 1, 4, 5] {
            assert!(
                retained.contains(&attempts[index].operation_id),
                "latest real terminal window or UNKNOWN must remain protected"
            );
        }
        tx.rollback().await.unwrap();
    }

    #[test]
    fn ordinary_query_absence_never_authorizes_a_new_publication() {
        for settled in [false, true] {
            assert_eq!(
                reconciliation_result(settled, Ok(false)),
                Err(if settled {
                    "EVENT_UNOBSERVABLE"
                } else {
                    "PENDING"
                }),
                "deleted events, deleted deletions and delayed writers remain unresolved"
            );
            assert_eq!(
                reconciliation_result(settled, Ok(true)),
                Ok("ACCEPTED"),
                "positive delivery evidence still settles"
            );
            for reason in ["QUERY_FAILED", "EVIDENCE_MISSING", "PARTICIPANT_UNREADABLE"] {
                assert_eq!(reconciliation_result(settled, Err(reason)), Err(reason));
            }
        }
    }
}
