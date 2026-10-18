package userspace

import (
	"context"
	"errors"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/auth/claim"
	"github.com/pydio/cells/v5/common/broker"
	grpcclient "github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/proto/jobs"
	jobstore "github.com/pydio/cells/v5/scheduler/jobs"
)

type retainedDeleteClient struct {
	closedDeleteJobClient
	mode                  string
	taskWrites, jobWrites int
}

func (c *retainedDeleteClient) Invoke(ctx context.Context, method string, input, output interface{}, options ...grpc.CallOption) error {
	switch method {
	case "/jobs.JobService/PutTask":
		request := input.(*jobs.PutTaskRequest)
		if c.task == nil && request.StatusMeta[jobstore.TaskCreateOnly] != "true" {
			return errors.New("first native intent was not create-only")
		}
		if c.task != nil && request.StatusMeta[jobstore.TaskCreateOnly] == "true" {
			return errors.New("duplicate native dispatch claim")
		}
		c.task = proto.Clone(request.Task).(*jobs.Task)
		c.taskWrites++
		if (c.mode == "claim-ack-lost" && c.taskWrites == 1) || (c.mode == "reference-ack-lost" && c.taskWrites == 2) {
			return context.DeadlineExceeded
		}
		proto.Merge(output.(*jobs.PutTaskResponse), &jobs.PutTaskResponse{Task: proto.Clone(c.task).(*jobs.Task)})
		return nil
	case "/jobs.JobService/PutJob":
		c.jobWrites++
		if c.mode == "job-ack-lost" {
			return context.DeadlineExceeded
		}
		proto.Merge(output.(*jobs.PutJobResponse), &jobs.PutJobResponse{Job: input.(*jobs.PutJobRequest).Job})
		return nil
	default:
		return c.closedDeleteJobClient.Invoke(ctx, method, input, output, options...)
	}
}

type retainedDeleteBroker struct {
	broker.Broker
	owner *retainedDeleteClient
	sends int
}

func (b *retainedDeleteBroker) Publish(_ context.Context, topic string, value proto.Message, _ ...broker.PublishOption) error {
	b.sends++
	event, ok := value.(*jobs.JobTriggerEvent)
	if !ok || topic != common.TopicTimerEvent || event.RunTaskId == "" || event.RunTaskId != event.JobID || b.owner.task == nil || len(b.owner.task.ActionsLogs) != 2 {
		return errors.New("broker preceded the original persisted intent and exact task reference")
	}
	if b.owner.mode == "broker-ack-lost" {
		return context.DeadlineExceeded
	}
	return nil
}

func TestNativeDeleteCoordinatorClaimsBeforeDispatchAndNeverReplaysLostACK(t *testing.T) {
	const key = "00000000-0000-4000-8000-000000000001"
	const native = "00000000-0000-4000-8000-000000000002"
	const actor = "00000000-0000-4000-8000-000000000003"
	const external = "00000000-0000-4000-8000-000000000004"
	for _, mode := range []string{"success", "claim-ack-lost", "reference-ack-lost", "job-ack-lost", "broker-ack-lost"} {
		t.Run(mode, func(t *testing.T) {
			client := &retainedDeleteClient{mode: mode}
			grpcclient.RegisterMock(common.ServiceJobsGRPC, client)
			previous := broker.Default()
			transport := &retainedDeleteBroker{owner: client}
			broker.Register(transport)
			defer broker.Register(previous)
			ctx := claim.ToContext(context.Background(), claim.Claims{Name: "native-owner", Subject: native})
			delivery := auth.NativeDeleteDelivery{}
			delivery.BindingID, delivery.Delete.NativeJobID, delivery.MaxResponseBytes = actor, "native-delete-owner", 8192
			delivery.Delete.NativeType, delivery.Delete.AdmissionPollInterval = "job", "1ms"
			delivery.ExecutionGeneration = 1
			delivery.ExecutionDeadline = time.Now().Add(time.Minute).UTC().Format(time.RFC3339Nano)
			claims := map[string]interface{}{"tenant_id": actor, "actor_principal_id": actor, "initiating_human_principal_id": actor,
				"idempotency_key": key, "action_execution_id": key, "external_execution_id": external, "action_key": "file_storage.delete@v2"}
			input := map[string]interface{}{"nativeObjectRefs": []string{native}, "removePermanently": true}
			_, err := DeleteNodesGoverned(ctx, delivery, key, claims, input)
			if (err == nil) != (mode == "success") {
				t.Fatalf("lost original ACK boundary mismatch: %v", err)
			}
			taskWrites, jobWrites, sends := client.taskWrites, client.jobWrites, transport.sends
			retained, err := DeleteNodesGoverned(ctx, delivery, key, claims, input)
			if err != nil || retained == nil || retained.ID != key {
				t.Fatalf("same native claim not observable: %v", err)
			}
			if client.taskWrites != taskWrites || client.jobWrites != jobWrites || transport.sends != sends {
				t.Fatal("lost ACK retried native dispatch")
			}
			if retained.Status != jobs.TaskStatus_Queued {
				t.Fatal("dispatch or uncertainty invented a terminal outcome")
			}
		})
	}
}
