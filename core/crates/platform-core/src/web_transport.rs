//! Buzz Web 的 Relay 边界替换（`SS-WEB-RELAY`、`DD-39`）。
//!
//! Browser 只发类型化的语义命令，不发 raw signed event，也不发任意 Relay filter。
//! 它不接收 Relay URL、不接收 Nostr 私钥、不生成 NIP-42/NIP-98/NIP-44。
//!
//! 每次调用的顺序是固定的，且不能换：
//!
//! 1. 以网关投影的 issuer/subject 重新解析身份并取 active PlatformSession——
//!    撤权因此对下一个请求立刻生效；
//! 2. Workspace 必须 `ACTIVE`，且该 HUMAN 有 active WorkspaceMembership 或
//!    fresh workspace `manage`（`.design/03` §2 的 HUMAN scope guard）；
//! 3. 以该 HUMAN 的 `BuzzIdentityBinding` 代签发布，发布前不读任何 Browser 可控
//!    的身份字段。
//!
//! 反过来做——先签名再查 scope——就会在 Relay 上留下一条本不该存在的事件，
//! 而事件发出去就收不回来了。

use crate::audit::Evidence;
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use collab_bridge::bridge::{Custody, Delivery, IdentityClient};
use collab_bridge::limits::RelayLimits;
use collab_bridge::operator::{LimitKind, OperatorError};
use contracts::EvidenceKind;
use contracts::{ErrorBody, ErrorClass, ReasonCode};
use secret_store::SecretRef;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

use crate::audit::{append, AuditEntry};
use crate::bff::{resolve_execution_context, BffState, ExecutionContext};

/// 消息发布的 action key。审计、对账与度量都按它找这一类动作。
pub const PUBLISH_ACTION: &str = "workspace.message.publish";

#[derive(Debug, Deserialize)]
pub struct PublishRequest {
    /// 消息正文。它是业务数据，进 Relay 不进 Core——Core 只存 scope、owner、
    /// binding、准入、投影、审计与外部引用（`.design/01`）。
    pub content: String,
    /// 先经 `upload_media` 上传、再随消息引用的媒体。
    #[serde(default)]
    pub attachments: Vec<Attachment>,
}

/// 一份已上传的媒体，即 `upload_media` 返回的 Blossom descriptor。
#[derive(Debug, Deserialize)]
pub struct Attachment {
    pub url: String,
    pub sha256: String,
    #[serde(rename = "type")]
    pub mime: String,
    pub size: u64,
}

impl Attachment {
    /// 按上游客户端的同一形式输出：正文追加一行 markdown，另带一条 NIP-92
    /// `imeta`。形式必须与原生端一致，否则原生端收到 Web 发的图看不见
    /// （上游 `formatImetaMediaLine`/`buildImetaTags`，`SF-BUZ-36`）。
    ///
    /// 只接受图片与视频：通用文件在上游还要带 filename 与链接文字，一期
    /// Web 不提供那条入口。
    ///
    /// URL 只核结构：必须是**本 Workspace 的 Community host** 下的
    /// `/media/<sha256>.<ext>`。不核它就等于让 BFF 替任何人签一条指向任意
    /// 地址的引用。blob 是否存在、MIME 与大小是否属实，由 Relay 按自己的
    /// sidecar 核对（`verify_imeta_blobs`），这里不再做一遍。
    fn render(&self, community_host: &str) -> Option<(String, Vec<String>)> {
        let kind = match self.mime.split_once('/') {
            Some(("image", _)) => "image",
            Some(("video", _)) => "video",
            _ => return None,
        };
        if self.sha256.len() != 64 || !self.sha256.chars().all(|c| c.is_ascii_hexdigit()) {
            return None;
        }
        let url = reqwest::Url::parse(&self.url).ok()?;
        let ext = url
            .path()
            .strip_prefix("/media/")?
            .strip_prefix(self.sha256.as_str())?
            .strip_prefix('.')?;
        let ext_ok = (1..=8).contains(&ext.len())
            && ext
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit());
        // 比 authority 而不只是主机名：Relay 把非默认端口算作 host 的一部分
        // （SF-BUZ-41），Community host 带端口时 URL 也必须带同一个端口
        let authority = match url.port() {
            Some(port) => format!("{}:{port}", url.host_str()?),
            None => url.host_str()?.to_owned(),
        };
        if authority != community_host
            || !ext_ok
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return None;
        }
        let mut tag = vec![
            "imeta".to_owned(),
            format!("url {}", self.url),
            format!("m {}", self.mime),
            format!("x {}", self.sha256),
        ];
        if self.size > 0 {
            tag.push(format!("size {}", self.size));
        }
        Some((format!("\n![{kind}]({})", self.url), tag))
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishResponse {
    /// Relay 接受后回传的 event id。它是 operation outcome 与 audit evidence
    /// （`.design/09` 第 6 步），不是本地算出来的值。
    pub event_id: String,
    pub operation_id: Uuid,
}

#[derive(Debug, Serialize)]
pub struct QueryResponse {
    pub events: serde_json::Value,
}

/// 发一条 Workspace 消息。
pub async fn publish_message(
    State(state): State<BffState>,
    Path(workspace_id): Path<Uuid>,
    headers: HeaderMap,
    body: Result<Json<PublishRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    let Ok(Json(req)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };

    // 幂等键由调用方为「这一次发送意图」生成，重发时带同一个键（DD-81）。
    // 缺失即拒绝：没有它，结果不明后的重发只能再发一条。
    let Some(idempotency_key) = headers
        .get("idempotency-key")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<Uuid>().ok())
    else {
        return StatusCode::BAD_REQUEST.into_response();
    };

    let scope = match admit_workspace(&state, &ctx, workspace_id).await {
        Ok(s) => s,
        Err(r) => return r,
    };

    // 同一个键已经发过：不再发，回答那次的结论。只有确定未送达才允许重新发送。
    let previous = match sqlx::query!(
        r#"select a.operation_id, a.event_id,
                  (select r.result_code from audit.audit_event r
                    where r.operation_id = a.operation_id
                      and r.event_type in ('OUTCOME', 'RECONCILIATION')
                    order by r.occurred_at desc limit 1) as "result?"
           from admission.publish_attempt a
           where a.tenant_principal_id = $1 and a.idempotency_key = $2"#,
        ctx.tenant_principal_id,
        idempotency_key
    )
    .fetch_optional(&state.pool)
    .await
    {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!(error = %e, "读取发布幂等记录失败");
            return error_body(
                StatusCode::SERVICE_UNAVAILABLE,
                ErrorClass::Precondition,
                ReasonCode::DependencyUnavailable,
                None,
            );
        }
    };
    if let Some(p) = &previous {
        match p.result.as_deref() {
            Some("ACCEPTED") => {
                return (
                    StatusCode::OK,
                    Json(PublishResponse {
                        event_id: p.event_id.clone(),
                        operation_id: p.operation_id,
                    }),
                )
                    .into_response()
            }
            Some("REJECTED") => {
                return error_body(
                    StatusCode::FORBIDDEN,
                    ErrorClass::Denied,
                    ReasonCode::PublishRejected,
                    Some(p.operation_id),
                )
            }
            Some("NOT_DELIVERED") => {}
            // 还没有结论：仍是那一次的结果不明，不能再发一条
            _ => {
                return error_body(
                    StatusCode::SERVICE_UNAVAILABLE,
                    ErrorClass::Unknown,
                    ReasonCode::PublishResultUnknown,
                    Some(p.operation_id),
                )
            }
        }
    }

    let keys = match actor_keys(&state, &ctx).await {
        Ok(k) => k,
        Err(r) => return r,
    };
    let client = match identity_client(&state, &keys, &scope) {
        Ok(c) => c,
        Err(r) => return r,
    };

    let mut content = req.content;
    let mut media_tags = Vec::with_capacity(req.attachments.len());
    for a in &req.attachments {
        let Some((line, tag)) = a.render(&scope.community_host) else {
            return StatusCode::BAD_REQUEST.into_response();
        };
        content.push_str(&line);
        media_tags.push(tag);
    }

    // 大小上界在发往 Relay 之前预检（`.design/09`：单 event content 不超过 256 KiB；
    // `apps/07` §5：BFF 侧先行设界）。超限是确定的 LIMIT：不签名、不落 DISPATCH、
    // 不占 Relay 的额度。按字节计，与 Relay 的 `content.len()` 同一口径。
    if content.len() > state.message_max_content_bytes {
        tracing::info!(
            size = content.len(),
            max = state.message_max_content_bytes,
            "消息正文超过登记上界"
        );
        return error_body(
            StatusCode::PAYLOAD_TOO_LARGE,
            ErrorClass::Limit,
            ReasonCode::PayloadTooLarge,
            None,
        );
    }

    // 运行期 NIP-11 与 binding 快照一致才发：对不上说明 Relay 的上界已变而 binding
    // 未重新查证，不能沿用旧快照继续写入（`.design/09`「BFF Relay 连接模型」）
    if let Err(c) = relay_limits(&state, &scope).await {
        return c.into_response();
    }

    // 预算在落 DISPATCH 之前取：取不到就既不落账也不发送，请求不打到 Relay
    let admitted = match client.admit() {
        Ok(a) => a,
        Err(e) => return relay_error_response(&e, None),
    };

    // 先签名：event id 在签完时就确定。把它连同 actor、scope、operation 落进
    // DISPATCH 审计之后才发送——之后无论结果如何，这条消息动作都可关联
    // （Stage 1 退出门禁），结果不明时也有一个能去 Relay 查证的键（DD-81）。
    let event = match client.sign_channel_message(&scope.channel_id, &content, &media_tags) {
        Ok(e) => e,
        Err(e) => {
            tracing::warn!(error = %e, "签名失败");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    };
    let event_id = event.id.to_hex();
    let operation_id = Uuid::new_v4();
    let entry = |event_type: &'static str, event_key: String, result_code: &'static str| {
        AuditEntry {
            event_key,
            tenant_id: Some(ctx.tenant_id),
            workspace_id: Some(workspace_id),
            operation_id,
            event_type,
            human_identity_id: Some(ctx.human_identity_id),
            initiator_principal_id: Some(ctx.tenant_principal_id),
            actor_principal_id: Some(ctx.tenant_principal_id),
            action_key: PUBLISH_ACTION,
            action_version: 1,
            component_type_key: "buzz",
            target_type: Some("CHANNEL"),
            target_id: Some(workspace_id),
            // 正文不进审计。摘要也不进：它对正文可做字典攻击，而审计要的是
            // 「谁在哪里做了什么」，不是「说了什么」（`.design/03` §9）。
            parameter_hash: "NONE",
            decision: "ALLOW",
            result_code,
            result_exposure: "NONE",
            evidence_refs: vec![
                Evidence::new(EvidenceKind::BuzzEventId, &event_id),
                Evidence::new(EvidenceKind::PlatformSessionId, ctx.session_id),
            ],
            correlation_id: operation_id,
        }
    };

    // 没落账就不发：一条发出去却无从关联的消息，正是「成功但不可核验」。
    // 幂等记录与 DISPATCH 同一事务：两者只能一起成立。
    let dispatched: Result<bool, sqlx::Error> = async {
        let mut tx = state.pool.begin().await?;
        let claimed = match &previous {
            // 上一次确定未送达：把这个键改指向新的一次，条件是它仍指向上一次
            Some(p) => sqlx::query!(
                "update admission.publish_attempt
                 set operation_id = $3, event_id = $4, created_at = now()
                 where tenant_principal_id = $1 and idempotency_key = $2 and operation_id = $5",
                ctx.tenant_principal_id,
                idempotency_key,
                operation_id,
                event_id,
                p.operation_id,
            )
            .execute(&mut *tx)
            .await?
            .rows_affected(),
            None => sqlx::query!(
                "insert into admission.publish_attempt
                     (tenant_principal_id, idempotency_key, operation_id, event_id)
                 values ($1, $2, $3, $4) on conflict do nothing",
                ctx.tenant_principal_id,
                idempotency_key,
                operation_id,
                event_id,
            )
            .execute(&mut *tx)
            .await?
            .rows_affected(),
        };
        if claimed == 0 {
            // 同一个键的另一次请求抢先了：那一次在发，这一次不发
            return Ok(false);
        }
        append(
            &mut tx,
            entry(
                "DISPATCH",
                format!("message.publish:{event_id}:dispatch"),
                "DISPATCHED",
            ),
        )
        .await?;
        tx.commit().await?;
        Ok(true)
    }
    .await;
    match dispatched {
        Ok(true) => {}
        Ok(false) => {
            return error_body(
                StatusCode::SERVICE_UNAVAILABLE,
                ErrorClass::Unknown,
                ReasonCode::PublishResultUnknown,
                None,
            )
        }
        Err(e) => {
            tracing::warn!(error = %e, "发布前审计未写入，不发送");
            return error_body(
                StatusCode::SERVICE_UNAVAILABLE,
                ErrorClass::Precondition,
                ReasonCode::DependencyUnavailable,
                None,
            );
        }
    }

    match client.deliver(&state.http, &event, admitted).await {
        Delivery::Accepted => {
            // 结果写不进去不改变「已送达」：DISPATCH 已在，兜底对账按 event id
            // 查到它后补记（publish_reconcile）
            if let Err(e) = record(
                &state,
                entry("OUTCOME", format!("message.publish:{event_id}"), "ACCEPTED"),
            )
            .await
            {
                tracing::warn!(error = %e, "发布结果审计未写入，留给对账");
            }
            (
                StatusCode::OK,
                Json(PublishResponse {
                    event_id,
                    operation_id,
                }),
            )
                .into_response()
        }
        Delivery::Rejected(why) => {
            tracing::warn!(reason = %why, "Relay 拒绝发布");
            if let Err(e) = record(
                &state,
                entry("OUTCOME", format!("message.publish:{event_id}"), "REJECTED"),
            )
            .await
            {
                tracing::warn!(error = %e, "发布结果审计未写入，留给对账");
            }
            error_body(
                StatusCode::FORBIDDEN,
                ErrorClass::Denied,
                ReasonCode::PublishRejected,
                Some(operation_id),
            )
        }
        // Relay 在读取事件之前以 429/413 拒绝：确定未落库。结果记 NOT_DELIVERED——
        // 同一个幂等键按策略重发时允许再发（上面的幂等分支），而不是记成不可重试的
        // REJECTED；回应是 LIMIT，不是 DENIED（`apps/06` §4）。
        Delivery::Limited(kind, why) => {
            tracing::warn!(reason = %why, "Relay 以上界拒绝发布");
            if let Err(e) = record(
                &state,
                entry(
                    "OUTCOME",
                    format!("message.publish:{event_id}"),
                    "NOT_DELIVERED",
                ),
            )
            .await
            {
                tracing::warn!(error = %e, "发布结果审计未写入，留给对账");
            }
            limit_response(kind, None, Some(operation_id))
        }
        // 结果不明：不写结果、不重发，交给对账（DD-81）。调用方拿到 operation
        // id，界面显示待确认而不是成功或失败（06 §4）。
        Delivery::Unknown(why) => {
            tracing::warn!(error = %why, "发布结果不明");
            error_body(
                StatusCode::SERVICE_UNAVAILABLE,
                ErrorClass::Unknown,
                ReasonCode::PublishResultUnknown,
                Some(operation_id),
            )
        }
    }
}

async fn record(state: &BffState, entry: AuditEntry<'_>) -> Result<(), sqlx::Error> {
    let mut tx = state.pool.begin().await?;
    append(&mut tx, entry).await?;
    tx.commit().await
}

fn error_body(
    status: StatusCode,
    class: ErrorClass,
    reason: ReasonCode,
    operation_id: Option<Uuid>,
) -> Response {
    (
        status,
        Json(ErrorBody {
            class,
            reason,
            operation_id: operation_id.map(|o| o.to_string()),
        }),
    )
        .into_response()
}

/// `LIMIT` 类回应（`apps/06` §4）。Core 预算给出重置时刻时带 `Retry-After`。
fn limit_response(
    kind: LimitKind,
    retry_after: Option<u64>,
    operation_id: Option<Uuid>,
) -> Response {
    let (status, reason) = match kind {
        LimitKind::RateLimited => (StatusCode::TOO_MANY_REQUESTS, ReasonCode::RateLimited),
        LimitKind::PayloadTooLarge => (StatusCode::PAYLOAD_TOO_LARGE, ReasonCode::PayloadTooLarge),
        // 订阅容量只出现在 stream 上，那里在带内表达；HTTP 路径到这里说明
        // 上游给了一个本侧没有登记的上界，按依赖不可用处理
        LimitKind::Capacity => {
            return error_body(
                StatusCode::SERVICE_UNAVAILABLE,
                ErrorClass::Precondition,
                ReasonCode::DependencyUnavailable,
                operation_id,
            )
        }
    };
    let mut response = error_body(status, ErrorClass::Limit, reason, operation_id);
    if let Some(secs) = retry_after {
        if let Ok(v) = axum::http::HeaderValue::from_str(&secs.to_string()) {
            response
                .headers_mut()
                .insert(axum::http::header::RETRY_AFTER, v);
        }
    }
    response
}

/// 发往 Relay 的请求失败时的回应：LIMIT 类按上界分类，其余是依赖不可用。
/// 用于没有外部副作用的读取与发送前的预算检查；发布结果另有三态处理。
pub(crate) fn relay_error_response(e: &OperatorError, operation_id: Option<Uuid>) -> Response {
    match e.limit() {
        Some(kind) => limit_response(kind, e.retry_after_secs(), operation_id),
        None => error_body(
            StatusCode::SERVICE_UNAVAILABLE,
            ErrorClass::Precondition,
            ReasonCode::DependencyUnavailable,
            operation_id,
        ),
    }
}

/// 运行期 NIP-11 核对不成立的两种情形。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RelayCheck {
    /// 读不到 binding（Core 库不可用）
    Unavailable,
    /// 运行期抓不到 NIP-11（含缓存过期后重抓失败）。DD-114(1)：只使该次请求以
    /// `BINDING_NOT_ACTIVE` fail closed，不迁移状态——传输失败不是不一致的证据
    Nip11Unavailable,
    /// 读到的文档 digest 与 ACTIVE binding 的快照不一致
    Mismatch,
}

impl RelayCheck {
    /// 流上的关闭原因（带内表达，见 `stream::closed_in_band`）
    pub fn stream_reason(self) -> &'static str {
        match self {
            RelayCheck::Unavailable | RelayCheck::Nip11Unavailable => "upstream-unavailable",
            RelayCheck::Mismatch => "binding-not-active",
        }
    }
}

impl IntoResponse for RelayCheck {
    fn into_response(self) -> Response {
        let reason = match self {
            RelayCheck::Unavailable => ReasonCode::DependencyUnavailable,
            RelayCheck::Nip11Unavailable | RelayCheck::Mismatch => ReasonCode::BindingNotActive,
        };
        error_body(
            StatusCode::SERVICE_UNAVAILABLE,
            ErrorClass::Precondition,
            reason,
            None,
        )
    }
}

/// 运行期读取该 Community 的 NIP-11，并与 ACTIVE TenantBuzzBinding 的快照比对。
///
/// `.design/03` §2：运行连接不得使用超出 ACTIVE binding 快照声明值的订阅、filter、limit
/// 或 frame 合同；`.design/09`：digest 不一致时不能沿用未验证的旧上界。于是只有读到的
/// 文档与快照逐字节同一（canonical digest 相等）时，才把它的上界交给调用方——那就是
/// 快照声明的值。读不到文档或 binding 都 fail closed，不回退到任何缺省上界。
///
/// binding 状态本身（进入 `RECONCILING`）由 Tenant 生命周期的查证负责；这里只保证
/// 对不上时不再以旧上界发出新的订阅、查询与写入。
pub async fn relay_limits(
    state: &BffState,
    scope: &WorkspaceScope,
) -> Result<RelayLimits, RelayCheck> {
    let snapshot: Option<Option<String>> = sqlx::query_scalar(
        "select nip11_snapshot_digest from projection.tenant_buzz_binding
         where normalized_host = $1 and state = 'ACTIVE'",
    )
    .bind(&scope.community_host)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| {
        tracing::warn!(error = %e, "读 binding 的 NIP-11 快照失败");
        RelayCheck::Unavailable
    })?;
    let doc = state
        .relay_nip11
        .get(&state.http, &scope.community_host)
        .await
        .map_err(|e| {
            tracing::warn!(error = %e, host = %scope.community_host, "运行期读取 NIP-11 失败");
            RelayCheck::Nip11Unavailable
        })?;
    match snapshot.flatten() {
        Some(expected) if expected == doc.digest => Ok(doc.limits.clone()),
        Some(expected) => {
            tracing::warn!(
                host = %scope.community_host,
                expected = %expected,
                observed = %doc.digest,
                "运行期 NIP-11 与 binding 快照不一致"
            );
            Err(RelayCheck::Mismatch)
        }
        None => Err(RelayCheck::Mismatch),
    }
}

/// 读该 Workspace 的历史消息。
///
/// filter 由 Core 构造，Browser 不提交任何 filter。`DD-39` 明写 Browser「不能
/// 提交 raw signed event 或任意 Relay filter 绕过语义命令」——放开 filter 就等于
/// 把 Relay 的查询面原样暴露给浏览器，scope 边界随之失效。
pub async fn query_messages(
    State(state): State<BffState>,
    Path(workspace_id): Path<Uuid>,
    headers: HeaderMap,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    let scope = match admit_workspace(&state, &ctx, workspace_id).await {
        Ok(s) => s,
        Err(r) => return r,
    };
    let keys = match actor_keys(&state, &ctx).await {
        Ok(k) => k,
        Err(r) => return r,
    };
    let client = match identity_client(&state, &keys, &scope) {
        Ok(c) => c,
        Err(r) => return r,
    };

    let limits = match relay_limits(&state, &scope).await {
        Ok(l) => l,
        Err(c) => return c.into_response(),
    };

    // kind 9 是 NIP-29 的频道消息；`#h` 把结果限定在该 Workspace 的 Channel 内。
    // limit 不接受调用方指定：取部署登记值与 NIP-11 `max_limit` 的交集——Relay 的
    // 上限不是平台该放行的值，登记值也不能超过 Relay 声明的上界（`.design/09`）。
    let filter = serde_json::json!({
        "kinds": [9],
        "#h": [scope.channel_id],
        "limit": page_limit(&state, &limits),
    });
    match client.query(&state.http, &[filter]).await {
        Ok(events) => (StatusCode::OK, Json(QueryResponse { events })).into_response(),
        Err(e) => {
            tracing::warn!(error = %e, "查询历史失败");
            relay_error_response(&e, None)
        }
    }
}

/// 单页上界：部署登记值与 NIP-11 `max_limit` 的交集。
pub fn page_limit(state: &BffState, limits: &RelayLimits) -> i64 {
    state.message_page_limit.min(limits.max_limit)
}

/// 一次 Workspace 准入通过后确定下来的事实。
pub struct WorkspaceScope {
    pub channel_id: String,
    pub community_host: String,
    /// stream generation 使用真实的准入依据，不为无 Membership 的管理者捏造
    /// membership version。管理资格仍在每次请求与 stream 再准入时 fresh Check。
    pub admission_epoch: WorkspaceAdmissionEpoch,
}

/// scope 的准入依据及其 Core 事实版本。依据改变也使旧 stream generation 失效。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkspaceAdmissionEpoch {
    Membership {
        tenant_version: i32,
        workspace_version: i32,
        membership_id: Uuid,
        version: i32,
    },
    WorkspaceManage {
        tenant_version: i32,
        workspace_version: i32,
    },
    TenantManage {
        tenant_version: i32,
        workspace_version: i32,
        membership_id: Uuid,
        membership_version: i32,
    },
}

/// HUMAN 的 Workspace scope guard（`.design/03` §2、`DD-41/46`）。
///
/// Membership 与管理资格共用同一判定；Buzz 读写还必须有两侧 ACTIVE binding。
pub async fn admit_workspace(
    state: &BffState,
    ctx: &ExecutionContext,
    workspace_id: Uuid,
) -> Result<WorkspaceScope, Response> {
    admit_workspace_scope(state, ctx, workspace_id)
        .await
        .map_err(IntoResponse::into_response)
}

/// Workspace 准入不通过的三种情形。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdmissionFailure {
    /// 身份、成员、Tenant 或 Workspace 状态不满足；与「不存在」同一个回答
    Denied,
    /// 调用方本可进入，但该 Workspace 的 Buzz binding 不是 ACTIVE（DD-114(2)：
    /// TenantBuzzBinding 因 NIP-11 漂移处于 RECONCILING 等）。这是可恢复的前置条件，
    /// 不是撤权
    BindingNotActive,
    /// Core 库或 fresh 授权依赖不可判定
    Unavailable,
}

impl IntoResponse for AdmissionFailure {
    fn into_response(self) -> Response {
        match self {
            AdmissionFailure::Denied => error_body(
                StatusCode::FORBIDDEN,
                ErrorClass::Denied,
                ReasonCode::PermissionDenied,
                None,
            ),
            AdmissionFailure::BindingNotActive => error_body(
                StatusCode::SERVICE_UNAVAILABLE,
                ErrorClass::Precondition,
                ReasonCode::BindingNotActive,
                None,
            ),
            AdmissionFailure::Unavailable => error_body(
                StatusCode::SERVICE_UNAVAILABLE,
                ErrorClass::Precondition,
                ReasonCode::DependencyUnavailable,
                None,
            ),
        }
    }
}

#[derive(sqlx::FromRow)]
struct WorkspaceAdmissionRow {
    workspace_id: Uuid,
    tenant_version: i32,
    workspace_version: i32,
    membership_id: Option<Uuid>,
    membership_state: Option<String>,
    membership_version: Option<i32>,
}

/// 列表、Relay 准入与用户状态共用的 HUMAN scope 资格（不包含 Buzz binding）。
///
/// 先限制同 Tenant、ACTIVE Workspace/身份/会话，再按治理内核已有规则判定：
/// ACTIVE Membership；从未加入者的 fresh workspace.manage；存在非 ACTIVE
/// Membership 时还需 fresh tenant.manage，不能让残留 workspace#admin 绕过撤权。
/// 批量 Check 的不完整或未知结果使整次判定失败，不返回貌似完整的部分列表。
pub(crate) async fn workspace_admissions(
    state: &BffState,
    ctx: &ExecutionContext,
    workspace_ids: &[Uuid],
) -> Result<HashMap<Uuid, WorkspaceAdmissionEpoch>, AdmissionFailure> {
    let rows: Vec<WorkspaceAdmissionRow> = sqlx::query_as(
        "select w.id as workspace_id, t.version as tenant_version,
                w.version as workspace_version,
                wm.id as membership_id, wm.state as membership_state,
                wm.version as membership_version
         from identity.workspace w
         join identity.tenant t on t.id = w.tenant_id and t.state = 'ACTIVE'
         join identity.principal p
           on p.id = $2 and p.tenant_id = t.id and p.kind = 'HUMAN' and p.status = 'ACTIVE'
         join identity.tenant_membership tm
           on tm.tenant_principal_id = p.id and tm.tenant_id = t.id and tm.state = 'ACTIVE'
         join identity.human_identity h
           on h.id = tm.human_identity_id and h.id = $5 and h.status = 'ACTIVE'
         join identity.platform_session s
           on s.id = $4 and s.tenant_membership_id = tm.id and s.human_identity_id = h.id
          and s.status = 'ACTIVE' and s.expires_at > now()
         left join identity.workspace_membership wm
           on wm.workspace_id = w.id and wm.tenant_principal_id = p.id
         where w.id = any($1) and w.tenant_id = $3 and w.state = 'ACTIVE'",
    )
    .bind(workspace_ids)
    .bind(ctx.tenant_principal_id)
    .bind(ctx.tenant_id)
    .bind(ctx.session_id)
    .bind(ctx.human_identity_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| {
        tracing::warn!(error = %e, "Workspace scope 资格查询失败");
        AdmissionFailure::Unavailable
    })?;
    let mut admitted = HashMap::new();
    let mut management = Vec::new();
    for WorkspaceAdmissionRow {
        workspace_id,
        tenant_version,
        workspace_version,
        membership_id,
        membership_state,
        membership_version,
    } in rows
    {
        match (
            membership_id,
            membership_state.as_deref(),
            membership_version,
        ) {
            (Some(membership_id), Some("ACTIVE"), Some(version)) => {
                admitted.insert(
                    workspace_id,
                    WorkspaceAdmissionEpoch::Membership {
                        tenant_version,
                        workspace_version,
                        membership_id,
                        version,
                    },
                );
            }
            (None, None, None) => {
                management.push((workspace_id, tenant_version, workspace_version, None))
            }
            (
                Some(membership_id),
                Some("PROVISIONING" | "REVOKING" | "REVOKED" | "ERROR"),
                Some(version),
            ) => management.push((
                workspace_id,
                tenant_version,
                workspace_version,
                Some((membership_id, version)),
            )),
            _ => return Err(AdmissionFailure::Unavailable),
        }
    }
    if management.is_empty() {
        return Ok(admitted);
    }
    let ids: Vec<String> = management
        .iter()
        .map(|(id, _, _, _)| id.to_string())
        .collect();
    let actor = ctx.tenant_principal_id.to_string();
    let managed = state
        .governance
        .spicedb
        .check_bulk("workspace", &ids, "manage", &actor)
        .await
        .map_err(|e| {
            tracing::warn!(error = %e, "Workspace scope fresh manage 判定失败");
            AdmissionFailure::Unavailable
        })?;
    let tenant_manage = if management
        .iter()
        .any(|(id, _, _, membership)| membership.is_some() && managed.contains(&id.to_string()))
    {
        let tenant = ctx.tenant_id.to_string();
        state
            .governance
            .spicedb
            .check_bulk("tenant", std::slice::from_ref(&tenant), "manage", &actor)
            .await
            .map_err(|e| {
                tracing::warn!(error = %e, "Workspace scope fresh tenant manage 判定失败");
                AdmissionFailure::Unavailable
            })?
            .contains(&tenant)
    } else {
        false
    };
    for (workspace_id, tenant_version, workspace_version, membership) in management {
        if !managed.contains(&workspace_id.to_string()) {
            continue;
        }
        let epoch = match membership {
            None => WorkspaceAdmissionEpoch::WorkspaceManage {
                tenant_version,
                workspace_version,
            },
            Some((membership_id, membership_version)) if tenant_manage => {
                WorkspaceAdmissionEpoch::TenantManage {
                    tenant_version,
                    workspace_version,
                    membership_id,
                    membership_version,
                }
            }
            Some(_) => continue,
        };
        admitted.insert(workspace_id, epoch);
    }
    Ok(admitted)
}

/// [`admit_workspace`] 的类型化结果：stream 的开流与再准入需要区分「撤权」与
/// 「binding 暂不可用」，前者关流不再续，后者按重连间隔续。
pub async fn admit_workspace_scope(
    state: &BffState,
    ctx: &ExecutionContext,
    workspace_id: Uuid,
) -> Result<WorkspaceScope, AdmissionFailure> {
    let admission_epoch = workspace_admissions(state, ctx, &[workspace_id])
        .await?
        .remove(&workspace_id)
        .ok_or(AdmissionFailure::Denied)?;
    let row: Option<(Option<Uuid>, Option<String>)> = sqlx::query_as(
        "select b.channel_id, t.normalized_host
         from identity.workspace w
         join identity.tenant tenant
           on tenant.id = w.tenant_id and tenant.state = 'ACTIVE'
         left join projection.workspace_buzz_binding b
           on b.workspace_id = w.id and b.state = 'ACTIVE'
         left join projection.tenant_buzz_binding t
           on t.tenant_id = w.tenant_id and t.state = 'ACTIVE'
         where w.id = $1 and w.tenant_id = $2 and w.state = 'ACTIVE'",
    )
    .bind(workspace_id)
    .bind(ctx.tenant_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| {
        tracing::warn!(error = %e, "Workspace 准入查询失败");
        AdmissionFailure::Unavailable
    })?;

    // 资格已成立才区分 binding 前置条件；无权或不同 Tenant 的调用方在上面
    // 得到同一个 403。若 Workspace 在两次查询间离开 ACTIVE，仍是拒绝而非 binding 故障。
    let Some((channel_id, community_host)) = row else {
        return Err(AdmissionFailure::Denied);
    };
    let (Some(channel_id), Some(community_host)) = (channel_id, community_host) else {
        return Err(AdmissionFailure::BindingNotActive);
    };
    Ok(WorkspaceScope {
        channel_id: channel_id.to_string(),
        community_host,
        admission_epoch,
    })
}

/// 以该 HUMAN 的 BuzzIdentityBinding 构造代签客户端。
///
/// `custody=CLIENT` 的身份由原生端本机持钥直连 Relay，Core 手里没有那把钥匙。
/// 走到这里说明调用方是 Web 端而该身份是原生端托管——不拿别的身份凑合，
/// 当场拒绝（`DD-75`）。
/// 取该 HUMAN 的签名密钥。
///
/// 与构造 HTTP 客户端分开：实时订阅要用同一把钥匙另建 NIP-42 WebSocket 会话
/// （`.design/09` 第 4 步），两条路共用密钥取用与托管校验，不共用连接。
pub async fn actor_keys(state: &BffState, ctx: &ExecutionContext) -> Result<nostr::Keys, Response> {
    // 只取 Web 的那一把：一个人还可能有原生设备的 CLIENT 身份（DD-77），
    // 那些私钥不在 Core 手里，也就不在这里的候选之内。每人至多一条非 REVOKED
    // 的 SERVER binding，由库里的部分唯一索引保证。
    let row = sqlx::query!(
        "select pubkey, private_key_secret_ref, private_key_secret_version,
                private_key_secret_audience
         from identity.buzz_identity_binding
         where tenant_id = $1 and principal_id = $2 and kind = 'HUMAN'
           and custody = 'SERVER' and state = 'ACTIVE'",
        ctx.tenant_id,
        ctx.tenant_principal_id,
    )
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| {
        tracing::warn!(error = %e, "读 HUMAN binding 失败");
        StatusCode::SERVICE_UNAVAILABLE.into_response()
    })?
    .ok_or_else(|| {
        tracing::warn!(principal = %ctx.tenant_principal_id, "没有 ACTIVE 的 Web（SERVER）Buzz 身份");
        StatusCode::FORBIDDEN.into_response()
    })?;

    let secret = SecretRef {
        locator: row.private_key_secret_ref.unwrap_or_default(),
        version: row.private_key_secret_version.unwrap_or_default() as u32,
        audience: row.private_key_secret_audience.unwrap_or_default(),
    };
    crate::server_identity::read_bound_keys(&state.secrets, &secret, &row.pubkey)
        .await
        .map_err(|e| {
        tracing::warn!(error = %e, principal = %ctx.tenant_principal_id, "HUMAN 私钥不匹配或不可用");
        StatusCode::SERVICE_UNAVAILABLE.into_response()
    })
}

/// 用已取到的密钥构造 HTTP bridge 客户端。
// Response 本身较大，但这条路径每请求只走一次，装箱换来的间接寻址不值当
#[allow(clippy::result_large_err)]
pub fn identity_client(
    state: &BffState,
    keys: &nostr::Keys,
    scope: &WorkspaceScope,
) -> Result<IdentityClient, Response> {
    IdentityClient::new(
        Custody::Server,
        &keys.secret_key().to_secret_hex(),
        &state.relay_transport,
        &scope.community_host,
    )
    // BFF 发出的每次 HTTP bridge 调用都先过 Core 预算（`apps/07` §5）
    .map(|c| c.with_budget(std::sync::Arc::clone(&state.relay_budget)))
    .map_err(|e| {
        tracing::warn!(error = %e, "构造代签客户端失败");
        StatusCode::FORBIDDEN.into_response()
    })
}

/// 上传一份媒体到该 Workspace 的 Relay。
///
/// `DD-39`：Relay media 也由 BFF 以 actor identity 签名读写。Browser 不持
/// signer，因此 Blossom 授权事件只能由 Core 代签。
pub async fn upload_media(
    State(state): State<BffState>,
    Path(workspace_id): Path<Uuid>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    // 大小上界在 BFF 侧先行设定，不把压力透传给 Relay（`07` §5）。
    // 超限是确定的拒绝，映射到 LIMIT 类，而不是让上游给一个不区分成因的错误。
    if body.len() as u64 > state.media_max_bytes {
        tracing::warn!(size = body.len(), "媒体超过登记上界");
        return StatusCode::PAYLOAD_TOO_LARGE.into_response();
    }
    let mime = headers
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_owned();

    let scope = match admit_workspace(&state, &ctx, workspace_id).await {
        Ok(s) => s,
        Err(r) => return r,
    };
    let keys = match actor_keys(&state, &ctx).await {
        Ok(k) => k,
        Err(r) => return r,
    };
    let client = match identity_client(&state, &keys, &scope) {
        Ok(c) => c,
        Err(r) => return r,
    };

    if let Err(c) = relay_limits(&state, &scope).await {
        return c.into_response();
    }

    match client.upload_media(&state.http, body.to_vec(), &mime).await {
        Ok(descriptor) => (StatusCode::OK, Json(descriptor)).into_response(),
        Err(e) => {
            tracing::warn!(error = %e, "媒体上传失败");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}

/// 取回一份媒体。
///
/// 路径由 Core 拼成 `/media/<sha256>`，不接受调用方给出的任意路径——放开它
/// 等于把 Relay 的整个 HTTP 面变成一个可代签的代理。
pub async fn fetch_media(
    State(state): State<BffState>,
    Path((workspace_id, sha256)): Path<(Uuid, String)>,
    headers: HeaderMap,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    // sha256 必须是 64 位十六进制。不校验就等于把路径段交给调用方拼。
    if sha256.len() != 64 || !sha256.chars().all(|c| c.is_ascii_hexdigit()) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let scope = match admit_workspace(&state, &ctx, workspace_id).await {
        Ok(s) => s,
        Err(r) => return r,
    };
    let keys = match actor_keys(&state, &ctx).await {
        Ok(k) => k,
        Err(r) => return r,
    };
    let client = match identity_client(&state, &keys, &scope) {
        Ok(c) => c,
        Err(r) => return r,
    };

    if let Err(c) = relay_limits(&state, &scope).await {
        return c.into_response();
    }

    match client
        .fetch_media(&state.http, &format!("/media/{sha256}"))
        .await
    {
        Ok((bytes, content_type)) => (
            StatusCode::OK,
            [(axum::http::header::CONTENT_TYPE, content_type)],
            bytes,
        )
            .into_response(),
        Err(e) => {
            tracing::warn!(error = %e, "媒体取回失败");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn parts(r: Response) -> (StatusCode, Option<String>, serde_json::Value) {
        let status = r.status();
        let retry = r
            .headers()
            .get(axum::http::header::RETRY_AFTER)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned);
        let body = axum::body::to_bytes(r.into_body(), usize::MAX)
            .await
            .expect("读回应体");
        (
            status,
            retry,
            serde_json::from_slice(&body).expect("错误体是 JSON"),
        )
    }

    /// `relay-server-client.md` 第 2、3 节的不符：Relay 的 429 与大小上界曾被回成
    /// DENIED 或无分类的 503。这里固定 06 §4 的映射。
    #[tokio::test]
    async fn relay_limits_map_to_limit_class() {
        let rejected = |status| OperatorError::Rejected {
            status,
            body: String::new(),
        };

        let (s, retry, b) = parts(relay_error_response(&rejected(429), None)).await;
        assert_eq!(s, StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(
            (b["class"].as_str(), b["reason"].as_str()),
            (Some("LIMIT"), Some("RATE_LIMITED"))
        );
        assert_eq!(retry, None, "Relay 的 429 没有可机读的重置时刻，不编一个");

        let (s, retry, b) = parts(relay_error_response(
            &OperatorError::BudgetExhausted {
                retry_after_secs: 7,
            },
            None,
        ))
        .await;
        assert_eq!(s, StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(b["class"], "LIMIT");
        assert_eq!(b["reason"], "RATE_LIMITED");
        assert_eq!(retry.as_deref(), Some("7"), "Core 预算的拒绝带 Retry-After");

        let (s, _, b) = parts(relay_error_response(&rejected(413), None)).await;
        assert_eq!(s, StatusCode::PAYLOAD_TOO_LARGE);
        assert_eq!(
            (b["class"].as_str(), b["reason"].as_str()),
            (Some("LIMIT"), Some("PAYLOAD_TOO_LARGE"))
        );

        // 其余失败不是 LIMIT，也不是无分类的空 503
        for status in [403, 500, 503] {
            let (s, _, b) = parts(relay_error_response(&rejected(status), None)).await;
            assert_eq!(s, StatusCode::SERVICE_UNAVAILABLE);
            assert_eq!(b["class"], "PRECONDITION", "HTTP {status}");
            assert_eq!(b["reason"], "DEPENDENCY_UNAVAILABLE", "HTTP {status}");
        }
    }

    /// DD-114(2)：binding 与依赖失败带 PRECONDITION；无权与不存在共用 DENIED 回应
    #[tokio::test]
    async fn admission_failures_are_classified() {
        let (s, _, b) = parts(AdmissionFailure::BindingNotActive.into_response()).await;
        assert_eq!(s, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(b["class"], "PRECONDITION");
        assert_eq!(b["reason"], "BINDING_NOT_ACTIVE");
        let (s, _, b) = parts(AdmissionFailure::Denied.into_response()).await;
        assert_eq!(s, StatusCode::FORBIDDEN);
        assert_eq!(b["class"], "DENIED");
        assert_eq!(b["reason"], "PERMISSION_DENIED");
        let (s, _, b) = parts(AdmissionFailure::Unavailable.into_response()).await;
        assert_eq!(s, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(b["class"], "PRECONDITION");
        assert_eq!(b["reason"], "DEPENDENCY_UNAVAILABLE");
    }

    #[tokio::test]
    async fn nip11_check_failures_are_preconditions() {
        let (s, _, b) = parts(RelayCheck::Mismatch.into_response()).await;
        assert_eq!(s, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(b["class"], "PRECONDITION");
        assert_eq!(b["reason"], "BINDING_NOT_ACTIVE");
        let (_, _, b) = parts(RelayCheck::Unavailable.into_response()).await;
        assert_eq!(b["reason"], "DEPENDENCY_UNAVAILABLE");
        // DD-114(1)：抓不到 NIP-11 以 BINDING_NOT_ACTIVE 拒绝该次请求
        let (_, _, b) = parts(RelayCheck::Nip11Unavailable.into_response()).await;
        assert_eq!(b["reason"], "BINDING_NOT_ACTIVE");
        assert_ne!(
            RelayCheck::Mismatch.stream_reason(),
            RelayCheck::Unavailable.stream_reason()
        );
    }
}
