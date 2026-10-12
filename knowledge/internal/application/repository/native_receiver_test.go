package repository

import (
	"context"
	"encoding/json"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Tencent/WeKnora/internal/database"
	"github.com/Tencent/WeKnora/internal/datasource"
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// Explicitly opt in with an empty, isolated native database. An interrupted
// clean migration may resume only while every non-version table is empty.
// Unlike the SQLite checks below, this consumes the real PostgreSQL migrations and row
// locks; it does not AutoMigrate a substitute schema.
func TestNativeSyncRequestPostgresMigrationAndConcurrentHandoff(t *testing.T) {
	dsn := os.Getenv("KNOWLEDGE_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("requires an empty isolated KNOWLEDGE_TEST_DATABASE_URL")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })
	var tables []string
	require.NoError(t, db.Raw("SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> 'schema_migrations'").Scan(&tables).Error)
	for _, table := range tables {
		var rows int64
		require.NoError(t, db.Table(table).Count(&rows).Error)
		require.Zero(t, rows, "refuse an existing native or business database: %s", table)
	}
	t.Chdir("../../..")
	require.NoError(t, database.RunMigrations(dsn))
	version, dirty, known := database.CachedMigrationVersion()
	require.True(t, known)
	require.False(t, dirty)
	require.EqualValues(t, 107, version)
	up, err := os.ReadFile("migrations/versioned/000107_sync_request_identity.up.sql")
	require.NoError(t, err)
	down, err := os.ReadFile("migrations/versioned/000107_sync_request_identity.down.sql")
	require.NoError(t, err)
	require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return tx.Exec(string(down)).Error }))

	ctx := context.Background()
	sources, logs := NewDataSourceRepository(db), NewSyncLogRepository(db)
	binding, kb := uuid.NewString(), uuid.NewString()
	endpoint := &types.MCPEndpoint{ID: uuid.NewString(), TenantID: 31, Enabled: true,
		PlatformBindingID: binding, TokenHash: uuid.NewString(), KnowledgeBaseIDs: types.StringArray{kb}}
	require.NoError(t, db.Create(endpoint).Error)
	t.Cleanup(func() { require.NoError(t, db.Unscoped().Where("id = ?", endpoint.ID).Delete(&types.MCPEndpoint{}).Error) })
	source := &types.DataSource{ID: uuid.NewString(), TenantID: 31, Name: "isolated-receiver",
		KnowledgeBaseID: kb, Type: "file_storage", PlatformBindingID: binding,
		Status: types.DataSourceStatusActive, SyncLogRetentionDays: 1}
	require.NoError(t, sources.Create(ctx, source))
	t.Cleanup(func() {
		require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
			ownedLogs := tx.Model(&types.SyncLog{}).Select("id").Where("data_source_id = ?", source.ID)
			if err := tx.Where("dedup_key IN (?)", ownedLogs).Delete(&types.TaskPendingOp{}).Error; err != nil {
				return err
			}
			if err := tx.Where("data_source_id = ?", source.ID).Delete(&types.SyncLog{}).Error; err != nil {
				return err
			}
			return tx.Unscoped().Where("id = ?", source.ID).Delete(&types.DataSource{}).Error
		}))
	})
	// Retained pre-migration rows are independent facts, never assigned the
	// current binding, generation or request key by the migration.
	legacy := uuid.NewString()
	require.NoError(t, db.Exec("INSERT INTO sync_logs(id,data_source_id,tenant_id,status) VALUES (?,?,?,?)",
		legacy, source.ID, source.TenantID, types.SyncLogStatusSuccess).Error)
	require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return tx.Exec(string(up)).Error }))
	var retained struct {
		RequestKey      *string
		RequestIdentity *string
	}
	require.NoError(t, db.Raw("SELECT request_key, request_identity FROM sync_logs WHERE id=?", legacy).Scan(&retained).Error)
	require.Nil(t, retained.RequestKey)
	require.Nil(t, retained.RequestIdentity)
	require.Error(t, db.Exec("UPDATE sync_logs SET request_key=? WHERE id=?", uuid.NewString(), legacy).Error)
	// ManualSync obtains its source from the repository, not an unrounded
	// in-memory CreatedAt/UpdatedAt value from a PostgreSQL INSERT.
	source, err = sources.FindByID(ctx, source.ID)
	require.NoError(t, err)
	request := types.NativeSyncRequest{Key: uuid.NewString(), DataSourceID: source.ID, KnowledgeBaseID: kb,
		ResourceID: uuid.NewString(), ActionKey: "knowledge.sync_apply@v2", BindingID: binding, Generation: 9,
		PrincipalID: uuid.NewString(), OperationID: uuid.NewString(), ParameterHash: "frozen-request",
		ExpiresAt: time.Now().Add(time.Hour).UTC()}
	ctx = types.WithNativeSyncRequest(ctx, request)
	type admitted struct {
		log *types.SyncLog
		err error
	}
	start, results := make(chan struct{}), make(chan admitted, 2)
	for range 2 {
		go func() {
			<-start
			// Separate repository consumers share only the native PostgreSQL
			// transaction/endpoint lock, never a process-local admission lock.
			log, err := NewSyncLogRepository(db).CreatePending(ctx, source,
				&types.DataSourceSyncPayload{DataSourceID: source.ID, TenantID: source.TenantID, Trigger: "manual"})
			results <- admitted{log, err}
		}()
	}
	close(start)
	first, second := <-results, <-results
	require.NoError(t, first.err)
	require.NoError(t, second.err)
	require.Equal(t, first.log.ID, second.log.ID)
	require.NotEqual(t, first.log.RequestReplayed, second.log.RequestReplayed)
	var count int64
	require.NoError(t, db.Model(&types.SyncLog{}).Where("request_key=?", request.Key).Count(&count).Error)
	require.EqualValues(t, 1, count)
	require.NoError(t, db.Model(&types.TaskPendingOp{}).Where("dedup_key=?", first.log.ID).Count(&count).Error)
	require.EqualValues(t, 1, count)
	changed := request
	changed.Generation++
	_, err = logs.CreatePending(types.WithNativeSyncRequest(ctx, changed), source,
		&types.DataSourceSyncPayload{DataSourceID: source.ID, TenantID: source.TenantID, Trigger: "manual"})
	require.Error(t, err)
	require.Error(t, db.Transaction(func(tx *gorm.DB) error { return tx.Exec(string(down)).Error }),
		"rollback must not remove retained request ownership")
	var calls atomic.Int32
	start, dispatched := make(chan struct{}), make(chan error, 2)
	for range 2 {
		go func() {
			<-start
			dispatched <- NewSyncLogRepository(db).DispatchPending(ctx, first.log.ID, func(payload *types.DataSourceSyncPayload) error {
				calls.Add(1)
				if payload.SyncLogID != first.log.ID || payload.DataSourceID != source.ID {
					return datasource.ErrDataSourceInvalid
				}
				return nil
			})
		}()
	}
	close(start)
	require.NoError(t, <-dispatched)
	require.NoError(t, <-dispatched)
	require.EqualValues(t, 1, calls.Load(), "concurrent dispatchers must acknowledge only the original handoff")
	require.NoError(t, db.Model(&types.TaskPendingOp{}).Where("dedup_key=?", first.log.ID).Count(&count).Error)
	require.Zero(t, count)
	observed, err := NewSyncLogRepository(db).CreatePending(ctx, source,
		&types.DataSourceSyncPayload{DataSourceID: source.ID, TenantID: source.TenantID, Trigger: "manual"})
	require.NoError(t, err)
	require.True(t, observed.RequestReplayed)
	require.Equal(t, first.log.ID, observed.ID)
	require.Equal(t, types.SyncLogStatusRunning, observed.Status, "queue ACK is not batch completion")
}

func TestNativeReceiverCreateConsumesEndpointCutoffInWriteTransaction(t *testing.T) {
	for _, scenario := range []string{"open", "closed", "new-generation", "invalid-admission", "independent", "projection-missing", "native-clone"} {
		t.Run(scenario, func(t *testing.T) {
			db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			t.Cleanup(func() { _ = sqlDB.Close() })
			require.NoError(t, db.AutoMigrate(&types.MCPEndpoint{}, &types.Knowledge{}))
			binding, kb := uuid.NewString(), uuid.NewString()
			ep := &types.MCPEndpoint{ID: uuid.NewString(), TenantID: 31, Enabled: true, PlatformBindingID: binding, KnowledgeBaseIDs: types.StringArray{kb}}
			if scenario == "closed" || scenario == "new-generation" {
				ep.PlatformClosedGeneration = 4
			}
			if scenario != "projection-missing" {
				require.NoError(t, db.Create(ep).Error)
			}
			ctx := context.Background()
			generation := int64(4)
			if scenario == "new-generation" {
				generation = 5
			}
			if scenario == "invalid-admission" {
				generation = 0
			}
			if scenario != "independent" && scenario != "native-clone" {
				ctx = types.WithNativeReceiverAdmission(ctx, types.NativeReceiverAdmission{BindingID: binding, Generation: generation, TenantID: 31, KnowledgeBaseID: kb})
			}
			metadata, err := json.Marshal(map[string]string{"platform_receiver_binding_id": binding})
			require.NoError(t, err)
			if scenario == "independent" {
				metadata = []byte(`{}`)
			}
			document := &types.Knowledge{ID: uuid.NewString(), TenantID: 31, KnowledgeBaseID: kb, Metadata: types.JSON(metadata)}
			err = NewKnowledgeRepository(db).CreateKnowledge(ctx, document)
			var count int64
			require.NoError(t, db.Model(&types.Knowledge{}).Count(&count).Error)
			if scenario == "open" || scenario == "new-generation" || scenario == "independent" || scenario == "native-clone" {
				require.NoError(t, err)
				require.EqualValues(t, 1, count)
			} else {
				require.Error(t, err)
				require.Zero(t, count, "refusal must precede the native durable write")
			}
		})
	}
}

func TestNativeReceiverCutoffFencesOriginalSyncAdmissionAndHandoff(t *testing.T) {
	db := setupDataSourceRepoTestDB(t)
	require.NoError(t, db.AutoMigrate(&types.MCPEndpoint{}))
	binding, kb := uuid.NewString(), uuid.NewString()
	ep := &types.MCPEndpoint{ID: uuid.NewString(), TenantID: 31, Enabled: true, PlatformBindingID: binding, KnowledgeBaseIDs: types.StringArray{kb}}
	require.NoError(t, db.Create(ep).Error)
	source := &types.DataSource{ID: uuid.NewString(), TenantID: 31, KnowledgeBaseID: kb, Type: "file_storage", PlatformBindingID: binding, Status: types.DataSourceStatusActive}
	ctx := context.Background()
	sources, logs := NewDataSourceRepository(db), NewSyncLogRepository(db)
	require.NoError(t, sources.Create(ctx, source))
	log, err := logs.CreatePending(ctx, source, &types.DataSourceSyncPayload{DataSourceID: source.ID, TenantID: source.TenantID, Trigger: "manual"})
	require.NoError(t, err)
	require.NoError(t, db.Model(ep).UpdateColumn("platform_closed_generation", 4).Error)
	called := false
	require.Error(t, logs.DispatchPending(ctx, log.ID, func(*types.DataSourceSyncPayload) error { called = true; return nil }))
	require.False(t, called, "cutoff must prevent a delayed queue enqueue, not just refuse a new source")
	var count int64
	require.NoError(t, db.Model(&types.TaskPendingOp{}).Count(&count).Error)
	require.EqualValues(t, 1, count, "retain the original unresolved intent for observation")
	_, err = logs.CreatePending(ctx, source, &types.DataSourceSyncPayload{DataSourceID: source.ID, TenantID: source.TenantID, Trigger: "schedule"})
	require.ErrorContains(t, err, "scheduling is closed")
	other := *source
	other.ID = uuid.NewString()
	require.Error(t, sources.Create(ctx, &other))
	// Retained legacy sources are not silently assigned the current binding.
	legacy := *source
	legacy.ID, legacy.PlatformBindingID = uuid.NewString(), ""
	require.NoError(t, db.Create(&legacy).Error)
	_, err = logs.CreatePending(ctx, &legacy, &types.DataSourceSyncPayload{DataSourceID: legacy.ID, TenantID: legacy.TenantID, Trigger: "manual"})
	require.ErrorContains(t, err, "persisted binding")
	// Ordinary independent connector scheduling is unchanged by another binding.
	independent := *source
	independent.ID, independent.Type, independent.PlatformBindingID = uuid.NewString(), "rss", ""
	require.NoError(t, sources.Create(ctx, &independent))
	_, err = logs.CreatePending(ctx, &independent, &types.DataSourceSyncPayload{DataSourceID: independent.ID, TenantID: independent.TenantID, Trigger: "manual"})
	require.NoError(t, err)
}

func TestNativeReceiverMigrationDoesNotInferLegacyOwnershipOrDiscardCutoff(t *testing.T) {
	for _, retained := range []string{"none", "cutoff", "source"} {
		t.Run(retained, func(t *testing.T) {
			db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			t.Cleanup(func() { _ = sqlDB.Close() })
			require.NoError(t, db.Exec("CREATE TABLE mcp_endpoints (id TEXT PRIMARY KEY); CREATE TABLE data_sources (id TEXT PRIMARY KEY); INSERT INTO mcp_endpoints VALUES ('original'); INSERT INTO data_sources VALUES ('original')").Error)
			up, err := os.ReadFile("../../../migrations/sqlite/000026_mcp_binding_cutoff.up.sql")
			require.NoError(t, err)
			require.NoError(t, db.Exec(string(up)).Error)
			var cutoff int64
			var binding string
			require.NoError(t, db.Raw("SELECT platform_closed_generation FROM mcp_endpoints").Scan(&cutoff).Error)
			require.Zero(t, cutoff)
			require.NoError(t, db.Raw("SELECT platform_binding_id FROM data_sources").Scan(&binding).Error)
			require.Empty(t, binding)
			if retained == "cutoff" {
				require.NoError(t, db.Exec("UPDATE mcp_endpoints SET platform_closed_generation=4").Error)
			}
			if retained == "source" {
				require.NoError(t, db.Exec("UPDATE data_sources SET platform_binding_id=?", uuid.NewString()).Error)
			}
			down, err := os.ReadFile("../../../migrations/sqlite/000026_mcp_binding_cutoff.down.sql")
			require.NoError(t, err)
			err = db.Transaction(func(tx *gorm.DB) error { return tx.Exec(string(down)).Error })
			if retained == "none" {
				require.NoError(t, err)
			} else {
				require.Error(t, err)
			}
		})
	}
}

func TestNativeSyncRequestMigrationPreservesIndependentRunsAndRetainedOwnership(t *testing.T) {
	for _, retained := range []bool{false, true} {
		t.Run(map[bool]string{false: "independent", true: "retained-request"}[retained], func(t *testing.T) {
			db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			t.Cleanup(func() { _ = sqlDB.Close() })
			require.NoError(t, db.Exec("CREATE TABLE sync_logs (id TEXT PRIMARY KEY); INSERT INTO sync_logs VALUES ('legacy')").Error)
			up, err := os.ReadFile("../../../migrations/sqlite/000027_sync_request_identity.up.sql")
			require.NoError(t, err)
			require.NoError(t, db.Exec(string(up)).Error)
			var existing struct {
				RequestKey      *string
				RequestIdentity *string
			}
			require.NoError(t, db.Raw("SELECT request_key, request_identity FROM sync_logs WHERE id='legacy'").Scan(&existing).Error)
			require.Nil(t, existing.RequestKey)
			require.Nil(t, existing.RequestIdentity)
			require.Error(t, db.Exec("UPDATE sync_logs SET request_key='key'").Error, "half an identity cannot become admission")
			if retained {
				require.NoError(t, db.Exec("UPDATE sync_logs SET request_key='key', request_identity='{}'").Error)
				require.Error(t, db.Exec("INSERT INTO sync_logs VALUES ('duplicate','key','{}')").Error)
			}
			down, err := os.ReadFile("../../../migrations/sqlite/000027_sync_request_identity.down.sql")
			require.NoError(t, err)
			err = db.Transaction(func(tx *gorm.DB) error { return tx.Exec(string(down)).Error })
			if retained {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
			}
		})
	}
}
