package share

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/auth/protocol"
	grpcclient "github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/config"
	cellserrors "github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/permissions"
	"github.com/pydio/cells/v5/common/proto/idm"
	jobproto "github.com/pydio/cells/v5/common/proto/jobs"
	"github.com/pydio/cells/v5/common/proto/rest"
	"github.com/pydio/cells/v5/common/proto/service"
	"github.com/pydio/cells/v5/common/proto/tree"
	jobstore "github.com/pydio/cells/v5/scheduler/jobs"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

type nativeCellRoleFixture struct {
	idm.UnimplementedRoleServiceServer
	user string
}

type nativeCellUpdateWorkspaceFixture struct {
	*sharePermissionWorkspace
	cause   error
	updates int
}

func (f *nativeCellUpdateWorkspaceFixture) UpdateWorkspace(context.Context, *idm.CreateWorkspaceRequest) (*idm.CreateWorkspaceResponse, error) {
	f.updates++
	return nil, f.cause
}

func (f nativeCellRoleFixture) SearchRole(_ *idm.SearchRoleRequest, stream grpc.ServerStreamingServer[idm.SearchRoleResponse]) error {
	return stream.Send(&idm.SearchRoleResponse{Role: &idm.Role{Uuid: f.user, UserRole: true}})
}

type nativeCellUserFixture struct {
	idm.UnimplementedUserServiceServer
	user string
}

func (f nativeCellUserFixture) SearchUser(_ *idm.SearchUserRequest, stream grpc.ServerStreamingServer[idm.SearchUserResponse]) error {
	return stream.Send(&idm.SearchUserResponse{User: &idm.User{Uuid: f.user, Login: "native-human"}})
}

func TestNativeCellExistingHumanUsesOriginalACLObjects(t *testing.T) {
	const user = "00000000-0000-4000-8000-000000000002"
	grpcclient.RegisterMock(common.ServiceRoleGRPC, &idm.RoleServiceStub{RoleServiceServer: nativeCellRoleFixture{user: user}})
	grpcclient.RegisterMock(common.ServiceUserGRPC, &idm.UserServiceStub{UserServiceServer: nativeCellUserFixture{user: user}})
	client := NewClient(nil)
	acls := client.AclsToCellAcls(context.Background(), []*idm.ACL{{NodeID: "native-root", RoleID: user, Action: permissions.AclRead}})
	if err := client.LoadCellAclsObjects(context.Background(), acls); err != nil {
		t.Fatal(err)
	}
	cell := &rest.Cell{ACLs: acls}
	if acls[user].IsUserRole || !readOnlyCellMember(cell, user) {
		t.Fatal("original persisted HUMAN member requires a UI-only hint")
	}
	acls[user].User.IsGroup = true
	if readOnlyCellMember(cell, user) {
		t.Fatal("group accepted as HUMAN")
	}
	acls[user].User.IsGroup = false
	acls[user].Actions = append(acls[user].Actions, permissions.AclWrite)
	if readOnlyCellMember(cell, user) {
		t.Fatal("WRITE accepted as READ membership")
	}
}

func TestNativeCellUpsertConsumesCurrentScopeAndPermission(t *testing.T) {
	const binding = "00000000-0000-4000-8000-000000000001"
	const node = "00000000-0000-4000-8000-000000000002"
	for _, scenario := range []string{"current", "generation", "tenant", "instance", "scope", "revision", "permission", "pending", "missing-context", "removed-delivery"} {
		t.Run(scenario, func(t *testing.T) {
			calls := []string{}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if r.URL.Path == "/token" {
					json.NewEncoder(w).Encode(map[string]interface{}{"access_token": "fixture-service", "token_type": "Bearer", "expires_in": 60})
					return
				}
				if r.Header.Get("Authorization") != "Bearer fixture-service" || r.Header.Get("X-Kailo-Native-Human-Token") != "fixture-human" {
					t.Error("original private transport lost identity")
				}
				var request map[string]interface{}
				if json.NewDecoder(r.Body).Decode(&request) != nil || request["bindingId"] != binding {
					t.Error("wrong binding callback")
				}
				if request["authorizeScope"] != nil {
					calls = append(calls, "scope")
					scope := map[string]interface{}{"bindingId": binding, "generation": 1, "tenantId": binding, "nativeInstanceRef": "native", "nativeScopeRef": node, "permission": "discover", "checkedRevision": "fresh"}
					switch scenario {
					case "generation":
						scope["generation"] = 2
					case "tenant":
						scope["tenantId"] = node
					case "instance":
						scope["nativeInstanceRef"] = "other"
					case "scope":
						scope["nativeScopeRef"] = binding
					case "revision":
						scope["checkedRevision"] = ""
					case "permission":
						scope["permission"] = "manage"
					}
					json.NewEncoder(w).Encode(map[string]interface{}{"scope": scope})
					return
				}
				calls = append(calls, "permission")
				if request["idempotencyKey"] != node || request["command"] != nil {
					t.Error("write guard dispatched instead of observing")
				}
				outcome := map[string]interface{}{"submission": map[string]interface{}{"operationId": binding, "actionExecutionId": node, "actionKey": "resource.grant_read", "gateState": "ALLOWED", "dispatchState": "DISPATCHED"}, "terminalStatus": "COMPLETED"}
				if scenario == "pending" {
					delete(outcome, "terminalStatus")
				}
				json.NewEncoder(w).Encode(outcome)
			}))
			defer server.Close()
			secret := filepath.Join(t.TempDir(), "secret")
			if err := os.WriteFile(secret, []byte("fixture-only"), 0600); err != nil {
				t.Fatal(err)
			}
			delivery := auth.NativeCellShareDelivery{NativeActorDelivery: auth.NativeActorDelivery{Delivery: protocol.Delivery{BindingID: binding, InstanceServiceUUID: binding, CorePEPURL: server.URL + "/service/v1/adapter/pep_check", OIDCTokenURL: server.URL + "/token", ClientID: "binding", ClientSecretFile: secret, RequestTimeout: "5s", MaxResponseBytes: 8192, ClientSecretMaxBytes: 128}, TenantID: binding, NativeRootRef: node, NativeScopeRef: node, NativeInstanceRef: "native"}}
			delivery.CellShare.BindingGeneration = 1
			mutation := &nativeCellMutation{delivery: delivery, token: "fixture-human", intent: nativeCellIntent{Changes: []nativeCellChange{{Command: map[string]interface{}{"idempotencyKey": node, "actionKey": "resource.grant_read"}}}}}
			ctx := config.WithStubStore(context.Background())
			if scenario != "removed-delivery" {
				if err := config.Set(ctx, delivery, "services", common.ServiceRestNamespace_+"n", "platform"); err != nil {
					t.Fatal(err)
				}
			}
			if scenario != "missing-context" {
				ctx = context.WithValue(ctx, nativeCellContextKey{}, mutation)
			}
			actual, err := nativeCellWrite(ctx)
			if scenario == "current" {
				if err != nil || actual != mutation || len(calls) != 2 {
					t.Fatalf("current scope plus original permission outcome refused: %v %v", err, calls)
				}
				for _, failure := range []error{status.Error(codes.Unimplemented, "old workspace service"), cellserrors.WorkspaceNotFound} {
					const member = "00000000-0000-4000-8000-000000000003"
					f := &sharePermissionFixture{workspace: &idm.Workspace{UUID: binding, Label: "Existing cell", Scope: idm.WorkspaceScope_ROOM}, current: []*idm.ACL{{NodeID: node, RoleID: binding, WorkspaceID: binding, Action: permissions.AclRead}}}
					writer := &nativeCellUpdateWorkspaceFixture{sharePermissionWorkspace: &sharePermissionWorkspace{fixture: f}, cause: failure}
					var workspaceServer idm.WorkspaceServiceServer = writer
					wantUpdates := 1
					if status.Code(failure) == codes.Unimplemented {
						// The old service has only CreateWorkspace; its embedded
						// generated server supplies the real Unimplemented response.
						workspaceServer = writer.sharePermissionWorkspace
						wantUpdates = 0
					}
					grpcclient.RegisterMock(common.ServiceWorkspaceGRPC, &idm.WorkspaceServiceStub{WorkspaceServiceServer: workspaceServer})
					grpcclient.RegisterMock(common.ServiceAclGRPC, &idm.ACLServiceStub{ACLServiceServer: f})
					cell := &rest.Cell{Uuid: binding, Label: f.workspace.Label, RootNodes: []*tree.Node{{Uuid: node}}, ACLs: map[string]*rest.CellAcl{
						binding: {RoleId: binding, Actions: []*idm.ACLAction{permissions.AclRead}},
						member:  {RoleId: member, Actions: []*idm.ACLAction{permissions.AclRead}},
					}}
					selection, e := cellSelection(cell)
					if e != nil {
						t.Fatal(e)
					}
					mutation.intent.Selection = selection
					mutation.intent.Changes[0].NodeID = node
					mutation.intent.Changes[0].UserID = member
					result, e := NewClient(nil).UpsertCell(ctx, cell, &idm.User{Uuid: binding}, true, "")
					if e == nil || status.Code(e) != status.Code(failure) || result != nil || writer.updates != wantUpdates || f.saves != 0 || len(f.calls) != 1 || f.calls[0] != "create" {
						t.Fatalf("managed partial ACL mutation fell back to create or became success: result=%v err=%v updates=%d creates=%d acl=%v", result, e, writer.updates, f.saves, f.calls)
					}
				}
			} else if err == nil {
				t.Fatalf("%s accepted stale/unowned native write", scenario)
			}
			// This is the real shared writer entry, not only a predicate check.
			// Every rejected scope must stop before attempting any native RPC.
			if scenario != "current" {
				result, err := NewClient(nil).UpsertCell(ctx, &rest.Cell{}, &idm.User{}, false, "")
				if err == nil || result != nil {
					t.Fatal("original UpsertCell bypassed request-local fresh authority")
				}
			}
		})
	}
}

func TestNativeCellTerminalRequiresOriginalTaskReceipt(t *testing.T) {
	body := []byte(`{"changes":["read-member"]}`)
	task, err := jobstore.NewNativeCellTask("native-cell", "request", "owner", body)
	if err != nil {
		t.Fatal(err)
	}
	complete := completedNativeCellTask(task, body)
	if !nativeCellCompleted(complete, body) || nativeCellCompleted(task, body) {
		t.Fatal("dispatch claim became terminal")
	}
	for _, scenario := range []string{"unfinished", "missing-time", "missing-receipt", "duplicate", "negative", "wrong-intent"} {
		t.Run(scenario, func(t *testing.T) {
			value := proto.Clone(complete).(*jobproto.Task)
			switch scenario {
			case "unfinished":
				value.Status = jobproto.TaskStatus_Running
			case "missing-time":
				value.EndTime = 0
			case "missing-receipt":
				value.ActionsLogs = value.ActionsLogs[:1]
			case "duplicate":
				value.ActionsLogs = append(value.ActionsLogs, proto.Clone(value.ActionsLogs[1]).(*jobproto.ActionLog))
			case "negative":
				value.ActionsLogs[1].OutputMessage.OutputChain[0].Success = false
			case "wrong-intent":
				value.ActionsLogs[1].OutputMessage.OutputChain[0].JsonBody = []byte("other")
			}
			if nativeCellCompleted(value, body) {
				t.Fatal("unconfirmed native effects rendered completed")
			}
		})
	}
	size := int64(proto.Size(&jobproto.ListTasksResponse{Task: complete}))
	if !nativeCellTaskFits(task, body, size) || nativeCellTaskFits(task, body, size-1) {
		t.Fatal("final Task evidence exceeds original read bound")
	}
}

func TestNativeCellDiffAndWorkspaceACKRemainExact(t *testing.T) {
	m := &nativeCellMutation{intent: nativeCellIntent{Selection: nativeCellSelection{ID: "cell"}, Changes: []nativeCellChange{{NodeID: "root", UserID: "human", Command: map[string]interface{}{"actionKey": "resource.grant_read"}}}}}
	acl := &idm.ACL{NodeID: "root", RoleID: "human", WorkspaceID: "cell", Action: permissions.AclRead}
	if !m.matchesDiff([]*idm.ACL{acl}, nil) || m.matchesDiff(nil, []*idm.ACL{acl}) || m.matchesDiff([]*idm.ACL{acl, acl}, nil) {
		t.Fatal("native ACL diff no longer matches frozen permission intent")
	}
	acl.Action = permissions.AclWrite
	if m.matchesDiff([]*idm.ACL{acl}, nil) {
		t.Fatal("READ intent granted WRITE")
	}
	expected := &idm.Workspace{UUID: "cell", Policies: []*service.ResourcePolicy{{Resource: "cell", Subject: "role:human", Action: service.ResourcePolicyAction_READ, Effect: service.ResourcePolicy_allow}}}
	actual := proto.Clone(expected).(*idm.Workspace)
	actual.LastUpdated = 1
	actual.Policies[0].Id = 5
	if !nativeCellWorkspaceACK(expected, actual) {
		t.Fatal("native policy row ID mistaken for policy difference")
	}
	actual.Policies = nil
	if nativeCellWorkspaceACK(expected, actual) {
		t.Fatal("empty native policy ACK accepted")
	}
	cell := &rest.Cell{Uuid: "00000000-0000-4000-8000-000000000001", RootNodes: []*tree.Node{{Uuid: "00000000-0000-4000-8000-000000000002"}}}
	if _, err := cellSelection(cell); err != nil {
		t.Fatal(err)
	}
	cell.RootNodes = append(cell.RootNodes, cell.RootNodes[0])
	if _, err := cellSelection(cell); err == nil {
		t.Fatal("duplicate roots accepted")
	}
}
