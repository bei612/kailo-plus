//! Worker → Core 的 service API（`01-工程结构与模块边界.md` §4）。
//!
//! 它与 BFF 分开监听。理由见 `service_auth`：网关整体转发给 BFF，同一 listener
//! 上的服务面等于对任何已登录用户开放。这里的调用方是 Application Worker，
//! 不是人，认证方式与授权含义都不同。
//!
//! service identity 只认证服务，不表达业务授权（`DD-37`）：这些 endpoint 写的
//! 是 Workflow 自己的投影，不代替任何 HUMAN/AGENT 的 permission 判定。
//! DD-105 的 MCP 与 ExtMcp 也只复用此私网 listener，但使用独立 Gateway
//! service 身份；每个工具请求仍经过原 Invocation/child AE 的两相 PEP。

use std::sync::Arc;

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use serde::Serialize;
use sqlx::PgPool;

use secret_store::SecretStore;

use crate::service_auth::{ServiceAuth, ServiceAuthError};

#[derive(Clone)]
pub struct ServiceState {
    pub pool: PgPool,
    pub auth: Arc<ServiceAuth>,
    /// Independent native Gateway jwtSign identity; absence disables MCP.
    pub(crate) gateway_service_auth: Option<Arc<crate::service_auth::GatewayServiceAuth>>,
    pub(crate) agent_tool_sessions: Option<Arc<crate::agent_tool_session::SessionSigner>>,
    pub secrets: Arc<SecretStore>,
    /// 部署 audit device 清单的观察者。任一 binding 推进到 ACTIVE 之前都要它
    /// 给出非空（DD-70），见 `audit_gate`。
    pub audit: Arc<secret_store::AuditObserver>,
    /// Platform Catalog Tenant：RelayOperatorIdentity 挂在它下面（.design/09 第 3 步）
    pub catalog_tenant: uuid::Uuid,
    /// SecretRef locator 的前缀 `<namespace>/<mount>`
    /// 允许取用 secret 的 service identity
    pub secret_audience: String,
    /// Community host 的域部分。host 是签名权威（SF-BUZ-32），必须稳定可推导
    pub community_domain: String,
    /// Relay 的网络地址。它与 Community host 不是一回事：后者参与 NIP-98
    /// 签名并作为 Host 头，前者只用于建立连接（SF-BUZ-32）。
    pub relay_transport: String,
    /// 私有删除执行器的部署投递；不使用 Community host 或公开 operator origin
    /// 猜测地址。未投递时 tenant.delete 的四处理器链不成立。
    pub deletion_transport: Option<crate::tenant_delete::DeletionTransport>,
    /// DD-38：固定 namespace 的唯一原生 Customer client；不向前端投递凭据。
    pub openmeter: Arc<crate::openmeter::OpenMeter>,
    /// 复用连接池。每次投影新建 Client 会让 TLS 与连接开销落在重试路径上。
    pub http: reqwest::Client,
    /// Finite ordinary Relay requests; media and independently budgeted work use `http`.
    pub relay_http: reqwest::Client,
    pub temporal: Arc<crate::temporal::TemporalClient>,
    /// ApprovalWorkflow 的投影写回与审批者资格判定（.design/06 §4）
    pub governance: Arc<crate::governance::Governance>,
    /// 单一 Core 内 Supervisor；未投递时 Agent 链拒绝，不回退本机进程。
    pub agent_runtime: Option<Arc<crate::agent_runtime::Supervisor>>,
    pub(crate) capacity: Arc<crate::capacity::Capacity>,
    pub(crate) agent_memory: Arc<crate::agent_memory::Config>,
}

pub fn router(state: ServiceState) -> Router {
    let worker = Router::new()
        .route(
            "/service/v1/conversations/project",
            post(crate::conversations::advance),
        )
        .route(
            "/service/v1/protocol-sessions/reconcile",
            post(crate::protocol_session::reconcile::advance),
        )
        .route(
            "/service/v1/component-releases/authorize-probe",
            post(crate::component_release::authorize_probe),
        )
        .route(
            "/service/v1/component-releases/observe-probe",
            post(crate::component_release::observe_probe),
        )
        .route(
            "/service/v1/component-releases/register-result",
            post(crate::component_release::record),
        )
        .route(
            "/service/v1/component-releases/approve",
            post(crate::component_release::approval::record),
        )
        .route("/service/v1/task-projections", post(project_task_state))
        .route(
            "/service/v1/agent-tasks/advance",
            post(crate::agent_task::advance),
        )
        .route(
            "/service/v1/automations/schedule-admit",
            post(crate::automation::admit_schedule),
        )
        .route(
            "/service/v1/agent-installations/advance",
            post(crate::agent_installation::advance),
        )
        .route(
            "/service/v1/application-bindings/advance",
            post(crate::application_binding::advance),
        )
        .route(
            "/service/v1/application-models/check",
            axum::routing::get(crate::model_route::application::check)
                .post(crate::model_route::application::check),
        )
        .route(
            "/service/v1/component-actions/advance",
            post(crate::application_action::advance),
        )
        .route(
            "/service/v1/resources/advance",
            post(crate::resource_provision::advance),
        )
        .route(
            "/service/v1/resource-imports/advance",
            post(crate::resource_transfer::advance),
        )
        .route(
            "/service/v1/resource-exports/advance",
            post(crate::resource_export::advance),
        )
        .route(
            "/service/v1/membership-projections/buzz",
            post(crate::membership_projection::project_buzz_roster),
        )
        .route(
            "/service/v1/memberships/state",
            post(crate::membership_state::transition_membership),
        )
        .route(
            "/service/v1/memberships/lifecycle",
            post(crate::membership_lifecycle::start_membership_lifecycle),
        )
        .route(
            "/service/v1/tenants/buzz-provision",
            post(crate::tenant_lifecycle::provision_tenant_buzz),
        )
        .route(
            "/service/v1/tenants/buzz-verify",
            post(crate::tenant_lifecycle::verify_tenant_buzz),
        )
        .route(
            "/service/v1/workspaces/buzz-provision",
            post(crate::tenant_lifecycle::provision_workspace_buzz),
        )
        // Workspace 暂停/恢复：Channel 归档与解档（`.design/06` §7.3）
        .route(
            "/service/v1/workspaces/channel-archive",
            post(crate::tenant_lifecycle::converge_workspace_channel_archive),
        )
        // DD-150：workspace.delete 的 DELETE 段，按冻结快照逐项收尾并回读确认
        .route(
            "/service/v1/workspaces/delete-advance",
            post(crate::workspace_delete::advance),
        )
        // DD-119：workspace.update 的 METADATA 段，CONTROL 9002 回读收敛名称/描述/TTL
        .route(
            "/service/v1/workspaces/channel-metadata",
            post(crate::workspace_update::converge_workspace_channel_metadata),
        )
        // 业务 Tenant 暂停/恢复：Community 归档与解档、恢复对账（DD-96）
        .route(
            "/service/v1/tenants/community-archive",
            post(crate::tenant_lifecycle::converge_tenant_community_archive),
        )
        .route(
            "/service/v1/tenants/restore-reconcile",
            post(crate::tenant_lifecycle::restore_reconcile),
        )
        .route(
            "/service/v1/tenants/delete-advance",
            post(crate::tenant_delete::advance),
        )
        // Workspace 暂停/恢复：Channel roster 清空与重建（DD-97）
        .route(
            "/service/v1/workspaces/channel-roster",
            post(crate::tenant_lifecycle::converge_workspace_channel_roster),
        )
        // 原生设备公钥的 roster 投影（DD-79）
        .route(
            "/service/v1/identity-projections/buzz",
            post(crate::identity_projection::project_buzz_identity),
        )
        .route(
            "/service/v1/scopes/state",
            post(crate::scope_state::transition_scope),
        )
        .route(
            "/service/v1/scopes/lifecycle",
            post(crate::membership_lifecycle::start_scope_lifecycle),
        )
        // 搁浅实体的重跑：新 ActionExecution、新实体版本、新 workflow ID
        // （.design/06 §9、DD-48）
        .route(
            "/service/v1/tasks/rerun",
            post(crate::task_rerun::rerun_task),
        )
        // Web 托管 HUMAN 身份的 key revoke 与重建（.design/09 key revoke/rotate）
        .route(
            "/service/v1/identities/server-keys/revoke",
            post(crate::server_keys::revoke_server_key),
        )
        .route(
            "/service/v1/identities/server-keys/provision",
            post(crate::server_keys::provision_server_key),
        )
        // ApprovalWorkflow 的两个 Activity：投影写回与审批者资格（.design/06 §4）
        .route(
            "/service/v1/approval-projections",
            post(crate::governance_api::project_approval_state),
        )
        .route(
            "/service/v1/approvals/admission",
            post(crate::governance_api::fresh_approval_admission),
        )
        .route(
            "/service/v1/secret-ref-rehomes/advance",
            post(crate::secret_ref_rehome::advance),
        )
        .route(
            "/service/v1/adapter/pep_check",
            post(crate::application_binding::pep::check),
        )
        .route(
            "/service/v1/adapter/human-action",
            post(crate::application_action::native_human::handle),
        )
        .route(
            "/service/v1/adapter/request_native_task_execution_admission",
            post(crate::application_action::native_task::handle),
        )
        .route(
            "/service/v1/adapter/request_read_grant",
            post(crate::application_binding::read_grant::request),
        )
        .route(
            "/service/v1/adapter/bindings/{binding}/read-resources",
            axum::routing::get(crate::application_binding::read_grant::read_resources),
        )
        .route(
            "/service/v1/adapter/read_receipt",
            post(crate::application_binding::read_grant::receipt::record),
        )
        // DD-133(4), 07 §4.7.4: read-only member directory for an embedded
        // component; the caller is the binding's own directory client.
        .route(
            "/service/v1/component-directory/bindings/{binding}/members",
            axum::routing::get(crate::component_directory::members),
        )
        // DD-138(4), 07 §4.8.3: notification delivery into the Kailo inbox
        // with the same directory-client service identity.
        .route(
            "/service/v1/component-notifications/bindings/{binding}/notifications",
            post(crate::component_notification::deliver),
        )
        // DD-165, 07 §4.8.9: component usage reports and quota admission with
        // the same directory-client service identity.
        .route(
            "/service/v1/component-usage/bindings/{binding}/reports",
            post(crate::component_usage::report),
        )
        .route(
            "/service/v1/component-usage/bindings/{binding}/admission",
            post(crate::component_usage::admission),
        )
        // DD-169(5), 07 §4.8.11: component secret custody with the same
        // directory-client service identity; values only in the Tenant's OpenBao.
        .route(
            "/service/v1/component-secrets/bindings/{binding}/secrets",
            post(crate::component_secret::write),
        )
        .route(
            "/service/v1/component-secrets/bindings/{binding}/secrets/{secret}/read",
            post(crate::component_secret::read),
        )
        .route(
            "/service/v1/component-secrets/bindings/{binding}/secrets/{secret}/retire",
            post(crate::component_secret::retire),
        )
        .with_state(state.clone());
    match (
        state.gateway_service_auth.clone(),
        state.agent_tool_sessions.clone(),
    ) {
        (Some(auth), Some(sessions)) => {
            let policy = crate::agent_tool_pep::Policy::new(state.clone(), sessions, auth.clone());
            let pep = tonic::service::Routes::new(
                crate::agent_tool_mcp::wire::ext_mcp_server::ExtMcpServer::new(policy),
            )
            .into_axum_router();
            worker
                .merge(crate::agent_tool_mcp::router(state, auth))
                .merge(pep)
        }
        // Startup rejects partial configuration. With neither identity
        // configured, zero-Tool installations add no public or private route.
        _ => worker,
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTaskStateResponse {
    /// false 表示收到的是更旧或重复的事件，已按单调规则忽略。
    /// 这仍是成功：Activity 重试到达同一结果，不该被当成失败再重试。
    pub applied: bool,
    pub last_event_id: i64,
}

async fn project_task_state(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    // body 放在最后：axum 的 extractor 顺序要求消费 body 的放最末
    body: Result<Json<contracts::TaskStateReport>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if let Err(e) = authorize(&state, &headers).await {
        return e;
    }
    let Ok(Json(report)) = body else {
        // 请求体不合法是调用方的错，Activity 侧应列入 NonRetryableErrorTypes：
        // 同样的体重试多少次都一样（06 §5.1）。
        return StatusCode::BAD_REQUEST.into_response();
    };
    let trace = match crate::automation::run_trace::capture(&state, &report).await {
        Ok(trace) => trace,
        Err(error) => {
            tracing::warn!(workflow_id=%report.workflow_id, error=%error, "步骤投影证据尚不可核证");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    };
    match crate::task_projection::apply(&state.pool, &report, false, trace.as_ref()).await {
        Ok(Some(a)) => (
            StatusCode::OK,
            Json(ProjectTaskStateResponse {
                applied: a.applied,
                last_event_id: a.last_event_id,
            }),
        )
            .into_response(),
        // WorkflowRef 还没建：那是 Core 在 Start 之前的职责，Worker 不能替它建
        // （DD-48）。这是调用方错误，不重试。
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => match PersistenceRejection::of(&e) {
            Some(rejection) => {
                tracing::error!(workflow_id = %report.workflow_id, run_id = %report.run_id,
                    event_id = report.event_id, "TaskProjection 写回被数据库确定拒绝");
                record_projection_rejection(&state.pool, &report, &rejection).await;
                rejection.response()
            }
            None => unavailable(e),
        },
    }
}

/// OpenBao 托管身份切换及旧版本永久销毁前的 audit 前置（DD-70）。
///
/// 为空或读不到都回 503：这是部署前置不成立，修好之前 Workflow 按轮等待而不是
/// 失败——实体不因一次运维事故而搁浅，也绝不在留不下痕迹时变更密钥状态。
pub(crate) async fn audit_gate(state: &ServiceState) -> Result<(), Response> {
    match state.audit.enabled_devices().await {
        Ok(n) if n > 0 => Ok(()),
        Ok(_) => {
            tracing::error!("OpenBao 没有启用任何 audit device：拒绝密钥状态变更");
            Err(StatusCode::SERVICE_UNAVAILABLE.into_response())
        }
        Err(e) => {
            tracing::warn!(error = %e, "读不到 OpenBao audit device 清单：拒绝密钥状态变更");
            Err(StatusCode::SERVICE_UNAVAILABLE.into_response())
        }
    }
}

/// 依赖不可用是结果不明，不是拒绝。写成 4xx 会让可恢复故障在 Activity 侧
/// 被当作永久失败而不再重试。
///
/// 例外只有 [`PersistenceRejection`]：数据库以声明的约束或数据类型确定拒绝了
/// 这次写入，同一请求重试多少次都一样。它不再报「依赖不可用」，否则 Worker
/// 会按默认策略无限重试并一直占着 Core 的连接。
pub(crate) fn unavailable(e: sqlx::Error) -> Response {
    if let Some(rejection) = PersistenceRejection::of(&e) {
        return rejection.response();
    }
    tracing::warn!(error = %e, "service API 依赖不可用");
    StatusCode::SERVICE_UNAVAILABLE.into_response()
}

/// Worker 识别的线格式：HTTP 422 + 这个 code，映射为非重试的
/// `CORE_PERSISTENCE_REJECTED`（worker/activities/core_api.go）。
pub(crate) const PERSISTENCE_REJECTED: &str = "PERSISTENCE_REJECTED";

/// 数据库对同一写入的确定拒绝（06 §5.1：确定失败不交给无限重试）。
///
/// 只收三类由 PostgreSQL 自身判定、与并发时序无关的拒绝：
///
/// - `22xxx` 数据异常（类型、取值、格式不成立）；
/// - `23514` 且带约束名：声明的 CHECK 约束。迁移里约四百八十处 plpgsql 守卫
///   也以 `check_violation` 报错，但它们不带约束名，其中不少是「前置事实尚未
///   到达」的状态拒绝，重试可以通过，因此仍按结果不明处理；
/// - `23502` NOT NULL。
///
/// `23505`/`23P01`（并发插入同键，重试读到赢家即幂等通过）、`23503`（父行由
/// 并发路径提交前的时序）与 `23001` 守卫仍是可重试的结果不明；`40001`/`40P01`、
/// 连接与超时同理。
#[derive(Debug, PartialEq)]
pub(crate) struct PersistenceRejection {
    pub sqlstate: String,
    pub constraint: Option<String>,
    pub table: Option<String>,
}

impl PersistenceRejection {
    pub(crate) fn of(error: &sqlx::Error) -> Option<Self> {
        let database = error.as_database_error()?;
        let sqlstate = database.code()?.into_owned();
        let constraint = database.constraint().map(str::to_owned);
        let permanent = sqlstate.starts_with("22")
            || sqlstate == "23502"
            || (sqlstate == "23514" && constraint.is_some());
        permanent.then(|| Self {
            sqlstate,
            constraint,
            table: database.table().map(str::to_owned),
        })
    }

    /// 只记 SQLSTATE、约束名与表名：数据库消息与 detail 可能带行内容或输入值。
    pub(crate) fn response(&self) -> Response {
        tracing::error!(
            sqlstate = %self.sqlstate,
            constraint = self.constraint.as_deref().unwrap_or("-"),
            table = self.table.as_deref().unwrap_or("-"),
            "service API 写入被数据库确定拒绝：同一请求重试不会通过，停止重试"
        );
        (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(serde_json::json!({
                "code": PERSISTENCE_REJECTED,
                "sqlstate": self.sqlstate,
                "constraint": self.constraint,
            })),
        )
            .into_response()
    }
}

/// 投影写回被确定拒绝时，在原 operation 上追加一条 RECONCILIATION 审计事实，
/// 让「这条任务停在了哪里」在审计与业务操作视图里可查，而不只在日志里。
///
/// 它记录的是一次没有发生的状态变化，因此只能独立成事务；写不进去只记日志，
/// 不改变给 Worker 的确定拒绝。同一 workflow、同一原因只记一次。
async fn record_projection_rejection(
    pool: &PgPool,
    report: &contracts::TaskStateReport,
    rejection: &PersistenceRejection,
) {
    let recorded = async {
        let mut tx = pool.begin().await?;
        let found = append_projection_rejection(&mut tx, report, rejection).await?;
        tx.commit().await?;
        Ok::<bool, sqlx::Error>(found)
    };
    match recorded.await {
        Ok(true) => {}
        Ok(false) => tracing::error!(workflow_id = %report.workflow_id,
            "投影确定拒绝找不到原 WorkflowRef，无法追加审计事实"),
        Err(error) => tracing::error!(workflow_id = %report.workflow_id, error = %error,
            "投影确定拒绝的审计事实未能写入"),
    }
}

/// 在给定事务内按 WorkflowRef 找到原 ActionExecution 并追加审计事实；
/// `Ok(false)` 表示没有这条 WorkflowRef。
pub(crate) async fn append_projection_rejection(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    report: &contracts::TaskStateReport,
    rejection: &PersistenceRejection,
) -> Result<bool, sqlx::Error> {
    use crate::audit::{append, AuditEntry, Evidence};
    use contracts::EvidenceKind;
    #[derive(sqlx::FromRow)]
    struct Operation {
        id: uuid::Uuid,
        tenant_id: uuid::Uuid,
        workspace_id: Option<uuid::Uuid>,
        operation_id: uuid::Uuid,
        initiator_principal_id: uuid::Uuid,
        actor_principal_id: uuid::Uuid,
        action_key: String,
        action_version: i32,
        target_id: uuid::Uuid,
        parameter_hash: String,
        correlation_id: uuid::Uuid,
    }
    let Some(ae) = sqlx::query_as::<_, Operation>(
        "select ae.id, ae.tenant_id, ae.workspace_id, ae.operation_id,
                ae.initiator_principal_id, ae.actor_principal_id, ae.action_key,
                ae.action_version, ae.target_id, ae.parameter_hash, ae.correlation_id
         from projection.workflow_ref w
         join admission.action_execution ae on ae.id = w.action_execution_id
         where w.workflow_id = $1",
    )
    .bind(&report.workflow_id)
    .fetch_optional(&mut **tx)
    .await?
    else {
        return Ok(false);
    };
    append(
        tx,
        AuditEntry {
            event_key: format!(
                "task-projection:{}:{PERSISTENCE_REJECTED}:{}:{}",
                report.workflow_id,
                rejection.sqlstate,
                rejection.constraint.as_deref().unwrap_or("-")
            ),
            tenant_id: Some(ae.tenant_id),
            workspace_id: ae.workspace_id,
            operation_id: ae.operation_id,
            event_type: "RECONCILIATION",
            human_identity_id: None,
            initiator_principal_id: Some(ae.initiator_principal_id),
            actor_principal_id: Some(ae.actor_principal_id),
            action_key: &ae.action_key,
            action_version: ae.action_version,
            component_type_key: "CORE_INTERNAL",
            target_type: None,
            target_id: Some(ae.target_id),
            parameter_hash: &ae.parameter_hash,
            decision: "ALLOW",
            result_code: PERSISTENCE_REJECTED,
            result_exposure: "NONE",
            evidence_refs: vec![
                Evidence::new(EvidenceKind::ActionExecutionId, ae.id),
                Evidence::new(EvidenceKind::TemporalWorkflowId, &report.workflow_id),
                Evidence::new(EvidenceKind::TemporalRunId, &report.run_id),
            ],
            correlation_id: ae.correlation_id,
        },
    )
    .await?;
    Ok(true)
}

pub(crate) async fn authorize(state: &ServiceState, headers: &HeaderMap) -> Result<(), Response> {
    let header = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());
    match state.auth.verify(header).await {
        Ok(caller) => {
            tracing::debug!(caller, "service API 调用已认证");
            Ok(())
        }
        // 密钥不可得是结果不明：IdP 暂时打不通不等于调用方没有权限。
        Err(ServiceAuthError::KeysUnavailable) => {
            Err(StatusCode::SERVICE_UNAVAILABLE.into_response())
        }
        Err(e) => {
            tracing::warn!(error = %e, "service API 认证失败");
            Err(StatusCode::UNAUTHORIZED.into_response())
        }
    }
}

#[cfg(test)]
mod persistence_rejection_tests {
    //! 「确定拒绝不再重试」与「暂时性失败继续重试」的分界，在真实 PostgreSQL
    //! 报出的错误上核对，而不是手工构造的 SQLSTATE。
    use super::*;
    use serde_json::{json, Value};
    use uuid::Uuid;

    async fn body(response: Response) -> Value {
        let bytes = axum::body::to_bytes(response.into_body(), 4096)
            .await
            .expect("bounded body");
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    }

    #[test]
    fn transport_failures_stay_retryable() {
        for error in [
            sqlx::Error::PoolTimedOut,
            sqlx::Error::Io(std::io::ErrorKind::ConnectionReset.into()),
        ] {
            assert_eq!(PersistenceRejection::of(&error), None);
            assert_eq!(unavailable(error).status(), StatusCode::SERVICE_UNAVAILABLE);
        }
    }

    #[tokio::test]
    async fn real_postgres_permanent_refusals_stop_and_conflicts_keep_retrying() {
        let Some(database_url) = std::env::var("DATABASE_URL").ok() else {
            eprintln!("SKIP persistence rejection: no disposable migrated DATABASE_URL");
            return;
        };
        let pool = PgPool::connect(&database_url)
            .await
            .expect("disposable migrated database");

        // The incident: the declared TaskProjection trace CHECK refuses the row.
        // CHECK runs before the deferred-to-statement-end foreign key trigger.
        let mut tx = pool.begin().await.expect("transaction");
        let refused = sqlx::query(
            "insert into projection.task_projection
               (workflow_id, run_id, last_event_id, status, execution_trace)
             values ($1, 'run', 1, 'RUNNING', $2)",
        )
        .bind(format!("persistence-rejection:{}", Uuid::new_v4()))
        .bind(json!([{"stepId":"hook","status":"completed","output":{"requestBody":"x"}}]))
        .execute(&mut *tx)
        .await
        .expect_err("the declared trace CHECK refuses an unknown output key");
        tx.rollback().await.expect("rollback");
        let rejection = PersistenceRejection::of(&refused).expect("permanent refusal");
        assert_eq!(rejection.sqlstate, "23514");
        assert_eq!(
            rejection.constraint.as_deref(),
            Some("task_projection_execution_trace_check")
        );
        assert_eq!(rejection.table.as_deref(), Some("task_projection"));
        let response = unavailable(refused);
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            body(response).await,
            json!({"code":"PERSISTENCE_REJECTED","sqlstate":"23514",
                   "constraint":"task_projection_execution_trace_check"})
        );

        // 22xxx: the same value can never be cast.
        let cast = sqlx::query("select 'not-a-number'::integer")
            .execute(&pool)
            .await
            .expect_err("invalid integer text");
        assert_eq!(
            PersistenceRejection::of(&cast).map(|r| r.sqlstate),
            Some("22P02".to_owned())
        );

        // A plpgsql guard raising check_violation without a constraint name is a
        // state refusal that a later attempt may pass: keep retrying.
        let guard = sqlx::query(
            "do $$ begin raise exception 'precondition not yet observed'
               using errcode = 'check_violation'; end $$",
        )
        .execute(&pool)
        .await
        .expect_err("guard refusal");
        assert_eq!(PersistenceRejection::of(&guard), None);
        assert_eq!(unavailable(guard).status(), StatusCode::SERVICE_UNAVAILABLE);

        // A real 40001 between two sessions: the retry reads the winner.
        let schema = format!("retry_probe_{}", Uuid::new_v4().simple());
        sqlx::raw_sql(&format!(
            "create schema {schema};
             create table {schema}.cell(id integer primary key, v integer not null);
             insert into {schema}.cell values (1, 0);"
        ))
        .execute(&pool)
        .await
        .expect("probe schema");
        let mut first = pool.begin().await.expect("first session");
        sqlx::query("set transaction isolation level repeatable read")
            .execute(&mut *first)
            .await
            .expect("repeatable read");
        sqlx::query(&format!("select v from {schema}.cell where id = 1"))
            .execute(&mut *first)
            .await
            .expect("snapshot");
        sqlx::query(&format!("update {schema}.cell set v = 1 where id = 1"))
            .execute(&pool)
            .await
            .expect("concurrent committed update");
        let conflict = sqlx::query(&format!("update {schema}.cell set v = 2 where id = 1"))
            .execute(&mut *first)
            .await
            .expect_err("serialization failure");
        first.rollback().await.expect("rollback");
        assert_eq!(
            conflict
                .as_database_error()
                .and_then(|e| e.code())
                .as_deref(),
            Some("40001")
        );
        assert_eq!(PersistenceRejection::of(&conflict), None);
        assert_eq!(
            unavailable(conflict).status(),
            StatusCode::SERVICE_UNAVAILABLE
        );

        // Duplicate key from a concurrent insert of the same key: retry is idempotent.
        let duplicate = sqlx::query(&format!("insert into {schema}.cell values (1, 3)"))
            .execute(&pool)
            .await
            .expect_err("unique violation");
        assert_eq!(PersistenceRejection::of(&duplicate), None);
        sqlx::raw_sql(&format!("drop schema {schema} cascade"))
            .execute(&pool)
            .await
            .expect("drop probe schema");

        // The refusal is visible on the original operation as one audit fact.
        let mut tx = pool.begin().await.expect("transaction");
        let workflow = format!("persistence-rejection:{}", Uuid::new_v4());
        let (tenant, principal, action) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
        sqlx::query(
            "insert into identity.tenant(id,slug,name,state)
             values ($1,'persistence-'||$1::text,'Persistence fixture','ACTIVE')",
        )
        .bind(tenant)
        .execute(&mut *tx)
        .await
        .expect("tenant fixture");
        sqlx::query(
            "insert into identity.principal(id,tenant_id,kind,status) values ($1,$2,'HUMAN','ACTIVE')",
        )
        .bind(principal)
        .bind(tenant)
        .execute(&mut *tx)
        .await
        .expect("principal fixture");
        sqlx::query(
            "insert into admission.action_execution(id,operation_id,tenant_id,action_key,action_version,
               initiator_principal_id,actor_principal_id,target_id,parameter_hash,gate_state,
               dispatch_state,correlation_id)
             values ($1,gen_random_uuid(),$2,'automation.run',1,$3,$3,gen_random_uuid(),
               repeat('a',64),'ALLOWED','DISPATCHED',gen_random_uuid())",
        )
        .bind(action)
        .bind(tenant)
        .bind(principal)
        .execute(&mut *tx)
        .await
        .expect("action fixture");
        sqlx::query(
            "insert into projection.workflow_ref(workflow_id,run_id,workflow_type,workflow_version,
               tenant_id,operation_id,action_execution_id,projection_state)
             select $1,'run','AgentTaskWorkflow',1,tenant_id,operation_id,id,'RUNNING'
             from admission.action_execution where id = $2",
        )
        .bind(&workflow)
        .bind(action)
        .execute(&mut *tx)
        .await
        .expect("workflow fixture");
        sqlx::query(
            "update admission.action_execution set temporal_workflow_id = $1 where id = $2",
        )
        .bind(&workflow)
        .bind(action)
        .execute(&mut *tx)
        .await
        .expect("workflow link");
        let report = contracts::TaskStateReport {
            activity_id: None,
            workflow_id: workflow.clone(),
            run_id: "run".into(),
            event_id: 7,
            status: contracts::TaskStatus::Completed,
            waiting_reason: None,
            progress: None,
        };
        for _ in 0..2 {
            assert!(append_projection_rejection(&mut tx, &report, &rejection)
                .await
                .expect("audit append"));
        }
        let facts: Vec<(String, String, String, Value)> = sqlx::query_as(
            "select a.event_type, a.result_code, a.action_key, a.evidence_refs
             from audit.audit_event a join admission.action_execution ae
               on ae.operation_id = a.operation_id and ae.tenant_id = a.tenant_id
             where ae.id = $1",
        )
        .bind(action)
        .fetch_all(&mut *tx)
        .await
        .expect("audit read");
        assert_eq!(facts.len(), 1, "same workflow and cause is recorded once");
        assert_eq!(facts[0].0, "RECONCILIATION");
        assert_eq!(facts[0].1, "PERSISTENCE_REJECTED");
        assert_eq!(facts[0].2, "automation.run");
        assert_eq!(
            facts[0].3,
            json!([
                {"kind":"ACTION_EXECUTION_ID","value":action.to_string()},
                {"kind":"TEMPORAL_WORKFLOW_ID","value":workflow},
                {"kind":"TEMPORAL_RUN_ID","value":"run"}
            ])
        );
        let missing = contracts::TaskStateReport {
            workflow_id: format!("persistence-rejection:{}", Uuid::new_v4()),
            ..report
        };
        assert!(!append_projection_rejection(&mut tx, &missing, &rejection)
            .await
            .expect("missing workflow ref"));
        tx.rollback().await.expect("fixture rolls back");
        pool.close().await;
    }
}
