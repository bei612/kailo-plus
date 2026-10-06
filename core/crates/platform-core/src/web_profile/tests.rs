//! Post-implementation checks of the actual own-profile consumers. No live Relay,
//! user credentials, model, or business database is used.
use super::*;

fn event(keys: &nostr::Keys, kind: nostr::Kind, content: &str) -> nostr::Event {
    nostr::EventBuilder::new(kind, content)
        .custom_created_at(nostr::Timestamp::from(1_000))
        .sign_with_keys(keys)
        .unwrap()
}

#[test]
fn own_profile_read_requires_the_original_signed_metadata_shape() {
    let keys = nostr::Keys::generate();
    let author = keys.public_key().to_hex();
    let signed = event(
        &keys,
        nostr::Kind::Metadata,
        r#"{"display_name":"Original","custom":{"kept":true}}"#,
    );
    assert_eq!(
        profile_event(json!([signed]), &author).unwrap().unwrap().id,
        signed.id
    );
    assert!(profile_event(json!([]), &author).unwrap().is_none());
    let another = nostr::Keys::generate().public_key().to_hex();
    assert!(profile_event(json!([signed]), &another).is_err());
    assert!(profile_event(json!([signed, signed]), &author).is_err());
    assert!(profile_event(json!([event(&keys, nostr::Kind::TextNote, "{}")]), &author).is_err());
    assert!(profile_event(json!([event(&keys, nostr::Kind::Metadata, "[]")]), &author).is_err());
    let mut forged = serde_json::to_value(&signed).unwrap();
    forged["content"] = json!("{}");
    assert!(profile_event(json!([forged]), &author).is_err());

    let request: WebProfileUpdateRequest = serde_json::from_value(json!({
        "idempotencyKey": Uuid::new_v4(), "expectedPubkey": author,
        "displayName": "Updated", "about": ""
    }))
    .unwrap();
    let merged: Value =
        serde_json::from_str(&merged_content(Some(&signed), &request).unwrap()).unwrap();
    assert_eq!(merged["custom"]["kept"], true);
    assert_eq!(merged["display_name"], "Updated");
    assert_eq!(merged["about"], "");
    assert!(merged.get("nip05").is_none());
}

#[test]
fn avatar_reader_maps_only_original_community_hashes_and_both_animation_parts() {
    let poster = format!("https://community.example/media/{}.png", "a".repeat(64));
    let animation = format!("https://community.example/media/{}.png", "b".repeat(64));
    let encoded: String =
        nostr::types::form_urlencoded::byte_serialize(animation.as_bytes()).collect();
    let picture = format!("{poster}#buzz-anim={encoded}");
    let paths = avatar_media_paths(Some(&picture), "community.example");
    assert_eq!(paths.len(), 2);
    assert_eq!(
        paths[&poster],
        format!("/api/v1/profile/media/{}", "a".repeat(64))
    );
    assert_eq!(
        paths[&animation],
        format!("/api/v1/profile/media/{}", "b".repeat(64))
    );
    assert!(avatar_media_paths(Some(&poster), "other.example").is_empty());
    assert!(avatar_media_paths(
        Some("https://community.example/media/not-a-hash.png"),
        "community.example"
    )
    .is_empty());
    assert!(avatar_media_paths(
        Some(&poster.replace("https://", "https://secret@")),
        "community.example"
    )
    .is_empty());
    assert!(avatar_media_paths(Some("data:image/svg+xml,inline"), "community.example").is_empty());
}

#[test]
fn admitted_message_author_profile_is_not_the_reading_identity() {
    let author = nostr::Keys::generate();
    let reader = nostr::Keys::generate();
    let signed = event(
        &author,
        nostr::Kind::Metadata,
        r#"{"name":"Message author","about":"Original profile"}"#,
    );
    let read = profile_event(json!([signed]), &author.public_key().to_hex()).unwrap();
    let profile = view(
        author.public_key().to_hex(),
        read.as_ref(),
        "community.example",
    );
    assert_eq!(profile.pubkey, author.public_key().to_hex());
    assert_eq!(profile.display_name.as_deref(), Some("Message author"));
    assert_eq!(profile.about.as_deref(), Some("Original profile"));
    assert!(profile_event(json!([signed]), &reader.public_key().to_hex()).is_err());
    let missing = view(author.public_key().to_hex(), None, "community.example");
    assert!(missing.event_id.is_none());
    assert!(missing.display_name.is_none());
}

#[tokio::test]
async fn saved_response_cannot_retarget_or_change_the_original_intent() {
    let tenant = Uuid::new_v4();
    let mut attempt = Attempt {
        operation_id: Uuid::new_v4(),
        event_id: "a".repeat(64),
        action_key: PROFILE_ACTION.into(),
        tenant_id: Some(tenant),
        parameter_hash: "original".into(),
        result: None,
    };
    let unknown = attempt_response(&attempt, tenant, "original");
    assert_eq!(unknown.status(), StatusCode::SERVICE_UNAVAILABLE);
    let body: Value = serde_json::from_slice(
        &axum::body::to_bytes(unknown.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body["class"], "UNKNOWN");
    assert_eq!(
        attempt_response(&attempt, tenant, "edited").status(),
        StatusCode::CONFLICT
    );
    assert_eq!(
        attempt_response(&attempt, Uuid::new_v4(), "original").status(),
        StatusCode::CONFLICT
    );
    attempt.result = Some("ACCEPTED".into());
    assert_eq!(
        attempt_response(&attempt, tenant, "original").status(),
        StatusCode::OK
    );
    attempt.action_key = "collaboration.message.publish".into();
    assert_eq!(
        attempt_response(&attempt, tenant, "original").status(),
        StatusCode::CONFLICT
    );
}

fn dispatch(tenant: Uuid, actor: Uuid, operation: Uuid, event_id: &str) -> AuditEntry<'_> {
    AuditEntry {
        event_key: format!("profile-test:{operation}:dispatch"),
        tenant_id: Some(tenant),
        workspace_id: None,
        operation_id: operation,
        event_type: "DISPATCH",
        human_identity_id: None,
        initiator_principal_id: Some(actor),
        actor_principal_id: Some(actor),
        action_key: PROFILE_ACTION,
        action_version: 1,
        component_type_key: "buzz",
        target_type: Some("PRINCIPAL"),
        target_id: Some(actor),
        parameter_hash: "digest-only",
        decision: "ALLOW",
        result_code: "DISPATCHED",
        result_exposure: "NONE",
        evidence_refs: vec![Evidence::new(EvidenceKind::BuzzEventId, event_id)],
        correlation_id: operation,
    }
}

#[tokio::test]
#[ignore = "requires PROFILE_TEST_DATABASE_URL pointing at an isolated migrated database"]
async fn original_publish_intent_is_atomic_and_unknown_profile_does_not_starve_later_intents() {
    let pool = sqlx::PgPool::connect(&std::env::var("PROFILE_TEST_DATABASE_URL").unwrap())
        .await
        .unwrap();
    let mut tx = pool.begin().await.unwrap();
    let tenant = Uuid::new_v4();
    let actor = Uuid::new_v4();
    sqlx::query(
        "insert into identity.tenant(id,slug,name,state) values($1,$2,'profile fixture','ACTIVE')",
    )
    .bind(tenant)
    .bind(format!("profile-{tenant}"))
    .execute(&mut *tx)
    .await
    .unwrap();
    sqlx::query(
        "insert into identity.principal(id,tenant_id,kind,status) values($1,$2,'HUMAN','ACTIVE')",
    )
    .bind(actor)
    .bind(tenant)
    .execute(&mut *tx)
    .await
    .unwrap();
    let key = Uuid::new_v4();
    let operation = Uuid::new_v4();
    let event_id = "a".repeat(64);
    // Invoke the real writer with a failed audit insert in a savepoint: no
    // independent intent survives it and the same key can still be admitted.
    let mut nested = sqlx::Acquire::begin(&mut tx).await.unwrap();
    let mut invalid = dispatch(tenant, actor, operation, &event_id);
    invalid.event_type = "INVALID_PROFILE_TEST_EVENT";
    assert!(
        claim_in_transaction(&mut nested, actor, key, &event_id, invalid)
            .await
            .is_err()
    );
    nested.rollback().await.unwrap();
    let count: i64 = sqlx::query_scalar("select count(*) from admission.publish_attempt where tenant_principal_id=$1 and idempotency_key=$2")
        .bind(actor).bind(key).fetch_one(&mut *tx).await.unwrap();
    assert_eq!(count, 0);
    assert!(claim_in_transaction(
        &mut tx,
        actor,
        key,
        &event_id,
        dispatch(tenant, actor, operation, &event_id)
    )
    .await
    .unwrap());
    assert!(!claim_in_transaction(
        &mut tx,
        actor,
        key,
        &"b".repeat(64),
        dispatch(tenant, actor, Uuid::new_v4(), &event_id)
    )
    .await
    .unwrap());
    let count: i64 =
        sqlx::query_scalar("select count(*) from audit.audit_event where operation_id=$1")
            .bind(operation)
            .fetch_one(&mut *tx)
            .await
            .unwrap();
    assert_eq!(count, 1);

    let next_operation = Uuid::new_v4();
    let next_event_id = "b".repeat(64);
    assert!(claim_in_transaction(
        &mut tx,
        actor,
        Uuid::new_v4(),
        &next_event_id,
        dispatch(tenant, actor, next_operation, &next_event_id)
    )
    .await
    .unwrap());
    let first = pending(&mut *tx, 1, None).await.unwrap();
    assert_eq!(first.len(), 1);
    let cursor = Some((first[0].occurred_at, first[0].operation_id));
    // No OUTCOME is fabricated for the first absent replaceable event. The
    // original scheduler's next keyset nevertheless observes the later row.
    let second = pending(&mut *tx, 1, cursor).await.unwrap();
    assert_eq!(second.len(), 1);
    assert_ne!(first[0].operation_id, second[0].operation_id);
    let after = Some((second[0].occurred_at, second[0].operation_id));
    assert!(pending(&mut *tx, 1, after).await.unwrap().is_empty());
    assert_eq!(
        pending(&mut *tx, 1, None).await.unwrap()[0].operation_id,
        first[0].operation_id
    );
    tx.rollback().await.unwrap();
}
