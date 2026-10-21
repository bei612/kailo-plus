//! DD-134 网关管理区：mcp（见 gateway_admin.rs）。

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
};

/// 骨架：由实现批替换。
pub(crate) async fn releases() -> Response {
    StatusCode::NOT_IMPLEMENTED.into_response()
}

/// 骨架：由实现批替换。
pub(crate) async fn binding_draft() -> Response {
    StatusCode::NOT_IMPLEMENTED.into_response()
}

/// 骨架：由实现批替换。
pub(crate) async fn peers() -> Response {
    StatusCode::NOT_IMPLEMENTED.into_response()
}
