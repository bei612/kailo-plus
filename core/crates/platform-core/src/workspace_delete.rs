//! 受治理的频道删除（DD-150，修订 DD-46 与 DD-119(7)；05 §2 `workspace.delete`；V-SCN-247）。
//!
//! 原版 9008 只限 Channel owner；Kailo 无 owner/admin 两级（DD-82），对应目标 Workspace 的
//! `manage`。动作从 Tenant scope 指向 Workspace（TENANT_ONLY）：已暂停的 Workspace scope 已
//! 关闭，仍须能被删除；权限在目标 Workspace 上检查，只接受 HUMAN，EXPLICIT 确认、无审批。
//!
//! - **准入**：锁 Workspace 行，要求 `ACTIVE` 或 `SUSPENDED` 且没有未终结的生命周期动作，同一
//!   事务置 `DELETING`（version+1）并冻结 WorkspaceLifecycleSnapshot：Workspace 范围内 Resource、
//!   Asset、owner、Installation、组件 binding 与成员关系的 ID+version 及其 digest，不保存正文。
//!   `DELETING` 与 `SUSPENDING` 一样先关闭 scope、stream、Schedule 与新动作。
//! - **删除链**（`WORKSPACE_LIFECYCLE` 的 DELETE 段，每轮由 Worker 调用 [`advance`]，每步回读确认）：
//!   1. `AGENTS`：本 Workspace 的每个 ACTIVE Installation 以发起人身份提交既有
//!      `agent.installation.disable`（同一幂等键，结果只由该动作自己的链收敛），直到全部
//!      `DISABLED`（或从未就绪的 `ERROR`）且没有在途投影；
//!   2. `RELAY`：Schedule 暂停、Huddle 临时频道归档、Channel roster 清空为只剩 CONTROL，已归档的
//!      Channel 先解档（Relay 拒绝对已归档 Channel 的其他变更），再由 CONTROL 签 9008：落 DISPATCH
//!      审计后投递，回读 39000 discovery 已不存在才算确认；
//!   3. `SPICEDB`：冻结与现存的 Workspace 范围 Resource/Asset 以及 Workspace 自身的全部
//!      relationship 删除；
//!   4. `CORE`：同一事务内 Resource/Asset 与其扩展转墓碑，Installation、绑定、委托与成员关系
//!      收尾，组件数据按声明保留并逐项登记审计，Workspace 转 `DELETED`。
//!
//! 任一步未确认即保持 `DELETING`，Worker 下一轮以同一冻结意图重试；不可逆，不提供恢复。

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use collab_bridge::bridge::Delivery;
use contracts::{EvidenceKind, ReasonCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, Postgres, Transaction};
use uuid::Uuid;

use crate::audit::Evidence;
use crate::governance::{
    audit, exact_definition_for_execution, load_execution, Actor, Definition, Execution, Params,
    Refusal, Target,
};
use crate::service_api::{authorize, unavailable, ServiceState};
use crate::tenant_lifecycle::{control_client, ProjectionDirection, RosterMode};

/// 受治理的频道删除。
pub(crate) const ACTION: &str = "workspace.delete";
const KIND: &str = "WORKSPACE_LIFECYCLE";
/// 删除前可接受的 Workspace 状态（DD-150(1)）。
pub(crate) const FROM_STATES: [&str; 2] = ["ACTIVE", "SUSPENDED"];
/// 准入落定时置入的收敛中状态。
pub(crate) const DELETING: &str = "DELETING";
/// 链中各段的证据键，也是 advance 回答的阶段名。
const AGENTS: &str = "AGENTS";
const RELAY: &str = "RELAY";
const SPICEDB: &str = "SPICEDB";
/// 本动作派生子动作与审计阶段的前缀。
const STAGE: &str = "workspace-delete";

/// workspace.delete 的唯一合法登记：Tenant scope 指向 Workspace、在目标 Workspace 上检查
/// manage、EXPLICIT 确认、无审批、由 WORKSPACE_LIFECYCLE 收敛，额度 NONE。
pub(crate) fn shape(def: &Definition) -> bool {
    def.action_key == ACTION
        && def.target_type == "WORKSPACE"
        && def.tenant_rule == "SESSION_TENANT"
        && def.workspace_rule == "TENANT_ONLY"
        && def.permission == "manage"
        && def.permission_object_type == "workspace"
        && def.confirmation_mode == "EXPLICIT"
        && def.approval_policy_id.is_none()
        && def.approval_policy_version.is_none()
        && def.execution_mode == "TEMPORAL"
        && def.workflow_kind.as_deref() == Some(KIND)
        && def.quota_policy == "NONE"
        && def.meters.is_empty()
}

/// 冻结参数的唯一合法形状：只指向一个 Workspace 并带显式确认。
pub(crate) fn params_valid(p: &Params) -> bool {
    p.workspace_id.is_some()
        && p.explicit_confirmation == Some(true)
        && p.principal_id.is_none()
        && p.invitation_id.is_none()
        && p.original_action_execution_id.is_none()
        && p.slug.is_none()
        && p.name.is_none()
        && p.workspace_update.is_none()
        && p.resource_id.is_none()
        && p.asset_id.is_none()
}

fn conflict() -> Refusal {
    Refusal::Conflict(ReasonCode::TargetStateConflict)
}

/// 删除入口的可用性只取决于删除前状态：收敛中、`ERROR` 与已删除的 Workspace 不给入口。
pub(crate) fn deletable_state(state: &str) -> bool {
    FROM_STATES.contains(&state)
}

/// 本 Tenant 中仍有未终结生命周期动作（编辑、暂停、恢复、删除）的 Workspace。已允许的动作
/// 在其 WorkflowRef 终态（或派发被确定中止）之前都未终结；`pending` 时连同尚在准入或审批中
/// 的一并计入。ActionExecution 与 WorkflowRef 是唯一事实来源，不另建在途标记。
pub(crate) async fn open_lifecycle(
    conn: &mut sqlx::PgConnection,
    tenant: Uuid,
    workspaces: &[Uuid],
    pending: bool,
) -> Result<std::collections::HashSet<Uuid>, sqlx::Error> {
    let rows: Vec<Uuid> = sqlx::query_scalar(
        "select distinct ae.target_id from admission.action_execution ae
         left join projection.workflow_ref wr on wr.workflow_id = ae.temporal_workflow_id
         where ae.tenant_id = $1 and ae.target_id = any($2)
           and ae.action_key in ('workspace.update','workspace.suspend','workspace.restore','workspace.delete')
           and ((ae.gate_state = 'ALLOWED' and ae.dispatch_state <> 'ABORTED'
                 and coalesce(wr.projection_state, 'PENDING_START') <> 'TERMINAL')
                or ($3 and ae.gate_state in ('EVALUATING', 'WAITING')))",
    )
    .bind(tenant)
    .bind(workspaces)
    .bind(pending)
    .fetch_all(&mut *conn)
    .await?;
    Ok(rows.into_iter().collect())
}

/// 解析删除目标（DD-150(1)）：同 Tenant 的 Workspace（跨 Tenant 与不存在是同一个回答），须
/// `ACTIVE` 或 `SUSPENDED`，且没有已允许而未终结的生命周期动作。`lock` 时持有 Workspace 行锁，
/// 置 DELETING 与冻结快照在同一事务里完成。执行 scope 没有 Workspace（TENANT_ONLY），权限对象
/// 是目标 Workspace，因此 `Target.workspace_id` 就是它。
pub(crate) async fn target(
    conn: &mut sqlx::PgConnection,
    tenant: Uuid,
    def: &Definition,
    p: &Params,
    frozen: Option<Uuid>,
    lock: bool,
) -> Result<Target, Refusal> {
    if !shape(def) {
        tracing::error!(action = %def.action_key, "workspace.delete 的目录形状与语义不一致");
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
    if !deletable_state(&state) || frozen.is_some_and(|id| id != ws) {
        return Err(conflict());
    }
    // 落定时本动作自己的 EVALUATING 行已在库里；在准入或审批中的同目标动作另由
    // action_execution_one_pending_per_target 拒绝，锁内只需再看已允许而未终结的。
    if !open_lifecycle(&mut *conn, tenant, &[ws], !lock)
        .await?
        .is_empty()
    {
        return Err(conflict());
    }
    Ok(Target {
        id: ws,
        version,
        workspace_id: Some(ws),
    })
}

/// 冻结 Workspace 范围内的清单。只取标识、版本、状态与 owner，不取任何业务正文。
async fn inventory(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    workspace: Uuid,
) -> Result<Value, sqlx::Error> {
    let resources: Vec<(Uuid, String, i32, String, Uuid, Option<Uuid>)> = sqlx::query_as(
        "select id, type_key, version, state, owner_principal_id, application_binding_id
         from catalog.resource where tenant_id = $1 and home_workspace_id = $2 order by id",
    )
    .bind(tenant)
    .bind(workspace)
    .fetch_all(&mut **tx)
    .await?;
    let assets: Vec<(Uuid, Uuid, i32, String, Uuid)> = sqlx::query_as(
        "select a.id, a.resource_id, a.version, a.state, a.owner_principal_id
         from catalog.asset a join catalog.resource r on r.id = a.resource_id and r.tenant_id = a.tenant_id
         where a.tenant_id = $1 and r.home_workspace_id = $2 order by a.id",
    )
    .bind(tenant)
    .bind(workspace)
    .fetch_all(&mut **tx)
    .await?;
    let installations: Vec<(Uuid, String)> = sqlx::query_as(
        "select resource_id, state from catalog.agent_installation
         where workspace_id = $1 order by resource_id",
    )
    .bind(workspace)
    .fetch_all(&mut **tx)
    .await?;
    let bindings: Vec<(Uuid, String, i32, String, bool)> = sqlx::query_as(
        "select id, component_type_key, version, state, retain_on_tenant_delete
         from catalog.application_binding where tenant_id = $1 and workspace_id = $2 order by id",
    )
    .bind(tenant)
    .bind(workspace)
    .fetch_all(&mut **tx)
    .await?;
    let memberships: Vec<(Uuid, Uuid, i32, String)> = sqlx::query_as(
        "select id, tenant_principal_id, version, state from identity.workspace_membership
         where workspace_id = $1 order by id",
    )
    .bind(workspace)
    .fetch_all(&mut **tx)
    .await?;
    let channel: Option<Uuid> = sqlx::query_scalar(
        "select channel_id from projection.workspace_buzz_binding where workspace_id = $1",
    )
    .bind(workspace)
    .fetch_optional(&mut **tx)
    .await?;
    Ok(json!({
        "workspace_id": workspace,
        "channel_id": channel,
        "resources": resources.iter().map(|(id, kind, version, state, owner, binding)| json!({
            "id": id, "type_key": kind, "version": version, "state": state,
            "owner_principal_id": owner, "application_binding_id": binding,
        })).collect::<Vec<_>>(),
        "assets": assets.iter().map(|(id, resource, version, state, owner)| json!({
            "id": id, "resource_id": resource, "version": version, "state": state,
            "owner_principal_id": owner,
        })).collect::<Vec<_>>(),
        "installations": installations.iter().map(|(id, state)| json!({
            "resource_id": id, "state": state,
        })).collect::<Vec<_>>(),
        "application_bindings": bindings.iter().map(|(id, kind, version, state, retain)| json!({
            "id": id, "component_type_key": kind, "version": version, "state": state,
            "retain_on_tenant_delete": retain,
        })).collect::<Vec<_>>(),
        "memberships": memberships.iter().map(|(id, principal, version, state)| json!({
            "id": id, "principal_id": principal, "version": version, "state": state,
        })).collect::<Vec<_>>(),
    }))
}

/// 冻结清单的 digest：清单 JSON 文本的 SHA-256。
pub(crate) fn digest(inventory: &Value) -> String {
    hex::encode(Sha256::digest(inventory.to_string().as_bytes()))
}

/// 准入落定（DD-150(1)）：Workspace 行锁下从 `ACTIVE`/`SUSPENDED` 置 `DELETING`（version+1），
/// 同一事务冻结 WorkspaceLifecycleSnapshot。条件更新只在状态与版本都未变时成立，否则按
/// 目标事实已变拒绝。返回的新版本冻结进 DELETE 段与 workflow ID。
pub(crate) async fn prewrite(
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    target: &Target,
) -> Result<i32, Refusal> {
    let previous: Option<String> = sqlx::query_scalar(
        "select state from identity.workspace
         where id = $1 and tenant_id = $2 and version = $3 for update",
    )
    .bind(target.id)
    .bind(ae.tenant_id)
    .bind(target.version)
    .fetch_optional(&mut **tx)
    .await?;
    let Some(previous) = previous.filter(|state| deletable_state(state)) else {
        return Err(conflict());
    };
    let advanced: Option<i32> = sqlx::query_scalar(
        "update identity.workspace set state = 'DELETING', version = version + 1
         where id = $1 and tenant_id = $2 and version = $3 and state = $4 returning version",
    )
    .bind(target.id)
    .bind(ae.tenant_id)
    .bind(target.version)
    .bind(&previous)
    .fetch_optional(&mut **tx)
    .await?;
    let version = advanced.ok_or_else(conflict)?;
    let frozen = inventory(tx, ae.tenant_id, target.id).await?;
    sqlx::query(
        "insert into admission.workspace_lifecycle_snapshot
             (id, tenant_id, workspace_id, action_execution_id, workspace_version, from_state,
              frozen_inventory, inventory_digest, state)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 'DELETING')",
    )
    .bind(Uuid::new_v4())
    .bind(ae.tenant_id)
    .bind(target.id)
    .bind(ae.id)
    .bind(version)
    .bind(&previous)
    .bind(&frozen)
    .bind(digest(&frozen))
    .execute(&mut **tx)
    .await?;
    Ok(version)
}

/// 派发被确定中止：不会再有 Workflow 把它带出 DELETING。与中止同事务置 `ERROR`（version+1）
/// 并把快照置 `ABORTED`，留下确定状态；此时尚未发生任何删除副作用，管理员可从 `ERROR`
/// 重新暂停后再删除。
pub(crate) async fn abort(
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "update identity.workspace set state = 'ERROR', version = version + 1
         where id = $1 and tenant_id = $2 and state = 'DELETING'",
    )
    .bind(ae.target_id)
    .bind(ae.tenant_id)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "update admission.workspace_lifecycle_snapshot set state = 'ABORTED', updated_at = now()
         where action_execution_id = $1 and state = 'DELETING'",
    )
    .bind(ae.id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// DELETE 段启动时冻结进 Workflow input 的快照：只认已允许的 workspace.delete、与 Workspace
/// 当前（DELETING）版本一致的那一个。
pub(crate) async fn frozen_snapshot(
    pool: &sqlx::PgPool,
    action: Uuid,
    tenant: Uuid,
    workspace: Uuid,
    version: i32,
) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar(
        "select s.id from admission.workspace_lifecycle_snapshot s
         join admission.action_execution ae on ae.id = s.action_execution_id
         where s.action_execution_id = $1 and s.tenant_id = $2 and s.workspace_id = $3
           and s.workspace_version = $4 and s.state = 'DELETING'
           and ae.action_key = 'workspace.delete' and ae.gate_state = 'ALLOWED'",
    )
    .bind(action)
    .bind(tenant)
    .bind(workspace)
    .bind(version)
    .fetch_optional(pool)
    .await
}

/// 本 Workspace 正在执行受治理删除：其 Installation 只接受停用（DD-150(2) 第 1 段沿既有
/// 停用链），其余 Workspace scope 的新动作照常被 DELETING 拒绝。
pub(crate) const DELETING_WITH_SNAPSHOT: &str = "(w.state = 'DELETING' and exists (
    select 1 from admission.workspace_lifecycle_snapshot s
    where s.workspace_id = w.id and s.state = 'DELETING'))";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDeleteAdvanceRequest {
    pub workspace_id: Uuid,
    pub workspace_version: i32,
    pub snapshot_id: Uuid,
}

/// 一轮推进的结论。确定的拒绝走 409，依赖不可用走 503。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDeleteAdvanceResult {
    /// `PENDING`：仍有未确认的段，Workflow 等下一轮；`DELETED`：全部确认、Workspace 已转墓碑
    state: &'static str,
    /// 尚未确认的那一段（`AGENTS`、`RELAY`、`SPICEDB`、`CORE`）；已删除时省略
    #[serde(skip_serializing_if = "Option::is_none")]
    stage: Option<&'static str>,
    snapshot_id: Uuid,
}

impl WorkspaceDeleteAdvanceResult {
    fn pending(stage: &'static str, snapshot: Uuid) -> Self {
        Self {
            state: "PENDING",
            stage: Some(stage),
            snapshot_id: snapshot,
        }
    }

    fn deleted(snapshot: Uuid) -> Self {
        Self {
            state: "DELETED",
            stage: None,
            snapshot_id: snapshot,
        }
    }
}

#[derive(FromRow)]
struct Snapshot {
    id: Uuid,
    tenant_id: Uuid,
    workspace_id: Uuid,
    action_execution_id: Uuid,
    workspace_version: i32,
    from_state: String,
    frozen_inventory: Value,
    inventory_digest: String,
    evidence: Value,
    state: String,
}

const SNAPSHOT: &str = "select id, tenant_id, workspace_id, action_execution_id, workspace_version,
    from_state, frozen_inventory, inventory_digest, evidence, state
    from admission.workspace_lifecycle_snapshot where id = $1 and workspace_id = $2";

impl Snapshot {
    fn confirmed(&self, stage: &str) -> bool {
        self.evidence
            .get(stage)
            .and_then(|v| v.get("confirmed"))
            .and_then(Value::as_bool)
            == Some(true)
    }

    fn ids(&self, list: &str, field: &str) -> Vec<Uuid> {
        self.frozen_inventory
            .get(list)
            .and_then(Value::as_array)
            .map(|rows| {
                rows.iter()
                    .filter_map(|row| row.get(field)?.as_str()?.parse().ok())
                    .collect()
            })
            .unwrap_or_default()
    }

    fn channel(&self) -> Option<Uuid> {
        self.frozen_inventory
            .get("channel_id")
            .and_then(Value::as_str)
            .and_then(|s| s.parse().ok())
    }
}

/// 一轮推进所属的已准入动作。
struct Run<'a> {
    state: &'a ServiceState,
    ae: Execution,
    def: Definition,
    snapshot: Snapshot,
}

impl Run<'_> {
    async fn audit_in(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        stage: &str,
        event_type: &str,
        result: &str,
        mut evidence: Vec<Evidence>,
    ) -> Result<(), sqlx::Error> {
        evidence.push(Evidence::new(
            EvidenceKind::WorkspaceLifecycleSnapshotId,
            self.snapshot.id,
        ));
        audit(
            tx,
            &self.ae,
            &self.def,
            &format!("{STAGE}:{stage}"),
            event_type,
            "ALLOW",
            result,
            None,
            evidence,
        )
        .await
    }

    async fn record(
        &self,
        stage: &str,
        event_type: &str,
        result: &str,
        evidence: Vec<Evidence>,
    ) -> Result<(), sqlx::Error> {
        let mut tx = self.state.pool.begin().await?;
        self.audit_in(&mut tx, stage, event_type, result, evidence)
            .await?;
        tx.commit().await
    }

    /// 某段的回读证据写入快照（同一键覆盖），并记该段结果审计。
    async fn confirm(&mut self, stage: &'static str, proof: Value) -> Result<(), sqlx::Error> {
        let mut tx = self.state.pool.begin().await?;
        let patch = json!({ stage: proof });
        sqlx::query(
            "update admission.workspace_lifecycle_snapshot
             set evidence = evidence || $2::jsonb, updated_at = now()
             where id = $1 and state = 'DELETING'",
        )
        .bind(self.snapshot.id)
        .bind(&patch)
        .execute(&mut *tx)
        .await?;
        self.audit_in(
            &mut tx,
            &format!("{}:confirmed", stage.to_lowercase()),
            "OUTCOME",
            &format!("WORKSPACE_DELETE_{stage}_CONFIRMED"),
            Vec::new(),
        )
        .await?;
        tx.commit().await?;
        if let Some(map) = self.snapshot.evidence.as_object_mut() {
            map.insert(stage.to_owned(), patch[stage].clone());
        }
        Ok(())
    }
}

/// DELETE 段的一轮推进（DD-150(2)、V-SCN-247）。
pub async fn advance(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    body: Result<Json<WorkspaceDeleteAdvanceRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if let Err(e) = authorize(&state, &headers).await {
        return e;
    }
    let Ok(Json(req)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    match advance_inner(&state, &req).await {
        Ok(Some(result)) => Json(result).into_response(),
        Ok(None) => StatusCode::CONFLICT.into_response(),
        Err(response) => response,
    }
}

async fn advance_inner(
    state: &ServiceState,
    req: &WorkspaceDeleteAdvanceRequest,
) -> Result<Option<WorkspaceDeleteAdvanceResult>, Response> {
    let snapshot: Option<Snapshot> = sqlx::query_as(SNAPSHOT)
        .bind(req.snapshot_id)
        .bind(req.workspace_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(unavailable)?;
    let Some(snapshot) = snapshot else {
        return Ok(None);
    };
    if snapshot.workspace_version != req.workspace_version
        || snapshot.inventory_digest != digest(&snapshot.frozen_inventory)
    {
        return Ok(None);
    }
    if snapshot.state == "DELETED" {
        return Ok(Some(WorkspaceDeleteAdvanceResult::deleted(snapshot.id)));
    }
    if snapshot.state != DELETING {
        return Ok(None);
    }
    let current: Option<(String, i32)> = sqlx::query_as(
        "select state, version from identity.workspace where id = $1 and tenant_id = $2",
    )
    .bind(snapshot.workspace_id)
    .bind(snapshot.tenant_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(unavailable)?;
    if current != Some((DELETING.to_owned(), snapshot.workspace_version)) {
        return Ok(None);
    }
    let ae = load_execution(&state.pool, snapshot.action_execution_id)
        .await
        .map_err(unavailable)?;
    let Some(ae) = ae.filter(|ae| {
        ae.action_key == ACTION
            && ae.gate_state == "ALLOWED"
            && ae.tenant_id == snapshot.tenant_id
            && ae.target_id == snapshot.workspace_id
    }) else {
        return Ok(None);
    };
    let def = exact_definition_for_execution(&state.pool, &ae)
        .await
        .map_err(unavailable)?;
    if !shape(&def) {
        return Ok(None);
    }
    let mut run = Run {
        state,
        ae,
        def,
        snapshot,
    };
    let snapshot_id = run.snapshot.id;
    if !run.snapshot.confirmed(AGENTS) {
        match agents(&mut run).await? {
            true => {}
            false => {
                return Ok(Some(WorkspaceDeleteAdvanceResult::pending(
                    AGENTS,
                    snapshot_id,
                )))
            }
        }
    }
    if !run.snapshot.confirmed(RELAY) {
        match relay(&mut run).await? {
            true => {}
            false => {
                return Ok(Some(WorkspaceDeleteAdvanceResult::pending(
                    RELAY,
                    snapshot_id,
                )))
            }
        }
    }
    if !run.snapshot.confirmed(SPICEDB) {
        match spicedb(&mut run).await? {
            true => {}
            false => {
                return Ok(Some(WorkspaceDeleteAdvanceResult::pending(
                    SPICEDB,
                    snapshot_id,
                )))
            }
        }
    }
    match finish(&run).await.map_err(unavailable)? {
        true => Ok(Some(WorkspaceDeleteAdvanceResult::deleted(snapshot_id))),
        false => Ok(Some(WorkspaceDeleteAdvanceResult::pending(
            "CORE",
            snapshot_id,
        ))),
    }
}

/// 第 1 段：本 Workspace 的每个 Installation 沿既有 `agent.installation.disable` 收尾。
///
/// 子动作以本删除的发起人提交（Installation `manage` 含 `home_workspace->manage`），幂等键由
/// 本 ActionExecution 与 Installation 派生，重试只回读同一个子动作，从不另起第二条停用链。
/// 只有全部 Installation 已 `DISABLED`（或从未就绪的 `ERROR`）且没有在途投影才确认。
async fn agents(run: &mut Run<'_>) -> Result<bool, Response> {
    let rows: Vec<(Uuid, String, i32, Option<Uuid>)> = sqlx::query_as(
        "select i.resource_id, i.state, r.version, r.projection_action_execution_id
         from catalog.agent_installation i join catalog.resource r on r.id = i.resource_id
         where i.workspace_id = $1 and r.tenant_id = $2 order by i.resource_id",
    )
    .bind(run.snapshot.workspace_id)
    .bind(run.snapshot.tenant_id)
    .fetch_all(&run.state.pool)
    .await
    .map_err(unavailable)?;
    let mut settled = true;
    let mut disabled = Vec::new();
    for (installation, state, version, projection) in rows {
        match (state.as_str(), projection) {
            ("DISABLED" | "ERROR", None) => disabled.push(json!(installation)),
            ("ACTIVE", None) => {
                settled = false;
                submit_disable(run, installation, version).await?;
            }
            // DRAINING、PROVISIONING 或在途投影：由各自的链收敛，下一轮再看
            _ => settled = false,
        }
    }
    if !settled {
        return Ok(false);
    }
    run.confirm(
        AGENTS,
        json!({"confirmed": true, "installations": disabled}),
    )
    .await
    .map_err(unavailable)?;
    Ok(true)
}

/// 停用子动作的幂等键：同一删除、同一 Installation 永远是同一个。
pub(crate) fn disable_key(delete: Uuid, installation: Uuid) -> Uuid {
    Uuid::new_v5(&delete, installation.as_bytes())
}

async fn submit_disable(run: &Run<'_>, installation: Uuid, version: i32) -> Result<(), Response> {
    let human: Option<Uuid> = sqlx::query_scalar(
        "select tm.human_identity_id from identity.tenant_membership tm
         where tm.tenant_principal_id = $1 and tm.tenant_id = $2 and tm.state = 'ACTIVE'",
    )
    .bind(run.ae.initiator_principal_id)
    .bind(run.ae.tenant_id)
    .fetch_optional(&run.state.pool)
    .await
    .map_err(unavailable)?;
    let Some(human) = human else {
        // 发起人已不是 ACTIVE 成员：停用无从准入，保持 DELETING 并留下审计
        run.record(
            "agents:initiator-inactive",
            "OUTCOME",
            "EXTERNAL_RESULT_UNKNOWN",
            Vec::new(),
        )
        .await
        .map_err(unavailable)?;
        return Ok(());
    };
    let command: contracts::ActionCommand = match serde_json::from_value(json!({
        "actionKey": crate::agent_installation::lifecycle::DISABLE_ACTION,
        "idempotencyKey": disable_key(run.ae.id, installation),
        "resourceId": installation,
        "resourceVersion": version,
        "explicitConfirmation": true,
    })) {
        Ok(command) => command,
        Err(_) => return Err(StatusCode::INTERNAL_SERVER_ERROR.into_response()),
    };
    let actor = Actor {
        tenant_id: run.ae.tenant_id,
        principal_id: run.ae.initiator_principal_id,
        human_identity_id: Some(human),
    };
    match run.state.governance.submit(actor, &command).await {
        Ok((_, receipt)) => {
            tracing::info!(installation = %installation, gate = ?receipt.gate_state,
                dispatch = ?receipt.dispatch_state, "频道删除：Installation 停用子动作已提交");
        }
        Err((refusal, _)) => {
            tracing::warn!(installation = %installation, refusal = ?refusal,
                "频道删除：Installation 停用子动作未准入，下一轮重试");
        }
    }
    Ok(())
}

/// 第 2 段：Schedule、Huddle、roster、解档，最后 CONTROL 9008 并回读 discovery 已不存在。
async fn relay(run: &mut Run<'_>) -> Result<bool, Response> {
    let Some(channel) = run.snapshot.channel() else {
        // 协作面从未建立：没有 Channel 可删，确认这一段
        run.confirm(RELAY, json!({"confirmed": true, "channel_id": null}))
            .await
            .map_err(unavailable)?;
        return Ok(true);
    };
    let (tenant, workspace) = (run.snapshot.tenant_id, run.snapshot.workspace_id);
    match crate::automation::converge_scope_schedules(
        run.state,
        tenant,
        Some(workspace),
        run.snapshot.workspace_version,
        true,
    )
    .await
    {
        Ok(true) => {}
        Ok(false) => return Ok(false),
        Err(e) => return Err(unavailable(e)),
    }
    let (control, _) = control_client(run.state, tenant, ProjectionDirection::Withdraw).await?;
    if let Err(e) = crate::huddle::archive_workspace(run.state, &control, tenant, workspace).await {
        tracing::warn!(error = %e, workspace = %workspace, "删除前归档 Huddle 临时频道未收敛");
        return Ok(false);
    }
    let channel_id = channel.to_string();
    let present = match control.channel_metadata(&run.state.http, &channel_id).await {
        Ok(event) => event.is_some(),
        Err(e) => {
            tracing::warn!(error = %e, "删除前读取 Channel discovery 失败");
            return Ok(false);
        }
    };
    if present {
        match crate::tenant_lifecycle::converge_channel_roster(
            run.state,
            &control,
            tenant,
            workspace,
            channel,
            RosterMode::Clear,
        )
        .await?
        {
            true => {}
            false => return Ok(false),
        }
        // Relay 拒绝对已归档 Channel 的除解档外的一切变更；roster 已清空，解档不暴露任何内容
        if run.snapshot.from_state == "SUSPENDED"
            || matches!(
                control.channel_archived(&run.state.http, &channel_id).await,
                Ok(Some(true))
            )
        {
            match control
                .converge_channel_archived(&run.state.http, &channel_id, false)
                .await
            {
                Ok(true) => {}
                Ok(false) => return Ok(false),
                Err(e) => {
                    tracing::warn!(error = %e, "删除前解档 Channel 未收敛");
                    return Ok(false);
                }
            }
        }
        let event = match control.sign_channel_delete(&channel_id) {
            Ok(event) => event,
            Err(e) => {
                tracing::warn!(error = %e, "9008 签名失败");
                return Ok(false);
            }
        };
        let admitted = match control.admit() {
            Ok(admitted) => admitted,
            Err(e) => {
                tracing::warn!(error = %e, "9008 投递预算不可用");
                return Ok(false);
            }
        };
        let event_id = event.id.to_hex();
        let evidence = vec![Evidence::new(EvidenceKind::BuzzEventId, &event_id)];
        let stage = format!("channel-delete:{event_id}");
        run.record(
            &format!("{stage}:dispatch"),
            "DISPATCH",
            "DISPATCHED",
            evidence.clone(),
        )
        .await
        .map_err(unavailable)?;
        let result = match control.deliver(&run.state.http, &event, admitted).await {
            Delivery::Accepted => "ACCEPTED",
            Delivery::Rejected(why) => {
                tracing::warn!(reason = %why, "Relay 拒绝 9008");
                "REJECTED"
            }
            Delivery::Limited(_, why) => {
                tracing::warn!(reason = %why, "Relay 以上界拒绝 9008");
                "NOT_DELIVERED"
            }
            Delivery::Unknown(why) => {
                tracing::warn!(error = %why, "9008 结果不明，按回读收敛");
                "EXTERNAL_RESULT_UNKNOWN"
            }
        };
        run.record(&stage, "OUTCOME", result, evidence)
            .await
            .map_err(unavailable)?;
        // 判据是回读：discovery 仍在即结果不明，下一轮重签（9008 重放是幂等的软删除）
        match control.channel_metadata(&run.state.http, &channel_id).await {
            Ok(None) => {}
            Ok(Some(_)) => return Ok(false),
            Err(e) => {
                tracing::warn!(error = %e, "9008 回读失败，等下一轮");
                return Ok(false);
            }
        }
    }
    run.confirm(RELAY, json!({"confirmed": true, "channel_id": channel}))
        .await
        .map_err(unavailable)?;
    Ok(true)
}

/// 第 3 段：冻结与现存的 Workspace 范围 Resource/Asset 与 Workspace 自身的全部 relationship。
async fn spicedb(run: &mut Run<'_>) -> Result<bool, Response> {
    let (tenant, workspace) = (run.snapshot.tenant_id, run.snapshot.workspace_id);
    let mut objects: Vec<(&'static str, Uuid)> = Vec::new();
    for id in run.snapshot.ids("resources", "id") {
        objects.push(("resource", id));
    }
    for id in run.snapshot.ids("assets", "id") {
        objects.push(("asset", id));
    }
    let current: Vec<(String, Uuid)> = sqlx::query_as(
        "select 'resource', id from catalog.resource where tenant_id = $1 and home_workspace_id = $2
         union all
         select 'asset', a.id from catalog.asset a join catalog.resource r on r.id = a.resource_id
           and r.tenant_id = a.tenant_id where a.tenant_id = $1 and r.home_workspace_id = $2",
    )
    .bind(tenant)
    .bind(workspace)
    .fetch_all(&run.state.pool)
    .await
    .map_err(unavailable)?;
    for (kind, id) in current {
        let kind = if kind == "asset" { "asset" } else { "resource" };
        if !objects.contains(&(kind, id)) {
            objects.push((kind, id));
        }
    }
    objects.push(("workspace", workspace));
    let mut revisions = serde_json::Map::new();
    for (kind, id) in &objects {
        match run
            .state
            .governance
            .spicedb
            .delete_object(&run.state.http, kind, *id)
            .await
        {
            Ok(token) => {
                revisions.insert(format!("{kind}:{id}"), Value::String(token));
            }
            Err(e) => {
                tracing::warn!(error = %e, object = %id, "SpiceDB 关系删除未确认，等下一轮");
                return Ok(false);
            }
        }
    }
    run.confirm(SPICEDB, json!({"confirmed": true, "revisions": revisions}))
        .await
        .map_err(unavailable)?;
    Ok(true)
}

/// 第 4 段：同一事务内转墓碑并收尾，Workspace 转 `DELETED`。历史 operation、Workflow、审计、
/// 审批投影与已结算用量都不删；保留的 FK 目标是墓碑，不再是可用 scope 或 binding。组件数据
/// 按各组件声明的删除能力处理：一期全部内置组件的删除能力为 `BLOCKED`（GAP-LCM-01），按
/// `retain_on_tenant_delete` 保留并逐项登记为“保留”，关系已删除，Kailo 内不再可达。
async fn finish(run: &Run<'_>) -> Result<bool, sqlx::Error> {
    let (tenant, workspace) = (run.snapshot.tenant_id, run.snapshot.workspace_id);
    let mut tx = run.state.pool.begin().await?;
    let current: Option<(String, i32)> = sqlx::query_as(
        "select state, version from identity.workspace where id = $1 and tenant_id = $2 for update",
    )
    .bind(workspace)
    .bind(tenant)
    .fetch_optional(&mut *tx)
    .await?;
    if current != Some((DELETING.to_owned(), run.snapshot.workspace_version)) {
        return Ok(false);
    }
    // 未终结的回合仍在本 Workspace：停用链未真正排空，不转墓碑
    let running: bool = sqlx::query_scalar(
        "select exists(select 1 from catalog.agent_invocation
         where workspace_id = $1 and status not in ('COMPLETED','FAILED','CANCELED'))",
    )
    .bind(workspace)
    .fetch_one(&mut *tx)
    .await?;
    if running {
        return Ok(false);
    }
    // 每条语句都同时约束 Tenant（$1）与 Workspace（$2）
    const IN_WORKSPACE: &str =
        "(select id from catalog.resource where tenant_id = $1 and home_workspace_id = $2)";
    const OWN_WORKSPACE: &str = "(select id from identity.workspace where tenant_id = $1)";
    for sql in [
        "update admission.delegation_grant set state='REVOKED',version=version+1 where tenant_id=$1 and workspace_id=$2 and state in ('ACTIVE','REVOKING')".to_owned(),
        format!("update catalog.agent_installation set state='DISABLED',active_projection_generation=null where workspace_id=$2 and resource_id in {IN_WORKSPACE}"),
        format!("update catalog.agent_runtime_projection set state='REVOKED' where installation_resource_id in {IN_WORKSPACE} and state<>'REVOKED'"),
        format!("update catalog.channel_agent_binding set status='DISABLED' where workspace_id=$2 and installation_resource_id in {IN_WORKSPACE} and status<>'DISABLED'"),
        format!("update catalog.agent_memory_binding set state='REVOKED',version=version+1 where installation_resource_id in {IN_WORKSPACE} and state<>'REVOKED'"),
        format!("update catalog.agent_model_binding set secret_status='REVOKED' where installation_resource_id in {IN_WORKSPACE} and secret_status<>'REVOKED'"),
        format!("update catalog.automation_definition set state='DISABLED',pinned_version_asset_id=null,version=version+1 where state<>'DELETED' and resource_id in {IN_WORKSPACE}"),
        format!("update catalog.automation_version set state='RETIRED' where automation_resource_id in {IN_WORKSPACE} and state<>'RETIRED'"),
        format!("update catalog.automation_webhook_delivery set payload=null where tenant_id=$1 and payload is not null and automation_resource_id in {IN_WORKSPACE}"),
        format!("update catalog.asset set state='DELETED',version=version+1,projection_action_execution_id=null where tenant_id=$1 and state<>'DELETED' and resource_id in {IN_WORKSPACE}"),
        format!("update catalog.tool_definition set status='DELETED' where resource_id in {IN_WORKSPACE} and status<>'DELETED'"),
        format!("update catalog.mcp_connection set state='DELETED',version=version+1,updated_at=now() where tenant_id=$1 and state<>'DELETED' and resource_id in {IN_WORKSPACE}"),
        "update catalog.resource set state='DELETED',version=version+1,projection_action_execution_id=null where tenant_id=$1 and home_workspace_id=$2 and state<>'DELETED'".to_owned(),
        format!("update identity.workspace_membership set state='REVOKED',version=version+1 where workspace_id=$2 and workspace_id in {OWN_WORKSPACE} and state<>'REVOKED'"),
        format!("update projection.workspace_buzz_binding set state='DISABLED',version=version+1 where workspace_id=$2 and workspace_id in {OWN_WORKSPACE} and state<>'DISABLED'"),
        "update projection.huddle_buzz_binding set state='ENDED',ended_at=now(),version=version+1,updated_at=now() where tenant_id=$1 and parent_workspace_id=$2 and state in ('PROVISIONING','ACTIVE')".to_owned(),
    ] {
        sqlx::query(&sql)
            .bind(tenant)
            .bind(workspace)
            .execute(&mut *tx)
            .await?;
    }
    // 组件数据：逐项登记保留，binding 行原样作为历史引用
    let bindings: Vec<(Uuid, String, bool)> = sqlx::query_as(
        "select id, component_type_key, retain_on_tenant_delete from catalog.application_binding
         where tenant_id = $1 and workspace_id = $2 order by id",
    )
    .bind(tenant)
    .bind(workspace)
    .fetch_all(&mut *tx)
    .await?;
    for (binding, component, retain) in &bindings {
        run.audit_in(
            &mut tx,
            &format!("component-retained:{binding}"),
            "RECONCILIATION",
            if *retain {
                "COMPONENT_DATA_RETAINED"
            } else {
                "COMPONENT_DATA_RETAINED_DELETE_BLOCKED"
            },
            vec![Evidence::new(EvidenceKind::ApplicationBindingId, binding)],
        )
        .await?;
        tracing::info!(binding = %binding, component = %component, retain, "频道删除：组件数据按声明保留");
    }
    sqlx::query(
        "update identity.workspace set state = 'DELETED', version = version + 1
         where id = $1 and tenant_id = $2 and state = 'DELETING' and version = $3",
    )
    .bind(workspace)
    .bind(tenant)
    .bind(run.snapshot.workspace_version)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "update admission.workspace_lifecycle_snapshot
         set state = 'DELETED', evidence = evidence || $2::jsonb, updated_at = now()
         where id = $1 and state = 'DELETING'",
    )
    .bind(run.snapshot.id)
    .bind(json!({"CORE": {"confirmed": true, "retained_bindings": bindings.len()}}))
    .execute(&mut *tx)
    .await?;
    run.audit_in(
        &mut tx,
        "completed",
        "RECONCILIATION",
        "DELETED",
        Vec::new(),
    )
    .await?;
    tx.commit().await?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn definition() -> Definition {
        Definition {
            action_key: ACTION.into(),
            version: 1,
            component_type_key: "core".into(),
            target_type: "WORKSPACE".into(),
            tenant_rule: "SESSION_TENANT".into(),
            workspace_rule: "TENANT_ONLY".into(),
            permission: "manage".into(),
            permission_object_type: "workspace".into(),
            confirmation_mode: "EXPLICIT".into(),
            approval_policy_id: None,
            approval_policy_version: None,
            workflow_kind: Some(KIND.into()),
            result_exposure: "NONE".into(),
            execution_mode: "TEMPORAL".into(),
            quota_policy: "NONE".into(),
            meters: Vec::new(),
            role_template_key: None,
            role_template_version: None,
        }
    }

    #[test]
    fn only_the_registered_shape_is_admitted() {
        assert!(shape(&definition()));
        for broken in [
            Definition {
                workspace_rule: "WORKSPACE_REQUIRED".into(),
                ..definition()
            },
            Definition {
                permission_object_type: "tenant".into(),
                ..definition()
            },
            Definition {
                permission: "discover".into(),
                ..definition()
            },
            Definition {
                confirmation_mode: "NONE".into(),
                ..definition()
            },
            Definition {
                approval_policy_id: Some(Uuid::nil()),
                ..definition()
            },
            Definition {
                execution_mode: "SYNC".into(),
                ..definition()
            },
            Definition {
                workflow_kind: Some("TENANT_LIFECYCLE".into()),
                ..definition()
            },
            Definition {
                action_key: "workspace.suspend".into(),
                ..definition()
            },
        ] {
            assert!(!shape(&broken), "{broken:?}");
        }
    }

    #[test]
    fn params_name_one_workspace_with_explicit_confirmation() {
        let ok = Params {
            workspace_id: Some(Uuid::new_v4()),
            explicit_confirmation: Some(true),
            ..Params::default()
        };
        assert!(params_valid(&ok));
        assert!(!params_valid(&Params {
            explicit_confirmation: None,
            ..ok.clone()
        }));
        assert!(!params_valid(&Params {
            explicit_confirmation: Some(false),
            ..ok.clone()
        }));
        assert!(!params_valid(&Params {
            workspace_id: None,
            ..ok.clone()
        }));
        assert!(!params_valid(&Params {
            principal_id: Some(Uuid::new_v4()),
            ..ok.clone()
        }));
        assert!(!params_valid(&Params {
            name: Some("x".into()),
            ..ok
        }));
    }

    #[test]
    fn only_active_and_suspended_workspaces_are_deletable() {
        for state in ["ACTIVE", "SUSPENDED"] {
            assert!(deletable_state(state));
        }
        for state in [
            "PROVISIONING",
            "SUSPENDING",
            "RESTORING",
            "DELETING",
            "DELETED",
            "ERROR",
        ] {
            assert!(!deletable_state(state), "{state}");
        }
    }

    #[test]
    fn child_disable_keys_are_stable_per_delete_and_installation() {
        let (delete, a, b) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
        assert_eq!(disable_key(delete, a), disable_key(delete, a));
        assert_ne!(disable_key(delete, a), disable_key(delete, b));
        assert_ne!(disable_key(delete, a), disable_key(Uuid::new_v4(), a));
    }

    #[test]
    fn inventory_digest_changes_with_any_frozen_fact() {
        let one = json!({"workspace_id": Uuid::nil(), "resources": []});
        let two = json!({"workspace_id": Uuid::nil(), "resources": [{"id": Uuid::nil()}]});
        assert_eq!(digest(&one), digest(&one.clone()));
        assert_ne!(digest(&one), digest(&two));
        assert_eq!(digest(&one).len(), 64);
    }

    #[test]
    fn advance_wire_values_are_closed() {
        let id = Uuid::nil();
        assert_eq!(
            serde_json::to_value(WorkspaceDeleteAdvanceResult::pending(AGENTS, id)).unwrap(),
            json!({"state": "PENDING", "stage": "AGENTS", "snapshotId": id})
        );
        assert_eq!(
            serde_json::to_value(WorkspaceDeleteAdvanceResult::deleted(id)).unwrap(),
            json!({"state": "DELETED", "snapshotId": id})
        );
    }
}
