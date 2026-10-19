package jobs

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"path"
	"time"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/auth/protocol"
	"github.com/pydio/cells/v5/common/client/commons/jobsc"
	"github.com/pydio/cells/v5/common/client/commons/treec"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/errors"
	jobproto "github.com/pydio/cells/v5/common/proto/jobs"
	"github.com/pydio/cells/v5/common/proto/tree"
)

const NativeNodeMutationResult = "nativeNodeMutationResult"
const NativeDeleteJob = "nativeDeleteJob"
const NativeDeleteDispatchComplete = "nativeDeleteDispatchComplete"
const NativeDeleteTask = "nativeDeleteTask"
const NativeDeleteCoordinator = "nativeDeleteCoordinator"

func NewNativeDeleteTask(delivery auth.NativeDeleteDelivery, key, owner, nativeUser string, claims, input map[string]interface{}) (*jobproto.Task, error) {
	deadline, err := time.Parse(time.RFC3339Nano, delivery.ExecutionDeadline)
	interval, intervalErr := time.ParseDuration(delivery.Delete.AdmissionPollInterval)
	external, ok := claims["external_execution_id"].(string)
	if owner == "" || owner == common.PydioSystemUsername || err != nil || intervalErr != nil || interval <= 0 || !deadline.After(time.Now()) || delivery.ExecutionGeneration <= 0 ||
		!ok || !auth.NativeActorUUID(external) || !auth.NativeActorUUID(key) || claims["idempotency_key"] != key ||
		claims["actor_principal_id"] != claims["initiating_human_principal_id"] || claims["agent_principal_id"] != nil {
		return nil, errors.WithStack(errors.StatusForbidden)
	}
	intent := NativeWriteIntent{BindingID: delivery.BindingID, NativeUserID: nativeUser,
		Scope: nativeWriteScope(claims), InputReference: input,
		NativeTask: &NativeTaskExecution{ExternalExecutionID: external, IdempotencyKey: key,
			NativeType: delivery.Delete.NativeType, NativeID: key, Generation: delivery.ExecutionGeneration, Deadline: delivery.ExecutionDeadline}}
	return newNativeWriteTask(delivery.Delete.NativeJobID, key, owner, intent)
}

// nativeDeleteFresh obtains a request-local ticket for the same persisted
// coordinator. Neither this callback nor Core can create or replay its steps.
// It returns the admitted Resource's native node exactly as the original
// nativeActor consumer accepts it at execute: the binding root or a node
// beneath it. Containment is a tree fact proved by AuthorizeNativeDeleteDispatch
// before the first native effect, never by the ticket alone.
func nativeDeleteFresh(ctx context.Context, task *jobproto.Task, wait bool) (auth.NativeDeleteDelivery, string, error) {
	var delivery auth.NativeDeleteDelivery
	refused := errors.WithStack(errors.StatusForbidden)
	intent, err := NativeWriteTaskIntent(task)
	if err != nil || intent.NativeTask == nil || task.TriggerOwner == "" || task.TriggerOwner == common.PydioSystemUsername || intent.Scope["action_key"] != "file_storage.delete@v2" {
		return delivery, "", refused
	}
	ref := intent.NativeTask
	if config.Get(ctx, "services", common.ServiceRestNamespace_+"n", "platform").Scan(&delivery) != nil ||
		delivery.BindingID != intent.BindingID || delivery.Delete.NativeJobID != task.JobID || ref.NativeID != task.ID || ref.IdempotencyKey != task.ID ||
		ref.NativeType != delivery.Delete.NativeType || ref.Generation <= 0 {
		return delivery, "", refused
	}
	principal, ok := intent.Scope["initiating_human_principal_id"].(string)
	nativeUser, userErr := delivery.User(delivery.TenantID, principal, "HUMAN")
	if !ok || userErr != nil || nativeUser != intent.NativeUserID || intent.Scope["tenant_id"] != delivery.TenantID {
		return delivery, "", refused
	}
	interval, err := time.ParseDuration(delivery.Delete.AdmissionPollInterval)
	end, endErr := time.Parse(time.RFC3339Nano, ref.Deadline)
	if err != nil || interval <= 0 || endErr != nil || !end.After(time.Now()) {
		return delivery, "", refused
	}
	ctx, cancel := context.WithDeadline(ctx, end)
	defer cancel()
	execution, ok := intent.Scope["action_execution_id"].(string)
	if !ok {
		return delivery, "", refused
	}
	for {
		token, arguments, admissionErr := delivery.NativeTaskAdmission(ctx, execution, map[string]interface{}{
			"externalExecutionId": ref.ExternalExecutionID, "idempotencyKey": ref.IdempotencyKey,
			"nativeType": ref.NativeType, "nativeId": ref.NativeID}, ref.Deadline)
		if admissionErr == nil {
			claims, target, generation, deadline, freshErr := delivery.AuthorizeNativeTask(ctx, token, arguments)
			var envelope map[string]interface{}
			admitted, _ := target["nativeRef"].(string)
			if freshErr != nil || generation != ref.Generation || deadline != ref.Deadline ||
				claims["external_execution_id"] != ref.ExternalExecutionID || claims["idempotency_key"] != task.ID ||
				!NativeWriteTaskMatches(task, delivery.BindingID, nativeUser, claims) || json.Unmarshal([]byte(arguments), &envelope) != nil ||
				target["nativeInstanceRef"] != delivery.NativeInstanceRef || target["nativeScopeRef"] != delivery.NativeScopeRef || !auth.NativeActorUUID(admitted) {
				return delivery, "", refused
			}
			before, _ := json.Marshal(intent.InputReference)
			after, _ := json.Marshal(envelope["input"])
			if string(before) != string(after) {
				return delivery, "", refused
			}
			return delivery, admitted, nil
		}
		if !wait || !errors.Is(admissionErr, protocol.ErrNativeTaskReferencePending) {
			return delivery, "", admissionErr
		}
		timer := time.NewTimer(interval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return delivery, "", ctx.Err()
		case <-timer.C:
		}
	}
}

// NativeDeleteFresh re-admits a later native effect of the execution whose
// dispatch admission is bound to ctx. The fresh ticket must still admit the
// same Resource node that dispatch proved contained. It re-reads no tree: a
// node this execution already deleted or recycled cannot refuse its own
// remaining steps, and a different admitted node cannot borrow that proof.
func NativeDeleteFresh(ctx context.Context, task *jobproto.Task) error {
	bound, ok := ctx.Value(nativeDeleteContextKey{}).(nativeDeleteDispatch)
	if !ok || task == nil || bound.task.GetJobID() != task.GetJobID() || bound.task.GetID() != task.GetID() {
		return errors.WithStack(errors.StatusForbidden)
	}
	_, admitted, err := nativeDeleteFresh(ctx, task, false)
	if err != nil {
		return err
	}
	if admitted != bound.admitted {
		return errors.WithStack(errors.StatusForbidden)
	}
	return nil
}

// nativeDeleteSelection is the frozen nativeObjectRefs of the original claim.
func nativeDeleteSelection(intent *NativeWriteIntent) ([]string, error) {
	values, ok := intent.InputReference["nativeObjectRefs"].([]interface{})
	if !ok || len(values) == 0 {
		return nil, errors.WithStack(errors.StatusForbidden)
	}
	selected := make([]string, 0, len(values))
	for _, value := range values {
		id, valid := value.(string)
		if !valid || !auth.NativeActorUUID(id) {
			return nil, errors.WithStack(errors.StatusForbidden)
		}
		selected = append(selected, id)
	}
	return selected, nil
}

// nativeDeleteContained re-proves at the worker, before the first native
// effect, the containment the original nativeActor consumer proved at execute
// (gateway/restv2/native-actor.go), with the same rule: the admitted Resource
// is the binding root or beneath it, and every selected node is that Resource
// itself or beneath it. All nodes come from one reader, so paths compare.
func nativeDeleteContained(read func(string) (*tree.Node, error), rootRef, admittedRef string, selected []string) error {
	refused := errors.WithStack(errors.StatusForbidden)
	root, err := read(rootRef)
	if err != nil {
		return refused
	}
	admitted := root
	if admittedRef != rootRef {
		if admitted, err = read(admittedRef); err != nil {
			return refused
		}
	}
	if !auth.NativeAdmittedNode(root, admitted, admitted) {
		return refused
	}
	for _, id := range selected {
		node := admitted
		if id != admittedRef {
			if node, err = read(id); err != nil {
				return refused
			}
		}
		if !auth.NativeAdmittedNode(root, admitted, node) {
			return refused
		}
	}
	return nil
}

// nativeTreeReader resolves exact UUIDs in the tree index, where the original
// scheduler router also resolves the frozen UUID selectors of this execution.
func nativeTreeReader(ctx context.Context) func(string) (*tree.Node, error) {
	client := treec.NodeProviderClient(ctx)
	return func(id string) (*tree.Node, error) {
		response, err := client.ReadNode(ctx, &tree.ReadNodeRequest{Node: &tree.Node{Uuid: id}})
		if err != nil || response.GetNode().GetUuid() != id || response.GetNode().GetPath() == "" {
			return nil, errors.WithStack(errors.StatusForbidden)
		}
		return response.GetNode(), nil
	}
}

// These existing Job metadata references identify an immutable admitted
// execution, including incomplete metadata which must never downgrade it.
func IsNativeDeleteJob(job *jobproto.Job) bool {
	_, coordinator := job.GetMetadata()[NativeDeleteJob]
	_, operation := job.GetMetadata()[NativeDeleteTask]
	return coordinator || operation
}

// Queueing validates immutable task attribution only. Actual worker execution
// separately obtains fresh platform authority before any native side effect.
func NativeDeleteDispatchTask(ctx context.Context, job *jobproto.Job) (*jobproto.Task, error) {
	if !IsNativeDeleteJob(job) {
		return nil, nil
	}
	var delivery auth.NativeDeleteDelivery
	if config.Get(ctx, "services", common.ServiceRestNamespace_+"n", "platform").Scan(&delivery) != nil ||
		job.Metadata[NativeDeleteJob] != delivery.Delete.NativeJobID || job.Metadata[NativeDeleteTask] == "" {
		return nil, errors.WithStack(errors.StatusForbidden)
	}
	task, err := ReadNativeWriteTask(ctx, delivery.Delete.NativeJobID, job.Metadata[NativeDeleteTask], delivery.MaxResponseBytes)
	if err != nil {
		return nil, err
	}
	intent, err := NativeWriteTaskIntent(task)
	if err != nil || intent.NativeTask == nil || intent.BindingID != delivery.BindingID || task.TriggerOwner != job.Owner {
		return nil, errors.WithStack(errors.StatusForbidden)
	}
	digest, err := NativeJobDefinitionDigest(job)
	if err != nil {
		return nil, err
	}
	for _, log := range task.ActionsLogs {
		for _, output := range log.GetOutputMessage().GetOutputChain() {
			if output.GetVars()[NativeDeleteJob] != "true" && output.GetVars()[NativeDeleteCoordinator] != "true" {
				continue
			}
			var reference struct {
				JobID     string `json:"jobId"`
				TaskID    string `json:"taskId"`
				JobDigest string `json:"jobDigest"`
			}
			if json.Unmarshal(output.JsonBody, &reference) == nil && reference.JobID == job.ID && reference.TaskID == job.ID && reference.JobDigest == digest {
				return task, nil
			}
		}
	}
	return nil, errors.WithStack(errors.StatusForbidden)
}

type nativeDeleteContextKey struct{}

// nativeDeleteDispatch binds one worker dispatch to the Resource node its
// admission proved contained; later steps re-admit only that same node.
type nativeDeleteDispatch struct {
	task     *jobproto.Task
	admitted string
}

func AuthorizeNativeDeleteDispatch(ctx context.Context, job *jobproto.Job) (context.Context, error) {
	task, err := NativeDeleteDispatchTask(ctx, job)
	if err != nil || task == nil {
		return ctx, err
	}
	intent, err := NativeWriteTaskIntent(task)
	if err != nil {
		return ctx, err
	}
	// A delayed owner login must still denote the originally mapped UUID.
	// Never let the scoped router resolve a reused login as a different user.
	user, err := auth.ResolveNativeUser(ctx, intent.NativeUserID)
	if err != nil || user.Login != task.TriggerOwner || user.Login == common.PydioSystemUsername {
		return ctx, errors.WithStack(errors.StatusForbidden)
	}
	ctx = auth.WithImpersonate(ctx, user)
	delivery, admitted, err := nativeDeleteFresh(ctx, task, true)
	if err != nil {
		return ctx, err
	}
	// The coordinator freezes its children from the whole selection before
	// any native effect, so its dispatch proves the whole selection. A child
	// (or a later node of it) must not re-read nodes this execution already
	// deleted or recycled; it re-proves that the same admitted Resource is
	// still within the binding root, and the binding root needs no read.
	var selected []string
	if job.Metadata[NativeDeleteCoordinator] == "true" {
		if selected, err = nativeDeleteSelection(intent); err != nil {
			return ctx, err
		}
	}
	if admitted != delivery.NativeRootRef || len(selected) > 0 {
		if err := nativeDeleteContained(nativeTreeReader(ctx), delivery.NativeRootRef, admitted, selected); err != nil {
			return ctx, err
		}
	}
	return context.WithValue(ctx, nativeDeleteContextKey{}, nativeDeleteDispatch{task: task, admitted: admitted}), nil
}

func FreshNativeDeleteStep(ctx context.Context, required bool) error {
	bound, ok := ctx.Value(nativeDeleteContextKey{}).(nativeDeleteDispatch)
	if !ok {
		if required {
			return errors.WithStack(errors.StatusForbidden)
		}
		return nil
	}
	if claimed, _ := ctx.Value(ClaimedTaskContextKey{}).(bool); !claimed {
		return errors.WithStack(errors.StatusForbidden)
	}
	return NativeDeleteFresh(ctx, bound.task)
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
// On success it also returns the coordinator's persisted native TaskStatus.
func NativeDeleteTerminal(ctx context.Context, task *jobproto.Task, limit int64) (int32, string, error) {
	refused := errors.WithStack(errors.StatusConflict)
	intent, err := NativeWriteTaskIntent(task)
	if err != nil || intent.Scope["action_key"] != "file_storage.delete@v2" {
		return 0, "", refused
	}
	selected, ok := intent.InputReference["nativeObjectRefs"].([]interface{})
	permanent, permanentOK := intent.InputReference["removePermanently"].(bool)
	if !ok || !permanentOK || len(selected) == 0 {
		return 0, "", refused
	}
	wanted := make(map[string]bool, len(selected))
	for _, value := range selected {
		id, valid := value.(string)
		if !valid || id == "" || wanted[id] {
			return 0, "", refused
		}
		wanted[id] = true
	}
	complete := false
	children := make(map[string]string)
	for _, log := range task.ActionsLogs {
		for _, output := range log.GetOutputMessage().GetOutputChain() {
			if output.GetVars()[NativeDeleteDispatchComplete] == "true" {
				if complete || !output.Success {
					return 0, "", refused
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
				return 0, "", refused
			}
			children[reference.JobID] = reference.JobDigest
		}
	}
	// A crash after the last broker ACK may precede the coordinator's
	// dispatch-complete write. That marker is not a native terminal: the
	// frozen children and their exact per-node ACKs below prove completion
	// independently. Without full coverage the operation remains UNKNOWN.
	if len(children) == 0 {
		return 0, "", refused
	}
	acknowledged := make(map[string]bool, len(wanted))
	var completedAt int32
	client := jobsc.JobServiceClient(ctx)
	for jobID, digest := range children {
		definition, err := client.GetJob(ctx, &jobproto.GetJobRequest{JobID: jobID})
		if err != nil {
			return 0, "", err
		}
		job := definition.GetJob()
		actualDigest, err := NativeJobDefinitionDigest(job)
		if err != nil || actualDigest != digest || job.Owner != task.TriggerOwner || len(job.Actions) != 1 {
			return 0, "", refused
		}
		action := job.Actions[0]
		isDelete := action.ID == "actions.tree.delete"
		if !isDelete && (action.ID != "actions.tree.copymove" || action.Parameters["type"] != "move" || permanent) {
			return 0, "", refused
		}
		selector := action.GetNodesSelector()
		if selector.GetQuery() == nil || len(selector.Query.SubQueries) != 1 {
			return 0, "", refused
		}
		query := new(tree.Query)
		if selector.Query.SubQueries[0].UnmarshalTo(query) != nil || len(query.UUIDs) == 0 {
			return 0, "", refused
		}
		expected := make(map[string]bool, len(query.UUIDs))
		for _, id := range query.UUIDs {
			if !wanted[id] || expected[id] || acknowledged[id] {
				return 0, "", refused
			}
			expected[id] = true
		}
		child, err := ReadNativeWriteTask(ctx, jobID, jobID, limit)
		if err != nil {
			return 0, "", err
		}
		if !TaskHasClaim(child) || child.Status != jobproto.TaskStatus_Finished || child.EndTime <= 0 || child.TriggerOwner != task.TriggerOwner {
			return 0, "", refused
		}
		var claim struct {
			JobDigest string `json:"jobDigest"`
		}
		if json.Unmarshal(child.ActionsLogs[0].InputMessage.OutputChain[0].JsonBody, &claim) != nil || claim.JobDigest != digest {
			return 0, "", refused
		}
		for _, log := range child.ActionsLogs {
			for _, output := range log.GetOutputMessage().GetOutputChain() {
				if output.GetVars()[NativeNodeMutationResult] != "true" {
					continue
				}
				event := new(tree.NodeChangeEvent)
				if !output.Success || log.GetAction().GetID() != action.ID || protojson.Unmarshal(output.JsonBody, event) != nil {
					return 0, "", refused
				}
				id := event.GetSource().GetUuid()
				if !expected[id] || acknowledged[id] || (isDelete && event.Type != tree.NodeChangeEvent_DELETE) || (!isDelete && (event.Type != tree.NodeChangeEvent_UPDATE_PATH || event.GetTarget().GetUuid() == "")) {
					return 0, "", refused
				}
				if !isDelete && (action.Parameters["targetParent"] != "true" || action.Parameters["target"] == "" || path.Dir(event.Target.Path) != path.Clean(action.Parameters["target"])) {
					return 0, "", refused
				}
				acknowledged[id] = true
			}
		}
		for id := range expected {
			if !acknowledged[id] {
				return 0, "", refused
			}
		}
		if child.EndTime > completedAt {
			completedAt = child.EndTime
		}
	}
	if len(acknowledged) != len(wanted) {
		return 0, "", refused
	}
	// Complete the same original coordinator only after all child terminals
	// have been verified. A lost persistence ACK is not a terminal response.
	// The returned native status is the persisted coordinator's own value
	// (DD-124(5)): either already stored, or the acknowledged write below.
	status := task.GetStatus()
	if task.Status != jobproto.TaskStatus_Finished || task.EndTime != completedAt {
		terminal := proto.Clone(task).(*jobproto.Task)
		terminal.Status, terminal.EndTime = jobproto.TaskStatus_Finished, completedAt
		stored, err := client.PutTask(ctx, &jobproto.PutTaskRequest{Task: terminal})
		if err != nil {
			return 0, "", err
		}
		if !proto.Equal(stored.GetTask(), terminal) {
			return 0, "", refused
		}
		status = stored.GetTask().GetStatus()
	}
	return completedAt, status.String(), nil
}
