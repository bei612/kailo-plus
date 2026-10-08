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
}

func (*versionActionRouter) GetClientsPool(context.Context) nodes.SourcesPool {
	return new(versionActionPool)
}
func (r *versionActionRouter) ReadNode(context.Context, *tree.ReadNodeRequest, ...grpc.CallOption) (*tree.ReadNodeResponse, error) {
	return &tree.ReadNodeResponse{Node: r.node.Clone()}, nil
}
func (r *versionActionRouter) CopyObject(context.Context, *tree.Node, *tree.Node, *models.CopyRequestData) (models.ObjectInfo, error) {
	r.copyCount++
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
	}{
		{name: "empty-file", size: 0},
		{name: "actual-copy-size", size: 7},
		{name: "claimed-task-empty-version", size: 0, claimed: true},
		{name: "claimed-task-version", size: 7, claimed: true},
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
			if tc.change != nil {
				tc.change(s, r)
			}
			grpcclient.RegisterMock(common.ServiceVersionsGRPC, &tree.NodeVersionerStub{NodeVersionerServer: s})
			output, err := new(VersionAction).Run(ctx, nil, &jobs.ActionMessage{Nodes: []*tree.Node{node}})
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
			if tc.name == "create-owner-mismatch" || tc.name == "create-reference-missing" || tc.name == "claimed-task-reference-mismatch" {
				if r.copyCount != 0 || len(s.stored) != 0 {
					t.Error("invalid created native actor/reference reached the object writer")
				}
			}
		})
	}
}
