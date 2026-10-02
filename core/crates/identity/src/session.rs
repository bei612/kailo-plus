//! PlatformSession（`.design/03` §2、§4.1）。
//!
//! 会话不由 Browser 携带：网关只投影 issuer/subject（`SS-AGW-OIDC`），Core 据此
//! 重新解析身份，再找出或建立该 `(HumanIdentity, TenantMembership)` 的 active
//! 会话。这样做的直接后果是——**撤销立刻对下一个请求生效**，不依赖客户端丢弃
//! 任何东西，也没有一张需要等它过期的凭证在外面流通。
//!
//! 会话承载的唯一额外事实是 `current_workspace_id`：它是 BFF 后续按 Workspace
//! 取 scope 的起点，不是权限本身。

use contracts::PlatformSessionAccessMode;
use sqlx::PgPool;
use uuid::Uuid;

/// 一次解析得到的会话。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlatformSession {
    pub id: Uuid,
    pub current_workspace_id: Option<Uuid>,
}

/// 找出或建立 active 会话。
///
/// 一个 `(HumanIdentity, TenantMembership)` 同时至多一条 active 会话。并发的第一个
/// 请求建立它，其余复用——不为同一个人同一个 Tenant 开出第二条，那会让「撤销会话」
/// 变成需要遍历的动作，而遍历总有漏网的。
///
/// 过期判定按库里的 `now()`，不按进程时钟：多副本 Core 的时钟不保证一致，用各自
/// 的时钟会让同一条会话在一个副本上有效、在另一个副本上过期。
pub async fn ensure(
    pool: &PgPool,
    human_identity_id: Uuid,
    tenant_membership_id: Uuid,
    ttl_seconds: i64,
) -> Result<PlatformSession, crate::IdentityError> {
    ensure_mode(
        pool,
        human_identity_id,
        tenant_membership_id,
        ttl_seconds,
        PlatformSessionAccessMode::Full,
    )
    .await
}

/// access_mode 是已完成 fresh 生命周期资格判定的结果，不接受 Browser 自报。
/// Tenant 行先于 membership 锁定，与治理准入的锁顺序相同；暂停/删除不能与
/// FULL 会话的重建交错。模式变化撤销旧会话，不复用旧 Workspace 选择。
pub async fn ensure_mode(
    pool: &PgPool,
    human_identity_id: Uuid,
    tenant_membership_id: Uuid,
    ttl_seconds: i64,
    access_mode: PlatformSessionAccessMode,
) -> Result<PlatformSession, crate::IdentityError> {
    // 同一 membership 的请求在其已有行上串行化：只把查找与插入放进事务
    // 仍会让两个副本同时读到空结果、各插入一条。锁不跨网络调用，也不改变
    // 会话的入参、TTL 或授权判定（DD-112 的幂等会话簿记）。
    let mut tx = pool.begin().await?;
    let tenant_id: Option<Uuid> = sqlx::query_scalar(
        "select tenant_id from identity.tenant_membership where id = $1 and human_identity_id = $2",
    )
    .bind(tenant_membership_id)
    .bind(human_identity_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(tenant_id) = tenant_id else {
        return Err(crate::IdentityError::MembershipNotActive);
    };
    let tenant_state: Option<String> =
        sqlx::query_scalar("select state from identity.tenant where id = $1 for update")
            .bind(tenant_id)
            .fetch_optional(&mut *tx)
            .await?;
    let permitted = match access_mode {
        PlatformSessionAccessMode::Full => tenant_state.as_deref() == Some("ACTIVE"),
        PlatformSessionAccessMode::LifecycleRestricted => matches!(
            tenant_state.as_deref(),
            Some("SUSPENDING" | "SUSPENDED" | "DELETING")
        ),
    };
    if !permitted {
        return Err(crate::IdentityError::TenantNotActive);
    }
    let mode = match access_mode {
        PlatformSessionAccessMode::Full => "FULL",
        PlatformSessionAccessMode::LifecycleRestricted => "LIFECYCLE_RESTRICTED",
    };
    let membership = sqlx::query_scalar::<_, Uuid>(
        "select id from identity.tenant_membership
         where id = $1 and human_identity_id = $2 and state = 'ACTIVE' for update",
    )
    .bind(tenant_membership_id)
    .bind(human_identity_id)
    .fetch_optional(&mut *tx)
    .await?;
    // 解析身份以后、取得锁以前，成员已被撤权：不能在撤会话事务之后
    // 再建一条 ACTIVE 会话，也不能把确定的失权报成依赖故障。
    if membership.is_none() {
        return Err(crate::IdentityError::MembershipNotActive);
    }

    sqlx::query(
        "update identity.platform_session set status = 'REVOKED'
         where human_identity_id = $1 and tenant_membership_id = $2
           and status = 'ACTIVE' and access_mode <> $3",
    )
    .bind(human_identity_id)
    .bind(tenant_membership_id)
    .bind(mode)
    .execute(&mut *tx)
    .await?;

    if let Some((id, current_workspace_id)) = sqlx::query_as::<_, (Uuid, Option<Uuid>)>(
        "select id, current_workspace_id from identity.platform_session
         where human_identity_id = $1 and tenant_membership_id = $2
           and status = 'ACTIVE' and expires_at > now() and access_mode = $3",
    )
    .bind(human_identity_id)
    .bind(tenant_membership_id)
    .bind(mode)
    .fetch_optional(&mut *tx)
    .await?
    {
        tx.commit().await?;
        return Ok(PlatformSession {
            id,
            current_workspace_id,
        });
    }

    let (id, current_workspace_id) = sqlx::query_as::<_, (Uuid, Option<Uuid>)>(
        "insert into identity.platform_session
             (id, human_identity_id, tenant_membership_id, issued_at, expires_at, status, access_mode)
         values ($1, $2, $3, now(), now() + make_interval(secs => $4), 'ACTIVE', $5)
         returning id, current_workspace_id",
    )
    .bind(Uuid::new_v4()).bind(human_identity_id).bind(tenant_membership_id)
    .bind(ttl_seconds as f64).bind(mode)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(PlatformSession {
        id,
        current_workspace_id,
    })
}

/// 撤销某个 membership 的全部 active 会话，返回撤销条数。
///
/// 在 membership 进入 `REVOKING` 的**同一个事务**里调用：`.design/03` §3 要求
/// 「进入 `REVOKING` 时立即撤销其 PlatformSession」。分成两次提交，崩在中间就得到
/// 一个已被撤权却还能继续发请求的会话——而 `REVOKING` 的全部意义就是立刻关门。
pub async fn revoke_for_membership(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant_membership_id: Uuid,
) -> Result<u64, sqlx::Error> {
    let done = sqlx::query!(
        "update identity.platform_session set status = 'REVOKED'
         where tenant_membership_id = $1 and status = 'ACTIVE'",
        tenant_membership_id
    )
    .execute(&mut **tx)
    .await?;
    Ok(done.rows_affected())
}

/// 撤销一条指定的会话，返回是否确实撤销了。
///
/// 注销走这条：它只动调用方自己那条会话，不牵连同一 membership 下别的会话
/// （同一个人可能在另一台设备上还开着，注销一台不该把另一台踢掉）。
pub async fn revoke_one(pool: &PgPool, session_id: Uuid) -> Result<bool, sqlx::Error> {
    let done = sqlx::query!(
        "update identity.platform_session set status = 'REVOKED'
         where id = $1 and status = 'ACTIVE'",
        session_id
    )
    .execute(pool)
    .await?;
    Ok(done.rows_affected() > 0)
}

/// 该会话此刻是否仍然可用。
///
/// 长连接用它做周期性再准入：请求/响应路径每次都重新解析身份，因此撤权对
/// 下一个请求立刻生效；而一条已经建立的流不会再经过那条路径，必须自己回头看
/// （`.design/03` §4.1 要求撤销对 stream 同样生效）。
pub async fn is_live(pool: &PgPool, session_id: Uuid) -> Result<bool, sqlx::Error> {
    // 所属 Tenant 暂停（DD-96(3)）同样使会话失效：已建立的 stream 在再准入时关闭
    let tenant: Option<Uuid> = sqlx::query_scalar(
        "select tm.tenant_id from identity.platform_session s
         join identity.tenant_membership tm on tm.id = s.tenant_membership_id
         where s.id = $1",
    )
    .bind(session_id)
    .fetch_optional(pool)
    .await?;
    match tenant {
        Some(t) if crate::tenant_active(pool, t).await? => {}
        _ => return Ok(false),
    }
    Ok(sqlx::query_scalar!(
        "select 1 from identity.platform_session s
         join identity.human_identity h on h.id = s.human_identity_id
         join identity.tenant_membership tm
           on tm.id = s.tenant_membership_id and tm.human_identity_id = h.id
         join identity.principal p
           on p.id = tm.tenant_principal_id and p.tenant_id = tm.tenant_id
         where s.id = $1 and s.status = 'ACTIVE' and s.expires_at > now()
           and h.status = 'ACTIVE' and tm.state = 'ACTIVE'
           and p.kind = 'HUMAN' and p.status = 'ACTIVE'",
        session_id
    )
    .fetch_optional(pool)
    .await?
    .is_some())
}
