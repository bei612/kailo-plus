package service

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/Tencent/WeKnora/internal/application/repository"
	"github.com/Tencent/WeKnora/internal/datasource"
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/Tencent/WeKnora/internal/types/interfaces"
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
