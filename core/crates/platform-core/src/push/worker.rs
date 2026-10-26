//! DD-151(3)(5): the push worker inside Core.
//!
//! Every tick it (1) revokes registrations whose device key or membership is gone and retires
//! their tokens, then (2) for each Tenant with deliverable registrations reads the new channel
//! messages from the Tenant's Relay as CONTROL, decides recipients with `decide`, re-checks
//! each recipient's channel eligibility, and delivers one content-free notification per
//! device under collapse and rate limits. A transaction-scoped advisory lock per Tenant keeps
//! several Core replicas from pushing the same message twice.

use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;
use std::time::{Duration, Instant};

use opentelemetry::metrics::{Counter, Meter};
use opentelemetry::KeyValue;
use serde_json::{json, Value};
use uuid::Uuid;

use super::decide::{self, MessageFacts, Reason, RecipientView, Target};
use super::send::{
    self, ApnsCredential, ApnsSender, DeviceToken, FcmCredential, FcmSender, Outcome,
};
use super::CredentialRefs;
use crate::audit::{AuditEntry, Evidence};
use crate::service_api::ServiceState;
use crate::tenant_lifecycle::{control_client, ProjectionDirection};

/// Relay page per Tenant and tick.
const PAGE: usize = 500;
/// One visible notification per device and conversation/thread at most this often.
const COLLAPSE_WINDOW: Duration = Duration::from_secs(30);
/// Device-wide cap per minute.
const DEVICE_PER_MINUTE: i32 = 20;

pub struct Config {
    pub interval: Duration,
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let seconds = match std::env::var("PUSH_POLL_SECONDS") {
            Ok(v) => v.parse::<u64>().map_err(|_| "PUSH_POLL_SECONDS 不是整数")?,
            Err(_) => 5,
        };
        if !(1..=300).contains(&seconds) {
            return Err("PUSH_POLL_SECONDS 须在 1..=300".into());
        }
        Ok(Self {
            interval: Duration::from_secs(seconds),
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
    async fn refresh(&mut self, state: &ServiceState) {
        if self
            .loaded
            .is_some_and(|at| at.elapsed() < send::CREDENTIAL_TTL)
        {
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
}

pub fn spawn(state: ServiceState, meter: &Meter, cfg: Config) {
    let metrics = Metrics {
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
            if let Err(e) = sweep(&state).await {
                tracing::warn!(error = %e, "推送登记撤销收敛失败");
            }
            providers.refresh(&state).await;
            if !providers.any() {
                continue;
            }
            let tenants: Vec<(Uuid,)> = match sqlx::query_as(
                "select distinct tenant_id from identity.push_registration
                  where state = 'ACTIVE' and enabled",
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
                match run_tenant(&state, &providers, &metrics, tenant).await {
                    Ok(true) => providers.invalidate(),
                    Ok(false) => {}
                    Err(e) => tracing::warn!(error = %e, %tenant, "推送本轮失败"),
                }
            }
        }
    });
}

type SweepRow = (
    Uuid,
    String,
    Uuid,
    Option<String>,
    Option<i32>,
    Option<String>,
);

/// DD-151(1): a registration whose device key is no longer an ACTIVE CLIENT key of its owner,
/// or whose owner is no longer an ACTIVE member, is REVOKED and its token version destroyed.
pub(crate) async fn sweep(state: &ServiceState) -> Result<(), sqlx::Error> {
    let rows: Vec<SweepRow> = sqlx::query_as(
        "select r.tenant_id, r.device_pubkey, r.tenant_principal_id,
                r.token_secret_locator, r.token_secret_version, r.token_secret_audience
           from identity.push_registration r
          where r.state <> 'REVOKED'
            and (not exists (select 1 from identity.buzz_identity_binding b
                              where b.tenant_id = r.tenant_id and b.principal_id = r.tenant_principal_id
                                and b.pubkey = r.device_pubkey and b.custody = 'CLIENT'
                                and b.state = 'ACTIVE')
                 or not exists (select 1 from identity.tenant_membership m
                                 where m.tenant_id = r.tenant_id
                                   and m.tenant_principal_id = r.tenant_principal_id
                                   and m.state = 'ACTIVE'))
          limit 100",
    )
    .fetch_all(&state.pool)
    .await?;
    for (tenant, device, principal, locator, version, audience) in rows {
        if let (Some(locator), Some(version), Some(audience)) = (locator, version, audience) {
            let reference = secret_store::SecretRef {
                locator,
                version: version as u32,
                audience,
            };
            if let Err(e) = state
                .secrets
                .retire_push_token(tenant, &reference, false)
                .await
            {
                tracing::warn!(error = ?e, %tenant, "撤销推送登记时销毁令牌失败，下一轮重试");
                continue;
            }
        }
        let mut tx = state.pool.begin().await?;
        let changed = sqlx::query(
            "update identity.push_registration
                set state = 'REVOKED', enabled = false, token_digest = null,
                    token_secret_locator = null, token_secret_version = null,
                    token_secret_audience = null, version = version + 1, updated_at = now()
              where tenant_id = $1 and device_pubkey = $2 and state <> 'REVOKED'",
        )
        .bind(tenant)
        .bind(&device)
        .execute(&mut *tx)
        .await?
        .rows_affected();
        if changed == 1 {
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
    }
    Ok(())
}

#[derive(Clone)]
struct Registration {
    principal: Uuid,
    device: String,
    platform: String,
    app_id: String,
    locale: String,
    token: secret_store::SecretRef,
}

type RegistrationRow = (Uuid, String, String, String, String, String, i32, String);

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

/// One Tenant pass. Returns `true` when a provider refused our credential.
async fn run_tenant(
    state: &ServiceState,
    providers: &Providers,
    metrics: &Metrics,
    tenant: Uuid,
) -> Result<bool, sqlx::Error> {
    let mut tx = state.pool.begin().await?;
    let (locked,): (bool,) = sqlx::query_as(
        "select pg_try_advisory_xact_lock(hashtextextended('kailo.push:' || $1::text, 0))",
    )
    .bind(tenant)
    .fetch_one(&mut *tx)
    .await?;
    if !locked {
        return Ok(false);
    }
    let cursor: Option<(i64, Vec<String>)> =
        sqlx::query_as("select since, seen_ids from projection.push_cursor where tenant_id = $1")
            .bind(tenant)
            .fetch_optional(&mut *tx)
            .await?;
    let Some((since, seen)) = cursor else {
        // History is never pushed: a Tenant starts at "now".
        sqlx::query(
            "insert into projection.push_cursor (tenant_id, since)
             values ($1, extract(epoch from now())::bigint) on conflict do nothing",
        )
        .bind(tenant)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        return Ok(false);
    };
    let Ok((control, _)) = control_client(state, tenant, ProjectionDirection::Establish).await
    else {
        return Ok(false);
    };
    let filter = json!({"kinds": decide::MESSAGE_KINDS, "since": since, "limit": PAGE});
    let Ok(found) = control.query(&state.http, &[filter]).await else {
        return Ok(false);
    };
    let seen: BTreeSet<String> = seen.into_iter().collect();
    let mut messages: Vec<MessageFacts> = found
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(MessageFacts::from_event)
        .filter(|m| !(m.created_at as i64 == since && seen.contains(&m.id)))
        .collect();
    messages.sort_by(|a, b| (a.created_at, &a.id).cmp(&(b.created_at, &b.id)));
    messages.dedup_by(|a, b| a.id == b.id);
    if messages.is_empty() {
        return Ok(false);
    }

    let registrations = load_registrations(state, tenant).await?;
    let principals: Vec<Uuid> = registrations
        .iter()
        .map(|r| r.principal)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let pubkeys = principal_pubkeys(state, tenant, &principals).await?;
    let prefs = load_preferences(state, &principals).await?;
    let channels = load_channels(state, tenant, &messages).await?;
    let members = workspace_members(state, &channels, &principals).await?;
    let roots: Vec<String> = messages
        .iter()
        .filter_map(|m| m.root_id.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let root_authors = if roots.is_empty() {
        HashMap::new()
    } else {
        root_authors(state, &control, roots).await
    };

    let empty = BTreeSet::new();
    let mut tokens: HashMap<String, DeviceToken> = HashMap::new();
    let mut auth_failed = false;
    let tenant_text = tenant.to_string();
    for message in &messages {
        let Some(channel) = channels.get(&message.channel_id) else {
            continue;
        };
        for principal in &principals {
            let eligible = match channel {
                Channel::Workspace(ws) => members.contains(&(*ws, *principal)),
                Channel::Conversation { participants, .. } => participants.contains(principal),
            };
            if !eligible {
                continue;
            }
            let keys = pubkeys.get(principal).unwrap_or(&empty);
            let pref = prefs.get(principal);
            let mut view = RecipientView::new(keys);
            match channel {
                Channel::Workspace(ws) => {
                    view.channel_muted =
                        pref.is_some_and(|p| p.muted_workspaces.contains(&ws.to_string()));
                }
                Channel::Conversation { id, .. } => {
                    view.direct_message = true;
                    view.channel_muted =
                        pref.is_some_and(|p| p.muted_conversations.contains(&id.to_string()));
                }
            }
            if let Some(root) = &message.root_id {
                view.thread_muted = pref.is_some_and(|p| p.muted_threads.contains(root));
                view.thread_followed = pref.is_some_and(|p| p.followed_threads.contains(root));
                view.thread_authored = root_authors
                    .get(root)
                    .is_some_and(|author| keys.contains(author));
            }
            let Some(reason) = decide::decide(message, &view) else {
                continue;
            };
            let target = decide::target(&tenant_text, message);
            // Read positions may have changed while earlier provider calls were in flight.
            let positions: Option<(Value,)> = sqlx::query_as(
                "select read_contexts from identity.collaboration_user_state where tenant_principal_id = $1",
            )
            .bind(principal)
            .fetch_optional(&state.pool)
            .await?;
            let marks = positions.map_or_else(HashMap::new, |(r,)| decide::read_marks(&r));
            if message.created_at as i64
                <= decide::read_position(
                    &decide::unread_context(message),
                    &message.channel_id,
                    &marks,
                )
            {
                continue;
            }
            // Preview is read-only: no pending send belongs to the accepted-message set,
            // and no additional transaction/row lock spans the provider's HTTP calls.
            let badge = super::unread::preview(
                &mut *state.pool.acquire().await?,
                tenant,
                *principal,
                message,
                &marks,
            )
            .await?;
            let mut recorded = false;
            for registration in registrations.iter().filter(|r| r.principal == *principal) {
                let outcome = deliver(
                    state,
                    providers,
                    tenant,
                    registration,
                    Notice {
                        target: &target,
                        reason,
                        badge,
                    },
                    &mut tokens,
                )
                .await?;
                if let Some(outcome) = outcome {
                    if outcome == Outcome::Delivered {
                        if !recorded {
                            let mut unread_tx = state.pool.begin().await?;
                            super::unread::record(
                                &mut unread_tx,
                                tenant,
                                *principal,
                                message,
                                &marks,
                            )
                            .await?;
                            unread_tx.commit().await?;
                            recorded = true;
                        }
                        record_delivery(state, tenant, registration, &target).await?;
                    }
                    metrics.deliveries.add(
                        1,
                        &[
                            KeyValue::new("platform", registration.platform.clone()),
                            KeyValue::new("outcome", format!("{outcome:?}")),
                        ],
                    );
                    auth_failed |= outcome == Outcome::ProviderAuth;
                }
            }
        }
    }

    let newest = messages.last().map_or(since as u64, |m| m.created_at) as i64;
    let mut at_newest: Vec<String> = messages
        .iter()
        .filter(|m| m.created_at as i64 == newest)
        .map(|m| m.id.clone())
        .collect();
    if newest == since {
        at_newest.extend(seen);
    }
    sqlx::query(
        "update projection.push_cursor set since = $2, seen_ids = $3, updated_at = now()
          where tenant_id = $1",
    )
    .bind(tenant)
    .bind(newest)
    .bind(&at_newest)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(auth_failed)
}

async fn load_registrations(
    state: &ServiceState,
    tenant: Uuid,
) -> Result<Vec<Registration>, sqlx::Error> {
    let rows: Vec<RegistrationRow> = sqlx::query_as(
        "select tenant_principal_id, device_pubkey, platform, app_id, locale,
                token_secret_locator, token_secret_version, token_secret_audience
           from identity.push_registration
          where tenant_id = $1 and state = 'ACTIVE' and enabled",
    )
    .bind(tenant)
    .fetch_all(&state.pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(
            |(principal, device, platform, app_id, locale, locator, version, audience)| {
                Registration {
                    principal,
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
          where w.tenant_id = $1 and w.state = 'ACTIVE' and b.channel_id = any($2)",
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

async fn root_authors(
    state: &ServiceState,
    control: &collab_bridge::bridge::IdentityClient,
    roots: Vec<String>,
) -> HashMap<String, String> {
    let limit = roots.len();
    let Ok(found) = control
        .query(&state.http, &[json!({"ids": roots, "limit": limit})])
        .await
    else {
        return HashMap::new();
    };
    found
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|e| {
            Some((
                e.get("id")?.as_str()?.to_ascii_lowercase(),
                e.get("pubkey")?.as_str()?.to_ascii_lowercase(),
            ))
        })
        .collect()
}

/// What one delivery says: ids, the fixed-text reason and the unread badge.
#[derive(Clone, Copy)]
struct Notice<'a> {
    target: &'a Target,
    reason: Reason,
    badge: u32,
}

/// Rate limits, token read and the bounded provider retry for one device. `None` when the
/// notification was folded into a recent one or the provider is not configured.
async fn deliver(
    state: &ServiceState,
    providers: &Providers,
    tenant: Uuid,
    registration: &Registration,
    notice: Notice<'_>,
    tokens: &mut HashMap<String, DeviceToken>,
) -> Result<Option<Outcome>, sqlx::Error> {
    let Notice {
        target,
        reason,
        badge,
    } = notice;
    let allowed: Option<(bool,)> = sqlx::query_as(
        "select (select coalesce(bool_and(last_sent_at < now() - make_interval(secs => $4)), true)
                   from projection.push_delivery_window
                  where tenant_id = $1 and device_pubkey = $2 and collapse_key = $3)
            and (select coalesce(bool_and(window_start < now() - interval '1 minute' or window_count < $5), true)
                   from projection.push_delivery_window
                  where tenant_id = $1 and device_pubkey = $2 and collapse_key = '*')",
    )
    .bind(tenant)
    .bind(&registration.device)
    .bind(&target.collapse_key)
    .bind(COLLAPSE_WINDOW.as_secs_f64())
    .bind(DEVICE_PER_MINUTE)
    .fetch_optional(&state.pool)
    .await?;
    if allowed.map(|(a,)| a) != Some(true) {
        return Ok(None);
    }
    let token = match tokens.get(&registration.token.locator) {
        Some(t) => t.clone(),
        None => match state.secrets.read(&registration.token, "value").await {
            Ok(v) => {
                let t = DeviceToken(v.expose().to_owned());
                tokens.insert(registration.token.locator.clone(), t.clone());
                t
            }
            Err(_) => return Ok(Some(Outcome::Retry)),
        },
    };
    let mut outcome = Outcome::Retry;
    for attempt in 0..=send::RETRY_PAUSES.len() {
        outcome = match registration.platform.as_str() {
            "APNS" => match &providers.apns {
                // The device registered for another app than the configured topic.
                Some(apns) if apns.topic() == registration.app_id => {
                    apns.send(
                        &state.http,
                        &token,
                        &decide::apns_payload(target, reason, &registration.locale, badge),
                        &target.collapse_key,
                    )
                    .await
                }
                Some(_) => Outcome::Rejected,
                None => return Ok(None),
            },
            "FCM" => match &providers.fcm {
                Some(fcm) => {
                    fcm.send(
                        &state.http,
                        &token,
                        &decide::fcm_message(target, reason, &registration.locale, badge),
                    )
                    .await
                }
                None => return Ok(None),
            },
            _ => Outcome::Rejected,
        };
        if outcome != Outcome::Retry {
            break;
        }
        if let Some(pause) = send::RETRY_PAUSES.get(attempt) {
            tokio::time::sleep(*pause).await;
        }
    }
    match outcome {
        Outcome::Delivered => {}
        Outcome::Invalid => {
            // The provider says the token is gone: stop until the device registers again.
            sqlx::query(
                "update identity.push_registration set state = 'INVALID', version = version + 1,
                        updated_at = now()
                  where tenant_id = $1 and device_pubkey = $2 and state = 'ACTIVE'",
            )
            .bind(tenant)
            .bind(&registration.device)
            .execute(&state.pool)
            .await?;
            tokens.remove(&registration.token.locator);
        }
        Outcome::Retry | Outcome::ProviderAuth | Outcome::Rejected => {}
    }
    Ok(Some(outcome))
}

// Record rate limits after the caller has retained the known accepted message. A failure
// here must not roll that message back out of the badge projection.
async fn record_delivery(
    state: &ServiceState,
    tenant: Uuid,
    registration: &Registration,
    target: &Target,
) -> Result<(), sqlx::Error> {
    sqlx::query(
                "insert into projection.push_delivery_window
                     (tenant_id, device_pubkey, collapse_key, last_sent_at, window_start, window_count)
                 values ($1, $2, $3, now(), now(), 1), ($1, $2, '*', now(), now(), 1)
                 on conflict (tenant_id, device_pubkey, collapse_key) do update set
                     last_sent_at = now(),
                     window_start = case when push_delivery_window.window_start < now() - interval '1 minute'
                                         then now() else push_delivery_window.window_start end,
                     window_count = case when push_delivery_window.window_start < now() - interval '1 minute'
                                         then 1 else push_delivery_window.window_count + 1 end",
            )
            .bind(tenant)
            .bind(&registration.device)
            .bind(&target.collapse_key)
            .execute(&state.pool)
            .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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
