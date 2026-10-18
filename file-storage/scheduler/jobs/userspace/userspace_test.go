/*
 * Copyright (c) 2019-2021. Abstrium SAS <team (at) pydio.com>
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

package userspace

import (
	"context"
	"errors"
	"io"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/auth/claim"
	grpcclient "github.com/pydio/cells/v5/common/client/grpc"
	cellserrors "github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/proto/jobs"
	"github.com/pydio/cells/v5/common/proto/tree"
	jobstore "github.com/pydio/cells/v5/scheduler/jobs"

	. "github.com/smartystreets/goconvey/convey"
)

type closedDeleteJobClient struct {
	grpc.ClientConnInterface
	task   *jobs.Task
	writes int
}

func (c *closedDeleteJobClient) Invoke(_ context.Context, method string, input, output interface{}, _ ...grpc.CallOption) error {
	if method == "/jobs.JobService/GetJob" {
		request := input.(*jobs.GetJobRequest)
		proto.Merge(output.(*jobs.GetJobResponse), &jobs.GetJobResponse{Job: jobstore.NativeReadJob(request.JobID)})
		return nil
	}
	c.writes++
	return errors.New("unexpected native write")
}

func (c *closedDeleteJobClient) NewStream(_ context.Context, _ *grpc.StreamDesc, method string, _ ...grpc.CallOption) (grpc.ClientStream, error) {
	if method != "/jobs.JobService/ListTasks" {
		return nil, errors.New("unexpected native stream")
	}
	return &closedDeleteTaskStream{task: c.task}, nil
}

type closedDeleteTaskStream struct {
	grpc.ClientStream
	task *jobs.Task
}

func (s *closedDeleteTaskStream) SendMsg(interface{}) error { return nil }
func (s *closedDeleteTaskStream) CloseSend() error          { return nil }
func (s *closedDeleteTaskStream) RecvMsg(output interface{}) error {
	if s.task == nil {
		return io.EOF
	}
	proto.Merge(output.(*jobs.ListTasksResponse), &jobs.ListTasksResponse{Task: s.task})
	s.task = nil
	return nil
}

func TestManagedDeleteOnlyResolvesExistingClaim(t *testing.T) {
	const key = "00000000-0000-4000-8000-000000000001"
	ctx := claim.ToContext(context.Background(), claim.Claims{Name: "native-owner", Subject: "native-user"})
	delivery := auth.NativeDeleteDelivery{}
	delivery.BindingID, delivery.Delete.NativeJobID, delivery.MaxResponseBytes = "binding", "coordinator", 4096
	claims := map[string]interface{}{"idempotency_key": key, "action_key": "file_storage.delete@v2"}
	input := map[string]interface{}{"nativeObjectRefs": []string{"native-node"}, "removePermanently": true}
	for _, mode := range []string{"absent", "existing", "foreign"} {
		t.Run(mode, func(t *testing.T) {
			client := &closedDeleteJobClient{}
			if mode != "absent" {
				var err error
				client.task, err = jobstore.NewNativeWriteTask(delivery.BindingID, delivery.Delete.NativeJobID, key, "native-owner", "native-user", claims, input)
				if err != nil {
					t.Fatal(err)
				}
				if mode == "foreign" {
					client.task.TriggerOwner = "foreign-owner"
				}
			}
			grpcclient.RegisterMock(common.ServiceJobsGRPC, client)
			task, err := DeleteNodesGoverned(ctx, delivery, key, claims, input)
			if client.writes != 0 {
				t.Fatal("observation dispatched native work")
			}
			if mode == "existing" {
				if err != nil || task == nil || task.ID != key {
					t.Fatalf("original claim unavailable: %v", err)
				}
			} else if err == nil || task != nil {
				t.Fatal("new or foreign delete authorized")
			} else if mode == "absent" && !cellserrors.Is(err, cellserrors.StatusForbidden) {
				t.Fatal("missing delayed authority did not fail closed", err)
			}
		})
	}
}

func TestHandler_deduplication(t *testing.T) {

	Convey("Test deduplication", t, func() {

		nn := []*tree.Node{
			{Path: "/toto"},
			{Path: "/toto"},
			{Path: "/toto"},
			{Path: "/toto2"},
			{Path: "/toto3"},
			{Path: "/toto"},
		}

		n2 := DeduplicateNodes(nn)

		So(n2, ShouldHaveLength, 3)
		t.Log(n2)

	})

}
