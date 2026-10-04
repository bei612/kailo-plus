//! DD-107: the existing Automation executor's Buzz identity, without a model
//! route, Codex process or Capacity lease. This is not a new execution authority.
use super::*;

#[derive(FromRow, PartialEq)]
pub(crate) struct MessageBinding {
    pub agent_pubkey: String,
    pub agent_locator: String,
    pub agent_secret_version: i32,
    pub agent_audience: String,
    pub normalized_host: String,
    pub nip11_snapshot_digest: String,
    pub channel_id: Uuid,
    installation_owner: Uuid,
}

pub(crate) async fn binding(
    tx: &mut Transaction<'_, Postgres>,
    scope: &RuntimeScope,
) -> Result<MessageBinding, Refusal> {
    sqlx::query_as("select b.pubkey agent_pubkey,b.private_key_secret_ref agent_locator,
        b.private_key_secret_version agent_secret_version,b.private_key_secret_audience agent_audience,
        t.normalized_host,t.nip11_snapshot_digest,w.channel_id,r.owner_principal_id installation_owner
      from catalog.agent_installation i
      join catalog.resource r on r.id=i.resource_id and r.tenant_id=$4 and r.home_workspace_id=$5
      join catalog.agent_runtime_projection p on p.installation_resource_id=i.resource_id
        and p.generation=$2 and p.agent_version_asset_id=$3 and p.state='ACTIVE'
      join catalog.agent_memory_binding m on m.installation_resource_id=i.resource_id and m.state='ACTIVE'
      join identity.buzz_identity_binding b on b.pubkey=m.agent_buzz_identity_binding_id
        and b.principal_id=i.agent_principal_id and b.tenant_id=r.tenant_id
        and b.kind='AGENT' and b.custody='SERVER' and b.state='ACTIVE'
      join identity.principal agent on agent.id=b.principal_id and agent.tenant_id=r.tenant_id
        and agent.kind='AGENT' and agent.status='ACTIVE'
      join identity.principal owner on owner.id=r.owner_principal_id and owner.tenant_id=r.tenant_id
        and owner.kind='HUMAN' and owner.status='ACTIVE'
      join identity.tenant_membership tm on tm.tenant_id=r.tenant_id and tm.tenant_principal_id=owner.id and tm.state='ACTIVE'
      join projection.tenant_buzz_binding t on t.tenant_id=r.tenant_id and t.state='ACTIVE'
      join projection.workspace_buzz_binding w on w.workspace_id=i.workspace_id and w.state='ACTIVE'
      join catalog.channel_agent_binding cb on cb.installation_resource_id=i.resource_id
        and cb.workspace_id=i.workspace_id and cb.status='ACTIVE'
      where i.resource_id=$1 and i.workspace_id=$5 and i.agent_principal_id=$6
        and i.state='ACTIVE' and r.state='ACTIVE' and r.projection_action_execution_id is null
        and b.private_key_secret_ref is not null and b.private_key_secret_version>0
        and b.private_key_secret_audience is not null
      for update of i,r,p,m,b,agent,owner,tm,t,w,cb")
        .bind(scope.executor_installation_resource_id).bind(scope.projection_generation)
        .bind(scope.agent_version_asset_id).bind(scope.tenant_id).bind(scope.workspace_id)
        .bind(scope.agent_principal_id).fetch_optional(&mut **tx).await?
        .ok_or(Refusal::Precondition(ReasonCode::BindingNotActive))
}

pub(super) async fn fresh(
    state: &ServiceState,
    tx: &mut Transaction<'_, Postgres>,
    scope: &RuntimeScope,
) -> Result<(), Refusal> {
    let b = binding(tx, scope).await?;
    let g = &state.governance;
    if !g
        .spicedb
        .resource_projection_matches_in_workspace(
            &scope.executor_installation_resource_id.to_string(),
            &scope.tenant_id.to_string(),
            &b.installation_owner.to_string(),
            Some(&scope.workspace_id.to_string()),
            g.cfg.relationship_page,
        )
        .await
        .map_err(|_| Refusal::Unavailable("Installation projection unavailable".into()))?
    {
        return Err(Refusal::Precondition(ReasonCode::ProjectionDelayed));
    }
    let checked = g
        .spicedb
        .check(
            "workspace",
            &scope.workspace_id.to_string(),
            "discover",
            &scope.agent_principal_id.to_string(),
            Consistency::FullyConsistent,
        )
        .await
        .map_err(|_| Refusal::Unavailable("Agent Workspace permission unavailable".into()))?;
    if checked.zed_token.is_empty() {
        return Err(Refusal::Unavailable(
            "Agent Workspace revision unavailable".into(),
        ));
    }
    if !checked.allowed {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    let (control, _) = crate::tenant_lifecycle::control_client(
        state,
        scope.tenant_id,
        crate::tenant_lifecycle::ProjectionDirection::Establish,
    )
    .await
    .map_err(|_| Refusal::Unavailable("Agent roster unavailable".into()))?;
    let channel = b.channel_id.to_string();
    for scope in [
        collab_bridge::bridge::Scope::Relay,
        collab_bridge::bridge::Scope::Channel(&channel),
    ] {
        let roster = control
            .roster(&state.http, scope)
            .await
            .map_err(|_| Refusal::Unavailable("Agent roster unavailable".into()))?;
        if !roster.iter().any(|member| member.pubkey == b.agent_pubkey) {
            return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
        }
    }
    Ok(())
}
