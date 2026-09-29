//! 部署 IdP 下的 ExternalIdentity → HumanIdentity 登记（`.design/03` §2、`.design/09` §5）。
//!
//! 只有两处会为一个 subject 建立平台身份，二者都以一份 provisioning/invitation fact
//! 为前提：部署引导（ADR-11，首位 admin）与邀请兑换（DD-83）。它们共用这一处，免得
//! 「同一 subject 只映射一个 HumanIdentity」在两份实现里各自成立。
//!
//! 登记在调用方事务内完成，并按 (issuer, subject) 取事务级 advisory 锁：同一人并发的
//! 两次兑换（或兑换与引导）先后执行，后到的读到先到的那一行，不会建出两个
//! HumanIdentity、也不会因唯一约束冲突而把一次本该成功的登记报成错误。

use sha2::{Digest, Sha256};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

/// 同一 (issuer, subject) 上的事务级串行点。锁随事务结束释放；同一事务内重复取无害。
pub(crate) async fn lock_subject(
    tx: &mut Transaction<'_, Postgres>,
    issuer: &str,
    subject: &str,
) -> Result<(), sqlx::Error> {
    let mut h = Sha256::new();
    h.update(issuer.as_bytes());
    h.update([0u8]);
    h.update(subject.as_bytes());
    let d = h.finalize();
    let key = i64::from_be_bytes([d[0], d[1], d[2], d[3], d[4], d[5], d[6], d[7]]);
    sqlx::query("select pg_advisory_xact_lock($1)")
        .bind(key)
        .execute(&mut **tx)
        .await
        .map(|_| ())
}

/// 已登记的平台身份。`active` 为假表示外部身份或 HumanIdentity 已停用：调用方拒绝，
/// 不替它重建。
pub(crate) async fn find(
    tx: &mut Transaction<'_, Postgres>,
    issuer: &str,
    subject: &str,
) -> Result<Option<(Uuid, bool)>, sqlx::Error> {
    sqlx::query_as(
        "select ei.human_identity_id, (ei.status = 'ACTIVE' and hi.status = 'ACTIVE')
         from identity.external_identity ei
         join identity.human_identity hi on hi.id = ei.human_identity_id
         where ei.issuer = $1 and ei.subject = $2",
    )
    .bind(issuer)
    .bind(subject)
    .fetch_optional(&mut **tx)
    .await
}

/// 取或建该 subject 的 HumanIdentity。已有即原样返回（不改显示名：显示名只在首次
/// 登记时取自 fact 的提供方）；停用的身份返回 `Ok(None)`。
pub(crate) async fn ensure(
    tx: &mut Transaction<'_, Postgres>,
    issuer: &str,
    client_id: &str,
    subject: &str,
    display_name: &str,
) -> Result<Option<Uuid>, sqlx::Error> {
    lock_subject(tx, issuer, subject).await?;
    if let Some((human, active)) = find(tx, issuer, subject).await? {
        return Ok(active.then_some(human));
    }
    sqlx::query(
        "insert into identity.identity_provider (id, issuer, client_id, claim_mapping_version, status)
         values ($1, $2, $3, 1, 'ACTIVE') on conflict (issuer, client_id) do nothing",
    )
    .bind(Uuid::new_v4())
    .bind(issuer)
    .bind(client_id)
    .execute(&mut **tx)
    .await?;
    let provider: Uuid = sqlx::query_scalar(
        "select id from identity.identity_provider where issuer = $1 and client_id = $2",
    )
    .bind(issuer)
    .bind(client_id)
    .fetch_one(&mut **tx)
    .await?;
    let human = Uuid::new_v4();
    sqlx::query(
        "insert into identity.human_identity (id, display_name, status) values ($1, $2, 'ACTIVE')",
    )
    .bind(human)
    .bind(display_name.trim())
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "insert into identity.external_identity (id, provider_id, issuer, subject, human_identity_id, status)
         values ($1, $2, $3, $4, $5, 'ACTIVE')",
    )
    .bind(Uuid::new_v4())
    .bind(provider)
    .bind(issuer)
    .bind(subject)
    .bind(human)
    .execute(&mut **tx)
    .await?;
    Ok(Some(human))
}
