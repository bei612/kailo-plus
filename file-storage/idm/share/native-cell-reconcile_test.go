package share

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"testing"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	grpcclient "github.com/pydio/cells/v5/common/client/grpc"
	jobproto "github.com/pydio/cells/v5/common/proto/jobs"
	jobstore "github.com/pydio/cells/v5/scheduler/jobs"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
)

type nativeCellReconcileFixture struct {
	jobproto.UnimplementedJobServiceServer
	job         *jobproto.Job
	tasks       []*jobproto.Task
	streamError bool
}

func (f nativeCellReconcileFixture) GetJob(context.Context, *jobproto.GetJobRequest) (*jobproto.GetJobResponse, error) {
	return &jobproto.GetJobResponse{Job: f.job}, nil
}
func (f nativeCellReconcileFixture) ListJobs(req *jobproto.ListJobsRequest, stream grpc.ServerStreamingServer[jobproto.ListJobsResponse]) error {
	if f.job == nil {
		return errors.New("missing job")
	}
	if len(req.JobIDs) != 1 || req.JobIDs[0] != f.job.ID || req.LoadTasks != jobproto.TaskStatus_Any {
		return errors.New("filtered enumeration")
	}
	f.job.Tasks = f.tasks
	if err := stream.Send(&jobproto.ListJobsResponse{Job: f.job}); err != nil {
		return err
	}
	if f.streamError {
		return errors.New("incomplete native stream")
	}
	return nil
}

func TestNativeCellBindingReconcileOriginalTaskStream(t *testing.T) {
	const binding = "00000000-0000-4000-8000-000000000001"
	const first = "00000000-0000-4000-8000-000000000002"
	const second = "00000000-0000-4000-8000-000000000003"
	for _, scenario := range []string{"complete", "empty", "running", "partial", "missing-receipt", "negative-ack", "missing-pair", "stream-error", "foreign-binding", "future-generation", "duplicate", "oversize", "missing-job"} {
		t.Run(scenario, func(t *testing.T) {
			d := auth.NativeCellShareDelivery{}
			d.BindingID = binding
			d.CellShare.NativeJobID = "native-cell-fixture"
			d.CellShare.BindingGeneration = 2
			d.MaxResponseBytes = 65536
			intent := nativeCellIntent{BindingID: binding, Generation: 2, NativeUserID: first, ExecutionTaskID: second, Changes: []nativeCellChange{{NodeID: first}}}
			if scenario == "foreign-binding" {
				intent.BindingID = second
			}
			if scenario == "future-generation" {
				intent.Generation = 3
			}
			body, _ := json.Marshal(intent)
			coordinator, _ := jobstore.NewNativeCellTask(d.CellShare.NativeJobID, first, "native-owner", body)
			execution, _ := jobstore.NewNativeCellTask(d.CellShare.NativeJobID, second, "native-owner", body)
			coordinator = completedNativeCellTask(coordinator, body)
			execution = completedNativeCellTask(execution, body)
			f := nativeCellReconcileFixture{job: jobstore.NativeCellJob(d.CellShare.NativeJobID, binding, 2), tasks: []*jobproto.Task{coordinator, execution}}
			f.job.Inactive = true
			switch scenario {
			case "empty":
				f.tasks = nil
			case "running":
				execution.Status = jobproto.TaskStatus_Running
			case "partial":
				execution.Status = jobproto.TaskStatus_Error
			case "missing-receipt":
				execution.ActionsLogs = execution.ActionsLogs[:1]
			case "negative-ack":
				execution.ActionsLogs[1].OutputMessage.OutputChain[0].Success = false
			case "missing-pair":
				f.tasks = f.tasks[:1]
			case "stream-error":
				f.streamError = true
			case "duplicate":
				f.tasks = append(f.tasks, execution)
			case "oversize":
				d.MaxResponseBytes = 1
			case "missing-job":
				f.job = nil
			}
			listener := bufconn.Listen(65536)
			server := grpc.NewServer()
			jobproto.RegisterJobServiceServer(server, f)
			go server.Serve(listener)
			t.Cleanup(server.Stop)
			t.Cleanup(func() { _ = listener.Close() })
			connection, err := grpc.NewClient("passthrough:///native-cell-reconcile", grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) { return listener.Dial() }))
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = connection.Close() })
			grpcclient.RegisterMock(common.ServiceJobsGRPC, connection)
			items, err := ReconcileNativeCells(context.Background(), d, true)
			switch scenario {
			case "stream-error", "foreign-binding", "future-generation", "duplicate", "oversize", "missing-job":
				if err == nil {
					t.Fatal("unproven complete listing accepted")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if len(items) != len(f.tasks) {
				t.Fatal("native work omitted")
			}
			for _, item := range items {
				want := "UNKNOWN"
				if scenario == "complete" {
					want = "SUCCEEDED"
				}
				if item["platformStatus"] != want {
					t.Fatalf("native terminal %v != %s", item, want)
				}
			}
		})
	}
}
