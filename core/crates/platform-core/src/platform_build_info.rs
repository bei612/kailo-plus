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

/// The PlatformBuildInfo CORE buildId (source commit) of this exact binary.
/// DD-124(4) binds the isolated receiver deployment to it.
pub(crate) fn core_build_id() -> Result<&'static str, Refusal> {
    option_env!("PLATFORM_BUILD_ID")
        .filter(|value| source_commit(value))
        .ok_or_else(unavailable)
}

fn core_build() -> Result<Value, Refusal> {
    let build = core_build_id()?;
    // These are the actually implemented protocol/registry entries. Unsupported
    // Host API, embedded drivers and platform-port releases remain unavailable.
    Ok(
        json!({"subject":"CORE", "buildId":build, "hostApiVersion":"NONE",
        "adapterProtocolVersions":["1"], "driverRegistryKeys":[], "platformPortKeys":[],
        "connectorKinds":["REMOTE_ADAPTER","PROTOCOL_PEER"],
        "mcpProtocolVersions":rmcp::model::ProtocolVersion::KNOWN_VERSIONS.iter().map(ToString::to_string).collect::<Vec<_>>(),
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
        || !matches!(
            manifest["frontendDelivery"]["mode"].as_str(),
            Some("NONE" | "NATIVE_PAGE")
        )
    {
        return Err(Refusal::Blocked(contracts::ReasonCode::CapabilityBlocked));
    }
    // DD-127: a native page entry has no connector; only the three build
    // facts are required (Core/Worker run no adapter or MCP peer for it).
    let connector = if crate::application_binding::native::native_page_only(manifest) {
        None
    } else {
        Some(crate::application_binding::native::Connector::from_manifest(manifest)?)
    };
    for subject in ["BUZZ_WEB", "CORE", "WORKER"] {
        let mut matching = builds.iter().filter(|build| build["subject"] == subject);
        let build = matching.next().ok_or_else(unavailable)?;
        if matching.next().is_some() || build["buildId"].as_str().is_none_or(str::is_empty) {
            return Err(unavailable());
        }
        if subject != "BUZZ_WEB"
            && connector == Some(crate::application_binding::native::Connector::RemoteAdapter)
            && !build["adapterProtocolVersions"]
                .as_array()
                .is_some_and(|versions| versions.iter().any(|version| version == "1"))
        {
            return Err(Refusal::Blocked(contracts::ReasonCode::CapabilityBlocked));
        }
        if subject != "BUZZ_WEB"
            && connector == Some(crate::application_binding::native::Connector::ProtocolPeer)
            && (!build["connectorKinds"]
                .as_array()
                .is_some_and(|kinds| kinds.contains(&json!("PROTOCOL_PEER")))
                || (subject == "CORE"
                    && !build["mcpProtocolVersions"]
                        .as_array()
                        .is_some_and(|versions| {
                            versions.iter().any(|version| {
                                rmcp::model::ProtocolVersion::KNOWN_VERSIONS
                                    .iter()
                                    .any(|known| version == known.as_str())
                            })
                        })))
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
    fn peer_approval_requires_actual_mcp_consumer_not_adapter_version() {
        let manifest = json!({"class":"APPLICATION","frontendDelivery":{"mode":"NONE"},
            "executionConnector":{"mode":"PROTOCOL_PEER","adapterProtocolRange":"NONE","actionTokenAudience":"NONE"}});
        let builds = json!([
            {"subject":"BUZZ_WEB","buildId":"observed-web","adapterProtocolVersions":[]},
            {"subject":"CORE","buildId":"observed-core","adapterProtocolVersions":[],"connectorKinds":["PROTOCOL_PEER"],
                "mcpProtocolVersions":[rmcp::model::ProtocolVersion::KNOWN_VERSIONS[0].as_str()]},
            {"subject":"WORKER","buildId":"observed-worker","adapterProtocolVersions":[],"connectorKinds":["PROTOCOL_PEER"]}
        ]);
        compatible(&manifest, &builds).unwrap();
        for index in [1, 2] {
            let mut old = builds.clone();
            old[index].as_object_mut().unwrap().remove("connectorKinds");
            old[index]["adapterProtocolVersions"] = json!(["1"]);
            assert!(compatible(&manifest, &old).is_err());
        }
        let mut unknown = builds;
        unknown[1]["mcpProtocolVersions"] = json!(["unknown"]);
        assert!(compatible(&manifest, &unknown).is_err());
    }

    #[test]
    fn native_page_approval_requires_only_the_three_actual_builds() {
        // DD-127: no adapter or MCP peer runs for a native page entry.
        let manifest = json!({"class":"APPLICATION","frontendDelivery":{"mode":"NATIVE_PAGE"},
            "executionConnector":{"mode":"NONE","adapterProtocolRange":"NONE","actionTokenAudience":"NONE"}});
        let builds = json!([
            {"subject":"BUZZ_WEB","buildId":"observed-web","adapterProtocolVersions":[]},
            {"subject":"CORE","buildId":"observed-core","adapterProtocolVersions":[]},
            {"subject":"WORKER","buildId":"observed-worker","adapterProtocolVersions":[]}
        ]);
        compatible(&manifest, &builds).unwrap();
        let mut missing = builds.clone();
        missing.as_array_mut().unwrap().pop();
        assert!(compatible(&manifest, &missing).is_err());
        // A NONE mode that still names an ActionToken audience is no connector
        // at all and is refused rather than treated as a native page entry.
        let mut audience = manifest;
        audience["executionConnector"]["actionTokenAudience"] = json!("kailo-adapter");
        assert!(compatible(&audience, &builds).is_err());
    }

    #[test]
    fn approval_requires_each_actual_subject_and_implemented_protocol() {
        let manifest = json!({"class":"APPLICATION","frontendDelivery":{"mode":"NONE"},
            "executionConnector":{"mode":"REMOTE_ADAPTER","adapterProtocolRange":"1","actionTokenAudience":"isolated-adapter"}});
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
