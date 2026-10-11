package repository

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	"github.com/Tencent/WeKnora/internal/types"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

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
