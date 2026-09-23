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

/// Buzz 的事件 kind。取自上游 `buzz-core/src/kind.rs` 的同名常量，
/// 不是本仓库自定义的编号——改动必须回到上游确认。
const KIND_RELAY_ADMIN_ADD: u16 = 9030;
const KIND_RELAY_ADMIN_REMOVE: u16 = 9031;
const KIND_RELAY_MEMBERSHIP_LIST: u16 = 13534;
const KIND_CHANNEL_ADD_USER: u16 = 9000;
const KIND_CHANNEL_REMOVE_USER: u16 = 9001;
const KIND_CHANNEL_MEMBERS: u16 = 39002;

/// roster 的两个层级。Tenant 成员投影到 relay roster，Workspace 成员投影到
/// 所属 Channel 的 roster（`DD-45`）。
#[derive(Debug, Clone, Copy)]
pub enum Scope<'a> {
    Relay,
    Channel(&'a str),
}

/// 收敛目标。`converge` 只认这两个终态，没有「尽力而为」。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Presence {
    Present,
    Absent,
}

/// roster 快照里的一行。角色原样保留，不映射成平台角色——平台角色的权威
/// 在 Core，这里只是执行投影的核对依据。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RosterEntry {
    pub pubkey: String,
    pub role: String,
}

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
    ///
    /// `media_tags` 是 NIP-92 `imeta` 标签，每个是完整的一行（首元素为
    /// `"imeta"`）。这里不校验它们：Relay 按自己存的 sidecar 核对 hash、MIME
    /// 与大小（`verify_imeta_blobs`），那才是权威；这里再做一遍只会与之漂移。
    pub async fn publish_channel_message(
        &self,
        http: &reqwest::Client,
        channel_id: &str,
        content: &str,
        media_tags: &[Vec<String>],
    ) -> Result<String, OperatorError> {
        let parse = |parts: &[String]| {
            Tag::parse(parts).map_err(|e| OperatorError::Sign(format!("tag: {e}")))
        };
        let mut tags = vec![parse(&["h".to_owned(), channel_id.to_owned()])?];
        for t in media_tags {
            tags.push(parse(t)?);
        }
        let event = EventBuilder::new(Kind::Custom(9), content)
            .tags(tags)
            .sign_with_keys(&self.keys)
            .map_err(|e| OperatorError::Sign(format!("sign: {e}")))?;

        let payload = serde_json::to_vec(&event).map_err(|e| OperatorError::Sign(e.to_string()))?;
        let accepted: Value = self.bridge_post(http, "/events", &payload).await?;
        Self::accepted_event_id(&accepted)
    }

    /// 读取 roster 快照。
    ///
    /// 这是 roster 唯一的读取面：上游没有暴露直接读 `relay_members` 或
    /// `channel_members` 的 REST endpoint，只有 relay 自签的可替换快照事件。
    /// 快照由 best-effort 路径发布（发布失败只 warn），因此它可能落后于表，
    /// 这正是 `converge` 把「读到旧值」当作未收敛而非失败的原因。
    pub async fn roster(
        &self,
        http: &reqwest::Client,
        scope: Scope<'_>,
    ) -> Result<Vec<RosterEntry>, OperatorError> {
        // 快照是可替换事件，同一 scope 只有一条当前版本。
        let (filter, tag_name) = match scope {
            // NIP-43 kind 13534：标签形如 ["member", pubkey, role]
            Scope::Relay => (
                serde_json::json!({ "kinds": [KIND_RELAY_MEMBERSHIP_LIST], "limit": 1 }),
                "member",
            ),
            // NIP-29 kind 39002：标签形如 ["p", pubkey, relay_url, role]，
            // ["d", channel_uuid] 标识所属 Channel
            Scope::Channel(id) => (
                serde_json::json!({ "kinds": [KIND_CHANNEL_MEMBERS], "#d": [id], "limit": 1 }),
                "p",
            ),
        };
        let page = self.query(http, &[filter]).await?;
        Ok(Self::roster_entries(&page, tag_name))
    }

    /// 把 `target_pubkey` 在该 scope 的 roster 上收敛到 `want`。
    ///
    /// 成功判据是**再次读到的 roster**，不是 Relay 是否接受了事件
    /// （`.design/09`：只发出 admin event 而未查证不得 active）。这一点不是
    /// 谨慎而已，上游两条路径都要求它：
    ///
    /// - 移除已不在 roster 的目标会返回错误（relay 面 `member not found`、
    ///   Channel 面 `DbError::MemberNotFound`），不是幂等成功。Activity 重试
    ///   或崩溃重放都会撞上它。
    /// - 加入已在 roster 的目标是静默 no-op，且**不覆盖**既有角色。
    ///
    /// 先读一次可以在已收敛时完全不发事件；发完再读一次则让「事件被拒绝」
    /// 与「目标状态已成立」这两件事分开判断。
    pub async fn converge(
        &self,
        http: &reqwest::Client,
        scope: Scope<'_>,
        target_pubkey: &str,
        want: Presence,
    ) -> Result<(), OperatorError> {
        let target = target_pubkey.to_ascii_lowercase();
        let satisfied = |roster: &[RosterEntry]| {
            let present = roster.iter().any(|e| e.pubkey == target);
            present == (want == Presence::Present)
        };

        if satisfied(&self.roster(http, scope).await?) {
            return Ok(());
        }

        // 拒绝本身是**有歧义**的，不能直接当失败：上游对「移除一个已不在
        // roster 的成员」返回 400，而那恰恰说明目标状态已经成立，只是快照还旧。
        // 想靠错误文本区分这两种拒绝就成了对上游措辞的隐式依赖，措辞一改就
        // 静默失效。因此这里只把传输/签名失败当确定失败，拒绝一律并入未收敛，
        // 把理由带进详情供人排查，由调用方的重试上界决定何时放弃。
        let rejection = match self.send_admin_event(http, scope, &target, want).await {
            Ok(()) => None,
            Err(e @ OperatorError::Rejected { .. }) => Some(e.to_string()),
            Err(e) => return Err(e),
        };

        let after = self.roster(http, scope).await?;
        if satisfied(&after) {
            return Ok(());
        }
        Err(OperatorError::NotConverged(format!(
            "{target} 在 {scope:?} 上未达到 {want:?}，当前 roster {} 人{}",
            after.len(),
            rejection
                .map(|r| format!("；上游拒绝：{r}"))
                .unwrap_or_default()
        )))
    }

    /// 发出一条 roster 管理事件。私有：调用方只应经 `converge` 使用，
    /// 否则就会得到一个「发出去了但没查证」的结果。
    async fn send_admin_event(
        &self,
        http: &reqwest::Client,
        scope: Scope<'_>,
        target_pubkey: &str,
        want: Presence,
    ) -> Result<(), OperatorError> {
        let tag = |parts: [&str; 2]| {
            Tag::parse(parts).map_err(|e| OperatorError::Sign(format!("tag: {e}")))
        };
        // 不带 role 标签：上游在缺该标签时按 member 处理（Channel 面则保留既有
        // 角色）。角色语义的权威在 Core，一期不投影 admin/owner。
        let (kind, tags) = match (scope, want) {
            (Scope::Relay, Presence::Present) => {
                (KIND_RELAY_ADMIN_ADD, vec![tag(["p", target_pubkey])?])
            }
            (Scope::Relay, Presence::Absent) => {
                (KIND_RELAY_ADMIN_REMOVE, vec![tag(["p", target_pubkey])?])
            }
            (Scope::Channel(id), Presence::Present) => (
                KIND_CHANNEL_ADD_USER,
                vec![tag(["h", id])?, tag(["p", target_pubkey])?],
            ),
            (Scope::Channel(id), Presence::Absent) => (
                KIND_CHANNEL_REMOVE_USER,
                vec![tag(["h", id])?, tag(["p", target_pubkey])?],
            ),
        };
        // relay-admin 事件另有 ±120 秒的 created_at 窗口作为重放守卫，
        // EventBuilder 用当前时间签名；Core 与 Relay 的时钟偏移超过该窗口
        // 会让全部 roster 投影失败，属于部署前提。
        let event = EventBuilder::new(Kind::Custom(kind), "")
            .tags(tags)
            .sign_with_keys(&self.keys)
            .map_err(|e| OperatorError::Sign(format!("sign: {e}")))?;
        let payload = serde_json::to_vec(&event).map_err(|e| OperatorError::Sign(e.to_string()))?;
        let accepted: Value = self.bridge_post(http, "/events", &payload).await?;
        Self::accepted_event_id(&accepted).map(|_| ())
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

    /// 从快照事件里取出 roster。
    ///
    /// 两种快照的标签形状不同，但角色都在最后一位：relay 面是
    /// `["member", pubkey, role]`，Channel 面是 `["p", pubkey, relay_url, role]`。
    /// 因此按标签名筛选后取首尾，而不是按固定下标读角色。
    fn roster_entries(page: &Value, tag_name: &str) -> Vec<RosterEntry> {
        let mut out = Vec::new();
        for ev in page.as_array().into_iter().flatten() {
            for tag in ev
                .get("tags")
                .and_then(|v| v.as_array())
                .into_iter()
                .flatten()
            {
                let parts: Vec<&str> = tag
                    .as_array()
                    .map(|a| a.iter().filter_map(|v| v.as_str()).collect())
                    .unwrap_or_default();
                if parts.first() != Some(&tag_name) || parts.len() < 3 {
                    continue;
                }
                out.push(RosterEntry {
                    pubkey: parts[1].to_ascii_lowercase(),
                    role: parts[parts.len() - 1].to_owned(),
                });
            }
        }
        out
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

/// Relay 接受上传后回传的媒体描述（Blossom BUD-02 的 blob descriptor）。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MediaDescriptor {
    pub url: String,
    pub sha256: String,
    pub size: u64,
    #[serde(rename = "type", default, skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
}

impl IdentityClient {
    /// 以该身份上传一份媒体（Blossom kind 24242）。
    ///
    /// `DD-39` 把 Relay media 也划进 BFF：Browser 不持 signer，因此这份授权事件
    /// 只能由 Core 以 actor 身份签。
    pub async fn upload_media(
        &self,
        http: &reqwest::Client,
        bytes: Vec<u8>,
        mime_type: &str,
    ) -> Result<MediaDescriptor, OperatorError> {
        let sha256 = hex::encode(Sha256::digest(&bytes));
        // `x` 标签必须与 X-SHA-256 头一致：上游按头查 `x` 标签，对不上即拒。
        // 两处各算一次会在实现漂移时给出一个不区分成因的 400。
        let auth = self.blossom_auth("upload", "Upload file", Some(&sha256))?;
        let url = self.transport.join("/upload")?;
        let resp = http
            .put(url)
            .header(reqwest::header::HOST, &self.community_host)
            .header("Authorization", auth)
            .header("Content-Type", mime_type)
            .header("X-SHA-256", &sha256)
            .body(bytes)
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

    /// 以该身份取回一份媒体，返回字节与 content-type。
    pub async fn fetch_media(
        &self,
        http: &reqwest::Client,
        path: &str,
    ) -> Result<(Vec<u8>, String), OperatorError> {
        // 路径由调用方给出，但必须限定在 media 命名空间内——放开它等于把
        // Relay 的整个 HTTP 面变成一个可代签的代理。
        if !path.starts_with("/media/") || path.contains("..") {
            return Err(OperatorError::Sign(format!(
                "媒体路径不在允许范围内: {path}"
            )));
        }
        let auth = self.blossom_auth("get", "Get media", None)?;
        let url = self.transport.join(path)?;
        let resp = http
            .get(url)
            .header(reqwest::header::HOST, &self.community_host)
            .header("Authorization", auth)
            .send()
            .await?;
        let status = resp.status();
        if !status.is_success() {
            return Err(OperatorError::Rejected {
                status: status.as_u16(),
                body: resp
                    .text()
                    .await
                    .unwrap_or_default()
                    .chars()
                    .take(200)
                    .collect(),
            });
        }
        let content_type = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("application/octet-stream")
            .to_owned();
        Ok((resp.bytes().await?.to_vec(), content_type))
    }

    /// 构造 Blossom 授权头。
    ///
    /// 编码用 base64url 无填充（BUD-11 规定的形式）。上游同时接受标准 base64
    /// 以兼容 nostr-tools，但兼容分支不是我们该依赖的东西。
    fn blossom_auth(
        &self,
        action: &str,
        content: &str,
        sha256: Option<&str>,
    ) -> Result<String, OperatorError> {
        let tag = |parts: [&str; 2]| {
            Tag::parse(parts).map_err(|e| OperatorError::Sign(format!("tag: {e}")))
        };
        // 过期时间是授权的上界。给死一个短窗口而不是让调用方指定：
        // 这份授权由 Core 代签，调用方没有理由决定它能用多久。
        let expiration = (std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| OperatorError::Sign(e.to_string()))?
            .as_secs()
            + BLOSSOM_AUTH_TTL_SECS)
            .to_string();
        let mut tags = vec![tag(["t", action])?];
        if let Some(x) = sha256 {
            tags.push(tag(["x", x])?);
        }
        tags.push(tag(["expiration", &expiration])?);
        tags.push(tag(["server", &self.community_host])?);

        let event = EventBuilder::new(Kind::Custom(KIND_BLOSSOM_AUTH), content)
            .tags(tags)
            .sign_with_keys(&self.keys)
            .map_err(|e| OperatorError::Sign(format!("Blossom 签名失败: {e}")))?;
        let json = serde_json::to_string(&event).map_err(|e| OperatorError::Sign(e.to_string()))?;
        Ok(format!(
            "Nostr {}",
            base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(json)
        ))
    }
}

/// Blossom 授权事件的 kind（BUD-01）。
const KIND_BLOSSOM_AUTH: u16 = 24242;
/// 授权有效期。短窗口：这份授权由 Core 代签，泄漏出去也只能用很短一段时间。
const BLOSSOM_AUTH_TTL_SECS: u64 = 600;
