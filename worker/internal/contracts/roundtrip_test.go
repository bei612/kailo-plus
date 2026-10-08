// 四侧 round-trip 的 Go 一侧（ADR-03）。
//
// 反序列化再序列化必须与样例语义相等。它验证生成类型没有丢字段、
// 没有把可选当必填、没有把缺省字段写成 null。
package contracts

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"apps/worker/internal/contracts/generated"
)

func TestProjectPreferenceRoundtrip(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "samples", "project-preference.sample.json"))
	if err != nil {
		t.Fatal(err)
	}
	var typed []generated.ProjectPreferenceRequest
	if err := json.Unmarshal(raw, &typed); err != nil {
		t.Fatal(err)
	}
	back, err := json.Marshal(typed)
	if err != nil {
		t.Fatal(err)
	}
	var expected, actual any
	if err := json.Unmarshal(raw, &expected); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(back, &actual); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(actual, expected) {
		t.Fatal("Project preference CAS changed")
	}
}

func TestProjectsPublicationRoundtrip(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "samples", "projects-publication.sample.json"))
	if err != nil {
		t.Fatal(err)
	}
	var typed []generated.ProjectsPublishRequest
	if err := json.Unmarshal(raw, &typed); err != nil {
		t.Fatal(err)
	}
	back, err := json.Marshal(typed)
	if err != nil {
		t.Fatal(err)
	}
	var expected, actual any
	if err := json.Unmarshal(raw, &expected); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(back, &actual); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(actual, expected) {
		t.Fatal("Projects metadata or exact head changed")
	}
}

func TestInboxAgentRoundtrip(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "samples", "inbox-agent.sample.json"))
	if err != nil {
		t.Fatal(err)
	}
	for _, present := range []bool{true, false} {
		var value map[string]map[string]any
		if err := json.Unmarshal(raw, &value); err != nil {
			t.Fatal(err)
		}
		if !present {
			delete(value["query"], "agentInstallationId")
			delete(value["installation"], "agentPubkey")
		}
		input, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		var typed struct {
			Query        generated.WebMessageQuery       `json:"query"`
			Installation generated.AgentInstallationView `json:"installation"`
		}
		if err := json.Unmarshal(input, &typed); err != nil {
			t.Fatal(err)
		}
		back, err := json.Marshal(typed)
		if err != nil {
			t.Fatal(err)
		}
		var actual map[string]map[string]any
		if err := json.Unmarshal(back, &actual); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(actual, value) {
			t.Fatal("Inbox Agent fields changed")
		}
	}
}

func TestCustomEmojiRoundtrip(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "samples", "web-custom-emoji.sample.json"))
	if err != nil {
		t.Fatal(err)
	}
	var sample struct {
		Add    generated.WebCustomEmojiMutation `json:"add"`
		Remove generated.WebCustomEmojiMutation `json:"remove"`
		View   generated.WebCustomEmojiView     `json:"view"`
	}
	if err := json.Unmarshal(raw, &sample); err != nil {
		t.Fatal(err)
	}
	back, err := json.Marshal(sample)
	if err != nil {
		t.Fatal(err)
	}
	var actual, expected any
	if err := json.Unmarshal(raw, &expected); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(back, &actual); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(actual, expected) {
		t.Fatalf("roundtrip mismatch: %s", back)
	}
}

func TestAgentVersionAvatarProjectionRoundtrip(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "samples", "agent-version-view.sample.json"))
	if err != nil {
		t.Fatal(err)
	}
	var sample map[string]any
	if err := json.Unmarshal(raw, &sample); err != nil {
		t.Fatal(err)
	}
	for _, include := range []bool{true, false} {
		if !include {
			delete(sample, "avatarMediaPaths")
		}
		input, err := json.Marshal(sample)
		if err != nil {
			t.Fatal(err)
		}
		var typed generated.AgentVersionView
		if err := json.Unmarshal(input, &typed); err != nil {
			t.Fatal(err)
		}
		if (typed.AvatarMediaPaths != nil) != include {
			t.Fatal("avatar projection presence changed")
		}
		encoded, err := json.Marshal(typed)
		if err != nil {
			t.Fatal(err)
		}
		var back map[string]any
		if err := json.Unmarshal(encoded, &back); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(sample, back) {
			t.Fatalf("avatar roundtrip changed fields: %s", encoded)
		}
	}
}

func TestNativeHumanActionRoundtrip(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "samples", "native-human-action.sample.json"))
	if err != nil {
		t.Fatal(err)
	}
	var sample struct {
		Trust           generated.ApplicationNativeHumanIdentity `json:"trust"`
		Request         generated.NativeHumanActionRequest       `json:"request"`
		Result          generated.NativeHumanActionResult        `json:"result"`
		ResourceRequest generated.NativeHumanActionRequest       `json:"resourceRequest"`
		ResourceResult  generated.NativeHumanResourceResult      `json:"resourceResult"`
	}
	if err := json.Unmarshal(raw, &sample); err != nil {
		t.Fatal(err)
	}
	back, err := json.Marshal(sample)
	if err != nil {
		t.Fatal(err)
	}
	var actual, expected any
	if err := json.Unmarshal(raw, &expected); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(back, &actual); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(actual, expected) {
		t.Fatalf("roundtrip mismatch: %s", back)
	}
}

func TestAutomationTopicStepRoundtrip(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "samples", "automation-topic-step.sample.json"))
	if err != nil {
		t.Fatal(err)
	}
	var typed generated.AutomationStep
	if err := json.Unmarshal(raw, &typed); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(typed)
	if err != nil {
		t.Fatal(err)
	}
	var expected, actual any
	if err := json.Unmarshal(raw, &expected); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(encoded, &actual); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(actual, expected) {
		t.Fatalf("roundtrip: %s", encoded)
	}
}

func TestReadReceiptsPreserveNativePrecision(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "samples", "adapter-read-receipts.sample.json"))
	if err != nil {
		t.Fatal(err)
	}
	var typed []generated.AdapterReadReceipt
	if err := json.Unmarshal(raw, &typed); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(typed)
	if err != nil {
		t.Fatal(err)
	}
	var before, after any
	if err := json.Unmarshal(raw, &before); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(encoded, &after); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, after) {
		t.Fatal("native receipt metadata changed")
	}
}

func TestAutomationReactionStepRoundtrip(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "samples", "automation-reaction-step.sample.json"))
	if err != nil {
		t.Fatal(err)
	}
	var typed generated.AutomationStep
	if err := json.Unmarshal(raw, &typed); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(typed)
	if err != nil {
		t.Fatal(err)
	}
	var expected, actual any
	if err := json.Unmarshal(raw, &expected); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(encoded, &actual); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(actual, expected) {
		t.Fatalf("roundtrip: %s", encoded)
	}
}

func TestApplicationReadResourcesRoundtrip(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "samples", "application-read-resources.sample.json"))
	if err != nil {
		t.Fatal(err)
	}
	var value struct {
		Page    generated.ApplicationReadResourcePage `json:"page"`
		Binding generated.ApplicationBindingView      `json:"binding"`
	}
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var before, after any
	if err := json.Unmarshal(raw, &before); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(encoded, &after); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, after) {
		t.Fatal("resource metadata or receiver availability changed")
	}
	value.Binding.HasReadReceiver = nil
	legacy, err := json.Marshal(value.Binding)
	if err != nil {
		t.Fatal(err)
	}
	var old map[string]any
	if err := json.Unmarshal(legacy, &old); err != nil {
		t.Fatal(err)
	}
	if _, ok := old["hasReadReceiver"]; ok {
		t.Fatal("legacy response gained availability")
	}
}

func TestServiceReadPermissionRoundtrip(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "samples", "resource-service-read-permission.sample.json"))
	if err != nil {
		t.Fatal(err)
	}
	for _, service := range []bool{true, false} {
		var expected map[string]any
		if err := json.Unmarshal(raw, &expected); err != nil {
			t.Fatal(err)
		}
		if !service {
			delete(expected, "receiverResource")
		}
		wire, err := json.Marshal(expected)
		if err != nil {
			t.Fatal(err)
		}
		var typed generated.ActionCommand
		if err := json.Unmarshal(wire, &typed); err != nil {
			t.Fatal(err)
		}
		back, err := json.Marshal(typed)
		if err != nil {
			t.Fatal(err)
		}
		var actual map[string]any
		if err := json.Unmarshal(back, &actual); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(expected, actual) {
			t.Fatal("receiver Resource reference or legacy absence changed")
		}
	}
}

func TestAutomationApprovalStepRoundtrip(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "samples", "automation-approval-step.sample.json"))
	if err != nil {
		t.Fatal(err)
	}
	var sample struct {
		Step generated.AutomationStep             `json:"step"`
		View generated.AutomationApprovalStepView `json:"view"`
	}
	if err := json.Unmarshal(raw, &sample); err != nil {
		t.Fatal(err)
	}
	back, err := json.Marshal(sample)
	if err != nil {
		t.Fatal(err)
	}
	var expected, actual any
	if err := json.Unmarshal(raw, &expected); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(back, &actual); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(expected, actual) {
		t.Fatal("approval step lost policy or immutable reference")
	}
}

func TestReceiverReadGrantRoundtrip(t *testing.T) {
	for _, sample := range []struct {
		name  string
		typed any
	}{
		{"adapter-read-grant-request.sample.json", &generated.AdapterReadGrantRequest{}},
		{"adapter-native-read-grant-request.sample.json", &generated.AdapterReadGrantRequest{}},
		{"adapter-native-read-grant-responses.sample.json", &[]generated.AdapterReadGrantResponse{}},
		{"file-storage-list-output.sample.json", &generated.FileStorageListOutput{}},
		{"adapter-read-grant-response.sample.json", &generated.AdapterReadGrantResponse{}},
	} {
		t.Run(sample.name, func(t *testing.T) {
			raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "samples", sample.name))
			if err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal(raw, sample.typed); err != nil {
				t.Fatal(err)
			}
			back, err := json.Marshal(sample.typed)
			if err != nil {
				t.Fatal(err)
			}
			var expected, actual any
			if err := json.Unmarshal(raw, &expected); err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal(back, &actual); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(expected, actual) {
				t.Fatal("receiver read grant lost source or receiver provenance")
			}
		})
	}
}

func TestConformanceIdentityRoundtrip(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "samples", "component-conformance-identity.sample.json"))
	if err != nil {
		t.Fatal(err)
	}
	var typed generated.ComponentConformanceIdentity
	if err := json.Unmarshal(raw, &typed); err != nil {
		t.Fatal(err)
	}
	back, err := json.Marshal(typed)
	if err != nil {
		t.Fatal(err)
	}
	var expected, actual any
	if err := json.Unmarshal(raw, &expected); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(back, &actual); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(expected, actual) {
		t.Fatal("isolated conformance identity lost fields")
	}
}

func TestMemberRemovalPermissionsRoundtrip(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "samples", "member-action-availability.sample.json"))
	if err != nil {
		t.Fatal(err)
	}
	for _, permission := range []any{true, false, nil} {
		var value map[string]any
		if err := json.Unmarshal(raw, &value); err != nil {
			t.Fatal(err)
		}
		row := value["members"].([]any)[0].(map[string]any)
		for _, key := range []string{"canRemoveFromWorkspace", "canRemoveFromTenant"} {
			if permission == nil {
				delete(row, key)
			} else {
				row[key] = permission
			}
		}
		input, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		var typed generated.RoleMemberPage
		if err := json.Unmarshal(input, &typed); err != nil {
			t.Fatal(err)
		}
		back, err := json.Marshal(typed)
		if err != nil {
			t.Fatal(err)
		}
		var got map[string]any
		if err := json.Unmarshal(back, &got); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(value, got) {
			t.Fatal("Member removal permissions lost")
		}
	}
}

func TestInstallationUpgradeRoundtrip(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "samples", "agent-installation-upgrade.sample.json"))
	if err != nil {
		t.Fatal(err)
	}
	for _, permission := range []any{true, false, nil} {
		var value map[string]any
		if err := json.Unmarshal(raw, &value); err != nil {
			t.Fatal(err)
		}
		if permission == nil {
			delete(value, "canUpgrade")
		} else {
			value["canUpgrade"] = permission
		}
		input, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		var typed generated.AgentInstallationView
		if err := json.Unmarshal(input, &typed); err != nil {
			t.Fatal(err)
		}
		back, err := json.Marshal(typed)
		if err != nil {
			t.Fatal(err)
		}
		var got map[string]any
		if err := json.Unmarshal(back, &got); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(value, got) {
			t.Fatal("Installation upgrade permission lost")
		}
	}
}

func TestProjectsQueryRoundtrip(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "samples", "projects-query.sample.json"))
	if err != nil {
		t.Fatal(err)
	}
	for _, input := range [][]byte{raw, []byte(`{"view":"PROJECTS"}`)} {
		var typed generated.ProjectsQueryRequest
		if err := json.Unmarshal(input, &typed); err != nil {
			t.Fatal(err)
		}
		back, err := json.Marshal(typed)
		if err != nil {
			t.Fatal(err)
		}
		var want, got any
		if err := json.Unmarshal(input, &want); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(back, &got); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(want, got) {
			t.Fatalf("Projects query lost fields")
		}
	}
}

func TestCapabilitySeedEvidenceRoundtrip(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "samples", "capability-seed-page.sample.json"))
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	for _, seeded := range []bool{true, false} {
		if !seeded {
			row := value["contracts"].([]any)[0].(map[string]any)
			row["registeredByActionExecutionId"] = row["bootstrapActionExecutionId"]
			delete(row, "bootstrapActionExecutionId")
		}
		encoded, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		var typed generated.CapabilityContractPage
		if err := json.Unmarshal(encoded, &typed); err != nil {
			t.Fatal(err)
		}
		back, err := json.Marshal(typed)
		if err != nil {
			t.Fatal(err)
		}
		var actual map[string]any
		if err := json.Unmarshal(back, &actual); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(actual, value) {
			t.Fatal("seed and human evidence changed")
		}
	}
}

func TestComponentPeerConformanceRoundtrip(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "samples", "component-peer-conformance.sample.json"))
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	for _, include := range []bool{true, false} {
		if !include {
			delete(value, "nativeCredentials")
		}
		encoded, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		var typed generated.ComponentProtocolPeerEnvironment
		if err := json.Unmarshal(encoded, &typed); err != nil {
			t.Fatal(err)
		}
		back, err := json.Marshal(typed)
		if err != nil {
			t.Fatal(err)
		}
		var actual map[string]any
		if err := json.Unmarshal(back, &actual); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(actual, value) {
			t.Fatal("conformance native reference or legacy absence changed")
		}
	}
}

func TestPulseRoundtrip(t *testing.T) {
	for name, target := range map[string]any{"pulse-publish.sample.json": &generated.PulsePublishRequest{}, "pulse-query.sample.json": &generated.PulseQueryRequest{}} {
		raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "samples", name))
		if err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(raw, target); err != nil {
			t.Fatal(err)
		}
		encoded, err := json.Marshal(target)
		if err != nil {
			t.Fatal(err)
		}
		var before, after any
		if err := json.Unmarshal(raw, &before); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(encoded, &after); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(before, after) {
			t.Fatalf("Pulse roundtrip changed %s", name)
		}
	}
	for _, raw := range []string{`{"relayUrl":"wss://relay.example","communityHost":"relay.example"}`, `{"relayUrl":"wss://relay.example","communityHost":"relay.example","relayQueryLimit":100}`} {
		var typed generated.NativeCommunityFacts
		if err := json.Unmarshal([]byte(raw), &typed); err != nil {
			t.Fatal(err)
		}
		encoded, err := json.Marshal(typed)
		if err != nil {
			t.Fatal(err)
		}
		var before, after any
		_ = json.Unmarshal([]byte(raw), &before)
		_ = json.Unmarshal(encoded, &after)
		if !reflect.DeepEqual(before, after) {
			t.Fatal("optional native limit changed")
		}
	}
}

func TestWorkspaceMembershipProjection(t *testing.T) {
	for _, raw := range []string{
		`{"id":"scope","name":"Scope","slug":"scope"}`,
		`{"id":"scope","name":"Scope","slug":"scope","isMember":false}`,
		`{"id":"scope","name":"Scope","slug":"scope","isMember":true}`,
	} {
		var typed generated.WorkspaceView
		if err := json.Unmarshal([]byte(raw), &typed); err != nil {
			t.Fatal(err)
		}
		encoded, err := json.Marshal(typed)
		if err != nil {
			t.Fatal(err)
		}
		var expected, actual any
		if err := json.Unmarshal([]byte(raw), &expected); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(encoded, &actual); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(expected, actual) {
			t.Fatalf("membership evidence changed: %s", encoded)
		}
	}
}

func TestApplicationBindingProtocolRoundtrip(t *testing.T) {
	for _, fixture := range []struct {
		name   string
		target any
	}{
		{"delegated-action-metadata.sample.json", new(generated.DelegatedActionMetadataV1)},
		{"application-model-admission.sample.json", new(generated.ApplicationModelAdmission)},
		{"application-model-config.sample.json", new(generated.ApplicationModelGatewayConfig)},
		{"application-peer-credentials.sample.json", new(generated.ApplicationAdapterDirectory)},
		{"application-model-delivery.sample.json", new(generated.ApplicationAdapterDirectory)},
		{"application-native-resources.sample.json", new(generated.ApplicationAdapterDirectory)},
		{"application-binding-observations.sample.json", new([]generated.AdapterBindingObservation)},
		{"adapter-execution-references.sample.json", new([]generated.AdapterExecutionReference)},
		{"resource-create.sample.json", new(generated.ActionCommand)},
		{"resource-provision.sample.json", new(generated.ResourceProvisionAdvanceRequest)},
		{"conversation-open.sample.json", new(generated.ActionCommand)},
		{"conversation-preference.sample.json", new(generated.ConversationPreferenceRequest)},
		{"workspace-channel-create.sample.json", new(generated.ActionCommand)},
		{"workspace-public-create.sample.json", new(generated.ActionCommand)},
		{"workspace-join.sample.json", new(generated.ActionCommand)},
		{"discoverable-workspaces.sample.json", new(generated.DiscoverableWorkspacePage)},
		{"conversation-participants.sample.json", new(generated.ConversationParticipantPage)},
		{"conversation-page.sample.json", new(generated.ConversationPage)},
		{"conversation-projection.sample.json", new(generated.ConversationProjectionRequest)},
		{"web-forum-post.sample.json", new(generated.WebPublishMessageRequest)},
		{"web-forum-comment.sample.json", new(generated.WebPublishMessageRequest)},
		{"web-forum-query.sample.json", new(generated.WebMessageQuery)},
		{"web-message-query-legacy.sample.json", new(generated.WebMessageQuery)},
		{"web-message-cursor.sample.json", new(generated.WebMessageCursor)},
		{"web-forum-channel.sample.json", new(generated.WebChannelView)},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "samples", fixture.name))
			if err != nil {
				t.Fatal(err)
			}
			var original any
			if err := json.Unmarshal(raw, &original); err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal(raw, fixture.target); err != nil {
				t.Fatal(err)
			}
			encoded, err := json.Marshal(fixture.target)
			if err != nil {
				t.Fatal(err)
			}
			var back any
			if err := json.Unmarshal(encoded, &back); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(original, back) {
				t.Fatalf("binding protocol reference changed: %s", encoded)
			}
		})
	}
}

func TestNativePageRoundtrip(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "samples", "application-native-page.sample.json"))
	if err != nil {
		t.Fatal(err)
	}
	var original any
	if err := json.Unmarshal(raw, &original); err != nil {
		t.Fatal(err)
	}
	var typed generated.ApplicationNativePage
	if err := json.Unmarshal(raw, &typed); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(typed)
	if err != nil {
		t.Fatal(err)
	}
	var back any
	if err := json.Unmarshal(encoded, &back); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(original, back) {
		t.Fatalf("native page reference changed: %s", encoded)
	}
}

func TestComponentObservationsRoundtrip(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "samples", "component-conformance-observations.sample.json"))
	if err != nil {
		t.Fatal(err)
	}
	var original any
	if err := json.Unmarshal(raw, &original); err != nil {
		t.Fatal(err)
	}
	var typed []generated.ComponentConformanceStepObservation
	if err := json.Unmarshal(raw, &typed); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(typed)
	if err != nil {
		t.Fatal(err)
	}
	var back any
	if err := json.Unmarshal(encoded, &back); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(original, back) {
		t.Fatalf("component reference or UNKNOWN evidence changed: %s", encoded)
	}
}

func TestComponentReleaseApprovalRoundtrip(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "samples", "component-release-approval.sample.json"))
	if err != nil {
		t.Fatal(err)
	}
	var original any
	if err := json.Unmarshal(raw, &original); err != nil {
		t.Fatal(err)
	}
	var typed generated.ComponentReleaseApprovalReport
	if err := json.Unmarshal(raw, &typed); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(typed)
	if err != nil {
		t.Fatal(err)
	}
	var back any
	if err := json.Unmarshal(encoded, &back); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(original, back) {
		t.Fatalf("approval report changed wire fields: %s", encoded)
	}
}

func TestAutomationRunPagesRoundtrip(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "samples", "automation-run-pages.sample.json"))
	if err != nil {
		t.Fatal(err)
	}
	var original any
	if err := json.Unmarshal(raw, &original); err != nil {
		t.Fatal(err)
	}
	var typed []generated.AutomationRunPage
	if err := json.Unmarshal(raw, &typed); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(typed)
	if err != nil {
		t.Fatal(err)
	}
	var back any
	if err := json.Unmarshal(encoded, &back); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(original, back) {
		t.Fatalf("run history round-trip changed fields: %s", encoded)
	}
}

func TestAutomationManualDeleteRoundtrip(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "samples", "automation-manual-delete.sample.json"))
	if err != nil {
		t.Fatal(err)
	}
	var original any
	if err := json.Unmarshal(raw, &original); err != nil {
		t.Fatal(err)
	}
	var typed []generated.AutomationDetailView
	if err := json.Unmarshal(raw, &typed); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(typed)
	if err != nil {
		t.Fatal(err)
	}
	var back any
	if err := json.Unmarshal(encoded, &back); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(original, back) {
		t.Fatalf("manual/tombstone roundtrip lost wire fields: %s", encoded)
	}
}

func TestAutomationPostMessageRoundtrip(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "samples", "automation-post-message.sample.json"))
	if err != nil {
		t.Fatal(err)
	}
	var original any
	if err := json.Unmarshal(raw, &original); err != nil {
		t.Fatal(err)
	}
	var typed generated.AutomationVersionContent
	if err := json.Unmarshal(raw, &typed); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(typed)
	if err != nil {
		t.Fatal(err)
	}
	var back any
	if err := json.Unmarshal(encoded, &back); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(original, back) {
		t.Fatalf("POST_MESSAGE round-trip changed fields: %s", encoded)
	}
}

func TestAutomationCronRoundtrip(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "samples", "automation-cron.sample.json"))
	if err != nil {
		t.Fatal(err)
	}
	var original any
	if err := json.Unmarshal(raw, &original); err != nil {
		t.Fatal(err)
	}
	var typed []generated.AutomationVersionContent
	if err := json.Unmarshal(raw, &typed); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(typed)
	if err != nil {
		t.Fatal(err)
	}
	var back any
	if err := json.Unmarshal(encoded, &back); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(original, back) {
		t.Fatalf("cron/legacy interval round-trip changed fields: %s", encoded)
	}
}

func TestAutomationStepsRoundtrip(t *testing.T) {
	for _, name := range []string{"automation-steps.sample.json", "automation-message-sequence.sample.json", "automation-trigger-filter.sample.json"} {
		raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "samples", name))
		if err != nil {
			t.Fatal(err)
		}
		var original any
		if err := json.Unmarshal(raw, &original); err != nil {
			t.Fatal(err)
		}
		var typed generated.AutomationVersionContent
		if err := json.Unmarshal(raw, &typed); err != nil {
			t.Fatal(err)
		}
		if typed.Action != nil {
			t.Fatal("ordered version cannot silently become a legacy action")
		}
		encoded, err := json.Marshal(typed)
		if err != nil {
			t.Fatal(err)
		}
		var back any
		if err := json.Unmarshal(encoded, &back); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(original, back) {
			t.Fatal("ordered steps changed during serialization")
		}
	}
}

func TestCanaryRoundtripPreservesEveryField(t *testing.T) {
	// 相对本包定位样例，不依赖调用时的工作目录
	path := filepath.Join("..", "..", "..", "contracts", "samples", "canary.sample.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("读取样例: %v", err)
	}

	var original map[string]any
	if err := json.Unmarshal(raw, &original); err != nil {
		t.Fatalf("样例不是合法 JSON: %v", err)
	}

	var typed generated.Canary
	if err := json.Unmarshal(raw, &typed); err != nil {
		t.Fatalf("反序列化为生成类型: %v", err)
	}

	encoded, err := json.Marshal(typed)
	if err != nil {
		t.Fatalf("再序列化: %v", err)
	}

	var back map[string]any
	if err := json.Unmarshal(encoded, &back); err != nil {
		t.Fatalf("再序列化结果不是合法 JSON: %v", err)
	}

	if !reflect.DeepEqual(original, back) {
		t.Fatalf("round-trip 后与样例不等，说明生成类型丢了信息\n样例: %s\n结果: %s", raw, encoded)
	}
}

func TestWebPublishMessageRoundtrip(t *testing.T) {
	for _, sample := range []string{"web-publish-mention.sample.json", "web-publish-content-only.sample.json", "web-message-edit.sample.json", "web-message-delete.sample.json"} {
		t.Run(sample, func(t *testing.T) {
			raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "samples", sample))
			if err != nil {
				t.Fatal(err)
			}
			var original map[string]any
			if err := json.Unmarshal(raw, &original); err != nil {
				t.Fatal(err)
			}
			var typed generated.WebPublishMessageRequest
			if err := json.Unmarshal(raw, &typed); err != nil {
				t.Fatal(err)
			}
			encoded, err := json.Marshal(typed)
			if err != nil {
				t.Fatal(err)
			}
			var back map[string]any
			if err := json.Unmarshal(encoded, &back); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(original, back) {
				t.Fatalf("round-trip changed fields: %s", encoded)
			}
		})
	}
}

func TestCapabilityVectorsRoundtrip(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "samples", "capability-conformance-vectors.sample.json"))
	if err != nil {
		t.Fatal(err)
	}
	var original map[string]any
	if err := json.Unmarshal(raw, &original); err != nil {
		t.Fatal(err)
	}
	var typed generated.CapabilityConformanceVectors
	if err := json.Unmarshal(raw, &typed); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(typed)
	if err != nil {
		t.Fatal(err)
	}
	var back map[string]any
	if err := json.Unmarshal(encoded, &back); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(original, back) {
		t.Fatalf("vector round-trip changed fields: %s", encoded)
	}
}
