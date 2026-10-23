//! DD-134(5)④ 向导草稿的跨语言对照：`contracts/samples/gateway-mcp-release-draft.sample.json`
//! 的 release 由 TypeScript `releaseDraft` 逐值生成（client-kit/ts/platform/test/gateway.test.tsx），
//! 这里以同一份 ACTIVE 契约内容对它运行 Core 的登记校验。任何一侧改了规则，两边测试之一失败。

use super::*;

const SAMPLE: &str =
    include_str!("../../../../../contracts/samples/gateway-mcp-release-draft.sample.json");

fn sample() -> Value {
    serde_json::from_str(SAMPLE).expect("sample JSON")
}

fn raw(release: &Value) -> Value {
    json!({
        "manifestJson": release["manifest"].to_string(),
        "packageJson": release["package"].to_string(),
        "bindingConfigSchemaJson": release["bindingConfigSchema"].to_string(),
    })
}

/// 改动 manifest 后按 Core 口径重算 package 摘要，确保失败只来自被测规则。
fn with_manifest(release: &Value, edit: impl FnOnce(&mut Value)) -> Value {
    let mut release = release.clone();
    edit(&mut release["manifest"]);
    release["package"]["manifestDigest"] = json!(collab_bridge::limits::canonical_digest(
        &release["manifest"]
    ));
    release
}

fn accepted(release: &Value, contract: &Value) -> Result<(), Refusal> {
    let registration = registration(&raw(release))?;
    validate_declarations(&registration, &[json!({ "content": contract })])
}

#[test]
fn wizard_draft_passes_core_registration_rules() {
    let sample = sample();
    let release = &sample["release"];
    let registration = registration(&raw(release)).expect("draft registers");
    assert!(matches!(
        crate::application_binding::native::Connector::from_manifest(&registration.manifest),
        Ok(crate::application_binding::native::Connector::ProtocolPeer)
    ));
    assert_eq!(registration.contracts, vec![("time".to_owned(), 1)]);
    validate_declarations(
        &registration,
        &[json!({ "content": sample["activeContract"] })],
    )
    .expect("draft covers the ACTIVE contract exactly");
}

#[test]
fn rules_the_wizard_once_broke_are_enforced() {
    let sample = sample();
    let release = &sample["release"];
    let contract = &sample["activeContract"];
    // businessStateSources 缺 AGENTGATEWAY（PROTOCOL_PEER）。
    let without_gateway = with_manifest(release, |manifest| {
        manifest["businessObservabilityContract"]["businessStateSources"] = json!(["CORE_ACTION"]);
    });
    assert!(accepted(&without_gateway, contract).is_err());
    // APPLICATION 动作 capacityPolicy 不是 NATIVE。
    let capacity = with_manifest(release, |manifest| {
        manifest["actionDefinitions"][0]["capacityPolicy"] = json!("NONE");
    });
    assert!(accepted(&capacity, contract).is_err());
    // 类型键用占位而不是 ACTIVE 契约的 resourceTypeFamily。
    let placeholder = with_manifest(release, |manifest| {
        manifest["targetResourceTypeKeys"] = json!(["time.<kind>"]);
        manifest["resourceTypeDefinitions"][0]["typeKey"] = json!("time.<kind>");
    });
    assert!(accepted(&placeholder, contract).is_err());
    // 漏掉契约的一个 operation。
    let partial = with_manifest(release, |manifest| {
        manifest["actionDefinitions"].as_array_mut().unwrap().pop();
        manifest["toolDefinitions"].as_array_mut().unwrap().pop();
    });
    assert!(accepted(&partial, contract).is_err());
    // 输出摘要不是 ACTIVE 契约的。
    let output = with_manifest(release, |manifest| {
        let other = json!("9".repeat(64));
        manifest["actionDefinitions"][0]["outputSchemaDigest"] = other.clone();
        manifest["actionDefinitions"][0]["resultExposurePolicy"]["outputSchemaHash"] =
            other.clone();
        manifest["toolDefinitions"][0]["outputSchemaHash"] = other;
    });
    assert!(accepted(&output, contract).is_err());
    // 对照：未改动的样例通过。
    accepted(release, contract).expect("unchanged sample registers");
}
