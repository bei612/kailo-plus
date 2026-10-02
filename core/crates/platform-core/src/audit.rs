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

use contracts::{EvidenceAuthority, EvidenceKind, EvidenceSensitivity};
use serde_json::Value;
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

/// 一条 EvidenceRef（`.design/03` §14）：种类加权威源中的稳定 ID，可带 version。
///
/// 权威源、证据类型与敏感级别由种类唯一确定（[`describe`]），不随条目存储。
/// 序列化形状是 `{kind, value[, version]}`：审计表只追加，存量不能改写，新旧条目
/// 因此必须是同一种形状。不保存 payload、临时 URL、token 或 SecretRef locator。
#[derive(Debug, Clone, PartialEq)]
pub struct Evidence {
    pub kind: EvidenceKind,
    pub value: String,
    pub version: Option<i64>,
}

impl Evidence {
    pub fn new(kind: EvidenceKind, value: impl ToString) -> Self {
        Self {
            kind,
            value: value.to_string(),
            version: None,
        }
    }

    pub fn versioned(kind: EvidenceKind, value: impl ToString, version: i64) -> Self {
        Self {
            version: Some(version),
            ..Self::new(kind, value)
        }
    }

    fn to_json(&self) -> Value {
        let mut v = serde_json::json!({ "kind": self.kind, "value": self.value });
        if let Some(version) = self.version {
            v["version"] = version.into();
        }
        v
    }

    /// 读回一条存量条目。种类不在封闭枚举内、value 不是非空字符串或 version 不是
    /// 整数时返回 `None`：调用方把它当作不可识别，不猜测含义。
    pub fn parse(v: &Value) -> Option<Self> {
        let kind: EvidenceKind = serde_json::from_value(v.get("kind")?.clone()).ok()?;
        let value = v
            .get("value")?
            .as_str()
            .filter(|s| !s.is_empty())?
            .to_owned();
        let version = match v.get("version") {
            None => None,
            Some(n) => Some(n.as_i64()?),
        };
        Some(Self {
            kind,
            value,
            version,
        })
    }
}

/// 证据种类的固定描述：权威源与敏感级别。一处定义，写入与解引用共用。
///
/// RESTRICTED 是可回指到人的材料（外部 subject 摘要、平台会话）：解引用还需要
/// ResultExposure 授权，在其交付前一律不可用。
pub fn describe(kind: &EvidenceKind) -> (EvidenceAuthority, EvidenceSensitivity) {
    use EvidenceAuthority as A;
    use EvidenceKind as K;
    use EvidenceSensitivity as S;
    match kind {
        K::TemporalWorkflowId
        | K::TemporalRunId
        | K::TemporalFirstRunId
        | K::ApprovalWorkflowId => (A::Temporal, S::Summary),
        K::SpicedbZedtoken | K::SpicedbRelationship => (A::Spicedb, S::Summary),
        K::BuzzEventId
        | K::BuzzPubkey
        | K::BuzzDeletionRequestId
        | K::BuzzDeletionInventoryDigest => (A::Buzz, S::Summary),
        K::ExternalSubjectSha256 => (A::Oidc, S::Restricted),
        K::PlatformSessionId => (A::Core, S::Restricted),
        K::ApprovalPolicy
        | K::ActionExecutionId
        | K::AdmitActionExecutionId
        | K::OriginalActionExecutionId
        | K::TenantInvitationId
        | K::TenantMembershipId
        | K::TenantLifecycleSnapshotId
        | K::TenantDeleteSubprocessId
        | K::SecretRefRehomeId
        | K::DeploymentBootstrap => (A::Core, S::Summary),
    }
}

/// 写入审计表的证据数组。
pub fn evidence_json(refs: &[Evidence]) -> Value {
    Value::Array(refs.iter().map(Evidence::to_json).collect())
}

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
    /// 只放源码权威里的稳定 ID 与 version；敏感级别由种类确定。
    pub evidence_refs: Vec<Evidence>,
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
    .bind(evidence_json(&e.evidence_refs))
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
pub fn subject_evidence(issuer: &str, subject: &str) -> Evidence {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    // issuer 参与摘要：不同 IdP 的同名 subject 不是同一个人
    h.update(issuer.as_bytes());
    h.update([0u8]);
    h.update(subject.as_bytes());
    Evidence::new(
        EvidenceKind::ExternalSubjectSha256,
        hex::encode(h.finalize()),
    )
}
