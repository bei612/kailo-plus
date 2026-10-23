//! DD-133(4), `.design/07` §4.7.4: the read-only member directory an embedded
//! component reads to put every person of its Kailo Tenant into one component
//! organisation, map Workspaces and derive roles (Tenant admin → component
//! admin). It is a Core service-listener read, never a BFF browser route.
//!
//! The caller is the component instance's own confidential client: a
//! client-credentials token for the Core service audience whose `azp` equals
//! the native page entry binding's `normalizedConfig.directoryClientId`. Core
//! only checks that `azp`; it neither creates nor holds that client's
//! credential. The answer is a full snapshot (never paged) of the ACTIVE HUMAN
//! members in the binding scope: anything Core cannot read completely —
//! database, SpiceDB or Relay — makes the whole read unavailable rather than a
//! partial directory that would remove people from the component.
//!
//! Membership comes from Core (TenantMembership, WorkspaceMembership) and roles
//! from SpiceDB `manage`; the read grants nothing on the Kailo side and carries
//! no email, Buzz key, session or credential.

use std::collections::{BTreeMap, HashMap, HashSet};

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    response::{IntoResponse, Response},
    Json,
};
use contracts::ReasonCode;
use serde_json::{json, Value};
use sqlx::PgConnection;
use uuid::Uuid;

use crate::{governance::Refusal, service_api::ServiceState, spicedb::BulkCheck};

/// One kind:0 filter per author; bounded so one Relay query stays small.
const RELAY_AUTHORS_PER_QUERY: usize = 50;
const ADMIN: &str = "ADMIN";
const MEMBER: &str = "MEMBER";

fn denied() -> Refusal {
    Refusal::Denied(ReasonCode::PermissionDenied)
}

fn unavailable(what: &str) -> Refusal {
    Refusal::Unavailable(format!("member directory: {what}"))
}

/// `GET /service/v1/component-directory/bindings/{binding}/members`.
pub(crate) async fn members(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    Path(binding): Path<Uuid>,
) -> Response {
    match directory(&state, &headers, binding).await {
        Ok(body) => {
            tracing::info!(%binding, "成员目录已读取");
            (
                [(axum::http::header::CACHE_CONTROL, "no-store")],
                Json(body),
            )
                .into_response()
        }
        Err(error) => {
            tracing::info!(%binding, reason = ?error.reason(), "成员目录读取被拒绝或不可用");
            error.respond(None)
        }
    }
}

#[derive(sqlx::FromRow)]
struct Entry {
    tenant_id: Uuid,
    workspace_id: Option<Uuid>,
    tenant_name: String,
    client: Option<String>,
    adapter_client: Option<String>,
    manifest: Value,
}

/// The binding facts the read depends on, re-read inside the snapshot.
async fn entry(conn: &mut PgConnection, binding: Uuid) -> Result<Option<Entry>, Refusal> {
    Ok(sqlx::query_as(
        "select b.tenant_id,b.workspace_id,t.name as tenant_name,
           b.normalized_config->>'directoryClientId' as client,
           b.normalized_config->>'client_id' as adapter_client,r.manifest
         from catalog.application_binding b
         join identity.tenant t on t.id=b.tenant_id and t.state='ACTIVE'
         join catalog.component_release r on r.id=b.component_release_id and r.status='APPROVED'
         join projection.application_runtime p on p.binding_id=b.id
           and p.generation=b.active_projection_generation and p.component_release_id=r.id
           and p.state='ACTIVE'
         left join identity.workspace w on w.id=b.workspace_id and w.tenant_id=b.tenant_id
         where b.id=$1 and b.state='ACTIVE' and b.active_projection_generation>0
           and (b.workspace_id is null or w.state='ACTIVE')",
    )
    .bind(binding)
    .fetch_optional(&mut *conn)
    .await?)
}

/// A directory client is one IdP client id segment that is nobody else's:
/// not this binding's adapter client, not Core's own service client.
fn directory_client<'a>(entry: &'a Entry, core_client: Option<&str>) -> Result<&'a str, Refusal> {
    let client = entry.client.as_deref().ok_or_else(denied)?;
    let segment = (1..=255).contains(&client.len())
        && client
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'));
    if !segment
        || entry.manifest["frontendDelivery"]["mode"] != "NATIVE_PAGE"
        || entry.adapter_client.as_deref() == Some(client)
        || core_client == Some(client)
    {
        return Err(denied());
    }
    Ok(client)
}

fn bearer(headers: &HeaderMap) -> Result<&str, Refusal> {
    let mut authorization = headers.get_all(axum::http::header::AUTHORIZATION).iter();
    let header = authorization
        .next()
        .and_then(|value| value.to_str().ok())
        .ok_or_else(denied)?;
    if authorization.next().is_some() {
        return Err(denied());
    }
    Ok(header)
}

#[derive(sqlx::FromRow)]
struct MemberRow {
    principal_id: Uuid,
    fallback_name: String,
    pubkey: Option<String>,
}

/// Everything the snapshot reads from the database, in one consistent view.
struct Facts {
    tenant: (Uuid, String),
    scope_workspace: Option<Uuid>,
    workspaces: Vec<(Uuid, String)>,
    members: Vec<MemberRow>,
    identities: HashMap<Uuid, Vec<(String, String)>>,
    memberships: HashMap<Uuid, Vec<Uuid>>,
}

async fn facts(conn: &mut PgConnection, entry: &Entry) -> Result<Facts, Refusal> {
    let tenant = entry.tenant_id;
    let scope = entry.workspace_id;
    let members: Vec<MemberRow> = sqlx::query_as(
        "select p.id as principal_id,hi.display_name as fallback_name,
           (select min(b.pubkey) from identity.buzz_identity_binding b
             where b.tenant_id=$1 and b.principal_id=p.id and b.kind='HUMAN'
               and b.custody='SERVER' and b.state='ACTIVE') as pubkey
         from identity.principal p
         join identity.tenant_membership tm on tm.tenant_principal_id=p.id
           and tm.tenant_id=$1 and tm.state='ACTIVE'
         join identity.human_identity hi on hi.id=tm.human_identity_id and hi.status='ACTIVE'
         where p.tenant_id=$1 and p.kind='HUMAN' and p.status='ACTIVE'
         order by p.id",
    )
    .bind(tenant)
    .fetch_all(&mut *conn)
    .await?;
    let rows: Vec<(Uuid, String, String)> = sqlx::query_as(
        "select tm.tenant_principal_id,ei.issuer,ei.subject
         from identity.tenant_membership tm
         join identity.external_identity ei on ei.human_identity_id=tm.human_identity_id
           and ei.status='ACTIVE'
         where tm.tenant_id=$1 and tm.state='ACTIVE'",
    )
    .bind(tenant)
    .fetch_all(&mut *conn)
    .await?;
    let mut identities: HashMap<Uuid, Vec<(String, String)>> = HashMap::new();
    for (principal, issuer, subject) in rows {
        identities
            .entry(principal)
            .or_default()
            .push((issuer, subject));
    }
    let workspaces: Vec<(Uuid, String)> = sqlx::query_as(
        "select id,name from identity.workspace
         where tenant_id=$1 and state='ACTIVE' and ($2::uuid is null or id=$2) order by id",
    )
    .bind(tenant)
    .bind(scope)
    .fetch_all(&mut *conn)
    .await?;
    let rows: Vec<(Uuid, Uuid)> = sqlx::query_as(
        "select wm.tenant_principal_id,wm.workspace_id from identity.workspace_membership wm
         join identity.workspace w on w.id=wm.workspace_id and w.tenant_id=$1 and w.state='ACTIVE'
         where wm.state='ACTIVE' and ($2::uuid is null or wm.workspace_id=$2)",
    )
    .bind(tenant)
    .bind(scope)
    .fetch_all(&mut *conn)
    .await?;
    let mut memberships: HashMap<Uuid, Vec<Uuid>> = HashMap::new();
    for (principal, workspace) in rows {
        memberships.entry(principal).or_default().push(workspace);
    }
    Ok(Facts {
        tenant: (tenant, entry.tenant_name.clone()),
        scope_workspace: scope,
        workspaces,
        members,
        identities,
        memberships,
    })
}

/// SpiceDB conclusions for one snapshot (fully consistent, all-or-nothing).
#[derive(Default)]
struct Roles {
    /// Principals with `discover` on the binding's Workspace (unused for a
    /// Tenant-scoped binding, whose scope is TenantMembership itself).
    in_scope: HashSet<Uuid>,
    tenant_admins: HashSet<Uuid>,
    workspace_admins: HashSet<(Uuid, Uuid)>,
}

async fn roles(state: &ServiceState, facts: &Facts) -> Result<Roles, Refusal> {
    let tenant = facts.tenant.0.to_string();
    let principals: Vec<String> = facts
        .members
        .iter()
        .map(|m| m.principal_id.to_string())
        .collect();
    let scope = facts.scope_workspace.map(|w| w.to_string());
    let pairs: Vec<(Uuid, Uuid, String, String)> = facts
        .members
        .iter()
        .flat_map(|m| {
            facts
                .memberships
                .get(&m.principal_id)
                .into_iter()
                .flatten()
                .map(|w| {
                    (
                        m.principal_id,
                        *w,
                        w.to_string(),
                        m.principal_id.to_string(),
                    )
                })
        })
        .collect();
    let mut items: Vec<BulkCheck<'_>> = Vec::new();
    if let Some(workspace) = scope.as_deref() {
        items.extend(principals.iter().map(|principal| BulkCheck {
            object_type: "workspace",
            object_id: workspace,
            permission: "discover",
            principal,
        }));
    }
    items.extend(principals.iter().map(|principal| BulkCheck {
        object_type: "tenant",
        object_id: &tenant,
        permission: "manage",
        principal,
    }));
    items.extend(pairs.iter().map(|(_, _, workspace, principal)| BulkCheck {
        object_type: "workspace",
        object_id: workspace,
        permission: "manage",
        principal,
    }));
    let allowed = state
        .governance
        .spicedb
        .check_bulk_principals(&items)
        .await
        .map_err(|_| unavailable("authorization"))?;
    if allowed.len() != items.len() {
        return Err(unavailable("authorization"));
    }
    let mut results = allowed.into_iter();
    let mut roles = Roles::default();
    if scope.is_some() {
        for member in &facts.members {
            if results.next() == Some(true) {
                roles.in_scope.insert(member.principal_id);
            }
        }
    }
    for member in &facts.members {
        if results.next() == Some(true) {
            roles.tenant_admins.insert(member.principal_id);
        }
    }
    for (principal, workspace, _, _) in &pairs {
        if results.next() == Some(true) {
            roles.workspace_admins.insert((*principal, *workspace));
        }
    }
    Ok(roles)
}

/// The members' current kind:0 profiles, read as the Tenant CONTROL identity.
async fn profiles(
    state: &ServiceState,
    tenant: Uuid,
    authors: Vec<String>,
) -> Result<HashMap<String, nostr::Event>, Refusal> {
    if authors.is_empty() {
        return Ok(HashMap::new());
    }
    let (client, _) = crate::tenant_lifecycle::control_client(
        state,
        tenant,
        crate::tenant_lifecycle::ProjectionDirection::Establish,
    )
    .await
    .map_err(|_| unavailable("relay identity"))?;
    let mut profiles = HashMap::new();
    for chunk in authors.chunks(RELAY_AUTHORS_PER_QUERY) {
        let filters: Vec<Value> = chunk
            .iter()
            .map(|author| json!({"kinds":[0], "authors":[author], "limit":1}))
            .collect();
        let value = client
            .query(&state.http, &filters)
            .await
            .map_err(|_| unavailable("relay"))?;
        profiles.extend(
            crate::web_profile::author_events(value, chunk).map_err(|_| unavailable("relay"))?,
        );
    }
    Ok(profiles)
}

/// The Kailo display name: kind:0 `display_name`, else `name`, else the
/// HumanIdentity display name. Blank values do not count.
fn display_name(profile: Option<&nostr::Event>, fallback: &str) -> String {
    let content = profile
        .and_then(|event| serde_json::from_str::<Value>(&event.content).ok())
        .unwrap_or(Value::Null);
    ["display_name", "name"]
        .iter()
        .filter_map(|key| content.get(key).and_then(Value::as_str))
        .map(str::trim)
        .find(|value| !value.is_empty())
        .unwrap_or(fallback.trim())
        .to_owned()
}

/// The deployment's public origin, the host of the 07 §4.7.3 Tenant avatar route.
pub(crate) fn public_origin() -> Option<String> {
    std::env::var("PUBLIC_ORIGIN")
        .ok()
        .and_then(|value| crate::application_page::origin(&value).ok())
}

/// DD-139: the Tenant avatar address for a member's first ACTIVE external subject, when the
/// deployment declares its public origin; otherwise no address (the client keeps initials).
pub(crate) fn member_picture(subject: Option<&str>) -> Option<String> {
    let subject = subject?;
    Some(avatar_url(&public_origin()?, subject))
}

/// Same encoding as the bootstrap's `urllib.parse.quote(subject, safe="")`,
/// so the directory `picture` equals the IdP `picture` claim byte for byte.
pub(crate) fn avatar_url(public_origin: &str, subject: &str) -> String {
    let mut path = String::with_capacity(subject.len());
    for byte in subject.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            path.push(char::from(byte));
        } else {
            path.push_str(&format!("%{byte:02X}"));
        }
    }
    format!("{public_origin}/api/v1/identity/avatars/{path}")
}

/// One member as the snapshot states it.
struct Member {
    principal: Uuid,
    display_name: String,
    identities: Vec<(String, String)>,
    tenant_admin: bool,
    workspaces: Vec<(Uuid, bool)>,
}

fn role(admin: bool) -> &'static str {
    if admin {
        ADMIN
    } else {
        MEMBER
    }
}

/// Deterministic snapshot: every list is sorted, so the same facts always give
/// the same `directoryVersion` (the canonical digest of everything else).
/// A member without an ACTIVE external identity cannot sign in to the
/// component and is left out.
fn snapshot(
    binding: Uuid,
    tenant: &(Uuid, String),
    workspaces: &[(Uuid, String)],
    members: Vec<Member>,
    public_origin: &str,
) -> Value {
    let workspaces: BTreeMap<Uuid, &str> = workspaces
        .iter()
        .map(|(id, name)| (*id, name.as_str()))
        .collect();
    let mut members: Vec<Member> = members
        .into_iter()
        .filter(|m| !m.identities.is_empty())
        .collect();
    members.sort_by_key(|m| m.principal);
    let members: Vec<Value> = members
        .into_iter()
        .map(|mut m| {
            m.identities.sort();
            m.identities.dedup();
            m.workspaces.retain(|(w, _)| workspaces.contains_key(w));
            m.workspaces.sort();
            m.workspaces.dedup_by_key(|(w, _)| *w);
            json!({
                "principalId": m.principal,
                "displayName": m.display_name,
                "tenantRole": role(m.tenant_admin),
                "identities": m.identities.iter().map(|(issuer, subject)| json!({
                    "issuer": issuer, "subject": subject,
                    "picture": avatar_url(public_origin, subject),
                })).collect::<Vec<_>>(),
                "workspaces": m.workspaces.iter().map(|(w, admin)| json!({
                    "workspaceId": w, "role": role(*admin),
                })).collect::<Vec<_>>(),
            })
        })
        .collect();
    let mut body = json!({
        "bindingId": binding,
        "tenant": {"tenantId": tenant.0, "name": tenant.1},
        "workspaces": workspaces.iter().map(|(id, name)| json!({"workspaceId": id, "name": name}))
            .collect::<Vec<_>>(),
        "members": members,
    });
    body["directoryVersion"] = json!(collab_bridge::limits::canonical_digest(&body));
    body
}

async fn directory(
    state: &ServiceState,
    headers: &HeaderMap,
    binding: Uuid,
) -> Result<Value, Refusal> {
    let header = bearer(headers)?;
    let public_origin = public_origin().ok_or_else(|| unavailable("PUBLIC_ORIGIN"))?;
    let core_client = std::env::var("OIDC_SERVICE_CLIENT_ID").ok();

    // One read-only snapshot for every database fact; no row locks are held
    // while the token is verified or SpiceDB and the Relay are read.
    let mut tx = state.pool.begin().await?;
    sqlx::query("set transaction isolation level repeatable read, read only")
        .execute(&mut *tx)
        .await?;
    let entry = entry(&mut tx, binding).await?.ok_or_else(denied)?;
    let client = directory_client(&entry, core_client.as_deref())?.to_owned();
    let holders: i64 = sqlx::query_scalar(
        "select count(*) from catalog.application_binding
         where state<>'DISABLED' and (normalized_config->>'directoryClientId'=$1
           or normalized_config->>'client_id'=$1)",
    )
    .bind(&client)
    .fetch_one(&mut *tx)
    .await?;
    if holders != 1 {
        return Err(denied());
    }
    state
        .auth
        .verify_binding_client(Some(header), &client)
        .await
        .map_err(|error| match error {
            crate::service_auth::ServiceAuthError::KeysUnavailable => unavailable("identity keys"),
            _ => denied(),
        })?;
    let facts = facts(&mut tx, &entry).await?;
    tx.commit().await?;

    let roles = roles(state, &facts).await?;
    let in_scope =
        |principal: &Uuid| facts.scope_workspace.is_none() || roles.in_scope.contains(principal);
    let authors: Vec<String> = facts
        .members
        .iter()
        .filter(|m| in_scope(&m.principal_id))
        .filter_map(|m| m.pubkey.clone())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();
    let profiles = profiles(state, facts.tenant.0, authors).await?;
    let members = facts
        .members
        .iter()
        .filter(|m| in_scope(&m.principal_id))
        .map(|m| Member {
            principal: m.principal_id,
            display_name: display_name(
                m.pubkey.as_ref().and_then(|key| profiles.get(key)),
                &m.fallback_name,
            ),
            identities: facts
                .identities
                .get(&m.principal_id)
                .cloned()
                .unwrap_or_default(),
            tenant_admin: roles.tenant_admins.contains(&m.principal_id),
            workspaces: facts
                .memberships
                .get(&m.principal_id)
                .into_iter()
                .flatten()
                .map(|w| (*w, roles.workspace_admins.contains(&(m.principal_id, *w))))
                .collect(),
        })
        .collect();
    let body = snapshot(
        binding,
        &facts.tenant,
        &facts.workspaces,
        members,
        &public_origin,
    );
    // The wire shape is the contract (ADR-03): refuse rather than send drift.
    let typed: contracts::ComponentMemberDirectory =
        serde_json::from_value(body.clone()).map_err(|_| unavailable("contract"))?;
    if serde_json::to_value(&typed).map_err(|_| unavailable("contract"))? != body {
        return Err(unavailable("contract"));
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn member(principal: Uuid, subjects: &[&str], admin: bool, ws: &[(Uuid, bool)]) -> Member {
        Member {
            principal,
            display_name: format!("name-{principal}"),
            identities: subjects
                .iter()
                .map(|s| ("https://idp.test/realms/kailo".to_owned(), (*s).to_owned()))
                .collect(),
            tenant_admin: admin,
            workspaces: ws.to_vec(),
        }
    }

    #[test]
    fn snapshot_is_deterministic_and_versioned_by_content() {
        let binding = Uuid::new_v4();
        let tenant = (Uuid::new_v4(), "Acme".to_owned());
        let (w1, w2) = (Uuid::new_v4(), Uuid::new_v4());
        let workspaces = vec![(w1, "A".to_owned()), (w2, "B".to_owned())];
        let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
        let build = |order: bool, admin: bool| {
            let mut members = vec![
                member(a, &["sub-a"], admin, &[(w2, false), (w1, true)]),
                member(b, &["sub-b2", "sub-b1"], false, &[]),
            ];
            if order {
                members.reverse();
            }
            let mut ws = workspaces.clone();
            if order {
                ws.reverse();
            }
            snapshot(binding, &tenant, &ws, members, "https://kailo.test")
        };
        let first = build(false, true);
        assert_eq!(
            first,
            build(true, true),
            "input order must not change the snapshot"
        );
        let version = first["directoryVersion"].as_str().unwrap().to_owned();
        assert_eq!(version.len(), 64);
        let mut without = first.clone();
        without.as_object_mut().unwrap().remove("directoryVersion");
        assert_eq!(version, collab_bridge::limits::canonical_digest(&without));
        // A role change is a content change, hence a new version.
        assert_ne!(
            build(false, false)["directoryVersion"],
            first["directoryVersion"]
        );
        let members = first["members"].as_array().unwrap();
        let ada = members
            .iter()
            .find(|m| m["principalId"] == json!(a))
            .unwrap();
        assert_eq!(ada["tenantRole"], ADMIN);
        let ws: Vec<_> = ada["workspaces"].as_array().unwrap().clone();
        let mut expected = vec![
            json!({"workspaceId": w1, "role": ADMIN}),
            json!({"workspaceId": w2, "role": MEMBER}),
        ];
        expected.sort_by_key(|v| v["workspaceId"].as_str().unwrap().to_owned());
        assert_eq!(ws, expected);
        let bob = members
            .iter()
            .find(|m| m["principalId"] == json!(b))
            .unwrap();
        assert_eq!(bob["tenantRole"], MEMBER);
        assert_eq!(bob["identities"][0]["subject"], "sub-b1");
        assert_eq!(
            bob["identities"][0]["picture"],
            "https://kailo.test/api/v1/identity/avatars/sub-b1"
        );
    }

    #[test]
    fn snapshot_leaves_out_unreachable_people_and_foreign_workspaces() {
        let binding = Uuid::new_v4();
        let tenant = (Uuid::new_v4(), "Acme".to_owned());
        let scope = Uuid::new_v4();
        let foreign = Uuid::new_v4();
        let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
        let body = snapshot(
            binding,
            &tenant,
            &[(scope, "Scope".to_owned())],
            vec![
                member(a, &["sub-a"], false, &[(scope, false), (foreign, true)]),
                // No ACTIVE external identity: cannot sign in to the component.
                member(b, &[], true, &[(scope, true)]),
            ],
            "https://kailo.test",
        );
        let members = body["members"].as_array().unwrap();
        assert_eq!(members.len(), 1);
        assert_eq!(members[0]["principalId"], json!(a));
        assert_eq!(
            members[0]["workspaces"],
            json!([{"workspaceId": scope, "role": MEMBER}])
        );
        assert_eq!(
            body["workspaces"],
            json!([{"workspaceId": scope, "name": "Scope"}])
        );
        assert_eq!(
            body["tenant"],
            json!({"tenantId": tenant.0, "name": "Acme"})
        );
        let text = body.to_string();
        for forbidden in ["email", "pubkey", "token", "secret"] {
            assert!(
                !text.contains(forbidden),
                "{forbidden} leaked into the directory"
            );
        }
    }

    #[test]
    fn picture_matches_the_bootstrap_claim_encoding() {
        assert_eq!(
            avatar_url("https://k.test", "0f8e-uuid_like.~x"),
            "https://k.test/api/v1/identity/avatars/0f8e-uuid_like.~x"
        );
        assert_eq!(
            avatar_url("https://k.test", "a/b c%"),
            "https://k.test/api/v1/identity/avatars/a%2Fb%20c%25"
        );
    }

    #[test]
    fn display_name_prefers_kind0_then_falls_back() {
        let keys = nostr::Keys::generate();
        let event = |content: &str| {
            nostr::EventBuilder::new(nostr::Kind::Metadata, content)
                .sign_with_keys(&keys)
                .unwrap()
        };
        let both = event(r#"{"display_name":" Ada L ","name":"ada"}"#);
        assert_eq!(display_name(Some(&both), "fallback"), "Ada L");
        let name_only = event(r#"{"display_name":"  ","name":"ada"}"#);
        assert_eq!(display_name(Some(&name_only), "fallback"), "ada");
        let empty = event("{}");
        assert_eq!(display_name(Some(&empty), " Fallback "), "Fallback");
        assert_eq!(display_name(None, "Fallback"), "Fallback");
    }

    fn entry(client: Option<&str>, adapter: Option<&str>, mode: &str) -> Entry {
        Entry {
            tenant_id: Uuid::new_v4(),
            workspace_id: None,
            tenant_name: "Acme".into(),
            client: client.map(str::to_owned),
            adapter_client: adapter.map(str::to_owned),
            manifest: json!({"frontendDelivery": {"mode": mode}}),
        }
    }

    #[test]
    fn directory_client_is_an_own_segment_on_a_native_page_entry() {
        assert_eq!(
            directory_client(
                &entry(Some("cells-directory"), None, "NATIVE_PAGE"),
                Some("core")
            )
            .ok(),
            Some("cells-directory")
        );
        for (refused, core) in [
            (entry(None, None, "NATIVE_PAGE"), None),
            (entry(Some(""), None, "NATIVE_PAGE"), None),
            (entry(Some("a b"), None, "NATIVE_PAGE"), None),
            (entry(Some("x/y"), None, "NATIVE_PAGE"), None),
            (entry(Some("dir"), None, "NONE"), None),
            (entry(Some("dir"), None, "SOURCE_BOUND_PROTOCOL"), None),
            (entry(Some("dir"), Some("dir"), "NATIVE_PAGE"), None),
            (entry(Some("core"), None, "NATIVE_PAGE"), Some("core")),
        ] {
            assert!(directory_client(&refused, core).is_err());
        }
        let long = "a".repeat(256);
        assert!(directory_client(&entry(Some(&long), None, "NATIVE_PAGE"), None).is_err());
    }

    #[test]
    fn bearer_must_be_single() {
        let mut headers = HeaderMap::new();
        assert!(bearer(&headers).is_err());
        headers.append(
            axum::http::header::AUTHORIZATION,
            "Bearer a".parse().unwrap(),
        );
        assert_eq!(bearer(&headers).ok(), Some("Bearer a"));
        headers.append(
            axum::http::header::AUTHORIZATION,
            "Bearer b".parse().unwrap(),
        );
        assert!(bearer(&headers).is_err());
    }

    /// The database half of V-SCN-218 against a disposable migrated database:
    /// only ACTIVE HUMAN members of this Tenant with ACTIVE identities, only
    /// ACTIVE Workspaces in scope, and the SERVER HUMAN key for kind:0.
    #[tokio::test]
    #[ignore = "requires COMPONENT_DIRECTORY_TEST_DATABASE_URL pointing at a disposable migrated database"]
    async fn facts_read_only_active_humans_of_the_binding_scope() {
        use sqlx::Connection;
        let mut conn = sqlx::PgConnection::connect(
            &std::env::var("COMPONENT_DIRECTORY_TEST_DATABASE_URL").expect("isolated database URL"),
        )
        .await
        .unwrap();
        let mut tx = conn.begin().await.unwrap();
        let provider = Uuid::new_v4();
        let issuer = format!("urn:fixture:{provider}");
        sqlx::query("insert into identity.identity_provider(id,issuer,client_id,claim_mapping_version,status) values($1,$2,'fixture-directory',1,'ACTIVE')")
            .bind(provider).bind(&issuer).execute(&mut *tx).await.unwrap();
        let (tenant, foreign) = (Uuid::new_v4(), Uuid::new_v4());
        for id in [tenant, foreign] {
            sqlx::query("insert into identity.tenant(id,slug,name,state) values($1,$2,'Directory fixture','ACTIVE')")
                .bind(id).bind(id.to_string()).execute(&mut *tx).await.unwrap();
        }
        let (active_ws, suspended_ws) = (Uuid::new_v4(), Uuid::new_v4());
        for (id, state) in [(active_ws, "ACTIVE"), (suspended_ws, "SUSPENDED")] {
            sqlx::query("insert into identity.workspace(id,tenant_id,slug,name,state) values($1,$2,$3,'Fixture WS',$4)")
                .bind(id).bind(tenant).bind(id.to_string()).bind(state).execute(&mut *tx).await.unwrap();
        }
        // (tenant, principal kind, membership state, human status, identity status)
        let people = [
            (tenant, "HUMAN", "ACTIVE", "ACTIVE", "ACTIVE"), // listed
            (tenant, "HUMAN", "REVOKED", "ACTIVE", "ACTIVE"), // removed from the Tenant
            (tenant, "HUMAN", "ACTIVE", "DISABLED", "ACTIVE"), // disabled person
            (tenant, "AGENT", "ACTIVE", "ACTIVE", "ACTIVE"), // not a human
            (tenant, "HUMAN", "ACTIVE", "ACTIVE", "DISABLED"), // listed, no identity
            (foreign, "HUMAN", "ACTIVE", "ACTIVE", "ACTIVE"), // other Tenant
        ];
        let mut principals = Vec::new();
        for (owner, kind, membership, human_status, identity_status) in people {
            let (human, principal) = (Uuid::new_v4(), Uuid::new_v4());
            sqlx::query("insert into identity.human_identity(id,display_name,status) values($1,'Fixture Person',$2)")
                .bind(human).bind(human_status).execute(&mut *tx).await.unwrap();
            sqlx::query("insert into identity.external_identity(id,provider_id,issuer,subject,human_identity_id,status) values($1,$2,$3,$4,$5,$6)")
                .bind(Uuid::new_v4()).bind(provider).bind(&issuer).bind(human.to_string()).bind(human).bind(identity_status)
                .execute(&mut *tx).await.unwrap();
            sqlx::query("insert into identity.principal(id,tenant_id,kind,status) values($1,$2,$3,'ACTIVE')")
                .bind(principal).bind(owner).bind(kind).execute(&mut *tx).await.unwrap();
            sqlx::query("insert into identity.tenant_membership(id,tenant_id,human_identity_id,tenant_principal_id,state) values($1,$2,$3,$4,$5)")
                .bind(Uuid::new_v4()).bind(owner).bind(human).bind(principal).bind(membership)
                .execute(&mut *tx).await.unwrap();
            principals.push((principal, human));
        }
        let listed = principals[0].0;
        for (workspace, state) in [(active_ws, "ACTIVE"), (suspended_ws, "ACTIVE")] {
            sqlx::query("insert into identity.workspace_membership(id,workspace_id,tenant_principal_id,state) values($1,$2,$3,$4)")
                .bind(Uuid::new_v4()).bind(workspace).bind(listed).bind(state).execute(&mut *tx).await.unwrap();
        }
        sqlx::query("insert into identity.workspace_membership(id,workspace_id,tenant_principal_id,state) values($1,$2,$3,'REVOKED')")
            .bind(Uuid::new_v4()).bind(active_ws).bind(principals[4].0).execute(&mut *tx).await.unwrap();
        let pubkey = nostr::Keys::generate().public_key().to_hex();
        sqlx::query("insert into identity.buzz_identity_binding
             (tenant_id,principal_id,pubkey,custody,private_key_secret_ref,private_key_secret_version,
              private_key_secret_audience,private_key_secret_status,kind,state)
             values($1,$2,$3,'SERVER','fixture/directory',1,'fixture','ACTIVE','HUMAN','ACTIVE')")
            .bind(tenant).bind(listed).bind(&pubkey).execute(&mut *tx).await.unwrap();

        let entry = |workspace_id| Entry {
            tenant_id: tenant,
            workspace_id,
            tenant_name: "Directory fixture".into(),
            client: Some("fixture-directory".into()),
            adapter_client: None,
            manifest: json!({"frontendDelivery": {"mode": "NATIVE_PAGE"}}),
        };
        let all = facts(&mut tx, &entry(None)).await.unwrap();
        let mut members: Vec<Uuid> = all.members.iter().map(|m| m.principal_id).collect();
        members.sort();
        let mut expected = vec![listed, principals[4].0];
        expected.sort();
        assert_eq!(
            members, expected,
            "only ACTIVE HUMAN members of this Tenant"
        );
        let row = all
            .members
            .iter()
            .find(|m| m.principal_id == listed)
            .unwrap();
        assert_eq!(row.pubkey.as_deref(), Some(pubkey.as_str()));
        assert_eq!(row.fallback_name, "Fixture Person");
        assert_eq!(
            all.identities.get(&listed),
            Some(&vec![(issuer.clone(), principals[0].1.to_string())])
        );
        assert!(
            !all.identities.contains_key(&principals[4].0),
            "DISABLED identity listed"
        );
        assert_eq!(all.workspaces, vec![(active_ws, "Fixture WS".to_owned())]);
        assert_eq!(all.memberships.get(&listed), Some(&vec![active_ws]));
        assert!(
            !all.memberships.contains_key(&principals[4].0),
            "REVOKED membership listed"
        );
        let scoped = facts(&mut tx, &entry(Some(active_ws))).await.unwrap();
        assert_eq!(scoped.scope_workspace, Some(active_ws));
        assert_eq!(scoped.workspaces.len(), 1);
        tx.rollback().await.unwrap();
    }
}
