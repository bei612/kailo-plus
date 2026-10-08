package restv2

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"strings"

	restful "github.com/emicklei/go-restful/v3"
	"github.com/pborman/uuid"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/auth/claim"
	"github.com/pydio/cells/v5/common/auth/protocol"
	"github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/middleware/authorizations"
	"github.com/pydio/cells/v5/common/proto/idm"
	"github.com/pydio/cells/v5/common/proto/tree"
)

// This is controlled native delivery, not another identity or permission
// directory. It links exact platform actors to pre-existing Cells users. Native
// user locks and native ACLs remain authoritative inside this service.
type nativeActorDelivery struct {
	protocol.Delivery
	TenantID          string `json:"tenantId"`
	NativeInstanceRef string `json:"nativeInstanceRef"`
	NativeScopeRef    string `json:"nativeScopeRef"`
	NativeRootRef     string `json:"nativeRootRef"`
	Actors            []struct {
		PrincipalID string `json:"principalId"`
		Kind        string `json:"kind"`
		UserUUID    string `json:"userUuid"`
	} `json:"actors"`
}

func actorUUID(value string) bool {
	id := uuid.Parse(value)
	return id != nil && id.String() == value && value != "00000000-0000-0000-0000-000000000000"
}

func (d nativeActorDelivery) user(tenant, principal, kind string) (string, error) {
	refused := errors.WithStack(errors.StatusForbidden)
	if !actorUUID(d.TenantID) || tenant != d.TenantID || !actorUUID(principal) ||
		!actorUUID(d.NativeScopeRef) || !actorUUID(d.NativeRootRef) || d.NativeInstanceRef == "" {
		return "", refused
	}
	principals, users := map[string]bool{}, map[string]bool{}
	selected := ""
	for _, link := range d.Actors {
		if !actorUUID(link.PrincipalID) || !actorUUID(link.UserUUID) ||
			(link.Kind != "HUMAN" && link.Kind != "AGENT") || principals[link.PrincipalID] || users[link.UserUUID] ||
			link.UserUUID == d.InstanceServiceUUID {
			return "", refused
		}
		principals[link.PrincipalID], users[link.UserUUID] = true, true
		if link.PrincipalID == principal && link.Kind == kind {
			selected = link.UserUUID
		}
	}
	if selected == "" {
		return "", refused
	}
	return selected, nil
}

// nativeActor runs inside the original JWT-authenticated handler, never in an
// outer pre-auth middleware. A legacy native that ignores the proof cannot
// satisfy the adapter's mandatory acknowledgement. Without a proof the original
// independent native UI continues through exactly its original user/ACL path.
func (h *Handler) nativeActor(req *restful.Request, resp *restful.Response, requested, operation string) error {
	proofs := req.Request.Header.Values("X-Kailo-Native-Execution")
	// Do not retain a credential-bearing proof on the original request object
	// used by downstream native handlers and diagnostics.
	req.Request.Header.Del("X-Kailo-Native-Execution")
	if len(proofs) == 0 {
		return nil
	}
	refused := errors.WithStack(errors.StatusForbidden)
	ctx := req.Request.Context()
	var delivery nativeActorDelivery
	if len(proofs) != 1 || config.Get(ctx, "services", common.ServiceRestNamespace_+"n", "platform").Scan(&delivery) != nil ||
		delivery.MaxResponseBytes <= 0 || int64(len(proofs[0])) > delivery.MaxResponseBytes || !actorUUID(requested) {
		return refused
	}
	transport, ok := claim.FromContext(ctx)
	if !ok || !actorUUID(delivery.InstanceServiceUUID) || transport.Subject != delivery.InstanceServiceUUID {
		return refused
	}
	data, err := base64.RawURLEncoding.DecodeString(proofs[0])
	var proof struct {
		ActionToken   string `json:"actionToken"`
		ArgumentsJSON string `json:"argumentsJson"`
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err != nil || decoder.Decode(&proof) != nil || decoder.Decode(new(interface{})) != io.EOF {
		return refused
	}
	claims, target, err := delivery.AuthorizeAction(ctx, proof.ActionToken, proof.ArgumentsJSON)
	if err != nil || target["nativeInstanceRef"] != delivery.NativeInstanceRef || target["nativeScopeRef"] != delivery.NativeScopeRef {
		return refused
	}
	principal, principalOK := claims["actor_principal_id"].(string)
	tenant, tenantOK := claims["tenant_id"].(string)
	kind := "HUMAN"
	if agent, exists := claims["agent_principal_id"]; exists {
		kind = "AGENT"
		if agent != principal || !actorUUID(stringClaim(claims, "delegation_id")) {
			return refused
		}
	} else if claims["initiating_human_principal_id"] != principal {
		return refused
	}
	if !principalOK || !tenantOK {
		return refused
	}
	action := stringClaim(claims, "action_key")
	listing := action == "file_storage.list@v1"
	if !listing && action != "file_storage.read@v1" && action != "file_storage.list_revisions@v1" && action != "file_storage.export@v1" {
		return refused
	}
	var args map[string]interface{}
	if json.Unmarshal([]byte(proof.ArgumentsJSON), &args) != nil || len(args) != 2 {
		return refused
	}
	input, inputOK := args["input"].(map[string]interface{})
	argumentTarget, targetOK := args["target"].(map[string]interface{})
	inputSize := 5
	if listing {
		inputSize = 1
	} else if action == "file_storage.list_revisions@v1" {
		inputSize = 2
	}
	if !inputOK || !targetOK || len(argumentTarget) != 1 || argumentTarget["resourceId"] != target["resourceId"] || input["resourceId"] != target["resourceId"] ||
		len(input) != inputSize ||
		(!listing && !actorUUID(stringClaim(input, "nativeObjectRef"))) ||
		(operation == "lookup" && !listing) || (operation != "node" && operation != "lookup" && operation != "versions") {
		return refused
	}
	nativeUUID, err := delivery.user(tenant, principal, kind)
	if err != nil {
		return refused
	}
	user, err := auth.ResolveNativeUser(ctx, nativeUUID)
	if err != nil {
		return refused
	}
	ctx = auth.WithImpersonate(ctx, user)
	policy, err := idm.NewPolicyEngineServiceClient(grpc.ResolveConn(ctx, common.ServicePolicyGRPC)).IsAllowed(ctx,
		authorizations.HTTPPolicyRequest(req.Request.WithContext(ctx)))
	if err != nil || !policy.GetAllowed() {
		return refused
	}
	router := h.UuidClient(true)
	// Read through the original native ACL router after impersonation. Resolve
	// both roots and the actual REST target, not caller-supplied paths. The root
	// metadata lookup required to establish containment is the only ancestor
	// lookup; list/version/body access is restricted to the admitted subtree.
	read := func(id string) (*tree.Node, error) {
		r, er := router.ReadNode(ctx, &tree.ReadNodeRequest{Node: &tree.Node{Uuid: id}})
		if er != nil || r.GetNode() == nil || r.GetNode().GetUuid() != id {
			return nil, refused
		}
		node := r.GetNode()
		converted := h.TreeNodeToNode(ctx, node)
		path := node.GetPath()
		if converted.ContextWorkspace.GetUuid() != delivery.NativeScopeRef || path == "" ||
			strings.ContainsAny(path, "\\\x00\r\n") || strings.HasSuffix(path, "/") {
			return nil, refused
		}
		for _, part := range strings.Split(path, "/") {
			if part == "." || part == ".." {
				return nil, refused
			}
		}
		return node, nil
	}
	root, err := read(delivery.NativeRootRef)
	if err != nil || root.GetType() != tree.NodeType_COLLECTION {
		return refused
	}
	admitted, err := read(target["nativeRef"].(string))
	if err != nil || (admitted.GetUuid() != root.GetUuid() && !strings.HasPrefix(admitted.GetPath(), root.GetPath()+"/")) {
		return refused
	}
	node, err := read(requested)
	if err != nil {
		return refused
	}
	within := node.GetUuid() == admitted.GetUuid() || (admitted.GetType() == tree.NodeType_COLLECTION && strings.HasPrefix(node.GetPath(), admitted.GetPath()+"/"))
	if operation == "node" && requested == root.GetUuid() {
		within = true
	}
	if !within || (operation == "lookup" && node.GetType() != tree.NodeType_COLLECTION) ||
		(operation == "versions" && (node.GetType() != tree.NodeType_LEAF || (!listing && requested != input["nativeObjectRef"]))) ||
		(operation == "node" && !listing && requested != root.GetUuid() && requested != admitted.GetUuid() && requested != input["nativeObjectRef"]) {
		return refused
	}
	req.Request = req.Request.WithContext(ctx)
	resp.Header().Set("X-Kailo-Native-Actor", tenant+":"+delivery.BindingID+":"+kind+":"+principal)
	return nil
}

func stringClaim(value map[string]interface{}, key string) string {
	text, _ := value[key].(string)
	return text
}
