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

package versions

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"

	"go.uber.org/zap"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/anypb"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth/claim"
	"github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/forms"
	"github.com/pydio/cells/v5/common/nodes"
	"github.com/pydio/cells/v5/common/nodes/compose"
	"github.com/pydio/cells/v5/common/nodes/models"
	"github.com/pydio/cells/v5/common/permissions"
	"github.com/pydio/cells/v5/common/proto/jobs"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/common/telemetry/log"
	"github.com/pydio/cells/v5/common/utils/i18n/languages"
	"github.com/pydio/cells/v5/common/utils/propagator"
	"github.com/pydio/cells/v5/data/versions/lang"
	"github.com/pydio/cells/v5/scheduler/actions"
	jobstore "github.com/pydio/cells/v5/scheduler/jobs"
)

type VersionAction struct{}

func (c *VersionAction) GetDescription(lang ...string) actions.ActionDescription {
	return actions.ActionDescription{
		ID:               versionActionName,
		Label:            "File versioning",
		Icon:             "content-copy",
		Category:         actions.ActionCategoryTree,
		Description:      "Create a copy of file on each content change",
		SummaryTemplate:  "",
		HasForm:          false,
		InputDescription: "Single node from event",
		IsInternal:       true,
	}
}

func (c *VersionAction) GetParametersForm(context.Context) *forms.Form {
	return nil
}

var (
	versionActionName = jobstore.NativeVersionActionID
	router            nodes.Client
)

func getRouter() nodes.Client {
	if router == nil {
		router = compose.PathClient(nodes.AsAdmin())
	}
	return router
}

// GetName returns the Unique identifier for this VersionAction
func (c *VersionAction) GetName() string {
	return versionActionName
}

// Init sets this VersionAction parameters.
func (c *VersionAction) Init(ctx context.Context, job *jobs.Job, action *jobs.Action) error {
	return nil
}

// Run processes the actual action code
func (c *VersionAction) Run(ctx context.Context, channels *actions.RunnableChannels, input *jobs.ActionMessage) (*jobs.ActionMessage, error) {
	return c.run(ctx, input, getRouter(), "")
}

// PromoteRevision uses the original version action with an exact, owner-bound
// draft. It never snapshots a mutable head after another upload has raced the
// promotion. The caller must already hold the native first-dispatch claim.
func (c *VersionAction) PromoteRevision(ctx context.Context, input *jobs.ActionMessage, handler nodes.Client) (*jobs.ActionMessage, error) {
	if claimed, _ := ctx.Value(jobstore.ClaimedTaskContextKey{}).(bool); !claimed || handler == nil || len(input.GetNodes()) != 1 || input.Nodes[0].GetStringMeta(common.MetaNamespaceVersionId) == "" {
		err := errors.WithMessage(errors.InvalidParameters, "native promotion requires its claimed task and exact source revision")
		return input.WithError(err), err
	}
	return c.run(ctx, input, handler, input.Nodes[0].GetStringMeta(common.MetaNamespaceVersionId))
}

func (c *VersionAction) run(ctx context.Context, input *jobs.ActionMessage, handler nodes.Client, sourceRevision string) (*jobs.ActionMessage, error) {

	if len(input.Nodes) == 0 {
		return input.WithIgnore(), nil // Ignore
	}
	node := input.Nodes[0]

	if node.Etag == common.NodeFlagEtagTemporary || tree.IgnoreNodeForOutput(ctx, node) {
		return input.WithIgnore(), nil // Ignore
	}
	T := lang.Bundle().T(languages.GetDefaultLanguage(ctx))
	policy := PolicyForNode(ctx, node)
	if policy == nil {
		return input.WithIgnore(), nil
	}

	// TODO: find clients from pool so that they are considered the same by the CopyObject request
	source, e := DataSourceForPolicy(ctx, policy)
	if e != nil {
		return input.WithError(e), e
	}

	userName := claim.UserNameFromContext(ctx)
	user, err := permissions.SearchUniqueUser(ctx, userName, "")
	if err != nil {
		return input.WithError(err), err
	}
	userId := user.GetUuid()
	versionClient := tree.NewNodeVersionerClient(grpc.ResolveConn(ctx, common.ServiceVersionsGRPC))
	if sourceRevision != "" {
		claimed, _ := ctx.Value(jobstore.ClaimedTaskContextKey{}).(bool)
		source, er := versionClient.HeadVersion(ctx, &tree.HeadVersionRequest{NodeUuid: node.Uuid, VersionId: sourceRevision})
		revision := source.GetVersion()
		if er != nil {
			return input.WithError(er), er
		}
		if !claimed || !revision.GetDraft() || revision.GetVersionId() != sourceRevision || revision.GetOwnerUuid() != userId || revision.GetSize() < 0 || revision.GetLocation() == nil || revision.GetETag() == "" {
			er = errors.WithMessage(errors.StatusForbidden, "native source revision is not this claimed actor's persisted draft")
			return input.WithError(er), er
		}
		node = node.Clone()
		node.Size, node.Etag, node.MTime = revision.Size, revision.ETag, revision.MTime
		if revision.ContentHash != "" {
			node.MustSetMeta(common.MetaNamespaceHash, revision.ContentHash)
		}
	}
	request := &tree.CreateVersionRequest{Node: node, OwnerName: userName, OwnerUuid: userId}
	if claimed, _ := ctx.Value(jobstore.ClaimedTaskContextKey{}).(bool); claimed {
		taskID, hasTask := propagator.CanonicalMeta(ctx, common.CtxMetaTaskUuid)
		actionPath, hasAction := propagator.CanonicalMeta(ctx, common.CtxMetaTaskActionPath)
		if !hasTask || taskID == "" || !hasAction || actionPath == "" || node.Uuid == "" {
			err = errors.WithMessage(errors.InvalidParameters, "claimed version action requires its native task, action and node references")
			return input.WithError(err), err
		}
		reference, _ := json.Marshal([]string{taskID, actionPath, node.Uuid})
		digest := sha256.Sum256(reference)
		request.VersionUuid = hex.EncodeToString(digest[:])
	}
	if input.Event != nil {
		ce := &tree.NodeChangeEvent{}
		if err := anypb.UnmarshalTo(input.Event, ce, proto.UnmarshalOptions{}); err == nil {
			request.TriggerEvent = ce
		}
	}
	resp, err := versionClient.CreateVersion(ctx, request)
	if err != nil {
		return input.WithError(err), err
	}
	if resp.GetIgnored() {
		// No version returned, means content did not change, do not update
		return input.WithIgnore(), nil
	}
	if resp.GetVersion().GetVersionId() == "" || resp.GetVersion().GetOwnerUuid() != userId {
		err = errors.WithMessage(errors.VersionNotFound, "created revision does not identify the native owner and version")
		return input.WithError(err), err
	}
	if request.VersionUuid != "" && resp.Version.VersionId != request.VersionUuid {
		err = errors.WithMessage(errors.StatusConflict, "created revision does not identify the claimed native task")
		return input.WithError(err), err
	}

	// Prepare ctx with info about the target branch
	branchInfo := nodes.BranchInfo{LoadedSource: source}
	ctx = nodes.WithBranchInfo(ctx, "to", branchInfo)

	// Ordinary event versioning still snapshots current native content. A
	// promotion copies the frozen draft instead, through the original version
	// reader and the original native version-store router.
	sourceNode := node
	if sourceRevision == "" {
		rr, re := handler.ReadNode(ctx, &tree.ReadNodeRequest{Node: node.Clone()})
		if re != nil {
			return input.WithError(re), re
		}
		sourceNode = rr.GetNode()
	}
	targetNode := resp.Version.GetLocation()
	if targetNode == nil {
		er := errors.WithMessage(errors.NodeNotFound, "no content revision location found")
		log.TasksLogger(ctx).Error("version.GetLocation is empty", zap.Any("version", resp.Version))
		return input.WithError(er), er
	}

	objectInfo, err := handler.CopyObject(ctx, sourceNode, targetNode, &models.CopyRequestData{SrcVersionId: sourceRevision})
	if err != nil {
		err = errors.WithMessage(err, fmt.Sprintf("Copying %s -> %s", sourceNode.GetPath(), targetNode.GetUuid()))
		return input.WithError(err), err
	}

	output := input
	log.TasksLogger(ctx).Info(T("Job.Version.StatusFile", resp.Version))

	if objectInfo.Size < 0 || (sourceRevision != "" && objectInfo.Size != node.Size) {
		err = errors.WithMessage(errors.StatusConflict, "native copied version has an unknown size")
		return input.WithError(err), err
	}
	storedVersion := resp.Version
	storedVersion.Size = objectInfo.Size
	storedVersion.Location = targetNode.Clone()
	if h := node.GetStringMeta(common.MetaNamespaceHash); h != "" {
		storedVersion.ContentHash = h
		storedVersion.Location.MustSetMeta(common.MetaNamespaceHash, h)
	}
	response, err2 := versionClient.StoreVersion(ctx, &tree.StoreVersionRequest{
		Node:    node,
		Version: storedVersion,
	})
	if err2 != nil {
		return input.WithError(err2), err2
	}
	if !response.GetSuccess() || !proto.Equal(response.GetVersion(), storedVersion) {
		err2 = errors.WithMessage(errors.VersionNotFound, "native copied revision persistence was not acknowledged")
		return input.WithError(err2), err2
	}
	log.TasksLogger(ctx).Info(T("Job.Version.StatusMeta", resp.Version))
	if request.VersionUuid != "" {
		receipt, err := protojson.Marshal(response.Version)
		if err != nil {
			return input.WithError(err), err
		}
		output.AppendOutput(&jobs.ActionOutput{Success: true, JsonBody: receipt, Vars: map[string]string{jobstore.NativeVersionResult: "true"}})
	} else {
		output.AppendOutput(&jobs.ActionOutput{Success: true})
	}
	ctx = nodes.WithBranchInfo(ctx, "in", branchInfo)
	for _, version := range response.PruneVersions {
		_, errDel := handler.DeleteNode(ctx, &tree.DeleteNodeRequest{Node: version.GetLocation()})
		if errDel != nil {
			return input.WithError(errDel), errDel
		}
	}
	if len(response.PruneVersions) > 0 {
		log.TasksLogger(ctx).Info(T("Job.Version.StatusPrune", struct{ Count int }{Count: len(response.PruneVersions)}))
		output.AppendOutput(&jobs.ActionOutput{Success: true})
	}

	log.Logger(ctx).Debug("[VERSIONING] End", zap.Error(err), zap.Int64("written", objectInfo.Size))

	return output, nil
}
