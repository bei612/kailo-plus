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

package grpc

import (
	"context"
	"net/url"
	"slices"
	"sync"
	"sync/atomic"
	"time"

	"go.uber.org/zap"

	"github.com/pydio/cells/v5/broker/activity"
	"github.com/pydio/cells/v5/broker/activity/render"
	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/auth/claim"
	"github.com/pydio/cells/v5/common/client/commons"
	"github.com/pydio/cells/v5/common/client/commons/docstorec"
	"github.com/pydio/cells/v5/common/client/commons/treec"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/errors"
	activity2 "github.com/pydio/cells/v5/common/proto/activity"
	"github.com/pydio/cells/v5/common/proto/docstore"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/common/runtime/manager"
	"github.com/pydio/cells/v5/common/telemetry/log"
	"github.com/pydio/cells/v5/common/utils/i18n/languages"
	json "github.com/pydio/cells/v5/common/utils/jsonx"
	"github.com/pydio/cells/v5/common/utils/uuid"
	"github.com/pydio/cells/v5/data/versions"
)

type Handler struct {
	tree.UnimplementedNodeVersionerServer
	draftUploadTimeout  time.Duration
	draftSweepInterval  time.Duration
	draftSweepTimeout   time.Duration
	draftSweepBatchSize int64
	draftCleanerReady   atomic.Bool
}

func NewHandler(ctx context.Context) (*Handler, error) {
	handler := new(Handler)
	value := config.Get(ctx, "services", common.ServiceRestNamespace_+"n", "platform")
	if value.Get() == nil {
		return handler, nil
	}
	var delivery auth.NativeActorDelivery
	if err := value.Scan(&delivery); err != nil {
		return nil, errors.WithStack(errors.InvalidParameters)
	}
	if delivery.DraftUploads == nil {
		return handler, nil // Existing read-only native binding stays read-only.
	}
	timeout, interval, err := delivery.DraftUploads.Durations()
	if err != nil {
		return nil, err
	}
	requestTimeout, err := time.ParseDuration(delivery.RequestTimeout)
	if err != nil || requestTimeout <= 0 {
		return nil, errors.WithMessage(errors.InvalidParameters, "native cleanup requires the delivered request timeout")
	}
	handler.draftUploadTimeout, handler.draftSweepInterval = timeout, interval
	handler.draftSweepTimeout = requestTimeout
	handler.draftSweepBatchSize = delivery.DraftUploads.SweepBatchSize
	return handler, nil
}

// The original native Version service owns cleanup of its upload rows. The
// configured interval is frozen at service start; enabling/changing it requires
// the existing controlled restart, not a runtime bypass switch. Read traffic
// remains available while uncertain cleanup refuses admission of new bytes.
func (h *Handler) StartDraftUploadCleaner(ctx context.Context) error {
	if h.draftUploadTimeout <= 0 {
		return nil
	}
	dao, err := manager.Resolve[versions.DAO](ctx)
	if err != nil {
		return err
	}
	sweep := func() {
		h.draftCleanerReady.Store(false)
		sweepCtx, cancel := context.WithTimeout(ctx, h.draftSweepTimeout)
		defer cancel()
		err := versions.PruneDraftUploads(sweepCtx, dao, time.Now(), h.draftSweepBatchSize)
		if err == nil {
			err = sweepCtx.Err()
		}
		h.draftCleanerReady.Store(err == nil)
		if err != nil {
			log.Logger(ctx).Error("Native draft cleanup uncertain; new draft staging refused", zap.Error(err))
		}
	}
	sweep()
	go func() {
		timer := time.NewTicker(h.draftSweepInterval)
		defer timer.Stop()
		defer h.draftCleanerReady.Store(false)
		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
				sweep()
			}
		}
	}()
	return nil
}

func (h *Handler) buildVersionDescription(ctx context.Context, version *tree.ContentRevision) string {
	var description string
	if version.OwnerName != "" && version.Event != nil {
		serverLinks := render.NewServerLinks()
		serverLinks.URLS[render.ServerUrlTypeUsers], _ = url.Parse("user://")
		ac, _ := activity.DocumentActivity(version.OwnerName, version.Event)
		description = render.Markdown(ac, activity2.SummaryPointOfView_SUBJECT, languages.UserLanguageFromContext(ctx, true), serverLinks)
	} else {
		description = "N/A"
	}
	return description
}

func (h *Handler) ListVersions(request *tree.ListVersionsRequest, versionsStream tree.NodeVersioner_ListVersionsServer) error {

	ctx := versionsStream.Context()

	dao, err := manager.Resolve[versions.DAO](ctx)
	if err != nil {
		return err
	}

	log.Logger(ctx).Debug("[VERSION] ListVersions for node ", request.Node.Zap())
	node := request.GetNode()
	head, err := latestPublishedVersion(ctx, dao, node.GetUuid())
	if err != nil {
		return err
	}
	var filters map[string]any
	authorized := []string{"draftStatus", "ownerUuid"}
	if len(request.Filters) > 0 {
		filters = make(map[string]any, len(request.Filters))
		for k, js := range request.Filters {
			if !slices.Contains(authorized, k) {
				return errors.WithMessage(errors.InvalidParameters, "unauthorized filtering key "+k)
			}
			var v any
			if er := json.Unmarshal([]byte(js), &v); er == nil {
				filters[k] = v
			} else {
				return errors.WithMessage(errors.InvalidParameters, "filtering value must be JSON-encoded")
			}
		}
	}

	logs, err := dao.GetVersions(ctx, node.GetUuid(), request.GetOffset(), request.GetLimit(), request.GetSortField(), request.GetSortDesc(), filters)
	if err != nil {
		return err
	}

	for l := range logs {
		// Existing IsHead previously had no producer. The original native
		// store selects a real latest published reference; the API's actual
		// ACL-checked node must additionally match its content (not its mtime).
		l.IsHead = head != nil && l.VersionId == head.VersionId && l.MatchesCurrentNode(node)
		if l.GetLocation() == nil {
			l.Location = versions.DefaultLocation(ctx, request.Node.Uuid, l.VersionId)
		}
		l.Description = h.buildVersionDescription(ctx, l)
		resp := &tree.ListVersionsResponse{Version: l}
		e := versionsStream.Send(resp)
		log.Logger(ctx).Debug("[VERSION] Sending version ", zap.Any("resp", resp), zap.Error(e))
	}
	return nil
}

func (h *Handler) HeadVersion(ctx context.Context, request *tree.HeadVersionRequest) (*tree.HeadVersionResponse, error) {

	dao, err := manager.Resolve[versions.DAO](ctx)
	if err != nil {
		return nil, err
	}

	v, e := dao.GetVersion(ctx, request.GetNodeUuid(), request.GetVersionId())
	if e != nil {
		return nil, e
	}
	if v == nil || v.VersionId == "" || v.VersionId != request.GetVersionId() {
		return nil, errors.WithStack(errors.VersionNotFound)
	}
	head, err := latestPublishedVersion(ctx, dao, request.GetNodeUuid())
	if err != nil {
		return nil, err
	}
	v.IsHead = head != nil && !v.Draft && v.VersionId == head.VersionId
	if v.GetLocation() == nil {
		v.Location = versions.DefaultLocation(ctx, request.GetNodeUuid(), v.VersionId)
	}
	return &tree.HeadVersionResponse{Version: v}, nil
}

// Both fixed native stores return GetVersions in their original descending
// insertion order. Drain the native stream (Bolt otherwise retains its read
// transaction), selecting its first published reference rather than sorting or
// inventing a head from a timestamp/content hash in the platform.
func latestPublishedVersion(ctx context.Context, dao versions.DAO, nodeID string) (*tree.ContentRevision, error) {
	stream, err := dao.GetVersions(ctx, nodeID, 0, 0, "", true, map[string]any{"draftStatus": "published"})
	if err != nil {
		return nil, err
	}
	var head *tree.ContentRevision
	var failure error
	for revision := range stream {
		if failure == nil && ctx.Err() != nil {
			failure = ctx.Err()
		}
		if revision == nil || revision.VersionId == "" || revision.Draft {
			if failure == nil {
				failure = errors.WithStack(errors.VersionNotFound)
			}
			continue
		}
		if head == nil {
			head = revision
		}
	}
	return head, failure
}

func (h *Handler) DeleteVersion(ctx context.Context, request *tree.HeadVersionRequest) (*tree.DeleteVersionResponse, error) {

	dao, err := manager.Resolve[versions.DAO](ctx)
	if err != nil {
		return nil, err
	}
	v, e := dao.GetVersion(ctx, request.GetNodeUuid(), request.GetVersionId())
	if e != nil {
		return nil, e
	}
	nUuid := request.GetNodeUuid()
	e = dao.DeleteVersionsForNode(ctx, nUuid, request.GetVersionId())
	if e != nil {
		return nil, e
	}
	var newHead string
	if lv, er := dao.GetLastVersion(ctx, nUuid); er == nil {
		newHead = lv.GetVersionId()
	}
	return &tree.DeleteVersionResponse{DeletedVersion: v, Success: true, NewHead: newHead}, nil
}

func (h *Handler) CreateVersion(ctx context.Context, request *tree.CreateVersionRequest) (*tree.CreateVersionResponse, error) {
	if request.GetNode().GetUuid() == "" {
		return nil, errors.WithStack(errors.InvalidParameters)
	}
	log.Logger(ctx).Debug("[VERSION] CreateVersion for node " + request.Node.Uuid)
	dao, err := manager.Resolve[versions.DAO](ctx)
	if err != nil {
		return nil, err
	}
	node := request.GetNode()

	// An explicit native revision identifies a claimed task result. Content
	// equality with the previous head cannot erase that operation's receipt.
	if !request.Draft && request.VersionUuid == "" {
		if last, er := dao.GetLastVersion(ctx, request.Node.Uuid); er != nil {
			return nil, er
		} else if last != nil && last.ETag == node.Etag {
			log.Logger(ctx).Debug("[VERSION] Found same last version for node, ignore version creation", zap.Any("last", last), zap.Any("request", request))
			return &tree.CreateVersionResponse{Ignored: true}, nil
		}
	}
	// Create Revision
	c := &tree.ContentRevision{
		VersionId: request.VersionUuid,
		Draft:     request.Draft,
		MTime:     node.MTime,
		Size:      node.Size,
		ETag:      node.Etag,
		OwnerName: request.OwnerName,
		OwnerUuid: request.OwnerUuid,
		Event:     request.TriggerEvent,
	}
	if c.VersionId == "" {
		c.VersionId = uuid.New()
	}

	if c.Location, err = versions.LocationForNode(ctx, node, c.VersionId); err != nil {
		log.Logger(ctx).Warn("CreateVersion could not create location", zap.Error(err))
		return nil, err
	} else {
		log.Logger(ctx).Debug("CreateVersion has location", c.Location.Zap("location"))
	}
	if request.Draft && config.Get(ctx, "services", common.ServiceRestNamespace_+"n", "platform").Get() != nil {
		claims, ok := claim.FromContext(ctx)
		if !ok || claims.Subject == "" || claims.Subject != request.OwnerUuid ||
			h.draftUploadTimeout <= 0 || !h.draftCleanerReady.Load() || versions.PolicyForNode(ctx, node) == nil {
			return nil, errors.WithStack(errors.StatusForbidden)
		}
		deadline := time.Now().Add(h.draftUploadTimeout)
		if deadline.UnixNano() <= time.Now().UnixNano() {
			return nil, errors.WithStack(errors.InvalidParameters)
		}
		if err := dao.ReserveDraftUpload(ctx, node.Uuid, c, deadline); err != nil {
			return nil, err // Lost reservation ACK never permits an object write.
		}
	}

	return &tree.CreateVersionResponse{Version: c}, nil
}

func (h *Handler) StoreVersion(ctx context.Context, request *tree.StoreVersionRequest) (*tree.StoreVersionResponse, error) {
	if request.GetNode().GetUuid() == "" || request.GetVersion() == nil {
		return nil, errors.WithStack(errors.InvalidParameters)
	}
	resp := &tree.StoreVersionResponse{}
	p := versions.PolicyForNode(ctx, request.Node)
	if p == nil {
		log.Logger(ctx).Info("No Policy found! Ignoring StoreVersion for node ", request.Node.Zap())
		return resp, nil
	}
	log.Logger(ctx).Info("Storing Version for node ", request.Node.ZapUuid())

	dao, err := manager.Resolve[versions.DAO](ctx)
	if err != nil {
		return nil, err
	}

	if request.Version.Draft && config.Get(ctx, "services", common.ServiceRestNamespace_+"n", "platform").Get() != nil {
		claims, ok := claim.FromContext(ctx)
		if !ok || claims.Subject == "" || claims.Subject != request.Version.OwnerUuid {
			return nil, errors.WithStack(errors.StatusForbidden)
		}
		err = dao.CompleteDraftUpload(ctx, request.Node.Uuid, request.Version, time.Now())
	} else {
		err = dao.StoreVersion(ctx, request.Node.Uuid, request.Version)
	}
	if err != nil {
		return nil, err
	}
	resp.Success = true
	resp.Version = request.Version
	if request.Version.Draft {
		return resp, nil
	}

	// Run pruning, on published versions only - Different pruning should be applied to drafts
	pruningPeriods, err := versions.PreparePeriods(time.Now(), p.KeepPeriods)
	if err != nil {
		log.Logger(ctx).Error("cannot prepare periods for versions policy", p.Zap(), zap.Error(err))
	}
	logs, _ := dao.GetVersions(ctx, request.Node.Uuid, 0, 0, "", false, map[string]any{"draftStatus": "published"})
	pruningPeriods, err = versions.DispatchChangeLogsByPeriod(pruningPeriods, logs)
	log.Logger(ctx).Debug("[VERSION] Pruning Periods", log.DangerouslyZapSmallSlice("p", pruningPeriods))
	var toRemove []*tree.ContentRevision
	for _, period := range pruningPeriods {
		out := period.Prune()
		toRemove = append(toRemove, out...)
	}
	if p.MaxSizePerFile > 0 {
		out, _ := versions.PruneAllWithMaxSize(pruningPeriods, p.MaxSizePerFile)
		toRemove = append(toRemove, out...)
	}
	if len(toRemove) > 0 {
		var removeIds []string
		for _, tr := range toRemove {
			removeIds = append(removeIds, tr.VersionId)
		}
		log.Logger(ctx).Debug("[VERSION] Pruning should remove", zap.Int("number", len(toRemove)))
		if err := dao.DeleteVersionsForNode(ctx, request.Node.Uuid, removeIds...); err != nil {
			return nil, err
		}
		resp.PruneVersions = toRemove
	}
	for _, pv := range resp.PruneVersions {
		// Backward compat
		if pv.Location == nil {
			pv.Location = versions.DefaultLocation(ctx, request.Node.Uuid, pv.VersionId)
		}
	}

	return resp, err
}

func (h *Handler) PruneVersions(ctx context.Context, request *tree.PruneVersionsRequest) (*tree.PruneVersionsResponse, error) {

	cl := treec.NodeProviderClient(ctx)

	dao, err := manager.Resolve[versions.DAO](ctx)
	if err != nil {
		return nil, err
	}

	var idsToDelete []string

	if request.AllDeletedNodes {

		// Load whole tree in memory
		existingIds := make(map[string]struct{})
		streamer, sErr := cl.ListNodes(ctx, &tree.ListNodesRequest{Node: &tree.Node{Path: "/"}, Recursive: true})
		if sErr != nil {
			return nil, sErr
		}
		defer streamer.CloseSend()
		for {
			r, e := streamer.Recv()
			if e != nil {
				break
			}
			existingIds[r.Node.GetUuid()] = struct{}{}
		}

		wg := &sync.WaitGroup{}
		wg.Add(1)
		runner := func() error {
			defer wg.Done()
			uuids, done, errs := dao.ListAllVersionedNodesUuids(ctx)
			for {
				select {
				case id := <-uuids:
					if _, o := existingIds[id]; !o {
						idsToDelete = append(idsToDelete, id)
					}
				case e := <-errs:
					return e
				case <-done:
					return nil
				}
			}
		}
		err := runner()
		wg.Wait()
		if err != nil {
			return nil, err
		}

	} else if request.UniqueNode != nil {

		idsToDelete = append(idsToDelete, request.UniqueNode.Uuid)

	} else {

		return nil, errors.WithMessage(errors.InvalidParameters, "Please provide at least a node Uuid or set the flag AllDeletedNodes to true")

	}

	resp := &tree.PruneVersionsResponse{}
	for _, i := range idsToDelete {
		allLogs, _ := dao.GetVersions(ctx, i, 0, 0, "", false, nil)
		wg := &sync.WaitGroup{}
		wg.Add(1)
		go func() {
			defer wg.Done()
			for cLog := range allLogs {
				// Backward compat stuff
				if cLog.Location == nil {
					cLog.Location = versions.DefaultLocation(ctx, i, cLog.VersionId)
				} else {
					cLog.Location.Type = tree.NodeType_LEAF
				}
				resp.DeletedVersions = append(resp.DeletedVersions, cLog)
			}
		}()
		wg.Wait()
	}

	if e := dao.DeleteVersionsForNodes(ctx, idsToDelete); e != nil {
		return nil, e
	}

	log.Logger(ctx).Debug("Responding to Prune with versions", zap.Int("versions", len(resp.DeletedVersions)))

	return resp, nil
}

func (h *Handler) ListVersioningPolicies(req *tree.ListVersioningPoliciesRequest, streamer tree.NodeVersioner_ListVersioningPoliciesServer) error {
	ctx := streamer.Context()
	// Trigger Migration
	_, _ = manager.Resolve[versions.DAO](ctx)

	dc := docstorec.DocStoreClient(ctx)
	if req.PolicyID != "" {
		// Find specific policy in docstore
		if r, e := dc.GetDocument(ctx, &docstore.GetDocumentRequest{
			StoreID:    common.DocStoreIdVersioningPolicies,
			DocumentID: req.PolicyID,
		}); e != nil {
			return e // Maybe a Not Found
		} else {
			var policy *tree.VersioningPolicy
			if er := json.Unmarshal([]byte(r.Document.Data), &policy); er != nil {
				return er
			}
			return streamer.Send(policy)
		}
	} else {
		// Stream policies from docstore
		docs, er := dc.ListDocuments(ctx, &docstore.ListDocumentsRequest{
			StoreID: common.DocStoreIdVersioningPolicies,
		})
		return commons.ForEach(docs, er, func(r *docstore.ListDocumentsResponse) error {
			var policy *tree.VersioningPolicy
			if err := json.Unmarshal([]byte(r.GetDocument().GetData()), &policy); err != nil {
				return err
			}
			return streamer.Send(policy)
		})
	}
}
