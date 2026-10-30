package auth_test

import (
	"context"
	"testing"

	"github.com/pydio/cells/v5/common/permissions"
	"github.com/pydio/cells/v5/common/proto/idm"
	"github.com/pydio/cells/v5/common/proto/tree"
)

// DD-164(3) owner semantics (design 1c803580), the native mechanism: a
// read+write node ACL of the creator's account role on the node it created,
// without a workspace id, gives that node (and its subtree) write while the
// read-only Workspace role keeps the root read only; it is a node mask, not a
// second workspace root, and nobody else gains anything.
func TestNativeOIDCOwnerNodeMask(t *testing.T) {
	ctx := context.Background()
	const ws, root, mine, other, deep = "ws-uuid", "root-node", "mine-node", "other-node", "deep-node"
	reader := &idm.Role{Uuid: "kailo-wsr-11111111-2222-4333-8444-555555555502"}
	creator := &idm.Role{Uuid: "creator-account", UserRole: true}
	someoneElse := &idm.Role{Uuid: "someone-else", UserRole: true}
	acl := func(node, role, ws string, action *idm.ACLAction) *idm.ACL {
		return &idm.ACL{NodeID: node, RoleID: role, WorkspaceID: ws, Action: &idm.ACLAction{Name: action.Name, Value: action.Value}}
	}
	acls := []*idm.ACL{
		{NodeID: root, WorkspaceID: ws, Action: &idm.ACLAction{Name: permissions.AclWsrootActionName, Value: "path"}},
		acl(root, reader.Uuid, ws, permissions.AclRead),
		acl(mine, creator.Uuid, "", permissions.AclRead),
		acl(mine, creator.Uuid, "", permissions.AclWrite),
	}
	folder := func(id string) *tree.Node { return &tree.Node{Uuid: id, Type: tree.NodeType_COLLECTION} }

	al := permissions.NewAccessList(reader, creator)
	al.AppendACLs(acls...)
	al.Flatten(ctx)
	if !al.CanWrite(ctx, folder(mine), folder(root)) || !al.CanWrite(ctx, folder(deep), folder(mine), folder(root)) {
		t.Fatal("creator cannot write its own folder or subtree")
	}
	if al.CanWrite(ctx, folder(root)) || al.CanWrite(ctx, folder(other), folder(root)) {
		t.Fatal("read-only Workspace member can write the root or someone else's content")
	}
	if !al.CanRead(ctx, folder(other), folder(root)) {
		t.Fatal("read-only Workspace member cannot read the Workspace")
	}
	if roots := al.GetWorkspacesRoots(); len(roots) != 1 || len(roots[ws]) != 1 {
		t.Fatalf("owner record became a workspace root: %v", roots)
	}

	peer := permissions.NewAccessList(reader, someoneElse)
	peer.AppendACLs(acls...)
	peer.Flatten(ctx)
	if peer.CanWrite(ctx, folder(mine), folder(root)) {
		t.Fatal("another read-only member gained write on the creator's folder")
	}
}
