package restv2

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"path"
	"time"

	restful "github.com/emicklei/go-restful/v3"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/auth/claim"
	"github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/nodes"
	"github.com/pydio/cells/v5/common/nodes/compose"
	"github.com/pydio/cells/v5/common/nodes/models"
	"github.com/pydio/cells/v5/common/proto/jobs"
	"github.com/pydio/cells/v5/common/proto/rest"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/common/utils/propagator"
	"github.com/pydio/cells/v5/data/versions"
	jobstore "github.com/pydio/cells/v5/scheduler/jobs"
)

// executeNativePromote is reached only from the original PromoteVersion route.
// It performs the original native copy/version work under the admitted actor;
// the original Job/Task store owns both first dispatch and durable completion.
func (h *Handler) executeNativePromote(req *restful.Request, resp *restful.Response, proof string) error {
	refused := errors.WithStack(errors.StatusForbidden)
	transport := req.Request.Clone(req.Request.Context())
	delivery, claims, target, raw, err := auth.NativeWriteAuthority(transport, proof, "execute")
	if err != nil {
		return err
	}
	var args map[string]interface{}
	if json.Unmarshal([]byte(raw), &args) != nil || len(args) != 2 {
		return refused
	}
	input, valid := referenceMap(args["input"])
	argumentTarget, targetOK := args["target"].(map[string]interface{})
	key := req.Request.Header.Values("Idempotency-Key")
	nodeID, draftID := req.PathParameter("Uuid"), req.PathParameter("VersionId")
	if !valid || !targetOK || len(argumentTarget) != 1 || len(key) != 1 || !actorUUID(key[0]) ||
		claims["idempotency_key"] != key[0] || input["resourceId"] != target["resourceId"] || argumentTarget["resourceId"] != target["resourceId"] ||
		target["nativeRef"] != nodeID || target["nativeInstanceRef"] != delivery.NativeInstanceRef || target["nativeScopeRef"] != delivery.NativeScopeRef ||
		!validWriteReference(stringClaim(input, "nativeObjectRef"), nodeID, false) || input["nativeRevision"] != draftID {
		return refused
	}
	parameters := new(rest.PromoteParameters)
	if req.ReadEntity(parameters) != nil || parameters.Publish {
		return refused
	}
	// Reuse the original native actor/root/workspace/ACL consumer, including its
	// mandatory acknowledgement. No transport SERVICE roles perform the copy.
	req.Request.Header.Set("X-Kailo-Native-Execution", proof)
	if err := h.nativeActor(req, resp, nodeID, "promote"); err != nil {
		return err
	}
	ctx := req.Request.Context()
	current, ok := claim.FromContext(ctx)
	if !ok {
		return refused
	}
	client := jobs.NewJobServiceClient(grpc.ResolveConn(ctx, common.ServiceJobsGRPC))
	job, err := client.GetJob(ctx, &jobs.GetJobRequest{JobID: delivery.Write.NativeJobID})
	if err != nil || !jobstore.NativeWriteJobMatches(job.GetJob(), delivery.Write.NativeJobID) {
		return refused
	}
	task, err := jobstore.ReadNativeWriteTask(ctx, delivery.Write.NativeJobID, key[0], delivery.MaxResponseBytes)
	if err != nil {
		return err
	}
	expected, err := jobstore.NewNativeWriteTask(delivery.BindingID, delivery.Write.NativeJobID, key[0], current.Name, current.Subject, claims, input)
	if err != nil {
		return err
	}
	if task != nil {
		if !jobstore.NativeWriteTaskMatches(task, delivery.BindingID, current.Subject, claims) || len(task.ActionsLogs) == 0 || !proto.Equal(task.ActionsLogs[0], expected.ActionsLogs[0]) {
			return refused
		}
		if _, _, er := delivery.AuthorizeAction(ctx, decodeNativeProofToken(proof), raw); er != nil {
			return refused
		}
		return writeNativeTaskResult(resp, task)
	}
	router := compose.PathClient()
	read, err := h.UuidClient(true).ReadNode(ctx, &tree.ReadNodeRequest{Node: &tree.Node{Uuid: nodeID}})
	node := read.GetNode()
	if err != nil || node.GetUuid() != nodeID || node.GetType() != tree.NodeType_LEAF ||
		input["displayName"] != path.Base(node.GetPath()) || input["mediaType"] != node.GetStringMeta(common.MetaNamespaceMime) || versions.PolicyForNode(ctx, node) == nil {
		return refused
	}
	revisionResponse, err := versionClient(ctx).HeadVersion(ctx, &tree.HeadVersionRequest{NodeUuid: nodeID, VersionId: draftID})
	draft := revisionResponse.GetVersion()
	if err != nil || draft.GetVersionId() != draftID || !draft.GetDraft() || draft.GetOwnerUuid() != current.Subject || draft.GetSize() < 0 || draft.GetETag() == "" || draft.GetLocation() == nil {
		return refused
	}
	// Only an acknowledged atomic create-only claim grants the first copy. An
	// insert ACK loss is UNKNOWN, never permission to overwrite/re-dispatch.
	claimResponse, err := client.PutTask(ctx, &jobs.PutTaskRequest{Task: expected, StatusMeta: map[string]string{jobstore.TaskCreateOnly: "true"}})
	if err != nil || !proto.Equal(claimResponse.GetTask(), expected) {
		return errors.WithStack(errors.StatusConflict)
	}
	task = expected
	task.Status, task.StartTime = jobs.TaskStatus_Running, int32(time.Now().Unix())
	persisted, err := client.PutTask(ctx, &jobs.PutTaskRequest{Task: task})
	if err != nil || !proto.Equal(persisted.GetTask(), task) {
		return errors.WithStack(errors.StatusConflict)
	}
	// Credentials remain request-local. They are never Job.RunParameters,
	// broker messages, native Task bodies, or log fields.
	authorized := func() bool {
		freshClaims, freshTarget, er := delivery.AuthorizeAction(ctx, decodeNativeProofToken(proof), raw)
		return er == nil && stringClaim(freshClaims, "action_execution_id") == stringClaim(claims, "action_execution_id") && sameJSON(freshTarget, target)
	}
	if !authorized() {
		return writeNativeTaskResult(resp, task)
	}
	copied, err := router.CopyObject(ctx, node, node, &models.CopyRequestData{SrcVersionId: draftID})
	if err != nil || copied.Size != draft.Size {
		return writeNativeTaskResult(resp, task)
	}
	if !authorized() {
		return writeNativeTaskResult(resp, task)
	}
	// Reuse the original VersionAction, but bind its input to the exact draft,
	// not the live head that a later native upload may already have replaced.
	actionCtx := context.WithValue(ctx, jobstore.ClaimedTaskContextKey{}, true)
	actionCtx = propagator.WithAdditionalMetadata(actionCtx, map[string]string{common.CtxMetaTaskUuid: key[0], common.CtxMetaTaskActionPath: (&versions.VersionAction{}).GetName()})
	source := node.Clone()
	source.MustSetMeta(common.MetaNamespaceVersionId, draftID)
	// The original VersionAction owns its internal version-store writes. As in
	// the fixed native job, only this archive/owned-draft cleanup uses its system
	// router; the actual live file copy above still consumes the actor's ACL.
	versionRouter := compose.PathClient(nodes.AsAdmin())
	output, err := (&versions.VersionAction{}).PromoteRevision(actionCtx, &jobs.ActionMessage{Nodes: []*tree.Node{source}}, versionRouter)
	if err != nil {
		return writeNativeTaskResult(resp, task)
	}
	var published *tree.ContentRevision
	for _, result := range output.GetOutputChain() {
		if result.GetVars()[jobstore.NativeVersionResult] != "true" {
			continue
		}
		value := new(tree.ContentRevision)
		if !result.Success || protojson.Unmarshal(result.JsonBody, value) != nil || value.Draft || value.OwnerUuid != current.Subject || value.VersionId == "" || value.VersionId == draftID || value.Size != draft.Size || value.ETag != draft.ETag {
			return writeNativeTaskResult(resp, task)
		}
		if published != nil && !proto.Equal(published, value) {
			return writeNativeTaskResult(resp, task)
		}
		published = value
	}
	if published == nil {
		return writeNativeTaskResult(resp, task)
	}
	if !authorized() {
		return writeNativeTaskResult(resp, task)
	}
	// Original promote cleanup is part of this operation. An uncertain delete
	// is not reported as success; no observation repeats any of these effects.
	deleted, err := versionClient(ctx).DeleteVersion(ctx, &tree.HeadVersionRequest{NodeUuid: nodeID, VersionId: draftID})
	if err != nil || !deleted.GetSuccess() || !proto.Equal(deleted.GetDeletedVersion(), draft) {
		return writeNativeTaskResult(resp, task)
	}
	removed, err := versionRouter.DeleteNode(ctx, &tree.DeleteNodeRequest{Node: draft.Location})
	if err != nil || !removed.GetSuccess() {
		return writeNativeTaskResult(resp, task)
	}
	confirmed, err := versionClient(ctx).HeadVersion(ctx, &tree.HeadVersionRequest{NodeUuid: nodeID, VersionId: published.VersionId})
	if err != nil || confirmed.GetVersion() == nil {
		return writeNativeTaskResult(resp, task)
	}
	verified := proto.Clone(confirmed.Version).(*tree.ContentRevision)
	// HeadVersion computes IsHead from current history; it is not part of the
	// persisted revision receipt, and later writes may legitimately change it.
	verified.IsHead = published.IsHead
	if !proto.Equal(verified, published) {
		return writeNativeTaskResult(resp, task)
	}
	body, err := protojson.Marshal(published)
	if err != nil {
		return writeNativeTaskResult(resp, task)
	}
	task.ActionsLogs = append(task.ActionsLogs, &jobs.ActionLog{Action: &jobs.Action{ID: (&versions.VersionAction{}).GetName()}, OutputMessage: &jobs.ActionMessage{OutputChain: []*jobs.ActionOutput{{Success: true, JsonBody: body, Vars: map[string]string{jobstore.NativeVersionResult: "true"}}}}})
	task.Status, task.EndTime = jobs.TaskStatus_Finished, int32(time.Now().Unix())
	persisted, err = client.PutTask(ctx, &jobs.PutTaskRequest{Task: task})
	if err != nil || !proto.Equal(persisted.GetTask(), task) {
		return errors.WithStack(errors.StatusConflict)
	}
	if !authorized() {
		return refused
	}
	return writeNativeTaskResult(resp, task)
}

func decodeNativeProofToken(proof string) string {
	data, err := base64.RawURLEncoding.DecodeString(proof)
	if err != nil {
		return ""
	}
	var value struct {
		ActionToken string `json:"actionToken"`
	}
	if json.Unmarshal(data, &value) != nil {
		return ""
	}
	return value.ActionToken
}

func sameJSON(left, right interface{}) bool {
	l, le := json.Marshal(left)
	r, re := json.Marshal(right)
	return le == nil && re == nil && string(l) == string(r)
}

func writeNativeTaskResult(resp *restful.Response, task *jobs.Task) error {
	observation := map[string]interface{}{"idempotencyKey": task.ID, "nativeType": "version", "platformStatus": "UNKNOWN", "cancelCapability": "UNSUPPORTED", "lastObservedAt": time.Now().UTC().Format(time.RFC3339Nano)}
	response := map[string]interface{}{"execution": observation}
	revision, err := jobstore.NativeWriteRevision(task)
	if err == nil {
		intent, _ := jobstore.NativeWriteTaskIntent(task)
		var reference nativeWriteReference
		if json.Unmarshal([]byte(stringClaim(intent.InputReference, "nativeObjectRef")), &reference) != nil || reference.Publish || !actorUUID(reference.NodeUUID) {
			return errors.WithStack(errors.StatusConflict)
		}
		observation["nativeId"], observation["platformStatus"], observation["terminalAt"] = revision.VersionId, "SUCCEEDED", time.Unix(int64(task.EndTime), 0).UTC().Format(time.RFC3339)
		response["contentReference"] = map[string]interface{}{"resourceId": intent.InputReference["resourceId"], "nativeObjectRef": reference.NodeUUID, "nativeRevision": revision.VersionId, "displayName": intent.InputReference["displayName"], "mediaType": intent.InputReference["mediaType"]}
		response["contentBytes"] = revision.Size
	} else if task.Status == jobs.TaskStatus_Running && task.StartTime > 0 && task.EndTime == 0 {
		observation["platformStatus"] = "RUNNING"
	}
	return resp.WriteHeaderAndJson(http.StatusOK, response, "application/json")
}
