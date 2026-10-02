//! 范围审计与 EvidenceRef 解引用（`.design/03` §14、DD-52、V-SCN-43）。
//!
//! 本人审计页只看自己的动作，无需额外判定。这里是另一类读取：Tenant 或其中一个
//! Workspace 范围内的全部审计事件，调用方必须对该范围持有 `audit` permission，
//! 每次请求都以 FullyConsistent 重新判定——刚被撤掉 auditor 的人不能再读到。
//!
//! 列表只给证据种类，不给稳定 ID。稳定 ID 经单条解引用取得，每次解引用都按该
//! 事件自己的 scope 重新授权，并向该种类的权威源查证原对象仍在：明确不存在回 404，
//! 敏感级别未获授权、存量种类不可识别或权威源无从查证时回 200 的不可用视图，权威源
//! 不可达回 503。不可用时不回退展示 ref 内容。

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use contracts::{
    AuditEventPage, AuditEventView, AuditEvidenceSlot, EvidenceKind, EvidenceSensitivity,
    EvidenceUnavailableReason, EvidenceView,
};
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

use crate::audit::{describe, Evidence};
use crate::bff::{db_enum, resolve_execution_context, BffState, ExecutionContext};
use crate::spicedb::Consistency;

#[derive(Deserialize)]
pub struct AuditScopeQuery {
    /// 缺省读整个 Tenant；给出时只读该 Workspace，且该 Workspace 必须属于当前 Tenant
    #[serde(rename = "workspaceId")]
    workspace_id: Option<Uuid>,
    cursor: Option<Uuid>,
}

/// 对 `tenant` 或其中一个 Workspace 的 `audit` 做 fresh Check。
///
/// 判定失败是结果不明，回 503；不把它当成「无权」或「有权」。
async fn audit_allowed(
    state: &BffState,
    ctx: &ExecutionContext,
    workspace_id: Option<Uuid>,
) -> Result<bool, Response> {
    let (object_type, object_id) = match workspace_id {
        Some(w) => ("workspace", w.to_string()),
        None => ("tenant", ctx.tenant_id.to_string()),
    };
    match state
        .governance
        .spicedb
        .check(
            object_type,
            &object_id,
            "audit",
            &ctx.tenant_principal_id.to_string(),
            Consistency::FullyConsistent,
        )
        .await
    {
        Ok(result) => Ok(result.allowed),
        Err(e) => {
            tracing::warn!(error = %e, object_type, "审计范围的 audit 判定失败");
            Err(StatusCode::SERVICE_UNAVAILABLE.into_response())
        }
    }
}

/// 列表中的证据槽位：可识别的给出种类、权威与敏感级别，不可识别的只给位置。
fn slots(refs: &Value) -> Vec<AuditEvidenceSlot> {
    refs.as_array()
        .map(|items| {
            items
                .iter()
                .enumerate()
                .map(|(i, item)| {
                    let index = i64::try_from(i).unwrap_or(i64::MAX);
                    match Evidence::parse(item) {
                        Some(e) => {
                            let (authority, sensitivity) = describe(&e.kind);
                            AuditEvidenceSlot {
                                index,
                                kind: Some(e.kind),
                                authority: Some(authority),
                                sensitivity: Some(sensitivity),
                            }
                        }
                        None => AuditEvidenceSlot {
                            index,
                            kind: None,
                            authority: None,
                            sensitivity: None,
                        },
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

type EventRow = (
    Uuid,
    chrono::DateTime<chrono::Utc>,
    String,
    String,
    String,
    String,
    Option<Uuid>,
    Option<Uuid>,
    Option<Uuid>,
    Value,
);

/// `GET /api/v1/audit/events`：当前 Tenant（或其中一个 Workspace）范围内的审计事件。
pub async fn list_scope_audit(
    State(state): State<BffState>,
    headers: HeaderMap,
    Query(query): Query<AuditScopeQuery>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    if let Some(workspace_id) = query.workspace_id {
        // 先确认 Workspace 属于调用方的 Tenant，再问 SpiceDB：跨 Tenant 的 ID
        // 不该走到授权判定那一步
        let belongs: Result<Option<i32>, _> =
            sqlx::query_scalar("select 1 from identity.workspace where id = $1 and tenant_id = $2")
                .bind(workspace_id)
                .bind(ctx.tenant_id)
                .fetch_optional(&state.pool)
                .await;
        match belongs {
            Ok(Some(_)) => {}
            Ok(None) => return StatusCode::FORBIDDEN.into_response(),
            Err(e) => {
                tracing::warn!(error = %e, "审计范围的 Workspace 归属判定失败");
                return StatusCode::SERVICE_UNAVAILABLE.into_response();
            }
        }
    }
    match audit_allowed(&state, &ctx, query.workspace_id).await {
        Ok(true) => {}
        Ok(false) => return StatusCode::FORBIDDEN.into_response(),
        Err(r) => return r,
    }

    let page = state.message_page_limit;
    let rows: Result<Vec<EventRow>, _> = sqlx::query_as(
        "select id, occurred_at, event_type, action_key, decision, result_code,
                workspace_id, initiator_principal_id, actor_principal_id, evidence_refs
         from audit.audit_event
         where tenant_id = $1
           and ($2::uuid is null or workspace_id = $2)
           and ($3::uuid is null or (occurred_at, id) < (
                select occurred_at, id from audit.audit_event where id = $3 and tenant_id = $1))
         order by occurred_at desc, id desc
         limit $4",
    )
    .bind(ctx.tenant_id)
    .bind(query.workspace_id)
    .bind(query.cursor)
    .bind(page + 1)
    .fetch_all(&state.pool)
    .await;
    let mut rows = match rows {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(error = %e, "读取范围审计失败");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    };
    let limit = usize::try_from(page).unwrap_or(usize::MAX);
    let more = rows.len() > limit;
    rows.truncate(limit);
    let next_cursor = if more {
        rows.last().map(|r| r.0.to_string())
    } else {
        None
    };
    let mut events = Vec::with_capacity(rows.len());
    for (
        id,
        occurred_at,
        event_type,
        action_key,
        decision,
        result_code,
        workspace,
        initiator,
        actor,
        refs,
    ) in rows
    {
        let event_type = match db_enum("audit_event.event_type", &event_type) {
            Ok(t) => t,
            Err(r) => return r,
        };
        events.push(AuditEventView {
            id: id.to_string(),
            occurred_at: occurred_at.to_rfc3339(),
            event_type,
            action_key,
            decision,
            result_code,
            workspace_id: workspace.map(|w| w.to_string()),
            initiator_principal_id: initiator.map(|p| p.to_string()),
            actor_principal_id: actor.map(|p| p.to_string()),
            evidence: slots(&refs),
        });
    }
    (
        StatusCode::OK,
        Json(AuditEventPage {
            events,
            next_cursor,
        }),
    )
        .into_response()
}

fn unavailable(reason: EvidenceUnavailableReason, e: Option<&Evidence>) -> EvidenceView {
    let described = e.map(|e| (e.kind.clone(), describe(&e.kind)));
    EvidenceView {
        available: false,
        unavailable_reason: Some(reason),
        kind: described.as_ref().map(|(k, _)| k.clone()),
        authority: described.as_ref().map(|(_, (a, _))| a.clone()),
        sensitivity: described.map(|(_, (_, s))| s),
        stable_id: None,
        version: None,
    }
}

/// 一条证据在其权威源中的存在性结论。
#[derive(Debug, PartialEq, Eq)]
enum Existence {
    /// 权威源确认原对象仍在
    Present,
    /// 权威源明确答复原对象不存在（含已删除、已超出 retention）
    Absent,
    /// 权威源没有可供 BFF 按该 ID 查证存在性的接口，或该 ID 无法绑定到可查的对象。
    /// 不能证实存在就不展示，也不说成「不存在」
    Unverifiable,
}

/// 查证失败的原因；它是结果不明，调用方回 503，不当成存在或不存在。
#[derive(Debug, thiserror::Error)]
enum ExistenceError {
    #[error("Core 库: {0}")]
    Db(#[from] sqlx::Error),
    #[error("Temporal: {0}")]
    Temporal(#[from] crate::temporal::TemporalError),
    #[error("SpiceDB: {0}")]
    SpiceDb(#[from] crate::spicedb::SpiceDbError),
}

/// 同一事件中 run ID 所属的 workflow ID：事件内 workflow 种类的证据恰好只指向一个
/// workflow 时才能绑定；没有或不止一个时 run ID 无从定位。
fn sibling_workflow(refs: &Value) -> Option<String> {
    let mut found: Option<String> = None;
    for e in refs.as_array()?.iter().filter_map(Evidence::parse) {
        if matches!(
            e.kind,
            EvidenceKind::TemporalWorkflowId | EvidenceKind::ApprovalWorkflowId
        ) {
            match &found {
                None => found = Some(e.value),
                Some(w) if *w == e.value => {}
                Some(_) => return None,
            }
        }
    }
    found
}

/// `SPICEDB_RELATIONSHIP` 的值：`<type>:<id>#<relation>@principal:<subject>`。
fn parse_relationship(value: &str) -> Option<crate::spicedb::Relationship> {
    let (object, subject) = value.split_once('@')?;
    let (object, relation) = object.split_once('#')?;
    let (object_type, object_id) = object.split_once(':')?;
    let subject_principal = subject.strip_prefix("principal:")?;
    [object_type, object_id, relation, subject_principal]
        .iter()
        .all(|p| !p.is_empty())
        .then(|| crate::spicedb::Relationship {
            object_type: object_type.to_owned(),
            object_id: object_id.to_owned(),
            relation: relation.to_owned(),
            subject_principal: subject_principal.to_owned(),
        })
}

/// 按证据种类向其权威源查证原对象是否仍在（DD-52、V-SCN-43）。
///
/// - Core 表：按 ID（与版本）查当前 Tenant 的行；
/// - Temporal：workflow 种类按固定 ID Describe；run 种类经同事件的 workflow ID
///   Describe，只在其当前 run 或首次 run 与之相等时确认存在；
/// - SpiceDB 关系：FullyConsistent 读该条关系；
/// - SpiceDB ZedToken 是 revision 而非可查对象，Buzz 事件与公钥在 BFF 路径上没有
///   按 ID 的查证接口：一律 [`Existence::Unverifiable`]。
///
/// match 不设通配分支：新增种类必须在这里给出结论，不会默认成可用。
async fn evidence_existence(
    state: &BffState,
    tenant_id: Uuid,
    operation_id: Uuid,
    refs: &Value,
    e: &Evidence,
) -> Result<Existence, ExistenceError> {
    use EvidenceKind as K;
    let present = |found: bool| {
        if found {
            Existence::Present
        } else {
            Existence::Absent
        }
    };
    let sql = match e.kind {
        // 审批策略属平台 Catalog，按 (id, version) 核对；存量把版本写在值里
        // （`<id>@<version>`），新写入用 version 字段，两种形状指向同一条策略
        K::ApprovalPolicy => {
            let (id, version) = match (e.value.split_once('@'), e.version) {
                (Some((id, v)), None) => (id, v.parse::<i32>().ok()),
                (None, Some(v)) => (e.value.as_str(), i32::try_from(v).ok()),
                _ => return Ok(Existence::Absent),
            };
            let (Ok(id), Some(version)) = (Uuid::parse_str(id), version) else {
                return Ok(Existence::Absent);
            };
            let row = sqlx::query_scalar::<_, i32>(
                "select 1 from catalog.approval_policy where id = $1 and version = $2",
            )
            .bind(id)
            .bind(version)
            .fetch_optional(&state.pool)
            .await?;
            return Ok(present(row.is_some()));
        }
        // 部署引导证据的值是该部署服务主体的 audience，它属于 Catalog 而非当前 Tenant
        K::DeploymentBootstrap => {
            let row = sqlx::query_scalar::<_, i32>(
                "select 1 from identity.service_principal where audience = $1",
            )
            .bind(&e.value)
            .fetch_optional(&state.pool)
            .await?;
            return Ok(present(row.is_some()));
        }
        K::TemporalWorkflowId | K::ApprovalWorkflowId => {
            return Ok(present(state.temporal.describe(&e.value).await?.is_some()));
        }
        K::TemporalRunId | K::TemporalFirstRunId => {
            let Some(workflow_id) = sibling_workflow(refs) else {
                return Ok(Existence::Unverifiable);
            };
            // workflow 已不存在时其任何 run 都不在：更早的 run 只会更早超出 retention
            return Ok(match state.temporal.describe(&workflow_id).await? {
                None => Existence::Absent,
                Some(o) if o.run_id == e.value || o.first_run_id == e.value => Existence::Present,
                // Describe 只看最新一次 run；链中更早的 run 或复用 ID 之前的 execution
                // 可能仍在，也可能不在，这里不猜
                Some(_) => Existence::Unverifiable,
            });
        }
        K::SpicedbRelationship => {
            let Some(rel) = parse_relationship(&e.value) else {
                return Ok(Existence::Absent);
            };
            let found = state
                .governance
                .spicedb
                .read(
                    &crate::spicedb::RelationshipFilter {
                        object_type: &rel.object_type,
                        object_id: Some(&rel.object_id),
                        relation: Some(&rel.relation),
                        subject_principal: Some(&rel.subject_principal),
                    },
                    RELATIONSHIP_READ_PAGE,
                )
                .await?;
            return Ok(present(found.contains(&rel)));
        }
        K::SpicedbZedtoken
        | K::BuzzEventId
        | K::BuzzPubkey
        | K::BuzzDeletionRequestId
        | K::BuzzDeletionInventoryDigest
        | K::ExternalSubjectSha256
        | K::PlatformSessionId => return Ok(Existence::Unverifiable),
        K::TenantLifecycleSnapshotId | K::TenantDeleteSubprocessId => {
            let Ok(id) = Uuid::parse_str(&e.value) else {
                return Ok(Existence::Absent);
            };
            // operation_id 是跨组件关联键，不是 ActionExecution.id。冻结对象必须
            // 由同 Tenant、同 operation 的执行持有，不能解引用另一操作的快照。
            let sql = if e.kind == K::TenantLifecycleSnapshotId {
                "select 1 from admission.tenant_lifecycle_snapshot s
                 join admission.action_execution ae on ae.id = s.action_execution_id
                 where s.id = $1 and s.tenant_id = $2 and ae.tenant_id = $2
                   and ae.operation_id = $3"
            } else {
                "select 1 from admission.tenant_delete_subprocess p
                 join admission.tenant_lifecycle_snapshot s
                   on s.id = p.tenant_lifecycle_snapshot_id and s.tenant_id = p.tenant_id
                 join admission.action_execution ae on ae.id = s.action_execution_id
                 where p.id = $1 and p.tenant_id = $2 and ae.tenant_id = $2
                   and ae.operation_id = $3"
            };
            let row = sqlx::query_scalar::<_, i32>(sql)
                .bind(id)
                .bind(tenant_id)
                .bind(operation_id)
                .fetch_optional(&state.pool)
                .await?;
            return Ok(present(row.is_some()));
        }
        K::ActionExecutionId | K::AdmitActionExecutionId | K::OriginalActionExecutionId => {
            "select 1 from admission.action_execution where id = $1 and tenant_id = $2"
        }
        K::TenantInvitationId => {
            "select 1 from identity.tenant_invitation where id = $1 and tenant_id = $2"
        }
        K::TenantMembershipId => {
            "select 1 from identity.tenant_membership where id = $1 and tenant_id = $2"
        }
        K::SecretRefRehomeId => {
            "select 1 from admission.secret_ref_rehome where id = $1 and tenant_id = $2"
        }
    };
    let Ok(id) = Uuid::parse_str(&e.value) else {
        return Ok(Existence::Absent);
    };
    let row = sqlx::query_scalar::<_, i32>(sql)
        .bind(id)
        .bind(tenant_id)
        .fetch_optional(&state.pool)
        .await?;
    Ok(present(row.is_some()))
}

/// 读一条完全限定的关系：至多一行，页大小只需让「读满一页」不成立。
const RELATIONSHIP_READ_PAGE: u32 = 2;

/// `GET /api/v1/audit/events/{id}/evidence/{index}`：单条证据的解引用。
pub async fn dereference_evidence(
    State(state): State<BffState>,
    headers: HeaderMap,
    Path((event_id, index)): Path<(Uuid, usize)>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    let row: Result<Option<(Option<Uuid>, Uuid, Value)>, _> = sqlx::query_as(
        "select workspace_id, operation_id, evidence_refs
         from audit.audit_event where id = $1 and tenant_id = $2",
    )
    .bind(event_id)
    .bind(ctx.tenant_id)
    .fetch_optional(&state.pool)
    .await;
    let (workspace_id, operation_id, refs) = match row {
        Ok(Some(r)) => r,
        // 别的 Tenant 的事件与不存在的事件同样回 404：不透露它在哪里
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            tracing::warn!(error = %e, "读取审计事件失败");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    };
    // 授权按事件自己的 scope：Workspace 事件查该 Workspace 的 audit（其中包含
    // Tenant 的 audit），Tenant 级事件查 Tenant 的 audit
    match audit_allowed(&state, &ctx, workspace_id).await {
        Ok(true) => {}
        Ok(false) => return StatusCode::FORBIDDEN.into_response(),
        Err(r) => return r,
    }
    let Some(item) = refs.as_array().and_then(|items| items.get(index)) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Some(evidence) = Evidence::parse(item) else {
        return Json(unavailable(EvidenceUnavailableReason::Unrecognized, None)).into_response();
    };
    let (authority, sensitivity) = describe(&evidence.kind);
    // RESTRICTED 还需要 ResultExposure 授权；它交付之前一律不可用
    if sensitivity == EvidenceSensitivity::Restricted {
        return Json(unavailable(
            EvidenceUnavailableReason::Restricted,
            Some(&evidence),
        ))
        .into_response();
    }
    match evidence_existence(&state, ctx.tenant_id, operation_id, &refs, &evidence).await {
        Ok(Existence::Present) => {}
        // 原证据明确不存在：404，正文仍是只含原因的不可用视图
        Ok(Existence::Absent) => {
            return (
                StatusCode::NOT_FOUND,
                Json(unavailable(
                    EvidenceUnavailableReason::NotFound,
                    Some(&evidence),
                )),
            )
                .into_response()
        }
        Ok(Existence::Unverifiable) => {
            return Json(unavailable(
                EvidenceUnavailableReason::Unverifiable,
                Some(&evidence),
            ))
            .into_response()
        }
        Err(e) => {
            tracing::warn!(error = %e, kind = ?evidence.kind, "核对证据原对象失败");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    }
    Json(EvidenceView {
        available: true,
        unavailable_reason: None,
        kind: Some(evidence.kind),
        authority: Some(authority),
        sensitivity: Some(sensitivity),
        stable_id: Some(evidence.value),
        version: evidence.version,
    })
    .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn run_id_binds_only_to_a_single_workflow_in_the_same_event() {
        let one = json!([
            { "kind": "TEMPORAL_WORKFLOW_ID", "value": "wf-1" },
            { "kind": "TEMPORAL_RUN_ID", "value": "run-1" },
        ]);
        assert_eq!(sibling_workflow(&one).as_deref(), Some("wf-1"));
        let approval = json!([
            { "kind": "APPROVAL_WORKFLOW_ID", "value": "ap-1" },
            { "kind": "TEMPORAL_RUN_ID", "value": "run-1" },
        ]);
        assert_eq!(sibling_workflow(&approval).as_deref(), Some("ap-1"));
        let repeated = json!([
            { "kind": "TEMPORAL_WORKFLOW_ID", "value": "wf-1" },
            { "kind": "APPROVAL_WORKFLOW_ID", "value": "wf-1" },
        ]);
        assert_eq!(sibling_workflow(&repeated).as_deref(), Some("wf-1"));
        let two = json!([
            { "kind": "TEMPORAL_WORKFLOW_ID", "value": "wf-1" },
            { "kind": "APPROVAL_WORKFLOW_ID", "value": "ap-1" },
            { "kind": "TEMPORAL_RUN_ID", "value": "run-1" },
        ]);
        assert_eq!(
            sibling_workflow(&two),
            None,
            "两个 workflow 时 run 无从定位"
        );
        let none = json!([{ "kind": "TEMPORAL_RUN_ID", "value": "run-1" }]);
        assert_eq!(sibling_workflow(&none), None);
    }

    #[test]
    fn relationship_evidence_parses_only_the_written_shape() {
        let rel = parse_relationship("tenant:t-1#manage@principal:p-1").expect("规范形状");
        assert_eq!(
            (
                rel.object_type.as_str(),
                rel.object_id.as_str(),
                rel.relation.as_str(),
                rel.subject_principal.as_str()
            ),
            ("tenant", "t-1", "manage", "p-1")
        );
        for bad in [
            "tenant:t-1#manage@tenant:t-2",
            "tenant:t-1@principal:p-1",
            "tenant#manage@principal:p-1",
            "tenant:#manage@principal:p-1",
            "tenant:t-1#manage@principal:",
        ] {
            assert!(parse_relationship(bad).is_none(), "{bad}");
        }
    }
}
