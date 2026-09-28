//! Tenant 的 Buzz 投影与查证（`TENANT_LIFECYCLE`、`.design/09` 第 3 步）。
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
use kailo_buzz::bridge::{Custody, IdentityClient, Presence, Scope};
use kailo_buzz::operator::OperatorIdentity;
use kailo_secrets::SecretRef;
use nostr::Keys;
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
    if let Err(error) = state.secrets.ensure_tenant(req.tenant_id).await {
        tracing::warn!(error = %error, tenant_id = %req.tenant_id, "Tenant secret namespace 未就绪");
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }

    // CONTROL Principal：Tenant 的协议 owner，不是业务 actor（`DD-03`）。
    let control_principal = match sqlx::query_scalar!(
        "insert into identity.principal (id, tenant_id, kind, status)
         select $1, $2, 'SERVICE', 'ACTIVE'
         where not exists (
             select 1 from identity.buzz_identity_binding
             where tenant_id = $2 and kind = 'CONTROL' and state <> 'REVOKED')
         returning id",
        Uuid::new_v4(),
        req.tenant_id
    )
    .fetch_optional(&state.pool)
    .await
    {
        Ok(Some(id)) => Some(id),
        Ok(None) => None,
        Err(e) => return unavailable(e),
    };

    // 已有 CONTROL 身份就沿用；没有才生成。重新生成会让 Community 的 owner
    // 与 Core 记录的身份对不上，而那在 Relay 侧表现为「谁都不是 owner」。
    let (control_principal, control_pubkey) = match control_principal {
        Some(principal) => {
            let keys = Keys::generate();
            let pubkey = keys.public_key().to_hex();
            // 首次建 Tenant 的投影可重试；每把新 key 独占路径，避免重试写入同一
            // KV 路径时由 max_versions 淘汰仍需保留的旧 generation。
            let locator = state
                .secrets
                .tenant_locator(req.tenant_id, &format!("buzz-control/{pubkey}"));
            let version = match state
                .secrets
                .write(&locator, "value", &keys.secret_key().to_secret_hex())
                .await
            {
                Ok(v) => v,
                Err(e) => {
                    tracing::warn!(error = %e, "写 CONTROL 私钥失败");
                    return StatusCode::SERVICE_UNAVAILABLE.into_response();
                }
            };
            if let Err(e) = sqlx::query!(
                "insert into identity.buzz_identity_binding
                     (tenant_id, principal_id, pubkey, custody, private_key_secret_ref,
                      private_key_secret_version, private_key_secret_audience, kind, state)
                 values ($1, $2, $3, 'SERVER', $4, $5, $6, 'CONTROL', 'RECONCILING')",
                req.tenant_id,
                principal,
                pubkey,
                locator,
                version as i32,
                state.secret_audience,
            )
            .execute(&state.pool)
            .await
            {
                return unavailable(e);
            }
            (principal, pubkey)
        }
        None => match sqlx::query!(
            "select principal_id, pubkey from identity.buzz_identity_binding
             where tenant_id = $1 and kind = 'CONTROL' and state <> 'REVOKED'",
            req.tenant_id
        )
        .fetch_one(&state.pool)
        .await
        {
            Ok(r) => (r.principal_id, r.pubkey),
            Err(e) => return unavailable(e),
        },
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
    let control = match sqlx::query!(
        "select pubkey, private_key_secret_ref, private_key_secret_version,
                private_key_secret_audience
         from identity.buzz_identity_binding
         where tenant_id = $1 and principal_id = $2 and kind = 'CONTROL'
           and custody = 'SERVER' and state in ('RECONCILING', 'ACTIVE')",
        req.tenant_id,
        binding.control_service_principal_id,
    )
    .fetch_optional(&state.pool)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
        Err(e) => return unavailable(e),
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
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
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
    // owner，而 owner 身份恰恰由刚才的 provision 建立并被 Relay 接受。
    if let Err(e) = sqlx::query!(
        "update identity.buzz_identity_binding set state = 'ACTIVE', version = version + 1
         where tenant_id = $1 and principal_id = $2 and state = 'RECONCILING'",
        req.tenant_id,
        binding.control_service_principal_id,
    )
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

async fn load_operator(state: &ServiceState) -> Result<OperatorIdentity, Response> {
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
    let control_pubkey = control.pubkey_hex();
    // (应在, 收敛中)。CLEAR 只认回读到的 roster：除 CONTROL 外一概移出，不按 Core
    // 集合去删——Core 之外混进 roster 的钥匙同样必须清掉。REBUILD 不替仍在建立或
    // 撤权途中的钥匙下结论：它们由各自的投影 Workflow 收敛（与对账度量同一口径）。
    let expected = || async {
        match req.mode {
            RosterMode::Clear => Ok((HashSet::from([control_pubkey.clone()]), HashSet::new())),
            RosterMode::Rebuild => {
                let pool = &state.pool;
                let settled = crate::roster_reconcile::settled_channel_roster(
                    pool,
                    control_pubkey.clone(),
                    tenant_id,
                    req.workspace_id,
                )
                .await
                .map_err(unavailable)?;
                let unsettled = crate::roster_reconcile::unsettled_channel_roster(
                    pool,
                    tenant_id,
                    req.workspace_id,
                )
                .await
                .map_err(unavailable)?;
                Ok((settled, unsettled))
            }
        }
    };
    let (want, tolerated) = match expected().await {
        Ok(w) => w,
        Err(r) => return r,
    };
    let channel = channel_id.to_string();
    let scope = Scope::Channel(&channel);
    let current = match read_roster(&state, &control, scope).await {
        Ok(r) => r,
        Err(r) => return r,
    };
    let plan = roster_plan(&current, &want, &tolerated, &control_pubkey);
    for (pubkey, presence) in &plan {
        if let Err(e) = control
            .converge(&state.http, scope, pubkey, *presence)
            .await
        {
            tracing::info!(workspace = %req.workspace_id, error = %e, "Channel roster 未收敛，等待重试");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    }
    // 收敛期间成员或设备的事实可能已变：按当前事实重算，再与回读比对
    let (want, tolerated) = match expected().await {
        Ok(w) => w,
        Err(r) => return r,
    };
    let after = match read_roster(&state, &control, scope).await {
        Ok(r) => r,
        Err(r) => return r,
    };
    if roster_settled(&after, &want, &tolerated, &control_pubkey) {
        StatusCode::OK.into_response()
    } else {
        tracing::warn!(workspace = %req.workspace_id, mode = ?req.mode, "Channel roster 回读与期望不一致");
        StatusCode::SERVICE_UNAVAILABLE.into_response()
    }
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
    use kailo_buzz::bridge::Presence;
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
