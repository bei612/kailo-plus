use super::*;
use axum::extract::{Path, Query};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PageQuery {
    offset: Option<i64>,
    state: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Triage {
    state: String,
    version: i32,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AttachmentQuery {
    encoding: Option<String>,
}

async fn operator(
    state: &BffState,
    ctx: &ExecutionContext,
    tx: &mut Transaction<'_, Postgres>,
) -> Result<(), Response> {
    eligible(tx, ctx).await?;
    if !crate::platform_bootstrap::is_catalog_tenant(tx, ctx.tenant_id)
        .await
        .map_err(|_| unavailable())?
    {
        return Err(StatusCode::FORBIDDEN.into_response());
    }
    let checked = state
        .governance
        .spicedb
        .check(
            "tenant",
            &ctx.tenant_id.to_string(),
            "manage",
            &ctx.tenant_principal_id.to_string(),
            crate::spicedb::Consistency::FullyConsistent,
        )
        .await
        .map_err(|_| unavailable())?;
    if checked.zed_token.is_empty() {
        return Err(unavailable());
    }
    if !checked.allowed {
        return Err(StatusCode::FORBIDDEN.into_response());
    }
    Ok(())
}

#[derive(sqlx::FromRow)]
struct Row {
    id: Uuid,
    tenant_id: Uuid,
    tenant_name: String,
    client: String,
    category: Option<String>,
    message: String,
    diagnostics: Option<String>,
    attachment_mime: Option<String>,
    attachment_sha256: Option<String>,
    byte_size: Option<i32>,
    state: String,
    version: i32,
    created_at: DateTime<Utc>,
}

pub async fn list(
    State(state): State<BffState>,
    headers: HeaderMap,
    query: Result<Query<PageQuery>, axum::extract::rejection::QueryRejection>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    let Ok(Query(query)) = query else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    if query.offset.is_some_and(|n| n < 0)
        || !matches!(
            query.state.as_deref(),
            None | Some("NEW" | "TRIAGED" | "CLOSED")
        )
    {
        return StatusCode::BAD_REQUEST.into_response();
    }
    match list_inner(&state, &ctx, query).await {
        Ok(r) | Err(r) => r,
    }
}
async fn list_inner(
    state: &BffState,
    ctx: &ExecutionContext,
    query: PageQuery,
) -> Result<Response, Response> {
    let mut tx = state.pool.begin().await.map_err(|_| unavailable())?;
    operator(state, ctx, &mut tx).await?;
    let offset = query.offset.unwrap_or(0);
    let mut rows: Vec<Row> = sqlx::query_as("select f.id,f.tenant_id,t.name as tenant_name,f.client,f.category,
        f.message,f.diagnostics,f.attachment_mime,f.attachment_sha256,octet_length(f.attachment) as byte_size,
        f.state,f.version,f.created_at from support.feedback_submission f join identity.tenant t on t.id=f.tenant_id
        where ($1::text is null or f.state=$1) order by f.created_at desc,f.id desc limit 26 offset $2")
        .bind(query.state).bind(offset).fetch_all(&mut *tx).await.map_err(|_| unavailable())?;
    let more = rows.len() > 25;
    rows.truncate(25);
    let operation = Uuid::new_v4();
    let mut items = Vec::new();
    for row in rows {
        audit(
            &mut tx,
            ctx,
            row.id,
            operation,
            "feedback.read",
            Metadata {
                client: &row.client,
                category: row.category.as_deref(),
                diagnostics: row.diagnostics.is_some(),
                attachment: row.attachment_mime.is_some(),
            },
        )
        .await
        .map_err(|_| unavailable())?;
        let mut item = json!({"feedbackId":row.id,"tenantId":row.tenant_id,"tenantName":row.tenant_name,
            "client":row.client,"message":row.message,"state":row.state,"version":row.version,"createdAt":row.created_at});
        if let Some(category) = row.category {
            item["category"] = category.into();
        }
        if let Some(diagnostics) = row.diagnostics {
            item["diagnostics"] = diagnostics.into();
        }
        if let (Some(mime), Some(sha), Some(size)) =
            (row.attachment_mime, row.attachment_sha256, row.byte_size)
        {
            item["attachment"] = json!({"mimeType":mime,"sha256":sha,"byteSize":size});
        }
        items.push(item);
    }
    tx.commit().await.map_err(|_| unavailable())?;
    let mut page = json!({"items":items});
    if more {
        page["nextOffset"] = offset
            .checked_add(25)
            .ok_or_else(|| StatusCode::BAD_REQUEST.into_response())?
            .into();
    }
    Ok(([("cache-control", "no-store")], Json(page)).into_response())
}

pub async fn attachment(
    State(state): State<BffState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    query: Result<Query<AttachmentQuery>, axum::extract::rejection::QueryRejection>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    let Ok(Query(query)) = query else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    if !matches!(query.encoding.as_deref(), None | Some("base64")) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    match attachment_inner(&state, &ctx, id, query.encoding.is_some()).await {
        Ok(r) | Err(r) => r,
    }
}
#[derive(sqlx::FromRow)]
struct AttachmentRow {
    bytes: Vec<u8>,
    mime: String,
    client: String,
    category: Option<String>,
    diagnostics: bool,
    sha256: String,
}

async fn attachment_inner(
    state: &BffState,
    ctx: &ExecutionContext,
    id: Uuid,
    encoded: bool,
) -> Result<Response, Response> {
    let mut tx = state.pool.begin().await.map_err(|_| unavailable())?;
    operator(state, ctx, &mut tx).await?;
    let row: Option<AttachmentRow> = sqlx::query_as(
        "select attachment as bytes,attachment_mime as mime,client,category,diagnostics is not null as diagnostics,attachment_sha256 as sha256 from support.feedback_submission where id=$1 and attachment is not null")
        .bind(id).fetch_optional(&mut *tx).await.map_err(|_| unavailable())?;
    let Some(AttachmentRow {
        bytes,
        mime,
        client,
        category,
        diagnostics,
        sha256,
    }) = row
    else {
        return Err(StatusCode::NOT_FOUND.into_response());
    };
    audit(
        &mut tx,
        ctx,
        id,
        Uuid::new_v4(),
        "feedback.attachment.read",
        Metadata {
            client: &client,
            category: category.as_deref(),
            diagnostics,
            attachment: true,
        },
    )
    .await
    .map_err(|_| unavailable())?;
    tx.commit().await.map_err(|_| unavailable())?;
    if encoded {
        use base64::Engine;
        return Ok(([("x-content-type-options","nosniff"),("cache-control","no-store")],Json(json!({"mimeType":mime,"sha256":sha256,"dataBase64":base64::engine::general_purpose::STANDARD.encode(bytes)}))).into_response());
    }
    Ok((
        [
            ("content-type", mime.as_str()),
            ("x-content-type-options", "nosniff"),
            ("cache-control", "no-store"),
        ],
        bytes,
    )
        .into_response())
}

pub async fn triage(
    State(state): State<BffState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    body: Result<Json<Triage>, JsonRejection>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    let Ok(Json(body)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    if body.version < 1 || !matches!(body.state.as_str(), "TRIAGED" | "CLOSED") {
        return StatusCode::BAD_REQUEST.into_response();
    }
    match triage_inner(&state, &ctx, id, body).await {
        Ok(r) | Err(r) => r,
    }
}
async fn triage_inner(
    state: &BffState,
    ctx: &ExecutionContext,
    id: Uuid,
    body: Triage,
) -> Result<Response, Response> {
    let mut tx = state.pool.begin().await.map_err(|_| unavailable())?;
    operator(state, ctx, &mut tx).await?;
    let row: Option<(String, Option<String>, bool, bool, i32)> = sqlx::query_as(
        "update support.feedback_submission set state=$2,version=version+1,updated_at=now() where id=$1 and version=$3
         and ((state='NEW' and $2='TRIAGED') or (state='TRIAGED' and $2='CLOSED'))
         returning client,category,diagnostics is not null,attachment is not null,version")
        .bind(id).bind(&body.state).bind(body.version).fetch_optional(&mut *tx).await.map_err(|_| unavailable())?;
    let Some((client, category, diagnostics, attachment, version)) = row else {
        return Err(StatusCode::CONFLICT.into_response());
    };
    audit(
        &mut tx,
        ctx,
        id,
        Uuid::new_v4(),
        "feedback.triage",
        Metadata {
            client: &client,
            category: category.as_deref(),
            diagnostics,
            attachment,
        },
    )
    .await
    .map_err(|_| unavailable())?;
    tx.commit().await.map_err(|_| unavailable())?;
    Ok((
        [("cache-control", "no-store")],
        Json(json!({"feedbackId":id,"state":body.state,"version":version})),
    )
        .into_response())
}
