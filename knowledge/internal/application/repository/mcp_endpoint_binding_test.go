package repository

import (
	"context"
	"os"
	"testing"

	"github.com/Tencent/WeKnora/internal/types"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestMCPEndpointSettingsCannotReplaceRetainedBinding(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	require.NoError(t, db.AutoMigrate(&types.MCPEndpoint{}))
	endpoint := &types.MCPEndpoint{ID: uuid.NewString(), TenantID: 29, Name: "native", Enabled: true}
	repo := NewMCPEndpointRepository(db)
	require.NoError(t, repo.Create(context.Background(), endpoint))
	binding := uuid.NewString()
	require.NoError(t, db.Model(endpoint).UpdateColumn("platform_binding_id", binding).Error)
	endpoint.PlatformBindingID = uuid.NewString()
	endpoint.Name = "renamed"
	require.NoError(t, repo.Update(context.Background(), endpoint))
	current, err := repo.GetByID(context.Background(), endpoint.ID)
	require.NoError(t, err)
	require.Equal(t, binding, current.PlatformBindingID)
	require.Equal(t, "renamed", current.Name)
	require.NoError(t, repo.Update(context.Background(), current), "an unchanged existing row remains a successful update")
	current.Name = ""
	current.Enabled = false
	require.NoError(t, repo.Update(context.Background(), current))
	current, err = repo.GetByID(context.Background(), endpoint.ID)
	require.NoError(t, err)
	require.Empty(t, current.Name)
	require.False(t, current.Enabled, "zero-value fields must not be omitted by struct Updates")
	require.Equal(t, binding, current.PlatformBindingID)
	require.NoError(t, repo.Delete(context.Background(), endpoint.TenantID, endpoint.ID))
	require.ErrorIs(t, repo.Update(context.Background(), endpoint), gorm.ErrRecordNotFound)
	current, err = repo.GetByID(context.Background(), endpoint.ID)
	require.NoError(t, err)
	require.Nil(t, current, "a stale settings save cannot resurrect a deleted binding credential")
}

func TestMCPEndpointBindingMigrationRetainsIndependentRowsAndRefusesEvidenceLoss(t *testing.T) {
	for _, retained := range []bool{false, true} {
		t.Run(map[bool]string{false: "independent", true: "bound"}[retained], func(t *testing.T) {
			db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(1)
			t.Cleanup(func() { _ = sqlDB.Close() })
			require.NoError(t, db.Exec("CREATE TABLE mcp_endpoints (id TEXT PRIMARY KEY)").Error)
			require.NoError(t, db.Exec("INSERT INTO mcp_endpoints(id) VALUES ('native')").Error)
			up, err := os.ReadFile("../../../migrations/sqlite/000025_mcp_binding_ownership.up.sql")
			require.NoError(t, err)
			require.NoError(t, db.Exec(string(up)).Error)
			var binding string
			require.NoError(t, db.Raw("SELECT platform_binding_id FROM mcp_endpoints WHERE id='native'").Scan(&binding).Error)
			require.Empty(t, binding, "migration must not infer a legacy endpoint's binding")
			if retained {
				require.NoError(t, db.Exec("UPDATE mcp_endpoints SET platform_binding_id=?", uuid.NewString()).Error)
			}
			down, err := os.ReadFile("../../../migrations/sqlite/000025_mcp_binding_ownership.down.sql")
			require.NoError(t, err)
			err = db.Transaction(func(tx *gorm.DB) error { return tx.Exec(string(down)).Error })
			if retained {
				require.Error(t, err)
				require.NoError(t, db.Raw("SELECT platform_binding_id FROM mcp_endpoints WHERE id='native'").Scan(&binding).Error)
				require.NotEmpty(t, binding)
			} else {
				require.NoError(t, err)
			}
		})
	}
}
