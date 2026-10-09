package router

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Tencent/WeKnora/internal/types"
	"github.com/hibiken/asynq"
)

func TestSyncTaskExecutorInjectsRetryMetadata(t *testing.T) {
	executor := NewSyncTaskExecutor()
	observed := make(chan [2]int, 1)
	executor.RegisterHandler("test:retry-metadata", func(ctx context.Context, _ *asynq.Task) error {
		retried, maxRetry, ok := types.TaskRetryMetadataFromContext(ctx)
		if !ok {
			observed <- [2]int{-1, -1}
			return nil
		}
		observed <- [2]int{retried, maxRetry}
		return nil
	})

	task := asynq.NewTask("test:retry-metadata", nil)
	if _, err := executor.Enqueue(task, asynq.MaxRetry(3)); err != nil {
		t.Fatalf("enqueue: %v", err)
	}

	select {
	case got := <-observed:
		if got != [2]int{0, 3} {
			t.Fatalf("retry metadata = %v, want [0 3]", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for sync task")
	}
}

func TestSyncTaskExecutorRefusesDurableDataSourceHandoffBeforeDispatch(t *testing.T) {
	executor := NewSyncTaskExecutor()
	var dispatched atomic.Int32
	executor.RegisterHandler(types.TypeDataSourceSync, func(context.Context, *asynq.Task) error {
		dispatched.Add(1)
		return nil
	})
	task := asynq.NewTask(types.TypeDataSourceSync, []byte(`{"data_source_id":"source","tenant_id":1,"sync_log_id":"original"}`))
	for range 2 {
		info, err := executor.Enqueue(task, asynq.TaskID("dssync:original"), asynq.MaxRetry(0))
		if err == nil || info != nil {
			t.Fatalf("durable handoff acknowledged by Lite executor: info=%v error=%v", info, err)
		}
	}
	// Rejection must not disable the original, unrelated Lite dispatch path.
	accepted := make(chan struct{})
	executor.RegisterHandler("test:lite-barrier", func(context.Context, *asynq.Task) error {
		close(accepted)
		return nil
	})
	if _, err := executor.Enqueue(asynq.NewTask("test:lite-barrier", nil), asynq.MaxRetry(0)); err != nil {
		t.Fatalf("original unkeyed Lite task: %v", err)
	}
	select {
	case <-accepted:
	case <-time.After(2 * time.Second):
		t.Fatal("original Lite dispatch did not finish")
	}
	if got := dispatched.Load(); got != 0 {
		t.Fatalf("rejected stable handoff dispatched %d handler(s)", got)
	}
}

func TestSyncTaskExecutorPreservesOriginalNonDurableCalls(t *testing.T) {
	for _, tc := range []struct {
		name    string
		typeKey string
		opts    []asynq.Option
	}{
		{"unkeyed-data-source", types.TypeDataSourceSync, nil},
		{"other-keyed-native-task", types.TypeWikiFinalize, []asynq.Option{asynq.TaskID("original-native-trigger")}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			executor := NewSyncTaskExecutor()
			observed := make(chan struct{})
			executor.RegisterHandler(tc.typeKey, func(context.Context, *asynq.Task) error {
				close(observed)
				return nil
			})
			info, err := executor.Enqueue(asynq.NewTask(tc.typeKey, nil), append(tc.opts, asynq.MaxRetry(0))...)
			if err != nil || info == nil || info.ID == "" || info.Type != tc.typeKey {
				t.Fatalf("original Lite call rejected: info=%v error=%v", info, err)
			}
			select {
			case <-observed:
			case <-time.After(2 * time.Second):
				t.Fatal("original Lite handler did not run")
			}
		})
	}
}
