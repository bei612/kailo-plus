//! DD-165(5): the release aligns the platform meters, features and default
//! quotas after Core is replaced and ready and before any other service; the
//! release verify stage reads them back. Both run inside the Core container
//! (`platform-core align-metering` / `platform-core verify-metering`), with the
//! same environment and the same intent paths as the DD-123(3) bootstrap.
//!
//! Alignment is idempotent: missing meters and features are registered, each
//! Tenant whose OpenMeter Customer is ACTIVE gets its missing default
//! entitlements, and anything that already exists is only compared, never
//! rewritten (an admin's limit stays). Any open gap is a non-zero exit with
//! the gaps listed, so the release stops before replacing the next service.
//! The output carries counts and gap descriptions (keys, Tenant IDs) only.

use serde::Serialize;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use uuid::Uuid;

use crate::openmeter::{NativeEntitlement, OpenMeter};
use crate::tenant_quota::{
    feature_registration, meter_registration, Registration, PLATFORM_FEATURES, PLATFORM_METERS,
};

#[derive(Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub mode: &'static str,
    pub meters: usize,
    pub features: usize,
    pub tenants: usize,
    pub entitlements: usize,
    pub problems: Vec<String>,
}

fn env(key: &str) -> Result<String, String> {
    std::env::var(key)
        .ok()
        .filter(|v| !v.is_empty())
        .ok_or_else(|| format!("缺少 {key}"))
}

/// `align-metering` (apply = true) or `verify-metering` (read only).
pub async fn run(apply: bool) -> Result<Report, String> {
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&env("DATABASE_URL")?)
        .await
        .map_err(|e| format!("连 Core 库: {e}"))?;
    let openmeter = OpenMeter::from_env()?;
    let catalog: Uuid = sqlx::query_scalar("select id from identity.tenant where slug = $1")
        .bind(env("PLATFORM_CATALOG_TENANT_SLUG")?)
        .fetch_optional(&pool)
        .await
        .map_err(|e| e.to_string())?
        .ok_or("Catalog Tenant 不存在：Core 尚未完成平台引导")?;
    let tenants = customer_tenants(&pool, &openmeter, catalog).await?;
    let mut report = Report {
        mode: if apply { "ALIGN" } else { "VERIFY" },
        ..Report::default()
    };
    if apply {
        let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
        let initiator = crate::tenant_bootstrap::deployment_principal(&mut tx, catalog).await?;
        tx.commit().await.map_err(|e| e.to_string())?;
        if let Err(error) =
            crate::tenant_quota::ensure_platform_meters(&pool, &openmeter, catalog, initiator).await
        {
            report.problems.push(error);
        }
        for (tenant, _) in &tenants {
            if let Err(error) =
                crate::tenant_quota::ensure_default_quotas(&pool, &openmeter, *tenant, initiator)
                    .await
            {
                report.problems.push(format!("Tenant {tenant}: {error}"));
            }
        }
    }
    // Both modes end with the same read-back: alignment is only done when
    // every object reads back as expected.
    readback(&openmeter, &tenants, &mut report).await;
    Ok(report)
}

/// Business Tenants (not the Catalog) whose one Customer is ACTIVE in this
/// namespace — the same judgement as the CHECK admission.
async fn customer_tenants(
    pool: &PgPool,
    openmeter: &OpenMeter,
    catalog: Uuid,
) -> Result<Vec<(Uuid, String)>, String> {
    sqlx::query_as(
        "select o.tenant_id, o.customer_id from projection.openmeter_binding o
         join identity.tenant t on t.id = o.tenant_id and t.state = 'ACTIVE'
         where o.status = 'ACTIVE' and o.namespace = $1 and o.version > 0
           and o.subject_key_prefix = o.tenant_id::text || ':' and o.tenant_id <> $2
         order by o.tenant_id",
    )
    .bind(openmeter.namespace())
    .bind(catalog)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())
}

async fn readback(openmeter: &OpenMeter, tenants: &[(Uuid, String)], report: &mut Report) {
    let live = match openmeter.live_meters().await {
        Ok(live) => live,
        Err(error) => {
            report
                .problems
                .push(format!("OpenMeter meter 不可读: {error}"));
            return;
        }
    };
    let mut meter_ids = std::collections::BTreeMap::new();
    for meter in &PLATFORM_METERS {
        match meter_registration(&live, meter) {
            Registration::Registered(id) => {
                report.meters += 1;
                meter_ids.insert(meter.key, id);
            }
            Registration::Absent => report.problems.push(format!("meter {} 未登记", meter.key)),
            Registration::Conflict(reason) => report
                .problems
                .push(format!("meter {}: {reason}", meter.key)),
        }
    }
    for feature in &PLATFORM_FEATURES {
        let Some(meter_id) = meter_ids.get(feature.meter) else {
            report
                .problems
                .push(format!("feature {} 的 meter 未登记", feature.key));
            continue;
        };
        match openmeter.live_features(feature.key).await {
            Ok(live) => match feature_registration(&live, meter_id) {
                Registration::Registered(_) => report.features += 1,
                Registration::Absent => report
                    .problems
                    .push(format!("feature {} 未登记", feature.key)),
                Registration::Conflict(reason) => report
                    .problems
                    .push(format!("feature {}: {reason}", feature.key)),
            },
            Err(error) => report
                .problems
                .push(format!("feature {} 不可读: {error}", feature.key)),
        }
    }
    report.tenants = tenants.len();
    for (tenant, customer) in tenants {
        for feature in &PLATFORM_FEATURES {
            match openmeter.entitlement(customer, feature.key).await {
                Ok(Some(entitlement)) if hard_and_live(&entitlement) => report.entitlements += 1,
                Ok(Some(_)) => report.problems.push(format!(
                    "Tenant {tenant} 额度项 {} 不是未删除的硬限制",
                    feature.key
                )),
                Ok(None) => report
                    .problems
                    .push(format!("Tenant {tenant} 缺额度项 {}", feature.key)),
                Err(error) => report.problems.push(format!(
                    "Tenant {tenant} 额度项 {} 不可读: {error}",
                    feature.key
                )),
            }
        }
    }
}

pub(crate) fn hard_and_live(entitlement: &NativeEntitlement) -> bool {
    entitlement.kind == "metered"
        && entitlement.deleted_at.is_none()
        && entitlement.is_soft_limit == Some(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entitlement(kind: &str, soft: Option<bool>, deleted: bool) -> NativeEntitlement {
        NativeEntitlement {
            id: "01ARZ3NDEKTSV4RRFFQ69G5FAV".into(),
            kind: kind.into(),
            feature_key: "knowledge_answers".into(),
            customer_id: None,
            is_soft_limit: soft,
            issue: None,
            issue_after_reset: None,
            usage_period: None,
            current_usage_period: None,
            metadata: None,
            deleted_at: deleted.then(chrono::Utc::now),
        }
    }

    #[test]
    fn only_live_hard_metered_entitlements_count_as_aligned() {
        assert!(hard_and_live(&entitlement("metered", Some(false), false)));
        assert!(!hard_and_live(&entitlement("metered", Some(true), false)));
        assert!(!hard_and_live(&entitlement("metered", None, false)));
        assert!(!hard_and_live(&entitlement("metered", Some(false), true)));
        assert!(!hard_and_live(&entitlement("static", Some(false), false)));
    }

    #[test]
    fn report_is_counts_and_gaps_only() {
        let report = Report {
            mode: "VERIFY",
            meters: 9,
            features: 7,
            tenants: 1,
            entitlements: 6,
            problems: vec!["Tenant t 缺额度项 file_storage".into()],
        };
        let value = serde_json::to_value(&report).unwrap_or_default();
        let mut keys: Vec<&str> = value
            .as_object()
            .map(|o| o.keys().map(String::as_str).collect())
            .unwrap_or_default();
        keys.sort_unstable();
        assert_eq!(
            keys,
            vec![
                "entitlements",
                "features",
                "meters",
                "mode",
                "problems",
                "tenants"
            ]
        );
    }
}
