package repository

import (
	"errors"

	"github.com/Tencent/WeKnora/internal/types"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Lock the original endpoint projection in the same transaction as the real
// native write. Reconcile takes these locks in this order before installing
// its cutoff; a PEP response obtained before that cutoff cannot bypass it.
func lockNativeReceiverAdmission(tx *gorm.DB, tenant uint64, kb string) error {
	admission, present := types.NativeReceiverAdmissionFromContext(tx.Statement.Context)
	if !present {
		return nil
	}
	id, err := uuid.Parse(admission.BindingID)
	if err != nil || id == uuid.Nil || id.String() != admission.BindingID ||
		admission.Generation <= 0 || admission.TenantID != tenant || admission.KnowledgeBaseID != kb {
		return errors.New("native receiver transaction lacks its fresh frozen admission")
	}
	var endpoints []types.MCPEndpoint
	if err := tx.Unscoped().Clauses(clause.Locking{Strength: "UPDATE"}).Where("tenant_id = ? AND platform_binding_id = ?", tenant, admission.BindingID).
		Order("id").Find(&endpoints).Error; err != nil {
		return err
	}
	if len(endpoints) == 0 {
		return errors.New("native receiver binding projection is unavailable")
	}
	for _, endpoint := range endpoints {
		if endpoint.DeletedAt.Valid || !endpoint.Enabled || len(endpoint.KnowledgeBaseIDs) != 1 || endpoint.KnowledgeBaseIDs[0] != kb ||
			endpoint.PlatformClosedGeneration >= admission.Generation {
			return errors.New("native receiver binding generation is closed or its scope changed")
		}
	}
	return nil
}

// Native cron/manual scheduling has no frozen receiver generation yet. Once a
// disable cutoff exists it cannot use current configuration to reopen ingress.
// This lock is taken before the source lock, as for receiver document writes.
func lockNativeReceiverSchedule(tx *gorm.DB, source *types.DataSource) error {
	if source.Type != "file_storage" && source.PlatformBindingID == "" {
		return nil
	}
	id, err := uuid.Parse(source.PlatformBindingID)
	if err != nil || id == uuid.Nil || id.String() != source.PlatformBindingID {
		return errors.New("native receiver source lacks its persisted binding")
	}
	var endpoints []types.MCPEndpoint
	if err := tx.Unscoped().Clauses(clause.Locking{Strength: "UPDATE"}).Where("tenant_id = ? AND platform_binding_id = ?", source.TenantID, source.PlatformBindingID).
		Order("id").Find(&endpoints).Error; err != nil {
		return err
	}
	if len(endpoints) == 0 {
		return errors.New("native receiver binding projection is unavailable")
	}
	for _, endpoint := range endpoints {
		if endpoint.DeletedAt.Valid || !endpoint.Enabled || len(endpoint.KnowledgeBaseIDs) != 1 || endpoint.KnowledgeBaseIDs[0] != source.KnowledgeBaseID || endpoint.PlatformClosedGeneration != 0 {
			return errors.New("native receiver scheduling is closed or its scope changed")
		}
	}
	return nil
}
