//! DD-134 网关管理区：config（见 gateway_admin.rs）。

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
};

/// 骨架：由实现批替换。
pub(crate) async fn view() -> Response {
    StatusCode::NOT_IMPLEMENTED.into_response()
}

/// 骨架：由实现批替换。
pub(crate) async fn history() -> Response {
    StatusCode::NOT_IMPLEMENTED.into_response()
}
