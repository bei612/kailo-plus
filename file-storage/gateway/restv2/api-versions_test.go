package restv2

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	restful "github.com/emicklei/go-restful/v3"
	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/auth/claim"
	grpcclient "github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/config/routing"
	"github.com/pydio/cells/v5/common/middleware"
	"github.com/pydio/cells/v5/common/nodes"
	"github.com/pydio/cells/v5/common/nodes/acl"
	omock "github.com/pydio/cells/v5/common/nodes/objects/mock"
	"github.com/pydio/cells/v5/common/permissions"
	"github.com/pydio/cells/v5/common/proto/idm"
	"github.com/pydio/cells/v5/common/proto/install"
	"github.com/pydio/cells/v5/common/proto/jobs"
	"github.com/pydio/cells/v5/common/proto/object"
	"github.com/pydio/cells/v5/common/proto/rest"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/common/utils/openurl"
	"github.com/pydio/cells/v5/data/versions"
	jobstore "github.com/pydio/cells/v5/scheduler/jobs"
	. "github.com/smartystreets/goconvey/convey"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

// mockPreSigner implements PreSigner interface for testing
type mockPreSigner struct {
	versionID string
}

type uploadNativeUser struct {
	idm.UnimplementedUserServiceServer
	user *idm.User
}

func (s *uploadNativeUser) SearchOne(_ context.Context, request *idm.SearchUserRequest) (*idm.SearchUserResponse, error) {
	query := new(idm.UserSingleQuery)
	if err := request.GetQuery().GetSubQueries()[0].UnmarshalTo(query); err != nil || query.GetUuid() != s.user.Uuid {
		return nil, fmt.Errorf("not the current exact native user")
	}
	return &idm.SearchUserResponse{User: s.user}, nil
}

type uploadNativeVersion struct {
	tree.UnimplementedNodeVersionerServer
	owner      string
	draft      string
	reads      int
	wrongOwner bool
}

type uploadNativePolicy struct {
	idm.UnimplementedPolicyEngineServiceServer
	user string
}

type uploadNativeRoles struct {
	idm.UnimplementedRoleServiceServer
}

func (*uploadNativeRoles) SearchRole(_ *idm.SearchRoleRequest, _ idm.RoleService_SearchRoleServer) error {
	return nil // this native fixture has no UI parameter overrides
}

type uploadNativeTree struct {
	tree.NodeProviderClient
	node              *tree.Node
	err               error
	reads             int
	allowDefaultFlags bool
	read              func(context.Context, *tree.ReadNodeRequest) (*tree.ReadNodeResponse, error)
	root              *tree.Node
}

// SourcesPool is process-wide and lazily opened once, including when these
// original route fixtures are selected separately or run together.
var nativeVersionsTree = new(uploadNativeTree)

var nativeVersionDeleteIndex = new(nativeDeleteIndex)

type nativeDeleteIndex struct {
	tree.NodeReceiverClient
	calls  int
	failAt int
}

func (s *nativeDeleteIndex) DeleteNode(_ context.Context, _ *tree.DeleteNodeRequest, _ ...grpc.CallOption) (*tree.DeleteNodeResponse, error) {
	s.calls++
	return &tree.DeleteNodeResponse{Success: s.calls != s.failAt}, nil
}

type nativeDeleteStorage struct {
	nodes.StorageClient
	calls  int
	failAt int
}

func (s *nativeDeleteStorage) RemoveObject(context.Context, string, string) error {
	s.calls++
	if s.calls == s.failAt {
		return io.ErrUnexpectedEOF
	}
	return nil
}

type nativeDeleteVersions struct {
	*nativeRevisionStream
	reply     *tree.DeleteVersionResponse
	err       error
	deletes   int
	versionID string
}

func (s *nativeDeleteVersions) NewStream(ctx context.Context, description *grpc.StreamDesc, method string, options ...grpc.CallOption) (grpc.ClientStream, error) {
	s.position = 0
	return s.nativeRevisionStream.NewStream(ctx, description, method, options...)
}

func (s *nativeDeleteVersions) Invoke(_ context.Context, method string, input interface{}, output interface{}, _ ...grpc.CallOption) error {
	request, ok := input.(*tree.HeadVersionRequest)
	if !ok || method != "/tree.NodeVersioner/DeleteVersion" || request.NodeUuid != s.nodeUUID || request.VersionId != s.versionID {
		return fmt.Errorf("not the original exact metadata deletion")
	}
	s.deletes++
	// Simulate the actual metadata side effect even if its ACK is lost.
	kept := make([]*tree.ContentRevision, 0, len(s.versions))
	for _, revision := range s.versions {
		if revision.VersionId != s.versionID {
			kept = append(kept, revision)
		}
	}
	s.versions = kept
	if s.err != nil {
		return s.err
	}
	if s.reply != nil {
		proto.Merge(output.(*tree.DeleteVersionResponse), s.reply)
	}
	return nil
}

func TestDeleteVersionRequiresEveryNativeAcknowledgement(t *testing.T) {
	nodes.SetSourcesPoolOpener(func(ctx context.Context) *openurl.Pool[nodes.SourcesPool] {
		return nodes.NewTestPool(ctx, nodes.MakeFakeClientsPool(nativeVersionsTree, nativeVersionDeleteIndex))
	})
	for _, scenario := range []string{"complete", "remaining-version", "legacy-location", "metadata-lost-ack", "metadata-negative-ack", "metadata-empty-ack", "metadata-wrong-version", "metadata-wrong-owner", "metadata-wrong-location", "metadata-missing-location", "blob-lost-ack", "blob-negative-ack", "empty-node-lost-ack", "empty-node-negative-ack", "history-unexpected-eof", "history-empty-row", "foreign-owner", "missing-location", "managed", "managed-empty", "native-proof", "duplicate-native-proof"} {
		t.Run(scenario, func(t *testing.T) {
			ctx := config.WithStubStore(context.Background())
			if scenario == "managed" || scenario == "managed-empty" {
				platform := map[string]interface{}{}
				if scenario == "managed" {
					platform["bindingId"] = "00000000-0000-4000-8000-000000000001"
				}
				if err := config.Set(ctx, platform, "services", common.ServiceRestNamespace_+"n", "platform"); err != nil {
					t.Fatal(err)
				}
			}
			user := &idm.User{Uuid: "00000000-0000-4000-8000-000000000003", Login: "native-user"}
			ctx = claim.ToContext(ctx, claim.Claims{Subject: user.Uuid, Name: user.Login})
			grpcclient.RegisterMock(common.ServiceRoleGRPC, &idm.RoleServiceStub{RoleServiceServer: &uploadNativeRoles{}})
			node := &tree.Node{Uuid: "00000000-0000-4000-8000-000000000004", Path: "native/current-name.txt", Type: tree.NodeType_LEAF}
			node.MustSetMeta(common.MetaNamespaceNodeDraftMode, true)
			*nativeVersionsTree = uploadNativeTree{node: node, allowDefaultFlags: true}
			*nativeVersionDeleteIndex = nativeDeleteIndex{}
			root := &tree.Node{Uuid: "00000000-0000-4000-8000-000000000008", Path: "native", Type: tree.NodeType_COLLECTION}
			workspace := &idm.Workspace{UUID: root.Uuid, Slug: "workspace", RootUUIDs: []string{root.Uuid}}
			access := permissions.NewAccessList(&idm.Role{Uuid: user.Uuid})
			access.AppendACLs(&idm.ACL{RoleID: user.Uuid, WorkspaceID: workspace.UUID, NodeID: root.Uuid, Action: permissions.AclRead},
				&idm.ACL{RoleID: user.Uuid, WorkspaceID: workspace.UUID, NodeID: root.Uuid, Action: permissions.AclWrite})
			access.Flatten(ctx)
			access.GetWorkspaces()[workspace.UUID] = workspace
			ctx = acl.WithPresetACL(ctx, access)
			storage := &nativeDeleteStorage{StorageClient: omock.New("native")}
			ctx = nodes.WithBranchInfo(ctx, "in", nodes.BranchInfo{Workspace: workspace,
				LoadedSource:  nodes.LoadedSource{DataSource: &object.DataSource{Name: "native", ObjectsBucket: "native", FlatStorage: true}, Client: storage},
				AncestorsList: map[string][]*tree.Node{"": {node, root}, node.Path: {node, root}}})
			revision := &tree.ContentRevision{VersionId: "native-draft", OwnerUuid: user.Uuid, Draft: true, Size: 3, ETag: "native-etag",
				Location:    &tree.Node{Uuid: "native-draft-blob", Path: "native/draft-blob", Type: tree.NodeType_LEAF},
				Description: "list-only description", IsHead: true}
			if scenario == "legacy-location" {
				if err := config.Set(ctx, "native", "services", "pydio.versions-store", "datasource"); err != nil {
					t.Fatal(err)
				}
				revision.Location = versions.DefaultLocation(ctx, node.Uuid, revision.VersionId)
			}
			if scenario == "foreign-owner" {
				revision.OwnerUuid = "another-user"
			}
			if scenario == "missing-location" {
				revision.Location = nil
			}
			persisted := proto.Clone(revision).(*tree.ContentRevision)
			persisted.Description, persisted.IsHead = "", false
			connection := &nativeDeleteVersions{nativeRevisionStream: &nativeRevisionStream{nodeUUID: node.Uuid, versions: []*tree.ContentRevision{revision}},
				versionID: revision.VersionId, reply: &tree.DeleteVersionResponse{Success: true, DeletedVersion: persisted}}
			switch scenario {
			case "remaining-version":
				connection.versions = append(connection.versions, &tree.ContentRevision{VersionId: "another-version", OwnerUuid: user.Uuid})
			case "legacy-location", "metadata-missing-location":
				persisted.Location = nil
			case "metadata-lost-ack":
				connection.err = io.ErrUnexpectedEOF
			case "metadata-negative-ack":
				connection.reply.Success = false
			case "metadata-empty-ack":
				connection.reply.DeletedVersion = nil
			case "metadata-wrong-version":
				persisted.VersionId = "another-version"
			case "metadata-wrong-owner":
				persisted.OwnerUuid = "another-user"
			case "metadata-wrong-location":
				persisted.Location.Path = "native/another-blob"
			case "blob-lost-ack":
				storage.failAt = 1
			case "blob-negative-ack":
				nativeVersionDeleteIndex.failAt = 1
			case "empty-node-lost-ack":
				storage.failAt = 2
			case "empty-node-negative-ack":
				nativeVersionDeleteIndex.failAt = 2
			case "history-unexpected-eof":
				connection.ending = io.ErrUnexpectedEOF
			case "history-empty-row":
				connection.versions = append(connection.versions, nil)
			}
			grpcclient.RegisterMock(common.ServiceVersionsGRPC, connection)
			service := new(restful.WebService).Path("/versions").Produces(restful.MIME_JSON)
			service.Route(service.DELETE("/{Uuid}/{VersionId}").To(middleware.WrapErrorHandlerToRoute((&Handler{}).DeleteVersion)))
			container := restful.NewContainer()
			container.Add(service)
			call := func() *httptest.ResponseRecorder {
				request := httptest.NewRequest(http.MethodDelete, "/versions/"+node.Uuid+"/"+revision.VersionId, nil).WithContext(ctx)
				request.Header.Set("Accept", restful.MIME_JSON)
				if scenario == "native-proof" || scenario == "duplicate-native-proof" {
					request.Header.Set("X-Kailo-Native-Execution", "unconsumed-platform-proof")
					if scenario == "duplicate-native-proof" {
						request.Header.Add("X-Kailo-Native-Execution", "second-unconsumed-proof")
					}
				}
				response := httptest.NewRecorder()
				container.ServeHTTP(response, request)
				if request.Header.Get("X-Kailo-Native-Execution") != "" {
					t.Fatal("unsupported proof remained on the original diagnostic request")
				}
				return response
			}
			response := call()
			if scenario == "managed" || scenario == "managed-empty" || scenario == "native-proof" || scenario == "duplicate-native-proof" {
				if response.Code != http.StatusForbidden || nativeVersionsTree.reads+connection.queries+connection.deletes+storage.calls+nativeVersionDeleteIndex.calls != 0 {
					t.Fatalf("unsupported managed delete reached native consumers: status=%d body=%s", response.Code, response.Body.String())
				}
				return
			}
			complete := scenario == "complete" || scenario == "remaining-version" || scenario == "legacy-location"
			if complete {
				var result rest.DeleteVersionResponse
				if response.Code != http.StatusOK || protojson.Unmarshal(response.Body.Bytes(), &result) != nil || !result.Success || result.EmptyNodeDeleted != (scenario != "remaining-version") {
					t.Fatalf("complete original deletion not confirmed: %d %s", response.Code, response.Body.String())
				}
				want := 2
				if scenario == "remaining-version" {
					want = 1
				}
				if connection.deletes != 1 || storage.calls != want || nativeVersionDeleteIndex.calls != want {
					t.Fatalf("unexpected side effects: metadata=%d blob=%d index=%d", connection.deletes, storage.calls, nativeVersionDeleteIndex.calls)
				}
				return
			}
			if response.Code < http.StatusBadRequest || strings.Contains(response.Body.String(), "Success") {
				t.Fatalf("unconfirmed deletion became a terminal success response: %d %s", response.Code, response.Body.String())
			}
			beforeDelete := scenario == "history-unexpected-eof" || scenario == "history-empty-row" || scenario == "foreign-owner" || scenario == "missing-location"
			if beforeDelete {
				if nativeVersionsTree.reads == 0 || connection.queries != 1 {
					t.Fatal("rejection did not reach the original node/history readers")
				}
				if connection.deletes+storage.calls+nativeVersionDeleteIndex.calls != 0 {
					t.Fatal("invalid/partial history started deletion")
				}
				return
			}
			if response.Code != http.StatusServiceUnavailable || connection.deletes != 1 {
				t.Fatalf("uncertain metadata operation not retained: %d %s", response.Code, response.Body.String())
			}
			if strings.HasPrefix(scenario, "metadata-") && storage.calls != 0 {
				t.Fatal("unconfirmed metadata ACK reached blob deletion")
			}
			if strings.HasPrefix(scenario, "blob-") && storage.calls != 1 {
				t.Fatal("unconfirmed blob ACK reached draft node deletion")
			}
			// Metadata may already be gone. A second user request must not turn
			// absence into proof that the blob/empty-node deletion completed.
			priorStorage, priorIndex := storage.calls, nativeVersionDeleteIndex.calls
			response = call()
			if response.Code == http.StatusOK || connection.deletes != 1 || storage.calls != priorStorage || nativeVersionDeleteIndex.calls != priorIndex {
				t.Fatal("partial deletion was replayed or inferred successful from absence")
			}
		})
	}
}

func (s *uploadNativeTree) ReadNode(ctx context.Context, request *tree.ReadNodeRequest, _ ...grpc.CallOption) (*tree.ReadNodeResponse, error) {
	s.reads++
	if s.read != nil {
		return s.read(ctx, request)
	}
	if s.err != nil {
		return nil, s.err
	}
	if !(s.allowDefaultFlags && len(request.StatFlags) == 0) && (len(request.StatFlags) != 1 || request.StatFlags[0] != tree.StatFlagNone) {
		return nil, fmt.Errorf("completion must explicitly reload native metadata")
	}
	return &tree.ReadNodeResponse{Node: s.node.Clone()}, nil
}

func (s *uploadNativeTree) ListNodes(ctx context.Context, request *tree.ListNodesRequest, _ ...grpc.CallOption) (tree.NodeProvider_ListNodesClient, error) {
	if !request.Ancestors || s.read == nil || s.root == nil {
		return nil, fmt.Errorf("unexpected native ancestor lookup")
	}
	response, err := s.read(ctx, &tree.ReadNodeRequest{Node: request.Node})
	if err != nil {
		return nil, err
	}
	rows := []*tree.Node{response.Node}
	if response.Node.Uuid != s.root.Uuid {
		rows = append(rows, s.root.Clone())
	}
	return &uploadCompletionAncestors{rows: rows}, nil
}

type uploadCompletionAncestors struct {
	grpc.ClientStream
	rows []*tree.Node
}

func (s *uploadCompletionAncestors) Recv() (*tree.ListNodesResponse, error) {
	if len(s.rows) == 0 {
		return nil, io.EOF
	}
	n := s.rows[0]
	s.rows = s.rows[1:]
	return &tree.ListNodesResponse{Node: n}, nil
}

func (s *uploadNativePolicy) StreamPolicyGroups(_ *idm.ListPolicyGroupsRequest, stream idm.PolicyEngineService_StreamPolicyGroupsServer) error {
	return stream.Send(&idm.PolicyGroup{Policies: []*idm.Policy{{ID: "native-upload-login-policy",
		Subjects: []string{"subject:" + s.user}, Resources: []string{"oidc"}, Actions: []string{"login"}, Effect: idm.PolicyEffect_allow}}})
}

func (s *uploadNativePolicy) IsAllowed(_ context.Context, request *idm.PolicyEngineRequest) (*idm.PolicyEngineResponse, error) {
	for _, subject := range request.Subjects {
		if subject == "subject:"+s.user && request.Action == http.MethodPost {
			return &idm.PolicyEngineResponse{Allowed: true}, nil
		}
	}
	return &idm.PolicyEngineResponse{}, nil
}

type uploadCompletionTasks struct {
	grpc.ClientConnInterface
	task          *jobs.Task
	jobID, key    string
	reads, writes int
}

func (f *uploadCompletionTasks) Invoke(context.Context, string, interface{}, interface{}, ...grpc.CallOption) error {
	f.writes++
	return fmt.Errorf("upload completion must not write or repeat dispatch")
}
func (f *uploadCompletionTasks) NewStream(_ context.Context, _ *grpc.StreamDesc, method string, _ ...grpc.CallOption) (grpc.ClientStream, error) {
	if method != "/jobs.JobService/ListTasks" {
		return nil, fmt.Errorf("unexpected task stream %s", method)
	}
	f.reads++
	return &uploadCompletionStream{state: f}, nil
}

type uploadCompletionStream struct {
	grpc.ClientStream
	state *uploadCompletionTasks
	sent  bool
}

func (s *uploadCompletionStream) SendMsg(value interface{}) error {
	r, ok := value.(*jobs.ListTasksRequest)
	if !ok || r.JobID != s.state.jobID || r.TaskID != s.state.key {
		return fmt.Errorf("not the frozen upload task")
	}
	return nil
}
func (*uploadCompletionStream) CloseSend() error { return nil }
func (s *uploadCompletionStream) RecvMsg(value interface{}) error {
	if s.sent || s.state.task == nil {
		return io.EOF
	}
	s.sent = true
	proto.Merge(value.(*jobs.ListTasksResponse), &jobs.ListTasksResponse{Task: s.state.task})
	return nil
}

type uploadCompletionVersion struct {
	tree.UnimplementedNodeVersionerServer
	nodeID  string
	version *tree.ContentRevision
	err     error
	reads   int
}

func (s *uploadCompletionVersion) HeadVersion(_ context.Context, r *tree.HeadVersionRequest) (*tree.HeadVersionResponse, error) {
	s.reads++
	if r.NodeUuid != s.nodeID || r.VersionId != s.version.VersionId {
		return nil, fmt.Errorf("not the frozen immutable version")
	}
	if s.err != nil {
		return nil, s.err
	}
	return &tree.HeadVersionResponse{Version: proto.Clone(s.version).(*tree.ContentRevision)}, nil
}

func TestNativeUploadCompletionReadsOriginalReceiptVersionAndCurrentNode(t *testing.T) {
	ids := make([]string, 12)
	for i := range ids {
		ids[i] = fmt.Sprintf("00000000-0000-4000-8000-%012d", i+1)
	}
	nodes.SetSourcesPoolOpener(func(ctx context.Context) *openurl.Pool[nodes.SourcesPool] {
		return nodes.NewTestPool(ctx, nodes.MakeFakeClientsPool(nativeVersionsTree, nativeVersionDeleteIndex))
	})
	for _, scenario := range []string{"complete", "empty", "missing-task", "unfinished-task", "wrong-action", "wrong-external", "wrong-generation", "missing-execution", "different-path", "missing-version", "wrong-owner", "wrong-location", "node-replaced", "node-unavailable", "node-acl-revoked", "gate-revoked", "missing-human-session"} {
		t.Run(scenario, func(t *testing.T) {
			ctx := config.WithStubStore(context.Background())
			user := &idm.User{Uuid: ids[2], Login: "native-user"}
			claims := claim.Claims{Subject: user.Uuid, Name: user.Login, SessionID: "native-session", AuthSource: "native-oidc"}
			ctx = claim.ToContext(ctx, claims)
			grpcclient.RegisterMock(common.ServiceUserGRPC, &idm.UserServiceStub{UserServiceServer: &uploadNativeUser{user: user}})
			grpcclient.RegisterMock(common.ServicePolicyGRPC, &idm.PolicyEngineServiceStub{PolicyEngineServiceServer: &uploadNativePolicy{user: user.Uuid}})
			grpcclient.RegisterMock(common.ServiceRoleGRPC, &idm.RoleServiceStub{RoleServiceServer: &uploadNativeRoles{}})
			root := &tree.Node{Uuid: ids[7], Path: "native", Type: tree.NodeType_COLLECTION}
			root.MustSetMeta(common.MetaNamespaceDatasourceName, "datasource")
			leaf := &tree.Node{Uuid: ids[3], Path: "native/file.txt", Type: tree.NodeType_LEAF}
			leaf.MustSetMeta(common.MetaNamespaceDatasourceName, "datasource")
			workspace := &idm.Workspace{UUID: ids[7], Slug: "workspace", RootUUIDs: []string{root.Uuid}}
			access := permissions.NewAccessList(&idm.Role{Uuid: user.Uuid})
			access.AppendACLs(&idm.ACL{RoleID: user.Uuid, NodeID: root.Uuid, WorkspaceID: workspace.UUID, Action: permissions.AclRead})
			if scenario == "node-acl-revoked" {
				access.AppendACLs(&idm.ACL{RoleID: user.Uuid, NodeID: leaf.Uuid, WorkspaceID: workspace.UUID, Action: permissions.AclDeny})
			}
			access.Flatten(ctx)
			access.GetWorkspaces()[workspace.UUID] = workspace
			ctx = acl.WithPresetACL(ctx, access)
			*nativeVersionsTree = uploadNativeTree{root: root, read: func(_ context.Context, r *tree.ReadNodeRequest) (*tree.ReadNodeResponse, error) {
				if r.Node.Uuid == root.Uuid || (r.Node.Uuid == "" && (r.Node.Path == "native" || r.Node.Path == "workspace")) {
					return &tree.ReadNodeResponse{Node: root.Clone()}, nil
				}
				if r.Node.Uuid == leaf.Uuid || (r.Node.Uuid == "" && strings.HasSuffix(r.Node.Path, "/file.txt")) {
					if scenario == "node-unavailable" {
						return nil, fmt.Errorf("original node unavailable")
					}
					n := leaf.Clone()
					if scenario == "node-replaced" {
						n.Uuid = ids[11]
					}
					return &tree.ReadNodeResponse{Node: n}, nil
				}
				return nil, fmt.Errorf("unexpected native lookup uuid=%s path=%s", r.Node.Uuid, r.Node.Path)
			}}
			defer func() { *nativeVersionsTree = uploadNativeTree{} }()
			for _, entry := range []struct {
				value interface{}
				path  []string
			}{
				{[]map[string]interface{}{{"id": claims.AuthSource, "type": "kailo-oidc", "config": map[string]interface{}{"issuer": "https://issuer.example.invalid", "clientId": "native-client", "users": []auth.NativeOIDCUser{{Subject: "native-subject", UserUUID: user.Uuid}}}}}, []string{"services", "pydio.web.oauth", "connectors"}},
				{[]*install.ProxyConfig{{ReverseProxyURL: "https://cells.example.invalid"}}, []string{"defaults", "sites"}},
				{base64.StdEncoding.EncodeToString(make([]byte, 64)), []string{"frontend", "session", "secureKey"}},
			} {
				if err := config.Set(ctx, entry.value, entry.path...); err != nil {
					t.Fatal(err)
				}
			}
			length := float64(12)
			if scenario == "empty" {
				length = 0
			}
			input := map[string]interface{}{"resourceId": ids[1], "nativeIntentId": ids[5], "nativeNodeId": leaf.Uuid, "nativeDeadline": float64(time.Now().Add(time.Minute).Unix()), "contentLength": length, "multipart": false}
			scope := map[string]interface{}{"tenant_id": ids[1], "actor_principal_id": ids[8], "initiating_human_principal_id": ids[8], "action_execution_id": ids[6], "external_execution_id": ids[9], "idempotency_key": ids[10]}
			task, err := jobstore.NewNativeUploadTask(ids[0], 3, auth.NativeUploadJobID("upload-job", ids[0], 3), ids[10], user.Login, user.Uuid, scope, input)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = jobstore.ClaimNativeUploadStep(task, "put", ids[11], "workspace/file.txt", "", int64(length)); err != nil {
				t.Fatal(err)
			}
			task.Status, task.StartTime = jobs.TaskStatus_Running, int32(time.Now().Unix())
			versionID, err := jobstore.NativeUploadVersionID(task)
			if err != nil {
				t.Fatal(err)
			}
			version := &tree.ContentRevision{VersionId: versionID, OwnerUuid: user.Uuid, Size: int64(length), ETag: "immutable-etag", Location: &tree.Node{Uuid: "immutable-object", Path: "native-version"}}
			draft := proto.Clone(version).(*tree.ContentRevision)
			draft.VersionId, draft.Draft = ids[5], true
			n := leaf.Clone()
			n.Path = "workspace/file.txt"
			n.MustSetMeta(common.MetaNamespaceMime, "text/plain")
			publication := &jobstore.NativeUploadPublicationRecord{Node: n, Draft: draft, Version: version}
			if err = jobstore.AppendNativeUploadPublication(task, publication); err != nil {
				t.Fatal(err)
			}
			if err = jobstore.CompleteNativeUploadPublication(task, publication, time.Now()); err != nil {
				t.Fatal(err)
			}
			store := &uploadCompletionTasks{task: task, jobID: task.JobID, key: task.ID}
			if scenario == "missing-task" {
				store.task = nil
			}
			if scenario == "unfinished-task" {
				task.Status, task.EndTime = jobs.TaskStatus_Running, 0
			}
			grpcclient.RegisterMock(common.ServiceJobsGRPC, store)
			versions := &uploadCompletionVersion{nodeID: leaf.Uuid, version: proto.Clone(version).(*tree.ContentRevision)}
			versions.version.IsHead = true
			if scenario == "missing-version" {
				versions.err = fmt.Errorf("version unavailable")
			}
			if scenario == "wrong-owner" {
				versions.version.OwnerUuid = ids[11]
			}
			if scenario == "wrong-location" {
				versions.version.Location.Uuid = "other-object"
			}
			grpcclient.RegisterMock(common.ServiceVersionsGRPC, &tree.NodeVersionerStub{NodeVersionerServer: versions})
			encodedInput, _ := json.Marshal(input)
			reference := map[string]interface{}{"externalExecutionId": ids[9], "idempotencyKey": ids[10], "nativeIntentId": ids[5], "bindingGeneration": 3}
			observed := map[string]interface{}{"submission": map[string]interface{}{"actionKey": "file_storage.write@v1", "operationId": ids[5], "actionExecutionId": ids[6], "gateState": "ALLOWED", "dispatchState": "DISPATCHED"}, "inputJson": string(encodedInput), "nativeExecution": reference, "terminalStatus": "COMPLETED", "nativeType": "version", "nativeId": versionID}
			switch scenario {
			case "wrong-action":
				observed["submission"].(map[string]interface{})["actionExecutionId"] = ids[11]
			case "wrong-external":
				reference["externalExecutionId"] = ids[11]
			case "wrong-generation":
				reference["bindingGeneration"] = 4
			case "missing-execution":
				delete(observed, "nativeExecution")
			case "gate-revoked":
				observed["submission"].(map[string]interface{})["gateState"] = "REVOKED"
			}
			observations := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if r.URL.Path == "/token" {
					_ = json.NewEncoder(w).Encode(map[string]interface{}{"access_token": "binding-service-only", "token_type": "Bearer", "expires_in": 60})
					return
				}
				var request map[string]interface{}
				if r.URL.Path != "/service/v1/adapter/human-action" || json.NewDecoder(r.Body).Decode(&request) != nil || r.Header.Get("Authorization") != "Bearer binding-service-only" || r.Header.Get("X-Kailo-Native-Human-Token") != "verified-upstream-access" || request["bindingId"] != ids[0] || request["idempotencyKey"] != ids[5] || request["command"] != nil || request["resolveResource"] != nil {
					t.Error("observation lost original HUMAN/execution or re-dispatched")
					w.WriteHeader(403)
					return
				}
				observations++
				_ = json.NewEncoder(w).Encode(observed)
			}))
			defer server.Close()
			secret := filepath.Join(t.TempDir(), "binding-secret")
			if err := os.WriteFile(secret, []byte("fixture-only"), 0600); err != nil {
				t.Fatal(err)
			}
			delivery := map[string]interface{}{"bindingId": ids[0], "instanceServiceUuid": ids[0], "tenantId": ids[1], "nativeRootRef": root.Uuid, "nativeInstanceRef": "native-instance", "nativeScopeRef": ids[7], "workspaceId": ids[7], "corePepUrl": server.URL + "/service/v1/adapter/pep_check", "oidcTokenUrl": server.URL + "/token", "clientId": "native-binding", "clientSecretFile": secret, "requestTimeout": "1s", "maxResponseBytes": 65536, "clientSecretMaxBytes": 128, "actors": []map[string]interface{}{{"principalId": ids[8], "kind": "HUMAN", "userUuid": user.Uuid}}, "draftUploads": map[string]interface{}{"timeout": "1m", "sweepInterval": "1s", "sweepBatchSize": 1}, "write": map[string]interface{}{"nativeJobId": "upload-job", "actionVersion": 1, "nativeType": "native-file", "resultExposurePolicyId": ids[6], "resultExposurePolicyVersion": 1}}
			if err := config.Set(ctx, delivery, "services", common.ServiceRestNamespace_+"n", "platform"); err != nil {
				t.Fatal(err)
			}
			targetPath := "workspace/file.txt"
			if scenario == "different-path" {
				targetPath = "workspace/renamed.txt"
			}
			body, _ := json.Marshal(map[string]interface{}{"Uuid": ids[5], "Path": targetPath, "Size": fmt.Sprint(int64(length)), "Multipart": false})
			request := httptest.NewRequest(http.MethodPost, "https://cells.example.invalid/n/upload/"+ids[5], strings.NewReader(string(body))).WithContext(ctx)
			request.Header.Set("Content-Type", restful.MIME_JSON)
			request.Header.Set("Idempotency-Key", ids[5])
			cookieResponse := httptest.NewRecorder()
			if err := auth.SaveNativeHumanToken(request, cookieResponse, "verified-upstream-access", "https://issuer.example.invalid", "native-subject", "native-client", user.Uuid, "native-session", time.Now().Add(time.Minute)); err != nil {
				t.Fatal(err)
			}
			if scenario != "missing-human-session" {
				request.AddCookie(cookieResponse.Result().Cookies()[0])
			}
			if _, exists := routing.RouteById(common.RouteApiRESTv2); !exists {
				routing.RegisterRoute(common.RouteApiRESTv2, "REST API v2", common.DefaultRouteRESTv2)
			}
			recorder := httptest.NewRecorder()
			var failure error
			registrar := routing.NewRouteRegistrar()
			registrar.Route(common.RouteApiRESTv2).Handle("/n/upload/"+ids[5], http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
				rq := restful.NewRequest(r)
				rq.PathParameters()["Uuid"] = ids[5]
				rp := restful.NewResponse(recorder)
				rp.SetRequestAccepts(restful.MIME_JSON)
				failure = (&Handler{}).PrepareUpload(rq, rp)
			}))
			registrar.IteratePatterns(ctx, func(_ string, handler http.Handler) { handler.ServeHTTP(recorder, request) })
			if scenario == "complete" || scenario == "empty" {
				var response rest.NativeUploadResponse
				if failure != nil || json.Unmarshal(recorder.Body.Bytes(), &response) != nil || !response.Completed || response.Ready || response.VersionId != versionID || versions.reads != 1 || observations != 1 || store.reads != 1 {
					t.Fatalf("original completion failed: %v body=%s version=%d observation=%d task=%d", failure, recorder.Body.String(), versions.reads, observations, store.reads)
				}
			} else if failure == nil || strings.Contains(recorder.Body.String(), `"Completed":true`) {
				t.Fatalf("unproved completion returned success: %s", recorder.Body.String())
			}
			if store.writes != 0 {
				t.Fatal("completion replayed native write")
			}
		})
	}
}

func (s *uploadNativeVersion) HeadVersion(_ context.Context, request *tree.HeadVersionRequest) (*tree.HeadVersionResponse, error) {
	s.reads++
	owner := s.owner
	if s.wrongOwner {
		owner = "another-native-owner"
	}
	return &tree.HeadVersionResponse{Version: &tree.ContentRevision{VersionId: request.VersionId, OwnerUuid: owner,
		Draft: request.VersionId == s.draft, Size: 0, Location: &tree.Node{Uuid: "native-draft-location", Type: tree.NodeType_LEAF}}}, nil
}

type nativeRevisionStream struct {
	grpc.ClientStream
	ctx      context.Context
	nodeUUID string
	versions []*tree.ContentRevision
	ending   error
	openErr  error
	queries  int
	position int
}

func (s *nativeRevisionStream) Invoke(context.Context, string, interface{}, interface{}, ...grpc.CallOption) error {
	return fmt.Errorf("unexpected unary version call")
}

func (s *nativeRevisionStream) NewStream(ctx context.Context, _ *grpc.StreamDesc, method string, _ ...grpc.CallOption) (grpc.ClientStream, error) {
	if method != "/tree.NodeVersioner/ListVersions" {
		return nil, fmt.Errorf("unexpected version method")
	}
	if s.openErr != nil {
		return nil, s.openErr
	}
	s.ctx = ctx
	return s, nil
}

func (s *nativeRevisionStream) Context() context.Context { return s.ctx }
func (s *nativeRevisionStream) CloseSend() error         { return nil }
func (s *nativeRevisionStream) SendMsg(message interface{}) error {
	request, ok := message.(*tree.ListVersionsRequest)
	if !ok || request.GetNode().GetUuid() != s.nodeUUID || request.Limit != 0 || request.Offset != 0 || request.SortField != "" || request.SortDesc || len(request.Filters) != 0 {
		return fmt.Errorf("not the original complete native version query")
	}
	s.queries++
	return nil
}

func (s *nativeRevisionStream) RecvMsg(message interface{}) error {
	if s.position == len(s.versions) {
		if s.ending != nil {
			return s.ending
		}
		return io.EOF
	}
	response, ok := message.(*tree.ListVersionsResponse)
	if !ok {
		return fmt.Errorf("unexpected version response type")
	}
	response.Version = s.versions[s.position]
	s.position++
	return nil
}

func TestNativeReadRevisionStreamRequiresActualEOF(t *testing.T) {
	// Exercise the original UUID/ACL route and generated version client. The
	// generic generated server stub loses a late stream error, so the existing
	// ResolveConn mock supplies that real client-stream error directly here.
	nodes.SetSourcesPoolOpener(func(ctx context.Context) *openurl.Pool[nodes.SourcesPool] {
		return nodes.NewTestPool(ctx, nodes.MakeFakeClientsPool(nativeVersionsTree, nativeVersionDeleteIndex))
	})
	for _, scenario := range []string{"complete", "empty", "unexpected-eof", "canceled", "unknown-open", "unknown-tail", "nil-version", "empty-version", "bounded", "independent-unexpected-eof"} {
		t.Run(scenario, func(t *testing.T) {
			ctx := config.WithStubStore(context.Background())
			user := &idm.User{Uuid: "00000000-0000-4000-8000-000000000003", Login: "native-user"}
			ctx = claim.ToContext(ctx, claim.Claims{Subject: user.Uuid, Name: user.Login})
			grpcclient.RegisterMock(common.ServiceRoleGRPC, &idm.RoleServiceStub{RoleServiceServer: &uploadNativeRoles{}})
			node := &tree.Node{Uuid: "00000000-0000-4000-8000-000000000004", Path: "native/current-name.txt", Type: tree.NodeType_LEAF, Size: 17, Etag: "native-etag"}
			*nativeVersionsTree = uploadNativeTree{node: node, allowDefaultFlags: true}
			root := &tree.Node{Uuid: "00000000-0000-4000-8000-000000000008", Path: "native", Type: tree.NodeType_COLLECTION}
			workspace := &idm.Workspace{UUID: root.Uuid, Slug: "workspace", RootUUIDs: []string{root.Uuid}}
			access := permissions.NewAccessList(&idm.Role{Uuid: user.Uuid})
			access.AppendACLs(&idm.ACL{RoleID: user.Uuid, WorkspaceID: workspace.UUID, NodeID: root.Uuid, Action: permissions.AclRead})
			access.Flatten(ctx)
			access.GetWorkspaces()[workspace.UUID] = workspace
			ctx = acl.WithPresetACL(ctx, access)
			ctx = nodes.WithBranchInfo(ctx, "in", nodes.BranchInfo{Workspace: workspace,
				LoadedSource:  nodes.LoadedSource{Client: omock.New("native")},
				AncestorsList: map[string][]*tree.Node{"": {node, root}, node.Path: {node, root}}})
			stream := &nativeRevisionStream{nodeUUID: node.Uuid, versions: []*tree.ContentRevision{
				{VersionId: "published-native-version", OwnerUuid: user.Uuid, IsHead: true, Size: node.Size, ETag: node.Etag},
				{VersionId: "own-native-draft", OwnerUuid: user.Uuid, Draft: true},
				{VersionId: "foreign-native-draft", OwnerUuid: "another-native-user", Draft: true},
			}}
			maxBytes := int64(4096)
			switch scenario {
			case "empty":
				stream.versions = nil
			case "unexpected-eof", "independent-unexpected-eof":
				stream.ending = io.ErrUnexpectedEOF
				if scenario == "independent-unexpected-eof" {
					maxBytes = 0 // retain the original independent native behavior
				}
			case "canceled":
				stream.ending = context.Canceled
			case "unknown-open":
				stream.openErr = fmt.Errorf("native stream opening unknown")
			case "unknown-tail":
				stream.ending = fmt.Errorf("native stream tail unknown")
			case "nil-version":
				stream.versions = []*tree.ContentRevision{nil}
			case "empty-version":
				stream.versions = []*tree.ContentRevision{{}}
			case "bounded":
				maxBytes = 1
			}
			grpcclient.RegisterMock(common.ServiceVersionsGRPC, stream)
			request := restful.NewRequest(httptest.NewRequest(http.MethodPost, "/a/tree/versions/"+node.Uuid, nil).WithContext(ctx))
			collection, err := (&Handler{}).nodeVersions(ctx, request, node.Uuid,
				&rest.NodeVersionsFilter{FilterBy: rest.VersionsTypes_VersionsAll, Flags: []rest.Flag{rest.Flag_WithMetaNone}}, maxBytes)
			accepted := scenario == "complete" || scenario == "empty" || scenario == "independent-unexpected-eof"
			if !accepted {
				if err == nil || collection != nil {
					t.Fatalf("an incomplete native stream became completed: collection=%v error=%v", collection, err)
				}
			} else {
				want := 2
				if scenario == "empty" {
					want = 0
				}
				if err != nil || collection == nil || len(collection.Versions) != want {
					t.Fatalf("original authorized complete versions not returned: collection=%v error=%v", collection, err)
				}
			}
			wantQueries := 1
			if scenario == "unknown-open" {
				wantQueries = 0
			}
			if stream.queries != wantQueries || nativeVersionsTree.reads != 1 {
				t.Fatalf("not one original authorized stream: queries=%d nodeReads=%d", stream.queries, nativeVersionsTree.reads)
			}
		})
	}
}

func TestNativePromoteUsesOriginalHumanAction(t *testing.T) {
	ids := make([]string, 8)
	for index := range ids {
		ids[index] = fmt.Sprintf("00000000-0000-4000-8000-%012d", index+1)
	}
	// The original SourcesPool is lazily opened once. Keep its native fixture
	// client stable and replace that client's data between serial scenarios.
	freshTree := nativeVersionsTree
	nodes.SetSourcesPoolOpener(func(c context.Context) *openurl.Pool[nodes.SourcesPool] {
		return nodes.NewTestPool(c, nodes.MakeFakeClientsPool(freshTree, nativeVersionDeleteIndex))
	})
	for _, scenario := range []string{"independent", "native-execution-on-independent", "native-execution-proof", "new", "opaque-draft-revision", "empty-draft-revision", "whitespace-draft-revision", "pending", "unknown", "unknown-enum", "explicit-unknown", "explicit-running", "null-terminal", "empty-terminal", "nonstring-terminal", "terminated", "timed-out", "completed", "completed-publish", "completed-node-unavailable", "completed-foreign-node", "completed-folder-node", "completed-revoked-acl", "failed", "canceled", "denied-before-dispatch", "revoked-after-unknown-dispatch",
		"lost-submit-ack", "unavailable-observe", "foreign-node", "duplicate-ref-key", "unknown-ref-field", "non-bool-publish",
		"wrong-resource", "wrong-draft-owner", "wrong-published-owner", "wrong-native-type", "draft-is-not-completion",
		"duplicate-idempotency-key", "missing-human-cookie", "another-native-session", "missing-write-metadata"} {
		t.Run(scenario, func(t *testing.T) {
			ctx := config.WithStubStore(context.Background())
			draftID := ids[4]
			if scenario == "opaque-draft-revision" {
				draftID = "native-opaque-draft-v1"
			}
			if scenario == "empty-draft-revision" {
				draftID = ""
			}
			if scenario == "whitespace-draft-revision" {
				draftID = " "
			}
			user := &idm.User{Uuid: ids[2], Login: "native-user"}
			grpcclient.RegisterMock(common.ServiceUserGRPC, &idm.UserServiceStub{UserServiceServer: &uploadNativeUser{user: user}})
			grpcclient.RegisterMock(common.ServicePolicyGRPC, &idm.PolicyEngineServiceStub{PolicyEngineServiceServer: &uploadNativePolicy{user: user.Uuid}})
			grpcclient.RegisterMock(common.ServiceRoleGRPC, &idm.RoleServiceStub{RoleServiceServer: &uploadNativeRoles{}})
			versions := &uploadNativeVersion{owner: user.Uuid, draft: draftID, wrongOwner: scenario == "wrong-draft-owner" || scenario == "wrong-published-owner"}
			grpcclient.RegisterMock(common.ServiceVersionsGRPC, &tree.NodeVersionerStub{NodeVersionerServer: versions})
			claims := claim.Claims{Subject: user.Uuid, Name: user.Login, SessionID: "native-session", AuthSource: "native-oidc"}
			ctx = claim.ToContext(ctx, claims)
			// Reuse the native UUID router, real read ACL evaluator and its
			// original SourcesPool fixture. No admin/skip-ACL context is used.
			freshNode := &tree.Node{Uuid: ids[3], Path: "native/current-name.txt", Type: tree.NodeType_LEAF, Size: 17, Etag: "current-native-etag"}
			*freshTree = uploadNativeTree{node: freshNode}
			if scenario == "completed-node-unavailable" {
				freshTree.err = fmt.Errorf("native node unavailable")
			}
			if scenario == "completed-foreign-node" {
				freshNode.Uuid = ids[0]
			}
			if scenario == "completed-folder-node" {
				freshNode.Type = tree.NodeType_COLLECTION
			}
			nativeRoot := &tree.Node{Uuid: ids[7], Path: "native", Type: tree.NodeType_COLLECTION}
			nativeWorkspace := &idm.Workspace{UUID: ids[7], Slug: "workspace", RootUUIDs: []string{nativeRoot.Uuid}}
			access := permissions.NewAccessList(&idm.Role{Uuid: user.Uuid})
			if scenario != "completed-revoked-acl" {
				access.AppendACLs(&idm.ACL{RoleID: user.Uuid, WorkspaceID: nativeWorkspace.UUID, NodeID: nativeRoot.Uuid, Action: permissions.AclRead})
			}
			access.Flatten(ctx)
			access.GetWorkspaces()[nativeWorkspace.UUID] = nativeWorkspace
			ctx = acl.WithPresetACL(ctx, access)
			ctx = nodes.WithBranchInfo(ctx, "in", nodes.BranchInfo{Workspace: nativeWorkspace,
				LoadedSource:  nodes.LoadedSource{Client: omock.New("native")},
				AncestorsList: map[string][]*tree.Node{"": {freshNode, nativeRoot}, freshNode.Path: {freshNode, nativeRoot}}})
			for _, entry := range []struct {
				value interface{}
				path  []string
			}{
				{[]map[string]interface{}{{"id": claims.AuthSource, "type": "kailo-oidc", "config": map[string]interface{}{
					"issuer": "https://issuer.example.invalid", "clientId": "native-client", "users": []auth.NativeOIDCUser{{Subject: "native-subject", UserUUID: user.Uuid}}}}}, []string{"services", "pydio.web.oauth", "connectors"}},
				{[]*install.ProxyConfig{{ReverseProxyURL: "https://cells.example.invalid"}}, []string{"defaults", "sites"}},
				{base64.StdEncoding.EncodeToString(make([]byte, 64)), []string{"frontend", "session", "secureKey"}},
			} {
				if err := config.Set(ctx, entry.value, entry.path...); err != nil {
					t.Fatal(err)
				}
			}
			publish := scenario == "completed-publish"
			input := map[string]interface{}{"resourceId": ids[1], "nativeObjectRef": writeReference(ids[3], publish),
				"nativeRevision": draftID, "displayName": "empty.txt", "mediaType": "text/plain"}
			observed := map[string]interface{}{"submission": map[string]interface{}{"actionKey": "file_storage.write@v1",
				"operationId": ids[5], "actionExecutionId": ids[6], "gateState": "ALLOWED", "dispatchState": "DISPATCHED"}, "inputReference": input}
			switch scenario {
			case "pending":
				// The original producer omits terminalStatus before reconciliation.
			case "unknown":
				observed["submission"].(map[string]interface{})["dispatchState"] = "UNKNOWN"
			case "unknown-enum":
				observed["terminalStatus"] = "FUTURE_NATIVE_STATE"
			case "explicit-unknown":
				observed["terminalStatus"] = "UNKNOWN"
			case "explicit-running":
				observed["terminalStatus"] = "RUNNING"
			case "null-terminal":
				observed["terminalStatus"] = nil
			case "empty-terminal":
				observed["terminalStatus"] = ""
			case "nonstring-terminal":
				observed["terminalStatus"] = true
			case "terminated":
				observed["terminalStatus"] = "TERMINATED"
			case "timed-out":
				observed["terminalStatus"] = "TIMED_OUT"
			case "completed", "completed-publish", "completed-node-unavailable", "completed-foreign-node", "completed-folder-node", "completed-revoked-acl", "wrong-published-owner", "wrong-native-type", "draft-is-not-completion":
				observed["terminalStatus"], observed["nativeType"], observed["nativeId"] = "COMPLETED", "version", "published-version"
				if scenario == "wrong-native-type" {
					observed["nativeType"] = "task"
				}
				if scenario == "draft-is-not-completion" {
					observed["nativeId"] = draftID
				}
			case "failed":
				observed["terminalStatus"] = "FAILED"
			case "canceled":
				observed["terminalStatus"] = "CANCELED"
			case "denied-before-dispatch":
				observed["submission"].(map[string]interface{})["gateState"] = "DENIED"
				observed["submission"].(map[string]interface{})["dispatchState"] = "NOT_DISPATCHED"
			case "revoked-after-unknown-dispatch":
				observed["submission"].(map[string]interface{})["gateState"] = "REVOKED"
				observed["submission"].(map[string]interface{})["dispatchState"] = "UNKNOWN"
			case "foreign-node":
				input["nativeObjectRef"] = writeReference(ids[0], false)
			case "duplicate-ref-key":
				input["nativeObjectRef"] = `{"nodeUuid":"` + ids[3] + `","publish":true,"publish":false}`
			case "unknown-ref-field":
				input["nativeObjectRef"] = `{"nodeUuid":"` + ids[3] + `","publish":false,"scope":"other"}`
			case "non-bool-publish":
				input["nativeObjectRef"] = `{"nodeUuid":"` + ids[3] + `","publish":"false"}`
			}
			commands, observations, resolutions := 0, 0, 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if r.URL.Path == "/token" {
					_ = json.NewEncoder(w).Encode(map[string]interface{}{"access_token": "binding-service-only", "token_type": "Bearer", "expires_in": 60})
					return
				}
				var request map[string]interface{}
				if r.URL.Path != "/service/v1/adapter/human-action" || json.NewDecoder(r.Body).Decode(&request) != nil ||
					r.Header.Get("Authorization") != "Bearer binding-service-only" || r.Header.Get("X-Kailo-Native-Human-Token") != "verified-upstream-access" || request["bindingId"] != ids[0] {
					t.Error("native user/binding proof did not reach the original private HUMAN action")
				}
				if selector, ok := request["resolveResource"].(map[string]interface{}); ok {
					resolutions++
					if selector["nativeRef"] != ids[3] || selector["nativeType"] != "native-file" || selector["workspaceId"] != ids[7] || selector["actionKey"] != "file_storage.write@v1" {
						t.Error("original resource selector was not exact")
					}
					resource := map[string]interface{}{"resourceId": ids[1], "resourceVersion": 1, "nativeType": "native-file", "nativeRef": ids[3], "nativeInstanceRef": "native-instance", "nativeScopeRef": ids[7]}
					if scenario == "wrong-resource" {
						resource["nativeRef"] = ids[0]
					}
					_ = json.NewEncoder(w).Encode(map[string]interface{}{"resource": resource})
					return
				}
				if command, ok := request["command"].(map[string]interface{}); ok {
					commands++
					component, _ := command["componentAction"].(map[string]interface{})
					actual, _ := json.Marshal(component["inputReference"])
					expected, _ := json.Marshal(input)
					if string(actual) != string(expected) || command["idempotencyKey"] != ids[5] || command["workspaceId"] != ids[7] || command["resourceVersion"] != float64(1) ||
						command["actionKey"] != "file_storage.write@v1" || component["resultExposurePolicyId"] != ids[6] {
						t.Error("native persisted draft or policy was not frozen in the original ActionCommand")
					}
					if scenario == "lost-submit-ack" {
						conn, _, err := w.(http.Hijacker).Hijack()
						if err != nil {
							t.Error(err)
							return
						}
						_ = conn.Close()
						return
					}
				} else {
					observations++
					if request["idempotencyKey"] != ids[5] {
						t.Error("observation changed the key")
					}
					if scenario == "unavailable-observe" {
						w.WriteHeader(http.StatusServiceUnavailable)
						return
					}
					if scenario == "new" || scenario == "opaque-draft-revision" || scenario == "lost-submit-ack" || scenario == "wrong-resource" || scenario == "wrong-draft-owner" {
						w.WriteHeader(http.StatusNotFound)
						return
					}
				}
				_ = json.NewEncoder(w).Encode(observed)
			}))
			defer server.Close()
			secret := filepath.Join(t.TempDir(), "binding-secret")
			if err := os.WriteFile(secret, []byte("fixture-only"), 0600); err != nil {
				t.Fatal(err)
			}
			delivery := map[string]interface{}{"bindingId": ids[0], "instanceServiceUuid": ids[0], "tenantId": ids[1],
				"corePepUrl": server.URL + "/service/v1/adapter/pep_check", "oidcTokenUrl": server.URL + "/token", "clientId": "native-binding", "clientSecretFile": secret,
				"requestTimeout": "1s", "maxResponseBytes": 8192, "clientSecretMaxBytes": 128, "nativeInstanceRef": "native-instance", "nativeScopeRef": ids[7], "workspaceId": ids[7],
				"write": map[string]interface{}{"actionVersion": 1, "nativeType": "native-file", "resultExposurePolicyId": ids[6], "resultExposurePolicyVersion": 1}}
			if scenario == "missing-write-metadata" {
				delete(delivery, "write")
			}
			if scenario != "independent" && scenario != "native-execution-on-independent" {
				if err := config.Set(ctx, delivery, "services", common.ServiceRestNamespace_+"n", "platform"); err != nil {
					t.Fatal(err)
				}
			}
			request := httptest.NewRequest(http.MethodPost, "https://cells.example.invalid/n/versions/promote", nil).WithContext(ctx)
			request.Header.Set("Idempotency-Key", ids[5])
			if scenario == "native-execution-on-independent" || scenario == "native-execution-proof" {
				request.Header.Set("X-Kailo-Native-Execution", "unaccepted-platform-proof")
			}
			if scenario == "duplicate-idempotency-key" {
				request.Header.Add("Idempotency-Key", ids[5])
			}
			cookieResponse := httptest.NewRecorder()
			if err := auth.SaveNativeHumanToken(request, cookieResponse, "verified-upstream-access", "https://issuer.example.invalid", "native-subject", "native-client", user.Uuid, "native-session", time.Now().Add(time.Minute)); err != nil {
				t.Fatal(err)
			}
			if scenario != "missing-human-cookie" {
				request.AddCookie(cookieResponse.Result().Cookies()[0])
			}
			if scenario == "another-native-session" {
				claims.SessionID = "another-native-session"
				request = request.WithContext(claim.ToContext(ctx, claims))
			}
			response := httptest.NewRecorder()
			nativeResponse := restful.NewResponse(response)
			nativeResponse.SetRequestAccepts(restful.MIME_JSON)
			if scenario == "native-execution-on-independent" || scenario == "native-execution-proof" {
				// Exercise the actual route prelude: no native ReadNode or private
				// callback may occur before refusing an unconsumed write proof.
				err := (&Handler{}).PromoteVersion(restful.NewRequest(request), nativeResponse)
				if err == nil || request.Header.Get("X-Kailo-Native-Execution") != "" || commands+observations+resolutions != 0 || versions.reads != 0 {
					t.Fatal("unconsumed platform write reached native reads or copy")
				}
				return
			}
			node := &tree.Node{Uuid: ids[3], Path: "workspace/empty.txt", Type: tree.NodeType_LEAF}
			node.MustSetMeta(common.MetaNamespaceMime, "text/plain")
			handled, err := (&Handler{}).platformPromoteVersion(restful.NewRequest(request), nativeResponse, node, draftID, publish)
			if request.Header.Get("X-Kailo-Native-Execution") != "" {
				t.Fatal("native execution proof reached downstream request diagnostics")
			}
			if scenario == "independent" {
				if handled || err != nil || commands+observations+resolutions != 0 {
					t.Fatal("independent UI acquired platform execution")
				}
				return
			}
			if !handled {
				t.Fatal("managed write fell back to independent native copy")
			}
			allowed := scenario == "new" || scenario == "opaque-draft-revision" || scenario == "pending" || scenario == "unknown" || scenario == "completed" || scenario == "revoked-after-unknown-dispatch"
			if allowed != (err == nil) {
				t.Fatalf("native producer mismatch: %v status=%d body=%s", err, response.Code, response.Body.String())
			}
			if scenario == "completed" {
				var completed rest.PromoteVersionResponse
				if response.Code != http.StatusOK || protojson.Unmarshal(response.Body.Bytes(), &completed) != nil || !completed.Success || completed.Published || completed.Node.GetUuid() != ids[3] || completed.Node.GetStorageETag() != freshNode.Etag || completed.Node.GetSize() != freshNode.Size || completed.Node.GetPath() != "workspace/current-name.txt" || versions.reads != 1 || freshTree.reads != 1 {
					t.Fatal("confirmed original published version was not required for success")
				}
			} else if allowed {
				var pending map[string]interface{}
				decodeError := json.Unmarshal(response.Body.Bytes(), &pending)
				_, nativeSuccess := pending["Success"]
				if response.Code != http.StatusAccepted || decodeError != nil || nativeSuccess {
					t.Fatalf("accepted/unknown was promoted to terminal native response: status=%d body=%s", response.Code, response.Body.String())
				}
			}
			if scenario == "new" || scenario == "opaque-draft-revision" || scenario == "lost-submit-ack" {
				if commands != 1 || observations != 1 || resolutions != 1 || versions.reads != 1 {
					t.Fatal("first command was replayed or skipped native draft authority")
				}
			} else if commands != 0 {
				t.Fatal("existing or refused intent was resubmitted")
			}
			if strings.Contains(response.Body.String(), "verified-upstream-access") || strings.Contains(response.Body.String(), "binding-service-only") {
				t.Fatal("native UI received credentials")
			}
		})
	}
}

func TestNativeBoundDataGatewayDoesNotBypassPromote(t *testing.T) {
	for _, bound := range []bool{false, true} {
		for _, method := range []string{http.MethodGet, http.MethodHead, http.MethodOptions, http.MethodPut, http.MethodPost, http.MethodDelete, http.MethodPatch} {
			for _, suffix := range []string{"", "?uploadId=existing-native-upload&partNumber=1", "?uploads", "?delete"} {
				t.Run(fmt.Sprintf("bound=%t/%s/%s", bound, method, suffix), func(t *testing.T) {
					ctx := config.WithStubStore(context.Background())
					if bound {
						// Presence, including incomplete delivery, is not permission
						// to fall back to independent native write semantics.
						if err := config.Set(ctx, map[string]interface{}{}, "services", common.ServiceRestNamespace_+"n", "platform"); err != nil {
							t.Fatal(err)
						}
					}
					request := httptest.NewRequest(method, "https://cells.example.invalid/io/workspace/file.txt"+suffix, nil).WithContext(ctx)
					// Untrusted metadata, an old native JWT or a claimed operation
					// header cannot make direct S3 bytes an admitted Action.
					request.Header.Set(common.XAmzMetaPrefix+common.InputDraftMode, "true")
					request.Header.Set(common.XAmzMetaPrefix+common.InputVersionId, "00000000-0000-4000-8000-000000000001")
					request.Header.Set("X-Amz-Copy-Source", "/io/workspace/old.txt")
					request.Header.Set("Authorization", "native-session-is-not-action-approval")
					err := auth.AuthorizeNativeDataMutation(request)
					mutation := method == http.MethodPut || method == http.MethodPost || method == http.MethodDelete || method == http.MethodPatch
					if (err != nil) != (bound && mutation) {
						t.Fatalf("data gateway mode=%t method=%s: mutation bypass or independent/read regression: %v", bound, method, err)
					}
				})
			}
		}
	}
}

func (m *mockPreSigner) PreSignV4(ctx context.Context, bucket, key string, params PresignParams) (*http.Request, time.Time, error) {
	u, _ := url.Parse("https://test.example.com/" + bucket + "/" + key)
	req, _ := http.NewRequest(http.MethodGet, u.String(), nil)
	if params.VersionID != "" {
		q := req.URL.Query()
		q.Set("versionId", params.VersionID)
		req.URL.RawQuery = q.Encode()
	}
	return req, time.Now().Add(1 * time.Hour), nil
}

func TestTreeContentRevisionToVersion_WithPresignedURLs(t *testing.T) {
	Convey("Test TreeContentRevisionToVersion with presigned URLs", t, func() {
		ctx := context.Background()
		h := &Handler{}

		// Create a mock content revision
		revision := &tree.ContentRevision{
			VersionId:   "test-version-123",
			Description: "Test version",
			MTime:       time.Now().Unix(),
			Size:        1024,
			ETag:        "test-etag",
			ContentHash: "test-hash",
			OwnerName:   "testuser",
			OwnerUuid:   "test-user-uuid",
			Location: &tree.Node{
				Path: "common-files/test-file.docx",
			},
		}

		// Create a test node to pass to the function
		testNode := &tree.Node{
			Path: "common-files/test-file.docx",
		}

		Convey("Without presigner option", func() {
			version := h.TreeContentRevisionToVersion(ctx, revision, testNode)
			So(version, ShouldNotBeNil)
			So(version.VersionId, ShouldEqual, "test-version-123")
			So(version.PreSignedGET, ShouldBeNil)
		})

		Convey("With presigner option", func() {
			mockSigner := &mockPreSigner{versionID: "test-version-123"}
			opts := []TNOption{WithPreSigner(mockSigner)}

			version := h.TreeContentRevisionToVersion(ctx, revision, testNode, opts...)
			So(version, ShouldNotBeNil)
			So(version.VersionId, ShouldEqual, "test-version-123")
			So(version.PreSignedGET, ShouldNotBeNil)
			So(version.PreSignedGET.Url, ShouldContainSubstring, "versionId=test-version-123")
			So(version.PreSignedGET.Url, ShouldContainSubstring, "common-files/test-file.docx")
			So(version.PreSignedGET.ExpiresAt, ShouldBeGreaterThan, 0)
		})

		Convey("With presigner but no node", func() {
			revisionNoLocation := &tree.ContentRevision{
				VersionId:   "test-version-456",
				Description: "Test version",
			}
			mockSigner := &mockPreSigner{versionID: "test-version-456"}
			opts := []TNOption{WithPreSigner(mockSigner)}

			version := h.TreeContentRevisionToVersion(ctx, revisionNoLocation, nil, opts...)
			So(version, ShouldNotBeNil)
			So(version.VersionId, ShouldEqual, "test-version-456")
			// Should not have presigned URL when node is nil
			So(version.PreSignedGET, ShouldBeNil)
		})

		Convey("Presigned URL expiration is set correctly", func() {
			mockSigner := &mockPreSigner{versionID: "test-version-789"}
			opts := []TNOption{WithPreSigner(mockSigner)}

			version := h.TreeContentRevisionToVersion(ctx, revision, testNode, opts...)
			So(version.PreSignedGET, ShouldNotBeNil)
			// ExpiresAt should be a future timestamp (Unix timestamp)
			So(version.PreSignedGET.ExpiresAt, ShouldBeGreaterThan, time.Now().Unix())
		})

		Convey("Presigned URL includes correct versionId parameter and uses node path", func() {
			testVersionId := "specific-version-id-123"
			testNodePath := "common-files/different-path.docx"
			nodeWithPath := &tree.Node{
				Path: testNodePath,
			}
			revisionWithId := &tree.ContentRevision{
				VersionId:   testVersionId,
				Description: "Test version",
			}
			mockSigner := &mockPreSigner{versionID: testVersionId}
			opts := []TNOption{WithPreSigner(mockSigner)}

			version := h.TreeContentRevisionToVersion(ctx, revisionWithId, nodeWithPath, opts...)
			So(version.PreSignedGET, ShouldNotBeNil)
			// URL should contain the versionId as a query parameter
			So(version.PreSignedGET.Url, ShouldContainSubstring, "versionId="+testVersionId)
			// URL should use the node's path, not the location path
			So(version.PreSignedGET.Url, ShouldContainSubstring, testNodePath)
		})
	})
}
