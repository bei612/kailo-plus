//! DD-125 additions to CollaborationUserState（`.design/03` §2、`DD-40`）。
//!
//! Original Buzz `779af8886caae1317b4de962082429867ab61503` kept these personal
//! preferences per device or per public key: thread follows in localStorage
//! (`useThreadFollows.ts`, 500 entries), thread mutes in `unreadMembership.ts`,
//! custom sidebar sections and group sort in NIP-44 kind:30078
//! (`channelSectionsStorage.ts`, `channelSortPreference.ts`), channel templates in
//! a Desktop file (`templates/types.rs::ChannelTemplateRecord`) and Pulse follows
//! as a whole-list kind 3 per public key. Kailo keeps the original interactions but
//! stores all of them in the one per-HUMAN CollaborationUserState with the shared
//! version CAS, so Web, Desktop and Mobile agree (DD-40) and a Principal with
//! several device keys (DD-77) has one follow list.
//!
//! None of these writes is a Governed Action, none grants a permission, and
//! entries whose key loses eligibility are kept but not presented, exactly like
//! the existing project preferences.

use std::collections::{BTreeMap, HashMap, HashSet};

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use contracts::{
    ChannelTemplateRequest, ChannelType, ErrorClass, FollowedPrincipalRequest, ReasonCode,
    SidebarAssignmentRequest, SidebarSectionOrderRequest, SidebarSectionRequest, SidebarSortMode,
    SidebarSortRequest, ThreadPreferenceRequest, UserStateVersion, WorkspaceVisibility,
};
use nostr::EventId;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::bff::{resolve_execution_context, BffState, ExecutionContext};
use crate::user_state::{
    readable_event_ids, require_visible_channel, stored_version, user_state_unavailable,
};
use crate::web_transport::error_body;

/// Original `useThreadFollows.ts::MAX_ENTRIES`, applied to the whole per-person list.
pub(crate) const MAX_THREAD_PREFERENCES: usize = 500;
/// Original `channelSectionsStorage.ts::MAX_CHANNEL_SECTIONS`.
pub(crate) const MAX_SIDEBAR_SECTIONS: usize = 100;
/// Original `channelSectionsStorage.ts::MAX_CHANNEL_SECTION_ASSIGNMENTS`.
pub(crate) const MAX_SIDEBAR_ASSIGNMENTS: usize = 1_000;
/// Original `channelSortPreference.ts::MAX_CHANNEL_SORT_GROUPS`.
pub(crate) const MAX_SIDEBAR_SORT_GROUPS: usize = 104;
/// DD-125(4): at most 200 personal templates.
pub(crate) const MAX_CHANNEL_TEMPLATES: usize = 200;
/// DD-125(4): the canvas template is bounded like a channel Canvas (40100, 64 KiB).
pub(crate) const MAX_CANVAS_TEMPLATE_BYTES: usize = 64 * 1024;
/// Server-side bound for free-text names, icons and descriptions; the original
/// local stores had none, but this document is shared state on the platform.
const MAX_TEXT_BYTES: usize = 4 * 1024;
const FIXED_SORT_GROUPS: [&str; 4] = ["starred", "channels", "forums", "dms"];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum ThreadState {
    Followed,
    Muted,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ThreadPreference {
    pub state: ThreadState,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SidebarSection {
    pub id: Uuid,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    pub order: i64,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SidebarSections {
    pub sections: Vec<SidebarSection>,
    /// Native Buzz channel ID -> section ID (original `assignments`).
    pub assignments: BTreeMap<Uuid, Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SidebarSort {
    pub mode: SidebarSortMode,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChannelTemplate {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub channel_type: ChannelType,
    pub visibility: WorkspaceVisibility,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub canvas_template: Option<String>,
    pub agent_resource_ids: Vec<Uuid>,
    pub updated_at: String,
}

/// The five DD-125 columns, typed. A shape the writer never produces makes the
/// whole state unavailable instead of silently presenting a partial document.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct CollabState {
    pub threads: BTreeMap<String, ThreadPreference>,
    pub sections: SidebarSections,
    pub sort: BTreeMap<String, SidebarSort>,
    pub templates: BTreeMap<Uuid, ChannelTemplate>,
    pub followed: BTreeMap<Uuid, String>,
}

#[derive(sqlx::FromRow)]
pub(crate) struct CollabColumns {
    pub thread_preferences: serde_json::Value,
    pub sidebar_sections: serde_json::Value,
    pub sidebar_sort: serde_json::Value,
    pub channel_templates: serde_json::Value,
    pub followed_principals: serde_json::Value,
}

impl CollabColumns {
    pub(crate) fn parse(self) -> Option<CollabState> {
        Some(CollabState {
            threads: serde_json::from_value(self.thread_preferences).ok()?,
            sections: serde_json::from_value(self.sidebar_sections).ok()?,
            sort: serde_json::from_value(self.sidebar_sort).ok()?,
            templates: serde_json::from_value(self.channel_templates).ok()?,
            followed: serde_json::from_value(self.followed_principals).ok()?,
        })
    }
}

/// A rejected preference write. Mapped to the existing reason codes only (DD-125(7)).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Reject {
    Invalid,
    NotFound,
    TooLarge,
}

impl Reject {
    fn response(self) -> Response {
        match self {
            Self::Invalid => error_body(
                StatusCode::BAD_REQUEST,
                ErrorClass::Precondition,
                ReasonCode::InvalidParameters,
                None,
            ),
            Self::NotFound => error_body(
                StatusCode::NOT_FOUND,
                ErrorClass::Precondition,
                ReasonCode::TargetNotFound,
                None,
            ),
            Self::TooLarge => error_body(
                StatusCode::PAYLOAD_TOO_LARGE,
                ErrorClass::Limit,
                ReasonCode::PayloadTooLarge,
                None,
            ),
        }
    }
}

fn bounded_text(value: &str) -> Result<String, Reject> {
    let value = value.trim();
    if value.is_empty() {
        return Err(Reject::Invalid);
    }
    if value.len() > MAX_TEXT_BYTES {
        return Err(Reject::TooLarge);
    }
    Ok(value.to_owned())
}

fn optional_text(value: Option<&str>) -> Result<Option<String>, Reject> {
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) => bounded_text(value).map(Some),
        None => Ok(None),
    }
}

/// `thread:<root event id>` in canonical lowercase hex.
pub(crate) fn thread_root(key: &str) -> Option<EventId> {
    let id = key.strip_prefix("thread:")?;
    let parsed = EventId::from_hex(id).ok()?;
    (parsed.to_hex() == id).then_some(parsed)
}

fn timestamp(value: &str) -> Option<chrono::DateTime<chrono::FixedOffset>> {
    chrono::DateTime::parse_from_rfc3339(value).ok()
}

fn oldest(
    threads: &BTreeMap<String, ThreadPreference>,
    keep: &str,
    state: ThreadState,
) -> Option<String> {
    threads
        .iter()
        .filter(|(key, preference)| key.as_str() != keep && preference.state == state)
        .min_by_key(|(key, preference)| (timestamp(&preference.updated_at), (*key).clone()))
        .map(|(key, _)| key.clone())
}

/// Original coupling (`AppShell.tsx::handleFollowThread/handleUnfollowThread`):
/// following unmutes, unfollowing mutes. Over the cap the earliest follow is evicted
/// first, as `capEntries` did; only then the earliest mute.
pub(crate) fn apply_thread(state: &mut CollabState, key: &str, followed: bool, now: &str) {
    let preference = ThreadPreference {
        state: if followed {
            ThreadState::Followed
        } else {
            ThreadState::Muted
        },
        updated_at: now.to_owned(),
    };
    state.threads.insert(key.to_owned(), preference);
    while state.threads.len() > MAX_THREAD_PREFERENCES {
        let victim = oldest(&state.threads, key, ThreadState::Followed)
            .or_else(|| oldest(&state.threads, key, ThreadState::Muted));
        let Some(victim) = victim else {
            break;
        };
        state.threads.remove(&victim);
    }
}

pub(crate) fn upsert_section(
    state: &mut CollabState,
    id: Uuid,
    request: &SidebarSectionRequest,
    now: &str,
) -> Result<(), Reject> {
    let name = bounded_text(&request.name)?;
    let icon = optional_text(request.icon.as_deref())?;
    let section = SidebarSection {
        id,
        name,
        icon,
        order: request.order,
    };
    let sections = &mut state.sections.sections;
    match sections.iter().position(|existing| existing.id == id) {
        Some(index) => sections[index] = section,
        None if sections.len() >= MAX_SIDEBAR_SECTIONS => return Err(Reject::TooLarge),
        None => sections.push(section),
    }
    state.sections.updated_at = Some(now.to_owned());
    Ok(())
}

/// Original `deleteSection` plus `stripOrphanedSectionModes`: the section, every
/// assignment to it and its sort group go together.
pub(crate) fn delete_section(state: &mut CollabState, id: Uuid, now: &str) -> Result<(), Reject> {
    let before = state.sections.sections.len();
    state.sections.sections.retain(|section| section.id != id);
    if state.sections.sections.len() == before {
        return Err(Reject::NotFound);
    }
    state.sections.assignments.retain(|_, section| *section != id);
    state.sort.remove(&format!("section:{id}"));
    state.sections.updated_at = Some(now.to_owned());
    Ok(())
}

/// Original `reorderSections`: the request is the full new order.
pub(crate) fn reorder_sections(
    state: &mut CollabState,
    ids: &[String],
    now: &str,
) -> Result<(), Reject> {
    let ids: Vec<Uuid> = ids
        .iter()
        .map(|id| id.parse().map_err(|_| Reject::Invalid))
        .collect::<Result<_, _>>()?;
    let requested: HashSet<Uuid> = ids.iter().copied().collect();
    let current: HashSet<Uuid> = state.sections.sections.iter().map(|s| s.id).collect();
    if requested.len() != ids.len() || requested != current {
        return Err(Reject::Invalid);
    }
    for section in &mut state.sections.sections {
        let index = ids.iter().position(|id| *id == section.id);
        section.order = index.map_or(section.order, |index| index as i64);
    }
    state.sections.updated_at = Some(now.to_owned());
    Ok(())
}

/// Original `assignChannel`/`unassignChannel`. Eligibility of the channel is checked
/// by the caller against the current admission before this runs.
pub(crate) fn assign_channel(
    state: &mut CollabState,
    channel: Uuid,
    section: Option<Uuid>,
    now: &str,
) -> Result<(), Reject> {
    match section {
        Some(section) => {
            if !state.sections.sections.iter().any(|s| s.id == section) {
                return Err(Reject::NotFound);
            }
            let assignments = &mut state.sections.assignments;
            let fresh = !assignments.contains_key(&channel);
            if fresh && assignments.len() >= MAX_SIDEBAR_ASSIGNMENTS {
                return Err(Reject::TooLarge);
            }
            assignments.insert(channel, section);
        }
        None => {
            state.sections.assignments.remove(&channel);
        }
    }
    state.sections.updated_at = Some(now.to_owned());
    Ok(())
}

/// Original `ChannelSortGroupKey`: fixed groups or `section:<existing section>`.
pub(crate) fn set_sort(
    state: &mut CollabState,
    group: &str,
    mode: SidebarSortMode,
    now: &str,
) -> Result<(), Reject> {
    let fixed = FIXED_SORT_GROUPS.contains(&group);
    let section = group.strip_prefix("section:").and_then(|id| {
        let parsed = id.parse::<Uuid>().ok()?;
        (parsed.hyphenated().to_string() == id).then_some(parsed)
    });
    let known = section.is_some_and(|id| state.sections.sections.iter().any(|s| s.id == id));
    if !fixed && !known {
        return Err(Reject::Invalid);
    }
    if !state.sort.contains_key(group) && state.sort.len() >= MAX_SIDEBAR_SORT_GROUPS {
        return Err(Reject::TooLarge);
    }
    let preference = SidebarSort {
        mode,
        updated_at: now.to_owned(),
    };
    state.sort.insert(group.to_owned(), preference);
    Ok(())
}

/// Template fields are the original record's; Agent entries are AgentDefinition
/// Resource IDs already checked to be in this Tenant.
pub(crate) fn upsert_template(
    state: &mut CollabState,
    id: Uuid,
    request: &ChannelTemplateRequest,
    agents: Vec<Uuid>,
    now: &str,
) -> Result<(), Reject> {
    let name = bounded_text(&request.name)?;
    let description = optional_text(request.description.as_deref())?;
    let canvas = request
        .canvas_template
        .clone()
        .filter(|value| !value.is_empty());
    if canvas.as_deref().map_or(0, str::len) > MAX_CANVAS_TEMPLATE_BYTES {
        return Err(Reject::TooLarge);
    }
    if !state.templates.contains_key(&id) && state.templates.len() >= MAX_CHANNEL_TEMPLATES {
        return Err(Reject::TooLarge);
    }
    let template = ChannelTemplate {
        name,
        description,
        channel_type: request.channel_type.clone(),
        visibility: request.visibility.clone(),
        canvas_template: canvas,
        agent_resource_ids: agents,
        updated_at: now.to_owned(),
    };
    state.templates.insert(id, template);
    Ok(())
}

/// Requested AgentDefinition IDs, deduplicated in the original order.
fn template_agents(request: &ChannelTemplateRequest) -> Result<Vec<Uuid>, Reject> {
    let mut agents = Vec::new();
    for id in &request.agent_resource_ids {
        let id: Uuid = id.parse().map_err(|_| Reject::Invalid)?;
        if !agents.contains(&id) {
            agents.push(id);
        }
    }
    Ok(agents)
}

/// One preference change, already validated against the request and admission.
#[derive(Debug)]
pub(crate) enum Change<'a> {
    Thread(&'a str, bool),
    Section(Uuid, &'a SidebarSectionRequest),
    DeleteSection(Uuid),
    Order(&'a [String]),
    Assign(Uuid, Option<Uuid>),
    Sort(&'a str, SidebarSortMode),
    Template(Uuid, &'a ChannelTemplateRequest, Vec<Uuid>),
    DeleteTemplate(Uuid),
    Follow(Uuid, bool),
}

impl Change<'_> {
    pub(crate) fn apply(self, document: &mut CollabState, now: &str) -> Result<(), Reject> {
        match self {
            Self::Thread(key, followed) => {
                apply_thread(document, key, followed, now);
                Ok(())
            }
            Self::Section(id, request) => upsert_section(document, id, request, now),
            Self::DeleteSection(id) => delete_section(document, id, now),
            Self::Order(ids) => reorder_sections(document, ids, now),
            Self::Assign(channel, section) => assign_channel(document, channel, section, now),
            Self::Sort(group, mode) => set_sort(document, group, mode, now),
            Self::Template(id, request, agents) => {
                upsert_template(document, id, request, agents, now)
            }
            Self::DeleteTemplate(id) => match document.templates.remove(&id) {
                Some(_) => Ok(()),
                None => Err(Reject::NotFound),
            },
            Self::Follow(principal, true) => {
                let followed_at = now.to_owned();
                document.followed.entry(principal).or_insert(followed_at);
                Ok(())
            }
            Self::Follow(principal, false) => {
                document.followed.remove(&principal);
                Ok(())
            }
        }
    }
}

/// Apply `change` to the locked row and commit it with the shared version CAS.
/// A first write must hold version 0; any other mismatch is a 409, as for the
/// existing preferences. Timestamps come from the database clock.
async fn mutate(
    state: &BffState,
    ctx: &ExecutionContext,
    version: i64,
    change: Change<'_>,
) -> Response {
    let Some(expected) = stored_version(version).filter(|version| *version >= 0) else {
        return Reject::Invalid.response();
    };
    match commit(state, ctx, expected, change).await {
        Ok(Some(version)) => {
            let body = UserStateVersion {
                version: version.into(),
            };
            (StatusCode::OK, Json(body)).into_response()
        }
        Ok(None) => StatusCode::CONFLICT.into_response(),
        Err(Commit::Rejected(reject)) => reject.response(),
        Err(Commit::Malformed) => user_state_unavailable(),
        Err(Commit::Database(error)) => {
            tracing::warn!(%error, "写 DD-125 用户状态失败");
            user_state_unavailable()
        }
    }
}

enum Commit {
    Rejected(Reject),
    Malformed,
    Database(sqlx::Error),
}

impl From<sqlx::Error> for Commit {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error)
    }
}

#[derive(sqlx::FromRow)]
struct LockedRow {
    #[sqlx(flatten)]
    columns: CollabColumns,
    version: i32,
}

async fn commit(
    state: &BffState,
    ctx: &ExecutionContext,
    expected: i32,
    change: Change<'_>,
) -> Result<Option<i32>, Commit> {
    let mut tx = state.pool.begin().await?;
    let clock = sqlx::query_scalar::<_, chrono::DateTime<chrono::Utc>>("select now()");
    let now = clock.fetch_one(&mut *tx).await?;
    let now = now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let row: Option<LockedRow> = sqlx::query_as(
        "select thread_preferences, sidebar_sections, sidebar_sort, channel_templates,
                followed_principals, version
         from identity.collaboration_user_state where tenant_principal_id = $1 for update",
    )
    .bind(ctx.tenant_principal_id)
    .fetch_optional(&mut *tx)
    .await?;
    let exists = row.is_some();
    let mut document = match row {
        Some(row) if row.version == expected => row.columns.parse().ok_or(Commit::Malformed)?,
        Some(_) => return Ok(None),
        None if expected == 0 => CollabState::default(),
        None => return Ok(None),
    };
    change.apply(&mut document, &now).map_err(Commit::Rejected)?;
    let json = |value: serde_json::Result<serde_json::Value>| value.map_err(|_| Commit::Malformed);
    let threads = json(serde_json::to_value(&document.threads))?;
    let sections = json(serde_json::to_value(&document.sections))?;
    let sort = json(serde_json::to_value(&document.sort))?;
    let templates = json(serde_json::to_value(&document.templates))?;
    let followed = json(serde_json::to_value(&document.followed))?;
    let sql = if exists {
        "update identity.collaboration_user_state set
             thread_preferences = $2, sidebar_sections = $3, sidebar_sort = $4,
             channel_templates = $5, followed_principals = $6,
             version = version + 1, updated_at = now()
         where tenant_principal_id = $1 and version = $7
         returning version"
    } else {
        "insert into identity.collaboration_user_state
             (tenant_principal_id, thread_preferences, sidebar_sections, sidebar_sort,
              channel_templates, followed_principals, version, updated_at)
         select $1, $2, $3, $4, $5, $6, 1, now() where $7::integer = 0
         on conflict (tenant_principal_id) do nothing
         returning version"
    };
    let version: Option<i32> = sqlx::query_scalar(sql)
        .bind(ctx.tenant_principal_id)
        .bind(threads)
        .bind(sections)
        .bind(sort)
        .bind(templates)
        .bind(followed)
        .bind(expected)
        .fetch_optional(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(version)
}

type JsonBody<T> = Result<Json<T>, axum::extract::rejection::JsonRejection>;

/// `PUT /api/v1/user-state/threads`（DD-125(1)）. The root is re-read as the caller
/// (SERVER identity) exactly like a `thread:` read mark, and eligibility is checked
/// again after that Relay read.
pub(crate) async fn put_thread_preference(
    State(state): State<BffState>,
    headers: HeaderMap,
    body: JsonBody<ThreadPreferenceRequest>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    let Ok(Json(request)) = body else {
        return Reject::Invalid.response();
    };
    let Some(root) = thread_root(&request.thread_key) else {
        return Reject::Invalid.response();
    };
    let readable = match readable_event_ids(&state, &ctx, &HashSet::from([root])).await {
        Ok(readable) => readable,
        Err(response) => return response,
    };
    let Some((channel, is_root)) = readable.get(&root) else {
        return StatusCode::FORBIDDEN.into_response();
    };
    if !is_root {
        return StatusCode::FORBIDDEN.into_response();
    }
    let admitted = match channel {
        Some(channel) => require_visible_channel(&state, &ctx, *channel).await,
        None => crate::pulse::admit(&state, &ctx).await.map(|_| ()),
    };
    if let Err(response) = admitted {
        return response;
    }
    let change = Change::Thread(&request.thread_key, request.followed);
    mutate(&state, &ctx, request.version, change).await
}

/// `PUT /api/v1/user-state/sidebar-sections/{sectionId}`（DD-125(5)）.
pub(crate) async fn put_sidebar_section(
    State(state): State<BffState>,
    Path(section_id): Path<Uuid>,
    headers: HeaderMap,
    body: JsonBody<SidebarSectionRequest>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    let Ok(Json(request)) = body else {
        return Reject::Invalid.response();
    };
    let change = Change::Section(section_id, &request);
    mutate(&state, &ctx, request.version, change).await
}

/// `DELETE /api/v1/user-state/sidebar-sections/{sectionId}` with a `UserStateVersion` body.
pub(crate) async fn delete_sidebar_section(
    State(state): State<BffState>,
    Path(section_id): Path<Uuid>,
    headers: HeaderMap,
    body: JsonBody<UserStateVersion>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    let Ok(Json(request)) = body else {
        return Reject::Invalid.response();
    };
    let change = Change::DeleteSection(section_id);
    mutate(&state, &ctx, request.version, change).await
}

/// `PUT /api/v1/user-state/sidebar-section-order`（original `reorderSections`）.
pub(crate) async fn put_sidebar_section_order(
    State(state): State<BffState>,
    headers: HeaderMap,
    body: JsonBody<SidebarSectionOrderRequest>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    let Ok(Json(request)) = body else {
        return Reject::Invalid.response();
    };
    let change = Change::Order(&request.section_ids);
    mutate(&state, &ctx, request.version, change).await
}

/// `PUT /api/v1/user-state/sidebar-assignments`. Moving a channel into a section
/// requires the channel to be one the caller may see now (current Workspace member
/// or active private-conversation participant); removing does not, so an entry for
/// a channel that lost eligibility can still be cleaned up.
pub(crate) async fn put_sidebar_assignment(
    State(state): State<BffState>,
    headers: HeaderMap,
    body: JsonBody<SidebarAssignmentRequest>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    let Ok(Json(request)) = body else {
        return Reject::Invalid.response();
    };
    let Ok(channel) = request.channel_key.parse::<Uuid>() else {
        return Reject::Invalid.response();
    };
    let section = match request.section_id.as_deref().map(str::parse::<Uuid>) {
        Some(Ok(section)) => Some(section),
        Some(Err(_)) => return Reject::Invalid.response(),
        None => None,
    };
    if section.is_some() {
        if let Err(response) = require_visible_channel(&state, &ctx, channel).await {
            return response;
        }
    }
    let change = Change::Assign(channel, section);
    mutate(&state, &ctx, request.version, change).await
}

/// `PUT /api/v1/user-state/sidebar-sort`（original `setSortModeFor`）.
pub(crate) async fn put_sidebar_sort(
    State(state): State<BffState>,
    headers: HeaderMap,
    body: JsonBody<SidebarSortRequest>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    let Ok(Json(request)) = body else {
        return Reject::Invalid.response();
    };
    let change = Change::Sort(&request.group_key, request.mode.clone());
    mutate(&state, &ctx, request.version, change).await
}

/// AgentDefinition Resources of this Tenant that are still ACTIVE.
async fn tenant_agent_definitions(
    state: &BffState,
    tenant: Uuid,
    ids: &[Uuid],
) -> Result<HashSet<Uuid>, Response> {
    if ids.is_empty() {
        return Ok(HashSet::new());
    }
    let rows: Vec<Uuid> = sqlx::query_scalar(
        "select d.resource_id from catalog.agent_definition d
         join catalog.resource r on r.id = d.resource_id and r.type_key = 'agent.definition'
         where r.tenant_id = $1 and r.state = 'ACTIVE' and d.resource_id = any($2)",
    )
    .bind(tenant)
    .bind(ids)
    .fetch_all(&state.pool)
    .await
    .map_err(|error| {
        tracing::warn!(%error, "频道模板的 AgentDefinition 查询失败");
        user_state_unavailable()
    })?;
    Ok(rows.into_iter().collect())
}

/// `PUT /api/v1/user-state/channel-templates/{templateId}`（DD-125(4)）.
pub(crate) async fn put_channel_template(
    State(state): State<BffState>,
    Path(template_id): Path<Uuid>,
    headers: HeaderMap,
    body: JsonBody<ChannelTemplateRequest>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    let Ok(Json(request)) = body else {
        return Reject::Invalid.response();
    };
    let agents = match template_agents(&request) {
        Ok(agents) => agents,
        Err(reject) => return reject.response(),
    };
    let known = match tenant_agent_definitions(&state, ctx.tenant_id, &agents).await {
        Ok(known) => known,
        Err(response) => return response,
    };
    if agents.iter().any(|id| !known.contains(id)) {
        return Reject::NotFound.response();
    }
    let change = Change::Template(template_id, &request, agents);
    mutate(&state, &ctx, request.version, change).await
}

/// `DELETE /api/v1/user-state/channel-templates/{templateId}` with a `UserStateVersion` body.
pub(crate) async fn delete_channel_template(
    State(state): State<BffState>,
    Path(template_id): Path<Uuid>,
    headers: HeaderMap,
    body: JsonBody<UserStateVersion>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    let Ok(Json(request)) = body else {
        return Reject::Invalid.response();
    };
    let change = Change::DeleteTemplate(template_id);
    mutate(&state, &ctx, request.version, change).await
}

/// `PUT /api/v1/user-state/followed-principals`（DD-125(5) Pulse follow）. The key
/// is resolved to its HUMAN Principal in this Tenant. Following needs the key to be
/// ACTIVE now; unfollowing accepts a revoked historical key of the same person.
pub(crate) async fn put_followed_principal(
    State(state): State<BffState>,
    headers: HeaderMap,
    body: JsonBody<FollowedPrincipalRequest>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    let Ok(Json(request)) = body else {
        return Reject::Invalid.response();
    };
    let canonical = nostr::PublicKey::from_hex(&request.pubkey)
        .is_ok_and(|key| key.to_hex() == request.pubkey);
    if !canonical {
        return Reject::Invalid.response();
    }
    let row: Option<(Uuid, bool)> = match sqlx::query_as(
        "select p.id,
                b.state = 'ACTIVE' and exists(
                  select 1 from identity.tenant_membership tm
                  where tm.tenant_principal_id = p.id and tm.tenant_id = p.tenant_id
                    and tm.state = 'ACTIVE')
         from identity.buzz_identity_binding b
         join identity.principal p on p.id = b.principal_id and p.tenant_id = b.tenant_id
           and p.kind = 'HUMAN' and p.status = 'ACTIVE'
         where b.tenant_id = $1 and b.pubkey = $2 and b.kind = 'HUMAN'",
    )
    .bind(ctx.tenant_id)
    .bind(&request.pubkey)
    .fetch_optional(&state.pool)
    .await
    {
        Ok(row) => row,
        Err(error) => {
            tracing::warn!(%error, "Pulse 关注对象查询失败");
            return user_state_unavailable();
        }
    };
    let Some((principal, active)) = row else {
        return Reject::NotFound.response();
    };
    if request.followed && !active {
        return Reject::NotFound.response();
    }
    let change = Change::Follow(principal, request.followed);
    mutate(&state, &ctx, request.version, change).await
}

/// The presented DD-125 part of `GET /api/v1/user-state`.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CollabView {
    pub thread_preferences: BTreeMap<String, ThreadPreference>,
    pub sidebar_sections: SidebarSections,
    pub sidebar_sort: BTreeMap<String, SidebarSort>,
    pub channel_templates: BTreeMap<Uuid, ChannelTemplate>,
    pub followed_principals: BTreeMap<Uuid, FollowedView>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FollowedView {
    pub followed_at: String,
    /// Every ACTIVE Buzz identity of the followed Principal (DD-77): the Following
    /// timeline reads kind 1 from all of them.
    pub pubkeys: Vec<String>,
}

impl CollabState {
    /// Thread roots that must be re-read before they are presented.
    pub(crate) fn thread_roots(&self) -> impl Iterator<Item = EventId> + '_ {
        self.threads
            .keys()
            .filter_map(|key| thread_root(key.as_str()))
    }

    /// Channels named by sidebar assignments, for the same visibility check as reads.
    pub(crate) fn assigned_channels(&self) -> impl Iterator<Item = Uuid> + '_ {
        self.sections.assignments.keys().copied()
    }
}

/// Keep stored entries, present only what is eligible now: readable thread roots,
/// visible channels, still-ACTIVE AgentDefinitions and ACTIVE followed HUMANs.
pub(crate) async fn view(
    state: &BffState,
    ctx: &ExecutionContext,
    document: CollabState,
    readable: &HashMap<EventId, (Option<Uuid>, bool)>,
    visible_channels: &HashSet<Uuid>,
) -> Result<CollabView, Response> {
    let mut threads = document.threads;
    threads.retain(|key, _| {
        let Some((channel, is_root)) = thread_root(key).and_then(|id| readable.get(&id)) else {
            return false;
        };
        *is_root && channel.is_none_or(|id| visible_channels.contains(&id))
    });
    let mut sections = document.sections;
    sections
        .assignments
        .retain(|channel, _| visible_channels.contains(channel));
    let agents: Vec<Uuid> = document
        .templates
        .values()
        .flat_map(|template| template.agent_resource_ids.iter().copied())
        .collect();
    let known = tenant_agent_definitions(state, ctx.tenant_id, &agents).await?;
    let mut templates = document.templates;
    for template in templates.values_mut() {
        template.agent_resource_ids.retain(|id| known.contains(id));
    }
    let followed = followed_view(state, ctx, &document.followed).await?;
    Ok(CollabView {
        thread_preferences: threads,
        sidebar_sections: sections,
        sidebar_sort: document.sort,
        channel_templates: templates,
        followed_principals: followed,
    })
}

async fn followed_view(
    state: &BffState,
    ctx: &ExecutionContext,
    followed: &BTreeMap<Uuid, String>,
) -> Result<BTreeMap<Uuid, FollowedView>, Response> {
    if followed.is_empty() {
        return Ok(BTreeMap::new());
    }
    let ids: Vec<Uuid> = followed.keys().copied().collect();
    let rows: Vec<(Uuid, Vec<String>)> = sqlx::query_as(
        "select p.id,
                coalesce(array_agg(b.pubkey order by b.pubkey)
                  filter (where b.pubkey is not null), '{}') as pubkeys
         from identity.principal p
         join identity.tenant_membership tm on tm.tenant_principal_id = p.id
           and tm.tenant_id = p.tenant_id and tm.state = 'ACTIVE'
         left join identity.buzz_identity_binding b on b.principal_id = p.id
           and b.tenant_id = p.tenant_id and b.kind = 'HUMAN' and b.state = 'ACTIVE'
         where p.tenant_id = $1 and p.kind = 'HUMAN' and p.status = 'ACTIVE'
           and p.id = any($2)
         group by p.id",
    )
    .bind(ctx.tenant_id)
    .bind(&ids)
    .fetch_all(&state.pool)
    .await
    .map_err(|error| {
        tracing::warn!(%error, "Pulse 关注展开失败");
        user_state_unavailable()
    })?;
    let mut view = BTreeMap::new();
    for (principal, pubkeys) in rows {
        if let Some(followed_at) = followed.get(&principal) {
            let entry = FollowedView {
                followed_at: followed_at.clone(),
                pubkeys,
            };
            view.insert(principal, entry);
        }
    }
    Ok(view)
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: &str = "2026-10-18T12:00:00.000Z";

    fn root(n: usize) -> String {
        format!("thread:{n:064x}")
    }

    #[test]
    fn thread_keys_are_canonical_roots() {
        assert!(thread_root(&root(1)).is_some());
        assert!(thread_root(&root(1).to_uppercase()).is_none());
        assert!(thread_root("msg:00").is_none());
        let upper = format!("thread:{}", "A".repeat(64));
        assert!(thread_root(&upper).is_none());
    }

    #[test]
    fn following_unmutes_and_unfollowing_mutes() {
        let mut state = CollabState::default();
        apply_thread(&mut state, &root(1), true, NOW);
        assert_eq!(state.threads[&root(1)].state, ThreadState::Followed);
        apply_thread(&mut state, &root(1), false, NOW);
        assert_eq!(state.threads[&root(1)].state, ThreadState::Muted);
        assert_eq!(state.threads.len(), 1);
    }

    #[test]
    fn the_earliest_follow_is_evicted_over_the_cap() {
        let mut state = CollabState::default();
        let at = |n: usize| format!("2026-10-18T12:{:02}:{:02}.000Z", n / 60 % 60, n % 60);
        apply_thread(&mut state, &root(0), false, &at(0));
        for n in 1..=MAX_THREAD_PREFERENCES {
            apply_thread(&mut state, &root(n), true, &at(n));
        }
        assert_eq!(state.threads.len(), MAX_THREAD_PREFERENCES);
        // The mute survives; the earliest follow (1) went first.
        assert!(state.threads.contains_key(&root(0)));
        assert!(!state.threads.contains_key(&root(1)));
        assert!(state.threads.contains_key(&root(MAX_THREAD_PREFERENCES)));
    }

    fn section(name: &str, order: i64) -> SidebarSectionRequest {
        SidebarSectionRequest {
            name: name.into(),
            icon: None,
            order,
            version: 0,
        }
    }

    #[test]
    fn sections_follow_the_original_store_and_bounds() {
        let mut state = CollabState::default();
        let first = Uuid::new_v4();
        let second = Uuid::new_v4();
        upsert_section(&mut state, first, &section(" Launch ", 0), NOW).unwrap();
        upsert_section(&mut state, second, &section("Ops", 1), NOW).unwrap();
        assert_eq!(state.sections.sections[0].name, "Launch");
        let blank = upsert_section(&mut state, first, &section("  ", 0), NOW);
        assert_eq!(blank, Err(Reject::Invalid));

        let channel = Uuid::new_v4();
        assign_channel(&mut state, channel, Some(first), NOW).unwrap();
        let missing = assign_channel(&mut state, channel, Some(Uuid::new_v4()), NOW);
        assert_eq!(missing, Err(Reject::NotFound));
        let group = format!("section:{first}");
        set_sort(&mut state, &group, SidebarSortMode::Recent, NOW).unwrap();
        set_sort(&mut state, "dms", SidebarSortMode::Alpha, NOW).unwrap();
        let unknown = set_sort(&mut state, "section:other", SidebarSortMode::Alpha, NOW);
        assert_eq!(unknown, Err(Reject::Invalid));

        let order = [second.to_string(), first.to_string()];
        reorder_sections(&mut state, &order, NOW).unwrap();
        assert_eq!(state.sections.sections[0].order, 1);
        assert_eq!(state.sections.sections[1].order, 0);
        let partial = reorder_sections(&mut state, &order[..1], NOW);
        assert_eq!(partial, Err(Reject::Invalid));

        delete_section(&mut state, first, NOW).unwrap();
        assert!(state.sections.assignments.is_empty());
        assert!(!state.sort.contains_key(&group));
        assert!(state.sort.contains_key("dms"));
        let again = delete_section(&mut state, first, NOW);
        assert_eq!(again, Err(Reject::NotFound));

        let mut full = CollabState::default();
        for order in 0..MAX_SIDEBAR_SECTIONS as i64 {
            upsert_section(&mut full, Uuid::new_v4(), &section("s", order), NOW).unwrap();
        }
        let over = upsert_section(&mut full, Uuid::new_v4(), &section("s", 0), NOW);
        assert_eq!(over, Err(Reject::TooLarge));
    }

    fn template(canvas: Option<String>) -> ChannelTemplateRequest {
        ChannelTemplateRequest {
            name: "Incident".into(),
            description: Some(" ".into()),
            channel_type: ChannelType::Stream,
            visibility: WorkspaceVisibility::Private,
            canvas_template: canvas,
            agent_resource_ids: Vec::new(),
            version: 0,
        }
    }

    #[test]
    fn templates_keep_original_fields_and_bounds() {
        let mut state = CollabState::default();
        let id = Uuid::new_v4();
        let agent = Uuid::new_v4();
        let request = template(Some("# x".into()));
        upsert_template(&mut state, id, &request, vec![agent], NOW).unwrap();
        let stored = &state.templates[&id];
        assert_eq!(stored.description, None);
        assert_eq!(stored.agent_resource_ids, vec![agent]);
        let canvas = Some("x".repeat(MAX_CANVAS_TEMPLATE_BYTES + 1));
        let large = upsert_template(&mut state, id, &template(canvas), Vec::new(), NOW);
        assert_eq!(large, Err(Reject::TooLarge));

        let mut request = template(None);
        request.agent_resource_ids = vec![agent.to_string(), agent.to_string()];
        assert_eq!(template_agents(&request), Ok(vec![agent]));
        request.agent_resource_ids = vec!["persona-id".into()];
        assert_eq!(template_agents(&request), Err(Reject::Invalid));
    }

    #[test]
    fn stored_shapes_round_trip_and_reject_foreign_documents() {
        let mut state = CollabState::default();
        apply_thread(&mut state, &root(7), true, NOW);
        let columns = CollabColumns {
            thread_preferences: serde_json::to_value(&state.threads).unwrap(),
            sidebar_sections: serde_json::json!({"sections": [], "assignments": {}}),
            sidebar_sort: serde_json::json!({}),
            channel_templates: serde_json::json!({}),
            followed_principals: serde_json::json!({}),
        };
        assert_eq!(columns.parse(), Some(state));
        let foreign = CollabColumns {
            thread_preferences: serde_json::json!({"thread:x": {"state": "PINNED"}}),
            sidebar_sections: serde_json::json!({"sections": [], "assignments": {}}),
            sidebar_sort: serde_json::json!({}),
            channel_templates: serde_json::json!({}),
            followed_principals: serde_json::json!({}),
        };
        assert_eq!(foreign.parse(), None);
    }
}
