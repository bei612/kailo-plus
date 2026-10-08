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
    match crate::task_projection::apply(&state.pool, &report, false).await {
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
        Err(e) => unavailable(e),
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
pub(crate) fn unavailable(e: sqlx::Error) -> Response {
    tracing::warn!(error = %e, "service API 依赖不可用");
    StatusCode::SERVICE_UNAVAILABLE.into_response()
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
