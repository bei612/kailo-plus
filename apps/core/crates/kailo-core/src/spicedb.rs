//! Core 到 SpiceDB 的 fresh Check（`.design/03` §5、`.design/10` §1、ADR-09）。
//!
//! SpiceDB 是访问允许/拒绝的唯一权威；Core 只问、不缓存、不推断。走 SpiceDB
//! 自带的 HTTP gateway（`internal/gateway/gateway.go` 注册的 PermissionsService
//! 投影），以 preshared key 作 Bearer——与 Worker 走 gRPC 用的是同一枚凭据、同一套
//! 服务端校验（SF-SPZ-03），这枚凭据只认证 Core 这个服务，不表达任何用户权限
//! （DD-37）。
//!
//! 结论只有两种确定值：有、没有。`CONDITIONAL_PERMISSION`（caveat 缺上下文）与
//! 任何非 2xx 一律不是「有」——前者按没有处理，后者交给调用方当结果不明。

use serde::Deserialize;

/// 一次 Check 的一致性要求（`.design/10` §1 的固定使用规则）。
#[derive(Clone, Copy)]
pub enum Consistency {
    /// 准入、重新准入与审批者资格：即将发生外部副作用且无因果 token
    FullyConsistent,
    /// 列表与发现：允许低延迟，但点击动作仍 fresh Check
    MinimizeLatency,
}

#[derive(Debug, thiserror::Error)]
pub enum SpiceDbError {
    #[error("SpiceDB 不可达或回应不明: {0}")]
    Unavailable(String),
}

/// Check 的结论与 SpiceDB 给出的 revision（ZedToken），后者进 ActionDecision。
pub struct Checked {
    pub allowed: bool,
    pub zed_token: String,
}

pub struct SpiceDb {
    http: reqwest::Client,
    check_url: String,
    key: String,
}

impl SpiceDb {
    /// 地址与凭据都不接受默认值：猜一个地址会让判定打到一个不是权威的实例。
    pub fn from_env(http: reqwest::Client) -> Result<Self, String> {
        let base = std::env::var("SPICEDB_HTTP_URL").map_err(|_| "缺少 SPICEDB_HTTP_URL")?;
        let key =
            std::env::var("SPICEDB_PRESHARED_KEY").map_err(|_| "缺少 SPICEDB_PRESHARED_KEY")?;
        if key.is_empty() {
            return Err("SPICEDB_PRESHARED_KEY 不能为空".into());
        }
        Ok(Self {
            http,
            check_url: format!("{}/v1/permissions/check", base.trim_end_matches('/')),
            key,
        })
    }

    /// `principal:<subject>` 对 `<object_type>:<object_id>` 是否有 `permission`。
    pub async fn check(
        &self,
        object_type: &str,
        object_id: &str,
        permission: &str,
        subject_principal: &str,
        consistency: Consistency,
    ) -> Result<Checked, SpiceDbError> {
        let consistency = match consistency {
            Consistency::FullyConsistent => serde_json::json!({ "fullyConsistent": true }),
            Consistency::MinimizeLatency => serde_json::json!({ "minimizeLatency": true }),
        };
        let body = serde_json::json!({
            "consistency": consistency,
            "resource": { "objectType": object_type, "objectId": object_id },
            "permission": permission,
            "subject": { "object": { "objectType": "principal", "objectId": subject_principal } },
        });
        let resp = self
            .http
            .post(&self.check_url)
            .bearer_auth(&self.key)
            .json(&body)
            .send()
            .await
            .map_err(|e| SpiceDbError::Unavailable(e.to_string()))?;
        let status = resp.status();
        if !status.is_success() {
            // 4xx 在这里只可能是 Core 自己拼错了请求或凭据不对：都不是「没有权限」，
            // 更不是「有」。按不明上报，调用方 fail closed。
            let text = resp.text().await.unwrap_or_default();
            tracing::error!(%status, body = %text.chars().take(200).collect::<String>(), "SpiceDB Check 未成功");
            return Err(SpiceDbError::Unavailable(format!("HTTP {status}")));
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Token {
            token: String,
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Resp {
            checked_at: Option<Token>,
            permissionship: String,
        }
        let r: Resp = resp
            .json()
            .await
            .map_err(|e| SpiceDbError::Unavailable(format!("回应不可解析: {e}")))?;
        Ok(Checked {
            allowed: r.permissionship == "PERMISSIONSHIP_HAS_PERMISSION",
            zed_token: r.checked_at.map(|t| t.token).unwrap_or_default(),
        })
    }
}
