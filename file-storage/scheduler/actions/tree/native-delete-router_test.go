package tree

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/auth/protocol"
	grpcclient "github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/nodes"
	"github.com/pydio/cells/v5/common/permissions"
	"github.com/pydio/cells/v5/common/proto/idm"
	"github.com/pydio/cells/v5/common/proto/jobs"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/scheduler/actions"
	jobstore "github.com/pydio/cells/v5/scheduler/jobs"
)

type nativeDeleteIdentityClient struct {
	grpc.ClientConnInterface
	task *jobs.Task
	user *idm.User
}

func (c *nativeDeleteIdentityClient) Invoke(_ context.Context, method string, _, output interface{}, _ ...grpc.CallOption) error {
	if method != "/idm.UserService/SearchOne" {
		return context.Canceled
	}
	proto.Merge(output.(*idm.SearchUserResponse), &idm.SearchUserResponse{User: c.user})
	return nil
}
func (c *nativeDeleteIdentityClient) NewStream(_ context.Context, _ *grpc.StreamDesc, method string, _ ...grpc.CallOption) (grpc.ClientStream, error) {
	if method == "/idm.PolicyEngineService/StreamPolicyGroups" {
		return &nativeDeleteRetainedStream{policyUser: c.user.Uuid}, nil
	}
	if method != "/jobs.JobService/ListTasks" {
		return nil, context.Canceled
	}
	return &nativeDeleteRetainedStream{task: c.task}, nil
}

type nativeDeleteRetainedStream struct {
	grpc.ClientStream
	task       *jobs.Task
	policyUser string
}

func (s *nativeDeleteRetainedStream) SendMsg(interface{}) error { return nil }
func (s *nativeDeleteRetainedStream) CloseSend() error          { return nil }
func (s *nativeDeleteRetainedStream) RecvMsg(output interface{}) error {
	if s.policyUser != "" {
		proto.Merge(output.(*idm.PolicyGroup), &idm.PolicyGroup{Policies: []*idm.Policy{{ID: "native-delete-fixture-login", Subjects: []string{"subject:" + s.policyUser}, Resources: []string{"oidc"}, Actions: []string{"login"}, Effect: idm.PolicyEffect_allow}}})
		s.policyUser = ""
		return nil
	}
	if s.task == nil {
		return io.EOF
	}
	proto.Merge(output.(*jobs.ListTasksResponse), &jobs.ListTasksResponse{Task: s.task})
	s.task = nil
	return nil
}

type revokingDeleteRouter struct {
	*nativeDeleteHandler
	revoked    *atomic.Bool
	firstWrite chan struct{}
}

func (r *revokingDeleteRouter) DeleteNode(ctx context.Context, request *tree.DeleteNodeRequest, options ...grpc.CallOption) (*tree.DeleteNodeResponse, error) {
	response, err := r.nativeDeleteHandler.DeleteNode(ctx, request, options...)
	if !r.revoked.Swap(true) {
		close(r.firstWrite)
	}
	return response, err
}

type revokingDeleteStream struct {
	nativeDeleteStream
	firstWrite <-chan struct{}
}

func (s *revokingDeleteStream) Recv() (*tree.ListNodesResponse, error) {
	if s.index == 1 {
		<-s.firstWrite
	}
	return s.nativeDeleteStream.Recv()
}

func TestNativeDeleteRecursiveRevocationStopsFollowingWriteAndKeepsUnknown(t *testing.T) {
	const binding = "00000000-0000-4000-8000-000000000001"
	const actor = "00000000-0000-4000-8000-000000000002"
	const user = "00000000-0000-4000-8000-000000000003"
	const key = "00000000-0000-4000-8000-000000000004"
	const external = "00000000-0000-4000-8000-000000000005"
	const root = "00000000-0000-4000-8000-000000000006"
	deadline := time.Now().Add(time.Minute).UTC().Truncate(time.Second).Format("2006-01-02T15:04:05.000Z")
	claims := map[string]interface{}{"tenant_id": binding, "actor_principal_id": actor, "initiating_human_principal_id": actor,
		"operation_id": key, "action_execution_id": key, "action_key": "file_storage.delete@v1", "target_type": "RESOURCE", "target_id": root, "external_execution_id": external, "idempotency_key": key}
	input := map[string]interface{}{"resourceId": root, "nativeObjectRefs": []interface{}{root}, "removePermanently": true}
	payload, _ := json.Marshal(claims)
	token := "fixture." + base64.RawURLEncoding.EncodeToString(payload) + ".fixture"
	arguments, _ := json.Marshal(map[string]interface{}{"target": map[string]interface{}{"resourceId": root}, "input": input})
	var revoked atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/token" {
			json.NewEncoder(w).Encode(map[string]interface{}{"access_token": "service", "token_type": "Bearer", "expires_in": 60})
			return
		}
		if revoked.Load() {
			w.WriteHeader(403)
			return
		}
		if r.URL.Path == "/service/v1/adapter/request_native_task_execution_admission" {
			json.NewEncoder(w).Encode(map[string]interface{}{"state": "ADMITTED", "nativeTaskDeadline": deadline, "actionToken": token, "argumentsJson": string(arguments), "expiresAt": deadline})
			return
		}
		json.NewEncoder(w).Encode(map[string]interface{}{"actionExecutionId": key, "operationId": key, "authorizationMinZedToken": "fresh", "bindingGeneration": 1, "nativeTaskDeadline": deadline,
			"targetResource": map[string]interface{}{"resourceId": root, "nativeType": "folder", "nativeRef": root, "nativeInstanceRef": "isolated", "nativeScopeRef": binding}})
	}))
	defer server.Close()
	secret := filepath.Join(t.TempDir(), "binding-secret")
	if err := os.WriteFile(secret, []byte("fixture-only"), 0600); err != nil {
		t.Fatal(err)
	}
	delivery := auth.NativeDeleteDelivery{NativeActorDelivery: auth.NativeActorDelivery{Delivery: protocol.Delivery{BindingID: binding, InstanceServiceUUID: external,
		CorePEPURL: server.URL + "/service/v1/adapter/pep_check", OIDCTokenURL: server.URL + "/token", ClientID: "isolated", ClientSecretFile: secret,
		ClientSecretMaxBytes: 128, MaxResponseBytes: 8192, RequestTimeout: "1s"}, TenantID: binding, NativeInstanceRef: "isolated", NativeScopeRef: binding, NativeRootRef: root}, ExecutionDeadline: deadline, ExecutionGeneration: 1}
	actors, _ := json.Marshal(map[string]interface{}{"actors": []map[string]string{{"principalId": actor, "kind": "HUMAN", "userUuid": user}}})
	json.Unmarshal(actors, &delivery)
	delivery.Delete.NativeJobID, delivery.Delete.NativeType, delivery.Delete.AdmissionPollInterval = "original-delete", "job", "1ms"
	retained, err := jobstore.NewNativeDeleteTask(delivery, key, "native-owner", user, claims, input)
	if err != nil {
		t.Fatal(err)
	}
	job := &jobs.Job{ID: "original-child", Owner: "native-owner", Metadata: map[string]string{jobstore.NativeDeleteJob: retained.JobID, jobstore.NativeDeleteTask: key}}
	digest, _ := jobstore.NativeJobDefinitionDigest(job)
	reference, _ := json.Marshal(map[string]string{"jobId": job.ID, "taskId": job.ID, "jobDigest": digest})
	retained.ActionsLogs = append(retained.ActionsLogs, &jobs.ActionLog{OutputMessage: &jobs.ActionMessage{OutputChain: []*jobs.ActionOutput{{JsonBody: reference, Vars: map[string]string{jobstore.NativeDeleteJob: "true"}}}}})
	client := &nativeDeleteIdentityClient{task: retained, user: &idm.User{Uuid: user, Login: "native-owner"}}
	grpcclient.RegisterMock(common.ServiceJobsGRPC, client)
	grpcclient.RegisterMock(common.ServiceUserGRPC, client)
	grpcclient.RegisterMock(common.ServicePolicyGRPC, client)
	ctx := config.WithStubStore(global)
	permissions.ClearCachedPolicies(ctx, "oidc,")
	defer permissions.ClearCachedPolicies(ctx, "oidc,")
	if err := config.Set(ctx, delivery, "services", common.ServiceRestNamespace_+"n", "platform"); err != nil {
		t.Fatal(err)
	}
	ctx = context.WithValue(ctx, jobstore.ClaimedTaskContextKey{}, true)
	ctx, err = jobstore.AuthorizeNativeDeleteDispatch(ctx, job)
	if err != nil {
		t.Fatal(err)
	}
	first := &tree.Node{Uuid: "first", Path: "/root/first", Type: tree.NodeType_LEAF}
	second := &tree.Node{Uuid: "second", Path: "/root/second", Type: tree.NodeType_LEAF}
	firstWrite := make(chan struct{})
	handler := &revokingDeleteRouter{nativeDeleteHandler: &nativeDeleteHandler{HandlerMock: &nodes.HandlerMock{}, root: &tree.Node{Uuid: root, Path: "/root", Type: tree.NodeType_COLLECTION}, flat: true,
		stream:    &revokingDeleteStream{nativeDeleteStream: nativeDeleteStream{nodes: []*tree.Node{first, second}}, firstWrite: firstWrite},
		responses: map[string]*tree.DeleteNodeResponse{first.Path: {Success: true}, second.Path: {Success: true}}, deleted: make(chan string, 4)}, revoked: &revoked, firstWrite: firstWrite}
	action := &DeleteAction{}
	if err := action.Init(ctx, job, &jobs.Action{Parameters: map[string]string{"scope": "owner"}}); err != nil {
		t.Fatal(err)
	}
	action.PresetHandler(handler)
	before := proto.Clone(retained)
	output, err := action.Run(ctx, &actions.RunnableChannels{StatusMsg: make(chan string, 4)}, &jobs.ActionMessage{Nodes: []*tree.Node{{Path: "/root"}}})
	if err == nil || output.GetLastOutput().Success || len(handler.deleted) != 1 {
		t.Fatalf("revocation crossed recursive side effect: err=%v calls=%d", err, len(handler.deleted))
	}
	if !proto.Equal(before, retained) {
		t.Fatal("partial original deletion invented a terminal claim")
	}
}
