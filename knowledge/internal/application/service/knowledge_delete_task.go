package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/Tencent/WeKnora/internal/config"
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"
)

// A receipt is the original native task's result, not a second execution table.
// It is written only after conditional cleanup returned without an observed failure.
type knowledgeDeleteReceipt struct {
	TaskID          string    `json:"task_id"`
	TenantID        uint64    `json:"tenant_id"`
	KnowledgeBaseID string    `json:"knowledge_base_id"`
	KnowledgeID     string    `json:"knowledge_id"`
	Revision        string    `json:"revision"`
	WikiEnabled     bool      `json:"wiki_enabled"`
	CleanedAt       time.Time `json:"cleaned_at"`
}

// The existing Wiki tombstone also retains the native cleanup result. Its
// coordinates come from the admitted deletion task, never from an observer.
// Legacy "1" tombstones remain valid deletion guards but prove no completion.
type wikiDeleteReceipt struct {
	TaskID          string    `json:"task_id"`
	TenantID        uint64    `json:"tenant_id"`
	KnowledgeBaseID string    `json:"knowledge_base_id"`
	KnowledgeID     string    `json:"knowledge_id"`
	Revision        string    `json:"revision"`
	ExpiresAt       time.Time `json:"expires_at"`
	CompletedAt     time.Time `json:"completed_at,omitempty"`
	PageSlugs       []string  `json:"page_slugs,omitempty"`
	FolderIDs       []string  `json:"folder_ids,omitempty"`
}

type wikiDeleteTaskKey struct{}

func (r wikiDeleteReceipt) sameDeletion(other wikiDeleteReceipt) bool {
	return validDeleteTaskCoordinates(r.KnowledgeBaseID, r.KnowledgeID, r.Revision, r.TaskID) &&
		r.TenantID != 0 && !r.ExpiresAt.IsZero() && r.TaskID == other.TaskID &&
		r.TenantID == other.TenantID && r.KnowledgeBaseID == other.KnowledgeBaseID &&
		r.KnowledgeID == other.KnowledgeID && r.Revision == other.Revision && r.ExpiresAt.Equal(other.ExpiresAt)
}

func readWikiDeleteReceipt(ctx context.Context, client *redis.Client, expected wikiDeleteReceipt) (wikiDeleteReceipt, string, error) {
	if client == nil || !expected.sameDeletion(expected) || !time.Now().Before(expected.ExpiresAt) {
		return wikiDeleteReceipt{}, "", fmt.Errorf("native Wiki deletion receipt unavailable")
	}
	raw, err := client.Get(ctx, WikiDeletedTombstoneKey(expected.KnowledgeBaseID, expected.KnowledgeID)).Result()
	if err != nil {
		return wikiDeleteReceipt{}, "", err
	}
	var receipt wikiDeleteReceipt
	if json.Unmarshal([]byte(raw), &receipt) != nil || !receipt.sameDeletion(expected) ||
		(!receipt.CompletedAt.IsZero() && !receipt.CompletedAt.Before(receipt.ExpiresAt)) {
		return wikiDeleteReceipt{}, "", fmt.Errorf("native Wiki deletion receipt does not match the original task")
	}
	return receipt, raw, nil
}

func validDeleteTaskCoordinates(kbID, id, revision, taskID string) bool {
	key, err := uuid.Parse(taskID)
	return kbID != "" && id != "" && revision != "" && err == nil && key != uuid.Nil && key.String() == taskID
}

func (s *knowledgeService) StartKnowledgeDeleteTask(ctx context.Context, kbID, id, revision, taskID string) (map[string]any, error) {
	if !validDeleteTaskCoordinates(kbID, id, revision, taskID) || s.redisClient == nil || s.task == nil || s.config == nil || s.config.KnowledgeBase == nil || s.config.KnowledgeBase.DeleteReceiptRetention <= 0 {
		return nil, fmt.Errorf("durable conditional deletion is unavailable")
	}
	// A retained native operation wins over looking up a now-deleted document.
	inspector := asynq.NewInspectorFromRedisClient(s.redisClient)
	if _, err := inspector.GetTaskInfo(types.QueueMaintenance, taskID); err == nil {
		return s.ObserveKnowledgeDeleteTask(ctx, kbID, id, revision, taskID)
	} else if !errors.Is(err, asynq.ErrTaskNotFound) && !errors.Is(err, asynq.ErrQueueNotFound) {
		return nil, err
	}
	plan, err := s.planKnowledgeDelete(ctx, []string{id})
	if err != nil {
		return nil, err
	}
	if len(plan.knowledge) != 1 || plan.knowledge[0].KnowledgeBaseID != kbID || plan.knowledge[0].UpdatedAt.UTC().Format(time.RFC3339Nano) != revision {
		return nil, fmt.Errorf("conditional deletion target changed")
	}
	row := plan.knowledge[0]
	payload := types.KnowledgeListDeletePayload{TenantID: row.TenantID, KnowledgeBaseID: kbID, KnowledgeIDs: []string{id}, ExpectedRevision: revision, TaskID: taskID, Initiator: types.TaskInitiatorFromContext(ctx)}
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	// A prior inspector/plan read is not authorization for this first queue
	// write. Reapply the native KB grant and the admitted connector's original
	// RECEIVER grant at the actual dispatch boundary, not on task observation.
	if _, err := requireKBWrite(ctx, plan.kbs[kbID]); err != nil {
		return nil, err
	}
	if value := ctx.Value(fileStorageRunKey{}); value != nil {
		run, ok := value.(fileStorageRun)
		write, hasWrite := ctx.Value(fileStorageWriteKey{}).(*fileStorageWrite)
		if !ok || !hasWrite || write == nil || write.run != run || write.nativeID != id ||
			run.tenantID != row.TenantID || run.knowledgeBaseID != kbID ||
			run.dataSourceID != row.GetMetadata()["datasource_id"] || row.GetMetadata()["external_id"] == "" ||
			taskID != fileStorageKey(run.syncLogID, run.dataSourceID, row.GetMetadata()["external_id"], id, revision, "retire") ||
			len(write.grants) != 1 || write.grants[0] == nil || write.grants[0].key != taskID {
			return nil, fmt.Errorf("native retirement does not match its receiver execution")
		}
		if err := authorizeFileStorageWrite(ctx, row.TenantID, kbID, run.dataSourceID); err != nil {
			return nil, err
		}
	}
	_, err = s.task.Enqueue(asynq.NewTask(types.TypeKnowledgeListDelete, raw), asynq.Queue(types.QueueMaintenance), asynq.TaskID(taskID), asynq.MaxRetry(0), asynq.Timeout(config.DocumentProcessTimeout(s.config)), asynq.Retention(s.config.KnowledgeBase.DeleteReceiptRetention))
	if err != nil && !errors.Is(err, asynq.ErrTaskIDConflict) && !errors.Is(err, asynq.ErrDuplicateTask) {
		return nil, err
	}
	return s.ObserveKnowledgeDeleteTask(ctx, kbID, id, revision, taskID)
}

func (s *knowledgeService) ObserveKnowledgeDeleteTask(ctx context.Context, kbID, id, revision, taskID string) (map[string]any, error) {
	tenant, err := writeExecutionTenant(ctx)
	if err != nil {
		return nil, err
	}
	key, keyErr := uuid.Parse(taskID)
	if kbID == "" || keyErr != nil || key == uuid.Nil || key.String() != taskID || s.redisClient == nil {
		return nil, fmt.Errorf("durable deletion observation unavailable")
	}
	info, err := asynq.NewInspectorFromRedisClient(s.redisClient).GetTaskInfo(types.QueueMaintenance, taskID)
	if err != nil {
		return nil, err
	} // Expired or absent is UNKNOWN, never a request to re-enqueue.
	var payload types.KnowledgeListDeletePayload
	if info.Type != types.TypeKnowledgeListDelete || json.Unmarshal(info.Payload, &payload) != nil || payload.TenantID != tenant || payload.KnowledgeBaseID != kbID || payload.TaskID != taskID || len(payload.KnowledgeIDs) != 1 || payload.KnowledgeIDs[0] == "" || payload.ExpectedRevision == "" || (id != "" && payload.KnowledgeIDs[0] != id) || (revision != "" && payload.ExpectedRevision != revision) {
		return nil, fmt.Errorf("native deletion task does not match the admitted scope")
	}
	id, revision = payload.KnowledgeIDs[0], payload.ExpectedRevision
	result := map[string]any{"task_id": taskID, "knowledge_id": id, "knowledge_base_id": kbID, "native_revision": revision, "state": "UNKNOWN"}
	if len(info.Result) == 0 {
		switch info.State {
		case asynq.TaskStatePending, asynq.TaskStateActive, asynq.TaskStateScheduled, asynq.TaskStateRetry:
			result["state"] = "RUNNING"
		}
		return result, nil
	}
	var receipt knowledgeDeleteReceipt
	if json.Unmarshal(info.Result, &receipt) != nil || receipt.TaskID != taskID || receipt.TenantID != tenant || receipt.KnowledgeBaseID != kbID || receipt.KnowledgeID != id || receipt.Revision != revision || receipt.CleanedAt.IsZero() {
		return nil, fmt.Errorf("native deletion receipt is invalid")
	}
	if receipt.WikiEnabled {
		if s.taskPendingRepo == nil {
			return result, nil
		}
		pending, failed, err := s.taskPendingRepo.UnresolvedDocumentOps(ctx, tenant, wikiTaskType, wikiTaskScope, kbID, id)
		if err != nil {
			return nil, err
		}
		if failed != 0 {
			return result, nil
		}
		if pending != 0 {
			result["state"] = "RUNNING"
			return result, nil
		}
		// Queue absence alone is never terminal. Only the original Wiki worker
		// can finish the exact task/revision retained in its existing tombstone.
		raw, err := s.redisClient.Get(ctx, WikiDeletedTombstoneKey(kbID, id)).Result()
		if errors.Is(err, redis.Nil) {
			return result, nil
		}
		if err != nil {
			return nil, err
		}
		var expected wikiDeleteReceipt
		if json.Unmarshal([]byte(raw), &expected) != nil || expected.TaskID != taskID ||
			expected.TenantID != tenant || expected.KnowledgeBaseID != kbID || expected.KnowledgeID != id || expected.Revision != revision {
			return result, nil
		}
		wikiReceipt, _, err := readWikiDeleteReceipt(ctx, s.redisClient, expected)
		if err != nil || wikiReceipt.CompletedAt.IsZero() {
			return result, nil
		}
		if wikiReceipt.CompletedAt.After(receipt.CleanedAt) {
			receipt.CleanedAt = wikiReceipt.CompletedAt
		}
	}
	result["state"] = "SUCCEEDED"
	result["completed_at"] = receipt.CleanedAt.UTC().Format(time.RFC3339Nano)
	return result, nil
}
