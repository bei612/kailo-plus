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
/// 同上，`archive_community` 的签名路径。
const ARCHIVE_PATH: &str = "/operator/communities/archive";
/// 同上，`unarchive_community` 的签名路径（SF-BUZ-43）。
const UNARCHIVE_PATH: &str = "/operator/communities/unarchive";
/// 同上，`community_availability` 的签名路径。它是 operator 面唯一只读、
/// 不产生任何副作用的端点，用来查证「Relay 接受这把 operator key」。
const AVAILABILITY_PATH: &str = "/operator/communities/availability";
/// SS-BUZ-COMMUNITY-DELETE 的部署私有执行器路径，不进入公开 Relay Router。
const DELETION_PATH: &str = "/operator/deletions";

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
    /// Core 自己的 Relay 调用预算已用完，请求**没有**发往 Relay（`apps/07` §5：
    /// 在 BFF 侧先行设界，不把压力透传给 Relay）。
    #[error("Core 的 Relay 调用预算已用完，{retry_after_secs} 秒后可再试")]
    BudgetExhausted { retry_after_secs: u64 },
    /// 请求会超出 Relay 在 NIP-11 中声明的上界，因此没有发出（`.design/09`
    /// 「BFF Relay 连接模型」、`SF-BUZ-28`）。
    #[error("超出 Relay 声明的上界: {0}")]
    OverLimit(String),
}

/// `apps/06` §4 `LIMIT` 类下的具体成因。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LimitKind {
    /// 调用频率：Core 自己的预算，或 Relay 的 429（`enforce_http_admission`）
    RateLimited,
    /// 大小上界：Relay 的 413（请求体上界）
    PayloadTooLarge,
    /// 容量：NIP-11 声明的订阅数等上界
    Capacity,
}

impl OperatorError {
    /// 这个失败是否属于 `LIMIT` 类。只按状态码与本地变体判定，不解析上游的
    /// 错误文案——文案一改，按文案的分类就会静默失效。
    ///
    /// 429 与 413 都在 Relay 读取事件之前返回（`api/bridge.rs::submit_event_authed`
    /// 先做 admission 再解析 body；413 来自路由层的请求体上界），因此它们是
    /// **确定未处理**，不是结果不明。
    pub fn limit(&self) -> Option<LimitKind> {
        match self {
            OperatorError::BudgetExhausted { .. } | OperatorError::Rejected { status: 429, .. } => {
                Some(LimitKind::RateLimited)
            }
            OperatorError::Rejected { status: 413, .. } => Some(LimitKind::PayloadTooLarge),
            OperatorError::OverLimit(_) => Some(LimitKind::Capacity),
            _ => None,
        }
    }

    /// Core 预算给出的等待时长；Relay 的 429 不带可机读的重置时刻，返回 `None`。
    pub fn retry_after_secs(&self) -> Option<u64> {
        match self {
            OperatorError::BudgetExhausted { retry_after_secs } => Some(*retry_after_secs),
            _ => None,
        }
    }
}

/// `GET /operator/communities` 的一行：host 与归档时刻（未归档为 `None`）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OwnedCommunity {
    pub host: String,
    pub archived_at: Option<String>,
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
    /// 签名覆盖方法、URL 与 payload 摘要；URL 逐字符等于 Relay 配置的
    /// canonical operator origin 加实际路径与查询串，不以私有 transport 替换。
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
        self.post_json(
            http,
            PROVISION_PATH,
            &serde_json::json!({
                "host": host,
                "initial_owner_pubkey": initial_owner_pubkey,
                "create_only": true,
            }),
        )
        .await
    }

    /// 归档 Community：Relay 随即对它关闭写入并断开全部连接。
    ///
    /// 上游对同一 owner 重发是幂等的；owner 不符时回 404，不会误归档别人的
    /// Community。归档后 Community 不再服务，数据清除由上游的删除流程承担。
    pub async fn archive_community(
        &self,
        http: &reqwest::Client,
        host: &str,
        owner_pubkey: &str,
    ) -> Result<serde_json::Value, OperatorError> {
        self.post_json(
            http,
            ARCHIVE_PATH,
            &serde_json::json!({ "host": host, "owner_pubkey": owner_pubkey }),
        )
        .await
    }

    /// 解档 Community（SF-BUZ-43）：清除 `archived_at`，host 重新可解析。同一 owner
    /// 重发幂等；owner 不符回 404。只用于 Tenant 恢复（DD-96）。
    pub async fn unarchive_community(
        &self,
        http: &reqwest::Client,
        host: &str,
        owner_pubkey: &str,
    ) -> Result<serde_json::Value, OperatorError> {
        self.post_json(
            http,
            UNARCHIVE_PATH,
            &serde_json::json!({ "host": host, "owner_pubkey": owner_pubkey }),
        )
        .await
    }

    /// 列出 `owner_pubkey` 名下的 Community 及其 `archived_at`（SF-BUZ-43 的回读面）。
    ///
    /// 签名 URL 含查询串：上游以 origin + path + `?` + 原始查询串校验 NIP-98 的 `u`。
    /// 每次调用都重新签名（新 nonce），replay guard 不接受重放。
    pub async fn list_owned_communities(
        &self,
        http: &reqwest::Client,
        owner_pubkey: &str,
    ) -> Result<Vec<OwnedCommunity>, OperatorError> {
        let mut url = self.api_origin.join(PROVISION_PATH)?;
        url.query_pairs_mut()
            .append_pair("owner_pubkey", owner_pubkey);
        let header = self.nip98_header("GET", url.as_str(), &[])?;
        let resp = http.get(url).header("Authorization", header).send().await?;
        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            return Err(OperatorError::Rejected {
                status: status.as_u16(),
                body: text.chars().take(200).collect(),
            });
        }
        let v: serde_json::Value =
            serde_json::from_str(&text).map_err(|e| OperatorError::Sign(e.to_string()))?;
        v.get("communities")
            .and_then(|c| c.as_array())
            .ok_or_else(|| OperatorError::Sign("operator 列表缺 communities".to_owned()))?
            .iter()
            .map(|row| {
                let host = row
                    .get("host")
                    .and_then(|h| h.as_str())
                    .ok_or_else(|| OperatorError::Sign("operator 列表行缺 host".to_owned()))?;
                // 缺字段与 null 不是一回事：缺字段说明回应不合合同，不当作「未归档」
                let archived_at = match row.get("archived_at") {
                    Some(serde_json::Value::Null) => None,
                    Some(serde_json::Value::String(t)) => Some(t.clone()),
                    _ => {
                        return Err(OperatorError::Sign(
                            "operator 列表行的 archived_at 不合合同".to_owned(),
                        ))
                    }
                };
                Ok(OwnedCommunity {
                    host: host.to_owned(),
                    archived_at,
                })
            })
            .collect()
    }

    /// 提交 DD-109 的原生删除请求。requested_by 固定为 TenantDeleteSubprocess ID；
    /// 结果不明时由调用方先按 exact host 回读，不能以重发代替对账。
    pub async fn submit_community_deletion(
        &self,
        http: &reqwest::Client,
        transport: &str,
        host: &str,
        requested_by: uuid::Uuid,
    ) -> Result<serde_json::Value, OperatorError> {
        self.deletion_request(
            http,
            transport,
            reqwest::Method::POST,
            self.api_origin.join(DELETION_PATH)?,
            Some(&serde_json::json!({
                "host": host,
                "requested_by": requested_by.to_string(),
            })),
        )
        .await
    }

    /// 返回 exact host 的完整非 aborted 原生请求数组，包括 blocked 请求。
    /// 不从部署全局列表截取后再过滤，不根据 HTTP 成功合成生命周期状态。
    pub async fn list_community_deletions(
        &self,
        http: &reqwest::Client,
        transport: &str,
        host: &str,
    ) -> Result<serde_json::Value, OperatorError> {
        let mut canonical = self.api_origin.join(DELETION_PATH)?;
        canonical.query_pairs_mut().append_pair("host", host);
        self.deletion_request(http, transport, reqwest::Method::GET, canonical, None)
            .await
    }

    /// 原样返回 request、approval 与 checkpoints；native inspection 保持权威。
    pub async fn inspect_community_deletion(
        &self,
        http: &reqwest::Client,
        transport: &str,
        request_id: uuid::Uuid,
    ) -> Result<serde_json::Value, OperatorError> {
        self.deletion_request(
            http,
            transport,
            reqwest::Method::GET,
            self.api_origin
                .join(&format!("{DELETION_PATH}/{request_id}"))?,
            None,
        )
        .await
    }

    /// 审批原生冻结清单；digest 使用上游裸十六进制值，approved_by 为
    /// tenant.delete 的 ActionExecution ID，不改写原生审批证据。
    pub async fn approve_community_deletion(
        &self,
        http: &reqwest::Client,
        transport: &str,
        request_id: uuid::Uuid,
        expected_inventory_digest: &str,
        approved_by: uuid::Uuid,
    ) -> Result<serde_json::Value, OperatorError> {
        self.deletion_request(
            http,
            transport,
            reqwest::Method::POST,
            self.api_origin
                .join(&format!("{DELETION_PATH}/{request_id}/approve"))?,
            Some(&serde_json::json!({
                "expected_inventory_digest": expected_inventory_digest,
                "approved_by": approved_by.to_string(),
            })),
        )
        .await
    }

    /// 调用 Buzz 进程内的原生引擎并返回完整 inspection。retention_pending
    /// 不能单独证明 Tenant 删除；调用方仍须回读 CONTROL owner Community list。
    pub async fn run_community_deletion(
        &self,
        http: &reqwest::Client,
        transport: &str,
        request_id: uuid::Uuid,
    ) -> Result<serde_json::Value, OperatorError> {
        self.deletion_request(
            http,
            transport,
            reqwest::Method::POST,
            self.api_origin
                .join(&format!("{DELETION_PATH}/{request_id}/run"))?,
            Some(&serde_json::json!({})),
        )
        .await
    }

    async fn deletion_request(
        &self,
        http: &reqwest::Client,
        transport: &str,
        method: reqwest::Method,
        canonical: Url,
        body: Option<&serde_json::Value>,
    ) -> Result<serde_json::Value, OperatorError> {
        let mut destination = Url::parse(transport)?;
        if !matches!(destination.scheme(), "http" | "https")
            || destination.host_str().is_none()
            || !destination.username().is_empty()
            || destination.password().is_some()
            || destination.path() != "/"
            || destination.query().is_some()
            || destination.fragment().is_some()
        {
            return Err(OperatorError::Sign(
                "删除执行器 transport 必须是无凭据、无路径与查询的 HTTP(S) origin".to_owned(),
            ));
        }
        // 唯一变化是网络 authority；路径、原始查询串与签名 canonical 完全一致。
        // Relay 按配置的 operator origin 校验，不读入站 Host。
        destination.set_path(canonical.path());
        destination.set_query(canonical.query());
        self.request_json(http, method, canonical, destination, body)
            .await
    }

    /// 以这把 key 签一次只读的 operator 请求，查证 Relay 当前接受它。
    ///
    /// 问的 host 取 operator origin 自己的主机名：它是部署事实、总是合法的
    /// authority，结论（可用与否）无关紧要——要的只是「签名者在 allow-list 上」。
    /// 不在 allow-list 上 Relay 回 403，以 `Rejected` 返回；传输失败原样返回，
    /// 调用方不得把它当成接受或拒绝。
    pub async fn probe(&self, http: &reqwest::Client) -> Result<(), OperatorError> {
        let host = self
            .api_origin
            .host_str()
            .ok_or_else(|| OperatorError::Sign("operator origin 没有主机名".to_owned()))?
            .to_owned();
        let mut url = self.api_origin.join(AVAILABILITY_PATH)?;
        url.query_pairs_mut().append_pair("host", &host);
        let header = self.nip98_header("GET", url.as_str(), &[])?;
        let resp = http.get(url).header("Authorization", header).send().await?;
        let status = resp.status();
        if status.is_success() {
            return Ok(());
        }
        let text = resp.text().await.unwrap_or_default();
        Err(OperatorError::Rejected {
            status: status.as_u16(),
            body: text.chars().take(200).collect(),
        })
    }

    async fn post_json(
        &self,
        http: &reqwest::Client,
        path: &str,
        body: &serde_json::Value,
    ) -> Result<serde_json::Value, OperatorError> {
        let url = self.api_origin.join(path)?;
        self.request_json(http, reqwest::Method::POST, url.clone(), url, Some(body))
            .await
    }

    async fn request_json(
        &self,
        http: &reqwest::Client,
        method: reqwest::Method,
        canonical: Url,
        destination: Url,
        body: Option<&serde_json::Value>,
    ) -> Result<serde_json::Value, OperatorError> {
        let payload = match body {
            Some(body) => {
                serde_json::to_vec(body).map_err(|e| OperatorError::Sign(e.to_string()))?
            }
            None => Vec::new(),
        };

        // NIP-98 事件按上游客户端的同一形状构造（buzz-acp 的 sign_nip98）：
        // u / method / nonce 三个标签必给，带 body 时再加 payload 摘要。
        // nonce 不能省——Relay 的 check_operator_replay 依赖它做重放判定。
        let header = self.nip98_header(method.as_str(), canonical.as_str(), &payload)?;

        let mut request = http
            .request(method, destination)
            .header("Authorization", header);
        if body.is_some() {
            request = request
                .header("Content-Type", "application/json")
                .body(payload);
        }
        let resp = request.send().await?;

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
