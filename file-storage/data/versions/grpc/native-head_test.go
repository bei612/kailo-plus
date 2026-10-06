package grpc

import (
	"context"
	"testing"

	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/common/runtime/manager"
	"github.com/pydio/cells/v5/common/storage/test"
	"github.com/pydio/cells/v5/data/versions"
	"github.com/pydio/cells/v5/data/versions/dao/bolt"
	"google.golang.org/grpc"
)

type nativeHeadStream struct {
	grpc.ServerStream
	ctx      context.Context
	versions []*tree.ContentRevision
}

func (s *nativeHeadStream) Context() context.Context { return s.ctx }
func (s *nativeHeadStream) Send(v *tree.ListVersionsResponse) error {
	s.versions = append(s.versions, v.Version)
	return nil
}

// Original real Bolt/manager fixture and production RPC handlers: no adapter
// IsHead stub. Drafts and mtime cannot turn an older stored VersionId into head.
func TestKailoNativePublishedHead(t *testing.T) {
	test.RunStorageTests([]test.StorageTestCase{test.TemplateBoltWithPrefix(bolt.NewBoltStore, "kailo_versions_")}, t, func(ctx context.Context) {
		dao, err := manager.Resolve[versions.DAO](ctx)
		if err != nil {
			t.Error(err)
			return
		}
		for _, v := range []*tree.ContentRevision{
			{VersionId: "old", ETag: "old", Size: 4, MTime: 9999},
			{VersionId: "head", ETag: "current", Size: 7, MTime: 10},
			{VersionId: "draft", ETag: "draft", Size: 9, MTime: 10000, Draft: true},
		} {
			// Original Bolt distinguishes its current native encoding from the
			// legacy ChangeLog format by the stored Event/Location field.
			v.Event = &tree.NodeChangeEvent{Type: tree.NodeChangeEvent_CREATE}
			if err := dao.StoreVersion(ctx, "node", v); err != nil {
				t.Error(err)
				return
			}
		}
		h := new(Handler)
		request := &tree.ListVersionsRequest{Node: &tree.Node{Uuid: "node", Type: tree.NodeType_LEAF, Etag: "current", Size: 7, MTime: 500}, Filters: map[string]string{"draftStatus": "\"published\""}}
		s := &nativeHeadStream{ctx: ctx}
		if err := h.ListVersions(request, s); err != nil {
			t.Error(err)
			return
		}
		if len(s.versions) != 2 || s.versions[0].VersionId != "head" || !s.versions[0].IsHead || s.versions[1].IsHead {
			t.Errorf("native head not produced: %v", s.versions)
			return
		}
		for _, id := range []string{"old", "head", "draft"} {
			v, err := h.HeadVersion(ctx, &tree.HeadVersionRequest{NodeUuid: "node", VersionId: id})
			if err != nil || v.Version.VersionId != id || v.Version.IsHead != (id == "head") {
				t.Errorf("exact head %s: %v %v", id, v, err)
				return
			}
		}
		if _, err := h.HeadVersion(ctx, &tree.HeadVersionRequest{NodeUuid: "node"}); err == nil {
			t.Error("empty VersionId became a head query")
			return
		}
		request.Node.Etag = "unversioned-current"
		s = &nativeHeadStream{ctx: ctx}
		if err := h.ListVersions(request, s); err != nil {
			t.Error(err)
			return
		}
		for _, v := range s.versions {
			if v.IsHead {
				t.Error("unversioned current content was given a head reference")
				return
			}
		}
	})
}
