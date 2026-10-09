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

package bolt

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"slices"
	"sort"
	"time"

	"go.etcd.io/bbolt"
	"go.uber.org/multierr"
	"go.uber.org/zap"
	"google.golang.org/protobuf/proto"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/common/runtime"
	"github.com/pydio/cells/v5/common/storage/boltdb"
	"github.com/pydio/cells/v5/common/telemetry/log"
	"github.com/pydio/cells/v5/data/versions"
)

var (
	bucketName = []byte("versions")
)

func init() {
	versions.Drivers.Register(NewBoltStore)
}

type BoltStore struct {
	boltdb.DB
}

func NewBoltStore(db boltdb.DB) versions.DAO {
	return &BoltStore{
		DB: db,
	}
}

func (b *BoltStore) Migrate(ctx context.Context) error {
	return b.Update(func(tx *bbolt.Tx) error {
		_, e := tx.CreateBucketIfNotExists(bucketName)
		return e
	})
}

func (b *BoltStore) Close() error {
	err := b.Close()
	return err
}

// GetLastVersion retrieves the last version registered for this node.
func (b *BoltStore) GetLastVersion(ctx context.Context, nodeUuid string) (log *tree.ContentRevision, err error) {

	err = b.View(func(tx *bbolt.Tx) error {
		bucket := tx.Bucket(bucketName)
		if bucket == nil {
			return errors.WithStack(errors.BucketNotFound)
		}
		nodeBucket := bucket.Bucket([]byte(nodeUuid))
		if nodeBucket == nil {
			// Ignore not found
			return nil
		}
		c := nodeBucket.Cursor()
		for k, v := c.Last(); k != nil; k, v = c.Prev() {
			revision, upload, er := b.unmarshalRecord(v)
			if er != nil {
				return er
			}
			if upload == nil || upload.State == versions.DraftUploadComplete {
				log = revision
				break
			}
		}
		return nil
	})

	return log, err
}

// GetVersions returns all versions from the node bucket, in reverse order (last inserted first).
func (b *BoltStore) GetVersions(ctx context.Context, nodeUuid string, offset int64, limit int64, sortField string, sortDesc bool, filters map[string]any) (chan *tree.ContentRevision, error) {

	logChan := make(chan *tree.ContentRevision)
	var filterByType string
	var filterByOwnerUuid string
	for k, v := range filters {
		switch k {
		case "draftStatus":
			filterByType = v.(string)
		case "ownerUuid":
			filterByOwnerUuid = v.(string)
		}
	}

	go func() {
		defer func() {
			close(logChan)
		}()
		e := b.View(func(tx *bbolt.Tx) error {

			bucket := tx.Bucket(bucketName)
			if bucket == nil {
				return errors.WithStack(errors.BucketNotFound)
			}
			nodeBucket := bucket.Bucket([]byte(nodeUuid))
			if nodeBucket == nil {
				return nil
			}
			c := nodeBucket.Cursor()

			for k, v := c.Last(); k != nil; k, v = c.Prev() {
				cr, upload, e := b.unmarshalRecord(v)
				if e != nil {
					return e
				}
				if upload != nil && upload.State != versions.DraftUploadComplete {
					continue
				}
				if (filterByType == "draft" && !cr.Draft) || filterByType == "published" && cr.Draft {
					continue
				}
				if filterByOwnerUuid != "" && cr.OwnerUuid != filterByOwnerUuid {
					continue
				}
				logChan <- cr
			}

			return nil
		})
		if e != nil {
			log.Logger(runtime.WithServiceName(ctx, common.ServiceGrpcNamespace_+common.ServiceVersions)).Warn("ListVersions", zap.Error(e))
		}

	}()

	return logChan, nil
}

// StoreVersion stores a version in the node bucket.
func (b *BoltStore) StoreVersion(ctx context.Context, nodeUuid string, revision *tree.ContentRevision) error {
	if nodeUuid == "" || revision == nil || revision.VersionId == "" {
		return errors.WithMessage(errors.InvalidParameters, "version storage requires a node and version reference")
	}

	return b.Update(func(tx *bbolt.Tx) error {

		bucket := tx.Bucket(bucketName)
		if bucket == nil {
			return errors.WithStack(errors.BucketNotFound)
		}
		nodeBucket, err := bucket.CreateBucketIfNotExists([]byte(nodeUuid))
		if err != nil {
			return err
		}
		// A native revision is immutable. Check and insert under the original
		// Bolt write transaction so concurrent acknowledgements cannot create
		// a second head or silently change the stored actor/content evidence.
		var existing *tree.ContentRevision
		cursor := nodeBucket.Cursor()
		for key, value := cursor.First(); key != nil; key, value = cursor.Next() {
			stored, upload, err := b.unmarshalRecord(value)
			if err != nil {
				return err
			}
			if stored.VersionId != revision.VersionId {
				continue
			}
			if upload != nil && upload.State != versions.DraftUploadComplete {
				return errors.WithMessage(errors.StatusConflict, "draft upload requires its native completion CAS")
			}
			if existing != nil || !proto.Equal(stored, revision) {
				return errors.WithMessage(errors.StatusConflict, "native version reference already has different or ambiguous evidence")
			}
			existing = stored
		}
		if existing != nil {
			return nil
		}
		newValue, e := proto.Marshal(revision)
		if e != nil {
			return e
		}

		objectKey, e := nodeBucket.NextSequence()
		if e != nil {
			return e
		}
		k := make([]byte, 8)
		binary.BigEndian.PutUint64(k, objectKey)
		return nodeBucket.Put(k, newValue)

	})
}

// GetVersion retrieves a specific version from the node bucket.
func (b *BoltStore) GetVersion(ctx context.Context, nodeUuid string, versionId string) (*tree.ContentRevision, error) {

	var version *tree.ContentRevision

	err := b.View(func(tx *bbolt.Tx) error {

		bucket := tx.Bucket(bucketName)
		if bucket == nil {
			return errors.WithStack(errors.BucketNotFound)
		}
		nodeBucket := bucket.Bucket([]byte(nodeUuid))
		if nodeBucket == nil {
			return nil
		}

		c := nodeBucket.Cursor()
		for k, v := c.First(); k != nil; k, v = c.Next() {
			if cr, upload, er := b.unmarshalRecord(v); er != nil {
				return er
			} else if cr.VersionId == versionId {
				if upload != nil && upload.State != versions.DraftUploadComplete {
					return errors.WithMessage(errors.StatusConflict, "draft bytes have no completed native revision")
				}
				if version != nil {
					return errors.WithMessage(errors.StatusConflict, "native version reference has multiple stored results")
				}
				version = cr
			}
		}
		return nil
	})
	if version == nil && err == nil {
		err = errors.WithMessage(errors.VersionNotFound, "cannot find version "+versionId)
	}
	return version, err
}

// DeleteVersionsForNode deletes whole node bucket at once.
func (b *BoltStore) DeleteVersionsForNode(ctx context.Context, nodeUuid string, revisionIDs ...string) error {

	return b.Update(func(tx *bbolt.Tx) error {

		bucket := tx.Bucket(bucketName)
		if bucket == nil {
			return errors.WithStack(errors.BucketNotFound)
		}
		nodeBucket := bucket.Bucket([]byte(nodeUuid))
		var ee []error
		if nodeBucket != nil {
			c := nodeBucket.Cursor()
			for k, value := c.First(); k != nil; k, value = c.Next() {
				revision, upload, err := b.unmarshalRecord(value)
				if err != nil {
					return err
				}
				if len(revisionIDs) > 0 && !slices.Contains(revisionIDs, revision.VersionId) {
					continue
				}
				if upload != nil {
					// A delete cannot retire the upload's create-only claim. Keep
					// its actual location available to the original prune loop,
					// including after an uncertain/late object-store writer.
					upload.State = versions.DraftUploadCleanup
					encoded, err := json.Marshal(upload)
					if err != nil {
						return err
					}
					ee = append(ee, nodeBucket.Put(k, encoded))
				} else {
					ee = append(ee, c.Delete())
				}
			}
			if nodeBucket.Stats().KeyN == 0 {
				return bucket.DeleteBucket([]byte(nodeUuid))
			}
		}
		return multierr.Combine(ee...)
	})
}

// DeleteVersionsForNodes delete versions in a batch
func (b *BoltStore) DeleteVersionsForNodes(ctx context.Context, nodeUuid []string) error {
	var failures []error
	for _, id := range nodeUuid {
		failures = append(failures, b.DeleteVersionsForNode(ctx, id))
	}
	return multierr.Combine(failures...)
}

func (b *BoltStore) ReserveDraftUpload(ctx context.Context, nodeUuid string, revision *tree.ContentRevision, deadline time.Time) error {
	if err := versions.ValidateDraftUpload(nodeUuid, revision, deadline); err != nil {
		return err
	}
	return b.Update(func(tx *bbolt.Tx) error {
		bucket := tx.Bucket(bucketName)
		if bucket == nil {
			return errors.WithStack(errors.BucketNotFound)
		}
		node, err := bucket.CreateBucketIfNotExists([]byte(nodeUuid))
		if err != nil {
			return err
		}
		cursor := node.Cursor()
		for key, value := cursor.First(); key != nil; key, value = cursor.Next() {
			stored, _, err := b.unmarshalRecord(value)
			if err != nil {
				return err
			}
			if stored.VersionId == revision.VersionId {
				return errors.WithMessage(errors.StatusConflict, "native draft reference is already claimed; observe without uploading again")
			}
		}
		encoded, err := json.Marshal(&versions.DraftUpload{NodeUuid: nodeUuid, Revision: revision,
			Deadline: deadline.UnixNano(), CleanupOrder: deadline.UnixNano(), State: versions.DraftUploadPending})
		if err != nil {
			return err
		}
		sequence, err := node.NextSequence()
		if err != nil {
			return err
		}
		key := make([]byte, 8)
		binary.BigEndian.PutUint64(key, sequence)
		return node.Put(key, encoded)
	})
}

func (b *BoltStore) CompleteDraftUpload(ctx context.Context, nodeUuid string, revision *tree.ContentRevision, now time.Time) error {
	if revision == nil || revision.VersionId == "" {
		return errors.WithStack(errors.InvalidParameters)
	}
	return b.updateDraftUpload(nodeUuid, revision.VersionId, func(upload *versions.DraftUpload) error {
		if err := versions.ValidateDraftCompletion(upload, revision, now); err != nil {
			return err
		}
		upload.State = versions.DraftUploadComplete
		upload.Revision = proto.Clone(revision).(*tree.ContentRevision)
		return nil
	})
}

func (b *BoltStore) FenceDraftUpload(ctx context.Context, nodeUuid, versionId string, now time.Time) (*versions.DraftUpload, error) {
	var fenced *versions.DraftUpload
	err := b.updateDraftUpload(nodeUuid, versionId, func(upload *versions.DraftUpload) error {
		if upload.State != versions.DraftUploadCleanup &&
			(upload.State != versions.DraftUploadPending || upload.Deadline > now.UnixNano()) {
			return errors.WithMessage(errors.StatusConflict, "native draft is not eligible for cleanup")
		}
		upload.State = versions.DraftUploadCleanup
		upload.CleanupOrder = now.UnixNano()
		fenced = upload
		return nil
	})
	return fenced, err
}

func (b *BoltStore) updateDraftUpload(nodeUuid, versionId string, update func(*versions.DraftUpload) error) error {
	return b.Update(func(tx *bbolt.Tx) error {
		bucket := tx.Bucket(bucketName)
		if bucket == nil {
			return errors.WithStack(errors.BucketNotFound)
		}
		node := bucket.Bucket([]byte(nodeUuid))
		if node == nil {
			return errors.WithStack(errors.VersionNotFound)
		}
		var selectedKey []byte
		var selected *versions.DraftUpload
		cursor := node.Cursor()
		for key, value := cursor.First(); key != nil; key, value = cursor.Next() {
			revision, upload, err := b.unmarshalRecord(value)
			if err != nil {
				return err
			}
			if revision.VersionId != versionId {
				continue
			}
			if selected != nil || upload == nil || upload.NodeUuid != nodeUuid {
				return errors.WithMessage(errors.StatusConflict, "native draft reference has incompatible evidence")
			}
			selectedKey, selected = append([]byte(nil), key...), upload
		}
		if selected == nil {
			return errors.WithStack(errors.VersionNotFound)
		}
		if err := update(selected); err != nil {
			return err
		}
		encoded, err := json.Marshal(selected)
		if err != nil {
			return err
		}
		return node.Put(selectedKey, encoded)
	})
}

func (b *BoltStore) DraftUploads(ctx context.Context, now time.Time, limit int64) ([]*versions.DraftUpload, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if limit <= 0 {
		return nil, errors.WithStack(errors.InvalidParameters)
	}
	var uploads []*versions.DraftUpload
	err := b.View(func(tx *bbolt.Tx) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		bucket := tx.Bucket(bucketName)
		if bucket == nil {
			return errors.WithStack(errors.BucketNotFound)
		}
		return bucket.ForEach(func(nodeID, _ []byte) error {
			if err := ctx.Err(); err != nil {
				return err
			}
			node := bucket.Bucket(nodeID)
			if node == nil {
				return errors.WithStack(errors.BucketNotFound)
			}
			return node.ForEach(func(_, value []byte) error {
				if err := ctx.Err(); err != nil {
					return err
				}
				_, upload, err := b.unmarshalRecord(value)
				if err != nil {
					return err
				}
				if upload != nil && (upload.State == versions.DraftUploadCleanup ||
					(upload.State == versions.DraftUploadPending && upload.Deadline <= now.UnixNano())) {
					if upload.NodeUuid != string(nodeID) {
						return errors.WithStack(errors.StatusConflict)
					}
					uploads = append(uploads, upload)
					// Bound the snapshot while releasing the native read transaction
					// before the cleanup CAS. Least recently attempted rows get a
					// turn even when one object's deletion continually fails.
					sort.Slice(uploads, func(i, j int) bool {
						if uploads[i].CleanupOrder != uploads[j].CleanupOrder {
							return uploads[i].CleanupOrder < uploads[j].CleanupOrder
						}
						if uploads[i].NodeUuid != uploads[j].NodeUuid {
							return uploads[i].NodeUuid < uploads[j].NodeUuid
						}
						return uploads[i].Revision.VersionId < uploads[j].Revision.VersionId
					})
					if int64(len(uploads)) > limit {
						uploads = uploads[:len(uploads)-1]
					}
				}
				return nil
			})
		})
	})
	return uploads, err
}

// ListAllVersionedNodesUuids lists all nodes uuids
func (b *BoltStore) ListAllVersionedNodesUuids(ctx context.Context) (chan string, chan bool, chan error) {
	idsChan := make(chan string)
	done := make(chan bool, 1)
	errChan := make(chan error)

	go func() {

		e := b.View(func(tx *bbolt.Tx) error {

			defer func() {
				done <- true
				close(done)
			}()
			bucket := tx.Bucket(bucketName)
			if bucket == nil {
				return errors.WithStack(errors.BucketNotFound)
			}
			c := bucket.Cursor()
			for k, _ := c.First(); k != nil; k, _ = c.Next() {
				key := string(k)
				idsChan <- key
			}

			return nil
		})
		if e != nil {
			errChan <- e
		}

	}()

	return idsChan, done, errChan
}

func (b *BoltStore) unmarshalRecord(bb []byte) (*tree.ContentRevision, *versions.DraftUpload, error) {
	if len(bb) > 0 && bb[0] == '{' {
		upload := &versions.DraftUpload{}
		if err := json.Unmarshal(bb, upload); err != nil {
			return nil, nil, err
		}
		if err := versions.ValidateDraftUploadRecord(upload); err != nil {
			return nil, nil, err
		}
		return upload.Revision, upload, nil
	}
	r := &tree.ContentRevision{}
	if er := proto.Unmarshal(bb, r); er == nil && (r.Event != nil || r.Location != nil) {
		return r, nil, nil
	}
	// LegacyFormat
	cLog := &tree.ChangeLog{}
	if er := proto.Unmarshal(bb, cLog); er == nil {
		return &tree.ContentRevision{
			VersionId:   cLog.Uuid,
			Description: cLog.Description,
			MTime:       cLog.MTime,
			Size:        cLog.Size,
			ETag:        string(cLog.Data),
			OwnerName:   cLog.OwnerUuid, // This is normal
			Event:       cLog.Event,
			Location:    cLog.Location,
		}, nil, nil
	}
	return nil, nil, errors.New("invalid format (tree.ContentRevision or tree.ChangeLog expected)")
}
