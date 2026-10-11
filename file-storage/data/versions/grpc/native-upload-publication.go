package grpc

import (
	"context"
	"encoding/json"
	"time"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/auth/claim"
	grpcclient "github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/proto/jobs"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/common/utils/propagator"
	"github.com/pydio/cells/v5/data/versions"
	jobstore "github.com/pydio/cells/v5/scheduler/jobs"
	"google.golang.org/protobuf/proto"
)

func readNativeUploadPublicationTask(ctx context.Context, request *tree.StoreVersionRequest) (*jobs.Task, *auth.NativeWriteDelivery, error) {
	jobID, hasJob := propagator.CanonicalMeta(ctx, common.CtxMetaJobUuid)
	key, hasTask := propagator.CanonicalMeta(ctx, common.CtxMetaTaskUuid)
	if request.Version.Draft {
		return nil, nil, nil
	}
	var delivery auth.NativeWriteDelivery
	configured := config.Get(ctx, "services", common.ServiceRestNamespace_+"n", "platform")
	if configured.Get() == nil {
		return nil, nil, nil
	}
	if configured.Scan(&delivery) != nil || delivery.Write.NativeJobID == "" || !hasTask || key == "" {
		return nil, nil, errors.WithStack(errors.StatusForbidden)
	}
	if !hasJob {
		// The already existing PromoteVersion consumer uses the shared native
		// write Job. A missing upload Job reference must not fall through to it.
		legacy, err := jobstore.ReadNativeWriteTask(ctx, delivery.Write.NativeJobID, key, delivery.MaxResponseBytes)
		if err != nil {
			return nil, nil, err
		}
		if _, err := jobstore.NativeWriteTaskIntent(legacy); err != nil {
			return nil, nil, err
		}
		return nil, nil, nil
	}
	task, err := jobstore.ReadNativeWriteTask(ctx, jobID, key, delivery.MaxResponseBytes)
	if err != nil {
		return nil, nil, err
	}
	intent, err := jobstore.NativeUploadTaskIntent(task)
	if err != nil {
		return nil, nil, err
	}
	actor, hasActor := claim.FromContext(ctx)
	if !hasActor || actor.Subject != intent.NativeUserID || intent.BindingID != delivery.BindingID ||
		jobID != auth.NativeUploadJobID(delivery.Write.NativeJobID, delivery.BindingID, intent.Generation) ||
		intent.Input["nativeNodeId"] != request.Node.Uuid || task.GetStatus() != jobs.TaskStatus_Running ||
		task.EndTime != 0 || intent.Input["nativeDeadline"].(float64) <= float64(time.Now().Unix()) {
		return nil, nil, errors.WithStack(errors.StatusForbidden)
	}
	return task, &delivery, nil
}

// Persist the original Task output before CreateVersion returns a copy target.
// A copy can commit even when its ACK or the following fresh check is lost, so
// StoreVersion is too late to be the first durable reference to that target.
func prepareNativeUploadPublication(ctx context.Context, dao versions.DAO, request *tree.StoreVersionRequest, policy *tree.VersioningPolicy) error {
	task, delivery, err := readNativeUploadPublicationTask(ctx, request)
	if err != nil || task == nil {
		return err
	}
	intent, _ := jobstore.NativeUploadTaskIntent(task)
	if prior, err := jobstore.NativeUploadPublicationFromTask(task); err != nil || prior != nil {
		return errors.WithStack(errors.StatusConflict) // Observe, never replay the copy.
	}
	draft, err := dao.GetVersion(ctx, request.Node.Uuid, intent.Input["nativeIntentId"].(string))
	if err != nil {
		return err
	}
	// These immutable fields come from the confirmed original draft; the copy
	// result may validate them, not invent a different post-copy reference.
	request.Version.ContentHash = draft.ContentHash
	if draft.ContentHash != "" {
		request.Version.Location.MustSetMeta(common.MetaNamespaceHash, draft.ContentHash)
	}
	periods, err := versions.PreparePeriods(time.Now(), policy.KeepPeriods)
	if err != nil {
		return err
	}
	changes, err := dao.DraftPublicationVersions(ctx, request.Node.Uuid, delivery.MaxResponseBytes)
	if err != nil {
		return err
	}
	// The native snapshot is bounded and propagates decode/cursor/transaction
	// failures. The original stream logs those errors, so EOF alone cannot
	// prove a complete cleanup set for a governed publication.
	rows := append([]*tree.ContentRevision{request.Version}, changes...)
	collected := make(chan *tree.ContentRevision, len(rows))
	for _, revision := range rows {
		collected <- revision
	}
	close(collected)
	periods, err = versions.DispatchChangeLogsByPeriod(periods, collected)
	if err != nil {
		return err
	}
	var prunes []*tree.ContentRevision
	for _, period := range periods {
		prunes = append(prunes, period.Prune()...)
	}
	if policy.MaxSizePerFile > 0 {
		more, _ := versions.PruneAllWithMaxSize(periods, policy.MaxSizePerFile)
		prunes = append(prunes, more...)
	}
	unique := map[string]bool{}
	var frozen []*tree.ContentRevision
	for _, revision := range prunes {
		if unique[revision.VersionId] {
			continue
		}
		unique[revision.VersionId] = true
		copy := proto.Clone(revision).(*tree.ContentRevision)
		if copy.Location == nil {
			copy.Location = versions.DefaultLocation(ctx, request.Node.Uuid, copy.VersionId)
		}
		frozen = append(frozen, copy)
	}
	record := &jobstore.NativeUploadPublicationRecord{Node: request.Node.Clone(), Draft: draft,
		Version: proto.Clone(request.Version).(*tree.ContentRevision), PruneVersions: frozen}
	if err := jobstore.AppendNativeUploadPublication(task, record); err != nil {
		return err
	}
	if encoded, err := json.Marshal(task); err != nil || int64(len(encoded)) > delivery.MaxResponseBytes {
		return errors.WithStack(errors.StatusConflict)
	}
	ack, err := jobs.NewJobServiceClient(grpcclient.ResolveConn(ctx, common.ServiceJobsGRPC)).PutTask(ctx, &jobs.PutTaskRequest{Task: task})
	if err != nil {
		return err
	}
	if !proto.Equal(ack.GetTask(), task) {
		return errors.WithStack(errors.StatusConflict)
	}
	return nil
}

func storeNativeUploadPublication(ctx context.Context, dao versions.DAO, request *tree.StoreVersionRequest) (*tree.StoreVersionResponse, bool, error) {
	task, _, err := readNativeUploadPublicationTask(ctx, request)
	if err != nil {
		return nil, true, err
	}
	if task == nil {
		return nil, false, nil
	}
	record, err := jobstore.NativeUploadPublicationFromTask(task)
	if err != nil || record == nil || !proto.Equal(record.Version, request.Version) ||
		record.Node.GetUuid() != request.Node.GetUuid() || record.Node.GetPath() != request.Node.GetPath() ||
		record.Node.GetStringMeta(common.MetaNamespaceMime) != request.Node.GetStringMeta(common.MetaNamespaceMime) {
		return nil, true, errors.WithStack(errors.StatusConflict)
	}
	// The copy target and cleanup set were frozen before any copy. Publication
	// still races the native deadline/fence in one original DAO transaction.
	if err := dao.PublishDraftUpload(ctx, request.Node.Uuid, record.Draft, request.Version, time.Now()); err != nil {
		return nil, true, err
	}
	ids := make([]string, len(record.PruneVersions))
	for i, revision := range record.PruneVersions {
		ids[i] = revision.VersionId
	}
	if len(ids) > 0 {
		if err := dao.DeleteVersionsForNode(ctx, request.Node.Uuid, ids...); err != nil {
			return nil, true, err
		}
	}
	return &tree.StoreVersionResponse{Success: true, Version: request.Version, PruneVersions: record.PruneVersions}, true, nil
}
