//! DD-149(4): SpiceDB projection of a connector and its tools under the fixed schema.
//! Every Resource gets tenant/owner (and home Workspace for WORKSPACE visibility) in
//! one native write; TENANT visibility adds the DD-122 member grants on tools
//! (discoverer/consumer/sharer) and the DD-131(6) catalog grants on the connector
//! (discoverer/reader). No per-member relationship is ever written.

use uuid::Uuid;

use super::unavailable;
use crate::governance::{Governance, Refusal};
use crate::spicedb::{Consistency, Relationship, RelationshipFilter, Subject, Write};

/// Project one Resource (connector or tool) and read it back. `shared` selects the
/// TENANT member grants; `tool` selects which grant set applies.
pub(crate) async fn project(
    gov: &Governance,
    resource: Uuid,
    tenant: Uuid,
    owner: Uuid,
    workspace: Option<Uuid>,
    shared: bool,
    tool: bool,
) -> Result<String, Refusal> {
    let id = resource.to_string();
    let tenant_text = tenant.to_string();
    let token = gov
        .spicedb
        .replace_resource_projection(
            &id,
            &tenant_text,
            &owner.to_string(),
            &owner.to_string(),
            workspace.map(|w| w.to_string()).as_deref(),
        )
        .await
        .map_err(|_| unavailable("resource projection"))?;
    let grants = grants(&id, &tenant_text, tool);
    let writes: Vec<(Write, Relationship)> = grants
        .into_iter()
        .map(|grant| (if shared { Write::Touch } else { Write::Delete }, grant))
        .collect();
    let token = if writes.is_empty() {
        token
    } else {
        gov.spicedb
            .write(&writes)
            .await
            .map_err(|_| unavailable("visibility grants"))?
    };
    verify(
        gov, resource, tenant, owner, workspace, shared, tool, &token,
    )
    .await?;
    Ok(token)
}

fn grants(id: &str, tenant: &str, tool: bool) -> Vec<Relationship> {
    if tool {
        Relationship::tenant_member_grants(id, tenant).to_vec()
    } else {
        Relationship::catalog_share_grants(id, tenant).to_vec()
    }
}

/// Owner, Tenant and home Workspace close exactly; member grants are present iff shared.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn verify(
    gov: &Governance,
    resource: Uuid,
    tenant: Uuid,
    owner: Uuid,
    workspace: Option<Uuid>,
    shared: bool,
    tool: bool,
    token: &str,
) -> Result<(), Refusal> {
    let id = resource.to_string();
    let tenant_text = tenant.to_string();
    let closes = gov
        .spicedb
        .resource_projection_matches_in_workspace(
            &id,
            &tenant_text,
            &owner.to_string(),
            workspace.map(|w| w.to_string()).as_deref(),
            gov.cfg.relationship_page,
        )
        .await
        .map_err(|_| unavailable("projection read"))?;
    if !closes {
        return Err(unavailable("projection not closed"));
    }
    let proof = gov
        .spicedb
        .check(
            "resource",
            &id,
            "manage",
            &owner.to_string(),
            Consistency::AtLeastAsFresh(token),
        )
        .await
        .map_err(|_| unavailable("projection check"))?;
    if proof.zed_token.is_empty() || !proof.allowed {
        return Err(unavailable("projection check"));
    }
    for grant in grants(&id, &tenant_text, tool) {
        let rows = gov
            .spicedb
            .read(
                &RelationshipFilter {
                    object_type: "resource",
                    object_id: Some(&id),
                    relation: Some(&grant.relation),
                    subject_principal: None,
                },
                gov.cfg.relationship_page,
            )
            .await
            .map_err(|_| unavailable("grant read"))?;
        let present = rows
            .iter()
            .any(|row| row.subject == Subject::TenantMembers(tenant_text.clone()));
        if present != shared {
            return Err(unavailable("visibility grants not closed"));
        }
    }
    Ok(())
}

/// Tombstone projection: every relationship on the Resource (owner, tenant/home arrows,
/// member grants and any Agent grants) is deleted natively and read back absent.
pub(crate) async fn withdraw(gov: &Governance, resource: Uuid) -> Result<(), Refusal> {
    let id = resource.to_string();
    gov.spicedb
        .delete_resource_projection(resource)
        .await
        .map_err(|_| unavailable("withdraw relationships"))?;
    let remaining = gov
        .spicedb
        .read_native(
            &RelationshipFilter {
                object_type: "resource",
                object_id: Some(&id),
                relation: None,
                subject_principal: None,
            },
            gov.cfg.relationship_page,
        )
        .await
        .map_err(|_| unavailable("withdraw read"))?;
    if !remaining.is_empty() {
        return Err(Refusal::Precondition(
            contracts::ReasonCode::ProjectionDelayed,
        ));
    }
    Ok(())
}
