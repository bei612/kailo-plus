//! BFF 侧的 per-BuzzIdentity Relay 客户端（`SS-BUZ-SERVER-CLIENT`）。
//!
//! 按 `.design/09` 第 4 步：写入与历史查询走 NIP-98 HTTP bridge，每请求一个
//! 签名、无连接状态；只有实时订阅与 WS-only kind 才需要该 pubkey 的 NIP-42
//! WebSocket 会话。本模块只承担前者。
//!
//! 上游 `HarnessRelay`/`RestClient` 是 ACP harness 内的单身份客户端，其内存
//! queue/seen/retry 不升格为业务可靠权威——重试与去重由 Core 的 outbox 承担。

use base64::Engine;
use nostr::{EventBuilder, Keys, Kind, Tag};
use serde_json::Value;
use sha2::{Digest, Sha256};
use url::Url;

use crate::operator::OperatorError;

/// 密钥托管方。只有 `Server` 才可能由 Core 代签（`DD-75`）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Custody {
    Server,
    Client,
}

/// 一个 Principal 的 Buzz 协议身份。
pub struct IdentityClient {
    keys: Keys,
    /// Relay 的网络地址，只用于建立连接。
    transport: Url,
    /// 该 Tenant 的 Community host。它同时是 Host 头与 NIP-98 签名里的权威：
    /// Relay 按 Host 绑定 Community，并以 `{scheme}://{host}{path}` 作为签名
    /// 期望 URL；网络地址不参与签名（SF-BUZ-32）。
    community_host: String,
}

/// 手写而不是派生：派生会把私钥打进任何 `{:?}` 的输出。
impl std::fmt::Debug for IdentityClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("IdentityClient")
            .field("pubkey", &self.keys.public_key().to_hex())
            .field("transport", &self.transport.as_str())
            .field("community_host", &self.community_host)
            .finish_non_exhaustive()
    }
}

impl IdentityClient {
    /// `custody` 必须是 `Server`。`Client` 托管的身份由原生端自己持钥并直连
    /// Relay，Core 手里没有那把钥匙——在这里尝试代签意味着实现走错了路径，
    /// 必须当场失败而不是用别的身份凑合（`DD-75`、`00-实施总纲.md` §3.4）。
    pub fn new(
        custody: Custody,
        secret_hex: &str,
        transport_url: &str,
        community_host: &str,
    ) -> Result<Self, OperatorError> {
        if custody != Custody::Server {
            return Err(OperatorError::CustodyNotServer);
        }
        let keys = Keys::parse(secret_hex).map_err(|_| OperatorError::InvalidKey)?;
        Ok(Self {
            keys,
            transport: Url::parse(transport_url)?,
            community_host: community_host.to_owned(),
        })
    }

    pub fn pubkey_hex(&self) -> String {
        self.keys.public_key().to_hex()
    }

    /// 以该身份创建一个 Channel（NIP-29 kind 9007），返回 Relay 分配的 channel id。
    ///
    /// 一个 Workspace 绑定一个 Channel（`DD-01`）。创建者成为该 Channel 的
    /// owner（`SF-BUZ-05`），因此调用方必须是该 Tenant 的 CONTROL 身份。
    pub async fn create_channel(
        &self,
        http: &reqwest::Client,
        name: &str,
    ) -> Result<String, OperatorError> {
        let tag = |parts: [&str; 2]| {
            Tag::parse(parts).map_err(|e| OperatorError::Sign(format!("tag: {e}")))
        };
        let event = EventBuilder::new(Kind::Custom(9007), "")
            .tags(vec![tag(["name", name])?])
            .sign_with_keys(&self.keys)
            .map_err(|e| OperatorError::Sign(format!("sign: {e}")))?;
        let payload = serde_json::to_vec(&event).map_err(|e| OperatorError::Sign(e.to_string()))?;
        let accepted: Value = self.bridge_post(http, "/events", &payload).await?;
        // NIP-29 里 Channel 由创建事件标识，Relay 回传的 event_id 即 channel id
        Self::accepted_event_id(&accepted)
    }

    /// 列出该身份所属的 Channel UUID。
    ///
    /// Channel 的标识是 Relay 分配的 UUID，不是创建事件的 id——`extract_channel_id`
    /// 要求 `h` 标签的值能解析为 UUID。成员关系由 Relay 签发的 kind 39002
    /// （NIP-29 group members）承载，`d` 标签是 Channel UUID、`p` 标签是成员。
    pub async fn member_channel_ids(
        &self,
        http: &reqwest::Client,
    ) -> Result<Vec<String>, OperatorError> {
        let filter = serde_json::json!({
            "kinds": [39002],
            "#p": [self.pubkey_hex()],
            "limit": 100
        });
        let page = self.query(http, &[filter]).await?;
        let mut ids = Vec::new();
        for ev in page.as_array().into_iter().flatten() {
            for tag in ev
                .get("tags")
                .and_then(|v| v.as_array())
                .into_iter()
                .flatten()
            {
                let parts = tag.as_array().map(|a| a.as_slice()).unwrap_or_default();
                if parts.first().and_then(|v| v.as_str()) == Some("d") {
                    if let Some(id) = parts.get(1).and_then(|v| v.as_str()) {
                        ids.push(id.to_owned());
                    }
                }
            }
        }
        ids.sort();
        ids.dedup();
        Ok(ids)
    }

    /// 以该身份发布一条频道消息，返回 Relay 接受后的 event id。
    ///
    /// event id 是 operation outcome 与 audit evidence（`.design/09` 第 6 步），
    /// 因此必须从 Relay 的响应里取，不能用本地算出的值——本地算得出不等于
    /// Relay 接受了它。
    pub async fn publish_channel_message(
        &self,
        http: &reqwest::Client,
        channel_id: &str,
        content: &str,
    ) -> Result<String, OperatorError> {
        let tag = |parts: [&str; 2]| {
            Tag::parse(parts).map_err(|e| OperatorError::Sign(format!("tag: {e}")))
        };
        let event = EventBuilder::new(Kind::Custom(9), content)
            .tags(vec![tag(["h", channel_id])?])
            .sign_with_keys(&self.keys)
            .map_err(|e| OperatorError::Sign(format!("sign: {e}")))?;

        let payload = serde_json::to_vec(&event).map_err(|e| OperatorError::Sign(e.to_string()))?;
        let accepted: Value = self.bridge_post(http, "/events", &payload).await?;
        Self::accepted_event_id(&accepted)
    }

    /// 以该身份查询历史。filter 由调用方给出，BFF 不接受 Browser 提交的
    /// 任意 filter（`.design/09` 第 2 步）。
    pub async fn query(
        &self,
        http: &reqwest::Client,
        filters: &[Value],
    ) -> Result<Value, OperatorError> {
        let payload =
            serde_json::to_vec(filters).map_err(|e| OperatorError::Sign(e.to_string()))?;
        self.bridge_post(http, "/query", &payload).await
    }

    /// Relay 接受事件后回传 `{"accepted":true,"event_id":"..."}`。
    /// 只认它给的 id：本地算得出不等于 Relay 接受了它。
    fn accepted_event_id(accepted: &Value) -> Result<String, OperatorError> {
        if accepted.get("accepted").and_then(|v| v.as_bool()) != Some(true) {
            return Err(OperatorError::Sign(format!("Relay 未接受: {accepted}")));
        }
        accepted
            .get("event_id")
            .and_then(|v| v.as_str())
            .map(str::to_owned)
            .ok_or_else(|| OperatorError::Sign(format!("响应缺 event_id: {accepted}")))
    }

    async fn bridge_post(
        &self,
        http: &reqwest::Client,
        path: &str,
        payload: &[u8],
    ) -> Result<Value, OperatorError> {
        // 签名对 Community host，请求发往 Relay 的网络地址并显式带同一 Host 头。
        // 两者必须一致：Relay 用 Host 绑定 Community，又用它构造签名期望 URL。
        let signed_url = format!("http://{}{}", self.community_host, path);
        let url = self.transport.join(path)?;
        let header = self.nip98_header("POST", &signed_url, payload)?;
        let resp = http
            .post(url)
            .header(reqwest::header::HOST, &self.community_host)
            .header("Authorization", header)
            .header("Content-Type", "application/json")
            .body(payload.to_vec())
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

    /// 与 operator 面同一形状：u / method / nonce 必给，带 body 再加 payload 摘要。
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
}
