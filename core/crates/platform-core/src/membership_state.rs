//! 成员状态跃迁（`DD-41`、`DD-45`、`.design/09` 第 5 步）。
//!
//! 这里**不重做投影查证**。`.design/04` 把查证明确归给 Workflow：「Workflow 再撤
//! SpiceDB relationship、用 CONTROL identity 移除 Relay/Channel 成员并查证」。
//! 在 Core 里再验一遍 SpiceDB 就是第二份查证权威——两边判定一旦分歧，谁说了算
//! 没有答案，而这正是 `GOAL` 里「不复制出第二份权威」要避免的。
//!
//! Core 在这条路径上的职责是三件别人做不了的事：
//!
//! 1. **跃迁合法性**：状态机是 `.design/03` 固定的，非法跃迁一律拒绝；
//! 2. **乐观并发**：带上读到的版本，不匹配即冲突（`01` §7）；
//! 3. **可归属**：每次跃迁必须指向一个已登记的 `WorkflowRef`，且 kind 属于
//!    成员生命周期。没有它，状态就成了可以被任意服务调用改写的东西。
//!
//! Tenant 成员进入 `REVOKED` 还要求已无 active Resource/Asset owner 引用
//! （`DD-45`）。Workflow 消费本入口时，Core 在状态跃迁的同一事务内核对真实
//! Resource/Asset 的 owner 责任与未收敛投影，不重做上游查证。

use crate::audit::Evidence;
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use contracts::EvidenceKind;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::audit::{append, AuditEntry};
use crate::membership_projection::MembershipScope;
use crate::service_api::{authorize, unavailable, ServiceState};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransitionRequest {
    pub scope: MembershipScope,
    pub membership_id: Uuid,
    /// 读到的版本。不匹配即冲突——中途被别的动作改过的事实不能被覆盖。
    pub from_version: i32,
    pub to_state: String,
    /// 负责这次跃迁的 Workflow。它必须已登记且 kind 属于成员生命周期。
    pub workflow_id: String,
    /// DD-164(6)：只随 Tenant 撤权跃迁到 REVOKED 出现，是该链结束 IdP 会话的结果计数；
    /// 在同一事务写审计 `IDP_SESSIONS_TERMINATED`。不含 subject。
    #[serde(default)]
    pub identity_provider_sessions: Option<IdpSessionCounts>,
}

/// IdP 用户退出接口的回应类别计数（Worker `EndSessionsOutput`）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IdpSessionCounts {
    pub identities: u32,
    /// IdP 结束了会话（204）
    pub ended: u32,
    /// IdP 中已无该用户（404）
    pub absent: u32,
    /// issuer 不是部署 IdP
    pub foreign: u32,
}

/// 一次撤权处理的外部身份数上界：Core 冻结的是一个人的身份，远小于此。
const MAX_IDP_IDENTITIES: u32 = 1000;

impl IdpSessionCounts {
    fn valid(&self) -> bool {
        self.identities <= MAX_IDP_IDENTITIES
            && self
                .ended
                .checked_add(self.absent)
                .and_then(|n| n.checked_add(self.foreign))
                == Some(self.identities)
    }

    fn evidence(&self) -> String {
        format!(
            "identities={};ended={};user_unknown={};foreign_issuer={}",
            self.identities, self.ended, self.absent, self.foreign
        )
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransitionResponse {
    pub state: String,
    pub version: i32,
}

/// `.design/03` §3 固定的成员状态机。两张表的取值不同，因此分开列。
///
/// 写成表而不是 if 链：合法跃迁是设计事实，列出来就能逐条对照 `.design`，
/// 而条件分支会随着每次改动长出说不清来历的组合。
const TENANT_TRANSITIONS: &[(&str, &str)] = &[
    ("INVITED", "PROVISIONING"),
    ("INVITED", "REVOKED"),
    ("PROVISIONING", "ACTIVE"),
    ("PROVISIONING", "ERROR"),
    ("ACTIVE", "REVOKING"),
    ("REVOKING", "REVOKED"),
    ("REVOKING", "ERROR"),
    ("ERROR", "REVOKING"),
];

const WORKSPACE_TRANSITIONS: &[(&str, &str)] = &[
    ("PROVISIONING", "ACTIVE"),
    ("PROVISIONING", "ERROR"),
    ("ACTIVE", "REVOKING"),
    ("REVOKING", "REVOKED"),
    ("REVOKING", "ERROR"),
    ("ERROR", "REVOKING"),
];

pub async fn transition_membership(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    body: Result<Json<TransitionRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if let Err(e) = authorize(&state, &headers).await {
        return e;
    }
    let Ok(Json(req)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };

    // 可归属：跃迁必须指向一个已登记的成员生命周期 Workflow。
    // 两个 kind 共用同一套跃迁——建立与撤权是同一条状态机的两个方向（DD-45）。
    let wf = sqlx::query!(
        "select kind, tenant_id, operation_id from projection.workflow_ref where workflow_id = $1",
        req.workflow_id
    )
    .fetch_optional(&state.pool)
    .await;
    let wf_kind = wf
        .as_ref()
        .ok()
        .and_then(|row| row.as_ref())
        .and_then(|row| row.kind.clone());
    let (wf_tenant, wf_operation, workspace_creation) = match wf {
        Ok(Some(row))
            if matches!(
                row.kind.as_deref(),
                Some("MEMBERSHIP_PROJECTION")
                    | Some("MEMBERSHIP_REVOCATION")
                    | Some("WORKSPACE_LIFECYCLE")
            ) =>
        {
            (
                row.tenant_id,
                row.operation_id,
                row.kind.as_deref() == Some("WORKSPACE_LIFECYCLE"),
            )
        }
        Ok(_) => {
            tracing::warn!(
                workflow_id = %req.workflow_id,
                "跃迁未指向已登记的成员生命周期 Workflow"
            );
            return StatusCode::FORBIDDEN.into_response();
        }
        Err(e) => return unavailable(e),
    };

    // DD-164(6)：IdP 会话计数只属于 Tenant 撤权链进入 REVOKED 的那一次跃迁，且必须自洽。
    if let Some(counts) = &req.identity_provider_sessions {
        if !idp_counts_admissible(&req, wf_kind.as_deref(), counts) {
            tracing::warn!(membership = %req.membership_id, "IdP 会话计数不属于这次跃迁或不自洽");
            return StatusCode::BAD_REQUEST.into_response();
        }
    }

    let allowed = match req.scope {
        MembershipScope::Tenant => TENANT_TRANSITIONS,
        MembershipScope::Workspace => WORKSPACE_TRANSITIONS,
    };

    // 跃迁、版本与状态机在同一条 UPDATE 里判定：分成「先读再写」会在两步之间
    // 留下窗口，并发的撤权会被随后的 ACTIVE 覆盖掉。
    //
    // `from_state = any(...)` 取的是能到达 to_state 的全部来源状态；来源为空
    // 说明 to_state 根本不是该状态机的合法目标。
    let froms: Vec<String> = allowed
        .iter()
        .filter(|(_, to)| *to == req.to_state)
        .map(|(from, _)| (*from).to_owned())
        .collect();
    if froms.is_empty() {
        tracing::warn!(to = %req.to_state, "目标状态不在该状态机内");
        return StatusCode::FORBIDDEN.into_response();
    }

    let mut tx = match state.pool.begin().await {
        Ok(t) => t,
        Err(e) => return unavailable(e),
    };
    if workspace_creation {
        if req.scope != MembershipScope::Workspace || req.to_state != "ACTIVE" {
            return StatusCode::FORBIDDEN.into_response();
        }
        // 仅同一新建 Workspace 的原始 HUMAN 创建者可由 scope Workflow 收尾。
        // 锁定来源事实，Tenant 撤权不能穿过校验把旧投影重新激活。
        let creator: Result<Option<(Uuid, i32)>, _> = sqlx::query_as(
            "select w.id, w.version from identity.workspace_membership wm
             join identity.workspace w on w.id = wm.workspace_id
             join admission.action_execution ae on ae.target_id = w.id
               and ae.initiator_principal_id = wm.tenant_principal_id
             join identity.tenant_membership tm on tm.tenant_principal_id = wm.tenant_principal_id
               and tm.tenant_id = w.tenant_id
             join identity.principal p on p.id = wm.tenant_principal_id
             join identity.tenant t on t.id = w.tenant_id
             where wm.id = $1 and wm.version = $2 and wm.state = 'PROVISIONING'
               and w.tenant_id = $3 and w.state = 'PROVISIONING'
               and ae.action_key = 'workspace.create' and ae.gate_state = 'ALLOWED'
               and tm.state = 'ACTIVE' and p.status = 'ACTIVE' and p.kind = 'HUMAN'
               and t.state = 'ACTIVE' for update of wm,w,tm,p,t",
        )
        .bind(req.membership_id)
        .bind(req.from_version)
        .bind(wf_tenant)
        .fetch_optional(&mut *tx)
        .await;
        match creator {
            Ok(Some((workspace, version)))
                if req.workflow_id
                    == crate::component_task::workflow_id(
                        "WORKSPACE_LIFECYCLE",
                        wf_tenant,
                        &workspace.to_string(),
                        version,
                    ) => {}
            Ok(_) => return StatusCode::CONFLICT.into_response(),
            Err(e) => return unavailable(e),
        }
    }
    if matches!(req.scope, MembershipScope::Tenant) {
        // 创建/转入 owner 与此处共用同一 membership 行锁；ACTIVE 的读与写不留窗口。
        let locked: Result<Option<Uuid>, _> =
            sqlx::query_scalar("select id from identity.tenant_membership where id=$1 for update")
                .bind(req.membership_id)
                .fetch_optional(&mut *tx)
                .await;
        match locked {
            Ok(Some(_)) => {}
            Ok(None) => return StatusCode::NOT_FOUND.into_response(),
            Err(e) => return unavailable(e),
        }
    }
    // Tenant 成员进入 REVOKED 之前，他在本 Tenant 的 WorkspaceMembership 必须都已
    // 收敛出去（`.design/10` §5）：还有建立中、ACTIVE 或撤权中的，就说明 Channel
    // roster 尚未查证撤出，此时宣布 REVOKED 会让按邀请恢复的同一 Principal 带着
    // 旧的 Workspace 投影回来。Tenant 已不在 ACTIVE，Workspace 成员加入的准入已
    // 关门，因此这次判定与随后的 UPDATE 之间不会再长出新的成员关系。
    if matches!(req.scope, MembershipScope::Tenant) && req.to_state == "REVOKED" {
        let owned: Result<bool, _> = sqlx::query_scalar(
            "select exists(select 1 from identity.tenant_membership tm
             join identity.tenant t on t.id=tm.tenant_id
             where tm.id=$1 and t.state not in ('DELETING','DELETED')
               and (exists(select 1 from catalog.resource r
                      where r.tenant_id=tm.tenant_id and r.owner_principal_id=tm.tenant_principal_id
                        and (r.state not in ('DELETED','FAILED') or r.projection_action_execution_id is not null))
                    or exists(select 1 from catalog.asset a
                      where a.tenant_id=tm.tenant_id and a.owner_principal_id=tm.tenant_principal_id
                        and (a.state not in ('DELETED','FAILED') or a.projection_action_execution_id is not null))))",
        )
        .bind(req.membership_id)
        .fetch_one(&mut *tx)
        .await;
        match owned {
            Ok(false) => {}
            Ok(true) => {
                tracing::warn!(membership=%req.membership_id,"成员仍拥有 Resource/Asset 或未收敛投影，必须先治理转移或对账");
                return StatusCode::CONFLICT.into_response();
            }
            Err(e) => return unavailable(e),
        }
        let pending: Result<Option<i32>, _> = sqlx::query_scalar(
            "select 1 from identity.tenant_membership tm
             join identity.workspace w on w.tenant_id = tm.tenant_id
             join identity.workspace_membership wm
               on wm.workspace_id = w.id and wm.tenant_principal_id = tm.tenant_principal_id
             where tm.id = $1 and wm.state in ('PROVISIONING', 'ACTIVE', 'REVOKING')
             limit 1",
        )
        .bind(req.membership_id)
        .fetch_optional(&mut *tx)
        .await;
        match pending {
            Ok(None) => {}
            Ok(Some(_)) => {
                tracing::warn!(
                    membership = %req.membership_id,
                    "Tenant 成员仍有未收敛的 WorkspaceMembership，不进入 REVOKED"
                );
                return StatusCode::CONFLICT.into_response();
            }
            Err(e) => return unavailable(e),
        }
    }
    let updated = match req.scope {
        // DD-125(9)：转入 ACTIVE 的同一 UPDATE 记下进入时刻（重新加入覆盖），其余跃迁不动它。
        // 取语句执行时刻而非事务起点：前面的行锁可能等待，提醒游标按该时刻排序。
        MembershipScope::Tenant => sqlx::query_as::<_, (String, i32)>(
            "update identity.tenant_membership
                 set state = $1, version = version + 1,
                     activated_at = case when $1 = 'ACTIVE' then clock_timestamp() else activated_at end
                 where id = $2 and version = $3 and state = any($4)
                 returning state, version",
        )
        .bind(&req.to_state)
        .bind(req.membership_id)
        .bind(req.from_version)
        .bind(&froms)
        .fetch_optional(&mut *tx)
        .await,
        MembershipScope::Workspace => sqlx::query!(
            "update identity.workspace_membership
                 set state = $1, version = version + 1
                 where id = $2 and version = $3 and state = any($4)
                 returning state, version",
            req.to_state,
            req.membership_id,
            req.from_version,
            &froms
        )
        .fetch_optional(&mut *tx)
        .await
        .map(|o| o.map(|r| (r.state, r.version))),
    };

    match updated {
        Ok(Some((new_state, version))) => {
            // 审计与状态变化同事务：分两次提交，崩在中间就得到一次
            // 「发生过但没人记得」的撤权（.design/03 §9）。
            // 进入 REVOKING 即撤会话，与状态变化同事务（`.design/03` §3）。
            // 分两次提交，崩在中间就得到一个已被撤权却还能继续发请求的会话，
            // 而 REVOKING 的全部意义就是立刻关门。
            let revoked_sessions = if matches!(req.scope, MembershipScope::Tenant)
                && matches!(new_state.as_str(), "REVOKING" | "REVOKED")
            {
                match identity::session::revoke_for_membership(&mut tx, req.membership_id).await {
                    Ok(n) => n,
                    Err(e) => return unavailable(e),
                }
            } else {
                0
            };

            let entry = membership_audit(&req, &new_state, wf_tenant, wf_operation);
            if let Err(e) = append(&mut tx, entry).await {
                return unavailable(e);
            }
            // DD-164(6)：结束 IdP 会话的事实与 REVOKED 同事务入审计。
            if let Some(counts) = &req.identity_provider_sessions {
                let evidence = counts.evidence();
                if let Err(e) = append(
                    &mut tx,
                    idp_sessions_audit(&req, &evidence, wf_tenant, wf_operation),
                )
                .await
                {
                    return unavailable(e);
                }
            }
            if let Err(e) = tx.commit().await {
                return unavailable(e);
            }
            if revoked_sessions > 0 {
                tracing::info!(
                    membership = %req.membership_id,
                    revoked_sessions,
                    "撤权同时撤销了 PlatformSession"
                );
            }
            (
                StatusCode::OK,
                Json(TransitionResponse {
                    state: new_state,
                    version,
                }),
            )
                .into_response()
        }
        // 没有行被更新有三种成因：id 不存在、版本不匹配、当前状态不允许该跃迁。
        // 三者都是「按现在的事实这次跃迁不成立」，都不该重试；不逐一区分是因为
        // 区分需要再读一次，而那次读到的又可能是第四个版本。
        Ok(None) => {
            tracing::warn!(
                membership = %req.membership_id,
                to = %req.to_state,
                from_version = req.from_version,
                "跃迁不成立：版本不匹配或当前状态不允许"
            );
            StatusCode::CONFLICT.into_response()
        }
        Err(e) => unavailable(e),
    }
}

/// 计数只随 Tenant 撤权 Workflow 把成员推进到 REVOKED 时被接受，且各类别之和等于身份数。
fn idp_counts_admissible(
    req: &TransitionRequest,
    workflow_kind: Option<&str>,
    counts: &IdpSessionCounts,
) -> bool {
    matches!(req.scope, MembershipScope::Tenant)
        && req.to_state == "REVOKED"
        && workflow_kind == Some("MEMBERSHIP_REVOCATION")
        && counts.valid()
}

/// DD-164(6)：Tenant 撤权结束此人全部 IdP 会话的审计事实 `IDP_SESSIONS_TERMINATED`。
/// 证据只有处理的身份数与 IdP 回应类别计数，时间即事件时间；不含 subject。
fn idp_sessions_audit<'a>(
    req: &'a TransitionRequest,
    evidence: &'a str,
    tenant_id: Uuid,
    operation_id: Uuid,
) -> AuditEntry<'a> {
    AuditEntry {
        event_key: format!(
            "{}:{}:IDP_SESSIONS_TERMINATED",
            req.workflow_id, req.membership_id
        ),
        tenant_id: Some(tenant_id),
        workspace_id: None,
        operation_id,
        event_type: "REVOCATION",
        human_identity_id: None,
        initiator_principal_id: None,
        actor_principal_id: None,
        action_key: "membership.idp_sessions.terminate",
        action_version: 1,
        component_type_key: "core",
        target_type: Some("TENANT_MEMBERSHIP"),
        target_id: Some(req.membership_id),
        parameter_hash: "REVOKED",
        decision: "ALLOW",
        result_code: "IDP_SESSIONS_TERMINATED",
        result_exposure: "NONE",
        evidence_refs: vec![
            Evidence::new(EvidenceKind::TemporalWorkflowId, &req.workflow_id),
            Evidence::new(EvidenceKind::IdpSessionTerminationCounts, evidence),
        ],
        correlation_id: operation_id,
    }
}

/// 成员跃迁的审计事实。
///
/// `REVOKED` 记 `REVOCATION`，其余记 `OUTCOME`：撤权在 `.design/03` §9 的类型表
/// 里是独立一类，把它混进 OUTCOME 会让「按撤权取证」漏掉记录。
///
/// `event_key` 由 workflow ID、目标与目标状态构成，因此同一次跃迁重试算出同一个
/// 键；唯一约束据此拒绝第二条。
fn membership_audit<'a>(
    req: &'a TransitionRequest,
    new_state: &'a str,
    tenant_id: Uuid,
    operation_id: Uuid,
) -> AuditEntry<'a> {
    AuditEntry {
        event_key: format!("{}:{}:{}", req.workflow_id, req.membership_id, new_state),
        tenant_id: Some(tenant_id),
        workspace_id: None,
        operation_id,
        event_type: if new_state == "REVOKED" {
            "REVOCATION"
        } else {
            "OUTCOME"
        },
        human_identity_id: None,
        initiator_principal_id: None,
        actor_principal_id: None,
        action_key: "membership.transition",
        action_version: 1,
        component_type_key: "core",
        target_type: Some(match req.scope {
            MembershipScope::Tenant => "TENANT_MEMBERSHIP",
            MembershipScope::Workspace => "WORKSPACE_MEMBERSHIP",
        }),
        target_id: Some(req.membership_id),
        parameter_hash: new_state,
        decision: "ALLOW",
        result_code: new_state,
        result_exposure: "NONE",
        // Workflow 是这次跃迁的责任链起点，记它的 ID 就能顺回整条投影链
        evidence_refs: vec![Evidence::new(
            EvidenceKind::TemporalWorkflowId,
            &req.workflow_id,
        )],
        correlation_id: operation_id,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(
        scope: MembershipScope,
        to: &str,
        counts: Option<IdpSessionCounts>,
    ) -> TransitionRequest {
        TransitionRequest {
            scope,
            membership_id: Uuid::nil(),
            from_version: 3,
            to_state: to.to_owned(),
            workflow_id: "wf".to_owned(),
            identity_provider_sessions: counts,
        }
    }

    const COUNTS: IdpSessionCounts = IdpSessionCounts {
        identities: 3,
        ended: 1,
        absent: 1,
        foreign: 1,
    };

    // DD-164(6)：计数只属于 Tenant 撤权 Workflow 进入 REVOKED 的那次跃迁，且必须自洽。
    #[test]
    fn idp_counts_only_on_tenant_revocation_to_revoked() {
        let ok = request(MembershipScope::Tenant, "REVOKED", Some(COUNTS));
        assert!(idp_counts_admissible(
            &ok,
            Some("MEMBERSHIP_REVOCATION"),
            &COUNTS
        ));
        for (scope, to, kind) in [
            (
                MembershipScope::Workspace,
                "REVOKED",
                "MEMBERSHIP_REVOCATION",
            ),
            (MembershipScope::Tenant, "ERROR", "MEMBERSHIP_REVOCATION"),
            (MembershipScope::Tenant, "REVOKED", "MEMBERSHIP_PROJECTION"),
            (MembershipScope::Tenant, "REVOKED", "WORKSPACE_LIFECYCLE"),
        ] {
            let req = request(scope, to, Some(COUNTS));
            assert!(
                !idp_counts_admissible(&req, Some(kind), &COUNTS),
                "{to} {kind}"
            );
        }
        for bad in [
            IdpSessionCounts {
                identities: 2,
                ..COUNTS
            },
            IdpSessionCounts {
                identities: 4,
                ..COUNTS
            },
            IdpSessionCounts {
                identities: 2000,
                ended: 2000,
                absent: 0,
                foreign: 0,
            },
            IdpSessionCounts {
                identities: 0,
                ended: u32::MAX,
                absent: 1,
                foreign: 0,
            },
        ] {
            assert!(!idp_counts_admissible(
                &ok,
                Some("MEMBERSHIP_REVOCATION"),
                &bad
            ));
        }
        let none = IdpSessionCounts {
            identities: 0,
            ended: 0,
            absent: 0,
            foreign: 0,
        };
        assert!(idp_counts_admissible(
            &ok,
            Some("MEMBERSHIP_REVOCATION"),
            &none
        ));
    }

    #[test]
    fn idp_counts_payload_is_closed() {
        let parsed: TransitionRequest = serde_json::from_value(serde_json::json!({
            "scope": "TENANT", "membershipId": Uuid::nil(), "fromVersion": 3, "toState": "REVOKED",
            "workflowId": "wf",
            "identityProviderSessions": {"identities": 3, "ended": 1, "absent": 1, "foreign": 1}
        }))
        .unwrap();
        assert_eq!(parsed.identity_provider_sessions, Some(COUNTS));
        let legacy: TransitionRequest = serde_json::from_value(serde_json::json!({
            "scope": "TENANT", "membershipId": Uuid::nil(), "fromVersion": 3, "toState": "REVOKED",
            "workflowId": "wf"
        }))
        .unwrap();
        assert_eq!(legacy.identity_provider_sessions, None);
        assert!(serde_json::from_value::<TransitionRequest>(serde_json::json!({
            "scope": "TENANT", "membershipId": Uuid::nil(), "fromVersion": 3, "toState": "REVOKED",
            "workflowId": "wf",
            "identityProviderSessions": {"identities": 1, "ended": 1, "absent": 0, "foreign": 0, "subject": "x"}
        }))
        .is_err());
    }

    // 审计 IDP_SESSIONS_TERMINATED：REVOCATION 类、独立稳定键、证据只有 workflow 与计数。
    #[test]
    fn idp_sessions_audit_carries_counts_not_subjects() {
        let req = request(MembershipScope::Tenant, "REVOKED", Some(COUNTS));
        let evidence = COUNTS.evidence();
        assert_eq!(
            evidence,
            "identities=3;ended=1;user_unknown=1;foreign_issuer=1"
        );
        let entry = idp_sessions_audit(&req, &evidence, Uuid::nil(), Uuid::nil());
        assert_eq!(entry.event_type, "REVOCATION");
        assert_eq!(entry.result_code, "IDP_SESSIONS_TERMINATED");
        assert_eq!(
            entry.event_key,
            format!("wf:{}:IDP_SESSIONS_TERMINATED", Uuid::nil())
        );
        assert_ne!(
            entry.event_key,
            membership_audit(&req, "REVOKED", Uuid::nil(), Uuid::nil()).event_key
        );
        let kinds: Vec<_> = entry.evidence_refs.iter().map(|e| e.kind.clone()).collect();
        assert_eq!(
            kinds,
            [
                EvidenceKind::TemporalWorkflowId,
                EvidenceKind::IdpSessionTerminationCounts
            ]
        );
    }
}
