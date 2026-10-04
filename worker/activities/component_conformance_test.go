package activities

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"apps/worker/internal/contracts/generated"
	"github.com/google/uuid"
)

func conformanceCandidateForTest(t *testing.T, handler http.HandlerFunc) (*componentCandidate, string) {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	token := uuid.NewString()
	digest, err := conformanceJSONDigest([]byte(`{"candidate":"isolated-fixture"}`))
	if err != nil {
		t.Fatal(err)
	}
	candidate, err := newComponentCandidate(generated.ComponentConformanceEnvironment{
		AdapterBaseURL: server.URL, ArtifactDigest: digest, MaxResponseBytes: 4096, MaxSteps: 32,
	})
	if err != nil {
		t.Fatal(err)
	}
	candidate.digestResponse = func(_ context.Context, step generated.PlanStep, body []byte, _ int64) (generated.ComponentConformanceWireDigests, error) {
		requestHash := sha256.Sum256([]byte(step.RequestJSON))
		responseHash, err := conformanceJSONDigest(body)
		out := generated.ComponentConformanceWireDigests{RequestDigest: hex.EncodeToString(requestHash[:]), ResponseDigest: responseHash}
		var response struct {
			ResultJSON *string `json:"resultJson"`
		}
		if err == nil && json.Unmarshal(body, &response) == nil && response.ResultJSON != nil {
			hash, hashErr := conformanceJSONDigest([]byte(*response.ResultJSON))
			if hashErr != nil {
				return out, hashErr
			}
			out.ResultDigest = &hash
		}
		return out, err
	}
	return candidate, token
}

func fixtureExpectedDigest(t *testing.T, step generated.PlanStep) string {
	t.Helper()
	digest, err := conformanceJSONDigest([]byte(step.ExpectedResponseJSON))
	if err != nil {
		t.Fatal(err)
	}
	return digest
}

func TestComponentConformanceCoreCanonicalBytes(t *testing.T) {
	path := os.Getenv("COMPONENT_CONFORMANCE_CANONICAL_EVIDENCE")
	if path == "" {
		t.Skip("Core canonical cross-language evidence not supplied")
	}
	var sample struct {
		RequestJSON          string                                    `json:"requestJson"`
		ResponseJSON         string                                    `json:"responseJson"`
		IdempotencyKey       string                                    `json:"idempotencyKey"`
		ExpectedResponseJSON string                                    `json:"expectedResponseJson"`
		Digests              generated.ComponentConformanceWireDigests `json:"digests"`
	}
	encoded, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err = decodeConformanceJSON(encoded, &sample); err != nil {
		t.Fatal(err)
	}
	candidate, token := conformanceCandidateForTest(t, func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil || string(body) != sample.RequestJSON {
			t.Error("Core canonical request bytes changed on Go wire")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, sample.ResponseJSON)
	})
	candidate.digestResponse = func(_ context.Context, _ generated.PlanStep, body []byte, _ int64) (generated.ComponentConformanceWireDigests, error) {
		if string(body) != sample.ResponseJSON {
			t.Error("observed response differs from Core-normalized actual bytes")
		}
		return sample.Digests, nil
	}
	contract := "fixture.read"
	step := generated.PlanStep{CaseKey: "core_canonical", StepKey: "wire", Operation: generated.AdapterProtocolOperation("execute"),
		IdempotencyKey: sample.IdempotencyKey, RequestJSON: sample.RequestJSON, ExpectedResponseJSON: sample.ExpectedResponseJSON, ExpectedHTTPStatus: http.StatusOK, ContractKey: &contract}
	observation := candidate.call(context.Background(), step, token)
	if sample.Digests.ResultDigest == nil {
		t.Fatal("Core result digest missing")
	}
	if err := verifyConformanceStep(step, observation, *sample.Digests.ResultDigest); err != nil {
		t.Fatal(err)
	}
	if observation.RequestDigest != sample.Digests.RequestDigest || observation.ResultDigest == nil || *observation.ResultDigest != *sample.Digests.ResultDigest {
		t.Fatal("Core canonical evidence changed across Go actual wire")
	}
}

func conformanceStepForTest() generated.PlanStep {
	key := uuid.NewString()
	return generated.PlanStep{
		CaseKey: "creation", StepKey: "create", Operation: generated.AdapterProtocolOperation("execute"),
		IdempotencyKey: key, RequestJSON: `{"idempotencyKey":"` + key + `","value":"fixture"}`,
		ExpectedResponseJSON: `{"created":1}`, ExpectedHTTPStatus: http.StatusOK,
	}
}

func TestComponentConformanceActualWireAndNativeIdempotency(t *testing.T) {
	var calls, effects atomic.Int32
	seen := make(map[string]bool)
	var expectedToken string
	nativeID, nativeStatus := uuid.NewString(), "done"
	observedAt := time.Now().UTC().Format(time.RFC3339Nano)
	var expectedResponse []byte
	candidate, token := conformanceCandidateForTest(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path != "/platform-adapter/v1/execute" || r.Method != http.MethodPost ||
			r.Header.Get("Authorization") != "Bearer "+expectedToken || r.ProtoMajor != 1 {
			t.Error("wire path, method, protocol or isolated identity mismatch")
		}
		var body map[string]string
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body["idempotencyKey"] != r.Header.Get("Idempotency-Key") {
			t.Error("body and header idempotency key mismatch")
		}
		if !seen[body["idempotencyKey"]] {
			seen[body["idempotencyKey"]] = true
			effects.Add(1)
		}
		w.Header().Set("Content-Type", "application/json")
		response := generated.ExecutionClass{
			IdempotencyKey: body["idempotencyKey"], NativeType: "fixture_task", NativeID: &nativeID,
			NativeStatus: &nativeStatus, PlatformStatus: generated.ExternalExecutionStatus("SUCCEEDED"),
			CancelCapability: generated.NativeCancelCapability("SUPPORTED"),
			LastObservedAt:   &observedAt, TerminalAt: &observedAt,
		}
		wire := map[string]any{"execution": response}
		expectedResponse, _ = json.Marshal(wire)
		if err := json.NewEncoder(w).Encode(wire); err != nil {
			t.Error(err)
		}
	})
	expectedToken = token
	step := conformanceStepForTest()
	first := candidate.call(context.Background(), step, token)
	second := candidate.call(context.Background(), step, token)
	expected, _ := conformanceJSONDigest(expectedResponse)
	if calls.Load() != 2 || effects.Load() != 1 || first.ErrorClass != nil || second.ErrorClass != nil ||
		first.ResponseDigest != expected || second.ResponseDigest != expected || first.NativeObservation == nil ||
		second.NativeObservation == nil || *first.NativeObservation.NativeID != *second.NativeObservation.NativeID {
		t.Fatalf("native fixture observations: calls=%d effects=%d first=%+v second=%+v", calls.Load(), effects.Load(), first, second)
	}
}

// Optional evidence handoff for the Core isolated database check. The report
// consists of observations from the actual production wire client, not a pass
// flag. The receiving check still verifies every observation and SQL invariant.
func TestComponentConformanceWirePersistenceEvidence(t *testing.T) {
	path := os.Getenv("COMPONENT_CONFORMANCE_WIRE_EVIDENCE")
	if path == "" {
		t.Skip("isolated Core persistence evidence destination not configured")
	}
	var effects atomic.Int32
	key, nativeID, nativeStatus := uuid.NewString(), uuid.NewString(), "done"
	observed := time.Now().UTC().Format(time.RFC3339Nano)
	var expectedToken string
	seen := false
	candidate, token := conformanceCandidateForTest(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.Header.Get("Authorization") != "Bearer "+expectedToken {
			t.Error("unexpected authenticated protocol call")
			w.WriteHeader(http.StatusForbidden)
			return
		}
		var request struct {
			IdempotencyKey string `json:"idempotencyKey"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil || request.IdempotencyKey != key {
			t.Error("changed frozen execution reference")
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		switch r.URL.Path {
		case "/platform-adapter/v1/execute":
			if !seen {
				effects.Add(1)
				seen = true
			}
		case "/platform-adapter/v1/observe":
			if !seen {
				t.Error("observation preceded native effect")
			}
		default:
			t.Error("unexpected adapter operation")
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"execution": generated.ExecutionClass{
			IdempotencyKey: key, NativeType: "fixture_task", NativeID: &nativeID, NativeStatus: &nativeStatus,
			PlatformStatus: generated.ExternalExecutionStatus("SUCCEEDED"), CancelCapability: generated.NativeCancelCapability("SUPPORTED"),
			LastObservedAt: &observed, TerminalAt: &observed,
		}})
	})
	expectedToken = token
	steps := make([]generated.PlanStep, 0)
	observations := make([]generated.ComponentConformanceStepObservation, 0)
	for index, operation := range []string{"execute", "execute", "observe"} {
		request, _ := json.Marshal(map[string]string{"idempotencyKey": key})
		expected, _ := json.Marshal(map[string]string{"idempotencyKey": key, "nativeType": "fixture_task", "platformStatus": "SUCCEEDED", "cancelCapability": "SUPPORTED"})
		step := generated.PlanStep{CaseKey: "protocol_execution_idempotency", StepKey: []string{"first", "duplicate", "observe"}[index],
			Operation: generated.AdapterProtocolOperation(operation), IdempotencyKey: key, RequestJSON: string(request), ExpectedResponseJSON: string(expected), ExpectedHTTPStatus: http.StatusOK}
		observation := candidate.call(context.Background(), step, token)
		if err := verifyConformanceStep(step, observation, fixtureExpectedDigest(t, step)); err != nil {
			t.Fatal(err)
		}
		steps = append(steps, step)
		observations = append(observations, observation)
	}
	if effects.Load() != 1 {
		t.Fatalf("duplicate native effects: %d", effects.Load())
	}
	digest, err := conformanceJSONDigest([]byte(`{"isolation":"wire-persistence-fixture"}`))
	if err != nil {
		t.Fatal(err)
	}
	plan := map[string]any{"actionExecutionId": uuid.NewString(), "operationId": uuid.NewString(), "componentReleaseId": uuid.NewString(),
		"workflowId": "isolated-wire-" + uuid.NewString(), "artifactDigest": candidate.configuration.ArtifactDigest,
		"contractDigests": []string{digest}, "suiteDigest": digest, "planDigest": digest, "steps": steps}
	report := make(map[string]any)
	for field, value := range plan {
		if field != "steps" {
			report[field] = value
		}
	}
	report["runId"], report["observations"] = uuid.NewString(), observations
	body, err := json.Marshal(map[string]any{"plan": plan, "report": report})
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, body, 0600); err != nil {
		t.Fatal(err)
	}
}

func TestComponentConformanceNativeTerminalRequiresEvidence(t *testing.T) {
	key, nativeID, nativeStatus := uuid.NewString(), uuid.NewString(), "done"
	now := time.Now().UTC()
	observedAt := now.Format(time.RFC3339Nano)
	native := generated.ExecutionClass{
		IdempotencyKey: key, NativeType: "fixture_task", NativeID: &nativeID, NativeStatus: &nativeStatus,
		PlatformStatus:   generated.ExternalExecutionStatus("SUCCEEDED"),
		CancelCapability: generated.NativeCancelCapability("SUPPORTED"), LastObservedAt: &observedAt, TerminalAt: &observedAt,
	}
	if !validNativeObservation(native, key) {
		t.Fatal("complete native evidence rejected")
	}
	for _, change := range []struct {
		name   string
		mutate func(*generated.ExecutionClass)
	}{
		{"wrong_reference", func(n *generated.ExecutionClass) { n.IdempotencyKey = uuid.NewString() }},
		{"unknown_state", func(n *generated.ExecutionClass) {
			n.PlatformStatus = generated.ExternalExecutionStatus("NEW_STATE")
		}},
		{"unknown_cancel", func(n *generated.ExecutionClass) {
			n.CancelCapability = generated.NativeCancelCapability("MAYBE")
		}},
		{"no_native_status", func(n *generated.ExecutionClass) { n.NativeStatus = nil }},
		{"no_terminal_time", func(n *generated.ExecutionClass) { n.TerminalAt = nil }},
		{"no_observation_time", func(n *generated.ExecutionClass) { n.LastObservedAt = nil }},
		{"running_marked_terminal", func(n *generated.ExecutionClass) {
			n.PlatformStatus = generated.ExternalExecutionStatus("RUNNING")
		}},
		{"future_terminal", func(n *generated.ExecutionClass) {
			future := now.Add(time.Second).Format(time.RFC3339Nano)
			n.TerminalAt = &future
		}},
	} {
		t.Run(change.name, func(t *testing.T) {
			changed := native
			change.mutate(&changed)
			if validNativeObservation(changed, key) {
				t.Fatal("inconsistent terminal evidence accepted")
			}
		})
	}
	// Native IDs can be absent before discovery; a status response must not
	// manufacture an ID. This is deliberately not a nonempty-ID success rule.
	native.NativeID = nil
	if !validNativeObservation(native, key) {
		t.Fatal("documented absent native ID rejected")
	}
}

func TestComponentConformanceHTTPAcceptanceIsNotTerminalEvidence(t *testing.T) {
	for _, response := range []string{`{"accepted":true}`, `{"platformStatus":"SUCCEEDED"}`, `{"idempotencyKey":"first","idempotencyKey":"second"}`} {
		t.Run(response, func(t *testing.T) {
			candidate, token := conformanceCandidateForTest(t, func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusAccepted)
				_, _ = w.Write([]byte(response))
			})
			out := candidate.call(context.Background(), conformanceStepForTest(), token)
			if out.ErrorClass == nil || string(*out.ErrorClass) != "UNKNOWN" || out.NativeObservation != nil {
				t.Fatalf("acceptance masqueraded as terminal: %+v", out)
			}
		})
	}
}

func TestComponentConformanceRejectsNestedDuplicateJSONKeys(t *testing.T) {
	for _, body := range []string{`{"a":1,"a":2}`, `{"a":[{"b":1,"b":2}]}`, `{"a":{"b":1,"\u0062":2}}`} {
		var value any
		if decodeConformanceJSON([]byte(body), &value) == nil {
			t.Fatalf("ambiguous JSON accepted: %s", body)
		}
	}
	var valid any
	if err := decodeConformanceJSON([]byte(`{"a":[{"b":1},{"b":2}]}`), &valid); err != nil {
		t.Fatal(err)
	}
}

func TestComponentConformanceMatchesNativeEvidenceWithoutPredictingTime(t *testing.T) {
	step := conformanceStepForTest()
	nativeID, nativeStatus := uuid.NewString(), "native_done"
	observedAt := time.Now().UTC().Format(time.RFC3339Nano)
	native := generated.ExecutionClass{
		IdempotencyKey: step.IdempotencyKey, NativeType: "fixture_task", NativeID: &nativeID,
		NativeStatus: &nativeStatus, PlatformStatus: generated.ExternalExecutionStatus("SUCCEEDED"),
		CancelCapability: generated.NativeCancelCapability("SUPPORTED"), LastObservedAt: &observedAt, TerminalAt: &observedAt,
	}
	expected := native
	expected.NativeID, expected.LastObservedAt, expected.TerminalAt = nil, nil, nil
	encoded, _ := json.Marshal(expected)
	step.ExpectedResponseJSON = string(encoded)
	observation := generated.ComponentConformanceStepObservation{HTTPStatus: http.StatusOK, NativeObservation: &native}
	if err := verifyConformanceStep(step, observation, fixtureExpectedDigest(t, step)); err != nil {
		t.Fatal(err)
	}
	native.PlatformStatus = generated.ExternalExecutionStatus("RUNNING")
	if verifyConformanceStep(step, observation, fixtureExpectedDigest(t, step)) == nil {
		t.Fatal("running native task satisfied expected success")
	}
	native.PlatformStatus = generated.ExternalExecutionStatus("SUCCEEDED")
	native.IdempotencyKey = uuid.NewString()
	if verifyConformanceStep(step, observation, fixtureExpectedDigest(t, step)) == nil {
		t.Fatal("another execution satisfied frozen expectation")
	}
}

func TestComponentConformanceRejectsSecretEchoWithoutPublishingBody(t *testing.T) {
	var token string
	candidate, secret := conformanceCandidateForTest(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"leak": token})
	})
	token = secret
	observation := candidate.call(context.Background(), conformanceStepForTest(), token)
	if observation.ErrorClass == nil || string(*observation.ErrorClass) != "DENIED" || observation.ResponseDigest != "" {
		t.Fatalf("secret echo was not rejected: %+v", observation)
	}
	encoded, _ := json.Marshal(observation)
	if strings.Contains(string(encoded), token) {
		t.Fatal("secret leaked into report")
	}
}

func TestComponentConformanceDoesNotFollowRedirectOrRetryInvalidResponse(t *testing.T) {
	var redirected, calls atomic.Int32
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { redirected.Add(1) }))
	defer destination.Close()
	candidate, token := conformanceCandidateForTest(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		http.Redirect(w, r, destination.URL, http.StatusTemporaryRedirect)
	})
	observation := candidate.call(context.Background(), conformanceStepForTest(), token)
	if calls.Load() != 1 || redirected.Load() != 0 || observation.ErrorClass == nil || string(*observation.ErrorClass) != "UNKNOWN" {
		t.Fatalf("redirect/retry boundary failed: original=%d destination=%d observation=%+v", calls.Load(), redirected.Load(), observation)
	}
}

func TestComponentConformanceRejectsHeaderBodyMismatchBeforeDispatch(t *testing.T) {
	var calls atomic.Int32
	candidate, token := conformanceCandidateForTest(t, func(w http.ResponseWriter, r *http.Request) { calls.Add(1) })
	step := conformanceStepForTest()
	step.IdempotencyKey = uuid.NewString()
	observation := candidate.call(context.Background(), step, token)
	if calls.Load() != 0 || observation.ErrorClass == nil || string(*observation.ErrorClass) != "PRECONDITION" {
		t.Fatalf("mismatched idempotency key dispatched: %+v", observation)
	}
}

func TestComponentConformanceBodyLimitAndInvalidJSONRemainUnknown(t *testing.T) {
	for _, response := range []string{`{"ok":true} {"second":true}`, `{"data":"` + strings.Repeat("x", 4096) + `"}`, `null trailing`} {
		t.Run(response[:6], func(t *testing.T) {
			var calls atomic.Int32
			candidate, token := conformanceCandidateForTest(t, func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(response))
			})
			observation := candidate.call(context.Background(), conformanceStepForTest(), token)
			if calls.Load() != 1 || observation.ErrorClass == nil || string(*observation.ErrorClass) != "UNKNOWN" {
				t.Fatalf("invalid response accepted or repeated: %+v", observation)
			}
		})
	}
}

func TestComponentConformancePlanDigestCoversWireArguments(t *testing.T) {
	candidate, _ := conformanceCandidateForTest(t, func(w http.ResponseWriter, r *http.Request) { t.Error("validation made an external request") })
	plan := generated.PlanClass{
		ActionExecutionID: uuid.NewString(), OperationID: uuid.NewString(), ComponentReleaseID: uuid.NewString(),
		WorkflowID: uuid.NewString(), ArtifactDigest: candidate.configuration.ArtifactDigest,
		ContractDigests: []string{candidate.configuration.ArtifactDigest}, SuiteDigest: candidate.configuration.ArtifactDigest,
		Steps: []generated.PlanStep{conformanceStepForTest()},
	}
	encoded, _ := json.Marshal(plan)
	plan.PlanDigest, _ = conformanceJSONDigest(encoded)
	plan.RunID = uuid.NewString()
	if err := candidate.validatePlan(plan); err != nil {
		t.Fatal(err)
	}
	plan.Steps[0].RequestJSON = `{"idempotencyKey":"changed"}`
	if candidate.validatePlan(plan) == nil {
		t.Fatal("wire argument mutation did not invalidate frozen digest")
	}
}
