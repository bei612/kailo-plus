package service

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/Tencent/WeKnora/internal/application/repository"
	"github.com/Tencent/WeKnora/internal/datasource"
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/Tencent/WeKnora/internal/types/interfaces"
	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type sqliteDataSourceDeleteFixture struct {
	db          *gorm.DB
	dsRepo      interfaces.DataSourceRepository
	syncLogRepo interfaces.SyncLogRepository
	scheduler   *datasource.Scheduler
	ds          *types.DataSource
	pendingLog  *types.SyncLog
	runningLog  *types.SyncLog
}

func newSQLiteDataSourceDeleteFixture(t *testing.T) *sqliteDataSourceDeleteFixture {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "weknora.db")), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&types.DataSource{}, &types.SyncLog{}))

	dsRepo := repository.NewDataSourceRepository(db)
	syncLogRepo := repository.NewSyncLogRepository(db)
	ds := &types.DataSource{
		ID:              "ds-sqlite-delete",
		TenantID:        1,
		KnowledgeBaseID: "kb-sqlite-delete",
		Name:            "SQLite delete",
		Type:            types.ConnectorTypeFeishu,
		Status:          types.DataSourceStatusActive,
		SyncSchedule:    "0 0 * * * *",
	}
	pendingLog := &types.SyncLog{
		ID:           "log-pending",
		DataSourceID: ds.ID,
		TenantID:     ds.TenantID,
		Status:       "pending",
	}
	runningLog := &types.SyncLog{
		ID:           "log-running",
		DataSourceID: ds.ID,
		TenantID:     ds.TenantID,
		Status:       types.SyncLogStatusRunning,
	}
	require.NoError(t, dsRepo.Create(context.Background(), ds))
	require.NoError(t, syncLogRepo.Create(context.Background(), pendingLog))
	require.NoError(t, syncLogRepo.Create(context.Background(), runningLog))

	scheduler := datasource.NewScheduler(dsRepo, syncLogRepo, kbDeleteTaskEnqueuer{})
	require.NoError(t, scheduler.AddOrUpdate(ds))
	require.Equal(t, 1, scheduler.EntryCount())

	return &sqliteDataSourceDeleteFixture{
		db:          db,
		dsRepo:      dsRepo,
		syncLogRepo: syncLogRepo,
		scheduler:   scheduler,
		ds:          ds,
		pendingLog:  pendingLog,
		runningLog:  runningLog,
	}
}

func TestDataSourceServiceDeleteSQLiteCleansUpAfterSoftDelete(t *testing.T) {
	fixture := newSQLiteDataSourceDeleteFixture(t)
	svc := &DataSourceService{
		dsRepo:      fixture.dsRepo,
		syncLogRepo: fixture.syncLogRepo,
		scheduler:   fixture.scheduler,
	}

	require.NoError(t, svc.DeleteDataSource(context.Background(), fixture.ds.ID))

	_, err := fixture.dsRepo.FindByID(context.Background(), fixture.ds.ID)
	require.EqualError(t, err, "data source not found")
	assert.Equal(t, 0, fixture.scheduler.EntryCount())

	for _, logID := range []string{fixture.pendingLog.ID, fixture.runningLog.ID} {
		log, err := fixture.syncLogRepo.FindByID(context.Background(), logID)
		require.NoError(t, err)
		assert.Equal(t, types.SyncLogStatusCanceled, log.Status)
		require.NotNil(t, log.FinishedAt)
		assert.Equal(t, "data source deleted", log.ErrorMessage)
	}
}

func TestDataSourceServiceManualSyncRetainsRunWhenQueueIsUnavailable(t *testing.T) {
	for _, status := range []string{types.DataSourceStatusActive, types.DataSourceStatusPaused, types.DataSourceStatusError} {
		t.Run(status, func(t *testing.T) {
			fixture := newSQLiteDataSourceDeleteFixture(t)
			require.NoError(t, fixture.db.AutoMigrate(&types.TaskPendingOp{}))
			ctx := context.Background()
			source := &types.DataSource{ID: "manual-source", TenantID: fixture.ds.TenantID,
				KnowledgeBaseID: fixture.ds.KnowledgeBaseID, Type: types.ConnectorTypeRSS, Status: status}
			require.NoError(t, fixture.dsRepo.Create(ctx, source))
			svc := &DataSourceService{dsRepo: fixture.dsRepo, syncLogRepo: fixture.syncLogRepo}
			log, err := svc.ManualSync(ctx, source.ID)
			require.NoError(t, err)
			require.Equal(t, types.SyncLogStatusRunning, log.Status)
			require.Nil(t, log.FinishedAt)
			var pending types.TaskPendingOp
			require.NoError(t, fixture.db.First(&pending, "dedup_key = ?", log.ID).Error)
			require.Equal(t, source.TenantID, pending.TenantID)
			require.Equal(t, source.KnowledgeBaseID, pending.ScopeID)
			stored, err := fixture.dsRepo.FindByID(ctx, source.ID)
			require.NoError(t, err)
			require.Equal(t, status, stored.Status, "unconfirmed dispatch must not rewrite native source state")
			second, err := svc.ManualSync(ctx, source.ID)
			require.ErrorIs(t, err, datasource.ErrSyncRunning)
			require.Nil(t, second)
			var count int64
			require.NoError(t, fixture.db.Model(&types.SyncLog{}).Where("data_source_id = ?", source.ID).Count(&count).Error)
			require.EqualValues(t, 1, count, "a second click must not create a second business run")
		})
	}
}

type nativeSyncLostAckQueue struct {
	calls  int
	client *asynq.Client
}

func (q *nativeSyncLostAckQueue) Enqueue(task *asynq.Task, options ...asynq.Option) (*asynq.TaskInfo, error) {
	q.calls++
	if q.client != nil {
		if _, err := q.client.Enqueue(task, options...); err != nil {
			return nil, err
		}
	}
	return nil, errors.New("native queue acknowledgement unavailable")
}

func TestDataSourceServiceManualSyncFrozenRequestObservesOriginalRun(t *testing.T) {
	fixture := newSQLiteDataSourceDeleteFixture(t)
	require.NoError(t, fixture.db.AutoMigrate(&types.TaskPendingOp{}, &types.MCPEndpoint{}))
	binding, kb := uuid.NewString(), uuid.NewString()
	require.NoError(t, fixture.db.Create(&types.MCPEndpoint{ID: uuid.NewString(), TenantID: 1, Enabled: true,
		PlatformBindingID: binding, KnowledgeBaseIDs: types.StringArray{kb}}).Error)
	source := &types.DataSource{ID: uuid.NewString(), TenantID: 1, KnowledgeBaseID: kb,
		PlatformBindingID: binding, Type: "file_storage", Status: types.DataSourceStatusActive}
	require.NoError(t, fixture.dsRepo.Create(context.Background(), source))
	request := types.NativeSyncRequest{Key: uuid.NewString(), DataSourceID: source.ID, KnowledgeBaseID: kb,
		ResourceID: uuid.NewString(), ActionKey: "knowledge.sync_apply@v2", BindingID: binding, Generation: 9,
		PrincipalID: uuid.NewString(), OperationID: uuid.NewString(), ParameterHash: "frozen-request",
		ExpiresAt: time.Now().Add(time.Hour).UTC()}
	ctx := types.WithNativeSyncRequest(context.Background(), request)
	queue := &nativeSyncLostAckQueue{}
	svc := &DataSourceService{dsRepo: fixture.dsRepo, syncLogRepo: fixture.syncLogRepo, taskEnqueuer: queue}
	first, err := svc.ManualSync(ctx, source.ID)
	require.NoError(t, err)
	require.False(t, first.RequestReplayed)
	var pending types.TaskPendingOp
	require.NoError(t, fixture.db.First(&pending, "dedup_key = ?", first.ID).Error)
	// Queue ownership is unresolved. Re-entry after a service restart must not
	// dispatch again or manufacture a second original native batch.
	restarted := &DataSourceService{dsRepo: repository.NewDataSourceRepository(fixture.db), syncLogRepo: repository.NewSyncLogRepository(fixture.db), taskEnqueuer: queue}
	second, err := restarted.ManualSync(ctx, source.ID)
	require.NoError(t, err)
	require.True(t, second.RequestReplayed)
	require.Equal(t, first.ID, second.ID)
	var after types.TaskPendingOp
	require.NoError(t, fixture.db.First(&after, pending.ID).Error)
	require.Equal(t, pending.FailCount, after.FailCount, "repeat must not attempt original dispatch")
	require.Equal(t, pending.Payload, after.Payload)
	require.Equal(t, 1, queue.calls)
	for _, field := range []string{"actor", "operation", "action", "scope", "generation", "expiry"} {
		t.Run(field, func(t *testing.T) {
			changed := request
			switch field {
			case "actor":
				changed.PrincipalID = uuid.NewString()
			case "operation":
				changed.OperationID = uuid.NewString()
			case "action":
				changed.ActionKey = "knowledge.sync_retire@v2"
			case "scope":
				changed.ResourceID = uuid.NewString()
			case "generation":
				changed.Generation++
			case "expiry":
				changed.ExpiresAt = changed.ExpiresAt.Add(time.Minute)
			}
			_, err := restarted.ManualSync(types.WithNativeSyncRequest(context.Background(), changed), source.ID)
			require.Error(t, err)
		})
	}
	finished := time.Now().UTC()
	first.Status, first.FinishedAt = types.SyncLogStatusSuccess, &finished
	require.NoError(t, fixture.syncLogRepo.UpdateResult(ctx, first))
	terminal, err := restarted.ManualSync(ctx, source.ID)
	require.NoError(t, err)
	require.True(t, terminal.RequestReplayed)
	require.Equal(t, first.ID, terminal.ID)
	require.Equal(t, types.SyncLogStatusSuccess, terminal.Status)
	var count int64
	require.NoError(t, fixture.db.Model(&types.SyncLog{}).Where("data_source_id = ?", source.ID).Count(&count).Error)
	require.EqualValues(t, 1, count)
}

func TestDataSourceServiceManualSyncExpiredHandoffUsesOriginalDeadLetter(t *testing.T) {
	fixture := newSQLiteDataSourceDeleteFixture(t)
	require.NoError(t, fixture.db.AutoMigrate(&types.TaskPendingOp{}, &types.TaskDeadLetter{}, &types.MCPEndpoint{}))
	binding, kb := uuid.NewString(), uuid.NewString()
	require.NoError(t, fixture.db.Create(&types.MCPEndpoint{ID: uuid.NewString(), TenantID: 1, Enabled: true,
		PlatformBindingID: binding, KnowledgeBaseIDs: types.StringArray{kb}}).Error)
	source := &types.DataSource{ID: uuid.NewString(), TenantID: 1, KnowledgeBaseID: kb,
		PlatformBindingID: binding, Type: "file_storage", Status: types.DataSourceStatusActive}
	require.NoError(t, fixture.dsRepo.Create(context.Background(), source))
	request := types.NativeSyncRequest{Key: uuid.NewString(), DataSourceID: source.ID, KnowledgeBaseID: kb,
		ResourceID: uuid.NewString(), ActionKey: "knowledge.sync_apply@v2", BindingID: binding, Generation: 9,
		PrincipalID: uuid.NewString(), OperationID: uuid.NewString(), ParameterHash: "frozen-request",
		ExpiresAt: time.Now().Add(time.Hour).UTC()}
	redis := miniredis.RunT(t)
	options := asynq.RedisClientOpt{Addr: redis.Addr()}
	client, inspector := asynq.NewClient(options), asynq.NewInspector(options)
	t.Cleanup(func() { _ = client.Close(); _ = inspector.Close() })
	queue := &nativeSyncLostAckQueue{client: client}
	svc := &DataSourceService{dsRepo: fixture.dsRepo, syncLogRepo: fixture.syncLogRepo, taskEnqueuer: queue}
	log, err := svc.ManualSync(types.WithNativeSyncRequest(context.Background(), request), source.ID)
	require.NoError(t, err)
	original, err := inspector.GetTaskInfo(types.QueueSync, "dssync:"+log.ID)
	require.NoError(t, err, "the original queue accepted execution before its ACK was lost")
	request.ExpiresAt = time.Now().Add(-time.Second).UTC()
	identity, err := json.Marshal(request)
	require.NoError(t, err)
	require.NoError(t, fixture.db.Model(log).UpdateColumn("request_identity", types.JSON(identity)).Error)
	require.ErrorContains(t, datasource.DispatchSync(context.Background(), fixture.syncLogRepo, queue, log.ID), "UNKNOWN")
	require.Equal(t, 1, queue.calls, "expired original handoff must never call the queue again")
	var archived types.TaskDeadLetter
	require.NoError(t, fixture.db.First(&archived, "related_id = ?", log.ID).Error)
	require.Equal(t, kb, archived.ScopeID)
	require.Contains(t, archived.LastError, "UNKNOWN")
	current, err := fixture.syncLogRepo.FindByID(context.Background(), log.ID)
	require.NoError(t, err)
	require.Equal(t, types.SyncLogStatusRunning, current.Status)
	require.Nil(t, current.FinishedAt, "archive is not native terminal evidence")
	require.NoError(t, datasource.DispatchSync(context.Background(), fixture.syncLogRepo, queue, log.ID))
	require.Equal(t, 1, queue.calls)
	after, err := inspector.GetTaskInfo(types.QueueSync, original.ID)
	require.NoError(t, err)
	require.Equal(t, original.Payload, after.Payload, "handoff archive does not cancel or replace the actual task")
	var count int64
	require.NoError(t, fixture.db.Model(&types.TaskDeadLetter{}).Where("related_id = ?", log.ID).Count(&count).Error)
	require.EqualValues(t, 1, count)
}

func TestSyncAttemptKeepsNativeRunOpenUntilRetriesExhausted(t *testing.T) {
	for _, outcome := range []string{types.SyncLogStatusFailed, types.SyncLogStatusPartial} {
		for _, attempt := range []string{"unknown", "retrying", "exhausted"} {
			t.Run(outcome+"/"+attempt, func(t *testing.T) {
				fixture := newSQLiteDataSourceDeleteFixture(t)
				svc := &DataSourceService{dsRepo: fixture.dsRepo, syncLogRepo: fixture.syncLogRepo}
				ctx := context.Background()
				if attempt == "retrying" {
					ctx = types.WithTaskRetryMetadata(ctx, 0, 1)
				} else if attempt == "exhausted" {
					ctx = types.WithTaskRetryMetadata(ctx, 1, 1)
				}
				require.NoError(t, svc.updateSyncRunResult(ctx, fixture.ds, fixture.runningLog,
					&types.SyncResult{Total: 1, Failed: 1}, types.JSON(`{"failed":1}`), outcome, "native attempt error", false))
				stored, err := fixture.syncLogRepo.FindByID(ctx, fixture.runningLog.ID)
				require.NoError(t, err)
				require.Equal(t, 1, stored.ItemsFailed)
				require.Equal(t, "native attempt error", stored.ErrorMessage)
				if attempt == "exhausted" {
					require.Equal(t, outcome, stored.Status)
					require.NotNil(t, stored.FinishedAt)
				} else {
					require.Equal(t, types.SyncLogStatusRunning, stored.Status)
					require.Nil(t, stored.FinishedAt)
					running, err := fixture.syncLogRepo.HasRunningSync(ctx, fixture.ds.ID)
					require.NoError(t, err)
					require.True(t, running, "retry ownership must still prevent another run")
				}
			})
		}
	}
}

func TestDataSourceServiceDeleteKeepsCleanupStateWhenSoftDeleteFails(t *testing.T) {
	fixture := newSQLiteDataSourceDeleteFixture(t)
	require.NoError(t, fixture.db.Exec(`
		CREATE TRIGGER fail_datasource_soft_delete
		BEFORE UPDATE OF deleted_at ON data_sources
		WHEN NEW.id = 'ds-sqlite-delete'
		BEGIN
			SELECT RAISE(FAIL, 'forced soft delete failure');
		END;
	`).Error)
	svc := &DataSourceService{
		dsRepo:      fixture.dsRepo,
		syncLogRepo: fixture.syncLogRepo,
		scheduler:   fixture.scheduler,
	}

	err := svc.DeleteDataSource(context.Background(), fixture.ds.ID)
	require.ErrorContains(t, err, "forced soft delete failure")

	found, err := fixture.dsRepo.FindByID(context.Background(), fixture.ds.ID)
	require.NoError(t, err)
	assert.Equal(t, fixture.ds.ID, found.ID)
	assert.Equal(t, 1, fixture.scheduler.EntryCount())

	pending, err := fixture.syncLogRepo.FindByID(context.Background(), fixture.pendingLog.ID)
	require.NoError(t, err)
	assert.Equal(t, "pending", pending.Status)
	running, err := fixture.syncLogRepo.FindByID(context.Background(), fixture.runningLog.ID)
	require.NoError(t, err)
	assert.Equal(t, types.SyncLogStatusRunning, running.Status)
}

func TestDeleteKnowledgeBaseCleansUpSQLiteDataSources(t *testing.T) {
	fixture := newSQLiteDataSourceDeleteFixture(t)
	kbRepo := &kbDeleteKBRepo{fakeKBRepo: *newFakeKBRepo()}
	kbRepo.rows[fixture.ds.KnowledgeBaseID] = &types.KnowledgeBase{
		ID:       fixture.ds.KnowledgeBaseID,
		TenantID: fixture.ds.TenantID,
		Name:     "SQLite delete",
	}
	svc := &knowledgeBaseService{
		repo:        kbRepo,
		asynqClient: kbDeleteTaskEnqueuer{},
		dsRepo:      fixture.dsRepo,
		syncLogRepo: fixture.syncLogRepo,
		dsScheduler: fixture.scheduler,
	}

	err := svc.DeleteKnowledgeBase(
		ctxWithTenantStorage(fixture.ds.TenantID, "local"),
		fixture.ds.KnowledgeBaseID,
	)
	require.NoError(t, err)
	assert.Equal(t, fixture.ds.KnowledgeBaseID, kbRepo.deletedID)

	_, err = fixture.dsRepo.FindByID(context.Background(), fixture.ds.ID)
	require.EqualError(t, err, "data source not found")
	var deleted types.DataSource
	require.NoError(t, fixture.db.Unscoped().First(&deleted, "id = ?", fixture.ds.ID).Error)
	assert.True(t, deleted.DeletedAt.Valid)
	assert.Equal(t, 0, fixture.scheduler.EntryCount())

	for _, logID := range []string{fixture.pendingLog.ID, fixture.runningLog.ID} {
		log, err := fixture.syncLogRepo.FindByID(context.Background(), logID)
		require.NoError(t, err)
		assert.Equal(t, types.SyncLogStatusCanceled, log.Status)
	}
}

func TestStreamHandlerSQLiteKeepsNewerIntentWhenAnotherRunFinishes(t *testing.T) {
	fixture := newSQLiteDataSourceDeleteFixture(t)
	ctx := context.Background()
	svc := &DataSourceService{dsRepo: fixture.dsRepo, syncLogRepo: fixture.syncLogRepo}
	first, err := fixture.dsRepo.FindByID(ctx, fixture.ds.ID)
	require.NoError(t, err)
	second, err := fixture.dsRepo.FindByID(ctx, fixture.ds.ID)
	require.NoError(t, err)
	firstHandler := newStreamHandler(svc, first, &types.SyncResult{}, fixture.runningLog)
	secondHandler := newStreamHandler(svc, second, &types.SyncResult{}, fixture.pendingLog)
	cursor := &types.SyncCursor{ConnectorCursor: map[string]interface{}{"applying": "original-native-intent"}}
	require.NoError(t, firstHandler.Checkpoint(ctx, cursor))
	confirmed := first.LastSyncCursor
	require.Error(t, secondHandler.Checkpoint(ctx, &types.SyncCursor{
		ConnectorCursor: map[string]interface{}{"applying": "competing-native-intent"},
	}))
	require.Empty(t, second.LastSyncCursor, "failed checkpoint must restore its own pre-write value")
	// The original error-finalization path uses the same native row fence. A
	// losing run cannot replace a newer retained cursor when reporting failure.
	require.Error(t, svc.updateSyncRunResult(ctx, second, fixture.pendingLog,
		&types.SyncResult{Failed: 1}, nil, types.SyncLogStatusFailed, "overlapping run", false))
	stored, err := fixture.dsRepo.FindByID(ctx, fixture.ds.ID)
	require.NoError(t, err)
	require.Equal(t, confirmed, stored.LastSyncCursor)
	require.Equal(t, types.DataSourceStatusActive, stored.Status)
	log, err := fixture.syncLogRepo.FindByID(ctx, fixture.pendingLog.ID)
	require.NoError(t, err)
	require.Equal(t, "pending", log.Status, "failed cursor persistence cannot publish a terminal sync log")
	require.NoError(t, firstHandler.Checkpoint(ctx, &types.SyncCursor{
		ConnectorCursor: map[string]interface{}{"groups": "original-ready-native-reference"},
	}))
}
