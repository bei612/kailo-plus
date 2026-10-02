//! Tenant 的协作面与 OpenMeter 映射查证（`TENANT_LIFECYCLE`、`.design/09` 第 3 步、DD-38）。
//!
//! 两个端点对应 `TenantBuzzBinding` 状态机的两段（`.design/03` §2）：
//!
//! - `provision`：`UNBOUND → PROVISIONING → RECONCILING`。建 Community、建
//!   CONTROL 身份、落 binding。做完这一步只证明「发出去了」。
//! - `verify`：`RECONCILING → ACTIVE`。抓 NIP-11、核验该部署确实执行成员准入、
//!   记录快照 digest。只发出而未查证不得 active（`.design/09` 第 3 步）。
//!
//! 分成两个端点不是为了分层，而是因为它们的失败语义不同：前者失败是投影没做成，
//! 后者失败是「做了但不成立」——后者绝不能靠重发投影来"修复"。

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use collab_bridge::bridge::{Custody, IdentityClient, Presence, Scope};
use collab_bridge::operator::{OperatorError, OperatorIdentity};
use secret_store::SecretRef;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use uuid::Uuid;

use crate::service_api::{authorize, unavailable, ServiceState};

/// NIP-43。`supported_nips` 含它等价于「该部署配了稳定 relay 私钥且
/// `require_relay_membership=true`」（`SF-BUZ-35`）——也就是 `07` §1 对 Buzz Relay
/// 的两条前置同时成立。取值来自上游 `buzz-core` 的同名常量。
const NIP_RELAY_MEMBERSHIP: u64 = 43;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TenantStepRequest {
    pub tenant_id: Uuid,
    pub tenant_version: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvisionResponse {
    pub community_host: String,
    pub control_pubkey: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyResponse {
    pub nip11_digest: String,
    pub membership_enforced: bool,
}

/// 建 Community、建 CONTROL 身份、把 binding 推进到 `RECONCILING`。
///
/// 每一步都先查后建：Activity 会重试、Worker 会崩溃重放，同一次投影必然被执行
/// 多次。Community 创建本身在上游就是「同一 owner 重发即幂等收敛」
/// （`SF-BUZ-31`），Tenant 唯一性由 Core 自己的约束保证。
pub async fn provision_tenant_buzz(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    body: Result<Json<TenantStepRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if let Err(e) = authorize(&state, &headers).await {
        return e;
    }
    let Ok(Json(req)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };

    // 冻结版本必须相符：对着一个已经变过的 Tenant 做投影，等于把旧意图写进
    // 新事实（`06` §3）。
    let tenant = match sqlx::query!(
        "select slug from identity.tenant where id = $1 and version = $2 and state = 'PROVISIONING'",
        req.tenant_id,
        req.tenant_version
    )
    .fetch_optional(&state.pool)
    .await
    {
        Ok(Some(t)) => t,
        Ok(None) => return StatusCode::CONFLICT.into_response(),
        Err(e) => return unavailable(e),
    };

    // DD-70/72：在任何 CONTROL 私钥生成与写入前，先收敛该 Tenant 的真实
    // OpenBao namespace、KV mount、policy 与 AppRole。失败不能退回 platform/kv。
    if let Err(error) =
        crate::platform_keys::ensure_tenant_namespace(&state.pool, &state.secrets, req.tenant_id)
            .await
    {
        tracing::warn!(error = %error, tenant_id = %req.tenant_id, "Tenant secret namespace 未就绪");
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }

    // CONTROL Principal：Tenant 的协议 owner，不是业务 actor（`DD-03`）。
    // 已有 CONTROL 身份就沿用；没有才按 DD-113 冻结意图后生成。重新生成会让
    // Community 的 owner 与 Core 记录的身份对不上，而那在 Relay 侧表现为「谁都
    // 不是 owner」。
    let (control_principal, control_pubkey) = match crate::platform_keys::ensure_control_identity(
        &state,
        req.tenant_id,
        req.tenant_version,
    )
    .await
    {
        Ok(identity) => identity,
        Err(r) => return r,
    };

    // Community host 由 Tenant slug 与部署的 Community 域拼成。它是签名权威
    // （`SF-BUZ-32`），因此必须是稳定可推导的值，不能每次随机。
    let host = format!("{}.{}", tenant.slug, state.community_domain);

    let operator = match load_operator(&state).await {
        Ok(o) => o,
        Err(r) => return r,
    };
    let community = match operator
        .provision_community(&state.http, &host, &control_pubkey)
        .await
    {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(error = %e, "创建 Community 失败");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    };
    let community_id = match community
        .get("community_id")
        .or_else(|| community.get("id"))
        .and_then(|v| v.as_str())
        .and_then(|v| Uuid::parse_str(v).ok())
    {
        Some(id) => id,
        None => {
            tracing::warn!(response = %community, "Community 响应里没有可解析的 id");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    };

    // binding 落在 RECONCILING：此刻只证明事件发出去了，NIP-11 还没查证。
    // 三个开关先按「未观测」填保守值——ACTIVE 的三条 CHECK 会拦住它，
    // 真正的取值由 verify 一步写入。
    if let Err(e) = sqlx::query!(
        "insert into projection.tenant_buzz_binding
             (tenant_id, community_id, normalized_host, control_service_principal_id,
              require_relay_membership, allow_nip_oa_auth, pubkey_allowlist_enabled, state)
         values ($1, $2, $3, $4, false, true, false, 'RECONCILING')
         on conflict (tenant_id) do nothing",
        req.tenant_id,
        community_id,
        host,
        control_principal,
    )
    .execute(&state.pool)
    .await
    {
        return unavailable(e);
    }

    if let Err(r) = reconcile_metering_customer(&state, &req, true).await {
        return r;
    }

    (
        StatusCode::OK,
        Json(ProvisionResponse {
            community_host: host,
            control_pubkey,
        }),
    )
        .into_response()
}

/// 抓 NIP-11、核验准入执行点成立、把 binding 推进到 `ACTIVE`。
pub async fn verify_tenant_buzz(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    body: Result<Json<TenantStepRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if let Err(e) = authorize(&state, &headers).await {
        return e;
    }
    let Ok(Json(req)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };

    // Tenant ACTIVE 同时要求真实 Customer 映射；查证段绝不补发创建请求。
    if let Err(r) = reconcile_metering_customer(&state, &req, false).await {
        return r;
    }

    let binding = match sqlx::query!(
        "select normalized_host, control_service_principal_id
         from projection.tenant_buzz_binding
         where tenant_id = $1 and state in ('RECONCILING', 'ACTIVE')",
        req.tenant_id
    )
    .fetch_optional(&state.pool)
    .await
    {
        Ok(Some(b)) => b,
        Ok(None) => return StatusCode::CONFLICT.into_response(),
        Err(e) => return unavailable(e),
    };

    // NIP-11 按 Community host 抓：Relay 按 Host 绑定 Community，用网络地址
    // 抓到的是另一个 Community 的文档（`SF-BUZ-32`）。
    let info: serde_json::Value = match state
        .http
        .get(format!("{}/info", state.relay_transport))
        .header(reqwest::header::HOST, &binding.normalized_host)
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => match r.json().await {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!(error = %e, "NIP-11 文档不可解析");
                return StatusCode::SERVICE_UNAVAILABLE.into_response();
            }
        },
        Ok(r) => {
            tracing::warn!(status = %r.status(), "抓 NIP-11 失败");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
        Err(e) => {
            tracing::warn!(error = %e, "抓 NIP-11 失败");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    };

    // 观测而非采信配置：上游仅在「配了稳定 relay 私钥且开启成员校验」时才广告
    // NIP-43（`SF-BUZ-35`）。它不成立就意味着协作面没有准入执行点——此时把
    // binding 置为 ACTIVE 等于开着门说门是关的。
    let membership_enforced = info
        .get("supported_nips")
        .and_then(|v| v.as_array())
        .is_some_and(|nips| {
            nips.iter()
                .any(|n| n.as_u64() == Some(NIP_RELAY_MEMBERSHIP))
        });
    if !membership_enforced {
        tracing::warn!(
            host = %binding.normalized_host,
            "NIP-11 未广告 NIP-43：该部署没有执行成员准入"
        );
        return StatusCode::FORBIDDEN.into_response();
    }

    let digest = canonical_digest(&info);

    // Community 已接受 owner pubkey 仍不足以证明 Core 持有对应私钥。CONTROL
    // binding 与 Tenant binding 开放前，必须读回钉住的 KV 版本并核对公钥。
    if let Err(r) =
        verify_control_secret(&state, req.tenant_id, binding.control_service_principal_id).await
    {
        return r;
    }

    if let Err(r) = crate::service_api::audit_gate(&state).await {
        return r;
    }

    // 一条 UPDATE 同时写快照与三个观测值并推进状态：分成多句会留下
    // 「digest 已更新但状态还没动」的中间态，而那正是对账要排除的东西。
    let updated = sqlx::query!(
        "update projection.tenant_buzz_binding
         set nip11_snapshot_digest = $2, nip11_observed_at = now(),
             require_relay_membership = true, allow_nip_oa_auth = false,
             state = 'ACTIVE', version = version + 1
         where tenant_id = $1 and state in ('RECONCILING', 'ACTIVE')
         returning tenant_id",
        req.tenant_id,
        digest,
    )
    .fetch_optional(&state.pool)
    .await;
    if let Err(e) = updated {
        return unavailable(e);
    }

    // CONTROL 身份在其 Community owner 身份查证后才 ACTIVE：它是 Community 的
    // owner，而 owner 身份恰恰由刚才的 provision 建立并被 Relay 接受。绑定版本的
    // 引用在同一句里由 PENDING 转 ACTIVE（`.design/03` SecretRef 状态机）。
    if let Err(e) = sqlx::query(
        "update identity.buzz_identity_binding
         set state = 'ACTIVE', version = version + 1, private_key_secret_status = 'ACTIVE'
         where tenant_id = $1 and principal_id = $2 and state = 'RECONCILING'",
    )
    .bind(req.tenant_id)
    .bind(binding.control_service_principal_id)
    .execute(&state.pool)
    .await
    {
        return unavailable(e);
    }

    (
        StatusCode::OK,
        Json(VerifyResponse {
            nip11_digest: digest,
            membership_enforced,
        }),
    )
        .into_response()
}

/// CONTROL 私钥可读回且与 binding 记录的公钥一致：读回钉住的 KV 版本并核对公钥。
/// Tenant 建立的查证（`verify_tenant_buzz`）与恢复的对账（`restore_reconcile`）共用。
async fn verify_control_secret(
    state: &ServiceState,
    tenant_id: Uuid,
    control_principal: Uuid,
) -> Result<(), Response> {
    let control = match sqlx::query!(
        "select pubkey, private_key_secret_ref, private_key_secret_version,
                private_key_secret_audience
         from identity.buzz_identity_binding
         where tenant_id = $1 and principal_id = $2 and kind = 'CONTROL'
           and custody = 'SERVER' and state in ('RECONCILING', 'ACTIVE')",
        tenant_id,
        control_principal,
    )
    .fetch_optional(&state.pool)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return Err(StatusCode::SERVICE_UNAVAILABLE.into_response()),
        Err(e) => return Err(unavailable(e)),
    };
    let control_ref = SecretRef {
        locator: control.private_key_secret_ref.unwrap_or_default(),
        version: control.private_key_secret_version.unwrap_or_default() as u32,
        audience: control.private_key_secret_audience.unwrap_or_default(),
    };
    if let Err(e) =
        crate::server_identity::read_bound_keys(&state.secrets, &control_ref, &control.pubkey).await
    {
        tracing::warn!(error = %e, "CONTROL 私钥不可用，Tenant binding 不开放");
        return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
    }

    Ok(())
}

/// 原 Tenant Workflow 已冻结的动作，而不是按时间挑一条最近的 ActionExecution。
struct MeteringOperation {
    workflow_id: String,
    action_id: Uuid,
    audit: crate::platform_keys::ActionAuditContext,
}

async fn metering_tenant_tx<'a>(
    state: &'a ServiceState,
    req: &TenantStepRequest,
) -> Result<sqlx::Transaction<'a, sqlx::Postgres>, Response> {
    let mut tx = state.pool.begin().await.map_err(unavailable)?;
    let found: Option<bool> = sqlx::query_scalar(
        "select true from identity.tenant
         where id = $1 and version = $2 and state = 'PROVISIONING' for update",
    )
    .bind(req.tenant_id)
    .bind(req.tenant_version)
    .fetch_optional(&mut *tx)
    .await
    .map_err(unavailable)?;
    if found != Some(true) {
        return Err(metering_error(crate::openmeter::Error::Conflict));
    }
    Ok(tx)
}

async fn metering_operation(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    req: &TenantStepRequest,
) -> Result<MeteringOperation, Response> {
    let workflow_id = crate::component_task::workflow_id(
        "TENANT_LIFECYCLE",
        req.tenant_id,
        &req.tenant_id.to_string(),
        req.tenant_version,
    );
    let action_id: Option<Uuid> = sqlx::query_scalar(
        "select wr.action_execution_id from projection.workflow_ref wr
         join admission.action_execution ae on ae.id = wr.action_execution_id
         where wr.workflow_id = $1 and wr.kind = 'TENANT_LIFECYCLE'
           and wr.tenant_id = $2 and ae.tenant_id = wr.tenant_id
           and ae.operation_id = wr.operation_id and ae.target_id = $2
           and ae.gate_state = 'ALLOWED'
           and wr.projection_state in ('PENDING_START', 'RUNNING', 'UNKNOWN')",
    )
    .bind(&workflow_id)
    .bind(req.tenant_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(unavailable)?;
    let action_id = action_id.ok_or_else(|| metering_error(crate::openmeter::Error::Denied))?;
    let audit = crate::platform_keys::action_audit_context(tx, action_id, req.tenant_id)
        .await
        .map_err(unavailable)?;
    Ok(MeteringOperation {
        workflow_id,
        action_id,
        audit,
    })
}

async fn metering_audit(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: Uuid,
    operation: &MeteringOperation,
    phase: &str,
    event_type: &str,
    result_code: &str,
) -> Result<(), sqlx::Error> {
    let context = &operation.audit;
    crate::audit::append(
        tx,
        crate::audit::AuditEntry {
            event_key: format!("{}:openmeter:customer:{phase}", context.operation_id),
            tenant_id: Some(tenant),
            workspace_id: context.workspace_id,
            operation_id: context.operation_id,
            event_type,
            human_identity_id: None,
            initiator_principal_id: Some(context.initiator_principal_id),
            actor_principal_id: Some(context.actor_principal_id),
            action_key: &context.action_key,
            action_version: context.action_version,
            component_type_key: "openmeter",
            target_type: Some("TENANT"),
            target_id: Some(tenant),
            parameter_hash: &context.parameter_hash,
            decision: if result_code == "EXTERNAL_RESULT_UNKNOWN" {
                "UNKNOWN"
            } else {
                "ALLOW"
            },
            result_code,
            result_exposure: "STATUS",
            evidence_refs: vec![
                crate::audit::Evidence::new(
                    contracts::EvidenceKind::ActionExecutionId,
                    operation.action_id,
                ),
                crate::audit::Evidence::new(
                    contracts::EvidenceKind::TemporalWorkflowId,
                    &operation.workflow_id,
                ),
            ],
            correlation_id: context.correlation_id,
        },
    )
    .await
}

/// 派发后未查明原生结果时，沿同一 Operation 记录 UNKNOWN，不投影成失败。
async fn metering_observation_error(
    mut tx: sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: Uuid,
    operation: &MeteringOperation,
    dispatched: bool,
    error: crate::openmeter::Error,
) -> Response {
    if dispatched {
        if let Err(error) = metering_audit(
            &mut tx,
            tenant,
            operation,
            "unknown",
            "RECONCILIATION",
            "EXTERNAL_RESULT_UNKNOWN",
        )
        .await
        {
            return unavailable(error);
        }
        if let Err(error) = tx.commit().await {
            return unavailable(error);
        }
        return metering_error(crate::openmeter::Error::Unknown);
    }
    metering_error(error)
}

/// DD-38：只存唯一 Customer 引用，不复制计费正文。两个现有 Activity 共用判据。
async fn reconcile_metering_customer(
    state: &ServiceState,
    req: &TenantStepRequest,
    may_create: bool,
) -> Result<(), Response> {
    let mut tx = metering_tenant_tx(state, req).await?;
    let operation = metering_operation(&mut tx, req).await?;
    let binding: Option<(String, String, String, String, i32)> = sqlx::query_as(
        "select namespace, customer_id, subject_key_prefix, status, version
         from projection.openmeter_binding where tenant_id = $1",
    )
    .bind(req.tenant_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(unavailable)?;
    let mut dispatched: bool =
        sqlx::query_scalar("select exists (select 1 from audit.audit_event where event_key = $1)")
            .bind(format!(
                "{}:openmeter:customer:dispatch",
                operation.audit.operation_id
            ))
            .fetch_one(&mut *tx)
            .await
            .map_err(unavailable)?;
    let prefix = format!("{}:", req.tenant_id);
    let customer_id = if let Some((namespace, id, stored_prefix, status, version)) = binding {
        if namespace != state.openmeter.namespace()
            || stored_prefix != prefix
            || status != "ACTIVE"
            || version <= 0
        {
            return Err(metering_error(crate::openmeter::Error::Conflict));
        }
        // ACTIVE 引用丢失 native 对象时只对账，不创建第二个 Customer。
        id
    } else {
        let customer = match state.openmeter.customer_by_key(req.tenant_id).await {
            Ok(customer) => customer,
            Err(error) => {
                return Err(metering_observation_error(
                    tx,
                    req.tenant_id,
                    &operation,
                    dispatched,
                    error,
                )
                .await)
            }
        };
        match customer {
            Some(customer) => customer.id,
            // 没查到不等于没发生：未知 POST 永不自动重发，包括 verify 重试。
            None if dispatched => {
                return Err(metering_observation_error(
                    tx,
                    req.tenant_id,
                    &operation,
                    dispatched,
                    crate::openmeter::Error::Unknown,
                )
                .await)
            }
            None if !may_create => {
                return Err(metering_error(crate::openmeter::Error::Precondition))
            }
            None => {
                metering_audit(
                    &mut tx,
                    req.tenant_id,
                    &operation,
                    "dispatch",
                    "DISPATCH",
                    "DISPATCH_RESULT_UNKNOWN",
                )
                .await
                .map_err(unavailable)?;
                // 同一连接先持久化意图，再重新锁定 Tenant；不在持锁事务内开另一条
                // pool 事务。两次锁之间被暂停/删除或版本变化时，不调用 provider。
                tx.commit().await.map_err(unavailable)?;
                tx = metering_tenant_tx(state, req).await?;
                let current = metering_operation(&mut tx, req).await?;
                if current.action_id != operation.action_id
                    || current.audit.operation_id != operation.audit.operation_id
                    || current.audit.parameter_hash != operation.audit.parameter_hash
                {
                    return Err(metering_error(crate::openmeter::Error::Conflict));
                }
                dispatched = true;
                match state.openmeter.create_customer(req.tenant_id).await {
                    Ok(customer) => customer.id,
                    Err(error) => {
                        // 即使 POST 的响应丢失，原生 key 查询仍能找回同一引用。
                        match state.openmeter.customer_by_key(req.tenant_id).await {
                            Ok(Some(customer)) => customer.id,
                            _ => {
                                return Err(metering_observation_error(
                                    tx,
                                    req.tenant_id,
                                    &operation,
                                    dispatched,
                                    error,
                                )
                                .await);
                            }
                        }
                    }
                }
            }
        }
    };
    let customer = match state
        .openmeter
        .customer_by_id(&customer_id, req.tenant_id)
        .await
    {
        Ok(Some(customer)) => customer,
        Ok(None) => {
            return Err(metering_observation_error(
                tx,
                req.tenant_id,
                &operation,
                dispatched,
                crate::openmeter::Error::Unknown,
            )
            .await)
        }
        Err(error) => {
            return Err(metering_observation_error(
                tx,
                req.tenant_id,
                &operation,
                dispatched,
                error,
            )
            .await)
        }
    };
    let active = match state.openmeter.customer_by_key(req.tenant_id).await {
        Ok(Some(customer)) => customer,
        Ok(None) => {
            return Err(metering_observation_error(
                tx,
                req.tenant_id,
                &operation,
                dispatched,
                crate::openmeter::Error::Unknown,
            )
            .await)
        }
        Err(error) => {
            return Err(metering_observation_error(
                tx,
                req.tenant_id,
                &operation,
                dispatched,
                error,
            )
            .await)
        }
    };
    if !customer.is_active() || active.id != customer_id {
        return Err(metering_observation_error(
            tx,
            req.tenant_id,
            &operation,
            dispatched,
            crate::openmeter::Error::Conflict,
        )
        .await);
    }
    sqlx::query(
        "insert into projection.openmeter_binding
             (tenant_id, namespace, customer_id, subject_key_prefix, status, version)
         values ($1, $2, $3, $4, 'ACTIVE', 1) on conflict (tenant_id) do nothing",
    )
    .bind(req.tenant_id)
    .bind(state.openmeter.namespace())
    .bind(&customer_id)
    .bind(prefix)
    .execute(&mut *tx)
    .await
    .map_err(unavailable)?;
    metering_audit(
        &mut tx,
        req.tenant_id,
        &operation,
        "verified",
        "RECONCILIATION",
        "ACTIVE",
    )
    .await
    .map_err(unavailable)?;
    tx.commit().await.map_err(unavailable)
}

fn metering_error(error: crate::openmeter::Error) -> Response {
    use contracts::ReasonCode;
    let (status, code) = match error {
        crate::openmeter::Error::Denied => (StatusCode::FORBIDDEN, ReasonCode::PermissionDenied),
        crate::openmeter::Error::Precondition => (
            StatusCode::SERVICE_UNAVAILABLE,
            ReasonCode::BindingNotActive,
        ),
        crate::openmeter::Error::Conflict => {
            (StatusCode::CONFLICT, ReasonCode::TargetStateConflict)
        }
        crate::openmeter::Error::Limit => (StatusCode::TOO_MANY_REQUESTS, ReasonCode::RateLimited),
        crate::openmeter::Error::Unknown => (
            StatusCode::SERVICE_UNAVAILABLE,
            ReasonCode::ExternalResultUnknown,
        ),
    };
    (status, Json(code)).into_response()
}

/// `.design/03` §8 的全局 digest 规则：结构化对象按 canonical JSON
/// （键排序、无无意义空白、UTF-8）序列化再 sha256，十六进制表示。
///
/// `serde_json::Value` 的 `Map` 默认按插入序，因此必须显式重排；直接对响应
/// 原文取 hash 会让上游换一次字段顺序就产生一个新 digest。
fn canonical_digest(v: &serde_json::Value) -> String {
    fn canon(v: &serde_json::Value) -> serde_json::Value {
        match v {
            serde_json::Value::Object(m) => {
                let mut keys: Vec<&String> = m.keys().collect();
                keys.sort();
                serde_json::Value::Object(
                    keys.into_iter()
                        .map(|k| (k.clone(), canon(&m[k])))
                        .collect(),
                )
            }
            serde_json::Value::Array(a) => serde_json::Value::Array(a.iter().map(canon).collect()),
            other => other.clone(),
        }
    }
    hex::encode(Sha256::digest(canon(v).to_string().as_bytes()))
}

pub(crate) async fn load_operator(state: &ServiceState) -> Result<OperatorIdentity, Response> {
    let row = sqlx::query!(
        "select pubkey, private_key_secret_ref, private_key_secret_version,
                private_key_secret_audience, audience, relay_operator_api_origin
         from identity.relay_operator_identity
         where catalog_tenant_id = $1 and state = 'ACTIVE'",
        state.catalog_tenant
    )
    .fetch_optional(&state.pool)
    .await
    .map_err(unavailable)?
    .ok_or_else(|| {
        tracing::warn!("Catalog Tenant 没有 active RelayOperatorIdentity");
        StatusCode::SERVICE_UNAVAILABLE.into_response()
    })?;

    let secret = SecretRef {
        locator: row.private_key_secret_ref,
        version: row.private_key_secret_version.unwrap_or_default() as u32,
        audience: row.private_key_secret_audience.unwrap_or_default(),
    };
    let keys = crate::server_identity::read_bound_keys(&state.secrets, &secret, &row.pubkey)
        .await
        .map_err(|e| {
            tracing::warn!(error = %e, "取 operator 私钥失败");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        })?;

    // audience 两侧都来自同一条记录：构造时再比一次，是为了让「这把钥匙服务
    // 哪个部署」在取用点可见，而不是只在写入时校验过一次。
    OperatorIdentity::new(
        &keys.secret_key().to_secret_hex(),
        &row.relay_operator_api_origin,
        &row.audience,
        &row.audience,
    )
    .map_err(|e| {
        tracing::warn!(error = %e, "构造 operator 身份失败");
        StatusCode::SERVICE_UNAVAILABLE.into_response()
    })
}

/// 以 CONTROL 身份建该 Tenant 的一个 Channel，返回 Relay 分配的 UUID。
///
/// 供 `WORKSPACE_LIFECYCLE` 用。放在这里是因为它和上面两步共享同一套身份
/// 取用逻辑——分到另一个模块会把 CONTROL 密钥的取用路径复制成两份。
pub async fn control_client(
    state: &ServiceState,
    tenant_id: Uuid,
) -> Result<(IdentityClient, String), Response> {
    let row = sqlx::query!(
        "select b.normalized_host, i.pubkey, i.private_key_secret_ref,
                i.private_key_secret_version, i.private_key_secret_audience
         from projection.tenant_buzz_binding b
         join identity.buzz_identity_binding i
           on i.tenant_id = b.tenant_id and i.principal_id = b.control_service_principal_id
         where b.tenant_id = $1 and b.state = 'ACTIVE' and i.state = 'ACTIVE'
           and i.custody = 'SERVER'",
        tenant_id
    )
    .fetch_optional(&state.pool)
    .await
    .map_err(unavailable)?
    .ok_or_else(|| StatusCode::FORBIDDEN.into_response())?;

    let secret = SecretRef {
        locator: row.private_key_secret_ref.unwrap_or_default(),
        version: row.private_key_secret_version.unwrap_or_default() as u32,
        audience: row.private_key_secret_audience.unwrap_or_default(),
    };
    let keys = crate::server_identity::read_bound_keys(&state.secrets, &secret, &row.pubkey)
        .await
        .map_err(|e| {
            tracing::warn!(error = %e, "取 CONTROL 私钥失败");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        })?;
    let client = IdentityClient::new(
        Custody::Server,
        &keys.secret_key().to_secret_hex(),
        &state.relay_transport,
        &row.normalized_host,
    )
    .map_err(|e| {
        tracing::warn!(error = %e, "构造 CONTROL 客户端失败");
        StatusCode::FORBIDDEN.into_response()
    })?;
    Ok((client, row.normalized_host))
}

// ---- Workspace ----

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceStepRequest {
    pub workspace_id: Uuid,
    pub workspace_version: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceProvisionResponse {
    pub channel_id: String,
}

/// 建该 Workspace 的 Channel 并查证后落 binding（`DD-01`：一个 Workspace 绑一个
/// Channel）。
///
/// 查证不是走形式：Channel 的标识是 Relay 分配的 UUID（`SF-BUZ-33`），创建事件
/// 的响应给的是 event id，不是它。不回读 kind 39002 就拿不到能用的 channel_id，
/// 拿创建响应去填会得到一个永远匹配不上的绑定。
pub async fn provision_workspace_buzz(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    body: Result<Json<WorkspaceStepRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if let Err(e) = authorize(&state, &headers).await {
        return e;
    }
    let Ok(Json(req)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };

    let ws = match sqlx::query!(
        "select tenant_id, slug from identity.workspace
         where id = $1 and version = $2 and state = 'PROVISIONING'",
        req.workspace_id,
        req.workspace_version
    )
    .fetch_optional(&state.pool)
    .await
    {
        Ok(Some(w)) => w,
        Ok(None) => return StatusCode::CONFLICT.into_response(),
        Err(e) => return unavailable(e),
    };

    // 已绑定即返回既有值。重复建 Channel 会给同一个 Workspace 造出第二个协作
    // 空间，而先前那个里的消息不会跟过来。
    match sqlx::query_scalar!(
        "select channel_id from projection.workspace_buzz_binding where workspace_id = $1",
        req.workspace_id
    )
    .fetch_optional(&state.pool)
    .await
    {
        Ok(Some(id)) => {
            return (
                StatusCode::OK,
                Json(WorkspaceProvisionResponse {
                    channel_id: id.to_string(),
                }),
            )
                .into_response()
        }
        Ok(None) => {}
        Err(e) => return unavailable(e),
    }

    let (control, _) = match control_client(&state, ws.tenant_id).await {
        Ok(c) => c,
        Err(r) => return r,
    };

    // Channel id 取 Workspace id：Channel 在 Community 内按 id 唯一，重试时重发
    // 同一个 id 不会另建。只剩「事件被接受而回应丢失」这一种结果不明，由下面
    // 的回读收敛。
    let channel_uuid = req.workspace_id;
    let channel = channel_uuid.to_string();
    if let Err(e) = control
        .ensure_channel(&state.http, &channel, &ws.slug)
        .await
    {
        tracing::warn!(error = %e, "建立 Channel 失败");
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    // 「已存在」不证明是 CONTROL 建的。CONTROL 是创建者因而在其 roster 上；
    // 不在其 roster 上就不绑定。
    // 快照是 best-effort 发布的，读到旧值时按结果不明交给重试（SF-BUZ-34）。
    let me = control.pubkey_hex();
    match control.roster(&state.http, Scope::Channel(&channel)).await {
        Ok(roster) if roster.iter().any(|e| e.pubkey == me) => {}
        Ok(_) => {
            tracing::warn!(workspace = %req.workspace_id, "CONTROL 不在该 Channel 的 roster 上");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
        Err(e) => {
            tracing::warn!(error = %e, "回读 Channel 失败");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    }

    if let Err(r) = crate::service_api::audit_gate(&state).await {
        return r;
    }
    if let Err(e) = sqlx::query!(
        "insert into projection.workspace_buzz_binding (workspace_id, channel_id, state)
         values ($1, $2, 'ACTIVE') on conflict (workspace_id) do nothing",
        req.workspace_id,
        channel_uuid,
    )
    .execute(&state.pool)
    .await
    {
        return unavailable(e);
    }

    (
        StatusCode::OK,
        Json(WorkspaceProvisionResponse {
            channel_id: channel,
        }),
    )
        .into_response()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceArchiveRequest {
    pub workspace_id: Uuid,
    pub workspace_version: i32,
    pub archived: bool,
}

/// 把 Workspace 的 Channel 收敛到归档或解档（`.design/06` §7.3、SF-BUZ-15）。
///
/// 只在对应的收敛中状态动作：归档要求 `SUSPENDING`，解档要求 `RESTORING`，且版本
/// 与调用方持有的一致——旧 Workflow 的重试不能改动已被新动作接管的 Workspace。
/// Resource、Asset、owner 与 relationship 都不动；Channel 只是停用，不删除。roster 的
/// 清空与重建在另一个端点（`converge_workspace_channel_roster`，DD-97）。
/// 判据是回读的 discovery：读不到目标状态回 503，交给 Workflow 按结果不明重试。
pub async fn converge_workspace_channel_archive(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    body: Result<Json<WorkspaceArchiveRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if let Err(e) = authorize(&state, &headers).await {
        return e;
    }
    let Ok(Json(req)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let converging = if req.archived {
        "SUSPENDING"
    } else {
        "RESTORING"
    };
    let (tenant_id, channel_id) =
        match converging_channel(&state, req.workspace_id, req.workspace_version, converging).await
        {
            Ok(r) => r,
            Err(r) => return r,
        };
    let (control, _) = match control_client(&state, tenant_id).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    match control
        .converge_channel_archived(&state.http, &channel_id.to_string(), req.archived)
        .await
    {
        Ok(true) => StatusCode::OK.into_response(),
        Ok(false) => {
            tracing::warn!(workspace = %req.workspace_id, archived = req.archived, "Channel 归档状态回读未达目标");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
        Err(e) => {
            tracing::warn!(error = %e, "收敛 Channel 归档状态失败");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}

/// 收敛中 Workspace 的 Tenant 与 Channel：Workspace 须停在调用方持有的版本与给定的
/// 收敛中状态，且 WorkspaceBuzzBinding 为 ACTIVE。任一不成立回 409——旧 Workflow 的
/// 重试不能改动已被新动作接管、或协作面本身未就绪的 Workspace。
async fn converging_channel(
    state: &ServiceState,
    workspace_id: Uuid,
    workspace_version: i32,
    converging: &str,
) -> Result<(Uuid, Uuid), Response> {
    match sqlx::query_as::<_, (Uuid, Uuid)>(
        "select w.tenant_id, b.channel_id from identity.workspace w
         join projection.workspace_buzz_binding b on b.workspace_id = w.id
         where w.id = $1 and w.version = $2 and w.state = $3 and b.state = 'ACTIVE'",
    )
    .bind(workspace_id)
    .bind(workspace_version)
    .bind(converging)
    .fetch_optional(&state.pool)
    .await
    {
        Ok(Some(r)) => Ok(r),
        Ok(None) => Err(StatusCode::CONFLICT.into_response()),
        Err(e) => Err(unavailable(e)),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum RosterMode {
    /// 暂停：归档前把 roster 清空为只剩 CONTROL
    Clear,
    /// 恢复：解档后按 Core 事实重建
    Rebuild,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRosterRequest {
    pub workspace_id: Uuid,
    pub workspace_version: i32,
    pub mode: RosterMode,
}

/// 暂停与恢复时 Channel roster 的清空与重建（DD-97、`.design/06` §7.3）。
///
/// 归档不驱逐已建立的订阅、读取也不查归档状态，roster 原样保留时原生端仍可读。
/// 因此 `CLEAR`（要求 `SUSPENDING`）把 roster 收敛到只剩 CONTROL；`REBUILD`（要求
/// `RESTORING`）收敛到 CONTROL 加该 Workspace 全部 ACTIVE 成员的全部 ACTIVE Buzz
/// 身份——与 roster 对账度量同一个「应在」集合（`roster_reconcile::settled_channel_roster`）；
/// 仍在建立或撤权途中的钥匙留给各自的投影 Workflow。AGENT 身份的 ChannelAgentBinding
/// 随 Stage 5 交付，届时并入期望集合。多余的逐个 9001 移出、缺少的逐个 9000 加入，
/// 每一步以回读的 39002 为判据。
///
/// 收敛后再按当前事实重算一次期望集合并回读比对：重建期间成员或设备被撤、
/// 期望集合变了，就回 503 让 Workflow 重试，而不是把旧快照当成结论。
pub async fn converge_workspace_channel_roster(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    body: Result<Json<WorkspaceRosterRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if let Err(e) = authorize(&state, &headers).await {
        return e;
    }
    let Ok(Json(req)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let converging = match req.mode {
        RosterMode::Clear => "SUSPENDING",
        RosterMode::Rebuild => "RESTORING",
    };
    let (tenant_id, channel_id) =
        match converging_channel(&state, req.workspace_id, req.workspace_version, converging).await
        {
            Ok(r) => r,
            Err(r) => return r,
        };
    let (control, _) = match control_client(&state, tenant_id).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    match converge_channel_roster(
        &state,
        &control,
        tenant_id,
        req.workspace_id,
        channel_id,
        req.mode,
    )
    .await
    {
        Ok(true) => StatusCode::OK.into_response(),
        Ok(false) => {
            tracing::warn!(workspace = %req.workspace_id, mode = ?req.mode, "Channel roster 未与期望一致");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
        Err(r) => r,
    }
}

/// 把一个 Workspace 的 Channel roster 收敛到 CLEAR 或 REBUILD 的目标集合（DD-97）。
/// Workspace 暂停/恢复与 Tenant 恢复的 roster 段共用这一处。
///
/// (应在, 收敛中)。CLEAR 只认回读到的 roster：除 CONTROL 外一概移出，不按 Core 集合
/// 去删——Core 之外混进 roster 的钥匙同样必须清掉。REBUILD 不替仍在建立或撤权途中的
/// 钥匙下结论：它们由各自的投影 Workflow 收敛（与对账度量同一口径）。收敛后按当前
/// 事实重算期望并与回读比对；未收敛或不一致回 `Ok(false)`。
async fn converge_channel_roster(
    state: &ServiceState,
    control: &IdentityClient,
    tenant_id: Uuid,
    workspace_id: Uuid,
    channel_id: Uuid,
    mode: RosterMode,
) -> Result<bool, Response> {
    let control_pubkey = control.pubkey_hex();
    let expected = || async {
        match mode {
            RosterMode::Clear => Ok((HashSet::from([control_pubkey.clone()]), HashSet::new())),
            RosterMode::Rebuild => {
                let pool = &state.pool;
                let settled = crate::roster_reconcile::settled_channel_roster(
                    pool,
                    control_pubkey.clone(),
                    tenant_id,
                    workspace_id,
                )
                .await
                .map_err(unavailable)?;
                let unsettled = crate::roster_reconcile::unsettled_channel_roster(
                    pool,
                    tenant_id,
                    workspace_id,
                )
                .await
                .map_err(unavailable)?;
                Ok::<_, Response>((settled, unsettled))
            }
        }
    };
    let (want, tolerated) = expected().await?;
    let channel = channel_id.to_string();
    let scope = Scope::Channel(&channel);
    let current = read_roster(state, control, scope).await?;
    for (pubkey, presence) in &roster_plan(&current, &want, &tolerated, &control_pubkey) {
        if let Err(e) = control
            .converge(&state.http, scope, pubkey, *presence)
            .await
        {
            tracing::info!(workspace = %workspace_id, error = %e, "Channel roster 未收敛，等待重试");
            return Ok(false);
        }
    }
    let (want, tolerated) = expected().await?;
    let after = read_roster(state, control, scope).await?;
    Ok(roster_settled(&after, &want, &tolerated, &control_pubkey))
}

/// 把回读到的 roster 收敛到期望集合所需的变更：多余的移出、缺少的加入。CONTROL
/// 是 Channel 的 owner，不移出也不由自己加入；`tolerated`（仍在建立或撤权途中的钥匙）
/// 两个方向都不动。先移出再加入。
fn roster_plan(
    current: &HashSet<String>,
    want: &HashSet<String>,
    tolerated: &HashSet<String>,
    control: &str,
) -> Vec<(String, Presence)> {
    let mut plan: Vec<(String, Presence)> = current
        .iter()
        .filter(|k| !want.contains(*k) && !tolerated.contains(*k) && *k != control)
        .map(|k| (k.clone(), Presence::Absent))
        .collect();
    plan.extend(
        want.iter()
            .filter(|k| !current.contains(*k) && *k != control)
            .map(|k| (k.clone(), Presence::Present)),
    );
    plan
}

/// 回读的 roster 与期望在 CONTROL 与 `tolerated` 之外逐一相等。
fn roster_settled(
    after: &HashSet<String>,
    want: &HashSet<String>,
    tolerated: &HashSet<String>,
    control: &str,
) -> bool {
    let decided = |set: &HashSet<String>| {
        set.iter()
            .filter(|k| *k != control && !tolerated.contains(*k))
            .cloned()
            .collect::<HashSet<_>>()
    };
    decided(after) == decided(want)
}

async fn read_roster(
    state: &ServiceState,
    control: &IdentityClient,
    scope: Scope<'_>,
) -> Result<HashSet<String>, Response> {
    control
        .roster(&state.http, scope)
        .await
        .map(|r| r.into_iter().map(|e| e.pubkey).collect())
        .map_err(|e| {
            tracing::info!(error = %e, "Channel roster 读取失败");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        })
}

#[cfg(test)]
mod roster_tests {
    use super::{roster_plan, roster_settled};
    use collab_bridge::bridge::Presence;
    use std::collections::HashSet;

    fn set(keys: &[&str]) -> HashSet<String> {
        keys.iter().map(|k| (*k).to_owned()).collect()
    }

    #[test]
    fn clear_removes_every_member_read_back_except_control() {
        // CLEAR 的期望只有 CONTROL：Core 之外混进 roster 的钥匙同样移出
        let plan = roster_plan(&set(&["c", "a", "stray"]), &set(&["c"]), &set(&[]), "c");
        assert!(plan.iter().all(|(_, p)| *p == Presence::Absent));
        let removed: HashSet<String> = plan.into_iter().map(|(k, _)| k).collect();
        assert_eq!(removed, set(&["a", "stray"]));
        assert!(roster_settled(&set(&["c"]), &set(&["c"]), &set(&[]), "c"));
        assert!(!roster_settled(
            &set(&["c", "a"]),
            &set(&["c"]),
            &set(&[]),
            "c"
        ));
    }

    #[test]
    fn rebuild_adds_missing_removes_extra_and_leaves_in_flight_keys() {
        let plan = roster_plan(
            &set(&["c", "old", "pending"]),
            &set(&["c", "a", "b"]),
            &set(&["pending"]),
            "c",
        );
        let mut got: Vec<(String, bool)> = plan
            .into_iter()
            .map(|(k, p)| (k, p == Presence::Present))
            .collect();
        got.sort();
        assert_eq!(
            got,
            vec![
                ("a".to_owned(), true),
                ("b".to_owned(), true),
                ("old".to_owned(), false)
            ]
        );
        assert!(roster_settled(
            &set(&["c", "a", "b", "pending"]),
            &set(&["c", "a", "b"]),
            &set(&["pending"]),
            "c"
        ));
        assert!(!roster_settled(
            &set(&["c", "a"]),
            &set(&["c", "a", "b"]),
            &set(&[]),
            "c"
        ));
    }
}

// ---- 业务 Tenant 的暂停与恢复（DD-96、`.design/06` §7.2 第 1–2 步） ----

/// 收敛中 Tenant 的协作面事实：Community host 与 CONTROL（Community owner）的 pubkey
/// 与 Principal。Tenant 须停在调用方持有的版本与给定的收敛中状态之一，TenantBuzzBinding
/// 与 CONTROL binding 都须 ACTIVE；任一不成立回 409——旧 Workflow 的重试不能改动已被
/// 新动作接管的 Tenant。
async fn converging_tenant(
    state: &ServiceState,
    tenant_id: Uuid,
    tenant_version: i32,
    converging: &[&str],
) -> Result<(String, String, Uuid), Response> {
    match sqlx::query_as::<_, (String, String, Uuid)>(
        "select b.normalized_host, i.pubkey, b.control_service_principal_id
         from identity.tenant t
         join projection.tenant_buzz_binding b on b.tenant_id = t.id
         join identity.buzz_identity_binding i
           on i.tenant_id = b.tenant_id and i.principal_id = b.control_service_principal_id
         where t.id = $1 and t.version = $2 and t.state = any($3)
           and b.state = 'ACTIVE' and i.kind = 'CONTROL' and i.state = 'ACTIVE'",
    )
    .bind(tenant_id)
    .bind(tenant_version)
    .bind(converging)
    .fetch_optional(&state.pool)
    .await
    {
        Ok(Some(r)) => Ok(r),
        Ok(None) => Err(StatusCode::CONFLICT.into_response()),
        Err(e) => Err(unavailable(e)),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TenantArchiveRequest {
    pub tenant_id: Uuid,
    pub tenant_version: i32,
    pub archived: bool,
}

/// 以 RelayOperatorIdentity 把业务 Tenant 的 Buzz Community 收敛到归档或解档
/// （DD-96(3)(4)、SF-BUZ-43、SS-BUZ-OPERATOR）。
///
/// 归档要求 `SUSPENDING`，或 `RESTORING`（恢复在解档之后失败时的补偿归档）；解档要求
/// `RESTORING`。两者都要求版本一致、协作面 binding 与 CONTROL binding ACTIVE。owner
/// 断言取该 Tenant 的 CONTROL pubkey，目标是它的 Community host；operator 只签名，
/// 每次请求重新签名。
///
/// 归档每次都重发（上游对已归档的 host 以 COALESCE 保留原 `archived_at`，重发幂等）：
/// 上游的 200 才表示集群内连接已断开，503 表示 `archived_at` 已落库而断开传播未完成、
/// 上游要求重发——此时回 503 交给 Workflow 重试，不以回读代替。只有上游 200 且
/// `GET /operator/communities` 回读该 host 的 `archived_at` 非空才回 200。
///
/// 解档没有断开传播：先回读，已解档即不再发送；发送后以回读 `archived_at` 为空为准。
///
/// owner 或 host 对不上（404）等确定拒绝回 409；其余结果不明回 503。
pub async fn converge_tenant_community_archive(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    body: Result<Json<TenantArchiveRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if let Err(e) = authorize(&state, &headers).await {
        return e;
    }
    let Ok(Json(req)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let converging: &[&str] = if req.archived {
        &["SUSPENDING", "RESTORING"]
    } else {
        &["RESTORING"]
    };
    let (host, owner, _) =
        match converging_tenant(&state, req.tenant_id, req.tenant_version, converging).await {
            Ok(r) => r,
            Err(r) => return r,
        };
    let operator = match load_operator(&state).await {
        Ok(o) => o,
        Err(r) => return r,
    };
    if !req.archived {
        match community_archived(&state, &operator, &owner, &host).await {
            Ok(Some(false)) => return StatusCode::OK.into_response(),
            Ok(_) => {}
            Err(r) => return r,
        }
    }
    let sent = if req.archived {
        operator.archive_community(&state.http, &host, &owner).await
    } else {
        operator
            .unarchive_community(&state.http, &host, &owner)
            .await
    };
    match sent {
        Ok(_) => {}
        Err(OperatorError::Rejected { status, body })
            if (400..500).contains(&status) && status != 401 =>
        {
            tracing::warn!(tenant = %req.tenant_id, status, body = %body, "operator 确定拒绝归档状态变更");
            return StatusCode::CONFLICT.into_response();
        }
        // 含上游 503（归档已落库、断开传播未完成）：按上游要求重发
        Err(e) => {
            tracing::warn!(tenant = %req.tenant_id, error = %e, "operator 归档状态变更未完成或结果不明");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    }
    match community_archived(&state, &operator, &owner, &host).await {
        Ok(Some(now)) if now == req.archived => StatusCode::OK.into_response(),
        Ok(_) => {
            tracing::warn!(tenant = %req.tenant_id, archived = req.archived, "Community 归档状态回读未达目标");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
        Err(r) => r,
    }
}

/// 回读该 owner 名下 host 的归档状态。列表里没有这个 host 回 `None`：不存在与未归档
/// 不是一回事。
async fn community_archived(
    state: &ServiceState,
    operator: &OperatorIdentity,
    owner: &str,
    host: &str,
) -> Result<Option<bool>, Response> {
    let rows = operator
        .list_owned_communities(&state.http, owner)
        .await
        .map_err(|e| {
            tracing::warn!(error = %e, "operator 列表回读失败");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        })?;
    Ok(rows
        .iter()
        .find(|c| c.host.eq_ignore_ascii_case(host))
        .map(|c| c.archived_at.is_some()))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum RestorePhase {
    /// 解档之前：secret/binding 与 SpiceDB
    Bindings,
    /// 解档之后：relay roster（已归档的 host 不解析，roster 读写都要求已解档）
    Roster,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TenantRestoreRequest {
    pub tenant_id: Uuid,
    pub tenant_version: i32,
    pub phase: RestorePhase,
}

/// 业务 Tenant 恢复的对账（DD-96(4)、`.design/06` §7.2 第 2 步），要求 `RESTORING`。
///
/// - `BINDINGS`：TenantBuzzBinding 与 CONTROL binding ACTIVE，CONTROL 私钥可读回并与
///   公钥一致（与建立时的查证同一实现）；每个 ACTIVE TenantMembership 的 SpiceDB
///   `tenant#member` 关系存在——以幂等 TOUCH 收敛，再以 FullyConsistent 读回查证。
/// - `ROSTER`：relay roster 收敛到 CONTROL 加全部 ACTIVE TenantMembership 对应 Principal
///   的全部 ACTIVE Buzz 身份（与 roster 对账度量同一个「应在」集合）；随后各 Workspace
///   的 Channel roster 按 DD-97 同一期望集合收敛：ACTIVE 的按成员事实重建，其余只剩
///   CONTROL。仍在建立或撤权途中的钥匙留给各自的投影 Workflow。roster 的读写都经
///   Community host，因此本段成功也是 host 已重新解析的证明。
///
/// Gateway route 与组件 scope 在 Stage 2 没有适用对象：本端点不做也不声称做了。
/// 不解档任何 Workspace、不改动 Workspace 状态。全部一致才 200，否则 503。
pub async fn restore_reconcile(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    body: Result<Json<TenantRestoreRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if let Err(e) = authorize(&state, &headers).await {
        return e;
    }
    let Ok(Json(req)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let (_, _, control_principal) =
        match converging_tenant(&state, req.tenant_id, req.tenant_version, &["RESTORING"]).await {
            Ok(r) => r,
            Err(r) => return r,
        };
    let converged = match req.phase {
        RestorePhase::Bindings => {
            if let Err(r) = verify_control_secret(&state, req.tenant_id, control_principal).await {
                return r;
            }
            reconcile_tenant_relationships(&state, req.tenant_id).await
        }
        RestorePhase::Roster => reconcile_relay_roster(&state, req.tenant_id).await,
    };
    match converged {
        Ok(true) => StatusCode::OK.into_response(),
        Ok(false) => {
            tracing::warn!(tenant = %req.tenant_id, phase = ?req.phase, "Tenant 恢复对账未一致");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
        Err(r) => r,
    }
}

/// 每个 ACTIVE TenantMembership 的 `tenant#member` 关系：TOUCH 收敛（幂等），再读回
/// 查证全部在场。写入分批，批大小取 SpiceDB 读页上界这一既有部署事实。
async fn reconcile_tenant_relationships(
    state: &ServiceState,
    tenant_id: Uuid,
) -> Result<bool, Response> {
    let members: Vec<Uuid> = sqlx::query_scalar(
        "select tenant_principal_id from identity.tenant_membership
         where tenant_id = $1 and state = 'ACTIVE'",
    )
    .bind(tenant_id)
    .fetch_all(&state.pool)
    .await
    .map_err(unavailable)?;
    let spicedb = &state.governance.spicedb;
    let page = state.governance.cfg.relationship_page;
    let object = tenant_id.to_string();
    let relationship = |principal: &Uuid| crate::spicedb::Relationship {
        object_type: "tenant".to_owned(),
        object_id: object.clone(),
        relation: "member".to_owned(),
        subject_principal: principal.to_string(),
    };
    for chunk in members.chunks(page.max(1) as usize) {
        let updates: Vec<_> = chunk
            .iter()
            .map(|m| (crate::spicedb::Write::Touch, relationship(m)))
            .collect();
        if let Err(e) = spicedb.write(&updates).await {
            tracing::warn!(error = %e, "SpiceDB tenant 成员关系收敛结果不明");
            return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
        }
    }
    let present: HashSet<String> = spicedb
        .read(
            &crate::spicedb::RelationshipFilter {
                object_type: "tenant",
                object_id: Some(&object),
                relation: Some("member"),
                subject_principal: None,
            },
            page,
        )
        .await
        .map_err(|e| {
            tracing::warn!(error = %e, "SpiceDB tenant 成员关系读回失败");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        })?
        .into_iter()
        .map(|r| r.subject_principal)
        .collect();
    Ok(members.iter().all(|m| present.contains(&m.to_string())))
}

/// relay roster 按 Core 事实收敛：多余的移出、缺少的加入，收敛后按当前事实重算并与
/// 回读比对。
async fn reconcile_relay_roster(state: &ServiceState, tenant_id: Uuid) -> Result<bool, Response> {
    let (control, _) = control_client(state, tenant_id).await?;
    let control_pubkey = control.pubkey_hex();
    let expected = || async {
        let settled = crate::roster_reconcile::settled_relay_roster(
            &state.pool,
            control_pubkey.clone(),
            tenant_id,
        )
        .await
        .map_err(unavailable)?;
        let unsettled = crate::roster_reconcile::unsettled_relay_roster(&state.pool, tenant_id)
            .await
            .map_err(unavailable)?;
        Ok::<_, Response>((settled, unsettled))
    };
    let (want, tolerated) = expected().await?;
    let current = read_roster(state, &control, Scope::Relay).await?;
    for (pubkey, presence) in &roster_plan(&current, &want, &tolerated, &control_pubkey) {
        if let Err(e) = control
            .converge(&state.http, Scope::Relay, pubkey, *presence)
            .await
        {
            tracing::info!(tenant = %tenant_id, error = %e, "relay roster 未收敛，等待重试");
            return Ok(false);
        }
    }
    let (want, tolerated) = expected().await?;
    let after = read_roster(state, &control, Scope::Relay).await?;
    if !roster_settled(&after, &want, &tolerated, &control_pubkey) {
        return Ok(false);
    }
    // 各 Workspace 的 Channel roster 按 DD-97 同一期望集合收敛：ACTIVE 的按成员事实重建，
    // 其余（暂停中、已暂停、恢复中等）期望只剩 CONTROL。不解档、不改动任何 Workspace 状态
    let channels: Vec<(Uuid, String, Uuid)> = sqlx::query_as(
        "select w.id, w.state, b.channel_id from identity.workspace w
         join projection.workspace_buzz_binding b on b.workspace_id = w.id
         where w.tenant_id = $1 and b.state = 'ACTIVE'",
    )
    .bind(tenant_id)
    .fetch_all(&state.pool)
    .await
    .map_err(unavailable)?;
    for (workspace_id, ws_state, channel_id) in channels {
        let mode = if ws_state == "ACTIVE" {
            RosterMode::Rebuild
        } else {
            RosterMode::Clear
        };
        if !converge_channel_roster(state, &control, tenant_id, workspace_id, channel_id, mode)
            .await?
        {
            return Ok(false);
        }
    }
    Ok(true)
}
