//! DD-151(3)(5): the push worker inside Core.
//!
//! Every tick it (1) revokes registrations whose device key or membership is gone and retires
//! their tokens, then (2) for each Tenant with deliverable registrations reads the new channel
//! messages from the Tenant's Relay as CONTROL, decides recipients with `decide`, re-checks
//! each recipient's channel eligibility, and delivers one content-free notification per
//! device under collapse and rate limits. Short leases fence scanning and dispatch; no
//! database transaction or connection spans Relay, OpenBao or provider HTTP.

use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;
use std::time::{Duration, Instant};

use opentelemetry::metrics::{Counter, Gauge, Meter};
use opentelemetry::KeyValue;
use serde_json::{json, Value};
use uuid::Uuid;

use super::decide::{self, MessageFacts, Reason, RecipientView};
use super::send::{
    ApnsCredential, ApnsRequest, ApnsSender, DeviceToken, FcmCredential, FcmSender, Outcome,
    Receipt,
};
use super::CredentialRefs;
use crate::audit::{AuditEntry, Evidence};
use crate::service_api::ServiceState;
use crate::tenant_lifecycle::{control_client, ProjectionDirection};

pub struct Config {
    pub interval: Duration,
    policy: super::config::Policy,
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let seconds = std::env::var("PUSH_POLL_SECONDS")
            .map_err(|_| "缺少 PUSH_POLL_SECONDS")?
            .parse::<i32>()
            .map_err(|_| "PUSH_POLL_SECONDS 必须为正整数")?;
        if seconds <= 0 {
            return Err("PUSH_POLL_SECONDS 必须为正整数".into());
        }
        let policy = super::config::Policy::parse(
            &std::env::var("PUSH_DELIVERY_POLICY").map_err(|_| "缺少 PUSH_DELIVERY_POLICY")?,
        )?;
        Ok(Self {
            interval: Duration::from_secs(seconds as u64),
            policy,
        })
    }
}

#[derive(Default)]
struct Providers {
    apns: Option<Arc<ApnsSender>>,
    fcm: Option<Arc<FcmSender>>,
    loaded: Option<Instant>,
}

impl Providers {
    fn any(&self) -> bool {
        self.apns.is_some() || self.fcm.is_some()
    }

    fn invalidate(&mut self) {
        self.loaded = None;
    }

    /// Re-read the provider credentials from OpenBao when due (rotation without restart).
    async fn refresh(&mut self, state: &ServiceState, policy: &super::config::Policy) {
        if self.loaded.is_some_and(|at| {
            at.elapsed() < Duration::from_secs(policy.credential_ttl_seconds as u64)
        }) {
            return;
        }
        let refs = CredentialRefs::from_env();
        self.apns = match &refs.apns {
            Some(r) => match load_apns(state, r).await {
                Ok(c) => Some(Arc::new(ApnsSender::new(c))),
                Err(()) => {
                    tracing::warn!("APNs 推送凭据不可读，本轮不投递 APNs");
                    None
                }
            },
            None => None,
        };
        self.fcm = match &refs.fcm {
            Some(r) => match load_fcm(state, r).await {
                Ok(c) => Some(Arc::new(FcmSender::new(c))),
                Err(()) => {
                    tracing::warn!("FCM 推送凭据不可读，本轮不投递 FCM");
                    None
                }
            },
            None => None,
        };
        self.loaded = Some(Instant::now());
    }
}

fn secret_ref(state: &ServiceState, (locator, version): &(String, u32)) -> secret_store::SecretRef {
    secret_store::SecretRef {
        locator: locator.clone(),
        version: *version,
        audience: state.secret_audience.clone(),
    }
}

async fn field(
    state: &ServiceState,
    r: &secret_store::SecretRef,
    name: &str,
) -> Result<String, ()> {
    state
        .secrets
        .read(r, name)
        .await
        .map(|v| v.expose().to_owned())
        .map_err(|_| ())
}

async fn load_apns(state: &ServiceState, refs: &(String, u32)) -> Result<ApnsCredential, ()> {
    let r = secret_ref(state, refs);
    Ok(ApnsCredential {
        key_pem: field(state, &r, "key_p8").await?,
        key_id: field(state, &r, "key_id").await?,
        team_id: field(state, &r, "team_id").await?,
        bundle_id: field(state, &r, "bundle_id").await?,
        sandbox: field(state, &r, "environment").await.ok().as_deref() == Some("development"),
    })
}

async fn load_fcm(state: &ServiceState, refs: &(String, u32)) -> Result<FcmCredential, ()> {
    let r = secret_ref(state, refs);
    let json = field(state, &r, "service_account_json").await?;
    serde_json::from_str(&json).map_err(|_| ())
}

struct Metrics {
    deliveries: Counter<u64>,
    checkpoints: Gauge<u64>,
}

pub fn spawn(state: ServiceState, meter: &Meter, cfg: Config) {
    let metrics = Metrics {
        checkpoints: meter.u64_gauge("platform.push.checkpoints").with_description("Content-free push checkpoint backlog by state; UNKNOWN needs evidence, never replay").build(),
        deliveries: meter
            .u64_counter("platform.push.deliveries")
            .with_description("DD-151 推送投递结果（按提供方与结果计数，不含正文或令牌）")
            .build(),
    };
    tokio::spawn(async move {
        let mut providers = Providers::default();
        let mut tick = tokio::time::interval(cfg.interval);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tick.tick().await;
            if let Err(e) = sweep(&state, &cfg.policy).await {
                tracing::warn!(error = %e, "推送登记撤销收敛失败");
            }
            match state.pool.acquire().await {
                Ok(mut conn) => {
                    if let Err(e) = super::intent::recover(&mut conn, &cfg.policy).await {
                        tracing::warn!(error=%e,"推送发送检查点恢复失败");
                    }
                }
                Err(e) => {
                    tracing::warn!(error=%e,"推送数据库连接失败");
                    continue;
                }
            }
            let checkpoints: Result<Vec<(String, i64)>, _> = sqlx::query_as(
                "select state,count(*) from projection.push_send_intent group by state",
            )
            .fetch_all(&state.pool)
            .await;
            if let Ok(rows) = checkpoints {
                for status in ["PREPARED", "CLAIMED", "SENDING", "RETRY", "UNKNOWN"] {
                    let count = rows
                        .iter()
                        .find(|(s, _)| s == status)
                        .map_or(0, |(_, n)| *n);
                    metrics
                        .checkpoints
                        .record(count.max(0) as u64, &[KeyValue::new("state", status)]);
                }
            }
            providers.refresh(&state, &cfg.policy).await;
            if !providers.any() {
                continue;
            }
            let tenants: Vec<(Uuid,)> = match sqlx::query_as(
                "select distinct tenant_id from identity.push_registration
                  where state = 'ACTIVE' and enabled
                  union select tenant_id from projection.push_send_intent where state in ('PREPARED','RETRY')",
            )
            .fetch_all(&state.pool)
            .await
            {
                Ok(t) => t,
                Err(e) => {
                    tracing::warn!(error = %e, "读推送 Tenant 失败");
                    continue;
                }
            };
            for (tenant,) in tenants {
                match run_tenant(&state, &providers, &metrics, tenant, &cfg.policy).await {
                    Ok(true) => providers.invalidate(),
                    Ok(false) => {}
                    Err(e) => tracing::warn!(error = %e, %tenant, "推送本轮失败"),
                }
            }
        }
    });
}

/// Revocation clears the live binding and freezes retirement atomically. No secret I/O
/// occurs in this transaction; the persistent consumer retries fencing and destruction.
pub(crate) async fn sweep(
    state: &ServiceState,
    policy: &super::config::Policy,
) -> Result<(), sqlx::Error> {
    let mut tx = state.pool.begin().await?;
    let rows:Vec<(Uuid,String,Uuid,Option<String>)>=sqlx::query_as("select r.tenant_id,r.device_pubkey,r.tenant_principal_id,r.token_secret_locator
        from identity.push_registration r where r.state<>'REVOKED' and (
        exists(select 1 from identity.tenant t where t.id=r.tenant_id and t.state in ('DELETING','DELETED')) or
        not exists(select 1 from identity.buzz_identity_binding b where b.tenant_id=r.tenant_id and b.principal_id=r.tenant_principal_id and b.pubkey=r.device_pubkey and b.custody='CLIENT' and b.state='ACTIVE') or
        not exists(select 1 from identity.tenant_membership m where m.tenant_id=r.tenant_id and m.tenant_principal_id=r.tenant_principal_id and m.state='ACTIVE'))
        order by r.tenant_id,r.device_pubkey for update of r skip locked limit $1")
        .bind(policy.retirement_batch_size).fetch_all(&mut *tx).await?;
    for (tenant, device, principal, locator) in rows {
        if let Some(locator) = locator {
            super::token_intent::retire(&mut tx, &locator).await?;
        }
        sqlx::query("update identity.push_registration set state='REVOKED',enabled=false,token_digest=null,token_secret_locator=null,token_secret_version=null,token_secret_audience=null,version=version+1,updated_at=now() where tenant_id=$1 and device_pubkey=$2")
            .bind(tenant).bind(&device).execute(&mut *tx).await?;
        let operation = Uuid::new_v4();
        crate::audit::append(
            &mut tx,
            AuditEntry {
                event_key: format!("push-registration-revoked:{tenant}:{device}:{operation}"),
                tenant_id: Some(tenant),
                workspace_id: None,
                operation_id: operation,
                event_type: "REVOCATION",
                human_identity_id: None,
                initiator_principal_id: None,
                actor_principal_id: None,
                action_key: "push.registration.revoke",
                action_version: 1,
                component_type_key: "core",
                target_type: Some("PRINCIPAL"),
                target_id: Some(principal),
                parameter_hash: "NONE",
                decision: "ALLOW",
                result_code: "PUSH_REVOKED",
                result_exposure: "NONE",
                evidence_refs: Vec::<Evidence>::new(),
                correlation_id: operation,
            },
        )
        .await?;
    }
    tx.commit().await?;
    super::token_intent::sweep(state, policy).await
}

#[derive(Clone)]
struct Registration {
    principal: Uuid,
    device: String,
    platform: String,
    app_id: String,
    locale: String,
    token: secret_store::SecretRef,
    version: i32,
}

type RegistrationRow = (
    Uuid,
    String,
    String,
    String,
    String,
    String,
    i32,
    String,
    i32,
);

enum Channel {
    Workspace(Uuid),
    Conversation {
        id: Uuid,
        participants: BTreeSet<Uuid>,
    },
}

#[derive(Default)]
struct Preferences {
    muted_workspaces: BTreeSet<String>,
    muted_conversations: BTreeSet<String>,
    followed_threads: BTreeSet<String>,
    muted_threads: BTreeSet<String>,
}

fn preferences(workspaces: &Value, conversations: &Value, threads: &Value) -> Preferences {
    let muted = |map: &Value| {
        map.as_object()
            .into_iter()
            .flatten()
            .filter(|(_, v)| v["muted"].as_bool() == Some(true))
            .map(|(k, _)| k.to_ascii_lowercase())
            .collect::<BTreeSet<_>>()
    };
    let thread_state = |wanted: &str| {
        threads
            .as_object()
            .into_iter()
            .flatten()
            .filter(|(_, v)| v["state"].as_str() == Some(wanted))
            .filter_map(|(k, _)| k.strip_prefix("thread:").map(str::to_ascii_lowercase))
            .collect::<BTreeSet<_>>()
    };
    Preferences {
        muted_workspaces: muted(workspaces),
        muted_conversations: muted(conversations),
        followed_threads: thread_state("FOLLOWED"),
        muted_threads: thread_state("MUTED"),
    }
}

/// A scanner lease serializes cursor advancement only. Provider delivery is an independent
/// durable consumer, so a broken Relay or another scanner does not block ready attempts.
async fn run_tenant(
    state: &ServiceState,
    providers: &Providers,
    metrics: &Metrics,
    tenant: Uuid,
    policy: &super::config::Policy,
) -> Result<bool, sqlx::Error> {
    if let Err(e) = scan(state, providers, tenant, policy).await {
        tracing::warn!(error=%e,%tenant,"推送扫描检查点失败");
    }
    let mut auth_failed = false;
    for _ in 0..policy.dispatch_batch_size {
        let Some(intent) = super::intent::claim(&state.pool, tenant, policy).await? else {
            break;
        };
        if let Some(receipt) = dispatch(state, providers, &intent, policy).await? {
            // A local commit failure must not repeat the external request. Retry only the
            // known receipt; a process crash leaves SENDING for UNKNOWN recovery.
            let mut persisted = false;
            for _ in 0..policy.receipt_commit_attempts {
                match super::intent::finish(&state.pool, &intent, &receipt).await {
                    Ok(_) => {
                        persisted = true;
                        break;
                    }
                    Err(e) => {
                        tracing::warn!(error=%e,intent_id=%intent.id,"推送回执检查点写入失败")
                    }
                }
            }
            if !persisted {
                tracing::warn!(intent_id=%intent.id,"推送回执待UNKNOWN恢复，未再次发送");
            }
            metrics.deliveries.add(
                1,
                &[
                    KeyValue::new("platform", intent.platform.clone()),
                    KeyValue::new("outcome", format!("{:?}", receipt.outcome)),
                ],
            );
            auth_failed |= receipt.outcome == Outcome::ProviderAuth;
        }
    }
    Ok(auth_failed)
}
fn provider_target(providers: &Providers, platform: &str) -> Option<String> {
    match platform {
        "APNS" => providers.apns.as_ref().map(|p| p.target()),
        "FCM" => providers.fcm.as_ref().map(|p| p.target()),
        _ => None,
    }
}
async fn scan(
    state: &ServiceState,
    providers: &Providers,
    tenant: Uuid,
    policy: &super::config::Policy,
) -> Result<(), sqlx::Error> {
    let Some((lease, since, seen)) = super::intent::claim_scan(&state.pool, tenant, policy).await?
    else {
        return Ok(());
    };
    let Ok((control, host)) = control_client(state, tenant, ProjectionDirection::Establish).await
    else {
        return Ok(());
    };
    // Runtime page size obeys the same ACTIVE binding's freshly verified NIP-11.
    let expected:Option<String>=sqlx::query_scalar("select nip11_snapshot_digest from projection.tenant_buzz_binding where tenant_id=$1 and normalized_host=$2 and state='ACTIVE'")
        .bind(tenant).bind(&host).fetch_optional(&state.pool).await?.flatten();
    let Ok(transport) = reqwest::Url::parse(&state.relay_transport) else {
        return Ok(());
    };
    let Ok(Ok(document)) = tokio::time::timeout(
        Duration::from_secs(policy.relay_read_timeout_seconds as u64),
        collab_bridge::limits::fetch_nip11(&state.http, &transport, &host),
    )
    .await
    else {
        return Ok(());
    };
    if expected.as_deref() != Some(document.digest.as_str()) {
        return Ok(());
    }
    let page_size = policy
        .scan_page_size
        .min(document.limits.max_limit as usize);
    let targets: Vec<(&str, String)> = ["APNS", "FCM"]
        .into_iter()
        .filter_map(|p| provider_target(providers, p).map(|t| (p, t)))
        .collect();
    let window = super::scan::Window {
        pool: &state.pool,
        tenant,
        lease,
        since,
        seen: seen.into_iter().collect(),
        until: chrono::Utc::now().timestamp(),
    };
    if let Err(reason) = window
        .run(&control, &state.http, policy, page_size, &targets)
        .await
    {
        tracing::warn!(%tenant,reason,"推送完整窗口读取未完成，游标保留");
    }
    Ok(())
}

async fn dispatch(
    state: &ServiceState,
    providers: &Providers,
    i: &super::intent::Intent,
    policy: &super::config::Policy,
) -> Result<Option<Receipt>, sqlx::Error> {
    let registration = load_registrations(state, i.tenant_id)
        .await?
        .into_iter()
        .find(|r| {
            r.device == i.device_pubkey
                && r.principal == i.tenant_principal_id
                && r.version == i.registration_version
        });
    let Some(r) = registration else {
        super::intent::cancel(&state.pool, i, "REGISTRATION_CHANGED").await?;
        return Ok(None);
    };
    let Some(provider) = provider_target(providers, &r.platform) else {
        super::intent::defer(&state.pool, i, policy).await?;
        return Ok(None);
    };
    if provider != i.provider_target {
        super::intent::cancel(&state.pool, i, "PROVIDER_TARGET_CHANGED").await?;
        return Ok(None);
    }
    let Ok((control, _)) = control_client(state, i.tenant_id, ProjectionDirection::Establish).await
    else {
        super::intent::defer(&state.pool, i, policy).await?;
        return Ok(None);
    };
    let Ok(found) = relay_query(
        &state.http,
        &control,
        &[json!({"ids":[i.event_id],"limit":1})],
        policy,
    ).await
    else {
        super::intent::defer(&state.pool, i, policy).await?;
        return Ok(None);
    };
    let Ok(events) = verified_page(found, std::slice::from_ref(&i.event_id)) else {
        super::intent::defer(&state.pool, i, policy).await?;
        return Ok(None);
    };
    let message = events.first().and_then(|event| {
        serde_json::to_value(event).ok().and_then(|value| MessageFacts::from_event(&value))
    });
    let Some(message) = message else {
        super::intent::cancel(&state.pool, i, "EVENT_ABSENT").await?;
        return Ok(None);
    };
    let Some(reason) = fresh_reason(state, &control, i.tenant_id, r.principal, &message, policy).await?
    else {
        super::intent::cancel(&state.pool, i, "NOT_ELIGIBLE").await?;
        return Ok(None);
    };
    let positions: Option<Value> = sqlx::query_scalar(
        "select read_contexts from identity.collaboration_user_state where tenant_principal_id=$1",
    )
    .bind(r.principal)
    .fetch_optional(&state.pool)
    .await?;
    let marks = positions.map_or_else(HashMap::new, |r| decide::read_marks(&r));
    if message.created_at as i64
        <= decide::read_position(
            &decide::unread_context(&message),
            &message.channel_id,
            &marks,
        )
    {
        super::intent::cancel(&state.pool, i, "ALREADY_READ").await?;
        return Ok(None);
    }
    let badge = super::unread::preview(
        &mut *state.pool.acquire().await?,
        i.tenant_id,
        r.principal,
        &message,
        &marks,
    )
    .await?;
    let token = match state.secrets.read(&r.token, "value").await {
        Ok(v) => DeviceToken(v.expose().to_owned()),
        Err(_) => {
            super::intent::defer(&state.pool, i, policy).await?;
            return Ok(None);
        }
    };
    let target = decide::target(&i.tenant_id.to_string(), &message);
    if !super::intent::begin_send(&state.pool, i, &target.collapse_key, policy).await? {
        // Includes per-device rate pressure; retry the local preflight, never a sent request.
        super::intent::defer(&state.pool, i, policy).await?;
        return Ok(None);
    }
    let mut receipt = match r.platform.as_str() {
        "APNS" => match &providers.apns {
            Some(p) if p.topic() == r.app_id => {
                p.send(
                    &state.http,
                    &token,
                    &decide::apns_payload(&target, reason, &r.locale, badge),
                    ApnsRequest {
                        collapse_key: &target.collapse_key,
                        intent: i.id,
                        expires_at: i.expires_at.timestamp(),
                    },
                    policy,
                )
                .await
            }
            _ => Receipt::local(Outcome::Rejected, policy),
        },
        "FCM" => match &providers.fcm {
            Some(p) => {
                p.send(
                    &state.http,
                    &token,
                    &decide::fcm_message(&target, reason, &r.locale, badge),
                    i.expires_at.timestamp(),
                    policy,
                )
                .await
            }
            _ => Receipt::local(Outcome::Rejected, policy),
        },
        _ => Receipt::local(Outcome::Rejected, policy),
    };
    // Delivered attempt bound and growing delay; honor larger provider Retry-After.
    receipt.retry_after = receipt.retry_after.max(policy.retry_delay(i.attempts));
    Ok(Some(receipt))
}
async fn fresh_reason(
    state: &ServiceState,
    control: &collab_bridge::bridge::IdentityClient,
    tenant: Uuid,
    principal: Uuid,
    message: &MessageFacts,
    policy: &super::config::Policy,
) -> Result<Option<Reason>, sqlx::Error> {
    let principals = [principal];
    let pubkeys = principal_pubkeys(state, tenant, &principals).await?;
    let prefs = load_preferences(state, &principals).await?;
    let channels = load_channels(state, tenant, std::slice::from_ref(message)).await?;
    let members = workspace_members(state, &channels, &principals).await?;
    let Some(channel) = channels.get(&message.channel_id) else {
        return Ok(None);
    };
    if !match channel {
        Channel::Workspace(w) => members.contains(&(*w, principal)),
        Channel::Conversation { participants, .. } => participants.contains(&principal),
    } {
        return Ok(None);
    }
    let empty = BTreeSet::new();
    let keys = pubkeys.get(&principal).unwrap_or(&empty);
    let pref = prefs.get(&principal);
    let mut view = RecipientView::new(keys);
    match channel {
        Channel::Workspace(w) => {
            view.channel_muted = pref.is_some_and(|p| p.muted_workspaces.contains(&w.to_string()))
        }
        Channel::Conversation { id, .. } => {
            view.direct_message = true;
            view.channel_muted =
                pref.is_some_and(|p| p.muted_conversations.contains(&id.to_string()))
        }
    }
    if let Some(root) = &message.root_id {
        view.thread_muted = pref.is_some_and(|p| p.muted_threads.contains(root));
        view.thread_followed = pref.is_some_and(|p| p.followed_threads.contains(root));
        let authors = root_authors(&state.http, control, vec![root.clone()], policy).await
            .map_err(|_| sqlx::Error::Protocol("push root-author lookup unavailable".into()))?;
        view.thread_authored = authors
            .get(root)
            .is_some_and(|author| keys.contains(author));
    }
    Ok(decide::decide(message, &view))
}

async fn load_registrations(
    state: &ServiceState,
    tenant: Uuid,
) -> Result<Vec<Registration>, sqlx::Error> {
    let rows: Vec<RegistrationRow> = sqlx::query_as(
        "select tenant_principal_id, device_pubkey, platform, app_id, locale,
                token_secret_locator, token_secret_version, token_secret_audience, version
           from identity.push_registration
          where tenant_id = $1 and state = 'ACTIVE' and enabled",
    )
    .bind(tenant)
    .fetch_all(&state.pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(
            |(
                principal,
                device,
                platform,
                app_id,
                locale,
                locator,
                version,
                audience,
                registration_version,
            )| {
                Registration {
                    principal,
                    version: registration_version,
                    device,
                    platform,
                    app_id,
                    locale,
                    token: secret_store::SecretRef {
                        locator,
                        version: version as u32,
                        audience,
                    },
                }
            },
        )
        .collect())
}

async fn principal_pubkeys(
    state: &ServiceState,
    tenant: Uuid,
    principals: &[Uuid],
) -> Result<HashMap<Uuid, BTreeSet<String>>, sqlx::Error> {
    let rows: Vec<(Uuid, String)> = sqlx::query_as(
        "select principal_id, pubkey from identity.buzz_identity_binding
          where tenant_id = $1 and principal_id = any($2) and state = 'ACTIVE'",
    )
    .bind(tenant)
    .bind(principals)
    .fetch_all(&state.pool)
    .await?;
    let mut map: HashMap<Uuid, BTreeSet<String>> = HashMap::new();
    for (principal, pubkey) in rows {
        map.entry(principal)
            .or_default()
            .insert(pubkey.to_ascii_lowercase());
    }
    Ok(map)
}

async fn load_preferences(
    state: &ServiceState,
    principals: &[Uuid],
) -> Result<HashMap<Uuid, Preferences>, sqlx::Error> {
    let rows: Vec<(Uuid, Value, Value, Value)> = sqlx::query_as(
        "select tenant_principal_id, workspace_preferences, conversation_preferences, thread_preferences
           from identity.collaboration_user_state where tenant_principal_id = any($1)",
    )
    .bind(principals)
    .fetch_all(&state.pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(p, w, c, t)| (p, preferences(&w, &c, &t)))
        .collect())
}

async fn load_channels(
    state: &ServiceState,
    tenant: Uuid,
    messages: &[MessageFacts],
) -> Result<HashMap<String, Channel>, sqlx::Error> {
    let ids: Vec<Uuid> = messages
        .iter()
        .filter_map(|m| m.channel_id.parse::<Uuid>().ok())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let mut map = HashMap::new();
    let workspaces: Vec<(Uuid, Uuid)> = sqlx::query_as(
        "select b.channel_id, b.workspace_id from projection.workspace_buzz_binding b
           join identity.workspace w on w.id = b.workspace_id
          where w.tenant_id = $1 and w.state = 'ACTIVE' and b.state = 'ACTIVE' and b.channel_id = any($2)",
    )
    .bind(tenant)
    .bind(&ids)
    .fetch_all(&state.pool)
    .await?;
    for (channel, workspace) in workspaces {
        map.insert(channel.to_string(), Channel::Workspace(workspace));
    }
    let conversations: Vec<(Uuid, Uuid, Vec<Uuid>)> = sqlx::query_as(
        "select channel_id, id, participant_principal_ids from projection.conversation_buzz_binding
          where tenant_id = $1 and state = 'ACTIVE' and channel_id = any($2)",
    )
    .bind(tenant)
    .bind(&ids)
    .fetch_all(&state.pool)
    .await?;
    for (channel, id, participants) in conversations {
        map.insert(
            channel.to_string(),
            Channel::Conversation {
                id,
                participants: participants.into_iter().collect(),
            },
        );
    }
    Ok(map)
}

async fn workspace_members(
    state: &ServiceState,
    channels: &HashMap<String, Channel>,
    principals: &[Uuid],
) -> Result<BTreeSet<(Uuid, Uuid)>, sqlx::Error> {
    let workspaces: Vec<Uuid> = channels
        .values()
        .filter_map(|c| match c {
            Channel::Workspace(ws) => Some(*ws),
            Channel::Conversation { .. } => None,
        })
        .collect();
    if workspaces.is_empty() {
        return Ok(BTreeSet::new());
    }
    let rows: Vec<(Uuid, Uuid)> = sqlx::query_as(
        "select workspace_id, tenant_principal_id from identity.workspace_membership
          where workspace_id = any($1) and tenant_principal_id = any($2) and state = 'ACTIVE'",
    )
    .bind(&workspaces)
    .bind(principals)
    .fetch_all(&state.pool)
    .await?;
    Ok(rows.into_iter().collect())
}

async fn relay_query(
    http: &reqwest::Client,
    control: &collab_bridge::bridge::IdentityClient,
    filters: &[Value],
    policy: &super::config::Policy,
) -> Result<Value, ()> {
    tokio::time::timeout(
        Duration::from_secs(policy.relay_read_timeout_seconds as u64),
        control.query(http, filters),
    ).await.map_err(|_| ())?.map_err(|_| ())
}

fn verified_page(value: Value, ids: &[String]) -> Result<Vec<nostr::Event>, ()> {
    let events: Vec<nostr::Event> = serde_json::from_value(value).map_err(|_| ())?;
    let mut seen = BTreeSet::new();
    for event in &events {
        let id = event.id.to_hex();
        if !ids.contains(&id) || !seen.insert(id) || event.verify().is_err() {
            return Err(());
        }
    }
    Ok(events)
}

async fn root_authors(
    http: &reqwest::Client,
    control: &collab_bridge::bridge::IdentityClient,
    roots: Vec<String>,
    policy: &super::config::Policy,
) -> Result<HashMap<String, String>, ()> {
    if roots.is_empty() { return Ok(HashMap::new()); }
    let limit = roots.len();
    let found = relay_query(http, control, &[json!({"ids": roots, "limit": limit})], policy).await?;
    Ok(verified_page(found, &roots)?.into_iter()
        .map(|event| (event.id.to_hex(), event.pubkey.to_hex())).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn root_lookup_verifies_events_and_bounds_unavailable_relay_reads() {
        use axum::{http::StatusCode, response::IntoResponse, Json};
        use std::sync::atomic::{AtomicU8, Ordering};
        let mode = Arc::new(AtomicU8::new(0));
        let author = nostr::Keys::generate();
        let root = nostr::EventBuilder::new(nostr::Kind::Custom(9), "fixture root")
            .sign_with_keys(&author).unwrap();
        let value = serde_json::to_value(&root).unwrap();
        let scripted_mode = mode.clone();
        let router = axum::Router::new().route("/query", axum::routing::post(move || {
            let mode = scripted_mode.clone();
            let mut value = value.clone();
            async move {
                match mode.load(Ordering::SeqCst) {
                    1 => { value["content"] = json!("corrupt signature"); Json(json!([value])).into_response() }
                    2 => { futures_util::future::pending::<()>().await; StatusCode::SERVICE_UNAVAILABLE.into_response() }
                    3 => StatusCode::SERVICE_UNAVAILABLE.into_response(),
                    4 => Json(json!([value.clone(), value])).into_response(),
                    _ => Json(json!([value])).into_response(),
                }
            }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        let control = nostr::Keys::generate();
        let client = collab_bridge::bridge::IdentityClient::new(
            collab_bridge::bridge::Custody::Server, &control.secret_key().to_secret_hex(),
            &url, "push-relay.fixture").unwrap();
        let http = reqwest::Client::builder().no_proxy().build().unwrap();
        let mut policy = super::super::config::Policy::fixture();
        policy.relay_read_timeout_seconds = 1;
        let roots = vec![root.id.to_hex()];
        let actual = root_authors(&http, &client, roots.clone(), &policy).await.unwrap();
        assert_eq!(actual.get(&root.id.to_hex()), Some(&author.public_key().to_hex()));
        for invalid in [1, 3, 4] {
            mode.store(invalid, Ordering::SeqCst);
            assert!(root_authors(&http, &client, roots.clone(), &policy).await.is_err());
        }
        mode.store(2, Ordering::SeqCst);
        let bounded = tokio::time::timeout(Duration::from_secs(3), root_authors(&http, &client, roots, &policy)).await;
        server.abort();
        assert!(bounded.expect("the consumer must stop on the delivered read deadline").is_err());
    }

    #[test]
    fn preferences_read_mutes_and_thread_states() {
        let p = preferences(
            &json!({"7f0d1c3e-2b4a-4c5d-8e9f-0a1b2c3d4e5f": {"starred": true, "muted": true}, "x": {"muted": false}}),
            &json!({"6f0d1c3e-2b4a-4c5d-8e9f-0a1b2c3d4e5f": {"muted": true}}),
            &json!({"thread:AB": {"state": "FOLLOWED"}, "thread:cd": {"state": "MUTED"}, "msg:ee": {"state": "FOLLOWED"}}),
        );
        assert!(p
            .muted_workspaces
            .contains("7f0d1c3e-2b4a-4c5d-8e9f-0a1b2c3d4e5f"));
        assert!(!p.muted_workspaces.contains("x"));
        assert!(p
            .muted_conversations
            .contains("6f0d1c3e-2b4a-4c5d-8e9f-0a1b2c3d4e5f"));
        assert_eq!(p.followed_threads, BTreeSet::from(["ab".to_owned()]));
        assert_eq!(p.muted_threads, BTreeSet::from(["cd".to_owned()]));
    }
}
