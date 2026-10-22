# OIDC Back-Channel Logout receiver (DD-133(6))

## Authority

`.design/07` §4.7.5 at design-authority `1a8c395e1c67bc3a24119123fd7046731e11c2c8`:
Kailo sign-out ends the IdP session; the IdP posts a signed `logout_token` to
every client of that SSO session; a component ends that `sid`'s sessions (or,
without `sid`, that `iss`+`sub`'s). Wren's receiver is
`<Wren origin>/oauth/backchannel-logout`, implemented on its native Gateway.

## Seam

Upstream `OidcPolicy` keeps the browser session as an encrypted, stateless
cookie holding the raw ID token (`session.rs::BrowserSession`); it has no
server-side session store, no `sid` index and no back-channel endpoint. The
change adds, without altering any existing path:

- `LocalOidcConfig.backchannelLogout.path` (optional; validated as a distinct
  local path next to login/logout/callback).
- `http/oidc/backchannel.rs`: `POST` + `application/x-www-form-urlencoded` +
  exactly one `logout_token`; verification with the issuer JWKS already loaded
  for ID tokens (asymmetric algorithms only, `iss`, `aud` = client ID; no `exp`
  requirement); `events` must contain
  `http://schemas.openid.net/event/backchannel-logout`; no `nonce`; `iat`
  within 60 s in the future and 10 min in the past; `jti` required and
  de-duplicated (replay → 400, revocation stays); `sid` or `sub` required.
  Accepted → `200`, rejected → `400`, wrong method → `405`, always
  `Cache-Control: no-store`; logs carry only short digests of `sid`/`sub`.
- Revocation: `sid` → every session whose ID token has that `sid`; `sub` only
  → every session of that subject whose ID token was issued at or before the
  logout. `OidcPolicy::apply` treats a revoked session as no session, so the
  next navigation signs in again (silently or via the host, DD-133(2)).
  Entries are kept for the session TTL plus the token window and pruned.

Limit: revocations live in Gateway memory. A Gateway restart forgets them;
the exposure is bounded by the session TTL (1 h) and by the ID token `exp`,
which every request re-validates. Nothing is forwarded to the backend.

## Evidence

`cargo test -p agentgateway --lib http::oidc` (Rust 1.98 in the bounded
BuildKit) includes `tests.rs::backchannel_logout`: valid token ends exactly
that `sid`; `sub`-only token ends earlier sessions of the subject but not a
later login; HS256, wrong `aud`/`iss`, `nonce`, missing/foreign `events`,
missing `jti`, missing `sid`+`sub`, stale or future `iat`, non-JWT, non-form and
missing field are 400 and end nothing; replay is 400 and the logout stays in
force; `GET` is 405; the receiver path must be distinct. Results are in the
delivery report of `feat/wren-embed`.
