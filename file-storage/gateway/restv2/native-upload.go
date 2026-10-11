package restv2

import (
	"encoding/json"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"

	restful "github.com/emicklei/go-restful/v3"
	"github.com/pborman/uuid"
	"google.golang.org/protobuf/proto"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/auth/claim"
	"github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/middleware/authorizations"
	"github.com/pydio/cells/v5/common/nodes/compose"
	"github.com/pydio/cells/v5/common/proto/idm"
	"github.com/pydio/cells/v5/common/proto/jobs"
	"github.com/pydio/cells/v5/common/proto/rest"
	"github.com/pydio/cells/v5/common/proto/tree"
	jobstore "github.com/pydio/cells/v5/scheduler/jobs"
)

// The original authenticated NodeService prepares only reference metadata.
// S3 stays closed until this same task's writer claims an actual byte step.
func (h *Handler) PrepareUpload(req *restful.Request, resp *restful.Response) error {
	proof, machine, err := auth.TakeNativeProof(req.Request)
	if err != nil {
		return err
	}
	if machine {
		return h.prepareNativeUploadTask(req, resp, proof)
	}
	ctx := req.Request.Context()
	refused := errors.WithStack(errors.StatusForbidden)
	var delivery nativeWriteDelivery
	value := config.Get(ctx, "services", common.ServiceRestNamespace_+"n", "platform")
	if value.Get() == nil || value.Scan(&delivery) != nil || delivery.DraftUploads == nil ||
		delivery.Write.ActionVersion <= 0 || delivery.Write.ResultExposurePolicyVersion <= 0 || !actorUUID(delivery.Write.ResultExposurePolicyID) {
		return refused
	}
	input := new(rest.NativeUploadRequest)
	if req.ReadEntity(input) != nil || input.Uuid != req.PathParameter("Uuid") || !actorUUID(input.Uuid) || input.Size < 0 ||
		input.Path == "" || strings.Trim(input.Path, "/") != path.Clean(strings.Trim(input.Path, "/")) || strings.Contains(input.Path, "\\") {
		return refused
	}
	keys := req.Request.Header.Values("Idempotency-Key")
	if len(keys) != 1 || keys[0] != input.Uuid {
		return refused
	}
	token, err := auth.NativeHumanToken(req.Request)
	if err != nil {
		return refused
	}
	policy, err := idm.NewPolicyEngineServiceClient(grpc.ResolveConn(ctx, common.ServicePolicyGRPC)).IsAllowed(ctx, authorizations.HTTPPolicyRequest(req.Request))
	if err != nil || !policy.GetAllowed() {
		return refused
	}
	current, ok := claim.FromContext(ctx)
	if !ok {
		return refused
	}
	principal, err := delivery.HumanPrincipal(current.Subject)
	if err != nil {
		return refused
	}
	// Original native ACL/path lookup still runs on every preparation/observe.
	// Neither the request's path nor a supplied UUID replaces native authority.
	router := compose.PathClient()
	parent, err := router.ReadNode(ctx, &tree.ReadNodeRequest{Node: &tree.Node{Path: path.Dir(strings.Trim(input.Path, "/"))}})
	if err != nil || parent.GetNode() == nil || parent.Node.GetType() != tree.NodeType_COLLECTION {
		return refused
	}
	root, err := h.UuidClient(false).ReadNode(ctx, &tree.ReadNodeRequest{Node: &tree.Node{Uuid: delivery.NativeRootRef}})
	if err != nil || root.GetNode() == nil || root.Node.GetUuid() != delivery.NativeRootRef {
		return refused
	}
	nativeParent, err := h.UuidClient(false).ReadNode(ctx, &tree.ReadNodeRequest{Node: &tree.Node{Uuid: parent.Node.Uuid}})
	if err != nil || nativeParent.GetNode().GetUuid() != parent.Node.Uuid {
		return refused
	}
	rootPath, parentPath := strings.Trim(root.Node.Path, "/"), strings.Trim(nativeParent.Node.Path, "/")
	if rootPath == "" || root.Node.GetStringMeta(common.MetaNamespaceDatasourceName) == "" ||
		root.Node.GetStringMeta(common.MetaNamespaceDatasourceName) != nativeParent.Node.GetStringMeta(common.MetaNamespaceDatasourceName) ||
		(parentPath != rootPath && !strings.HasPrefix(parentPath, rootPath+"/")) {
		return refused
	}
	observed, exists, err := delivery.HumanAction(ctx, token, map[string]interface{}{"idempotencyKey": input.Uuid})
	if err != nil {
		return err
	}
	if !exists {
		selector := map[string]interface{}{"actionKey": "file_storage.write@v1", "actionVersion": delivery.Write.ActionVersion,
			"nativeType": delivery.Write.NativeType, "nativeRef": delivery.NativeRootRef}
		if delivery.WorkspaceID != "" {
			selector["workspaceId"] = delivery.WorkspaceID
		}
		resolved, found, err := delivery.HumanAction(ctx, token, map[string]interface{}{"resolveResource": selector})
		resource, valid := resolved["resource"].(map[string]interface{})
		if err != nil || !found || !valid || resource["nativeRef"] != delivery.NativeRootRef || resource["nativeScopeRef"] != delivery.NativeScopeRef || resource["nativeInstanceRef"] != delivery.NativeInstanceRef {
			return refused
		}
		nodeID := uuid.New()
		existing, readErr := router.ReadNode(ctx, &tree.ReadNodeRequest{Node: &tree.Node{Path: strings.Trim(input.Path, "/")}})
		if readErr == nil {
			if existing.GetNode() == nil || existing.Node.Type != tree.NodeType_LEAF || !actorUUID(existing.Node.Uuid) {
				return refused
			}
			nodeID = existing.Node.Uuid
		} else if !errors.Is(readErr, errors.NodeNotFound) {
			return readErr
		}
		timeout, _, err := delivery.DraftUploads.Durations()
		if err != nil {
			return err
		}
		metadata := map[string]interface{}{"resourceId": resource["resourceId"], "nativeIntentId": input.Uuid, "nativeNodeId": nodeID,
			"nativeDeadline": time.Now().Add(timeout).Unix(), "contentLength": input.Size, "multipart": input.Multipart}
		canonical, err := json.Marshal(metadata)
		if err != nil {
			return err
		}
		command := map[string]interface{}{"actionKey": "file_storage.write@v1", "idempotencyKey": input.Uuid,
			"resourceId": resource["resourceId"], "resourceVersion": resource["resourceVersion"], "componentAction": map[string]interface{}{
				"actionVersion": delivery.Write.ActionVersion, "inputJson": string(canonical), "resultExposurePolicyId": delivery.Write.ResultExposurePolicyID,
				"resultExposurePolicyVersion": delivery.Write.ResultExposurePolicyVersion}}
		if delivery.WorkspaceID != "" {
			command["workspaceId"] = delivery.WorkspaceID
		}
		observed, _, err = delivery.HumanAction(ctx, token, map[string]interface{}{"command": command})
		if err != nil {
			return err
		}
	}
	var metadata map[string]interface{}
	if json.Unmarshal([]byte(stringClaim(observed, "inputJson")), &metadata) != nil {
		return refused
	}
	if _, valid := auth.NativeUploadInput(metadata); !valid || metadata["nativeIntentId"] != input.Uuid ||
		metadata["contentLength"] != float64(input.Size) || metadata["multipart"] != input.Multipart {
		return refused
	}
	submission, valid := observed["submission"].(map[string]interface{})
	if !valid || !actorUUID(stringClaim(submission, "actionExecutionId")) || submission["actionKey"] != "file_storage.write@v1" {
		return refused
	}
	result := &rest.NativeUploadResponse{ActionExecutionId: stringClaim(submission, "actionExecutionId"), NativeIntentId: input.Uuid, NativeNodeId: stringClaim(metadata, "nativeNodeId")}
	var task *jobs.Task
	if reference, ok := observed["nativeExecution"].(map[string]interface{}); ok {
		if !actorUUID(stringClaim(reference, "externalExecutionId")) || !actorUUID(stringClaim(reference, "idempotencyKey")) || reference["nativeIntentId"] != input.Uuid {
			return refused
		}
		result.ExternalExecutionId, result.IdempotencyKey = stringClaim(reference, "externalExecutionId"), stringClaim(reference, "idempotencyKey")
		generation, ok := reference["bindingGeneration"].(float64)
		if !ok || generation < 1 || generation > 1<<53-1 || generation != float64(int64(generation)) {
			return refused
		}
		task, err = jobstore.ReadNativeWriteTask(ctx, auth.NativeUploadJobID(delivery.Write.NativeJobID, delivery.BindingID, int64(generation)), result.IdempotencyKey, delivery.MaxResponseBytes)
		if err != nil {
			return err
		}
		if task != nil {
			intent, err := jobstore.NativeUploadTaskIntent(task)
			if err != nil || intent.BindingID != delivery.BindingID || intent.NativeUserID != current.Subject ||
				intent.Scope["actor_principal_id"] != principal || intent.Scope["action_execution_id"] != result.ActionExecutionId ||
				intent.Scope["external_execution_id"] != result.ExternalExecutionId || !sameJSON(intent.Input, metadata) || reference["bindingGeneration"] != float64(intent.Generation) {
				return refused
			}
			result.Ready = jobstore.NativeUploadWaiting(task)
		}
	}
	if observed["terminalStatus"] == "COMPLETED" {
		// Core's terminal is necessary, but it does not replace the original
		// native Task receipt, immutable Version or the current user's node ACL.
		// Re-entry must still name the exact path that the byte writer claimed.
		published, _, err := jobstore.NativeUploadRevision(task)
		if err != nil || submission["gateState"] != "ALLOWED" || submission["dispatchState"] != "DISPATCHED" ||
			observed["nativeType"] != "version" || published.GetVersionId() != stringClaim(observed, "nativeId") {
			return refused
		}
		publication, err := jobstore.NativeUploadPublicationFromTask(task)
		if err != nil || publication == nil || publication.Node.GetPath() != strings.Trim(input.Path, "/") {
			return refused
		}
		version, err := versionClient(ctx).HeadVersion(ctx, &tree.HeadVersionRequest{NodeUuid: result.NativeNodeId, VersionId: published.VersionId})
		if err != nil || !jobstore.NativeUploadPublishedVersionMatches(version.GetVersion(), published) {
			return refused
		}
		byPath, err := router.ReadNode(ctx, &tree.ReadNodeRequest{Node: &tree.Node{Path: strings.Trim(input.Path, "/")}})
		if err != nil || byPath.GetNode().GetUuid() != result.NativeNodeId || byPath.GetNode().GetType() != tree.NodeType_LEAF {
			return refused
		}
		fresh, err := h.UuidClient(true).ReadNode(ctx, &tree.ReadNodeRequest{Node: &tree.Node{Uuid: result.NativeNodeId}, StatFlags: []uint32{tree.StatFlagNone}})
		if err != nil || fresh.GetNode().GetUuid() != result.NativeNodeId || fresh.GetNode().GetType() != tree.NodeType_LEAF {
			return refused
		}
		result.Ready, result.Completed, result.VersionId = false, true, published.VersionId
	} else if observed["terminalStatus"] != nil || submission["gateState"] == "DENIED" || submission["gateState"] == "REVOKED" || submission["gateState"] == "EXPIRED" {
		return errors.WithStack(errors.StatusConflict)
	}
	resp.Header().Set("Cache-Control", "no-store")
	if !result.Completed {
		interval, err := time.ParseDuration(delivery.RequestTimeout)
		if err != nil || interval < time.Second {
			return refused
		}
		resp.Header().Set("Retry-After", strconv.FormatInt(int64(interval/time.Second), 10))
	}
	return resp.WriteEntity(result)
}

func (h *Handler) prepareNativeUploadTask(req *restful.Request, resp *restful.Response, proof string) error {
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
	input, valid := auth.NativeUploadInput(args["input"])
	if !valid || input["nativeIntentId"] != req.PathParameter("Uuid") || target["nativeRef"] != delivery.NativeRootRef {
		return refused
	}
	_, _, generation, err := delivery.AuthorizeNativeWriter(req.Request.Context(), decodeNativeProofToken(proof), raw)
	if err != nil {
		return err
	}
	req.Request.Header.Set("X-Kailo-Native-Execution", proof)
	if err := h.nativeActor(req, resp, delivery.NativeRootRef, "upload"); err != nil {
		return err
	}
	ctx := req.Request.Context()
	current, ok := claim.FromContext(ctx)
	if !ok {
		return refused
	}
	key := stringClaim(claims, "idempotency_key")
	client := jobs.NewJobServiceClient(grpc.ResolveConn(ctx, common.ServiceJobsGRPC))
	jobID := auth.NativeUploadJobID(delivery.Write.NativeJobID, delivery.BindingID, generation)
	job, err := client.GetJob(ctx, &jobs.GetJobRequest{JobID: jobID})
	if err != nil || job.GetJob().GetInactive() {
		return refused
	}
	owner, jobGeneration, err := jobstore.NativeUploadJobOrigin(job.GetJob())
	if err != nil || owner != delivery.BindingID || jobGeneration != generation {
		return refused
	}
	expected, err := jobstore.NewNativeUploadTask(delivery.BindingID, generation, jobID, key, current.Name, current.Subject, claims, input)
	if err != nil {
		return err
	}
	task, err := jobstore.ReadNativeWriteTask(ctx, jobID, key, delivery.MaxResponseBytes)
	if err != nil {
		return err
	}
	if task == nil {
		created, err := client.PutTask(ctx, &jobs.PutTaskRequest{Task: expected, StatusMeta: map[string]string{jobstore.TaskCreateOnly: "true"}})
		if err != nil || !proto.Equal(created.GetTask(), expected) {
			return errors.WithStack(errors.StatusConflict)
		}
		task = expected
	} else if len(task.ActionsLogs) == 0 || !proto.Equal(task.ActionsLogs[0], expected.ActionsLogs[0]) {
		return refused
	}
	// Waiting for the original client's bytes is real native work, not success.
	status := "UNKNOWN"
	if jobstore.NativeUploadWaiting(task) {
		status = "RUNNING"
	}
	resp.Header().Set("Cache-Control", "no-store")
	return resp.WriteHeaderAndJson(http.StatusOK, map[string]interface{}{"execution": map[string]interface{}{
		"idempotencyKey": key, "nativeType": "version", "platformStatus": status, "cancelCapability": "UNSUPPORTED",
		"lastObservedAt": time.Now().UTC().Format(time.RFC3339Nano)}}, restful.MIME_JSON)
}
