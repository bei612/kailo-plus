//! SecretRef 解析（`DD-70`、`.design/03` §9）。
//!
//! SecretRef 只是 locator：`provider=OPENBAO`、`locator=<namespace>/<mount>/<path>`、
//! `version` 为 KV v2 版本号、`audience` 为允许取用的 service identity。本 crate
//! 把 locator 换成内存中的 secret 值，此外什么都不做——**值不写数据库、不写日志、
//! 不落盘**，因此这里既没有 `Debug` 派生，也没有任何 `to_string`。
//!
//! 引导凭据（`DD-70`、`.design/03` §9）：部署以 response wrapping 一次性投递 AppRole
//! `secret_id`。启动时先核对 wrapping token 的创建路径就是本 role 的 secret-id，再
//! unwrap、登录，然后自检该 secret_id 已不能再登录（`secret_id_num_uses=1`）。从此
//! 只在内存里持有 service token，按 lease 续期；不再有能重新登录的凭据。wrapping
//! token 已被消费、过期或来路不对，都按泄漏处理并拒绝启动；运行中续期被确定拒绝
//! （令牌被撤销），同样 fail closed，由部署重新投递。

use std::sync::Arc;
use std::time::Duration;

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
    #[error("凭据被拒或路径不在策略内")]
    Refused,
    #[error("OpenBao 不可达: {0}")]
    Transport(#[from] reqwest::Error),
    #[error("AppRole 登录失败")]
    LoginFailed,
    /// wrapping token 不能用：已被消费、已过期，或不是本 role 的 secret-id 签出的。
    /// 三种都按泄漏处理（`DD-70`）。
    #[error("引导凭据的 wrapping token 不可用，按泄漏处理: {0}")]
    WrappingRejected(String),
    /// secret_id 在一次登录后仍能再登录：role 没有配成单次使用。
    #[error("引导 secret_id 可重复登录：role 必须配置 secret_id_num_uses=1")]
    SecretIdReusable,
    #[error("引导失败后 service token 撤销未确认，必须处置该凭据")]
    RevocationUnconfirmed,
    /// 内存里的 service token 已不可用（被撤销或过期），且没有可重新登录的凭据。
    #[error("service token 已失效，需要部署重新投递引导凭据")]
    CredentialLost,
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

#[derive(Deserialize)]
struct LoginResponse {
    auth: LoginAuth,
}
#[derive(Deserialize)]
struct LoginAuth {
    client_token: String,
    accessor: String,
    lease_duration: u64,
    renewable: bool,
}
#[derive(Deserialize)]
struct WrapLookup {
    data: WrapLookupData,
}
#[derive(Deserialize)]
struct WrapLookupData {
    creation_path: String,
}
#[derive(Deserialize)]
struct Unwrapped {
    data: UnwrappedSecret,
}
#[derive(Deserialize)]
struct UnwrappedSecret {
    secret_id: String,
}

/// 持有中的 service token 与它的 lease。
struct Lease {
    token: Arc<String>,
    ttl: Duration,
}

/// 一个 AppRole 登录会话：某个 namespace 下的 role 与它换来的 service token。
///
/// Core 有两个：平台 namespace 下取用 secret 的那个，与 root namespace 下只读
/// audit 表的那个（`AuditObserver`）。投递、登录与续期只写这一份。
struct AppRoleSession {
    addr: String,
    /// AppRole 挂载所在的 namespace；空串是 root namespace（不带请求头）
    namespace: String,
    role_id: String,
    /// wrapping token 的创建路径必须是它：`auth/approle/role/<name>/secret-id`
    role_name: String,
    /// 一次性的 wrapping token。connect 之后即为 None。
    wrapped: tokio::sync::Mutex<Option<String>>,
    http: reqwest::Client,
    lease: RwLock<Option<Lease>>,
}

impl AppRoleSession {
    fn new(
        addr: &str,
        namespace: String,
        role_id: String,
        role_name: String,
        wrapped: String,
    ) -> Self {
        Self {
            addr: addr.trim_end_matches('/').to_owned(),
            namespace,
            role_id,
            role_name,
            wrapped: tokio::sync::Mutex::new(Some(wrapped)),
            http: reqwest::Client::new(),
            lease: RwLock::new(None),
        }
    }

    fn with_namespace(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        if self.namespace.is_empty() {
            req
        } else {
            req.header("X-Vault-Namespace", &self.namespace)
        }
    }

    /// 核对 → unwrap → 登录 → 单次使用自检。只能成功一次：wrapping token 在这里
    /// 被消费，之后再也没有能换出新 token 的东西。
    async fn connect(&self) -> Result<(), SecretError> {
        let wrapped = self
            .wrapped
            .lock()
            .await
            .take()
            .ok_or_else(|| SecretError::WrappingRejected("已经使用过".to_owned()))?;

        // 1. 来路：wrapping token 必须是本 role 的 secret-id 端点签出的。换成别的
        //    wrapping token（哪怕同样有效）就是把别人的响应当成自己的凭据。
        let want = format!("auth/approle/role/{}/secret-id", self.role_name);
        let resp = self
            .with_namespace(
                self.http
                    .post(format!("{}/v1/sys/wrapping/lookup", self.addr)),
            )
            .json(&serde_json::json!({ "token": wrapped }))
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(SecretError::WrappingRejected(format!(
                "lookup HTTP {}（已被消费或已过期）",
                resp.status().as_u16()
            )));
        }
        let lookup: WrapLookup = resp.json().await.map_err(|_| SecretError::Malformed)?;
        if lookup.data.creation_path != want {
            return Err(SecretError::WrappingRejected(format!(
                "创建路径是 {}，不是 {want}",
                lookup.data.creation_path
            )));
        }

        // 2. unwrap。lookup 与 unwrap 之间被别人抢先消费，这里会失败——那正是
        //    「按泄漏处理」要捕获的情形。
        let resp = self
            .with_namespace(
                self.http
                    .post(format!("{}/v1/sys/wrapping/unwrap", self.addr)),
            )
            .header("X-Vault-Token", &wrapped)
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(SecretError::WrappingRejected(format!(
                "unwrap HTTP {}",
                resp.status().as_u16()
            )));
        }
        let secret_id = resp
            .json::<Unwrapped>()
            .await
            .map_err(|_| SecretError::Malformed)?
            .data
            .secret_id;

        // 3. 登录
        let auth = self
            .login(&secret_id)
            .await?
            .ok_or(SecretError::LoginFailed)?;
        // 4. 自检：同一 secret_id 必须已经不能登录。能登录说明 role 没配成单次
        //    使用，泄漏的 secret_id 可以无限换 token——拒绝启动。校验完成前
        //    不把首个 token 放进可供 Core 使用的 lease；任何拒绝分支先撤销它。
        let verified = async {
            if !auth.renewable || auth.lease_duration == 0 {
                return Err(SecretError::Malformed);
            }
            match self.login(&secret_id).await? {
                None => Ok(()),
                Some(extra) => {
                    self.revoke_self(&extra.client_token).await?;
                    Err(SecretError::SecretIdReusable)
                }
            }
        }
        .await;
        if let Err(reason) = verified {
            self.revoke_self(&auth.client_token).await?;
            return Err(reason);
        }
        tracing::info!(
            namespace = %self.namespace,
            role = %self.role_name,
            accessor = %auth.accessor,
            ttl = auth.lease_duration,
            "OpenBao 引导凭据已换成 service token"
        );
        *self.lease.write().await = Some(Lease {
            token: Arc::new(auth.client_token),
            ttl: Duration::from_secs(auth.lease_duration),
        });
        Ok(())
    }

    async fn revoke_self(&self, token: &str) -> Result<(), SecretError> {
        let result = self
            .with_namespace(
                self.http
                    .put(format!("{}/v1/auth/token/revoke-self", self.addr)),
            )
            .header("X-Vault-Token", token)
            .send()
            .await;
        match result {
            Ok(response) if response.status().is_success() => Ok(()),
            Ok(response) => {
                tracing::error!(namespace = %self.namespace, role = %self.role_name,
                    status = %response.status(), "OpenBao service token 撤销未确认");
                Err(SecretError::RevocationUnconfirmed)
            }
            Err(error) => {
                tracing::error!(namespace = %self.namespace, role = %self.role_name,
                    error = %error, "OpenBao service token 撤销未确认");
                Err(SecretError::RevocationUnconfirmed)
            }
        }
    }

    /// `Ok(None)` 是登录被拒。
    async fn login(&self, secret_id: &str) -> Result<Option<LoginAuth>, SecretError> {
        let resp = self
            .with_namespace(
                self.http
                    .post(format!("{}/v1/auth/approle/login", self.addr)),
            )
            .json(&serde_json::json!({ "role_id": self.role_id, "secret_id": secret_id }))
            .send()
            .await?;
        if !resp.status().is_success() {
            return Ok(None);
        }
        let parsed: LoginResponse = resp.json().await.map_err(|_| SecretError::Malformed)?;
        Ok(Some(parsed.auth))
    }

    async fn token(&self) -> Result<Arc<String>, SecretError> {
        self.lease
            .read()
            .await
            .as_ref()
            .map(|l| Arc::clone(&l.token))
            .ok_or(SecretError::CredentialLost)
    }

    /// 按 lease 续期，直到被确定拒绝。只在出错时返回，返回值就是 fail closed 的原因。
    ///
    /// 在 lease 过半时续期；续期暂时失败（OpenBao 不可达、封存）按 lease 的十分之一
    /// 为间隔重试，直到 lease 到期——到期之后令牌已无效，与被撤销是同一个结论。
    async fn keep_alive(&self) -> SecretError {
        loop {
            let (token, ttl) = match self.lease.read().await.as_ref() {
                Some(l) => (Arc::clone(&l.token), l.ttl),
                None => return SecretError::CredentialLost,
            };
            tokio::time::sleep(ttl / 2).await;
            let deadline = tokio::time::Instant::now() + ttl / 2;
            let renewed = loop {
                let attempt = self
                    .with_namespace(
                        self.http
                            .post(format!("{}/v1/auth/token/renew-self", self.addr)),
                    )
                    .header("X-Vault-Token", token.as_str())
                    .send()
                    .await;
                match attempt {
                    Ok(r) if r.status().is_success() => match r.json::<LoginResponse>().await {
                        Ok(p) if p.auth.lease_duration > 0 => {
                            break Some(Duration::from_secs(p.auth.lease_duration))
                        }
                        _ => break None,
                    },
                    // 令牌被撤销或已过期：确定的拒绝
                    Ok(r) if matches!(r.status().as_u16(), 400 | 401 | 403) => break None,
                    Ok(r) => tracing::warn!(status = %r.status(), "续期 service token 暂时失败"),
                    Err(e) => tracing::warn!(error = %e, "续期 service token 暂时失败"),
                }
                if tokio::time::Instant::now() + ttl / 10 >= deadline {
                    break None;
                }
                tokio::time::sleep(ttl / 10).await;
            };
            match renewed {
                Some(ttl) => {
                    if let Some(l) = self.lease.write().await.as_mut() {
                        l.ttl = ttl;
                    }
                }
                None => {
                    *self.lease.write().await = None;
                    return SecretError::CredentialLost;
                }
            }
        }
    }
}

/// 读投递面：role 的 id 与名字，以及一次性的 wrapping token。
fn delivered(prefix: &str) -> Result<(String, String, String), String> {
    let get = |k: String| std::env::var(&k).map_err(|_| format!("缺少 {k}"));
    Ok((
        get(format!("{prefix}_ROLE_ID"))?,
        get(format!("{prefix}_ROLE_NAME"))?,
        get(format!("{prefix}_WRAPPED_SECRET_ID"))?,
    ))
}

pub struct SecretStore {
    session: AppRoleSession,
    /// 本服务的身份。SecretRef 的 audience 必须等于它，否则拒绝取用——
    /// 同一把 secret 不得被用于它不该服务的调用方（`DD-70`）。
    identity: String,
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
    /// 配置都不接受默认值：缺任一项即拒绝构造。回落到某个猜测的地址或身份，会让
    /// 「取不到 secret 就 fail closed」退化成「取到了别人的 secret」。
    ///
    /// 构造之后必须 `connect` 一次才能取用。
    pub fn from_env() -> Result<Self, String> {
        let get = |k: &str| std::env::var(k).map_err(|_| format!("缺少 {k}"));
        let (role_id, role_name, wrapped) = delivered("OPENBAO")?;
        // AppRole 挂在平台 namespace 下；取用的 secret 可能在别的 namespace，
        // 二者是不同的请求头值，不能混用。
        Ok(Self {
            session: AppRoleSession::new(
                &get("OPENBAO_ADDR")?,
                get("OPENBAO_PLATFORM_NAMESPACE")?,
                role_id,
                role_name,
                wrapped,
            ),
            identity: get("OPENBAO_SERVICE_IDENTITY")?,
        })
    }

    /// 消费投递的 wrapping token，换出 service token。
    pub async fn connect(&self) -> Result<(), SecretError> {
        self.session.connect().await
    }

    /// 持续续期 service token，只在失效时返回原因。调用方据此 fail closed。
    pub async fn keep_alive(&self) -> SecretError {
        self.session.keep_alive().await
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
        let token = self.session.token().await?;
        let resp = self
            .session
            .http
            .get(format!("{}/v1/{mount}/data/{path}", self.session.addr))
            .query(&[("version", r.version.to_string())])
            .header("X-Vault-Namespace", namespace)
            .header("X-Vault-Token", token.as_str())
            .send()
            .await?;
        let body: KvResponse = match resp.status().as_u16() {
            200 => resp.json().await?,
            // 401/403 是凭据或策略问题，404 是版本/路径不存在——两者不同
            401 | 403 => return Err(SecretError::Refused),
            _ => return Err(SecretError::VersionUnavailable),
        };
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
        let token = self.session.token().await?;
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
            200 => Ok(resp.json::<KvWriteResponse>().await?.data.version),
            401 | 403 => Err(SecretError::Refused),
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
/// 的 root namespace AppRole，策略只有这一条路径的 `read`+`sudo`。它的引导凭据
/// 与 `SecretStore` 同样以 response wrapping 投递。
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
        let (role_id, role_name, wrapped) = delivered("OPENBAO_AUDIT")?;
        Ok(Self {
            session: AppRoleSession::new(
                &get("OPENBAO_ADDR")?,
                String::new(),
                role_id,
                role_name,
                wrapped,
            ),
        })
    }

    pub async fn connect(&self) -> Result<(), SecretError> {
        self.session.connect().await
    }

    pub async fn keep_alive(&self) -> SecretError {
        self.session.keep_alive().await
    }

    /// 当前启用的 audit device 数。`Ok(0)` 是确定的「没有」，调用方必须 fail
    /// closed；`Err` 是没观察到，同样不能当作「有」。
    pub async fn enabled_devices(&self) -> Result<usize, SecretError> {
        let token = self.session.token().await?;
        let resp = self
            .session
            .http
            .get(format!("{}/v1/sys/audit", self.session.addr))
            .header("X-Vault-Token", token.as_str())
            .send()
            .await?;
        match resp.status().as_u16() {
            200 => Ok(resp
                .json::<AuditTable>()
                .await
                .map_err(|_| SecretError::Malformed)?
                .data
                .len()),
            401 | 403 => Err(SecretError::Refused),
            _ => Err(SecretError::Malformed),
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
    use std::io::{Read, Write};
    use std::net::TcpListener;

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

    #[tokio::test]
    async fn reusable_secret_id_revokes_both_issued_tokens() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let addr = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let replies = [
                r#"{"data":{"creation_path":"auth/approle/role/probe/secret-id"}}"#,
                r#"{"data":{"secret_id":"reusable"}}"#,
                r#"{"auth":{"client_token":"first","accessor":"first-accessor","lease_duration":120,"renewable":true}}"#,
                r#"{"auth":{"client_token":"extra","accessor":"extra-accessor","lease_duration":120,"renewable":true}}"#,
                "",
                "",
            ];
            let mut requests = Vec::new();
            let deadline = std::time::Instant::now() + Duration::from_secs(5);
            while requests.len() < replies.len() && std::time::Instant::now() < deadline {
                let (mut stream, _) = match listener.accept() {
                    Ok(connection) => connection,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(10));
                        continue;
                    }
                    Err(error) => panic!("mock OpenBao accept: {error}"),
                };
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut bytes = [0u8; 4096];
                let size = stream.read(&mut bytes).unwrap();
                let request = String::from_utf8_lossy(&bytes[..size]).to_string();
                let body = replies[requests.len()];
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                stream.write_all(response.as_bytes()).unwrap();
                requests.push(request);
            }
            requests
        });
        let session = AppRoleSession::new(
            &format!("http://{addr}"),
            "platform".to_owned(),
            "role-id".to_owned(),
            "probe".to_owned(),
            "wrapped".to_owned(),
        );
        assert!(matches!(
            session.connect().await,
            Err(SecretError::SecretIdReusable)
        ));
        assert!(matches!(
            session.token().await,
            Err(SecretError::CredentialLost)
        ));
        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 6, "拒绝启动前必须撤销两枚 service token");
        for (request, token) in [(&requests[4], "extra"), (&requests[5], "first")] {
            assert!(request.starts_with("PUT /v1/auth/token/revoke-self HTTP/1.1"));
            assert!(request.contains(&format!("x-vault-token: {token}")));
            assert!(request.contains("x-vault-namespace: platform"));
        }
    }
}
