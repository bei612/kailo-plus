//! DD-85 / V-SCN-69：只在独立夹具 Tenant 上制造旧平台 SecretRef，验证同一
//! pubkey 的受治理归位、Temporal 终态与 OpenBao 旧版本销毁。失败时保留夹具供
//! 排查，不把仍在运行的 Workflow 所需的私钥当作测试垃圾在线删除。

use std::time::Duration;

use contracts::{ActionSubmission, LegacySecretRefPage};
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

mod common;

#[tokio::test]
async fn copy_unknown_observes_only_the_frozen_target() {
    let Some(e) = common::env() else { return };
    let http = reqwest::Client::new();
    let pool = PgPool::connect(&e.database_url).await.expect("连 Core 库");
    let token = common::worker_token(&http, &e).await;
    let fx = common::provision_live_workspace(&http, &e, &pool, &token)
        .await
        .expect("开通独立归位夹具");
    let path = format!("buzz-human/{}/{}", fx.tenant, Uuid::new_v4());
    let action = Uuid::new_v4();
    let operation = Uuid::new_v4();
    let workflow = format!("kailo:SECRET_REF_REHOME:{}:{action}:1", fx.tenant);
    let target_path = format!("buzz-ref-rehome/{action}");
    let parent = std::env::var("OPENBAO_TENANT_PARENT_NAMESPACE").expect("Tenant namespace 根");
    let child = format!("{parent}/{}", fx.tenant);
    let target_locator = format!("{child}/{}/{}", e.bao_mount, target_path);

    let (pubkey, tenant_locator, tenant_version, audience, generation): (
        String,
        String,
        i32,
        String,
        i32,
    ) = sqlx::query_as(
        "select pubkey, private_key_secret_ref, private_key_secret_version,
                private_key_secret_audience, version
         from identity.buzz_identity_binding
         where tenant_id = $1 and principal_id = $2 and kind = 'HUMAN'
           and custody = 'SERVER' and state = 'ACTIVE'",
    )
    .bind(fx.tenant)
    .bind(fx.principal)
    .fetch_one(&pool)
    .await
    .expect("夹具 HUMAN binding");
    let key =
        common::read_secret_version(&http, &e, fx.tenant, &tenant_locator, tenant_version).await;
    let old_version = common::put_secret(&http, &e, &path, &key).await;
    let old_locator = format!("{}/{}/{path}", e.bao_namespace, e.bao_mount);
    common::zed_relationship(
        &e,
        "touch",
        &format!("tenant:{}", fx.tenant),
        "admin",
        &format!("principal:{}", fx.principal),
    );
    // 仅构造已经发生外部写入意图后的持久事实；不调用用户 Action 入口，
    // 因为该能力仍是 exposure:none。已有真实 Tenant lifecycle 的 Workflow
    // 保持原样，本测试的归位 WorkflowRef 只作为服务面核验引用。
    let mut tx = pool.begin().await.expect("冻结归位夹具事务");
    let frozen_generation: i32 = sqlx::query_scalar(
        "update identity.buzz_identity_binding
         set private_key_secret_ref = $2, private_key_secret_version = $3,
             version = version + 1
         where pubkey = $1 and tenant_id = $4 and version = $5
         returning version",
    )
    .bind(&pubkey)
    .bind(&old_locator)
    .bind(i32::try_from(old_version).expect("旧 KV 版本"))
    .bind(fx.tenant)
    .bind(generation)
    .fetch_one(&mut *tx)
    .await
    .expect("只改夹具 SecretRef");
    sqlx::query(
        "insert into admission.action_execution
         (id, operation_id, tenant_id, action_key, action_version,
          initiator_principal_id, actor_principal_id, target_id, parameter_hash,
          temporal_workflow_id, gate_state, dispatch_state, correlation_id)
         values ($1,$2,$3,'identity.secret_ref.rehome',1,$4,$4,$4,
                 'copy-unknown-verify',$5,'ALLOWED','NOT_DISPATCHED',$6)",
    )
    .bind(action)
    .bind(operation)
    .bind(fx.tenant)
    .bind(fx.principal)
    .bind(&workflow)
    .bind(Uuid::new_v4())
    .execute(&mut *tx)
    .await
    .expect("写入夹具 ActionExecution");
    sqlx::query(
        "insert into projection.workflow_ref
         (workflow_id, workflow_type, workflow_version, kind, tenant_id,
          operation_id, action_execution_id, projection_state)
         values ($1,'ComponentTaskWorkflow',1,'SECRET_REF_REHOME',$2,$3,$4,'PENDING_START')",
    )
    .bind(&workflow)
    .bind(fx.tenant)
    .bind(operation)
    .bind(action)
    .execute(&mut *tx)
    .await
    .expect("写入夹具 WorkflowRef");
    sqlx::query(
        "insert into admission.secret_ref_rehome
         (id, action_execution_id, workflow_id, tenant_id, identity_pubkey,
          expected_binding_version, old_locator, old_version, old_audience,
          target_locator, old_ref_status, new_ref_status, state)
         values ($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,'ACTIVE','NONE','COPY_UNKNOWN')",
    )
    .bind(action)
    .bind(&workflow)
    .bind(fx.tenant)
    .bind(&pubkey)
    .bind(frozen_generation)
    .bind(&old_locator)
    .bind(i32::try_from(old_version).expect("旧 KV 版本"))
    .bind(&audience)
    .bind(&target_locator)
    .execute(&mut *tx)
    .await
    .expect("写入夹具 COPY_UNKNOWN");
    tx.commit().await.expect("提交写前事实");

    let step = json!({
        "actionExecutionId": action,
        "rehomeId": action,
        "tenantId": fx.tenant,
        "pubkey": pubkey,
        "expectedBindingVersion": frozen_generation,
        "workflowId": workflow
    });
    let advance = || {
        http.post(format!(
            "{}/service/v1/secret-ref-rehomes/advance",
            e.service_url
        ))
        .bearer_auth(&token)
        .json(&step)
        .send()
    };
    let absent = advance().await.expect("目标缺失时对账调用");
    assert_eq!(absent.status(), reqwest::StatusCode::SERVICE_UNAVAILABLE);
    let state: String =
        sqlx::query_scalar("select state from admission.secret_ref_rehome where id = $1")
            .bind(action)
            .fetch_one(&pool)
            .await
            .expect("目标缺失时状态");
    assert_eq!(state, "COPY_UNKNOWN", "目标缺失不能回到写路径");

    let credentials = std::fs::read_to_string(
        std::env::var("VERIFY_OPENBAO_ROOT_TOKEN_FILE").expect("核验凭据路径"),
    )
    .expect("读取核验凭据");
    let credentials: Value = serde_json::from_str(&credentials).expect("解析核验凭据");
    let root = credentials["root_token"].as_str().expect("核验 root token");
    let written = http
        .post(format!(
            "{}/v1/{}/data/{target_path}",
            e.bao_addr, e.bao_mount
        ))
        .header("X-Vault-Namespace", &child)
        .header("X-Vault-Token", root)
        .json(&json!({"data":{"value":key},"options":{"cas":0}}))
        .send()
        .await
        .expect("模拟已发生但响应丢失的目标写入");
    assert!(written.status().is_success(), "目标首次写入必须成功");
    let written: Value = written.json().await.expect("解析目标写入结果");
    assert_eq!(written["data"]["version"], 1);

    // 让 Core 原有对账器从冻结的 ALLOWED/PENDING_START 事实派发固定 ID。
    // 不直接调用 Temporal CLI 启动；这同时核验 Core 的 dispatch、Worker
    // Activity 和 TaskProjection，且不绕过仍关闭的用户入口。
    let stale_after: i64 = std::env::var("ADMISSION_EVALUATION_TIMEOUT_SECONDS")
        .expect("准入对账超时配置")
        .parse()
        .expect("准入对账超时须为秒数");
    sqlx::query(
        "update admission.action_execution
         set updated_at = now() - make_interval(secs => $2::bigint)
         where id = $1",
    )
    .bind(action)
    .bind(stale_after.checked_add(1).expect("对账超时上界"))
    .execute(&pool)
    .await
    .expect("触发既有 Core 对账派发");
    let deadline = std::time::Instant::now() + Duration::from_secs(e.converge_bound_secs);
    loop {
        let (rehome, dispatch, projection, task): (String, String, String, Option<String>) =
            sqlx::query_as(
                "select r.state, ae.dispatch_state, w.projection_state, tp.status
                 from admission.secret_ref_rehome r
                 join admission.action_execution ae on ae.id = r.action_execution_id
                 join projection.workflow_ref w on w.workflow_id = r.workflow_id
                 left join projection.task_projection tp on tp.workflow_id = w.workflow_id
                 where r.id = $1",
            )
            .bind(action)
            .fetch_one(&pool)
            .await
            .expect("读取归位 Workflow 状态");
        if rehome == "RETIRED"
            && dispatch == "DISPATCHED"
            && projection == "TERMINAL"
            && task.as_deref() == Some("COMPLETED")
        {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "归位未收敛：rehome={rehome}, dispatch={dispatch}, projection={projection}, task={task:?}; 保留 Tenant {}",
            fx.tenant
        );
        tokio::time::sleep(Duration::from_millis(400)).await;
    }
    let config = |name: &str| std::env::var(name).unwrap_or_else(|_| panic!("缺少 {name}"));
    loop {
        let described = std::process::Command::new("sudo")
            .args([
                "-n",
                "docker",
                "run",
                "--rm",
                "--network",
                &e.docker_network,
                &config("VERIFY_TEMPORAL_ADMIN_IMAGE"),
                "temporal",
                "workflow",
                "describe",
                "--address",
                &config("VERIFY_TEMPORAL_INTERNAL_ADDRESS"),
                "--namespace",
                &config("TEMPORAL_NAMESPACE"),
                "--workflow-id",
                &workflow,
                "--output",
                "json",
            ])
            .output()
            .expect("查询归位 Temporal execution");
        assert!(
            described.status.success(),
            "Temporal describe 失败：{}",
            String::from_utf8_lossy(&described.stderr)
        );
        let described: Value =
            serde_json::from_slice(&described.stdout).expect("解析 Temporal describe");
        if described["workflowExecutionInfo"]["status"] == "WORKFLOW_EXECUTION_STATUS_COMPLETED" {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "归位 TaskProjection 已完成，但 Temporal execution 未关闭；保留 Tenant {}",
            fx.tenant
        );
        tokio::time::sleep(Duration::from_millis(400)).await;
    }
    let target_metadata: Value = http
        .get(format!(
            "{}/v1/{}/metadata/{target_path}",
            e.bao_addr, e.bao_mount
        ))
        .header("X-Vault-Namespace", &child)
        .header("X-Vault-Token", root)
        .send()
        .await
        .expect("回读目标 metadata")
        .error_for_status()
        .expect("目标 metadata 可读")
        .json()
        .await
        .expect("解析目标 metadata");
    assert_eq!(
        target_metadata["data"]["current_version"], 1,
        "对账不得写第二个目标版本"
    );
    let (current_pubkey, locator, version): (String, String, i32) = sqlx::query_as(
        "select pubkey, private_key_secret_ref, private_key_secret_version
         from identity.buzz_identity_binding where tenant_id = $1 and principal_id = $2",
    )
    .bind(fx.tenant)
    .bind(fx.principal)
    .fetch_one(&pool)
    .await
    .expect("归位后的 binding");
    assert_eq!(current_pubkey, pubkey);
    assert_eq!(locator, target_locator);
    assert_eq!(version, 1);

    sqlx::query("delete from admission.secret_ref_rehome where id = $1")
        .bind(action)
        .execute(&pool)
        .await
        .expect("清理归位状态");
    common::zed_relationship(
        &e,
        "delete",
        &format!("tenant:{}", fx.tenant),
        "admin",
        &format!("principal:{}", fx.principal),
    );
    common::teardown_live_workspace(&e, &pool, &fx).await;
    purge_test_legacy_metadata(&http, &e, fx.tenant, &path).await;
    eprintln!(
        "归位缺失目标/已提交目标对账夹具 Tenant {} 已拆库；子 namespace 按离线纪律清理",
        fx.tenant
    );
}

#[tokio::test]
async fn legacy_server_secret_ref_is_blocked_until_exposed_then_rehomes() {
    let Some(e) = common::env() else { return };
    let http = reqwest::Client::new();
    let pool = PgPool::connect(&e.database_url).await.expect("连 Core 库");
    let token = common::worker_token(&http, &e).await;
    let fx = common::provision_live_workspace(&http, &e, &pool, &token)
        .await
        .expect("开通独立夹具 Tenant");
    let registry: serde_yaml::Value =
        serde_yaml::from_str(include_str!("../../../../tools/registry/capabilities.yaml"))
            .expect("解析生成的能力注册表");
    let exposure = registry["capabilities"]
        .as_sequence()
        .expect("能力列表")
        .iter()
        .find(|cap| cap["id"].as_str() == Some("identity.secret_ref_rehome"))
        .and_then(|cap| cap["exposure"].as_str())
        .expect("归位能力的 exposure");
    if exposure == "none" {
        let (status, _) = common::bff(
            &http,
            &e,
            &fx.subject,
            reqwest::Method::GET,
            "/api/v1/identity/legacy-secret-refs",
            None,
        )
        .await;
        assert_eq!(
            status,
            reqwest::StatusCode::NOT_FOUND,
            "未开放路由必须不存在"
        );
        let (status, body) = common::submit(
            &http,
            &e,
            &fx.subject,
            json!({"actionKey":"identity.secret_ref.rehome", "idempotencyKey":Uuid::new_v4(),
                   "principalId":fx.principal, "explicitConfirmation":true}),
        )
        .await;
        assert_eq!(status, reqwest::StatusCode::FORBIDDEN, "{body}");
        assert_eq!(common::reason(&body), "CAPABILITY_BLOCKED");
        common::teardown_live_workspace(&e, &pool, &fx).await;
        return;
    }
    assert_eq!(exposure, "tenant_admin", "归位只对 Tenant admin 开放");
    let path = format!("buzz-human/{}/{}", fx.tenant, Uuid::new_v4());

    let concurrent_result = verify(&http, &e, &pool, &fx, &path).await;

    // 只有全部终态证据成立才清理。在线删除 Tenant namespace 会让 Core 已缓存的
    // service token 续期失败；该 namespace 仍按现有离线夹具清理纪律处理。
    sqlx::query("delete from admission.secret_ref_rehome where tenant_id = $1")
        .bind(fx.tenant)
        .execute(&pool)
        .await
        .expect("清理归位夹具行");
    common::zed_relationship(
        &e,
        "delete",
        &format!("tenant:{}", fx.tenant),
        "admin",
        &format!("principal:{}", fx.principal),
    );
    common::teardown_live_workspace(&e, &pool, &fx).await;
    purge_test_legacy_metadata(&http, &e, fx.tenant, &path).await;
    assert!(
        (concurrent_result.0.is_success() && concurrent_result.1 == reqwest::StatusCode::CONFLICT)
            || (concurrent_result.1.is_success()
                && concurrent_result.0 == reqwest::StatusCode::CONFLICT),
        "同一旧身份的不同幂等键必须一条准入、一条确定冲突，得到 {concurrent_result:?}"
    );
}

async fn verify(
    http: &reqwest::Client,
    e: &common::Env,
    pool: &PgPool,
    fx: &common::LiveWorkspace,
    path: &str,
) -> (reqwest::StatusCode, reqwest::StatusCode) {
    let (pubkey, tenant_locator, tenant_version, audience, old_generation): (
        String,
        String,
        i32,
        String,
        i32,
    ) = sqlx::query_as(
        "select pubkey, private_key_secret_ref, private_key_secret_version,
                private_key_secret_audience, version
         from identity.buzz_identity_binding
         where tenant_id = $1 and principal_id = $2 and kind = 'HUMAN'
           and custody = 'SERVER' and state = 'ACTIVE'",
    )
    .bind(fx.tenant)
    .bind(fx.principal)
    .fetch_one(pool)
    .await
    .expect("夹具 HUMAN binding");
    let key =
        common::read_secret_version(http, e, fx.tenant, &tenant_locator, tenant_version).await;
    let legacy_version = common::put_secret(http, e, path, &key).await;
    let legacy_locator = format!("{}/{}/{path}", e.bao_namespace, e.bao_mount);
    let legacy_generation: i32 = sqlx::query_scalar(
        "update identity.buzz_identity_binding
         set private_key_secret_ref = $2, private_key_secret_version = $3,
             version = version + 1
         where pubkey = $1 and tenant_id = $4 and version = $5
         returning version",
    )
    .bind(&pubkey)
    .bind(&legacy_locator)
    .bind(i32::try_from(legacy_version).expect("KV 版本"))
    .bind(fx.tenant)
    .bind(old_generation)
    .fetch_one(pool)
    .await
    .expect("只改夹具的 SecretRef，不换 pubkey");

    let (status, _) = common::bff(
        http,
        e,
        &fx.subject,
        reqwest::Method::GET,
        "/api/v1/identity/legacy-secret-refs",
        None,
    )
    .await;
    assert_eq!(
        status,
        reqwest::StatusCode::FORBIDDEN,
        "普通成员不可枚举旧引用"
    );
    common::zed_relationship(
        e,
        "touch",
        &format!("tenant:{}", fx.tenant),
        "admin",
        &format!("principal:{}", fx.principal),
    );
    let (status, listing) = common::bff(
        http,
        e,
        &fx.subject,
        reqwest::Method::GET,
        "/api/v1/identity/legacy-secret-refs",
        None,
    )
    .await;
    assert_eq!(
        status,
        reqwest::StatusCode::OK,
        "Tenant admin 应可枚举：{listing}"
    );
    common::assert_contract::<LegacySecretRefPage>(&listing, "旧引用列表");
    assert!(
        listing["bindings"]
            .as_array()
            .expect("bindings")
            .iter()
            .any(|binding| binding["pubkey"] == pubkey),
        "缺少夹具旧引用"
    );
    assert!(
        !listing.to_string().contains(&legacy_locator),
        "列表不得暴露 locator"
    );

    let idempotency_key = Uuid::new_v4();
    let command = json!({
        "actionKey": "identity.secret_ref.rehome",
        "idempotencyKey": idempotency_key,
        "principalId": fx.principal,
        "explicitConfirmation": true
    });
    let (status, _) = common::submit(
        http,
        e,
        &fx.subject,
        json!({"actionKey":"identity.secret_ref.rehome", "idempotencyKey":Uuid::new_v4(),
               "principalId":fx.principal}),
    )
    .await;
    assert_eq!(
        status,
        reqwest::StatusCode::UNPROCESSABLE_ENTITY,
        "缺少显式确认必须拒绝"
    );

    // 不同幂等键并发命中同一旧 binding：ActionExecution 的在途目标唯一索引
    // 或持锁后的 target_gate 只能允许一条写前意图，另一条须是确定冲突。
    let competing = json!({
        "actionKey": "identity.secret_ref.rehome",
        "idempotencyKey": Uuid::new_v4(),
        "principalId": fx.principal,
        "explicitConfirmation": true
    });
    let (first, second) = tokio::join!(
        common::submit(http, e, &fx.subject, command.clone()),
        common::submit(http, e, &fx.subject, competing.clone()),
    );
    assert!(
        first.0.is_success() || second.0.is_success(),
        "同一 pubkey 并发归位没有一条准入：{first:?} {second:?}"
    );
    let concurrent_statuses = (first.0, second.0);
    let (body, winning_command) = if first.0.is_success() {
        (first.1, command)
    } else {
        (second.1, competing)
    };
    common::assert_contract::<ActionSubmission>(&body, "归位动作回应");
    let action: ActionSubmission = serde_json::from_value(body.clone()).expect("动作契约");
    let action_id = Uuid::parse_str(&action.action_execution_id).expect("ActionExecution ID");
    let count: i64 = sqlx::query_scalar(
        "select count(*) from admission.secret_ref_rehome
         where tenant_id = $1 and identity_pubkey = $2",
    )
    .bind(fx.tenant)
    .bind(&pubkey)
    .fetch_one(pool)
    .await
    .expect("并发归位行数");
    assert_eq!(count, 1, "同一旧身份只能有一条归位意图");
    let (status, repeated) = common::submit(http, e, &fx.subject, winning_command).await;
    assert!(
        status.is_success(),
        "同键重发应复用原动作：{status} {repeated}"
    );
    assert_eq!(repeated["actionExecutionId"], body["actionExecutionId"]);

    let deadline = std::time::Instant::now() + Duration::from_secs(e.converge_bound_secs);
    loop {
        let state: String = sqlx::query_scalar(
            "select state from admission.secret_ref_rehome where action_execution_id = $1",
        )
        .bind(action_id)
        .fetch_one(pool)
        .await
        .expect("读归位状态");
        if state == "RETIRED" {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "归位停在 {state}；保留夹具 Tenant {} 与旧路径供排查",
            fx.tenant
        );
        tokio::time::sleep(Duration::from_millis(400)).await;
    }

    let (current_pubkey, current_locator, current_version, current_audience, current_generation): (
        String,
        String,
        i32,
        String,
        i32,
    ) = sqlx::query_as(
        "select pubkey, private_key_secret_ref, private_key_secret_version,
                private_key_secret_audience, version
         from identity.buzz_identity_binding where pubkey = $1 and tenant_id = $2",
    )
    .bind(&pubkey)
    .bind(fx.tenant)
    .fetch_one(pool)
    .await
    .expect("切换后 binding");
    assert_eq!(current_pubkey, pubkey, "归位不得换身份");
    assert_eq!(current_version, 1, "目标 KV 只能首次写入");
    assert_eq!(current_audience, audience, "不得扩大取用 audience");
    assert_eq!(current_generation, legacy_generation + 1);
    assert!(
        current_locator.starts_with(&format!(
            "{}/{}/{}/",
            std::env::var("OPENBAO_TENANT_PARENT_NAMESPACE").expect("Tenant namespace 根"),
            fx.tenant,
            e.bao_mount
        )),
        "目标必须属于原 Tenant namespace"
    );
    let copied =
        common::read_secret_version(http, e, fx.tenant, &current_locator, current_version).await;
    assert_eq!(copied, key, "目标内容与旧私钥不同");

    let metadata: Value = http
        .get(format!("{}/v1/{}/metadata/{path}", e.bao_addr, e.bao_mount))
        .header("X-Vault-Namespace", &e.bao_namespace)
        .header("X-Vault-Token", &e.bao_token)
        .send()
        .await
        .expect("读旧 KV metadata")
        .error_for_status()
        .expect("旧 KV metadata 可读")
        .json()
        .await
        .expect("解析旧 KV metadata");
    assert_eq!(
        metadata.pointer(&format!("/data/versions/{legacy_version}/destroyed")),
        Some(&Value::Bool(true)),
        "旧版本只有 destroy 回读成立才算退役"
    );
    concurrent_statuses
}

async fn purge_test_legacy_metadata(
    http: &reqwest::Client,
    e: &common::Env,
    tenant: Uuid,
    path: &str,
) {
    assert!(
        path.starts_with(&format!("buzz-human/{tenant}/")),
        "只准清理本次夹具的 HUMAN 路径"
    );
    let credentials = std::fs::read_to_string(
        std::env::var("VERIFY_OPENBAO_ROOT_TOKEN_FILE").expect("本地核验凭据路径"),
    )
    .expect("读取本地核验凭据");
    let credentials: Value = serde_json::from_str(&credentials).expect("解析本地核验凭据");
    let root = credentials["root_token"]
        .as_str()
        .expect("OpenBao root token");
    let response = http
        .delete(format!("{}/v1/{}/metadata/{path}", e.bao_addr, e.bao_mount))
        .header("X-Vault-Namespace", &e.bao_namespace)
        .header("X-Vault-Token", root)
        .send()
        .await
        .expect("清理夹具旧 KV metadata");
    assert!(
        response.status().is_success(),
        "夹具旧 KV metadata 清理失败"
    );
}
