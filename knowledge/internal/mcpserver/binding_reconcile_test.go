package mcpserver

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/Tencent/WeKnora/internal/datasource"
	"github.com/Tencent/WeKnora/internal/ratelimit"
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/alicebob/miniredis/v2"
	redisserver "github.com/alicebob/miniredis/v2/server"
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
				r := newNativeBindingRedis(t)
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
			require.Equal(t, scenario == "empty" || scenario == "later-generation" || scenario == "foreign-task" || scenario == "empty-retained-queue", response["complete"])
			if scenario == "legacy-task" || scenario == "legacy-sync" || scenario == "acked-task" || scenario == "aggregating-task" {
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
	for _, scenario := range []string{"complete", "foreign-queue", "redelivered-parse", "active-parent", "completed-native-task", "active-sync", "completed-sync", "wrong-sync-task", "wrong-sync-type", "missing-generation", "wrong-binding", "running-batch", "pending-document", "unconfirmed-application"} {
		t.Run(scenario, func(t *testing.T) {
			f := newNativeBindingFixture(t)
			r := newNativeBindingRedis(t)
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
			syncTask := scenario == "active-sync" || scenario == "completed-sync" || scenario == "wrong-sync-task" || scenario == "wrong-sync-type"
			if scenario == "active-parent" || scenario == "completed-native-task" || syncTask {
				payload, err := json.Marshal(types.DocumentProcessPayload{TenantID: f.ep.TenantID, KnowledgeBaseID: kb, KnowledgeID: document})
				require.NoError(t, err)
				taskType := types.TypeDocumentProcess
				options := []asynq.Option{asynq.Retention(time.Hour)}
				if syncTask {
					taskType = types.TypeDataSourceSync
					if scenario == "wrong-sync-type" {
						taskType = types.TypeDocumentProcess
					}
					payload, err = json.Marshal(types.DataSourceSyncPayload{TenantID: f.ep.TenantID, DataSourceID: source, SyncLogID: batch, Trigger: "manual"})
					require.NoError(t, err)
					id := datasource.SyncTaskID(batch)
					if scenario == "wrong-sync-task" {
						id = datasource.SyncTaskID(uuid.NewString())
					}
					options = append(options, asynq.TaskID(id))
				}
				client := asynq.NewClient(asynq.RedisClientOpt{Addr: r.Addr()})
				t.Cleanup(func() { _ = client.Close() })
				entered, release := make(chan struct{}), make(chan struct{})
				var releaseOnce sync.Once
				worker := asynq.NewServer(asynq.RedisClientOpt{Addr: r.Addr()}, asynq.Config{Concurrency: 1})
				require.NoError(t, worker.Start(asynq.HandlerFunc(func(context.Context, *asynq.Task) error {
					close(entered)
					<-release
					if scenario == "active-parent" {
						_, err := client.Enqueue(asynq.NewTask(types.TypeKnowledgePostProcess, payload), asynq.Queue("descendant"))
						return err
					}
					return nil
				})))
				t.Cleanup(func() { releaseOnce.Do(func() { close(release) }); worker.Shutdown() })
				info, err := client.Enqueue(asynq.NewTask(taskType, payload), options...)
				require.NoError(t, err)
				select {
				case <-entered:
				case <-time.After(10 * time.Second):
					t.Fatal("original Asynq worker did not start")
				}
				finish := func() {
					releaseOnce.Do(func() { close(release) })
					inspector := asynq.NewInspector(asynq.RedisClientOpt{Addr: r.Addr()})
					defer inspector.Close()
					require.Eventually(t, func() bool {
						current, err := inspector.GetTaskInfo(info.Queue, info.ID)
						return err == nil && current.State == asynq.TaskStateCompleted
					}, 10*time.Second, 10*time.Millisecond)
				}
				if scenario == "active-parent" || scenario == "active-sync" {
					require.NoError(t, nativeBindingTaskSnapshot.Load(context.Background(), f.server.redisClient).Err())
					f.server.redisClient.AddHook(&nativeSnapshotHook{after: finish})
				} else {
					finish()
				}
			}
			delivery, err := f.server.nativeAdapter(context.Background(), f.ep, false)
			require.NoError(t, err)
			value, err := f.server.observeNativeBinding(context.Background(), delivery, fileStorageReferenceForTest(t, binding, kb))
			require.NoError(t, err)
			require.Equal(t, scenario == "complete" || scenario == "foreign-queue" || scenario == "completed-native-task" || scenario == "completed-sync", value["complete"])
			observations := value["observations"].([]map[string]any)
			if scenario == "redelivered-parse" || scenario == "active-parent" {
				require.Len(t, observations, 2, "pending redelivery is not a completed native task")
			} else {
				require.Len(t, observations, 1)
			}
			if scenario == "active-sync" {
				require.Equal(t, batch, observations[0]["idempotencyKey"])
				require.Equal(t, "UNKNOWN", observations[0]["platformStatus"], "a live same-batch task overrides its earlier success snapshot")
				require.NotContains(t, observations[0], "nativeStatus")
				require.NotContains(t, observations[0], "terminalAt")
			}
			if scenario == "complete" || scenario == "foreign-queue" || scenario == "redelivered-parse" {
				require.Equal(t, "SUCCEEDED", observations[0]["platformStatus"])
				require.Equal(t, batch, observations[0]["idempotencyKey"])
			}
			if scenario == "active-parent" {
				next, err := f.server.observeNativeBinding(context.Background(), delivery, fileStorageReferenceForTest(t, binding, kb))
				require.NoError(t, err)
				require.Equal(t, false, next["complete"], "new descendant queue must remain in the next atomic snapshot")
				nextObservations := next["observations"].([]map[string]any)
				require.Len(t, nextObservations, 2)
				require.Equal(t, types.TypeKnowledgePostProcess, nextObservations[1]["nativeType"])
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

// The hook runs after Redis has returned the immutable membership snapshot,
// before the observer asks the original Inspector for each task's current row.
type nativeSnapshotHook struct {
	once  sync.Once
	after func()
}

func (h *nativeSnapshotHook) DialHook(next redis.DialHook) redis.DialHook { return next }
func (h *nativeSnapshotHook) ProcessPipelineHook(next redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return next
}
func (h *nativeSnapshotHook) ProcessHook(next redis.ProcessHook) redis.ProcessHook {
	return func(ctx context.Context, cmd redis.Cmder) error {
		err := next(ctx, cmd)
		args := cmd.Args()
		if err == nil && len(args) > 1 && args[1] == nativeBindingTaskSnapshot.Hash() {
			h.once.Do(h.after)
		}
		return err
	}
}

func TestNativeBindingAtomicSnapshotPreservesDisappearedTask(t *testing.T) {
	f := newNativeBindingFixture(t)
	r := newNativeBindingRedis(t)
	f.server.redisClient = redis.NewClient(&redis.Options{Addr: r.Addr()})
	t.Cleanup(func() { _ = f.server.redisClient.Close() })
	other := redis.NewClient(&redis.Options{Addr: r.Addr()})
	t.Cleanup(func() { _ = other.Close() })
	require.NoError(t, f.server.db.AutoMigrate(&types.TaskPendingOp{}, &types.DataSource{}, &types.SyncLog{}, &types.Knowledge{}))
	kb, binding := f.config["nativeKnowledgeBaseId"].(string), f.config["bindingId"].(string)
	payload, err := json.Marshal(types.DocumentProcessPayload{TenantID: f.ep.TenantID, KnowledgeBaseID: kb, KnowledgeID: uuid.NewString()})
	require.NoError(t, err)
	info, err := asynq.NewClientFromRedisClient(other).Enqueue(asynq.NewTask(types.TypeDocumentProcess, payload))
	require.NoError(t, err)
	require.NoError(t, nativeBindingTaskSnapshot.Load(context.Background(), f.server.redisClient).Err())
	f.server.redisClient.AddHook(&nativeSnapshotHook{after: func() {
		require.NoError(t, asynq.NewInspectorFromRedisClient(other).DeleteTask(info.Queue, info.ID))
	}})
	delivery, err := f.server.nativeAdapter(context.Background(), f.ep, false)
	require.NoError(t, err)
	result, err := f.server.observeNativeBinding(context.Background(), delivery, fileStorageReferenceForTest(t, binding, kb))
	require.NoError(t, err)
	require.Equal(t, false, result["complete"], "a disappearing task is not completion evidence")
	require.Empty(t, result["observations"], "missing scope must not expose a possibly foreign task ID")
}

func TestNativeBindingSnapshotIncludesOriginalAggregationInFlight(t *testing.T) {
	f := newNativeBindingFixture(t)
	r := newNativeBindingRedis(t)
	f.server.redisClient = redis.NewClient(&redis.Options{Addr: r.Addr()})
	t.Cleanup(func() { _ = f.server.redisClient.Close() })
	require.NoError(t, f.server.db.AutoMigrate(&types.TaskPendingOp{}, &types.DataSource{}, &types.SyncLog{}, &types.Knowledge{}))
	kb, binding := f.config["nativeKnowledgeBaseId"].(string), f.config["bindingId"].(string)
	payload, err := json.Marshal(types.DocumentProcessPayload{TenantID: f.ep.TenantID, KnowledgeBaseID: kb, KnowledgeID: uuid.NewString()})
	require.NoError(t, err)
	entered, release := make(chan struct{}), make(chan struct{})
	var releaseOnce sync.Once
	server := asynq.NewServer(asynq.RedisClientOpt{Addr: r.Addr()}, asynq.Config{
		Concurrency: 1, GroupGracePeriod: time.Second, GroupMaxSize: 1,
		GroupAggregator: asynq.GroupAggregatorFunc(func(_ string, tasks []*asynq.Task) *asynq.Task {
			close(entered)
			<-release
			return tasks[0]
		}),
	})
	require.NoError(t, server.Start(asynq.HandlerFunc(func(context.Context, *asynq.Task) error { return nil })))
	t.Cleanup(func() { releaseOnce.Do(func() { close(release) }); server.Shutdown() })
	info, err := asynq.NewClientFromRedisClient(f.server.redisClient).Enqueue(asynq.NewTask(types.TypeDocumentProcess, payload), asynq.Group(uuid.NewString()))
	require.NoError(t, err)
	select {
	case <-entered:
	case <-time.After(10 * time.Second):
		t.Fatal("original Asynq aggregator did not acquire its task")
	}
	groups, err := f.server.redisClient.SMembers(context.Background(), "asynq:{"+info.Queue+"}:groups").Result()
	require.NoError(t, err)
	require.Empty(t, groups, "native producer moved the task out of the ordinary group index")
	delivery, err := f.server.nativeAdapter(context.Background(), f.ep, false)
	require.NoError(t, err)
	result, err := f.server.observeNativeBinding(context.Background(), delivery, fileStorageReferenceForTest(t, binding, kb))
	require.NoError(t, err)
	require.Equal(t, false, result["complete"])
	observations := result["observations"].([]map[string]any)
	require.Len(t, observations, 1)
	require.Equal(t, info.ID, observations[0]["nativeId"])
	require.Equal(t, "UNKNOWN", observations[0]["platformStatus"])
}

func TestNativeBindingSnapshotRejectsDeliveryLimit(t *testing.T) {
	f := newNativeBindingFixture(t)
	r := newNativeBindingRedis(t)
	f.server.redisClient = redis.NewClient(&redis.Options{Addr: r.Addr()})
	t.Cleanup(func() { _ = f.server.redisClient.Close() })
	require.NoError(t, f.server.db.AutoMigrate(&types.TaskPendingOp{}, &types.DataSource{}, &types.SyncLog{}, &types.Knowledge{}))
	kb, binding := f.config["nativeKnowledgeBaseId"].(string), f.config["bindingId"].(string)
	payload, err := json.Marshal(types.DocumentProcessPayload{TenantID: f.ep.TenantID, KnowledgeBaseID: kb, KnowledgeID: uuid.NewString()})
	require.NoError(t, err)
	_, err = asynq.NewClientFromRedisClient(f.server.redisClient).Enqueue(asynq.NewTask(types.TypeDocumentProcess, payload))
	require.NoError(t, err)
	delivery, err := f.server.nativeAdapter(context.Background(), f.ep, false)
	require.NoError(t, err)
	delivery.values["maxBodyBytes"] = json.RawMessage(`1`)
	result, err := f.server.observeNativeBinding(context.Background(), delivery, fileStorageReferenceForTest(t, binding, kb))
	require.ErrorContains(t, err, "exceeds delivery limit")
	require.Nil(t, result, "an over-limit snapshot is not a successful empty observation")
}

func TestNativeBindingTaskScopeKeepsOriginalMoveOwnership(t *testing.T) {
	for _, scenario := range []string{"move-source", "move-target", "moved-managed-document", "legacy-moved-document", "foreign-managed-document"} {
		t.Run(scenario, func(t *testing.T) {
			f := newNativeBindingFixture(t)
			require.NoError(t, f.server.db.AutoMigrate(&types.Knowledge{}))
			kb, binding := f.config["nativeKnowledgeBaseId"].(string), f.config["bindingId"].(string)
			other := uuid.NewString()
			owner := binding
			if scenario == "legacy-moved-document" {
				owner = ""
			} else if scenario == "foreign-managed-document" {
				owner = uuid.NewString()
			}
			metadata, err := json.Marshal(map[string]string{"platform_receiver_binding_id": owner})
			require.NoError(t, err)
			document := &types.Knowledge{ID: uuid.NewString(), TenantID: f.ep.TenantID, KnowledgeBaseID: other, Metadata: metadata}
			require.NoError(t, f.server.db.Create(document).Error)
			payload := map[string]any{"tenant_id": f.ep.TenantID, "knowledge_id": document.ID}
			if scenario == "move-source" {
				payload["source_kb_id"], payload["target_kb_id"] = kb, other
			} else if scenario == "move-target" {
				payload["source_kb_id"], payload["target_kb_id"] = other, kb
			}
			raw, err := json.Marshal(payload)
			require.NoError(t, err)
			delivery, err := f.server.nativeAdapter(context.Background(), f.ep, false)
			require.NoError(t, err)
			belongs, err := f.server.nativeTaskMayBelong(context.Background(), delivery.ep, kb, raw)
			if scenario == "legacy-moved-document" {
				require.ErrorContains(t, err, "historical document scope")
				return
			}
			require.NoError(t, err)
			require.Equal(t, scenario != "foreign-managed-document", belongs)
		})
	}
}

func newNativeBindingRedis(t *testing.T) *miniredis.Miniredis {
	t.Helper()
	r := miniredis.RunT(t)
	// miniredis implements the real Asynq commands/Lua but not INFO cluster.
	// Only that environment fact is supplied; task/index state is never mocked.
	r.Server().SetPreHook(func(peer *redisserver.Peer, command string, args ...string) bool {
		if command == "INFO" && len(args) == 1 && args[0] == "cluster" {
			peer.WriteBulk("# Cluster\r\ncluster_enabled:0\r\n")
			return true
		}
		return false
	})
	return r
}

func TestNativeBindingSnapshotRefusesUnknownRedisTopology(t *testing.T) {
	for _, reply := range []string{"cluster_enabled:1", "", "cluster_enabled:0\r\ncluster_enabled:1"} {
		t.Run(reply, func(t *testing.T) {
			f := newNativeBindingFixture(t)
			r := newNativeBindingRedis(t)
			r.Server().SetPreHook(func(peer *redisserver.Peer, command string, args ...string) bool {
				if command == "INFO" {
					peer.WriteBulk(reply)
					return true
				}
				return false
			})
			f.server.redisClient = redis.NewClient(&redis.Options{Addr: r.Addr()})
			t.Cleanup(func() { _ = f.server.redisClient.Close() })
			require.NoError(t, f.server.db.AutoMigrate(&types.TaskPendingOp{}, &types.DataSource{}, &types.SyncLog{}, &types.Knowledge{}))
			kb, binding := f.config["nativeKnowledgeBaseId"].(string), f.config["bindingId"].(string)
			delivery, err := f.server.nativeAdapter(context.Background(), f.ep, false)
			require.NoError(t, err)
			result, err := f.server.observeNativeBinding(context.Background(), delivery, fileStorageReferenceForTest(t, binding, kb))
			require.Error(t, err)
			require.Nil(t, result, "even an empty directory cannot prove a cross-slot snapshot")
		})
	}
}
