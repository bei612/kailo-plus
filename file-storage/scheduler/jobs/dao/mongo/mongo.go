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

	"github.com/pydio/cells/v5/common/errors"
	proto "github.com/pydio/cells/v5/common/proto/jobs"
	"github.com/pydio/cells/v5/common/storage/mongodb"
	"github.com/pydio/cells/v5/common/utils/kv"
	"github.com/pydio/cells/v5/scheduler/jobs"
)

const (
	collJobs        = "jobs"
	collTasks       = "tasks"
	claimMarkerPath = "task.actionslogs.0.inputmessage.outputchain.0.vars." + jobs.TaskCreateOnly
)

var (
	model = &mongodb.Model{
		Collections: []mongodb.Collection{
			{
				Name: collJobs,
				Indexes: []map[string]int{
					{"id": 1},
					{"owner": 1, "has_events": 1, "has_schedule": 1},
				},
			},
			{
				Name: collTasks,
				Indexes: []map[string]int{
					{"job_id": 1, "ts": -1},
					{"status": 1, "ts": -1},
					{"job_id": 1, "status": 1, "ts": -1},
				},
			},
		},
	}
)

type mongoJob struct {
	ID          string `bson:"id"`
	Owner       string `bson:"owner"`
	HasEvents   bool   `bson:"has_events"`
	HasSchedule bool   `bson:"has_schedule"`
	*proto.Job
}

type mongoTask struct {
	ID     string `bson:"id"`
	JobId  string `bson:"job_id"`
	Status int    `bson:"status"`
	Stamp  int64  `bson:"ts"`
	*proto.Task
}

func init() {
	jobs.Drivers.Register(NewMongoDAO)
}

func NewMongoDAO(db *mongodb.Indexer) jobs.DAO {
	return &mongoImpl{Database: db.Database}
}

type mongoImpl struct {
	*mongodb.Database
}

func (m *mongoImpl) Init(ctx context.Context, values kv.Values) error {
	if err := model.Init(ctx, m.Database); err != nil {
		return err
	}
	return m.Migrate(ctx)
}

// Duplicated historical references stop startup rather than select or overwrite
// a task. The unique native key is also the concurrent first-dispatch fence.
func (m *mongoImpl) Migrate(ctx context.Context) error {
	if _, err := m.Collection(collTasks).Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "id", Value: 1}},
		Options: options.Index().SetName("native_task_reference").SetUnique(true),
	}); err != nil {
		return err
	}
	_, err := m.Collection(collJobs).Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "id", Value: 1}},
		Options: options.Index().SetName("native_job_reference").SetUnique(true),
	})
	return err
}

func (m *mongoImpl) ClaimJob(ctx context.Context, job *proto.Job) error {
	if job == nil || job.ID == "" || len(job.Tasks) != 0 {
		return errors.WithStack(errors.InvalidParameters)
	}
	_, err := m.Collection(collJobs).InsertOne(ctx, &mongoJob{ID: job.ID, Owner: job.Owner,
		HasEvents: len(job.EventNames) > 0, HasSchedule: job.Schedule != nil, Job: job})
	if mongo.IsDuplicateKeyError(err) {
		return errors.WithStack(errors.StatusConflict)
	}
	return err
}

func (m *mongoImpl) PutJob(job *proto.Job) error {
	c := context.Background()
	// do not store tasks inside job
	mj := &mongoJob{
		ID:          job.ID,
		Owner:       job.Owner,
		HasEvents:   len(job.EventNames) > 0,
		HasSchedule: job.Schedule != nil,
		Job:         job,
	}
	mj.Job.Tasks = nil
	upsert := true
	_, e := m.Collection(collJobs).ReplaceOne(c, bson.D{{"id", job.ID}}, mj, &options.ReplaceOptions{Upsert: &upsert})
	return e
}

func (m *mongoImpl) GetJob(jobId string, withTasks proto.TaskStatus) (*proto.Job, error) {
	c := context.Background()
	res := m.Collection(collJobs).FindOne(c, bson.D{{"id", jobId}})
	if res.Err() != nil {
		if strings.Contains(res.Err().Error(), "no documents in result") {
			return nil, errors.WithStack(errors.JobNotFound)
		}
		return nil, res.Err()
	}
	mj := &mongoJob{}
	if er := res.Decode(&mj); er != nil {
		return nil, er
	}
	if withTasks != proto.TaskStatus_Unknown {
		tt, e := m.listTasks(context.Background(), jobId, withTasks, 0, 0)
		if e != nil {
			return nil, e
		}
		mj.Job.Tasks = tt
	}
	return mj.Job, nil
}

func (m *mongoImpl) DeleteJob(jobId string) error {
	c := context.Background()
	protected, err := m.Collection(collTasks).CountDocuments(c, bson.D{{Key: "job_id", Value: jobId}, {Key: claimMarkerPath, Value: "true"}})
	if err != nil {
		return err
	}
	if protected != 0 {
		return errors.WithMessage(errors.StatusConflict, "native task operation evidence must be retained")
	}

	// The predicate is enforced by the actual deletion too: a concurrent claim
	// must never be removed after the pre-read. Job survival across collections
	// is not an atomic guarantee on standalone Mongo.
	if _, e := m.Collection(collTasks).DeleteMany(c, bson.D{{Key: "job_id", Value: jobId}, {Key: claimMarkerPath, Value: bson.M{"$ne": "true"}}}); e != nil {
		return e
	}

	// Now delete job
	if _, e := m.Collection(collJobs).DeleteOne(c, bson.D{{"id", jobId}}); e != nil {
		return e
	}

	//fmt.Println("Delete", res.DeletedCount, "job")
	return nil
}

func (m *mongoImpl) ListJobs(owner string, eventsOnly bool, timersOnly bool, withTasks proto.TaskStatus, jobIDs []string, taskCursor ...int32) (chan *proto.Job, error) {
	c := context.Background()
	filter := bson.D{}
	if owner != "" {
		filter = append(filter, bson.E{Key: "owner", Value: owner})
	}
	if eventsOnly {
		filter = append(filter, bson.E{Key: "has_events", Value: true})
	} else if timersOnly {
		filter = append(filter, bson.E{Key: "has_schedule", Value: true})
	}
	if len(jobIDs) > 0 {
		filter = append(filter, bson.E{Key: "id", Value: bson.M{"$in": jobIDs}})
	}
	cursor, er := m.Collection(collJobs).Find(c, filter)
	if er != nil {
		return nil, er
	}
	cj := make(chan *proto.Job)

	var offset, limit int64
	if len(taskCursor) > 0 {
		offset = int64(taskCursor[0])
		if len(taskCursor) > 1 {
			limit = int64(taskCursor[1])
		}
	}

	go func() {
		defer close(cj)
		for cursor.Next(context.Background()) {
			mj := &mongoJob{}
			if er := cursor.Decode(&mj); er != nil {
				continue
			}
			if withTasks != proto.TaskStatus_Unknown {
				if co, e := m.countTasksForJob(mj.ID, withTasks); e != nil || (withTasks != proto.TaskStatus_Any && co == 0) {
					continue
				}
				if tt, e := m.listTasks(context.Background(), mj.ID, withTasks, offset, limit); e == nil {
					mj.Job.Tasks = tt
				}
			}
			cj <- mj.Job
		}
	}()

	return cj, nil

}

func (m *mongoImpl) ClaimTask(task *proto.Task) error {
	if task.GetID() == "" || task.GetJobID() == "" {
		return errors.WithMessage(errors.InvalidParameters, "task and job references are required")
	}
	jobs.StripTaskData(task)
	_, err := m.Collection(collTasks).InsertOne(context.Background(), &mongoTask{
		ID: task.ID, JobId: task.JobID, Status: int(task.Status), Stamp: int64(task.StartTime), Task: task,
	})
	if mongo.IsDuplicateKeyError(err) {
		return errors.WithMessage(errors.StatusConflict, "native task reference already exists")
	}
	return err
}

func (m *mongoImpl) PutTask(task *proto.Task) error {
	c := context.Background()
	// do not store tasks inside job
	jobs.StripTaskData(task)
	mj := &mongoTask{
		ID:     task.ID,
		JobId:  task.JobID,
		Status: int(task.Status),
		Stamp:  int64(task.StartTime),
		Task:   task,
	}
	stored := &mongoTask{}
	err := m.Collection(collTasks).FindOne(c, bson.D{{Key: "id", Value: task.ID}}).Decode(stored)
	if errors.Is(err, mongo.ErrNoDocuments) {
		if jobs.TaskHasClaim(task) {
			return errors.WithMessage(errors.StatusConflict, "native first-dispatch claim is required before status persistence")
		}
		_, err = m.Collection(collTasks).InsertOne(c, mj)
		if mongo.IsDuplicateKeyError(err) {
			return errors.WithMessage(errors.StatusConflict, "native task reference was concurrently created")
		}
		return err
	}
	if err != nil {
		return err
	}
	if err := jobs.ValidateTaskUpdate(stored.Task, task); err != nil {
		return err
	}
	// Match the original immutable identity as part of the write, not only a
	// pre-read. A first-dispatch receipt cannot be replaced by a status writer.
	filter := bson.D{{Key: "id", Value: task.ID}, {Key: "job_id", Value: stored.JobId}, {Key: "task.triggerowner", Value: stored.Task.TriggerOwner}}
	filter = append(filter, bson.E{Key: "task.actionslogs", Value: stored.Task.ActionsLogs})
	result, err := m.Collection(collTasks).ReplaceOne(c, filter, mj)
	if err != nil {
		return err
	}
	if result.MatchedCount != 1 {
		return errors.WithMessage(errors.StatusConflict, "native task identity changed before persistence")
	}
	return nil
}

func (m *mongoImpl) PutTasks(tasks map[string]map[string]*proto.Task) error {
	for _, tt := range tasks {
		for _, t := range tt {
			if err := m.PutTask(t); err != nil {
				return err
			}
		}
	}
	return nil
}

func (m *mongoImpl) ListTasks(ctx context.Context, jobId string, taskStatus proto.TaskStatus, cursor ...int32) (<-chan *proto.Task, <-chan error, error) {
	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	var offset, limit int64
	if len(cursor) > 0 {
		offset = int64(cursor[0])
		if len(cursor) > 1 {
			limit = int64(cursor[1])
		}
	}

	var tt []*proto.Task
	var er error
	// If there is a cursor and **jobId is empty**, we want to apply cursor on each task
	if jobId == "" && len(cursor) > 0 {
		jj, e := m.Collection(collJobs).Find(ctx, bson.D{})
		if e != nil {
			return nil, nil, e
		}
		defer jj.Close(ctx)
		for jj.Next(ctx) {
			j := &mongoJob{}
			if err := jj.Decode(j); err != nil {
				return nil, nil, err
			}
			tj, err := m.listTasks(ctx, j.ID, taskStatus, offset, limit)
			if err != nil {
				return nil, nil, err
			}
			tt = append(tt, tj...)
		}
		if err := jj.Err(); err != nil {
			return nil, nil, err
		}
	} else {
		tt, er = m.listTasks(ctx, jobId, taskStatus, offset, limit)
		if er != nil {
			return nil, nil, er
		}
	}

	cj := make(chan *proto.Task)
	cd := make(chan error, 1)
	go func() {
		defer close(cd)
		for _, t := range tt {
			select {
			case cj <- t:
			case <-ctx.Done():
				close(cj)
				cd <- ctx.Err()
				return
			}
		}
		close(cj)
		cd <- ctx.Err()
	}()
	return cj, cd, nil
}

// FindOrphans provides an additional hook to detect lost tasks
func (m *mongoImpl) FindOrphans() ([]*proto.Task, error) {
	// Gather all jobs IDs
	jj, e := m.ListJobs("", false, false, proto.TaskStatus_Unknown, []string{})
	if e != nil {
		return nil, e
	}
	var tIds []*proto.Task
	var jIds []string
	for j := range jj {
		jIds = append(jIds, j.ID)
	}
	if len(jIds) == 0 {
		return tIds, nil
	}
	// Lookup all tasks referring an unknown job_id !
	c := context.Background()
	filter := bson.D{{"job_id", bson.M{"$nin": jIds}}}
	cursor, e := m.Collection(collTasks).Find(c, filter)
	if e != nil {
		return nil, e
	}
	for cursor.Next(c) {
		mj := &mongoTask{}
		if er := cursor.Decode(mj); er != nil {
			continue
		}
		tIds = append(tIds, &proto.Task{ID: mj.ID, JobID: mj.JobId})
	}
	return tIds, nil
}

func (m *mongoImpl) BuildOrphanLogsQuery(since time.Duration, all []string) string {
	ids := fmt.Sprintf("+Ts:<%d", time.Now().Add(-since).Unix())
	return ids + " -OperationUuid:[" + strings.Join(all, ",") + "]"
}

func (m *mongoImpl) DeleteTasks(jobId string, taskId []string) error {
	filter := bson.D{{Key: "job_id", Value: jobId}, {Key: "id", Value: bson.M{"$in": taskId}}}
	protectedFilter := append(append(bson.D{}, filter...), bson.E{Key: claimMarkerPath, Value: "true"})
	protected, err := m.Collection(collTasks).CountDocuments(context.Background(), protectedFilter)
	if err != nil {
		return err
	}
	if protected != 0 {
		return errors.WithMessage(errors.StatusConflict, "native task operation evidence must be retained")
	}
	filter = append(filter, bson.E{Key: claimMarkerPath, Value: bson.M{"$ne": "true"}})
	_, e := m.Collection(collTasks).DeleteMany(context.Background(), filter)
	if e != nil {
		return e
	}
	//fmt.Println("Deleted", res.DeletedCount, "tasks")
	return nil
}

func (m *mongoImpl) listTasks(c context.Context, jobId string, status proto.TaskStatus, offset, limit int64) (tasks []*proto.Task, e error) {
	filter := bson.D{}
	if jobId != "" {
		filter = append(filter, bson.E{"job_id", jobId})
	}
	if status != proto.TaskStatus_Any {
		filter = append(filter, bson.E{"status", int(status)})
	}
	findOpts := &options.FindOptions{
		Sort: bson.M{"ts": -1},
	}
	if offset > 0 {
		findOpts.Skip = &offset
	}
	if limit > 0 {
		findOpts.Limit = &limit
	}
	cursor, e := m.Collection(collTasks).Find(c, filter, findOpts)
	if e != nil {
		return tasks, e
	}
	defer cursor.Close(c)
	for cursor.Next(c) {
		mj := &mongoTask{}
		if er := cursor.Decode(mj); er != nil {
			return nil, er
		}
		if mj.Task == nil || mj.Task.ID == "" || mj.ID != mj.Task.ID || mj.Task.JobID != mj.JobId {
			return nil, errors.WithStack(errors.StatusConflict)
		}
		jobs.StripTaskData(mj.Task)
		tasks = append(tasks, mj.Task)
	}
	return tasks, cursor.Err()
}

func (m *mongoImpl) countTasksForJob(jobId string, status proto.TaskStatus) (count int64, e error) {
	filter := bson.D{}
	if jobId != "" {
		filter = append(filter, bson.E{"job_id", jobId})
	}
	if status != proto.TaskStatus_Any {
		filter = append(filter, bson.E{"status", int(status)})
	}
	c := context.Background()
	co, e := m.Collection(collTasks).CountDocuments(c, filter, &options.CountOptions{})
	if e != nil {
		return 0, e
	}
	return co, e
}
