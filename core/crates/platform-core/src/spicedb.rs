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

use std::collections::HashSet;

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
    /// Tenant 删除只删除一个明确 object 的全部关系（含 workspace#tenant），
    /// 再以 FullyConsistent 原生 ReadRelationships 查证为空。不经只返回
    /// principal 关系的角色列表读取，否则会遗漏 workspace 的 tenant 箭头。
    pub async fn delete_object(
        &self,
        http: &reqwest::Client,
        object_type: &str,
        object_id: uuid::Uuid,
    ) -> Result<String, SpiceDbError> {
        if !matches!(object_type, "tenant" | "workspace" | "resource" | "asset") {
            return Err(SpiceDbError::Unavailable("非本批删除 object type".into()));
        }
        let filter = serde_json::json!({
            "resourceType": object_type,
            "optionalResourceId": object_id.to_string(),
        });
        let response = http
            .post(format!("{}/v1/relationships/delete", self.base))
            .bearer_auth(&self.key)
            .json(&serde_json::json!({ "relationshipFilter": filter }))
            .send()
            .await
            .map_err(|e| SpiceDbError::Unavailable(e.to_string()))?;
        if !response.status().is_success() {
            return Err(SpiceDbError::Unavailable(format!(
                "删除关系 HTTP {}",
                response.status()
            )));
        }
        let result: serde_json::Value = response
            .json()
            .await
            .map_err(|e| SpiceDbError::Unavailable(e.to_string()))?;
        let token = result
            .pointer("/deletedAt/token")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| SpiceDbError::Unavailable("删除关系缺 revision".into()))?;
        if result.get("deletionProgress").and_then(|v| v.as_str())
            != Some("DELETION_PROGRESS_COMPLETE")
        {
            return Err(SpiceDbError::Unavailable("关系仅部分删除或终态未知".into()));
        }
        let observed = http
            .post(format!("{}/v1/relationships/read", self.base))
            .bearer_auth(&self.key)
            .json(&serde_json::json!({
                "consistency": { "fullyConsistent": true },
                "relationshipFilter": filter,
                // 这是存在性查证，不是有上界的资源枚举：任何一行即未删除。
                "optionalLimit": 1,
            }))
            .send()
            .await
            .map_err(|e| SpiceDbError::Unavailable(e.to_string()))?;
        if !observed.status().is_success() {
            return Err(SpiceDbError::Unavailable(format!(
                "删除回读 HTTP {}",
                observed.status()
            )));
        }
        let text = observed
            .text()
            .await
            .map_err(|e| SpiceDbError::Unavailable(e.to_string()))?;
        if text.lines().any(|line| !line.trim().is_empty()) {
            return Err(SpiceDbError::Unavailable(
                "删除关系后仍有数据或流错误".into(),
            ));
        }
        Ok(token.to_owned())
    }

    pub(crate) async fn delete_resource_projection(
        &self,
        id: uuid::Uuid,
    ) -> Result<String, SpiceDbError> {
        self.delete_object(&self.http, "resource", id).await
    }

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
        let allowed = match r.permissionship.as_str() {
            "PERMISSIONSHIP_HAS_PERMISSION" => true,
            "PERMISSIONSHIP_NO_PERMISSION" => false,
            _ => {
                return Err(SpiceDbError::Unavailable("未支持的 permissionship".into()));
            }
        };
        Ok(Checked {
            allowed,
            zed_token: r.checked_at.map(|t| t.token).unwrap_or_default(),
        })
    }

    /// Core 自有索引先分页，再由同一次 FullyConsistent CheckBulkPermissions 过滤这一
    /// 页（`.design/03` §5）。任何 item error、遗漏、重复或未知 permissionship 都让
    /// 整页失败；不能拿部分结果显示为完整的可管理 Workspace 列表。
    pub async fn check_bulk(
        &self,
        object_type: &str,
        object_ids: &[String],
        permission: &str,
        subject_principal: &str,
    ) -> Result<HashSet<String>, SpiceDbError> {
        if object_ids.is_empty() {
            return Ok(HashSet::new());
        }
        let items: Vec<_> = object_ids
            .iter()
            .map(|id| {
                serde_json::json!({
                    "resource": { "objectType": object_type, "objectId": id },
                    "permission": permission,
                    "subject": { "object": { "objectType": "principal", "objectId": subject_principal } },
                })
            })
            .collect();
        let resp = self
            .http
            .post(format!("{}/v1/permissions/checkbulk", self.base))
            .bearer_auth(&self.key)
            .json(&serde_json::json!({
                "consistency": { "fullyConsistent": true },
                "items": items,
            }))
            .send()
            .await
            .map_err(|e| SpiceDbError::Unavailable(e.to_string()))?;
        let status = resp.status();
        if !status.is_success() {
            tracing::warn!(%status, "SpiceDB 批量 Check 未成功");
            return Err(SpiceDbError::Unavailable(format!("HTTP {status}")));
        }
        let value: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| SpiceDbError::Unavailable(format!("回应不可解析: {e}")))?;
        if value
            .pointer("/checkedAt/token")
            .and_then(serde_json::Value::as_str)
            .is_none_or(str::is_empty)
        {
            return Err(SpiceDbError::Unavailable(
                "批量 Check 缺 fresh revision".into(),
            ));
        }
        let pairs = value["pairs"]
            .as_array()
            .ok_or_else(|| SpiceDbError::Unavailable("批量 Check 缺 pairs".into()))?;
        if pairs.len() != object_ids.len() {
            return Err(SpiceDbError::Unavailable("批量 Check 回应条数不符".into()));
        }
        let expected: HashSet<&str> = object_ids.iter().map(String::as_str).collect();
        if expected.len() != object_ids.len() {
            return Err(SpiceDbError::Unavailable(
                "批量 Check 请求有重复对象".into(),
            ));
        }
        let mut seen = HashSet::new();
        let mut allowed = HashSet::new();
        for pair in pairs {
            let id = pair
                .pointer("/request/resource/objectId")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| SpiceDbError::Unavailable("批量 Check 缺资源 ID".into()))?;
            if !expected.contains(id) || !seen.insert(id) {
                return Err(SpiceDbError::Unavailable(
                    "批量 Check 回应对象不符或重复".into(),
                ));
            }
            if pair.get("error").is_some() {
                return Err(SpiceDbError::Unavailable("批量 Check 含 item error".into()));
            }
            match pair
                .pointer("/item/permissionship")
                .and_then(serde_json::Value::as_str)
            {
                Some("PERMISSIONSHIP_HAS_PERMISSION") => {
                    allowed.insert(id.to_owned());
                }
                Some("PERMISSIONSHIP_NO_PERMISSION" | "PERMISSIONSHIP_CONDITIONAL_PERMISSION") => {}
                _ => return Err(SpiceDbError::Unavailable("批量 Check 权限值未知".into())),
            }
        }
        Ok(allowed)
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
        self.write_native_updates(updates).await
    }

    async fn write_native_updates(
        &self,
        updates: Vec<serde_json::Value>,
    ) -> Result<String, SpiceDbError> {
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

    /// 真实 Core Resource 的 tenant/owner 在同一次原生 WriteRelationships 中替换。
    /// 旧角色 Relationship 的 principal-only 形状不承担 tenant object 箭头。
    pub(crate) async fn replace_resource_projection(
        &self,
        id: &str,
        tenant: &str,
        old_owner: &str,
        owner: &str,
    ) -> Result<String, SpiceDbError> {
        let relationship = |relation: &str, subject_type: &str, subject: &str| {
            serde_json::json!({
                "resource":{"objectType":"resource","objectId":id},"relation":relation,
                "subject":{"object":{"objectType":subject_type,"objectId":subject}}
            })
        };
        let mut updates = vec![serde_json::json!({"operation":"OPERATION_TOUCH",
            "relationship":relationship("tenant","tenant",tenant)})];
        if old_owner != owner {
            updates.push(serde_json::json!({"operation":"OPERATION_DELETE",
                "relationship":relationship("owner","principal",old_owner)}));
        }
        updates.push(serde_json::json!({"operation":"OPERATION_TOUCH",
            "relationship":relationship("owner","principal",owner)}));
        self.write_native_updates(updates).await
    }

    pub(crate) async fn resource_projection_matches(
        &self,
        id: &str,
        tenant: &str,
        owner: &str,
        page: u32,
    ) -> Result<bool, SpiceDbError> {
        let rows = self
            .read_native(
                &RelationshipFilter {
                    object_type: "resource",
                    object_id: Some(id),
                    relation: None,
                    subject_principal: None,
                },
                page,
            )
            .await?;
        let mut owners = vec![];
        let mut tenants = vec![];
        for r in rows {
            let text = |p: &str| r.pointer(p).and_then(serde_json::Value::as_str);
            if text("/resource/objectType") != Some("resource")
                || text("/resource/objectId") != Some(id)
                || text("/subject/optionalRelation").is_some_and(|x| !x.is_empty())
                || text("/optionalCaveat/caveatName").is_some_and(|x| !x.is_empty())
            {
                return Ok(false);
            }
            match text("/relation") {
                Some("owner") if text("/subject/object/objectType") == Some("principal") => owners
                    .push(
                        text("/subject/object/objectId")
                            .unwrap_or_default()
                            .to_owned(),
                    ),
                Some("tenant") if text("/subject/object/objectType") == Some("tenant") => tenants
                    .push(
                        text("/subject/object/objectId")
                            .unwrap_or_default()
                            .to_owned(),
                    ),
                Some("home_workspace") => return Ok(false),
                Some("owner" | "tenant") => return Ok(false),
                _ => {}
            }
        }
        Ok(owners == [owner] && tenants == [tenant])
    }

    /// Asset 自己的 owner 关系不从 Resource owner 推断；同一原生事务固定父与 Tenant。
    pub(crate) async fn write_asset_projection(
        &self,
        id: &str,
        tenant: &str,
        resource: &str,
        owner: &str,
    ) -> Result<String, SpiceDbError> {
        let relationships = [
            ("tenant", "tenant", tenant),
            ("resource", "resource", resource),
            ("owner", "principal", owner),
        ];
        let updates = relationships
            .into_iter()
            .map(|(relation, subject_type, subject)| {
                serde_json::json!({
                    "operation":"OPERATION_TOUCH",
                    "relationship":{
                        "resource":{"objectType":"asset","objectId":id},"relation":relation,
                        "subject":{"object":{"objectType":subject_type,"objectId":subject}}
                    }
                })
            })
            .collect();
        self.write_native_updates(updates).await
    }

    pub(crate) async fn asset_projection_matches(
        &self,
        id: &str,
        tenant: &str,
        resource: &str,
        owner: &str,
        page: u32,
    ) -> Result<bool, SpiceDbError> {
        let rows = self
            .read_native(
                &RelationshipFilter {
                    object_type: "asset",
                    object_id: Some(id),
                    relation: None,
                    subject_principal: None,
                },
                page,
            )
            .await?;
        let mut observed = std::collections::HashMap::new();
        for r in rows {
            let text = |p: &str| r.pointer(p).and_then(serde_json::Value::as_str);
            if text("/resource/objectType") != Some("asset")
                || text("/resource/objectId") != Some(id)
                || text("/subject/optionalRelation").is_some_and(|s| !s.is_empty())
                || text("/optionalCaveat/caveatName").is_some_and(|s| !s.is_empty())
            {
                return Ok(false);
            }
            let relation = text("/relation")
                .ok_or_else(|| SpiceDbError::Unavailable("Asset 关系缺 relation".into()))?;
            if matches!(relation, "tenant" | "resource" | "owner") {
                let subject_type = text("/subject/object/objectType").unwrap_or_default();
                let subject = text("/subject/object/objectId").unwrap_or_default();
                if observed
                    .insert(
                        relation.to_owned(),
                        (subject_type.to_owned(), subject.to_owned()),
                    )
                    .is_some()
                {
                    return Ok(false);
                }
            }
        }
        Ok(
            observed.get("tenant") == Some(&("tenant".into(), tenant.into()))
                && observed.get("resource") == Some(&("resource".into(), resource.into()))
                && observed.get("owner") == Some(&("principal".into(), owner.into())),
        )
    }

    pub(crate) async fn delete_asset_projection(
        &self,
        id: uuid::Uuid,
    ) -> Result<String, SpiceDbError> {
        self.delete_object(&self.http, "asset", id).await
    }

    /// 以 FullyConsistent 读出满足过滤条件、主体为 principal 的全部关系。按 `page`
    /// 分页读到底：读一半就停等于把「还没读到」当成「不存在」，而角色判定恰恰
    /// 建立在「此外再没有别人」之上。
    pub async fn read(
        &self,
        filter: &RelationshipFilter<'_>,
        page: u32,
    ) -> Result<Vec<Relationship>, SpiceDbError> {
        let mut out = vec![];
        for r in self.read_native(filter, page).await? {
            let s = |p: &str| r.pointer(p).and_then(|x| x.as_str()).map(str::to_owned);
            let (Some(ot), Some(oi), Some(rel), Some(st), Some(si)) = (
                s("/resource/objectType"),
                s("/resource/objectId"),
                s("/relation"),
                s("/subject/object/objectType"),
                s("/subject/object/objectId"),
            ) else {
                return Err(SpiceDbError::Unavailable("关系形状不符".into()));
            };
            if st == "principal" {
                out.push(Relationship {
                    object_type: ot,
                    object_id: oi,
                    relation: rel,
                    subject_principal: si,
                });
            }
        }
        Ok(out)
    }

    async fn read_native(
        &self,
        filter: &RelationshipFilter<'_>,
        page: u32,
    ) -> Result<Vec<serde_json::Value>, SpiceDbError> {
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
                // 同一原生分页能力服务角色读取与 Resource tenant/owner 查证。
                // 完整原生形状保留在当前请求内，不写 Core 权限正文副本。
                let _ = (ot, oi, rel, st, si);
                out.push(r.clone());
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
