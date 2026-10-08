package grpc

import (
	"context"
	"errors"
	"testing"

	"github.com/pydio/cells/v5/common"
	grpcclient "github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/proto/docstore"
	"github.com/pydio/cells/v5/common/proto/object"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/common/runtime/manager"
	"github.com/pydio/cells/v5/common/storage/boltdb"
	"github.com/pydio/cells/v5/common/storage/test"
	"github.com/pydio/cells/v5/common/utils/cache/gocache"
	cachehelper "github.com/pydio/cells/v5/common/utils/cache/helper"
	"github.com/pydio/cells/v5/data/versions"
	"github.com/pydio/cells/v5/data/versions/dao/bolt"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
)

type nativeHeadStream struct {
	grpc.ServerStream
	ctx      context.Context
	versions []*tree.ContentRevision
}

type nativeWriteStore struct {
	*bolt.BoltStore
	failure *error
}

func (s *nativeWriteStore) StoreVersion(ctx context.Context, node string, version *tree.ContentRevision) error {
	if s.failure != nil && *s.failure != nil {
		return *s.failure
	}
	return s.BoltStore.StoreVersion(ctx, node, version)
}

type nativeVersionPolicy struct {
	docstore.UnimplementedDocStoreServer
}

func (*nativeVersionPolicy) GetDocument(context.Context, *docstore.GetDocumentRequest) (*docstore.GetDocumentResponse, error) {
	return &docstore.GetDocumentResponse{Document: &docstore.Document{Data: `{}`}}, nil
}

func TestKailoNativeVersionStoreAcknowledgesPersistence(t *testing.T) {
	var store *nativeWriteStore
	var storageFailure error
	constructor := func(db boltdb.DB) versions.DAO {
		// Manager resolves a DAO instance per call from the original DB. Share
		// only the injected storage failure, not a replacement persistence store.
		store = &nativeWriteStore{BoltStore: bolt.NewBoltStore(db).(*bolt.BoltStore), failure: &storageFailure}
		return store
	}
	test.RunStorageTests([]test.StorageTestCase{test.TemplateBoltWithPrefix(constructor, "kailo_write_versions_")}, t, func(ctx context.Context) {
		cachehelper.SetStaticResolver("pm://", &gocache.URLOpener{})
		grpcclient.RegisterMock(common.ServiceDocStoreGRPC, &docstore.DocStoreStub{DocStoreServer: &nativeVersionPolicy{}})
		if err := config.Set(ctx, &object.DataSource{Name: "native-source", VersioningPolicyName: "native-policy"},
			"services", common.ServiceGrpcNamespace_+common.ServiceDataSync_+"native-source"); err != nil {
			t.Error(err)
			return
		}
		node := &tree.Node{Uuid: "native-node"}
		node.MustSetMeta(common.MetaNamespaceDatasourceName, "native-source")
		revision := &tree.ContentRevision{VersionId: "native-draft", Draft: true, Size: 4, ETag: "native-etag",
			Event: &tree.NodeChangeEvent{Type: tree.NodeChangeEvent_CREATE}}
		handler := new(Handler)
		response, err := handler.StoreVersion(ctx, &tree.StoreVersionRequest{Node: node, Version: revision})
		if err != nil || !response.GetSuccess() || !proto.Equal(response.GetVersion(), revision) {
			t.Errorf("native persistent version was not acknowledged: response=%v err=%v", response, err)
			return
		}
		persisted, err := store.GetVersion(ctx, node.Uuid, revision.VersionId)
		if err != nil || !proto.Equal(persisted, revision) {
			t.Errorf("acknowledgement did not match the actual Bolt revision: version=%v err=%v", persisted, err)
			return
		}
		failure := errors.New("native version persistence unavailable")
		storageFailure = failure
		for _, draft := range []bool{true, false} {
			input := proto.Clone(revision).(*tree.ContentRevision)
			input.VersionId = "not-stored"
			input.Draft = draft
			response, err := handler.StoreVersion(ctx, &tree.StoreVersionRequest{Node: node, Version: input})
			if !errors.Is(err, failure) || response != nil {
				t.Errorf("native storage failure became a successful RPC: draft=%v response=%v err=%v", draft, response, err)
			}
		}
		if _, err := store.GetVersion(ctx, node.Uuid, "not-stored"); err == nil {
			t.Error("failed native write created a revision")
		}
	})
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
