//! DD-149(5), `05` §2.15: outbound egress of user-registered external MCP connectors.
//!
//! A connector endpoint is any URL a user typed, so every connection is decided here, inside
//! Core, and never by the Gateway or a proxy: `https` only, no userinfo, query or fragment,
//! no single-label or cluster-internal host names; the host is resolved by Core and *every*
//! resolved address must be public global unicast (the built-in refusals of the link-preview
//! fetch host: loopback, RFC 1918, CGNAT, link-local and cloud metadata, ULA, multicast,
//! unspecified, broadcast, documentation and benchmarking ranges, IPv4 embedded in mapped,
//! compatible, NAT64 and 6to4 addresses) and outside the deployment-declared deny CIDRs. The
//! connection is then pinned to exactly those addresses (no second resolution), redirects are
//! never followed and no proxy is used. One client serves one host: OAuth endpoints and the
//! legacy SSE message endpoint each get their own pinned client.
//!
//! The platform administrator caps egress (`KAILO_EXTERNAL_MCP_EGRESS_HOSTS`: any public host
//! or a host-suffix set); a Tenant may narrow it with its own suffix allowlist. Development
//! deployments may list CIDRs (`KAILO_EXTERNAL_MCP_DEV_CIDRS`) inside which `http` and private
//! addresses are accepted; production leaves it unset.

// The connector actions and the relay wire these helpers in; until then only tests use parts.

use std::net::{IpAddr, SocketAddr};
use std::time::Duration;

use reqwest::Url;

pub(crate) use crate::link_preview::Network as Cidr;

const HOSTS_ENV: &str = "KAILO_EXTERNAL_MCP_EGRESS_HOSTS";
const DEV_CIDRS_ENV: &str = "KAILO_EXTERNAL_MCP_DEV_CIDRS";
const DENY_CIDRS_ENV: &str = "KAILO_EXTERNAL_MCP_DENY_CIDRS";
const MAX_URL_BYTES: usize = 2048;
const MAX_HOST_BYTES: usize = 253;
const DNS_TIMEOUT: Duration = Duration::from_secs(5);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
pub(crate) const USER_AGENT: &str = "Kailo-Connector/1";
/// Host names and suffixes that only ever name something inside a deployment or a LAN.
const INTERNAL_SUFFIXES: [&str; 6] = [
    "local",
    "localhost",
    "internal",
    "svc",
    "cluster.local",
    "home.arpa",
];

/// The deployment-declared egress cap (platform administrator domain).
#[derive(Debug, Clone, Default)]
pub(crate) struct PlatformEgress {
    /// Any public host is reachable (the env value is unset or `*`).
    pub(crate) any_public_host: bool,
    /// Otherwise: only hosts equal to or under one of these suffixes.
    pub(crate) host_suffixes: Vec<String>,
    /// Development only: `http` and private addresses are accepted inside these networks.
    pub(crate) dev_cidrs: Vec<Cidr>,
    /// Refused in addition to the built-in ranges; wins over `dev_cidrs`.
    pub(crate) deny_cidrs: Vec<Cidr>,
}

impl PlatformEgress {
    pub(crate) fn from_env() -> Result<Self, String> {
        let var = |key: &str| std::env::var(key).ok();
        Self::from_values(
            var(HOSTS_ENV).as_deref(),
            var(DEV_CIDRS_ENV).as_deref(),
            var(DENY_CIDRS_ENV).as_deref(),
        )
    }

    fn from_values(
        hosts: Option<&str>,
        dev: Option<&str>,
        deny: Option<&str>,
    ) -> Result<Self, String> {
        let (any_public_host, host_suffixes) = match hosts.map(str::trim) {
            None | Some("*") => (true, Vec::new()),
            Some(raw) => {
                let suffixes = raw
                    .split(',')
                    .map(|entry| {
                        let entry = entry.trim();
                        normalize_suffix(entry)
                            .filter(|normalized| normalized == entry)
                            .ok_or_else(|| format!("{HOSTS_ENV} 含无效主机后缀: {entry}"))
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                (false, suffixes)
            }
        };
        let cidrs = |key: &str, raw: Option<&str>| -> Result<Vec<Cidr>, String> {
            raw.unwrap_or_default()
                .split(',')
                .filter(|entry| !entry.trim().is_empty())
                .map(|entry| Cidr::parse(entry).ok_or_else(|| format!("{key} 含无效网段: {entry}")))
                .collect()
        };
        Ok(Self {
            any_public_host,
            host_suffixes,
            dev_cidrs: cidrs(DEV_CIDRS_ENV, dev)?,
            deny_cidrs: cidrs(DENY_CIDRS_ENV, deny)?,
        })
    }

    /// Whether a Tenant allowlist suffix stays inside the platform cap (wider entries are
    /// refused when the Tenant policy is saved).
    pub(crate) fn permits_suffix(&self, suffix: &str) -> bool {
        self.any_public_host || self.host_suffixes.iter().any(|cap| under(suffix, cap))
    }

    fn in_dev(&self, ip: IpAddr) -> bool {
        self.dev_cidrs.iter().any(|cidr| cidr.contains(ip))
    }

    fn denied(&self, ip: IpAddr) -> bool {
        self.deny_cidrs.iter().any(|cidr| cidr.contains(ip))
    }
}

/// Refusal reasons; they never carry the URL or the resolved addresses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum EgressError {
    InvalidUrl,
    SchemeNotAllowed,
    HostNotAllowed,
    NotInAllowlist,
    AddressNotAllowed,
    ResolutionFailed,
}

/// The policy in force for one decision: platform cap plus the Tenant allowlist (empty means
/// "no narrower than the platform").
#[derive(Clone, Copy)]
pub(crate) struct EgressScope<'a> {
    pub(crate) platform: &'a PlatformEgress,
    pub(crate) tenant_suffixes: &'a [String],
}

/// `host` equals `suffix` or is a subdomain of it.
fn under(host: &str, suffix: &str) -> bool {
    host == suffix
        || host
            .strip_suffix(suffix)
            .is_some_and(|rest| rest.ends_with('.'))
}

fn valid_label(label: &str) -> bool {
    !label.is_empty()
        && label.len() <= 63
        && !label.starts_with('-')
        && !label.ends_with('-')
        && label
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
}

/// A host suffix of an allowlist: lowercase, no leading dot, DNS characters, at least two
/// labels, not an internal name.
pub(crate) fn normalize_suffix(raw: &str) -> Option<String> {
    let suffix = raw.trim().trim_start_matches('.').to_ascii_lowercase();
    if suffix.is_empty() || suffix.len() > MAX_HOST_BYTES || !suffix.contains('.') {
        return None;
    }
    if !suffix.split('.').all(valid_label) || internal_name(&suffix) {
        return None;
    }
    Some(suffix)
}

fn internal_name(host: &str) -> bool {
    INTERNAL_SUFFIXES.iter().any(|suffix| under(host, suffix))
}

/// Syntax of a connector endpoint (and of every OAuth endpoint it leads to). IP-literal hosts
/// pass here and are classified when resolved.
pub(crate) fn parse_endpoint(raw: &str) -> Result<Url, EgressError> {
    if raw.len() > MAX_URL_BYTES || raw.trim() != raw {
        return Err(EgressError::InvalidUrl);
    }
    let url = Url::parse(raw).map_err(|_| EgressError::InvalidUrl)?;
    if !matches!(url.scheme(), "https" | "http") {
        return Err(EgressError::SchemeNotAllowed);
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.cannot_be_a_base()
    {
        return Err(EgressError::InvalidUrl);
    }
    let host = url.host_str().ok_or(EgressError::InvalidUrl)?;
    if literal(&url).is_none()
        && (host.len() > MAX_HOST_BYTES
            || !host.contains('.')
            || !host.split('.').all(valid_label)
            || internal_name(host))
    {
        return Err(EgressError::HostNotAllowed);
    }
    Ok(url)
}

/// Platform cap AND Tenant allowlist.
pub(crate) fn host_permitted(scope: &EgressScope, host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    scope.platform.permits_suffix(&host)
        && (scope.tenant_suffixes.is_empty()
            || scope
                .tenant_suffixes
                .iter()
                .any(|suffix| under(&host, suffix)))
}

/// One resolved address against the policy: deny CIDRs always refuse; `http` only inside the
/// dev CIDRs; `https` to public global unicast or inside the dev CIDRs.
fn address_permitted(
    platform: &PlatformEgress,
    ip: IpAddr,
    https: bool,
) -> Result<(), EgressError> {
    if platform.denied(ip) {
        return Err(EgressError::AddressNotAllowed);
    }
    if platform.in_dev(ip) {
        return Ok(());
    }
    if !https {
        return Err(EgressError::SchemeNotAllowed);
    }
    if crate::link_preview::reserved(ip) {
        return Err(EgressError::AddressNotAllowed);
    }
    Ok(())
}

/// The URL host when it is an IP literal (already normalized by the URL parser).
fn literal(url: &Url) -> Option<IpAddr> {
    let host = url.host_str()?;
    host.strip_prefix('[')
        .and_then(|rest| rest.strip_suffix(']'))
        .unwrap_or(host)
        .parse()
        .ok()
}

/// Resolve once in Core and check every address. The result is the set a connection must be
/// pinned to.
pub(crate) async fn resolve(
    scope: &EgressScope<'_>,
    url: &Url,
) -> Result<Vec<SocketAddr>, EgressError> {
    let https = match url.scheme() {
        "https" => true,
        "http" if !scope.platform.dev_cidrs.is_empty() => false,
        _ => return Err(EgressError::SchemeNotAllowed),
    };
    let host = url.host_str().ok_or(EgressError::InvalidUrl)?;
    if !host_permitted(scope, host) {
        return Err(EgressError::NotInAllowlist);
    }
    let port = url.port_or_known_default().ok_or(EgressError::InvalidUrl)?;
    let addrs: Vec<SocketAddr> = match literal(url) {
        Some(ip) => vec![SocketAddr::new(ip, port)],
        None => {
            match tokio::time::timeout(DNS_TIMEOUT, tokio::net::lookup_host((host, port))).await {
                Ok(Ok(found)) => found.collect(),
                _ => return Err(EgressError::ResolutionFailed),
            }
        }
    };
    if addrs.is_empty() {
        return Err(EgressError::ResolutionFailed);
    }
    for addr in &addrs {
        address_permitted(scope.platform, addr.ip(), https)?;
    }
    Ok(addrs)
}

/// A client for `url`'s host only, pinned to the checked addresses: no redirects, no proxy,
/// no pooling across hosts, fixed user agent.
pub(crate) async fn client(
    scope: &EgressScope<'_>,
    url: &Url,
    timeout: Duration,
) -> Result<reqwest::Client, EgressError> {
    let addrs = resolve(scope, url).await?;
    let mut builder = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .https_only(url.scheme() == "https")
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(timeout)
        .user_agent(USER_AGENT);
    if let (None, Some(host)) = (literal(url), url.host_str()) {
        builder = builder.resolve_to_addrs(host, &addrs);
    }
    builder.build().map_err(|_| EgressError::ResolutionFailed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn platform(dev: &[&str], deny: &[&str]) -> PlatformEgress {
        PlatformEgress {
            any_public_host: true,
            host_suffixes: Vec::new(),
            dev_cidrs: dev.iter().map(|c| Cidr::parse(c).unwrap()).collect(),
            deny_cidrs: deny.iter().map(|c| Cidr::parse(c).unwrap()).collect(),
        }
    }

    #[test]
    fn mcp_egress_classifies_addresses() {
        let p = platform(&[], &[]);
        let denied = [
            "169.254.169.254",
            "100.64.0.1",
            "198.18.0.1",
            "10.0.0.1",
            "172.16.0.1",
            "192.168.1.1",
            "127.0.0.1",
            "0.0.0.0",
            "0.1.2.3",
            "255.255.255.255",
            "224.0.0.1",
            "192.0.2.1",
            "198.51.100.1",
            "203.0.113.1",
            "::ffff:10.0.0.1",
            "::ffff:169.254.169.254",
            "::a00:1",
            "64:ff9b::a00:1",
            "64:ff9b::a9fe:a9fe",
            "2002:0a00:0001::",
            "2001:db8::1",
            "fd00::1",
            "fc00::1",
            "fe80::1",
            "ff02::1",
            "::1",
            "::",
        ];
        for raw in denied {
            let ip: IpAddr = raw.parse().unwrap();
            assert_eq!(
                address_permitted(&p, ip, true),
                Err(EgressError::AddressNotAllowed),
                "{raw} must be refused"
            );
        }
        for raw in [
            "93.184.216.34",
            "2606:4700::1111",
            "64:ff9b::5db8:d822",
            "::ffff:8.8.8.8",
        ] {
            let ip: IpAddr = raw.parse().unwrap();
            assert_eq!(address_permitted(&p, ip, true), Ok(()), "{raw} is public");
            assert_eq!(
                address_permitted(&p, ip, false),
                Err(EgressError::SchemeNotAllowed),
                "{raw}: http only inside dev CIDRs"
            );
        }
    }

    #[test]
    fn mcp_egress_dev_and_deny_cidrs() {
        let p = platform(
            &["127.0.0.0/8", "fd00::/8"],
            &["127.0.0.9/32", "93.184.216.0/24"],
        );
        let ip = |raw: &str| raw.parse::<IpAddr>().unwrap();
        assert_eq!(address_permitted(&p, ip("127.0.0.1"), false), Ok(()));
        assert_eq!(address_permitted(&p, ip("127.0.0.1"), true), Ok(()));
        assert_eq!(address_permitted(&p, ip("fd00::1"), true), Ok(()));
        assert_eq!(
            address_permitted(&p, ip("127.0.0.9"), false),
            Err(EgressError::AddressNotAllowed),
            "deny wins over dev"
        );
        assert_eq!(
            address_permitted(&p, ip("93.184.216.34"), true),
            Err(EgressError::AddressNotAllowed)
        );
        assert_eq!(
            address_permitted(&p, ip("10.0.0.1"), true),
            Err(EgressError::AddressNotAllowed)
        );
    }

    #[test]
    fn mcp_egress_url_and_host_rules() {
        assert!(parse_endpoint("https://mcp.example.com/mcp").is_ok());
        assert!(parse_endpoint("https://mcp.example.com:8443/v1/mcp").is_ok());
        assert!(
            parse_endpoint("http://127.0.0.1:3000/mcp").is_ok(),
            "syntax only"
        );
        assert!(parse_endpoint("https://[2606:4700::1111]/mcp").is_ok());
        let cases = [
            ("ftp://mcp.example.com/", EgressError::SchemeNotAllowed),
            ("ws://mcp.example.com/", EgressError::SchemeNotAllowed),
            ("https://user:pw@mcp.example.com/", EgressError::InvalidUrl),
            ("https://user@mcp.example.com/", EgressError::InvalidUrl),
            (
                "https://mcp.example.com/mcp?token=x",
                EgressError::InvalidUrl,
            ),
            ("https://mcp.example.com/mcp#frag", EgressError::InvalidUrl),
            ("not a url", EgressError::InvalidUrl),
            (" https://mcp.example.com/", EgressError::InvalidUrl),
            ("https://intranet/mcp", EgressError::HostNotAllowed),
            ("https://localhost/mcp", EgressError::HostNotAllowed),
            ("https://foo.localhost/mcp", EgressError::HostNotAllowed),
            ("https://printer.local/mcp", EgressError::HostNotAllowed),
            ("https://vault.internal/mcp", EgressError::HostNotAllowed),
            ("https://core.kailo.svc/mcp", EgressError::HostNotAllowed),
            (
                "https://core.kailo.svc.cluster.local/mcp",
                EgressError::HostNotAllowed,
            ),
            ("https://router.home.arpa/mcp", EgressError::HostNotAllowed),
            ("https://mcp.example.com./mcp", EgressError::HostNotAllowed),
        ];
        for (raw, expected) in cases {
            assert_eq!(parse_endpoint(raw).err(), Some(expected), "{raw}");
        }
        let long = format!("https://mcp.example.com/{}", "a".repeat(MAX_URL_BYTES));
        assert_eq!(parse_endpoint(&long).err(), Some(EgressError::InvalidUrl));
    }

    #[test]
    fn mcp_egress_allowlists() {
        assert_eq!(
            normalize_suffix(".Example.COM").as_deref(),
            Some("example.com")
        );
        assert_eq!(
            normalize_suffix("api.vendor.io").as_deref(),
            Some("api.vendor.io")
        );
        for bad in [
            "com",
            "",
            ".",
            "exa mple.com",
            "svc.cluster.local",
            "a.internal",
            "-a.com",
        ] {
            assert_eq!(normalize_suffix(bad), None, "{bad}");
        }

        let capped =
            PlatformEgress::from_values(Some("example.com,api.vendor.io"), None, None).unwrap();
        assert!(!capped.any_public_host);
        assert!(capped.permits_suffix("example.com"));
        assert!(capped.permits_suffix("tools.example.com"));
        assert!(!capped.permits_suffix("badexample.com"));
        assert!(!capped.permits_suffix("vendor.io"), "wider than the cap");
        let any = PlatformEgress::from_values(Some("*"), None, None).unwrap();
        assert!(any.any_public_host && any.permits_suffix("anything.org"));
        assert!(
            PlatformEgress::from_values(None, None, None)
                .unwrap()
                .any_public_host
        );
        assert!(PlatformEgress::from_values(Some("Example.com"), None, None).is_err());
        assert!(PlatformEgress::from_values(Some("example.com,"), None, None).is_err());
        assert!(PlatformEgress::from_values(None, Some("10.0.0.0/33"), None).is_err());
        assert!(PlatformEgress::from_values(None, None, Some("nope")).is_err());
        let dev =
            PlatformEgress::from_values(None, Some("127.0.0.0/8, 10.1.0.0/16"), Some("")).unwrap();
        assert_eq!(dev.dev_cidrs.len(), 2);
        assert!(dev.deny_cidrs.is_empty());

        let tenant = vec!["mcp.example.com".to_owned()];
        let scope = EgressScope {
            platform: &capped,
            tenant_suffixes: &tenant,
        };
        assert!(host_permitted(&scope, "mcp.example.com"));
        assert!(host_permitted(&scope, "eu.mcp.example.com"));
        assert!(
            !host_permitted(&scope, "other.example.com"),
            "outside the tenant list"
        );
        let open = EgressScope {
            platform: &capped,
            tenant_suffixes: &[],
        };
        assert!(host_permitted(&open, "other.example.com"));
        assert!(
            !host_permitted(&open, "api.other.io"),
            "outside the platform cap"
        );
        let any_scope = EgressScope {
            platform: &any,
            tenant_suffixes: &[],
        };
        assert!(host_permitted(&any_scope, "api.other.io"));
    }

    #[tokio::test]
    async fn mcp_egress_resolve_literals() {
        let none = platform(&[], &[]);
        let dev = platform(&["127.0.0.0/8"], &[]);
        let scope = |p| EgressScope {
            platform: p,
            tenant_suffixes: &[],
        };
        let url = |raw: &str| parse_endpoint(raw).unwrap();

        assert_eq!(
            resolve(&scope(&none), &url("http://127.0.0.1:9/mcp")).await,
            Err(EgressError::SchemeNotAllowed)
        );
        assert_eq!(
            resolve(&scope(&none), &url("https://127.0.0.1:9/mcp")).await,
            Err(EgressError::AddressNotAllowed)
        );
        assert_eq!(
            resolve(&scope(&none), &url("https://169.254.169.254/latest")).await,
            Err(EgressError::AddressNotAllowed)
        );
        assert_eq!(
            resolve(&scope(&none), &url("https://[::ffff:10.0.0.1]/mcp")).await,
            Err(EgressError::AddressNotAllowed)
        );
        assert_eq!(
            resolve(&scope(&dev), &url("http://127.0.0.1:9/mcp")).await,
            Ok(vec!["127.0.0.1:9".parse().unwrap()])
        );
        assert_eq!(
            resolve(&scope(&dev), &url("http://10.0.0.1/mcp")).await,
            Err(EgressError::SchemeNotAllowed),
            "http outside the dev CIDRs"
        );
        assert_eq!(
            resolve(&scope(&dev), &url("https://93.184.216.34/mcp")).await,
            Ok(vec!["93.184.216.34:443".parse().unwrap()])
        );
        let tenant = vec!["example.com".to_owned()];
        let narrowed = EgressScope {
            platform: &dev,
            tenant_suffixes: &tenant,
        };
        assert_eq!(
            resolve(&narrowed, &url("http://127.0.0.1:9/mcp")).await,
            Err(EgressError::NotInAllowlist)
        );
        assert!(client(
            &scope(&dev),
            &url("http://127.0.0.1:9/mcp"),
            Duration::from_secs(1)
        )
        .await
        .is_ok());
        assert_eq!(
            client(
                &scope(&none),
                &url("http://127.0.0.1:9/mcp"),
                Duration::from_secs(1)
            )
            .await
            .err(),
            Some(EgressError::SchemeNotAllowed)
        );
    }
}
