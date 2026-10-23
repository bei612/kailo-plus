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
fn batch_author_profiles_require_each_requested_signed_metadata_author() {
    let first = nostr::Keys::generate();
    let second = nostr::Keys::generate();
    let authors = vec![first.public_key().to_hex(), second.public_key().to_hex()];
    let one = event(&first, nostr::Kind::Metadata, r#"{"name":"First"}"#);
    let two = event(&second, nostr::Kind::Metadata, r#"{"name":"Second"}"#);
    let profiles = author_events(json!([two, one]), &authors).unwrap();
    assert_eq!(profiles[&authors[0]].id, one.id);
    assert_eq!(profiles[&authors[1]].id, two.id);
    assert_eq!(author_events(json!([one]), &authors).unwrap().len(), 1);
    assert!(author_events(json!([]), &authors).unwrap().is_empty());
    assert!(author_events(json!([one, one]), &authors).is_err());
    assert!(author_events(json!([two]), &authors[..1]).is_err());
    assert!(author_events(
        json!([event(&first, nostr::Kind::TextNote, "{}")]),
        &authors
    )
    .is_err());
    assert!(author_events(
        json!([event(&first, nostr::Kind::Metadata, "[]")]),
        &authors
    )
    .is_err());
    let mut tampered = serde_json::to_value(one).unwrap();
    tampered["content"] = json!(r#"{"name":"Forged"}"#);
    assert!(author_events(json!([tampered]), &authors).is_err());
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

// 07 §4.7.3: the per-subject avatar route. Only this community's media is
// redirected; inline, external or missing pictures are the same 404.
#[test]
fn identity_avatar_redirects_only_this_community_media() {
    let keys = nostr::Keys::generate();
    let hash = "ab".repeat(32);
    let host = "relay.kailo.test:8090";
    let profile = |content: String| event(&keys, nostr::Kind::Metadata, &content);
    let media = profile(json!({"picture": format!("http://{host}/media/{hash}.png")}).to_string());
    assert_eq!(
        avatar_location(Some(&media), host).as_deref(),
        Some(format!("/api/v1/profile/media/{hash}").as_str())
    );
    let animated = profile(
        json!({"picture": format!("http://{host}/media/{hash}.png#buzz-anim=http%3A%2F%2F{host}%2Fmedia%2F{}.webm", "cd".repeat(32))})
            .to_string(),
    );
    assert_eq!(
        avatar_location(Some(&animated), host).as_deref(),
        Some(format!("/api/v1/profile/media/{hash}").as_str())
    );
    for content in [
        json!({"name": "no picture"}).to_string(),
        json!({"picture": "data:image/svg+xml,%3Csvg%3E"}).to_string(),
        json!({"picture": format!("http://elsewhere.test/media/{hash}.png")}).to_string(),
        json!({"picture": format!("http://user:pw@{host}/media/{hash}.png")}).to_string(),
        json!({"picture": format!("http://{host}/other/{hash}.png")}).to_string(),
        "not json".to_owned(),
    ] {
        assert_eq!(
            avatar_location(Some(&profile(content.clone())), host),
            None,
            "{content}"
        );
    }
    assert_eq!(avatar_location(None, host), None);
}

#[test]
fn identity_avatar_answers_404_without_a_session_but_keeps_outages() {
    for status in [
        StatusCode::UNAUTHORIZED,
        StatusCode::FORBIDDEN,
        StatusCode::NOT_FOUND,
    ] {
        let response = avatar_refusal(status.into_response());
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(
            response.headers()[axum::http::header::CACHE_CONTROL],
            "no-store"
        );
    }
    for status in [
        StatusCode::SERVICE_UNAVAILABLE,
        StatusCode::INTERNAL_SERVER_ERROR,
    ] {
        assert_eq!(avatar_refusal(status.into_response()).status(), status);
    }
}

// A member list asks once per person: a resolved answer, the redirect or the
// "no Kailo avatar" 404 alike, is kept only by the requester's browser and only
// for its cookies, so it does not spend the requester's Relay budget per render.
#[test]
fn identity_avatar_resolved_answers_are_private_to_the_requesters_session() {
    let path = format!("/api/v1/profile/media/{}", "ab".repeat(32));
    let found = avatar_resolved(Some(path.clone()));
    assert_eq!(found.status(), StatusCode::FOUND);
    assert_eq!(found.headers()[axum::http::header::LOCATION], path.as_str());
    let missing = avatar_resolved(None);
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);
    for response in [found, missing] {
        assert_eq!(
            response.headers()[axum::http::header::CACHE_CONTROL],
            "private, max-age=300"
        );
        assert_eq!(response.headers()[axum::http::header::VARY], "Cookie");
    }
}

#[tokio::test]
#[ignore = "requires PROFILE_TEST_DATABASE_URL pointing at an isolated migrated database"]
async fn identity_avatar_resolves_the_subjects_server_identity_inside_the_requesters_tenant() {
    let pool = sqlx::PgPool::connect(&std::env::var("PROFILE_TEST_DATABASE_URL").unwrap())
        .await
        .unwrap();
    let mut tx = pool.begin().await.unwrap();
    let provider = Uuid::new_v4();
    let issuer = format!("urn:fixture:{provider}");
    sqlx::query("insert into identity.identity_provider(id,issuer,client_id,claim_mapping_version,status) values($1,$2,'fixture-avatar',1,'ACTIVE')")
        .bind(provider).bind(&issuer).execute(&mut *tx).await.unwrap();
    let (tenant, foreign) = (Uuid::new_v4(), Uuid::new_v4());
    for id in [tenant, foreign] {
        sqlx::query("insert into identity.tenant(id,slug,name,state) values($1,$2,'Avatar fixture','ACTIVE')")
            .bind(id).bind(id.to_string()).execute(&mut *tx).await.unwrap();
    }
    // One person per row: (Tenant, membership, human, identity, binding custody/state).
    let people = [
        (
            tenant,
            "ACTIVE",
            "ACTIVE",
            "ACTIVE",
            Some(("SERVER", "ACTIVE")),
        ), // resolves
        (
            tenant,
            "REVOKED",
            "ACTIVE",
            "ACTIVE",
            Some(("SERVER", "ACTIVE")),
        ), // left the Tenant
        (
            tenant,
            "ACTIVE",
            "DISABLED",
            "ACTIVE",
            Some(("SERVER", "ACTIVE")),
        ), // disabled person
        (
            tenant,
            "ACTIVE",
            "ACTIVE",
            "DISABLED",
            Some(("SERVER", "ACTIVE")),
        ), // disabled identity
        (
            tenant,
            "ACTIVE",
            "ACTIVE",
            "ACTIVE",
            Some(("SERVER", "REVOKED")),
        ), // key revoked
        (
            tenant,
            "ACTIVE",
            "ACTIVE",
            "ACTIVE",
            Some(("CLIENT", "ACTIVE")),
        ), // device key only
        (tenant, "ACTIVE", "ACTIVE", "ACTIVE", None), // no Buzz identity
        (
            foreign,
            "ACTIVE",
            "ACTIVE",
            "ACTIVE",
            Some(("SERVER", "ACTIVE")),
        ), // other Tenant
    ];
    let mut subjects = Vec::new();
    for (owner, membership, human_status, identity_status, binding) in people {
        let (human, principal, subject) =
            (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4().to_string());
        sqlx::query("insert into identity.human_identity(id,display_name,status) values($1,'Avatar Person',$2)")
            .bind(human).bind(human_status).execute(&mut *tx).await.unwrap();
        sqlx::query("insert into identity.external_identity(id,provider_id,issuer,subject,human_identity_id,status) values($1,$2,$3,$4,$5,$6)")
            .bind(Uuid::new_v4()).bind(provider).bind(&issuer).bind(&subject).bind(human).bind(identity_status)
            .execute(&mut *tx).await.unwrap();
        sqlx::query("insert into identity.principal(id,tenant_id,kind,status) values($1,$2,'HUMAN','ACTIVE')")
            .bind(principal).bind(owner).execute(&mut *tx).await.unwrap();
        sqlx::query("insert into identity.tenant_membership(id,tenant_id,human_identity_id,tenant_principal_id,state) values($1,$2,$3,$4,$5)")
            .bind(Uuid::new_v4()).bind(owner).bind(human).bind(principal).bind(membership)
            .execute(&mut *tx).await.unwrap();
        let mut pubkey = None;
        if let Some((custody, state)) = binding {
            let key = nostr::Keys::generate().public_key().to_hex();
            let server = custody == "SERVER";
            sqlx::query("insert into identity.buzz_identity_binding
                 (tenant_id,principal_id,pubkey,custody,private_key_secret_ref,private_key_secret_version,
                  private_key_secret_audience,private_key_secret_status,kind,state)
                 values($1,$2,$3,$4,$5,$6,$7,$8,'HUMAN',$9)")
                .bind(owner).bind(principal).bind(&key).bind(custody)
                .bind(server.then_some("fixture/avatar")).bind(server.then_some(1))
                .bind(server.then_some("fixture"))
                .bind(server.then_some(if state == "REVOKED" { "SUPERSEDED" } else { "ACTIVE" }))
                .bind(state).execute(&mut *tx).await.unwrap();
            pubkey = Some(key);
        }
        subjects.push((subject, pubkey));
    }
    // A device key next to the SERVER identity does not change the answer.
    let device = nostr::Keys::generate().public_key().to_hex();
    let first: Uuid = sqlx::query_scalar("select tm.tenant_principal_id from identity.tenant_membership tm
        join identity.external_identity ei on ei.human_identity_id=tm.human_identity_id where ei.subject=$1")
        .bind(&subjects[0].0).fetch_one(&mut *tx).await.unwrap();
    sqlx::query("insert into identity.buzz_identity_binding(tenant_id,principal_id,pubkey,custody,kind,state)
         values($1,$2,$3,'CLIENT','HUMAN','ACTIVE')")
        .bind(tenant).bind(first).bind(&device).execute(&mut *tx).await.unwrap();

    assert_eq!(
        avatar_pubkey(&mut *tx, &issuer, &subjects[0].0, tenant)
            .await
            .unwrap(),
        subjects[0].1
    );
    for (index, (subject, _)) in subjects.iter().enumerate().skip(1) {
        assert_eq!(
            avatar_pubkey(&mut *tx, &issuer, subject, tenant)
                .await
                .unwrap(),
            None,
            "row {index} must not resolve in the requester's Tenant"
        );
    }
    // The other Tenant's person resolves only for requesters of that Tenant.
    assert_eq!(
        avatar_pubkey(&mut *tx, &issuer, &subjects[7].0, foreign)
            .await
            .unwrap(),
        subjects[7].1
    );
    assert_eq!(
        avatar_pubkey(&mut *tx, &issuer, &subjects[0].0, foreign)
            .await
            .unwrap(),
        None
    );
    // The requester's IdP is part of the subject's identity.
    assert_eq!(
        avatar_pubkey(&mut *tx, "urn:fixture:another-idp", &subjects[0].0, tenant)
            .await
            .unwrap(),
        None
    );
    assert_eq!(
        avatar_pubkey(&mut *tx, &issuer, "unknown-subject", tenant)
            .await
            .unwrap(),
        None
    );
    tx.rollback().await.unwrap();
}
