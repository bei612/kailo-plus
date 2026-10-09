/*
 * Copyright (c) 2019-2022. Abstrium SAS <team (at) pydio.com>
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

package mongo

import (
	"context"
	"fmt"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"go.uber.org/zap"
	"google.golang.org/protobuf/proto"

	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/common/storage/mongodb"
	"github.com/pydio/cells/v5/common/telemetry/log"
	"github.com/pydio/cells/v5/data/versions"
)

const (
	collVersions = "versions"
)

var (
	model = mongodb.Model{Collections: []mongodb.Collection{
		{
			Name: collVersions,
			Indexes: []map[string]int{
				{"node_uuid": 1},
				{"draft": 1},
				{"node_uuid": 1, "version_id": 1},
				{"ts": -1},
			},
		},
	}}
)

func init() {
	versions.Drivers.Register(NewMongoDAO)
}

type mVersion struct {
	NodeUuid  string `bson:"node_uuid"`
	VersionId string `bson:"version_id"`
	Timestamp int64  `bson:"ts"`
	*tree.ChangeLog
}

type mRevision struct {
	NodeUuid       string `bson:"node_uuid"`
	VersionId      string `bson:"version_id"`
	Draft          bool   `bson:"draft"`
	OwnerUuid      string `bson:"owner_uuid"`
	Timestamp      int64  `bson:"ts"`
	UploadState    string `bson:"draft_upload_state,omitempty"`
	UploadDeadline int64  `bson:"draft_upload_deadline,omitempty"`
	CleanupOrder   int64  `bson:"draft_upload_cleanup_order,omitempty"`
	*tree.ContentRevision
}

type Decoder interface {
	Decode(v interface{}) error
}

func NewMongoDAO(db *mongodb.Indexer) versions.DAO {
	return &MongoStore{Database: db.Database}
}

type MongoStore struct {
	*mongodb.Database
}

// Preserve the original revision collection and enforce its native reference.
// Existing duplicates stop migration; they are not silently removed or chosen.
func (m *MongoStore) Migrate(ctx context.Context) error {
	_, err := m.Collection(collVersions).Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "node_uuid", Value: 1}, {Key: "version_id", Value: 1}},
		Options: options.Index().SetName("native_version_reference").SetUnique(true),
	})
	if err != nil {
		return err
	}
	_, err = m.Collection(collVersions).Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys: bson.D{{Key: "draft_upload_state", Value: 1}, {Key: "draft_upload_cleanup_order", Value: 1},
			{Key: "node_uuid", Value: 1}, {Key: "version_id", Value: 1}},
		Options: options.Index().SetName("native_draft_upload_cleanup"),
	})
	return err
}

func (m *MongoStore) GetLastVersion(ctx context.Context, nodeUuid string) (*tree.ContentRevision, error) {
	res := m.Collection(collVersions).FindOne(ctx, readableFilter(bson.D{{"node_uuid", nodeUuid}}), &options.FindOneOptions{
		Sort: bson.M{"ts": -1},
	})
	if res.Err() != nil {
		if strings.Contains(res.Err().Error(), "no documents in result") {
			return nil, nil
		}
		return nil, res.Err()
	}
	return m.decodeRevision(res)
}

func (m *MongoStore) GetVersions(ctx context.Context, nodeUuid string, offset int64, limit int64, sortField string, sortDesc bool, filters map[string]any) (chan *tree.ContentRevision, error) {
	logs := make(chan *tree.ContentRevision)

	go func() {
		defer close(logs)
		search := readableFilter(bson.D{{"node_uuid", nodeUuid}})
		for k, v := range filters {
			switch k {
			case "draftStatus":
				filterByType := v.(string)
				if filterByType == "draft" {
					search = append(search, bson.E{"draft", true})
				} else if filterByType == "published" {
					search = append(search, bson.E{"draft", false})
				}
			case "ownerUuid":
				search = append(search, bson.E{"owner_uuid", v.(string)})
			}
		}
		cursor, er := m.Collection(collVersions).Find(ctx, search, &options.FindOptions{
			Sort: bson.M{"ts": -1},
		})
		if er != nil {
			return
		}
		for cursor.Next(ctx) {
			if cr, err := m.decodeRevision(cursor); err == nil {
				logs <- cr
			} else {
				log.Logger(ctx).Warn("Could not decode content revision", zap.Error(err))
			}
		}
	}()
	return logs, nil
}

func (m *MongoStore) GetVersion(ctx context.Context, nodeUuid string, versionId string) (*tree.ContentRevision, error) {
	res := m.Collection(collVersions).FindOne(ctx, bson.D{{"node_uuid", nodeUuid}, {"version_id", versionId}})
	if res.Err() != nil {
		if strings.Contains(res.Err().Error(), "no documents in result") {
			return nil, errors.WithStack(errors.VersionNotFound)
		}
		return nil, res.Err()
	}
	var stored mRevision
	if err := res.Decode(&stored); err != nil {
		return nil, err
	}
	if stored.UploadState != "" && stored.UploadState != versions.DraftUploadComplete {
		return nil, errors.WithMessage(errors.StatusConflict, "draft bytes have no completed native revision")
	}
	return m.decodeRevision(res)
}

func readableFilter(filter bson.D) bson.D {
	return append(filter, bson.E{Key: "$or", Value: bson.A{
		bson.M{"draft_upload_state": bson.M{"$exists": false}},
		bson.M{"draft_upload_state": versions.DraftUploadComplete},
	}})
}

func (m *MongoStore) ReserveDraftUpload(ctx context.Context, nodeUuid string, revision *tree.ContentRevision, deadline time.Time) error {
	if err := versions.ValidateDraftUpload(nodeUuid, revision, deadline); err != nil {
		return err
	}
	_, err := m.Collection(collVersions).InsertOne(ctx, &mRevision{NodeUuid: nodeUuid,
		VersionId: revision.VersionId, Timestamp: time.Now().UnixNano(), Draft: true,
		OwnerUuid: revision.OwnerUuid, ContentRevision: revision,
		UploadState: versions.DraftUploadPending, UploadDeadline: deadline.UnixNano(), CleanupOrder: deadline.UnixNano()})
	if mongo.IsDuplicateKeyError(err) {
		return errors.WithMessage(errors.StatusConflict, "native draft reference is already claimed; observe without uploading again")
	}
	return err
}

func (m *MongoStore) CompleteDraftUpload(ctx context.Context, nodeUuid string, revision *tree.ContentRevision, now time.Time) error {
	if revision == nil || revision.VersionId == "" {
		return errors.WithStack(errors.InvalidParameters)
	}
	var stored mRevision
	filter := bson.D{{Key: "node_uuid", Value: nodeUuid}, {Key: "version_id", Value: revision.VersionId}}
	if err := m.Collection(collVersions).FindOne(ctx, filter).Decode(&stored); err != nil {
		return err
	}
	upload := &versions.DraftUpload{NodeUuid: stored.NodeUuid, Revision: stored.ContentRevision,
		State: stored.UploadState, Deadline: stored.UploadDeadline, CleanupOrder: stored.CleanupOrder}
	if err := versions.ValidateDraftCompletion(upload, revision, now); err != nil {
		return err
	}
	if stored.UploadState == versions.DraftUploadComplete {
		return nil
	}
	// CAS the actual immutable reservation in the same original collection.
	// A concurrent expiration/deletion fence wins over a late byte ACK.
	filter = append(filter, bson.E{Key: "draft_upload_state", Value: versions.DraftUploadPending},
		bson.E{Key: "draft_upload_deadline", Value: stored.UploadDeadline})
	stored.ContentRevision = proto.Clone(revision).(*tree.ContentRevision)
	stored.UploadState = versions.DraftUploadComplete
	result, err := m.Collection(collVersions).ReplaceOne(ctx, filter, &stored)
	if err != nil {
		return err
	}
	if result.MatchedCount != 1 {
		return errors.WithMessage(errors.StatusConflict, "draft upload no longer matches its native reservation")
	}
	return nil
}

func (m *MongoStore) FenceDraftUpload(ctx context.Context, nodeUuid, versionId string, now time.Time) (*versions.DraftUpload, error) {
	filter := bson.D{{Key: "node_uuid", Value: nodeUuid}, {Key: "version_id", Value: versionId},
		{Key: "$or", Value: bson.A{
			bson.M{"draft_upload_state": versions.DraftUploadCleanup},
			bson.M{"draft_upload_state": versions.DraftUploadPending, "draft_upload_deadline": bson.M{"$lte": now.UnixNano()}},
		}}}
	var stored mRevision
	err := m.Collection(collVersions).FindOneAndUpdate(ctx, filter,
		bson.M{"$set": bson.M{"draft_upload_state": versions.DraftUploadCleanup, "draft_upload_cleanup_order": now.UnixNano()}},
		options.FindOneAndUpdate().SetReturnDocument(options.After)).Decode(&stored)
	if err != nil {
		return nil, err
	}
	upload := &versions.DraftUpload{NodeUuid: nodeUuid, Revision: stored.ContentRevision,
		State: stored.UploadState, Deadline: stored.UploadDeadline, CleanupOrder: stored.CleanupOrder}
	if err := versions.ValidateDraftUploadRecord(upload); err != nil {
		return nil, err
	}
	return upload, nil
}

func (m *MongoStore) DraftUploads(ctx context.Context, now time.Time, limit int64) ([]*versions.DraftUpload, error) {
	if limit <= 0 {
		return nil, errors.WithStack(errors.InvalidParameters)
	}
	cursor, err := m.Collection(collVersions).Find(ctx, bson.M{"$or": bson.A{
		bson.M{"draft_upload_state": versions.DraftUploadCleanup},
		bson.M{"draft_upload_state": versions.DraftUploadPending, "draft_upload_deadline": bson.M{"$lte": now.UnixNano()}},
	}}, options.Find().SetSort(bson.D{{Key: "draft_upload_cleanup_order", Value: 1},
		{Key: "node_uuid", Value: 1}, {Key: "version_id", Value: 1}}).SetLimit(limit))
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)
	var uploads []*versions.DraftUpload
	for cursor.Next(ctx) {
		var stored mRevision
		if err := cursor.Decode(&stored); err != nil {
			return nil, err
		}
		upload := &versions.DraftUpload{NodeUuid: stored.NodeUuid, Revision: stored.ContentRevision,
			State: stored.UploadState, Deadline: stored.UploadDeadline, CleanupOrder: stored.CleanupOrder}
		if err := versions.ValidateDraftUploadRecord(upload); err != nil {
			return nil, err
		}
		uploads = append(uploads, upload)
	}
	return uploads, cursor.Err()
}

func (m *MongoStore) StoreVersion(ctx context.Context, nodeUuid string, revision *tree.ContentRevision) error {
	if nodeUuid == "" || revision == nil || revision.VersionId == "" {
		return errors.WithMessage(errors.InvalidParameters, "version storage requires a node and version reference")
	}
	mv := &mRevision{
		NodeUuid:        nodeUuid,
		VersionId:       revision.VersionId,
		Timestamp:       time.Now().UnixNano(),
		Draft:           revision.Draft,
		OwnerUuid:       revision.OwnerUuid,
		ContentRevision: revision,
	}
	_, e := m.Collection(collVersions).InsertOne(ctx, mv)
	if mongo.IsDuplicateKeyError(e) {
		// The unique native key is the concurrency guard. Only acknowledge a
		// repeated identical revision; never overwrite another owner or result.
		stored, err := m.GetVersion(ctx, nodeUuid, revision.VersionId)
		if err != nil {
			return err
		}
		if !proto.Equal(stored, revision) {
			return errors.WithMessage(errors.StatusConflict, "native version reference already has different evidence")
		}
		return nil
	}
	return e
}

func (m *MongoStore) DeleteVersionsForNode(ctx context.Context, nodeUuid string, revisionIDs ...string) error {
	filter := bson.D{
		{"node_uuid", nodeUuid},
	}
	if len(revisionIDs) > 0 {
		filter = append(filter, bson.E{Key: "version_id", Value: bson.M{"$in": revisionIDs}})
	}
	// Keep native upload claims and their locations, including completed drafts
	// being deleted. Ordinary delete cannot make their write key reusable.
	if _, err := m.Collection(collVersions).UpdateMany(ctx,
		append(append(bson.D{}, filter...), bson.E{Key: "draft_upload_state", Value: bson.M{"$exists": true}}),
		bson.M{"$set": bson.M{"draft_upload_state": versions.DraftUploadCleanup}}); err != nil {
		return err
	}
	filter = append(filter, bson.E{Key: "draft_upload_state", Value: bson.M{"$exists": false}})
	res, e := m.Collection(collVersions).DeleteMany(ctx, filter)
	if e != nil {
		return e
	}
	log.Logger(ctx).Info(fmt.Sprintf("Deleted %d versions for node %s", res.DeletedCount, nodeUuid))
	return nil

}

func (m *MongoStore) DeleteVersionsForNodes(ctx context.Context, nodeUuid []string) error {
	for _, id := range nodeUuid {
		if err := m.DeleteVersionsForNode(ctx, id); err != nil {
			return err
		}
	}
	return nil
}

func (m *MongoStore) ListAllVersionedNodesUuids(ctx context.Context) (chan string, chan bool, chan error) {
	logs := make(chan string)
	done := make(chan bool, 1)
	errs := make(chan error)
	go func() {
		defer close(done)
		pipeline := bson.A{}
		pipeline = append(pipeline, bson.M{"$group": bson.M{"_id": "$node_uuid"}})
		allowDiskUse := true
		cursor, e := m.Collection(collVersions).Aggregate(ctx, pipeline, &options.AggregateOptions{AllowDiskUse: &allowDiskUse})
		if e != nil {
			errs <- e
			return
		}
		for cursor.Next(ctx) {
			doc := make(map[string]interface{})
			if er := cursor.Decode(&doc); er != nil {
				continue
			}
			if id, ok := doc["_id"]; ok {
				logs <- id.(string)
			}
		}
	}()
	return logs, done, errs
}

func (m *MongoStore) decodeRevision(d Decoder) (*tree.ContentRevision, error) {
	mrv := &mRevision{}
	err := d.Decode(mrv)
	if mrv.UploadState != "" {
		if err != nil {
			return nil, err
		}
		upload := &versions.DraftUpload{NodeUuid: mrv.NodeUuid, Revision: mrv.ContentRevision,
			State: mrv.UploadState, Deadline: mrv.UploadDeadline, CleanupOrder: mrv.CleanupOrder}
		if err := versions.ValidateDraftUploadRecord(upload); err != nil {
			return nil, err
		}
		if upload.State != versions.DraftUploadComplete {
			return nil, errors.WithMessage(errors.StatusConflict, "draft bytes have no completed native revision")
		}
		return upload.Revision, nil
	}
	if err == nil && mrv.ContentRevision != nil {
		return mrv.ContentRevision, nil
	}
	cv := &mVersion{}
	if err := d.Decode(cv); err == nil {
		cLog := cv.ChangeLog
		return &tree.ContentRevision{
			VersionId:   cLog.Uuid,
			Description: cLog.Description,
			MTime:       cLog.MTime,
			Size:        cLog.Size,
			ETag:        string(cLog.Data),
			OwnerName:   cLog.OwnerUuid, // This is normal
			Event:       cLog.Event,
			Location:    cLog.Location,
		}, nil
	}
	return nil, errors.New("invalid format (tree.ContentRevision or tree.ChangeLog expected)")
}
