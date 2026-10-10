/*
 * Copyright (c) 2019-2021. Abstrium SAS <team (at) pydio.com>
 * This file is part of Pydio Cells.
 *
 * Pydio Cells is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Pydio Cells is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Pydio Cells.  If not, see <http://www.gnu.org/licenses/>.
 *
 * The latest code can be found at <https://pydio.com>.
 */

package version

import (
	"context"
	"io"
	"time"

	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth/claim"
	"github.com/pydio/cells/v5/common/client/commons"
	grpc2 "github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/nodes"
	"github.com/pydio/cells/v5/common/nodes/abstract"
	"github.com/pydio/cells/v5/common/nodes/models"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/common/telemetry/log"
	"github.com/pydio/cells/v5/common/utils/cache"
	cache_helper "github.com/pydio/cells/v5/common/utils/cache/helper"
	"github.com/pydio/cells/v5/common/utils/uuid"
)

var (
	partsCacheConf = cache.Config{
		Prefix:      "nodes/multiparts/versions",
		Eviction:    "48h",
		CleanWindow: "24h",
	}
)

func WithVersions() nodes.Option {
	return func(options *nodes.RouterOptions) {
		options.Wrappers = append(options.Wrappers, &Handler{})
	}
}

// Handler capture ListNodes and GetObject calls to find existing nodes versions and retrieve them.
type Handler struct {
	abstract.Handler
	versionClient tree.NodeVersionerClient
}

func (v *Handler) Adapt(c nodes.Handler, options nodes.RouterOptions) nodes.Handler {
	v.AdaptOptions(c, options)
	return v
}

func (v *Handler) getVersionClient(ctx context.Context) tree.NodeVersionerClient {
	return tree.NewNodeVersionerClient(grpc2.ResolveConn(ctx, common.ServiceVersionsGRPC))
}

// ListNodes creates a list of nodes if the Versions are required
func (v *Handler) ListNodes(ctx context.Context, in *tree.ListNodesRequest, opts ...grpc.CallOption) (tree.NodeProvider_ListNodesClient, error) {
	ctx, err := v.WrapContext(ctx)
	if err != nil {
		return nil, err
	}
	if in.WithVersions {
		streamer := nodes.NewWrappingStreamer(ctx)
		resp, e := v.Next.ReadNode(ctx, &tree.ReadNodeRequest{Node: in.Node})
		if e != nil {
			return streamer, e
		}
		versionStream, er := v.getVersionClient(ctx).ListVersions(ctx, &tree.ListVersionsRequest{Node: resp.Node})
		if er != nil {
			return streamer, er
		}
		go func() {
			defer streamer.CloseSend()
			sendErr := commons.ForEach(versionStream, er, func(vResp *tree.ListVersionsResponse) error {
				if vResp.GetVersion().GetVersionId() == "" {
					return errors.WithStack(errors.VersionNotFound)
				}
				if !visibleRevision(ctx, vResp.GetVersion()) {
					return nil
				}
				log.Logger(ctx).Debug("received version", zap.Any("version", vResp))
				vNode := resp.Node.Clone()
				vNode.Etag = vResp.Version.ETag
				vNode.MTime = vResp.Version.MTime
				vNode.Size = vResp.Version.Size
				vNode.MustSetMeta(common.MetaNamespaceVersionId, vResp.Version.VersionId)
				vNode.MustSetMeta(common.MetaNamespaceVersionDesc, vResp.Version.Description)
				if vResp.Version.Draft {
					vNode.MustSetMeta(common.MetaNamespaceVersionDraft, true)
				}
				return streamer.Send(&tree.ListNodesResponse{
					Node: vNode,
				})
			})
			if sendErr != nil {
				_ = streamer.SendError(sendErr)
			}
		}()
		return streamer, nil

	}

	sflags := tree.StatFlags(in.GetStatFlags())
	if sflags.Versions() {
		streamer := nodes.NewWrappingStreamer(ctx)
		st, e := v.Next.ListNodes(ctx, in, opts...)
		if e != nil {
			return st, e
		}
		go func() {
			defer streamer.CloseSend()
			sendErr := commons.ForEach(st, e, func(vResp *tree.ListNodesResponse) error {
				vNode := vResp.GetNode().Clone()
				var ff map[string]string
				if filter := sflags.VersionsFilter(); filter != "" {
					ff = map[string]string{"draftStatus": "\"" + filter + "\""}
				}
				versionStream, er := v.getVersionClient(ctx).ListVersions(ctx, &tree.ListVersionsRequest{Node: vResp.GetNode(), Filters: ff})
				var vv []*tree.ContentRevision
				if ver := commons.ForEach(versionStream, er, func(vResp *tree.ListVersionsResponse) error {
					if vResp.GetVersion().GetVersionId() == "" {
						return errors.WithStack(errors.VersionNotFound)
					}
					if visibleRevision(ctx, vResp.GetVersion()) {
						vv = append(vv, vResp.GetVersion())
					}
					return nil
				}); ver != nil {
					return ver
				}
				if len(vv) > 0 {
					vNode.MustSetMeta(common.MetaNamespaceContentRevisions, vv)
				}
				return streamer.Send(&tree.ListNodesResponse{Node: vNode})
			})
			if sendErr != nil {
				log.Logger(ctx).Error("handler-version failed to send node to streamer", zap.Error(sendErr))
				_ = streamer.SendError(sendErr)
			}
		}()

		return streamer, nil
	}

	return v.Next.ListNodes(ctx, in, opts...)

}

// ReadNode retrieves information about a specific version
func (v *Handler) ReadNode(ctx context.Context, req *tree.ReadNodeRequest, opts ...grpc.CallOption) (*tree.ReadNodeResponse, error) {

	if vId := req.Node.GetStringMeta(common.MetaNamespaceVersionId); vId != "" {
		// Load Info from Version Service?
		log.Logger(ctx).Debug("Reading Node with Version ID", zap.String("versionId", vId))
		node := req.Node
		if len(node.Uuid) == 0 {
			resp, e := v.Next.ReadNode(ctx, &tree.ReadNodeRequest{Node: node})
			if e != nil {
				return nil, e
			}
			node = resp.Node
		}
		log.Logger(ctx).Debug("Reading Node with Version ID - Found node")
		vResp, err := v.getVersionClient(ctx).HeadVersion(ctx, &tree.HeadVersionRequest{NodeUuid: node.GetUuid(), VersionId: vId})
		if err != nil {
			return nil, err
		}
		if vResp.GetVersion().GetVersionId() != vId || !visibleRevision(ctx, vResp.GetVersion()) {
			return nil, errors.WithStack(errors.VersionNotFound)
		}
		log.Logger(ctx).Debug("Reading Node with Version ID - Found version", zap.Any("version", vResp.Version))
		node = node.Clone()
		node.Etag = vResp.Version.ETag
		node.MTime = vResp.Version.MTime
		node.Size = vResp.Version.Size
		return &tree.ReadNodeResponse{Node: node}, nil

	}

	sflags := tree.StatFlags(req.GetStatFlags())
	if sflags.Versions() {

		resp, er := v.Next.ReadNode(ctx, req, opts...)
		if er != nil {
			return nil, er
		}
		respNode := resp.GetNode().Clone()
		var ff map[string]string
		if filter := sflags.VersionsFilter(); filter != "" {
			ff = map[string]string{"draftStatus": "\"" + filter + "\""}
		}
		versionStream, er := v.getVersionClient(ctx).ListVersions(ctx, &tree.ListVersionsRequest{Node: resp.GetNode(), Filters: ff})
		var vv []*tree.ContentRevision
		if ver := commons.ForEach(versionStream, er, func(vResp *tree.ListVersionsResponse) error {
			if vResp.GetVersion().GetVersionId() == "" {
				return errors.WithStack(errors.VersionNotFound)
			}
			if visibleRevision(ctx, vResp.GetVersion()) {
				vv = append(vv, vResp.GetVersion())
			}
			return nil
		}); ver != nil {
			return nil, ver
		}
		if len(vv) > 0 {
			respNode.MustSetMeta(common.MetaNamespaceContentRevisions, vv)
		}
		return &tree.ReadNodeResponse{Node: respNode}, nil
	}

	return v.Next.ReadNode(ctx, req, opts...)
}

// GetObject redirects to Version Store if request contains a VersionID
func (v *Handler) GetObject(ctx context.Context, node *tree.Node, requestData *models.GetRequestData) (io.ReadCloser, error) {
	ctx, err := v.WrapContext(ctx)
	if err != nil {
		return nil, err
	}
	if len(requestData.VersionId) > 0 {

		// We are trying to load a specific versionId => switch to vID store
		if len(node.Uuid) == 0 {
			resp, e := v.Next.ReadNode(ctx, &tree.ReadNodeRequest{Node: node})
			if e != nil {
				return nil, e
			}
			node = resp.Node
		}
		vResp, err := v.getVersionClient(ctx).HeadVersion(ctx, &tree.HeadVersionRequest{NodeUuid: node.GetUuid(), VersionId: requestData.VersionId})
		if err != nil {
			return nil, err
		}
		if vResp.GetVersion().GetVersionId() != requestData.VersionId || !visibleRevision(ctx, vResp.GetVersion()) ||
			vResp.GetVersion().GetLocation().GetPath() == "" || vResp.GetVersion().GetLocation().GetStringMeta(common.MetaNamespaceDatasourceName) == "" {
			return nil, errors.WithStack(errors.VersionNotFound)
		}
		node = vResp.Version.GetLocation().Clone()
		// Append Version information
		node.Size = vResp.Version.Size
		node.Etag = vResp.Version.ETag
		node.MTime = vResp.Version.MTime
		// Refresh context from location
		dsName := node.GetStringMeta(common.MetaNamespaceDatasourceName)
		source, e := nodes.GetSourcesPool(ctx).GetDataSourceInfo(dsName)
		if e != nil {
			return nil, e
		}
		branchInfo := nodes.BranchInfo{LoadedSource: source}
		ctx = nodes.WithBranchInfo(ctx, "in", branchInfo)
		log.Logger(ctx).Debug("GetObject With VersionId", zap.Any("node", node))
	}
	return v.Next.GetObject(ctx, node, requestData)

}

// CopyObject intercept request with a SrcVersionId to read original from Version Store
func (v *Handler) CopyObject(ctx context.Context, from *tree.Node, to *tree.Node, requestData *models.CopyRequestData) (models.ObjectInfo, error) {
	ctx, err := v.WrapContext(ctx)
	if err != nil {
		return models.ObjectInfo{}, err
	}
	log.Logger(ctx).Debug("CopyObject Has VersionId?", zap.Any("from", from), zap.Any("to", to), zap.Any("requestData", requestData))
	if len(requestData.SrcVersionId) > 0 {

		// We are trying to load a specific versionId => switch to vID store
		if len(from.Uuid) == 0 {
			resp, e := v.Next.ReadNode(ctx, &tree.ReadNodeRequest{Node: from})
			if e != nil {
				return models.ObjectInfo{}, e
			}
			from = resp.Node
		}
		vResp, err := v.getVersionClient(ctx).HeadVersion(ctx, &tree.HeadVersionRequest{NodeUuid: from.GetUuid(), VersionId: requestData.SrcVersionId})
		if err != nil {
			return models.ObjectInfo{}, err
		}
		if vResp.GetVersion().GetVersionId() != requestData.SrcVersionId || !visibleRevision(ctx, vResp.GetVersion()) ||
			vResp.GetVersion().GetLocation().GetPath() == "" || vResp.GetVersion().GetLocation().GetStringMeta(common.MetaNamespaceDatasourceName) == "" {
			return models.ObjectInfo{}, errors.WithStack(errors.VersionNotFound)
		}
		if requestData.Metadata == nil {
			requestData.Metadata = make(map[string]string, 1)
		}
		requestData.Metadata[common.XAmzMetaNodeUuid] = from.Uuid // Make sure to keep Uuid!
		if h := vResp.GetVersion().GetContentHash(); h != "" {
			// log.Logger(ctx).Info("Setting MetaNamespaceHash in CopyRequest meta")
			requestData.Metadata[common.MetaNamespaceHash] = h
		}
		from = vResp.GetVersion().GetLocation().Clone()
		from.Size = vResp.Version.Size
		from.Etag = vResp.Version.ETag
		from.MTime = vResp.Version.MTime
		// Refresh context from location
		source, e := nodes.GetSourcesPool(ctx).GetDataSourceInfo(from.GetStringMeta(common.MetaNamespaceDatasourceName))
		if e != nil {
			return models.ObjectInfo{}, e
		}
		srcInfo := nodes.BranchInfo{LoadedSource: source}
		ctx = nodes.WithBranchInfo(ctx, "from", srcInfo)
		log.Logger(ctx).Debug("CopyObject With VersionId", zap.Any("from", from), zap.Any("branchInfo", srcInfo), zap.Any("to", to))
	}

	return v.Next.CopyObject(ctx, from, to, requestData)
}

// Preserve the native NodeVersions rule for every original revision reader:
// published history follows node ACLs; drafts belong to their native owner.
// A known version ID is not an alternate grant to another user's draft.
func visibleRevision(ctx context.Context, revision *tree.ContentRevision) bool {
	if revision == nil {
		return false
	}
	if !revision.Draft {
		return true
	}
	claims, ok := claim.FromContext(ctx)
	return ok && claims.Subject != "" && claims.Subject == revision.OwnerUuid
}

func (v *Handler) PutObject(ctx context.Context, node *tree.Node, reader io.Reader, requestData *models.PutRequestData) (models.ObjectInfo, error) {
	ctx, err := v.WrapContext(ctx)
	if err != nil {
		return models.ObjectInfo{}, err
	}
	if !nodes.IsFlatStorage(ctx, "in") {
		return v.Next.PutObject(ctx, node, reader, requestData)
	}

	if requestData.Metadata[common.XAmzMetaPrefix+common.InputDraftMode] == "true" {
		nodes.MustEnsureDatasourceMeta(ctx, node, "in")
		newTarget, revision, source, er := v.routeUploadToContentRevision(ctx, node.Clone(), requestData.Metadata, requestData.Size)
		if er != nil {
			return models.ObjectInfo{}, er
		}
		ctx = nodes.WithBranchInfo(ctx, "in", nodes.BranchInfo{LoadedSource: source})
		log.Logger(ctx).Info("PutObject With VersionId "+revision.VersionId+" will update to new target in "+source.Name, revision.Zap(), newTarget.Zap())
		oi, er := v.Next.PutObject(ctx, newTarget, reader, requestData)
		if er != nil {
			return models.ObjectInfo{}, er
		}
		revision.ETag = oi.ETag
		revision.Size = oi.Size
		if ex, o := reader.(common.ReaderMetaExtractor); o {
			if mm, ok := ex.ExtractedMeta(); ok && mm[common.MetaNamespaceHash] != "" {
				log.Logger(ctx).Debug("Update revision with computed Hash" + mm[common.MetaNamespaceHash])
				revision.ContentHash = mm[common.MetaNamespaceHash]
			}
		}
		// Now store version
		er = v.storeDraftVersion(ctx, node, revision)

		return oi, er

	}
	return v.Next.PutObject(ctx, node, reader, requestData)
}

func (v *Handler) MultipartCreate(ctx context.Context, node *tree.Node, requestData *models.MultipartRequestData) (string, error) {

	if nodes.IsFlatStorage(ctx, "in") && requestData.Metadata[common.XAmzMetaPrefix+common.InputDraftMode] == "true" {
		nodes.MustEnsureDatasourceMeta(ctx, node, "in")
		target, revision, source, er := v.routeUploadToContentRevision(ctx, node.Clone(), requestData.Metadata, 0)
		if er != nil {
			return "", er
		}
		ctx = nodes.WithBranchInfo(ctx, "in", nodes.BranchInfo{LoadedSource: source})
		uploadId, err := v.Next.MultipartCreate(ctx, target, requestData)
		if err != nil {
			return "", err
		}
		ca, er := v.multipartCache(ctx)
		if er != nil {
			return "", er
		}
		if er = v.cacheProto(ca, uploadId+"-target", target); er != nil {
			return "", er
		}
		if er = v.cacheProto(ca, uploadId+"-revision", revision); er != nil {
			return "", er
		}
		log.Logger(ctx).Debug("Create " + uploadId + " on " + target.GetPath())
		return uploadId, nil
	}
	return v.Next.MultipartCreate(ctx, node, requestData)
}

func (v *Handler) MultipartPutObjectPart(ctx context.Context, target *tree.Node, uploadID string, partNumberMarker int, reader io.Reader, requestData *models.PutRequestData) (models.MultipartObjectPart, error) {
	log.Logger(ctx).Debug("Receive ObjectPart " + uploadID + " on " + target.GetPath())
	if nodes.IsFlatStorage(ctx, "in") {
		ca, er := v.multipartCache(ctx)
		if er != nil {
			return models.MultipartObjectPart{}, er
		}
		newTarget, _, source, er := v.multipartDraft(ctx, ca, uploadID)
		if er != nil {
			return models.MultipartObjectPart{}, er
		}
		if newTarget != nil {
			log.Logger(ctx).Debug("Switching PutObjectPart target", newTarget.Zap("newTarget"))
			ctx = nodes.WithBranchInfo(ctx, "in", nodes.BranchInfo{LoadedSource: source})
			return v.Next.MultipartPutObjectPart(ctx, newTarget, uploadID, partNumberMarker, reader, requestData)
		}
	}
	return v.Next.MultipartPutObjectPart(ctx, target, uploadID, partNumberMarker, reader, requestData)
}

// The original uploader resumes a draft with ListObjectParts before sending
// the remaining parts. Listing must use the same native location as writing.
func (v *Handler) MultipartListObjectParts(ctx context.Context, target *tree.Node, uploadID string, partNumberMarker int, maxParts int) (models.ListObjectPartsResult, error) {
	if nodes.IsFlatStorage(ctx, "in") {
		ca, er := v.multipartCache(ctx)
		if er != nil {
			return models.ListObjectPartsResult{}, er
		}
		newTarget, _, source, er := v.multipartDraft(ctx, ca, uploadID)
		if er != nil {
			return models.ListObjectPartsResult{}, er
		}
		if newTarget != nil {
			ctx = nodes.WithBranchInfo(ctx, "in", nodes.BranchInfo{LoadedSource: source})
			return v.Next.MultipartListObjectParts(ctx, newTarget, uploadID, partNumberMarker, maxParts)
		}
	}
	return v.Next.MultipartListObjectParts(ctx, target, uploadID, partNumberMarker, maxParts)
}

func (v *Handler) MultipartComplete(ctx context.Context, target *tree.Node, uploadID string, uploadedParts []models.MultipartObjectPart) (models.ObjectInfo, error) {
	if nodes.IsFlatStorage(ctx, "in") {
		ca, er := v.multipartCache(ctx)
		if er != nil {
			return models.ObjectInfo{}, er
		}
		newTarget, revision, source, er := v.multipartDraft(ctx, ca, uploadID)
		if er != nil {
			return models.ObjectInfo{}, er
		}
		if newTarget != nil {
			nodes.MustEnsureDatasourceMeta(ctx, target, "in")
			ctx = nodes.WithBranchInfo(ctx, "in", nodes.BranchInfo{LoadedSource: source})
			log.Logger(ctx).Info("Switching MultipartComplete target", newTarget.Zap("newTarget"))
			oi, e := v.Next.MultipartComplete(ctx, newTarget, uploadID, uploadedParts)
			if e != nil {
				return oi, e
			}
			// Now update ETag and Store revision
			revision.ETag = oi.ETag
			revision.Size = oi.Size
			revision.ContentHash = target.GetStringMeta(common.MetaNamespaceHash)
			er = v.storeDraftVersion(ctx, target, revision)
			if er != nil {
				return oi, er
			}
			// A lost object or Version acknowledgement must not discard the
			// original draft route and make a later request use the live node.
			// Retaining the mapping is not permission to replay completion.
			_ = ca.Delete(uploadID + "-target")
			_ = ca.Delete(uploadID + "-revision")
			return oi, nil
		}
	}

	return v.Next.MultipartComplete(ctx, target, uploadID, uploadedParts)
}

// Both original upload paths require the exact native revision acknowledgement.
// A disabled policy returns Success=false, not proof that a draft was stored.
// Storage/transport failures leave the already-attempted write uncertain; this
// helper does not repeat the object upload or synthesize a revision.
func (v *Handler) storeDraftVersion(ctx context.Context, node *tree.Node, revision *tree.ContentRevision) error {
	response, err := v.getVersionClient(ctx).StoreVersion(ctx, &tree.StoreVersionRequest{Node: node, Version: revision})
	if err != nil {
		return err
	}
	if !response.GetSuccess() || !proto.Equal(response.GetVersion(), revision) {
		return errors.WithMessage(errors.VersionNotFound, "draft revision persistence was not acknowledged")
	}
	return nil
}

func (v *Handler) MultipartAbort(ctx context.Context, target *tree.Node, uploadID string, requestData *models.MultipartRequestData) error {
	if nodes.IsFlatStorage(ctx, "in") {
		ca, er := v.multipartCache(ctx)
		if er != nil {
			return er
		}
		newTarget, _, source, er := v.multipartDraft(ctx, ca, uploadID)
		if er != nil {
			return er
		}
		if newTarget != nil {
			log.Logger(ctx).Info("Switching MultipartAbort target", newTarget.Zap("newTarget"))
			ctx = nodes.WithBranchInfo(ctx, "in", nodes.BranchInfo{LoadedSource: source})
			if err := v.Next.MultipartAbort(ctx, newTarget, uploadID, requestData); err != nil {
				return err
			}
			_ = ca.Delete(uploadID + "-target")
			_ = ca.Delete(uploadID + "-revision")
			return nil
		}
	}
	return v.Next.MultipartAbort(ctx, target, uploadID, requestData)
}

// A present but partial/corrupt draft route is not a normal live-node upload.
// Reuse the original cache and revision owner; this does not turn the cache
// into a durable execution receipt or authorize replay after a lost ACK.
func (v *Handler) multipartDraft(ctx context.Context, ca cache.Cache, uploadID string) (*tree.Node, *tree.ContentRevision, nodes.LoadedSource, error) {
	var targetBytes, revisionBytes []byte
	hasTarget := ca.Get(uploadID+"-target", &targetBytes)
	hasRevision := ca.Get(uploadID+"-revision", &revisionBytes)
	if !hasTarget && !hasRevision {
		return nil, nil, nodes.LoadedSource{}, nil
	}
	target, revision := &tree.Node{}, &tree.ContentRevision{}
	if !hasTarget || !hasRevision || proto.Unmarshal(targetBytes, target) != nil || proto.Unmarshal(revisionBytes, revision) != nil ||
		target.GetPath() == "" || target.GetStringMeta(common.MetaNamespaceDatasourceName) == "" ||
		revision.GetVersionId() == "" || !revision.GetDraft() || !proto.Equal(revision.GetLocation(), target) {
		return nil, nil, nodes.LoadedSource{}, errors.WithMessage(errors.VersionNotFound, "multipart draft route is incomplete or invalid")
	}
	if !visibleRevision(ctx, revision) {
		return nil, nil, nodes.LoadedSource{}, errors.WithStack(errors.StatusForbidden)
	}
	source, err := nodes.GetSourcesPool(ctx).GetDataSourceInfo(target.GetStringMeta(common.MetaNamespaceDatasourceName))
	if err != nil {
		return nil, nil, nodes.LoadedSource{}, err
	}
	return target, revision, source, nil
}

func (v *Handler) routeUploadToContentRevision(ctx context.Context, node *tree.Node, userMeta map[string]string, knownSize int64) (*tree.Node, *tree.ContentRevision, nodes.LoadedSource, error) {
	versionId := userMeta[common.XAmzMetaPrefix+common.InputVersionId]
	if versionId == "" {
		versionId = uuid.New()
	}
	// Freeze the upload input before CreateVersion. In platform mode that
	// original RPC durably claims this native reference before any bytes move.
	// The old live node's ETag/size are not an upload result.
	node.Etag, node.Size, node.MTime = "", knownSize, time.Now().Unix()
	claims, ok := claim.FromContext(ctx)
	if !ok {
		return nil, nil, nodes.LoadedSource{}, errors.WithStack(errors.MissingClaims)
	}
	vr, er := v.getVersionClient(ctx).CreateVersion(ctx, &tree.CreateVersionRequest{
		Node:         node,
		VersionUuid:  versionId,
		OwnerName:    claims.Name,
		OwnerUuid:    claims.Subject,
		Draft:        true,
		TriggerEvent: &tree.NodeChangeEvent{Type: tree.NodeChangeEvent_CREATE, Target: node},
	})
	if er != nil {
		return nil, nil, nodes.LoadedSource{}, er
	}
	revision := vr.GetVersion()
	if vr.GetIgnored() || revision == nil || revision.VersionId != versionId || !revision.Draft ||
		revision.Location == nil || revision.Location.Path == "" || revision.Location.GetStringMeta(common.MetaNamespaceDatasourceName) == "" {
		return nil, nil, nodes.LoadedSource{}, errors.WithMessage(errors.VersionNotFound, "draft revision creation was not acknowledged")
	}
	// Refresh target and context from location
	newTarget := vr.GetVersion().GetLocation()
	source, e := nodes.GetSourcesPool(ctx).GetDataSourceInfo(newTarget.GetStringMeta(common.MetaNamespaceDatasourceName))
	return newTarget, revision, source, e

}

// multipartCache initializes a cache for multipart hashes
func (v *Handler) multipartCache(ctx context.Context) (c cache.Cache, e error) {
	return cache_helper.ResolveCache(ctx, common.CacheTypeShared, partsCacheConf)
}

func (v *Handler) cacheProto(c cache.Cache, k string, m proto.Message) error {
	bb, er := proto.Marshal(m)
	if er != nil {
		return er
	}
	return c.Set(k, bb)
}
