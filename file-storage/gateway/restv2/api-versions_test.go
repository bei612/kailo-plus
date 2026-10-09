package restv2

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
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
	"github.com/pydio/cells/v5/common/nodes"
	"github.com/pydio/cells/v5/common/nodes/acl"
	omock "github.com/pydio/cells/v5/common/nodes/objects/mock"
	"github.com/pydio/cells/v5/common/permissions"
	"github.com/pydio/cells/v5/common/proto/idm"
	"github.com/pydio/cells/v5/common/proto/install"
	"github.com/pydio/cells/v5/common/proto/rest"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/common/utils/openurl"
	. "github.com/smartystreets/goconvey/convey"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/encoding/protojson"
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
	node  *tree.Node
	err   error
	reads int
}

func (s *uploadNativeTree) ReadNode(_ context.Context, request *tree.ReadNodeRequest, _ ...grpc.CallOption) (*tree.ReadNodeResponse, error) {
	s.reads++
	if s.err != nil {
		return nil, s.err
	}
	if len(request.StatFlags) != 1 || request.StatFlags[0] != tree.StatFlagNone {
		return nil, fmt.Errorf("completion must explicitly reload native metadata")
	}
	return &tree.ReadNodeResponse{Node: s.node.Clone()}, nil
}

func (s *uploadNativePolicy) StreamPolicyGroups(_ *idm.ListPolicyGroupsRequest, stream idm.PolicyEngineService_StreamPolicyGroupsServer) error {
	return stream.Send(&idm.PolicyGroup{Policies: []*idm.Policy{{ID: "native-upload-login-policy",
		Subjects: []string{"subject:" + s.user}, Resources: []string{"oidc"}, Actions: []string{"login"}, Effect: idm.PolicyEffect_allow}}})
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

func TestNativePromoteUsesOriginalHumanAction(t *testing.T) {
	ids := make([]string, 8)
	for index := range ids {
		ids[index] = fmt.Sprintf("00000000-0000-4000-8000-%012d", index+1)
	}
	// The original SourcesPool is lazily opened once. Keep its native fixture
	// client stable and replace that client's data between serial scenarios.
	freshTree := new(uploadNativeTree)
	nodes.SetSourcesPoolOpener(func(c context.Context) *openurl.Pool[nodes.SourcesPool] {
		return nodes.NewTestPool(c, nodes.MakeFakeClientsPool(freshTree, nil))
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
