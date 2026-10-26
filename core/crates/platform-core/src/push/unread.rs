//! DD-151(4): accepted push messages, never a second read authority.

use std::collections::HashMap;

use sqlx::PgConnection;
use uuid::Uuid;

use super::decide::{self, MessageFacts, UnreadContext};

type EventRow = (String, String, String, i64);

async fn events(conn: &mut PgConnection, tenant: Uuid, principal: Uuid) -> Result<Vec<EventRow>, sqlx::Error> {
    sqlx::query_as(
        "select event_id, context_key, channel_id, created_at from projection.push_unread
          where tenant_id = $1 and tenant_principal_id = $2",
    )
    .bind(tenant)
    .bind(principal)
    .fetch_all(conn)
    .await
}

fn contexts(events: Vec<EventRow>) -> Vec<UnreadContext> {
    let mut grouped: HashMap<(String, String), Vec<i64>> = HashMap::new();
    for (_, context, channel, at) in events {
        grouped.entry((context, channel)).or_default().push(at);
    }
    grouped.into_iter().map(|((context_key, channel_id), event_times)| UnreadContext {
        context_key, channel_id, event_times,
    }).collect()
}

/// Read-only prospective payload count. Preparing or failing a send never records a push.
pub(super) async fn preview(
    conn: &mut PgConnection,
    tenant: Uuid,
    principal: Uuid,
    message: &MessageFacts,
    marks: &HashMap<String, i64>,
) -> Result<u32, sqlx::Error> {
    let mut rows = events(conn, tenant, principal).await?;
    if !rows.iter().any(|(id, _, _, _)| id == &message.id) {
        rows.push((message.id.clone(), decide::unread_context(message), message.channel_id.clone(), message.created_at as i64));
    }
    Ok(decide::badge(&contexts(rows), marks).0)
}

/// Persist a known provider acceptance in a short transaction, outside external HTTP calls.
/// The event primary key deduplicates repeated delivery and multiple recipient devices.
pub(super) async fn record(
    conn: &mut PgConnection,
    tenant: Uuid,
    principal: Uuid,
    message: &MessageFacts,
    marks: &HashMap<String, i64>,
) -> Result<(), sqlx::Error> {
    let context = decide::unread_context(message);
    sqlx::query(
        "insert into projection.push_unread
             (tenant_id, tenant_principal_id, event_id, context_key, channel_id, created_at)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (tenant_id, tenant_principal_id, event_id) do nothing",
    )
    .bind(tenant)
    .bind(principal)
    .bind(&message.id)
    .bind(&context)
    .bind(message.channel_id.to_ascii_lowercase())
    .bind(message.created_at as i64)
    .execute(&mut *conn)
    .await?;
    // Bound each read context independently. Global truncation would lose older unread
    // messages in channel A when a user reads only the newer messages in channel B.
    sqlx::query(
        "delete from projection.push_unread where tenant_id = $1 and tenant_principal_id = $2
           and event_id in (select event_id from projection.push_unread
             where tenant_id = $1 and tenant_principal_id = $2 and context_key = $3
             order by created_at desc, event_id desc offset $4)",
    )
    .bind(tenant)
    .bind(principal)
    .bind(context)
    .bind(decide::BADGE_EVENTS_PER_CONTEXT)
    .execute(&mut *conn)
    .await?;
    let (_, read) = decide::badge(&contexts(events(conn, tenant, principal).await?), marks);
    if !read.is_empty() {
        sqlx::query(
            "delete from projection.push_unread
              where tenant_id = $1 and tenant_principal_id = $2 and context_key = any($3)",
        )
        .bind(tenant)
        .bind(principal)
        .bind(read)
        .execute(conn)
        .await?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "unread_tests.rs"]
mod tests;
