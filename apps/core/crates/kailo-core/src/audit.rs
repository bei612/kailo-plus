//! AuditEvent 写入（`.design/03` §9）。
//!
//! 两条规则决定了这个模块的形状：
//!
//! - **与业务写同事务**。审计事实和它记录的那次状态变化必须一起成立或一起不
//!   成立。分成两次提交，崩在中间就得到一次「发生过但没人记得」的状态变更，
//!   而那是审计唯一要防的东西。
//! - **`event_key` 唯一**。同一 operation/阶段/native attempt 上它必须稳定，
//!   重试不得复制同一审计事实。唯一约束在库里，这里只负责算出稳定的 key。
//!
//! 不写进审计的东西由 `.design/03` §9 固定：Secret、正文、完整 prompt/response、
//! 原始 SQL、结果行、工具 raw body。本模块不提供任何承载它们的字段。

use serde_json::Value;
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

/// 一条待写入的审计事实。
pub struct AuditEntry<'a> {
    /// 同一 operation/阶段上稳定的键。重试算出同一个值，因此重试不写第二条。
    pub event_key: String,
    pub tenant_id: Option<Uuid>,
    pub workspace_id: Option<Uuid>,
    pub operation_id: Uuid,
    pub event_type: &'a str,
    pub human_identity_id: Option<Uuid>,
    pub initiator_principal_id: Option<Uuid>,
    pub actor_principal_id: Option<Uuid>,
    pub action_key: &'a str,
    pub action_version: i32,
    pub component_type_key: &'a str,
    pub target_type: Option<&'a str>,
    pub target_id: Option<Uuid>,
    pub parameter_hash: &'a str,
    pub decision: &'a str,
    pub result_code: &'a str,
    pub result_exposure: &'a str,
    /// 只放源码权威里的稳定 ID、version/digest 与敏感级别。
    pub evidence_refs: Value,
    pub correlation_id: Uuid,
}

/// 在给定事务内追加一条审计事实。
///
/// `ON CONFLICT (event_key) DO NOTHING`：重试到达同一结果，不是失败。约束本身
/// 才是「不复制同一审计事实」的执行点；这里只是让重试不炸。
pub async fn append(
    tx: &mut Transaction<'_, Postgres>,
    e: AuditEntry<'_>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into audit.audit_event
             (id, event_key, tenant_id, workspace_id, operation_id, event_type,
              human_identity_id, initiator_principal_id, actor_principal_id,
              action_key, action_version, component_type_key, target_type, target_id,
              parameter_hash, decision, result_code, result_exposure,
              evidence_refs, correlation_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         on conflict (event_key) do nothing",
    )
    .bind(Uuid::new_v4())
    .bind(&e.event_key)
    .bind(e.tenant_id)
    .bind(e.workspace_id)
    .bind(e.operation_id)
    .bind(e.event_type)
    .bind(e.human_identity_id)
    .bind(e.initiator_principal_id)
    .bind(e.actor_principal_id)
    .bind(e.action_key)
    .bind(e.action_version)
    .bind(e.component_type_key)
    .bind(e.target_type)
    .bind(e.target_id)
    .bind(e.parameter_hash)
    .bind(e.decision)
    .bind(e.result_code)
    .bind(e.result_exposure)
    .bind(&e.evidence_refs)
    .bind(e.correlation_id)
    .execute(&mut **tx)
    .await
    .map(|_| ())
}

/// 外部 subject 的不可逆摘要。
///
/// OIDC callback 之后、Core 解析出 TenantMembership 之前那段边界上没有 Principal
/// 可记，但审计记录必须能指回某个人（`DD-52/54`）。原样记 subject 会把外部身份
/// 标识散进审计表——它在很多 IdP 上是邮箱或可反查的账号名。这里只记 sha256。
pub fn subject_evidence(issuer: &str, subject: &str) -> Value {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    // issuer 参与摘要：不同 IdP 的同名 subject 不是同一个人
    h.update(issuer.as_bytes());
    h.update([0u8]);
    h.update(subject.as_bytes());
    serde_json::json!([{
        "kind": "EXTERNAL_SUBJECT_SHA256",
        "value": hex::encode(h.finalize()),
    }])
}
