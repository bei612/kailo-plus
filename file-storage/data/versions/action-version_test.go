package versions

import (
	"context"
	"errors"
	"testing"

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
func (r *versionActionRouter) DeleteNode(context.Context, *tree.DeleteNodeRequest, ...grpc.CallOption) (*tree.DeleteNodeResponse, error) {
	r.pruneCount++
	return &tree.DeleteNodeResponse{Success: true}, nil
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
	}{
		{name: "empty-file", size: 0},
		{name: "actual-copy-size", size: 7},
		{name: "original-event-version-metadata", size: 7},
		{name: "claimed-task-empty-version", size: 0, claimed: true},
		{name: "claimed-task-version", size: 7, claimed: true},
		{name: "claimed-draft-empty", size: 0, claimed: true, draft: true},
		{name: "claimed-draft-exact-not-live-head", size: 7, claimed: true, draft: true},
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
				if r.pruneCount != 0 {
					t.Error("unconfirmed native write pruned an existing version")
				}
			} else if r.copyCount != 1 || len(s.stored) != 1 || s.stored[0].Version.Size != tc.size || len(output.OutputChain) != 1 || !output.OutputChain[0].Success {
				t.Errorf("native copy/empty version was not exactly persisted: copies=%d stored=%v output=%v", r.copyCount, s.stored, output)
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
