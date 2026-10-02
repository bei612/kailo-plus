//! DD-13/37/70/71、03 §3/8、09 §1、12 §1：受治理模型投影的实际取用。
//! Gateway 保有配置正文；Core 只保存版本/摘要与 Installation 专属 SecretRef。

use contracts::ReasonCode;
use secret_store::{SecretRef, SecretValue};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::FromRow;
use uuid::Uuid;

use crate::{
    governance::Refusal,
    service_api::ServiceState,
    spicedb::{Consistency, Relationship, Write},
};

/// SecretRef 只传 Core 内部，不能序列化到客户端、Workflow 或配置文件。
pub(crate) struct RuntimeModel {
    pub model: String,
    pub gateway_base_url: String,
    pub secret_ref: SecretRef,
}

/// DD-99：现有 TenantLifecycleSnapshot 的平台库存；这里只保存引用，不保存 key/config 正文。
#[derive(Clone, PartialEq, serde::Serialize, serde::Deserialize, FromRow)]
pub(crate) struct FrozenCredential {
    pub installation_resource_id: Uuid,
    pub projection_generation: i64,
    pub workspace_id: Uuid,
    pub agent_principal_id: Uuid,
    pub action_execution_id: Uuid,
    pub gateway_principal_id: Uuid,
    pub secret_locator: String,
    pub secret_version: Option<i32>,
    pub secret_audience: String,
    pub secret_status: String,
    pub native_dispatch_started: bool,
    pub native_key_id: Option<String>,
    pub native_key_revision: Option<i64>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct FrozenRoute {
    pub resource_id: Uuid,
    pub native_id: String,
    pub resource_version: i32,
    pub native_revision: i64,
    pub native_config_hash: String,
    pub credentials: Vec<FrozenCredential>,
}

/// 与已有 Tenant 销毁库存同一快照调用；该函数不激活类型或创建 Resource。
pub(crate) async fn freeze(
    conn: &mut sqlx::PgConnection,
    tenant: Uuid,
) -> Result<Vec<FrozenRoute>, sqlx::Error> {
    let orphaned: bool = sqlx::query_scalar("select exists(select 1 from catalog.agent_model_binding b
        left join catalog.agent_installation i on i.resource_id=b.installation_resource_id
        left join catalog.resource ir on ir.id=b.installation_resource_id
        left join catalog.model_route m on m.resource_id=b.model_route_resource_id
        left join catalog.resource mr on mr.id=m.resource_id
        where (ir.tenant_id=$1 or mr.tenant_id=$1)
          and (i.resource_id is null or m.resource_id is null or mr.tenant_id is distinct from ir.tenant_id))")
        .bind(tenant).fetch_one(&mut *conn).await?;
    if orphaned {
        return Err(sqlx::Error::Protocol("模型凭据库存归属不完整".into()));
    }
    let routes: Vec<(Uuid, String, i32, i64, String)> = sqlx::query_as(
        "select r.id,r.native_id,r.version,m.native_revision,m.native_config_hash
         from catalog.resource r join catalog.model_route m on m.resource_id=r.id
         where r.tenant_id=$1 and r.type_key='llm_route' order by r.id for update of r,m",
    )
    .bind(tenant)
    .fetch_all(&mut *conn)
    .await?;
    let mut frozen = Vec::with_capacity(routes.len());
    for (resource_id, native_id, resource_version, native_revision, native_config_hash) in routes {
        let credentials = sqlx::query_as(FROZEN_CREDENTIALS)
            .bind(resource_id)
            .fetch_all(&mut *conn)
            .await?;
        frozen.push(FrozenRoute {
            resource_id,
            native_id,
            resource_version,
            native_revision,
            native_config_hash,
            credentials,
        });
    }
    Ok(frozen)
}

const FROZEN_CREDENTIALS: &str = "select b.installation_resource_id,b.projection_generation,
    i.workspace_id,i.agent_principal_id,b.action_execution_id,b.gateway_principal_id,b.secret_locator,b.secret_version,
    b.secret_audience,b.secret_status,b.native_dispatch_started,b.native_key_id,b.native_key_revision
    from catalog.agent_model_binding b join catalog.agent_installation i on i.resource_id=b.installation_resource_id
    where b.model_route_resource_id=$1 order by b.installation_resource_id,b.projection_generation for update of b";

#[derive(serde::Serialize)]
pub(crate) struct NativeAbsence {
    pub kind: String,
    pub id: String,
    pub revision: i64,
    pub absent: bool,
}

/// 原 TENANT_LIFECYCLE drain 之后消费 frozen 库存；返回的只有已查证不存在的 native ID。
/// SecretRef 先 SUPERSEDED，真正销毁/REVOKED 仍由原 Tenant OpenBao namespace 删除证据决定。
pub(crate) async fn retire(
    state: &ServiceState,
    tenant: Uuid,
    route: &FrozenRoute,
) -> Result<Vec<NativeAbsence>, Refusal> {
    let exists: bool = sqlx::query_scalar(
        "select exists(select 1 from catalog.resource r
        join catalog.model_route m on m.resource_id=r.id
        join identity.tenant t on t.id=r.tenant_id where r.id=$1 and r.tenant_id=$2
          and r.type_key='llm_route' and r.native_id=$3 and r.version=$4
          and m.native_revision=$5 and m.native_config_hash=$6 and t.state='DELETING')",
    )
    .bind(route.resource_id)
    .bind(tenant)
    .bind(&route.native_id)
    .bind(route.resource_version)
    .bind(route.native_revision)
    .bind(&route.native_config_hash)
    .fetch_one(&state.pool)
    .await?;
    if !exists {
        return Err(conflict());
    }
    let current: Vec<FrozenCredential> = sqlx::query_as(FROZEN_CREDENTIALS)
        .bind(route.resource_id)
        .fetch_all(&state.pool)
        .await?;
    if current.len() != route.credentials.len() {
        return Err(conflict());
    }
    // Only SUPERSEDED and a previously unknown native response may advance during retirement.
    for (current, frozen) in current.iter().zip(&route.credentials) {
        if !matches!(
            current.secret_status.as_str(),
            "PENDING" | "ACTIVE" | "SUPERSEDED"
        ) {
            return Err(unavailable());
        }
        if current.secret_status != frozen.secret_status
            && !(matches!(frozen.secret_status.as_str(), "PENDING" | "ACTIVE")
                && current.secret_status == "SUPERSEDED")
        {
            return Err(conflict());
        }
        let mut current = current.clone();
        let frozen = frozen.clone();
        current.secret_status.clone_from(&frozen.secret_status);
        if frozen.native_dispatch_started
            && frozen.native_key_id.is_none()
            && current.native_key_id.is_some()
            && current.native_key_revision.is_some()
        {
            current.native_key_id = None;
            current.native_key_revision = None;
        }
        if current != frozen {
            return Err(conflict());
        }
    }
    let gateway = Gateway::from_env()?;
    let mut deleted = Vec::new();
    for credential in &current {
        let busy: bool = sqlx::query_scalar(
            "select exists(select 1 from catalog.agent_invocation
            where installation_resource_id=$1 and projection_generation=$2
              and status not in ('COMPLETED','FAILED','CANCELED'))",
        )
        .bind(credential.installation_resource_id)
        .bind(credential.projection_generation)
        .fetch_one(&state.pool)
        .await?;
        if busy {
            return Err(unavailable());
        }
        let secret = match credential.secret_version {
            Some(version) => {
                let expected = state.secrets.tenant_locator(
                    tenant,
                    &format!(
                        "llm-route/{}/{}/{}",
                        route.resource_id,
                        credential.installation_resource_id,
                        credential.projection_generation
                    ),
                );
                if expected != credential.secret_locator {
                    return Err(conflict());
                }
                let reference = SecretRef {
                    locator: expected,
                    version: u32::try_from(version).map_err(|_| unavailable())?,
                    audience: credential.secret_audience.clone(),
                };
                Some(
                    state
                        .secrets
                        .read(&reference, "value")
                        .await
                        .map_err(|_| unavailable())?,
                )
            }
            None if !credential.native_dispatch_started => None,
            None => return Err(unavailable()),
        };
        let desired = secret.as_ref().map(|secret| {
            key_projection(
                &route.native_id,
                tenant,
                credential.workspace_id,
                credential.agent_principal_id,
                credential.gateway_principal_id,
                (
                    credential.installation_resource_id,
                    credential.projection_generation,
                ),
                secret,
            )
        });
        let stored = if let Some(desired) = desired.as_ref() {
            gateway.find_key(desired).await?
        } else {
            gateway
                .require_key_absent(tenant, credential, None, None)
                .await?;
            None
        };
        if let Some((id, revision)) = stored {
            if credential
                .native_key_id
                .as_deref()
                .is_some_and(|frozen| frozen != id)
                || credential
                    .native_key_revision
                    .is_some_and(|frozen| frozen != revision)
            {
                return Err(conflict());
            }
            // Persist an observed response before deletion; replay must not lose a recovered random ID.
            sqlx::query(
                "update catalog.agent_model_binding set native_key_id=$3,native_key_revision=$4
                where installation_resource_id=$1 and projection_generation=$2
                  and native_dispatch_started and native_key_id is null",
            )
            .bind(credential.installation_resource_id)
            .bind(credential.projection_generation)
            .bind(&id)
            .bind(revision)
            .execute(&state.pool)
            .await?;
            gateway.delete("llm.apiKey", &id).await?;
            deleted.push(NativeAbsence {
                kind: "llm.apiKey".into(),
                id,
                revision,
                absent: true,
            });
        } else if let Some((id, revision)) = credential
            .native_key_id
            .clone()
            .zip(credential.native_key_revision)
        {
            deleted.push(NativeAbsence {
                kind: "llm.apiKey".into(),
                id,
                revision,
                absent: true,
            });
        }
        if let Some(desired) = desired.as_ref() {
            if gateway.find_key(desired).await?.is_some() {
                return Err(unavailable());
            }
        }
        gateway
            .require_key_absent(tenant, credential, desired.as_ref(), secret.as_ref())
            .await?;
        if let Some(secret) = secret.as_ref() {
            gateway.require_key_rejected(secret).await?;
        }
        sqlx::query("update catalog.agent_model_binding set secret_status='SUPERSEDED'
            where installation_resource_id=$1 and projection_generation=$2 and secret_status in ('PENDING','ACTIVE')")
            .bind(credential.installation_resource_id).bind(credential.projection_generation)
            .execute(&state.pool).await?;
    }
    let native = gateway.resources("llm.virtualModel").await?;
    let matches: Vec<_> = native
        .iter()
        .filter(|r| r.get("id").and_then(Value::as_str) == Some(route.native_id.as_str()))
        .collect();
    if matches.len() > 1 {
        return Err(unavailable());
    }
    if let Some(row) = matches.first() {
        if row.get("revision").and_then(Value::as_i64) != Some(route.native_revision)
            || digest(row.get("value").ok_or_else(unavailable)?)? != route.native_config_hash
        {
            return Err(conflict());
        }
        gateway.delete("llm.virtualModel", &route.native_id).await?;
    }
    if gateway
        .resources("llm.virtualModel")
        .await?
        .iter()
        .any(|r| r.get("id").and_then(Value::as_str) == Some(route.native_id.as_str()))
    {
        return Err(unavailable());
    }
    let effective = gateway.admin(&["api", "config", "effective"], None).await?;
    if effective
        .pointer("/llm/virtualModels")
        .is_some_and(|models| {
            models.as_array().is_none_or(|models| {
                models.iter().any(|r| {
                    r.get("name").and_then(Value::as_str) == Some(route.native_id.as_str())
                })
            })
        })
    {
        return Err(unavailable());
    }
    deleted.push(NativeAbsence {
        kind: "llm.virtualModel".into(),
        id: route.native_id.clone(),
        revision: route.native_revision,
        absent: true,
    });
    Ok(deleted)
}

#[derive(PartialEq, FromRow)]
struct Route {
    tenant_id: Uuid,
    owner_principal_id: Uuid,
    home_workspace_id: Option<Uuid>,
    native_id: String,
    resource_version: i32,
    native_revision: i64,
    native_config_hash: String,
}

#[derive(FromRow)]
struct Binding {
    gateway_principal_id: Uuid,
    secret_locator: String,
    secret_version: Option<i32>,
    secret_audience: String,
    secret_status: String,
    native_dispatch_started: bool,
    native_key_id: Option<String>,
    native_key_revision: Option<i64>,
}

fn unavailable() -> Refusal {
    Refusal::Unavailable("模型原生投影或凭据查证未闭合".into())
}

fn conflict() -> Refusal {
    Refusal::Conflict(ReasonCode::TargetStateConflict)
}

const ROUTE: &str = "select r.tenant_id,r.owner_principal_id,r.home_workspace_id,r.native_id,
    r.version as resource_version,m.native_revision,m.native_config_hash
    from catalog.resource r join catalog.model_route m on m.resource_id=r.id
    join catalog.resource_type_definition rt on rt.type_key=r.type_key and rt.status='ACTIVE'
      and rt.tenant_delete_action_key='tenant.delete'
    join identity.tenant t on t.id=r.tenant_id and t.state='ACTIVE'
    join identity.principal o on o.id=r.owner_principal_id and o.tenant_id=t.id
      and o.kind='HUMAN' and o.status='ACTIVE'
    join identity.tenant_membership om on om.tenant_principal_id=o.id
      and om.tenant_id=t.id and om.state='ACTIVE'
    where r.id=$1 and r.tenant_id=$2 and r.type_key='llm_route' and r.state='ACTIVE'
      and r.projection_action_execution_id is null";

/// 同一已有 Installation projection 的凭据生产；没有新 Action/Workflow 权威。
/// 外部 key 创建先写持久 intent。原生 ID 随机，回应丢失只按摘要/scope 查证，
/// 不重发 PUT；未找到确定结果就保持 PENDING，交原 projection 对账。
pub(crate) async fn provision(
    state: &ServiceState,
    installation: Uuid,
    version: Uuid,
    generation: i64,
    action: Uuid,
) -> Result<RuntimeModel, Refusal> {
    let (route_id, tenant, workspace, agent) =
        installation_scope(state, installation, version, generation, Some(action)).await?;
    // Tenant/Workspace 生命周期锁与下方真实 membership 锁共同覆盖外部授信。
    // NO KEY UPDATE 仍阻止状态修改，并允许内层 intent 的外键 KEY SHARE 检查。
    let mut lifecycle = state.pool.begin().await?;
    let active: bool = sqlx::query_scalar(
        "select state='ACTIVE' from identity.tenant where id=$1 for no key update",
    )
    .bind(tenant)
    .fetch_one(&mut *lifecycle)
    .await?;
    if !active {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let workspace_active: bool = sqlx::query_scalar(
        "select state='ACTIVE' from identity.workspace
        where id=$1 and tenant_id=$2 for no key update",
    )
    .bind(workspace)
    .bind(tenant)
    .fetch_one(&mut *lifecycle)
    .await?;
    if !workspace_active {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    installation_scope(state, installation, version, generation, Some(action)).await?;
    let (owner,initiator):(Uuid,Uuid)=sqlx::query_as("select r.owner_principal_id,ae.initiator_principal_id
        from catalog.resource r join admission.action_execution ae on ae.id=r.projection_action_execution_id
        where r.id=$1 and r.tenant_id=$2 and r.home_workspace_id=$3 and r.state='PROVISIONING'
          and ae.id=$4 and ae.tenant_id=r.tenant_id and ae.workspace_id=r.home_workspace_id
          and ae.target_id=r.id and ae.actor_principal_id=ae.initiator_principal_id
          and ae.gate_state='ALLOWED' and ae.dispatch_state='DISPATCHED'
          and ae.action_key='agent.installation.create'
        for no key update of r")
        .bind(installation).bind(tenant).bind(workspace).bind(action)
        .fetch_optional(&mut *lifecycle).await?.ok_or_else(conflict)?;
    let route: Route = sqlx::query_as(&format!("{ROUTE} for no key update of r,m"))
        .bind(route_id)
        .bind(tenant)
        .fetch_optional(&mut *lifecycle)
        .await?
        .ok_or(Refusal::Precondition(ReasonCode::BindingNotActive))?;
    let mut humans = vec![owner, initiator, route.owner_principal_id];
    humans.sort_unstable();
    humans.dedup();
    for human in humans {
        if !crate::agent_definition::active_owner(&mut lifecycle, tenant, human).await? {
            return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
        }
    }
    // 17 §6 的安装 Model binding，不是 Version 引用或 asset.consume 的隐式授权。
    // 原安装 AE 已持久冻结 scope/version/AGENT；发起 HUMAN 必须仍有执行与分享权。
    let human_route = checked_route(
        state,
        route_id,
        tenant,
        workspace,
        initiator,
        Consistency::FullyConsistent,
    )
    .await?;
    if human_route != route {
        return Err(conflict());
    }
    let shared = state
        .governance
        .spicedb
        .check(
            "resource",
            &route_id.to_string(),
            "share",
            &initiator.to_string(),
            Consistency::FullyConsistent,
        )
        .await
        .map_err(|_| unavailable())?;
    if shared.zed_token.is_empty() {
        return Err(unavailable());
    }
    if !shared.allowed {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    crate::service_api::audit_gate(state)
        .await
        .map_err(|_| unavailable())?;
    let written = state
        .governance
        .spicedb
        .write(&["executor", "discoverer"].map(|relation| {
            (
                Write::Touch,
                Relationship {
                    object_type: "resource".into(),
                    object_id: route_id.to_string(),
                    relation: relation.into(),
                    subject_principal: agent.to_string(),
                },
            )
        }))
        .await
        .map_err(|_| unavailable())?;
    if written.is_empty() {
        return Err(unavailable());
    }
    let bound_route = checked_route(
        state,
        route_id,
        tenant,
        workspace,
        agent,
        Consistency::AtLeastAsFresh(&written),
    )
    .await?;
    if bound_route != route {
        return Err(conflict());
    }
    let gateway = Gateway::from_env()?;
    gateway.check_route(&route).await?;
    gateway.check_authentication().await?;
    let audience = std::env::var("OPENBAO_SERVICE_IDENTITY")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(unavailable)?;
    let locator = state.secrets.tenant_locator(
        tenant,
        &format!("llm-route/{route_id}/{installation}/{generation}"),
    );
    let principal = Uuid::new_v5(&Uuid::NAMESPACE_OID, locator.as_bytes());
    let mut intent = state.pool.begin().await?;
    // Registered SERVICE identity is only the restricted gateway caller, never actor/owner.
    sqlx::query(
        "insert into identity.principal(id,tenant_id,kind,status)
        values($1,$2,'SERVICE','ACTIVE') on conflict do nothing",
    )
    .bind(principal)
    .bind(tenant)
    .execute(&mut *intent)
    .await?;
    sqlx::query(
        "insert into identity.service_principal(principal_id,audience)
        values($1,$1::text) on conflict do nothing",
    )
    .bind(principal)
    .execute(&mut *intent)
    .await?;
    sqlx::query(
        "insert into catalog.agent_model_binding
        (installation_resource_id,projection_generation,model_route_resource_id,
         action_execution_id,secret_locator,secret_audience,gateway_principal_id,secret_status)
        values($1,$2,$3,$4,$5,$6,$7,'PENDING') on conflict do nothing",
    )
    .bind(installation)
    .bind(generation)
    .bind(route_id)
    .bind(action)
    .bind(&locator)
    .bind(&audience)
    .bind(principal)
    .execute(&mut *intent)
    .await?;
    intent.commit().await?;
    let binding = binding(state, installation, generation, route_id, Some(action)).await?;
    if binding.secret_locator != locator
        || binding.secret_audience != audience
        || binding.gateway_principal_id != principal
    {
        return Err(conflict());
    }
    // 生命周期/投影的原生行锁与持久意图串行化同一 generation 的外部写入。
    let mut lock = state.pool.begin().await?;
    sqlx::query(
        "select installation_resource_id from catalog.agent_model_binding
        where installation_resource_id=$1 and projection_generation=$2 for update",
    )
    .bind(installation)
    .bind(generation)
    .fetch_one(&mut *lock)
    .await?;
    let binding = binding_tx(&mut lock, installation, generation, route_id, action).await?;
    if !matches!(binding.secret_status.as_str(), "PENDING" | "ACTIVE") {
        return Err(unavailable());
    }
    let secret = if let Some(version) = binding.secret_version {
        read_secret(state, &binding, version, &locator).await?
    } else {
        let reference = SecretRef {
            locator: locator.clone(),
            version: 1,
            audience: audience.clone(),
        };
        // 固定 locator 的一次 CAS 写；既有版本优先读回，崩溃不会换掉 credential。
        let value = match state.secrets.read(&reference, "value").await {
            Ok(value) => value,
            Err(secret_store::SecretError::VersionUnavailable) => {
                let mut bytes = vec![0; Sha256::output_size()];
                getrandom::fill(&mut bytes).map_err(|_| unavailable())?;
                let generated = hex::encode(bytes);
                let written = state
                    .secrets
                    .write_once(&locator, "value", &generated)
                    .await
                    .map_err(|_| unavailable())?;
                if written != 1 {
                    return Err(conflict());
                }
                state
                    .secrets
                    .read(&reference, "value")
                    .await
                    .map_err(|_| unavailable())?
            }
            Err(_) => return Err(unavailable()),
        };
        sqlx::query("update catalog.agent_model_binding set secret_version=1
            where installation_resource_id=$1 and projection_generation=$2 and secret_version is null")
            .bind(installation).bind(generation).execute(&mut *lock).await?;
        value
    };
    if secret.expose().is_empty() {
        return Err(unavailable());
    }
    let key = key_projection(
        &route.native_id,
        tenant,
        workspace,
        agent,
        binding.gateway_principal_id,
        (installation, generation),
        &secret,
    );
    let existing = gateway.find_key(&key).await?;
    if binding.native_key_id.is_some()
        && existing
            != binding
                .native_key_id
                .clone()
                .zip(binding.native_key_revision)
    {
        return Err(conflict());
    }
    if existing.is_none() && binding.native_dispatch_started {
        return Err(unavailable());
    }
    if existing.is_none() {
        // 提交后才跨外部边界；失败/超时均不撤掉已落的 dispatch fence。
        sqlx::query(
            "update catalog.agent_model_binding set native_dispatch_started=true
            where installation_resource_id=$1 and projection_generation=$2",
        )
        .bind(installation)
        .bind(generation)
        .execute(&mut *lock)
        .await?;
        lock.commit().await?;
        gateway.create_key(&key).await?;
    } else {
        lock.commit().await?;
    }
    let (id, revision) = gateway.find_key(&key).await?.ok_or_else(unavailable)?;
    // stored 配置成功仍不等于 runtime reload 成功；真实数据面以专属 key 查询模型。
    gateway.check_model(&route.native_id, &secret).await?;
    let fresh = checked_route(
        state,
        route_id,
        tenant,
        workspace,
        agent,
        Consistency::FullyConsistent,
    )
    .await?;
    if fresh.resource_version != route.resource_version
        || fresh.native_revision != route.native_revision
        || fresh.native_config_hash != route.native_config_hash
    {
        return Err(conflict());
    }
    installation_scope(state, installation, version, generation, Some(action)).await?;
    let changed=sqlx::query("update catalog.agent_model_binding set native_dispatch_started=true,native_key_id=$3,native_key_revision=$4,
        secret_status='ACTIVE' where installation_resource_id=$1 and projection_generation=$2
        and secret_status in ('PENDING','ACTIVE')")
        .bind(installation).bind(generation).bind(id).bind(revision).execute(&state.pool).await?;
    if changed.rows_affected() != 1 {
        return Err(conflict());
    }
    let model = resolve(state, installation, version, generation).await?;
    lifecycle.commit().await?;
    Ok(model)
}

/// 每次 spawn/模型副作用前读同一冻结 generation；PROVISIONING 不伪造 ACTIVE，
/// readiness 调用允许 PROVISIONING，发起 turn 的更严格 admit_runtime 仍由调用方执行。
pub(crate) async fn resolve(
    state: &ServiceState,
    installation: Uuid,
    version: Uuid,
    generation: i64,
) -> Result<RuntimeModel, Refusal> {
    let (route_id, tenant, workspace, agent) =
        installation_scope(state, installation, version, generation, None).await?;
    let route = checked_route(
        state,
        route_id,
        tenant,
        workspace,
        agent,
        Consistency::FullyConsistent,
    )
    .await?;
    let binding = binding(state, installation, generation, route_id, None).await?;
    if binding.secret_status != "ACTIVE"
        || binding.native_key_id.is_none()
        || binding.native_key_revision.is_none()
    {
        return Err(unavailable());
    }
    let expected_locator = state.secrets.tenant_locator(
        tenant,
        &format!("llm-route/{route_id}/{installation}/{generation}"),
    );
    let secret_version = binding.secret_version.ok_or_else(unavailable)?;
    let secret = read_secret(state, &binding, secret_version, &expected_locator).await?;
    let gateway = Gateway::from_env()?;
    gateway.check_route(&route).await?;
    gateway.check_authentication().await?;
    let key = key_projection(
        &route.native_id,
        tenant,
        workspace,
        agent,
        binding.gateway_principal_id,
        (installation, generation),
        &secret,
    );
    let expected = binding
        .native_key_id
        .clone()
        .zip(binding.native_key_revision);
    if gateway.find_key(&key).await? != expected {
        return Err(unavailable());
    }
    gateway.check_model(&route.native_id, &secret).await?;
    installation_scope(state, installation, version, generation, None).await?;
    let fresh = checked_route(
        state,
        route_id,
        tenant,
        workspace,
        agent,
        Consistency::FullyConsistent,
    )
    .await?;
    if fresh.resource_version != route.resource_version
        || fresh.native_config_hash != route.native_config_hash
        || fresh.native_revision != route.native_revision
    {
        return Err(conflict());
    }
    Ok(RuntimeModel {
        model: route.native_id,
        gateway_base_url: gateway.model_base.to_string(),
        secret_ref: SecretRef {
            locator: binding.secret_locator,
            version: u32::try_from(secret_version).map_err(|_| unavailable())?,
            audience: binding.secret_audience,
        },
    })
}

async fn installation_scope(
    state: &ServiceState,
    installation: Uuid,
    version: Uuid,
    generation: i64,
    action: Option<Uuid>,
) -> Result<(Uuid, Uuid, Uuid, Uuid), Refusal> {
    if generation <= 0 {
        return Err(Refusal::Precondition(ReasonCode::InvalidParameters));
    }
    sqlx::query_as("select p.model_route_resource_id,r.tenant_id,i.workspace_id,i.agent_principal_id
        from catalog.agent_installation i join catalog.resource r on r.id=i.resource_id
        join catalog.agent_runtime_projection p on p.installation_resource_id=i.resource_id
          and p.generation=$3 and p.agent_version_asset_id=$2 and p.state in ('PENDING','ACTIVE')
        join catalog.agent_version v on v.asset_id=$2 and v.agent_resource_id=i.agent_resource_id
          and v.state in ('PUBLISHED','RETIRED') and i.pinned_version_asset_id=v.asset_id
          and v.content->>'modelRouteResourceId'=p.model_route_resource_id::text
        join identity.tenant t on t.id=r.tenant_id and t.state='ACTIVE'
        join identity.workspace w on w.id=i.workspace_id and w.tenant_id=t.id and w.state='ACTIVE'
        join identity.principal a on a.id=i.agent_principal_id and a.tenant_id=t.id and a.kind='AGENT' and a.status='ACTIVE'
        join identity.principal o on o.id=r.owner_principal_id and o.tenant_id=t.id and o.kind='HUMAN' and o.status='ACTIVE'
        join identity.tenant_membership om on om.tenant_principal_id=o.id and om.tenant_id=t.id and om.state='ACTIVE'
        left join admission.action_execution projection on projection.id=r.projection_action_execution_id
        left join catalog.action_definition definition on definition.action_key=projection.action_key
          and definition.version=projection.action_version
        where i.resource_id=$1 and r.home_workspace_id=w.id and r.type_key='agent.installation'
          and i.state in ('PROVISIONING','ACTIVE') and r.state in ('PROVISIONING','ACTIVE')
          and ((p.state='ACTIVE' and i.state='ACTIVE' and r.state='ACTIVE'
              and i.active_projection_generation=p.generation and r.projection_action_execution_id is null
              and $4::uuid is null)
            or (p.state='PENDING' and i.state='PROVISIONING' and r.state='PROVISIONING'
              and projection.tenant_id=t.id and projection.workspace_id=w.id
              and projection.target_id=r.id and projection.gate_state='ALLOWED'
              and projection.dispatch_state='DISPATCHED'
              and definition.workflow_type='ComponentTaskWorkflow' and definition.workflow_kind='AGENT_INSTALLATION'
              and definition.execution_mode='TEMPORAL' and definition.capacity_policy='NONE'
              and definition.quota_policy='NONE' and cardinality(definition.meters)=0
              and ($4::uuid is null or projection.id=$4)
              and exists(select 1 from projection.workflow_ref f where f.action_execution_id=projection.id
                and f.tenant_id=t.id and f.workspace_id=w.id and f.operation_id=projection.operation_id
                and f.workflow_id=projection.temporal_workflow_id and f.projection_state='RUNNING'
                and f.run_id is not null and f.workflow_type='ComponentTaskWorkflow' and f.kind='AGENT_INSTALLATION')))")
        .bind(installation).bind(version).bind(generation).bind(action)
        .fetch_optional(&state.pool).await?.ok_or_else(unavailable)
}

async fn checked_route(
    state: &ServiceState,
    id: Uuid,
    tenant: Uuid,
    workspace: Uuid,
    agent: Uuid,
    consistency: Consistency<'_>,
) -> Result<Route, Refusal> {
    let route: Route = sqlx::query_as(ROUTE)
        .bind(id)
        .bind(tenant)
        .fetch_optional(&state.pool)
        .await?
        .ok_or(Refusal::Precondition(ReasonCode::BindingNotActive))?;
    if route.tenant_id != tenant || route.home_workspace_id.is_some_and(|w| w != workspace) {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let spice = &state.governance.spicedb;
    if !spice
        .resource_projection_matches_in_workspace(
            &id.to_string(),
            &tenant.to_string(),
            &route.owner_principal_id.to_string(),
            route.home_workspace_id.map(|w| w.to_string()).as_deref(),
            state.governance.cfg.relationship_page,
        )
        .await
        .map_err(|_| unavailable())?
    {
        return Err(unavailable());
    }
    for (object_type, object, permission) in [
        ("workspace", workspace, "discover"),
        ("resource", id, "discover"),
        ("resource", id, "execute"),
    ] {
        let checked = spice
            .check(
                object_type,
                &object.to_string(),
                permission,
                &agent.to_string(),
                consistency,
            )
            .await
            .map_err(|_| unavailable())?;
        if checked.zed_token.is_empty() {
            return Err(unavailable());
        }
        if !checked.allowed {
            return Err(Refusal::Denied(ReasonCode::PermissionDenied));
        }
    }
    Ok(route)
}

const BINDING: &str = "select b.gateway_principal_id,b.secret_locator,b.secret_version,b.secret_audience,b.secret_status,b.native_dispatch_started,
    b.native_key_id,b.native_key_revision from catalog.agent_model_binding b
    join catalog.resource r on r.id=b.installation_resource_id
    join identity.principal p on p.id=b.gateway_principal_id and p.tenant_id=r.tenant_id
      and p.kind='SERVICE' and p.status='ACTIVE'
    join identity.service_principal s on s.principal_id=p.id and s.audience=p.id::text
      and s.component_binding_kind is null and s.component_binding_id is null
    where b.installation_resource_id=$1 and b.projection_generation=$2 and b.model_route_resource_id=$3
      and ($4::uuid is null or b.action_execution_id=$4)";

async fn binding(
    state: &ServiceState,
    installation: Uuid,
    generation: i64,
    route: Uuid,
    action: Option<Uuid>,
) -> Result<Binding, Refusal> {
    sqlx::query_as(BINDING)
        .bind(installation)
        .bind(generation)
        .bind(route)
        .bind(action)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(conflict)
}

async fn binding_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    installation: Uuid,
    generation: i64,
    route: Uuid,
    action: Uuid,
) -> Result<Binding, Refusal> {
    sqlx::query_as(BINDING)
        .bind(installation)
        .bind(generation)
        .bind(route)
        .bind(Some(action))
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(conflict)
}

async fn read_secret(
    state: &ServiceState,
    binding: &Binding,
    version: i32,
    expected_locator: &str,
) -> Result<SecretValue, Refusal> {
    let version = u32::try_from(version)
        .ok()
        .filter(|v| *v > 0)
        .ok_or_else(unavailable)?;
    if binding.secret_locator != expected_locator {
        return Err(conflict());
    }
    state
        .secrets
        .read(
            &SecretRef {
                locator: binding.secret_locator.clone(),
                version,
                audience: binding.secret_audience.clone(),
            },
            "value",
        )
        .await
        .map_err(|_| unavailable())
}

fn key_projection(
    model: &str,
    tenant: Uuid,
    workspace: Uuid,
    agent: Uuid,
    service: Uuid,
    projection: (Uuid, i64),
    secret: &SecretValue,
) -> Value {
    let (installation, generation) = projection;
    json!({"keyHash":format!("sha256:{}",hex::encode(Sha256::digest(secret.expose().as_bytes()))),
        "allowedModels":[model],"metadata":{"user":service,"tenantId":tenant,"workspaceId":workspace,
            "agentPrincipalId":agent,"servicePrincipalId":service,"installationResourceId":installation,"projectionGeneration":generation}})
}

struct Gateway {
    admin: reqwest::Url,
    model_base: reqwest::Url,
    timeout: std::time::Duration,
    tokens: crate::oidc::TokenSource,
}

impl Gateway {
    fn from_env() -> Result<Self, Refusal> {
        let url = |name| -> Result<reqwest::Url, Refusal> {
            let raw = std::env::var(name).map_err(|_| unavailable())?;
            let url = reqwest::Url::parse(&raw).map_err(|_| unavailable())?;
            if !matches!(url.scheme(), "http" | "https")
                || url.host_str().is_none()
                || !url.username().is_empty()
                || url.password().is_some()
                || url.query().is_some()
                || url.fragment().is_some()
            {
                return Err(unavailable());
            }
            Ok(url)
        };
        let timeout = std::env::var("AGENTGATEWAY_ADMIN_TIMEOUT_SECONDS")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .filter(|v| *v > 0)
            .ok_or_else(unavailable)?;
        Ok(Self {
            admin: url("AGENTGATEWAY_ADMIN_URL")?,
            model_base: url("AGENTGATEWAY_MODEL_BASE_URL")?,
            timeout: std::time::Duration::from_secs(timeout),
            tokens: crate::oidc::TokenSource::from_env().map_err(|_| unavailable())?,
        })
    }

    async fn admin(&self, segments: &[&str], body: Option<Value>) -> Result<Value, Refusal> {
        let mut url = self.admin.clone();
        url.path_segments_mut()
            .map_err(|_| unavailable())?
            .pop_if_empty()
            .extend(segments);
        let bearer = self.tokens.token().await.map_err(|_| unavailable())?;
        let client = reqwest::Client::new();
        let request = match body {
            Some(value) => client.put(url).json(&value),
            None => client.get(url),
        };
        let response = request
            .bearer_auth(bearer)
            .timeout(self.timeout)
            .send()
            .await
            .map_err(|_| unavailable())?;
        if !response.status().is_success() {
            return Err(unavailable());
        }
        response.json().await.map_err(|_| unavailable())
    }

    async fn resources(&self, kind: &str) -> Result<Vec<Value>, Refusal> {
        let body = self
            .admin(&["api", "config", "resources", kind], None)
            .await?;
        let rows = body
            .get("resources")
            .and_then(Value::as_array)
            .ok_or_else(unavailable)?;
        if rows.iter().any(|r| {
            r.get("kind").and_then(Value::as_str) != Some(kind)
                || r.get("id")
                    .and_then(Value::as_str)
                    .is_none_or(str::is_empty)
                || r.get("revision")
                    .and_then(Value::as_i64)
                    .is_none_or(|r| r <= 0)
        }) {
            return Err(unavailable());
        }
        Ok(rows.clone())
    }

    async fn check_route(&self, route: &Route) -> Result<(), Refusal> {
        let rows = self.resources("llm.virtualModel").await?;
        let matches: Vec<_> = rows
            .iter()
            .filter(|r| r.get("id").and_then(Value::as_str) == Some(route.native_id.as_str()))
            .collect();
        if matches.len() != 1 {
            return Err(unavailable());
        }
        let row = matches[0];
        let value = row.get("value").ok_or_else(unavailable)?;
        if row.get("revision").and_then(Value::as_i64) != Some(route.native_revision)
            || value.get("name").and_then(Value::as_str) != Some(route.native_id.as_str())
            || digest(value)? != route.native_config_hash
        {
            return Err(unavailable());
        }
        // Hybrid effective 配置逐值叠加 ConfigResource；stored 存在不是 reload/执行证据。
        let effective = self.admin(&["api", "config", "effective"], None).await?;
        let models = effective
            .pointer("/llm/virtualModels")
            .and_then(Value::as_array)
            .ok_or_else(unavailable)?;
        let matches: Vec<_> = models
            .iter()
            .filter(|model| {
                model.get("name").and_then(Value::as_str) == Some(route.native_id.as_str())
            })
            .collect();
        if matches.len() != 1 || digest(matches[0])? != route.native_config_hash {
            return Err(unavailable());
        }
        Ok(())
    }

    async fn check_authentication(&self) -> Result<(), Refusal> {
        let effective = self.admin(&["api", "config", "effective"], None).await?;
        let auth = effective
            .pointer("/llm/policies/apiKey")
            .ok_or_else(unavailable)?;
        if auth.get("mode").and_then(Value::as_str) != Some("strict") {
            return Err(unavailable());
        }
        if let Some(location) = auth.get("location") {
            if location
                .pointer("/header/name")
                .and_then(Value::as_str)
                .is_none_or(|name| !name.eq_ignore_ascii_case("authorization"))
                || location.pointer("/header/prefix").and_then(Value::as_str) != Some("Bearer ")
            {
                return Err(unavailable());
            }
        }
        Ok(())
    }

    async fn find_key(&self, desired: &Value) -> Result<Option<(String, i64)>, Refusal> {
        let rows = self.resources("llm.apiKey").await?;
        let mut found = None;
        for row in rows {
            let value = row.get("value").ok_or_else(unavailable)?;
            let same_scope = desired
                .get("metadata")
                .and_then(Value::as_object)
                .ok_or_else(unavailable)?
                .iter()
                .all(|(key, expected)| {
                    value.get("metadata").and_then(|v| v.get(key)) == Some(expected)
                });
            let same_key = value.get("keyHash") == desired.get("keyHash");
            if !same_scope && !same_key {
                continue;
            }
            if !same_scope
                || !same_key
                || value.get("allowedModels") != desired.get("allowedModels")
                || value.get("key").is_some()
                || value
                    .get("budgets")
                    .is_some_and(|v| v.as_array().is_none_or(|v| !v.is_empty()))
                || found.is_some()
            {
                return Err(conflict());
            }
            found = Some((
                row.get("id")
                    .and_then(Value::as_str)
                    .ok_or_else(unavailable)?
                    .into(),
                row.get("revision")
                    .and_then(Value::as_i64)
                    .ok_or_else(unavailable)?,
            ));
        }
        Ok(found)
    }

    async fn create_key(&self, desired: &Value) -> Result<(), Refusal> {
        self.admin(
            &["api", "config", "resources", "llm.apiKey"],
            Some(json!({"resources":[{"value":desired}]})),
        )
        .await?;
        Ok(())
    }

    async fn delete(&self, kind: &str, id: &str) -> Result<(), Refusal> {
        let mut url = self.admin.clone();
        url.path_segments_mut()
            .map_err(|_| unavailable())?
            .pop_if_empty()
            .extend(["api", "config", "resources", kind, id]);
        let bearer = self.tokens.token().await.map_err(|_| unavailable())?;
        let response = reqwest::Client::new()
            .delete(url)
            .bearer_auth(bearer)
            .timeout(self.timeout)
            .send()
            .await
            .map_err(|_| unavailable())?;
        // Neither 2xx nor 404 is terminal; retire performs independent stored/effective absence reads.
        if !response.status().is_success() && response.status() != reqwest::StatusCode::NOT_FOUND {
            return Err(unavailable());
        }
        Ok(())
    }

    async fn require_key_absent(
        &self,
        tenant: Uuid,
        credential: &FrozenCredential,
        desired: Option<&Value>,
        secret: Option<&SecretValue>,
    ) -> Result<(), Refusal> {
        let tenant = tenant.to_string();
        let installation = credential.installation_resource_id.to_string();
        let matches = |value: &Value| {
            let metadata = value.get("metadata");
            let scope = metadata
                .and_then(|m| m.get("tenantId"))
                .and_then(Value::as_str)
                == Some(tenant.as_str())
                && metadata
                    .and_then(|m| m.get("installationResourceId"))
                    .and_then(Value::as_str)
                    == Some(installation.as_str())
                && metadata
                    .and_then(|m| m.get("projectionGeneration"))
                    .and_then(Value::as_i64)
                    == Some(credential.projection_generation);
            scope
                || desired.is_some_and(|desired| value.get("keyHash") == desired.get("keyHash"))
                || secret.is_some_and(|secret| {
                    value.get("key").and_then(Value::as_str) == Some(secret.expose())
                })
        };
        if self.resources("llm.apiKey").await?.iter().any(|row| {
            credential
                .native_key_id
                .as_deref()
                .is_some_and(|id| row.get("id").and_then(Value::as_str) == Some(id))
                || row.get("value").is_some_and(&matches)
        }) {
            return Err(unavailable());
        }
        let effective = self.admin(&["api", "config", "effective"], None).await?;
        if effective
            .pointer("/llm/policies/apiKey/keys")
            .is_some_and(|keys| keys.as_array().is_none_or(|keys| keys.iter().any(matches)))
        {
            return Err(unavailable());
        }
        Ok(())
    }

    async fn require_key_rejected(&self, secret: &SecretValue) -> Result<(), Refusal> {
        let mut url = self.model_base.clone();
        url.path_segments_mut()
            .map_err(|_| unavailable())?
            .pop_if_empty()
            .push("models");
        let response = reqwest::Client::new()
            .get(url)
            .bearer_auth(secret.expose())
            .timeout(self.timeout)
            .send()
            .await
            .map_err(|_| unavailable())?;
        // 原生 APIKeyAuthenticationFailure 精确映射 401；200/404/503 不是 credential 失效证据。
        if response.status() != reqwest::StatusCode::UNAUTHORIZED {
            return Err(unavailable());
        }
        Ok(())
    }

    async fn check_model(&self, model: &str, secret: &SecretValue) -> Result<(), Refusal> {
        let mut url = self.model_base.clone();
        url.path_segments_mut()
            .map_err(|_| unavailable())?
            .pop_if_empty()
            .push("models");
        let response = reqwest::Client::new()
            .get(url)
            .bearer_auth(secret.expose())
            .timeout(self.timeout)
            .send()
            .await
            .map_err(|_| unavailable())?;
        if !response.status().is_success() {
            return Err(unavailable());
        }
        let value: Value = response.json().await.map_err(|_| unavailable())?;
        let rows = value
            .get("data")
            .and_then(Value::as_array)
            .ok_or_else(unavailable)?;
        if rows.len() != 1 || rows[0].get("id").and_then(Value::as_str) != Some(model) {
            return Err(unavailable());
        }
        // 发现成功只证实当前 credential/route reload，不当 Responses/stream/tool 协议验收。
        Ok(())
    }
}

fn digest(value: &Value) -> Result<String, Refusal> {
    let canonical = crate::agent_version::canonical(value.clone());
    Ok(hex::encode(Sha256::digest(
        serde_json::to_vec(&canonical).map_err(|_| unavailable())?,
    )))
}
