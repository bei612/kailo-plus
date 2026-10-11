package rest

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	restful "github.com/emicklei/go-restful/v3"
	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth/claim"
	grpcclient "github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/config/routing"
	"github.com/pydio/cells/v5/common/proto/idm"
	"github.com/pydio/cells/v5/common/proto/jobs"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/common/utils/cache/gocache"
	cachehelper "github.com/pydio/cells/v5/common/utils/cache/helper"
	jobstore "github.com/pydio/cells/v5/scheduler/jobs"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

type writeObservationUser struct {
	idm.UnimplementedUserServiceServer
	user *idm.User
}

func (s *writeObservationUser) SearchOne(context.Context, *idm.SearchUserRequest) (*idm.SearchUserResponse, error) {
	return &idm.SearchUserResponse{User: s.user}, nil
}

type writeObservationPolicy struct {
	idm.UnimplementedPolicyEngineServiceServer
	subject string
}

func (s *writeObservationPolicy) StreamPolicyGroups(_ *idm.ListPolicyGroupsRequest, stream idm.PolicyEngineService_StreamPolicyGroupsServer) error {
	return stream.Send(&idm.PolicyGroup{Policies: []*idm.Policy{{ID: "native-observe-login", Subjects: []string{"subject:" + s.subject}, Resources: []string{"oidc"}, Actions: []string{"login"}, Effect: idm.PolicyEffect_allow}}})
}
func (*writeObservationPolicy) IsAllowed(context.Context, *idm.PolicyEngineRequest) (*idm.PolicyEngineResponse, error) {
	return &idm.PolicyEngineResponse{Allowed: true}, nil
}

type writeObservationConnection struct {
	grpc.ClientConnInterface
	task  *jobs.Task
	calls int
}

func (c *writeObservationConnection) NewStream(ctx context.Context, _ *grpc.StreamDesc, method string, _ ...grpc.CallOption) (grpc.ClientStream, error) {
	if method != "/jobs.JobService/ListTasks" {
		return nil, fmt.Errorf("unexpected native RPC: %s", method)
	}
	c.calls++
	return &writeObservationStream{ctx: ctx, task: proto.Clone(c.task).(*jobs.Task)}, nil
}

type writeObservationStream struct {
	grpc.ClientStream
	ctx  context.Context
	task *jobs.Task
	sent bool
}

func (s *writeObservationStream) Context() context.Context { return s.ctx }
func (*writeObservationStream) CloseSend() error           { return nil }
func (s *writeObservationStream) SendMsg(value interface{}) error {
	r := value.(*jobs.ListTasksRequest)
	if r.JobID != s.task.JobID || r.TaskID != s.task.ID || r.Status != jobs.TaskStatus_Any {
		return fmt.Errorf("lookup lost exact original task identity")
	}
	return nil
}
func (s *writeObservationStream) RecvMsg(value interface{}) error {
	if s.sent {
		return io.EOF
	}
	s.sent = true
	proto.Merge(value.(*jobs.ListTasksResponse), &jobs.ListTasksResponse{Task: s.task})
	return nil
}

func TestNativeWriteObservationDoesNotInventActiveExecution(t *testing.T) {
	cachehelper.SetStaticResolver("pm://", &gocache.URLOpener{})
	ids := make([]string, 9)
	for i := range ids {
		ids[i] = fmt.Sprintf("00000000-0000-4000-8000-%012d", i+1)
	}
	user, service, principal, resource, key, execution, binding, node, policy := ids[0], ids[1], ids[2], ids[3], ids[4], ids[5], ids[6], ids[7], ids[8]
	grpcclient.RegisterMock(common.ServiceUserGRPC, &idm.UserServiceStub{UserServiceServer: &writeObservationUser{user: &idm.User{Uuid: user, Login: "native-user"}}})
	grpcclient.RegisterMock(common.ServicePolicyGRPC, &idm.PolicyEngineServiceStub{PolicyEngineServiceServer: &writeObservationPolicy{subject: user}})
	claims := map[string]interface{}{"tenant_id": resource, "actor_principal_id": principal, "initiating_human_principal_id": principal, "action_key": "file_storage.write@v1", "action_definition_version": float64(1), "target_type": "RESOURCE", "target_id": resource, "operation_id": key, "action_execution_id": execution, "result_exposure_policy_id": policy, "result_exposure_policy_version": float64(1)}
	input := map[string]interface{}{"resourceId": resource, "nativeObjectRef": `{"nodeUuid":"` + node + `","publish":false}`, "nativeRevision": "original-draft", "displayName": "file.txt", "mediaType": "text/plain"}
	completed, err := jobstore.NewNativeWriteTask(binding, "native-write-job", key, "native-user", user, claims, input)
	if err != nil {
		t.Fatal(err)
	}
	relation, _ := json.Marshal([]string{key, jobstore.NativeVersionActionID, node})
	digest := sha256.Sum256(relation)
	revision := &tree.ContentRevision{VersionId: hex.EncodeToString(digest[:]), OwnerUuid: user, ETag: "native-etag", Location: &tree.Node{Uuid: "version-location"}}
	body, _ := protojson.Marshal(revision)
	completed.Status, completed.StartTime, completed.EndTime = jobs.TaskStatus_Finished, 1, 2
	completed.ActionsLogs = append(completed.ActionsLogs, &jobs.ActionLog{Action: &jobs.Action{ID: jobstore.NativeVersionActionID}, OutputMessage: &jobs.ActionMessage{OutputChain: []*jobs.ActionOutput{{Success: true, JsonBody: body, Vars: map[string]string{jobstore.NativeVersionResult: "true"}}}}})
	for _, operation := range []string{"observe", "extract_usage"} {
		for _, scenario := range []string{"complete", "running-residue", "local-error", "missing-receipt", "changed-owner", "fresh-refused"} {
			t.Run(operation+"/"+scenario, func(t *testing.T) {
				ctx := config.WithStubStore(context.Background())
				pepCalls := 0
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.Header().Set("Content-Type", "application/json")
					if r.URL.Path == "/token" {
						json.NewEncoder(w).Encode(map[string]interface{}{"access_token": "fixture-native", "token_type": "Bearer", "expires_in": 60})
						return
					}
					if r.URL.Path != "/service/v1/adapter/pep_check" || r.Header.Get("Authorization") != "Bearer fixture-native" {
						t.Error("original authenticated PEP not used")
						w.WriteHeader(http.StatusForbidden)
						return
					}
					pepCalls++
					if scenario == "fresh-refused" && pepCalls == 2 {
						w.WriteHeader(http.StatusForbidden)
						return
					}
					json.NewEncoder(w).Encode(map[string]interface{}{"actionExecutionId": execution, "operationId": key, "authorizationMinZedToken": "fresh"})
				}))
				defer server.Close()
				secret := filepath.Join(t.TempDir(), "secret")
				if err := os.WriteFile(secret, []byte("fixture-secret"), 0600); err != nil {
					t.Fatal(err)
				}
				delivery := map[string]interface{}{"bindingId": binding, "tenantId": resource, "nativeInstanceRef": "native-instance", "nativeScopeRef": node, "nativeRootRef": resource, "instanceServiceUuid": service, "corePepUrl": server.URL + "/service/v1/adapter/pep_check", "oidcTokenUrl": server.URL + "/token", "clientId": "native-binding", "clientSecretFile": secret, "clientSecretMaxBytes": 256, "maxResponseBytes": 65536, "requestTimeout": "2s", "actors": []map[string]interface{}{{"principalId": principal, "kind": "HUMAN", "userUuid": user}}, "write": map[string]interface{}{"nativeJobId": "native-write-job", "actionVersion": 1, "nativeType": "version", "resultExposurePolicyId": policy, "resultExposurePolicyVersion": 1}}
				if err := config.Set(ctx, delivery, "services", common.ServiceRestNamespace_+"n", "platform"); err != nil {
					t.Fatal(err)
				}
				task := proto.Clone(completed).(*jobs.Task)
				switch scenario {
				case "running-residue":
					task.Status, task.EndTime = jobs.TaskStatus_Running, 0
					task.ActionsLogs = task.ActionsLogs[:1]
				case "local-error":
					task.Status = jobs.TaskStatus_Error
				case "missing-receipt":
					task.ActionsLogs = task.ActionsLogs[:1]
				case "changed-owner":
					task.ActionsLogs[0].InputMessage.OutputChain[0].JsonBody = []byte(`{}`)
				}
				connection := &writeObservationConnection{task: task}
				grpcclient.RegisterMock(common.ServiceJobsGRPC, connection)
				args, _ := json.Marshal(map[string]interface{}{"nativeType": "version", "externalExecutionId": execution, "idempotencyKey": key})
				payload, _ := json.Marshal(claims)
				proof, _ := json.Marshal(map[string]interface{}{"actionToken": "header." + base64.RawURLEncoding.EncodeToString(payload) + ".fixture-proof", "argumentsJson": string(args)})
				requestBody, _ := json.Marshal(&jobs.ListJobsRequest{JobIDs: []string{"native-write-job"}, LoadTasks: jobs.TaskStatus_Any})
				request := httptest.NewRequest(http.MethodPost, "http://native.invalid/jobs", bytes.NewReader(requestBody)).WithContext(claim.ToContext(ctx, claim.Claims{Subject: service, Name: "native-service"}))
				request.Header.Set("Content-Type", "application/json")
				request.Header.Set("X-Kailo-Native-Operation", operation)
				recorder := httptest.NewRecorder()
				if _, exists := routing.RouteById(common.RouteApiREST); !exists {
					routing.RegisterRoute(common.RouteApiREST, "REST API", common.DefaultRouteREST)
				}
				registrar := routing.NewRouteRegistrar()
				var observationError error
				registrar.Route(common.RouteApiREST).Handle("/jobs", http.HandlerFunc(func(w http.ResponseWriter, actual *http.Request) {
					observationError = nativeWriteObservation(restful.NewRequest(actual), restful.NewResponse(w), base64.RawURLEncoding.EncodeToString(proof))
				}))
				registrar.IteratePatterns(ctx, func(_ string, handler http.Handler) { handler.ServeHTTP(recorder, request) })
				err := observationError
				if scenario == "changed-owner" || scenario == "fresh-refused" {
					if err == nil || recorder.Body.Len() != 0 {
						t.Fatal("unconfirmed owner/fresh authorization disclosed a result")
					}
					return
				}
				if err != nil {
					t.Fatal(err)
				}
				var answer map[string]interface{}
				if json.Unmarshal(recorder.Body.Bytes(), &answer) != nil {
					t.Fatal("invalid original HTTP response")
				}
				observation := answer["execution"].(map[string]interface{})
				want := "UNKNOWN"
				if scenario == "complete" {
					want = "SUCCEEDED"
				}
				if observation["platformStatus"] != want || pepCalls != 2 || connection.calls != 1 {
					t.Fatalf("unproved active/terminal result or missing fresh lookup: %v calls=%d/%d", observation, pepCalls, connection.calls)
				}
				if scenario != "complete" && (answer["contentReference"] != nil || observation["terminalAt"] != nil) {
					t.Fatal("unproved terminal evidence disclosed")
				}
			})
		}
	}
}
