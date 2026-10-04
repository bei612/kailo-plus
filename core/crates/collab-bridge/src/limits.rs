//! Relay 上界与 Core 侧的调用预算（`SS-BUZ-SERVER-CLIENT`）。
//!
//! 两件事都在请求发往 Relay **之前**生效：
//!
//! - NIP-11 上界：`.design/03` §2 要求运行连接不得使用超出 ACTIVE binding 快照声明值的
//!   订阅、filter、limit 或 frame 合同；`.design/09`「BFF Relay 连接模型」要求 digest
//!   不一致时不能沿用未验证的旧上界。因此运行期重新读取文档，只有其 canonical digest
//!   与 binding 快照一致时才采用其中的上界；读不到或对不上即 fail closed。
//! - 调用预算：Relay 按 (Community, pubkey) 对 `/events`、`/query`、`/count` 共用一个
//!   每分钟额度（上游 `api/bridge.rs::enforce_http_admission`），`apps/07` §5 要求 BFF
//!   先行设界、明确拒绝，而不是把压力透传给 Relay。预算数值是部署登记值，不在这里定。

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::Value;
use sha2::{Digest, Sha256};
use url::Url;

use crate::operator::OperatorError;

/// NIP-11 `limitation` 中 Core 会用到的上界。
///
/// DD-114(3) 的四项（`max_subscriptions`、`max_filters`、`max_limit`、`max_message_length`）
/// 缺一即整份文档不可用：缺一个上界就没有东西可比，而把缺失当成「无上界」正是
/// `.design/09` 禁止的「沿用未验证的上界」。`max_subid_length` 不在这四项之内，
/// 声明了才预检。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RelayLimits {
    /// 每连接的并发订阅数（`max_subscriptions`）
    pub max_subscriptions: usize,
    /// 每个 REQ 的 filter 数（`max_filters`）
    pub max_filters: usize,
    /// filter 的 `limit` 上界（`max_limit`）
    pub max_limit: i64,
    /// 订阅 id 的长度上界（`max_subid_length`），未声明为 `None`
    pub max_subid_length: Option<usize>,
    /// WebSocket 单帧上界（`max_message_length`）
    pub max_message_length: usize,
}

impl RelayLimits {
    pub fn from_nip11(doc: &Value) -> Result<Self, OperatorError> {
        let limitation = doc
            .get("limitation")
            .ok_or_else(|| OperatorError::Sign("NIP-11 缺 limitation".into()))?;
        let field = |name: &str| -> Result<u64, OperatorError> {
            limitation
                .get(name)
                .and_then(Value::as_u64)
                .filter(|v| *v > 0)
                .ok_or_else(|| OperatorError::Sign(format!("NIP-11 limitation 缺正整数 {name}")))
        };
        let size = |name: &str| -> Result<usize, OperatorError> {
            usize::try_from(field(name)?)
                .map_err(|_| OperatorError::Sign(format!("NIP-11 {name} 超出可表示范围")))
        };
        Ok(Self {
            max_subscriptions: size("max_subscriptions")?,
            max_filters: size("max_filters")?,
            max_limit: i64::try_from(field("max_limit")?)
                .map_err(|_| OperatorError::Sign("NIP-11 max_limit 超出可表示范围".into()))?,
            max_subid_length: match limitation.get("max_subid_length") {
                None => None,
                Some(_) => Some(size("max_subid_length")?),
            },
            max_message_length: size("max_message_length")?,
        })
    }
}

/// 一份已抓取的 NIP-11 文档。
#[derive(Debug, Clone)]
pub struct Nip11Document {
    /// `.design/03` §8 的 canonical digest，与 binding 快照比对用
    pub digest: String,
    pub limits: RelayLimits,
}

/// `.design/03` §8 的全局 digest 规则：结构化对象按 canonical JSON（键排序、无无意义
/// 空白、UTF-8）序列化再 sha256，十六进制表示。
///
/// 唯一实现：binding 激活时写快照（`tenant_lifecycle::verify_tenant_buzz`）与运行期核对
/// （`web_transport::relay_limits`）都调用它，两侧因此逐字节一致。
///
/// `serde_json::Value` 的 `Map` 默认按插入序，因此必须显式重排；直接对响应原文取
/// hash 会让上游换一次字段顺序就产生一个新 digest。
pub fn canonical_digest(v: &Value) -> String {
    hex::encode(Sha256::digest(canonical_json(v).as_bytes()))
}

/// The exact bytes hashed by canonical_digest. Consumers forwarding a frozen
/// request use these bytes rather than introducing another JSON serializer.
pub fn canonical_json(v: &Value) -> String {
    fn canon(v: &Value) -> Value {
        match v {
            Value::Object(m) => {
                let mut keys: Vec<&String> = m.keys().collect();
                keys.sort();
                Value::Object(
                    keys.into_iter()
                        .map(|k| (k.clone(), canon(&m[k])))
                        .collect(),
                )
            }
            Value::Array(a) => Value::Array(a.iter().map(canon).collect()),
            other => other.clone(),
        }
    }
    canon(v).to_string()
}

/// 按 Community host 抓 NIP-11。
///
/// 与 binding 激活时同一个入口（`/info`）、同一个 Host 头：Relay 按 Host 绑定
/// Community，用网络地址抓到的是另一个 Community 的文档（`SF-BUZ-32`）。
pub async fn fetch_nip11(
    http: &reqwest::Client,
    transport: &Url,
    community_host: &str,
) -> Result<Nip11Document, OperatorError> {
    let resp = http
        .get(transport.join("/info")?)
        .header(reqwest::header::HOST, community_host)
        .send()
        .await?;
    let status = resp.status();
    if !status.is_success() {
        return Err(OperatorError::Rejected {
            status: status.as_u16(),
            body: String::new(),
        });
    }
    let doc: Value = resp.json().await?;
    Ok(Nip11Document {
        digest: canonical_digest(&doc),
        limits: RelayLimits::from_nip11(&doc)?,
    })
}

/// 运行期 NIP-11 读取，按 Community host 缓存 `ttl`。
///
/// `ttl` 是「Relay 改变上界后 Core 最迟多久察觉」的时间窗，是部署登记值。
/// 过期后重新抓取；抓取失败不回退到旧文档——那就是沿用未验证的上界。
pub struct Nip11Cache {
    transport: Url,
    ttl: Duration,
    entries: Mutex<HashMap<String, (Instant, Arc<Nip11Document>)>>,
}

impl Nip11Cache {
    pub fn new(transport: &str, ttl: Duration) -> Result<Self, OperatorError> {
        Ok(Self {
            transport: Url::parse(transport)?,
            ttl,
            entries: Mutex::new(HashMap::new()),
        })
    }

    pub async fn get(
        &self,
        http: &reqwest::Client,
        community_host: &str,
    ) -> Result<Arc<Nip11Document>, OperatorError> {
        let now = Instant::now();
        {
            let mut entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
            // 过期条目顺手清掉：缓存只为省抓取，不为保留历史
            entries.retain(|_, (at, _)| now.duration_since(*at) < self.ttl);
            if let Some((_, doc)) = entries.get(community_host) {
                return Ok(Arc::clone(doc));
            }
        }
        let doc = Arc::new(fetch_nip11(http, &self.transport, community_host).await?);
        self.entries
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(
                community_host.to_owned(),
                (Instant::now(), Arc::clone(&doc)),
            );
        Ok(doc)
    }
}

/// Core 对每个 (Community host, pubkey) 的 Relay HTTP 调用预算。
///
/// 滑动窗口：任意长度为 `window` 的区间内至多 `calls` 次。用滑动而不是固定窗口，
/// 是因为 Relay 的固定窗口与这里的窗口起点对不齐——固定窗口在两个窗口交界处
/// 可以放出两倍额度，落进 Relay 的同一个窗口；滑动窗口保证任何一段 `window`
/// 都不超过 `calls`，于是只要登记值不超过 Relay 的 tier 额度，Relay 就不会因
/// Core 的调用回 429。
pub struct ApiBudget {
    calls: usize,
    window: Duration,
    slots: Mutex<Slots>,
}

struct Slots {
    used: HashMap<(String, String), VecDeque<Instant>>,
    last_prune: Instant,
}

impl ApiBudget {
    pub fn new(calls: usize, window: Duration) -> Result<Self, OperatorError> {
        if calls == 0 || window.is_zero() {
            return Err(OperatorError::Sign("Relay 调用预算与窗口都必须为正".into()));
        }
        Ok(Self {
            calls,
            window,
            slots: Mutex::new(Slots {
                used: HashMap::new(),
                last_prune: Instant::now(),
            }),
        })
    }

    /// 取一次额度。取不到时返回窗口内最早一次调用滑出窗口前还要等的秒数（向上取整）。
    pub fn try_acquire(&self, community_host: &str, pubkey: &str) -> Result<(), OperatorError> {
        let now = Instant::now();
        let mut slots = self.slots.lock().unwrap_or_else(|e| e.into_inner());
        let window = self.window;
        let expired = |at: &Instant| now.duration_since(*at) >= window;
        // 每过一个窗口清一次整表：窗口外没有调用的键不再占内存
        if now.duration_since(slots.last_prune) >= window {
            slots.used.retain(|_, q| !q.back().is_some_and(expired));
            slots.last_prune = now;
        }
        let q = slots
            .used
            .entry((community_host.to_owned(), pubkey.to_owned()))
            .or_default();
        while q.front().is_some_and(expired) {
            q.pop_front();
        }
        if q.len() >= self.calls {
            let oldest = *q.front().expect("满额时队列非空");
            let wait = window.saturating_sub(now.duration_since(oldest));
            let secs = wait.as_secs() + u64::from(wait.subsec_nanos() > 0);
            return Err(OperatorError::BudgetExhausted {
                retry_after_secs: secs.max(1),
            });
        }
        q.push_back(now);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limits_require_every_bound() {
        let doc = serde_json::json!({"limitation": {
            "max_message_length": 524288, "max_subscriptions": 1024, "max_filters": 10,
            "max_limit": 1000, "max_subid_length": 256}});
        let l = RelayLimits::from_nip11(&doc).expect("完整文档可解析");
        assert_eq!(l.max_filters, 10);
        assert_eq!(l.max_limit, 1000);
        for missing in [
            "max_message_length",
            "max_subscriptions",
            "max_filters",
            "max_limit",
        ] {
            let mut d = doc.clone();
            d["limitation"].as_object_mut().unwrap().remove(missing);
            assert!(
                RelayLimits::from_nip11(&d).is_err(),
                "缺 {missing} 必须不可用，而不是当作无上界"
            );
        }
    }

    #[test]
    fn digest_is_sha256_of_compact_sorted_json() {
        // 快照一侧（binding 激活时）按键排序、紧凑 JSON 取 sha256；两侧逐字节一致
        // 才可能比对成功。这里把期望的 canonical 文本写出来，而不是拿同一个函数自比。
        let a = serde_json::json!({"b": 1, "a": {"y": 2, "x": [1, {"q": 1, "p": 2}]}});
        let canonical = r#"{"a":{"x":[1,{"p":2,"q":1}],"y":2},"b":1}"#;
        assert_eq!(
            canonical_digest(&a),
            hex::encode(Sha256::digest(canonical.as_bytes()))
        );
    }

    #[test]
    fn budget_is_per_identity_and_sliding() {
        let b = ApiBudget::new(2, Duration::from_secs(60)).expect("预算");
        b.try_acquire("h", "k1").expect("第 1 次");
        b.try_acquire("h", "k1").expect("第 2 次");
        let err = b.try_acquire("h", "k1").expect_err("第 3 次必须被拒");
        assert!(matches!(
            err,
            OperatorError::BudgetExhausted { retry_after_secs } if (1..=60).contains(&retry_after_secs)
        ));
        // 另一个身份、另一个 Community 各有自己的额度
        b.try_acquire("h", "k2").expect("另一个 pubkey");
        b.try_acquire("h2", "k1").expect("另一个 Community");
    }

    #[test]
    fn budget_slides_call_by_call() {
        // 滑动而非整窗清零：最早一次滑出窗口即恢复一次额度，而较晚那次仍占着
        let window = Duration::from_millis(200);
        let b = ApiBudget::new(2, window).expect("预算");
        b.try_acquire("h", "k").expect("t0");
        std::thread::sleep(Duration::from_millis(120));
        b.try_acquire("h", "k").expect("t1");
        assert!(b.try_acquire("h", "k").is_err(), "窗口内已满");
        std::thread::sleep(Duration::from_millis(120));
        b.try_acquire("h", "k").expect("t0 滑出窗口后恢复一次");
        assert!(
            b.try_acquire("h", "k").is_err(),
            "t1 仍在窗口内，只恢复一次"
        );
    }
}
