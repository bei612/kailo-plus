//! 构建时生成的能力目录是新 BFF 请求的准入来源（apps/06 §3）。
//! 已在途 Workflow 的 service API 不受新的 exposure 关闭影响，仍须收敛到终态。

use std::sync::OnceLock;

use serde::Deserialize;

#[derive(Deserialize)]
struct Registry {
    capabilities: Vec<Capability>,
}

#[derive(Deserialize)]
struct Capability {
    exposure: Exposure,
    routes: Vec<String>,
    actions: Vec<String>,
}

#[derive(Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum Exposure {
    None,
    Internal,
    TenantAdmin,
    EndUser,
}

static REGISTRY: OnceLock<Registry> = OnceLock::new();

fn registry() -> &'static Registry {
    REGISTRY.get_or_init(|| {
        serde_yaml::from_str(include_str!("../../../../tools/registry/capabilities.yaml"))
            .expect("能力注册表无效，拒绝开放 BFF")
    })
}

fn user_exposed(exposure: &Exposure) -> bool {
    matches!(exposure, Exposure::TenantAdmin | Exposure::EndUser)
}

pub fn route_exposed(path: &str) -> bool {
    registry()
        .capabilities
        .iter()
        .any(|cap| user_exposed(&cap.exposure) && cap.routes.iter().any(|route| route == path))
}

pub fn action_exposed(key: &str) -> bool {
    registry()
        .capabilities
        .iter()
        .any(|cap| user_exposed(&cap.exposure) && cap.actions.iter().any(|action| action == key))
}

#[cfg(test)]
mod tests {
    use super::{action_exposed, route_exposed};

    #[test]
    fn generated_registry_closes_unreleased_user_entries() {
        assert!(route_exposed("/api/v1/session"));
        assert!(route_exposed("/api/v1/platform-info"));
        assert!(action_exposed("workspace.create"));
        assert!(action_exposed("workspace.suspend"));
        assert!(action_exposed("workspace.restore"));
        assert!(!action_exposed("workspace.delete"));
        assert!(action_exposed("tenant.suspend"));
        assert!(action_exposed("tenant.restore"));
        assert!(route_exposed("/api/v1/platform/tenants"));
        assert!(route_exposed("/api/v1/identity/legacy-secret-refs"));
        assert!(action_exposed("identity.secret_ref.rehome"));
        assert!(!action_exposed("tenant.delete"));
    }
}
