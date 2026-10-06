//! 四侧 round-trip 的 Rust 一侧（ADR-03）。
//!
//! 反序列化再序列化必须与样例语义相等。它验证的是生成类型没有丢字段、
//! 没有把可选当必填、没有把未知枚举值吞掉。

use std::{fs, path::PathBuf};

#[test]
fn delegated_metadata_roundtrip_keeps_only_platform_result() {
    let raw =
        fs::read_to_string(sample_path().with_file_name("delegated-action-metadata.sample.json"))
            .unwrap();
    let original: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let typed: contracts::DelegatedActionMetadataV1 = serde_json::from_str(&raw).unwrap();
    assert_eq!(original, serde_json::to_value(typed).unwrap());
}

#[test]
fn workspace_channel_roundtrip_keeps_native_metadata() {
    let raw =
        fs::read_to_string(sample_path().with_file_name("workspace-channel-create.sample.json"))
            .unwrap();
    let original: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let typed: contracts::ActionCommand = serde_json::from_str(&raw).unwrap();
    assert_eq!(original, serde_json::to_value(typed).unwrap());
}

#[test]
fn conversation_roundtrip_preserves_participants_native_scope_and_frozen_workflow() {
    fn roundtrip<T: serde::de::DeserializeOwned + serde::Serialize>(name: &str) {
        let raw = fs::read_to_string(sample_path().with_file_name(name)).unwrap();
        let original: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let typed: T = serde_json::from_str(&raw).unwrap();
        assert_eq!(original, serde_json::to_value(typed).unwrap());
    }
    roundtrip::<contracts::ActionCommand>("conversation-open.sample.json");
    roundtrip::<contracts::ConversationPreferenceRequest>("conversation-preference.sample.json");
    roundtrip::<contracts::ConversationParticipantPage>("conversation-participants.sample.json");
    roundtrip::<contracts::ConversationPage>("conversation-page.sample.json");
    roundtrip::<contracts::ConversationProjectionRequest>("conversation-projection.sample.json");
}

#[test]
fn application_model_roundtrip_preserves_route_identity_and_missing_correlation() {
    let raw =
        fs::read_to_string(sample_path().with_file_name("application-model-admission.sample.json"))
            .unwrap();
    let original: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let typed: contracts::ApplicationModelAdmission = serde_json::from_str(&raw).unwrap();
    assert_eq!(original, serde_json::to_value(typed).unwrap());
    let raw =
        fs::read_to_string(sample_path().with_file_name("application-model-config.sample.json"))
            .unwrap();
    let original: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let typed: contracts::ApplicationModelGatewayConfig = serde_json::from_str(&raw).unwrap();
    assert_eq!(original, serde_json::to_value(typed).unwrap());
}

#[test]
fn peer_credentials_roundtrip_keeps_binding_generation_and_exact_references() {
    for sample in [
        "application-peer-credentials.sample.json",
        "application-model-delivery.sample.json",
    ] {
        let raw = fs::read_to_string(sample_path().with_file_name(sample)).unwrap();
        let original: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let typed: contracts::ApplicationAdapterDirectory = serde_json::from_str(&raw).unwrap();
        assert_eq!(original, serde_json::to_value(typed).unwrap());
    }
}

#[test]
fn resource_reference_roundtrip_preserves_evidence_and_original_workflow() {
    let raw =
        fs::read_to_string(sample_path().with_file_name("resource-create.sample.json")).unwrap();
    let original: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let typed: contracts::ActionCommand = serde_json::from_str(&raw).unwrap();
    assert_eq!(original, serde_json::to_value(typed).unwrap());
    let raw =
        fs::read_to_string(sample_path().with_file_name("resource-provision.sample.json")).unwrap();
    let original: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let typed: contracts::ResourceProvisionAdvanceRequest = serde_json::from_str(&raw).unwrap();
    assert_eq!(original, serde_json::to_value(typed).unwrap());
}

#[test]
fn application_binding_observation_roundtrip_preserves_mapping_and_optional_scope() {
    let raw = fs::read_to_string(
        sample_path().with_file_name("application-binding-observations.sample.json"),
    )
    .unwrap();
    let original: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let typed: Vec<contracts::AdapterBindingObservation> = serde_json::from_str(&raw).unwrap();
    assert_eq!(original, serde_json::to_value(typed).unwrap());
}

#[test]
fn execution_reference_roundtrip_does_not_invent_unknown_native_id() {
    let raw = fs::read_to_string(
        sample_path().with_file_name("adapter-execution-references.sample.json"),
    )
    .unwrap();
    let original: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let typed: Vec<contracts::AdapterExecutionReference> = serde_json::from_str(&raw).unwrap();
    assert_eq!(original, serde_json::to_value(typed).unwrap());
}

#[test]
fn native_page_roundtrip_preserves_binding_generation_and_exact_origins() {
    let raw =
        fs::read_to_string(sample_path().with_file_name("application-native-page.sample.json"))
            .unwrap();
    let original: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let typed: contracts::ApplicationNativePage = serde_json::from_str(&raw).unwrap();
    assert_eq!(original, serde_json::to_value(typed).unwrap());
}

#[test]
fn component_observations_roundtrip_preserves_references_unknown_and_absence() {
    let raw = fs::read_to_string(
        sample_path().with_file_name("component-conformance-observations.sample.json"),
    )
    .unwrap();
    let original: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let typed: Vec<contracts::ComponentConformanceStepObservation> =
        serde_json::from_str(&raw).unwrap();
    assert_eq!(original, serde_json::to_value(typed).unwrap());
}

#[test]
fn component_release_approval_roundtrip_preserves_actual_subject_and_none_host_api() {
    let raw =
        fs::read_to_string(sample_path().with_file_name("component-release-approval.sample.json"))
            .unwrap();
    let original: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let typed: contracts::ComponentReleaseApprovalReport = serde_json::from_str(&raw).unwrap();
    assert_eq!(original, serde_json::to_value(typed).unwrap());
}

#[test]
fn automation_run_pages_roundtrip_preserves_unknown_and_empty_page() {
    let raw = fs::read_to_string(sample_path().with_file_name("automation-run-pages.sample.json"))
        .unwrap();
    let original: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let typed: Vec<contracts::AutomationRunPage> = serde_json::from_str(&raw).unwrap();
    assert_eq!(original, serde_json::to_value(typed).unwrap());
}

#[test]
fn automation_manual_delete_preserves_optional_run_and_tombstone() {
    let raw =
        fs::read_to_string(sample_path().with_file_name("automation-manual-delete.sample.json"))
            .unwrap();
    let original: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let typed: Vec<contracts::AutomationDetailView> = serde_json::from_str(&raw).unwrap();
    assert_eq!(typed[0].can_run, None);
    assert_eq!(typed[1].can_run, Some(true));
    assert_eq!(
        typed[2].automation.state,
        contracts::AutomationState::Deleted
    );
    assert_eq!(serde_json::to_value(typed).unwrap(), original);
}

fn sample_path() -> PathBuf {
    // 相对本 crate 的 manifest 定位，不依赖调用时的工作目录
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../contracts/samples/canary.sample.json")
}

#[test]
fn automation_post_message_roundtrip_preserves_action_and_native_schedule() {
    let raw =
        fs::read_to_string(sample_path().with_file_name("automation-post-message.sample.json"))
            .unwrap();
    let original: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let typed: contracts::AutomationVersionContent = serde_json::from_str(&raw).unwrap();
    assert_eq!(original, serde_json::to_value(typed).unwrap());
}

#[test]
fn canary_roundtrip_preserves_every_field() {
    let raw = fs::read_to_string(sample_path()).expect("读取样例");
    let original: serde_json::Value = serde_json::from_str(&raw).expect("样例是合法 JSON");

    let typed: contracts::generated::Canary =
        serde_json::from_str(&raw).expect("反序列化为生成类型");
    let back = serde_json::to_value(&typed).expect("再序列化");

    assert_eq!(
        original, back,
        "round-trip 后与样例不等，说明生成类型丢了信息"
    );
}

#[test]
fn web_publish_message_roundtrip_preserves_mentions_and_legacy_absence() {
    for sample in [
        "web-publish-mention.sample.json",
        "web-publish-content-only.sample.json",
        "web-forum-post.sample.json",
        "web-forum-comment.sample.json",
    ] {
        let raw = fs::read_to_string(sample_path().with_file_name(sample)).unwrap();
        let original: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let typed: contracts::WebPublishMessageRequest = serde_json::from_str(&raw).unwrap();
        assert_eq!(original, serde_json::to_value(typed).unwrap(), "{sample}");
    }
}

#[test]
fn forum_channel_and_composite_cursor_roundtrip_preserve_native_fields() {
    fn roundtrip<T: serde::de::DeserializeOwned + serde::Serialize>(name: &str) {
        let raw = fs::read_to_string(sample_path().with_file_name(name)).unwrap();
        let original: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let typed: T = serde_json::from_str(&raw).unwrap();
        assert_eq!(original, serde_json::to_value(typed).unwrap(), "{name}");
    }
    roundtrip::<contracts::WebMessageQuery>("web-forum-query.sample.json");
    roundtrip::<contracts::WebMessageQuery>("web-message-query-legacy.sample.json");
    roundtrip::<contracts::WebMessageCursor>("web-message-cursor.sample.json");
    roundtrip::<contracts::WebChannelView>("web-forum-channel.sample.json");
}

#[test]
fn capability_vectors_roundtrip_preserves_order_and_encoded_values() {
    let raw = fs::read_to_string(
        sample_path().with_file_name("capability-conformance-vectors.sample.json"),
    )
    .unwrap();
    let original: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let typed: contracts::CapabilityConformanceVectors = serde_json::from_str(&raw).unwrap();
    assert_eq!(original, serde_json::to_value(typed).unwrap());
}
