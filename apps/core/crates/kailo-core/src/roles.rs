//! 角色：RoleTemplate 的展开与「有效 Tenant admin」的判定（DD-82、`.design/03` §5）。
//!
//! 角色是 SpiceDB relationship，不是 Core 事实。本模块不存任何「谁是 admin」：
//! 它从 Catalog 读确切版本的 RoleTemplate 把角色名展开成关系，从 SpiceDB 读关系，
//! 再与 Core 的成员事实求交。准入、审批与派发的链路在 `governance`。

use sqlx::PgConnection;
use uuid::Uuid;

use crate::spicedb::{Relationship, RelationshipFilter, SpiceDb, SpiceDbError};

/// 固定 schema 中给出 `tenant manage` 的那条 relation（`permission manage = admin`）。
/// 它是 `.design/03` §5 的 schema 事实而不是部署取值：「有效 Tenant admin」按它定义
/// （DD-82），换 schema 就是换设计。
pub const TENANT_MANAGE_RELATION: &str = "admin";

/// Catalog 中一个 RoleTemplate 的确切版本。
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct RoleTemplate {
    pub role_key: String,
    pub object_type: String,
    pub relations: Vec<String>,
}

pub async fn template(
    conn: &mut PgConnection,
    key: &str,
    version: i32,
) -> Result<RoleTemplate, sqlx::Error> {
    sqlx::query_as(
        "select role_key, object_type, relations from catalog.role_template
         where role_key = $1 and version = $2",
    )
    .bind(key)
    .bind(version)
    .fetch_one(conn)
    .await
}

impl RoleTemplate {
    /// 该角色在一个对象上对一个 Principal 展开出的全部关系。
    pub fn expand(&self, object_id: Uuid, principal: Uuid) -> Vec<Relationship> {
        self.relations
            .iter()
            .map(|r| Relationship {
                object_type: self.object_type.clone(),
                object_id: object_id.to_string(),
                relation: r.clone(),
                subject_principal: principal.to_string(),
            })
            .collect()
    }

    /// 是否为「有效 Tenant admin」所依据的那条关系的授予者。撤它要经最后一位
    /// admin 的约束。
    pub fn grants_tenant_manage(&self) -> bool {
        self.object_type == "tenant" && self.relations.iter().any(|r| r == TENANT_MANAGE_RELATION)
    }
}

/// 一次角色动作的 target：由（对象、角色、Principal）派生的稳定 ID。
///
/// 它让「同一对象上同一人的同一角色」在 `action_execution_one_pending_per_target`
/// 下只能有一个在途准入或审批——并发的授予与撤销在准入处就被排成先后，而不同
/// 对象、不同角色的动作互不阻塞。取名字空间 URL 的 v5：同一元组永远得到同一 ID，
/// 不需要另存映射。
pub fn target_id(t: &RoleTemplate, object_id: Uuid, principal: Uuid) -> Uuid {
    Uuid::new_v5(
        &Uuid::NAMESPACE_URL,
        format!(
            "urn:kailo:role:{}:{}:{}:{}",
            t.object_type, object_id, t.role_key, principal
        )
        .as_bytes(),
    )
}

/// 当前持有全部模板关系（只要缺一条就不算持有）。
pub async fn held(
    spicedb: &SpiceDb,
    t: &RoleTemplate,
    object_id: Uuid,
    principal: Uuid,
    page: u32,
) -> Result<bool, SpiceDbError> {
    let object = object_id.to_string();
    let subject = principal.to_string();
    let rels = spicedb
        .read(
            &RelationshipFilter {
                object_type: &t.object_type,
                object_id: Some(&object),
                relation: None,
                subject_principal: Some(&subject),
            },
            page,
        )
        .await?;
    Ok(t.relations
        .iter()
        .all(|want| rels.iter().any(|r| &r.relation == want)))
}

/// 有效 Tenant admin：持有 `tenant#admin`、同 Tenant 的 active HUMAN 且
/// TenantMembership `ACTIVE`（DD-82）。`REVOKING` 的人已不能执行任何动作
/// （DD-45），不计入。
///
/// 调用方若要据此放行一次「会让集合变小」的变更，必须在持有该 Tenant 行锁的事务
/// 里调用并在同一事务内完成写入——否则两个并发的撤销各自看到对方还在。
pub async fn effective_tenant_admins(
    conn: &mut PgConnection,
    spicedb: &SpiceDb,
    tenant: Uuid,
    page: u32,
) -> Result<Vec<Uuid>, crate::governance::Refusal> {
    let object = tenant.to_string();
    let rels = spicedb
        .read(
            &RelationshipFilter {
                object_type: "tenant",
                object_id: Some(&object),
                relation: Some(TENANT_MANAGE_RELATION),
                subject_principal: None,
            },
            page,
        )
        .await
        .map_err(|e| crate::governance::Refusal::Unavailable(e.to_string()))?;
    let ids: Vec<Uuid> = rels
        .iter()
        .filter_map(|r| Uuid::parse_str(&r.subject_principal).ok())
        .collect();
    let effective: Vec<Uuid> = sqlx::query_scalar(
        "select p.id from identity.principal p
         join identity.tenant_membership tm on tm.tenant_principal_id = p.id
         where p.id = any($1) and p.tenant_id = $2 and p.kind = 'HUMAN' and p.status = 'ACTIVE'
           and tm.tenant_id = $2 and tm.state = 'ACTIVE'",
    )
    .bind(&ids)
    .bind(tenant)
    .fetch_all(conn)
    .await?;
    Ok(effective)
}

/// 去掉 `leaving` 之后有效 Tenant admin 是否变空。`leaving` 本不是有效 admin 时
/// 这次变更不改变集合，不受约束。
pub fn would_empty(effective: &[Uuid], leaving: Uuid) -> bool {
    effective.contains(&leaving) && effective.iter().all(|p| *p == leaving)
}

/// Tenant 行锁：同一 Tenant 上一切会改变「有效 Tenant admin」的判定与写入在此
/// 串行。它包括撤 admin、授 admin 与撤 TenantMembership 三类。
pub async fn lock_tenant(conn: &mut PgConnection, tenant: Uuid) -> Result<bool, sqlx::Error> {
    Ok(
        sqlx::query_scalar::<_, i32>("select 1 from identity.tenant where id = $1 for update")
            .bind(tenant)
            .fetch_optional(conn)
            .await?
            .is_some(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(object: &str, rels: &[&str]) -> RoleTemplate {
        RoleTemplate {
            role_key: "R".into(),
            object_type: object.into(),
            relations: rels.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn last_admin_is_the_only_emptying_change() {
        let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
        assert!(would_empty(&[a], a));
        assert!(!would_empty(&[a, b], a));
        // 不是有效 admin 的人离开不改变集合
        assert!(!would_empty(&[a], b));
        assert!(!would_empty(&[], b));
    }

    #[test]
    fn target_id_is_stable_per_tuple() {
        let (o, p) = (Uuid::new_v4(), Uuid::new_v4());
        let admin = t("tenant", &["admin"]);
        assert_eq!(target_id(&admin, o, p), target_id(&admin, o, p));
        assert_ne!(
            target_id(&admin, o, p),
            target_id(&admin, o, Uuid::new_v4())
        );
        let mut other = admin.clone();
        other.role_key = "OTHER".into();
        assert_ne!(target_id(&admin, o, p), target_id(&other, o, p));
    }

    #[test]
    fn only_tenant_admin_grants_manage() {
        assert!(t("tenant", &["admin"]).grants_tenant_manage());
        assert!(!t("workspace", &["admin"]).grants_tenant_manage());
        assert!(!t("tenant", &["auditor"]).grants_tenant_manage());
    }
}
