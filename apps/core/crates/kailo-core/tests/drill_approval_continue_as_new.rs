//! ApprovalWorkflow continue-as-new 的真实 Server 演练（.design/06 §3）。
//!
//! 由 `core/verify/drill-approval-can.sh` 调用：它先把本 namespace 的续跑建议阈值临时
//! 压到几十个事件，这里再走一条真实审批（部署引导出的 Tenant，A 撤 C、B 批准）。断言
//! 全部取自权威处：审批状态与决定查 Core 的 ApprovalProjection（只由 history 写回），
//! run 的数目问 Temporal。
//!
//! 默认跳过：它依赖脚本改过的动态配置，单独跑只会得到一条不续跑的普通审批。

use std::process::Command;

use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

mod common;
use common::bootstrapped::{add_member, bootstrap, teardown};
use common::{approval_status, bff, state_of, submit, until};

/// 该 workflow ID 在 Temporal 上的全部 run：（run ID，状态）。
fn runs(workflow_id: &str) -> Vec<(String, String)> {
    let v = |k: &str| std::env::var(k).unwrap_or_else(|_| panic!("缺少 {k}"));
    let out = Command::new("sudo")
        .args([
            "-n",
            "docker",
            "run",
            "--rm",
            "--network",
            &v("VERIFY_DOCKER_NETWORK"),
            &v("VERIFY_TEMPORAL_ADMIN_IMAGE"),
            "temporal",
            "workflow",
            "list",
            "--address",
            &v("VERIFY_TEMPORAL_INTERNAL_ADDRESS"),
            "--namespace",
            &v("TEMPORAL_NAMESPACE"),
            "--query",
            &format!("WorkflowId = '{workflow_id}'"),
            "--output",
            "json",
        ])
        .output()
        .expect("运行 temporal CLI");
    assert!(
        out.status.success(),
        "temporal workflow list 失败：{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let text = String::from_utf8_lossy(&out.stdout);
    // CLI 以逐行 JSON 或 JSON 数组输出，两种都接受
    let items: Vec<Value> = serde_json::from_str::<Vec<Value>>(&text).unwrap_or_else(|_| {
        text.lines()
            .filter_map(|l| serde_json::from_str(l).ok())
            .collect()
    });
    items
        .iter()
        .map(|i| {
            (
                i["execution"]["runId"]
                    .as_str()
                    .unwrap_or_default()
                    .to_owned(),
                i["status"].as_str().unwrap_or_default().to_owned(),
            )
        })
        .collect()
}

/// 把该 workflow ID 每一个 run 的 history 导出到演练目录，供 replay 回归。
fn export(workflow_id: &str, dir: &str, name: &str) {
    let v = |k: &str| std::env::var(k).unwrap_or_else(|_| panic!("缺少 {k}"));
    for (i, (run, _)) in runs(workflow_id).iter().enumerate() {
        let out = Command::new("sudo")
            .args([
                "-n",
                "docker",
                "run",
                "--rm",
                "--network",
                &v("VERIFY_DOCKER_NETWORK"),
                &v("VERIFY_TEMPORAL_ADMIN_IMAGE"),
                "temporal",
                "workflow",
                "show",
                "--address",
                &v("VERIFY_TEMPORAL_INTERNAL_ADDRESS"),
                "--namespace",
                &v("TEMPORAL_NAMESPACE"),
                "--workflow-id",
                workflow_id,
                "--run-id",
                run,
                "--output",
                "json",
            ])
            .output()
            .expect("运行 temporal CLI");
        assert!(out.status.success(), "导出 history 失败");
        std::fs::write(format!("{dir}/{name}_run{i}_{run}.json"), &out.stdout).expect("写 history");
    }
}

#[tokio::test]
#[ignore = "由 core/verify/drill-approval-can.sh 在压低续跑阈值后调用"]
async fn approval_continues_as_new_without_losing_decisions() {
    let Some(e) = common::env() else { return };
    let dir = std::env::var("VERIFY_DRILL_HISTORY_DIR").expect("VERIFY_DRILL_HISTORY_DIR");
    let http = reqwest::Client::new();
    let pool = PgPool::connect(&e.database_url).await.expect("连 Core 库");
    let token = common::worker_token(&http, &e).await;
    let slug = format!("c{}", &Uuid::new_v4().to_string()[..8]);
    let a = format!("can-a-{}", &Uuid::new_v4().to_string()[..8]);
    let (code, out) = bootstrap(&slug, &a, e.converge_bound_secs * 2);
    assert_eq!(code, 0, "引导应完成：{out}");
    let tenant = Uuid::parse_str(out["tenantId"].as_str().unwrap()).unwrap();
    let a_principal = Uuid::parse_str(out["adminPrincipalId"].as_str().unwrap()).unwrap();
    let a_human: Uuid = sqlx::query_scalar(
        "select human_identity_id from identity.tenant_membership where tenant_principal_id = $1",
    )
    .bind(a_principal)
    .fetch_one(&pool)
    .await
    .unwrap();
    let initiator: Uuid = sqlx::query_scalar(
        "select principal_id from identity.service_principal where audience = 'kailo-deployment-bootstrap'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let mut humans = vec![a_human];
    let mut members = vec![];
    for _ in 0..2 {
        let m = add_member(&http, &e, &pool, &token, tenant, initiator).await;
        match m {
            Ok(m) => {
                humans.push(m.human);
                members.push(m);
            }
            Err(err) => {
                teardown(&e, &pool, tenant, &humans).await;
                panic!("开通成员失败：{err}");
            }
        }
    }
    let run = std::panic::AssertUnwindSafe(async {
        let (b, c) = (&members[0], &members[1]);
        let (st, body) = submit(
            &http,
            &e,
            &a,
            json!({"actionKey":"tenant.admin.grant","idempotencyKey":Uuid::new_v4(),"principalId":b.principal}),
        )
        .await;
        assert_eq!(st, reqwest::StatusCode::OK, "{body}");

        let (st, body) = submit(
            &http,
            &e,
            &a,
            json!({"actionKey":"tenant.member.revoke","idempotencyKey":Uuid::new_v4(),"principalId":c.principal}),
        )
        .await;
        assert_eq!(st, reqwest::StatusCode::ACCEPTED, "{body}");
        let wf = body["approvalWorkflowId"].as_str().unwrap().to_owned();
        println!("审批 workflow：{wf}");
        until(&e, "审批 WAITING", || async {
            (approval_status(&pool, &wf).await.as_deref() == Some("WAITING")).then_some(())
        })
        .await;

        // 续跑后的 run 已把状态写回：投影的 run 不再是 WorkflowRef 记下的第一次
        // （event_id 跨 run 单调，续跑后的写回才会被 Core 采纳）
        until(&e, "续跑后的 run 写回投影", || async {
            let (first, now): (Option<String>, String) = sqlx::query_as(
                "select w.run_id, p.run_id from projection.workflow_ref w
                 join projection.approval_projection p using (workflow_id) where w.workflow_id = $1",
            )
            .bind(&wf)
            .fetch_one(&pool)
            .await
            .ok()?;
            (first.as_deref() != Some(now.as_str())).then_some(())
        })
        .await;
        assert_eq!(
            approval_status(&pool, &wf).await.as_deref(),
            Some("WAITING")
        );

        let (st, body) = bff(
            &http,
            &e,
            &b.subject,
            reqwest::Method::POST,
            &format!("/api/v1/approvals/{wf}/decision"),
            Some(json!({"decision":"APPROVE"})),
        )
        .await;
        assert_eq!(st, reqwest::StatusCode::OK, "{body}");
        until(&e, "批准被消费", || async {
            (approval_status(&pool, &wf).await.as_deref() == Some("CONSUMED")).then_some(())
        })
        .await;
        until(&e, "C 的 TenantMembership REVOKED", || async {
            (state_of(&pool, "identity.tenant_membership", c.membership).await == "REVOKED")
                .then_some(())
        })
        .await;
        let decisions: Value = sqlx::query_scalar(
            "select decisions from projection.approval_projection where workflow_id = $1",
        )
        .bind(&wf)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            decisions.as_array().map(Vec::len),
            Some(1),
            "终态投影应恰有 B 的一个决定：{decisions}"
        );
        assert_eq!(decisions[0]["approverPrincipalId"], b.principal.to_string());
        let all = until(&e, "最后一个 run 终结", || async {
            let r = runs(&wf);
            r.iter()
                .all(|(_, s)| s != "WORKFLOW_EXECUTION_STATUS_RUNNING" && s != "Running")
                .then_some(r)
        })
        .await;
        println!("runs：{all:?}");
        assert!(all.len() >= 2, "阈值压低后审批应至少续跑一次：{all:?}");
        export(&wf, &dir, "approval_can");
    });
    let result = futures_util::FutureExt::catch_unwind(run).await;
    teardown(&e, &pool, tenant, &humans).await;
    if let Err(p) = result {
        std::panic::resume_unwind(p);
    }
}
