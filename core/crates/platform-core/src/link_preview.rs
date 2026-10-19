//! DD-125(5), 09 §3, V-SCN-139: original composer link previews with the BFF as fetch host.
//!
//! The original Desktop fetched preview metadata in Tauri (`commands/link_preview.rs`): https
//! only on the default port, at most 3 redirects, a 256 KB HTML prefix, a simple meta-tag
//! scanner, image/favicon fetches bounded at 2 MiB, then uploaded the images as Relay media
//! and published an 11-element `link-preview snapshot` tag with kind 9. Recipients render
//! only the snapshot and never touch the external site.
//!
//! Web has no local fetch host, so the BFF performs the same fetch with server egress rules
//! on top: every hop is resolved first and refused when any address is loopback, private,
//! link-local (cloud metadata included), CGNAT, multicast, ULA, documentation, reserved or a
//! deployment-registered internal range; the request is then pinned to exactly the checked
//! addresses (no second resolution, no proxy, no cookies or credentials). Each Principal has
//! a request budget; excess is a LIMIT refusal. Audit keeps only the host and a URL digest.
//!
//! The snapshot is held short-term in Core and bound to the requesting Principal and
//! Community host. A publication may only reference its own unexpired snapshot IDs; the
//! browser never submits raw `link-preview` tags.

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use collab_bridge::limits::ApiBudget;
use contracts::{ErrorClass, ReasonCode};
use reqwest::Url;
use sha2::{Digest, Sha256};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::time::Duration;
use uuid::Uuid;

use crate::{
    audit::AuditEntry,
    bff::{resolve_execution_context, BffState, ExecutionContext},
    web_transport::{actor_keys, community_client, community_limits, error_body},
};

/// Original `MAX_SNAPSHOTS`: at most 8 snapshot tags per message.
pub(crate) const MAX_SNAPSHOTS: usize = 8;
/// Original `MAX_PREVIEW_FETCH_BYTES`: the HTML prefix that is read (truncated, not refused).
const MAX_PAGE_BYTES: usize = 256 * 1024;
/// Original `MAX_IMAGE_FETCH_BYTES`.
const MAX_IMAGE_BYTES: usize = 2 * 1024 * 1024;
/// Original YouTube `MAX_OEMBED_FETCH_BYTES`.
const MAX_OEMBED_BYTES: usize = 64 * 1024;
/// Original `MAX_REDIRECTS`.
const MAX_REDIRECTS: usize = 3;
/// Original transport bounds: connect 15 s, idle 30 s, DNS 15 s.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const DNS_TIMEOUT: Duration = Duration::from_secs(15);
/// Overall bound of one page or image fetch with its redirects, so a request always answers.
const FETCH_DEADLINE: Duration = Duration::from_secs(45);
/// Original metadata normalization bounds (characters).
const MAX_METADATA_CHARS: usize = 180;
const MAX_DESCRIPTION_CHARS: usize = 280;
/// Original snapshot tag text bounds (bytes): title, site name, description.
const MAX_TITLE_BYTES: usize = 300;
const MAX_SITE_BYTES: usize = 100;
const MAX_DESCRIPTION_BYTES: usize = 1000;
/// A URL longer than this is not a link a composer extracts.
const MAX_URL_BYTES: usize = 2048;
const USER_AGENT: &str = "Buzz link preview";
const OEMBED_ENDPOINT: &str = "https://www.youtube.com/oembed";
/// Audit action keys of the two fetch hosts (not Governed Actions: no write, no authority).
const WORKSPACE_ACTION: &str = "workspace.link_preview.fetch";
const CONVERSATION_ACTION: &str = "conversation.link_preview.fetch";

/// One IP network, either built in or registered by the deployment.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Network {
    addr: IpAddr,
    prefix: u8,
}

impl Network {
    pub(crate) fn parse(raw: &str) -> Option<Self> {
        let (addr, prefix) = raw.trim().split_once('/')?;
        let addr: IpAddr = addr.parse().ok()?;
        let prefix: u8 = prefix.parse().ok()?;
        let max = if addr.is_ipv4() { 32 } else { 128 };
        (prefix <= max).then_some(Self { addr, prefix })
    }

    fn contains(&self, ip: IpAddr) -> bool {
        match (self.addr, ip) {
            (IpAddr::V4(net), IpAddr::V4(ip)) => {
                let shift = 32 - u32::from(self.prefix);
                let mask = u32::MAX.checked_shl(shift).unwrap_or(0);
                u32::from(net) & mask == u32::from(ip) & mask
            }
            (IpAddr::V6(net), IpAddr::V6(ip)) => {
                let shift = 128 - u32::from(self.prefix);
                let mask = u128::MAX.checked_shl(shift).unwrap_or(0);
                u128::from(net) & mask == u128::from(ip) & mask
            }
            _ => false,
        }
    }
}

/// Deployment configuration of the fetch host (`07` §5: bounds are registered values).
pub struct Config {
    /// Deployment-registered internal networks refused in addition to the built-in ones.
    deny: Vec<Network>,
    /// Per-Principal request budget (09 §3: excess is a LIMIT refusal).
    budget: ApiBudget,
    /// How long a snapshot may be referenced by a publication.
    ttl: Duration,
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let get = |k: &str| std::env::var(k).map_err(|_| format!("缺少 {k}"));
        let positive = |k: &str| -> Result<u64, String> {
            get(k)?
                .parse::<u64>()
                .ok()
                .filter(|n| *n > 0)
                .ok_or_else(|| format!("{k} 必须是正整数"))
        };
        let deny = get("BFF_LINK_PREVIEW_DENY_CIDRS")?
            .split(',')
            .filter(|entry| !entry.trim().is_empty())
            .map(|entry| {
                Network::parse(entry)
                    .ok_or_else(|| format!("BFF_LINK_PREVIEW_DENY_CIDRS 含无效网段: {entry}"))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let calls = usize::try_from(positive("BFF_LINK_PREVIEW_BUDGET")?)
            .map_err(|_| "BFF_LINK_PREVIEW_BUDGET 超出范围".to_owned())?;
        let window = Duration::from_secs(positive("BFF_LINK_PREVIEW_BUDGET_WINDOW_SECONDS")?);
        let budget = ApiBudget::new(calls, window).map_err(|e| e.to_string())?;
        let ttl = Duration::from_secs(positive("BFF_LINK_PREVIEW_SNAPSHOT_TTL_SECONDS")?);
        Ok(Self { deny, budget, ttl })
    }
}

/// Built-in egress refusals: everything that is not a globally routed unicast address.
fn reserved(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => reserved_v4(ip),
        IpAddr::V6(ip) => reserved_v6(ip),
    }
}

fn reserved_v4(ip: Ipv4Addr) -> bool {
    // "This network", private, CGNAT, loopback, link-local (cloud metadata), private, IETF
    // assignments, documentation, 6to4 relay anycast, private, benchmarking, documentation
    // (two), multicast, reserved and broadcast.
    const NETWORKS: [(u32, u8); 16] = [
        (0x0000_0000, 8),
        (0x0A00_0000, 8),
        (0x6440_0000, 10),
        (0x7F00_0000, 8),
        (0xA9FE_0000, 16),
        (0xAC10_0000, 12),
        (0xC000_0000, 24),
        (0xC000_0200, 24),
        (0xC058_6300, 24),
        (0xC0A8_0000, 16),
        (0xC612_0000, 15),
        (0xC633_6400, 24),
        (0xCB00_7100, 24),
        (0xE000_0000, 4),
        (0xF000_0000, 4),
        (0xFFFF_FFFF, 32),
    ];
    let value = u32::from(ip);
    NETWORKS.iter().any(|(net, prefix)| {
        let mask = u32::MAX << (32 - u32::from(*prefix));
        value & mask == net & mask
    })
}

fn reserved_v6(ip: Ipv6Addr) -> bool {
    if let Some(v4) = ip.to_ipv4_mapped() {
        return reserved_v4(v4);
    }
    let value = u128::from(ip);
    // NAT64 (64:ff9b::/96) carries an IPv4 address that is checked as such.
    if value >> 32 == 0x0064_ff9b_0000_0000_0000_0000 {
        return reserved_v4(Ipv4Addr::from((value & 0xFFFF_FFFF) as u32));
    }
    // IPv4-compatible (with unspecified and loopback), discard, Teredo, documentation,
    // 6to4, ULA, link-local, site-local and multicast.
    const NETWORKS: [(u128, u8); 9] = [
        (0, 96),
        (0x0100_0000_0000_0000_0000_0000_0000_0000, 64),
        (0x2001_0000_0000_0000_0000_0000_0000_0000, 32),
        (0x2001_0db8_0000_0000_0000_0000_0000_0000, 32),
        (0x2002_0000_0000_0000_0000_0000_0000_0000, 16),
        (0xfc00_0000_0000_0000_0000_0000_0000_0000, 7),
        (0xfe80_0000_0000_0000_0000_0000_0000_0000, 10),
        (0xfec0_0000_0000_0000_0000_0000_0000_0000, 10),
        (0xff00_0000_0000_0000_0000_0000_0000_0000, 8),
    ];
    NETWORKS.iter().any(|(net, prefix)| {
        let mask = u128::MAX << (128 - u32::from(*prefix));
        value & mask == net & mask
    })
}

/// A resolved address may be connected to only if neither built-in nor registered ranges
/// contain it.
pub(crate) fn allowed(ip: IpAddr, deny: &[Network]) -> bool {
    !reserved(ip) && !deny.iter().any(|network| network.contains(ip))
}

#[derive(Debug, PartialEq, Eq)]
enum Refused {
    /// Not an https URL on the default port without credentials.
    Url,
    /// A hop resolved to a refused address (or did not resolve).
    Address,
    /// The site gave no usable preview (status, type, size, redirects, metadata).
    NoPreview,
}

/// Original `validate_metadata_url`: https, no credentials, the default port, a host.
fn checked_url(url: &Url) -> Result<(), Refused> {
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some_and(|port| port != 443)
        || url.host_str().is_none()
        || url.as_str().len() > MAX_URL_BYTES
    {
        return Err(Refused::Url);
    }
    Ok(())
}

/// Resolve once, refuse the hop if any address is refused, and return the checked set the
/// connection is pinned to.
async fn resolve(url: &Url, deny: &[Network]) -> Result<Vec<SocketAddr>, Refused> {
    let addrs: Vec<SocketAddr> = match literal(url) {
        Some(ip) => vec![SocketAddr::new(ip, 443)],
        None => {
            let host = url.host_str().ok_or(Refused::Url)?;
            let lookup = tokio::net::lookup_host((host, 443));
            match tokio::time::timeout(DNS_TIMEOUT, lookup).await {
                Ok(Ok(found)) => found.collect(),
                _ => return Err(Refused::Address),
            }
        }
    };
    if addrs.is_empty() || addrs.iter().any(|addr| !allowed(addr.ip(), deny)) {
        return Err(Refused::Address);
    }
    Ok(addrs)
}

/// The URL host when it is an IP literal (the URL parser has already normalized it).
fn literal(url: &Url) -> Option<IpAddr> {
    let host = url.host_str()?;
    let bare = host
        .strip_prefix('[')
        .and_then(|rest| rest.strip_suffix(']'))
        .unwrap_or(host);
    bare.parse().ok()
}

/// One request pinned to the checked addresses: no proxy, no redirects, no pooling, no
/// cookies; the deployment's own DNS is never consulted again for this host.
async fn send(url: &Url, accept: &str, deny: &[Network]) -> Result<reqwest::Response, Refused> {
    checked_url(url)?;
    let addrs = resolve(url, deny).await?;
    let mut builder = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .pool_max_idle_per_host(0)
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .user_agent(USER_AGENT);
    if let (None, Some(host)) = (literal(url), url.host_str()) {
        builder = builder.resolve_to_addrs(host, &addrs);
    }
    let client = builder.build().map_err(|_| Refused::NoPreview)?;
    client
        .get(url.clone())
        .header(reqwest::header::ACCEPT, accept)
        .send()
        .await
        .map_err(|_| Refused::NoPreview)
}

/// Follow at most three redirects, re-checking every hop before connecting to it.
async fn follow(
    url: &Url,
    accept: &str,
    deny: &[Network],
) -> Result<(Url, reqwest::Response), Refused> {
    let mut url = url.clone();
    for hop in 0..=MAX_REDIRECTS {
        let response = send(&url, accept, deny).await?;
        if !response.status().is_redirection() {
            return Ok((url, response));
        }
        if hop == MAX_REDIRECTS {
            break;
        }
        let location = response
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|value| value.to_str().ok())
            .ok_or(Refused::NoPreview)?;
        url = url.join(location).map_err(|_| Refused::NoPreview)?;
    }
    Err(Refused::NoPreview)
}

fn media_type(response: &reqwest::Response) -> String {
    response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
}

/// Read at most `limit` bytes. `truncate` keeps the prefix (HTML); otherwise exceeding the
/// bound refuses the body (images, oEmbed).
async fn read(mut response: reqwest::Response, limit: usize, truncate: bool) -> Option<Vec<u8>> {
    if !truncate && response.content_length().is_some_and(|n| n > limit as u64) {
        return None;
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.ok()? {
        if body.len() + chunk.len() > limit {
            if !truncate {
                return None;
            }
            body.extend_from_slice(&chunk[..limit - body.len()]);
            break;
        }
        body.extend_from_slice(&chunk);
    }
    Some(body)
}

/// Extracted page metadata before media upload (original `LinkPreviewMetadata`).
#[derive(Debug, Default, PartialEq, Eq)]
struct Metadata {
    title: String,
    site_name: Option<String>,
    description: Option<String>,
    image: Option<Url>,
    favicon: Option<Url>,
}

/// Original `decode_html_entities`.
fn decode_entities(value: &str) -> String {
    let mut decoded = value
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">");
    let mut from = 0;
    while let Some(relative) = decoded[from..].find("&#") {
        let start = from + relative;
        let Some(length) = decoded[start..].find(';') else {
            break;
        };
        let end = start + length + 1;
        let entity = &decoded[start + 2..end - 1];
        let parsed = entity
            .strip_prefix('x')
            .or_else(|| entity.strip_prefix('X'))
            .and_then(|hex| u32::from_str_radix(hex, 16).ok())
            .or_else(|| entity.parse::<u32>().ok());
        let Some(ch) = parsed.and_then(char::from_u32) else {
            break;
        };
        decoded.replace_range(start..end, &ch.to_string());
        from = start + ch.len_utf8();
    }
    decoded
}

/// Original `attr_value`: a tolerant attribute scanner over one tag.
fn attr_value(tag: &str, attr: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let attr = attr.to_ascii_lowercase();
    let mut from = 0;
    while let Some(relative) = lower[from..].find(&attr) {
        let start = from + relative;
        let end = start + attr.len();
        if boundary(lower[..start].chars().last()) && boundary(lower[end..].chars().next()) {
            let rest = &tag[end..];
            let value = rest[rest.find('=')? + 1..].trim_start();
            let quote = value.chars().next()?;
            if quote == '"' || quote == '\'' {
                let body = &value[1..];
                return Some(decode_entities(&body[..body.find(quote)?]));
            }
            let stop = value
                .find(|c: char| c.is_ascii_whitespace() || c == '>')
                .unwrap_or(value.len());
            return Some(decode_entities(&value[..stop]));
        }
        from = end;
    }
    None
}

/// An attribute name ends where a name character does not follow (original boundary rule).
fn boundary(c: Option<char>) -> bool {
    c.is_none_or(|c| !(c.is_ascii_alphanumeric() || c == '-' || c == '_'))
}

/// Every complete `<name ...>` tag in document order.
fn tags<'a>(html: &'a str, name: &str) -> Vec<&'a str> {
    let lower = html.to_ascii_lowercase();
    let open = format!("<{name}");
    let mut found = Vec::new();
    let mut from = 0;
    while let Some(relative) = lower[from..].find(&open) {
        let start = from + relative;
        let Some(length) = lower[start..].find('>') else {
            break;
        };
        let end = start + length + 1;
        found.push(&html[start..end]);
        from = end;
    }
    found
}

fn meta(html: &str, key_attr: &str, key: &str) -> Option<String> {
    tags(html, "meta").into_iter().find_map(|tag| {
        attr_value(tag, key_attr)
            .filter(|value| value.eq_ignore_ascii_case(key))
            .and_then(|_| attr_value(tag, "content"))
    })
}

fn title_tag(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let start = lower.find("<title")?;
    let content = start + lower[start..].find('>')? + 1;
    let end = content + lower[content..].find("</title>")?;
    Some(decode_entities(&html[content..end]))
}

/// Original `normalize_metadata_text`, including the Google document suffixes.
fn normalize_text(raw: &str) -> Option<String> {
    let mut text = decode_entities(raw)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    for suffix in [
        " - Google Docs",
        " - Google Sheets",
        " - Google Slides",
        " - Google Drive",
    ] {
        if let Some(stripped) = text.strip_suffix(suffix) {
            text = stripped.trim().to_owned();
            break;
        }
    }
    if matches!(
        text.as_str(),
        "" | "Sign in - Google Accounts" | "Google Docs" | "Google Sheets" | "Google Slides"
    ) {
        return None;
    }
    Some(text.chars().take(MAX_METADATA_CHARS).collect())
}

/// Original `normalize_metadata_description`: whitespace collapsed per line, lines kept.
fn normalize_description(raw: &str) -> Option<String> {
    let decoded = decode_entities(raw)
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    let lines = decoded
        .split('\n')
        .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
        .collect::<Vec<_>>()
        .join("\n");
    let text = lines.trim();
    (!text.is_empty()).then(|| text.chars().take(MAX_DESCRIPTION_CHARS).collect())
}

/// Original favicon choice: the first raster icon link, else the first icon link.
fn favicon(html: &str, page: &Url) -> Option<Url> {
    let mut fallback = None;
    for tag in tags(html, "link") {
        let icon = attr_value(tag, "rel").is_some_and(|rel| {
            rel.split_ascii_whitespace().any(|token| {
                token.eq_ignore_ascii_case("icon") || token.eq_ignore_ascii_case("apple-touch-icon")
            })
        });
        if !icon {
            continue;
        }
        let Some(url) = attr_value(tag, "href").and_then(|href| page.join(href.trim()).ok()) else {
            continue;
        };
        let declared = attr_value(tag, "type").map(|value| value.to_ascii_lowercase());
        let extension = url
            .path()
            .rsplit_once('.')
            .map(|(_, extension)| extension.to_ascii_lowercase());
        if declared.as_deref().is_some_and(raster_type)
            || extension.as_deref().is_some_and(raster_extension)
        {
            return Some(url);
        }
        fallback.get_or_insert(url);
    }
    fallback
}

fn raster_type(value: &str) -> bool {
    matches!(value, "image/jpeg" | "image/png" | "image/webp")
}

fn raster_extension(value: &str) -> bool {
    matches!(value, "jpg" | "jpeg" | "png" | "webp")
}

/// Original `extract_link_preview_metadata` plus image and favicon URLs. No title, no
/// preview.
fn extract(html: &str, page: &Url) -> Option<Metadata> {
    let title = meta(html, "property", "og:title")
        .or_else(|| meta(html, "name", "twitter:title"))
        .or_else(|| title_tag(html))
        .and_then(|value| normalize_text(&value))?;
    let image = meta(html, "property", "og:image")
        .or_else(|| meta(html, "property", "og:image:secure_url"))
        .or_else(|| meta(html, "name", "twitter:image"))
        .and_then(|raw| page.join(raw.trim()).ok());
    Some(Metadata {
        title,
        site_name: meta(html, "property", "og:site_name").and_then(|v| normalize_text(&v)),
        description: meta(html, "property", "og:description")
            .or_else(|| meta(html, "name", "twitter:description"))
            .and_then(|value| normalize_description(&value)),
        image,
        favicon: favicon(html, page),
    })
}

/// Original `youtube::is_video_url`.
fn youtube_video(url: &Url) -> bool {
    let segments = || url.path_segments().into_iter().flatten();
    match url.host_str() {
        Some("youtu.be" | "www.youtu.be") => segments().next().is_some_and(|s| !s.is_empty()),
        Some("youtube.com" | "www.youtube.com" | "m.youtube.com" | "music.youtube.com") => {
            (url.path() == "/watch"
                && url
                    .query_pairs()
                    .any(|(key, value)| key == "v" && !value.is_empty()))
                || ["shorts", "live", "embed"].iter().any(|prefix| {
                    let mut parts = segments();
                    parts.next() == Some(*prefix) && parts.next().is_some_and(|s| !s.is_empty())
                })
        }
        _ => false,
    }
}

/// Original `oembed_url`: an `/embed/<id>` link is asked for as `/watch?v=<id>`.
fn oembed_url(video: &Url) -> Option<Url> {
    let mut canonical = video.clone();
    let mut segments = video.path_segments().into_iter().flatten();
    if video.host_str() != Some("youtu.be")
        && video.host_str() != Some("www.youtu.be")
        && segments.next() == Some("embed")
    {
        let id = segments.next()?;
        if !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
        {
            return None;
        }
        canonical.set_path("/watch");
        canonical.set_query(None);
        canonical.query_pairs_mut().append_pair("v", id);
        canonical.set_fragment(None);
    }
    let mut url = Url::parse(OEMBED_ENDPOINT).ok()?;
    url.query_pairs_mut()
        .append_pair("format", "json")
        .append_pair("url", canonical.as_str());
    Some(url)
}

#[derive(serde::Deserialize)]
struct OEmbed {
    title: String,
    author_name: Option<String>,
    provider_name: Option<String>,
    thumbnail_url: Option<String>,
}

async fn youtube_metadata(video: &Url, deny: &[Network]) -> Result<Metadata, Refused> {
    let url = oembed_url(video).ok_or(Refused::NoPreview)?;
    let (_, response) = follow(&url, "application/json", deny).await?;
    if !response.status().is_success() || media_type(&response) != "application/json" {
        return Err(Refused::NoPreview);
    }
    let body = read(response, MAX_OEMBED_BYTES, false)
        .await
        .ok_or(Refused::NoPreview)?;
    let oembed: OEmbed = serde_json::from_slice(&body).map_err(|_| Refused::NoPreview)?;
    Ok(Metadata {
        title: normalize_text(&oembed.title).ok_or(Refused::NoPreview)?,
        site_name: oembed
            .provider_name
            .as_deref()
            .and_then(normalize_text)
            .or_else(|| Some("YouTube".to_owned())),
        description: oembed
            .author_name
            .as_deref()
            .and_then(normalize_description),
        image: oembed.thumbnail_url.and_then(|raw| Url::parse(&raw).ok()),
        favicon: None,
    })
}

async fn page_metadata(url: &Url, deny: &[Network]) -> Result<Metadata, Refused> {
    if youtube_video(url) {
        return youtube_metadata(url, deny).await;
    }
    let (page, response) = follow(url, "text/html,application/xhtml+xml;q=0.9", deny).await?;
    let kind = media_type(&response);
    let html = kind == "text/html" || kind == "application/xhtml+xml";
    if !response.status().is_success() || !html {
        return Err(Refused::NoPreview);
    }
    let body = read(response, MAX_PAGE_BYTES, true)
        .await
        .ok_or(Refused::NoPreview)?;
    extract(&String::from_utf8_lossy(&body), &page).ok_or(Refused::NoPreview)
}

/// Original raster sniffing: the declared type must be JPEG, PNG or WebP and match the bytes;
/// animated PNG and WebP are refused.
fn raster(declared: &str, bytes: &[u8]) -> bool {
    let sniffed = if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "image/jpeg"
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        "image/png"
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP".as_slice()) {
        "image/webp"
    } else {
        return false;
    };
    let animated = match sniffed {
        "image/png" => bytes.windows(4).any(|w| w == b"acTL"),
        "image/webp" => bytes.windows(4).any(|w| w == b"ANIM"),
        _ => false,
    };
    sniffed == declared && !animated
}

async fn image(url: &Url, deny: &[Network]) -> Option<(Vec<u8>, String)> {
    let (_, response) = follow(url, "image/jpeg,image/png,image/webp", deny)
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let declared = media_type(&response);
    let bytes = read(response, MAX_IMAGE_BYTES, false).await?;
    raster(&declared, &bytes).then_some((bytes, declared))
}

async fn bounded_image(url: Option<&Url>, deny: &[Network]) -> Option<(Vec<u8>, String)> {
    let fetch = image(url?, deny);
    tokio::time::timeout(FETCH_DEADLINE, fetch)
        .await
        .ok()
        .flatten()
}

/// Original `sanitizeSnapshotText`: control characters become spaces (the description keeps
/// newlines) and the text is cut to the byte bound on a character boundary.
pub(crate) fn snapshot_text(value: &str, max: usize, newlines: bool) -> String {
    let mut out = String::new();
    for raw in value.chars() {
        let control = raw.is_control() && !(newlines && raw == '\n');
        let ch = if control { ' ' } else { raw };
        if out.len() + ch.len_utf8() > max {
            break;
        }
        out.push(ch);
    }
    out
}

/// A Relay media URL of this Community whose file name is the descriptor hash, as the
/// Relay's `validate_local_image_media_pair` requires.
fn media_pair(url: &str, sha256: &str, host: &str) -> bool {
    let Ok(parsed) = Url::parse(url) else {
        return false;
    };
    let file = parsed.path().strip_prefix("/media/").unwrap_or_default();
    let Some((hash, extension)) = file.split_once('.') else {
        return false;
    };
    let authority = match parsed.port() {
        Some(port) => format!("{}:{port}", parsed.host_str().unwrap_or_default()),
        None => parsed.host_str().unwrap_or_default().to_owned(),
    };
    authority.eq_ignore_ascii_case(host)
        && parsed.query().is_none()
        && parsed.fragment().is_none()
        && parsed.username().is_empty()
        && hash == sha256
        && sha256.len() == 64
        && sha256.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
        && matches!(extension, "jpg" | "png" | "gif" | "webp")
}

/// Upload one fetched image as the caller's Relay media; any failure leaves the snapshot
/// text-only (original fallback tag).
async fn upload(
    state: &BffState,
    client: &collab_bridge::bridge::IdentityClient,
    host: &str,
    fetched: Option<(Vec<u8>, String)>,
) -> (String, String) {
    let Some((bytes, mime)) = fetched else {
        return (String::new(), String::new());
    };
    match client
        .upload_media(&state.http, bytes, &mime, state.media_max_bytes)
        .await
    {
        Ok(descriptor) if media_pair(&descriptor.url, &descriptor.sha256, host) => {
            (descriptor.url, descriptor.sha256)
        }
        _ => (String::new(), String::new()),
    }
}

/// Original composer canonical form: the parsed https URL without its fragment.
fn canonical(raw: &str) -> Result<Url, Refused> {
    let mut url = Url::parse(raw.trim()).map_err(|_| Refused::Url)?;
    url.set_fragment(None);
    checked_url(&url)?;
    Ok(url)
}

/// `POST /api/v1/workspaces/{workspace_id}/link-previews`
pub async fn create_workspace_preview(
    State(state): State<BffState>,
    Path(workspace_id): Path<Uuid>,
    headers: HeaderMap,
    body: Result<Json<contracts::WebLinkPreviewRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    let host = match crate::web_transport::admit_workspace(&state, &ctx, workspace_id).await {
        Ok(scope) => scope.community_host,
        Err(response) => return response,
    };
    let Ok(Json(request)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let scope = (WORKSPACE_ACTION, Some(workspace_id));
    create(&state, &ctx, &host, scope, &request.url).await
}

/// `POST /api/v1/conversations/{conversation_id}/link-previews`
pub async fn create_conversation_preview(
    State(state): State<BffState>,
    Path(conversation_id): Path<Uuid>,
    headers: HeaderMap,
    body: Result<Json<contracts::WebLinkPreviewRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    let host = match crate::conversations::admit(&state, &ctx, conversation_id).await {
        Ok(scope) => scope.community_host,
        Err(response) => return response,
    };
    let Ok(Json(request)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    create(&state, &ctx, &host, (CONVERSATION_ACTION, None), &request.url).await
}

fn refusal(status: StatusCode, class: ErrorClass, reason: ReasonCode) -> Response {
    error_body(status, class, reason, None)
}

#[derive(sqlx::FromRow)]
struct Stored {
    id: Uuid,
    canonical_url: String,
    title: String,
    site_name: String,
    description: String,
    image_url: String,
    image_sha256: String,
    favicon_url: String,
    favicon_sha256: String,
    expires_at: chrono::DateTime<chrono::Utc>,
}

async fn create(
    state: &BffState,
    ctx: &ExecutionContext,
    host: &str,
    (action, workspace): (&'static str, Option<Uuid>),
    raw: &str,
) -> Response {
    let Ok(url) = canonical(raw) else {
        return refusal(
            StatusCode::UNPROCESSABLE_ENTITY,
            ErrorClass::Precondition,
            ReasonCode::InvalidParameters,
        );
    };
    let config = &state.link_preview;
    let principal = ctx.tenant_principal_id.to_string();
    if config
        .budget
        .try_acquire(&ctx.tenant_id.to_string(), &principal)
        .is_err()
    {
        return refusal(
            StatusCode::TOO_MANY_REQUESTS,
            ErrorClass::Limit,
            ReasonCode::RateLimited,
        );
    }
    if let Err(check) = community_limits(state, host).await {
        return check.into_response();
    }
    let url_digest = hex::encode(Sha256::digest(url.as_str().as_bytes()));
    let operation = Uuid::new_v4();
    let fetched = tokio::time::timeout(FETCH_DEADLINE, page_metadata(&url, &config.deny))
        .await
        .unwrap_or(Err(Refused::NoPreview));
    let metadata = match fetched {
        Ok(metadata) => metadata,
        Err(why) => {
            let result = if why == Refused::Address {
                "ADDRESS_REFUSED"
            } else {
                "NO_PREVIEW"
            };
            let audit = Fetch {
                operation,
                action,
                workspace,
                host: url.host_str().unwrap_or_default(),
                url_digest: &url_digest,
                result,
                snapshot: None,
            };
            if record(state, ctx, audit).await.is_err() {
                return StatusCode::SERVICE_UNAVAILABLE.into_response();
            }
            return refusal(
                StatusCode::NOT_FOUND,
                ErrorClass::Precondition,
                ReasonCode::TargetNotFound,
            );
        }
    };
    let keys = match actor_keys(state, ctx).await {
        Ok(keys) => keys,
        Err(response) => return response,
    };
    let client = match community_client(state, &keys, host) {
        Ok(client) => client,
        Err(response) => return response,
    };
    let (image_bytes, favicon_bytes) = tokio::join!(
        bounded_image(metadata.image.as_ref(), &config.deny),
        bounded_image(metadata.favicon.as_ref(), &config.deny),
    );
    let ((image_url, image_sha), (favicon_url, favicon_sha)) = tokio::join!(
        upload(state, &client, host, image_bytes),
        upload(state, &client, host, favicon_bytes),
    );
    let snapshot_id = Uuid::new_v4();
    let ttl = i64::try_from(config.ttl.as_secs()).unwrap_or(i64::MAX);
    let stored: Result<Stored, sqlx::Error> = sqlx::query_as(
        "insert into admission.link_preview_snapshot
             (id, tenant_id, tenant_principal_id, community_host, canonical_url, title, site_name,
              description, image_url, image_sha256, favicon_url, favicon_sha256, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                 now() + make_interval(secs => $13::bigint))
         returning id, canonical_url, title, site_name, description, image_url, image_sha256,
                   favicon_url, favicon_sha256, expires_at",
    )
    .bind(snapshot_id)
    .bind(ctx.tenant_id)
    .bind(ctx.tenant_principal_id)
    .bind(host)
    .bind(url.as_str())
    .bind(snapshot_text(&metadata.title, MAX_TITLE_BYTES, false))
    .bind(snapshot_text(
        metadata.site_name.as_deref().unwrap_or_default(),
        MAX_SITE_BYTES,
        false,
    ))
    .bind(snapshot_text(
        metadata.description.as_deref().unwrap_or_default(),
        MAX_DESCRIPTION_BYTES,
        true,
    ))
    .bind(&image_url)
    .bind(&image_sha)
    .bind(&favicon_url)
    .bind(&favicon_sha)
    .bind(ttl)
    .fetch_one(&state.pool)
    .await;
    let Ok(stored) = stored else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let audit = Fetch {
        operation,
        action,
        workspace,
        host: url.host_str().unwrap_or_default(),
        url_digest: &url_digest,
        result: "SNAPSHOT_CREATED",
        snapshot: Some(stored.id),
    };
    if record(state, ctx, audit).await.is_err() {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    let nonempty = |value: String| (!value.is_empty()).then_some(value);
    Json(contracts::WebLinkPreviewSnapshotView {
        snapshot_id: stored.id.to_string(),
        url: raw.to_owned(),
        canonical_url: stored.canonical_url,
        title: stored.title,
        site_name: stored.site_name,
        description: stored.description,
        image_url: nonempty(stored.image_url),
        favicon_url: nonempty(stored.favicon_url),
        expires_at: stored
            .expires_at
            .to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
    })
    .into_response()
}

/// One fetch attempt as audit: only the host and the URL digest, never the URL.
struct Fetch<'a> {
    operation: Uuid,
    action: &'static str,
    workspace: Option<Uuid>,
    host: &'a str,
    url_digest: &'a str,
    result: &'static str,
    snapshot: Option<Uuid>,
}

async fn record(state: &BffState, ctx: &ExecutionContext, fetch: Fetch<'_>) -> Result<(), ()> {
    let entry = AuditEntry {
        // The host is the only readable part of the target that is kept.
        event_key: format!("link-preview:{}:{}", fetch.operation, fetch.host),
        tenant_id: Some(ctx.tenant_id),
        workspace_id: fetch.workspace,
        operation_id: fetch.operation,
        event_type: "OUTCOME",
        human_identity_id: Some(ctx.human_identity_id),
        initiator_principal_id: Some(ctx.tenant_principal_id),
        actor_principal_id: Some(ctx.tenant_principal_id),
        action_key: fetch.action,
        action_version: 1,
        component_type_key: "buzz",
        target_type: Some("LINK_PREVIEW"),
        target_id: fetch.snapshot,
        parameter_hash: fetch.url_digest,
        decision: "ALLOW",
        result_code: fetch.result,
        result_exposure: "NONE",
        evidence_refs: Vec::new(),
        correlation_id: fetch.operation,
    };
    crate::web_transport::record(state, entry)
        .await
        .map_err(|error| tracing::warn!(error = %error, "link preview audit not written"))
}

/// Request shape (V-SCN-139): snapshot IDs only with a new STREAM message, never with an
/// edit, delete or Send to channel, never together with suppression; at most 8, unique.
pub(crate) fn valid_request(request: &contracts::WebPublishMessageRequest) -> bool {
    let ids = request
        .link_preview_snapshot_ids
        .as_deref()
        .unwrap_or_default();
    let suppress = request.suppress_link_previews == Some(true);
    let stream = request
        .message_type
        .as_ref()
        .is_none_or(|kind| *kind == contracts::WebMessageType::Stream);
    let mut unique = std::collections::HashSet::new();
    let ids_ok = ids.len() <= MAX_SNAPSHOTS
        && ids
            .iter()
            .all(|id| Uuid::parse_str(id).is_ok_and(|parsed| unique.insert(parsed)));
    let shared = request.delete_event_id.is_none()
        && request.send_to_channel_source_event_id.is_none()
        && stream;
    ids_ok
        && (ids.is_empty() || (shared && request.edit_event_id.is_none() && !suppress))
        && (!suppress || shared)
}

/// The frozen snapshot references of a publication, in request order.
pub(crate) fn snapshot_ids(request: &contracts::WebPublishMessageRequest) -> Vec<Uuid> {
    request
        .link_preview_snapshot_ids
        .as_deref()
        .unwrap_or_default()
        .iter()
        .filter_map(|id| Uuid::parse_str(id).ok())
        .collect()
}

/// The original 11-element tags for the caller's own unexpired snapshots of this Community.
/// A foreign, unknown or expired ID refuses the publication; a snapshot whose canonical URL is
/// not in the text is left out, exactly as recipients would ignore it.
pub(crate) async fn snapshot_tags(
    state: &BffState,
    ctx: &ExecutionContext,
    host: &str,
    ids: &[Uuid],
    content: &str,
) -> Result<Vec<Vec<String>>, Response> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let rows: Vec<Stored> = sqlx::query_as(
        "select id, canonical_url, title, site_name, description, image_url, image_sha256,
                favicon_url, favicon_sha256, expires_at
         from admission.link_preview_snapshot
         where id = any($1) and tenant_id = $2 and tenant_principal_id = $3
           and community_host = $4 and expires_at > now()",
    )
    .bind(ids)
    .bind(ctx.tenant_id)
    .bind(ctx.tenant_principal_id)
    .bind(host)
    .fetch_all(&state.pool)
    .await
    .map_err(|_| StatusCode::SERVICE_UNAVAILABLE.into_response())?;
    let mut tags = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for id in ids {
        let Some(row) = rows.iter().find(|row| row.id == *id) else {
            return Err(refusal(
                StatusCode::NOT_FOUND,
                ErrorClass::Precondition,
                ReasonCode::TargetNotFound,
            ));
        };
        if content.contains(&row.canonical_url) && seen.insert(row.canonical_url.as_str()) {
            tags.push(snapshot_tag(row));
        }
    }
    Ok(tags)
}

fn snapshot_tag(row: &Stored) -> Vec<String> {
    vec![
        "link-preview".into(),
        "snapshot".into(),
        "1".into(),
        row.canonical_url.clone(),
        row.title.clone(),
        row.site_name.clone(),
        row.description.clone(),
        row.image_url.clone(),
        row.image_sha256.clone(),
        row.favicon_url.clone(),
        row.favicon_sha256.clone(),
    ]
}

/// Original `link-preview none`.
pub(crate) fn suppression_tag() -> Vec<String> {
    vec!["link-preview".into(), "none".into()]
}

/// Retention: expired snapshots are removed by the publication reconciler tick. A frozen
/// publication intent keeps only the IDs.
pub(crate) async fn sweep(pool: &sqlx::PgPool, batch: i64) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query(
        "delete from admission.link_preview_snapshot where id in (
           select id from admission.link_preview_snapshot where expires_at < now()
           order by expires_at limit $1)",
    )
    .bind(batch)
    .execute(pool)
    .await?
    .rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(raw: &str) -> IpAddr {
        raw.parse().unwrap()
    }

    #[test]
    fn egress_refuses_every_non_global_range_and_registered_networks() {
        for refused in [
            "127.0.0.1",
            "10.1.2.3",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "0.0.0.0",
            "224.0.0.1",
            "255.255.255.255",
            "::1",
            "::",
            "fc00::1",
            "fd12:3456::1",
            "fe80::1",
            "ff02::1",
            "::ffff:127.0.0.1",
            "::ffff:10.0.0.1",
            "64:ff9b::a00:1",
            "2001:db8::1",
        ] {
            assert!(!allowed(ip(refused), &[]), "{refused}");
        }
        for public in ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946", "8.8.8.8"] {
            assert!(allowed(ip(public), &[]), "{public}");
        }
        let registered = [Network::parse("93.184.216.0/24").unwrap()];
        assert!(!allowed(ip("93.184.216.34"), &registered));
        assert!(allowed(ip("8.8.8.8"), &registered));
        assert!(Network::parse("10.0.0.0/33").is_none());
        assert!(Network::parse("not-a-network").is_none());
    }

    #[test]
    fn only_https_on_the_default_port_without_credentials_is_fetched() {
        assert!(canonical("https://example.com/a#section").is_ok());
        assert_eq!(
            canonical("https://example.com/a#section").unwrap().as_str(),
            "https://example.com/a"
        );
        for refused in [
            "http://example.com/",
            "https://example.com:8443/",
            "https://user:pass@example.com/",
            "ftp://example.com/",
            "not a url",
        ] {
            assert_eq!(canonical(refused).err(), Some(Refused::Url), "{refused}");
        }
    }

    #[tokio::test]
    async fn literal_internal_addresses_are_refused_before_connecting() {
        for url in ["https://127.0.0.1/", "https://[::1]/", "https://169.254.169.254/"] {
            let url = Url::parse(url).unwrap();
            assert_eq!(resolve(&url, &[]).await.err(), Some(Refused::Address));
        }
    }

    #[test]
    fn metadata_follows_the_original_extraction_order() {
        let page = Url::parse("https://example.com/post").unwrap();
        let html = r#"<html><head><title>Fallback &amp; title</title>
            <meta name="twitter:title" content="Twitter title">
            <meta property="og:title" content="  OG   title &#x27;one&#39; ">
            <meta property="og:site_name" content="Example">
            <meta name="twitter:description" content="Line one
              continues&#10;Line two">
            <meta property="og:image" content="/cover.png">
            <link rel="shortcut icon" href="/favicon.ico">
            <link rel="apple-touch-icon" type="image/png" href="/touch.png">
            </head></html>"#;
        let found = extract(html, &page).unwrap();
        assert_eq!(found.title, "OG title 'one'");
        assert_eq!(found.site_name.as_deref(), Some("Example"));
        assert_eq!(found.description.as_deref(), Some("Line one\ncontinues\nLine two"));
        assert_eq!(found.image.unwrap().as_str(), "https://example.com/cover.png");
        assert_eq!(found.favicon.unwrap().as_str(), "https://example.com/touch.png");
        assert!(extract("<html><body>no title</body></html>", &page).is_none());
        let docs = "<title>Plan - Google Docs</title>";
        assert_eq!(extract(docs, &page).unwrap().title, "Plan");
        assert!(extract("<title>Sign in - Google Accounts</title>", &page).is_none());
    }

    #[test]
    fn youtube_links_use_the_original_oembed_request() {
        let embed = Url::parse("https://www.youtube.com/embed/abc_123").unwrap();
        assert!(youtube_video(&embed));
        let oembed = oembed_url(&embed).unwrap();
        assert!(oembed.as_str().starts_with(OEMBED_ENDPOINT));
        assert!(oembed
            .query_pairs()
            .any(|(k, v)| k == "url" && v == "https://www.youtube.com/watch?v=abc_123"));
        assert!(youtube_video(&Url::parse("https://youtu.be/xyz").unwrap()));
        assert!(!youtube_video(&Url::parse("https://www.youtube.com/feed").unwrap()));
    }

    #[test]
    fn snapshot_text_and_media_pairs_match_the_relay_rules() {
        assert_eq!(snapshot_text("a\u{7}b\nc", 10, false), "a b c");
        assert_eq!(snapshot_text("a\nb", 10, true), "a\nb");
        assert_eq!(snapshot_text("ééé", 5, false), "éé");
        let sha = "a".repeat(64);
        let url = format!("https://community.example/media/{sha}.jpg");
        assert!(media_pair(&url, &sha, "community.example"));
        assert!(!media_pair(&url, &sha, "other.example"));
        assert!(!media_pair(&format!("{url}?x=1"), &sha, "community.example"));
        let bad = format!("https://community.example/media/{sha}.svg");
        assert!(!media_pair(&bad, &sha, "community.example"));
    }

    #[test]
    fn rasters_must_match_their_declared_type_and_not_be_animated() {
        let png = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        assert!(raster("image/png", &png));
        assert!(!raster("image/jpeg", &png));
        let mut apng = png.clone();
        apng.extend_from_slice(b"acTL");
        assert!(!raster("image/png", &apng));
        assert!(raster("image/jpeg", &[0xFF, 0xD8, 0xFF, 0xE0]));
        assert!(!raster("image/svg+xml", b"<svg/>"));
    }

    fn request(value: serde_json::Value) -> contracts::WebPublishMessageRequest {
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn publication_references_follow_the_original_send_and_edit_rules() {
        let id = serde_json::json!([Uuid::new_v4()]);
        let event = serde_json::json!("e".repeat(64));
        let ok = |pairs: &[(&str, serde_json::Value)]| {
            let mut value = serde_json::json!({"content": "x"});
            for (key, item) in pairs {
                value[*key] = item.clone();
            }
            valid_request(&request(value))
        };
        let ids = ("linkPreviewSnapshotIds", id.clone());
        let suppress = ("suppressLinkPreviews", serde_json::json!(true));
        let edit = ("editEventId", event.clone());
        assert!(ok(&[ids.clone()]));
        assert!(ok(&[suppress.clone()]));
        assert!(ok(&[edit.clone(), suppress.clone()]));
        let twice = serde_json::json!([id[0], id[0]]);
        assert!(!ok(&[("linkPreviewSnapshotIds", twice)]));
        assert!(!ok(&[ids.clone(), suppress.clone()]));
        assert!(!ok(&[edit, ids.clone()]));
        assert!(!ok(&[("deleteEventId", event), suppress]));
        let forum = ("messageType", serde_json::json!("FORUM_POST"));
        assert!(!ok(&[forum, ids]));
        let many: Vec<Uuid> = (0..9).map(|_| Uuid::new_v4()).collect();
        assert!(!ok(&[("linkPreviewSnapshotIds", serde_json::json!(many))]));
    }
}
