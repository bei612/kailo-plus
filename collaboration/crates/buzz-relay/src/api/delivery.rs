//! DD-81/160: bounded proof for the caller's original signed merged status.
//! This is an observation of the existing event writer, never a receipt ledger.
use std::sync::Arc;
use axum::{body::Bytes, extract::State, http::{HeaderMap, StatusCode}, response::{IntoResponse,Response}, Json};
use nostr::Event;
use crate::{state::AppState, tenant};
use super::{bridge,git::transport::{authorize_git_read,deny_banned_git_principal}};

fn refused()->Response { (StatusCode::NOT_FOUND,Json(serde_json::json!({"error":"publication unavailable"}))).into_response() }
async fn readmit(state:&AppState,scope:&buzz_core::TenantContext,headers:&HeaderMap,auth:&bridge::VerifiedBridgeAuth,repo:&str)->Result<(),Response> {
    if !state.db.is_community_active(scope.community()).await.map_err(|_|refused())? { return Err(refused()); }
    let tag=super::relay_members::extract_auth_tag_header(headers);
    super::relay_members::enforce_relay_membership(state,scope.community(),auth.pubkey.as_bytes(),tag,auth.signed_created_at).await.map_err(|_|refused())?;
    deny_banned_git_principal(&state.db,scope.community(),&auth.pubkey,tag,auth.signed_created_at).await.map_err(|_|refused())?;
    authorize_git_read(&state.db,scope.community(),&auth.pubkey,&auth.pubkey.to_hex(),repo).await.map_err(|_|refused())?;
    Ok(())
}

/// POST /events/delivery. The signed proof is bounded, author-only and tied to
/// this request's Host, method and body by the original NIP-98/replay gates.
pub async fn delivery(State(state):State<Arc<AppState>>,headers:HeaderMap,body:Bytes)->Result<Response,Response> {
    if body.len()>16*1024 { return Err(StatusCode::PAYLOAD_TOO_LARGE.into_response()); }
    let host=headers.get(axum::http::header::HOST).and_then(|v|v.to_str().ok()).unwrap_or("");
    let scope=tenant::bind_community(&state.db,host).await.map_err(|_|refused())?;
    let url=bridge::nip98_expected_url(&state.config.relay_url,&scope,"/events/delivery");
    let auth=bridge::verify_bridge_auth_with_options(&headers,"POST",&url,Some(&body),true,true).map_err(IntoResponse::into_response)?;
    bridge::enforce_http_admission(&state,&scope,&auth.pubkey).await.map_err(IntoResponse::into_response)?;
    bridge::check_nip98_replay(&state,&scope,auth.event_id_bytes).await.map_err(IntoResponse::into_response)?;
    let value:serde_json::Value=serde_json::from_slice(&body).map_err(|_|StatusCode::BAD_REQUEST.into_response())?;
    let object=value.as_object().ok_or_else(||StatusCode::BAD_REQUEST.into_response())?;
    if object.len()!=7 || object.keys().any(|key|!matches!(key.as_str(),"id"|"pubkey"|"created_at"|"kind"|"tags"|"content"|"sig")) {
        return Err(StatusCode::BAD_REQUEST.into_response());
    }
    let event:Event=serde_json::from_value(value).map_err(|_|StatusCode::BAD_REQUEST.into_response())?;
    let repo=buzz_core::publication::merged_status_repository(&event,&auth.pubkey).map_err(|_|refused())?;
    readmit(&state,&scope,&headers,&auth,repo).await?;
    let proof=state.db.merged_status_delivery(scope.community(),&event).await.map_err(|_|StatusCode::SERVICE_UNAVAILABLE.into_response())?;
    // Deletion/quiescing, a changed host binding, or a revoked member may have
    // overtaken the writer read. Such a refusal is never an empty observation.
    let after=tenant::bind_community(&state.db,host).await.map_err(|_|refused())?;
    if after.community()!=scope.community() { return Err(refused()); }
    readmit(&state,&scope,&headers,&auth,repo).await?;
    Ok(([("cache-control","no-store")],Json(proof)).into_response())
}

#[cfg(test)]
#[path="delivery_tests.rs"]
mod tests;
