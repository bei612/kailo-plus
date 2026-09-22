//! Buzz operator 面适配器（`SS-BUZ-OPERATOR`）。
//!
//! 上游的 endpoint、allow-list 与 replay guard 都不改动；本模块只在既有 HTTP
//! 合同之前加两件事：按固定 audience 取用部署级密钥，以及对**精确**的
//! `relay_operator_api_origin + path` 签 NIP-98。
//!
//! 签名 URL 必须逐字符等于 Relay 侧配置的 origin 加路径——上游用它做 replay
//! 命名空间，从入站 Host 头推导会让签名在代理后失配。

use base64::Engine;
use nostr::{EventBuilder, Keys, Kind, Tag};
use sha2::{Digest, Sha256};
use url::Url;

/// operator 面的固定路径。Relay 的 `authorize_operator_request` 以字面量
/// `"/operator/communities"` 参与签名校验，此处必须一致。
const PROVISION_PATH: &str = "/operator/communities";

#[derive(Debug, thiserror::Error)]
pub enum OperatorError {
    #[error("RelayOperatorIdentity 的 audience 与配置不符")]
    AudienceMismatch,
    #[error("该身份由客户端托管，Core 不持有其私钥，不能代签")]
    CustodyNotServer,
    #[error("密钥不是有效的 32 字节十六进制")]
    InvalidKey,
    #[error("operator API origin 无法解析: {0}")]
    InvalidOrigin(#[from] url::ParseError),
    #[error("签名失败: {0}")]
    Sign(String),
    #[error("请求失败: {0}")]
    Transport(#[from] reqwest::Error),
    #[error("Relay 拒绝: HTTP {status} {body}")]
    Rejected { status: u16, body: String },
    /// 投影动作已发出，但再次读取 roster 仍与目标状态不符。
    ///
    /// 这是**结果不明**而不是拒绝：上游的 roster 快照事件由 best-effort 路径
    /// 发布（失败只 warn），因此读到旧值既可能是快照落后，也可能是写入没生效。
    /// 调用方必须当作可重试失败，绝不能据此把成员置为 active。
    #[error("roster 未收敛: {0}")]
    NotConverged(String),
}

/// 取用密钥前先校验 audience：同一把 operator key 不得被用于它不该服务的部署。
pub struct OperatorIdentity {
    keys: Keys,
    api_origin: Url,
}

/// 手写而不是派生：派生会把私钥打进任何 `{:?}` 的日志与断言消息里。
/// 只暴露公钥与 origin，二者都是可公开的配置事实。
impl std::fmt::Debug for OperatorIdentity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("OperatorIdentity")
            .field("pubkey", &self.keys.public_key().to_hex())
            .field("api_origin", &self.api_origin.as_str())
            .finish_non_exhaustive()
    }
}

impl OperatorIdentity {
    /// `secret_hex` 来自 `RelayOperatorIdentity.private_key_secret_ref` 所指的
    /// OpenBao KV 版本；`expected_audience` 与 `actual_audience` 来自同一条记录。
    pub fn new(
        secret_hex: &str,
        api_origin: &str,
        expected_audience: &str,
        actual_audience: &str,
    ) -> Result<Self, OperatorError> {
        if expected_audience != actual_audience {
            return Err(OperatorError::AudienceMismatch);
        }
        let keys = Keys::parse(secret_hex).map_err(|_| OperatorError::InvalidKey)?;
        Ok(Self {
            keys,
            api_origin: Url::parse(api_origin)?,
        })
    }

    pub fn pubkey_hex(&self) -> String {
        self.keys.public_key().to_hex()
    }

    /// 构造 `Authorization: Nostr <base64(event)>`。
    ///
    /// 签名覆盖方法、URL 与 payload 摘要；URL 必须是调用方真正请求的那个，
    /// 逐字符等于 Relay 配置的 origin 加路径。
    fn nip98_header(&self, method: &str, url: &str, body: &[u8]) -> Result<String, OperatorError> {
        let tag = |parts: [&str; 2]| {
            Tag::parse(parts).map_err(|e| OperatorError::Sign(format!("NIP-98 tag: {e}")))
        };
        let nonce = uuid::Uuid::new_v4().to_string();
        let payload_hash = hex::encode(Sha256::digest(body));
        let tags = vec![
            tag(["u", url])?,
            tag(["method", method])?,
            tag(["nonce", &nonce])?,
            tag(["payload", &payload_hash])?,
        ];
        let event = EventBuilder::new(Kind::HttpAuth, "")
            .tags(tags)
            .sign_with_keys(&self.keys)
            .map_err(|e| OperatorError::Sign(format!("NIP-98 sign: {e}")))?;
        let json = serde_json::to_string(&event)
            .map_err(|e| OperatorError::Sign(format!("NIP-98 serialize: {e}")))?;
        Ok(format!(
            "Nostr {}",
            base64::engine::general_purpose::STANDARD.encode(json)
        ))
    }

    /// 创建或确保 Community 存在。
    ///
    /// `create_only` 固定为 true：Tenant 建立是一次性动作，撞上已存在的 host
    /// 必须失败而不是静默收敛到别人的 Community——那会让两个 Tenant 共用同一
    /// 协作空间（`REQ-09` 禁止跨 Tenant 共享）。
    pub async fn provision_community(
        &self,
        http: &reqwest::Client,
        host: &str,
        initial_owner_pubkey: &str,
    ) -> Result<serde_json::Value, OperatorError> {
        let url = self.api_origin.join(PROVISION_PATH)?;
        let body = serde_json::json!({
            "host": host,
            "initial_owner_pubkey": initial_owner_pubkey,
            "create_only": true,
        });
        let payload = serde_json::to_vec(&body).map_err(|e| OperatorError::Sign(e.to_string()))?;

        // NIP-98 事件按上游客户端的同一形状构造（buzz-acp 的 sign_nip98）：
        // u / method / nonce 三个标签必给，带 body 时再加 payload 摘要。
        // nonce 不能省——Relay 的 check_operator_replay 依赖它做重放判定。
        let header = self.nip98_header("POST", url.as_str(), &payload)?;

        let resp = http
            .post(url)
            .header("Authorization", header)
            .header("Content-Type", "application/json")
            .body(payload)
            .send()
            .await?;

        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            return Err(OperatorError::Rejected {
                status: status.as_u16(),
                body: text.chars().take(200).collect(),
            });
        }
        serde_json::from_str(&text).map_err(|e| OperatorError::Sign(e.to_string()))
    }
}
