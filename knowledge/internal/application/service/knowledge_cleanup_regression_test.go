package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Tencent/WeKnora/internal/application/access"
	"github.com/Tencent/WeKnora/internal/application/repository"
	"github.com/Tencent/WeKnora/internal/config"
	"github.com/Tencent/WeKnora/internal/models/chat"
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/Tencent/WeKnora/internal/types/interfaces"
	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
)

type wikiDeleteModelService struct {
	interfaces.ModelService
	model chat.Chat
	err   error
}

func (s *wikiDeleteModelService) GetChatModel(context.Context, string) (chat.Chat, error) {
	return s.model, s.err
}

type wikiDeleteKBService struct {
	interfaces.KnowledgeBaseService
	kb *types.KnowledgeBase
}

func (s *wikiDeleteKBService) GetKnowledgeBaseByIDOnly(context.Context, string) (*types.KnowledgeBase, error) {
	return s.kb, nil
}

func (s *wikiDeleteKBService) GetKnowledgeBaseByID(context.Context, string) (*types.KnowledgeBase, error) {
	return s.kb, nil
}

type wikiDeletePageService struct {
	interfaces.WikiPageService
	index        *types.WikiPage
	updates      int
	lookupErr    error
	sourcePages  []*types.WikiPage
	beforeSource func()
}

func (s *wikiDeletePageService) ListPagesBySourceRef(context.Context, string, string) ([]*types.WikiPage, error) {
	if s.beforeSource != nil {
		s.beforeSource()
	}
	return s.sourcePages, s.lookupErr
}

func (s *wikiDeletePageService) GetIndex(context.Context, string) (*types.WikiPage, error) {
	return s.index, s.lookupErr
}

func (s *wikiDeletePageService) GetPageBySlug(context.Context, string, string) (*types.WikiPage, error) {
	if s.lookupErr != nil {
		return nil, s.lookupErr
	}
	return nil, repository.ErrWikiPageNotFound
}

func (s *wikiDeletePageService) UpdatePage(_ context.Context, page *types.WikiPage) (*types.WikiPage, error) {
	s.updates++
	s.index = page
	return page, nil
}

type wikiDeletePendingRepository struct {
	interfaces.TaskPendingOpsRepository
	trimErr error
}

func (r *wikiDeletePendingRepository) DeleteByIDs(ctx context.Context, ids []int64) error {
	if r.trimErr != nil {
		return r.trimErr
	}
	return r.TaskPendingOpsRepository.DeleteByIDs(ctx, ids)
}

func TestConditionalWikiDeletionUsesOriginalRetractionAndFinalizeReceipt(t *testing.T) {
	f := newDocumentWriteFixture(t)
	require.NoError(t, f.db.AutoMigrate(&types.KnowledgeBase{}, &types.TaskPendingOp{}, &types.TaskDeadLetter{}))
	kb := f.kbs.values["kb"]
	kb.IndexingStrategy.WikiEnabled = true
	kb.SummaryModelID = "native-fixture-model"
	require.NoError(t, f.db.Create(kb).Error)
	r := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: r.Addr()})
	t.Cleanup(func() { require.NoError(t, client.Close()) })
	queue := asynq.NewClient(asynq.RedisClientOpt{Addr: r.Addr()})
	t.Cleanup(func() { require.NoError(t, queue.Close()) })
	pending := &wikiDeletePendingRepository{TaskPendingOpsRepository: repository.NewTaskPendingOpsRepository(f.db)}
	f.svc.redisClient, f.svc.task, f.svc.taskPendingRepo = client, queue, pending
	f.svc.wikiRepo = &moveWikiPageRepo{}
	f.svc.config = &config.Config{KnowledgeBase: &config.KnowledgeBaseConfig{DeleteReceiptRetention: time.Hour}}
	row, err := f.repo.GetKnowledgeByID(f.ctx, 7, "doc")
	require.NoError(t, err)
	revision, taskID := row.UpdatedAt.UTC().Format(time.RFC3339Nano), uuid.NewString()
	_, err = f.svc.StartKnowledgeDeleteTask(f.ctx, "kb", "doc", revision, taskID)
	require.NoError(t, err)
	done := make(chan error, 1)
	server := asynq.NewServer(asynq.RedisClientOpt{Addr: r.Addr()}, asynq.Config{Concurrency: 1, Queues: map[string]int{types.QueueMaintenance: 1}, ShutdownTimeout: time.Second})
	require.NoError(t, server.Start(asynq.HandlerFunc(func(ctx context.Context, task *asynq.Task) error {
		err := f.svc.ProcessKnowledgeListDelete(ctx, task)
		done <- err
		return err
	})))
	t.Cleanup(server.Shutdown)
	select {
	case err = <-done:
		require.NoError(t, err)
	case <-time.After(5 * time.Second):
		t.Fatal("original deletion task did not execute")
	}
	observe := func(t *testing.T, want string) {
		t.Helper()
		state, err := f.svc.ObserveKnowledgeDeleteTask(f.ctx, "kb", "doc", revision, taskID)
		require.NoError(t, err)
		require.Equal(t, want, state["state"])
	}
	observe(t, "RUNNING")
	markerKey := WikiDeletedTombstoneKey("kb", "doc")
	raw, err := client.Get(f.ctx, markerKey).Result()
	require.NoError(t, err)
	var expected wikiDeleteReceipt
	require.NoError(t, json.Unmarshal([]byte(raw), &expected))
	require.Equal(t, revision, expected.Revision, "CAS timestamp must not replace the admitted revision")
	pages := &wikiDeletePageService{index: &types.WikiPage{Content: "old native index", Summary: "old native index"}}
	model := &templateCaptureChatModel{response: "index without deleted document"}
	models := &wikiDeleteModelService{model: model}
	wiki := &wikiIngestService{
		kbService: &wikiDeleteKBService{kb: kb}, wikiService: pages, modelService: models,
		knowledgeRepo: f.repo, pendingRepo: pending, task: queue, redisClient: client,
	}
	payload, err := json.Marshal(WikiIngestPayload{TenantID: 7, KnowledgeBaseID: "kb"})
	require.NoError(t, err)
	pages.lookupErr = errors.New("native source lookup unavailable")
	require.NoError(t, wiki.ProcessWikiIngest(f.ctx, asynq.NewTask(types.TypeWikiIngest, payload)))
	remaining, err := pending.PeekBatch(f.ctx, wikiTaskType, wikiTaskScope, "kb", wikiMaxDocsPerBatch)
	require.NoError(t, err)
	require.Len(t, remaining, 1, "failed native lookup must retain the original retract")
	require.Equal(t, 1, remaining[0].FailCount)
	observe(t, "RUNNING")
	pages.lookupErr = nil
	require.NoError(t, wiki.ProcessWikiIngest(f.ctx, asynq.NewTask(types.TypeWikiIngest, payload)))
	observe(t, "UNKNOWN") // A successful retract still has unfinished native index work.
	rows, err := pending.PeekBatch(f.ctx, wikiFinalizeTaskType, wikiTaskScope, "kb", wikiFinalizeMaxRows)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	var finalization wikiFinalizeRow
	require.NoError(t, json.Unmarshal(rows[0].Payload, &finalization))
	require.NotNil(t, finalization.Change.Cleanup)
	require.True(t, finalization.Change.Cleanup.sameDeletion(expected))
	finalize := asynq.NewTask(types.TypeWikiFinalize, payload)
	models.err = errors.New("native synthesis unavailable")
	require.ErrorContains(t, wiki.ProcessWikiFinalize(f.ctx, finalize), "synthesis model")
	observe(t, "UNKNOWN")
	models.err, model.response = nil, ""
	require.ErrorContains(t, wiki.ProcessWikiFinalize(f.ctx, finalize), "no content")
	observe(t, "UNKNOWN")
	model.response = "index without deleted document"
	pages.sourcePages = []*types.WikiPage{{Slug: "still-referenced"}}
	require.ErrorContains(t, wiki.ProcessWikiFinalize(f.ctx, finalize), "source references")
	observe(t, "UNKNOWN")
	pages.sourcePages = nil
	pending.trimErr = errors.New("native trim interrupted")
	require.ErrorContains(t, wiki.ProcessWikiFinalize(f.ctx, finalize), "trim pending")
	observe(t, "SUCCEEDED") // Durable native work won before queue acknowledgement.
	updates, graphCalls := pages.updates, f.graph.calls
	pending.trimErr = nil
	require.NoError(t, wiki.ProcessWikiFinalize(f.ctx, finalize))
	require.Equal(t, updates, pages.updates, "retry after durable completion must not rewrite the index")
	observe(t, "SUCCEEDED")
	_, err = f.svc.StartKnowledgeDeleteTask(f.ctx, "kb", "doc", revision, taskID)
	require.NoError(t, err)
	require.Equal(t, graphCalls, f.graph.calls, "observation must not repeat document deletion")
	completed, err := client.Get(f.ctx, markerKey).Result()
	require.NoError(t, err)
	for _, field := range []string{"task", "tenant", "scope", "document", "revision", "expired", "legacy", "missing"} {
		t.Run(field, func(t *testing.T) {
			var changed wikiDeleteReceipt
			require.NoError(t, json.Unmarshal([]byte(completed), &changed))
			switch field {
			case "task":
				changed.TaskID = uuid.NewString()
			case "tenant":
				changed.TenantID++
			case "scope":
				changed.KnowledgeBaseID = "other"
			case "document":
				changed.KnowledgeID = "other-doc"
			case "revision":
				changed.Revision = time.Now().UTC().Format(time.RFC3339Nano)
			case "expired":
				changed.ExpiresAt = time.Now().Add(-time.Second)
			}
			value, err := json.Marshal(changed)
			require.NoError(t, err)
			if field == "legacy" {
				value = []byte("1")
			}
			require.NoError(t, client.Set(f.ctx, markerKey, value, time.Hour).Err())
			if field == "missing" {
				require.NoError(t, client.Del(f.ctx, markerKey).Err())
			}
			observe(t, "UNKNOWN")
			require.Error(t, wiki.completeWikiDeletion(f.ctx, expected))
			require.NoError(t, client.Set(f.ctx, markerKey, completed, time.Hour).Err())
		})
	}
	observe(t, "SUCCEEDED")
	t.Run("native completion CAS", func(t *testing.T) {
		require.NoError(t, client.Set(f.ctx, markerKey, raw, time.Hour).Err())
		changed := expected
		changed.TaskID = uuid.NewString()
		replacement, err := json.Marshal(changed)
		require.NoError(t, err)
		pages.beforeSource = func() {
			require.NoError(t, client.Set(f.ctx, markerKey, replacement, time.Hour).Err())
		}
		require.ErrorContains(t, wiki.completeWikiDeletion(f.ctx, expected), "changed before completion")
		stored, err := client.Get(f.ctx, markerKey).Result()
		require.NoError(t, err)
		require.Equal(t, string(replacement), stored, "late completion must not overwrite another task's tombstone")
		pages.beforeSource = nil
		require.NoError(t, client.Set(f.ctx, markerKey, completed, time.Hour).Err())
	})
}

type wikiDeleteChunkRepository struct {
	interfaces.ChunkRepository
	err   error
	calls int
}

func (r *wikiDeleteChunkRepository) DeleteChunk(context.Context, uint64, string) error {
	r.calls++
	return r.err
}

func TestConditionalWikiDeletionDoesNotHideLegacySearchChunkFailure(t *testing.T) {
	f := newDocumentWriteFixture(t)
	require.NoError(t, f.db.AutoMigrate(&types.WikiPage{}, &types.WikiPageRevision{}))
	repo := repository.NewWikiPageRepository(f.db)
	require.NoError(t, repo.Create(f.ctx, &types.WikiPage{
		ID: uuid.NewString(), TenantID: 7, KnowledgeBaseID: "kb", Slug: "summary/doc",
		PageType: types.WikiPageTypeSummary, Status: types.WikiPageStatusPublished, Version: 1,
	}))
	chunks := &wikiDeleteChunkRepository{err: errors.New("native search chunk cleanup unavailable")}
	pages := NewWikiPageService(repo, chunks, nil, nil, nil)
	require.ErrorIs(t, pages.DeletePage(f.ctx, "kb", "summary/doc"), chunks.err)
	require.Equal(t, 1, chunks.calls)
	_, err := repo.GetBySlug(f.ctx, "kb", "summary/doc")
	require.NoError(t, err, "native page must remain reachable until searchable content cleanup succeeds")
	chunks.err = nil
	require.NoError(t, pages.DeletePage(f.ctx, "kb", "summary/doc"))
	require.Equal(t, 2, chunks.calls, "original retry must perform the failed chunk cleanup")
	_, err = repo.GetBySlug(f.ctx, "kb", "summary/doc")
	require.ErrorIs(t, err, repository.ErrWikiPageNotFound)
}

func TestConditionalDeleteTaskUsesNativeQueueReceiptWithoutReplay(t *testing.T) {
	for _, scenario := range []string{"completed", "missing row", "cleanup failed", "wiki enabled after enqueue"} {
		t.Run(scenario, func(t *testing.T) {
			f := newDocumentWriteFixture(t)
			r := miniredis.RunT(t)
			client := redis.NewClient(&redis.Options{Addr: r.Addr()})
			t.Cleanup(func() { require.NoError(t, client.Close()) })
			queue := asynq.NewClient(asynq.RedisClientOpt{Addr: r.Addr()})
			t.Cleanup(func() { require.NoError(t, queue.Close()) })
			f.svc.redisClient = client
			f.svc.task = queue
			f.svc.config = &config.Config{KnowledgeBase: &config.KnowledgeBaseConfig{DeleteReceiptRetention: time.Hour}}
			row, err := f.repo.GetKnowledgeByID(f.ctx, 7, "doc")
			require.NoError(t, err)
			revision := row.UpdatedAt.UTC().Format(time.RFC3339Nano)
			key := uuid.NewString()
			pending, err := f.svc.StartKnowledgeDeleteTask(f.ctx, "kb", "doc", revision, key)
			require.NoError(t, err)
			require.Equal(t, "RUNNING", pending["state"])
			if scenario == "missing row" {
				require.NoError(t, f.repo.DeleteKnowledge(f.ctx, 7, "doc"))
			}
			if scenario == "cleanup failed" {
				f.tenants.err = errors.New("accounting unavailable")
			}
			if scenario == "wiki enabled after enqueue" {
				f.kbs.values["kb"].IndexingStrategy.WikiEnabled = true
				f.svc.wikiRepo = &moveWikiPageRepo{}
			}
			done := make(chan error, 1)
			server := asynq.NewServer(asynq.RedisClientOpt{Addr: r.Addr()}, asynq.Config{Concurrency: 1, Queues: map[string]int{types.QueueMaintenance: 1}, ShutdownTimeout: time.Second})
			require.NoError(t, server.Start(asynq.HandlerFunc(func(ctx context.Context, task *asynq.Task) error {
				err := f.svc.ProcessKnowledgeListDelete(ctx, task)
				done <- err
				return err
			})))
			t.Cleanup(server.Shutdown)
			select {
			case err = <-done:
			case <-time.After(5 * time.Second):
				t.Fatal("original queue did not execute")
			}
			if scenario == "completed" || scenario == "wiki enabled after enqueue" {
				require.NoError(t, err)
			} else {
				require.ErrorIs(t, err, asynq.SkipRetry)
			}
			observed, err := f.svc.ObserveKnowledgeDeleteTask(f.ctx, "kb", "", "", key)
			require.NoError(t, err)
			if scenario == "completed" {
				require.Equal(t, "SUCCEEDED", observed["state"])
			} else {
				require.NotEqual(t, "SUCCEEDED", observed["state"])
			}
			if scenario == "wiki enabled after enqueue" {
				info, err := asynq.NewInspectorFromRedisClient(client).GetTaskInfo(types.QueueMaintenance, key)
				require.NoError(t, err)
				var receipt knowledgeDeleteReceipt
				require.NoError(t, json.Unmarshal(info.Result, &receipt))
				require.True(t, receipt.WikiEnabled, "receipt must describe the actual execution plan")
				require.Equal(t, "UNKNOWN", observed["state"], "queued retract is not terminal evidence")
			}
			before := f.graph.calls
			_, err = f.svc.StartKnowledgeDeleteTask(f.ctx, "kb", "doc", revision, key)
			require.NoError(t, err)
			require.Equal(t, before, f.graph.calls)
			_, err = f.svc.ObserveKnowledgeDeleteTask(f.ctx, "other", "", "", key)
			require.Error(t, err)
			_, err = f.svc.ObserveKnowledgeDeleteTask(f.ctx, "kb", "", "", uuid.NewString())
			require.Error(t, err)
		})
	}
}

type retirementPlanChunkRepository struct {
	interfaces.ChunkRepository
	afterRead func()
}

func (r *retirementPlanChunkRepository) ListImageInfoByKnowledgeIDs(ctx context.Context, tenant uint64, ids []string) ([]interfaces.ChunkImageInfo, error) {
	images, err := r.ChunkRepository.ListImageInfoByKnowledgeIDs(ctx, tenant, ids)
	r.afterRead()
	return images, err
}

func TestFileStorageRetirementAuthorizesAtNativeEnqueue(t *testing.T) {
	for _, scenario := range []string{"admitted", "revoked-after-checkpoint", "revoked-after-plan", "missing-write", "wrong-native", "wrong-task", "independent-native"} {
		t.Run(scenario, func(t *testing.T) {
			f := newDocumentWriteFixture(t)
			kb, id, source, root, binding := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
			run := fileStorageRun{dataSourceID: uuid.NewString(), syncLogID: uuid.NewString(), knowledgeBaseID: kb, tenantID: 7}
			metadata, err := json.Marshal(map[string]string{"datasource_id": run.dataSourceID, "external_id": "group"})
			require.NoError(t, err)
			require.NoError(t, f.db.Model(&types.Knowledge{}).Where("id = ?", "doc").Updates(map[string]any{
				"id": id, "knowledge_base_id": kb, "channel": fileStorageConnectorType, "metadata": types.JSON(metadata),
			}).Error)
			base := &types.KnowledgeBase{ID: kb, TenantID: 7}
			f.kbs.values[kb] = base
			ctx, err := access.WithKBTaskWrite(f.ctx, base, 7)
			require.NoError(t, err)
			row, err := f.repo.GetKnowledgeByID(ctx, 7, id)
			require.NoError(t, err)
			old := fileStorageGroup{KnowledgeID: id, Revision: row.UpdatedAt.UTC().Format(time.RFC3339Nano),
				References: []map[string]json.RawMessage{fileStorageTestWire(t, map[string]string{"resourceId": source})}}
			key := fileStorageKey(run.syncLogID, run.dataSourceID, "group", id, old.Revision, "retire")
			r := miniredis.RunT(t)
			client := redis.NewClient(&redis.Options{Addr: r.Addr()})
			queue := asynq.NewClient(asynq.RedisClientOpt{Addr: r.Addr()})
			t.Cleanup(func() {
				require.NoError(t, client.Close())
				require.NoError(t, queue.Close())
			})
			f.svc.redisClient, f.svc.task = client, queue
			f.svc.config = &config.Config{KnowledgeBase: &config.KnowledgeBaseConfig{DeleteReceiptRetention: time.Hour}}
			ds := &types.DataSource{ID: run.dataSourceID, TenantID: 7, KnowledgeBaseID: kb}
			checkpoint := newStreamHandler(&DataSourceService{dsRepo: &recordingDSRepo{},
				syncLogRepo: &processSyncSyncLogRepo{logs: map[string]*types.SyncLog{}}}, ds, &types.SyncResult{}, &types.SyncLog{})
			planned, pepCalls, sourceCalls := false, 0, 0
			f.svc.chunkRepo = &retirementPlanChunkRepository{ChunkRepository: f.chunkRepo, afterRead: func() { planned = true }}
			var server *httptest.Server
			server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch request.URL.Path {
				case "/oidc":
					_, _ = w.Write([]byte(`{"access_token":"receiver-service-token","token_type":"Bearer","expires_in":3600}`))
				case "/service/v1/adapter/request_read_grant":
					args, _ := json.Marshal(map[string]any{"actionKey": "file_storage.list@v1", "idempotencyKey": key,
						"arguments": map[string]any{"targetType": "RESOURCE", "targetId": source, "authorizationTargetNativeRef": root,
							"input": map[string]string{"resourceId": source}}})
					receiverArgs, _ := json.Marshal(map[string]any{"targetType": "RESOURCE", "targetId": binding, "authorizationTargetNativeRef": kb,
						"input": map[string]string{"sourceResourceId": source, "importConfigRef": run.dataSourceID, "batchId": run.syncLogID, "sourceReadActionExecutionId": key}})
					require.NoError(t, json.NewEncoder(w).Encode(map[string]any{"operationId": key, "actionExecutionId": key, "sourceBindingId": source,
						"endpoint": server.URL + "/execute", "actionToken": "source-token", "expiresAt": time.Now().Add(time.Hour).Unix(), "argumentsJson": string(args),
						"receiverWrite": map[string]any{"actionExecutionId": binding, "actionToken": "receiver-token", "expiresAt": time.Now().Add(time.Hour).Unix(), "argumentsJson": string(receiverArgs)}}))
				case "/execute":
					sourceCalls++
					require.NoError(t, json.NewEncoder(w).Encode(map[string]any{"resourceId": source, "nativeObjectRef": root,
						"operationId": key, "items": []any{}, "listingDigest": fileStorageDigest([]byte("[]")), "nativeRevision": fileStorageDigest([]byte("[]"))}))
				case "/service/v1/adapter/pep_check":
					pepCalls++
					if (scenario == "revoked-after-checkpoint" && len(ds.LastSyncCursor) > 0) || (scenario == "revoked-after-plan" && planned) {
						w.WriteHeader(http.StatusForbidden)
						return
					}
					require.NoError(t, json.NewEncoder(w).Encode(map[string]string{"actionExecutionId": binding, "operationId": key, "authorizationMinZedToken": "current-receiver-permission"}))
				default:
					t.Errorf("unconfirmed retirement attempted %s", request.URL.Path)
					w.WriteHeader(http.StatusForbidden)
				}
			}))
			defer server.Close()
			secret := filepath.Join(t.TempDir(), "receiver-secret")
			require.NoError(t, os.WriteFile(secret, []byte("test-only-receiver-secret"), 0600))
			transport, err := newFileStorageTransport(&config.FileStorageSyncConfig{BindingID: binding, ReceiverResourceID: binding,
				NativeKnowledgeBaseID: kb, NativeTenantID: 7, CorePepURL: server.URL + "/service/v1/adapter/pep_check",
				OIDCTokenURL: server.URL + "/oidc", OIDCClientID: "receiver", OIDCClientSecretFile: secret, TimeoutMS: 1000, MaxBodyBytes: 10240,
				ListActionVersion: 1, ReadActionVersion: 1, ApplyActionKey: "knowledge.sync_apply@v2", ApplyActionVersion: 1, RetireActionKey: "knowledge.sync_retire@v2", RetireActionVersion: 1})
			require.NoError(t, err)
			if scenario != "independent-native" {
				ctx = context.WithValue(ctx, fileStorageRunKey{}, run)
			}
			if scenario == "missing-write" || scenario == "wrong-native" || scenario == "wrong-task" || scenario == "independent-native" {
				if scenario == "wrong-native" || scenario == "wrong-task" {
					grant, err := transport.grant(ctx, run, source, "file_storage.list@v1", 1, key, transport.config.RetireActionKey, 1, map[string]string{"resourceId": source})
					require.NoError(t, err)
					write := &fileStorageWrite{transport: transport, run: run, nativeID: id, grants: []*fileStorageGrant{grant}}
					if scenario == "wrong-native" {
						write.nativeID = uuid.NewString()
					} else {
						key = uuid.NewString()
					}
					ctx = context.WithValue(ctx, fileStorageWriteKey{}, write)
				}
				_, err = f.svc.StartKnowledgeDeleteTask(ctx, kb, id, old.Revision, key)
			} else {
				connector := &fileStorageConnector{transport: transport, knowledge: f.svc}
				state := fileStorageCursor{Retiring: map[string]fileStorageRetirement{}}
				err = connector.retire(ctx, run, "group", old, map[string]*fileStorageListing{source: {digest: fileStorageDigest([]byte("[]"))}}, &state, checkpoint, time.Time{})
				require.Error(t, err, "queued deletion is not a terminal receiver receipt")
				require.Equal(t, 1, sourceCalls)
				require.Equal(t, 2, pepCalls, "the final PEP must run after native planning, not only before checkpoint")
				require.True(t, planned)
				require.Equal(t, key, state.Retiring["group"].Key)
			}
			info, queueErr := asynq.NewInspectorFromRedisClient(client).GetTaskInfo(types.QueueMaintenance, key)
			if scenario == "admitted" || scenario == "independent-native" {
				require.NoError(t, queueErr)
				require.Equal(t, asynq.TaskStatePending, info.State)
				before := pepCalls
				// An existing task is observation, even without a fresh write grant.
				observed, err := f.svc.StartKnowledgeDeleteTask(context.WithValue(ctx, fileStorageWriteKey{}, (*fileStorageWrite)(nil)), kb, id, old.Revision, key)
				require.NoError(t, err)
				require.Equal(t, "RUNNING", observed["state"])
				require.Equal(t, before, pepCalls)
			} else {
				require.Error(t, err)
				require.True(t, errors.Is(queueErr, asynq.ErrTaskNotFound) || errors.Is(queueErr, asynq.ErrQueueNotFound))
			}
		})
	}
}

func TestConditionalDeleteRetainsCleanupFailureAfterRowDeletion(t *testing.T) {
	for _, scenario := range []string{"original file", "storage accounting"} {
		t.Run(scenario, func(t *testing.T) {
			f := newDocumentWriteFixture(t)
			failure := errors.New("native cleanup unavailable")
			if scenario == "original file" {
				require.NoError(t, f.db.Model(&types.Knowledge{}).Where("id = ?", "doc").Update("file_path", "local://doc").Error)
				f.files.err = failure
			} else {
				f.tenants.err = failure
			}
			row, err := f.repo.GetKnowledgeByID(f.ctx, 7, "doc")
			require.NoError(t, err)
			err = f.svc.DeleteKnowledgeAtRevision(f.ctx, row.ID, row.UpdatedAt.UTC().Format(time.RFC3339Nano))
			require.ErrorIs(t, err, failure)
			// Native row absence cannot erase a later cleanup error or become a receipt.
			_, err = f.repo.GetKnowledgeByID(f.ctx, 7, "doc")
			require.Error(t, err)
			err = f.svc.DeleteKnowledgeAtRevision(f.ctx, row.ID, row.UpdatedAt.UTC().Format(time.RFC3339Nano))
			require.Error(t, err)
		})
	}
}

func TestDeleteTaskMovingConflictStopsRetries(t *testing.T) {
	f := transferFixture(t, access.KBTransferMove)
	row, err := f.repo.GetKnowledgeByID(f.ctx, 7, "doc")
	require.NoError(t, err)
	require.NoError(t, setTransferState(row, knowledgeTransferState{Operation: access.KBTransferMove, Phase: "moving"}))
	require.NoError(t, f.repo.UpdateKnowledge(f.ctx, row))
	beforeWrites := f.repo.writes
	raw, err := json.Marshal(
		types.KnowledgeListDeletePayload{TenantID: 7, KnowledgeBaseID: "kb", KnowledgeIDs: []string{"doc"}},
	)
	require.NoError(t, err)
	err = f.svc.ProcessKnowledgeListDelete(context.Background(), asynq.NewTask(types.TypeKnowledgeListDelete, raw))
	require.ErrorIs(t, err, asynq.SkipRetry)
	require.ErrorContains(t, err, "unfinished move")
	require.Equal(t, beforeWrites, f.repo.writes)
	require.Zero(t, f.chunkRepo.writes)
	require.Zero(t, f.graph.calls)
}

func TestDeleteWikiRemovesEveryChunkType(t *testing.T) {
	f := newDocumentWriteFixture(t)
	f.kbs.values["kb"].IndexingStrategy.WikiEnabled = true
	refs := types.StringArray{"chunk"}
	chunkTypes := []string{
		types.ChunkTypeParentText, types.ChunkTypeImageOCR, types.ChunkTypeImageCaption, types.ChunkTypeSummary,
	}
	for _, typ := range chunkTypes {
		require.NoError(
			t,
			f.db.Create(
				&types.Chunk{ID: typ, TenantID: 7, KnowledgeID: "doc", KnowledgeBaseID: "kb", ChunkType: typ},
			).Error,
		)
		refs = append(refs, typ)
	}
	refs = append(refs, "other-chunk")
	page := &types.WikiPage{
		ID:         "page",
		Slug:       "concept/shared",
		SourceRefs: types.StringArray{"doc", "other-doc"},
		ChunkRefs:  refs,
	}
	wiki := &moveWikiPageRepo{pages: []*types.WikiPage{page}}
	meta := &moveWikiMetaService{}
	f.svc.wikiRepo = wiki
	f.svc.wikiService = meta
	f.svc.taskPendingRepo = &moveWikiPendingRepo{}
	f.svc.task = &transferQueue{}
	require.NoError(t, f.svc.DeleteKnowledge(f.ctx, "doc"))
	require.Len(t, meta.updated, 1)
	require.Equal(t, types.StringArray{"other-chunk"}, meta.updated[0].ChunkRefs)
	require.Equal(t, types.StringArray{"other-doc"}, meta.updated[0].SourceRefs)
}

type cleanupKBFailure struct {
	interfaces.KnowledgeBaseService
	value *types.KnowledgeBase
	err   error
}

func (s *cleanupKBFailure) GetKnowledgeBaseByID(context.Context, string) (*types.KnowledgeBase, error) {
	return s.value, s.err
}

func TestCleanupStopsBeforeSideEffectsWhenKBUnavailable(t *testing.T) {
	for _, scenario := range []string{"storage error", "nil KB", "wrong KB", "wrong tenant"} {
		t.Run(scenario, func(t *testing.T) {
			f := newDocumentWriteFixture(t)
			lookup := &cleanupKBFailure{}
			switch scenario {
			case "storage error":
				lookup.err = errors.New("database unavailable")
			case "wrong KB":
				lookup.value = &types.KnowledgeBase{ID: "other", TenantID: 7}
			case "wrong tenant":
				lookup.value = &types.KnowledgeBase{ID: "kb", TenantID: 8}
			}
			f.svc.kbService = lookup
			row, err := f.repo.GetKnowledgeByID(f.ctx, 7, "doc")
			require.NoError(t, err)
			row.EmbeddingModelID = "bound-model"
			// Engine/model dependencies remain absent: touching a fallback backend
			// would panic instead of preserving the lookup error and original data.
			err = f.svc.cleanupKnowledgeResources(f.ctx, row)
			require.Error(t, err)
			if lookup.err != nil {
				require.ErrorIs(t, err, lookup.err)
			}
			require.Zero(t, f.chunkRepo.writes)
			require.Zero(t, f.graph.calls)
			require.Empty(t, f.files.deleted)
			require.Empty(t, f.tenants.adjustments)
		})
	}
}

func TestMoveReparseKBLookupFailurePreservesSourceCheckpoint(t *testing.T) {
	f := transferFixture(t, access.KBTransferMove)
	row, err := f.repo.GetKnowledgeByID(f.ctx, 7, "doc")
	require.NoError(t, err)
	require.NoError(
		t,
		row.SetManualMetadata(types.NewManualKnowledgeMetadata("content", types.ManualKnowledgeStatusPublish, 1)),
	)
	require.NoError(t, f.repo.UpdateKnowledge(f.ctx, row))
	failure := errors.New("source KB load failed")
	f.svc.kbService = &cleanupKBFailure{err: failure}
	err = f.svc.moveOneKnowledge(f.ctx, "doc", f.kbs.values["kb"], f.kbs.values["other"], "reparse")
	require.ErrorIs(t, err, failure)
	row, err = f.repo.GetKnowledgeByID(f.ctx, 7, "doc")
	require.NoError(t, err)
	require.Equal(t, "kb", row.KnowledgeBaseID)
	state, err := transferState(row)
	require.NoError(t, err)
	require.Equal(t, "moving", state.Phase)
	require.Zero(t, f.chunkRepo.writes)
	require.Zero(t, f.graph.calls)
}

func TestRemoveSourceRefHandlesTitledAndPaddedRefs(t *testing.T) {
	refs := types.StringArray{"doc-1", "doc-1|Title", " doc-1 |padded", "doc-10|Other", "doc-2"}
	got := removeSourceRef(refs, "doc-1")
	require.Equal(t, types.StringArray{"doc-10|Other", "doc-2"}, got)
	require.Nil(t, removeSourceRef(types.StringArray{"doc-1|T"}, "doc-1"))
	require.Equal(t, types.StringArray{"doc-1|T"}, removeSourceRef(types.StringArray{"doc-1|T"}, ""))
}
