package share

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/auth/claim"
	"github.com/pydio/cells/v5/common/client/commons/docstorec"
	"github.com/pydio/cells/v5/common/client/commons/idmc"
	"github.com/pydio/cells/v5/common/client/commons/jobsc"
	"github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/middleware/authorizations"
	"github.com/pydio/cells/v5/common/proto/docstore"
	"github.com/pydio/cells/v5/common/proto/idm"
	jobproto "github.com/pydio/cells/v5/common/proto/jobs"
	"github.com/pydio/cells/v5/common/proto/service"
	"github.com/pydio/cells/v5/common/proto/tree"
	jobstore "github.com/pydio/cells/v5/scheduler/jobs"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/anypb"
)

type nativeLinkContextKey struct{}
type nativeLinkMutation struct {
	intent *jobstore.NativeShareIntent
	fresh  func() error
}

// Called immediately before each original removal RPC. Observation has no
// mutation context and cannot obtain permission to dispatch these steps.
func nativeLinkStep(ctx context.Context, share string) error {
	if value, ok := ctx.Value(nativeLinkContextKey{}).(*nativeLinkMutation); ok {
		if value.intent.ShareID != share {
			return nativeCellRefused()
		}
		return value.fresh()
	}
	return nil
}

// Complete EOF on each exact native reference is required. A failed lookup or
// another user's 404 cannot become evidence: callers must first match the
// immutable, already-dispatched Task to the authenticated platform execution.
func NativeShareRemoved(ctx context.Context, task *jobproto.Task) (bool, error) {
	intent, err := jobstore.NativeShareTaskIntent(task)
	if err != nil {
		return false, err
	}
	if task.StartTime <= 0 || (task.Status != jobproto.TaskStatus_Running && task.Status != jobproto.TaskStatus_Finished) {
		return false, nil
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	// Exact GetDocument reads primary storage, not the eventually consistent
	// search index used to render the original sharing dialog.
	_, err = docstorec.DocStoreClient(ctx).GetDocument(ctx, &docstore.GetDocumentRequest{StoreID: common.DocStoreIdShares, DocumentID: intent.DocumentID})
	if err == nil {
		return false, nil
	}
	if !errors.Is(err, errors.DocStoreDocNotFound) {
		return false, err
	}
	userQuery, err := anypb.New(&idm.UserSingleQuery{Uuid: intent.HiddenUserID})
	if err != nil {
		return false, err
	}
	users, err := idmc.UserServiceClient(ctx).CountUser(ctx, &idm.SearchUserRequest{Query: &service.Query{SubQueries: []*anypb.Any{userQuery}}})
	if err != nil {
		return false, err
	}
	if users == nil || users.Count < 0 {
		return false, nativeShareUnknown()
	}
	if users.Count != 0 {
		return false, nil
	}
	workspaceQuery, err := anypb.New(&idm.WorkspaceSingleQuery{Uuid: intent.ShareID})
	if err != nil {
		return false, err
	}
	workspaces, err := idmc.WorkspaceServiceClient(ctx).SearchWorkspace(ctx, &idm.SearchWorkspaceRequest{Query: &service.Query{SubQueries: []*anypb.Any{workspaceQuery}}})
	if err != nil {
		return false, err
	}
	defer workspaces.CloseSend()
	if _, err := workspaces.Recv(); !errors.Is(err, io.EOF) {
		if err != nil {
			return false, err
		}
		return false, nil
	}
	return true, ctx.Err()
}

// This archives observed removal of the exact three frozen native references.
// It never dispatches DeleteLink, including under a binding's management fence.
// archiveNativeShare returns the terminal time and the raw TaskStatus of the
// persisted share Task it was proven from (DD-124(5)); both are empty while
// the original removal is unproven.
func archiveNativeShare(ctx context.Context, task *jobproto.Task, beforeReceipt func() error) (string, string, error) {
	if terminal, err := jobstore.NativeShareTerminal(task); err == nil {
		return terminal, task.GetStatus().String(), nil
	}
	removed, err := NativeShareRemoved(ctx, task)
	if err != nil {
		return "", "", err
	}
	if !removed {
		return "", "", nil
	}
	if beforeReceipt != nil {
		if err := beforeReceipt(); err != nil {
			return "", "", err
		}
	}
	body, err := jobstore.NativeCellTaskIntent(task)
	if err != nil {
		return "", "", err
	}
	next := proto.Clone(task).(*jobproto.Task)
	next.Status, next.EndTime = jobproto.TaskStatus_Finished, int32(time.Now().Unix())
	next.ActionsLogs = append(next.ActionsLogs, &jobproto.ActionLog{OutputMessage: &jobproto.ActionMessage{OutputChain: []*jobproto.ActionOutput{
		{Success: true, JsonBody: body, Vars: map[string]string{jobstore.NativeShareResult: "true"}}}}})
	ack, err := jobsc.JobServiceClient(ctx).PutTask(ctx, &jobproto.PutTaskRequest{Task: next})
	if err != nil || !proto.Equal(ack.GetTask(), next) {
		return "", "", nativeShareUnknown()
	}
	terminal, err := jobstore.NativeShareTerminal(ack.Task)
	if err != nil {
		return "", "", err
	}
	return terminal, ack.Task.GetStatus().String(), nil
}

func nativeShareUnknown() error {
	return errors.WithMessage(errors.ServiceError, "native share revocation outcome is unknown; retain the original request key")
}

func (sc *Client) nativeShareIntent(ctx context.Context, id string, delivery auth.NativeShareDelivery, generation int64, target map[string]interface{}) (*jobstore.NativeShareIntent, error) {
	if !auth.NativeActorUUID(id) || target["nativeRef"] != delivery.NativeRootRef || target["nativeInstanceRef"] != delivery.NativeInstanceRef || target["nativeScopeRef"] != delivery.NativeScopeRef {
		return nil, nativeCellRefused()
	}
	link, err := sc.LinkById(ctx, id)
	if err != nil {
		return nil, err
	}
	if !link.PoliciesContextEditable || !auth.NativeActorUUID(link.UserUuid) || link.UserLogin == "" || link.LinkHash == "" || len(link.RootNodes) == 0 {
		return nil, nativeCellRefused()
	}
	document, err := docstorec.DocStoreClient(ctx).GetDocument(ctx, &docstore.GetDocumentRequest{StoreID: common.DocStoreIdShares, DocumentID: link.LinkHash})
	var original docstore.ShareDocument
	if err != nil || document.GetDocument().GetID() != link.LinkHash || json.Unmarshal([]byte(document.GetDocument().GetData()), &original) != nil ||
		original.RepositoryId != id || original.PreUserUuid != link.UserUuid || (original.PreLogUser != link.UserLogin && original.PresetLogin != link.UserLogin) {
		return nil, nativeCellRefused()
	}
	current, ok := claim.FromContext(ctx)
	if !ok {
		return nil, nativeCellRefused()
	}
	root, err := sc.getUuidRouter(ctx).ReadNode(ctx, &tree.ReadNodeRequest{Node: &tree.Node{Uuid: delivery.NativeRootRef}})
	if err != nil || root.GetNode().GetUuid() != delivery.NativeRootRef || root.GetNode().GetPath() == "" {
		return nil, nativeCellRefused()
	}
	value := &jobstore.NativeShareIntent{BindingID: delivery.BindingID, Generation: generation, NativeUserID: current.Subject,
		ShareID: id, HiddenUserID: link.UserUuid, HiddenUserLogin: link.UserLogin, DocumentID: link.LinkHash}
	for _, node := range link.RootNodes {
		if !auth.NativeActorUUID(node.GetUuid()) {
			return nil, nativeCellRefused()
		}
		actual, err := sc.getUuidRouter(ctx).ReadNode(ctx, &tree.ReadNodeRequest{Node: &tree.Node{Uuid: node.Uuid}})
		if err != nil || actual.GetNode().GetUuid() != node.Uuid ||
			(node.Uuid != root.Node.Uuid && !strings.HasPrefix(actual.Node.Path, strings.TrimRight(root.Node.Path, "/")+"/")) {
			return nil, nativeCellRefused()
		}
		value.Roots = append(value.Roots, node.Uuid)
	}
	sort.Strings(value.Roots)
	return value, nil
}

// Original DeleteLink is the sole writer. Retries and supplemental calls only
// inspect the same claimed Task, never repeat a partial three-service deletion.
func (sc *Client) NativeShareExecution(request *http.Request, proof, operation, selected string) (map[string]interface{}, error) {
	transport := request.Clone(request.Context())
	delivery, claims, target, arguments, generation, err := auth.NativeShareAuthority(request, proof, operation)
	if err != nil {
		return nil, err
	}
	policy, err := idm.NewPolicyEngineServiceClient(grpc.ResolveConn(request.Context(), common.ServicePolicyGRPC)).IsAllowed(request.Context(), authorizations.HTTPPolicyRequest(request))
	if err != nil || !policy.GetAllowed() {
		return nil, nativeCellRefused()
	}
	var args map[string]interface{}
	if json.Unmarshal([]byte(arguments), &args) != nil {
		return nil, nativeCellRefused()
	}
	key := claimTextShare(claims, "idempotency_key")
	var input map[string]interface{}
	if operation == "execute" {
		if target["nativeRef"] != delivery.NativeRootRef || target["nativeInstanceRef"] != delivery.NativeInstanceRef || target["nativeScopeRef"] != delivery.NativeScopeRef {
			return nil, nativeCellRefused()
		}
		input, _ = args["input"].(map[string]interface{})
		argumentTarget, _ := args["target"].(map[string]interface{})
		if len(args) != 2 || len(argumentTarget) != 1 || len(input) != 3 || argumentTarget["resourceId"] != claims["target_id"] ||
			input["resourceId"] != claims["target_id"] || input["operation"] != "REVOKE" || input["nativeShareRef"] != selected || !auth.NativeActorUUID(selected) {
			return nil, nativeCellRefused()
		}
	} else {
		key = claimTextShare(args, "idempotencyKey")
		if (operation != "observe" && operation != "extract_usage") || (len(args) != 3 && len(args) != 4) || args["nativeType"] != "job" ||
			!auth.NativeActorUUID(claimTextShare(args, "externalExecutionId")) || (args["nativeId"] != nil && args["nativeId"] != key) {
			return nil, nativeCellRefused()
		}
		for field := range args {
			if field != "idempotencyKey" && field != "externalExecutionId" && field != "nativeType" && field != "nativeId" {
				return nil, nativeCellRefused()
			}
		}
	}
	if !auth.NativeActorUUID(key) {
		return nil, nativeCellRefused()
	}
	ctx := request.Context()
	actor, ok := claim.FromContext(ctx)
	if !ok {
		return nil, nativeCellRefused()
	}
	job := jobstore.NativeShareJob(delivery.Share.NativeJobID, delivery.BindingID, generation)
	client := jobsc.JobServiceClient(ctx)
	actual, err := client.GetJob(ctx, &jobproto.GetJobRequest{JobID: job.ID})
	if err != nil {
		return nil, err
	}
	binding, epoch, err := jobstore.NativeShareJobOrigin(actual.GetJob())
	if err != nil || binding != delivery.BindingID || epoch != generation {
		return nil, nativeCellRefused()
	}
	task, err := jobstore.ReadNativeWriteTask(ctx, job.ID, key, delivery.MaxResponseBytes)
	if err != nil {
		return nil, err
	}
	fresh := func() error {
		check := transport.Clone(transport.Context())
		current, verified, currentTarget, _, epoch, err := auth.NativeShareAuthority(check, proof, operation)
		if err != nil || !sameCellValue(current, delivery) || epoch != generation || !sameCellValue(verified, claims) || !sameCellValue(currentTarget, target) {
			return nativeCellRefused()
		}
		return nil
	}
	if task == nil && operation == "execute" {
		if actual.GetJob().GetInactive() {
			return nil, nativeCellRefused()
		}
		intent, err := sc.nativeShareIntent(ctx, selected, delivery, generation, target)
		if err != nil {
			return nil, err
		}
		task, err = jobstore.NewNativeShareTask(job.ID, key, actor.Name, *intent, claims)
		if err != nil {
			return nil, err
		}
		if err = fresh(); err != nil {
			return nil, err
		}
		ack, err := client.PutTask(ctx, &jobproto.PutTaskRequest{Task: task, StatusMeta: map[string]string{jobstore.TaskCreateOnly: "true"}})
		if err != nil || !proto.Equal(ack.GetTask(), task) {
			return nil, nativeShareUnknown()
		}
		task.Status, task.StartTime = jobproto.TaskStatus_Running, int32(time.Now().Unix())
		ack, err = client.PutTask(ctx, &jobproto.PutTaskRequest{Task: task})
		if err != nil || !proto.Equal(ack.GetTask(), task) {
			return nil, nativeShareUnknown()
		}
		mutation := &nativeLinkMutation{intent: intent, fresh: fresh}
		if err = sc.DeleteLink(context.WithValue(ctx, nativeLinkContextKey{}, mutation), selected); err != nil {
			return nil, nativeShareUnknown()
		}
	}
	answer := map[string]interface{}{"idempotencyKey": key, "nativeType": "job", "platformStatus": "UNKNOWN", "cancelCapability": "UNSUPPORTED"}
	if task != nil {
		if !jobstore.NativeShareTaskMatches(task, delivery.BindingID, generation, actor.Subject, claims) {
			return nil, nativeCellRefused()
		}
		intent, _ := jobstore.NativeShareTaskIntent(task)
		if operation == "execute" && (intent.ShareID != selected || intent.Scope["external_execution_id"] != claims["external_execution_id"] || intent.Scope["idempotency_key"] != key) {
			return nil, nativeCellRefused()
		}
		if operation != "execute" && intent.Scope["external_execution_id"] != args["externalExecutionId"] {
			return nil, nativeCellRefused()
		}
		terminal, nativeStatus, err := archiveNativeShare(ctx, task, fresh)
		if err != nil {
			return nil, err
		}
		if terminal != "" {
			answer["nativeId"], answer["platformStatus"], answer["terminalAt"] = key, "SUCCEEDED", terminal
			answer["nativeStatus"] = nativeStatus
		}
	}
	if err := fresh(); err != nil {
		return nil, err
	}
	if args["nativeId"] != nil && answer["platformStatus"] != "SUCCEEDED" {
		return nil, nativeShareUnknown()
	}
	answer["lastObservedAt"] = time.Now().UTC().Format(time.RFC3339Nano)
	return map[string]interface{}{"execution": answer}, nil
}

func claimTextShare(value map[string]interface{}, key string) string {
	text, _ := value[key].(string)
	return text
}
