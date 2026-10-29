package pydio

import (
	"bytes"
	"context"
	"crypto/md5"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	minio "github.com/minio/minio/cmd"
	"github.com/minio/minio/pkg/hash"
	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/auth/claim"
	grpcclient "github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/nodes"
	"github.com/pydio/cells/v5/common/nodes/acl"
	"github.com/pydio/cells/v5/common/nodes/compose"
	"github.com/pydio/cells/v5/common/nodes/models"
	objectmock "github.com/pydio/cells/v5/common/nodes/objects/mock"
	"github.com/pydio/cells/v5/common/nodes/put"
	"github.com/pydio/cells/v5/common/nodes/version"
	"github.com/pydio/cells/v5/common/permissions"
	"github.com/pydio/cells/v5/common/proto/docstore"
	"github.com/pydio/cells/v5/common/proto/idm"
	"github.com/pydio/cells/v5/common/proto/jobs"
	"github.com/pydio/cells/v5/common/proto/object"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/common/utils/cache/gocache"
	cachehelper "github.com/pydio/cells/v5/common/utils/cache/helper"
	"github.com/pydio/cells/v5/common/utils/uuid"
	jobstore "github.com/pydio/cells/v5/scheduler/jobs"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
)

// Only the remote stores/Core are fixtures. The test calls the original S3
// entry, native HUMAN-cookie reader, fresh HTTP consumer, draft middleware,
// immutable VersionAction, and native Task receipt parser without copying them.
type uploadPool struct {
	nodes.SourcesPool
	storage *uploadObjectStore
}

// The upstream in-memory object's GET omits Key/ETag although its stored
// object has both. Preserve that original stored evidence for the real
// revision-copy consumer, including the conditional GET it actually sends.
type uploadObjectStore struct{ *objectmock.Client }

func (s *uploadObjectStore) GetObject(ctx context.Context, bucket, key string, meta models.ReadMeta) (io.ReadCloser, models.ObjectInfo, error) {
	info, err := s.StatObject(ctx, bucket, key, meta)
	if err != nil {
		return nil, info, err
	}
	if match := meta["If-Match"]; match != "" && match != "\""+info.ETag+"\"" {
		return nil, info, errors.WithStack(errors.StatusConflict)
	}
	reader, _, err := s.Client.GetObject(ctx, bucket, key, meta)
	return reader, info, err
}

func (s *uploadObjectStore) PutObject(ctx context.Context, bucket, key string, reader io.Reader, size int64, meta models.PutMeta) (models.ObjectInfo, error) {
	body, err := io.ReadAll(reader)
	if err != nil {
		return models.ObjectInfo{}, err
	}
	if int64(len(body)) != size {
		return models.ObjectInfo{}, io.ErrUnexpectedEOF
	}
	digest := md5.Sum(body)
	if meta.UserMetadata == nil {
		meta.UserMetadata = map[string]string{}
	}
	meta.UserMetadata["eTag"] = hex.EncodeToString(digest[:])
	return s.Client.PutObject(ctx, bucket, key, bytes.NewReader(body), size, meta)
}

func (p *uploadPool) GetDataSourceInfo(name string, _ ...int) (nodes.LoadedSource, error) {
	return nodes.LoadedSource{DataSource: &object.DataSource{Name: name, ObjectsBucket: name, FlatStorage: true,
		StorageConfiguration: map[string]string{object.StorageKeyCellsInternal: "true"}}, Client: p.storage}, nil
}

type uploadDocuments struct{ nativeReadDocuments }

type uploadRoles struct {
	idm.UnimplementedRoleServiceServer
	user string
}

func (s *uploadRoles) SearchRole(_ *idm.SearchRoleRequest, stream idm.RoleService_SearchRoleServer) error {
	return stream.Send(&idm.SearchRoleResponse{Role: &idm.Role{Uuid: s.user}})
}

type uploadFrontACLs struct {
	idm.UnimplementedACLServiceServer
}

func (*uploadFrontACLs) SearchACL(*idm.SearchACLRequest, idm.ACLService_SearchACLServer) error {
	return nil
}

type uploadTree struct {
	*nativeReadTree
	tree.NodeReceiverClient
	versions *uploadVersions
	written  map[string]*tree.Node
}

func (s *uploadTree) ReadNode(ctx context.Context, request *tree.ReadNodeRequest, opts ...grpc.CallOption) (*tree.ReadNodeResponse, error) {
	for _, node := range s.written {
		if request.Node.Uuid == node.Uuid || request.Node.Path == node.Path {
			return &tree.ReadNodeResponse{Node: node.Clone()}, nil
		}
	}
	for _, revision := range s.versions.values {
		location := revision.Location
		if request.Node.Uuid == location.Uuid || request.Node.Path == location.Path {
			node := location.Clone()
			node.Size, node.Etag = revision.Size, revision.ETag
			return &tree.ReadNodeResponse{Node: node}, nil
		}
	}
	if request.Node.Uuid == s.root.Uuid || request.Node.Uuid == s.file.Uuid || request.Node.Path == s.root.Path || request.Node.Path == s.file.Path {
		return s.nativeReadTree.ReadNode(ctx, request, opts...)
	}
	return nil, errors.WithStack(errors.NodeNotFound)
}

func (s *uploadTree) CreateNode(_ context.Context, request *tree.CreateNodeRequest, _ ...grpc.CallOption) (*tree.CreateNodeResponse, error) {
	s.written[request.Node.Uuid] = request.Node.Clone()
	return &tree.CreateNodeResponse{Node: request.Node.Clone()}, nil
}

func (s *uploadTree) DeleteNode(_ context.Context, request *tree.DeleteNodeRequest, _ ...grpc.CallOption) (*tree.DeleteNodeResponse, error) {
	delete(s.written, request.Node.Uuid)
	return &tree.DeleteNodeResponse{Success: true}, nil
}

func (*uploadDocuments) GetDocument(context.Context, *docstore.GetDocumentRequest) (*docstore.GetDocumentResponse, error) {
	return &docstore.GetDocumentResponse{Document: &docstore.Document{Data: `{"VersionsDataSourceName":"versions"}`}}, nil
}

type uploadVersions struct {
	tree.UnimplementedNodeVersionerServer
	values    map[string]*tree.ContentRevision
	loseStore bool
	stores    int
	tasks     *uploadTasks
}

func (s *uploadVersions) CreateVersion(ctx context.Context, request *tree.CreateVersionRequest) (*tree.CreateVersionResponse, error) {
	location := &tree.Node{Uuid: request.VersionUuid, Path: "versions/" + request.VersionUuid, Type: tree.NodeType_LEAF}
	location.MustSetMeta(common.MetaNamespaceDatasourceName, "versions")
	location.MustSetMeta(common.MetaNamespaceDatasourcePath, request.VersionUuid)
	v := &tree.ContentRevision{VersionId: request.VersionUuid, OwnerUuid: request.OwnerUuid, OwnerName: request.OwnerName,
		Draft: request.Draft, Size: request.Node.Size, ETag: request.Node.Etag, Location: location}
	// Model the remote version service's durable pre-copy output. The
	// service/DAO transaction itself is exercised in its original package.
	if !request.Draft {
		task := proto.Clone(s.tasks.task).(*jobs.Task)
		intent, err := jobstore.NativeUploadTaskIntent(task)
		if err != nil {
			return nil, err
		}
		record := &jobstore.NativeUploadPublicationRecord{Node: request.Node.Clone(),
			Draft: s.values[intent.Input["nativeIntentId"].(string)], Version: v}
		if err := jobstore.AppendNativeUploadPublication(task, record); err != nil {
			return nil, err
		}
		ack, err := s.tasks.PutTask(ctx, &jobs.PutTaskRequest{Task: task})
		if err != nil {
			return nil, err
		}
		if !proto.Equal(ack.GetTask(), task) {
			return nil, errors.WithStack(errors.StatusConflict)
		}
	}
	return &tree.CreateVersionResponse{Version: v}, nil
}

func (s *uploadVersions) StoreVersion(_ context.Context, request *tree.StoreVersionRequest) (*tree.StoreVersionResponse, error) {
	if !request.Version.Draft {
		record, err := jobstore.NativeUploadPublicationFromTask(s.tasks.task)
		if err != nil || record == nil || !proto.Equal(record.Version, request.Version) {
			return nil, errors.WithStack(errors.StatusConflict)
		}
	}
	s.stores++
	s.values[request.Version.VersionId] = proto.Clone(request.Version).(*tree.ContentRevision)
	if s.loseStore && !request.Version.Draft {
		return &tree.StoreVersionResponse{}, nil
	}
	return &tree.StoreVersionResponse{Success: true, Version: proto.Clone(request.Version).(*tree.ContentRevision)}, nil
}

func (s *uploadVersions) HeadVersion(_ context.Context, request *tree.HeadVersionRequest) (*tree.HeadVersionResponse, error) {
	v := s.values[request.VersionId]
	if v == nil {
		return nil, errors.WithStack(errors.VersionNotFound)
	}
	return &tree.HeadVersionResponse{Version: proto.Clone(v).(*tree.ContentRevision)}, nil
}

func (s *uploadVersions) DeleteVersion(_ context.Context, request *tree.HeadVersionRequest) (*tree.DeleteVersionResponse, error) {
	v := s.values[request.VersionId]
	if v == nil {
		return nil, errors.WithStack(errors.VersionNotFound)
	}
	delete(s.values, request.VersionId)
	return &tree.DeleteVersionResponse{Success: true, DeletedVersion: v}, nil
}

type uploadTasks struct {
	jobs.UnimplementedJobServiceServer
	grpc.ClientConnInterface
	task       *jobs.Task
	loseFinish bool
	losePlan   bool
	puts       int
}

func (s *uploadTasks) Invoke(ctx context.Context, method string, args, reply interface{}, _ ...grpc.CallOption) error {
	if method != jobs.JobService_PutTask_FullMethodName {
		return fmt.Errorf("unexpected upload Task RPC: %s", method)
	}
	response, err := s.PutTask(ctx, args.(*jobs.PutTaskRequest))
	if err == nil {
		proto.Merge(reply.(proto.Message), response)
	}
	return err
}

func (s *uploadTasks) NewStream(ctx context.Context, _ *grpc.StreamDesc, method string, _ ...grpc.CallOption) (grpc.ClientStream, error) {
	if method != jobs.JobService_ListTasks_FullMethodName {
		return nil, fmt.Errorf("unexpected upload Task stream: %s", method)
	}
	return &uploadTaskStream{ctx: ctx, task: proto.Clone(s.task).(*jobs.Task)}, nil
}

type uploadTaskStream struct {
	grpc.ClientStream
	ctx  context.Context
	task *jobs.Task
}

func (s *uploadTaskStream) Context() context.Context { return s.ctx }
func (*uploadTaskStream) SendMsg(interface{}) error  { return nil }
func (*uploadTaskStream) CloseSend() error           { return nil }
func (s *uploadTaskStream) RecvMsg(value interface{}) error {
	if s.task == nil {
		return io.EOF
	}
	proto.Merge(value.(proto.Message), &jobs.ListTasksResponse{Task: s.task})
	s.task = nil
	return nil
}

func (s *uploadTasks) ListTasks(_ *jobs.ListTasksRequest, stream jobs.JobService_ListTasksServer) error {
	return stream.Send(&jobs.ListTasksResponse{Task: proto.Clone(s.task).(*jobs.Task)})
}

func (s *uploadTasks) PutTask(_ context.Context, request *jobs.PutTaskRequest) (*jobs.PutTaskResponse, error) {
	s.puts++
	s.task = proto.Clone(request.Task).(*jobs.Task)
	if s.losePlan {
		if plan, _ := jobstore.NativeUploadPublicationFromTask(s.task); plan != nil {
			return &jobs.PutTaskResponse{}, nil
		}
	}
	if s.loseFinish && s.task.Status == jobs.TaskStatus_Finished {
		return &jobs.PutTaskResponse{}, nil
	}
	return &jobs.PutTaskResponse{Task: proto.Clone(s.task).(*jobs.Task)}, nil
}

type uploadByteStore struct {
	*nodes.HandlerMock
	root, node *tree.Node
	storage    *uploadObjectStore
	writes     int
	readBytes  int
	partial    bool
}

func (s *uploadByteStore) ReadNode(_ context.Context, request *tree.ReadNodeRequest, _ ...grpc.CallOption) (*tree.ReadNodeResponse, error) {
	if request.Node.Path == s.root.Path {
		return &tree.ReadNodeResponse{Node: s.root.Clone()}, nil
	}
	return &tree.ReadNodeResponse{Node: s.node.Clone()}, nil
}

func (s *uploadByteStore) PutObject(ctx context.Context, node *tree.Node, reader io.Reader, data *models.PutRequestData) (models.ObjectInfo, error) {
	s.writes++
	body, err := io.ReadAll(reader)
	s.readBytes += len(body)
	if err != nil {
		return models.ObjectInfo{}, err
	}
	if s.partial {
		return models.ObjectInfo{}, io.ErrUnexpectedEOF
	}
	digest := md5.Sum(body)
	return s.storage.PutObject(ctx, "versions", node.Uuid, bytes.NewReader(body), int64(len(body)),
		models.PutMeta{UserMetadata: map[string]string{"eTag": hex.EncodeToString(digest[:])}})
}

func (s *uploadByteStore) CopyObject(ctx context.Context, from, to *tree.Node, _ *models.CopyRequestData) (models.ObjectInfo, error) {
	return s.storage.CopyObject(ctx, "versions", from.Uuid, "live", to.Uuid, nil, nil, nil)
}

// Revoke only after the writer's pre-read admission has succeeded and the
// request body has been read. No timing or test-only authorization hook is
// needed: the following real HTTP Fresh must observe this revocation.
type uploadRevokingReader struct {
	reader  io.Reader
	revoked *atomic.Bool
	withEOF bool
	prefix  int
}

func (r *uploadRevokingReader) Read(p []byte) (int, error) {
	if r.prefix > 0 {
		if len(p) > r.prefix {
			p = p[:r.prefix]
		}
		n, err := r.reader.Read(p)
		r.prefix -= n
		return n, err
	}
	n, err := r.reader.Read(p)
	if n > 0 {
		r.revoked.Store(true)
		if r.withEOF {
			err = io.EOF
		}
	}
	return n, err
}

func TestNativeUploadS3RequiresImmutableVersionAndTaskAcknowledgement(t *testing.T) {
	cachehelper.SetStaticResolver("pm://", &gocache.URLOpener{})
	// The original policy provider caches its service projection. These are
	// repeated requests by one independent HUMAN, not invented new users behind
	// the same cached policy provider in every subcase.
	user, principal := uuid.New(), uuid.New()
	grpcclient.RegisterMock(common.ServiceRoleGRPC, &idm.RoleServiceStub{RoleServiceServer: &uploadRoles{user: user}})
	grpcclient.RegisterMock(common.ServiceAclGRPC, &idm.ACLServiceStub{ACLServiceServer: new(uploadFrontACLs)})
	for _, size := range []int{0, 12} {
		for _, scenario := range []string{"complete", "partial-bytes", "publication-plan-ACK-lost", "version-ACK-lost", "task-ACK-lost", "fresh-revoked", "body-read-revoked", "body-read-EOF-revoked", "body-prefix-revoked"} {
			bodyRevocation := scenario == "body-read-revoked" || scenario == "body-read-EOF-revoked" || scenario == "body-prefix-revoked"
			if size == 0 && bodyRevocation {
				continue
			}
			t.Run(fmt.Sprintf("%d/%s", size, scenario), func(t *testing.T) {
				ctx := config.WithStubStore(context.Background())
				resource, nodeID, binding, ae, ee, intent, key, operation, policy := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
				login := "upload-" + user
				ctx = claim.ToContext(ctx, claim.Claims{Subject: user, Name: login, SessionID: "native-session", AuthSource: "kailo"})
				grpcclient.RegisterMock(common.ServiceUserGRPC, &idm.UserServiceStub{UserServiceServer: &nativeReadUser{user: &idm.User{Uuid: user, Login: login}}})
				grpcclient.RegisterMock(common.ServicePolicyGRPC, &idm.PolicyEngineServiceStub{PolicyEngineServiceServer: &nativeReadPolicy{subject: user}})
				grpcclient.RegisterMock(common.ServiceDocStoreGRPC, &docstore.DocStoreStub{DocStoreServer: new(uploadDocuments)})
				versions := &uploadVersions{values: map[string]*tree.ContentRevision{}, loseStore: scenario == "version-ACK-lost"}
				grpcclient.RegisterMock(common.ServiceVersionsGRPC, &tree.NodeVersionerStub{NodeVersionerServer: versions})
				root := &tree.Node{Uuid: resource, Path: "live", Type: tree.NodeType_COLLECTION}
				node := &tree.Node{Uuid: nodeID, Path: "live/file.txt", Type: tree.NodeType_LEAF, Etag: common.NodeFlagEtagTemporary}
				for _, n := range []*tree.Node{root, node} {
					n.MustSetMeta(common.MetaNamespaceDatasourceName, "live")
					n.MustSetMeta(common.MetaNamespaceDatasourcePath, path.Base(n.Path))
				}
				node.MustSetMeta(common.MetaNamespaceMime, "text/plain")
				storage := &uploadObjectStore{Client: objectmock.New("live", "versions")}
				index := &uploadTree{nativeReadTree: &nativeReadTree{root: root, file: node}, versions: versions, written: map[string]*tree.Node{}}
				pool := &uploadPool{SourcesPool: nodes.MakeFakeClientsPool(index, index), storage: storage}
				setNativeGatewaySources(pool)
				access := permissions.NewAccessList(&idm.Role{Uuid: user})
				access.AppendACLs(&idm.ACL{RoleID: user, NodeID: resource, WorkspaceID: resource, Action: permissions.AclRead}, &idm.ACL{RoleID: user, NodeID: resource, WorkspaceID: resource, Action: permissions.AclWrite})
				access.Flatten(ctx)
				if err := access.LoadWorkspaces(ctx, func(context.Context, []string) ([]*idm.Workspace, error) {
					return []*idm.Workspace{{UUID: resource, Slug: "live"}}, nil
				}); err != nil {
					t.Fatal(err)
				}
				ctx = acl.WithPresetACL(ctx, access)
				input := map[string]interface{}{"resourceId": resource, "nativeIntentId": intent, "nativeNodeId": nodeID, "nativeDeadline": float64(time.Now().Add(time.Hour).Unix()), "contentLength": float64(size), "multipart": false}
				claims := map[string]interface{}{"tenant_id": binding, "actor_principal_id": principal, "initiating_human_principal_id": principal, "action_key": "file_storage.write@v2", "action_definition_version": float64(1), "target_type": "RESOURCE", "target_id": resource, "operation_id": operation, "action_execution_id": ae, "external_execution_id": ee, "idempotency_key": key, "result_exposure_policy_id": policy, "result_exposure_policy_version": float64(1)}
				payload, _ := json.Marshal(claims)
				token := "fixture." + base64.RawURLEncoding.EncodeToString(payload) + ".fixture"
				arguments, _ := json.Marshal(map[string]interface{}{"target": map[string]interface{}{"resourceId": resource}, "input": input})
				peps := 0
				var bodyRevoked atomic.Bool
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.Header().Set("Content-Type", "application/json")
					if r.URL.Path == "/token" {
						json.NewEncoder(w).Encode(map[string]interface{}{"access_token": "service", "token_type": "Bearer", "expires_in": 60})
						return
					}
					if r.Header.Get("Authorization") != "Bearer service" {
						t.Error("native service credential missing")
						w.WriteHeader(403)
						return
					}
					if r.URL.Path == "/service/v1/adapter/human-action" {
						json.NewEncoder(w).Encode(map[string]interface{}{"nativeExecutionAdmission": map[string]interface{}{"actionToken": token, "argumentsJson": string(arguments), "expiresAt": time.Now().Add(time.Minute).UTC().Format(time.RFC3339Nano)}})
						return
					}
					if r.URL.Path != "/service/v1/adapter/pep_check" {
						t.Error("unexpected authority route")
						w.WriteHeader(404)
						return
					}
					peps++
					if bodyRevoked.Load() || (scenario == "fresh-revoked" && versions.stores >= 2) {
						w.WriteHeader(403)
						return
					}
					json.NewEncoder(w).Encode(map[string]interface{}{"actionExecutionId": ae, "operationId": operation, "authorizationMinZedToken": "fresh", "bindingGeneration": float64(3), "targetResource": map[string]interface{}{"resourceId": resource, "nativeType": "folder", "nativeRef": resource, "nativeInstanceRef": "instance", "nativeScopeRef": resource}})
				}))
				defer server.Close()
				secret := filepath.Join(t.TempDir(), "secret")
				if err := os.WriteFile(secret, []byte("fixture-only"), 0600); err != nil {
					t.Fatal(err)
				}
				delivery := map[string]interface{}{"bindingId": binding, "tenantId": binding, "nativeInstanceRef": "instance", "nativeScopeRef": resource, "nativeRootRef": resource, "instanceServiceUuid": binding, "corePepUrl": server.URL + "/service/v1/adapter/pep_check", "oidcTokenUrl": server.URL + "/token", "clientId": "native-binding", "clientSecretFile": secret, "clientSecretMaxBytes": 128, "maxResponseBytes": 65536, "requestTimeout": "2s", "draftUploads": map[string]interface{}{}, "actors": []map[string]interface{}{{"principalId": principal, "kind": "HUMAN", "userUuid": user}}, "write": map[string]interface{}{"nativeJobId": "native-write", "actionVersion": 1, "resultExposurePolicyId": policy, "resultExposurePolicyVersion": 1}}
				if err := config.Set(ctx, delivery, "services", common.ServiceRestNamespace_+"n", "platform"); err != nil {
					t.Fatal(err)
				}
				config.Set(ctx, &object.DataSource{VersioningPolicyName: "upload-policy"}, "services", common.ServiceGrpcNamespace_+common.ServiceDataSync_+"live")
				config.Set(ctx, base64.StdEncoding.EncodeToString(bytes.Repeat([]byte("x"), 64)), "frontend", "session", "secureKey")
				config.Set(ctx, []map[string]interface{}{{"id": "kailo", "type": "kailo-oidc", "config": map[string]interface{}{"issuer": "https://identity.invalid", "clientId": "native", "users": []map[string]interface{}{{"subject": principal, "userUuid": user}}}}}, "services", "pydio.web.oauth", "connectors")
				task, err := jobstore.NewNativeUploadTask(binding, 3, auth.NativeUploadJobID("native-write", binding, 3), key, login, user, claims, input)
				if err != nil {
					t.Fatal(err)
				}
				tasks := &uploadTasks{task: task, loseFinish: scenario == "task-ACK-lost", losePlan: scenario == "publication-plan-ACK-lost"}
				versions.tasks = tasks
				grpcclient.RegisterMock(common.ServiceJobsGRPC, tasks)
				request := httptest.NewRequest(http.MethodPut, "http://native.invalid/io/live/file.txt", nil).WithContext(ctx)
				cookies := httptest.NewRecorder()
				if err := auth.SaveNativeHumanToken(request, cookies, "human", "https://identity.invalid", principal, "native", user, "native-session", time.Now().Add(time.Minute)); err != nil {
					t.Fatal(err)
				}
				for _, cookie := range cookies.Result().Cookies() {
					request.AddCookie(cookie)
				}
				for name, value := range map[string]string{"X-Kailo-Action-Execution": ae, "X-Kailo-External-Execution": ee, "X-Kailo-Native-Upload": intent, "Idempotency-Key": key} {
					request.Header.Set(name, value)
				}
				if err := auth.PrepareNativeHumanUpload(request); err != nil {
					t.Fatal(err)
				}
				upload := auth.NativeUploadFromContext(request.Context())
				if upload == nil {
					t.Fatal("verified original writer context absent")
				}
				backing := &uploadByteStore{HandlerMock: nodes.NewHandlerMock(), root: root, node: node, storage: storage, partial: scenario == "partial-bytes"}
				// Original draft middleware is the real byte-route consumer. Remote
				// index/storage are fixtures, not a pre-created ContentReference.
				router := compose.NewClient(nodes.WithCore(backing), put.WithPutInterceptor(), version.WithVersions())
				live, _ := pool.GetDataSourceInfo("live")
				ctx = nodes.WithBranchInfo(request.Context(), "in", nodes.BranchInfo{LoadedSource: live, Workspace: &idm.Workspace{UUID: resource, Slug: "live", RootUUIDs: []string{resource}}})
				body := bytes.Repeat([]byte("b"), size)
				var bodyReader io.Reader = bytes.NewReader(body)
				prefixBytes := 0
				if scenario == "body-prefix-revoked" {
					prefixBytes = size / 2
				}
				if bodyRevocation {
					bodyReader = &uploadRevokingReader{reader: bodyReader, revoked: &bodyRevoked, withEOF: scenario == "body-read-EOF-revoked", prefix: prefixBytes}
				}
				reader, err := hash.NewReader(bodyReader, int64(size), "", "", int64(size))
				if err != nil {
					t.Fatal(err)
				}
				gateway := &pydioObjects{Router: router}
				_, err = gateway.PutObject(ctx, "io", "live/file.txt", minio.NewPutObjReader(reader), minio.ObjectOptions{})
				if scenario != "complete" {
					if err == nil {
						t.Fatal("uncertain upload returned S3 success")
					}
					if bodyRevocation {
						if !bodyRevoked.Load() || backing.writes != 1 || backing.readBytes != prefixBytes || len(storage.Buckets["versions"]) != 0 || tasks.puts != 1 || tasks.task.Status != jobs.TaskStatus_Running {
							t.Fatal("revoked body bytes reached native storage or claimed step was released", bodyRevoked.Load(), backing.writes, backing.readBytes, tasks.puts, tasks.task.Status)
						}
					}
					if scenario == "publication-plan-ACK-lost" && (tasks.puts != 2 || versions.stores != 1 || len(storage.Buckets["versions"]) != 1) {
						t.Fatal("immutable copy preceded its original durable plan ACK", tasks.puts, versions.stores, len(storage.Buckets["versions"]))
					}
					if (scenario == "version-ACK-lost" || scenario == "task-ACK-lost" || scenario == "fresh-revoked") && versions.stores != 2 {
						t.Fatal("refusal occurred before the injected post-publication boundary", scenario, versions.stores)
					}
					if scenario == "task-ACK-lost" && (tasks.puts != 3 || tasks.task.Status != jobs.TaskStatus_Finished) {
						t.Fatal("lost terminal ACK did not preserve the actual native terminal", tasks.puts, tasks.task.Status)
					}
					if scenario != "task-ACK-lost" && tasks.task.Status == jobs.TaskStatus_Finished {
						t.Fatal("partial upload fabricated finished Task")
					}
					return
				}
				if err != nil {
					t.Fatal(err)
				}
				published, content, err := jobstore.NativeUploadRevision(tasks.task)
				if err != nil || published.VersionId == intent || published.Draft || content["nativeRevision"] != published.VersionId || tasks.puts != 3 || backing.writes != 1 || peps < 10 {
					t.Fatal("missing original immutable receipt", err, tasks.puts, backing.writes, peps)
				}
				stored, _, err := storage.GetObject(ctx, "versions", published.Location.Uuid, nil)
				if err != nil {
					t.Fatal(err)
				}
				defer stored.Close()
				actual, err := io.ReadAll(stored)
				if err != nil || !bytes.Equal(actual, body) {
					t.Fatal("immutable Version does not contain original bytes", err)
				}
			})
		}
	}
}
