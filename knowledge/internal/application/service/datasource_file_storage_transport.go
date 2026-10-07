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
	key      string
	value    map[string]json.RawMessage
	receiver map[string]json.RawMessage
	request  map[string]any
}

type fileStorageTransport struct {
	config *config.FileStorageSyncConfig
	http   *http.Client
	core   *url.URL
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

func (t *fileStorageTransport) call(ctx context.Context, endpoint string, body []byte, token, key string) ([]byte, http.Header, error) {
	if _, err := fileStorageURL(endpoint); err != nil {
		return nil, nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
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
	body, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("invalid controlled request metadata")
	}
	u := t.core.ResolveReference(&url.URL{Path: route})
	raw, headers, err := t.call(ctx, u.String(), body, token.AccessToken, "")
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
	return &fileStorageGrant{key: key, value: result, receiver: receiver, request: request}, nil
}

func (t *fileStorageTransport) pep(ctx context.Context, grant *fileStorageGrant) error {
	if fileStorageNumber(grant.receiver, "expiresAt") <= time.Now().Unix() {
		return fmt.Errorf("receiver grant expired")
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
	return t.call(ctx, fileStorageText(grant.value, "endpoint"), []byte(fileStorageText(grant.value, "argumentsJson")),
		fileStorageText(grant.value, "actionToken"), grant.key)
}

func fileStorageDigest(raw []byte) string {
	digest := sha256.Sum256(raw)
	return hex.EncodeToString(digest[:])
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
		return nil
	}
	meters := []map[string]any{}
	for _, meter := range t.config.UsageMeasurements {
		quantity := int64(1)
		if meter.QuantitySource == "CONTENT_BYTES" {
			quantity = size
		}
		meters = append(meters, map[string]any{"meterKey": meter.MeterKey, "quantity": quantity})
	}
	result, err := t.coreCall(ctx, "/service/v1/adapter/read_receipt", map[string]any{
		"bindingId": t.config.BindingID, "operationId": fileStorageText(grant.value, "operationId"),
		"role": "RECEIVER", "idempotencyKey": grant.key, "nativeObjectRef": nativeID, "nativeRevision": revision,
		"contentSha256": digest, "contentBytes": size, "completedAt": completed.UTC().Format(time.RFC3339Nano), "measurements": meters,
	})
	if err != nil {
		return err
	}
	digestBytes, decodeErr := hex.DecodeString(fileStorageText(result, "receiptDigest"))
	if fileStorageText(result, "operationId") != fileStorageText(grant.value, "operationId") || decodeErr != nil || len(digestBytes) != sha256.Size {
		return fmt.Errorf("native receiver receipt acknowledgement is unavailable")
	}
	// Receipt acceptance is not committed usage or a terminal Operation. The
	// same grant request is also the existing read-only reconciliation path;
	// PENDING/UNKNOWN leaves the native cursor unchanged and issues no write.
	observation, err := t.coreCall(ctx, "/service/v1/adapter/request_read_grant", grant.request)
	if err != nil {
		return err
	}
	if fileStorageText(observation, "outcome") != "COMPLETED" ||
		fileStorageText(observation, "operationId") != fileStorageText(grant.value, "operationId") {
		return fmt.Errorf("native read operation has not confirmed both receipts and committed usage")
	}
	completedGrant := &fileStorageGrant{key: grant.key, value: observation}
	return t.receipt(ctx, completedGrant, nativeID, revision, digest, size, completed)
}
