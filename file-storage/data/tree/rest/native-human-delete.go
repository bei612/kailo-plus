package rest

import (
	"encoding/json"
	"net/http"
	"strings"

	restful "github.com/emicklei/go-restful/v3"
	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/proto/rest"
	"github.com/pydio/cells/v5/common/proto/tree"
)

// Non-secret metadata from the same controlled delivery as the native action.
// It fences browser intent reuse, never replaces Core's generation authority.
func nativeDeleteDomain(req *restful.Request) (string, error) {
	value := config.Get(req.Request.Context(), "services", common.ServiceRestNamespace_+"n", "platform")
	if value.Get() == nil {
		return "", nil
	}
	var delivery auth.NativeDeleteDelivery
	if value.Scan(&delivery) != nil {
		return "", errors.WithStack(errors.StatusForbidden)
	}
	if delivery.Delete.NativeJobID == "" {
		return "", nil
	}
	if !auth.NativeActorUUID(delivery.TenantID) || !auth.NativeActorUUID(delivery.BindingID) || delivery.Delete.BindingGeneration <= 0 {
		return "", errors.WithStack(errors.StatusForbidden)
	}
	encoded, err := json.Marshal(struct {
		TenantID   string `json:"tenantId"`
		BindingID  string `json:"bindingId"`
		Generation int64  `json:"generation"`
	}{delivery.TenantID, delivery.BindingID, delivery.Delete.BindingGeneration})
	return string(encoded), err
}

// The original UI route produces/observes the existing HUMAN Action. It never
// invokes a native mutation itself when the installation has platform delivery.
func (h *Handler) platformDeleteNodes(req *restful.Request, resp *restful.Response) (bool, error) {
	ctx := req.Request.Context()
	value := config.Get(ctx, "services", common.ServiceRestNamespace_+"n", "platform")
	if value.Get() == nil {
		return false, nil
	}
	refused := errors.WithStack(errors.StatusForbidden)
	if _, present, err := auth.TakeNativeProof(req.Request); err != nil || present {
		return true, refused
	}
	var delivery auth.NativeDeleteDelivery
	keys := req.Request.Header.Values("Idempotency-Key")
	if value.Scan(&delivery) != nil || len(keys) != 1 || !auth.NativeActorUUID(keys[0]) ||
		!auth.NativeActorUUID(delivery.NativeRootRef) || delivery.Delete.NativeType == "" ||
		delivery.Delete.ActionVersion <= 0 || !auth.NativeActorUUID(delivery.Delete.ResultExposurePolicyID) || delivery.Delete.ResultExposurePolicyVersion <= 0 {
		return true, refused
	}
	token, err := auth.NativeHumanToken(req.Request)
	if err != nil {
		return true, refused
	}
	domain, err := nativeDeleteDomain(req)
	domains := req.Request.Header.Values("X-Kailo-Native-Delete-Binding")
	if err != nil || domain == "" || len(domains) != 1 || domains[0] != domain {
		return true, refused
	}
	var request rest.DeleteNodesRequest
	if req.ReadEntity(&request) != nil || len(request.Nodes) == 0 {
		return true, refused
	}
	// UI supplies stable node identities as well as its original paths. A
	// pending request can then observe after deletion without re-reading absence.
	ids := make([]string, 0, len(request.Nodes))
	seen := map[string]bool{}
	for _, node := range request.Nodes {
		if !auth.NativeActorUUID(node.GetUuid()) || node.GetPath() == "" || seen[node.Uuid] {
			return true, refused
		}
		seen[node.Uuid] = true
		ids = append(ids, node.Uuid)
	}
	observed, exists, err := delivery.HumanAction(ctx, token, map[string]interface{}{"idempotencyKey": keys[0]})
	if err != nil {
		return true, err
	}
	if !exists {
		// The deployment's actual registered root is the common Resource.
		// resolveResource must return it; no ancestor registration or fallback
		// Resource is invented for a multi-selection.
		selector := map[string]interface{}{"actionKey": "file_storage.delete@v1", "actionVersion": delivery.Delete.ActionVersion,
			"nativeType": delivery.Delete.NativeType, "nativeRef": delivery.NativeRootRef}
		if delivery.WorkspaceID != "" {
			selector["workspaceId"] = delivery.WorkspaceID
		}
		resolved, _, err := delivery.HumanAction(ctx, token, map[string]interface{}{"resolveResource": selector})
		if err != nil {
			return true, err
		}
		resource, ok := resolved["resource"].(map[string]interface{})
		version, versionOK := resource["resourceVersion"].(float64)
		id, idOK := resource["resourceId"].(string)
		if !ok || len(resolved) != 1 || len(resource) != 6 || !idOK || !auth.NativeActorUUID(id) || !versionOK || version <= 0 || version != float64(int64(version)) ||
			resource["nativeType"] != delivery.Delete.NativeType || resource["nativeRef"] != delivery.NativeRootRef || resource["nativeInstanceRef"] != delivery.NativeInstanceRef || resource["nativeScopeRef"] != delivery.NativeScopeRef {
			return true, refused
		}
		root, err := h.GetRouter().ReadNode(ctx, &tree.ReadNodeRequest{Node: &tree.Node{Uuid: delivery.NativeRootRef}})
		if err != nil || root.GetNode().GetUuid() != delivery.NativeRootRef || root.GetNode().GetType() != tree.NodeType_COLLECTION || root.GetNode().GetPath() == "" {
			return true, refused
		}
		for _, selected := range request.Nodes {
			native, err := h.GetRouter().ReadNode(ctx, &tree.ReadNodeRequest{Node: &tree.Node{Path: selected.Path}})
			if err != nil || native.GetNode().GetUuid() != selected.Uuid || (native.Node.Uuid != delivery.NativeRootRef && !strings.HasPrefix(native.Node.Path, root.Node.Path+"/")) {
				return true, refused
			}
		}
		input := map[string]interface{}{"resourceId": id, "nativeObjectRefs": ids, "removePermanently": request.RemovePermanently}
		encodedInput, err := json.Marshal(input)
		if err != nil {
			return true, refused
		}
		command := map[string]interface{}{"actionKey": "file_storage.delete@v1", "idempotencyKey": keys[0], "resourceId": id, "resourceVersion": version,
			"componentAction": map[string]interface{}{"actionVersion": delivery.Delete.ActionVersion, "inputJson": string(encodedInput),
				"resultExposurePolicyId": delivery.Delete.ResultExposurePolicyID, "resultExposurePolicyVersion": delivery.Delete.ResultExposurePolicyVersion}}
		if delivery.WorkspaceID != "" {
			command["workspaceId"] = delivery.WorkspaceID
		}
		observed, _, err = delivery.HumanAction(ctx, token, map[string]interface{}{"command": command})
		if err != nil {
			return true, err
		}
	}
	encodedInput, inputOK := observed["inputJson"].(string)
	var input map[string]interface{}
	if !inputOK || json.Unmarshal([]byte(encodedInput), &input) != nil {
		return true, refused
	}
	canonicalInput, canonicalErr := json.Marshal(input)
	if canonicalErr != nil || string(canonicalInput) != encodedInput {
		return true, refused
	}
	submission, submissionOK := observed["submission"].(map[string]interface{})
	for key := range observed {
		if key != "inputJson" && key != "submission" && key != "terminalStatus" && key != "nativeType" && key != "nativeId" {
			return true, refused
		}
	}
	actualIDs, encodeErr := json.Marshal(input["nativeObjectRefs"])
	expectedIDs, _ := json.Marshal(ids)
	resourceID, _ := input["resourceId"].(string)
	op, _ := submission["operationId"].(string)
	ae, _ := submission["actionExecutionId"].(string)
	if !inputOK || len(input) != 3 || !auth.NativeActorUUID(resourceID) || encodeErr != nil || string(actualIDs) != string(expectedIDs) || input["removePermanently"] != request.RemovePermanently ||
		!submissionOK || !auth.NativeActorUUID(op) || !auth.NativeActorUUID(ae) || submission["actionKey"] != "file_storage.delete@v1" {
		return true, refused
	}
	switch submission["gateState"] {
	case "EVALUATING", "WAITING", "ALLOWED", "DENIED", "REVOKED", "EXPIRED":
	default:
		return true, refused
	}
	switch submission["dispatchState"] {
	case "NOT_DISPATCHED", "DISPATCHED", "ABORTED", "UNKNOWN":
	default:
		return true, refused
	}
	resp.Header().Set("Cache-Control", "no-store")
	if terminal, present := observed["terminalStatus"]; present {
		switch terminal {
		case "COMPLETED":
			if submission["gateState"] != "ALLOWED" || submission["dispatchState"] != "DISPATCHED" || observed["nativeType"] != "job" || observed["nativeId"] != keys[0] {
				return true, refused
			}
			return true, resp.WriteEntity(&rest.DeleteNodesResponse{})
		case "FAILED", "CANCELED":
			return true, resp.WriteHeaderAndJson(http.StatusAccepted, observed, restful.MIME_JSON)
		default:
			return true, refused
		}
	}
	if (submission["gateState"] == "DENIED" || submission["gateState"] == "REVOKED" || submission["gateState"] == "EXPIRED") &&
		(submission["dispatchState"] == "NOT_DISPATCHED" || submission["dispatchState"] == "ABORTED") {
		return true, refused
	}
	return true, resp.WriteHeaderAndJson(http.StatusAccepted, observed, restful.MIME_JSON)
}
