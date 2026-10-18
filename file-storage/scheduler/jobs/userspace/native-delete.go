package userspace

import (
	"context"
	"encoding/json"
	"fmt"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/anypb"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/auth/claim"
	"github.com/pydio/cells/v5/common/broker"
	"github.com/pydio/cells/v5/common/client/commons/jobsc"
	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/nodes"
	"github.com/pydio/cells/v5/common/nodes/compose"
	"github.com/pydio/cells/v5/common/proto/jobs"
	"github.com/pydio/cells/v5/common/proto/service"
	"github.com/pydio/cells/v5/common/proto/tree"
	jobstore "github.com/pydio/cells/v5/scheduler/jobs"
)

// The original coordinator retains only immutable references. Each fresh call
// exchanges those references for a short ticket without persisting the ticket.
type nativeDeleteExecution struct {
	task     *jobs.Task
	children int
	nodes    map[string]string
}

func (e *nativeDeleteExecution) fresh(ctx context.Context) error {
	return jobstore.NativeDeleteFresh(ctx, e.task, false)
}

// Only the first immutable claim dispatches the original scheduler coordinator.
// Lost claim/job/broker ACKs are observation-only, never a second dispatch.
func DeleteNodesGoverned(ctx context.Context, delivery auth.NativeDeleteDelivery, key string, claims, input map[string]interface{}) (*jobs.Task, error) {
	current, valid := claim.FromContext(ctx)
	if !valid || !auth.NativeActorUUID(key) || claims["idempotency_key"] != key || claims["action_key"] != "file_storage.delete@v2" {
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
		intent, intentErr := jobstore.NativeWriteTaskIntent(existing)
		if intentErr != nil {
			return nil, intentErr
		}
		if intent.NativeTask != nil {
			expected, err = jobstore.NewNativeDeleteTask(delivery, key, current.Name, current.Subject, claims, input)
			if err != nil {
				return nil, err
			}
		}
		if existing.TriggerOwner != current.Name || !jobstore.NativeWriteTaskMatches(existing, delivery.BindingID, current.Subject, claims) || len(existing.ActionsLogs) == 0 || !proto.Equal(existing.ActionsLogs[0], expected.ActionsLogs[0]) {
			return nil, errors.WithStack(errors.StatusConflict)
		}
		return existing, nil
	}
	expected, err = jobstore.NewNativeDeleteTask(delivery, key, current.Name, current.Subject, claims, input)
	if err != nil {
		return nil, err
	}
	stored, err := client.PutTask(ctx, &jobs.PutTaskRequest{Task: expected, StatusMeta: map[string]string{jobstore.TaskCreateOnly: "true"}})
	if err != nil || !proto.Equal(stored.GetTask(), expected) {
		return nil, errors.WithStack(errors.StatusConflict)
	}
	coordinator := &jobs.Job{ID: expected.JobID + "-" + key + "-coordinate", Owner: current.Name, Label: expected.JobID,
		Metadata: map[string]string{jobstore.NativeDeleteJob: expected.JobID, jobstore.NativeDeleteTask: key, jobstore.NativeDeleteCoordinator: "true"},
		Actions:  []*jobs.Action{{ID: "actions.tree.delete", Parameters: map[string]string{"scope": "owner", jobstore.NativeDeleteCoordinator: "true"}}}}
	digest, err := jobstore.NativeJobDefinitionDigest(coordinator)
	if err != nil {
		return expected, err
	}
	encoded, err := json.Marshal(map[string]string{"jobId": coordinator.ID, "taskId": coordinator.ID, "jobDigest": digest})
	if err != nil {
		return expected, err
	}
	expected.ActionsLogs = append(expected.ActionsLogs, &jobs.ActionLog{OutputMessage: &jobs.ActionMessage{OutputChain: []*jobs.ActionOutput{{JsonBody: encoded, Vars: map[string]string{jobstore.NativeDeleteCoordinator: "true"}}}}})
	stored, err = client.PutTask(ctx, &jobs.PutTaskRequest{Task: expected})
	if err != nil || !proto.Equal(stored.GetTask(), expected) {
		return expected, errors.WithStack(errors.StatusConflict)
	}
	saved, err := client.PutJob(ctx, &jobs.PutJobRequest{Job: coordinator})
	if err != nil || saved.GetJob() == nil {
		return expected, errors.WithStack(errors.StatusConflict)
	}
	savedDigest, err := jobstore.NativeJobDefinitionDigest(saved.Job)
	if err != nil || savedDigest != digest {
		return expected, errors.WithStack(errors.StatusConflict)
	}
	err = broker.Publish(ctx, common.TopicTimerEvent, &jobs.JobTriggerEvent{JobID: coordinator.ID, RunNow: true, RunTaskId: coordinator.ID})
	return expected, err
}

// Invoked solely by the original claimed scheduler action after fresh admission.
func RunNativeDeleteCoordinator(ctx context.Context, job *jobs.Job, router nodes.Client) error {
	if claimed, _ := ctx.Value(jobstore.ClaimedTaskContextKey{}).(bool); !claimed {
		return errors.WithStack(errors.StatusForbidden)
	}
	task, err := jobstore.NativeDeleteDispatchTask(ctx, job)
	if err != nil || task == nil || job.Metadata[jobstore.NativeDeleteCoordinator] != "true" {
		return errors.WithStack(errors.StatusForbidden)
	}
	intent, err := jobstore.NativeWriteTaskIntent(task)
	if err != nil {
		return err
	}
	selected, ok := intent.InputReference["nativeObjectRefs"].([]interface{})
	permanent, valid := intent.InputReference["removePermanently"].(bool)
	if !ok || !valid || len(selected) == 0 {
		return errors.WithStack(errors.StatusForbidden)
	}
	run := &nativeDeleteExecution{task: task, nodes: map[string]string{}}
	paths := make([]string, 0, len(selected))
	for _, value := range selected {
		id, ok := value.(string)
		if !ok || !auth.NativeActorUUID(id) {
			return errors.WithStack(errors.StatusForbidden)
		}
		read, err := compose.UuidClient().ReadNode(ctx, &tree.ReadNodeRequest{Node: &tree.Node{Uuid: id}})
		if err != nil || read.GetNode().GetUuid() != id || read.Node.Path == "" {
			return errors.WithStack(errors.StatusForbidden)
		}
		paths = append(paths, read.Node.Path)
		run.nodes[read.Node.Path] = id
	}
	if err := run.fresh(ctx); err != nil {
		return err
	}
	if _, err := deleteNodesTask(ctx, router, paths, permanent, run); err != nil {
		return err
	}
	task.ActionsLogs = append(task.ActionsLogs, &jobs.ActionLog{OutputMessage: &jobs.ActionMessage{OutputChain: []*jobs.ActionOutput{{Success: true, Vars: map[string]string{jobstore.NativeDeleteDispatchComplete: "true"}}}}})
	stored, err := jobsc.JobServiceClient(ctx).PutTask(ctx, &jobs.PutTaskRequest{Task: task})
	if err != nil || !proto.Equal(stored.GetTask(), task) {
		return errors.WithStack(errors.StatusConflict)
	}
	return nil
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
		if action.Parameters == nil {
			action.Parameters = map[string]string{}
		}
		action.Parameters["scope"] = "owner"
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
