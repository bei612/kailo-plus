//! DD-125(5), 09 §3, V-SCN-140: the original GIF picker (SF-BUZ-56(4)) as a deployment option.
//!
//! The Relay holds the KLIPY key and proxies `/gifs/search` and `/gifs/share` for relay
//! members (NIP-98, member gate, GIF search rate limit). It advertises the proxy in NIP-11
//! only when configured. The BFF forwards both calls as the member's own SERVER identity, and
//! only while the Tenant's ACTIVE binding snapshot matches the runtime NIP-11 that advertises
//! `gif`. The browser never talks to the Relay or KLIPY and never sees provider JSON: results
//! are normalized like the original `normalizeKlipyGifs` and limited to the image origins the
//! deployment registered, which are also the only origins the Web CSP `img-src` appends.

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use collab_bridge::operator::OperatorError;
use contracts::{ErrorClass, GifElement, ReasonCode};
use reqwest::Url;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    bff::{resolve_execution_context, BffState, ExecutionContext},
    web_transport::{actor_keys, community_client, error_body, relay_error_response},
};

/// Original Relay request bounds (`api/gifs.rs::validate_text`).
const MAX_QUERY_CHARS: usize = 200;
const MAX_LOCALE_CHARS: usize = 32;
const MAX_SLUG_CHARS: usize = 200;
/// Original asset preference orders (`api.ts::normalizeKlipyGifs`).
const ORIGINAL: [(&str, &str); 4] = [("md", "gif"), ("hd", "gif"), ("sm", "gif"), ("xs", "gif")];
const PREVIEW: [(&str, &str); 5] = [
    ("sm", "webp"),
    ("sm", "gif"),
    ("xs", "webp"),
    ("xs", "gif"),
    ("md", "webp"),
];
const POSTER: [(&str, &str); 4] = [("sm", "jpg"), ("xs", "jpg"), ("md", "jpg"), ("hd", "jpg")];

/// Deployment registration of the GIF image origins (`BFF_GIF_IMAGE_ORIGINS`). Empty means the
/// option is off: the picker never appears even if a Relay advertises `gif`.
pub struct Config {
    image_origins: Vec<String>,
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let raw = std::env::var("BFF_GIF_IMAGE_ORIGINS")
            .map_err(|_| "缺少 BFF_GIF_IMAGE_ORIGINS".to_owned())?;
        // The same value the static CSP appends: space separated (commas tolerated).
        let image_origins = raw
            .split(|c: char| c == ',' || c.is_whitespace())
            .filter(|entry| !entry.is_empty())
            .map(|entry| {
                registered_origin(entry)
                    .ok_or_else(|| format!("BFF_GIF_IMAGE_ORIGINS 含无效来源: {entry}"))
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self { image_origins })
    }
}

/// A registered origin is exactly `https://host[:port]`: no path, query or credentials, the
/// same token the static CSP appends to `img-src`.
fn registered_origin(raw: &str) -> Option<String> {
    let url = Url::parse(raw.trim()).ok()?;
    let origin = url.origin().ascii_serialization();
    let bare = url.path() == "/" && url.query().is_none() && url.fragment().is_none();
    (url.scheme() == "https" && url.username().is_empty() && url.password().is_none() && bare)
        .then_some(origin)
}

/// The origin of a provider URL when it is https and registered.
fn allowed_url(raw: &str, origins: &[String]) -> bool {
    Url::parse(raw).is_ok_and(|url| {
        url.scheme() == "https"
            && url.username().is_empty()
            && origins.contains(&url.origin().ascii_serialization())
    })
}

/// Original `isCompleteAsset`: a non-empty URL with numeric width, height and size.
fn complete(asset: &Value) -> Option<(&str, i64, i64, i64)> {
    let url = asset["url"].as_str().filter(|url| !url.is_empty())?;
    Some((
        url,
        asset["width"].as_i64()?,
        asset["height"].as_i64()?,
        asset["size"].as_i64()?,
    ))
}

/// Original `normalizeKlipyGifs` over the Relay's `data.data[]`, keeping only items whose
/// original and preview (and the poster, when kept) come from a registered origin.
pub(crate) fn normalize(page: &Value, origins: &[String]) -> Vec<GifElement> {
    let mut gifs = Vec::new();
    for item in page["data"]["data"].as_array().into_iter().flatten() {
        let file = &item["file"];
        let slug = item["slug"].as_str().filter(|slug| !slug.is_empty());
        let (Some(slug), true) = (slug, item["type"] == "gif" && file.is_object()) else {
            continue;
        };
        let first = |paths: &[(&str, &str)]| {
            paths
                .iter()
                .find_map(|(size, format)| complete(&file[*size][*format]))
        };
        let Some(original) = first(&ORIGINAL) else {
            continue;
        };
        let preview = first(&PREVIEW).unwrap_or(original);
        let poster = first(&POSTER).filter(|(url, ..)| allowed_url(url, origins));
        if !allowed_url(original.0, origins) || !allowed_url(preview.0, origins) {
            continue;
        }
        let title = item["title"].as_str().map(str::trim).unwrap_or_default();
        let title = if title.is_empty() { "GIF" } else { title };
        gifs.push(GifElement {
            slug: slug.to_owned(),
            title: title.to_owned(),
            url: original.0.to_owned(),
            width: original.1,
            height: original.2,
            size: original.3,
            preview_url: preview.0.to_owned(),
            preview_width: preview.1,
            preview_height: preview.2,
            poster_url: poster.map(|(url, ..)| url.to_owned()),
        });
    }
    gifs
}

/// The Tenant's ACTIVE Community host when its binding snapshot matches the runtime NIP-11
/// and that document advertises the original GIF proxy.
async fn advertised(state: &BffState, ctx: &ExecutionContext) -> Result<Option<String>, Response> {
    let row: Option<(String, Option<String>)> = sqlx::query_as(
        "select normalized_host, nip11_snapshot_digest from projection.tenant_buzz_binding
         where tenant_id = $1 and state = 'ACTIVE'",
    )
    .bind(ctx.tenant_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| StatusCode::SERVICE_UNAVAILABLE.into_response())?;
    let Some((host, Some(snapshot))) = row else {
        return Ok(None);
    };
    let Ok(doc) = state.relay_nip11.get(&state.http, &host).await else {
        return Ok(None);
    };
    Ok((doc.digest == snapshot && doc.gif).then_some(host))
}

/// `GET /api/v1/gifs`: whether the original picker appears, and the registered origins the
/// Web renderer may load GIF images from.
pub async fn capability(State(state): State<BffState>, headers: HeaderMap) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    let origins = state.gifs.image_origins.clone();
    let available = match advertised(&state, &ctx).await {
        Ok(host) => host.is_some() && !origins.is_empty(),
        Err(response) => return response,
    };
    Json(contracts::WebGifCapabilityView {
        available,
        image_origins: origins,
    })
    .into_response()
}

fn unavailable_option() -> Response {
    error_body(
        StatusCode::FORBIDDEN,
        ErrorClass::Blocked,
        ReasonCode::CapabilityBlocked,
        None,
    )
}

fn invalid() -> Response {
    error_body(
        StatusCode::UNPROCESSABLE_ENTITY,
        ErrorClass::Precondition,
        ReasonCode::InvalidParameters,
        None,
    )
}

/// The Relay member gate refuses non-members (`relay_membership_required`); limits keep their
/// LIMIT class; anything else is an unavailable dependency.
fn relay_refusal(error: &OperatorError) -> Response {
    match error {
        OperatorError::Rejected { status: 403, .. } => error_body(
            StatusCode::FORBIDDEN,
            ErrorClass::Denied,
            ReasonCode::PermissionDenied,
            None,
        ),
        _ => relay_error_response(error, None),
    }
}

/// Original KLIPY `customer_id`: a stable anonymous identifier. It is derived per Tenant and
/// Principal so the provider can neither see platform IDs nor correlate across Tenants.
fn customer_id(ctx: &ExecutionContext) -> String {
    Uuid::new_v5(&ctx.tenant_id, ctx.tenant_principal_id.as_bytes()).to_string()
}

/// Shared prelude of both forwards: identity, option, admitted member client.
async fn forward_client(
    state: &BffState,
    headers: &HeaderMap,
) -> Result<(ExecutionContext, collab_bridge::bridge::IdentityClient), Response> {
    let ctx = resolve_execution_context(state, headers).await?;
    if state.gifs.image_origins.is_empty() {
        return Err(unavailable_option());
    }
    let Some(host) = advertised(state, &ctx).await? else {
        return Err(unavailable_option());
    };
    let keys = actor_keys(state, &ctx).await?;
    let client = community_client(state, &keys, &host)?;
    Ok((ctx, client))
}

/// `POST /api/v1/gifs/search`
pub async fn search(
    State(state): State<BffState>,
    headers: HeaderMap,
    body: Result<Json<contracts::WebGifSearchRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let Ok(Json(request)) = body else {
        return invalid();
    };
    let query = request.query.chars().count();
    let locale = request.locale.chars().count();
    if query > MAX_QUERY_CHARS || !(1..=MAX_LOCALE_CHARS).contains(&locale) {
        return invalid();
    }
    let (ctx, client) = match forward_client(&state, &headers).await {
        Ok(found) => found,
        Err(response) => return response,
    };
    let body = json!({
        "query": request.query.trim(),
        "customer_id": customer_id(&ctx),
        "locale": request.locale,
    });
    let page = match client.gif_search(&state.http, &body).await {
        Ok(page) => page,
        Err(error) => return relay_refusal(&error),
    };
    if page["result"] != true {
        return StatusCode::BAD_GATEWAY.into_response();
    }
    Json(contracts::WebGifSearchView {
        gifs: normalize(&page, &state.gifs.image_origins),
    })
    .into_response()
}

/// `POST /api/v1/gifs/share`: the original best-effort share report at selection time.
pub async fn share(
    State(state): State<BffState>,
    headers: HeaderMap,
    body: Result<Json<contracts::WebGifShareRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let Ok(Json(request)) = body else {
        return invalid();
    };
    let slug = request.slug.trim();
    if slug.is_empty() || slug.chars().count() > MAX_SLUG_CHARS {
        return invalid();
    }
    let (ctx, client) = match forward_client(&state, &headers).await {
        Ok(found) => found,
        Err(response) => return response,
    };
    let body = json!({"slug": slug, "customer_id": customer_id(&ctx)});
    match client.gif_share(&state.http, &body).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => relay_refusal(&error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asset(url: &str) -> Value {
        json!({"url": url, "width": 220, "height": 124, "size": 2048})
    }

    #[test]
    fn origins_are_registered_exactly() {
        assert_eq!(
            registered_origin("https://static.klipy.com"),
            Some("https://static.klipy.com".to_owned())
        );
        assert_eq!(
            registered_origin("https://cdn.example:8443/"),
            Some("https://cdn.example:8443".to_owned())
        );
        for refused in [
            "http://static.klipy.com",
            "https://a.example/path",
            "*",
            "https://",
        ] {
            assert!(registered_origin(refused).is_none(), "{refused}");
        }
    }

    #[test]
    fn normalize_follows_the_original_order_and_registered_origins() {
        let origins = vec!["https://static.klipy.com".to_owned()];
        let at = |name: &str| asset(&format!("https://static.klipy.com/ii/{name}"));
        let ad = json!({"type": "ad", "slug": "ad", "file": {"md": {"gif": at("ad.gif")}}});
        let ship = json!({"type": "gif", "slug": "ship-it", "title": "  Ship it ", "file": {
            "hd": {"gif": at("hd.gif"), "jpg": at("hd.jpg")},
            "md": {"gif": at("md.gif")},
            "sm": {"webp": at("sm.webp")}
        }});
        let foreign = asset("https://tracker.example/x.gif");
        let elsewhere = json!({"type": "gif", "slug": "elsewhere",
            "file": {"md": {"gif": foreign}}});
        let untitled = json!({"type": "gif", "slug": "untitled", "title": " ", "file": {
            "xs": {"gif": at("xs.gif")},
            "sm": {"jpg": asset("https://tracker.example/p.jpg")}
        }});
        let page = json!({"result": true, "data": {"data": [ad, ship, elsewhere, untitled]}});
        let gifs = normalize(&page, &origins);
        assert_eq!(gifs.len(), 2);
        assert_eq!(gifs[0].slug, "ship-it");
        assert_eq!(gifs[0].title, "Ship it");
        assert!(gifs[0].url.ends_with("/md.gif"));
        assert!(gifs[0].preview_url.ends_with("/sm.webp"));
        assert!(gifs[0]
            .poster_url
            .as_deref()
            .is_some_and(|p| p.ends_with("/hd.jpg")));
        assert_eq!(gifs[1].title, "GIF");
        assert!(gifs[1].preview_url.ends_with("/xs.gif"));
        assert!(gifs[1].poster_url.is_none());
    }

    #[test]
    fn customer_ids_are_stable_and_scoped() {
        let ctx = |tenant: Uuid, principal: Uuid| ExecutionContext {
            human_identity_id: Uuid::nil(),
            tenant_id: tenant,
            tenant_principal_id: principal,
            session_id: Uuid::nil(),
            access_mode: contracts::PlatformSessionAccessMode::Full,
        };
        let (tenant, principal) = (Uuid::new_v4(), Uuid::new_v4());
        let id = customer_id(&ctx(tenant, principal));
        assert_eq!(id, customer_id(&ctx(tenant, principal)));
        assert_ne!(id, customer_id(&ctx(Uuid::new_v4(), principal)));
        assert!(!id.contains(&principal.to_string()));
    }
}
