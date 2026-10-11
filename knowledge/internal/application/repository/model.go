package repository

import (
	"context"
	"errors"
	"reflect"

	"github.com/Tencent/WeKnora/internal/config"
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/Tencent/WeKnora/internal/types/interfaces"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// modelRepository implements the model repository interface
type modelRepository struct {
	db                     *gorm.DB
	modelDeliveryInputFile string
}

// NewModelRepository creates a new model repository
func NewModelRepository(db *gorm.DB, cfg *config.Config) (interfaces.ModelRepository, error) {
	r := &modelRepository{db: db, modelDeliveryInputFile: cfg.ModelDeliveryInputFile}
	if err := r.initializeModelDelivery(context.Background()); err != nil {
		return nil, err
	}
	return r, nil
}

// Create creates a new model
func (r *modelRepository) Create(ctx context.Context, m *types.Model) error {
	if m.ManagedBy == platformModelManagedBy {
		return errPlatformModelDelivery
	}
	return r.db.WithContext(ctx).Create(m).Error
}

// GetByID retrieves a model by ID
func (r *modelRepository) GetByID(ctx context.Context, tenantID uint64, id string) (*types.Model, error) {
	var m types.Model
	if err := r.db.WithContext(ctx).Where("id = ?", id).Where(
		"(tenant_id = ? OR is_builtin = true)", tenantID,
	).First(&m).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	if err := r.validateModelDelivery(&m); err != nil {
		return nil, err
	}
	if err := r.validateKnowledgeModel(ctx, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

// List lists models with optional filtering
func (r *modelRepository) List(
	ctx context.Context, tenantID uint64, modelType types.ModelType, source types.ModelSource,
) ([]*types.Model, error) {
	var models []*types.Model
	query := r.db.WithContext(ctx).Where(
		"(tenant_id = ? OR is_builtin = true)", tenantID,
	)

	if modelType != "" {
		query = query.Where("type = ?", modelType)
	}

	if source != "" {
		query = query.Where("source = ?", source)
	}

	if err := query.Find(&models).Error; err != nil {
		return nil, err
	}

	return models, nil
}

// Update updates a model
func (r *modelRepository) Update(ctx context.Context, m *types.Model) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var current types.Model
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where(
			"id = ? AND tenant_id = ?", m.ID, m.TenantID,
		).Take(&current).Error; err != nil {
			return err
		}
		if err := r.validateModelDelivery(&current); err != nil {
			return err
		}
		// Ordinary settings never own credentials. Preserve the values read
		// under this lock, not the stale values fetched by the HTTP handler.
		m.Parameters.APIKey = current.Parameters.APIKey
		m.Parameters.AppSecret = current.Parameters.AppSecret
		if current.ManagedBy == platformModelManagedBy {
			if m.ManagedBy != platformModelManagedBy {
				return errPlatformModelDelivery
			}
			if err := r.validateModelDelivery(m); err != nil {
				return err
			}
			// A normal settings save may not change the delivered execution
			// configuration, but display metadata retains its native behavior.
			before, after := current.Parameters, m.Parameters
			before.APIKey, after.APIKey = "", ""
			if current.Name != m.Name || current.Type != m.Type || current.Source != m.Source ||
				current.IsBuiltin != m.IsBuiltin || !reflect.DeepEqual(before, after) {
				return errPlatformModelDelivery
			}
		} else if m.ManagedBy == platformModelManagedBy {
			return errPlatformModelDelivery
		}
		// No Debug(): this write includes the original credential JSON.
		return tx.Model(&types.Model{}).Where("id = ? AND tenant_id = ?", m.ID, m.TenantID).
			Select("*").Updates(m).Error
	})
}

func (r *modelRepository) UpdateCredentials(
	ctx context.Context, tenantID uint64, id string, apiKey, appSecret *string,
) (*types.Model, error) {
	var current types.Model
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where(
			"id = ? AND tenant_id = ?", id, tenantID,
		).Take(&current).Error; err != nil {
			return err
		}
		// Validate the current destination before any platform key is written;
		// independent native models remain managed by their original API.
		if err := r.validateModelDelivery(&current); err != nil {
			return err
		}
		changed := false
		if apiKey != nil && *apiKey != current.Parameters.APIKey {
			current.Parameters.APIKey = *apiKey
			changed = true
		}
		if appSecret != nil && *appSecret != current.Parameters.AppSecret {
			current.Parameters.AppSecret = *appSecret
			changed = true
		}
		if err := r.validateModelDelivery(&current); err != nil {
			return err
		}
		if !changed {
			return nil
		}
		if current.IsBuiltin {
			current.ManagedBy = ""
		}
		return tx.Model(&current).Updates(map[string]any{
			"parameters": current.Parameters, "managed_by": current.ManagedBy,
		}).Error
	})
	if err != nil {
		return nil, err
	}
	return &current, nil
}

// Delete deletes a model
func (r *modelRepository) Delete(ctx context.Context, tenantID uint64, id string) error {
	// Retain the native ownership row even when its controlled delivery is
	// removed. Deletion cannot erase the evidence and recreate an independent
	// model with the same identifier while old native jobs still reference it.
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var current types.Model
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where(
			"id = ? AND tenant_id = ?", id, tenantID,
		).Take(&current).Error; err != nil {
			return err
		}
		if current.ManagedBy == platformModelManagedBy {
			return errPlatformModelDelivery
		}
		return tx.Delete(&current).Error
	})
}

// ClearDefaultByType clears the default flag for all models of a specific type
// This is a batch operation that updates all matching records in one query
func (r *modelRepository) ClearDefaultByType(
	ctx context.Context,
	tenantID uint,
	modelType types.ModelType,
	excludeID string,
) error {
	query := r.db.WithContext(ctx).Model(&types.Model{}).Where(
		"tenant_id = ? AND type = ? AND is_default = ?", tenantID, modelType, true,
	)

	// If excludeID is provided, exclude that model from the update
	if excludeID != "" {
		query = query.Where("id != ?", excludeID)
	}

	// Batch update: set is_default to false for all matching records
	return query.Update("is_default", false).Error
}
