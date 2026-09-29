//! Buzz 适配层。它把平台固定上下文映射到 Relay 的 native API，
//! 不拥有 Tenant、Workspace、owner、permission、Workflow 或账本
//! （`01-工程结构与模块边界.md` §6）。

pub mod bridge;
pub mod operator;
pub mod stream;
