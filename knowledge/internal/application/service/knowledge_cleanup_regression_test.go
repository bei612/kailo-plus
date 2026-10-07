package service

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/Tencent/WeKnora/internal/application/access"
	"github.com/Tencent/WeKnora/internal/config"
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/Tencent/WeKnora/internal/types/interfaces"
	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
)

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
