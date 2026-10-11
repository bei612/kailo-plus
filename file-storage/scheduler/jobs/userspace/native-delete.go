package userspace

import (
	"context"

	"google.golang.org/protobuf/proto"

	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/auth/claim"
	"github.com/pydio/cells/v5/common/client/commons/jobsc"
	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/proto/jobs"
	jobstore "github.com/pydio/cells/v5/scheduler/jobs"
)

// DeleteNodesGoverned only resolves an existing immutable claim. New managed
// deletion is closed until the delayed native worker can freshly authorize the
// same platform execution. A request-local token or stored digest cannot grant
// that permission; independent DeleteNodesTask remains unchanged.
func DeleteNodesGoverned(ctx context.Context, delivery auth.NativeDeleteDelivery, key string, claims, input map[string]interface{}) (*jobs.Task, error) {
	current, valid := claim.FromContext(ctx)
	if !valid || !auth.NativeActorUUID(key) || claims["idempotency_key"] != key || claims["action_key"] != "file_storage.delete@v1" {
		return nil, errors.WithStack(errors.StatusForbidden)
	}
	client := jobsc.JobServiceClient(ctx)
	job, err := client.GetJob(ctx, &jobs.GetJobRequest{JobID: delivery.Delete.NativeJobID})
	if err != nil || !jobstore.NativeReadJobMatches(job.GetJob(), delivery.Delete.NativeJobID) {
		return nil, errors.WithStack(errors.StatusForbidden)
	}
	expected, err := jobstore.NewNativeWriteTask(delivery.BindingID, delivery.Delete.NativeJobID, key, current.Name, current.Subject, claims, input)
	if err != nil {
		return nil, err
	}
	existing, err := jobstore.ReadNativeWriteTask(ctx, delivery.Delete.NativeJobID, key, delivery.MaxResponseBytes)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, errors.WithMessage(errors.StatusForbidden, "managed deletion lacks delayed execution authority")
	}
	if existing.TriggerOwner != current.Name || !jobstore.NativeWriteTaskMatches(existing, delivery.BindingID, current.Subject, claims) || len(existing.ActionsLogs) == 0 || !proto.Equal(existing.ActionsLogs[0], expected.ActionsLogs[0]) {
		return nil, errors.WithStack(errors.StatusConflict)
	}
	return existing, nil
}
