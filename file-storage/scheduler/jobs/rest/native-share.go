package rest

import (
	"net/http"

	restful "github.com/emicklei/go-restful/v3"
	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/proto/jobs"
	"github.com/pydio/cells/v5/idm/share"
)

func nativeShareObservation(req *restful.Request, resp *restful.Response, proof string) error {
	operation := req.Request.Header.Get("X-Kailo-Native-Operation")
	if len(req.Request.Header.Values("X-Kailo-Native-Operation")) != 1 || (operation != "observe" && operation != "extract_usage") {
		return errors.WithStack(errors.StatusForbidden)
	}
	req.Request.Header.Del("X-Kailo-Native-Operation")
	var delivery auth.NativeShareDelivery
	if config.Get(req.Request.Context(), "services", common.ServiceRestNamespace_+"n", "platform").Scan(&delivery) != nil {
		return errors.WithStack(errors.StatusForbidden)
	}
	var request jobs.ListJobsRequest
	if req.ReadEntity(&request) != nil || len(request.JobIDs) != 1 || request.JobIDs[0] != delivery.Share.NativeJobID ||
		request.LoadTasks != jobs.TaskStatus_Any || request.Owner != "" || request.EventsOnly || request.TimersOnly || request.TasksOffset != 0 || request.TasksLimit != 0 {
		return errors.WithStack(errors.StatusForbidden)
	}
	transport := req.Request.Clone(req.Request.Context())
	result, err := share.NewClient(nil).NativeShareExecution(req.Request, proof, operation, "")
	if err != nil {
		return err
	}
	_, claims, _, _, _, err := auth.NativeShareAuthority(transport, proof, operation)
	if err != nil {
		return err
	}
	resp.Header().Set("X-Kailo-Native-Actor", delivery.TenantID+":"+delivery.BindingID+":"+actorKind(claims)+":"+claimText(claims, "actor_principal_id"))
	resp.Header().Set("Cache-Control", "no-store")
	return resp.WriteHeaderAndJson(http.StatusOK, result, restful.MIME_JSON)
}
