/*
 * Copyright (c) 2018. Abstrium SAS <team (at) pydio.com>
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

package tree

import (
	"context"
	"fmt"
	"io"
	"path"
	"strings"
	"sync"

	"go.uber.org/zap"
	"google.golang.org/protobuf/encoding/protojson"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/broker"
	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/forms"
	"github.com/pydio/cells/v5/common/nodes"
	"github.com/pydio/cells/v5/common/proto/jobs"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/common/telemetry/log"
	"github.com/pydio/cells/v5/common/utils/i18n/languages"
	"github.com/pydio/cells/v5/common/utils/uuid"
	"github.com/pydio/cells/v5/scheduler/actions"
	"github.com/pydio/cells/v5/scheduler/actions/tools"
	jobstore "github.com/pydio/cells/v5/scheduler/jobs"
	"github.com/pydio/cells/v5/scheduler/lang"
)

var (
	deleteActionName = "actions.tree.delete"
)

type DeleteAction struct {
	tools.ScopedRouterConsumer
	childrenOnlyParam string
	ignoreNonExisting string
	nativeDelete      bool
}

func (c *DeleteAction) GetDescription(_ ...string) actions.ActionDescription {
	return actions.ActionDescription{
		ID:               deleteActionName,
		Label:            "Delete files",
		Category:         actions.ActionCategoryTree,
		Icon:             "file-remove",
		Description:      "Recursively delete files or folders passed in input",
		InputDescription: "Single-selection of file or folder to delete. Folders are deleted recursively",
		SummaryTemplate:  "",
		HasForm:          true,
	}
}

func (c *DeleteAction) GetParametersForm(context.Context) *forms.Form {
	return &forms.Form{Groups: []*forms.Group{
		{
			Fields: []forms.Field{
				&forms.FormField{
					Name:        "childrenOnly",
					Type:        forms.ParamBool,
					Label:       "Children Only",
					Description: "Delete only the children items from the input node",
					Default:     false,
					Mandatory:   false,
					Editable:    true,
				},
				&forms.FormField{
					Name:        "ignoreNonExisting",
					Type:        forms.ParamBool,
					Label:       "Ignore error if not found",
					Description: "Silently skip deletion if target file is not found",
					Default:     false,
					Mandatory:   false,
					Editable:    true,
				},
			},
		},
	}}
}

// GetName returns this action unique identifier
func (c *DeleteAction) GetName() string {
	return deleteActionName
}

// Init passes parameters to the action
func (c *DeleteAction) Init(ctx context.Context, job *jobs.Job, action *jobs.Action) error {
	c.nativeDelete = jobstore.IsNativeDeleteJob(job)

	if co, ok := action.Parameters["childrenOnly"]; ok {
		c.childrenOnlyParam = co
	} else {
		c.childrenOnlyParam = "false"
	}
	if i, o := action.Parameters["ignoreNonExisting"]; o {
		c.ignoreNonExisting = i
	}
	c.ParseScope(job.Owner, action.Parameters)

	return nil
}

// Run the actual action code
func (c *DeleteAction) Run(ctx context.Context, channels *actions.RunnableChannels, input *jobs.ActionMessage) (*jobs.ActionMessage, error) {

	if len(input.Nodes) == 0 {
		return input.WithIgnore(), nil // Ignore
	}

	T := lang.Bundle().T(languages.UserLanguageFromContext(ctx, true))

	childrenOnly, e := jobs.EvaluateFieldBool(ctx, input, c.childrenOnlyParam)
	if e != nil {
		return input.WithError(e), e
	}

	sourceNode := input.Nodes[0]
	c2, cli, e := c.GetHandler(ctx)
	if e != nil {
		return input.WithError(e), e
	}
	ctx = c2

	readR, readE := cli.ReadNode(ctx, &tree.ReadNodeRequest{Node: sourceNode})
	if readE != nil {
		if ignore, _ := jobs.EvaluateFieldBool(ctx, input, c.ignoreNonExisting); ignore && (errors.Is(readE, errors.NodeNotFound) || errors.Is(readE, errors.ObjectNotFound)) {
			log.TasksLogger(ctx).Info("No file found, ignoring")
			return input.WithIgnore(), nil
		}
		log.Logger(ctx).Error("Read Source", zap.Error(readE))
		return input.WithError(readE), readE
	}
	sourceNode = readR.GetNode()
	if sourceNode == nil {
		err := errors.WithStack(errors.StatusInternalServerError)
		return input.WithError(err), err
	}
	// Only an acknowledged native deletion is a completed action. This is not
	// a conditional delete or evidence that an uncertain request may be replayed.
	deleteNode := func(node *tree.Node, session string) error {
		response, err := cli.DeleteNode(ctx, &tree.DeleteNodeRequest{Node: node, IndexationSession: session})
		if err == nil && !response.GetSuccess() {
			err = errors.WithStack(errors.StatusInternalServerError)
		}
		return err
	}

	var isFlat bool
	var firstLevelFolders []*tree.Node
	if router, ok := cli.(nodes.Client); ok {
		if b, err := router.BranchInfoForNode(ctx, sourceNode); err == nil {
			isFlat = b.FlatStorage
		} else {
			return input.WithError(err), err
		}
	}

	if sourceNode.IsLeaf() {
		err := deleteNode(sourceNode, "")
		if err != nil {
			return input.WithError(err), err
		}
	} else {

		iSess := ""
		if !isFlat {
			iSess = uuid.New()
			defer func() {
				broker.MustPublish(context.Background(), common.TopicIndexEvent, &tree.IndexEvent{
					SessionForceClose: iSess,
				})
			}()
		}
		var listErr error
		// Keep one native processing error without retaining a result per node.
		// Every worker still logs its error, and all dispatched workers are joined.
		deletionErrors := make(chan error, 1)
		recordDeletionError := func(err error) {
			select {
			case deletionErrors <- err:
			default:
			}
		}
		wg := &sync.WaitGroup{}
		throttle := make(chan struct{}, 4)
		list, e := cli.ListNodes(ctx, &tree.ListNodesRequest{Node: sourceNode, Recursive: true})
		if e != nil {
			return input.WithError(e), e
		}
		if list == nil {
			err := errors.WithStack(errors.StatusInternalServerError)
			return input.WithError(err), err
		}
		for {
			resp, e := list.Recv()
			if e != nil {
				if e != io.EOF {
					listErr = e
				}
				break
			}
			n := resp.GetNode()
			if n == nil {
				listErr = errors.WithStack(errors.StatusInternalServerError)
				break
			}
			if n.Path == path.Join(sourceNode.Path, common.PydioSyncHiddenFile) && childrenOnly {
				// Do not delete first .pydio!
				continue
			}
			// Do not remove folders (ignore for struct, postpone first-level deletion for flats)
			if !n.IsLeaf() {
				if isFlat {
					relPath := strings.Trim(strings.TrimPrefix(n.GetPath(), sourceNode.GetPath()), "/")
					if childrenOnly && !strings.Contains(relPath, "/") {
						firstLevelFolders = append(firstLevelFolders, n.Clone())
					}
				}
				continue
			}

			wg.Add(1)
			throttle <- struct{}{}
			go func(n *tree.Node) {
				defer func() {
					<-throttle
					wg.Done()
				}()
				log.Logger(ctx).Debug("Deleting node in background", n.ZapPath())
				statusPath := strings.TrimPrefix(n.GetPath(), sourceNode.GetPath()+"/")
				if path.Base(statusPath) == common.PydioSyncHiddenFile {
					statusPath = path.Dir(statusPath)
				}
				select {
				case channels.StatusMsg <- strings.Replace(T("Jobs.User.DeletingItem"), "%s", statusPath, -1):
				case <-ctx.Done():
					recordDeletionError(ctx.Err())
					return
				}
				er := deleteNode(n, iSess)
				if er != nil {
					delErr := fmt.Errorf("Cannot delete "+n.GetPath()+": %w", er)
					recordDeletionError(delErr)
					log.TasksLogger(ctx).Error(delErr.Error(), zap.Error(delErr))
					log.Logger(ctx).Error(delErr.Error(), zap.Error(delErr))
				}
			}(n)
		}
		wg.Wait()
		if listErr != nil {
			return input.WithError(listErr), listErr
		}
		select {
		case delErr := <-deletionErrors:
			return input.WithError(delErr), delErr
		default:
		}
		if err := ctx.Err(); err != nil {
			return input.WithError(err), err
		}
		if isFlat {
			if !childrenOnly {
				log.Logger(ctx).Info("Deleting sourceNode", sourceNode.ZapPath())
				if e := deleteNode(sourceNode, ""); e != nil {
					return input.WithError(e), e
				}
			} else {
				for _, n := range firstLevelFolders {
					log.Logger(ctx).Info("Deleting first level of nodes", n.ZapPath())
					if e := deleteNode(n, ""); e != nil {
						return input.WithError(e), e
					}
				}
			}
		}
	}

	log.TasksLogger(ctx).Info(fmt.Sprintf("Successfully deleted %s", sourceNode.GetPath()))

	output := input.WithNode(nil)
	output.AppendOutput(&jobs.ActionOutput{
		Success:    true,
		StringBody: "Deleted node",
	})
	if claimed, _ := ctx.Value(jobstore.ClaimedTaskContextKey{}).(bool); claimed && c.nativeDelete && !childrenOnly {
		// Persist the original native event identity only after every delete ACK.
		// An empty selector or children-only operation cannot prove this removal.
		body, err := protojson.Marshal(&tree.NodeChangeEvent{Type: tree.NodeChangeEvent_DELETE, Source: &tree.Node{Uuid: sourceNode.Uuid, Path: sourceNode.Path, Type: sourceNode.Type}})
		if err != nil {
			return input.WithError(err), err
		}
		output.AppendOutput(&jobs.ActionOutput{Success: true, JsonBody: body, Vars: map[string]string{jobstore.NativeNodeMutationResult: "true"}})
	}

	return output, nil
}
