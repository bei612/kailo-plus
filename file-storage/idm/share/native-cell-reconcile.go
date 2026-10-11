package share

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"sort"
	"time"

	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/client/commons/jobsc"
	jobproto "github.com/pydio/cells/v5/common/proto/jobs"
	jobstore "github.com/pydio/cells/v5/scheduler/jobs"
	"google.golang.org/protobuf/proto"
)

// ReconcileNativeCells observes the original create-only Task store. It never
// retries an ACL/Workspace RPC or fills a missing receipt from current state.
// The management-only ListJobs consumer propagates transaction/EOF errors and
// returns every historical generation of this binding, without user filtering.
func ReconcileNativeCells(ctx context.Context, delivery auth.NativeCellShareDelivery, fenced bool) ([]map[string]interface{}, error) {
	client := jobsc.JobServiceClient(ctx)
	stream, err := client.ListJobs(ctx, &jobproto.ListJobsRequest{JobIDs: []string{delivery.CellShare.NativeJobID}, LoadTasks: jobproto.TaskStatus_Any})
	if err != nil {
		return nil, err
	}
	tasks := map[string]*jobproto.Task{}
	var size int64
	seenJobs := map[string]bool{}
	found := false
	for {
		entry, err := stream.Recv()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		size += int64(proto.Size(entry))
		job := entry.GetJob()
		binding, generation, originErr := jobstore.NativeCellJobOrigin(job)
		if originErr != nil || binding != delivery.BindingID || generation > delivery.CellShare.BindingGeneration || seenJobs[job.GetID()] || (fenced && !job.GetInactive()) || size > delivery.MaxResponseBytes {
			return nil, nativeCellUnknown()
		}
		seenJobs[job.ID] = true
		if job.ID == delivery.CellShare.NativeJobID {
			if generation != delivery.CellShare.BindingGeneration {
				return nil, nativeCellUnknown()
			}
			found = true
		}
		for _, task := range job.Tasks {
			if task == nil || task.JobID != job.ID ||
				!auth.NativeActorUUID(task.ID) || task.TriggerOwner == "" || tasks[task.ID] != nil {
				return nil, nativeCellUnknown()
			}
			body, claimErr := jobstore.NativeCellTaskIntent(task)
			var origin struct {
				BindingID  string `json:"bindingId"`
				Generation int64  `json:"generation"`
			}
			if claimErr != nil || json.Unmarshal(body, &origin) != nil || origin.BindingID != binding || origin.Generation != generation {
				return nil, nativeCellUnknown()
			}
			tasks[task.ID] = task
		}
	}
	if !found {
		return nil, nativeCellUnknown()
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	return nativeCellObservations(tasks, delivery.BindingID, delivery.CellShare.BindingGeneration)
}

func nativeCellObservations(tasks map[string]*jobproto.Task, binding string, generation int64) ([]map[string]interface{}, error) {
	intents := map[string][]byte{}
	executions := map[string]string{}
	coordinators := map[string]string{}
	ids := make([]string, 0, len(tasks))
	for id, task := range tasks {
		body, err := jobstore.NativeCellTaskIntent(task)
		var intent nativeCellIntent
		decoder := json.NewDecoder(bytes.NewReader(body))
		decoder.DisallowUnknownFields()
		if err != nil || decoder.Decode(&intent) != nil || decoder.Decode(new(interface{})) != io.EOF ||
			intent.BindingID != binding || intent.Generation <= 0 || intent.Generation > generation ||
			!auth.NativeActorUUID(intent.NativeUserID) || !auth.NativeActorUUID(intent.ExecutionTaskID) || len(intent.Changes) == 0 {
			return nil, nativeCellUnknown()
		}
		intents[id], executions[id] = body, intent.ExecutionTaskID
		if id != intent.ExecutionTaskID {
			if coordinators[intent.ExecutionTaskID] != "" {
				return nil, nativeCellUnknown()
			}
			coordinators[intent.ExecutionTaskID] = id
		}
		ids = append(ids, id)
	}
	sort.Strings(ids)
	observations := make([]map[string]interface{}, 0, len(ids))
	now := time.Now().UTC()
	for _, id := range ids {
		task := tasks[id]
		otherID := executions[id]
		if otherID == id {
			otherID = coordinators[id]
		}
		other := tasks[otherID]
		terminal := other != nil && other.TriggerOwner == task.TriggerOwner && bytes.Equal(intents[id], intents[otherID]) &&
			nativeCellCompleted(task, intents[id]) && nativeCellCompleted(other, intents[otherID]) &&
			time.Unix(int64(task.EndTime), 0).Before(now)
		item := map[string]interface{}{"idempotencyKey": id, "nativeType": "job", "nativeId": id,
			"nativeStatus": task.Status.String(), "platformStatus": "UNKNOWN", "cancelCapability": "UNSUPPORTED",
			"lastObservedAt": now.Format(time.RFC3339Nano)}
		if terminal {
			item["platformStatus"] = "SUCCEEDED"
			item["terminalAt"] = time.Unix(int64(task.EndTime), 0).UTC().Format(time.RFC3339Nano)
		}
		observations = append(observations, item)
	}
	return observations, nil
}
