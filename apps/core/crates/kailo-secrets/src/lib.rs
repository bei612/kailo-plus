//! SecretRef 解析（`DD-70`、`.design/03` §9）。
//!
//! SecretRef 只是 locator：`provider=OPENBAO`、`locator=<namespace>/<mount>/<path>`、
//! `version` 为 KV v2 版本号、`audience` 为允许取用的 service identity。本 crate
//! 把 locator 换成内存中的 secret 值，此外什么都不做——**值不写数据库、不写日志、
//! 不落盘**，因此这里既没有 `Debug` 派生，也没有任何 `to_string`。
//!
//! Core 以 AppRole 换取短 TTL service token，不持有长期凭据。token 过期即重新
//! 登录；不做后台续期——续期失败与过期是同一种情况，重新登录能同时覆盖两者。

use std::sync::Arc;

use serde::Deserialize;
use tokio::sync::RwLock;

#[derive(Debug, thiserror::Error)]
pub enum SecretError {
    #[error("locator 必须形如 <namespace>/<mount>/<path>，得到 {0}")]
    LocatorMalformed(String),
    #[error("SecretRef 的 audience 与本服务身份不符")]
    AudienceMismatch,
    #[error("指定版本不存在或不可读")]
    VersionUnavailable,
    #[error("OpenBao 不可达: {0}")]
    Transport(#[from] reqwest::Error),
    #[error("AppRole 登录失败")]
    LoginFailed,
    #[error("OpenBao 的回应不可解析")]
    Malformed,
}

/// 一条 SecretRef。字段与 `.design/03` §9 的定义一一对应。
#[derive(Debug, Clone)]
pub struct SecretRef {
    pub locator: String,
    /// KV v2 版本号。必填且精确：不取 latest——binding 冻结的是某个具体版本，
    /// 取 latest 会让一次无关的轮换悄悄改变已 active 的 binding 行为。
    pub version: u32,
    pub audience: String,
}

/// 取回的 secret 值。
///
/// 不实现 `Debug`/`Display`/`Serialize`：任何一个都会给「把它打出来」开一扇门。
/// 需要用它的地方显式调 `expose`，让每个取用点在代码里可见、可审。
pub struct SecretValue(String);

impl SecretValue {
    pub fn expose(&self) -> &str {
        &self.0
    }
}

/// 一个 AppRole 登录会话：某个 namespace 下的 role 与它换来的 service token。
///
/// Core 有两个：平台 namespace 下取用 secret 的那个，与 root namespace 下只读
/// audit 表的那个（`AuditObserver`）。登录与令牌缓存只写这一份。
struct AppRoleSession {
    addr: String,
    /// AppRole 挂载所在的 namespace；空串是 root namespace（不带请求头）
    namespace: String,
    role_id: String,
    secret_id: String,
    http: reqwest::Client,
    token: RwLock<Option<Arc<String>>>,
}

impl AppRoleSession {
    fn new(addr: &str, namespace: String, role_id: String, secret_id: String) -> Self {
        Self {
            addr: addr.trim_end_matches('/').to_owned(),
            namespace,
            role_id,
            secret_id,
            http: reqwest::Client::new(),
            token: RwLock::new(None),
        }
    }

    fn with_namespace(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        if self.namespace.is_empty() {
            req
        } else {
            req.header("X-Vault-Namespace", &self.namespace)
        }
    }

    async fn token(&self, force: bool) -> Result<Arc<String>, SecretError> {
        if !force {
            if let Some(t) = self.token.read().await.clone() {
                return Ok(t);
            }
        }
        let resp = self
            .with_namespace(
                self.http
                    .post(format!("{}/v1/auth/approle/login", self.addr)),
            )
            .json(&serde_json::json!({
                "role_id": self.role_id,
                "secret_id": self.secret_id,
            }))
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(SecretError::LoginFailed);
        }
        let parsed: LoginResponse = resp.json().await?;
        let token = Arc::new(parsed.auth.client_token);
        *self.token.write().await = Some(Arc::clone(&token));
        Ok(token)
    }
}

pub struct SecretStore {
    session: AppRoleSession,
    /// 本服务的身份。SecretRef 的 audience 必须等于它，否则拒绝取用——
    /// 同一把 secret 不得被用于它不该服务的调用方（`DD-70`）。
    identity: String,
}

#[derive(Deserialize)]
struct LoginResponse {
    auth: LoginAuth,
}
#[derive(Deserialize)]
struct LoginAuth {
    client_token: String,
}
#[derive(Deserialize)]
struct KvResponse {
    data: KvOuter,
}
#[derive(Deserialize)]
struct KvOuter {
    data: std::collections::HashMap<String, String>,
    metadata: KvMetadata,
}
#[derive(Deserialize)]
struct KvMetadata {
    version: u32,
}
#[derive(Deserialize)]
struct KvWriteResponse {
    data: KvMetadata,
}

impl SecretStore {
    /// 四项配置都不接受默认值：缺任一项即拒绝构造。回落到某个猜测的地址或
    /// 身份，会让「取不到 secret 就 fail closed」退化成「取到了别人的 secret」。
    pub fn from_env() -> Result<Self, String> {
        let get = |k: &str| std::env::var(k).map_err(|_| format!("缺少 {k}"));
        // AppRole 挂在平台 namespace 下；取用的 secret 可能在别的 namespace，
        // 二者是不同的请求头值，不能混用。
        Ok(Self {
            session: AppRoleSession::new(
                &get("OPENBAO_ADDR")?,
                get("OPENBAO_PLATFORM_NAMESPACE")?,
                get("OPENBAO_ROLE_ID")?,
                get("OPENBAO_SECRET_ID")?,
            ),
            identity: get("OPENBAO_SERVICE_IDENTITY")?,
        })
    }

    /// 按 SecretRef 取出某个字段的值。
    ///
    /// 成功的判据包含**返回的版本号等于请求的版本号**：KV v2 在版本被删除时
    /// 仍返回 200 与空 data，只靠状态码会把「已删除」读成「拿到了」。
    pub async fn read(&self, r: &SecretRef, field: &str) -> Result<SecretValue, SecretError> {
        if r.audience != self.identity {
            return Err(SecretError::AudienceMismatch);
        }
        let (namespace, mount, path) = split_locator(&r.locator)?;

        let mut body = self.fetch(&namespace, &mount, &path, r.version).await?;
        // token 过期表现为 403；重新登录后再试一次，不把它当成取不到
        if body.is_none() {
            self.session.token(true).await?;
            body = self.fetch(&namespace, &mount, &path, r.version).await?;
        }
        let body = body.ok_or(SecretError::VersionUnavailable)?;

        if body.data.metadata.version != r.version {
            return Err(SecretError::VersionUnavailable);
        }
        body.data
            .data
            .get(field)
            .cloned()
            .map(SecretValue)
            .ok_or(SecretError::VersionUnavailable)
    }

    /// 写入一个新版本，返回该版本号。
    ///
    /// 只写不删：策略没给 `delete`/`destroy`，secret 的撤销是受治理动作而不是
    /// 运维旁路（`.design/03` §9）。因此这里永远是追加一个新版本，旧版本保留
    /// 供在途执行按其冻结的版本号继续取用。
    ///
    /// 返回的是 KV v2 给的版本号，不是本地推算的。调用方把它连同 locator 与
    /// audience 一起存成 SecretRef——推算出来的版本号在并发写入下会指向别人的值。
    pub async fn write(&self, locator: &str, field: &str, value: &str) -> Result<u32, SecretError> {
        let (namespace, mount, path) = split_locator(locator)?;
        let mut version = self.put(&namespace, &mount, &path, field, value).await?;
        if version.is_none() {
            self.session.token(true).await?;
            version = self.put(&namespace, &mount, &path, field, value).await?;
        }
        version.ok_or(SecretError::VersionUnavailable)
    }

    async fn put(
        &self,
        namespace: &str,
        mount: &str,
        path: &str,
        field: &str,
        value: &str,
    ) -> Result<Option<u32>, SecretError> {
        let token = self.session.token(false).await?;
        let resp = self
            .session
            .http
            .post(format!("{}/v1/{mount}/data/{path}", self.session.addr))
            .header("X-Vault-Namespace", namespace)
            .header("X-Vault-Token", token.as_str())
            .json(&serde_json::json!({ "data": { field: value } }))
            .send()
            .await?;
        match resp.status().as_u16() {
            200 => {
                let body: KvWriteResponse = resp.json().await?;
                Ok(Some(body.data.version))
            }
            401 | 403 => Ok(None),
            _ => Err(SecretError::VersionUnavailable),
        }
    }

    /// 返回 `None` 表示「凭据被拒」，由调用方决定是否重新登录；
    /// 其余失败原样返回，不与「凭据问题」混为一谈。
    async fn fetch(
        &self,
        namespace: &str,
        mount: &str,
        path: &str,
        version: u32,
    ) -> Result<Option<KvResponse>, SecretError> {
        let token = self.session.token(false).await?;
        let resp = self
            .session
            .http
            .get(format!("{}/v1/{mount}/data/{path}", self.session.addr))
            .query(&[("version", version.to_string())])
            .header("X-Vault-Namespace", namespace)
            .header("X-Vault-Token", token.as_str())
            .send()
            .await?;
        match resp.status().as_u16() {
            200 => Ok(Some(resp.json().await?)),
            // 401/403 是凭据问题，404 是版本/路径不存在——两者不同
            401 | 403 => Ok(None),
            404 => Err(SecretError::VersionUnavailable),
            _ => Err(SecretError::VersionUnavailable),
        }
    }
}

/// 部署 audit device 清单的观察者（`DD-70`、`07` §1）。
///
/// OpenBao 的 audit fail-closed 只在已启用至少一个 device 时成立：零 device 时
/// 取用照常通过、不留任何痕迹（`SF-OBA-06`）。配置里写了 audit 块不等于它此刻
/// 生效，因此 Core 在启动时与每次把 binding 推进到 ACTIVE 之前，都实际读一次
/// `sys/audit`。
///
/// `sys/audit` 只在 root namespace 可用且要求 `sudo`（`SF-OBA-06`、上游
/// `restrictedSysAPIs`），平台 namespace 的 token 读不到它；所以这里是一个独立
/// 的 root namespace AppRole，策略只有这一条路径的 `read`+`sudo`。
pub struct AuditObserver {
    session: AppRoleSession,
}

#[derive(Deserialize)]
struct AuditTable {
    data: std::collections::HashMap<String, serde_json::Value>,
}

impl AuditObserver {
    pub fn from_env() -> Result<Self, String> {
        let get = |k: &str| std::env::var(k).map_err(|_| format!("缺少 {k}"));
        Ok(Self {
            session: AppRoleSession::new(
                &get("OPENBAO_ADDR")?,
                String::new(),
                get("OPENBAO_AUDIT_ROLE_ID")?,
                get("OPENBAO_AUDIT_SECRET_ID")?,
            ),
        })
    }

    /// 当前启用的 audit device 数。`Ok(0)` 是确定的「没有」，调用方必须 fail
    /// closed；`Err` 是没观察到，同样不能当作「有」。
    pub async fn enabled_devices(&self) -> Result<usize, SecretError> {
        let mut forced = false;
        loop {
            let token = self.session.token(forced).await?;
            let resp = self
                .session
                .http
                .get(format!("{}/v1/sys/audit", self.session.addr))
                .header("X-Vault-Token", token.as_str())
                .send()
                .await?;
            match resp.status().as_u16() {
                200 => {
                    let table: AuditTable =
                        resp.json().await.map_err(|_| SecretError::Malformed)?;
                    return Ok(table.data.len());
                }
                // 令牌过期：重新登录再问一次，仍被拒就是凭据问题
                401 | 403 if !forced => forced = true,
                401 | 403 => return Err(SecretError::LoginFailed),
                _ => return Err(SecretError::Malformed),
            }
        }
    }
}

/// locator 必须恰好三段。多一段少一段都不做兼容解析——猜错一段就是去另一个
/// namespace 或另一个 mount 取值，而那不会报错，只会悄悄拿到别的东西。
fn split_locator(locator: &str) -> Result<(String, String, String), SecretError> {
    let mut parts = locator.splitn(3, '/');
    match (parts.next(), parts.next(), parts.next()) {
        (Some(ns), Some(mount), Some(path))
            if !ns.is_empty() && !mount.is_empty() && !path.is_empty() =>
        {
            Ok((ns.to_owned(), mount.to_owned(), path.to_owned()))
        }
        _ => Err(SecretError::LocatorMalformed(locator.to_owned())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locator_must_have_three_parts() {
        assert!(split_locator("platform/kv/buzz/control").is_ok());
        for bad in ["platform/kv", "platform", "", "/kv/path", "platform//path"] {
            assert!(split_locator(bad).is_err(), "{bad} 应被拒绝");
        }
    }

    #[test]
    fn path_may_contain_slashes() {
        // 第三段是完整路径，内部的 / 属于它，不再继续切分
        let (ns, mount, path) = split_locator("platform/kv/buzz/control/t-1").unwrap();
        assert_eq!(
            (ns.as_str(), mount.as_str(), path.as_str()),
            ("platform", "kv", "buzz/control/t-1")
        );
    }
}
