package rest

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"google.golang.org/grpc/metadata"
	"io"
	"net/http"
	"time"

	restful "github.com/emicklei/go-restful/v3"
	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/auth/claim"
	"github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/middleware/authorizations"
	"github.com/pydio/cells/v5/common/proto/idm"
	"github.com/pydio/cells/v5/common/proto/jobs"
	"github.com/pydio/cells/v5/idm/share"
)

// Same original jobs/user route and transient proof transport. Management
// observation cannot impersonate a HUMAN or authorize native business writes.
func nativeBindingReconcile(req *restful.Request, resp *restful.Response, proof string) error {
	refused := errors.WithStack(errors.StatusForbidden)
	if len(req.Request.Header.Values("X-Kailo-Native-Operation")) != 1 {
		return refused
	}
	req.Request.Header.Del("X-Kailo-Native-Operation")
	var delivery auth.NativeCellShareDelivery
	ctx := req.Request.Context()
	if config.Get(ctx, "services", common.ServiceRestNamespace_+"n", "platform").Scan(&delivery) != nil ||
		delivery.Validate() != nil || int64(len(proof)) > delivery.MaxResponseBytes {
		return refused
	}
	current, ok := claim.FromContext(ctx)
	if !ok || current.Subject != delivery.InstanceServiceUUID {
		return refused
	}
	timeout, err := time.ParseDuration(delivery.RequestTimeout)
	if err != nil || timeout <= 0 {
		return refused
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	data, err := base64.RawURLEncoding.DecodeString(proof)
	var envelope struct {
		ActionToken   string `json:"actionToken"`
		ArgumentsJSON string `json:"argumentsJson"`
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err != nil || decoder.Decode(&envelope) != nil || decoder.Decode(new(interface{})) != io.EOF {
		return refused
	}
	var reference map[string]interface{}
	if json.Unmarshal([]byte(envelope.ArgumentsJSON), &reference) != nil || len(reference) != 6 ||
		reference["bindingId"] != delivery.BindingID || reference["generation"] != float64(delivery.CellShare.BindingGeneration) ||
		reference["nativeInstanceRef"] != delivery.NativeInstanceRef || reference["nativeScopeRef"] != delivery.NativeScopeRef {
		return refused
	}
	key, keyOK := reference["idempotencyKey"].(string)
	digest, digestOK := reference["configDigest"].(string)
	if !keyOK || !auth.NativeActorUUID(key) || !digestOK || len(digest) != 64 {
		return refused
	}
	claims, _, err := delivery.AuthorizeOperation(ctx, envelope.ActionToken, envelope.ArgumentsJSON, "reconcile")
	if err != nil || claims["tenant_id"] != delivery.TenantID || claims["target_id"] != delivery.BindingID ||
		claims["target_type"] != "APPLICATION_BINDING" || claims["action_execution_id"] != key ||
		(claims["action_key"] != "application_binding.create" && claims["action_key"] != "application_binding.disable") {
		return refused
	}
	policy, err := idm.NewPolicyEngineServiceClient(grpc.ResolveConn(ctx, common.ServicePolicyGRPC)).IsAllowed(ctx, authorizations.HTTPPolicyRequest(req.Request))
	if err != nil || !policy.GetAllowed() {
		return refused
	}
	var request jobs.ListJobsRequest
	if req.ReadEntity(&request) != nil || len(request.JobIDs) != 1 || request.JobIDs[0] != delivery.CellShare.NativeJobID ||
		request.LoadTasks != jobs.TaskStatus_Any || request.Owner != "" || request.EventsOnly || request.TimersOnly || request.TasksOffset != 0 || request.TasksLimit != 0 {
		return refused
	}
	ctx = metadata.AppendToOutgoingContext(ctx, "x-kailo-binding-reconcile", proof)
	items, err := share.ReconcileNativeCells(ctx, delivery, true)
	if err != nil {
		return err
	}
	if _, _, err = delivery.AuthorizeOperation(ctx, envelope.ActionToken, envelope.ArgumentsJSON, "reconcile"); err != nil {
		return refused
	}
	response := map[string]interface{}{"reference": reference, "complete": true, "observations": items}
	body, err := json.Marshal(response)
	if err != nil || int64(len(body)) > delivery.MaxResponseBytes {
		return errors.WithStack(errors.ServiceError)
	}
	resp.Header().Set("X-Kailo-Native-Actor", delivery.TenantID+":"+delivery.BindingID+":RECONCILE:"+key)
	return resp.WriteHeaderAndJson(http.StatusOK, response, "application/json")
}
