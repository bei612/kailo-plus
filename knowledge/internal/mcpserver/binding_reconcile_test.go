package mcpserver

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/Tencent/WeKnora/internal/ratelimit"
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/mark3labs/mcp-go/mcp"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
)

func TestNativeBindingReconcileConsumesManagementProofAndOriginalRows(t *testing.T) {
	for _, scenario := range []string{"empty", "denied", "ordinary-action", "foreign-binding", "legacy-task", "legacy-sync", "managed-document", "later-generation", "legacy-document", "acked-task", "foreign-task", "unavailable-queue", "unscoped-task", "aggregating-task", "empty-retained-queue"} {
		t.Run(scenario, func(t *testing.T) {
			f := newNativeBindingFixture(t)
			if scenario != "unavailable-queue" {
				r := miniredis.RunT(t)
				f.server.redisClient = redis.NewClient(&redis.Options{Addr: r.Addr()})
				t.Cleanup(func() { _ = f.server.redisClient.Close() })
			}
			f.server.limiter = ratelimit.New(f.server.redisClient, rateLimitKeyPrefix, time.Minute, "")
			db := f.server.db
			require.NoError(t, db.AutoMigrate(&types.TaskPendingOp{}, &types.DataSource{}, &types.SyncLog{}, &types.Knowledge{}))
			kb := f.config["nativeKnowledgeBaseId"].(string)
			binding := f.config["bindingId"].(string)
			f.operation = "reconcile"
			f.claims["target_type"], f.claims["target_id"], f.claims["action_key"] = "APPLICATION_BINDING", binding, "application_binding.disable"
			f.arguments = map[string]any{"bindingId": binding, "generation": float64(4), "configDigest": "retained-config-digest",
				"nativeInstanceRef": "fixture-native-instance", "nativeScopeRef": kb, "idempotencyKey": f.claims["action_execution_id"]}
			f.config["management"] = map[string]any{"validation": map[string]any{"nativeInstanceRef": "fixture-native-instance"}}
			f.writeConfig(t)
			key := uuid.NewString()
			switch scenario {
			case "acked-task", "foreign-task", "unscoped-task", "aggregating-task", "empty-retained-queue":
				taskKB := kb
				if scenario == "foreign-task" {
					taskKB = uuid.NewString()
				}
				body, err := json.Marshal(types.DocumentProcessPayload{TenantID: f.ep.TenantID, KnowledgeBaseID: taskKB, KnowledgeID: uuid.NewString()})
				require.NoError(t, err)
				if scenario == "unscoped-task" {
					body = []byte(`{}`)
				}
				options := []asynq.Option{asynq.TaskID(key)}
				if scenario == "aggregating-task" {
					options = append(options, asynq.Group(uuid.NewString()))
				}
				info, err := asynq.NewClientFromRedisClient(f.server.redisClient).Enqueue(asynq.NewTask(types.TypeDocumentProcess, body), options...)
				require.NoError(t, err)
				if scenario == "empty-retained-queue" {
					require.NoError(t, asynq.NewInspectorFromRedisClient(f.server.redisClient).DeleteTask(info.Queue, key))
				}
			case "denied":
				f.deny = true
			case "ordinary-action":
				f.claims["action_key"] = "knowledge.read@v2"
			case "foreign-binding":
				f.arguments["bindingId"] = uuid.NewString()
			case "legacy-task":
				require.NoError(t, db.Create(&types.TaskPendingOp{TenantID: f.ep.TenantID, Scope: types.TaskScopeKnowledgeBase,
					ScopeID: kb, TaskType: types.TypeKnowledgeListDelete, DedupKey: key, Payload: json.RawMessage(`{}`)}).Error)
			case "legacy-sync":
				ds := &types.DataSource{ID: uuid.NewString(), TenantID: f.ep.TenantID, KnowledgeBaseID: kb, Type: "file_storage"}
				require.NoError(t, db.Create(ds).Error)
				require.NoError(t, db.Create(&types.SyncLog{ID: key, TenantID: f.ep.TenantID, DataSourceID: ds.ID, Status: types.SyncLogStatusSuccess}).Error)
			case "managed-document", "later-generation", "legacy-document":
				generation := "4"
				if scenario == "later-generation" {
					generation = "5"
				}
				metadata, err := json.Marshal(map[string]string{"platform_receiver_binding_id": binding, "platform_receiver_generation": generation})
				require.NoError(t, err)
				if scenario == "legacy-document" {
					metadata = []byte(`{}`)
				}
				require.NoError(t, db.Create(&types.Knowledge{ID: uuid.NewString(), TenantID: f.ep.TenantID, KnowledgeBaseID: kb,
					Channel: "file_storage", Metadata: types.JSON(metadata)}).Error)
			}
			ctx := context.WithValue(context.Background(), types.MCPEndpointContextKey, f.ep)
			result, err := f.server.guardTool(f.server.handleNativeBindingReconcile)(ctx, f.request(t, nativeBindingReconcileTool, nil))
			require.NoError(t, err)
			var retained types.MCPEndpoint
			require.NoError(t, db.First(&retained, "id = ?", f.ep.ID).Error)
			if scenario == "unscoped-task" {
				require.True(t, result.IsError)
				require.EqualValues(t, 4, retained.PlatformClosedGeneration, "failed observation does not reopen ingress")
				encoded, err := json.Marshal(result)
				require.NoError(t, err)
				require.NotContains(t, string(encoded), key, "unknown queue ownership cannot disclose a foreign native reference")
				return
			}
			if scenario == "denied" || scenario == "ordinary-action" || scenario == "foreign-binding" {
				require.True(t, result.IsError)
				require.Zero(t, retained.PlatformClosedGeneration)
				return
			}
			require.False(t, result.IsError, "%+v", result)
			require.EqualValues(t, 4, retained.PlatformClosedGeneration)
			require.Equal(t, 2, f.peps)
			var response map[string]any
			require.NoError(t, json.Unmarshal([]byte(result.Content[0].(mcp.TextContent).Text), &response))
			require.Equal(t, f.arguments, response["reference"])
			require.Equal(t, scenario == "empty" || scenario == "later-generation", response["complete"])
			if scenario == "legacy-task" || scenario == "legacy-sync" || scenario == "acked-task" {
				observations := response["observations"].([]any)
				require.Len(t, observations, 1)
				require.Equal(t, key, observations[0].(map[string]any)["idempotencyKey"])
				require.Equal(t, "UNKNOWN", observations[0].(map[string]any)["platformStatus"])
			}
			tools := f.server.filterTools(ctx, []mcp.Tool{mcp.NewTool(nativeBindingReconcileTool)})
			require.Empty(t, tools, "management must never become model-facing tool discovery")
		})
	}
}

func TestNativeBindingReconcileConsumesFinishedBatchSnapshot(t *testing.T) {
	for _, scenario := range []string{"complete", "foreign-queue", "redelivered-parse", "missing-generation", "wrong-binding", "running-batch", "pending-document", "unconfirmed-application"} {
		t.Run(scenario, func(t *testing.T) {
			f := newNativeBindingFixture(t)
			r := miniredis.RunT(t)
			f.server.redisClient = redis.NewClient(&redis.Options{Addr: r.Addr()})
			t.Cleanup(func() { _ = f.server.redisClient.Close() })
			require.NoError(t, f.server.db.AutoMigrate(&types.TaskPendingOp{}, &types.DataSource{}, &types.SyncLog{}, &types.Knowledge{}))
			kb, binding := f.config["nativeKnowledgeBaseId"].(string), f.config["bindingId"].(string)
			source, batch, document := uuid.NewString(), uuid.NewString(), uuid.NewString()
			revision := time.Now().Add(-time.Minute).UTC()
			finished := time.Now().Add(-time.Second).UTC()
			cursor := map[string]interface{}{"batchId": batch, "bindingId": binding, "generation": 4, "groups": map[string]interface{}{"original": map[string]string{"knowledgeId": document, "revision": revision.Format(time.RFC3339Nano)}}, "applying": map[string]interface{}{}, "retiring": map[string]interface{}{}}
			delete(cursor, "applying") // fileStorageCheckpoint omits the empty native map.
			if scenario == "missing-generation" {
				delete(cursor, "generation")
			}
			if scenario == "wrong-binding" {
				cursor["bindingId"] = uuid.NewString()
			}
			if scenario == "unconfirmed-application" {
				cursor["applying"] = map[string]interface{}{"original": map[string]string{"knowledgeId": document}}
			}
			result, err := (&types.SyncResult{NextCursor: &types.SyncCursor{LastSyncTime: finished, ConnectorCursor: cursor}}).ToJSON()
			require.NoError(t, err)
			log := &types.SyncLog{ID: batch, DataSourceID: source, TenantID: f.ep.TenantID, Status: types.SyncLogStatusSuccess, StartedAt: revision, FinishedAt: &finished, Result: result}
			if scenario == "running-batch" {
				log.Status = types.SyncLogStatusRunning
				log.FinishedAt = nil
			}
			require.NoError(t, f.server.db.Create(&types.DataSource{ID: source, TenantID: f.ep.TenantID, KnowledgeBaseID: kb, PlatformBindingID: binding, Type: "file_storage"}).Error)
			require.NoError(t, f.server.db.Create(log).Error)
			metadata, err := json.Marshal(map[string]string{"platform_receiver_binding_id": binding, "platform_receiver_generation": "4"})
			require.NoError(t, err)
			row := &types.Knowledge{ID: document, TenantID: f.ep.TenantID, KnowledgeBaseID: kb, Metadata: metadata, Channel: "file_storage", ParseStatus: types.ParseStatusCompleted, UpdatedAt: revision}
			if scenario == "pending-document" {
				row.ParseStatus = types.ParseStatusFinalizing
				row.PendingSubtasksCount = 1
			}
			require.NoError(t, f.server.db.Create(row).Error)
			if scenario == "foreign-queue" || scenario == "redelivered-parse" {
				payload := types.DocumentProcessPayload{TenantID: f.ep.TenantID, KnowledgeBaseID: kb, KnowledgeID: document}
				if scenario == "foreign-queue" {
					payload.TenantID++
				}
				raw, err := json.Marshal(payload)
				require.NoError(t, err)
				_, err = asynq.NewClientFromRedisClient(f.server.redisClient).Enqueue(asynq.NewTask(types.TypeDocumentProcess, raw))
				require.NoError(t, err)
			}
			delivery, err := f.server.nativeAdapter(context.Background(), f.ep, false)
			require.NoError(t, err)
			value, err := f.server.observeNativeBinding(context.Background(), delivery.ep, fileStorageReferenceForTest(t, binding, kb))
			require.NoError(t, err)
			require.Equal(t, scenario == "complete", value["complete"])
			observations := value["observations"].([]map[string]any)
			require.Len(t, observations, 1)
			if scenario == "complete" || scenario == "foreign-queue" || scenario == "redelivered-parse" {
				require.Equal(t, "SUCCEEDED", observations[0]["platformStatus"])
				require.Equal(t, batch, observations[0]["idempotencyKey"])
			}
		})
	}
}

func fileStorageReferenceForTest(t *testing.T, binding, kb string) map[string]json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(map[string]interface{}{"bindingId": binding, "generation": 4, "nativeScopeRef": kb})
	require.NoError(t, err)
	var result map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(raw, &result))
	return result
}
