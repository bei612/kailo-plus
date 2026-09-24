//! Governed Action 的端到端核验：语义命令 → 准入 → ApprovalWorkflow → 批准后
//! 重新准入 → dispatch 既有生命周期 Workflow → CONSUMED（.design/05 §1、
//! .design/06 §4、DD-47、DD-48；V-SCN-07/31/32/34/37/38）。
//!
//! 全部走真实拓扑：BFF 经网关身份 header、SpiceDB fresh Check、Temporal 上的
//! Worker。夹具只写 OIDC 侧身份与首位 admin 关系（夹具 Tenant 不经部署引导）；第二位
//! admin 经角色动作授予，角色管理本身的核验在 role_management.rs。
//!
//! 场景共用一个 Tenant 且会改动全局 Catalog（过期场景登记短时效策略版本），
//! 因此放在同一个测试函数里顺序执行。

use std::time::Duration;

use contracts::{ActionSubmission, ApprovalDecisionOutcome, ApprovalView, TaskView};
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

mod common;
use common::{
    approval_status, bff, gate_of, reason, refused, state_of, submit, until, Env, LiveMember,
    LiveWorkspace,
};

struct World {
    fx: LiveWorkspace,
    b: LiveMember,
    c: LiveMember,
    d: LiveMember,
}

#[tokio::test]
async fn governed_actions_admit_approve_recheck_and_dispatch() {
    let Some(e) = common::env() else { return };
    let http = reqwest::Client::new();
    let pool = PgPool::connect(&e.database_url).await.expect("连 Core 库");
    let token = common::worker_token(&http, &e).await;

    let fx = common::provision_live_workspace(&http, &e, &pool, &token)
        .await
        .expect("开通夹具 Workspace");
    let mut members = vec![];
    for _ in 0..3 {
        match common::add_tenant_member(&http, &e, &pool, &token, &fx).await {
            Ok(m) => members.push(m),
            Err(err) => {
                common::teardown_live_workspace(&e, &pool, &fx).await;
                common::teardown_members(&pool, &fx, &members.iter().collect::<Vec<_>>()).await;
                panic!("开通成员失败：{err}");
            }
        }
    }
    let d = members.pop().unwrap();
    let c = members.pop().unwrap();
    let b = members.pop().unwrap();
    let w = World { fx, b, c, d };

    // A（夹具的主成员）是 Tenant admin；B 在场景 5 起才是
    let tenant = format!("tenant:{}", w.fx.tenant);
    common::zed_relationship(
        &e,
        "touch",
        &tenant,
        "admin",
        &format!("principal:{}", w.fx.principal),
    );

    let outcome = std::panic::AssertUnwindSafe(scenarios(&http, &e, &pool, &w));
    let result = futures_util::FutureExt::catch_unwind(outcome).await;

    // 清理：Catalog 恢复、关系撤回、夹具拆除——无论场景成败
    restore_catalog(&pool).await;
    for (object, relation, subject) in [
        (
            tenant.clone(),
            "admin",
            format!("principal:{}", w.fx.principal),
        ),
        (
            tenant.clone(),
            "admin",
            format!("principal:{}", w.b.principal),
        ),
    ] {
        common::zed_relationship(&e, "delete", &object, relation, &subject);
    }
    for m in [&w.b, &w.c, &w.d] {
        common::zed_relationship(
            &e,
            "delete",
            &tenant,
            "member",
            &format!("principal:{}", m.principal),
        );
    }
    let created: Vec<Uuid> =
        sqlx::query_scalar("select id from identity.workspace where tenant_id = $1 and id <> $2")
            .bind(w.fx.tenant)
            .bind(w.fx.workspace)
            .fetch_all(&pool)
            .await
            .unwrap_or_default();
    for ws in created {
        let _ = std::process::Command::new("sudo")
            .args([
                "-n",
                "docker",
                "run",
                "--rm",
                "--network",
                &e.docker_network,
                "--env-file",
                &e.zed_env_file,
                "-e",
                &format!("ZED_ENDPOINT={}", e.spicedb_in_network),
                "-e",
                "ZED_INSECURE=true",
                &e.zed_image,
                "relationship",
                "delete",
                &format!("workspace:{ws}"),
                "tenant",
                &tenant,
            ])
            .output();
    }
    common::zed_relationship(
        &e,
        "delete",
        &format!("workspace:{}", w.fx.workspace),
        "member",
        &format!("principal:{}", w.b.principal),
    );
    common::teardown_live_workspace(&e, &pool, &w.fx).await;
    common::teardown_members(&pool, &w.fx, &[&w.b, &w.c, &w.d]).await;
    delete_test_catalog(&pool).await;
    worker(&e, "start");
    if let Err(p) = result {
        std::panic::resume_unwind(p);
    }
}

async fn scenarios(http: &reqwest::Client, e: &Env, pool: &PgPool, w: &World) {
    let a = w.fx.subject.as_str();
    let ws = w.fx.workspace;

    // ---- 1. 直接允许：workspace.create 走完 WORKSPACE_LIFECYCLE ----
    let key = Uuid::new_v4();
    let slug = format!("g{}", &Uuid::new_v4().to_string()[..8]);
    let cmd =
        json!({"actionKey":"workspace.create","idempotencyKey":key,"slug":slug,"name":"治理核验"});
    let (st, body) = submit(http, e, a, cmd.clone()).await;
    assert!(st.is_success(), "workspace.create 应被允许：{st} {body}");
    common::assert_contract::<ActionSubmission>(&body, "ActionSubmission");
    let sub: ActionSubmission = serde_json::from_value(body.clone()).unwrap();
    let ae = Uuid::parse_str(&sub.action_execution_id).unwrap();
    let target: Uuid =
        sqlx::query_scalar("select target_id from admission.action_execution where id = $1")
            .bind(ae)
            .fetch_one(pool)
            .await
            .unwrap();
    until(e, "新 Workspace ACTIVE", || async {
        (state_of(pool, "identity.workspace", target).await == "ACTIVE").then_some(())
    })
    .await;
    // ActionDecision 带 SpiceDB 给出的 revision；DECISION 与 DISPATCH 各一条审计
    let zed: Option<String> = sqlx::query_scalar(
        "select zed_token from admission.action_decision where action_execution_id = $1 and phase = 'ADMISSION'")
        .bind(ae).fetch_one(pool).await.unwrap();
    assert!(zed.is_some_and(|z| !z.is_empty()), "准入没有记下 ZedToken");
    let stages: Vec<String> = sqlx::query_scalar(
        "select event_type from audit.audit_event where operation_id =
             (select operation_id from admission.action_execution where id = $1) order by occurred_at")
        .bind(ae).fetch_all(pool).await.unwrap();
    for want in ["INTENT", "DECISION", "DISPATCH"] {
        assert!(
            stages.iter().any(|s| s == want),
            "缺 {want} 审计：{stages:?}"
        );
    }
    // 幂等：同键同参回答同一 operation；同键异参拒绝
    let (st, again) = submit(http, e, a, cmd.clone()).await;
    assert!(st.is_success(), "同键重发应回答原 operation：{st} {again}");
    assert_eq!(
        again["actionExecutionId"], body["actionExecutionId"],
        "同键重发产生了第二个 ActionExecution"
    );
    let mut changed = cmd.clone();
    changed["name"] = json!("另一个名字");
    let (st, conflict) = submit(http, e, a, changed).await;
    assert_eq!(
        st,
        reqwest::StatusCode::CONFLICT,
        "同键异参应拒绝：{conflict}"
    );
    assert_eq!(reason(&conflict), "IDEMPOTENCY_KEY_REUSED");
    // 任务视图：本人可见，终态来自 Workflow 自己的写回
    let (st, task) = bff(
        http,
        e,
        a,
        reqwest::Method::GET,
        &format!("/api/v1/tasks/{ae}"),
        None,
    )
    .await;
    assert_eq!(st, reqwest::StatusCode::OK, "{task}");
    common::assert_contract::<TaskView>(&task, "TaskView");
    let (st, _) = bff(
        http,
        e,
        &w.b.subject,
        reqwest::Method::GET,
        &format!("/api/v1/tasks/{ae}"),
        None,
    )
    .await;
    assert!(!st.is_success(), "别人的任务不可见");

    // ---- 2. workspace.member.add：A 把 B 加进夹具 Workspace ----
    let (st, body) = submit(
        http,
        e,
        a,
        json!({"actionKey":"workspace.member.add","idempotencyKey":Uuid::new_v4(),
        "workspaceId":ws,"principalId":w.b.principal}),
    )
    .await;
    assert!(st.is_success(), "member.add 应被允许：{st} {body}");
    let add_ae = Uuid::parse_str(body["actionExecutionId"].as_str().unwrap()).unwrap();
    let b_wm: Uuid =
        sqlx::query_scalar("select target_id from admission.action_execution where id = $1")
            .bind(add_ae)
            .fetch_one(pool)
            .await
            .unwrap();
    until(e, "B 的 WorkspaceMembership ACTIVE", || async {
        (state_of(pool, "identity.workspace_membership", b_wm).await == "ACTIVE").then_some(())
    })
    .await;

    // ---- 3. DENY：B 是成员但没有 workspace manage；C 连成员都不是 ----
    let (st, body) = submit(
        http,
        e,
        &w.b.subject,
        json!({"actionKey":"workspace.member.revoke",
        "idempotencyKey":Uuid::new_v4(),"workspaceId":ws,"principalId":w.fx.principal}),
    )
    .await;
    assert_eq!(st, reqwest::StatusCode::FORBIDDEN, "{body}");
    assert_eq!(reason(&body), "PERMISSION_DENIED");
    let op = refused(&body).operation_id.expect("拒绝应带 operation ID");
    let (gate, dispatch, r): (String, String, Option<String>) = sqlx::query_as(
        "select gate_state, dispatch_state, reason_code from admission.action_execution where operation_id = $1")
        .bind(Uuid::parse_str(&op).unwrap()).fetch_one(pool).await.unwrap();
    assert_eq!(
        (gate.as_str(), dispatch.as_str(), r.as_deref()),
        ("DENIED", "NOT_DISPATCHED", Some("PERMISSION_DENIED"))
    );
    assert_eq!(
        state_of(
            pool,
            "identity.workspace_membership",
            w.fx.workspace_membership
        )
        .await,
        "ACTIVE",
        "被拒的动作推进了实体"
    );
    let (st, body) = submit(
        http,
        e,
        &w.c.subject,
        json!({"actionKey":"workspace.member.add",
        "idempotencyKey":Uuid::new_v4(),"workspaceId":ws,"principalId":w.d.principal}),
    )
    .await;
    assert_eq!(st, reqwest::StatusCode::FORBIDDEN, "{body}");
    assert_eq!(reason(&body), "SCOPE_GUARD_FAILED");

    // ---- 4. GAP-LCM-01：Tenant delete 没有登记，入口不存在 ----
    let (st, body) = submit(
        http,
        e,
        a,
        json!({"actionKey":"tenant.delete","idempotencyKey":Uuid::new_v4()}),
    )
    .await;
    assert_eq!(st, reqwest::StatusCode::FORBIDDEN, "{body}");
    assert_eq!(reason(&body), "CAPABILITY_BLOCKED");
    let registered: i64 = sqlx::query_scalar(
        "select count(*) from catalog.action_definition where action_key like 'tenant.delete%'",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(registered, 0, "Tenant delete 不得登记（GAP-LCM-01）");

    // ---- 5. 需审批：A 撤 C → B 批准 → 重新准入 → MEMBERSHIP_REVOCATION → CONSUMED ----
    // B 从这里起是第二位 Tenant admin（职责分离需要另一位 admin 批准），经角色动作授予
    // （DD-82）；A 的 admin 仍由夹具直接写入——夹具 Tenant 不经部署引导
    let (st, body) = submit(
        http,
        e,
        a,
        json!({"actionKey":"tenant.admin.grant","idempotencyKey":Uuid::new_v4(),"principalId":w.b.principal}),
    )
    .await;
    assert_eq!(
        st,
        reqwest::StatusCode::OK,
        "A 授 B 为 Tenant admin：{body}"
    );
    let (st, body) = submit(
        http,
        e,
        a,
        json!({"actionKey":"tenant.member.revoke",
        "idempotencyKey":Uuid::new_v4(),"principalId":w.c.principal}),
    )
    .await;
    assert_eq!(st, reqwest::StatusCode::ACCEPTED, "{body}");
    let sub: ActionSubmission = serde_json::from_value(body.clone()).unwrap();
    assert_eq!(serde_json::to_value(&sub.gate_state).unwrap(), "WAITING");
    let wf = sub
        .approval_workflow_id
        .clone()
        .expect("WAITING 必有审批 workflow ID");
    let rv_ae = Uuid::parse_str(&sub.action_execution_id).unwrap();
    until(e, "审批 WAITING", || async {
        (approval_status(pool, &wf).await.as_deref() == Some("WAITING")).then_some(())
    })
    .await;
    assert_eq!(
        state_of(pool, "identity.tenant_membership", w.c.membership).await,
        "ACTIVE",
        "批准之前不得推进实体"
    );
    // 发起者看不到自己的请求（self_approval=DENY），也不能自批
    let (_, pending_a) = bff(http, e, a, reqwest::Method::GET, "/api/v1/approvals", None).await;
    assert!(
        !pending_a
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v["workflowId"] == wf),
        "发起者的待我审批里出现了自己的请求"
    );
    let path = format!("/api/v1/approvals/{wf}/decision");
    let (st, body) = bff(
        http,
        e,
        a,
        reqwest::Method::POST,
        &path,
        Some(json!({"decision":"APPROVE"})),
    )
    .await;
    assert_eq!(st, reqwest::StatusCode::FORBIDDEN, "{body}");
    assert_eq!(reason(&body), "SELF_APPROVAL_DENIED");
    // C（非 admin）的决定不形成决定
    let (st, body) = bff(
        http,
        e,
        &w.d.subject,
        reqwest::Method::POST,
        &path,
        Some(json!({"decision":"DENY"})),
    )
    .await;
    assert_eq!(st, reqwest::StatusCode::FORBIDDEN, "{body}");
    assert_eq!(reason(&body), "APPROVER_NOT_ELIGIBLE");
    assert_eq!(
        approval_status(pool, &wf).await.as_deref(),
        Some("WAITING"),
        "不合格者的否决终结了审批"
    );
    // B 在待我审批里看到它。列表用低延迟一致性（.design/10 §1），刚写入的 admin
    // 关系可能要等 SpiceDB 的 quantization 窗口才可见，因此轮询；决定本身仍是
    // FullyConsistent
    let pending_b = until(e, "B 的待我审批出现该请求", || async {
        let (_, v) = bff(
            http,
            e,
            &w.b.subject,
            reqwest::Method::GET,
            "/api/v1/approvals",
            None,
        )
        .await;
        v.as_array()
            .is_some_and(|a| a.iter().any(|x| x["workflowId"] == wf))
            .then_some(v)
    })
    .await;
    common::assert_contract::<ApprovalView>(&pending_b, "ApprovalView");
    let (st, body) = bff(
        http,
        e,
        &w.b.subject,
        reqwest::Method::POST,
        &path,
        Some(json!({"decision":"APPROVE"})),
    )
    .await;
    assert_eq!(st, reqwest::StatusCode::OK, "{body}");
    common::assert_contract::<ApprovalDecisionOutcome>(&body, "ApprovalDecisionOutcome");
    // 重复同值幂等；冲突值拒绝
    let (st, again) = bff(
        http,
        e,
        &w.b.subject,
        reqwest::Method::POST,
        &path,
        Some(json!({"decision":"APPROVE"})),
    )
    .await;
    assert_eq!(st, reqwest::StatusCode::OK, "同值重复应幂等：{again}");
    let (st, conflict) = bff(
        http,
        e,
        &w.b.subject,
        reqwest::Method::POST,
        &path,
        Some(json!({"decision":"DENY"})),
    )
    .await;
    assert_eq!(st, reqwest::StatusCode::CONFLICT, "{conflict}");
    assert_eq!(reason(&conflict), "DUPLICATE_DECISION");
    until(e, "批准被消费", || async {
        (approval_status(pool, &wf).await.as_deref() == Some("CONSUMED")).then_some(())
    })
    .await;
    until(e, "C 的 TenantMembership REVOKED", || async {
        (state_of(pool, "identity.tenant_membership", w.c.membership).await == "REVOKED")
            .then_some(())
    })
    .await;
    assert_eq!(gate_of(pool, rv_ae).await.0, "ALLOWED");
    let rechecks: i64 = sqlx::query_scalar(
        "select count(*) from admission.action_decision where action_execution_id = $1 and phase = 'RECHECK'
           and authorization_decision = 'ALLOW' and approval_decision = 'SATISFIED'")
        .bind(rv_ae).fetch_one(pool).await.unwrap();
    assert_eq!(rechecks, 1, "批准后没有做重新准入就派发了");
    // 审批投影只来自 history：终态时 WorkflowRef 已 TERMINAL，run 与 Temporal 一致
    let (ref_state, ref_run, proj_run): (String, Option<String>, String) = sqlx::query_as(
        "select w.projection_state, w.run_id, p.run_id from projection.workflow_ref w
         join projection.approval_projection p on p.workflow_id = w.workflow_id where w.workflow_id = $1")
        .bind(&wf).fetch_one(pool).await.unwrap();
    until(e, "审批 WorkflowRef TERMINAL", || async {
        let s: String = sqlx::query_scalar(
            "select projection_state from projection.workflow_ref where workflow_id = $1",
        )
        .bind(&wf)
        .fetch_one(pool)
        .await
        .unwrap();
        (s == "TERMINAL").then_some(())
    })
    .await;
    let _ = ref_state;
    assert_eq!(
        ref_run.as_deref(),
        Some(proj_run.as_str()),
        "审批投影的 run 不是 WorkflowRef 回填的那一次"
    );
    assert_eq!(
        temporal_run(e, &wf),
        proj_run,
        "审批投影的 run 不是 Temporal 上那一次"
    );

    // ---- 6. 批准后权限被撤：A 失去 admin → B 批准 → 重新准入拒绝 → INVALIDATED ----
    let (st, body) = submit(
        http,
        e,
        a,
        json!({"actionKey":"tenant.member.revoke",
        "idempotencyKey":Uuid::new_v4(),"principalId":w.d.principal}),
    )
    .await;
    assert_eq!(st, reqwest::StatusCode::ACCEPTED, "{body}");
    let inv_ae = Uuid::parse_str(body["actionExecutionId"].as_str().unwrap()).unwrap();
    let inv_wf = body["approvalWorkflowId"].as_str().unwrap().to_owned();
    until(e, "审批 WAITING", || async {
        (approval_status(pool, &inv_wf).await.as_deref() == Some("WAITING")).then_some(())
    })
    .await;
    let tenant = format!("tenant:{}", w.fx.tenant);
    common::zed_relationship(
        e,
        "delete",
        &tenant,
        "admin",
        &format!("principal:{}", w.fx.principal),
    );
    let (st, body) = bff(
        http,
        e,
        &w.b.subject,
        reqwest::Method::POST,
        &format!("/api/v1/approvals/{inv_wf}/decision"),
        Some(json!({"decision":"APPROVE"})),
    )
    .await;
    assert_eq!(st, reqwest::StatusCode::OK, "{body}");
    until(e, "批准失效", || async {
        (approval_status(pool, &inv_wf).await.as_deref() == Some("INVALIDATED")).then_some(())
    })
    .await;
    let (gate, dispatch, r) = gate_of(pool, inv_ae).await;
    assert_eq!(
        (gate.as_str(), dispatch.as_str(), r.as_deref()),
        ("REVOKED", "NOT_DISPATCHED", Some("PERMISSION_DENIED"))
    );
    assert_eq!(
        state_of(pool, "identity.tenant_membership", w.d.membership).await,
        "ACTIVE",
        "失效的批准推进了实体"
    );
    common::zed_relationship(
        e,
        "touch",
        &tenant,
        "admin",
        &format!("principal:{}", w.fx.principal),
    );

    // ---- 7. 撤回：发起者撤回未决请求 → CANCELLED ----
    let (st, body) = submit(
        http,
        e,
        a,
        json!({"actionKey":"tenant.member.revoke",
        "idempotencyKey":Uuid::new_v4(),"principalId":w.d.principal}),
    )
    .await;
    assert_eq!(st, reqwest::StatusCode::ACCEPTED, "{body}");
    let wd_ae = Uuid::parse_str(body["actionExecutionId"].as_str().unwrap()).unwrap();
    let wd_wf = body["approvalWorkflowId"].as_str().unwrap().to_owned();
    until(e, "审批 WAITING", || async {
        (approval_status(pool, &wd_wf).await.as_deref() == Some("WAITING")).then_some(())
    })
    .await;
    let (st, body) = bff(
        http,
        e,
        &w.b.subject,
        reqwest::Method::POST,
        &format!("/api/v1/approvals/{wd_wf}/withdraw"),
        None,
    )
    .await;
    assert!(!st.is_success(), "非发起者不能撤回：{body}");
    let (st, body) = bff(
        http,
        e,
        a,
        reqwest::Method::POST,
        &format!("/api/v1/approvals/{wd_wf}/withdraw"),
        None,
    )
    .await;
    assert_eq!(st, reqwest::StatusCode::OK, "{body}");
    until(e, "撤回生效", || async {
        (gate_of(pool, wd_ae).await.0 == "REVOKED").then_some(())
    })
    .await;
    assert_eq!(
        approval_status(pool, &wd_wf).await.as_deref(),
        Some("CANCELLED")
    );

    // ---- 8. 过期：登记一个短时效策略版本，请求在期限内无人决定 → EXPIRED ----
    register_short_policy(pool).await;
    let (st, body) = submit(
        http,
        e,
        a,
        json!({"actionKey":"tenant.member.revoke",
        "idempotencyKey":Uuid::new_v4(),"principalId":w.d.principal}),
    )
    .await;
    assert_eq!(st, reqwest::StatusCode::ACCEPTED, "{body}");
    let ex_ae = Uuid::parse_str(body["actionExecutionId"].as_str().unwrap()).unwrap();
    let ex_wf = body["approvalWorkflowId"].as_str().unwrap().to_owned();
    until(e, "审批过期", || async {
        (approval_status(pool, &ex_wf).await.as_deref() == Some("EXPIRED")).then_some(())
    })
    .await;
    until(e, "门禁过期", || async {
        (gate_of(pool, ex_ae).await.0 == "EXPIRED").then_some(())
    })
    .await;
    let (st, body) = bff(
        http,
        e,
        &w.b.subject,
        reqwest::Method::POST,
        &format!("/api/v1/approvals/{ex_wf}/decision"),
        Some(json!({"decision":"APPROVE"})),
    )
    .await;
    assert_eq!(
        st,
        reqwest::StatusCode::CONFLICT,
        "过期后的决定应被拒绝：{body}"
    );
    restore_catalog(pool).await;

    // ---- 9. Start 响应不明：不产生第二个 workflow ID；投影落后显示 PROJECTION_DELAYED ----
    // Worker 停下：Start 被 Temporal 接受，但 Workflow 不推进、不写回
    worker(e, "stop");
    let key = Uuid::new_v4();
    let cmd = json!({"actionKey":"workspace.member.add","idempotencyKey":key,"workspaceId":ws,"principalId":w.d.principal});
    let (st, body) = submit(http, e, a, cmd.clone()).await;
    assert!(st.is_success(), "{st} {body}");
    let un_ae = Uuid::parse_str(body["actionExecutionId"].as_str().unwrap()).unwrap();
    let wf_id = body["workflowId"].as_str().unwrap().to_owned();
    let first_run = temporal_run(e, &wf_id);
    // 模拟 Core 在 Start 之后、记下结果之前失去回应：派发结果不明，WorkflowRef 未确认
    sqlx::query("update admission.action_execution set dispatch_state = 'UNKNOWN' where id = $1")
        .bind(un_ae)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("update projection.workflow_ref set projection_state = 'PENDING_START', run_id = null where workflow_id = $1")
        .bind(&wf_id).execute(pool).await.unwrap();
    let (_, task) = bff(
        http,
        e,
        a,
        reqwest::Method::GET,
        &format!("/api/v1/tasks/{un_ae}"),
        None,
    )
    .await;
    assert_eq!(
        task["observation"], "EXTERNAL_RESULT_UNKNOWN",
        "结果不明不得渲染成成功或失败：{task}"
    );
    // 客户端以同一幂等键重试：以同一 ID 收敛
    let (st, body) = submit(http, e, a, cmd).await;
    assert!(st.is_success(), "{st} {body}");
    assert_eq!(body["workflowId"], wf_id.as_str(), "重试换了 workflow ID");
    assert_eq!(body["dispatchState"], "DISPATCHED", "{body}");
    let refs: i64 = sqlx::query_scalar(
        "select count(*) from projection.workflow_ref where action_execution_id = $1",
    )
    .bind(un_ae)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(refs, 1, "同一 ActionExecution 出现了第二个 WorkflowRef");
    // 仍是第一次 Start 的那个 run：重试收到的是「已存在」，没有启动第二个 execution
    assert_eq!(
        temporal_run(e, &wf_id),
        first_run,
        "Temporal 上出现了第二个 execution"
    );
    // Workflow 不写回：超过新鲜度上界后显示 PROJECTION_DELAYED，而不是装作完成
    let freshness: i64 = std::env::var("WORKFLOW_PROJECTION_FRESHNESS_SECONDS")
        .unwrap()
        .parse()
        .unwrap();
    tokio::time::sleep(Duration::from_secs(freshness as u64 + 2)).await;
    let (_, task) = bff(
        http,
        e,
        a,
        reqwest::Method::GET,
        &format!("/api/v1/tasks/{un_ae}"),
        None,
    )
    .await;
    assert_eq!(task["observation"], "PROJECTION_DELAYED", "{task}");
    assert!(
        task.get("taskStatus").is_none(),
        "Worker 没跑却出现了任务状态：{task}"
    );
    worker(e, "start");
    let d_wm: Uuid =
        sqlx::query_scalar("select target_id from admission.action_execution where id = $1")
            .bind(un_ae)
            .fetch_one(pool)
            .await
            .unwrap();
    until(e, "D 的 WorkspaceMembership ACTIVE", || async {
        (state_of(pool, "identity.workspace_membership", d_wm).await == "ACTIVE").then_some(())
    })
    .await;
    until(e, "投影追上", || async {
        let (_, t) = bff(
            http,
            e,
            a,
            reqwest::Method::GET,
            &format!("/api/v1/tasks/{un_ae}"),
            None,
        )
        .await;
        (t.get("observation").is_none() && t["taskStatus"] == "COMPLETED").then_some(())
    })
    .await;
    common::zed_relationship(
        e,
        "delete",
        &format!("workspace:{ws}"),
        "member",
        &format!("principal:{}", w.d.principal),
    );

    // 本次执行的审批 workflow ID：它们的 history 是 worker/replay-tests 的录制来源
    eprintln!("审批 history：CONSUMED={wf} INVALIDATED={inv_wf} CANCELLED={wd_wf} EXPIRED={ex_wf}");

    // 本人任务列表合契约
    let (st, tasks) = bff(http, e, a, reqwest::Method::GET, "/api/v1/tasks", None).await;
    assert_eq!(st, reqwest::StatusCode::OK);
    common::assert_contract::<TaskView>(&tasks, "TaskView[]");
}

/// Temporal 上该 workflow ID 当前（最新）一次 run 的 run ID。
fn temporal_run(e: &Env, workflow_id: &str) -> String {
    let var = |k: &str| std::env::var(k).unwrap_or_else(|_| panic!("缺少 {k}"));
    let out = std::process::Command::new("sudo")
        .args([
            "-n",
            "docker",
            "run",
            "--rm",
            "--network",
            &e.docker_network,
            &var("VERIFY_TEMPORAL_ADMIN_IMAGE"),
            "temporal",
            "workflow",
            "describe",
            "--address",
            &var("VERIFY_TEMPORAL_INTERNAL_ADDRESS"),
            "--namespace",
            &var("TEMPORAL_NAMESPACE"),
            "--workflow-id",
            workflow_id,
            "--output",
            "json",
        ])
        .output()
        .expect("运行 temporal CLI");
    assert!(
        out.status.success(),
        "temporal workflow describe 失败：{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let v: Value = serde_json::from_slice(&out.stdout).expect("describe 输出不是 JSON");
    v["workflowExecutionInfo"]["execution"]["runId"]
        .as_str()
        .unwrap_or_else(|| panic!("describe 输出缺 runId：{v}"))
        .to_owned()
}

/// 停或起 Worker 容器。Worker 由本切片独占重建。
fn worker(e: &Env, op: &str) {
    let _ = e;
    let out = std::process::Command::new("sudo")
        .args(["-n", "docker", op, "kailo-local-worker-1"])
        .output()
        .expect("运行 docker");
    assert!(
        out.status.success(),
        "docker {op} worker 失败：{}",
        String::from_utf8_lossy(&out.stderr)
    );
}

/// 过期场景：登记 tenant.member.revoke 的新版本，引用一个短时效的新策略版本。
/// 这是真实的 Catalog 版本发布（版本不可变、同 key 至多一个 ACTIVE），不是改旧版本。
const SHORT_POLICY_VERSION: i32 = 900;
async fn register_short_policy(pool: &PgPool) {
    let mut tx = pool.begin().await.unwrap();
    sqlx::query("update catalog.approval_policy set status = 'RETIRED' where id = '6f1c0b52-6a55-4d0e-9a53-7c3f2a4e1b01' and version = 1")
        .execute(&mut *tx).await.unwrap();
    sqlx::query(
        "insert into catalog.approval_policy (id, version, action_key, target_type, role_requirements,
             owner_requirement, self_approval, expires_in_seconds, status)
         select id, $1, action_key, target_type, role_requirements, owner_requirement, self_approval, 8, 'ACTIVE'
         from catalog.approval_policy where id = '6f1c0b52-6a55-4d0e-9a53-7c3f2a4e1b01' and version = 1")
        .bind(SHORT_POLICY_VERSION).execute(&mut *tx).await.unwrap();
    sqlx::query("update catalog.action_definition set status = 'RETIRED' where action_key = 'tenant.member.revoke' and version = 1")
        .execute(&mut *tx).await.unwrap();
    sqlx::query(
        "insert into catalog.action_definition
         select action_key, $1, component_type_key, target_type, tenant_rule, workspace_rule, permission,
                permission_object_type, execution_mode, confirmation_mode, approval_policy_id, $1, workflow_type,
                workflow_kind, capacity_policy, capacity_pool_key, quota_policy, meters, result_exposure,
                audit_policy, obs_correlation_mode, obs_progress_source, obs_terminal_source, obs_usage_source,
                obs_cost_source, obs_redaction_policy, 'ACTIVE', now()
         from catalog.action_definition where action_key = 'tenant.member.revoke' and version = 1")
        .bind(SHORT_POLICY_VERSION).execute(&mut *tx).await.unwrap();
    tx.commit().await.unwrap();
}

/// 恢复随平台发布的版本为 ACTIVE。幂等。
async fn restore_catalog(pool: &PgPool) {
    for sql in [
        "update catalog.action_definition set status = 'RETIRED' where action_key = 'tenant.member.revoke' and version <> 1 and status = 'ACTIVE'",
        "update catalog.approval_policy set status = 'RETIRED' where id = '6f1c0b52-6a55-4d0e-9a53-7c3f2a4e1b01' and version <> 1 and status = 'ACTIVE'",
        "update catalog.approval_policy set status = 'ACTIVE' where id = '6f1c0b52-6a55-4d0e-9a53-7c3f2a4e1b01' and version = 1 and status <> 'ACTIVE'",
        "update catalog.action_definition set status = 'ACTIVE' where action_key = 'tenant.member.revoke' and version = 1 and status <> 'ACTIVE'",
    ] {
        if let Err(err) = sqlx::query(sql).execute(pool).await {
            eprintln!("恢复 Catalog 失败：{sql}\n  {err}");
        }
    }
}

/// 夹具的 ActionExecution 删掉之后，测试版本不再被引用，可以删除。
async fn delete_test_catalog(pool: &PgPool) {
    for sql in [
        "delete from catalog.action_definition where action_key = 'tenant.member.revoke' and version = $1",
        "delete from catalog.approval_policy where id = '6f1c0b52-6a55-4d0e-9a53-7c3f2a4e1b01' and version = $1",
    ] {
        if let Err(err) = sqlx::query(sql).bind(SHORT_POLICY_VERSION).execute(pool).await {
            eprintln!("删除测试 Catalog 版本失败：{sql}\n  {err}");
        }
    }
}
