package restv2

import (
	"encoding/json"
	"net/http"
	"time"

	restful "github.com/emicklei/go-restful/v3"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/middleware"
	"github.com/pydio/cells/v5/common/proto/rest"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/scheduler/jobs/userspace"
)

func nativeDeleteInput(input map[string]interface{}) ([]string, bool, bool) {
	if len(input) != 3 || !actorUUID(stringClaim(input, "resourceId")) {
		return nil, false, false
	}
	permanent, valid := input["removePermanently"].(bool)
	values, listOK := input["nativeObjectRefs"].([]interface{})
	if !valid || !listOK || len(values) == 0 {
		return nil, false, false
	}
	seen := map[string]bool{}
	nodes := make([]string, 0, len(values))
	for _, value := range values {
		id, ok := value.(string)
		if !ok || !actorUUID(id) || seen[id] {
			return nil, false, false
		}
		seen[id] = true
		nodes = append(nodes, id)
	}
	return nodes, permanent, true
}

// This is the original v2 delete route. Service transport never supplies the
// native user's ACLs; the existing nativeActor checks each selected UUID under
// the admitted Resource/root before the first durable delete claim.
func (h *Handler) executeNativeDelete(req *restful.Request, resp *restful.Response, proof string) error {
	refused := errors.WithStack(errors.StatusForbidden)
	transport := req.Request.Clone(req.Request.Context())
	verification := transport.Clone(transport.Context())
	delivery, claims, target, raw, err := auth.NativeDeleteAuthority(verification, proof, "execute")
	if err != nil {
		return err
	}
	var args map[string]interface{}
	if json.Unmarshal([]byte(raw), &args) != nil || len(args) != 2 {
		return refused
	}
	input, inputOK := args["input"].(map[string]interface{})
	argumentTarget, targetOK := args["target"].(map[string]interface{})
	nodes, permanent, valid := nativeDeleteInput(input)
	keys := req.Request.Header.Values("Idempotency-Key")
	if !inputOK || !targetOK || len(argumentTarget) != 1 || !valid || argumentTarget["resourceId"] != target["resourceId"] || input["resourceId"] != target["resourceId"] || len(keys) != 1 || !actorUUID(keys[0]) || keys[0] != claims["idempotency_key"] {
		return refused
	}
	parameters := new(rest.ActionParameters)
	if req.ReadEntity(parameters) != nil || len(parameters.Nodes) != len(nodes) || parameters.GetDeleteOptions() == nil || parameters.GetDeleteOptions().GetPermanentDelete() != permanent || parameters.GetCopyMoveOptions() != nil || parameters.GetExtractCompressOptions() != nil || parameters.SelectionUuid != "" || parameters.JsonParameters != "" || parameters.AwaitTimeout != "" || parameters.AwaitStatus != 0 {
		return refused
	}
	for i, node := range parameters.Nodes {
		if node.GetUuid() != nodes[i] || node.GetPath() != "" {
			return refused
		}
	}
	paths := make([]string, 0, len(nodes))
	for _, id := range nodes {
		req.Request = transport.Clone(transport.Context())
		req.Request.Header.Set("X-Kailo-Native-Execution", proof)
		if err := h.nativeActor(req, resp, id, "delete"); err != nil {
			return err
		}
		read, err := h.UuidClient(true).ReadNode(req.Request.Context(), &tree.ReadNodeRequest{Node: &tree.Node{Uuid: id}})
		if err != nil || read.GetNode().GetUuid() != id || read.GetNode().GetPath() == "" {
			return refused
		}
		paths = append(paths, read.Node.Path)
	}
	task, executeErr := userspace.DeleteNodesGoverned(req.Request.Context(), h.TreeHandler.GetRouter(), paths, permanent, delivery,
		decodeNativeProofToken(proof), raw, keys[0], claims, target, input, middleware.DetectedLanguages(req.Request.Context())...)
	if task == nil {
		return executeErr
	}
	// Dispatch acceptance is not deletion completion. The observer will consume
	// the exact claimed native task(s); no HTTP retry executes them a second time.
	if _, _, _, _, err := auth.NativeDeleteAuthority(transport, proof, "execute"); err != nil {
		return err
	}
	resp.Header().Set("Cache-Control", "no-store")
	return resp.WriteHeaderAndJson(http.StatusOK, map[string]interface{}{"execution": map[string]interface{}{
		"idempotencyKey": keys[0], "nativeType": "job", "platformStatus": "UNKNOWN", "cancelCapability": "UNSUPPORTED", "lastObservedAt": time.Now().UTC().Format(time.RFC3339Nano),
	}}, restful.MIME_JSON)
}
