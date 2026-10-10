package rest

import (
	"encoding/json"
	"net/http"
	"time"

	restful "github.com/emicklei/go-restful/v3"
	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/auth/claim"
	"github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/middleware/authorizations"
	"github.com/pydio/cells/v5/common/proto/idm"
	"github.com/pydio/cells/v5/common/proto/jobs"
	jobstore "github.com/pydio/cells/v5/scheduler/jobs"
)

func nativeDeleteObservation(req *restful.Request, resp *restful.Response, proof string) error {
	refused := errors.WithStack(errors.StatusForbidden)
	operation := req.Request.Header.Get("X-Kailo-Native-Operation")
	req.Request.Header.Del("X-Kailo-Native-Operation")
	if operation != "observe" && operation != "extract_usage" {
		return refused
	}
	transport := req.Request.Clone(req.Request.Context())
	delivery, claims, _, raw, err := auth.NativeDeleteAuthority(req.Request, proof, operation)
	if err != nil {
		return err
	}
	policy, err := idm.NewPolicyEngineServiceClient(grpc.ResolveConn(req.Request.Context(), common.ServicePolicyGRPC)).IsAllowed(req.Request.Context(), authorizations.HTTPPolicyRequest(req.Request))
	if err != nil || !policy.GetAllowed() {
		return refused
	}
	var args map[string]interface{}
	if json.Unmarshal([]byte(raw), &args) != nil || (len(args) != 3 && len(args) != 4) || args["nativeType"] != "job" || !auth.NativeActorUUID(claimText(args, "externalExecutionId")) || !auth.NativeActorUUID(claimText(args, "idempotencyKey")) {
		return refused
	}
	for key := range args {
		if key != "externalExecutionId" && key != "idempotencyKey" && key != "nativeType" && key != "nativeId" {
			return refused
		}
	}
	if nativeID, present := args["nativeId"]; present && nativeID != args["idempotencyKey"] {
		return refused
	}
	var request jobs.ListJobsRequest
	if req.ReadEntity(&request) != nil || len(request.JobIDs) != 1 || request.JobIDs[0] != delivery.Delete.NativeJobID || request.LoadTasks != jobs.TaskStatus_Any || request.Owner != "" || request.EventsOnly || request.TimersOnly || request.TasksOffset != 0 || request.TasksLimit != 0 {
		return refused
	}
	current, ok := claim.FromContext(req.Request.Context())
	if !ok {
		return refused
	}
	task, err := jobstore.ReadNativeWriteTask(req.Request.Context(), delivery.Delete.NativeJobID, claimText(args, "idempotencyKey"), delivery.MaxResponseBytes)
	if err != nil {
		return err
	}
	answer := map[string]interface{}{"idempotencyKey": args["idempotencyKey"], "nativeType": "job", "platformStatus": "UNKNOWN", "cancelCapability": "UNSUPPORTED", "lastObservedAt": time.Now().UTC().Format(time.RFC3339Nano)}
	if task != nil {
		if !jobstore.NativeWriteTaskMatches(task, delivery.BindingID, current.Subject, claims) {
			return refused
		}
		if completedAt, terminalError := jobstore.NativeDeleteTerminal(req.Request.Context(), task, delivery.MaxResponseBytes); terminalError == nil {
			answer["nativeId"], answer["platformStatus"], answer["terminalAt"] = task.ID, "SUCCEEDED", time.Unix(int64(completedAt), 0).UTC().Format(time.RFC3339)
		}
	}
	// All child lookups are awaits. No evidence is released on a stale PEP.
	if _, _, _, _, err := auth.NativeDeleteAuthority(transport, proof, operation); err != nil {
		return err
	}
	if _, present := args["nativeId"]; present && answer["platformStatus"] != "SUCCEEDED" {
		return errors.WithStack(errors.StatusConflict)
	}
	resp.Header().Set("X-Kailo-Native-Actor", delivery.TenantID+":"+delivery.BindingID+":"+actorKind(claims)+":"+claimText(claims, "actor_principal_id"))
	resp.Header().Set("Cache-Control", "no-store")
	return resp.WriteHeaderAndJson(http.StatusOK, map[string]interface{}{"execution": answer}, restful.MIME_JSON)
}
