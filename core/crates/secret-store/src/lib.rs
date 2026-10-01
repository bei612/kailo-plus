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

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use serde::Deserialize;
use tokio::sync::{mpsc, Mutex, OnceCell, RwLock};
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum SecretError {
    #[error("locator 必须形如 <namespace>/<mount>/<path>，得到 {0}")]
    LocatorMalformed(String),
    #[error("SecretRef 的 audience 与本服务身份不符")]
    AudienceMismatch,
    #[error("指定版本不存在或不可读")]
    VersionUnavailable,
    #[error("OpenBao 拒绝 KV v2 写入，当前版本已变化或请求无效")]
    WriteRejected,
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
    #[error("Tenant namespace 的 OpenBao 配置未收敛")]
    TenantNamespaceNotReady,
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
/// Core 的 platform、Tenant provisioner、Tenant 子 namespace 与 root audit
/// 观察会话共用这套投递、登录、续期和撤销逻辑。
struct AppRoleSession {
    addr: String,
    /// AppRole 挂载所在的 namespace；空串是 root namespace（不带请求头）
    namespace: String,
    role_id: String,
    /// wrapping token 的创建路径必须是它：`auth/approle/role/<name>/secret-id`
    role_name: String,
    /// 一次性的 wrapping token。connect 之后即为 None。
    wrapped: Mutex<Option<String>>,
    http: reqwest::Client,
    lease: RwLock<Option<Lease>>,
}

fn bounded_openbao_client() -> Result<reqwest::Client, String> {
    let seconds: u64 = std::env::var("OPENBAO_HTTP_TIMEOUT_SECONDS")
        .map_err(|_| "缺少 OPENBAO_HTTP_TIMEOUT_SECONDS".to_owned())?
        .parse()
        .map_err(|_| "OPENBAO_HTTP_TIMEOUT_SECONDS 必须是正整数".to_owned())?;
    if seconds == 0 {
        return Err("OPENBAO_HTTP_TIMEOUT_SECONDS 必须大于零".to_owned());
    }
    reqwest::Client::builder()
        .timeout(Duration::from_secs(seconds))
        .build()
        .map_err(|error| format!("构造有界 OpenBao HTTP 客户端失败: {error}"))
}

impl AppRoleSession {
    fn new(
        addr: &str,
        namespace: String,
        role_id: String,
        role_name: String,
        wrapped: Option<String>,
        http: reqwest::Client,
    ) -> Self {
        Self {
            addr: addr.trim_end_matches('/').to_owned(),
            namespace,
            role_id,
            role_name,
            wrapped: Mutex::new(wrapped),
            http,
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

        self.connect_secret_id(&secret_id).await
    }

    /// provisioner 在进程内生成的 Tenant AppRole secret_id 不经过部署投递；
    /// 同样只允许登录一次，并沿用与 wrapped 引导相同的 lease 自检和失败撤销。
    async fn connect_secret_id(&self, secret_id: &str) -> Result<(), SecretError> {
        let auth = self
            .login(secret_id)
            .await?
            .ok_or(SecretError::LoginFailed)?;
        // 自检：同一 secret_id 必须已经不能登录。能登录说明 role 没配成单次
        //    使用，泄漏的 secret_id 可以无限换 token——拒绝启动。校验完成前
        //    不把首个 token 放进可供 Core 使用的 lease；任何拒绝分支先撤销它。
        let verified = async {
            if !auth.renewable || auth.lease_duration == 0 {
                return Err(SecretError::Malformed);
            }
            match self.login(secret_id).await? {
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

    /// Core 停止服务或引导失败时显式撤销已经换出的令牌。没有成功登录的会话无令牌可撤。
    async fn revoke_current(&self) -> Result<(), SecretError> {
        let token = match self.lease.read().await.as_ref() {
            Some(lease) => Arc::clone(&lease.token),
            None => return Ok(()),
        };
        self.revoke_self(token.as_str()).await?;
        self.lease.write().await.take();
        Ok(())
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
    /// 只用于 platform/ 下的部署级凭据（例如 Relay operator）。
    session: AppRoleSession,
    /// tenants/ 下的配置凭据；policy 只有 namespace/mount/auth/role 配置权，
    /// 不含任一子 namespace 的 KV data/metadata 权限。
    provisioner: AppRoleSession,
    tenant: TenantConfig,
    tenant_sessions: Mutex<HashMap<Uuid, Arc<OnceCell<Arc<AppRoleSession>>>>>,
    tenant_failure_tx: mpsc::UnboundedSender<()>,
    tenant_failure_rx: Mutex<mpsc::UnboundedReceiver<()>>,
    /// 本服务的身份。SecretRef 的 audience 必须等于它，否则拒绝取用——
    /// 同一把 secret 不得被用于它不该服务的调用方（`DD-70`）。
    identity: String,
}

struct TenantConfig {
    parent: String,
    mount: String,
    role_name: String,
    max_versions: u32,
    secret_id_ttl: String,
    token_period: String,
    core_bound_cidrs: String,
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
#[derive(Deserialize)]
struct KvCurrentMetadataResponse {
    data: KvCurrentMetadata,
}
#[derive(Deserialize)]
struct KvCurrentMetadata {
    current_version: u32,
}

#[derive(Deserialize)]
struct TenantNamespaceResponse {
    data: TenantNamespaceData,
}

#[derive(Deserialize)]
struct TenantNamespaceData {
    path: String,
    tainted: bool,
    locked: bool,
}

#[derive(Deserialize)]
struct RoleIdResponse {
    data: RoleIdData,
}

#[derive(Deserialize)]
struct RoleIdData {
    role_id: String,
}

#[derive(Deserialize)]
struct SecretIdResponse {
    data: SecretIdData,
}

#[derive(Deserialize)]
struct SecretIdData {
    secret_id: String,
}

impl SecretStore {
    /// 配置都不接受默认值：缺任一项即拒绝构造。回落到某个猜测的地址或身份，会让
    /// 「取不到 secret 就 fail closed」退化成「取到了别人的 secret」。
    ///
    /// 构造之后必须 `connect` 一次才能取用。
    pub fn from_env() -> Result<Self, String> {
        let get = |k: &str| std::env::var(k).map_err(|_| format!("缺少 {k}"));
        let (role_id, role_name, wrapped) = delivered("OPENBAO")?;
        let (tenant_role_id, tenant_role_name, tenant_wrapped) = delivered("OPENBAO_TENANT")?;
        let http = bounded_openbao_client()?;
        let addr = get("OPENBAO_ADDR")?;
        let tenant_parent = get("OPENBAO_TENANT_PARENT_NAMESPACE")?;
        if tenant_parent != "tenants" {
            return Err("DD-70 固定 Tenant namespace 根为 tenants".into());
        }
        let mount = get("OPENBAO_KV_MOUNT")?;
        let tenant_core_role = get("OPENBAO_TENANT_CORE_ROLE_NAME")?;
        if ![&mount, &tenant_core_role].iter().all(|s| {
            !s.is_empty()
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        }) {
            return Err("OpenBao mount 与 role 名必须是单一路径段".into());
        }
        let max_versions: u32 = get("OPENBAO_KV_MAX_VERSIONS")?
            .parse()
            .map_err(|_| "OPENBAO_KV_MAX_VERSIONS 必须是正整数")?;
        if max_versions == 0 {
            return Err("OPENBAO_KV_MAX_VERSIONS 必须大于零".into());
        }
        let (tenant_failure_tx, tenant_failure_rx) = mpsc::unbounded_channel();
        Ok(Self {
            session: AppRoleSession::new(
                &addr,
                get("OPENBAO_PLATFORM_NAMESPACE")?,
                role_id,
                role_name,
                Some(wrapped),
                http.clone(),
            ),
            provisioner: AppRoleSession::new(
                &addr,
                tenant_parent.clone(),
                tenant_role_id,
                tenant_role_name,
                Some(tenant_wrapped),
                http,
            ),
            tenant: TenantConfig {
                parent: tenant_parent,
                mount,
                role_name: tenant_core_role,
                max_versions,
                secret_id_ttl: get("OPENBAO_SECRET_ID_TTL")?,
                token_period: get("OPENBAO_TOKEN_PERIOD")?,
                core_bound_cidrs: get("OPENBAO_TENANT_CORE_BOUND_CIDRS")?,
            },
            tenant_sessions: Mutex::new(HashMap::new()),
            tenant_failure_tx,
            tenant_failure_rx: Mutex::new(tenant_failure_rx),
            identity: get("OPENBAO_SERVICE_IDENTITY")?,
        })
    }

    /// 消费投递的 wrapping token，换出 service token。
    pub async fn connect(&self) -> Result<(), SecretError> {
        self.session.connect().await?;
        if let Err(error) = self.provisioner.connect().await {
            // main 在 connect 返回错误后尚未进入统一收尾段；已取得的平台 token
            // 必须在此撤销，不能把它留到 TTL 到期而仍声称安全退出。
            self.session.revoke_current().await?;
            return Err(error);
        }
        Ok(())
    }

    /// 持续续期 service token，只在失效时返回原因。调用方据此 fail closed。
    pub async fn keep_alive(&self) -> SecretError {
        let mut failures = self.tenant_failure_rx.lock().await;
        tokio::select! {
            e = self.session.keep_alive() => e,
            e = self.provisioner.keep_alive() => e,
            _ = failures.recv() => SecretError::CredentialLost,
        }
    }

    pub async fn revoke_current(&self) -> Result<(), SecretError> {
        let sessions: Vec<_> = self
            .tenant_sessions
            .lock()
            .await
            .values()
            .filter_map(|cell| cell.get().cloned())
            .collect();
        let mut failure = None;
        for session in sessions {
            if let Err(error) = session.revoke_current().await {
                failure.get_or_insert(error);
            }
        }
        if let Err(error) = self.provisioner.revoke_current().await {
            failure.get_or_insert(error);
        }
        if let Err(error) = self.session.revoke_current().await {
            failure.get_or_insert(error);
        }
        failure.map_or(Ok(()), Err)
    }

    /// SecretRef 的 Tenant namespace 是设计固定的两级路径；UUID 类型阻止调用方
    /// 把任意 namespace 名或路径段注入 OpenBao 管理 API。
    pub fn tenant_locator(&self, tenant_id: Uuid, path: &str) -> String {
        format!(
            "{}/{}/{}/{}",
            self.tenant.parent, tenant_id, self.tenant.mount, path
        )
    }

    /// DD-85 的旧引用只能是该业务 Tenant 在部署级 namespace 下的 Buzz 身份路径。
    /// 不能把任意 platform secret 借归位动作搬走或永久销毁。
    pub fn is_legacy_identity_locator(&self, tenant_id: Uuid, locator: &str) -> bool {
        let Ok((namespace, mount, path)) = split_locator(locator) else {
            return false;
        };
        if namespace != self.session.namespace || mount != self.tenant.mount {
            return false;
        }
        let control = format!("buzz-control/{tenant_id}");
        let human = format!("buzz-human/{tenant_id}/");
        let suffix = path
            .strip_prefix(&format!("{control}/"))
            .or_else(|| path.strip_prefix(&human));
        path == control
            || suffix.is_some_and(|tail| {
                !tail.is_empty()
                    && tail
                        .split('/')
                        .all(|segment| !segment.is_empty() && segment != "." && segment != "..")
            })
    }

    /// 只读取 KV metadata 的 current_version。目标确定性 locator 在响应丢失后只
    /// 能经此观察，不自动追加新版本。
    pub async fn observed_version(&self, locator: &str) -> Result<u32, SecretError> {
        let (namespace, mount, path) = split_locator(locator)?;
        let token = self.token_for_namespace(&namespace).await?;
        self.current_version(&namespace, &mount, &path, token.as_str())
            .await
    }

    /// OpenBao KV v2 的永久 destroy；仅允许 DD-85 已由 Core 治理状态机冻结的
    /// 遗留 Buzz 身份版本。调用后仍须用 metadata 中的 destroyed=true 查证。
    pub async fn destroy_legacy_identity_version(
        &self,
        tenant_id: Uuid,
        locator: &str,
        version: u32,
    ) -> Result<(), SecretError> {
        if version == 0 || !self.is_legacy_identity_locator(tenant_id, locator) {
            return Err(SecretError::Refused);
        }
        let (namespace, mount, path) = split_locator(locator)?;
        let token = self.token_for_namespace(&namespace).await?;
        let response = self
            .session
            .http
            .post(format!("{}/v1/{mount}/destroy/{path}", self.session.addr))
            .header("X-Vault-Namespace", namespace)
            .header("X-Vault-Token", token.as_str())
            .json(&serde_json::json!({ "versions": [version] }))
            .send()
            .await?;
        match response.status().as_u16() {
            200 | 204 => Ok(()),
            401 | 403 => Err(SecretError::Refused),
            _ => Err(SecretError::Malformed),
        }
    }

    /// 只有 metadata 仍保留该版本且 destroyed=true，才把旧引用记为 REVOKED。
    /// 路径不存在、回应缺字段或 OpenBao 不可用都不是销毁证据。
    pub async fn version_destroyed(
        &self,
        tenant_id: Uuid,
        locator: &str,
        version: u32,
    ) -> Result<bool, SecretError> {
        if version == 0 || !self.is_legacy_identity_locator(tenant_id, locator) {
            return Err(SecretError::Refused);
        }
        let (namespace, mount, path) = split_locator(locator)?;
        let token = self.token_for_namespace(&namespace).await?;
        let response = self
            .session
            .http
            .get(format!("{}/v1/{mount}/metadata/{path}", self.session.addr))
            .header("X-Vault-Namespace", namespace)
            .header("X-Vault-Token", token.as_str())
            .send()
            .await?;
        match response.status().as_u16() {
            200 => {
                let body: serde_json::Value = response.json().await?;
                body.pointer(&format!("/data/versions/{version}/destroyed"))
                    .and_then(serde_json::Value::as_bool)
                    .ok_or(SecretError::Malformed)
            }
            401 | 403 => Err(SecretError::Refused),
            _ => Err(SecretError::VersionUnavailable),
        }
    }

    /// DD-86：只处理该 ActionExecution 的 SERVER HUMAN 初建路径。CAS 版本 0
    /// 与仍在途的原写入竞争；无论哪一方赢，只允许销毁版本 1，且以 metadata 为终态证据。
    pub async fn destroy_unbound_server_human_provision(
        &self,
        tenant_id: Uuid,
        action_id: Uuid,
        locator: &str,
    ) -> Result<(), SecretError> {
        if locator != self.tenant_locator(tenant_id, &format!("buzz-human/provision/{action_id}")) {
            return Err(SecretError::Refused);
        }
        self.destroy_unreferenced_version_one(locator).await
    }

    /// DD-85：已复制但切换被确定拒绝的归位目标。locator 由归位 ID 唯一确定，
    /// 从未被任何 binding 引用；与 DD-86 同一收敛——只销毁版本 1 并以 metadata 为证。
    pub async fn destroy_unbound_rehome_copy(
        &self,
        tenant_id: Uuid,
        rehome_id: Uuid,
        locator: &str,
    ) -> Result<(), SecretError> {
        if locator != self.tenant_locator(tenant_id, &format!("buzz-ref-rehome/{rehome_id}")) {
            return Err(SecretError::Refused);
        }
        self.destroy_unreferenced_version_one(locator).await
    }

    /// 调用方已证明该 locator 专属于一条未形成 binding 的写入意图。CAS 版本 0
    /// 与仍在途的原写入竞争；无论哪一方赢，只允许销毁版本 1。
    async fn destroy_unreferenced_version_one(&self, locator: &str) -> Result<(), SecretError> {
        let (namespace, mount, path) = split_locator(locator)?;
        let token = self.token_for_namespace(&namespace).await?;
        let observed = self
            .current_version(&namespace, &mount, &path, token.as_str())
            .await?;
        if observed == 0 {
            match self
                .write_with_cas(
                    (&namespace, &mount, &path),
                    token.as_str(),
                    "fence",
                    "true",
                    0,
                )
                .await
            {
                Ok(1) | Err(SecretError::WriteRejected) | Err(SecretError::Transport(_)) => {}
                Ok(_) => return Err(SecretError::Malformed),
                Err(error) => return Err(error),
            }
        }
        if self
            .unreferenced_version_one_destroyed(&namespace, &mount, &path, token.as_str())
            .await?
        {
            return Ok(());
        }
        let result = self
            .session
            .http
            .post(format!("{}/v1/{mount}/destroy/{path}", self.session.addr))
            .header("X-Vault-Namespace", &namespace)
            .header("X-Vault-Token", token.as_str())
            .json(&serde_json::json!({ "versions": [1] }))
            .send()
            .await;
        // 丢失回应仍以 metadata 查证；没有肯定证据就把错误交给原意图继续对账。
        let outcome = match result {
            Ok(response) if matches!(response.status().as_u16(), 200 | 204) => Ok(()),
            Ok(response) if matches!(response.status().as_u16(), 401 | 403) => {
                Err(SecretError::Refused)
            }
            Ok(_) => Err(SecretError::Malformed),
            Err(error) => Err(SecretError::Transport(error)),
        };
        if self
            .unreferenced_version_one_destroyed(&namespace, &mount, &path, token.as_str())
            .await?
        {
            Ok(())
        } else {
            outcome.and(Err(SecretError::VersionUnavailable))
        }
    }

    async fn unreferenced_version_one_destroyed(
        &self,
        namespace: &str,
        mount: &str,
        path: &str,
        token: &str,
    ) -> Result<bool, SecretError> {
        let response = self
            .session
            .http
            .get(format!("{}/v1/{mount}/metadata/{path}", self.session.addr))
            .header("X-Vault-Namespace", namespace)
            .header("X-Vault-Token", token)
            .send()
            .await?;
        match response.status().as_u16() {
            200 => {
                let body: serde_json::Value = response.json().await?;
                if body
                    .pointer("/data/current_version")
                    .and_then(|v| v.as_u64())
                    != Some(1)
                {
                    return Err(SecretError::VersionUnavailable);
                }
                body.pointer("/data/versions/1/destroyed")
                    .and_then(|v| v.as_bool())
                    .ok_or(SecretError::Malformed)
            }
            401 | 403 => Err(SecretError::Refused),
            _ => Err(SecretError::VersionUnavailable),
        }
    }

    async fn tenant_admin(
        &self,
        namespace: &str,
        method: reqwest::Method,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> Result<reqwest::Response, SecretError> {
        let token = self.provisioner.token().await?;
        let request = self
            .provisioner
            .http
            .request(method, format!("{}/v1/{path}", self.provisioner.addr))
            .header("X-Vault-Namespace", namespace)
            .header("X-Vault-Token", token.as_str());
        let request = match body {
            Some(body) => request.json(&body),
            None => request,
        };
        Ok(request.send().await?)
    }

    fn admin_result(response: reqwest::Response) -> Result<reqwest::Response, SecretError> {
        match response.status().as_u16() {
            200 | 204 => Ok(response),
            401 | 403 => Err(SecretError::Refused),
            _ => Err(SecretError::TenantNamespaceNotReady),
        }
    }

    async fn admin_absent(
        response: reqwest::Response,
        exact_missing_error: &str,
    ) -> Result<bool, SecretError> {
        match response.status().as_u16() {
            // handleReadMount 与 handleReadAuth 的空结果是 logical.ErrorResponse，
            // HTTP 层返回 400。只有源码固定的完整错误才能触发创建。
            400 => {
                let body: serde_json::Value =
                    response.json().await.map_err(|_| SecretError::Malformed)?;
                if body.get("errors") == Some(&serde_json::json!([exact_missing_error])) {
                    Ok(true)
                } else {
                    Err(SecretError::TenantNamespaceNotReady)
                }
            }
            404 => Ok(true),
            _ => Self::admin_result(response).map(|_| false),
        }
    }

    /// TENANT_LIFECYCLE 的第一项外部投影：建立真实的 tenants/<Tenant ID>
    /// namespace，并在其中配置独立 KV mount、最小 KV policy 与 AppRole。
    /// 中途失败留下的 namespace 由同一固定 Tenant ID 的下一次 Activity 重试
    /// 收敛；不把私钥写回 platform/ 作为降级路径。
    pub async fn ensure_tenant(&self, tenant_id: Uuid) -> Result<(), SecretError> {
        let child = format!("{}/{}", self.tenant.parent, tenant_id);
        let ns_path = format!("sys/namespaces/{tenant_id}");
        let mut namespace = self
            .tenant_admin(&self.tenant.parent, reqwest::Method::GET, &ns_path, None)
            .await?;
        if namespace.status().as_u16() == 404 {
            let create = self
                .tenant_admin(
                    &self.tenant.parent,
                    reqwest::Method::POST,
                    &ns_path,
                    Some(serde_json::json!({})),
                )
                .await?;
            // 另一个 Core 同时建成时只接受随后可读且路径相符的事实。
            if !create.status().is_success() && create.status().as_u16() != 400 {
                return Err(SecretError::TenantNamespaceNotReady);
            }
            namespace = self
                .tenant_admin(&self.tenant.parent, reqwest::Method::GET, &ns_path, None)
                .await?;
        }
        let namespace = Self::admin_result(namespace)?
            .json::<TenantNamespaceResponse>()
            .await
            .map_err(|_| SecretError::Malformed)?
            .data;
        if namespace.path != format!("{child}/") || namespace.tainted || namespace.locked {
            return Err(SecretError::TenantNamespaceNotReady);
        }

        let mount_path = format!("sys/mounts/{}", self.tenant.mount);
        let mount = self
            .tenant_admin(&child, reqwest::Method::GET, &mount_path, None)
            .await?;
        let mount_missing = Self::admin_absent(
            mount,
            &format!("No secret engine mount at {}/", self.tenant.mount),
        )
        .await?;
        if mount_missing {
            let create = self
                .tenant_admin(
                    &child,
                    reqwest::Method::POST,
                    &mount_path,
                    Some(serde_json::json!({"type":"kv","options":{"version":"2"}})),
                )
                .await?;
            if !create.status().is_success() && create.status().as_u16() != 400 {
                return Err(SecretError::TenantNamespaceNotReady);
            }
        }
        let mount: serde_json::Value = Self::admin_result(
            self.tenant_admin(&child, reqwest::Method::GET, &mount_path, None)
                .await?,
        )?
        .json()
        .await
        .map_err(|_| SecretError::Malformed)?;
        if mount.pointer("/data/type").and_then(|v| v.as_str()) != Some("kv")
            || mount
                .pointer("/data/options/version")
                .and_then(|v| v.as_str())
                != Some("2")
        {
            return Err(SecretError::TenantNamespaceNotReady);
        }

        let kv_config_path = format!("{}/config", self.tenant.mount);
        let config: serde_json::Value = Self::admin_result(
            self.tenant_admin(&child, reqwest::Method::GET, &kv_config_path, None)
                .await?,
        )?
        .json()
        .await
        .map_err(|_| SecretError::Malformed)?;
        let existing_max = config
            .pointer("/data/max_versions")
            .and_then(|v| v.as_u64())
            .ok_or(SecretError::Malformed)?;
        let retained_max = existing_max.max(u64::from(self.tenant.max_versions));
        Self::admin_result(
            self.tenant_admin(
                &child,
                reqwest::Method::POST,
                &kv_config_path,
                Some(serde_json::json!({"max_versions":retained_max,"cas_required":true})),
            )
            .await?,
        )?;
        let config: serde_json::Value = Self::admin_result(
            self.tenant_admin(&child, reqwest::Method::GET, &kv_config_path, None)
                .await?,
        )?
        .json()
        .await
        .map_err(|_| SecretError::Malformed)?;
        if config
            .pointer("/data/cas_required")
            .and_then(|v| v.as_bool())
            != Some(true)
            || config
                .pointer("/data/max_versions")
                .and_then(|v| v.as_u64())
                != Some(retained_max)
        {
            return Err(SecretError::TenantNamespaceNotReady);
        }

        let auth_path = "sys/auth/approle";
        let auth = self
            .tenant_admin(&child, reqwest::Method::GET, auth_path, None)
            .await?;
        if Self::admin_absent(auth, "No auth engine at approle/").await? {
            let create = self
                .tenant_admin(
                    &child,
                    reqwest::Method::POST,
                    auth_path,
                    Some(serde_json::json!({"type":"approle"})),
                )
                .await?;
            if !create.status().is_success() && create.status().as_u16() != 400 {
                return Err(SecretError::TenantNamespaceNotReady);
            }
        }
        let auth: serde_json::Value = Self::admin_result(
            self.tenant_admin(&child, reqwest::Method::GET, auth_path, None)
                .await?,
        )?
        .json()
        .await
        .map_err(|_| SecretError::Malformed)?;
        if auth.pointer("/data/type").and_then(|v| v.as_str()) != Some("approle") {
            return Err(SecretError::TenantNamespaceNotReady);
        }

        let policy = format!(
            "path \"{mount}/data/*\" {{ capabilities = [\"create\", \"update\", \"read\"] }}\n\
             path \"{mount}/metadata/*\" {{ capabilities = [\"read\", \"list\"] }}\n\
             path \"{mount}/destroy/buzz-human/provision/*\" {{ capabilities = [\"update\"] }}\n\
             path \"{mount}/destroy/buzz-ref-rehome/*\" {{ capabilities = [\"update\"] }}\n",
            mount = self.tenant.mount
        );
        let policy_path = format!("sys/policies/acl/{}", self.tenant.role_name);
        Self::admin_result(
            self.tenant_admin(
                &child,
                reqwest::Method::PUT,
                &policy_path,
                Some(serde_json::json!({"policy":policy})),
            )
            .await?,
        )?;
        let stored_policy: serde_json::Value = Self::admin_result(
            self.tenant_admin(&child, reqwest::Method::GET, &policy_path, None)
                .await?,
        )?
        .json()
        .await
        .map_err(|_| SecretError::Malformed)?;
        if stored_policy
            .pointer("/data/policy")
            .and_then(|v| v.as_str())
            != Some(policy.as_str())
        {
            return Err(SecretError::TenantNamespaceNotReady);
        }

        let role_path = format!("auth/approle/role/{}", self.tenant.role_name);
        Self::admin_result(
            self.tenant_admin(
                &child,
                reqwest::Method::POST,
                &role_path,
                Some(serde_json::json!({
                    "token_policies": [self.tenant.role_name],
                    "secret_id_num_uses": 1,
                    "secret_id_ttl": self.tenant.secret_id_ttl,
                    "secret_id_bound_cidrs": self.tenant.core_bound_cidrs,
                    "token_bound_cidrs": self.tenant.core_bound_cidrs,
                    "token_period": self.tenant.token_period,
                    "token_ttl": 0,
                    "token_max_ttl": 0
                })),
            )
            .await?,
        )?;
        let role: serde_json::Value = Self::admin_result(
            self.tenant_admin(&child, reqwest::Method::GET, &role_path, None)
                .await?,
        )?
        .json()
        .await
        .map_err(|_| SecretError::Malformed)?;
        if role
            .pointer("/data/secret_id_num_uses")
            .and_then(|v| v.as_u64())
            != Some(1)
            || role
                .pointer("/data/token_policies")
                .and_then(|v| v.as_array())
                .map(|v| v.as_slice())
                != Some([serde_json::Value::String(self.tenant.role_name.clone())].as_slice())
        {
            return Err(SecretError::TenantNamespaceNotReady);
        }
        Ok(())
    }

    async fn tenant_session(&self, tenant_id: Uuid) -> Result<Arc<AppRoleSession>, SecretError> {
        let cell = {
            self.tenant_sessions
                .lock()
                .await
                .entry(tenant_id)
                .or_insert_with(|| Arc::new(OnceCell::new()))
                .clone()
        };
        cell.get_or_try_init(|| async {
            let child = format!("{}/{}", self.tenant.parent, tenant_id);
            let role_id_path = format!("auth/approle/role/{}/role-id", self.tenant.role_name);
            let role_id = Self::admin_result(
                self.tenant_admin(&child, reqwest::Method::GET, &role_id_path, None)
                    .await?,
            )?
            .json::<RoleIdResponse>()
            .await
            .map_err(|_| SecretError::Malformed)?
            .data
            .role_id;
            let secret_id_path = format!("auth/approle/role/{}/secret-id", self.tenant.role_name);
            let secret_id = Self::admin_result(
                self.tenant_admin(
                    &child,
                    reqwest::Method::POST,
                    &secret_id_path,
                    Some(serde_json::json!({})),
                )
                .await?,
            )?
            .json::<SecretIdResponse>()
            .await
            .map_err(|_| SecretError::Malformed)?
            .data
            .secret_id;
            let session = Arc::new(AppRoleSession::new(
                &self.provisioner.addr,
                child,
                role_id,
                self.tenant.role_name.clone(),
                None,
                self.provisioner.http.clone(),
            ));
            session.connect_secret_id(&secret_id).await?;
            let watched = Arc::clone(&session);
            let failed = self.tenant_failure_tx.clone();
            tokio::spawn(async move {
                let _ = watched.keep_alive().await;
                let _ = failed.send(());
            });
            Ok(session)
        })
        .await
        .map(Arc::clone)
    }

    async fn token_for_namespace(&self, namespace: &str) -> Result<Arc<String>, SecretError> {
        if namespace == self.session.namespace {
            return self.session.token().await;
        }
        let tenant_id = namespace
            .strip_prefix(&format!("{}/", self.tenant.parent))
            .and_then(|id| Uuid::parse_str(id).ok())
            .filter(|id| namespace == format!("{}/{}", self.tenant.parent, id))
            .ok_or(SecretError::Refused)?;
        self.tenant_session(tenant_id).await?.token().await
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
        let token = self.token_for_namespace(&namespace).await?;
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
    /// 写入前读取当前 metadata，并把版本作为 CAS 条件交给 OpenBao 原子判定；
    /// 不存在的路径使用协议规定的 cas=0。并发修改时拒绝本次写入，不猜测新版本。
    pub async fn write(&self, locator: &str, field: &str, value: &str) -> Result<u32, SecretError> {
        let (namespace, mount, path) = split_locator(locator)?;
        let token = self.token_for_namespace(&namespace).await?;
        let current_version = self
            .current_version(&namespace, &mount, &path, token.as_str())
            .await?;
        self.write_with_cas(
            (&namespace, &mount, &path),
            token.as_str(),
            field,
            value,
            current_version,
        )
        .await
    }

    /// 确定性 locator 的单次写入。响应丢失后重试只读回已存在的钉定版本并核对
    /// 原值，不把一次意图追加成下一个版本。已存在的不同值一律拒绝。调用方须先
    /// 持久冻结 locator；DD-85 的新目标还须校验返回的版本恰为 1。
    pub async fn write_once(
        &self,
        locator: &str,
        field: &str,
        value: &str,
    ) -> Result<u32, SecretError> {
        let (namespace, mount, path) = split_locator(locator)?;
        let token = self.token_for_namespace(&namespace).await?;
        let current = self
            .current_version(&namespace, &mount, &path, token.as_str())
            .await?;
        if current == 0 {
            match self
                .write_with_cas((&namespace, &mount, &path), token.as_str(), field, value, 0)
                .await
            {
                Ok(1) => {}
                Ok(_) => return Err(SecretError::Malformed),
                // 另一调用方先写成功：只读回并比对，不再次写入。
                Err(SecretError::WriteRejected) => {}
                Err(e) => return Err(e),
            }
        }
        let observed = if current == 0 {
            self.current_version(&namespace, &mount, &path, token.as_str())
                .await?
        } else {
            current
        };
        if observed == 0 {
            return Err(SecretError::VersionUnavailable);
        }
        let existing = self
            .read(
                &SecretRef {
                    locator: locator.to_owned(),
                    version: observed,
                    audience: self.identity.clone(),
                },
                field,
            )
            .await?;
        if existing.expose() != value {
            return Err(SecretError::WriteRejected);
        }
        Ok(observed)
    }

    async fn current_version(
        &self,
        namespace: &str,
        mount: &str,
        path: &str,
        token: &str,
    ) -> Result<u32, SecretError> {
        let metadata = self
            .session
            .http
            .get(format!("{}/v1/{mount}/metadata/{path}", self.session.addr))
            .header("X-Vault-Namespace", namespace)
            .header("X-Vault-Token", token)
            .send()
            .await?;
        match metadata.status().as_u16() {
            200 => Ok(metadata
                .json::<KvCurrentMetadataResponse>()
                .await
                .map_err(|_| SecretError::Malformed)?
                .data
                .current_version),
            404 => Ok(0),
            401 | 403 => Err(SecretError::Refused),
            _ => Err(SecretError::Malformed),
        }
    }

    async fn write_with_cas(
        &self,
        location: (&str, &str, &str),
        token: &str,
        field: &str,
        value: &str,
        current_version: u32,
    ) -> Result<u32, SecretError> {
        let (namespace, mount, path) = location;
        let resp = self
            .session
            .http
            .post(format!("{}/v1/{mount}/data/{path}", self.session.addr))
            .header("X-Vault-Namespace", namespace)
            .header("X-Vault-Token", token)
            .json(&serde_json::json!({ "data": { field: value }, "options": { "cas": current_version } }))
            .send()
            .await?;
        match resp.status().as_u16() {
            200 => Ok(resp.json::<KvWriteResponse>().await?.data.version),
            401 | 403 => Err(SecretError::Refused),
            400 => Err(SecretError::WriteRejected),
            _ => Err(SecretError::Malformed),
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
                Some(wrapped),
                bounded_openbao_client()?,
            ),
        })
    }

    pub async fn connect(&self) -> Result<(), SecretError> {
        self.session.connect().await
    }

    pub async fn keep_alive(&self) -> SecretError {
        self.session.keep_alive().await
    }

    pub async fn revoke_current(&self) -> Result<(), SecretError> {
        self.session.revoke_current().await
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

/// platform/ 的 locator 是 namespace/mount/path；Tenant namespace 固定为
/// tenants/<UUID>，所以它是 tenants/<UUID>/mount/path。不能用 splitn(3)
/// 把 UUID 误认成 mount，否则会向父 namespace 发出错误的请求。
fn split_locator(locator: &str) -> Result<(String, String, String), SecretError> {
    let (namespace, tail) = if let Some(rest) = locator.strip_prefix("tenants/") {
        let (id, tail) = rest
            .split_once('/')
            .ok_or_else(|| SecretError::LocatorMalformed(locator.to_owned()))?;
        let id = Uuid::parse_str(id)
            .ok()
            .filter(|uuid| uuid.to_string() == id)
            .ok_or_else(|| SecretError::LocatorMalformed(locator.to_owned()))?;
        (format!("tenants/{id}"), tail)
    } else {
        let (namespace, tail) = locator
            .split_once('/')
            .ok_or_else(|| SecretError::LocatorMalformed(locator.to_owned()))?;
        (namespace.to_owned(), tail)
    };
    let (mount, path) = tail
        .split_once('/')
        .ok_or_else(|| SecretError::LocatorMalformed(locator.to_owned()))?;
    if namespace.is_empty() || mount.is_empty() || path.is_empty() {
        return Err(SecretError::LocatorMalformed(locator.to_owned()));
    }
    Ok((namespace, mount.to_owned(), path.to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    fn fake_store(addr: &str) -> SecretStore {
        let (tenant_failure_tx, tenant_failure_rx) = mpsc::unbounded_channel();
        SecretStore {
            session: AppRoleSession::new(
                addr,
                "platform".to_owned(),
                "role".to_owned(),
                "role".to_owned(),
                None,
                reqwest::Client::new(),
            ),
            provisioner: AppRoleSession::new(
                addr,
                "tenants".to_owned(),
                "role".to_owned(),
                "role".to_owned(),
                None,
                reqwest::Client::new(),
            ),
            tenant: TenantConfig {
                parent: "tenants".to_owned(),
                mount: "kv".to_owned(),
                role_name: "role".to_owned(),
                max_versions: 10,
                secret_id_ttl: String::new(),
                token_period: String::new(),
                core_bound_cidrs: String::new(),
            },
            tenant_sessions: Mutex::new(HashMap::new()),
            tenant_failure_tx,
            tenant_failure_rx: Mutex::new(tenant_failure_rx),
            identity: "core".to_owned(),
        }
    }

    async fn fake_tenant_store(addr: &str, tenant_id: Uuid) -> SecretStore {
        let store = fake_store(addr);
        let session = Arc::new(AppRoleSession::new(
            addr,
            format!("tenants/{tenant_id}"),
            "role".to_owned(),
            "role".to_owned(),
            None,
            reqwest::Client::new(),
        ));
        *session.lease.write().await = Some(Lease {
            token: Arc::new("service".to_owned()),
            ttl: Duration::from_secs(120),
        });
        let cell = Arc::new(OnceCell::new());
        assert!(cell.set(session).is_ok());
        store.tenant_sessions.lock().await.insert(tenant_id, cell);
        store
    }

    #[tokio::test]
    async fn bounded_session_returns_transport_error_when_openbao_stalls() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("监听假 OpenBao");
        let addr = listener.local_addr().expect("假 OpenBao 地址");
        let server = std::thread::spawn(move || {
            let (_stream, _) = listener.accept().expect("接收 OpenBao 请求");
            std::thread::sleep(Duration::from_millis(250));
        });
        let http = reqwest::Client::builder()
            .timeout(Duration::from_millis(30))
            .build()
            .expect("有界客户端");
        let session = AppRoleSession::new(
            &format!("http://{addr}"),
            "platform".to_owned(),
            "role-id".to_owned(),
            "probe".to_owned(),
            None,
            http,
        );
        assert!(matches!(
            session.login("one-use-secret").await,
            Err(SecretError::Transport(error)) if error.is_timeout()
        ));
        server.join().expect("假 OpenBao 收尾");
    }

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
    async fn deterministic_write_recovers_lost_response_without_appending_version() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let addr = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let replies = [
                ("404 Not Found", ""),
                ("", ""), // OpenBao 持久写入后，响应在传输途中丢失。
                ("200 OK", r#"{"data":{"current_version":1}}"#),
                (
                    "200 OK",
                    r#"{"data":{"data":{"value":"same-key"},"metadata":{"version":1}}}"#,
                ),
                ("200 OK", r#"{"data":{"current_version":1}}"#),
                (
                    "200 OK",
                    r#"{"data":{"data":{"value":"same-key"},"metadata":{"version":1}}}"#,
                ),
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
                requests.push(String::from_utf8_lossy(&bytes[..size]).to_string());
                let (status, body) = replies[requests.len() - 1];
                if status.is_empty() {
                    continue;
                }
                let response = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                stream.write_all(response.as_bytes()).unwrap();
            }
            requests
        });

        let store = fake_store(&format!("http://{addr}"));
        *store.session.lease.write().await = Some(Lease {
            token: Arc::new("service".to_owned()),
            ttl: Duration::from_secs(120),
        });

        let locator = "platform/kv/operator/probe";
        assert!(matches!(
            store.write_once(locator, "value", "same-key").await,
            Err(SecretError::Transport(_))
        ));
        assert_eq!(
            store
                .write_once(locator, "value", "same-key")
                .await
                .unwrap(),
            1
        );
        assert!(matches!(
            store.write_once(locator, "value", "different-key").await,
            Err(SecretError::WriteRejected)
        ));

        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 6);
        assert_eq!(
            requests
                .iter()
                .filter(|request| request.starts_with("POST "))
                .count(),
            1
        );
        assert!(requests[1].contains("\"cas\":0"));
    }

    #[tokio::test]
    async fn lost_destroy_response_can_be_resolved_by_metadata() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let addr = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let replies = [
                (
                    "200 OK",
                    r#"{"data":{"versions":{"1":{"destroyed":false}}}}"#,
                ),
                ("", ""), // 服务端已销毁版本，HTTP 响应在传输途中丢失。
                (
                    "200 OK",
                    r#"{"data":{"versions":{"1":{"destroyed":true}}}}"#,
                ),
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
                requests.push(String::from_utf8_lossy(&bytes[..size]).to_string());
                let (status, body) = replies[requests.len() - 1];
                if status.is_empty() {
                    continue;
                }
                let response = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                stream.write_all(response.as_bytes()).unwrap();
            }
            requests
        });

        let store = fake_store(&format!("http://{addr}"));
        *store.session.lease.write().await = Some(Lease {
            token: Arc::new("service".to_owned()),
            ttl: Duration::from_secs(120),
        });
        let tenant = Uuid::nil();
        let locator = format!("platform/kv/buzz-human/{tenant}/probe");
        assert!(!store.version_destroyed(tenant, &locator, 1).await.unwrap());
        assert!(matches!(
            store
                .destroy_legacy_identity_version(tenant, &locator, 1)
                .await,
            Err(SecretError::Transport(_))
        ));
        assert!(store.version_destroyed(tenant, &locator, 1).await.unwrap());

        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 3, "单次销毁调用之后仍可读取 metadata");
        assert_eq!(
            requests
                .iter()
                .filter(|request| request.starts_with("POST "))
                .count(),
            1,
            "该次销毁调用只发出一个 POST"
        );
        assert!(requests[0].contains("/metadata/buzz-human/"));
        assert!(requests[1].contains("/destroy/buzz-human/"));
        assert!(requests[2].contains("/metadata/buzz-human/"));
    }

    #[tokio::test]
    async fn orphan_provision_fence_races_original_write_and_proves_destroyed_metadata() {
        for original_write_wins in [false, true] {
            let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
            listener.set_nonblocking(true).unwrap();
            let addr = listener.local_addr().unwrap();
            let server = std::thread::spawn(move || {
                let marker = if original_write_wins {
                    ("400 Bad Request", r#"{"errors":["cas mismatch"]}"#)
                } else {
                    ("200 OK", r#"{"data":{"version":1}}"#)
                };
                let destroy = if original_write_wins {
                    ("", "") // OpenBao 已销毁，回应在传输途中丢失。
                } else {
                    ("204 No Content", "")
                };
                let replies = [
                    ("404 Not Found", ""),
                    marker,
                    (
                        "200 OK",
                        r#"{"data":{"current_version":1,"versions":{"1":{"destroyed":false}}}}"#,
                    ),
                    destroy,
                    (
                        "200 OK",
                        r#"{"data":{"current_version":1,"versions":{"1":{"destroyed":true}}}}"#,
                    ),
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
                    requests.push(String::from_utf8_lossy(&bytes[..size]).to_string());
                    let (status, body) = replies[requests.len() - 1];
                    if status.is_empty() {
                        continue;
                    }
                    let response = format!(
                        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    stream.write_all(response.as_bytes()).unwrap();
                }
                requests
            });
            let tenant = Uuid::nil();
            let action = Uuid::max();
            let store = fake_tenant_store(&format!("http://{addr}"), tenant).await;
            let locator = store.tenant_locator(tenant, &format!("buzz-human/provision/{action}"));
            store
                .destroy_unbound_server_human_provision(tenant, action, &locator)
                .await
                .unwrap();
            let requests = server.join().unwrap();
            assert_eq!(requests.len(), 5);
            assert!(requests[1].starts_with("POST /v1/kv/data/buzz-human/provision/"));
            assert!(requests[1].contains("\"cas\":0"));
            assert!(requests[3].starts_with("POST /v1/kv/destroy/buzz-human/provision/"));
            assert!(requests[3].contains("\"versions\":[1]"));
        }
    }

    #[tokio::test]
    async fn orphan_provision_refuses_different_locator_before_any_openbao_call() {
        let tenant = Uuid::nil();
        let action = Uuid::max();
        let store = fake_store("");
        let other = store.tenant_locator(tenant, "buzz-human/provision/other");
        assert!(matches!(
            store
                .destroy_unbound_server_human_provision(tenant, action, &other)
                .await,
            Err(SecretError::Refused)
        ));
    }

    #[tokio::test]
    async fn rehome_copy_refuses_another_rehome_locator_before_any_openbao_call() {
        let tenant = Uuid::nil();
        let rehome = Uuid::max();
        let store = fake_store("");
        let other = store.tenant_locator(tenant, &format!("buzz-human/provision/{rehome}"));
        assert!(matches!(
            store
                .destroy_unbound_rehome_copy(tenant, rehome, &other)
                .await,
            Err(SecretError::Refused)
        ));
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
            Some("wrapped".to_owned()),
            reqwest::Client::new(),
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

    #[tokio::test]
    async fn exit_revocation_retains_token_until_confirmed() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let addr = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let mut requests = Vec::new();
            let deadline = std::time::Instant::now() + Duration::from_secs(5);
            while requests.len() < 2 && std::time::Instant::now() < deadline {
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
                let status = if requests.is_empty() {
                    "500 Internal Server Error"
                } else {
                    "204 No Content"
                };
                let response =
                    format!("HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
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
            Some("wrapped".to_owned()),
            reqwest::Client::new(),
        );
        *session.lease.write().await = Some(Lease {
            token: Arc::new("current".to_owned()),
            ttl: Duration::from_secs(120),
        });
        assert!(matches!(
            session.revoke_current().await,
            Err(SecretError::RevocationUnconfirmed)
        ));
        assert_eq!(session.token().await.unwrap().as_str(), "current");
        session.revoke_current().await.unwrap();
        assert!(matches!(
            session.token().await,
            Err(SecretError::CredentialLost)
        ));
        session.revoke_current().await.unwrap();
        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 2);
        for request in requests {
            assert!(request.starts_with("PUT /v1/auth/token/revoke-self HTTP/1.1"));
            assert!(request.contains("x-vault-token: current"));
            assert!(request.contains("x-vault-namespace: platform"));
        }
    }
}
