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
	"time"

	"go.uber.org/multierr"
	"go.uber.org/zap"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/forms"
	"github.com/pydio/cells/v5/common/proto/jobs"
	"github.com/pydio/cells/v5/common/proto/object"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/common/telemetry/log"
	"github.com/pydio/cells/v5/scheduler/actions"
)

var (
	pruneVersionsActionName = "actions.versioning.prune"
)

type PruneVersionsAction struct{}

// PruneDraftUploads uses the original Version store and original object
// deletion route. Fence first, then delete; never remove the native claim or
// its location. A late/unknown writer cannot publish, reuse the key, or create
// an undiscoverable blob. The next bounded sweep also visits cleanup fences.
func PruneDraftUploads(ctx context.Context, dao DAO, now time.Time, batchSize int64) error {
	uploads, err := dao.DraftUploads(ctx, now, batchSize)
	if err != nil {
		return err
	}
	var failures []error
	for _, upload := range uploads {
		if err := ctx.Err(); err != nil {
			return multierr.Append(multierr.Combine(failures...), err)
		}
		fenced, err := dao.FenceDraftUpload(ctx, upload.NodeUuid, upload.Revision.VersionId, now)
		if err != nil {
			// Completion may have won the original row CAS. Only its actual
			// readable native revision proves that cleanup is no longer needed.
			if completed, readErr := dao.GetVersion(ctx, upload.NodeUuid, upload.Revision.VersionId); readErr == nil && completed != nil && completed.ETag != "" {
				continue
			}
			failures = append(failures, err)
			continue
		}
		response, err := getRouter().DeleteNode(ctx, &tree.DeleteNodeRequest{Node: fenced.Revision.Location.Clone()})
		if err == nil && !response.GetSuccess() {
			err = errors.WithMessage(errors.StatusInternalServerError, "native draft blob deletion was not acknowledged")
		}
		if err != nil {
			failures = append(failures, err)
		}
	}
	return multierr.Combine(failures...)
}

func (c *PruneVersionsAction) GetDescription(lang ...string) actions.ActionDescription {
	return actions.ActionDescription{
		ID:              pruneVersionsActionName,
		Label:           "Prune Versions",
		Icon:            "delete-sweep",
		Category:        actions.ActionCategoryTree,
		Description:     "Apply versioning policies to keep only a limited number of versions.",
		SummaryTemplate: "",
		HasForm:         false,
		IsInternal:      true,
	}
}

func (c *PruneVersionsAction) GetParametersForm(context.Context) *forms.Form {
	return nil
}

// GetName returns the Unique identifier.
func (c *PruneVersionsAction) GetName() string {
	return pruneVersionsActionName
}

// Init passes the parameters to a newly created PruneVersionsAction.
func (c *PruneVersionsAction) Init(ctx context.Context, job *jobs.Job, action *jobs.Action) error {
	return nil
}

// Run processes the actual action code.
func (c *PruneVersionsAction) Run(ctx context.Context, channels *actions.RunnableChannels, input *jobs.ActionMessage) (*jobs.ActionMessage, error) {

	// First check if versioning is enabled on any datasource
	sources := config.SourceNamesForDataServices(ctx, common.ServiceDataIndex)
	var versioningFound bool
	for _, src := range sources {
		var ds *object.DataSource
		if err := config.Get(ctx, "services", common.ServiceGrpcNamespace_+common.ServiceDataSync_+src).Scan(&ds); err == nil {
			if ds.VersioningPolicyName != "" {
				versioningFound = true
				break
			}
		}
	}

	if !versioningFound {
		log.TasksLogger(ctx).Info("Ignoring action: no datasources found with versioning enabled.")
		return input.WithIgnore(), nil
	} else {
		log.TasksLogger(ctx).Info("Starting action: one or more datasources found with versioning enabled.")
	}
	versionClient := tree.NewNodeVersionerClient(grpc.ResolveConn(ctx, common.ServiceVersionsGRPC))
	if response, err := versionClient.PruneVersions(ctx, &tree.PruneVersionsRequest{AllDeletedNodes: true}); err == nil {
		for _, version := range response.DeletedVersions {
			deleteNode := version.GetLocation()
			_, err = getRouter().DeleteNode(ctx, &tree.DeleteNodeRequest{Node: deleteNode}) // source.Handler.RemoveObjectWithContext(ctx, source.ObjectsBucket, versionFileId)
			if err != nil {
				log.TasksLogger(ctx).Error("Error while trying to remove file "+deleteNode.Uuid, zap.String("fileId", deleteNode.Uuid), zap.Error(err))
			} else {
				log.TasksLogger(ctx).Info("[Prune Versions Task] Removed file from versions bucket "+deleteNode.Uuid, zap.String("fileId", deleteNode.Uuid))
			}
		}
	} else {
		return input.WithError(err), err
	}

	output := input
	output.AppendOutput(&jobs.ActionOutput{Success: true})
	log.TasksLogger(ctx).Info("Finished pruning deleted versions")

	return output, nil
}
