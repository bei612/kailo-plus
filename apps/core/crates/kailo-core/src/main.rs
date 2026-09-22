//! Platform Core/BFF 入口。
//!
//! 单一部署单元、单一业务事务边界（`AGENTS.md` 规则 6）。
//! 模块按 `01-工程结构与模块边界.md` §3 以 crate 与可见性划分，不走网络、不引消息总线。

fn main() {
    println!("kailo-core {}", env!("CARGO_PKG_VERSION"));
}
