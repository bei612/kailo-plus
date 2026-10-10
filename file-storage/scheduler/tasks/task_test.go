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
	"bytes"
	"context"
	"errors"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/anypb"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth/claim"
	grpcclient "github.com/pydio/cells/v5/common/client/grpc"
	cellserrors "github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/proto/jobs"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/common/runtime"
	"github.com/pydio/cells/v5/common/utils/propagator"
	jobstore "github.com/pydio/cells/v5/scheduler/jobs"

	_ "github.com/pydio/cells/v5/scheduler/actions/scheduler"

	. "github.com/smartystreets/goconvey/convey"
)

func TestMain(m *testing.M) {
	TestDisableTaskClient = true
	m.Run()
}

type testTenant struct{}

func (t *testTenant) Context(ctx context.Context) context.Context {
	return ctx
}

func (t *testTenant) ID() string {
	return "test"
}

var (
	runtimeCtx = runtime.CoreBackground()
)

func TestNewTaskFromEvent(t *testing.T) {

	Convey("Test New Task From Event", t, func() {
		event := &jobs.JobTriggerEvent{JobID: "ajob"}
		task := NewTaskFromEvent(context.Background(), &jobs.Job{ID: "ajob"}, event)
		So(task, ShouldNotBeNil)
		So(task.task, ShouldNotBeNil)
		So(task.task.Status, ShouldEqual, jobs.TaskStatus_Queued)
		So(task.task.StatusMessage, ShouldEqual, "Pending")
		opId, _ := propagator.CanonicalMeta(task.context, common.CtxSchedulerOperationId)
		So(opId, ShouldEqual, "ajob-"+task.task.ID[0:8])
	})
}

func TestNativeDeleteAcknowledgementsRemainInOriginalClaimedTask(t *testing.T) {
	job := &jobs.Job{ID: "admitted-delete-child", Metadata: map[string]string{jobstore.NativeDeleteJob: "original-coordinator", jobstore.NativeDeleteTask: "original-operation"}}
	action := &jobs.Action{ID: "actions.tree.delete"}
	task := NewTaskFromEvent(context.Background(), job, &jobs.JobTriggerEvent{JobID: job.ID, RunNow: true, RunTaskId: job.ID})
	for _, id := range []string{"selected-one", "selected-two"} {
		body, err := protojson.Marshal(&tree.NodeChangeEvent{Type: tree.NodeChangeEvent_DELETE, Source: &tree.Node{Uuid: id}})
		if err != nil {
			t.Fatal(err)
		}
		output := &jobs.ActionMessage{OutputChain: []*jobs.ActionOutput{{Success: true, JsonBody: body, Vars: map[string]string{jobstore.NativeNodeMutationResult: "true"}}}}
		if err := task.AppendResult(action, output); err != nil {
			t.Fatal(err)
		}
		if err := task.AppendResult(action, output); err != nil {
			t.Fatal("same ACK was not idempotent", err)
		}
	}
	stored := task.Clone()
	if len(stored.ActionsLogs) != 3 || !jobstore.TaskHasClaim(stored) {
		t.Fatal("claim or one-per-selected-node ACK was lost", stored)
	}
	for _, mutation := range []struct {
		name    string
		event   *tree.NodeChangeEvent
		success bool
		action  *jobs.Action
	}{
		{"wrong-event", &tree.NodeChangeEvent{Type: tree.NodeChangeEvent_CREATE, Source: &tree.Node{Uuid: "other"}}, true, action},
		{"negative-ack", &tree.NodeChangeEvent{Type: tree.NodeChangeEvent_DELETE, Source: &tree.Node{Uuid: "other"}}, false, action},
		{"missing-id", &tree.NodeChangeEvent{Type: tree.NodeChangeEvent_DELETE}, true, action},
		{"wrong-action", &tree.NodeChangeEvent{Type: tree.NodeChangeEvent_DELETE, Source: &tree.Node{Uuid: "other"}}, true, &jobs.Action{ID: "actions.tree.other"}},
		{"changed-same-id", &tree.NodeChangeEvent{Type: tree.NodeChangeEvent_DELETE, Source: &tree.Node{Uuid: "selected-one", Path: "changed"}}, true, action},
	} {
		t.Run(mutation.name, func(t *testing.T) {
			body, err := protojson.Marshal(mutation.event)
			if err != nil {
				t.Fatal(err)
			}
			if err := task.AppendResult(mutation.action, &jobs.ActionMessage{OutputChain: []*jobs.ActionOutput{{Success: mutation.success, JsonBody: body, Vars: map[string]string{jobstore.NativeNodeMutationResult: "true"}}}}); err == nil {
				t.Fatal("invalid ACK persisted")
			}
			if !proto.Equal(task.Clone(), stored) {
				t.Fatal("failed evidence check changed original Task")
			}
		})
	}
}

type nativeClaimService struct {
	grpc.ClientConnInterface
	put func(context.Context, *jobs.PutTaskRequest) (*jobs.PutTaskResponse, error)
}

func (s *nativeClaimService) Invoke(ctx context.Context, method string, args, reply interface{}, _ ...grpc.CallOption) error {
	if method != "/jobs.JobService/PutTask" {
		return errors.New("unexpected native claim RPC")
	}
	response, err := s.put(ctx, args.(*jobs.PutTaskRequest))
	if err != nil {
		return err
	}
	if response != nil {
		proto.Merge(reply.(*jobs.PutTaskResponse), response)
	}
	return nil
}

func TestNativeTaskClaimPrecedesDispatch(t *testing.T) {
	for _, tc := range []struct {
		name   string
		result func(*jobs.PutTaskRequest) (*jobs.PutTaskResponse, error)
		fail   bool
	}{
		{"exact-native-ack", func(r *jobs.PutTaskRequest) (*jobs.PutTaskResponse, error) {
			return &jobs.PutTaskResponse{Task: proto.Clone(r.Task).(*jobs.Task)}, nil
		}, false},
		{"lost-ack", func(*jobs.PutTaskRequest) (*jobs.PutTaskResponse, error) {
			return nil, errors.New("native claim ACK unavailable")
		}, true},
		{"already-exists", func(*jobs.PutTaskRequest) (*jobs.PutTaskResponse, error) { return nil, cellserrors.StatusConflict }, true},
		{"missing-ack", func(*jobs.PutTaskRequest) (*jobs.PutTaskResponse, error) { return &jobs.PutTaskResponse{}, nil }, true},
		{"wrong-actor-ack", func(r *jobs.PutTaskRequest) (*jobs.PutTaskResponse, error) {
			v := proto.Clone(r.Task).(*jobs.Task)
			v.TriggerOwner = "another-actor"
			return &jobs.PutTaskResponse{Task: v}, nil
		}, true},
		{"wrong-input-ack", func(r *jobs.PutTaskRequest) (*jobs.PutTaskResponse, error) {
			v := proto.Clone(r.Task).(*jobs.Task)
			v.ActionsLogs = nil
			return &jobs.PutTaskResponse{Task: v}, nil
		}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx := claim.ToContext(context.Background(), claim.Claims{Name: "native-actor", Subject: "native-actor"})
			task := NewTaskFromEvent(ctx, &jobs.Job{ID: "native-job"}, &jobs.JobTriggerEvent{JobID: "native-job", RunTaskId: "operation-key"})
			queue := make(chan RunnerFunc, 1)
			calls := 0
			grpcclient.RegisterMock(common.ServiceJobsGRPC, &nativeClaimService{put: func(_ context.Context, r *jobs.PutTaskRequest) (*jobs.PutTaskResponse, error) {
				calls++
				if len(queue) != 0 || r.StatusMeta[jobstore.TaskCreateOnly] != "true" || !jobstore.TaskHasClaim(r.Task) || r.Task.Status != jobs.TaskStatus_Queued {
					t.Error("dispatch preceded native first-claim persistence")
				}
				return tc.result(r)
			}})
			err := task.Queue(queue)
			if task.cancel != nil {
				defer task.cancel()
			}
			if (err != nil) != tc.fail || calls != 1 || len(queue) != map[bool]int{true: 0, false: 1}[tc.fail] {
				t.Fatalf("unconfirmed native task entered dispatch: calls=%d queued=%d err=%v", calls, len(queue), err)
			}
		})
	}
}

func TestNativeTaskFreezesIntentAndKeepsOnlyRevisionResult(t *testing.T) {
	params := map[string]string{"source": "original-source"}
	ctx := context.WithValue(context.Background(), ContextJobParametersKey{}, params)
	event := &jobs.JobTriggerEvent{JobID: "native-job", RunTaskId: "k", RunParameters: map[string]string{"path": "original-path"}}
	job := &jobs.Job{ID: "native-job", Actions: []*jobs.Action{{ID: "native-action", Parameters: map[string]string{"version": "original"}}}}
	task := NewTaskFromEvent(ctx, job, event)
	initial := task.Clone()
	job.Actions[0].Parameters["version"] = "changed"
	event.RunParameters["path"] = "changed"
	params["source"] = "changed"
	if task.Actions[0].Parameters["version"] != "original" || task.event.(*jobs.JobTriggerEvent).RunParameters["path"] != "original-path" || task.context.Value(ContextJobParametersKey{}).(map[string]string)["source"] != "original-source" {
		t.Fatal("claimed native input retained mutable caller aliases")
	}
	if !proto.Equal(task.Clone(), initial) {
		t.Fatal("frozen native task claim changed after caller mutation")
	}
	other := NewTaskFromEvent(ctx, job, event)
	if proto.Equal(other.Clone().ActionsLogs[0], initial.ActionsLogs[0]) {
		t.Fatal("changed native parameters did not change the persisted input digest")
	}
	revision := &tree.ContentRevision{VersionId: "native-version", OwnerUuid: "native-owner", Size: 0, ETag: "native-etag", Location: &tree.Node{Uuid: "native-location"}}
	body, err := protojson.Marshal(revision)
	if err != nil {
		t.Fatal(err)
	}
	output := &jobs.ActionMessage{OutputChain: []*jobs.ActionOutput{{Success: true, RawBody: []byte("secret-body"), StringBody: "secret-body"}, {Success: true, JsonBody: body, RawBody: []byte("secret-body"), Vars: map[string]string{jobstore.NativeVersionResult: "true"}}}}
	if err := task.AppendResult(job.Actions[0], output); err != nil {
		t.Fatal(err)
	}
	if err := task.AppendResult(job.Actions[0], output); err != nil {
		t.Fatal(err)
	}
	stored := task.Clone()
	if len(stored.ActionsLogs) != 2 {
		t.Fatalf("inherited native revision result duplicated: %v", stored)
	}
	encoded, _ := protojson.Marshal(stored)
	if bytes.Contains(encoded, []byte("secret-body")) {
		t.Fatal("native task copied arbitrary action body")
	}
	observed := &tree.ContentRevision{}
	if err := protojson.Unmarshal(stored.ActionsLogs[1].OutputMessage.OutputChain[0].JsonBody, observed); err != nil || !proto.Equal(observed, revision) {
		t.Fatalf("durable native revision result changed: %v %v", observed, err)
	}
	revision.Size = 1
	body, _ = protojson.Marshal(revision)
	output.OutputChain[1].JsonBody = body
	if err := task.AppendResult(job.Actions[0], output); !cellserrors.Is(err, cellserrors.StatusConflict) {
		t.Fatalf("same native revision changed its durable evidence: %v", err)
	}
	output.OutputChain[1].JsonBody = []byte(`{"VersionId":"unknown"}`)
	if err := task.AppendResult(job.Actions[0], output); !cellserrors.Is(err, cellserrors.StatusConflict) {
		t.Fatalf("incomplete native revision became task evidence: %v", err)
	}
}

func TestTaskSetters(t *testing.T) {

	Convey("Test task Setters", t, func() {

		event := &jobs.JobTriggerEvent{JobID: "ajob"}
		task := NewTaskFromEvent(context.Background(), &jobs.Job{ID: "ajob"}, event)
		So(task, ShouldNotBeNil)

		task.Add(2)
		So(task.rci.Load(), ShouldEqual, 2)
		task.Done(1)
		So(task.rci.Load(), ShouldEqual, 1)
		task.Done(1)
		So(task.rci.Load(), ShouldEqual, 0)

		now := time.Now()
		stamp := int32(now.Unix())
		task.SetStartTime(now)
		task.SetEndTime(now)
		So(task.task.StartTime, ShouldEqual, stamp)
		So(task.task.EndTime, ShouldEqual, stamp)

		task.SetStatus(jobs.TaskStatus_Running)
		So(task.task.Status, ShouldEqual, 2)

		task.SetStatus(jobs.TaskStatus_Finished)
		So(task.task.Status, ShouldEqual, 3)

		pg := float32(0.23)
		task.SetProgress(pg)
		So(task.task.Progress, ShouldEqual, pg)

	})

}

func SkipTestTaskLogs(t *testing.T) {

	Convey("Test task Append Log (skipped as not used anymore)", t, func() {

		event := &jobs.JobTriggerEvent{JobID: "ajob"}
		ev, _ := anypb.New(&jobs.JobTriggerEvent{JobID: "ajob"})
		task := NewTaskFromEvent(context.Background(), &jobs.Job{ID: "ajob"}, event)
		So(task, ShouldNotBeNil)

		a := &jobs.Action{
			ID: "fake",
			ChainedActions: []*jobs.Action{
				{
					ID: "followingAction",
				},
			},
		}

		in := &jobs.ActionMessage{
			Event: ev,
			OutputChain: []*jobs.ActionOutput{
				{Success: true},
				{Success: false},
			},
		}

		out := &jobs.ActionMessage{
			Event: ev,
			OutputChain: []*jobs.ActionOutput{
				{Success: true},
				{Success: false},
				{Success: true, StringBody: "last output"},
			},
		}

		//THIS IS REMOVED
		//task.AppendLog(a, in, out)

		So(task.task.ActionsLogs, ShouldHaveLength, 1)
		log := task.task.ActionsLogs[0]
		So(log.Action.ID, ShouldEqual, "fake")
		//So(log.InputMessage, ShouldResemble, &jobs.ActionMessage{})
		So(log.OutputMessage.OutputChain[0].Success, ShouldBeTrue)
		So(log.OutputMessage.OutputChain[0].StringBody, ShouldEqual, "last output")
		// Verify inputs were not modified
		So(a.ChainedActions, ShouldHaveLength, 1)
		So(in.OutputChain, ShouldHaveLength, 2)
		So(out.OutputChain, ShouldHaveLength, 3)
	})
}

func TestTaskEvents(t *testing.T) {

	Convey("Test task Events", t, func() {

		event := &jobs.JobTriggerEvent{JobID: "ajob"}
		ev, _ := anypb.New(event)
		So(createMessageFromEvent(event).Event, ShouldResemble, ev)

		event2 := &tree.NodeChangeEvent{
			Type:   tree.NodeChangeEvent_CREATE,
			Target: &tree.Node{Path: "create"},
		}
		_, _ = anypb.New(event2)
		initialMessage := createMessageFromEvent(event2)
		So(initialMessage.Nodes, ShouldHaveLength, 1)
		So(initialMessage.Nodes[0].Path, ShouldResemble, "create")

		event3 := &tree.NodeChangeEvent{
			Type:   tree.NodeChangeEvent_DELETE,
			Source: &tree.Node{Path: "delete"},
		}
		_, _ = anypb.New(event3)
		initialMessage = createMessageFromEvent(event3)
		So(initialMessage.Nodes, ShouldHaveLength, 1)
		So(initialMessage.Nodes[0].Path, ShouldResemble, "delete")

	})
}

func TestTask_Save(t *testing.T) {

	Convey("Test task SaveStatus", t, func() {

		event := &jobs.JobTriggerEvent{JobID: "ajob"}
		task := NewTaskFromEvent(context.Background(), &jobs.Job{ID: "ajob"}, event)
		ch := GetBus(runtimeCtx).Sub(PubSubTopicTaskStatuses)
		task.Save()
		read := <-ch
		rt, o := read.(*jobs.Task)
		So(o, ShouldBeTrue)
		So(rt.ID, ShouldEqual, task.task.ID)
		GetBus(runtimeCtx).Unsub(ch, PubSubTopicTaskStatuses)

	})

	Convey("Test task SaveStatus With Context", t, func() {

		event := &jobs.JobTriggerEvent{JobID: "ajob"}
		task := NewTaskFromEvent(context.Background(), &jobs.Job{ID: "ajob"}, event)
		ch := GetBus(runtimeCtx).Sub(PubSubTopicTaskStatuses)
		runnableCtx := propagator.WithAdditionalMetadata(runtimeCtx, map[string]string{common.CtxMetaTaskActionPath: "action-path"})
		task.SaveStatus(runnableCtx, jobs.TaskStatus_Running)
		read := <-ch
		rt, o := read.(*TaskStatusUpdate)
		So(o, ShouldBeTrue)
		So(rt.ID, ShouldEqual, task.task.ID)
		So(rt.RunnableContext, ShouldNotBeNil)
		So(rt.RunnableStatus, ShouldEqual, jobs.TaskStatus_Running)
		GetBus(runtimeCtx).Unsub(ch, PubSubTopicTaskStatuses)

	})
}

func TestTask_EnqueueRunnables(t *testing.T) {

	Convey("Test Enqueue Runnables", t, func(c C) {

		saveChannel := GetBus(runtimeCtx).Sub(PubSubTopicTaskStatuses)
		output := make(chan RunnerFunc, 1)
		event := &jobs.JobTriggerEvent{JobID: "ajob"}
		task := NewTaskFromEvent(context.Background(), &jobs.Job{
			ID: "ajob",
			Actions: []*jobs.Action{
				&jobs.Action{ID: "actions.test.fake"},
			},
		}, event)

		task.Queue(output)
		read := <-output
		So(read, ShouldNotBeNil)
		//So(read.Action.ID, ShouldEqual, "actions.test.fake")

		go func() {
			read(nil)
			close(output)
		}()

		saved := <-saveChannel
		So(saved, ShouldNotBeNil)
		rt, o := saved.(*jobs.Task)
		So(o, ShouldBeTrue)
		So(rt.ID, ShouldEqual, task.task.ID)

		GetBus(runtimeCtx).Unsub(saveChannel, PubSubTopicTaskStatuses)

	})

	Convey("Test task without Impl", t, func() {

		output := make(chan RunnerFunc, 1)
		event := &jobs.JobTriggerEvent{JobID: "ajob"}
		task := NewTaskFromEvent(context.Background(), &jobs.Job{
			ID: "ajob",
			Actions: []*jobs.Action{
				{ID: "unknown action"},
			},
		}, event)

		task.Queue(output)
		read := <-output
		So(read, ShouldNotBeNil)
		//So(read.Action.ID, ShouldEqual, "unknown action")

		go func() {
			read(nil)
			close(output)
		}()

	})

}
