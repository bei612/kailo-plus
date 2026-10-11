package jobs

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"path"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	"github.com/pydio/cells/v5/common/client/commons/jobsc"
	"github.com/pydio/cells/v5/common/errors"
	jobproto "github.com/pydio/cells/v5/common/proto/jobs"
	"github.com/pydio/cells/v5/common/proto/tree"
)

const NativeNodeMutationResult = "nativeNodeMutationResult"
const NativeDeleteJob = "nativeDeleteJob"
const NativeDeleteDispatchComplete = "nativeDeleteDispatchComplete"
const NativeDeleteTask = "nativeDeleteTask"

// These existing Job metadata references identify an immutable admitted
// execution, including incomplete metadata which must never downgrade it.
func IsNativeDeleteJob(job *jobproto.Job) bool {
	_, coordinator := job.GetMetadata()[NativeDeleteJob]
	_, operation := job.GetMetadata()[NativeDeleteTask]
	return coordinator || operation
}

// A frozen native claim proves attribution, not fresh execution permission.
// Until the delayed worker can authorize that same platform execution, refuse
// managed children at both Queue and RunAction. Independent native jobs retain
// their original execution path; historical managed tasks remain observable.
func AuthorizeNativeDeleteDispatch(job *jobproto.Job) error {
	if IsNativeDeleteJob(job) {
		return errors.WithMessage(errors.StatusForbidden, "managed deletion lacks delayed execution authority")
	}
	return nil
}

// NativeJobDefinitionDigest excludes only service-assigned timestamps and
// loaded task projections. Selectors, original actions and owner remain bound.
func NativeJobDefinitionDigest(job *jobproto.Job) (string, error) {
	if job == nil {
		return "", errors.WithStack(errors.StatusConflict)
	}
	frozen := proto.Clone(job).(*jobproto.Job)
	frozen.CreatedAt, frozen.ModifiedAt, frozen.Tasks = 0, 0, nil
	data, err := proto.MarshalOptions{Deterministic: true}.Marshal(frozen)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:]), nil
}

// NativeDeleteTerminal reads the existing coordinator and original child
// Tasks. It cannot derive success from absence, an empty selector, dispatch,
// or Finished alone. Missing/partial evidence remains UNKNOWN to its caller.
func NativeDeleteTerminal(ctx context.Context, task *jobproto.Task, limit int64) (int32, error) {
	refused := errors.WithStack(errors.StatusConflict)
	intent, err := NativeWriteTaskIntent(task)
	if err != nil || intent.Scope["action_key"] != "file_storage.delete@v1" {
		return 0, refused
	}
	selected, ok := intent.InputReference["nativeObjectRefs"].([]interface{})
	permanent, permanentOK := intent.InputReference["removePermanently"].(bool)
	if !ok || !permanentOK || len(selected) == 0 {
		return 0, refused
	}
	wanted := make(map[string]bool, len(selected))
	for _, value := range selected {
		id, valid := value.(string)
		if !valid || id == "" || wanted[id] {
			return 0, refused
		}
		wanted[id] = true
	}
	complete := false
	children := make(map[string]string)
	for _, log := range task.ActionsLogs {
		for _, output := range log.GetOutputMessage().GetOutputChain() {
			if output.GetVars()[NativeDeleteDispatchComplete] == "true" {
				if complete || !output.Success {
					return 0, refused
				}
				complete = true
			}
			if output.GetVars()[NativeDeleteJob] != "true" {
				continue
			}
			var reference struct {
				JobID     string `json:"jobId"`
				TaskID    string `json:"taskId"`
				JobDigest string `json:"jobDigest"`
			}
			if json.Unmarshal(output.JsonBody, &reference) != nil || reference.JobID == "" || reference.TaskID != reference.JobID || len(reference.JobDigest) != sha256.Size*2 || children[reference.JobID] != "" {
				return 0, refused
			}
			children[reference.JobID] = reference.JobDigest
		}
	}
	// A crash after the last broker ACK may precede the coordinator's
	// dispatch-complete write. That marker is not a native terminal: the
	// frozen children and their exact per-node ACKs below prove completion
	// independently. Without full coverage the operation remains UNKNOWN.
	if len(children) == 0 {
		return 0, refused
	}
	acknowledged := make(map[string]bool, len(wanted))
	var completedAt int32
	client := jobsc.JobServiceClient(ctx)
	for jobID, digest := range children {
		definition, err := client.GetJob(ctx, &jobproto.GetJobRequest{JobID: jobID})
		if err != nil {
			return 0, err
		}
		job := definition.GetJob()
		actualDigest, err := NativeJobDefinitionDigest(job)
		if err != nil || actualDigest != digest || job.Owner != task.TriggerOwner || len(job.Actions) != 1 {
			return 0, refused
		}
		action := job.Actions[0]
		isDelete := action.ID == "actions.tree.delete"
		if !isDelete && (action.ID != "actions.tree.copymove" || action.Parameters["type"] != "move" || permanent) {
			return 0, refused
		}
		selector := action.GetNodesSelector()
		if selector.GetQuery() == nil || len(selector.Query.SubQueries) != 1 {
			return 0, refused
		}
		query := new(tree.Query)
		if selector.Query.SubQueries[0].UnmarshalTo(query) != nil || len(query.UUIDs) == 0 {
			return 0, refused
		}
		expected := make(map[string]bool, len(query.UUIDs))
		for _, id := range query.UUIDs {
			if !wanted[id] || expected[id] || acknowledged[id] {
				return 0, refused
			}
			expected[id] = true
		}
		child, err := ReadNativeWriteTask(ctx, jobID, jobID, limit)
		if err != nil {
			return 0, err
		}
		if !TaskHasClaim(child) || child.Status != jobproto.TaskStatus_Finished || child.EndTime <= 0 || child.TriggerOwner != task.TriggerOwner {
			return 0, refused
		}
		var claim struct {
			JobDigest string `json:"jobDigest"`
		}
		if json.Unmarshal(child.ActionsLogs[0].InputMessage.OutputChain[0].JsonBody, &claim) != nil || claim.JobDigest != digest {
			return 0, refused
		}
		for _, log := range child.ActionsLogs {
			for _, output := range log.GetOutputMessage().GetOutputChain() {
				if output.GetVars()[NativeNodeMutationResult] != "true" {
					continue
				}
				event := new(tree.NodeChangeEvent)
				if !output.Success || log.GetAction().GetID() != action.ID || protojson.Unmarshal(output.JsonBody, event) != nil {
					return 0, refused
				}
				id := event.GetSource().GetUuid()
				if !expected[id] || acknowledged[id] || (isDelete && event.Type != tree.NodeChangeEvent_DELETE) || (!isDelete && (event.Type != tree.NodeChangeEvent_UPDATE_PATH || event.GetTarget().GetUuid() == "")) {
					return 0, refused
				}
				if !isDelete && (action.Parameters["targetParent"] != "true" || action.Parameters["target"] == "" || path.Dir(event.Target.Path) != path.Clean(action.Parameters["target"])) {
					return 0, refused
				}
				acknowledged[id] = true
			}
		}
		for id := range expected {
			if !acknowledged[id] {
				return 0, refused
			}
		}
		if child.EndTime > completedAt {
			completedAt = child.EndTime
		}
	}
	if len(acknowledged) != len(wanted) {
		return 0, refused
	}
	// Complete the same original coordinator only after all child terminals
	// have been verified. A lost persistence ACK is not a terminal response.
	if task.Status != jobproto.TaskStatus_Finished || task.EndTime != completedAt {
		terminal := proto.Clone(task).(*jobproto.Task)
		terminal.Status, terminal.EndTime = jobproto.TaskStatus_Finished, completedAt
		stored, err := client.PutTask(ctx, &jobproto.PutTaskRequest{Task: terminal})
		if err != nil {
			return 0, err
		}
		if !proto.Equal(stored.GetTask(), terminal) {
			return 0, refused
		}
	}
	return completedAt, nil
}
