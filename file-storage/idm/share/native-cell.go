package share

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"sort"
	"time"

	"google.golang.org/protobuf/proto"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/client/commons/jobsc"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/permissions"
	"github.com/pydio/cells/v5/common/proto/idm"
	jobproto "github.com/pydio/cells/v5/common/proto/jobs"
	"github.com/pydio/cells/v5/common/proto/rest"
	"github.com/pydio/cells/v5/common/utils/uuid"
	jobstore "github.com/pydio/cells/v5/scheduler/jobs"
)

type nativeCellSelection struct {
	ID          string                      `json:"id"`
	Label       string                      `json:"label"`
	Description string                      `json:"description"`
	Roots       []string                    `json:"roots"`
	ACLs        map[string][]*idm.ACLAction `json:"acls"`
	AccessEnd   int64                       `json:"accessEnd"`
}

type nativeCellChange struct {
	NodeID  string                 `json:"nodeId"`
	UserID  string                 `json:"userId"`
	Command map[string]interface{} `json:"command"`
}

type nativeCellIntent struct {
	BindingID       string              `json:"bindingId"`
	Generation      int64               `json:"generation"`
	NativeUserID    string              `json:"nativeUserId"`
	ExecutionTaskID string              `json:"executionTaskId"`
	Selection       nativeCellSelection `json:"selection"`
	Before          nativeCellSelection `json:"before"`
	Changes         []nativeCellChange  `json:"changes"`
}

type nativeCellContextKey struct{}
type nativeCellMutation struct {
	delivery auth.NativeCellShareDelivery
	token    string
	intent   nativeCellIntent
}

func nativeCellRefused() error { return errors.WithStack(errors.StatusForbidden) }
func nativeCellUnknown() error {
	return errors.WithMessage(errors.ServiceError, "native Cell membership outcome is unknown; retain the original request key")
}

func cellSelection(cell *rest.Cell) (nativeCellSelection, error) {
	value := nativeCellSelection{ACLs: map[string][]*idm.ACLAction{}}
	if cell == nil || !auth.NativeActorUUID(cell.Uuid) || len(cell.RootNodes) == 0 {
		return value, nativeCellRefused()
	}
	value.ID, value.Label, value.Description, value.AccessEnd = cell.Uuid, cell.Label, cell.Description, cell.AccessEnd
	seen := map[string]bool{}
	for _, node := range cell.RootNodes {
		if !auth.NativeActorUUID(node.GetUuid()) || seen[node.Uuid] {
			return value, nativeCellRefused()
		}
		seen[node.Uuid] = true
		value.Roots = append(value.Roots, node.Uuid)
	}
	sort.Strings(value.Roots)
	for id, acl := range cell.ACLs {
		if acl == nil || !auth.NativeActorUUID(id) || id != acl.RoleId || len(acl.Actions) == 0 {
			return value, nativeCellRefused()
		}
		seenActions := map[string]bool{}
		for _, action := range acl.Actions {
			if action == nil || action.Name == "" || seenActions[action.Name] {
				return value, nativeCellRefused()
			}
			seenActions[action.Name] = true
			value.ACLs[id] = append(value.ACLs[id], proto.Clone(action).(*idm.ACLAction))
		}
		sort.Slice(value.ACLs[id], func(i, j int) bool { return value.ACLs[id][i].Name < value.ACLs[id][j].Name })
	}
	return value, nil
}

func sameCellValue(left, right interface{}) bool {
	a, e1 := json.Marshal(left)
	b, e2 := json.Marshal(right)
	return e1 == nil && e2 == nil && bytes.Equal(a, b)
}

func readOnlyCellMember(cell *rest.Cell, id string) bool {
	acl := cell.ACLs[id]
	return acl != nil && acl.Group == nil && acl.Role == nil &&
		acl.User != nil && acl.User.Uuid == id && !acl.User.IsGroup &&
		len(acl.Actions) == 1 && proto.Equal(acl.Actions[0], permissions.AclRead)
}

// CellShareDomain is emitted only by the original authenticated GetCell route.
// It scopes the UI request reference; it is not an authorization capability.
func CellShareDomain(ctx context.Context) (string, error) {
	value := config.Get(ctx, "services", common.ServiceRestNamespace_+"n", "platform")
	if value.Get() == nil {
		return "", nil
	}
	var delivery auth.NativeCellShareDelivery
	if value.Scan(&delivery) != nil || delivery.Validate() != nil {
		return "", nativeCellRefused()
	}
	encoded, err := json.Marshal(struct {
		TenantID   string `json:"tenantId"`
		BindingID  string `json:"bindingId"`
		Generation int64  `json:"generation"`
	}{delivery.TenantID, delivery.BindingID, delivery.CellShare.BindingGeneration})
	return string(encoded), err
}

func (sc *Client) cellForNativeUpdate(ctx context.Context, id string) (*rest.Cell, error) {
	workspace, err := sc.GetCellWorkspace(ctx, id)
	if err != nil {
		return nil, err
	}
	if !sc.checker.IsContextEditable(ctx, workspace.UUID, workspace.Policies) {
		return nil, nativeCellRefused()
	}
	acl, err := permissions.AccessListFromContextClaims(ctx)
	if err != nil {
		return nil, err
	}
	return sc.WorkspaceToCellObject(ctx, workspace, acl)
}

func (sc *Client) newNativeCellIntent(ctx context.Context, delivery auth.NativeCellShareDelivery, token string, room, current *rest.Cell, owner *idm.User) (nativeCellIntent, error) {
	selection, err := cellSelection(room)
	if err != nil {
		return nativeCellIntent{}, err
	}
	before, err := cellSelection(current)
	if err != nil {
		return nativeCellIntent{}, err
	}
	if selection.ID != before.ID || selection.Label != before.Label || selection.Description != before.Description ||
		selection.AccessEnd != 0 || before.AccessEnd != 0 || !sameCellValue(selection.Roots, before.Roots) || !sameCellValue(room.Policies, current.Policies) {
		return nativeCellIntent{}, nativeCellRefused()
	}
	intent := nativeCellIntent{BindingID: delivery.BindingID, Generation: delivery.CellShare.BindingGeneration,
		NativeUserID: owner.Uuid, ExecutionTaskID: uuid.New(), Selection: selection, Before: before}
	ids := map[string]bool{}
	for id := range selection.ACLs {
		ids[id] = true
	}
	for id := range before.ACLs {
		ids[id] = true
	}
	ordered := make([]string, 0, len(ids))
	for id := range ids {
		ordered = append(ordered, id)
	}
	sort.Strings(ordered)
	for _, id := range ordered {
		if sameCellValue(selection.ACLs[id], before.ACLs[id]) {
			continue
		}
		_, had := before.ACLs[id]
		_, has := selection.ACLs[id]
		if id == owner.Uuid || had == has || (has && !readOnlyCellMember(room, id)) || (had && !readOnlyCellMember(current, id)) {
			return nativeCellIntent{}, nativeCellRefused()
		}
		principal, err := delivery.HumanPrincipal(id)
		if err != nil {
			return nativeCellIntent{}, err
		}
		// Resolve the native UUID as a real HUMAN, not caller supplied User data.
		user, err := permissions.SearchUniqueUser(ctx, "", id)
		if err != nil || user == nil || user.Uuid != id || user.IsGroup || user.Login == "" {
			return nativeCellIntent{}, nativeCellRefused()
		}
		action, version := "resource.revoke_read", delivery.CellShare.RevokeActionVersion
		if has {
			action, version = "resource.grant_read", delivery.CellShare.GrantActionVersion
		}
		for _, node := range selection.Roots {
			selector := map[string]interface{}{"actionKey": action, "actionVersion": version, "nativeType": delivery.CellShare.NativeType, "nativeRef": node}
			if delivery.WorkspaceID != "" {
				selector["workspaceId"] = delivery.WorkspaceID
			}
			resolved, _, err := delivery.HumanAction(ctx, token, map[string]interface{}{"resolveResource": selector})
			if err != nil {
				return nativeCellIntent{}, err
			}
			resource, ok := resolved["resource"].(map[string]interface{})
			resourceID, _ := resource["resourceId"].(string)
			resourceVersion, vOK := resource["resourceVersion"].(float64)
			if !ok || len(resolved) != 1 || len(resource) != 6 || !auth.NativeActorUUID(resourceID) || !vOK || resourceVersion <= 0 || resourceVersion != float64(int64(resourceVersion)) ||
				resource["nativeType"] != delivery.CellShare.NativeType || resource["nativeRef"] != node || resource["nativeInstanceRef"] != delivery.NativeInstanceRef || resource["nativeScopeRef"] != delivery.NativeScopeRef {
				return nativeCellIntent{}, nativeCellRefused()
			}
			command := map[string]interface{}{"actionKey": action, "idempotencyKey": uuid.New(), "resourceId": resourceID, "resourceVersion": resourceVersion, "principalId": principal}
			if delivery.WorkspaceID != "" {
				command["workspaceId"] = delivery.WorkspaceID
			}
			intent.Changes = append(intent.Changes, nativeCellChange{NodeID: node, UserID: id, Command: command})
		}
	}
	if len(intent.Changes) == 0 {
		return nativeCellIntent{}, nativeCellRefused()
	}
	return intent, nil
}

func (m *nativeCellMutation) permissions(ctx context.Context, submit bool) (map[string]interface{}, error) {
	var current auth.NativeCellShareDelivery
	if config.Get(ctx, "services", common.ServiceRestNamespace_+"n", "platform").Scan(&current) != nil || !sameCellValue(current, m.delivery) {
		return nil, nativeCellRefused()
	}
	if err := m.currentScope(ctx); err != nil {
		return nil, err
	}
	for _, change := range m.intent.Changes {
		query := map[string]interface{}{"idempotencyKey": change.Command["idempotencyKey"]}
		if submit {
			query = map[string]interface{}{"command": change.Command}
		}
		observed, exists, err := m.delivery.HumanAction(ctx, m.token, query)
		if err != nil || !exists {
			return nil, nativeCellUnknown()
		}
		submission, ok := observed["submission"].(map[string]interface{})
		op, _ := submission["operationId"].(string)
		ae, _ := submission["actionExecutionId"].(string)
		if !ok || submission["actionKey"] != change.Command["actionKey"] || !auth.NativeActorUUID(op) || !auth.NativeActorUUID(ae) {
			return nil, nativeCellUnknown()
		}
		if observed["terminalStatus"] != "COMPLETED" || submission["gateState"] != "ALLOWED" || submission["dispatchState"] != "DISPATCHED" {
			return observed, nil
		}
	}
	return nil, nil
}

func (m *nativeCellMutation) currentScope(ctx context.Context) error {
	answer, exists, err := m.delivery.HumanAction(ctx, m.token, map[string]interface{}{"authorizeScope": map[string]interface{}{"permission": "discover"}})
	if err != nil || !exists || len(answer) != 1 {
		return nativeCellRefused()
	}
	scope, ok := answer["scope"].(map[string]interface{})
	revision, revisionOK := scope["checkedRevision"].(string)
	expected := 7
	if m.delivery.WorkspaceID != "" {
		expected++
	}
	if !ok || len(scope) != expected || !revisionOK || revision == "" || scope["permission"] != "discover" ||
		scope["bindingId"] != m.delivery.BindingID || scope["generation"] != float64(m.delivery.CellShare.BindingGeneration) ||
		scope["tenantId"] != m.delivery.TenantID || scope["nativeInstanceRef"] != m.delivery.NativeInstanceRef || scope["nativeScopeRef"] != m.delivery.NativeScopeRef {
		return nativeCellRefused()
	}
	if m.delivery.WorkspaceID == "" {
		if _, present := scope["workspaceId"]; present {
			return nativeCellRefused()
		}
	} else if scope["workspaceId"] != m.delivery.WorkspaceID {
		return nativeCellRefused()
	}
	return nil
}

// NativeCellPut consumes the original native request. The first Task freezes
// exact platform commands; the second create-only Task is the single native
// dispatch claim. A permission outcome alone never completes that second Task.
func (sc *Client) NativeCellPut(request *http.Request, room *rest.Cell, createEmpty bool, owner *idm.User) (bool, *rest.Cell, map[string]interface{}, error) {
	ctx := request.Context()
	if _, present, err := auth.TakeNativeProof(request); err != nil || present {
		return true, nil, nil, nativeCellRefused()
	}
	value := config.Get(ctx, "services", common.ServiceRestNamespace_+"n", "platform")
	if value.Get() == nil {
		return false, nil, nil, nil
	}
	var delivery auth.NativeCellShareDelivery
	keys := request.Header.Values("Idempotency-Key")
	domains := request.Header.Values("X-Kailo-Native-Cell-Binding")
	domain, domainErr := CellShareDomain(ctx)
	if value.Scan(&delivery) != nil || delivery.Validate() != nil || domainErr != nil || len(domains) != 1 || domains[0] != domain ||
		len(keys) != 1 || !auth.NativeActorUUID(keys[0]) || createEmpty || owner == nil || owner.IsGroup {
		return true, nil, nil, nativeCellRefused()
	}
	if _, err := delivery.HumanPrincipal(owner.Uuid); err != nil {
		return true, nil, nil, err
	}
	token, err := auth.NativeHumanToken(request)
	if err != nil {
		return true, nil, nil, nativeCellRefused()
	}
	timeout, err := time.ParseDuration(delivery.RequestTimeout)
	if err != nil || timeout <= 0 {
		return true, nil, nil, nativeCellRefused()
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	if err = (&nativeCellMutation{delivery: delivery, token: token}).currentScope(ctx); err != nil {
		return true, nil, nil, err
	}
	selection, err := cellSelection(room)
	if err != nil {
		return true, nil, nil, err
	}
	client := jobsc.JobServiceClient(ctx)
	job, err := client.GetJob(ctx, &jobproto.GetJobRequest{JobID: delivery.CellShare.NativeJobID})
	if err != nil || !jobstore.NativeCellJobMatches(job.GetJob(), delivery.CellShare.NativeJobID, delivery.BindingID, delivery.CellShare.BindingGeneration) {
		return true, nil, nil, nativeCellRefused()
	}
	coordinator, err := jobstore.ReadNativeWriteTask(ctx, delivery.CellShare.NativeJobID, keys[0], delivery.MaxResponseBytes)
	if err != nil {
		return true, nil, nil, err
	}
	var intent nativeCellIntent
	if coordinator == nil {
		current, err := sc.cellForNativeUpdate(ctx, room.Uuid)
		if err != nil {
			return true, nil, nil, err
		}
		intent, err = sc.newNativeCellIntent(ctx, delivery, token, room, current, owner)
		if err != nil {
			return true, nil, nil, err
		}
		body, err := json.Marshal(intent)
		if err != nil || int64(len(body)) > delivery.MaxResponseBytes {
			return true, nil, nil, nativeCellRefused()
		}
		coordinator, err = jobstore.NewNativeCellTask(delivery.CellShare.NativeJobID, keys[0], owner.Login, body)
		if err != nil {
			return true, nil, nil, err
		}
		if !nativeCellTaskFits(coordinator, body, delivery.MaxResponseBytes) {
			return true, nil, nil, nativeCellRefused()
		}
		ack, err := client.PutTask(ctx, &jobproto.PutTaskRequest{Task: coordinator, StatusMeta: map[string]string{jobstore.TaskCreateOnly: "true"}})
		if err != nil || !proto.Equal(ack.GetTask(), coordinator) {
			return true, nil, nil, nativeCellUnknown()
		}
	} else {
		body, err := jobstore.NativeCellTaskIntent(coordinator)
		if err != nil || json.Unmarshal(body, &intent) != nil {
			return true, nil, nil, nativeCellUnknown()
		}
	}
	if intent.BindingID != delivery.BindingID || intent.Generation != delivery.CellShare.BindingGeneration || intent.NativeUserID != owner.Uuid ||
		coordinator.TriggerOwner != owner.Login || !sameCellValue(intent.Selection, selection) || !auth.NativeActorUUID(intent.ExecutionTaskID) || len(intent.Changes) == 0 {
		return true, nil, nil, nativeCellRefused()
	}
	mutation := &nativeCellMutation{delivery: delivery, token: token, intent: intent}
	// Resubmitting an identical frozen platform command performs the original
	// hash/replay check. It cannot create another permission AE or recipient.
	pending, err := mutation.permissions(ctx, true)
	if err != nil || pending != nil {
		return true, nil, pending, err
	}
	execution, err := jobstore.ReadNativeWriteTask(ctx, delivery.CellShare.NativeJobID, intent.ExecutionTaskID, delivery.MaxResponseBytes)
	if err != nil {
		return true, nil, nil, err
	}
	body, err := json.Marshal(intent)
	if err != nil {
		return true, nil, nil, err
	}
	if execution != nil {
		frozen, e := jobstore.NativeCellTaskIntent(execution)
		if e != nil || !bytes.Equal(frozen, body) || execution.TriggerOwner != owner.Login || !nativeCellCompleted(execution, body) {
			return true, nil, nil, nativeCellUnknown()
		}
		current, e := sc.cellForNativeUpdate(ctx, room.Uuid)
		if e != nil {
			return true, nil, nil, e
		}
		pending, e = mutation.permissions(ctx, false)
		if e != nil || pending != nil {
			return true, nil, pending, e
		}
		if e = finishNativeCellTask(ctx, coordinator, body); e != nil {
			return true, nil, nil, e
		}
		return true, current, nil, nil
	}
	current, err := sc.cellForNativeUpdate(ctx, room.Uuid)
	if err != nil {
		return true, nil, nil, err
	}
	actual, err := cellSelection(current)
	if err != nil || !sameCellValue(actual, intent.Before) {
		return true, nil, nil, nativeCellUnknown()
	}
	readonly, err := sc.ParseRootNodes(ctx, room, false)
	if err != nil {
		return true, nil, nil, err
	}
	parent, err := sc.DetectInheritedPolicy(ctx, room.RootNodes, nil)
	if err != nil || parent != "" {
		return true, nil, nil, nativeCellRefused()
	}
	if err = sc.CheckCellOptionsAgainstConfigs(ctx, room); err != nil {
		return true, nil, nil, err
	}
	execution, err = jobstore.NewNativeCellTask(delivery.CellShare.NativeJobID, intent.ExecutionTaskID, owner.Login, body)
	if err != nil {
		return true, nil, nil, err
	}
	if !nativeCellTaskFits(execution, body, delivery.MaxResponseBytes) {
		return true, nil, nil, nativeCellRefused()
	}
	ack, err := client.PutTask(ctx, &jobproto.PutTaskRequest{Task: execution, StatusMeta: map[string]string{jobstore.TaskCreateOnly: "true"}})
	if err != nil || !proto.Equal(ack.GetTask(), execution) {
		return true, nil, nil, nativeCellUnknown()
	}
	execution.Status, execution.StartTime = jobproto.TaskStatus_Running, int32(time.Now().Unix())
	ack, err = client.PutTask(ctx, &jobproto.PutTaskRequest{Task: execution})
	if err != nil || !proto.Equal(ack.GetTask(), execution) {
		return true, nil, nil, nativeCellUnknown()
	}
	ctx = context.WithValue(ctx, nativeCellContextKey{}, mutation)
	output, err := sc.UpsertCell(ctx, room, owner, readonly, parent)
	if err != nil {
		return true, nil, nil, nativeCellUnknown()
	}
	if err = finishNativeCellTask(ctx, execution, body); err != nil {
		return true, nil, nil, err
	}
	if err = finishNativeCellTask(ctx, coordinator, body); err != nil {
		return true, nil, nil, err
	}
	pending, err = mutation.permissions(ctx, false)
	if err != nil || pending != nil {
		return true, nil, pending, err
	}
	return true, output, nil, nil
}

func finishNativeCellTask(ctx context.Context, task *jobproto.Task, intent []byte) error {
	if nativeCellCompleted(task, intent) {
		return nil
	}
	task = completedNativeCellTask(task, intent)
	ack, err := jobsc.JobServiceClient(ctx).PutTask(ctx, &jobproto.PutTaskRequest{Task: task})
	if err != nil || !proto.Equal(ack.GetTask(), task) {
		return nativeCellUnknown()
	}
	return nil
}

func completedNativeCellTask(task *jobproto.Task, intent []byte) *jobproto.Task {
	task = proto.Clone(task).(*jobproto.Task)
	digest := sha256.Sum256(intent)
	task.ActionsLogs = append(task.ActionsLogs, &jobproto.ActionLog{OutputMessage: &jobproto.ActionMessage{OutputChain: []*jobproto.ActionOutput{{
		Success: true, JsonBody: []byte(hex.EncodeToString(digest[:])), Vars: map[string]string{jobstore.NativeCellShareResult: "true"},
	}}}})
	task.Status, task.EndTime = jobproto.TaskStatus_Finished, int32(time.Now().Unix())
	if task.StartTime == 0 {
		task.StartTime = task.EndTime
	}
	return task
}

func nativeCellTaskFits(task *jobproto.Task, intent []byte, limit int64) bool {
	return limit > 0 && int64(proto.Size(&jobproto.ListTasksResponse{Task: completedNativeCellTask(task, intent)})) <= limit
}

func nativeCellCompleted(task *jobproto.Task, intent []byte) bool {
	if task.Status != jobproto.TaskStatus_Finished || task.EndTime <= 0 {
		return false
	}
	digest := sha256.Sum256(intent)
	count := 0
	for _, log := range task.ActionsLogs {
		for _, output := range log.GetOutputMessage().GetOutputChain() {
			if output.GetVars()[jobstore.NativeCellShareResult] != "true" {
				continue
			}
			if !output.Success || string(output.JsonBody) != hex.EncodeToString(digest[:]) {
				return false
			}
			count++
		}
	}
	return count == 1
}

// Managed UpsertCell cannot be reached with a missing request-local producer.
// Independent installations retain their original native ACL semantics.
func nativeCellWrite(ctx context.Context) (*nativeCellMutation, error) {
	mutation, ok := ctx.Value(nativeCellContextKey{}).(*nativeCellMutation)
	if config.Get(ctx, "services", common.ServiceRestNamespace_+"n", "platform").Get() == nil && !ok {
		return nil, nil
	}
	if !ok || mutation == nil {
		return nil, nativeCellRefused()
	}
	pending, err := mutation.permissions(ctx, false)
	if err != nil || pending != nil {
		return nil, nativeCellUnknown()
	}
	return mutation, nil
}

func (m *nativeCellMutation) matchesDiff(add, remove []*idm.ACL) bool {
	actual := map[string]bool{}
	for action, entries := range map[string][]*idm.ACL{"resource.grant_read": add, "resource.revoke_read": remove} {
		for _, entry := range entries {
			if entry == nil || entry.WorkspaceID != m.intent.Selection.ID || !proto.Equal(entry.Action, permissions.AclRead) {
				return false
			}
			key := action + "/" + entry.NodeID + "/" + entry.RoleID
			if actual[key] {
				return false
			}
			actual[key] = true
		}
	}
	if len(actual) != len(m.intent.Changes) {
		return false
	}
	for _, change := range m.intent.Changes {
		action, ok := change.Command["actionKey"].(string)
		if !ok || !actual[action+"/"+change.NodeID+"/"+change.UserID] {
			return false
		}
	}
	return true
}

func nativeCellWorkspaceACK(expected, actual *idm.Workspace) bool {
	if expected == nil || actual == nil || actual.LastUpdated <= 0 {
		return false
	}
	left, right := proto.Clone(expected).(*idm.Workspace), proto.Clone(actual).(*idm.Workspace)
	// The original workspace DAO stamps LastUpdated and the policy DAO allocates
	// row IDs. These are not requested semantics; all policy bodies and every
	// other workspace field must still match the acknowledged write.
	left.LastUpdated, right.LastUpdated = 0, 0
	for _, workspace := range []*idm.Workspace{left, right} {
		for _, policy := range workspace.Policies {
			if policy == nil {
				return false
			}
			policy.Id = 0
		}
	}
	return proto.Equal(left, right)
}
