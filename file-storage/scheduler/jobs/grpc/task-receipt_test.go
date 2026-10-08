package grpc

import (
	"context"
	"errors"
	"io"
	"testing"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/broker"
	cellserrors "github.com/pydio/cells/v5/common/errors"
	jobproto "github.com/pydio/cells/v5/common/proto/jobs"
	"github.com/pydio/cells/v5/common/runtime/manager"
	"github.com/pydio/cells/v5/common/storage/boltdb"
	"github.com/pydio/cells/v5/common/storage/test"
	jobstore "github.com/pydio/cells/v5/scheduler/jobs"
	"github.com/pydio/cells/v5/scheduler/jobs/dao/bolt"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
)

type taskReceiptStore struct {
	jobstore.DAO
	failure     *error
	loadFailure *error
}

func (s *taskReceiptStore) PutTask(task *jobproto.Task) error {
	if *s.failure != nil {
		return *s.failure
	}
	return s.DAO.PutTask(task)
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
			request := &jobproto.PutTaskRequest{Task: &jobproto.Task{ID: "native-task", JobID: job.ID}}
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
