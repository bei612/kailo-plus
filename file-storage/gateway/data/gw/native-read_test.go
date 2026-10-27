package pydio

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"sync/atomic"
	"testing"

	minio "github.com/minio/minio/cmd"
	"github.com/pydio/cells/v5/common"
	cellauth "github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/auth/claim"
	grpcclient "github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/nodes"
	"github.com/pydio/cells/v5/common/nodes/acl"
	"github.com/pydio/cells/v5/common/nodes/models"
	"github.com/pydio/cells/v5/common/permissions"
	"github.com/pydio/cells/v5/common/proto/docstore"
	"github.com/pydio/cells/v5/common/proto/idm"
	jobproto "github.com/pydio/cells/v5/common/proto/jobs"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/common/utils/cache/gocache"
	cachehelper "github.com/pydio/cells/v5/common/utils/cache/helper"
	"github.com/pydio/cells/v5/common/utils/openurl"
	jobstore "github.com/pydio/cells/v5/scheduler/jobs"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
)

type nativeReadUser struct {
	idm.UnimplementedUserServiceServer
	user *idm.User
}

func (s *nativeReadUser) SearchOne(context.Context, *idm.SearchUserRequest) (*idm.SearchUserResponse, error) {
	return &idm.SearchUserResponse{User: s.user}, nil
}

type nativeReadPolicy struct {
	idm.UnimplementedPolicyEngineServiceServer
	subject string
}

type nativeReadDocuments struct {
	docstore.UnimplementedDocStoreServer
}

func (*nativeReadDocuments) ListDocuments(*docstore.ListDocumentsRequest, docstore.DocStore_ListDocumentsServer) error {
	return nil
}

func (s *nativeReadPolicy) StreamPolicyGroups(_ *idm.ListPolicyGroupsRequest, stream idm.PolicyEngineService_StreamPolicyGroupsServer) error {
	return stream.Send(&idm.PolicyGroup{Policies: []*idm.Policy{{ID: "native-read-login", Subjects: []string{"subject:" + s.subject}, Resources: []string{"oidc"}, Actions: []string{"login"}, Effect: idm.PolicyEffect_allow}}})
}

type nativeReadRouter struct {
	nodes.Client
	size   int64
	body   []byte
	closed chan struct{}
	uuid   string
	denyReads bool
}

func (r *nativeReadRouter) ReadNode(context.Context, *tree.ReadNodeRequest, ...grpc.CallOption) (*tree.ReadNodeResponse, error) {
	if r.denyReads { return nil, errors.WithStack(errors.StatusForbidden) }
	n := &tree.Node{Uuid: r.uuid, Type: tree.NodeType_LEAF, Path: "root/file.txt", Size: r.size}
	n.MustSetMeta(common.MetaNamespaceMime, "text/plain")
	return &tree.ReadNodeResponse{Node: n}, nil
}

type nativeReadTree struct {
	tree.NodeProviderClient
	root, file *tree.Node
}

// GetSourcesPool is initialized once by the original routers. Keep that one
// test pool while changing its remote fixtures between sequential scenarios.
var nativeGatewaySources = &struct{ nodes.SourcesPool }{}

func setNativeGatewaySources(source nodes.SourcesPool) {
	nativeGatewaySources.SourcesPool = source
	nodes.SetSourcesPoolOpener(func(ctx context.Context) *openurl.Pool[nodes.SourcesPool] {
		return nodes.NewTestPool(ctx, nativeGatewaySources)
	})
}

func (r *nativeReadTree) ReadNode(_ context.Context, req *tree.ReadNodeRequest, _ ...grpc.CallOption) (*tree.ReadNodeResponse, error) {
	n := r.file
	if req.Node.Uuid == r.root.Uuid || req.Node.Path == r.root.Path {
		n = r.root
	}
	return &tree.ReadNodeResponse{Node: n.Clone()}, nil
}

type nativeReadAncestors struct {
	tree.NodeProvider_ListNodesClient
	ctx   context.Context
	nodes []*tree.Node
}

func (s *nativeReadAncestors) Context() context.Context { return s.ctx }
func (s *nativeReadAncestors) CloseSend() error         { return nil }
func (s *nativeReadAncestors) Recv() (*tree.ListNodesResponse, error) {
	if len(s.nodes) == 0 {
		return nil, io.EOF
	}
	n := s.nodes[0]
	s.nodes = s.nodes[1:]
	return &tree.ListNodesResponse{Node: n.Clone()}, nil
}
func (r *nativeReadTree) ListNodes(ctx context.Context, req *tree.ListNodesRequest, _ ...grpc.CallOption) (tree.NodeProvider_ListNodesClient, error) {
	parents := []*tree.Node{r.root}
	if req.Node.Uuid == r.file.Uuid || req.Node.Path == r.file.Path {
		parents = append([]*tree.Node{r.file}, parents...)
	}
	return &nativeReadAncestors{ctx: ctx, nodes: parents}, nil
}

type nativeReadJobs struct {
	jobproto.UnimplementedJobServiceServer
	grpc.ClientConnInterface
	puts    int
	task    *jobproto.Task
	loseACK bool
}

func (s *nativeReadJobs) Invoke(ctx context.Context, method string, args, reply interface{}, _ ...grpc.CallOption) error {
	var response proto.Message
	var err error
	switch method {
	case "/jobs.JobService/GetJob":
		response, err = s.GetJob(ctx, args.(*jobproto.GetJobRequest))
	case "/jobs.JobService/PutTask":
		response, err = s.PutTask(ctx, args.(*jobproto.PutTaskRequest))
	default:
		return fmt.Errorf("unexpected original read Task RPC: %s", method)
	}
	if err == nil {
		proto.Merge(reply.(proto.Message), response)
	}
	return err
}
func (*nativeReadJobs) GetJob(context.Context, *jobproto.GetJobRequest) (*jobproto.GetJobResponse, error) {
	return &jobproto.GetJobResponse{Job: jobstore.NativeReadJob("existing-read-job")}, nil
}
func (s *nativeReadJobs) PutTask(_ context.Context, req *jobproto.PutTaskRequest) (*jobproto.PutTaskResponse, error) {
	s.puts++
	s.task = proto.Clone(req.Task).(*jobproto.Task)
	if s.loseACK && s.puts == 3 {
		return &jobproto.PutTaskResponse{}, nil
	}
	return &jobproto.PutTaskResponse{Task: proto.Clone(s.task).(*jobproto.Task)}, nil
}

type nativeReadSource struct {
	io.Reader
	closed chan struct{}
}

func (s *nativeReadSource) Close() error { close(s.closed); return nil }

func (r *nativeReadRouter) GetObject(context.Context, *tree.Node, *models.GetRequestData) (io.ReadCloser, error) {
	return &nativeReadSource{Reader: bytes.NewReader(r.body), closed: r.closed}, nil
}

func TestGovernedReadCompletesBeforeReturningMinIOReader(t *testing.T) {
	cachehelper.SetStaticResolver("pm://", &gocache.URLOpener{})
	const user = "00000000-0000-4000-8000-000000000001"
	const service = "00000000-0000-4000-8000-000000000002"
	const principal = "00000000-0000-4000-8000-000000000003"
	const resource = "00000000-0000-4000-8000-000000000004"
	const node = "00000000-0000-4000-8000-000000000005"
	const key = "00000000-0000-4000-8000-000000000006"
	const execution = "00000000-0000-4000-8000-000000000007"
	grpcclient.RegisterMock(common.ServiceUserGRPC, &idm.UserServiceStub{UserServiceServer: &nativeReadUser{user: &idm.User{Uuid: user, Login: "native-user"}}})
	grpcclient.RegisterMock(common.ServicePolicyGRPC, &idm.PolicyEngineServiceStub{PolicyEngineServiceServer: &nativeReadPolicy{subject: user}})
	grpcclient.RegisterMock(common.ServiceDocStoreGRPC, &docstore.DocStoreStub{DocStoreServer: &nativeReadDocuments{}})
	target := map[string]interface{}{"resourceId": resource, "nativeType": "folder", "nativeRef": resource, "nativeInstanceRef": "native-instance", "nativeScopeRef": node}
	var pepCalls, denyAt atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/token" {
			json.NewEncoder(w).Encode(map[string]interface{}{"access_token": "native-fixture", "token_type": "Bearer", "expires_in": 60})
			return
		}
		if r.URL.Path != "/service/v1/adapter/pep_check" || r.Header.Get("Authorization") != "Bearer native-fixture" {
			t.Error("original authenticated PEP not used")
			w.WriteHeader(http.StatusForbidden)
			return
		}
		if pepCalls.Add(1) == denyAt.Load() {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		json.NewEncoder(w).Encode(map[string]interface{}{"actionExecutionId": execution, "operationId": key, "authorizationMinZedToken": "fresh", "targetResource": target})
	}))
	defer server.Close()
	secret := filepath.Join(t.TempDir(), "secret")
	if err := os.WriteFile(secret, []byte("fixture-secret"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"HUMAN", "AGENT"} {
		for _, action := range []string{"file_storage.read@v2", "file_storage.export@v2"} {
			for _, size := range []int64{0, 12} {
				for _, scenario := range []string{"revision-mismatch", "complete", "final-PEP-denied", "completion-ACK-lost", "late-PEP-denied", "late-native-denied", "late-scope-moved"} {
					t.Run(kind+"/"+action+"/"+strconv.FormatInt(size, 10)+"/"+scenario, func(t *testing.T) {
						pepCalls.Store(0)
						denyAt.Store(0)
						if scenario == "final-PEP-denied" {
							denyAt.Store(4)
						}
						ctx := config.WithStubStore(context.Background())
						treeClient := &nativeReadTree{root: &tree.Node{Uuid: resource, Path: "root", Type: tree.NodeType_COLLECTION}, file: &tree.Node{Uuid: node, Path: "root/file.txt", Type: tree.NodeType_LEAF}}
						setNativeGatewaySources(nodes.MakeFakeClientsPool(treeClient, nil))
						access := permissions.NewAccessList(&idm.Role{Uuid: user})
						access.AppendACLs(&idm.ACL{RoleID: user, NodeID: resource, WorkspaceID: resource, Action: permissions.AclRead})
						access.Flatten(ctx)
						if err := access.LoadWorkspaces(ctx, func(context.Context, []string) ([]*idm.Workspace, error) {
							return []*idm.Workspace{{UUID: resource, Label: "Read fixture", Slug: "read-fixture"}}, nil
						}); err != nil {
							t.Fatal(err)
						}
						ctx = acl.WithPresetACL(ctx, access)
						jobs := &nativeReadJobs{loseACK: scenario == "completion-ACK-lost"}
						grpcclient.RegisterMock(common.ServiceJobsGRPC, jobs)
						delivery := map[string]interface{}{"bindingId": key, "tenantId": resource, "nativeInstanceRef": "native-instance", "nativeScopeRef": node, "nativeRootRef": resource, "instanceServiceUuid": service, "corePepUrl": server.URL + "/service/v1/adapter/pep_check", "oidcTokenUrl": server.URL + "/token", "clientId": "native-binding", "clientSecretFile": secret, "clientSecretMaxBytes": 256, "maxResponseBytes": 65536, "requestTimeout": "2s", "actors": []map[string]interface{}{{"principalId": principal, "kind": kind, "userUuid": user}}, "read": map[string]interface{}{"nativeJobId": "existing-read-job", "usageMeasurements": []interface{}{}}}
						if err := config.Set(ctx, delivery, "services", common.ServiceRestNamespace_+"n", "platform"); err != nil {
							t.Fatal(err)
						}
						claims := map[string]interface{}{"tenant_id": resource, "actor_principal_id": principal, "initiating_human_principal_id": principal, "action_key": action, "target_type": "RESOURCE", "target_id": resource, "operation_id": key, "action_execution_id": execution, "result_exposure_policy_id": key, "external_execution_id": execution, "idempotency_key": key}
						if kind == "AGENT" {
							claims["agent_principal_id"] = principal
							claims["initiating_human_principal_id"] = resource
							claims["delegation_id"] = key
							claims["delegation_version"] = 1
						}
						args, _ := json.Marshal(map[string]interface{}{"target": map[string]interface{}{"resourceId": resource}, "input": map[string]interface{}{"resourceId": resource, "nativeObjectRef": node, "nativeRevision": "original-version", "displayName": "file.txt", "mediaType": "text/plain"}})
						payload, _ := json.Marshal(claims)
						proof, _ := json.Marshal(map[string]interface{}{"actionToken": "header." + base64.RawURLEncoding.EncodeToString(payload) + ".fixture-proof", "argumentsJson": string(args)})
						request := httptest.NewRequest(http.MethodGet, "http://native.invalid/file.txt?versionId=original-version", nil).WithContext(claim.ToContext(ctx, claim.Claims{Subject: user, Name: "native-user"}))
						request.Header.Set("Idempotency-Key", key)
						if _, err := cellauth.NativeReadAuthority(request, base64.RawURLEncoding.EncodeToString(proof), "execute", false); err != nil {
							t.Fatal(err)
						}
						router := &nativeReadRouter{size: size, uuid: node, body: bytes.Repeat([]byte("x"), int(size)), closed: make(chan struct{})}
						gateway := &pydioObjects{Router: router}
						version := "original-version"
						if scenario == "revision-mismatch" {
							version = "different-version"
						}
						reader, err := gateway.GetObjectNInfo(request.Context(), "io", "root/file.txt", nil, nil, minio.LockType(0), minio.ObjectOptions{VersionID: version})
						if reader != nil {
							defer reader.Close()
						}
						if scenario == "complete" || strings.HasPrefix(scenario, "late-") {
							if err != nil || reader == nil {
								t.Fatal("authorized original read did not return its reader", err)
							}
							if pepCalls.Load() != 4 || jobs.puts != 3 || jobs.task.GetStatus() != jobproto.TaskStatus_Finished {
								t.Fatal("success reader preceded final PEP or native completion ACK")
							}
							if strings.HasPrefix(scenario, "late-") && size > 0 {
								prefix := make([]byte, 6)
								if n, err := reader.Read(prefix); n != len(prefix) || err != nil { t.Fatal("admitted prefix failed", n, err) }
								switch scenario {
								case "late-PEP-denied": denyAt.Store(pepCalls.Load()+1)
								case "late-native-denied": router.denyReads = true
								case "late-scope-moved": treeClient.file.Path = "foreign/file.txt"
								}
								body, readErr := io.ReadAll(reader)
								if readErr == nil || len(body) != 0 { t.Fatal("revoked download bytes escaped after completed Task", len(body), readErr) }
								calls := pepCalls.Load()
								denyAt.Store(0); router.denyReads = false; treeClient.file.Path = "root/file.txt"
								if n, err := reader.Read(prefix); n != 0 || err == nil || pepCalls.Load() != calls { t.Fatal("refused download resumed or polled again") }
							} else {
								body, readErr := io.ReadAll(reader)
								if readErr != nil || !bytes.Equal(body, router.body) { t.Fatal("governed bytes changed", readErr) }
								calls := pepCalls.Load()
								if n, err := reader.Read(make([]byte, 1)); n != 0 || err != io.EOF || pepCalls.Load() != calls { t.Fatal("EOF repeated disclosure authority") }
							}
							if jobs.puts != 3 { t.Fatal("late disclosure repeated native Task writes") }
						} else if err == nil || reader != nil {
							t.Fatal("governed rejection returned a success reader before the original read completed")
						}
						if scenario != "revision-mismatch" {
							select {
							case <-router.closed:
							default:
								t.Fatal("source was not closed before disclosure")
							}
							if jobs.task.GetStatus() != jobproto.TaskStatus_Finished {
								t.Fatal("completed native evidence was lost after disclosure refusal")
							}
						}
					})
				}
			}
		}
	}
}

func TestIndependentReadKeepsStreamingAndClosesSource(t *testing.T) {
	for _, consume := range []bool{false, true} {
		router := &nativeReadRouter{size: 12, body: []byte("actual bytes"), closed: make(chan struct{})}
		gateway := &pydioObjects{Router: router}
		reader, err := gateway.GetObjectNInfo(context.Background(), "io", "file.txt", nil, nil, minio.LockType(0), minio.ObjectOptions{})
		if err != nil {
			t.Fatal(err)
		}
		if consume {
			body, err := io.ReadAll(reader)
			if err != nil || !bytes.Equal(body, router.body) {
				t.Fatal("independent stream changed", err)
			}
		}
		reader.Close()
		<-router.closed
	}
}

// Use the original encrypted HUMAN cookie, admission, synchronous reader and
// receipt transport. Only the external Core and native storage are fixtures.
func TestNativeHumanDownloadRetainsFreshDisclosureAfterCompletion(t *testing.T) {
	cachehelper.SetStaticResolver("pm://", &gocache.URLOpener{})
	const user = "00000000-0000-4000-8000-000000000001"
	const binding = "00000000-0000-4000-8000-000000000002"
	const principal = "00000000-0000-4000-8000-000000000003"
	const resource = "00000000-0000-4000-8000-000000000004"
	const node = "00000000-0000-4000-8000-000000000005"
	const key = "00000000-0000-4000-8000-000000000006"
	const execution = "00000000-0000-4000-8000-000000000007"
	grpcclient.RegisterMock(common.ServiceRoleGRPC, &idm.RoleServiceStub{RoleServiceServer: &uploadRoles{user: user}})
	grpcclient.RegisterMock(common.ServiceAclGRPC, &idm.ACLServiceStub{ACLServiceServer: new(uploadFrontACLs)})
	grpcclient.RegisterMock(common.ServicePolicyGRPC, &idm.PolicyEngineServiceStub{PolicyEngineServiceServer: &nativeReadPolicy{subject: user}})
	grpcclient.RegisterMock(common.ServiceDocStoreGRPC, &docstore.DocStoreStub{DocStoreServer: &nativeReadDocuments{}})
	for _, scenario := range []string{"complete", "empty", "late-human-denied", "late-native-denied", "late-scope-moved", "late-user-unavailable", "before-first-byte"} {
		t.Run(scenario, func(t *testing.T) {
			ctx := config.WithStubStore(context.Background())
			ctx = claim.ToContext(ctx, claim.Claims{Subject: user, Name: "native-user", SessionID: "read-session", AuthSource: "kailo"})
			nativeUser := &idm.User{Uuid: user, Login: "native-user"}
			grpcclient.RegisterMock(common.ServiceUserGRPC, &idm.UserServiceStub{UserServiceServer: &nativeReadUser{user: nativeUser}})
			treeClient := &nativeReadTree{root: &tree.Node{Uuid: resource, Path: "root", Type: tree.NodeType_COLLECTION}, file: &tree.Node{Uuid: node, Path: "root/file.txt", Type: tree.NodeType_LEAF}}
			setNativeGatewaySources(nodes.MakeFakeClientsPool(treeClient, nil))
			access := permissions.NewAccessList(&idm.Role{Uuid: user})
			access.AppendACLs(&idm.ACL{RoleID: user, NodeID: resource, WorkspaceID: resource, Action: permissions.AclRead})
			access.Flatten(ctx)
			if err := access.LoadWorkspaces(ctx, func(context.Context, []string) ([]*idm.Workspace, error) {
				return []*idm.Workspace{{UUID: resource, Slug: "read-fixture"}}, nil
			}); err != nil { t.Fatal(err) }
			ctx = acl.WithPresetACL(ctx, access)
			tasks := &nativeReadJobs{}
			grpcclient.RegisterMock(common.ServiceJobsGRPC, tasks)
			input := map[string]interface{}{"resourceId": resource, "nativeObjectRef": node, "nativeRevision": "original-version", "displayName": "file.txt", "mediaType": "text/plain"}
			claims := map[string]interface{}{"tenant_id": binding, "actor_principal_id": principal, "initiating_human_principal_id": principal,
				"action_key": "file_storage.read@v2", "target_type": "RESOURCE", "target_id": resource, "operation_id": key,
				"action_execution_id": execution, "idempotency_key": key, "exp": time.Now().Add(time.Hour).Unix()}
			payload, _ := json.Marshal(claims)
			token := "fixture." + base64.RawURLEncoding.EncodeToString(payload) + ".fixture"
			arguments, _ := json.Marshal(map[string]interface{}{"target": map[string]interface{}{"resourceId": resource}, "input": input})
			var revoked atomic.Bool
			var commands, receipts, observations, peps atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if r.URL.Path == "/token" {
					json.NewEncoder(w).Encode(map[string]interface{}{"access_token": "service", "token_type": "Bearer", "expires_in": 60}); return
				}
				var raw map[string]interface{}
				if r.Header.Get("Authorization") != "Bearer service" || json.NewDecoder(r.Body).Decode(&raw) != nil { t.Error("binding transport bypassed"); w.WriteHeader(403); return }
				target := map[string]interface{}{"resourceId": resource, "nativeType": "folder", "nativeRef": resource, "nativeInstanceRef": "instance", "nativeScopeRef": resource}
				if r.URL.Path == "/service/v1/adapter/pep_check" {
					peps.Add(1)
					if receipts.Load() != 0 || raw["actionToken"] != token || raw["argumentsJson"] != string(arguments) { t.Error("completed read was re-admitted or original PEP proof changed"); w.WriteHeader(403); return }
					json.NewEncoder(w).Encode(map[string]interface{}{"actionExecutionId": execution, "operationId": key, "authorizationMinZedToken": "fresh", "targetResource": target}); return
				}
				if r.URL.Path != "/service/v1/adapter/human-action" || raw["bindingId"] != binding { t.Error("original HUMAN transport bypassed"); w.WriteHeader(403); return }
				if receipt, ok := raw["readReceipt"]; ok {
					if r.Header.Get("X-Kailo-Native-Human-Token") != "" { t.Error("service receipt acquired HUMAN authority") }
					receipts.Add(1)
					encoded, _ := json.Marshal(receipt)
					digest := sha256.Sum256(encoded)
					json.NewEncoder(w).Encode(map[string]interface{}{"operationId": key, "receiptDigest": hex.EncodeToString(digest[:])}); return
				}
				if r.Header.Get("X-Kailo-Native-Human-Token") != "human" { t.Error("independent HUMAN missing"); w.WriteHeader(403); return }
				if raw["resolveResource"] != nil { target["resourceVersion"] = 1; json.NewEncoder(w).Encode(map[string]interface{}{"resource": target}); return }
				if raw["command"] != nil {
					commands.Add(1)
					if receipts.Load() != 0 { t.Error("second read command after completion") }
					json.NewEncoder(w).Encode(map[string]interface{}{"readAdmission": map[string]interface{}{"actionToken": token, "argumentsJson": string(arguments), "expiresAt": time.Now().Add(time.Minute).Unix()}}); return
				}
				observations.Add(1)
				if raw["idempotencyKey"] != key || receipts.Load() != 1 { t.Error("disclosure did not observe the single original receipt"); w.WriteHeader(403); return }
				if revoked.Load() { w.WriteHeader(403); return }
				json.NewEncoder(w).Encode(map[string]interface{}{"terminalStatus": "COMPLETED", "inputReference": input})
			}))
			defer server.Close()
			secret := filepath.Join(t.TempDir(), "secret")
			if err := os.WriteFile(secret, []byte("fixture-only"), 0600); err != nil { t.Fatal(err) }
			delivery := map[string]interface{}{"bindingId": binding, "tenantId": binding, "nativeInstanceRef": "instance", "nativeScopeRef": resource, "nativeRootRef": resource,
				"instanceServiceUuid": binding, "corePepUrl": server.URL + "/service/v1/adapter/pep_check", "oidcTokenUrl": server.URL + "/token", "clientId": "native-binding", "clientSecretFile": secret,
				"clientSecretMaxBytes": 128, "maxResponseBytes": 65536, "requestTimeout": "2s", "actors": []map[string]interface{}{{"principalId": principal, "kind": "HUMAN", "userUuid": user}},
				"read": map[string]interface{}{"nativeJobId": "existing-read-job", "usageMeasurements": []interface{}{}, "human": map[string]interface{}{"receiptPollInterval": "10ms",
					"actions": map[string]interface{}{"file_storage.read@v2": map[string]interface{}{"actionVersion": 1, "nativeType": "folder", "resultExposurePolicyId": resource, "resultExposurePolicyVersion": 1}}}}}
			if err := config.Set(ctx, delivery, "services", common.ServiceRestNamespace_+"n", "platform"); err != nil { t.Fatal(err) }
			config.Set(ctx, base64.StdEncoding.EncodeToString(bytes.Repeat([]byte("x"), 64)), "frontend", "session", "secureKey")
			config.Set(ctx, []map[string]interface{}{{"id": "kailo", "type": "kailo-oidc", "config": map[string]interface{}{"issuer": "https://identity.invalid", "clientId": "native", "users": []map[string]interface{}{{"subject": principal, "userUuid": user}}}}}, "services", "pydio.web.oauth", "connectors")
			request := httptest.NewRequest(http.MethodGet, "http://native.invalid/io/root/file.txt?versionId=original-version", nil).WithContext(ctx)
			cookies := httptest.NewRecorder()
			if err := cellauth.SaveNativeHumanToken(request, cookies, "human", "https://identity.invalid", principal, "native", user, "read-session", time.Now().Add(time.Minute)); err != nil { t.Fatal(err) }
			for _, cookie := range cookies.Result().Cookies() { request.AddCookie(cookie) }
			request.Header.Set("Idempotency-Key", key); request.Header.Set("X-Kailo-Native-Read", "file_storage.read@v2")
			if err := cellauth.PrepareNativeHumanRead(request); err != nil { t.Fatal(err) }
			body := []byte("actual bytes"); if scenario == "empty" { body = nil }
			router := &nativeReadRouter{size: int64(len(body)), body: body, uuid: node, closed: make(chan struct{})}
			gateway := &pydioObjects{Router: router}
			reader, err := gateway.GetObjectNInfo(request.Context(), "io", "root/file.txt", nil, nil, minio.LockType(0), minio.ObjectOptions{VersionID: "original-version"})
			if err != nil || reader == nil { t.Fatal("original synchronous read not admitted", err) }
			defer reader.Close()
			if commands.Load() != 1 || receipts.Load() != 1 || observations.Load() != 1 || peps.Load() != 2 || tasks.puts != 0 { t.Fatal("unexpected pre-disclosure authority or receipt count") }
			select { case <-router.closed: default: t.Fatal("native source not closed before HTTP disclosure") }
			if n, err := reader.Read(nil); n != 0 || (err != nil && err != io.EOF) || observations.Load() != 1 { t.Fatal("zero-length read polled authority", err) }
			if scenario == "complete" || scenario == "empty" {
				got, err := io.ReadAll(reader)
				if err != nil || !bytes.Equal(got, body) { t.Fatal("authorized completed read changed", err) }
				calls := observations.Load()
				if n, err := reader.Read(make([]byte, 1)); n != 0 || err != io.EOF || observations.Load() != calls { t.Fatal("EOF polled authority again") }
			} else {
				if scenario != "before-first-byte" {
					if n, err := reader.Read(make([]byte, 6)); n != 6 || err != nil { t.Fatal("admitted prefix refused", n, err) }
				}
				switch scenario {
				case "late-native-denied": router.denyReads = true
				case "late-scope-moved": treeClient.file.Path = "foreign/file.txt"
				case "late-user-unavailable": nativeUser.Login = ""
				default: revoked.Store(true)
				}
				got, err := io.ReadAll(reader)
				if err == nil || len(got) != 0 { t.Fatal("revoked download bytes escaped after completed HUMAN read", len(got), err) }
				calls := observations.Load()
				revoked.Store(false); router.denyReads = false; treeClient.file.Path = "root/file.txt"; nativeUser.Login = "native-user"
				if n, err := reader.Read(make([]byte, 1)); n != 0 || err == nil || observations.Load() != calls { t.Fatal("refused HUMAN disclosure resumed or polled again") }
			}
			if commands.Load() != 1 || receipts.Load() != 1 || peps.Load() != 2 || tasks.puts != 0 { t.Fatal("late disclosure changed read/usage evidence or re-admitted execution") }
		})
	}
}
