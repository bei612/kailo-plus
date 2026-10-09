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

// Package versions provides a versioning mechanism for files modifications
package versions

import (
	"context"
	"time"

	"google.golang.org/protobuf/proto"

	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/common/runtime/manager"
	"github.com/pydio/cells/v5/common/service"
)

var Drivers = service.StorageDrivers{}

type DAO interface {
	GetLastVersion(ctx context.Context, nodeUuid string) (*tree.ContentRevision, error)
	GetVersions(ctx context.Context, nodeUuid string, offset int64, limit int64, sortField string, sortDesc bool, filters map[string]any) (chan *tree.ContentRevision, error)
	GetVersion(ctx context.Context, nodeUuid string, versionId string) (*tree.ContentRevision, error)
	StoreVersion(ctx context.Context, nodeUuid string, revision *tree.ContentRevision) error
	ReserveDraftUpload(ctx context.Context, nodeUuid string, revision *tree.ContentRevision, deadline time.Time) error
	CompleteDraftUpload(ctx context.Context, nodeUuid string, revision *tree.ContentRevision, now time.Time) error
	DraftUploads(ctx context.Context, now time.Time, limit int64) ([]*DraftUpload, error)
	FenceDraftUpload(ctx context.Context, nodeUuid, versionId string, now time.Time) (*DraftUpload, error)
	DeleteVersionsForNode(ctx context.Context, nodeUuid string, versions ...string) error
	DeleteVersionsForNodes(ctx context.Context, nodeUuid []string) error
	ListAllVersionedNodesUuids(ctx context.Context) (chan string, chan bool, chan error)
}

// DraftUpload is the private lifecycle of the original native Version row.
// Pending bytes are not a ContentRevision result and are never returned by the
// normal version readers. Cleanup keeps this same row/location as a durable
// fence: a failed or late writer cannot make the reference reusable.
type DraftUpload struct {
	NodeUuid string                `json:"nodeUuid"`
	Revision *tree.ContentRevision `json:"revision"`
	Deadline int64                 `json:"deadline"`
	State    string                `json:"state"`
	// Initial eligibility deadline, then the most recent sweep attempt. It is
	// queue ordering only, never proof that the remote writer has terminated.
	CleanupOrder int64 `json:"cleanupOrder"`
}

const (
	DraftUploadPending  = "PENDING"
	DraftUploadComplete = "COMPLETE"
	DraftUploadCleanup  = "CLEANUP"
)

func ValidateDraftUpload(nodeUuid string, revision *tree.ContentRevision, deadline time.Time) error {
	if nodeUuid == "" || revision == nil || revision.VersionId == "" || !revision.Draft ||
		revision.OwnerUuid == "" || revision.Location == nil || revision.Location.Path == "" ||
		revision.ETag != "" || revision.ContentHash != "" || revision.Size < 0 || deadline.UnixNano() <= 0 || !deadline.After(time.Now()) {
		return errors.WithMessage(errors.InvalidParameters, "draft upload requires an owned native revision, empty result and future deadline")
	}
	return nil
}

func ValidateDraftUploadRecord(upload *DraftUpload) error {
	if upload == nil || upload.NodeUuid == "" || upload.Revision == nil || upload.Deadline <= 0 || upload.CleanupOrder <= 0 ||
		upload.Revision.VersionId == "" || !upload.Revision.Draft || upload.Revision.OwnerUuid == "" ||
		upload.Revision.Size < 0 || upload.Revision.Location == nil || upload.Revision.Location.Path == "" ||
		(upload.State != DraftUploadPending && upload.State != DraftUploadComplete && upload.State != DraftUploadCleanup) ||
		(upload.State == DraftUploadComplete && upload.Revision.ETag == "") {
		return errors.WithMessage(errors.StatusConflict, "invalid native draft upload record")
	}
	return nil
}

// Only the native bytes acknowledgement may add these three result fields.
// Owner, revision, location, event and all other frozen evidence must match the
// row claimed before the first object write.
func ValidateDraftCompletion(stored *DraftUpload, next *tree.ContentRevision, now time.Time) error {
	if err := ValidateDraftUploadRecord(stored); err != nil {
		return err
	}
	if next == nil || next.ETag == "" || next.Size < 0 {
		return errors.WithMessage(errors.StatusConflict, "draft upload has no confirmed byte result")
	}
	if stored.State == DraftUploadComplete && proto.Equal(stored.Revision, next) {
		return nil
	}
	if stored.State != DraftUploadPending || stored.Deadline <= now.UnixNano() {
		return errors.WithMessage(errors.StatusConflict, "draft upload is no longer writable")
	}
	frozen := proto.Clone(next).(*tree.ContentRevision)
	frozen.ETag, frozen.ContentHash, frozen.Size = stored.Revision.ETag, stored.Revision.ContentHash, stored.Revision.Size
	if !proto.Equal(stored.Revision, frozen) {
		return errors.WithMessage(errors.StatusConflict, "draft upload acknowledgement changed frozen native evidence")
	}
	return nil
}

func Migrate(main, fromCtx, toCtx context.Context, dryRun bool, status chan service.MigratorStatus) (map[string]int, error) {
	out := map[string]int{
		"Versions": 0,
	}
	from, er := manager.Resolve[DAO](fromCtx)
	if er != nil {
		return nil, er
	}
	to, er := manager.Resolve[DAO](toCtx)
	if er != nil {
		return nil, er
	}
	// Ordinary ContentRevision migration cannot silently drop an uncertain
	// upload or its cleanup fence. Complete revisions retain their immutable
	// native key through the original StoreVersion migration.
	protected, er := from.DraftUploads(fromCtx, time.Unix(0, 1<<63-1), 1)
	if er != nil {
		return nil, er
	}
	if len(protected) != 0 {
		return nil, errors.WithMessage(errors.StatusConflict, "native pending uploads or cleanup fences prevent version-store migration")
	}
	uuids, done, errs := from.ListAllVersionedNodesUuids(fromCtx)
	var e error
loop1:
	for {
		select {
		case id := <-uuids:
			versions, _ := from.GetVersions(fromCtx, id, 0, 0, "", false, nil)
			for version := range versions {
				if dryRun {
					out["Versions"]++
				} else if er := to.StoreVersion(toCtx, id, version); er == nil {
					out["Versions"]++
				} else {
					continue
				}
			}
			break loop1
		case e = <-errs:
			break loop1
		case <-done:
			break loop1
		}
	}
	return out, e
}
