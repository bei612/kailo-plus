//! DD-15/26/47/65/71, SS-COD-APP: Core 内的原生 stdio Supervisor。
//! 只发送固定 thread/turn RPC；不继承 Core env，不提供 host 执行 RPC。

use std::{
    collections::{HashMap, HashSet},
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
    sync::{broadcast, Mutex},
};
use uuid::Uuid;

#[derive(Clone, Debug, thiserror::Error)]
pub(crate) enum RuntimeError {
    #[error("runtime 未投递或投影不成立")]
    Unavailable,
    #[error("runtime 原生结果不明；仅允许观察既有引用")]
    Unknown,
    #[error("runtime 回应不符合固定协议")]
    Protocol,
    #[error("runtime 请求需要独立治理准入")]
    AdmissionRequired,
    /// DD-123：派发前的 fresh CHECK 给出确定原因（QUOTA_EXHAUSTED 或
    /// DEPENDENCY_UNAVAILABLE）；不折叠为重新准入，原因码随 Invocation/AE 保留。
    #[error("runtime 回合被额度准入拒绝")]
    QuotaRefused(contracts::ReasonCode),
}

/// 只来自查证后的 RuntimeProjection；绝不从 prompt 接收 provider 或路径。
pub(crate) struct Projection {
    pub installation_id: Uuid,
    pub generation: i64,
    pub config_hash: String,
    pub model: String,
    pub gateway_base_url: String,
    pub instructions: String,
    /// DD-135(5)：generation 写入时固定的 Skill 根相对引用；不引 Skill 时为空。
    pub skill_root_ref: Option<String>,
    /// pinned Version 引用的 artifact（已按 digest 核对），保持版本中的顺序。
    pub skills: Vec<crate::skill_projection::SkillArtifact>,
}

/// Installation 专属 Skill 根的目录名；不用 Codex 自动扫描的 `$CODEX_HOME/skills`。
const SKILL_ROOT_DIR: &str = "kailo-skills";

/// 一个已物化并经 `skills/list` 核对的 Skill；`enabled` 是 Codex 本地启用投影的当前值。
#[derive(Clone, Debug, PartialEq, Eq)]
struct ProjectedSkill {
    asset_id: Uuid,
    name: String,
    digest: String,
    path: String,
    enabled: bool,
}

/// 观察/取消仅需要已有原生引用的 fence，不伪造空模型或 credential。
pub(crate) struct RuntimeRef {
    pub installation_id: Uuid,
    pub generation: i64,
    pub config_hash: String,
}

type ProcessSlot = Arc<Mutex<Option<Process>>>;

/// DD-125(6)、SF-COD-17：既有读循环读到的原生 item/turn 通知，转给已准入的实时转写读者。
/// 只在内存中短暂停留，不写库、不进日志；读者落后即丢帧，由分页读取补齐。
#[derive(Clone, Debug)]
pub(crate) struct NativeNotice {
    pub installation: Uuid,
    pub method: &'static str,
    pub thread: String,
    pub turn: String,
    /// item 通知的原生 params；turn 通知只保留 `{"status"}`，不携带 turn 内的 item。
    pub params: Value,
    pub emitted_at_ms: Option<i64>,
}

/// 一个 Core 进程内实时通知的缓冲帧数；超出时落后的读者丢帧。
const NOTICE_BUFFER: usize = 256;
/// 一页转写的原生 item 上界：小页让回应留在已投递的 max_message_bytes 之内。
const TRANSCRIPT_PAGE_ITEMS: u32 = 25;
/// 查回合开始时刻时读取的最近 turn 数。
const TURN_LOOKUP_LIMIT: u32 = 5;
/// pump 只取已缓冲的行：每次读取的等待上界与单次最多处理的消息数。
const PUMP_READ_BOUND: Duration = Duration::from_millis(20);
const PUMP_MAX_MESSAGES: usize = 256;

// Correlation for an already sent native start, not another execution registry.
// Its enclosing Process fixes Installation/generation/hash. Only native IDs or
// an uncertain protocol result are retained; never request/response bodies.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub(crate) enum StartOwner {
    Session {
        tenant: Uuid,
        workspace: Uuid,
        root: String,
        version: Uuid,
    },
    Turn {
        invocation: Uuid,
        thread: String,
    },
}

struct StartReceipt {
    id: u64,
    outcome: Option<Result<String, RuntimeError>>,
}

pub(crate) struct Supervisor {
    binary: PathBuf,
    root: PathBuf,
    trace_endpoint: String,
    timeout: Duration,
    max_message_bytes: usize,
    // The map lock only locates installation-local slots; no RPC/DB wait holds it.
    processes: Mutex<HashMap<Uuid, ProcessSlot>>,
    notices: broadcast::Sender<NativeNotice>,
}

struct Process {
    installation_id: Uuid,
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
    // DD-135(5)(7)：本 generation 物化并核对的 Skill 及其当前启用投影。
    skills: Vec<ProjectedSkill>,
    home: PathBuf,
    next_id: u64,
    pending_line: Vec<u8>,
    start_receipts: HashMap<StartOwner, StartReceipt>,
    // 仅保留活动 turn 的 native 时间/引用，不保留通知正文或 durable usage。
    native_activity: HashMap<Uuid, NativeActivity>,
    // 最近一次请求的固定原生错误分类（只取精确匹配的封闭集合，不保留正文）。
    // 每次 RPC 开始时清空；只供同一持锁调用者读取本次请求的确定回答。
    last_native_error: Option<&'static str>,
    // DD-125(6)：实时转写的发送端；没有读者时不复制任何通知。
    tap: broadcast::Sender<NativeNotice>,
}

struct NativeActivity {
    turn_id: Uuid,
    emitted_at_ms: i64,
}

// Diagnostic metadata only, not native terminal evidence or a recovery authority.
// Never retain/log the native message, data, request parameters, or config.
struct RpcDiagnostic {
    installation: Uuid,
    generation: i64,
    request_id: u64,
    method: &'static str,
    thread: Option<Uuid>,
}

impl RpcDiagnostic {
    fn new(
        installation: Uuid,
        generation: i64,
        request_id: u64,
        method: &str,
        params: &Value,
    ) -> Self {
        let method = match method {
            "initialize" => "initialize",
            "config/read" => "config/read",
            "thread/start" => "thread/start",
            "thread/read" => "thread/read",
            "thread/resume" => "thread/resume",
            "thread/unsubscribe" => "thread/unsubscribe",
            "thread/loaded/list" => "thread/loaded/list",
            "thread/turns/list" => "thread/turns/list",
            "thread/items/list" => "thread/items/list",
            "turn/start" => "turn/start",
            "turn/interrupt" => "turn/interrupt",
            "skills/extraRoots/set" => "skills/extraRoots/set",
            "skills/list" => "skills/list",
            "skills/config/write" => "skills/config/write",
            _ => "UNRECOGNIZED_METHOD",
        };
        Self {
            installation,
            generation,
            request_id,
            method,
            thread: params
                .get("threadId")
                .and_then(Value::as_str)
                .and_then(|id| Uuid::parse_str(id).ok()),
        }
    }

    fn error_category(&self, error: &Value) -> (Option<i64>, &'static str) {
        let code = error.get("code").and_then(Value::as_i64);
        let message = error.get("message").and_then(Value::as_str);
        // Codex 7498521d288b9b3b96ffba4eedf089d8d6e06a84:
        // app-server/src/error_code.rs::{invalid_request,server_draining_error};
        // request_processors/thread_processor.rs::{thread_resume_inner,thread_store_resume_read_error}.
        // Exact request-bound matches only. Unknown text is never copied out.
        if code == Some(-32600) && self.method == "thread/resume" {
            if let Some(thread) = self.thread {
                if message == Some(format!("no rollout found for thread id {thread}").as_str()) {
                    return (code, "THREAD_NOT_FOUND");
                }
                if message == Some(format!("thread {thread} is closing; retry thread/resume after the thread is closed").as_str()) {
                    return (code, "THREAD_CLOSING");
                }
            }
        }
        if code == Some(-32600) && message == Some("Server is draining; retry after reconnecting") {
            return (code, "SERVER_DRAINING");
        }
        (
            code,
            match code {
                Some(-32600) => "INVALID_REQUEST",
                Some(-32601) => "METHOD_NOT_FOUND",
                Some(-32602) => "INVALID_PARAMS",
                Some(-32603) => "INTERNAL_ERROR",
                Some(-32001) => "OVERLOADED",
                Some(_) => "UNCLASSIFIED_NATIVE_ERROR",
                None => "INVALID_ERROR_ENVELOPE",
            },
        )
    }

    fn emit(&self, phase: &'static str, code: Option<i64>, category: &'static str) {
        tracing::warn!(
            installation_id = %self.installation,
            generation = self.generation,
            request_id = self.request_id,
            method = self.method,
            thread_id = ?self.thread,
            rpc_phase = phase,
            rpc_code = code,
            rpc_category = category,
            "native runtime RPC did not complete successfully"
        );
    }
}

fn hosted_search_disabled(config: &Value) -> bool {
    config.get("web_search").and_then(Value::as_str) == Some("disabled")
}

/// Seconds the fixed Codex app-server keeps an idle thread loaded after its
/// last subscriber leaves (`ConfigToml::thread_unload_delay_secs`, native
/// default 60). DD-105 refresh unsubscribes the idle thread and then requires
/// the native unload before a cold resume with the fresh Tool configuration;
/// with the native default every follow-up turn in an existing Session (thread
/// relay) waited at least 60 s, and a full minute more whenever the Activity
/// attempt boundary fell between that resume and turn/start. Core is the only
/// client and stays subscribed through every turn it starts or resumes, so a
/// short delay only shortens the unload Core itself requested.
const THREAD_UNLOAD_DELAY_SECS: u64 = 1;

fn native_trace_config(endpoint: &str) -> Result<String, RuntimeError> {
    let endpoint = reqwest::Url::parse(endpoint).map_err(|_| RuntimeError::Unavailable)?;
    if !matches!(endpoint.scheme(), "http" | "https")
        || endpoint.host_str().is_none()
        || !endpoint.username().is_empty()
        || endpoint.password().is_some()
        || endpoint.query().is_some()
        || endpoint.fragment().is_some()
    {
        return Err(RuntimeError::Unavailable);
    }
    let endpoint = format!("{}/v1/traces", endpoint.as_str().trim_end_matches('/'));
    // Fixed Codex installs its propagation layer only with a native trace exporter.
    // Reuse Core's existing OTLP HTTP receiver; never export prompts or native logs.
    Ok(format!(
        "\n[otel]\nexporter = \"none\"\nmetrics_exporter = \"none\"\nlog_user_prompt = false\ntrace_exporter = {{ otlp-http = {{ endpoint = {}, protocol = \"binary\" }} }}\n",
        serde_json::to_string(&endpoint).map_err(|_| RuntimeError::Protocol)?
    ))
}

fn native_trace_verified(config: &Value, endpoint: &str) -> bool {
    let Ok(endpoint) = reqwest::Url::parse(endpoint) else {
        return false;
    };
    let expected = format!("{}/v1/traces", endpoint.as_str().trim_end_matches('/'));
    config.pointer("/otel/exporter").and_then(Value::as_str) == Some("none")
        && config
            .pointer("/otel/metrics_exporter")
            .and_then(Value::as_str)
            == Some("none")
        && config
            .pointer("/otel/log_user_prompt")
            .and_then(Value::as_bool)
            == Some(false)
        && config
            .pointer("/otel/trace_exporter/otlp-http/endpoint")
            .and_then(Value::as_str)
            == Some(expected.as_str())
        && config
            .pointer("/otel/trace_exporter/otlp-http/protocol")
            .and_then(Value::as_str)
            == Some("binary")
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
        let trace_endpoint =
            std::env::var("OTEL_EXPORTER_OTLP_ENDPOINT").map_err(|_| RuntimeError::Unavailable)?;
        native_trace_config(&trace_endpoint)?;
        Ok(Some(Self {
            binary,
            root,
            trace_endpoint,
            timeout: Duration::from_secs(seconds),
            max_message_bytes,
            processes: Mutex::new(HashMap::new()),
            notices: broadcast::channel(NOTICE_BUFFER).0,
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
                || process.skills.len() != projection.skills.len()
                || process
                    .skills
                    .iter()
                    .zip(&projection.skills)
                    .any(|(loaded, wanted)| {
                        loaded.asset_id != wanted.asset_id || loaded.digest != wanted.digest
                    })
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
        // DD-135(5)：先移除旧 generation 的 Skill 根，再以 digest 核对后的 artifact 物化当前根。
        let (skill_root, mut skills) = materialize_skills(
            &home,
            projection.skill_root_ref.as_deref(),
            &projection.skills,
        )
        .await?;
        let quoted = |s: &str| serde_json::to_string(s).map_err(|_| RuntimeError::Protocol);
        // 原生 bundled skill 默认开启，必须明确关闭；不能把默认发现当成已治理的 SkillVersion。
        // DD-135(6)：模型没有文件读取与 shell，无法按技能目录自行打开 SKILL.md，因此关闭
        // 技能目录提示，由 Core 以 UserInput::Skill 显式选择（SF-COD-18）。
        // 固定 Codex 的 custom provider 也默认启用 hosted web search/cached；
        // 该路径不经 MCP/ExtMcp，不能成为 ToolBinding/Admission 的替代入口。
        let config = format!("model = {}\nmodel_provider = \"platform_gateway\"\napproval_policy = \"on-request\"\napprovals_reviewer = \"user\"\nweb_search = \"disabled\"\nsqlite_home = {}\ndeveloper_instructions = {}\nthread_unload_delay_secs = {}\n[skills]\ninclude_instructions = false\n[skills.bundled]\nenabled = false\n[features]\nmemories = false\nshell_tool = false\ntool_call_mcp_elicitation = true\nplugins = false\napps = false\n[model_providers.platform_gateway]\nname = \"Platform AgentGateway\"\nbase_url = {}\nwire_api = \"responses\"\nenv_key = \"KAILO_CODEX_MODEL_TOKEN\"\n", quoted(&projection.model)?, quoted(&home.to_string_lossy())?, quoted(&projection.instructions)?, THREAD_UNLOAD_DELAY_SECS, quoted(&projection.gateway_base_url)?);
        let config = config + &native_trace_config(&self.trace_endpoint)?;
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
            installation_id: projection.installation_id,
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
            skills: Vec::new(),
            home,
            next_id: 0,
            pending_line: Vec::new(),
            start_receipts: HashMap::new(),
            native_activity: HashMap::new(),
            last_native_error: None,
            tap: self.notices.clone(),
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
            || !native_trace_verified(config, &self.trace_endpoint)
            || config.get("developer_instructions").and_then(Value::as_str) != Some(projection.instructions.as_str())
            || config.get("thread_unload_delay_secs").and_then(Value::as_u64) != Some(THREAD_UNLOAD_DELAY_SECS)
            || config.pointer("/skills/bundled/enabled").and_then(Value::as_bool) != Some(false)
            || config.pointer("/skills/include_instructions").and_then(Value::as_bool) != Some(false)
            // 固定 ConfigToml 的 MCP 默认是空 map；显式未知形状或非空配置
            // 都不能借 initialize 成功变成已加载的有效 ToolBinding 交集。
            || config.get("mcp_servers").is_some_and(|servers| servers.as_object().is_none_or(|servers| !servers.is_empty()))
            || config.pointer("/features/memories").and_then(Value::as_bool) != Some(false)
            || config.pointer("/features/shell_tool").and_then(Value::as_bool) != Some(false)
            || config.pointer("/features/tool_call_mcp_elicitation").and_then(Value::as_bool) != Some(true)
            // 插件市场与 ChatGPT apps 会让 app-server 自行外连 chatgpt.com/GitHub 拉取
            // 插件与连接器，绕开 AgentGateway 的工具准入（.design/12 §1）。
            || config.pointer("/features/plugins").and_then(Value::as_bool) != Some(false)
            || config.pointer("/features/apps").and_then(Value::as_bool) != Some(false)
            || config.pointer("/model_providers/platform_gateway/base_url").and_then(Value::as_str) != Some(projection.gateway_base_url.as_str())
            || config.pointer("/model_providers/platform_gateway/wire_api").and_then(Value::as_str) != Some("responses")
            || config.pointer("/model_providers/platform_gateway/env_key").and_then(Value::as_str) != Some("KAILO_CODEX_MODEL_TOKEN")
        {
            return Err(RuntimeError::Protocol);
        }
        // DD-135(5)：extra roots 只在进程内存，每次 spawn 都重新登记，再以 forceReload 核对
        // 发现集合恰为被引集合；不引 Skill 时必须为空集合（没有未治理的 Skill 来源）。
        if let Some(root) = &skill_root {
            process
                .rpc(
                    "skills/extraRoots/set",
                    json!({"extraRoots":[root]}),
                    self.timeout,
                    self.max_message_bytes,
                )
                .await?;
        }
        let listed = process
            .rpc(
                "skills/list",
                json!({"cwds":[process.home], "forceReload": true}),
                self.timeout,
                self.max_message_bytes,
            )
            .await?;
        if !skills_listed(&listed, &process.home, &skills) {
            return Err(RuntimeError::Protocol);
        }
        process.skills = std::mem::take(&mut skills);
        *slot = Some(process);
        Ok(())
    }

    /// DD-135(7)：每次 `turn/start` 前按 fresh 判定的有效集合调整 Codex 本地启用投影，并以
    /// `skills/list` 核对；失效 Skill 不再注入、不能被 `$slug` 选中，其余能力照常。
    pub(crate) async fn reconcile_skills(
        &self,
        projection: &RuntimeRef,
        effective: &HashSet<Uuid>,
    ) -> Result<(), RuntimeError> {
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
        let changes: Vec<(usize, bool)> = process
            .skills
            .iter()
            .enumerate()
            .filter_map(|(index, skill)| {
                let wanted = effective.contains(&skill.asset_id);
                (skill.enabled != wanted).then_some((index, wanted))
            })
            .collect();
        if changes.is_empty() {
            return Ok(());
        }
        for (index, enabled) in changes {
            let path = process.skills[index].path.clone();
            let written = process
                .rpc(
                    "skills/config/write",
                    json!({"path": path, "enabled": enabled}),
                    self.timeout,
                    self.max_message_bytes,
                )
                .await?;
            if written.get("effectiveEnabled").and_then(Value::as_bool) != Some(enabled) {
                return Err(RuntimeError::Protocol);
            }
            process.skills[index].enabled = enabled;
        }
        let listed = process
            .rpc(
                "skills/list",
                json!({"cwds":[process.home], "forceReload": true}),
                self.timeout,
                self.max_message_bytes,
            )
            .await?;
        if !skills_listed(&listed, &process.home, &process.skills) {
            return Err(RuntimeError::Protocol);
        }
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
        let thread = params
            .get("threadId")
            .and_then(Value::as_str)
            .and_then(|id| Uuid::parse_str(id).ok());
        let response = process
            .rpc(method, params, self.timeout, self.max_message_bytes)
            .await?;
        if matches!(method, "thread/start" | "thread/resume") {
            if let Err(error) = check_thread_projection(&response, &process.model, &process.home) {
                RpcDiagnostic::new(
                    projection.installation_id,
                    projection.generation,
                    process.next_id,
                    method,
                    &json!({"threadId":thread}),
                )
                .emit("PROJECTION", None, "INVALID_THREAD_PROJECTION");
                return Err(error);
            }
        }
        Ok(response)
    }

    /// Fixed Codex 7498521d288b9b3b96ffba4eedf089d8d6e06a84,
    /// codex-rs/app-server-protocol/src/protocol/v2/thread.rs::ThreadStartParams.
    /// Durable thread only; the only override is the original, admitted MCP
    /// server map. Session tickets remain in this RPC/config memory, never
    /// config.toml or a persisted Profile/Workflow input.
    pub(crate) async fn start_thread(
        &self,
        projection: &RuntimeRef,
        owner: StartOwner,
        tool_config: &Value,
    ) -> Result<String, RuntimeError> {
        if !matches!(owner, StartOwner::Session { .. }) {
            return Err(RuntimeError::Protocol);
        }
        let slot = self
            .processes
            .lock()
            .await
            .get(&projection.installation_id)
            .cloned()
            .ok_or(RuntimeError::Unavailable)?;
        let mut locked = slot.lock().await;
        let process = locked.as_mut().ok_or(RuntimeError::Unavailable)?;
        process
            .check(projection.generation, &projection.config_hash)
            .await?;
        let response = process
            .rpc_owned(
                "thread/start",
                json!({
                    "ephemeral":false,
                    "environments":[],
                    "allowProviderModelFallback":false,
                    "config":tool_config,
                }),
                None,
                self.timeout,
                self.max_message_bytes,
                Some(owner),
            )
            .await?;
        check_thread_projection(&response, &process.model, &process.home)?;
        let thread_id = isolated_thread_id(&response)?;
        Ok(thread_id.to_owned())
    }

    /// Read only the reply belonging to the original in-process request. A
    /// restarted/lost Process has no such evidence and remains UNKNOWN.
    pub(crate) async fn observe_start(
        &self,
        projection: &RuntimeRef,
        owner: &StartOwner,
    ) -> Result<String, RuntimeError> {
        let slot = self
            .processes
            .lock()
            .await
            .get(&projection.installation_id)
            .cloned()
            .ok_or(RuntimeError::Unknown)?;
        let mut locked = slot.lock().await;
        let process = locked.as_mut().ok_or(RuntimeError::Unknown)?;
        process
            .check(projection.generation, &projection.config_hash)
            .await?;
        process
            .observe_start(owner, self.timeout, self.max_message_bytes)
            .await
    }

    /// Whether the live process of this exact generation still holds the
    /// in-process receipt of `owner`'s thread/start. `None` is no conclusion:
    /// no live process, a different generation/config, a retiring process, or
    /// the slot busy with another native call. `Some(false)` only says the
    /// current process never received that request; it is not a native
    /// absence answer and never permits another thread/start.
    pub(crate) async fn start_receipt_held(
        &self,
        projection: &RuntimeRef,
        owner: &StartOwner,
    ) -> Option<bool> {
        let slot = self
            .processes
            .lock()
            .await
            .get(&projection.installation_id)
            .cloned()?;
        let locked = slot.try_lock().ok()?;
        let process = locked.as_ref()?;
        if process.retiring
            || process.generation != projection.generation
            || process.config_hash != projection.config_hash
        {
            return None;
        }
        Some(process.start_receipts.contains_key(owner))
    }

    /// Forget volatile correlation only after the existing DB receipt committed.
    pub(crate) async fn acknowledge_start(
        &self,
        projection: &RuntimeRef,
        owner: &StartOwner,
        native: &str,
    ) {
        let Some(slot) = self
            .processes
            .lock()
            .await
            .get(&projection.installation_id)
            .cloned()
        else {
            return;
        };
        let mut locked = slot.lock().await;
        let Some(process) = locked.as_mut() else {
            return;
        };
        if process.generation == projection.generation
            && process.config_hash == projection.config_hash
            && process
                .start_receipts
                .get(owner)
                .and_then(|r| r.outcome.as_ref())
                .is_some_and(|r| matches!(r, Ok(value) if value == native))
        {
            process.start_receipts.remove(owner);
        }
    }

    /// SF-COD-09：只恢复已持久 thread ID，不传 path/history，不启动新 turn。
    /// Observation/cancellation never replace a live thread's MCP configuration.
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

    /// 原生会话缺席的确定回答：固定 Codex 的 thread/resume 对这一精确 thread
    /// 返回 `no rollout found for thread id <id>`（`error_category` 的
    /// THREAD_NOT_FOUND，code 与正文均精确绑定本次请求）。Core 从不调用
    /// thread/archive 或删除 rollout，因此这只意味着该 durable thread 从未落盘。
    /// `Ok(false)` 是同一 thread 已恢复；超时、传输、其它原生错误一律 Err，
    /// 不从「读不到」推断缺席。
    pub(crate) async fn thread_absent(
        &self,
        projection: &RuntimeRef,
        thread_id: &str,
    ) -> Result<bool, RuntimeError> {
        if Uuid::parse_str(thread_id).is_err() {
            return Err(RuntimeError::Protocol);
        }
        let slot = self
            .processes
            .lock()
            .await
            .get(&projection.installation_id)
            .cloned()
            .ok_or(RuntimeError::Unavailable)?;
        let mut slot = slot.lock().await;
        let process = slot.as_mut().ok_or(RuntimeError::Unavailable)?;
        process
            .check(projection.generation, &projection.config_hash)
            .await?;
        match process
            .rpc(
                "thread/resume",
                json!({"threadId":thread_id,"excludeTurns":true}),
                self.timeout,
                self.max_message_bytes,
            )
            .await
        {
            Ok(response) => {
                check_thread_projection(&response, &process.model, &process.home)?;
                if isolated_thread_id(&response)? != thread_id {
                    return Err(RuntimeError::Protocol);
                }
                Ok(false)
            }
            Err(RuntimeError::Unknown) if process.last_native_error == Some("THREAD_NOT_FOUND") => {
                Ok(true)
            }
            Err(error) => Err(error),
        }
    }

    /// DD-105: only a fenced, certainly undispatched Invocation may refresh its
    /// thread. Loaded resume ignores config in fixed Codex; unsubscribe ACK is
    /// not shutdown proof. Let the native idle-unload and existing Activity
    /// reconciliation run, then require native absence before cold resume.
    pub(crate) async fn refresh_thread(
        &self,
        projection: &RuntimeRef,
        thread_id: &str,
        tool_config: &Value,
    ) -> Result<(), RuntimeError> {
        if Uuid::parse_str(thread_id).is_err()
            || tool_config.as_object().is_none_or(|config| {
                config.len() != 1 || config.get("mcp_servers").is_none_or(|v| !v.is_object())
            })
        {
            return Err(RuntimeError::Protocol);
        }
        let slot = self
            .processes
            .lock()
            .await
            .get(&projection.installation_id)
            .cloned()
            .ok_or(RuntimeError::Unavailable)?;
        let mut slot = slot.lock().await;
        let process = slot.as_mut().ok_or(RuntimeError::Unavailable)?;
        process
            .check(projection.generation, &projection.config_hash)
            .await?;
        let current = process
            .rpc(
                "thread/read",
                json!({"threadId":thread_id,"includeTurns":false}),
                self.timeout,
                self.max_message_bytes,
            )
            .await?;
        if !refresh_state(&current, thread_id)? {
            let response = process
                .rpc(
                    "thread/unsubscribe",
                    json!({"threadId":thread_id}),
                    self.timeout,
                    self.max_message_bytes,
                )
                .await?;
            if !matches!(
                response.get("status").and_then(Value::as_str),
                Some("unsubscribed" | "notSubscribed" | "notLoaded")
            ) {
                return Err(RuntimeError::Protocol);
            }
            // Even notLoaded here does not turn this ACK into a successful
            // refresh. The next original Activity must observe absence.
            let unsubscribe = response
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or_default();
            tracing::info!(installation_id = %projection.installation_id,
                generation = projection.generation, thread_id, unsubscribe,
                unload_delay_secs = THREAD_UNLOAD_DELAY_SECS,
                "MCP refresh unsubscribed the idle native thread; next round requires its unload");
            return Err(RuntimeError::Unknown);
        }
        // Fixed native default is an unbounded complete loaded-ID list. Reject
        // partial/unknown responses; a missing page is not proof of absence.
        let loaded = process
            .rpc(
                "thread/loaded/list",
                json!({}),
                self.timeout,
                self.max_message_bytes,
            )
            .await?;
        if let Err(error) = require_unloaded(&loaded, thread_id) {
            tracing::info!(installation_id = %projection.installation_id,
                generation = projection.generation, thread_id, ?error,
                "MCP refresh found the native thread still loaded; cold resume deferred");
            return Err(error);
        }
        let response = process
            .rpc(
                "thread/resume",
                json!({"threadId":thread_id,"excludeTurns":true,"config":tool_config}),
                self.timeout,
                self.max_message_bytes,
            )
            .await?;
        check_thread_projection(&response, &process.model, &process.home)?;
        if isolated_thread_id(&response)? != thread_id {
            return Err(RuntimeError::Protocol);
        }
        Ok(())
    }

    /// SS-COD-TRACE/APP：唯一已准入 Invocation 发派，Core context 仅在本次 RPC 内。
    /// 调用方已原子提交 Invocation/trace 意图；此处再持生命周期 fence/fresh 授权至 RPC 返回。
    pub(crate) async fn start_turn(
        &self,
        state: &crate::service_api::ServiceState,
        projection: &RuntimeRef,
        invocation: Uuid,
        thread: &str,
        source_context: (&str, Option<&str>, Option<&str>),
        trace: &str,
        inject_skills: bool,
    ) -> Result<String, RuntimeError> {
        let (input, core_memory, thread_context) = source_context;
        if Uuid::parse_str(thread).is_err() || input.is_empty() {
            return Err(RuntimeError::Protocol);
        }
        let mut guard = crate::gateway_usage::dispatch_guard(
            &state.pool,
            &state.openmeter,
            projection,
            invocation,
            thread,
        )
        .await
        .map_err(|_| RuntimeError::Unknown)?;
        crate::agent_invocation::fresh_invocation(state, &mut guard, invocation)
            .await
            .map_err(|_| RuntimeError::AdmissionRequired)?;
        let template = crate::agent_invocation::turn_template(&state.pool, invocation)
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
        crate::agent_invocation::fresh_invocation(state, &mut guard, invocation)
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
        // Both fragments are external, untrusted context (`12` §2): the pinned
        // core memory and the bounded thread history of this trigger.
        let mut fragments = serde_json::Map::new();
        if let Some(profile) = core_memory {
            fragments.insert(
                "platform.agent-memory.core".into(),
                json!({"value":profile,"kind":"untrusted"}),
            );
        }
        if let Some(history) = thread_context {
            fragments.insert(
                "platform.buzz.thread-context".into(),
                json!({"value":history,"kind":"untrusted"}),
            );
        }
        let context = (!fragments.is_empty()).then_some(Value::Object(fragments));
        let mut inputs = Vec::new();
        // DD-135(6)：Session 首个 turn 显式选择当前启用的全部 Skill，Codex 注入完整正文；
        // 之后的 turn 依赖同一 thread 历史，不重复注入。
        if inject_skills {
            for skill in process.skills.iter().filter(|skill| skill.enabled) {
                inputs.push(json!({"type":"skill","name":skill.name,"path":skill.path}));
            }
        }
        if let Some(template) = template {
            inputs.push(json!({"type":"text","text":template,"textElements":[]}));
        }
        inputs.push(json!({"type":"text","text":input,"textElements":[]}));
        let result = process
            .rpc_owned(
                "turn/start",
                json!({"threadId":thread,
            "clientUserMessageId":invocation.to_string(),"input":inputs,
            "additionalContext":context}),
                Some(trace),
                self.timeout,
                self.max_message_bytes,
                Some(StartOwner::Turn {
                    invocation,
                    thread: thread.to_owned(),
                }),
            )
            .await;
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

    /// DD-125(6)、SF-COD-09：按 AgentSession 只读一页原生持久 item（升序）。正文只在本次
    /// 回应内交给已准入读者，不写库、不进日志；超限仍只能结果不明。
    pub(crate) async fn items(
        &self,
        projection: &RuntimeRef,
        thread_id: &str,
        cursor: Option<&str>,
    ) -> Result<Value, RuntimeError> {
        if Uuid::parse_str(thread_id).is_err() {
            return Err(RuntimeError::Protocol);
        }
        self.call(
            projection,
            "thread/items/list",
            json!({"threadId":thread_id,"cursor":cursor,"limit":TRANSCRIPT_PAGE_ITEMS,
                "sortDirection":"asc"}),
        )
        .await
    }

    /// 原生 turn 的 startedAt（Unix 秒）。读不到这一精确 turn 时为 None，不用本机时钟补。
    pub(crate) async fn turn_started_at(
        &self,
        projection: &RuntimeRef,
        thread_id: &str,
        turn_id: &str,
    ) -> Result<Option<i64>, RuntimeError> {
        if Uuid::parse_str(thread_id).is_err() || turn_id.is_empty() {
            return Err(RuntimeError::Protocol);
        }
        let page = self
            .call(
                projection,
                "thread/turns/list",
                json!({"threadId":thread_id,"limit":TURN_LOOKUP_LIMIT,"sortDirection":"desc",
                    "itemsView":"notLoaded"}),
            )
            .await?;
        Ok(turn_started(&page, turn_id))
    }

    /// 本机仍存活、未退役的运行体所持 generation 与 config hash。调用方须再以 Core 事实
    /// 核对它属于该 Installation 的 ACTIVE/PENDING 投影；这不是第二份状态权威。
    pub(crate) async fn live_fence(&self, installation: Uuid) -> Option<(i64, String)> {
        let slot = self.processes.lock().await.get(&installation).cloned()?;
        let locked = slot.lock().await;
        let process = locked.as_ref()?;
        if process.retiring {
            return None;
        }
        Some((process.generation, process.config_hash.clone()))
    }

    /// DD-125(6)：实时转写读者的订阅。
    pub(crate) fn subscribe_notices(&self) -> broadcast::Receiver<NativeNotice> {
        self.notices.subscribe()
    }

    /// 只在槽空闲时取走 stdout 中已缓冲的原生消息，处理方式与 RPC 读循环相同；
    /// 绝不等待正在进行的 RPC（它本身就在读），也不发出任何请求。
    pub(crate) async fn pump(&self, installation: Uuid) {
        let Some(slot) = self.processes.lock().await.get(&installation).cloned() else {
            return;
        };
        let Ok(mut locked) = slot.try_lock() else {
            return;
        };
        let Some(process) = locked.as_mut() else {
            return;
        };
        if process.retiring {
            return;
        }
        process.pump(self.max_message_bytes).await;
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

    /// Upgrade drains before calling this; retries must not stop the already
    /// initialized replacement. Reuse the same slot and advisory ownership.
    pub(crate) async fn stop_before_generation(
        &self,
        installation: Uuid,
        generation: i64,
    ) -> Result<(), RuntimeError> {
        let slot = self.processes.lock().await.get(&installation).cloned();
        if let Some(slot) = slot {
            let mut slot = slot.lock().await;
            if let Some(process) = slot.as_mut() {
                if process.generation == generation {
                    return Ok(());
                }
                if process.retiring || process.generation > generation {
                    return Err(RuntimeError::Unknown);
                }
                terminate(&mut process.child, self.timeout).await?;
                *slot = None;
            }
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
        // DD-135(5) 的只读 Skill 根先恢复 owner 可写，否则非 root 进程删不掉其中的条目。
        writable_tree(canonical.join(SKILL_ROOT_DIR)).await?;
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
                    join catalog.resource r on r.id=i.resource_id
                    join catalog.agent_runtime_projection p on p.installation_resource_id=i.resource_id and p.generation=$2
                    where i.resource_id=$1 and ((p.config_hash=$3
                      and catalog.agent_generation_admitted(i.resource_id,p.agent_version_asset_id,p.generation)
                      and (i.state='ACTIVE' or not catalog.agent_installation_drained(i.resource_id)))
                    or (p.state='PENDING'
                      and exists(select 1 from admission.action_execution a where a.id=r.projection_action_execution_id
                        and a.target_id=i.resource_id and a.gate_state='ALLOWED'
                        and ((i.state in ('PROVISIONING','DRAINING')
                            and a.action_key in ('agent.installation.create','agent.installation.upgrade')
                            and a.parameters->'params'->>'assetId'=p.agent_version_asset_id::text)
                          or (i.state='DISABLED' and a.action_key='agent.installation.enable'
                            and p.agent_version_asset_id=i.pinned_version_asset_id))))
                    -- DD-125(6) disable drains like an upgrade: the live generation stays observable
                    -- (interrupt/history) until drained; the lifecycle then stops it itself.
                    or (p.state='ACTIVE' and p.config_hash=$3 and p.generation=i.active_projection_generation
                      and i.state='DRAINING' and not catalog.agent_installation_drained(i.resource_id)
                      and exists(select 1 from admission.action_execution a where a.id=r.projection_action_execution_id
                        and a.target_id=i.resource_id and a.gate_state='ALLOWED'
                        and a.action_key='agent.installation.disable'))))")
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

fn refresh_state(response: &Value, thread: &str) -> Result<bool, RuntimeError> {
    if response.pointer("/thread/id").and_then(Value::as_str) != Some(thread) {
        return Err(RuntimeError::Protocol);
    }
    match response
        .pointer("/thread/status/type")
        .and_then(Value::as_str)
    {
        Some("notLoaded") => Ok(true),
        Some("idle") => Ok(false),
        _ => Err(RuntimeError::Unknown),
    }
}

fn require_unloaded(response: &Value, thread: &str) -> Result<(), RuntimeError> {
    if response.get("nextCursor") != Some(&Value::Null) {
        return Err(RuntimeError::Unknown);
    }
    let ids = response
        .get("data")
        .and_then(Value::as_array)
        .ok_or(RuntimeError::Protocol)?;
    let mut seen = std::collections::HashSet::new();
    for value in ids {
        let id = value.as_str().ok_or(RuntimeError::Protocol)?;
        if Uuid::parse_str(id).is_err() || !seen.insert(id) {
            return Err(RuntimeError::Protocol);
        }
        if id == thread {
            return Err(RuntimeError::Unknown);
        }
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

/// 把一棵目录树恢复为 owner 可写（目录 0700、文件 0600）；不跟随符号链接，不存在即成功。
async fn writable_tree(root: PathBuf) -> Result<(), RuntimeError> {
    tokio::task::spawn_blocking(move || {
        fn walk(path: &Path) -> std::io::Result<()> {
            let meta = std::fs::symlink_metadata(path)?;
            if meta.file_type().is_symlink() {
                return Err(std::io::Error::other("symlink in skill root"));
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mode = if meta.is_dir() { 0o700 } else { 0o600 };
                std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))?;
            }
            if meta.is_dir() {
                for entry in std::fs::read_dir(path)? {
                    walk(&entry?.path())?;
                }
            }
            Ok(())
        }
        match walk(&root) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            other => other,
        }
    })
    .await
    .map_err(|_| RuntimeError::Unknown)?
    .map_err(|_| RuntimeError::Unavailable)
}

/// DD-135(5)：在 Installation 专属 home 下物化本 generation 的 Skill 根
/// `kailo-skills/g<generation>/<slug>/SKILL.md`。字节在写入前后都以 digest 核对；文件与目录
/// 只读（同一 uid 下只是防误写的模式位，模型没有 shell 与文件写工具）。
async fn materialize_skills(
    home: &Path,
    root_ref: Option<&str>,
    skills: &[crate::skill_projection::SkillArtifact],
) -> Result<(Option<String>, Vec<ProjectedSkill>), RuntimeError> {
    let base = home.join(SKILL_ROOT_DIR);
    writable_tree(base.clone()).await?;
    if let Err(error) = tokio::fs::remove_dir_all(&base).await {
        if error.kind() != std::io::ErrorKind::NotFound {
            return Err(RuntimeError::Unavailable);
        }
    }
    let root_ref = match (root_ref, skills.is_empty()) {
        (None, true) => return Ok((None, Vec::new())),
        (Some(root_ref), false)
            if root_ref
                .strip_prefix("kailo-skills/g")
                .is_some_and(|g| !g.is_empty() && g.bytes().all(|b| b.is_ascii_digit())) =>
        {
            root_ref
        }
        _ => return Err(RuntimeError::Protocol),
    };
    let root = home.join(root_ref);
    tokio::fs::create_dir_all(&root)
        .await
        .map_err(|_| RuntimeError::Unavailable)?;
    let root = tokio::fs::canonicalize(&root)
        .await
        .map_err(|_| RuntimeError::Unavailable)?;
    if !root.starts_with(home) || root.parent() != Some(base.as_path()) {
        return Err(RuntimeError::Unavailable);
    }
    let mut projected = Vec::with_capacity(skills.len());
    for skill in skills {
        if !crate::skill_artifact::valid_slug(&skill.name)
            || crate::skill_artifact::sha256_hex(&skill.bytes) != skill.digest
        {
            return Err(RuntimeError::Protocol);
        }
        let dir = root.join(&skill.name);
        // create_dir 而非 create_dir_all：同名两个 Skill 是投影错误，不能静默覆盖。
        tokio::fs::create_dir(&dir)
            .await
            .map_err(|_| RuntimeError::Protocol)?;
        let file = dir.join(crate::skill_artifact::SKILL_FILE);
        tokio::fs::write(&file, &skill.bytes)
            .await
            .map_err(|_| RuntimeError::Unavailable)?;
        let read = tokio::fs::read(&file)
            .await
            .map_err(|_| RuntimeError::Unavailable)?;
        if crate::skill_artifact::sha256_hex(&read) != skill.digest {
            return Err(RuntimeError::Protocol);
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            tokio::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o444))
                .await
                .map_err(|_| RuntimeError::Unavailable)?;
            tokio::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o555))
                .await
                .map_err(|_| RuntimeError::Unavailable)?;
        }
        projected.push(ProjectedSkill {
            asset_id: skill.asset_id,
            name: skill.name.clone(),
            digest: skill.digest.clone(),
            path: file.to_string_lossy().into_owned(),
            enabled: true,
        });
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for dir in [&root, &base] {
            tokio::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o555))
                .await
                .map_err(|_| RuntimeError::Unavailable)?;
        }
    }
    Ok((Some(root.to_string_lossy().into_owned()), projected))
}

/// `skills/list` 对 `CODEX_HOME` 的回应必须恰为预期集合：同名、同规范路径、`user` scope、
/// 启用标志一致且无解析错误；出现任何其他 Skill 即不一致（DD-135(5)、SF-COD-18）。
fn skills_listed(listed: &Value, home: &Path, expected: &[ProjectedSkill]) -> bool {
    let Some([entry]) = listed
        .get("data")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
    else {
        return false;
    };
    if entry.get("cwd").and_then(Value::as_str) != home.to_str()
        || entry
            .get("errors")
            .and_then(Value::as_array)
            .is_none_or(|errors| !errors.is_empty())
    {
        return false;
    }
    let Some(skills) = entry.get("skills").and_then(Value::as_array) else {
        return false;
    };
    skills.len() == expected.len()
        && expected.iter().all(|want| {
            skills.iter().any(|skill| {
                skill.get("name").and_then(Value::as_str) == Some(want.name.as_str())
                    && skill.get("path").and_then(Value::as_str) == Some(want.path.as_str())
                    && skill.get("scope").and_then(Value::as_str) == Some("user")
                    && skill.get("enabled").and_then(Value::as_bool) == Some(want.enabled)
            })
        })
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
        self.rpc_owned(method, params, traceparent, timeout, max, None)
            .await
    }

    async fn rpc_owned(
        &mut self,
        method: &str,
        params: Value,
        traceparent: Option<&str>,
        timeout: Duration,
        max: usize,
        owner: Option<StartOwner>,
    ) -> Result<Value, RuntimeError> {
        if owner
            .as_ref()
            .is_some_and(|owner| self.start_receipts.contains_key(owner))
        {
            return Err(RuntimeError::Unknown); // observe the old request, never resend
        }
        self.last_native_error = None;
        self.next_id = self.next_id.checked_add(1).ok_or(RuntimeError::Protocol)?;
        let id = self.next_id;
        let diagnostic =
            RpcDiagnostic::new(self.installation_id, self.generation, id, method, &params);
        if let Some(owner) = owner {
            self.start_receipts
                .insert(owner, StartReceipt { id, outcome: None });
        }
        let mut request = json!({"id":id,"method":method,"params":params});
        if let Some(trace) = traceparent {
            request["trace"] = json!({"traceparent":trace});
        }
        match tokio::time::timeout(timeout, self.send(&request)).await {
            Ok(Ok(())) => {}
            Err(_) => {
                diagnostic.emit("SEND", None, "TIMEOUT");
                return Err(RuntimeError::Unknown);
            }
            Ok(Err(error)) => {
                diagnostic.emit("SEND", None, "IO_UNAVAILABLE");
                return Err(error);
            }
        }
        let mut native_error_received = false;
        let mut native_category = None;
        let read = async {
            loop {
                let message = self.read_message(max).await?;
                self.capture_start_receipt(&message);
                if message.get("id").and_then(Value::as_u64) == Some(id)
                    && message.get("method").is_none()
                {
                    if let Some(error) = message.get("error") {
                        native_error_received = true;
                        let (code, category) = diagnostic.error_category(error);
                        diagnostic.emit("RESPONSE", code, category);
                        native_category = Some(category);
                        return Err(RuntimeError::Unknown);
                    }
                    return message.get("result").cloned().ok_or(RuntimeError::Protocol);
                }
                if message.get("id").is_some() && message.get("method").is_some() {
                    // 没有审批/PEP 生产事实就不答同意；不把 native 请求正文送入 history。
                    self.send(&json!({"id":message["id"],"error":{"code":-32000,"message":"PLATFORM_ADMISSION_REQUIRED"}})).await?;
                    return Err(RuntimeError::AdmissionRequired);
                }
                self.forward_notice(&message);
                // 不复制正文。活动只取原生 envelope 的时间与 thread/turn 引用；
                // usage/account/RPC response 不重置 idle timer、不当 durable usage。
                record_native_activity(
                    &mut self.native_activity,
                    &message,
                    chrono::Utc::now().timestamp_millis(),
                )?;
            }
        };
        let outcome = tokio::time::timeout(timeout, read).await;
        self.last_native_error = native_category;
        match outcome {
            Err(_) => {
                diagnostic.emit("READ", None, "TIMEOUT");
                Err(RuntimeError::Unknown)
            }
            Ok(outcome) => {
                if let Err(error) = &outcome {
                    if !native_error_received {
                        let category = match error {
                            RuntimeError::Protocol => "INVALID_RPC_RESPONSE",
                            RuntimeError::AdmissionRequired => "ADMISSION_REQUIRED",
                            RuntimeError::QuotaRefused(_) => "QUOTA_REFUSED",
                            RuntimeError::Unavailable | RuntimeError::Unknown => "IO_UNAVAILABLE",
                        };
                        diagnostic.emit("READ", None, category);
                    }
                }
                outcome
            }
        }
    }

    async fn read_message(&mut self, max: usize) -> Result<Value, RuntimeError> {
        // fill_buf/consume preserves partial lines on cancellation and bounds
        // allocation before parsing, even without a newline.
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
        let message =
            serde_json::from_slice(&self.pending_line).map_err(|_| RuntimeError::Protocol)?;
        self.pending_line.clear();
        Ok(message)
    }

    fn capture_start_receipt(&mut self, message: &Value) {
        if message.get("method").is_some() {
            return;
        }
        let Some(id) = message.get("id").and_then(Value::as_u64) else {
            return;
        };
        let Some((owner, receipt)) = self
            .start_receipts
            .iter_mut()
            .find(|(_, receipt)| receipt.id == id)
        else {
            return;
        };
        if receipt.outcome.is_some() {
            return;
        }
        let outcome = if message.get("error").is_some() {
            Err(RuntimeError::Unknown)
        } else if let Some(result) = message.get("result") {
            match owner {
                StartOwner::Session { .. } => {
                    check_thread_projection(result, &self.model, &self.home)
                        .and_then(|()| isolated_thread_id(result).map(str::to_owned))
                }
                StartOwner::Turn { .. } => {
                    let turn = result.get("turn");
                    match turn {
                        Some(turn)
                            if matches!(
                                turn.get("status").and_then(Value::as_str),
                                Some("inProgress" | "completed" | "failed" | "interrupted")
                            ) =>
                        {
                            turn.get("id")
                                .and_then(Value::as_str)
                                .filter(|id| !id.is_empty())
                                .map(str::to_owned)
                                .ok_or(RuntimeError::Protocol)
                        }
                        _ => Err(RuntimeError::Protocol),
                    }
                }
            }
        } else {
            Err(RuntimeError::Protocol)
        };
        receipt.outcome = Some(outcome);
    }

    async fn observe_start(
        &mut self,
        owner: &StartOwner,
        timeout: Duration,
        max: usize,
    ) -> Result<String, RuntimeError> {
        if !self.start_receipts.contains_key(owner) {
            return Err(RuntimeError::Unknown);
        }
        let read = async {
            loop {
                if let Some(outcome) = self
                    .start_receipts
                    .get(owner)
                    .and_then(|r| r.outcome.clone())
                {
                    return outcome;
                }
                let message = self.read_message(max).await?;
                self.capture_start_receipt(&message);
                if message.get("id").is_some() && message.get("method").is_some() {
                    self.send(&json!({"id":message["id"],"error":{"code":-32000,"message":"PLATFORM_ADMISSION_REQUIRED"}})).await?;
                    return Err(RuntimeError::AdmissionRequired);
                }
                self.forward_notice(&message);
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

impl Process {
    fn forward_notice(&self, message: &Value) {
        if self.tap.receiver_count() == 0 {
            return;
        }
        if let Some(notice) = native_notice(self.installation_id, message) {
            let _ = self.tap.send(notice);
        }
    }

    /// 每条消息的处理与 RPC 读循环一致：回执、拒答原生请求、活动时间与实时转写。
    /// 等待只到 PUMP_READ_BOUND；read_message 在取消时保留未完成的行。
    async fn pump(&mut self, max: usize) {
        for _ in 0..PUMP_MAX_MESSAGES {
            let read = tokio::time::timeout(PUMP_READ_BOUND, self.read_message(max)).await;
            let Ok(Ok(message)) = read else {
                return;
            };
            self.capture_start_receipt(&message);
            if message.get("id").is_some() && message.get("method").is_some() {
                let refused = json!({"id":message["id"],
                    "error":{"code":-32000,"message":"PLATFORM_ADMISSION_REQUIRED"}});
                if self.send(&refused).await.is_err() {
                    return;
                }
                continue;
            }
            self.forward_notice(&message);
            if record_native_activity(
                &mut self.native_activity,
                &message,
                chrono::Utc::now().timestamp_millis(),
            )
            .is_err()
            {
                return;
            }
        }
    }
}

/// item/started、item/completed、turn/started、turn/completed 才进入实时转写；其余
/// 通知、请求与回应一律不转发。turn 通知只留状态，不复制其中的 item。
fn native_notice(installation: Uuid, message: &Value) -> Option<NativeNotice> {
    if message.get("id").is_some() {
        return None;
    }
    let method = match message.get("method").and_then(Value::as_str)? {
        "item/started" => "item/started",
        "item/completed" => "item/completed",
        "turn/started" => "turn/started",
        "turn/completed" => "turn/completed",
        _ => return None,
    };
    let params = message.get("params")?;
    let thread = params.get("threadId").and_then(Value::as_str)?;
    let (turn, params) = if method.starts_with("turn/") {
        let turn = params.pointer("/turn/id").and_then(Value::as_str)?;
        let status = params
            .pointer("/turn/status")
            .cloned()
            .unwrap_or(Value::Null);
        (turn, json!({"status":status}))
    } else {
        let turn = params.get("turnId").and_then(Value::as_str)?;
        if !params.get("item").is_some_and(Value::is_object) {
            return None;
        }
        (turn, params.clone())
    };
    if thread.is_empty() || turn.is_empty() {
        return None;
    }
    Some(NativeNotice {
        installation,
        method,
        thread: thread.to_owned(),
        turn: turn.to_owned(),
        params,
        emitted_at_ms: message.get("emittedAtMs").and_then(Value::as_i64),
    })
}

fn turn_started(page: &Value, turn: &str) -> Option<i64> {
    let turns = page.get("data")?.as_array()?;
    let row = turns
        .iter()
        .find(|row| row.get("id").and_then(Value::as_str) == Some(turn))?;
    let started = row.get("startedAt")?.as_i64()?;
    (started > 0).then_some(started)
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
#[path = "agent_runtime/diagnostic_tests.rs"]
mod diagnostic_tests;

#[cfg(test)]
mod activity_tests {
    #[test]
    fn mcp_refresh_requires_exact_native_idle_or_unloaded_thread() {
        let thread = Uuid::new_v4().to_string();
        for (status, expected) in [("idle", false), ("notLoaded", true)] {
            assert_eq!(
                refresh_state(
                    &json!({"thread":{"id":thread,"status":{"type":status}}}),
                    &thread
                )
                .unwrap(),
                expected
            );
        }
        for status in ["active", "systemError", "future", ""] {
            assert!(refresh_state(
                &json!({"thread":{"id":thread,"status":{"type":status}}}),
                &thread
            )
            .is_err());
        }
        assert!(refresh_state(
            &json!({"thread":{"id":Uuid::new_v4(),"status":{"type":"idle"}}}),
            &thread
        )
        .is_err());
        assert!(refresh_state(&json!({"thread":{"id":thread}}), &thread).is_err());
    }

    #[test]
    fn mcp_refresh_requires_complete_native_unload_proof() {
        let thread = Uuid::new_v4().to_string();
        let other = Uuid::new_v4().to_string();
        require_unloaded(&json!({"data":[],"nextCursor":null}), &thread).unwrap();
        require_unloaded(&json!({"data":[other],"nextCursor":null}), &thread).unwrap();
        for response in [
            json!({"data":[thread],"nextCursor":null}),
            json!({"data":[],"nextCursor":"next"}),
            json!({"data":[]}),
            json!({"data":[other,other],"nextCursor":null}),
            json!({"data":["unknown"],"nextCursor":null}),
            json!({"nextCursor":null}),
        ] {
            assert!(require_unloaded(&response, &thread).is_err());
        }
    }

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
            trace_endpoint: "http://collector.invalid:4318".into(),
            timeout: Duration::from_secs(2),
            max_message_bytes: 4096,
            processes: Mutex::new(HashMap::from([(installation, Arc::clone(&slot))])),
            notices: broadcast::channel(1).0,
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
            skill_root_ref: None,
            skills: Vec::new(),
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

        // Real stdio path: an idle unsubscribe ACK is never cold-resume proof.
        let idle = json!({"thread":{"id":thread,"status":{"type":"idle"}}});
        let script = format!("IFS= read -r request; printf '%s\\n' '{}'; IFS= read -r request; printf '%s\\n' '{}'; exec sleep 300",
            json!({"id":1,"result":idle}), json!({"id":2,"result":{"status":"unsubscribed"}}));
        *slot.lock().await = Some(recovery_process(&pool, installation, &hash, &script).await);
        assert!(matches!(
            supervisor
                .refresh_thread(&projection, &thread, &json!({"mcp_servers":{}}))
                .await,
            Err(RuntimeError::Unknown)
        ));
        assert_eq!(
            slot.lock().await.as_ref().unwrap().next_id,
            2,
            "unsubscribe must not be followed by an unproven hot resume"
        );
        supervisor.stop(installation).await.unwrap();

        // Both renewal and removal use the exact supplied native in-memory map.
        for config in [
            json!({"mcp_servers":{}}),
            json!({"mcp_servers":{"fixture":{"http_headers":{"Authorization":"Bearer fixture-only"}}}}),
        ] {
            let mut script = String::new();
            for (id, method, params, response) in [
                (
                    1,
                    "thread/read",
                    json!({"threadId":thread,"includeTurns":false}),
                    json!({"thread":{"id":thread,"status":{"type":"notLoaded"}}}),
                ),
                (
                    2,
                    "thread/loaded/list",
                    json!({}),
                    json!({"data":[],"nextCursor":null}),
                ),
                (
                    3,
                    "thread/resume",
                    json!({"threadId":thread,"excludeTurns":true,"config":config}),
                    valid.clone(),
                ),
            ] {
                script.push_str(&format!("IFS= read -r request; [ \"$request\" = '{}' ] || exit 7; printf '%s\\n' '{}'; ",
                    json!({"id":id,"method":method,"params":params}),json!({"id":id,"result":response})));
            }
            script.push_str("exec sleep 300");
            *slot.lock().await = Some(recovery_process(&pool, installation, &hash, &script).await);
            supervisor
                .refresh_thread(&projection, &thread, &config)
                .await
                .unwrap();
            assert_eq!(slot.lock().await.as_ref().unwrap().next_id, 3);
            supervisor.stop(installation).await.unwrap();
        }

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

    pub(super) async fn recovery_process(
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
            installation_id: installation,
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
            start_receipts: HashMap::new(),
            native_activity: HashMap::new(),
            last_native_error: None,
            tap: broadcast::channel(1).0,
        }
    }

    #[tokio::test]
    #[ignore = "requires AGENT_INVOKE_TEST_DATABASE_URL pointing at a disposable migrated database"]
    async fn receipt_late_native_start_survives_rpc_timeout_and_unrelated_read() {
        let pool = PgPool::connect(&std::env::var("AGENT_INVOKE_TEST_DATABASE_URL").unwrap())
            .await
            .unwrap();
        let native = Uuid::new_v4().to_string();
        let birth = StartOwner::Session {
            tenant: Uuid::new_v4(),
            workspace: Uuid::new_v4(),
            root: "a".repeat(64),
            version: Uuid::new_v4(),
        };
        let turn = StartOwner::Turn {
            invocation: Uuid::new_v4(),
            thread: Uuid::new_v4().to_string(),
        };
        for (method, owner, response) in [
            (
                "thread/start",
                birth,
                json!({"thread":{"id":native,"ephemeral":false,"parentThreadId":null,
                "forkedFromId":null,"environments":[],"modelProvider":"platform_gateway"},
                "modelProvider":"platform_gateway","model":"model","cwd":"/runtime-test",
                "approvalPolicy":"on-request","approvalsReviewer":"user"}),
            ),
            (
                "turn/start",
                turn,
                json!({"turn":{"id":native,"status":"inProgress"}}),
            ),
        ] {
            // The native double deliberately cannot answer request 1 until
            // request 2 arrives. This exercises real stdio timeout, not a
            // guessed wall-clock sleep or cancellation of a stand-alone task.
            let late = json!({"id":1,"result":response});
            let script = format!("IFS= read -r first; IFS= read -r observer; printf '%s\\n' '{}' '{{\"id\":2,\"result\":{{}}}}'; exec sleep 300", late);
            let mut process = recovery_process(&pool, Uuid::new_v4(), "hash", &script).await;
            assert!(matches!(
                process
                    .rpc_owned(
                        method,
                        json!({}),
                        None,
                        Duration::from_millis(25),
                        8192,
                        Some(owner.clone())
                    )
                    .await,
                Err(RuntimeError::Unknown)
            ));
            assert_eq!(process.next_id, 1);
            // The same owner cannot send another native start after timeout.
            assert!(matches!(
                process
                    .rpc_owned(
                        method,
                        json!({}),
                        None,
                        Duration::from_secs(2),
                        8192,
                        Some(owner.clone())
                    )
                    .await,
                Err(RuntimeError::Unknown)
            ));
            assert_eq!(process.next_id, 1);
            process
                .rpc("thread/read", json!({}), Duration::from_secs(2), 8192)
                .await
                .unwrap();
            assert_eq!(
                process
                    .observe_start(&owner, Duration::from_secs(2), 8192)
                    .await
                    .unwrap(),
                native
            );
            assert_eq!(
                process
                    .observe_start(&owner, Duration::from_secs(2), 8192)
                    .await
                    .unwrap(),
                native
            );
            assert_eq!(process.next_id, 2, "observation never sends another start");
            let foreign = StartOwner::Turn {
                invocation: Uuid::new_v4(),
                thread: native.clone(),
            };
            assert!(matches!(
                process
                    .observe_start(&foreign, Duration::from_secs(2), 8192)
                    .await,
                Err(RuntimeError::Unknown)
            ));
            assert!(matches!(
                process.check(2, "hash").await,
                Err(RuntimeError::Unavailable)
            ));
            assert!(matches!(
                process.check(1, "foreign-hash").await,
                Err(RuntimeError::Unavailable)
            ));
            terminate(&mut process.child, Duration::from_secs(2))
                .await
                .unwrap();
        }
    }

    #[tokio::test]
    #[ignore = "requires AGENT_INVOKE_TEST_DATABASE_URL pointing at a disposable migrated database"]
    async fn receipt_native_exit_does_not_invent_a_result_or_allow_resend() {
        let pool = PgPool::connect(&std::env::var("AGENT_INVOKE_TEST_DATABASE_URL").unwrap())
            .await
            .unwrap();
        let mut process = recovery_process(
            &pool,
            Uuid::new_v4(),
            "hash",
            "IFS= read -r request; exit 0",
        )
        .await;
        let owner = StartOwner::Turn {
            invocation: Uuid::new_v4(),
            thread: Uuid::new_v4().to_string(),
        };
        assert!(matches!(
            process
                .rpc_owned(
                    "turn/start",
                    json!({}),
                    None,
                    Duration::from_secs(2),
                    8192,
                    Some(owner.clone())
                )
                .await,
            Err(RuntimeError::Unknown)
        ));
        assert!(matches!(
            process
                .observe_start(&owner, Duration::from_secs(2), 8192)
                .await,
            Err(RuntimeError::Unknown)
        ));
        assert!(matches!(
            process
                .rpc_owned(
                    "turn/start",
                    json!({}),
                    None,
                    Duration::from_secs(2),
                    8192,
                    Some(owner)
                )
                .await,
            Err(RuntimeError::Unknown)
        ));
        assert_eq!(process.next_id, 1);
        process.child.wait().await.unwrap();
    }

    #[test]
    fn native_trace_config_and_readback_fail_closed() {
        let endpoint = "http://collector.invalid:4318/";
        let generated = native_trace_config(endpoint).unwrap();
        assert!(generated.contains("[otel]\nexporter = \"none\""));
        assert!(generated.contains("metrics_exporter = \"none\""));
        assert!(generated.contains("log_user_prompt = false"));
        assert!(generated.contains("trace_exporter = { otlp-http = { endpoint = \"http://collector.invalid:4318/v1/traces\", protocol = \"binary\" } }"));
        let config = json!({"otel": {
            "exporter":"none", "metrics_exporter":"none", "log_user_prompt":false,
            "trace_exporter":{"otlp-http":{"endpoint":"http://collector.invalid:4318/v1/traces","protocol":"binary"}}
        }});
        assert!(native_trace_verified(&config, endpoint));
        for pointer in [
            "/otel/exporter",
            "/otel/metrics_exporter",
            "/otel/log_user_prompt",
            "/otel/trace_exporter/otlp-http/endpoint",
            "/otel/trace_exporter/otlp-http/protocol",
        ] {
            let mut missing = config.clone();
            *missing.pointer_mut(pointer).unwrap() = Value::Null;
            assert!(!native_trace_verified(&missing, endpoint), "{pointer}");
        }
        let mut disabled = config.clone();
        disabled["otel"]["trace_exporter"] = json!("none");
        assert!(!native_trace_verified(&disabled, endpoint));
        assert!(!native_trace_verified(&config, "http://other.invalid:4318"));
        for invalid in [
            "",
            "file:///tmp/traces",
            "http://user:password@collector.invalid",
            "http://collector.invalid?token=x",
        ] {
            assert!(native_trace_config(invalid).is_err());
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
            profiles: vec![contracts::RuntimeProfileDirectoryProfilesItem {
                key: "negative-contract-only".into(),
                kind: contracts::RuntimeProfileKind::ServerCodex,
                status: "DRAFT".into(),
                web_availability: "DISABLED".into(),
                capability_contract:
                    contracts::RuntimeProfileDirectoryProfilesItemCapabilityContract {
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
                .env(
                    "OTEL_EXPORTER_OTLP_ENDPOINT",
                    "http://collector.invalid:4318",
                )
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

    #[test]
    fn live_transcript_tap_forwards_only_item_and_turn_notifications() {
        let installation = Uuid::from_u128(9);
        let item = json!({"method":"item/started","emittedAtMs":1000,
            "params":{"threadId":"t","turnId":"u","startedAtMs":1000,
                "item":{"type":"commandExecution","id":"c","command":"ls"}}});
        let notice = native_notice(installation, &item).unwrap();
        assert_eq!(notice.method, "item/started");
        assert_eq!((notice.thread.as_str(), notice.turn.as_str()), ("t", "u"));
        assert_eq!(notice.params["item"]["command"], "ls");
        assert_eq!(notice.emitted_at_ms, Some(1000));
        // A turn notice keeps only the native status, never the turn's items.
        let turn = json!({"method":"turn/completed","params":{"threadId":"t",
            "turn":{"id":"u","status":"completed","items":[{"type":"agentMessage"}]}}});
        let notice = native_notice(installation, &turn).unwrap();
        assert_eq!(notice.params, json!({"status":"completed"}));
        assert_eq!(notice.emitted_at_ms, None);
        for message in [
            json!({"method":"item/agentMessage/delta","params":{"threadId":"t","turnId":"u"}}),
            json!({"method":"thread/tokenUsage/updated","params":{"threadId":"t","turnId":"u"}}),
            json!({"id":4,"method":"item/started","params":{"threadId":"t","turnId":"u",
                "item":{"type":"plan"}}}),
            json!({"id":4,"result":{"threadId":"t"}}),
            json!({"method":"item/completed","params":{"threadId":"t","turnId":"u"}}),
            json!({"method":"item/completed","params":{"turnId":"u","item":{}}}),
            json!({"method":"turn/started","params":{"threadId":"t","turn":{}}}),
        ] {
            assert!(native_notice(installation, &message).is_none(), "{message}");
        }
    }

    #[test]
    fn transcript_item_page_is_a_fixed_rpc_method() {
        let diagnostic = RpcDiagnostic::new(Uuid::nil(), 1, 1, "thread/items/list", &json!({}));
        assert_eq!(diagnostic.method, "thread/items/list");
    }

    #[test]
    fn turn_start_is_the_native_seconds_of_that_exact_turn() {
        let page = json!({"data":[{"id":"a","startedAt":100},{"id":"b","startedAt":null},
            {"id":"c","startedAt":0}],"nextCursor":null});
        assert_eq!(turn_started(&page, "a"), Some(100));
        assert_eq!(turn_started(&page, "b"), None);
        assert_eq!(turn_started(&page, "c"), None);
        assert_eq!(turn_started(&page, "missing"), None);
        assert_eq!(turn_started(&json!({}), "a"), None);
    }
}

#[cfg(test)]
mod skill_projection_tests {
    use super::{materialize_skills, skills_listed, ProjectedSkill, SKILL_ROOT_DIR};
    use crate::skill_projection::SkillArtifact;
    use serde_json::json;
    use uuid::Uuid;

    const BODY: &[u8] = b"---\nname: release-notes\ndescription: d\n---\n";

    fn artifact() -> SkillArtifact {
        SkillArtifact {
            asset_id: Uuid::new_v4(),
            name: "release-notes".into(),
            digest: crate::skill_artifact::sha256_hex(BODY),
            bytes: BODY.to_vec(),
        }
    }

    fn listed(home: &std::path::Path, skills: &[ProjectedSkill]) -> serde_json::Value {
        json!({"data":[{"cwd": home, "errors": [], "skills": skills.iter().map(|s| json!({
            "name": s.name, "path": s.path, "scope": "user", "enabled": s.enabled,
            "description": "d"})).collect::<Vec<_>>()}]})
    }

    #[tokio::test]
    async fn materializes_a_read_only_generation_root_and_replaces_older_ones() {
        let home = std::env::temp_dir().join(format!("kailo-skill-test-{}", Uuid::new_v4()));
        tokio::fs::create_dir_all(&home).await.unwrap();
        let home = tokio::fs::canonicalize(&home).await.unwrap();
        let skill = artifact();
        let (root, first) =
            materialize_skills(&home, Some("kailo-skills/g1"), std::slice::from_ref(&skill))
                .await
                .unwrap();
        let root = root.unwrap();
        assert!(root.ends_with("kailo-skills/g1"));
        assert_eq!(tokio::fs::read(&first[0].path).await.unwrap(), BODY);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = tokio::fs::metadata(&first[0].path)
                .await
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o444);
        }
        assert!(skills_listed(&listed(&home, &first), &home, &first));
        // A second generation replaces the old read-only root entirely.
        let (_, second) =
            materialize_skills(&home, Some("kailo-skills/g2"), std::slice::from_ref(&skill))
                .await
                .unwrap();
        assert!(second[0].path.contains("/g2/"));
        assert!(tokio::fs::metadata(home.join(SKILL_ROOT_DIR).join("g1"))
            .await
            .is_err());
        // No skills: the root is removed and nothing is registered.
        let (none, empty) = materialize_skills(&home, None, &[]).await.unwrap();
        assert!(none.is_none() && empty.is_empty());
        assert!(tokio::fs::metadata(home.join(SKILL_ROOT_DIR))
            .await
            .is_err());
        assert!(skills_listed(&listed(&home, &[]), &home, &[]));
        tokio::fs::remove_dir_all(&home).await.unwrap();
    }

    #[tokio::test]
    async fn refuses_tampered_bytes_mismatched_refs_and_unexpected_discovery() {
        let home = std::env::temp_dir().join(format!("kailo-skill-test-{}", Uuid::new_v4()));
        tokio::fs::create_dir_all(&home).await.unwrap();
        let home = tokio::fs::canonicalize(&home).await.unwrap();
        let mut tampered = artifact();
        tampered.bytes.push(b'x');
        assert!(
            materialize_skills(&home, Some("kailo-skills/g1"), &[tampered])
                .await
                .is_err()
        );
        assert!(materialize_skills(&home, None, &[artifact()])
            .await
            .is_err());
        assert!(materialize_skills(&home, Some("../escape"), &[artifact()])
            .await
            .is_err());
        let (_, projected) = materialize_skills(&home, Some("kailo-skills/g3"), &[artifact()])
            .await
            .unwrap();
        let mut extra = listed(&home, &projected);
        extra["data"][0]["skills"].as_array_mut().unwrap().push(json!({
            "name":"stray","path":"/etc/codex/skills/stray/SKILL.md","scope":"admin","enabled":true}));
        assert!(!skills_listed(&extra, &home, &projected));
        let mut errors = listed(&home, &projected);
        errors["data"][0]["errors"] = json!([{"path":"x","message":"invalid YAML"}]);
        assert!(!skills_listed(&errors, &home, &projected));
        let mut disabled = projected.clone();
        disabled[0].enabled = false;
        assert!(!skills_listed(&listed(&home, &projected), &home, &disabled));
        assert!(skills_listed(&listed(&home, &disabled), &home, &disabled));
        super::writable_tree(home.clone()).await.unwrap();
        tokio::fs::remove_dir_all(&home).await.unwrap();
    }
}
