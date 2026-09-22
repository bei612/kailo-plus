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
use temporalio_common::protos::temporal::api::common::v1::{Payload, Payloads, WorkflowType};
use temporalio_common::protos::temporal::api::enums::v1::{
    WorkflowIdConflictPolicy, WorkflowIdReusePolicy,
};
use temporalio_common::protos::temporal::api::taskqueue::v1::TaskQueue;
use temporalio_common::protos::temporal::api::workflowservice::v1::StartWorkflowExecutionRequest;

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
    ) -> Result<Started, TemporalError> {
        // 每次调用前刷新令牌；TokenSource 自己缓存到期前的值。
        let token = self
            .tokens
            .token()
            .await
            .map_err(|e| TemporalError::Token(e.to_string()))?;
        self.client.connection().set_api_key(Some(token));

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
                payloads: vec![Payload {
                    // Go SDK 的默认 DataConverter 按这个 metadata 认 JSON；
                    // 两侧编码不一致时 Workflow 会收到空输入而不是报错。
                    metadata: HashMap::from([("encoding".to_owned(), b"json/plain".to_vec())]),
                    data: json,
                    ..Default::default()
                }],
            }),
            identity: IDENTITY.to_owned(),
            request_id: uuid::Uuid::new_v4().to_string(),
            workflow_id_reuse_policy: WorkflowIdReusePolicy::RejectDuplicate as i32,
            workflow_id_conflict_policy: WorkflowIdConflictPolicy::Fail as i32,
            ..Default::default()
        };

        let mut svc = self.client.connection().workflow_service();
        match svc
            .start_workflow_execution(tonic::Request::new(request))
            .await
        {
            Ok(resp) => Ok(Started::Created {
                run_id: resp.into_inner().run_id,
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
}
