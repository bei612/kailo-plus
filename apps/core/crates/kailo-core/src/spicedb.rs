//! Core 到 SpiceDB 的 fresh Check（`.design/03` §5、`.design/10` §1、ADR-10）。
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
    base: String,
    check_url: String,
    key: String,
}

/// 固定 schema 上的一条关系，主体恒为 `principal`（`.design/03` §5）。角色写入与
/// 读取只经这一个形状：组件注册不新增 object type，这里也不提供任意主体类型的通道。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Relationship {
    pub object_type: String,
    pub object_id: String,
    pub relation: String,
    pub subject_principal: String,
}

impl Relationship {
    fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "resource": { "objectType": self.object_type, "objectId": self.object_id },
            "relation": self.relation,
            "subject": { "object": { "objectType": "principal", "objectId": self.subject_principal } },
        })
    }
}

/// 读关系的过滤条件。object type 必填；其余为空即不限。
pub struct RelationshipFilter<'a> {
    pub object_type: &'a str,
    pub object_id: Option<&'a str>,
    pub relation: Option<&'a str>,
    pub subject_principal: Option<&'a str>,
}

/// 写入的方向：TOUCH 对已存在的关系幂等，DELETE 对不存在的关系也不报错，
/// 因此同一次写可以按同一意图安全重发。
#[derive(Clone, Copy, Debug)]
pub enum Write {
    Touch,
    Delete,
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
        let base = base.trim_end_matches('/').to_owned();
        Ok(Self {
            http,
            check_url: format!("{base}/v1/permissions/check"),
            base,
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

    /// 写一组关系，返回 SpiceDB 给出的 revision（`writtenAt`）。同一请求内的更新
    /// 原子生效。任何非 2xx、传输失败、回应不可解析都是结果不明——写可能已生效，
    /// 调用方只能以同一意图重发（写本身幂等），不得当成「没写」。
    pub async fn write(&self, updates: &[(Write, Relationship)]) -> Result<String, SpiceDbError> {
        let updates: Vec<serde_json::Value> = updates
            .iter()
            .map(|(op, rel)| {
                serde_json::json!({
                    "operation": match op {
                        Write::Touch => "OPERATION_TOUCH",
                        Write::Delete => "OPERATION_DELETE",
                    },
                    "relationship": rel.to_json(),
                })
            })
            .collect();
        let resp = self
            .http
            .post(format!("{}/v1/relationships/write", self.base))
            .bearer_auth(&self.key)
            .json(&serde_json::json!({ "updates": updates }))
            .send()
            .await
            .map_err(|e| SpiceDbError::Unavailable(e.to_string()))?;
        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            tracing::error!(%status, body = %text.chars().take(200).collect::<String>(), "SpiceDB 写关系未成功");
            return Err(SpiceDbError::Unavailable(format!("HTTP {status}")));
        }
        let v: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| SpiceDbError::Unavailable(format!("回应不可解析: {e}")))?;
        v.pointer("/writtenAt/token")
            .and_then(|t| t.as_str())
            .map(str::to_owned)
            .ok_or_else(|| SpiceDbError::Unavailable("回应缺 writtenAt".into()))
    }

    /// 以 FullyConsistent 读出满足过滤条件、主体为 principal 的全部关系。按 `page`
    /// 分页读到底：读一半就停等于把「还没读到」当成「不存在」，而角色判定恰恰
    /// 建立在「此外再没有别人」之上。
    pub async fn read(
        &self,
        filter: &RelationshipFilter<'_>,
        page: u32,
    ) -> Result<Vec<Relationship>, SpiceDbError> {
        let mut f = serde_json::json!({ "resourceType": filter.object_type });
        if let Some(id) = filter.object_id {
            f["optionalResourceId"] = id.into();
        }
        if let Some(r) = filter.relation {
            f["optionalRelation"] = r.into();
        }
        if let Some(s) = filter.subject_principal {
            f["optionalSubjectFilter"] =
                serde_json::json!({ "subjectType": "principal", "optionalSubjectId": s });
        }
        let mut out = vec![];
        let mut cursor: Option<String> = None;
        loop {
            let mut body = serde_json::json!({
                "consistency": { "fullyConsistent": true },
                "relationshipFilter": f,
                "optionalLimit": page,
            });
            if let Some(c) = &cursor {
                body["optionalCursor"] = serde_json::json!({ "token": c });
            }
            let resp = self
                .http
                .post(format!("{}/v1/relationships/read", self.base))
                .bearer_auth(&self.key)
                .json(&body)
                .send()
                .await
                .map_err(|e| SpiceDbError::Unavailable(e.to_string()))?;
            let status = resp.status();
            let text = resp
                .text()
                .await
                .map_err(|e| SpiceDbError::Unavailable(e.to_string()))?;
            if !status.is_success() {
                tracing::error!(%status, body = %text.chars().take(200).collect::<String>(), "SpiceDB 读关系未成功");
                return Err(SpiceDbError::Unavailable(format!("HTTP {status}")));
            }
            // 服务端流经 gateway 成为逐行 JSON：每行 {"result":…} 或 {"error":…}。
            // 中途出现 error 行说明流被截断，此前读到的不是完整集合。
            let mut n = 0u32;
            let mut last = None;
            for line in text.lines().filter(|l| !l.trim().is_empty()) {
                let v: serde_json::Value = serde_json::from_str(line)
                    .map_err(|e| SpiceDbError::Unavailable(format!("回应不可解析: {e}")))?;
                if v.get("error").is_some() {
                    return Err(SpiceDbError::Unavailable(format!("读关系流中断: {line}")));
                }
                let r = &v["result"]["relationship"];
                let s = |p: &str| r.pointer(p).and_then(|x| x.as_str()).map(str::to_owned);
                let (Some(ot), Some(oi), Some(rel), Some(st), Some(si)) = (
                    s("/resource/objectType"),
                    s("/resource/objectId"),
                    s("/relation"),
                    s("/subject/object/objectType"),
                    s("/subject/object/objectId"),
                ) else {
                    return Err(SpiceDbError::Unavailable(format!("关系形状不符: {line}")));
                };
                last = v
                    .pointer("/result/afterResultCursor/token")
                    .and_then(|x| x.as_str())
                    .map(str::to_owned);
                n += 1;
                // workspace#tenant 的主体是 tenant，不是角色，不返回
                if st == "principal" {
                    out.push(Relationship {
                        object_type: ot,
                        object_id: oi,
                        relation: rel,
                        subject_principal: si,
                    });
                }
            }
            if n < page {
                return Ok(out);
            }
            match last {
                Some(c) => cursor = Some(c),
                None => {
                    return Err(SpiceDbError::Unavailable(
                        "满页而没有续读游标：无法确定集合已读完".into(),
                    ))
                }
            }
        }
    }
}
