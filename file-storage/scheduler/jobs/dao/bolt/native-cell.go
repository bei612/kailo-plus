package bolt

import (
	"context"
	"github.com/pydio/cells/v5/common/errors"
	proto "github.com/pydio/cells/v5/common/proto/jobs"
	json "github.com/pydio/cells/v5/common/utils/jsonx"
	"github.com/pydio/cells/v5/scheduler/jobs"
	"go.etcd.io/bbolt"
	gproto "google.golang.org/protobuf/proto"
)

// The original Bolt writer transaction covers both the Inactive fence and all
// Task claims. Receipt/status updates remain permitted after the fence.
func (s *boltStore) SnapshotNativeCells(ctx context.Context, binding string, generation int64, currentJob string, fence bool, maxBytes int64, uploadBase ...string) ([]*proto.Job, error) {
	if binding == "" || generation <= 0 || currentJob == "" || maxBytes <= 0 {
		return nil, errors.WithStack(errors.InvalidParameters)
	}
	var result []*proto.Job
	err := s.DB.Update(func(tx *bbolt.Tx) error {
		bucket := tx.Bucket(jobsBucketKey)
		if bucket == nil {
			return errors.WithStack(errors.JobNotFound)
		}
		expected := map[string]*proto.Job{currentJob: jobs.NativeCellJob(currentJob, binding, generation)}
		if len(uploadBase) > 2 {
			return errors.WithStack(errors.InvalidParameters)
		}
		if len(uploadBase) >= 1 && uploadBase[0] != "" {
			job := jobs.NativeUploadJob(uploadBase[0], binding, generation)
			expected[job.ID] = job
		}
		if len(uploadBase) == 2 && uploadBase[1] != "" {
			job := jobs.NativeShareJob(uploadBase[1], binding, generation)
			if expected[job.ID] != nil {
				return errors.WithStack(errors.StatusConflict)
			}
			expected[job.ID] = job
		}
		// Older promotion tasks have no frozen generation. Their absence must
		// be proven in this same snapshot, never inferred from new upload Jobs.
		if len(uploadBase) >= 1 && uploadBase[0] != "" {
			if legacy := tx.Bucket([]byte(tasksBucketString + uploadBase[0])); legacy != nil {
				var scanned int64
				if err := legacy.ForEach(func(id, body []byte) error {
					if err := ctx.Err(); err != nil {
						return err
					}
					scanned += int64(len(body))
					if scanned > maxBytes {
						return errors.WithStack(errors.ServiceError)
					}
					var task proto.Task
					if err := json.Unmarshal(body, &task); err != nil {
						return err
					}
					intent, err := jobs.NativeWriteTaskIntent(&task)
					if err != nil || intent.BindingID == "" || intent.BindingID == binding || task.ID != string(id) || task.JobID != uploadBase[0] {
						return errors.WithStack(errors.StatusConflict)
					}
					return nil
				}); err != nil {
					return err
				}
			}
		}
		found := map[string]bool{}
		var size int64
		err := bucket.ForEach(func(key, value []byte) error {
			if err := ctx.Err(); err != nil {
				return err
			}
			var job proto.Job
			if err := json.Unmarshal(value, &job); err != nil {
				return err
			}
			if !jobs.IsNativeBindingJob(&job) {
				return nil
			}
			owner, gen, err := jobs.NativeBindingJobOrigin(&job)
			if err != nil {
				return err
			} // Legacy unbound jobs cannot silently disappear.
			if owner != binding || gen > generation {
				return nil
			}
			if job.ID != string(key) {
				return errors.WithStack(errors.StatusConflict)
			}
			if gen == generation && expected[job.ID] == nil {
				return errors.WithStack(errors.StatusConflict)
			}
			if expected[job.ID] != nil {
				if gen != generation {
					return errors.WithStack(errors.StatusConflict)
				}
				found[job.ID] = true
			}
			if fence {
				job.Inactive = true
			}
			size += int64(gproto.Size(&job))
			if tasks := tx.Bucket([]byte(tasksBucketString + job.ID)); tasks != nil {
				if err := tasks.ForEach(func(id, raw []byte) error {
					if err := ctx.Err(); err != nil {
						return err
					}
					var task proto.Task
					if err := json.Unmarshal(raw, &task); err != nil {
						return err
					}
					if task.ID != string(id) || task.JobID != job.ID {
						return errors.WithStack(errors.StatusConflict)
					}
					size += int64(gproto.Size(&task))
					if size > maxBytes {
						return errors.WithStack(errors.ServiceError)
					}
					job.Tasks = append(job.Tasks, &task)
					return nil
				}); err != nil {
					return err
				}
			}
			if size > maxBytes {
				return errors.WithStack(errors.ServiceError)
			}
			result = append(result, &job)
			return nil
		})
		if err != nil {
			return err
		}
		for currentJob, expectedJob := range expected {
			if !found[currentJob] {
				if !fence {
					return errors.WithStack(errors.JobNotFound)
				}
				// Cancellation can arrive before initial ClaimJob. Reserve the same
				// native identity as inactive under the ClaimJob/ClaimTask writer lock;
				// absence alone would allow a delayed create to start new work.
				if bucket.Get([]byte(currentJob)) != nil {
					return errors.WithStack(errors.StatusConflict)
				}
				if tasks := tx.Bucket([]byte(tasksBucketString + currentJob)); tasks != nil {
					if key, _ := tasks.Cursor().First(); key != nil {
						return errors.WithStack(errors.StatusConflict)
					}
				}
				job := expectedJob
				job.Inactive = true
				size += int64(gproto.Size(job))
				if size > maxBytes {
					return errors.WithStack(errors.ServiceError)
				}
				result = append(result, job)
			}
		}
		// bbolt cursor iteration must not mutate that bucket. Persist only after
		// complete enumeration, still in the SAME write transaction as ClaimTask.
		if fence {
			for _, job := range result {
				tasks := job.Tasks
				job.Tasks = nil
				data, err := json.Marshal(job)
				job.Tasks = tasks
				if err != nil {
					return err
				}
				if err = bucket.Put([]byte(job.ID), data); err != nil {
					return err
				}
			}
		}
		return ctx.Err()
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}
