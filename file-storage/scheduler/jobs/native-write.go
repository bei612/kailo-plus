package jobs

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/errors"
	jobproto "github.com/pydio/cells/v5/common/proto/jobs"
	"github.com/pydio/cells/v5/common/proto/tree"
)

// This is the original VersionAction identifier. The controlled write Job
// freezes that sole action but has no scheduler trigger or automatic dispatch.
const NativeVersionActionID = "actions.versioning.create"

func NativeWriteJob(id string) *jobproto.Job {
	job := NativeReadJob(id)
	job.Actions = []*jobproto.Action{{ID: NativeVersionActionID}}
	return job
}

func NativeWriteJobMatches(job *jobproto.Job, id string) bool {
	return nativeActionJobMatches(job, NativeWriteJob(id))
}

// The existing native stream is bounded by the operator's response budget.
// Exhaustion/unavailable lookup is not evidence that an operation never ran.
func ReadNativeWriteTask(ctx context.Context, job, key string, limit int64) (*jobproto.Task, error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	client := jobproto.NewJobServiceClient(grpc.ResolveConn(ctx, common.ServiceJobsGRPC))
	stream, err := client.ListTasks(ctx, &jobproto.ListTasksRequest{JobID: job, Status: jobproto.TaskStatus_Any})
	if err != nil {
		return nil, err
	}
	var found *jobproto.Task
	var size int64
	for {
		response, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			return found, nil
		}
		if err != nil {
			return nil, err
		}
		if response.GetTask() == nil || response.Task.ID == "" || response.Task.JobID != job {
			return nil, errors.WithStack(errors.StatusConflict)
		}
		size += int64(proto.Size(response))
		if limit <= 0 || size > limit {
			return nil, errors.WithMessage(errors.InvalidParameters, "native task lookup exceeds its controlled response budget")
		}
		if response.GetTask().GetID() == key {
			if found != nil {
				return nil, errors.WithStack(errors.StatusConflict)
			}
			found = response.Task
		}
	}
}

// NativeWriteIntent is retained only inside the original Cells Task. It binds
// its first-dispatch claim and native revision to the exact original platform
// execution; neither tokens nor file content enter the native task log.
type NativeWriteIntent struct {
	BindingID      string                 `json:"bindingId"`
	NativeUserID   string                 `json:"nativeUserId"`
	Scope          map[string]interface{} `json:"scope"`
	InputReference map[string]interface{} `json:"inputReference"`
}

func nativeWriteScope(claims map[string]interface{}) map[string]interface{} {
	scope := make(map[string]interface{})
	for _, key := range []string{"tenant_id", "workspace_id", "actor_principal_id", "initiating_human_principal_id", "agent_principal_id", "delegation_id", "delegation_version", "operation_id", "action_execution_id", "target_type", "target_id", "action_key", "action_definition_version", "result_exposure_policy_id", "result_exposure_policy_version"} {
		if value, present := claims[key]; present {
			scope[key] = value
		}
	}
	return scope
}

func NewNativeWriteTask(binding, job, key, owner, nativeUser string, claims, input map[string]interface{}) (*jobproto.Task, error) {
	intent := NativeWriteIntent{BindingID: binding, NativeUserID: nativeUser, Scope: nativeWriteScope(claims), InputReference: input}
	encoded, err := json.Marshal(intent)
	if err != nil {
		return nil, err
	}
	hash := sha256.Sum256(encoded)
	marker, err := json.Marshal(map[string]interface{}{"requestDigest": hex.EncodeToString(hash[:]), "intent": intent})
	if err != nil {
		return nil, err
	}
	return &jobproto.Task{ID: key, JobID: job, TriggerOwner: owner, Status: jobproto.TaskStatus_Queued,
		ActionsLogs: []*jobproto.ActionLog{{InputMessage: &jobproto.ActionMessage{OutputChain: []*jobproto.ActionOutput{{JsonBody: marker, Vars: map[string]string{TaskCreateOnly: "true"}}}}}}}, nil
}

func NativeWriteTaskIntent(task *jobproto.Task) (*NativeWriteIntent, error) {
	refused := errors.WithMessage(errors.StatusConflict, "native task does not contain its frozen write intent")
	if !TaskHasClaim(task) {
		return nil, refused
	}
	body := task.ActionsLogs[0].InputMessage.OutputChain[0].JsonBody
	var marker struct {
		RequestDigest string            `json:"requestDigest"`
		Intent        NativeWriteIntent `json:"intent"`
	}
	if json.Unmarshal(body, &marker) != nil || marker.Intent.InputReference == nil || marker.Intent.Scope == nil {
		return nil, refused
	}
	canonical, err := json.Marshal(marker.Intent)
	if err != nil {
		return nil, refused
	}
	hash := sha256.Sum256(canonical)
	if marker.RequestDigest != hex.EncodeToString(hash[:]) {
		return nil, refused
	}
	return &marker.Intent, nil
}

func NativeWriteTaskMatches(task *jobproto.Task, binding, nativeUser string, claims map[string]interface{}) bool {
	intent, err := NativeWriteTaskIntent(task)
	if err != nil || intent.BindingID != binding || intent.NativeUserID != nativeUser {
		return false
	}
	expected, _ := json.Marshal(nativeWriteScope(claims))
	actual, _ := json.Marshal(intent.Scope)
	return string(expected) == string(actual)
}

// NativeWriteRevision consumes only the original persisted ContentRevision.
// A Finished task without that exact receipt cannot prove a successful write.
func NativeWriteRevision(task *jobproto.Task) (*tree.ContentRevision, error) {
	if task.GetStatus() != jobproto.TaskStatus_Finished || task.GetEndTime() <= 0 {
		return nil, errors.WithStack(errors.StatusConflict)
	}
	intent, err := NativeWriteTaskIntent(task)
	if err != nil {
		return nil, err
	}
	var revision *tree.ContentRevision
	var reference struct {
		NodeUUID string `json:"nodeUuid"`
		Publish  bool   `json:"publish"`
	}
	nativeRef, valid := intent.InputReference["nativeObjectRef"].(string)
	sourceRevision, _ := intent.InputReference["nativeRevision"].(string)
	if !valid || json.Unmarshal([]byte(nativeRef), &reference) != nil || reference.NodeUUID == "" || reference.Publish || sourceRevision == "" {
		return nil, errors.WithStack(errors.StatusConflict)
	}
	for _, entry := range task.ActionsLogs {
		for _, output := range entry.GetOutputMessage().GetOutputChain() {
			if output.GetVars()[NativeVersionResult] != "true" {
				continue
			}
			relation, _ := json.Marshal([]string{task.ID, entry.GetAction().GetID(), reference.NodeUUID})
			digest := sha256.Sum256(relation)
			current := new(tree.ContentRevision)
			if entry.GetAction().GetID() == "" || !output.Success || protojson.Unmarshal(output.JsonBody, current) != nil || current.VersionId != hex.EncodeToString(digest[:]) || current.VersionId == sourceRevision || current.Draft || current.OwnerUuid != intent.NativeUserID || current.Size < 0 || current.Location == nil || current.ETag == "" || (revision != nil && !proto.Equal(current, revision)) {
				return nil, errors.WithStack(errors.StatusConflict)
			}
			revision = current
		}
	}
	if revision == nil {
		return nil, errors.WithStack(errors.VersionNotFound)
	}
	return revision, nil
}
