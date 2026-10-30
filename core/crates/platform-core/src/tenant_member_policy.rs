//! DD-164(3) (`.design/02`, `03` Tenant.member_create_policy): who may create
//! in a Tenant. `MEMBERS_CREATE` (the default) gives every ACTIVE member the
//! SpiceDB `tenant#creator` relationship (Workspace `create` follows through
//! `tenant->create`); `ADMINS_ONLY` removes it, leaving creation to admins.
//!
//! - New members: the MEMBERSHIP_PROJECTION chain writes `creator` next to
//!   `member` when the Tenant's policy is MEMBERS_CREATE (frozen into the
//!   workflow input as `memberCreate`).
//! - `tenant.member_create_policy.set` (HUMAN, SYNC, EXPLICIT, no approval,
//!   FULL_LIFECYCLE, Tenant `manage`, Tenant version CAS): the policy changes
//!   in the admission transaction; the dispatch converges `creator` for every
//!   ACTIVE member idempotently and reads it back.
//! - Release alignment (`platform-core align-member-create`): for every
//!   ACTIVE business Tenant with MEMBERS_CREATE, write the missing `creator`
//!   relationships only, then read back. A missing `creator` is never taken as
//!   "the member is read-only".

use std::collections::BTreeSet;

use axum::http::StatusCode;
use contracts::{EvidenceKind, ReasonCode};
use serde_json::{json, Value};
use sqlx::{PgConnection, Postgres, Transaction};
use uuid::Uuid;

use super::{audit, lock_execution, Definition, Execution, Governance, Params, Refusal, Target};
use crate::spicedb::{Relationship, RelationshipFilter, SpiceDb, Subject, Write};

pub(crate) const ACTION: &str = "tenant.member_create_policy.set";
pub(crate) const MEMBERS_CREATE: &str = "MEMBERS_CREATE";
pub(crate) const ADMINS_ONLY: &str = "ADMINS_ONLY";
const CREATOR: &str = "creator";
/// SpiceDB accepts a bounded number of updates per WriteRelationships call.
const WRITE_CHUNK: usize = 500;

fn invalid() -> Refusal {
    Refusal::Precondition(ReasonCode::InvalidParameters)
}

fn conflict() -> Refusal {
    Refusal::Conflict(ReasonCode::TargetStateConflict)
}

fn unavailable(what: &str) -> Refusal {
    Refusal::Unavailable(format!("member create policy: {what}"))
}

fn policy_wire(policy: &contracts::TenantMemberCreatePolicy) -> &'static str {
    match policy {
        contracts::TenantMemberCreatePolicy::MembersCreate => MEMBERS_CREATE,
        contracts::TenantMemberCreatePolicy::AdminsOnly => ADMINS_ONLY,
    }
}

/// `ActionCommand.tenantMemberCreatePolicy` → frozen parameters.
pub(crate) fn normalize(
    input: &contracts::TenantMemberCreatePolicyInput,
) -> Result<Value, Refusal> {
    let version = i32::try_from(input.expected_version)
        .ok()
        .filter(|v| *v > 0)
        .ok_or_else(invalid)?;
    Ok(json!({"policy": policy_wire(&input.policy), "expectedVersion": version}))
}

/// (policy, expected Tenant version) of the frozen parameters.
pub(crate) fn frozen(p: &Params) -> Option<(&'static str, i32)> {
    let v = p.tenant_member_create_policy.as_ref()?;
    let policy = match v.get("policy")?.as_str()? {
        MEMBERS_CREATE => MEMBERS_CREATE,
        ADMINS_ONLY => ADMINS_ONLY,
        _ => return None,
    };
    let version = i32::try_from(v.get("expectedVersion")?.as_i64()?).ok()?;
    (version > 0 && v.as_object()?.len() == 2).then_some((policy, version))
}

pub(crate) fn validate_params(p: &Params) -> Result<(), Refusal> {
    let allowed = Params {
        tenant_member_create_policy: p.tenant_member_create_policy.clone(),
        explicit_confirmation: p.explicit_confirmation,
        ..Params::default()
    };
    if *p == allowed && p.explicit_confirmation == Some(true) && frozen(p).is_some() {
        Ok(())
    } else {
        Err(invalid())
    }
}

fn definition(d: &Definition) -> Result<(), Refusal> {
    if d.action_key != ACTION
        || d.component_type_key != "core"
        || d.target_type != "TENANT"
        || d.tenant_rule != "SESSION_TENANT"
        || d.workspace_rule != "TENANT_ONLY"
        || d.permission != "manage"
        || d.permission_object_type != "tenant"
        || d.execution_mode != "SYNC"
        || d.confirmation_mode != "EXPLICIT"
        || d.approval_policy_id.is_some()
        || d.approval_policy_version.is_some()
        || d.workflow_kind.is_some()
        || d.quota_policy != "NONE"
        || !d.meters.is_empty()
        || d.result_exposure != "NONE"
        || d.role_template_key.is_some()
        || d.role_template_version.is_some()
    {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    Ok(())
}

/// The session Tenant at the version the policy was read at; never the
/// Platform Catalog Tenant.
pub(crate) async fn target(
    conn: &mut PgConnection,
    tenant: Uuid,
    def: &Definition,
    p: &Params,
    frozen_target: Option<Uuid>,
    lock: bool,
) -> Result<Target, Refusal> {
    definition(def)?;
    validate_params(p)?;
    let (_, expected) = frozen(p).ok_or_else(invalid)?;
    if frozen_target.is_some_and(|id| id != tenant)
        || crate::platform_bootstrap::is_catalog_tenant(&mut *conn, tenant).await?
    {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let row: Option<(i32, String)> = sqlx::query_as(&format!(
        "select version,state from identity.tenant where id=$1{}",
        if lock { " for update" } else { "" }
    ))
    .bind(tenant)
    .fetch_optional(conn)
    .await?;
    match row {
        Some((version, state)) if state == "ACTIVE" && version == expected => Ok(Target {
            id: tenant,
            version,
            workspace_id: None,
        }),
        Some(_) => Err(conflict()),
        None => Err(Refusal::Precondition(ReasonCode::TargetNotFound)),
    }
}

/// Admission transaction: the policy and the Tenant version change together.
pub(crate) async fn prewrite(
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    def: &Definition,
    p: &Params,
) -> Result<(), Refusal> {
    let target = target(tx, ae.tenant_id, def, p, Some(ae.target_id), true).await?;
    if !crate::agent_definition::active_owner(tx, ae.tenant_id, ae.initiator_principal_id).await? {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let (policy, _) = frozen(p).ok_or_else(invalid)?;
    let updated = sqlx::query(
        "update identity.tenant set member_create_policy=$3,version=version+1
         where id=$1 and version=$2 and state='ACTIVE'",
    )
    .bind(target.id)
    .bind(target.version)
    .bind(policy)
    .execute(&mut **tx)
    .await?;
    if updated.rows_affected() != 1 {
        return Err(conflict());
    }
    Ok(())
}

/// ACTIVE HUMAN members of a Tenant (TenantMembership, Principal, HumanIdentity).
pub(crate) async fn active_members(
    conn: &mut PgConnection,
    tenant: Uuid,
) -> Result<Vec<Uuid>, sqlx::Error> {
    sqlx::query_scalar(
        "select p.id from identity.principal p
         join identity.tenant_membership tm on tm.tenant_principal_id=p.id
           and tm.tenant_id=$1 and tm.state='ACTIVE'
         join identity.human_identity hi on hi.id=tm.human_identity_id and hi.status='ACTIVE'
         where p.tenant_id=$1 and p.kind='HUMAN' and p.status='ACTIVE'
         order by p.id",
    )
    .bind(tenant)
    .fetch_all(conn)
    .await
}

/// The principals holding `tenant#creator`, read fully consistent.
pub(crate) async fn creators(
    spicedb: &SpiceDb,
    tenant: Uuid,
    page: u32,
) -> Result<BTreeSet<Uuid>, crate::spicedb::SpiceDbError> {
    let id = tenant.to_string();
    Ok(spicedb
        .read(
            &RelationshipFilter {
                object_type: "tenant",
                object_id: Some(&id),
                relation: Some(CREATOR),
                subject_principal: None,
            },
            page,
        )
        .await?
        .into_iter()
        .filter_map(|r| r.principal().and_then(|p| Uuid::parse_str(p).ok()))
        .collect())
}

fn creator(tenant: Uuid, principal: Uuid) -> Relationship {
    Relationship {
        object_type: "tenant".into(),
        object_id: tenant.to_string(),
        relation: CREATOR.into(),
        subject: Subject::Principal(principal.to_string()),
    }
}

/// The writes that move `current` to the policy's target set. `add_only`
/// (release alignment) never deletes.
pub(crate) fn plan(
    tenant: Uuid,
    members: &[Uuid],
    current: &BTreeSet<Uuid>,
    members_create: bool,
    add_only: bool,
) -> Vec<(Write, Relationship)> {
    let desired: BTreeSet<Uuid> = if members_create {
        members.iter().copied().collect()
    } else {
        BTreeSet::new()
    };
    let mut writes: Vec<(Write, Relationship)> = desired
        .difference(current)
        .map(|p| (Write::Touch, creator(tenant, *p)))
        .collect();
    if !add_only {
        writes.extend(
            current
                .difference(&desired)
                .map(|p| (Write::Delete, creator(tenant, *p))),
        );
    }
    writes
}

/// Outcome of one convergence: what was written and the read-back revision.
#[derive(Debug, Default)]
pub(crate) struct Converged {
    pub touched: usize,
    pub deleted: usize,
    pub token: Option<String>,
}

/// Converge `tenant#creator` for the given members and read it back.
pub(crate) async fn converge(
    spicedb: &SpiceDb,
    page: u32,
    tenant: Uuid,
    members: &[Uuid],
    members_create: bool,
    add_only: bool,
) -> Result<Converged, String> {
    let current = creators(spicedb, tenant, page)
        .await
        .map_err(|e| format!("读取 tenant#creator: {e}"))?;
    let writes = plan(tenant, members, &current, members_create, add_only);
    let mut result = Converged {
        touched: writes
            .iter()
            .filter(|(w, _)| matches!(w, Write::Touch))
            .count(),
        deleted: writes
            .iter()
            .filter(|(w, _)| matches!(w, Write::Delete))
            .count(),
        token: None,
    };
    for chunk in writes.chunks(WRITE_CHUNK) {
        let token = spicedb
            .write(chunk)
            .await
            .map_err(|e| format!("写 tenant#creator: {e}"))?;
        result.token = Some(token);
    }
    let after = creators(spicedb, tenant, page)
        .await
        .map_err(|e| format!("回读 tenant#creator: {e}"))?;
    let members: BTreeSet<Uuid> = members.iter().copied().collect();
    let closed = if members_create {
        members.is_subset(&after) && (add_only || after.is_subset(&members))
    } else {
        add_only || after.is_empty()
    };
    if !closed {
        return Err("tenant#creator 回读与策略不一致".into());
    }
    Ok(result)
}

async fn tenant_policy(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
) -> Result<Option<(String, String)>, sqlx::Error> {
    sqlx::query_as("select state,member_create_policy from identity.tenant where id=$1 for update")
        .bind(tenant)
        .fetch_optional(&mut **tx)
        .await
}

/// SYNC dispatch: persist UNKNOWN, then converge `creator` for every ACTIVE
/// member under the Tenant lock, read back and record the outcome. A later
/// policy change owns the convergence: this one then records CONFLICT.
pub(super) async fn dispatch(g: &Governance, id: Uuid, def: &Definition) -> Result<(), Refusal> {
    let mut tx = g.pool.begin().await?;
    let ae = lock_execution(&mut tx, id).await?;
    if ae.gate_state != "ALLOWED"
        || !matches!(ae.dispatch_state.as_str(), "NOT_DISPATCHED" | "UNKNOWN")
    {
        return Ok(());
    }
    if ae.dispatch_state == "NOT_DISPATCHED" {
        sqlx::query("update admission.action_execution set dispatch_state='UNKNOWN',updated_at=now() where id=$1")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        audit(
            &mut tx,
            &ae,
            def,
            "member-create-dispatch-intent",
            "DISPATCH",
            "ALLOW",
            "DISPATCH_RESULT_UNKNOWN",
            None,
            Vec::new(),
        )
        .await?;
    }
    tx.commit().await?;

    let mut tx = g.pool.begin().await?;
    let ae = lock_execution(&mut tx, id).await?;
    if ae.gate_state != "ALLOWED" || ae.dispatch_state != "UNKNOWN" {
        return Ok(());
    }
    if !crate::roles::lock_tenant(&mut tx, ae.tenant_id).await? {
        return Err(conflict());
    }
    let (policy, _) = ae.params().as_ref().and_then(frozen).ok_or_else(conflict)?;
    match tenant_policy(&mut tx, ae.tenant_id).await? {
        Some((state, current)) if state == "ACTIVE" && current == policy => {}
        _ => {
            // Superseded by a later policy change (or the Tenant left ACTIVE):
            // nothing is written here; the later action converges.
            super::record_dispatch(
                &mut tx,
                ae.id,
                def.audit_class(),
                Err(StatusCode::CONFLICT),
                Vec::new(),
            )
            .await?;
            audit(
                &mut tx,
                &ae,
                def,
                "member-create-outcome",
                "OUTCOME",
                "DENY",
                "NOT_APPLIED",
                None,
                Vec::new(),
            )
            .await?;
            tx.commit().await?;
            return Ok(());
        }
    }
    let members = active_members(&mut tx, ae.tenant_id).await?;
    let converged = match converge(
        &g.spicedb,
        g.cfg.relationship_page,
        ae.tenant_id,
        &members,
        policy == MEMBERS_CREATE,
        false,
    )
    .await
    {
        Ok(converged) => converged,
        Err(error) => {
            tracing::warn!(action = %id, error = %error, "成员创建策略收敛未完成，留给对账");
            tx.commit().await?;
            return Err(unavailable("creator convergence"));
        }
    };
    let mut evidence = Vec::new();
    if let Some(token) = &converged.token {
        evidence.push(crate::audit::Evidence::new(
            EvidenceKind::SpicedbZedtoken,
            token,
        ));
    }
    evidence.push(crate::audit::Evidence::new(
        EvidenceKind::SpicedbRelationship,
        format!(
            "tenant:{}#creator touched={} deleted={} members={}",
            ae.tenant_id,
            converged.touched,
            converged.deleted,
            members.len()
        ),
    ));
    let recorded =
        super::record_dispatch(&mut tx, ae.id, def.audit_class(), Ok(()), evidence.clone()).await?;
    if recorded.settled {
        audit(
            &mut tx,
            &ae,
            def,
            "member-create-outcome",
            "OUTCOME",
            "ALLOW",
            "TENANT_MEMBER_CREATE_POLICY_SET",
            None,
            evidence,
        )
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params(policy: &str, version: i64) -> Params {
        let input: contracts::TenantMemberCreatePolicyInput =
            serde_json::from_value(json!({"policy": policy, "expectedVersion": version})).unwrap();
        Params {
            tenant_member_create_policy: Some(normalize(&input).unwrap()),
            explicit_confirmation: Some(true),
            ..Params::default()
        }
    }

    #[test]
    fn parameters_are_closed_and_confirmed() {
        let p = params("ADMINS_ONLY", 7);
        assert_eq!(frozen(&p), Some((ADMINS_ONLY, 7)));
        assert!(validate_params(&p).is_ok());
        let mut unconfirmed = p.clone();
        unconfirmed.explicit_confirmation = None;
        assert!(validate_params(&unconfirmed).is_err());
        let mut extra = p.clone();
        extra.resource_version = Some(7);
        assert!(validate_params(&extra).is_err());
        let zero: contracts::TenantMemberCreatePolicyInput =
            serde_json::from_value(json!({"policy": "MEMBERS_CREATE", "expectedVersion": 0}))
                .unwrap();
        assert!(normalize(&zero).is_err());
    }

    #[test]
    fn plans_add_members_and_only_policy_changes_delete() {
        let tenant = Uuid::new_v4();
        let (a, b, c) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
        let current: BTreeSet<Uuid> = [b, c].into();
        // MEMBERS_CREATE with a, b active; c is no longer a member.
        let set = plan(tenant, &[a, b], &current, true, false);
        let text: Vec<String> = set
            .iter()
            .map(|(w, r)| format!("{}{}", if matches!(w, Write::Touch) { "+" } else { "-" }, r))
            .collect();
        assert_eq!(
            text,
            [
                format!("+tenant:{tenant}#creator@principal:{a}"),
                format!("-tenant:{tenant}#creator@principal:{c}"),
            ]
        );
        // Release alignment only adds what is missing.
        let align = plan(tenant, &[a, b], &current, true, true);
        assert_eq!(align.len(), 1);
        assert!(matches!(align[0].0, Write::Touch));
        // ADMINS_ONLY removes every creator; alignment never runs for it.
        let tighten = plan(tenant, &[a, b], &current, false, false);
        assert_eq!(tighten.len(), 2);
        assert!(tighten.iter().all(|(w, _)| matches!(w, Write::Delete)));
        // Already converged: nothing to write.
        assert!(plan(tenant, &[b, c], &current, true, false).is_empty());
    }
}
