//! 业务 Tenant 暂停与恢复的端到端核验（DD-96、`.design/06` §7.2 第 1–2 步、V-SCN-31
//! 暂停部分）。
//!
//! 走真实拓扑：Catalog 会话的语义命令 → Catalog manage 的 fresh Check → 同事务把业务
//! Tenant 置 SUSPENDING/RESTORING 并建立业务侧承接执行 → TENANT_LIFECYCLE 在 Worker 上
//! 以 RelayOperatorIdentity 归档/解档 Community（Core 以 operator 列表回读查证）→ 跃迁。
//!
//! 夹具：业务 Tenant 走 `provision_live_workspace`；Catalog 平台管理员是 Catalog Tenant
//! 上经真实 MEMBERSHIP_PROJECTION 开通的成员，再写 Catalog 的 admin relationship；拆除时
//! 经真实 MEMBERSHIP_REVOCATION 撤掉它的全部关系与 relay roster，再删行。

use collab_bridge::bridge::{Custody, IdentityClient};
use collab_bridge::operator::{OperatorError, OperatorIdentity};
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

mod common;
use common::bootstrapped::{self, Member};
use common::{bff, reason, state_of, submit, until, Env, LiveWorkspace};

#[tokio::test]
async fn catalog_admin_suspends_and_restores_a_business_tenant() {
    let Some(e) = common::env() else { return };
    let http = reqwest::Client::new();
    let pool = PgPool::connect(&e.database_url).await.expect("连 Core 库");
    let token = common::worker_token(&http, &e).await;

    let fx = common::provision_live_workspace(&http, &e, &pool, &token)
        .await
        .expect("开通夹具业务 Tenant");
    let catalog: Uuid = sqlx::query_scalar("select id from identity.tenant where slug = $1")
        .bind(&e.catalog_tenant_slug)
        .fetch_one(&pool)
        .await
        .expect("Catalog Tenant 应由平台引导建立");
    let admin =
        match bootstrapped::add_member(&http, &e, &pool, &token, catalog, fx.initiator).await {
            Ok(m) => m,
            Err(err) => {
                common::teardown_live_workspace(&e, &pool, &fx).await;
                panic!("开通 Catalog 平台管理员失败：{err}");
            }
        };
    // Catalog 普通成员：没有 Catalog manage，不能发起
    let plain =
        match bootstrapped::add_member(&http, &e, &pool, &token, catalog, fx.initiator).await {
            Ok(m) => m,
            Err(err) => {
                teardown_catalog_admin(&http, &e, &pool, &token, catalog, &fx, &admin).await;
                common::teardown_live_workspace(&e, &pool, &fx).await;
                panic!("开通 Catalog 普通成员失败：{err}");
            }
        };
    let catalog_obj = format!("tenant:{catalog}");
    common::zed_relationship(
        &e,
        "touch",
        &catalog_obj,
        "admin",
        &bootstrapped::subj(admin.principal),
    );
    // 业务 Tenant 自己的 admin：用来证明被暂停的 Tenant 不能由自身 scope 发起
    let business_obj = format!("tenant:{}", fx.tenant);
    common::zed_relationship(
        &e,
        "touch",
        &business_obj,
        "admin",
        &bootstrapped::subj(fx.principal),
    );

    let outcome =
        std::panic::AssertUnwindSafe(scenarios(&http, &e, &pool, &fx, catalog, &admin, &plain));
    let result = futures_util::FutureExt::catch_unwind(outcome).await;

    // 场景中途失败时业务 Tenant 可能停在暂停一侧；拆除不依赖它的状态
    common::zed_relationship(
        &e,
        "delete",
        &business_obj,
        "admin",
        &bootstrapped::subj(fx.principal),
    );
    teardown_catalog_admin(&http, &e, &pool, &token, catalog, &fx, &plain).await;
    teardown_catalog_admin(&http, &e, &pool, &token, catalog, &fx, &admin).await;
    common::teardown_live_workspace(&e, &pool, &fx).await;
    if let Err(p) = result {
        std::panic::resume_unwind(p);
    }
}

fn lifecycle(key: &str, tenant: Uuid) -> Value {
    json!({"actionKey": key, "idempotencyKey": Uuid::new_v4(), "tenantId": tenant,
           "explicitConfirmation": true})
}

async fn tenant_row(http: &reqwest::Client, e: &Env, subject: &str, tenant: Uuid) -> Option<Value> {
    let (st, page) = bff(
        http,
        e,
        subject,
        reqwest::Method::GET,
        "/api/v1/platform/tenants",
        None,
    )
    .await;
    assert!(
        st.is_success(),
        "Catalog 的 Tenant 管理视图失败：{st} {page}"
    );
    common::assert_contract::<contracts::PlatformTenantPage>(&page, "PlatformTenantPage");
    page["tenants"]
        .as_array()?
        .iter()
        .find(|t| t["id"] == tenant.to_string())
        .cloned()
}

async fn scenarios(
    http: &reqwest::Client,
    e: &Env,
    pool: &PgPool,
    fx: &LiveWorkspace,
    catalog: Uuid,
    admin: &Member,
    plain: &Member,
) {
    let a = fx.subject.as_str();
    let p = admin.subject.as_str();
    let business = fx.tenant;

    // ---- 1. 非 Catalog 路径：业务 Tenant admin 不能暂停，也看不到管理视图 ----
    let (st, refused) = submit(http, e, a, lifecycle("tenant.suspend", business)).await;
    assert_eq!(st, reqwest::StatusCode::FORBIDDEN, "{refused}");
    assert_eq!(reason(&refused), "SCOPE_GUARD_FAILED");
    let (st, _) = bff(
        http,
        e,
        a,
        reqwest::Method::GET,
        "/api/v1/platform/tenants",
        None,
    )
    .await;
    assert_eq!(
        st,
        reqwest::StatusCode::FORBIDDEN,
        "非 Catalog 会话不得读取 Tenant 管理视图"
    );

    // Catalog 普通成员：会话在 Catalog，但没有 Catalog manage
    let (st, refused) = submit(
        http,
        e,
        &plain.subject,
        lifecycle("tenant.suspend", business),
    )
    .await;
    assert_eq!(st, reqwest::StatusCode::FORBIDDEN, "{refused}");
    assert_eq!(reason(&refused), "PERMISSION_DENIED");
    let (st, _) = bff(
        http,
        e,
        &plain.subject,
        reqwest::Method::GET,
        "/api/v1/platform/tenants",
        None,
    )
    .await;
    assert_eq!(
        st,
        reqwest::StatusCode::FORBIDDEN,
        "无 Catalog manage 不得读取管理视图"
    );

    // ---- 2. Catalog 视图给出暂停键；参数闭集与状态冲突 ----
    let row = tenant_row(http, e, p, business)
        .await
        .expect("Catalog 管理员应看到业务 Tenant");
    assert_eq!(row["state"], "ACTIVE");
    assert_eq!(row["lifecycleActionKey"], "tenant.suspend");
    let mut unconfirmed = lifecycle("tenant.suspend", business);
    unconfirmed
        .as_object_mut()
        .unwrap()
        .remove("explicitConfirmation");
    let (st, bad) = submit(http, e, p, unconfirmed).await;
    assert_eq!(st, reqwest::StatusCode::UNPROCESSABLE_ENTITY, "{bad}");
    assert_eq!(reason(&bad), "INVALID_PARAMETERS");
    let mut extra = lifecycle("tenant.suspend", business);
    extra["workspaceId"] = json!(fx.workspace);
    let (st, bad) = submit(http, e, p, extra).await;
    assert_eq!(st, reqwest::StatusCode::UNPROCESSABLE_ENTITY, "{bad}");
    assert_eq!(reason(&bad), "INVALID_PARAMETERS");
    let (st, early) = submit(http, e, p, lifecycle("tenant.restore", business)).await;
    assert_eq!(st, reqwest::StatusCode::CONFLICT, "{early}");
    assert_eq!(reason(&early), "TARGET_STATE_CONFLICT");
    let (st, own) = submit(http, e, p, lifecycle("tenant.suspend", catalog)).await;
    assert_eq!(
        st,
        reqwest::StatusCode::UNPROCESSABLE_ENTITY,
        "Catalog 不能暂停自己：{own}"
    );
    assert_eq!(reason(&own), "TARGET_NOT_FOUND");

    // ---- 3. 暂停：两侧各有自己的执行与 operation，业务侧审计引用 Catalog 执行 ----
    let (st, sub) = submit(http, e, p, lifecycle("tenant.suspend", business)).await;
    assert!(st.is_success(), "tenant.suspend 应被允许：{st} {sub}");
    let ae = Uuid::parse_str(sub["actionExecutionId"].as_str().unwrap()).unwrap();
    let (ae_tenant, workflow): (Uuid, String) = sqlx::query_as(
        "select tenant_id, temporal_workflow_id from admission.action_execution where id = $1",
    )
    .bind(ae)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(ae_tenant, catalog, "发起动作归 Catalog Tenant");
    let (ref_tenant, ref_ae, ref_op): (Uuid, Uuid, Uuid) = sqlx::query_as(
        "select tenant_id, action_execution_id, operation_id from projection.workflow_ref
         where workflow_id = $1",
    )
    .bind(&workflow)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(ref_tenant, business, "WorkflowRef 归业务 Tenant");
    assert_ne!(ref_ae, ae, "业务侧由自己的执行承接");
    let catalog_op: Uuid =
        sqlx::query_scalar("select operation_id from admission.action_execution where id = $1")
            .bind(ae)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_ne!(ref_op, catalog_op, "两侧不共享 operation");
    let cites: bool = sqlx::query_scalar(
        "select exists (select 1 from audit.audit_event
                        where tenant_id = $1 and operation_id = $2
                          and evidence_refs::text like '%' || $3 || '%')",
    )
    .bind(business)
    .bind(ref_op)
    .bind(ae.to_string())
    .fetch_one(pool)
    .await
    .unwrap();
    assert!(
        cites,
        "业务侧审计应以 EvidenceRef 引用发起它的 Catalog ActionExecution"
    );
    until(e, "业务 Tenant SUSPENDED", || async {
        (state_of(pool, "identity.tenant", business).await == "SUSPENDED").then_some(())
    })
    .await;
    let catalog_relation = common::zed_has(
        e,
        &format!("tenant:{business}"),
        "admin",
        &bootstrapped::subj(admin.principal),
    );
    assert!(
        !catalog_relation,
        "不得在业务 Tenant 中建立 Catalog Principal 的 relationship"
    );

    // ---- 4. 暂停期间 fail closed：成员身份解析即拒绝，Community 已归档 ----
    let (st, body) = bff(http, e, a, reqwest::Method::GET, "/api/v1/session", None).await;
    assert_eq!(st, reqwest::StatusCode::FORBIDDEN, "{body}");
    assert_eq!(reason(&body), "TENANT_NOT_ACTIVE");
    let (host, owner) = community(pool, business).await;
    assert!(
        archived_at(http, e, &owner, &host).await.is_some(),
        "暂停后 operator 列表中该 Community 的 archived_at 应非空"
    );
    // 判定：成员托管私钥按原 host 直连发布，Relay 明确拒绝（HTTP 拒绝或 accepted=false）
    // 即为关闭；传输失败无从区分「不可达」与环境故障，按核验失败处理
    let holder = holder(http, e, pool, fx, &host).await;
    let (_, channel) = common::live_scope(pool, fx).await;
    let published = holder
        .publish(
            http,
            9,
            "while tenant suspended",
            &[vec!["h".to_owned(), channel.clone()]],
        )
        .await;
    let refused = match &published {
        Ok(v) => v["accepted"] == false,
        Err(OperatorError::Rejected { .. }) => true,
        Err(_) => false,
    };
    assert!(refused, "暂停期间直连发布必须被 Relay 拒绝：{published:?}");
    let row = tenant_row(http, e, p, business)
        .await
        .expect("已暂停的 Tenant 仍在视图中");
    assert_eq!(row["state"], "SUSPENDED");
    assert_eq!(row["lifecycleActionKey"], "tenant.restore");
    let (st, again) = submit(http, e, p, lifecycle("tenant.suspend", business)).await;
    assert_eq!(st, reqwest::StatusCode::CONFLICT, "{again}");
    assert_eq!(reason(&again), "TARGET_STATE_CONFLICT");

    // ---- 5. 恢复：对账、解档、回读后 ACTIVE，成员重新可用 ----
    let (st, sub) = submit(http, e, p, lifecycle("tenant.restore", business)).await;
    assert!(st.is_success(), "tenant.restore 应被允许：{st} {sub}");
    until(e, "业务 Tenant ACTIVE", || async {
        (state_of(pool, "identity.tenant", business).await == "ACTIVE").then_some(())
    })
    .await;
    let (st, body) = bff(http, e, a, reqwest::Method::GET, "/api/v1/session", None).await;
    assert!(st.is_success(), "恢复后成员应重新可用：{st} {body}");
    assert!(
        archived_at(http, e, &owner, &host).await.is_none(),
        "恢复后 operator 列表中该 Community 的 archived_at 应为空"
    );
    let published = holder
        .publish(
            http,
            9,
            "after tenant restore",
            &[vec!["h".to_owned(), channel]],
        )
        .await
        .expect("恢复后直连发布应到达 Relay");
    assert_eq!(
        published["accepted"], true,
        "恢复后直连发布应被接受：{published}"
    );
    let row = tenant_row(http, e, p, business)
        .await
        .expect("恢复后的 Tenant 在视图中");
    assert_eq!(row["state"], "ACTIVE");
    assert_eq!(row["lifecycleActionKey"], "tenant.suspend");
    // 暂停不动 relationship：业务成员的 tenant 关系在恢复后仍在
    assert!(common::zed_has(
        e,
        &format!("tenant:{business}"),
        "member",
        &bootstrapped::subj(fx.principal)
    ));
}

/// 业务 Tenant 的 Community host 与 CONTROL pubkey（Community owner）。
async fn community(pool: &PgPool, tenant: Uuid) -> (String, String) {
    sqlx::query_as(
        "select b.normalized_host, i.pubkey from projection.tenant_buzz_binding b
         join identity.buzz_identity_binding i
           on i.tenant_id = b.tenant_id and i.principal_id = b.control_service_principal_id
         where b.tenant_id = $1",
    )
    .bind(tenant)
    .fetch_one(pool)
    .await
    .expect("业务 Tenant 的协作面 binding")
}

/// 以部署的 operator 身份回读该 host 的 archived_at；列表中没有该 host 即核验失败。
async fn archived_at(http: &reqwest::Client, e: &Env, owner: &str, host: &str) -> Option<String> {
    let operator = OperatorIdentity::new(
        &e.operator_key,
        &e.relay_origin,
        &e.operator_audience,
        &e.operator_audience,
    )
    .expect("operator 身份");
    operator
        .list_owned_communities(http, owner)
        .await
        .expect("operator 列表")
        .into_iter()
        .find(|c| c.host.eq_ignore_ascii_case(host))
        .expect("operator 列表应含该 Community")
        .archived_at
}

/// 夹具业务成员的 Web 托管身份，按其 SecretRef 读出私钥后按原 host 直连 Relay。
async fn holder(
    http: &reqwest::Client,
    e: &Env,
    pool: &PgPool,
    fx: &LiveWorkspace,
    host: &str,
) -> IdentityClient {
    let (locator, version): (String, i32) = sqlx::query_as(
        "select private_key_secret_ref, private_key_secret_version
         from identity.buzz_identity_binding
         where principal_id = $1 and custody = 'SERVER' and state = 'ACTIVE'",
    )
    .bind(fx.principal)
    .fetch_one(pool)
    .await
    .expect("夹具应有 ACTIVE 的 Web 托管身份");
    let secret = common::read_secret_version(http, e, fx.tenant, &locator, version).await;
    IdentityClient::new(Custody::Server, &secret, &e.relay_origin, host).expect("托管身份客户端")
}

/// 撤掉 Catalog 平台管理员：经真实 MEMBERSHIP_REVOCATION 撤全部关系与 relay roster，
/// 再删它在 Catalog 与业务 Tenant 两侧留下的执行与行。业务 Tenant 本身由
/// `teardown_live_workspace` 拆除。
async fn teardown_catalog_admin(
    http: &reqwest::Client,
    e: &Env,
    pool: &PgPool,
    token: &str,
    catalog: Uuid,
    fx: &LiveWorkspace,
    admin: &Member,
) {
    let revoked = async {
        sqlx::query(
            "update identity.tenant_membership set state = 'REVOKING', version = version + 1
             where id = $1 and state = 'ACTIVE'",
        )
        .bind(admin.membership)
        .execute(pool)
        .await
        .map_err(|err| err.to_string())?;
        let action = common::allowed_action(pool, catalog, fx.initiator, admin.membership).await?;
        common::start_and_wait(
            http,
            e,
            token,
            pool,
            common::AwaitTarget {
                endpoint: "/service/v1/memberships/lifecycle",
                body: json!({"scope":"TENANT","membershipId":admin.membership,"actionExecutionId":action}),
                table: "identity.tenant_membership",
                id: admin.membership,
                want: "REVOKED",
            },
        )
        .await
    }
    .await;
    if let Err(err) = &revoked {
        eprintln!("撤销 Catalog 平台管理员失败：{err}");
        common::zed_relationship(
            e,
            "delete",
            &format!("tenant:{catalog}"),
            "admin",
            &bootstrapped::subj(admin.principal),
        );
        common::zed_relationship(
            e,
            "delete",
            &format!("tenant:{catalog}"),
            "member",
            &bootstrapped::subj(admin.principal),
        );
    }
    let initiators = vec![fx.initiator, admin.principal];
    let steps: [(&str, Uuid); 10] = [
        (
            "delete from identity.platform_session where tenant_membership_id = $1",
            admin.membership,
        ),
        (
            "delete from projection.task_projection where workflow_id in
              (select w.workflow_id from projection.workflow_ref w
               join admission.action_execution ae on ae.id = w.action_execution_id
               where ae.initiator_principal_id = any($2)) and $1 is not null",
            admin.principal,
        ),
        (
            "delete from projection.workflow_ref where action_execution_id in
              (select id from admission.action_execution where initiator_principal_id = any($2))
              and $1 is not null",
            admin.principal,
        ),
        (
            "delete from admission.server_key_provision_intent where action_execution_id in
              (select id from admission.action_execution where initiator_principal_id = any($2))
              and $1 is not null",
            admin.principal,
        ),
        (
            "delete from admission.action_execution where initiator_principal_id = any($2)
              and $1 is not null",
            admin.principal,
        ),
        (
            "delete from identity.buzz_identity_binding where principal_id = $1",
            admin.principal,
        ),
        (
            "delete from identity.tenant_membership where id = $1",
            admin.membership,
        ),
        (
            "delete from identity.principal where id = $1",
            admin.principal,
        ),
        (
            "delete from identity.external_identity where human_identity_id = $1",
            admin.human,
        ),
        (
            "delete from identity.human_identity where id = $1",
            admin.human,
        ),
    ];
    for (sql, id) in steps {
        let q = sqlx::query(sql).bind(id);
        let q = if sql.contains("$2") {
            q.bind(&initiators)
        } else {
            q
        };
        if let Err(err) = q.execute(pool).await {
            eprintln!("Catalog 平台管理员拆除失败：{sql}\n  {err}");
        }
    }
}
