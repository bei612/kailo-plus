//! Core 到 Temporal 的 Start 面（`.design/06` §3.1、`DD-48`）。
//!
//! Core 在 Start 之前持久化唯一 `WorkflowRef`，workflow ID 固定为
//! `kailo:<kind>:<tenant_id>:<primary_entity_id>:<entity_version>`——这让
//! 「不分配第二个业务 workflow ID」可被机械校验，而不是靠调用方自觉。
//!
//! 用官方 Rust 客户端（`temporalio/sdk-rust` 的 `temporalio-client`）走 gRPC。
//! Workflow 的实现在 Go Worker 里，Rust 侧没有对应的类型定义，因此走
//! `WorkflowService::start_workflow_execution` 这条按类型名启动的原始接口，
//! 而不是需要 `HasWorkflowDefinition` 的类型化包装。

use std::collections::{HashMap, HashSet};

use temporalio_client::{tonic, Client, ClientOptions, ConnectionOptions, Url};
use temporalio_common::protos::temporal::api::common::v1::{
    Payload, Payloads, SearchAttributes, WorkflowExecution, WorkflowType,
};
use temporalio_common::protos::temporal::api::enums::v1::{
    WorkflowExecutionStatus, WorkflowIdConflictPolicy, WorkflowIdReusePolicy,
};
use temporalio_common::protos::temporal::api::history::v1::history_event::Attributes;
use temporalio_common::protos::temporal::api::taskqueue::v1::TaskQueue;
use temporalio_common::protos::temporal::api::workflowservice::v1::{
    DescribeNamespaceRequest, DescribeWorkflowExecutionRequest, GetWorkflowExecutionHistoryRequest,
    RequestCancelWorkflowExecutionRequest, StartWorkflowExecutionRequest,
};

use crate::oidc::TokenSource;

/// 调用方标识。它出现在 Temporal 的 history 与 task 归属里，用来分辨
/// 「谁启动的」——Core 与 Worker 必须不同，否则运维面看不出区别。
const IDENTITY: &str = "kailo-core";

#[derive(Debug, thiserror::Error)]
pub enum TemporalError {
    #[error("取服务令牌失败: {0}")]
    Token(String),
    #[error("Start 被拒绝: {0}")]
    Rejected(String),
    #[error("Start 结果不明: {0}")]
    Unknown(String),
    #[error("输入不可序列化: {0}")]
    Encode(String),
}

/// Start 的结果。
pub enum Started {
    /// 本次调用创建了 execution
    Created { run_id: String },
    /// 同一 workflow ID 的 execution 已存在。
    ///
    /// 这不是失败：该错误恰好证明目标状态已经成立，重试 Start 只会再撞一次。
    /// 不换 ID 重试——换 ID 就是分配了第二个业务 workflow ID（`DD-48`）。
    AlreadyStarted,
}

/// Describe 观察到的一个 execution。
pub struct Observed {
    pub run_id: String,
    /// Server 给出的 execution chain 首次 run；用于 cancel 跨 continue-as-new
    /// 定位同一链，不能用当前 run ID 冒充。
    pub first_run_id: String,
    pub history_length: i64,
    pub state: ObservedState,
}

pub enum ObservedState {
    /// 仍在运行（含 Paused：暂停不是终态）
    Open,
    /// 已终结，映射到 TaskProjection 的封闭枚举
    Closed(contracts::TaskStatus),
    /// Server 返回了本客户端不认识的状态值。不猜：既不当运行也不当终态
    Unrecognized(i32),
}

/// 本 namespace 固定登记的三个 Keyword Search Attribute（`.design/06` §2）。
pub const SA_TENANT: &str = "KailoTenantId";
pub const SA_KIND: &str = "KailoWorkflowKind";

pub struct TemporalClient {
    client: Client,
    namespace: String,
    task_queue: String,
    tokens: TokenSource,
}

impl TemporalClient {
    /// 四项配置都不接受默认值。namespace 尤其不能猜：Temporal 的 default claim
    /// mapper 按 `"<namespace>:<role>"` 解析 permissions，写错即全部调用被拒，
    /// 而错误信息离真正的原因很远（`SF-TMP-06`）。
    pub async fn from_env(tokens: TokenSource) -> Result<Self, String> {
        let get = |k: &str| std::env::var(k).map_err(|_| format!("缺少 {k}"));
        let target = get("TEMPORAL_TARGET_URL")?;
        let namespace = get("TEMPORAL_NAMESPACE")?;
        let task_queue = get("TEMPORAL_TASK_QUEUE")?;

        let url = Url::parse(&target).map_err(|e| format!("TEMPORAL_TARGET_URL 无法解析: {e}"))?;
        let connection = ConnectionOptions::new(url)
            .identity(IDENTITY)
            // 先放一张令牌，之后每次调用前刷新——本部署签发 900 秒，
            // 连接期持一张静态令牌只是把失败推迟到第一次续期之后。
            .api_key(tokens.token().await.map_err(|e| e.to_string())?)
            .build();
        let client = Client::connect(connection, ClientOptions::new(&namespace).build())
            .await
            .map_err(|e| format!("连接 Temporal 失败: {e}"))?;
        Ok(Self {
            client,
            namespace,
            task_queue,
            tokens,
        })
    }

    /// 以固定的 workflow ID 至多一次启动。
    ///
    /// 三项策略必须同时给全（`SF-TSDK-10`、`DD-48`）：SDK 每次 Start 都填新的
    /// `request_id`，Server 的 request-ID 去重因此指望不上；缺任一项都会让重复
    /// Start 产生第二个 execution。
    pub async fn start(
        &self,
        workflow_id: &str,
        workflow_type: &str,
        input: &impl serde::Serialize,
        search_attributes: &[(&str, &str)],
    ) -> Result<Started, TemporalError> {
        self.refresh_token().await?;

        let json = serde_json::to_vec(input).map_err(|e| TemporalError::Encode(e.to_string()))?;
        let request = StartWorkflowExecutionRequest {
            namespace: self.namespace.clone(),
            workflow_id: workflow_id.to_owned(),
            workflow_type: Some(WorkflowType {
                name: workflow_type.to_owned(),
            }),
            task_queue: Some(TaskQueue {
                name: self.task_queue.clone(),
                ..Default::default()
            }),
            input: Some(Payloads {
                payloads: vec![raw_json_payload(json)],
            }),
            // 运维按 Tenant 或 kind 检索 execution 的唯一入口；投影字段只在
            // Core 的 TaskProjection 里，不做 Search Attribute（06 §2）。
            search_attributes: Some(SearchAttributes {
                indexed_fields: search_attributes
                    .iter()
                    .map(|(k, v)| ((*k).to_owned(), json_payload(v)))
                    .collect(),
            }),
            identity: IDENTITY.to_owned(),
            request_id: uuid::Uuid::new_v4().to_string(),
            workflow_id_reuse_policy: WorkflowIdReusePolicy::RejectDuplicate as i32,
            workflow_id_conflict_policy: WorkflowIdConflictPolicy::Fail as i32,
            ..Default::default()
        };

        let result = self
            .with_auth_retry(|mut svc| {
                let request = request.clone();
                async move {
                    svc.start_workflow_execution(tonic::Request::new(request))
                        .await
                }
            })
            .await;
        match result {
            Ok(resp) => Ok(Started::Created {
                run_id: resp.run_id,
            }),
            Err(status) => {
                // AlreadyExists 就是「同一 ID 的 execution 已存在」。把它当成功
                // 而不是失败：它恰好证明目标状态成立。
                if status.code() == tonic::Code::AlreadyExists {
                    return Ok(Started::AlreadyStarted);
                }
                // 其余按可重试与否分开：InvalidArgument 一类重试多少次都一样，
                // 而超时与不可用是结果不明——此时只能用同一 ID 去 Describe，
                // 绝不能换 ID 重试（DD-48）。
                match status.code() {
                    tonic::Code::InvalidArgument
                    | tonic::Code::PermissionDenied
                    | tonic::Code::NotFound
                    | tonic::Code::FailedPrecondition => {
                        Err(TemporalError::Rejected(status.message().to_owned()))
                    }
                    _ => Err(TemporalError::Unknown(format!(
                        "{}: {}",
                        status.code(),
                        status.message()
                    ))),
                }
            }
        }
    }

    /// 向已观察为 OPEN 的固定 workflow ID 请求取消。run ID 留空让 Temporal
    /// 选择该 ID 的当前 run：Describe 与请求之间发生 continue-as-new 时，固定旧
    /// run ID 会得到「旧 run 已结束」的 no-op 成功，漏掉仍在运行的新 run。
    /// RPC 成功也会是目标已终结或已有取消请求的 no-op；只有同一控制 ID
    /// 的 history 事件才证明本次请求已记录，更不代表 Workflow 已取消
    /// （SF-TMP-01/11、DD-84）。
    /// request_id 固定取控制 ActionExecution ID，同一动作重试不产生新请求身份。
    pub async fn request_cancel(
        &self,
        workflow_id: &str,
        first_run_id: &str,
        action_execution_id: uuid::Uuid,
    ) -> Result<(), TemporalError> {
        if first_run_id.is_empty() {
            return Err(TemporalError::Encode("Temporal 首次 run ID 为空".into()));
        }
        self.refresh_token().await?;
        let request = RequestCancelWorkflowExecutionRequest {
            namespace: self.namespace.clone(),
            workflow_execution: Some(WorkflowExecution {
                workflow_id: workflow_id.to_owned(),
                run_id: String::new(),
            }),
            identity: IDENTITY.to_owned(),
            request_id: action_execution_id.to_string(),
            // Server 在最新 run 上校验同一 execution chain。若原链已结束，
            // 即便同 workflow ID 被外部重用，也不能取消另一条链。
            first_execution_run_id: first_run_id.to_owned(),
            reason: action_execution_id.to_string(),
            ..Default::default()
        };
        match self
            .with_auth_retry(|mut svc| {
                let request = request.clone();
                async move {
                    svc.request_cancel_workflow_execution(tonic::Request::new(request))
                        .await
                }
            })
            .await
        {
            Ok(_) => Ok(()),
            Err(status)
                if matches!(
                    status.code(),
                    tonic::Code::InvalidArgument
                        | tonic::Code::PermissionDenied
                        | tonic::Code::NotFound
                        | tonic::Code::FailedPrecondition
                ) =>
            {
                Err(TemporalError::Rejected(status.message().to_owned()))
            }
            Err(status) => Err(TemporalError::Unknown(format!(
                "{}: {}",
                status.code(),
                status.message()
            ))),
        }
    }

    /// 只认 Temporal history 中由本控制 ActionExecution 留下的取消请求事件。
    /// 从冻结的首次 run 顺着 continue-as-new/retry 链逐页查；查不到不是「未发出」：
    /// Server 对已取消请求和已终结 execution 会成功 no-op，二者均不写新事件。
    /// history 过期、分页异常或原始事件不可解码时也绝不推断为成功。
    pub async fn cancel_request_recorded(
        &self,
        workflow_id: &str,
        first_run_id: &str,
        action_execution_id: uuid::Uuid,
    ) -> Result<bool, TemporalError> {
        if first_run_id.is_empty() {
            return Err(TemporalError::Encode("取消请求缺冻结的首次 run ID".into()));
        }
        self.refresh_token().await?;
        let mut run_id = first_run_id.to_owned();
        let mut visited_runs = HashSet::new();
        loop {
            if !visited_runs.insert(run_id.clone()) {
                return Err(TemporalError::Unknown(
                    "Temporal execution 链出现循环".into(),
                ));
            }
            let mut page_token = Vec::new();
            let mut visited_pages = HashSet::new();
            let mut next_run = None;
            loop {
                let request = GetWorkflowExecutionHistoryRequest {
                    namespace: self.namespace.clone(),
                    execution: Some(WorkflowExecution {
                        workflow_id: workflow_id.to_owned(),
                        run_id: run_id.clone(),
                    }),
                    next_page_token: page_token.clone(),
                    ..Default::default()
                };
                let response = self
                    .with_auth_retry(|mut svc| {
                        let request = request.clone();
                        async move {
                            svc.get_workflow_execution_history(tonic::Request::new(request))
                                .await
                        }
                    })
                    .await
                    .map_err(|e| TemporalError::Unknown(format!("读取取消 history 失败: {e}")))?;
                if !response.raw_history.is_empty() {
                    return Err(TemporalError::Unknown(
                        "取消 history 只返回未经解码的事件".into(),
                    ));
                }
                let history = response
                    .history
                    .ok_or_else(|| TemporalError::Unknown("取消 history 响应缺事件集".into()))?;
                if history.events.is_empty() && page_token.is_empty() {
                    return Err(TemporalError::Unknown("取消 history 首次查询为空".into()));
                }
                for event in history.events {
                    match event.attributes {
                        Some(Attributes::WorkflowExecutionCancelRequestedEventAttributes(a))
                            if a.cause == action_execution_id.to_string()
                                && a.identity == IDENTITY =>
                        {
                            return Ok(true);
                        }
                        Some(Attributes::WorkflowExecutionContinuedAsNewEventAttributes(a)) => {
                            next_run = Some(a.new_execution_run_id);
                        }
                        Some(Attributes::WorkflowExecutionFailedEventAttributes(a))
                            if !a.new_execution_run_id.is_empty() =>
                        {
                            next_run = Some(a.new_execution_run_id);
                        }
                        Some(Attributes::WorkflowExecutionTimedOutEventAttributes(a))
                            if !a.new_execution_run_id.is_empty() =>
                        {
                            next_run = Some(a.new_execution_run_id);
                        }
                        Some(Attributes::WorkflowExecutionCompletedEventAttributes(a))
                            if !a.new_execution_run_id.is_empty() =>
                        {
                            next_run = Some(a.new_execution_run_id);
                        }
                        _ => {}
                    }
                }
                if response.next_page_token.is_empty() {
                    break;
                }
                if !visited_pages.insert(response.next_page_token.clone()) {
                    return Err(TemporalError::Unknown("取消 history 分页游标循环".into()));
                }
                page_token = response.next_page_token;
            }
            match next_run {
                Some(next) if !next.is_empty() => run_id = next,
                Some(_) => {
                    return Err(TemporalError::Unknown(
                        "Temporal execution 链的下一 run ID 为空".into(),
                    ));
                }
                None => return Ok(false),
            }
        }
    }

    /// 执行一次调用；对端以认证失败拒绝时丢弃缓存令牌、重取后再试一次。
    ///
    /// IdP 轮换签名密钥后，缓存里那张令牌永远不会再被接受；不这样做，Core 会一直
    /// 失败到令牌自然过期为止。第二次仍被拒就是真的无权，原样返回。
    async fn with_auth_retry<T, F, Fut>(&self, call: F) -> Result<T, tonic::Status>
    where
        F: Fn(Box<dyn temporalio_client::grpc::WorkflowService>) -> Fut,
        Fut: std::future::Future<Output = Result<tonic::Response<T>, tonic::Status>>,
    {
        for attempt in 0..2 {
            let result = call(self.client.connection().workflow_service()).await;
            match result {
                Err(status)
                    if attempt == 0
                        && matches!(
                            status.code(),
                            tonic::Code::Unauthenticated | tonic::Code::PermissionDenied
                        ) =>
                {
                    self.tokens.invalidate().await;
                    self.refresh_token()
                        .await
                        .map_err(|e| tonic::Status::unavailable(e.to_string()))?;
                }
                other => return other.map(tonic::Response::into_inner),
            }
        }
        unreachable!("第二次尝试总会返回")
    }

    async fn refresh_token(&self) -> Result<(), TemporalError> {
        // 每次调用前刷新令牌；TokenSource 自己缓存到期前的值。
        let token = self
            .tokens
            .token()
            .await
            .map_err(|e| TemporalError::Token(e.to_string()))?;
        self.client.connection().set_api_key(Some(token));
        Ok(())
    }

    /// 按固定 workflow ID 观察最新一次 run（`DD-48`：结果不明时只用该 ID 查）。
    ///
    /// `Ok(None)` 是 Server 明确答复 NotFound。它**不等于**「未启动」：已终结
    /// 且超出 retention 的 execution 同样 NotFound，解释交给调用方按 WorkflowRef
    /// 的创建时间与 retention 判断（`SF-TMP-07`）。
    pub async fn describe(&self, workflow_id: &str) -> Result<Option<Observed>, TemporalError> {
        self.refresh_token().await?;
        let request = DescribeWorkflowExecutionRequest {
            namespace: self.namespace.clone(),
            execution: Some(WorkflowExecution {
                workflow_id: workflow_id.to_owned(),
                run_id: String::new(),
            }),
        };
        let info = match self
            .with_auth_retry(|mut svc| {
                let request = request.clone();
                async move {
                    svc.describe_workflow_execution(tonic::Request::new(request))
                        .await
                }
            })
            .await
        {
            Ok(resp) => resp.workflow_execution_info,
            Err(status) if status.code() == tonic::Code::NotFound => return Ok(None),
            Err(status) => {
                return Err(TemporalError::Unknown(format!(
                    "{}: {}",
                    status.code(),
                    status.message()
                )))
            }
        };
        let info = info.ok_or_else(|| TemporalError::Unknown("Describe 响应缺执行信息".into()))?;
        use contracts::TaskStatus as T;
        let state = match WorkflowExecutionStatus::try_from(info.status) {
            Ok(WorkflowExecutionStatus::Running | WorkflowExecutionStatus::Paused) => {
                ObservedState::Open
            }
            Ok(WorkflowExecutionStatus::Completed) => ObservedState::Closed(T::Completed),
            Ok(WorkflowExecutionStatus::Failed) => ObservedState::Closed(T::Failed),
            Ok(WorkflowExecutionStatus::Canceled) => ObservedState::Closed(T::Canceled),
            Ok(WorkflowExecutionStatus::Terminated) => ObservedState::Closed(T::Terminated),
            Ok(WorkflowExecutionStatus::TimedOut) => ObservedState::Closed(T::TimedOut),
            // 按 ID Describe 取的是最新一次 run，ContinuedAsNew 不该出现在这里；
            // 出现了就是不认识的情形，与未知值同样不猜
            _ => ObservedState::Unrecognized(info.status),
        };
        Ok(Some(Observed {
            run_id: info.execution.map(|e| e.run_id).unwrap_or_default(),
            first_run_id: info.first_run_id,
            history_length: info.history_length,
            state,
        }))
    }

    /// 向一个运行中的 Workflow 发 Update 并等到它在 Worker 上执行完毕。
    ///
    /// Update ID 由调用方按设计固定（`.design/06` §4：决定为
    /// `<approval_workflow_id>:<approver_principal_id>`，消费为
    /// `<action_execution_id>:consume`），Server 按它去重：同一 ID 的重发拿回第一次
    /// 的结果，而不是再执行一次。
    ///
    /// 三种结论分开：`Completed` 是 handler 返回的值；`Rejected` 是 Validator 或
    /// handler 以 ApplicationError 拒绝，`reason` 取其 type（Worker 侧固定填
    /// contracts 的 reason code）；Workflow 已终结或不存在同样是确定的拒绝。
    /// 其余——超时、不可用、等到 `wait` 仍未完成——一律 `Unknown`，调用方只能以同一
    /// Update ID 再问，不能当成成功或失败。
    pub async fn update(
        &self,
        workflow_id: &str,
        update_id: &str,
        name: &str,
        arg: Option<serde_json::Value>,
        wait: std::time::Duration,
    ) -> Result<UpdateOutcome, TemporalError> {
        use temporalio_common::protos::temporal::api::enums::v1::UpdateWorkflowExecutionLifecycleStage as Stage;
        use temporalio_common::protos::temporal::api::update::v1::{
            Input, Meta, Request, UpdateRef, WaitPolicy,
        };
        use temporalio_common::protos::temporal::api::workflowservice::v1::{
            PollWorkflowExecutionUpdateRequest, UpdateWorkflowExecutionRequest,
        };
        self.refresh_token().await?;
        // 无参数的 Update（consume、withdraw）不带 payload：Go 侧 handler 没有参数，
        // 多给一个会在解码时被拒
        let payloads = match arg {
            Some(v) => vec![raw_json_payload(
                serde_json::to_vec(&v).map_err(|e| TemporalError::Encode(e.to_string()))?,
            )],
            None => vec![],
        };
        let execution = WorkflowExecution {
            workflow_id: workflow_id.to_owned(),
            run_id: String::new(),
        };
        let wait_policy = WaitPolicy {
            lifecycle_stage: Stage::Completed as i32,
        };
        let request = UpdateWorkflowExecutionRequest {
            namespace: self.namespace.clone(),
            workflow_execution: Some(execution.clone()),
            wait_policy: Some(wait_policy),
            request: Some(Request {
                meta: Some(Meta {
                    update_id: update_id.to_owned(),
                    identity: IDENTITY.to_owned(),
                }),
                input: Some(Input {
                    name: name.to_owned(),
                    args: Some(Payloads { payloads }),
                    ..Default::default()
                }),
                ..Default::default()
            }),
            ..Default::default()
        };
        let deadline = tokio::time::Instant::now() + wait;
        let first = tokio::time::timeout_at(
            deadline,
            self.with_auth_retry(|mut svc| {
                let request = request.clone();
                async move {
                    svc.update_workflow_execution(tonic::Request::new(request))
                        .await
                }
            }),
        )
        .await;
        let mut outcome = match first {
            Err(_) => return Err(TemporalError::Unknown("Update 在等待上界内未返回".into())),
            Ok(Ok(resp)) => resp.outcome,
            Ok(Err(status)) => return Err(update_status(status)),
        };
        // Server 的长轮询有自己的上界：返回时可能只到 ACCEPTED。按同一 Update ID
        // 继续问，直到有结果或到达调用方给的等待上界。
        while outcome.is_none() {
            let poll = PollWorkflowExecutionUpdateRequest {
                namespace: self.namespace.clone(),
                update_ref: Some(UpdateRef {
                    workflow_execution: Some(execution.clone()),
                    update_id: update_id.to_owned(),
                }),
                identity: IDENTITY.to_owned(),
                wait_policy: Some(wait_policy),
            };
            outcome = match tokio::time::timeout_at(
                deadline,
                self.with_auth_retry(|mut svc| {
                    let poll = poll.clone();
                    async move {
                        svc.poll_workflow_execution_update(tonic::Request::new(poll))
                            .await
                    }
                }),
            )
            .await
            {
                Err(_) => return Err(TemporalError::Unknown("Update 在等待上界内未完成".into())),
                Ok(Ok(resp)) => resp.outcome,
                Ok(Err(status)) => return Err(update_status(status)),
            };
        }
        use temporalio_common::protos::temporal::api::failure::v1::failure::FailureInfo;
        use temporalio_common::protos::temporal::api::update::v1::outcome::Value;
        match outcome.and_then(|o| o.value) {
            Some(Value::Success(payloads)) => {
                let data = payloads
                    .payloads
                    .into_iter()
                    .next()
                    .map(|p| p.data)
                    .unwrap_or_default();
                serde_json::from_slice(&data)
                    .map(UpdateOutcome::Completed)
                    .map_err(|e| TemporalError::Unknown(format!("Update 结果不可解析: {e}")))
            }
            Some(Value::Failure(f)) => Ok(UpdateOutcome::Rejected {
                reason: match f.failure_info {
                    Some(FailureInfo::ApplicationFailureInfo(a)) => a.r#type,
                    _ => String::new(),
                },
                message: f.message,
            }),
            None => Err(TemporalError::Unknown("Update 结果为空".into())),
        }
    }

    /// namespace 的 retention。它是 Server 上的运行时事实，不另配一份：两处
    /// 不一致时，NotFound 的解释会错到「把已过期的当成未启动」而重复执行。
    pub async fn retention(&self) -> Result<std::time::Duration, TemporalError> {
        self.refresh_token().await?;
        let request = DescribeNamespaceRequest {
            namespace: self.namespace.clone(),
            ..Default::default()
        };
        let resp = self
            .with_auth_retry(|mut svc| {
                let request = request.clone();
                async move { svc.describe_namespace(tonic::Request::new(request)).await }
            })
            .await
            .map_err(|s| TemporalError::Unknown(format!("{}: {}", s.code(), s.message())))?;
        let ttl = resp
            .config
            .and_then(|c| c.workflow_execution_retention_ttl)
            .ok_or_else(|| TemporalError::Unknown("namespace 未返回 retention".into()))?;
        Ok(std::time::Duration::new(
            u64::try_from(ttl.seconds).unwrap_or(0),
            u32::try_from(ttl.nanos).unwrap_or(0),
        ))
    }
}

/// Update 的确定结论。
pub enum UpdateOutcome {
    /// handler 执行完毕并返回的值
    Completed(serde_json::Value),
    /// Validator 或 handler 拒绝；`reason` 是 Worker 填入的 ApplicationError type
    Rejected { reason: String, message: String },
}

/// Update 调用的 gRPC 错误分类。Workflow 已终结或不存在是确定的拒绝——此时它
/// 再也不会处理任何 Update；其余是结果不明。
fn update_status(status: tonic::Status) -> TemporalError {
    match status.code() {
        tonic::Code::NotFound | tonic::Code::FailedPrecondition | tonic::Code::InvalidArgument => {
            TemporalError::Rejected(status.message().to_owned())
        }
        _ => TemporalError::Unknown(format!("{}: {}", status.code(), status.message())),
    }
}

/// Go SDK 的默认 DataConverter 按 `encoding: json/plain` 认 JSON；两侧编码不
/// 一致时 Workflow 收到的是空输入而不是错误。
fn raw_json_payload(data: Vec<u8>) -> Payload {
    Payload {
        metadata: HashMap::from([("encoding".to_owned(), b"json/plain".to_vec())]),
        data,
        ..Default::default()
    }
}

fn json_payload(value: &str) -> Payload {
    raw_json_payload(serde_json::to_vec(value).unwrap_or_default())
}
