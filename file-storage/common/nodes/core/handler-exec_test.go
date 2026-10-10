package core

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"google.golang.org/grpc"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/nodes"
	"github.com/pydio/cells/v5/common/nodes/models"
	"github.com/pydio/cells/v5/common/proto/object"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/common/utils/openurl"
)

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
