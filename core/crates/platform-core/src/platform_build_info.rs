//! Current deployed capabilities for the original ComponentRelease approval.
//! No catalog of user-entered build claims and no fallback build identity.

use serde_json::{json, Value};

use crate::governance::Refusal;

fn unavailable() -> Refusal {
    Refusal::Unavailable("deployed platform build capabilities unavailable".into())
}

fn source_commit(value: &str) -> bool {
    value.len() == 40 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn core_build() -> Result<Value, Refusal> {
    let build = option_env!("PLATFORM_BUILD_ID")
        .filter(|value| source_commit(value))
        .ok_or_else(unavailable)?;
    // These are the actually implemented protocol/registry entries. Unsupported
    // Host API, embedded drivers and platform-port releases remain unavailable.
    Ok(
        json!({"subject":"CORE", "buildId":build, "hostApiVersion":"NONE",
        "adapterProtocolVersions":["1"], "driverRegistryKeys":[], "platformPortKeys":[],
        "reportedAt":chrono::Utc::now().to_rfc3339()}),
    )
}

pub(crate) async fn observe(worker: &Value) -> Result<Value, Refusal> {
    let core = core_build()?;
    let worker: contracts::PlatformBuildInfo =
        serde_json::from_value(worker.clone()).map_err(|_| unavailable())?;
    let worker = serde_json::to_value(worker).map_err(|_| unavailable())?;
    if worker["subject"] != "WORKER" || !worker["buildId"].as_str().is_some_and(source_commit) {
        return Err(unavailable());
    }
    let url = std::env::var("BUZZ_WEB_BUILD_INFO_URL").map_err(|_| unavailable())?;
    let url = reqwest::Url::parse(&url).map_err(|_| unavailable())?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || url.query().is_some()
    {
        return Err(unavailable());
    }
    let timeout = std::env::var("COMPONENT_BUILD_INFO_TIMEOUT_SECONDS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .ok_or_else(unavailable)?;
    let limit = std::env::var("COMPONENT_BUILD_INFO_MAX_BYTES")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|value| *value > 0)
        .ok_or_else(unavailable)?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(timeout))
        .build()
        .map_err(|_| unavailable())?;
    let mut response = client
        .get(url)
        .header(reqwest::header::CACHE_CONTROL, "no-cache")
        .send()
        .await
        .map_err(|_| unavailable())?;
    if !response.status().is_success()
        || response
            .content_length()
            .is_some_and(|length| length > limit as u64)
    {
        return Err(unavailable());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| unavailable())? {
        if chunk.len() > limit.saturating_sub(bytes.len()) {
            return Err(unavailable());
        }
        bytes.extend_from_slice(&chunk);
    }
    let web: contracts::PlatformBuildInfo =
        serde_json::from_slice(&bytes).map_err(|_| unavailable())?;
    let web = serde_json::to_value(web).map_err(|_| unavailable())?;
    let build = web["buildId"].as_str().ok_or_else(unavailable)?;
    if web["subject"] != "BUZZ_WEB"
        || !build.strip_prefix("sha256:").is_some_and(|value| {
            value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
        })
    {
        return Err(unavailable());
    }
    Ok(json!([web, core, worker]))
}

pub(crate) fn compatible(manifest: &Value, builds: &Value) -> Result<(), Refusal> {
    let builds = builds.as_array().ok_or_else(unavailable)?;
    if builds.len() != 3 {
        return Err(unavailable());
    }
    // Approval currently consumes the same explicit subset as registration.
    // Do not advertise compatibility for a registry or frontend not implemented.
    if manifest["class"] != "APPLICATION"
        || manifest["frontendDelivery"]["mode"] != "NONE"
        || manifest["executionConnector"]["mode"] != "REMOTE_ADAPTER"
        || manifest["executionConnector"]["adapterProtocolRange"] != "1"
    {
        return Err(Refusal::Blocked(contracts::ReasonCode::CapabilityBlocked));
    }
    for subject in ["BUZZ_WEB", "CORE", "WORKER"] {
        let mut matching = builds.iter().filter(|build| build["subject"] == subject);
        let build = matching.next().ok_or_else(unavailable)?;
        if matching.next().is_some() || build["buildId"].as_str().is_none_or(str::is_empty) {
            return Err(unavailable());
        }
        if subject != "BUZZ_WEB"
            && !build["adapterProtocolVersions"]
                .as_array()
                .is_some_and(|versions| versions.iter().any(|version| version == "1"))
        {
            return Err(Refusal::Blocked(contracts::ReasonCode::CapabilityBlocked));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn approval_requires_each_actual_subject_and_implemented_protocol() {
        let manifest = json!({"class":"APPLICATION","frontendDelivery":{"mode":"NONE"},
            "executionConnector":{"mode":"REMOTE_ADAPTER","adapterProtocolRange":"1"}});
        let builds = json!([
            {"subject":"BUZZ_WEB","buildId":"observed-web","adapterProtocolVersions":[]},
            {"subject":"CORE","buildId":"observed-core","adapterProtocolVersions":["1"]},
            {"subject":"WORKER","buildId":"observed-worker","adapterProtocolVersions":["1"]}
        ]);
        assert!(compatible(&manifest, &builds).is_ok());
        for index in 0..3 {
            let mut missing = builds.clone();
            missing.as_array_mut().unwrap().remove(index);
            assert!(compatible(&manifest, &missing).is_err());
            let mut duplicate = builds.clone();
            duplicate[index] = builds[(index + 1) % 3].clone();
            assert!(compatible(&manifest, &duplicate).is_err());
        }
        for index in [1, 2] {
            let mut unsupported = builds.clone();
            unsupported[index]["adapterProtocolVersions"] = json!(["unknown"]);
            assert!(compatible(&manifest, &unsupported).is_err());
        }
        let mut unsupported = manifest;
        unsupported["frontendDelivery"]["mode"] = json!("REMOTE_MODULE");
        assert!(compatible(&unsupported, &builds).is_err());
    }
}
