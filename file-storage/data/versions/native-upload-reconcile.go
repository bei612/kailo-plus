package versions

import (
	"context"
	"time"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/nodes"
	"github.com/pydio/cells/v5/common/proto/jobs"
	"github.com/pydio/cells/v5/common/proto/tree"
	jobstore "github.com/pydio/cells/v5/scheduler/jobs"
	"google.golang.org/protobuf/proto"
)

// The existing bounded draft sweep owns this housekeeping. It never uploads,
// publishes a revision or obtains an ActionToken. It only finishes the exact
// cleanup frozen before the original StoreVersion side effects, after the
// native byte deadline. Each failed attempt retains the row, Task and owner.
func reconcileNativeUpload(ctx context.Context, dao DAO, router nodes.Client, upload *DraftUpload, now time.Time) error {
	var delivery auth.NativeWriteDelivery
	if err := config.Get(ctx, "services", common.ServiceRestNamespace_+"n", "platform").Scan(&delivery); err != nil {
		return err
	}
	task, err := jobstore.ReadNativeWriteTask(ctx, upload.JobID, upload.TaskID, delivery.MaxResponseBytes)
	if err != nil {
		return err
	}
	intent, err := jobstore.NativeUploadTaskIntent(task)
	if err != nil || task.ID != upload.TaskID ||
		intent.Input["nativeNodeId"] != upload.NodeUuid || intent.Input["nativeIntentId"] != upload.Revision.VersionId ||
		intent.NativeUserID != upload.Revision.OwnerUuid {
		return errors.WithStack(errors.StatusConflict)
	}
	if intent.Input["nativeDeadline"].(float64) > float64(now.Unix()) {
		return nil
	}
	client := jobs.NewJobServiceClient(grpc.ResolveConn(ctx, common.ServiceJobsGRPC))
	job, err := client.GetJob(ctx, &jobs.GetJobRequest{JobID: upload.JobID})
	if err != nil {
		return err
	}
	binding, generation, err := jobstore.NativeUploadJobOrigin(job.GetJob())
	if err != nil || binding != intent.BindingID || generation != intent.Generation {
		return errors.WithStack(errors.StatusConflict)
	}
	removeBlob := func(location *tree.Node) error {
		response, err := router.DeleteNode(ctx, &tree.DeleteNodeRequest{Node: location.Clone()})
		if errors.Is(err, errors.NodeNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		if !response.GetSuccess() {
			return errors.WithStack(errors.StatusConflict)
		}
		return nil
	}
	uncertain := func(cause error) error {
		// This is the existing owner-visible native task, not a terminal FAILED.
		// A later sweep can still consume repaired native evidence; the error also
		// keeps the original cleaner readiness false and denies new staging.
		if task.Status != jobs.TaskStatus_Finished {
			task.StatusMessage = "Native upload outcome requires reconciliation by " + task.TriggerOwner
			ack, err := client.PutTask(ctx, &jobs.PutTaskRequest{Task: task})
			if err != nil {
				return err
			}
			if !proto.Equal(ack.GetTask(), task) {
				return errors.WithStack(errors.StatusConflict)
			}
		}
		return cause
	}
	if task.Status == jobs.TaskStatus_Finished {
		// A persisted terminal already proves the original cleanup ACKs. A later
		// independent version policy may legitimately prune the published version;
		// that must not regress this historical Task or stop new uploads. Retain
		// the original draft fence and reclaim any late temporary bytes only.
		if _, _, err := jobstore.NativeUploadRevision(task); err != nil {
			return err
		}
		return removeBlob(upload.Revision.Location)
	}
	record, err := jobstore.NativeUploadPublicationFromTask(task)
	if err != nil {
		return uncertain(err)
	}
	if record == nil {
		// Even a partial upload must not retain unbounded temporary bytes. The
		// expired native row has already fenced all late draft acknowledgements.
		if err := removeBlob(upload.Revision.Location); err != nil {
			return uncertain(err)
		}
		// No publication evidence is not permission to invent a failed/successful
		// file. The native claim remains an explicit owner-visible reconcile item.
		return uncertain(errors.WithMessage(errors.StatusConflict, "native publication evidence is incomplete"))
	}
	if !proto.Equal(record.Draft, upload.Revision) {
		return uncertain(errors.WithStack(errors.StatusConflict))
	}
	// The publication plan is persisted before publication. Its ACK may be
	// lost, or the draft fence may win the subsequent publication transaction.
	// Neither condition may indefinitely retain the already fenced draft bytes.
	if err := dao.DeleteVersionsForNode(ctx, upload.NodeUuid, record.Draft.VersionId); err != nil {
		return uncertain(err)
	}
	if err := removeBlob(record.Draft.Location); err != nil {
		return uncertain(err)
	}
	published, err := dao.GetVersion(ctx, upload.NodeUuid, record.Version.VersionId)
	if err != nil {
		if errors.Is(err, errors.VersionNotFound) {
			// The atomic draft fence prevents any late publication. Reclaim only
			// this exact unpublished immutable copy, never the mutable live node.
			if cleanupErr := removeBlob(record.Version.Location); cleanupErr != nil {
				return uncertain(cleanupErr)
			}
		}
		return uncertain(err)
	}
	if !jobstore.NativeUploadPublishedVersionMatches(published, record.Version) {
		return uncertain(errors.WithStack(errors.StatusConflict))
	}
	for _, revision := range record.PruneVersions {
		stored, err := dao.GetVersion(ctx, upload.NodeUuid, revision.VersionId)
		if err != nil && !errors.Is(err, errors.VersionNotFound) {
			return uncertain(err)
		}
		if err == nil && !jobstore.NativeUploadPublishedVersionMatches(stored, revision) {
			return uncertain(errors.WithStack(errors.StatusConflict))
		}
		if err := dao.DeleteVersionsForNode(ctx, upload.NodeUuid, revision.VersionId); err != nil {
			return uncertain(err)
		}
		if err := removeBlob(revision.Location); err != nil {
			return uncertain(err)
		}
	}
	// Published metadata could itself have been pruned by a later native write.
	// Its disappearance cannot be concealed by this older task's cleanup ACKs.
	published, err = dao.GetVersion(ctx, upload.NodeUuid, record.Version.VersionId)
	if err != nil {
		return uncertain(err)
	}
	if !jobstore.NativeUploadPublishedVersionMatches(published, record.Version) {
		return uncertain(errors.WithStack(errors.StatusConflict))
	}
	if err := jobstore.CompleteNativeUploadPublication(task, record, now); err != nil {
		return uncertain(err)
	}
	ack, err := client.PutTask(ctx, &jobs.PutTaskRequest{Task: task})
	if err != nil {
		return err
	}
	if !proto.Equal(ack.GetTask(), task) {
		return errors.WithStack(errors.StatusConflict)
	}
	return nil
}
