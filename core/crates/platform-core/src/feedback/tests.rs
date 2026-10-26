use super::*;
use base64::Engine;

fn request(key: Uuid, message: &str) -> Request {
    Request {
        idempotency_key: key,
        client: "WEB".into(),
        category: Some("BUG".into()),
        message: message.into(),
        diagnostics: None,
        attachment: None,
    }
}

#[test]
fn validates_fixed_diagnostics_image_headers_and_body_boundaries() {
    let key = Uuid::new_v4();
    assert!(input::validate(request(key, " ")).is_err());
    assert!(input::validate(request(key, &"字".repeat(4001))).is_err());
    assert!(input::validate(request(key, &"字".repeat(4000))).is_ok());
    let mut req = request(key, "反馈");
    req.diagnostics = Some(
        json!({"appVersion":"1","platform":"desktop","userAgent":"app",
        "language":"zh-CN","capturedAt":"2026-10-26T01:02:03Z","logs":"not allowed"})
        .to_string(),
    );
    assert!(input::validate(req).is_err());
    let mut req = request(key, "反馈");
    req.attachment = Some(input::Attachment {
        mime_type: "image/png".into(),
        data_base64: base64::engine::general_purpose::STANDARD.encode(b"<svg></svg>"),
    });
    assert!(input::validate(req).is_err());
    let mut req = request(key, "  反馈  ");
    req.attachment = Some(input::Attachment {
        mime_type: "image/png".into(),
        data_base64: base64::engine::general_purpose::STANDARD.encode(b"\x89PNG\r\n\x1a\nfixture"),
    });
    let input = input::validate(req).unwrap();
    assert_eq!(input.message, "反馈");
    assert_eq!(
        input.sha256.as_deref(),
        Some(hex::encode(sha2::Sha256::digest(b"\x89PNG\r\n\x1a\nfixture")).as_str())
    );
}

async fn body(response: Response) -> serde_json::Value {
    serde_json::from_slice(
        &axum::body::to_bytes(response.into_body(), 65536)
            .await
            .unwrap(),
    )
    .unwrap()
}

#[tokio::test]
#[ignore = "requires FEEDBACK_TEST_DATABASE_URL pointing at an isolated migrated database"]
async fn actual_submit_chain_is_idempotent_limited_audited_and_revocation_aware() {
    let pool = sqlx::PgPool::connect(&std::env::var("FEEDBACK_TEST_DATABASE_URL").unwrap())
        .await
        .unwrap();
    let ctx = ExecutionContext {
        tenant_id: Uuid::new_v4(),
        tenant_principal_id: Uuid::new_v4(),
        human_identity_id: Uuid::new_v4(),
        session_id: Uuid::new_v4(),
        access_mode: contracts::PlatformSessionAccessMode::Full,
    };
    let mut tx = pool.begin().await.unwrap();
    sqlx::query(
        "insert into identity.tenant(id,slug,name,state) values($1,$2,'feedback fixture','ACTIVE')",
    )
    .bind(ctx.tenant_id)
    .bind(format!("feedback-{}", ctx.tenant_id))
    .execute(&mut *tx)
    .await
    .unwrap();
    sqlx::query("insert into identity.human_identity(id,display_name,status) values($1,'feedback fixture','ACTIVE')")
        .bind(ctx.human_identity_id).execute(&mut *tx).await.unwrap();
    sqlx::query(
        "insert into identity.principal(id,tenant_id,kind,status) values($1,$2,'HUMAN','ACTIVE')",
    )
    .bind(ctx.tenant_principal_id)
    .bind(ctx.tenant_id)
    .execute(&mut *tx)
    .await
    .unwrap();
    sqlx::query("insert into identity.tenant_membership(id,tenant_id,human_identity_id,tenant_principal_id,state) values($1,$2,$3,$4,'ACTIVE')")
        .bind(Uuid::new_v4()).bind(ctx.tenant_id).bind(ctx.human_identity_id).bind(ctx.tenant_principal_id).execute(&mut *tx).await.unwrap();
    tx.commit().await.unwrap();
    let key = Uuid::new_v4();
    let first = body(
        submit_inner(
            &pool,
            &ctx,
            input::validate(request(key, "private body fixture")).unwrap(),
        )
        .await
        .unwrap(),
    )
    .await;
    let replay = body(
        submit_inner(
            &pool,
            &ctx,
            input::validate(request(key, "private body fixture")).unwrap(),
        )
        .await
        .unwrap(),
    )
    .await;
    assert_eq!(first, replay);
    assert_eq!(
        submit_inner(
            &pool,
            &ctx,
            input::validate(request(key, "different body")).unwrap()
        )
        .await
        .unwrap_err()
        .status(),
        StatusCode::CONFLICT
    );
    for _ in 1..10 {
        assert_eq!(
            submit_inner(
                &pool,
                &ctx,
                input::validate(request(Uuid::new_v4(), "private body fixture")).unwrap()
            )
            .await
            .unwrap()
            .status(),
            StatusCode::OK
        );
    }
    let limited = submit_inner(
        &pool,
        &ctx,
        input::validate(request(Uuid::new_v4(), "eleventh")).unwrap(),
    )
    .await
    .unwrap_err();
    assert_eq!(limited.status(), StatusCode::TOO_MANY_REQUESTS);
    assert!(
        limited.headers()["retry-after"]
            .to_str()
            .unwrap()
            .parse::<i64>()
            .unwrap()
            > 0
    );
    let count: i64 =
        sqlx::query_scalar("select count(*) from support.feedback_submission where tenant_id=$1")
            .bind(ctx.tenant_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 10);
    let audits: Vec<String> = sqlx::query_scalar("select row_to_json(e)::text from audit.audit_event e where tenant_id=$1 and action_key='feedback.submit'")
        .bind(ctx.tenant_id).fetch_all(&pool).await.unwrap();
    assert_eq!(audits.len(), 10);
    assert!(audits
        .iter()
        .all(|a| !a.contains("private body fixture") && a.contains("FEEDBACK_WEB_BUG_D0_A0")));
    sqlx::query(
        "update identity.tenant_membership set state='REVOKED' where tenant_principal_id=$1",
    )
    .bind(ctx.tenant_principal_id)
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        submit_inner(
            &pool,
            &ctx,
            input::validate(request(key, "private body fixture")).unwrap()
        )
        .await
        .unwrap_err()
        .status(),
        StatusCode::FORBIDDEN
    );
}
