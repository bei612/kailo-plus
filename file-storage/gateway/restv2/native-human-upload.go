package restv2

import (
	"encoding/json"
	"net/http"
	"path"
	"strings"

	restful "github.com/emicklei/go-restful/v3"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/auth/claim"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/proto/rest"
	"github.com/pydio/cells/v5/common/proto/tree"
)

// nativeWriteDelivery is operator-delivered approved Action/result-policy
// metadata, not another action/identity registry. Its absence in an explicitly
// platform-bound installation cannot fall back to the independent native copy.
type nativeWriteDelivery = auth.NativeWriteDelivery

// The opaque ContentReference freezes the original PromoteParameters.Publish
// alongside the exact native node. A canonical encoding also rejects duplicate
// keys, unknown fields, omitted/non-bool publish and alternative spellings.
type nativeWriteReference struct {
	NodeUUID string `json:"nodeUuid"`
	Publish  bool   `json:"publish"`
}

func writeReference(node string, publish bool) string {
	value, _ := json.Marshal(nativeWriteReference{NodeUUID: node, Publish: publish})
	return string(value)
}

func validWriteReference(raw, node string, publish bool) bool {
	return actorUUID(node) && raw == writeReference(node, publish)
}

func referenceMap(value interface{}) (map[string]interface{}, bool) {
	r, ok := value.(map[string]interface{})
	if !ok || len(r) != 5 || !actorUUID(stringClaim(r, "resourceId")) {
		return nil, false
	}
	for _, field := range []string{"nativeObjectRef", "nativeRevision", "displayName", "mediaType"} {
		v, ok := r[field].(string)
		if !ok || v == "" || strings.TrimSpace(v) != v {
			return nil, false
		}
	}
	return r, true
}

// platformPromoteVersion is the original REST producer of ActionCommand, not a
// new upload API. Raw bytes and original draft revisions stay in Cells. A lost
// command ACK never reaches CopyObject or creates a different request key.
func (h *Handler) platformPromoteVersion(req *restful.Request, resp *restful.Response, node *tree.Node, draftID string, publish bool) (bool, error) {
	ctx := req.Request.Context()
	refused := errors.WithStack(errors.StatusForbidden)
	value := config.Get(ctx, "services", common.ServiceRestNamespace_+"n", "platform")
	if value.Get() == nil {
		return false, nil // the original independent UI/native ACL path
	}
	var delivery nativeWriteDelivery
	keys := req.Request.Header.Values("Idempotency-Key")
	if value.Scan(&delivery) != nil || len(keys) != 1 || !actorUUID(keys[0]) ||
		!actorUUID(node.GetUuid()) || draftID == "" || strings.TrimSpace(draftID) != draftID || node.GetType() != tree.NodeType_LEAF ||
		delivery.Write.ActionVersion <= 0 || delivery.Write.ResultExposurePolicyVersion <= 0 ||
		!actorUUID(delivery.Write.ResultExposurePolicyID) || delivery.Write.NativeType == "" ||
		(delivery.WorkspaceID != "" && !actorUUID(delivery.WorkspaceID)) {
		return true, refused
	}
	token, err := auth.NativeHumanToken(req.Request)
	if err != nil {
		return true, refused
	}
	// Only the real original current HUMAN access credential plus this binding's
	// SERVICE transport reaches Core. Cookie contents are never JSON output.
	observed, exists, err := delivery.HumanAction(ctx, token, map[string]interface{}{"idempotencyKey": keys[0]})
	if err != nil {
		return true, err
	}
	if !exists {
		current, ok := claim.FromContext(ctx)
		if !ok {
			return true, refused
		}
		draft, err := versionClient(ctx).HeadVersion(ctx, &tree.HeadVersionRequest{NodeUuid: node.Uuid, VersionId: draftID})
		revision := draft.GetVersion()
		if err != nil || revision.GetVersionId() != draftID || !revision.GetDraft() ||
			revision.GetOwnerUuid() != current.Subject || revision.GetLocation() == nil || revision.GetSize() < 0 {
			return true, refused
		}
		selector := map[string]interface{}{"actionKey": "file_storage.write@v1", "actionVersion": delivery.Write.ActionVersion,
			"nativeType": delivery.Write.NativeType, "nativeRef": node.Uuid}
		if delivery.WorkspaceID != "" {
			selector["workspaceId"] = delivery.WorkspaceID
		}
		resolved, _, err := delivery.HumanAction(ctx, token, map[string]interface{}{"resolveResource": selector})
		if err != nil {
			return true, err
		}
		resource, ok := resolved["resource"].(map[string]interface{})
		version, versionOK := resource["resourceVersion"].(float64)
		if !ok || len(resolved) != 1 || len(resource) != 6 || !actorUUID(stringClaim(resource, "resourceId")) ||
			!versionOK || version <= 0 || version != float64(int64(version)) ||
			resource["nativeType"] != delivery.Write.NativeType || resource["nativeRef"] != node.Uuid ||
			resource["nativeInstanceRef"] != delivery.NativeInstanceRef || resource["nativeScopeRef"] != delivery.NativeScopeRef {
			return true, refused
		}
		mediaType := node.GetStringMeta(common.MetaNamespaceMime)
		displayName := path.Base(node.GetPath())
		if strings.TrimSpace(mediaType) == "" || displayName == "." || displayName == "/" || strings.TrimSpace(displayName) == "" {
			return true, refused
		}
		input := map[string]interface{}{"resourceId": resource["resourceId"], "nativeObjectRef": writeReference(node.Uuid, publish),
			"nativeRevision": draftID, "displayName": displayName, "mediaType": mediaType}
		command := map[string]interface{}{"actionKey": "file_storage.write@v1", "idempotencyKey": keys[0],
			"resourceId": resource["resourceId"], "resourceVersion": resource["resourceVersion"],
			"componentAction": map[string]interface{}{"actionVersion": delivery.Write.ActionVersion, "inputReference": input,
				"resultExposurePolicyId": delivery.Write.ResultExposurePolicyID, "resultExposurePolicyVersion": delivery.Write.ResultExposurePolicyVersion}}
		if delivery.WorkspaceID != "" {
			command["workspaceId"] = delivery.WorkspaceID
		}
		observed, _, err = delivery.HumanAction(ctx, token, map[string]interface{}{"command": command})
		if err != nil {
			// Dispatch may have happened. Do not call the old promote/copy path.
			return true, err
		}
	}
	input, ok := referenceMap(observed["inputReference"])
	submission, submissionOK := observed["submission"].(map[string]interface{})
	for key := range observed {
		if key != "submission" && key != "inputReference" && key != "terminalStatus" && key != "nativeType" && key != "nativeId" {
			return true, refused
		}
	}
	for key := range submission {
		if key != "operationId" && key != "actionExecutionId" && key != "actionKey" && key != "gateState" && key != "dispatchState" &&
			key != "reason" && key != "approvalWorkflowId" && key != "workflowId" {
			return true, refused
		}
	}
	if !ok || !submissionOK || !actorUUID(stringClaim(submission, "operationId")) ||
		!actorUUID(stringClaim(submission, "actionExecutionId")) || submission["actionKey"] != "file_storage.write@v1" ||
		stringClaim(submission, "gateState") == "" || stringClaim(submission, "dispatchState") == "" ||
		!validWriteReference(stringClaim(input, "nativeObjectRef"), node.Uuid, publish) || input["nativeRevision"] != draftID {
		return true, refused
	}
	resp.Header().Set("Cache-Control", "no-store")
	if (submission["gateState"] == "DENIED" || submission["gateState"] == "REVOKED" || submission["gateState"] == "EXPIRED") &&
		(submission["dispatchState"] == "NOT_DISPATCHED" || submission["dispatchState"] == "ABORTED") {
		return true, refused
	}
	terminal, hasTerminal := observed["terminalStatus"]
	switch terminal {
	case "COMPLETED":
		// The original task/result reconciler, not HTTP acceptance, is the only
		// source of this published VersionId. Re-read its actual native owner.
		id := stringClaim(observed, "nativeId")
		if publish || submission["gateState"] != "ALLOWED" || submission["dispatchState"] != "DISPATCHED" ||
			observed["nativeType"] != "version" || id == "" || id == draftID {
			return true, refused
		}
		version, err := versionClient(ctx).HeadVersion(ctx, &tree.HeadVersionRequest{NodeUuid: node.Uuid, VersionId: id})
		current, currentOK := claim.FromContext(ctx)
		if err != nil || !currentOK || version.GetVersion().GetVersionId() != id || version.GetVersion().GetDraft() ||
			version.GetVersion().GetOwnerUuid() != current.Subject {
			return true, refused
		}
		// A version receipt does not prove the separate publishDraftNode side
		// effect. Do not infer Published from the request. Nor may an old node
		// snapshot stand in for the current native ACL/read result.
		fresh, err := h.UuidClient(true).ReadNode(ctx, &tree.ReadNodeRequest{
			Node: &tree.Node{Uuid: node.Uuid}, StatFlags: []uint32{tree.StatFlagNone},
		})
		if err != nil || fresh.GetNode().GetUuid() != node.Uuid || fresh.GetNode().GetType() != tree.NodeType_LEAF {
			return true, refused
		}
		return true, resp.WriteEntity(&rest.PromoteVersionResponse{Node: h.TreeNodeToNode(ctx, fresh.GetNode()), Success: true})
	case "FAILED", "CANCELED":
		return true, errors.WithStack(errors.StatusConflict)
	default:
		// The original HUMAN producer omits terminalStatus until the native
		// task and usage reconciler has one of its three definite terminals.
		// An explicit unknown/new status is not evidence of pending execution.
		if hasTerminal {
			return true, refused
		}
		// The exact same original route/key observes pending/UNKNOWN next time.
		// No raw native body or successful PromoteVersionResponse is invented.
		// Cells' native EntityWriter accepts protobuf responses only. This is
		// the existing Core JSON observation, not a Cells protobuf message.
		return true, resp.WriteHeaderAndJson(http.StatusAccepted, observed, restful.MIME_JSON)
	}
}
