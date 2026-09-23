//! PlatformSession（`.design/03` §2、§4.1）。
//!
//! 会话不由 Browser 携带：网关只投影 issuer/subject（`SS-AGW-OIDC`），Core 据此
//! 重新解析身份，再找出或建立该 `(HumanIdentity, TenantMembership)` 的 active
//! 会话。这样做的直接后果是——**撤销立刻对下一个请求生效**，不依赖客户端丢弃
//! 任何东西，也没有一张需要等它过期的凭证在外面流通。
//!
//! 会话承载的唯一额外事实是 `current_workspace_id`：它是 BFF 后续按 Workspace
//! 取 scope 的起点，不是权限本身。

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
) -> Result<PlatformSession, sqlx::Error> {
    if let Some(row) = sqlx::query!(
        "select id, current_workspace_id from identity.platform_session
         where human_identity_id = $1 and tenant_membership_id = $2
           and status = 'ACTIVE' and expires_at > now()",
        human_identity_id,
        tenant_membership_id
    )
    .fetch_optional(pool)
    .await?
    {
        return Ok(PlatformSession {
            id: row.id,
            current_workspace_id: row.current_workspace_id,
        });
    }

    let row = sqlx::query!(
        "insert into identity.platform_session
             (id, human_identity_id, tenant_membership_id, issued_at, expires_at, status)
         values ($1, $2, $3, now(), now() + make_interval(secs => $4), 'ACTIVE')
         returning id, current_workspace_id",
        Uuid::new_v4(),
        human_identity_id,
        tenant_membership_id,
        ttl_seconds as f64,
    )
    .fetch_one(pool)
    .await?;
    Ok(PlatformSession {
        id: row.id,
        current_workspace_id: row.current_workspace_id,
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
    Ok(sqlx::query_scalar!(
        "select 1 from identity.platform_session
         where id = $1 and status = 'ACTIVE' and expires_at > now()",
        session_id
    )
    .fetch_optional(pool)
    .await?
    .is_some())
}
