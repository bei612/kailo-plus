package core

import (
	"context"
	"errors"
	"io"
	"reflect"
	"strings"
	"testing"

	"google.golang.org/grpc"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/nodes"
	"github.com/pydio/cells/v5/common/nodes/models"
	"github.com/pydio/cells/v5/common/proto/object"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/common/utils/openurl"
)

type revisionCopyReader struct {
	*strings.Reader
	closed int
	read   int
}

func (r *revisionCopyReader) Read(data []byte) (int, error) {
	n, err := r.Reader.Read(data)
	r.read += n
	return n, err
}

func (r *revisionCopyReader) Close() error { r.closed++; return nil }

type revisionCopyClient struct {
	nodes.StorageClient
	reader         *revisionCopyReader
	info           models.ObjectInfo
	getErr, putErr error
	gets, puts     int
	readMeta       models.ReadMeta
	written        string
	writtenSize    int64
}

func (c *revisionCopyClient) GetObject(_ context.Context, _, _ string, meta models.ReadMeta) (io.ReadCloser, models.ObjectInfo, error) {
	c.gets++
	c.readMeta = meta
	if c.reader == nil {
		return nil, c.info, c.getErr
	}
	return c.reader, c.info, c.getErr
}

func (c *revisionCopyClient) PutObject(_ context.Context, _, key string, reader io.Reader, size int64, _ models.PutMeta) (models.ObjectInfo, error) {
	c.puts++
	c.writtenSize = size
	if c.putErr != nil {
		return models.ObjectInfo{}, c.putErr
	}
	body, err := io.ReadAll(reader)
	c.written = string(body)
	return models.ObjectInfo{Key: key, ETag: "new-object-etag", Size: int64(len(body))}, err
}

func TestCopyRevisionPinsOriginalGetBeforeLiveWrite(t *testing.T) {
	for _, scenario := range []string{"revision", "same-client", "empty-file", "multipart-etag", "missing-frozen-etag",
		"negative-frozen-size", "missing-get-etag", "changed-get-etag", "wrong-key", "wrong-size", "get-failure",
		"get-failure-without-reader", "object-error", "missing-reader", "put-failure", "ordinary-copy"} {
		t.Run(scenario, func(t *testing.T) {
			data, etag := "frozen native bytes", "frozen-etag"
			if scenario == "empty-file" {
				data = ""
			}
			if scenario == "multipart-etag" {
				etag = "opaque-multipart-7"
			}
			reader := &revisionCopyReader{Reader: strings.NewReader(data)}
			source := &revisionCopyClient{reader: reader, info: models.ObjectInfo{Key: "versions/object", ETag: etag, Size: int64(len(data))}}
			destination := &revisionCopyClient{}
			if scenario == "same-client" {
				destination = source
			}
			from := &tree.Node{Uuid: "native-source", Size: int64(len(data)), Etag: etag}
			from.MustSetMeta(common.MetaNamespaceDatasourcePath, "versions/object")
			to := &tree.Node{Uuid: "native-live"}
			to.MustSetMeta(common.MetaNamespaceDatasourcePath, "live/object")
			request := &models.CopyRequestData{SrcVersionId: "frozen-version"}
			failure := errors.New("original storage failure")
			switch scenario {
			case "missing-frozen-etag":
				from.Etag = ""
			case "negative-frozen-size":
				from.Size = -1
			case "missing-get-etag":
				source.info.ETag = ""
			case "changed-get-etag":
				source.info.ETag = "replacement-etag"
			case "wrong-key":
				source.info.Key = "versions/another-object"
			case "wrong-size":
				source.info.Size++
			case "get-failure":
				source.getErr = failure
			case "get-failure-without-reader":
				source.getErr, source.reader = failure, nil
			case "object-error":
				source.info.Err = failure
			case "missing-reader":
				source.reader = nil
			case "put-failure":
				destination.putErr = failure
			case "ordinary-copy":
				request.SrcVersionId, source.info.Key, source.info.ETag = "", "", ""
			}
			ctx := nodes.WithBranchInfo(context.Background(), "from", nodes.BranchInfo{LoadedSource: nodes.LoadedSource{
				DataSource: &object.DataSource{Name: "source", ObjectsBucket: "versions"}, Client: source,
			}})
			ctx = nodes.WithBranchInfo(ctx, "to", nodes.BranchInfo{LoadedSource: nodes.LoadedSource{
				DataSource: &object.DataSource{Name: "destination", ObjectsBucket: "files"}, Client: destination,
			}})
			result, err := (&Executor{}).CopyObject(ctx, from, to, request)
			allowed := scenario == "revision" || scenario == "same-client" || scenario == "empty-file" || scenario == "multipart-etag" || scenario == "ordinary-copy"
			if (err == nil) != allowed {
				t.Fatalf("frozen revision outcome changed: result=%v err=%v", result, err)
			}
			wantGets := 1
			if scenario == "missing-frozen-etag" || scenario == "negative-frozen-size" {
				wantGets = 0
			}
			if source.gets != wantGets {
				t.Fatalf("unexpected source dispatches: %d", source.gets)
			}
			wantPuts := 0
			if allowed || scenario == "put-failure" {
				wantPuts = 1
			}
			if destination.puts != wantPuts {
				t.Fatalf("unverified source reached live writer: puts=%d err=%v", destination.puts, err)
			}
			if wantGets == 1 {
				if scenario == "ordinary-copy" {
					if len(source.readMeta) != 0 {
						t.Fatal("ordinary copy gained a revision precondition")
					}
				} else if len(source.readMeta) != 1 || source.readMeta["If-Match"] != "\""+etag+"\"" {
					t.Fatalf("original GET is not conditional on frozen ETag: %v", source.readMeta)
				}
			}
			wantClosed := 0
			if wantGets == 1 && source.reader != nil {
				wantClosed = 1
			}
			if reader.closed != wantClosed {
				t.Fatalf("original source stream not closed exactly once: %d", reader.closed)
			}
			if !allowed && reader.read != 0 {
				t.Fatal("rejected source body was consumed")
			}
			if allowed && (destination.written != data || destination.writtenSize != int64(len(data)) || result.Size != int64(len(data))) {
				t.Fatal("original frozen bytes or zero-size copy changed")
			}
			if (scenario == "get-failure" || scenario == "get-failure-without-reader" || scenario == "object-error" || scenario == "put-failure") && !errors.Is(err, failure) {
				t.Fatalf("original storage error was swallowed: %v", err)
			}
		})
	}
}

type multipartReceiptClient struct {
	nodes.StorageClient
	t                    *testing.T
	etag                 string
	completeErr, statErr error
	info                 models.ObjectInfo
	completes, stats     int
}

func (c *multipartReceiptClient) CompleteMultipartUpload(_ context.Context, bucket, key, upload string, parts []models.MultipartObjectPart) (string, error) {
	c.completes++
	if bucket != "native-bucket" || key != "draft/object" || upload != "native-upload" ||
		len(parts) != 1 || parts[0].PartNumber != 1 || parts[0].ETag != "part-etag" {
		c.t.Fatal("completion lost its original upload and parts")
	}
	return c.etag, c.completeErr
}

func (c *multipartReceiptClient) StatObject(_ context.Context, bucket, key string, _ models.ReadMeta) (models.ObjectInfo, error) {
	c.stats++
	if bucket != "native-bucket" || key != "draft/object" {
		c.t.Fatal("HEAD changed its native object")
	}
	return c.info, c.statErr
}

func TestMultipartCompletionRequiresOriginalObjectReceipt(t *testing.T) {
	for _, scenario := range []string{"complete", "empty-file", "missing-ack-etag", "completion-unknown", "head-unknown", "head-error", "changed-object", "wrong-key", "negative-size", "missing-head-etag"} {
		t.Run(scenario, func(t *testing.T) {
			failure := errors.New("native result unknown")
			client := &multipartReceiptClient{t: t, etag: "native-multipart-etag-2", info: models.ObjectInfo{ETag: "native-multipart-etag-2", Key: "draft/object", Size: 9}}
			switch scenario {
			case "empty-file":
				client.info.Size = 0
			case "missing-ack-etag":
				client.etag = ""
			case "completion-unknown":
				client.completeErr = failure
			case "head-unknown":
				client.statErr = failure
			case "head-error":
				client.info.Err = failure
			case "changed-object":
				client.info.ETag = "another-native-etag-2"
			case "wrong-key":
				client.info.Key = "other/object"
			case "negative-size":
				client.info.Size = -1
			case "missing-head-etag":
				client.info.ETag = ""
			}
			ctx := nodes.WithBranchInfo(context.Background(), "in", nodes.BranchInfo{LoadedSource: nodes.LoadedSource{DataSource: &object.DataSource{ObjectsBucket: "native-bucket"}, Client: client}})
			target := &tree.Node{Uuid: "native-node"}
			target.MustSetMeta(common.MetaNamespaceDatasourcePath, "draft/object")
			result, err := (&Executor{}).MultipartComplete(ctx, target, "native-upload", []models.MultipartObjectPart{{PartNumber: 1, ETag: "part-etag"}})
			allowed := scenario == "complete" || scenario == "empty-file"
			if (err == nil) != allowed || client.completes != 1 {
				t.Fatalf("completion outcome or dispatch count changed: result=%v err=%v calls=%d", result, err, client.completes)
			}
			if allowed && !reflect.DeepEqual(result, client.info) {
				t.Fatal("native object metadata was replaced")
			}
			if !allowed && !reflect.DeepEqual(result, models.ObjectInfo{}) {
				t.Fatal("unknown completion returned successful object evidence")
			}
			if (scenario == "completion-unknown" || scenario == "head-unknown" || scenario == "head-error") && !errors.Is(err, failure) {
				t.Fatal("original native error was lost")
			}
			wantStats := 1
			if scenario == "completion-unknown" || scenario == "missing-ack-etag" {
				wantStats = 0
			}
			if client.stats != wantStats {
				t.Fatalf("unexpected HEAD count: %d", client.stats)
			}
		})
	}
}

type statReadClient struct {
	tree.NodeProviderClient
	request *tree.ReadNodeRequest
	node    *tree.Node
	err     error
}

func (c *statReadClient) ReadNode(_ context.Context, in *tree.ReadNodeRequest, _ ...grpc.CallOption) (*tree.ReadNodeResponse, error) {
	c.request = in
	if c.err != nil {
		return nil, c.err
	}
	return &tree.ReadNodeResponse{Node: c.node.Clone()}, nil
}

func TestExecutorReadNodeDoesNotReuseAncestorMetadataForExplicitStats(t *testing.T) {
	client := &statReadClient{node: &tree.Node{Uuid: "native-node", Path: "native/folder"}}
	client.node.MustSetMeta(common.MetaFlagChildrenCount, 3)
	nodes.SetSourcesPoolOpener(func(ctx context.Context) *openurl.Pool[nodes.SourcesPool] {
		return nodes.NewTestPool(ctx, nodes.MakeFakeClientsPool(client, nil))
	})
	input := &tree.Node{Uuid: "native-node", Path: "native/folder"}
	input.MustSetMeta("pydio:meta-loaded-"+common.ServiceMetaGRPC, true)
	executor := &Executor{}

	t.Run("unqualified read retains the original cloned fast path", func(t *testing.T) {
		response, err := executor.ReadNode(context.Background(), &tree.ReadNodeRequest{Node: input})
		if err != nil || response.Node == input || response.Node.Uuid != input.Uuid || client.request != nil {
			t.Fatalf("unqualified metadata read lost its original fast path: response=%v err=%v", response, err)
		}
	})

	for _, flag := range []uint32{tree.StatFlagFolderCounts, tree.StatFlagFolderSize,
		tree.StatFlagRecursiveCount, tree.StatFlagVersionsAll, tree.StatFlagVersionsDraft,
		tree.StatFlagVersionsPublished, tree.StatFlagMetaMinimal, tree.StatFlagNone} {
		t.Run(tree.Flags{flag}.String(), func(t *testing.T) {
			client.request = nil
			request := &tree.ReadNodeRequest{Node: input, StatFlags: []uint32{flag}}
			response, err := executor.ReadNode(context.Background(), request)
			if err != nil || client.request != request ||
				!reflect.DeepEqual(client.request.StatFlags, request.StatFlags) {
				t.Fatalf("explicit stats were not forwarded to the original native tree client: response=%v err=%v", response, err)
			}
			var count int
			if err := response.Node.GetMeta(common.MetaFlagChildrenCount, &count); err != nil || count != 3 {
				t.Fatalf("native statistics were replaced by ancestor metadata: count=%d err=%v", count, err)
			}
		})
	}

	t.Run("legacy extended statistics reach the original native tree client", func(t *testing.T) {
		client.request = nil
		request := &tree.ReadNodeRequest{Node: input, WithExtendedStats: true}
		response, err := executor.ReadNode(context.Background(), request)
		if err != nil || client.request != request || !client.request.WithExtendedStats {
			t.Fatalf("legacy extended stats were satisfied by unqualified metadata: response=%v err=%v", response, err)
		}
	})

	t.Run("native failure never becomes cached success", func(t *testing.T) {
		client.err = errors.New("native read refused")
		response, err := executor.ReadNode(context.Background(), &tree.ReadNodeRequest{
			Node: input, StatFlags: []uint32{tree.StatFlagFolderCounts},
		})
		if !errors.Is(err, client.err) || response != nil {
			t.Fatalf("native failure became cached success: response=%v err=%v", response, err)
		}
	})
}
