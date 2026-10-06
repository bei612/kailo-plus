//! BFF stream（`apps/02` Stage 1「完整 snapshot + generation 的 BFF stream 恢复」）。
//!
//! Browser 不直连 Relay、不持 signer（`DD-39`）。它从这里拿两样东西：一份
//! snapshot 与一个 generation，随后是增量事件。断线重连时带上 generation——
//! **对不上就重新取 snapshot**，而不是从某个猜测的位置接着读。
//!
//! generation 绑定真实的成员、Tenant/Workspace 生命周期版本与 Channel；暂停后
//! 恢复也不能复用暂停前的 snapshot。管理资格仍做 fresh Check，但没有对应的
//! Core 授权版本可证明撤销后重新授予未发生，因此管理者的新流始终取完整 snapshot。
//!
//! 续流走 SSE 自带的协议，不另造：generation 作为事件 `id:` 下发，浏览器的
//! EventSource 断线后自动重连并把它放进 `Last-Event-ID` 头带回来；重连间隔
//! 由这里经 `retry:` 下发。EventSource 只在网络错误时自动重连；重连请求得到
//! HTTP 错误时它永久关闭，页面按 `retry` 帧里的同一个间隔重新打开（重开即重取
//! snapshot）。两条路径的时长都来自服务端，客户端不写死任何时长。
//!
//! 流只转发当前 active scope 的事件（`.design/09`）：filter 由 Core 构造并锁定
//! 在该 Workspace 的 Channel 上，调用方没有提交 filter 的入口。

use std::convert::Infallible;

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
};
use collab_bridge::operator::LimitKind;
use collab_bridge::stream::{Frame, SessionKey};
use futures_util::stream::Stream;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::bff::{resolve_execution_context, BffState, ExecutionContext};
use crate::web_transport::{
    actor_keys, admit_workspace_scope, community_client, community_limits, page_limit,
    AdmissionFailure, WorkspaceAdmissionEpoch, WorkspaceScope,
};

#[derive(Clone, Copy)]
enum StreamTarget {
    Workspace(Uuid),
    Conversation(Uuid),
}

enum StreamScope {
    Workspace(WorkspaceScope),
    Conversation(crate::conversations::ConversationScope),
}

impl StreamTarget {
    async fn admit(
        self,
        state: &BffState,
        ctx: &ExecutionContext,
    ) -> Result<StreamScope, AdmissionFailure> {
        match self {
            Self::Workspace(id) => admit_workspace_scope(state, ctx, id)
                .await
                .map(StreamScope::Workspace),
            Self::Conversation(id) => crate::conversations::admit(state, ctx, id)
                .await
                .map(StreamScope::Conversation)
                .map_err(|response| match response.status() {
                    axum::http::StatusCode::FORBIDDEN => AdmissionFailure::Denied,
                    _ => AdmissionFailure::Unavailable,
                }),
        }
    }
}

impl StreamScope {
    fn message_kinds(&self) -> Vec<u16> {
        let kinds = match self {
            Self::Workspace(_) => vec![
                contracts::WebMessageType::Stream,
                contracts::WebMessageType::ForumPost,
                contracts::WebMessageType::ForumComment,
            ],
            Self::Conversation(_) => vec![contracts::WebMessageType::Stream],
        };
        kinds
            .iter()
            .map(collab_bridge::bridge::message_kind)
            .collect()
    }

    fn channel_id(&self) -> &str {
        match self {
            Self::Workspace(scope) => &scope.channel_id,
            Self::Conversation(scope) => &scope.channel_id,
        }
    }

    fn community_host(&self) -> &str {
        match self {
            Self::Workspace(scope) => &scope.community_host,
            Self::Conversation(scope) => &scope.community_host,
        }
    }

    fn can_resume(&self) -> bool {
        // Private admission includes a fresh permission check without an
        // authorization epoch. Always refresh its snapshot.
        matches!(
            self,
            Self::Workspace(WorkspaceScope {
                admission_epoch: WorkspaceAdmissionEpoch::Membership { .. },
                ..
            })
        )
    }

    fn same_admission(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Workspace(before), Self::Workspace(after)) => {
                before.admission_epoch == after.admission_epoch
                    && before.channel_id == after.channel_id
                    && before.community_host == after.community_host
            }
            (Self::Conversation(before), Self::Conversation(after)) => before == after,
            _ => false,
        }
    }

    fn generation(&self, principal: &Uuid) -> String {
        match self {
            Self::Workspace(scope) => {
                generation_of(principal, &scope.channel_id, &scope.admission_epoch)
            }
            Self::Conversation(scope) => {
                let mut hash = Sha256::new();
                hash.update(b"conversation\0");
                hash.update(principal.as_bytes());
                hash.update(scope.channel_id.as_bytes());
                hash.update([0]);
                hash.update(scope.community_host.as_bytes());
                hash.update(scope.binding_version.to_be_bytes());
                hash.update(scope.tenant_binding_version.to_be_bytes());
                hex::encode(&hash.finalize()[..16])
            }
        }
    }
}

/// 打开一条 Workspace 事件流。
pub async fn open_stream(
    State(state): State<BffState>,
    Path(workspace_id): Path<Uuid>,
    headers: HeaderMap,
) -> Response {
    open_target_stream(state, StreamTarget::Workspace(workspace_id), headers).await
}

pub async fn open_conversation_stream(
    State(state): State<BffState>,
    Path(conversation_id): Path<Uuid>,
    headers: HeaderMap,
) -> Response {
    open_target_stream(state, StreamTarget::Conversation(conversation_id), headers).await
}

async fn open_target_stream(state: BffState, target: StreamTarget, headers: HeaderMap) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    let retry = std::time::Duration::from_millis(state.stream_retry_millis);
    let scope = match target.admit(&state, &ctx).await {
        Ok(s) => s,
        // binding 暂不是 ACTIVE（NIP-11 漂移重新查证中）是可恢复的：带内关闭并按
        // 间隔重连。非 200 会让浏览器永久停止重连，只留给确定的拒绝
        Err(AdmissionFailure::BindingNotActive) => {
            return closed_in_band(retry, "binding-not-active")
        }
        Err(AdmissionFailure::Unavailable) => {
            return closed_in_band(retry, "readmission-unavailable")
        }
        Err(f) => return f.into_response(),
    };
    let keys = match actor_keys(&state, &ctx).await {
        Ok(k) => k,
        Err(r) => return r,
    };

    // generation 由「谁 + 哪个 Channel + 哪次准入」共同决定。把 principal 放进去
    // 是必要的：同一个 Channel 上不同人看到的 scope 一样，但撤权只影响其中一个，
    // 而撤权必须让那个人的旧 generation 失效。
    // A changed native event set must refresh the snapshot even when the
    // membership epoch stayed the same across a client/server upgrade.
    let message_kinds = scope.message_kinds();
    let generation = format!(
        "{}:{}",
        scope.generation(&ctx.tenant_principal_id),
        message_kinds
            .iter()
            .map(u16::to_string)
            .collect::<Vec<_>>()
            .join(",")
    );
    // 上次拿到的 generation 由 EventSource 放在 Last-Event-ID 里带回。
    // 缺失或对不上都意味着要重新取 snapshot。管理者的准入只有 fresh Check，
    // 不能从生命周期版本推断管理授权未曾撤销再授予，不跳过完整 snapshot。
    let resume = scope.can_resume()
        && headers.get("last-event-id").and_then(|v| v.to_str().ok()) == Some(generation.as_str());

    // 运行期 NIP-11 与 binding 快照一致才开新流，且订阅与 snapshot 都按其上界预检
    // （`.design/09`「BFF Relay 连接模型」：对不上即关闭新 stream）
    let limits = match community_limits(&state, scope.community_host()).await {
        Ok(l) => l,
        Err(c) => return closed_in_band(retry, c.stream_reason()),
    };

    // snapshot 走 HTTP bridge，增量走 WS 订阅。两者用同一把钥匙、同一个
    // Community host，因此看到的 scope 是同一个。
    let client = match community_client(&state, &keys, scope.community_host()) {
        Ok(c) => c,
        Err(r) => return r,
    };
    let snapshot = if resume {
        // 续流不重发 snapshot：客户端手里那份仍然有效，重发会让它把已经渲染过
        // 的消息再渲染一遍。
        None
    } else {
        match client
            .query(
                &state.http,
                &[serde_json::json!({
                    "kinds": message_kinds,
                    "#h": [scope.channel_id()],
                    "limit": page_limit(&state, &limits),
                })],
            )
            .await
        {
            Ok(v) => Some(v),
            // 限流是 LIMIT，不是上游不可用：原因如实下发，重连间隔不短于预算
            // 给出的重置时刻，免得每次重连的 snapshot 继续消耗同一份额度
            Err(e) if e.limit() == Some(LimitKind::RateLimited) => {
                tracing::info!(error = %e, "取 snapshot 被限流");
                let wait = e
                    .retry_after_secs()
                    .map(std::time::Duration::from_secs)
                    .map_or(retry, |w| w.max(retry));
                return closed_in_band(wait, "rate-limited");
            }
            Err(e) => {
                tracing::warn!(error = %e, "取 snapshot 失败");
                return closed_in_band(retry, "upstream-unavailable");
            }
        }
    };

    // 订阅以这把钥匙的 NIP-42 会话进行：它被撤销（key revoke/rotate）后流必须关闭。
    // 会话按 (PlatformSession, Community host, pubkey) 复用：同一会话的多条流共用
    // 一条已认证连接，各开一个 REQ（`apps/02` Stage 1）。
    let signer = keys.public_key().to_hex();
    let session = SessionKey {
        session: ctx.session_id.to_string(),
        community_host: scope.community_host().to_owned(),
        pubkey: signer.clone(),
    };
    let sub = match state
        .relay_sessions
        .subscribe(
            session,
            &keys,
            vec![serde_json::json!({ "kinds": message_kinds, "#h": [scope.channel_id()] })],
            &limits,
        )
        .await
    {
        Ok(s) => s,
        // 该会话的订阅数已到 NIP-11 声明的上界：确定的 LIMIT，不把第 N+1 个 REQ 发给 Relay
        Err(e) if e.limit() == Some(LimitKind::Capacity) => {
            tracing::info!(error = %e, "订阅数达到上界");
            return closed_in_band(retry, "subscription-limit");
        }
        Err(e) => {
            tracing::warn!(error = %e, "建立订阅失败");
            return closed_in_band(retry, "upstream-unavailable");
        }
    };

    let every = std::time::Duration::from_secs(state.stream_readmit_seconds);
    let readmit = Readmission {
        state,
        ctx,
        target,
        scope,
        signer,
        every,
    };
    // Snapshot and subscription establishment await external I/O. Recheck before
    // exposing either, not only at the next periodic tick after delivery.
    match readmit.check().await {
        Ok(None) => {}
        Ok(Some(reason)) => return closed_in_band(retry, reason),
        Err(_) => return closed_in_band(retry, "readmission-unavailable"),
    }
    Sse::new(frames(generation, retry, snapshot, sub, readmit))
        .keep_alive(KeepAlive::default())
        .into_response()
}

/// 准入已过而上游（Relay）暂不可用、被限流或上界不成立时的回应。
///
/// 不能回 503：SSE 规范规定重连得到非 200 回应时浏览器「使连接失败」，永久停止
/// 重连——一次 Relay 的短暂不可用就会让页面停在「刷新页面重连」。非 200 只留给
/// 确定的拒绝（身份、撤权）。其余在带内表达：一个 `closed` 帧说明原因并带上
/// 重连间隔，然后正常结束，浏览器按间隔自动重连。原因取值：
/// `upstream-unavailable`（结果不明）、`rate-limited` 与 `subscription-limit`
/// （`apps/06` §4 的 LIMIT）、`binding-not-active`（NIP-11 与 binding 快照不一致）。
fn closed_in_band(retry: std::time::Duration, reason: &'static str) -> Response {
    let frames = async_stream::stream! {
        yield Ok::<_, Infallible>(retry_frame(retry));
        yield Ok(Event::default().event("closed").retry(retry).data(reason));
    };
    Sse::new(frames).into_response()
}

/// 长连接的周期性再准入。
///
/// 请求/响应路径每次都重新解析身份，撤权因此对下一个请求立刻生效；而一条已经
/// 建立的流不会再经过那条路径。`.design/03` §4.1 要求撤销对 stream 同样生效，
/// 所以流必须自己回头看。
///
/// 间隔是**撤权对已建立流生效的上界**，因此是部署登记值而不是常量——它和
/// roster 对账间隔一样，是一个必须被说出来的时间窗，不是实现细节。
struct Readmission {
    state: BffState,
    ctx: ExecutionContext,
    target: StreamTarget,
    scope: StreamScope,
    /// 订阅所用 NIP-42 会话的 pubkey。它不再是 ACTIVE 即关流：key revoke 的
    /// 「关已知连接」一步（`.design/09`），与会话撤销是两件事。
    signer: String,
    every: std::time::Duration,
}

impl Readmission {
    /// `Ok(Some(reason))` 是该关流的原因；`Ok(None)` 是仍然准入。
    async fn check(&self) -> Result<Option<&'static str>, sqlx::Error> {
        // `session-revoked` 的含义是「此会话确定不可继续，客户端必须停止重连」：会话被撤销
        // 与所属 Tenant 非 ACTIVE（DD-96(3)，is_live 一并判定）都属此类，再连只会被拒。
        // 具体原因由之后请求的 reason code（TENANT_NOT_ACTIVE 等）表达，关流帧不再细分
        if !identity::session::is_live(&self.state.pool, self.ctx.session_id).await? {
            return Ok(Some("session-revoked"));
        }
        let current = match self.target.admit(&self.state, &self.ctx).await {
            Ok(scope) => scope,
            // TenantBuzzBinding 转 RECONCILING（DD-114(2)）：已建立的流在再准入时关闭，
            // 原因如实说明——这不是撤权，客户端按间隔重连，binding 回到 ACTIVE 即恢复
            Err(AdmissionFailure::BindingNotActive) => return Ok(Some("binding-not-active")),
            Err(AdmissionFailure::Unavailable) => {
                return Ok(Some("readmission-unavailable"));
            }
            Err(AdmissionFailure::Denied) => return Ok(Some("scope-revoked")),
        };
        if !self.scope.same_admission(&current) {
            return Ok(Some("scope-changed"));
        }
        let signer_active = sqlx::query_scalar!(
            r#"select exists (select 1 from identity.buzz_identity_binding
                              where pubkey = $1 and tenant_id = $2 and principal_id = $3
                                and custody = 'SERVER' and kind = 'HUMAN'
                                and state = 'ACTIVE') as "ok!""#,
            self.signer,
            self.ctx.tenant_id,
            self.ctx.tenant_principal_id,
        )
        .fetch_one(&self.state.pool)
        .await?;
        Ok((!signer_active).then_some("identity-revoked"))
    }
}

/// 把 snapshot 与订阅帧拼成一条 SSE 流。
/// 重连间隔另以一帧明文下发。`retry:` 字段只被 EventSource 内部消费，页面读不到；
/// 而 EventSource 在重连请求得到 HTTP 错误（BFF 重启期间网关回 503）时会永久关闭、
/// 不再自动重连，此后只能由页面按这个间隔重新打开。间隔始终来自服务端配置。
fn retry_frame(retry: std::time::Duration) -> Event {
    Event::default()
        .event("retry")
        .data(retry.as_millis().to_string())
}

fn frames(
    generation: String,
    retry: std::time::Duration,
    snapshot: Option<serde_json::Value>,
    mut sub: collab_bridge::stream::Subscription,
    readmit: Readmission,
) -> impl Stream<Item = Result<Event, Infallible>> {
    async_stream::stream! {
        // generation 先发，并作为 SSE id：浏览器记下它，断线重连时自动放进
        // Last-Event-ID 带回来。后续事件不再带 id，浏览器保留的就一直是它。
        yield Ok(Event::default()
            .event("generation")
            .id(generation.clone())
            .retry(retry)
            .data(&generation));
        yield Ok(retry_frame(retry));
        if let Some(s) = snapshot {
            yield Ok(Event::default().event("snapshot").data(s.to_string()));
        }

        let mut tick = tokio::time::interval(readmit.every);
        // 第一次 tick 立即返回，跳过它：刚刚才过完准入
        tick.tick().await;

        loop {
            let frame = tokio::select! {
                f = sub.next() => match f {
                    Some(f) => f,
                    None => break,
                },
                _ = tick.tick() => {
                    match readmit.check().await {
                        Ok(None) => continue,
                        // 会话、scope、binding 不再匹配时关流；准入查询不可用则
                        // 报结果不明，客户端按既有 retry 规则重开，不沿用旧订阅。
                        Ok(Some(reason)) => {
                            yield Ok(Event::default().event("closed").data(reason));
                            break;
                        }
                        // 查不动数据库是结果不明，不是"已撤销"。关流但给不同的
                        // 原因：客户端应当重连，而不是当成被登出。
                        Err(e) => {
                            tracing::warn!(error = %e, "再准入查询失败");
                            yield Ok(Event::default().event("closed").data("readmission-unavailable"));
                            break;
                        }
                    }
                }
            };
            match frame {
                Frame::Event(ev) => {
                    yield Ok(Event::default().event("event").data(ev.to_string()));
                }
                // 历史与增量的分界。客户端据此知道"追平了"，在此之前不必
                // 把每条事件都当成新消息去提示。
                //
                // data 不能为空：SSE 规范规定 data 缓冲为空的事件**不派发**，浏览器
                // 会静默丢掉它，客户端于是永远停在「连接中」。带上 generation——
                // 它本身也说明了「在哪一代上追平的」。
                Frame::EndOfStored => {
                    yield Ok(Event::default().event("live").data(&generation));
                }
                // 关闭原因要发出去：客户端看到通道结束时必须能区分
                // 「没有更多事件」与「连接断了」——前者不该重连，后者必须重连。
                Frame::Closed(reason) => {
                    yield Ok(Event::default().event("closed").data(reason));
                    break;
                }
            }
        }
    }
}

/// generation 的构成：principal + channel + 真实准入依据及其 Core 版本。
///
/// 用摘要而不是把三者原样拼出来：generation 会出现在 URL 与客户端存储里，
/// 原样拼接等于把 principal 与 channel 的内部 ID 散出去。
fn generation_of(
    principal: &Uuid,
    channel_id: &str,
    admission_epoch: &WorkspaceAdmissionEpoch,
) -> String {
    let mut h = Sha256::new();
    h.update(principal.as_bytes());
    h.update([0u8]);
    h.update(channel_id.as_bytes());
    h.update([0u8]);
    match admission_epoch {
        WorkspaceAdmissionEpoch::Membership {
            tenant_version,
            workspace_version,
            membership_id,
            version,
        } => {
            h.update(b"membership\0");
            h.update(tenant_version.to_be_bytes());
            h.update(workspace_version.to_be_bytes());
            h.update(membership_id.as_bytes());
            h.update(version.to_be_bytes());
        }
        WorkspaceAdmissionEpoch::WorkspaceManage {
            tenant_version,
            workspace_version,
        } => {
            h.update(b"workspace-manage\0");
            h.update(tenant_version.to_be_bytes());
            h.update(workspace_version.to_be_bytes());
        }
        WorkspaceAdmissionEpoch::TenantManage {
            tenant_version,
            workspace_version,
            membership_id,
            membership_version,
        } => {
            h.update(b"tenant-manage\0");
            h.update(tenant_version.to_be_bytes());
            h.update(workspace_version.to_be_bytes());
            h.update(membership_id.as_bytes());
            h.update(membership_version.to_be_bytes());
        }
    }
    hex::encode(&h.finalize()[..16])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forum_kinds_are_native_workspace_events_not_private_conversation_events() {
        let workspace = StreamScope::Workspace(WorkspaceScope {
            channel_id: Uuid::from_u128(1).to_string(),
            community_host: "relay.example".into(),
            admission_epoch: WorkspaceAdmissionEpoch::Membership {
                tenant_version: 1,
                workspace_version: 1,
                membership_id: Uuid::from_u128(2),
                version: 1,
            },
        });
        let conversation = StreamScope::Conversation(crate::conversations::ConversationScope {
            channel_id: Uuid::from_u128(3).to_string(),
            community_host: "relay.example".into(),
            binding_version: 1,
            tenant_binding_version: 1,
        });
        assert_eq!(workspace.message_kinds(), vec![9, 45001, 45003]);
        assert_eq!(conversation.message_kinds(), vec![9]);
        assert!(workspace.can_resume());
        assert!(!conversation.can_resume());
        assert!(!workspace.same_admission(&conversation));
    }

    #[test]
    fn private_stream_fences_scope_and_always_refreshes_snapshot() {
        let principal = Uuid::from_u128(1);
        let scope = crate::conversations::ConversationScope {
            channel_id: Uuid::from_u128(2).to_string(),
            community_host: Uuid::from_u128(4).to_string(),
            binding_version: 1,
            tenant_binding_version: 1,
        };
        let original = StreamScope::Conversation(scope.clone());
        assert!(!original.can_resume());
        assert!(original.same_admission(&StreamScope::Conversation(scope.clone())));
        assert_ne!(
            original.generation(&principal),
            original.generation(&Uuid::from_u128(3))
        );
        let mut changed = scope.clone();
        changed.binding_version += 1;
        let changed = StreamScope::Conversation(changed);
        assert!(!original.same_admission(&changed));
        assert_ne!(
            original.generation(&principal),
            changed.generation(&principal)
        );
        let mut changed = scope;
        changed.tenant_binding_version += 1;
        let changed = StreamScope::Conversation(changed);
        assert!(!original.same_admission(&changed));
        assert_ne!(
            original.generation(&principal),
            changed.generation(&principal)
        );
    }
}
