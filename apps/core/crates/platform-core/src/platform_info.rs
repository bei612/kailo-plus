//! 平台公开信息（DD-111）。
//!
//! 界面上的产品名只有一个来源：部署配置 `PLATFORM_DISPLAY_NAME`。源码、i18n 与
//! 客户端包里都不写产品名，三端从这里读取同一个值。读取不解析身份、不建立
//! PlatformSession——它只含公开展示字段；但它仍在网关入口的认证之后，不另开
//! 无认证入口（浏览器入口的 OIDC 与原生入口的 Bearer 都挂在 listener 上）。

use axum::{extract::State, response::IntoResponse, Json};
use contracts::PlatformInfo;

use crate::bff::BffState;

/// 从部署配置读出平台公开信息。缺失、为空或只有空白即拒绝启动（DD-111）：
/// 回退一个默认名就是把产品名写回了源码。
pub fn from_env() -> Result<PlatformInfo, String> {
    parse(std::env::var("PLATFORM_DISPLAY_NAME").ok().as_deref())
}

fn parse(raw: Option<&str>) -> Result<PlatformInfo, String> {
    let raw = raw.ok_or("缺少 PLATFORM_DISPLAY_NAME")?;
    let display_name = raw.trim();
    if display_name.is_empty() {
        return Err("PLATFORM_DISPLAY_NAME 不能为空或仅含空白".into());
    }
    if display_name.chars().any(char::is_control) {
        return Err("PLATFORM_DISPLAY_NAME 不能含控制字符".into());
    }
    Ok(PlatformInfo {
        display_name: display_name.to_owned(),
    })
}

pub async fn get(State(state): State<BffState>) -> impl IntoResponse {
    Json(state.platform_info.as_ref().clone())
}

#[cfg(test)]
mod tests {
    use super::parse;

    #[test]
    fn display_name_is_required_and_trimmed() {
        assert!(parse(None).is_err());
        for blank in ["", " \t ", "\u{3000}"] {
            assert!(parse(Some(blank)).is_err(), "{blank:?} 应被拒绝");
        }
        assert!(parse(Some("协作\n平台")).is_err());
        assert_eq!(
            parse(Some("  协作 < & \"  ")).unwrap().display_name,
            "协作 < & \""
        );
    }
}
