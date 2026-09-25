//! WorkflowRef 兜底对账的端到端核验（`.design/06` §3.1、`DD-48`）。
//!
//! 对运行中的 Core、Temporal 与 Worker 构造四种真实情形，只从 Core 库取证：
//!
//! 1. Workflow 已在 Temporal 终结，而它自己的终态投影从未到达——即使此前
//!    跨 run 累加的 event_id 高于最新 run 的 history 长度，对账仍补写终态、
//!    标 `observation_gap`，WorkflowRef 进入 TERMINAL；
//! 2. NotFound 且已超出 retention——只能是 UNKNOWN，不能解释为「未启动」；
//! 3. NotFound 而仍在 retention 窗口内——只记观察，不改状态；
//! 4. 同一版本的 Workflow 已终结时再启动——409，而不是「已启动」的 200。
//!
//! 情形 1 的「漏写」是真实发生的：以 Worker 不认识的 kind 启动，Workflow 在写
//! 任何投影之前就以不可重试错误终结。

mod common;

use common::Env;
use futures_util::FutureExt;
use sqlx::PgPool;
use uuid::Uuid;

fn var(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| panic!("缺少 {name}"))
}

fn secs(name: &str) -> u64 {
    var(name)
        .parse()
        .unwrap_or_else(|_| panic!("{name} 必须是秒数"))
}

/// 用官方 temporal CLI 经内部 frontend 启动一个 execution。不复用 Core 的客户端：
/// 那会让被核验的一方替自己的前置条件背书。
fn temporal_start(e: &Env, workflow_id: &str, kind: &str) {
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
            "start",
            "--address",
            &var("VERIFY_TEMPORAL_INTERNAL_ADDRESS"),
            "--namespace",
            &var("TEMPORAL_NAMESPACE"),
            "--task-queue",
            &var("TEMPORAL_TASK_QUEUE"),
            "--type",
            "ComponentTaskWorkflow",
            "--workflow-id",
            workflow_id,
            "--input",
            &serde_json::json!({ "kind": kind }).to_string(),
        ])
        .output()
        .expect("运行 temporal CLI");
    // 探针失败必须当场暴露，不能静默地让后面的断言去等一个从未发生的事
    assert!(
        out.status.success(),
        "temporal workflow start 失败：{}",
        String::from_utf8_lossy(&out.stderr)
    );
}

async fn seed_action(pool: &PgPool, f: &common::Fixture) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query(
        "insert into admission.action_execution
             (id, operation_id, tenant_id, action_key, action_version,
              initiator_principal_id, actor_principal_id, target_id, parameter_hash,
              gate_state, dispatch_state, correlation_id)
         values ($1, $2, $3, 'verify.reconcile', 1, $4, $4, $5, 'verify',
                 'ALLOWED', 'NOT_DISPATCHED', $6)",
    )
    .bind(id)
    .bind(Uuid::new_v4())
    .bind(f.tenant)
    .bind(f.control_principal)
    .bind(f.membership)
    .bind(Uuid::new_v4())
    .execute(pool)
    .await
    .expect("建 ActionExecution");
    id
}

/// 预写一条 WorkflowRef，`age` 是它相对现在的年龄。
async fn seed_ref(
    pool: &PgPool,
    f: &common::Fixture,
    workflow_id: &str,
    state: &str,
    age: std::time::Duration,
) {
    let action = seed_action(pool, f).await;
    sqlx::query(
        "insert into projection.workflow_ref
             (workflow_id, workflow_type, workflow_version, kind, tenant_id,
              operation_id, action_execution_id, projection_state, created_at)
         select $1, 'ComponentTaskWorkflow', 1, 'MEMBERSHIP_PROJECTION', $2,
                ae.operation_id, ae.id, $3, now() - make_interval(secs => $4)
         from admission.action_execution ae where ae.id = $5",
    )
    .bind(workflow_id)
    .bind(f.tenant)
    .bind(state)
    .bind(age.as_secs_f64())
    .bind(action)
    .execute(pool)
    .await
    .expect("建 WorkflowRef");
}

#[tokio::test]
async fn reconciler_patches_missed_terminal_writes_and_never_guesses() {
    let Some(e) = common::env() else { return };
    let pool = PgPool::connect(&e.database_url).await.expect("连 Core 库");
    let host = format!("rc{}.invalid", &Uuid::new_v4().simple().to_string()[..12]);
    let f = common::seed_tenant_fixture(
        &pool,
        &host,
        &"0".repeat(64),
        &"1".repeat(64),
        "verify/none/none",
        1,
        &e.core_identity,
    )
    .await;

    let outcome = std::panic::AssertUnwindSafe(run(&e, &pool, &f))
        .catch_unwind()
        .await;
    common::cleanup(&e, &pool, &f).await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

async fn run(e: &Env, pool: &PgPool, f: &common::Fixture) {
    let interval = secs("WORKFLOW_RECONCILE_INTERVAL_SECONDS");
    let freshness = std::time::Duration::from_secs(secs("WORKFLOW_PROJECTION_FRESHNESS_SECONDS"));
    // 已经超过新鲜度上界：对账下一轮就会看它
    let stale = freshness + std::time::Duration::from_secs(5);
    let tag = Uuid::new_v4().simple().to_string();

    // 1. 漏写的终态。已有较大的 event_id 模拟 continue-as-new 前多个 run
    // 的累计长度；Describe 的最新 run history 长度不能直接覆盖它。
    let missed = format!("kailo:verify:{}:missed-{tag}:1", f.tenant);
    seed_ref(pool, f, &missed, "RUNNING", stale).await;
    let previous_event_id = 1_000_000_i64;
    sqlx::query(
        "insert into projection.task_projection
             (workflow_id, run_id, last_event_id, status)
         values ($1, $2, $3, 'RUNNING')",
    )
    .bind(&missed)
    .bind("previous-run")
    .bind(previous_event_id)
    .execute(pool)
    .await
    .expect("建此前的运行中投影");
    temporal_start(e, &missed, "NOT_A_REGISTERED_KIND");

    // 2. 超出 retention 的 NotFound。十年一定在任何 retention 之外
    let expired = format!("kailo:verify:{}:expired-{tag}:1", f.tenant);
    seed_ref(
        pool,
        f,
        &expired,
        "PENDING_START",
        std::time::Duration::from_secs(10 * 365 * 24 * 3600),
    )
    .await;

    // 3. retention 窗口内的 NotFound
    let unseen = format!("kailo:verify:{}:unseen-{tag}:1", f.tenant);
    seed_ref(pool, f, &unseen, "PENDING_START", stale).await;

    // 等到三条都被观察过。对账每轮按「最久未观察」取一批，三轮内必然轮到
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(interval * 3 + 10);
    loop {
        let observed: i64 = sqlx::query_scalar(
            "select count(*) from projection.workflow_ref
             where workflow_id = any($1) and last_observed_at is not null",
        )
        .bind(vec![missed.clone(), expired.clone(), unseen.clone()])
        .fetch_one(pool)
        .await
        .expect("读 WorkflowRef");
        let missed_done: Option<String> = sqlx::query_scalar(
            "select projection_state from projection.workflow_ref where workflow_id = $1",
        )
        .bind(&missed)
        .fetch_one(pool)
        .await
        .expect("读 WorkflowRef");
        if observed == 3 && missed_done.as_deref() == Some("TERMINAL") {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "对账在三轮内没有观察完三条 WorkflowRef（已观察 {observed}，漏写那条为 {missed_done:?}）"
        );
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }

    let (status, gap, event_id): (String, bool, i64) = sqlx::query_as(
        "select status, observation_gap, last_event_id
         from projection.task_projection where workflow_id = $1",
    )
    .bind(&missed)
    .fetch_one(pool)
    .await
    .expect("漏写的终态应已被补写");
    assert_eq!(status, "FAILED", "补写的是 Temporal 观察到的终态");
    assert!(
        gap,
        "补写必须标 observation_gap：工作台据此显示 PROJECTION_DELAYED"
    );
    assert!(
        event_id > previous_event_id,
        "兜底补写的 event_id 必须高于跨 run 累加的旧值"
    );

    let state: String = sqlx::query_scalar(
        "select projection_state from projection.workflow_ref where workflow_id = $1",
    )
    .bind(&expired)
    .fetch_one(pool)
    .await
    .expect("读 WorkflowRef");
    assert_eq!(
        state, "UNKNOWN",
        "超出 retention 的 NotFound 不能解释为未启动"
    );

    let state: String = sqlx::query_scalar(
        "select projection_state from projection.workflow_ref where workflow_id = $1",
    )
    .bind(&unseen)
    .fetch_one(pool)
    .await
    .expect("读 WorkflowRef");
    assert_eq!(
        state, "PENDING_START",
        "窗口内的 NotFound 无法判定，不改状态"
    );

    // 4. 同一版本已终结：再启动是冲突，不是「已启动」
    let version: i32 =
        sqlx::query_scalar("select version from identity.tenant_membership where id = $1")
            .bind(f.membership)
            .fetch_one(pool)
            .await
            .expect("读成员版本");
    let finished = format!(
        "kailo:MEMBERSHIP_PROJECTION:{}:{}:{version}",
        f.tenant, f.membership
    );
    seed_ref(pool, f, &finished, "TERMINAL", std::time::Duration::ZERO).await;
    let http = reqwest::Client::new();
    let token = common::worker_token(&http, e).await;
    let action = seed_action(pool, f).await;
    let status = http
        .post(format!(
            "{}/service/v1/memberships/lifecycle",
            e.service_url
        ))
        .bearer_auth(&token)
        .json(&serde_json::json!({
            "scope": "TENANT",
            "membershipId": f.membership,
            "actionExecutionId": action,
        }))
        .send()
        .await
        .expect("调用 lifecycle endpoint")
        .status();
    assert_eq!(
        status,
        reqwest::StatusCode::CONFLICT,
        "同一版本的 Workflow 已终结，再启动不能报成功"
    );
}
