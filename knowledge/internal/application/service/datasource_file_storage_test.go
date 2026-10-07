package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Tencent/WeKnora/internal/config"
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

func fileStorageTestWire(t *testing.T, value any) map[string]json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(value)
	require.NoError(t, err)
	var result map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(raw, &result))
	return result
}

func TestFileStorageTransportUsesOwnIdentityAndExactNativeReceiver(t *testing.T) {
	ids := make([]string, 8)
	for i := range ids {
		ids[i] = uuid.NewString()
	}
	secret := filepath.Join(t.TempDir(), "service-secret")
	require.NoError(t, os.WriteFile(secret, []byte("test-only-service-credential"), 0600))
	var server *httptest.Server
	var wrongTarget bool
	var granted int
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/oidc" {
			user, password, ok := r.BasicAuth()
			require.True(t, ok)
			require.Equal(t, "receiver-service", user)
			require.Equal(t, "test-only-service-credential", password)
			_, _ = w.Write([]byte(`{"access_token":"receiver-service-token","token_type":"Bearer","expires_in":3600}`))
			return
		}
		require.Equal(t, "Bearer receiver-service-token", r.Header.Get("Authorization"))
		require.Equal(t, "/service/v1/adapter/request_read_grant", r.URL.Path)
		var body map[string]any
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		require.Equal(t, ids[0], body["receiverBindingId"])
		require.Equal(t, ids[3], body["sourceResourceId"])
		require.Equal(t, map[string]any{"receiverResourceId": ids[1], "importConfigRef": ids[4], "batchId": ids[5],
			"actionKey": "knowledge.sync_apply@v2", "actionVersion": float64(1)}, body["nativeBatch"])
		require.NotContains(t, body, "receiverActionExecutionId")
		root := ids[2]
		if wrongTarget {
			root = uuid.NewString()
		}
		receiverArgs, _ := json.Marshal(map[string]any{"targetType": "RESOURCE", "targetId": ids[1], "authorizationTargetNativeRef": root,
			"input": map[string]any{"sourceResourceId": ids[3], "importConfigRef": ids[4], "batchId": ids[5], "sourceReadActionExecutionId": ids[6]}})
		args, _ := json.Marshal(map[string]any{"actionKey": "file_storage.list@v1", "idempotencyKey": ids[7],
			"arguments": map[string]any{"targetType": "RESOURCE", "targetId": ids[3], "input": map[string]string{"resourceId": ids[3]}, "authorizationTargetNativeRef": uuid.NewString()}})
		granted++
		require.NoError(t, json.NewEncoder(w).Encode(map[string]any{"operationId": ids[7], "actionExecutionId": ids[6], "sourceBindingId": ids[3],
			"endpoint": server.URL + "/execute", "actionToken": "source-only-token", "expiresAt": time.Now().Add(time.Hour).Unix(), "argumentsJson": string(args),
			"receiverWrite": map[string]any{"actionExecutionId": ids[0], "actionToken": "receiver-only-token", "expiresAt": time.Now().Add(time.Hour).Unix(), "argumentsJson": string(receiverArgs)}}))
	}))
	defer server.Close()
	cfg := &config.FileStorageSyncConfig{BindingID: ids[0], ReceiverResourceID: ids[1], NativeKnowledgeBaseID: ids[2], NativeTenantID: 1,
		CorePepURL: server.URL + "/service/v1/adapter/pep_check", OIDCTokenURL: server.URL + "/oidc", OIDCClientID: "receiver-service", OIDCClientSecretFile: secret,
		TimeoutMS: 1000, MaxBodyBytes: 10240, ListActionVersion: 1, ReadActionVersion: 1, ApplyActionKey: "knowledge.sync_apply@v2", ApplyActionVersion: 1,
		RetireActionKey: "knowledge.sync_retire@v2", RetireActionVersion: 1}
	transport, err := newFileStorageTransport(cfg)
	require.NoError(t, err)
	run := fileStorageRun{dataSourceID: ids[4], syncLogID: ids[5]}
	grant, err := transport.grant(context.Background(), run, ids[3], "file_storage.list@v1", 1, ids[7], cfg.ApplyActionKey, 1, map[string]string{"resourceId": ids[3]})
	require.NoError(t, err)
	require.Equal(t, ids[7], grant.key)
	wrongTarget = true
	_, err = transport.grant(context.Background(), run, ids[3], "file_storage.list@v1", 1, ids[7], cfg.ApplyActionKey, 1, map[string]string{"resourceId": ids[3]})
	require.ErrorContains(t, err, "receiver grant does not match")
	require.Equal(t, 2, granted)
}

func TestFileStorageCompletedReceiptCannotAuthorizeAnotherWrite(t *testing.T) {
	id := uuid.NewString()
	transport := &fileStorageTransport{config: &config.FileStorageSyncConfig{BindingID: id}}
	receipt := map[string]any{"bindingId": id, "idempotencyKey": id, "operationId": id, "role": "RECEIVER",
		"nativeObjectRef": id, "nativeRevision": "revision", "contentSha256": fileStorageDigest([]byte("body")), "contentBytes": 4}
	grant := &fileStorageGrant{key: id, value: fileStorageTestWire(t, map[string]any{"operationId": id, "outcome": "COMPLETED", "receiverReceipt": receipt})}
	err := transport.receipt(context.Background(), grant, id, "revision", fileStorageDigest([]byte("body")), 4, time.Now())
	require.NoError(t, err)
	// No HTTP client is installed: a completed observation cannot mint a
	// new token, silently send a receipt or invoke a native write on retry.
	require.Error(t, transport.pep(context.Background(), grant))
	require.Error(t, transport.receipt(context.Background(), grant, uuid.NewString(), "revision", fileStorageDigest([]byte("body")), 4, time.Now()))
	for _, outcome := range []string{"COMPLETED", "PENDING", "UNKNOWN"} {
		grant.value["outcome"] = json.RawMessage(fmt.Sprintf("%q", outcome))
		_, _, err := transport.source(context.Background(), grant)
		require.Error(t, err)
		require.Error(t, transport.pep(context.Background(), grant))
	}
}

func TestFileStorageMetadataKeepsHashGroupAndReadinessFence(t *testing.T) {
	dataSource := &types.DataSource{ID: uuid.NewString(), TenantID: 1, KnowledgeBaseID: uuid.NewString(), Type: fileStorageConnectorType}
	metadata := map[string]string{"datasource_id": dataSource.ID, "external_id": "native-md5:txt", "source_content_sha256": fileStorageDigest([]byte("body")),
		"source_references": "old"}
	raw, err := json.Marshal(metadata)
	require.NoError(t, err)
	native := &types.Knowledge{ID: uuid.NewString(), TenantID: 1, KnowledgeBaseID: dataSource.KnowledgeBaseID,
		FileHash: "native-md5", FileType: "txt", ParseStatus: types.ParseStatusCompleted, UpdatedAt: time.Now(), Metadata: types.JSON(raw)}
	repo := &replacementKnowledgeRepo{}
	service := &DataSourceService{knowledgeService: &replacementKnowledgeService{sweepFakeKS: sweepFakeKS{repo: repo}}}
	item := &types.FetchedItem{ExternalID: "native-md5:txt", Metadata: map[string]string{"source_content_sha256": metadata["source_content_sha256"],
		"source_references": "new", "import_config_ref": dataSource.ID}}
	require.NoError(t, service.finishFileStorageIngest(context.Background(), dataSource, item, native))
	require.Equal(t, 1, repo.writes)
	for _, change := range []func(*types.Knowledge){
		func(k *types.Knowledge) { k.ParseStatus = types.ParseStatusPending },
		func(k *types.Knowledge) { k.FileHash = "another-hash" },
		func(k *types.Knowledge) { k.TenantID++ },
		func(k *types.Knowledge) { k.KnowledgeBaseID = uuid.NewString() },
	} {
		copy := *native
		change(&copy)
		require.Error(t, service.finishFileStorageIngest(context.Background(), dataSource, item, &copy))
	}
	require.Equal(t, 1, repo.writes)
}

func TestFileStorageCursorDoesNotInventMissingTargetEvidence(t *testing.T) {
	for _, malformed := range []map[string]interface{}{
		{"groups": nil, "retiring": map[string]any{}},
		{"groups": map[string]any{"hash:txt": map[string]any{"knowledgeId": uuid.NewString(), "revision": "r"}}, "retiring": map[string]any{}},
	} {
		_, err := fileStorageState(&types.SyncCursor{ConnectorCursor: malformed})
		require.Error(t, err, fmt.Sprint(malformed))
	}
	state, err := fileStorageState(nil)
	require.NoError(t, err)
	require.Empty(t, state.Groups)
	require.Empty(t, state.Retiring)
}

func TestFileStorageExpiredRetirementOnlyObservesOriginalTask(t *testing.T) {
	for _, nativeState := range []string{"SUCCEEDED", "RUNNING", "UNKNOWN"} {
		t.Run(nativeState, func(t *testing.T) {
			binding, source, operation := uuid.NewString(), uuid.NewString(), uuid.NewString()
			run := fileStorageRun{dataSourceID: uuid.NewString(), syncLogID: uuid.NewString(), knowledgeBaseID: uuid.NewString()}
			old := fileStorageGroup{KnowledgeID: uuid.NewString(), Revision: "original-revision"}
			intent := fileStorageRetirement{Group: old, SourceResourceID: source, BatchID: run.syncLogID,
				Key: uuid.NewString(), Digest: fileStorageDigest([]byte("[]")), Bytes: 2}
			var saved map[string]any
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch r.URL.Path {
				case "/oidc":
					_, _ = w.Write([]byte(`{"access_token":"test-service-token","token_type":"Bearer","expires_in":3600}`))
				case "/service/v1/adapter/request_read_grant":
					outcome := "UNKNOWN"
					if saved != nil {
						outcome = "COMPLETED"
					}
					require.NoError(t, json.NewEncoder(w).Encode(map[string]any{"operationId": operation, "actionExecutionId": operation,
						"sourceBindingId": source, "outcome": outcome, "receiverReceipt": saved}))
				case "/service/v1/adapter/read_receipt":
					require.NoError(t, json.NewDecoder(r.Body).Decode(&saved))
					require.Equal(t, old.KnowledgeID, saved["nativeObjectRef"])
					require.Equal(t, old.Revision, saved["nativeRevision"])
					require.NoError(t, json.NewEncoder(w).Encode(map[string]string{"operationId": operation, "receiptDigest": intent.Digest}))
				default:
					t.Errorf("observation attempted unauthorized endpoint %s", r.URL.Path)
					w.WriteHeader(http.StatusForbidden)
				}
			}))
			defer server.Close()
			secret := filepath.Join(t.TempDir(), "service-secret")
			require.NoError(t, os.WriteFile(secret, []byte("test-only-service-credential"), 0600))
			cfg := &config.FileStorageSyncConfig{BindingID: binding, ReceiverResourceID: uuid.NewString(), NativeKnowledgeBaseID: run.knowledgeBaseID, NativeTenantID: 1,
				CorePepURL: server.URL + "/service/v1/adapter/pep_check", OIDCTokenURL: server.URL + "/oidc", OIDCClientID: "receiver-service", OIDCClientSecretFile: secret,
				TimeoutMS: 1000, MaxBodyBytes: 10240, ListActionVersion: 1, ReadActionVersion: 1, ApplyActionKey: "knowledge.sync_apply@v2", ApplyActionVersion: 1,
				RetireActionKey: "knowledge.sync_retire@v2", RetireActionVersion: 1}
			transport, err := newFileStorageTransport(cfg)
			require.NoError(t, err)
			native := &replacementKnowledgeService{state: nativeState}
			connector := &fileStorageConnector{transport: transport, knowledge: native}
			state := fileStorageCursor{Retiring: map[string]fileStorageRetirement{"group": intent}}
			err = connector.retire(context.Background(), run, "group", old, nil, &state, nil, time.Time{})
			if nativeState == "SUCCEEDED" {
				require.NoError(t, err)
				require.NotNil(t, saved)
			} else {
				require.Error(t, err)
				require.Nil(t, saved)
			}
			require.Equal(t, 1, native.observations)
			require.Zero(t, native.starts)
		})
	}
}
