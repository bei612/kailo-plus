//! RB-03 的演练工具：Relay 在撤权进行中不可达，撤权不得失败，恢复后必须闭合。
//!
//! 它会停启共享的 Relay，因此不随 `run-integration.sh` 运行，只在演练时显式
//! 执行（`docs/runbooks/RB-03-revocation-convergence.md`）：
//!
//! ```sh
//! cargo test -p kailo-core --test drill_revocation_outage -- --ignored --nocapture
//! ```
//!
//! 演练前把 Worker 的一轮缩短（`WORKER_ACTIVITY_SCHEDULE_TO_CLOSE_SECONDS`、
//! `WORKER_ACTIVITY_MAX_ATTEMPTS`、`WORKER_CONVERGE_ROUND_INTERVAL_SECONDS`），
//! 否则要等满生产取值的一轮才看得到等待状态。

mod common;

use common::Env;
use futures_util::FutureExt;
use sqlx::PgPool;
use uuid::Uuid;

fn relay(action: &str) {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../deploy/local");
    let out = std::process::Command::new("sudo")
        .current_dir(dir)
        .args([
            "-n",
            "docker",
            "compose",
            "--env-file",
            ".env",
            "-f",
            "compose.yaml",
            action,
            "buzz-relay",
        ])
        .output()
        .expect("运行 docker compose");
    assert!(
        out.status.success(),
        "docker compose {action} buzz-relay 失败：{}",
        String::from_utf8_lossy(&out.stderr)
    );
}

/// Relay 起来之后要等它能服务：start 返回只说明容器在跑，紧跟着的归档或
/// roster 投影会撞上尚未监听的端口。
async fn relay_ready(e: &Env) {
    let http = reqwest::Client::new();
    let url = format!("{}/_readiness", e.relay_origin.trim_end_matches('/'));
    let start = std::time::Instant::now();
    loop {
        if let Ok(r) = http.get(&url).send().await {
            if r.status().is_success() {
                return;
            }
        }
        assert!(
            start.elapsed() < std::time::Duration::from_secs(e.converge_bound_secs),
            "Relay 在 {}s 内没有就绪",
            e.converge_bound_secs
        );
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
}

fn secs(name: &str) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or_else(|| panic!("缺少 {name}"))
}

async fn wait<F, Fut>(what: &str, bound: std::time::Duration, mut probe: F)
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = bool>,
{
    let start = std::time::Instant::now();
    while !probe().await {
        assert!(start.elapsed() < bound, "等待「{what}」超出 {bound:?}");
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }
    println!("  {what}：{:?}", start.elapsed());
}

#[tokio::test]
#[ignore = "演练工具：会停启共享的 Relay，只在 RB-03 演练时显式运行"]
async fn revocation_waits_through_relay_outage_and_closes_after() {
    let Some(e) = common::env() else { return };
    let pool = PgPool::connect(&e.database_url).await.expect("连 Core 库");
    let http = reqwest::Client::new();
    let token = common::worker_token(&http, &e).await;
    let fx = common::provision_live_workspace(&http, &e, &pool, &token)
        .await
        .expect("建立演练用 Workspace");

    let outcome = std::panic::AssertUnwindSafe(run(&http, &e, &pool, &token, &fx))
        .catch_unwind()
        .await;
    // Relay 无论如何都要回来：演练不能把共享拓扑留在半瘫状态
    relay("start");
    relay_ready(&e).await;
    common::teardown_live_workspace(&e, &pool, &fx).await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

async fn run(
    http: &reqwest::Client,
    e: &Env,
    pool: &PgPool,
    token: &str,
    fx: &common::LiveWorkspace,
) {
    let round = secs("WORKER_ACTIVITY_SCHEDULE_TO_CLOSE_SECONDS")
        + secs("WORKER_CONVERGE_ROUND_INTERVAL_SECONDS");

    println!("== 停 Relay");
    relay("stop");

    println!("== Core 置 REVOKING 并启动撤权");
    sqlx::query(
        "update identity.workspace_membership set state = 'REVOKING', version = version + 1
         where id = $1 and state = 'ACTIVE'",
    )
    .bind(fx.workspace_membership)
    .execute(pool)
    .await
    .expect("置 REVOKING");
    let action = Uuid::new_v4();
    sqlx::query(
        "insert into admission.action_execution
             (id, operation_id, tenant_id, action_key, action_version,
              initiator_principal_id, actor_principal_id, target_id, parameter_hash,
              gate_state, dispatch_state, correlation_id)
         values ($1, $2, $3, 'drill.revoke', 1, $4, $4, $5, 'drill',
                 'ALLOWED', 'NOT_DISPATCHED', $6)",
    )
    .bind(action)
    .bind(Uuid::new_v4())
    .bind(fx.tenant)
    .bind(fx.initiator)
    .bind(fx.workspace_membership)
    .bind(Uuid::new_v4())
    .execute(pool)
    .await
    .expect("建 ActionExecution");
    let status = http
        .post(format!(
            "{}/service/v1/memberships/lifecycle",
            e.service_url
        ))
        .bearer_auth(token)
        .json(&serde_json::json!({
            "scope": "WORKSPACE",
            "membershipId": fx.workspace_membership,
            "actionExecutionId": action,
        }))
        .send()
        .await
        .expect("调用 lifecycle endpoint")
        .status();
    assert_eq!(status, reqwest::StatusCode::OK, "启动撤权 Workflow");

    let workflow: String = sqlx::query_scalar(
        "select workflow_id from projection.workflow_ref where action_execution_id = $1",
    )
    .bind(action)
    .fetch_one(pool)
    .await
    .expect("WorkflowRef");
    println!("  workflow {workflow}");

    println!("== Relay 不可达：一轮耗尽后 Workflow 等待而不失败");
    let bound = std::time::Duration::from_secs(round * 2 + 30);
    wait("工作台显示 CONVERGENCE_PENDING", bound, || async {
        sqlx::query_scalar::<_, Option<String>>(
            "select waiting_reason from projection.task_projection where workflow_id = $1",
        )
        .bind(&workflow)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .flatten()
        .as_deref()
            == Some("CONVERGENCE_PENDING")
    })
    .await;
    let (state, status): (String, String) = sqlx::query_as(
        "select m.state, t.status from identity.workspace_membership m, projection.task_projection t
         where m.id = $1 and t.workflow_id = $2",
    )
    .bind(fx.workspace_membership)
    .bind(&workflow)
    .fetch_one(pool)
    .await
    .expect("读状态");
    assert_eq!(
        state, "REVOKING",
        "Relay 不可达期间成员停在 REVOKING（fail closed）"
    );
    assert_eq!(status, "RUNNING", "Workflow 没有因一轮耗尽而失败");

    println!("== 恢复 Relay：撤权闭合");
    relay("start");
    relay_ready(e).await;
    let bound = std::time::Duration::from_secs(round + e.converge_bound_secs);
    wait("成员 REVOKED", bound, || async {
        sqlx::query_scalar::<_, String>(
            "select state from identity.workspace_membership where id = $1",
        )
        .bind(fx.workspace_membership)
        .fetch_one(pool)
        .await
        .map(|s| s == "REVOKED")
        .unwrap_or(false)
    })
    .await;
    let (status, projection): (String, String) = sqlx::query_as(
        "select t.status, w.projection_state from projection.task_projection t
         join projection.workflow_ref w using (workflow_id) where t.workflow_id = $1",
    )
    .bind(&workflow)
    .fetch_one(pool)
    .await
    .expect("读终态");
    assert_eq!(status, "COMPLETED");
    assert_eq!(projection, "TERMINAL");
}
