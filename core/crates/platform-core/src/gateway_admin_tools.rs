//! DD-134 网关管理区：tools（见 gateway_admin.rs）。

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
};

/// 骨架：由实现批替换。
pub(crate) async fn list() -> Response {
    StatusCode::NOT_IMPLEMENTED.into_response()
}
