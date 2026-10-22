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
pub enum Consistency<'a> {
    /// 准入、重新准入与审批者资格：即将发生外部副作用且无因果 token
    FullyConsistent,
    /// 列表与发现：允许低延迟，但点击动作仍 fresh Check
    MinimizeLatency,
    /// 同一关系写入后的因果检查，至少读到其原生 writtenAt revision。
    AtLeastAsFresh(&'a str),
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

/// DD-122 (1)：原生 Tool Resource 上授予 `tenant:<tenant_id>#member` 的全部 relation。
/// 权限公式不变，成员资格由 Tenant 的 `member` 关系动态展开。
pub(crate) const TENANT_MEMBER_GRANTS: [&str; 3] = ["discoverer", "consumer", "sharer"];
/// DD-131(6)、03 §5：目录分享只为 `agent.definition` 与 `agent.team` 写入的 `tenant#member`
/// 授予（唯一写者是 `agent.definition.share` / `agent.team.share`）。只表示同 Tenant 成员可
/// 发现与读取，不授予 Installation 使用权或 `export`。
pub(crate) const CATALOG_SHARE_GRANTS: [&str; 2] = ["discoverer", "reader"];
/// 主体集 `tenant#member` 的 relation 名。
const MEMBER_RELATION: &str = "member";

/// 固定 schema 上一条关系的主体（`.design/03` §5）。角色、授予与投影的主体都是
/// `principal`；唯一的主体集是 DD-122 (1) 只写在原生 Tool Resource 的
/// discoverer/consumer/sharer 上的 `tenant:<tenant_id>#member`——它代表该 Tenant
/// 的每个有效成员，不是任何一个 principal。组件注册不新增 object type，这里也不
/// 提供任意主体类型的通道。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Subject {
    /// `principal:<id>`
    Principal(String),
    /// `tenant:<tenant_id>#member`
    TenantMembers(String),
}

impl Subject {
    /// SpiceDB 原生 SubjectReference。
    fn to_json(&self) -> serde_json::Value {
        match self {
            Self::Principal(id) => {
                serde_json::json!({ "object": { "objectType": "principal", "objectId": id } })
            }
            Self::TenantMembers(tenant) => {
                let object = serde_json::json!({ "objectType": "tenant", "objectId": tenant });
                serde_json::json!({ "object": object, "optionalRelation": MEMBER_RELATION })
            }
        }
    }

    /// 从原生 SubjectReference 读回。无 relation 的非 principal 主体是 object 箭头
    /// （Resource 的 tenant/home_workspace、Workspace 的 tenant 等），不是授予主体，
    /// 返回 `Ok(None)`；固定 schema 不允许的主体集与缺字段都是形状错误。
    fn from_json(subject: &serde_json::Value) -> Result<Option<Self>, SpiceDbError> {
        let text = |p: &str| subject.pointer(p).and_then(serde_json::Value::as_str);
        let kind = text("/object/objectType");
        let id = text("/object/objectId").filter(|id| !id.is_empty());
        let (Some(kind), Some(id)) = (kind, id) else {
            return Err(SpiceDbError::Unavailable("关系主体形状不符".into()));
        };
        let set = text("/optionalRelation").filter(|r| !r.is_empty());
        match (kind, set) {
            ("principal", None) => Ok(Some(Self::Principal(id.to_owned()))),
            ("tenant", Some(MEMBER_RELATION)) => Ok(Some(Self::TenantMembers(id.to_owned()))),
            (_, None) => Ok(None),
            (_, Some(_)) => Err(SpiceDbError::Unavailable("未知主体集".into())),
        }
    }

    /// 证据串中的规范写法：`principal:<id>` 或 `tenant:<id>#member`；其余不认。
    pub fn parse(text: &str) -> Option<Self> {
        let canonical = |id: &str| !id.is_empty() && !id.contains(['#', ':', '@']);
        if let Some(id) = text.strip_prefix("principal:") {
            return canonical(id).then(|| Self::Principal(id.to_owned()));
        }
        let id = text.strip_prefix("tenant:")?.strip_suffix("#member")?;
        canonical(id).then(|| Self::TenantMembers(id.to_owned()))
    }
}

impl std::fmt::Display for Subject {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Principal(id) => write!(f, "principal:{id}"),
            Self::TenantMembers(tenant) => write!(f, "tenant:{tenant}#{MEMBER_RELATION}"),
        }
    }
}

/// 固定 schema 上的一条关系。角色写入与读取、授予与撤销都经这一个形状；主体见
/// [`Subject`]。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Relationship {
    pub object_type: String,
    pub object_id: String,
    pub relation: String,
    pub subject: Subject,
}

impl Relationship {
    fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "resource": { "objectType": self.object_type, "objectId": self.object_id },
            "relation": self.relation,
            "subject": self.subject.to_json(),
        })
    }

    /// principal 主体的 ID。主体集不是任何一个 principal，返回 `None`：按
    /// principal 判定的读者（角色、Agent 授予、撤销复读）必须显式跳过它。
    pub fn principal(&self) -> Option<&str> {
        match &self.subject {
            Subject::Principal(id) => Some(id.as_str()),
            Subject::TenantMembers(_) => None,
        }
    }

    /// DD-131(6)：一个定义或团队对本 Tenant 每个有效成员的目录授予。
    pub(crate) fn catalog_share_grants(resource: &str, tenant: &str) -> [Self; 2] {
        CATALOG_SHARE_GRANTS.map(|relation| Self {
            object_type: "resource".into(),
            object_id: resource.to_owned(),
            relation: relation.into(),
            subject: Subject::TenantMembers(tenant.to_owned()),
        })
    }

    /// DD-122 (1)：原生 Tool 对本 Tenant 每个有效成员的全部授予。
    pub(crate) fn tenant_member_grants(tool: &str, tenant: &str) -> [Self; 3] {
        TENANT_MEMBER_GRANTS.map(|relation| Self {
            object_type: "resource".into(),
            object_id: tool.to_owned(),
            relation: relation.into(),
            subject: Subject::TenantMembers(tenant.to_owned()),
        })
    }

    /// 原生 ReadRelationships 的一行；object 箭头返回 `Ok(None)`。
    fn from_native(r: &serde_json::Value) -> Result<Option<Self>, SpiceDbError> {
        let s = |p: &str| r.pointer(p).and_then(|x| x.as_str()).map(str::to_owned);
        let (Some(object_type), Some(object_id), Some(relation)) = (
            s("/resource/objectType"),
            s("/resource/objectId"),
            s("/relation"),
        ) else {
            return Err(SpiceDbError::Unavailable("关系形状不符".into()));
        };
        let subject = r
            .get("subject")
            .ok_or_else(|| SpiceDbError::Unavailable("关系缺主体".into()))?;
        let Some(subject) = Subject::from_json(subject)? else {
            return Ok(None);
        };
        Ok(Some(Self {
            object_type,
            object_id,
            relation,
            subject,
        }))
    }
}

impl std::fmt::Display for Relationship {
    /// 证据与日志的规范写法 `<type>:<id>#<relation>@<subject>`。
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{}:{}#{}@{}",
            self.object_type, self.object_id, self.relation, self.subject
        )
    }
}

/// 一个 Resource 上观察到的 tenant/owner/home Workspace 投影与 DD-122 成员授予。
#[derive(Debug, Default)]
struct ResourceProjection {
    owners: Vec<String>,
    tenants: Vec<String>,
    workspaces: Vec<String>,
    member_grants: Vec<String>,
}

impl ResourceProjection {
    /// 别的对象、caveat、固定形状之外的箭头或主体集都使投影不可核验（`None`）。
    /// 主体集只认 DD-122 (1) 本 Tenant 的 `tenant#member` 授予：它与 principal 授予
    /// 一样不参与 tenant/owner/home 判定；指向别的 Tenant 的成员集是跨 Tenant 错写。
    /// 「只写在原生 Tool 上」由唯一写者（部署引导）保证，原生 Tool 的完整授予由
    /// [`NativeToolProjection`] 核对。
    fn observe(rows: &[serde_json::Value], id: &str, tenant: &str) -> Option<Self> {
        let mut seen = Self::default();
        for r in rows {
            let text = |p: &str| r.pointer(p).and_then(serde_json::Value::as_str);
            if text("/resource/objectType") != Some("resource")
                || text("/resource/objectId") != Some(id)
                || text("/optionalCaveat/caveatName").is_some_and(|x| !x.is_empty())
            {
                return None;
            }
            let relation = text("/relation");
            let subject_type = text("/subject/object/objectType");
            let subject = text("/subject/object/objectId").unwrap_or_default();
            if let Some(set) = text("/subject/optionalRelation").filter(|x| !x.is_empty()) {
                let grant = relation.filter(|rel| {
                    TENANT_MEMBER_GRANTS.contains(rel) || CATALOG_SHARE_GRANTS.contains(rel)
                })?;
                let members = set == MEMBER_RELATION && subject_type == Some("tenant");
                if !members || subject != tenant {
                    return None;
                }
                seen.member_grants.push(grant.to_owned());
                continue;
            }
            match (relation, subject_type) {
                (Some("owner"), Some("principal")) => seen.owners.push(subject.to_owned()),
                (Some("tenant"), Some("tenant")) => seen.tenants.push(subject.to_owned()),
                (Some("home_workspace"), Some("workspace")) => {
                    seen.workspaces.push(subject.to_owned())
                }
                (Some("owner" | "tenant" | "home_workspace"), _) => return None,
                _ => {}
            }
        }
        Some(seen)
    }

    /// DD-131(6)：本 Tenant 成员同时持有目录的 discoverer 与 reader。
    fn catalog_shared(&self) -> bool {
        CATALOG_SHARE_GRANTS
            .iter()
            .all(|grant| self.member_grants.iter().any(|g| g == grant))
    }

    fn closes(&self, tenant: &str, owner: &str, workspace: Option<&str>) -> bool {
        self.owners == [owner]
            && self.tenants == [tenant]
            && match workspace {
                Some(workspace) => self.workspaces == [workspace],
                None => self.workspaces.is_empty(),
            }
    }
}

/// DD-122 (1) 原生 Tool 投影的对账结论。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum NativeToolProjection {
    /// tenant/owner 投影闭合，且本 Tenant 成员持有全部 DD-122 授予。
    Closed,
    /// tenant/owner 投影闭合，成员授予缺全部或一部分：引导可补写。
    MembersMissing,
    /// 投影与 Core 事实不符或不可核验：需对账，引导不改写。
    Mismatch,
}

impl NativeToolProjection {
    fn of(rows: &[serde_json::Value], id: &str, tenant: &str, owner: &str) -> Self {
        match ResourceProjection::observe(rows, id, tenant) {
            // 目录 reader 授予只属于定义与团队；出现在原生 Tool 上即与唯一写者不符。
            Some(seen)
                if seen.closes(tenant, owner, None)
                    && seen
                        .member_grants
                        .iter()
                        .all(|g| TENANT_MEMBER_GRANTS.contains(&g.as_str())) =>
            {
                let held = |grant: &&str| seen.member_grants.iter().any(|g| g == grant);
                if TENANT_MEMBER_GRANTS.iter().all(held) {
                    Self::Closed
                } else {
                    Self::MembersMissing
                }
            }
            _ => Self::Mismatch,
        }
    }
}

/// [`SpiceDb::check_bulk_principals`] 的一项。
#[derive(Debug, Clone, Copy)]
pub(crate) struct BulkCheck<'a> {
    pub object_type: &'a str,
    pub object_id: &'a str,
    pub permission: &'a str,
    pub principal: &'a str,
}

/// 校验一块 CheckBulkPermissions 回应并按请求顺序给出结论。
fn bulk_principal_results(
    chunk: &[BulkCheck<'_>],
    value: &serde_json::Value,
) -> Result<Vec<bool>, SpiceDbError> {
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
    if pairs.len() != chunk.len() {
        return Err(SpiceDbError::Unavailable("批量 Check 回应条数不符".into()));
    }
    chunk
        .iter()
        .zip(pairs)
        .map(|(item, pair)| {
            let echo = |p: &str| pair.pointer(p).and_then(serde_json::Value::as_str);
            if echo("/request/resource/objectType") != Some(item.object_type)
                || echo("/request/resource/objectId") != Some(item.object_id)
                || echo("/request/permission") != Some(item.permission)
                || echo("/request/subject/object/objectType") != Some("principal")
                || echo("/request/subject/object/objectId") != Some(item.principal)
            {
                return Err(SpiceDbError::Unavailable(
                    "批量 Check 回显与请求不符".into(),
                ));
            }
            if pair.get("error").is_some() {
                return Err(SpiceDbError::Unavailable("批量 Check 含 item error".into()));
            }
            match echo("/item/permissionship") {
                Some("PERMISSIONSHIP_HAS_PERMISSION") => Ok(true),
                Some("PERMISSIONSHIP_NO_PERMISSION" | "PERMISSIONSHIP_CONDITIONAL_PERMISSION") => {
                    Ok(false)
                }
                _ => Err(SpiceDbError::Unavailable("批量 Check 权限值未知".into())),
            }
        })
        .collect()
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
    #[cfg(test)]
    pub(crate) fn for_test(base: String) -> Self {
        Self {
            http: reqwest::Client::new(),
            check_url: format!("{base}/v1/permissions/check"),
            base,
            key: "isolated-test-service".into(),
        }
    }

    /// Tenant 删除只删除一个明确 object 的全部关系（含 workspace#tenant 与原生
    /// Tool 上 DD-122 的 `tenant#member` 授予），再以 FullyConsistent 原生
    /// ReadRelationships 查证为空。过滤只按 object，不按主体：不经只返回授予主体的
    /// 角色列表读取，否则会遗漏 workspace 的 tenant 箭头。
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
        consistency: Consistency<'_>,
    ) -> Result<Checked, SpiceDbError> {
        let consistency = match consistency {
            Consistency::FullyConsistent => serde_json::json!({ "fullyConsistent": true }),
            Consistency::MinimizeLatency => serde_json::json!({ "minimizeLatency": true }),
            Consistency::AtLeastAsFresh(token) if !token.is_empty() => {
                serde_json::json!({ "atLeastAsFresh": { "token": token } })
            }
            Consistency::AtLeastAsFresh(_) => {
                return Err(SpiceDbError::Unavailable(
                    "因果检查缺少写入 revision".into(),
                ));
            }
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

    /// 一组 `(object_type, object_id, permission, principal)` 的 FullyConsistent
    /// CheckBulkPermissions，结果与输入逐项对齐。用于固定对象、多个主体的判定（如成员
    /// 目录的 Tenant/Workspace `manage`，`.design/07` §4.7.4）。分块请求；任一块的
    /// item error、条数不符、回显与请求不符或未知 permissionship 都让整体失败，
    /// 不拿部分结论当成完整判定。
    pub(crate) async fn check_bulk_principals(
        &self,
        items: &[BulkCheck<'_>],
    ) -> Result<Vec<bool>, SpiceDbError> {
        const CHUNK: usize = 100;
        let mut allowed = Vec::with_capacity(items.len());
        for chunk in items.chunks(CHUNK) {
            let request: Vec<_> = chunk
                .iter()
                .map(|item| {
                    serde_json::json!({
                        "resource": { "objectType": item.object_type, "objectId": item.object_id },
                        "permission": item.permission,
                        "subject": { "object": { "objectType": "principal", "objectId": item.principal } },
                    })
                })
                .collect();
            let resp = self
                .http
                .post(format!("{}/v1/permissions/checkbulk", self.base))
                .bearer_auth(&self.key)
                .json(&serde_json::json!({
                    "consistency": { "fullyConsistent": true },
                    "items": request,
                }))
                .send()
                .await
                .map_err(|e| SpiceDbError::Unavailable(e.to_string()))?;
            let status = resp.status();
            if !status.is_success() {
                tracing::warn!(%status, "SpiceDB 批量主体 Check 未成功");
                return Err(SpiceDbError::Unavailable(format!("HTTP {status}")));
            }
            let value: serde_json::Value = resp
                .json()
                .await
                .map_err(|e| SpiceDbError::Unavailable(format!("回应不可解析: {e}")))?;
            allowed.extend(bulk_principal_results(chunk, &value)?);
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

    /// 真实 Core Resource 的 tenant/owner/home Workspace 在同一次原生写入中投影。
    /// 旧角色 Relationship 的 principal-only 形状不承担 tenant object 箭头。
    pub(crate) async fn replace_resource_projection(
        &self,
        id: &str,
        tenant: &str,
        old_owner: &str,
        owner: &str,
        workspace: Option<&str>,
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
        if let Some(workspace) = workspace {
            updates.push(serde_json::json!({"operation":"OPERATION_TOUCH",
                "relationship":relationship("home_workspace","workspace",workspace)}));
        }
        self.write_native_updates(updates).await
    }

    pub(crate) async fn resource_projection_matches(
        &self,
        id: &str,
        tenant: &str,
        owner: &str,
        page: u32,
    ) -> Result<bool, SpiceDbError> {
        self.resource_projection_matches_in_workspace(id, tenant, owner, None, page)
            .await
    }

    /// tenant/owner/home Workspace 投影与 Core 事实一致。principal 授予与本 Tenant 的
    /// DD-122 成员授予不参与判定；其余主体集、caveat 与重复箭头都不一致。
    pub(crate) async fn resource_projection_matches_in_workspace(
        &self,
        id: &str,
        tenant: &str,
        owner: &str,
        workspace: Option<&str>,
        page: u32,
    ) -> Result<bool, SpiceDbError> {
        let rows = self.read_resource(id, page).await?;
        let seen = ResourceProjection::observe(&rows, id, tenant);
        Ok(seen.is_some_and(|p| p.closes(tenant, owner, workspace)))
    }

    /// DD-131(6)：Tenant 级定义或团队的 tenant/owner 投影闭合时，返回本 Tenant 成员是否持有
    /// 全部目录授予；投影与 Core 事实不符或不可核验时为 `None`。
    pub(crate) async fn catalog_projection(
        &self,
        id: &str,
        tenant: &str,
        owner: &str,
        page: u32,
    ) -> Result<Option<bool>, SpiceDbError> {
        let rows = self.read_resource(id, page).await?;
        Ok(ResourceProjection::observe(&rows, id, tenant)
            .filter(|p| p.closes(tenant, owner, None))
            .map(|p| p.catalog_shared()))
    }

    /// DD-122 (1)：原生 Tool 的 tenant/owner 投影与本 Tenant 成员的全部授予。
    pub(crate) async fn native_tool_projection(
        &self,
        id: &str,
        tenant: &str,
        owner: &str,
        page: u32,
    ) -> Result<NativeToolProjection, SpiceDbError> {
        let rows = self.read_resource(id, page).await?;
        Ok(NativeToolProjection::of(&rows, id, tenant, owner))
    }

    async fn read_resource(
        &self,
        id: &str,
        page: u32,
    ) -> Result<Vec<serde_json::Value>, SpiceDbError> {
        self.read_native(
            &RelationshipFilter {
                object_type: "resource",
                object_id: Some(id),
                relation: None,
                subject_principal: None,
            },
            page,
        )
        .await
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

    /// 以 FullyConsistent 读出满足过滤条件的全部授予关系：主体为 principal，或
    /// DD-122 (1) 的 `tenant#member` 主体集；object 箭头不是授予，不在其中。按
    /// `page` 分页读到底：读一半就停等于把「还没读到」当成「不存在」，而角色判定
    /// 恰恰建立在「此外再没有别人」之上。按 principal 判定的调用方用
    /// [`Relationship::principal`]，主体集不会被当成某个 principal。
    pub async fn read(
        &self,
        filter: &RelationshipFilter<'_>,
        page: u32,
    ) -> Result<Vec<Relationship>, SpiceDbError> {
        let mut out = vec![];
        for r in self.read_native(filter, page).await? {
            if let Some(relationship) = Relationship::from_native(&r)? {
                out.push(relationship);
            }
        }
        Ok(out)
    }

    pub(crate) async fn read_native(
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn row(relation: &str, subject: serde_json::Value) -> serde_json::Value {
        json!({
            "resource": { "objectType": "resource", "objectId": "tool" },
            "relation": relation,
            "subject": subject,
        })
    }

    fn object(kind: &str, id: &str) -> serde_json::Value {
        json!({ "object": { "objectType": kind, "objectId": id } })
    }

    fn members(tenant: &str) -> serde_json::Value {
        json!({
            "object": { "objectType": "tenant", "objectId": tenant },
            "optionalRelation": "member",
        })
    }

    #[test]
    fn subjects_serialize_as_native_references() {
        let principal = Relationship {
            object_type: "tenant".into(),
            object_id: "t".into(),
            relation: "admin".into(),
            subject: Subject::Principal("p".into()),
        };
        assert_eq!(
            principal.to_json(),
            json!({
                "resource": { "objectType": "tenant", "objectId": "t" },
                "relation": "admin",
                "subject": { "object": { "objectType": "principal", "objectId": "p" } },
            })
        );
        assert_eq!(principal.principal(), Some("p"));
        assert_eq!(principal.to_string(), "tenant:t#admin@principal:p");
        let grants = Relationship::tenant_member_grants("tool", "t");
        let relations: Vec<&str> = grants.iter().map(|g| g.relation.as_str()).collect();
        assert_eq!(relations, ["discoverer", "consumer", "sharer"]);
        let resource = json!({ "objectType": "resource", "objectId": "tool" });
        for grant in &grants {
            assert_eq!(grant.principal(), None);
            assert_eq!(grant.to_json()["resource"], resource);
            assert_eq!(grant.to_json()["subject"], members("t"));
        }
        assert_eq!(
            grants[1].to_string(),
            "resource:tool#consumer@tenant:t#member"
        );
    }

    #[test]
    fn readers_parse_principals_and_member_sets_without_confusing_them() {
        let read = |subject| Relationship::from_native(&row("consumer", subject));
        let principal = read(object("principal", "p")).unwrap().unwrap();
        assert_eq!(principal.subject, Subject::Principal("p".into()));
        let set = read(members("t")).unwrap().unwrap();
        assert_eq!(set.subject, Subject::TenantMembers("t".into()));
        assert_eq!(set.principal(), None);
        // object 箭头不是授予主体，读者不拿到它
        assert!(read(object("tenant", "t")).unwrap().is_none());
        assert!(read(object("workspace", "w")).unwrap().is_none());
        // 固定 schema 之外的主体集与缺字段都是形状错误，不被当成 principal
        let admins = json!({
            "object": { "objectType": "tenant", "objectId": "t" },
            "optionalRelation": "admin",
        });
        assert!(read(admins).is_err());
        let principal_set = json!({
            "object": { "objectType": "principal", "objectId": "p" },
            "optionalRelation": "member",
        });
        assert!(read(principal_set).is_err());
        assert!(read(object("principal", "")).is_err());
        assert!(read(json!({})).is_err());
        assert!(Relationship::from_native(&json!({ "relation": "consumer" })).is_err());
    }

    #[test]
    fn evidence_subjects_round_trip() {
        for subject in [
            Subject::Principal("p".into()),
            Subject::TenantMembers("t".into()),
        ] {
            assert_eq!(Subject::parse(&subject.to_string()), Some(subject));
        }
        for bad in [
            "principal:",
            "principal:p#member",
            "tenant:t",
            "tenant:t#admin",
            "tenant:#member",
            "workspace:w#member",
        ] {
            assert_eq!(Subject::parse(bad), None, "{bad}");
        }
    }

    #[test]
    fn native_tool_projection_requires_every_member_grant_of_its_own_tenant() {
        let base = [
            row("tenant", object("tenant", "t")),
            row("owner", object("principal", "o")),
            row("discoverer", object("principal", "agent")),
        ];
        let of = |rows: &[serde_json::Value]| NativeToolProjection::of(rows, "tool", "t", "o");
        assert_eq!(of(&base), NativeToolProjection::MembersMissing);
        let mut granted = base.to_vec();
        for relation in TENANT_MEMBER_GRANTS {
            granted.push(row(relation, members("t")));
        }
        assert_eq!(of(&granted), NativeToolProjection::Closed);
        let partial = &granted[..granted.len() - 1];
        assert_eq!(of(partial), NativeToolProjection::MembersMissing);
        // 成员授予不改变通用 tenant/owner/home 判定
        let generic = ResourceProjection::observe(&granted, "tool", "t");
        assert!(generic.is_some_and(|seen| seen.closes("t", "o", None)));
        let other_owner = NativeToolProjection::of(&granted, "tool", "t", "o2");
        assert_eq!(other_owner, NativeToolProjection::Mismatch);
        // 别的 Tenant 的成员集、非授予 relation 上的主体集、caveat、多余 owner 都不一致
        for wrong in [
            row("consumer", members("other")),
            row("owner", members("t")),
            row("owner", object("principal", "o2")),
            json!({
                "resource": { "objectType": "resource", "objectId": "tool" },
                "relation": "sharer",
                "subject": members("t"),
                "optionalCaveat": { "caveatName": "c" },
            }),
        ] {
            let mut rows = granted.clone();
            rows.push(wrong);
            assert_eq!(of(&rows), NativeToolProjection::Mismatch);
            let generic = ResourceProjection::observe(&rows, "tool", "t");
            assert!(!generic.is_some_and(|seen| seen.closes("t", "o", None)));
        }
        // DD-131(6)：目录 reader 授予不改变通用判定，但不属于原生 Tool。
        let mut catalog = granted.clone();
        catalog.push(row("reader", members("t")));
        assert_eq!(of(&catalog), NativeToolProjection::Mismatch);
        let generic = ResourceProjection::observe(&catalog, "tool", "t");
        assert!(generic.is_some_and(|seen| seen.closes("t", "o", None)));
    }

    #[test]
    fn catalog_share_requires_both_member_grants_of_its_own_tenant() {
        let base = vec![
            row("tenant", object("tenant", "t")),
            row("owner", object("principal", "o")),
        ];
        let seen = |rows: &[serde_json::Value]| ResourceProjection::observe(rows, "tool", "t");
        assert!(seen(&base).is_some_and(|p| p.closes("t", "o", None) && !p.catalog_shared()));
        let mut shared = base.clone();
        for relation in CATALOG_SHARE_GRANTS {
            shared.push(row(relation, members("t")));
        }
        assert!(seen(&shared).is_some_and(|p| p.closes("t", "o", None) && p.catalog_shared()));
        let mut half = base.clone();
        half.push(row("reader", members("t")));
        assert!(seen(&half).is_some_and(|p| !p.catalog_shared()));
        let mut foreign = base;
        foreign.push(row("reader", members("other")));
        assert!(seen(&foreign).is_none());
        let grants = Relationship::catalog_share_grants("d", "t");
        assert_eq!(grants[1].to_string(), "resource:d#reader@tenant:t#member");
    }
}
