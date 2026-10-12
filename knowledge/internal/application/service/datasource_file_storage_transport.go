package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Tencent/WeKnora/internal/config"
	"github.com/google/uuid"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/clientcredentials"
)

// Wire objects deliberately consume the existing protocol JSON, rather than
// maintaining another copy of its generated platform contract types here.
type fileStorageGrant struct {
	key        string
	value      map[string]json.RawMessage
	receiver   map[string]json.RawMessage
	request    map[string]any
	generation int64 // Frozen by the authenticated PEP, never by delivery or JWT claims.
}

type fileStorageTransport struct {
	config *config.FileStorageSyncConfig
	http   *http.Client
	core   *url.URL
}

type fileStorageReadObservationsKey struct{}
type fileStorageReadObservations struct {
	batchID, dataSourceID string
	generation            int64
	values                map[string]json.RawMessage
}

// Retain only the response to the original authenticated Core observation.
// The same read Operation may be retried, but cannot change its receipts.
func (t *fileStorageTransport) retainReadObservation(ctx context.Context, grant *fileStorageGrant) error {
	retained, constrained := ctx.Value(fileStorageReadObservationsKey{}).(*fileStorageReadObservations)
	if !constrained {
		return nil
	}
	batch, ok := grant.request["nativeBatch"].(map[string]any)
	if !ok {
		return fmt.Errorf("original read batch reference is unavailable")
	}
	if batch["batchId"] != retained.batchID {
		return nil
	} // prior native run's recovery
	if batch["importConfigRef"] != retained.dataSourceID || batch["receiverResourceId"] != t.config.ReceiverResourceID ||
		fileStorageText(grant.value, "outcome") != "COMPLETED" || retained.generation <= 0 ||
		fileStorageNumber(grant.value, "receiverGeneration") != retained.generation {
		return fmt.Errorf("read observation differs from the original receiver batch")
	}
	for _, field := range []string{"actionExecutionId", "receiverActionExecutionId", "operationId", "sourceBindingId"} {
		if !fileStorageUUID(fileStorageText(grant.value, field)) {
			return fmt.Errorf("completed read execution reference unavailable")
		}
	}
	var source, receiver map[string]json.RawMessage
	if json.Unmarshal(grant.value["sourceReceipt"], &source) != nil || json.Unmarshal(grant.value["receiverReceipt"], &receiver) != nil ||
		fileStorageText(source, "role") != "SOURCE" || fileStorageText(receiver, "role") != "RECEIVER" ||
		fileStorageText(source, "bindingId") != fileStorageText(grant.value, "sourceBindingId") ||
		fileStorageText(receiver, "bindingId") != t.config.BindingID {
		return fmt.Errorf("completed read bilateral receipt ownership unavailable")
	}
	for _, receipt := range []map[string]json.RawMessage{source, receiver} {
		if fileStorageText(receipt, "operationId") != fileStorageText(grant.value, "operationId") ||
			fileStorageText(receipt, "idempotencyKey") != grant.key {
			return fmt.Errorf("completed read receipt identity changed")
		}
	}
	value := map[string]any{"readRequest": grant.request, "nativeBatch": batch, "sourceResourceId": grant.request["sourceResourceId"]}
	for _, field := range []string{"actionExecutionId", "receiverActionExecutionId", "receiverGeneration", "operationId", "sourceBindingId", "sourceReceipt", "receiverReceipt"} {
		value[field] = grant.value[field]
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if old, exists := retained.values[grant.key]; exists && !bytes.Equal(old, raw) {
		return fmt.Errorf("original read observation changed")
	}
	// Use the existing delivered metadata bound. Never silently truncate the
	// evidence set or leave a partially updated native checkpoint on overflow.
	copy := make(map[string]json.RawMessage, len(retained.values)+1)
	for key, item := range retained.values {
		copy[key] = item
	}
	copy[grant.key] = raw
	encoded, err := json.Marshal(copy)
	if err != nil || int64(len(encoded)) > t.config.MaxBodyBytes {
		return fmt.Errorf("native read evidence exceeds its delivered bound")
	}
	retained.values[grant.key] = raw
	return nil
}

func newFileStorageTransport(cfg *config.FileStorageSyncConfig) (*fileStorageTransport, error) {
	if cfg == nil || !fileStorageUUID(cfg.BindingID) || !fileStorageUUID(cfg.ReceiverResourceID) ||
		!fileStorageUUID(cfg.NativeKnowledgeBaseID) || cfg.NativeTenantID == 0 || cfg.TimeoutMS <= 0 ||
		cfg.MaxBodyBytes <= 0 || cfg.ListActionVersion <= 0 || cfg.ReadActionVersion <= 0 ||
		cfg.ApplyActionVersion <= 0 || cfg.RetireActionVersion <= 0 || cfg.ApplyActionKey == "" ||
		cfg.RetireActionKey == "" || cfg.ApplyActionKey == cfg.RetireActionKey || cfg.OIDCClientID == "" ||
		!filepath.IsAbs(cfg.OIDCClientSecretFile) {
		return nil, fmt.Errorf("file-storage binding configuration is incomplete")
	}
	core, err := fileStorageURL(cfg.CorePepURL)
	if err != nil || core.Path != "/service/v1/adapter/pep_check" {
		return nil, fmt.Errorf("file-storage binding PEP configuration is invalid")
	}
	if _, err := fileStorageURL(cfg.OIDCTokenURL); err != nil {
		return nil, err
	}
	keys := map[string]bool{}
	for _, meter := range cfg.UsageMeasurements {
		if meter.MeterKey == "" || keys[meter.MeterKey] ||
			(meter.QuantitySource != "COUNT" && meter.QuantitySource != "CONTENT_BYTES") {
			return nil, fmt.Errorf("file-storage binding meter configuration is invalid")
		}
		keys[meter.MeterKey] = true
	}
	return &fileStorageTransport{config: cfg, core: core, http: &http.Client{
		Timeout:       time.Duration(cfg.TimeoutMS) * time.Millisecond,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}, nil
}

func fileStorageUUID(text string) bool {
	id, err := uuid.Parse(text)
	return err == nil && id != uuid.Nil && id.String() == text
}

func fileStorageURL(text string) (*url.URL, error) {
	u, err := url.Parse(text)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil || u.Fragment != "" {
		return nil, fmt.Errorf("file-storage controlled endpoint is invalid")
	}
	return u, nil
}

func fileStorageText(value map[string]json.RawMessage, key string) string {
	var text string
	_ = json.Unmarshal(value[key], &text)
	return text
}

func fileStorageNumber(value map[string]json.RawMessage, key string) int64 {
	var number int64
	if json.Unmarshal(value[key], &number) != nil {
		return -1
	}
	return number
}

func (t *fileStorageTransport) call(ctx context.Context, method, endpoint string, body []byte, token, key string) ([]byte, http.Header, error) {
	if _, err := fileStorageURL(endpoint); err != nil {
		return nil, nil, err
	}
	request, err := http.NewRequestWithContext(ctx, method, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, nil, fmt.Errorf("construct controlled file-storage request")
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/json")
	if key != "" {
		request.Header.Set("Idempotency-Key", key)
	}
	response, err := t.http.Do(request)
	if err != nil {
		return nil, nil, fmt.Errorf("controlled file-storage request remains unconfirmed")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, nil, fmt.Errorf("controlled file-storage request refused: HTTP %d", response.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, t.config.MaxBodyBytes+1))
	if err != nil || int64(len(raw)) > t.config.MaxBodyBytes {
		return nil, nil, fmt.Errorf("controlled file-storage response is incomplete or exceeds its delivered bound")
	}
	return raw, response.Header, nil
}

func (t *fileStorageTransport) coreCall(ctx context.Context, route string, value any) (map[string]json.RawMessage, error) {
	body, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("invalid controlled request metadata")
	}
	return t.coreRequest(ctx, http.MethodPost, &url.URL{Path: route}, body)
}

func (t *fileStorageTransport) coreRequest(ctx context.Context, method string, route *url.URL, body []byte) (map[string]json.RawMessage, error) {
	secret, err := os.ReadFile(t.config.OIDCClientSecretFile)
	if err != nil {
		return nil, fmt.Errorf("binding service credential is unavailable")
	}
	credential := strings.TrimSpace(string(secret))
	if credential == "" || strings.ContainsAny(credential, "\r\n") {
		return nil, fmt.Errorf("binding service credential is invalid")
	}
	// Use the locked OAuth implementation. Never forward this service bearer to
	// the source endpoint; source requests carry only Core's scoped ActionToken.
	ctx = context.WithValue(ctx, oauth2.HTTPClient, t.http)
	identity := clientcredentials.Config{ClientID: t.config.OIDCClientID, ClientSecret: credential,
		TokenURL: t.config.OIDCTokenURL, AuthStyle: oauth2.AuthStyleInHeader}
	token, err := identity.Token(ctx)
	if err != nil || token == nil || !token.Valid() {
		return nil, fmt.Errorf("binding service authentication is unavailable")
	}
	u := t.core.ResolveReference(route)
	raw, headers, err := t.call(ctx, method, u.String(), body, token.AccessToken, "")
	if err != nil {
		return nil, err
	}
	var result map[string]json.RawMessage
	if !strings.HasPrefix(headers.Get("Content-Type"), "application/json") || json.Unmarshal(raw, &result) != nil || result == nil {
		return nil, fmt.Errorf("invalid controlled response metadata")
	}
	return result, nil
}

func (t *fileStorageTransport) grant(ctx context.Context, run fileStorageRun, source, action string, version int64,
	key, receiverAction string, receiverVersion int64, input any) (*fileStorageGrant, error) {
	inputRaw, err := json.Marshal(input)
	if err != nil {
		return nil, err
	}
	request := map[string]any{
		"receiverBindingId": t.config.BindingID, "sourceResourceId": source,
		"actionKey": action, "actionVersion": version, "idempotencyKey": key, "inputJson": string(inputRaw),
		"nativeBatch": map[string]any{"receiverResourceId": t.config.ReceiverResourceID,
			"importConfigRef": run.dataSourceID, "batchId": run.syncLogID,
			"actionKey": receiverAction, "actionVersion": receiverVersion},
	}
	result, err := t.coreCall(ctx, "/service/v1/adapter/request_read_grant", request)
	if err != nil {
		return nil, err
	}
	var receiver, wire map[string]json.RawMessage
	for _, name := range []string{"operationId", "actionExecutionId", "sourceBindingId"} {
		if !fileStorageUUID(fileStorageText(result, name)) {
			return nil, fmt.Errorf("invalid source grant identity")
		}
	}
	if outcome := fileStorageText(result, "outcome"); outcome != "" {
		if outcome == "PENDING" || outcome == "UNKNOWN" {
			// Observation is not another authorization. A saved native delete
			// intent may still yield its original terminal receipt after expiry;
			// no receiver token is accepted or reconstructed on this path.
			return &fileStorageGrant{key: key, value: result, request: request}, nil
		}
		if outcome != "COMPLETED" {
			return nil, fmt.Errorf("original native read operation has an unknown outcome")
		}
		var receipt map[string]json.RawMessage
		if json.Unmarshal(result["receiverReceipt"], &receipt) != nil ||
			fileStorageText(receipt, "bindingId") != t.config.BindingID || fileStorageText(receipt, "role") != "RECEIVER" ||
			fileStorageText(receipt, "operationId") != fileStorageText(result, "operationId") || fileStorageText(receipt, "idempotencyKey") != key {
			return nil, fmt.Errorf("completed native read receipt is invalid")
		}
		return &fileStorageGrant{key: key, value: result, request: request}, nil
	}
	if json.Unmarshal(result["receiverWrite"], &receiver) != nil || receiver == nil ||
		!fileStorageUUID(fileStorageText(receiver, "actionExecutionId")) ||
		fileStorageText(receiver, "actionToken") == "" || fileStorageNumber(receiver, "expiresAt") <= time.Now().Unix() ||
		fileStorageText(result, "actionToken") == "" || fileStorageNumber(result, "expiresAt") <= time.Now().Unix() ||
		json.Unmarshal([]byte(fileStorageText(result, "argumentsJson")), &wire) != nil ||
		fileStorageText(wire, "actionKey") != action || fileStorageText(wire, "idempotencyKey") != key {
		return nil, fmt.Errorf("incomplete source/receiver grant")
	}
	var receiverArgs, receiverInput map[string]json.RawMessage
	if json.Unmarshal([]byte(fileStorageText(receiver, "argumentsJson")), &receiverArgs) != nil ||
		json.Unmarshal(receiverArgs["input"], &receiverInput) != nil ||
		fileStorageText(receiverArgs, "targetType") != "RESOURCE" || fileStorageText(receiverArgs, "targetId") != t.config.ReceiverResourceID ||
		fileStorageText(receiverArgs, "authorizationTargetNativeRef") != t.config.NativeKnowledgeBaseID ||
		fileStorageText(receiverInput, "sourceResourceId") != source || fileStorageText(receiverInput, "importConfigRef") != run.dataSourceID ||
		fileStorageText(receiverInput, "batchId") != run.syncLogID || fileStorageText(receiverInput, "sourceReadActionExecutionId") != fileStorageText(result, "actionExecutionId") {
		return nil, fmt.Errorf("receiver grant does not match its native binding or batch")
	}
	var args map[string]json.RawMessage
	if json.Unmarshal(wire["arguments"], &args) != nil || fileStorageText(args, "targetType") != "RESOURCE" ||
		fileStorageText(args, "targetId") != source {
		return nil, fmt.Errorf("source grant scope mismatch")
	}
	var wanted, actual any
	if json.Unmarshal(inputRaw, &wanted) != nil || json.Unmarshal(args["input"], &actual) != nil {
		return nil, fmt.Errorf("source grant input unavailable")
	}
	a, _ := json.Marshal(wanted)
	b, _ := json.Marshal(actual)
	if !bytes.Equal(a, b) {
		return nil, fmt.Errorf("source grant input mismatch")
	}
	grant := &fileStorageGrant{key: key, value: result, receiver: receiver, request: request}
	if _, constrained := ctx.Value(fileStorageReadObservationsKey{}).(*fileStorageReadObservations); constrained {
		// Discovery reads the source before its later receiver write PEP. A
		// frozen native batch must prove the admitted generation before either
		// source access or receiver side effects, not only when saving receipts.
		if err := t.pep(ctx, grant); err != nil {
			return nil, err
		}
	}
	return grant, nil
}

func (t *fileStorageTransport) pep(ctx context.Context, grant *fileStorageGrant) error {
	if fileStorageText(grant.value, "outcome") != "" {
		return fmt.Errorf("original read observation cannot authorize another receiver write")
	}
	if fileStorageNumber(grant.receiver, "expiresAt") <= time.Now().Unix() {
		return fmt.Errorf("receiver grant expired")
	}
	expectedGeneration := grant.generation
	if retained, constrained := ctx.Value(fileStorageReadObservationsKey{}).(*fileStorageReadObservations); constrained {
		batch, ok := grant.request["nativeBatch"].(map[string]any)
		if !ok || retained.generation <= 0 || batch["batchId"] != retained.batchID ||
			batch["importConfigRef"] != retained.dataSourceID || batch["receiverResourceId"] != t.config.ReceiverResourceID ||
			(expectedGeneration != 0 && expectedGeneration != retained.generation) {
			return fmt.Errorf("receiver grant differs from its frozen native batch")
		}
		expectedGeneration = retained.generation
	}
	result, err := t.coreCall(ctx, "/service/v1/adapter/pep_check", map[string]any{
		"bindingId": t.config.BindingID, "actionToken": fileStorageText(grant.receiver, "actionToken"),
		"operation": "execute", "argumentsJson": fileStorageText(grant.receiver, "argumentsJson"),
	})
	if err != nil {
		return err
	}
	if fileStorageText(result, "actionExecutionId") != fileStorageText(grant.receiver, "actionExecutionId") ||
		fileStorageText(result, "operationId") != fileStorageText(grant.value, "operationId") ||
		fileStorageText(result, "authorizationMinZedToken") == "" {
		return fmt.Errorf("receiver PEP evidence mismatch")
	}
	generation := fileStorageNumber(result, "bindingGeneration")
	if generation <= 0 || (expectedGeneration != 0 && expectedGeneration != generation) {
		return fmt.Errorf("receiver PEP frozen generation is missing or changed")
	}
	grant.generation = generation
	return nil
}

func (t *fileStorageTransport) source(ctx context.Context, grant *fileStorageGrant) ([]byte, http.Header, error) {
	if fileStorageText(grant.value, "outcome") != "" {
		return nil, nil, fmt.Errorf("original read observation cannot authorize another source call")
	}
	remaining := time.Until(time.Unix(fileStorageNumber(grant.value, "expiresAt"), 0))
	if remaining <= 0 {
		return nil, nil, fmt.Errorf("source grant expired")
	}
	ctx, cancel := context.WithTimeout(ctx, remaining)
	defer cancel()
	return t.call(ctx, http.MethodPost, fileStorageText(grant.value, "endpoint"), []byte(fileStorageText(grant.value, "argumentsJson")),
		fileStorageText(grant.value, "actionToken"), grant.key)
}

func fileStorageDigest(raw []byte) string {
	digest := sha256.Sum256(raw)
	return hex.EncodeToString(digest[:])
}

// Same sorted UTF-8 JSON bytes as Core limits::canonical_digest and the
// existing Cells humanReadReceiptDigest / Worker conformanceJSONDigest.
// These are separate application modules; do not import a platform runtime
// into WeKnora to encode this existing receipt wire contract.
func fileStorageReceiptDigest(receipt map[string]any) (string, error) {
	body, err := json.Marshal(receipt)
	if err != nil {
		return "", err
	}
	var value any
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()
	if err := decoder.Decode(&value); err != nil {
		return "", err
	}
	var encoded bytes.Buffer
	encoder := json.NewEncoder(&encoded)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return "", err
	}
	// Consume complete escapes: literal backslash-u text is not a Unicode
	// separator. Go always escapes U+2028/U+2029 while Core's serializer does not.
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
	return fileStorageDigest(canonical), nil
}

func (t *fileStorageTransport) receipt(ctx context.Context, grant *fileStorageGrant, nativeID, revision, digest string, size int64, completed time.Time) error {
	if nativeID == "" || revision == "" || len(digest) != sha256.Size*2 || size < 0 || completed.IsZero() {
		return fmt.Errorf("native receiver completion evidence is unavailable")
	}
	if fileStorageText(grant.value, "outcome") == "COMPLETED" {
		var receipt map[string]json.RawMessage
		if json.Unmarshal(grant.value["receiverReceipt"], &receipt) != nil ||
			fileStorageText(receipt, "bindingId") != t.config.BindingID || fileStorageText(receipt, "idempotencyKey") != grant.key ||
			fileStorageText(receipt, "operationId") != fileStorageText(grant.value, "operationId") || fileStorageText(receipt, "role") != "RECEIVER" ||
			fileStorageText(receipt, "nativeObjectRef") != nativeID || fileStorageText(receipt, "nativeRevision") != revision ||
			fileStorageText(receipt, "contentSha256") != digest || fileStorageNumber(receipt, "contentBytes") != size {
			return fmt.Errorf("completed receiver receipt differs from its native evidence")
		}
		return t.retainReadObservation(ctx, grant)
	}
	meters := []map[string]any{}
	for _, meter := range t.config.UsageMeasurements {
		quantity := int64(1)
		if meter.QuantitySource == "CONTENT_BYTES" {
			quantity = size
		}
		meters = append(meters, map[string]any{"meterKey": meter.MeterKey, "quantity": quantity})
	}
	receipt := map[string]any{
		"bindingId": t.config.BindingID, "operationId": fileStorageText(grant.value, "operationId"),
		"role": "RECEIVER", "idempotencyKey": grant.key, "nativeObjectRef": nativeID, "nativeRevision": revision,
		"contentSha256": digest, "contentBytes": size, "completedAt": completed.UTC().Format(time.RFC3339Nano), "measurements": meters,
	}
	receiptDigest, err := fileStorageReceiptDigest(receipt)
	if err != nil {
		return err
	}
	result, err := t.coreCall(ctx, "/service/v1/adapter/read_receipt", receipt)
	if err != nil {
		return err
	}
	if fileStorageText(result, "operationId") != fileStorageText(grant.value, "operationId") || fileStorageText(result, "receiptDigest") != receiptDigest {
		return fmt.Errorf("native receiver receipt acknowledgement is unavailable")
	}
	// Receipt acceptance is not committed usage or a terminal Operation. Pin
	// this follow-up to the already admitted SOURCE AE so missing/unfinished
	// evidence cannot fall through to new admission. Keep the original command
	// unchanged: it is retained in the batch's read evidence and compared by Core.
	actionExecutionID := fileStorageText(grant.value, "actionExecutionId")
	if !fileStorageUUID(actionExecutionID) {
		return fmt.Errorf("original source execution is unavailable for observation")
	}
	observeRequest := make(map[string]any, len(grant.request)+1)
	for key, value := range grant.request {
		observeRequest[key] = value
	}
	observeRequest["observeActionExecutionId"] = actionExecutionID
	observation, err := t.coreCall(ctx, "/service/v1/adapter/request_read_grant", observeRequest)
	if err != nil {
		return err
	}
	if fileStorageText(observation, "outcome") != "COMPLETED" ||
		fileStorageText(observation, "actionExecutionId") != actionExecutionID ||
		fileStorageText(observation, "operationId") != fileStorageText(grant.value, "operationId") {
		return fmt.Errorf("native read operation has not confirmed both receipts and committed usage")
	}
	completedGrant := &fileStorageGrant{key: grant.key, value: observation, request: grant.request}
	if err := t.receipt(ctx, completedGrant, nativeID, revision, digest, size, completed); err != nil {
		return err
	}
	// Keep only the exact Core-confirmed observation. The old source/receiver
	// tokens cannot be reused after this operation reached its genuine outcome.
	grant.value = observation
	grant.receiver = nil
	return nil
}
