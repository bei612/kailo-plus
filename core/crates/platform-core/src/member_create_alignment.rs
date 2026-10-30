//! DD-164(3): release alignment of the Tenant member create policy. The
//! release runs `platform-core align-member-create` inside the Core container
//! after Core is replaced and ready; the verify stage runs
//! `platform-core verify-member-create` (read only).
//!
//! For every ACTIVE business Tenant whose `member_create_policy` is
//! MEMBERS_CREATE, alignment writes only the missing `tenant#creator`
//! relationships of its ACTIVE HUMAN members (never deletes; tightening is the
//! governed `tenant.member_create_policy.set`), then reads them back; each
//! Tenant that needed writes gets one RECONCILIATION audit event. Any gap is a
//! non-zero exit listing Tenant IDs only. A missing `creator` in production is
//! never taken as "members are read-only".

use serde::Serialize;
use sqlx::postgres::PgPoolOptions;
use uuid::Uuid;

use crate::governance::tenant_member_policy::{active_members, converge, creators, MEMBERS_CREATE};
use crate::spicedb::SpiceDb;

#[derive(Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub mode: &'static str,
    pub tenants: usize,
    pub members: usize,
    pub written: usize,
    pub problems: Vec<String>,
}

fn env(key: &str) -> Result<String, String> {
    std::env::var(key)
        .ok()
        .filter(|v| !v.is_empty())
        .ok_or_else(|| format!("缺少 {key}"))
}

/// `align-member-create` (apply = true) or `verify-member-create` (read only).
pub async fn run(apply: bool) -> Result<Report, String> {
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&env("DATABASE_URL")?)
        .await
        .map_err(|e| format!("连 Core 库: {e}"))?;
    let spicedb = SpiceDb::from_env(reqwest::Client::new())?;
    let page = u32::try_from(
        env("SPICEDB_READ_PAGE_LIMIT")?
            .parse::<i64>()
            .map_err(|_| "SPICEDB_READ_PAGE_LIMIT 不是整数".to_owned())?,
    )
    .map_err(|_| "SPICEDB_READ_PAGE_LIMIT 越界".to_owned())?;
    let catalog_slug = env("PLATFORM_CATALOG_TENANT_SLUG")?;
    let tenants: Vec<Uuid> = sqlx::query_scalar(
        "select id from identity.tenant where state='ACTIVE' and member_create_policy=$1 and slug<>$2 order by id",
    )
    .bind(MEMBERS_CREATE)
    .bind(&catalog_slug)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;
    let mut report = Report {
        mode: if apply { "ALIGN" } else { "VERIFY" },
        tenants: tenants.len(),
        ..Report::default()
    };
    for tenant in tenants {
        let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
        let members = active_members(&mut conn, tenant)
            .await
            .map_err(|e| e.to_string())?;
        drop(conn);
        report.members += members.len();
        if apply {
            match converge(&spicedb, page, tenant, &members, true, true).await {
                Ok(done) => {
                    report.written += done.touched;
                    if done.touched > 0 {
                        if let Err(error) =
                            record(&pool, tenant, done.touched, done.token.as_deref()).await
                        {
                            report
                                .problems
                                .push(format!("Tenant {tenant}: 审计未写入 {error}"));
                        }
                    }
                }
                Err(error) => report.problems.push(format!("Tenant {tenant}: {error}")),
            }
        } else {
            match creators(&spicedb, tenant, page).await {
                Ok(held) => {
                    let missing = members.iter().filter(|m| !held.contains(m)).count();
                    if missing > 0 {
                        report.problems.push(format!(
                            "Tenant {tenant}: {missing} 个成员缺 tenant#creator"
                        ));
                    }
                }
                Err(error) => report.problems.push(format!("Tenant {tenant}: {error}")),
            }
        }
    }
    Ok(report)
}

/// One RECONCILIATION audit event per Tenant and revision that needed writes.
async fn record(
    pool: &sqlx::PgPool,
    tenant: Uuid,
    touched: usize,
    token: Option<&str>,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    let operation = Uuid::new_v4();
    let mut evidence = vec![crate::audit::Evidence::new(
        contracts::EvidenceKind::SpicedbRelationship,
        format!("tenant:{tenant}#creator touched={touched}"),
    )];
    if let Some(token) = token {
        evidence.push(crate::audit::Evidence::new(
            contracts::EvidenceKind::SpicedbZedtoken,
            token,
        ));
    }
    crate::audit::append(
        &mut tx,
        crate::audit::AuditEntry {
            event_key: format!("member-create-align:{tenant}:{}", token.unwrap_or("none")),
            tenant_id: Some(tenant),
            workspace_id: None,
            operation_id: operation,
            event_type: "RECONCILIATION",
            human_identity_id: None,
            initiator_principal_id: None,
            actor_principal_id: None,
            action_key: "tenant.member_create.align",
            action_version: 1,
            component_type_key: "core",
            target_type: Some("TENANT"),
            target_id: Some(tenant),
            parameter_hash: MEMBERS_CREATE,
            decision: "ALLOW",
            result_code: "TENANT_CREATOR_ALIGNED",
            result_exposure: "NONE",
            evidence_refs: evidence,
            correlation_id: operation,
        },
    )
    .await?;
    tx.commit().await
}
