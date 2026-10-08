package core

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"google.golang.org/grpc"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/nodes"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/common/utils/openurl"
)

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
