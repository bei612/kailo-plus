//! DD-117 / SF-BUZ-48：Agent 公开资料（kind:0）是 AgentInstallation 协作身份投影。
//!
//! 内容只取 pinned AgentVersion 的 `personaIdentity`，由该 Installation 的 ACTIVE
//! AGENT `SERVER` 身份签名；不新增用户 Action，审计追加到使当前 generation 生效的
//! 原 `agent.installation.create/upgrade` operation。发布沿 DD-81：先落 event ID 与
//! DISPATCH 再投递，结果不明只按 event ID 对账，不另签新事件。
//!
//! 补发判据只有一个：该 Installation 最近一次资料发布不是“当前 pinned Version 与
//! 当前 AGENT pubkey 的已接受发布”。因此创建、升级/回滚激活后的首次发布与本变更
//! 之前已 ACTIVE 的存量 Installation 走同一路径。Installation 或 AGENT binding 离开
//! ACTIVE 后不再签发：已发布资料原样保留，与上游删除托管 Agent 时不撤回 kind:0 一致。

use std::time::Duration;

use collab_bridge::bridge::{Custody, Delivery, IdentityClient};
use contracts::EvidenceKind;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::audit::{append, AuditEntry, Evidence};
use crate::service_api::ServiceState;

const CREATE_ACTION: &str = "agent.installation.create";
const UPGRADE_ACTION: &str = "agent.installation.upgrade";

/// Persona → upstream managed-agent kind:0 shape (`build_profile` with `name` and
/// `nip05` absent). Blank optional fields are omitted; a blank display name is
/// not a profile and is not published.
pub(crate) fn profile_content(persona: &Value) -> Option<String> {
    let text = |key: &str| {
        persona
            .get(key)
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
    };
    let display_name = text("displayName")?;
    let mut content = Map::new();
    content.insert("display_name".into(), Value::String(display_name.into()));
    if let Some(picture) = text("avatarUrl") {
        content.insert("picture".into(), Value::String(picture.into()));
    }
    if let Some(about) = text("description") {
        content.insert("about".into(), Value::String(about.into()));
    }
    Some(Value::Object(content).to_string())
}

fn content_sha256(content: &str) -> String {
    format!("{:x}", Sha256::digest(content.as_bytes()))
}

/// Replaceable metadata wins by `created_at`; a retry after a definite
/// non-delivery must never sort behind the previous attempt.
fn next_created_at(now: u64, last_signed_at: Option<i64>) -> u64 {
    let after_last = last_signed_at
        .and_then(|value| u64::try_from(value).ok())
        .map_or(0, |value| value.saturating_add(1));
    now.max(after_last)
}

#[derive(sqlx::FromRow)]
struct Candidate {
    installation_resource_id: Uuid,
    tenant_id: Uuid,
    workspace_id: Uuid,
    agent_principal_id: Uuid,
    agent_version_asset_id: Uuid,
    persona: Option<Value>,
    agent_pubkey: String,
    agent_locator: String,
    agent_secret_version: i32,
    agent_audience: String,
    normalized_host: String,
    nip11_snapshot_digest: Option<String>,
    action_execution_id: Uuid,
    operation_id: Uuid,
    action_key: String,
    action_version: i32,
    initiator_principal_id: Uuid,
    parameter_hash: String,
    correlation_id: Uuid,
    component_type_key: String,
    result_exposure: String,
    last_signed_at: Option<i64>,
}

/// Every predicate of DD-117 (4). `$2` restricts to one Installation (activation
/// path); `$3` is the retry delay after a definite non-delivery, NULL = never.
const CANDIDATES: &str = "select i.resource_id as installation_resource_id,r.tenant_id,i.workspace_id,
    i.agent_principal_id,i.pinned_version_asset_id as agent_version_asset_id,
    v.content->'personaIdentity' as persona,b.pubkey as agent_pubkey,
    b.private_key_secret_ref as agent_locator,b.private_key_secret_version as agent_secret_version,
    b.private_key_secret_audience as agent_audience,tb.normalized_host,tb.nip11_snapshot_digest,
    ae.id as action_execution_id,ae.operation_id,ae.action_key,ae.action_version,
    ae.initiator_principal_id,ae.parameter_hash,ae.correlation_id,d.component_type_key,
    d.result_exposure,last.signed_at as last_signed_at
  from catalog.agent_installation i
  join catalog.resource r on r.id=i.resource_id and r.state='ACTIVE'
    and r.type_key='agent.installation' and r.home_workspace_id=i.workspace_id
  join identity.tenant t on t.id=r.tenant_id and t.state='ACTIVE'
  join identity.workspace w on w.id=i.workspace_id and w.tenant_id=t.id and w.state='ACTIVE'
  join catalog.agent_version v on v.asset_id=i.pinned_version_asset_id
  join identity.principal agent on agent.id=i.agent_principal_id and agent.tenant_id=t.id
    and agent.kind='AGENT' and agent.status='ACTIVE'
  join catalog.agent_memory_binding m on m.installation_resource_id=i.resource_id
  join identity.buzz_identity_binding b on b.pubkey=m.agent_buzz_identity_binding_id
    and b.tenant_id=t.id and b.principal_id=agent.id and b.kind='AGENT' and b.custody='SERVER'
    and b.state='ACTIVE' and b.private_key_secret_status='ACTIVE'
  join projection.tenant_buzz_binding tb on tb.tenant_id=t.id and tb.state='ACTIVE'
  join lateral (select a.id,a.operation_id,a.action_key,a.action_version,a.initiator_principal_id,
      a.parameter_hash,a.correlation_id from admission.action_execution a
    where a.target_id=i.resource_id and a.tenant_id=t.id and a.workspace_id=i.workspace_id
      and a.action_key in ('agent.installation.create','agent.installation.upgrade')
      and a.gate_state='ALLOWED' and a.dispatch_state='DISPATCHED'
      and a.parameters->'params'->>'assetId'=i.pinned_version_asset_id::text
    order by a.created_at desc,a.id limit 1) ae on true
  join catalog.action_definition d on d.action_key=ae.action_key and d.version=ae.action_version
  left join lateral (select p.state,p.signed_at,p.agent_version_asset_id,p.agent_pubkey,p.settled_at
    from projection.agent_profile_publication p where p.installation_resource_id=i.resource_id
    order by p.signed_at desc,p.created_at desc limit 1) last on true
  where i.state='ACTIVE' and i.active_projection_generation is not null
    and catalog.agent_generation_admitted(i.resource_id,i.pinned_version_asset_id,i.active_projection_generation)
    and ($2::uuid is null or i.resource_id=$2)
    and (last.state is null
      or (last.state<>'DISPATCHED' and (last.agent_version_asset_id<>i.pinned_version_asset_id
            or last.agent_pubkey<>b.pubkey))
      or (last.state in ('REJECTED','NOT_DELIVERED') and $3::bigint is not null
            and last.settled_at<now()-make_interval(secs=>$3::bigint)))
  order by i.resource_id limit $1";

#[derive(sqlx::FromRow)]
struct Open {
    event_id: String,
    tenant_id: Uuid,
    workspace_id: Uuid,
    installation_resource_id: Uuid,
    agent_pubkey: String,
    agent_principal_id: Uuid,
    action_execution_id: Uuid,
    operation_id: Uuid,
    action_key: String,
    action_version: i32,
    initiator_principal_id: Uuid,
    parameter_hash: String,
    correlation_id: Uuid,
    component_type_key: String,
    result_exposure: String,
    settled_window_passed: bool,
}

/// Publication-result reconciliation plus missing/stale profile publication.
/// Called from the publish reconciler loop with its Relay drift-window settle.
pub(crate) async fn reconcile(
    state: &ServiceState,
    batch: i64,
    settle: Duration,
) -> Result<(), String> {
    settle_open(state, batch, settle).await?;
    let candidates: Vec<Candidate> = sqlx::query_as(CANDIDATES)
        .bind(batch)
        .bind(None::<Uuid>)
        .bind(i64::try_from(settle.as_secs()).unwrap_or(i64::MAX))
        .fetch_all(&state.pool)
        .await
        .map_err(|e| e.to_string())?;
    for candidate in candidates {
        publish(state, candidate).await;
    }
    Ok(())
}

/// Activation path (create/upgrade/rollback): publish the newly active Version's
/// profile without waiting for the next reconcile tick. Rejections are retried
/// only by the reconciler's delay; failures here stay with the reconciler.
pub(crate) async fn project_installation(state: &ServiceState, installation: Uuid) {
    let candidates: Result<Vec<Candidate>, _> = sqlx::query_as(CANDIDATES)
        .bind(1_i64)
        .bind(Some(installation))
        .bind(None::<i64>)
        .fetch_all(&state.pool)
        .await;
    match candidates {
        Ok(candidates) => {
            for candidate in candidates {
                publish(state, candidate).await;
            }
        }
        Err(error) => tracing::warn!(%installation, error=%error,
            "Agent profile projection deferred to reconciler"),
    }
}

async fn publish(state: &ServiceState, candidate: Candidate) {
    let installation = candidate.installation_resource_id;
    match publish_one(state, &candidate).await {
        Ok(Some((event_id, outcome))) => tracing::info!(%installation,
            agent_pubkey=%candidate.agent_pubkey, version=%candidate.agent_version_asset_id,
            event_id=%event_id, outcome, "Agent profile kind:0 published"),
        Ok(None) => {}
        Err(reason) => tracing::warn!(%installation, agent_pubkey=%candidate.agent_pubkey,
            reason, "Agent profile kind:0 not published; reconciler retries"),
    }
}

/// Returns the signed event ID and its definite outcome (`UNKNOWN` when the
/// Relay result is not known). `None` means nothing was signed.
async fn publish_one(
    state: &ServiceState,
    c: &Candidate,
) -> Result<Option<(String, &'static str)>, &'static str> {
    if !matches!(c.action_key.as_str(), CREATE_ACTION | UPGRADE_ACTION) {
        return Err("admitting action is not an installation activation");
    }
    let Some(content) = c.persona.as_ref().and_then(profile_content) else {
        return Err("pinned Version personaIdentity has no display name");
    };
    let expected_locator = state.secrets.tenant_locator(
        c.tenant_id,
        &format!("buzz-agent/installation/{}", c.installation_resource_id),
    );
    if c.agent_locator != expected_locator || c.agent_audience != state.secret_audience {
        return Err("AGENT SecretRef is not this installation's identity");
    }
    crate::service_api::audit_gate(state)
        .await
        .map_err(|_| "OpenBao audit device not verified")?;
    let keys = crate::server_identity::read_bound_keys(
        &state.secrets,
        &secret_store::SecretRef {
            locator: c.agent_locator.clone(),
            version: u32::try_from(c.agent_secret_version)
                .map_err(|_| "AGENT SecretRef version invalid")?,
            audience: c.agent_audience.clone(),
        },
        &c.agent_pubkey,
    )
    .await
    .map_err(|_| "AGENT key unreadable or not the bound pubkey")?;
    let transport =
        reqwest::Url::parse(&state.relay_transport).map_err(|_| "Relay transport invalid")?;
    let nip11 = collab_bridge::limits::fetch_nip11(&state.relay_http, &transport, &c.normalized_host)
        .await
        .map_err(|_| "Relay NIP-11 unavailable")?;
    if c.nip11_snapshot_digest.as_deref() != Some(nip11.digest.as_str()) {
        return Err("Relay NIP-11 differs from the ACTIVE binding snapshot");
    }
    let client = IdentityClient::new(
        Custody::Server,
        &keys.secret_key().to_secret_hex(),
        &state.relay_transport,
        &c.normalized_host,
    )
    .map_err(|_| "AGENT identity client unavailable")?;
    let created_at = next_created_at(nostr::Timestamp::now().as_secs(), c.last_signed_at);
    let content_hash = content_sha256(&content);
    let event = nostr::EventBuilder::new(nostr::Kind::Metadata, content)
        .custom_created_at(nostr::Timestamp::from(created_at))
        .sign_with_keys(&keys)
        .map_err(|_| "AGENT kind:0 signing failed")?;
    let event_id = event.id.to_hex();
    let admitted = client.admit().map_err(|_| "Relay budget refused")?;
    let evidence = evidence(c.action_execution_id, &event_id, &c.agent_pubkey);
    // Persist the intent first. The installation row lock serializes the
    // activation path and the reconciler; the partial unique index keeps at most
    // one result-unknown publication per installation.
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| "database unavailable")?;
    let still: Option<bool> = sqlx::query_scalar(
        "select (last.state is null or last.state<>'DISPATCHED')
            and not exists(select 1 from projection.agent_profile_publication p
              where p.installation_resource_id=i.resource_id and p.state='ACCEPTED'
                and p.agent_version_asset_id=$2 and p.agent_pubkey=$3
                and p.signed_at=(select max(q.signed_at) from projection.agent_profile_publication q
                  where q.installation_resource_id=i.resource_id))
         from catalog.agent_installation i
         left join lateral (select p.state from projection.agent_profile_publication p
           where p.installation_resource_id=i.resource_id
           order by p.signed_at desc,p.created_at desc limit 1) last on true
         where i.resource_id=$1 and i.state='ACTIVE' and i.pinned_version_asset_id=$2
         for update of i",
    )
    .bind(c.installation_resource_id)
    .bind(c.agent_version_asset_id)
    .bind(&c.agent_pubkey)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| "database unavailable")?;
    if still != Some(true) {
        return Ok(None);
    }
    sqlx::query(
        "insert into projection.agent_profile_publication(event_id,tenant_id,installation_resource_id,
            agent_pubkey,agent_version_asset_id,action_execution_id,operation_id,content_sha256,
            signed_at,state) values($1,$2,$3,$4,$5,$6,$7,$8,$9,'DISPATCHED')",
    )
    .bind(&event_id)
    .bind(c.tenant_id)
    .bind(c.installation_resource_id)
    .bind(&c.agent_pubkey)
    .bind(c.agent_version_asset_id)
    .bind(c.action_execution_id)
    .bind(c.operation_id)
    .bind(&content_hash)
    .bind(i64::try_from(created_at).map_err(|_| "created_at out of range")?)
    .execute(&mut *tx)
    .await
    .map_err(|_| "publication intent not persisted")?;
    append(
        &mut tx,
        entry(
            &Fields::from(c),
            &event_id,
            "dispatch",
            "DISPATCH",
            "DISPATCHED",
            evidence.clone(),
        ),
    )
    .await
    .map_err(|_| "DISPATCH audit not persisted")?;
    tx.commit()
        .await
        .map_err(|_| "publication intent not committed")?;
    // A crash after this commit leaves only the stable ID; later rounds query it
    // and never sign a second event while it is unknown.
    let outcome = match client.deliver(&state.relay_http, &event, admitted).await {
        Delivery::Accepted => "ACCEPTED",
        Delivery::Rejected(reason) => {
            tracing::warn!(installation=%c.installation_resource_id, event_id=%event_id,
                reason=%reason, "Relay rejected Agent profile kind:0");
            "REJECTED"
        }
        Delivery::Limited(_, _) => "NOT_DELIVERED",
        Delivery::Unknown(_) => return Ok(Some((event_id, "UNKNOWN"))),
    };
    settle(
        state,
        &Fields::from(c),
        &event_id,
        "outcome",
        "OUTCOME",
        outcome,
        evidence,
    )
    .await
    .map_err(|_| "OUTCOME not persisted; reconciler settles by event ID")?;
    Ok(Some((event_id, outcome)))
}

/// DISPATCHED publications: Relay has the event → ACCEPTED; still absent after
/// the drift window → NOT_DELIVERED; otherwise keep waiting. Never re-signs.
async fn settle_open(state: &ServiceState, batch: i64, window: Duration) -> Result<(), String> {
    let rows: Vec<Open> = sqlx::query_as(
        "select p.event_id,p.tenant_id,i.workspace_id,p.installation_resource_id,p.agent_pubkey,
            i.agent_principal_id,p.action_execution_id,p.operation_id,ae.action_key,ae.action_version,
            ae.initiator_principal_id,ae.parameter_hash,ae.correlation_id,d.component_type_key,
            d.result_exposure,p.created_at<now()-make_interval(secs=>$2::bigint) as settled_window_passed
         from projection.agent_profile_publication p
         join catalog.agent_installation i on i.resource_id=p.installation_resource_id
         join admission.action_execution ae on ae.id=p.action_execution_id
         join catalog.action_definition d on d.action_key=ae.action_key and d.version=ae.action_version
         join identity.tenant t on t.id=p.tenant_id
         where p.state='DISPATCHED' order by p.created_at limit $1",
    )
    .bind(batch)
    .bind(i64::try_from(window.as_secs()).unwrap_or(i64::MAX))
    .fetch_all(&state.pool)
    .await
    .map_err(|e| e.to_string())?;
    for row in rows {
        let Ok((reader, _)) = crate::tenant_lifecycle::control_client(
            state,
            row.tenant_id,
            crate::tenant_lifecycle::ProjectionDirection::Establish,
        )
        .await
        else {
            continue;
        };
        let result = match reader.event_exists(&state.relay_http, &row.event_id).await {
            Ok(true) => "ACCEPTED",
            Ok(false) if row.settled_window_passed => "NOT_DELIVERED",
            _ => continue,
        };
        let fields = Fields::from(&row);
        let evidence = evidence(row.action_execution_id, &row.event_id, &row.agent_pubkey);
        if let Err(error) = settle(
            state,
            &fields,
            &row.event_id,
            "reconciled",
            "RECONCILIATION",
            result,
            evidence,
        )
        .await
        {
            tracing::warn!(event_id=%row.event_id, error=%error,
                "Agent profile publication result not recorded");
        } else {
            tracing::info!(installation=%row.installation_resource_id, event_id=%row.event_id,
                result, "Agent profile publication reconciled");
        }
    }
    Ok(())
}

async fn settle(
    state: &ServiceState,
    fields: &Fields<'_>,
    event_id: &str,
    phase: &str,
    event_type: &str,
    result: &str,
    evidence: Vec<Evidence>,
) -> Result<(), sqlx::Error> {
    let mut tx = state.pool.begin().await?;
    let changed = sqlx::query(
        "update projection.agent_profile_publication set state=$2,settled_at=now()
         where event_id=$1 and state='DISPATCHED'",
    )
    .bind(event_id)
    .bind(result)
    .execute(&mut *tx)
    .await?;
    if changed.rows_affected() != 1 {
        return Ok(());
    }
    append(
        &mut tx,
        entry(fields, event_id, phase, event_type, result, evidence),
    )
    .await?;
    tx.commit().await
}

fn evidence(action: Uuid, event_id: &str, pubkey: &str) -> Vec<Evidence> {
    vec![
        Evidence::new(EvidenceKind::ActionExecutionId, action),
        Evidence::new(EvidenceKind::BuzzEventId, event_id),
        Evidence::new(EvidenceKind::BuzzPubkey, pubkey),
    ]
}

struct Fields<'a> {
    tenant_id: Uuid,
    workspace_id: Uuid,
    installation: Uuid,
    agent_principal_id: Uuid,
    action_execution_id: Uuid,
    operation_id: Uuid,
    action_key: &'a str,
    action_version: i32,
    initiator_principal_id: Uuid,
    parameter_hash: &'a str,
    correlation_id: Uuid,
    component_type_key: &'a str,
    result_exposure: &'a str,
}

impl<'a> From<&'a Candidate> for Fields<'a> {
    fn from(c: &'a Candidate) -> Self {
        Self {
            tenant_id: c.tenant_id,
            workspace_id: c.workspace_id,
            installation: c.installation_resource_id,
            agent_principal_id: c.agent_principal_id,
            action_execution_id: c.action_execution_id,
            operation_id: c.operation_id,
            action_key: &c.action_key,
            action_version: c.action_version,
            initiator_principal_id: c.initiator_principal_id,
            parameter_hash: &c.parameter_hash,
            correlation_id: c.correlation_id,
            component_type_key: &c.component_type_key,
            result_exposure: &c.result_exposure,
        }
    }
}

impl<'a> From<&'a Open> for Fields<'a> {
    fn from(o: &'a Open) -> Self {
        Self {
            tenant_id: o.tenant_id,
            workspace_id: o.workspace_id,
            installation: o.installation_resource_id,
            agent_principal_id: o.agent_principal_id,
            action_execution_id: o.action_execution_id,
            operation_id: o.operation_id,
            action_key: &o.action_key,
            action_version: o.action_version,
            initiator_principal_id: o.initiator_principal_id,
            parameter_hash: &o.parameter_hash,
            correlation_id: o.correlation_id,
            component_type_key: &o.component_type_key,
            result_exposure: &o.result_exposure,
        }
    }
}

/// The installation projection phase of the admitting operation: the AGENT
/// identity is the actor that signs, the admitting HUMAN stays the initiator.
fn entry<'a>(
    f: &'a Fields<'a>,
    event_id: &str,
    phase: &str,
    event_type: &'a str,
    result: &'a str,
    evidence: Vec<Evidence>,
) -> AuditEntry<'a> {
    AuditEntry {
        event_key: format!(
            "{}:installation:profile:{event_id}:{phase}",
            f.action_execution_id
        ),
        tenant_id: Some(f.tenant_id),
        workspace_id: Some(f.workspace_id),
        operation_id: f.operation_id,
        event_type,
        human_identity_id: None,
        initiator_principal_id: Some(f.initiator_principal_id),
        actor_principal_id: Some(f.agent_principal_id),
        action_key: f.action_key,
        action_version: f.action_version,
        component_type_key: f.component_type_key,
        target_type: Some("RESOURCE"),
        target_id: Some(f.installation),
        parameter_hash: f.parameter_hash,
        decision: "ALLOW",
        result_code: result,
        result_exposure: f.result_exposure,
        evidence_refs: evidence,
        correlation_id: f.correlation_id,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn persona_maps_to_upstream_profile_fields_only() {
        let content = profile_content(&json!({
            "displayName": "研究助理",
            "avatarUrl": "https://example.test/a.png",
            "description": "负责检索"
        }))
        .unwrap();
        let value: Value = serde_json::from_str(&content).unwrap();
        assert_eq!(
            value,
            json!({"display_name": "研究助理", "picture": "https://example.test/a.png",
                   "about": "负责检索"})
        );
        assert!(value.get("name").is_none() && value.get("nip05").is_none());
    }

    #[test]
    fn blank_optional_fields_are_omitted_and_blank_name_is_not_a_profile() {
        let content = profile_content(&json!({"displayName": "写作助理", "avatarUrl": " "}));
        assert_eq!(content.as_deref(), Some(r#"{"display_name":"写作助理"}"#));
        assert!(profile_content(&json!({"displayName": "  "})).is_none());
        assert!(profile_content(&json!({})).is_none());
        assert!(profile_content(&Value::Null).is_none());
    }

    #[test]
    fn retry_never_sorts_behind_previous_attempt() {
        assert_eq!(next_created_at(100, None), 100);
        assert_eq!(next_created_at(100, Some(50)), 100);
        assert_eq!(next_created_at(100, Some(100)), 101);
        assert_eq!(next_created_at(100, Some(-1)), 100);
    }

    #[test]
    fn audit_key_is_stable_per_phase() {
        let id = Uuid::nil();
        let fields = Fields {
            tenant_id: id,
            workspace_id: id,
            installation: id,
            agent_principal_id: id,
            action_execution_id: id,
            operation_id: id,
            action_key: CREATE_ACTION,
            action_version: 1,
            initiator_principal_id: id,
            parameter_hash: "h",
            correlation_id: id,
            component_type_key: "core",
            result_exposure: "NONE",
        };
        let a = entry(&fields, "e", "dispatch", "DISPATCH", "DISPATCHED", vec![]);
        let b = entry(&fields, "e", "outcome", "OUTCOME", "ACCEPTED", vec![]);
        assert_ne!(a.event_key, b.event_key);
        assert_eq!(a.event_key, format!("{id}:installation:profile:e:dispatch"));
        assert_eq!(a.actor_principal_id, Some(id));
    }
}
