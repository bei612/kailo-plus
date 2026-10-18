package activities

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"apps/worker/internal/contracts/generated"
	"apps/worker/internal/oidc"
	"github.com/google/uuid"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/temporal"
)

// A candidate is an isolated developer-environment deployment, never a
// production ApplicationBinding. Neither endpoint nor credentials come from a
// user action or Temporal payload. The Core service identity is never forwarded.
type componentCandidate struct {
	configuration generated.ComponentConformanceEnvironment
	// DD-124(4): the platform-maintained isolated deployment entry for an
	// APPLICATION receiver action; never the candidate adapter.
	receiverActionBase string
	http               *http.Client
	digestResponse     func(context.Context, generated.PlanStep, []byte, int64) (generated.ComponentConformanceWireDigests, error)
}

func decodeConformanceJSON(body []byte, target any) error {
	// encoding/json otherwise silently keeps the last duplicate key. A signed
	// or digest-pinned document must not mean different things to two parsers.
	if err := uniqueConformanceKeys(body); err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	decoder.UseNumber()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return errors.New("multiple JSON values")
	}
	return nil
}

func uniqueConformanceKeys(body []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()
	var visit func() error
	visit = func() error {
		token, err := decoder.Token()
		if err != nil {
			return err
		}
		delimiter, compound := token.(json.Delim)
		if !compound {
			return nil
		}
		switch delimiter {
		case '{':
			seen := make(map[string]struct{})
			for decoder.More() {
				keyToken, err := decoder.Token()
				if err != nil {
					return err
				}
				key, ok := keyToken.(string)
				if !ok {
					return errors.New("invalid JSON object key")
				}
				if _, duplicate := seen[key]; duplicate {
					return errors.New("duplicate JSON object key")
				}
				seen[key] = struct{}{}
				if err := visit(); err != nil {
					return err
				}
			}
		case '[':
			for decoder.More() {
				if err := visit(); err != nil {
					return err
				}
			}
		default:
			return errors.New("invalid JSON delimiter")
		}
		_, err = decoder.Token()
		return err
	}
	if err := visit(); err != nil {
		return err
	}
	if _, err := decoder.Token(); err != io.EOF {
		return errors.New("trailing JSON data")
	}
	return nil
}

func validAdapterOperation(operation generated.ComponentConformanceOperation) bool {
	switch string(operation) {
	case "handshake", "validate_binding", "resolve_native_scope", "execute", "observe", "cancel", "reconcile", "query_revision", "extract_usage", "map_native_status_error", "receiver_start", "receiver_observe":
		return true
	default:
		return false
	}
}

func isolatedOrigin(value string) bool {
	endpoint, err := url.Parse(value)
	return err == nil && endpoint.Hostname() != "" && endpoint.User == nil &&
		endpoint.RawQuery == "" && endpoint.Fragment == "" && endpoint.Opaque == "" &&
		(endpoint.Scheme == "http" || endpoint.Scheme == "https") &&
		(endpoint.Path == "" || endpoint.Path == "/")
}

func newComponentCandidate(configuration generated.ComponentConformanceEnvironment) (*componentCandidate, error) {
	if !isolatedOrigin(configuration.AdapterBaseURL) ||
		configuration.MaxResponseBytes <= 0 || configuration.MaxSteps <= 0 ||
		!validConformanceDigest(configuration.ArtifactDigest) ||
		(configuration.ReceiverActionBaseURL != nil && !isolatedOrigin(*configuration.ReceiverActionBaseURL)) {
		return nil, errors.New("invalid isolated candidate configuration")
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.ForceAttemptHTTP2 = false
	transport.TLSNextProto = make(map[string]func(string, *tls.Conn) http.RoundTripper)
	configuration.AdapterBaseURL = strings.TrimRight(configuration.AdapterBaseURL, "/")
	receiverActionBase := ""
	if configuration.ReceiverActionBaseURL != nil {
		receiverActionBase = strings.TrimRight(*configuration.ReceiverActionBaseURL, "/")
	}
	return &componentCandidate{
		configuration:      configuration,
		receiverActionBase: receiverActionBase,
		http: &http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		}},
	}, nil
}

// DD-124(4): a frozen receiver request that names no import configuration is
// an isolated APPLICATION receiver action (an ingest through READ_EDGE). The
// platform-maintained isolated deployment admits and dispatches it through the
// isolated Core; a NATIVE_MANAGED batch is started by the candidate itself.
func receiverActionRequest(step generated.PlanStep) (bool, error) {
	var request map[string]json.RawMessage
	if err := decodeConformanceJSON([]byte(step.RequestJSON), &request); err != nil {
		return false, err
	}
	_, batch := request["importConfigRef"]
	return !batch, nil
}

func validConformanceDigest(value string) bool {
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == sha256.Size && value == strings.ToLower(value)
}

// JSON is canonicalized as data, not evaluated. Number tokens remain exact so
// an adapter returning a rounded integer cannot satisfy a frozen expectation.
func conformanceJSONDigest(body []byte) (string, error) {
	var value any
	if err := decodeConformanceJSON(body, &value); err != nil {
		return "", err
	}
	var encoded bytes.Buffer
	encoder := json.NewEncoder(&encoded)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return "", err
	}
	// encoding/json always JavaScript-escapes these two valid UTF-8 characters,
	// even with HTML escaping disabled; Core's JSON encoding does not. Consume
	// whole escapes so a literal six-character "\\u2028" remains untouched.
	raw := bytes.TrimSuffix(encoded.Bytes(), []byte("\n"))
	canonical := make([]byte, 0, len(raw))
	for index := 0; index < len(raw); index++ {
		if raw[index] == '\\' && index+1 < len(raw) {
			if index+5 < len(raw) && (string(raw[index:index+6]) == `\u2028` || string(raw[index:index+6]) == `\u2029`) {
				if raw[index+5] == '8' {
					canonical = append(canonical, "\u2028"...)
				} else {
					canonical = append(canonical, "\u2029"...)
				}
				index += 5
				continue
			}
			canonical = append(canonical, raw[index], raw[index+1])
			index++
			continue
		}
		canonical = append(canonical, raw[index])
	}
	sum := sha256.Sum256(canonical)
	return hex.EncodeToString(sum[:]), nil
}

// call performs one wire attempt. It deliberately has no transport retry, no
// redirect following, and no body/error logging. The existing Temporal Activity
// history records this one attempt against the frozen ActionExecution. There is
// no second step ledger; uncertain attempts can only be observed, not repeated.
func (candidate *componentCandidate) call(ctx context.Context, step generated.PlanStep, token string) generated.ComponentConformanceStepObservation {
	observation := generated.ComponentConformanceStepObservation{
		CaseKey: step.CaseKey, StepKey: step.StepKey, Operation: step.Operation,
	}
	uncertain := func() generated.ComponentConformanceStepObservation {
		class := generated.ErrorClass("UNKNOWN")
		observation.ErrorClass = &class
		return observation
	}
	requestHash := sha256.Sum256([]byte(step.RequestJSON))
	requestDigest := hex.EncodeToString(requestHash[:])
	var requestValue any
	if decodeConformanceJSON([]byte(step.RequestJSON), &requestValue) != nil || step.IdempotencyKey == "" || !validAdapterOperation(step.Operation) || candidate.digestResponse == nil {
		class := generated.ErrorClass("PRECONDITION")
		observation.ErrorClass = &class
		return observation
	}
	observation.RequestDigest = requestDigest
	var envelope map[string]json.RawMessage
	var bodyKey string
	if json.Unmarshal([]byte(step.RequestJSON), &envelope) != nil ||
		json.Unmarshal(envelope["idempotencyKey"], &bodyKey) != nil || bodyKey != step.IdempotencyKey {
		class := generated.ErrorClass("PRECONDITION")
		observation.ErrorClass = &class
		return observation
	}
	if token == "" || strings.ContainsAny(token, " \t\r\n") {
		class := generated.ErrorClass("BLOCKED")
		observation.ErrorClass = &class
		return observation
	}
	path := "/platform-adapter/v1/"
	base := candidate.configuration.AdapterBaseURL
	if string(step.Operation) == "receiver_start" || string(step.Operation) == "receiver_observe" {
		_, identity, err := candidate.receiverReadAuthority(step)
		if err != nil {
			return uncertain()
		}
		if _, err := identity.Token(ctx); err != nil {
			return uncertain()
		}
		path = "/component-conformance/v1/"
		action, err := receiverActionRequest(step)
		if err != nil {
			return uncertain()
		}
		if action {
			if candidate.receiverActionBase == "" {
				class := generated.ErrorClass("BLOCKED")
				observation.ErrorClass = &class
				return observation
			}
			base = candidate.receiverActionBase
		}
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost,
		base+path+string(step.Operation),
		strings.NewReader(step.RequestJSON))
	if err != nil {
		return uncertain()
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Idempotency-Key", step.IdempotencyKey)
	response, err := candidate.http.Do(request)
	if err != nil {
		return uncertain()
	}
	defer response.Body.Close()
	observation.HTTPStatus = int64(response.StatusCode)
	// Read one byte beyond the deployment limit to distinguish a complete small
	// response from a truncated document. Never accept a valid JSON prefix.
	if candidate.configuration.MaxResponseBytes == int64(^uint64(0)>>1) {
		return uncertain()
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, candidate.configuration.MaxResponseBytes+1))
	if err != nil || int64(len(body)) > candidate.configuration.MaxResponseBytes || response.ProtoMajor != 1 {
		return uncertain()
	}
	// A secret echo is a deterministic redaction violation, not evidence to
	// publish. The report carries only the closed error class and HTTP status.
	if bytes.Contains(body, []byte(token)) {
		class := generated.ErrorClass("DENIED")
		observation.ErrorClass = &class
		return observation
	}
	if response.Header.Get("Content-Type") != "application/json" &&
		!strings.HasPrefix(response.Header.Get("Content-Type"), "application/json;") {
		return uncertain()
	}
	var actual any
	if decodeConformanceJSON(body, &actual) != nil {
		return uncertain()
	}
	if response.StatusCode >= http.StatusOK && response.StatusCode < http.StatusMultipleChoices &&
		(string(step.Operation) == "receiver_start" || string(step.Operation) == "receiver_observe") {
		if err := candidate.verifyReceiverReadAuthority(ctx, step, body); err != nil {
			return uncertain()
		}
	}
	digests, err := candidate.digestResponse(ctx, step, body, observation.HTTPStatus)
	if err != nil || digests.RequestDigest != requestDigest || !validConformanceDigest(digests.ResponseDigest) {
		return uncertain()
	}
	observation.ResponseDigest = digests.ResponseDigest
	// DD-124(2): Core read these from this actual response's closed slots; they
	// stay only in this step's observation and are re-checked on record.
	if len(digests.Captures) != 0 {
		observation.Captures = digests.Captures
	}
	if digests.NativeReceiverObservation != nil {
		if (string(step.Operation) != "receiver_start" && string(step.Operation) != "receiver_observe") ||
			response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
			return uncertain()
		}
		observation.NativeReceiverObservation = digests.NativeReceiverObservation
	}
	if digests.BindingDigest != nil {
		if string(step.Operation) != "validate_binding" || response.StatusCode < http.StatusOK ||
			response.StatusCode >= http.StatusMultipleChoices || !validConformanceDigest(*digests.BindingDigest) {
			return uncertain()
		}
		observation.BindingDigest = digests.BindingDigest
	}
	if response.StatusCode >= http.StatusOK && response.StatusCode < http.StatusMultipleChoices {
		switch string(step.Operation) {
		case "resolve_native_scope":
			var scope generated.NativeScopeObservationClass
			var resource string
			if json.Unmarshal(envelope["platformResourceRef"], &resource) != nil || resource == "" ||
				decodeConformanceJSON(body, &scope) != nil || scope.PlatformResourceRef != resource {
				return uncertain()
			}
			switch string(scope.Result) {
			case "FOUND":
				if scope.NativeType == nil || scope.NativeRef == nil || strings.TrimSpace(*scope.NativeType) == "" || strings.TrimSpace(*scope.NativeRef) == "" {
					return uncertain()
				}
			case "REFUSED", "ABSENT_FENCED":
				if scope.NativeType != nil || scope.NativeRef != nil {
					return uncertain()
				}
			default:
				return uncertain()
			}
			observation.NativeScopeObservation = &scope
		case "execute", "observe", "cancel", "reconcile":
			var wire generated.AdapterExecutionResponse
			if decodeConformanceJSON(body, &wire) != nil {
				return uncertain()
			}
			native := generated.ExecutionElement(wire.Execution)
			if !validNativeObservation(native, step.IdempotencyKey) {
				return uncertain()
			}
			if wire.ResultJSON != nil {
				if string(native.PlatformStatus) != "SUCCEEDED" {
					return uncertain()
				}
				var result any
				if decodeConformanceJSON([]byte(*wire.ResultJSON), &result) != nil || digests.ResultDigest == nil || !validConformanceDigest(*digests.ResultDigest) {
					return uncertain()
				}
				observation.ResultDigest = digests.ResultDigest
			}
			observation.NativeObservation = &native
			if wire.ContentReference != nil {
				if string(native.PlatformStatus) != "SUCCEEDED" || step.ReferenceResourceID == nil ||
					!validContentReference(generated.ContentReference(*wire.ContentReference), *step.ReferenceResourceID, step.ReferenceAssetID) {
					return uncertain()
				}
				observation.ContentReference = wire.ContentReference
			}
		}
	}
	return observation
}

// The candidate's self-consistent JSON is not read authority. Each claimed
// completed operation is looked up at the separately delivered isolated Core,
// using the receiver's service identity and its explicit observe-only branch.
// Neither endpoint nor credentials are accepted from an Adapter response.
func (candidate *componentCandidate) receiverReadAuthority(step generated.PlanStep) (*generated.ComponentNativeReadAuthority, *oidc.Source, error) {
	var request generated.ComponentNativeReceiverRequest
	if decodeConformanceJSON([]byte(step.RequestJSON), &request) != nil {
		return nil, nil, errors.New("invalid frozen receiver request")
	}
	var found *generated.ComponentNativeReadAuthority
	for index := range candidate.configuration.NativeReadAuthorities {
		authority := &candidate.configuration.NativeReadAuthorities[index]
		if authority.BindingID == request.BindingID && authority.Generation == request.Generation {
			if found != nil {
				return nil, nil, errors.New("duplicate receiver read authority")
			}
			found = authority
		}
	}
	if found == nil || found.Generation <= 0 || !filepath.IsAbs(found.OidcClientSecretFile) {
		return nil, nil, errors.New("receiver read authority unavailable")
	}
	endpoint, err := url.Parse(found.CoreBaseURL)
	if err != nil || endpoint.Hostname() == "" || endpoint.User != nil || endpoint.RawQuery != "" || endpoint.Fragment != "" ||
		(endpoint.Path != "" && endpoint.Path != "/") || (endpoint.Scheme != "http" && endpoint.Scheme != "https") {
		return nil, nil, errors.New("invalid receiver Core delivery")
	}
	credential, err := os.ReadFile(found.OidcClientSecretFile)
	if err != nil || len(bytes.TrimSpace(credential)) == 0 {
		return nil, nil, errors.New("receiver service credential unavailable")
	}
	identity, err := oidc.NewSource(found.OidcTokenURL, found.OidcClientID, strings.TrimSpace(string(credential)), candidate.http)
	if err != nil {
		return nil, nil, errors.New("receiver service identity unavailable")
	}
	return found, identity, nil
}

func (candidate *componentCandidate) verifyReceiverReadAuthority(ctx context.Context, step generated.PlanStep, body []byte) error {
	found, identity, err := candidate.receiverReadAuthority(step)
	if err != nil {
		return err
	}
	var wire generated.ComponentNativeReceiverObservation
	if decodeConformanceJSON(body, &wire) != nil {
		return errors.New("invalid receiver observation")
	}
	for _, read := range wire.ReadOperations {
		original, err := json.Marshal(read.ReadRequest)
		if err != nil {
			return err
		}
		var lookup map[string]any
		if decodeConformanceJSON(original, &lookup) != nil || lookup["receiverBindingId"] != found.BindingID ||
			lookup["observeActionExecutionId"] != nil {
			return errors.New("receiver observation request changed")
		}
		lookup["observeActionExecutionId"] = read.ActionExecutionID
		encoded, err := json.Marshal(lookup)
		if err != nil {
			return err
		}
		token, err := identity.Token(ctx)
		if err != nil {
			return errors.New("receiver service authentication unavailable")
		}
		query, err := http.NewRequestWithContext(ctx, http.MethodPost,
			strings.TrimRight(found.CoreBaseURL, "/")+"/service/v1/adapter/request_read_grant", bytes.NewReader(encoded))
		if err != nil {
			return err
		}
		query.Header.Set("Authorization", "Bearer "+token)
		query.Header.Set("Content-Type", "application/json")
		response, err := candidate.http.Do(query)
		if err != nil {
			return errors.New("receiver Core observation unavailable")
		}
		observed, readErr := io.ReadAll(io.LimitReader(response.Body, candidate.configuration.MaxResponseBytes+1))
		response.Body.Close()
		if readErr != nil || int64(len(observed)) > candidate.configuration.MaxResponseBytes || response.StatusCode != http.StatusOK ||
			!strings.HasPrefix(response.Header.Get("Content-Type"), "application/json") {
			return errors.New("receiver Core observation remains unconfirmed")
		}
		var actual map[string]json.RawMessage
		if decodeConformanceJSON(observed, &actual) != nil {
			return errors.New("receiver Core observation invalid")
		}
		var outcome string
		if json.Unmarshal(actual["outcome"], &outcome) != nil || outcome != "COMPLETED" || len(actual) != 8 {
			return errors.New("receiver Core has not committed both receipts and usage")
		}
		proof, err := json.Marshal(read)
		if err != nil {
			return err
		}
		var expected map[string]json.RawMessage
		if decodeConformanceJSON(proof, &expected) != nil {
			return errors.New("receiver proof unavailable")
		}
		for _, field := range []string{"actionExecutionId", "receiverActionExecutionId", "receiverGeneration", "operationId", "sourceBindingId", "sourceReceipt", "receiverReceipt"} {
			a, aErr := conformanceJSONDigest(actual[field])
			b, bErr := conformanceJSONDigest(expected[field])
			if aErr != nil || bErr != nil || a != b {
				return errors.New("receiver proof differs from actual Core facts")
			}
		}
	}
	return nil
}

func validContentReference(reference generated.ContentReference, resource string, asset *string) bool {
	id, err := uuid.Parse(reference.ResourceID)
	if err != nil || id == uuid.Nil || reference.ResourceID != resource ||
		(reference.AssetID == nil) != (asset == nil) || (asset != nil && *reference.AssetID != *asset) {
		return false
	}
	if reference.AssetID != nil {
		id, err := uuid.Parse(*reference.AssetID)
		if err != nil || id == uuid.Nil {
			return false
		}
	}
	return strings.TrimSpace(reference.NativeObjectRef) != "" && strings.TrimSpace(reference.NativeRevision) != "" &&
		strings.TrimSpace(reference.DisplayName) != "" && strings.TrimSpace(reference.MediaType) != ""
}

// These are the frozen ExternalExecution states, not a new suite state machine.
// HTTP acceptance alone never supplies a terminal timestamp or native status.
func validNativeObservation(native generated.ExecutionElement, key string) bool {
	if native.IdempotencyKey != key || strings.TrimSpace(native.NativeType) == "" ||
		(native.NativeID != nil && strings.TrimSpace(*native.NativeID) == "") ||
		(native.CancelCapability != generated.NativeCancelCapability("SUPPORTED") &&
			native.CancelCapability != generated.NativeCancelCapability("UNSUPPORTED")) {
		return false
	}
	terminal := false
	switch string(native.PlatformStatus) {
	case "PENDING_DISPATCH", "RUNNING", "UNKNOWN":
	case "SUCCEEDED", "FAILED", "CANCELLED":
		terminal = true
	default:
		return false
	}
	if native.TerminalAt != nil && !terminal {
		return false
	}
	if !terminal {
		return native.LastObservedAt == nil || validObservationTime(*native.LastObservedAt)
	}
	if native.NativeStatus == nil || strings.TrimSpace(*native.NativeStatus) == "" ||
		native.LastObservedAt == nil || native.TerminalAt == nil {
		return false
	}
	observedAt, observedErr := time.Parse(time.RFC3339Nano, *native.LastObservedAt)
	terminalAt, terminalErr := time.Parse(time.RFC3339Nano, *native.TerminalAt)
	return observedErr == nil && terminalErr == nil && !terminalAt.After(observedAt)
}

func validObservationTime(value string) bool {
	_, err := time.Parse(time.RFC3339Nano, value)
	return err == nil
}

// Native references and observation times are obtained from the candidate, not
// predicted by a string template. Compare the protocol's fixed fields while
// preserving the actual reference for the Workflow's subsequent observation.
// This is not a user-programmable matcher: no paths, expressions or callbacks.
func verifyConformanceStep(step generated.PlanStep, observation generated.ComponentConformanceStepObservation, expectedDigest string) error {
	if !validConformanceDigest(expectedDigest) {
		return errors.New("missing frozen expectation digest")
	}
	if observation.ErrorClass != nil || observation.HTTPStatus != step.ExpectedHTTPStatus {
		return errors.New("wire result did not satisfy the frozen probe")
	}
	if string(step.Operation) == "receiver_start" || string(step.Operation) == "receiver_observe" {
		if observation.HTTPStatus >= http.StatusOK && observation.HTTPStatus < http.StatusMultipleChoices {
			if observation.NativeReceiverObservation == nil || observation.NativeObservation != nil ||
				observation.BindingDigest != nil || observation.NativeScopeObservation != nil || observation.ContentReference != nil {
				return errors.New("native receiver observation is unavailable")
			}
			// Actual receipt ownership/usage is verified by the isolated Core
			// consumer, not inferred from native status or HTTP acceptance.
			return nil
		}
		if observation.NativeReceiverObservation != nil {
			return errors.New("receiver evidence on a rejected request")
		}
	} else if observation.NativeReceiverObservation != nil {
		return errors.New("receiver evidence on another protocol direction")
	}
	if string(step.Operation) == "validate_binding" && observation.HTTPStatus >= http.StatusOK && observation.HTTPStatus < http.StatusMultipleChoices {
		if observation.BindingDigest == nil || *observation.BindingDigest != expectedDigest ||
			observation.NativeObservation != nil || observation.NativeScopeObservation != nil ||
			observation.ContentReference != nil || observation.ResultDigest != nil || step.ContractKey != nil ||
			step.ReferenceResourceID != nil || step.ReferenceFromStepKey != nil {
			return errors.New("binding observation differs from the frozen protocol expectation")
		}
		return nil
	}
	if observation.BindingDigest != nil {
		return errors.New("binding observation on a non-binding probe")
	}
	if err := verifyConformanceCaptures(step, observation); err != nil {
		return err
	}
	if step.ReferenceResourceID != nil && observation.NativeObservation != nil &&
		string(observation.NativeObservation.PlatformStatus) == "SUCCEEDED" && observation.ContentReference == nil {
		return errors.New("native success did not supply its typed content reference")
	}
	if actual := observation.NativeScopeObservation; actual != nil {
		var expected generated.NativeScopeObservationClass
		if decodeConformanceJSON([]byte(step.ExpectedResponseJSON), &expected) != nil || expected.PlatformResourceRef != actual.PlatformResourceRef ||
			expected.Result != actual.Result || (expected.NativeType != nil && (actual.NativeType == nil || *expected.NativeType != *actual.NativeType)) ||
			(expected.NativeRef != nil && (actual.NativeRef == nil || *expected.NativeRef != *actual.NativeRef)) {
			return errors.New("scope observation differs from the frozen protocol expectation")
		}
		return nil
	}
	if observation.NativeObservation == nil {
		if observation.ResponseDigest != expectedDigest {
			return errors.New("response did not satisfy the frozen expectation")
		}
		return nil
	}
	if step.ContractKey != nil {
		if *step.ContractKey == "" {
			return errors.New("empty capability contract key")
		}
		if string(observation.NativeObservation.PlatformStatus) != "SUCCEEDED" {
			// RUNNING/UNKNOWN is an observation to reconcile, never a passed
			// contract case. The original Workflow cannot report completion yet.
			return nil
		}
		if observation.ResultDigest == nil || *observation.ResultDigest != expectedDigest {
			return errors.New("native terminal result does not satisfy the frozen capability vector")
		}
		return nil
	}
	var expected generated.ExecutionElement
	if decodeConformanceJSON([]byte(step.ExpectedResponseJSON), &expected) != nil {
		return errors.New("native expectation is not an Adapter Protocol observation")
	}
	actual := observation.NativeObservation
	if expected.IdempotencyKey != actual.IdempotencyKey || expected.NativeType != actual.NativeType ||
		expected.PlatformStatus != actual.PlatformStatus || expected.CancelCapability != actual.CancelCapability ||
		(expected.NativeID != nil && (actual.NativeID == nil || *expected.NativeID != *actual.NativeID)) ||
		(expected.NativeStatus != nil && (actual.NativeStatus == nil || *expected.NativeStatus != *actual.NativeStatus)) ||
		expected.LastObservedAt != nil || expected.TerminalAt != nil {
		return errors.New("native observation differs from the frozen protocol expectation")
	}
	return nil
}

// DD-124(2): exactly the declared captures, only from a SUCCEEDED native
// terminal, and a typed-slot capture equals the typed ContentReference. A
// missing slot is a definite mismatch, never a value Worker can supply.
func verifyConformanceCaptures(step generated.PlanStep, observation generated.ComponentConformanceStepObservation) error {
	succeeded := observation.NativeObservation != nil && string(observation.NativeObservation.PlatformStatus) == "SUCCEEDED"
	if len(step.Captures) == 0 || !succeeded {
		if len(observation.Captures) != 0 {
			return errors.New("captured values without a declared successful producer")
		}
		return nil
	}
	if len(observation.Captures) != len(step.Captures) {
		return errors.New("declared captures are missing from the actual response")
	}
	for index, capture := range step.Captures {
		value := observation.Captures[index]
		if value.Key != capture.Key || strings.TrimSpace(value.Value) == "" || strings.HasPrefix(value.Value, "{{") {
			return errors.New("captured value differs from its declaration")
		}
		reference := observation.ContentReference
		switch string(capture.Slot) {
		case "CONTENT_REFERENCE_NATIVE_OBJECT_REF":
			if reference == nil || reference.NativeObjectRef != value.Value {
				return errors.New("captured object differs from the typed reference")
			}
		case "CONTENT_REFERENCE_NATIVE_REVISION":
			if reference == nil || reference.NativeRevision != value.Value {
				return errors.New("captured revision differs from the typed reference")
			}
		case "GENERATED_REF":
		default:
			return errors.New("capture slot is not executable by this runner")
		}
	}
	return nil
}

// DD-124(2): the probe carries exactly the values its CAPTURE bindings read
// from earlier steps; an EXPECTED binding to this step's own capture keeps
// its placeholder. Values are never a fixture or an operator input.
func validProbeCaptures(input generated.ComponentConformanceProbe) error {
	step := input.Plan.Steps[input.StepIndex]
	own := make(map[string]bool)
	for _, capture := range step.Captures {
		own[capture.Key] = true
	}
	needed := make(map[string]bool)
	for _, binding := range step.Bindings {
		if string(binding.Source) != "CAPTURE" {
			return errors.New("only CAPTURE bindings remain in a frozen plan")
		}
		if !own[binding.Key] {
			needed[binding.Key] = true
		}
	}
	seen := make(map[string]bool)
	for _, value := range input.Captures {
		if !needed[value.Key] || seen[value.Key] || strings.TrimSpace(value.Value) == "" || strings.HasPrefix(value.Value, "{{") {
			return errors.New("capture value is not a declared binding")
		}
		seen[value.Key] = true
	}
	if len(seen) != len(needed) {
		return errors.New("declared capture value is missing")
	}
	return nil
}

func (candidate *componentCandidate) validatePlan(plan generated.PlanClass) error {
	if plan.ArtifactDigest != candidate.configuration.ArtifactDigest || len(plan.Steps) == 0 ||
		int64(len(plan.Steps)) > candidate.configuration.MaxSteps ||
		!validConformanceDigest(plan.PlanDigest) || !validConformanceDigest(plan.SuiteDigest) ||
		len(plan.ContractDigests) == 0 {
		return errors.New("conformance frozen plan or candidate mismatch")
	}
	// runId is observed by the original Workflow after Start; it is not a value
	// Core can freeze before dispatch. All other fields remain digest-pinned.
	frozen := plan
	frozen.PlanDigest, frozen.RunID = "", ""
	encoded, err := json.Marshal(frozen)
	if err != nil {
		return errors.New("conformance plan cannot be encoded")
	}
	actualDigest, err := conformanceJSONDigest(encoded)
	if err != nil || actualDigest != plan.PlanDigest {
		return errors.New("conformance plan content does not match its digest")
	}
	seen := make(map[string]struct{})
	for _, digest := range plan.ContractDigests {
		if !validConformanceDigest(digest) {
			return errors.New("invalid contract digest")
		}
	}
	for _, step := range plan.Steps {
		key := step.CaseKey + ":" + step.StepKey
		if _, duplicate := seen[key]; duplicate || step.CaseKey == "" || step.StepKey == "" ||
			!validAdapterOperation(step.Operation) || step.IdempotencyKey == "" ||
			step.ExpectedHTTPStatus < http.StatusOK || step.ExpectedHTTPStatus > 599 {
			return errors.New("invalid conformance step")
		}
		seen[key] = struct{}{}
		var parsed any
		if err := decodeConformanceJSON([]byte(step.RequestJSON), &parsed); err != nil {
			return errors.New("invalid conformance request")
		}
		if err := decodeConformanceJSON([]byte(step.ExpectedResponseJSON), &parsed); err != nil {
			return errors.New("invalid conformance expectation")
		}
		for _, binding := range step.Bindings {
			side := string(binding.Side)
			if string(binding.Source) != "CAPTURE" || (side != "INPUT" && side != "EXPECTED") ||
				binding.Key == "" || !strings.HasPrefix(binding.Pointer, "/") || step.ContractKey == nil {
				return errors.New("invalid frozen capture binding")
			}
		}
		for _, capture := range step.Captures {
			if capture.Key == "" || step.ContractKey == nil {
				return errors.New("invalid frozen capture declaration")
			}
		}
	}
	return nil
}

// RunComponentConformanceStep is one Activity of the existing ComponentTask.
// Mutating operations get one wire attempt. Its result or timeout is recorded
// by Temporal; the Workflow uses only observe/reconcile for uncertain results.
func (c *CoreAPI) RunComponentConformanceStep(ctx context.Context, input generated.ComponentConformanceProbe) (generated.ComponentConformanceStepObservation, error) {
	plan := input.Plan
	if input.StepIndex < 0 || input.StepIndex >= int64(len(plan.Steps)) {
		return generated.ComponentConformanceStepObservation{}, temporal.NewNonRetryableApplicationError("套件步骤不在冻结范围", ErrTypeRejected, nil)
	}
	step := plan.Steps[input.StepIndex]
	if plan.ConnectorKind != nil && string(*plan.ConnectorKind) == "PROTOCOL_PEER" {
		info := activity.GetInfo(ctx)
		if info.Attempt != 1 || (input.Reconcile != nil && *input.Reconcile) ||
			info.WorkflowExecution.ID != plan.WorkflowID || info.WorkflowExecution.RunID != plan.RunID {
			return generated.ComponentConformanceStepObservation{}, temporal.NewNonRetryableApplicationError("原生 MCP 尝试结果不明，禁止重放", ErrTypeUnknownExternalResult, nil)
		}
		// Core consumes the real SDK response in memory. No raw body, native
		// bearer or invented adapter/native task is put into Activity history.
		var observed generated.ComponentConformanceStepObservation
		if err := c.post(ctx, "/service/v1/component-releases/authorize-probe", input, &observed); err != nil {
			return observed, temporal.NewNonRetryableApplicationError("原生 MCP 尝试未取得确定回执", ErrTypeUnknownExternalResult, nil)
		}
		if observed.CaseKey != step.CaseKey || observed.StepKey != step.StepKey || observed.Operation != step.Operation ||
			observed.HTTPStatus != 0 || observed.MCPResultKind == nil || string(*observed.MCPResultKind) != "RESULT" ||
			observed.ErrorClass != nil || observed.NativeObservation != nil || observed.NativeScopeObservation != nil || observed.BindingDigest != nil ||
			observed.ContentReference != nil || !validConformanceDigest(observed.ResponseDigest) {
			return observed, temporal.NewNonRetryableApplicationError("原生 MCP 回执不匹配冻结探针", ErrTypeRejected, nil)
		}
		requestDigest, err := conformanceJSONDigest([]byte(step.RequestJSON))
		if err != nil || requestDigest != observed.RequestDigest {
			return observed, temporal.NewNonRetryableApplicationError("原生 MCP 请求摘要不匹配", ErrTypeRejected, nil)
		}
		expected, err := conformanceJSONDigest([]byte(step.ExpectedResponseJSON))
		actual := observed.ResponseDigest
		if string(step.Operation) == "mcp_call" {
			if observed.ResultDigest == nil {
				return observed, temporal.NewNonRetryableApplicationError("原生 MCP 结果缺失", ErrTypeRejected, nil)
			}
			actual = *observed.ResultDigest
		}
		if err != nil || expected != actual {
			return observed, temporal.NewNonRetryableApplicationError("原生 MCP 结果不符冻结向量", ErrTypeRejected, nil)
		}
		return observed, nil
	}
	if step.ReferenceFromStepKey != nil {
		if input.ContentReference == nil || step.ReferenceResourceID == nil ||
			!validContentReference(generated.ContentReference(*input.ContentReference), *step.ReferenceResourceID, step.ReferenceAssetID) {
			return generated.ComponentConformanceStepObservation{}, temporal.NewNonRetryableApplicationError("引用不在冻结授权目标", ErrTypeRejected, nil)
		}
		// Core alone materializes this typed reference into the production
		// arguments.input slot and returns the exact canonical wire below.
	} else if input.ContentReference != nil {
		return generated.ComponentConformanceStepObservation{}, temporal.NewNonRetryableApplicationError("步骤未授权外部引用", ErrTypeRejected, nil)
	}
	if err := validProbeCaptures(input); err != nil {
		// Core substitutes and signs; the Worker only forwards recorded values.
		return generated.ComponentConformanceStepObservation{}, temporal.NewNonRetryableApplicationError("捕获值与冻结绑定不符", ErrTypeRejected, nil)
	}
	if input.Reconcile != nil && *input.Reconcile {
		// This is the protocol's original idempotency-key observation, not a
		// retry of an uncertain external write and not a second execution.
		var request []byte
		var err error
		switch string(step.Operation) {
		case "resolve_native_scope":
			var scope map[string]any
			if decodeConformanceJSON([]byte(step.RequestJSON), &scope) != nil {
				return generated.ComponentConformanceStepObservation{}, temporal.NewNonRetryableApplicationError("冻结 scope 请求不可解析", ErrTypeRejected, nil)
			}
			scope["mode"] = "LOOKUP"
			request, err = json.Marshal(scope)
		case "execute", "cancel", "observe", "reconcile":
			step.Operation = "reconcile"
			request, err = json.Marshal(map[string]string{"idempotencyKey": step.IdempotencyKey})
		case "receiver_start", "receiver_observe":
			step.Operation = "receiver_observe"
			request = []byte(step.RequestJSON)
		default:
			// The remaining protocol probes only inspect configuration or
			// map supplied status; their original request has no side effect.
			request = []byte(step.RequestJSON)
		}
		if err != nil {
			return generated.ComponentConformanceStepObservation{}, err
		}
		step.RequestJSON = string(request)
	}
	unknown := func() (generated.ComponentConformanceStepObservation, error) {
		class := generated.ErrorClass("UNKNOWN")
		requestHash := sha256.Sum256([]byte(step.RequestJSON))
		requestDigest := hex.EncodeToString(requestHash[:])
		return generated.ComponentConformanceStepObservation{
			CaseKey: step.CaseKey, StepKey: step.StepKey, Operation: step.Operation, RequestDigest: requestDigest, ErrorClass: &class,
		}, temporal.NewNonRetryableApplicationError("套件尝试结果不明，禁止重放", ErrTypeUnknownExternalResult, nil)
	}
	info := activity.GetInfo(ctx)
	if info.WorkflowExecution.ID != plan.WorkflowID || info.WorkflowExecution.RunID != plan.RunID {
		return unknown()
	}
	if info.Attempt != 1 && step.Operation != "observe" && step.Operation != "reconcile" {
		return unknown()
	}
	path := os.Getenv("COMPONENT_CONFORMANCE_ENVIRONMENT_FILE")
	if path == "" {
		return generated.ComponentConformanceStepObservation{}, temporal.NewNonRetryableApplicationError("隔离候选配置未投递", ErrTypeAdmissionDenied, nil)
	}
	encoded, err := os.ReadFile(path)
	var configuration generated.ComponentConformanceEnvironment
	if err != nil || decodeConformanceJSON(encoded, &configuration) != nil {
		return generated.ComponentConformanceStepObservation{}, temporal.NewNonRetryableApplicationError("隔离候选配置不可用", ErrTypeAdmissionDenied, nil)
	}
	candidate, err := newComponentCandidate(configuration)
	if err != nil {
		return generated.ComponentConformanceStepObservation{}, temporal.NewNonRetryableApplicationError("隔离候选配置不成立", ErrTypeAdmissionDenied, nil)
	}
	defer candidate.http.CloseIdleConnections()
	if err := candidate.validatePlan(plan); err != nil {
		return generated.ComponentConformanceStepObservation{}, temporal.NewNonRetryableApplicationError("套件冻结输入与候选不符", ErrTypeRejected, nil)
	}
	// The token is returned into this Activity's memory only. It is never an
	// Activity result, Workflow input, heartbeat or report field. Core rechecks
	// the original admission and signs the actual typed reference parameters.
	var authorization generated.ComponentConformanceAuthorization
	if err := c.post(ctx, "/service/v1/component-releases/authorize-probe", input, &authorization); err != nil {
		return generated.ComponentConformanceStepObservation{}, err
	}
	requestHash := sha256.Sum256([]byte(authorization.RequestJSON))
	if authorization.RequestDigest != hex.EncodeToString(requestHash[:]) || authorization.Operation != step.Operation {
		return generated.ComponentConformanceStepObservation{}, temporal.NewNonRetryableApplicationError("实际套件参数未被Core绑定", ErrTypeRejected, nil)
	}
	step.RequestJSON = authorization.RequestJSON
	candidate.digestResponse = func(ctx context.Context, _ generated.PlanStep, body []byte, status int64) (generated.ComponentConformanceWireDigests, error) {
		var digests generated.ComponentConformanceWireDigests
		err := c.post(ctx, "/service/v1/component-releases/observe-probe", map[string]any{"probe": input, "responseJson": string(body), "httpStatus": status}, &digests)
		return digests, err
	}
	observation := candidate.call(ctx, step, authorization.Token)
	if input.ContentReference != nil && observation.ContentReference != nil {
		before, beforeErr := json.Marshal(input.ContentReference)
		after, afterErr := json.Marshal(observation.ContentReference)
		if beforeErr != nil || afterErr != nil || !bytes.Equal(before, after) {
			return observation, temporal.NewNonRetryableApplicationError("内容引用往返发生目标或版本漂移", ErrTypeRejected, nil, observation)
		}
	}
	if observation.ErrorClass != nil {
		if string(*observation.ErrorClass) == "UNKNOWN" {
			return observation, temporal.NewNonRetryableApplicationError("套件线协议结果不明", ErrTypeUnknownExternalResult, nil, observation)
		}
		return observation, temporal.NewNonRetryableApplicationError("套件线协议被确定拒绝", ErrTypeRejected, nil, observation)
	}
	if err := verifyConformanceStep(step, observation, authorization.ExpectedResponseDigest); err != nil {
		if observation.NativeObservation != nil {
			switch string(observation.NativeObservation.PlatformStatus) {
			case "PENDING_DISPATCH", "RUNNING", "UNKNOWN":
				return observation, temporal.NewNonRetryableApplicationError("原生执行尚无终态，继续同键观察", ErrTypeUnknownExternalResult, nil, observation)
			}
		}
		return observation, temporal.NewNonRetryableApplicationError("套件实际响应不符合冻结向量", ErrTypeRejected, nil, observation)
	}
	return observation, nil
}

// The only consumer of the report is the original Core admission. No caller
// can supply a pass flag or write a stand-alone suite attestation.
func (c *CoreAPI) RecordComponentConformance(ctx context.Context, report generated.ComponentConformanceObservation) (generated.ComponentReleaseReceipt, error) {
	var raw json.RawMessage
	var receipt generated.ComponentReleaseReceipt
	if err := c.post(ctx, "/service/v1/component-releases/register-result", report, &raw); err != nil {
		return receipt, err
	}
	if decodeConformanceJSON(raw, &receipt) != nil || receipt.ActionExecutionID != report.ActionExecutionID ||
		receipt.ComponentReleaseID != report.ComponentReleaseID || receipt.PlanDigest != report.PlanDigest || string(receipt.Status) != "REGISTERED" {
		return receipt, temporal.NewNonRetryableApplicationError("原登记终态未查证", ErrTypeUnknownExternalResult, nil)
	}
	return receipt, nil
}
