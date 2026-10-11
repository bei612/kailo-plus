package mongo

import (
	"context"
	"github.com/pydio/cells/v5/common/errors"
	proto "github.com/pydio/cells/v5/common/proto/jobs"
	"github.com/pydio/cells/v5/scheduler/jobs"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"go.mongodb.org/mongo-driver/mongo/readconcern"
	"go.mongodb.org/mongo-driver/mongo/writeconcern"
	gproto "google.golang.org/protobuf/proto"
)

func nativeBindingJobsFilter() bson.M {
	return bson.M{"$or": bson.A{
		bson.M{"job.metadata." + jobs.NativeCellShareJob: bson.M{"$exists": true}},
		bson.M{"job.metadata." + jobs.NativeUploadJobMarker: bson.M{"$exists": true}},
	}}
}

func (m *mongoImpl) nativeCellTransaction(ctx context.Context, f func(mongo.SessionContext) (interface{}, error)) (interface{}, error) {
	session, err := m.Client().StartSession()
	if err != nil {
		return nil, err
	}
	defer session.EndSession(ctx)
	// Standalone/unsupported transactions fail here; never fall back to a
	// non-atomic read + insert. Only database changes occur in this callback.
	return session.WithTransaction(ctx, f, options.Transaction().SetReadConcern(readconcern.Snapshot()).SetWriteConcern(writeconcern.Majority()))
}

// Retain one original Job as the binding-wide first-claim anchor. A generation
// unique index alone cannot serialize two transactions that both saw no Job
// and insert different generations. The anchor is internal DAO coordination,
// not another Job, Task, permission or completion record.
func (m *mongoImpl) migrateNativeCellAnchors(ctx context.Context) error {
	filter := bson.M{"$or": bson.A{
		bson.M{"job.metadata." + jobs.NativeCellShareJob: bson.M{"$exists": true}},
		bson.M{"job.metadata." + jobs.NativeUploadJobMarker: bson.M{"$exists": true}},
		bson.M{"claim_binding": bson.M{"$exists": true}},
	}}
	count, err := m.Collection(collJobs).CountDocuments(ctx, filter, options.Count().SetLimit(1))
	if err != nil || count == 0 {
		// Independent installations with no NativeCell rows need no transaction.
		return err
	}
	_, err = m.nativeCellTransaction(ctx, func(tx mongo.SessionContext) (interface{}, error) {
		cursor, err := m.Collection(collJobs).Find(tx, filter)
		if err != nil {
			return nil, err
		}
		defer cursor.Close(tx)
		first := map[string]mongoJob{}
		generations := map[string]int64{}
		anchors := map[string]string{}
		for cursor.Next(tx) {
			var stored mongoJob
			if err := cursor.Decode(&stored); err != nil {
				return nil, err
			}
			binding, generation, err := jobs.NativeBindingJobOrigin(stored.Job)
			if err != nil || stored.ID != stored.Job.GetID() {
				return nil, errors.WithStack(errors.StatusConflict)
			}
			if stored.ClaimBinding != "" {
				if stored.ClaimBinding != binding || anchors[binding] != "" {
					return nil, errors.WithStack(errors.StatusConflict)
				}
				anchors[binding] = stored.ID
			}
			if prior, ok := generations[binding]; !ok || generation < prior {
				first[binding], generations[binding] = stored, generation
			}
		}
		if err := cursor.Err(); err != nil {
			return nil, err
		}
		for binding, stored := range first {
			if anchors[binding] != "" {
				continue
			}
			changed, err := m.Collection(collJobs).UpdateOne(tx,
				bson.M{"id": stored.ID, "claim_binding": bson.M{"$exists": false}},
				bson.M{"$set": bson.M{"claim_binding": binding}, "$inc": bson.M{"claim_revision": 1}})
			if err != nil {
				return nil, err
			}
			if changed.MatchedCount != 1 {
				return nil, errors.WithStack(errors.StatusConflict)
			}
		}
		return nil, nil
	})
	return err
}

func (m *mongoImpl) touchNativeCellAnchor(ctx mongo.SessionContext, binding string) (bool, error) {
	var stored mongoJob
	err := m.Collection(collJobs).FindOneAndUpdate(ctx, bson.M{"claim_binding": binding},
		bson.M{"$inc": bson.M{"claim_revision": 1}}).Decode(&stored)
	if err == mongo.ErrNoDocuments {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	owner, _, err := jobs.NativeBindingJobOrigin(stored.Job)
	if err != nil || owner != binding || stored.ID != stored.Job.GetID() {
		return false, errors.WithStack(errors.StatusConflict)
	}
	return true, nil
}

func (m *mongoImpl) claimNativeCellTask(task *proto.Task) error {
	_, err := m.nativeCellTransaction(context.Background(), func(ctx mongo.SessionContext) (interface{}, error) {
		var parent mongoJob
		if err := m.Collection(collJobs).FindOne(ctx, bson.M{"id": task.JobID}).Decode(&parent); err != nil {
			return nil, err
		}
		if _, _, err := jobs.NativeBindingJobOrigin(parent.Job); err != nil {
			return nil, err
		}
		if parent.Inactive {
			return nil, errors.WithStack(errors.StatusConflict)
		}
		// A read alone is snapshot write-skew. Claim and fence must write the SAME
		// original Job document before a task can be inserted.
		changed, err := m.Collection(collJobs).UpdateOne(ctx, bson.M{"id": task.JobID, "job.inactive": false}, bson.M{"$inc": bson.M{"claim_revision": 1}})
		if err != nil {
			return nil, err
		}
		if changed.MatchedCount != 1 {
			return nil, errors.WithStack(errors.StatusConflict)
		}
		_, err = m.Collection(collTasks).InsertOne(ctx, &mongoTask{ID: task.ID, JobId: task.JobID, Status: int(task.Status), Stamp: int64(task.StartTime), Task: task})
		return nil, err
	})
	if mongo.IsDuplicateKeyError(err) {
		return errors.WithStack(errors.StatusConflict)
	}
	return err
}

func (m *mongoImpl) claimLegacyNativeWriteTask(task *proto.Task) error {
	intent, err := jobs.NativeWriteTaskIntent(task)
	if err != nil || intent.BindingID == "" {
		return errors.WithStack(errors.StatusConflict)
	}
	_, err = m.nativeCellTransaction(context.Background(), func(tx mongo.SessionContext) (interface{}, error) {
		// Serialize with the snapshot's shared Job write, including when no
		// generation Job existed at either transaction's initial snapshot.
		changed, err := m.Collection(collJobs).UpdateOne(tx, bson.M{"id": task.JobID}, bson.M{"$inc": bson.M{"claim_revision": 1}})
		if err != nil {
			return nil, err
		}
		if changed.MatchedCount != 1 {
			return nil, errors.WithStack(errors.JobNotFound)
		}
		filter := nativeBindingJobsFilter()
		filter["job.metadata.bindingId"] = intent.BindingID
		filter["job.inactive"] = true
		count, err := m.Collection(collJobs).CountDocuments(tx, filter, options.Count().SetLimit(1))
		if err != nil {
			return nil, err
		}
		if count != 0 {
			return nil, errors.WithStack(errors.StatusConflict)
		}
		_, err = m.Collection(collTasks).InsertOne(tx, &mongoTask{ID: task.ID, JobId: task.JobID, Status: int(task.Status), Stamp: int64(task.StartTime), Task: task})
		return nil, err
	})
	if mongo.IsDuplicateKeyError(err) {
		return errors.WithStack(errors.StatusConflict)
	}
	return err
}

func (m *mongoImpl) claimNativeCellJob(ctx context.Context, job *proto.Job) error {
	binding, generation, err := jobs.NativeBindingJobOrigin(job)
	if err != nil {
		return err
	}
	_, err = m.nativeCellTransaction(ctx, func(tx mongo.SessionContext) (interface{}, error) {
		anchored, err := m.touchNativeCellAnchor(tx, binding)
		if err != nil {
			return nil, err
		}
		cursor, err := m.Collection(collJobs).Find(tx, nativeBindingJobsFilter())
		if err != nil {
			return nil, err
		}
		defer cursor.Close(tx)
		var priorIDs []string
		for cursor.Next(tx) {
			var prior mongoJob
			if err := cursor.Decode(&prior); err != nil {
				return nil, err
			}
			owner, gen, err := jobs.NativeBindingJobOrigin(prior.Job)
			if err != nil {
				return nil, err
			}
			if owner != binding {
				continue
			}
			if !anchored {
				return nil, errors.WithStack(errors.StatusConflict)
			}
			if gen > generation || (gen == generation && (prior.Inactive || jobs.NativeBindingJobKind(prior.Job) == jobs.NativeBindingJobKind(job))) {
				return nil, errors.WithStack(errors.StatusConflict)
			}
			priorIDs = append(priorIDs, prior.ID)
		}
		if err := cursor.Err(); err != nil {
			return nil, err
		}
		// Touch every retained predecessor, not only a mutable 'latest' choice.
		// This serializes concurrent generation creation and disable snapshots.
		for _, id := range priorIDs {
			changed, err := m.Collection(collJobs).UpdateOne(tx, bson.M{"id": id}, bson.M{"$inc": bson.M{"claim_revision": 1}})
			if err != nil {
				return nil, err
			}
			if changed.MatchedCount != 1 {
				return nil, errors.WithStack(errors.StatusConflict)
			}
		}
		stored := &mongoJob{ID: job.ID, Owner: job.Owner, HasEvents: false, HasSchedule: false, Job: job}
		if !anchored {
			stored.ClaimBinding = binding
		}
		_, err = m.Collection(collJobs).InsertOne(tx, stored)
		return nil, err
	})
	if mongo.IsDuplicateKeyError(err) {
		return errors.WithStack(errors.StatusConflict)
	}
	return err
}

func (m *mongoImpl) SnapshotNativeCells(ctx context.Context, binding string, generation int64, currentJob string, fence bool, maxBytes int64, uploadBase ...string) ([]*proto.Job, error) {
	if binding == "" || generation <= 0 || currentJob == "" || maxBytes <= 0 {
		return nil, errors.WithStack(errors.InvalidParameters)
	}
	value, err := m.nativeCellTransaction(ctx, func(tx mongo.SessionContext) (interface{}, error) {
		if len(uploadBase) > 1 {
			return nil, errors.WithStack(errors.InvalidParameters)
		}
		if len(uploadBase) == 1 && uploadBase[0] != "" {
			changed, err := m.Collection(collJobs).UpdateOne(tx, bson.M{"id": uploadBase[0]}, bson.M{"$inc": bson.M{"claim_revision": 1}})
			if err != nil {
				return nil, err
			}
			if changed.MatchedCount != 1 {
				return nil, errors.WithStack(errors.JobNotFound)
			}
		}
		anchored, err := m.touchNativeCellAnchor(tx, binding)
		if err != nil {
			return nil, err
		}
		cursor, err := m.Collection(collJobs).Find(tx, nativeBindingJobsFilter())
		if err != nil {
			return nil, err
		}
		defer cursor.Close(tx)
		result := []*proto.Job{}
		expected := map[string]*proto.Job{currentJob: jobs.NativeCellJob(currentJob, binding, generation)}
		if len(uploadBase) > 1 {
			return nil, errors.WithStack(errors.InvalidParameters)
		}
		if len(uploadBase) == 1 && uploadBase[0] != "" {
			job := jobs.NativeUploadJob(uploadBase[0], binding, generation)
			expected[job.ID] = job
		}
		if len(uploadBase) == 1 && uploadBase[0] != "" {
			legacy, err := m.Collection(collTasks).Find(tx, bson.M{"job_id": uploadBase[0]})
			if err != nil {
				return nil, err
			}
			defer legacy.Close(tx)
			var scanned int64
			for legacy.Next(tx) {
				var task mongoTask
				if err := legacy.Decode(&task); err != nil {
					return nil, err
				}
				scanned += int64(gproto.Size(task.Task))
				if scanned > maxBytes {
					return nil, errors.WithStack(errors.ServiceError)
				}
				intent, err := jobs.NativeWriteTaskIntent(task.Task)
				if err != nil || intent.BindingID == "" || intent.BindingID == binding || task.ID != task.Task.GetID() || task.JobId != task.Task.GetJobID() {
					return nil, errors.WithStack(errors.StatusConflict)
				}
			}
			if err := legacy.Err(); err != nil {
				return nil, err
			}
		}
		found := map[string]bool{}
		var size int64
		for cursor.Next(tx) {
			var stored mongoJob
			if err := cursor.Decode(&stored); err != nil {
				return nil, err
			}
			owner, gen, err := jobs.NativeBindingJobOrigin(stored.Job)
			if err != nil {
				return nil, err
			}
			if owner != binding {
				continue
			}
			if !anchored {
				return nil, errors.WithStack(errors.StatusConflict)
			}
			if gen > generation {
				continue
			}
			if stored.ID != stored.Job.ID {
				return nil, errors.WithStack(errors.StatusConflict)
			}
			if gen == generation && expected[stored.ID] == nil {
				return nil, errors.WithStack(errors.StatusConflict)
			}
			if expected[stored.ID] != nil {
				if gen != generation {
					return nil, errors.WithStack(errors.StatusConflict)
				}
				found[stored.ID] = true
			}
			if fence {
				changed, err := m.Collection(collJobs).UpdateOne(tx, bson.M{"id": stored.ID}, bson.M{"$set": bson.M{"job.inactive": true}, "$inc": bson.M{"claim_revision": 1}})
				if err != nil {
					return nil, err
				}
				if changed.MatchedCount != 1 {
					return nil, errors.WithStack(errors.StatusConflict)
				}
				stored.Inactive = true
			}
			size += int64(gproto.Size(stored.Job))
			tasks, err := m.Collection(collTasks).Find(tx, bson.M{"job_id": stored.ID})
			if err != nil {
				return nil, err
			}
			for tasks.Next(tx) {
				var item mongoTask
				if err = tasks.Decode(&item); err != nil {
					break
				}
				if item.Task == nil || item.ID != item.Task.ID || item.JobId != stored.ID || item.Task.JobID != stored.ID {
					err = errors.WithStack(errors.StatusConflict)
					break
				}
				size += int64(gproto.Size(item.Task))
				if size > maxBytes {
					err = errors.WithStack(errors.ServiceError)
					break
				}
				stored.Tasks = append(stored.Tasks, item.Task)
			}
			if err == nil {
				err = tasks.Err()
			}
			closeErr := tasks.Close(tx)
			if err != nil {
				return nil, err
			}
			if closeErr != nil {
				return nil, closeErr
			}
			if size > maxBytes {
				return nil, errors.WithStack(errors.ServiceError)
			}
			result = append(result, stored.Job)
		}
		if err = cursor.Err(); err != nil {
			return nil, err
		}
		for currentJob, expectedJob := range expected {
			if !found[currentJob] {
				if !fence {
					return nil, errors.WithStack(errors.JobNotFound)
				}
				// Persist the original Job identity before acknowledging an empty
				// cancellation snapshot. The unique Job/generation indexes serialize
				// a racing initial ClaimJob; no synthetic Task or terminal receipt is made.
				if err := m.Collection(collJobs).FindOne(tx, bson.M{"id": currentJob}).Err(); err == nil {
					return nil, errors.WithStack(errors.StatusConflict)
				} else if err != mongo.ErrNoDocuments {
					return nil, err
				}
				if err := m.Collection(collTasks).FindOne(tx, bson.M{"job_id": currentJob}).Err(); err == nil {
					return nil, errors.WithStack(errors.StatusConflict)
				} else if err != mongo.ErrNoDocuments {
					return nil, err
				}
				job := expectedJob
				job.Inactive = true
				size += int64(gproto.Size(job))
				if size > maxBytes {
					return nil, errors.WithStack(errors.ServiceError)
				}
				stored := &mongoJob{ID: job.ID, Owner: job.Owner, Job: job}
				if !anchored {
					stored.ClaimBinding = binding
				}
				if _, err := m.Collection(collJobs).InsertOne(tx, stored); err != nil {
					return nil, err
				}
				anchored = true
				result = append(result, job)
			}
		}
		return result, nil
	})
	if mongo.IsDuplicateKeyError(err) {
		return nil, errors.WithStack(errors.StatusConflict)
	}
	if err != nil {
		return nil, err
	}
	return value.([]*proto.Job), nil
}
