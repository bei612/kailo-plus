package rest

import (
	"encoding/json"
	"net/http"

	restful "github.com/emicklei/go-restful/v3"
	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/proto/rest"
)

// Creation and policy editing retain the independent native implementation;
// the governed share release is not complete until those writers are admitted.
func nativeShareUnsupported(req *restful.Request) error {
	_, proof, err := auth.TakeNativeProof(req.Request)
	if err != nil {
		return err
	}
	if proof || config.Get(req.Request.Context(), "services", common.ServiceRestNamespace_+"n", "platform").Get() != nil {
		return errors.WithStack(errors.StatusForbidden)
	}
	return nil
}

func nativeShareDomain(req *restful.Request) (string, error) {
	value := config.Get(req.Request.Context(), "services", common.ServiceRestNamespace_+"n", "platform")
	if value.Get() == nil {
		return "", nil
	}
	var delivery auth.NativeCellShareDelivery
	var sharing auth.NativeShareDelivery
	if value.Scan(&delivery) != nil || value.Scan(&sharing) != nil {
		return "", errors.WithStack(errors.StatusForbidden)
	}
	if sharing.Share.NativeJobID == "" {
		return "", nil
	}
	if delivery.Validate() != nil {
		return "", errors.WithStack(errors.StatusForbidden)
	}
	body, err := json.Marshal(map[string]interface{}{"bindingId": delivery.BindingID, "tenantId": delivery.TenantID, "generation": delivery.CellShare.BindingGeneration})
	return string(body), err
}

func (h *SharesHandler) nativeRevokeShare(req *restful.Request, rsp *restful.Response, id string) (bool, error) {
	refused := errors.WithStack(errors.StatusForbidden)
	proof, present, err := auth.TakeNativeProof(req.Request)
	if err != nil {
		return true, err
	}
	if present {
		transport := req.Request.Clone(req.Request.Context())
		result, err := h.sc.NativeShareExecution(req.Request, proof, "execute", id)
		if err != nil {
			return true, err
		}
		delivery, claims, _, _, _, err := auth.NativeShareAuthority(transport, proof, "execute")
		if err != nil {
			return true, err
		}
		kind := "HUMAN"
		if claims["agent_principal_id"] != nil {
			kind = "AGENT"
		}
		actor, _ := claims["actor_principal_id"].(string)
		rsp.Header().Set("X-Kailo-Native-Actor", delivery.TenantID+":"+delivery.BindingID+":"+kind+":"+actor)
		rsp.Header().Set("Cache-Control", "no-store")
		return true, rsp.WriteHeaderAndJson(http.StatusOK, result, restful.MIME_JSON)
	}
	value := config.Get(req.Request.Context(), "services", common.ServiceRestNamespace_+"n", "platform")
	if value.Get() == nil {
		return false, nil
	}
	var delivery auth.NativeShareDelivery
	keys := req.Request.Header.Values("Idempotency-Key")
	if value.Scan(&delivery) != nil || !auth.NativeActorUUID(id) || len(keys) != 1 || !auth.NativeActorUUID(keys[0]) ||
		delivery.Share.NativeJobID == "" || delivery.Share.NativeType == "" || delivery.Share.ActionVersion <= 0 ||
		!auth.NativeActorUUID(delivery.Share.ResultExposurePolicyID) || delivery.Share.ResultExposurePolicyVersion <= 0 {
		return true, refused
	}
	domain, err := nativeShareDomain(req)
	domains := req.Request.Header.Values("X-Kailo-Native-Share-Binding")
	if err != nil || domain == "" || len(domains) != 1 || domains[0] != domain {
		return true, refused
	}
	token, err := auth.NativeHumanToken(req.Request)
	if err != nil {
		return true, err
	}
	ctx := req.Request.Context()
	observed, exists, err := delivery.HumanAction(ctx, token, map[string]interface{}{"idempotencyKey": keys[0]})
	if err != nil {
		return true, err
	}
	if !exists {
		link, err := h.sc.LinkById(ctx, id)
		if err != nil || !link.GetPoliciesContextEditable() {
			return true, refused
		}
		selector := map[string]interface{}{"actionKey": "file_storage.share@v2", "actionVersion": delivery.Share.ActionVersion,
			"nativeType": delivery.Share.NativeType, "nativeRef": delivery.NativeRootRef}
		if delivery.WorkspaceID != "" {
			selector["workspaceId"] = delivery.WorkspaceID
		}
		resolved, _, err := delivery.HumanAction(ctx, token, map[string]interface{}{"resolveResource": selector})
		if err != nil {
			return true, err
		}
		resource, _ := resolved["resource"].(map[string]interface{})
		resourceID, _ := resource["resourceId"].(string)
		version, _ := resource["resourceVersion"].(float64)
		if len(resolved) != 1 || len(resource) != 6 || !auth.NativeActorUUID(resourceID) || version <= 0 || version != float64(int64(version)) ||
			resource["nativeType"] != delivery.Share.NativeType || resource["nativeRef"] != delivery.NativeRootRef ||
			resource["nativeScopeRef"] != delivery.NativeScopeRef || resource["nativeInstanceRef"] != delivery.NativeInstanceRef {
			return true, refused
		}
		input, err := json.Marshal(map[string]interface{}{"resourceId": resourceID, "nativeShareRef": id, "operation": "REVOKE"})
		if err != nil {
			return true, err
		}
		command := map[string]interface{}{"actionKey": "file_storage.share@v2", "idempotencyKey": keys[0], "resourceId": resourceID, "resourceVersion": version,
			"componentAction": map[string]interface{}{"actionVersion": delivery.Share.ActionVersion, "inputJson": string(input),
				"resultExposurePolicyId": delivery.Share.ResultExposurePolicyID, "resultExposurePolicyVersion": delivery.Share.ResultExposurePolicyVersion}}
		if delivery.WorkspaceID != "" {
			command["workspaceId"] = delivery.WorkspaceID
		}
		observed, exists, err = delivery.HumanAction(ctx, token, map[string]interface{}{"command": command})
		if err != nil || !exists {
			return true, refused
		}
	}
	encoded, _ := observed["inputJson"].(string)
	var input map[string]interface{}
	if json.Unmarshal([]byte(encoded), &input) != nil {
		return true, refused
	}
	canonical, _ := json.Marshal(input)
	resourceID, _ := input["resourceId"].(string)
	if len(input) != 3 || string(canonical) != encoded || !auth.NativeActorUUID(resourceID) || input["operation"] != "REVOKE" || input["nativeShareRef"] != id {
		return true, refused
	}
	submission, _ := observed["submission"].(map[string]interface{})
	op, _ := submission["operationId"].(string)
	ae, _ := submission["actionExecutionId"].(string)
	if submission["actionKey"] != "file_storage.share@v2" || !auth.NativeActorUUID(op) || !auth.NativeActorUUID(ae) {
		return true, refused
	}
	for key := range observed {
		if key != "inputJson" && key != "submission" && key != "terminalStatus" && key != "nativeType" && key != "nativeId" {
			return true, refused
		}
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
	rsp.Header().Set("Cache-Control", "no-store")
	if terminal, present := observed["terminalStatus"]; present {
		switch terminal {
		case "COMPLETED":
			if submission["gateState"] != "ALLOWED" || submission["dispatchState"] != "DISPATCHED" || observed["nativeType"] != "job" || observed["nativeId"] != keys[0] {
				return true, refused
			}
			return true, rsp.WriteEntity(&rest.DeleteShareLinkResponse{Success: true})
		case "FAILED", "CANCELED":
		default:
			return true, refused
		}
	}
	return true, rsp.WriteHeaderAndJson(http.StatusAccepted, observed, restful.MIME_JSON)
}
