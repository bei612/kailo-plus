//! 平台自持 Nostr 私钥的写入意图、孤儿收敛与退役（`DD-86`、`DD-113`）。
//!
//! 三类 key（`custody=SERVER` 的 HUMAN、Tenant CONTROL、RelayOperatorIdentity）共用
//! `admission.server_key_provision_intent`：写入前冻结独占 locator 与发起的
//! operation，binding/identity 与意图的 BOUND 同事务提交。本模块只放三者共用的
//! 两条收敛：
//!
//! - **孤儿**（OPEN/FENCED → DESTROYED）：在原动作或意图锁下持久 fence，与在途写入
//!   以 `cas=0` 争版本 1，只销毁版本 1，metadata 同时查证 `current_version=1` 与
//!   `destroyed=true` 才终结，审计追加到原 operation（DD-86，DD-113 (2)）。
//! - **退役**（BOUND → RETIRED）：key 退役后对已绑定的版本 1 执行 `destroy`（不抢占），
//!   同一条件查证后记 `retired_at`（DD-113 (3)(4)）。
//!
//! 结果不明、metadata 缺失、版本大于 1、仍被 binding 或 identity 引用、OpenBao 拒绝
//! 时一律保持原状态，由调用方重试或对账器告警；不换 locator、不追加版本、不删意图。

use contracts::EvidenceKind;
use secret_store::{PlatformKey, SecretError};
use uuid::Uuid;

use crate::audit::{append, AuditEntry, Evidence};
use crate::client_keys::{AUDIT_CLASS, KIND};
use crate::governance::AuditClass;
use crate::server_identity::BoundKeyError;
use crate::service_api::{unavailable, ServiceState};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};

/// operator key 的投递与轮换是部署动作（`.design/09` RelayOperatorIdentity rotate 行），
/// 不经 ActionDefinition；其审计沿用引导路径已有的动作键与分类。
pub(crate) const OPERATOR_ACTION: &str = "relay_operator.rotate";
pub(crate) const OPERATOR_TARGET: &str = "RELAY_OPERATOR_IDENTITY";

const HUMAN_PROVISION: &str = "identity.key_provision";
const HUMAN_REVOKE: &str = "identity.key_revoke";

/// 两条收敛所需的外部依赖。服务面从 `ServiceState` 取；引导在 Core 监听之前运行，
/// 只有库、密钥库与 audit 观察者（DD-115 (5)）。
pub(crate) struct Stores<'a> {
    pub pool: &'a sqlx::PgPool,
    pub secrets: &'a secret_store::SecretStore,
    pub audit: &'a secret_store::AuditObserver,
}

impl<'a> Stores<'a> {
    pub(crate) fn of(state: &'a ServiceState) -> Self {
        Self {
            pool: &state.pool,
            secrets: &state.secrets,
            audit: &state.audit,
        }
    }

    /// DD-70：没有启用的 audit device 时 OpenBao 不 fail closed；与
    /// `service_api::audit_gate` 同一判据，不可用只暂缓。
    async fn audit_ready(&self) -> bool {
        match self.audit.enabled_devices().await {
            Ok(n) if n > 0 => true,
            Ok(_) => {
                tracing::error!("OpenBao 没有启用任何 audit device：拒绝密钥状态变更");
                false
            }
            Err(e) => {
                tracing::warn!(error = %e, "读不到 OpenBao audit device 清单：拒绝密钥状态变更");
                false
            }
        }
    }
}

/// DD-99/109：namespace 的创建与 Tenant 进入 DELETING 使用同一持久行锁。
/// 不能仅靠 SecretStore 的进程内退休集合；重启后的补偿也必须读取 Tenant 终态。
pub(crate) async fn ensure_tenant_namespace(
    pool: &sqlx::PgPool,
    secrets: &secret_store::SecretStore,
    tenant_id: Uuid,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut tx = pool.begin().await?;
    let state: Option<String> =
        sqlx::query_scalar("select state from identity.tenant where id = $1 for update")
            .bind(tenant_id)
            .fetch_optional(&mut *tx)
            .await?;
    let state = state.and_then(|s| {
        serde_json::from_value::<contracts::TenantState>(serde_json::Value::String(s)).ok()
    });
    match state {
        Some(
            contracts::TenantState::Provisioning
            | contracts::TenantState::Active
            | contracts::TenantState::Suspending
            | contracts::TenantState::Suspended
            | contracts::TenantState::Restoring
            | contracts::TenantState::Error,
        ) => {}
        _ => return Err(SecretError::Refused.into()),
    }
    // 外部收敛期间保留行锁：先读再释放会允许 DELETE 与重建 namespace 交错。
    secrets.ensure_tenant(tenant_id).await?;
    tx.commit().await?;
    Ok(())
}

pub(crate) fn key_kind(kind: PlatformKey) -> &'static str {
    match kind {
        PlatformKey::Human => "HUMAN",
        PlatformKey::Control => "CONTROL",
        PlatformKey::Operator => "OPERATOR",
    }
}

fn parse_kind(kind: &str) -> Option<PlatformKey> {
    match kind {
        "HUMAN" => Some(PlatformKey::Human),
        "CONTROL" => Some(PlatformKey::Control),
        "OPERATOR" => Some(PlatformKey::Operator),
        _ => None,
    }
}

#[derive(sqlx::FromRow, Clone)]
pub(crate) struct Intent {
    pub id: Uuid,
    pub key_kind: String,
    pub tenant_id: Uuid,
    pub principal_id: Option<Uuid>,
    pub action_execution_id: Option<Uuid>,
    /// `origin=BACKFILLED` 的存量行如实为空（DD-115 (1)）。
    pub operation_id: Option<Uuid>,
    pub origin: String,
    pub target_locator: String,
    pub source_membership_scope: Option<String>,
    pub finished: bool,
    pub fenced: bool,
    pub destroyed: bool,
    /// OPERATOR 的提交截止已过（DD-115 (4)）；其余类别恒为 false。
    pub deadline_passed: bool,
}

pub(crate) const INTENT_COLUMNS: &str =
    "id, key_kind, tenant_id, principal_id, action_execution_id, operation_id, origin,
     target_locator, source_membership_scope, finished_at is not null as finished,
     fenced_at is not null as fenced, destroyed_at is not null as destroyed,
     coalesce(commit_deadline_at <= now(), false) as deadline_passed";

pub(crate) async fn intent(
    conn: &mut sqlx::PgConnection,
    id: Uuid,
    lock: bool,
) -> Result<Option<Intent>, sqlx::Error> {
    sqlx::query_as(&format!(
        "select {INTENT_COLUMNS} from admission.server_key_provision_intent where id = $1{}",
        if lock { " for update" } else { "" }
    ))
    .bind(id)
    .fetch_optional(conn)
    .await
}

/// 钉定 locator 是否仍被任何 binding 或 operator identity 引用（含历史 REVOKED）。
pub(crate) async fn referenced(
    conn: &mut sqlx::PgConnection,
    locator: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "select exists (select 1 from identity.buzz_identity_binding
                        where private_key_secret_ref = $1)
             or exists (select 1 from identity.relay_operator_identity
                        where private_key_secret_ref = $1)",
    )
    .bind(locator)
    .fetch_one(conn)
    .await
}

#[derive(sqlx::FromRow)]
pub(crate) struct ActionAuditContext {
    pub operation_id: Uuid,
    pub workspace_id: Option<Uuid>,
    pub initiator_principal_id: Uuid,
    pub actor_principal_id: Uuid,
    pub target_id: Uuid,
    pub parameter_hash: String,
    pub correlation_id: Uuid,
    pub action_version: i32,
    pub action_key: String,
    /// 三项分类都来自同一 ActionDefinition 行；没有定义时整体为 NONE。
    pub component_type_key: Option<String>,
    pub target_type: Option<String>,
    pub result_exposure: Option<String>,
}

pub(crate) async fn action_audit_context(
    conn: &mut sqlx::PgConnection,
    action_id: Uuid,
    tenant_id: Uuid,
) -> Result<ActionAuditContext, sqlx::Error> {
    sqlx::query_as(
        "select ae.operation_id, ae.workspace_id, ae.initiator_principal_id,
                ae.actor_principal_id, ae.target_id, ae.parameter_hash,
                ae.correlation_id, ae.action_version, ae.action_key,
                d.component_type_key, d.target_type, d.result_exposure
         from admission.action_execution ae
         left join catalog.action_definition d
           on d.action_key = ae.action_key and d.version = ae.action_version
         where ae.id = $1 and ae.tenant_id = $2",
    )
    .bind(action_id)
    .bind(tenant_id)
    .fetch_one(conn)
    .await
}

/// 对账审计追加在原 operation 上，分类沿用原入口的约定（`governance::AuditClass`）：
/// 有 ActionDefinition 的取定义；没有定义的入口由入口按它驱动的目标声明——托管
/// 身份动作是 `client_keys::AUDIT_CLASS`，成员生命周期是对应成员关系，Tenant 建立
/// 是 Tenant。其余入口不能冻结平台自持私钥写入：返回 None 时调用方不 fence、不
/// 销毁，已 fence 的意图也不终结，均由 overdue 度量告警。
pub(crate) fn audit_class<'a>(
    context: &'a ActionAuditContext,
    kind: PlatformKey,
    source_membership_scope: Option<&str>,
) -> Option<AuditClass<'a>> {
    match (
        &context.component_type_key,
        &context.target_type,
        &context.result_exposure,
    ) {
        (Some(component_type_key), Some(target_type), Some(result_exposure)) => Some(AuditClass {
            component_type_key,
            target_type,
            result_exposure,
        }),
        (None, None, None) => match (kind, source_membership_scope) {
            (PlatformKey::Human, None)
                if matches!(context.action_key.as_str(), HUMAN_PROVISION | HUMAN_REVOKE) =>
            {
                Some(AUDIT_CLASS)
            }
            (PlatformKey::Human, Some("TENANT")) => Some(AuditClass::core("TENANT_MEMBERSHIP")),
            (PlatformKey::Human, Some("WORKSPACE")) => {
                Some(AuditClass::core("WORKSPACE_MEMBERSHIP"))
            }
            (PlatformKey::Control, None) => Some(AuditClass::core("TENANT")),
            _ => None,
        },
        _ => None,
    }
}

/// 一条对账审计的主体：有 ActionExecution 的取其上下文，operator 取部署动作。
struct Subject {
    operation_id: Uuid,
    workspace_id: Option<Uuid>,
    initiator: Option<Uuid>,
    actor: Option<Uuid>,
    target_id: Uuid,
    parameter_hash: String,
    correlation_id: Uuid,
    action_version: i32,
    action_key: String,
    component_type_key: String,
    target_type: String,
    result_exposure: String,
}

impl Subject {
    fn from_action(
        context: ActionAuditContext,
        kind: PlatformKey,
        scope: Option<&str>,
    ) -> Option<Self> {
        let class = audit_class(&context, kind, scope)?;
        let (component, target, exposure) = (
            class.component_type_key.to_owned(),
            class.target_type.to_owned(),
            class.result_exposure.to_owned(),
        );
        Some(Self {
            operation_id: context.operation_id,
            workspace_id: context.workspace_id,
            initiator: Some(context.initiator_principal_id),
            actor: Some(context.actor_principal_id),
            target_id: context.target_id,
            parameter_hash: context.parameter_hash,
            correlation_id: context.correlation_id,
            action_version: context.action_version,
            action_key: context.action_key,
            component_type_key: component,
            target_type: target,
            result_exposure: exposure,
        })
    }

    /// operator 的 locator 以其 pubkey 结尾（`platform_bootstrap::operator_locator`）。
    fn operator(operation_id: Uuid, catalog: Uuid, locator: &str) -> Self {
        Self {
            operation_id,
            workspace_id: None,
            initiator: None,
            actor: None,
            target_id: catalog,
            parameter_hash: locator.rsplit('/').next().unwrap_or_default().to_owned(),
            correlation_id: operation_id,
            action_version: 1,
            action_key: OPERATOR_ACTION.to_owned(),
            component_type_key: "buzz".to_owned(),
            target_type: OPERATOR_TARGET.to_owned(),
            result_exposure: "NONE".to_owned(),
        }
    }

    async fn append(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        event_key: String,
        tenant_id: Uuid,
        result_code: &str,
        evidence: Vec<Evidence>,
    ) -> Result<(), sqlx::Error> {
        append(
            tx,
            AuditEntry {
                event_key,
                tenant_id: Some(tenant_id),
                workspace_id: self.workspace_id,
                operation_id: self.operation_id,
                event_type: "RECONCILIATION",
                human_identity_id: None,
                initiator_principal_id: self.initiator,
                actor_principal_id: self.actor,
                action_key: &self.action_key,
                action_version: self.action_version,
                component_type_key: &self.component_type_key,
                target_type: Some(&self.target_type),
                target_id: Some(self.target_id),
                parameter_hash: &self.parameter_hash,
                decision: "ALLOW",
                result_code,
                result_exposure: &self.result_exposure,
                evidence_refs: evidence,
                correlation_id: self.correlation_id,
            },
        )
        .await
    }
}

/// 孤儿终态审计的主体：发起该写入的 operation。
async fn orphan_subject(
    conn: &mut sqlx::PgConnection,
    frozen: &Intent,
    kind: PlatformKey,
) -> Result<Option<Subject>, sqlx::Error> {
    // 只有 PROVISIONED 的意图有发起的 operation，才可能成为孤儿（DD-115 (2)）。
    let Some(operation) = frozen
        .operation_id
        .filter(|_| frozen.origin == "PROVISIONED")
    else {
        return Ok(None);
    };
    match (kind, frozen.action_execution_id) {
        (PlatformKey::Operator, None) => Ok(Some(Subject::operator(
            operation,
            frozen.tenant_id,
            &frozen.target_locator,
        ))),
        (PlatformKey::Human | PlatformKey::Control, Some(action)) => {
            let context = action_audit_context(conn, action, frozen.tenant_id).await?;
            if context.operation_id != operation {
                return Ok(None);
            }
            Ok(Subject::from_action(
                context,
                kind,
                frozen.source_membership_scope.as_deref(),
            ))
        }
        _ => Ok(None),
    }
}

/// 在原动作（有则）、Principal（有则）与意图的行锁下取回冻结事实。
async fn lock_frozen(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    snapshot: &Intent,
) -> Result<Option<Intent>, sqlx::Error> {
    let owner: Option<i32> = match (snapshot.action_execution_id, snapshot.principal_id) {
        (Some(action), Some(principal)) => {
            sqlx::query_scalar(
                "select 1 from admission.action_execution ae
                 join identity.principal p on p.id = $3 and p.tenant_id = ae.tenant_id
                 where ae.id = $1 and ae.tenant_id = $2
                 for update of ae,p",
            )
            .bind(action)
            .bind(snapshot.tenant_id)
            .bind(principal)
            .fetch_optional(&mut **tx)
            .await?
        }
        (None, Some(principal)) => {
            sqlx::query_scalar(
                "select 1 from identity.principal where id = $1 and tenant_id = $2 for update",
            )
            .bind(principal)
            .bind(snapshot.tenant_id)
            .fetch_optional(&mut **tx)
            .await?
        }
        (_, None) => Some(1),
    };
    if owner.is_none() {
        return Ok(None);
    }
    let frozen = intent(tx, snapshot.id, true).await?;
    Ok(frozen.filter(|f| {
        f.target_locator == snapshot.target_locator
            && f.tenant_id == snapshot.tenant_id
            && f.principal_id == snapshot.principal_id
            && f.key_kind == snapshot.key_kind
    }))
}

/// DD-86 / DD-113 (2)：未绑定写入意图的唯一补偿链。先在原动作、Principal 与意图
/// 锁下持久 fence，再与在途 CAS 争夺版本 1；没有 metadata 销毁证明时绝不终结。
pub(crate) async fn fence_and_destroy_intent(
    state: &ServiceState,
    intent_id: Uuid,
) -> &'static str {
    fence_and_destroy_with(&Stores::of(state), intent_id).await
}

pub(crate) async fn fence_and_destroy_with(stores: &Stores<'_>, intent_id: Uuid) -> &'static str {
    let snapshot = {
        let Ok(mut conn) = stores.pool.acquire().await else {
            return "FAILED";
        };
        match intent(&mut conn, intent_id, false).await {
            Ok(Some(row)) => row,
            Ok(None) => return "GONE",
            Err(error) => {
                tracing::warn!(intent = %intent_id, error = %error, "读取写入意图失败");
                return "FAILED";
            }
        }
    };
    let Some(kind) = parse_kind(&snapshot.key_kind) else {
        return "CONFLICT";
    };
    let locator = snapshot.target_locator.clone();

    let mut tx = match stores.pool.begin().await {
        Ok(tx) => tx,
        Err(_) => return "FAILED",
    };
    let frozen = match lock_frozen(&mut tx, &snapshot).await {
        Ok(Some(frozen)) => frozen,
        Ok(None) => return "CONFLICT",
        Err(_) => return "FAILED",
    };
    // locator 形状不能决定写入用途。归位必须由实存原动作、归位实体与固定
    // Workflow 共同证明；已知是归位而因果不完整时，不能退回 CONTROL 初建路径。
    let rehome = if let Some(action) = frozen.action_execution_id {
        let action_key: Result<String, _> = sqlx::query_scalar(
            "select action_key from admission.action_execution where id = $1 and tenant_id = $2",
        )
        .bind(action)
        .bind(frozen.tenant_id)
        .fetch_one(&mut *tx)
        .await;
        let Ok(action_key) = action_key else {
            return "FAILED";
        };
        if action_key == "identity.secret_ref.rehome" {
            let id: Result<Option<Uuid>, _> = sqlx::query_scalar(
                "select r.id from admission.secret_ref_rehome r
                 join admission.action_execution ae
                   on ae.id = r.action_execution_id and ae.tenant_id = r.tenant_id
                 join projection.workflow_ref w
                   on w.workflow_id = r.workflow_id and w.action_execution_id = ae.id
                  and w.tenant_id = ae.tenant_id and w.operation_id = ae.operation_id
                 join identity.buzz_identity_binding b
                   on b.pubkey = r.identity_pubkey and b.tenant_id = ae.tenant_id
                  and b.principal_id = ae.target_id and b.custody = 'SERVER'
                 where r.id = ae.id and ae.id = $1 and r.tenant_id = $2
                   and r.target_locator = $3 and b.kind = $4 and b.kind in ('HUMAN','CONTROL')
                   and b.principal_id = $5 and ae.operation_id = $6
                   and ae.action_key = 'identity.secret_ref.rehome'
                   and ae.temporal_workflow_id = w.workflow_id
                   and w.workflow_type = 'ComponentTaskWorkflow' and w.kind = 'SECRET_REF_REHOME'
                   and r.new_ref_version = 1
                   and ((r.state = 'COPIED' and r.new_ref_status = 'PENDING')
                        or (r.state = 'FAILED' and r.new_ref_status = 'DISCARDED'))",
            )
            .bind(action)
            .bind(frozen.tenant_id)
            .bind(&locator)
            .bind(&frozen.key_kind)
            .bind(frozen.principal_id)
            .bind(frozen.operation_id)
            .fetch_optional(&mut *tx)
            .await;
            match id {
                Ok(Some(id))
                    if frozen.origin == "PROVISIONED"
                        && frozen.source_membership_scope.is_none() =>
                {
                    Some(id)
                }
                Ok(_) => return "CONFLICT",
                Err(_) => return "FAILED",
            }
        } else {
            None
        }
    } else {
        None
    };
    if frozen.finished {
        return if frozen.destroyed {
            "CONVERGED"
        } else {
            "CONFLICT"
        };
    }
    if frozen.origin != "PROVISIONED" || frozen.operation_id.is_none() {
        return "CONFLICT";
    }
    if !matches!(referenced(&mut tx, &locator).await, Ok(false)) {
        return "CONFLICT";
    }
    if kind == PlatformKey::Human && rehome.is_none() {
        // 托管身份的固定 WorkflowRef 只与 binding 同事务预写；它已存在说明写入
        // 已形成身份，不是孤儿。
        let Some(action) = frozen.action_execution_id else {
            return "CONFLICT";
        };
        let workflow: Result<bool, _> = sqlx::query_scalar(
            "select exists (select 1 from projection.workflow_ref
                            where action_execution_id = $1 and kind = $2)",
        )
        .bind(action)
        .bind(KIND)
        .fetch_one(&mut *tx)
        .await;
        if !matches!(workflow, Ok(false)) {
            return "CONFLICT";
        }
    }
    // 不可逆销毁之前先确定能写出终态审计；主体不明的意图不 fence、不销毁，
    // 保持开放，由 overdue 度量告警。
    match orphan_subject(&mut tx, &frozen, kind).await {
        Ok(Some(_)) => {}
        Ok(None) => {
            tracing::warn!(intent = %intent_id, "孤儿密钥意图的原 operation 没有可用的审计主体");
            return "CONFLICT";
        }
        Err(_) => return "FAILED",
    }
    if sqlx::query(
        "update admission.server_key_provision_intent
         set fenced_at = coalesce(fenced_at, now())
         where id = $1 and finished_at is null",
    )
    .bind(intent_id)
    .execute(&mut *tx)
    .await
    .is_err()
        || tx.commit().await.is_err()
    {
        return "FAILED";
    }

    if kind != PlatformKey::Operator {
        // DELETING/DELETED 的 namespace 不得被补偿逻辑重新创建；其意图保留告警。
        if ensure_tenant_namespace(stores.pool, stores.secrets, frozen.tenant_id)
            .await
            .is_err()
        {
            tracing::warn!(intent = %intent_id, "孤儿密钥的 Tenant OpenBao 策略未就绪");
            return "PENDING";
        }
    }
    // DD-70：没有启用的 audit device 时 OpenBao 不 fail closed；与归位副本销毁
    // （DD-85）同一前置，审计不可用只暂缓，意图保持 FENCED。
    if !stores.audit_ready().await {
        return "PENDING";
    }
    {
        let Ok(mut conn) = stores.pool.acquire().await else {
            return "FAILED";
        };
        if !matches!(referenced(&mut conn, &locator).await, Ok(false)) {
            return "CONFLICT";
        }
    }
    let destroyed = match (rehome, kind, frozen.action_execution_id) {
        (Some(rehome), PlatformKey::Human | PlatformKey::Control, _) => {
            stores
                .secrets
                .destroy_unbound_rehome_copy(frozen.tenant_id, rehome, &locator)
                .await
        }
        (None, PlatformKey::Human, Some(action)) => {
            stores
                .secrets
                .destroy_unbound_server_human_provision(frozen.tenant_id, action, &locator)
                .await
        }
        (_, PlatformKey::Human, None) => Err(SecretError::Refused),
        (None, kind, _) => {
            stores
                .secrets
                .destroy_unbound_platform_key(kind, frozen.tenant_id, &locator)
                .await
        }
        _ => Err(SecretError::Refused),
    };
    if let Err(error) = destroyed {
        tracing::warn!(intent = %intent_id, error = %error, "孤儿密钥版本 1 销毁未取得 metadata 证明");
        return "PENDING";
    }

    let mut tx = match stores.pool.begin().await {
        Ok(tx) => tx,
        Err(_) => return "FAILED",
    };
    let still = match lock_frozen(&mut tx, &snapshot).await {
        Ok(Some(still)) if still.fenced && !still.finished && !still.destroyed => still,
        Ok(_) => return "CONFLICT",
        Err(_) => return "FAILED",
    };
    if !matches!(referenced(&mut tx, &locator).await, Ok(false)) {
        return "CONFLICT";
    }
    let subject = match orphan_subject(&mut tx, &still, kind).await {
        Ok(Some(subject)) => subject,
        Ok(None) => return "CONFLICT",
        Err(_) => return "FAILED",
    };
    let changed = sqlx::query(
        "update admission.server_key_provision_intent
         set destroyed_at = now(), finished_at = now()
         where id = $1 and fenced_at is not null
           and finished_at is null and destroyed_at is null",
    )
    .bind(intent_id)
    .execute(&mut *tx)
    .await;
    if !matches!(changed, Ok(ref result) if result.rows_affected() == 1) {
        return "FAILED";
    }
    // 托管身份建钥动作只为这把 key 存在，以确定冲突终结；成员投影与 Tenant 建立
    // 的动作由其原生命周期权威决定（DD-86）。
    if let (None, PlatformKey::Human, None, Some(action)) = (
        rehome,
        kind,
        still.source_membership_scope.as_deref(),
        still.action_execution_id,
    ) {
        let aborted = sqlx::query(
            "update admission.action_execution
             set dispatch_state = 'ABORTED', reason_code = 'TARGET_STATE_CONFLICT',
                 updated_at = now()
             where id = $1 and gate_state = 'ALLOWED' and dispatch_state = 'UNKNOWN'",
        )
        .bind(action)
        .execute(&mut *tx)
        .await;
        if !matches!(aborted, Ok(ref result) if result.rows_affected() == 1) {
            return "FAILED";
        }
    }
    let (event_key, evidence) = match (rehome, kind, still.action_execution_id) {
        (Some(rehome), _, _) => (
            format!("{}:rehome-copy-destroyed:{intent_id}", subject.operation_id),
            vec![Evidence::new(EvidenceKind::SecretRefRehomeId, rehome)],
        ),
        (None, PlatformKey::Human, Some(action)) => (
            format!("{}:server-human-orphan-destroyed", subject.operation_id),
            vec![Evidence::new(EvidenceKind::ActionExecutionId, action)],
        ),
        (None, PlatformKey::Control, Some(action)) => (
            format!(
                "{}:control-orphan-destroyed:{intent_id}",
                subject.operation_id
            ),
            vec![Evidence::new(EvidenceKind::ActionExecutionId, action)],
        ),
        _ => (
            format!(
                "{}:operator-orphan-destroyed:{intent_id}",
                subject.operation_id
            ),
            Vec::new(),
        ),
    };
    if subject
        .append(&mut tx, event_key, still.tenant_id, "DESTROYED", evidence)
        .await
        .is_err()
    {
        return "FAILED";
    }
    if tx.commit().await.is_err() {
        return "FAILED";
    }
    "CONVERGED"
}

/// DD-113 (2)：同一 operation 重试时的已冻结意图。版本 1 可读且派生 pubkey 等于
/// 期望值就续用（返回 true）；否则调用方按 DD-86 fence 后销毁，绝不另写。
pub(crate) async fn frozen_write_matches(
    state: &ServiceState,
    locator: &str,
    audience: &str,
    pubkey: &str,
) -> Result<bool, SecretError> {
    match state.secrets.observed_version(locator).await? {
        0 => Ok(false),
        1 => {
            let reference = secret_store::SecretRef {
                locator: locator.to_owned(),
                version: 1,
                audience: audience.to_owned(),
            };
            match crate::server_identity::read_bound_keys(&state.secrets, &reference, pubkey).await
            {
                Ok(_) => Ok(true),
                // 版本 1 存在却不是一把派生为该 pubkey 的私钥（fence 标记、已删除或
                // 已销毁、不可解析、pubkey 不符）：不能续用，交给 fence 与销毁。
                Err(
                    BoundKeyError::InvalidKey
                    | BoundKeyError::PubkeyMismatch
                    | BoundKeyError::Secret(SecretError::VersionUnavailable),
                ) => Ok(false),
                Err(BoundKeyError::Secret(error)) => Err(error),
            }
        }
        _ => Ok(false),
    }
}

/// DD-115 (2)：使 key 到期的同一事务里，把使其到期的 operation 冻结到 BOUND 意图的
/// `retire_operation_id`（已冻结的保持原值，重试不改写归属）。返回 false 表示该
/// locator 没有可退役的 BOUND 意图。
pub(crate) async fn freeze_retirement(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    locator: &str,
    operation: Uuid,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query(
        "update admission.server_key_provision_intent
         set retire_operation_id = coalesce(retire_operation_id, $2)
         where target_locator = $1 and finished_at is not null
           and fenced_at is null and destroyed_at is null and retired_at is null",
    )
    .bind(locator)
    .bind(operation)
    .execute(&mut **tx)
    .await?
    .rows_affected()
        == 1)
}

/// 退役的结论。`NotDue`/`NotExclusive` 不是故障：前者等待到期事实，后者是未归位的
/// 存量引用，二者都保持原状并由退役度量告警。
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Retirement {
    Retired,
    NotDue,
    NotExclusive,
    Pending,
}

#[derive(sqlx::FromRow)]
struct RetiringIntent {
    id: Uuid,
    retire_operation_id: Option<Uuid>,
    retired: bool,
}

/// 退役审计的主体：使 key 到期的 operation。operator 轮换与遗留补建没有
/// ActionExecution；HUMAN 取该 operation 的动作，并按动作目标是否为成员关系选
/// 入口声明的分类（`audit_class`）。
async fn retire_subject(
    conn: &mut sqlx::PgConnection,
    kind: PlatformKey,
    tenant_id: Uuid,
    locator: &str,
    operation: Uuid,
) -> Result<Option<Subject>, sqlx::Error> {
    if kind == PlatformKey::Operator {
        return Ok(Some(Subject::operator(operation, tenant_id, locator)));
    }
    let action: Option<Uuid> = sqlx::query_scalar(
        "select id from admission.action_execution where operation_id = $1 and tenant_id = $2
         order by created_at, id limit 1",
    )
    .bind(operation)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await?;
    let Some(action) = action else {
        return Ok(None);
    };
    let context = action_audit_context(&mut *conn, action, tenant_id).await?;
    let scope: Option<String> = sqlx::query_scalar(
        "select case
                  when exists (select 1 from identity.tenant_membership where id = $1) then 'TENANT'
                  when exists (select 1 from identity.workspace_membership where id = $1)
                  then 'WORKSPACE' end",
    )
    .bind(context.target_id)
    .fetch_one(&mut *conn)
    .await?;
    Ok(Subject::from_action(context, kind, scope.as_deref()))
}

/// DD-113 (3)(4) / DD-115 (2)(3)：BOUND → RETIRED。调用方已确认到期事实（HUMAN
/// binding `REVOKED`；operator 旧 key 已被 Relay 拒绝或为遗留补建），且
/// `retire_operation_id` 已冻结。HUMAN 先 `delete` 再 `destroy`（均按 metadata
/// 查证），operator 直接 `destroy`；查证后同事务记 RETIRED、HUMAN 引用转 REVOKED，
/// 审计追加到退役 operation。任何一步不明都保持原状，重试或对账器补做。
pub(crate) async fn retire_bound_key(
    stores: &Stores<'_>,
    kind: PlatformKey,
    tenant_id: Uuid,
    locator: &str,
) -> Result<Retirement, sqlx::Error> {
    let row: Option<RetiringIntent> = sqlx::query_as(
        "select id, retire_operation_id, retired_at is not null as retired
         from admission.server_key_provision_intent
         where target_locator = $1 and key_kind = $2 and tenant_id = $3
           and finished_at is not null and fenced_at is null and destroyed_at is null",
    )
    .bind(locator)
    .bind(key_kind(kind))
    .bind(tenant_id)
    .fetch_optional(stores.pool)
    .await?;
    let Some(row) = row else {
        return Ok(Retirement::NotDue);
    };
    if row.retired {
        return Ok(Retirement::Retired);
    }
    let Some(operation) = row.retire_operation_id else {
        return Ok(Retirement::NotDue);
    };
    if !stores.secrets.owns_platform_key(kind, tenant_id, locator) {
        tracing::error!(
            locator_kind = key_kind(kind),
            "退役的私钥引用不是独占 locator，须先按 DD-85 归位"
        );
        return Ok(Retirement::NotExclusive);
    }
    let referenced: bool = sqlx::query_scalar(
        "select exists (select 1 from identity.buzz_identity_binding
                        where private_key_secret_ref = $1 and state <> 'REVOKED')
             or exists (select 1 from identity.relay_operator_identity
                        where private_key_secret_ref = $1)",
    )
    .bind(locator)
    .fetch_one(stores.pool)
    .await?;
    if referenced {
        tracing::warn!(
            locator_kind = key_kind(kind),
            "退役私钥仍被在用 binding 或 identity 引用，保持原状态"
        );
        return Ok(Retirement::Pending);
    }
    if !stores.audit_ready().await {
        return Ok(Retirement::Pending);
    }
    if kind != PlatformKey::Operator {
        // 早于 DD-113 的 Tenant namespace 策略没有 delete/destroy 能力；先收敛策略。
        if let Err(e) = ensure_tenant_namespace(stores.pool, stores.secrets, tenant_id).await {
            tracing::warn!(error = %e, "退役的 Tenant OpenBao 策略未就绪");
            return Ok(Retirement::Pending);
        }
    }
    if kind == PlatformKey::Human {
        if let Err(e) = stores
            .secrets
            .delete_bound_version_one(kind, tenant_id, locator)
            .await
        {
            tracing::warn!(error = %e, "退役版本的 delete 未取得 metadata 证明");
            return Ok(Retirement::Pending);
        }
    }
    if let Err(e) = stores
        .secrets
        .retire_bound_version_one(kind, tenant_id, locator)
        .await
    {
        tracing::warn!(error = %e, "退役版本的 destroy 未取得 metadata 证明");
        return Ok(Retirement::Pending);
    }

    let mut tx = stores.pool.begin().await?;
    let locked: Option<bool> = sqlx::query_scalar(
        "select retired_at is not null from admission.server_key_provision_intent
         where id = $1 and retire_operation_id = $2 for update",
    )
    .bind(row.id)
    .bind(operation)
    .fetch_optional(&mut *tx)
    .await?;
    match locked {
        Some(true) => return Ok(Retirement::Retired),
        Some(false) => {}
        None => return Ok(Retirement::Pending),
    }
    if kind == PlatformKey::Human {
        let revoked = sqlx::query(
            "update identity.buzz_identity_binding set private_key_secret_status = 'REVOKED'
             where private_key_secret_ref = $1 and tenant_id = $2 and state = 'REVOKED'
               and private_key_secret_status in ('SUPERSEDED', 'REVOKED')",
        )
        .bind(locator)
        .bind(tenant_id)
        .execute(&mut *tx)
        .await?;
        if revoked.rows_affected() != 1 {
            return Ok(Retirement::Pending);
        }
    }
    sqlx::query(
        "update admission.server_key_provision_intent set retired_at = now() where id = $1",
    )
    .bind(row.id)
    .execute(&mut *tx)
    .await?;
    let Some(subject) = retire_subject(&mut tx, kind, tenant_id, locator, operation).await? else {
        tracing::warn!(%operation, "退役 operation 没有可用的审计主体");
        return Ok(Retirement::Pending);
    };
    subject
        .append(
            &mut tx,
            format!("{operation}:platform-key-retired:{}", row.id),
            tenant_id,
            "RETIRED",
            Vec::new(),
        )
        .await?;
    tx.commit().await?;
    Ok(Retirement::Retired)
}

/// DD-115 (3)：对账器补做 HUMAN 退役——binding 已 `REVOKED`、意图 BOUND、
/// `retire_operation_id` 已冻结。
pub(crate) async fn reconcile_retirement(state: &ServiceState, intent_id: Uuid) -> &'static str {
    let row: Result<Option<(Uuid, String)>, _> = sqlx::query_as(
        "select i.tenant_id, i.target_locator from admission.server_key_provision_intent i
         join identity.buzz_identity_binding b
           on b.private_key_secret_ref = i.target_locator and b.tenant_id = i.tenant_id
         where i.id = $1 and i.key_kind = 'HUMAN' and b.state = 'REVOKED'
           and i.retire_operation_id is not null and i.retired_at is null",
    )
    .bind(intent_id)
    .fetch_optional(&state.pool)
    .await;
    let Ok(Some((tenant_id, locator))) = row else {
        return "GONE";
    };
    match retire_bound_key(&Stores::of(state), PlatformKey::Human, tenant_id, &locator).await {
        Ok(Retirement::Retired) => "RETIRED",
        Ok(Retirement::NotExclusive) => "CONFLICT",
        Ok(_) => "PENDING",
        Err(e) => {
            tracing::warn!(error = %e, "退役补做失败");
            "FAILED"
        }
    }
}

/// DD-115 (6)：只读列出 operator 私钥前缀下的 locator。既非在用 identity 引用、也
/// 没有意图行的，补建 BACKFILLED 且已到期退役的意图（退役 operation 为本轮对账），
/// 随后按退役规则销毁并查证；已有 BACKFILLED 退役意图尚未查证时沿其原 operation
/// 补做，不因意图已登记而跳过。PROVISIONED 的轮换退役仍由引导先查证 Relay 拒绝。
/// 版本大于 1、仍被引用或不可判定的保持并告警。
pub(crate) async fn retire_unrecorded_operator_keys(
    state: &ServiceState,
    catalog: Uuid,
    operation: Uuid,
) -> Result<Vec<&'static str>, String> {
    let locators = state
        .secrets
        .list_operator_locators()
        .await
        .map_err(|e| e.to_string())?;
    let mut outcomes = Vec::new();
    for locator in locators {
        let (recorded, retry): (bool, bool) = sqlx::query_as(
            "select exists (select 1 from identity.relay_operator_identity
                            where private_key_secret_ref = $1)
                 or exists (select 1 from identity.buzz_identity_binding
                            where private_key_secret_ref = $1 and state <> 'REVOKED')
                 or exists (select 1 from admission.server_key_provision_intent
                            where target_locator = $1),
                    exists (select 1 from admission.server_key_provision_intent
                            where target_locator = $1 and tenant_id = $2
                              and key_kind = 'OPERATOR' and origin = 'BACKFILLED'
                              and finished_at is not null and fenced_at is null
                              and destroyed_at is null and retired_at is null
                              and retire_operation_id is not null)",
        )
        .bind(&locator)
        .bind(catalog)
        .fetch_one(&state.pool)
        .await
        .map_err(|e| e.to_string())?;
        if recorded && !retry {
            continue;
        }
        if !retry {
            // 未登记的 locator 先只读查证版本 1，随后冻结意图；已登记的补做仍由
            // retire_bound_key 查证，且不覆盖首次冻结的退役 operation。
            if let Err(e) = state
                .secrets
                .bound_version_one_destroyed(PlatformKey::Operator, catalog, &locator)
                .await
            {
                tracing::warn!(error = %e, locator, "遗留 operator locator 不是可判定的独占版本 1，保持");
                outcomes.push("PENDING");
                continue;
            }
            let inserted = sqlx::query(
                "insert into admission.server_key_provision_intent
                     (key_kind, origin, tenant_id, principal_id, target_locator, finished_at,
                      retire_operation_id)
                 values ('OPERATOR', 'BACKFILLED', $1, null, $2, now(), $3)
                 on conflict (target_locator) do nothing",
            )
            .bind(catalog)
            .bind(&locator)
            .bind(operation)
            .execute(&state.pool)
            .await
            .map_err(|e| e.to_string())?;
            if inserted.rows_affected() == 0 {
                // 另一条写入链先冻结了该 locator，不用本轮观察替它决定退役。
                continue;
            }
        }
        outcomes.push(
            match retire_bound_key(&Stores::of(state), PlatformKey::Operator, catalog, &locator)
                .await
            {
                Ok(Retirement::Retired) => "RETIRED",
                Ok(Retirement::NotExclusive) => "CONFLICT",
                Ok(_) => {
                    tracing::warn!(locator, "遗留 operator locator 无法按 metadata 判定，保持");
                    "PENDING"
                }
                Err(e) => {
                    tracing::warn!(error = %e, "遗留 operator locator 退役失败");
                    "FAILED"
                }
            },
        );
    }
    Ok(outcomes)
}

const CONTROL_PREFIX: &str = "buzz-control/";

/// DD-113 (1)(2)：CONTROL 私钥的写入。每把 key 独占由其 pubkey 派生的 locator、
/// 只写版本 1；写入前以发起 Tenant 建立的 operation 冻结意图，binding 与意图的
/// BOUND 同事务提交。同一 operation 重试时先处理已冻结的意图：版本 1 可读且派生
/// pubkey 与 locator 一致就续用，不生成新 key；否则按 DD-86 fence 后销毁，再为
/// 本 operation 冻结新 key。另一 operation 遗留的未完成意图不在这里处置（由治理
/// 对账器收敛），此时 503 让本次 Activity 重试。
pub(crate) async fn ensure_control_identity(
    state: &ServiceState,
    tenant_id: Uuid,
    tenant_version: i32,
) -> Result<(Uuid, String), Response> {
    let existing: Option<(Uuid, String)> = sqlx::query_as(
        "select principal_id, pubkey from identity.buzz_identity_binding
         where tenant_id = $1 and kind = 'CONTROL' and state <> 'REVOKED'",
    )
    .bind(tenant_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(unavailable)?;
    if let Some(existing) = existing {
        return Ok(existing);
    }
    let workflow_id = crate::component_task::workflow_id(
        "TENANT_LIFECYCLE",
        tenant_id,
        &tenant_id.to_string(),
        tenant_version,
    );
    let (operation, action): (Uuid, Uuid) = sqlx::query_as(
        "select operation_id, action_execution_id from projection.workflow_ref
         where workflow_id = $1 and tenant_id = $2 and kind = 'TENANT_LIFECYCLE'",
    )
    .bind(&workflow_id)
    .bind(tenant_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(unavailable)?
    .ok_or_else(|| {
        tracing::warn!(%tenant_id, "Tenant 建立的 WorkflowRef 缺失，不写 CONTROL 私钥");
        StatusCode::SERVICE_UNAVAILABLE.into_response()
    })?;

    // 至多两轮：已冻结意图不可续用时，fence 并销毁后为本 operation 冻结新 key。
    for _ in 0..2 {
        let open: Option<Intent> = sqlx::query_as(&format!(
            "select {INTENT_COLUMNS} from admission.server_key_provision_intent
             where tenant_id = $1 and key_kind = 'CONTROL' and finished_at is null"
        ))
        .bind(tenant_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(unavailable)?;
        let intent = match open {
            Some(intent) if intent.operation_id != Some(operation) => {
                tracing::warn!(%tenant_id, intent = %intent.id,
                    "另一 operation 的 CONTROL 写入意图未收敛，等待对账器处置");
                return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
            }
            Some(intent) => intent,
            None => freeze_control_intent(state, tenant_id, operation, action).await?,
        };
        let Some(pubkey) = intent
            .target_locator
            .rsplit_once(CONTROL_PREFIX)
            .map(|(_, pubkey)| pubkey.to_owned())
        else {
            return Err(StatusCode::CONFLICT.into_response());
        };
        if !intent.fenced {
            match frozen_write_matches(
                state,
                &intent.target_locator,
                &state.secret_audience,
                &pubkey,
            )
            .await
            {
                Ok(true) => return bind_control(state, &intent, &pubkey).await,
                Ok(false) => {}
                Err(e) => {
                    tracing::warn!(error = %e, "CONTROL 写入意图的版本 1 不可查证");
                    return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
                }
            }
        }
        match fence_and_destroy_intent(state, intent.id).await {
            "CONVERGED" => continue,
            step => {
                tracing::warn!(step, intent = %intent.id, "CONTROL 孤儿写入未收敛");
                return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
            }
        }
    }
    Err(StatusCode::SERVICE_UNAVAILABLE.into_response())
}

/// 冻结意图（与 CONTROL Principal 同事务）后才写入 key。写入回应不明时不在这里
/// 判定：下一次重试按已冻结的 locator 查证。
async fn freeze_control_intent(
    state: &ServiceState,
    tenant_id: Uuid,
    operation: Uuid,
    action: Uuid,
) -> Result<Intent, Response> {
    let keys = nostr::Keys::generate();
    let pubkey = keys.public_key().to_hex();
    let locator = state
        .secrets
        .tenant_locator(tenant_id, &format!("{CONTROL_PREFIX}{pubkey}"));
    let principal = Uuid::new_v4();
    let mut tx = state.pool.begin().await.map_err(unavailable)?;
    sqlx::query(
        "insert into identity.principal (id, tenant_id, kind, status)
         values ($1, $2, 'SERVICE', 'ACTIVE')",
    )
    .bind(principal)
    .bind(tenant_id)
    .execute(&mut *tx)
    .await
    .map_err(unavailable)?;
    let intent: Intent = match sqlx::query_as(&format!(
        "insert into admission.server_key_provision_intent
             (key_kind, origin, operation_id, action_execution_id, tenant_id, principal_id,
              target_locator)
         values ('CONTROL', 'PROVISIONED', $1, $2, $3, $4, $5)
         returning {INTENT_COLUMNS}"
    ))
    .bind(operation)
    .bind(action)
    .bind(tenant_id)
    .bind(principal)
    .bind(&locator)
    .fetch_one(&mut *tx)
    .await
    {
        Ok(intent) => intent,
        Err(sqlx::Error::Database(e)) if e.is_unique_violation() => {
            tracing::warn!(%tenant_id, "另一条 CONTROL 写入意图已先冻结");
            return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
        }
        Err(e) => return Err(unavailable(e)),
    };
    tx.commit().await.map_err(unavailable)?;
    match state
        .secrets
        .write_once(&locator, "value", &keys.secret_key().to_secret_hex())
        .await
    {
        Ok(1) => Ok(intent),
        other => {
            tracing::warn!(result = ?other.map_err(|e| e.to_string()),
                "CONTROL 私钥写入结果不明，下一次重试只查证冻结的 locator");
            Err(StatusCode::SERVICE_UNAVAILABLE.into_response())
        }
    }
}

/// binding 与意图的 BOUND 同事务；意图已被 fence 时 binding 不能提交。
async fn bind_control(
    state: &ServiceState,
    intent: &Intent,
    pubkey: &str,
) -> Result<(Uuid, String), Response> {
    let Some(principal) = intent.principal_id else {
        return Err(StatusCode::CONFLICT.into_response());
    };
    let mut tx = state.pool.begin().await.map_err(unavailable)?;
    let still_open: Option<i32> = sqlx::query_scalar(
        "select 1 from admission.server_key_provision_intent
         where id = $1 and finished_at is null and fenced_at is null for update",
    )
    .bind(intent.id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(unavailable)?;
    if still_open.is_none() {
        return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
    }
    let inserted = sqlx::query(
        "insert into identity.buzz_identity_binding
             (tenant_id, principal_id, pubkey, custody, private_key_secret_ref,
              private_key_secret_version, private_key_secret_audience,
              private_key_secret_status, kind, state)
         values ($1, $2, $3, 'SERVER', $4, 1, $5, 'PENDING', 'CONTROL', 'RECONCILING')",
    )
    .bind(intent.tenant_id)
    .bind(principal)
    .bind(pubkey)
    .bind(&intent.target_locator)
    .bind(&state.secret_audience)
    .execute(&mut *tx)
    .await;
    match inserted {
        Ok(_) => {}
        Err(sqlx::Error::Database(e)) if e.is_unique_violation() => {
            return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
        }
        Err(e) => return Err(unavailable(e)),
    }
    let finished = sqlx::query(
        "update admission.server_key_provision_intent set finished_at = now()
         where id = $1 and finished_at is null and fenced_at is null",
    )
    .bind(intent.id)
    .execute(&mut *tx)
    .await
    .map_err(unavailable)?;
    if finished.rows_affected() != 1 {
        return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
    }
    tx.commit().await.map_err(unavailable)?;
    Ok((principal, pubkey.to_owned()))
}

/// DD-113 (2)：治理对账器对 CONTROL 与 OPERATOR 未完成意图的判定。发起的
/// operation 已终态而意图仍未绑定时隔离（fence）后按 DD-86 销毁；operation 仍在
/// 进行时不动，由原入口的重试续用或处置。
///
/// - CONTROL：Tenant 建立的 WorkflowRef 已 TERMINAL、其 ActionExecution 不再 ALLOWED，
///   或另一条非 REVOKED 的 CONTROL binding 已胜出。
/// - OPERATOR：冻结时的 `commit_deadline_at` 已过（DD-115 (4)）：绑定只在截止前
///   提交，过期未绑定的引导已确定不会再提交。
pub(crate) async fn reconcile_platform_key_intent(
    state: &ServiceState,
    intent_id: Uuid,
) -> &'static str {
    let frozen = {
        let Ok(mut conn) = state.pool.acquire().await else {
            return "FAILED";
        };
        match intent(&mut conn, intent_id, false).await {
            Ok(Some(row)) => row,
            Ok(None) => return "GONE",
            Err(error) => {
                tracing::warn!(intent = %intent_id, error = %error, "读取写入意图失败");
                return "FAILED";
            }
        }
    };
    if frozen.finished {
        return "CONVERGED";
    }
    if frozen.fenced {
        return fence_and_destroy_intent(state, intent_id).await;
    }
    let terminal = match parse_kind(&frozen.key_kind) {
        Some(PlatformKey::Control) => {
            let Some(action) = frozen.action_execution_id else {
                return "CONFLICT";
            };
            sqlx::query_scalar::<_, bool>(
                "select exists (
                     select 1 from identity.buzz_identity_binding b
                     where b.tenant_id = $1 and b.kind = 'CONTROL' and b.state <> 'REVOKED'
                       and b.private_key_secret_ref <> $3)
                 or exists (
                     select 1 from admission.action_execution ae
                     where ae.id = $2 and ae.gate_state <> 'ALLOWED')
                 or exists (
                     select 1 from projection.workflow_ref w
                     where w.action_execution_id = $2 and w.kind = 'TENANT_LIFECYCLE'
                       and w.projection_state = 'TERMINAL')",
            )
            .bind(frozen.tenant_id)
            .bind(action)
            .bind(&frozen.target_locator)
            .fetch_one(&state.pool)
            .await
        }
        Some(PlatformKey::Operator) => Ok(frozen.deadline_passed),
        _ => return "CONFLICT",
    };
    match terminal {
        Ok(true) => fence_and_destroy_intent(state, intent_id).await,
        Ok(false) => "PENDING",
        Err(error) => {
            tracing::warn!(intent = %intent_id, error = %error, "判定写入意图的 operation 终态失败");
            "FAILED"
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context(action_key: &str, defined: bool) -> ActionAuditContext {
        let id = Uuid::nil();
        ActionAuditContext {
            operation_id: id,
            workspace_id: None,
            initiator_principal_id: id,
            actor_principal_id: id,
            target_id: id,
            parameter_hash: String::new(),
            correlation_id: id,
            action_version: 1,
            action_key: action_key.to_owned(),
            component_type_key: defined.then(|| "defined".to_owned()),
            target_type: defined.then(|| "DEFINED".to_owned()),
            result_exposure: defined.then(|| "SUMMARY".to_owned()),
        }
    }

    fn triple(class: Option<AuditClass<'_>>) -> Option<(String, String, String)> {
        class.map(|c| {
            (
                c.component_type_key.to_owned(),
                c.target_type.to_owned(),
                c.result_exposure.to_owned(),
            )
        })
    }

    /// 托管身份建钥、撤钥与 Tenant 建立的引导动作没有 ActionDefinition（入口自声明
    /// 分类）；终态审计不能因此永远写不出去，使已销毁的意图停在 FENCED。
    #[test]
    fn audit_uses_entry_class_without_definition() {
        for key in [HUMAN_PROVISION, HUMAN_REVOKE] {
            assert_eq!(
                triple(audit_class(&context(key, false), PlatformKey::Human, None)),
                Some(("buzz".into(), "PRINCIPAL".into(), "NONE".into()))
            );
        }
        assert_eq!(
            triple(audit_class(
                &context("tenant.bootstrap", false),
                PlatformKey::Human,
                Some("WORKSPACE")
            )),
            Some(("core".into(), "WORKSPACE_MEMBERSHIP".into(), "NONE".into()))
        );
        assert_eq!(
            triple(audit_class(
                &context("tenant.bootstrap", false),
                PlatformKey::Control,
                None
            )),
            Some(("core".into(), "TENANT".into(), "NONE".into()))
        );
        assert_eq!(
            triple(audit_class(
                &context("tenant.member.invite", true),
                PlatformKey::Human,
                Some("TENANT")
            )),
            Some(("defined".into(), "DEFINED".into(), "SUMMARY".into()))
        );
    }

    #[test]
    fn audit_refuses_unknown_entry() {
        assert!(audit_class(&context("verify.other", false), PlatformKey::Human, None).is_none());
        assert!(audit_class(
            &context(HUMAN_PROVISION, false),
            PlatformKey::Human,
            Some("OTHER")
        )
        .is_none());
        assert!(audit_class(
            &context("tenant.bootstrap", false),
            PlatformKey::Operator,
            None
        )
        .is_none());
        let mut partial = context(HUMAN_PROVISION, true);
        partial.target_type = None;
        assert!(audit_class(&partial, PlatformKey::Human, None).is_none());
    }
}
