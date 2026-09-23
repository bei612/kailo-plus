//! BFF stream（`apps/02` Stage 1「完整 snapshot + generation 的 BFF stream 恢复」）。
//!
//! Browser 不直连 Relay、不持 signer（`DD-39`）。它从这里拿两样东西：一份
//! snapshot 与一个 generation，随后是增量事件。断线重连时带上 generation——
//! **对不上就重新取 snapshot**，而不是从某个猜测的位置接着读。
//!
//! generation 绑定的是「这条流建立时的那次准入与那个 Channel」。准入变了
//! （撤权、Workspace 停用、Channel 重绑）就必然换一个 generation，因此客户端
//! 不可能拿着旧 generation 悄悄续上一条本不该继续的流。
//!
//! 续流走 SSE 自带的协议，不另造：generation 作为事件 `id:` 下发，浏览器的
//! EventSource 断线后自动重连并把它放进 `Last-Event-ID` 头带回来；重连间隔
//! 由这里经 `retry:` 下发。客户端因此没有自己的重连循环，也没有写死的时长。
//!
//! 流只转发当前 active scope 的事件（`.design/09`）：filter 由 Core 构造并锁定
//! 在该 Workspace 的 Channel 上，调用方没有提交 filter 的入口。

use std::convert::Infallible;

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
};
use futures_util::stream::Stream;
use kailo_buzz::stream::{subscribe, Frame};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::bff::{resolve_execution_context, BffState};
use crate::web_transport::{actor_keys, admit_workspace};

/// 打开一条 Workspace 事件流。
pub async fn open_stream(
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

    // generation 由「谁 + 哪个 Channel + 哪次准入」共同决定。把 principal 放进去
    // 是必要的：同一个 Channel 上不同人看到的 scope 一样，但撤权只影响其中一个，
    // 而撤权必须让那个人的旧 generation 失效。
    let generation = generation_of(&ctx.tenant_principal_id, &scope.channel_id, scope.version);
    // 上次拿到的 generation 由 EventSource 放在 Last-Event-ID 里带回。
    // 缺失或对不上都意味着要重新取 snapshot。
    let resume =
        headers.get("last-event-id").and_then(|v| v.to_str().ok()) == Some(generation.as_str());

    // snapshot 走 HTTP bridge，增量走 WS 订阅。两者用同一把钥匙、同一个
    // Community host，因此看到的 scope 是同一个。
    let client = match crate::web_transport::identity_client(&state, &keys, &scope) {
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
                    "kinds": [9],
                    "#h": [scope.channel_id],
                    "limit": state.message_page_limit,
                })],
            )
            .await
        {
            Ok(v) => Some(v),
            Err(e) => {
                tracing::warn!(error = %e, "取 snapshot 失败");
                return StatusCode::SERVICE_UNAVAILABLE.into_response();
            }
        }
    };

    let ws_url = state.relay_ws_url.clone();
    let sub = match subscribe(
        keys,
        &ws_url,
        &scope.community_host,
        vec![serde_json::json!({ "kinds": [9], "#h": [scope.channel_id] })],
        state.stream_buffer,
    )
    .await
    {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!(error = %e, "建立订阅失败");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    };

    Sse::new(frames(
        generation,
        std::time::Duration::from_millis(state.stream_retry_millis),
        snapshot,
        sub,
        Readmission {
            pool: state.pool.clone(),
            session_id: ctx.session_id,
            every: std::time::Duration::from_secs(state.stream_readmit_seconds),
        },
    ))
    .keep_alive(KeepAlive::default())
    .into_response()
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
    pool: sqlx::PgPool,
    session_id: Uuid,
    every: std::time::Duration,
}

/// 把 snapshot 与订阅帧拼成一条 SSE 流。
fn frames(
    generation: String,
    retry: std::time::Duration,
    snapshot: Option<serde_json::Value>,
    mut sub: kailo_buzz::stream::Subscription,
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
                    match kailo_identity::session::is_live(&readmit.pool, readmit.session_id).await {
                        Ok(true) => continue,
                        // 会话没了：注销或撤权。关流并说明原因——客户端据此
                        // 知道不该重连。
                        Ok(false) => {
                            yield Ok(Event::default().event("closed").data("session-revoked"));
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

/// generation 的构成：principal + channel + 准入版本。
///
/// 用摘要而不是把三者原样拼出来：generation 会出现在 URL 与客户端存储里，
/// 原样拼接等于把 principal 与 channel 的内部 ID 散出去。
fn generation_of(principal: &Uuid, channel_id: &str, admission_version: i32) -> String {
    let mut h = Sha256::new();
    h.update(principal.as_bytes());
    h.update([0u8]);
    h.update(channel_id.as_bytes());
    h.update([0u8]);
    h.update(admission_version.to_be_bytes());
    hex::encode(&h.finalize()[..16])
}
