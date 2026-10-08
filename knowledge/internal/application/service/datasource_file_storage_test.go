package service

import (
	"context"
	"crypto/md5"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Tencent/WeKnora/internal/config"
	"github.com/Tencent/WeKnora/internal/datasource"
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

func TestFileStorageDirectoryUsesCurrentReceiverIdentityAndBoundedPages(t *testing.T) {
	for _, scenario := range []string{"current", "tenant-receiver", "empty-page", "empty-directory", "wrong-binding", "wrong-direction", "invalid-tenant",
		"invalid-principal", "invalid-generation", "null-workspace", "invalid-resource", "invalid-resource-binding", "invalid-version",
		"empty-native-ref", "empty-type", "wrong-resource-workspace", "null-resources", "duplicate-resource", "changed-generation",
		"changed-tenant", "changed-principal", "changed-workspace", "backwards-offset", "null-offset", "oversized", "refused", "non-json"} {
		t.Run(scenario, func(t *testing.T) {
			binding, receiver, kb, tenant, principal, workspace := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
			sources := []string{uuid.NewString(), uuid.NewString()}
			secret := filepath.Join(t.TempDir(), "receiver-secret")
			require.NoError(t, os.WriteFile(secret, []byte("test-only-directory-secret"), 0600))
			requests := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if r.URL.Path == "/oidc" {
					user, password, ok := r.BasicAuth()
					require.True(t, ok)
					require.Equal(t, "receiver-directory-client", user)
					require.Equal(t, "test-only-directory-secret", password)
					_, _ = w.Write([]byte(`{"access_token":"directory-service-token","token_type":"Bearer","expires_in":3600}`))
					return
				}
				requests++
				require.Equal(t, http.MethodGet, r.Method)
				require.Equal(t, "/service/v1/adapter/bindings/"+binding+"/read-resources", r.URL.Path)
				require.Equal(t, "SOURCE", r.URL.Query().Get("direction"))
				require.Equal(t, "FILE_STORAGE", r.URL.Query().Get("categoryKey"))
				require.Equal(t, "Bearer directory-service-token", r.Header.Get("Authorization"))
				require.Empty(t, r.Header.Get("Cookie"))
				require.Zero(t, r.ContentLength)
				first := r.URL.Query().Get("offset") == "0"
				if !first {
					require.Equal(t, "2", r.URL.Query().Get("offset"))
				}
				resource := map[string]any{"resourceId": sources[0], "version": 1, "bindingId": uuid.NewString(), "nativeRef": "approved-node", "typeKey": "test-source"}
				if !first {
					resource["resourceId"] = sources[1]
				}
				page := map[string]any{"bindingId": binding, "bindingVersion": 1, "servicePrincipalId": principal, "tenantId": tenant,
					"workspaceId": workspace, "direction": "SOURCE", "resources": []any{resource}}
				if first {
					page["nextOffset"] = 2
				}
				switch scenario {
				case "tenant-receiver":
					delete(page, "workspaceId")
					resource["workspaceId"] = workspace
				case "empty-page":
					if first {
						page["resources"] = []any{}
					}
				case "empty-directory":
					page["resources"] = []any{}
					delete(page, "nextOffset")
				case "wrong-binding":
					page["bindingId"] = uuid.NewString()
				case "wrong-direction":
					page["direction"] = "RECEIVER"
				case "invalid-tenant":
					page["tenantId"] = ""
				case "invalid-principal":
					page["servicePrincipalId"] = ""
				case "invalid-generation":
					page["bindingVersion"] = 0
				case "null-workspace":
					page["workspaceId"] = nil
				case "invalid-resource":
					resource["resourceId"] = "untrusted"
				case "invalid-resource-binding":
					resource["bindingId"] = ""
				case "invalid-version":
					resource["version"] = 0
				case "empty-native-ref":
					resource["nativeRef"] = " "
				case "empty-type":
					resource["typeKey"] = ""
				case "wrong-resource-workspace":
					resource["workspaceId"] = uuid.NewString()
				case "null-resources":
					page["resources"] = nil
				case "duplicate-resource":
					resource["resourceId"] = sources[0]
				case "changed-generation":
					if !first {
						page["bindingVersion"] = 2
					}
				case "changed-tenant":
					if !first {
						page["tenantId"] = uuid.NewString()
					}
				case "changed-principal":
					if !first {
						page["servicePrincipalId"] = uuid.NewString()
					}
				case "changed-workspace":
					if !first {
						page["workspaceId"] = uuid.NewString()
					}
				case "backwards-offset":
					if !first {
						page["nextOffset"] = 2
					}
				case "null-offset":
					page["nextOffset"] = nil
				case "refused":
					w.WriteHeader(http.StatusForbidden)
					return
				case "non-json":
					w.Header().Set("Content-Type", "text/plain")
				}
				require.NoError(t, json.NewEncoder(w).Encode(page))
			}))
			defer server.Close()
			cfg := &config.FileStorageSyncConfig{BindingID: binding, ReceiverResourceID: receiver, NativeKnowledgeBaseID: kb, NativeTenantID: 1,
				CorePepURL: server.URL + "/service/v1/adapter/pep_check", OIDCTokenURL: server.URL + "/oidc", OIDCClientID: "receiver-directory-client", OIDCClientSecretFile: secret,
				TimeoutMS: 1000, MaxBodyBytes: 10240, ListActionVersion: 1, ReadActionVersion: 1, ApplyActionKey: "knowledge.sync_apply@v2", ApplyActionVersion: 1,
				RetireActionKey: "knowledge.sync_retire@v2", RetireActionVersion: 1}
			if scenario == "oversized" {
				cfg.MaxBodyBytes = 1
			}
			transport, err := newFileStorageTransport(cfg)
			require.NoError(t, err)
			connector := &fileStorageConnector{transport: transport}
			registry := datasource.NewConnectorRegistry()
			require.NoError(t, registry.Register(connector))
			service := &DataSourceService{connectorRegistry: registry}
			ctx := context.WithValue(context.Background(), types.TenantIDContextKey, uint64(1))
			items, err := service.ListFileStorageSources(ctx, kb)
			if scenario != "current" && scenario != "tenant-receiver" && scenario != "empty-page" && scenario != "empty-directory" {
				require.Error(t, err)
				require.Nil(t, items, "a partial or untrusted directory must not reach the native picker")
				return
			}
			require.NoError(t, err)
			if scenario == "empty-directory" {
				require.Empty(t, items)
				return
			}
			if scenario == "empty-page" {
				require.Len(t, items, 1)
				require.Equal(t, sources[1], items[0].ExternalID)
				return
			}
			require.Len(t, items, 2)
			require.Equal(t, sources[0], items[0].ExternalID)
			require.Equal(t, "approved-node", items[0].Name)
			// The saved selection is not a directory authority. The original tree
			// refresh must expose both currently granted references, not echo it.
			items, err = connector.ListResources(ctx, &types.DataSourceConfig{ResourceIDs: sources[:1]}, "")
			require.NoError(t, err)
			require.Len(t, items, 2)
			before := requests
			items, err = service.ListFileStorageSources(ctx, uuid.NewString())
			require.NoError(t, err)
			require.Empty(t, items)
			_, err = service.ListFileStorageSources(context.Background(), kb)
			require.Error(t, err)
			require.Equal(t, before, requests, "another native KB or missing tenant must not use the receiver service identity")
		})
	}
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
	for _, observation := range []struct {
		revision string
		at       time.Time
	}{
		{revision: "retained-revision"},
		{at: time.Now().Add(-time.Second)},
		{revision: "retained-revision", at: time.Now().Add(time.Hour)},
	} {
		state.Applying["hash:txt"] = fileStorageApplication{KnowledgeID: uuid.NewString(), BatchID: uuid.NewString(),
			Digest: fileStorageDigest([]byte("body")), Bytes: 4, Revision: observation.revision, ObservedAt: observation.at,
			References: []map[string]json.RawMessage{fileStorageTestWire(t, map[string]string{"resourceId": uuid.NewString(),
				"nativeObjectRef": uuid.NewString(), "nativeRevision": "source-revision", "displayName": "doc.txt", "mediaType": "text/plain"})}}
		raw := fileStorageTestWire(t, state)
		cursor := &types.SyncCursor{ConnectorCursor: map[string]interface{}{}}
		for name, value := range raw {
			cursor.ConnectorCursor[name] = value
		}
		_, err := fileStorageState(cursor)
		require.ErrorContains(t, err, "completion observation is invalid")
	}
}

func TestFileStorageDiscoveryResumesOriginalBatchBeforeNewAdmission(t *testing.T) {
	for _, outcome := range []string{"usage-settled", "already-completed", "unknown-operation", "receipt-ack-lost", "receipt-refused", "usage-pending", "checkpoint-failed", "source-revoked", "missing-batch", "wrong-batch", "snapshot-corrupt", "future-clock", "no-observation", "legacy-current-batch", "source-config-removed"} {
		t.Run(outcome, func(t *testing.T) {
			source, receiver, root := uuid.NewString(), uuid.NewString(), uuid.NewString()
			run := fileStorageRun{dataSourceID: uuid.NewString(), syncLogID: uuid.NewString(), knowledgeBaseID: uuid.NewString(), tenantID: 1}
			batch := uuid.NewString()
			if outcome == "legacy-current-batch" {
				batch = run.syncLogID
			}
			key := fileStorageKey(batch, source, "discover")
			at := time.Now().Add(-time.Hour).UTC()
			saved := fileStorageSavedListing{Key: key, BatchID: batch, ItemsJSON: "[]", Digest: fileStorageDigest([]byte("[]")), Bytes: 2, ObservedAt: at}
			switch outcome {
			case "missing-batch", "legacy-current-batch":
				saved.BatchID = ""
			case "wrong-batch":
				saved.BatchID = uuid.NewString()
			case "snapshot-corrupt":
				saved.ItemsJSON = "[null]"
			case "future-clock":
				saved.ObservedAt = time.Now().Add(time.Hour)
			}
			state := fileStorageCursor{Groups: map[string]fileStorageGroup{}, Retiring: map[string]fileStorageRetirement{},
				Applying: map[string]fileStorageApplication{}, Discovery: map[string]fileStorageSavedListing{source: saved}}
			fields := map[string]interface{}{}
			raw, err := json.Marshal(state)
			require.NoError(t, err)
			require.NoError(t, json.Unmarshal(raw, &fields))
			previous := &types.SyncCursor{LastSyncTime: at, ConnectorCursor: fields}
			initial, err := previous.ToJSON()
			require.NoError(t, err)
			ds := &types.DataSource{ID: run.dataSourceID, LastSyncCursor: initial}
			repo := &recordingDSRepo{}
			if outcome == "checkpoint-failed" {
				repo.updateErr = fmt.Errorf("native checkpoint unavailable")
			}
			var accepted map[string]any
			if outcome == "already-completed" {
				accepted = map[string]any{"bindingId": receiver, "operationId": key, "idempotencyKey": key, "role": "RECEIVER",
					"nativeObjectRef": run.dataSourceID, "nativeRevision": saved.Digest, "contentSha256": saved.Digest, "contentBytes": float64(saved.Bytes)}
			}
			var oldGrants, newGrants, receipts int
			var server *httptest.Server
			server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if r.URL.Path == "/oidc" {
					_, _ = w.Write([]byte(`{"access_token":"receiver-service-token","token_type":"Bearer","expires_in":3600}`))
					return
				}
				require.Equal(t, "Bearer receiver-service-token", r.Header.Get("Authorization"))
				var request map[string]any
				require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
				switch r.URL.Path {
				case "/service/v1/adapter/request_read_grant":
					if request["idempotencyKey"] != key {
						newGrants++
						require.NotNil(t, accepted, "new discovery cannot abandon the original completion")
						w.WriteHeader(http.StatusForbidden)
						return
					}
					oldGrants++
					require.Equal(t, batch, request["nativeBatch"].(map[string]any)["batchId"])
					require.Equal(t, source, request["sourceResourceId"])
					if outcome == "source-revoked" {
						w.WriteHeader(http.StatusForbidden)
						return
					}
					response := map[string]any{"operationId": key, "actionExecutionId": key, "sourceBindingId": source, "outcome": "PENDING"}
					if outcome == "unknown-operation" {
						response["outcome"] = "UNKNOWN"
					}
					if outcome == "no-observation" {
						delete(response, "outcome")
						args, _ := json.Marshal(map[string]any{"actionKey": request["actionKey"], "idempotencyKey": key,
							"arguments": map[string]any{"targetType": "RESOURCE", "targetId": source, "authorizationTargetNativeRef": root, "input": map[string]string{"resourceId": source}}})
						receiverArgs, _ := json.Marshal(map[string]any{"targetType": "RESOURCE", "targetId": root, "authorizationTargetNativeRef": run.knowledgeBaseID,
							"input": map[string]string{"sourceResourceId": source, "importConfigRef": run.dataSourceID, "batchId": batch, "sourceReadActionExecutionId": key}})
						response["endpoint"], response["argumentsJson"], response["actionToken"], response["expiresAt"] = server.URL+"/execute", string(args), "source-only-token", time.Now().Add(time.Hour).Unix()
						response["receiverWrite"] = map[string]any{"actionExecutionId": receiver, "argumentsJson": string(receiverArgs), "actionToken": "receiver-only-token", "expiresAt": time.Now().Add(time.Hour).Unix()}
					}
					if accepted != nil && outcome != "usage-pending" {
						response["outcome"], response["receiverReceipt"] = "COMPLETED", accepted
					}
					require.NoError(t, json.NewEncoder(w).Encode(response))
				case "/service/v1/adapter/read_receipt":
					receipts++
					require.Equal(t, key, request["idempotencyKey"])
					require.Equal(t, at.Format(time.RFC3339Nano), request["completedAt"])
					require.Equal(t, saved.Digest, request["contentSha256"])
					if outcome == "receipt-refused" {
						w.WriteHeader(http.StatusServiceUnavailable)
						return
					}
					accepted = request
					if outcome == "receipt-ack-lost" && receipts == 1 {
						w.WriteHeader(http.StatusServiceUnavailable)
						return
					}
					require.NoError(t, json.NewEncoder(w).Encode(map[string]string{"operationId": key, "receiptDigest": saved.Digest}))
				default:
					t.Errorf("saved discovery must not re-read bytes or obtain receiver write authorization: %s", r.URL.Path)
					w.WriteHeader(http.StatusForbidden)
				}
			}))
			defer server.Close()
			secret := filepath.Join(t.TempDir(), "service-secret")
			require.NoError(t, os.WriteFile(secret, []byte("test-only-service-credential"), 0600))
			transport, err := newFileStorageTransport(&config.FileStorageSyncConfig{BindingID: receiver, ReceiverResourceID: root,
				NativeKnowledgeBaseID: run.knowledgeBaseID, NativeTenantID: run.tenantID, CorePepURL: server.URL + "/service/v1/adapter/pep_check",
				OIDCTokenURL: server.URL + "/oidc", OIDCClientID: "receiver-service", OIDCClientSecretFile: secret,
				TimeoutMS: 1000, MaxBodyBytes: 10240, ListActionVersion: 1, ReadActionVersion: 1,
				ApplyActionKey: "knowledge.sync_apply@v2", ApplyActionVersion: 1, RetireActionKey: "knowledge.sync_retire@v2", RetireActionVersion: 1})
			require.NoError(t, err)
			connector := &fileStorageConnector{transport: transport}
			svc := &DataSourceService{dsRepo: repo, syncLogRepo: &processSyncSyncLogRepo{logs: map[string]*types.SyncLog{}}}
			ctx := context.WithValue(context.Background(), fileStorageRunKey{}, run)
			input := &types.DataSourceConfig{ResourceIDs: []string{source}}
			if outcome == "source-config-removed" {
				input.ResourceIDs = nil
			}
			_, err = connector.FetchStream(ctx, input, previous, newStreamHandler(svc, ds, &types.SyncResult{}, &types.SyncLog{}))
			if outcome == "legacy-current-batch" {
				require.NoError(t, err)
				require.NotNil(t, accepted)
				require.Zero(t, newGrants)
				return
			}
			require.Error(t, err)
			if outcome == "receipt-ack-lost" || outcome == "checkpoint-failed" {
				require.Equal(t, initial, ds.LastSyncCursor)
				repo.updateErr = nil
				_, err = connector.FetchStream(ctx, input, previous, newStreamHandler(svc, ds, &types.SyncResult{}, &types.SyncLog{}))
				require.Error(t, err)
				require.Equal(t, 1, receipts, "recover original acknowledgement without a second receipt/write")
			}
			switch outcome {
			case "usage-settled", "already-completed", "unknown-operation", "receipt-ack-lost", "checkpoint-failed", "source-config-removed":
				retained, err := ds.ParseSyncCursor()
				require.NoError(t, err)
				confirmed, err := fileStorageState(retained)
				require.NoError(t, err)
				require.Empty(t, confirmed.Discovery)
				require.Equal(t, at, retained.LastSyncTime, "settling old discovery does not complete a new import")
				if outcome == "source-config-removed" {
					require.Zero(t, newGrants)
				} else {
					require.Equal(t, 1, newGrants)
				}
			default:
				require.Equal(t, initial, ds.LastSyncCursor)
				require.Empty(t, repo.updated)
				require.Zero(t, newGrants)
			}
			if outcome == "missing-batch" || outcome == "wrong-batch" || outcome == "snapshot-corrupt" || outcome == "future-clock" {
				require.Zero(t, oldGrants, "invalid saved evidence cannot mint a replacement operation")
			}
		})
	}
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
	rows map[string]*types.Knowledge
}

func (r *fileStorageApplicationRepo) CreateKnowledge(ctx context.Context, native *types.Knowledge) error {
	err := r.createKnowledgeFileRepoStub.CreateKnowledge(ctx, native)
	if r.rows != nil && err == nil {
		r.rows[native.ID] = r.createdKnowledge
	}
	return err
}

func (r *fileStorageApplicationRepo) UpdateKnowledge(ctx context.Context, native *types.Knowledge) error {
	err := r.createKnowledgeFileRepoStub.UpdateKnowledge(ctx, native)
	if r.rows != nil && err == nil {
		r.rows[native.ID] = r.createdKnowledge
	}
	return err
}

func (r *fileStorageApplicationRepo) GetKnowledgeByID(ctx context.Context, tenant uint64, id string) (*types.Knowledge, error) {
	if r.rows != nil {
		if native := r.rows[id]; native != nil && native.TenantID == tenant {
			copy := *native
			return &copy, nil
		}
	}
	return r.createKnowledgeFileRepoStub.GetKnowledgeByID(ctx, tenant, id)
}

func (r *fileStorageApplicationRepo) FindByDataSourceExternalID(_ context.Context, tenant uint64, kb, ds, external string) (*types.Knowledge, error) {
	native := r.createdKnowledge
	if r.rows != nil {
		native = nil
		for _, candidate := range r.rows {
			if candidate.GetMetadata()["datasource_id"] == ds && candidate.GetMetadata()["external_id"] == external {
				native = candidate
				break
			}
		}
	}
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
	for _, stage := range []string{"parse-pending", "multiple-pending-files", "empty-file", "empty-file-parse-failed", "creation-ack-lost", "checkpoint-failed", "receipt-ack-lost", "receipt-refused", "usage-pending", "parse-failed", "provenance-drift", "creation-missing", "existing-ready", "existing-ready-ack-lost"} {
		t.Run(stage, func(t *testing.T) {
			source, node, root := uuid.NewString(), uuid.NewString(), uuid.NewString()
			receiverResource := uuid.NewString()
			run := fileStorageRun{dataSourceID: uuid.NewString(), syncLogID: uuid.NewString(), knowledgeBaseID: uuid.NewString(), tenantID: 1}
			body := []byte("original native source body")
			if stage == "empty-file" || stage == "empty-file-parse-failed" {
				body = []byte{}
			}
			ref := map[string]string{"resourceId": source, "nativeObjectRef": node, "nativeRevision": "source-revision", "displayName": "doc.txt", "mediaType": "text/plain"}
			references := []map[string]string{ref}
			bodies := map[string][]byte{node: body}
			if stage == "multiple-pending-files" {
				for index := 1; index < 7; index++ {
					id := uuid.NewString()
					references = append(references, map[string]string{"resourceId": source, "nativeObjectRef": id,
						"nativeRevision": "source-revision", "displayName": fmt.Sprintf("doc-%d.txt", index), "mediaType": "text/plain"})
					bodies[id] = []byte(fmt.Sprintf("independent source body %d", index))
				}
			}
			items, err := json.Marshal(references)
			require.NoError(t, err)
			listKey := fileStorageKey(run.syncLogID, source, "discover")
			readKey := fileStorageKey(run.syncLogID, source, node, ref["nativeRevision"])
			readRefs := map[string]map[string]string{}
			for _, reference := range references {
				readRefs[fileStorageKey(run.syncLogID, source, reference["nativeObjectRef"], reference["nativeRevision"])] = reference
			}
			receipts := map[string]map[string]any{}
			sourceCompletions := map[string]time.Time{}
			var ds *types.DataSource
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
					sourceCompletions[key] = time.Now().UTC()
					if key == listKey {
						require.NoError(t, json.NewEncoder(w).Encode(map[string]any{"resourceId": source, "nativeObjectRef": root, "operationId": key,
							"listingDigest": fileStorageDigest(items), "nativeRevision": fileStorageDigest(items), "items": json.RawMessage(items)}))
					} else {
						reference := readRefs[key]
						require.NotNil(t, reference)
						content := bodies[reference["nativeObjectRef"]]
						w.Header().Set("Content-Type", "application/octet-stream")
						w.Header().Set("Content-Length", fmt.Sprint(len(content)))
						w.Header().Set("X-Kailo-Content-Sha256", fileStorageDigest(content))
						w.Header().Set("X-Kailo-Native-Object-Ref", reference["nativeObjectRef"])
						w.Header().Set("X-Kailo-Native-Revision", reference["nativeRevision"])
						w.Header().Set("X-Kailo-Operation-Id", key)
						_, _ = w.Write(content)
					}
				case "/service/v1/adapter/read_receipt":
					key := request["idempotencyKey"].(string)
					if key == readKey {
						readReceipts++
						completed, err := time.Parse(time.RFC3339Nano, request["completedAt"].(string))
						require.NoError(t, err)
						require.False(t, completed.Before(sourceCompletions[key]), "receiver completion must follow this batch's actual source read")
						retained, err := ds.ParseSyncCursor()
						require.NoError(t, err)
						state, err := fileStorageState(retained)
						require.NoError(t, err)
						intent := state.Applying[fmt.Sprintf("%x:txt", md5.Sum(body))]
						require.Equal(t, intent.ObservedAt.Format(time.RFC3339Nano), request["completedAt"], "completion evidence must be durable before receipt submission")
						require.Equal(t, intent.Revision, request["nativeRevision"])
					}
					if prior := receipts[key]; prior != nil {
						require.Equal(t, prior, request, "lost acknowledgement must retain the same native completion clock")
					}
					if rejectReceipt {
						w.WriteHeader(http.StatusServiceUnavailable)
						return
					}
					receipts[key] = request
					if (stage == "receipt-ack-lost" || stage == "existing-ready-ack-lost") && key == readKey && readReceipts == 1 {
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
			if stage == "multiple-pending-files" {
				repo.rows = map[string]*types.Knowledge{}
			}
			native := &fileStorageApplicationService{repo: repo, creator: &knowledgeService{repo: repo, fileSvc: storage, task: queue,
				kbService: &createKnowledgeFileKBServiceStub{kb: &types.KnowledgeBase{ID: run.knowledgeBaseID}}}, lostACK: stage == "creation-ack-lost"}
			if stage == "existing-ready" || stage == "existing-ready-ack-lost" {
				metadata, err := json.Marshal(map[string]string{"datasource_id": run.dataSourceID, "external_id": fmt.Sprintf("%x:txt", md5.Sum(body)),
					"import_config_ref": run.dataSourceID, "source_references": string(items),
					"source_resource_id": source, "source_native_object_ref": node, "source_native_revision": ref["nativeRevision"],
					"source_content_sha256": fileStorageDigest(body), "source_content_bytes": fmt.Sprint(len(body))})
				require.NoError(t, err)
				repo.createdKnowledge = &types.Knowledge{ID: uuid.NewString(), TenantID: run.tenantID, KnowledgeBaseID: run.knowledgeBaseID,
					FileHash: fmt.Sprintf("%x", md5.Sum(body)), FileType: "txt", FileSize: int64(len(body)), ParseStatus: types.ParseStatusCompleted,
					UpdatedAt: time.Now().Add(-time.Hour).UTC(), Metadata: types.JSON(metadata)}
			}
			connector := &fileStorageConnector{transport: transport, knowledge: native}
			baseline := fileStorageGroup{KnowledgeID: uuid.NewString(), Revision: "old-revision", References: []map[string]json.RawMessage{fileStorageTestWire(t, ref)}}
			at := time.Now().Add(-time.Hour).UTC()
			previous := &types.SyncCursor{LastSyncTime: at, ConnectorCursor: map[string]any{"groups": map[string]fileStorageGroup{"old:txt": baseline}, "retiring": map[string]fileStorageRetirement{}}}
			initial, err := previous.ToJSON()
			require.NoError(t, err)
			ds = &types.DataSource{ID: run.dataSourceID, TenantID: run.tenantID, KnowledgeBaseID: run.knowledgeBaseID, Type: fileStorageConnectorType, LastSyncCursor: initial}
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
				intent := pending.Applying[repo.createdKnowledge.FileHash+":"+repo.createdKnowledge.FileType]
				require.Equal(t, repo.createdKnowledge.ID, intent.KnowledgeID)
				require.Equal(t, run.syncLogID, intent.BatchID)
			}
			ctx := context.WithValue(newCreateKnowledgeFileContext(), fileStorageRunKey{}, run)
			input := &types.DataSourceConfig{ResourceIDs: []string{source}}
			next, err := connector.FetchStream(ctx, input, previous, newStreamHandler(svc, ds, &types.SyncResult{}, &types.SyncLog{}))
			if stage == "multiple-pending-files" {
				require.Error(t, err)
				require.Nil(t, next)
				require.Equal(t, 7, repo.createCalls, "one asynchronous parse cannot strand the remaining independent files")
				require.Equal(t, 7, storage.saveCalls)
				require.Equal(t, 7, queue.calls)
				retained, err := ds.ParseSyncCursor()
				require.NoError(t, err)
				tracked, err := fileStorageState(retained)
				require.NoError(t, err)
				require.Len(t, tracked.Applying, 7)
				require.Equal(t, baseline, tracked.Groups["old:txt"])
				require.Equal(t, at, retained.LastSyncTime)
				calls, peps := sourceCalls, pepCalls
				observing = true
				for _, native := range repo.rows {
					native.ParseStatus = types.ParseStatusCompleted
					native.UpdatedAt = time.Now().UTC()
				}
				pendingNative := repo.createdKnowledge
				pendingNative.ParseStatus = types.ParseStatusPending
				next, err = connector.FetchStream(ctx, input, retained, newStreamHandler(svc, ds, &types.SyncResult{}, &types.SyncLog{}))
				require.Error(t, err)
				require.Nil(t, next)
				retained, err = ds.ParseSyncCursor()
				require.NoError(t, err)
				tracked, err = fileStorageState(retained)
				require.NoError(t, err)
				require.Len(t, tracked.Applying, 1)
				require.Len(t, tracked.Groups, 7, "all other original creations must converge even if the pending one is observed first")
				require.Equal(t, calls, sourceCalls)
				require.Equal(t, peps, pepCalls)
				pendingNative.ParseStatus = types.ParseStatusCompleted
				pendingNative.UpdatedAt = time.Now().UTC()
				next, err = connector.FetchStream(ctx, input, retained, newStreamHandler(svc, ds, &types.SyncResult{}, &types.SyncLog{}))
				require.NoError(t, err)
				final, err := fileStorageState(next)
				require.NoError(t, err)
				require.Empty(t, final.Applying)
				require.Len(t, final.Groups, 8)
				require.True(t, next.LastSyncTime.After(at))
				require.Equal(t, 7, repo.createCalls)
				require.Equal(t, 7, storage.saveCalls)
				require.Equal(t, 7, queue.calls)
				require.Equal(t, calls, sourceCalls)
				require.Equal(t, peps, pepCalls)
				return
			}
			if stage == "existing-ready" || stage == "existing-ready-ack-lost" {
				if stage == "existing-ready-ack-lost" {
					require.Error(t, err)
					retained, err := ds.ParseSyncCursor()
					require.NoError(t, err)
					calls, peps := sourceCalls, pepCalls
					observing = true
					next, err = connector.FetchStream(ctx, input, retained, newStreamHandler(svc, ds, &types.SyncResult{}, &types.SyncLog{}))
					require.NoError(t, err)
					require.Equal(t, calls, sourceCalls)
					require.Equal(t, peps, pepCalls)
				} else {
					require.NoError(t, err)
				}
				require.NotNil(t, next)
				final, err := fileStorageState(next)
				require.NoError(t, err)
				require.Empty(t, final.Applying)
				require.Equal(t, repo.createdKnowledge.ID, final.Groups[fmt.Sprintf("%x:txt", md5.Sum(body))].KnowledgeID)
				require.Zero(t, repo.createCalls, "unchanged hash content must reuse the original native file")
				require.Zero(t, storage.saveCalls)
				require.Zero(t, queue.calls)
				require.Equal(t, repo.createdKnowledge.UpdatedAt.Format(time.RFC3339Nano), receipts[readKey]["nativeRevision"])
				return
			}
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
			next, err = connector.FetchStream(ctx, input, retained, newStreamHandler(svc, ds, &types.SyncResult{}, &types.SyncLog{}))
			if stage == "receipt-ack-lost" || stage == "receipt-refused" || stage == "usage-pending" || stage == "parse-failed" || stage == "empty-file-parse-failed" || stage == "provenance-drift" || stage == "creation-missing" {
				require.Error(t, err)
				require.Nil(t, next)
				if stage == "receipt-ack-lost" || stage == "receipt-refused" || stage == "usage-pending" {
					retained, err = ds.ParseSyncCursor()
					require.NoError(t, err)
					pending, err := fileStorageState(retained)
					require.NoError(t, err)
					require.Len(t, pending.Applying, 1)
					for _, intent := range pending.Applying {
						require.False(t, intent.ObservedAt.IsZero())
						require.Equal(t, repo.createdKnowledge.UpdatedAt.Format(time.RFC3339Nano), intent.Revision)
					}
					require.Equal(t, at, retained.LastSyncTime)
					require.Equal(t, baseline, pending.Groups["old:txt"])
				} else {
					require.Equal(t, before, ds.LastSyncCursor)
				}
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
				completed, err := time.Parse(time.RFC3339Nano, receipts[readKey]["completedAt"].(string))
				require.NoError(t, err)
				require.False(t, completed.Before(repo.createdKnowledge.UpdatedAt))
			}
			require.Equal(t, calls, sourceCalls)
			require.Equal(t, peps, pepCalls)
			require.Equal(t, 1, repo.createCalls, "recovery must observe the original creation, never create another file")
			require.Equal(t, 1, storage.saveCalls)
			require.Equal(t, 1, queue.calls)
		})
	}
}
