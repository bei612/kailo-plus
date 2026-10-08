/*
 * Copyright (c) 2018. Abstrium SAS <team (at) pydio.com>
 * This file is part of Pydio Cells.
 *
 * Pydio Cells is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Pydio Cells is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Pydio Cells.  If not, see <http://www.gnu.org/licenses/>.
 *
 * The latest code can be found at <https://pydio.com>.
 */

package share

import (
	"context"
	"errors"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"

	"github.com/pydio/cells/v5/common"
	grpcclient "github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/permissions"
	"github.com/pydio/cells/v5/common/proto/idm"
	"github.com/pydio/cells/v5/common/proto/rest"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/common/utils/cache/gocache"
	cachehelper "github.com/pydio/cells/v5/common/utils/cache/helper"

	. "github.com/smartystreets/goconvey/convey"
)

type sharePermissionFixture struct {
	idm.UnimplementedACLServiceServer
	workspace *idm.Workspace
	current   []*idm.ACL
	fail      string
	cause     error
	calls     []string
	saves     int
}

func (f *sharePermissionFixture) SearchACL(_ *idm.SearchACLRequest, stream grpc.ServerStreamingServer[idm.SearchACLResponse]) error {
	for _, acl := range f.current {
		if err := stream.Send(&idm.SearchACLResponse{ACL: proto.Clone(acl).(*idm.ACL)}); err != nil {
			return err
		}
	}
	return nil
}

func (f *sharePermissionFixture) CreateACL(_ context.Context, request *idm.CreateACLRequest) (*idm.CreateACLResponse, error) {
	f.calls = append(f.calls, "create")
	if f.fail == "create" {
		return nil, f.cause
	}
	f.current = append(f.current, proto.Clone(request.ACL).(*idm.ACL))
	return &idm.CreateACLResponse{ACL: request.ACL}, nil
}

func (f *sharePermissionFixture) DeleteACL(_ context.Context, _ *idm.DeleteACLRequest) (*idm.DeleteACLResponse, error) {
	f.calls = append(f.calls, "delete")
	if f.fail == "delete" {
		return nil, f.cause
	}
	return &idm.DeleteACLResponse{}, nil
}

func (f *sharePermissionFixture) ExpireACL(_ context.Context, _ *idm.ExpireACLRequest) (*idm.ExpireACLResponse, error) {
	f.calls = append(f.calls, "expire")
	return nil, f.cause
}

func (f *sharePermissionFixture) RestoreACL(_ context.Context, _ *idm.RestoreACLRequest) (*idm.RestoreACLResponse, error) {
	f.calls = append(f.calls, "restore")
	return nil, f.cause
}

type sharePermissionWorkspace struct {
	idm.UnimplementedWorkspaceServiceServer
	fixture *sharePermissionFixture
}

func (f *sharePermissionWorkspace) SearchWorkspace(_ *idm.SearchWorkspaceRequest, stream grpc.ServerStreamingServer[idm.SearchWorkspaceResponse]) error {
	return stream.Send(&idm.SearchWorkspaceResponse{Workspace: proto.Clone(f.fixture.workspace).(*idm.Workspace)})
}

func (f *sharePermissionWorkspace) CreateWorkspace(_ context.Context, request *idm.CreateWorkspaceRequest) (*idm.CreateWorkspaceResponse, error) {
	f.fixture.saves++
	f.fixture.workspace = proto.Clone(request.Workspace).(*idm.Workspace)
	return &idm.CreateWorkspaceResponse{Workspace: request.Workspace}, nil
}

func TestNativeShareRequiresPermissionWriteConfirmation(t *testing.T) {
	cachehelper.SetStaticResolver("pm://", &gocache.URLOpener{})
	for _, scenario := range []string{"unchanged", "delete", "create", "expire", "restore", "link-root-create"} {
		t.Run(scenario, func(t *testing.T) {
			owner := &idm.User{Uuid: "native-owner"}
			f := &sharePermissionFixture{workspace: &idm.Workspace{UUID: "native-cell", Label: "Native cell", Scope: idm.WorkspaceScope_ROOM},
				fail: scenario, cause: errors.New("native ACL result is unavailable")}
			grpcclient.RegisterMock(common.ServiceAclGRPC, &idm.ACLServiceStub{ACLServiceServer: f})
			grpcclient.RegisterMock(common.ServiceWorkspaceGRPC, &idm.WorkspaceServiceStub{WorkspaceServiceServer: &sharePermissionWorkspace{fixture: f}})
			sc := NewClient(nil)
			cell := &rest.Cell{Uuid: f.workspace.UUID, Label: f.workspace.Label}
			if scenario == "link-root-create" {
				f.fail = "create"
				link, err := sc.UpsertLink(context.Background(), &rest.ShareLink{Label: "Native link", RootNodes: []*tree.Node{{Uuid: "native-root"}}},
					&rest.PutShareLinkRequest{}, owner, "", PluginOptions{})
				if !errors.Is(err, f.cause) || link != nil || f.saves != 1 || len(f.calls) != 1 || f.calls[0] != "create" {
					t.Fatalf("root ACL write was ignored or replayed: error=%v link=%v saves=%d calls=%v", err, link, f.saves, f.calls)
				}
				return
			}
			if scenario != "unchanged" {
				cell.RootNodes = []*tree.Node{{Uuid: "native-root"}}
				cell.ACLs = map[string]*rest.CellAcl{
					"owner": {RoleId: owner.Uuid, Actions: []*idm.ACLAction{permissions.AclRead}},
					"guest": {RoleId: "native-guest", Actions: []*idm.ACLAction{permissions.AclRead}},
				}
				f.current = []*idm.ACL{{NodeID: "native-root", RoleID: owner.Uuid, WorkspaceID: cell.Uuid, Action: permissions.AclRead}}
				if scenario == "delete" || scenario == "create" {
					f.current = append(f.current, &idm.ACL{NodeID: "native-root", RoleID: "native-revoked", WorkspaceID: cell.Uuid, Action: permissions.AclRead})
				} else {
					f.current = append(f.current, &idm.ACL{NodeID: "native-root", RoleID: "native-guest", WorkspaceID: cell.Uuid, Action: permissions.AclRead})
					cell.AccessEnd = 1
					if scenario == "restore" {
						cell.AccessEnd = -1
					}
				}
			}
			result, err := sc.UpsertCell(context.Background(), cell, owner, false, "")
			if scenario == "unchanged" {
				if err != nil || result == nil || result.Uuid != cell.Uuid || f.saves != 1 || len(f.calls) != 0 {
					t.Fatalf("unchanged native share no longer renders: error=%v result=%v saves=%d calls=%v", err, result, f.saves, f.calls)
				}
				return
			}
			if !errors.Is(err, f.cause) || result != nil || f.saves != 0 || f.workspace.LoadAttributes().ShareExpiration != 0 {
				t.Fatalf("unknown permission mutation became confirmed workspace state: error=%v result=%v saves=%d calls=%v", err, result, f.saves, f.calls)
			}
			expected := []string{scenario}
			if scenario == "create" {
				expected = []string{"delete", "create"}
			}
			if len(f.calls) != len(expected) {
				t.Fatalf("permission mutation continued or repeated after an unknown result: %v", f.calls)
			}
			for i := range expected {
				if f.calls[i] != expected[i] {
					t.Fatalf("unexpected permission mutation order: %v", f.calls)
				}
			}
		})
	}
}

func TestSharesHandler_DiffAcls(t *testing.T) {

	Convey("Test Diff Acls", t, func() {

		current := []*idm.ACL{
			{
				ID:          "4289",
				Action:      &idm.ACLAction{Name: "read", Value: "1"},
				RoleID:      "04d4e7a6-0d07-11e8-9a2e-28cfe919ca6f",
				WorkspaceID: "54a38f71-1287-11e8-9f0f-28cfe919ca6f",
				NodeID:      "2ebcf9cd-abc2-40fd-8fb8-f4b4e916c895",
			},
			{
				ID:          "4289",
				Action:      &idm.ACLAction{Name: "write", Value: "1"},
				RoleID:      "04d4e7a6-0d07-11e8-9a2e-28cfe919ca6f",
				WorkspaceID: "54a38f71-1287-11e8-9f0f-28cfe919ca6f",
				NodeID:      "2ebcf9cd-abc2-40fd-8fb8-f4b4e916c895",
			},
			{
				ID:          "4289",
				Action:      &idm.ACLAction{Name: "read", Value: "1"},
				RoleID:      "remove-me",
				WorkspaceID: "54a38f71-1287-11e8-9f0f-28cfe919ca6f",
				NodeID:      "2ebcf9cd-abc2-40fd-8fb8-f4b4e916c895",
			},
			{
				ID:          "4289",
				Action:      &idm.ACLAction{Name: "write", Value: "1"},
				RoleID:      "remove-me",
				WorkspaceID: "54a38f71-1287-11e8-9f0f-28cfe919ca6f",
				NodeID:      "2ebcf9cd-abc2-40fd-8fb8-f4b4e916c895",
			},
		}

		target := []*idm.ACL{
			{
				Action:      &idm.ACLAction{Name: "read", Value: "1"},
				RoleID:      "04d4e7a6-0d07-11e8-9a2e-28cfe919ca6f",
				WorkspaceID: "54a38f71-1287-11e8-9f0f-28cfe919ca6f",
				NodeID:      "2ebcf9cd-abc2-40fd-8fb8-f4b4e916c895",
			},
			{
				Action:      &idm.ACLAction{Name: "write", Value: "1"},
				RoleID:      "04d4e7a6-0d07-11e8-9a2e-28cfe919ca6f",
				WorkspaceID: "54a38f71-1287-11e8-9f0f-28cfe919ca6f",
				NodeID:      "2ebcf9cd-abc2-40fd-8fb8-f4b4e916c895",
			},
			{
				Action:      &idm.ACLAction{Name: "read", Value: "1"},
				RoleID:      "add-me",
				WorkspaceID: "54a38f71-1287-11e8-9f0f-28cfe919ca6f",
				NodeID:      "2ebcf9cd-abc2-40fd-8fb8-f4b4e916c895",
			},
			{
				Action:      &idm.ACLAction{Name: "write", Value: "1"},
				RoleID:      "add-me",
				WorkspaceID: "54a38f71-1287-11e8-9f0f-28cfe919ca6f",
				NodeID:      "2ebcf9cd-abc2-40fd-8fb8-f4b4e916c895",
			},
		}
		sc := NewClient(nil)
		add, remove := sc.DiffAcls(context.Background(), current, target)
		So(add, ShouldHaveLength, 2)
		So(add[0].RoleID, ShouldEqual, "add-me")
		So(add[1].RoleID, ShouldEqual, "add-me")
		So(remove, ShouldHaveLength, 2)
		So(remove[0].RoleID, ShouldEqual, "remove-me")
		So(remove[1].RoleID, ShouldEqual, "remove-me")

	})

	Convey("Test Diff Acls With Other Nodes", t, func() {

		current := []*idm.ACL{
			{
				ID:          "4289",
				Action:      &idm.ACLAction{Name: "read", Value: "1"},
				RoleID:      "04d4e7a6-0d07-11e8-9a2e-28cfe919ca6f",
				WorkspaceID: "54a38f71-1287-11e8-9f0f-28cfe919ca6f",
				NodeID:      "node1",
			},
			{
				ID:          "4289",
				Action:      &idm.ACLAction{Name: "read", Value: "1"},
				RoleID:      "04d4e7a6-0d07-11e8-9a2e-28cfe919ca6f",
				WorkspaceID: "54a38f71-1287-11e8-9f0f-28cfe919ca6f",
				NodeID:      "node2",
			},
			{
				ID:          "4289",
				Action:      &idm.ACLAction{Name: "read", Value: "1"},
				RoleID:      "remove-me",
				WorkspaceID: "54a38f71-1287-11e8-9f0f-28cfe919ca6f",
				NodeID:      "node1",
			},
			{
				ID:          "4289",
				Action:      &idm.ACLAction{Name: "read", Value: "1"},
				RoleID:      "remove-me",
				WorkspaceID: "54a38f71-1287-11e8-9f0f-28cfe919ca6f",
				NodeID:      "node2",
			},
		}

		target := []*idm.ACL{
			{
				Action:      &idm.ACLAction{Name: "read", Value: "1"},
				RoleID:      "04d4e7a6-0d07-11e8-9a2e-28cfe919ca6f",
				WorkspaceID: "54a38f71-1287-11e8-9f0f-28cfe919ca6f",
				NodeID:      "node1",
			},
			{
				Action:      &idm.ACLAction{Name: "read", Value: "1"},
				RoleID:      "04d4e7a6-0d07-11e8-9a2e-28cfe919ca6f",
				WorkspaceID: "54a38f71-1287-11e8-9f0f-28cfe919ca6f",
				NodeID:      "node2",
			},
			{
				Action:      &idm.ACLAction{Name: "read", Value: "1"},
				RoleID:      "add-me",
				WorkspaceID: "54a38f71-1287-11e8-9f0f-28cfe919ca6f",
				NodeID:      "node1",
			},
			{
				Action:      &idm.ACLAction{Name: "read", Value: "1"},
				RoleID:      "add-me",
				WorkspaceID: "54a38f71-1287-11e8-9f0f-28cfe919ca6f",
				NodeID:      "node2",
			},
		}

		sc := NewClient(nil)
		add, remove := sc.DiffAcls(context.Background(), current, target)
		So(add, ShouldHaveLength, 2)
		So(add[0].RoleID, ShouldEqual, "add-me")
		So(add[1].RoleID, ShouldEqual, "add-me")
		So(remove, ShouldHaveLength, 2)
		So(remove[0].RoleID, ShouldEqual, "remove-me")
		So(remove[1].RoleID, ShouldEqual, "remove-me")

	})

}

func TestSharesHandler_DiffReadRoles(t *testing.T) {

	Convey("Test DiffReadRoles", t, func() {

		current := []*idm.ACL{
			{
				ID:          "4289",
				Action:      &idm.ACLAction{Name: "read", Value: "1"},
				RoleID:      "04d4e7a6-0d07-11e8-9a2e-28cfe919ca6f",
				WorkspaceID: "54a38f71-1287-11e8-9f0f-28cfe919ca6f",
				NodeID:      "2ebcf9cd-abc2-40fd-8fb8-f4b4e916c895",
			},
			{
				ID:          "4289",
				Action:      &idm.ACLAction{Name: "write", Value: "1"},
				RoleID:      "04d4e7a6-0d07-11e8-9a2e-28cfe919ca6f",
				WorkspaceID: "54a38f71-1287-11e8-9f0f-28cfe919ca6f",
				NodeID:      "2ebcf9cd-abc2-40fd-8fb8-f4b4e916c895",
			},
			{
				ID:          "4289",
				Action:      &idm.ACLAction{Name: "read", Value: "1"},
				RoleID:      "remove-me",
				WorkspaceID: "54a38f71-1287-11e8-9f0f-28cfe919ca6f",
				NodeID:      "2ebcf9cd-abc2-40fd-8fb8-f4b4e916c895",
			},
			{
				ID:          "4289",
				Action:      &idm.ACLAction{Name: "write", Value: "1"},
				RoleID:      "remove-me",
				WorkspaceID: "54a38f71-1287-11e8-9f0f-28cfe919ca6f",
				NodeID:      "2ebcf9cd-abc2-40fd-8fb8-f4b4e916c895",
			},
		}

		target := []*idm.ACL{
			{
				Action:      &idm.ACLAction{Name: "read", Value: "1"},
				RoleID:      "04d4e7a6-0d07-11e8-9a2e-28cfe919ca6f",
				WorkspaceID: "54a38f71-1287-11e8-9f0f-28cfe919ca6f",
				NodeID:      "2ebcf9cd-abc2-40fd-8fb8-f4b4e916c895",
			},
			{
				Action:      &idm.ACLAction{Name: "write", Value: "1"},
				RoleID:      "04d4e7a6-0d07-11e8-9a2e-28cfe919ca6f",
				WorkspaceID: "54a38f71-1287-11e8-9f0f-28cfe919ca6f",
				NodeID:      "2ebcf9cd-abc2-40fd-8fb8-f4b4e916c895",
			},
			{
				Action:      &idm.ACLAction{Name: "read", Value: "1"},
				RoleID:      "add-me",
				WorkspaceID: "54a38f71-1287-11e8-9f0f-28cfe919ca6f",
				NodeID:      "2ebcf9cd-abc2-40fd-8fb8-f4b4e916c895",
			},
			{
				Action:      &idm.ACLAction{Name: "write", Value: "1"},
				RoleID:      "add-me",
				WorkspaceID: "54a38f71-1287-11e8-9f0f-28cfe919ca6f",
				NodeID:      "2ebcf9cd-abc2-40fd-8fb8-f4b4e916c895",
			},
		}

		sc := NewClient(nil)
		add, remove := sc.DiffReadRoles(context.Background(), current, target)
		So(add, ShouldHaveLength, 1)
		So(remove, ShouldHaveLength, 1)

	})

	Convey("Test DiffReadRoles : just remove a node", t, func() {

		current := []*idm.ACL{
			{
				ID:          "4289",
				Action:      &idm.ACLAction{Name: "read", Value: "1"},
				RoleID:      "04d4e7a6-0d07-11e8-9a2e-28cfe919ca6f",
				WorkspaceID: "54a38f71-1287-11e8-9f0f-28cfe919ca6f",
				NodeID:      "2ebcf9cd-abc2-40fd-8fb8-f4b4e916c895",
			},
			{
				ID:          "4289",
				Action:      &idm.ACLAction{Name: "write", Value: "1"},
				RoleID:      "04d4e7a6-0d07-11e8-9a2e-28cfe919ca6f",
				WorkspaceID: "54a38f71-1287-11e8-9f0f-28cfe919ca6f",
				NodeID:      "2ebcf9cd-abc2-40fd-8fb8-f4b4e916c895",
			},
			{
				ID:          "4289",
				Action:      &idm.ACLAction{Name: "read", Value: "1"},
				RoleID:      "role-2",
				WorkspaceID: "54a38f71-1287-11e8-9f0f-28cfe919ca6f",
				NodeID:      "2ebcf9cd-abc2-40fd-8fb8-f4b4e916c895",
			},
			{
				ID:          "4289",
				Action:      &idm.ACLAction{Name: "write", Value: "1"},
				RoleID:      "role-2",
				WorkspaceID: "54a38f71-1287-11e8-9f0f-28cfe919ca6f",
				NodeID:      "2ebcf9cd-abc2-40fd-8fb8-f4b4e916c895",
			},
			{
				ID:          "4289",
				Action:      &idm.ACLAction{Name: "read", Value: "1"},
				RoleID:      "04d4e7a6-0d07-11e8-9a2e-28cfe919ca6f",
				WorkspaceID: "54a38f71-1287-11e8-9f0f-28cfe919ca6f",
				NodeID:      "other-node",
			},
			{
				ID:          "4289",
				Action:      &idm.ACLAction{Name: "write", Value: "1"},
				RoleID:      "04d4e7a6-0d07-11e8-9a2e-28cfe919ca6f",
				WorkspaceID: "54a38f71-1287-11e8-9f0f-28cfe919ca6f",
				NodeID:      "other-node",
			},
			{
				ID:          "4289",
				Action:      &idm.ACLAction{Name: "read", Value: "1"},
				RoleID:      "role-2",
				WorkspaceID: "54a38f71-1287-11e8-9f0f-28cfe919ca6f",
				NodeID:      "other-node",
			},
			{
				ID:          "4289",
				Action:      &idm.ACLAction{Name: "write", Value: "1"},
				RoleID:      "role-2",
				WorkspaceID: "54a38f71-1287-11e8-9f0f-28cfe919ca6f",
				NodeID:      "other-node",
			},
		}

		target := []*idm.ACL{
			{
				Action:      &idm.ACLAction{Name: "read", Value: "1"},
				RoleID:      "04d4e7a6-0d07-11e8-9a2e-28cfe919ca6f",
				WorkspaceID: "54a38f71-1287-11e8-9f0f-28cfe919ca6f",
				NodeID:      "2ebcf9cd-abc2-40fd-8fb8-f4b4e916c895",
			},
			{
				Action:      &idm.ACLAction{Name: "write", Value: "1"},
				RoleID:      "04d4e7a6-0d07-11e8-9a2e-28cfe919ca6f",
				WorkspaceID: "54a38f71-1287-11e8-9f0f-28cfe919ca6f",
				NodeID:      "2ebcf9cd-abc2-40fd-8fb8-f4b4e916c895",
			},
			{
				Action:      &idm.ACLAction{Name: "read", Value: "1"},
				RoleID:      "role-2",
				WorkspaceID: "54a38f71-1287-11e8-9f0f-28cfe919ca6f",
				NodeID:      "2ebcf9cd-abc2-40fd-8fb8-f4b4e916c895",
			},
			{
				Action:      &idm.ACLAction{Name: "write", Value: "1"},
				RoleID:      "role-2",
				WorkspaceID: "54a38f71-1287-11e8-9f0f-28cfe919ca6f",
				NodeID:      "2ebcf9cd-abc2-40fd-8fb8-f4b4e916c895",
			},
		}

		sc := NewClient(nil)
		add, remove := sc.DiffReadRoles(context.Background(), current, target)
		So(add, ShouldHaveLength, 0)
		So(remove, ShouldHaveLength, 0)

	})

}

func TestSharesHandler_AclsToRoomAcls(t *testing.T) {
	Convey("Test AclsToRoomAcls", t, func() {

		acls := []*idm.ACL{
			{
				Action:      &idm.ACLAction{Name: "read", Value: "1"},
				RoleID:      "04d4e7a6-0d07-11e8-9a2e-28cfe919ca6f",
				WorkspaceID: "54a38f71-1287-11e8-9f0f-28cfe919ca6f",
				NodeID:      "2ebcf9cd-abc2-40fd-8fb8-f4b4e916c895",
			},
			{
				Action:      &idm.ACLAction{Name: "write", Value: "1"},
				RoleID:      "04d4e7a6-0d07-11e8-9a2e-28cfe919ca6f",
				WorkspaceID: "54a38f71-1287-11e8-9f0f-28cfe919ca6f",
				NodeID:      "2ebcf9cd-abc2-40fd-8fb8-f4b4e916c895",
			},
			{
				Action:      &idm.ACLAction{Name: "read", Value: "1"},
				RoleID:      "add-me",
				WorkspaceID: "54a38f71-1287-11e8-9f0f-28cfe919ca6f",
				NodeID:      "2ebcf9cd-abc2-40fd-8fb8-f4b4e916c895",
			},
			{
				Action:      &idm.ACLAction{Name: "write", Value: "1"},
				RoleID:      "add-me",
				WorkspaceID: "54a38f71-1287-11e8-9f0f-28cfe919ca6f",
				NodeID:      "2ebcf9cd-abc2-40fd-8fb8-f4b4e916c895",
			},
		}

		sc := NewClient(nil)
		roomAcls := sc.AclsToCellAcls(context.Background(), acls)
		So(roomAcls, ShouldHaveLength, 2)

	})
}
