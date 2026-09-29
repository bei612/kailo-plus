//! 部署事实：原生入口地址、IdP issuer 与原生端 client id。
//!
//! 它们因部署而异，不编进产物：保存在应用配置目录的 `kailo.json`，由首次启动
//! 时填写或由管理员预置。缺任一项即视为未配置，不回退到任何默认地址——猜一个
//! 地址就是把登录与设备密钥交给了一个未经确认的服务。

use serde::{Deserialize, Serialize};
use tauri::Manager;
use url::Url;

const FILE: &str = "kailo.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct KailoConfig {
    /// 网关原生入口的根地址，例如 `https://kailo.example.com:8091`
    pub native_api_url: String,
    /// IdP 的 issuer，discovery 文档取自 `{issuer}/.well-known/openid-configuration`
    pub oidc_issuer: String,
    /// 在 IdP 登记的原生端公开客户端
    pub oidc_client_id: String,
}

impl KailoConfig {
    pub(crate) fn validate(&self) -> Result<(), String> {
        for (name, value) in [
            ("原生入口地址", &self.native_api_url),
            ("IdP issuer", &self.oidc_issuer),
        ] {
            let url = Url::parse(value).map_err(|e| format!("{name}不是合法的 URL：{e}"))?;
            if !matches!(url.scheme(), "https" | "http") {
                return Err(format!("{name}必须是 http 或 https 地址"));
            }
            if url.query().is_some() || url.fragment().is_some() {
                return Err(format!("{name}不能带查询串或片段"));
            }
        }
        if self.oidc_client_id.trim().is_empty() {
            return Err("client id 不能为空".to_owned());
        }
        Ok(())
    }

    pub(crate) fn api_url(&self, path: &str) -> Result<Url, String> {
        Url::parse(&format!(
            "{}{path}",
            self.native_api_url.trim_end_matches('/')
        ))
        .map_err(|e| format!("原生入口地址无效：{e}"))
    }
}

fn path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法定位应用配置目录：{e}"))?
        .join(FILE))
}

pub(crate) fn load(app: &tauri::AppHandle) -> Result<Option<KailoConfig>, String> {
    let path = path(app)?;
    match std::fs::read_to_string(&path) {
        Ok(raw) => {
            let cfg: KailoConfig =
                serde_json::from_str(&raw).map_err(|e| format!("{} 无法解析：{e}", path.display()))?;
            cfg.validate()?;
            Ok(Some(cfg))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("读取 {} 失败：{e}", path.display())),
    }
}

pub(crate) fn save(app: &tauri::AppHandle, cfg: &KailoConfig) -> Result<(), String> {
    cfg.validate()?;
    let path = path(app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("创建配置目录失败：{e}"))?;
    }
    let raw = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(&path, raw).map_err(|e| format!("写入 {} 失败：{e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(native: &str, issuer: &str, client: &str) -> KailoConfig {
        KailoConfig {
            native_api_url: native.to_owned(),
            oidc_issuer: issuer.to_owned(),
            oidc_client_id: client.to_owned(),
        }
    }

    #[test]
    fn rejects_non_http_and_empty_client() {
        assert!(cfg("https://k.example", "https://idp.example/realms/k", "native")
            .validate()
            .is_ok());
        assert!(cfg("ftp://k.example", "https://idp.example", "native").validate().is_err());
        assert!(cfg("https://k.example?x=1", "https://idp.example", "native").validate().is_err());
        assert!(cfg("https://k.example", "https://idp.example", "  ").validate().is_err());
    }

    #[test]
    fn api_url_joins_without_double_slash() {
        let c = cfg("https://k.example:8091/", "https://idp.example", "native");
        assert_eq!(
            c.api_url("/api/v1/session").unwrap().as_str(),
            "https://k.example:8091/api/v1/session"
        );
    }
}
