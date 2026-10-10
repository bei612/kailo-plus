package grpc

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/auth/claim"
	"github.com/pydio/cells/v5/common/auth/protocol"
	"github.com/pydio/cells/v5/common/broker"
	grpcclient "github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/config"
	cellserrors "github.com/pydio/cells/v5/common/errors"
	jobproto "github.com/pydio/cells/v5/common/proto/jobs"
	"github.com/pydio/cells/v5/common/proto/service"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/common/runtime/manager"
	"github.com/pydio/cells/v5/common/storage/boltdb"
	"github.com/pydio/cells/v5/common/storage/test"
	"github.com/pydio/cells/v5/common/telemetry/log"
	jobstore "github.com/pydio/cells/v5/scheduler/jobs"
	"github.com/pydio/cells/v5/scheduler/jobs/dao/bolt"
	"go.etcd.io/bbolt"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/anypb"
)

type deleteReceiptServer struct{ *taskLookupContextServer }

func (s *deleteReceiptServer) GetJob(_ context.Context, request *jobproto.GetJobRequest) (*jobproto.GetJobResponse, error) {
	return s.JobsHandler.GetJob(s.ctx, request)
}
func (s *deleteReceiptServer) PutTask(_ context.Context, request *jobproto.PutTaskRequest) (*jobproto.PutTaskResponse, error) {
	return s.JobsHandler.PutTask(s.ctx, request)
}

func TestNativeDeleteTerminalRequiresOriginalPerNodeAcknowledgements(t *testing.T) {
	test.RunStorageTests([]test.StorageTestCase{test.TemplateBoltWithPrefix(bolt.NewBoltDAO, "native_delete_receipt_")}, t, func(ctx context.Context) {
		store, err := manager.Resolve[jobstore.DAO](ctx)
		if err != nil {
			t.Fatal(err)
		}
		handler := NewJobsHandler(ctx, "native-delete-receipt")
		listener := bufconn.Listen(65536)
		server := grpc.NewServer()
		jobproto.RegisterJobServiceServer(server, &deleteReceiptServer{&taskLookupContextServer{JobsHandler: handler, ctx: ctx}})
		go server.Serve(listener)
		defer server.Stop()
		defer listener.Close()
		connection, err := grpc.NewClient("passthrough:///native-delete-receipt", grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) { return listener.Dial() }))
		if err != nil {
			t.Fatal(err)
		}
		defer connection.Close()
		grpcclient.RegisterMock(common.ServiceJobsGRPC, connection)
		for index, mode := range []string{"delete-complete", "recycle-complete", "missing-ack", "partial-ack", "wrong-node", "wrong-action", "wrong-recycle-target", "wrong-job-digest", "missing-dispatch-ack", "failed-child", "missing-child", "empty-selector"} {
			t.Run(mode, func(t *testing.T) {
				key := fmt.Sprintf("00000000-0000-4000-8000-%012d", index+1)
				ids := []string{"00000000-0000-4000-8000-000000000101", "00000000-0000-4000-8000-000000000102"}
				coordinatorJob := jobstore.NativeReadJob("delete-coordinator-" + mode)
				if err := store.ClaimJob(ctx, coordinatorJob); err != nil {
					t.Fatal(err)
				}
				coordinator, err := jobstore.NewNativeWriteTask("binding", coordinatorJob.ID, key, "owner", "native-user", map[string]interface{}{"action_key": "file_storage.delete@v1"}, map[string]interface{}{"nativeObjectRefs": ids, "removePermanently": mode != "recycle-complete" && mode != "wrong-recycle-target"})
				if err != nil {
					t.Fatal(err)
				}
				query, err := anypb.New(&tree.Query{UUIDs: ids})
				if err != nil {
					t.Fatal(err)
				}
				action := &jobproto.Action{ID: "actions.tree.delete", NodesSelector: &jobproto.NodesSelector{Query: &service.Query{SubQueries: []*anypb.Any{query}}}}
				if strings.Contains(mode, "recycle") {
					action.ID = "actions.tree.copymove"
					action.Parameters = map[string]string{"type": "move", "target": "native/recycle_bin", "targetParent": "true"}
				}
				if mode == "empty-selector" {
					action.NodesSelector.Query.SubQueries[0], _ = anypb.New(&tree.Query{})
				}
				childJob := &jobproto.Job{ID: coordinatorJob.ID + "-" + key + "-0", Owner: "owner", Actions: []*jobproto.Action{action}, Metadata: map[string]string{jobstore.NativeDeleteJob: coordinatorJob.ID, jobstore.NativeDeleteTask: key}}
				if err := store.ClaimJob(ctx, childJob); err != nil {
					t.Fatal(err)
				}
				digest, err := jobstore.NativeJobDefinitionDigest(childJob)
				if err != nil {
					t.Fatal(err)
				}
				ref, _ := json.Marshal(map[string]string{"jobId": childJob.ID, "taskId": childJob.ID, "jobDigest": digest})
				coordinator.ActionsLogs = append(coordinator.ActionsLogs, &jobproto.ActionLog{OutputMessage: &jobproto.ActionMessage{OutputChain: []*jobproto.ActionOutput{{JsonBody: ref, Vars: map[string]string{jobstore.NativeDeleteJob: "true"}}}}})
				if mode != "missing-dispatch-ack" {
					coordinator.ActionsLogs = append(coordinator.ActionsLogs, &jobproto.ActionLog{OutputMessage: &jobproto.ActionMessage{OutputChain: []*jobproto.ActionOutput{{Success: true, Vars: map[string]string{jobstore.NativeDeleteDispatchComplete: "true"}}}}})
				}
				if err := store.ClaimTask(coordinator); err != nil {
					t.Fatal(err)
				}
				claimDigest := digest
				if mode == "wrong-job-digest" {
					claimDigest = strings.Repeat("a", 64)
				}
				claimBody, _ := json.Marshal(map[string]string{"requestDigest": strings.Repeat("b", 64), "jobDigest": claimDigest})
				child := &jobproto.Task{ID: childJob.ID, JobID: childJob.ID, TriggerOwner: "owner", Status: jobproto.TaskStatus_Finished, EndTime: 123,
					ActionsLogs: []*jobproto.ActionLog{{InputMessage: &jobproto.ActionMessage{OutputChain: []*jobproto.ActionOutput{{JsonBody: claimBody, Vars: map[string]string{jobstore.TaskCreateOnly: "true"}}}}}}}
				if mode == "failed-child" {
					child.Status = jobproto.TaskStatus_Error
				}
				for n, id := range ids {
					if mode == "missing-ack" || mode == "partial-ack" && n == 1 {
						continue
					}
					event := &tree.NodeChangeEvent{Type: tree.NodeChangeEvent_DELETE, Source: &tree.Node{Uuid: id, Path: "native/item"}}
					if action.ID == "actions.tree.copymove" {
						event.Type = tree.NodeChangeEvent_UPDATE_PATH
						event.Target = &tree.Node{Uuid: id, Path: "native/recycle_bin/item"}
					}
					if mode == "wrong-recycle-target" {
						event.Target.Path = "native/other/item"
					}
					if mode == "wrong-node" {
						event.Source.Uuid = "another-node"
					}
					body, err := protojson.Marshal(event)
					if err != nil {
						t.Fatal(err)
					}
					actualAction := action.ID
					if mode == "wrong-action" {
						actualAction = "actions.tree.other"
					}
					child.ActionsLogs = append(child.ActionsLogs, &jobproto.ActionLog{Action: &jobproto.Action{ID: actualAction}, OutputMessage: &jobproto.ActionMessage{OutputChain: []*jobproto.ActionOutput{{Success: true, JsonBody: body, Vars: map[string]string{jobstore.NativeNodeMutationResult: "true"}}}}})
				}
				if mode != "missing-child" {
					if err := store.ClaimTask(child); err != nil {
						t.Fatal(err)
					}
				}
				completed, err := jobstore.NativeDeleteTerminal(ctx, coordinator, 65536)
				want := mode == "delete-complete" || mode == "recycle-complete"
				if want && (err != nil || completed != 123) {
					t.Fatalf("actual complete ACKs not accepted: %d %v", completed, err)
				}
				if !want && (err == nil || completed != 0) {
					t.Fatalf("unconfirmed deletion became terminal: %d %v", completed, err)
				}
				stored, err := jobstore.ReadNativeWriteTask(ctx, coordinatorJob.ID, key, 65536)
				if err != nil {
					t.Fatal(err)
				}
				if (stored.Status == jobproto.TaskStatus_Finished) != want {
					t.Fatal("coordinator terminal did not match native evidence")
				}
				stripped := proto.Clone(childJob).(*jobproto.Job)
				stripped.Metadata = nil
				if err := store.PutJob(stripped); !cellserrors.Is(err, cellserrors.StatusConflict) {
					t.Fatal("frozen job downgraded through metadata removal", err)
				}
				if err := store.DeleteJob(childJob.ID); !cellserrors.Is(err, cellserrors.StatusConflict) {
					t.Fatal("frozen job erased before/after child claim", err)
				}
				actual, err := store.GetJob(childJob.ID, jobproto.TaskStatus_Unknown)
				if err != nil || !proto.Equal(actual, childJob) {
					t.Fatal("native immutable definition lost", err)
				}
			})
		}
	})
}

type taskLookupContextServer struct {
	*JobsHandler
	ctx context.Context
}

type taskLookupUnavailableDB struct {
	boltdb.DB
	unavailable *atomic.Bool
}

func (db *taskLookupUnavailableDB) View(read func(*bbolt.Tx) error) error {
	if db.unavailable.Load() {
		return errors.New("original native task database unavailable")
	}
	return db.DB.View(read)
}

type taskLookupServerStream struct {
	jobproto.JobService_ListTasksServer
	ctx  context.Context
	send func(*jobproto.ListTasksResponse) error
}

func (s *taskLookupServerStream) Context() context.Context { return s.ctx }
func (s *taskLookupServerStream) Send(response *jobproto.ListTasksResponse) error {
	if s.send != nil {
		return s.send(response)
	}
	return s.JobService_ListTasksServer.Send(response)
}

func (s *taskLookupContextServer) ListTasks(request *jobproto.ListTasksRequest, stream jobproto.JobService_ListTasksServer) error {
	ctx, cancel := context.WithCancel(s.ctx)
	stop := context.AfterFunc(stream.Context(), cancel)
	defer stop()
	defer cancel()
	return s.JobsHandler.ListTasks(request, &taskLookupServerStream{JobService_ListTasksServer: stream, ctx: ctx})
}

type taskLookupTruncatedConnection struct {
	grpc.ClientConnInterface
}

type taskLookupTruncatedStream struct {
	grpc.ClientStream
	received bool
}

// The fixed original service has no TaskID field. Dropping it before the
// actual ListTasks RPC exercises that service's original full-list behavior.
type taskLookupLegacyConnection struct{ grpc.ClientConnInterface }
type taskLookupLegacyStream struct{ grpc.ClientStream }

func (c *taskLookupLegacyConnection) NewStream(ctx context.Context, desc *grpc.StreamDesc, method string, options ...grpc.CallOption) (grpc.ClientStream, error) {
	stream, err := c.ClientConnInterface.NewStream(ctx, desc, method, options...)
	if err != nil {
		return nil, err
	}
	return &taskLookupLegacyStream{ClientStream: stream}, nil
}

func (s *taskLookupLegacyStream) SendMsg(input interface{}) error {
	request := proto.Clone(input.(*jobproto.ListTasksRequest)).(*jobproto.ListTasksRequest)
	request.TaskID = ""
	return s.ClientStream.SendMsg(request)
}

func (c *taskLookupTruncatedConnection) NewStream(ctx context.Context, desc *grpc.StreamDesc, method string, options ...grpc.CallOption) (grpc.ClientStream, error) {
	stream, err := c.ClientConnInterface.NewStream(ctx, desc, method, options...)
	return &taskLookupTruncatedStream{ClientStream: stream}, err
}

func (s *taskLookupTruncatedStream) RecvMsg(response interface{}) error {
	if s.received {
		return io.ErrUnexpectedEOF
	}
	s.received = true
	return s.ClientStream.RecvMsg(response)
}

func TestNativeTaskLookupUsesOriginalStreamTermination(t *testing.T) {
	var raw boltdb.DB
	// The original manager rebuilds the DAO on each Resolve. The read failure
	// belongs to the underlying database, not one discarded DAO instance.
	var unavailable atomic.Bool
	constructor := func(db boltdb.DB) jobstore.DAO {
		raw = db
		observedDB := &taskLookupUnavailableDB{DB: db, unavailable: &unavailable}
		return bolt.NewBoltDAO(observedDB)
	}
	test.RunStorageTests([]test.StorageTestCase{test.TemplateBoltWithPrefix(constructor, "native_task_lookup_")}, t, func(ctx context.Context) {
		store, err := manager.Resolve[jobstore.DAO](ctx)
		if err != nil {
			t.Fatal(err)
		}
		job := jobstore.NativeReadJob("controlled-native-lookup")
		if err := store.ClaimJob(ctx, job); err != nil {
			t.Fatal(err)
		}
		handler := NewJobsHandler(ctx, "native-task-lookup")
		listener := bufconn.Listen(65536)
		server := grpc.NewServer()
		jobproto.RegisterJobServiceServer(server, &taskLookupContextServer{JobsHandler: handler, ctx: ctx})
		go server.Serve(listener)
		defer server.Stop()
		defer listener.Close()
		connection, err := grpc.NewClient("passthrough:///native-task-fixture", grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) { return listener.Dial() }))
		if err != nil {
			t.Fatal(err)
		}
		defer connection.Close()
		grpcclient.RegisterMock(common.ServiceJobsGRPC, connection)
		lookup := func(limit int64) (*jobproto.Task, error) {
			bounded, cancel := context.WithTimeout(ctx, 5*time.Second)
			defer cancel()
			return jobstore.ReadNativeWriteTask(bounded, job.ID, "stable-operation", limit)
		}
		t.Run("fresh-job-without-task-bucket", func(t *testing.T) {
			if task, err := lookup(65536); err != nil || task != nil {
				t.Fatal("fresh original Job did not finish its empty Task stream", err)
			}
		})
		task := &jobproto.Task{ID: "stable-operation", JobID: job.ID, Status: jobproto.TaskStatus_Queued}
		if err := store.PutTask(task); err != nil {
			t.Fatal(err)
		}
		t.Run("original-queued-reference-is-not-terminal", func(t *testing.T) {
			observed, err := lookup(65536)
			if err != nil || !proto.Equal(observed, task) {
				t.Fatal("original native Task was not returned unchanged", err)
			}
			if _, err := jobstore.NativeReadTaskReceipt(observed); err == nil {
				t.Fatal("queued Task became byte completion evidence")
			}
		})
		t.Run("unconfirmed-stream-end-discards-matched-task", func(t *testing.T) {
			grpcclient.RegisterMock(common.ServiceJobsGRPC, &taskLookupTruncatedConnection{ClientConnInterface: connection})
			defer grpcclient.RegisterMock(common.ServiceJobsGRPC, connection)
			if observed, err := lookup(65536); !errors.Is(err, io.ErrUnexpectedEOF) || observed != nil {
				t.Fatal("truncated original lookup was accepted as complete", err)
			}
		})
		t.Run("budget-refusal-does-not-return-partial-task", func(t *testing.T) {
			if observed, err := lookup(1); err == nil || observed != nil {
				t.Fatal("over-budget original stream returned a usable Task")
			}
		})
		t.Run("exact-key-is-independent-of-unrelated-history", func(t *testing.T) {
			other := &jobproto.Task{ID: "unrelated-operation", JobID: job.ID, Status: jobproto.TaskStatus_Queued,
				ActionsLogs: []*jobproto.ActionLog{{InputMessage: &jobproto.ActionMessage{OutputChain: []*jobproto.ActionOutput{{JsonBody: bytes.Repeat([]byte("x"), 65536)}}}}}}
			if err := store.PutTask(other); err != nil {
				t.Fatal(err)
			}
			defer store.DeleteTasks(job.ID, []string{other.ID})
			// Only the selected original Task is charged against the same
			// controlled response budget; no budget limit has been raised.
			if observed, err := lookup(1024); err != nil || !proto.Equal(observed, task) {
				t.Fatal("unrelated native history blocked this operation's observation", err)
			}
			grpcclient.RegisterMock(common.ServiceJobsGRPC, &taskLookupLegacyConnection{ClientConnInterface: connection})
			defer grpcclient.RegisterMock(common.ServiceJobsGRPC, connection)
			if observed, err := lookup(65536 * 2); err == nil || observed != nil {
				t.Fatal("old service's full list became exact operation evidence")
			}
		})
		t.Run("optional-key-keeps-original-list-and-status-filter", func(t *testing.T) {
			seen := 0
			stream := &taskLookupServerStream{ctx: ctx, send: func(response *jobproto.ListTasksResponse) error {
				if !proto.Equal(response.Task, task) {
					t.Fatal("original task list changed its payload")
				}
				seen++
				return nil
			}}
			if err := handler.ListTasks(&jobproto.ListTasksRequest{JobID: job.ID, Status: jobproto.TaskStatus_Any}, stream); err != nil || seen != 1 {
				t.Fatal("empty optional key changed original task listing", err, seen)
			}
			seen = 0
			if err := handler.ListTasks(&jobproto.ListTasksRequest{JobID: job.ID, TaskID: task.ID, Status: jobproto.TaskStatus_Finished}, stream); err != nil || seen != 0 {
				t.Fatal("exact task read ignored original status filtering", err, seen)
			}
			if err := handler.ListTasks(&jobproto.ListTasksRequest{TaskID: task.ID, Status: jobproto.TaskStatus_Any}, stream); err == nil || seen != 0 {
				t.Fatal("exact task read was not scoped to its original Job")
			}
		})
		t.Run("caller-cancel-terminates-blocked-producer", func(t *testing.T) {
			bounded, cancel := context.WithCancel(ctx)
			rows, done, err := store.ListTasks(bounded, job.ID, jobproto.TaskStatus_Any)
			if err != nil {
				t.Fatal(err)
			}
			cancel()
			for range rows {
			}
			if err := <-done; !errors.Is(err, context.Canceled) {
				t.Fatal("canceled Task producer returned success", err)
			}
		})
		t.Run("send-error-does-not-close-producer-channel", func(t *testing.T) {
			sent := 0
			writeErr := errors.New("original stream send failed")
			err := handler.ListTasks(&jobproto.ListTasksRequest{JobID: job.ID, Status: jobproto.TaskStatus_Any}, &taskLookupServerStream{ctx: ctx, send: func(*jobproto.ListTasksResponse) error { sent++; return writeErr }})
			if !errors.Is(err, writeErr) || sent != 1 {
				t.Fatal("original send failure was swallowed", err)
			}
			// A real Bolt writer cannot finish while the abandoned reader holds its transaction.
			finished := make(chan error, 1)
			go func() { finished <- store.PutTask(task) }()
			select {
			case err := <-finished:
				if err != nil {
					t.Fatal(err)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("failed stream retained the original Bolt read transaction")
			}
		})
		t.Run("corrupt-task-is-not-empty-evidence", func(t *testing.T) {
			var saved []byte
			if err := raw.Update(func(tx *bbolt.Tx) error {
				bucket := tx.Bucket([]byte("tasks-" + job.ID))
				saved = bytes.Clone(bucket.Get([]byte(task.ID)))
				return bucket.Put([]byte(task.ID), []byte("{"))
			}); err != nil {
				t.Fatal(err)
			}
			defer raw.Update(func(tx *bbolt.Tx) error {
				return tx.Bucket([]byte("tasks-"+job.ID)).Put([]byte(task.ID), saved)
			})
			if observed, err := lookup(65536); err == nil || observed != nil {
				t.Fatal("unreadable persisted Task became empty/successful lookup")
			}
		})
		for _, consumer := range []string{"native-observe", "delete-tasks", "orphan-logs", "clean-stuck", "clean-stuck-sweep", "detect-stuck-rpc"} {
			t.Run("database-read-failure-"+consumer, func(t *testing.T) {
				unavailable.Store(true)
				defer unavailable.Store(false)
				var err error
				switch consumer {
				case "native-observe":
					var observed *jobproto.Task
					observed, err = lookup(65536)
					if observed != nil {
						t.Fatal("unavailable native database returned partial Task evidence")
					}
				case "delete-tasks":
					_, err = handler.DeleteTasks(ctx, &jobproto.DeleteTasksRequest{JobId: job.ID, Status: []jobproto.TaskStatus{jobproto.TaskStatus_Queued}})
				case "orphan-logs":
					_, err = handler.OrphanLogs(ctx)
				case "clean-stuck":
					_, _, err = handler.cleanStuckByStatus(ctx, true, log.Logger(ctx), jobproto.TaskStatus_Queued, false)
				case "clean-stuck-sweep":
					_, err = handler.CleanStuckTasks(ctx, true, log.Logger(ctx))
				case "detect-stuck-rpc":
					_, err = handler.DetectStuckTasks(ctx, &jobproto.DetectStuckTasksRequest{})
				}
				if err == nil {
					t.Fatal("unreadable original Task stream allowed reconciliation side effects")
				}
			})
		}
	})
}

type taskLookupControlConnection struct {
	grpc.ClientConnInterface
	commands []*jobproto.CtrlCommand
}

func (c *taskLookupControlConnection) Invoke(_ context.Context, method string, input, output interface{}, _ ...grpc.CallOption) error {
	if method != "/jobs.TaskService/Control" {
		return errors.New("unexpected original Task control RPC")
	}
	c.commands = append(c.commands, proto.Clone(input.(*jobproto.CtrlCommand)).(*jobproto.CtrlCommand))
	proto.Merge(output.(*jobproto.CtrlCommandResponse), &jobproto.CtrlCommandResponse{Msg: "accepted"})
	return nil
}

func TestNativeHousekeepingPreservesAdmittedTask(t *testing.T) {
	constructor := func(db boltdb.DB) jobstore.DAO { return bolt.NewBoltDAO(db) }
	test.RunStorageTests([]test.StorageTestCase{test.TemplateBoltWithPrefix(constructor, "native_claim_housekeeping_")}, t, func(ctx context.Context) {
		store, err := manager.Resolve[jobstore.DAO](ctx)
		if err != nil {
			t.Fatal(err)
		}
		handler := NewJobsHandler(ctx, "native-claim-housekeeping")
		for _, scenario := range []string{"restart-running", "restart-paused", "elapsed-running"} {
			for _, admitted := range []bool{true, false} {
				t.Run(fmt.Sprintf("%s-claimed-%t", scenario, admitted), func(t *testing.T) {
					job := jobstore.NativeReadJob(fmt.Sprintf("original-%s-%t", scenario, admitted))
					if err := store.ClaimJob(ctx, job); err != nil {
						t.Fatal(err)
					}
					status := jobproto.TaskStatus_Running
					if scenario == "restart-paused" {
						status = jobproto.TaskStatus_Paused
					}
					var task *jobproto.Task
					if admitted {
						task, err = jobstore.NewNativeWriteTask("binding", job.ID, job.ID+"-key", "native-owner", "native-user", map[string]interface{}{"operation_id": "original-operation", "action_execution_id": "original-admitted-execution"}, map[string]interface{}{"nativeRevision": "original-durable-input"})
						if err != nil {
							t.Fatal(err)
						}
						if err := store.ClaimTask(task); err != nil {
							t.Fatal(err)
						}
					} else {
						task = &jobproto.Task{ID: job.ID + "-key", JobID: job.ID, TriggerOwner: "native-owner"}
					}
					task.Status, task.StartTime = status, 1
					if err := store.PutTask(task); err != nil {
						t.Fatal(err)
					}
					before := proto.Clone(task).(*jobproto.Task)
					controller := &taskLookupControlConnection{}
					grpcclient.RegisterMock(common.ServiceTasksGRPC, controller)
					restart := scenario != "elapsed-running"
					fixed, retry, err := handler.cleanStuckByStatus(ctx, restart, log.Logger(ctx), status, false, time.Second)
					if err != nil {
						t.Fatal(err)
					}
					observed, err := store.GetJob(job.ID, jobproto.TaskStatus_Any)
					if err != nil || len(observed.GetTasks()) != 1 {
						t.Fatal("original Task reference disappeared", err)
					}
					after := observed.Tasks[0]
					if admitted {
						if len(fixed) != 0 || retry || len(controller.commands) != 0 || !proto.Equal(after, before) {
							t.Fatal("local housekeeping stopped or rewrote an admitted operation without native terminal evidence")
						}
					} else if restart {
						if !slices.ContainsFunc(fixed, func(task *jobproto.Task) bool { return task.ID == before.ID }) || after.Status != jobproto.TaskStatus_Error || after.EndTime == 0 || retry || len(controller.commands) != 0 {
							t.Fatal("unclaimed original restart cleanup no longer used its native status path")
						}
					} else {
						if len(fixed) != 0 || !retry || len(controller.commands) != 1 || controller.commands[0].Cmd != jobproto.Command_Stop || controller.commands[0].TaskId != before.ID || !proto.Equal(after, before) {
							t.Fatal("unclaimed original timeout did not request Stop while retaining unconfirmed status")
						}
					}
				})
			}
		}
	})
}

func TestNativeWriteTaskRetainsExactIntentAndVersion(t *testing.T) {
	constructor := func(db boltdb.DB) jobstore.DAO { return bolt.NewBoltDAO(db) }
	test.RunStorageTests([]test.StorageTestCase{test.TemplateBoltWithPrefix(constructor, "native_write_task_")}, t, func(ctx context.Context) {
		store, err := manager.Resolve[jobstore.DAO](ctx)
		if err != nil {
			t.Fatal(err)
		}
		ctx = config.WithStubStore(ctx)
		if err := config.Set(ctx, map[string]interface{}{"requestTimeout": "1m", "write": map[string]interface{}{
			"nativeJobId": "existing-version-job", "actionVersion": 1, "nativeType": "native-file",
			"resultExposurePolicyId": "99e784d0-58d7-4d2e-8b04-d2bdc3f8d7f1", "resultExposurePolicyVersion": 1,
		}}, "services", common.ServiceRestNamespace_+"n", "platform"); err != nil {
			t.Fatal(err)
		}
		if err := NewJobsHandler(ctx, "native-write-task").EnsureNativeActionJobs(ctx); err != nil {
			t.Fatal(err)
		}
		job, err := store.GetJob("existing-version-job", jobproto.TaskStatus_Unknown)
		if err != nil || !jobstore.NativeWriteJobMatches(job, "existing-version-job") {
			t.Fatal(err)
		}
		claims := map[string]interface{}{"tenant_id": "tenant", "actor_principal_id": "actor", "initiating_human_principal_id": "actor", "action_execution_id": "execution", "operation_id": "operation", "action_key": "file_storage.write@v1", "target_id": "resource", "target_type": "RESOURCE", "action_definition_version": float64(1), "result_exposure_policy_id": "policy", "result_exposure_policy_version": float64(1), "jti": "transient", "authorization_min_zed_token": "transient"}
		input := map[string]interface{}{"resourceId": "resource", "nativeObjectRef": `{"nodeUuid":"native-node","publish":false}`, "nativeRevision": "opaque-draft", "displayName": "file.txt", "mediaType": "text/plain"}
		task, err := jobstore.NewNativeWriteTask("binding", job.ID, "native-operation-key", "native-user", "native-user-uuid", claims, input)
		if err != nil {
			t.Fatal(err)
		}
		if err = store.ClaimTask(task); err != nil {
			t.Fatal(err)
		}
		relation, _ := json.Marshal([]string{task.ID, jobstore.NativeVersionActionID, "native-node"})
		digest := sha256.Sum256(relation)
		revision := &tree.ContentRevision{VersionId: hex.EncodeToString(digest[:]), OwnerUuid: "native-user-uuid", ETag: "native-etag", Size: 0, Location: &tree.Node{Uuid: "version-location"}}
		body, _ := protojson.Marshal(revision)
		task.Status, task.StartTime, task.EndTime = jobproto.TaskStatus_Finished, 1, 2
		task.ActionsLogs = append(task.ActionsLogs, &jobproto.ActionLog{Action: &jobproto.Action{ID: jobstore.NativeVersionActionID}, OutputMessage: &jobproto.ActionMessage{OutputChain: []*jobproto.ActionOutput{{Success: true, JsonBody: body, Vars: map[string]string{jobstore.NativeVersionResult: "true"}}}}})
		if err = store.PutTask(task); err != nil {
			t.Fatal(err)
		}
		persisted, err := store.GetJob(job.ID, jobproto.TaskStatus_Any)
		if err != nil || len(persisted.Tasks) != 1 {
			t.Fatal("native task reference was not persisted", err)
		}
		retained := persisted.Tasks[0]
		observed, err := jobstore.NativeWriteRevision(retained)
		if err != nil || !proto.Equal(observed, revision) || !jobstore.NativeWriteTaskMatches(retained, "binding", "native-user-uuid", claims) {
			t.Fatal("persisted write did not retain original frozen intent and exact version", err)
		}
		intent, err := jobstore.NativeWriteTaskIntent(retained)
		if err != nil {
			t.Fatal(err)
		}
		if _, exists := intent.Scope["jti"]; exists {
			t.Fatal("transient proof entered native task")
		}
		for _, scenario := range []string{"changed-binding", "changed-actor", "changed-operation", "changed-policy", "changed-input-digest", "wrong-version-cause", "wrong-native-owner", "draft-not-terminal", "failed-output", "queued-not-terminal", "missing-end", "missing-receipt"} {
			t.Run(scenario, func(t *testing.T) {
				candidate := proto.Clone(retained).(*jobproto.Task)
				binding, user := "binding", "native-user-uuid"
				frozen := make(map[string]interface{})
				for key, value := range claims {
					frozen[key] = value
				}
				switch scenario {
				case "changed-binding":
					binding = "other"
				case "changed-actor":
					user = "other"
				case "changed-operation":
					frozen["operation_id"] = "other"
				case "changed-policy":
					frozen["result_exposure_policy_id"] = "other"
				case "changed-input-digest":
					candidate.ActionsLogs[0].InputMessage.OutputChain[0].JsonBody = []byte(`{"requestDigest":"invalid","intent":{"scope":{},"inputReference":{}}}`)
				case "queued-not-terminal":
					candidate.Status = jobproto.TaskStatus_Queued
				case "missing-end":
					candidate.EndTime = 0
				case "missing-receipt":
					candidate.ActionsLogs = candidate.ActionsLogs[:1]
				default:
					changed := proto.Clone(revision).(*tree.ContentRevision)
					switch scenario {
					case "wrong-version-cause":
						changed.VersionId = "another-version"
					case "wrong-native-owner":
						changed.OwnerUuid = "other"
					case "draft-not-terminal":
						changed.Draft = true
					case "failed-output":
						candidate.ActionsLogs[1].OutputMessage.OutputChain[0].Success = false
					}
					candidate.ActionsLogs[1].OutputMessage.OutputChain[0].JsonBody, _ = protojson.Marshal(changed)
				}
				if scenario == "changed-binding" || scenario == "changed-actor" || scenario == "changed-operation" || scenario == "changed-policy" || scenario == "changed-input-digest" {
					if jobstore.NativeWriteTaskMatches(candidate, binding, user, frozen) {
						t.Fatal("foreign or mutable original intent was accepted")
					}
				} else if receipt, err := jobstore.NativeWriteRevision(candidate); err == nil || receipt != nil {
					t.Fatal("unconfirmed native task produced a successful revision")
				}
			})
		}
		if err := store.ClaimTask(retained); err == nil {
			t.Fatal("repeat operation was granted a second native first-dispatch claim")
		}
	})
}

type readReceiptJobServer struct {
	*JobsHandler
	grpc.ClientConnInterface
	putCount int
	loseACK  int
}

func (s *readReceiptJobServer) Invoke(ctx context.Context, method string, args, reply interface{}, _ ...grpc.CallOption) error {
	switch method {
	case "/jobs.JobService/GetJob":
		response, err := s.JobsHandler.GetJob(ctx, args.(*jobproto.GetJobRequest))
		if err == nil && response != nil {
			proto.Merge(reply.(*jobproto.GetJobResponse), response)
		}
		return err
	case "/jobs.JobService/PutTask":
		response, err := s.PutTask(ctx, args.(*jobproto.PutTaskRequest))
		if err == nil && response != nil {
			proto.Merge(reply.(*jobproto.PutTaskResponse), response)
		}
		return err
	default:
		return errors.New("unexpected original read Task RPC")
	}
}

func (s *readReceiptJobServer) PutTask(ctx context.Context, request *jobproto.PutTaskRequest) (*jobproto.PutTaskResponse, error) {
	s.putCount++
	response, err := s.JobsHandler.PutTask(ctx, request)
	if err == nil && s.putCount == s.loseACK {
		return nil, errors.New("original native persistence ACK lost")
	}
	return response, err
}

type readReceiptSource struct {
	io.Reader
	closeErr error
	closes   *int
}

func (s *readReceiptSource) Close() error { *s.closes++; return s.closeErr }

type readReceiptErrorReader struct{}

type readReceiptErrorWriter struct{}

func (readReceiptErrorWriter) Write(body []byte) (int, error) {
	return len(body) / 2, errors.New("native response write unconfirmed")
}

func (readReceiptErrorReader) Read([]byte) (int, error) {
	return 0, errors.New("original source stream failed")
}

func TestNativeReadTaskRecordsActualStreamOnce(t *testing.T) {
	constructor := func(db boltdb.DB) jobstore.DAO { return bolt.NewBoltDAO(db) }
	test.RunStorageTests([]test.StorageTestCase{test.TemplateBoltWithPrefix(constructor, "native_read_task_")}, t, func(ctx context.Context) {
		store, err := manager.Resolve[jobstore.DAO](ctx)
		if err != nil {
			t.Fatal(err)
		}
		ids := make([]string, 12)
		for index := range ids {
			ids[index] = fmt.Sprintf("00000000-0000-4000-8000-%012d", index+1)
		}
		job := jobstore.NativeReadJob("existing-read-job")
		if err := store.PutJob(job); err != nil {
			t.Fatal(err)
		}
		previousBroker := broker.Default()
		broker.Register(&taskReceiptBroker{Broker: previousBroker, publish: func(topic string, message proto.Message) {
			event, ok := message.(*jobproto.TaskChangeEvent)
			if topic != common.TopicJobTaskEvent || !ok {
				t.Error("unexpected original read Task event")
				return
			}
			stored, err := store.GetJob(job.ID, jobproto.TaskStatus_Any)
			for _, task := range stored.GetTasks() {
				if err == nil && task.ID == event.GetTaskUpdated().GetID() && proto.Equal(task, event.TaskUpdated) {
					return
				}
			}
			t.Error("original read Task event preceded durable persistence", err)
		}})
		defer broker.Register(previousBroker)
		for index, scenario := range []string{"complete", "empty", "source-open-failed", "partial-source", "close-failed", "claim-ACK-lost", "running-ACK-lost", "completion-ACK-lost", "revoked-before-open", "revoked-after-copy", "versions-complete", "versions-response-failed", "versions-source-failed", "versions-completion-ACK-lost", "directory-complete", "directory-empty", "directory-response-failed", "directory-source-failed", "directory-completion-ACK-lost"} {
			t.Run(scenario, func(t *testing.T) {
				key := fmt.Sprintf("00000000-0000-4000-8000-%012d", index+30)
				claims := map[string]interface{}{"tenant_id": ids[0], "actor_principal_id": ids[1], "initiating_human_principal_id": ids[1], "operation_id": ids[2], "action_execution_id": ids[3], "target_id": ids[4], "target_type": "RESOURCE", "action_key": "file_storage.read@v1", "action_definition_version": float64(1), "result_exposure_policy_id": ids[5], "result_exposure_policy_version": float64(1), "external_execution_id": ids[6], "idempotency_key": key}
				revisions := strings.HasPrefix(scenario, "versions-")
				listing := strings.HasPrefix(scenario, "directory-")
				if revisions {
					claims["action_key"] = "file_storage.list_revisions@v1"
				} else if listing {
					claims["action_key"] = "file_storage.list@v1"
				}
				target := map[string]interface{}{"resourceId": ids[4], "nativeType": "folder", "nativeRef": ids[7], "nativeInstanceRef": "native-instance", "nativeScopeRef": ids[8]}
				pepCalls := 0
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.Header().Set("Content-Type", "application/json")
					if r.URL.Path == "/token" {
						json.NewEncoder(w).Encode(map[string]interface{}{"access_token": "fixture-native-service", "token_type": "Bearer", "expires_in": 60})
						return
					}
					if r.URL.Path != "/service/v1/adapter/pep_check" || r.Header.Get("Authorization") != "Bearer fixture-native-service" {
						t.Error("original authenticated PEP was not used")
						w.WriteHeader(403)
						return
					}
					pepCalls++
					if (scenario == "revoked-before-open" && pepCalls == 1) || (scenario == "revoked-after-copy" && pepCalls == 2) {
						w.WriteHeader(403)
						return
					}
					json.NewEncoder(w).Encode(map[string]interface{}{"actionExecutionId": ids[3], "operationId": ids[2], "authorizationMinZedToken": "fresh-native", "targetResource": target})
				}))
				defer server.Close()
				secret := filepath.Join(t.TempDir(), "controlled-secret")
				if err := os.WriteFile(secret, []byte("fixture-secret"), 0600); err != nil {
					t.Fatal(err)
				}
				payload, _ := json.Marshal(claims)
				read := &auth.NativeReadExecution{Delivery: auth.NativeActorDelivery{Delivery: protocol.Delivery{BindingID: ids[9], InstanceServiceUUID: ids[10], CorePEPURL: server.URL + "/service/v1/adapter/pep_check", OIDCTokenURL: server.URL + "/token", ClientID: "native-binding", ClientSecretFile: secret, RequestTimeout: "2s", MaxResponseBytes: 65536, ClientSecretMaxBytes: 256}, Read: &auth.NativeReadDelivery{NativeJobID: job.ID, UsageMeasurements: []auth.NativeReadMeasurement{{MeterKey: "approved-count", QuantitySource: "COUNT"}, {MeterKey: "approved-bytes", QuantitySource: "CONTENT_BYTES"}}}}, Claims: claims, Target: target,
					Input: map[string]interface{}{"resourceId": ids[4], "nativeObjectRef": ids[11], "nativeRevision": "original-persisted-version", "displayName": "file.txt", "mediaType": "text/plain"}, Key: key, ExternalExecutionID: ids[6], Token: "header." + base64.RawURLEncoding.EncodeToString(payload) + ".fixture-proof", Args: `{"target":{},"input":{}}`}
				if revisions {
					read.Input = map[string]interface{}{"resourceId": ids[4], "nativeObjectRef": ids[11]}
				} else if listing {
					read.Input = map[string]interface{}{"resourceId": ids[4], "nativeObjectRef": ids[7]}
				}
				serverJobs := &readReceiptJobServer{JobsHandler: NewJobsHandler(ctx, "native-read-receipt")}
				switch scenario {
				case "claim-ACK-lost":
					serverJobs.loseACK = 1
				case "running-ACK-lost":
					serverJobs.loseACK = 2
				case "completion-ACK-lost", "versions-completion-ACK-lost", "directory-completion-ACK-lost":
					serverJobs.loseACK = 3
				}
				grpcclient.RegisterMock(common.ServiceJobsGRPC, serverJobs)
				actor := claim.ToContext(ctx, claim.Claims{Subject: ids[1], Name: "native-user"})
				body := []byte("actual bytes")
				if revisions {
					body = []byte(`{"Versions":[{"VersionId":"opaque-version","IsHead":true}]}`)
				} else if listing {
					body = []byte(`{"Nodes":[{"Uuid":"original-native-file","Versions":[{"VersionId":"opaque-version","IsHead":true}]}]}`)
					if scenario == "directory-empty" {
						body = []byte(`{}`)
					}
				}
				if scenario == "empty" {
					body = []byte{}
				}
				opens, closes := 0, 0
				var output bytes.Buffer
				open := func() (io.ReadCloser, error) {
					opens++
					if scenario == "source-open-failed" || scenario == "versions-source-failed" || scenario == "directory-source-failed" {
						return nil, errors.New("native source unavailable")
					}
					var source io.Reader = bytes.NewReader(body)
					if scenario == "partial-source" {
						source = io.MultiReader(bytes.NewReader(body[:2]), readReceiptErrorReader{})
					}
					var closeErr error
					if scenario == "close-failed" {
						closeErr = errors.New("native close failed")
					}
					return &readReceiptSource{Reader: source, closeErr: closeErr, closes: &closes}, nil
				}
				expected := int64(len(body))
				var writer io.Writer = &output
				if revisions || listing {
					expected = -1
				}
				if scenario == "versions-response-failed" || scenario == "directory-response-failed" {
					writer = readReceiptErrorWriter{}
				}
				err := jobstore.CopyNativeRead(actor, read, expected, writer, open)
				complete := scenario == "complete" || scenario == "empty" || scenario == "versions-complete" || scenario == "directory-complete" || scenario == "directory-empty"
				if (err == nil) != complete {
					t.Fatalf("source completion error mismatch: %v", err)
				}
				persisted, err := store.GetJob(job.ID, jobproto.TaskStatus_Any)
				if err != nil {
					t.Fatal(err)
				}
				var retained *jobproto.Task
				for _, task := range persisted.Tasks {
					if task.ID == key {
						retained = task
					}
				}
				if retained == nil || !jobstore.TaskHasClaim(retained) {
					t.Fatal("original first-dispatch claim was not retained")
				}
				receipt, receiptErr := jobstore.NativeReadTaskReceipt(retained)
				terminal := complete || scenario == "completion-ACK-lost" || scenario == "versions-completion-ACK-lost" || scenario == "directory-completion-ACK-lost"
				if (receiptErr == nil) != terminal {
					t.Fatalf("unknown/partial stream was asserted terminal: %v", receiptErr)
				}
				if terminal {
					if (revisions || listing) && receipt.ContentReference != nil {
						t.Fatal("native listing payload entered the Task as content")
					}
					digest := sha256.Sum256(body)
					if receipt.ContentBytes != int64(len(body)) || receipt.ContentSHA256 != hex.EncodeToString(digest[:]) {
						t.Fatal("actual native byte evidence was not retained")
					}
					when, _ := time.Parse(time.RFC3339Nano, receipt.CompletedAt)
					if when.Unix() != int64(retained.EndTime) || len(receipt.Measurements) != 2 || receipt.Measurements[0].Quantity != 1 || receipt.Measurements[1].Quantity != int64(len(body)) {
						t.Fatal("original completion time/meters mismatch")
					}
					if scenario == "empty" {
						for _, missing := range []string{"missing-bytes", "null-bytes", "missing-quantity", "null-quantity"} {
							t.Run(missing, func(t *testing.T) {
								bad := proto.Clone(retained).(*jobproto.Task)
								result := bad.ActionsLogs[len(bad.ActionsLogs)-1].OutputMessage.OutputChain[0]
								var value map[string]interface{}
								if err := json.Unmarshal(result.JsonBody, &value); err != nil {
									t.Fatal(err)
								}
								switch missing {
								case "missing-bytes":
									delete(value, "contentBytes")
								case "null-bytes":
									value["contentBytes"] = nil
								case "missing-quantity":
									delete(value["measurements"].([]interface{})[1].(map[string]interface{}), "quantity")
								case "null-quantity":
									value["measurements"].([]interface{})[1].(map[string]interface{})["quantity"] = nil
								}
								encoded, err := json.Marshal(value)
								if err != nil {
									t.Fatal(err)
								}
								result.JsonBody = encoded
								if _, err := jobstore.NativeReadTaskReceipt(bad); err == nil {
									t.Fatal("missing/null byte evidence was asserted zero")
								}
							})
						}
					}
					observation := *read
					observation.Input = map[string]interface{}{"externalExecutionId": ids[6]}
					if !jobstore.NativeReadTaskMatches(retained, &observation, ids[1]) {
						t.Fatal("same operation could not read its original receipt")
					}
					bad := proto.Clone(retained).(*jobproto.Task)
					bad.ActionsLogs = bad.ActionsLogs[:1]
					if store.PutTask(bad) == nil {
						t.Fatal("persisted source evidence was removed")
					}
					if _, err := jobstore.NativeReadTaskReceipt(bad); err == nil {
						t.Fatal("Finished without source evidence was accepted")
					}
				}
				before := opens
				if err := jobstore.CopyNativeRead(actor, read, expected, writer, open); err == nil || opens != before {
					t.Fatal("same-key request reopened the source")
				}
				if err := store.DeleteTasks(job.ID, []string{key}); err == nil {
					t.Fatal("native retention removed a claimed read key")
				}
				if err := store.DeleteJob(job.ID); err == nil {
					t.Fatal("native job cleanup removed claimed read keys")
				}
				if opens > 0 && scenario != "source-open-failed" && scenario != "versions-source-failed" && scenario != "directory-source-failed" && closes != 1 {
					t.Fatal("source was not closed exactly once")
				}
			})
		}
	})
}

type taskReceiptStore struct {
	jobstore.DAO
	failure     *error
	loadFailure *error
}

type nativeReadJobStore struct {
	jobstore.DAO
	*nativeReadJobState
}

type nativeReadJobState struct {
	mode      string
	claims    atomic.Int32
	puts      atomic.Int32
	readCalls atomic.Int32
}

func (s *nativeReadJobStore) PutJob(job *jobproto.Job) error {
	s.puts.Add(1)
	return s.DAO.PutJob(job)
}

func (s *nativeReadJobStore) GetJob(id string, status jobproto.TaskStatus) (*jobproto.Job, error) {
	call := s.readCalls.Add(1)
	if s.mode == "read-error" || (s.mode == "readback-error" && call > 1) {
		return nil, errors.New("original native Job read unavailable")
	}
	return s.DAO.GetJob(id, status)
}

func (s *nativeReadJobStore) ClaimJob(ctx context.Context, job *jobproto.Job) error {
	s.claims.Add(1)
	if s.mode == "claim-error" {
		return errors.New("original native Job insert unavailable")
	}
	if err := s.DAO.ClaimJob(ctx, job); err != nil {
		return err
	}
	if s.mode == "claim-ACK-lost" {
		return errors.New("original native Job insert ACK unavailable")
	}
	return nil
}

func TestNativeActionJobStartupConsumesOriginalDelivery(t *testing.T) {
	var store *nativeReadJobStore
	var first sync.Once
	state := &nativeReadJobState{}
	constructor := func(db boltdb.DB) jobstore.DAO {
		// The original manager constructs a DAO on every Resolve. Faults and
		// counters belong to the same native database, not one wrapper instance.
		next := &nativeReadJobStore{DAO: bolt.NewBoltDAO(db), nativeReadJobState: state}
		first.Do(func() { store = next })
		return next
	}
	test.RunStorageTests([]test.StorageTestCase{test.TemplateBoltWithPrefix(constructor, "native_read_job_")}, t, func(ctx context.Context) {
		ctx = config.WithStubStore(ctx)
		handler := NewJobsHandler(ctx, "native-read-job-startup")
		configure := func(t *testing.T, value map[string]interface{}) {
			t.Helper()
			// The original config store merges maps. Each operator delivery is
			// independent; a prior case must not fill in its omitted fields.
			ctx = config.WithStubStore(ctx)
			if value == nil {
				return
			}
			if err := config.Set(ctx, value, "services", common.ServiceRestNamespace_+"n", "platform"); err != nil {
				t.Fatal(err)
			}
		}
		delivery := func(id string) map[string]interface{} {
			return map[string]interface{}{"requestTimeout": "1m", "read": map[string]interface{}{
				"nativeJobId": id, "usageMeasurements": []interface{}{},
			}}
		}
		writeDelivery := func(id string) map[string]interface{} {
			return map[string]interface{}{"requestTimeout": "1m", "write": map[string]interface{}{
				"nativeJobId": id, "actionVersion": 1, "nativeType": "native-file",
				"resultExposurePolicyId": "99e784d0-58d7-4d2e-8b04-d2bdc3f8d7f1", "resultExposurePolicyVersion": 1,
			}}
		}
		for _, scenario := range []string{"admission-only", "empty-optional-id", "spaces-id", "wrong-id-type", "missing-action-version", "unknown-action-version", "missing-native-type", "padded-native-type", "unknown-policy", "missing-policy-version", "same-read-write-id", "missing-deadline"} {
			t.Run("write-"+scenario, func(t *testing.T) {
				value := writeDelivery("write-rejected-" + scenario)
				write := value["write"].(map[string]interface{})
				switch scenario {
				case "admission-only":
					delete(write, "nativeJobId")
				case "empty-optional-id":
					write["nativeJobId"] = ""
				case "spaces-id":
					write["nativeJobId"] = " padded "
				case "wrong-id-type":
					write["nativeJobId"] = 1
				case "missing-action-version":
					delete(write, "actionVersion")
				case "unknown-action-version":
					write["actionVersion"] = "unknown"
				case "missing-native-type":
					delete(write, "nativeType")
				case "padded-native-type":
					write["nativeType"] = " native-file "
				case "unknown-policy":
					write["resultExposurePolicyId"] = "unknown"
				case "missing-policy-version":
					delete(write, "resultExposurePolicyVersion")
				case "same-read-write-id":
					value["read"] = delivery(write["nativeJobId"].(string))["read"]
				case "missing-deadline":
					delete(value, "requestTimeout")
				}
				// A valid Read beside bad Write must not be inserted first.
				if scenario != "admission-only" && scenario != "empty-optional-id" && scenario != "same-read-write-id" {
					value["read"] = delivery("read-beside-" + scenario)["read"]
				}
				configure(t, value)
				before := store.claims.Load()
				err := handler.EnsureNativeActionJobs(ctx)
				if (scenario == "admission-only" || scenario == "empty-optional-id") != (err == nil) || store.claims.Load() != before {
					t.Fatalf("invalid/optional write configuration changed a native Job: err=%v claims=%d", err, store.claims.Load()-before)
				}
			})
		}
		t.Run("read-and-write-create-and-restart-without-dispatch", func(t *testing.T) {
			value := writeDelivery("paired-write-job")
			value["read"] = delivery("paired-read-job")["read"]
			configure(t, value)
			previous := broker.Default()
			broker.Register(&taskReceiptBroker{Broker: previous, publish: func(string, proto.Message) { t.Error("startup dispatched a native event") }})
			defer broker.Register(previous)
			before := store.claims.Load()
			if err := handler.EnsureNativeActionJobs(ctx); err != nil || store.claims.Load() != before+2 {
				t.Fatal("controlled jobs were not both create-only persisted", err)
			}
			for _, expected := range []*jobproto.Job{jobstore.NativeReadJob("paired-read-job"), jobstore.NativeWriteJob("paired-write-job")} {
				actual, err := store.DAO.GetJob(expected.ID, jobproto.TaskStatus_Unknown)
				if err != nil || !nativeActionJobMatches(actual, expected) || actual.CreatedAt == 0 || actual.ModifiedAt != actual.CreatedAt {
					t.Fatal("controlled native Job has incompatible semantics", actual, err)
				}
				loaded, err := store.DAO.GetJob(expected.ID, jobproto.TaskStatus_Any)
				if err != nil || len(loaded.Tasks) != 0 {
					t.Fatal("bootstrap dispatched a native Task", err)
				}
			}
			before = store.claims.Load()
			if err := handler.EnsureNativeActionJobs(ctx); err != nil || store.claims.Load() != before || store.puts.Load() != 0 {
				t.Fatal("restart replaced or dispatched controlled native Jobs", err)
			}
		})
		for _, change := range []struct {
			name   string
			change func(*jobproto.Job)
		}{
			{"auto-start", func(j *jobproto.Job) { j.AutoStart = true }},
			{"inactive", func(j *jobproto.Job) { j.Inactive = true }},
			{"events", func(j *jobproto.Job) { j.EventNames = []string{"NODE_CREATE"} }},
			{"schedule", func(j *jobproto.Job) { j.Schedule = &jobproto.Schedule{Iso8601Schedule: "delivered-original-schedule"} }},
			{"unknown-action", func(j *jobproto.Job) { j.Actions[0].ID = "unknown-native-action" }},
			{"extra-action", func(j *jobproto.Job) {
				j.Actions = append(j.Actions, &jobproto.Action{ID: jobstore.NativeVersionActionID})
			}},
			{"action-parameters", func(j *jobproto.Job) { j.Actions[0].Parameters = map[string]string{"node": "untrusted-node"} }},
		} {
			t.Run("write-existing-"+change.name, func(t *testing.T) {
				id := "write-drift-" + change.name
				job := jobstore.NativeWriteJob(id)
				change.change(job)
				if err := store.DAO.PutJob(job); err != nil {
					t.Fatal(err)
				}
				value := writeDelivery(id)
				value["read"] = delivery("read-with-write-drift-" + change.name)["read"]
				configure(t, value)
				before := store.claims.Load()
				if err := handler.EnsureNativeActionJobs(ctx); !cellserrors.Is(err, cellserrors.StatusConflict) || store.claims.Load() != before {
					t.Fatal("incompatible Write Job accepted or partial Read Job inserted", err)
				}
				actual, err := store.DAO.GetJob(id, jobproto.TaskStatus_Unknown)
				if err != nil || !proto.Equal(actual, job) || jobstore.NativeWriteJobMatches(actual, id) {
					t.Fatal("drifted Write Job overwritten or executable", err)
				}
			})
		}
		for _, mode := range []string{"read-error", "claim-error", "claim-ACK-lost", "readback-error"} {
			t.Run("write-"+mode, func(t *testing.T) {
				id := "write-uncertain-" + mode
				configure(t, writeDelivery(id))
				store.mode = mode
				store.readCalls.Store(0)
				if err := handler.EnsureNativeActionJobs(ctx); err == nil {
					t.Fatal("unknown Write Job persistence was reported as startup success")
				}
				store.mode = ""
				before := store.claims.Load()
				persisted, err := store.DAO.GetJob(id, jobproto.TaskStatus_Unknown)
				if mode == "claim-ACK-lost" || mode == "readback-error" {
					if err != nil || !jobstore.NativeWriteJobMatches(persisted, id) {
						t.Fatal("original persisted Write Job was lost", err)
					}
					if err := handler.EnsureNativeActionJobs(ctx); err != nil || store.claims.Load() != before {
						t.Fatal("Write Job was reinserted after unknown ACK", err)
					}
				} else if !cellserrors.Is(err, cellserrors.JobNotFound) {
					t.Fatal("failed original probe or insert created a Write Job", err)
				}
			})
		}
		for _, scenario := range []string{"absent", "independent-without-read", "blank-id", "spaces-id", "missing-meters", "null-meters", "duplicate-meter", "unknown-meter-source", "missing-deadline", "unknown-deadline"} {
			t.Run(scenario, func(t *testing.T) {
				value := delivery("rejected-" + scenario)
				read := value["read"].(map[string]interface{})
				switch scenario {
				case "absent":
					value = nil
				case "independent-without-read":
					delete(value, "read")
				case "blank-id":
					read["nativeJobId"] = ""
				case "spaces-id":
					read["nativeJobId"] = " padded "
				case "missing-meters":
					delete(read, "usageMeasurements")
				case "null-meters":
					read["usageMeasurements"] = nil
				case "duplicate-meter":
					read["usageMeasurements"] = []interface{}{map[string]interface{}{"meterKey": "count", "quantitySource": "COUNT"}, map[string]interface{}{"meterKey": "count", "quantitySource": "CONTENT_BYTES"}}
				case "unknown-meter-source":
					read["usageMeasurements"] = []interface{}{map[string]interface{}{"meterKey": "count", "quantitySource": "NEW"}}
				case "missing-deadline":
					delete(value, "requestTimeout")
				case "unknown-deadline":
					value["requestTimeout"] = "not-duration"
				}
				configure(t, value)
				before := store.claims.Load()
				err := handler.EnsureNativeActionJobs(ctx)
				if (scenario == "absent" || scenario == "independent-without-read") != (err == nil) || store.claims.Load() != before {
					t.Fatalf("missing/invalid delivery created native Job: err=%v claims=%d", err, store.claims.Load()-before)
				}
			})
		}
		t.Run("create-and-restart-without-task-or-event", func(t *testing.T) {
			configure(t, delivery("read-job"))
			previous := broker.Default()
			broker.Register(&taskReceiptBroker{Broker: previous, publish: func(string, proto.Message) { t.Error("startup dispatched a native event") }})
			defer broker.Register(previous)
			if err := handler.EnsureNativeActionJobs(ctx); err != nil {
				t.Fatal(err)
			}
			created, err := store.DAO.GetJob("read-job", jobproto.TaskStatus_Unknown)
			if err != nil || !jobstore.NativeReadJobMatches(created, "read-job") || created.CreatedAt == 0 || created.ModifiedAt != created.CreatedAt {
				t.Fatal("startup did not persist the original native Job", created, err)
			}
			before := store.claims.Load()
			if err := handler.EnsureNativeActionJobs(ctx); err != nil || store.claims.Load() != before || store.puts.Load() != 0 {
				t.Fatal("restart overwrote/reinserted a native Job", err)
			}
			reloaded, err := store.DAO.GetJob("read-job", jobproto.TaskStatus_Any)
			if err != nil || len(reloaded.Tasks) != 0 {
				t.Fatal("startup produced a native Task", err)
			}
		})
		for _, change := range []struct {
			name   string
			change func(*jobproto.Job)
		}{
			{"inactive", func(j *jobproto.Job) { j.Inactive = true }},
			{"owner", func(j *jobproto.Job) { j.Owner = "foreign-native-owner" }},
			{"auto-start", func(j *jobproto.Job) { j.AutoStart = true }},
			{"auto-restart", func(j *jobproto.Job) { j.AutoRestart = true }},
			{"auto-clean", func(j *jobproto.Job) { j.AutoClean = true }},
			{"schedule", func(j *jobproto.Job) { j.Schedule = &jobproto.Schedule{Iso8601Schedule: "delivered-original-schedule"} }},
			{"events", func(j *jobproto.Job) { j.EventNames = []string{"NODE_CREATE"} }},
			{"actions", func(j *jobproto.Job) { j.Actions = []*jobproto.Action{{ID: "original-action"}} }},
			{"hooks", func(j *jobproto.Job) { j.Hooks = []*jobproto.JobHook{{ApiSlug: "original-hook"}} }},
			{"task-events", func(j *jobproto.Job) { j.TasksSilentUpdate = false }},
		} {
			t.Run("existing-"+change.name, func(t *testing.T) {
				id := "drift-" + change.name
				job := jobstore.NativeReadJob(id)
				change.change(job)
				if err := store.DAO.PutJob(job); err != nil {
					t.Fatal(err)
				}
				configure(t, delivery(id))
				before := store.claims.Load()
				if err := handler.EnsureNativeActionJobs(ctx); !cellserrors.Is(err, cellserrors.StatusConflict) || store.claims.Load() != before {
					t.Fatal("drifted native Job accepted or replaced", err)
				}
				actual, err := store.DAO.GetJob(id, jobproto.TaskStatus_Unknown)
				if err != nil || !proto.Equal(actual, job) {
					t.Fatal("incompatible original Job was overwritten", err)
				}
			})
		}
		t.Run("concurrent-startup-is-create-only", func(t *testing.T) {
			configure(t, delivery("concurrent-read-job"))
			var wg sync.WaitGroup
			for range 16 {
				wg.Add(1)
				go func() {
					defer wg.Done()
					if err := handler.EnsureNativeActionJobs(ctx); err != nil && !errors.Is(err, context.DeadlineExceeded) {
						t.Error(err)
					}
				}()
			}
			wg.Wait()
			job, err := store.DAO.GetJob("concurrent-read-job", jobproto.TaskStatus_Unknown)
			if err != nil || !jobstore.NativeReadJobMatches(job, "concurrent-read-job") || store.puts.Load() != 0 {
				t.Fatal("concurrent startup did not keep the original Job", err)
			}
		})
		t.Run("same-native-job-key-cannot-overwrite", func(t *testing.T) {
			original := jobstore.NativeReadJob("create-only-job")
			if err := store.DAO.ClaimJob(ctx, original); err != nil {
				t.Fatal(err)
			}
			for _, candidate := range []*jobproto.Job{proto.Clone(original).(*jobproto.Job), {ID: original.ID, AutoStart: true, Owner: "foreign-owner"}} {
				if err := store.DAO.ClaimJob(ctx, candidate); !cellserrors.Is(err, cellserrors.StatusConflict) {
					t.Fatal("same native Job key permitted another insertion", err)
				}
			}
			actual, err := store.DAO.GetJob(original.ID, jobproto.TaskStatus_Unknown)
			if err != nil || !proto.Equal(actual, original) {
				t.Fatal("native Job claim replaced frozen startup semantics", err)
			}
			canceled, cancel := context.WithCancel(ctx)
			cancel()
			if err := store.DAO.ClaimJob(canceled, jobstore.NativeReadJob("canceled-before-job-insert")); !errors.Is(err, context.Canceled) {
				t.Fatal("canceled startup inserted a native Job", err)
			}
		})
		for _, mode := range []string{"read-error", "claim-error", "claim-ACK-lost", "readback-error"} {
			t.Run(mode, func(t *testing.T) {
				id := "uncertain-" + mode
				configure(t, delivery(id))
				store.mode = mode
				store.readCalls.Store(0)
				if err := handler.EnsureNativeActionJobs(ctx); err == nil {
					t.Fatal("unknown persistence was reported as successful startup")
				}
				store.mode = ""
				before := store.claims.Load()
				persisted, err := store.DAO.GetJob(id, jobproto.TaskStatus_Unknown)
				if mode == "claim-ACK-lost" || mode == "readback-error" {
					if err != nil || !jobstore.NativeReadJobMatches(persisted, id) {
						t.Fatal("actual original persisted Job was lost", err)
					}
					if err := handler.EnsureNativeActionJobs(ctx); err != nil || store.claims.Load() != before {
						t.Fatal("persisted Job was reinserted after unknown ACK", err)
					}
				} else if !cellserrors.Is(err, cellserrors.JobNotFound) {
					t.Fatal("failed original probe/insert created a Job", err)
				}
			})
		}
	})
}

func (s *taskReceiptStore) PutTask(task *jobproto.Task) error {
	if *s.failure != nil {
		return *s.failure
	}
	return s.DAO.PutTask(task)
}

func (s *taskReceiptStore) ClaimTask(task *jobproto.Task) error {
	if *s.failure != nil {
		return *s.failure
	}
	return s.DAO.ClaimTask(task)
}

func (s *taskReceiptStore) GetJob(id string, status jobproto.TaskStatus) (*jobproto.Job, error) {
	if *s.loadFailure != nil {
		return nil, *s.loadFailure
	}
	return s.DAO.GetJob(id, status)
}

type taskReceiptStream struct {
	grpc.ServerStream
	ctx      context.Context
	requests []*jobproto.PutTaskRequest
	recvErr  error
	send     func(*jobproto.PutTaskResponse) error
}

func (s *taskReceiptStream) Context() context.Context { return s.ctx }
func (s *taskReceiptStream) Recv() (*jobproto.PutTaskRequest, error) {
	if len(s.requests) == 0 {
		if s.recvErr != nil {
			return nil, s.recvErr
		}
		return nil, io.EOF
	}
	request := s.requests[0]
	s.requests = s.requests[1:]
	return request, nil
}
func (s *taskReceiptStream) Send(response *jobproto.PutTaskResponse) error {
	return s.send(response)
}

type taskReceiptBroker struct {
	broker.Broker
	publish func(string, proto.Message)
}

func (b *taskReceiptBroker) Publish(_ context.Context, topic string, message proto.Message, _ ...broker.PublishOption) error {
	b.publish(topic, message)
	return nil
}

func TestNativeTaskStreamAcknowledgesPersistence(t *testing.T) {
	var store jobstore.DAO
	var storageFailure error
	var loadFailure error
	constructor := func(db boltdb.DB) jobstore.DAO {
		store = &taskReceiptStore{DAO: bolt.NewBoltDAO(db), failure: &storageFailure, loadFailure: &loadFailure}
		return store
	}
	test.RunStorageTests([]test.StorageTestCase{test.TemplateBoltWithPrefix(constructor, "native_task_receipt_")}, t, func(ctx context.Context) {
		resolved, err := manager.Resolve[jobstore.DAO](ctx)
		if err != nil {
			t.Fatal(err)
		}
		store = resolved
		job := &jobproto.Job{ID: "native-job", Owner: "native-owner", Label: "Native task"}
		if err := store.PutJob(job); err != nil {
			t.Fatal(err)
		}
		assertStored := func(task *jobproto.Task) {
			t.Helper()
			persisted, err := store.GetJob(task.JobID, jobproto.TaskStatus_Any)
			if err != nil || len(persisted.GetTasks()) != 1 || !proto.Equal(persisted.Tasks[0], task) {
				t.Errorf("native acknowledgement/event preceded durable task: task=%v stored=%v err=%v", task, persisted, err)
			}
		}
		published := 0
		previous := broker.Default()
		broker.Register(&taskReceiptBroker{Broker: previous, publish: func(topic string, message proto.Message) {
			if topic != common.TopicJobTaskEvent {
				t.Errorf("unexpected task topic %s", topic)
				return
			}
			event, ok := message.(*jobproto.TaskChangeEvent)
			if !ok {
				t.Errorf("unexpected task event %T", message)
				return
			}
			assertStored(event.TaskUpdated)
			published++
		}})
		defer broker.Register(previous)
		handler := NewJobsHandler(ctx, "native-task-test")
		for _, terminal := range []jobproto.TaskStatus{jobproto.TaskStatus_Error, jobproto.TaskStatus_Interrupted, jobproto.TaskStatus_Finished} {
			t.Run(terminal.String(), func(t *testing.T) {
				requests := []*jobproto.PutTaskRequest{}
				for index, status := range []jobproto.TaskStatus{jobproto.TaskStatus_Running, jobproto.TaskStatus_Running, terminal} {
					requests = append(requests, &jobproto.PutTaskRequest{Task: &jobproto.Task{
						ID: "native-task", JobID: job.ID, TriggerOwner: "native-actor", Status: status,
						StatusMessage: status.String(), StartTime: 1, Progress: float32(index),
					}})
				}
				acks, initialEvents := 0, published
				stream := &taskReceiptStream{ctx: ctx, requests: requests, send: func(response *jobproto.PutTaskResponse) error {
					assertStored(response.GetTask())
					acks++
					return nil
				}}
				if err := handler.PutTaskStream(stream); err != nil || acks != 3 || published-initialEvents != 3 {
					t.Errorf("native status stream not durably acknowledged: acks=%d events=%d err=%v", acks, published-initialEvents, err)
				}
			})
		}

		t.Run("storage-failure", func(t *testing.T) {
			failure := errors.New("native task persistence unavailable")
			storageFailure = failure
			defer func() { storageFailure = nil }()
			acks, initialEvents := 0, published
			stream := &taskReceiptStream{ctx: ctx, requests: []*jobproto.PutTaskRequest{{Task: &jobproto.Task{
				ID: "native-task", JobID: job.ID, TriggerOwner: "native-actor", Status: jobproto.TaskStatus_Error,
			}}}, send: func(*jobproto.PutTaskResponse) error { acks++; return nil }}
			if err := handler.PutTaskStream(stream); !errors.Is(err, failure) || acks != 0 || published != initialEvents {
				t.Errorf("failed persistence produced an ACK/event: acks=%d events=%d err=%v", acks, published-initialEvents, err)
			}
		})

		t.Run("lost-ack-keeps-native-reference", func(t *testing.T) {
			failure := errors.New("native task ACK transport lost")
			task := &jobproto.Task{ID: "native-task", JobID: job.ID, TriggerOwner: "native-actor", Status: jobproto.TaskStatus_Error}
			request := &jobproto.PutTaskRequest{Task: task}
			stream := &taskReceiptStream{ctx: ctx, requests: []*jobproto.PutTaskRequest{request}, send: func(*jobproto.PutTaskResponse) error { return failure }}
			if err := handler.PutTaskStream(stream); !errors.Is(err, failure) {
				t.Errorf("lost ACK was hidden: %v", err)
			}
			assertStored(task)
			// The existing reconnecting client repeats this status write, not
			// task execution. The original DAO retains one exact task reference.
			response, err := handler.PutTask(ctx, request)
			if err != nil || !proto.Equal(response.GetTask(), task) {
				t.Errorf("status receipt retry changed the native reference: %v %v", response, err)
			}
			assertStored(task)
		})

		t.Run("job-read-unknown-is-not-missing", func(t *testing.T) {
			failure := errors.New("native job read unavailable")
			loadFailure = failure
			defer func() { loadFailure = nil }()
			acks, initialEvents := 0, published
			stream := &taskReceiptStream{ctx: ctx, requests: []*jobproto.PutTaskRequest{{Task: &jobproto.Task{
				ID: "native-task", JobID: job.ID, Status: jobproto.TaskStatus_Error,
			}}}, send: func(*jobproto.PutTaskResponse) error { acks++; return nil }}
			if err := handler.PutTaskStream(stream); !errors.Is(err, failure) || cellserrors.Is(err, cellserrors.JobNotFound) || acks != 0 || published != initialEvents {
				t.Errorf("unknown native job read became missing/success: acks=%d events=%d err=%v", acks, published-initialEvents, err)
			}
		})

		t.Run("receive-failure", func(t *testing.T) {
			failure := errors.New("native task receive lost")
			stream := &taskReceiptStream{ctx: ctx, recvErr: failure, send: func(*jobproto.PutTaskResponse) error { t.Error("unexpected ACK"); return nil }}
			if err := handler.PutTaskStream(stream); !errors.Is(err, failure) {
				t.Errorf("receive failure was hidden: %v", err)
			}
		})

		t.Run("job-is-rechecked", func(t *testing.T) {
			acks := 0
			request := &jobproto.PutTaskRequest{Task: &jobproto.Task{ID: "native-task", JobID: job.ID, TriggerOwner: "native-actor"}}
			stream := &taskReceiptStream{ctx: ctx, requests: []*jobproto.PutTaskRequest{request, request}, send: func(*jobproto.PutTaskResponse) error {
				acks++
				return store.DeleteJob(job.ID)
			}}
			if err := handler.PutTaskStream(stream); !cellserrors.Is(err, cellserrors.JobNotFound) || acks != 1 {
				t.Errorf("removed job was accepted through cached metadata: acks=%d err=%v", acks, err)
			}
		})
	})
}

func TestNativeTaskReceiptRequiresReferences(t *testing.T) {
	handler := new(JobsHandler)
	for _, request := range []*jobproto.PutTaskRequest{nil, {}, {Task: &jobproto.Task{}}, {Task: &jobproto.Task{ID: "task"}}, {Task: &jobproto.Task{JobID: "job"}}} {
		response, err := handler.PutTask(context.Background(), request)
		if response != nil || !cellserrors.Is(err, cellserrors.InvalidParameters) {
			t.Errorf("missing task/job reference was not rejected before persistence: response=%v err=%v", response, err)
		}
	}
}

func TestNativeTaskFirstDispatchClaim(t *testing.T) {
	constructor := func(db boltdb.DB) jobstore.DAO { return bolt.NewBoltDAO(db) }
	test.RunStorageTests([]test.StorageTestCase{test.TemplateBoltWithPrefix(constructor, "native_task_claim_")}, t, func(ctx context.Context) {
		store, err := manager.Resolve[jobstore.DAO](ctx)
		if err != nil {
			t.Fatal(err)
		}
		for _, id := range []string{"claim-job", "other-job"} {
			if err := store.PutJob(&jobproto.Job{ID: id, TasksSilentUpdate: true}); err != nil {
				t.Fatal(err)
			}
		}
		handler := NewJobsHandler(ctx, "native-task-claim-test")
		task := &jobproto.Task{ID: "stable-operation", JobID: "claim-job", TriggerOwner: "native-actor", Status: jobproto.TaskStatus_Queued,
			ActionsLogs: []*jobproto.ActionLog{{InputMessage: &jobproto.ActionMessage{OutputChain: []*jobproto.ActionOutput{{
				JsonBody: []byte(`{"requestDigest":"frozen-input"}`), Vars: map[string]string{jobstore.TaskCreateOnly: "true"},
			}}}}},
		}
		claim := func(input *jobproto.Task) (*jobproto.PutTaskResponse, error) {
			return handler.PutTask(ctx, &jobproto.PutTaskRequest{Task: input, StatusMeta: map[string]string{jobstore.TaskCreateOnly: "true"}})
		}
		t.Run("deleted-job-cannot-be-claimed-after-stale-read", func(t *testing.T) {
			job := &jobproto.Job{ID: "removed-before-claim"}
			if err := store.PutJob(job); err != nil {
				t.Fatal(err)
			}
			if _, err := store.GetJob(job.ID, jobproto.TaskStatus_Unknown); err != nil {
				t.Fatal(err)
			}
			if err := store.DeleteJob(job.ID); err != nil {
				t.Fatal(err)
			}
			input := proto.Clone(task).(*jobproto.Task)
			input.ID, input.JobID = "removed-job-operation", job.ID
			if err := store.ClaimTask(input); !cellserrors.Is(err, cellserrors.JobNotFound) {
				t.Fatalf("native claim survived a deleted job's stale read: %v", err)
			}
			// A failed claim must not reserve the key in an orphan task bucket.
			if err := store.PutJob(job); err != nil {
				t.Fatal(err)
			}
			if err := store.ClaimTask(input); err != nil {
				t.Fatalf("rejected claim left an orphan operation reference: %v", err)
			}
		})
		t.Run("concurrent-first-dispatch", func(t *testing.T) {
			var accepted atomic.Int32
			var wg sync.WaitGroup
			for range 16 {
				wg.Add(1)
				go func() {
					defer wg.Done()
					response, err := claim(proto.Clone(task).(*jobproto.Task))
					if err == nil && proto.Equal(response.GetTask(), task) {
						accepted.Add(1)
					} else if !cellserrors.Is(err, cellserrors.StatusConflict) {
						t.Errorf("unexpected first-dispatch response=%v err=%v", response, err)
					}
				}()
			}
			wg.Wait()
			if accepted.Load() != 1 {
				t.Fatalf("same native operation permitted %d first dispatches", accepted.Load())
			}
		})
		for _, change := range []struct {
			name   string
			mutate func(*jobproto.Task)
		}{
			{"same-intent", func(*jobproto.Task) {}},
			{"another-job", func(v *jobproto.Task) { v.JobID = "other-job" }},
			{"another-actor", func(v *jobproto.Task) { v.TriggerOwner = "another-actor" }},
			{"another-input", func(v *jobproto.Task) {
				v.ActionsLogs[0].InputMessage.OutputChain[0].JsonBody = []byte(`{"requestDigest":"changed"}`)
			}},
		} {
			t.Run(change.name, func(t *testing.T) {
				input := proto.Clone(task).(*jobproto.Task)
				change.mutate(input)
				if response, err := claim(input); response != nil || !cellserrors.Is(err, cellserrors.StatusConflict) {
					t.Fatalf("existing reference granted new dispatch: %v %v", response, err)
				}
				if change.name != "same-intent" {
					input.Status = jobproto.TaskStatus_Running
					if _, err := handler.PutTask(ctx, &jobproto.PutTaskRequest{Task: input}); !cellserrors.Is(err, cellserrors.StatusConflict) {
						t.Fatalf("status write replaced immutable native claim: %v", err)
					}
					if err := store.PutTasks(map[string]map[string]*jobproto.Task{input.JobID: {input.ID: input}}); !cellserrors.Is(err, cellserrors.StatusConflict) {
						t.Fatalf("bulk status write replaced immutable native claim: %v", err)
					}
				}
			})
		}
		t.Run("lost-claim-ack-is-observe-only", func(t *testing.T) {
			input := proto.Clone(task).(*jobproto.Task)
			input.ID = "lost-ack-operation"
			failure := errors.New("native claim ACK lost")
			stream := &taskReceiptStream{ctx: ctx, requests: []*jobproto.PutTaskRequest{{Task: input, StatusMeta: map[string]string{jobstore.TaskCreateOnly: "true"}}}, send: func(*jobproto.PutTaskResponse) error { return failure }}
			if err := handler.PutTaskStream(stream); !errors.Is(err, failure) {
				t.Fatalf("claim ACK loss hidden: %v", err)
			}
			if response, err := claim(input); response != nil || !cellserrors.Is(err, cellserrors.StatusConflict) {
				t.Fatalf("lost ACK allowed native replay: %v %v", response, err)
			}
			persisted, err := store.GetJob(input.JobID, jobproto.TaskStatus_Any)
			if err != nil {
				t.Fatal(err)
			}
			found := false
			for _, stored := range persisted.Tasks {
				if stored.ID == input.ID {
					found = proto.Equal(stored, input)
				}
			}
			if !found {
				t.Fatal("lost ACK destroyed the original queued task reference")
			}
		})
		t.Run("status-update-retains-claim", func(t *testing.T) {
			input := proto.Clone(task).(*jobproto.Task)
			input.Status = jobproto.TaskStatus_Finished
			input.EndTime = 1
			if response, err := handler.PutTask(ctx, &jobproto.PutTaskRequest{Task: input}); err != nil || !proto.Equal(response.GetTask(), input) {
				t.Fatalf("original status stream cannot finish claimed native task: %v %v", response, err)
			}
			if _, err := claim(task); !cellserrors.Is(err, cellserrors.StatusConflict) {
				t.Fatalf("completed task was replayed: %v", err)
			}
		})
		t.Run("cleanup-cannot-reopen-operation-key", func(t *testing.T) {
			if err := store.DeleteTasks(task.JobID, []string{task.ID}); !cellserrors.Is(err, cellserrors.StatusConflict) {
				t.Fatalf("task cleanup erased native dedupe evidence: %v", err)
			}
			if err := store.DeleteJob(task.JobID); !cellserrors.Is(err, cellserrors.StatusConflict) {
				t.Fatalf("job cleanup erased native dedupe evidence: %v", err)
			}
			plain := &jobproto.Task{ID: "ordinary-task", JobID: task.JobID, Status: jobproto.TaskStatus_Finished}
			if err := store.PutTask(plain); err != nil {
				t.Fatal(err)
			}
			response, err := handler.DeleteTasks(ctx, &jobproto.DeleteTasksRequest{JobId: task.JobID, Status: []jobproto.TaskStatus{jobproto.TaskStatus_Finished}})
			if err != nil || len(response.Deleted) != 1 || response.Deleted[0] != plain.ID {
				t.Fatalf("original status prune did not preserve claimed task / remove ordinary task: %v %v", response, err)
			}
			if _, err := claim(task); !cellserrors.Is(err, cellserrors.StatusConflict) {
				t.Fatalf("cleanup granted operation replay: %v", err)
			}
		})
		t.Run("persisted-version-result-is-append-only", func(t *testing.T) {
			input := proto.Clone(task).(*jobproto.Task)
			input.Status = jobproto.TaskStatus_Finished
			input.ActionsLogs = append(input.ActionsLogs, &jobproto.ActionLog{Action: &jobproto.Action{ID: "native-version-action"}, OutputMessage: &jobproto.ActionMessage{OutputChain: []*jobproto.ActionOutput{{Success: true, JsonBody: []byte(`{"VersionId":"native-version"}`), Vars: map[string]string{jobstore.NativeVersionResult: "true"}}}}})
			if err := store.PutTask(input); err != nil {
				t.Fatal(err)
			}
			for _, next := range []*jobproto.Task{proto.Clone(task).(*jobproto.Task), proto.Clone(input).(*jobproto.Task)} {
				if len(next.ActionsLogs) > 1 {
					next.ActionsLogs[1].OutputMessage.OutputChain[0].JsonBody = []byte(`{"VersionId":"changed"}`)
				}
				if err := store.PutTask(next); !cellserrors.Is(err, cellserrors.StatusConflict) {
					t.Fatalf("status write erased/changed durable revision receipt: %v", err)
				}
			}
		})
		for _, mode := range []string{"", "false", "unknown"} {
			t.Run("invalid-mode-"+mode, func(t *testing.T) {
				input := proto.Clone(task).(*jobproto.Task)
				input.ID = "invalid-mode-" + mode
				if _, err := handler.PutTask(ctx, &jobproto.PutTaskRequest{Task: input, StatusMeta: map[string]string{jobstore.TaskCreateOnly: mode}}); !cellserrors.Is(err, cellserrors.InvalidParameters) {
					t.Fatalf("invalid native dispatch mode accepted: %v", err)
				}
			})
		}
	})
}

func TestNativeTaskMigrationPreservesClaim(t *testing.T) {
	constructor := func(db boltdb.DB) jobstore.DAO { return bolt.NewBoltDAO(db) }
	test.RunStorageTests([]test.StorageTestCase{test.TemplateBoltWithPrefix(constructor, "native_task_migration_from_")}, t, func(fromCtx context.Context) {
		from, err := manager.Resolve[jobstore.DAO](fromCtx)
		if err != nil {
			t.Error(err)
			return
		}
		job := &jobproto.Job{ID: "migrated-job"}
		if err := from.PutJob(job); err != nil {
			t.Error(err)
			return
		}
		revision, err := protojson.Marshal(&tree.ContentRevision{VersionId: "native-version", OwnerUuid: "native-owner", Location: &tree.Node{Uuid: "native-version-location"}})
		if err != nil {
			t.Error(err)
			return
		}
		claimed := &jobproto.Task{ID: "migrated-operation", JobID: job.ID, TriggerOwner: "native-actor", Status: jobproto.TaskStatus_Finished, EndTime: 1,
			ActionsLogs: []*jobproto.ActionLog{
				{InputMessage: &jobproto.ActionMessage{OutputChain: []*jobproto.ActionOutput{{JsonBody: []byte(`{"requestDigest":"frozen-input"}`), Vars: map[string]string{jobstore.TaskCreateOnly: "true"}}}}},
				{Action: &jobproto.Action{ID: "native-version-action"}, OutputMessage: &jobproto.ActionMessage{OutputChain: []*jobproto.ActionOutput{{Success: true, JsonBody: revision, Vars: map[string]string{jobstore.NativeVersionResult: "true"}}}}},
			},
		}
		if err := from.ClaimTask(claimed); err != nil {
			t.Error(err)
			return
		}
		ordinary := &jobproto.Task{ID: "migrated-ordinary", JobID: job.ID, Status: jobproto.TaskStatus_Queued}
		if err := from.PutTask(ordinary); err != nil {
			t.Error(err)
			return
		}
		test.RunStorageTests([]test.StorageTestCase{test.TemplateBoltWithPrefix(constructor, "native_task_migration_to_")}, t, func(toCtx context.Context) {
			to, err := manager.Resolve[jobstore.DAO](toCtx)
			if err != nil {
				t.Error(err)
				return
			}
			counts, err := jobstore.Migrate(toCtx, fromCtx, toCtx, false, nil)
			if err != nil || counts["Jobs"] != 1 || counts["Tasks"] != 2 {
				t.Errorf("native migration lost existing task evidence: counts=%v err=%v", counts, err)
				return
			}
			assertUnchanged := func() bool {
				t.Helper()
				persisted, err := to.GetJob(job.ID, jobproto.TaskStatus_Any)
				if err != nil || len(persisted.GetTasks()) != 2 {
					t.Errorf("native migrated references unreadable: %v %v", persisted, err)
					return false
				}
				for _, task := range persisted.Tasks {
					expected := ordinary
					if task.ID == claimed.ID {
						expected = claimed
					}
					if !proto.Equal(task, expected) {
						t.Errorf("native migration replaced task status/input/revision: %v", task)
						return false
					}
				}
				return true
			}
			if !assertUnchanged() {
				return
			}
			if _, err := jobstore.Migrate(toCtx, fromCtx, toCtx, false, nil); !cellserrors.Is(err, cellserrors.StatusConflict) {
				t.Errorf("native migration overwrote a conflicting operation reference: %v", err)
				return
			}
			assertUnchanged()
		})
	})
}
