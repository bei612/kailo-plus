//! `contracts/` 的 Rust 绑定。
//!
//! `generated/` 由 `tools/gen` 从 `contracts/**/*.schema.json` 写出，不手工编辑。
//! 本 crate 只再导出生成物并提供两者共用的封闭错误分类。
//! 与 `contracts/` 冲突时以 `contracts/` 为准（ADR-02、ADR-03）。

pub mod generated;

/// `06-工程基线规范.md` §4 的六类。每个 API 错误、Workflow 失败与 UI 状态
/// 必须落在其中之一。`Unknown` 是未知值降级的落点，禁止当作成功或失败处理。
#[non_exhaustive]
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorClass {
    Denied,
    Blocked,
    Precondition,
    Limit,
    Conflict,
    Unknown,
}

impl ErrorClass {
    /// 是否允许自动重试。`Unknown` 明确不允许——它等待对账，盲目重放会产生重复副作用。
    pub fn auto_retryable(&self) -> bool {
        matches!(self, ErrorClass::Precondition)
    }
}
