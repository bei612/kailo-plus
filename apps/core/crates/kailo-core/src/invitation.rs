//! Tenant 成员邀请（DD-83，GAP-IDN-01 闭合）。
//!
//! 三段，各有自己的终结：
//!
//! 1. **签发**（`tenant.member.invite`，SYNC）：`issue` 在准入事务里生成一次性凭据、
//!    只落其 SHA-256 摘要。明文只经 `Issued` 回到签发请求的回应，不进库、日志、审计
//!    或 Workflow history。`Issued` 不实现 `Debug`，免得被顺手打进日志。
//! 2. **兑换**（`POST /api/v1/invitations/redeem`）：已认证 Human 出示凭据，一个事务内
//!    以摘要行锁把邀请置 REDEEMED、绑定兑换者、建 INVITED membership，并打开
//!    `tenant.member.admit`（发起者是邀请人）。提交后由治理链判定：需要一位 Tenant
//!    admin 确认兑换者就是被邀请的人。
//! 3. **开通或终结**：批准并重新准入后 INVITED→PROVISIONING→ACTIVE（既有
//!    MEMBERSHIP_PROJECTION）；门禁以任何方式关闭而未派发时，`settle_refused_admission`
//!    在同一事务里把 INVITED 置 REVOKED。
//!
//! 过期按查询时判定：签发时冻结 `expires_at`，兑换与撤回都在同一条带 `now()` 比较的
//! 语句里判定，列表把过期的 ISSUED 显示为 EXPIRED。没有回收作业，因此也没有「作业
//! 落后时过期凭据仍可兑换」的窗口。

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use chrono::{DateTime, Utc};
use contracts::{
    ActionGateState, InvitationClass, InvitationRedemptionRequest, InvitationRedemptionView,
    ReasonCode, TenantInvitationStatus, TenantInvitationView, TenantMembershipState,
};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use crate::audit::{append, subject_evidence, AuditEntry};
use crate::bff::{db_enum, resolve_execution_context, BffState, HEADER_ISSUER, HEADER_SUBJECT};
use crate::governance::{
    active_definition, open_execution, parse, wire, Actor, Definition, Execution, Governance,
    Params, Refusal, Semantic, Target,
};
use crate::spicedb::Consistency;

const ADMIT_ACTION: &str = "tenant.member.admit";
const INVITE_ACTION: &str = "tenant.member.invite";
/// 凭据的随机字节数：256 位，猜中一个在途邀请在计算上不可行
const CREDENTIAL_BYTES: usize = 32;

fn rfc3339(t: DateTime<Utc>) -> String {
    t.to_rfc3339_opts(chrono::SecondsFormat::AutoSi, true)
}

/// 凭据的摘要。库里只有它；兑换以它定位邀请。
fn digest(credential: &str) -> String {
    hex::encode(Sha256::digest(credential.as_bytes()))
}

// ---------------------------------------------------------------------------
// 签发与撤回（在 governance 的准入事务里调用）
// ---------------------------------------------------------------------------

/// 刚签发的邀请。明文凭据只存在于这个值里，交给回应后即丢弃。
pub struct Issued {
    invitation_id: Uuid,
    credential: String,
    expires_at: DateTime<Utc>,
}

impl Issued {
    pub fn into_contract(self, link_base: &str) -> InvitationClass {
        InvitationClass {
            invitation_id: self.invitation_id.to_string(),
            link: format!("{link_base}#{}", self.credential),
            expires_at: rfc3339(self.expires_at),
        }
    }
}

/// ISSUED 且未过期才可兑换或撤回；其余各有确定的拒绝原因。
pub(crate) fn issued_or_refusal(state: &str, live: bool) -> Result<(), Refusal> {
    match (state, live) {
        ("ISSUED", true) => Ok(()),
        ("ISSUED", false) => Err(Refusal::Conflict(ReasonCode::InvitationExpired)),
        ("REDEEMED", _) => Err(Refusal::Conflict(ReasonCode::InvitationAlreadyRedeemed)),
        ("REVOKED", _) => Err(Refusal::Conflict(ReasonCode::InvitationRevoked)),
        // 库的 CHECK 只允许上面三个值；读出别的就是库与代码漂移了
        _ => Err(Refusal::Unavailable(format!(
            "邀请状态 {state} 不在状态机内"
        ))),
    }
}

pub(crate) async fn issue(
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    label: &str,
    ttl_seconds: i64,
) -> Result<Issued, Refusal> {
    let mut raw = [0u8; CREDENTIAL_BYTES];
    getrandom::fill(&mut raw)
        .map_err(|e| Refusal::Unavailable(format!("系统随机源不可用: {e}")))?;
    let credential = hex::encode(raw);
    let expires_at: DateTime<Utc> = sqlx::query_scalar(
        "insert into identity.tenant_invitation
             (id, tenant_id, inviter_principal_id, issue_action_execution_id, invitee_label,
              credential_digest, expires_at, state)
         values ($1, $2, $3, $4, $5, $6,
                 date_trunc('second', now()) + make_interval(secs => $7::bigint), 'ISSUED')
         returning expires_at",
    )
    .bind(ae.target_id)
    .bind(ae.tenant_id)
    .bind(ae.initiator_principal_id)
    .bind(ae.id)
    .bind(label)
    .bind(digest(&credential))
    .bind(ttl_seconds)
    .fetch_one(&mut **tx)
    .await?;
    Ok(Issued {
        invitation_id: ae.target_id,
        credential,
        expires_at,
    })
}

/// 撤回一份仍可兑换的邀请。准入时已按版本锁定并判定过；这里的条件是落定时的
/// 同一判定，二者之间过期了就按过期拒绝。
pub(crate) async fn revoke(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
    version: i32,
) -> Result<(), Refusal> {
    let done = sqlx::query(
        "update identity.tenant_invitation
         set state = 'REVOKED', revoked_at = now(), version = version + 1
         where id = $1 and version = $2 and state = 'ISSUED' and expires_at > now()",
    )
    .bind(id)
    .bind(version)
    .execute(&mut **tx)
    .await?;
    if done.rows_affected() == 0 {
        return Err(Refusal::Conflict(ReasonCode::InvitationExpired));
    }
    Ok(())
}

/// 开通的门禁以任何方式关闭（准入拒绝、审批否决/过期/撤回/失效、重新准入不通过、
/// 判定停滞超时）而未派发：兑换建立的 INVITED membership 进入 REVOKED。与门禁的
/// 关闭同事务，不存在「门禁已终结而 membership 永远停在 INVITED」的状态。
pub(crate) async fn settle_refused_admission(
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    def: &Definition,
    reason: &ReasonCode,
) -> Result<(), sqlx::Error> {
    if Semantic::from_key(&ae.action_key) != Some(Semantic::TenantMemberAdmit) {
        return Ok(());
    }
    let settled: Option<i32> = sqlx::query_scalar(
        "update identity.tenant_membership set state = 'REVOKED', version = version + 1
         where id = $1 and state = 'INVITED' returning version",
    )
    .bind(ae.target_id)
    .fetch_optional(&mut **tx)
    .await?;
    let Some(version) = settled else {
        return Ok(());
    };
    append(
        tx,
        AuditEntry {
            event_key: format!("{}:invitation-settled", ae.operation_id),
            tenant_id: Some(ae.tenant_id),
            workspace_id: None,
            operation_id: ae.operation_id,
            event_type: "REVOCATION",
            human_identity_id: None,
            initiator_principal_id: Some(ae.initiator_principal_id),
            actor_principal_id: Some(ae.actor_principal_id),
            action_key: &ae.action_key,
            action_version: ae.action_version,
            component_type_key: &def.component_type_key,
            target_type: Some(&def.target_type),
            target_id: Some(ae.target_id),
            parameter_hash: &ae.parameter_hash,
            decision: "DENY",
            result_code: &wire(reason),
            result_exposure: &def.result_exposure,
            evidence_refs: json!([
                { "kind": "TENANT_MEMBERSHIP_STATE", "value": "REVOKED" },
                { "kind": "TENANT_MEMBERSHIP_VERSION", "value": version },
            ]),
            correlation_id: ae.correlation_id,
        },
    )
    .await
}

// ---------------------------------------------------------------------------
// 兑换
// ---------------------------------------------------------------------------

fn identity_headers(headers: &HeaderMap) -> Option<(String, String)> {
    let h = |n: &str| {
        headers
            .get(n)
            .and_then(|v| v.to_str().ok())
            .filter(|v| !v.is_empty())
            .map(str::to_owned)
    };
    Some((h(HEADER_ISSUER)?, h(HEADER_SUBJECT)?))
}

/// 与凭据匹配上的那份邀请。
#[derive(sqlx::FromRow)]
struct Matched {
    id: Uuid,
    tenant_id: Uuid,
    inviter_principal_id: Uuid,
    issue_action_execution_id: Uuid,
    state: String,
    live: bool,
    redeemed_human_identity_id: Option<Uuid>,
    admit_action_execution_id: Option<Uuid>,
    tenant_state: String,
}

/// 兑换的结论：这份邀请与它的开通 ActionExecution。
struct Redeemed {
    invitation: Uuid,
    admit: Uuid,
}

/// 兑换被拒的留痕。凭据没有对上任何邀请时不知道 Tenant，只能记在 OIDC 之后、成员
/// 解析之前的那段边界上（AUTHENTICATION，tenant 为空，DD-52/54）；对上了就记在该
/// Tenant 的邀请名下。写失败只记日志：请求本身已被拒。
async fn record_refused(
    g: &Governance,
    issuer: &str,
    subject: &str,
    matched: Option<&Matched>,
    human: Option<Uuid>,
    reason: &ReasonCode,
) {
    let operation_id = Uuid::new_v4();
    let code = wire(reason);
    let entry = AuditEntry {
        event_key: format!("invitation-redeem-denied:{operation_id}"),
        tenant_id: matched.map(|m| m.tenant_id),
        workspace_id: None,
        operation_id,
        event_type: if matched.is_some() {
            "DECISION"
        } else {
            "AUTHENTICATION"
        },
        human_identity_id: human,
        initiator_principal_id: matched.map(|m| m.inviter_principal_id),
        actor_principal_id: None,
        action_key: INVITE_ACTION,
        action_version: 1,
        component_type_key: "core",
        target_type: matched.map(|_| "TENANT_INVITATION"),
        target_id: matched.map(|m| m.id),
        parameter_hash: "NONE",
        decision: "DENY",
        result_code: &code,
        result_exposure: "NONE",
        evidence_refs: subject_evidence(issuer, subject),
        correlation_id: operation_id,
    };
    let run = async {
        let mut tx = g.pool.begin().await?;
        append(&mut tx, entry).await?;
        tx.commit().await
    };
    if let Err(e) = run.await {
        tracing::warn!(error = %e, "兑换拒绝的审计未写入");
    }
}

impl Governance {
    /// 兑换事务。成功返回邀请与开通 ActionExecution；同一 Human 重复兑换返回原结果。
    /// 任何拒绝都不消耗邀请：事务回滚，邀请保持原状。拒绝带回已匹配的邀请与已知的
    /// 兑换者，只为留痕。
    #[allow(clippy::result_large_err)]
    async fn redeem_in_tx(
        &self,
        issuer: &str,
        subject: &str,
        credential: &str,
        display_name: &str,
    ) -> Result<Redeemed, (Refusal, Option<Matched>, Option<Uuid>)> {
        let fail = |r: Refusal| (r, None, None);
        let mut tx = self.pool.begin().await.map_err(|e| fail(e.into()))?;
        // 行锁：并发兑换同一凭据的请求在这里排队，后到的读到先到的结论
        let matched: Option<Matched> = sqlx::query_as(
            "select ti.id, ti.tenant_id, ti.inviter_principal_id, ti.issue_action_execution_id,
                    ti.state, ti.expires_at > now() as live, ti.redeemed_human_identity_id,
                    ti.admit_action_execution_id, t.state as tenant_state
             from identity.tenant_invitation ti
             join identity.tenant t on t.id = ti.tenant_id
             where ti.credential_digest = $1
             for update of ti",
        )
        .bind(digest(credential))
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| fail(e.into()))?;
        let Some(m) = matched else {
            return Err(fail(Refusal::Precondition(ReasonCode::InvitationNotFound)));
        };
        // 同一人：先于任何检查排队，免得两次并发兑换（或兑换与引导）各自看到「此人
        // 还不是任何 Tenant 的成员」
        crate::external_human::lock_subject(&mut tx, issuer, subject)
            .await
            .map_err(|e| fail(e.into()))?;
        let known = crate::external_human::find(&mut tx, issuer, subject)
            .await
            .map_err(|e| fail(e.into()))?;
        let human = known.map(|(h, _)| h);
        let refuse = |r: Refusal, m: Matched| Err((r, Some(m), human));
        if matches!(known, Some((_, false))) {
            return refuse(Refusal::Denied(ReasonCode::IdentityUnknown), m);
        }

        if m.state == "REDEEMED" {
            // 同一 Human 重复兑换：回答原结果（回应丢失后的重试走到这里）
            return match (
                human,
                m.redeemed_human_identity_id,
                m.admit_action_execution_id,
            ) {
                (Some(h), Some(r), Some(admit)) if h == r => Ok(Redeemed {
                    invitation: m.id,
                    admit,
                }),
                _ => refuse(Refusal::Conflict(ReasonCode::InvitationAlreadyRedeemed), m),
            };
        }
        if let Err(r) = issued_or_refusal(&m.state, m.live) {
            return refuse(r, m);
        }
        if m.tenant_state != "ACTIVE" {
            return refuse(Refusal::Conflict(ReasonCode::TargetStateConflict), m);
        }

        // 已是成员（或在途）的人不再消耗邀请；在其他 Tenant 有非 REVOKED membership
        // 的人兑换后会因一期没有 Tenant 选择入口而哪里都登录不了，同样拒绝
        let mut existing: Option<(Uuid, Uuid, i32)> = None;
        if let Some(h) = human {
            let rows: Vec<(Uuid, Uuid, Uuid, String, i32)> = sqlx::query_as(
                "select tenant_id, id, tenant_principal_id, state, version
                 from identity.tenant_membership where human_identity_id = $1",
            )
            .bind(h)
            .fetch_all(&mut *tx)
            .await
            .map_err(|e| fail(e.into()))?;
            for (tenant, id, principal, state, version) in rows {
                match (tenant == m.tenant_id, state.as_str()) {
                    (true, "REVOKED") => existing = Some((id, principal, version)),
                    (true, _) => {
                        return refuse(Refusal::Conflict(ReasonCode::InviteeAlreadyMember), m)
                    }
                    (false, "REVOKED") => {}
                    (false, _) => {
                        return refuse(Refusal::Blocked(ReasonCode::TenantSelectionNotAvailable), m)
                    }
                }
            }
        }

        let human = match human {
            Some(h) => h,
            None => match crate::external_human::ensure(
                &mut tx,
                issuer,
                &self.cfg.human_oidc_client_id,
                subject,
                display_name,
            )
            .await
            {
                Ok(Some(h)) => h,
                Ok(None) => return refuse(Refusal::Denied(ReasonCode::IdentityUnknown), m),
                Err(e) => return Err((e.into(), Some(m), None)),
            },
        };

        // membership：已撤权的以新 version 复用（成员恢复），否则新建 HUMAN Principal
        let (membership, principal, version) = match existing {
            Some((id, principal, version)) => {
                let v: Option<i32> = sqlx::query_scalar(
                    "update identity.tenant_membership set state = 'INVITED', version = version + 1
                     where id = $1 and version = $2 and state = 'REVOKED' returning version",
                )
                .bind(id)
                .bind(version)
                .fetch_optional(&mut *tx)
                .await
                .map_err(|e| (e.into(), None, Some(human)))?;
                match v {
                    Some(v) => (id, principal, v),
                    None => return refuse(Refusal::Conflict(ReasonCode::TargetStateConflict), m),
                }
            }
            None => {
                let (id, principal) = (Uuid::new_v4(), Uuid::new_v4());
                let created = async {
                    sqlx::query(
                        "insert into identity.principal (id, tenant_id, kind, status)
                         values ($1, $2, 'HUMAN', 'ACTIVE')",
                    )
                    .bind(principal)
                    .bind(m.tenant_id)
                    .execute(&mut *tx)
                    .await?;
                    sqlx::query_scalar::<_, i32>(
                        "insert into identity.tenant_membership
                             (id, tenant_id, human_identity_id, tenant_principal_id, state)
                         values ($1, $2, $3, $4, 'INVITED') returning version",
                    )
                    .bind(id)
                    .bind(m.tenant_id)
                    .bind(human)
                    .bind(principal)
                    .fetch_one(&mut *tx)
                    .await
                }
                .await;
                match created {
                    Ok(v) => (id, principal, v),
                    Err(sqlx::Error::Database(e)) if e.is_unique_violation() => {
                        return refuse(Refusal::Conflict(ReasonCode::InviteeAlreadyMember), m)
                    }
                    Err(e) => return Err((e.into(), Some(m), Some(human))),
                }
            }
        };

        // 开通：以邀请人为发起者，幂等键取邀请 ID（一份邀请至多一次开通），关联到
        // 签发邀请的 operation，使整条邀请可按一个 ID 查出
        let def = match active_definition(&self.pool, ADMIT_ACTION).await {
            Ok(Some(d)) => d,
            Ok(None) => return refuse(Refusal::Blocked(ReasonCode::CapabilityBlocked), m),
            Err(e) => return Err((e.into(), Some(m), Some(human))),
        };
        let issue: Result<(Uuid, i32, String), _> = sqlx::query_as(
            "select operation_id, action_version, parameter_hash
             from admission.action_execution where id = $1",
        )
        .bind(m.issue_action_execution_id)
        .fetch_one(&mut *tx)
        .await;
        let (issue_operation, issue_version, issue_hash) = match issue {
            Ok(v) => v,
            Err(e) => return Err((e.into(), Some(m), Some(human))),
        };
        let actor = Actor {
            tenant_id: m.tenant_id,
            principal_id: m.inviter_principal_id,
            human_identity_id: None,
        };
        let target = Target {
            id: membership,
            version,
            workspace_id: None,
        };
        let params = Params {
            workspace_id: None,
            principal_id: Some(principal),
            slug: None,
            name: None,
            invitation_id: Some(m.id),
        };
        let admit = match open_execution(
            &mut tx,
            actor,
            &def,
            &target,
            &params,
            m.id,
            Some(issue_operation),
        )
        .await
        {
            Ok(ae) => ae,
            Err(e) => return Err((e.into(), Some(m), Some(human))),
        };

        let redeemed = sqlx::query(
            "update identity.tenant_invitation
             set state = 'REDEEMED', redeemed_human_identity_id = $2, tenant_membership_id = $3,
                 redeemed_at = now(), admit_action_execution_id = $4, version = version + 1
             where id = $1 and state = 'ISSUED' and expires_at > now()",
        )
        .bind(m.id)
        .bind(human)
        .bind(membership)
        .bind(admit.id)
        .execute(&mut *tx)
        .await;
        match redeemed {
            Ok(r) if r.rows_affected() == 1 => {}
            // 行锁之下只剩时间会变：读到时未过期、写入时已过期
            Ok(_) => return refuse(Refusal::Conflict(ReasonCode::InvitationExpired), m),
            Err(e) => return Err((e.into(), Some(m), Some(human))),
        }

        let mut evidence = subject_evidence(issuer, subject);
        if let Some(arr) = evidence.as_array_mut() {
            arr.push(json!({ "kind": "ADMIT_ACTION_EXECUTION_ID", "value": admit.id }));
            arr.push(json!({ "kind": "TENANT_MEMBERSHIP_ID", "value": membership }));
        }
        let audited = append(
            &mut tx,
            AuditEntry {
                event_key: format!("{issue_operation}:redeemed"),
                tenant_id: Some(m.tenant_id),
                workspace_id: None,
                operation_id: issue_operation,
                event_type: "OUTCOME",
                human_identity_id: Some(human),
                initiator_principal_id: Some(m.inviter_principal_id),
                actor_principal_id: Some(principal),
                action_key: INVITE_ACTION,
                action_version: issue_version,
                component_type_key: "core",
                target_type: Some("TENANT_INVITATION"),
                target_id: Some(m.id),
                parameter_hash: &issue_hash,
                decision: "ALLOW",
                result_code: "INVITATION_REDEEMED",
                result_exposure: "NONE",
                evidence_refs: evidence,
                correlation_id: issue_operation,
            },
        )
        .await;
        if let Err(e) = audited {
            return Err((e.into(), Some(m), Some(human)));
        }
        if let Err(e) = tx.commit().await {
            return Err((e.into(), Some(m), Some(human)));
        }
        Ok(Redeemed {
            invitation: m.id,
            admit: admit.id,
        })
    }

    async fn redemption_view(
        &self,
        invitation: Uuid,
    ) -> Result<Option<InvitationRedemptionView>, Refusal> {
        let row: Option<RedemptionRow> =
            sqlx::query_as(&format!("{REDEMPTION_QUERY} where ti.id = $1"))
                .bind(invitation)
                .fetch_optional(&self.pool)
                .await?;
        row.map(RedemptionRow::view).transpose()
    }
}

#[derive(sqlx::FromRow)]
struct RedemptionRow {
    id: Uuid,
    tenant_id: Uuid,
    tenant_name: String,
    membership_state: String,
    gate_state: String,
    reason_code: Option<String>,
    redeemed_at: DateTime<Utc>,
}

const REDEMPTION_QUERY: &str = "
    select ti.id, ti.tenant_id, t.name as tenant_name, tm.state as membership_state,
           ae.gate_state, ae.reason_code, ti.redeemed_at
    from identity.tenant_invitation ti
    join identity.tenant t on t.id = ti.tenant_id
    join identity.tenant_membership tm on tm.id = ti.tenant_membership_id
    join admission.action_execution ae on ae.id = ti.admit_action_execution_id";

impl RedemptionRow {
    fn view(self) -> Result<InvitationRedemptionView, Refusal> {
        let bad = |c: &str, v: &str| Refusal::Unavailable(format!("{c}={v} 不在契约枚举内"));
        Ok(InvitationRedemptionView {
            invitation_id: self.id.to_string(),
            tenant_id: self.tenant_id.to_string(),
            tenant_name: self.tenant_name,
            membership_state: parse::<TenantMembershipState>(&self.membership_state)
                .ok_or_else(|| bad("membership_state", &self.membership_state))?,
            admission_gate_state: parse::<ActionGateState>(&self.gate_state)
                .ok_or_else(|| bad("gate_state", &self.gate_state))?,
            reason: self.reason_code.as_deref().and_then(parse),
            redeemed_at: rfc3339(self.redeemed_at),
        })
    }
}

/// `POST /api/v1/invitations/redeem`。不要求 PlatformSession——兑换者此刻还不是任何
/// 成员；身份只取网关投影的 issuer/subject。
pub async fn redeem(
    State(state): State<BffState>,
    headers: HeaderMap,
    body: Result<Json<InvitationRedemptionRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let g = &state.governance;
    let Some((issuer, subject)) = identity_headers(&headers) else {
        return Refusal::Denied(ReasonCode::IdentityHeaderMissing).respond(None);
    };
    let Ok(Json(req)) = body else {
        return Refusal::Precondition(ReasonCode::InvalidParameters).respond(None);
    };
    let display_name = req.display_name.trim();
    if req.credential.is_empty() || display_name.is_empty() {
        return Refusal::Precondition(ReasonCode::InvalidParameters).respond(None);
    }
    // 只认部署 IdP：ExternalIdentity 登记在它名下，身份解析也只在它名下找人
    if issuer != g.cfg.human_oidc_issuer {
        record_refused(
            g,
            &issuer,
            &subject,
            None,
            None,
            &ReasonCode::IdentityUnknown,
        )
        .await;
        return Refusal::Denied(ReasonCode::IdentityUnknown).respond(None);
    }
    let redeemed = match g
        .redeem_in_tx(&issuer, &subject, &req.credential, display_name)
        .await
    {
        Ok(r) => r,
        Err((r @ Refusal::Unavailable(_), _, _)) => return r.respond(None),
        Err((r, matched, human)) => {
            record_refused(g, &issuer, &subject, matched.as_ref(), human, &r.reason()).await;
            return r.respond(None);
        }
    };
    // 开通的判定：仍 EVALUATING 才判（首次兑换，或上次判定时依赖不可用）。拒绝已随
    // 门禁落库并终结了 membership，下面的视图如实反映；依赖不可用则保持 EVALUATING，
    // 以同一凭据重试兑换会再判一次，超时由对账作业置 EXPIRED
    if let Err((r, _)) = g.decide_opened(redeemed.admit).await {
        if matches!(r, Refusal::Unavailable(_)) {
            tracing::warn!(action = %redeemed.admit, "开通判定未完成：依赖不可用");
        }
    }
    match g.redemption_view(redeemed.invitation).await {
        Ok(Some(v)) => {
            // 判定未落定就是结果不明：202，不说成功也不说失败
            let status = if v.admission_gate_state == ActionGateState::Evaluating {
                StatusCode::ACCEPTED
            } else {
                StatusCode::OK
            };
            (status, Json(v)).into_response()
        }
        Ok(None) => Refusal::Unavailable("兑换后的邀请消失".into()).respond(None),
        Err(r) => r.respond(None),
    }
}

/// `GET /api/v1/invitations/redemptions`：调用方自己兑换过的邀请与进度。同样不要求
/// PlatformSession：等待确认的人还没有会话。
pub async fn list_redemptions(State(state): State<BffState>, headers: HeaderMap) -> Response {
    let g = &state.governance;
    let Some((issuer, subject)) = identity_headers(&headers) else {
        return Refusal::Denied(ReasonCode::IdentityHeaderMissing).respond(None);
    };
    let rows: Result<Vec<RedemptionRow>, _> = sqlx::query_as(&format!(
        "{REDEMPTION_QUERY}
         join identity.external_identity ei on ei.human_identity_id = ti.redeemed_human_identity_id
         where ei.issuer = $1 and ei.subject = $2 and ei.status = 'ACTIVE'
         order by ti.redeemed_at desc limit $3"
    ))
    .bind(&issuer)
    .bind(&subject)
    .bind(g.cfg.page_limit)
    .fetch_all(&g.pool)
    .await;
    match rows {
        Ok(rows) => match rows
            .into_iter()
            .map(RedemptionRow::view)
            .collect::<Result<Vec<_>, _>>()
        {
            Ok(v) => (StatusCode::OK, Json(v)).into_response(),
            Err(r) => r.respond(None),
        },
        Err(e) => Refusal::from(e).respond(None),
    }
}

// ---------------------------------------------------------------------------
// 管理视图
// ---------------------------------------------------------------------------

#[derive(sqlx::FromRow)]
struct InvitationRow {
    id: Uuid,
    invitee_label: String,
    inviter_principal_id: Uuid,
    state: String,
    live: bool,
    expires_at: DateTime<Utc>,
    created_at: DateTime<Utc>,
    redeemed_at: Option<DateTime<Utc>>,
    redeemer_display_name: Option<String>,
    tenant_membership_id: Option<Uuid>,
    membership_state: Option<String>,
    admit_action_execution_id: Option<Uuid>,
    approval_workflow_id: Option<String>,
    approval_status: Option<String>,
}

/// `GET /api/v1/invitations`：本 Tenant 的邀请，新的在前。只对持有 Tenant manage 的
/// 人可见。这一次 Check 是整张列表的门禁而不是逐条过滤：它放出的是兑换者自报的名字与
/// 在途确认，按 `.design/10` §1 取 FullyConsistent——低延迟一致性会让刚被撤掉 admin
/// 的人在 quantization 窗口内继续看到，也会让刚授予的人被挡住。
pub async fn list_invitations(State(state): State<BffState>, headers: HeaderMap) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    let g = &state.governance;
    match g
        .spicedb
        .check(
            "tenant",
            &ctx.tenant_id.to_string(),
            "manage",
            &ctx.tenant_principal_id.to_string(),
            Consistency::FullyConsistent,
        )
        .await
    {
        Ok(c) if c.allowed => {}
        Ok(_) => return Refusal::Denied(ReasonCode::PermissionDenied).respond(None),
        Err(e) => return Refusal::Unavailable(e.to_string()).respond(None),
    }
    let rows: Result<Vec<InvitationRow>, _> = sqlx::query_as(
        "select ti.id, ti.invitee_label, ti.inviter_principal_id, ti.state,
                ti.expires_at > now() as live, ti.expires_at, ti.created_at, ti.redeemed_at,
                hi.display_name as redeemer_display_name, ti.tenant_membership_id,
                tm.state as membership_state, ti.admit_action_execution_id,
                ae.approval_workflow_id, ap.status as approval_status
         from identity.tenant_invitation ti
         left join identity.human_identity hi on hi.id = ti.redeemed_human_identity_id
         left join identity.tenant_membership tm on tm.id = ti.tenant_membership_id
         left join admission.action_execution ae on ae.id = ti.admit_action_execution_id
         left join projection.approval_projection ap on ap.workflow_id = ae.approval_workflow_id
         where ti.tenant_id = $1
         order by ti.created_at desc limit $2",
    )
    .bind(ctx.tenant_id)
    .bind(g.cfg.page_limit)
    .fetch_all(&g.pool)
    .await;
    let rows = match rows {
        Ok(r) => r,
        Err(e) => return Refusal::from(e).respond(None),
    };
    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        let status = match (r.state.as_str(), r.live) {
            ("ISSUED", true) => TenantInvitationStatus::Issued,
            ("ISSUED", false) => TenantInvitationStatus::Expired,
            (s, _) => match db_enum::<TenantInvitationStatus>("tenant_invitation.state", s) {
                Ok(v) => v,
                Err(resp) => return resp,
            },
        };
        let membership_state = match r.membership_state.as_deref() {
            Some(s) => match db_enum::<TenantMembershipState>("tenant_membership.state", s) {
                Ok(v) => Some(v),
                Err(resp) => return resp,
            },
            None => None,
        };
        out.push(TenantInvitationView {
            invitation_id: r.id.to_string(),
            invitee_label: r.invitee_label,
            inviter_principal_id: r.inviter_principal_id.to_string(),
            status,
            expires_at: rfc3339(r.expires_at),
            created_at: rfc3339(r.created_at),
            redeemed_at: r.redeemed_at.map(rfc3339),
            redeemer_display_name: r.redeemer_display_name,
            membership_id: r.tenant_membership_id.map(|m| m.to_string()),
            membership_state,
            admit_action_execution_id: r.admit_action_execution_id.map(|a| a.to_string()),
            approval_workflow_id: r.approval_workflow_id,
            approval_status: r.approval_status.as_deref().and_then(parse),
        });
    }
    (StatusCode::OK, Json(out)).into_response()
}
