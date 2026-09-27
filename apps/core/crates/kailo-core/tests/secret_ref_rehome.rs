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
