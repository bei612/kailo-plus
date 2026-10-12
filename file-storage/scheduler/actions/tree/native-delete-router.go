package tree

import (
	"context"

	"github.com/pydio/cells/v5/common/nodes"
	"github.com/pydio/cells/v5/common/nodes/models"
	"github.com/pydio/cells/v5/common/proto/tree"
	jobstore "github.com/pydio/cells/v5/scheduler/jobs"
	"google.golang.org/grpc"
)

// Preserve the original router (including Client branch/ACL behavior), while
// the native recycle implementation freshly checks every actual write call.
type nativeDeleteRouter struct{ nodes.Client }

func (r nativeDeleteRouter) CreateNode(ctx context.Context, request *tree.CreateNodeRequest, options ...grpc.CallOption) (*tree.CreateNodeResponse, error) {
	if err := jobstore.FreshNativeDeleteStep(ctx, true); err != nil {
		return nil, err
	}
	return r.Client.CreateNode(ctx, request, options...)
}
func (r nativeDeleteRouter) UpdateNode(ctx context.Context, request *tree.UpdateNodeRequest, options ...grpc.CallOption) (*tree.UpdateNodeResponse, error) {
	if err := jobstore.FreshNativeDeleteStep(ctx, true); err != nil {
		return nil, err
	}
	return r.Client.UpdateNode(ctx, request, options...)
}
func (r nativeDeleteRouter) DeleteNode(ctx context.Context, request *tree.DeleteNodeRequest, options ...grpc.CallOption) (*tree.DeleteNodeResponse, error) {
	if err := jobstore.FreshNativeDeleteStep(ctx, true); err != nil {
		return nil, err
	}
	return r.Client.DeleteNode(ctx, request, options...)
}
func (r nativeDeleteRouter) CopyObject(ctx context.Context, from, to *tree.Node, request *models.CopyRequestData) (models.ObjectInfo, error) {
	if err := jobstore.FreshNativeDeleteStep(ctx, true); err != nil {
		return models.ObjectInfo{}, err
	}
	return r.Client.CopyObject(ctx, from, to, request)
}
