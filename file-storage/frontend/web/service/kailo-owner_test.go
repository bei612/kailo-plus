package service

import (
	"context"
	"testing"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/common/utils/propagator"
)

// DD-164(3): only a user's native create event is an owner record.
func TestKailoOwnerCreation(t *testing.T) {
	user := propagator.WithAdditionalMetadata(context.Background(), map[string]string{common.PydioContextUserKey: "dir.pre"})
	created := &tree.NodeChangeEvent{Type: tree.NodeChangeEvent_CREATE, Target: &tree.Node{Uuid: "n1", Path: "ds/root/ws/new"}}
	if login, node, p, ok := kailoOwnerCreation(user, created); !ok || login != "dir.pre" || node != "n1" || p != "ds/root/ws/new" {
		t.Fatalf("create by a user: %v %q %q %q", ok, login, node, p)
	}
	system := propagator.WithAdditionalMetadata(context.Background(), map[string]string{common.PydioContextUserKey: common.PydioSystemUsername})
	if _, _, _, ok := kailoOwnerCreation(system, created); ok {
		t.Fatal("system creation recorded")
	}
	if _, _, _, ok := kailoOwnerCreation(context.Background(), created); ok {
		t.Fatal("creation without a user recorded")
	}
	updated := &tree.NodeChangeEvent{Type: tree.NodeChangeEvent_UPDATE_CONTENT, Target: created.Target}
	if _, _, _, ok := kailoOwnerCreation(user, updated); ok {
		t.Fatal("update recorded as creation")
	}
	internal := &tree.NodeChangeEvent{Type: tree.NodeChangeEvent_CREATE, Target: &tree.Node{Uuid: "n2", Path: "ds/root/ws/.pydio"}}
	internal.Target.MustSetMeta(common.MetaNamespaceDatasourceInternal, true)
	if _, _, _, ok := kailoOwnerCreation(user, internal); ok {
		t.Fatal("internal node recorded")
	}
}
