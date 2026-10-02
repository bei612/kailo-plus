//! 03 §8、11 §2：唯一 Core PLATFORM_SLOT 投影。Temporal heartbeat/Activity
//! terminal 是持有权威；到期或失联不归还 units，原生 turn 终态也不替代 Activity。

use chrono::{DateTime, TimeDelta, Utc};
use opentelemetry::{metrics::Gauge, KeyValue};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::{
    agent_runtime::{RuntimeRef, Supervisor},
    temporal::{ActivityObservation, ActivityState, TemporalClient},
};

pub(crate) struct Capacity {
    pool_key: String,
    pool_units: i64,
    invocation_units: i64,
    lease_seconds: i64,
    heartbeat_timeout_seconds: i64,
    occupied_units: Gauge<u64>,
    unknown_leases: Gauge<u64>,
    oldest_unknown_seconds: Gauge<u64>,
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum CapacityError {
    #[error("Capacity authority unavailable")]
    Unknown,
    #[error("Capacity configuration or frozen scope rejected")]
    Rejected,
    #[error("Capacity pool exhausted")]
    Exhausted,
    #[error("Capacity persistence unavailable: {0}")]
    Database(#[from] sqlx::Error),
}

pub(crate) struct Observation {
    pub lease_id: Uuid,
    /// false 只允许既有 native 的观察/interrupt，绝不允许新的 turn/start。
    pub held: bool,
    pub released: bool,
    pub workflow_cancel_requested: bool,
}

#[derive(FromRow)]
struct Facts {
    operation_id: Uuid,
    tenant_id: Uuid,
    workspace_id: Uuid,
    workflow_id: String,
    projection_generation: i64,
    first_run: Option<String>,
    gate_state: String,
    capacity_policy: String,
    capacity_pool_key: Option<String>,
}

#[derive(FromRow)]
struct Lease {
    id: Uuid,
    invocation_id: Uuid,
    pool_key: String,
    workflow_id: String,
    run_id: Uuid,
    activity_id: String,
    attempt: i32,
    scheduled_event_id: i64,
    units: i64,
    acquired_at: DateTime<Utc>,
    renewed_at: Option<DateTime<Utc>>,
    expires_at: DateTime<Utc>,
    state: String,
    native_release_confirmed_at: Option<DateTime<Utc>>,
}

#[derive(FromRow)]
struct NativeInvocation {
    status: String,
    projection_generation: i64,
    config_hash: String,
    runtime_thread_id: Option<String>,
    runtime_turn_id: Option<String>,
    native_status: Option<String>,
    first_run: Option<String>,
    installation_resource_id: Uuid,
}

const LEASE: &str = "select id,invocation_id,pool_key,workflow_id,run_id,activity_id,attempt,
    scheduled_event_id,units,acquired_at,renewed_at,expires_at,state,native_release_confirmed_at
    from admission.capacity_lease";

impl Capacity {
    pub(crate) fn from_env() -> Result<Self, String> {
        let positive = |key: &str| -> Result<i64, String> {
            std::env::var(key)
                .map_err(|_| format!("缺少 {key}"))?
                .parse::<i64>()
                .ok()
                .filter(|value| *value > 0)
                .ok_or_else(|| format!("{key} 必须是正整数"))
        };
        let pool_key =
            std::env::var("AGENT_CAPACITY_POOL_KEY").map_err(|_| "缺少 AGENT_CAPACITY_POOL_KEY")?;
        if pool_key.trim().is_empty() || pool_key != pool_key.trim() {
            return Err("AGENT_CAPACITY_POOL_KEY 无效".into());
        }
        let meter = opentelemetry::global::meter("platform-core.capacity");
        let config = Self {
            pool_key,
            pool_units: positive("AGENT_CAPACITY_POOL_UNITS")?,
            invocation_units: positive("AGENT_CAPACITY_UNITS_PER_INVOCATION")?,
            lease_seconds: positive("AGENT_CAPACITY_LEASE_SECONDS")?,
            heartbeat_timeout_seconds: positive("WORKER_AGENT_ACTIVITY_HEARTBEAT_TIMEOUT_SECONDS")?,
            occupied_units: meter.u64_gauge("platform.capacity.occupied_units").build(),
            unknown_leases: meter.u64_gauge("platform.capacity.unknown_leases").build(),
            oldest_unknown_seconds: meter
                .u64_gauge("platform.capacity.oldest_unknown_seconds")
                .with_unit("s")
                .build(),
        };
        if config.invocation_units > config.pool_units
            || config.heartbeat_timeout_seconds >= config.lease_seconds
            || TimeDelta::try_seconds(config.lease_seconds).is_none()
        {
            return Err("Capacity units 或 HeartbeatTimeout/lease interval 关系无效".into());
        }
        Ok(config)
    }

    /// 同 Invocation 幂等分配；SDK retry 只更新同 holder 的 attempt，不再占 units。
    /// native 查询只读。所有分配/续期/释放都在同一 pool 行锁之下，跨 Core 不超卖。
    pub(crate) async fn acquire_or_renew(
        &self,
        pool: &PgPool,
        temporal: &TemporalClient,
        invocation: Uuid,
        run_id: &str,
        activity_id: &str,
        attempt: i32,
    ) -> Result<Observation, CapacityError> {
        let run = Uuid::parse_str(run_id).map_err(|_| CapacityError::Rejected)?;
        if activity_id.is_empty() || attempt <= 0 {
            return Err(CapacityError::Rejected);
        }
        let facts: Facts = sqlx::query_as("select a.operation_id,i.tenant_id,i.workspace_id,
            i.workflow_id,i.projection_generation,w.run_id as first_run,a.gate_state,
            d.capacity_policy,d.capacity_pool_key from catalog.agent_invocation i
            join admission.action_execution a on a.id=i.action_execution_id
              and a.tenant_id=i.tenant_id and a.workspace_id=i.workspace_id
            join catalog.action_definition d on d.action_key=a.action_key and d.version=a.action_version
            join projection.workflow_ref w on w.workflow_id=i.workflow_id
              and w.action_execution_id=a.id and w.operation_id=a.operation_id
              and w.tenant_id=i.tenant_id and w.workspace_id=i.workspace_id
              and w.workflow_type='AgentTaskWorkflow' and w.kind is null where i.id=$1")
            .bind(invocation).fetch_optional(pool).await?.ok_or(CapacityError::Rejected)?;
        if facts.capacity_policy != "PLATFORM_SLOT"
            || facts.capacity_pool_key.as_deref() != Some(self.pool_key.as_str())
            || facts.first_run.as_deref().is_none_or(str::is_empty)
        {
            return Err(CapacityError::Rejected);
        }
        let execution = temporal
            .describe(&facts.workflow_id)
            .await
            .map_err(|_| CapacityError::Unknown)?
            .ok_or(CapacityError::Unknown)?;
        if execution.run_id != run_id
            || !matches!(execution.state, crate::temporal::ObservedState::Open)
            || (facts.first_run.as_deref() != Some(execution.first_run_id.as_str())
                && facts.first_run.as_deref() != Some(execution.run_id.as_str()))
        {
            return Err(CapacityError::Rejected);
        }
        let observed = temporal
            .activity(&facts.workflow_id, run_id, activity_id)
            .await
            .map_err(|_| CapacityError::Unknown)?;
        if observed.invocation_id != invocation.to_string()
            || observed.projection_generation != facts.projection_generation
        {
            return Err(CapacityError::Rejected);
        }
        let mut tx = pool.begin().await?;
        sqlx::query("insert into admission.capacity_pool(pool_key,capacity_units) values($1,$2) on conflict do nothing")
            .bind(&self.pool_key).bind(self.pool_units).execute(&mut *tx).await?;
        let accepted_pool_units: i64 = sqlx::query_scalar(
            "select capacity_units from admission.capacity_pool where pool_key=$1 for update",
        )
        .bind(&self.pool_key)
        .fetch_one(&mut *tx)
        .await?;
        let lease: Option<Lease> =
            sqlx::query_as(&format!("{LEASE} where invocation_id=$1 for update"))
                .bind(invocation)
                .fetch_optional(&mut *tx)
                .await?;
        if let Some(lease) = lease {
            if lease.pool_key != self.pool_key
                || lease.units <= 0
                || lease.workflow_id != facts.workflow_id
            {
                return Err(CapacityError::Rejected);
            }
            if lease.state == "RELEASED" {
                tx.commit().await?;
                return Ok(Observation {
                    lease_id: lease.id,
                    held: false,
                    released: true,
                    workflow_cancel_requested: observed.workflow_cancel_requested,
                });
            }
            // 换 Activity/run 不是 retry；旧 holder 的 UNKNOWN 必须独立对账。
            if lease.run_id != run
                || lease.activity_id != activity_id
                || lease.scheduled_event_id != observed.scheduled_event_id
            {
                tx.commit().await?;
                return Ok(Observation {
                    lease_id: lease.id,
                    held: false,
                    released: false,
                    workflow_cancel_requested: observed.workflow_cancel_requested,
                });
            }
            let held = self.renew(&mut tx, &lease, &observed, attempt).await?;
            tx.commit().await?;
            return Ok(Observation {
                lease_id: lease.id,
                held,
                released: false,
                workflow_cancel_requested: observed.workflow_cancel_requested,
            });
        }
        if facts.gate_state != "ALLOWED" {
            return Err(CapacityError::Rejected);
        }
        let ActivityState::Started {
            attempt: native_attempt,
            started_at,
            heartbeat_at,
            heartbeat_timeout_seconds,
        } = observed.state
        else {
            return Err(CapacityError::Unknown);
        };
        if native_attempt != attempt || heartbeat_timeout_seconds != self.heartbeat_timeout_seconds
        {
            return Err(CapacityError::Rejected);
        }
        let heartbeat_at = heartbeat_at.filter(|time| *time >= started_at);
        let base = heartbeat_at.unwrap_or(started_at);
        let expires_at = base
            .checked_add_signed(TimeDelta::seconds(self.lease_seconds))
            .ok_or(CapacityError::Rejected)?;
        let heartbeat_deadline = base
            .checked_add_signed(TimeDelta::seconds(self.heartbeat_timeout_seconds))
            .ok_or(CapacityError::Rejected)?;
        if expires_at <= Utc::now() || heartbeat_deadline <= Utc::now() {
            return Err(CapacityError::Unknown);
        }
        // UNKNOWN/EXPIRED/RELEASING 均继续计入，不以到期回收来制造可用容量。
        let occupied: i64 = sqlx::query_scalar("select coalesce(sum(units),0)::bigint from admission.capacity_lease where pool_key=$1 and state<>'RELEASED'")
            .bind(&self.pool_key).fetch_one(&mut *tx).await?;
        if accepted_pool_units != self.pool_units {
            // 不同 Core 配置不能各按自己的更大池超卖；在途全部释放前拒绝新
            // 分配。空池才接受当前配置投影，不修改原 lease 冻结的 units。
            if occupied != 0 {
                return Err(CapacityError::Rejected);
            }
            sqlx::query("update admission.capacity_pool set capacity_units=$2 where pool_key=$1")
                .bind(&self.pool_key)
                .bind(self.pool_units)
                .execute(&mut *tx)
                .await?;
        }
        if occupied
            .checked_add(self.invocation_units)
            .is_none_or(|total| total > self.pool_units)
        {
            return Err(CapacityError::Exhausted);
        }
        let id = Uuid::new_v4();
        sqlx::query("insert into admission.capacity_lease(id,invocation_id,operation_id,tenant_id,
            workspace_id,pool_key,workflow_id,run_id,activity_id,attempt,scheduled_event_id,units,
            acquired_at,renewed_at,expires_at,state) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'HELD')")
            .bind(id).bind(invocation).bind(facts.operation_id).bind(facts.tenant_id).bind(facts.workspace_id)
            .bind(&self.pool_key).bind(&facts.workflow_id).bind(run).bind(activity_id).bind(attempt)
            .bind(observed.scheduled_event_id).bind(self.invocation_units).bind(started_at)
            .bind(heartbeat_at).bind(expires_at).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(Observation {
            lease_id: id,
            held: true,
            released: false,
            workflow_cancel_requested: observed.workflow_cancel_requested,
        })
    }

    async fn renew(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        lease: &Lease,
        observed: &ActivityObservation,
        attempt: i32,
    ) -> Result<bool, CapacityError> {
        if !matches!(
            lease.state.as_str(),
            "HELD" | "RELEASING" | "UNKNOWN" | "EXPIRED"
        ) {
            return Err(CapacityError::Rejected);
        }
        let ActivityState::Started {
            attempt: native_attempt,
            started_at,
            heartbeat_at,
            heartbeat_timeout_seconds,
        } = &observed.state
        else {
            sqlx::query(
                "update admission.capacity_lease set state='UNKNOWN',updated_at=now() where id=$1",
            )
            .bind(lease.id)
            .execute(&mut **tx)
            .await?;
            return Ok(false);
        };
        if *native_attempt != attempt
            || attempt < lease.attempt
            || *heartbeat_timeout_seconds != self.heartbeat_timeout_seconds
            || *started_at < lease.acquired_at
        {
            return Err(CapacityError::Rejected);
        }
        let heartbeat = heartbeat_at.filter(|time| *time >= *started_at);
        let base = heartbeat.unwrap_or(*started_at);
        let expires = base
            .checked_add_signed(TimeDelta::seconds(self.lease_seconds))
            .ok_or(CapacityError::Rejected)?;
        if heartbeat.is_some_and(|time| lease.renewed_at.is_some_and(|old| time < old)) {
            return Err(CapacityError::Unknown);
        }
        let releasing = lease.native_release_confirmed_at.is_some();
        let heartbeat_deadline = base
            .checked_add_signed(TimeDelta::seconds(self.heartbeat_timeout_seconds))
            .ok_or(CapacityError::Rejected)?;
        let live = expires > Utc::now() && heartbeat_deadline > Utc::now();
        sqlx::query(
            "update admission.capacity_lease set attempt=$2,renewed_at=coalesce($3,renewed_at),
            expires_at=greatest(expires_at,$4),state=$5,updated_at=now() where id=$1",
        )
        .bind(lease.id)
        .bind(attempt)
        .bind(heartbeat)
        .bind(expires)
        .bind(if !live {
            "UNKNOWN"
        } else if releasing {
            "RELEASING"
        } else {
            "HELD"
        })
        .execute(&mut **tx)
        .await?;
        Ok(live && !releasing)
    }

    /// 只由已持久 native terminal 或确定未派发取消事实进入 RELEASING。
    /// Activity 返回以后对账才可释放；本次更新本身不归还任何 units。
    pub(crate) async fn begin_release(
        &self,
        pool: &PgPool,
        invocation: Uuid,
    ) -> Result<bool, CapacityError> {
        let mut tx = pool.begin().await?;
        sqlx::query("select pool_key from admission.capacity_pool where pool_key=$1 for update")
            .bind(&self.pool_key)
            .fetch_optional(&mut *tx)
            .await?;
        let ready: Option<bool> = sqlx::query_scalar(
            "select
            (coalesce(native_status in ('completed','failed','interrupted'),false)
              or (status='CREATED' and cancel_pending and runtime_turn_id is null))
            from catalog.agent_invocation where id=$1 for update",
        )
        .bind(invocation)
        .fetch_optional(&mut *tx)
        .await?;
        if ready != Some(true) {
            return Ok(false);
        }
        let changed = sqlx::query("update admission.capacity_lease set state=case when terminal_event_id is not null then 'RELEASED' else 'RELEASING' end,
            native_release_confirmed_at=coalesce(native_release_confirmed_at,now()),updated_at=now()
            where invocation_id=$1 and pool_key=$2 and state<>'RELEASED'")
            .bind(invocation).bind(&self.pool_key).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(changed.rows_affected() == 1)
    }

    /// 由既有治理对账节拍调用，批次大小使用既有治理配置。没有记录为无适用对象。
    pub(crate) async fn reconcile(
        &self,
        pool: &PgPool,
        temporal: &TemporalClient,
        runtime: Option<&Supervisor>,
        batch: i64,
    ) -> Result<(), CapacityError> {
        if batch <= 0 {
            return Err(CapacityError::Rejected);
        }
        let leases: Vec<Lease> = sqlx::query_as(&format!(
            "{LEASE} where pool_key=$1 and state<>'RELEASED' order by updated_at,id limit $2"
        ))
        .bind(&self.pool_key)
        .bind(batch)
        .fetch_all(pool)
        .await?;
        if leases.is_empty() {
            tracing::debug!("CapacityLease 无适用对象");
        }
        for lease in leases {
            let observed = temporal
                .activity(
                    &lease.workflow_id,
                    &lease.run_id.to_string(),
                    &lease.activity_id,
                )
                .await;
            let mut tx = pool.begin().await?;
            sqlx::query(
                "select pool_key from admission.capacity_pool where pool_key=$1 for update",
            )
            .bind(&self.pool_key)
            .fetch_one(&mut *tx)
            .await?;
            let current: Lease = sqlx::query_as(&format!("{LEASE} where id=$1 for update"))
                .bind(lease.id)
                .fetch_one(&mut *tx)
                .await?;
            if current.state == "RELEASED" {
                continue;
            }
            match observed {
                Ok(ref evidence)
                    if evidence.scheduled_event_id == current.scheduled_event_id
                        && evidence.invocation_id == current.invocation_id.to_string() =>
                {
                    match &evidence.state {
                        ActivityState::Terminal { event_id, at } => {
                            // Workflow 关闭后 Worker 不再能调用 advance。这里复用同一
                            // 原生 Session/Invocation 观察链；两侧终态缺一仍保留 units。
                            let native_confirmed = if current.native_release_confirmed_at.is_some()
                            {
                                true
                            } else if let Some(runtime) = runtime {
                                // 复用已投递的 RPC timeout，覆盖整条观察/分页/interrupt
                                // 链，而不是每次 RPC 重置预算。超时不释放 units。
                                match tokio::time::timeout(
                                    runtime.observation_timeout(),
                                    confirm_closed_native(
                                        &mut tx,
                                        temporal,
                                        Some(runtime),
                                        &current,
                                    ),
                                )
                                .await
                                {
                                    Ok(result) => result?,
                                    Err(_) => {
                                        tracing::warn!(lease_id=%current.id,
                                            "Capacity native 观察预算耗尽，units 保留");
                                        false
                                    }
                                }
                            } else {
                                // 未配置 runtime 时只能核验既有终态引用或确定未派发，
                                // 不进行 native 分页，也不将 runtime 缺席视为已终结。
                                confirm_closed_native(&mut tx, temporal, None, &current).await?
                            };
                            sqlx::query(
                                "update admission.capacity_lease set state=$4,terminal_event_id=$2,
                                terminal_event_at=$3,
                                native_release_confirmed_at=case when $5 then
                                  coalesce(native_release_confirmed_at,now()) else native_release_confirmed_at end,
                                updated_at=now() where id=$1",
                            )
                            .bind(current.id)
                            .bind(event_id)
                            .bind(at)
                            .bind(if native_confirmed {
                                "RELEASED"
                            } else {
                                "UNKNOWN"
                            })
                            .bind(native_confirmed)
                            .execute(&mut *tx)
                            .await?;
                        }
                        ActivityState::Started { attempt, .. } => {
                            match self.renew(&mut tx, &current, evidence, *attempt).await {
                                Ok(_) => {}
                                Err(CapacityError::Database(error)) => {
                                    return Err(CapacityError::Database(error))
                                }
                                Err(reason) => {
                                    sqlx::query("update admission.capacity_lease set state='UNKNOWN',updated_at=now() where id=$1")
                                        .bind(current.id).execute(&mut *tx).await?;
                                    tracing::warn!(lease_id=%current.id, %reason, "Capacity holder 不可核验，units 保留");
                                }
                            }
                        }
                        _ => {
                            sqlx::query("update admission.capacity_lease set state='UNKNOWN',updated_at=now() where id=$1")
                                .bind(current.id).execute(&mut *tx).await?;
                        }
                    }
                }
                _ => {
                    sqlx::query("update admission.capacity_lease set state='UNKNOWN',updated_at=now() where id=$1")
                        .bind(current.id).execute(&mut *tx).await?;
                }
            }
            tx.commit().await?;
            tracing::debug!(lease_id=%current.id, expires_at=%current.expires_at, "Capacity holder 已对账；UNKNOWN 不回收 units");
        }
        let (occupied, unknown, oldest): (i64,i64,i64) = sqlx::query_as("select
            coalesce(sum(units) filter(where state<>'RELEASED'),0)::bigint,
            count(*) filter(where state='UNKNOWN'),
            coalesce(extract(epoch from now()-min(expires_at) filter(where state='UNKNOWN')),0)::bigint
            from admission.capacity_lease where pool_key=$1")
            .bind(&self.pool_key).fetch_one(pool).await?;
        let scope = [KeyValue::new("pool_key", self.pool_key.clone())];
        self.occupied_units.record(
            u64::try_from(occupied).map_err(|_| CapacityError::Unknown)?,
            &scope,
        );
        self.unknown_leases.record(
            u64::try_from(unknown).map_err(|_| CapacityError::Unknown)?,
            &scope,
        );
        self.oldest_unknown_seconds.record(
            u64::try_from(oldest.max(0)).map_err(|_| CapacityError::Unknown)?,
            &scope,
        );
        Ok(())
    }
}

/// 仅处理已经终结的持有 Activity，不为关闭的 Workflow 创建 thread/turn。
/// pool→lease→Invocation 锁序与原 release 一致；所有 native 引用仍属原冻结 scope。
async fn confirm_closed_native(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    temporal: &TemporalClient,
    runtime: Option<&Supervisor>,
    lease: &Lease,
) -> Result<bool, CapacityError> {
    let invocation: Option<NativeInvocation> = sqlx::query_as(
        "select v.status,v.projection_generation,p.config_hash,s.runtime_thread_id,
          v.runtime_turn_id,v.native_status,w.run_id as first_run,v.installation_resource_id
         from catalog.agent_invocation v join catalog.agent_session s
           on s.tenant_id=v.tenant_id and s.workspace_id=v.workspace_id
           and s.root_event_id=v.root_event_id and s.installation_resource_id=v.installation_resource_id
           and s.agent_version_asset_id=v.agent_version_asset_id and s.projection_generation=v.projection_generation
         join catalog.agent_runtime_projection p on p.installation_resource_id=v.installation_resource_id
           and p.generation=v.projection_generation and p.agent_version_asset_id=v.agent_version_asset_id
         join admission.action_execution a on a.id=v.action_execution_id
           and a.tenant_id=v.tenant_id and a.workspace_id=v.workspace_id
         join projection.workflow_ref w on w.workflow_id=v.workflow_id and w.action_execution_id=a.id
           and w.operation_id=a.operation_id and w.tenant_id=v.tenant_id and w.workspace_id=v.workspace_id
           and w.workflow_type='AgentTaskWorkflow' and w.kind is null
         where v.id=$1 and v.workflow_id=$2 for update of v,s",
    ).bind(lease.invocation_id).bind(&lease.workflow_id).fetch_optional(&mut **tx).await?;
    let Some(invocation) = invocation else {
        return Ok(false);
    };
    if !matches!(
        invocation.status.as_str(),
        "CREATED" | "DISPATCHING" | "RUNNING" | "UNKNOWN" | "COMPLETED" | "FAILED" | "CANCELED"
    ) {
        return Ok(false);
    }
    if invocation.status != "CREATED"
        && invocation.runtime_thread_id.is_some()
        && invocation
            .runtime_turn_id
            .as_ref()
            .is_some_and(|id| !id.is_empty())
        && invocation
            .native_status
            .as_deref()
            .is_some_and(native_terminal)
    {
        return Ok(true);
    }
    if invocation
        .native_status
        .as_deref()
        .is_some_and(|status| status != "inProgress")
    {
        return Ok(false);
    }
    let closed = match temporal.describe(&lease.workflow_id).await {
        Ok(Some(observed)) => observed,
        _ => return Ok(false),
    };
    if !matches!(closed.state, crate::temporal::ObservedState::Closed(_))
        || invocation.first_run.as_deref().is_none_or(|first| {
            first.is_empty() || (first != closed.first_run_id && first != closed.run_id)
        })
    {
        return Ok(false);
    }
    // CREATED 与 native turn 缺席是原 dispatch-before-write 不变量，不是从
    // 空 history 猜未派发。闭合 Workflow/Activity 后结束持有，不伪造任务成功。
    if invocation.status == "CREATED" {
        if invocation.runtime_turn_id.is_some() || invocation.native_status.is_some() {
            return Ok(false);
        }
        sqlx::query(
            "update catalog.agent_invocation set cancel_pending=true,updated_at=now()
            where id=$1 and status='CREATED' and runtime_turn_id is null and native_status is null",
        )
        .bind(lease.invocation_id)
        .execute(&mut **tx)
        .await?;
        return Ok(true);
    }
    let Some(thread) = invocation.runtime_thread_id.as_deref() else {
        return Ok(false);
    };
    let Some(runtime) = runtime else {
        return Ok(false);
    };
    let projection = RuntimeRef {
        installation_id: invocation.installation_resource_id,
        generation: invocation.projection_generation,
        config_hash: invocation.config_hash,
    };
    if runtime.resume_thread(&projection, thread).await.is_err() {
        return Ok(false);
    }
    let Some((turn, mut status)) = native_turn(
        runtime,
        &projection,
        thread,
        invocation.runtime_turn_id.as_deref(),
        lease.invocation_id,
    )
    .await
    else {
        return Ok(false);
    };
    if status == "inProgress" {
        // 固定 Workflow 已闭合，沿原 Operation 的已知 turn 做安全收尾。
        // interrupt accepted/error 都不是终态；随后必须独立读到 native terminal。
        let _ = runtime.interrupt(&projection, thread, &turn).await;
        let Some((observed_turn, observed_status)) = native_turn(
            runtime,
            &projection,
            thread,
            Some(&turn),
            lease.invocation_id,
        )
        .await
        else {
            return Ok(false);
        };
        if observed_turn != turn {
            return Ok(false);
        }
        status = observed_status;
    }
    let changed = sqlx::query(
        "update catalog.agent_invocation set runtime_turn_id=$2,native_status=$3,
        observation_cursor=null,cancel_pending=cancel_pending or $4,updated_at=now()
        where id=$1 and status=$5 and runtime_turn_id is not distinct from $6
          and native_status is not distinct from $7 and projection_generation=$8",
    )
    .bind(lease.invocation_id)
    .bind(&turn)
    .bind(&status)
    .bind(status == "interrupted")
    .bind(&invocation.status)
    .bind(&invocation.runtime_turn_id)
    .bind(&invocation.native_status)
    .bind(invocation.projection_generation)
    .execute(&mut **tx)
    .await?;
    if changed.rows_affected() != 1 {
        return Err(CapacityError::Unknown);
    }
    // 不改 Invocation 业务状态：Reply/Usage 证据仍由原消费者确认。
    Ok(native_terminal(&status))
}

fn native_terminal(status: &str) -> bool {
    matches!(status, "completed" | "failed" | "interrupted")
}

/// 在调用方整链预算内原生分页；未知 turn ID 只从同 Invocation 的唯一 clientId 恢复。
/// 无命中不是未派发证明，晚到的 thread/turn start 不得因此释放容量。
async fn native_turn(
    runtime: &Supervisor,
    projection: &RuntimeRef,
    thread: &str,
    known: Option<&str>,
    invocation: Uuid,
) -> Option<(String, String)> {
    let mut cursor: Option<String> = None;
    let mut visited = std::collections::HashSet::new();
    let mut matched = None;
    let client_id = invocation.to_string();
    loop {
        let page = runtime
            .turns(projection, thread, cursor.as_deref())
            .await
            .ok()?;
        for turn in page.get("data")?.as_array()? {
            if turn.get("itemsView")?.as_str()? != "full" {
                return None;
            }
            let id = turn.get("id")?.as_str()?.to_owned();
            if id.is_empty() {
                return None;
            }
            let items = turn.get("items")?.as_array()?;
            let correlated = items.iter().any(|item| {
                item.get("type").and_then(serde_json::Value::as_str) == Some("userMessage")
                    && item.get("clientId").and_then(serde_json::Value::as_str)
                        == Some(client_id.as_str())
            });
            if known.map_or(correlated, |known| known == id) {
                if matched.is_some() {
                    return None;
                }
                let status = turn.get("status")?.as_str()?.to_owned();
                if status != "inProgress" && !native_terminal(&status) {
                    return None;
                }
                matched = Some((id, status));
            }
        }
        cursor = match page.get("nextCursor")? {
            serde_json::Value::Null => return matched,
            serde_json::Value::String(next) if !next.is_empty() && visited.insert(next.clone()) => {
                Some(next.clone())
            }
            _ => return None,
        };
    }
}
