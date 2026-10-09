package grpc

import (
	"context"
	"errors"
	"io"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/auth/claim"
	grpcclient "github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/config"
	nativeerrors "github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/nodes"
	"github.com/pydio/cells/v5/common/nodes/models"
	versionhandler "github.com/pydio/cells/v5/common/nodes/version"
	"github.com/pydio/cells/v5/common/proto/docstore"
	"github.com/pydio/cells/v5/common/proto/object"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/common/runtime/manager"
	"github.com/pydio/cells/v5/common/storage/boltdb"
	"github.com/pydio/cells/v5/common/storage/test"
	"github.com/pydio/cells/v5/common/utils/cache/gocache"
	cachehelper "github.com/pydio/cells/v5/common/utils/cache/helper"
	"github.com/pydio/cells/v5/common/utils/openurl"
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

type nativeReservedObjectWriter struct {
	nodes.Handler
	dao     versions.DAO
	node    string
	writes  int
	ackLost bool
}

type nativeBlockedDraftSweep struct {
	*bolt.BoltStore
	calls      *atomic.Int32
	started    chan struct{}
	finished   chan error
	startOnce  *sync.Once
	finishOnce *sync.Once
}

func (d *nativeBlockedDraftSweep) DraftUploads(ctx context.Context, now time.Time, limit int64) ([]*versions.DraftUpload, error) {
	if d.calls.Add(1) == 1 {
		return d.BoltStore.DraftUploads(ctx, now, limit)
	}
	d.startOnce.Do(func() { close(d.started) })
	<-ctx.Done()
	d.finishOnce.Do(func() { d.finished <- ctx.Err() })
	return nil, ctx.Err()
}

func TestKailoNativeDraftUploadBlockedSweep(t *testing.T) {
	var calls atomic.Int32
	var startOnce, finishOnce sync.Once
	started, finished := make(chan struct{}), make(chan error, 1)
	constructor := func(db boltdb.DB) versions.DAO {
		return &nativeBlockedDraftSweep{BoltStore: bolt.NewBoltStore(db).(*bolt.BoltStore), calls: &calls,
			started: started, finished: finished, startOnce: &startOnce, finishOnce: &finishOnce}
	}
	test.RunStorageTests([]test.StorageTestCase{test.TemplateBoltWithPrefix(constructor, "native_sweep_")}, t, func(ctx context.Context) {
		ctx, cancel := context.WithTimeout(ctx, time.Second)
		defer cancel()
		ctx = claim.ToContext(ctx, claim.Claims{Subject: "native-owner"})
		cachehelper.SetStaticResolver("pm://", &gocache.URLOpener{})
		grpcclient.RegisterMock(common.ServiceDocStoreGRPC, &docstore.DocStoreStub{DocStoreServer: new(versionUploadPolicy)})
		if err := config.Set(ctx, &object.DataSource{Name: "native-source", VersioningPolicyName: "native-blocked-policy"},
			"services", common.ServiceGrpcNamespace_+common.ServiceDataSync_+"native-source"); err != nil {
			t.Error(err)
			return
		}
		delivery := &auth.NativeActorDelivery{DraftUploads: &auth.NativeDraftUploadDelivery{Timeout: "1h", SweepInterval: "1ms", SweepBatchSize: 1}}
		delivery.RequestTimeout = "20ms"
		if err := config.Set(ctx, delivery, "services", common.ServiceRestNamespace_+"n", "platform"); err != nil {
			t.Error(err)
			return
		}
		handler, err := NewHandler(ctx)
		if err != nil {
			t.Error(err)
			return
		}
		if err := handler.StartDraftUploadCleaner(ctx); err != nil {
			t.Error(err)
			return
		}
		select {
		case <-started:
		case <-ctx.Done():
			t.Error("original cleaner never entered its next blocking DAO read")
			return
		}
		if handler.draftCleanerReady.Load() {
			t.Error("blocked cleanup retained previous readiness")
		}
		node := &tree.Node{Uuid: "native-node"}
		node.MustSetMeta(common.MetaNamespaceDatasourceName, "native-source")
		response, err := handler.CreateVersion(ctx, &tree.CreateVersionRequest{Node: node, VersionUuid: "native-upload", OwnerUuid: "native-owner", Draft: true})
		if !nativeerrors.Is(err, nativeerrors.StatusForbidden) || response != nil {
			t.Errorf("blocked cleanup admitted new staging: %v %v", response, err)
		}
		select {
		case err := <-finished:
			if !errors.Is(err, context.DeadlineExceeded) || ctx.Err() != nil {
				t.Errorf("cleanup did not consume its delivered request deadline: %v parent=%v", err, ctx.Err())
			}
		case <-ctx.Done():
			t.Error("native cleanup exceeded its delivered request bound")
		}
	})
}

func (w *nativeReservedObjectWriter) PutObject(ctx context.Context, location *tree.Node, reader io.Reader, _ *models.PutRequestData) (models.ObjectInfo, error) {
	w.writes++
	if _, err := w.dao.GetVersion(ctx, w.node, "native-upload"); !nativeerrors.Is(err, nativeerrors.StatusConflict) {
		return models.ObjectInfo{}, errors.New("original native reservation was absent or readable before the byte writer")
	}
	bytes, err := io.ReadAll(reader)
	if err != nil {
		return models.ObjectInfo{}, err
	}
	if w.ackLost {
		return models.ObjectInfo{}, errors.New("native object write ACK lost after bytes")
	}
	return models.ObjectInfo{ETag: "native-byte-etag", Size: int64(len(bytes))}, nil
}

func TestKailoNativeDraftUploadFirstWriter(t *testing.T) {
	for _, scenario := range []string{"empty", "bytes", "object-ack-lost", "reservation-ack-lost", "missing-cleaner"} {
		t.Run(scenario, func(t *testing.T) {
			test.RunStorageTests([]test.StorageTestCase{test.TemplateBoltWithPrefix(bolt.NewBoltStore, "native_upload_")}, t, func(ctx context.Context) {
				dao, err := manager.Resolve[versions.DAO](ctx)
				if err != nil {
					t.Fatal(err)
				}
				previousUnitTest := nodes.IsUnitTestEnv
				nodes.IsUnitTestEnv = true
				defer func() { nodes.IsUnitTestEnv = previousUnitTest }()
				nodes.SetSourcesPoolOpener(func(ctx context.Context) *openurl.Pool[nodes.SourcesPool] {
					return nodes.NewTestPoolWithDataSources(ctx, nil, "native-versions")
				})
				cachehelper.SetStaticResolver("pm://", &gocache.URLOpener{})
				grpcclient.RegisterMock(common.ServiceDocStoreGRPC, &docstore.DocStoreStub{DocStoreServer: new(versionUploadPolicy)})
				if err := config.Set(ctx, &object.DataSource{Name: "native-source", VersioningPolicyName: "native-upload-policy"},
					"services", common.ServiceGrpcNamespace_+common.ServiceDataSync_+"native-source"); err != nil {
					t.Fatal(err)
				}
				delivery := &auth.NativeActorDelivery{DraftUploads: &auth.NativeDraftUploadDelivery{
					Timeout: "1h", SweepInterval: "1h", SweepBatchSize: 1,
				}}
				delivery.RequestTimeout = "1s"
				if err := config.Set(ctx, delivery, "services", common.ServiceRestNamespace_+"n", "platform"); err != nil {
					t.Fatal(err)
				}
				ctx = claim.ToContext(ctx, claim.Claims{Name: "native-owner", Subject: "native-owner"})
				ctx, cancel := context.WithCancel(ctx)
				defer cancel()
				native, err := NewHandler(ctx)
				if err != nil {
					t.Fatal(err)
				}
				if scenario != "missing-cleaner" {
					if err := native.StartDraftUploadCleaner(ctx); err != nil {
						t.Fatal(err)
					}
				}
				grpcclient.RegisterMock(common.ServiceVersionsGRPC, &tree.NodeVersionerStub{NodeVersionerServer: native})
				makeNode := func() *tree.Node {
					node := &tree.Node{Uuid: "native-node", Path: "native-source/file", Type: tree.NodeType_LEAF, Etag: "old-live-etag", Size: 100}
					node.MustSetMeta(common.MetaNamespaceDatasourceName, "native-source")
					return node
				}
				writer := &nativeReservedObjectWriter{dao: dao, node: "native-node", ackLost: scenario == "object-ack-lost"}
				upload := &versionhandler.Handler{}
				upload.Next = writer
				body := "native bytes"
				if scenario == "empty" {
					body = ""
				}
				if scenario == "reservation-ack-lost" {
					node := makeNode()
					node.Etag, node.Size, node.MTime = "", int64(len(body)), time.Now().Unix()
					response, err := native.CreateVersion(ctx, &tree.CreateVersionRequest{Node: node, VersionUuid: "native-upload", Draft: true, OwnerUuid: "native-owner"})
					if err != nil || response.GetVersion().GetLocation() == nil {
						t.Fatalf("original reservation did not persist: %v %v", response, err)
					}
					// The caller lost this response. Reusing the same reference must
					// never yield its Location to another byte writer.
				}
				put := func() error {
					requestCtx := nodes.WithBranchInfo(ctx, "in", nodes.BranchInfo{LoadedSource: nodes.LoadedSource{
						DataSource: &object.DataSource{Name: "native-source", FlatStorage: true},
					}}, true)
					_, err := upload.PutObject(requestCtx, makeNode(), strings.NewReader(body), &models.PutRequestData{Size: int64(len(body)), Metadata: map[string]string{
						common.XAmzMetaPrefix + common.InputDraftMode: "true", common.XAmzMetaPrefix + common.InputVersionId: "native-upload",
					}})
					return err
				}
				err = put()
				completed := scenario == "empty" || scenario == "bytes"
				if (err == nil) != completed {
					t.Fatalf("native first upload completion mismatch: %v", err)
				}
				if err := put(); err == nil {
					t.Fatal("same native reference permitted another object write")
				}
				expectedWrites := 1
				if scenario == "missing-cleaner" || scenario == "reservation-ack-lost" {
					expectedWrites = 0
				}
				if writer.writes != expectedWrites {
					t.Fatalf("native reservation did not fence actual byte consumer: writes=%d want=%d", writer.writes, expectedWrites)
				}
				stored, err := dao.GetVersion(ctx, "native-node", "native-upload")
				if completed {
					if err != nil || stored.Size != int64(len(body)) || stored.ETag != "native-byte-etag" || stored.OwnerUuid != "native-owner" {
						t.Fatalf("actual native byte ACK was not the readable revision: %v %v", stored, err)
					}
				} else if err == nil {
					t.Fatalf("unknown bytes became a completed revision: %v", stored)
				}
			})
		})
	}
}

type versionUploadPolicy struct {
	docstore.UnimplementedDocStoreServer
}

func (*versionUploadPolicy) GetDocument(context.Context, *docstore.GetDocumentRequest) (*docstore.GetDocumentResponse, error) {
	return &docstore.GetDocumentResponse{Document: &docstore.Document{Data: `{"VersionsDataSourceName":"native-versions"}`}}, nil
}

func TestKailoNativeDraftUploadConfiguration(t *testing.T) {
	for _, tc := range []struct {
		name  string
		value *auth.NativeDraftUploadDelivery
		fail  bool
	}{
		{"read-only", nil, false},
		{"explicit", &auth.NativeDraftUploadDelivery{Timeout: "1h", SweepInterval: "1m", SweepBatchSize: 1}, false},
		{"missing-timeout", &auth.NativeDraftUploadDelivery{SweepInterval: "1m", SweepBatchSize: 1}, true},
		{"invalid-timeout", &auth.NativeDraftUploadDelivery{Timeout: "tomorrow", SweepInterval: "1m", SweepBatchSize: 1}, true},
		{"zero-timeout", &auth.NativeDraftUploadDelivery{Timeout: "0s", SweepInterval: "1m", SweepBatchSize: 1}, true},
		{"missing-interval", &auth.NativeDraftUploadDelivery{Timeout: "1h", SweepBatchSize: 1}, true},
		{"zero-batch", &auth.NativeDraftUploadDelivery{Timeout: "1h", SweepInterval: "1m"}, true},
		{"missing-request-timeout", &auth.NativeDraftUploadDelivery{Timeout: "1h", SweepInterval: "1m", SweepBatchSize: 1}, true},
		{"invalid-request-timeout", &auth.NativeDraftUploadDelivery{Timeout: "1h", SweepInterval: "1m", SweepBatchSize: 1}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx := config.WithStubStore(context.Background())
			delivery := &auth.NativeActorDelivery{DraftUploads: tc.value}
			delivery.RequestTimeout = "1s"
			if tc.name == "missing-request-timeout" {
				delivery.RequestTimeout = ""
			}
			if tc.name == "invalid-request-timeout" {
				delivery.RequestTimeout = "not-a-duration"
			}
			if err := config.Set(ctx, delivery, "services", common.ServiceRestNamespace_+"n", "platform"); err != nil {
				t.Fatal(err)
			}
			handler, err := NewHandler(ctx)
			if (err != nil) != tc.fail {
				t.Fatalf("native configuration did not fail closed: %v", err)
			}
			if !tc.fail && tc.value == nil && handler.draftUploadTimeout != 0 {
				t.Fatal("read-only mode invented an upload deadline")
			}
		})
	}
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
		// Same content may still be a different claimed operation. An explicit
		// native task reference must not disappear behind ordinary ETag dedup.
		node.Etag = revision.ETag
		created, err := handler.CreateVersion(ctx, &tree.CreateVersionRequest{Node: node,
			VersionUuid: "claimed-operation-version", OwnerUuid: "native-owner"})
		if err != nil || created.GetIgnored() || created.GetVersion().GetVersionId() != "claimed-operation-version" {
			t.Errorf("claimed operation was erased by content dedup: response=%v err=%v", created, err)
			return
		}
		ordinary, err := handler.CreateVersion(ctx, &tree.CreateVersionRequest{Node: node})
		if err != nil || !ordinary.GetIgnored() {
			t.Errorf("ordinary native content dedup changed: response=%v err=%v", ordinary, err)
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
