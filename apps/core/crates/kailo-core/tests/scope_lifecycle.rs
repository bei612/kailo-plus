//! `TENANT_LIFECYCLE` 与 `WORKSPACE_LIFECYCLE` 的端到端核验。
//!
//! 它验的是 `apps/02` Stage 1 实施内容里「实现 Tenant/Workspace、
//! BuzzIdentityBinding 与 RelayOperatorIdentity」那几项真的跑得通：一个只有
//! `PROVISIONING` 记录的 Tenant，经 Workflow 变成有 Community、有 CONTROL 身份、
//! 有已查证 NIP-11 快照的 `ACTIVE` Tenant；Workspace 同理拿到 Channel 与 SpiceDB
//! 归属关系。
//!
//! 在此之前，成员链的核验是靠手工 seed 这些事实的。手工 seed 能证明成员链对，
//! 但证明不了这些事实本身产得出来。

use futures_util::FutureExt;
use sqlx::PgPool;
use std::process::Command;
use uuid::Uuid;

mod common;
use common::Env;

fn spicedb_has(env: &Env, object: &str, relation: &str, subject: &str) -> bool {
    let out = Command::new("sudo")
        .args([
            "-n",
            "docker",
            "run",
            "--rm",
            "--network",
            &env.docker_network,
            "--env-file",
            &env.zed_env_file,
            "-e",
            &format!("ZED_ENDPOINT={}", env.spicedb_in_network),
            "-e",
            "ZED_INSECURE=true",
            &env.zed_image,
            "relationship",
            "read",
            // 默认按数据库偏好的 zedtoken 求值，会读到写入之前的 revision
            "--consistency-full",
            object.split(':').next().unwrap(),
        ])
        .output()
        .expect("运行 zed");
    assert!(
        out.status.success(),
        "zed 读取失败：{}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .any(|l| l.contains(object) && l.contains(relation) && l.contains(subject))
}

fn spicedb_delete(env: &Env, object: &str, relation: &str, subject: &str) {
    let _ = Command::new("sudo")
        .args([
            "-n",
            "docker",
            "run",
            "--rm",
            "--network",
            &env.docker_network,
            "--env-file",
            &env.zed_env_file,
            "-e",
            &format!("ZED_ENDPOINT={}", env.spicedb_in_network),
            "-e",
            "ZED_INSECURE=true",
            &env.zed_image,
            "relationship",
            "delete",
            object,
            relation,
            subject,
        ])
        .output();
}

async fn wait_state(pool: &PgPool, table: &str, id: Uuid, want: &str, bound: u64) -> String {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(bound);
    loop {
        let got =
            sqlx::query_scalar::<_, String>(&format!("select state from {table} where id = $1"))
                .bind(id)
                .fetch_one(pool)
                .await
                .expect("读状态");
        if got == want || std::time::Instant::now() > deadline {
            return got;
        }
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
    }
}

/// 建一条已准入的 ActionExecution，替代 Stage 2 才有的 Action 准入路径。
///
/// 发起方是 Catalog Tenant 的一个 SERVICE Principal：建 Tenant 是平台级动作，
/// 目标 Tenant 此刻还一个 Principal 都没有。
async fn seed_action(pool: &PgPool, tenant: Uuid, initiator: Uuid, target: Uuid) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query(
        "insert into admission.action_execution
             (id, operation_id, tenant_id, action_key, action_version,
              initiator_principal_id, actor_principal_id, target_id, parameter_hash,
              gate_state, dispatch_state, correlation_id)
         values ($1, $2, $3, 'scope.provision', 1, $4, $4, $5, 'verify',
                 'ALLOWED', 'NOT_DISPATCHED', $6)",
    )
    .bind(id)
    .bind(Uuid::new_v4())
    .bind(tenant)
    .bind(initiator)
    .bind(target)
    .bind(Uuid::new_v4())
    .execute(pool)
    .await
    .expect("建 ActionExecution");
    id
}

async fn start_scope(
    http: &reqwest::Client,
    e: &Env,
    token: &str,
    kind: &str,
    id: Uuid,
    action: Uuid,
) -> reqwest::StatusCode {
    http.post(format!("{}/service/v1/scopes/lifecycle", e.service_url))
        .bearer_auth(token)
        .json(&serde_json::json!({
            "kind": kind, "id": id, "actionExecutionId": action,
        }))
        .send()
        .await
        .expect("调用 scope lifecycle endpoint")
        .status()
}

/// 建发起方 Principal 与一个 `PROVISIONING` 的 Tenant。
///
/// 发起方挂在平台引导建好的 Catalog Tenant 下（Core 启动时做的）：建 Tenant
/// 是平台级动作，目标 Tenant 此刻还一个 Principal 都没有。
async fn seed_tenant(pool: &PgPool, e: &Env) -> (Uuid, Uuid) {
    let catalog: Uuid = sqlx::query_scalar("select id from identity.tenant where slug = $1")
        .bind(&e.catalog_tenant_slug)
        .fetch_one(pool)
        .await
        .expect("Catalog Tenant 应由平台引导建立");
    let initiator = Uuid::new_v4();
    sqlx::query(
        "insert into identity.principal (id, tenant_id, kind, status)
         values ($1, $2, 'SERVICE', 'ACTIVE')",
    )
    .bind(initiator)
    .bind(catalog)
    .execute(pool)
    .await
    .expect("建发起方 Principal");

    let tenant = Uuid::new_v4();
    let slug = format!("t{}", &tenant.to_string()[..8]);
    sqlx::query(
        "insert into identity.tenant (id, slug, name, state) values ($1, $2, $2, 'PROVISIONING')",
    )
    .bind(tenant)
    .bind(&slug)
    .execute(pool)
    .await
    .expect("建 Tenant");
    (tenant, initiator)
}

/// 清理跨三个系统，并在最后按原样抛出用例本身的 panic。
async fn teardown(
    e: &Env,
    pool: &PgPool,
    tenant: Uuid,
    initiator: Uuid,
    outcome: Result<(), Box<dyn std::any::Any + Send>>,
) {
    // Workspace 的 SpiceDB 归属关系要在删库之前取出来。
    let workspace: Option<Uuid> =
        sqlx::query_scalar("select id from identity.workspace where tenant_id = $1 limit 1")
            .bind(tenant)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();
    if let Some(ws) = workspace {
        spicedb_delete(
            e,
            &format!("workspace:{ws}"),
            "tenant",
            &format!("tenant:{tenant}"),
        );
    }
    let retired = common::retire_relay_community(e, pool, tenant).await;
    for sql in [
        "delete from projection.workspace_buzz_binding where workspace_id in
             (select id from identity.workspace where tenant_id = $1)",
        "delete from projection.task_projection where workflow_id in
             (select workflow_id from projection.workflow_ref where tenant_id = $1)",
        "delete from projection.workflow_ref where tenant_id = $1",
        "delete from admission.action_execution where tenant_id = $1",
        "delete from projection.tenant_buzz_binding where tenant_id = $1",
        "delete from identity.buzz_identity_binding where tenant_id = $1",
        "delete from identity.workspace where tenant_id = $1",
        "delete from identity.principal where tenant_id = $1",
        "delete from identity.tenant where id = $1",
    ] {
        if let Err(e) = sqlx::query(sql).bind(tenant).execute(pool).await {
            eprintln!("夹具清理失败：{sql}\n  {e}");
        }
    }
    if let Err(e) = sqlx::query("delete from identity.principal where id = $1")
        .bind(initiator)
        .execute(pool)
        .await
    {
        eprintln!("夹具清理失败（发起方 Principal）：{e}");
    }
    // 复核：清理被挡住时只在下一次跑别的用例才表现出来，那时已经难以归因
    let left: i64 = sqlx::query_scalar("select count(*) from identity.tenant where id = $1")
        .bind(tenant)
        .fetch_one(pool)
        .await
        .unwrap_or(-1);
    assert_eq!(left, 0, "夹具 Tenant {tenant} 没有被清掉");
    if let Err(err) = retired {
        panic!("{err}");
    }

    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn tenant_and_workspace_lifecycle_converge() {
    let Some(e) = common::env() else { return };
    let http = reqwest::Client::new();
    let pool = PgPool::connect(&e.database_url).await.expect("连 Core 库");
    let token = common::worker_token(&http, &e).await;
    let (tenant, initiator) = seed_tenant(&pool, &e).await;

    let outcome = std::panic::AssertUnwindSafe(run(&http, &e, &pool, &token, tenant, initiator))
        .catch_unwind()
        .await;
    teardown(&e, &pool, tenant, initiator, outcome).await;
}

async fn run(
    http: &reqwest::Client,
    e: &Env,
    pool: &PgPool,
    token: &str,
    tenant: Uuid,
    initiator: Uuid,
) {
    // ---- TENANT_LIFECYCLE ----
    let action = seed_action(pool, tenant, initiator, tenant).await;
    assert_eq!(
        start_scope(http, e, token, "TENANT", tenant, action).await,
        reqwest::StatusCode::OK,
        "启动 Tenant 建立 Workflow"
    );
    assert_eq!(
        wait_state(
            pool,
            "identity.tenant",
            tenant,
            "ACTIVE",
            e.converge_bound_secs
        )
        .await,
        "ACTIVE",
        "Tenant 应收敛到 ACTIVE"
    );

    // binding 的 ACTIVE 蕴含三条库级 CHECK，但 digest 与开关的取值要单独看：
    // 它们来自对 NIP-11 的实际观测，不是配置自述（SF-BUZ-35）。
    let binding = sqlx::query_as::<_, (String, Option<String>, bool, bool)>(
        "select normalized_host, nip11_snapshot_digest, require_relay_membership, allow_nip_oa_auth
         from projection.tenant_buzz_binding where tenant_id = $1 and state = 'ACTIVE'",
    )
    .bind(tenant)
    .fetch_one(pool)
    .await
    .expect("TenantBuzzBinding 应为 ACTIVE");
    assert_eq!(
        binding.1.as_deref().map(str::len),
        Some(64),
        "digest 应为 sha256 十六进制"
    );
    assert!(binding.2, "require_relay_membership 必须为观测到的 true");
    assert!(!binding.3, "allow_nip_oa_auth 必须为 false");

    // Community 真的建起来了：按该 host 抓 NIP-11 拿得到文档，且它广告 NIP-43
    let info: serde_json::Value = http
        .get(format!("{}/info", e.relay_origin))
        .header(reqwest::header::HOST, &binding.0)
        .send()
        .await
        .expect("抓 NIP-11")
        .json()
        .await
        .expect("解析 NIP-11");
    assert!(
        info["supported_nips"]
            .as_array()
            .is_some_and(|n| n.iter().any(|v| v.as_u64() == Some(43))),
        "该 Community 的 Relay 必须广告 NIP-43"
    );

    // CONTROL 身份：SERVER 托管、三列 SecretRef 俱全、已 ACTIVE
    let control = sqlx::query_as::<_, (String, String, Option<i32>, Option<String>)>(
        "select custody, state, private_key_secret_version, private_key_secret_audience
         from identity.buzz_identity_binding where tenant_id = $1 and kind = 'CONTROL'",
    )
    .bind(tenant)
    .fetch_one(pool)
    .await
    .expect("CONTROL binding 应存在");
    assert_eq!(control.0, "SERVER");
    assert_eq!(control.1, "ACTIVE");
    assert!(
        control.2.is_some() && control.3.is_some(),
        "SecretRef 三元组必须齐备"
    );

    // ---- WORKSPACE_LIFECYCLE ----
    let workspace = Uuid::new_v4();
    sqlx::query(
        "insert into identity.workspace (id, tenant_id, slug, name, state)
         values ($1, $2, $3, $3, 'PROVISIONING')",
    )
    .bind(workspace)
    .bind(tenant)
    .bind(format!("w{}", &workspace.to_string()[..8]))
    .execute(pool)
    .await
    .expect("建 Workspace");

    let action = seed_action(pool, tenant, initiator, workspace).await;
    assert_eq!(
        start_scope(http, e, token, "WORKSPACE", workspace, action).await,
        reqwest::StatusCode::OK,
        "启动 Workspace 建立 Workflow"
    );
    assert_eq!(
        wait_state(
            pool,
            "identity.workspace",
            workspace,
            "ACTIVE",
            e.converge_bound_secs
        )
        .await,
        "ACTIVE",
        "Workspace 应收敛到 ACTIVE"
    );

    let channel: Uuid = sqlx::query_scalar(
        "select channel_id from projection.workspace_buzz_binding
         where workspace_id = $1 and state = 'ACTIVE'",
    )
    .bind(workspace)
    .fetch_one(pool)
    .await
    .expect("WorkspaceBuzzBinding 应为 ACTIVE");
    assert!(!channel.is_nil(), "channel_id 必须是 Relay 分配的真实 UUID");

    // SpiceDB 里 workspace 经 tenant 关系归属其 Tenant——workspace 的
    // discover/create/manage/audit 都由 `tenant->...` 继承（.design/03 §5）
    assert!(
        spicedb_has(
            e,
            &format!("workspace:{workspace}"),
            "tenant",
            &format!("tenant:{tenant}")
        ),
        "ACTIVE 后 SpiceDB 必须有 workspace→tenant 归属关系"
    );
}

// ---- 搁浅实体的重跑（.design/06 §9 的 rerun、DD-48） ----

async fn rerun(
    http: &reqwest::Client,
    e: &Env,
    token: &str,
    workflow_id: &str,
    action: Uuid,
) -> (reqwest::StatusCode, serde_json::Value) {
    let resp = http
        .post(format!("{}/service/v1/tasks/rerun", e.service_url))
        .bearer_auth(token)
        .json(&serde_json::json!({
            "workflowId": workflow_id, "actionExecutionId": action,
        }))
        .send()
        .await
        .expect("调用 rerun endpoint");
    let status = resp.status();
    (status, resp.json().await.unwrap_or(serde_json::Value::Null))
}

async fn mark_rerun_action(pool: &PgPool, id: Uuid, original: Uuid) {
    sqlx::query(
        "update admission.action_execution
         set action_key = 'task.rerun', target_id = $2 where id = $1",
    )
    .bind(id)
    .bind(original)
    .execute(pool)
    .await
    .expect("重跑准入必须有重跑 action_key");
}

/// 等某条 Workflow 的投影进入终态，返回 (projection_state, task status)。
async fn wait_terminal(pool: &PgPool, workflow_id: &str, bound: u64) -> (String, Option<String>) {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(bound);
    loop {
        let row: (String, Option<String>) = sqlx::query_as(
            "select w.projection_state, t.status from projection.workflow_ref w
             left join projection.task_projection t on t.workflow_id = w.workflow_id
             where w.workflow_id = $1",
        )
        .bind(workflow_id)
        .fetch_one(pool)
        .await
        .expect("读 WorkflowRef");
        if row.0 == "TERMINAL" || std::time::Instant::now() > deadline {
            return row;
        }
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
    }
}

async fn workflow_of(pool: &PgPool, action: Uuid) -> String {
    sqlx::query_scalar(
        "select workflow_id from projection.workflow_ref where action_execution_id = $1",
    )
    .bind(action)
    .fetch_one(pool)
    .await
    .expect("该 ActionExecution 应已驱动一个 Workflow")
}

/// Workspace 在其 Tenant 就绪前被建立：WORKSPACE_LIFECYCLE 取不到 ACTIVE 的
/// CONTROL 身份，被确定拒绝而 FAILED，Workspace 停在 PROVISIONING——正是
/// `kailo.entity.stranded` 计数的那种搁浅。Tenant 就绪后经重跑入口以新版本与
/// 新 workflow ID 收敛到 ACTIVE。
#[tokio::test]
async fn stranded_workspace_is_rerun_with_new_version() {
    let Some(e) = common::env() else { return };
    let http = reqwest::Client::new();
    let pool = PgPool::connect(&e.database_url).await.expect("连 Core 库");
    let token = common::worker_token(&http, &e).await;
    let (tenant, initiator) = seed_tenant(&pool, &e).await;

    let outcome =
        std::panic::AssertUnwindSafe(run_rerun(&http, &e, &pool, &token, tenant, initiator))
            .catch_unwind()
            .await;
    teardown(&e, &pool, tenant, initiator, outcome).await;
}

async fn run_rerun(
    http: &reqwest::Client,
    e: &Env,
    pool: &PgPool,
    token: &str,
    tenant: Uuid,
    initiator: Uuid,
) {
    let workspace = Uuid::new_v4();
    sqlx::query(
        "insert into identity.workspace (id, tenant_id, slug, name, state)
         values ($1, $2, $3, $3, 'PROVISIONING')",
    )
    .bind(workspace)
    .bind(tenant)
    .bind(format!("w{}", &workspace.to_string()[..8]))
    .execute(pool)
    .await
    .expect("建 Workspace");

    // 1. Tenant 未就绪时建立 Workspace：确定拒绝，FAILED，实体搁浅
    let first = seed_action(pool, tenant, initiator, workspace).await;
    assert_eq!(
        start_scope(http, e, token, "WORKSPACE", workspace, first).await,
        reqwest::StatusCode::OK
    );
    let failed = workflow_of(pool, first).await;
    assert!(failed.ends_with(":1"), "首次建立用版本 1：{failed}");
    let (ref_state, status) = wait_terminal(pool, &failed, e.converge_bound_secs).await;
    assert_eq!(
        (ref_state.as_str(), status.as_deref()),
        ("TERMINAL", Some("FAILED")),
        "Tenant 未就绪时 WORKSPACE_LIFECYCLE 应被确定拒绝"
    );
    let (ws_state, ws_version): (String, i32) =
        sqlx::query_as("select state, version from identity.workspace where id = $1")
            .bind(workspace)
            .fetch_one(pool)
            .await
            .expect("读 Workspace");
    assert_eq!((ws_state.as_str(), ws_version), ("PROVISIONING", 1), "搁浅");

    // 同一 ID 不能再 Start：它已终结（component_task::start 的 409）
    let again = seed_action(pool, tenant, initiator, workspace).await;
    assert_eq!(
        start_scope(http, e, token, "WORKSPACE", workspace, again).await,
        reqwest::StatusCode::CONFLICT,
        "终结的固定 ID 不得被当作「已启动」"
    );

    // 2. 其他动作即使已 ALLOWED、目标相同，也不能充当重跑准入
    let wrong_action = seed_action(pool, tenant, initiator, workspace).await;
    assert_eq!(
        rerun(http, e, token, &failed, wrong_action).await.0,
        reqwest::StatusCode::FORBIDDEN
    );
    // 准入必须指向原 ActionExecution：指向另一条动作的准入不能借用
    let wrong_target = seed_action(pool, tenant, initiator, tenant).await;
    mark_rerun_action(pool, wrong_target, again).await;
    assert_eq!(
        rerun(http, e, token, &failed, wrong_target).await.0,
        reqwest::StatusCode::FORBIDDEN
    );
    let wrong_workspace = seed_action(pool, tenant, initiator, workspace).await;
    mark_rerun_action(pool, wrong_workspace, first).await;
    sqlx::query("update admission.action_execution set workspace_id = $2 where id = $1")
        .bind(wrong_workspace)
        .bind(workspace)
        .execute(pool)
        .await
        .expect("设置不一致的控制动作 Workspace");
    assert_eq!(
        rerun(http, e, token, &failed, wrong_workspace).await.0,
        reqwest::StatusCode::FORBIDDEN,
        "控制动作不能借同 Tenant 的另一执行 scope"
    );
    // 未准入的 ActionExecution 同样不行
    let denied = seed_action(pool, tenant, initiator, workspace).await;
    mark_rerun_action(pool, denied, first).await;
    sqlx::query("update admission.action_execution set gate_state = 'DENIED' where id = $1")
        .bind(denied)
        .execute(pool)
        .await
        .expect("改准入结论");
    assert_eq!(
        rerun(http, e, token, &failed, denied).await.0,
        reqwest::StatusCode::FORBIDDEN
    );
    // 没有 service 令牌不行
    let anon = http
        .post(format!("{}/service/v1/tasks/rerun", e.service_url))
        .json(&serde_json::json!({ "workflowId": failed, "actionExecutionId": again }))
        .send()
        .await
        .expect("调用 rerun endpoint")
        .status();
    assert_eq!(anon, reqwest::StatusCode::UNAUTHORIZED);

    // 3. 让 Tenant 就绪
    let tenant_action = seed_action(pool, tenant, initiator, tenant).await;
    assert_eq!(
        start_scope(http, e, token, "TENANT", tenant, tenant_action).await,
        reqwest::StatusCode::OK
    );
    assert_eq!(
        wait_state(
            pool,
            "identity.tenant",
            tenant,
            "ACTIVE",
            e.converge_bound_secs
        )
        .await,
        "ACTIVE"
    );
    // 已完成的 Workflow 不可重跑：完成却停在收敛中是另一类缺陷，重跑会掩盖它
    let tenant_wf = workflow_of(pool, tenant_action).await;
    let (_, tenant_status) = wait_terminal(pool, &tenant_wf, e.converge_bound_secs).await;
    assert_eq!(tenant_status.as_deref(), Some("COMPLETED"));
    let on_completed = seed_action(pool, tenant, initiator, tenant).await;
    mark_rerun_action(pool, on_completed, tenant_action).await;
    assert_eq!(
        rerun(http, e, token, &tenant_wf, on_completed).await.0,
        reqwest::StatusCode::CONFLICT
    );

    // 4. 重跑：新 ActionExecution → 实体版本 +1 → 新 workflow ID
    let retry = seed_action(pool, tenant, initiator, workspace).await;
    mark_rerun_action(pool, retry, first).await;
    sqlx::query("update admission.action_execution set target_id = $2 where id = $1")
        .bind(first)
        .bind(tenant)
        .execute(pool)
        .await
        .expect("制造原动作 target 与 Workflow ID 不一致");
    assert_eq!(
        rerun(http, e, token, &failed, retry).await.0,
        reqwest::StatusCode::CONFLICT,
        "不能从被篡改的原动作重新推导另一实体"
    );
    sqlx::query("update admission.action_execution set target_id = $2 where id = $1")
        .bind(first)
        .bind(workspace)
        .execute(pool)
        .await
        .expect("还原原动作 target");
    let original_run: String =
        sqlx::query_scalar("select run_id from projection.task_projection where workflow_id = $1")
            .bind(&failed)
            .fetch_one(pool)
            .await
            .expect("读原 Workflow 的 run ID");
    // 一个错误的、但形式上已终结的派生投影不能让重跑永远搁浅，也不能让
    // 本次请求在修复投影的同时直接分配下一条 Workflow。
    sqlx::query(
        "update projection.task_projection
         set run_id = 'wrong-run', status = 'COMPLETED' where workflow_id = $1",
    )
    .bind(&failed)
    .execute(pool)
    .await
    .expect("制造终态投影与 Temporal 不一致");
    assert_eq!(
        rerun(http, e, token, &failed, retry).await.0,
        reqwest::StatusCode::SERVICE_UNAVAILABLE,
        "本次只修复投影，不分配新 Workflow"
    );
    let repaired: (String, String, bool) = sqlx::query_as(
        "select run_id, status, observation_gap from projection.task_projection
         where workflow_id = $1",
    )
    .bind(&failed)
    .fetch_one(pool)
    .await
    .expect("读修复后的投影");
    assert_eq!(repaired, (original_run, "FAILED".into(), true));
    let still_one: i64 = sqlx::query_scalar(
        "select count(*) from projection.workflow_ref where action_execution_id = $1",
    )
    .bind(retry)
    .fetch_one(pool)
    .await
    .expect("确认修复请求未启动新 Workflow");
    assert_eq!(still_one, 0);
    let (code, body) = rerun(http, e, token, &failed, retry).await;
    assert_eq!(code, reqwest::StatusCode::OK, "{body}");
    let next = body["workflowId"].as_str().expect("workflowId").to_owned();
    assert_eq!(
        next,
        failed.trim_end_matches(":1").to_owned() + ":2",
        "新 ID 只差实体版本"
    );
    // 幂等：同一 ActionExecution 重发回答同一个 Workflow，不推进第二次版本
    let (code, body) = rerun(http, e, token, &failed, retry).await;
    assert_eq!(code, reqwest::StatusCode::OK, "{body}");
    assert_eq!(body["workflowId"].as_str(), Some(next.as_str()));
    sqlx::query("update admission.action_execution set gate_state = 'REVOKED' where id = $1")
        .bind(retry)
        .execute(pool)
        .await
        .expect("撤销旧准入");
    assert_eq!(
        rerun(http, e, token, &failed, retry).await.0,
        reqwest::StatusCode::FORBIDDEN,
        "同键重发也必须重新核对门禁"
    );
    // 另一张准入重跑同一条旧 Workflow：实体已不在它冻结的版本
    let late = seed_action(pool, tenant, initiator, workspace).await;
    mark_rerun_action(pool, late, first).await;
    assert_eq!(
        rerun(http, e, token, &failed, late).await.0,
        reqwest::StatusCode::CONFLICT
    );

    assert_eq!(
        wait_state(
            pool,
            "identity.workspace",
            workspace,
            "ACTIVE",
            e.converge_bound_secs
        )
        .await,
        "ACTIVE",
        "重跑后 Workspace 应收敛到 ACTIVE"
    );
    let version: i32 = sqlx::query_scalar("select version from identity.workspace where id = $1")
        .bind(workspace)
        .fetch_one(pool)
        .await
        .expect("读版本");
    // 2 是重跑推进的版本，ACTIVE 跃迁再 +1
    assert_eq!(version, 3);
    // 旧 history 不被改写：旧 Workflow 仍是 FAILED
    assert_eq!(
        wait_terminal(pool, &failed, 0).await.1.as_deref(),
        Some("FAILED")
    );
    // 重跑的决定与版本推进同事务留下审计，指向新旧两个 Workflow
    let audited: i64 = sqlx::query_scalar(
        "select count(*) from audit.audit_event
         where tenant_id = $1 and target_id = $2 and result_code = 'RERUN_ACCEPTED'
           and evidence_refs @> $3",
    )
    .bind(tenant)
    .bind(first)
    .bind(serde_json::json!([{ "value": failed }, { "value": next }]))
    .fetch_one(pool)
    .await
    .expect("读审计");
    assert_eq!(audited, 1, "重跑的审计恰好一条（重发不复制）");
}
