package rest

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/auth/claim"
	grpcclient "github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/nodes"
	"github.com/pydio/cells/v5/common/nodes/abstract"
	"github.com/pydio/cells/v5/common/nodes/compose"
	"github.com/pydio/cells/v5/common/proto/idm"
	nativerest "github.com/pydio/cells/v5/common/proto/rest"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/common/utils/cache/gocache"
	cache_helper "github.com/pydio/cells/v5/common/utils/cache/helper"
	"google.golang.org/grpc"
)

type directoryNativeUser struct {
	idm.UnimplementedUserServiceServer
}

func (*directoryNativeUser) SearchOne(_ context.Context, request *idm.SearchUserRequest) (*idm.SearchUserResponse, error) {
	query := new(idm.UserSingleQuery)
	if request.GetQuery().GetSubQueries()[0].UnmarshalTo(query) != nil || query.Uuid != "00000000-0000-4000-8000-000000000001" {
		return nil, fmt.Errorf("not the exact existing native user")
	}
	return &idm.SearchUserResponse{User: &idm.User{Uuid: query.Uuid, Login: "native-user"}}, nil
}

type directoryNativePolicy struct {
	idm.UnimplementedPolicyEngineServiceServer
}

func (*directoryNativePolicy) StreamPolicyGroups(_ *idm.ListPolicyGroupsRequest, stream idm.PolicyEngineService_StreamPolicyGroupsServer) error {
	return stream.Send(&idm.PolicyGroup{Policies: []*idm.Policy{{ID: "directory-login", Subjects: []string{"subject:00000000-0000-4000-8000-000000000001"}, Resources: []string{"oidc"}, Actions: []string{"login"}, Effect: idm.PolicyEffect_allow}}})
}

func directoryReadContext(t *testing.T) context.Context {
	t.Helper()
	ctx := config.WithStubStore(context.Background())
	ids := make([]string, 8)
	for index := range ids {
		ids[index] = fmt.Sprintf("00000000-0000-4000-8000-%012d", index+1)
	}
	grpcclient.RegisterMock(common.ServiceUserGRPC, &idm.UserServiceStub{UserServiceServer: &directoryNativeUser{}})
	grpcclient.RegisterMock(common.ServicePolicyGRPC, &idm.PolicyEngineServiceStub{PolicyEngineServiceServer: &directoryNativePolicy{}})
	pep := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/token" {
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"access_token": "controlled-binding-token", "token_type": "Bearer", "expires_in": 60})
			return
		}
		if r.URL.Path != "/service/v1/adapter/pep_check" || r.Header.Get("Authorization") != "Bearer controlled-binding-token" {
			t.Error("original authenticated binding PEP was not consumed")
			w.WriteHeader(403)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"actionExecutionId": ids[6], "operationId": ids[5], "authorizationMinZedToken": "fresh",
			"targetResource": map[string]interface{}{"resourceId": ids[3], "nativeType": "folder", "nativeRef": ids[7], "nativeInstanceRef": "native-instance", "nativeScopeRef": ids[4]}})
	}))
	t.Cleanup(pep.Close)
	secret := filepath.Join(t.TempDir(), "controlled-secret")
	if err := os.WriteFile(secret, []byte("fixture-secret"), 0600); err != nil {
		t.Fatal(err)
	}
	delivery := map[string]interface{}{"bindingId": ids[5], "tenantId": ids[3], "nativeInstanceRef": "native-instance", "nativeScopeRef": ids[4], "nativeRootRef": ids[7],
		"instanceServiceUuid": ids[1], "corePepUrl": pep.URL + "/service/v1/adapter/pep_check", "oidcTokenUrl": pep.URL + "/token", "clientId": "native-binding", "clientSecretFile": secret,
		"clientSecretMaxBytes": 256, "maxResponseBytes": 65536, "requestTimeout": "2s", "actors": []map[string]interface{}{{"principalId": ids[2], "kind": "HUMAN", "userUuid": ids[0]}},
		"read": map[string]interface{}{"nativeJobId": "original-read-job", "usageMeasurements": []interface{}{}}}
	if err := config.Set(ctx, delivery, "services", common.ServiceRestNamespace_+"n", "platform"); err != nil {
		t.Fatal(err)
	}
	claims, _ := json.Marshal(map[string]interface{}{"tenant_id": ids[3], "actor_principal_id": ids[2], "initiating_human_principal_id": ids[2], "action_key": "file_storage.list@v1",
		"target_type": "RESOURCE", "target_id": ids[3], "operation_id": ids[5], "action_execution_id": ids[6], "result_exposure_policy_id": ids[5], "external_execution_id": ids[6], "idempotency_key": ids[5]})
	args, _ := json.Marshal(map[string]interface{}{"target": map[string]interface{}{"resourceId": ids[3]}, "input": map[string]interface{}{"resourceId": ids[3]}})
	proof, _ := json.Marshal(map[string]interface{}{"actionToken": "header." + base64.RawURLEncoding.EncodeToString(claims) + ".authority-proof", "argumentsJson": string(args)})
	ctx = claim.ToContext(ctx, claim.Claims{Subject: ids[1], Name: "binding-service"})
	request := httptest.NewRequest(http.MethodPost, "/n/nodes", nil).WithContext(ctx)
	request.Header.Set("Idempotency-Key", ids[5])
	if _, err := auth.NativeReadAuthority(request, base64.RawURLEncoding.EncodeToString(proof), "execute", true); err != nil {
		t.Fatal("original native authority did not establish read context", err)
	}
	return request.Context()
}

type directoryNativeStream struct {
	tree.NodeProvider_ListNodesClient
	ctx      context.Context
	nodes    []*tree.Node
	position int
	ending   error
}

func (s *directoryNativeStream) Context() context.Context { return s.ctx }
func (s *directoryNativeStream) Recv() (*tree.ListNodesResponse, error) {
	if s.position == len(s.nodes) {
		if s.ending != nil {
			return nil, s.ending
		}
		return nil, io.EOF
	}
	node := s.nodes[s.position]
	s.position++
	return &tree.ListNodesResponse{Node: node}, nil
}

type directoryNativeHandler struct {
	nodes.Handler
	stream *directoryNativeStream
	calls  int
}

type directoryBranchFilter struct{ abstract.BranchFilter }

func (f *directoryBranchFilter) Adapt(next nodes.Handler, options nodes.RouterOptions) nodes.Handler {
	f.AdaptOptions(next, options)
	return f
}

func (s *directoryNativeHandler) ReadNode(context.Context, *tree.ReadNodeRequest, ...grpc.CallOption) (*tree.ReadNodeResponse, error) {
	return &tree.ReadNodeResponse{Node: &tree.Node{Uuid: "00000000-0000-4000-8000-000000000008", Path: "native", Type: tree.NodeType_COLLECTION}}, nil
}
func (s *directoryNativeHandler) ListNodes(ctx context.Context, request *tree.ListNodesRequest, _ ...grpc.CallOption) (tree.NodeProvider_ListNodesClient, error) {
	if !request.Recursive || request.Offset != 0 || request.Limit != 0 || request.Node.Path != "native" {
		return nil, fmt.Errorf("not the original complete recursive native request")
	}
	s.calls++
	s.stream.ctx = ctx
	return s.stream, nil
}
func (*directoryNativeHandler) ExecuteWrapped(_ nodes.FilterFunc, _ nodes.FilterFunc, _ nodes.CallbackFunc) error {
	return nil // the READ event is independent of stream completion
}

func TestNativeReadDirectoryRequiresCompleteOriginalStream(t *testing.T) {
	cache_helper.SetStaticResolver("pm://", &gocache.URLOpener{})
	for _, scenario := range []string{"complete", "empty", "unexpected-eof", "unknown-tail", "nil-node", "output-error", "bounded", "canceled", "independent-unexpected-eof"} {
		t.Run(scenario, func(t *testing.T) {
			ctx := directoryReadContext(t)
			stream := &directoryNativeStream{nodes: []*tree.Node{{Uuid: "00000000-0000-4000-8000-000000000007", Path: "native/file.txt", Type: tree.NodeType_LEAF}}}
			if scenario == "empty" {
				stream.nodes = nil
			}
			if scenario == "nil-node" {
				stream.nodes = []*tree.Node{nil}
			}
			if scenario == "unexpected-eof" || scenario == "independent-unexpected-eof" {
				stream.ending = io.ErrUnexpectedEOF
			}
			if scenario == "unknown-tail" {
				stream.ending = fmt.Errorf("native stream outcome unknown")
			}
			if scenario == "bounded" {
				auth.NativeReadFromContext(ctx).Delivery.MaxResponseBytes = 1
			}
			if scenario == "canceled" {
				stream.ending = context.Canceled
			}
			if scenario == "independent-unexpected-eof" {
				ctx = config.WithStubStore(context.Background())
			}
			core := &directoryNativeHandler{stream: stream}
			identity := func(ctx context.Context, node *tree.Node, _ string) (context.Context, *tree.Node, error) {
				return ctx, node, nil
			}
			filter := &directoryBranchFilter{BranchFilter: abstract.BranchFilter{InputMethod: identity, OutputMethod: identity}}
			if scenario == "output-error" {
				filter.OutputMethod = func(ctx context.Context, node *tree.Node, _ string) (context.Context, *tree.Node, error) {
					if node.Type == tree.NodeType_LEAF {
						return ctx, node, fmt.Errorf("native branch mapping unknown")
					}
					return ctx, node, nil
				}
			}
			router := compose.NewClient(nodes.WithCore(core), func(options *nodes.RouterOptions) { options.Wrappers = append(options.Wrappers, filter) })
			handler := &Handler{router: router}
			result, page, err := handler.LoadNodes(ctx, &nativerest.GetBulkMetaRequest{NodePaths: []string{"native/*"}}, tree.Flags{}, true)
			accepted := scenario == "complete" || scenario == "empty" || scenario == "independent-unexpected-eof"
			if (err == nil) != accepted || page != nil {
				t.Fatalf("original native enumeration completion mismatch: nodes=%v error=%v", result, err)
			}
			if core.calls != 1 || (accepted && len(result) != len(stream.nodes)) || (!accepted && result != nil) {
				t.Fatal("native partial enumeration was published, reissued, or silently lost")
			}
		})
	}
}
