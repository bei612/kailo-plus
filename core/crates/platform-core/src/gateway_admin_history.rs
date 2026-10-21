//! DD-134(3)⑥：Gateway ConfigResource 的 Core 写入证据。
//!
//! ConfigResourceStore 只保存当前值与递增 revision（SF-AGW-28），因此版本历史由
//! Core 在每次写入并回读确认后自己保存。写入点以 [`scope`] 声明产生该写入的
//! ActionExecution 与 operation；没有声明的写入只记录值与 revision，不猜测归属。

use std::future::Future;

use uuid::Uuid;

tokio::task_local! {
    static EXECUTION: (Uuid, Uuid);
}

/// 在 `fut` 内发生的 Gateway ConfigResource 写入归属到该 ActionExecution 与 operation。
#[allow(dead_code)] // 骨架：写入证据实现批接入后移除
pub(crate) async fn scope<F: Future>(
    action_execution_id: Uuid,
    operation_id: Uuid,
    fut: F,
) -> F::Output {
    EXECUTION
        .scope((action_execution_id, operation_id), fut)
        .await
}

/// 当前任务声明的写入归属；未声明时为 `None`。
#[allow(dead_code)] // 骨架：写入证据实现批接入后移除
pub(crate) fn current() -> Option<(Uuid, Uuid)> {
    EXECUTION.try_with(|value| *value).ok()
}
