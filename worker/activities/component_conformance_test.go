package activities

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"apps/worker/internal/contracts/generated"
	"apps/worker/internal/oidc"
	"github.com/google/uuid"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/testsuite"
)

func TestNativeReceiverConformanceReadsIsolatedCoreAuthority(t *testing.T) {
	for _, scenario := range []string{"committed", "missing-ae", "changed-receipt", "changed-generation", "unexpected-token", "wrong-binding", "duplicate-delivery", "missing-delivery"} {
		t.Run(scenario, func(t *testing.T) {
			binding, batch, source, execution, child, operation, key := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
			importConfig := uuid.NewString()
			request := generated.ComponentNativeReceiverRequest{BindingID: binding, Generation: 3, ImportConfigRef: &importConfig, IdempotencyKey: key, ExpiresAt: time.Now().Add(time.Hour).UTC().Format(time.RFC3339)}
			rawRequest, _ := json.Marshal(request)
			completedAt := time.Now().UTC().Format(time.RFC3339)
			receipt := func(owner, role string) map[string]any {
				return map[string]any{"bindingId": owner, "role": role, "operationId": operation, "idempotencyKey": key,
					"nativeObjectRef": "original-object", "nativeRevision": "original-revision", "contentSha256": strings.Repeat("a", 64),
					"contentBytes": 0, "completedAt": completedAt, "measurements": []any{}}
			}
			proof := map[string]any{"actionExecutionId": execution, "receiverActionExecutionId": child, "receiverGeneration": 3, "operationId": operation, "sourceBindingId": source,
				"sourceReceipt": receipt(source, "SOURCE"), "receiverReceipt": receipt(binding, "RECEIVER")}
			readRequest := map[string]any{"receiverBindingId": binding, "sourceResourceId": uuid.NewString(), "actionKey": "file_storage.read@v1", "actionVersion": 1, "inputJson": "{}", "idempotencyKey": key,
				"nativeBatch": map[string]any{"batchId": batch, "importConfigRef": importConfig, "receiverResourceId": uuid.NewString(), "actionKey": "knowledge.sync_apply@v2", "actionVersion": 2}}
			if scenario == "wrong-binding" {
				readRequest["receiverBindingId"] = uuid.NewString()
			}
			read := map[string]any{}
			for field, value := range proof {
				read[field] = value
			}
			read["readRequest"], read["nativeBatch"], read["sourceResourceId"] = readRequest, readRequest["nativeBatch"], readRequest["sourceResourceId"]
			body, _ := json.Marshal(map[string]any{"request": request, "nativeBatchId": batch, "nativeStatus": "success", "startedAt": time.Now().Add(-time.Second).UTC().Format(time.RFC3339), "finishedAt": completedAt, "completed": true, "readOperations": []any{read}})
			lookups := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if r.URL.Path == "/token" {
					if r.ParseForm() != nil || r.Form.Get("client_id") != "isolated-receiver" || r.Form.Get("client_secret") != "receiver-only-fixture" {
						t.Error("receiver service identity was not used")
					}
					_, _ = io.WriteString(w, `{"access_token":"isolated-receiver-token","expires_in":300}`)
					return
				}
				lookups++
				if r.URL.Path != "/service/v1/adapter/request_read_grant" || r.Header.Get("Authorization") != "Bearer isolated-receiver-token" {
					t.Error("not the original isolated receiver Core consumer")
				}
				var actual map[string]any
				if json.NewDecoder(r.Body).Decode(&actual) != nil || actual["observeActionExecutionId"] != execution {
					t.Error("lookup could re-enter admission instead of only observing the retained AE")
				}
				delete(actual, "observeActionExecutionId")
				expected, _ := json.Marshal(readRequest)
				observed, _ := json.Marshal(actual)
				if string(expected) != string(observed) {
					t.Error("lookup changed the original frozen request")
				}
				if scenario == "missing-ae" {
					w.WriteHeader(http.StatusForbidden)
					_, _ = io.WriteString(w, `{}`)
					return
				}
				response := map[string]any{"outcome": "COMPLETED"}
				for field, value := range proof {
					response[field] = value
				}
				if scenario == "changed-receipt" {
					changed := receipt(source, "SOURCE")
					changed["operationId"] = uuid.NewString()
					response["sourceReceipt"] = changed
				}
				if scenario == "changed-generation" {
					response["receiverGeneration"] = 4
				}
				if scenario == "unexpected-token" {
					response["actionToken"] = "must-not-be-issued"
				}
				_ = json.NewEncoder(w).Encode(response)
			}))
			defer server.Close()
			secretFile := filepath.Join(t.TempDir(), "receiver-credential")
			if err := os.WriteFile(secretFile, []byte("receiver-only-fixture"), 0600); err != nil {
				t.Fatal(err)
			}
			authority := generated.ComponentNativeReadAuthority{BindingID: binding, Generation: 3, CoreBaseURL: server.URL, OidcTokenURL: server.URL + "/token", OidcClientID: "isolated-receiver", OidcClientSecretFile: secretFile}
			configuration := generated.ComponentConformanceEnvironment{NativeReadAuthorities: []generated.ComponentNativeReadAuthority{authority}, MaxResponseBytes: 65536}
			if scenario == "missing-delivery" {
				configuration.NativeReadAuthorities = nil
			}
			if scenario == "duplicate-delivery" {
				configuration.NativeReadAuthorities = append(configuration.NativeReadAuthorities, authority)
			}
			candidate := componentCandidate{configuration: configuration, http: server.Client()}
			err := candidate.verifyReceiverReadAuthority(context.Background(), generated.ComponentConformanceStep{RequestJSON: string(rawRequest)}, body)
			if (err == nil) != (scenario == "committed") {
				t.Fatalf("scenario=%s err=%v", scenario, err)
			}
			want := 1
			if scenario == "missing-delivery" || scenario == "duplicate-delivery" || scenario == "wrong-binding" {
				want = 0
			}
			if lookups != want {
				t.Fatalf("lookups=%d want=%d", lookups, want)
			}
		})
	}
}

// DD-124(4): an isolated APPLICATION receiver action (no import configuration)
// is driven through the platform-maintained isolated deployment entry, never the
// candidate adapter, and its anchored reads are still confirmed at the isolated
// Core. A NATIVE_MANAGED batch keeps the candidate's own receiver entry.
func TestReceiverActionStepUsesTheIsolatedDeploymentEntry(t *testing.T) {
	binding, source, execution, child, operation, key, step := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	resource, receiverResource := uuid.NewString(), uuid.NewString()
	request := map[string]any{"bindingId": binding, "generation": 3, "idempotencyKey": step, "expiresAt": time.Now().Add(time.Hour).UTC().Format(time.RFC3339)}
	completedAt := time.Now().UTC().Format(time.RFC3339)
	receipt := func(owner, role, object string) map[string]any {
		return map[string]any{"bindingId": owner, "role": role, "operationId": operation, "idempotencyKey": key,
			"nativeObjectRef": object, "nativeRevision": "original-revision", "contentSha256": strings.Repeat("a", 64),
			"contentBytes": 34, "completedAt": completedAt, "measurements": []any{}}
	}
	proof := map[string]any{"actionExecutionId": execution, "receiverActionExecutionId": child, "receiverGeneration": 3, "operationId": operation, "sourceBindingId": source,
		"sourceReceipt": receipt(source, "SOURCE", "source-node"), "receiverReceipt": receipt(binding, "RECEIVER", "knowledge-document")}
	reference := `{"displayName":"conformance.md","mediaType":"text/markdown","nativeObjectRef":"source-node","nativeRevision":"original-revision","resourceId":"` + resource + `"}`
	readRequest := map[string]any{"receiverBindingId": binding, "sourceResourceId": resource, "actionKey": "file_storage.read@v2", "actionVersion": 1, "inputJson": reference, "idempotencyKey": key,
		"receiverActionExecutionId": child, "receiverArgumentsJson": `{"input":` + reference + `,"target":{"resourceId":"` + receiverResource + `"}}`}
	read := map[string]any{"readRequest": readRequest, "sourceResourceId": resource}
	for field, value := range proof {
		read[field] = value
	}
	body, _ := json.Marshal(map[string]any{"request": request, "nativeBatchId": uuid.NewString(), "nativeStatus": "completed", "startedAt": time.Now().Add(-time.Second).UTC().Format(time.RFC3339),
		"finishedAt": completedAt, "completed": true, "readOperations": []any{read}})
	var adapterCalls, actionCalls, lookups atomic.Int32
	adapter := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		adapterCalls.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer adapter.Close()
	isolated := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/token":
			_, _ = io.WriteString(w, `{"access_token":"isolated-receiver-token","expires_in":300}`)
		case "/component-conformance/v1/receiver_start":
			actionCalls.Add(1)
			if r.Header.Get("Authorization") != "Bearer production-signed-probe" || r.Header.Get("Idempotency-Key") != step {
				t.Error("isolated entry did not receive the original signed probe")
			}
			_, _ = w.Write(body)
		case "/service/v1/adapter/request_read_grant":
			lookups.Add(1)
			var actual map[string]any
			if json.NewDecoder(r.Body).Decode(&actual) != nil || actual["observeActionExecutionId"] != execution ||
				actual["receiverActionExecutionId"] != child || actual["nativeBatch"] != nil {
				t.Error("anchored read was not observed through its original receiver action")
			}
			response := map[string]any{"outcome": "COMPLETED"}
			for field, value := range proof {
				response[field] = value
			}
			_ = json.NewEncoder(w).Encode(response)
		default:
			t.Errorf("unexpected isolated path %s", r.URL.Path)
		}
	}))
	defer isolated.Close()
	secretFile := filepath.Join(t.TempDir(), "receiver-credential")
	if err := os.WriteFile(secretFile, []byte("receiver-only-fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	digest, err := conformanceJSONDigest([]byte(`{"candidate":"isolated-fixture"}`))
	if err != nil {
		t.Fatal(err)
	}
	configuration := generated.ComponentConformanceEnvironment{AdapterBaseURL: adapter.URL, ArtifactDigest: digest, MaxResponseBytes: 65536, MaxSteps: 8,
		NativeReadAuthorities: []generated.ComponentNativeReadAuthority{{BindingID: binding, Generation: 3, CoreBaseURL: isolated.URL,
			OidcTokenURL: isolated.URL + "/token", OidcClientID: "isolated-receiver", OidcClientSecretFile: secretFile}}}
	rawRequest, _ := json.Marshal(request)
	planStep := generated.ComponentConformanceStep{CaseKey: "knowledge:3:knowledge_roundtrip", StepKey: "ingest", Operation: "receiver_start",
		IdempotencyKey: step, RequestJSON: string(rawRequest), ExpectedResponseJSON: "{}", ExpectedHTTPStatus: http.StatusOK}
	digests := func(_ context.Context, step generated.ComponentConformanceStep, body []byte, _ int64) (generated.ComponentConformanceWireDigests, error) {
		requestHash := sha256.Sum256([]byte(step.RequestJSON))
		responseHash, err := conformanceJSONDigest(body)
		return generated.ComponentConformanceWireDigests{RequestDigest: hex.EncodeToString(requestHash[:]), ResponseDigest: responseHash}, err
	}
	// Without the isolated deployment entry the step is blocked, never sent to
	// the candidate adapter.
	candidate, err := newComponentCandidate(configuration)
	if err != nil {
		t.Fatal(err)
	}
	candidate.digestResponse = digests
	observation := candidate.call(context.Background(), planStep, "production-signed-probe")
	if observation.ErrorClass == nil || string(*observation.ErrorClass) != "BLOCKED" || adapterCalls.Load() != 0 || actionCalls.Load() != 0 {
		t.Fatalf("receiver action without isolated entry: %+v", observation)
	}
	entry := isolated.URL + "/"
	configuration.ReceiverActionBaseURL = &entry
	candidate, err = newComponentCandidate(configuration)
	if err != nil {
		t.Fatal(err)
	}
	candidate.digestResponse = digests
	observation = candidate.call(context.Background(), planStep, "production-signed-probe")
	if observation.ErrorClass != nil || observation.HTTPStatus != http.StatusOK || adapterCalls.Load() != 0 || actionCalls.Load() != 1 || lookups.Load() != 1 {
		t.Fatalf("receiver action not driven through the isolated entry: %+v", observation)
	}
	// A native batch names its import configuration and stays on the candidate.
	request["importConfigRef"] = uuid.NewString()
	rawRequest, _ = json.Marshal(request)
	planStep.RequestJSON = string(rawRequest)
	_ = candidate.call(context.Background(), planStep, "production-signed-probe")
	if adapterCalls.Load() != 1 || actionCalls.Load() != 1 {
		t.Fatal("native receiver batch left the candidate's own receiver entry")
	}
	invalid := "http://isolated.invalid/path"
	configuration.ReceiverActionBaseURL = &invalid
	if _, err := newComponentCandidate(configuration); err == nil {
		t.Fatal("isolated entry with a path accepted")
	}
}

func TestProtocolPeerConformanceUsesOriginalCoreConsumerWithoutReplaying(t *testing.T) {
	for _, scenario := range []string{"success", "lost-reply", "invented-job", "missing-protocol-result", "reconcile", "reconcile-unavailable", "wrong-workflow"} {
		t.Run(scenario, func(t *testing.T) {
			calls := 0
			request, expected := `{"arguments":{},"name":"declared-read"}`, `"native text"`
			requestDigest, _ := conformanceJSONDigest([]byte(request))
			resultDigest, _ := conformanceJSONDigest([]byte(expected))
			kind := generated.ComponentConformanceStepExpectedMCPResultKind("RESULT")
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/token" {
					_, _ = io.WriteString(w, `{"access_token":"isolated-worker","expires_in":300}`)
					return
				}
				calls++
				if r.URL.Path != "/service/v1/component-releases/authorize-probe" || r.Header.Get("Authorization") != "Bearer isolated-worker" {
					t.Error("MCP probe bypassed original Core service consumer")
				}
				var probe struct {
					Reconcile *bool `json:"reconcile"`
				}
				_ = json.NewDecoder(r.Body).Decode(&probe)
				if (probe.Reconcile != nil && *probe.Reconcile) != strings.HasPrefix(scenario, "reconcile") {
					t.Error("reconcile flag not forwarded exactly")
				}
				if scenario == "reconcile" {
					// Core records the unresolved step and refuses definitively.
					w.WriteHeader(http.StatusConflict)
					return
				}
				if scenario == "lost-reply" || scenario == "reconcile-unavailable" {
					w.WriteHeader(http.StatusServiceUnavailable)
					return
				}
				observed := generated.ComponentConformanceStepObservation{CaseKey: "native", StepKey: "read", Operation: generated.MCPCall,
					HTTPStatus: 0, MCPResultKind: &kind, RequestDigest: requestDigest, ResponseDigest: resultDigest, ResultDigest: &resultDigest}
				if scenario == "invented-job" {
					observed.NativeObservation = &generated.AdapterExecutionObservation{NativeType: "invented"}
				}
				if scenario == "missing-protocol-result" {
					observed.MCPResultKind = nil
				}
				_ = json.NewEncoder(w).Encode(observed)
			}))
			defer server.Close()
			t.Setenv("OIDC_TOKEN_URL", server.URL+"/token")
			t.Setenv("OIDC_WORKER_CLIENT_ID", "isolated-worker")
			t.Setenv("OIDC_WORKER_CLIENT_SECRET", "isolated-fixture")
			tokens, err := oidc.FromEnv()
			if err != nil {
				t.Fatal(err)
			}
			api := &CoreAPI{base: server.URL, tokens: tokens, http: server.Client()}
			connector := generated.ComponentConformancePlanConnectorKind("PROTOCOL_PEER")
			input := generated.ComponentConformanceProbe{Plan: generated.ComponentConformancePlan{ConnectorKind: &connector,
				Steps: []generated.ComponentConformanceStep{{CaseKey: "native", StepKey: "read", Operation: generated.MCPCall,
					RequestJSON: request, ExpectedResponseJSON: expected, ExpectedMCPResultKind: &kind}}}}
			if strings.HasPrefix(scenario, "reconcile") {
				reconcile := true
				input.Reconcile = &reconcile
			}
			var suite testsuite.WorkflowTestSuite
			env := suite.NewTestActivityEnvironment()
			actual := func(ctx context.Context, probe generated.ComponentConformanceProbe) (generated.ComponentConformanceStepObservation, error) {
				info := activity.GetInfo(ctx)
				probe.Plan.WorkflowID = info.WorkflowExecution.ID
				probe.Plan.RunID = info.WorkflowExecution.RunID
				if scenario == "wrong-workflow" {
					probe.Plan.WorkflowID = "another-workflow"
				}
				return api.RunComponentConformanceStep(ctx, probe)
			}
			env.RegisterActivity(actual)
			_, err = env.ExecuteActivity(actual, input)
			if (err == nil) != (scenario == "success") {
				t.Fatalf("scenario=%s err=%v", scenario, err)
			}
			want := 1
			if scenario == "wrong-workflow" {
				want = 0
			}
			if calls != want {
				t.Fatalf("original call count=%d want=%d", calls, want)
			}
			// Only Core's definite answer ends the registration; an unknown
			// answer keeps the original attempt unresolved and never replays it.
			var application *temporal.ApplicationError
			if strings.HasPrefix(scenario, "reconcile") {
				wantType := ErrTypeUnknownExternalResult
				if scenario == "reconcile" {
					wantType = ErrTypeRejected
				}
				if !errors.As(err, &application) || application.Type() != wantType {
					t.Fatalf("scenario=%s err=%v want type %s", scenario, err, wantType)
				}
			}
		})
	}
}

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
	candidate.digestResponse = func(_ context.Context, step generated.ComponentConformanceStep, body []byte, _ int64) (generated.ComponentConformanceWireDigests, error) {
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

func fixtureExpectedDigest(t *testing.T, step generated.ComponentConformanceStep) string {
	t.Helper()
	digest, err := conformanceJSONDigest([]byte(step.ExpectedResponseJSON))
	if err != nil {
		t.Fatal(err)
	}
	return digest
}

func TestComponentConformanceBindingComparisonKeepsWireEvidence(t *testing.T) {
	expected := strings.Repeat("a", sha256.Size*2)
	wire := strings.Repeat("b", sha256.Size*2)
	step := generated.ComponentConformanceStep{Operation: "validate_binding", ExpectedHTTPStatus: http.StatusOK}
	observation := generated.ComponentConformanceStepObservation{
		Operation: "validate_binding", HTTPStatus: http.StatusOK, ResponseDigest: wire, BindingDigest: &expected,
	}
	if err := verifyConformanceStep(step, observation, expected); err != nil {
		t.Fatal(err)
	}
	observation.BindingDigest = nil
	if err := verifyConformanceStep(step, observation, wire); err == nil {
		t.Fatal("full wire digest must not bypass missing binding metadata")
	}
	observation.BindingDigest = &wire
	if err := verifyConformanceStep(step, observation, expected); err == nil {
		t.Fatal("changed binding metadata was accepted")
	}
	observation.BindingDigest = &expected
	step.Operation = "handshake"
	if err := verifyConformanceStep(step, observation, expected); err == nil {
		t.Fatal("binding digest accepted on unrelated operation")
	}
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
	candidate.digestResponse = func(_ context.Context, _ generated.ComponentConformanceStep, body []byte, _ int64) (generated.ComponentConformanceWireDigests, error) {
		if string(body) != sample.ResponseJSON {
			t.Error("observed response differs from Core-normalized actual bytes")
		}
		return sample.Digests, nil
	}
	contract := "fixture.read"
	step := generated.ComponentConformanceStep{CaseKey: "core_canonical", StepKey: "wire", Operation: generated.ComponentConformanceOperation("execute"),
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

func conformanceStepForTest() generated.ComponentConformanceStep {
	key := uuid.NewString()
	return generated.ComponentConformanceStep{
		CaseKey: "creation", StepKey: "create", Operation: generated.ComponentConformanceOperation("execute"),
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
		response := generated.AdapterExecutionObservation{
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
		_ = json.NewEncoder(w).Encode(map[string]any{"execution": generated.AdapterExecutionObservation{
			IdempotencyKey: key, NativeType: "fixture_task", NativeID: &nativeID, NativeStatus: &nativeStatus,
			PlatformStatus: generated.ExternalExecutionStatus("SUCCEEDED"), CancelCapability: generated.NativeCancelCapability("SUPPORTED"),
			LastObservedAt: &observed, TerminalAt: &observed,
		}})
	})
	expectedToken = token
	steps := make([]generated.ComponentConformanceStep, 0)
	observations := make([]generated.ComponentConformanceStepObservation, 0)
	for index, operation := range []string{"execute", "execute", "observe"} {
		request, _ := json.Marshal(map[string]string{"idempotencyKey": key})
		expected, _ := json.Marshal(map[string]string{"idempotencyKey": key, "nativeType": "fixture_task", "platformStatus": "SUCCEEDED", "cancelCapability": "SUPPORTED"})
		step := generated.ComponentConformanceStep{CaseKey: "protocol_execution_idempotency", StepKey: []string{"first", "duplicate", "observe"}[index],
			Operation: generated.ComponentConformanceOperation(operation), IdempotencyKey: key, RequestJSON: string(request), ExpectedResponseJSON: string(expected), ExpectedHTTPStatus: http.StatusOK}
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
	native := generated.AdapterExecutionObservation{
		IdempotencyKey: key, NativeType: "fixture_task", NativeID: &nativeID, NativeStatus: &nativeStatus,
		PlatformStatus:   generated.ExternalExecutionStatus("SUCCEEDED"),
		CancelCapability: generated.NativeCancelCapability("SUPPORTED"), LastObservedAt: &observedAt, TerminalAt: &observedAt,
	}
	if !validNativeObservation(native, key) {
		t.Fatal("complete native evidence rejected")
	}
	for _, change := range []struct {
		name   string
		mutate func(*generated.AdapterExecutionObservation)
	}{
		{"wrong_reference", func(n *generated.AdapterExecutionObservation) { n.IdempotencyKey = uuid.NewString() }},
		{"unknown_state", func(n *generated.AdapterExecutionObservation) {
			n.PlatformStatus = generated.ExternalExecutionStatus("NEW_STATE")
		}},
		{"unknown_cancel", func(n *generated.AdapterExecutionObservation) {
			n.CancelCapability = generated.NativeCancelCapability("MAYBE")
		}},
		{"no_native_status", func(n *generated.AdapterExecutionObservation) { n.NativeStatus = nil }},
		{"no_terminal_time", func(n *generated.AdapterExecutionObservation) { n.TerminalAt = nil }},
		{"no_observation_time", func(n *generated.AdapterExecutionObservation) { n.LastObservedAt = nil }},
		{"running_marked_terminal", func(n *generated.AdapterExecutionObservation) {
			n.PlatformStatus = generated.ExternalExecutionStatus("RUNNING")
		}},
		{"future_terminal", func(n *generated.AdapterExecutionObservation) {
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
	native := generated.AdapterExecutionObservation{
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
	plan := generated.ComponentConformancePlan{
		ActionExecutionID: uuid.NewString(), OperationID: uuid.NewString(), ComponentReleaseID: uuid.NewString(),
		WorkflowID: uuid.NewString(), ArtifactDigest: candidate.configuration.ArtifactDigest,
		ContractDigests: []string{candidate.configuration.ArtifactDigest}, SuiteDigest: candidate.configuration.ArtifactDigest,
		Steps: []generated.ComponentConformanceStep{conformanceStepForTest()},
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

func TestComponentConformanceCapturesMirrorCoreBindings(t *testing.T) {
	var read generated.ComponentConformanceStep
	if err := json.Unmarshal([]byte(`{"caseKey":"file_storage:2:native_file","stepKey":"read","operation":"execute",
		"contractKey":"file_storage.read@v2","idempotencyKey":"read","requestJson":"{}","expectedResponseJson":"{}","expectedHttpStatus":200,
		"bindings":[{"source":"CAPTURE","key":"published_revision","side":"INPUT","pointer":"/nativeRevision"}]}`), &read); err != nil {
		t.Fatal(err)
	}
	probe := generated.ComponentConformanceProbe{Plan: generated.ComponentConformancePlan{Steps: []generated.ComponentConformanceStep{read}}}
	if validProbeCaptures(probe) == nil {
		t.Fatal("missing capture value accepted")
	}
	for _, scenario := range []struct {
		raw   string
		valid bool
	}{
		{`[{"key":"published_revision","value":"published"}]`, true},
		{`[{"key":"published_revision","value":"{{CAPTURE:published_revision}}"}]`, false},
		{`[{"key":"published_revision","value":" "}]`, false},
		{`[{"key":"other","value":"published"}]`, false},
		{`[{"key":"published_revision","value":"a"},{"key":"published_revision","value":"a"}]`, false},
	} {
		probe.Captures = nil
		if err := json.Unmarshal([]byte(scenario.raw), &probe.Captures); err != nil {
			t.Fatal(err)
		}
		if (validProbeCaptures(probe) == nil) != scenario.valid {
			t.Fatalf("capture values %s", scenario.raw)
		}
	}
	var write generated.ComponentConformanceStep
	if err := json.Unmarshal([]byte(`{"caseKey":"file_storage:2:native_file","stepKey":"write","operation":"execute",
		"contractKey":"file_storage.write@v2","idempotencyKey":"write","requestJson":"{}","expectedResponseJson":"{}","expectedHttpStatus":200,
		"captures":[{"key":"published_revision","slot":"CONTENT_REFERENCE_NATIVE_REVISION"}]}`), &write); err != nil {
		t.Fatal(err)
	}
	var observation generated.ComponentConformanceStepObservation
	if err := json.Unmarshal([]byte(`{"caseKey":"file_storage:2:native_file","stepKey":"write","operation":"execute",
		"requestDigest":"r","responseDigest":"s","httpStatus":200,
		"contentReference":{"resourceId":"8a385544-3c3f-52e0-bbfa-2795f6046543","nativeObjectRef":"node","nativeRevision":"published",
		"displayName":"conformance.txt","mediaType":"text/plain"},
		"captures":[{"key":"published_revision","value":"published"}],
		"nativeObservation":{"idempotencyKey":"write","nativeType":"version","platformStatus":"SUCCEEDED","cancelCapability":"UNSUPPORTED",
		"nativeStatus":"Finished","lastObservedAt":"2026-10-18T00:00:00Z","terminalAt":"2026-10-18T00:00:00Z"}}`), &observation); err != nil {
		t.Fatal(err)
	}
	if err := verifyConformanceCaptures(write, observation); err != nil {
		t.Fatal(err)
	}
	// A current head or any value other than the typed slot is not the capture.
	drifted := observation
	drifted.Captures = append(drifted.Captures[:0:0], observation.Captures...)
	drifted.Captures[0].Value = "head"
	if verifyConformanceCaptures(write, drifted) == nil {
		t.Fatal("capture differing from the typed reference accepted")
	}
	missing := observation
	missing.Captures = nil
	if verifyConformanceCaptures(write, missing) == nil {
		t.Fatal("successful producer without its declared capture accepted")
	}
	if verifyConformanceCaptures(read, observation) == nil {
		t.Fatal("capture on a step that declares none accepted")
	}
	running := missing
	native := *observation.NativeObservation
	native.PlatformStatus = "RUNNING"
	running.NativeObservation = &native
	if err := verifyConformanceCaptures(write, running); err != nil {
		t.Fatal(err)
	}
}
