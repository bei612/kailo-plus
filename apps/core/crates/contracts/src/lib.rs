//! `contracts/` 的 Rust 绑定。
//!
//! `generated/` 由 `tools/gen` 从 `contracts/**/*.schema.json` 写出，不手工编辑。
//! 本 crate 只再导出生成物，自身不定义任何类型——手写类型即违反 ADR-02。
//! 与 `contracts/` 冲突时以 `contracts/` 为准（ADR-02、ADR-03）。

pub mod generated;

pub use generated::ErrorClass;
