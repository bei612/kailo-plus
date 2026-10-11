package repository

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/Tencent/WeKnora/internal/types"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func validPendingDeletion(payload *types.KnowledgeListDeletePayload) bool {
	if payload == nil || payload.TenantID == 0 || payload.KnowledgeBaseID == "" ||
		len(payload.KnowledgeIDs) != 1 || payload.KnowledgeIDs[0] == "" || payload.ExpectedRevision == "" {
		return false
	}
	id, err := uuid.Parse(payload.TaskID)
	return err == nil && id != uuid.Nil && id.String() == payload.TaskID
}

// StageKnowledgeDeletion serializes a retry with the original KB and target
// row. This is a native queue intent, not permission to repeat a deletion.
func (r *taskPendingOpsRepository) StageKnowledgeDeletion(ctx context.Context, payload *types.KnowledgeListDeletePayload) error {
	if !validPendingDeletion(payload) {
		return errors.New("native deletion intent has invalid coordinates")
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var kb types.KnowledgeBase
		if err := tx.Select("id").Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND tenant_id = ?", payload.KnowledgeBaseID, payload.TenantID).Take(&kb).Error; err != nil {
			return err
		}
		var prior types.TaskPendingOp
		err := tx.Where("task_type = ? AND dedup_key = ?", types.TypeKnowledgeListDelete, payload.TaskID).Take(&prior).Error
		if err == nil {
			var original types.KnowledgeListDeletePayload
			if json.Unmarshal(prior.Payload, &original) != nil || !validPendingDeletion(&original) ||
				prior.TenantID != payload.TenantID || prior.Scope != types.TaskScopeKnowledgeBase ||
				prior.ScopeID != payload.KnowledgeBaseID || prior.Op != "delete" ||
				original.TenantID != payload.TenantID || original.KnowledgeBaseID != payload.KnowledgeBaseID ||
				original.TaskID != payload.TaskID || original.KnowledgeIDs[0] != payload.KnowledgeIDs[0] ||
				original.ExpectedRevision != payload.ExpectedRevision {
				return errors.New("native deletion identity conflicts with its original intent")
			}
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		var target types.Knowledge
		if err := tx.Select("id", "updated_at").Clauses(clause.Locking{Strength: "SHARE"}).
			Where("id = ? AND tenant_id = ? AND knowledge_base_id = ?", payload.KnowledgeIDs[0], payload.TenantID, payload.KnowledgeBaseID).
			Take(&target).Error; err != nil {
			return err
		}
		if target.UpdatedAt.UTC().Format(time.RFC3339Nano) != payload.ExpectedRevision {
			return errors.New("native deletion target changed before durable handoff")
		}
		return tx.Create(&types.TaskPendingOp{TenantID: payload.TenantID, TaskType: types.TypeKnowledgeListDelete,
			Scope: types.TaskScopeKnowledgeBase, ScopeID: payload.KnowledgeBaseID, Op: "delete",
			DedupKey: payload.TaskID, Payload: body, EnqueuedAt: time.Now().UTC()}).Error
	})
}

// VisitKnowledgeDeletions traverses a bounded native queue snapshot. A
// transport error keeps the original payload and increments the backlog count.
// A confirmed handoff is remembered: later queue absence is not re-execution
// authority. The knowledge service retires rows only after original native
// completion observation, outside this queue transaction.
func (r *taskPendingOpsRepository) VisitKnowledgeDeletions(ctx context.Context, taskID string,
	visit func(*types.TaskPendingOp, *types.KnowledgeListDeletePayload) (bool, error),
) error {
	if visit == nil {
		return errors.New("native deletion queue consumer is unavailable")
	}
	query := func(db *gorm.DB) *gorm.DB {
		q := db.Model(&types.TaskPendingOp{}).Where("task_type = ? AND scope = ? AND op = ?", types.TypeKnowledgeListDelete, types.TaskScopeKnowledgeBase, "delete")
		if taskID != "" {
			q = q.Where("dedup_key = ?", taskID)
		}
		return q
	}
	var end int64
	if err := query(r.db.WithContext(ctx)).Select("COALESCE(MAX(id), 0)").Scan(&end).Error; err != nil {
		return err
	}
	var after int64
	var failures error
	for after < end {
		var next types.TaskPendingOp
		if err := query(r.db.WithContext(ctx)).Where("id > ? AND id <= ?", after, end).Order("id").First(&next).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				break
			}
			return errors.Join(failures, err)
		}
		after = next.ID
		var deliveryErr error
		err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			// Keep the same KB-before-operation lock order as the producer.
			var kb types.KnowledgeBase
			if err := tx.Unscoped().Select("id", "deleted_at").Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("id = ? AND tenant_id = ?", next.ScopeID, next.TenantID).Take(&kb).Error; err != nil {
				return err
			}
			var op types.TaskPendingOp
			if err := query(tx).Clauses(clause.Locking{Strength: "UPDATE"}).First(&op, "id = ?", next.ID).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return nil
				}
				return err
			}
			var payload types.KnowledgeListDeletePayload
			if json.Unmarshal(op.Payload, &payload) != nil || !validPendingDeletion(&payload) ||
				op.TenantID != payload.TenantID || op.ScopeID != payload.KnowledgeBaseID || op.DedupKey != payload.TaskID ||
				op.EnqueuedAt.IsZero() || op.EnqueuedAt.After(time.Now()) {
				return errors.New("native deletion pending evidence is invalid")
			}
			if kb.DeletedAt.Valid && op.ClaimedAt == nil {
				return errors.New("deleted native scope cannot dispatch a deletion")
			}
			acknowledged, err := visit(&op, &payload)
			deliveryErr = err
			if acknowledged && op.ClaimedAt == nil {
				now := time.Now().UTC()
				if err := tx.Model(&op).UpdateColumn("claimed_at", now).Error; err != nil {
					return err
				}
			}
			if deliveryErr != nil {
				return tx.Model(&op).UpdateColumn("fail_count", gorm.Expr("fail_count + 1")).Error
			}
			return nil
		})
		if failures == nil {
			failures = errors.Join(err, deliveryErr)
		}
		if ctx.Err() != nil {
			return errors.Join(failures, ctx.Err())
		}
	}
	return failures
}
