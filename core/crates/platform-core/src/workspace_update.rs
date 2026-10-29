//! 受治理的频道管理编辑（DD-119、SF-BUZ-50、V-SCN-94–98）。
//!
//! 原版频道设置里的名称、描述、TTL 与可见性逐项接到 Core，不新增 Relay 写入者：
//!
//! - `workspace.update` 在 Admission 校验组合、锁 Workspace 行并要求 ACTIVE 且没有
//!   未终结的同类动作；可见性只是 Core 事实，在准入事务内改写，从不发往 Relay；
//! - 名称、描述与 TTL 由 `WORKSPACE_LIFECYCLE` 的 METADATA 段以 Tenant CONTROL 发一条
//!   9002，按「先读 → 发送 → 回读 39000」判定，回读一致后才在同一事务提交 Core 的
//!   Workspace 名称（slug 不变）；每次签发记 DISPATCH 与结果审计；
//! - `reopen` 只解档被原生 reaper 按 TTL 到期归档的 Channel，主动归档仍是
//!   `workspace.suspend`/`workspace.restore`（DD-46）。
//!
//! `workspace.leave` 只有参数与主体规则在 governance 中：主体固定为发起人，撤员链与
//! `workspace.member.revoke` 完全相同。

use std::collections::HashSet;

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use collab_bridge::bridge::{ChannelMetadataStep, ChannelMetadataTarget, ChannelTtl, Delivery};
use contracts::{EvidenceKind, ReasonCode, WorkspaceUpdate};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::audit::Evidence;
use crate::component_task::{self, ComponentTaskInput};
use crate::governance::{
    audit, exact_definition_for_execution, load_execution, Definition, Execution, Params, Refusal,
    Target,
};
use crate::membership_lifecycle::LifecycleResponse;
use crate::service_api::{authorize, unavailable, ServiceState};
use crate::temporal::TemporalClient;
use crate::tenant_lifecycle::{control_client, ProjectionDirection};

/// 受治理的频道编辑。
pub(crate) const UPDATE_ACTION: &str = "workspace.update";
/// 本人退出频道。
pub(crate) const LEAVE_ACTION: &str = "workspace.leave";
const KIND: &str = "WORKSPACE_LIFECYCLE";
/// ScopeTarget.operation 的 METADATA 段，与 Worker 的 `scopeOperationMetadata` 逐字相同。
const OPERATION: &str = "METADATA";
/// 每次签发的审计阶段前缀：`<operation>:channel-metadata:<event id>[:dispatch]`。
const STAGE: &str = "channel-metadata";

/// 校验 `workspaceUpdate` 的组合并规范化为冻结参数（DD-119(1)）。
///
/// 至少给出 name、description、ttlSeconds/clearTtl、visibility 之一，或只给
/// `reopen=true`；空集、ttlSeconds 与 clearTtl 同时出现、reopen 与其他字段混用、两个
/// 标志取 false 都以 INVALID_PARAMETERS 拒绝。名称按 Relay 的规则规范化（Relay 存的
/// 正是它），规范化后为空即拒绝；描述原样冻结，空串清空。
pub(crate) fn normalize(update: &WorkspaceUpdate) -> Result<Value, Refusal> {
    let bad = || Refusal::Precondition(ReasonCode::InvalidParameters);
    let mut update = update.clone();
    if update.reopen == Some(false) || update.clear_ttl == Some(false) {
        return Err(bad());
    }
    if update.ttl_seconds.is_some() && update.clear_ttl.is_some() {
        return Err(bad());
    }
    // 与原 Relay 的 9002 校验同一范围：正的 i32 秒数
    let in_range = |seconds: i64| (1..=i64::from(i32::MAX)).contains(&seconds);
    if !update.ttl_seconds.is_none_or(in_range) {
        return Err(bad());
    }
    if let Some(raw) = update.name.take() {
        let name = collab_bridge::bridge::canonical_channel_name(&raw);
        if name.is_empty() {
            return Err(bad());
        }
        update.name = Some(name.to_owned());
    }
    let edits = update.name.is_some()
        || update.description.is_some()
        || update.ttl_seconds.is_some()
        || update.clear_ttl.is_some()
        || update.visibility.is_some();
    match (update.reopen, edits) {
        (Some(true), false) | (None, true) => serde_json::to_value(update).map_err(|_| bad()),
        _ => Err(bad()),
    }
}

/// 冻结参数里的更新意图。
pub(crate) fn frozen(params: &Params) -> Option<WorkspaceUpdate> {
    let value = params.workspace_update.as_ref()?;
    serde_json::from_value(value.clone()).ok()
}

fn frozen_update(ae: &Execution) -> Option<WorkspaceUpdate> {
    let params = ae.parameters.as_ref()?.get("params")?;
    frozen(&Params::from_json(params)?)
}

/// 需经 Relay 收敛的那部分目标状态。可见性只是 Core 事实，不在其中（DD-119(2)）。
pub(crate) fn channel_target(update: &WorkspaceUpdate) -> ChannelMetadataTarget {
    ChannelMetadataTarget {
        name: update.name.clone(),
        about: update.description.clone(),
        ttl: match (update.ttl_seconds, update.clear_ttl) {
            (Some(seconds), _) => Some(ChannelTtl::Seconds(seconds)),
            (None, Some(true)) => Some(ChannelTtl::Clear),
            _ => None,
        },
        reopen: update.reopen == Some(true),
    }
}

/// workspace.update 的目录形状：目标 Workspace、执行 Workspace 即目标、在其上检查
/// manage、无审批、由 WORKSPACE_LIFECYCLE 收敛。
pub(crate) fn update_shape(def: &Definition) -> bool {
    def.target_type == "WORKSPACE"
        && def.tenant_rule == "SESSION_TENANT"
        && def.workspace_rule == "WORKSPACE_REQUIRED"
        && def.permission == "manage"
        && def.permission_object_type == "workspace"
        && def.confirmation_mode == "NONE"
        && def.execution_mode == "TEMPORAL"
        && def.workflow_kind.as_deref() == Some(KIND)
}

/// workspace.leave 的目录形状：目标是本人的 WorkspaceMembership、在 Workspace 上检查
/// discover、复用 MEMBERSHIP_REVOCATION 撤员链。
pub(crate) fn leave_shape(def: &Definition) -> bool {
    def.target_type == "WORKSPACE_MEMBERSHIP"
        && def.tenant_rule == "SESSION_TENANT"
        && def.workspace_rule == "WORKSPACE_REQUIRED"
        && def.permission == "discover"
        && def.permission_object_type == "workspace"
        && def.confirmation_mode == "NONE"
        && def.execution_mode == "TEMPORAL"
        && def.workflow_kind.as_deref() == Some("MEMBERSHIP_REVOCATION")
}

/// 解析 workspace.update 的目标（DD-119(1)、V-SCN-96）：同 Tenant 的 Workspace（跨
/// Tenant 与不存在是同一个回答），须 ACTIVE 且没有未终结的 workspace.update。`lock`
/// 时持有 Workspace 行锁：可见性在同一事务里改写，加入准入在同一把锁下复核。
pub(crate) async fn target(
    conn: &mut sqlx::PgConnection,
    tenant: Uuid,
    def: &Definition,
    p: &Params,
    frozen: Option<Uuid>,
    lock: bool,
) -> Result<Target, Refusal> {
    if !update_shape(def) {
        tracing::error!(action = %def.action_key, "workspace.update 的目录形状与语义不一致");
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    let Some(ws) = p.workspace_id else {
        return Err(Refusal::Precondition(ReasonCode::InvalidParameters));
    };
    let for_update = if lock { " for update" } else { "" };
    let row: Option<(i32, String)> = sqlx::query_as(&format!(
        "select version, state from identity.workspace
         where id = $1 and tenant_id = $2{for_update}"
    ))
    .bind(ws)
    .bind(tenant)
    .fetch_optional(&mut *conn)
    .await?;
    let Some((version, state)) = row else {
        return Err(Refusal::Precondition(ReasonCode::TargetNotFound));
    };
    if state != "ACTIVE" || frozen.is_some_and(|id| id != ws) {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    // 落定时本动作自己的 EVALUATING 行已在库里；在准入或审批中的同目标动作另由
    // action_execution_one_pending_per_target 拒绝，锁内只需再看已允许而未终结的。
    let open = open_updates(&mut *conn, tenant, &[ws], !lock).await?;
    if !open.is_empty() {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    Ok(Target {
        id: ws,
        version,
        workspace_id: Some(ws),
    })
}

/// 本 Tenant 中仍有未终结 workspace.update 的 Workspace。已允许的动作在其 WorkflowRef
/// 进入终态（或派发被确定中止）之前都未终结；`pending` 时连同尚在准入或审批中的一并
/// 计入。没有第二份在途标记：ActionExecution 与 WorkflowRef 就是这件事的事实来源。
pub(crate) async fn open_updates(
    conn: &mut sqlx::PgConnection,
    tenant: Uuid,
    workspaces: &[Uuid],
    pending: bool,
) -> Result<HashSet<Uuid>, sqlx::Error> {
    let rows: Vec<Uuid> = sqlx::query_scalar(
        "select distinct ae.target_id from admission.action_execution ae
         left join projection.workflow_ref wr on wr.workflow_id = ae.temporal_workflow_id
         where ae.tenant_id = $1 and ae.target_id = any($2) and ae.action_key = $3
           and ((ae.gate_state = 'ALLOWED' and ae.dispatch_state <> 'ABORTED'
                 and coalesce(wr.projection_state, 'PENDING_START') <> 'TERMINAL')
                or ($4 and ae.gate_state in ('EVALUATING', 'WAITING')))",
    )
    .bind(tenant)
    .bind(workspaces)
    .bind(UPDATE_ACTION)
    .bind(pending)
    .fetch_all(&mut *conn)
    .await?;
    Ok(rows.into_iter().collect())
}

/// 准入落定（DD-119(2)、V-SCN-95）：可见性在准入事务内、Workspace 行锁下改写。已有
/// 成员不变，不写 SpiceDB，Relay 投影始终 private。Workspace 版本不推进——名称、描述
/// 与可见性都不改变它的生命周期；返回的版本冻结进 METADATA 段，用于确认 Workspace
/// 仍是准入时的那一个。
pub(crate) async fn prewrite(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    target: &Target,
    params: &Params,
) -> Result<i32, Refusal> {
    let Some(update) = frozen(params) else {
        return Err(Refusal::Precondition(ReasonCode::InvalidParameters));
    };
    let Some(visibility) = update.visibility else {
        return Ok(target.version);
    };
    let written: Option<i32> = sqlx::query_scalar(
        "update identity.workspace set visibility = $4
         where id = $1 and tenant_id = $2 and version = $3 and state = 'ACTIVE'
         returning version",
    )
    .bind(target.id)
    .bind(tenant)
    .bind(target.version)
    .bind(crate::governance::wire(&visibility))
    .fetch_optional(&mut **tx)
    .await?;
    written.ok_or(Refusal::Conflict(ReasonCode::TargetStateConflict))
}

/// 启动 METADATA 段（DD-119(3)）。只接受已允许、预写了同一 workflow ID 的
/// workspace.update。冻结输入只含引用：目标状态由 Core 从该 ActionExecution 的冻结
/// 参数读取，描述正文不进 Temporal history。
pub(crate) async fn start(
    pool: &PgPool,
    temporal: &TemporalClient,
    action: Uuid,
    tenant: Uuid,
    workflow: &str,
) -> Result<LifecycleResponse, Response> {
    let loaded = load_execution(pool, action).await;
    let ae = loaded.map_err(unavailable)?;
    let Some(ae) = ae.filter(|ae| {
        ae.tenant_id == tenant
            && ae.action_key == UPDATE_ACTION
            && ae.gate_state == "ALLOWED"
            && ae.temporal_workflow_id.as_deref() == Some(workflow)
    }) else {
        return Err(StatusCode::CONFLICT.into_response());
    };
    let Some(version) = ae.frozen_target_version() else {
        return Err(StatusCode::CONFLICT.into_response());
    };
    let input = ComponentTaskInput {
        kind: KIND.to_owned(),
        target: json!({
            "scope": {
                "id": ae.target_id,
                "version": version,
                "tenantId": tenant,
                "operation": OPERATION,
                "actionExecutionId": ae.id,
            }
        }),
    };
    let started = component_task::start(pool, temporal, workflow, tenant, ae.id, &input);
    let run_id = started.await?;
    Ok(LifecycleResponse {
        workflow_id: workflow.to_owned(),
        kind: KIND.to_owned(),
        run_id,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelMetadataRequest {
    pub workspace_id: Uuid,
    pub workspace_version: i32,
    pub action_execution_id: Uuid,
    /// 最后一轮：只回读、不再签发；仍不一致即记 EXTERNAL_RESULT_UNKNOWN，交对账
    #[serde(default)]
    pub last_round: bool,
}

/// 一轮收敛的结论。确定的拒绝走 409，依赖不可用走 503。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "SCREAMING_SNAKE_CASE")]
enum Convergence {
    /// 回读与冻结目标一致，Core 名称已在同一事务提交
    Converged,
    /// 已签发而回读未达目标：结果不明，Workflow 以 PROJECTION_DELAYED 等下一轮
    Pending,
    /// 最后一轮仍不一致：EXTERNAL_RESULT_UNKNOWN，交对账，不再签发
    Unknown,
}

/// METADATA 段的一轮收敛（DD-119(3)(6)、V-SCN-94/97）。
///
/// 只认已允许的 workspace.update 与它冻结的 Workspace 版本；先读 39000，已是目标即
/// 提交，否则只在 Workspace 仍 ACTIVE 且仍是准入时的版本时以 CONTROL 签发一条只含
/// 必要标签的 9002：落 DISPATCH 之后才投递，投递结论记 OUTCOME，再回读判定。Relay
/// 的确定拒绝与前置条件不成立回 409；读不到 Relay 回 503。
pub async fn converge_workspace_channel_metadata(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    body: Result<Json<ChannelMetadataRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if let Err(e) = authorize(&state, &headers).await {
        return e;
    }
    let Ok(Json(req)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    match converge(&state, &req).await {
        Ok(outcome) => Json(outcome).into_response(),
        Err(response) => response,
    }
}

/// 一次收敛所属的已准入动作。
struct Run<'a> {
    state: &'a ServiceState,
    ae: &'a Execution,
    def: &'a Definition,
}

impl Run<'_> {
    async fn audit_in(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        stage: &str,
        event_type: &str,
        result: &str,
        evidence: Vec<Evidence>,
    ) -> Result<(), sqlx::Error> {
        let (ae, def) = (self.ae, self.def);
        audit(
            tx, ae, def, stage, event_type, "ALLOW", result, None, evidence,
        )
        .await
    }

    async fn record(
        &self,
        stage: &str,
        event_type: &str,
        result: &str,
        evidence: Vec<Evidence>,
    ) -> Result<(), Response> {
        let written = async {
            let mut tx = self.state.pool.begin().await?;
            self.audit_in(&mut tx, stage, event_type, result, evidence)
                .await?;
            tx.commit().await
        };
        written.await.map_err(unavailable)
    }

    /// 回读与目标一致：同一事务里提交 Core 的 Workspace 名称（slug 不变）并记结果。
    /// 重复提交是幂等的：名称是同一个冻结值，审计按阶段去重。
    async fn commit(&self, name: Option<&str>) -> Result<Convergence, Response> {
        let committed = async {
            let mut tx = self.state.pool.begin().await?;
            if let Some(name) = name {
                sqlx::query(
                    "update identity.workspace set name = $3
                     where id = $1 and tenant_id = $2",
                )
                .bind(self.ae.target_id)
                .bind(self.ae.tenant_id)
                .bind(name)
                .execute(&mut *tx)
                .await?;
            }
            let stage = format!("{STAGE}:converged");
            let result = "CHANNEL_METADATA_CONVERGED";
            self.audit_in(&mut tx, &stage, "OUTCOME", result, Vec::new())
                .await?;
            tx.commit().await
        };
        committed.await.map_err(unavailable)?;
        Ok(Convergence::Converged)
    }
}

async fn converge(
    state: &ServiceState,
    req: &ChannelMetadataRequest,
) -> Result<Convergence, Response> {
    let conflict = || StatusCode::CONFLICT.into_response();
    let relay_unavailable = |e: collab_bridge::operator::OperatorError| {
        tracing::warn!(error = %e, "Channel 元数据回读失败");
        StatusCode::SERVICE_UNAVAILABLE.into_response()
    };
    let loaded = load_execution(&state.pool, req.action_execution_id).await;
    let ae = loaded.map_err(unavailable)?;
    let Some(ae) = ae.filter(|ae| {
        ae.action_key == UPDATE_ACTION
            && ae.gate_state == "ALLOWED"
            && ae.target_id == req.workspace_id
            && ae.frozen_target_version() == Some(req.workspace_version)
    }) else {
        return Err(conflict());
    };
    let Some(update) = frozen_update(&ae) else {
        return Err(conflict());
    };
    let definition = exact_definition_for_execution(&state.pool, &ae).await;
    let def = definition.map_err(unavailable)?;
    let run = Run {
        state,
        ae: &ae,
        def: &def,
    };
    let target = channel_target(&update);
    let name = update.name.as_deref();
    if target.is_empty() {
        // 只改可见性：准入事务已写入 Core，Relay 不接收任何标签
        return run.commit(name).await;
    }
    let channel: Option<Uuid> = sqlx::query_scalar(
        "select b.channel_id from identity.workspace w
         join projection.workspace_buzz_binding b on b.workspace_id = w.id
         where w.id = $1 and w.tenant_id = $2 and b.state = 'ACTIVE'",
    )
    .bind(ae.target_id)
    .bind(ae.tenant_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(unavailable)?;
    let Some(channel) = channel.map(|id| id.to_string()) else {
        return Err(conflict());
    };
    let client = control_client(state, ae.tenant_id, ProjectionDirection::Establish);
    let (control, _) = client.await?;
    let sent = sent_before(&state.pool, &ae).await.map_err(unavailable)?;
    let read = control.converge_channel_metadata(&state.relay_http, &channel, &target, sent);
    let edit = match read.await.map_err(relay_unavailable)? {
        ChannelMetadataStep::Converged(_) => return run.commit(name).await,
        ChannelMetadataStep::Refused(reason) => {
            tracing::warn!(workspace = %ae.target_id, reason, "Channel 元数据的前置条件不成立");
            return Err(conflict());
        }
        ChannelMetadataStep::Send(edit) => edit,
    };
    if req.last_round {
        let stage = format!("{STAGE}:unknown");
        let result = "EXTERNAL_RESULT_UNKNOWN";
        run.record(&stage, "OUTCOME", result, Vec::new()).await?;
        return Ok(Convergence::Unknown);
    }
    // 只对仍 ACTIVE、仍是准入时版本的 Workspace 签发：被暂停或已被新动作接管的不动
    let current: Option<i32> = sqlx::query_scalar(
        "select 1 from identity.workspace
         where id = $1 and tenant_id = $2 and version = $3 and state = 'ACTIVE'",
    )
    .bind(ae.target_id)
    .bind(ae.tenant_id)
    .bind(req.workspace_version)
    .fetch_optional(&state.pool)
    .await
    .map_err(unavailable)?;
    if current.is_none() {
        return Err(conflict());
    }
    // 预算在落 DISPATCH 之前取：取不到就既不落账也不发送
    let admitted = control.admit().map_err(relay_unavailable)?;
    let event_id = edit.id.to_hex();
    let evidence = vec![Evidence::new(EvidenceKind::BuzzEventId, &event_id)];
    let stage = format!("{STAGE}:{event_id}");
    let dispatch = format!("{stage}:dispatch");
    run.record(&dispatch, "DISPATCH", "DISPATCHED", evidence.clone())
        .await?;
    let result = match control.deliver(&state.relay_http, &edit, admitted).await {
        Delivery::Accepted => "ACCEPTED",
        Delivery::Rejected(why) => {
            tracing::warn!(reason = %why, "Relay 拒绝 Channel 元数据编辑");
            "REJECTED"
        }
        Delivery::Limited(_, why) => {
            tracing::warn!(reason = %why, "Relay 以上界拒绝 Channel 元数据编辑");
            "NOT_DELIVERED"
        }
        Delivery::Unknown(why) => {
            tracing::warn!(error = %why, "Channel 元数据编辑结果不明，按回读收敛");
            "EXTERNAL_RESULT_UNKNOWN"
        }
    };
    run.record(&stage, "OUTCOME", result, evidence).await?;
    if result == "REJECTED" {
        return Err(conflict());
    }
    // 判据是回读，不是 event ID：读不到或仍不一致都只是结果不明
    let readback = control.converge_channel_metadata(&state.relay_http, &channel, &target, true);
    match readback.await {
        Ok(ChannelMetadataStep::Converged(_)) => run.commit(name).await,
        Ok(_) => Ok(Convergence::Pending),
        Err(e) => {
            tracing::warn!(error = %e, "Channel 元数据回读失败，等下一轮");
            Ok(Convergence::Pending)
        }
    }
}

/// 本动作此前是否已签发过 9002（每次签发的 DISPATCH 审计按 event ID 落库）。
async fn sent_before(pool: &PgPool, ae: &Execution) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "select exists(select 1 from audit.audit_event
         where operation_id = $1 and event_type = 'DISPATCH' and event_key like $2)",
    )
    .bind(ae.operation_id)
    .bind(format!("{}:{STAGE}:%:dispatch", ae.operation_id))
    .fetch_one(pool)
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn update(value: Value) -> WorkspaceUpdate {
        serde_json::from_value(value).unwrap()
    }

    fn valid(value: Value) -> bool {
        normalize(&update(value)).is_ok()
    }

    #[test]
    fn update_combinations_follow_the_frozen_contract() {
        for ok in [
            json!({"name": "Release discussion"}),
            json!({"description": ""}),
            json!({"ttlSeconds": 604800}),
            json!({"clearTtl": true}),
            json!({"visibility": "open"}),
            json!({"description": "", "clearTtl": true}),
            json!({"reopen": true}),
        ] {
            assert!(valid(ok.clone()), "{ok}");
        }
        for invalid in [
            json!({}),
            json!({"reopen": false}),
            json!({"clearTtl": false}),
            json!({"reopen": true, "name": "x"}),
            json!({"reopen": true, "visibility": "private"}),
            json!({"ttlSeconds": 60, "clearTtl": true}),
            json!({"ttlSeconds": 0}),
            json!({"ttlSeconds": -1}),
            json!({"ttlSeconds": i64::from(i32::MAX) + 1}),
            json!({"name": "  "}),
            json!({"name": "# "}),
        ] {
            assert!(!valid(invalid.clone()), "{invalid}");
        }
    }

    #[test]
    fn frozen_name_is_the_relay_canonical_name() {
        let frozen = normalize(&update(json!({"name": "  # Release  "}))).unwrap();
        assert_eq!(frozen, json!({"name": "Release"}));
        let target = channel_target(&update(frozen));
        assert_eq!(target.name.as_deref(), Some("Release"));
    }

    #[test]
    fn visibility_never_reaches_the_relay_target() {
        let only_visibility = update(json!({"visibility": "open"}));
        assert!(channel_target(&only_visibility).is_empty());
        let mixed = update(json!({
            "visibility": "private",
            "description": "",
            "clearTtl": true,
        }));
        assert_eq!(
            channel_target(&mixed),
            ChannelMetadataTarget {
                name: None,
                about: Some(String::new()),
                ttl: Some(ChannelTtl::Clear),
                reopen: false,
            }
        );
        let ttl = update(json!({"ttlSeconds": 3600}));
        assert_eq!(channel_target(&ttl).ttl, Some(ChannelTtl::Seconds(3600)));
        assert!(channel_target(&update(json!({"reopen": true}))).reopen);
    }

    #[test]
    fn convergence_wire_values_are_closed() {
        assert_eq!(
            serde_json::to_value(Convergence::Converged).unwrap(),
            json!({"state": "CONVERGED"})
        );
        assert_eq!(
            serde_json::to_value(Convergence::Pending).unwrap(),
            json!({"state": "PENDING"})
        );
        assert_eq!(
            serde_json::to_value(Convergence::Unknown).unwrap(),
            json!({"state": "UNKNOWN"})
        );
    }
}
