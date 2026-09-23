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

#[tokio::test]
async fn tenant_and_workspace_lifecycle_converge() {
    let Some(e) = common::env() else { return };
    let http = reqwest::Client::new();
    let pool = PgPool::connect(&e.database_url).await.expect("连 Core 库");
    let token = common::worker_token(&http, &e).await;

    // 平台引导已经建好 Catalog Tenant 与 operator 身份（Core 启动时做的）。
    // 发起方 Principal 挂在它下面。
    let catalog: Uuid = sqlx::query_scalar("select id from identity.tenant where slug = $1")
        .bind(&e.catalog_tenant_slug)
        .fetch_one(&pool)
        .await
        .expect("Catalog Tenant 应由平台引导建立");
    let initiator = Uuid::new_v4();
    sqlx::query(
        "insert into identity.principal (id, tenant_id, kind, status)
         values ($1, $2, 'SERVICE', 'ACTIVE')",
    )
    .bind(initiator)
    .bind(catalog)
    .execute(&pool)
    .await
    .expect("建发起方 Principal");

    let tenant = Uuid::new_v4();
    let slug = format!("t{}", &tenant.to_string()[..8]);
    sqlx::query(
        "insert into identity.tenant (id, slug, name, state) values ($1, $2, $2, 'PROVISIONING')",
    )
    .bind(tenant)
    .bind(&slug)
    .execute(&pool)
    .await
    .expect("建 Tenant");

    let outcome = std::panic::AssertUnwindSafe(run(&http, &e, &pool, &token, tenant, initiator))
        .catch_unwind()
        .await;

    // 清理跨三个系统。Workspace 的 SpiceDB 归属关系要在删库之前取出来。
    let workspace: Option<Uuid> =
        sqlx::query_scalar("select id from identity.workspace where tenant_id = $1 limit 1")
            .bind(tenant)
            .fetch_optional(&pool)
            .await
            .ok()
            .flatten();
    if let Some(ws) = workspace {
        spicedb_delete(
            &e,
            &format!("workspace:{ws}"),
            "tenant",
            &format!("tenant:{tenant}"),
        );
    }
    let retired = common::retire_relay_community(&e, &pool, tenant).await;
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
        if let Err(e) = sqlx::query(sql).bind(tenant).execute(&pool).await {
            eprintln!("夹具清理失败：{sql}\n  {e}");
        }
    }
    if let Err(e) = sqlx::query("delete from identity.principal where id = $1")
        .bind(initiator)
        .execute(&pool)
        .await
    {
        eprintln!("夹具清理失败（发起方 Principal）：{e}");
    }
    // 复核：清理被挡住时只在下一次跑别的用例才表现出来，那时已经难以归因
    let left: i64 = sqlx::query_scalar("select count(*) from identity.tenant where id = $1")
        .bind(tenant)
        .fetch_one(&pool)
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
