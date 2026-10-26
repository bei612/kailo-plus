use super::*;
use std::collections::BTreeSet;

fn message(id: u64, at: u64, channel: &str, root: Option<&str>) -> MessageFacts {
    MessageFacts {
        id: format!("{id:064x}"),
        author: "a".repeat(64),
        created_at: at,
        channel_id: channel.into(),
        broadcast: false,
        mentioned: BTreeSet::new(),
        parent_id: root.map(str::to_owned),
        root_id: root.map(str::to_owned),
    }
}

#[tokio::test]
#[ignore = "requires PUSH_TEST_DATABASE_URL pointing at an isolated migrated database"]
async fn accepted_messages_deduplicate_by_id_preserve_same_second_and_read_authority() {
    let pool = sqlx::PgPool::connect(&std::env::var("PUSH_TEST_DATABASE_URL").unwrap())
        .await
        .unwrap();
    let mut tx = pool.begin().await.unwrap();
    let tenant = Uuid::new_v4();
    let actor = Uuid::new_v4();
    let other = Uuid::new_v4();
    sqlx::query(
        "insert into identity.tenant(id,slug,name,state) values($1,$2,'push fixture','ACTIVE')",
    )
    .bind(tenant)
    .bind(format!("push-{tenant}"))
    .execute(&mut *tx)
    .await
    .unwrap();
    for principal in [actor, other] {
        sqlx::query("insert into identity.principal(id,tenant_id,kind,status) values($1,$2,'HUMAN','ACTIVE')")
            .bind(principal).bind(tenant).execute(&mut *tx).await.unwrap();
    }
    let channel = Uuid::new_v4().to_string();
    let first = message(1, 100, &channel, None);
    let second = message(2, 100, &channel, None);
    let marks = HashMap::new();
    // Preview/failure/retry do not write candidate messages into the accepted-message set.
    for _ in 0..2 {
        assert_eq!(
            preview(&mut tx, tenant, actor, &first, &marks)
                .await
                .unwrap(),
            1
        );
        assert!(events(&mut tx, tenant, actor).await.unwrap().is_empty());
    }
    record(&mut tx, tenant, actor, &first, &marks)
        .await
        .unwrap();
    // The second device or replay of the same accepted event contributes no extra message.
    record(&mut tx, tenant, actor, &first, &marks)
        .await
        .unwrap();
    assert_eq!(
        preview(&mut tx, tenant, actor, &first, &marks)
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        preview(&mut tx, tenant, actor, &second, &marks)
            .await
            .unwrap(),
        2
    );
    record(&mut tx, tenant, actor, &second, &marks)
        .await
        .unwrap();
    assert_eq!(events(&mut tx, tenant, actor).await.unwrap().len(), 2);
    assert!(events(&mut tx, tenant, other).await.unwrap().is_empty());
    // A later device failure leaves the previously accepted messages alone.
    let failed = message(3, 101, &channel, None);
    assert_eq!(
        preview(&mut tx, tenant, actor, &failed, &marks)
            .await
            .unwrap(),
        3
    );
    assert_eq!(events(&mut tx, tenant, actor).await.unwrap().len(), 2);

    let root = "b".repeat(64);
    let reply = message(4, 110, &channel, Some(&root));
    record(&mut tx, tenant, actor, &reply, &marks)
        .await
        .unwrap();
    let positions = HashMap::from([(channel.clone(), 100)]);
    assert_eq!(
        preview(&mut tx, tenant, actor, &reply, &positions)
            .await
            .unwrap(),
        1
    );
    let positions = HashMap::from([(channel.clone(), 100), (format!("thread:{root}"), 110)]);
    assert_eq!(
        preview(&mut tx, tenant, actor, &reply, &positions)
            .await
            .unwrap(),
        0
    );
    let positions = HashMap::from([(channel.clone(), 110)]);
    record(&mut tx, tenant, actor, &reply, &positions)
        .await
        .unwrap();
    assert!(events(&mut tx, tenant, actor).await.unwrap().is_empty());

    // Exercise the actual retention SQL, including >100 same-context messages and the cap.
    sqlx::query("insert into projection.push_unread(tenant_id,tenant_principal_id,event_id,context_key,channel_id,created_at)
        select $1,$2,lpad(to_hex(n),64,'0'),$3,$3,200 from generate_series(1000,2000) n")
        .bind(tenant).bind(actor).bind(&channel).execute(&mut *tx).await.unwrap();
    let latest = message(3000, 201, &channel, None);
    record(&mut tx, tenant, actor, &latest, &marks)
        .await
        .unwrap();
    assert_eq!(events(&mut tx, tenant, actor).await.unwrap().len(), 999);
    assert_eq!(
        preview(&mut tx, tenant, actor, &latest, &marks)
            .await
            .unwrap(),
        999
    );
    let positions = HashMap::from([(channel.clone(), 200)]);
    assert_eq!(
        preview(&mut tx, tenant, actor, &latest, &positions)
            .await
            .unwrap(),
        1
    );
    // Reading this channel cannot discard accepted unread messages in another context.
    let other_channel = Uuid::new_v4().to_string();
    let older = message(4000, 50, &other_channel, None);
    record(&mut tx, tenant, actor, &older, &positions)
        .await
        .unwrap();
    assert_eq!(
        preview(&mut tx, tenant, actor, &latest, &positions)
            .await
            .unwrap(),
        2
    );
    tx.rollback().await.unwrap();
}
