package share

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth/claim"
	grpcclient "github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/config/routing"
	cellserrors "github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/nodes"
	nodeacl "github.com/pydio/cells/v5/common/nodes/acl"
	objectmock "github.com/pydio/cells/v5/common/nodes/objects/mock"
	"github.com/pydio/cells/v5/common/permissions"
	"github.com/pydio/cells/v5/common/proto/docstore"
	"github.com/pydio/cells/v5/common/proto/idm"
	jobproto "github.com/pydio/cells/v5/common/proto/jobs"
	"github.com/pydio/cells/v5/common/proto/service"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/common/storage/boltdb"
	"github.com/pydio/cells/v5/common/utils/cache/gocache"
	cachehelper "github.com/pydio/cells/v5/common/utils/cache/helper"
	"github.com/pydio/cells/v5/common/utils/openurl"
	jobstore "github.com/pydio/cells/v5/scheduler/jobs"
	jobbolt "github.com/pydio/cells/v5/scheduler/jobs/dao/bolt"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
)

type nativeLinkDocuments struct {
	docstore.UnimplementedDocStoreServer
	intent   *jobstore.NativeShareIntent
	scenario string
	deletes  int
}

// The native services retain their own state. Only their RPC transports are
// isolated; the Task first-dispatch claim and receipts use the original Bolt DAO.
type nativeFirstShare struct {
	docstore.UnimplementedDocStoreServer
	idm.UnimplementedUserServiceServer
	idm.UnimplementedWorkspaceServiceServer
	idm.UnimplementedACLServiceServer
	tree.UnimplementedNodeProviderServer
	intent                  *jobstore.NativeShareIntent
	dao                     jobstore.DAO
	jobID, taskID, scenario string
	removed                 [3]bool
	calls                   []string
	peps, writes, attempts  int
}

func (f *nativeFirstShare) document() *docstore.Document {
	body, _ := json.Marshal(&docstore.ShareDocument{RepositoryId: f.intent.ShareID, PreUserUuid: f.intent.HiddenUserID, PreLogUser: f.intent.HiddenUserLogin, ShareType: "minisite"})
	return &docstore.Document{ID: f.intent.DocumentID, Data: string(body)}
}
func (f *nativeFirstShare) GetDocument(_ context.Context, r *docstore.GetDocumentRequest) (*docstore.GetDocumentResponse, error) {
	if r.DocumentID != f.intent.DocumentID || r.StoreID != common.DocStoreIdShares {
		return nil, errors.New("wrong document")
	}
	if f.removed[0] {
		return nil, cellserrors.DocStoreDocNotFound
	}
	return &docstore.GetDocumentResponse{Document: f.document()}, nil
}
func (f *nativeFirstShare) ListDocuments(r *docstore.ListDocumentsRequest, s docstore.DocStore_ListDocumentsServer) error {
	if r.StoreID != common.DocStoreIdShares || r.GetQuery().GetMetaQuery() != "+REPOSITORY:\""+f.intent.ShareID+"\" +SHARE_TYPE:minisite" {
		return errors.New("wrong document query")
	}
	if f.removed[0] {
		return nil
	}
	return s.Send(&docstore.ListDocumentsResponse{Document: f.document()})
}
func (f *nativeFirstShare) mutation(ctx context.Context, index int, name string) error {
	f.attempts++
	actor, ok := claim.FromContext(ctx)
	if !ok || actor.Subject != f.intent.NativeUserID {
		return errors.New("native actor was not retained")
	}
	task, err := f.dao.GetTask(ctx, f.jobID, f.taskID)
	if err != nil || task.GetStatus() != jobproto.TaskStatus_Running || task.GetStartTime() <= 0 || !jobstore.TaskHasClaim(task) || f.writes != 2 {
		return errors.New("native write preceded durable dispatch")
	}
	if len(f.calls) != index || f.peps != 3+index {
		return fmt.Errorf("wrong write order/fresh: %v, PEP=%d", f.calls, f.peps)
	}
	f.calls = append(f.calls, name)
	if f.scenario == name+"-error" {
		return errors.New("native write failed")
	}
	f.removed[index] = true
	if f.scenario == name+"-lost-ack" {
		return errors.New("native write ACK lost")
	}
	return nil
}
func (f *nativeFirstShare) DeleteDocuments(ctx context.Context, r *docstore.DeleteDocumentsRequest) (*docstore.DeleteDocumentsResponse, error) {
	if r.DocumentID != f.intent.DocumentID || r.Query != nil || r.StoreID != common.DocStoreIdShares {
		return nil, errors.New("nonexact document deletion")
	}
	if err := f.mutation(ctx, 0, "document"); err != nil {
		return nil, err
	}
	return &docstore.DeleteDocumentsResponse{Success: true, DeletionCount: 1}, nil
}
func (f *nativeFirstShare) SearchOne(_ context.Context, r *idm.SearchUserRequest) (*idm.SearchUserResponse, error) {
	var q idm.UserSingleQuery
	if len(r.GetQuery().GetSubQueries()) != 1 || r.Query.SubQueries[0].UnmarshalTo(&q) != nil || q.Uuid != f.intent.NativeUserID {
		return nil, errors.New("wrong actor")
	}
	return &idm.SearchUserResponse{User: &idm.User{Uuid: f.intent.NativeUserID, Login: "native-owner"}}, nil
}
func (f *nativeFirstShare) CountUser(_ context.Context, r *idm.SearchUserRequest) (*idm.CountUserResponse, error) {
	var q idm.UserSingleQuery
	if len(r.GetQuery().GetSubQueries()) != 1 || r.Query.SubQueries[0].UnmarshalTo(&q) != nil || q.Uuid != f.intent.HiddenUserID {
		return nil, errors.New("wrong hidden user")
	}
	if f.removed[1] {
		return &idm.CountUserResponse{}, nil
	}
	return &idm.CountUserResponse{Count: 1}, nil
}
func (f *nativeFirstShare) DeleteUser(ctx context.Context, r *idm.DeleteUserRequest) (*idm.DeleteUserResponse, error) {
	if len(r.GetQuery().GetSubQueries()) != 3 || r.Query.Operation != service.OperationType_AND {
		return nil, errors.New("unscoped hidden user deletion")
	}
	var login, hidden, id idm.UserSingleQuery
	if r.Query.SubQueries[0].UnmarshalTo(&login) != nil || r.Query.SubQueries[1].UnmarshalTo(&hidden) != nil || r.Query.SubQueries[2].UnmarshalTo(&id) != nil || login.Login != f.intent.HiddenUserLogin || hidden.AttributeName != idm.UserAttrHidden || hidden.AttributeValue != "true" || id.Uuid != f.intent.HiddenUserID {
		return nil, errors.New("wrong hidden user deletion")
	}
	if err := f.mutation(ctx, 1, "user"); err != nil {
		return nil, err
	}
	return &idm.DeleteUserResponse{RowsDeleted: 1}, nil
}
func (f *nativeFirstShare) workspace() *idm.Workspace {
	return &idm.Workspace{UUID: f.intent.ShareID, Label: "Original link", Scope: idm.WorkspaceScope_LINK, RootUUIDs: f.intent.Roots}
}
func (f *nativeFirstShare) SearchWorkspace(r *idm.SearchWorkspaceRequest, s grpc.ServerStreamingServer[idm.SearchWorkspaceResponse]) error {
	var q idm.WorkspaceSingleQuery
	if len(r.GetQuery().GetSubQueries()) != 1 || r.Query.SubQueries[0].UnmarshalTo(&q) != nil || q.Uuid != f.intent.ShareID {
		return errors.New("wrong workspace")
	}
	if f.removed[2] {
		return nil
	}
	return s.Send(&idm.SearchWorkspaceResponse{Workspace: f.workspace()})
}
func (f *nativeFirstShare) DeleteWorkspace(ctx context.Context, r *idm.DeleteWorkspaceRequest) (*idm.DeleteWorkspaceResponse, error) {
	var q idm.WorkspaceSingleQuery
	if len(r.GetQuery().GetSubQueries()) != 1 || r.Query.SubQueries[0].UnmarshalTo(&q) != nil || q.Uuid != f.intent.ShareID {
		return nil, errors.New("wrong workspace deletion")
	}
	if err := f.mutation(ctx, 2, "workspace"); err != nil {
		return nil, err
	}
	return &idm.DeleteWorkspaceResponse{RowsDeleted: 1}, nil
}
func (f *nativeFirstShare) SearchACL(r *idm.SearchACLRequest, s grpc.ServerStreamingServer[idm.SearchACLResponse]) error {
	var q idm.ACLSingleQuery
	if len(r.GetQuery().GetSubQueries()) != 2 || r.Query.Operation != service.OperationType_AND || r.Query.SubQueries[0].UnmarshalTo(&q) != nil || len(q.WorkspaceIDs) != 1 || q.WorkspaceIDs[0] != f.intent.ShareID {
		return errors.New("wrong source ACL query")
	}
	return s.Send(&idm.SearchACLResponse{ACL: &idm.ACL{WorkspaceID: f.intent.ShareID, NodeID: f.intent.Roots[0], RoleID: f.intent.NativeUserID, Action: permissions.AclRead}})
}
func (f *nativeFirstShare) ReadNode(_ context.Context, r *tree.ReadNodeRequest) (*tree.ReadNodeResponse, error) {
	if r.GetNode().GetUuid() != f.intent.Roots[0] {
		return nil, errors.New("wrong source root")
	}
	return &tree.ReadNodeResponse{Node: &tree.Node{Uuid: f.intent.Roots[0], Path: "source/root", Type: tree.NodeType_COLLECTION}}, nil
}

type nativeFirstTasks struct {
	grpc.ClientConnInterface
	state *nativeFirstShare
}

func (c *nativeFirstTasks) Invoke(ctx context.Context, method string, in, out interface{}, _ ...grpc.CallOption) error {
	f := c.state
	if strings.HasSuffix(method, "/GetJob") {
		job, err := f.dao.GetJob(in.(*jobproto.GetJobRequest).JobID, jobproto.TaskStatus_Unknown)
		if err != nil {
			return err
		}
		proto.Merge(out.(*jobproto.GetJobResponse), &jobproto.GetJobResponse{Job: job})
		return nil
	}
	if !strings.HasSuffix(method, "/PutTask") {
		return errors.New("unexpected job RPC")
	}
	r := in.(*jobproto.PutTaskRequest)
	f.writes++
	var err error
	if r.StatusMeta[jobstore.TaskCreateOnly] == "true" {
		err = f.dao.ClaimTask(r.Task)
	} else {
		err = f.dao.PutTask(r.Task)
	}
	if err != nil {
		return err
	}
	if (f.scenario == "claim-lost-ack" && f.writes == 1) || (f.scenario == "dispatch-lost-ack" && f.writes == 2) || (f.scenario == "receipt-lost-ack" && f.writes == 3) {
		return errors.New("durable task ACK lost")
	}
	stored, err := f.dao.GetTask(ctx, r.Task.JobID, r.Task.ID)
	if err != nil {
		return err
	}
	proto.Merge(out.(*jobproto.PutTaskResponse), &jobproto.PutTaskResponse{Task: stored})
	return nil
}

type nativeFirstTaskStream struct {
	nativeLinkTaskStream
	state *nativeFirstShare
}

func (s *nativeFirstTaskStream) SendMsg(in interface{}) error {
	r := in.(*jobproto.ListTasksRequest)
	var err error
	s.task, err = s.state.dao.GetTask(context.Background(), r.JobID, r.TaskID)
	return err
}
func (s *nativeFirstTaskStream) RecvMsg(out interface{}) error {
	if s.task == nil {
		return io.EOF
	}
	return s.nativeLinkTaskStream.RecvMsg(out)
}
func (c *nativeFirstTasks) NewStream(_ context.Context, _ *grpc.StreamDesc, method string, _ ...grpc.CallOption) (grpc.ClientStream, error) {
	if !strings.HasSuffix(method, "/ListTasks") {
		return nil, errors.New("unexpected job stream")
	}
	return &nativeFirstTaskStream{state: c.state}, nil
}

func TestNativeShareFirstExecutePersistsFenceAndNeverReplays(t *testing.T) {
	cachehelper.SetStaticResolver("pm://", &gocache.URLOpener{})
	nodes.SetSourcesPoolOpener(func(ctx context.Context) *openurl.Pool[nodes.SourcesPool] { return nodes.NewTestPool(ctx) })
	for _, scenario := range []string{"complete", "claim-lost-ack", "dispatch-lost-ack", "document-error", "document-lost-ack", "user-error", "user-lost-ack", "workspace-error", "workspace-lost-ack", "receipt-lost-ack", "revoke-3", "revoke-4", "revoke-5", "no-source-permission"} {
		t.Run(scenario, func(t *testing.T) {
			template, _ := nativeLinkFixture(t)
			intent, err := jobstore.NativeShareTaskIntent(template)
			if err != nil {
				t.Fatal(err)
			}
			ctx := config.WithStubStore(context.Background())
			pool, err := boltdb.OpenPool(ctx, "boltdb://"+filepath.Join(t.TempDir(), "native-tasks.db"))
			if err != nil {
				t.Fatal(err)
			}
			connection, err := pool.Get(ctx)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				if err := connection.(boltdb.DB).Close(ctx); err != nil {
					t.Error(err)
				}
			})
			dao := jobbolt.NewBoltDAO(connection.(boltdb.DB))
			job := jobstore.NativeShareJob("share-native-job", intent.BindingID, intent.Generation)
			if err := dao.ClaimJob(ctx, job); err != nil {
				t.Fatal(err)
			}
			state := &nativeFirstShare{intent: intent, dao: dao, jobID: job.ID, taskID: template.ID, scenario: scenario}
			pep := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if r.URL.Path == "/token" {
					json.NewEncoder(w).Encode(map[string]interface{}{"access_token": "service-test", "token_type": "Bearer", "expires_in": 60})
					return
				}
				if r.URL.Path != "/service/v1/adapter/pep_check" || r.Header.Get("Authorization") != "Bearer service-test" {
					w.WriteHeader(403)
					return
				}
				state.peps++
				if scenario == fmt.Sprintf("revoke-%d", state.peps) {
					w.WriteHeader(403)
					return
				}
				json.NewEncoder(w).Encode(map[string]interface{}{"actionExecutionId": intent.Scope["action_execution_id"], "operationId": intent.Scope["operation_id"], "authorizationMinZedToken": "fresh", "bindingGeneration": intent.Generation, "targetResource": map[string]interface{}{"resourceId": intent.Scope["target_id"], "nativeType": "folder", "nativeRef": intent.Roots[0], "nativeInstanceRef": "instance", "nativeScopeRef": intent.ShareID}})
			}))
			defer pep.Close()
			secret := filepath.Join(t.TempDir(), "secret")
			if err := os.WriteFile(secret, []byte("test-secret"), 0600); err != nil {
				t.Fatal(err)
			}
			serviceUser := "00000000-0000-4000-8000-000000000099"
			delivery := map[string]interface{}{"bindingId": intent.BindingID, "tenantId": intent.Scope["tenant_id"], "nativeInstanceRef": "instance", "nativeScopeRef": intent.ShareID, "nativeRootRef": intent.Roots[0], "instanceServiceUuid": serviceUser, "corePepUrl": pep.URL + "/service/v1/adapter/pep_check", "oidcTokenUrl": pep.URL + "/token", "clientId": "share", "clientSecretFile": secret, "clientSecretMaxBytes": 256, "maxResponseBytes": 65536, "requestTimeout": "2s", "actors": []map[string]interface{}{{"principalId": intent.Scope["actor_principal_id"], "kind": "HUMAN", "userUuid": intent.NativeUserID}}, "share": map[string]interface{}{"nativeJobId": "share-native-job", "actionVersion": 1, "resultExposurePolicyId": intent.Scope["result_exposure_policy_id"], "resultExposurePolicyVersion": 1}}
			if err := config.Set(ctx, delivery, "services", common.ServiceRestNamespace_+"n", "platform"); err != nil {
				t.Fatal(err)
			}
			grpcclient.RegisterMock(common.ServiceDocStoreGRPC, &docstore.DocStoreStub{DocStoreServer: state})
			grpcclient.RegisterMock(common.ServiceUserGRPC, &idm.UserServiceStub{UserServiceServer: state})
			grpcclient.RegisterMock(common.ServiceWorkspaceGRPC, &idm.WorkspaceServiceStub{WorkspaceServiceServer: state})
			grpcclient.RegisterMock(common.ServiceAclGRPC, &idm.ACLServiceStub{ACLServiceServer: state})
			grpcclient.RegisterMock(common.ServiceTreeGRPC, &tree.NodeProviderStub{NodeProviderServer: state})
			grpcclient.RegisterMock(common.ServicePolicyGRPC, &idm.PolicyEngineServiceStub{PolicyEngineServiceServer: &nativeSharePolicy{actor: intent.NativeUserID}})
			grpcclient.RegisterMock(common.ServiceJobsGRPC, &nativeFirstTasks{state: state})
			access := permissions.NewAccessList(&idm.Role{Uuid: intent.NativeUserID})
			if scenario != "no-source-permission" {
				access.AppendACLs(&idm.ACL{RoleID: intent.NativeUserID, NodeID: intent.Roots[0], WorkspaceID: intent.ShareID, Action: permissions.AclRead})
			}
			access.Flatten(ctx)
			if err := access.LoadWorkspaces(ctx, func(context.Context, []string) ([]*idm.Workspace, error) {
				return []*idm.Workspace{state.workspace()}, nil
			}); err != nil {
				t.Fatal(err)
			}
			ctx = nodeacl.WithPresetACL(ctx, access)
			parents := []*tree.Node{{Uuid: intent.Roots[0], Path: "source/root", Type: tree.NodeType_COLLECTION}}
			ctx = nodes.WithBranchInfo(ctx, "in", nodes.BranchInfo{LoadedSource: nodes.LoadedSource{Client: objectmock.New("source")}, Workspace: state.workspace(), AncestorsList: map[string][]*tree.Node{"": parents, "source/root": parents}})
			args, _ := json.Marshal(map[string]interface{}{"target": map[string]interface{}{"resourceId": intent.Scope["target_id"]}, "input": map[string]interface{}{"resourceId": intent.Scope["target_id"], "operation": "REVOKE", "nativeShareRef": intent.ShareID}})
			payload, _ := json.Marshal(intent.Scope)
			proof, _ := json.Marshal(map[string]interface{}{"actionToken": "header." + base64.RawURLEncoding.EncodeToString(payload) + ".signed-by-authority", "argumentsJson": string(args)})
			if _, exists := routing.RouteById(common.RouteApiREST); !exists {
				routing.RegisterRoute(common.RouteApiREST, "REST API", common.DefaultRouteREST)
			}
			invoke := func() (map[string]interface{}, error) {
				request := httptest.NewRequest(http.MethodDelete, "http://native.invalid/share/link/"+intent.ShareID, nil).WithContext(claim.ToContext(ctx, claim.Claims{Subject: serviceUser, Name: "service"}))
				var result map[string]interface{}
				var failure error
				registrar := routing.NewRouteRegistrar()
				registrar.Route(common.RouteApiREST).Handle("/share/link/"+intent.ShareID, http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
					result, failure = NewClient(nil).NativeShareExecution(r, base64.RawURLEncoding.EncodeToString(proof), "execute", intent.ShareID)
				}))
				registrar.IteratePatterns(ctx, func(_ string, h http.Handler) { h.ServeHTTP(httptest.NewRecorder(), request) })
				return result, failure
			}
			result, err := invoke()
			if scenario == "complete" {
				if err != nil || result["execution"].(map[string]interface{})["platformStatus"] != "SUCCEEDED" || len(state.calls) != 3 || state.writes != 3 || state.peps != 7 {
					t.Fatalf("first revoke did not complete: %v %v writes=%d PEP=%d calls=%v", result, err, state.writes, state.peps, state.calls)
				}
			} else if err == nil {
				t.Fatalf("unproven first revoke succeeded: %v", result)
			}
			calls, writes, attempts := len(state.calls), state.writes, state.attempts
			stored, readErr := dao.GetTask(ctx, job.ID, template.ID)
			if readErr != nil {
				t.Fatal(readErr)
			}
			if scenario == "no-source-permission" {
				if stored != nil || calls != 0 || writes != 0 {
					t.Fatal("native source denial wrote a task or mutated link")
				}
				return
			}
			if stored == nil {
				t.Fatal("original first-dispatch record was not persisted")
			}
			result, err = invoke()
			if err != nil {
				t.Fatal(err)
			}
			execution := result["execution"].(map[string]interface{})
			want := "UNKNOWN"
			if state.removed == [3]bool{true, true, true} {
				want = "SUCCEEDED"
			}
			if execution["platformStatus"] != want || len(state.calls) != calls || state.attempts != attempts {
				t.Fatalf("retry replayed or invented outcome: %v calls=%v", execution, state.calls)
			}
			if state.writes != writes && !(scenario == "workspace-lost-ack" && state.writes == writes+1) {
				t.Fatalf("retry mutated original task unexpectedly: %d => %d", writes, state.writes)
			}
			if want == "SUCCEEDED" {
				stored, err = dao.GetTask(ctx, job.ID, template.ID)
				if err != nil {
					t.Fatal(err)
				}
				if _, err := jobstore.NativeShareTerminal(stored); err != nil {
					t.Fatal(err)
				}
			}
		})
	}
}

func (f *nativeLinkDocuments) GetDocument(_ context.Context, req *docstore.GetDocumentRequest) (*docstore.GetDocumentResponse, error) {
	if req.StoreID != common.DocStoreIdShares || req.DocumentID != f.intent.DocumentID {
		return nil, errors.New("wrong frozen document")
	}
	if f.scenario == "document-error" {
		return nil, errors.New("primary storage unavailable")
	}
	if f.scenario == "document-present" {
		return &docstore.GetDocumentResponse{Document: &docstore.Document{ID: req.DocumentID}}, nil
	}
	if f.scenario == "slow-removed" {
		time.Sleep(time.Until(time.Now().Truncate(time.Second).Add(time.Second)) + time.Millisecond)
	}
	return nil, cellserrors.DocStoreDocNotFound
}
func (f *nativeLinkDocuments) DeleteDocuments(_ context.Context, req *docstore.DeleteDocumentsRequest) (*docstore.DeleteDocumentsResponse, error) {
	if req.Query != nil || req.DocumentID != f.intent.DocumentID || req.StoreID != common.DocStoreIdShares {
		return nil, errors.New("revoke used search index instead of frozen primary reference")
	}
	f.deletes++
	if f.scenario == "delete-lost-ack" {
		return nil, errors.New("deletion ACK lost")
	}
	return &docstore.DeleteDocumentsResponse{Success: true, DeletionCount: 1}, nil
}

type nativeLinkUsers struct {
	idm.UnimplementedUserServiceServer
	intent   *jobstore.NativeShareIntent
	scenario string
}

func (f *nativeLinkUsers) CountUser(_ context.Context, req *idm.SearchUserRequest) (*idm.CountUserResponse, error) {
	var query idm.UserSingleQuery
	if len(req.GetQuery().GetSubQueries()) != 1 || req.Query.SubQueries[0].UnmarshalTo(&query) != nil || query.Uuid != f.intent.HiddenUserID {
		return nil, errors.New("wrong frozen hidden user")
	}
	if f.scenario == "user-error" {
		return nil, errors.New("user storage unavailable")
	}
	if f.scenario == "user-present" {
		return &idm.CountUserResponse{Count: 1}, nil
	}
	return &idm.CountUserResponse{}, nil
}

type nativeLinkWorkspaces struct {
	idm.UnimplementedWorkspaceServiceServer
	intent   *jobstore.NativeShareIntent
	scenario string
}

func (f *nativeLinkWorkspaces) SearchWorkspace(req *idm.SearchWorkspaceRequest, stream grpc.ServerStreamingServer[idm.SearchWorkspaceResponse]) error {
	var query idm.WorkspaceSingleQuery
	if len(req.GetQuery().GetSubQueries()) != 1 || req.Query.SubQueries[0].UnmarshalTo(&query) != nil || query.Uuid != f.intent.ShareID {
		return errors.New("wrong frozen workspace")
	}
	if f.scenario == "workspace-error" {
		return errors.New("workspace stream interrupted")
	}
	if f.scenario == "workspace-present" {
		return stream.Send(&idm.SearchWorkspaceResponse{Workspace: &idm.Workspace{UUID: query.Uuid}})
	}
	return nil
}

type nativeLinkTasks struct {
	grpc.ClientConnInterface
	task     *jobproto.Task
	scenario string
	writes   int
	job      *jobproto.Job
}

func (f *nativeLinkTasks) Invoke(_ context.Context, method string, input, output interface{}, _ ...grpc.CallOption) error {
	if strings.HasSuffix(method, "/GetJob") && f.job != nil {
		if input.(*jobproto.GetJobRequest).JobID != f.job.ID {
			return errors.New("wrong frozen job")
		}
		proto.Merge(output.(*jobproto.GetJobResponse), &jobproto.GetJobResponse{Job: f.job})
		return nil
	}
	if !strings.HasSuffix(method, "/PutTask") {
		return errors.New("unexpected native RPC")
	}
	req := input.(*jobproto.PutTaskRequest)
	f.writes++
	if err := jobstore.ValidateTaskUpdate(f.task, req.Task); err != nil {
		return err
	}
	f.task = proto.Clone(req.Task).(*jobproto.Task)
	if f.scenario == "receipt-lost-ack" {
		return errors.New("receipt persisted but ACK lost")
	}
	if f.scenario != "receipt-empty-ack" {
		proto.Merge(output.(*jobproto.PutTaskResponse), &jobproto.PutTaskResponse{Task: proto.Clone(f.task).(*jobproto.Task)})
	}
	return nil
}

type nativeLinkTaskStream struct {
	grpc.ClientStream
	task *jobproto.Task
	sent bool
}

func (s *nativeLinkTaskStream) SendMsg(input interface{}) error {
	r := input.(*jobproto.ListTasksRequest)
	if r.JobID != s.task.JobID || r.TaskID != s.task.ID {
		return errors.New("wrong task lookup")
	}
	return nil
}
func (s *nativeLinkTaskStream) CloseSend() error { return nil }
func (s *nativeLinkTaskStream) RecvMsg(output interface{}) error {
	if s.sent {
		return io.EOF
	}
	s.sent = true
	proto.Merge(output.(*jobproto.ListTasksResponse), &jobproto.ListTasksResponse{Task: proto.Clone(s.task).(*jobproto.Task)})
	return nil
}
func (f *nativeLinkTasks) NewStream(_ context.Context, _ *grpc.StreamDesc, method string, _ ...grpc.CallOption) (grpc.ClientStream, error) {
	if !strings.HasSuffix(method, "/ListTasks") {
		return nil, errors.New("unexpected stream")
	}
	return &nativeLinkTaskStream{task: f.task}, nil
}
func (f *nativeLinkUsers) SearchOne(_ context.Context, r *idm.SearchUserRequest) (*idm.SearchUserResponse, error) {
	var query idm.UserSingleQuery
	if len(r.GetQuery().GetSubQueries()) != 1 || r.Query.SubQueries[0].UnmarshalTo(&query) != nil || query.Uuid != f.intent.NativeUserID {
		return nil, errors.New("wrong actor")
	}
	return &idm.SearchUserResponse{User: &idm.User{Uuid: f.intent.NativeUserID, Login: "native-owner"}}, nil
}

type nativeSharePolicy struct {
	idm.UnimplementedPolicyEngineServiceServer
	actor string
}

func (*nativeSharePolicy) IsAllowed(context.Context, *idm.PolicyEngineRequest) (*idm.PolicyEngineResponse, error) {
	return &idm.PolicyEngineResponse{Allowed: true}, nil
}
func (p *nativeSharePolicy) StreamPolicyGroups(_ *idm.ListPolicyGroupsRequest, stream idm.PolicyEngineService_StreamPolicyGroupsServer) error {
	return stream.Send(&idm.PolicyGroup{Policies: []*idm.Policy{{ID: "share-native-login", Subjects: []string{"subject:" + p.actor}, Resources: []string{"oidc"}, Actions: []string{"login"}, Effect: idm.PolicyEffect_allow}}})
}

func TestNativeShareExecutionObservesAfterArchivingAcrossSecond(t *testing.T) {
	cachehelper.SetStaticResolver("pm://", &gocache.URLOpener{})
	task, _ := nativeLinkFixture(t)
	intent, err := jobstore.NativeShareTaskIntent(task)
	if err != nil {
		t.Fatal(err)
	}
	ctx := config.WithStubStore(context.Background())
	serviceUser := "00000000-0000-4000-8000-000000000099"
	pepCalls := 0
	pep := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/token" {
			json.NewEncoder(w).Encode(map[string]interface{}{"access_token": "service-test", "token_type": "Bearer", "expires_in": 60})
			return
		}
		if r.URL.Path != "/service/v1/adapter/pep_check" || r.Header.Get("Authorization") != "Bearer service-test" {
			w.WriteHeader(403)
			return
		}
		pepCalls++
		json.NewEncoder(w).Encode(map[string]interface{}{"actionExecutionId": intent.Scope["action_execution_id"], "operationId": intent.Scope["operation_id"], "authorizationMinZedToken": "fresh", "bindingGeneration": intent.Generation})
	}))
	defer pep.Close()
	secret := filepath.Join(t.TempDir(), "secret")
	if err := os.WriteFile(secret, []byte("test-secret"), 0600); err != nil {
		t.Fatal(err)
	}
	delivery := map[string]interface{}{"bindingId": intent.BindingID, "tenantId": intent.Scope["tenant_id"], "nativeInstanceRef": "instance", "nativeScopeRef": intent.ShareID, "nativeRootRef": intent.Roots[0], "instanceServiceUuid": serviceUser,
		"corePepUrl": pep.URL + "/service/v1/adapter/pep_check", "oidcTokenUrl": pep.URL + "/token", "clientId": "share", "clientSecretFile": secret, "clientSecretMaxBytes": 256, "maxResponseBytes": 65536, "requestTimeout": "2s",
		"actors": []map[string]interface{}{{"principalId": intent.Scope["actor_principal_id"], "kind": "HUMAN", "userUuid": intent.NativeUserID}},
		"share":  map[string]interface{}{"nativeJobId": "share-native-job", "actionVersion": 1, "resultExposurePolicyId": intent.Scope["result_exposure_policy_id"], "resultExposurePolicyVersion": 1}}
	if err := config.Set(ctx, delivery, "services", common.ServiceRestNamespace_+"n", "platform"); err != nil {
		t.Fatal(err)
	}
	docs := &nativeLinkDocuments{intent: intent, scenario: "slow-removed"}
	store := &nativeLinkTasks{task: task, job: jobstore.NativeShareJob("share-native-job", intent.BindingID, intent.Generation)}
	grpcclient.RegisterMock(common.ServiceDocStoreGRPC, &docstore.DocStoreStub{DocStoreServer: docs})
	grpcclient.RegisterMock(common.ServiceUserGRPC, &idm.UserServiceStub{UserServiceServer: &nativeLinkUsers{intent: intent}})
	grpcclient.RegisterMock(common.ServiceWorkspaceGRPC, &idm.WorkspaceServiceStub{WorkspaceServiceServer: &nativeLinkWorkspaces{intent: intent}})
	grpcclient.RegisterMock(common.ServicePolicyGRPC, &idm.PolicyEngineServiceStub{PolicyEngineServiceServer: &nativeSharePolicy{actor: intent.NativeUserID}})
	grpcclient.RegisterMock(common.ServiceJobsGRPC, store)
	args, _ := json.Marshal(map[string]interface{}{"externalExecutionId": intent.Scope["external_execution_id"], "idempotencyKey": task.ID, "nativeType": "job"})
	payload, _ := json.Marshal(intent.Scope)
	proof, _ := json.Marshal(map[string]interface{}{"actionToken": "header." + base64.RawURLEncoding.EncodeToString(payload) + ".signed-by-authority", "argumentsJson": string(args)})
	request := httptest.NewRequest(http.MethodPost, "http://native.invalid/jobs/user", nil).WithContext(claim.ToContext(ctx, claim.Claims{Subject: serviceUser, Name: "service"}))
	if _, exists := routing.RouteById(common.RouteApiREST); !exists {
		routing.RegisterRoute(common.RouteApiREST, "REST API", common.DefaultRouteREST)
	}
	var result map[string]interface{}
	registrar := routing.NewRouteRegistrar()
	registrar.Route(common.RouteApiREST).Handle("/jobs/user", http.HandlerFunc(func(_ http.ResponseWriter, actual *http.Request) {
		result, err = new(Client).NativeShareExecution(actual, base64.RawURLEncoding.EncodeToString(proof), "observe", "")
	}))
	registrar.IteratePatterns(ctx, func(_ string, handler http.Handler) { handler.ServeHTTP(httptest.NewRecorder(), request) })
	if err != nil {
		t.Fatal(err)
	}
	execution := result["execution"].(map[string]interface{})
	observed, e1 := time.Parse(time.RFC3339Nano, execution["lastObservedAt"].(string))
	terminal, e2 := time.Parse(time.RFC3339Nano, execution["terminalAt"].(string))
	if e1 != nil || e2 != nil || terminal.After(observed) || execution["platformStatus"] != "SUCCEEDED" || pepCalls != 3 || store.writes != 1 || docs.deletes != 0 {
		t.Fatalf("invalid final observation: %v pep=%d writes=%d", execution, pepCalls, store.writes)
	}
}

func nativeLinkFixture(t *testing.T) (*jobproto.Task, *jobstore.NativeShareIntent) {
	t.Helper()
	ids := make([]string, 6)
	for i := range ids {
		ids[i] = fmt.Sprintf("00000000-0000-4000-8000-%012d", i+1)
	}
	intent := &jobstore.NativeShareIntent{BindingID: ids[0], Generation: 2, NativeUserID: ids[1], ShareID: ids[2], HiddenUserID: ids[3], HiddenUserLogin: "original-hidden-user", DocumentID: "original-share-hash", Roots: []string{ids[4]}}
	claims := map[string]interface{}{"action_key": "file_storage.share@v1", "external_execution_id": ids[4], "idempotency_key": ids[5],
		"tenant_id": ids[0], "actor_principal_id": ids[1], "initiating_human_principal_id": ids[1], "operation_id": ids[3], "action_execution_id": ids[4],
		"target_type": "RESOURCE", "target_id": ids[2], "result_exposure_policy_id": ids[3], "result_exposure_policy_version": 1, "action_definition_version": 1}
	task, err := jobstore.NewNativeShareTask(jobstore.NativeShareJob("share-native-job", ids[0], 2).ID, ids[5], "native-owner", *intent, claims)
	if err != nil {
		t.Fatal(err)
	}
	task.Status, task.StartTime = jobproto.TaskStatus_Running, int32(time.Now().Add(-time.Second).Unix())
	return task, intent
}

func TestNativeShareRevokeArchivesOnlyExactDispatchedRemoval(t *testing.T) {
	cachehelper.SetStaticResolver("pm://", &gocache.URLOpener{})
	for _, scenario := range []string{"removed", "document-present", "document-error", "user-present", "user-error", "workspace-present", "workspace-error", "not-dispatched", "local-error", "changed-claim", "fresh-refused", "receipt-lost-ack", "receipt-empty-ack"} {
		t.Run(scenario, func(t *testing.T) {
			task, intent := nativeLinkFixture(t)
			switch scenario {
			case "not-dispatched":
				task.StartTime = 0
			case "local-error":
				task.Status = jobproto.TaskStatus_Error
			case "changed-claim":
				task.ActionsLogs[0].InputMessage.OutputChain[0].JsonBody = []byte(`{}`)
			}
			docs := &nativeLinkDocuments{intent: intent, scenario: scenario}
			store := &nativeLinkTasks{task: proto.Clone(task).(*jobproto.Task), scenario: scenario}
			grpcclient.RegisterMock(common.ServiceDocStoreGRPC, &docstore.DocStoreStub{DocStoreServer: docs})
			grpcclient.RegisterMock(common.ServiceUserGRPC, &idm.UserServiceStub{UserServiceServer: &nativeLinkUsers{intent: intent, scenario: scenario}})
			grpcclient.RegisterMock(common.ServiceWorkspaceGRPC, &idm.WorkspaceServiceStub{WorkspaceServiceServer: &nativeLinkWorkspaces{intent: intent, scenario: scenario}})
			grpcclient.RegisterMock(common.ServiceJobsGRPC, store)
			fresh := 0
			terminal, err := archiveNativeShare(context.Background(), task, func() error {
				fresh++
				if scenario == "fresh-refused" {
					return errors.New("revoked")
				}
				return nil
			})
			if scenario == "removed" {
				if err != nil || terminal == "" || store.writes != 1 || fresh != 1 {
					t.Fatalf("confirmed original removal not archived: %q %v writes=%d fresh=%d", terminal, err, store.writes, fresh)
				}
				if _, err := jobstore.NativeShareTerminal(store.task); err != nil {
					t.Fatal(err)
				}
			} else if terminal != "" {
				t.Fatalf("unproven %s became terminal: %s", scenario, terminal)
			}
			if scenario == "document-error" || scenario == "user-error" || scenario == "workspace-error" || scenario == "changed-claim" || scenario == "fresh-refused" || scenario == "receipt-lost-ack" || scenario == "receipt-empty-ack" {
				if err == nil {
					t.Fatal("failure was swallowed")
				}
			}
			if scenario == "receipt-lost-ack" {
				store.scenario = "removed"
				terminal, err = archiveNativeShare(context.Background(), store.task, nil)
				if err != nil || terminal == "" || store.writes != 1 {
					t.Fatalf("persisted receipt recovery rewrote or lost evidence: %q %v", terminal, err)
				}
			}
			if docs.deletes != 0 {
				t.Fatal("observation repeated native deletion")
			}
		})
	}
}

func TestNativeShareOriginalDocumentRemovalUsesFreshExactReference(t *testing.T) {
	cachehelper.SetStaticResolver("pm://", &gocache.URLOpener{})
	for _, scenario := range []string{"removed", "fresh-refused", "different-share", "delete-lost-ack"} {
		t.Run(scenario, func(t *testing.T) {
			_, intent := nativeLinkFixture(t)
			docs := &nativeLinkDocuments{intent: intent, scenario: scenario}
			grpcclient.RegisterMock(common.ServiceDocStoreGRPC, &docstore.DocStoreStub{DocStoreServer: docs})
			calls := 0
			ctx := context.WithValue(context.Background(), nativeLinkContextKey{}, &nativeLinkMutation{intent: intent, fresh: func() error {
				calls++
				if scenario == "fresh-refused" {
					return errors.New("revoked")
				}
				return nil
			}})
			id := intent.ShareID
			if scenario == "different-share" {
				id = intent.HiddenUserID
			}
			err := NewClient(nil).DeleteHashDocument(ctx, id)
			if scenario == "removed" {
				if err != nil || docs.deletes != 1 || calls != 1 {
					t.Fatalf("native exact deletion failed: %v", err)
				}
			} else if err == nil {
				t.Fatal("uncertain or unauthorized deletion succeeded")
			}
			if (scenario == "fresh-refused" || scenario == "different-share") && docs.deletes != 0 {
				t.Fatal("rejected action dispatched native delete")
			}
		})
	}
}

func TestNativeShareTerminalRequiresDispatchAndFrozenReceipt(t *testing.T) {
	for _, scenario := range []string{"complete", "no-start", "end-before-start", "future-end", "different-receipt", "missing-receipt", "missing-ae"} {
		t.Run(scenario, func(t *testing.T) {
			task, _ := nativeLinkFixture(t)
			body, _ := jobstore.NativeCellTaskIntent(task)
			task.Status, task.EndTime = jobproto.TaskStatus_Finished, int32(time.Now().Unix())
			task.ActionsLogs = append(task.ActionsLogs, &jobproto.ActionLog{OutputMessage: &jobproto.ActionMessage{OutputChain: []*jobproto.ActionOutput{{Success: true, JsonBody: body, Vars: map[string]string{jobstore.NativeShareResult: "true"}}}}})
			switch scenario {
			case "no-start":
				task.StartTime = 0
			case "end-before-start":
				task.EndTime = task.StartTime - 1
			case "future-end":
				task.EndTime = int32(time.Now().Add(time.Hour).Unix())
			case "different-receipt":
				task.ActionsLogs[1].OutputMessage.OutputChain[0].JsonBody = []byte(`{}`)
			case "missing-receipt":
				task.ActionsLogs = task.ActionsLogs[:1]
			case "missing-ae":
				intent, err := jobstore.NativeShareTaskIntent(task)
				if err != nil {
					t.Fatal(err)
				}
				delete(intent.Scope, "action_execution_id")
				body, err := json.Marshal(intent)
				if err != nil {
					t.Fatal(err)
				}
				changed, err := jobstore.NewNativeCellTask(task.JobID, task.ID, task.TriggerOwner, body)
				if err != nil {
					t.Fatal(err)
				}
				task.ActionsLogs[0] = changed.ActionsLogs[0]
				task.ActionsLogs[1].OutputMessage.OutputChain[0].JsonBody = body
			}
			terminal, err := jobstore.NativeShareTerminal(task)
			if scenario == "complete" {
				if err != nil || terminal == "" {
					t.Fatalf("complete native receipt rejected: %v", err)
				}
			} else if err == nil || terminal != "" {
				t.Fatal("unproven dispatch/receipt accepted")
			}
		})
	}
}
