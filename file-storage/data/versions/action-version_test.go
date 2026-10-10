package versions

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth/claim"
	grpcclient "github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/config"
	_ "github.com/pydio/cells/v5/common/config/memory"
	"github.com/pydio/cells/v5/common/nodes"
	"github.com/pydio/cells/v5/common/nodes/models"
	"github.com/pydio/cells/v5/common/proto/docstore"
	"github.com/pydio/cells/v5/common/proto/idm"
	"github.com/pydio/cells/v5/common/proto/jobs"
	"github.com/pydio/cells/v5/common/proto/object"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/common/utils/cache/gocache"
	cachehelper "github.com/pydio/cells/v5/common/utils/cache/helper"
	"github.com/pydio/cells/v5/common/utils/openurl"
	"github.com/pydio/cells/v5/common/utils/propagator"
	jobstore "github.com/pydio/cells/v5/scheduler/jobs"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

type versionActionPool struct{ nodes.SourcesPool }

func (*versionActionPool) GetDataSourceInfo(string, ...int) (nodes.LoadedSource, error) {
	return nodes.LoadedSource{DataSource: &object.DataSource{Name: "native-versions"}}, nil
}

type versionActionRouter struct {
	nodes.Client
	node       *tree.Node
	copySize   int64
	copyErr    error
	copyCount  int
	pruneCount int
	prune      func(context.Context, *tree.DeleteNodeRequest) (*tree.DeleteNodeResponse, error)
	copies     []*models.CopyRequestData
}

func (*versionActionRouter) GetClientsPool(context.Context) nodes.SourcesPool {
	return new(versionActionPool)
}
func (r *versionActionRouter) ReadNode(context.Context, *tree.ReadNodeRequest, ...grpc.CallOption) (*tree.ReadNodeResponse, error) {
	return &tree.ReadNodeResponse{Node: r.node.Clone()}, nil
}
func (r *versionActionRouter) CopyObject(_ context.Context, _ *tree.Node, _ *tree.Node, data *models.CopyRequestData) (models.ObjectInfo, error) {
	r.copyCount++
	r.copies = append(r.copies, data)
	return models.ObjectInfo{Size: r.copySize}, r.copyErr
}
func (r *versionActionRouter) DeleteNode(ctx context.Context, request *tree.DeleteNodeRequest, _ ...grpc.CallOption) (*tree.DeleteNodeResponse, error) {
	r.pruneCount++
	if r.prune != nil {
		return r.prune(ctx, request)
	}
	return &tree.DeleteNodeResponse{Success: true}, nil
}

type nativeDraftPruneStore struct {
	DAO
	upload    *DraftUpload
	fenceErr  error
	completed *tree.ContentRevision
}

func (d *nativeDraftPruneStore) DraftUploads(context.Context, time.Time, int64) ([]*DraftUpload, error) {
	if d.upload == nil {
		return nil, nil
	}
	return []*DraftUpload{d.upload}, nil
}
func (d *nativeDraftPruneStore) FenceDraftUpload(context.Context, string, string, time.Time) (*DraftUpload, error) {
	if d.fenceErr != nil {
		return nil, d.fenceErr
	}
	d.upload.State = DraftUploadCleanup
	return d.upload, nil
}
func (d *nativeDraftPruneStore) GetVersion(context.Context, string, string) (*tree.ContentRevision, error) {
	return d.completed, d.fenceErr
}

func TestNativeDraftUploadPruneRetainsLateWriter(t *testing.T) {
	previousRouter := router
	defer func() { router = previousRouter }()
	for _, scenario := range []string{"ack", "not-acknowledged", "remote-error"} {
		t.Run(scenario, func(t *testing.T) {
			location := &tree.Node{Uuid: "reserved-object", Path: "versions/reserved-object"}
			dao := &nativeDraftPruneStore{upload: &DraftUpload{NodeUuid: "native-node", State: DraftUploadPending,
				Revision: &tree.ContentRevision{VersionId: "native-draft", Location: location}}}
			blobExists := true
			r := &versionActionRouter{prune: func(_ context.Context, request *tree.DeleteNodeRequest) (*tree.DeleteNodeResponse, error) {
				if !proto.Equal(request.Node, location) || dao.upload.State != DraftUploadCleanup {
					t.Fatal("object deletion ran before fencing the original reserved location")
				}
				if scenario == "remote-error" {
					return nil, errors.New("object deletion acknowledgement lost")
				}
				if scenario == "not-acknowledged" {
					return &tree.DeleteNodeResponse{}, nil
				}
				blobExists = false
				return &tree.DeleteNodeResponse{Success: true}, nil
			}}
			router = r
			err := PruneDraftUploads(context.Background(), dao, time.Now(), 1)
			if (err != nil) != (scenario != "ack") {
				t.Fatalf("cleanup fabricated acknowledgement: %v", err)
			}
			if dao.upload == nil || dao.upload.State != DraftUploadCleanup || !proto.Equal(dao.upload.Revision.Location, location) {
				t.Fatal("cleanup ACK retired the native writer fence/location")
			}
			// The expired original PUT finishes after the first remote delete.
			// A second sweep must still discover and delete those actual bytes.
			blobExists = true
			r.prune = func(_ context.Context, request *tree.DeleteNodeRequest) (*tree.DeleteNodeResponse, error) {
				if !proto.Equal(request.Node, location) {
					t.Fatal("late writer location changed")
				}
				blobExists = false
				return &tree.DeleteNodeResponse{Success: true}, nil
			}
			if err := PruneDraftUploads(context.Background(), dao, time.Now(), 1); err != nil {
				t.Fatal(err)
			}
			if blobExists || r.pruneCount != 2 || dao.upload == nil {
				t.Fatal("late native writer escaped the original cleanup consumer")
			}
		})
	}
}

func TestNativeDraftUploadPruneCancellation(t *testing.T) {
	previousRouter := router
	defer func() { router = previousRouter }()
	dao := &nativeDraftPruneStore{upload: &DraftUpload{NodeUuid: "native-node", State: DraftUploadPending,
		Revision: &tree.ContentRevision{VersionId: "native-version", Location: &tree.Node{Path: "versions/native-object"}}}}
	entered, finished := make(chan struct{}), make(chan error, 1)
	router = &versionActionRouter{prune: func(ctx context.Context, _ *tree.DeleteNodeRequest) (*tree.DeleteNodeResponse, error) {
		close(entered)
		<-ctx.Done()
		return nil, ctx.Err()
	}}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { finished <- PruneDraftUploads(ctx, dao, time.Now(), 1) }()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("original native DeleteNode was not called")
	}
	cancel()
	select {
	case err := <-finished:
		if !errors.Is(err, context.Canceled) || dao.upload == nil || dao.upload.State != DraftUploadCleanup {
			t.Fatalf("unknown deletion lost cancellation or its discoverable fence: %v %v", dao.upload, err)
		}
	case <-time.After(time.Second):
		t.Fatal("native deletion ignored the original cleanup context")
	}
}

type versionActionService struct {
	tree.UnimplementedNodeVersionerServer
	created  *tree.CreateVersionResponse
	stored   []*tree.StoreVersionRequest
	storeErr error
	confirm  func(*tree.ContentRevision) *tree.StoreVersionResponse
	requests []*tree.CreateVersionRequest
	source   *tree.ContentRevision
}

func (s *versionActionService) HeadVersion(_ context.Context, request *tree.HeadVersionRequest) (*tree.HeadVersionResponse, error) {
	return &tree.HeadVersionResponse{Version: s.source}, nil
}

func (s *versionActionService) CreateVersion(_ context.Context, request *tree.CreateVersionRequest) (*tree.CreateVersionResponse, error) {
	s.requests = append(s.requests, proto.Clone(request).(*tree.CreateVersionRequest))
	if request.VersionUuid != "" && s.created.GetVersion().GetVersionId() == "native-version" {
		s.created.Version.VersionId = request.VersionUuid
	}
	return s.created, nil
}
func (s *versionActionService) StoreVersion(_ context.Context, request *tree.StoreVersionRequest) (*tree.StoreVersionResponse, error) {
	s.stored = append(s.stored, proto.Clone(request).(*tree.StoreVersionRequest))
	if s.storeErr != nil {
		return nil, s.storeErr
	}
	return s.confirm(request.Version), nil
}

type versionActionPolicy struct {
	docstore.UnimplementedDocStoreServer
}

func (*versionActionPolicy) GetDocument(context.Context, *docstore.GetDocumentRequest) (*docstore.GetDocumentResponse, error) {
	return &docstore.GetDocumentResponse{Document: &docstore.Document{Data: `{"VersionsDataSourceName":"native-versions"}`}}, nil
}

type versionActionUser struct {
	idm.UnimplementedUserServiceServer
}

func (*versionActionUser) SearchOne(context.Context, *idm.SearchUserRequest) (*idm.SearchUserResponse, error) {
	return &idm.SearchUserResponse{User: &idm.User{Uuid: "native-user", Login: "native-user"}}, nil
}

func TestVersionActionRequiresExactNativePersistence(t *testing.T) {
	cachehelper.SetStaticResolver("pm://", &gocache.URLOpener{})
	grpcclient.RegisterMock(common.ServiceDocStoreGRPC, &docstore.DocStoreStub{DocStoreServer: new(versionActionPolicy)})
	grpcclient.RegisterMock(common.ServiceUserGRPC, &idm.UserServiceStub{UserServiceServer: new(versionActionUser)})
	previousRouter := router
	defer func() { router = previousRouter }()
	cases := []struct {
		name    string
		size    int64
		change  func(*versionActionService, *versionActionRouter)
		fail    bool
		claimed bool
		draft   bool
		pruned  int
	}{
		{name: "empty-file", size: 0},
		{name: "actual-copy-size", size: 7},
		{name: "original-event-version-metadata", size: 7},
		{name: "claimed-task-empty-version", size: 0, claimed: true},
		{name: "claimed-task-version", size: 7, claimed: true},
		{name: "claimed-draft-empty", size: 0, claimed: true, draft: true},
		{name: "claimed-draft-exact-not-live-head", size: 7, claimed: true, draft: true},
		{name: "claimed-prune-ack", size: 7, claimed: true, draft: true, pruned: 1, change: func(s *versionActionService, _ *versionActionRouter) {
			s.confirm = func(v *tree.ContentRevision) *tree.StoreVersionResponse {
				return &tree.StoreVersionResponse{Success: true, Version: proto.Clone(v).(*tree.ContentRevision),
					PruneVersions: []*tree.ContentRevision{{VersionId: "old-version", Location: &tree.Node{Uuid: "old-object"}}}}
			}
		}},
		{name: "claimed-prune-multiple-ack", size: 7, claimed: true, draft: true, pruned: 2, change: func(s *versionActionService, _ *versionActionRouter) {
			s.confirm = func(v *tree.ContentRevision) *tree.StoreVersionResponse {
				return &tree.StoreVersionResponse{Success: true, Version: proto.Clone(v).(*tree.ContentRevision),
					PruneVersions: []*tree.ContentRevision{
						{VersionId: "old-version", Location: &tree.Node{Uuid: "old-object"}},
						{VersionId: "next-version", Location: &tree.Node{Uuid: "next-object"}},
					}}
			}
		}},
		{name: "claimed-prune-missing-ack", size: 7, claimed: true, draft: true, pruned: 1, fail: true, change: func(s *versionActionService, r *versionActionRouter) {
			s.confirm = func(v *tree.ContentRevision) *tree.StoreVersionResponse {
				return &tree.StoreVersionResponse{Success: true, Version: proto.Clone(v).(*tree.ContentRevision),
					PruneVersions: []*tree.ContentRevision{{VersionId: "old-version", Location: &tree.Node{Uuid: "old-object"}}}}
			}
			r.prune = func(context.Context, *tree.DeleteNodeRequest) (*tree.DeleteNodeResponse, error) { return nil, nil }
		}},
		{name: "claimed-prune-rejected", size: 7, claimed: true, draft: true, pruned: 1, fail: true, change: func(s *versionActionService, r *versionActionRouter) {
			s.confirm = func(v *tree.ContentRevision) *tree.StoreVersionResponse {
				return &tree.StoreVersionResponse{Success: true, Version: proto.Clone(v).(*tree.ContentRevision),
					PruneVersions: []*tree.ContentRevision{{VersionId: "old-version", Location: &tree.Node{Uuid: "old-object"}}}}
			}
			r.prune = func(context.Context, *tree.DeleteNodeRequest) (*tree.DeleteNodeResponse, error) {
				return &tree.DeleteNodeResponse{}, nil
			}
		}},
		{name: "claimed-prune-transport-error", size: 7, claimed: true, draft: true, pruned: 1, fail: true, change: func(s *versionActionService, r *versionActionRouter) {
			s.confirm = func(v *tree.ContentRevision) *tree.StoreVersionResponse {
				return &tree.StoreVersionResponse{Success: true, Version: proto.Clone(v).(*tree.ContentRevision),
					PruneVersions: []*tree.ContentRevision{{VersionId: "old-version", Location: &tree.Node{Uuid: "old-object"}}}}
			}
			r.prune = func(context.Context, *tree.DeleteNodeRequest) (*tree.DeleteNodeResponse, error) {
				return nil, errors.New("native pruning ACK lost")
			}
		}},
		{name: "claimed-prune-partial", size: 7, claimed: true, draft: true, pruned: 2, fail: true, change: func(s *versionActionService, r *versionActionRouter) {
			s.confirm = func(v *tree.ContentRevision) *tree.StoreVersionResponse {
				return &tree.StoreVersionResponse{Success: true, Version: proto.Clone(v).(*tree.ContentRevision),
					PruneVersions: []*tree.ContentRevision{
						{VersionId: "old-version", Location: &tree.Node{Uuid: "old-object"}},
						{VersionId: "next-version", Location: &tree.Node{Uuid: "next-object"}},
						{VersionId: "last-version", Location: &tree.Node{Uuid: "last-object"}},
					}}
			}
			r.prune = func(context.Context, *tree.DeleteNodeRequest) (*tree.DeleteNodeResponse, error) {
				return &tree.DeleteNodeResponse{Success: r.pruneCount == 1}, nil
			}
		}},
		{name: "draft-without-native-claim", size: 7, draft: true, fail: true},
		{name: "draft-foreign-owner", size: 7, draft: true, claimed: true, fail: true, change: func(s *versionActionService, _ *versionActionRouter) { s.source.OwnerUuid = "foreign-owner" }},
		{name: "draft-not-persisted-draft", size: 7, draft: true, claimed: true, fail: true, change: func(s *versionActionService, _ *versionActionRouter) { s.source.Draft = false }},
		{name: "draft-reference-mismatch", size: 7, draft: true, claimed: true, fail: true, change: func(s *versionActionService, _ *versionActionRouter) { s.source.VersionId = "other-draft" }},
		{name: "draft-copy-byte-mismatch", size: 7, draft: true, claimed: true, fail: true, change: func(_ *versionActionService, r *versionActionRouter) { r.copySize++ }},
		{name: "claimed-task-reference-mismatch", size: 7, claimed: true, fail: true, change: func(s *versionActionService, _ *versionActionRouter) {
			s.created.Version.VersionId = "unrelated-native-version"
		}},
		{name: "native-store-error", size: 7, fail: true, change: func(s *versionActionService, _ *versionActionRouter) {
			s.storeErr = errors.New("native version store unavailable")
		}},
		{name: "missing-ack", size: 7, fail: true, change: func(s *versionActionService, _ *versionActionRouter) {
			s.confirm = func(*tree.ContentRevision) *tree.StoreVersionResponse { return nil }
		}},
		{name: "not-stored", size: 7, fail: true, change: func(s *versionActionService, _ *versionActionRouter) {
			s.confirm = func(v *tree.ContentRevision) *tree.StoreVersionResponse {
				return &tree.StoreVersionResponse{Version: v}
			}
		}},
		{name: "wrong-version", size: 7, fail: true, change: func(s *versionActionService, _ *versionActionRouter) {
			s.confirm = func(v *tree.ContentRevision) *tree.StoreVersionResponse {
				v = proto.Clone(v).(*tree.ContentRevision)
				v.VersionId = "another-version"
				return &tree.StoreVersionResponse{Success: true, Version: v}
			}
		}},
		{name: "wrong-owner", size: 7, fail: true, change: func(s *versionActionService, _ *versionActionRouter) {
			s.confirm = func(v *tree.ContentRevision) *tree.StoreVersionResponse {
				v = proto.Clone(v).(*tree.ContentRevision)
				v.OwnerUuid = "another-actor"
				return &tree.StoreVersionResponse{Success: true, Version: v}
			}
		}},
		{name: "wrong-size", size: 7, fail: true, change: func(s *versionActionService, _ *versionActionRouter) {
			s.confirm = func(v *tree.ContentRevision) *tree.StoreVersionResponse {
				v = proto.Clone(v).(*tree.ContentRevision)
				v.Size++
				return &tree.StoreVersionResponse{Success: true, Version: v}
			}
		}},
		{name: "negative-copy-size", size: -1, fail: true},
		{name: "copy-error", size: 7, fail: true, change: func(_ *versionActionService, r *versionActionRouter) {
			r.copyErr = errors.New("native object copy unavailable")
		}},
		{name: "create-owner-mismatch", size: 7, fail: true, change: func(s *versionActionService, _ *versionActionRouter) { s.created.Version.OwnerUuid = "another-actor" }},
		{name: "create-reference-missing", size: 7, fail: true, change: func(s *versionActionService, _ *versionActionRouter) { s.created.Version.VersionId = "" }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx := claim.ToContext(context.Background(), claim.Claims{Name: "native-user", Subject: "native-user"})
			if tc.claimed {
				ctx = context.WithValue(ctx, jobstore.ClaimedTaskContextKey{}, true)
				ctx = propagator.WithAdditionalMetadata(ctx, map[string]string{common.CtxMetaTaskUuid: "native-operation-key", common.CtxMetaTaskActionPath: "ROOT/version/0"})
			}
			store, err := openurl.OpenPool[config.Store](ctx, []string{"mem://"}, config.OpenStore)
			if err != nil {
				t.Fatal(err)
			}
			ctx = propagator.With(ctx, config.ContextKey, store)
			t.Cleanup(func() { _ = store.Close(context.Background()) })
			if err := config.Set(ctx, &object.DataSource{Name: "native-source", VersioningPolicyName: "native-action-policy"}, "services", common.ServiceGrpcNamespace_+common.ServiceDataSync_+"native-source"); err != nil {
				t.Fatal(err)
			}
			node := &tree.Node{Uuid: "native-node", Path: "native-source/file", Type: tree.NodeType_LEAF, Etag: "native-etag", Size: 99}
			node.MustSetMeta(common.MetaNamespaceDatasourceName, "native-source")
			r := &versionActionRouter{node: node, copySize: tc.size}
			router = r
			s := &versionActionService{created: &tree.CreateVersionResponse{Version: &tree.ContentRevision{
				VersionId: "native-version", OwnerUuid: "native-user", ETag: node.Etag, Size: node.Size,
				Location: &tree.Node{Uuid: "native-version-location", Type: tree.NodeType_LEAF},
			}}, confirm: func(v *tree.ContentRevision) *tree.StoreVersionResponse {
				return &tree.StoreVersionResponse{Success: true, Version: proto.Clone(v).(*tree.ContentRevision)}
			}}
			if tc.draft {
				node.MustSetMeta(common.MetaNamespaceVersionId, "opaque-native-draft")
				s.source = &tree.ContentRevision{VersionId: "opaque-native-draft", Draft: true, OwnerUuid: "native-user", ETag: "frozen-draft-etag", Size: tc.size, Location: &tree.Node{Uuid: "native-draft-location"}}
				s.created.Version.ETag, s.created.Version.Size = s.source.ETag, s.source.Size
			}
			if tc.change != nil {
				tc.change(s, r)
			}
			if tc.name == "original-event-version-metadata" {
				node.MustSetMeta(common.MetaNamespaceVersionId, "ordinary-event-revision")
			}
			grpcclient.RegisterMock(common.ServiceVersionsGRPC, &tree.NodeVersionerStub{NodeVersionerServer: s})
			input := &jobs.ActionMessage{Nodes: []*tree.Node{node}}
			var output *jobs.ActionMessage
			if tc.draft {
				output, err = new(VersionAction).PromoteRevision(ctx, input, r)
			} else {
				output, err = new(VersionAction).Run(ctx, nil, input)
			}
			if (err != nil) != tc.fail {
				t.Fatalf("native action completion mismatch: output=%v err=%v", output, err)
			}
			if tc.fail {
				for _, entry := range output.OutputChain {
					if entry.Success {
						t.Error("unconfirmed native write produced a successful action output")
					}
				}
			} else {
				outputs := 1
				if tc.pruned > 0 {
					outputs++ // One cleanup output covers the entire acknowledged prune set.
				}
				if r.copyCount != 1 || len(s.stored) != 1 || s.stored[0].Version.Size != tc.size || len(output.OutputChain) != outputs || !output.OutputChain[0].Success {
					t.Errorf("native copy/empty version was not exactly persisted: copies=%d stored=%v output=%v", r.copyCount, s.stored, output)
				}
			}
			if r.pruneCount != tc.pruned {
				t.Errorf("native pruning continued without an ACK or repeated a deletion: got %d, want %d", r.pruneCount, tc.pruned)
			}
			if tc.claimed && !tc.fail {
				observed := &tree.ContentRevision{}
				if len(s.requests) != 1 || s.requests[0].VersionUuid == "" || s.requests[0].VersionUuid != s.stored[0].Version.VersionId || output.OutputChain[0].Vars[jobstore.NativeVersionResult] != "true" || protojson.Unmarshal(output.OutputChain[0].JsonBody, observed) != nil || !proto.Equal(observed, s.stored[0].Version) {
					t.Fatal("claimed task did not retain the exact persisted native revision")
				}
			}
			if tc.draft && !tc.fail && (len(r.copies) != 1 || r.copies[0].SrcVersionId != "opaque-native-draft" || s.requests[0].Node.Etag != "frozen-draft-etag" || s.requests[0].Node.Size != tc.size) {
				t.Fatal("claimed promotion copied the mutable head instead of its frozen draft")
			}
			if tc.name == "original-event-version-metadata" && (len(r.copies) != 1 || r.copies[0].SrcVersionId != "") {
				t.Fatal("ordinary native event was mistaken for a governed draft promotion")
			}
			if tc.name == "create-owner-mismatch" || tc.name == "create-reference-missing" || tc.name == "claimed-task-reference-mismatch" {
				if r.copyCount != 0 || len(s.stored) != 0 {
					t.Error("invalid created native actor/reference reached the object writer")
				}
			}
		})
	}
}
