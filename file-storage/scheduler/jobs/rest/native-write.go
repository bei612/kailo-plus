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

// This is the original native job-list entry, not another task registry/API.
// A proof selects only its exact previously claimed native Task; independent
// native UI callers retain the original owner-filtered jobs response unchanged.
func nativeWriteObservation(req *restful.Request, resp *restful.Response, proof string) error {
	operation := req.Request.Header.Get("X-Kailo-Native-Operation")
	req.Request.Header.Del("X-Kailo-Native-Operation")
	if operation != "observe" && operation != "extract_usage" {
		return errors.WithStack(errors.StatusForbidden)
	}
	transport := req.Request.Clone(req.Request.Context())
	delivery, claims, _, raw, err := auth.NativeWriteAuthority(req.Request, proof, operation)
	if err != nil {
		return err
	}
	policy, err := idm.NewPolicyEngineServiceClient(grpc.ResolveConn(req.Request.Context(), common.ServicePolicyGRPC)).IsAllowed(req.Request.Context(), authorizations.HTTPPolicyRequest(req.Request))
	if err != nil || !policy.GetAllowed() {
		return errors.WithStack(errors.StatusForbidden)
	}
	var args map[string]interface{}
	if json.Unmarshal([]byte(raw), &args) != nil || (len(args) != 3 && len(args) != 4) || args["nativeType"] != "version" || !auth.NativeActorUUID(claimText(args, "externalExecutionId")) || !auth.NativeActorUUID(claimText(args, "idempotencyKey")) {
		return errors.WithStack(errors.StatusForbidden)
	}
	if _, present := args["nativeId"]; present && claimText(args, "nativeId") == "" {
		return errors.WithStack(errors.StatusForbidden)
	}
	for key := range args {
		if key != "externalExecutionId" && key != "idempotencyKey" && key != "nativeType" && key != "nativeId" {
			return errors.WithStack(errors.StatusForbidden)
		}
	}
	var request jobs.ListJobsRequest
	if req.ReadEntity(&request) != nil || len(request.JobIDs) != 1 || request.JobIDs[0] != delivery.Write.NativeJobID || request.LoadTasks != jobs.TaskStatus_Any || request.Owner != "" || request.EventsOnly || request.TimersOnly || request.TasksOffset != 0 || request.TasksLimit != 0 {
		return errors.WithStack(errors.StatusForbidden)
	}
	current, ok := claim.FromContext(req.Request.Context())
	if !ok {
		return errors.WithStack(errors.StatusForbidden)
	}
	task, err := jobstore.ReadNativeWriteTask(req.Request.Context(), delivery.Write.NativeJobID, claimText(args, "idempotencyKey"), delivery.MaxResponseBytes)
	if err != nil {
		return err
	}
	if _, _, _, _, er := auth.NativeWriteAuthority(transport, proof, operation); er != nil {
		return er
	}
	answer := map[string]interface{}{"idempotencyKey": args["idempotencyKey"], "nativeType": "version", "platformStatus": "UNKNOWN", "cancelCapability": "UNSUPPORTED", "lastObservedAt": time.Now().UTC().Format(time.RFC3339Nano)}
	if task != nil {
		if !jobstore.NativeWriteTaskMatches(task, delivery.BindingID, current.Subject, claims) {
			return errors.WithStack(errors.StatusForbidden)
		}
		revision, revisionError := jobstore.NativeWriteRevision(task)
		if revisionError == nil {
			if nativeID, present := args["nativeId"]; present && nativeID != revision.VersionId {
				return errors.WithStack(errors.StatusConflict)
			}
			intent, _ := jobstore.NativeWriteTaskIntent(task)
			answer["nativeId"], answer["platformStatus"], answer["terminalAt"] = revision.VersionId, "SUCCEEDED", time.Unix(int64(task.EndTime), 0).UTC().Format(time.RFC3339)
			content := intent.InputReference
			// Retain only original metadata; no native body or task log is disclosed.
			content = map[string]interface{}{"resourceId": content["resourceId"], "nativeRevision": revision.VersionId, "displayName": content["displayName"], "mediaType": content["mediaType"]}
			// The native node is frozen in the original command reference, not a
			// second resource directory. Decode only the already persisted intent.
			var reference struct {
				NodeUUID string `json:"nodeUuid"`
				Publish  bool   `json:"publish"`
			}
			if json.Unmarshal([]byte(claimText(intent.InputReference, "nativeObjectRef")), &reference) != nil || !auth.NativeActorUUID(reference.NodeUUID) || reference.Publish {
				return errors.WithStack(errors.StatusConflict)
			}
			content["nativeObjectRef"] = reference.NodeUUID
			resp.Header().Set("X-Kailo-Native-Actor", delivery.TenantID+":"+delivery.BindingID+":"+actorKind(claims)+":"+claimText(claims, "actor_principal_id"))
			return resp.WriteHeaderAndJson(http.StatusOK, map[string]interface{}{"execution": answer, "contentReference": content, "contentBytes": revision.Size}, "application/json")
		}
		if task.Status == jobs.TaskStatus_Running && task.StartTime > 0 && task.EndTime == 0 {
			answer["platformStatus"] = "RUNNING"
		}
	}
	if _, present := args["nativeId"]; present {
		return errors.WithStack(errors.StatusConflict)
	}
	resp.Header().Set("X-Kailo-Native-Actor", delivery.TenantID+":"+delivery.BindingID+":"+actorKind(claims)+":"+claimText(claims, "actor_principal_id"))
	return resp.WriteHeaderAndJson(http.StatusOK, map[string]interface{}{"execution": answer}, "application/json")
}

func claimText(value map[string]interface{}, key string) string {
	text, _ := value[key].(string)
	return text
}
func actorKind(claims map[string]interface{}) string {
	if _, present := claims["agent_principal_id"]; present {
		return "AGENT"
	}
	return "HUMAN"
}
