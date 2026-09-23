//! 原生设备公钥的登记、查看与撤销（`DD-77`、`DD-79`）。
//!
//! Desktop/Mobile 在本机生成密钥、本机签名、直连 Relay（`DD-75`）。Core 不持有
//! 那些私钥，只登记公钥并把它投影进 roster——Relay 据 roster 放行或拒绝。
//!
//! 登记只对原生端开放：请求必须来自原生 listener（网关投影
//! `x-kailo-client-surface=native`，浏览器 listener 无条件移除该 header），并附
//! 以该私钥签名的 NIP-98 持钥证明，证明绑定调用方当前 PlatformSession。查看与
//! 撤销两端都开放：设备丢了，应当能在任一端把它撤掉。

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use contracts::{ErrorBody, ErrorClass, ReasonCode};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::audit::{append, AuditEntry};
use crate::bff::{resolve_execution_context, BffState, ExecutionContext};
use crate::component_task::{self, ComponentTaskInput};

/// 网关在原生 listener 上投影、在浏览器 listener 上移除的入口标识（DD-78）。
const HEADER_CLIENT_SURFACE: &str = "x-kailo-client-surface";
/// 登记端点的路径。持钥证明的 `u` 必须指向它：证明只对这一个动作有效。
pub const REGISTER_PATH: &str = "/api/v1/identity/client-keys";
/// NIP-98 HTTP Auth 事件
const NIP98_KIND: u16 = 27235;
const KIND: &str = "BUZZ_IDENTITY_PROJECTION";

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    /// 以待登记私钥签名的 NIP-98 事件
    pub proof: nostr::Event,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientKey {
    pub pubkey: String,
    pub state: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyStatus {
    pub pubkey: String,
    pub state: String,
    /// 推进该状态的 Workflow。为空表示本次调用没有需要推进的状态。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workflow_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct IdentityEnvelope {
    identity: IdentityTarget,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct IdentityTarget {
    pubkey: String,
    binding_version: i32,
}

fn refuse(status: StatusCode, class: ErrorClass, reason: ReasonCode) -> Response {
    (
        status,
        Json(ErrorBody {
            class,
            reason,
            operation_id: None,
        }),
    )
        .into_response()
}

fn unavailable(e: sqlx::Error) -> Response {
    tracing::warn!(error = %e, "设备公钥读写失败");
    StatusCode::SERVICE_UNAVAILABLE.into_response()
}

/// 登记一台设备的公钥。
pub async fn register(
    State(state): State<BffState>,
    headers: HeaderMap,
    body: Result<Json<RegisterRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    if headers
        .get(HEADER_CLIENT_SURFACE)
        .and_then(|v| v.to_str().ok())
        != Some("native")
    {
        return refuse(
            StatusCode::FORBIDDEN,
            ErrorClass::Denied,
            ReasonCode::NativeSurfaceRequired,
        );
    }
    let Ok(Json(req)) = body else {
        return refuse(
            StatusCode::FORBIDDEN,
            ErrorClass::Denied,
            ReasonCode::ClientKeyProofInvalid,
        );
    };
    match proof_is_valid(&state, &ctx, &req.proof).await {
        Ok(true) => {}
        Ok(false) => {
            return refuse(
                StatusCode::FORBIDDEN,
                ErrorClass::Denied,
                ReasonCode::ClientKeyProofInvalid,
            )
        }
        Err(e) => return unavailable(e),
    }
    let pubkey = req.proof.pubkey.to_hex();
    let parameter_hash = hex::encode(Sha256::digest(pubkey.as_bytes()));

    let mut tx = match state.pool.begin().await {
        Ok(t) => t,
        Err(e) => return unavailable(e),
    };
    // 同一人的登记串行化：否则两次并发登记都会读到「未到上界」而一起越界
    if let Err(e) = sqlx::query!(
        "select pg_advisory_xact_lock(hashtextextended($1::text, 0))",
        ctx.tenant_principal_id.to_string()
    )
    .execute(&mut *tx)
    .await
    {
        return unavailable(e);
    }

    let existing = match sqlx::query!(
        "select principal_id, tenant_id, state, version from identity.buzz_identity_binding
         where pubkey = $1",
        pubkey
    )
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(r) => r,
        Err(e) => return unavailable(e),
    };
    if let Some(b) = existing {
        let mine = b.principal_id == ctx.tenant_principal_id && b.tenant_id == ctx.tenant_id;
        return match (mine, b.state.as_str()) {
            // 同一台设备重复登记：收敛到同一条 Workflow，而不是再起一条。
            // Start 结果不明时客户端的重试正是走到这里。
            (true, "RECONCILING") => {
                drop(tx);
                resume(
                    &state,
                    &ctx,
                    &pubkey,
                    "identity.client_key.register",
                    &parameter_hash,
                    b.version,
                )
                .await
            }
            (true, "ACTIVE") => (
                StatusCode::OK,
                Json(KeyStatus {
                    pubkey,
                    state: b.state,
                    workflow_id: None,
                }),
            )
                .into_response(),
            // 别人的公钥、已撤销的公钥：都不接受。REVOKED 的身份不复活（.design/10 §4）
            _ => refuse(
                StatusCode::CONFLICT,
                ErrorClass::Conflict,
                ReasonCode::ClientKeyAlreadyBound,
            ),
        };
    }

    let count = match sqlx::query_scalar!(
        r#"select count(*) as "n!" from identity.buzz_identity_binding
           where tenant_id = $1 and principal_id = $2 and custody = 'CLIENT' and state <> 'REVOKED'"#,
        ctx.tenant_id,
        ctx.tenant_principal_id
    )
    .fetch_one(&mut *tx)
    .await
    {
        Ok(n) => n,
        Err(e) => return unavailable(e),
    };
    if count >= state.client_keys_per_principal {
        return refuse(
            StatusCode::TOO_MANY_REQUESTS,
            ErrorClass::Limit,
            ReasonCode::ClientKeyLimitReached,
        );
    }

    if let Err(e) = sqlx::query!(
        "insert into identity.buzz_identity_binding
             (tenant_id, principal_id, pubkey, custody, kind, state)
         values ($1, $2, $3, 'CLIENT', 'HUMAN', 'RECONCILING')",
        ctx.tenant_id,
        ctx.tenant_principal_id,
        pubkey
    )
    .execute(&mut *tx)
    .await
    {
        return unavailable(e);
    }
    let action = match record_action(
        &mut tx,
        &ctx,
        "identity.client_key.register",
        &pubkey,
        &parameter_hash,
        1,
    )
    .await
    {
        Ok(a) => a,
        Err(e) => return unavailable(e),
    };
    if let Err(e) = tx.commit().await {
        return unavailable(e);
    }

    start(&state, &ctx, &pubkey, 1, action, "RECONCILING").await
}

/// 本人登记过的设备（未撤销的）。
pub async fn list(State(state): State<BffState>, headers: HeaderMap) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    match sqlx::query_as!(
        ClientKey,
        "select pubkey, state, created_at from identity.buzz_identity_binding
         where tenant_id = $1 and principal_id = $2 and custody = 'CLIENT' and state <> 'REVOKED'
         order by created_at",
        ctx.tenant_id,
        ctx.tenant_principal_id
    )
    .fetch_all(&state.pool)
    .await
    {
        Ok(rows) => (StatusCode::OK, Json(rows)).into_response(),
        Err(e) => unavailable(e),
    }
}

/// 撤销本人的一台设备。只移出这一把 pubkey，此人的其他设备与 Web 不受影响。
pub async fn revoke(
    State(state): State<BffState>,
    Path(pubkey): Path<String>,
    headers: HeaderMap,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    let parameter_hash = hex::encode(Sha256::digest(pubkey.as_bytes()));
    let mut tx = match state.pool.begin().await {
        Ok(t) => t,
        Err(e) => return unavailable(e),
    };
    // 只找本人的 CLIENT binding：别人的与不存在的是同一个回答，不暴露公钥归属
    let row = match sqlx::query!(
        "select state, version from identity.buzz_identity_binding
         where pubkey = $1 and tenant_id = $2 and principal_id = $3 and custody = 'CLIENT'
         for update",
        pubkey,
        ctx.tenant_id,
        ctx.tenant_principal_id
    )
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(r)) => r,
        Ok(None) => {
            return refuse(
                StatusCode::NOT_FOUND,
                ErrorClass::Denied,
                ReasonCode::ClientKeyNotFound,
            )
        }
        Err(e) => return unavailable(e),
    };
    match row.state.as_str() {
        "REVOKED" => {
            return (
                StatusCode::OK,
                Json(KeyStatus {
                    pubkey,
                    state: row.state,
                    workflow_id: None,
                }),
            )
                .into_response()
        }
        "REVOKING" => {
            drop(tx);
            return resume(
                &state,
                &ctx,
                &pubkey,
                "identity.client_key.revoke",
                &parameter_hash,
                row.version,
            )
            .await;
        }
        _ => {}
    }
    // 先关门再收敛：状态先置 REVOKING，投影期间的并发登记流程据此自行撤回
    let version = match sqlx::query_scalar!(
        "update identity.buzz_identity_binding set state = 'REVOKING', version = version + 1
         where pubkey = $1 returning version",
        pubkey
    )
    .fetch_one(&mut *tx)
    .await
    {
        Ok(v) => v,
        Err(e) => return unavailable(e),
    };
    let action = match record_action(
        &mut tx,
        &ctx,
        "identity.client_key.revoke",
        &pubkey,
        &parameter_hash,
        version,
    )
    .await
    {
        Ok(a) => a,
        Err(e) => return unavailable(e),
    };
    if let Err(e) = tx.commit().await {
        return unavailable(e);
    }
    start(&state, &ctx, &pubkey, version, action, "REVOKING").await
}

/// 核对持钥证明（DD-79）。
///
/// 每一项都对应一种真实的滥用：签名证明持钥；`kind`、`u`、`method` 限定这份
/// 证明只对「登记」这一个动作有效；会话 ID 让截获的证明无法在别人的会话里
/// 重放——否则他人能把你的公钥登记到他名下；时间窗限定它还能用多久。时钟取
/// 库里的 `now()`，多副本 Core 的进程时钟不保证一致。
async fn proof_is_valid(
    state: &BffState,
    ctx: &ExecutionContext,
    proof: &nostr::Event,
) -> Result<bool, sqlx::Error> {
    if proof.verify().is_err() || proof.kind.as_u16() != NIP98_KIND {
        return Ok(false);
    }
    let now: i64 = sqlx::query_scalar!(r#"select extract(epoch from now())::bigint as "n!""#)
        .fetch_one(&state.pool)
        .await?;
    let skew = now.abs_diff(proof.created_at.as_secs() as i64);
    if skew > state.client_key_proof_window_seconds {
        return Ok(false);
    }
    let tag = |name: &str| {
        proof
            .tags
            .iter()
            .map(|t| t.as_slice())
            .find(|t| t.first().map(String::as_str) == Some(name))
            .and_then(|t| t.get(1).cloned())
    };
    // `u` 按 NIP-98 是绝对 URL；原生端经网关访问，Core 看到的只是路径，
    // 因此核对路径，主机名由网关与 TLS 负责。
    let path_ok = tag("u")
        .and_then(|u| reqwest::Url::parse(&u).ok())
        .is_some_and(|u| u.path() == REGISTER_PATH && u.query().is_none());
    let method_ok = tag("method").as_deref() == Some("POST");
    let session_ok = tag("session").as_deref() == Some(ctx.session_id.to_string().as_str());
    Ok(path_ok && method_ok && session_ok)
}

/// 记一条已准入的 ActionExecution 与对应审计。
///
/// 这里就是这个用户动作的准入点：会话已解析、成员 ACTIVE、持钥证明成立、未超
/// 上界——与消息发布由 BFF 准入是同一种角色。ActionExecution 的 target 是此人
/// 的 Principal，冻结参数是这把公钥的摘要。
async fn record_action(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    ctx: &ExecutionContext,
    action_key: &str,
    pubkey: &str,
    parameter_hash: &str,
    version: i32,
) -> Result<Uuid, sqlx::Error> {
    let action = Uuid::new_v4();
    let operation = Uuid::new_v4();
    let workflow_id = component_task::workflow_id(KIND, ctx.tenant_id, pubkey, version);
    sqlx::query!(
        "insert into admission.action_execution
             (id, operation_id, tenant_id, workspace_id, action_key, action_version,
              initiator_principal_id, actor_principal_id, target_id, parameter_hash,
              temporal_workflow_id, gate_state, dispatch_state, correlation_id)
         values ($1, $2, $3, null, $4, 1, $5, $5, $5, $6, $7, 'ALLOWED', 'NOT_DISPATCHED', $2)",
        action,
        operation,
        ctx.tenant_id,
        action_key,
        ctx.tenant_principal_id,
        parameter_hash,
        workflow_id,
    )
    .execute(&mut **tx)
    .await?;
    append(
        tx,
        AuditEntry {
            event_key: format!("{action_key}:{pubkey}:{version}"),
            tenant_id: Some(ctx.tenant_id),
            workspace_id: None,
            operation_id: operation,
            event_type: "DECISION",
            human_identity_id: Some(ctx.human_identity_id),
            initiator_principal_id: Some(ctx.tenant_principal_id),
            actor_principal_id: Some(ctx.tenant_principal_id),
            action_key,
            action_version: 1,
            component_type_key: "buzz",
            target_type: Some("PRINCIPAL"),
            target_id: Some(ctx.tenant_principal_id),
            parameter_hash,
            decision: "ALLOW",
            result_code: "ACCEPTED",
            result_exposure: "NONE",
            evidence_refs: serde_json::json!([
                { "kind": "BUZZ_PUBKEY", "value": pubkey },
                { "kind": "PLATFORM_SESSION_ID", "value": ctx.session_id },
            ]),
            correlation_id: operation,
        },
    )
    .await?;
    Ok(action)
}

async fn start(
    state: &BffState,
    ctx: &ExecutionContext,
    pubkey: &str,
    version: i32,
    action: Uuid,
    status: &str,
) -> Response {
    let workflow_id = component_task::workflow_id(KIND, ctx.tenant_id, pubkey, version);
    let input = ComponentTaskInput {
        kind: KIND.to_owned(),
        target: IdentityEnvelope {
            identity: IdentityTarget {
                pubkey: pubkey.to_owned(),
                binding_version: version,
            },
        },
    };
    match component_task::start(
        &state.pool,
        &state.temporal,
        &workflow_id,
        ctx.tenant_id,
        action,
        &input,
    )
    .await
    {
        Ok(_) => (
            StatusCode::ACCEPTED,
            Json(KeyStatus {
                pubkey: pubkey.to_owned(),
                state: status.to_owned(),
                workflow_id: Some(workflow_id),
            }),
        )
            .into_response(),
        Err(r) => r,
    }
}

/// 以原来那条 ActionExecution 重新驱动同一个固定 workflow ID。
///
/// Start 结果不明时，binding 停在中间态而 Workflow 可能并未启动；客户端重试
/// 走到这里，用同一个 ID 收敛——已启动则是 AlreadyStarted，未启动则补上。
async fn resume(
    state: &BffState,
    ctx: &ExecutionContext,
    pubkey: &str,
    action_key: &str,
    parameter_hash: &str,
    version: i32,
) -> Response {
    let workflow_id = component_task::workflow_id(KIND, ctx.tenant_id, pubkey, version);
    let action = match sqlx::query_scalar!(
        "select id from admission.action_execution
         where tenant_id = $1 and action_key = $2 and parameter_hash = $3
           and temporal_workflow_id = $4 and gate_state = 'ALLOWED'",
        ctx.tenant_id,
        action_key,
        parameter_hash,
        workflow_id
    )
    .fetch_optional(&state.pool)
    .await
    {
        Ok(Some(a)) => a,
        // 中间态却找不到对应的准入记录：说明数据不一致，不能凭空补一条准入
        Ok(None) => {
            tracing::warn!(pubkey, "中间态 binding 缺少对应的 ActionExecution");
            return StatusCode::CONFLICT.into_response();
        }
        Err(e) => return unavailable(e),
    };
    let status = if action_key.ends_with("revoke") {
        "REVOKING"
    } else {
        "RECONCILING"
    };
    start(state, ctx, pubkey, version, action, status).await
}
