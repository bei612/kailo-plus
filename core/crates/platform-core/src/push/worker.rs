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
    self, ApnsCredential, ApnsSender, DeviceToken, FcmCredential, FcmSender, Outcome, Receipt,
};
use super::CredentialRefs;
use crate::audit::{AuditEntry, Evidence};
use crate::service_api::ServiceState;
use crate::tenant_lifecycle::{control_client, ProjectionDirection};

/// Relay page per Tenant and tick.
const PAGE: usize = 500;

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
            if let Err(e) = sweep(&state).await {
                tracing::warn!(error = %e, "推送登记撤销收敛失败");
            }
            match state.pool.acquire().await {
                Ok(mut conn) => if let Err(e)=super::intent::recover(&mut conn).await {
                    tracing::warn!(error=%e,"推送发送检查点恢复失败");
                },
                Err(e)=>{tracing::warn!(error=%e,"推送数据库连接失败");continue},
            }
            let checkpoints:Result<Vec<(String,i64)>,_>=sqlx::query_as("select state,count(*) from projection.push_send_intent group by state").fetch_all(&state.pool).await;
            if let Ok(rows)=checkpoints {
                for status in ["PREPARED","CLAIMED","SENDING","RETRY","UNKNOWN"] {
                    let count=rows.iter().find(|(s,_)|s==status).map_or(0,|(_,n)|*n);
                    metrics.checkpoints.record(count.max(0) as u64,&[KeyValue::new("state",status)]);
                }
            }
            providers.refresh(&state).await;
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
                match run_tenant(&state, &providers, &metrics, tenant).await {
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
pub(crate) async fn sweep(state:&ServiceState) -> Result<(),sqlx::Error> {
    let mut tx=state.pool.begin().await?;
    let rows:Vec<(Uuid,String,Uuid,Option<String>)>=sqlx::query_as("select r.tenant_id,r.device_pubkey,r.tenant_principal_id,r.token_secret_locator
        from identity.push_registration r where r.state<>'REVOKED' and (
        exists(select 1 from identity.tenant t where t.id=r.tenant_id and t.state in ('DELETING','DELETED')) or
        not exists(select 1 from identity.buzz_identity_binding b where b.tenant_id=r.tenant_id and b.principal_id=r.tenant_principal_id and b.pubkey=r.device_pubkey and b.custody='CLIENT' and b.state='ACTIVE') or
        not exists(select 1 from identity.tenant_membership m where m.tenant_id=r.tenant_id and m.tenant_principal_id=r.tenant_principal_id and m.state='ACTIVE'))
        order by r.tenant_id,r.device_pubkey for update of r skip locked limit 100")
        .fetch_all(&mut *tx).await?;
    for (tenant,device,principal,locator) in rows {
        if let Some(locator)=locator { super::token_intent::retire(&mut tx,&locator).await?; }
        sqlx::query("update identity.push_registration set state='REVOKED',enabled=false,token_digest=null,token_secret_locator=null,token_secret_version=null,token_secret_audience=null,version=version+1,updated_at=now() where tenant_id=$1 and device_pubkey=$2")
            .bind(tenant).bind(&device).execute(&mut *tx).await?;
        let operation=Uuid::new_v4();
        crate::audit::append(&mut tx,AuditEntry {
            event_key:format!("push-registration-revoked:{tenant}:{device}:{operation}"),tenant_id:Some(tenant),workspace_id:None,
            operation_id:operation,event_type:"REVOCATION",human_identity_id:None,initiator_principal_id:None,actor_principal_id:None,
            action_key:"push.registration.revoke",action_version:1,component_type_key:"core",target_type:Some("PRINCIPAL"),target_id:Some(principal),
            parameter_hash:"NONE",decision:"ALLOW",result_code:"PUSH_REVOKED",result_exposure:"NONE",evidence_refs:Vec::<Evidence>::new(),correlation_id:operation,
        }).await?;
    }
    tx.commit().await?;
    super::token_intent::sweep(state).await
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

type RegistrationRow = (Uuid, String, String, String, String, String, i32, String, i32);

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
async fn run_tenant(state:&ServiceState, providers:&Providers, metrics:&Metrics, tenant:Uuid) -> Result<bool,sqlx::Error> {
    if let Err(e)=scan(state,providers,tenant).await {
        tracing::warn!(error=%e,%tenant,"推送扫描检查点失败");
    }
    let mut auth_failed=false;
    for _ in 0..100 {
        let Some(intent)=super::intent::claim(&state.pool,tenant).await? else { break };
        if let Some(receipt)=dispatch(state,providers,&intent).await? {
            // A local commit failure must not repeat the external request. Retry only the
            // known receipt; a process crash leaves SENDING for UNKNOWN recovery.
            let mut persisted=false;
            for _ in 0..3 {
                match super::intent::finish(&state.pool,&intent,&receipt).await {
                    Ok(_) => { persisted=true; break },
                    Err(e) => tracing::warn!(error=%e,intent_id=%intent.id,"推送回执检查点写入失败"),
                }
            }
            if !persisted { tracing::warn!(intent_id=%intent.id,"推送回执待UNKNOWN恢复，未再次发送"); }
            metrics.deliveries.add(1,&[KeyValue::new("platform",intent.platform.clone()),KeyValue::new("outcome",format!("{:?}",receipt.outcome))]);
            auth_failed |= receipt.outcome==Outcome::ProviderAuth;
        }
    }
    Ok(auth_failed)
}
fn provider_target(providers:&Providers, platform:&str) -> Option<String> {
    match platform { "APNS"=>providers.apns.as_ref().map(|p|p.target()),
        "FCM"=>providers.fcm.as_ref().map(|p|p.target()), _=>None }
}
async fn scan(state:&ServiceState,providers:&Providers,tenant:Uuid) -> Result<(),sqlx::Error> {
    // Start at now, never fan out history when a Tenant first enables push.
    sqlx::query("insert into projection.push_cursor(tenant_id,since) values($1,extract(epoch from now())::bigint) on conflict do nothing")
        .bind(tenant).execute(&state.pool).await?;
    let lease=Uuid::new_v4();
    let cursor:Option<(i64,Vec<String>)>=sqlx::query_as("update projection.push_cursor set lease_id=$2,lease_until=now()+interval '60 seconds'
        where tenant_id=$1 and (lease_until is null or lease_until<=now()) returning since,seen_ids")
        .bind(tenant).bind(lease).fetch_optional(&state.pool).await?;
    let Some((since,seen))=cursor else { return Ok(()) };
    // Every following await is outside a transaction; a crashed scanner loses its lease.
    let Ok((control,_))=control_client(state,tenant,ProjectionDirection::Establish).await else { return Ok(()) };
    let Ok(found)=control.query(&state.http,&[json!({"kinds":decide::MESSAGE_KINDS,"since":since,"limit":PAGE})]).await else { return Ok(()) };
    let seen:BTreeSet<String>=seen.into_iter().collect();
    let mut messages:Vec<MessageFacts>=found.as_array().into_iter().flatten().filter_map(MessageFacts::from_event)
        .filter(|m| !(m.created_at as i64==since && seen.contains(&m.id))).collect();
    messages.sort_by(|a,b|(a.created_at,&a.id).cmp(&(b.created_at,&b.id)));
    messages.dedup_by(|a,b|a.id==b.id);
    for message in &messages {
        let mut tx=state.pool.begin().await?;
        let owned=sqlx::query("update projection.push_cursor set lease_until=now()+interval '60 seconds' where tenant_id=$1 and lease_id=$2 and lease_until>now()")
            .bind(tenant).bind(lease).execute(&mut *tx).await?.rows_affected();
        if owned!=1 { return Ok(()) }
        for platform in ["APNS","FCM"] {
            let Some(provider)=provider_target(providers,platform) else {continue};
            // The immutable Relay IDs are only dispatch references. Current authorization,
            // preferences and message facts are reread before every provider attempt.
            sqlx::query("insert into projection.push_send_intent(id,tenant_id,tenant_principal_id,device_pubkey,registration_version,platform,provider_target,event_id,channel_id,root_id,event_created_at,expires_at)
                select gen_random_uuid(),r.tenant_id,r.tenant_principal_id,r.device_pubkey,r.version,r.platform,$3,$4,$5,$6,$7,
                to_timestamp($7)+interval '1 hour' from identity.push_registration r join identity.tenant t on t.id=r.tenant_id
                where r.tenant_id=$1 and r.platform=$2 and r.state='ACTIVE' and r.enabled and t.state='ACTIVE'
                and to_timestamp($7)+interval '1 hour'>now() on conflict(tenant_id,device_pubkey,event_id) do nothing")
                .bind(tenant).bind(platform).bind(provider).bind(&message.id).bind(&message.channel_id)
                .bind(&message.root_id).bind(message.created_at as i64).execute(&mut *tx).await?;
        }
        tx.commit().await?;
    }
    let newest=messages.last().map_or(since,|m|m.created_at as i64);
    let mut at_newest:Vec<String>=messages.iter().filter(|m|m.created_at as i64==newest).map(|m|m.id.clone()).collect();
    if newest==since {at_newest.extend(seen)}
    sqlx::query("update projection.push_cursor set since=$3,seen_ids=$4,lease_until=null,lease_id=null,updated_at=now()
        where tenant_id=$1 and lease_id=$2 and lease_until>now()")
        .bind(tenant).bind(lease).bind(newest).bind(at_newest).execute(&state.pool).await?;
    Ok(())
}

async fn dispatch(state:&ServiceState,providers:&Providers,i:&super::intent::Intent) -> Result<Option<Receipt>,sqlx::Error> {
    let folded:bool=sqlx::query_scalar("select exists(select 1 from projection.push_send_intent where tenant_id=$1 and device_pubkey=$2 and channel_id=$3 and root_id is not distinct from $4 and state in ('PREPARED','CLAIMED','RETRY') and (event_created_at,event_id)>($5,$6))")
        .bind(i.tenant_id).bind(&i.device_pubkey).bind(&i.channel_id).bind(&i.root_id).bind(i.event_created_at).bind(&i.event_id).fetch_one(&state.pool).await?;
    if folded {super::intent::cancel(&state.pool,i,"COLLAPSED").await?;return Ok(None)}
    let registration=load_registrations(state,i.tenant_id).await?.into_iter()
        .find(|r|r.device==i.device_pubkey && r.principal==i.tenant_principal_id && r.version==i.registration_version);
    let Some(r)=registration else { super::intent::cancel(&state.pool,i,"REGISTRATION_CHANGED").await?; return Ok(None) };
    let Some(provider)=provider_target(providers,&r.platform) else {super::intent::defer(&state.pool,i).await?; return Ok(None)};
    if provider!=i.provider_target {super::intent::cancel(&state.pool,i,"PROVIDER_TARGET_CHANGED").await?; return Ok(None)}
    let Ok((control,_))=control_client(state,i.tenant_id,ProjectionDirection::Establish).await else {super::intent::defer(&state.pool,i).await?;return Ok(None)};
    let Ok(found)=control.query(&state.http,&[json!({"ids":[i.event_id],"limit":1})]).await else {super::intent::defer(&state.pool,i).await?;return Ok(None)};
    let message=found.as_array().into_iter().flatten().filter_map(MessageFacts::from_event).find(|m|m.id==i.event_id);
    let Some(message)=message else {super::intent::cancel(&state.pool,i,"EVENT_ABSENT").await?;return Ok(None)};
    let Some(reason)=fresh_reason(state,&control,i.tenant_id,r.principal,&message).await? else {super::intent::cancel(&state.pool,i,"NOT_ELIGIBLE").await?;return Ok(None)};
    let positions:Option<Value>=sqlx::query_scalar("select read_contexts from identity.collaboration_user_state where tenant_principal_id=$1")
        .bind(r.principal).fetch_optional(&state.pool).await?;
    let marks=positions.map_or_else(HashMap::new,|r|decide::read_marks(&r));
    if message.created_at as i64<=decide::read_position(&decide::unread_context(&message),&message.channel_id,&marks) {
        super::intent::cancel(&state.pool,i,"ALREADY_READ").await?;return Ok(None)
    }
    let badge=super::unread::preview(&mut *state.pool.acquire().await?,i.tenant_id,r.principal,&message,&marks).await?;
    let token=match state.secrets.read(&r.token,"value").await {Ok(v)=>DeviceToken(v.expose().to_owned()),Err(_)=>{super::intent::defer(&state.pool,i).await?;return Ok(None)}};
    let target=decide::target(&i.tenant_id.to_string(),&message);
    if !super::intent::begin_send(&state.pool,i,&target.collapse_key).await? {
        // Includes per-device rate pressure; retry the local preflight, never a sent request.
        super::intent::defer(&state.pool,i).await?; return Ok(None)
    }
    let mut receipt=match r.platform.as_str() {
        "APNS"=>match &providers.apns {Some(p) if p.topic()==r.app_id=>p.send(&state.http,&token,&decide::apns_payload(&target,reason,&r.locale,badge),&target.collapse_key,i.id,i.expires_at.timestamp()).await,
            _=>Receipt::local(Outcome::Rejected)},
        "FCM"=>match &providers.fcm {Some(p)=>p.send(&state.http,&token,&decide::fcm_message(&target,reason,&r.locale,badge),i.expires_at.timestamp()).await,_=>Receipt::local(Outcome::Rejected)},
        _=>Receipt::local(Outcome::Rejected),
    };
    // At most three sends, growing delay, honor the provider's larger Retry-After.
    receipt.retry_after=receipt.retry_after.max(Duration::from_secs(60*(1u64<<i.attempts)));
    Ok(Some(receipt))
}
async fn fresh_reason(state:&ServiceState,control:&collab_bridge::bridge::IdentityClient,tenant:Uuid,principal:Uuid,message:&MessageFacts) -> Result<Option<Reason>,sqlx::Error> {
    let principals=[principal];
    let pubkeys=principal_pubkeys(state,tenant,&principals).await?;
    let prefs=load_preferences(state,&principals).await?;
    let channels=load_channels(state,tenant,std::slice::from_ref(message)).await?;
    let members=workspace_members(state,&channels,&principals).await?;
    let Some(channel)=channels.get(&message.channel_id) else {return Ok(None)};
    if !match channel {Channel::Workspace(w)=>members.contains(&(*w,principal)),Channel::Conversation{participants,..}=>participants.contains(&principal)} {return Ok(None)}
    let empty=BTreeSet::new(); let keys=pubkeys.get(&principal).unwrap_or(&empty); let pref=prefs.get(&principal);
    let mut view=RecipientView::new(keys);
    match channel {
        Channel::Workspace(w)=>view.channel_muted=pref.is_some_and(|p|p.muted_workspaces.contains(&w.to_string())),
        Channel::Conversation{id,..}=>{view.direct_message=true;view.channel_muted=pref.is_some_and(|p|p.muted_conversations.contains(&id.to_string()))},
    }
    if let Some(root)=&message.root_id {
        view.thread_muted=pref.is_some_and(|p|p.muted_threads.contains(root));
        view.thread_followed=pref.is_some_and(|p|p.followed_threads.contains(root));
        let authors=root_authors(state,control,vec![root.clone()]).await;
        view.thread_authored=authors.get(root).is_some_and(|author|keys.contains(author));
    }
    Ok(decide::decide(message,&view))
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
            |(principal, device, platform, app_id, locale, locator, version, audience, registration_version)| {
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
