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

package tasks

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sync"
	"sync/atomic"
	"time"

	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth/claim"
	"github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/proto/jobs"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/common/telemetry/log"
	"github.com/pydio/cells/v5/common/utils/propagator"
	"github.com/pydio/cells/v5/common/utils/slug"
	"github.com/pydio/cells/v5/common/utils/uuid"
	"github.com/pydio/cells/v5/scheduler/actions"
	jobstore "github.com/pydio/cells/v5/scheduler/jobs"
)

type Task struct {
	*jobs.Job
	runID string

	context  context.Context
	cancel   context.CancelFunc
	finished chan bool
	span     trace.Span

	rci atomic.Int32

	chi int
	di  int

	event         interface{}
	task          *jobs.Task
	claimRequired bool
	resultMu      sync.Mutex

	lastStatus                    jobs.TaskStatus
	lastStatusMsg                 string
	lastHasProgress, lastCanPause bool
	lastProgress                  float32

	err error
}

// NewTaskFromEvent creates a task based on incoming job and event
func NewTaskFromEvent(ctx context.Context, job *jobs.Job, event interface{}) *Task {
	// Cache refreshes and the incoming broker message must not mutate the
	// definition/parameters after the native first-dispatch claim is persisted.
	job = proto.Clone(job).(*jobs.Job)
	job.Tasks = nil
	if message, ok := event.(proto.Message); ok {
		event = proto.Clone(message)
	}
	log.Logger(ctx).Debug("NewTaskFromEvent " + job.ID)
	ctxUserName := claim.UserNameFromContext(ctx)
	taskID := uuid.New()
	if trigger, ok := event.(*jobs.JobTriggerEvent); ok && trigger.RunTaskId != "" {
		taskID = trigger.RunTaskId
	}
	prefix := taskID
	if len(prefix) > 8 {
		prefix = prefix[:8]
	}
	operationID := job.ID + "-" + prefix
	c := propagator.WithAdditionalMetadata(ctx, map[string]string{common.CtxSchedulerOperationId: operationID})

	span := trace.SpanFromContext(ctx)
	c, span = span.TracerProvider().Tracer("cells").Start(c, "/scheduler/"+slug.Make(job.Label), trace.WithNewRoot())

	// Inject evaluated job parameters if it's not already here
	if c.Value(ContextJobParametersKey{}) == nil {
		params := jobs.RunParametersComputer(c, &jobs.ActionMessage{}, job, event)
		c = context.WithValue(c, ContextJobParametersKey{}, params)
	}
	if params, ok := c.Value(ContextJobParametersKey{}).(map[string]string); ok {
		frozen := make(map[string]string, len(params))
		for key, value := range params {
			frozen[key] = value
		}
		c = context.WithValue(c, ContextJobParametersKey{}, frozen)
	}

	t := &Task{
		context:  c,
		Job:      job,
		runID:    taskID,
		finished: make(chan bool, 1),
		span:     span,
		event:    event,
		task: &jobs.Task{
			ID:            taskID,
			JobID:         job.ID,
			Status:        jobs.TaskStatus_Queued,
			StatusMessage: "Pending",
			TriggerOwner:  ctxUserName,
			CanStop:       true,
		},
	}
	if trigger, ok := event.(*jobs.JobTriggerEvent); ok && trigger.RunTaskId != "" {
		t.claimRequired = true
		// Only a digest of the frozen input is retained in the original task;
		// job parameters and credentials are not copied into its public logs.
		definition, definitionError := proto.MarshalOptions{Deterministic: true}.Marshal(job)
		triggerBytes, triggerError := proto.MarshalOptions{Deterministic: true}.Marshal(trigger)
		parameters, parameterError := json.Marshal(c.Value(ContextJobParametersKey{}))
		jobDigest, jobDigestError := jobstore.NativeJobDefinitionDigest(job)
		if definitionError != nil || triggerError != nil || parameterError != nil || jobDigestError != nil {
			t.err = errors.WithMessage(errors.InvalidParameters, "native task input cannot be frozen")
		} else {
			input, _ := json.Marshal([][]byte{definition, triggerBytes, parameters, []byte(ctxUserName)})
			digest := sha256.Sum256(input)
			receipt, _ := json.Marshal(map[string]string{"requestDigest": hex.EncodeToString(digest[:]), "jobDigest": jobDigest})
			t.task.ActionsLogs = []*jobs.ActionLog{{InputMessage: &jobs.ActionMessage{OutputChain: []*jobs.ActionOutput{{JsonBody: receipt, Vars: map[string]string{jobstore.TaskCreateOnly: "true"}}}}}}
		}
	}

	return t
}

// Queue send this new task to the dispatcher queue.
// If a second queue is passed, it may differ from main input queue, so it is used for children queuing
func (t *Task) Queue(queue ...chan RunnerFunc) (dispatchError error) {
	defer func() {
		if dispatchError != nil && t.span != nil {
			t.span.End()
		}
	}()
	if len(queue) == 0 || queue[0] == nil {
		return errors.WithMessage(errors.InvalidParameters, "native dispatch queue is required")
	}
	if t.err != nil {
		return t.err
	}
	if err := jobstore.AuthorizeNativeDeleteDispatch(t.context, t.Job, t.event); err != nil {
		return err
	}
	if t.claimRequired {
		client := jobs.NewJobServiceClient(grpc.ResolveConn(t.context, common.ServiceJobsGRPC))
		claimed := t.Clone()
		response, err := client.PutTask(t.context, &jobs.PutTaskRequest{
			Task: claimed, StatusMeta: map[string]string{jobstore.TaskCreateOnly: "true"},
		})
		if err != nil {
			return err
		}
		if !proto.Equal(response.GetTask(), claimed) {
			return errors.WithMessage(errors.StatusConflict, "native first-dispatch persistence was not acknowledged")
		}
		t.context = context.WithValue(t.context, jobstore.ClaimedTaskContextKey{}, true)
	}
	if d, o := itemTimeout(t.context, t.Job.Timeout); o {
		t.context, t.cancel = context.WithTimeout(t.context, d)
	} else {
		t.context, t.cancel = context.WithCancel(t.context)
	}
	jobId := t.Job.ID
	taskId := t.runID

	bus := GetBus(t.context)
	ch := bus.Sub(PubSubTopicControl)
	go func() {
		defer func() {
			bus.UnSubWithFlush(ch, PubSubTopicControl)
		}()
		for {
			select {
			case <-t.finished:
				return
			case <-t.context.Done():
				t.cancel()
				return
			case val := <-ch:
				cmd, ok := val.(*jobs.CtrlCommand)
				if !ok {
					continue
				}
				if cmd.TaskId != "" && cmd.TaskId != taskId {
					continue
				}
				if cmd.JobId != "" && cmd.JobId != jobId {
					continue
				}
				if cmd.Cmd != jobs.Command_Stop {
					continue
				}
				t.cancel()
			}
		}
	}()
	defer func() {
		if e := recover(); e != nil {
			log.Logger(t.context).Error("could not enqueue task", zap.Any("e", e))
			dispatchError = errors.WithMessage(errors.StatusConflict, "native task dispatch was not acknowledged")
			t.cancel()
		}
	}()
	r := RootRunnable(t.context, t)
	var secondaryQueue = queue[0]
	if len(queue) > 1 {
		secondaryQueue = queue[1]
	}
	if t.Job.MergeAction != nil {
		r.SetupCollector(t.context, t.Job.MergeAction, secondaryQueue)
	}
	logStartMessageFromEvent(r.Context, t.event)
	msg := createMessageFromEvent(t.event)
	queue[0] <- func(queue chan RunnerFunc) {
		r.Dispatch(msg, t.Actions, secondaryQueue)
	}
	return nil
}

// CleanUp is triggered after a task has no more subroutines running.
func (t *Task) CleanUp() {
	t.SetEndTime(time.Now())
	if t.err != nil {
		t.SetStatus(jobs.TaskStatus_Error, t.err.Error())
	} else {
		t.SetStatus(jobs.TaskStatus_Finished, "Complete")
	}
	if t.span != nil {
		t.span.End()
	}
	t.Save()
	close(t.finished)
}

// Add increments task internal retain counter
func (t *Task) Add(delta int) {
	rc := t.rci.Load()
	if rc == 0 {
		if t.task.StartTime == 0 {
			t.task.StartTime = int32(time.Now().Unix())
		}
		t.SetStatus(jobs.TaskStatus_Running, "Starting...")
		t.Save()
	}
	t.rci.Add(int32(delta))
}

// Done decrements task internal retain counter - When reaching 0, it triggers the CleanUp operation
func (t *Task) Done(delta int) {
	newVal := t.rci.Add(-int32(delta))
	if newVal == 0 {
		t.CleanUp()
	}
}

func (t *Task) Save() {
	t.SaveStatus(nil, 0)
}

// SaveStatus publish task to Bus topic, including Runnable context if passed
func (t *Task) SaveStatus(runnableContext context.Context, runnableStatus jobs.TaskStatus) {
	if t.lastStatus == jobs.TaskStatus_Unknown || t.taskChanged() {
		cl := t.Clone()
		t.lastStatus = cl.Status
		t.lastStatusMsg = cl.StatusMessage
		t.lastHasProgress = cl.HasProgress
		t.lastCanPause = cl.CanPause
		t.lastProgress = cl.Progress
		if runnableContext != nil {
			GetBus(t.context).Pub(&TaskStatusUpdate{
				Task:            cl,
				RunnableContext: runnableContext,
				RunnableStatus:  runnableStatus,
			}, PubSubTopicTaskStatuses)
		} else {
			GetBus(t.context).Pub(cl, PubSubTopicTaskStatuses)
		}
	}
}

// Clone creates a protobuf clone of this task
func (t *Task) Clone() *jobs.Task {
	t.resultMu.Lock()
	defer t.resultMu.Unlock()
	bb, _ := protojson.Marshal(t.task)
	cl := &jobs.Task{}
	_ = protojson.Unmarshal(bb, cl)
	return cl
	//return proto.Clone(t.task).(*jobs.Task)
}

// AppendResult retains action evidence in the original native task, before the
// final status is cloned for persistence. It never grants a repeated dispatch.
func (t *Task) AppendResult(action *jobs.Action, output *jobs.ActionMessage) error {
	if !t.claimRequired || output == nil {
		return nil
	}
	t.resultMu.Lock()
	defer t.resultMu.Unlock()
	for _, entry := range output.OutputChain {
		if entry.GetVars()[jobstore.NativeNodeMutationResult] == "true" {
			event := new(tree.NodeChangeEvent)
			if !entry.Success || protojson.Unmarshal(entry.JsonBody, event) != nil || event.GetSource().GetUuid() == "" ||
				(action.GetID() != "actions.tree.delete" && action.GetID() != "actions.tree.copymove") ||
				(action.GetID() == "actions.tree.delete" && event.Type != tree.NodeChangeEvent_DELETE) ||
				(action.GetID() == "actions.tree.copymove" && (event.Type != tree.NodeChangeEvent_UPDATE_PATH || action.Parameters["type"] != "move" || event.GetTarget().GetUuid() == "")) {
				return errors.WithMessage(errors.StatusConflict, "native mutation result lacks exact acknowledged identity")
			}
			duplicate := false
			for _, priorLog := range t.task.ActionsLogs {
				for _, prior := range priorLog.GetOutputMessage().GetOutputChain() {
					previous := new(tree.NodeChangeEvent)
					if prior.GetVars()[jobstore.NativeNodeMutationResult] != "true" || protojson.Unmarshal(prior.JsonBody, previous) != nil || previous.GetSource().GetUuid() != event.Source.Uuid {
						continue
					}
					if priorLog.GetAction().GetID() != action.GetID() || !proto.Equal(previous, event) {
						return errors.WithStack(errors.StatusConflict)
					}
					duplicate = true
				}
			}
			if !duplicate {
				t.task.ActionsLogs = append(t.task.ActionsLogs, &jobs.ActionLog{Action: &jobs.Action{ID: action.ID}, OutputMessage: &jobs.ActionMessage{OutputChain: []*jobs.ActionOutput{proto.Clone(entry).(*jobs.ActionOutput)}}})
			}
			continue
		}
		if entry.GetVars()[jobstore.NativeVersionResult] != "true" || !entry.Success {
			continue
		}
		revision := &tree.ContentRevision{}
		if err := protojson.Unmarshal(entry.JsonBody, revision); err != nil || revision.VersionId == "" || revision.OwnerUuid == "" || revision.Size < 0 || revision.Location == nil {
			return errors.WithMessage(errors.StatusConflict, "native revision result lacks durable identity")
		}
		duplicate := false
		for _, log := range t.task.ActionsLogs {
			for _, prior := range log.GetOutputMessage().GetOutputChain() {
				stored := &tree.ContentRevision{}
				if prior.GetVars()[jobstore.NativeVersionResult] != "true" || protojson.Unmarshal(prior.JsonBody, stored) != nil || stored.VersionId != revision.VersionId {
					continue
				}
				if !proto.Equal(stored, revision) {
					return errors.WithMessage(errors.StatusConflict, "native revision result changed within the task")
				}
				duplicate = true
			}
		}
		if duplicate {
			continue
		}
		// Keep only the original revision receipt. Never copy another action's
		// raw/string body, parameters, credentials, or inherited result chain.
		body, err := protojson.Marshal(revision)
		if err != nil {
			return err
		}
		t.task.ActionsLogs = append(t.task.ActionsLogs, &jobs.ActionLog{
			Action: &jobs.Action{ID: action.GetID()},
			OutputMessage: &jobs.ActionMessage{OutputChain: []*jobs.ActionOutput{{
				Success: true, JsonBody: body, Vars: map[string]string{jobstore.NativeVersionResult: "true"},
			}}},
		})
	}
	return nil
}

// GetRunUUID returns the task internal run UUID
func (t *Task) GetRunUUID() string {
	return t.runID
}

// SetStatus updates task internal status
func (t *Task) SetStatus(status jobs.TaskStatus, message ...string) {
	if len(message) > 0 {
		t.task.StatusMessage = message[0]
	}
	t.task.Status = status
}

// SetProgress updates task internal progress
func (t *Task) SetProgress(progress float32) {
	t.task.Progress = progress
}

// SetStartTime updates start time
func (t *Task) SetStartTime(ti time.Time) {
	if t.task.StartTime == 0 {
		t.task.StartTime = int32(ti.Unix())
	}
}

// SetEndTime updates end time
func (t *Task) SetEndTime(ti time.Time) {
	t.task.EndTime = int32(ti.Unix())
}

// SetControllable flags task as being able to be stopped or paused
func (t *Task) SetControllable(canPause bool) {
	t.task.CanPause = canPause
}

// SetHasProgress flags task as providing progress information
func (t *Task) SetHasProgress() {
	t.task.HasProgress = true
}

// SetError set task in error globally
func (t *Task) SetError(e error, appendLog bool) {
	t.err = e
}

// GetRunnableChannels prepares a set of data channels for action actual Run method.
func (t *Task) GetRunnableChannels(runnableCtx context.Context, controllable bool) (*actions.RunnableChannels, chan bool) {
	status, statusMsg, progress, done := t.createStatusesChannels(runnableCtx)
	c := &actions.RunnableChannels{
		Status:    status,
		StatusMsg: statusMsg,
		Progress:  progress,
	}
	if controllable {
		c.Pause, c.Resume = t.createControlChannels(done)
	}
	return c, done
}

// createStatusesChannels provides a set of channel used by the runnable to send
// updates about its status to the outside world
func (t *Task) createStatusesChannels(runnableCtx context.Context) (chan jobs.TaskStatus, chan string, chan float32, chan bool) {

	status := make(chan jobs.TaskStatus)
	statusMsg := make(chan string)
	progress := make(chan float32)
	done := make(chan bool, 1)

	go func() {
		defer func() {
			close(statusMsg)
			close(status)
			close(progress)
		}()
		for {
			select {
			case s := <-status:
				t.task.Status = s
				t.SaveStatus(runnableCtx, jobs.TaskStatus_Running)
			case s := <-statusMsg:
				t.task.StatusMessage = s
				t.SaveStatus(runnableCtx, jobs.TaskStatus_Running)
			case p := <-progress:
				diff := p - t.task.Progress
				save := false
				if diff > 0.01 || p == 1 {
					t.task.Progress = p
					save = true
				}
				if save {
					t.SaveStatus(runnableCtx, jobs.TaskStatus_Running)
				}
			case <-done:
				return
			}

		}
	}()

	return status, statusMsg, progress, done

}

// createControlChannels provides a set of channel used to send some specific control instructions
// to the runnable
func (t *Task) createControlChannels(done chan bool) (pause chan interface{}, resume chan interface{}) {

	pause, resume = make(chan interface{}), make(chan interface{})
	jobId := t.Job.ID
	taskId := t.task.ID

	bus := GetBus(t.context)
	ch := bus.Sub(PubSubTopicControl)
	go func() {
		defer func() {
			close(pause)
			close(resume)
			bus.UnSubWithFlush(ch, PubSubTopicControl)
		}()
		for {
			select {
			case val := <-ch:
				if cmd, ok := val.(*jobs.CtrlCommand); ok {
					if cmd.TaskId != "" && cmd.TaskId != taskId {
						continue
					}
					if cmd.JobId != "" && cmd.JobId != jobId {
						continue
					}
					switch cmd.Cmd {
					case jobs.Command_Pause:
						pause <- cmd
					case jobs.Command_Resume:
						resume <- cmd
					}
				}
			case <-done:
				return
			}
		}
	}()

	return
}

func (t *Task) taskChanged() bool {
	if t.lastStatus != t.task.Status || t.lastStatusMsg != t.task.StatusMessage {
		return true
	}
	if t.lastHasProgress != t.task.HasProgress || t.lastCanPause != t.task.CanPause || t.lastProgress != t.task.Progress {
		return true
	}
	return false
}
