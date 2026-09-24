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

use std::collections::HashMap;

use temporalio_client::{tonic, Client, ClientOptions, ConnectionOptions, Url};
use temporalio_common::protos::temporal::api::common::v1::{
    Payload, Payloads, SearchAttributes, WorkflowExecution, WorkflowType,
};
use temporalio_common::protos::temporal::api::enums::v1::{
    WorkflowExecutionStatus, WorkflowIdConflictPolicy, WorkflowIdReusePolicy,
};
use temporalio_common::protos::temporal::api::taskqueue::v1::TaskQueue;
use temporalio_common::protos::temporal::api::workflowservice::v1::{
    DescribeNamespaceRequest, DescribeWorkflowExecutionRequest, StartWorkflowExecutionRequest,
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
            history_length: info.history_length,
            state,
        }))
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
