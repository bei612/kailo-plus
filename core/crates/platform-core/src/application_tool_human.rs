//! DD-134(6)：HUMAN 测试调用 `PROTOCOL_PEER` 工具——Core 作为 MCP client 经该执行专属的临时 Gateway route 调用。
//!
//! 测试调用提交的是该工具在 release 中登记的 ActionDefinition（既有 componentAction
//! 语义命令的字段），以当前 HUMAN 为发起人与执行者，只对 SYNC、无审批、契约
//! permission 为 `discover`、`consume` 或 `read` 的工具开放。准入沿既有要素：Tenant
//! 锁与幂等键、目标 Resource 与 binding/generation/release 冻结、契约输入 schema 与
//! 有效 ResultExposurePolicy、active HUMAN、对目标 fresh SpiceDB Check、Quota、
//! INTENT 与 DECISION 审计。
//!
//! 工具参数只在本请求内存中，ActionExecution 只冻结其 canonical 摘要；派发前先落
//! DISPATCH 审计作为单次派发栅栏，随后发布执行专属 route（Core 专用受众的 bearer，Gateway 校验后移除，DD-137；
//! `mcpAuthorization` 只放行该工具名的 `tools/call`），ExtMcp 再按该执行冻结的工具名
//! 与参数摘要放行，并在响应相位按输出 schema 与冻结 exposure 重建结果。结果只在本次
//! 回应中返回给发起人，Core 不保存；结果不明保持 `UNKNOWN`，不重放。

use axum::{
    extract::{rejection::JsonRejection, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use contracts::ReasonCode;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    bff::{resolve_execution_context, BffState, ExecutionContext},
    gateway_admin::probe,
    governance::{Evaluation, Execution, Refusal},
    service_api::ServiceState,
    spicedb::Consistency,
};

/// 执行专属 route 上请求携带的 ActionExecution ID；ExtMcp 据此只走测试调用分支。
pub(crate) const HEADER: &str = "x-platform-tool-test";
/// ActionExecution 参数中的种类标记；不是 COMPONENT_ACTION，Temporal 派发与对账不接管它。
const KIND: &str = "GATEWAY_TOOL_TEST";

fn invalid() -> Refusal {
    Refusal::Precondition(ReasonCode::InvalidParameters)
}
fn denied() -> Refusal {
    Refusal::Denied(ReasonCode::PermissionDenied)
}
fn blocked() -> Refusal {
    Refusal::Blocked(ReasonCode::CapabilityBlocked)
}
fn unavailable() -> Refusal {
    Refusal::Unavailable("tool test call result unknown".into())
}

pub(crate) fn target(action: Uuid) -> String {
    format!("tool-test-{action}")
}

fn read_only_permission(permission: &str) -> bool {
    matches!(permission, "discover" | "consume" | "read")
}

fn uuid_text(value: &Value) -> Result<Uuid, Refusal> {
    let text = value.as_str().ok_or_else(invalid)?;
    let id = Uuid::parse_str(text).map_err(|_| invalid())?;
    if id.is_nil() || id.to_string() != text {
        return Err(invalid());
    }
    Ok(id)
}

/// 规范化后的测试调用命令。`input` 只留在内存，不写入 ActionExecution。
struct Command {
    digest: String,
    key: Uuid,
    action_key: String,
    action_version: i32,
    workspace: Option<Uuid>,
    target: Uuid,
    version: i32,
    input: Value,
    policy: Uuid,
    policy_version: i32,
}

fn command(cmd: &contracts::ActionCommand) -> Result<Command, Refusal> {
    let raw = serde_json::to_value(cmd).map_err(|_| invalid())?;
    let fields = raw.as_object().ok_or_else(invalid)?;
    if fields.iter().any(|(key, value)| {
        !value.is_null()
            && !matches!(
                key.as_str(),
                "actionKey"
                    | "idempotencyKey"
                    | "workspaceId"
                    | "resourceId"
                    | "resourceVersion"
                    | "componentAction"
            )
    }) {
        return Err(invalid());
    }
    let action = &raw["componentAction"];
    let typed: contracts::ComponentActionInput =
        serde_json::from_value(action.clone()).map_err(|_| invalid())?;
    if serde_json::to_value(typed).map_err(|_| invalid())? != *action
        || action.get("inputReference").is_some()
    {
        return Err(invalid());
    }
    let encoded = action["inputJson"].as_str().ok_or_else(invalid)?;
    let input: Value = serde_json::from_str(encoded).map_err(|_| invalid())?;
    if !input.is_object() || collab_bridge::limits::canonical_json(&input) != encoded {
        return Err(invalid());
    }
    let positive = |value: &Value| {
        value
            .as_i64()
            .and_then(|v| i32::try_from(v).ok())
            .filter(|v| *v > 0)
            .ok_or_else(invalid)
    };
    let action_key = raw["actionKey"].as_str().ok_or_else(invalid)?.to_owned();
    if action_key.is_empty() {
        return Err(invalid());
    }
    Ok(Command {
        digest: collab_bridge::limits::canonical_digest(&raw),
        key: uuid_text(&raw["idempotencyKey"])?,
        action_key,
        action_version: positive(&action["actionVersion"])?,
        workspace: raw
            .get("workspaceId")
            .filter(|value| !value.is_null())
            .map(uuid_text)
            .transpose()?,
        target: uuid_text(&raw["resourceId"])?,
        version: positive(&raw["resourceVersion"])?,
        input,
        policy: uuid_text(&action["resultExposurePolicyId"])?,
        policy_version: positive(&action["resultExposurePolicyVersion"])?,
    })
}

/// 与 Agent 工具调用相同的 MCP 参数外形；PEP 只把 `input` 转给原生 peer。
fn arguments(target: Uuid, input: &Value) -> Value {
    json!({"target":{"resourceId":target},"input":input})
}

#[derive(sqlx::FromRow)]
struct Binding {
    resource_version: i32,
    home_workspace_id: Option<Uuid>,
    binding_id: Uuid,
    binding_version: i32,
    generation: i64,
    adapter_service_ref: String,
    native_instance_ref: String,
    release_id: Uuid,
    manifest: Value,
    observation: Value,
}

const BINDING: &str = "select r.version as resource_version,r.home_workspace_id,
    b.id as binding_id,b.version as binding_version,b.active_projection_generation as generation,
    b.adapter_service_ref,b.native_instance_ref,rel.id as release_id,rel.manifest,p.observation
    from catalog.resource r
    join catalog.application_binding b on b.id=r.application_binding_id and b.tenant_id=r.tenant_id
      and b.state='ACTIVE'
    join projection.application_runtime p on p.binding_id=b.id and p.generation=b.active_projection_generation
      and p.state='ACTIVE' and p.component_release_id=b.component_release_id
    join catalog.component_release rel on rel.id=b.component_release_id and rel.status='APPROVED'
      and rel.manifest->'executionConnector'->>'mode'='PROTOCOL_PEER'
    where r.id=$1 and r.tenant_id=$2 and r.state='ACTIVE' and r.projection_action_execution_id is null";

pub(crate) async fn submit(
    State(state): State<BffState>,
    headers: HeaderMap,
    body: Result<Json<contracts::ActionCommand>, JsonRejection>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    let Ok(Json(cmd)) = body else {
        return invalid().respond(None);
    };
    match call(&state, &ctx, &cmd).await {
        Ok((status, value)) => (
            status,
            [(axum::http::header::CACHE_CONTROL, "no-store")],
            Json(value),
        )
            .into_response(),
        Err((error, operation)) => error.respond(operation),
    }
}

fn result(
    ae: &Execution,
    value: Option<Value>,
    tool_error: bool,
) -> Result<contracts::GatewayToolTestCallResult, Refusal> {
    let mut body = json!({"submission":ae.submission()});
    if let Some(value) = value {
        body["resultJson"] = json!(collab_bridge::limits::canonical_json(&value));
    }
    if tool_error {
        body["toolError"] = json!(true);
    }
    serde_json::from_value(body).map_err(|_| unavailable())
}

async fn call(
    state: &BffState,
    ctx: &ExecutionContext,
    cmd: &contracts::ActionCommand,
) -> Result<(StatusCode, contracts::GatewayToolTestCallResult), (Refusal, Option<Uuid>)> {
    if ctx.access_mode != contracts::PlatformSessionAccessMode::Full {
        return Err((denied(), None));
    }
    let command = command(cmd).map_err(|error| (error, None))?;
    let admitted = admit(state, ctx, &command).await?;
    let operation = Some(admitted.ae.operation_id);
    if admitted.ae.gate_state != "ALLOWED" {
        let reason = admitted
            .ae
            .reason_code
            .as_deref()
            .and_then(|reason| serde_json::from_value(json!(reason)).ok())
            .unwrap_or(ReasonCode::PermissionDenied);
        return Err((Refusal::Denied(reason), operation));
    }
    let outcome = dispatch(&state.memory_service, &admitted, &command.input).await;
    let current = crate::governance::load_execution(&state.pool, admitted.ae.id)
        .await
        .map_err(|error| (error.into(), operation))?
        .ok_or((unavailable(), operation))?;
    let body = match outcome {
        Ok(Called::Value(value)) => result(&current, Some(value), false),
        Ok(Called::ToolError) => result(&current, None, true),
        Err(_) => result(&current, None, false),
    }
    .map_err(|error| (error, operation))?;
    Ok((StatusCode::OK, body))
}

/// 准入通过后派发所需的冻结事实（不含工具参数）。
struct Admitted {
    ae: Execution,
    definition: crate::governance::Definition,
    tool: String,
    binding: Binding,
}

async fn admit(
    state: &BffState,
    ctx: &ExecutionContext,
    command: &Command,
) -> Result<Admitted, (Refusal, Option<Uuid>)> {
    let existing: Option<Uuid> = sqlx::query_scalar(
        "select id from admission.action_execution
        where tenant_id=$1 and initiator_principal_id=$2 and idempotency_key=$3",
    )
    .bind(ctx.tenant_id)
    .bind(ctx.tenant_principal_id)
    .bind(command.key)
    .fetch_optional(&state.pool)
    .await
    .map_err(|error| (error.into(), None))?;
    if let Some(existing) = existing {
        // 同一幂等键不再调用工具：测试调用结果从不保存，重试只得到确定的冲突。
        let ae = crate::governance::load_execution(&state.pool, existing)
            .await
            .map_err(|error| (error.into(), None))?
            .ok_or((unavailable(), None))?;
        let same = ae.action_key == command.action_key
            && ae.parameters.as_ref().is_some_and(|p| {
                p["componentActionKind"] == KIND && p["commandDigest"] == command.digest
            });
        let reason = if same {
            ReasonCode::TargetStateConflict
        } else {
            ReasonCode::IdempotencyKeyReused
        };
        return Err((Refusal::Conflict(reason), Some(ae.operation_id)));
    }
    let gov = &state.governance;
    let admitted = async {
        let mut tx = state.pool.begin().await?;
        if !crate::roles::lock_tenant(&mut tx, ctx.tenant_id).await? {
            return Err(denied());
        }
        let binding: Binding = sqlx::query_as(&format!("{BINDING} for share of r,b,p,rel"))
            .bind(command.target)
            .bind(ctx.tenant_id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or(Refusal::Precondition(ReasonCode::TargetNotFound))?;
        if binding.resource_version != command.version {
            return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
        }
        if command
            .workspace
            .is_some_and(|workspace| Some(workspace) != binding.home_workspace_id)
        {
            return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
        }
        if let Some(workspace) = binding.home_workspace_id {
            let active: bool = sqlx::query_scalar(
                "select exists(select 1 from identity.workspace
                where id=$1 and tenant_id=$2 and state='ACTIVE')",
            )
            .bind(workspace)
            .bind(ctx.tenant_id)
            .fetch_one(&mut *tx)
            .await?;
            if !active {
                return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
            }
        }
        let application = crate::application_catalog::exact_definition_for_binding(
            &mut tx,
            binding.binding_id,
            binding.generation,
            &command.action_key,
            command.action_version,
        )
        .await?;
        let def = &application.definition;
        if def.target_type != "RESOURCE"
            || def.execution_mode != "SYNC"
            || def.workflow_kind.is_some()
            || def.confirmation_mode != "NONE"
            || def.quota_policy != "NONE"
            || !def.meters.is_empty()
            || !read_only_permission(&def.permission)
        {
            return Err(blocked());
        }
        crate::application_binding::native::Connector::ProtocolPeer
            .validate_action(&application.declaration)?;
        let tools: Vec<String> = sqlx::query_scalar(
            "select t.name from catalog.tool_definition t
            join catalog.resource tr on tr.id=t.resource_id
            where tr.application_binding_id=$1 and tr.tenant_id=$2 and tr.state='ACTIVE'
              and t.status='ACTIVE' and t.source='APPLICATION' and t.action_key=$3
              and t.application_projection_generation=$4",
        )
        .bind(binding.binding_id)
        .bind(ctx.tenant_id)
        .bind(&command.action_key)
        .bind(binding.generation)
        .fetch_all(&mut *tx)
        .await?;
        let [tool] = tools.as_slice() else {
            return Err(blocked());
        };
        let documents =
            crate::application_tool::schemas(&mut tx, binding.binding_id, &command.action_key)
                .await?;
        let input_schema = documents
            .get(
                application.declaration["inputSchemaDigest"]
                    .as_str()
                    .ok_or_else(invalid)?,
            )
            .ok_or_else(invalid)?;
        if !crate::capability_contract::schema_validator(input_schema, &documents)?
            .is_valid(&command.input)
        {
            return Err(invalid());
        }
        let policy: bool = sqlx::query_scalar(
            "select exists(select 1 from catalog.result_exposure_policy
            where id=$1 and version=$2 and tenant_id=$3 and status='ACTIVE' and mode=$4
              and output_schema_hash=$5 and redaction_policy='PLATFORM_METADATA_ONLY')",
        )
        .bind(command.policy)
        .bind(command.policy_version)
        .bind(ctx.tenant_id)
        .bind(&def.result_exposure)
        .bind(
            application.declaration["outputSchemaDigest"]
                .as_str()
                .ok_or_else(invalid)?,
        )
        .fetch_one(&mut *tx)
        .await?;
        if !policy {
            return Err(denied());
        }
        let mut evaluation = if crate::agent_definition::active_owner(
            &mut tx,
            ctx.tenant_id,
            ctx.tenant_principal_id,
        )
        .await?
        {
            fresh(gov, ctx.tenant_principal_id, command.target, &def.permission).await?
        } else {
            Evaluation {
                allowed: false,
                scope: "DENY",
                authorization: "NOT_APPLICABLE",
                quota: "NOT_APPLICABLE",
                zed_token: None,
                reason: Some(ReasonCode::ScopeGuardFailed),
            }
        };
        gov.check_quota(ctx.tenant_id, def, &mut evaluation).await?;
        let arguments = arguments(command.target, &command.input);
        let parameters = json!({"componentActionKind":KIND,"commandDigest":command.digest,
            "toolName":tool,"toolParameterHash":collab_bridge::limits::canonical_digest(&arguments),
            "targetType":"RESOURCE","targetVersion":command.version,"bindingVersion":binding.binding_version,
            "resultExposurePolicyId":command.policy,"resultExposurePolicyVersion":command.policy_version});
        let id = Uuid::new_v4();
        let operation = Uuid::new_v4();
        let hash = collab_bridge::limits::canonical_digest(&json!({"actionKey":def.action_key,
            "actionVersion":def.version,"targetId":command.target,"parameters":parameters}));
        sqlx::query("insert into admission.action_execution
            (id,operation_id,tenant_id,workspace_id,action_key,action_version,initiator_principal_id,actor_principal_id,
             target_id,parameter_hash,parameters,idempotency_key,gate_state,dispatch_state,correlation_id,
             action_definition_id,component_binding_kind,component_binding_id,component_release_id,component_projection_generation)
            values($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,$11,'EVALUATING','NOT_DISPATCHED',$2,$12,'APPLICATION',$13,$14,$15)")
            .bind(id).bind(operation).bind(ctx.tenant_id).bind(binding.home_workspace_id).bind(&def.action_key)
            .bind(def.version).bind(ctx.tenant_principal_id).bind(command.target).bind(&hash).bind(&parameters)
            .bind(command.key).bind(application.definition_id).bind(binding.binding_id)
            .bind(binding.release_id).bind(binding.generation)
            .execute(&mut *tx).await?;
        let ae = crate::governance::lock_execution(&mut tx, id).await?;
        crate::governance::audit(
            &mut tx,
            &ae,
            def,
            "intent",
            "INTENT",
            "NONE",
            "EVALUATING",
            Some(ctx.human_identity_id),
            Vec::new(),
        )
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
        sqlx::query(
            "update admission.action_execution set gate_state=$2,reason_code=$3,updated_at=now()
            where id=$1",
        )
        .bind(id)
        .bind(if evaluation.allowed {
            "ALLOWED"
        } else {
            "DENIED"
        })
        .bind(evaluation.reason.as_ref().map(crate::governance::wire))
        .execute(&mut *tx)
        .await?;
        let ae = crate::governance::lock_execution(&mut tx, id).await?;
        tx.commit().await?;
        let tool = tool.clone();
        Ok::<_, Refusal>(Admitted {
            ae,
            definition: application.definition,
            tool,
            binding,
        })
    }
    .await;
    admitted.map_err(|error| (error, None))
}

/// 对目标 Resource fresh Check 契约 permission（FullyConsistent，必须有 checked revision）。
async fn fresh(
    gov: &crate::governance::Governance,
    principal: Uuid,
    target: Uuid,
    permission: &str,
) -> Result<Evaluation, Refusal> {
    let checked = gov
        .spicedb
        .check(
            "resource",
            &target.to_string(),
            permission,
            &principal.to_string(),
            Consistency::FullyConsistent,
        )
        .await
        .map_err(|_| Refusal::Unavailable("tool test authorization unavailable".into()))?;
    if checked.zed_token.is_empty() {
        return Err(Refusal::Unavailable(
            "tool test authorization lacks checked revision".into(),
        ));
    }
    Ok(Evaluation {
        allowed: checked.allowed,
        scope: "ALLOW",
        authorization: if checked.allowed { "ALLOW" } else { "DENY" },
        quota: "NOT_APPLICABLE",
        zed_token: Some(checked.zed_token),
        reason: (!checked.allowed).then_some(ReasonCode::PermissionDenied),
    })
}

enum Called {
    Value(Value),
    ToolError,
}

/// 单次派发：DISPATCH 审计先于任何外部调用；已有该审计即不再调用（不重放）。
async fn dispatch(
    service: &ServiceState,
    admitted: &Admitted,
    input: &Value,
) -> Result<Called, Refusal> {
    let ae = &admitted.ae;
    let def = &admitted.definition;
    {
        let mut tx = service.pool.begin().await?;
        let locked = crate::governance::lock_execution(&mut tx, ae.id).await?;
        if locked.gate_state != "ALLOWED" || locked.dispatch_state != "NOT_DISPATCHED" {
            return Err(unavailable());
        }
        let fenced: bool = sqlx::query_scalar(
            "select exists(select 1 from audit.audit_event
            where action_execution_id=$1 and operation_id=$2 and event_type='DISPATCH')",
        )
        .bind(ae.id)
        .bind(ae.operation_id)
        .fetch_one(&mut *tx)
        .await?;
        if fenced {
            return Err(unavailable());
        }
        crate::governance::audit(
            &mut tx,
            &locked,
            def,
            "tool-test:dispatch",
            "DISPATCH",
            "ALLOW",
            "DISPATCH_RESULT_UNKNOWN",
            None,
            Vec::new(),
        )
        .await?;
        tx.commit().await?;
    }
    let route_id = target(ae.id);
    let called = match route_target(admitted, &route_id) {
        Ok((native_target, seconds, limit)) => {
            crate::gateway_admin::history::scope(
                ae.id,
                ae.operation_id,
                invoke(
                    service,
                    Invocation {
                        ae,
                        tool: &admitted.tool,
                        route_id: &route_id,
                        native_target,
                        seconds,
                        limit,
                    },
                    input,
                ),
            )
            .await
        }
        Err(error) => Err(error),
    };
    let removed = crate::gateway_admin::history::scope(
        ae.id,
        ae.operation_id,
        probe::remove_route(&route_id),
    )
    .await;
    if removed.is_err() {
        tracing::warn!(action = %ae.id, "测试调用 route 删除未回读确认；ExtMcp 只放行未派发的同一执行");
    }
    let (started, result_code) = dispatch_fact(&called);
    let mut tx = service.pool.begin().await?;
    crate::governance::lock_execution(&mut tx, ae.id).await?;
    crate::governance::record_dispatch(&mut tx, ae.id, def.audit_class(), started, Vec::new())
        .await?;
    if let Some(code) = result_code {
        crate::governance::audit(
            &mut tx,
            ae,
            def,
            "tool-test:result",
            "OUTCOME",
            "ALLOW",
            code,
            None,
            Vec::new(),
        )
        .await?;
    }
    tx.commit().await?;
    called
}

/// 派发终态：调用完成即 DISPATCHED 并记 OUTCOME；连通原生 peer 之前的确定拒绝没有
/// 工具调用发生，记为中止；其余（超时、回应丢失、结果无法校验）是结果不明。
fn dispatch_fact(
    called: &Result<Called, Refusal>,
) -> (Result<(), StatusCode>, Option<&'static str>) {
    match called {
        Ok(Called::Value(_)) => (Ok(()), Some("SUCCEEDED")),
        Ok(Called::ToolError) => (Ok(()), Some("FAILED")),
        Err(Refusal::Blocked(_)) => (Err(StatusCode::FORBIDDEN), None),
        Err(_) => (Err(StatusCode::SERVICE_UNAVAILABLE), None),
    }
}

/// 交付目录与 binding 已投递的凭据：artifact 与原生实例必须与冻结 binding 一致。
fn route_target(admitted: &Admitted, route_id: &str) -> Result<(Value, u64, usize), Refusal> {
    let binding = &admitted.binding;
    let delivery = probe::peer_delivery(&binding.adapter_service_ref).map_err(|_| blocked())?;
    if Some(delivery.artifact_digest.as_str()) != binding.manifest["adapterBuildRef"].as_str()
        || delivery.native_instance_ref != binding.native_instance_ref
    {
        return Err(blocked());
    }
    let mut native_target = json!({"name":route_id,"mcp":{"host":delivery.mcp_url.as_str()}});
    if let Some(auth) = crate::application_binding::credentials::backend_auth(
        &binding.observation["nativeCredentials"],
    )
    .map_err(|_| blocked())?
    {
        native_target["policies"] = json!({"backendAuth":auth});
    }
    Ok((
        native_target,
        delivery.timeout_seconds,
        delivery.max_response_bytes,
    ))
}

struct Invocation<'a> {
    ae: &'a Execution,
    tool: &'a str,
    route_id: &'a str,
    native_target: Value,
    seconds: u64,
    limit: usize,
}

async fn invoke(
    service: &ServiceState,
    call: Invocation<'_>,
    input: &Value,
) -> Result<Called, Refusal> {
    let action = call.ae.id.to_string();
    let url = probe::publish_route(
        service,
        probe::TemporaryRoute {
            id: call.route_id,
            path: ["tool-test", &action],
            header: HEADER,
            rules: vec![
                "mcp.methodName in ['initialize', 'ping', 'notifications/initialized']".into(),
                format!(
                    "mcp.methodName == 'tools/call' && mcp.tool.name == {}",
                    serde_json::to_string(call.tool).map_err(|_| blocked())?
                ),
            ],
            methods: json!({"*":"request","initialize":"full","ping":"full","tools/call":"full"}),
            metadata: json!({"toolTestAction":"has(mcpGuardrails.toolTestAction) ? mcpGuardrails.toolTestAction : ''"}),
            native_target: call.native_target,
        },
    )
    .await
    // route 尚未生效即没有工具调用发生，是确定拒绝而不是结果不明。
    .map_err(|_| blocked())?;
    let request: rmcp::model::CallToolRequestParams = serde_json::from_value(
        json!({"name":call.tool,"arguments":arguments(call.ae.target_id, input)}),
    )
    .map_err(|_| blocked())?;
    let seconds = call.seconds;
    let limit = call.limit;
    let result = tokio::time::timeout(std::time::Duration::from_secs(seconds), async {
        let client = probe::core_client(url.as_str(), (HEADER, action.clone()), seconds, limit)
            .await
            .map_err(|_| blocked())?;
        let result = client.call_tool(request).await.map_err(|_| unavailable())?;
        let _ = client.cancel().await;
        Ok::<_, Refusal>(result)
    })
    .await
    .map_err(|_| unavailable())??;
    if result.is_error == Some(true) {
        return Ok(Called::ToolError);
    }
    // ExtMcp 已按输出 schema 校验并重建；此处无法解析即结果不明。
    crate::application_binding::peer::result_value(&result)
        .map(Called::Value)
        .map_err(|_| unavailable())
}

/// ExtMcp 两相共用：Gateway 已验证的 Core 身份（DD-137(4)）、该执行仍 ALLOWED 且未派发、已落派发栅栏、
/// 发起与执行者是同一 active HUMAN、目标只是该执行的 route。
async fn live_execution(
    state: &ServiceState,
    caller: &Value,
    action: Uuid,
    services: &[String],
) -> Result<Execution, Refusal> {
    state
        .auth
        .verify_core_mcp_claims(caller)
        .map_err(|_| denied())?;
    let ae = crate::governance::load_execution(&state.pool, action)
        .await?
        .ok_or_else(denied)?;
    let kind = ae
        .parameters
        .as_ref()
        .and_then(|p| p["componentActionKind"].as_str());
    if kind != Some(KIND)
        || ae.initiator_principal_id != ae.actor_principal_id
        || ae.gate_state != "ALLOWED"
        || ae.dispatch_state != "NOT_DISPATCHED"
        || services != [target(action)]
    {
        return Err(denied());
    }
    let fenced: bool = sqlx::query_scalar(
        "select exists(select 1 from audit.audit_event a
        join identity.principal p on p.id=$3 and p.kind='HUMAN' and p.status='ACTIVE'
        where a.action_execution_id=$1 and a.operation_id=$2 and a.event_type='DISPATCH')",
    )
    .bind(ae.id)
    .bind(ae.operation_id)
    .bind(ae.initiator_principal_id)
    .fetch_one(&state.pool)
    .await?;
    if !fenced {
        return Err(denied());
    }
    Ok(ae)
}

/// 请求相位：只放行该执行冻结的工具名与参数摘要，并把参数收窄为原生 `input`。
pub(crate) async fn authorize_request(
    state: &ServiceState,
    caller: &Value,
    action: Uuid,
    services: &[String],
    method: &str,
    params: Option<&[u8]>,
) -> Result<Option<Vec<u8>>, Refusal> {
    let ae = live_execution(state, caller, action, services).await?;
    match method {
        "initialize" | "notifications/initialized" | "ping" => Ok(None),
        "tools/call" => {
            let raw: Value =
                serde_json::from_slice(params.ok_or_else(invalid)?).map_err(|_| invalid())?;
            let parameters = ae.parameters.as_ref().ok_or_else(denied)?;
            let narrowed = frozen_call(&raw, parameters)?;
            let definition =
                crate::governance::exact_definition_for_execution(&state.pool, &ae).await?;
            let checked = fresh(
                &state.governance,
                ae.initiator_principal_id,
                ae.target_id,
                &definition.permission,
            )
            .await?;
            if !checked.allowed {
                return Err(denied());
            }
            Ok(Some(serde_json::to_vec(&narrowed).map_err(|_| invalid())?))
        }
        _ => Err(denied()),
    }
}

/// 请求参数必须恰好是冻结的工具名与参数（摘要一致），返回只含原生 `input` 的参数。
fn frozen_call(raw: &Value, parameters: &Value) -> Result<Value, Refusal> {
    let call = raw.as_object().ok_or_else(invalid)?;
    if call
        .keys()
        .any(|key| !matches!(key.as_str(), "name" | "arguments"))
    {
        return Err(invalid());
    }
    let name = call
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(invalid)?;
    let arguments = call.get("arguments").ok_or_else(invalid)?;
    if parameters["toolName"].as_str() != Some(name)
        || parameters["toolParameterHash"].as_str()
            != Some(collab_bridge::limits::canonical_digest(arguments).as_str())
    {
        return Err(denied());
    }
    let input = arguments.get("input").ok_or_else(invalid)?;
    Ok(json!({"name":name,"arguments":input}))
}

/// 响应相位：按冻结输出 schema 校验并按 exposure 重建结果；原生正文块、链接与执行
/// 元数据不透传。原生错误结果只回一个不含正文的错误。
pub(crate) async fn authorize_response(
    state: &ServiceState,
    caller: &Value,
    action: Uuid,
    services: &[String],
    method: &str,
    response: &[u8],
) -> Result<Option<Vec<u8>>, Refusal> {
    let ae = live_execution(state, caller, action, services).await?;
    match method {
        "initialize" | "ping" => Ok(None),
        "tools/call" => {
            let result: rmcp::model::CallToolResult =
                serde_json::from_slice(response).map_err(|_| invalid())?;
            if result.is_error == Some(true) {
                let error = rmcp::model::CallToolResult::error(Vec::new());
                return Ok(Some(serde_json::to_vec(&error).map_err(|_| invalid())?));
            }
            let value = crate::application_binding::peer::result_value(&result)?;
            let (binding, generation): (Uuid, i64) = sqlx::query_as(
                "select component_binding_id,component_projection_generation
                from admission.action_execution where id=$1 and component_binding_kind='APPLICATION'",
            )
            .bind(ae.id)
            .fetch_one(&state.pool)
            .await?;
            let mut conn = state.pool.acquire().await?;
            let application = crate::application_catalog::exact_definition_for_binding(
                &mut conn,
                binding,
                generation,
                &ae.action_key,
                ae.action_version,
            )
            .await?;
            let documents =
                crate::application_tool::schemas(&mut conn, binding, &ae.action_key).await?;
            let output = documents
                .get(
                    application.declaration["outputSchemaDigest"]
                        .as_str()
                        .ok_or_else(invalid)?,
                )
                .ok_or_else(invalid)?;
            if !crate::capability_contract::schema_validator(output, &documents)?.is_valid(&value) {
                return Err(invalid());
            }
            if let Some(permission) = exposure_permission(&application.definition.result_exposure)?
            {
                let checked = fresh(
                    &state.governance,
                    ae.initiator_principal_id,
                    ae.target_id,
                    permission,
                )
                .await?;
                if !checked.allowed {
                    return Err(denied());
                }
            }
            let rebuilt = match value {
                Value::String(text) => {
                    rmcp::model::CallToolResult::success(vec![rmcp::model::ContentBlock::text(
                        text,
                    )])
                }
                value => rmcp::model::CallToolResult::structured(value),
            };
            Ok(Some(serde_json::to_vec(&rebuilt).map_err(|_| invalid())?))
        }
        _ => Err(denied()),
    }
}

/// 冻结 exposure 对结果的额外 permission：`CONSUME_ONLY` 只要求准入时的契约 permission。
fn exposure_permission(mode: &str) -> Result<Option<&'static str>, Refusal> {
    match mode {
        "CONSUME_ONLY" => Ok(None),
        "READ" => Ok(Some("read")),
        "EXPORT" => Ok(Some("export")),
        _ => Err(denied()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_read_only_contract_permissions_are_testable() {
        for permission in ["discover", "consume", "read"] {
            assert!(read_only_permission(permission), "{permission}");
        }
        for permission in ["export", "create", "update", "delete", "manage", "execute"] {
            assert!(!read_only_permission(permission), "{permission}");
        }
    }

    #[test]
    fn frozen_call_accepts_only_the_frozen_name_and_arguments() {
        let target = Uuid::new_v4();
        let args = arguments(target, &json!({"timezone":"UTC"}));
        let parameters = json!({"toolName":"get_current_time",
            "toolParameterHash":collab_bridge::limits::canonical_digest(&args)});
        let narrowed = frozen_call(
            &json!({"name":"get_current_time","arguments":args}),
            &parameters,
        )
        .unwrap();
        assert_eq!(
            narrowed,
            json!({"name":"get_current_time","arguments":{"timezone":"UTC"}})
        );
        let changed = arguments(target, &json!({"timezone":"Asia/Shanghai"}));
        assert!(frozen_call(
            &json!({"name":"get_current_time","arguments":changed}),
            &parameters
        )
        .is_err());
        let same = arguments(target, &json!({"timezone":"UTC"}));
        assert!(frozen_call(
            &json!({"name":"convert_time","arguments":same}),
            &parameters
        )
        .is_err());
        let same = arguments(target, &json!({"timezone":"UTC"}));
        assert!(frozen_call(
            &json!({"name":"get_current_time","arguments":same,"_meta":{}}),
            &parameters
        )
        .is_err());
    }

    #[test]
    fn exposure_maps_to_fixed_permissions() {
        assert_eq!(exposure_permission("CONSUME_ONLY").unwrap(), None);
        assert_eq!(exposure_permission("READ").unwrap(), Some("read"));
        assert_eq!(exposure_permission("EXPORT").unwrap(), Some("export"));
        assert!(exposure_permission("NONE").is_err());
    }

    #[test]
    fn dispatch_outcome_separates_abort_from_unknown() {
        let (started, code) = dispatch_fact(&Ok(Called::Value(json!("ok"))));
        assert_eq!((started, code), (Ok(()), Some("SUCCEEDED")));
        let (started, code) = dispatch_fact(&Ok(Called::ToolError));
        assert_eq!((started, code), (Ok(()), Some("FAILED")));
        let (started, code) = dispatch_fact(&Err(blocked()));
        assert_eq!((started, code), (Err(StatusCode::FORBIDDEN), None));
        let (started, code) = dispatch_fact(&Err(unavailable()));
        assert_eq!(
            (started, code),
            (Err(StatusCode::SERVICE_UNAVAILABLE), None)
        );
    }

    #[test]
    fn command_keeps_input_canonical_and_closed() {
        let input = json!({"timezone":"UTC"});
        let cmd: contracts::ActionCommand = serde_json::from_value(json!({
            "actionKey":"clock.now@v1","idempotencyKey":Uuid::new_v4(),
            "resourceId":Uuid::new_v4(),"resourceVersion":2,
            "componentAction":{"actionVersion":1,"inputJson":collab_bridge::limits::canonical_json(&input),
                "resultExposurePolicyId":Uuid::new_v4(),"resultExposurePolicyVersion":1}}))
        .unwrap();
        let parsed = command(&cmd).unwrap();
        assert_eq!(parsed.input, input);
        assert_eq!(parsed.version, 2);
        let mut raw = serde_json::to_value(&cmd).unwrap();
        raw["componentAction"]["inputJson"] = json!("{ \"timezone\": \"UTC\" }");
        let spaced: contracts::ActionCommand = serde_json::from_value(raw).unwrap();
        assert!(command(&spaced).is_err());
        let mut raw = serde_json::to_value(&cmd).unwrap();
        raw["explicitConfirmation"] = json!(true);
        let extra: contracts::ActionCommand = serde_json::from_value(raw).unwrap();
        assert!(command(&extra).is_err());
    }
}
