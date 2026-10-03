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

type ProcessSlot = Arc<Mutex<Option<Process>>>;

pub(crate) struct Supervisor {
    binary: PathBuf,
    root: PathBuf,
    timeout: Duration,
    max_message_bytes: usize,
    // The map lock only locates installation-local slots; no RPC/DB wait holds it.
    processes: Mutex<HashMap<Uuid, ProcessSlot>>,
}

struct Process {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    // 同一 Core 进程的 mutex 与跨 Core 的原生 advisory lock 都必须成立。
    ownership: Arc<Mutex<PoolConnection<Postgres>>>,
    // Local fail-closed fence while recovery persists UNKNOWN without the slot lock.
    // Kept in the slot even if the recovery future is cancelled; the next scan retries.
    retiring: bool,
    generation: i64,
    config_hash: String,
    model: String,
    gateway_base_url: String,
    instructions: String,
    credential_digest: [u8; 32],
    home: PathBuf,
    next_id: u64,
    pending_line: Vec<u8>,
    // 仅保留活动 turn 的 native 时间/引用，不保留通知正文或 durable usage。
    native_activity: HashMap<Uuid, NativeActivity>,
}

struct NativeActivity {
    turn_id: Uuid,
    emitted_at_ms: i64,
}

fn hosted_search_disabled(config: &Value) -> bool {
    config.get("web_search").and_then(Value::as_str) == Some("disabled")
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
            "AGENT_RUNTIME_PROFILES_FILE",
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
        // 目录也是同一运行投递的一部分；部分或畸形投递在启动时拒绝，
        // 不等到发布才发现缺文件，不把可读文件或进程存在当 profile ACTIVE。
        value(4)?;
        crate::agent_version::runtime_profile_directory().map_err(|_| RuntimeError::Unavailable)?;
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
        let slot = self
            .processes
            .lock()
            .await
            .entry(projection.installation_id)
            .or_insert_with(|| Arc::new(Mutex::new(None)))
            .clone();
        let mut slot = slot.lock().await;
        if let Some(process) = slot.as_mut() {
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
        // 固定 Codex 的 custom provider 也默认启用 hosted web search/cached；
        // 该路径不经 MCP/ExtMcp，不能成为 ToolBinding/Admission 的替代入口。
        let config = format!("model = {}\nmodel_provider = \"platform_gateway\"\napproval_policy = \"on-request\"\napprovals_reviewer = \"user\"\nweb_search = \"disabled\"\nsqlite_home = {}\ndeveloper_instructions = {}\n[skills.bundled]\nenabled = false\n[features]\nmemories = false\nshell_tool = false\ntool_call_mcp_elicitation = true\n[model_providers.platform_gateway]\nname = \"Platform AgentGateway\"\nbase_url = {}\nwire_api = \"responses\"\nenv_key = \"KAILO_CODEX_MODEL_TOKEN\"\n", quoted(&projection.model)?, quoted(&home.to_string_lossy())?, quoted(&projection.instructions)?, quoted(&projection.gateway_base_url)?);
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
            ownership: Arc::new(Mutex::new(ownership)),
            retiring: false,
            generation: projection.generation,
            config_hash: projection.config_hash.clone(),
            model: projection.model.clone(),
            gateway_base_url: projection.gateway_base_url.clone(),
            instructions: projection.instructions.clone(),
            credential_digest: Sha256::digest(model_token.as_bytes()).into(),
            home,
            next_id: 0,
            pending_line: Vec::new(),
            native_activity: HashMap::new(),
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
            || !hosted_search_disabled(config)
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
        *slot = Some(process);
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
        let mut slot = process.lock().await;
        let process = slot.as_mut().ok_or(RuntimeError::Unavailable)?;
        process
            .check(projection.generation, &projection.config_hash)
            .await?;
        let response = process
            .rpc(method, params, self.timeout, self.max_message_bytes)
            .await?;
        if matches!(method, "thread/start" | "thread/resume") {
            check_thread_projection(&response, &process.model, &process.home)?;
        }
        Ok(response)
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

    /// SS-COD-TRACE/APP：唯一已准入 Invocation 发派，Core context 仅在本次 RPC 内。
    /// 先提交不可重放 trace 意图，再持生命周期 fence/fresh 授权至原生 RPC 返回。
    pub(crate) async fn start_turn(
        &self,
        state: &crate::service_api::ServiceState,
        projection: &RuntimeRef,
        invocation: Uuid,
        thread: &str,
        source_context: (&str, Option<&str>),
    ) -> Result<String, RuntimeError> {
        let (input, core_memory) = source_context;
        if Uuid::parse_str(thread).is_err() || input.is_empty() {
            return Err(RuntimeError::Protocol);
        }
        let trace = crate::gateway_usage::prepare_turn(
            &state.pool,
            &state.openmeter,
            projection,
            invocation,
            thread,
        )
        .await
        .map_err(|_| RuntimeError::Unavailable)?;
        let mut guard = crate::gateway_usage::dispatch_guard(
            &state.pool,
            &state.openmeter,
            projection,
            invocation,
            thread,
        )
        .await
        .map_err(|_| RuntimeError::Unknown)?;
        crate::automation::fresh_invocation(state, &mut guard, invocation)
            .await
            .map_err(|_| RuntimeError::AdmissionRequired)?;
        let template = crate::automation::turn_template(&state.pool, invocation)
            .await
            .map_err(|_| RuntimeError::AdmissionRequired)?;
        // Session birth 已按 AE→Tenant→Session→Process 持锁；dispatch 必须先取得
        // 同一 lifecycle fence 再等 Process，不能持 Process 反向等待 Tenant。
        // 此后失败也保留已提交的 trace 意图，只能 UNKNOWN/观察，不能重发。
        let process = self
            .processes
            .lock()
            .await
            .get(&projection.installation_id)
            .cloned()
            .ok_or(RuntimeError::Unavailable)?;
        let mut slot = process.lock().await;
        let process = slot.as_mut().ok_or(RuntimeError::Unavailable)?;
        process
            .check(projection.generation, &projection.config_hash)
            .await?;
        // turn/start 对活跃 turn 可能变成 steer。历史首页不能证明实时空闲；
        // 原生 metadata status=idle 才允许另一 Invocation，未知/未加载均拒绝。
        let current = process
            .rpc(
                "thread/read",
                json!({"threadId":thread,"includeTurns":false}),
                self.timeout,
                self.max_message_bytes,
            )
            .await?;
        if current.pointer("/thread/id").and_then(Value::as_str) != Some(thread)
            || current
                .pointer("/thread/status/type")
                .and_then(Value::as_str)
                != Some("idle")
        {
            return Err(RuntimeError::Unknown);
        }
        // Process 等待和 native idle-read 可以跨过 Grant/Lease 期限。重用已持有
        // Invocation/lifecycle 锁的同一 guard fresh 授权；模型 CHECK 后最后以
        // clock_timestamp 核同一冻结事实，不开第二事务或借事务 now 放行。
        crate::automation::fresh_invocation(state, &mut guard, invocation)
            .await
            .map_err(|_| RuntimeError::AdmissionRequired)?;
        crate::gateway_usage::recheck_dispatch(
            &mut guard,
            &state.openmeter,
            projection,
            invocation,
            thread,
        )
        .await
        .map_err(|_| RuntimeError::Unknown)?;
        let context = core_memory.map(
            |profile| json!({"platform.agent-memory.core":{"value":profile,"kind":"untrusted"}}),
        );
        let result=process.rpc_traced("turn/start",json!({"threadId":thread,
            "clientUserMessageId":invocation.to_string(),"input":[{"type":"text","text":template,"textElements":[]},
                {"type":"text","text":input,"textElements":[]}],
            "additionalContext":context}),Some(&trace),self.timeout,self.max_message_bytes).await;
        // 事务只提供 fence；无论 RPC 结果如何，先前已提交的 trace/native 意图都保留。
        guard.commit().await.map_err(|_| RuntimeError::Unknown)?;
        let response = result?;
        let turn = response.get("turn").ok_or(RuntimeError::Protocol)?;
        let id = turn
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
            .ok_or(RuntimeError::Protocol)?;
        if !matches!(
            turn.get("status").and_then(Value::as_str),
            Some("inProgress" | "completed" | "failed" | "interrupted")
        ) {
            return Err(RuntimeError::Protocol);
        }
        Ok(id.to_owned())
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

    /// 只读已经由 stdio RPC reader 消费的同一活动 turn 元事实。缺通知/恢复
    /// 不返回本机时钟；本方法不发 RPC，也不创建另一套运行体登记。
    pub(crate) async fn last_activity_at(
        &self,
        projection: &RuntimeRef,
        thread_id: &str,
        turn_id: &str,
    ) -> Result<Option<i64>, RuntimeError> {
        let thread = Uuid::parse_str(thread_id).map_err(|_| RuntimeError::Protocol)?;
        let turn = Uuid::parse_str(turn_id).map_err(|_| RuntimeError::Protocol)?;
        let process = self
            .processes
            .lock()
            .await
            .get(&projection.installation_id)
            .cloned()
            .ok_or(RuntimeError::Unavailable)?;
        let mut slot = process.lock().await;
        let process = slot.as_mut().ok_or(RuntimeError::Unavailable)?;
        process
            .check(projection.generation, &projection.config_hash)
            .await?;
        Ok(process
            .native_activity
            .get(&thread)
            .filter(|activity| activity.turn_id == turn)
            .map(|activity| activity.emitted_at_ms))
    }

    pub(crate) async fn stop(&self, installation: Uuid) -> Result<(), RuntimeError> {
        let slot = self.processes.lock().await.get(&installation).cloned();
        if let Some(slot) = slot {
            let mut slot = slot.lock().await;
            if let Some(process) = slot.as_mut() {
                // Recovery still owns the original UNKNOWN write; stop cannot let a
                // same-generation replacement overtake that write or delete its state.
                if process.retiring {
                    return Err(RuntimeError::Unknown);
                }
                terminate(&mut process.child, self.timeout).await?;
            }
            // 只有 wait 已确认退出才释放跨 Core ownership；结果不明保留原引用。
            *slot = None;
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
        let processes: Vec<_> = self
            .processes
            .lock()
            .await
            .iter()
            .map(|(installation, process)| (*installation, Arc::clone(process)))
            .collect();
        let mut healthy = Vec::new();
        for (installation, slot) in processes {
            let mut locked = slot.lock().await;
            let Some(process) = locked.as_mut() else {
                continue;
            };
            let live = matches!(process.child.try_wait(), Ok(None));
            let fenced = if live && !process.retiring {
                let generation = process.generation;
                let hash = process.config_hash.clone();
                sqlx::query_scalar::<_, bool>("select exists(select 1 from catalog.agent_installation i
                    join catalog.agent_runtime_projection p on p.installation_resource_id=i.resource_id
                      and p.generation=i.active_projection_generation
                    where i.resource_id=$1 and i.state='ACTIVE' and p.state='ACTIVE'
                      and p.generation=$2 and p.config_hash=$3)")
                    .bind(installation).bind(generation).bind(hash)
                    .fetch_one(&mut **process.ownership.lock().await).await.unwrap_or(false)
            } else {
                false
            };
            if live && fenced {
                healthy.push(installation);
            } else {
                let generation = process.generation;
                process.retiring = true;
                let ownership = Arc::clone(&process.ownership);
                // Dispatch/birth hold Invocation rows before waiting for this slot.
                // Mark it unavailable first, then release it before any row-lock wait.
                // Reuse the original advisory owner: no pool acquisition and no newer
                // native process can start while this UNKNOWN update is outstanding.
                drop(locked);
                let _ = self
                    .stop_observed(installation, &slot, generation, ownership)
                    .await;
            }
        }
        healthy
    }

    // Both crash reconciliation and shutdown act only on the Process actually
    // fenced in this slot, never a remembered installation key or another owner.
    async fn stop_observed(
        &self,
        installation: Uuid,
        slot: &ProcessSlot,
        generation: i64,
        ownership: Arc<Mutex<PoolConnection<Postgres>>>,
    ) -> Result<(), RuntimeError> {
        let identity = Arc::downgrade(&ownership);
        let recorded = sqlx::query(
            "update catalog.agent_invocation set status='UNKNOWN',updated_at=now()
                    where installation_resource_id=$1 and projection_generation=$2
                      and status in ('DISPATCHING','RUNNING')",
        )
        .bind(installation)
        .bind(generation)
        .execute(&mut **ownership.lock().await)
        .await
        .is_ok();
        if !recorded {
            // A lost ownership connection must not permanently pin a dead
            // process. Existing DISPATCHING/RUNNING refs still enter only
            // resume/history in AgentTask::advance, never a second start.
            tracing::warn!(%installation, generation,
                        "Runtime UNKNOWN observation write unavailable; preserving native references");
        }
        drop(ownership);
        let mut locked = slot.lock().await;
        if let Some(process) = locked.as_mut() {
            if !std::sync::Weak::ptr_eq(&identity, &Arc::downgrade(&process.ownership)) {
                return Err(RuntimeError::Unknown);
            }
            let stopped = terminate(&mut process.child, self.timeout).await.is_ok();
            // A cancelled scan or uncertain exit keeps the fenced original
            // Process for retry. Confirmed exit follows the existing recovery
            // path even if DB was lost: no status/ID is fabricated or replayed.
            if stopped {
                *locked = None;
            } else {
                return Err(RuntimeError::Unknown);
            }
        }
        if recorded {
            Ok(())
        } else {
            Err(RuntimeError::Unknown)
        }
    }

    pub(crate) async fn stop_all(&self) -> Result<(), RuntimeError> {
        let processes: Vec<_> = self
            .processes
            .lock()
            .await
            .iter()
            .map(|(installation, slot)| (*installation, Arc::clone(slot)))
            .collect();
        let mut failed = false;
        for (installation, slot) in processes {
            let mut locked = slot.lock().await;
            let Some(process) = locked.as_mut() else {
                continue;
            };
            let generation = process.generation;
            process.retiring = true;
            let ownership = Arc::clone(&process.ownership);
            drop(locked);
            // Core 进程退出不证明 native terminal。先保留 UNKNOWN 原引用，再停
            // 子进程；不释放 Capacity、不发第二次 turn，也不清 durable thread。
            if self
                .stop_observed(installation, &slot, generation, ownership)
                .await
                .is_err()
            {
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

fn check_thread_projection(response: &Value, model: &str, home: &Path) -> Result<(), RuntimeError> {
    isolated_thread_id(response)?;
    if response.get("model").and_then(Value::as_str) != Some(model)
        || response.get("cwd").and_then(Value::as_str) != home.to_str()
        || response.get("approvalPolicy").and_then(Value::as_str) != Some("on-request")
        || response.get("approvalsReviewer").and_then(Value::as_str) != Some("user")
    {
        return Err(RuntimeError::Protocol);
    }
    Ok(())
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
        if self.retiring || self.generation != generation || self.config_hash != config_hash {
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
            .execute(&mut **self.ownership.lock().await)
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
        self.rpc_traced(method, params, None, timeout, max).await
    }

    async fn rpc_traced(
        &mut self,
        method: &str,
        params: Value,
        traceparent: Option<&str>,
        timeout: Duration,
        max: usize,
    ) -> Result<Value, RuntimeError> {
        self.next_id = self.next_id.checked_add(1).ok_or(RuntimeError::Protocol)?;
        let id = self.next_id;
        let mut request = json!({"id":id,"method":method,"params":params});
        if let Some(trace) = traceparent {
            request["trace"] = json!({"traceparent":trace});
        }
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
                // 不复制正文。活动只取原生 envelope 的时间与 thread/turn 引用；
                // usage/account/RPC response 不重置 idle timer、不当 durable usage。
                record_native_activity(
                    &mut self.native_activity,
                    &message,
                    chrono::Utc::now().timestamp_millis(),
                )?;
            }
        };
        tokio::time::timeout(timeout, read)
            .await
            .map_err(|_| RuntimeError::Unknown)?
    }
}

/// Fixed Codex 7498521d288b9b3b96ffba4eedf089d8d6e06a84:
/// common.rs::ServerNotificationEnvelope → timestamped_server_notification →
/// app-server-transport::transport::stdio 的原生序列化，emittedAtMs 未被剥离。
fn record_native_activity(
    activities: &mut HashMap<Uuid, NativeActivity>,
    message: &Value,
    now_ms: i64,
) -> Result<(), RuntimeError> {
    let Some(method) = message.get("method").and_then(Value::as_str) else {
        return Ok(());
    };
    if method == "thread/closed" {
        let thread = message
            .pointer("/params/threadId")
            .and_then(Value::as_str)
            .and_then(|id| Uuid::parse_str(id).ok())
            .ok_or(RuntimeError::Protocol)?;
        activities.remove(&thread);
        return Ok(());
    }
    let boundary = matches!(method, "turn/started" | "turn/completed");
    if !boundary
        && !matches!(
            method,
            "turn/diff/updated"
                | "turn/plan/updated"
                | "item/started"
                | "item/completed"
                | "item/agentMessage/delta"
                | "item/plan/delta"
                | "item/reasoning/summaryTextDelta"
                | "item/reasoning/summaryPartAdded"
                | "item/reasoning/textDelta"
                | "item/commandExecution/outputDelta"
                | "item/commandExecution/terminalInteraction"
                | "item/fileChange/outputDelta"
                | "item/fileChange/patchUpdated"
                | "item/mcpToolCall/progress"
        )
    {
        // 不把 bookkeeping、未知 method 或 unrelated thread 通知当运行进展。
        return Ok(());
    }
    let thread = message
        .pointer("/params/threadId")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
        .ok_or(RuntimeError::Protocol)?;
    let turn = message
        .pointer(if boundary {
            "/params/turn/id"
        } else {
            "/params/turnId"
        })
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
        .ok_or(RuntimeError::Protocol)?;
    if boundary {
        let status = message
            .pointer("/params/turn/status")
            .and_then(Value::as_str);
        if (method == "turn/started" && status != Some("inProgress"))
            || (method == "turn/completed"
                && !matches!(status, Some("completed" | "failed" | "interrupted")))
        {
            activities.remove(&thread);
            return Err(RuntimeError::Protocol);
        }
    }
    if method == "turn/completed" {
        if activities
            .get(&thread)
            .is_some_and(|activity| activity.turn_id == turn)
        {
            activities.remove(&thread);
        }
        return Ok(());
    }
    let Some(emitted_at_ms) = message
        .get("emittedAtMs")
        .and_then(Value::as_i64)
        .filter(|time| *time > 0 && *time <= now_ms)
    else {
        // 失去时间事实后不能继续沿用旧缓存推断 idle，直到新的真实 turn start。
        activities.remove(&thread);
        return Err(RuntimeError::Protocol);
    };
    if method == "turn/started" {
        if activities
            .get(&thread)
            .is_none_or(|activity| activity.turn_id != turn)
        {
            activities.insert(
                thread,
                NativeActivity {
                    turn_id: turn,
                    emitted_at_ms,
                },
            );
        }
        // 同 turn 的重发 start 不延长 idle，不能让恢复/重发伪造新活动。
    } else if let Some(activity) = activities.get_mut(&thread) {
        if activity.turn_id == turn {
            activity.emitted_at_ms = activity.emitted_at_ms.max(emitted_at_ms);
        }
    }
    Ok(())
}

#[cfg(test)]
mod activity_tests {
    // Post-implementation regression: real PostgreSQL row/advisory locks plus
    // controlled stdio children; no model, production database or installation.
    #[tokio::test]
    #[ignore = "requires an explicitly isolated runtime_recovery_verify_* database"]
    async fn recovery_releases_slot_before_row_wait_and_resume_checks_loaded_projection() {
        use sqlx::postgres::PgPoolOptions;
        let url = std::env::var("RUNTIME_RECOVERY_TEST_DATABASE_URL").unwrap();
        let pool = PgPoolOptions::new()
            .max_connections(2)
            .connect(&url)
            .await
            .unwrap();
        let database: String = sqlx::query_scalar("select current_database()")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(database.starts_with("runtime_recovery_verify_"));
        sqlx::raw_sql(
            "create schema if not exists catalog;
            create table if not exists catalog.agent_installation
              (resource_id uuid primary key, active_projection_generation bigint, state text);
            create table if not exists catalog.agent_runtime_projection
              (installation_resource_id uuid, generation bigint, config_hash text, state text);
            create table if not exists catalog.agent_invocation
              (id uuid primary key, installation_resource_id uuid, projection_generation bigint,
               status text, updated_at timestamptz, runtime_thread_id text, runtime_turn_id text)",
        )
        .execute(&pool)
        .await
        .unwrap();
        let installation = Uuid::new_v4();
        let invocation = Uuid::new_v4();
        let thread = Uuid::new_v4().to_string();
        let turn = Uuid::new_v4().to_string();
        let hash = "a".repeat(64);
        let projection = RuntimeRef {
            installation_id: installation,
            generation: 1,
            config_hash: hash.clone(),
        };
        sqlx::query("insert into catalog.agent_installation values($1,1,'ACTIVE')")
            .bind(installation)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("insert into catalog.agent_runtime_projection values($1,1,$2,'ACTIVE')")
            .bind(installation)
            .bind(&hash)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("insert into catalog.agent_invocation values($1,$2,1,'RUNNING',now(),$3,$4)")
            .bind(invocation)
            .bind(installation)
            .bind(&thread)
            .bind(&turn)
            .execute(&pool)
            .await
            .unwrap();

        let mut process = recovery_process(&pool, installation, &hash, "exec sleep 300").await;
        process.child.kill().await.unwrap();
        let slot = Arc::new(Mutex::new(Some(process)));
        let supervisor = Arc::new(Supervisor {
            binary: PathBuf::from("/unused"),
            root: PathBuf::from("/unused"),
            timeout: Duration::from_secs(2),
            max_message_bytes: 4096,
            processes: Mutex::new(HashMap::from([(installation, Arc::clone(&slot))])),
        });
        // Consume the only non-ownership connection and hold the dispatch row.
        // Recovery must reuse ownership and let a row-owning caller enter the slot.
        let mut dispatch = pool.begin().await.unwrap();
        sqlx::query("select id from catalog.agent_invocation where id=$1 for update")
            .bind(invocation)
            .execute(&mut *dispatch)
            .await
            .unwrap();
        let scanning = Arc::clone(&supervisor);
        let scan = tokio::spawn(async move { scanning.healthy_installations().await });
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let waiting: bool = sqlx::query_scalar(
                    "select exists(select 1 from pg_stat_activity
                    where datname=current_database() and wait_event_type='Lock'
                    and query like 'update catalog.agent_invocation set status=%')",
                )
                .fetch_one(&mut *dispatch)
                .await
                .unwrap();
                if waiting {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("recovery must reach the original row lock using its ownership connection");
        let locked = tokio::time::timeout(Duration::from_secs(2), slot.lock())
            .await
            .expect("row-owning dispatch must not wait behind recovery holding the Process lock");
        assert!(locked.as_ref().unwrap().retiring);
        drop(locked);
        assert!(matches!(
            supervisor.call(&projection, "thread/read", json!({})).await,
            Err(RuntimeError::Unavailable)
        ));
        let candidate = Projection {
            installation_id: installation,
            generation: 1,
            config_hash: hash.clone(),
            model: "model".into(),
            gateway_base_url: "http://gateway.invalid/v1".into(),
            instructions: "fixed".into(),
        };
        assert!(matches!(
            tokio::time::timeout(
                Duration::from_secs(2),
                supervisor.ensure(&pool, &candidate, "test-token-not-a-credential")
            )
            .await
            .unwrap(),
            Err(RuntimeError::Unavailable)
        ));
        assert!(matches!(
            supervisor.stop(installation).await,
            Err(RuntimeError::Unknown)
        ));
        let another_owner: bool =
            sqlx::query_scalar("select pg_try_advisory_lock(hashtextextended($1,0))")
                .bind(format!("platform.agent-runtime:{installation}"))
                .fetch_one(&mut *dispatch)
                .await
                .unwrap();
        assert!(
            !another_owner,
            "same-generation replacement must not overtake UNKNOWN persistence"
        );
        scan.abort();
        assert!(scan.await.unwrap_err().is_cancelled());
        assert!(
            slot.lock().await.as_ref().unwrap().retiring,
            "cancelled recovery keeps the original Process available for reconciliation"
        );
        dispatch.commit().await.unwrap();
        assert!(
            tokio::time::timeout(Duration::from_secs(2), supervisor.healthy_installations())
                .await
                .unwrap()
                .is_empty()
        );
        assert!(slot.lock().await.is_none());
        let preserved: (String, String, String) = sqlx::query_as(
            "select status,runtime_thread_id,runtime_turn_id from catalog.agent_invocation where id=$1")
            .bind(invocation).fetch_one(&pool).await.unwrap();
        assert_eq!(preserved, ("UNKNOWN".into(), thread.clone(), turn));

        // A same-generation replacement becomes possible only after old ownership
        // is released. Its running invocation cannot be marked by the old scan.
        let newer = Uuid::new_v4();
        sqlx::query("insert into catalog.agent_invocation values($1,$2,1,'RUNNING',now(),$3,null)")
            .bind(newer)
            .bind(installation)
            .bind(&thread)
            .execute(&pool)
            .await
            .unwrap();
        *slot.lock().await =
            Some(recovery_process(&pool, installation, &hash, "exec sleep 300").await);
        assert_eq!(supervisor.healthy_installations().await, vec![installation]);
        let status: String =
            sqlx::query_scalar("select status from catalog.agent_invocation where id=$1")
                .bind(newer)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(status, "RUNNING");
        supervisor.stop(installation).await.unwrap();

        // The old connection itself can be permanently dead. Confirmed child exit
        // must release the slot; unchanged RUNNING refs remain native observation,
        // not permission to resend (AgentTask::advance's existing branch).
        let process = recovery_process(&pool, installation, &hash, "exec sleep 300").await;
        let child_pid = process.child.id().unwrap();
        let backend: i32 = sqlx::query_scalar("select pg_backend_pid()")
            .fetch_one(&mut **process.ownership.lock().await)
            .await
            .unwrap();
        *slot.lock().await = Some(process);
        let killed: bool = sqlx::query_scalar("select pg_terminate_backend($1)")
            .bind(backend)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(killed);
        assert!(
            tokio::time::timeout(Duration::from_secs(2), supervisor.healthy_installations())
                .await
                .unwrap()
                .is_empty()
        );
        assert!(
            slot.lock().await.is_none(),
            "dead ownership must not permanently pin a stopped process"
        );
        #[cfg(target_os = "linux")]
        assert!(
            !Path::new(&format!("/proc/{child_pid}")).exists(),
            "old child must have exited"
        );
        let status: String =
            sqlx::query_scalar("select status from catalog.agent_invocation where id=$1")
                .bind(newer)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            status, "RUNNING",
            "failed UNKNOWN write must not be reported as persisted"
        );
        let refs: (String, Option<String>) = sqlx::query_as(
            "select runtime_thread_id,runtime_turn_id from catalog.agent_invocation where id=$1",
        )
        .bind(newer)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(refs, (thread.clone(), None));

        let valid = json!({"thread":{"id":thread,"ephemeral":false,"parentThreadId":null,
            "forkedFromId":null,"environments":[],"modelProvider":"platform_gateway"},
            "modelProvider":"platform_gateway","model":"model","cwd":"/runtime-test",
            "approvalPolicy":"on-request","approvalsReviewer":"user"});
        for (field, wrong) in [
            ("model", json!("other")),
            ("cwd", json!("/other")),
            ("approvalPolicy", json!("never")),
            ("approvalsReviewer", json!("auto")),
        ] {
            for value in [Some(wrong), None] {
                let mut response = valid.clone();
                match value {
                    Some(value) => {
                        response[field] = value;
                    }
                    None => {
                        response.as_object_mut().unwrap().remove(field);
                    }
                }
                let wire = json!({"id":1,"result":response});
                let script = format!(
                    "IFS= read -r request; printf '%s\\n' '{}' ; exec sleep 300",
                    wire
                );
                *slot.lock().await =
                    Some(recovery_process(&pool, installation, &hash, &script).await);
                assert!(
                    matches!(
                        supervisor.resume_thread(&projection, &thread).await,
                        Err(RuntimeError::Protocol)
                    ),
                    "resume accepted absent/drifted {field}"
                );
                supervisor.stop(installation).await.unwrap();
            }
        }
        let wire = json!({"id":1,"result":valid});
        let script = format!(
            "IFS= read -r request; printf '%s\\n' '{}' ; exec sleep 300",
            wire
        );
        *slot.lock().await = Some(recovery_process(&pool, installation, &hash, &script).await);
        supervisor
            .resume_thread(&projection, &thread)
            .await
            .unwrap();
        supervisor.stop(installation).await.unwrap();

        // A remembered empty slot owns nothing. Shutdown must not touch another
        // Core's invocation, nor a different generation of the same installation.
        supervisor.stop_all().await.unwrap();
        let status: String =
            sqlx::query_scalar("select status from catalog.agent_invocation where id=$1")
                .bind(newer)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            status, "RUNNING",
            "empty slot must not claim another owner at shutdown"
        );
        let next_generation = Uuid::new_v4();
        sqlx::query("insert into catalog.agent_invocation values($1,$2,2,'RUNNING',now(),$3,null)")
            .bind(next_generation)
            .bind(installation)
            .bind(&thread)
            .execute(&pool)
            .await
            .unwrap();
        *slot.lock().await =
            Some(recovery_process(&pool, installation, &hash, "exec sleep 300").await);
        supervisor.stop_all().await.unwrap();
        assert!(slot.lock().await.is_none());
        let status: String =
            sqlx::query_scalar("select status from catalog.agent_invocation where id=$1")
                .bind(newer)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(status, "UNKNOWN");
        let status: String =
            sqlx::query_scalar("select status from catalog.agent_invocation where id=$1")
                .bind(next_generation)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            status, "RUNNING",
            "shutdown may only mark its owned generation"
        );
        pool.close().await;
    }

    async fn recovery_process(
        pool: &PgPool,
        installation: Uuid,
        hash: &str,
        script: &str,
    ) -> Process {
        let mut ownership = pool.acquire().await.unwrap();
        let locked: bool =
            sqlx::query_scalar("select pg_try_advisory_lock(hashtextextended($1,0))")
                .bind(format!("platform.agent-runtime:{installation}"))
                .fetch_one(&mut *ownership)
                .await
                .unwrap();
        assert!(locked);
        ownership.close_on_drop();
        let mut child = Command::new("sh")
            .args(["-c", script])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        Process {
            stdin: child.stdin.take().unwrap(),
            stdout: BufReader::new(child.stdout.take().unwrap()),
            child,
            ownership: Arc::new(Mutex::new(ownership)),
            retiring: false,
            generation: 1,
            config_hash: hash.into(),
            model: "model".into(),
            gateway_base_url: "http://gateway.invalid/v1".into(),
            instructions: "fixed".into(),
            credential_digest: Sha256::digest(b"test-token-not-a-credential").into(),
            home: PathBuf::from("/runtime-test"),
            next_id: 0,
            pending_line: Vec::new(),
            native_activity: HashMap::new(),
        }
    }

    #[test]
    fn effective_web_search_requires_explicit_disabled() {
        for config in [
            serde_json::json!({}),
            serde_json::json!({"web_search": null}),
            serde_json::json!({"web_search": "futureMode"}),
            serde_json::json!({"web_search": "cached"}),
            serde_json::json!({"web_search": "live"}),
            serde_json::json!({"web_search": "indexed"}),
            serde_json::json!({"web_search": false}),
        ] {
            assert!(!super::hosted_search_disabled(&config));
        }
        assert!(super::hosted_search_disabled(
            &serde_json::json!({"web_search": "disabled"})
        ));
    }

    use super::*;

    // 每个 env case 调用同一 from_env，在独立测试进程中运行，避免改变并行检查的环境。
    #[test]
    fn runtime_delivery_probe() {
        let Ok(expected) = std::env::var("KAILO_RUNTIME_DELIVERY_EXPECTED") else {
            return;
        };
        let result = Supervisor::from_env();
        assert!(
            match expected.as_str() {
                "OFF" => matches!(result, Ok(None)),
                "REJECT" => result.is_err(),
                "CONFIGURED" => matches!(result, Ok(Some(_))),
                _ => false,
            },
            "from_env 未保持 {expected} 边界"
        );
    }

    #[test]
    fn runtime_delivery_from_env_fail_closed() {
        let names = [
            "AGENT_RUNTIME_BINARY",
            "AGENT_RUNTIME_STATE_ROOT",
            "AGENT_RUNTIME_RPC_TIMEOUT_SECONDS",
            "AGENT_RUNTIME_MAX_MESSAGE_BYTES",
            "AGENT_RUNTIME_PROFILES_FILE",
        ];
        let binary = std::env::current_exe().unwrap();
        let root = std::env::temp_dir().join(format!("runtime-delivery-{}", Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let empty = root.join("empty.json");
        let malformed = root.join("malformed.json");
        let malformed_contract = root.join("malformed-contract.json");
        let extra_directory = root.join("extra-directory.json");
        let extra_profile = root.join("extra-profile.json");
        let extra_capability = root.join("extra-capability.json");
        std::fs::write(&empty, r#"{"profiles":[]}"#).unwrap();
        std::fs::write(&malformed, "{").unwrap();
        std::fs::write(&malformed_contract, r#"{"profiles":[{}]}"#).unwrap();
        // 只为非法键核证构造未启用的合同值，不提供任何 ACTIVE profile 或执行权限。
        let inactive = contracts::RuntimeProfileDirectory {
            profiles: vec![contracts::Profile {
                key: "negative-contract-only".into(),
                kind: contracts::RuntimeProfileKind::ServerCodex,
                status: "DRAFT".into(),
                web_availability: "DISABLED".into(),
                capability_contract: contracts::FluffyCapabilityContract {
                    capability_requirements: Vec::new(),
                    reply_policies: Vec::new(),
                    reply_policy_mappings: None,
                    max_parallelism: 0,
                    max_idle_timeout_seconds: 0,
                    max_turn_duration_seconds: 0,
                },
            }],
        };
        let mut extra = serde_json::to_value(&inactive).unwrap();
        extra["unrecognized"] = json!(true);
        std::fs::write(&extra_directory, serde_json::to_vec(&extra).unwrap()).unwrap();
        let mut extra = serde_json::to_value(&inactive).unwrap();
        extra["profiles"][0]["unrecognized"] = json!(true);
        std::fs::write(&extra_profile, serde_json::to_vec(&extra).unwrap()).unwrap();
        let mut extra = serde_json::to_value(&inactive).unwrap();
        extra["profiles"][0]["capabilityContract"]["unrecognized"] = json!(true);
        std::fs::write(&extra_capability, serde_json::to_vec(&extra).unwrap()).unwrap();
        let values = [
            binary.to_str().unwrap().to_owned(),
            root.to_str().unwrap().to_owned(),
            "1".to_owned(),
            "1".to_owned(),
            empty.to_str().unwrap().to_owned(),
        ];
        let check = |label: &str, expected: &str, env: &[Option<String>; 5]| {
            let mut child = std::process::Command::new(&binary);
            child
                .args([
                    "--exact",
                    "agent_runtime::activity_tests::runtime_delivery_probe",
                    "--nocapture",
                ])
                .env("KAILO_RUNTIME_DELIVERY_EXPECTED", expected);
            for (name, value) in names.iter().zip(env) {
                child.env_remove(name);
                if let Some(value) = value {
                    child.env(name, value);
                }
            }
            let output = child.output().unwrap();
            assert!(
                output.status.success(),
                "{label}: {}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            println!("from_env {label}: {expected}");
        };
        let absent = [None, None, None, None, None];
        check("all-absent", "OFF", &absent);
        let full = values.map(Some);
        check(
            "empty-directory-is-not-an-ACTIVE-profile",
            "CONFIGURED",
            &full,
        );
        for i in 0..names.len() {
            let mut partial = full.clone();
            partial[i] = None;
            check(names[i], "REJECT", &partial);
        }
        let mut profile_only = absent;
        profile_only[4] = full[4].clone();
        check("profile-only", "REJECT", &profile_only);
        for (label, index, value) in [
            ("empty-binary", 0, ""),
            ("relative-root", 1, "relative"),
            ("zero-timeout", 2, "0"),
            ("zero-message-limit", 3, "0"),
            ("empty-profile-path", 4, ""),
            ("relative-profile-path", 4, "relative.json"),
            ("profile-is-directory", 4, root.to_str().unwrap()),
            ("malformed-json", 4, malformed.to_str().unwrap()),
            (
                "malformed-contract",
                4,
                malformed_contract.to_str().unwrap(),
            ),
            (
                "extra-directory-field",
                4,
                extra_directory.to_str().unwrap(),
            ),
            ("extra-profile-field", 4, extra_profile.to_str().unwrap()),
            (
                "extra-capability-field",
                4,
                extra_capability.to_str().unwrap(),
            ),
        ] {
            let mut invalid = full.clone();
            invalid[index] = Some(value.to_owned());
            check(label, "REJECT", &invalid);
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn only_same_started_turn_progress_advances_native_clock() {
        let thread = Uuid::from_u128(1);
        let turn = Uuid::from_u128(2);
        let start = json!({"method":"turn/started","emittedAtMs":1000,
            "params":{"threadId":thread,"turn":{"id":turn,"status":"inProgress"}}});
        let delta = json!({"method":"item/agentMessage/delta","emittedAtMs":2000,
            "params":{"threadId":thread,"turnId":turn}});
        let mut activities = HashMap::new();
        record_native_activity(&mut activities, &delta, 3000).unwrap();
        assert!(activities.is_empty());
        record_native_activity(&mut activities, &start, 3000).unwrap();
        record_native_activity(&mut activities, &delta, 3000).unwrap();
        assert_eq!(activities[&thread].emitted_at_ms, 2000);
        for message in [
            json!({"method":"turn/started","emittedAtMs":2900,
                "params":{"threadId":thread,"turn":{"id":turn,"status":"inProgress"}}}),
            json!({"method":"item/agentMessage/delta","emittedAtMs":2900,
                "params":{"threadId":thread,"turnId":Uuid::from_u128(3)}}),
            json!({"method":"thread/tokenUsage/updated","emittedAtMs":2900,
                "params":{"threadId":thread,"turnId":turn}}),
            json!({"id":1,"result":{},"emittedAtMs":2900}),
        ] {
            record_native_activity(&mut activities, &message, 3000).unwrap();
            assert_eq!(activities[&thread].emitted_at_ms, 2000);
        }
    }

    #[test]
    fn missing_or_future_native_clock_loses_idle_evidence() {
        let thread = Uuid::from_u128(1);
        let turn = Uuid::from_u128(2);
        let start = json!({"method":"turn/started","emittedAtMs":1000,
            "params":{"threadId":thread,"turn":{"id":turn,"status":"inProgress"}}});
        let mut activities = HashMap::new();
        for stamp in [Value::Null, json!(3001)] {
            record_native_activity(&mut activities, &start, 3000).unwrap();
            let message = json!({"method":"item/agentMessage/delta","emittedAtMs":stamp,
                "params":{"threadId":thread,"turnId":turn}});
            assert!(record_native_activity(&mut activities, &message, 3000).is_err());
            assert!(activities.is_empty());
        }
    }

    #[test]
    fn native_terminal_removes_clock_and_unknown_boundary_is_rejected() {
        let thread = Uuid::from_u128(1);
        let turn = Uuid::from_u128(2);
        let start = json!({"method":"turn/started","emittedAtMs":1000,
            "params":{"threadId":thread,"turn":{"id":turn,"status":"inProgress"}}});
        let mut activities = HashMap::new();
        record_native_activity(&mut activities, &start, 3000).unwrap();
        let mut terminal = json!({"method":"turn/completed","emittedAtMs":2000,
            "params":{"threadId":thread,"turn":{"id":turn,"status":"completed"}}});
        record_native_activity(&mut activities, &terminal, 3000).unwrap();
        assert!(activities.is_empty());
        record_native_activity(&mut activities, &start, 3000).unwrap();
        terminal["params"]["turn"]["status"] = json!("futureStatus");
        assert!(record_native_activity(&mut activities, &terminal, 3000).is_err());
        assert!(activities.is_empty());
    }
}
