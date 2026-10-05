//! APPLICATION tools use the existing Version requirements, ToolBinding and
//! Delegation authorities. Gateway remains the only protocol discovery/router.

use crate::application_binding::native::Connector;
use crate::{
    agent_tool::{permission, InvocationContext},
    agent_tool_session::SessionScope,
    governance::{Execution, Refusal},
    service_api::ServiceState,
};
use contracts::ReasonCode;
use serde_json::{json, Value};
use sqlx::{PgConnection, Postgres, Transaction};
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

fn invalid() -> Refusal {
    Refusal::Precondition(ReasonCode::InvalidParameters)
}

fn output_value(
    raw: &Value,
    output: &Value,
    documents: &BTreeMap<String, Value>,
) -> Result<Value, Refusal> {
    let value: Value = serde_json::from_str(raw["resultJson"].as_str().ok_or_else(invalid)?)
        .map_err(|_| invalid())?;
    if !crate::capability_contract::schema_validator(output, documents)?.is_valid(&value) {
        return Err(invalid());
    }
    // An envelope reference is not proof of native ownership or revision.
    if raw.get("contentReference").is_some() {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    Ok(value)
}

#[cfg(test)]
mod application_tool_tests {
    use super::*;

    #[tokio::test]
    #[ignore = "requires an isolated migrated application_tool_verify_* PostgreSQL database"]
    async fn zero_application_bindings_do_not_block_installation_resolution() {
        let pool = sqlx::PgPool::connect(
            &std::env::var("APPLICATION_TOOL_TEST_DATABASE_URL").expect("isolated test database"),
        )
        .await
        .unwrap();
        let database: String = sqlx::query_scalar("select current_database()")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(database.starts_with("application_tool_verify_"));
        let mut tx = pool.begin().await.unwrap();
        let bindings: i64 = sqlx::query_scalar("select count(*) from catalog.application_binding")
            .fetch_one(&mut *tx)
            .await
            .unwrap();
        assert_eq!(
            bindings, 0,
            "this case requires the zero-component deployment"
        );
        // Execute the production query against the real migration schema.
        // Empty input must not hide invalid column references in the INSERT.
        resolve_installation(&mut tx, Uuid::new_v4(), Uuid::new_v4(), 1)
            .await
            .unwrap();
        let tools: i64 = sqlx::query_scalar("select count(*) from catalog.tool_binding")
            .fetch_one(&mut *tx)
            .await
            .unwrap();
        assert_eq!(tools, 0);
        tx.rollback().await.unwrap();
        pool.close().await;
    }

    #[test]
    fn peer_terminal_requires_schema_valid_result_or_explicit_native_error() {
        use rmcp::model::{CallToolResult, ContentBlock};
        let schema = json!({"type":"string"});
        let documents = BTreeMap::new();
        assert_eq!(
            peer_terminal_result(
                &CallToolResult::success(vec![ContentBlock::text("value")]),
                &schema,
                &documents
            )
            .unwrap(),
            "SUCCEEDED"
        );
        assert_eq!(
            peer_terminal_result(
                &CallToolResult::error(vec![ContentBlock::text("native failure")]),
                &schema,
                &documents
            )
            .unwrap(),
            "FAILED"
        );
        for invalid in [
            CallToolResult::success(vec![]),
            CallToolResult::structured(json!({"unexpected":true})),
            CallToolResult::success(vec![ContentBlock::text("a"), ContentBlock::text("b")]),
        ] {
            assert!(peer_terminal_result(&invalid, &schema, &documents).is_err());
        }
    }

    #[test]
    fn disclosed_output_is_the_checked_business_value_not_adapter_envelope() {
        let schema = json!({"type":"object","additionalProperties":false,
            "required":["answer"],"properties":{"answer":{"type":"string"}}});
        let envelope = json!({"execution":{"nativeId":"private-execution"},
            "resultJson":"{\n  \"answer\": \"allowed\"\n}"});
        let value = output_value(&envelope, &schema, &BTreeMap::new()).unwrap();
        assert_eq!(value, json!({"answer":"allowed"}));
        let wire = serde_json::to_value(rmcp::model::CallToolResult::structured(value)).unwrap();
        assert_eq!(wire["structuredContent"], json!({"answer":"allowed"}));
        assert!(!wire.to_string().contains("private-execution"));
        assert!(!wire.to_string().contains("resultJson"));
        let mut wrong = envelope.clone();
        wrong["resultJson"] = json!("{\"answer\":42}");
        assert!(output_value(&wrong, &schema, &BTreeMap::new()).is_err());
        wrong["resultJson"] = json!("{\"answer\":\"allowed\",\"extra\":\"denied\"}");
        assert!(output_value(&wrong, &schema, &BTreeMap::new()).is_err());
        wrong = envelope;
        wrong["contentReference"] = json!({"resourceId":Uuid::new_v4()});
        assert!(output_value(&wrong, &schema, &BTreeMap::new()).is_err());
    }

    #[test]
    fn model_target_envelope_is_exact_and_canonical() {
        let id = Uuid::new_v4();
        for (field, kind) in [("resourceId", "RESOURCE"), ("assetId", "ASSET")] {
            let mut value = json!({"target":{field:id},"input":{"nativeArgument":"unchanged"}});
            assert_eq!(target(&value).unwrap(), (kind, id));
            value["target"][field] = json!(id.to_string().to_uppercase());
            assert!(target(&value).is_err());
        }
        for invalid in [
            json!({"input":{}}),
            json!({"target":{},"input":{}}),
            json!({"target":{"resourceId":id,"assetId":id},"input":{}}),
            json!({"target":{"resourceId":Uuid::nil()},"input":{}}),
            json!({"target":{"resourceId":id},"input":{},"tenantId":id}),
            json!({"target":{"resourceId":id}}),
        ] {
            assert!(target(&invalid).is_err());
        }
    }

    #[test]
    fn authorization_digest_covers_target_and_business_input() {
        let original =
            json!({"target":{"resourceId":Uuid::new_v4()},"input":{"n":1.25,"text":"\u{2028}"}});
        let digest = collab_bridge::limits::canonical_digest(&original);
        let mut changed = original.clone();
        changed["target"]["resourceId"] = json!(Uuid::new_v4());
        assert_ne!(digest, collab_bridge::limits::canonical_digest(&changed));
        changed = original;
        changed["input"]["n"] = json!(1.5);
        assert_ne!(digest, collab_bridge::limits::canonical_digest(&changed));
    }
}

pub(crate) fn target(arguments: &Value) -> Result<(&str, Uuid), Refusal> {
    let args = arguments.as_object().ok_or_else(invalid)?;
    if args.len() != 2 || !args.contains_key("input") {
        return Err(invalid());
    }
    let target = args
        .get("target")
        .and_then(Value::as_object)
        .ok_or_else(invalid)?;
    if target.len() != 1 {
        return Err(invalid());
    }
    let (field, value) = target.iter().next().ok_or_else(invalid)?;
    let kind = match field.as_str() {
        "resourceId" => "RESOURCE",
        "assetId" => "ASSET",
        _ => return Err(invalid()),
    };
    let raw = value.as_str().ok_or_else(invalid)?;
    let id = Uuid::parse_str(raw).map_err(|_| invalid())?;
    if id.is_nil() || id.to_string() != raw {
        return Err(invalid());
    }
    Ok((kind, id))
}

async fn schemas(
    conn: &mut PgConnection,
    binding: Uuid,
    action: &str,
) -> Result<BTreeMap<String, Value>, Refusal> {
    let contents:Vec<Value>=sqlx::query_scalar("select c.schema_documents
        from catalog.application_binding b join lateral jsonb_array_elements(b.capability_categories) category on true
        join catalog.capability_contract c on c.category_key=category->>'category' and c.contract_version::text=category->>'version'
        where b.id=$1 and exists(select 1 from jsonb_array_elements(c.content->'operationContracts') op
          where op->>'contractKey'=$2)")
        .bind(binding).bind(action).fetch_all(conn).await?;
    if contents.len() != 1 {
        return Err(unavailable());
    }
    let mut documents = BTreeMap::new();
    for document in contents[0].as_array().ok_or_else(unavailable)? {
        let digest = document["digest"].as_str().ok_or_else(unavailable)?;
        let schema = &document["schema"];
        if collab_bridge::limits::canonical_digest(schema) != digest
            || documents.insert(digest.into(), schema.clone()).is_some()
        {
            return Err(unavailable());
        }
    }
    Ok(documents)
}

async fn target_facts(
    gov: &crate::governance::Governance,
    conn: &mut PgConnection,
    context: &InvocationContext,
    parent: &Execution,
    tool: &Tool,
    kind: &str,
    id: Uuid,
) -> Result<
    (
        crate::application_catalog::ApplicationDefinition,
        i32,
        String,
    ),
    Refusal,
> {
    let (binding, generation, definition) = match kind {
        "RESOURCE" => {
            crate::application_catalog::definition_for_resource(
                conn,
                context.tenant_id,
                Some(context.workspace_id),
                id,
                &tool.action_key,
                tool.action_version,
            )
            .await?
        }
        "ASSET" => {
            crate::application_catalog::definition_for_asset(
                conn,
                context.tenant_id,
                Some(context.workspace_id),
                id,
                &tool.action_key,
                tool.action_version,
            )
            .await?
        }
        _ => return Err(invalid()),
    };
    if binding != tool.binding_id
        || generation != tool.generation
        || definition.definition_id != tool.definition_id
        || definition.definition.target_type != kind
    {
        return Err(denied());
    }
    let allowed = scopes(gov, conn, context, parent, tool)
        .await?
        .into_iter()
        .any(|scope| {
            scope.target_type == kind && scope.target_id.as_deref() == Some(id.to_string().as_str())
        });
    if !allowed {
        return Err(denied());
    }
    let version: Option<i32> = match kind {
        "RESOURCE" => sqlx::query_scalar(
            "select version from catalog.resource where id=$1 and tenant_id=$2 and state='ACTIVE'",
        )
        .bind(id)
        .bind(context.tenant_id)
        .fetch_optional(&mut *conn)
        .await?,
        "ASSET" => {
            sqlx::query_scalar(
                "select version from catalog.asset where id=$1 and tenant_id=$2 and state='ACTIVE'",
            )
            .bind(id)
            .bind(context.tenant_id)
            .fetch_optional(&mut *conn)
            .await?
        }
        _ => return Err(invalid()),
    };
    let proof = gov
        .spicedb
        .check(
            &definition.definition.permission_object_type,
            &id.to_string(),
            &definition.definition.permission,
            &context.agent_principal_id.to_string(),
            crate::spicedb::Consistency::FullyConsistent,
        )
        .await
        .map_err(|_| unavailable())?;
    if !proof.allowed || proof.zed_token.is_empty() {
        return Err(denied());
    }
    Ok((definition, version.ok_or_else(denied)?, proof.zed_token))
}

/// Reused by original approval consumption and response disclosure. No body is
/// stored in ActionExecution; its exact target/Tool/provider refs are immutable.
pub(crate) async fn fresh_execution(
    gov: &crate::governance::Governance,
    ae: &Execution,
) -> Result<crate::governance::Evaluation, Refusal> {
    let mut tx = gov.pool.begin().await?;
    let parameters = ae.parameters.as_ref().ok_or_else(denied)?;
    let invocation = parameters["invocationId"]
        .as_str()
        .and_then(|v| Uuid::parse_str(v).ok())
        .ok_or_else(denied)?;
    let context:InvocationContext=sqlx::query_as("select i.id,i.tenant_id,i.workspace_id,i.installation_resource_id,
        i.projection_generation,i.delegation_id,i.runtime_turn_id,i.action_execution_id parent_action_execution_id,
        installed.agent_principal_id from catalog.agent_invocation i
        join catalog.agent_installation installed on installed.resource_id=i.installation_resource_id
          and installed.state='ACTIVE' and installed.workspace_id=i.workspace_id
        join catalog.agent_session s on s.tenant_id=i.tenant_id and s.workspace_id=i.workspace_id
          and s.installation_resource_id=i.installation_resource_id and s.root_event_id=i.root_event_id
          and s.agent_version_asset_id=i.agent_version_asset_id and s.projection_generation=i.projection_generation
        join identity.tenant tenant on tenant.id=i.tenant_id and tenant.state='ACTIVE'
        join identity.workspace workspace on workspace.id=i.workspace_id and workspace.tenant_id=i.tenant_id and workspace.state='ACTIVE'
        where i.id=$1 and i.status='RUNNING' and i.native_status='inProgress' and not i.cancel_pending
          and i.reply_event_id is null and i.runtime_turn_id is not null
          and s.status='ACTIVE' and s.runtime_thread_id is not null")
        .bind(invocation).fetch_optional(&mut *tx).await?.ok_or_else(denied)?;
    let parent =
        crate::governance::lock_execution(&mut tx, context.parent_action_execution_id).await?;
    if parent.gate_state != "ALLOWED" || parent.dispatch_state != "DISPATCHED" {
        return Err(denied());
    }
    for subject in [parent.initiator_principal_id, context.agent_principal_id] {
        let member:bool=sqlx::query_scalar("select exists(select 1 from identity.principal p
            where id=$1 and tenant_id=$2 and status='ACTIVE'
              and ((kind='AGENT' and id=$3) or (kind='HUMAN' and exists(select 1 from identity.tenant_membership
                where tenant_principal_id=p.id and tenant_id=p.tenant_id and state='ACTIVE'))))")
            .bind(subject).bind(context.tenant_id).bind(context.agent_principal_id).fetch_one(&mut *tx).await?;
        if !member {
            return Err(denied());
        }
        let check = gov
            .spicedb
            .check(
                "workspace",
                &context.workspace_id.to_string(),
                "discover",
                &subject.to_string(),
                crate::spicedb::Consistency::FullyConsistent,
            )
            .await
            .map_err(|_| unavailable())?;
        if !check.allowed || check.zed_token.is_empty() {
            return Err(denied());
        }
    }
    let tool = tools(&mut tx, &context)
        .await?
        .into_iter()
        .find(|tool| parameters["toolResourceId"] == json!(tool.resource_id))
        .ok_or_else(denied)?;
    let kind = parameters["targetType"].as_str().ok_or_else(denied)?;
    let (definition, version, proof) =
        target_facts(gov, &mut tx, &context, &parent, &tool, kind, ae.target_id).await?;
    let frozen:bool=sqlx::query_scalar("select exists(select 1 from admission.action_execution
        where id=$1 and parent_action_execution_id=$2 and operation_id=$3 and action_definition_id=$4
          and component_binding_kind='APPLICATION' and component_binding_id=$5
          and component_release_id=$6 and component_projection_generation=$7)")
        .bind(ae.id).bind(parent.id).bind(parent.operation_id).bind(definition.definition_id).bind(tool.binding_id)
        .bind(definition.component_release_id).bind(tool.generation).fetch_one(&mut *tx).await?;
    if !frozen
        || ae.actor_principal_id != context.agent_principal_id
        || ae.initiator_principal_id != parent.initiator_principal_id
        || ae.tenant_id != context.tenant_id
        || ae.workspace_id != Some(context.workspace_id)
        || parameters["targetVersion"] != version
        || parameters["runtimeTurnId"] != json!(context.runtime_turn_id)
    {
        return Err(denied());
    }
    tx.commit().await?;
    Ok(crate::governance::Evaluation {
        allowed: true,
        scope: "ALLOW",
        authorization: "ALLOW",
        quota: "NOT_APPLICABLE",
        zed_token: Some(proof),
        reason: None,
    })
}

pub(crate) async fn prepare(
    state: &ServiceState,
    invocation: Uuid,
    binding: Uuid,
    generation: i64,
    name: &str,
    arguments: &Value,
) -> Result<Execution, Refusal> {
    let (kind, target) = target(arguments)?;
    let hash = collab_bridge::limits::canonical_digest(arguments);
    let mut tx = state.pool.begin().await?;
    let (context, parent) =
        crate::agent_tool::invocation_context(state, &mut tx, invocation, true).await?;
    let tool = tools(&mut tx, &context)
        .await?
        .into_iter()
        .find(|tool| {
            tool.binding_id == binding && tool.generation == generation && tool.name == name
        })
        .ok_or_else(denied)?;
    let (application, version, proof) = target_facts(
        &state.governance,
        &mut tx,
        &context,
        &parent,
        &tool,
        kind,
        target,
    )
    .await?;
    let definition = &application.definition;
    let docs = schemas(&mut tx, tool.binding_id, &tool.action_key).await?;
    let input = docs
        .get(
            tool.declaration["inputSchemaDigest"]
                .as_str()
                .ok_or_else(unavailable)?,
        )
        .ok_or_else(unavailable)?;
    if !crate::capability_contract::schema_validator(input, &docs)?.is_valid(&arguments["input"]) {
        return Err(invalid());
    }
    if definition.execution_mode != "SYNC"
        || !matches!(definition.confirmation_mode.as_str(), "NONE" | "APPROVAL")
    {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    let pending:Option<Uuid>=sqlx::query_scalar("select id from admission.action_execution
        where parent_action_execution_id=$1 and action_definition_id=$2 and parameters->>'toolParameterHash'=$3
          and parameters->>'runtimeTurnId'=$4 and gate_state not in ('DENIED','EXPIRED','CANCELLED')
          and dispatch_state in ('NOT_DISPATCHED','UNKNOWN','DISPATCHED') order by created_at limit 1")
        .bind(parent.id).bind(application.definition_id).bind(&hash).bind(&context.runtime_turn_id)
        .fetch_optional(&mut *tx).await?;
    if let Some(id) = pending {
        let previous = crate::governance::lock_execution(&mut tx, id).await?;
        if previous.gate_state == "ALLOWED" && previous.dispatch_state == "NOT_DISPATCHED" {
            tx.commit().await?;
            return Ok(previous);
        }
        return Err(Refusal::Unavailable(
            "original APPLICATION action is awaiting admission or reconciliation".into(),
        ));
    }
    let policy:(Uuid,i32,i32)=sqlx::query_as("select s.result_exposure_policy_id,s.result_exposure_policy_version,g.version
        from admission.delegation_scope s join admission.delegation_grant g on g.id=s.delegation_id
        where s.delegation_id=$1 and s.action_definition_id=$2 and s.tool_resource_id=$3
          and s.target_type=$4 and s.target_id=$5 and s.create_workspace_id is null and g.state='ACTIVE'")
        .bind(context.delegation_id).bind(application.definition_id).bind(tool.resource_id).bind(kind).bind(target)
        .fetch_optional(&mut *tx).await?.ok_or_else(denied)?;
    let parameters = json!({"toolResourceId":tool.resource_id,"toolParameterHash":hash,"invocationId":invocation,
        "runtimeTurnId":context.runtime_turn_id,"targetVersion":version,"targetType":kind,
        "delegationId":context.delegation_id,"delegationVersion":policy.2,
        "resultExposurePolicyId":policy.0,"resultExposurePolicyVersion":policy.1});
    let child = Uuid::new_v4();
    let idempotency = Uuid::new_v4();
    let parameter_hash =
        collab_bridge::limits::canonical_digest(&json!({"actionKey":definition.action_key,
        "actionVersion":definition.version,"targetId":target,"parameters":parameters}));
    sqlx::query("insert into admission.action_execution
        (id,operation_id,tenant_id,workspace_id,action_key,action_version,initiator_principal_id,actor_principal_id,
         target_id,parameter_hash,parameters,idempotency_key,gate_state,dispatch_state,correlation_id,parent_action_execution_id,
         action_definition_id,component_binding_kind,component_binding_id,component_release_id,component_projection_generation)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'EVALUATING','NOT_DISPATCHED',$13,$14,$15,'APPLICATION',$16,$17,$18)")
        .bind(child).bind(parent.operation_id).bind(context.tenant_id).bind(context.workspace_id).bind(&definition.action_key)
        .bind(definition.version).bind(parent.initiator_principal_id).bind(context.agent_principal_id).bind(target)
        .bind(&parameter_hash).bind(&parameters).bind(idempotency).bind(parent.correlation_id).bind(parent.id)
        .bind(application.definition_id).bind(binding).bind(application.component_release_id).bind(generation)
        .execute(&mut *tx).await?;
    let ae = crate::governance::lock_execution(&mut tx, child).await?;
    crate::governance::audit(
        &mut tx,
        &ae,
        definition,
        "intent",
        "INTENT",
        "NONE",
        "EVALUATING",
        None,
        Vec::new(),
    )
    .await?;
    let mut evaluation = crate::governance::Evaluation {
        allowed: true,
        scope: "ALLOW",
        authorization: "ALLOW",
        quota: "NOT_APPLICABLE",
        zed_token: Some(proof),
        reason: None,
    };
    state
        .governance
        .check_quota(context.tenant_id, definition, &mut evaluation)
        .await?;
    crate::governance::record_decision(
        &mut tx,
        &crate::governance::DecisionSubject {
            action_execution_id: ae.id,
            operation_id: ae.operation_id,
            tenant_id: ae.tenant_id,
            workspace_id: ae.workspace_id,
            principal_id: ae.initiator_principal_id,
            action_key: &ae.action_key,
            action_version: ae.action_version,
            target_id: ae.target_id,
            parameter_hash: &ae.parameter_hash,
        },
        "ADMISSION",
        evaluation.scope,
        evaluation.authorization,
        "NOT_APPLICABLE",
        evaluation.quota,
        evaluation.zed_token.as_deref(),
        evaluation.reason.as_ref(),
    )
    .await?;
    sqlx::query("update admission.action_execution set gate_state=$2,reason_code=$3,updated_at=now() where id=$1")
        .bind(child).bind(if !evaluation.allowed {"DENIED"}else if definition.confirmation_mode=="APPROVAL" {"EVALUATING"}else{"ALLOWED"})
        .bind(evaluation.reason.as_ref().map(crate::governance::wire))
        .execute(&mut *tx).await?;
    let ae = crate::governance::lock_execution(&mut tx, child).await?;
    tx.commit().await?;
    if !evaluation.allowed {
        return Err(Refusal::Denied(
            evaluation.reason.unwrap_or(ReasonCode::QuotaExhausted),
        ));
    }
    if definition.confirmation_mode == "APPROVAL" {
        state
            .governance
            .request_approval(
                crate::governance::Actor {
                    tenant_id: ae.tenant_id,
                    principal_id: ae.actor_principal_id,
                    human_identity_id: None,
                },
                &ae,
                definition,
                &evaluation,
            )
            .await
            .map_err(|(error, _)| error)?;
        return Err(Refusal::Precondition(ReasonCode::TargetStateConflict));
    }
    Ok(ae)
}

fn denied() -> Refusal {
    Refusal::Denied(ReasonCode::ScopeGuardFailed)
}
fn unavailable() -> Refusal {
    Refusal::Unavailable("application Tool projection unavailable".into())
}

pub(crate) async fn request_tools(
    state: &ServiceState,
    invocation: Uuid,
) -> Result<Vec<Tool>, Refusal> {
    let mut tx = state.pool.begin().await?;
    let (context, parent) =
        crate::agent_tool::invocation_context(state, &mut tx, invocation, false).await?;
    let mut allowed = Vec::new();
    for tool in tools(&mut tx, &context).await? {
        if !scopes(&state.governance, &mut tx, &context, &parent, &tool)
            .await?
            .is_empty()
        {
            allowed.push(tool);
        }
    }
    tx.commit().await?;
    Ok(allowed)
}

pub(crate) enum Dispatch {
    Adapter {
        external: Uuid,
        key: Uuid,
        token: String,
    },
    Peer,
}

async fn connector(pool: &sqlx::PgPool, child: Uuid) -> Result<Connector, Refusal> {
    let manifest: Value = sqlx::query_scalar(
        "select r.manifest from admission.action_execution a
         join catalog.action_definition d on d.id=a.action_definition_id
           and d.component_release_id=a.component_release_id and d.action_key=a.action_key and d.version=a.action_version
         join catalog.component_release r on r.id=a.component_release_id
         where a.id=$1 and a.component_binding_kind='APPLICATION'")
        .bind(child).fetch_optional(pool).await?.ok_or_else(denied)?;
    Connector::from_manifest(&manifest)
}

pub(crate) async fn dispatch(
    state: &ServiceState,
    invocation: Uuid,
    child: &Execution,
    arguments: &Value,
) -> Result<Dispatch, Refusal> {
    // Sign only in memory, before taking the parent lock used by fresh_execution.
    // The token is not returned until all preflight work and the dispatch fence
    // commit together. Adapter PEP still rejects a NOT_DISPATCHED child.
    let connector = connector(&state.pool, child.id).await?;
    let signed = match connector {
        Connector::RemoteAdapter => {
            Some(crate::action_token::issue_application(state, child, arguments).await?)
        }
        Connector::ProtocolPeer => None,
    };
    let mut tx = state.pool.begin().await?;
    let (context, parent) =
        crate::agent_tool::invocation_context(state, &mut tx, invocation, true).await?;
    let ae = crate::governance::lock_execution(&mut tx, child.id).await?;
    let parameters = ae.parameters.as_ref().ok_or_else(denied)?;
    let parent_matches: bool = sqlx::query_scalar(
        "select parent_action_execution_id=$2 from admission.action_execution where id=$1",
    )
    .bind(ae.id)
    .bind(parent.id)
    .fetch_one(&mut *tx)
    .await?;
    if !parent_matches
        || ae.gate_state != "ALLOWED"
        || ae.dispatch_state != "NOT_DISPATCHED"
        || parameters["toolParameterHash"] != collab_bridge::limits::canonical_digest(arguments)
    {
        return Err(denied());
    }
    let tool = tools(&mut tx, &context)
        .await?
        .into_iter()
        .find(|tool| parameters["toolResourceId"] == json!(tool.resource_id))
        .ok_or_else(denied)?;
    let (kind, target) = target(arguments)?;
    let (application, version, _) = target_facts(
        &state.governance,
        &mut tx,
        &context,
        &parent,
        &tool,
        kind,
        target,
    )
    .await?;
    if target != ae.target_id || parameters["targetVersion"] != version {
        return Err(denied());
    }
    crate::application_catalog::approval::require_consumable(
        &state.governance,
        &mut tx,
        &ae,
        &application.definition,
    )
    .await?;
    let mut evaluation = crate::governance::Evaluation {
        allowed: true,
        scope: "ALLOW",
        authorization: "ALLOW",
        quota: "NOT_APPLICABLE",
        zed_token: None,
        reason: None,
    };
    state
        .governance
        .check_quota(ae.tenant_id, &application.definition, &mut evaluation)
        .await?;
    if !evaluation.allowed {
        return Err(Refusal::Denied(
            evaluation.reason.unwrap_or(ReasonCode::QuotaExhausted),
        ));
    }
    connector.validate_action(&application.declaration)?;
    if connector == Connector::ProtocolPeer {
        // No native job exists for this connector. Persist the original child
        // dispatch before Gateway Pass; a missing callback remains UNKNOWN.
        // The admission lookup never dispatches a DISPATCHED child again.
        sqlx::query(
            "update admission.action_execution set dispatch_state='DISPATCHED',updated_at=now()
            where id=$1 and gate_state='ALLOWED' and dispatch_state='NOT_DISPATCHED'",
        )
        .bind(ae.id)
        .execute(&mut *tx)
        .await?;
        crate::governance::audit(
            &mut tx,
            &ae,
            &application.definition,
            "dispatch",
            "DISPATCH",
            "ALLOW",
            "DISPATCH_RESULT_UNKNOWN",
            None,
            Vec::new(),
        )
        .await?;
        tx.commit().await?;
        return Ok(Dispatch::Peer);
    }
    let (token, audience) = signed.ok_or_else(unavailable)?;
    let (binding_version,mappings):(i32,Value)=sqlx::query_as("select b.version,p.observation->'executionMappings'
        from catalog.application_binding b join projection.application_runtime p on p.binding_id=b.id
          and p.generation=b.active_projection_generation and p.component_release_id=b.component_release_id and p.state='ACTIVE'
        where b.id=$1 and b.state='ACTIVE' and p.generation=$2 for share of b,p")
        .bind(tool.binding_id).bind(tool.generation).fetch_optional(&mut *tx).await?.ok_or_else(denied)?;
    let mapping = mappings
        .as_array()
        .ok_or_else(unavailable)?
        .iter()
        .filter(|v| v["actionKey"] == ae.action_key && v["actionVersion"] == ae.action_version)
        .collect::<Vec<_>>();
    if mapping.len() != 1 {
        return Err(unavailable());
    }
    let native = mapping[0]["nativeType"]
        .as_str()
        .filter(|v| !v.is_empty())
        .ok_or_else(unavailable)?;
    let cancel = mapping[0]["cancelCapability"]
        .as_str()
        .filter(|v| matches!(*v, "SUPPORTED" | "UNSUPPORTED"))
        .ok_or_else(unavailable)?;
    let workflow:String=sqlx::query_scalar("select workflow_id from projection.workflow_ref
        where action_execution_id=$1 and operation_id=$2 and tenant_id=$3 and workflow_type='AgentTaskWorkflow'")
        .bind(parent.id).bind(parent.operation_id).bind(ae.tenant_id).fetch_optional(&mut *tx).await?.ok_or_else(unavailable)?;
    sqlx::query(
        "update admission.action_execution set dispatch_state='DISPATCHED',updated_at=now()
        where id=$1 and gate_state='ALLOWED' and dispatch_state='NOT_DISPATCHED'",
    )
    .bind(ae.id)
    .execute(&mut *tx)
    .await?;
    let external = Uuid::new_v4();
    let key = Uuid::new_v4();
    sqlx::query("insert into admission.external_execution(id,operation_id,workflow_id,action_execution_id,
        tenant_id,workspace_id,component_binding_id,component_binding_version,component_release_id,
        component_projection_generation,protocol_operation,native_type,idempotency_key,request_digest,platform_status,cancel_capability)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'execute',$11,$12,$13,'PENDING_DISPATCH',$14)")
        .bind(external).bind(ae.operation_id).bind(workflow).bind(ae.id).bind(ae.tenant_id).bind(ae.workspace_id)
        .bind(tool.binding_id).bind(binding_version).bind(application.component_release_id).bind(tool.generation)
        .bind(native).bind(key).bind(collab_bridge::limits::canonical_digest(arguments)).bind(cancel).execute(&mut *tx).await?;
    crate::governance::audit(
        &mut tx,
        &ae,
        &application.definition,
        "dispatch",
        "DISPATCH",
        "ALLOW",
        "DISPATCH_RESULT_UNKNOWN",
        None,
        Vec::new(),
    )
    .await?;
    let ae = crate::governance::lock_execution(&mut tx, ae.id).await?;
    crate::application_execution::prepare_in_transaction(&state.openmeter, &mut tx, &ae, external)
        .await?;
    // Native meter reads can consume the token lifetime. Failure here rolls
    // back the unsent child/EE rather than committing an unreconcilable intent.
    crate::action_token::verify(&token, &audience)?;
    // Persist before Gateway gets Pass. A transport loss or missing callback
    // can only observe this native key; it can never re-execute this intent.
    let updated = sqlx::query(
        "update admission.external_execution set platform_status='UNKNOWN'
        where id=$1 and platform_status='PENDING_DISPATCH' and usage_projection is not null",
    )
    .bind(external)
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() != 1 {
        return Err(unavailable());
    }
    tx.commit().await?;
    Ok(Dispatch::Adapter {
        external,
        key,
        token,
    })
}

/// Native discovery is checked against the approved capability schema before
/// exposing the one target envelope the pinned Codex actually sends.
pub(crate) async fn list(
    state: &ServiceState,
    invocation: Uuid,
    binding: Uuid,
    generation: i64,
    raw: &Value,
) -> Result<Value, Refusal> {
    let parsed: rmcp::model::ListToolsResult =
        serde_json::from_value(raw.clone()).map_err(|_| invalid())?;
    if parsed.next_cursor.is_some() {
        return Err(invalid());
    }
    let allowed = request_tools(state, invocation).await?;
    let mut seen = BTreeSet::new();
    let mut output = Vec::new();
    let mut conn = state.pool.acquire().await?;
    for native in parsed.tools {
        if !seen.insert(native.name.to_string()) {
            return Err(invalid());
        }
        let Some(tool) = allowed.iter().find(|tool| {
            tool.binding_id == binding && tool.generation == generation && tool.name == native.name
        }) else {
            continue;
        };
        let documents = schemas(&mut conn, tool.binding_id, &tool.action_key).await?;
        let input = documents
            .get(
                tool.declaration["inputSchemaDigest"]
                    .as_str()
                    .ok_or_else(unavailable)?,
            )
            .ok_or_else(unavailable)?;
        if serde_json::to_value(&native.input_schema).map_err(|_| invalid())? != *input {
            return Err(invalid());
        }
        let field = match tool.declaration["targetType"].as_str() {
            Some("RESOURCE") => "resourceId",
            Some("ASSET") => "assetId",
            _ => return Err(invalid()),
        };
        let schema = json!({"type":"object","additionalProperties":false,"required":["target","input"],
            "properties":{"target":{"type":"object","additionalProperties":false,"required":[field],
                "properties":{field:{"type":"string","format":"uuid"}}},"input":input}});
        // Names and schema are governed. Native hints cannot turn a write into
        // a read or suppress confirmation; do not forward those annotations.
        output
            .push(json!({"name":tool.name,"description":native.description,"inputSchema":schema}));
    }
    Ok(json!({"tools":output}))
}

pub(crate) async fn disclose(
    state: &ServiceState,
    invocation: Uuid,
    child: Uuid,
    external: Option<Uuid>,
    operation: Uuid,
    name: &str,
    result: &rmcp::model::CallToolResult,
) -> Result<Value, Refusal> {
    let connector = connector(&state.pool, child).await?;
    let ae = crate::governance::load_execution(&state.pool, child)
        .await?
        .ok_or_else(denied)?;
    let parameters = ae.parameters.as_ref().ok_or_else(denied)?;
    if ae.operation_id != operation
        || parameters["invocationId"] != json!(invocation)
        || ae.gate_state != "ALLOWED"
        || ae.dispatch_state != "DISPATCHED"
    {
        return Err(denied());
    }
    let raw = result.structured_content.as_ref();
    if connector == Connector::RemoteAdapter {
        if result.is_error == Some(true) {
            return Err(invalid());
        }
        let raw = raw.ok_or_else(invalid)?;
        let parsed: contracts::AdapterExecutionResponse =
            serde_json::from_value(raw.clone()).map_err(|_| invalid())?;
        if serde_json::to_value(parsed).map_err(|_| invalid())? != *raw {
            return Err(invalid());
        }
        let external = external.ok_or_else(invalid)?;
        let exact: bool = sqlx::query_scalar(
            "select exists(select 1 from admission.external_execution e
        join admission.action_execution a on a.id=e.action_execution_id
        where e.id=$1 and a.id=$2 and a.operation_id=$3 and a.parameters->>'invocationId'=$4)",
        )
        .bind(external)
        .bind(child)
        .bind(operation)
        .bind(invocation.to_string())
        .fetch_one(&state.pool)
        .await?;
        if !exact {
            return Err(denied());
        }
        // Native evidence is reconciled even if disclosure permissions were revoked
        // while the call ran. Neither these observations nor usage contain its body.
        let status =
            crate::application_execution::record_observation(state, external, &raw["execution"])
                .await?;
        if !matches!(status.as_str(), "SUCCEEDED" | "FAILED" | "CANCELLED") {
            return Err(Refusal::Unavailable("UNKNOWN_EXTERNAL_RESULT".into()));
        }
        let _committed = crate::application_execution::observe(state, &ae, external).await?;
        if status != "SUCCEEDED" {
            return Err(Refusal::Precondition(ReasonCode::TargetStateConflict));
        }
    } else {
        if external.is_some() {
            return Err(invalid());
        }
        if result.is_error == Some(true) {
            return Err(Refusal::Precondition(ReasonCode::TargetStateConflict));
        }
    }
    let decision = fresh_execution(&state.governance, &ae).await?;
    if !decision.allowed {
        return Err(denied());
    }
    let mut tx = state.pool.begin().await?;
    let (context, parent) =
        crate::agent_tool::invocation_context(state, &mut tx, invocation, true).await?;
    let parameters = ae.parameters.as_ref().ok_or_else(denied)?;
    let tool = tools(&mut tx, &context)
        .await?
        .into_iter()
        .find(|tool| tool.name == name && parameters["toolResourceId"] == json!(tool.resource_id))
        .ok_or_else(denied)?;
    target_facts(
        &state.governance,
        &mut tx,
        &context,
        &parent,
        &tool,
        parameters["targetType"].as_str().ok_or_else(denied)?,
        ae.target_id,
    )
    .await?;
    let policy:Option<(String,String,String)>=sqlx::query_as("select mode,output_schema_hash,redaction_policy
        from catalog.result_exposure_policy where id=$1 and version=$2 and tenant_id=$3 and status='ACTIVE'")
        .bind(Uuid::parse_str(parameters["resultExposurePolicyId"].as_str().ok_or_else(denied)?).map_err(|_|denied())?)
        .bind(parameters["resultExposurePolicyVersion"].as_i64().ok_or_else(denied)? as i32)
        .bind(ae.tenant_id).fetch_optional(&mut *tx).await?;
    let (mode, digest, redaction) = policy.ok_or_else(denied)?;
    if !matches!(mode.as_str(), "CONSUME_ONLY" | "READ" | "EXPORT")
        || redaction != "PLATFORM_METADATA_ONLY"
        || digest
            != tool.declaration["outputSchemaDigest"]
                .as_str()
                .ok_or_else(unavailable)?
    {
        return Err(denied());
    }
    let documents = schemas(&mut tx, tool.binding_id, &tool.action_key).await?;
    let output = documents.get(&digest).ok_or_else(unavailable)?;
    // Typed transport and matching platform IDs do not prove native ownership
    // or the referenced revision. Until the original Adapter resolution path
    // verifies those facts, retain execution/usage evidence but disclose none.
    let value = match connector {
        Connector::RemoteAdapter => output_value(raw.ok_or_else(invalid)?, output, &documents)?,
        Connector::ProtocolPeer => {
            let value = crate::application_binding::peer::result_value(result)?;
            if !crate::capability_contract::schema_validator(output, &documents)?.is_valid(&value) {
                return Err(invalid());
            }
            value
        }
    };
    let definition = crate::governance::exact_definition_for_execution(&state.pool, &ae).await?;
    crate::governance::audit(
        &mut tx,
        &ae,
        &definition,
        "result",
        "RESULT",
        "ALLOW",
        "SUCCEEDED",
        None,
        Vec::new(),
    )
    .await?;
    tx.commit().await?;
    // The transport envelope is not the declared capability result. Only the
    // business value checked against the frozen output schema may be exposed.
    Ok(value)
}

/// Called only after authenticating the original AgentGateway CheckResponse.
/// Native completion is recorded before fresh user disclosure: revoked access
/// must suppress content, not erase an already dispatched operation's outcome.
/// The route, original child/parent/turn and frozen declaration are all exact;
/// no callback field supplies scope and no native task is manufactured.
pub(crate) async fn record_peer_result(
    state: &ServiceState,
    invocation: Uuid,
    child: Uuid,
    operation: Uuid,
    name: &str,
    services: &[String],
    result: &rmcp::model::CallToolResult,
) -> Result<(), Refusal> {
    if connector(&state.pool, child).await? != Connector::ProtocolPeer {
        return Ok(());
    }
    let mut tx = state.pool.begin().await?;
    let ae = crate::governance::lock_execution(&mut tx, child).await?;
    let source: Option<(Uuid, i64, Value)> = sqlx::query_as(
        "select a.component_binding_id,a.component_projection_generation,d.implementation_declaration
         from admission.action_execution a join admission.action_execution parent on parent.id=a.parent_action_execution_id
         join catalog.agent_invocation i on i.action_execution_id=parent.id
         join catalog.action_definition d on d.id=a.action_definition_id and d.component_release_id=a.component_release_id
         join catalog.tool_definition t on t.resource_id=(a.parameters->>'toolResourceId')::uuid
           and t.application_projection_generation=a.component_projection_generation and t.name=$4
         join catalog.resource tool_resource on tool_resource.id=t.resource_id
           and tool_resource.application_binding_id=a.component_binding_id and tool_resource.tenant_id=a.tenant_id
         where a.id=$1 and i.id=$2 and a.operation_id=$3 and parent.operation_id=$3
           and a.tenant_id=parent.tenant_id and a.workspace_id is not distinct from parent.workspace_id
           and a.initiator_principal_id=parent.initiator_principal_id and a.actor_principal_id=parent.actor_principal_id
           and a.parameters->>'invocationId'=i.id::text and a.parameters->>'runtimeTurnId'=i.runtime_turn_id
           and a.gate_state='ALLOWED' and a.dispatch_state='DISPATCHED'
           and not exists(select 1 from admission.external_execution e where e.action_execution_id=a.id)")
        .bind(child).bind(invocation).bind(operation).bind(name).fetch_optional(&mut *tx).await?;
    let (binding, generation, declaration) = source.ok_or_else(denied)?;
    if services
        != [crate::application_binding::gateway::target(
            binding, generation,
        )]
    {
        return Err(denied());
    }
    Connector::ProtocolPeer.validate_action(&declaration)?;
    let definition = crate::governance::exact_definition_for_execution(&state.pool, &ae).await?;
    // A native protocol response proves the synchronous attempt ended, not
    // that its declared business result succeeded. Validate using the frozen
    // contract even when the caller's disclosure permission has been revoked.
    let documents = schemas(&mut tx, binding, &ae.action_key).await?;
    let digest = declaration["outputSchemaDigest"]
        .as_str()
        .ok_or_else(unavailable)?;
    let output = documents.get(digest).ok_or_else(unavailable)?;
    let status = peer_terminal_result(result, output, &documents)?;
    let key = format!("{}:child:{}:protocol-result", ae.operation_id, ae.id);
    let previous: Option<String> =
        sqlx::query_scalar("select result_code from audit.audit_event where event_key=$1")
            .bind(&key)
            .fetch_optional(&mut *tx)
            .await?;
    if previous
        .as_deref()
        .is_some_and(|previous| previous != status)
    {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    crate::governance::audit(
        &mut tx,
        &ae,
        &definition,
        "protocol-result",
        "RESULT",
        "ALLOW",
        status,
        None,
        Vec::new(),
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

fn peer_terminal_result(
    result: &rmcp::model::CallToolResult,
    output: &Value,
    documents: &BTreeMap<String, Value>,
) -> Result<&'static str, Refusal> {
    let validator = crate::capability_contract::schema_validator(output, documents)?;
    if result.is_error == Some(true) {
        return Ok("FAILED");
    }
    let value = crate::application_binding::peer::result_value(result)?;
    if !validator.is_valid(&value) {
        // Invalid output is not evidence that the remote effect failed.
        // No terminal audit is written; the original dispatched child stays
        // uncertain and cannot be replayed or omitted from the drain set.
        return Err(invalid());
    }
    Ok("SUCCEEDED")
}

#[derive(sqlx::FromRow)]
pub(crate) struct Tool {
    pub(crate) resource_id: Uuid,
    pub(crate) binding_id: Uuid,
    pub(crate) generation: i64,
    pub(crate) name: String,
    pub(crate) action_key: String,
    pub(crate) action_version: i32,
    pub(crate) definition_id: Uuid,
    pub(crate) declaration: Value,
    pub(crate) route_id: String,
    pub(crate) route_hash: String,
}

/// Original Installation projection resolves Workspace first, then Tenant.
/// No permission is written here and no provider is represented by a fake row.
pub(crate) async fn resolve_installation(
    conn: &mut PgConnection,
    tenant: Uuid,
    installation: Uuid,
    generation: i64,
) -> Result<(), Refusal> {
    sqlx::query("with selected as (
        select distinct on (c.category_key) c.*
        from catalog.agent_installation i join catalog.resource ir on ir.id=i.resource_id and ir.tenant_id=$1
        join projection.application_category c on c.tenant_id=ir.tenant_id
          and (c.workspace_id is null or c.workspace_id=i.workspace_id)
        where i.resource_id=$2 order by c.category_key,c.workspace_id nulls last
      ) insert into catalog.tool_binding(installation_resource_id,projection_generation,workspace_id,
          agent_version_asset_id,tool_resource_id,action_execution_id,status)
        select i.resource_id,p.generation,i.workspace_id,p.agent_version_asset_id,t.resource_id,runtime.action_execution_id,'NO_PERMISSION'
        from catalog.agent_installation i join catalog.resource ir on ir.id=i.resource_id and ir.tenant_id=$1
        join catalog.agent_runtime_projection p on p.installation_resource_id=i.resource_id and p.generation=$3
        join catalog.agent_version v on v.asset_id=p.agent_version_asset_id
        join selected c on true
        join catalog.application_binding b on b.id=c.binding_id and b.tenant_id=$1 and b.state='ACTIVE'
          and b.active_projection_generation=c.generation
        join projection.application_runtime runtime on runtime.binding_id=b.id and runtime.generation=c.generation
          and runtime.state='ACTIVE' and runtime.gateway_state='ACTIVE'
        join catalog.resource r on r.application_binding_id=b.id and r.tenant_id=$1 and r.state='ACTIVE'
          and r.type_key='tool.definition' and r.projection_action_execution_id is null
        join catalog.tool_definition t on t.resource_id=r.id and t.source='APPLICATION' and t.status='ACTIVE'
          and t.application_projection_generation=c.generation
        join catalog.capability_contract contract on contract.category_key=c.category_key and contract.contract_version=c.contract_version
        where i.resource_id=$2 and p.state in ('PENDING','ACTIVE')
          and v.content->'capabilityRequirements' @> jsonb_build_array(t.capability_contract_key)
          and exists(select 1 from jsonb_array_elements(contract.content->'operationContracts') op
            where op->>'contractKey'=t.capability_contract_key and op->>'surface'='TOOL')
        on conflict(installation_resource_id,projection_generation,tool_resource_id) do nothing")
        .bind(tenant).bind(installation).bind(generation).execute(conn).await?;
    Ok(())
}

pub(crate) async fn tools(
    conn: &mut PgConnection,
    context: &InvocationContext,
) -> Result<Vec<Tool>, Refusal> {
    let rows=sqlx::query_as("with selected as (
        select distinct on (c.category_key) c.* from projection.application_category c
        where c.tenant_id=$1 and (c.workspace_id is null or c.workspace_id=$2)
        order by c.category_key,c.workspace_id nulls last
      ) select distinct t.resource_id,b.id binding_id,p.generation,t.name,t.action_key,d.version action_version,
          d.id definition_id,d.implementation_declaration declaration,
          p.native_gateway_route_id route_id,p.gateway_config_hash route_hash
        from selected c join catalog.application_binding b on b.id=c.binding_id and b.tenant_id=$1 and b.state='ACTIVE'
          and b.active_projection_generation=c.generation
        join projection.application_runtime p on p.binding_id=b.id and p.generation=c.generation
          and p.state='ACTIVE' and p.gateway_state='ACTIVE' and p.component_release_id=b.component_release_id
        join catalog.component_release release on release.id=p.component_release_id and release.status='APPROVED'
        join catalog.resource r on r.application_binding_id=b.id and r.tenant_id=$1 and r.state='ACTIVE'
          and r.type_key='tool.definition' and r.projection_action_execution_id is null
        join catalog.tool_definition t on t.resource_id=r.id and t.source='APPLICATION' and t.status='ACTIVE'
          and t.application_projection_generation=p.generation
        join catalog.tool_binding tb on tb.tool_resource_id=t.resource_id and tb.installation_resource_id=$3
          and tb.workspace_id=$2 and tb.projection_generation=$4 and tb.status in ('NO_PERMISSION','ACTIVE')
        join catalog.agent_runtime_projection agent on agent.installation_resource_id=$3 and agent.generation=$4
          and agent.state='ACTIVE' and agent.agent_version_asset_id=tb.agent_version_asset_id
        join catalog.agent_version v on v.asset_id=agent.agent_version_asset_id
        join catalog.action_definition d on d.component_release_id=p.component_release_id
          and d.action_key=t.action_key and d.status='ACTIVE'
        join lateral jsonb_array_elements(release.manifest->'toolDefinitions') declaration on declaration->>'name'=t.name
        join catalog.capability_contract contract on contract.category_key=c.category_key and contract.contract_version=c.contract_version
        where v.content->'capabilityRequirements' @> jsonb_build_array(t.capability_contract_key)
          and exists(select 1 from jsonb_array_elements(contract.content->'operationContracts') op
            where op->>'contractKey'=t.capability_contract_key and op->>'surface'='TOOL')
        order by t.resource_id")
        .bind(context.tenant_id).bind(context.workspace_id).bind(context.installation_resource_id)
        .bind(context.projection_generation).fetch_all(conn).await?;
    Ok(rows)
}

/// Discover only if at least one of the existing exact target Scopes remains
/// valid for BOTH grantor and Agent. Target is never inferred for tools/call.
pub(crate) async fn scopes(
    gov: &crate::governance::Governance,
    conn: &mut PgConnection,
    context: &InvocationContext,
    parent: &Execution,
    tool: &Tool,
) -> Result<Vec<contracts::ScopeElement>, Refusal> {
    let rows:Vec<Value>=sqlx::query_scalar("select jsonb_strip_nulls(jsonb_build_object(
        'actionKey',s.action_key,'actionVersion',s.action_version,'targetType',s.target_type,'targetId',s.target_id,
        'toolResourceId',s.tool_resource_id,'resultExposureMode',p.mode,'outputSchemaHash',p.output_schema_hash,
        'redactionPolicy',p.redaction_policy))
        from admission.delegation_grant g join admission.delegation_scope s on s.delegation_id=g.id
        join catalog.result_exposure_policy p on p.id=s.result_exposure_policy_id
          and p.version=s.result_exposure_policy_version and p.tenant_id=g.tenant_id and p.status='ACTIVE'
        join admission.delegation_use u on u.delegation_id=g.id and u.operation_id=$7
        where g.id=$1 and g.tenant_id=$2 and g.workspace_id=$3 and g.installation_resource_id=$4
          and g.agent_principal_id=$5 and g.grantor_principal_id=$6 and g.state='ACTIVE'
          and g.valid_from<=clock_timestamp() and g.expires_at>clock_timestamp()
          and s.tool_resource_id=$8 and s.action_definition_id=$9 and s.action_key=$10 and s.action_version=$11
          and s.target_id is not null and s.create_workspace_id is null")
        .bind(context.delegation_id).bind(context.tenant_id).bind(context.workspace_id)
        .bind(context.installation_resource_id).bind(context.agent_principal_id).bind(parent.initiator_principal_id)
        .bind(parent.operation_id).bind(tool.resource_id).bind(tool.definition_id).bind(&tool.action_key)
        .bind(tool.action_version).fetch_all(&mut *conn).await?;
    if parent.id != context.parent_action_execution_id
        || parent.actor_principal_id != context.agent_principal_id
        || parent.tenant_id != context.tenant_id
        || parent.workspace_id != Some(context.workspace_id)
    {
        return Err(denied());
    }
    let installation = crate::governance::delegation::installation(
        conn,
        context.tenant_id,
        context.installation_resource_id,
        false,
    )
    .await?
    .ok_or_else(denied)?;
    let mut allowed = Vec::new();
    for raw in rows {
        let scope: contracts::ScopeElement =
            serde_json::from_value(raw).map_err(|_| unavailable())?;
        match crate::governance::delegation::validate_scope(
            gov,
            conn,
            context.tenant_id,
            parent.initiator_principal_id,
            &installation,
            &scope,
        )
        .await
        {
            Ok(()) => allowed.push(scope),
            Err(
                Refusal::Denied(_)
                | Refusal::Blocked(_)
                | Refusal::Conflict(_)
                | Refusal::Precondition(_),
            ) => {}
            Err(error) => return Err(error),
        }
    }
    Ok(allowed)
}

pub(crate) async fn configuration(
    state: &ServiceState,
    tx: &mut Transaction<'_, Postgres>,
    context: &InvocationContext,
    parent: &Execution,
    scope: &SessionScope,
) -> Result<serde_json::Map<String, Value>, Refusal> {
    crate::application_binding::gateway::refresh_installation(
        state,
        context.installation_resource_id,
        context.projection_generation,
    )
    .await?;
    resolve_installation(
        tx,
        context.tenant_id,
        context.installation_resource_id,
        context.projection_generation,
    )
    .await?;
    let mut groups: BTreeMap<(Uuid, i64, String, String), BTreeSet<String>> = BTreeMap::new();
    for tool in tools(tx, context).await? {
        if scopes(&state.governance, tx, context, parent, &tool)
            .await?
            .is_empty()
        {
            continue;
        }
        for subject in [parent.initiator_principal_id, context.agent_principal_id] {
            permission(&state.governance, tool.resource_id, subject, "discover").await?;
            permission(&state.governance, tool.resource_id, subject, "consume").await?;
        }
        let key = (
            tool.binding_id,
            tool.generation,
            tool.route_id,
            tool.route_hash,
        );
        if !groups.entry(key).or_default().insert(tool.name) {
            return Err(unavailable());
        }
    }
    let mut servers = serde_json::Map::new();
    if groups.is_empty() {
        return Ok(servers);
    }
    let signer = state.agent_tool_sessions.as_ref().ok_or_else(unavailable)?;
    let gateway = crate::model_route::Gateway::from_env()?;
    let stored = gateway.resources("traffic.route").await?;
    for ((binding, generation, id, digest), names) in groups {
        if id != crate::application_binding::gateway::target(binding, generation) {
            return Err(unavailable());
        }
        let exact: Vec<_> = stored
            .iter()
            .filter(|row| row["id"].as_str() == Some(&id))
            .collect();
        if exact.len() != 1 {
            return Err(unavailable());
        }
        let route = &exact[0]["value"];
        if collab_bridge::limits::canonical_digest(route) != digest
            || route["policies"]["mcpAuthentication"]["jwks"]
                != serde_json::to_string(signer.public_jwks()).map_err(|_| unavailable())?
        {
            return Err(unavailable());
        }
        crate::agent_tool_runtime::require_route(&gateway, &id, Some(route)).await?;
        let token = signer.issue(scope).map_err(|_| unavailable())?;
        let url = crate::application_binding::gateway::route_url(signer, binding, generation)?;
        servers.insert(id,json!({"url":url.as_str(),"http_headers":{"Authorization":format!("Bearer {token}")},
            "enabled":true,"required":true,"supports_parallel_tool_calls":false,"enabled_tools":names,
            "default_tools_approval_mode":"approve","startup_timeout_sec":state.agent_memory.tool_timeout().as_secs_f64(),
            "tool_timeout_sec":state.agent_memory.tool_timeout().as_secs_f64()}));
    }
    Ok(servers)
}
