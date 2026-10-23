//! DD-49、03 §6、17 §8：显式 HUMAN 授权只由同一 governed Action 写入。
//! Grant 是限制，不是 permission；没有已实现的 Agent 动作时确定拒绝。

use chrono::{DateTime, Utc};
use contracts::ReasonCode;
use sha2::{Digest, Sha256};
use sqlx::{PgConnection, Postgres, Transaction};
use uuid::Uuid;

use super::{Definition, Execution, Governance, Params, Refusal, Semantic, Target};

#[derive(sqlx::FromRow)]
pub(crate) struct Installation {
    pub(crate) id: Uuid,
    tenant_id: Uuid,
    pub(crate) workspace_id: Uuid,
    owner_principal_id: Uuid,
    pub(crate) agent_principal_id: Uuid,
    pub(crate) version: i32,
}

#[cfg(test)]
mod cancellation_tests {
    use super::{
        cancellation_required, metadata_output_schema_hashes, output_schema_hash, schema_hash,
    };
    use chrono::{TimeDelta, Utc};

    #[test]
    fn only_known_revocation_or_wall_clock_expiry_cancels() {
        let now = chrono::DateTime::<Utc>::from_timestamp(100, 0).unwrap();
        let future = now + TimeDelta::seconds(1);
        assert!(!cancellation_required("ACTIVE", future, now).unwrap());
        assert!(cancellation_required("ACTIVE", now, now).unwrap());
        assert!(cancellation_required("ACTIVE", now - TimeDelta::seconds(1), now).unwrap());
        for state in ["REVOKING", "REVOKED", "EXPIRED", "SUPERSEDED"] {
            assert!(cancellation_required(state, future, now).unwrap());
        }
        for state in ["", "PAUSED", "DISABLED", "FUTURE_STATE"] {
            assert!(cancellation_required(state, future, now).is_err());
        }
    }

    #[test]
    fn effective_state_is_active_only_when_usable() {
        use super::effective_state;
        let now = chrono::DateTime::<Utc>::from_timestamp(100, 0).unwrap();
        let past = now - TimeDelta::seconds(10);
        let future = now + TimeDelta::seconds(10);
        let active = |max, uses, ok| effective_state("ACTIVE", now, past, future, max, uses, ok);
        assert_eq!(active(None, 0, true), Some("ACTIVE"));
        assert_eq!(active(Some(3), 2, true), Some("ACTIVE"));
        // DD-126(4): a consent change is never shown as ACTIVE.
        assert_eq!(active(None, 0, false), Some("NEEDS_RENEWAL"));
        assert_eq!(active(Some(2), 2, false), Some("USES_EXHAUSTED"));
        let at = |from, until| effective_state("ACTIVE", now, from, until, None, 0, true);
        assert_eq!(at(future, future), Some("NOT_YET_VALID"));
        // Persisted ACTIVE past expiry before reconciliation is already EXPIRED.
        assert_eq!(at(past, now), Some("EXPIRED"));
        for persisted in ["REVOKING", "REVOKED", "SUPERSEDED", "EXPIRED"] {
            let state = effective_state(persisted, now, past, future, None, 0, true);
            assert_eq!(state, Some(persisted));
        }
        let unknown = effective_state("FUTURE", now, past, future, None, 0, true);
        assert_eq!(unknown, None);
    }

    #[test]
    fn metadata_output_compatibility_is_exact_and_action_scoped() {
        let old = schema_hash(include_str!(
            "../../../../contracts/compatibility/action-submission-v1.json"
        ));
        let extended = schema_hash(include_str!(
            "../../../../contracts/compatibility/action-submission-v2.json"
        ));
        assert_eq!(
            old,
            "fb2d299d4cdc34507fd41dbc311609b4315b01bd2f4650a2f3207641afeedcc9"
        );
        assert_eq!(
            extended,
            "1bf219fdb0b7cd39707273b16f219ce4f6b7d70f802795abf21060ec7e4589be"
        );
        for action in ["agent.invoke", "automation.run"] {
            let accepted = metadata_output_schema_hashes(action);
            assert_eq!(
                accepted,
                vec![output_schema_hash(), old.clone(), extended.clone()]
            );
            assert!(!accepted.contains(&"0".repeat(64)));
            assert!(!accepted.contains(&schema_hash("unknown future output")));
        }
        for action in [
            "agent.memory.entry.read",
            "tenant.member.invite",
            "document.open",
            "unknown.action",
            "",
        ] {
            assert!(metadata_output_schema_hashes(action).is_empty());
        }
    }

    #[test]
    fn ordinary_execution_submission_matches_metadata_contract_without_credentials() {
        let id = uuid::Uuid::new_v4();
        let schema: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../contracts/api/delegated_action_metadata_v1.schema.json"
        ))
        .unwrap();
        for action in [
            "agent.invoke",
            "automation.run",
            "resource.create",
            "resource.grant_read",
            "resource.revoke_read",
        ] {
            let execution = super::Execution {
                id,
                operation_id: id,
                tenant_id: id,
                workspace_id: Some(id),
                action_key: action.into(),
                action_version: 1,
                initiator_principal_id: id,
                actor_principal_id: id,
                target_id: id,
                parameter_hash: "0".repeat(64),
                parameters: None,
                temporal_workflow_id: Some(id.to_string()),
                cancel_first_run_id: None,
                approval_workflow_id: None,
                approval_expires_at: None,
                gate_state: "ALLOWED".into(),
                dispatch_state: "DISPATCHED".into(),
                reason_code: None,
                correlation_id: id,
                updated_at: Utc::now(),
            };
            let actual = serde_json::to_value(execution.submission()).unwrap();
            let metadata: contracts::DelegatedActionMetadataV1 =
                serde_json::from_value(actual.clone()).unwrap();
            assert_eq!(serde_json::to_value(metadata).unwrap(), actual);
            for field in actual.as_object().unwrap().keys() {
                assert!(
                    schema["properties"].get(field).is_some(),
                    "{action}: unexpected {field}"
                );
            }
            for field in ["invitation", "protocolSessionId", "documentLaunch"] {
                assert!(actual.get(field).is_none());
            }
        }
    }
}

pub(crate) async fn installation(
    conn: &mut PgConnection,
    tenant: Uuid,
    id: Uuid,
    lock: bool,
    allow_draining: bool,
) -> Result<Option<Installation>, sqlx::Error> {
    sqlx::query_as(&format!(
        "select r.id,r.tenant_id,i.workspace_id,r.owner_principal_id,i.agent_principal_id,r.version
         from catalog.resource r join catalog.agent_installation i on i.resource_id=r.id
         join identity.workspace w on w.id=i.workspace_id and w.tenant_id=r.tenant_id
         join identity.principal p on p.id=i.agent_principal_id and p.tenant_id=r.tenant_id
         join identity.principal owner on owner.id=r.owner_principal_id and owner.tenant_id=r.tenant_id
         join identity.tenant_membership tm on tm.tenant_principal_id=owner.id and tm.tenant_id=r.tenant_id
         where r.id=$1 and r.tenant_id=$2 and r.type_key='agent.installation'
           and r.home_workspace_id=w.id and r.state='ACTIVE'
           and w.state='ACTIVE'
           and p.kind='AGENT' and p.status='ACTIVE'
           and owner.kind='HUMAN' and owner.status='ACTIVE' and tm.state='ACTIVE'
           and ((i.state='ACTIVE' and r.projection_action_execution_id is null)
             or ($3 and i.state='DRAINING' and catalog.agent_generation_admitted(i.resource_id,i.pinned_version_asset_id,i.active_projection_generation)))
           and i.active_projection_generation is not null{}",
        if lock { " for update of r,i,w,p,owner,tm" } else { "" }
    ))
    .bind(id).bind(tenant).bind(allow_draining).fetch_optional(conn).await
}

pub(crate) async fn projection_matches(
    g: &Governance,
    row: &Installation,
) -> Result<bool, Refusal> {
    g.spicedb
        .resource_projection_matches_in_workspace(
            &row.id.to_string(),
            &row.tenant_id.to_string(),
            &row.owner_principal_id.to_string(),
            Some(&row.workspace_id.to_string()),
            g.cfg.relationship_page,
        )
        .await
        .map_err(|_| Refusal::Unavailable("Installation 授权投影不可核验".into()))
}

pub(super) async fn target(
    conn: &mut PgConnection,
    tenant: Uuid,
    def: &Definition,
    sem: Semantic,
    params: &Params,
    frozen: Option<Uuid>,
    lock: bool,
) -> Result<Target, Refusal> {
    if def.target_type != "RESOURCE"
        || def.permission_object_type != "resource"
        || def.permission != "delegate"
        || def.tenant_rule != "SESSION_TENANT"
        || def.workspace_rule != "TARGET_HOME_WORKSPACE"
        || def.execution_mode != "SYNC"
        || !matches!(
            def.confirmation_mode.as_str(),
            "NONE" | "EXPLICIT" | "APPROVAL"
        )
    {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    let id = params
        .resource_id
        .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
    let row = installation(
        conn,
        tenant,
        id,
        lock,
        sem == Semantic::AgentDelegationRevoke,
    )
    .await?
    .filter(|r| Some(r.version) == params.resource_version && frozen.is_none_or(|id| id == r.id))
    .ok_or(Refusal::Conflict(ReasonCode::TargetStateConflict))?;
    Ok(Target {
        id: row.id,
        version: row.version,
        workspace_id: Some(row.workspace_id),
    })
}

/// 目录与实际 dispatch 的交集。仅03/05允许 Agent 代 HUMAN 的普通动作可进入；
/// 这些键尚无 Semantic/handler，不能把登记一行或管理动作当成可执行授权。
fn has_agent_consumer(key: &str) -> bool {
    matches!(
        key,
        "resource.create" | "resource.grant_read" | "resource.revoke_read"
    ) && Semantic::from_key(key).is_some()
}

pub(crate) fn output_schema_hash() -> String {
    schema_hash(include_str!(
        "../../../../contracts/api/delegated_action_metadata_v1.schema.json"
    ))
}

fn schema_hash(schema: &str) -> String {
    format!("{:x}", Sha256::digest(schema.as_bytes()))
}

/// Only ordinary metadata actions shared the old BFF envelope. Tool/application
/// and memory contracts retain their own exact hashes and never enter this path.
pub(crate) fn metadata_output_schema_hashes(action: &str) -> Vec<String> {
    if !matches!(action, "agent.invoke" | "automation.run") && !has_agent_consumer(action) {
        return Vec::new();
    }
    [
        include_str!("../../../../contracts/api/delegated_action_metadata_v1.schema.json"),
        include_str!("../../../../contracts/compatibility/action-submission-v1.json"),
        include_str!("../../../../contracts/compatibility/action-submission-v2.json"),
    ]
    .into_iter()
    .map(schema_hash)
    .collect()
}

pub(super) fn normalize(
    mut grant: contracts::DelegationGrantParameters,
) -> Result<contracts::DelegationGrantParameters, Refusal> {
    let bad = || Refusal::Precondition(ReasonCode::InvalidParameters);
    grant.valid_from = DateTime::parse_from_rfc3339(&grant.valid_from)
        .map_err(|_| bad())?
        .with_timezone(&Utc)
        .to_rfc3339_opts(chrono::SecondsFormat::AutoSi, true);
    grant.expires_at = DateTime::parse_from_rfc3339(&grant.expires_at)
        .map_err(|_| bad())?
        .with_timezone(&Utc)
        .to_rfc3339_opts(chrono::SecondsFormat::AutoSi, true);
    for scope in &mut grant.scopes {
        i32::try_from(scope.action_version)
            .ok()
            .filter(|v| *v > 0)
            .ok_or_else(bad)?;
        for text in [
            &mut scope.target_id,
            &mut scope.create_workspace_id,
            &mut scope.tool_resource_id,
        ]
        .into_iter()
        .flatten()
        {
            let id = Uuid::parse_str(text).map_err(|_| bad())?;
            if id.is_nil() {
                return Err(bad());
            }
            *text = id.to_string();
        }
    }
    // DD-126(5): a renewal names exactly one replaced Grant and its version (CAS).
    let version = grant.renews_delegation_version;
    match (grant.renews_delegation_id.as_mut(), version) {
        (None, None) => {}
        (Some(id), Some(version)) => {
            let parsed = Uuid::parse_str(id).map_err(|_| bad())?;
            if parsed.is_nil() || i32::try_from(version).ok().filter(|v| *v > 0).is_none() {
                return Err(bad());
            }
            *id = parsed.to_string();
        }
        _ => return Err(bad()),
    }
    grant.scopes.sort_by_key(|scope| {
        (
            scope.action_key.clone(),
            scope.action_version,
            scope.target_type.clone(),
            scope.target_id.clone(),
            scope.create_workspace_id.clone(),
            scope.tool_resource_id.clone(),
            scope.output_schema_hash.clone(),
            scope.redaction_policy.clone(),
        )
    });
    Ok(grant)
}

pub(super) async fn target_gate(
    g: &Governance,
    conn: &mut PgConnection,
    tenant: Uuid,
    initiator: Uuid,
    sem: Semantic,
    params: &Params,
) -> Result<(), Refusal> {
    let id = params
        .resource_id
        .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
    let row = installation(
        conn,
        tenant,
        id,
        false,
        sem == Semantic::AgentDelegationRevoke,
    )
    .await?
    .ok_or(Refusal::Conflict(ReasonCode::TargetStateConflict))?;
    let grant_id = params
        .delegation_id
        .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
    if sem == Semantic::AgentDelegationRevoke {
        let exists: bool = sqlx::query_scalar(
            "select exists(select 1 from admission.delegation_grant
            where id=$1 and tenant_id=$2 and workspace_id=$3 and installation_resource_id=$4
              and version=$5 and state in ('ACTIVE','REVOKING'))",
        )
        .bind(grant_id)
        .bind(tenant)
        .bind(row.workspace_id)
        .bind(id)
        .bind(params.delegation_version)
        .fetch_one(conn)
        .await?;
        return if exists {
            Ok(())
        } else {
            Err(Refusal::Conflict(ReasonCode::TargetStateConflict))
        };
    }
    let grant = params
        .delegation_grant
        .as_ref()
        .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
    let from = DateTime::parse_from_rfc3339(&grant.valid_from)
        .map_err(|_| Refusal::Precondition(ReasonCode::InvalidParameters))?
        .with_timezone(&Utc);
    let until = DateTime::parse_from_rfc3339(&grant.expires_at)
        .map_err(|_| Refusal::Precondition(ReasonCode::InvalidParameters))?
        .with_timezone(&Utc);
    let valid: bool = sqlx::query_scalar("select $1 < $2 and $2 > now()")
        .bind(from)
        .bind(until)
        .fetch_one(&mut *conn)
        .await?;
    if !valid || grant.scopes.is_empty() || grant.max_uses.is_some_and(|n| n <= 0) {
        return Err(Refusal::Precondition(ReasonCode::InvalidParameters));
    }
    let exists: bool =
        sqlx::query_scalar("select exists(select 1 from admission.delegation_grant where id=$1)")
            .bind(grant_id)
            .fetch_one(&mut *conn)
            .await?;
    if exists {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    let mut scopes = std::collections::HashSet::new();
    for scope in &grant.scopes {
        if !scopes.insert((
            scope.action_key.clone(),
            scope.action_version,
            scope.target_type.clone(),
            scope.target_id.clone(),
            scope.create_workspace_id.clone(),
            scope.tool_resource_id.clone(),
        )) {
            return Err(Refusal::Precondition(ReasonCode::InvalidParameters));
        }
        validate_scope(g, conn, tenant, initiator, &row, scope).await?;
    }
    // DD-126(5): renewal replaces its own Grant; a plain grant never runs in
    // parallel with an in-period ACTIVE Grant of the same grantor and scope key.
    let renewing = renewal(grant)?;
    if let Some(replaced) = renewing {
        if !replaceable(conn, tenant, &row, initiator, replaced, false).await? {
            return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
        }
    }
    let parallel = overlapping(conn, tenant, &row, initiator, grant, grant_id, false).await?;
    if renewing.is_none() && !parallel.is_empty() {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    Ok(())
}

fn renewal(grant: &contracts::DelegationGrantParameters) -> Result<Option<(Uuid, i32)>, Refusal> {
    let bad = || Refusal::Precondition(ReasonCode::InvalidParameters);
    let version = grant.renews_delegation_version;
    match (grant.renews_delegation_id.as_deref(), version) {
        (None, None) => Ok(None),
        (Some(id), Some(version)) => {
            let id = Uuid::parse_str(id).map_err(|_| bad())?;
            let version = i32::try_from(version).map_err(|_| bad())?;
            Ok(Some((id, version)))
        }
        _ => Err(bad()),
    }
}

/// The replaced Grant is the grantor's own Grant on this Installation, at the
/// submitted version, ACTIVE or EXPIRED, and not already replaced.
async fn replaceable(
    conn: &mut PgConnection,
    tenant: Uuid,
    row: &Installation,
    grantor: Uuid,
    (id, version): (Uuid, i32),
    lock: bool,
) -> Result<bool, Refusal> {
    let found: Option<Uuid> = sqlx::query_scalar(&format!(
        "select id from admission.delegation_grant
        where id=$1 and version=$2 and tenant_id=$3 and workspace_id=$4
          and installation_resource_id=$5 and agent_principal_id=$6 and grantor_principal_id=$7
          and state in ('ACTIVE','EXPIRED') and superseded_by_delegation_id is null{}",
        if lock { " for update" } else { "" }
    ))
    .bind(id)
    .bind(version)
    .bind(tenant)
    .bind(row.workspace_id)
    .bind(row.id)
    .bind(row.agent_principal_id)
    .bind(grantor)
    .fetch_optional(conn)
    .await?;
    Ok(found.is_some())
}

/// In-period ACTIVE Grants of the same grantor on this Installation that share
/// a scope key (action, target or create Workspace, Tool) with the new Grant.
async fn overlapping(
    conn: &mut PgConnection,
    tenant: Uuid,
    row: &Installation,
    grantor: Uuid,
    grant: &contracts::DelegationGrantParameters,
    new_grant: Uuid,
    lock: bool,
) -> Result<Vec<Uuid>, Refusal> {
    let keys = serde_json::to_value(&grant.scopes)
        .map_err(|_| Refusal::Precondition(ReasonCode::InvalidParameters))?;
    let ids: Vec<Uuid> = sqlx::query_scalar(&format!(
        "select g.id from admission.delegation_grant g
        where g.id in (select s.delegation_id from admission.delegation_scope s
            join jsonb_to_recordset($7::jsonb) k(\"actionKey\" text,\"targetId\" uuid,
              \"createWorkspaceId\" uuid,\"toolResourceId\" uuid)
              on k.\"actionKey\"=s.action_key and k.\"targetId\" is not distinct from s.target_id
              and k.\"createWorkspaceId\" is not distinct from s.create_workspace_id
              and k.\"toolResourceId\" is not distinct from s.tool_resource_id)
          and g.tenant_id=$1 and g.workspace_id=$2 and g.installation_resource_id=$3
          and g.agent_principal_id=$4 and g.grantor_principal_id=$5 and g.id<>$6
          and g.state='ACTIVE' and g.expires_at>clock_timestamp()
        order by g.id{}",
        if lock { " for update" } else { "" }
    ))
    .bind(tenant)
    .bind(row.workspace_id)
    .bind(row.id)
    .bind(row.agent_principal_id)
    .bind(grantor)
    .bind(new_grant)
    .bind(keys)
    .fetch_all(conn)
    .await?;
    Ok(ids)
}

/// The management directory and the write admission consume this same scope
/// check. A listed target never grants permission, and a later write rechecks it.
pub(crate) async fn validate_scope(
    g: &Governance,
    conn: &mut PgConnection,
    tenant: Uuid,
    initiator: Uuid,
    row: &Installation,
    scope: &contracts::DelegationScopeParameters,
) -> Result<(), Refusal> {
    let target = scope
        .target_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| Refusal::Precondition(ReasonCode::InvalidParameters))?;
    let create = scope
        .create_workspace_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| Refusal::Precondition(ReasonCode::InvalidParameters))?;
    if target.is_some() == create.is_some()
        || create.is_some_and(|w| w != row.workspace_id)
        || target.is_some_and(|id| id.is_nil())
        || scope.action_version <= 0
    {
        return Err(Refusal::Precondition(ReasonCode::InvalidParameters));
    }
    if matches!(
        scope.action_key.as_str(),
        "agent.memory.entry.list" | "agent.memory.entry.read"
    ) {
        return validate_memory_scope(g, conn, tenant, initiator, row, scope, target).await;
    }
    // DD-140: the one native tool bound to another action key; its scope targets
    // the Installation like the memory tools, never a Workspace to create.
    if scope.action_key == crate::project_channel_request::ACTION
        && scope.tool_resource_id.is_some()
    {
        return validate_memory_scope(g, conn, tenant, initiator, row, scope, target).await;
    }
    if scope.tool_resource_id.is_some() {
        return validate_application_scope(g, conn, tenant, initiator, row, scope, target).await;
    }
    let action:Option<(String,String,String,String,String,String)>=sqlx::query_as(
            "select target_type,permission_object_type,permission,result_exposure,obs_redaction_policy,workspace_rule
             from catalog.action_definition where action_key=$1 and version=$2 and status='ACTIVE' and component_release_id is null")
            .bind(&scope.action_key).bind(i32::try_from(scope.action_version)
                .map_err(|_|Refusal::Precondition(ReasonCode::InvalidParameters))?)
            .fetch_optional(&mut *conn).await?;
    let Some((target_type, object_type, permission, exposure, redaction, workspace_rule)) = action
    else {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    };
    let automation = scope.action_key == "automation.run";
    let invocation = scope.action_key == crate::agent_invocation::ACTION;
    if invocation && !crate::capability_registry::action_exposed(crate::agent_invocation::ACTION) {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    if (!automation && !invocation && !has_agent_consumer(&scope.action_key))
        || scope.tool_resource_id.is_some()
    {
        // ToolDefinition/PEP 当前没有真实生产者，不查询不存在的表或编造输出合同。
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    if scope.target_type != target_type
        || scope.redaction_policy != redaction
        || exposure != "NONE"
        || serde_json::to_value(&scope.result_exposure_mode).ok()
            != Some(serde_json::Value::String("CONSUME_ONLY".into()))
        || scope.output_schema_hash != output_schema_hash()
    {
        return Err(Refusal::Precondition(ReasonCode::InvalidParameters));
    }
    let object = if let Some(target) = target {
        if object_type != "resource"
            || !matches!(
                workspace_rule.as_str(),
                "TARGET_HOME_WORKSPACE" | "INHERIT_PARENT"
            )
        {
            return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
        }
        let valid:bool=sqlx::query_scalar("select exists(select 1 from catalog.resource
                where id=$1 and tenant_id=$2 and state='ACTIVE' and projection_action_execution_id is null
                  and (home_workspace_id is null or home_workspace_id=$3) and application_binding_id is null)")
                .bind(target).bind(tenant).bind(row.workspace_id).fetch_one(&mut *conn).await?;
        if !valid {
            return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
        }
        if invocation && target != row.id {
            return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
        }
        if automation {
            crate::automation::delegation_target(
                g,
                conn,
                tenant,
                row.workspace_id,
                row.id,
                initiator,
                (target, scope.action_version),
            )
            .await?;
        }
        target
    } else {
        if object_type != "workspace" || scope.action_key != "resource.create" {
            return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
        }
        row.workspace_id
    };
    for (subject, check_permission) in [
        (initiator, permission.as_str()),
        (row.agent_principal_id, permission.as_str()),
        (initiator, "delegate"),
    ] {
        // workspace 的 schema 不含 delegate；创建授权来自 Installation delegate
        // 加 grantor/Agent 对指定 Workspace 的 create，不能替造 workspace relation。
        if object_type == "workspace" && check_permission == "delegate" {
            continue;
        }
        let checked = g
            .spicedb
            .check(
                &object_type,
                &object.to_string(),
                check_permission,
                &subject.to_string(),
                crate::spicedb::Consistency::FullyConsistent,
            )
            .await
            .map_err(|_| Refusal::Unavailable("Delegation fresh permission 不可核验".into()))?;
        if checked.zed_token.is_empty() {
            return Err(Refusal::Unavailable(
                "Delegation fresh permission 缺 checked revision".into(),
            ));
        }
        if !checked.allowed {
            return Err(Refusal::Denied(ReasonCode::PermissionDenied));
        }
    }
    Ok(())
}

/// The native tool that carries a scope's action key (inverse of the closed DD-140 map).
fn native_tool_name(action: &str) -> Result<&'static str, Refusal> {
    crate::agent_tool::NATIVE_TOOLS
        .into_iter()
        .find(|name| crate::agent_tool::native_action_key(name) == Some(action))
        .ok_or(Refusal::Blocked(ReasonCode::CapabilityBlocked))
}

// 19 §5 / DD-105: only the installed Agent's own Memory, an actual immutable
// ToolBinding, and both HUMAN/AGENT fresh rights can become a Tool scope.
// Binding never grants discover/consume/read, and this path never starts approval.
async fn validate_memory_scope(
    g: &Governance,
    conn: &mut PgConnection,
    tenant: Uuid,
    initiator: Uuid,
    row: &Installation,
    scope: &contracts::DelegationScopeParameters,
    target: Option<Uuid>,
) -> Result<(), Refusal> {
    let tool = scope
        .tool_resource_id
        .as_deref()
        .and_then(|id| Uuid::parse_str(id).ok())
        .filter(|id| !id.is_nil())
        .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
    let name = native_tool_name(&scope.action_key)?;
    let definition = crate::agent_tool::tool_definition(&g.pool, name).await?;
    let hashes = crate::agent_tool::schema_hashes(name)?;
    if target != Some(row.id)
        || scope.create_workspace_id.is_some()
        || scope.target_type != "RESOURCE"
        || scope.action_version != i64::from(definition.version)
        || scope.redaction_policy != "PLATFORM_METADATA_ONLY"
        || scope.output_schema_hash != hashes.1
        || serde_json::to_value(&scope.result_exposure_mode).ok()
            != Some(serde_json::Value::String("CONSUME_ONLY".into()))
    {
        return Err(Refusal::Precondition(ReasonCode::InvalidParameters));
    }
    let valid: bool = sqlx::query_scalar("select exists(select 1 from catalog.tool_binding b
        join catalog.agent_installation i on i.resource_id=b.installation_resource_id
          and i.active_projection_generation=b.projection_generation and i.pinned_version_asset_id=b.agent_version_asset_id
        join catalog.agent_runtime_projection p on p.installation_resource_id=i.resource_id
          and p.generation=b.projection_generation and p.agent_version_asset_id=b.agent_version_asset_id and p.state='ACTIVE'
        join catalog.agent_version v on v.asset_id=b.agent_version_asset_id
        join catalog.tool_definition t on t.resource_id=b.tool_resource_id and t.source='PLATFORM_NATIVE'
          and t.backend_ref='CORE_STREAMABLE_MCP' and t.status='ACTIVE'
        join catalog.resource r on r.id=t.resource_id and r.tenant_id=$1 and r.state='ACTIVE'
          and r.type_key='tool.definition' and r.projection_action_execution_id is null
        where b.installation_resource_id=$2 and b.tool_resource_id=$3 and b.workspace_id=$4
          and b.status in ('NO_PERMISSION','ACTIVE') and t.action_key=$5 and t.name=$8
          and t.input_schema_hash=$6 and t.output_schema_hash=$7
          and v.content->'declaredToolResourceIds' @> jsonb_build_array(t.resource_id::text))")
        .bind(tenant).bind(row.id).bind(tool).bind(row.workspace_id).bind(&scope.action_key)
        .bind(&hashes.0).bind(&hashes.1).bind(name).fetch_one(&mut *conn).await?;
    if !valid {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    // DD-122 (5): Tool rights are the Agent's and the Installation owner's; the
    // initiator needs only the target contract permission and `delegate`.
    let (agent, owner) = (row.agent_principal_id, row.owner_principal_id);
    crate::agent_tool::agent_rights(g, tool, agent, owner).await?;
    for subject in [initiator, agent] {
        crate::agent_tool::permission(g, row.id, subject, "read").await?;
    }
    crate::agent_tool::permission(g, row.id, initiator, "delegate").await?;
    Ok(())
}

// APPLICATION Tool scopes consume the exact approved release selected by the
// target and immutable Installation ToolBinding. Catalog metadata is not the
// Gateway's tool discovery authority, and neither binding nor Grant is a right.
async fn validate_application_scope(
    g: &Governance,
    conn: &mut PgConnection,
    tenant: Uuid,
    initiator: Uuid,
    row: &Installation,
    scope: &contracts::DelegationScopeParameters,
    target: Option<Uuid>,
) -> Result<(), Refusal> {
    let bad = || Refusal::Precondition(ReasonCode::InvalidParameters);
    let target = target.ok_or_else(bad)?;
    let tool = scope
        .tool_resource_id
        .as_deref()
        .and_then(|id| Uuid::parse_str(id).ok())
        .filter(|id| !id.is_nil())
        .ok_or_else(bad)?;
    let version = i32::try_from(scope.action_version).map_err(|_| bad())?;
    let (binding, generation, application) = match scope.target_type.as_str() {
        "RESOURCE" => {
            crate::application_catalog::definition_for_resource(
                conn,
                tenant,
                Some(row.workspace_id),
                target,
                &scope.action_key,
                version,
            )
            .await?
        }
        "ASSET" => {
            crate::application_catalog::definition_for_asset(
                conn,
                tenant,
                Some(row.workspace_id),
                target,
                &scope.action_key,
                version,
            )
            .await?
        }
        _ => return Err(bad()),
    };
    let def = &application.definition;
    if !application_scope_matches(scope, def, &application.declaration) {
        return Err(bad());
    }
    let valid:bool=sqlx::query_scalar("select exists(select 1 from catalog.tool_binding b
        join catalog.agent_installation i on i.resource_id=b.installation_resource_id
          and i.active_projection_generation=b.projection_generation and i.pinned_version_asset_id=b.agent_version_asset_id
        join catalog.agent_runtime_projection agent on agent.installation_resource_id=i.resource_id
          and agent.generation=b.projection_generation and agent.agent_version_asset_id=b.agent_version_asset_id and agent.state='ACTIVE'
        join catalog.agent_version v on v.asset_id=b.agent_version_asset_id
        join catalog.tool_definition t on t.resource_id=b.tool_resource_id and t.source='APPLICATION' and t.status='ACTIVE'
        join catalog.resource r on r.id=t.resource_id and r.tenant_id=$1 and r.state='ACTIVE'
          and r.type_key='tool.definition' and r.projection_action_execution_id is null
        join catalog.application_binding implementation on implementation.id=r.application_binding_id
          and implementation.tenant_id=r.tenant_id and implementation.state='ACTIVE'
        join projection.application_runtime runtime on runtime.binding_id=implementation.id
          and runtime.generation=t.application_projection_generation and runtime.state='ACTIVE' and runtime.gateway_state='ACTIVE'
        where b.installation_resource_id=$2 and b.tool_resource_id=$3 and b.workspace_id=$4
          and i.state='ACTIVE' and i.workspace_id=$4 and b.status in ('NO_PERMISSION','ACTIVE')
          and t.action_key=$5 and t.capability_contract_key=$5 and t.output_schema_hash=$6
          and t.input_schema_hash=$10 and r.application_binding_id=$7 and t.application_projection_generation=$8
          and runtime.component_release_id=$9 and implementation.component_release_id=$9
          and implementation.active_projection_generation=$8
          and (implementation.workspace_id is null or implementation.workspace_id=$4)
          and r.home_workspace_id is not distinct from implementation.workspace_id
          and v.content->'capabilityRequirements' @> jsonb_build_array(t.capability_contract_key))")
        .bind(tenant).bind(row.id).bind(tool).bind(row.workspace_id).bind(&scope.action_key)
        .bind(&scope.output_schema_hash).bind(binding).bind(generation).bind(application.component_release_id)
        .bind(application.declaration["inputSchemaDigest"].as_str().ok_or_else(bad)?)
        .fetch_one(&mut *conn).await?;
    if !valid {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    // DD-122 (5): as for llm_route, Tool rights are the Agent's and the
    // Installation owner's. Both the initiator and the Agent still need the
    // target contract permission and its exposure; the initiator `delegate`.
    let (agent, owner) = (row.agent_principal_id, row.owner_principal_id);
    crate::agent_tool::agent_rights(g, tool, agent, owner).await?;
    for subject in [initiator, agent] {
        application_permission(
            g,
            &def.permission_object_type,
            target,
            subject,
            &def.permission,
        )
        .await?;
        match &scope.result_exposure_mode {
            contracts::DelegationScopeParametersResultExposureMode::ConsumeOnly => {}
            contracts::DelegationScopeParametersResultExposureMode::Read => {
                application_permission(g, &def.permission_object_type, target, subject, "read")
                    .await?
            }
            contracts::DelegationScopeParametersResultExposureMode::Export => {
                application_permission(g, &def.permission_object_type, target, subject, "export")
                    .await?
            }
        }
    }
    application_permission(
        g,
        &def.permission_object_type,
        target,
        initiator,
        "delegate",
    )
    .await
}

fn application_scope_matches(
    scope: &contracts::DelegationScopeParameters,
    def: &Definition,
    declaration: &serde_json::Value,
) -> bool {
    let exposure = &declaration["resultExposurePolicy"];
    def.action_key == scope.action_key
        && i64::from(def.version) == scope.action_version
        && def.target_type == scope.target_type
        && scope.create_workspace_id.is_none()
        && def.permission_object_type == scope.target_type.to_ascii_lowercase()
        && def.tenant_rule == "SESSION_TENANT"
        && application_exposure_within(&scope.result_exposure_mode, exposure["mode"].as_str())
        && exposure["outputSchemaHash"] == scope.output_schema_hash
        && exposure["redactionPolicy"] == scope.redaction_policy
        && declaration["businessObservabilityPolicy"]["redactionPolicy"] == scope.redaction_policy
}

fn application_exposure_within(
    mode: &contracts::DelegationScopeParametersResultExposureMode,
    maximum: Option<&str>,
) -> bool {
    matches!(
        (mode, maximum),
        (
            contracts::DelegationScopeParametersResultExposureMode::ConsumeOnly,
            Some("CONSUME_ONLY" | "READ" | "EXPORT")
        ) | (
            contracts::DelegationScopeParametersResultExposureMode::Read,
            Some("READ" | "EXPORT")
        ) | (
            contracts::DelegationScopeParametersResultExposureMode::Export,
            Some("EXPORT")
        )
    )
}

async fn application_permission(
    g: &Governance,
    object_type: &str,
    target: Uuid,
    subject: Uuid,
    permission: &str,
) -> Result<(), Refusal> {
    let checked = g
        .spicedb
        .check(
            object_type,
            &target.to_string(),
            permission,
            &subject.to_string(),
            crate::spicedb::Consistency::FullyConsistent,
        )
        .await
        .map_err(|_| {
            Refusal::Unavailable("APPLICATION Delegation fresh permission unavailable".into())
        })?;
    if checked.zed_token.is_empty() {
        return Err(Refusal::Unavailable(
            "APPLICATION Delegation fresh permission lacks checked revision".into(),
        ));
    }
    if !checked.allowed {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    Ok(())
}

pub(super) async fn prewrite(
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    def: &Definition,
    sem: Semantic,
    params: &Params,
) -> Result<(), Refusal> {
    let row = installation(
        tx,
        ae.tenant_id,
        ae.target_id,
        true,
        sem == Semantic::AgentDelegationRevoke,
    )
    .await?
    .ok_or(Refusal::Conflict(ReasonCode::TargetStateConflict))?;
    let id = params
        .delegation_id
        .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
    if sem == Semantic::AgentDelegationRevoke {
        let changed = sqlx::query(
            "update admission.delegation_grant set state='REVOKED',version=version+1
            where id=$1 and tenant_id=$2 and workspace_id=$3 and installation_resource_id=$4
              and version=$5 and state in ('ACTIVE','REVOKING')",
        )
        .bind(id)
        .bind(ae.tenant_id)
        .bind(row.workspace_id)
        .bind(row.id)
        .bind(params.delegation_version)
        .execute(&mut **tx)
        .await?;
        if changed.rows_affected() != 1 {
            return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
        }
        flag_invocations(tx, ae.tenant_id, id).await?;
        return Ok(());
    }
    let grant = params
        .delegation_grant
        .as_ref()
        .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
    let from = DateTime::parse_from_rfc3339(&grant.valid_from)
        .map_err(|_| Refusal::Precondition(ReasonCode::InvalidParameters))?
        .with_timezone(&Utc);
    let until = DateTime::parse_from_rfc3339(&grant.expires_at)
        .map_err(|_| Refusal::Precondition(ReasonCode::InvalidParameters))?
        .with_timezone(&Utc);
    // DD-126(5): rechecked under the Installation lock taken above; the
    // replaced and overlapping Grants are locked before the new one is written.
    let grantor = ae.initiator_principal_id;
    let renewing = renewal(grant)?;
    let mut replaced = overlapping(tx, ae.tenant_id, &row, grantor, grant, id, true).await?;
    if let Some(renewed) = renewing {
        if !replaceable(tx, ae.tenant_id, &row, grantor, renewed, true).await? {
            return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
        }
        if !replaced.contains(&renewed.0) {
            replaced.push(renewed.0);
        }
    } else if !replaced.is_empty() {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    sqlx::query(
        "insert into admission.delegation_grant
        (id,tenant_id,workspace_id,grantor_principal_id,installation_resource_id,agent_principal_id,
         valid_from,expires_at,max_uses,state,version,action_execution_id)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ACTIVE',1,$10)",
    )
    .bind(id)
    .bind(ae.tenant_id)
    .bind(row.workspace_id)
    .bind(ae.initiator_principal_id)
    .bind(row.id)
    .bind(row.agent_principal_id)
    .bind(from)
    .bind(until)
    .bind(grant.max_uses)
    .bind(ae.id)
    .execute(&mut **tx)
    .await?;
    for scope in &grant.scopes {
        let policy = Uuid::new_v4();
        let mode = serde_json::to_value(&scope.result_exposure_mode)
            .ok()
            .and_then(|v| v.as_str().map(str::to_owned))
            .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
        sqlx::query(
            "insert into catalog.result_exposure_policy
            (id,tenant_id,mode,output_schema_hash,redaction_policy,version,status)
            values ($1,$2,$3,$4,$5,1,'ACTIVE')",
        )
        .bind(policy)
        .bind(ae.tenant_id)
        .bind(mode)
        .bind(&scope.output_schema_hash)
        .bind(&scope.redaction_policy)
        .execute(&mut **tx)
        .await?;
        let uuid = |value: &Option<String>| -> Result<Option<Uuid>, Refusal> {
            value
                .as_deref()
                .map(Uuid::parse_str)
                .transpose()
                .map_err(|_| Refusal::Precondition(ReasonCode::InvalidParameters))
        };
        sqlx::query("insert into admission.delegation_scope
            (delegation_id,action_key,action_version,target_type,target_id,create_workspace_id,tool_resource_id,
             result_exposure_policy_id,result_exposure_policy_version)
            values ($1,$2,$3,$4,$5,$6,$7,$8,1)")
            .bind(id).bind(&scope.action_key).bind(i32::try_from(scope.action_version)
                .map_err(|_|Refusal::Precondition(ReasonCode::InvalidParameters))?).bind(&scope.target_type)
            .bind(uuid(&scope.target_id)?).bind(uuid(&scope.create_workspace_id)?).bind(uuid(&scope.tool_resource_id)?)
            .bind(policy).execute(&mut **tx).await?;
    }
    for old in replaced {
        let changed = sqlx::query(
            "update admission.delegation_grant
            set state='SUPERSEDED',superseded_by_delegation_id=$2,version=version+1
            where id=$1 and tenant_id=$3 and state in ('ACTIVE','EXPIRED')
              and superseded_by_delegation_id is null",
        )
        .bind(old)
        .bind(id)
        .bind(ae.tenant_id)
        .execute(&mut **tx)
        .await?;
        if changed.rows_affected() != 1 {
            return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
        }
        // 10 §4: in-flight work under the replaced consent converges as revocation.
        flag_invocations(tx, ae.tenant_id, old).await?;
        super::audit(
            tx,
            ae,
            def,
            &format!("delegation:{old}:SUPERSEDED:{id}"),
            "OUTCOME",
            "NONE",
            "DELEGATION_SUPERSEDED",
            None,
            Vec::new(),
        )
        .await?;
    }
    Ok(())
}

/// The same closed Grant-state rule is consumed by reconciliation and each
/// Advance. A failed/unknown read is not evidence that authorization was revoked.
pub(crate) fn cancellation_required(
    state: &str,
    expires_at: DateTime<Utc>,
    now: DateTime<Utc>,
) -> Result<bool, Refusal> {
    match state {
        "ACTIVE" => Ok(expires_at <= now),
        "REVOKING" | "REVOKED" | "EXPIRED" | "SUPERSEDED" => Ok(true),
        _ => Err(Refusal::Unavailable("Delegation 状态不可核验".into())),
    }
}

/// DD-126(4): the delegation page shows a Grant as ACTIVE only when it is
/// usable from its own facts; NEEDS_RENEWAL is a read projection, not a state.
/// An unknown persisted state is not guessed (the caller fails closed).
pub(crate) fn effective_state(
    state: &str,
    now: DateTime<Utc>,
    valid_from: DateTime<Utc>,
    expires_at: DateTime<Utc>,
    max_uses: Option<i64>,
    uses: i64,
    consent_current: bool,
) -> Option<&'static str> {
    Some(match state {
        "REVOKING" => "REVOKING",
        "REVOKED" => "REVOKED",
        "SUPERSEDED" => "SUPERSEDED",
        "EXPIRED" => "EXPIRED",
        "ACTIVE" if expires_at <= now => "EXPIRED",
        "ACTIVE" if valid_from > now => "NOT_YET_VALID",
        "ACTIVE" if max_uses.is_some_and(|max| uses >= max) => "USES_EXHAUSTED",
        "ACTIVE" if !consent_current => "NEEDS_RENEWAL",
        "ACTIVE" => "ACTIVE",
        _ => return None,
    })
}

// Called under the existing Tenant fence. No business/native terminal is
// inferred here; the immutable Grant ID and scope exclude other delegations.
pub(crate) async fn flag_invocations(
    conn: &mut PgConnection,
    tenant: Uuid,
    grant: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "update catalog.agent_invocation i set cancel_pending=true,updated_at=now()
        from admission.delegation_grant g
        where g.id=$1 and g.tenant_id=$2 and i.delegation_id=g.id
          and i.tenant_id=g.tenant_id and i.workspace_id=g.workspace_id
          and i.installation_resource_id=g.installation_resource_id
          and i.status in ('CREATED','DISPATCHING','RUNNING','UNKNOWN') and not i.cancel_pending
          and (g.state in ('REVOKING','REVOKED','EXPIRED','SUPERSEDED')
               or (g.state='ACTIVE' and g.expires_at<=clock_timestamp()))",
    )
    .bind(grant)
    .bind(tenant)
    .execute(conn)
    .await?;
    Ok(())
}

#[derive(sqlx::FromRow)]
struct Cancellation {
    id: Uuid,
    action_execution_id: Uuid,
    workflow_id: String,
    first_run_id: Option<String>,
    installation_resource_id: Uuid,
    projection_generation: i64,
    config_hash: Option<String>,
    runtime_thread_id: Option<String>,
    runtime_turn_id: Option<String>,
    native_status: Option<String>,
}

impl Governance {
    /// 复用现有治理循环的 batch/节拍；expiry 是授权事实，不是新的工作流。
    pub(crate) async fn reconcile_delegations(
        &self,
        runtime: Option<&crate::agent_runtime::Supervisor>,
        batch: i64,
    ) -> Result<(), Refusal> {
        let rows:Vec<(Uuid,Uuid,Uuid)>=sqlx::query_as("select g.id,g.action_execution_id,g.tenant_id
            from admission.delegation_grant g where g.state='REVOKING'
              or (g.state='ACTIVE' and g.expires_at<=clock_timestamp())
              or (g.state in ('REVOKED','EXPIRED','SUPERSEDED') and exists(select 1 from catalog.agent_invocation i
                  where i.delegation_id=g.id and i.tenant_id=g.tenant_id and i.workspace_id=g.workspace_id
                    and i.installation_resource_id=g.installation_resource_id
                    and i.status in ('CREATED','DISPATCHING','RUNNING','UNKNOWN')))
            order by expires_at,id limit $1")
            .bind(batch).fetch_all(&self.pool).await?;
        for (id, execution, tenant) in rows {
            // 与管理路径相同 AE→Tenant→Grant，不能 Grant→Principal 的反向锁序。
            let mut tx = self.pool.begin().await?;
            let ae = super::lock_execution(&mut tx, execution).await?;
            let _: Uuid =
                sqlx::query_scalar("select id from identity.tenant where id=$1 for update")
                    .bind(tenant)
                    .fetch_one(&mut *tx)
                    .await?;
            let grant: Option<(String, DateTime<Utc>, DateTime<Utc>)> = sqlx::query_as(
                "select state,expires_at,clock_timestamp() from admission.delegation_grant
                where id=$1 and tenant_id=$2 for update skip locked",
            )
            .bind(id)
            .bind(tenant)
            .fetch_optional(&mut *tx)
            .await?;
            let Some((state, expires, now)) = grant else {
                tx.rollback().await?;
                continue;
            };
            if !cancellation_required(&state, expires, now)? {
                tx.rollback().await?;
                continue;
            }
            let terminal = if state == "REVOKING" {
                "REVOKED"
            } else {
                "EXPIRED"
            };
            if matches!(state.as_str(), "ACTIVE" | "REVOKING") {
                sqlx::query(
                    "update admission.delegation_grant set state=$2,version=version+1 where id=$1",
                )
                .bind(id)
                .bind(terminal)
                .execute(&mut *tx)
                .await?;
            }
            flag_invocations(&mut tx, tenant, id).await?;
            let def = super::exact_definition_for_execution(&self.pool, &ae).await?;
            if matches!(state.as_str(), "ACTIVE" | "REVOKING") {
                super::audit(
                    &mut tx,
                    &ae,
                    &def,
                    &format!("delegation:{id}:{terminal}"),
                    "OUTCOME",
                    "NONE",
                    &format!("DELEGATION_{terminal}"),
                    None,
                    Vec::new(),
                )
                .await?;
            }
            let pending: Vec<Cancellation> = sqlx::query_as("select i.id,i.action_execution_id,i.workflow_id,
                w.run_id as first_run_id,i.installation_resource_id,i.projection_generation,p.config_hash,
                s.runtime_thread_id,i.runtime_turn_id,i.native_status
                from catalog.agent_invocation i
                join admission.delegation_grant g on g.id=i.delegation_id
                join admission.action_execution a on a.id=i.action_execution_id
                  and a.tenant_id=i.tenant_id and a.workspace_id=i.workspace_id
                  and a.temporal_workflow_id=i.workflow_id and a.actor_principal_id=g.agent_principal_id
                  and a.initiator_principal_id=g.grantor_principal_id
                left join projection.workflow_ref w on w.workflow_id=i.workflow_id
                  and w.tenant_id=i.tenant_id and w.action_execution_id=a.id and w.operation_id=a.operation_id
                  and w.workflow_type=$3 and w.kind is null
                left join catalog.agent_runtime_projection p on p.installation_resource_id=i.installation_resource_id
                  and p.generation=i.projection_generation and p.agent_version_asset_id=i.agent_version_asset_id
                left join catalog.agent_session s on s.tenant_id=i.tenant_id and s.workspace_id=i.workspace_id
                  and s.root_event_id=i.root_event_id and s.installation_resource_id=i.installation_resource_id
                  and s.agent_version_asset_id=i.agent_version_asset_id and s.projection_generation=i.projection_generation
                where g.id=$1 and g.tenant_id=$2 and i.tenant_id=g.tenant_id and i.workspace_id=g.workspace_id
                  and i.installation_resource_id=g.installation_resource_id and i.cancel_pending
                  and i.status in ('CREATED','DISPATCHING','RUNNING','UNKNOWN') order by i.id")
                .bind(id).bind(tenant).bind(crate::agent_task::WORKFLOW_TYPE).fetch_all(&mut *tx).await?;
            for invocation in &pending {
                super::audit(
                    &mut tx,
                    &ae,
                    &def,
                    &format!("delegation:{id}:cancel:{}:intent", invocation.id),
                    "DISPATCH",
                    "ALLOW",
                    "DELEGATION_CANCEL_PENDING",
                    None,
                    vec![crate::audit::Evidence::new(
                        contracts::EvidenceKind::OriginalActionExecutionId,
                        invocation.action_execution_id,
                    )],
                )
                .await?;
            }
            tx.commit().await?;
            for invocation in pending {
                // Cancellation is retried only at the same control AE/execution
                // chain. Acceptance is not an Invocation or Workflow terminal.
                let native = match (&invocation.runtime_thread_id, &invocation.runtime_turn_id) {
                    (Some(thread), Some(turn))
                        if invocation.native_status.as_deref().is_none_or(|s| {
                            !matches!(s, "completed" | "failed" | "interrupted")
                        }) =>
                    {
                        match (runtime, invocation.config_hash.as_ref()) {
                            (Some(runtime), Some(hash)) => runtime
                                .interrupt(
                                    &crate::agent_runtime::RuntimeRef {
                                        installation_id: invocation.installation_resource_id,
                                        generation: invocation.projection_generation,
                                        config_hash: hash.clone(),
                                    },
                                    thread,
                                    turn,
                                )
                                .await
                                .is_ok(),
                            _ => false,
                        }
                    }
                    // No turn ID is not absence proof; Advance observes the
                    // same client ID. Known terminal turns still settle usage.
                    _ => false,
                };
                let recorded = self.cancel_delegated_workflow(&invocation, ae.id).await;
                tracing::debug!(invocation_id=%invocation.id, cancel_recorded=recorded,
                    interrupt_accepted=native, "Delegation 定向取消仍由原 Task/native/usage 对账确认终态");
                let mut tx = self.pool.begin().await?;
                let control = super::lock_execution(&mut tx, ae.id).await?;
                let mut evidence = vec![crate::audit::Evidence::new(
                    contracts::EvidenceKind::OriginalActionExecutionId,
                    invocation.action_execution_id,
                )];
                if recorded {
                    evidence.push(crate::audit::Evidence::new(
                        contracts::EvidenceKind::TemporalWorkflowId,
                        &invocation.workflow_id,
                    ));
                    if let Some(first) = &invocation.first_run_id {
                        evidence.push(crate::audit::Evidence::new(
                            contracts::EvidenceKind::TemporalFirstRunId,
                            first,
                        ));
                    }
                }
                super::audit(
                    &mut tx,
                    &control,
                    &def,
                    &format!(
                        "delegation:{id}:cancel:{}:observed:{recorded}:{native}",
                        invocation.id
                    ),
                    "RECONCILIATION",
                    "NONE",
                    if recorded {
                        "CANCEL_REQUEST_RECORDED"
                    } else {
                        "UNKNOWN_EXTERNAL_RESULT"
                    },
                    None,
                    evidence,
                )
                .await?;
                tx.commit().await?;
            }
        }
        Ok(())
    }

    async fn cancel_delegated_workflow(&self, invocation: &Cancellation, control: Uuid) -> bool {
        let Some(first) = invocation
            .first_run_id
            .as_deref()
            .filter(|run| !run.is_empty())
        else {
            return false;
        };
        let Ok(Some(observed)) = self.temporal.describe(&invocation.workflow_id).await else {
            return false;
        };
        if observed.first_run_id.is_empty()
            || (first != observed.first_run_id && first != observed.run_id)
            || !matches!(observed.state, crate::temporal::ObservedState::Open)
        {
            return false;
        }
        match self
            .temporal
            .cancel_request_recorded(&invocation.workflow_id, first, control)
            .await
        {
            Ok(true) => true,
            Ok(false) => {
                let _ = self
                    .temporal
                    .request_cancel(&invocation.workflow_id, first, control)
                    .await;
                matches!(
                    self.temporal
                        .cancel_request_recorded(&invocation.workflow_id, first, control)
                        .await,
                    Ok(true)
                )
            }
            Err(_) => false,
        }
    }
}

#[cfg(test)]
mod application_scope_tests {
    use super::*;
    use serde_json::json;

    fn fixture() -> (
        contracts::DelegationScopeParameters,
        Definition,
        serde_json::Value,
    ) {
        let scope = contracts::DelegationScopeParameters {
            action_key: "isolated.lookup@v1".into(),
            action_version: 1,
            target_type: "RESOURCE".into(),
            target_id: Some(Uuid::new_v4().to_string()),
            create_workspace_id: None,
            tool_resource_id: Some(Uuid::new_v4().to_string()),
            result_exposure_mode:
                contracts::DelegationScopeParametersResultExposureMode::ConsumeOnly,
            output_schema_hash: "a".repeat(64),
            redaction_policy: "PLATFORM_METADATA_ONLY".into(),
        };
        let def = Definition {
            action_key: scope.action_key.clone(),
            version: 1,
            component_type_key: "isolated_adapter".into(),
            target_type: "RESOURCE".into(),
            tenant_rule: "SESSION_TENANT".into(),
            workspace_rule: "TARGET_HOME_WORKSPACE".into(),
            permission: "read".into(),
            permission_object_type: "resource".into(),
            confirmation_mode: "NONE".into(),
            approval_policy_id: None,
            approval_policy_version: None,
            workflow_kind: None,
            result_exposure: "CONSUME_ONLY".into(),
            execution_mode: "PROTOCOL".into(),
            quota_policy: "NONE".into(),
            meters: vec![],
            role_template_key: None,
            role_template_version: None,
        };
        let declaration = json!({"resultExposurePolicy":{"mode":"CONSUME_ONLY",
            "outputSchemaHash":scope.output_schema_hash,"redactionPolicy":"PLATFORM_METADATA_ONLY"},
            "businessObservabilityPolicy":{"redactionPolicy":"PLATFORM_METADATA_ONLY"}});
        (scope, def, declaration)
    }

    #[test]
    fn application_scope_keeps_exact_contract_and_declared_exposure() {
        let (scope, mut def, declaration) = fixture();
        assert!(application_scope_matches(&scope, &def, &declaration));
        def.version = 2;
        assert!(!application_scope_matches(&scope, &def, &declaration));
        def.version = 1;
        def.action_key = "different.lookup@v1".into();
        assert!(!application_scope_matches(&scope, &def, &declaration));
    }

    #[test]
    fn application_scope_cannot_silently_broaden_or_change_output() {
        let (mut scope, def, declaration) = fixture();
        scope.result_exposure_mode = contracts::DelegationScopeParametersResultExposureMode::Read;
        assert!(!application_scope_matches(&scope, &def, &declaration));
        scope.result_exposure_mode =
            contracts::DelegationScopeParametersResultExposureMode::ConsumeOnly;
        scope.output_schema_hash = "b".repeat(64);
        assert!(!application_scope_matches(&scope, &def, &declaration));
        scope.output_schema_hash = "a".repeat(64);
        scope.redaction_policy = "other".into();
        assert!(!application_scope_matches(&scope, &def, &declaration));
    }

    #[test]
    fn application_scope_may_narrow_but_never_expand_declared_exposure() {
        let (mut scope, def, mut declaration) = fixture();
        declaration["resultExposurePolicy"]["mode"] = json!("EXPORT");
        assert!(application_scope_matches(&scope, &def, &declaration));
        scope.result_exposure_mode = contracts::DelegationScopeParametersResultExposureMode::Read;
        assert!(application_scope_matches(&scope, &def, &declaration));
        scope.result_exposure_mode = contracts::DelegationScopeParametersResultExposureMode::Export;
        assert!(application_scope_matches(&scope, &def, &declaration));
        declaration["resultExposurePolicy"]["mode"] = json!("READ");
        assert!(!application_scope_matches(&scope, &def, &declaration));
    }

    #[test]
    fn application_scope_rejects_unknown_missing_policy_and_create_intent() {
        let (mut scope, def, mut declaration) = fixture();
        declaration["resultExposurePolicy"]["mode"] = json!("FUTURE_MODE");
        assert!(!application_scope_matches(&scope, &def, &declaration));
        declaration["resultExposurePolicy"]["mode"] = json!("CONSUME_ONLY");
        declaration["businessObservabilityPolicy"] = serde_json::Value::Null;
        assert!(!application_scope_matches(&scope, &def, &declaration));
        let (_, _, declaration) = fixture();
        scope.create_workspace_id = Some(Uuid::new_v4().to_string());
        assert!(!application_scope_matches(&scope, &def, &declaration));
    }
}

#[cfg(test)]
mod consent_digest_tests {
    use uuid::Uuid;

    async fn define(
        tx: &mut sqlx::PgConnection,
        key: &str,
        version: i32,
        permission: &str,
        meter: &str,
        status: &str,
    ) -> (Uuid, String) {
        sqlx::query_as(
            "insert into catalog.action_definition
            (action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,
             permission,permission_object_type,execution_mode,confirmation_mode,
             capacity_policy,quota_policy,meters,result_exposure,audit_policy,
             obs_correlation_mode,obs_progress_source,obs_terminal_source,obs_usage_source,
             obs_cost_source,obs_redaction_policy,status)
            values($1,$2,'core','RESOURCE','SESSION_TENANT','TARGET_HOME_WORKSPACE',
             $3,'resource','SYNC','NONE','NONE','CHECK',array[$4],'NONE','FULL_LIFECYCLE',
             'OPERATION_REF','NONE','SYNC_RESULT','NONE','NONE','PLATFORM_METADATA_ONLY',$5)
            returning id,consent_digest",
        )
        .bind(key)
        .bind(version)
        .bind(permission)
        .bind(meter)
        .bind(status)
        .fetch_one(tx)
        .await
        .unwrap()
    }

    #[tokio::test]
    #[ignore = "requires AGENT_INVOKE_TEST_DATABASE_URL pointing at a disposable migrated database"]
    async fn consent_digest_ignores_metering_but_not_permission() {
        let url = std::env::var("AGENT_INVOKE_TEST_DATABASE_URL").unwrap();
        let pool = sqlx::PgPool::connect(&url).await.unwrap();
        let mut tx = pool.begin().await.unwrap();
        let key = format!("verify.consent.{}", Uuid::new_v4());
        let (v1, d1) = define(&mut tx, &key, 1, "execute", "tokens_a", "RETIRED").await;
        let (v2, d2) = define(&mut tx, &key, 2, "execute", "tokens_b", "ACTIVE").await;
        let (_, d3) = define(&mut tx, &key, 3, "read", "tokens_b", "RETIRED").await;
        // DD-126(1)(2), V-SCN-146: a metering-only version keeps the consent digest.
        assert_eq!(d1, d2);
        assert_eq!(d1.len(), 64);
        // V-SCN-147: a permission change is a consent change.
        assert_ne!(d1, d3);
        let covers = "select catalog.platform_consent_covers($1,$2,$3)";
        for (version, expected) in [(2, true), (3, false)] {
            let covered: bool = sqlx::query_scalar(covers)
                .bind(v1)
                .bind(&key)
                .bind(version)
                .fetch_one(&mut *tx)
                .await
                .unwrap();
            assert_eq!(covered, expected, "v1 grant against v{version}");
        }
        // The generated digest does not break the status-only version guard.
        sqlx::query("update catalog.action_definition set status='RETIRED' where id=$1")
            .bind(v2)
            .execute(&mut *tx)
            .await
            .unwrap();
        tx.rollback().await.unwrap();
    }
}
