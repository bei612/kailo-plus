//! DD-15/26/47/65/71, SS-COD-APP: Core 内的原生 stdio Supervisor。
//! 只发送固定 thread/turn RPC；不继承 Core env，不提供 host 执行 RPC。

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::Duration,
};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{pool::PoolConnection, PgPool, Postgres};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::Mutex,
};
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub(crate) enum RuntimeError {
    #[error("runtime 未投递或投影不成立")]
    Unavailable,
    #[error("runtime 原生结果不明；仅允许观察既有引用")]
    Unknown,
    #[error("runtime 回应不符合固定协议")]
    Protocol,
    #[error("runtime 请求需要独立治理准入")]
    AdmissionRequired,
}

/// 只来自查证后的 RuntimeProjection；绝不从 prompt 接收 provider 或路径。
pub(crate) struct Projection {
    pub installation_id: Uuid,
    pub generation: i64,
    pub config_hash: String,
    pub model: String,
    pub gateway_base_url: String,
    pub instructions: String,
}

/// 观察/取消仅需要已有原生引用的 fence，不伪造空模型或 credential。
pub(crate) struct RuntimeRef {
    pub installation_id: Uuid,
    pub generation: i64,
    pub config_hash: String,
}

pub(crate) struct Supervisor {
    binary: PathBuf,
    root: PathBuf,
    timeout: Duration,
    max_message_bytes: usize,
    processes: Mutex<HashMap<Uuid, Arc<Mutex<Process>>>>,
}

struct Process {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    // 同一 Core 进程的 mutex 与跨 Core 的原生 advisory lock 都必须成立。
    ownership: PoolConnection<Postgres>,
    generation: i64,
    config_hash: String,
    model: String,
    gateway_base_url: String,
    instructions: String,
    credential_digest: [u8; 32],
    home: PathBuf,
    next_id: u64,
    pending_line: Vec<u8>,
}

impl Supervisor {
    /// 对账整条原生观察链共享已投递的 RPC 预算，不按页无限延长持锁时间。
    pub(crate) fn observation_timeout(&self) -> Duration {
        self.timeout
    }

    /// 未投递 runtime 时不破坏既有非 Agent 入口，但任何 Agent 消费都不可用。
    /// 部分投递、空值、非法路径拒绝 Core 启动，不回退本机 Codex/默认目录。
    pub(crate) fn from_env() -> Result<Option<Self>, RuntimeError> {
        let names = [
            "AGENT_RUNTIME_BINARY",
            "AGENT_RUNTIME_STATE_ROOT",
            "AGENT_RUNTIME_RPC_TIMEOUT_SECONDS",
            "AGENT_RUNTIME_MAX_MESSAGE_BYTES",
        ];
        let values: Vec<_> = names.iter().map(|n| std::env::var(n).ok()).collect();
        if values.iter().all(Option::is_none) {
            return Ok(None);
        }
        let value = |i: usize| {
            values[i]
                .as_deref()
                .filter(|v| !v.trim().is_empty())
                .ok_or(RuntimeError::Unavailable)
        };
        let binary = PathBuf::from(value(0)?);
        let root = PathBuf::from(value(1)?);
        let seconds: u64 = value(2)?.parse().map_err(|_| RuntimeError::Unavailable)?;
        let max_message_bytes: usize = value(3)?.parse().map_err(|_| RuntimeError::Unavailable)?;
        if !binary.is_absolute()
            || !binary.is_file()
            || !root.is_absolute()
            || root == Path::new("/")
            || root
                .components()
                .any(|part| matches!(part, std::path::Component::ParentDir))
            || seconds == 0
            || max_message_bytes == 0
        {
            return Err(RuntimeError::Unavailable);
        }
        Ok(Some(Self {
            binary,
            root,
            timeout: Duration::from_secs(seconds),
            max_message_bytes,
            processes: Mutex::new(HashMap::new()),
        }))
    }

    /// initialize 成功 + config/read 明确回读承重字段才返回；spawn 不是 ready。
    /// token 仅进入隔离子进程的白名单 env，既不写 config，也不实现 Debug。
    pub(crate) async fn ensure(
        &self,
        pool: &PgPool,
        projection: &Projection,
        model_token: &str,
    ) -> Result<(), RuntimeError> {
        if projection.generation <= 0
            || projection.config_hash.len() != 64
            || projection.model.trim().is_empty()
            || projection.instructions.trim().is_empty()
            || model_token.is_empty()
        {
            return Err(RuntimeError::Unavailable);
        }
        let url = reqwest::Url::parse(&projection.gateway_base_url)
            .map_err(|_| RuntimeError::Unavailable)?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(RuntimeError::Unavailable);
        }
        let mut processes = self.processes.lock().await;
        if let Some(process) = processes.get(&projection.installation_id) {
            let mut process = process.lock().await;
            process
                .check(projection.generation, &projection.config_hash)
                .await?;
            let credential_digest: [u8; 32] = Sha256::digest(model_token.as_bytes()).into();
            if process.model != projection.model
                || process.gateway_base_url != projection.gateway_base_url
                || process.instructions != projection.instructions
                || process.credential_digest != credential_digest
            {
                // 同一 hash 不能掩盖已换 provider/credential；要求安装链 drain/reconcile，
                // 不让旧进程冒称新投递已加载。指纹只在内存、不进入模型/日志/history。
                return Err(RuntimeError::Unavailable);
            }
            return Ok(());
        }
        let mut ownership = pool
            .acquire()
            .await
            .map_err(|_| RuntimeError::Unavailable)?;
        let locked: bool =
            sqlx::query_scalar("select pg_try_advisory_lock(hashtextextended($1,0))")
                .bind(format!(
                    "platform.agent-runtime:{}",
                    projection.installation_id
                ))
                .fetch_one(&mut *ownership)
                .await
                .map_err(|_| RuntimeError::Unavailable)?;
        if !locked {
            return Err(RuntimeError::Unavailable);
        }
        // 连接不能归还池中保留锁。Process drop 后关闭连接，同时 kill_on_drop 杀子进程。
        ownership.close_on_drop();
        tokio::fs::create_dir_all(&self.root)
            .await
            .map_err(|_| RuntimeError::Unavailable)?;
        let root_meta = tokio::fs::symlink_metadata(&self.root)
            .await
            .map_err(|_| RuntimeError::Unavailable)?;
        if !root_meta.is_dir() || root_meta.file_type().is_symlink() {
            return Err(RuntimeError::Unavailable);
        }
        let root = tokio::fs::canonicalize(&self.root)
            .await
            .map_err(|_| RuntimeError::Unavailable)?;
        if root == Path::new("/") {
            return Err(RuntimeError::Unavailable);
        }
        let home = root.join(projection.installation_id.to_string());
        tokio::fs::create_dir_all(&home)
            .await
            .map_err(|_| RuntimeError::Unavailable)?;
        let home_meta = tokio::fs::symlink_metadata(&home)
            .await
            .map_err(|_| RuntimeError::Unavailable)?;
        if !home_meta.is_dir() || home_meta.file_type().is_symlink() {
            return Err(RuntimeError::Unavailable);
        }
        let home = tokio::fs::canonicalize(home)
            .await
            .map_err(|_| RuntimeError::Unavailable)?;
        if home.parent() != Some(root.as_path()) {
            return Err(RuntimeError::Unavailable);
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            tokio::fs::set_permissions(&home, std::fs::Permissions::from_mode(0o700))
                .await
                .map_err(|_| RuntimeError::Unavailable)?;
        }
        let quoted = |s: &str| serde_json::to_string(s).map_err(|_| RuntimeError::Protocol);
        // 当前既有 Version 准入拒绝非空 Skill/Tool 引用。原生 bundled skill
        // 默认开启，必须明确关闭；不能把默认发现当成已治理的 SkillVersion。
        let config = format!("model = {}\nmodel_provider = \"platform_gateway\"\napproval_policy = \"on-request\"\napprovals_reviewer = \"user\"\nsqlite_home = {}\ndeveloper_instructions = {}\n[skills.bundled]\nenabled = false\n[features]\nmemories = false\nshell_tool = false\ntool_call_mcp_elicitation = true\n[model_providers.platform_gateway]\nname = \"Platform AgentGateway\"\nbase_url = {}\nwire_api = \"responses\"\nenv_key = \"KAILO_CODEX_MODEL_TOKEN\"\n", quoted(&projection.model)?, quoted(&home.to_string_lossy())?, quoted(&projection.instructions)?, quoted(&projection.gateway_base_url)?);
        tokio::fs::write(home.join("config.toml"), config)
            .await
            .map_err(|_| RuntimeError::Unavailable)?;
        // 原生 provider 从独立 environments.toml 读取；config.toml 的同名 table
        // 不承载这个条件。使用原固定 runtime artifact 的原文件，不重新造配置。
        let environments = tokio::fs::read("/usr/share/platform/codex/environments.toml")
            .await
            .map_err(|_| RuntimeError::Unavailable)?;
        if std::str::from_utf8(&environments).ok().is_none_or(|s| {
            !s.lines().any(|l| l.trim() == "include_local = false")
                || !s.lines().any(|l| l.trim() == "default = \"none\"")
        }) {
            return Err(RuntimeError::Unavailable);
        }
        tokio::fs::write(home.join("environments.toml"), &environments)
            .await
            .map_err(|_| RuntimeError::Unavailable)?;
        let mut child = Command::new(&self.binary)
            .arg("--listen")
            .arg("stdio://")
            .env_clear()
            .env("HOME", &home)
            .env("CODEX_HOME", &home)
            .env("CODEX_EXEC_SERVER_URL", "none")
            .env("KAILO_CODEX_MODEL_TOKEN", model_token)
            .current_dir(&home)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|_| RuntimeError::Unavailable)?;
        let stdin = child.stdin.take().ok_or(RuntimeError::Unavailable)?;
        let stdout = child.stdout.take().ok_or(RuntimeError::Unavailable)?;
        let mut process = Process {
            child,
            stdin,
            stdout: BufReader::new(stdout),
            ownership,
            generation: projection.generation,
            config_hash: projection.config_hash.clone(),
            model: projection.model.clone(),
            gateway_base_url: projection.gateway_base_url.clone(),
            instructions: projection.instructions.clone(),
            credential_digest: Sha256::digest(model_token.as_bytes()).into(),
            home,
            next_id: 0,
            pending_line: Vec::new(),
        };
        let initialized = process.rpc("initialize", json!({"clientInfo":{"name":"platform-core","version":env!("CARGO_PKG_VERSION")},"capabilities":{"experimentalApi":true}}), self.timeout, self.max_message_bytes).await?;
        if initialized.get("codexHome").and_then(Value::as_str) != process.home.to_str() {
            return Err(RuntimeError::Protocol);
        }
        process.send(&json!({"method":"initialized"})).await?;
        let read = process
            .rpc(
                "config/read",
                json!({"includeLayers":true}),
                self.timeout,
                self.max_message_bytes,
            )
            .await?;
        let config = read.get("config").ok_or(RuntimeError::Protocol)?;
        if config.get("model").and_then(Value::as_str) != Some(projection.model.as_str())
            || config.get("model_provider").and_then(Value::as_str) != Some("platform_gateway")
            || config.get("approval_policy").and_then(Value::as_str) != Some("on-request")
            || config.get("approvals_reviewer").and_then(Value::as_str) != Some("user")
            || config.get("developer_instructions").and_then(Value::as_str) != Some(projection.instructions.as_str())
            || config.pointer("/skills/bundled/enabled").and_then(Value::as_bool) != Some(false)
            // 固定 ConfigToml 的 MCP 默认是空 map；显式未知形状或非空配置
            // 都不能借 initialize 成功变成已加载的有效 ToolBinding 交集。
            || config.get("mcp_servers").is_some_and(|servers| servers.as_object().is_none_or(|servers| !servers.is_empty()))
            || config.pointer("/features/memories").and_then(Value::as_bool) != Some(false)
            || config.pointer("/features/shell_tool").and_then(Value::as_bool) != Some(false)
            || config.pointer("/features/tool_call_mcp_elicitation").and_then(Value::as_bool) != Some(true)
            || config.pointer("/model_providers/platform_gateway/base_url").and_then(Value::as_str) != Some(projection.gateway_base_url.as_str())
            || config.pointer("/model_providers/platform_gateway/wire_api").and_then(Value::as_str) != Some("responses")
            || config.pointer("/model_providers/platform_gateway/env_key").and_then(Value::as_str) != Some("KAILO_CODEX_MODEL_TOKEN")
        {
            return Err(RuntimeError::Protocol);
        }
        processes.insert(projection.installation_id, Arc::new(Mutex::new(process)));
        Ok(())
    }

    async fn call(
        &self,
        projection: &RuntimeRef,
        method: &str,
        params: Value,
    ) -> Result<Value, RuntimeError> {
        let process = self
            .processes
            .lock()
            .await
            .get(&projection.installation_id)
            .cloned()
            .ok_or(RuntimeError::Unavailable)?;
        let mut process = process.lock().await;
        process
            .check(projection.generation, &projection.config_hash)
            .await?;
        process
            .rpc(method, params, self.timeout, self.max_message_bytes)
            .await
    }

    /// Fixed Codex 7498521d288b9b3b96ffba4eedf089d8d6e06a84,
    /// codex-rs/app-server-protocol/src/protocol/v2/thread.rs::ThreadStartParams.
    /// Durable thread only; no environment, model fallback or credential/config override.
    pub(crate) async fn start_thread(
        &self,
        projection: &RuntimeRef,
    ) -> Result<String, RuntimeError> {
        let response = self
            .call(
                projection,
                "thread/start",
                json!({
                    "ephemeral":false,
                    "environments":[],
                    "allowProviderModelFallback":false,
                }),
            )
            .await?;
        let thread_id = isolated_thread_id(&response)?;
        let process = self
            .processes
            .lock()
            .await
            .get(&projection.installation_id)
            .cloned()
            .ok_or(RuntimeError::Unknown)?;
        let mut process = process.lock().await;
        process
            .check(projection.generation, &projection.config_hash)
            .await?;
        if response.get("model").and_then(Value::as_str) != Some(process.model.as_str())
            || response.get("cwd").and_then(Value::as_str) != process.home.to_str()
            || response.get("approvalPolicy").and_then(Value::as_str) != Some("on-request")
            || response.get("approvalsReviewer").and_then(Value::as_str) != Some("user")
        {
            return Err(RuntimeError::Protocol);
        }
        Ok(thread_id.to_owned())
    }

    /// SF-COD-09：客户端恢复只使用已持久 thread ID，不传 path/history/config。
    /// 不启动新 turn；承重隔离仍由本进程 generation/hash 与无 environment 提供。
    pub(crate) async fn resume_thread(
        &self,
        projection: &RuntimeRef,
        thread_id: &str,
    ) -> Result<(), RuntimeError> {
        if Uuid::parse_str(thread_id).is_err() {
            return Err(RuntimeError::Protocol);
        }
        let response = self
            .call(
                projection,
                "thread/resume",
                json!({"threadId":thread_id,"excludeTurns":true}),
            )
            .await?;
        if isolated_thread_id(&response)? != thread_id {
            return Err(RuntimeError::Protocol);
        }
        Ok(())
    }

    /// 固定已知 thread/turn，不发送原生允许的空 turn 启动期取消。
    pub(crate) async fn interrupt(
        &self,
        projection: &RuntimeRef,
        thread_id: &str,
        turn_id: &str,
    ) -> Result<(), RuntimeError> {
        if thread_id.is_empty() || turn_id.is_empty() {
            return Err(RuntimeError::Protocol);
        }
        self.call(
            projection,
            "turn/interrupt",
            json!({"threadId":thread_id,"turnId":turn_id}),
        )
        .await?;
        Ok(())
    }

    /// 只读原生 durable history；使用固定 native 自身的分页缺省，不另造平台上限。
    /// 回应分配仍受实际投递的 max_message_bytes 约束，超限只能保留 UNKNOWN。
    pub(crate) async fn turns(
        &self,
        projection: &RuntimeRef,
        thread_id: &str,
        cursor: Option<&str>,
    ) -> Result<Value, RuntimeError> {
        if thread_id.is_empty() {
            return Err(RuntimeError::Protocol);
        }
        self.call(
            projection,
            "thread/turns/list",
            json!({"threadId":thread_id,"cursor":cursor,"sortDirection":"desc","itemsView":"full"}),
        )
        .await
    }

    pub(crate) async fn stop(&self, installation: Uuid) -> Result<(), RuntimeError> {
        let mut processes = self.processes.lock().await;
        if let Some(process) = processes.get(&installation).cloned() {
            {
                let mut process = process.lock().await;
                terminate(&mut process.child, self.timeout).await?;
            }
            // 只有 wait 已确认退出才释放跨 Core ownership；结果不明保留原引用。
            processes.remove(&installation);
        }
        Ok(())
    }

    /// DD-99：安装运行体退出、取得同一 ownership、精确删除状态后回读缺席。
    /// 只能用于已经冻结/删除方向的 Installation；不是通用文件删除入口。
    pub(crate) async fn retirement(
        &self,
        pool: &PgPool,
        installation: Uuid,
    ) -> Result<(), RuntimeError> {
        self.stop(installation).await?;
        let mut ownership = pool
            .acquire()
            .await
            .map_err(|_| RuntimeError::Unavailable)?;
        let locked: bool =
            sqlx::query_scalar("select pg_try_advisory_lock(hashtextextended($1,0))")
                .bind(format!("platform.agent-runtime:{installation}"))
                .fetch_one(&mut *ownership)
                .await
                .map_err(|_| RuntimeError::Unknown)?;
        if !locked {
            return Err(RuntimeError::Unavailable);
        }
        ownership.close_on_drop();
        let root_meta = match tokio::fs::symlink_metadata(&self.root).await {
            Ok(meta) => meta,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                // 从未启动的安装没有状态根；仍回读精确 UUID 目标的缺席。
                return match tokio::fs::symlink_metadata(self.root.join(installation.to_string()))
                    .await
                {
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
                    _ => Err(RuntimeError::Unknown),
                };
            }
            Err(_) => return Err(RuntimeError::Unknown),
        };
        if !root_meta.is_dir() || root_meta.file_type().is_symlink() {
            return Err(RuntimeError::Unavailable);
        }
        let root = tokio::fs::canonicalize(&self.root)
            .await
            .map_err(|_| RuntimeError::Unknown)?;
        if root == Path::new("/") || !root.is_absolute() {
            return Err(RuntimeError::Unavailable);
        }
        let target = root.join(installation.to_string());
        let meta = match tokio::fs::symlink_metadata(&target).await {
            Ok(meta) => meta,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(_) => return Err(RuntimeError::Unknown),
        };
        if !meta.is_dir() || meta.file_type().is_symlink() {
            return Err(RuntimeError::Unavailable);
        }
        let canonical = tokio::fs::canonicalize(&target)
            .await
            .map_err(|_| RuntimeError::Unknown)?;
        if canonical.parent() != Some(root.as_path()) || canonical != target {
            return Err(RuntimeError::Unavailable);
        }
        // 根不是 /，唯一 UUID 目标已实际解析；持有 ownership，已无可写子进程。
        tokio::fs::remove_dir_all(&canonical)
            .await
            .map_err(|_| RuntimeError::Unknown)?;
        match tokio::fs::symlink_metadata(&target).await {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            _ => Err(RuntimeError::Unknown),
        }
    }

    /// reconcile 只排除本机确实存活且仍持相同 generation/hash fence 的实例。
    /// 这是本机进程观察，不是第二份 Installation 状态/注册权威。
    pub(crate) async fn healthy_installations(&self) -> Vec<Uuid> {
        let mut processes = self.processes.lock().await;
        let mut healthy = Vec::new();
        let mut remove = Vec::new();
        for (installation, process) in processes.iter() {
            let mut process = process.lock().await;
            let live = matches!(process.child.try_wait(), Ok(None));
            let fenced = if live {
                let generation = process.generation;
                let hash = process.config_hash.clone();
                sqlx::query_scalar::<_, bool>("select exists(select 1 from catalog.agent_installation i
                    join catalog.agent_runtime_projection p on p.installation_resource_id=i.resource_id
                      and p.generation=i.active_projection_generation
                    where i.resource_id=$1 and i.state='ACTIVE' and p.state='ACTIVE'
                      and p.generation=$2 and p.config_hash=$3)")
                    .bind(installation).bind(generation).bind(hash)
                    .fetch_one(&mut *process.ownership).await.unwrap_or(false)
            } else {
                false
            };
            if live && fenced {
                healthy.push(*installation);
            } else {
                let generation = process.generation;
                // DB 不可达时写入也可能失败；仍不返回健康、不清除任何原生引用。
                let _ = sqlx::query(
                    "update catalog.agent_invocation set status='UNKNOWN',updated_at=now()
                    where installation_resource_id=$1 and projection_generation=$2
                      and status in ('DISPATCHING','RUNNING')",
                )
                .bind(installation)
                .bind(generation)
                .execute(&mut *process.ownership)
                .await;
                if terminate(&mut process.child, self.timeout).await.is_ok() {
                    remove.push(*installation);
                }
            }
        }
        for installation in remove {
            processes.remove(&installation);
        }
        healthy
    }

    pub(crate) async fn stop_all(&self, pool: &PgPool) -> Result<(), RuntimeError> {
        let installations: Vec<_> = self.processes.lock().await.keys().copied().collect();
        let mut failed = false;
        for installation in installations {
            // Core 进程退出不证明 native terminal。先保留 UNKNOWN 原引用，再停
            // 子进程；不释放 Capacity、不发第二次 turn，也不清 durable thread。
            if sqlx::query("update catalog.agent_invocation set status='UNKNOWN',updated_at=now() where installation_resource_id=$1 and status in ('DISPATCHING','RUNNING')")
                .bind(installation).execute(pool).await.is_err() { failed = true; }
            if self.stop(installation).await.is_err() {
                failed = true;
            }
        }
        if failed {
            Err(RuntimeError::Unknown)
        } else {
            Ok(())
        }
    }
}

fn isolated_thread_id(response: &Value) -> Result<&str, RuntimeError> {
    let thread = response.get("thread").ok_or(RuntimeError::Protocol)?;
    let id = thread
        .get("id")
        .and_then(Value::as_str)
        .ok_or(RuntimeError::Protocol)?;
    if Uuid::parse_str(id).is_err()
        || thread.get("ephemeral").and_then(Value::as_bool) != Some(false)
        || thread.get("parentThreadId") != Some(&Value::Null)
        || thread.get("forkedFromId") != Some(&Value::Null)
        || thread
            .get("environments")
            .and_then(Value::as_array)
            .is_none_or(|v| !v.is_empty())
        || thread.get("modelProvider").and_then(Value::as_str) != Some("platform_gateway")
        || response.get("modelProvider").and_then(Value::as_str) != Some("platform_gateway")
    {
        return Err(RuntimeError::Protocol);
    }
    Ok(id)
}

async fn terminate(child: &mut Child, timeout: Duration) -> Result<(), RuntimeError> {
    if child
        .try_wait()
        .map_err(|_| RuntimeError::Unknown)?
        .is_some()
    {
        return Ok(());
    }
    if child.start_kill().is_err()
        && child
            .try_wait()
            .map_err(|_| RuntimeError::Unknown)?
            .is_none()
    {
        return Err(RuntimeError::Unknown);
    }
    tokio::time::timeout(timeout, child.wait())
        .await
        .map_err(|_| RuntimeError::Unknown)?
        .map_err(|_| RuntimeError::Unknown)?;
    Ok(())
}

impl Process {
    async fn check(&mut self, generation: i64, config_hash: &str) -> Result<(), RuntimeError> {
        if self.generation != generation || self.config_hash != config_hash {
            return Err(RuntimeError::Unavailable);
        }
        if self
            .child
            .try_wait()
            .map_err(|_| RuntimeError::Unknown)?
            .is_some()
        {
            return Err(RuntimeError::Unavailable);
        }
        if sqlx::query("select 1")
            .execute(&mut *self.ownership)
            .await
            .is_err()
        {
            let _ = self.child.kill().await;
            return Err(RuntimeError::Unknown);
        }
        Ok(())
    }

    async fn send(&mut self, value: &Value) -> Result<(), RuntimeError> {
        let mut bytes = serde_json::to_vec(value).map_err(|_| RuntimeError::Protocol)?;
        bytes.push(b'\n');
        self.stdin
            .write_all(&bytes)
            .await
            .map_err(|_| RuntimeError::Unknown)?;
        self.stdin.flush().await.map_err(|_| RuntimeError::Unknown)
    }

    async fn rpc(
        &mut self,
        method: &str,
        params: Value,
        timeout: Duration,
        max: usize,
    ) -> Result<Value, RuntimeError> {
        self.next_id = self.next_id.checked_add(1).ok_or(RuntimeError::Protocol)?;
        let id = self.next_id;
        let request = json!({"id":id,"method":method,"params":params});
        tokio::time::timeout(timeout, self.send(&request))
            .await
            .map_err(|_| RuntimeError::Unknown)??;
        let read = async {
            loop {
                // fill_buf/consume bounds allocation before parsing, even without a newline.
                loop {
                    let available = self
                        .stdout
                        .fill_buf()
                        .await
                        .map_err(|_| RuntimeError::Unknown)?;
                    if available.is_empty() {
                        return Err(RuntimeError::Unknown);
                    }
                    let end = available.iter().position(|b| *b == b'\n').map(|i| i + 1);
                    let n = end.unwrap_or(available.len());
                    if self
                        .pending_line
                        .len()
                        .checked_add(n)
                        .is_none_or(|len| len > max)
                    {
                        return Err(RuntimeError::Protocol);
                    }
                    self.pending_line.extend_from_slice(&available[..n]);
                    self.stdout.consume(n);
                    if end.is_some() {
                        break;
                    }
                }
                let message: Value = serde_json::from_slice(&self.pending_line)
                    .map_err(|_| RuntimeError::Protocol)?;
                self.pending_line.clear();
                if message.get("id").and_then(Value::as_u64) == Some(id)
                    && message.get("method").is_none()
                {
                    if message.get("error").is_some() {
                        return Err(RuntimeError::Unknown);
                    }
                    return message.get("result").cloned().ok_or(RuntimeError::Protocol);
                }
                if message.get("id").is_some() && message.get("method").is_some() {
                    // 没有审批/PEP 生产事实就不答同意；不把 native 请求正文送入 history。
                    self.send(&json!({"id":message["id"],"error":{"code":-32000,"message":"PLATFORM_ADMISSION_REQUIRED"}})).await?;
                    return Err(RuntimeError::AdmissionRequired);
                }
                // notifications 可含模型正文/usage：不记日志，不当 durable usage 权威。
            }
        };
        tokio::time::timeout(timeout, read)
            .await
            .map_err(|_| RuntimeError::Unknown)?
    }
}
