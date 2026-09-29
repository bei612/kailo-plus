//! 范围审计与 EvidenceRef 解引用的端到端核验（DD-52、V-SCN-43）。
//!
//! 走真实拓扑：夹具 Tenant/Workspace 经生命周期 Workflow 开通，auditor 关系用 zed
//! 直接写 SpiceDB，BFF 以网关投影的身份 header 调用。三类不可用证据（RESTRICTED、
//! 存量不可识别种类、Core 原对象不存在）由夹具向只追加的审计表追加事件构造——
//! 其余用例同样给夹具 Tenant 留下审计行，审计表不可删改。
//!
//! 外部权威的证据同样逐种查证：Temporal workflow 按 ID Describe，明确不存在回 404；
//! 没有查证接口的种类（ZedToken 等）只回 UNVERIFIABLE，不默认可用。

use futures_util::FutureExt;
use reqwest::Method;
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

mod common;
use common::{bff, Env, LiveWorkspace};

fn principal(p: Uuid) -> String {
    format!("principal:{p}")
}

/// 在夹具 Tenant（可带 Workspace）追加一条只含给定证据的 OUTCOME 事件。
async fn append_event(
    pool: &PgPool,
    fx: &LiveWorkspace,
    workspace: Option<Uuid>,
    refs: Value,
) -> Uuid {
    let id = Uuid::new_v4();
    let operation = Uuid::new_v4();
    sqlx::query(
        "insert into audit.audit_event
             (id, event_key, tenant_id, workspace_id, operation_id, event_type,
              initiator_principal_id, actor_principal_id, action_key, action_version,
              component_type_key, parameter_hash, decision, result_code, result_exposure,
              evidence_refs, correlation_id)
         values ($1, $2, $3, $4, $5, 'OUTCOME', $6, $6, 'verify.audit_evidence', 1,
                 'core', 'NONE', 'ALLOW', 'VERIFIED', 'NONE', $7, $5)",
    )
    .bind(id)
    .bind(format!("verify-audit-evidence:{id}"))
    .bind(fx.tenant)
    .bind(workspace)
    .bind(operation)
    .bind(fx.principal)
    .bind(refs)
    .execute(pool)
    .await
    .expect("追加核验审计事件");
    id
}

async fn deref(
    http: &reqwest::Client,
    e: &Env,
    fx: &LiveWorkspace,
    event: Uuid,
    index: usize,
) -> (reqwest::StatusCode, Value) {
    bff(
        http,
        e,
        &fx.subject,
        Method::GET,
        &format!("/api/v1/audit/events/{event}/evidence/{index}"),
        None,
    )
    .await
}

async fn run(http: &reqwest::Client, e: &Env, pool: &PgPool, fx: &LiveWorkspace) {
    let tenant = format!("tenant:{}", fx.tenant);
    let workspace = format!("workspace:{}", fx.workspace);
    let me = principal(fx.principal);

    // ---- 1. 无 audit permission：整个范围 403 ----
    let (st, _) = bff(
        http,
        e,
        &fx.subject,
        Method::GET,
        "/api/v1/audit/events",
        None,
    )
    .await;
    assert_eq!(
        st,
        reqwest::StatusCode::FORBIDDEN,
        "普通成员不应读到 Tenant 范围审计"
    );

    // ---- 2. 授予 Tenant auditor：列表只给种类，不给稳定 ID ----
    common::zed_relationship(e, "touch", &tenant, "auditor", &me);
    let (st, page) = bff(
        http,
        e,
        &fx.subject,
        Method::GET,
        "/api/v1/audit/events",
        None,
    )
    .await;
    assert_eq!(st, reqwest::StatusCode::OK, "{page}");
    common::assert_contract::<contracts::AuditEventPage>(&page, "AuditEventPage");
    let events = page["events"].as_array().expect("events");
    assert!(!events.is_empty(), "夹具开通应已留下审计事件");
    assert!(
        !page.to_string().contains("stableId"),
        "列表不得带稳定 ID：{page}"
    );

    // ---- 2b. cursor 分页：从某条事件之后读，不再包含它 ----
    let first = events[0]["id"].as_str().unwrap().to_owned();
    let (st, next) = bff(
        http,
        e,
        &fx.subject,
        Method::GET,
        &format!("/api/v1/audit/events?cursor={first}"),
        None,
    )
    .await;
    assert_eq!(st, reqwest::StatusCode::OK, "{next}");
    assert!(
        next["events"]
            .as_array()
            .unwrap()
            .iter()
            .all(|ev| ev["id"] != json!(first)),
        "游标之后的页不应包含游标本身"
    );

    // ---- 2c. 不属于本 Tenant 的 Workspace：在授权判定前即 403 ----
    let foreign_workspace = Uuid::new_v4();
    let (st, _) = bff(
        http,
        e,
        &fx.subject,
        Method::GET,
        &format!("/api/v1/audit/events?workspaceId={foreign_workspace}"),
        None,
    )
    .await;
    assert_eq!(
        st,
        reqwest::StatusCode::FORBIDDEN,
        "不属于本 Tenant 的 Workspace 不得作为范围"
    );

    // 夹具开通在 Temporal 中留下的真实 workflow：可用性由 Temporal Describe 查证
    let live_workflow: String = sqlx::query_scalar(
        "select e ->> 'value' from audit.audit_event, jsonb_array_elements(evidence_refs) e
         where tenant_id = $1 and e ->> 'kind' = 'TEMPORAL_WORKFLOW_ID'
         order by occurred_at limit 1",
    )
    .bind(fx.tenant)
    .fetch_one(pool)
    .await
    .expect("夹具开通应留下 TEMPORAL_WORKFLOW_ID 证据");

    // ---- 2d. Tenant auditor 经 tenant->audit 可解引用 Workspace 事件 ----
    let tenant_view_of_ws = append_event(
        pool,
        fx,
        Some(fx.workspace),
        json!([{ "kind": "TEMPORAL_WORKFLOW_ID", "value": live_workflow }]),
    )
    .await;
    let (st, view) = deref(http, e, fx, tenant_view_of_ws, 0).await;
    assert_eq!(
        (st, view["available"].clone()),
        (reqwest::StatusCode::OK, json!(true)),
        "{view}"
    );

    // ---- 3. SUMMARY 证据：解引用得到与库中一致的稳定 ID ----
    let (event, index) = events
        .iter()
        .find_map(|ev| {
            ev["evidence"].as_array()?.iter().find_map(|slot| {
                (slot["kind"] == "TEMPORAL_WORKFLOW_ID" && slot["sensitivity"] == "SUMMARY").then(
                    || {
                        (
                            Uuid::parse_str(ev["id"].as_str().unwrap()).unwrap(),
                            slot["index"].as_u64().unwrap() as usize,
                        )
                    },
                )
            })
        })
        .expect("生命周期事件应带 TEMPORAL_WORKFLOW_ID 证据");
    let (st, view) = deref(http, e, fx, event, index).await;
    assert_eq!(st, reqwest::StatusCode::OK, "{view}");
    common::assert_contract::<contracts::EvidenceView>(&view, "EvidenceView");
    assert_eq!(view["available"], true, "{view}");
    let stored: Value =
        sqlx::query_scalar("select evidence_refs -> $2::int from audit.audit_event where id = $1")
            .bind(event)
            .bind(index as i32)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(
        view["stableId"], stored["value"],
        "解引用应回库中同一稳定 ID"
    );
    assert_eq!(view["authority"], "TEMPORAL");

    // ---- 4. 三类不可用：只回原因，不回任何 ref 内容 ----
    let secret_subject = "d286a7cf23ed54c3494fc96f210eab2a3e4195aa89dc822c0c47f1aaac191181";
    let missing_action = Uuid::new_v4();
    let crafted = append_event(
        pool,
        fx,
        None,
        json!([
            { "kind": "EXTERNAL_SUBJECT_SHA256", "value": secret_subject },
            { "kind": "TENANT_MEMBERSHIP_STATE", "value": "REVOKED" },
            { "kind": "ACTION_EXECUTION_ID", "value": missing_action },
        ]),
    )
    .await;
    for (index, status, reason) in [
        (0, reqwest::StatusCode::OK, "RESTRICTED"),
        (1, reqwest::StatusCode::OK, "UNRECOGNIZED"),
        (2, reqwest::StatusCode::NOT_FOUND, "NOT_FOUND"),
    ] {
        let (st, view) = deref(http, e, fx, crafted, index).await;
        assert_eq!(st, status, "{view}");
        assert_eq!(view["available"], false, "{view}");
        assert_eq!(view["unavailableReason"], reason, "{view}");
        assert!(
            view.get("stableId").is_none(),
            "不可用时不得回 ref 内容：{view}"
        );
        let text = view.to_string();
        assert!(
            !text.contains(secret_subject)
                && !text.contains("REVOKED")
                && !text.contains(&missing_action.to_string())
        );
    }
    let (st, _) = deref(http, e, fx, crafted, 3).await;
    assert_eq!(st, reqwest::StatusCode::NOT_FOUND, "越界位置应 404");

    // ---- 4b. 审批策略：新写入带 version，存量 `<id>@<version>` 同样可读；版本不存在即 NOT_FOUND ----
    let (policy, policy_version): (Uuid, i32) =
        sqlx::query_as("select id, version from catalog.approval_policy limit 1")
            .fetch_one(pool)
            .await
            .expect("应有已登记的审批策略");
    let policies = append_event(
        pool,
        fx,
        None,
        json!([
            { "kind": "APPROVAL_POLICY", "value": policy, "version": policy_version },
            { "kind": "APPROVAL_POLICY", "value": format!("{policy}@{policy_version}") },
            { "kind": "APPROVAL_POLICY", "value": policy, "version": policy_version + 1000 },
        ]),
    )
    .await;
    for (index, status, available) in [
        (0, reqwest::StatusCode::OK, true),
        (1, reqwest::StatusCode::OK, true),
        (2, reqwest::StatusCode::NOT_FOUND, false),
    ] {
        let (st, view) = deref(http, e, fx, policies, index).await;
        assert_eq!(st, status, "{view}");
        assert_eq!(view["available"], available, "{view}");
    }

    // ---- 4c. 外部权威逐种查证：Temporal 中不存在的 workflow/run 回 404，
    //      没有查证接口或无法绑定 workflow 的只回 UNVERIFIABLE，都不回 ref 内容 ----
    let missing_workflow = format!("platform:verify:{}:{}:1", fx.tenant, Uuid::new_v4());
    let missing_run = Uuid::new_v4().to_string();
    let zed_token = "GhUKEzE3MjcwMDAwMDAwMDAwMDAwMDA=";
    let temporal = append_event(
        pool,
        fx,
        None,
        json!([
            { "kind": "TEMPORAL_WORKFLOW_ID", "value": missing_workflow },
            { "kind": "TEMPORAL_RUN_ID", "value": missing_run },
        ]),
    )
    .await;
    let unbound = append_event(
        pool,
        fx,
        None,
        json!([
            { "kind": "TEMPORAL_RUN_ID", "value": missing_run },
            { "kind": "SPICEDB_ZEDTOKEN", "value": zed_token },
        ]),
    )
    .await;
    for (event, index, status, reason) in [
        (temporal, 0, reqwest::StatusCode::NOT_FOUND, "NOT_FOUND"),
        (temporal, 1, reqwest::StatusCode::NOT_FOUND, "NOT_FOUND"),
        (unbound, 0, reqwest::StatusCode::OK, "UNVERIFIABLE"),
        (unbound, 1, reqwest::StatusCode::OK, "UNVERIFIABLE"),
    ] {
        let (st, view) = deref(http, e, fx, event, index).await;
        assert_eq!(st, status, "{view}");
        common::assert_contract::<contracts::EvidenceView>(&view, "EvidenceView");
        assert_eq!(view["available"], false, "{view}");
        assert_eq!(view["unavailableReason"], reason, "{view}");
        assert_eq!(
            view["authority"],
            if index == 1 && event == unbound {
                "SPICEDB"
            } else {
                "TEMPORAL"
            }
        );
        let text = view.to_string();
        assert!(
            view.get("stableId").is_none()
                && !text.contains(&missing_workflow)
                && !text.contains(&missing_run)
                && !text.contains(zed_token),
            "不可用时不得回 ref 内容：{view}"
        );
    }

    // ---- 5. 别的 Tenant 的事件：与不存在同样 404 ----
    let foreign: Uuid = sqlx::query_scalar(
        "select id from audit.audit_event where tenant_id is not null and tenant_id <> $1 limit 1",
    )
    .bind(fx.tenant)
    .fetch_one(pool)
    .await
    .expect("应有其他 Tenant 的审计事件");
    let (st, _) = deref(http, e, fx, foreign, 0).await;
    assert_eq!(st, reqwest::StatusCode::NOT_FOUND);

    // ---- 6. 撤销 auditor：下一次请求即 403（fresh Check） ----
    common::zed_relationship(e, "delete", &tenant, "auditor", &me);
    let (st, _) = bff(
        http,
        e,
        &fx.subject,
        Method::GET,
        "/api/v1/audit/events",
        None,
    )
    .await;
    assert_eq!(
        st,
        reqwest::StatusCode::FORBIDDEN,
        "撤销 auditor 后不得再读"
    );
    let (st, _) = deref(http, e, fx, event, index).await;
    assert_eq!(st, reqwest::StatusCode::FORBIDDEN, "撤销后不得再解引用");

    // ---- 7. Workspace auditor：只读该 Workspace，Tenant 级事件不可解引用 ----
    common::zed_relationship(e, "touch", &workspace, "auditor", &me);
    let ws_event = append_event(
        pool,
        fx,
        Some(fx.workspace),
        json!([{ "kind": "TEMPORAL_WORKFLOW_ID", "value": live_workflow }]),
    )
    .await;
    let (st, page) = bff(
        http,
        e,
        &fx.subject,
        Method::GET,
        &format!("/api/v1/audit/events?workspaceId={}", fx.workspace),
        None,
    )
    .await;
    assert_eq!(st, reqwest::StatusCode::OK, "{page}");
    let events = page["events"].as_array().unwrap();
    assert!(
        events
            .iter()
            .all(|ev| ev["workspaceId"] == json!(fx.workspace)),
        "只应有该 Workspace 的事件"
    );
    let (st, view) = deref(http, e, fx, ws_event, 0).await;
    assert_eq!(
        (st, view["available"].clone()),
        (reqwest::StatusCode::OK, json!(true))
    );
    let (st, _) = bff(
        http,
        e,
        &fx.subject,
        Method::GET,
        "/api/v1/audit/events",
        None,
    )
    .await;
    assert_eq!(
        st,
        reqwest::StatusCode::FORBIDDEN,
        "Workspace auditor 不应读到整个 Tenant"
    );
    let (st, _) = deref(http, e, fx, crafted, 0).await;
    assert_eq!(
        st,
        reqwest::StatusCode::FORBIDDEN,
        "Tenant 级事件须 Tenant audit"
    );
    common::zed_relationship(e, "delete", &workspace, "auditor", &me);
}

#[tokio::test]
async fn scope_audit_and_evidence_are_authorized_per_request() {
    let Some(e) = common::env() else { return };
    let http = reqwest::Client::new();
    let pool = PgPool::connect(&e.database_url).await.expect("连 Core 库");
    let token = common::worker_token(&http, &e).await;
    let fx = common::provision_live_workspace(&http, &e, &pool, &token)
        .await
        .expect("开通夹具 Workspace");
    let outcome = std::panic::AssertUnwindSafe(run(&http, &e, &pool, &fx))
        .catch_unwind()
        .await;
    common::teardown_live_workspace(&e, &pool, &fx).await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}
