//! 四侧 round-trip 的 Rust 一侧（ADR-03）。
//!
//! 反序列化再序列化必须与样例语义相等。它验证的是生成类型没有丢字段、
//! 没有把可选当必填、没有把未知枚举值吞掉。

use std::{fs, path::PathBuf};

#[test]
fn native_task_admission_preserves_pending_without_ticket_and_frozen_deadline() {
    let sample: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(
            sample_path().with_file_name("native-task-execution-admission.sample.json"),
        )
        .unwrap(),
    )
    .unwrap();
    let request: contracts::NativeTaskExecutionAdmissionRequest =
        serde_json::from_value(sample["request"].clone()).unwrap();
    let responses: Vec<contracts::NativeTaskExecutionAdmissionResponse> =
        serde_json::from_value(sample["responses"].clone()).unwrap();
    assert_eq!(
        serde_json::json!({"request":request,"responses":responses}),
        sample
    );
}

#[test]
fn reminder_wire_preserves_original_status_optional_fields_and_safe_timestamps() {
    let sample: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(sample_path().with_file_name("reminder.sample.json")).unwrap(),
    )
    .unwrap();
    let requests: Vec<contracts::ReminderPublishRequest> =
        serde_json::from_value(sample["requests"].clone()).unwrap();
    let source: contracts::ReminderSourceRequest =
        serde_json::from_value(sample["source"].clone()).unwrap();
    let views: Vec<contracts::ReminderView> =
        serde_json::from_value(sample["views"].clone()).unwrap();
    assert_eq!(
        serde_json::json!({"requests":requests,"source":source,"views":views}),
        sample
    );
}

#[test]
fn delay_deadline_preserves_independent_duration_and_legacy_absence() {
    let sample: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(sample_path().with_file_name("agent-task-delay.sample.json")).unwrap(),
    )
    .unwrap();
    let typed: Vec<contracts::AgentTaskAdvanceResult> =
        serde_json::from_value(sample.clone()).unwrap();
    assert_eq!(serde_json::to_value(typed).unwrap(), sample);
}

#[test]
fn pep_binding_generation_preserves_legacy_absence() {
    let sample: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(sample_path().with_file_name("adapter-pep-resource.sample.json"))
            .unwrap(),
    )
    .unwrap();
    let typed: Vec<contracts::AdapterPepCheckResponse> =
        serde_json::from_value(sample.clone()).unwrap();
    assert_eq!(serde_json::to_value(typed).unwrap(), sample);
}

#[test]
fn agent_sessions_and_native_control_preserve_wire_and_legacy() {
    let sample: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(sample_path().with_file_name("agent-session-control.sample.json"))
            .unwrap(),
    )
    .unwrap();
    macro_rules! roundtrip {
        ($key:literal, $ty:ty) => {{
            let typed: $ty = serde_json::from_value(sample[$key].clone()).unwrap();
            assert_eq!(serde_json::to_value(typed).unwrap(), sample[$key]);
        }};
    }
    roundtrip!("sessions", contracts::AgentSessionPage);
    roundtrip!("invocations", contracts::AgentInvocationPage);
    roundtrip!("control", contracts::ComponentActionInput);
    roundtrip!("legacy", contracts::ComponentActionInput);
    roundtrip!("deleteInput", contracts::FileStorageDeleteInput);
    roundtrip!("deleteOutput", contracts::FileStorageDeleteOutput);
    roundtrip!("result", contracts::NativeHumanActionResult);
}

#[test]
fn task_state_reports_preserve_native_activity_and_legacy_absence() {
    let value: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(sample_path().with_file_name("task-state-reports.sample.json"))
            .unwrap(),
    )
    .unwrap();
    let typed: Vec<contracts::TaskStateReport> = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(serde_json::to_value(typed).unwrap(), value);
}

#[test]
fn web_search_query_preserves_original_operators_and_optional_absence() {
    let value: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(sample_path().with_file_name("web-search-query.sample.json")).unwrap(),
    )
    .unwrap();
    let typed: Vec<contracts::WebSearchQuery> = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(serde_json::to_value(typed).unwrap(), value);
}

#[test]
fn inbox_mentions_preserve_original_feed_bounds_and_optional_absence() {
    let value: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(sample_path().with_file_name("web-inbox-query.sample.json")).unwrap(),
    )
    .unwrap();
    let typed: Vec<contracts::WebInboxQuery> = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(serde_json::to_value(typed).unwrap(), value);
}

#[test]
fn native_source_resources_preserve_all_metadata_and_legacy_absence() {
    let sample: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(sample_path().with_file_name("adapter-source-resources.sample.json"))
            .unwrap(),
    )
    .unwrap();
    for present in [true, false] {
        let mut value = sample.clone();
        if !present {
            for key in ["pep", "response", "human"] {
                value[key]
                    .as_object_mut()
                    .unwrap()
                    .remove("sourceResources");
            }
        }
        let pep: contracts::AdapterPepCheckRequest =
            serde_json::from_value(value["pep"].clone()).unwrap();
        let response: contracts::AdapterExecutionResponse =
            serde_json::from_value(value["response"].clone()).unwrap();
        let human: contracts::NativeHumanActionRequest =
            serde_json::from_value(value["human"].clone()).unwrap();
        assert_eq!(serde_json::to_value(pep).unwrap(), value["pep"]);
        assert_eq!(serde_json::to_value(response).unwrap(), value["response"]);
        assert_eq!(serde_json::to_value(human).unwrap(), value["human"]);
    }
}

#[test]
fn project_preference_preserves_coordinate_selection_and_shared_version() {
    let value: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(sample_path().with_file_name("project-preference.sample.json"))
            .unwrap(),
    )
    .unwrap();
    let typed: Vec<contracts::ProjectPreferenceRequest> =
        serde_json::from_value(value.clone()).unwrap();
    assert_eq!(serde_json::to_value(typed).unwrap(), value);
}

#[test]
fn collaboration_user_state_requests_preserve_original_fields_and_shared_version() {
    // DD-125: thread follow, sidebar sections/sort, channel templates and Pulse follow share
    // one CollaborationUserState CAS. Every request is flat; absent optionals stay absent.
    let value: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(sample_path().with_file_name("user-state-collaboration.sample.json"))
            .unwrap(),
    )
    .unwrap();
    fn roundtrip<T: serde::de::DeserializeOwned + serde::Serialize>(value: &serde_json::Value) {
        let typed: T = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(&serde_json::to_value(typed).unwrap(), value);
    }
    roundtrip::<contracts::ThreadPreferenceRequest>(&value["threadPreference"]);
    roundtrip::<contracts::SidebarSectionRequest>(&value["sidebarSection"]);
    roundtrip::<contracts::SidebarSectionOrderRequest>(&value["sidebarSectionOrder"]);
    roundtrip::<contracts::SidebarAssignmentRequest>(&value["sidebarAssignment"]);
    roundtrip::<contracts::SidebarAssignmentRequest>(&value["sidebarUnassignment"]);
    roundtrip::<contracts::SidebarSortRequest>(&value["sidebarSort"]);
    roundtrip::<contracts::ChannelTemplateRequest>(&value["channelTemplate"]);
    roundtrip::<contracts::FollowedPrincipalRequest>(&value["followedPrincipal"]);
}

#[test]
fn moderation_commands_views_and_restriction_preserve_original_fields() {
    // DD-125(2): the governed moderation commands, the CONTROL-read queue, audit and
    // restriction pages, and PUBLISH_REJECTED with its structured restriction.
    let value: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(sample_path().with_file_name("moderation.sample.json")).unwrap(),
    )
    .unwrap();
    fn roundtrip<T: serde::de::DeserializeOwned + serde::Serialize>(value: &serde_json::Value) {
        let typed: T = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(&serde_json::to_value(typed).unwrap(), value);
    }
    for command in [
        "reportCommand",
        "timeoutCommand",
        "banCommand",
        "resolveCommand",
        "deleteCommand",
    ] {
        roundtrip::<contracts::ActionCommand>(&value[command]);
    }
    roundtrip::<contracts::ModerationAccessView>(&value["access"]);
    roundtrip::<contracts::ModerationReportPage>(&value["reports"]);
    roundtrip::<contracts::ModerationAuditPage>(&value["audit"]);
    roundtrip::<contracts::ModerationRestrictionPage>(&value["restrictions"]);
    roundtrip::<contracts::ErrorBody>(&value["timedOut"]);
    roundtrip::<contracts::ErrorBody>(&value["banned"]);
}

#[test]
fn projects_publication_preserves_native_metadata_and_exact_head_reference() {
    let value: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(sample_path().with_file_name("projects-publication.sample.json"))
            .unwrap(),
    )
    .unwrap();
    let typed: Vec<contracts::ProjectsPublishRequest> =
        serde_json::from_value(value.clone()).unwrap();
    assert_eq!(serde_json::to_value(typed).unwrap(), value);
}

#[test]
fn inbox_agent_identity_and_author_query_preserve_legacy_absence() {
    let sample: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(sample_path().with_file_name("inbox-agent.sample.json")).unwrap(),
    )
    .unwrap();
    for present in [true, false] {
        let mut value = sample.clone();
        if !present {
            value["query"]
                .as_object_mut()
                .unwrap()
                .remove("agentInstallationId");
            value["installation"]
                .as_object_mut()
                .unwrap()
                .remove("agentPubkey");
        }
        let query: contracts::WebMessageQuery =
            serde_json::from_value(value["query"].clone()).unwrap();
        let installation: contracts::AgentInstallationView =
            serde_json::from_value(value["installation"].clone()).unwrap();
        assert_eq!(serde_json::to_value(query).unwrap(), value["query"]);
        assert_eq!(
            serde_json::to_value(installation).unwrap(),
            value["installation"]
        );
    }
}

#[test]
fn custom_emoji_preserves_explicit_removal_and_empty_signed_set_view() {
    let sample: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(sample_path().with_file_name("web-custom-emoji.sample.json")).unwrap(),
    )
    .unwrap();
    for key in ["add", "remove"] {
        let typed: contracts::WebCustomEmojiMutation =
            serde_json::from_value(sample[key].clone()).unwrap();
        assert_eq!(serde_json::to_value(typed).unwrap(), sample[key]);
    }
    let view: contracts::WebCustomEmojiView =
        serde_json::from_value(sample["view"].clone()).unwrap();
    assert_eq!(serde_json::to_value(view).unwrap(), sample["view"]);
}

#[test]
fn agent_version_avatar_projection_preserves_exact_map_and_legacy_absence() {
    let mut sample: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(sample_path().with_file_name("agent-version-view.sample.json"))
            .unwrap(),
    )
    .unwrap();
    for include in [true, false] {
        if !include {
            sample.as_object_mut().unwrap().remove("avatarMediaPaths");
        }
        let typed: contracts::AgentVersionView = serde_json::from_value(sample.clone()).unwrap();
        assert_eq!(typed.avatar_media_paths.is_some(), include);
        assert_eq!(serde_json::to_value(typed).unwrap(), sample);
    }
}

#[test]
fn native_human_action_preserves_trust_and_nonterminal_reference_only_receipt() {
    let sample: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(sample_path().with_file_name("native-human-action.sample.json"))
            .unwrap(),
    )
    .unwrap();
    let trust: contracts::ApplicationNativeHumanIdentity =
        serde_json::from_value(sample["trust"].clone()).unwrap();
    let request: contracts::NativeHumanActionRequest =
        serde_json::from_value(sample["request"].clone()).unwrap();
    let result: contracts::NativeHumanActionResult =
        serde_json::from_value(sample["result"].clone()).unwrap();
    assert_eq!(serde_json::to_value(trust).unwrap(), sample["trust"]);
    assert_eq!(serde_json::to_value(request).unwrap(), sample["request"]);
    assert_eq!(serde_json::to_value(result).unwrap(), sample["result"]);
    let writer_request: contracts::NativeHumanActionRequest =
        serde_json::from_value(sample["writerRequest"].clone()).unwrap();
    let writer_result: contracts::NativeHumanActionResult =
        serde_json::from_value(sample["writerResult"].clone()).unwrap();
    assert_eq!(
        serde_json::to_value(writer_request).unwrap(),
        sample["writerRequest"]
    );
    assert_eq!(
        serde_json::to_value(writer_result).unwrap(),
        sample["writerResult"]
    );
    let read_receipt: contracts::NativeHumanActionRequest =
        serde_json::from_value(sample["readReceiptRequest"].clone()).unwrap();
    assert_eq!(
        serde_json::to_value(read_receipt).unwrap(),
        sample["readReceiptRequest"]
    );
    let mut legacy = sample["result"].clone();
    legacy.as_object_mut().unwrap().remove("readAdmission");
    let old: contracts::NativeHumanActionResult = serde_json::from_value(legacy.clone()).unwrap();
    assert_eq!(serde_json::to_value(old).unwrap(), legacy);
    let resource_request: contracts::NativeHumanActionRequest =
        serde_json::from_value(sample["resourceRequest"].clone()).unwrap();
    let resource_result: contracts::NativeHumanResourceResult =
        serde_json::from_value(sample["resourceResult"].clone()).unwrap();
    assert_eq!(
        serde_json::to_value(resource_request).unwrap(),
        sample["resourceRequest"]
    );
    assert_eq!(
        serde_json::to_value(resource_result).unwrap(),
        sample["resourceResult"]
    );
    let scope_request: contracts::NativeHumanActionRequest =
        serde_json::from_value(sample["scopeRequest"].clone()).unwrap();
    let scope_result: contracts::NativeHumanScopeResult =
        serde_json::from_value(sample["scopeResult"].clone()).unwrap();
    assert_eq!(
        serde_json::to_value(scope_request).unwrap(),
        sample["scopeRequest"]
    );
    assert_eq!(
        serde_json::to_value(scope_result).unwrap(),
        sample["scopeResult"]
    );
}

#[test]
fn native_sync_grant_preserves_own_admission_and_read_only_terminal_outcomes() {
    let raw = fs::read_to_string(
        sample_path().with_file_name("adapter-native-read-grant-request.sample.json"),
    )
    .unwrap();
    let typed: contracts::AdapterReadGrantRequest = serde_json::from_str(&raw).unwrap();
    assert_eq!(
        serde_json::to_value(typed).unwrap(),
        serde_json::from_str::<serde_json::Value>(&raw).unwrap()
    );
    let raw = fs::read_to_string(
        sample_path().with_file_name("adapter-native-read-grant-responses.sample.json"),
    )
    .unwrap();
    let typed: Vec<contracts::AdapterReadGrantResponse> = serde_json::from_str(&raw).unwrap();
    assert_eq!(
        serde_json::to_value(typed).unwrap(),
        serde_json::from_str::<serde_json::Value>(&raw).unwrap()
    );
    let raw =
        fs::read_to_string(sample_path().with_file_name("file-storage-list-output.sample.json"))
            .unwrap();
    let typed: contracts::FileStorageListOutput = serde_json::from_str(&raw).unwrap();
    assert_eq!(
        serde_json::to_value(typed).unwrap(),
        serde_json::from_str::<serde_json::Value>(&raw).unwrap()
    );
}

#[test]
fn automation_topic_step_preserves_explicit_empty_topic() {
    let sample: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(sample_path().with_file_name("automation-topic-step.sample.json"))
            .unwrap(),
    )
    .unwrap();
    let step: contracts::AutomationStep = serde_json::from_value(sample.clone()).unwrap();
    assert_eq!(serde_json::to_value(step).unwrap(), sample);
}

#[test]
fn read_receipts_preserve_native_precision_roles_and_quantities() {
    let raw = fs::read_to_string(sample_path().with_file_name("adapter-read-receipts.sample.json"))
        .unwrap();
    let typed: Vec<contracts::AdapterReadReceipt> = serde_json::from_str(&raw).unwrap();
    assert_eq!(
        serde_json::to_value(typed).unwrap(),
        serde_json::from_str::<serde_json::Value>(&raw).unwrap()
    );
}

#[test]
fn automation_reaction_step_preserves_original_emoji() {
    let sample: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(sample_path().with_file_name("automation-reaction-step.sample.json"))
            .unwrap(),
    )
    .unwrap();
    let step: contracts::AutomationStep = serde_json::from_value(sample.clone()).unwrap();
    assert_eq!(serde_json::to_value(step).unwrap(), sample);
}

#[test]
fn application_read_resources_preserve_metadata_and_legacy_entry_absence() {
    let raw =
        fs::read_to_string(sample_path().with_file_name("application-read-resources.sample.json"))
            .unwrap();
    let sample: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let page: contracts::ApplicationReadResourcePage =
        serde_json::from_value(sample["page"].clone()).unwrap();
    assert_eq!(serde_json::to_value(page).unwrap(), sample["page"]);
    for available in [Some(true), Some(false), None] {
        let mut value = sample["binding"].clone();
        if let Some(available) = available {
            value["hasReadReceiver"] = available.into();
        } else {
            value.as_object_mut().unwrap().remove("hasReadReceiver");
        }
        let binding: contracts::ApplicationBindingView =
            serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(binding).unwrap(), value);
    }
}

#[test]
fn service_read_permission_preserves_receiver_and_legacy_absence() {
    let raw = fs::read_to_string(
        sample_path().with_file_name("resource-service-read-permission.sample.json"),
    )
    .unwrap();
    let sample: serde_json::Value = serde_json::from_str(&raw).unwrap();
    for service in [true, false] {
        let mut value = sample.clone();
        if !service {
            value.as_object_mut().unwrap().remove("receiverResource");
        }
        let typed: contracts::ActionCommand = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(typed).unwrap(), value);
    }
}

#[test]
fn automation_approval_step_preserves_policy_and_immutable_view_reference() {
    let sample: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(sample_path().with_file_name("automation-approval-step.sample.json"))
            .unwrap(),
    )
    .unwrap();
    let step: contracts::AutomationStep = serde_json::from_value(sample["step"].clone()).unwrap();
    assert_eq!(serde_json::to_value(step).unwrap(), sample["step"]);
    let view: contracts::AutomationApprovalStepView =
        serde_json::from_value(sample["view"].clone()).unwrap();
    assert_eq!(serde_json::to_value(view).unwrap(), sample["view"]);
}

#[test]
fn receiver_read_grant_preserves_distinct_source_and_receiver_provenance() {
    let request =
        fs::read_to_string(sample_path().with_file_name("adapter-read-grant-request.sample.json"))
            .unwrap();
    let response =
        fs::read_to_string(sample_path().with_file_name("adapter-read-grant-response.sample.json"))
            .unwrap();
    let typed: contracts::AdapterReadGrantRequest = serde_json::from_str(&request).unwrap();
    assert_eq!(
        serde_json::to_value(typed).unwrap(),
        serde_json::from_str::<serde_json::Value>(&request).unwrap()
    );
    let typed: contracts::AdapterReadGrantResponse = serde_json::from_str(&response).unwrap();
    assert_eq!(
        serde_json::to_value(typed).unwrap(),
        serde_json::from_str::<serde_json::Value>(&response).unwrap()
    );
}

#[test]
fn native_receiver_preserves_original_batch_and_observe_only_lookup() {
    let raw =
        fs::read_to_string(sample_path().with_file_name("component-native-receiver.sample.json"))
            .unwrap();
    let sample: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let request: contracts::ComponentNativeReceiverRequest =
        serde_json::from_value(sample["request"].clone()).unwrap();
    let observation: contracts::ComponentNativeReceiverObservation =
        serde_json::from_value(sample["observation"].clone()).unwrap();
    let lookup: contracts::AdapterReadGrantRequest =
        serde_json::from_value(sample["lookup"].clone()).unwrap();
    assert_eq!(serde_json::to_value(request).unwrap(), sample["request"]);
    assert_eq!(
        serde_json::to_value(observation).unwrap(),
        sample["observation"]
    );
    assert_eq!(serde_json::to_value(lookup).unwrap(), sample["lookup"]);
}

#[test]
fn conformance_identity_preserves_isolated_authorization_and_execution() {
    let raw = fs::read_to_string(
        sample_path().with_file_name("component-conformance-identity.sample.json"),
    )
    .unwrap();
    let expected: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let typed: contracts::ComponentConformanceIdentity = serde_json::from_str(&raw).unwrap();
    assert_eq!(serde_json::to_value(typed).unwrap(), expected);
}

#[test]
fn member_removal_permissions_preserve_true_false_and_legacy_absence() {
    let raw =
        fs::read_to_string(sample_path().with_file_name("member-action-availability.sample.json"))
            .unwrap();
    for permission in [Some(true), Some(false), None] {
        let mut value: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let row = value["members"][0].as_object_mut().unwrap();
        for key in [
            "canRemoveFromWorkspace",
            "canAddToWorkspace",
            "canRemoveFromTenant",
        ] {
            if let Some(permission) = permission {
                row.insert(key.into(), permission.into());
            } else {
                row.remove(key);
            }
        }
        if permission.is_none() {
            row.remove("createdAt");
            row.remove("pubkeys");
        }
        let typed: contracts::RoleMemberPage = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(typed).unwrap(), value);
    }
}

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
        serde_json::json!({"view":"WORK_ITEMS","coordinates":["30617:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:example"]}),
        serde_json::json!({"view":"WORK_ITEM_ACTIVITY","coordinates":["30617:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:example"],"since":7,"until":9}),
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
    roundtrip::<contracts::ActionCommand>("workspace-update.sample.json");
    roundtrip::<contracts::ActionCommand>("workspace-update-clear.sample.json");
    roundtrip::<contracts::ActionCommand>("workspace-reopen.sample.json");
    roundtrip::<contracts::ActionCommand>("workspace-leave.sample.json");
    roundtrip::<contracts::DiscoverableWorkspacePage>("discoverable-workspaces.sample.json");
    roundtrip::<contracts::AgentAuthorDirectory>("agent-author-directory.sample.json");
    roundtrip::<contracts::AgentCatalogOwners>("agent-catalog-owners.sample.json");
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
        "application-native-resources.sample.json",
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
fn binding_reconcile_roundtrip_preserves_frozen_reference_and_unknown_absence() {
    let raw = fs::read_to_string(
        sample_path().with_file_name("adapter-binding-reconcile-request.sample.json"),
    )
    .unwrap();
    let original: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let typed: contracts::AdapterBindingReconcileRequest = serde_json::from_str(&raw).unwrap();
    assert_eq!(original, serde_json::to_value(typed).unwrap());
    let raw = fs::read_to_string(
        sample_path().with_file_name("adapter-binding-reconcile-responses.sample.json"),
    )
    .unwrap();
    let original: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let typed: Vec<contracts::AdapterBindingReconcileResponse> =
        serde_json::from_str(&raw).unwrap();
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
    let mut legacy = original;
    legacy[0]["runs"][0]
        .as_object_mut()
        .unwrap()
        .remove("executionTrace");
    let typed: Vec<contracts::AutomationRunPage> = serde_json::from_value(legacy.clone()).unwrap();
    assert_eq!(legacy, serde_json::to_value(typed).unwrap());
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
fn automation_cron_roundtrip_preserves_exact_spec_and_legacy_interval() {
    let raw =
        fs::read_to_string(sample_path().with_file_name("automation-cron.sample.json")).unwrap();
    let original: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let typed: Vec<contracts::AutomationVersionContent> = serde_json::from_str(&raw).unwrap();
    assert_eq!(original, serde_json::to_value(typed).unwrap());
}

#[test]
fn automation_steps_roundtrip_preserves_order_and_version_discriminator() {
    for name in [
        "automation-steps.sample.json",
        "automation-message-sequence.sample.json",
        "automation-trigger-filter.sample.json",
    ] {
        let raw = fs::read_to_string(sample_path().with_file_name(name)).unwrap();
        let original: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let typed: contracts::AutomationVersionContent = serde_json::from_str(&raw).unwrap();
        assert!(typed.action.is_none());
        assert_eq!(original, serde_json::to_value(typed).unwrap());
    }
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
        "web-send-to-channel.sample.json",
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
    roundtrip::<contracts::WebMessageQuery>("web-inbox-anchor-query.sample.json");
    roundtrip::<contracts::WebMessageCursor>("web-message-cursor.sample.json");
    roundtrip::<contracts::WebChannelView>("web-forum-channel.sample.json");
    roundtrip::<contracts::WebPublishTopicRequest>("web-channel-topic.sample.json");
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
fn capability_vectors_v2_roundtrip_preserves_value_sources() {
    let raw = fs::read_to_string(
        sample_path().with_file_name("capability-conformance-vectors-v2.sample.json"),
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
            value["publicationEpoch"] = serde_json::json!("00000000-0000-0000-0000-00000000002a");
            value["relayQueryLimit"] = serde_json::json!(limit);
            value["publishResultSettleSeconds"] = serde_json::json!(901);
            value["publishResultObservedAtUnixSeconds"] = serde_json::json!(1900000000);
        }
        let typed: contracts::NativeCommunityFacts = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(typed).unwrap(), value);
    }
}

#[test]
fn file_storage_share_preserves_exact_native_reference() {
    let row: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(sample_path().with_file_name("file-storage-share.sample.json"))
            .unwrap(),
    )
    .unwrap();
    let input: contracts::FileStorageShareInput =
        serde_json::from_value(row["input"].clone()).unwrap();
    let output: contracts::FileStorageShareOutput =
        serde_json::from_value(row["output"].clone()).unwrap();
    assert_eq!(serde_json::to_value(input).unwrap(), row["input"]);
    assert_eq!(serde_json::to_value(output).unwrap(), row["output"]);
}

#[test]
fn message_authors_preserve_exact_event_mapping_and_absent_metadata() {
    let sample: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(sample_path().with_file_name("web-message-authors.sample.json"))
            .unwrap(),
    )
    .unwrap();
    let request: contracts::WebMessageAuthorQuery =
        serde_json::from_value(sample["request"].clone()).unwrap();
    let view: contracts::WebMessageAuthorView =
        serde_json::from_value(sample["view"].clone()).unwrap();
    assert_eq!(serde_json::to_value(request).unwrap(), sample["request"]);
    assert_eq!(serde_json::to_value(view).unwrap(), sample["view"]);
    let legacy: contracts::WebMessageAuthorView =
        serde_json::from_value(sample["legacyView"].clone()).unwrap();
    let expected: serde_json::Map<_, _> = sample["legacyView"]["profiles"]
        .as_object()
        .unwrap()
        .keys()
        .map(|id| (id.clone(), sample["view"]["profiles"][id].clone()))
        .collect();
    assert_eq!(
        serde_json::to_value(legacy).unwrap(),
        serde_json::json!({"profiles":expected})
    );
}

#[test]
fn file_storage_revision_io_preserves_exact_versions_empty_text_and_binary() {
    let rows: Vec<serde_json::Value> = serde_json::from_str(
        &fs::read_to_string(sample_path().with_file_name("file-storage-revision-io.sample.json"))
            .unwrap(),
    )
    .unwrap();
    for row in rows {
        let value: contracts::FileStorageReadInput =
            serde_json::from_value(row["readInput"].clone()).unwrap();
        assert_eq!(serde_json::to_value(value).unwrap(), row["readInput"]);
        let value: contracts::FileStorageWriteInput =
            serde_json::from_value(row["readInput"].clone()).unwrap();
        assert_eq!(serde_json::to_value(value).unwrap(), row["readInput"]);
        let value: contracts::FileStorageWriteOutput =
            serde_json::from_value(serde_json::json!({})).unwrap();
        assert_eq!(serde_json::to_value(value).unwrap(), serde_json::json!({}));
        let value: contracts::FileStorageReadOutput =
            serde_json::from_value(row["readOutput"].clone()).unwrap();
        assert_eq!(serde_json::to_value(value).unwrap(), row["readOutput"]);
        let value: contracts::FileStorageListRevisionsInput =
            serde_json::from_value(row["listRevisionsInput"].clone()).unwrap();
        assert_eq!(
            serde_json::to_value(value).unwrap(),
            row["listRevisionsInput"]
        );
        let value: contracts::FileStorageListRevisionsOutput =
            serde_json::from_value(row["listRevisionsOutput"].clone()).unwrap();
        assert_eq!(
            serde_json::to_value(value).unwrap(),
            row["listRevisionsOutput"]
        );
        let value: contracts::FileStorageExportInput =
            serde_json::from_value(row["exportInput"].clone()).unwrap();
        assert_eq!(serde_json::to_value(value).unwrap(), row["exportInput"]);
        let value: contracts::FileStorageExportOutput =
            serde_json::from_value(row["exportOutput"].clone()).unwrap();
        assert_eq!(serde_json::to_value(value).unwrap(), row["exportOutput"]);
    }
}

#[test]
fn collaboration_dd125_c3_canvas_link_preview_and_gif_preserve_fields_and_absence() {
    // DD-125(4)(5): the canvas body is a transient command input; link previews are referenced
    // only by snapshot ID or the suppress flag; GIF views are BFF-normalized. Absent stays absent.
    let value: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(sample_path().with_file_name("collaboration-dd125-c3.sample.json"))
            .unwrap(),
    )
    .unwrap();
    fn roundtrip<T: serde::de::DeserializeOwned + serde::Serialize>(value: &serde_json::Value) {
        let typed: T = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(&serde_json::to_value(typed).unwrap(), value);
    }
    roundtrip::<contracts::ActionCommand>(&value["canvasSet"]);
    roundtrip::<contracts::WebChannelCanvasView>(&value["canvasView"]);
    roundtrip::<contracts::WebChannelCanvasView>(&value["canvasViewEmpty"]);
    roundtrip::<contracts::WebLinkPreviewRequest>(&value["linkPreviewRequest"]);
    roundtrip::<contracts::WebLinkPreviewSnapshotView>(&value["linkPreviewSnapshot"]);
    roundtrip::<contracts::WebPublishMessageRequest>(&value["publishWithPreviews"]);
    roundtrip::<contracts::WebPublishMessageRequest>(&value["removePreviews"]);
    roundtrip::<contracts::WebGifCapabilityView>(&value["gifCapability"]);
    roundtrip::<contracts::WebGifSearchRequest>(&value["gifSearchRequest"]);
    roundtrip::<contracts::WebGifSearchView>(&value["gifSearch"]);
    roundtrip::<contracts::WebGifShareRequest>(&value["gifShare"]);
}

#[test]
fn agent_observability_dd125_c4_lifecycle_transcript_and_active_turns_preserve_fields() {
    // DD-125(6): lifecycle commands carry only resourceId/resourceVersion/explicitConfirmation,
    // restart is a same-version upgrade, transcript items are the flat Codex item adapter shape
    // and respondTo never has an "anyone" value. Absent optional fields stay absent.
    let value: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(
            sample_path().with_file_name("agent-observability-dd125-c4.sample.json"),
        )
        .unwrap(),
    )
    .unwrap();
    fn roundtrip<T: serde::de::DeserializeOwned + serde::Serialize>(value: &serde_json::Value) {
        let typed: T = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(&serde_json::to_value(typed).unwrap(), value);
    }
    for key in [
        "disableCommand",
        "enableCommand",
        "restartCommand",
        "interruptCommand",
    ] {
        roundtrip::<contracts::ActionCommand>(&value[key]);
    }
    roundtrip::<contracts::AgentInstallationView>(&value["installationView"]);
    roundtrip::<contracts::AgentInstallationView>(&value["disabledView"]);
    roundtrip::<contracts::AgentInstallationUsePage>(&value["usePage"]);
    roundtrip::<contracts::AgentTranscriptPage>(&value["transcriptPage"]);
    roundtrip::<contracts::AgentTranscriptPage>(&value["transcriptPageEmpty"]);
    roundtrip::<contracts::AgentTranscriptEvent>(&value["itemEvent"]);
    roundtrip::<contracts::AgentTranscriptEvent>(&value["turnEvent"]);
    roundtrip::<contracts::AgentActiveTurnPage>(&value["activeTurnPage"]);
    let mut anyone = value["usePage"].clone();
    anyone["respondTo"] = serde_json::json!("ANYONE");
    assert!(serde_json::from_value::<contracts::AgentInstallationUsePage>(anyone).is_err());
}

#[test]
fn collaboration_dd125_c5_huddle_preserves_fields_and_absence() {
    // DD-125(3): huddle.start carries exactly one parent, an optional creator key (Web omits it
    // and Core uses the SERVER key) and at most 20 Installations; the start submission carries
    // the pre-allocated huddleId; views never carry audio or participants. Absent stays absent.
    let value: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(sample_path().with_file_name("collaboration-dd125-c5.sample.json"))
            .unwrap(),
    )
    .unwrap();
    fn roundtrip<T: serde::de::DeserializeOwned + serde::Serialize>(value: &serde_json::Value) {
        let typed: T = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(&serde_json::to_value(typed).unwrap(), value);
    }
    for key in [
        "startCommand",
        "startCommandConversation",
        "agentAddCommand",
        "endCommand",
    ] {
        roundtrip::<contracts::ActionCommand>(&value[key]);
    }
    roundtrip::<contracts::ActionSubmission>(&value["startSubmission"]);
    roundtrip::<contracts::HuddleView>(&value["huddleView"]);
    roundtrip::<contracts::HuddleView>(&value["huddleViewEnded"]);
    roundtrip::<contracts::HuddlePage>(&value["huddlePage"]);
    roundtrip::<contracts::HuddleLifecyclePage>(&value["lifecyclePage"]);
    roundtrip::<contracts::HuddleVoiceView>(&value["voiceView"]);
    roundtrip::<contracts::HuddleAnnouncementView>(&value["announcementView"]);
    let mut unknown = value["huddleView"].clone();
    unknown["state"] = serde_json::json!("RECONCILING");
    assert!(serde_json::from_value::<contracts::HuddleView>(unknown).is_err());
}

#[test]
fn dd125_member_joins_and_memory_refs_preserve_fields_and_absence() {
    // DD-125(9): the join page always carries items/cursor/hasMore; an empty cursor is the
    // origin. DD-125(10): only a COMPLETE HUMAN listing carries outgoingRefs/references;
    // tombstones, BOUND_EXCEEDED and the Agent tool listing keep them absent.
    let value: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(
            sample_path().with_file_name("dd125-member-joins-memory-refs.sample.json"),
        )
        .unwrap(),
    )
    .unwrap();
    fn roundtrip<T: serde::de::DeserializeOwned + serde::Serialize>(value: &serde_json::Value) {
        let typed: T = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(&serde_json::to_value(typed).unwrap(), value);
    }
    for key in ["joinPageBaseline", "joinPageOrigin", "joinPage"] {
        roundtrip::<contracts::TenantMemberJoinPage>(&value[key]);
    }
    roundtrip::<contracts::TenantMemberJoinView>(&value["joinPage"]["items"][0]);
    for key in [
        "memoryPageComplete",
        "memoryPageNoCore",
        "memoryPageBounded",
        "memoryPageTool",
    ] {
        roundtrip::<contracts::AgentMemoryEntryPage>(&value[key]);
    }
    roundtrip::<contracts::AgentMemoryEntryView>(&value["memoryPageComplete"]["entries"][0]);
    roundtrip::<contracts::AgentMemoryReferenceView>(&value["memoryPageComplete"]["references"]);
    let dangling = &value["memoryPageComplete"]["references"]["dangling"][0];
    roundtrip::<contracts::AgentMemoryDanglingRefView>(dangling);
    let mut missing = value["joinPage"].clone();
    missing.as_object_mut().unwrap().remove("hasMore");
    assert!(serde_json::from_value::<contracts::TenantMemberJoinPage>(missing).is_err());
    let mut partial = value["memoryPageComplete"]["references"].clone();
    partial.as_object_mut().unwrap().remove("coreExists");
    assert!(serde_json::from_value::<contracts::AgentMemoryReferenceView>(partial).is_err());
}

#[test]
fn dd135_skills_preserve_fields_and_absence() {
    // DD-135(1)-(7): commands, definition/version/content views, the upload
    // request and both upload outcomes, the reference catalog and the
    // installation Skill status keep every field and keep absent optionals absent.
    let value: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(sample_path().with_file_name("skills.sample.json")).unwrap(),
    )
    .unwrap();
    fn roundtrip<T: serde::de::DeserializeOwned + serde::Serialize>(value: &serde_json::Value) {
        let typed: T = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(&serde_json::to_value(typed).unwrap(), value);
    }
    roundtrip::<contracts::ActionCommand>(&value["definitionCreateCommand"]);
    roundtrip::<contracts::ActionCommand>(&value["versionCreateCommand"]);
    roundtrip::<contracts::SkillDefinitionView>(&value["definitionView"]);
    roundtrip::<contracts::SkillVersionPage>(&value["versionPage"]);
    roundtrip::<contracts::SkillVersionContentView>(&value["contentView"]);
    roundtrip::<contracts::SkillArtifactUploadRequest>(&value["uploadRequest"]);
    roundtrip::<contracts::SkillArtifactUploadView>(&value["uploadAccepted"]);
    roundtrip::<contracts::SkillArtifactUploadView>(&value["uploadRejected"]);
    roundtrip::<contracts::SkillReferencePage>(&value["referencePage"]);
    roundtrip::<contracts::AgentInstallationSkillPage>(&value["installationSkills"]);
    let mut missing = value["definitionView"].clone();
    missing.as_object_mut().unwrap().remove("catalogShared");
    assert!(serde_json::from_value::<contracts::SkillDefinitionView>(missing).is_err());
    let mut unknown = value["installationSkills"].clone();
    unknown["skills"][0]["status"] = serde_json::json!("UNKNOWN_STATE");
    assert!(serde_json::from_value::<contracts::AgentInstallationSkillPage>(unknown).is_err());
}

#[test]
fn dd131_agent_snapshot_import_preserves_fields_and_absence() {
    // DD-131(2)/DD-143: the import command, upload request, both preview shapes,
    // the import configuration page and the RESOURCE_IMPORT advance pair keep
    // every field and keep absent optionals absent.
    let value: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(sample_path().with_file_name("agent-snapshot-import.sample.json"))
            .unwrap(),
    )
    .unwrap();
    fn roundtrip<T: serde::de::DeserializeOwned + serde::Serialize>(value: &serde_json::Value) {
        let typed: T = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(&serde_json::to_value(typed).unwrap(), value);
    }
    roundtrip::<contracts::ActionCommand>(&value["importCommand"]);
    roundtrip::<contracts::ActionCommand>(&value["minimalImportCommand"]);
    // DD-131(2): an imported DRAFT may lack runtime, route and reply policy and
    // carry empty instructions; absent stays absent through the typed side.
    roundtrip::<contracts::AgentVersionContent>(&value["draftContent"]);
    roundtrip::<contracts::AgentSnapshotUploadRequest>(&value["uploadRequest"]);
    roundtrip::<contracts::AgentSnapshotImportPreview>(&value["preview"]);
    roundtrip::<contracts::AgentSnapshotImportPreview>(&value["minimalPreview"]);
    roundtrip::<contracts::AgentImportConfigurationPage>(&value["configuration"]);
    roundtrip::<contracts::ResourceImportAdvanceRequest>(&value["advanceRequest"]);
    roundtrip::<contracts::ResourceImportAdvanceResult>(&value["advanceResult"]);
    let mut unknown = value["preview"].clone();
    unknown["omitted"][0] = serde_json::json!("SECRET");
    assert!(serde_json::from_value::<contracts::AgentSnapshotImportPreview>(unknown).is_err());
}

#[test]
fn dd131_agent_teams_preserve_fields_and_absence() {
    // DD-131(1)(6): team create/update/share commands, the team page (visible
    // members only, hidden count) and a catalog-shared definition view keep
    // every field and keep absent optionals absent.
    let value: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(sample_path().with_file_name("agent-teams.sample.json")).unwrap(),
    )
    .unwrap();
    fn roundtrip<T: serde::de::DeserializeOwned + serde::Serialize>(value: &serde_json::Value) {
        let typed: T = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(&serde_json::to_value(typed).unwrap(), value);
    }
    roundtrip::<contracts::ActionCommand>(&value["createCommand"]);
    roundtrip::<contracts::ActionCommand>(&value["updateCommand"]);
    roundtrip::<contracts::ActionCommand>(&value["shareCommand"]);
    roundtrip::<contracts::AgentTeamPage>(&value["teamPage"]);
    roundtrip::<contracts::AgentDefinitionView>(&value["sharedDefinitionView"]);
    let mut missing = value["teamPage"]["teams"][0].clone();
    missing.as_object_mut().unwrap().remove("catalogShared");
    assert!(serde_json::from_value::<contracts::AgentTeamView>(missing).is_err());
}

#[test]
fn dd131_agent_snapshot_export_preserves_fields_and_absence() {
    // DD-131(2)/DD-42: the export command, both ExportPackage view shapes and the
    // RESOURCE_EXPORT advance pair keep every field and keep absent optionals absent.
    let value: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(sample_path().with_file_name("agent-snapshot-export.sample.json"))
            .unwrap(),
    )
    .unwrap();
    fn roundtrip<T: serde::de::DeserializeOwned + serde::Serialize>(value: &serde_json::Value) {
        let typed: T = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(&serde_json::to_value(typed).unwrap(), value);
    }
    roundtrip::<contracts::ActionCommand>(&value["exportCommand"]);
    roundtrip::<contracts::ExportPackageView>(&value["creating"]);
    roundtrip::<contracts::ExportPackageView>(&value["ready"]);
    roundtrip::<contracts::ResourceExportAdvanceRequest>(&value["advanceRequest"]);
    roundtrip::<contracts::ResourceExportAdvanceResult>(&value["advanceResult"]);
    let mut unknown = value["ready"].clone();
    unknown["state"] = serde_json::json!("PUBLISHED");
    assert!(serde_json::from_value::<contracts::ExportPackageView>(unknown).is_err());
}

#[test]
fn dd131_team_snapshot_transfer_preserves_fields_and_absence() {
    // DD-131(3): the team import/export commands, the upload request, both team
    // preview shapes, a READY team package and the team RESOURCE_IMPORT advance
    // request keep every field and keep absent optionals absent.
    let value: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(sample_path().with_file_name("agent-team-snapshot.sample.json"))
            .unwrap(),
    )
    .unwrap();
    fn roundtrip<T: serde::de::DeserializeOwned + serde::Serialize>(value: &serde_json::Value) {
        let typed: T = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(&serde_json::to_value(typed).unwrap(), value);
    }
    roundtrip::<contracts::ActionCommand>(&value["importCommand"]);
    roundtrip::<contracts::ActionCommand>(&value["exportCommand"]);
    roundtrip::<contracts::AgentTeamSnapshotUploadRequest>(&value["uploadRequest"]);
    roundtrip::<contracts::AgentTeamSnapshotImportPreview>(&value["preview"]);
    roundtrip::<contracts::AgentTeamSnapshotImportPreview>(&value["minimalPreview"]);
    roundtrip::<contracts::ExportPackageView>(&value["readyPackage"]);
    roundtrip::<contracts::ResourceImportAdvanceRequest>(&value["importAdvanceRequest"]);
    let mut unknown = value["preview"].clone();
    unknown["members"][0]["omitted"][0] = serde_json::json!("SECRET");
    assert!(serde_json::from_value::<contracts::AgentTeamSnapshotImportPreview>(unknown).is_err());
}

#[test]
fn push_registration_roundtrip_keeps_proof_and_omits_token_from_view() {
    let raw =
        fs::read_to_string(sample_path().with_file_name("push-registration.sample.json")).unwrap();
    let sample: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let request: contracts::PushRegistrationRequest =
        serde_json::from_value(sample["request"].clone()).unwrap();
    assert_eq!(serde_json::to_value(request).unwrap(), sample["request"]);
    let view: contracts::PushRegistrationView =
        serde_json::from_value(sample["view"].clone()).unwrap();
    let back = serde_json::to_value(view).unwrap();
    assert_eq!(back, sample["view"]);
    // DD-151(1): the view never carries the provider token or its digest.
    assert!(back.get("token").is_none() && back.get("tokenDigest").is_none());
    let capability: contracts::PushCapability =
        serde_json::from_value(sample["capability"].clone()).unwrap();
    assert_eq!(
        serde_json::to_value(capability).unwrap(),
        sample["capability"]
    );
}
