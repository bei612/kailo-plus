package repository

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Tencent/WeKnora/internal/config"
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func modelDeliveryFixture(t *testing.T) (*gorm.DB, *config.Config, *types.Model, map[string]any) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	require.NoError(t, db.AutoMigrate(&types.Model{}))
	model := &types.Model{ID: uuid.NewString(), TenantID: 42, Name: "fixture-route", Source: types.ModelSourceRemote,
		Type: types.ModelTypeEmbedding, Status: types.ModelStatusActive,
		Parameters: types.ModelParameters{BaseURL: "https://gateway.example.test/v1", Provider: "generic", APIKey: "synthetic-key"}}
	require.NoError(t, db.Create(model).Error)
	route := uuid.NewString()
	input := map[string]any{
		"projection": map[string]any{"bindingId": uuid.NewString(), "gatewayPrincipalId": uuid.NewString(),
			"generation": 1, "configDigest": strings.Repeat("ab", 32), "nativeScopeRef": "42",
			"routeResourceIds": []string{route}, "routes": []map[string]any{{"resourceId": route, "nativeId": model.Name}}},
		"models": []map[string]any{{"routeResourceId": route, "nativeModelRef": model.ID, "baseUrl": model.Parameters.BaseURL}},
	}
	cfg := &config.Config{ModelDeliveryInputFile: filepath.Join(t.TempDir(), "model-delivery.json")}
	writeModelDelivery(t, cfg.ModelDeliveryInputFile, input)
	return db, cfg, model, input
}

func writeModelDelivery(t *testing.T, path string, input map[string]any) {
	t.Helper()
	raw, err := json.Marshal(input)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(path, raw, 0600))
}

func TestPlatformModelDeliveryProtectsOriginalRowAndCredentials(t *testing.T) {
	db, cfg, original, _ := modelDeliveryFixture(t)
	repo, err := NewModelRepository(db, cfg)
	require.NoError(t, err)
	ctx := context.Background()
	current, err := repo.GetByID(ctx, original.TenantID, original.ID)
	require.NoError(t, err)
	require.Equal(t, platformModelManagedBy, current.ManagedBy)
	for name, change := range map[string]func(*types.Model){
		"endpoint":       func(m *types.Model) { m.Parameters.BaseURL = "https://other.example.test/v1" },
		"source":         func(m *types.Model) { m.Source = types.ModelSourceLocal },
		"type":           func(m *types.Model) { m.Type = types.ModelTypeKnowledgeQA },
		"provider":       func(m *types.Model) { m.Parameters.Provider = "aliyun" },
		"name":           func(m *types.Model) { m.Name = "another-route" },
		"headers":        func(m *types.Model) { m.Parameters.CustomHeaders = map[string]string{"X-Route": "other"} },
		"extra-config":   func(m *types.Model) { m.Parameters.ExtraConfig = map[string]string{"endpoint": "other"} },
		"ownership":      func(m *types.Model) { m.ManagedBy = "" },
		"cloud-fallback": func(m *types.Model) { m.Parameters.AppID = "cloud" },
	} {
		t.Run(name, func(t *testing.T) {
			changed := *current
			change(&changed)
			require.Error(t, repo.Update(ctx, &changed))
			again, err := repo.GetByID(ctx, original.TenantID, original.ID)
			require.NoError(t, err)
			require.Equal(t, original.Parameters.APIKey, again.Parameters.APIKey)
			require.Equal(t, original.Parameters.BaseURL, again.Parameters.BaseURL)
		})
	}
	rotated := "rotated-synthetic-key"
	_, err = repo.UpdateCredentials(ctx, original.TenantID, original.ID, &rotated, nil)
	require.NoError(t, err)
	current.DisplayName = "native display edit"
	require.NoError(t, repo.Update(ctx, current), "stale display edit must retain the concurrently rotated key")
	current, err = repo.GetByID(ctx, original.TenantID, original.ID)
	require.NoError(t, err)
	require.Equal(t, "rotated-synthetic-key", current.Parameters.APIKey)
	require.Equal(t, "native display edit", current.DisplayName)
	empty := ""
	_, err = repo.UpdateCredentials(ctx, original.TenantID, original.ID, &empty, nil)
	require.NoError(t, err, "explicit credential removal is still supported")
	require.Error(t, repo.Delete(ctx, original.TenantID, original.ID))
}

func TestPlatformModelDeliveryMissingMappingDoesNotDowngrade(t *testing.T) {
	for _, failure := range []string{"removed-file", "missing-path", "removed-model", "different-scope", "changed-route", "changed-endpoint"} {
		t.Run(failure, func(t *testing.T) {
			db, cfg, model, input := modelDeliveryFixture(t)
			repo, err := NewModelRepository(db, cfg)
			require.NoError(t, err)
			current, err := repo.GetByID(context.Background(), model.TenantID, model.ID)
			require.NoError(t, err)
			switch failure {
			case "removed-file":
				require.NoError(t, os.Remove(cfg.ModelDeliveryInputFile))
			case "missing-path":
				repo, err = NewModelRepository(db, &config.Config{})
				require.NoError(t, err)
			case "removed-model":
				input["models"].([]map[string]any)[0]["nativeModelRef"] = uuid.NewString()
				writeModelDelivery(t, cfg.ModelDeliveryInputFile, input)
			case "different-scope":
				input["projection"].(map[string]any)["nativeScopeRef"] = "43"
				writeModelDelivery(t, cfg.ModelDeliveryInputFile, input)
			case "changed-route":
				input["projection"].(map[string]any)["routes"].([]map[string]any)[0]["nativeId"] = "other"
				writeModelDelivery(t, cfg.ModelDeliveryInputFile, input)
			case "changed-endpoint":
				input["models"].([]map[string]any)[0]["baseUrl"] = "https://other.example.test/v1"
				writeModelDelivery(t, cfg.ModelDeliveryInputFile, input)
			}
			_, err = repo.GetByID(context.Background(), model.TenantID, model.ID)
			require.Error(t, err, "the actual model construction path must reject drift")
			current.Parameters.APIKey = "replacement"
			require.Error(t, repo.Update(context.Background(), current), "credential rotation cannot rescue missing route evidence")
			_, err = repo.UpdateCredentials(context.Background(), model.TenantID, model.ID, &current.Parameters.APIKey, nil)
			require.Error(t, err)
		})
	}
}

func TestPlatformModelDeliveryRejectsUnsafeFirstCredentialDestination(t *testing.T) {
	for name, change := range map[string]func(*types.Model){
		"local":       func(m *types.Model) { m.Source = types.ModelSourceLocal },
		"auto-detect": func(m *types.Model) { m.Parameters.Provider = "" },
		"provider":    func(m *types.Model) { m.Parameters.Provider = "aliyun" },
		"headers":     func(m *types.Model) { m.Parameters.CustomHeaders = map[string]string{"X-Destination": "other"} },
		"builtin":     func(m *types.Model) { m.IsBuiltin = true },
		"scope":       func(m *types.Model) { m.TenantID++ },
	} {
		t.Run(name, func(t *testing.T) {
			db, cfg, model, _ := modelDeliveryFixture(t)
			change(model)
			require.NoError(t, db.Save(model).Error)
			_, err := NewModelRepository(db, cfg)
			require.Error(t, err)
			var stored types.Model
			require.NoError(t, db.Where("id = ?", model.ID).Take(&stored).Error)
			require.Empty(t, stored.ManagedBy, "a failed projection cannot partially claim the row")
		})
	}
}

func TestPlatformModelDeliveryIndependentModelsRemainNative(t *testing.T) {
	db, _, model, _ := modelDeliveryFixture(t)
	repo, err := NewModelRepository(db, &config.Config{})
	require.NoError(t, err)
	model.Parameters.BaseURL = "https://independent.example.test/v1"
	model.Parameters.Provider = "openai"
	require.NoError(t, repo.Update(context.Background(), model))
	stored, err := repo.GetByID(context.Background(), model.TenantID, model.ID)
	require.NoError(t, err)
	require.Equal(t, model.Parameters.BaseURL, stored.Parameters.BaseURL)
	require.Empty(t, stored.ManagedBy)
	key, secret := "independent-rotated-key", "independent-rotated-secret"
	_, err = repo.UpdateCredentials(context.Background(), model.TenantID, model.ID, nil, &secret)
	require.NoError(t, err)
	_, err = repo.UpdateCredentials(context.Background(), model.TenantID, model.ID, &key, nil)
	require.NoError(t, err)
	model.DisplayName = "stale ordinary edit"
	require.NoError(t, repo.Update(context.Background(), model))
	stored, err = repo.GetByID(context.Background(), model.TenantID, model.ID)
	require.NoError(t, err)
	require.Equal(t, key, stored.Parameters.APIKey)
	require.Equal(t, secret, stored.Parameters.AppSecret, "changing one credential cannot overwrite another from an old snapshot")
	require.NoError(t, repo.Delete(context.Background(), model.TenantID, model.ID))
	require.Error(t, repo.Update(context.Background(), model), "stale updates must not resurrect deleted model rows")
}

func TestPlatformModelDeliveryUnchangedCredentialRetainsBuiltinOwnership(t *testing.T) {
	db, _, model, _ := modelDeliveryFixture(t)
	model.IsBuiltin = true
	model.ManagedBy = types.BuiltinModelManagedBy
	require.NoError(t, db.Save(model).Error)
	repo, err := NewModelRepository(db, &config.Config{})
	require.NoError(t, err)
	stored, err := repo.UpdateCredentials(context.Background(), model.TenantID, model.ID, &model.Parameters.APIKey, nil)
	require.NoError(t, err)
	require.Equal(t, types.BuiltinModelManagedBy, stored.ManagedBy, "repeating the same value is not a runtime override")
	empty := ""
	stored, err = repo.UpdateCredentials(context.Background(), model.TenantID, model.ID, nil, &empty)
	require.NoError(t, err)
	require.Equal(t, types.BuiltinModelManagedBy, stored.ManagedBy, "clearing an already absent field is a no-op")
	rotated := "changed-builtin-key"
	stored, err = repo.UpdateCredentials(context.Background(), model.TenantID, model.ID, &rotated, nil)
	require.NoError(t, err)
	require.Empty(t, stored.ManagedBy, "an actual credential change retains the native YAML override semantics")
}
