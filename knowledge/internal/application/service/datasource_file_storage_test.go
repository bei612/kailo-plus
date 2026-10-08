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
	"github.com/Tencent/WeKnora/internal/types/interfaces"
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

func TestFileStorageFetchResumesRetirementBeforeNewSourceAdmission(t *testing.T) {
	for _, outcome := range []string{"SUCCEEDED", "RUNNING", "UNKNOWN", "checkpoint-failed", "receipt-failed", "orphan-intent", "empty-config"} {
		t.Run(outcome, func(t *testing.T) {
			source, operation := uuid.NewString(), uuid.NewString()
			run := fileStorageRun{dataSourceID: uuid.NewString(), syncLogID: uuid.NewString(), knowledgeBaseID: uuid.NewString(), tenantID: 1}
			old := fileStorageGroup{KnowledgeID: uuid.NewString(), Revision: "original-revision",
				References: []map[string]json.RawMessage{fileStorageTestWire(t, map[string]string{"resourceId": source})}}
			intent := fileStorageRetirement{Group: old, SourceResourceID: source, BatchID: uuid.NewString(),
				Key: uuid.NewString(), Digest: fileStorageDigest([]byte("[]")), Bytes: 2}
			var saved map[string]any
			var discoveries int
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch r.URL.Path {
				case "/oidc":
					_, _ = w.Write([]byte(`{"access_token":"test-service-token","token_type":"Bearer","expires_in":3600}`))
				case "/service/v1/adapter/request_read_grant":
					var body map[string]any
					require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
					if body["idempotencyKey"] != intent.Key {
						discoveries++
						w.WriteHeader(http.StatusForbidden)
						return
					}
					require.Equal(t, source, body["sourceResourceId"])
					require.Equal(t, intent.BatchID, body["nativeBatch"].(map[string]any)["batchId"])
					status := "UNKNOWN"
					if saved != nil {
						status = "COMPLETED"
					}
					require.NoError(t, json.NewEncoder(w).Encode(map[string]any{"operationId": operation, "actionExecutionId": operation,
						"sourceBindingId": source, "outcome": status, "receiverReceipt": saved}))
				case "/service/v1/adapter/read_receipt":
					if outcome == "receipt-failed" {
						w.WriteHeader(http.StatusServiceUnavailable)
						return
					}
					require.NoError(t, json.NewDecoder(r.Body).Decode(&saved))
					require.Equal(t, intent.Key, saved["idempotencyKey"])
					require.Equal(t, old.KnowledgeID, saved["nativeObjectRef"])
					require.NoError(t, json.NewEncoder(w).Encode(map[string]string{"operationId": operation, "receiptDigest": intent.Digest}))
				default:
					t.Errorf("retirement recovery attempted a new side effect: %s", r.URL.Path)
					w.WriteHeader(http.StatusForbidden)
				}
			}))
			defer server.Close()
			secret := filepath.Join(t.TempDir(), "service-secret")
			require.NoError(t, os.WriteFile(secret, []byte("test-only-service-credential"), 0600))
			cfg := &config.FileStorageSyncConfig{BindingID: uuid.NewString(), ReceiverResourceID: uuid.NewString(), NativeKnowledgeBaseID: run.knowledgeBaseID, NativeTenantID: run.tenantID,
				CorePepURL: server.URL + "/service/v1/adapter/pep_check", OIDCTokenURL: server.URL + "/oidc", OIDCClientID: "receiver-service", OIDCClientSecretFile: secret,
				TimeoutMS: 1000, MaxBodyBytes: 10240, ListActionVersion: 1, ReadActionVersion: 1, ApplyActionKey: "knowledge.sync_apply@v2", ApplyActionVersion: 1,
				RetireActionKey: "knowledge.sync_retire@v2", RetireActionVersion: 1}
			transport, err := newFileStorageTransport(cfg)
			require.NoError(t, err)
			native := &replacementKnowledgeService{state: outcome}
			if outcome == "checkpoint-failed" || outcome == "receipt-failed" || outcome == "empty-config" {
				native.state = "SUCCEEDED"
			}
			connector := &fileStorageConnector{transport: transport, knowledge: native}
			state := fileStorageCursor{Groups: map[string]fileStorageGroup{"group": old}, Retiring: map[string]fileStorageRetirement{"group": intent}}
			if outcome == "orphan-intent" {
				delete(state.Groups, "group")
			}
			at := time.Now().Add(-time.Hour).UTC()
			cursor := &types.SyncCursor{LastSyncTime: at, ConnectorCursor: map[string]any{"groups": state.Groups, "retiring": state.Retiring}}
			initial, err := cursor.ToJSON()
			require.NoError(t, err)
			ds := &types.DataSource{ID: run.dataSourceID, LastSyncCursor: initial}
			repo := &recordingDSRepo{}
			if outcome == "checkpoint-failed" {
				repo.updateErr = fmt.Errorf("checkpoint unavailable")
			}
			h := newStreamHandler(&DataSourceService{dsRepo: repo,
				syncLogRepo: &processSyncSyncLogRepo{logs: map[string]*types.SyncLog{}}}, ds, &types.SyncResult{}, &types.SyncLog{})
			ctx := context.WithValue(context.Background(), fileStorageRunKey{}, run)
			// The old source was removed from this configuration; deletion sync is
			// now disabled. Neither change cancels a deletion already dispatched.
			input := &types.DataSourceConfig{ResourceIDs: []string{uuid.NewString()}}
			if outcome == "empty-config" {
				input.ResourceIDs = nil
			}
			next, err := connector.FetchStream(ctx, input, cursor, h)
			require.Error(t, err)
			require.Nil(t, next)
			require.Zero(t, native.starts)
			if outcome == "SUCCEEDED" || outcome == "empty-config" {
				require.Equal(t, 1, native.observations)
				require.NotNil(t, saved)
				require.Len(t, repo.updated, 1)
				retained, err := ds.ParseSyncCursor()
				require.NoError(t, err)
				resumed, err := fileStorageState(retained)
				require.NoError(t, err)
				require.Empty(t, resumed.Groups)
				require.Empty(t, resumed.Retiring)
				require.True(t, retained.LastSyncTime.Equal(at))
				_, err = connector.FetchStream(ctx, input, retained, h)
				require.Error(t, err)
				require.Equal(t, 1, native.observations, "the confirmed task must not be re-observed or restarted")
				if outcome == "empty-config" {
					require.Zero(t, discoveries, "invalid new source configuration cannot authorize new work")
				} else {
					require.Equal(t, 2, discoveries)
				}
			} else {
				require.Empty(t, repo.updated)
				require.Equal(t, initial, ds.LastSyncCursor)
				require.Zero(t, discoveries)
				if outcome == "orphan-intent" {
					require.Zero(t, native.observations)
				} else {
					require.Equal(t, 1, native.observations)
				}
			}
		})
	}
}

type fileStorageApplicationRepo struct {
	createKnowledgeFileRepoStub
}

func (r *fileStorageApplicationRepo) FindByDataSourceExternalID(_ context.Context, tenant uint64, kb, ds, external string) (*types.Knowledge, error) {
	native := r.createdKnowledge
	if native == nil || native.TenantID != tenant || native.KnowledgeBaseID != kb ||
		native.GetMetadata()["datasource_id"] != ds || native.GetMetadata()["external_id"] != external {
		return nil, nil
	}
	copy := *native
	return &copy, nil
}

type fileStorageApplicationService struct {
	interfaces.KnowledgeService
	repo    *fileStorageApplicationRepo
	creator *knowledgeService
	lostACK bool
}

func (s *fileStorageApplicationService) GetRepository() interfaces.KnowledgeRepository { return s.repo }
func (s *fileStorageApplicationService) GetKnowledgeByID(ctx context.Context, id string) (*types.Knowledge, error) {
	return s.repo.GetKnowledgeByID(ctx, 1, id)
}
func (s *fileStorageApplicationService) CreateKnowledgeFromFileAtID(ctx context.Context, kb, filename string, content []byte,
	metadata map[string]string, id string, tags []string, channel string) (*types.Knowledge, error) {
	native, err := s.creator.CreateKnowledgeFromFileAtID(ctx, kb, filename, content, metadata, id, tags, channel)
	if err == nil && s.lostACK {
		return nil, fmt.Errorf("native creation acknowledgement lost")
	}
	return native, err
}

func TestFileStoragePendingApplicationResumesOriginalNativeCreation(t *testing.T) {
	for _, stage := range []string{"parse-pending", "empty-file", "empty-file-parse-failed", "creation-ack-lost", "checkpoint-failed", "receipt-ack-lost", "receipt-refused", "usage-pending", "parse-failed", "provenance-drift", "creation-missing"} {
		t.Run(stage, func(t *testing.T) {
			source, node, root := uuid.NewString(), uuid.NewString(), uuid.NewString()
			receiverResource := uuid.NewString()
			run := fileStorageRun{dataSourceID: uuid.NewString(), syncLogID: uuid.NewString(), knowledgeBaseID: uuid.NewString(), tenantID: 1}
			body := []byte("original native source body")
			if stage == "empty-file" || stage == "empty-file-parse-failed" {
				body = []byte{}
			}
			ref := map[string]string{"resourceId": source, "nativeObjectRef": node, "nativeRevision": "source-revision", "displayName": "doc.txt", "mediaType": "text/plain"}
			items, err := json.Marshal([]map[string]string{ref})
			require.NoError(t, err)
			listKey := fileStorageKey(run.syncLogID, source, "discover")
			readKey := fileStorageKey(run.syncLogID, source, node, ref["nativeRevision"])
			receipts := map[string]map[string]any{}
			var sourceCalls, pepCalls, readReceipts int
			observing, rejectReceipt := false, false
			var server *httptest.Server
			server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if r.URL.Path == "/oidc" {
					_, _ = w.Write([]byte(`{"access_token":"receiver-service-token","token_type":"Bearer","expires_in":3600}`))
					return
				}
				var request map[string]any
				require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
				if r.URL.Path != "/execute" {
					require.Equal(t, "Bearer receiver-service-token", r.Header.Get("Authorization"))
				}
				switch r.URL.Path {
				case "/service/v1/adapter/request_read_grant":
					key := request["idempotencyKey"].(string)
					require.Equal(t, source, request["sourceResourceId"])
					require.Equal(t, run.syncLogID, request["nativeBatch"].(map[string]any)["batchId"])
					response := map[string]any{"operationId": key, "actionExecutionId": key, "sourceBindingId": source}
					if saved := receipts[key]; saved != nil && !(stage == "usage-pending" && key == readKey) {
						response["outcome"], response["receiverReceipt"] = "COMPLETED", saved
					} else if observing {
						response["outcome"] = "PENDING"
					} else {
						var input any
						require.NoError(t, json.Unmarshal([]byte(request["inputJson"].(string)), &input))
						arguments, _ := json.Marshal(map[string]any{"actionKey": request["actionKey"], "idempotencyKey": key,
							"arguments": map[string]any{"targetType": "RESOURCE", "targetId": source, "authorizationTargetNativeRef": root, "input": input}})
						receiverArgs, _ := json.Marshal(map[string]any{"targetType": "RESOURCE", "targetId": receiverResource,
							"authorizationTargetNativeRef": run.knowledgeBaseID, "input": map[string]string{"sourceResourceId": source,
								"importConfigRef": run.dataSourceID, "batchId": run.syncLogID, "sourceReadActionExecutionId": key}})
						response["endpoint"], response["argumentsJson"], response["actionToken"], response["expiresAt"] = server.URL+"/execute", string(arguments), "source-only-token", time.Now().Add(time.Hour).Unix()
						response["receiverWrite"] = map[string]any{"actionExecutionId": fileStorageKey(key, "receiver"), "argumentsJson": string(receiverArgs),
							"actionToken": "receiver-only-token", "expiresAt": time.Now().Add(time.Hour).Unix()}
					}
					require.NoError(t, json.NewEncoder(w).Encode(response))
				case "/service/v1/adapter/pep_check":
					pepCalls++
					require.False(t, observing, "old invocation recovery must never authorize another write")
					var arguments map[string]any
					require.NoError(t, json.Unmarshal([]byte(request["argumentsJson"].(string)), &arguments))
					key := arguments["input"].(map[string]any)["sourceReadActionExecutionId"].(string)
					require.NoError(t, json.NewEncoder(w).Encode(map[string]string{"operationId": key, "actionExecutionId": fileStorageKey(key, "receiver"), "authorizationMinZedToken": "confirmed"}))
				case "/execute":
					sourceCalls++
					require.False(t, observing, "old invocation recovery must never repeat a source call")
					require.Equal(t, "Bearer source-only-token", r.Header.Get("Authorization"))
					key := request["idempotencyKey"].(string)
					if key == listKey {
						require.NoError(t, json.NewEncoder(w).Encode(map[string]any{"resourceId": source, "nativeObjectRef": root, "operationId": key,
							"listingDigest": fileStorageDigest(items), "nativeRevision": fileStorageDigest(items), "items": json.RawMessage(items)}))
					} else {
						require.Equal(t, readKey, key)
						w.Header().Set("Content-Type", "application/octet-stream")
						w.Header().Set("Content-Length", fmt.Sprint(len(body)))
						w.Header().Set("X-Kailo-Content-Sha256", fileStorageDigest(body))
						w.Header().Set("X-Kailo-Native-Object-Ref", node)
						w.Header().Set("X-Kailo-Native-Revision", ref["nativeRevision"])
						w.Header().Set("X-Kailo-Operation-Id", key)
						_, _ = w.Write(body)
					}
				case "/service/v1/adapter/read_receipt":
					key := request["idempotencyKey"].(string)
					if key == readKey {
						readReceipts++
					}
					if prior := receipts[key]; prior != nil {
						require.Equal(t, prior, request, "lost acknowledgement must retain the same native completion clock")
					}
					if rejectReceipt {
						w.WriteHeader(http.StatusServiceUnavailable)
						return
					}
					receipts[key] = request
					if stage == "receipt-ack-lost" && key == readKey && readReceipts == 1 {
						w.WriteHeader(http.StatusServiceUnavailable)
						return
					}
					require.NoError(t, json.NewEncoder(w).Encode(map[string]string{"operationId": key, "receiptDigest": fileStorageDigest([]byte("receipt"))}))
				default:
					t.Errorf("unexpected native receiver endpoint %s", r.URL.Path)
					w.WriteHeader(http.StatusForbidden)
				}
			}))
			defer server.Close()
			secret := filepath.Join(t.TempDir(), "service-secret")
			require.NoError(t, os.WriteFile(secret, []byte("test-only-service-credential"), 0600))
			cfg := &config.FileStorageSyncConfig{BindingID: uuid.NewString(), ReceiverResourceID: receiverResource, NativeKnowledgeBaseID: run.knowledgeBaseID, NativeTenantID: run.tenantID,
				CorePepURL: server.URL + "/service/v1/adapter/pep_check", OIDCTokenURL: server.URL + "/oidc", OIDCClientID: "receiver-service", OIDCClientSecretFile: secret,
				TimeoutMS: 1000, MaxBodyBytes: 10240, ListActionVersion: 1, ReadActionVersion: 1, ApplyActionKey: "knowledge.sync_apply@v2", ApplyActionVersion: 1,
				RetireActionKey: "knowledge.sync_retire@v2", RetireActionVersion: 1}
			transport, err := newFileStorageTransport(cfg)
			require.NoError(t, err)
			repo, storage, queue := &fileStorageApplicationRepo{}, &createKnowledgeFileServiceStub{}, &createKnowledgeTaskEnqueuerStub{}
			native := &fileStorageApplicationService{repo: repo, creator: &knowledgeService{repo: repo, fileSvc: storage, task: queue,
				kbService: &createKnowledgeFileKBServiceStub{kb: &types.KnowledgeBase{ID: run.knowledgeBaseID}}}, lostACK: stage == "creation-ack-lost"}
			connector := &fileStorageConnector{transport: transport, knowledge: native}
			baseline := fileStorageGroup{KnowledgeID: uuid.NewString(), Revision: "old-revision", References: []map[string]json.RawMessage{fileStorageTestWire(t, ref)}}
			at := time.Now().Add(-time.Hour).UTC()
			previous := &types.SyncCursor{LastSyncTime: at, ConnectorCursor: map[string]any{"groups": map[string]fileStorageGroup{"old:txt": baseline}, "retiring": map[string]fileStorageRetirement{}}}
			initial, err := previous.ToJSON()
			require.NoError(t, err)
			ds := &types.DataSource{ID: run.dataSourceID, TenantID: run.tenantID, KnowledgeBaseID: run.knowledgeBaseID, Type: fileStorageConnectorType, LastSyncCursor: initial}
			dsRepo := &recordingDSRepo{}
			if stage == "checkpoint-failed" {
				dsRepo.updateErr = fmt.Errorf("native cursor persistence unavailable")
			}
			svc := &DataSourceService{knowledgeService: native, dsRepo: dsRepo, syncLogRepo: &processSyncSyncLogRepo{logs: map[string]*types.SyncLog{}}}
			storage.beforeSave = func() {
				// Prove the real native save cannot get ahead of its original
				// receiver-owned recovery reference, even if the next ACK is lost.
				persisted, err := ds.ParseSyncCursor()
				require.NoError(t, err)
				pending, err := fileStorageState(persisted)
				require.NoError(t, err)
				require.Len(t, pending.Applying, 1)
				for _, intent := range pending.Applying {
					require.Equal(t, repo.createdKnowledge.ID, intent.KnowledgeID)
					require.Equal(t, run.syncLogID, intent.BatchID)
				}
			}
			ctx := context.WithValue(newCreateKnowledgeFileContext(), fileStorageRunKey{}, run)
			input := &types.DataSourceConfig{ResourceIDs: []string{source}}
			_, err = connector.FetchStream(ctx, input, previous, newStreamHandler(svc, ds, &types.SyncResult{}, &types.SyncLog{}))
			require.Error(t, err, "native pending parsing is not a successful import")
			if stage == "checkpoint-failed" {
				require.Zero(t, repo.createCalls)
				require.Zero(t, storage.saveCalls)
				require.Zero(t, queue.calls)
				require.Equal(t, initial, ds.LastSyncCursor)
				return
			}
			require.Equal(t, 1, repo.createCalls)
			require.Equal(t, 1, storage.saveCalls)
			require.Equal(t, 1, queue.calls)
			require.EqualValues(t, len(body), repo.createdKnowledge.FileSize)
			require.Equal(t, fileStorageDigest(body), repo.createdKnowledge.GetMetadata()["source_content_sha256"])
			require.Equal(t, fmt.Sprint(len(body)), repo.createdKnowledge.GetMetadata()["source_content_bytes"])
			require.Zero(t, readReceipts)
			retained, err := ds.ParseSyncCursor()
			require.NoError(t, err)
			state, err := fileStorageState(retained)
			require.NoError(t, err)
			require.Equal(t, baseline, state.Groups["old:txt"])
			require.Len(t, state.Applying, 1)
			require.Equal(t, at, retained.LastSyncTime)
			require.Equal(t, repo.createdKnowledge.ID, storage.savedWithKnowledgeID)
			for key, intent := range state.Applying {
				require.Equal(t, repo.createdKnowledge.ID, intent.KnowledgeID)
				require.Equal(t, fileStorageKey(run.syncLogID, run.dataSourceID, key, "create"), intent.KnowledgeID)
			}
			repo.createdKnowledge.ParseStatus = types.ParseStatusCompleted
			repo.createdKnowledge.UpdatedAt = time.Now().Add(-time.Second).UTC()
			switch stage {
			case "parse-failed", "empty-file-parse-failed":
				repo.createdKnowledge.ParseStatus = types.ParseStatusFailed
			case "provenance-drift":
				repo.createdKnowledge.FileSize++
			case "creation-missing":
				repo.createdKnowledge = nil
			}
			observing = true
			rejectReceipt = stage == "receipt-refused"
			calls, peps := sourceCalls, pepCalls
			before := ds.LastSyncCursor
			next, err := connector.FetchStream(ctx, input, retained, newStreamHandler(svc, ds, &types.SyncResult{}, &types.SyncLog{}))
			if stage == "receipt-ack-lost" || stage == "receipt-refused" || stage == "usage-pending" || stage == "parse-failed" || stage == "empty-file-parse-failed" || stage == "provenance-drift" || stage == "creation-missing" {
				require.Error(t, err)
				require.Nil(t, next)
				require.Equal(t, before, ds.LastSyncCursor)
				if stage == "receipt-ack-lost" {
					next, err = connector.FetchStream(ctx, input, retained, newStreamHandler(svc, ds, &types.SyncResult{}, &types.SyncLog{}))
					require.NoError(t, err)
				}
			} else {
				require.NoError(t, err)
			}
			if next != nil {
				final, err := fileStorageState(next)
				require.NoError(t, err)
				require.Len(t, final.Groups, 2)
				require.Empty(t, final.Applying)
				require.True(t, next.LastSyncTime.After(at))
				require.NotNil(t, receipts[readKey])
				require.Equal(t, repo.createdKnowledge.UpdatedAt.Format(time.RFC3339Nano), receipts[readKey]["completedAt"])
			}
			require.Equal(t, calls, sourceCalls)
			require.Equal(t, peps, pepCalls)
			require.Equal(t, 1, repo.createCalls, "recovery must observe the original creation, never create another file")
			require.Equal(t, 1, storage.saveCalls)
			require.Equal(t, 1, queue.calls)
		})
	}
}
