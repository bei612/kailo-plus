package userspace

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/anypb"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/auth/claim"
	"github.com/pydio/cells/v5/common/broker"
	"github.com/pydio/cells/v5/common/client/commons/jobsc"
	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/nodes"
	"github.com/pydio/cells/v5/common/proto/jobs"
	"github.com/pydio/cells/v5/common/proto/service"
	"github.com/pydio/cells/v5/common/proto/tree"
	jobstore "github.com/pydio/cells/v5/scheduler/jobs"
)

// This request-local state holds the already admitted proof. The original
// native Task, not this value, owns the immutable first-dispatch claim. No
// credential is copied into Job parameters, broker messages or Task logs.
type nativeDeleteExecution struct {
	delivery         auth.NativeDeleteDelivery
	token, arguments string
	claims, target   map[string]interface{}
	task             *jobs.Task
	children         int
	nodes            map[string]string
}

func (e *nativeDeleteExecution) fresh(ctx context.Context) error {
	claims, target, err := e.delivery.AuthorizeAction(ctx, e.token, e.arguments)
	before, beforeErr := json.Marshal([]interface{}{e.claims, e.target})
	after, afterErr := json.Marshal([]interface{}{claims, target})
	if err != nil || beforeErr != nil || afterErr != nil || string(before) != string(after) {
		return errors.WithStack(errors.StatusForbidden)
	}
	return nil
}

// DeleteNodesGoverned reuses both original recycle and permanent-delete jobs.
// A prior claim is observation-only, including a lost claim/PutJob ACK. The
// first durable Task precedes DeleteNodesTask's recycle metadata writes.
func DeleteNodesGoverned(ctx context.Context, router nodes.Client, paths []string, permanently bool,
	delivery auth.NativeDeleteDelivery, token, arguments, key string, claims, target, input map[string]interface{}, languages ...string) (*jobs.Task, error) {
	current, valid := claim.FromContext(ctx)
	if !valid || len(paths) == 0 || !auth.NativeActorUUID(key) || claims["idempotency_key"] != key || claims["action_key"] != "file_storage.delete@v1" {
		return nil, errors.WithStack(errors.StatusForbidden)
	}
	client := jobsc.JobServiceClient(ctx)
	job, err := client.GetJob(ctx, &jobs.GetJobRequest{JobID: delivery.Delete.NativeJobID})
	if err != nil || !jobstore.NativeReadJobMatches(job.GetJob(), delivery.Delete.NativeJobID) {
		return nil, errors.WithStack(errors.StatusForbidden)
	}
	expected, err := jobstore.NewNativeWriteTask(delivery.BindingID, delivery.Delete.NativeJobID, key, current.Name, current.Subject, claims, input)
	if err != nil {
		return nil, err
	}
	existing, err := jobstore.ReadNativeWriteTask(ctx, delivery.Delete.NativeJobID, key, delivery.MaxResponseBytes)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		if !jobstore.NativeWriteTaskMatches(existing, delivery.BindingID, current.Subject, claims) || len(existing.ActionsLogs) == 0 || !proto.Equal(existing.ActionsLogs[0], expected.ActionsLogs[0]) {
			return nil, errors.WithStack(errors.StatusConflict)
		}
		return existing, nil
	}
	selected, selectedOK := input["nativeObjectRefs"].([]interface{})
	if !selectedOK || len(selected) != len(paths) {
		return nil, errors.WithStack(errors.StatusForbidden)
	}
	run := &nativeDeleteExecution{delivery: delivery, token: token, arguments: arguments, claims: claims, target: target, task: expected, nodes: map[string]string{}}
	for i, value := range selected {
		id, ok := value.(string)
		if !ok || !auth.NativeActorUUID(id) || paths[i] == "" {
			return nil, errors.WithStack(errors.StatusForbidden)
		}
		run.nodes[paths[i]] = id
	}
	if err := run.fresh(ctx); err != nil {
		return nil, err
	}
	response, err := client.PutTask(ctx, &jobs.PutTaskRequest{Task: expected, StatusMeta: map[string]string{jobstore.TaskCreateOnly: "true"}})
	if err != nil || !proto.Equal(response.GetTask(), expected) {
		return nil, errors.WithStack(errors.StatusConflict)
	}
	expected.Status, expected.StartTime = jobs.TaskStatus_Running, int32(time.Now().Unix())
	response, err = client.PutTask(ctx, &jobs.PutTaskRequest{Task: expected})
	if err != nil || !proto.Equal(response.GetTask(), expected) {
		return nil, errors.WithStack(errors.StatusConflict)
	}
	// Errors after claim are deliberately not converted into a successful
	// deletion or a permission to dispatch a new operation on the next request.
	if _, err := deleteNodesTask(ctx, router, paths, permanently, run, languages...); err != nil {
		return expected, err
	}
	// This marker proves that every planned original Job was submitted, not
	// that any Job has completed. Observation still requires native terminals.
	expected.ActionsLogs = append(expected.ActionsLogs, &jobs.ActionLog{OutputMessage: &jobs.ActionMessage{OutputChain: []*jobs.ActionOutput{{Success: true, Vars: map[string]string{"nativeDeleteDispatchComplete": "true"}}}}})
	response, err = client.PutTask(ctx, &jobs.PutTaskRequest{Task: expected})
	if err != nil || !proto.Equal(response.GetTask(), expected) {
		return expected, errors.WithStack(errors.StatusConflict)
	}
	return expected, nil
}

func putDeleteJob(ctx context.Context, client jobs.JobServiceClient, job *jobs.Job, execution *nativeDeleteExecution) (*jobs.PutJobResponse, error) {
	if execution == nil {
		return client.PutJob(ctx, &jobs.PutJobRequest{Job: job})
	}
	if err := execution.fresh(ctx); err != nil {
		return nil, err
	}
	// Use the same native job definition/runner, with a deterministic child
	// reference and the existing create-only RunTaskId. AutoStart would lose
	// that reference and permit an unclaimed scheduler dispatch.
	job.ID = fmt.Sprintf("%s-%s-%d", execution.task.JobID, execution.task.ID, execution.children)
	job.AutoStart, job.AutoClean = false, false
	job.Metadata = map[string]string{jobstore.NativeDeleteJob: execution.task.JobID, jobstore.NativeDeleteTask: execution.task.ID}
	// The original selector supports UUIDs. Freeze identity rather than let a
	// delayed job delete a replacement that happens to reuse the same path.
	for _, action := range job.Actions {
		selector := action.GetNodesSelector()
		if selector == nil {
			return nil, errors.WithStack(errors.StatusConflict)
		}
		paths := selector.Pathes
		if selector.Query != nil {
			if len(selector.Query.SubQueries) != 1 {
				return nil, errors.WithStack(errors.StatusConflict)
			}
			query := new(tree.Query)
			if selector.Query.SubQueries[0].UnmarshalTo(query) != nil {
				return nil, errors.WithStack(errors.StatusConflict)
			}
			paths = query.Paths
		}
		ids := make([]string, 0, len(paths))
		for _, path := range paths {
			id := execution.nodes[path]
			if id == "" {
				return nil, errors.WithStack(errors.StatusConflict)
			}
			ids = append(ids, id)
		}
		if len(ids) == 0 {
			return nil, errors.WithStack(errors.StatusConflict)
		}
		query, err := anypb.New(&tree.Query{UUIDs: ids})
		if err != nil {
			return nil, err
		}
		action.NodesSelector = &jobs.NodesSelector{Query: &service.Query{SubQueries: []*anypb.Any{query}}}
	}
	execution.children++
	digest, err := jobstore.NativeJobDefinitionDigest(job)
	if err != nil {
		return nil, err
	}
	// Native Task IDs are globally unique across Jobs. The coordinator keeps
	// the original platform key; each frozen child uses its deterministic Job
	// reference rather than trying to claim that same key a second time.
	encoded, err := json.Marshal(map[string]string{"jobId": job.ID, "taskId": job.ID, "jobDigest": digest})
	if err != nil {
		return nil, err
	}
	execution.task.ActionsLogs = append(execution.task.ActionsLogs, &jobs.ActionLog{OutputMessage: &jobs.ActionMessage{OutputChain: []*jobs.ActionOutput{{JsonBody: encoded, Vars: map[string]string{"nativeDeleteJob": "true"}}}}})
	stored, err := client.PutTask(ctx, &jobs.PutTaskRequest{Task: execution.task})
	if err != nil || !proto.Equal(stored.GetTask(), execution.task) {
		return nil, errors.WithStack(errors.StatusConflict)
	}
	if err := execution.fresh(ctx); err != nil {
		return nil, err
	}
	response, err := client.PutJob(ctx, &jobs.PutJobRequest{Job: job})
	if err != nil || response.GetJob() == nil {
		return nil, errors.WithStack(errors.StatusConflict)
	}
	actual := proto.Clone(response.Job).(*jobs.Job)
	actual.CreatedAt, actual.ModifiedAt = job.CreatedAt, job.ModifiedAt
	if !proto.Equal(actual, job) {
		return nil, errors.WithStack(errors.StatusConflict)
	}
	if err := execution.fresh(ctx); err != nil {
		return nil, err
	}
	if err := broker.Publish(ctx, common.TopicTimerEvent, &jobs.JobTriggerEvent{JobID: job.ID, RunNow: true, RunTaskId: job.ID}); err != nil {
		return nil, err
	}
	return response, nil
}
