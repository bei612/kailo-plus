//! DD-107: webhook credentials stay in the original Tenant OpenBao authority.
//! The management AE freezes the exact locator before any native write. No
//! credential value is returned by the BFF or written into AE/audit/history.
use super::*;
use secret_store::SecretRef;
use sha2::Digest;

fn unavailable() -> Refusal {
    Refusal::Unavailable("Automation webhook SecretRef is not verifiable".into())
}

fn reference(value: &Value) -> Result<SecretRef, Refusal> {
    let fields = value.as_object().ok_or_else(invalid_management)?;
    if fields.len() != 3 {
        return Err(invalid_management());
    }
    Ok(SecretRef {
        locator: value["locator"]
            .as_str()
            .filter(|s| !s.is_empty())
            .ok_or_else(invalid_management)?
            .into(),
        audience: value["audience"]
            .as_str()
            .filter(|s| !s.is_empty())
            .ok_or_else(invalid_management)?
            .into(),
        version: value["version"]
            .as_u64()
            .and_then(|v| u32::try_from(v).ok())
            .filter(|v| *v > 0)
            .ok_or_else(invalid_management)?,
    })
}

pub(super) async fn freeze(
    g: &Governance,
    tx: &mut Transaction<'_, Postgres>,
    ae: &governance::Execution,
    row: &ManagementResource,
) -> Result<Option<Value>, Refusal> {
    let rotating = ae.action_key == "automation.rotate_webhook_secret";
    let enabling = ae.action_key == "automation.enable";
    let creating = rotating || (enabling && sqlx::query_scalar::<_,bool>("select exists(select 1 from catalog.automation_version
        where asset_id=$1 and automation_resource_id=$2 and state='PUBLISHED' and trigger->>'kind'='WEBHOOK')")
        .bind(ae.parameters.as_ref().and_then(|p|p.get("assetId")).and_then(Value::as_str).and_then(|s|Uuid::parse_str(s).ok()))
        .bind(row.id).fetch_one(&mut **tx).await?);
    if !creating && row.webhook_secret_ref.is_none() {
        return Ok(None);
    }
    let audience = std::env::var("OPENBAO_SERVICE_IDENTITY")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .ok_or_else(unavailable)?;
    // As with the existing model credential producer, every immutable intent
    // owns one CAS=0 locator. Reentry can read version 1, never append a key.
    let locator = g.secrets.tenant_locator(
        ae.tenant_id,
        &format!("automation-webhook/{}/{}", row.id, ae.id),
    );
    let new_ref = creating.then(|| json!({"locator":locator,"version":1,"audience":audience}));
    let previous: Value = sqlx::query_scalar(
        "select to_jsonb(d) from catalog.automation_definition d where resource_id=$1",
    )
    .bind(row.id)
    .fetch_one(&mut **tx)
    .await?;
    let intent = json!({"newRef":new_ref,"oldRef":row.webhook_secret_ref,"writeStarted":false,"aborting":false,
        "previousDefinition":previous,"newStatus":if creating{"PENDING"}else{"NONE"},
        "oldStatus":if row.webhook_secret_ref.is_some(){"ACTIVE"}else{"NONE"}});
    sqlx::query("update admission.action_execution set parameters=parameters||jsonb_build_object('webhookSecretIntent',$2::jsonb) where id=$1")
        .bind(ae.id).bind(intent).execute(&mut **tx).await?;
    sqlx::query("update catalog.resource set projection_action_execution_id=$2,version=version+case when $3 then 1 else 0 end where id=$1 and (projection_action_execution_id is null or projection_action_execution_id=$2)")
        .bind(row.id).bind(ae.id).bind(rotating).execute(&mut **tx).await?;
    Ok(new_ref)
}

pub(super) async fn dispatch(g: &Governance, id: Uuid, def: &Definition) -> Result<(), Refusal> {
    // The durable intent pins one locator and native CAS=0 owns its sole
    // creation. A process-local flag cannot prove whether a pre-crash write ran.
    while advance(g, id, def).await? {}
    Ok(())
}

async fn unknown(
    tx: Transaction<'_, Postgres>,
    ae: &governance::Execution,
    def: &Definition,
) -> Result<bool, Refusal> {
    management_unknown(tx, ae, def).await?;
    Ok(false)
}

async fn persist(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
    intent: &Value,
) -> Result<(), Refusal> {
    sqlx::query("update admission.action_execution set parameters=parameters||jsonb_build_object('webhookSecretIntent',$2::jsonb) where id=$1")
        .bind(id).bind(intent).execute(&mut **tx).await?;
    Ok(())
}

async fn advance(g: &Governance, id: Uuid, def: &Definition) -> Result<bool, Refusal> {
    let mut tx = g.pool.begin().await?;
    let ae = governance::lock_execution(&mut tx, id).await?;
    if ae.gate_state != "ALLOWED"
        || !matches!(ae.dispatch_state.as_str(), "NOT_DISPATCHED" | "UNKNOWN")
    {
        return Ok(false);
    }
    let Some(mut intent) = ae
        .parameters
        .as_ref()
        .and_then(|p| p.get("webhookSecretIntent"))
        .cloned()
    else {
        return Ok(false);
    };
    if intent["complete"] == true {
        return Ok(false);
    }
    let active: bool =
        sqlx::query_scalar("select state='ACTIVE' from identity.tenant where id=$1 for update")
            .bind(ae.tenant_id)
            .fetch_optional(&mut *tx)
            .await?
            .unwrap_or(false);
    let row = management_resource(&mut tx, ae.tenant_id, ae.target_id, true)
        .await?
        .ok_or_else(invalid_management)?;
    let new_ref = (!intent["newRef"].is_null())
        .then(|| reference(&intent["newRef"]))
        .transpose()?;
    if row.projection_action_execution_id != Some(ae.id)
        || Some(row.version) != ae.frozen_target_version().and_then(|v| v.checked_add(1))
        || new_ref.as_ref().is_some_and(|secret| {
            secret.version != 1
                || secret.locator
                    != g.secrets.tenant_locator(
                        ae.tenant_id,
                        &format!("automation-webhook/{}/{}", row.id, ae.id),
                    )
        })
    {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    if intent["newStatus"] != "PENDING" {
        return finish(g, tx, &ae, def, &row, intent, new_ref.as_ref()).await;
    }
    let new_ref = new_ref.ok_or_else(invalid_management)?;
    let workspace_active = sqlx::query_scalar::<_, bool>(
        "select state='ACTIVE' from identity.workspace where id=$1 and tenant_id=$2 for update",
    )
    .bind(row.workspace_id)
    .bind(ae.tenant_id)
    .fetch_optional(&mut *tx)
    .await?
    .unwrap_or(false);
    let authorization = if active && workspace_active {
        management_authorized(g, &mut tx, &ae, def, &row).await
    } else {
        Err(Refusal::Denied(ReasonCode::ScopeGuardFailed))
    };
    match authorization {
        Ok(()) => {}
        Err(Refusal::Denied(_)) => {
            intent["aborting"] = json!(true);
            intent["newStatus"] = json!("SUPERSEDED");
            persist(&mut tx, id, &intent).await?;
            tx.commit().await?;
            return Ok(true);
        }
        Err(_) => return unknown(tx, &ae, def).await,
    }
    if intent["writeStarted"] == false {
        intent["writeStarted"] = json!(true);
        persist(&mut tx, id, &intent).await?;
        management_unknown(tx, &ae, def).await?;
        return Ok(true);
    }
    let value = match g.secrets.read(&new_ref, "value").await {
        Ok(value) => value,
        Err(secret_store::SecretError::VersionUnavailable) => {
            let mut bytes = vec![0; sha2::Sha256::output_size()];
            getrandom::fill(&mut bytes).map_err(|_| unavailable())?;
            // A concurrent/late writer is atomically fenced by the original
            // write_once CAS=0. Its ACK is not truth; read the exact pinned
            // version, including after a rejected or lost response.
            let _ack = g
                .secrets
                .write_once(&new_ref.locator, "value", &hex::encode(bytes))
                .await;
            match g.secrets.read(&new_ref, "value").await {
                Ok(value) => value,
                Err(_) => return unknown(tx, &ae, def).await,
            }
        }
        Err(_) => return unknown(tx, &ae, def).await,
    };
    if hex::decode(value.expose())
        .ok()
        .is_none_or(|v| v.len() != sha2::Sha256::output_size())
    {
        return unknown(tx, &ae, def).await;
    }
    // These are reference/status observations, not a second credential store.
    intent["newStatus"] = json!("ACTIVE");
    if !intent["oldRef"].is_null() {
        intent["oldStatus"] = json!("SUPERSEDED");
    }
    sqlx::query("update catalog.automation_definition set webhook_secret_ref=$2,version=version+1 where resource_id=$1")
        .bind(row.id).bind(&intent["newRef"]).execute(&mut *tx).await?;
    persist(&mut tx, id, &intent).await?;
    tx.commit().await?;
    Ok(true)
}

async fn finish(
    g: &Governance,
    mut tx: Transaction<'_, Postgres>,
    ae: &governance::Execution,
    def: &Definition,
    row: &ManagementResource,
    mut intent: Value,
    new_ref: Option<&SecretRef>,
) -> Result<bool, Refusal> {
    let aborting = intent["aborting"] == true;
    if aborting {
        // CAS=0 native fencing also covers a write whose response was lost.
        // Cleanup is confined to this original intent; revoked users receive
        // neither a new credential nor additional authorization.
        if g.secrets
            .retire_automation_webhook(
                ae.tenant_id,
                row.id,
                ae.id,
                new_ref.ok_or_else(invalid_management)?,
                true,
            )
            .await
            .is_err()
        {
            return unknown(tx, ae, def).await;
        }
        intent["newStatus"] = json!("REVOKED");
        if ae.action_key == "automation.enable" {
            if let Some(schedule) = ae.parameters.as_ref().and_then(|p| p.get("scheduleIntent")) {
                // The dispatcher orders Secret before Schedule. Do not infer
                // absence or restore an older Schedule after any native intent
                // might have been sent by an interrupted/older writer.
                if schedule["started"] != false || schedule["oldDeleteStarted"] != false {
                    persist(&mut tx, ae.id, &intent).await?;
                    return unknown(tx, ae, def).await;
                }
                sqlx::query("update admission.action_execution set parameters=jsonb_set(parameters,'{scheduleIntent,complete}','true'::jsonb) where id=$1")
                    .bind(ae.id).execute(&mut *tx).await?;
            }
            // Undo only this pending activation's own metadata. No older run,
            // published version, secret or Schedule is reconstructed here.
            let previous = &intent["previousDefinition"];
            sqlx::query(
                "update catalog.automation_definition set state=$2,
                pinned_version_asset_id=$3,delegation_id=$4,webhook_secret_ref=$5,
                enabled_at=$6,schedule_id=$7,version=version+1 where resource_id=$1",
            )
            .bind(row.id)
            .bind(previous["state"].as_str().ok_or_else(invalid_management)?)
            .bind(
                previous["pinned_version_asset_id"]
                    .as_str()
                    .and_then(|s| Uuid::parse_str(s).ok()),
            )
            .bind(
                previous["delegation_id"]
                    .as_str()
                    .and_then(|s| Uuid::parse_str(s).ok()),
            )
            .bind(
                (!previous["webhook_secret_ref"].is_null())
                    .then(|| previous["webhook_secret_ref"].clone()),
            )
            .bind(
                previous["enabled_at"]
                    .as_str()
                    .and_then(|s| s.parse::<chrono::DateTime<chrono::Utc>>().ok()),
            )
            .bind(previous["schedule_id"].as_str())
            .execute(&mut *tx)
            .await?;
        }
    } else {
        if (new_ref.is_some()
            && (intent["newStatus"] != "ACTIVE"
                || row.webhook_secret_ref.as_ref() != Some(&intent["newRef"])))
            || (new_ref.is_none() && intent["newStatus"] != "NONE")
        {
            return unknown(tx, ae, def).await;
        }
        if !intent["oldRef"].is_null() && intent["oldStatus"] != "REVOKED" {
            // The projection fence excludes new runs while the original
            // generation drains. UNKNOWN/native-only completion is not enough.
            let drained: bool = sqlx::query_scalar("select not exists(select 1 from catalog.agent_invocation i
                where i.automation_resource_id=$1 and
                  (i.status not in ('COMPLETED','FAILED','CANCELED')
                   or exists(select 1 from projection.workflow_ref w where w.action_execution_id=i.action_execution_id and w.projection_state<>'TERMINAL')
                   or exists(select 1 from admission.capacity_lease l where l.invocation_id=i.id and (l.state<>'RELEASED' or l.native_release_confirmed_at is null))
                   or exists(select 1 from outbox.usage_event u where u.invocation_id=i.id and (u.settlement_status<>'COMMITTED' or u.stored_at is null))))")
                .bind(row.id).fetch_one(&mut *tx).await?;
            if !drained {
                return unknown(tx, ae, def).await;
            }
            let old_ref = reference(&intent["oldRef"])?;
            let prefix = g
                .secrets
                .tenant_locator(ae.tenant_id, &format!("automation-webhook/{}/", row.id));
            let old_id = old_ref
                .locator
                .strip_prefix(&prefix)
                .and_then(|s| Uuid::parse_str(s).ok())
                .ok_or_else(unavailable)?;
            let owned: bool = sqlx::query_scalar("select exists(select 1 from admission.action_execution where id=$1 and tenant_id=$2
                and workspace_id=$3 and target_id=$4 and action_key in ('automation.enable','automation.rotate_webhook_secret')
                and parameters->'webhookSecretIntent'->'newRef'=$5::jsonb)")
                .bind(old_id).bind(ae.tenant_id).bind(ae.workspace_id).bind(row.id).bind(&intent["oldRef"])
                .fetch_one(&mut *tx).await?;
            if !owned
                || g.secrets
                    .retire_automation_webhook(ae.tenant_id, row.id, old_id, &old_ref, false)
                    .await
                    .is_err()
            {
                return unknown(tx, ae, def).await;
            }
            intent["oldStatus"] = json!("REVOKED");
        }
        if new_ref.is_none() {
            sqlx::query("update catalog.automation_definition set webhook_secret_ref=null,version=version+1 where resource_id=$1")
                .bind(row.id).execute(&mut *tx).await?;
        }
    }
    persist(&mut tx, ae.id, &intent).await?;
    complete_management_intent(&mut tx, ae, def, "webhookSecretIntent").await?;
    tx.commit().await?;
    Ok(false)
}
