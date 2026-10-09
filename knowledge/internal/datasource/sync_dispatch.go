package datasource

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/Tencent/WeKnora/internal/types"
	"github.com/Tencent/WeKnora/internal/types/interfaces"
	"github.com/hibiken/asynq"
)

// DispatchSync preserves the committed run identity on every handoff attempt.
// The queue's own retry budget and the original ProcessSync consumer remain
// authoritative; this only recovers delivery before a queue acknowledgement.
func DispatchSync(ctx context.Context, logs interfaces.SyncLogRepository, enqueuer interfaces.TaskEnqueuer, logID string) error {
	if enqueuer == nil || logs == nil {
		return errors.New("native sync queue is unavailable")
	}
	return logs.DispatchPending(ctx, logID, func(payload *types.DataSourceSyncPayload) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		body, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		taskID := "dssync:" + payload.SyncLogID
		info, err := enqueuer.Enqueue(asynq.NewTask(types.TypeDataSourceSync, body),
			asynq.Queue(types.QueueSync), asynq.MaxRetry(5), asynq.Timeout(2*time.Hour), asynq.TaskID(taskID))
		if errors.Is(err, asynq.ErrTaskIDConflict) {
			return nil // This exact durable run already has an Asynq owner.
		}
		if err != nil {
			return err
		}
		if info == nil || info.ID != taskID {
			return errors.New("native sync enqueue acknowledgement is incomplete")
		}
		return nil
	})
}
