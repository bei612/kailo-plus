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
use kailo_buzz::bridge::{Custody, IdentityClient};
use kailo_buzz::operator::OperatorIdentity;
use kailo_secrets::SecretRef;
use nostr::Keys;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
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
            let locator = format!("{}/buzz-control/{}", state.secret_mount, req.tenant_id);
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
            let pubkey = keys.public_key().to_hex();
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
    let key = state.secrets.read(&secret, "value").await.map_err(|e| {
        tracing::warn!(error = %e, "取 operator 私钥失败");
        StatusCode::SERVICE_UNAVAILABLE.into_response()
    })?;

    // audience 两侧都来自同一条记录：构造时再比一次，是为了让「这把钥匙服务
    // 哪个部署」在取用点可见，而不是只在写入时校验过一次。
    OperatorIdentity::new(
        key.expose(),
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
        "select b.normalized_host, i.private_key_secret_ref,
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
    let key = state.secrets.read(&secret, "value").await.map_err(|e| {
        tracing::warn!(error = %e, "取 CONTROL 私钥失败");
        StatusCode::SERVICE_UNAVAILABLE.into_response()
    })?;
    let client = IdentityClient::new(
        Custody::Server,
        key.expose(),
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

    let before = match control.member_channel_ids(&state.http).await {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(error = %e, "列出 Channel 失败");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    };
    if let Err(e) = control.create_channel(&state.http, &ws.slug).await {
        tracing::warn!(error = %e, "创建 Channel 失败");
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    let after = match control.member_channel_ids(&state.http).await {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(error = %e, "回读 Channel 失败");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    };
    let Some(channel) = after.into_iter().find(|c| !before.contains(c)) else {
        // 事件被接受但新 Channel 没出现在所属列表里：结果不明，不是失败。
        // 交给重试——下一次会因为 binding 仍为空而重新走完整条路径。
        tracing::warn!(workspace = %req.workspace_id, "Channel 创建后未出现在所属列表");
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let Ok(channel_uuid) = channel.parse::<Uuid>() else {
        tracing::warn!(channel, "Channel 标识不是 UUID");
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };

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
