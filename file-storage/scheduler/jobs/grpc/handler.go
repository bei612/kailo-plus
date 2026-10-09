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

package grpc

import (
	"context"
	"fmt"
	"io"
	"math"
	"strings"
	"time"

	"go.uber.org/zap"

	logcore "github.com/pydio/cells/v5/broker/log/grpc"
	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/broker"
	"github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/errors"
	proto "github.com/pydio/cells/v5/common/proto/jobs"
	log2 "github.com/pydio/cells/v5/common/proto/log"
	"github.com/pydio/cells/v5/common/runtime/manager"
	"github.com/pydio/cells/v5/common/telemetry/log"
	"github.com/pydio/cells/v5/common/utils/propagator"
	"github.com/pydio/cells/v5/common/utils/uuid"
	"github.com/pydio/cells/v5/scheduler/jobs"
	"github.com/pydio/cells/v5/scheduler/lang"
)

// JobsHandler implements the JobService API
type JobsHandler struct {
	proto.UnimplementedJobServiceServer
	proto.UnimplementedTaskServiceServer
	logcore.Handler
}

// NewJobsHandler creates a new JobsHandler
func NewJobsHandler(runtime context.Context, serviceName string) *JobsHandler {
	j := &JobsHandler{}
	j.Handler.HandlerName = serviceName
	return j
}

//////////////////
// JOBS STORE
/////////////////

// EnsureNativeActionJobs consumes one already delivered native config snapshot.
// It neither admits an action nor dispatches a Task. Unknown persistence and
// incompatible existing jobs stop startup instead of overwriting native state.
func (j *JobsHandler) EnsureNativeActionJobs(ctx context.Context) error {
	value := config.Get(ctx, "services", common.ServiceRestNamespace_+"n", "platform")
	if value.Get() == nil {
		return nil
	}
	var delivery auth.NativeWriteDelivery
	if err := value.Scan(&delivery); err != nil {
		return errors.WithStack(errors.InvalidParameters)
	}
	// An optional, absent write Job preserves the original admission-only
	// delivery. The native execute consumer still refuses without that Job ID.
	if delivery.Read == nil && delivery.Write.NativeJobID == "" {
		return nil
	}
	var expected []*proto.Job
	if delivery.Read != nil {
		if delivery.Read.Validate() != nil {
			return errors.WithStack(errors.InvalidParameters)
		}
		expected = append(expected, jobs.NativeReadJob(delivery.Read.NativeJobID))
	}
	write := delivery.Write
	if write.NativeJobID != "" {
		if strings.TrimSpace(write.NativeJobID) != write.NativeJobID || write.ActionVersion <= 0 ||
			write.NativeType == "" || strings.TrimSpace(write.NativeType) != write.NativeType ||
			!auth.NativeActorUUID(write.ResultExposurePolicyID) || write.ResultExposurePolicyVersion <= 0 ||
			(delivery.Read != nil && delivery.Read.NativeJobID == write.NativeJobID) {
			return errors.WithStack(errors.InvalidParameters)
		}
		expected = append(expected, jobs.NativeWriteJob(write.NativeJobID))
	}
	deadline, err := time.ParseDuration(delivery.RequestTimeout)
	if err != nil || deadline <= 0 {
		return errors.WithStack(errors.InvalidParameters)
	}
	ctx, cancel := context.WithTimeout(ctx, deadline)
	defer cancel()
	store, err := manager.Resolve[jobs.DAO](ctx)
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	// Validate every present Job before inserting any missing one. A drifted
	// Write Job must not leave a newly created Read Job behind (or vice versa).
	missing := make([]*proto.Job, 0, len(expected))
	for _, job := range expected {
		prior, err := store.GetJob(job.ID, proto.TaskStatus_Unknown)
		if errors.Is(err, errors.JobNotFound) {
			missing = append(missing, job)
			continue
		}
		if err != nil {
			return err
		}
		if !nativeActionJobMatches(prior, job) {
			return errors.WithStack(errors.StatusConflict)
		}
	}
	for _, job := range missing {
		if err := ctx.Err(); err != nil {
			return err
		}
		job.CreatedAt = int32(time.Now().Unix())
		job.ModifiedAt = job.CreatedAt
		if err := store.ClaimJob(ctx, job); err != nil && !errors.Is(err, errors.StatusConflict) {
			return err // even a lost insert ACK must not reach another writer
		}
		prior, err := store.GetJob(job.ID, proto.TaskStatus_Unknown)
		if err != nil {
			return err
		}
		if !nativeActionJobMatches(prior, job) {
			return errors.WithStack(errors.StatusConflict)
		}
	}
	return ctx.Err()
}

func nativeActionJobMatches(actual, expected *proto.Job) bool {
	if len(expected.Actions) == 0 {
		return jobs.NativeReadJobMatches(actual, expected.ID)
	}
	return jobs.NativeWriteJobMatches(actual, expected.ID)
}

func (j *JobsHandler) PutJob(ctx context.Context, request *proto.PutJobRequest) (*proto.PutJobResponse, error) {
	store, err := manager.Resolve[jobs.DAO](ctx)
	if err != nil {
		return nil, err
	}

	job := request.GetJob()
	job.ModifiedAt = int32(time.Now().Unix())
	if job.CreatedAt == 0 {
		job.CreatedAt = job.ModifiedAt
	}

	log.Logger(ctx).Debug("Scheduler PutJob", zap.Any("job", request.Job))
	if err := store.PutJob(job); err != nil {
		return nil, err
	}

	response := &proto.PutJobResponse{}
	response.Job = job

	broker.MustPublish(propagator.ForkedBackgroundWithMeta(ctx), common.TopicJobConfigEvent, &proto.JobChangeEvent{
		JobUpdated: job,
	})
	return response, nil
}

func (j *JobsHandler) GetJob(ctx context.Context, request *proto.GetJobRequest) (*proto.GetJobResponse, error) {
	log.Logger(ctx).Debug("Scheduler GetJob", zap.String("jobId", request.JobID))
	store, err := manager.Resolve[jobs.DAO](ctx)
	if err != nil {
		return nil, err
	}

	job, err := store.GetJob(request.JobID, request.LoadTasks)
	if err != nil {
		return nil, err
	}
	response := &proto.GetJobResponse{}
	response.Job = job
	return response, nil
}

func (j *JobsHandler) DeleteJob(ctx context.Context, request *proto.DeleteJobRequest) (*proto.DeleteJobResponse, error) {

	store, err := manager.Resolve[jobs.DAO](ctx)
	if err != nil {
		return nil, err
	}

	response := &proto.DeleteJobResponse{}
	if request.JobID != "" {
		log.Logger(ctx).Debug("Scheduler DeleteJob", zap.String("jobId", request.JobID))
		if err := store.DeleteJob(request.JobID); err != nil {
			response.Success = false
			return nil, err
		}
		bg := context.WithoutCancel(ctx)
		broker.MustPublish(bg, common.TopicJobConfigEvent, &proto.JobChangeEvent{
			JobRemoved: request.JobID,
		})
		go func() {
			if _, er := j.DeleteLogsFor(bg, request.JobID); er != nil {
				log.Logger(bg).Error("cannot delete logs for job "+request.JobID, zap.Error(er))
			}
		}()
		response.Success = true

	} else if request.CleanableJobs {

		log.Logger(ctx).Debug("Delete jobs with AutoClean that are finished")
		res, err := store.ListJobs("", false, false, proto.TaskStatus_Finished, []string{})
		if err != nil {
			return nil, err
		}
		var toDelete []string
		var deleted int32
		for job := range res {
			if job.AutoClean {
				toDelete = append(toDelete, job.ID)
			}
		}

		log.Logger(ctx).Debug("Delete jobs with AutoClean that are errored")
		res, err = store.ListJobs("", false, false, proto.TaskStatus_Error, []string{})
		if err != nil {
			return nil, err
		}
		for job := range res {
			if job.AutoClean {
				toDelete = append(toDelete, job.ID)
			}
		}

		for _, id := range toDelete {
			if e := store.DeleteJob(id); e == nil {
				deleted++
				log.Logger(ctx).Info("Deleting AutoClean Job " + id)
				bg := context.WithoutCancel(ctx)
				broker.MustPublish(bg, common.TopicJobConfigEvent, &proto.JobChangeEvent{
					JobRemoved: id,
				})
				go func() {
					if _, er := j.DeleteLogsFor(bg, id); er != nil {
						log.Logger(ctx).Error("Cannot background-delete logs for job "+id, zap.Error(er))
					}
				}()

			}
		}
		response.DeleteCount = deleted
		response.Success = true
	}
	return response, nil
}

func (j *JobsHandler) ListJobs(request *proto.ListJobsRequest, streamer proto.JobService_ListJobsServer) error {

	ctx := streamer.Context()
	log.Logger(ctx).Debug("Scheduler ListJobs", zap.Any("req", request))

	store, err := manager.Resolve[jobs.DAO](ctx)
	if err != nil {
		return err
	}

	res, err := store.ListJobs(request.Owner, request.EventsOnly, request.TimersOnly, request.LoadTasks, request.JobIDs, request.TasksOffset, request.TasksLimit)
	if err != nil {
		return err
	}

	for job := range res {
		if e := streamer.Send(&proto.ListJobsResponse{Job: job}); e != nil {
			return e
		}
	}

	return nil

}

//////////////////
// TASKS STORE
/////////////////

func (j *JobsHandler) PutTask(ctx context.Context, request *proto.PutTaskRequest) (*proto.PutTaskResponse, error) {
	if request.GetTask().GetID() == "" || request.GetTask().GetJobID() == "" {
		return nil, errors.WithMessage(errors.InvalidParameters, "Task and job references are required")
	}
	store, err := manager.Resolve[jobs.DAO](ctx)
	if err != nil {
		return nil, err
	}

	job, e := store.GetJob(request.Task.JobID, 0)
	if e != nil {
		return nil, errors.WithMessagef(e, "Cannot load job %s for task persistence", request.Task.JobID)
	}

	var persistenceError error
	if mode, exists := request.StatusMeta[jobs.TaskCreateOnly]; exists {
		if mode != "true" || !jobs.TaskHasClaim(request.Task) || request.Task.Status != proto.TaskStatus_Queued || request.Task.StartTime != 0 || request.Task.EndTime != 0 {
			return nil, errors.WithMessage(errors.InvalidParameters, "first dispatch requires an unstarted queued task")
		}
		persistenceError = store.ClaimTask(request.Task)
	} else {
		persistenceError = store.PutTask(request.Task)
	}
	if persistenceError != nil {
		return nil, persistenceError
	}
	response := &proto.PutTaskResponse{}
	response.Task = request.Task
	T := lang.Bundle().T()
	job.Label = T(job.Label)
	if !job.TasksSilentUpdate {
		broker.MustPublish(context.WithoutCancel(ctx), common.TopicJobTaskEvent, &proto.TaskChangeEvent{
			TaskUpdated: request.Task,
			Job:         job,
			NanoStamp:   time.Now().UnixNano(),
			StatusMeta:  request.StatusMeta,
		})
	}

	return response, nil
}

func (j *JobsHandler) PutTaskStream(streamer proto.JobService_PutTaskStreamServer) error {
	ctx := streamer.Context()
	for {
		request, err := streamer.Recv()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
		// A native task acknowledgement is a durable status receipt. Reuse
		// the unary writer so errors and terminal states cannot remain only
		// in a stream-local buffer after the client has received success.
		response, err := j.PutTask(ctx, request)
		if err != nil {
			return err
		}
		if err := streamer.Send(response); err != nil {
			return err
		}
	}
}

func (j *JobsHandler) ListTasks(request *proto.ListTasksRequest, streamer proto.JobService_ListTasksServer) error {

	ctx, cancel := context.WithCancel(streamer.Context())
	defer cancel()
	log.Logger(ctx).Debug("Scheduler ListTasks")

	store, err := manager.Resolve[jobs.DAO](ctx)
	if err != nil {
		return err
	}

	if request.TaskID != "" {
		task, err := store.GetTask(ctx, request.JobID, request.TaskID)
		if err != nil {
			return err
		}
		if task == nil || (request.Status != proto.TaskStatus_Any && task.Status != request.Status) {
			return ctx.Err()
		}
		return streamer.Send(&proto.ListTasksResponse{Task: task})
	}

	res, done, err := store.ListTasks(ctx, request.JobID, request.Status)
	if err != nil {
		return err
	}

	for t := range res {
		if e := streamer.Send(&proto.ListTasksResponse{Task: t}); e != nil {
			return e
		}
	}
	return <-done
}

func (j *JobsHandler) DeleteTasks(ctx context.Context, request *proto.DeleteTasksRequest) (*proto.DeleteTasksResponse, error) {

	response := &proto.DeleteTasksResponse{}

	store, err := manager.Resolve[jobs.DAO](ctx)
	if err != nil {
		return nil, err
	}

	// Delete Tasks by Status, either for one job or for all jobs
	if len(request.Status) > 0 {

		toDelete := make(map[string][]string)
		for _, status := range request.Status {

			res, done, err := store.ListTasks(ctx, request.JobId, status, request.PruneLimit)
			if err != nil {
				return nil, err
			}

			for t := range res {
				if jobs.TaskHasClaim(t) {
					continue
				}
				var tasks []string
				var has bool
				if tasks, has = toDelete[t.JobID]; !has {
					tasks = []string{t.ID}
				} else {
					tasks = append(tasks, t.ID)
				}
				toDelete[t.JobID] = tasks
			}
			if err := <-done; err != nil {
				return nil, err
			}
		}
		for jId, tasks := range toDelete {
			if e := store.DeleteTasks(jId, tasks); e != nil {
				return nil, e
			}
			response.Deleted = append(response.Deleted, tasks...)
			bg := context.WithoutCancel(ctx)
			go func(jI string, tt ...string) {
				j.DeleteLogsFor(bg, jI, tt...)
			}(jId, tasks...)
		}
		return response, nil

	} else if request.JobId != "" && len(request.TaskID) > 0 {

		if e := store.DeleteTasks(request.JobId, request.TaskID); e == nil {
			response.Deleted = append(response.Deleted, request.TaskID...)
			bg := context.WithoutCancel(ctx)
			go func() {
				j.DeleteLogsFor(bg, request.JobId, request.TaskID...)
			}()
			return response, nil
		} else {
			return nil, e
		}

	} else {

		return nil, errors.WithMessage(errors.InvalidParameters, "DeleteTasks: provide either status values or jobId/taskId parameters")

	}

}

func (j *JobsHandler) DeleteLogsFor(ctx context.Context, job string, tasks ...string) (int64, error) {
	var req = &log2.ListLogRequest{}
	if len(tasks) == 0 {
		req.Query = "+OperationUuid:\"" + job + "*\""
	} else {
		var qs []string
		for _, task := range tasks {
			qs = append(qs, "OperationUuid:\""+job+"-"+task[:min(len(task), 8)]+"\"")
		}
		req.Query = strings.Join(qs, " ")
	}
	if resp, e := j.DeleteLogs(ctx, req); e != nil {
		log.Logger(ctx).Error("Deleting logs in background for ", zap.String("q", req.Query), zap.Error(e))
		return 0, e
	} else {
		log.Logger(ctx).Debug("Deleting logs in background for ", zap.String("q", req.Query), zap.Int64("count", resp.Deleted))

		// Re-run this same query after 5s, as logs inserts are debounced on a 3s basis and logs may have been re-inserted in-between
		go func() {
			<-time.After(5 * time.Second)
			if dr, de := j.DeleteLogs(ctx, req); de == nil && dr.Deleted > 0 {
				log.Logger(ctx).Info("Second pass for deleting logs have retrieved", zap.String("q", req.Query), zap.Int64("count", dr.Deleted))
			}
		}()

		return resp.Deleted, nil
	}
}

// OrphanLogs finds all logs older than an hour that do not belong to any known tasks
func (j *JobsHandler) OrphanLogs(ctx context.Context) (int64, error) {

	store, err := manager.Resolve[jobs.DAO](ctx)
	if err != nil {
		return 0, err
	}

	// Compute ALL known tasks logs UUIDS
	tt, done, e := store.ListTasks(ctx, "", proto.TaskStatus_Any)
	if e != nil {
		return 0, e
	}
	var ii []string
	for t := range tt {
		ii = append(ii, t.JobID+"-"+t.ID[:min(len(t.ID), 8)])
	}
	if err := <-done; err != nil {
		return 0, err
	}
	query := store.BuildOrphanLogsQuery(60*time.Minute, ii)

	resp, err := j.DeleteLogs(ctx, &log2.ListLogRequest{Query: query})
	if err != nil {
		return 0, err
	}

	return resp.Deleted, nil
}

// DetectStuckTasks calls CleanStuckTasks with default duration
func (j *JobsHandler) DetectStuckTasks(ctx context.Context, request *proto.DetectStuckTasksRequest) (*proto.DetectStuckTasksResponse, error) {

	since := request.Since
	var durations []time.Duration
	if since > 0 {
		durations = append(durations, time.Duration(since)*time.Second)
	}
	tasks, e := j.CleanStuckTasks(ctx, false, log.TasksLogger(ctx), durations...)
	if e != nil {
		return nil, e
	}
	response := &proto.DetectStuckTasksResponse{}
	for _, t := range tasks {
		response.FixedTaskIds = append(response.FixedTaskIds, t.ID)
	}

	if ol, e := j.OrphanLogs(ctx); e != nil {
		log.TasksLogger(ctx).Error("Could not perform OrphanLogs", zap.Error(e))
	} else if ol > 0 {
		log.TasksLogger(ctx).Info(fmt.Sprintf("Cleaned %d orphan logs", ol))
	}

	return response, nil
}

// CleanStuckTasks may be run at startup to find orphan tasks and their corresponding logs, then find orphan logs as well
func (j *JobsHandler) CleanStuckTasks(ctx context.Context, serverStart bool, logger log.ZapLogger, duration ...time.Duration) ([]*proto.Task, error) {

	store, err := manager.Resolve[jobs.DAO](ctx)
	if err != nil {
		return nil, err
	}

	if tt, er := store.FindOrphans(); er != nil {

		logger.Warn("Cannot perform FindOrphans", zap.Error(er))

	} else if len(tt) > 0 {
		// Create sample
		maxSize := int(math.Min(float64(len(tt)), 5))
		logger.Debug(fmt.Sprintf("There are %d orphan tasks to clean!", len(tt)), log.DangerouslyZapSmallSlice("sample", tt[:maxSize]))
		logsCount := 0
		for _, t := range tt {
			if er := store.DeleteTasks(t.JobID, []string{t.ID}); er != nil {
				logger.Error("Cannot perform DeleteTasks", zap.Error(er))
			} else if logs, e := j.DeleteLogsFor(ctx, t.JobID, t.ID); e == nil {
				logsCount += int(logs)
			}
		}
		logger.Info(fmt.Sprintf("Removed %d orphan tasks and their corresponding %d logs", len(tt), logsCount))
	}

	var fixed []*proto.Task

	if running, shouldRetry, er := j.cleanStuckByStatus(ctx, serverStart, logger, proto.TaskStatus_Running, false, duration...); er == nil {
		fixed = append(fixed, running...)
		if shouldRetry {
			logger.Info("Some tasks were killed, waiting 5s before retrying clean operation")
			<-time.After(5 * time.Second)
			rr, _, err := j.cleanStuckByStatus(ctx, serverStart, logger, proto.TaskStatus_Running, true, duration...)
			if err != nil {
				return fixed, err
			}
			fixed = append(fixed, rr...)
		}
	} else {
		logger.Error("Error while cleaning Running tasks", zap.Error(er))
		return fixed, er
	}

	if serverStart { // This is launched at startup, clean other stuck statuses as well
		if paused, _, er := j.cleanStuckByStatus(ctx, serverStart, logger, proto.TaskStatus_Paused, false); er == nil {
			fixed = append(fixed, paused...)
		} else {
			logger.Error("Error while cleaning paused tasks", zap.Error(er))
			return fixed, er
		}
	}

	return fixed, nil
}

func (j *JobsHandler) cleanStuckByStatus(ctx context.Context, serverStart bool, logger log.ZapLogger, status proto.TaskStatus, isRetry bool, duration ...time.Duration) ([]*proto.Task, bool, error) {

	store, err := manager.Resolve[jobs.DAO](ctx)
	if err != nil {
		return nil, false, err
	}

	tcli := proto.NewTaskServiceClient(grpc.ResolveConn(ctx, common.ServiceTasksGRPC))
	shouldRetry := false
	var currentTaskID string
	if mm, ok := propagator.FromContextRead(ctx); ok {
		currentTaskID = mm[common.CtxMetaTaskUuid]
	}
	if !isRetry {
		if len(duration) > 0 {
			logger.Info("Clean tasks with status " + status.String() + " and check duration " + duration[0].String())
		} else {
			logger.Info("Clean tasks with status " + status.String())
		}
	}

	var fixedTasks []*proto.Task
	res, done, err := store.ListTasks(ctx, "", status)
	if err != nil {
		return fixedTasks, false, err
	}
	for t := range res {
		// The original claim belongs to an admitted external execution. A local
		// restart or timeout is not terminal evidence and cannot stop or retire it.
		if jobs.TaskHasClaim(t) {
			continue
		}

		// Ignore if current task is in fact this task !
		if t.ID == currentTaskID {
			logger.Info("Ignore my own task!")
			continue
		}

		// Load corresponding job
		job, e := store.GetJob(t.JobID, proto.TaskStatus_Unknown)
		if e != nil {
			continue
		}

		// AutoRestart Jobs Case
		if job.AutoRestart {
			if serverStart {
				logger.Warn("Should now restart " + job.Label)
				// Mark as complete, not Error
				t.Status = proto.TaskStatus_Interrupted
				t.StatusMessage = "Task restarted"
				t.EndTime = int32(time.Now().Unix())
				fixedTasks = append(fixedTasks, t)
			} else {
				logger.Info("Ignoring running task for " + job.Label + " as it is not stuck ")
			}
			continue
		}

		var runningTimeOvertime bool
		if status == proto.TaskStatus_Running && !serverStart {
			if len(duration) > 0 && t.StartTime > 0 && job.Timeout == "" {
				check := duration[0]
				startTime := time.Unix(int64(t.StartTime), 0)
				runningTimeOvertime = time.Since(startTime) > check
			}
			if !runningTimeOvertime {
				continue
			}
		}

		// Send a stop signal to kill the task and flag a retry is required
		if !serverStart && !isRetry && runningTimeOvertime {
			logger.Info("Kill task for job " + job.Label + " as it is running for more than " + duration[0].String() + " (no timeout set)")
			_, e := tcli.Control(ctx, &proto.CtrlCommand{
				Cmd:    proto.Command_Stop,
				JobId:  t.JobID,
				TaskId: t.ID,
			})
			if e != nil {
				logger.Warn("Could not send Stop command on stuck running task", zap.Error(e))
			}
			shouldRetry = true
			continue
		}
		// Finally forcefully change task status
		t.Status = proto.TaskStatus_Error
		t.StatusMessage = "Task stuck"
		t.EndTime = int32(time.Now().Unix())
		logger.Info("Setting task " + job.Label + "/" + t.ID + " in error status as it was saved as running")
		fixedTasks = append(fixedTasks, t)
	}
	if err := <-done; err != nil {
		return nil, false, err
	}
	for _, t := range fixedTasks {
		if err := store.PutTask(t); err != nil {
			return nil, false, err
		}
	}
	return fixedTasks, shouldRetry, nil

}

// CleanDeadUserJobs finds AutoStart+AutoClean user-scope jobs that were never started
func (j *JobsHandler) CleanDeadUserJobs(ctx context.Context) error {
	store, err := manager.Resolve[jobs.DAO](ctx)
	if err != nil {
		return err
	}

	jj, er := store.ListJobs("", false, false, proto.TaskStatus_Any, []string{}, 0, 1)
	if er != nil {
		return er
	}
	for job := range jj {
		if job.Owner == common.PydioSystemUsername {
			continue
		}
		if job.AutoStart && job.AutoClean && len(job.Tasks) == 0 { // This job should not have this status on restart !
			log.Logger(ctx).Info("Setting userspace job " + job.ID + " in error status as it was empty")
			_ = store.PutTask(&proto.Task{
				ID:            uuid.New(),
				JobID:         job.ID,
				Status:        proto.TaskStatus_Error,
				StatusMessage: "Task stuck",
			})
		}
	}
	return nil
}

// ListAutoRestartJobs filters the list of restartable jobs
func (j *JobsHandler) ListAutoRestartJobs(ctx context.Context) (out []*proto.Job, er error) {
	store, err := manager.Resolve[jobs.DAO](ctx)
	if err != nil {
		return nil, err
	}

	jj, e := store.ListJobs("", false, false, proto.TaskStatus_Unknown, nil)
	if e != nil {
		return nil, e
	}
	for jo := range jj {
		if !jo.AutoRestart {
			continue
		}
		out = append(out, jo)
	}
	return
}
