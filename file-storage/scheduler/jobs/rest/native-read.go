package rest

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
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

// Dispatch alone is untrusted; each branch verifies its own original PEP,
// transport subject, actor, input and native Task before returning any evidence.
func nativeTaskObservation(req *restful.Request, resp *restful.Response, proof string) error {
	data, err := base64.RawURLEncoding.DecodeString(proof)
	var envelope struct {
		ArgumentsJSON string `json:"argumentsJson"`
		ActionToken   string `json:"actionToken"`
	}
	var reference struct {
		NativeType string `json:"nativeType"`
	}
	if err != nil || json.Unmarshal(data, &envelope) != nil || json.Unmarshal([]byte(envelope.ArgumentsJSON), &reference) != nil {
		return errors.WithStack(errors.StatusForbidden)
	}
	if reference.NativeType == "version" {
		return nativeWriteObservation(req, resp, proof)
	}
	if reference.NativeType != "node" {
		parts := strings.Split(envelope.ActionToken, ".")
		if len(parts) != 3 {
			return errors.WithStack(errors.StatusForbidden)
		}
		payload, er := base64.RawURLEncoding.DecodeString(parts[1])
		var claims map[string]interface{}
		if er != nil || json.Unmarshal(payload, &claims) != nil || (claims["action_key"] != "file_storage.read@v1" && claims["action_key"] != "file_storage.export@v1" && claims["action_key"] != "file_storage.list_revisions@v1" && claims["action_key"] != "file_storage.list@v1") {
			return errors.WithStack(errors.StatusForbidden)
		}
	}
	operation := req.Request.Header.Get("X-Kailo-Native-Operation")
	req.Request.Header.Del("X-Kailo-Native-Operation")
	read, err := auth.NativeReadAuthority(req.Request, proof, operation, true)
	if err != nil {
		return err
	}
	if operation == "execute" && reference.NativeType != "" {
		return errors.WithStack(errors.StatusForbidden)
	}
	ctx := req.Request.Context()
	policy, err := idm.NewPolicyEngineServiceClient(grpc.ResolveConn(ctx, common.ServicePolicyGRPC)).IsAllowed(ctx, authorizations.HTTPPolicyRequest(req.Request))
	if err != nil || !policy.GetAllowed() {
		return errors.WithStack(errors.StatusForbidden)
	}
	var request jobs.ListJobsRequest
	if req.ReadEntity(&request) != nil || len(request.JobIDs) != 1 || request.JobIDs[0] != read.Delivery.Read.NativeJobID ||
		request.LoadTasks != jobs.TaskStatus_Any || request.Owner != "" || request.EventsOnly || request.TimersOnly || request.TasksOffset != 0 || request.TasksLimit != 0 {
		return errors.WithStack(errors.StatusForbidden)
	}
	current, ok := claim.FromContext(ctx)
	if !ok {
		return errors.WithStack(errors.StatusForbidden)
	}
	task, err := jobstore.ReadNativeWriteTask(ctx, read.Delivery.Read.NativeJobID, read.Key, read.Delivery.MaxResponseBytes)
	if err != nil {
		return err
	}
	if err := read.Fresh(ctx, operation); err != nil {
		return err
	}
	answer := map[string]interface{}{"idempotencyKey": read.Key, "nativeType": "node", "platformStatus": "UNKNOWN", "cancelCapability": "UNSUPPORTED", "lastObservedAt": time.Now().UTC().Format(time.RFC3339Nano)}
	response := map[string]interface{}{"execution": answer, "found": task != nil}
	if task != nil {
		if !jobstore.NativeReadTaskMatches(task, read, current.Subject) {
			return errors.WithStack(errors.StatusForbidden)
		}
		receipt, receiptErr := jobstore.NativeReadTaskReceipt(task)
		if receiptErr == nil {
			if id, present := read.Input["nativeId"]; present && id != receipt.NativeObjectRef {
				return errors.WithStack(errors.StatusConflict)
			}
			answer["nativeId"], answer["platformStatus"], answer["terminalAt"] = receipt.NativeObjectRef, "SUCCEEDED", receipt.CompletedAt
			response["contentBytes"], response["contentSha256"] = receipt.ContentBytes, receipt.ContentSHA256
			if receipt.ContentReference != nil {
				response["contentReference"] = receipt.ContentReference
			}
			response["measurements"] = receipt.Measurements
		} else if task.Status == jobs.TaskStatus_Running && task.StartTime > 0 && task.EndTime == 0 {
			answer["platformStatus"] = "RUNNING"
		}
	}
	if answer["platformStatus"] != "SUCCEEDED" {
		if _, present := read.Input["nativeId"]; present {
			return errors.WithStack(errors.StatusConflict)
		}
	}
	resp.Header().Set("X-Kailo-Native-Actor", read.Delivery.TenantID+":"+read.Delivery.BindingID+":"+actorKind(read.Claims)+":"+claimText(read.Claims, "actor_principal_id"))
	return resp.WriteHeaderAndJson(http.StatusOK, response, "application/json")
}
