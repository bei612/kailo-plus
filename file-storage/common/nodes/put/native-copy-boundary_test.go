package put

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/pborman/uuid"
	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/auth/claim"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/nodes"
	"github.com/pydio/cells/v5/common/nodes/models"
	"github.com/pydio/cells/v5/common/proto/idm"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/idm/meta"
)

type copyMetadataProbe struct {
	meta.UserMetaClient
	calls int
}

func (p *copyMetadataProbe) ExtractAndPut(_ context.Context, _ *tree.Node, _ *idm.Workspace, _ map[string]string, _ meta.ExtractionSource) (*idm.UpdateUserMetaResponse, error) {
	p.calls++
	return &idm.UpdateUserMetaResponse{}, nil
}

type copyBoundaryBackend struct {
	*nodes.HandlerMock
	calls int
	copyErr error
	afterCopy func()
}

func (b *copyBoundaryBackend) CopyObject(_ context.Context, _, _ *tree.Node, _ *models.CopyRequestData) (models.ObjectInfo, error) {
	b.calls++
	if b.afterCopy != nil {
		b.afterCopy()
	}
	return models.ObjectInfo{ETag: "copied", Size: 12}, b.copyErr
}

// Exercise the original put handler with the original native HUMAN admission;
// only its HTTP authority and byte-copy backend are isolated test fixtures.
func TestNativeUploadCopyRechecksBeforeOriginalMetadata(t *testing.T) {
	for _, scenario := range []string{"allowed", "revoked-during-copy", "copy-ack-lost", "independent", "independent-copy-error"} {
		t.Run(scenario, func(t *testing.T) {
			binding, ae, ee, key, intent, node, user, principal, resource, operation, policy := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
			input := map[string]interface{}{"resourceId": resource, "nativeIntentId": intent, "nativeNodeId": node, "nativeDeadline": float64(time.Now().Add(time.Hour).Unix()), "contentLength": float64(12), "multipart": false}
			claims := map[string]interface{}{"tenant_id": binding, "action_execution_id": ae, "external_execution_id": ee, "idempotency_key": key, "operation_id": operation, "actor_principal_id": principal, "initiating_human_principal_id": principal, "action_key": "file_storage.write@v2", "action_definition_version": float64(1), "target_type": "RESOURCE", "target_id": resource, "result_exposure_policy_id": policy, "result_exposure_policy_version": float64(1)}
			payload, _ := json.Marshal(claims)
			token := "fixture." + base64.RawURLEncoding.EncodeToString(payload) + ".fixture"
			arguments, _ := json.Marshal(map[string]interface{}{"target": map[string]interface{}{"resourceId": resource}, "input": input})
			revoked := false
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if r.URL.Path == "/token" {
					_ = json.NewEncoder(w).Encode(map[string]interface{}{"access_token": "service", "token_type": "Bearer", "expires_in": 60})
					return
				}
				if r.URL.Path == "/service/v1/adapter/human-action" {
					_ = json.NewEncoder(w).Encode(map[string]interface{}{"nativeExecutionAdmission": map[string]interface{}{"actionToken": token, "argumentsJson": string(arguments), "expiresAt": time.Now().Add(time.Minute).UTC().Format(time.RFC3339Nano)}})
					return
				}
				if r.URL.Path != "/service/v1/adapter/pep_check" || revoked {
					w.WriteHeader(http.StatusForbidden)
					return
				}
				_ = json.NewEncoder(w).Encode(map[string]interface{}{"actionExecutionId": ae, "operationId": operation, "authorizationMinZedToken": "fresh", "bindingGeneration": float64(3), "targetResource": map[string]interface{}{"resourceId": resource, "nativeType": "folder", "nativeRef": resource, "nativeInstanceRef": "instance", "nativeScopeRef": resource}})
			}))
			defer server.Close()
			secret := filepath.Join(t.TempDir(), "secret")
			if err := os.WriteFile(secret, []byte("fixture-only"), 0600); err != nil { t.Fatal(err) }
			ctx := config.WithStubStore(context.Background())
			ctx = claim.ToContext(ctx, claim.Claims{Subject: user, Name: "copy-user", SessionID: "native-session", AuthSource: "kailo"})
			delivery := map[string]interface{}{"bindingId": binding, "tenantId": binding, "nativeInstanceRef": "instance", "nativeScopeRef": resource, "nativeRootRef": resource, "instanceServiceUuid": binding, "corePepUrl": server.URL + "/service/v1/adapter/pep_check", "oidcTokenUrl": server.URL + "/token", "clientId": "native-binding", "clientSecretFile": secret, "clientSecretMaxBytes": 128, "maxResponseBytes": 65536, "requestTimeout": "2s", "draftUploads": map[string]interface{}{}, "actors": []map[string]interface{}{{"principalId": principal, "kind": "HUMAN", "userUuid": user}}, "write": map[string]interface{}{"nativeJobId": "native-write", "actionVersion": 1, "resultExposurePolicyId": policy, "resultExposurePolicyVersion": 1}}
			if err := config.Set(ctx, delivery, "services", common.ServiceRestNamespace_+"n", "platform"); err != nil { t.Fatal(err) }
			if err := config.Set(ctx, base64.StdEncoding.EncodeToString(make([]byte, 64)), "frontend", "session", "secureKey"); err != nil { t.Fatal(err) }
			if err := config.Set(ctx, []map[string]interface{}{{"id": "kailo", "type": "kailo-oidc", "config": map[string]interface{}{"issuer": "https://identity.invalid", "clientId": "native", "users": []map[string]interface{}{{"subject": principal, "userUuid": user}}}}}, "services", "pydio.web.oauth", "connectors"); err != nil { t.Fatal(err) }
			request := httptest.NewRequest(http.MethodPut, "http://native.invalid/io/live/file", nil).WithContext(ctx)
			cookies := httptest.NewRecorder()
			if err := auth.SaveNativeHumanToken(request, cookies, "human", "https://identity.invalid", principal, "native", user, "native-session", time.Now().Add(time.Minute)); err != nil { t.Fatal(err) }
			for _, cookie := range cookies.Result().Cookies() { request.AddCookie(cookie) }
			for name, value := range map[string]string{"X-Kailo-Action-Execution": ae, "X-Kailo-External-Execution": ee, "X-Kailo-Native-Upload": intent, "Idempotency-Key": key} { request.Header.Set(name, value) }
			if scenario != "independent" && scenario != "independent-copy-error" {
				if err := auth.PrepareNativeHumanUpload(request); err != nil { t.Fatal(err) }
			}
			metadata := &copyMetadataProbe{}
			backend := &copyBoundaryBackend{HandlerMock: nodes.NewHandlerMock()}
			if scenario == "copy-ack-lost" || scenario == "independent-copy-error" { backend.copyErr = errors.New("copy acknowledgement lost") }
			if scenario == "revoked-during-copy" { backend.afterCopy = func() { revoked = true } }
			handler := &Handler{metaClient: metadata}
			handler.Next = backend
			info, err := handler.CopyObject(request.Context(), &tree.Node{Uuid: node}, &tree.Node{Uuid: node}, &models.CopyRequestData{SrcVersionId: intent})
			if backend.calls != 1 || info.ETag != "copied" { t.Fatal("original copy did not run once", backend.calls, info) }
			if scenario == "revoked-during-copy" || scenario == "copy-ack-lost" {
				if err == nil || metadata.calls != 0 { t.Fatal("uncertain or revoked copy reached metadata", err, metadata.calls) }
			} else if scenario == "independent-copy-error" {
				if err == nil || metadata.calls != 1 { t.Fatal("independent copy behavior changed", err, metadata.calls) }
			} else if err != nil || metadata.calls != 1 { t.Fatal("allowed original copy lost metadata", err, metadata.calls) }
		})
	}
}
