//! Tenant 成员邀请的端到端核验（DD-83、V-SCN-67，GAP-IDN-01 闭合）。
//!
//! 全部走真实拓扑：Tenant 与首位 admin 由部署引导建立；邀请的签发与撤回经 BFF 语义
//! 命令；兑换者是夹具生成的 OIDC subject，经与网关投影相同的两条 header 调 BFF；确认
//! 走真实 ApprovalWorkflow（Temporal + Worker），开通走既有 MEMBERSHIP_PROJECTION。
//! 断言以 Core 库、SpiceDB（zed）与 Temporal 投影为据，不以 BFF 的 200 为据。
//!
//! 夹具只写两样东西：一位非 admin 成员 C 的 OIDC 侧身份与成员关系（验证「无权者不能
//! 邀请」要有一个无权的成员），以及把某份邀请的时刻拨到过去（验证过期不需要等七天）。

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

mod common;
use common::bootstrapped::{add_member, bootstrap, subj, teardown, Member};
use common::{approval_status, bff, gate_of, reason, state_of, submit, until, Env};
use contracts::{InvitationRedemptionView, TenantInvitationView};

struct World {
    tenant: Uuid,
    a: Member,
    c: Member,
}

fn fresh_subject(tag: &str) -> String {
    format!("inv-{tag}-{}", &Uuid::new_v4().to_string()[..8])
}

#[tokio::test]
async fn invitations_are_redeemed_once_confirmed_by_an_admin_and_always_terminate() {
    let Some(e) = common::env() else { return };
    let http = reqwest::Client::new();
    let pool = PgPool::connect(&e.database_url).await.expect("连 Core 库");
    let token = common::worker_token(&http, &e).await;
    let slug = format!("i{}", &Uuid::new_v4().to_string()[..8]);
    let a_subject = fresh_subject("a");

    let (code, out) = bootstrap(&slug, &a_subject, e.converge_bound_secs * 2);
    assert_eq!(code, 0, "引导应完成：{out}");
    let tenant = Uuid::parse_str(out["tenantId"].as_str().unwrap()).unwrap();
    let a_principal = Uuid::parse_str(out["adminPrincipalId"].as_str().unwrap()).unwrap();
    let initiator: Uuid = sqlx::query_scalar(
        "select principal_id from identity.service_principal where audience = 'kailo-deployment-bootstrap'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let (a_human, a_membership): (Uuid, Uuid) = sqlx::query_as(
        "select human_identity_id, id from identity.tenant_membership where tenant_principal_id = $1",
    )
    .bind(a_principal)
    .fetch_one(&pool)
    .await
    .unwrap();
    let c = match add_member(&http, &e, &pool, &token, tenant, initiator).await {
        Ok(m) => m,
        Err(err) => {
            teardown(&e, &pool, tenant, &[a_human]).await;
            panic!("开通成员失败：{err}");
        }
    };
    let w = World {
        tenant,
        a: Member {
            subject: a_subject,
            principal: a_principal,
            human: a_human,
            membership: a_membership,
        },
        c,
    };

    let outcome = std::panic::AssertUnwindSafe(scenarios(&http, &e, &pool, &w));
    let result = futures_util::FutureExt::catch_unwind(outcome).await;
    let mut humans: Vec<Uuid> = sqlx::query_scalar(
        "select distinct redeemed_human_identity_id from identity.tenant_invitation
         where tenant_id = $1 and redeemed_human_identity_id is not null",
    )
    .bind(tenant)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();
    humans.extend([w.a.human, w.c.human]);
    teardown(&e, &pool, tenant, &humans).await;
    if let Err(p) = result {
        std::panic::resume_unwind(p);
    }
}

/// 签发一份邀请，返回（邀请 ID，明文凭据，签发的 ActionExecution）。
async fn invite(
    http: &reqwest::Client,
    e: &Env,
    subject: &str,
    label: &str,
) -> (Uuid, String, Uuid) {
    let key = Uuid::new_v4();
    let (st, body) = submit(
        http,
        e,
        subject,
        json!({"actionKey":"tenant.member.invite","idempotencyKey":key,"name":label}),
    )
    .await;
    assert_eq!(st, reqwest::StatusCode::OK, "签发邀请：{body}");
    let link = body["invitation"]["link"].as_str().expect("首次回应带链接");
    let (_, credential) = link.split_once('#').expect("凭据在 fragment 里");
    (
        Uuid::parse_str(body["invitation"]["invitationId"].as_str().unwrap()).unwrap(),
        credential.to_owned(),
        Uuid::parse_str(body["actionExecutionId"].as_str().unwrap()).unwrap(),
    )
}

async fn redeem(
    http: &reqwest::Client,
    e: &Env,
    subject: &str,
    credential: &str,
    name: &str,
) -> (reqwest::StatusCode, Value) {
    bff(
        http,
        e,
        subject,
        reqwest::Method::POST,
        "/api/v1/invitations/redeem",
        Some(json!({"credential":credential,"displayName":name})),
    )
    .await
}

async fn invitation_state(pool: &PgPool, id: Uuid) -> String {
    state_of(pool, "identity.tenant_invitation", id).await
}

/// 兑换建立的 membership 与开通 ActionExecution。
async fn redemption_of(pool: &PgPool, invitation: Uuid) -> (Uuid, Uuid, Uuid) {
    sqlx::query_as(
        "select ti.tenant_membership_id, ti.admit_action_execution_id, tm.tenant_principal_id
         from identity.tenant_invitation ti
         join identity.tenant_membership tm on tm.id = ti.tenant_membership_id
         where ti.id = $1",
    )
    .bind(invitation)
    .fetch_one(pool)
    .await
    .expect("读兑换记录")
}

/// 开通的审批 workflow ID（WAITING 与审批 Start 同事务写入，兑换回应之前已在库里）。
async fn approval_of(pool: &PgPool, ae: Uuid) -> String {
    for _ in 0..120 {
        let wf: Option<String> = sqlx::query_scalar(
            "select approval_workflow_id from admission.action_execution where id = $1",
        )
        .bind(ae)
        .fetch_one(pool)
        .await
        .unwrap();
        if let Some(wf) = wf {
            return wf;
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    panic!("开通 {ae} 没有审批 workflow");
}

async fn decide(
    http: &reqwest::Client,
    e: &Env,
    subject: &str,
    wf: &str,
    decision: &str,
) -> (reqwest::StatusCode, Value) {
    bff(
        http,
        e,
        subject,
        reqwest::Method::POST,
        &format!("/api/v1/approvals/{wf}/decision"),
        Some(json!({ "decision": decision })),
    )
    .await
}

async fn scenarios(http: &reqwest::Client, e: &Env, pool: &PgPool, w: &World) {
    let a = w.a.subject.as_str();
    let t = format!("tenant:{}", w.tenant);
    let mut credentials: Vec<String> = vec![];

    // ---- 1. 入口：tenant.member.add 不登记；开通不能由请求体直接提交 ----
    for key in ["tenant.member.add", "tenant.member.admit"] {
        let (st, body) = submit(
            http,
            e,
            a,
            json!({"actionKey":key,"idempotencyKey":Uuid::new_v4(),"principalId":w.c.principal,
                   "invitationId":Uuid::new_v4()}),
        )
        .await;
        assert_eq!(st, reqwest::StatusCode::FORBIDDEN, "{key}: {body}");
        assert_eq!(reason(&body), "CAPABILITY_BLOCKED", "{key}");
    }
    let add: i64 = sqlx::query_scalar(
        "select count(*) from catalog.action_definition where action_key = 'tenant.member.add'",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(
        add, 0,
        "tenant.member.add 不得登记：成员建立只有邀请一条入口"
    );

    // ---- 2. 无 Tenant manage 的成员不能邀请 ----
    let (st, body) = submit(
        http,
        e,
        &w.c.subject,
        json!({"actionKey":"tenant.member.invite","idempotencyKey":Uuid::new_v4(),"name":"x"}),
    )
    .await;
    assert_eq!(st, reqwest::StatusCode::FORBIDDEN, "{body}");
    assert_eq!(reason(&body), "PERMISSION_DENIED");
    let (st, _) = bff(
        http,
        e,
        &w.c.subject,
        reqwest::Method::GET,
        "/api/v1/invitations",
        None,
    )
    .await;
    assert_eq!(
        st,
        reqwest::StatusCode::FORBIDDEN,
        "非 admin 看到了邀请列表"
    );

    // ---- 3. 签发：只存摘要，明文只回一次 ----
    let key = Uuid::new_v4();
    let (st, first) = submit(
        http,
        e,
        a,
        json!({"actionKey":"tenant.member.invite","idempotencyKey":key,"name":"Bob"}),
    )
    .await;
    assert_eq!(st, reqwest::StatusCode::OK, "{first}");
    common::assert_contract::<contracts::ActionSubmission>(&first, "ActionSubmission");
    assert_eq!(first["dispatchState"], "DISPATCHED", "{first}");
    let link = first["invitation"]["link"].as_str().unwrap();
    let base = std::env::var("TENANT_INVITATION_LINK_BASE").expect("TENANT_INVITATION_LINK_BASE");
    assert!(
        link.starts_with(&format!("{base}#")),
        "链接不在部署登记的基址下：{link}"
    );
    let cred_b = link.split_once('#').unwrap().1.to_owned();
    assert_eq!(cred_b.len(), 64, "凭据应为 256 位随机数的十六进制");
    credentials.push(cred_b.clone());
    let inv_b = Uuid::parse_str(first["invitation"]["invitationId"].as_str().unwrap()).unwrap();
    let (stored_digest, stored_state): (String, String) = sqlx::query_as(
        "select credential_digest, state from identity.tenant_invitation where id = $1",
    )
    .bind(inv_b)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(
        stored_digest,
        hex::encode(Sha256::digest(cred_b.as_bytes()))
    );
    assert_eq!(stored_state, "ISSUED");
    // 同键重放：回答原 operation，但凭据再无来源
    let (st, again) = submit(
        http,
        e,
        a,
        json!({"actionKey":"tenant.member.invite","idempotencyKey":key,"name":"Bob"}),
    )
    .await;
    assert_eq!(st, reqwest::StatusCode::OK, "{again}");
    assert_eq!(again["operationId"], first["operationId"]);
    assert!(
        again.get("invitation").is_none(),
        "重放再次给出了凭据：{again}"
    );
    let one_invitation: i64 =
        sqlx::query_scalar("select count(*) from identity.tenant_invitation where tenant_id = $1")
            .bind(w.tenant)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(one_invitation, 1, "同键重放签发了第二份邀请");

    // ---- 4. 兑换的入口核验 ----
    let st = http
        .post(format!("{}/api/v1/invitations/redeem", e.bff_url))
        .json(&json!({"credential":cred_b,"displayName":"nobody"}))
        .send()
        .await
        .expect("调 BFF")
        .status();
    assert_eq!(
        st,
        reqwest::StatusCode::FORBIDDEN,
        "无身份 header 的兑换被接受"
    );
    let stranger = fresh_subject("s");
    let (st, body) = redeem(http, e, &stranger, &"0".repeat(64), "stranger").await;
    assert_eq!(st, reqwest::StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(reason(&body), "INVITATION_NOT_FOUND");
    assert_eq!(invitation_state(pool, inv_b).await, "ISSUED");

    // ---- 5. 全链路：兑换 → INVITED + 审批 → admin 确认 → 重新准入 → ACTIVE ----
    let b_subject = fresh_subject("b");
    let (st, view) = redeem(http, e, &b_subject, &cred_b, "Bob").await;
    assert_eq!(st, reqwest::StatusCode::OK, "{view}");
    common::assert_contract::<InvitationRedemptionView>(&view, "InvitationRedemptionView");
    assert_eq!(view["membershipState"], "INVITED", "{view}");
    assert_eq!(view["admissionGateState"], "WAITING", "{view}");
    assert_eq!(invitation_state(pool, inv_b).await, "REDEEMED");
    let (b_membership, b_admit, b_principal) = redemption_of(pool, inv_b).await;
    assert_eq!(
        state_of(pool, "identity.tenant_membership", b_membership).await,
        "INVITED"
    );
    let (initiator, correlation): (Uuid, Uuid) = sqlx::query_as(
        "select initiator_principal_id, correlation_id from admission.action_execution where id = $1",
    )
    .bind(b_admit)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(initiator, w.a.principal, "开通的发起者应是邀请人");
    assert_eq!(
        correlation,
        Uuid::parse_str(first["operationId"].as_str().unwrap()).unwrap(),
        "开通应关联到签发邀请的 operation"
    );
    // 等待确认的人没有会话
    let (st, body) = bff(
        http,
        e,
        &b_subject,
        reqwest::Method::GET,
        "/api/v1/session",
        None,
    )
    .await;
    assert_eq!(st, reqwest::StatusCode::FORBIDDEN, "{body}");
    assert_eq!(reason(&body), "TENANT_MEMBERSHIP_NOT_ACTIVE");
    assert!(
        !common::zed_has(e, &t, "member", &subj(b_principal)),
        "确认前写了成员关系"
    );
    // 同一 Human 重复兑换：回答原结果
    let (st, again) = redeem(http, e, &b_subject, &cred_b, "Bob").await;
    assert_eq!(st, reqwest::StatusCode::OK, "{again}");
    assert_eq!(again["invitationId"], view["invitationId"]);
    // 别人拿同一凭据：已兑换
    let (st, body) = redeem(http, e, &fresh_subject("x"), &cred_b, "Mallory").await;
    assert_eq!(st, reqwest::StatusCode::CONFLICT, "{body}");
    assert_eq!(reason(&body), "INVITATION_ALREADY_REDEEMED");
    let (_, mine) = bff(
        http,
        e,
        &b_subject,
        reqwest::Method::GET,
        "/api/v1/invitations/redemptions",
        None,
    )
    .await;
    assert_eq!(mine.as_array().map(Vec::len), Some(1), "{mine}");
    // 管理视图：看得到兑换者自报的名字与审批
    let wf_b = approval_of(pool, b_admit).await;
    until(e, "审批 WAITING", || async {
        (approval_status(pool, &wf_b).await.as_deref() == Some("WAITING")).then_some(())
    })
    .await;
    let (st, list) = bff(
        http,
        e,
        a,
        reqwest::Method::GET,
        "/api/v1/invitations",
        None,
    )
    .await;
    assert_eq!(st, reqwest::StatusCode::OK, "{list}");
    let row = list
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["invitationId"] == inv_b.to_string())
        .cloned()
        .expect("列表里有这份邀请");
    common::assert_contract::<TenantInvitationView>(&row, "TenantInvitationView");
    assert_eq!(row["status"], "REDEEMED");
    assert_eq!(row["redeemerDisplayName"], "Bob");
    assert_eq!(row["approvalWorkflowId"], wf_b);
    // 邀请人本人确认（self_approval=ALLOW：单 admin 的 Tenant 也能加入第二个人）
    let (st, body) = decide(http, e, a, &wf_b, "APPROVE").await;
    assert_eq!(st, reqwest::StatusCode::OK, "{body}");
    until(e, "B 的 membership ACTIVE", || async {
        (state_of(pool, "identity.tenant_membership", b_membership).await == "ACTIVE").then_some(())
    })
    .await;
    until(e, "开通的批准被消费", || async {
        (approval_status(pool, &wf_b).await.as_deref() == Some("CONSUMED")).then_some(())
    })
    .await;
    let (gate, dispatch, _) = gate_of(pool, b_admit).await;
    assert_eq!(
        (gate.as_str(), dispatch.as_str()),
        ("ALLOWED", "DISPATCHED")
    );
    let rechecked: i64 = sqlx::query_scalar(
        "select count(*) from admission.action_decision where action_execution_id = $1 and phase = 'RECHECK'",
    )
    .bind(b_admit)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(rechecked, 1, "批准后没有重新准入");
    assert!(
        common::zed_has(e, &t, "member", &subj(b_principal)),
        "ACTIVE 而没有 tenant#member"
    );
    let (st, body) = bff(
        http,
        e,
        &b_subject,
        reqwest::Method::GET,
        "/api/v1/session",
        None,
    )
    .await;
    assert_eq!(st, reqwest::StatusCode::OK, "B 开通后不能登录：{body}");
    assert_eq!(body["tenantId"], w.tenant.to_string());

    // ---- 6. 已是成员的人兑换：拒绝且不消耗邀请 ----
    let (inv_dup, cred_dup, _) = invite(http, e, a, "Bob again").await;
    credentials.push(cred_dup.clone());
    let (st, body) = redeem(http, e, &b_subject, &cred_dup, "Bob").await;
    assert_eq!(st, reqwest::StatusCode::CONFLICT, "{body}");
    assert_eq!(reason(&body), "INVITEE_ALREADY_MEMBER");
    assert_eq!(
        invitation_state(pool, inv_dup).await,
        "ISSUED",
        "拒绝消耗了邀请"
    );

    // ---- 7. 撤回 ----
    let (st, body) = submit(
        http,
        e,
        a,
        json!({"actionKey":"tenant.member.invite.revoke","idempotencyKey":Uuid::new_v4(),"invitationId":inv_dup}),
    )
    .await;
    assert_eq!(st, reqwest::StatusCode::OK, "{body}");
    assert_eq!(invitation_state(pool, inv_dup).await, "REVOKED");
    let (st, body) = redeem(http, e, &fresh_subject("r"), &cred_dup, "late").await;
    assert_eq!(st, reqwest::StatusCode::CONFLICT, "{body}");
    assert_eq!(reason(&body), "INVITATION_REVOKED");
    let (st, body) = submit(
        http,
        e,
        a,
        json!({"actionKey":"tenant.member.invite.revoke","idempotencyKey":Uuid::new_v4(),"invitationId":inv_dup}),
    )
    .await;
    assert_eq!(st, reqwest::StatusCode::CONFLICT, "重复撤回：{body}");

    // ---- 8. 过期（查询时判定）：把签发时刻拨回过去 ----
    let (inv_old, cred_old, _) = invite(http, e, a, "Old").await;
    credentials.push(cred_old.clone());
    sqlx::query(
        "update identity.tenant_invitation
         set created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour'
         where id = $1",
    )
    .bind(inv_old)
    .execute(pool)
    .await
    .unwrap();
    let (st, body) = redeem(http, e, &fresh_subject("o"), &cred_old, "late").await;
    assert_eq!(st, reqwest::StatusCode::CONFLICT, "{body}");
    assert_eq!(reason(&body), "INVITATION_EXPIRED");
    assert_eq!(
        invitation_state(pool, inv_old).await,
        "ISSUED",
        "过期由查询判定，不写库"
    );
    let (_, list) = bff(
        http,
        e,
        a,
        reqwest::Method::GET,
        "/api/v1/invitations",
        None,
    )
    .await;
    assert!(
        list.as_array()
            .unwrap()
            .iter()
            .any(|v| v["invitationId"] == inv_old.to_string() && v["status"] == "EXPIRED"),
        "列表没有把过期的邀请显示为 EXPIRED：{list}"
    );
    let (st, body) = submit(
        http,
        e,
        a,
        json!({"actionKey":"tenant.member.invite.revoke","idempotencyKey":Uuid::new_v4(),"invitationId":inv_old}),
    )
    .await;
    assert_eq!(st, reqwest::StatusCode::CONFLICT, "{body}");
    assert_eq!(reason(&body), "INVITATION_EXPIRED");

    // ---- 9. 并发兑换同一凭据：恰好一个成功；随后否决确认 → membership REVOKED ----
    let (inv_race, cred_race, _) = invite(http, e, a, "Race").await;
    credentials.push(cred_race.clone());
    let (s1, s2) = (fresh_subject("r1"), fresh_subject("r2"));
    let ((st1, v1), (st2, v2)) = tokio::join!(
        redeem(http, e, &s1, &cred_race, "r1"),
        redeem(http, e, &s2, &cred_race, "r2")
    );
    let wins = [st1, st2]
        .iter()
        .filter(|s| **s == reqwest::StatusCode::OK)
        .count();
    assert_eq!(wins, 1, "并发兑换应恰好一个成功：{st1} {v1} / {st2} {v2}");
    let loser = if st1 == reqwest::StatusCode::OK {
        &v2
    } else {
        &v1
    };
    assert_eq!(reason(loser), "INVITATION_ALREADY_REDEEMED");
    let winner_subject = if st1 == reqwest::StatusCode::OK {
        &s1
    } else {
        &s2
    };
    let memberships: i64 = sqlx::query_scalar(
        "select count(*) from identity.tenant_membership where tenant_id = $1 and state = 'INVITED'",
    )
    .bind(w.tenant)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(memberships, 1, "并发兑换建立了不止一条 INVITED membership");
    let (race_membership, race_admit, _) = redemption_of(pool, inv_race).await;
    let wf_race = approval_of(pool, race_admit).await;
    until(e, "审批 WAITING", || async {
        (approval_status(pool, &wf_race).await.as_deref() == Some("WAITING")).then_some(())
    })
    .await;
    // 非 admin 的否决不形成决定
    let (st, body) = decide(http, e, &w.c.subject, &wf_race, "DENY").await;
    assert_eq!(st, reqwest::StatusCode::FORBIDDEN, "{body}");
    let (st, body) = decide(http, e, a, &wf_race, "DENY").await;
    assert_eq!(st, reqwest::StatusCode::OK, "{body}");
    until(e, "否决后 membership REVOKED", || async {
        (state_of(pool, "identity.tenant_membership", race_membership).await == "REVOKED")
            .then_some(())
    })
    .await;
    let (gate, _, why) = gate_of(pool, race_admit).await;
    assert_eq!(gate, "DENIED");
    assert_eq!(why.as_deref(), Some("APPROVAL_DENIED"));
    assert_eq!(
        invitation_state(pool, inv_race).await,
        "REDEEMED",
        "兑换记录应保留"
    );
    let settled: i64 = sqlx::query_scalar(
        "select count(*) from audit.audit_event where event_type = 'REVOCATION'
           and action_key = 'tenant.member.admit' and target_id = $1",
    )
    .bind(race_membership)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(settled, 1, "INVITED→REVOKED 没有留审计");

    // ---- 10. 已撤权者的恢复：再邀请、同一人兑换 → 同一 membership 的新 version；
    //          邀请人撤回确认请求 → 再次 REVOKED ----
    let (inv_back, cred_back, _) = invite(http, e, a, "Back").await;
    credentials.push(cred_back.clone());
    let (st, body) = redeem(http, e, winner_subject, &cred_back, "back").await;
    assert_eq!(st, reqwest::StatusCode::OK, "{body}");
    let (back_membership, back_admit, _) = redemption_of(pool, inv_back).await;
    assert_eq!(back_membership, race_membership, "恢复应复用原 membership");
    let wf_back = approval_of(pool, back_admit).await;
    until(e, "审批 WAITING", || async {
        (approval_status(pool, &wf_back).await.as_deref() == Some("WAITING")).then_some(())
    })
    .await;
    let (st, body) = bff(
        http,
        e,
        a,
        reqwest::Method::POST,
        &format!("/api/v1/approvals/{wf_back}/withdraw"),
        None,
    )
    .await;
    assert_eq!(st, reqwest::StatusCode::OK, "{body}");
    until(e, "撤回后 membership REVOKED", || async {
        (state_of(pool, "identity.tenant_membership", back_membership).await == "REVOKED")
            .then_some(())
    })
    .await;

    // ---- 11. 邀请人在兑换前失权：兑换后准入以 PERMISSION_DENIED 拒绝 ----
    let c_admin = || {
        common::zed_relationship(e, "touch", &t, "admin", &subj(w.c.principal));
    };
    let c_plain = || {
        common::zed_relationship(e, "delete", &t, "admin", &subj(w.c.principal));
    };
    c_admin();
    let (inv_c1, cred_c1, _) = invite(http, e, &w.c.subject, "by C").await;
    credentials.push(cred_c1.clone());
    c_plain();
    let (st, view) = redeem(http, e, &fresh_subject("y"), &cred_c1, "y").await;
    assert_eq!(st, reqwest::StatusCode::OK, "{view}");
    assert_eq!(view["admissionGateState"], "DENIED", "{view}");
    assert_eq!(view["reason"], "PERMISSION_DENIED", "{view}");
    assert_eq!(view["membershipState"], "REVOKED", "{view}");
    let (c1_membership, _, _) = redemption_of(pool, inv_c1).await;
    assert_eq!(
        state_of(pool, "identity.tenant_membership", c1_membership).await,
        "REVOKED"
    );

    // ---- 12. 邀请人在确认前失权：批准后的重新准入拒绝 → INVALIDATED、REVOKED ----
    c_admin();
    let (inv_c2, cred_c2, _) = invite(http, e, &w.c.subject, "by C 2").await;
    credentials.push(cred_c2.clone());
    let (st, body) = redeem(http, e, &fresh_subject("z"), &cred_c2, "z").await;
    assert_eq!(st, reqwest::StatusCode::OK, "{body}");
    let (c2_membership, c2_admit, _) = redemption_of(pool, inv_c2).await;
    let wf_c2 = approval_of(pool, c2_admit).await;
    until(e, "审批 WAITING", || async {
        (approval_status(pool, &wf_c2).await.as_deref() == Some("WAITING")).then_some(())
    })
    .await;
    c_plain();
    let (st, body) = decide(http, e, a, &wf_c2, "APPROVE").await;
    assert_eq!(st, reqwest::StatusCode::OK, "{body}");
    until(e, "重新准入拒绝后 membership REVOKED", || async {
        (state_of(pool, "identity.tenant_membership", c2_membership).await == "REVOKED")
            .then_some(())
    })
    .await;
    let (gate, dispatch, why) = gate_of(pool, c2_admit).await;
    assert_eq!(gate, "REVOKED");
    assert_eq!(dispatch, "NOT_DISPATCHED");
    assert_eq!(why.as_deref(), Some("PERMISSION_DENIED"));
    until(e, "批准失效", || async {
        (approval_status(pool, &wf_c2).await.as_deref() == Some("INVALIDATED")).then_some(())
    })
    .await;

    // ---- 13. 凭据不进库、审计或日志 ----
    for cred in &credentials {
        let leaks: i64 = sqlx::query_scalar(
            "select (select count(*) from audit.audit_event
                      where evidence_refs::text like '%' || $1 || '%' or parameter_hash = $1)
                  + (select count(*) from admission.action_execution
                      where parameters::text like '%' || $1 || '%')
                  + (select count(*) from identity.tenant_invitation
                      where row_to_json(tenant_invitation)::text like '%' || $1 || '%')",
        )
        .bind(cred)
        .fetch_one(pool)
        .await
        .unwrap();
        assert_eq!(leaks, 0, "明文凭据进了库");
    }
    let v = |k: &str| std::env::var(k).unwrap_or_else(|_| panic!("缺少 {k}"));
    let logs = std::process::Command::new("sudo")
        .args([
            "-n",
            "docker",
            "compose",
            "--env-file",
            &v("VERIFY_COMPOSE_ENV_FILE"),
            "-f",
            &v("VERIFY_COMPOSE_FILE"),
            "logs",
            "--no-color",
            "core-bff",
        ])
        .output()
        .expect("读 Core 日志");
    let text = String::from_utf8_lossy(&logs.stdout);
    for cred in &credentials {
        assert!(!text.contains(cred.as_str()), "明文凭据进了 Core 日志");
    }
}
