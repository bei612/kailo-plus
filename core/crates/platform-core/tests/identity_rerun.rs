//! DD-84：搁浅的 HUMAN CLIENT 身份投影由原发起者重新准入后重跑。
//! 旧 Workflow 的输入故意冻结错版本，Worker/Temporal 给出真实 FAILED 终态；
//! 重跑本身必须从 BFF 的任务详情与 Governed Action 链发起。

mod common;

use common::{bff, submit, until, Env};
use futures_util::FutureExt;
use nostr::Keys;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

fn temporal_start(e: &Env, workflow_id: &str, pubkey: &str, wrong_version: i32) {
    let env = |name: &str| std::env::var(name).unwrap_or_else(|_| panic!("缺少 {name}"));
    let input = json!({
        "kind": "BUZZ_IDENTITY_PROJECTION",
        "identity": { "pubkey": pubkey, "bindingVersion": wrong_version },
    })
    .to_string();
    let out = std::process::Command::new("sudo")
        .args([
            "-n",
            "docker",
            "run",
            "--rm",
            "--network",
            &e.docker_network,
            &env("VERIFY_TEMPORAL_ADMIN_IMAGE"),
            "temporal",
            "workflow",
            "start",
            "--address",
            &env("VERIFY_TEMPORAL_INTERNAL_ADDRESS"),
            "--namespace",
            &env("TEMPORAL_NAMESPACE"),
            "--task-queue",
            &env("TEMPORAL_TASK_QUEUE"),
            "--type",
            "ComponentTaskWorkflow",
            "--workflow-id",
            workflow_id,
            "--input",
            &input,
        ])
        .output()
        .expect("运行 Temporal CLI");
    assert!(
        out.status.success(),
        "旧 Workflow 启动失败：{}",
        String::from_utf8_lossy(&out.stderr)
    );
}

#[tokio::test]
async fn failed_identity_projection_reruns_with_original_owner_and_new_version() {
    exercise("identity.client_key.register", "RECONCILING", "ACTIVE").await;
}

#[tokio::test]
async fn failed_identity_revocation_reruns_with_original_owner_and_new_version() {
    exercise("identity.client_key.revoke", "REVOKING", "REVOKED").await;
}

async fn exercise(source_action: &str, converging: &str, terminal: &str) {
    let Some(e) = common::env() else { return };
    let http = reqwest::Client::new();
    let pool = PgPool::connect(&e.database_url).await.expect("连 Core 库");
    let token = common::worker_token(&http, &e).await;
    let fx = common::provision_live_workspace(&http, &e, &pool, &token)
        .await
        .expect("开通真实 Workspace");
    let outcome = std::panic::AssertUnwindSafe(run(
        &http,
        &e,
        &pool,
        &fx,
        source_action,
        converging,
        terminal,
    ))
    .catch_unwind()
    .await;
    common::teardown_live_workspace(&e, &pool, &fx).await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

async fn run(
    http: &reqwest::Client,
    e: &Env,
    pool: &PgPool,
    fx: &common::LiveWorkspace,
    source_action: &str,
    converging: &str,
    terminal: &str,
) {
    let pubkey = Keys::generate().public_key().to_hex();
    let original = Uuid::new_v4();
    let operation = Uuid::new_v4();
    let old_workflow = format!("platform:BUZZ_IDENTITY_PROJECTION:{}:{pubkey}:1", fx.tenant);
    let mut tx = pool.begin().await.expect("开始夹具事务");
    sqlx::query(
        "insert into identity.buzz_identity_binding
             (tenant_id, principal_id, pubkey, custody, kind, state)
         values ($1, $2, $3, 'CLIENT', 'HUMAN', $4)",
    )
    .bind(fx.tenant)
    .bind(fx.principal)
    .bind(&pubkey)
    .bind(converging)
    .execute(&mut *tx)
    .await
    .expect("建待投入的 CLIENT binding");
    sqlx::query(
        "insert into admission.action_execution
             (id, operation_id, tenant_id, action_key, action_version,
              initiator_principal_id, actor_principal_id, target_id, parameter_hash,
              temporal_workflow_id, gate_state, dispatch_state, correlation_id)
         values ($1, $2, $3, $7, 1,
                 $4, $4, $4, $5, $6, 'ALLOWED', 'DISPATCHED', $2)",
    )
    .bind(original)
    .bind(operation)
    .bind(fx.tenant)
    .bind(fx.principal)
    .bind(&pubkey)
    .bind(&old_workflow)
    .bind(source_action)
    .execute(&mut *tx)
    .await
    .expect("建原身份动作");
    sqlx::query(
        "insert into projection.workflow_ref
             (workflow_id, workflow_type, workflow_version, kind, tenant_id,
              operation_id, action_execution_id, projection_state)
         values ($1, 'ComponentTaskWorkflow', 1, 'BUZZ_IDENTITY_PROJECTION',
                 $2, $3, $4, 'PENDING_START')",
    )
    .bind(&old_workflow)
    .bind(fx.tenant)
    .bind(operation)
    .bind(original)
    .execute(&mut *tx)
    .await
    .expect("预写原 WorkflowRef");
    tx.commit().await.expect("提交原动作事实");

    temporal_start(e, &old_workflow, &pubkey, 2);
    until(e, "旧身份 Workflow 以真实 FAILED 终结", || async {
        let row: Option<(String, String)> = sqlx::query_as(
            "select w.projection_state, t.status from projection.workflow_ref w
             join projection.task_projection t on t.workflow_id = w.workflow_id
             where w.workflow_id = $1",
        )
        .bind(&old_workflow)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();
        matches!(row, Some((ref_state, status)) if ref_state == "TERMINAL" && status == "FAILED")
            .then_some(())
    })
    .await;

    let key: String = until(e, "本人取得身份投影重跑控制", || async {
        let (status, task) = bff(
            http,
            e,
            &fx.subject,
            reqwest::Method::GET,
            &format!("/api/v1/tasks/{original}"),
            None,
        )
        .await;
        status
            .is_success()
            .then(|| task["rerunActionKey"].as_str().map(str::to_owned))
            .flatten()
    })
    .await;
    assert_eq!(key, format!("task.rerun.{source_action}.v1"));
    let wrong_key = if source_action == "identity.client_key.register" {
        "task.rerun.identity.client_key.revoke.v1"
    } else {
        "task.rerun.identity.client_key.register.v1"
    };
    let (wrong_status, wrong) = submit(
        http,
        e,
        &fx.subject,
        json!({
            "actionKey": wrong_key,
            "idempotencyKey": Uuid::new_v4(),
            "originalActionExecutionId": original,
        }),
    )
    .await;
    assert_eq!(wrong_status, reqwest::StatusCode::FORBIDDEN, "{wrong}");
    let version: i32 =
        sqlx::query_scalar("select version from identity.buzz_identity_binding where pubkey = $1")
            .bind(&pubkey)
            .fetch_one(pool)
            .await
            .expect("旧 binding 版本");
    assert_eq!(version, 1, "错误控制键不得推进 binding");

    let (status, rerun) = submit(
        http,
        e,
        &fx.subject,
        json!({
            "actionKey": key,
            "idempotencyKey": Uuid::new_v4(),
            "originalActionExecutionId": original,
        }),
    )
    .await;
    assert!(status.is_success(), "重跑准入失败：{status} {rerun}");
    let rerun_id = Uuid::parse_str(rerun["actionExecutionId"].as_str().expect("重跑动作 ID"))
        .expect("重跑动作 UUID");
    let new_workflow = format!("platform:BUZZ_IDENTITY_PROJECTION:{}:{pubkey}:2", fx.tenant);
    until(e, "新身份 Workflow 完成", || async {
        let row: Option<(String, String, i32)> = sqlx::query_as(
            "select t.status, b.state, b.version
             from projection.task_projection t
             join identity.buzz_identity_binding b on b.pubkey = $2
             where t.workflow_id = $1",
        )
        .bind(&new_workflow)
        .bind(&pubkey)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();
        matches!(row, Some((status, state, version))
            if status == "COMPLETED" && state == terminal && version == 3)
        .then_some(())
    })
    .await;
    let linked: Option<String> = sqlx::query_scalar(
        "select temporal_workflow_id from admission.action_execution where id = $1",
    )
    .bind(rerun_id)
    .fetch_one(pool)
    .await
    .expect("重跑动作引用");
    assert_eq!(linked.as_deref(), Some(new_workflow.as_str()));
    let rechecks: i64 = sqlx::query_scalar(
        "select count(*) from admission.action_decision
         where action_execution_id = $1 and phase = 'RECHECK'
           and authorization_decision = 'ALLOW'",
    )
    .bind(rerun_id)
    .fetch_one(pool)
    .await
    .expect("读取 fresh Check 决定");
    assert!(rechecks > 0, "重跑派发前没有重新授权");
}
