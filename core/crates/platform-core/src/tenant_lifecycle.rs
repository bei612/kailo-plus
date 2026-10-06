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

/// 治理对账器审计 NIP-11 漂移时的 action key。
pub const NIP11_RECONCILE_ACTION: &str = "tenant.buzz_binding.nip11_reconcile";

/// 一轮 NIP-11 漂移对账的结果。
pub struct DriftPass {
    /// 每个被检查的 binding 的结论，供度量按阶段计数
    pub outcomes: Vec<&'static str>,
    /// 此刻因漂移停在 `RECONCILING` 的 binding 数：非零即告警
    pub unverified: u64,
}

/// 按 Tenant id 轮转的对账游标：批次有上界时，每轮从上次停下的地方继续。
static DRIFT_CURSOR: std::sync::Mutex<Option<Uuid>> = std::sync::Mutex::new(None);

/// TenantBuzzBinding 的 NIP-11 漂移对账（DD-114(2)–(4)，由治理对账器每轮调用）。
///
/// 对每个 `ACTIVE` binding 以 `normalized_host` 抓 NIP-11：抓取失败不迁移（传输失败不是
/// 不一致的证据）；摘要与快照相同则不动（存量行在此登记 `self`，见迁移说明）；不同
/// 则以条件更新转 `RECONCILING` 并写审计，随即以 verify 步的同一查证实现
/// （[`judge_nip11`]、[`commit_verified`]）重新查证。漂移后停在 `RECONCILING` 的
/// binding 每轮重试，满足接受条件即回到 `ACTIVE`，否则保持并告警。
pub async fn reconcile_nip11_drift(state: &ServiceState, batch: i64) -> Result<DriftPass, String> {
    let sql = format!(
        "select {FACTS_COLUMNS}
         from projection.tenant_buzz_binding b
         join identity.tenant t on t.id = b.tenant_id
         where ((b.state = 'ACTIVE' and t.state = 'ACTIVE')
                or (b.state = 'RECONCILING' and b.nip11_snapshot_digest is not null))
           and ($1::uuid is null or b.tenant_id > $1)
         order by b.tenant_id limit $2"
    );
    let select = |after: Option<Uuid>| {
        sqlx::query_as::<_, FactsRow>(&sql)
            .bind(after)
            .bind(batch)
            .fetch_all(&state.pool)
    };
    let after = *DRIFT_CURSOR.lock().unwrap_or_else(|e| e.into_inner());
    let mut rows = select(after).await.map_err(|e| e.to_string())?;
    if rows.is_empty() && after.is_some() {
        rows = select(None).await.map_err(|e| e.to_string())?;
    }
    *DRIFT_CURSOR.lock().unwrap_or_else(|e| e.into_inner()) = rows
        .last()
        .map(|r| r.0)
        .filter(|_| rows.len() as i64 >= batch);

    let mut outcomes = Vec::with_capacity(rows.len());
    for row in rows {
        let (tenant, facts) = into_facts(row);
        outcomes.push(drift_one(state, tenant, facts).await);
    }

    let unverified: i64 = sqlx::query_scalar(
        "select count(*)::bigint from projection.tenant_buzz_binding
         where state = 'RECONCILING' and nip11_snapshot_digest is not null",
    )
    .fetch_one(&state.pool)
    .await
    .map_err(|e| e.to_string())?;
    if unverified > 0 {
        tracing::warn!(
            unverified,
            "TenantBuzzBinding 因 NIP-11 漂移停在 RECONCILING，协作面对这些 Tenant 关闭"
        );
    }
    Ok(DriftPass {
        outcomes,
        unverified: unverified.max(0) as u64,
    })
}

async fn drift_one(state: &ServiceState, tenant: Uuid, mut facts: BindingFacts) -> &'static str {
    let doc = match fetch_nip11_document(state, &facts.host).await {
        Ok(d) => d,
        Err(e) => {
            tracing::info!(tenant = %tenant, error = %e, "对账抓 NIP-11 失败，不迁移状态");
            return "NIP11_FETCH_FAILED";
        }
    };
    if facts.state == "ACTIVE" {
        let Some(old) = facts.digest.clone() else {
            return "NIP11_SNAPSHOT_MISSING";
        };
        let observed = collab_bridge::limits::canonical_digest(&doc);
        if observed == old {
            if facts.relay_self.is_some() {
                return "NIP11_UNCHANGED";
            }
            // 摘要相等：这就是当时查证过的文档，其中的 `self` 就是查证过的值
            let Some(relay_self) = doc.get("self").and_then(|v| v.as_str()) else {
                return "NIP11_UNCHANGED";
            };
            return match sqlx::query(
                "update projection.tenant_buzz_binding set relay_self_pubkey = $2
                 where tenant_id = $1 and state = 'ACTIVE' and version = $3
                   and nip11_snapshot_digest = $4 and relay_self_pubkey is null
                   and $2 ~ '^[0-9a-f]{64}$'",
            )
            .bind(tenant)
            .bind(relay_self)
            .bind(facts.version)
            .bind(&old)
            .execute(&state.pool)
            .await
            {
                Ok(r) if r.rows_affected() == 1 => "NIP11_SELF_REGISTERED",
                Ok(_) => "NIP11_UNCHANGED",
                Err(e) => {
                    tracing::warn!(tenant = %tenant, error = %e, "登记 Relay self 失败");
                    "NIP11_WRITE_FAILED"
                }
            };
        }

        // 进入：条件更新（仍 ACTIVE、原 digest 与原 version 均未变）并在同一事务写审计
        let entered: Result<bool, sqlx::Error> = async {
            let mut tx = state.pool.begin().await?;
            let n = sqlx::query(
                "update projection.tenant_buzz_binding
                 set state = 'RECONCILING', version = version + 1
                 where tenant_id = $1 and state = 'ACTIVE'
                   and nip11_snapshot_digest = $2 and version = $3",
            )
            .bind(tenant)
            .bind(&old)
            .bind(facts.version)
            .execute(&mut *tx)
            .await?
            .rows_affected();
            if n == 0 {
                return Ok(false);
            }
            let digests = digest_pair(&old, &observed);
            crate::audit::append(
                &mut tx,
                drift_audit(tenant, facts.version + 1, "NIP11_DRIFT", &digests),
            )
            .await?;
            tx.commit().await?;
            Ok(true)
        }
        .await;
        match entered {
            Ok(true) => {
                tracing::warn!(tenant = %tenant, old = %old, new = %observed, "NIP-11 漂移，binding 转 RECONCILING");
                facts.state = "RECONCILING".to_owned();
                facts.version += 1;
            }
            Ok(false) => return "NIP11_RACED",
            Err(e) => {
                tracing::warn!(tenant = %tenant, error = %e, "NIP-11 漂移未能落账");
                return "NIP11_WRITE_FAILED";
            }
        }
    }

    // 出口：verify 步的同一查证实现
    match judge_nip11(&doc, facts.expectation()) {
        Err(why) => {
            tracing::warn!(
                tenant = %tenant,
                reason = why.code(),
                "NIP-11 未通过重新查证，binding 保持 RECONCILING"
            );
            "NIP11_UNVERIFIED"
        }
        Ok(accepted) => match commit_verified(&state.pool, tenant, &facts, &accepted).await {
            Ok(true) => "NIP11_REVERIFIED",
            Ok(false) => "NIP11_RACED",
            Err(e) => {
                tracing::warn!(tenant = %tenant, error = %e, "重新查证结果未能落账");
                "NIP11_WRITE_FAILED"
            }
        },
    }
}

/// 抓 NIP-11、按 DD-114 的接受条件查证、把 binding 推进到 `ACTIVE`。
///
/// 只对 `RECONCILING` 的 binding 写快照。已 `ACTIVE` 的 binding 不在这里改写快照
/// （DD-114(5)）：它的快照只经治理对账器的漂移路径 `ACTIVE→RECONCILING→ACTIVE`
/// 改写。Workflow 重放到这一步时 binding 已 ACTIVE，只补做 CONTROL 身份的激活。
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

    let binding = match binding_facts(&state.pool, req.tenant_id).await {
        Ok(Some(b)) if b.state == "RECONCILING" || b.state == "ACTIVE" => b,
        Ok(_) => return StatusCode::CONFLICT.into_response(),
        Err(e) => return unavailable(e),
    };

    let digest = if binding.state == "ACTIVE" {
        match binding.digest.clone() {
            Some(d) => d,
            // ACTIVE 必带快照（表约束）；读不到说明库与约束不一致，不当成功
            None => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
        }
    } else {
        // NIP-11 按 Community host 抓：Relay 按 Host 绑定 Community，用网络地址
        // 抓到的是另一个 Community 的文档（`SF-BUZ-32`）。
        let doc = match fetch_nip11_document(&state, &binding.host).await {
            Ok(d) => d,
            Err(e) => {
                tracing::warn!(error = %e, "抓 NIP-11 失败");
                return StatusCode::SERVICE_UNAVAILABLE.into_response();
            }
        };
        // 观测而非采信配置：同一套接受条件既用于建立，也用于漂移后的重新查证
        let accepted = match judge_nip11(&doc, binding.expectation()) {
            Ok(a) => a,
            Err(why) => {
                tracing::warn!(
                    host = %binding.host,
                    reason = why.code(),
                    "NIP-11 未通过查证，binding 不开放"
                );
                return StatusCode::FORBIDDEN.into_response();
            }
        };

        // Community 已接受 owner pubkey 仍不足以证明 Core 持有对应私钥。CONTROL
        // binding 与 Tenant binding 开放前，必须读回钉住的 KV 版本并核对公钥。
        if let Err(r) =
            verify_control_secret(&state, req.tenant_id, binding.control_principal).await
        {
            return r;
        }
        if let Err(r) = crate::service_api::audit_gate(&state).await {
            return r;
        }
        match commit_verified(&state.pool, req.tenant_id, &binding, &accepted).await {
            Ok(true) => {}
            // 期间 binding 已被别处推进：本次不写，重试会读到新状态
            Ok(false) => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
            Err(e) => return unavailable(e),
        }
        accepted.digest
    };

    // CONTROL 身份在其 Community owner 身份查证后才 ACTIVE：它是 Community 的
    // owner，而 owner 身份恰恰由刚才的 provision 建立并被 Relay 接受。绑定版本的
    // 引用在同一句里由 PENDING 转 ACTIVE（`.design/03` SecretRef 状态机）。
    if let Err(e) = sqlx::query(
        "update identity.buzz_identity_binding
         set state = 'ACTIVE', version = version + 1, private_key_secret_status = 'ACTIVE'
         where tenant_id = $1 and principal_id = $2 and state = 'RECONCILING'",
    )
    .bind(req.tenant_id)
    .bind(binding.control_principal)
    .execute(&state.pool)
    .await
    {
        return unavailable(e);
    }

    (
        StatusCode::OK,
        Json(VerifyResponse {
            nip11_digest: digest,
            membership_enforced: true,
        }),
    )
        .into_response()
}

/// 原 Tenant Workflow 已冻结的动作，而不是按时间挑一条最近的 ActionExecution。
struct MeteringOperation {
    workflow_id: Option<String>,
    action_id: Uuid,
    audit: crate::platform_keys::ActionAuditContext,
    zed_token: Option<String>,
}

#[derive(Clone, Copy)]
enum CustomerAdmission<'a> {
    Lifecycle,
    Bootstrap {
        action_id: Uuid,
        spicedb: &'a crate::spicedb::SpiceDb,
    },
}

async fn metering_tenant_tx<'a>(
    pool: &'a sqlx::PgPool,
    req: &TenantStepRequest,
    admission: CustomerAdmission<'_>,
) -> Result<sqlx::Transaction<'a, sqlx::Postgres>, Response> {
    let mut tx = pool.begin().await.map_err(unavailable)?;
    // 部署补齐不重启已终态的 Tenant Workflow；沿原 AE → Tenant 锁序，
    // 重新取得 ACTIVE scope 后才读/写原生 Customer。
    if let CustomerAdmission::Bootstrap { action_id, .. } = admission {
        let allowed: Option<bool> = sqlx::query_scalar(
            "select true from admission.action_execution
             where id=$1 and tenant_id=$2 and target_id=$2 and action_key=$3
               and gate_state='ALLOWED'
               and dispatch_state in ('NOT_DISPATCHED','UNKNOWN','DISPATCHED')
               and temporal_workflow_id is null for update",
        )
        .bind(action_id)
        .bind(req.tenant_id)
        .bind(crate::tenant_bootstrap::ACTION_KEY)
        .fetch_optional(&mut *tx)
        .await
        .map_err(unavailable)?;
        if allowed != Some(true) {
            return Err(metering_error(crate::openmeter::Error::Denied));
        }
    }
    let bootstrap = matches!(admission, CustomerAdmission::Bootstrap { .. });
    let found: Option<bool> = sqlx::query_scalar(
        "select true from identity.tenant
         where id = $1
           and (($3 and state='ACTIVE')
                or (not $3 and version=$2 and state='PROVISIONING')) for update",
    )
    .bind(req.tenant_id)
    .bind(req.tenant_version)
    .bind(bootstrap)
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
    admission: CustomerAdmission<'_>,
    namespace: &str,
) -> Result<MeteringOperation, Response> {
    if let CustomerAdmission::Bootstrap { action_id, spicedb } = admission {
        let (audit, zed_token) = crate::tenant_bootstrap::metering_context(
            &mut *tx,
            spicedb,
            action_id,
            req.tenant_id,
            namespace,
        )
        .await
        .map_err(metering_error)?;
        return Ok(MeteringOperation {
            workflow_id: None,
            action_id,
            audit,
            zed_token: Some(zed_token),
        });
    }
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
        workflow_id: Some(workflow_id),
        action_id,
        audit,
        zed_token: None,
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
    let mut evidence = vec![crate::audit::Evidence::new(
        contracts::EvidenceKind::ActionExecutionId,
        operation.action_id,
    )];
    if let Some(workflow) = &operation.workflow_id {
        evidence.push(crate::audit::Evidence::new(
            contracts::EvidenceKind::TemporalWorkflowId,
            workflow,
        ));
    } else {
        evidence.push(crate::audit::Evidence::new(
            contracts::EvidenceKind::DeploymentBootstrap,
            crate::tenant_bootstrap::AUDIENCE,
        ));
    }
    if let Some(token) = &operation.zed_token {
        evidence.push(crate::audit::Evidence::new(
            contracts::EvidenceKind::SpicedbZedtoken,
            token,
        ));
    }
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
            evidence_refs: evidence.clone(),
            correlation_id: context.correlation_id,
        },
    )
    .await?;
    // 同步部署步骤也复用原派发裁决。写前 fence 是 UNKNOWN，不把它当
    // Customer 已建成；只有原生 ID/key/状态回读和 binding 同事务成立才确定派发。
    if operation.workflow_id.is_none() && matches!(phase, "dispatch" | "verified") {
        crate::governance::record_dispatch(
            tx,
            operation.action_id,
            crate::governance::AuditClass::core("TENANT"),
            if phase == "verified" {
                Ok(())
            } else {
                Err(StatusCode::SERVICE_UNAVAILABLE)
            },
            evidence,
        )
        .await?;
    }
    Ok(())
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
    reconcile_customer(
        &state.pool,
        &state.openmeter,
        req,
        may_create,
        CustomerAdmission::Lifecycle,
    )
    .await
}

/// ACTIVE Tenant 的显式部署补齐：原 tenant.bootstrap AE/Operation，
/// 不更改 Tenant 状态、成员、角色或旧 Workflow。与开通 Activity 共用原生算法。
pub(crate) async fn reconcile_bootstrap_customer(
    pool: &sqlx::PgPool,
    openmeter: &crate::openmeter::OpenMeter,
    spicedb: &crate::spicedb::SpiceDb,
    req: &TenantStepRequest,
    action_id: Uuid,
) -> Result<(), Response> {
    reconcile_customer(
        pool,
        openmeter,
        req,
        true,
        CustomerAdmission::Bootstrap { action_id, spicedb },
    )
    .await
}

async fn reconcile_customer(
    pool: &sqlx::PgPool,
    openmeter: &crate::openmeter::OpenMeter,
    req: &TenantStepRequest,
    may_create: bool,
    admission: CustomerAdmission<'_>,
) -> Result<(), Response> {
    let mut tx = metering_tenant_tx(pool, req, admission).await?;
    let mut operation = metering_operation(&mut tx, req, admission, openmeter.namespace()).await?;
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
        if namespace != openmeter.namespace()
            || stored_prefix != prefix
            || status != "ACTIVE"
            || version <= 0
        {
            return Err(metering_error(crate::openmeter::Error::Conflict));
        }
        // ACTIVE 引用丢失 native 对象时只对账，不创建第二个 Customer。
        id
    } else {
        let customer = match openmeter.customer_by_key(req.tenant_id).await {
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
                tx = metering_tenant_tx(pool, req, admission).await?;
                let current =
                    metering_operation(&mut tx, req, admission, openmeter.namespace()).await?;
                if current.action_id != operation.action_id
                    || current.audit.operation_id != operation.audit.operation_id
                    || current.audit.parameter_hash != operation.audit.parameter_hash
                {
                    return Err(metering_error(crate::openmeter::Error::Conflict));
                }
                operation = current;
                dispatched = true;
                match openmeter.create_customer(req.tenant_id).await {
                    Ok(customer) => customer.id,
                    Err(error) => {
                        // 即使 POST 的响应丢失，原生 key 查询仍能找回同一引用。
                        match openmeter.customer_by_key(req.tenant_id).await {
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
    let customer = match openmeter.customer_by_id(&customer_id, req.tenant_id).await {
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
    let active = match openmeter.customer_by_key(req.tenant_id).await {
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
    .bind(openmeter.namespace())
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

/// TenantBuzzBinding 的 NIP-11 事实（DD-114(1)）。
struct BindingFacts {
    host: String,
    control_principal: Uuid,
    state: String,
    version: i32,
    digest: Option<String>,
    relay_self: Option<String>,
}

impl BindingFacts {
    /// 查证时对 `self` 的要求。已有快照的 binding 是漂移后的重新查证：必须有登记值
    /// 且相等；没有快照的是建立，`self` 在此登记。
    fn expectation(&self) -> RelaySelf<'_> {
        match (&self.digest, &self.relay_self) {
            (_, Some(registered)) => RelaySelf::Registered(registered),
            (None, None) => RelaySelf::Establishing,
            (Some(_), None) => RelaySelf::Unregistered,
        }
    }
}

/// `BindingFacts` 的库行：tenant_id 加六列事实，列序与 [`FACTS_COLUMNS`] 一致。
type FactsRow = (
    Uuid,
    String,
    Uuid,
    String,
    i32,
    Option<String>,
    Option<String>,
);

const FACTS_COLUMNS: &str = "b.tenant_id, b.normalized_host, b.control_service_principal_id,
     b.state, b.version, b.nip11_snapshot_digest, b.relay_self_pubkey";

fn into_facts(row: FactsRow) -> (Uuid, BindingFacts) {
    let (tenant, host, control_principal, state, version, digest, relay_self) = row;
    (
        tenant,
        BindingFacts {
            host,
            control_principal,
            state,
            version,
            digest,
            relay_self,
        },
    )
}

async fn binding_facts(
    pool: &sqlx::PgPool,
    tenant_id: Uuid,
) -> Result<Option<BindingFacts>, sqlx::Error> {
    let row: Option<FactsRow> = sqlx::query_as(&format!(
        "select {FACTS_COLUMNS} from projection.tenant_buzz_binding b where b.tenant_id = $1"
    ))
    .bind(tenant_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| into_facts(r).1))
}

/// 以 Community host 为 Host 抓 NIP-11 原文（DD-114(1)：「实际 Relay origin」就是该 host）。
async fn fetch_nip11_document(
    state: &ServiceState,
    host: &str,
) -> Result<serde_json::Value, String> {
    let r = state
        .http
        .get(format!("{}/info", state.relay_transport))
        .header(reqwest::header::HOST, host)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !r.status().is_success() {
        return Err(format!("HTTP {}", r.status()));
    }
    r.json()
        .await
        .map_err(|e| format!("NIP-11 文档不可解析: {e}"))
}

/// 查证时对 NIP-11 `self` 的要求。
#[derive(Debug, Clone, Copy)]
enum RelaySelf<'a> {
    /// 建立：登记文档里的 `self`
    Establishing,
    /// 重新查证：必须等于登记值（DD-114(4)：不自动改写登记值）
    Registered(&'a str),
    /// 已有快照却没有登记值（迁移前的存量行在漂移之后）：无从比对，不接受
    Unregistered,
}

/// 通过查证的文档。
#[derive(Debug, PartialEq, Eq)]
struct AcceptedNip11 {
    digest: String,
    relay_self: String,
}

/// DD-114(3) 的拒绝理由。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Nip11Rejection {
    /// 协作面失去准入执行点（SF-BUZ-35）
    Nip43Missing,
    /// 文档没有合法的 `self`
    SelfMissing,
    /// Relay 签名身份或部署已换
    SelfChanged,
    /// 有快照而无登记值，无从判断 Relay 是否仍是登记的那一个
    SelfUnregistered,
    AuthNotRequired,
    /// BFF 用到的四项上界不全
    BoundsMissing,
}

impl Nip11Rejection {
    fn code(self) -> &'static str {
        match self {
            Nip11Rejection::Nip43Missing => "NIP43_MISSING",
            Nip11Rejection::SelfMissing => "SELF_MISSING",
            Nip11Rejection::SelfChanged => "SELF_CHANGED",
            Nip11Rejection::SelfUnregistered => "SELF_UNREGISTERED",
            Nip11Rejection::AuthNotRequired => "AUTH_NOT_REQUIRED",
            Nip11Rejection::BoundsMissing => "BOUNDS_MISSING",
        }
    }
}

/// DD-114(3) 的接受条件，建立与漂移重新查证共用这一个实现：`supported_nips` 含 43；
/// `self` 等于登记值（建立时登记）；`limitation.auth_required=true`；BFF 用到的四项
/// 上界都存在。上界的升降不是拒绝理由——BFF 始终取快照与自身配置的交集。版本号、
/// 图标、`admin_api` 等字段的变化（SF-BUZ-47）不参与判定。
fn judge_nip11(
    doc: &serde_json::Value,
    expected: RelaySelf<'_>,
) -> Result<AcceptedNip11, Nip11Rejection> {
    let nip43 = doc
        .get("supported_nips")
        .and_then(|v| v.as_array())
        .is_some_and(|nips| {
            nips.iter()
                .any(|n| n.as_u64() == Some(NIP_RELAY_MEMBERSHIP))
        });
    if !nip43 {
        return Err(Nip11Rejection::Nip43Missing);
    }
    let relay_self = doc
        .get("self")
        .and_then(|v| v.as_str())
        .filter(|s| s.len() == 64 && s.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f')))
        .ok_or(Nip11Rejection::SelfMissing)?;
    match expected {
        RelaySelf::Establishing => {}
        RelaySelf::Registered(r) if r == relay_self => {}
        RelaySelf::Registered(_) => return Err(Nip11Rejection::SelfChanged),
        RelaySelf::Unregistered => return Err(Nip11Rejection::SelfUnregistered),
    }
    let auth_required = doc
        .get("limitation")
        .and_then(|l| l.get("auth_required"))
        .and_then(|v| v.as_bool())
        == Some(true);
    if !auth_required {
        return Err(Nip11Rejection::AuthNotRequired);
    }
    if collab_bridge::limits::RelayLimits::from_nip11(doc).is_err() {
        return Err(Nip11Rejection::BoundsMissing);
    }
    Ok(AcceptedNip11 {
        // 与运行期核对（`web_transport::relay_limits`）同一个实现：两侧逐字节一致才比得上
        digest: collab_bridge::limits::canonical_digest(doc),
        relay_self: relay_self.to_owned(),
    })
}

/// 把一次通过查证的观察写成新快照并回到 `ACTIVE`。
///
/// 条件更新：仍是 `RECONCILING`、version 未变、登记的 `self` 未被改写。一条 UPDATE
/// 同时写快照、`self` 与三个观测值并推进状态：分成多句会留下「digest 已更新但状态
/// 还没动」的中间态。漂移路径（原快照存在）在同一事务内写审计，记旧、新 digest。
async fn commit_verified(
    pool: &sqlx::PgPool,
    tenant_id: Uuid,
    binding: &BindingFacts,
    accepted: &AcceptedNip11,
) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let updated = sqlx::query(
        "update projection.tenant_buzz_binding
         set nip11_snapshot_digest = $2, nip11_observed_at = now(),
             relay_self_pubkey = $3,
             require_relay_membership = true, allow_nip_oa_auth = false,
             state = 'ACTIVE', version = version + 1
         where tenant_id = $1 and state = 'RECONCILING' and version = $4
           and (relay_self_pubkey is null or relay_self_pubkey = $3)",
    )
    .bind(tenant_id)
    .bind(&accepted.digest)
    .bind(&accepted.relay_self)
    .bind(binding.version)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if updated == 0 {
        return Ok(false);
    }
    if let Some(old) = &binding.digest {
        let digests = digest_pair(old, &accepted.digest);
        crate::audit::append(
            &mut tx,
            drift_audit(tenant_id, binding.version, "NIP11_REVERIFIED", &digests),
        )
        .await?;
    }
    tx.commit().await?;
    Ok(true)
}

/// 审计里「旧 digest:新 digest」的写法。
fn digest_pair(old: &str, new: &str) -> String {
    format!("{old}:{new}")
}

/// 治理对账器的 NIP-11 漂移审计。
///
/// 一次漂移（进入与回到 ACTIVE）归同一个 operation：由 Tenant 与进入 `RECONCILING`
/// 后的 binding version 派生，重试得到同一个值。旧、新 digest 记在 `parameter_hash`
/// （两者本身都是摘要）与稳定的 `event_key` 中。
fn drift_audit<'a>(
    tenant_id: Uuid,
    reconciling_version: i32,
    result_code: &'a str,
    digests: &'a str,
) -> crate::audit::AuditEntry<'a> {
    let operation = Uuid::new_v5(
        &Uuid::NAMESPACE_URL,
        format!("urn:platform:tenant-buzz-nip11:{tenant_id}:{reconciling_version}").as_bytes(),
    );
    crate::audit::AuditEntry {
        event_key: format!(
            "tenant.buzz_binding.nip11:{tenant_id}:{reconciling_version}:{result_code}"
        ),
        tenant_id: Some(tenant_id),
        workspace_id: None,
        operation_id: operation,
        event_type: "RECONCILIATION",
        human_identity_id: None,
        initiator_principal_id: None,
        actor_principal_id: None,
        action_key: NIP11_RECONCILE_ACTION,
        action_version: 1,
        component_type_key: "buzz",
        target_type: Some("TENANT"),
        target_id: Some(tenant_id),
        parameter_hash: digests,
        decision: "ALLOW",
        result_code,
        result_exposure: "NONE",
        evidence_refs: vec![],
        correlation_id: operation,
    }
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

/// CONTROL 客户端所需的库行：Community host、pubkey 与钉住的 SecretRef 三列。
type ControlRow = (String, String, Option<String>, Option<i32>, Option<String>);

/// 以 CONTROL 身份建该 Tenant 的一个 Channel，返回 Relay 分配的 UUID。
///
/// 供 `WORKSPACE_LIFECYCLE` 用。放在这里是因为它和上面两步共享同一套身份
/// 取用逻辑——分到另一个模块会把 CONTROL 密钥的取用路径复制成两份。
pub async fn control_client(
    state: &ServiceState,
    tenant_id: Uuid,
    direction: ProjectionDirection,
) -> Result<(IdentityClient, String), Response> {
    let row: Option<ControlRow> = sqlx::query_as(
        "select b.normalized_host, i.pubkey, i.private_key_secret_ref,
                    i.private_key_secret_version, i.private_key_secret_audience
             from projection.tenant_buzz_binding b
             join identity.buzz_identity_binding i
               on i.tenant_id = b.tenant_id and i.principal_id = b.control_service_principal_id
             where b.tenant_id = $1 and b.state = any($2) and i.state = 'ACTIVE'
               and i.custody = 'SERVER'",
    )
    .bind(tenant_id)
    .bind(direction.binding_states())
    .fetch_optional(&state.pool)
    .await
    .map_err(unavailable)?;
    let (normalized_host, pubkey, secret_ref, secret_version, secret_audience) =
        row.ok_or_else(|| StatusCode::FORBIDDEN.into_response())?;

    let secret = SecretRef {
        locator: secret_ref.unwrap_or_default(),
        version: secret_version.unwrap_or_default() as u32,
        audience: secret_audience.unwrap_or_default(),
    };
    let keys = crate::server_identity::read_bound_keys(&state.secrets, &secret, &pubkey)
        .await
        .map_err(|e| {
            tracing::warn!(error = %e, "取 CONTROL 私钥失败");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        })?;
    let client = IdentityClient::new(
        Custody::Server,
        &keys.secret_key().to_secret_hex(),
        &state.relay_transport,
        &normalized_host,
    )
    .map_err(|e| {
        tracing::warn!(error = %e, "构造 CONTROL 客户端失败");
        StatusCode::FORBIDDEN.into_response()
    })?;
    Ok((client, normalized_host))
}

/// 以 CONTROL 身份经 Relay 做一件事的方向（DD-114(2)）。
///
/// TenantBuzzBinding 因 NIP-11 漂移处于 `RECONCILING` 时，经 Relay 的读写与投入方向都
/// 等回到 `ACTIVE`；撤出方向（成员撤权、设备撤销、roster 移除、暂停时的清空与归档）
/// 照常收敛——撤权不能因为 Relay 文档的无关变化而停摆。这是唯一的判定点：CONTROL
/// 客户端与成员投影都按它取 binding，调用点不各自加条件。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectionDirection {
    /// 投入、重建与其它经 Relay 的读写：要求 binding `ACTIVE`
    Establish,
    /// 移出与停用：binding `ACTIVE` 或 `RECONCILING` 都可执行
    Withdraw,
}

impl ProjectionDirection {
    /// 该方向允许的 TenantBuzzBinding 状态。
    pub fn binding_states(self) -> Vec<String> {
        match self {
            ProjectionDirection::Establish => vec!["ACTIVE".to_owned()],
            ProjectionDirection::Withdraw => vec!["ACTIVE".to_owned(), "RECONCILING".to_owned()],
        }
    }
}

/// 按方向取该 Tenant 的 Community host 与 CONTROL Principal；binding 状态不允许该方向时为 `None`。
pub async fn projection_binding(
    pool: &sqlx::PgPool,
    tenant_id: Uuid,
    direction: ProjectionDirection,
) -> Result<Option<(String, Uuid)>, sqlx::Error> {
    sqlx::query_as(
        "select normalized_host, control_service_principal_id
         from projection.tenant_buzz_binding
         where tenant_id = $1 and state = any($2)",
    )
    .bind(tenant_id)
    .bind(direction.binding_states())
    .fetch_optional(pool)
    .await
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

fn workspace_creation_intent(
    parameters: &serde_json::Value,
    legacy_slug: &str,
) -> Result<(String, Option<contracts::WorkspaceChannelCreate>), StatusCode> {
    // ActionExecution stores the frozen Params under `params`, not at the root.
    // Missing/malformed envelopes are not evidence of a legacy create intent.
    let params = parameters
        .get("params")
        .filter(|value| value.is_object())
        .and_then(crate::governance::Params::from_json)
        .ok_or(StatusCode::CONFLICT)?;
    let requested_name = params
        .name
        .filter(|name| !name.trim().is_empty())
        .ok_or(StatusCode::CONFLICT)?;
    let metadata: Option<contracts::WorkspaceChannelCreate> = params
        .workspace_channel
        .map(serde_json::from_value)
        .transpose()
        .map_err(|_| StatusCode::CONFLICT)?;
    let name = if metadata.is_some() {
        requested_name
    } else {
        // A valid older action without native metadata retains its original slug
        // intent across retries. This does not rename an existing native channel.
        legacy_slug.to_owned()
    };
    Ok((name, metadata))
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

    let (control, _) =
        match control_client(&state, ws.tenant_id, ProjectionDirection::Establish).await {
            Ok(c) => c,
            Err(r) => return r,
        };

    // Channel id 取 Workspace id：Channel 在 Community 内按 id 唯一，重试时重发
    // 同一个 id 不会另建。只剩「事件被接受而回应丢失」这一种结果不明，由下面
    // 的回读收敛。
    let channel_uuid = req.workspace_id;
    let channel = channel_uuid.to_string();
    // Creation inputs already belong to the original ActionExecution's idempotent
    // parameters. Do not introduce a second channel metadata table or put the
    // description in Temporal history. Legacy provisioned inputs have no metadata.
    let intents: Vec<serde_json::Value> = match sqlx::query_scalar(
        "select parameters from admission.action_execution
         where target_id=$1 and tenant_id=$2 and action_key='workspace.create'",
    )
    .bind(req.workspace_id)
    .bind(ws.tenant_id)
    .fetch_all(&state.pool)
    .await
    {
        Ok(intents) => intents,
        Err(e) => return unavailable(e),
    };
    if intents.len() > 1 {
        return StatusCode::CONFLICT.into_response();
    }
    let Some(input) = intents.first() else {
        return StatusCode::CONFLICT.into_response();
    };
    let (name, metadata) = match workspace_creation_intent(input, &ws.slug) {
        Ok(intent) => intent,
        Err(status) => return status.into_response(),
    };
    if let Err(e) = control
        .ensure_channel(&state.http, &channel, &name, metadata.as_ref())
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
    if req.archived {
        match crate::automation::converge_scope_schedules(
            &state,
            tenant_id,
            Some(req.workspace_id),
            req.workspace_version,
            true,
        )
        .await
        {
            Ok(true) => {}
            Ok(false) => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
            Err(e) => return unavailable(e),
        }
    }
    // 暂停时归档是撤出方向；恢复时解档是投入方向
    let direction = if req.archived {
        ProjectionDirection::Withdraw
    } else {
        ProjectionDirection::Establish
    };
    let (control, _) = match control_client(&state, tenant_id, direction).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    match control
        .converge_channel_archived(&state.http, &channel_id.to_string(), req.archived)
        .await
    {
        Ok(true) => match crate::automation::converge_scope_schedules(
            &state,
            tenant_id,
            Some(req.workspace_id),
            req.workspace_version,
            req.archived,
        )
        .await
        {
            Ok(true) => StatusCode::OK.into_response(),
            Ok(false) => StatusCode::SERVICE_UNAVAILABLE.into_response(),
            Err(e) => unavailable(e),
        },
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
    // 暂停时清空 roster 是撤出方向；恢复时重建是投入方向
    let direction = match req.mode {
        RosterMode::Clear => ProjectionDirection::Withdraw,
        RosterMode::Rebuild => ProjectionDirection::Establish,
    };
    let (control, _) = match control_client(&state, tenant_id, direction).await {
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
mod workspace_creation_intent_tests {
    use super::workspace_creation_intent;
    use serde_json::json;

    #[test]
    fn current_envelope_keeps_native_title_kind_and_description() {
        for kind in ["stream", "forum"] {
            let input = json!({"params":{"name":"Requested title", "slug":"stable-id",
                "workspaceChannel":{"channelType":kind,"description":"Requested description"}},"targetVersion":1});
            let (name, metadata) = workspace_creation_intent(&input, "stable-id").unwrap();
            assert_eq!(name, "Requested title");
            assert_eq!(
                serde_json::to_value(metadata.unwrap()).unwrap(),
                input["params"]["workspaceChannel"]
            );
        }
    }

    #[test]
    fn legitimate_legacy_envelope_keeps_original_slug_intent() {
        let (name, metadata) = workspace_creation_intent(
            &json!({"params":{"name":"Old display title","slug":"original-slug"},"targetVersion":1}),
            "original-slug",
        ).unwrap();
        assert_eq!(name, "original-slug");
        assert!(metadata.is_none());
    }

    #[test]
    fn malformed_envelopes_never_downgrade_to_legacy_creation() {
        for input in [
            json!({}),
            json!(null),
            json!({"params":null}),
            json!({"params":[]}),
            json!({"params":{}}),
            json!({"name":"Flattened title","workspaceChannel":{"channelType":"stream"}}),
            json!({"params":{"name":"Title","workspaceChannel":null}}),
            json!({"params":{"name":"Title","workspaceChannel":{"channelType":"unknown"}}}),
            json!({"params":{"workspaceChannel":{"channelType":"stream"}}}),
            json!({"params":{"name":" ","workspaceChannel":{"channelType":"stream"}}}),
        ] {
            assert!(
                workspace_creation_intent(&input, "stable-id").is_err(),
                "{input}"
            );
        }
    }
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
    direction: ProjectionDirection,
) -> Result<(String, String, Uuid), Response> {
    match sqlx::query_as::<_, (String, String, Uuid)>(
        "select b.normalized_host, i.pubkey, b.control_service_principal_id
         from identity.tenant t
         join projection.tenant_buzz_binding b on b.tenant_id = t.id
         join identity.buzz_identity_binding i
           on i.tenant_id = b.tenant_id and i.principal_id = b.control_service_principal_id
         where t.id = $1 and t.version = $2 and t.state = any($3)
           and b.state = any($4) and i.kind = 'CONTROL' and i.state = 'ACTIVE'",
    )
    .bind(tenant_id)
    .bind(tenant_version)
    .bind(converging)
    .bind(direction.binding_states())
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
    // 暂停时归档 Community 是撤出方向；恢复时解档是投入方向（DD-114(2)）
    let direction = if req.archived {
        ProjectionDirection::Withdraw
    } else {
        ProjectionDirection::Establish
    };
    let (host, owner, _) = match converging_tenant(
        &state,
        req.tenant_id,
        req.tenant_version,
        converging,
        direction,
    )
    .await
    {
        Ok(r) => r,
        Err(r) => return r,
    };
    let operator = match load_operator(&state).await {
        Ok(o) => o,
        Err(r) => return r,
    };
    if req.archived {
        match crate::automation::converge_scope_schedules(
            &state,
            req.tenant_id,
            None,
            req.tenant_version,
            true,
        )
        .await
        {
            Ok(true) => {}
            Ok(false) => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
            Err(e) => return unavailable(e),
        }
    }
    if !req.archived {
        match community_archived(&state, &operator, &owner, &host).await {
            Ok(Some(false)) => {
                return match crate::automation::converge_scope_schedules(
                    &state,
                    req.tenant_id,
                    None,
                    req.tenant_version,
                    false,
                )
                .await
                {
                    Ok(true) => StatusCode::OK.into_response(),
                    Ok(false) => StatusCode::SERVICE_UNAVAILABLE.into_response(),
                    Err(e) => unavailable(e),
                }
            }
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
        Ok(Some(now)) if now == req.archived => match crate::automation::converge_scope_schedules(
            &state,
            req.tenant_id,
            None,
            req.tenant_version,
            req.archived,
        )
        .await
        {
            Ok(true) => StatusCode::OK.into_response(),
            Ok(false) => StatusCode::SERVICE_UNAVAILABLE.into_response(),
            Err(e) => unavailable(e),
        },
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
    let (_, _, control_principal) = match converging_tenant(
        &state,
        req.tenant_id,
        req.tenant_version,
        &["RESTORING"],
        ProjectionDirection::Establish,
    )
    .await
    {
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
    // Tenant 恢复时按 Core 事实重建 relay roster：投入方向
    let (control, _) = control_client(state, tenant_id, ProjectionDirection::Establish).await?;
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

#[cfg(test)]
mod nip11_tests {
    use super::*;

    const SELF_A: &str = "7658f4ec0658aaaa7658f4ec0658aaaa7658f4ec0658aaaa7658f4ec0658aaaa";
    const SELF_B: &str = "1111f4ec0658aaaa7658f4ec0658aaaa7658f4ec0658aaaa7658f4ec0658aaaa";

    /// 与本地 Relay 实测 `/info` 同形的文档（`relay-server-client.md` 第 2 节）
    fn doc() -> serde_json::Value {
        serde_json::json!({
            "name": "c", "version": "1.0.0", "icon": null,
            "self": SELF_A,
            "supported_nips": [1, 11, 29, 42, 43],
            "limitation": {"max_message_length": 524288, "max_subscriptions": 1024,
                           "max_filters": 10, "max_limit": 1000, "max_subid_length": 256,
                           "auth_required": true, "restricted_writes": true}
        })
    }

    /// DD-114(2)：只有撤出方向在 RECONCILING 下可用，投入与读写仍要求 ACTIVE
    #[test]
    fn only_withdrawal_proceeds_while_reconciling() {
        assert_eq!(ProjectionDirection::Establish.binding_states(), ["ACTIVE"]);
        assert_eq!(
            ProjectionDirection::Withdraw.binding_states(),
            ["ACTIVE", "RECONCILING"]
        );
    }

    #[test]
    fn establishment_registers_self() {
        let a = judge_nip11(&doc(), RelaySelf::Establishing).expect("建立时接受");
        assert_eq!(a.relay_self, SELF_A);
        assert_eq!(a.digest, collab_bridge::limits::canonical_digest(&doc()));
    }

    #[test]
    fn unrelated_fields_do_not_block_reverification() {
        // SF-BUZ-47：版本、图标、admin_api 与上界的升降都不是拒绝理由
        let mut d = doc();
        d["version"] = "2.0.0".into();
        d["icon"] = "https://x/icon.png".into();
        d["admin_api"] = "https://admin".into();
        d["limitation"]["max_limit"] = 500.into();
        let a = judge_nip11(&d, RelaySelf::Registered(SELF_A)).expect("无关字段变化应被接受");
        assert_ne!(a.digest, collab_bridge::limits::canonical_digest(&doc()));
    }

    #[test]
    fn each_acceptance_condition_is_enforced() {
        let reject = |d: serde_json::Value, e: RelaySelf<'_>| judge_nip11(&d, e).unwrap_err();

        let mut d = doc();
        d["supported_nips"] = serde_json::json!([1, 11, 42]);
        assert_eq!(
            reject(d, RelaySelf::Registered(SELF_A)),
            Nip11Rejection::Nip43Missing
        );

        assert_eq!(
            reject(doc(), RelaySelf::Registered(SELF_B)),
            Nip11Rejection::SelfChanged,
            "self 改变不得接受，也不改写登记值"
        );
        assert_eq!(
            reject(doc(), RelaySelf::Unregistered),
            Nip11Rejection::SelfUnregistered
        );
        let mut d = doc();
        d.as_object_mut().unwrap().remove("self");
        assert_eq!(
            reject(d, RelaySelf::Establishing),
            Nip11Rejection::SelfMissing
        );

        let mut d = doc();
        d["limitation"]["auth_required"] = false.into();
        assert_eq!(
            reject(d, RelaySelf::Registered(SELF_A)),
            Nip11Rejection::AuthNotRequired
        );

        for bound in [
            "max_subscriptions",
            "max_filters",
            "max_limit",
            "max_message_length",
        ] {
            let mut d = doc();
            d["limitation"].as_object_mut().unwrap().remove(bound);
            assert_eq!(
                reject(d, RelaySelf::Registered(SELF_A)),
                Nip11Rejection::BoundsMissing,
                "缺 {bound}"
            );
        }
        // 第五项不在 DD-114 的四项之内：缺它仍接受
        let mut d = doc();
        d["limitation"]
            .as_object_mut()
            .unwrap()
            .remove("max_subid_length");
        judge_nip11(&d, RelaySelf::Registered(SELF_A)).expect("max_subid_length 不是接受条件");
    }

    #[test]
    fn expectation_follows_binding_facts() {
        let facts = |digest: Option<&str>, relay_self: Option<&str>| BindingFacts {
            host: "h".into(),
            control_principal: Uuid::nil(),
            state: "RECONCILING".into(),
            version: 1,
            digest: digest.map(str::to_owned),
            relay_self: relay_self.map(str::to_owned),
        };
        assert!(matches!(
            facts(None, None).expectation(),
            RelaySelf::Establishing
        ));
        assert!(matches!(
            facts(Some("d"), None).expectation(),
            RelaySelf::Unregistered
        ));
        assert!(matches!(
            facts(Some("d"), Some(SELF_A)).expectation(),
            RelaySelf::Registered(s) if s == SELF_A
        ));
    }
}
