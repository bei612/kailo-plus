package router

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/Tencent/WeKnora/internal/types"
	"github.com/alicebob/miniredis/v2"
	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
)

func TestIsAsynqQueueNotFound(t *testing.T) {
	internalQueueNotFound := errors.New(`NOT_FOUND: queue "default" does not exist`)
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{name: "nil", err: nil, want: false},
		{name: "public sentinel", err: asynq.ErrQueueNotFound, want: true},
		{name: "wrapped public sentinel", err: fmt.Errorf("inspect queue: %w", asynq.ErrQueueNotFound), want: true},
		{name: "internal queue error", err: internalQueueNotFound, want: true},
		{name: "wrapped internal queue error", err: fmt.Errorf("inspect queue: %w", internalQueueNotFound), want: true},
		{name: "task not found", err: errors.New(`NOT_FOUND: task "default" does not exist`), want: false},
		{name: "different code", err: errors.New(`UNKNOWN: queue "default" does not exist`), want: false},
		{name: "different reason", err: errors.New(`NOT_FOUND: queue "default" is unavailable`), want: false},
		{name: "empty queue name", err: errors.New(`NOT_FOUND: queue "" does not exist`), want: false},
		{name: "trailing context", err: errors.New(`NOT_FOUND: queue "default" does not exist: retry later`), want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isAsynqQueueNotFound(tt.err); got != tt.want {
				t.Fatalf("isAsynqQueueNotFound(%v) = %v, want %v", tt.err, got, tt.want)
			}
		})
	}
}

func TestQueueStateHasMatchPreservesUnknown(t *testing.T) {
	probeErr := errors.New("queue probe unavailable")
	cases := []struct {
		name string
		err  error
	}{
		{name: "backend error", err: probeErr},
		{name: "public missing queue", err: asynq.ErrQueueNotFound},
		{name: "native missing queue", err: errors.New(`NOT_FOUND: queue "default" does not exist`)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			matched, err := (&asynqTaskInspector{}).queueStateHasMatch(
				context.Background(), types.QueueDefault, "pending",
				func(string, ...asynq.ListOption) ([]*asynq.TaskInfo, error) { return nil, tc.err },
				func(string, []byte) bool { return true },
			)
			require.False(t, matched)
			if tc.err == probeErr {
				require.ErrorIs(t, err, probeErr)
			} else {
				require.NoError(t, err)
			}
		})
	}

	t.Run("later page error", func(t *testing.T) {
		calls := 0
		matched, err := (&asynqTaskInspector{}).queueStateHasMatch(
			context.Background(), types.QueueDefault, "pending",
			func(string, ...asynq.ListOption) ([]*asynq.TaskInfo, error) {
				calls++
				if calls == 1 {
					tasks := make([]*asynq.TaskInfo, listPageSize)
					for i := range tasks {
						tasks[i] = &asynq.TaskInfo{}
					}
					return tasks, nil
				}
				return nil, probeErr
			}, func(string, []byte) bool { return false },
		)
		require.False(t, matched)
		require.ErrorIs(t, err, probeErr)
		require.Equal(t, 2, calls)
	})

	t.Run("cancelled context", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		matched, err := (&asynqTaskInspector{}).queueStateHasMatch(
			ctx, types.QueueDefault, "pending",
			func(string, ...asynq.ListOption) ([]*asynq.TaskInfo, error) {
				t.Fatal("cancelled probe must not read the backend")
				return nil, nil
			}, func(string, []byte) bool { return false },
		)
		require.False(t, matched)
		require.ErrorIs(t, err, context.Canceled)
	})
}

func TestTaskLivenessProbeDoesNotInventAbsence(t *testing.T) {
	server := miniredis.RunT(t)
	redisClient := redis.NewClient(&redis.Options{Addr: server.Addr()})
	inspector := NewAsynqTaskInspector(asynq.NewInspectorFromRedisClient(redisClient), redisClient)
	queued, err := inspector.HasQueuedTasksForKnowledge(context.Background(), "knowledge")
	require.False(t, queued)
	require.NoError(t, err, "a confirmed missing queue remains absent")
	queued, err = inspector.HasQueuedDeleteTasksForKnowledge(context.Background(), "knowledge")
	require.False(t, queued)
	require.NoError(t, err)

	client := asynq.NewClientFromRedisClient(redisClient)
	t.Cleanup(func() { _ = client.Close() })
	enqueueTask(t, client, types.TypeDocumentProcess, `{"knowledge_id":"knowledge"}`, "parse-liveness")
	enqueueTask(t, client, types.TypeKnowledgeListDelete, `{"knowledge_ids":["knowledge"]}`, "delete-liveness")
	queued, err = inspector.HasQueuedTasksForKnowledge(context.Background(), "knowledge")
	require.True(t, queued)
	require.NoError(t, err)
	queued, err = inspector.HasQueuedDeleteTasksForKnowledge(context.Background(), "knowledge")
	require.True(t, queued)
	require.NoError(t, err)
	require.NoError(t, redisClient.Close())

	for _, probe := range []struct {
		name string
		call func(context.Context, string) (bool, error)
	}{
		{name: "parse", call: inspector.HasQueuedTasksForKnowledge},
		{name: "delete", call: inspector.HasQueuedDeleteTasksForKnowledge},
	} {
		t.Run(probe.name, func(t *testing.T) {
			queued, err := probe.call(context.Background(), "knowledge")
			require.False(t, queued)
			require.Error(t, err, "backend failure is not proof that the native task is absent")
		})
	}

	unavailable := NewAsynqTaskInspector(nil, nil)
	queued, err = unavailable.HasQueuedTasksForKnowledge(context.Background(), "knowledge")
	require.False(t, queued)
	require.Error(t, err)
	queued, err = unavailable.HasQueuedDeleteTasksForKnowledge(context.Background(), "knowledge")
	require.False(t, queued)
	require.Error(t, err)
	missingRedis := NewAsynqTaskInspector(asynq.NewInspectorFromRedisClient(redisClient), nil)
	queued, err = missingRedis.HasQueuedTasksForKnowledge(context.Background(), "knowledge")
	require.False(t, queued)
	require.Error(t, err)

	lite := NewNoopTaskInspector()
	queued, err = lite.HasQueuedTasksForKnowledge(context.Background(), "knowledge")
	require.False(t, queued)
	require.NoError(t, err, "explicit Lite wiring is the existing no-queue fact")
	queued, err = lite.HasQueuedDeleteTasksForKnowledge(context.Background(), "knowledge")
	require.False(t, queued)
	require.NoError(t, err)
}

func TestMatchesKnowledgeListDelete(t *testing.T) {
	const payload = `{"knowledge_base_id":"kb-1","tenant_id":7,"knowledge_ids":["kid-a","kid-b"]}`
	cases := []struct {
		name     string
		taskType string
		payload  string
		kid      string
		want     bool
	}{
		{"covered id", types.TypeKnowledgeListDelete, payload, "kid-a", true},
		{"last id", types.TypeKnowledgeListDelete, payload, "kid-b", true},
		{"uncovered id", types.TypeKnowledgeListDelete, payload, "kid-c", false},
		{"other task type", types.TypeDocumentProcess, payload, "kid-a", false},
		{"bad json", types.TypeKnowledgeListDelete, "{", "kid-a", false},
		{"empty list", types.TypeKnowledgeListDelete, `{"knowledge_ids":[]}`, "kid-a", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			require.Equal(t, tc.want, matchesKnowledgeListDelete(tc.taskType, []byte(tc.payload), tc.kid))
		})
	}
}
