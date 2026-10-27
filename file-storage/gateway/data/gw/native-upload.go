package pydio

import (
	"context"
	"io"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/pborman/uuid"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/nodes"
	"github.com/pydio/cells/v5/common/nodes/compose"
	"github.com/pydio/cells/v5/common/nodes/models"
	"github.com/pydio/cells/v5/common/proto/jobs"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/common/utils/propagator"
	"github.com/pydio/cells/v5/data/versions"
	jobstore "github.com/pydio/cells/v5/scheduler/jobs"
)

type nativeUploadWriter struct {
	ctx       context.Context
	execution *auth.NativeUploadExecution
	task      *jobs.Task
	node      *tree.Node
	reader    io.Reader
	remaining int64
}

// The existing S3 router remains the only byte writer. This function claims
// the original task before Router.PutObject can create an index or a draft.
func (l *pydioObjects) claimNativeUpload(ctx context.Context, object, step, uploadID string, length int64, receipt ...string) (*nativeUploadWriter, error) {
	u := auth.NativeUploadFromContext(ctx)
	if u == nil {
		return nil, nil
	}
	refused := errors.WithStack(errors.StatusConflict)
	acknowledgement := (u.Step == "create" && step == "created" && uploadID != "") ||
		(u.Step == "part/"+strconv.Itoa(u.PartNumber) && step == "stored/"+strconv.Itoa(u.PartNumber) && uploadID == u.UploadID)
	if (!acknowledgement && (u.Step != step || u.UploadID != uploadID)) || length < 0 ||
		(step == "put" && length != int64(u.Input["contentLength"].(float64))) {
		return nil, refused
	}
	if err := u.Fresh(ctx); err != nil {
		return nil, err
	}
	object = strings.TrimLeft(object, "/")
	if object == "" || path.Clean(object) != object || strings.Contains(object, "\\") {
		return nil, refused
	}
	parent, err := l.Router.ReadNode(ctx, &tree.ReadNodeRequest{Node: &tree.Node{Path: path.Dir(object)}})
	if err != nil {
		return nil, err
	}
	if parent.GetNode().GetType() != tree.NodeType_COLLECTION || !auth.NativeActorUUID(parent.GetNode().GetUuid()) {
		return nil, refused
	}
	byID := compose.UuidClient()
	root, err := byID.ReadNode(ctx, &tree.ReadNodeRequest{Node: &tree.Node{Uuid: u.Delivery.NativeRootRef}})
	if err != nil {
		return nil, err
	}
	nativeParent, err := byID.ReadNode(ctx, &tree.ReadNodeRequest{Node: &tree.Node{Uuid: parent.Node.Uuid}})
	if err != nil {
		return nil, err
	}
	r, p := root.GetNode(), nativeParent.GetNode()
	if r.GetUuid() != u.Delivery.NativeRootRef || r.GetType() != tree.NodeType_COLLECTION || p.GetUuid() != parent.Node.Uuid ||
		r.GetStringMeta(common.MetaNamespaceDatasourceName) == "" || r.GetStringMeta(common.MetaNamespaceDatasourceName) != p.GetStringMeta(common.MetaNamespaceDatasourceName) ||
		(p.Uuid != r.Uuid && !strings.HasPrefix(p.Path, strings.TrimRight(r.Path, "/")+"/")) {
		return nil, refused
	}
	nodeID := u.Input["nativeNodeId"].(string)
	existing, readErr := l.Router.ReadNode(ctx, &tree.ReadNodeRequest{Node: &tree.Node{Path: object}})
	if readErr == nil {
		if existing.GetNode().GetUuid() != nodeID || existing.GetNode().GetType() != tree.NodeType_LEAF {
			return nil, refused
		}
	} else if !errors.Is(readErr, errors.NodeNotFound) {
		return nil, readErr
	}
	task, err := jobstore.ReadNativeWriteTask(ctx, auth.NativeUploadJobID(u.Delivery.Write.NativeJobID, u.Delivery.BindingID, u.Generation), u.Key, u.Delivery.MaxResponseBytes)
	if err != nil {
		return nil, err
	}
	if !jobstore.NativeUploadTaskMatches(task, u.Delivery.BindingID, u.NativeUserID, u.ExternalExecutionID, u.Key, u.Claims) {
		return nil, refused
	}
	intent, err := jobstore.NativeUploadTaskIntent(task)
	if err != nil || intent.Generation != u.Generation {
		return nil, refused
	}
	claimed, err := jobstore.ClaimNativeUploadStep(task, step, uuid.New(), object, uploadID, length, receipt...)
	if err != nil {
		return nil, err
	}
	client := jobs.NewJobServiceClient(grpc.ResolveConn(ctx, common.ServiceJobsGRPC))
	ack, err := client.PutTask(ctx, &jobs.PutTaskRequest{Task: task, StatusMeta: map[string]string{jobstore.NativeUploadStep: step}})
	if err != nil {
		return nil, err
	}
	stored := ack.GetTask()
	if !jobstore.NativeUploadTaskMatches(stored, u.Delivery.BindingID, u.NativeUserID, u.ExternalExecutionID, u.Key, u.Claims) ||
		stored.GetStatus() != jobs.TaskStatus_Running || stored.GetEndTime() != 0 {
		return nil, refused
	}
	confirmed := false
	for _, entry := range stored.ActionsLogs {
		for _, output := range entry.GetOutputMessage().GetOutputChain() {
			if output.GetVars()[jobstore.NativeUploadStep] == step {
				if confirmed || !proto.Equal(output, claimed) {
					return nil, refused
				}
				confirmed = true
			}
		}
	}
	if !confirmed {
		return nil, refused
	}
	task = stored
	if err := u.Fresh(ctx); err != nil {
		return nil, err
	}
	return &nativeUploadWriter{ctx: ctx, execution: u, task: task, node: &tree.Node{Uuid: nodeID, Path: object, Type: tree.NodeType_LEAF}, remaining: length}, nil
}

// Read-side fresh checks stop the original writer as soon as the same AE is
// canceled/revoked or its native cutoff expires. No long-lived token enters a
// task or a retry. A consumed prefix remains UNKNOWN, never a successful file.
func (w *nativeUploadWriter) Read(buffer []byte) (int, error) {
	if err := w.execution.Fresh(w.ctx); err != nil {
		return 0, err
	}
	n, err := w.reader.Read(buffer)
	if int64(n) > w.remaining {
		return 0, errors.WithStack(errors.StatusConflict)
	}
	// Reading the request body may block after the pre-read admission. Check
	// the same execution again before handing any newly received bytes to the
	// native store, including a final read that returns bytes with EOF. Earlier
	// writes remain uncertain; refusal does not release this claimed step.
	if n > 0 {
		if freshErr := w.execution.Fresh(w.ctx); freshErr != nil {
			return 0, freshErr
		}
	}
	w.remaining -= int64(n)
	if err == io.EOF && w.remaining != 0 {
		return n, io.ErrUnexpectedEOF
	}
	return n, err
}

func (w *nativeUploadWriter) metadata(input map[string]string) map[string]string {
	metadata := make(map[string]string, len(input)+3)
	for key, value := range input {
		metadata[key] = value
	}
	metadata[common.XAmzMetaPrefix+common.InputDraftMode] = "true"
	metadata[common.XAmzMetaPrefix+common.InputVersionId] = w.execution.NativeIntentID
	metadata[common.XAmzMetaNodeUuid] = w.node.Uuid
	return metadata
}

// Finalize through the original draft reader, live copy, VersionAction, and
// immutable version ACK. The native intent never stands in for that Version.
func (w *nativeUploadWriter) finish(ctx context.Context, router nodes.Client, info models.ObjectInfo) error {
	u := w.execution
	refused := errors.WithStack(errors.StatusConflict)
	if info.Size != int64(u.Input["contentLength"].(float64)) || info.ETag == "" {
		return refused
	}
	if err := u.Fresh(ctx); err != nil {
		return err
	}
	client := tree.NewNodeVersionerClient(grpc.ResolveConn(ctx, common.ServiceVersionsGRPC))
	found, err := client.HeadVersion(ctx, &tree.HeadVersionRequest{NodeUuid: w.node.Uuid, VersionId: u.NativeIntentID})
	if err != nil {
		return err
	}
	draft := found.GetVersion()
	if draft.GetVersionId() != u.NativeIntentID || !draft.GetDraft() || draft.OwnerUuid != u.NativeUserID ||
		draft.Size != info.Size || draft.ETag != info.ETag || draft.Location == nil {
		return refused
	}
	read, err := router.ReadNode(ctx, &tree.ReadNodeRequest{Node: w.node.Clone()})
	if err != nil {
		return err
	}
	node := read.GetNode()
	if node.GetUuid() != w.node.Uuid || node.GetType() != tree.NodeType_LEAF || versions.PolicyForNode(ctx, node) == nil ||
		node.GetStringMeta(common.MetaNamespaceMime) == "" {
		return refused
	}
	if err := u.Fresh(ctx); err != nil {
		return err
	}
	copied, err := router.CopyObject(ctx, node, node, &models.CopyRequestData{SrcVersionId: u.NativeIntentID})
	if err != nil {
		return err
	}
	if copied.Size != draft.Size {
		return refused
	}
	if err := u.Fresh(ctx); err != nil {
		return err
	}
	actionCtx := context.WithValue(ctx, jobstore.ClaimedTaskContextKey{}, true)
	actionCtx = propagator.WithAdditionalMetadata(actionCtx, map[string]string{common.CtxMetaJobUuid: w.task.JobID, common.CtxMetaTaskUuid: u.Key, common.CtxMetaTaskActionPath: jobstore.NativeVersionActionID})
	source := node.Clone()
	// A first upload's live index may still have the original temporary ETag.
	// Promote the acknowledged draft bytes, not that asynchronously updated
	// live metadata; VersionAction will verify this exact draft again.
	source.Size, source.Etag, source.MTime = draft.Size, draft.ETag, draft.MTime
	source.MustSetMeta(common.MetaNamespaceVersionId, u.NativeIntentID)
	versionRouter := compose.PathClient(nodes.AsAdmin())
	output, err := (&versions.VersionAction{}).PromoteRevision(actionCtx, &jobs.ActionMessage{Nodes: []*tree.Node{source}}, versionRouter)
	if err != nil {
		return err
	}
	var published *tree.ContentRevision
	for _, result := range output.GetOutputChain() {
		if result.GetVars()[jobstore.NativeVersionResult] != "true" {
			continue
		}
		value := new(tree.ContentRevision)
		if !result.Success || protojson.Unmarshal(result.JsonBody, value) != nil || value.Draft || value.OwnerUuid != u.NativeUserID ||
			value.Size != draft.Size || value.ETag != draft.ETag || value.VersionId == "" || value.VersionId == u.NativeIntentID ||
			(published != nil && !proto.Equal(published, value)) {
			return refused
		}
		published = value
	}
	if published == nil {
		return refused
	}
	if err := u.Fresh(ctx); err != nil {
		return err
	}
	removed, err := client.DeleteVersion(ctx, &tree.HeadVersionRequest{NodeUuid: node.Uuid, VersionId: u.NativeIntentID})
	if err != nil {
		return err
	}
	if !removed.GetSuccess() || !proto.Equal(removed.GetDeletedVersion(), draft) {
		return refused
	}
	if err := u.Fresh(ctx); err != nil {
		return err
	}
	deleted, err := versionRouter.DeleteNode(ctx, &tree.DeleteNodeRequest{Node: draft.Location})
	if err != nil {
		return err
	}
	if !deleted.GetSuccess() {
		return refused
	}
	confirmed, err := client.HeadVersion(ctx, &tree.HeadVersionRequest{NodeUuid: node.Uuid, VersionId: published.VersionId})
	if err != nil {
		return err
	}
	if confirmed.GetVersion() == nil {
		return refused
	}
	verified := proto.Clone(confirmed.Version).(*tree.ContentRevision)
	verified.IsHead = published.IsHead
	if !proto.Equal(verified, published) {
		return refused
	}
	// CreateVersion persisted the complete cleanup set before copying. Read
	// that same Task back instead of overwriting it with the pre-copy snapshot.
	w.task, err = jobstore.ReadNativeWriteTask(ctx, w.task.JobID, u.Key, u.Delivery.MaxResponseBytes)
	if err != nil {
		return err
	}
	publication, err := jobstore.NativeUploadPublicationFromTask(w.task)
	if err != nil || publication == nil || !jobstore.NativeUploadPublishedVersionMatches(publication.Version, published) ||
		!proto.Equal(publication.Draft, draft) || publication.Node.Uuid != node.Uuid {
		return refused
	}
	if err := jobstore.CompleteNativeUploadPublication(w.task, publication, time.Now()); err != nil {
		return err
	}
	ack, err := jobs.NewJobServiceClient(grpc.ResolveConn(ctx, common.ServiceJobsGRPC)).PutTask(ctx, &jobs.PutTaskRequest{Task: w.task})
	if err != nil {
		return err
	}
	if !proto.Equal(ack.GetTask(), w.task) {
		return refused
	}
	return u.Fresh(ctx)
}
