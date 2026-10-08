package version

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth/claim"
	grpcclient "github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/nodes"
	"github.com/pydio/cells/v5/common/nodes/models"
	"github.com/pydio/cells/v5/common/proto/object"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/common/utils/cache/gocache"
	cachehelper "github.com/pydio/cells/v5/common/utils/cache/helper"
	"github.com/pydio/cells/v5/common/utils/openurl"
	"google.golang.org/protobuf/proto"
)

type draftVersionServer struct {
	tree.UnimplementedNodeVersionerServer
	create func(*tree.CreateVersionResponse)
	store  func(*tree.StoreVersionResponse) error
	saved  []*tree.StoreVersionRequest
}

func (s *draftVersionServer) CreateVersion(_ context.Context, request *tree.CreateVersionRequest) (*tree.CreateVersionResponse, error) {
	response := &tree.CreateVersionResponse{Version: &tree.ContentRevision{
		VersionId: request.VersionUuid, Draft: request.Draft, OwnerName: request.OwnerName,
		OwnerUuid: request.OwnerUuid, Location: &tree.Node{Uuid: "native-version-object", Path: "versions/native-object"},
	}}
	response.Version.Location.MustSetMeta(common.MetaNamespaceDatasourceName, "versions")
	if s.create != nil {
		s.create(response)
	}
	return response, nil
}

func (s *draftVersionServer) StoreVersion(_ context.Context, request *tree.StoreVersionRequest) (*tree.StoreVersionResponse, error) {
	s.saved = append(s.saved, proto.Clone(request).(*tree.StoreVersionRequest))
	response := &tree.StoreVersionResponse{Success: true, Version: proto.Clone(request.Version).(*tree.ContentRevision)}
	if s.store != nil {
		if err := s.store(response); err != nil {
			return nil, err
		}
	}
	return response, nil
}

type draftObjectWriter struct {
	nodes.Handler
	err    error
	writes int
	size   int64
}

func (w *draftObjectWriter) PutObject(_ context.Context, _ *tree.Node, reader io.Reader, _ *models.PutRequestData) (models.ObjectInfo, error) {
	w.writes++
	if w.err != nil {
		return models.ObjectInfo{}, w.err
	}
	data, err := io.ReadAll(reader)
	return models.ObjectInfo{ETag: "native-etag", Size: int64(len(data))}, err
}

func (w *draftObjectWriter) MultipartCreate(context.Context, *tree.Node, *models.MultipartRequestData) (string, error) {
	return "native-upload", nil
}

func (w *draftObjectWriter) MultipartComplete(context.Context, *tree.Node, string, []models.MultipartObjectPart) (models.ObjectInfo, error) {
	w.writes++
	return models.ObjectInfo{ETag: "native-etag", Size: w.size}, w.err
}

func draftUploadFixture() (*Handler, context.Context, *tree.Node, *draftVersionServer, *draftObjectWriter) {
	nodes.IsUnitTestEnv = true
	nodes.SetSourcesPoolOpener(func(ctx context.Context) *openurl.Pool[nodes.SourcesPool] {
		return nodes.NewTestPoolWithDataSources(ctx, nil, "versions")
	})
	cachehelper.SetStaticResolver("pm://", &gocache.URLOpener{})
	server := &draftVersionServer{}
	grpcclient.RegisterMock(common.ServiceVersionsGRPC, &tree.NodeVersionerStub{NodeVersionerServer: server})
	writer := &draftObjectWriter{}
	handler := &Handler{}
	handler.Next = writer
	ctx := claim.ToContext(context.Background(), claim.Claims{Name: "native-user", Subject: "native-user-uuid"})
	ctx = nodes.WithBranchInfo(ctx, "in", nodes.BranchInfo{LoadedSource: nodes.LoadedSource{
		DataSource: &object.DataSource{Name: "source", FlatStorage: true},
	}})
	node := &tree.Node{Uuid: "native-node", Path: "source/file.txt", Type: tree.NodeType_LEAF}
	return handler, ctx, node, server, writer
}

func uploadDraft(handler *Handler, ctx context.Context, node *tree.Node, writer *draftObjectWriter, multipart bool, content string) error {
	metadata := map[string]string{common.XAmzMetaPrefix + common.InputDraftMode: "true", common.XAmzMetaPrefix + common.InputVersionId: "native-version"}
	if !multipart {
		_, err := handler.PutObject(ctx, node, strings.NewReader(content), &models.PutRequestData{Size: int64(len(content)), Metadata: metadata})
		return err
	}
	writer.size = int64(len(content))
	uploadID, err := handler.MultipartCreate(ctx, node, &models.MultipartRequestData{Metadata: metadata})
	if err != nil {
		return err
	}
	// Multipart completion is a later native HTTP request. The original
	// WithBranchInfo mutates the current map while routing creation to versions.
	ctx = nodes.WithBranchInfo(ctx, "in", nodes.BranchInfo{LoadedSource: nodes.LoadedSource{
		DataSource: &object.DataSource{Name: "source", FlatStorage: true},
	}}, true)
	_, err = handler.MultipartComplete(ctx, node, uploadID, nil)
	return err
}

func TestDraftUploadRequiresNativePersistence(t *testing.T) {
	for _, multipart := range []bool{false, true} {
		name := "put"
		if multipart {
			name = "multipart"
		}
		t.Run(name, func(t *testing.T) {
			for _, content := range []string{"", "原生 file"} {
				t.Run("content="+content, func(t *testing.T) {
					handler, ctx, node, server, writer := draftUploadFixture()
					if err := uploadDraft(handler, ctx, node, writer, multipart, content); err != nil {
						t.Fatal(err)
					}
					if writer.writes != 1 || len(server.saved) != 1 {
						t.Fatalf("original upload/store did not run exactly once: writes=%d stores=%d", writer.writes, len(server.saved))
					}
					version := server.saved[0].Version
					if server.saved[0].Node.Uuid != node.Uuid || version.VersionId != "native-version" || !version.Draft ||
						version.ETag != "native-etag" || version.Size != int64(len(content)) || version.OwnerUuid != "native-user-uuid" {
						t.Fatalf("stored revision lost original object/owner/content evidence: %v", server.saved[0])
					}
				})
			}
			for _, scenario := range []struct {
				name  string
				store func(*tree.StoreVersionResponse) error
			}{
				{"not stored", func(response *tree.StoreVersionResponse) error { response.Success = false; return nil }},
				{"missing version", func(response *tree.StoreVersionResponse) error { response.Version = nil; return nil }},
				{"other version", func(response *tree.StoreVersionResponse) error {
					response.Version.VersionId = "other-version"
					return nil
				}},
				{"other size", func(response *tree.StoreVersionResponse) error { response.Version.Size++; return nil }},
				{"transport unknown", func(*tree.StoreVersionResponse) error { return errors.New("native acknowledgement unavailable") }},
			} {
				t.Run(scenario.name, func(t *testing.T) {
					handler, ctx, node, server, writer := draftUploadFixture()
					server.store = scenario.store
					if err := uploadDraft(handler, ctx, node, writer, multipart, "file"); err == nil {
						t.Fatal("unproven draft persistence became upload success")
					}
					if writer.writes != 1 || len(server.saved) != 1 {
						t.Fatal("uncertain persistence replayed the original upload/store")
					}
				})
			}
			t.Run("object write error", func(t *testing.T) {
				handler, ctx, node, server, writer := draftUploadFixture()
				failure := errors.New("native object write unavailable")
				writer.err = failure
				if err := uploadDraft(handler, ctx, node, writer, multipart, "file"); !errors.Is(err, failure) {
					t.Fatalf("original object failure was swallowed: %v", err)
				}
				if writer.writes != 1 || len(server.saved) != 0 {
					t.Fatal("failed object write was persisted as a revision or repeated")
				}
			})
			if !multipart {
				t.Run("unknown upload size", func(t *testing.T) {
					handler, ctx, node, server, writer := draftUploadFixture()
					content := "原生 file"
					_, err := handler.PutObject(ctx, node, strings.NewReader(content), &models.PutRequestData{
						Size: -1, Metadata: map[string]string{common.XAmzMetaPrefix + common.InputDraftMode: "true",
							common.XAmzMetaPrefix + common.InputVersionId: "native-version"},
					})
					if err != nil || writer.writes != 1 || len(server.saved) != 1 || server.saved[0].Version.Size != int64(len(content)) {
						t.Fatalf("stored draft did not consume the real completed upload size: err=%v stores=%v", err, server.saved)
					}
				})
			}
		})
	}
}

func TestDraftUploadRejectsUnacknowledgedCreation(t *testing.T) {
	for _, scenario := range []struct {
		name   string
		create func(*tree.CreateVersionResponse)
	}{
		{"ignored", func(response *tree.CreateVersionResponse) { response.Ignored = true }},
		{"missing", func(response *tree.CreateVersionResponse) { response.Version = nil }},
		{"wrong version", func(response *tree.CreateVersionResponse) { response.Version.VersionId = "other-version" }},
		{"published", func(response *tree.CreateVersionResponse) { response.Version.Draft = false }},
		{"missing location", func(response *tree.CreateVersionResponse) { response.Version.Location = nil }},
		{"missing source", func(response *tree.CreateVersionResponse) { response.Version.Location.MetaStore = nil }},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			handler, ctx, node, server, writer := draftUploadFixture()
			server.create = scenario.create
			if err := uploadDraft(handler, ctx, node, writer, false, "file"); err == nil {
				t.Fatal("unacknowledged draft creation reached object upload")
			}
			if writer.writes != 0 || len(server.saved) != 0 {
				t.Fatal("invalid native draft reference caused a write")
			}
		})
	}
}
