//! DD-66/69、03 §7、17 §3：消费 Invocation 固定 Version 的运行边界。
//! 不投影授权，不给未定义的 replyPolicy 或未接通的 memory write 造缺省行为。

use chrono::{DateTime, Utc};
use contracts::ContentClass as AgentVersionContent;
use serde_json::Value;
use sqlx::{FromRow, PgConnection};
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub(crate) enum PolicyError {
    #[error("Frozen Agent policy cannot be verified")]
    Rejected,
    #[error("Agent policy persistence unavailable: {0}")]
    Database(#[from] sqlx::Error),
}

pub(crate) struct Policy {
    pub parallelism: i64,
    idle_timeout_seconds: i64,
    max_turn_duration_seconds: i64,
}

#[derive(FromRow)]
struct FrozenVersion {
    content: Value,
    config_hash: String,
}

/// 不从 Installation 当前 pointer 反推历史配置；仅消费此 Invocation 的 exact
/// version/generation。已退休版本仍可限制、停止在途回合，不恢复其执行资格。
pub(crate) async fn load(conn: &mut PgConnection, invocation: Uuid) -> Result<Policy, PolicyError> {
    let version: FrozenVersion = sqlx::query_as(
        "select v.content,v.config_hash from catalog.agent_invocation i
         join catalog.agent_runtime_projection p
           on p.installation_resource_id=i.installation_resource_id
           and p.generation=i.projection_generation
           and p.agent_version_asset_id=i.agent_version_asset_id
         join catalog.agent_version v on v.asset_id=i.agent_version_asset_id
           and v.state in ('PUBLISHED','RETIRED') where i.id=$1",
    )
    .bind(invocation)
    .fetch_optional(conn)
    .await?
    .ok_or(PolicyError::Rejected)?;
    let content: AgentVersionContent =
        serde_json::from_value(version.content).map_err(|_| PolicyError::Rejected)?;
    let (_, hash) = crate::agent_version::content(&content).map_err(|_| PolicyError::Rejected)?;
    if hash != version.config_hash {
        return Err(PolicyError::Rejected);
    }
    Ok(Policy {
        parallelism: content.parallelism,
        idle_timeout_seconds: content.turn_limits.idle_timeout_seconds,
        max_turn_duration_seconds: content.turn_limits.max_turn_duration_seconds,
    })
}

impl Policy {
    /// 固定 Codex 7498521d288b9b3b96ffba4eedf089d8d6e06a84 的 v2::Turn
    /// startedAt 是 Unix 秒且可缺失。缺失/未来值不能用 Core 轮询时间补造。
    /// last_activity 只来自同一进程/fence/thread/turn 的原生 emittedAtMs。
    /// 恢复后没有连续通知事实时，不以 poll/updated_at 补造空闲计时。
    pub(crate) fn turn_limit_reached(
        &self,
        turn: &Value,
        last_activity: Option<i64>,
        now: DateTime<Utc>,
    ) -> Result<bool, PolicyError> {
        let started = turn
            .get("startedAt")
            .and_then(Value::as_i64)
            .filter(|started| *started > 0)
            .ok_or(PolicyError::Rejected)?;
        let elapsed = now
            .timestamp()
            .checked_sub(started)
            .filter(|elapsed| *elapsed >= 0)
            .ok_or(PolicyError::Rejected)?;
        if elapsed >= self.max_turn_duration_seconds {
            return Ok(true);
        }
        let started_ms = started.checked_mul(1000).ok_or(PolicyError::Rejected)?;
        let activity = last_activity
            .filter(|activity| *activity >= started_ms && *activity <= now.timestamp_millis())
            .ok_or(PolicyError::Rejected)?;
        let idle_ms = self
            .idle_timeout_seconds
            .checked_mul(1000)
            .ok_or(PolicyError::Rejected)?;
        let elapsed_idle = now
            .timestamp_millis()
            .checked_sub(activity)
            .ok_or(PolicyError::Rejected)?;
        Ok(elapsed_idle >= idle_ms)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // 实现后的时间边界检查：只构造 native 协议时间值，不创建业务对象/库夹具。
    #[test]
    fn idle_uses_native_activity_and_exact_deadline() {
        let policy = Policy {
            parallelism: 1,
            idle_timeout_seconds: 5,
            max_turn_duration_seconds: 20,
        };
        let turn = json!({"startedAt":100});
        let at = |seconds| DateTime::from_timestamp(seconds, 0).unwrap();
        assert!(!policy
            .turn_limit_reached(&turn, Some(103_000), at(107))
            .unwrap());
        assert!(policy
            .turn_limit_reached(&turn, Some(103_000), at(108))
            .unwrap());
        assert!(!policy
            .turn_limit_reached(&turn, Some(104_000), at(108))
            .unwrap());
        assert!(policy.turn_limit_reached(&turn, None, at(108)).is_err());
        assert!(policy
            .turn_limit_reached(&turn, Some(109_000), at(108))
            .is_err());
        assert!(policy
            .turn_limit_reached(&turn, Some(99_999), at(108))
            .is_err());
    }

    #[test]
    fn activity_does_not_extend_total_duration_or_invent_start() {
        let policy = Policy {
            parallelism: 1,
            idle_timeout_seconds: 5,
            max_turn_duration_seconds: 20,
        };
        let now = DateTime::from_timestamp(120, 0).unwrap();
        assert!(policy
            .turn_limit_reached(&json!({"startedAt":100}), Some(120_000), now)
            .unwrap());
        assert!(policy
            .turn_limit_reached(&json!({"startedAt":100}), None, now)
            .unwrap());
        assert!(policy
            .turn_limit_reached(&json!({"startedAt":null}), Some(120_000), now)
            .is_err());
        assert!(policy
            .turn_limit_reached(&json!({"startedAt":121}), Some(120_000), now)
            .is_err());
    }
}
