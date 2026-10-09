package repository

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/Tencent/WeKnora/internal/datasource"
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/alicebob/miniredis/v2"
	"github.com/hibiken/asynq"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupDataSourceRepoTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&types.DataSource{}, &types.SyncLog{}, &types.TaskPendingOp{}))
	return db
}

func TestSyncHandoffRetainsOriginalRunAcrossAckLoss(t *testing.T) {
	db := setupDataSourceRepoTestDB(t)
	ctx := context.Background()
	sources, logs := NewDataSourceRepository(db), NewSyncLogRepository(db)
	source := &types.DataSource{ID: "source-handoff", TenantID: 1, KnowledgeBaseID: "kb-handoff", Type: types.ConnectorTypeRSS, Status: types.DataSourceStatusActive}
	require.NoError(t, sources.Create(ctx, source))
	payload := &types.DataSourceSyncPayload{DataSourceID: source.ID, TenantID: source.TenantID, Trigger: "manual",
		Initiator:      types.TaskInitiator{UserID: "original-user", Role: types.TenantRoleAdmin},
		TracingContext: types.TracingContext{LangfuseTraceparent: "00-11111111111111111111111111111111-2222222222222222-01"}}
	log, err := logs.CreatePending(ctx, source, payload)
	require.NoError(t, err)
	require.Empty(t, payload.SyncLogID, "admission must not modify the caller's payload")
	var original types.TaskPendingOp
	require.NoError(t, db.First(&original).Error)
	var retained types.DataSourceSyncPayload
	require.NoError(t, json.Unmarshal(original.Payload, &retained))
	require.Equal(t, log.ID, retained.SyncLogID)
	require.Equal(t, payload.Trigger, retained.Trigger)
	require.Equal(t, payload.Initiator, retained.Initiator)
	require.Equal(t, payload.TracingContext, retained.TracingContext)

	ackLost := errors.New("queue acknowledgement lost")
	deliveries := 0
	err = logs.DispatchPending(ctx, log.ID, func(p *types.DataSourceSyncPayload) error {
		deliveries++
		require.Equal(t, retained, *p)
		return ackLost
	})
	require.ErrorIs(t, err, ackLost)
	current, err := logs.FindByID(ctx, log.ID)
	require.NoError(t, err)
	require.Equal(t, types.SyncLogStatusRunning, current.Status)
	require.Nil(t, current.FinishedAt)
	var pending types.TaskPendingOp
	require.NoError(t, db.First(&pending, original.ID).Error)
	require.Equal(t, 1, pending.FailCount)
	require.Nil(t, pending.ClaimedAt)
	require.Equal(t, original.Payload, pending.Payload)
	_, err = logs.CreatePending(ctx, source, payload)
	require.ErrorIs(t, err, datasource.ErrSyncRunning)

	// A fresh repository after restart retries delivery of the same task only.
	restarted := NewSyncLogRepository(db)
	require.NoError(t, restarted.DispatchPending(ctx, "", func(p *types.DataSourceSyncPayload) error {
		deliveries++
		require.Equal(t, retained, *p)
		return nil
	}))
	require.NoError(t, restarted.DispatchPending(ctx, "", func(*types.DataSourceSyncPayload) error {
		t.Fatal("acknowledged queue ownership must not be replayed")
		return nil
	}))
	require.Equal(t, 2, deliveries)
	finished := time.Now().UTC()
	current.Status, current.FinishedAt = types.SyncLogStatusSuccess, &finished
	require.NoError(t, restarted.UpdateResult(ctx, current))
	require.NoError(t, restarted.DispatchPending(ctx, "", func(*types.DataSourceSyncPayload) error {
		t.Fatal("terminal run must not be enqueued")
		return nil
	}))
	var remaining int64
	require.NoError(t, db.Model(&types.TaskPendingOp{}).Count(&remaining).Error)
	require.Zero(t, remaining)
}

func TestSyncHandoffRequiresOriginalScopeAndTerminalEvidence(t *testing.T) {
	for _, change := range []string{"success", "canceled", "source-deleted", "missing-finished", "future-finished", "missing-start", "unknown-state", "foreign-kb", "foreign-tenant"} {
		t.Run(change, func(t *testing.T) {
			db := setupDataSourceRepoTestDB(t)
			ctx := context.Background()
			sources, logs := NewDataSourceRepository(db), NewSyncLogRepository(db)
			source := &types.DataSource{ID: "source-evidence", TenantID: 1, KnowledgeBaseID: "kb-evidence", Type: types.ConnectorTypeRSS, Status: types.DataSourceStatusActive}
			require.NoError(t, sources.Create(ctx, source))
			log, err := logs.CreatePending(ctx, source, &types.DataSourceSyncPayload{DataSourceID: source.ID, TenantID: source.TenantID, Trigger: "manual"})
			require.NoError(t, err)
			now := time.Now().UTC()
			switch change {
			case "success", "canceled":
				log.Status, log.FinishedAt = change, &now
			case "missing-finished":
				log.Status = types.SyncLogStatusSuccess
			case "future-finished":
				future := now.Add(time.Hour)
				log.Status, log.FinishedAt = types.SyncLogStatusSuccess, &future
			case "missing-start":
				log.Status, log.FinishedAt = types.SyncLogStatusSuccess, &now
				require.NoError(t, db.Model(log).UpdateColumn("started_at", time.Time{}).Error)
			case "unknown-state":
				log.Status = "unrecognized"
			case "foreign-kb":
				require.NoError(t, db.Model(source).UpdateColumn("knowledge_base_id", "other-kb").Error)
			case "foreign-tenant":
				require.NoError(t, db.Model(source).UpdateColumn("tenant_id", 2).Error)
			case "source-deleted":
				require.NoError(t, sources.Delete(ctx, source.ID))
			}
			require.NoError(t, logs.UpdateResult(ctx, log))
			err = logs.DispatchPending(ctx, "", func(*types.DataSourceSyncPayload) error {
				t.Fatal("terminal or unconfirmed native identity must not be enqueued")
				return nil
			})
			var count int64
			require.NoError(t, db.Model(&types.TaskPendingOp{}).Count(&count).Error)
			if change == "success" || change == "canceled" || change == "source-deleted" {
				require.NoError(t, err)
				require.Zero(t, count)
				if change == "source-deleted" {
					canceled, err := logs.FindByID(ctx, log.ID)
					require.NoError(t, err)
					require.Equal(t, types.SyncLogStatusCanceled, canceled.Status)
					require.NotNil(t, canceled.FinishedAt)
				}
			} else {
				require.Error(t, err)
				require.EqualValues(t, 1, count, "unconfirmed evidence must stay available for native reconciliation")
			}
		})
	}
}

type syncAckLossQueue struct {
	client *asynq.Client
	calls  int
}

func (q *syncAckLossQueue) Enqueue(task *asynq.Task, opts ...asynq.Option) (*asynq.TaskInfo, error) {
	q.calls++
	info, err := q.client.Enqueue(task, opts...)
	if err == nil && q.calls == 1 {
		return nil, errors.New("accepted native task lost its acknowledgement")
	}
	return info, err
}

func TestSyncHandoffUsesOriginalAsynqIdentityAfterLostAck(t *testing.T) {
	redis := miniredis.RunT(t)
	options := asynq.RedisClientOpt{Addr: redis.Addr()}
	client, inspector := asynq.NewClient(options), asynq.NewInspector(options)
	t.Cleanup(func() { _ = client.Close(); _ = inspector.Close() })
	db := setupDataSourceRepoTestDB(t)
	ctx := context.Background()
	sources, logs := NewDataSourceRepository(db), NewSyncLogRepository(db)
	source := &types.DataSource{ID: "source-asynq", TenantID: 1, KnowledgeBaseID: "kb-asynq", Type: types.ConnectorTypeRSS, Status: types.DataSourceStatusActive}
	require.NoError(t, sources.Create(ctx, source))
	log, err := logs.CreatePending(ctx, source, &types.DataSourceSyncPayload{DataSourceID: source.ID, TenantID: source.TenantID, Trigger: "manual"})
	require.NoError(t, err)
	queue := &syncAckLossQueue{client: client}
	require.Error(t, datasource.DispatchSync(ctx, logs, queue, log.ID))
	first, err := inspector.GetTaskInfo(types.QueueSync, "dssync:"+log.ID)
	require.NoError(t, err)
	require.Equal(t, types.TypeDataSourceSync, first.Type)
	require.NoError(t, datasource.DispatchSync(ctx, NewSyncLogRepository(db), queue, ""))
	require.NoError(t, datasource.DispatchSync(ctx, NewSyncLogRepository(db), queue, ""))
	require.Equal(t, 2, queue.calls, "the recovered ACK must stop further delivery")
	after, err := inspector.GetTaskInfo(types.QueueSync, first.ID)
	require.NoError(t, err)
	require.Equal(t, first.Payload, after.Payload)
	queued, err := inspector.GetQueueInfo(types.QueueSync)
	require.NoError(t, err)
	require.Equal(t, 1, queued.Pending)
}

func TestSyncHandoffAdmissionIsAtomicAndScopeBound(t *testing.T) {
	for _, change := range []string{"pending-store-unavailable", "tenant", "knowledge-base", "version", "paused-schedule", "deleted"} {
		t.Run(change, func(t *testing.T) {
			db := setupDataSourceRepoTestDB(t)
			ctx := context.Background()
			sources, logs := NewDataSourceRepository(db), NewSyncLogRepository(db)
			source := &types.DataSource{ID: "source-atomic", TenantID: 1, KnowledgeBaseID: "kb-atomic", Type: types.ConnectorTypeRSS, Status: types.DataSourceStatusActive}
			require.NoError(t, sources.Create(ctx, source))
			payload := &types.DataSourceSyncPayload{DataSourceID: source.ID, TenantID: source.TenantID, Trigger: "schedule"}
			switch change {
			case "pending-store-unavailable":
				require.NoError(t, db.Migrator().DropTable(&types.TaskPendingOp{}))
			case "tenant":
				source.TenantID++
			case "knowledge-base":
				source.KnowledgeBaseID = "other-kb"
			case "version":
				source.UpdatedAt = source.UpdatedAt.Add(-time.Second)
			case "paused-schedule":
				source.Status = types.DataSourceStatusPaused
				require.NoError(t, sources.Update(ctx, source))
			case "deleted":
				require.NoError(t, sources.Delete(ctx, source.ID))
			}
			log, err := logs.CreatePending(ctx, source, payload)
			require.Error(t, err)
			require.Nil(t, log)
			var count int64
			require.NoError(t, db.Model(&types.SyncLog{}).Count(&count).Error)
			require.Zero(t, count, "failed native handoff must roll back its run")
		})
	}
}

func TestDataSourceRepositoriesDistinguishMissingRowsFromUnavailableStores(t *testing.T) {
	db := setupDataSourceRepoTestDB(t)
	dsRepo, logRepo := NewDataSourceRepository(db), NewSyncLogRepository(db)
	ctx := context.Background()
	_, err := dsRepo.FindByID(ctx, "missing-source")
	require.ErrorIs(t, err, datasource.ErrDataSourceNotFound)
	_, err = logRepo.FindByID(ctx, "missing-log")
	require.ErrorIs(t, err, datasource.ErrSyncLogNotFound)
	ds := &types.DataSource{ID: "deleted-source", TenantID: 1, KnowledgeBaseID: "kb", Type: types.ConnectorTypeRSS}
	require.NoError(t, dsRepo.Create(ctx, ds))
	require.NoError(t, dsRepo.Delete(ctx, ds.ID))
	_, err = dsRepo.FindByID(ctx, ds.ID)
	require.ErrorIs(t, err, datasource.ErrDataSourceNotFound)
	store, err := db.DB()
	require.NoError(t, err)
	require.NoError(t, store.Close())
	_, err = dsRepo.FindByID(ctx, ds.ID)
	require.Error(t, err)
	require.NotErrorIs(t, err, datasource.ErrDataSourceNotFound)
	_, err = logRepo.FindByID(ctx, "missing-log")
	require.Error(t, err)
	require.NotErrorIs(t, err, datasource.ErrSyncLogNotFound)
}

func TestDataSourceRepositoryUpdateSyncStateClearsErrorMessage(t *testing.T) {
	db := setupDataSourceRepoTestDB(t)
	repo := NewDataSourceRepository(db)
	now := time.Now().UTC()
	result := types.JSON(`{"total":0}`)

	ds := &types.DataSource{
		ID:              "ds-1",
		TenantID:        1,
		KnowledgeBaseID: "kb-1",
		Name:            "Feishu",
		Type:            types.ConnectorTypeFeishu,
		Status:          types.DataSourceStatusError,
		ErrorMessage:    "previous failure",
	}
	require.NoError(t, repo.Create(context.Background(), ds))

	ds.Status = types.DataSourceStatusActive
	ds.ErrorMessage = ""
	ds.LastSyncAt = &now
	ds.LastSyncResult = result
	require.NoError(t, repo.UpdateSyncState(context.Background(), ds))

	var stored types.DataSource
	require.NoError(t, db.First(&stored, "id = ?", ds.ID).Error)
	assert.Equal(t, types.DataSourceStatusActive, stored.Status)
	assert.Empty(t, stored.ErrorMessage)
	assert.Equal(t, result.ToString(), stored.LastSyncResult.ToString())
	require.NotNil(t, stored.LastSyncAt)
}

func TestDataSourceRepositorySyncStateRetainsTheCurrentNativeVersion(t *testing.T) {
	for _, change := range []string{"overlapping-run", "paused", "deleted", "tenant", "knowledge-base", "missing-version"} {
		t.Run(change, func(t *testing.T) {
			db := setupDataSourceRepoTestDB(t)
			repo := NewDataSourceRepository(db)
			ctx := context.Background()
			current := &types.DataSource{ID: "ds-sync-version", TenantID: 1, KnowledgeBaseID: "kb",
				Type: types.ConnectorTypeFeishu, Status: types.DataSourceStatusActive,
				LastSyncCursor: types.JSON(`{"intent":"original"}`)}
			require.NoError(t, repo.Create(ctx, current))
			stale, err := repo.FindByID(ctx, current.ID)
			require.NoError(t, err)
			originalVersion := stale.UpdatedAt
			switch change {
			case "overlapping-run":
				current.LastSyncCursor = types.JSON(`{"intent":"newer-run"}`)
				require.NoError(t, repo.UpdateSyncState(ctx, current))
				firstVersion := current.UpdatedAt
				current.LastSyncCursor = types.JSON(`{"intent":"newer-checkpoint"}`)
				require.NoError(t, repo.UpdateSyncState(ctx, current))
				require.False(t, firstVersion.Equal(current.UpdatedAt))
			case "paused":
				current.Status = types.DataSourceStatusPaused
				require.NoError(t, repo.Update(ctx, current))
			case "deleted":
				require.NoError(t, repo.Delete(ctx, current.ID))
			case "tenant":
				stale.TenantID++
			case "knowledge-base":
				stale.KnowledgeBaseID = "other-kb"
			case "missing-version":
				stale.UpdatedAt = time.Time{}
			}
			var before types.DataSource
			require.NoError(t, db.Unscoped().First(&before, "id = ?", current.ID).Error)
			stale.LastSyncCursor = types.JSON(`{"intent":"must-not-overwrite"}`)
			stale.LastSyncResult = types.JSON(`{"total":99}`)
			stale.Status = types.DataSourceStatusError
			stale.ErrorMessage = "stale final failure"
			require.Error(t, repo.UpdateSyncState(ctx, stale))
			if change != "missing-version" {
				require.True(t, originalVersion.Equal(stale.UpdatedAt), "a refused write cannot acquire the newer row version")
			}
			var after types.DataSource
			require.NoError(t, db.Unscoped().First(&after, "id = ?", current.ID).Error)
			require.Equal(t, before.LastSyncCursor, after.LastSyncCursor)
			require.Equal(t, before.LastSyncResult, after.LastSyncResult)
			require.Equal(t, before.Status, after.Status)
			require.Equal(t, before.ErrorMessage, after.ErrorMessage)
			require.True(t, before.UpdatedAt.Equal(after.UpdatedAt))
			require.Equal(t, before.DeletedAt, after.DeletedAt)
		})
	}
}

func TestDataSourceRepositorySettingsCannotOverwriteNativeRecovery(t *testing.T) {
	db := setupDataSourceRepoTestDB(t)
	repo := NewDataSourceRepository(db)
	ctx := context.Background()
	lastSyncAt := time.Now().Add(-time.Hour).UTC()
	current := &types.DataSource{ID: "ds-settings-recovery", TenantID: 1, KnowledgeBaseID: "kb",
		Name: "Original", Type: types.ConnectorTypeFeishu, Status: types.DataSourceStatusActive,
		SyncDeletions: true, LastSyncAt: &lastSyncAt,
		LastSyncCursor: types.JSON(`{"applying":{"knowledgeId":"original"}}`),
		LastSyncResult: types.JSON(`{"total":1}`)}
	require.NoError(t, repo.Create(ctx, current))
	stale, err := repo.FindByID(ctx, current.ID)
	require.NoError(t, err)
	current.LastSyncCursor = types.JSON(`{"retiring":{"taskId":"original-task"}}`)
	current.LastSyncResult = types.JSON(`{"total":2}`)
	require.NoError(t, repo.UpdateSyncState(ctx, current))
	running := *current
	var before types.DataSource
	require.NoError(t, db.First(&before, "id = ?", current.ID).Error)

	forgedAt := lastSyncAt.Add(-time.Hour)
	stale.Name = "Edited"
	stale.SyncDeletions = false
	stale.LastSyncAt = &forgedAt
	stale.LastSyncCursor = types.JSON(`{"groups":{},"applying":{},"retiring":{}}`)
	stale.LastSyncResult = types.JSON(`{"total":999}`)
	stale.CreatedAt = forgedAt
	stale.UpdatedAt = forgedAt
	stale.DeletedAt = gorm.DeletedAt{Time: forgedAt, Valid: true}
	require.NoError(t, repo.Update(ctx, stale))
	var after types.DataSource
	require.NoError(t, db.Unscoped().First(&after, "id = ?", current.ID).Error)
	require.Equal(t, "Edited", after.Name)
	require.False(t, after.SyncDeletions)
	require.Equal(t, before.LastSyncAt, after.LastSyncAt)
	require.Equal(t, before.LastSyncCursor, after.LastSyncCursor)
	require.Equal(t, before.LastSyncResult, after.LastSyncResult)
	require.Equal(t, before.CreatedAt, after.CreatedAt)
	require.Equal(t, before.DeletedAt, after.DeletedAt)
	require.True(t, after.UpdatedAt.After(before.UpdatedAt), "settings changes must invalidate the worker's earlier native version")
	require.False(t, after.UpdatedAt.Equal(forgedAt))
	require.True(t, stale.UpdatedAt.Equal(after.UpdatedAt), "the caller must retain the database's actual timestamp precision")
	running.LastSyncCursor = types.JSON(`{"intent":"stale-worker"}`)
	require.Error(t, repo.UpdateSyncState(ctx, &running))
	retained, err := repo.FindByID(ctx, current.ID)
	require.NoError(t, err)
	require.Equal(t, before.LastSyncCursor, retained.LastSyncCursor)
	missing := *stale
	missing.ID = "ds-settings-missing"
	require.Error(t, repo.Update(ctx, &missing))
}

func TestDataSourceRepositoryUpdatePersistsDisabledSyncDeletions(t *testing.T) {
	db := setupDataSourceRepoTestDB(t)
	repo := NewDataSourceRepository(db)
	ctx := context.Background()

	ds := &types.DataSource{
		ID:              "ds-sync-deletions",
		TenantID:        1,
		KnowledgeBaseID: "kb-1",
		Name:            "Feishu",
		Type:            types.ConnectorTypeFeishu,
		SyncDeletions:   true,
	}
	require.NoError(t, repo.Create(ctx, ds))

	ds.SyncDeletions = false
	require.NoError(t, repo.Update(ctx, ds))
	assert.False(t, ds.SyncDeletions)

	var stored types.DataSource
	require.NoError(t, db.First(&stored, "id = ?", ds.ID).Error)
	assert.False(t, stored.SyncDeletions)

	ds.SyncDeletions = true
	require.NoError(t, repo.Update(ctx, ds))
	assert.True(t, ds.SyncDeletions)
	require.NoError(t, db.First(&stored, "id = ?", ds.ID).Error)
	assert.True(t, stored.SyncDeletions)
}

func TestDataSourceRepositoryCreatePersistsDisabledSyncDeletions(t *testing.T) {
	db := setupDataSourceRepoTestDB(t)
	repo := NewDataSourceRepository(db)
	ctx := context.Background()

	ds := &types.DataSource{
		ID:              "ds-create-sync-deletions",
		TenantID:        1,
		KnowledgeBaseID: "kb-1",
		Name:            "Feishu",
		Type:            types.ConnectorTypeFeishu,
		SyncDeletions:   false,
	}
	require.NoError(t, repo.Create(ctx, ds))
	assert.False(t, ds.SyncDeletions, "Create must not leave the in-memory field hydrated to the GORM default")

	var stored types.DataSource
	require.NoError(t, db.First(&stored, "id = ?", ds.ID).Error)
	assert.False(t, stored.SyncDeletions)

	// A later Updates() on the same pointer must not persist the hydrated default.
	ds.Name = "Renamed"
	require.NoError(t, repo.Update(ctx, ds))
	require.NoError(t, db.First(&stored, "id = ?", ds.ID).Error)
	assert.False(t, stored.SyncDeletions)
	assert.Equal(t, "Renamed", stored.Name)
}

func TestDataSourceRepositoryCreatePersistsEnabledSyncDeletions(t *testing.T) {
	db := setupDataSourceRepoTestDB(t)
	repo := NewDataSourceRepository(db)
	ctx := context.Background()

	ds := &types.DataSource{
		ID:              "ds-create-sync-deletions-enabled",
		TenantID:        1,
		KnowledgeBaseID: "kb-1",
		Name:            "Feishu",
		Type:            types.ConnectorTypeFeishu,
		SyncDeletions:   true,
	}
	require.NoError(t, repo.Create(ctx, ds))
	assert.True(t, ds.SyncDeletions)

	var stored types.DataSource
	require.NoError(t, db.First(&stored, "id = ?", ds.ID).Error)
	assert.True(t, stored.SyncDeletions)
}

func TestDataSourceRepositoryDeleteSoftDeletesOnSQLite(t *testing.T) {
	db := setupDataSourceRepoTestDB(t)
	repo := NewDataSourceRepository(db)
	ctx := context.Background()

	target := &types.DataSource{
		ID:              "ds-delete-target",
		TenantID:        1,
		KnowledgeBaseID: "kb-1",
		Name:            "Delete target",
		Type:            types.ConnectorTypeFeishu,
	}
	other := &types.DataSource{
		ID:              "ds-delete-other",
		TenantID:        1,
		KnowledgeBaseID: "kb-1",
		Name:            "Other data source",
		Type:            types.ConnectorTypeFeishu,
	}
	require.NoError(t, repo.Create(ctx, target))
	require.NoError(t, repo.Create(ctx, other))

	require.NoError(t, repo.Delete(ctx, target.ID))

	var deleted types.DataSource
	require.NoError(t, db.Unscoped().First(&deleted, "id = ?", target.ID).Error)
	assert.True(t, deleted.DeletedAt.Valid)

	found, err := repo.FindByID(ctx, target.ID)
	assert.Error(t, err)
	assert.Nil(t, found)

	untouched, err := repo.FindByID(ctx, other.ID)
	require.NoError(t, err)
	assert.Equal(t, other.ID, untouched.ID)
}

func TestSyncLogRepositoryUpdateResultClearsErrorMessage(t *testing.T) {
	db := setupDataSourceRepoTestDB(t)
	repo := NewSyncLogRepository(db)
	finishedAt := time.Now().UTC()
	result := types.JSON(`{"total":0}`)

	log := &types.SyncLog{
		ID:           "log-1",
		DataSourceID: "ds-1",
		TenantID:     1,
		Status:       types.SyncLogStatusFailed,
		ErrorMessage: "previous failure",
		ItemsTotal:   1,
		ItemsFailed:  1,
	}
	require.NoError(t, repo.Create(context.Background(), log))

	log.Status = types.SyncLogStatusSuccess
	log.ErrorMessage = ""
	log.FinishedAt = &finishedAt
	log.ItemsTotal = 0
	log.ItemsFailed = 0
	log.Result = result
	require.NoError(t, repo.UpdateResult(context.Background(), log))

	var stored types.SyncLog
	require.NoError(t, db.First(&stored, "id = ?", log.ID).Error)
	assert.Equal(t, types.SyncLogStatusSuccess, stored.Status)
	assert.Empty(t, stored.ErrorMessage)
	assert.Zero(t, stored.ItemsTotal)
	assert.Zero(t, stored.ItemsFailed)
	assert.Equal(t, result.ToString(), stored.Result.ToString())
	require.NotNil(t, stored.FinishedAt)
}
