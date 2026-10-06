//! 四侧 round-trip 的 Rust 一侧（ADR-03）。
//!
//! 反序列化再序列化必须与样例语义相等。它验证的是生成类型没有丢字段、
//! 没有把可选当必填、没有把未知枚举值吞掉。

use std::{fs, path::PathBuf};

#[test]
fn installation_upgrade_permission_preserves_false_and_legacy_absence() {
    let raw =
        fs::read_to_string(sample_path().with_file_name("agent-installation-upgrade.sample.json"))
            .unwrap();
    for permission in [Some(true), Some(false), None] {
        let mut value: serde_json::Value = serde_json::from_str(&raw).unwrap();
        if let Some(permission) = permission {
            value["canUpgrade"] = permission.into();
        } else {
            value.as_object_mut().unwrap().remove("canUpgrade");
        }
        let typed: contracts::AgentInstallationView =
            serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(typed).unwrap(), value);
    }
}

#[test]
fn projects_query_keeps_scoped_coordinates_and_optional_window() {
    let raw =
        fs::read_to_string(sample_path().with_file_name("projects-query.sample.json")).unwrap();
    for value in [
        serde_json::from_str::<serde_json::Value>(&raw).unwrap(),
        serde_json::json!({"view":"PROJECTS"}),
    ] {
        let typed: contracts::ProjectsQueryRequest = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(typed).unwrap(), value);
    }
}

#[test]
fn capability_seed_and_human_registration_keep_separate_evidence() {
    let raw = fs::read_to_string(sample_path().with_file_name("capability-seed-page.sample.json"))
        .unwrap();
    let mut value: serde_json::Value = serde_json::from_str(&raw).unwrap();
    for seeded in [true, false] {
        if !seeded {
            let row = value["contracts"][0].as_object_mut().unwrap();
            let ae = row.remove("bootstrapActionExecutionId").unwrap();
            row.insert("registeredByActionExecutionId".into(), ae);
        }
        let typed: contracts::CapabilityContractPage =
            serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(typed).unwrap(), value);
    }
}

#[test]
fn component_peer_conformance_preserves_native_refs_and_legacy_absence() {
    let raw =
        fs::read_to_string(sample_path().with_file_name("component-peer-conformance.sample.json"))
            .unwrap();
    let mut value: serde_json::Value = serde_json::from_str(&raw).unwrap();
    for include in [true, false] {
        if !include {
            value.as_object_mut().unwrap().remove("nativeCredentials");
        }
        let typed: contracts::ComponentProtocolPeerEnvironment =
            serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(typed).unwrap(), value);
    }
}

#[test]
fn workspace_membership_projection_preserves_true_false_and_unknown() {
    for member in [None, Some(false), Some(true)] {
        let mut value = serde_json::json!({
            "id": "00000000-0000-4000-8000-000000000004", "slug": "scope", "name": "Scope"
        });
        if let Some(member) = member {
            value["isMember"] = member.into();
        }
        let typed: contracts::WorkspaceView = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(typed.is_member, member);
        assert_eq!(serde_json::to_value(typed).unwrap(), value);
    }
}

#[test]
fn public_workspace_roundtrip_preserves_visibility_and_membership_evidence() {
    fn roundtrip<T: serde::de::DeserializeOwned + serde::Serialize>(name: &str) {
        let raw = fs::read_to_string(sample_path().with_file_name(name)).unwrap();
        let original: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let typed: T = serde_json::from_str(&raw).unwrap();
        assert_eq!(original, serde_json::to_value(typed).unwrap());
    }
    roundtrip::<contracts::ActionCommand>("workspace-public-create.sample.json");
    roundtrip::<contracts::ActionCommand>("workspace-join.sample.json");
    roundtrip::<contracts::DiscoverableWorkspacePage>("discoverable-workspaces.sample.json");
    let legacy: contracts::WorkspaceView = serde_json::from_value(serde_json::json!({
        "id": "00000000-0000-4000-8000-000000000004", "slug": "legacy", "name": "Legacy"
    }))
    .unwrap();
    assert!(legacy.visibility.is_none());
}

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
        "web-message-edit.sample.json",
        "web-message-delete.sample.json",
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

#[test]
fn pulse_requests_and_native_limit_roundtrip() {
    let raw =
        fs::read_to_string(sample_path().with_file_name("pulse-publish.sample.json")).unwrap();
    let typed: contracts::PulsePublishRequest = serde_json::from_str(&raw).unwrap();
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&raw).unwrap(),
        serde_json::to_value(typed).unwrap()
    );
    let raw = fs::read_to_string(sample_path().with_file_name("pulse-query.sample.json")).unwrap();
    let typed: contracts::PulseQueryRequest = serde_json::from_str(&raw).unwrap();
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&raw).unwrap(),
        serde_json::to_value(typed).unwrap()
    );
    for limit in [None, Some(100)] {
        let mut value =
            serde_json::json!({"relayUrl":"wss://relay.example","communityHost":"relay.example"});
        if let Some(limit) = limit {
            value["relayQueryLimit"] = serde_json::json!(limit);
        }
        let typed: contracts::NativeCommunityFacts = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(typed).unwrap(), value);
    }
}
