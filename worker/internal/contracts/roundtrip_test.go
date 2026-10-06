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
		{"application-binding-observations.sample.json", new([]generated.AdapterBindingObservation)},
		{"adapter-execution-references.sample.json", new([]generated.AdapterExecutionReference)},
		{"resource-create.sample.json", new(generated.ActionCommand)},
		{"resource-provision.sample.json", new(generated.ResourceProvisionAdvanceRequest)},
		{"conversation-open.sample.json", new(generated.ActionCommand)},
		{"conversation-preference.sample.json", new(generated.ConversationPreferenceRequest)},
		{"workspace-channel-create.sample.json", new(generated.ActionCommand)},
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
	for _, sample := range []string{"web-publish-mention.sample.json", "web-publish-content-only.sample.json"} {
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
