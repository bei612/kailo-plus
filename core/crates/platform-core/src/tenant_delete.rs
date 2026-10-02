//! DD-43/91/99/109：Worker 只推进准入已冻结的 TenantLifecycleSnapshot。
//! 外部事实留在 provider；Core 持久保存不可逆派发、稳定引用及缺席证据。

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use contracts::{EvidenceKind, TenantDeleteAdvanceRequest, TenantDeleteAdvanceResult};
use secret_store::{PlatformKey, SecretStore};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use crate::audit::{self, AuditEntry, Evidence};
use crate::service_api::{audit_gate, authorize, unavailable, ServiceState};

#[derive(Clone)]
pub struct DeletionTransport {
    origin: String,
    http: reqwest::Client,
}

impl DeletionTransport {
    pub fn from_env() -> Result<Option<Self>, Box<dyn std::error::Error>> {
        let origin = match std::env::var("BUZZ_DELETION_API_URL") {
            Err(std::env::VarError::NotPresent) => return Ok(None),
            other => other?,
        };
        let url = reqwest::Url::parse(&origin)?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.path() != "/"
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err("BUZZ_DELETION_API_URL 必须是无凭据与路径的 HTTP(S) origin".into());
        }
        let seconds: u64 = std::env::var("BUZZ_DELETION_HTTP_TIMEOUT_SECONDS")?.parse()?;
        if seconds == 0 {
            return Err("BUZZ_DELETION_HTTP_TIMEOUT_SECONDS 必须为正整数".into());
        }
        Ok(Some(Self {
            origin,
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(seconds))
                .build()?,
        }))
    }
}

/// 复用准入与实际派发的同一检查。旧 platform locator 不由 Tenant namespace
/// 删除覆盖；尚未收敛的密钥写者也不能与 namespace 销毁并发。
pub(crate) async fn secrets_ready(
    secrets: &SecretStore,
    conn: &mut sqlx::PgConnection,
    tenant: Uuid,
) -> Result<bool, sqlx::Error> {
    let pending: bool = sqlx::query_scalar(
        "select exists(select 1 from admission.server_key_provision_intent
                       where tenant_id = $1 and ((finished_at is null and destroyed_at is null)
                           or (fenced_at is not null and destroyed_at is null)))
             or exists(select 1 from admission.secret_ref_rehome
                       where tenant_id = $1 and state not in ('RETIRED','FAILED'))",
    )
    .bind(tenant)
    .fetch_one(&mut *conn)
    .await?;
    if pending {
        return Ok(false);
    }
    let refs: Vec<(String, String, String, Option<i32>)> = sqlx::query_as(
        "select kind,state,private_key_secret_ref,private_key_secret_version
         from identity.buzz_identity_binding where tenant_id = $1 and custody = 'SERVER'",
    )
    .bind(tenant)
    .fetch_all(&mut *conn)
    .await?;
    for (kind, state, locator, version) in refs {
        let owns = match kind.as_str() {
            "HUMAN" => secrets.owns_platform_key(PlatformKey::Human, tenant, &locator),
            "CONTROL" => secrets.owns_platform_key(PlatformKey::Control, tenant, &locator),
            _ => false,
        };
        if owns {
            continue;
        }
        // REVOKED 只证明不能再签名，不证明 platform 旧版本已销毁。仅接受同一
        // locator/version 的既有退休或销毁终态；缺证据仍拒绝，不能借 namespace 删除冒充。
        if state != "REVOKED" || !secrets.is_legacy_identity_locator(tenant, &locator) {
            return Ok(false);
        }
        let retired: bool = sqlx::query_scalar(
            "select exists(select 1 from admission.secret_ref_rehome
                           where tenant_id = $1 and old_locator = $2 and old_version = $3
                             and state = 'RETIRED' and old_ref_status = 'REVOKED')
                 or exists(select 1 from admission.server_key_provision_intent
                           where tenant_id = $1 and target_locator = $2 and key_kind = $4
                             and $3 = 1 and (destroyed_at is not null or retired_at is not null))",
        )
        .bind(tenant)
        .bind(&locator)
        .bind(version)
        .bind(kind)
        .fetch_one(&mut *conn)
        .await?;
        if !retired {
            return Ok(false);
        }
    }
    Ok(true)
}

#[derive(sqlx::FromRow)]
struct Delete {
    snapshot_id: Uuid,
    subprocess_id: Uuid,
    tenant_id: Uuid,
    tenant_version: i32,
    action_execution_id: Uuid,
    inventory_digest: String,
    frozen_inventory: Value,
    irreversible_dispatch_started: bool,
    subprocess_state: String,
    snapshot_state: String,
    provider_evidence: Value,
    canceled: bool,
    operation_id: Uuid,
    initiator_principal_id: Uuid,
    actor_principal_id: Uuid,
    action_version: i32,
    parameter_hash: String,
    correlation_id: Uuid,
}

impl Delete {
    fn result(&self) -> TenantDeleteAdvanceResult {
        TenantDeleteAdvanceResult {
            snapshot_id: self.snapshot_id.to_string(),
            subprocess_id: self.subprocess_id.to_string(),
            irreversible_dispatch_started: self.irreversible_dispatch_started,
            completed: self.subprocess_state == "DELETED" && self.irreversible_dispatch_started,
            canceled: self.canceled && !self.irreversible_dispatch_started,
            native_request_id: self
                .provider_evidence
                .pointer("/BUZZ/request_id")
                .and_then(Value::as_str)
                .map(str::to_owned),
            native_inventory_digest: self
                .provider_evidence
                .pointer("/BUZZ/inventory_digest")
                .and_then(Value::as_str)
                .map(str::to_owned),
        }
    }

    async fn audit(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        stage: &str,
        event_type: &str,
        result_code: &str,
        mut refs: Vec<Evidence>,
    ) -> Result<(), sqlx::Error> {
        refs.push(Evidence::new(
            EvidenceKind::TenantLifecycleSnapshotId,
            self.snapshot_id,
        ));
        refs.push(Evidence::new(
            EvidenceKind::TenantDeleteSubprocessId,
            self.subprocess_id,
        ));
        refs.push(Evidence::new(
            EvidenceKind::ActionExecutionId,
            self.action_execution_id,
        ));
        audit::append(
            tx,
            AuditEntry {
                event_key: format!("tenant-delete:{}:{stage}", self.subprocess_id),
                tenant_id: Some(self.tenant_id),
                workspace_id: None,
                operation_id: self.operation_id,
                event_type,
                human_identity_id: None,
                initiator_principal_id: Some(self.initiator_principal_id),
                actor_principal_id: Some(self.actor_principal_id),
                action_key: "tenant.delete",
                action_version: self.action_version,
                component_type_key: "CORE_INTERNAL",
                target_type: Some("TENANT"),
                target_id: Some(self.tenant_id),
                parameter_hash: &self.parameter_hash,
                decision: "ALLOW",
                result_code,
                result_exposure: "NONE",
                evidence_refs: refs,
                correlation_id: self.correlation_id,
            },
        )
        .await
    }
}

async fn load(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    snapshot: Uuid,
) -> Result<Option<Delete>, sqlx::Error> {
    sqlx::query_as(
        "select s.id as snapshot_id,p.id as subprocess_id,s.tenant_id,s.tenant_version,
                s.action_execution_id,s.inventory_digest,s.frozen_inventory,
                s.irreversible_dispatch_started,p.state as subprocess_state,
                s.state as snapshot_state,p.provider_evidence,
                exists(select 1 from audit.audit_event e
                       where e.event_key = 'tenant-delete:' || p.id::text || ':canceled') as canceled,
                a.operation_id,a.initiator_principal_id,a.actor_principal_id,
                a.action_version,a.parameter_hash,a.correlation_id
         from admission.tenant_lifecycle_snapshot s
         join admission.tenant_delete_subprocess p on p.tenant_lifecycle_snapshot_id = s.id
              and p.tenant_id = s.tenant_id and p.subject = 'PLATFORM_CORE'
              and p.mode = 'PLATFORM_CORE_CHAIN'
         join admission.action_execution a on a.id = s.action_execution_id
              and a.tenant_id = s.tenant_id and a.target_id = s.tenant_id
              and a.action_key = 'tenant.delete' and a.gate_state = 'ALLOWED'
         join projection.workflow_ref w on w.action_execution_id = a.id
              and w.workflow_id = a.temporal_workflow_id
              and w.tenant_id = s.tenant_id and w.kind = 'TENANT_LIFECYCLE'
         where s.id = $1 and s.tenant_id = $2 for update of s,p"
    ).bind(snapshot).bind(tenant).fetch_optional(&mut **tx).await
}

pub async fn advance(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    body: Result<Json<TenantDeleteAdvanceRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if let Err(response) = authorize(&state, &headers).await {
        return response;
    }
    let Ok(Json(req)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let (Ok(tenant), Ok(snapshot), Ok(version)) = (
        Uuid::parse_str(&req.tenant_id),
        Uuid::parse_str(&req.snapshot_id),
        i32::try_from(req.tenant_version),
    ) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    match advance_inner(&state, tenant, snapshot, version, req.cancel_requested).await {
        Ok(Some(result)) => Json(result).into_response(),
        Ok(None) => StatusCode::CONFLICT.into_response(),
        Err(error) => unavailable(error),
    }
}

async fn advance_inner(
    state: &ServiceState,
    tenant: Uuid,
    snapshot: Uuid,
    version: i32,
    cancel: bool,
) -> Result<Option<TenantDeleteAdvanceResult>, sqlx::Error> {
    let mut tx = state.pool.begin().await?;
    let current: Option<(String, i32)> =
        sqlx::query_as("select state,version from identity.tenant where id = $1 for update")
            .bind(tenant)
            .fetch_optional(&mut *tx)
            .await?;
    let Some(mut deletion) = load(&mut tx, tenant, snapshot).await? else {
        return Ok(None);
    };
    if tenant == state.catalog_tenant
        || deletion.tenant_version.checked_add(1) != Some(version)
        || deletion.inventory_digest
            != hex::encode(Sha256::digest(
                deletion.frozen_inventory.to_string().as_bytes(),
            ))
    {
        return Ok(None);
    }
    if deletion.canceled || deletion.subprocess_state == "DELETED" {
        return Ok(Some(deletion.result()));
    }
    if current != Some(("DELETING".to_owned(), version)) || deletion.snapshot_state != "DELETING" {
        return Ok(None);
    }
    if cancel && !deletion.irreversible_dispatch_started {
        sqlx::query(
            "update identity.tenant set state = 'SUSPENDED',version = version + 1 where id = $1",
        )
        .bind(tenant)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "update admission.tenant_lifecycle_snapshot set state = 'SUSPENDED' where id = $1",
        )
        .bind(snapshot)
        .execute(&mut *tx)
        .await?;
        deletion
            .audit(&mut tx, "canceled", "RECONCILIATION", "CANCELED", vec![])
            .await?;
        tx.commit().await?;
        deletion.canceled = true;
        return Ok(Some(deletion.result()));
    }
    if !deletion.irreversible_dispatch_started {
        // 身份引用冻结和秘钥写者都在不可逆分界前重新查证；缺处理器不会派发。
        let current_inventory =
            crate::governance::frozen_delete_inventory(&mut tx, tenant, deletion.tenant_version)
                .await;
        if current_inventory.ok().as_ref() != Some(&deletion.frozen_inventory)
            || !secrets_ready(&state.secrets, &mut tx, tenant).await?
            || state.deletion_transport.is_none()
        {
            mark_unknown(&mut tx, &deletion).await?;
            tx.commit().await?;
            return Ok(Some(deletion.result()));
        }
        sqlx::query("update admission.tenant_lifecycle_snapshot set irreversible_dispatch_started = true where id = $1")
            .bind(snapshot).execute(&mut *tx).await?;
        deletion
            .audit(&mut tx, "dispatch", "DISPATCH", "DISPATCHED", vec![])
            .await?;
        deletion.irreversible_dispatch_started = true;
    }
    sqlx::query("update admission.tenant_delete_subprocess set state = 'RUNNING',version = version + 1 where id = $1")
        .bind(deletion.subprocess_id).execute(&mut *tx).await?;
    tx.commit().await?;

    let Some(transport) = &state.deletion_transport else {
        persist(state, &deletion, None).await?;
        return reload_result(state, tenant, snapshot).await;
    };
    // 原生处理器幂等且相互独立，某一个 UNKNOWN 不把其他类别的确定证据抹掉。
    match buzz(state, transport, &deletion).await {
        Ok(evidence) => persist(state, &deletion, Some(("BUZZ", evidence))).await?,
        Err(error) => {
            tracing::warn!(tenant_id = %tenant, error, "Buzz 删除未对账");
            persist(state, &deletion, None).await?;
        }
    }
    let mut spicedb_evidence = serde_json::Map::new();
    let workspaces: Vec<Uuid> =
        sqlx::query_scalar("select id from identity.workspace where tenant_id = $1 order by id")
            .bind(tenant)
            .fetch_all(&state.pool)
            .await?;
    let mut relationships_absent = true;
    let mut owners: Vec<contracts::AffectedOwnerRef> =
        serde_json::from_value(deletion.frozen_inventory["resource_owner_versions"].clone())
            .map_err(|e| sqlx::Error::Protocol(e.to_string()))?;
    owners.extend(
        serde_json::from_value::<Vec<contracts::AffectedOwnerRef>>(
            deletion.frozen_inventory["asset_owner_versions"].clone(),
        )
        .map_err(|e| sqlx::Error::Protocol(e.to_string()))?,
    );
    let owned_objects: Vec<(&str, Uuid)> = owners
        .into_iter()
        .map(|r| {
            let kind = match r.target_type.as_str() {
                "RESOURCE" => "resource",
                "ASSET" => "asset",
                _ => return Err(sqlx::Error::Protocol("冻结 owner 对象类型未知".into())),
            };
            Uuid::parse_str(&r.target_id)
                .map(|id| (kind, id))
                .map_err(|e| sqlx::Error::Protocol(e.to_string()))
        })
        .collect::<Result<_, _>>()?;
    for (kind, id) in std::iter::once(("tenant", tenant))
        .chain(workspaces.iter().map(|id| ("workspace", *id)))
        .chain(owned_objects.iter().copied())
    {
        match state
            .governance
            .spicedb
            .delete_object(&transport.http, kind, id)
            .await
        {
            Ok(token) => {
                spicedb_evidence.insert(format!("{kind}:{id}"), Value::String(token));
            }
            Err(error) => {
                relationships_absent = false;
                tracing::warn!(tenant_id = %tenant, error = %error, "SpiceDB 删除未对账");
            }
        }
    }
    if relationships_absent {
        persist(
            state,
            &deletion,
            Some((
                "SPICEDB",
                json!({"deleted":true,"revisions":spicedb_evidence}),
            )),
        )
        .await?;
    } else {
        persist(state, &deletion, None).await?;
    }
    if audit_gate(state).await.is_ok() {
        match state.secrets.delete_tenant(tenant).await {
            Ok(true) => {
                persist(
                    state,
                    &deletion,
                    Some(("OPENBAO", json!({"deleted":true,"namespace_id":tenant}))),
                )
                .await?
            }
            Ok(false) => persist(state, &deletion, None).await?,
            Err(error) => {
                tracing::warn!(tenant_id = %tenant, error = %error, "OpenBao namespace 删除未对账");
                persist(state, &deletion, None).await?;
            }
        }
    } else {
        persist(state, &deletion, None).await?;
    }
    if let Err(error) = retire_openmeter(state, &deletion).await {
        tracing::warn!(tenant_id = %tenant, error, "OpenMeter Customer 退役未对账");
        persist(state, &deletion, None).await?;
    }
    finish(state, &deletion).await?;
    reload_result(state, tenant, snapshot).await
}

async fn reload_result(
    state: &ServiceState,
    tenant: Uuid,
    snapshot: Uuid,
) -> Result<Option<TenantDeleteAdvanceResult>, sqlx::Error> {
    let mut tx = state.pool.begin().await?;
    Ok(load(&mut tx, tenant, snapshot).await?.map(|d| d.result()))
}

async fn persist(
    state: &ServiceState,
    deletion: &Delete,
    provider: Option<(&str, Value)>,
) -> Result<(), sqlx::Error> {
    let mut tx = state.pool.begin().await?;
    let terminal: Option<String> = sqlx::query_scalar(
        "select state from admission.tenant_delete_subprocess where id = $1 for update",
    )
    .bind(deletion.subprocess_id)
    .fetch_optional(&mut *tx)
    .await?;
    if terminal.as_deref() == Some("DELETED") {
        return Ok(());
    }
    if let Some((kind, evidence)) = provider {
        let refs = if kind == "BUZZ" {
            native_refs(&evidence)
        } else if kind == "SPICEDB" {
            evidence
                .get("revisions")
                .and_then(Value::as_object)
                .into_iter()
                .flat_map(|m| m.values())
                .filter_map(Value::as_str)
                .map(|token| Evidence::new(EvidenceKind::SpicedbZedtoken, token))
                .collect()
        } else {
            vec![]
        };
        sqlx::query("update admission.tenant_delete_subprocess set provider_evidence = provider_evidence || $2::jsonb where id = $1")
            .bind(deletion.subprocess_id).bind(json!({kind:evidence})).execute(&mut *tx).await?;
        deletion
            .audit(&mut tx, kind, "RECONCILIATION", "DELETED", refs)
            .await?;
    } else {
        mark_unknown(&mut tx, deletion).await?;
    }
    tx.commit().await
}

async fn mark_unknown(
    tx: &mut Transaction<'_, Postgres>,
    deletion: &Delete,
) -> Result<(), sqlx::Error> {
    sqlx::query("update admission.tenant_delete_subprocess set state = 'UNKNOWN',version = version + 1 where id = $1 and state <> 'DELETED'")
        .bind(deletion.subprocess_id).execute(&mut **tx).await?;
    deletion
        .audit(tx, "unknown", "RECONCILIATION", "RESULT_UNKNOWN", vec![])
        .await
}

fn native_refs(evidence: &Value) -> Vec<Evidence> {
    [
        ("request_id", EvidenceKind::BuzzDeletionRequestId),
        (
            "inventory_digest",
            EvidenceKind::BuzzDeletionInventoryDigest,
        ),
    ]
    .into_iter()
    .filter_map(|(key, kind)| {
        evidence
            .get(key)
            .and_then(Value::as_str)
            .map(|value| Evidence::new(kind, value))
    })
    .collect()
}

async fn native_reference(
    state: &ServiceState,
    deletion: &Delete,
    request_id: Uuid,
    digest: Option<&str>,
) -> Result<(), sqlx::Error> {
    let evidence = json!({"request_id":request_id,"inventory_digest":digest});
    let mut tx = state.pool.begin().await?;
    // 重试先观察同一请求不能清除已经确定的 digest；原生 abort 后的新请求
    // 则不能继承旧请求的 digest。两者与引用列表在同一行更新中仲裁。
    let written = sqlx::query("update admission.tenant_delete_subprocess set external_execution_ids = case
        when external_execution_ids @> $2::jsonb then external_execution_ids else external_execution_ids || $2::jsonb end,
        provider_evidence = provider_evidence || case
            when provider_evidence #>> '{BUZZ,request_id}' = $3::jsonb #>> '{BUZZ,request_id}'
                and $3::jsonb #> '{BUZZ,inventory_digest}' = 'null'::jsonb
            then jsonb_set($3::jsonb, '{BUZZ,inventory_digest}',
                coalesce(provider_evidence #> '{BUZZ,inventory_digest}', 'null'::jsonb))
            else $3::jsonb end
        where id = $1 and state <> 'DELETED'")
        .bind(deletion.subprocess_id).bind(json!([request_id])).bind(json!({"BUZZ":evidence}))
        .execute(&mut *tx).await?;
    if written.rows_affected() != 0 {
        let stage = match digest {
            Some(digest) => format!("native:{request_id}:digest:{digest}"),
            None => format!("native:{request_id}:observed"),
        };
        deletion
            .audit(
                &mut tx,
                &stage,
                "RECONCILIATION",
                "DISPATCHED",
                native_refs(&evidence),
            )
            .await?;
    }
    tx.commit().await
}

async fn buzz(
    state: &ServiceState,
    transport: &DeletionTransport,
    deletion: &Delete,
) -> Result<Value, String> {
    let binding = deletion
        .frozen_inventory
        .get("tenant_buzz_binding")
        .ok_or("缺少冻结 Buzz binding")?;
    let host = binding
        .get("normalized_host")
        .and_then(Value::as_str)
        .ok_or("缺少冻结 host")?;
    let community = binding
        .get("community_id")
        .and_then(Value::as_str)
        .ok_or("缺少冻结 Community ID")?;
    let control = binding
        .get("control_pubkey")
        .and_then(Value::as_str)
        .ok_or("缺少冻结 CONTROL pubkey")?;
    let operator = crate::tenant_lifecycle::load_operator(state)
        .await
        .map_err(|_| "operator 身份不可用")?;
    let requests = operator
        .list_community_deletions(&transport.http, &transport.origin, host)
        .await
        .map_err(|e| e.to_string())?;
    let requests = requests.as_array().ok_or("native list 不是完整请求数组")?;
    if requests.len() > 1 {
        return Err("同一 host 存在多个非 aborted 请求".into());
    }
    let mut request = match requests.first() {
        Some(request) => request.clone(),
        None => operator
            .submit_community_deletion(
                &transport.http,
                &transport.origin,
                host,
                deletion.subprocess_id,
            )
            .await
            .map_err(|e| e.to_string())?,
    };
    if request.get("community_host").and_then(Value::as_str) != Some(host)
        || request.get("community_id").and_then(Value::as_str) != Some(community)
    {
        return Err("原生请求目标不匹配冻结清单".into());
    }
    let request_id = request
        .get("id")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
        .ok_or("native request ID 无效")?;
    // 已知引用先落库；即使恢复 freeze 再次超时，也不丢掉已知请求或伪造 digest。
    native_reference(state, deletion, request_id, None)
        .await
        .map_err(|e| e.to_string())?;
    if request.get("stage").and_then(Value::as_str) == Some("submitted") {
        if request.get("requested_by").and_then(Value::as_str)
            != Some(&deletion.subprocess_id.to_string())
        {
            return Err("其他 operator 的 submitted 请求尚未冻结清单".into());
        }
        // 原生 submit 对同一 requested_by/host 的 submitted 请求恢复冻结，
        // 不创建第二条删除请求；第一次冻结 HTTP 回应丢失也走这条观察后的路径。
        request = operator
            .submit_community_deletion(
                &transport.http,
                &transport.origin,
                host,
                deletion.subprocess_id,
            )
            .await
            .map_err(|e| e.to_string())?;
        if request.get("id").and_then(Value::as_str) != Some(&request_id.to_string()) {
            return Err("恢复冻结返回了其他 native 请求".into());
        }
    }
    let digest = request
        .get("inventory_digest")
        .and_then(Value::as_str)
        .filter(|d| {
            d.len() == 64
                && d.bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        })
        .ok_or("native inventory digest 未确定")?;
    // 即使 run 的 HTTP 回应丢失，native ID 和 digest 已在副作用前进入持久历史。
    native_reference(state, deletion, request_id, Some(digest))
        .await
        .map_err(|e| e.to_string())?;
    let mut inspection = operator
        .inspect_community_deletion(&transport.http, &transport.origin, request_id)
        .await
        .map_err(|e| e.to_string())?;
    if inspection.pointer("/request/blocked_reason") != Some(&Value::Null) {
        return Err("native 请求已 blocked 或缺少 block 事实".into());
    }
    let native = inspection.get("request").ok_or("inspection 缺少原生请求")?;
    if native.get("community_host").and_then(Value::as_str) != Some(host)
        || native.get("community_id").and_then(Value::as_str) != Some(community)
        || native.get("id").and_then(Value::as_str) != Some(&request_id.to_string())
        || native.get("inventory_digest").and_then(Value::as_str) != Some(digest)
        || !matches!(
            native.get("stage").and_then(Value::as_str),
            Some(
                "inventoried"
                    | "approved"
                    | "fenced"
                    | "drained"
                    | "bindings_removed"
                    | "postgres_purged"
                    | "cache_purged"
                    | "logically_verified"
                    | "retention_pending"
            )
        )
    {
        return Err("inspection 目标、清单或阶段不合冻结合同".into());
    }
    let retained_cas = retained_cas_summary(
        inspection
            .pointer("/request/inventory_manifest/retained_cas")
            .ok_or("native 冻结清单缺少共享 CAS 保留证据")?,
    )?;
    if inspection.get("approval") == Some(&Value::Null) {
        operator
            .approve_community_deletion(
                &transport.http,
                &transport.origin,
                request_id,
                digest,
                deletion.action_execution_id,
            )
            .await
            .map_err(|e| e.to_string())?;
        inspection = operator
            .inspect_community_deletion(&transport.http, &transport.origin, request_id)
            .await
            .map_err(|e| e.to_string())?;
    }
    // 批准必须属于此次 Core 准入，不能先运行再以事后校验拒绝旧批准。
    if inspection
        .pointer("/approval/inventory_digest")
        .and_then(Value::as_str)
        != Some(digest)
        || inspection
            .pointer("/approval/approved_by")
            .and_then(Value::as_str)
            != Some(&deletion.action_execution_id.to_string())
    {
        return Err("原生批准不属于本次删除 ActionExecution".into());
    }
    if inspection.pointer("/request/stage").and_then(Value::as_str) != Some("retention_pending") {
        // run 错误不是失败终态，始终再 inspect 同一 native ID。
        let _ = operator
            .run_community_deletion(&transport.http, &transport.origin, request_id)
            .await;
        inspection = operator
            .inspect_community_deletion(&transport.http, &transport.origin, request_id)
            .await
            .map_err(|e| e.to_string())?;
    }
    if inspection.pointer("/request/stage").and_then(Value::as_str) != Some("retention_pending")
        || inspection.pointer("/request/blocked_reason") != Some(&Value::Null)
        || inspection.pointer("/request/id").and_then(Value::as_str)
            != Some(&request_id.to_string())
        || inspection
            .pointer("/request/inventory_digest")
            .and_then(Value::as_str)
            != Some(digest)
        || inspection
            .pointer("/approval/inventory_digest")
            .and_then(Value::as_str)
            != Some(digest)
        || inspection
            .pointer("/approval/approved_by")
            .and_then(Value::as_str)
            != Some(&deletion.action_execution_id.to_string())
    {
        return Err("原生逻辑删除终态或批准引用未成立".into());
    }
    if inspection.pointer("/request/inventory_manifest/retained_cas") != Some(&retained_cas) {
        return Err("native 保留证据不属于同一冻结清单".into());
    }
    let checkpoints = inspection
        .get("checkpoints")
        .and_then(Value::as_array)
        .ok_or("native 缺少完整检查点列表")?;
    let retention = checkpoints
        .iter()
        .filter(|checkpoint| {
            checkpoint.get("unit_key").and_then(Value::as_str)
                == Some("retention_physical_expiry_pending")
        })
        .collect::<Vec<_>>();
    if retention.len() != 1
        || retention[0].get("stage").and_then(Value::as_str) != Some("logically_verified")
        || retention[0].get("status").and_then(Value::as_str) != Some("completed")
        || retention[0]
            .pointer("/detail/inventory_digest")
            .and_then(Value::as_str)
            != Some(digest)
        || retention[0].pointer("/detail/retained_cas") != Some(&retained_cas)
    {
        return Err("native 物理保留检查点缺失或不合冻结摘要".into());
    }
    let communities = operator
        .list_owned_communities(&transport.http, control)
        .await
        .map_err(|e| e.to_string())?;
    if communities.iter().any(|row| row.host == host) {
        return Err("operator 仍列出被冻结 Community".into());
    }
    Ok(
        json!({"deleted":true,"request_id":request_id,"inventory_digest":digest,
        "native_stage":"retention_pending","control_owner_host_absent":true,
        "retained_items":["community_tombstone","deletion_evidence","detached_product_feedback",
            "detached_rate_limit_violations","shared_cas_media_thumbnails_git_packs"],
        "retained_cas":retained_cas,
        "shared_cas_physically_reclaimed":false}),
    )
}

/// Only native inventory metadata is copied; no CAS object keys or bodies.
fn retained_cas_summary(value: &Value) -> Result<Value, String> {
    let object_count = value
        .get("object_count")
        .and_then(Value::as_u64)
        .ok_or("共享 CAS 保留对象数未确定")?;
    let total_bytes = value
        .get("total_bytes")
        .and_then(Value::as_u64)
        .ok_or("共享 CAS 保留字节数未确定")?;
    let keys_digest = value
        .get("keys_digest")
        .and_then(Value::as_str)
        .filter(|s| {
            s.len() == 64
                && s.bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        })
        .ok_or("共享 CAS 保留版本摘要未确定")?;
    let empty_digest = hex::encode(Sha256::digest([]));
    if (object_count == 0 && (total_bytes != 0 || keys_digest != empty_digest))
        || (object_count != 0 && keys_digest == empty_digest)
    {
        return Err("共享 CAS 空清单证据矛盾".into());
    }
    Ok(json!({"object_count":object_count,"total_bytes":total_bytes,"keys_digest":keys_digest}))
}

/// 同一冻结引用的逻辑退役：native tombstone 与 active key 缺席同时成立才收口。
async fn retire_openmeter(state: &ServiceState, deletion: &Delete) -> Result<(), &'static str> {
    let frozen = deletion
        .frozen_inventory
        .get("openmeter_binding")
        .ok_or("冻结清单缺少 OpenMeter 适用性")?;
    let namespace = frozen
        .get("namespace")
        .and_then(Value::as_str)
        .ok_or("冻结 namespace 缺失")?;
    let customer_id = frozen
        .get("customer_id")
        .and_then(Value::as_str)
        .ok_or("冻结 Customer ID 缺失")?;
    let prefix = frozen
        .get("subject_key_prefix")
        .and_then(Value::as_str)
        .ok_or("冻结 subject 前缀缺失")?;
    let version = frozen
        .get("version")
        .and_then(Value::as_i64)
        .and_then(|v| i32::try_from(v).ok())
        .ok_or("冻结 binding version 缺失")?;
    let retired_version = version.checked_add(1).ok_or("binding version 耗尽")?;
    if namespace != state.openmeter.namespace()
        || frozen.get("status").and_then(Value::as_str) != Some("ACTIVE")
        || frozen.get("tenant_id").and_then(Value::as_str) != Some(&deletion.tenant_id.to_string())
        || prefix != format!("{}:", deletion.tenant_id)
    {
        return Err("OpenMeter 冻结引用归属不符");
    }
    let current: Option<(String, String, String, String, i32)> = sqlx::query_as(
        "select namespace,customer_id,subject_key_prefix,status,version
         from projection.openmeter_binding where tenant_id = $1",
    )
    .bind(deletion.tenant_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| "OpenMeter binding 不可读取")?;
    let Some((current_ns, current_id, current_prefix, status, current_version)) = current else {
        return Err("OpenMeter binding 已丢失");
    };
    if current_ns != namespace
        || current_id != customer_id
        || current_prefix != prefix
        || !((status == "ACTIVE" && current_version == version)
            || (status == "REVOKED" && current_version == retired_version))
    {
        return Err("OpenMeter binding 已偏离冻结版本");
    }
    // native DELETE 是固定源码中的逻辑退役。HTTP 204 不是终态，client 回读墓碑与精确 key。
    let tombstone = state
        .openmeter
        .retire_customer(customer_id, deletion.tenant_id)
        .await
        .map_err(|_| "OpenMeter native 退役或回读未成立")?;
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| "OpenMeter 退役事务不可用")?;
    let written = sqlx::query(
        "update projection.openmeter_binding set status = 'REVOKED',
           version = case when status = 'ACTIVE' then version + 1 else version end
         where tenant_id = $1 and namespace = $2 and customer_id = $3 and subject_key_prefix = $4
           and ((status = 'ACTIVE' and version = $5) or (status = 'REVOKED' and version = $6))",
    )
    .bind(deletion.tenant_id)
    .bind(namespace)
    .bind(customer_id)
    .bind(prefix)
    .bind(version)
    .bind(retired_version)
    .execute(&mut *tx)
    .await
    .map_err(|_| "OpenMeter binding 退役未写入")?;
    if written.rows_affected() != 1 {
        return Err("OpenMeter binding 退役版本冲突");
    }
    let evidence = json!({"deleted":true,"namespace":namespace,"customer_id":customer_id,
        "deleted_at":tombstone.deleted_at,"active_key_absent":true,
        "retained_items":["customer_tombstone","historical_usage","billing_facts"]});
    let recorded = sqlx::query(
        "update admission.tenant_delete_subprocess set provider_evidence = provider_evidence || $2::jsonb
         where id = $1 and state <> 'DELETED'",
    ).bind(deletion.subprocess_id).bind(json!({"OPENMETER":evidence}))
        .execute(&mut *tx).await.map_err(|_| "OpenMeter 终态引用未写入")?;
    if recorded.rows_affected() != 1 {
        return Err("删除子流程已经终结或丢失");
    }
    deletion
        .audit(&mut tx, "OPENMETER", "RECONCILIATION", "DELETED", vec![])
        .await
        .map_err(|_| "OpenMeter 退役审计未写入")?;
    tx.commit().await.map_err(|_| "OpenMeter 退役提交结果不明")
}

async fn finish(state: &ServiceState, deletion: &Delete) -> Result<(), sqlx::Error> {
    let mut tx = state.pool.begin().await?;
    let current: Option<(String, i32)> =
        sqlx::query_as("select state,version from identity.tenant where id = $1 for update")
            .bind(deletion.tenant_id)
            .fetch_optional(&mut *tx)
            .await?;
    let Some(durable) = load(&mut tx, deletion.tenant_id, deletion.snapshot_id).await? else {
        return Ok(());
    };
    if durable.subprocess_state == "DELETED" {
        return Ok(());
    }
    // Old or incomplete provider evidence must never become a new success.
    if durable
        .provider_evidence
        .pointer("/BUZZ/deleted")
        .and_then(Value::as_bool)
        == Some(true)
        && (retained_cas_summary(&durable.provider_evidence["BUZZ"]["retained_cas"]).is_err()
            || durable
                .provider_evidence
                .pointer("/BUZZ/shared_cas_physically_reclaimed")
                .and_then(Value::as_bool)
                != Some(false))
    {
        mark_unknown(&mut tx, &durable).await?;
        return tx.commit().await;
    }
    if !durable.irreversible_dispatch_started
        || current != Some(("DELETING".into(), deletion.tenant_version + 1))
        || durable
            .frozen_inventory
            .get("openmeter_binding")
            .and_then(Value::as_object)
            .is_none()
        || durable
            .provider_evidence
            .pointer("/OPENMETER/deleted")
            .and_then(Value::as_bool)
            != Some(true)
        || durable.provider_evidence.pointer("/OPENMETER/customer_id")
            != durable
                .frozen_inventory
                .pointer("/openmeter_binding/customer_id")
        || durable.provider_evidence.pointer("/OPENMETER/namespace")
            != durable
                .frozen_inventory
                .pointer("/openmeter_binding/namespace")
        || ["BUZZ", "SPICEDB", "OPENBAO"].iter().any(|kind| {
            durable
                .provider_evidence
                .get(*kind)
                .and_then(|v| v.get("deleted"))
                .and_then(Value::as_bool)
                != Some(true)
        })
    {
        return Ok(());
    }
    // 历史 operation、Workflow、审计和外部引用不删除；保留的 FK 目标是
    // DISABLED/REVOKED 墓碑，不再是可用身份、scope 或 binding。
    for sql in [
        "update catalog.agent_definition set status='DELETED',current_published_version_asset_id=null where resource_id in (select id from catalog.resource where tenant_id=$1)",
        "update catalog.agent_version set state='RETIRED' where asset_id in (select id from catalog.asset where tenant_id=$1) and state<>'RETIRED'",
        "update catalog.asset set state='DELETED',version=version+1,projection_action_execution_id=null where tenant_id=$1 and state<>'DELETED'",
        "update catalog.resource set state='DELETED',version=version+1,projection_action_execution_id=null where tenant_id=$1 and state<>'DELETED'",
        "delete from identity.collaboration_user_state where tenant_principal_id in (select id from identity.principal where tenant_id = $1)",
        "delete from admission.publish_attempt where tenant_principal_id in (select id from identity.principal where tenant_id = $1)",
        "update identity.platform_session set status = 'REVOKED' where tenant_membership_id in (select id from identity.tenant_membership where tenant_id = $1) and status = 'ACTIVE'",
        "update identity.tenant_membership set state = 'REVOKED',version = version + 1 where tenant_id = $1 and state <> 'REVOKED'",
        "update identity.workspace_membership set state = 'REVOKED',version = version + 1 where workspace_id in (select id from identity.workspace where tenant_id = $1) and state <> 'REVOKED'",
        "update identity.principal set status = 'DISABLED' where tenant_id = $1 and status <> 'DISABLED'",
        "update identity.buzz_identity_binding set state = 'REVOKED',private_key_secret_status = case when custody = 'SERVER' then 'REVOKED' else null end,version = version + 1 where tenant_id = $1 and (state <> 'REVOKED' or private_key_secret_status is distinct from case when custody = 'SERVER' then 'REVOKED' else null end)",
        "update projection.workspace_buzz_binding set state = 'DISABLED',version = version + 1 where workspace_id in (select id from identity.workspace where tenant_id = $1) and state <> 'DISABLED'",
        "update projection.tenant_buzz_binding set state = 'DISABLED',version = version + 1 where tenant_id = $1 and state <> 'DISABLED'",
        "update identity.tenant_invitation set state = 'REVOKED',revoked_at = now(),version = version + 1 where tenant_id = $1 and state = 'ISSUED'",
    ] { sqlx::query(sql).bind(deletion.tenant_id).execute(&mut *tx).await?; }
    sqlx::query("update identity.tenant set state = 'DELETED',version = version + 1 where id = $1")
        .bind(deletion.tenant_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("update admission.tenant_lifecycle_snapshot set state = 'DELETED' where id = $1")
        .bind(deletion.snapshot_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("update admission.tenant_delete_subprocess set state = 'DELETED',provider_evidence = provider_evidence || '{\"CORE\":{\"deleted\":true}}'::jsonb,version = version + 1 where id = $1")
        .bind(deletion.subprocess_id).execute(&mut *tx).await?;
    durable
        .audit(
            &mut tx,
            "completed",
            "RECONCILIATION",
            "DELETED",
            native_refs(&durable.provider_evidence["BUZZ"]),
        )
        .await?;
    tx.commit().await
}
