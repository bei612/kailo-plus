//! 角色管理与部署引导的端到端核验（DD-82、ADR-11、GAP-IDN-01）。
//!
//! 全部走真实拓扑：部署引导在 Core 容器内执行，Tenant 与首位成员经各自的生命周期
//! Workflow 开通；角色动作经 BFF 语义命令、fresh Check、审批与同步派发写 SpiceDB。
//! 断言不以 BFF 的回应为据：角色事实用 zed 直接问 SpiceDB，门禁与审计查 Core 库。
//!
//! 夹具只写一样东西：除首位 admin 之外的成员（B、C、D）的 OIDC 侧身份与成员关系——
//! 成员邀请受 GAP-IDN-01 阻断，产品里没有这条入口。

use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

mod common;
use common::bootstrapped::{add_member, bootstrap, subj, teardown, Member};
use common::{approval_status, bff, gate_of, reason, state_of, submit, until, Env};

struct World {
    tenant: Uuid,
    a: Member,
    b: Member,
    c: Member,
    d: Member,
    initiator: Uuid,
}

fn tenant_obj(w: &World) -> String {
    format!("tenant:{}", w.tenant)
}

#[tokio::test]
async fn roles_are_governed_and_a_tenant_never_loses_its_last_admin() {
    let Some(e) = common::env() else { return };
    let http = reqwest::Client::new();
    let pool = PgPool::connect(&e.database_url).await.expect("连 Core 库");
    let token = common::worker_token(&http, &e).await;
    let slug = format!("r{}", &Uuid::new_v4().to_string()[..8]);
    let a_subject = format!("role-a-{}", &Uuid::new_v4().to_string()[..8]);

    // ---- 0. 部署引导：Tenant 与首位 admin ----
    let (code, out) = bootstrap(&slug, &a_subject, e.converge_bound_secs * 2);
    assert_eq!(code, 0, "引导应完成：{out}");
    assert_eq!(out["state"], "COMPLETED", "{out}");
    let tenant = Uuid::parse_str(out["tenantId"].as_str().unwrap()).unwrap();
    let a_principal = Uuid::parse_str(out["adminPrincipalId"].as_str().unwrap()).unwrap();
    let initiator: Uuid = sqlx::query_scalar(
        "select principal_id from identity.service_principal where audience = 'kailo-deployment-bootstrap'",
    )
    .fetch_one(&pool)
    .await
    .expect("引导 ServicePrincipal");
    let (a_human, a_membership): (Uuid, Uuid) = sqlx::query_as(
        "select human_identity_id, id from identity.tenant_membership where tenant_principal_id = $1",
    )
    .bind(a_principal)
    .fetch_one(&pool)
    .await
    .unwrap();

    let mut members = vec![];
    for _ in 0..3 {
        match add_member(&http, &e, &pool, &token, tenant, initiator).await {
            Ok(m) => members.push(m),
            Err(err) => {
                let humans: Vec<Uuid> = members.iter().map(|m| m.human).chain([a_human]).collect();
                teardown(&e, &pool, tenant, &humans).await;
                panic!("开通成员失败：{err}");
            }
        }
    }
    let d = members.pop().unwrap();
    let c = members.pop().unwrap();
    let b = members.pop().unwrap();
    let w = World {
        tenant,
        a: Member {
            subject: a_subject.clone(),
            principal: a_principal,
            human: a_human,
            membership: a_membership,
        },
        b,
        c,
        d,
        initiator,
    };

    let outcome = std::panic::AssertUnwindSafe(scenarios(&http, &e, &pool, &w, &slug));
    let result = futures_util::FutureExt::catch_unwind(outcome).await;
    teardown(
        &e,
        &pool,
        tenant,
        &[w.a.human, w.b.human, w.c.human, w.d.human],
    )
    .await;
    if let Err(p) = result {
        std::panic::resume_unwind(p);
    }
}

async fn scenarios(http: &reqwest::Client, e: &Env, pool: &PgPool, w: &World, slug: &str) {
    let t = tenant_obj(w);
    let a = w.a.subject.as_str();

    // ---- 1. 引导留下的事实：A 是 admin，整条链有 ActionExecution 与审计 ----
    assert!(
        common::zed_has(e, &t, "admin", &subj(w.a.principal)),
        "引导没有写入 admin"
    );
    let stages: Vec<(String, String)> = sqlx::query_as(
        "select event_type, result_code from audit.audit_event
         where correlation_id = $1 and action_key = 'tenant.bootstrap' order by occurred_at",
    )
    .bind(w.tenant)
    .fetch_all(pool)
    .await
    .unwrap();
    assert!(
        stages
            .iter()
            .any(|(t, r)| t == "OUTCOME" && r == "ROLE_GRANTED"),
        "引导缺 admin 授予的 OUTCOME 审计：{stages:?}"
    );
    assert!(
        stages.iter().filter(|(t, _)| t == "DISPATCH").count() >= 3,
        "引导的三步（Tenant、成员、admin）应各有 DISPATCH 审计：{stages:?}"
    );
    let initiators: Vec<Uuid> = sqlx::query_scalar(
        "select distinct initiator_principal_id from admission.action_execution
         where tenant_id = $1 and action_key = 'tenant.bootstrap'",
    )
    .bind(w.tenant)
    .fetch_all(pool)
    .await
    .unwrap();
    assert_eq!(
        initiators,
        vec![w.initiator],
        "引导的发起方不是部署引导 ServicePrincipal"
    );

    // 重跑：同一人 → COMPLETED、不追加；另一人 → INERT，既不建成员也不授权（0→1）
    let (code, out) = bootstrap(slug, a, 5);
    assert_eq!(
        (code, out["state"].as_str()),
        (0, Some("COMPLETED")),
        "{out}"
    );
    let other = format!("role-x-{}", &Uuid::new_v4().to_string()[..8]);
    let (code, out) = bootstrap(slug, &other, 5);
    assert_eq!((code, out["state"].as_str()), (4, Some("INERT")), "{out}");
    let joined: i64 = sqlx::query_scalar(
        "select count(*) from identity.tenant_membership tm
         join identity.external_identity ei on ei.human_identity_id = tm.human_identity_id
         where tm.tenant_id = $1 and ei.subject = $2",
    )
    .bind(w.tenant)
    .bind(&other)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(joined, 0, "已有 admin 的 Tenant 被引导追加了成员");
    let registered: i64 =
        sqlx::query_scalar("select count(*) from identity.external_identity where subject = $1")
            .bind(&other)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(registered, 0, "INERT 的引导登记了外部身份");

    // ---- 2. 最后一位 admin：撤自己的 admin、撤自己的成员关系都被拒 ----
    let (st, body) = submit(
        http,
        e,
        a,
        json!({"actionKey":"tenant.admin.revoke","idempotencyKey":Uuid::new_v4(),"principalId":w.a.principal}),
    )
    .await;
    assert_eq!(st, reqwest::StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(reason(&body), "LAST_TENANT_ADMIN");
    let op = common::refused(&body)
        .operation_id
        .expect("拒绝应带 operation ID");
    let (gate, dispatch, r): (String, String, Option<String>) = sqlx::query_as(
        "select gate_state, dispatch_state, reason_code from admission.action_execution where operation_id = $1",
    )
    .bind(Uuid::parse_str(&op).unwrap())
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(
        (gate.as_str(), dispatch.as_str(), r.as_deref()),
        ("DENIED", "NOT_DISPATCHED", Some("LAST_TENANT_ADMIN"))
    );
    let (st, body) = submit(
        http,
        e,
        a,
        json!({"actionKey":"tenant.member.revoke","idempotencyKey":Uuid::new_v4(),"principalId":w.a.principal}),
    )
    .await;
    assert_eq!(st, reqwest::StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(reason(&body), "LAST_TENANT_ADMIN");
    assert!(common::zed_has(e, &t, "admin", &subj(w.a.principal)));

    // ---- 3. 授予：A 授 B；重复授予冲突；非 admin 授予被拒；非成员不可授 ----
    let grant = |p: Uuid| json!({"actionKey":"tenant.admin.grant","idempotencyKey":Uuid::new_v4(),"principalId":p});
    let (st, body) = submit(http, e, a, grant(w.b.principal)).await;
    assert_eq!(st, reqwest::StatusCode::OK, "{body}");
    assert_eq!(body["dispatchState"], "DISPATCHED", "{body}");
    assert!(
        body["workflowId"].is_null(),
        "同步角色动作不应有 Workflow：{body}"
    );
    assert!(
        common::zed_has(e, &t, "admin", &subj(w.b.principal)),
        "授予没有写到 SpiceDB"
    );
    let ae = Uuid::parse_str(body["actionExecutionId"].as_str().unwrap()).unwrap();
    let events: Vec<(String, String)> = sqlx::query_as(
        "select event_type, result_code from audit.audit_event where operation_id =
             (select operation_id from admission.action_execution where id = $1) order by occurred_at",
    )
    .bind(ae)
    .fetch_all(pool)
    .await
    .unwrap();
    for want in [("DISPATCH", "DISPATCHED"), ("OUTCOME", "ROLE_GRANTED")] {
        assert!(
            events.iter().any(|(t, r)| t == want.0 && r == want.1),
            "缺 {want:?} 审计：{events:?}"
        );
    }
    let zed: Option<String> = sqlx::query_scalar(
        "select zed_token from admission.action_decision where action_execution_id = $1 and phase = 'ADMISSION'",
    )
    .bind(ae)
    .fetch_one(pool)
    .await
    .unwrap();
    assert!(zed.is_some_and(|z| !z.is_empty()), "准入没有记下 ZedToken");
    let (st, body) = submit(http, e, a, grant(w.b.principal)).await;
    assert_eq!(st, reqwest::StatusCode::CONFLICT, "{body}");
    assert_eq!(reason(&body), "TARGET_STATE_CONFLICT");
    let (st, body) = submit(http, e, &w.c.subject, grant(w.d.principal)).await;
    assert_eq!(st, reqwest::StatusCode::FORBIDDEN, "{body}");
    assert_eq!(reason(&body), "PERMISSION_DENIED");
    assert!(!common::zed_has(e, &t, "admin", &subj(w.d.principal)));
    let (st, body) = submit(http, e, a, grant(Uuid::new_v4())).await;
    assert_eq!(st, reqwest::StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(reason(&body), "TARGET_NOT_FOUND");

    // ---- 4. 并发授予同一角色：恰好一次生效 ----
    let (r1, r2) = tokio::join!(
        submit(http, e, a, grant(w.d.principal)),
        submit(http, e, &w.b.subject, grant(w.d.principal))
    );
    let ok = [&r1, &r2]
        .iter()
        .filter(|r| r.0 == reqwest::StatusCode::OK)
        .count();
    let conflicts = [&r1, &r2]
        .iter()
        .filter(|r| r.0 == reqwest::StatusCode::CONFLICT && reason(&r.1) == "TARGET_STATE_CONFLICT")
        .count();
    assert_eq!((ok, conflicts), (1, 1), "并发授予：{r1:?} {r2:?}");
    assert!(common::zed_has(e, &t, "admin", &subj(w.d.principal)));

    // ---- 5. 撤销需另一位 admin 批准：A 撤 D → D 自己不能批（发起者才受职责分离），
    //         B 批准 → 重新准入 → 同步派发 → CONSUMED ----
    let (st, body) = submit(
        http,
        e,
        a,
        json!({"actionKey":"tenant.admin.revoke","idempotencyKey":Uuid::new_v4(),"principalId":w.d.principal}),
    )
    .await;
    assert_eq!(st, reqwest::StatusCode::ACCEPTED, "{body}");
    let wf = body["approvalWorkflowId"]
        .as_str()
        .expect("需审批")
        .to_owned();
    let rv_ae = Uuid::parse_str(body["actionExecutionId"].as_str().unwrap()).unwrap();
    until(e, "审批 WAITING", || async {
        (approval_status(pool, &wf).await.as_deref() == Some("WAITING")).then_some(())
    })
    .await;
    assert!(
        common::zed_has(e, &t, "admin", &subj(w.d.principal)),
        "批准之前不得撤"
    );
    let (st, body) = bff(
        http,
        e,
        &w.b.subject,
        reqwest::Method::POST,
        &format!("/api/v1/approvals/{wf}/decision"),
        Some(json!({"decision":"APPROVE"})),
    )
    .await;
    assert_eq!(st, reqwest::StatusCode::OK, "{body}");
    until(e, "批准被消费", || async {
        (approval_status(pool, &wf).await.as_deref() == Some("CONSUMED")).then_some(())
    })
    .await;
    assert!(
        !common::zed_has(e, &t, "admin", &subj(w.d.principal)),
        "撤销没有写到 SpiceDB"
    );
    assert_eq!(
        gate_of(pool, rv_ae).await,
        ("ALLOWED".into(), "DISPATCHED".into(), None)
    );
    let rechecks: i64 = sqlx::query_scalar(
        "select count(*) from admission.action_decision where action_execution_id = $1 and phase = 'RECHECK'
           and approval_decision = 'SATISFIED'",
    )
    .bind(rv_ae)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(rechecks, 1, "批准后没有重新准入就派发了");

    // ---- 6. 并发互撤：admin 只有 A、B，A 撤 B 与 B 撤 A 同时获批 → 恰好留下一位 ----
    let (s1, b1) = submit(
        http,
        e,
        a,
        json!({"actionKey":"tenant.admin.revoke","idempotencyKey":Uuid::new_v4(),"principalId":w.b.principal}),
    )
    .await;
    let (s2, b2) = submit(
        http,
        e,
        &w.b.subject,
        json!({"actionKey":"tenant.admin.revoke","idempotencyKey":Uuid::new_v4(),"principalId":w.a.principal}),
    )
    .await;
    assert_eq!(
        (s1, s2),
        (reqwest::StatusCode::ACCEPTED, reqwest::StatusCode::ACCEPTED),
        "{b1} {b2}"
    );
    let wf1 = b1["approvalWorkflowId"].as_str().unwrap().to_owned();
    let wf2 = b2["approvalWorkflowId"].as_str().unwrap().to_owned();
    for wf in [&wf1, &wf2] {
        until(e, "审批 WAITING", || async {
            (approval_status(pool, wf).await.as_deref() == Some("WAITING")).then_some(())
        })
        .await;
    }
    let decide = |subject: String, wf: String| async move {
        bff(
            http,
            e,
            &subject,
            reqwest::Method::POST,
            &format!("/api/v1/approvals/{wf}/decision"),
            Some(json!({"decision":"APPROVE"})),
        )
        .await
    };
    let (d1, d2) = tokio::join!(
        decide(w.b.subject.clone(), wf1.clone()),
        decide(w.a.subject.clone(), wf2.clone())
    );
    assert_eq!(
        (d1.0, d2.0),
        (reqwest::StatusCode::OK, reqwest::StatusCode::OK),
        "{d1:?} {d2:?}"
    );
    let finals = until(e, "两份审批都终结", || async {
        let s1 = approval_status(pool, &wf1).await?;
        let s2 = approval_status(pool, &wf2).await?;
        (matches!(s1.as_str(), "CONSUMED" | "INVALIDATED")
            && matches!(s2.as_str(), "CONSUMED" | "INVALIDATED"))
        .then_some((s1, s2))
    })
    .await;
    let consumed = [&finals.0, &finals.1]
        .iter()
        .filter(|s| s.as_str() == "CONSUMED")
        .count();
    assert_eq!(consumed, 1, "并发互撤应恰好一份生效：{finals:?}");
    let a_admin = common::zed_has(e, &t, "admin", &subj(w.a.principal));
    let b_admin = common::zed_has(e, &t, "admin", &subj(w.b.principal));
    assert!(
        a_admin ^ b_admin,
        "应恰好留下一位 admin：A={a_admin} B={b_admin}"
    );
    let loser = if finals.0 == "INVALIDATED" { &b1 } else { &b2 };
    let loser_ae = Uuid::parse_str(loser["actionExecutionId"].as_str().unwrap()).unwrap();
    let (gate, dispatch, r) = gate_of(pool, loser_ae).await;
    assert!(
        (gate == "REVOKED"
            && dispatch == "NOT_DISPATCHED"
            && matches!(
                r.as_deref(),
                Some("PERMISSION_DENIED" | "LAST_TENANT_ADMIN")
            ))
            || (gate == "ALLOWED"
                && dispatch == "ABORTED"
                && r.as_deref() == Some("LAST_TENANT_ADMIN")),
        "落败的一方应在重新准入或派发时被拒：{gate} {dispatch} {r:?}"
    );
    let (x, y) = if a_admin { (&w.a, &w.b) } else { (&w.b, &w.a) };

    // ---- 7. Workspace admin：X 建 Workspace，授 C 为其 admin，C 不是其成员也能管理 ----
    let ws_slug = format!("w{}", &Uuid::new_v4().to_string()[..8]);
    let (st, body) = submit(
        http,
        e,
        &x.subject,
        json!({"actionKey":"workspace.create","idempotencyKey":Uuid::new_v4(),"slug":ws_slug,"name":"角色核验"}),
    )
    .await;
    assert!(st.is_success(), "{body}");
    let ws_ae = Uuid::parse_str(body["actionExecutionId"].as_str().unwrap()).unwrap();
    let ws: Uuid =
        sqlx::query_scalar("select target_id from admission.action_execution where id = $1")
            .bind(ws_ae)
            .fetch_one(pool)
            .await
            .unwrap();
    until(e, "Workspace ACTIVE", || async {
        (state_of(pool, "identity.workspace", ws).await == "ACTIVE").then_some(())
    })
    .await;
    let ws_obj = format!("workspace:{ws}");
    let ws_cmd = |key: &str, p: Uuid| json!({"actionKey":key,"idempotencyKey":Uuid::new_v4(),"workspaceId":ws,"principalId":p});
    let (st, body) = submit(
        http,
        e,
        &w.c.subject,
        ws_cmd("workspace.member.add", w.d.principal),
    )
    .await;
    assert_eq!(
        st,
        reqwest::StatusCode::FORBIDDEN,
        "C 尚非 Workspace admin：{body}"
    );
    let (st, body) = submit(
        http,
        e,
        &x.subject,
        ws_cmd("workspace.admin.grant", w.c.principal),
    )
    .await;
    assert_eq!(st, reqwest::StatusCode::OK, "{body}");
    assert!(common::zed_has(e, &ws_obj, "admin", &subj(w.c.principal)));
    let (st, body) = submit(
        http,
        e,
        &w.c.subject,
        ws_cmd("workspace.member.add", w.d.principal),
    )
    .await;
    assert!(st.is_success(), "Workspace admin 应能加成员：{body}");
    let (st, body) = submit(
        http,
        e,
        &x.subject,
        ws_cmd("workspace.admin.revoke", w.c.principal),
    )
    .await;
    assert_eq!(st, reqwest::StatusCode::OK, "{body}");
    assert!(!common::zed_has(e, &ws_obj, "admin", &subj(w.c.principal)));
    let (st, body) = submit(
        http,
        e,
        &w.c.subject,
        ws_cmd("workspace.member.add", y.principal),
    )
    .await;
    assert_eq!(
        st,
        reqwest::StatusCode::FORBIDDEN,
        "撤掉 Workspace admin 后仍能管理：{body}"
    );

    // ---- 8. Tenant 撤权撤掉全部关系：Y 重获 admin 与 Workspace admin 后被撤成员 ----
    let (st, body) = submit(http, e, &x.subject, grant(y.principal)).await;
    assert_eq!(st, reqwest::StatusCode::OK, "{body}");
    let (st, body) = submit(
        http,
        e,
        &x.subject,
        ws_cmd("workspace.admin.grant", y.principal),
    )
    .await;
    assert_eq!(st, reqwest::StatusCode::OK, "{body}");
    let (st, body) = submit(
        http,
        e,
        &x.subject,
        json!({"actionKey":"tenant.member.revoke","idempotencyKey":Uuid::new_v4(),"principalId":y.principal}),
    )
    .await;
    assert_eq!(st, reqwest::StatusCode::ACCEPTED, "{body}");
    let mwf = body["approvalWorkflowId"].as_str().unwrap().to_owned();
    until(e, "审批 WAITING", || async {
        (approval_status(pool, &mwf).await.as_deref() == Some("WAITING")).then_some(())
    })
    .await;
    // 被撤的人自己也是有效 admin，可以批准（职责分离只约束发起者）
    let (st, body) = bff(
        http,
        e,
        &y.subject,
        reqwest::Method::POST,
        &format!("/api/v1/approvals/{mwf}/decision"),
        Some(json!({"decision":"APPROVE"})),
    )
    .await;
    assert_eq!(st, reqwest::StatusCode::OK, "{body}");
    until(e, "Y 的 TenantMembership REVOKED", || async {
        (state_of(pool, "identity.tenant_membership", y.membership).await == "REVOKED")
            .then_some(())
    })
    .await;
    for (object, relation) in [(&t, "admin"), (&t, "member"), (&ws_obj, "admin")] {
        assert!(
            !common::zed_has(e, object, relation, &subj(y.principal)),
            "撤权后 {object}#{relation} 仍在"
        );
    }

    // ---- 9. 对账：旁路注入一条失权者的 admin 关系 → 以成员事实为准删除并留审计 ----
    common::zed_relationship(e, "touch", &t, "admin", &subj(y.principal));
    let interval: u64 = std::env::var("ROLE_RECONCILE_INTERVAL_SECONDS")
        .expect("ROLE_RECONCILE_INTERVAL_SECONDS")
        .parse()
        .unwrap();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(interval * 3 + 10);
    while common::zed_has(e, &t, "admin", &subj(y.principal)) {
        assert!(
            std::time::Instant::now() < deadline,
            "对账没有删除失权者的 admin 关系"
        );
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    }
    let audited: i64 = sqlx::query_scalar(
        "select count(*) from audit.audit_event where tenant_id = $1 and event_type = 'RECONCILIATION'
           and result_code = 'ROLE_REMOVED' and target_id = $2",
    )
    .bind(w.tenant)
    .bind(y.principal)
    .fetch_one(pool)
    .await
    .unwrap();
    assert!(audited >= 1, "对账删除没有留审计");

    // ---- 10. GAP-IDN-01：Tenant 成员邀请没有入口 ----
    let (st, body) = submit(
        http,
        e,
        &x.subject,
        json!({"actionKey":"tenant.member.add","idempotencyKey":Uuid::new_v4(),"principalId":y.principal}),
    )
    .await;
    assert_eq!(st, reqwest::StatusCode::FORBIDDEN, "{body}");
    assert_eq!(reason(&body), "CAPABILITY_BLOCKED");
    let registered: i64 = sqlx::query_scalar(
        "select count(*) from catalog.action_definition where action_key like 'tenant.member.add%'
            or action_key like '%invit%'",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(registered, 0, "Tenant 成员邀请不得登记（GAP-IDN-01）");
    let invited: i64 = sqlx::query_scalar(
        "select count(*) from identity.tenant_membership where state = 'INVITED'",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(invited, 0, "INVITED 不可达（GAP-IDN-01）");
}
