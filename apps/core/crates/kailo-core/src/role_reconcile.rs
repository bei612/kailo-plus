//! 角色 relationship 与成员事实的对账（DD-82、`.design/10` §1 §4）。
//!
//! 角色的唯一事实在 SpiceDB，成员的唯一事实在 Core。二者的约束是：角色只能落在
//! 本 Tenant 仍是成员（`ACTIVE`，或撤权收敛中的 `REVOKING`）的 HUMAN 身上。主路径
//! 保证这一点——授予要求 `ACTIVE` 成员，Tenant 撤权撤掉全部关系后才 `REVOKED`；本
//! 作业只收拾主路径之外留下的：Workflow 被人为终止、关系被旁路写入、跨 Tenant 的
//! 错写。以 Core 的成员事实为准删除它们，只收紧不放宽（`.design/09` §4）。
//!
//! 它还度量一件修不了的事：有效 Tenant admin 为空的 Tenant。平台内无人能恢复它
//! （DD-82），唯一出路是部署引导的 0→1；度量让它在被人撞上之前先被看见。

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use opentelemetry::metrics::{Counter, Gauge, Meter};
use opentelemetry::KeyValue;
use serde_json::json;
use uuid::Uuid;

use crate::audit::{append, AuditEntry};
use crate::governance::Governance;
use crate::spicedb::{Relationship, RelationshipFilter, Write};

pub struct Config {
    pub interval: Duration,
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let secs = std::env::var("ROLE_RECONCILE_INTERVAL_SECONDS")
            .map_err(|_| "缺少 ROLE_RECONCILE_INTERVAL_SECONDS")?
            .parse::<u64>()
            .ok()
            .filter(|n| *n > 0)
            .ok_or("ROLE_RECONCILE_INTERVAL_SECONDS 必须是正整数")?;
        Ok(Self {
            interval: Duration::from_secs(secs),
        })
    }
}

struct Metrics {
    removed: Counter<u64>,
    headless: Gauge<u64>,
    passes: Counter<u64>,
}

pub fn spawn(g: Arc<Governance>, meter: &Meter, cfg: Config) {
    let metrics = Metrics {
        removed: meter
            .u64_counter("kailo.role_reconcile.removed")
            .with_description("按成员事实删除的残留角色 relationship")
            .build(),
        headless: meter
            .u64_gauge("kailo.tenant.without_effective_admin")
            .with_description("有效 Tenant admin 为空的 ACTIVE Tenant 数（DD-82）")
            .build(),
        passes: meter
            .u64_counter("kailo.role_reconcile.passes")
            .with_description("角色对账轮次，按是否完成区分")
            .build(),
    };
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(cfg.interval);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tick.tick().await;
            let outcome = match pass(&g, &metrics).await {
                Ok(()) => "COMPLETED",
                Err(e) => {
                    tracing::warn!(error = %e, "角色对账本轮未完成");
                    "FAILED"
                }
            };
            metrics.passes.add(1, &[KeyValue::new("outcome", outcome)]);
        }
    });
}

/// 一条角色关系的主体在 Core 里的事实。
#[derive(sqlx::FromRow)]
struct Subject {
    tenant_id: Uuid,
    kind: String,
    membership: Option<String>,
}

async fn pass(g: &Governance, metrics: &Metrics) -> Result<(), String> {
    // 只看 RoleTemplate 展开得出的 relation：member 由成员生命周期自己对账
    let templates: Vec<(String, Vec<String>)> = sqlx::query_as(
        "select object_type, relations from catalog.role_template where status = 'ACTIVE'",
    )
    .fetch_all(&g.pool)
    .await
    .map_err(|e| e.to_string())?;
    let mut rels: Vec<Relationship> = vec![];
    for (object_type, relations) in &templates {
        for relation in relations {
            rels.extend(
                g.spicedb
                    .read(
                        &RelationshipFilter {
                            object_type,
                            object_id: None,
                            relation: Some(relation),
                            subject_principal: None,
                        },
                        g.cfg.relationship_page,
                    )
                    .await
                    .map_err(|e| e.to_string())?,
            );
        }
    }

    let mut subjects: HashMap<Uuid, Option<Subject>> = HashMap::new();
    for rel in rels {
        let Ok(principal) = Uuid::parse_str(&rel.subject_principal) else {
            continue;
        };
        if let std::collections::hash_map::Entry::Vacant(slot) = subjects.entry(principal) {
            let s: Option<Subject> = sqlx::query_as(
                "select p.tenant_id, p.kind, tm.state as membership
                 from identity.principal p
                 left join identity.tenant_membership tm on tm.tenant_principal_id = p.id
                 where p.id = $1",
            )
            .bind(principal)
            .fetch_optional(&g.pool)
            .await
            .map_err(|e| e.to_string())?;
            slot.insert(s);
        }
        let s = subjects.get(&principal).and_then(Option::as_ref);
        // 关系对象所属的 Tenant：tenant 就是它自己，workspace 查其归属
        let object_tenant: Option<Uuid> = match rel.object_type.as_str() {
            "tenant" => Uuid::parse_str(&rel.object_id).ok(),
            _ => match Uuid::parse_str(&rel.object_id) {
                Ok(ws) => {
                    sqlx::query_scalar("select tenant_id from identity.workspace where id = $1")
                        .bind(ws)
                        .fetch_optional(&g.pool)
                        .await
                        .map_err(|e| e.to_string())?
                }
                Err(_) => None,
            },
        };
        let keep = match (s, object_tenant) {
            (Some(s), Some(t)) => {
                s.tenant_id == t
                    && s.kind == "HUMAN"
                    && matches!(s.membership.as_deref(), Some("ACTIVE" | "REVOKING"))
            }
            _ => false,
        };
        if keep {
            continue;
        }
        remove(g, &rel, s.map(|s| s.tenant_id).or(object_tenant)).await?;
        metrics
            .removed
            .add(1, &[KeyValue::new("entity", rel.object_type.clone())]);
    }

    let tenants: Vec<Uuid> = sqlx::query_scalar(
        "select t.id from identity.tenant t
         where t.state = 'ACTIVE'
           and not exists (select 1 from identity.relay_operator_identity o where o.catalog_tenant_id = t.id)",
    )
    .fetch_all(&g.pool)
    .await
    .map_err(|e| e.to_string())?;
    let mut headless = 0u64;
    let mut conn = g.pool.acquire().await.map_err(|e| e.to_string())?;
    for t in tenants {
        let effective = crate::roles::effective_tenant_admins(
            &mut conn,
            &g.spicedb,
            t,
            g.cfg.relationship_page,
        )
        .await
        .map_err(|e| format!("{e:?}"))?;
        if effective.is_empty() {
            headless += 1;
            tracing::warn!(tenant = %t, "Tenant 没有有效 admin：平台内不可恢复，需部署引导 0→1（DD-82）");
        }
    }
    metrics.headless.record(headless, &[]);
    Ok(())
}

/// 删一条残留的角色关系并留 RECONCILIATION 审计。删除先于审计：审计写不进去时
/// 关系已收紧，下一轮读不到它也就不会重复审计；反过来先审计后删，删失败就留下
/// 一条「已删除」的假记录。
async fn remove(g: &Governance, rel: &Relationship, tenant: Option<Uuid>) -> Result<(), String> {
    let token = g
        .spicedb
        .write(&[(Write::Delete, rel.clone())])
        .await
        .map_err(|e| e.to_string())?;
    let value = format!(
        "{}:{}#{}@principal:{}",
        rel.object_type, rel.object_id, rel.relation, rel.subject_principal
    );
    tracing::warn!(relationship = %value, "删除了与成员事实不符的角色关系");
    let Some(tenant) = tenant else {
        // 主体与对象在 Core 里都已不存在：没有可归属的 Tenant，审计按 03 §9 不能写
        // 无 Tenant 的业务事件，只留日志
        return Ok(());
    };
    let operation = Uuid::new_v5(
        &Uuid::NAMESPACE_URL,
        format!("urn:kailo:role-reconcile:{value}:{token}").as_bytes(),
    );
    let mut tx = g.pool.begin().await.map_err(|e| e.to_string())?;
    append(
        &mut tx,
        AuditEntry {
            event_key: format!("{operation}:role-reconcile"),
            tenant_id: Some(tenant),
            workspace_id: None,
            operation_id: operation,
            event_type: "RECONCILIATION",
            human_identity_id: None,
            initiator_principal_id: None,
            actor_principal_id: None,
            action_key: "role.reconcile",
            action_version: 1,
            component_type_key: "core",
            target_type: Some("SPICEDB_RELATIONSHIP"),
            target_id: Uuid::parse_str(&rel.subject_principal).ok(),
            parameter_hash: &value,
            decision: "DENY",
            result_code: "ROLE_REMOVED",
            result_exposure: "NONE",
            evidence_refs: json!([
                { "kind": "SPICEDB_RELATIONSHIP", "value": value },
                { "kind": "SPICEDB_ZEDTOKEN", "value": token },
            ]),
            correlation_id: operation,
        },
    )
    .await
    .map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())
}
