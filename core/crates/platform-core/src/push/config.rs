//! DD-151 operational thresholds come from the existing Core environment delivery.
//! No silent fallback: incomplete/invalid policy refuses startup before any worker runs.
use serde::Deserialize;
use std::time::Duration;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Policy {
    pub lease_seconds: i32,
    pub notification_ttl_seconds: i32,
    pub max_attempts: i32,
    pub retry_base_seconds: i32,
    pub apns_retry_floor_seconds: i32,
    pub provider_timeout_seconds: i32,
    pub scan_page_size: usize,
    pub scan_event_bound: usize,
    pub dispatch_batch_size: usize,
    pub retirement_batch_size: i64,
    pub token_prepare_lease_seconds: i32,
    pub token_retry_base_seconds: i32,
    pub token_retry_max_seconds: i32,
    pub receipt_commit_attempts: usize,
    pub collapse_seconds: i32,
    pub device_window_seconds: i32,
    pub device_attempt_limit: i32,
    pub credential_ttl_seconds: i32,
    pub relay_read_timeout_seconds: i32,
}
impl Policy {
    pub(super) fn parse(raw: &str) -> Result<Self, String> {
        let value: serde_json::Value =
            serde_json::from_str(raw).map_err(|_| "PUSH_DELIVERY_POLICY 必须为完整 JSON 对象")?;
        let schema: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../../contracts/runtime/push_delivery_policy.schema.json"
        ))
        .map_err(|_| "推送策略合同损坏")?;
        let validator = jsonschema::validator_for(&schema).map_err(|_| "推送策略合同不可编译")?;
        if !validator.is_valid(&value) {
            return Err(
                "PUSH_DELIVERY_POLICY 不符合 contracts/runtime/push_delivery_policy.schema.json"
                    .into(),
            );
        }
        // Runtime value bounds belong to the consumer, keeping the shared schema subset.
        if !value.as_object().is_some_and(|fields| {
            fields.values().all(|v| {
                v.as_i64()
                    .is_some_and(|n| n > 0 && n <= i64::from(i32::MAX))
            })
        }) {
            return Err("推送策略数值必须为正的 32 位整数".into());
        }
        let policy: Self =
            serde_json::from_value(value).map_err(|_| "PUSH_DELIVERY_POLICY 类型错误")?;
        // Provider protocol retry floors, not deployment defaults.
        if policy.retry_base_seconds < 60 || policy.apns_retry_floor_seconds < 900 {
            return Err("推送重试间隔低于 FCM/APNs 协议要求".into());
        }
        if policy.scan_event_bound < policy.scan_page_size
            || policy.token_retry_max_seconds < policy.token_retry_base_seconds
            || policy.lease_seconds <= policy.relay_read_timeout_seconds
            || i64::from(policy.lease_seconds) <= i64::from(policy.provider_timeout_seconds) * 2
        {
            return Err("推送策略要求 event bound >= page size、token retry max >= base、lease > OAuth 与通知两个 HTTP deadline 之和".into());
        }
        Ok(policy)
    }
    pub(super) fn timeout(&self) -> Duration {
        Duration::from_secs(self.provider_timeout_seconds as u64)
    }
    pub(super) fn retry_delay(&self, attempt: i32) -> Duration {
        // Saturating exponential arithmetic, capped by notification lifetime. Retry-After may
        // still be longer; expiry then stops dispatch rather than violating provider backoff.
        let exponent = u32::try_from(attempt).unwrap_or_default();
        let factor = 1u64.checked_shl(exponent).unwrap_or(u64::MAX);
        Duration::from_secs(
            (self.retry_base_seconds as u64)
                .saturating_mul(factor)
                .min(self.notification_ttl_seconds as u64),
        )
    }
    #[cfg(test)]
    pub(super) fn fixture() -> Self {
        Self::parse(include_str!(
            "../../../../../contracts/samples/push_delivery_policy.json"
        ))
        .unwrap()
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn delivered_policy_has_no_missing_unknown_or_unsafe_fallback() {
        assert!(Policy::parse("{}").is_err());
        let raw = include_str!("../../../../../contracts/samples/push_delivery_policy.json");
        assert!(Policy::parse(raw).is_ok());
        for (field, value) in [
            ("retryBaseSeconds", serde_json::json!(1)),
            ("maxAttempts", serde_json::json!(0)),
            ("scanPageSize", serde_json::json!(i64::MAX)),
            ("apnsRetryFloorSeconds", serde_json::json!(1)),
            ("leaseSeconds", serde_json::json!(1)),
            ("unrecognized", serde_json::json!(true)),
        ] {
            let mut v: serde_json::Value = serde_json::from_str(raw).unwrap();
            v[field] = value;
            assert!(Policy::parse(&v.to_string()).is_err());
        }
    }
}
