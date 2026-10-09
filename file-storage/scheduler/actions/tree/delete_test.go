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

package tree

import (
	"context"
	"io"
	"testing"

	"google.golang.org/grpc"

	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/nodes"
	"github.com/pydio/cells/v5/common/proto/jobs"
	"github.com/pydio/cells/v5/common/proto/object"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/scheduler/actions"

	. "github.com/smartystreets/goconvey/convey"
)

func TestDeleteAction_GetName(t *testing.T) {
	Convey("Test GetName", t, func() {
		metaAction := &DeleteAction{}
		So(metaAction.GetName(), ShouldEqual, deleteActionName)
	})
}

func TestDeleteAction_Init(t *testing.T) {
	Convey("", t, func() {
		action := &DeleteAction{}
		job := &jobs.Job{Owner: "owner"}
		action.Init(nil, job, &jobs.Action{})
	})
}

func TestDeleteAction_Run(t *testing.T) {

	Convey("", t, func() {

		action := &DeleteAction{}
		job := &jobs.Job{}
		action.Init(nil, job, &jobs.Action{})
		mock := &nativeDeleteHandler{
			HandlerMock: &nodes.HandlerMock{Nodes: map[string]*tree.Node{"/test": {Path: "/test", Type: tree.NodeType_LEAF}}},
		}
		action.PresetHandler(mock)
		status := make(chan string)
		progress := make(chan float32)

		ignored, err := action.Run(global, &actions.RunnableChannels{StatusMsg: status, Progress: progress}, &jobs.ActionMessage{
			Nodes: []*tree.Node{},
		})
		So(ignored.GetLastOutput().Ignored, ShouldBeTrue)

		output, err := action.Run(global, &actions.RunnableChannels{StatusMsg: status, Progress: progress}, &jobs.ActionMessage{
			Nodes: []*tree.Node{{
				Path: "/test",
			}},
		})
		close(status)
		close(progress)

		So(err, ShouldBeNil)
		So(output.Nodes, ShouldHaveLength, 0)

		So(mock.Nodes, ShouldHaveLength, 1)
		So(mock.Nodes["in"], ShouldResemble, &tree.Node{
			Path: "/test",
			Type: tree.NodeType_LEAF,
		})

	})
}

// The original HandlerMock intentionally returns a nil DeleteNode response.
// An original task can complete only with the actual producer's success ACK.
type nativeDeleteHandler struct {
	*nodes.HandlerMock
	root       *tree.Node
	readErr    error
	stream     tree.NodeProvider_ListNodesClient
	listErr    error
	flat       bool
	responses  map[string]*tree.DeleteNodeResponse
	deleteErrs map[string]error
	deleted    chan string
}

func (h *nativeDeleteHandler) ReadNode(ctx context.Context, request *tree.ReadNodeRequest, options ...grpc.CallOption) (*tree.ReadNodeResponse, error) {
	if h.HandlerMock.Nodes != nil {
		return h.HandlerMock.ReadNode(ctx, request, options...)
	}
	return &tree.ReadNodeResponse{Node: h.root}, h.readErr
}

func (h *nativeDeleteHandler) ListNodes(context.Context, *tree.ListNodesRequest, ...grpc.CallOption) (tree.NodeProvider_ListNodesClient, error) {
	return h.stream, h.listErr
}

func (h *nativeDeleteHandler) DeleteNode(ctx context.Context, request *tree.DeleteNodeRequest, options ...grpc.CallOption) (*tree.DeleteNodeResponse, error) {
	if h.HandlerMock.Nodes != nil {
		_, err := h.HandlerMock.DeleteNode(ctx, request, options...)
		return &tree.DeleteNodeResponse{Success: err == nil}, err
	}
	h.deleted <- request.Node.Path
	return h.responses[request.Node.Path], h.deleteErrs[request.Node.Path]
}

func (h *nativeDeleteHandler) WrapCallback(provider nodes.CallbackFunc) error {
	return provider(nil, nil)
}
func (h *nativeDeleteHandler) BranchInfoForNode(context.Context, *tree.Node) (nodes.BranchInfo, error) {
	return nodes.BranchInfo{LoadedSource: nodes.LoadedSource{DataSource: &object.DataSource{FlatStorage: h.flat}}}, nil
}
func (h *nativeDeleteHandler) CanApply(_ context.Context, event *tree.NodeChangeEvent) (*tree.NodeChangeEvent, error) {
	return event, nil
}
func (h *nativeDeleteHandler) GetClientsPool(context.Context) nodes.SourcesPool { return nil }

type nativeDeleteStream struct {
	tree.NodeProvider_ListNodesClient
	nodes []*tree.Node
	err   error
	index int
}

func (s *nativeDeleteStream) Recv() (*tree.ListNodesResponse, error) {
	if s.index < len(s.nodes) {
		node := s.nodes[s.index]
		s.index++
		return &tree.ListNodesResponse{Node: node}, nil
	}
	if s.err != nil {
		return nil, s.err
	}
	return nil, io.EOF
}

func TestDeleteAction_NativeAcknowledgement(t *testing.T) {
	leaf := &tree.Node{Uuid: "native-leaf", Path: "/native/file", Type: tree.NodeType_LEAF}
	folder := &tree.Node{Uuid: "native-folder", Path: "/native", Type: tree.NodeType_COLLECTION}
	firstFolder := &tree.Node{Uuid: "native-child-folder", Path: "/native/child", Type: tree.NodeType_COLLECTION}
	second := &tree.Node{Uuid: "native-second", Path: "/native/other", Type: tree.NodeType_LEAF}
	cases := []struct {
		name       string
		root       *tree.Node
		readErr    error
		listErr    error
		stream     *nativeDeleteStream
		noStream   bool
		responses  map[string]*tree.DeleteNodeResponse
		deleteErrs map[string]error
		flat       bool
		parameters map[string]string
		cancel     bool
		wantErr    error
		wantErrs   []error
		wantIgnore bool
		wantCalls  int
	}{
		{name: "leaf-confirmed", root: leaf, responses: map[string]*tree.DeleteNodeResponse{leaf.Path: {Success: true}}, wantCalls: 1},
		{name: "leaf-nil-ack", root: leaf, wantErr: errors.StatusInternalServerError, wantCalls: 1},
		{name: "leaf-negative-ack", root: leaf, responses: map[string]*tree.DeleteNodeResponse{leaf.Path: {}}, wantErr: errors.StatusInternalServerError, wantCalls: 1},
		{name: "leaf-unknown-result", root: leaf, deleteErrs: map[string]error{leaf.Path: context.DeadlineExceeded}, wantErr: context.DeadlineExceeded, wantCalls: 1},
		{name: "read-empty", wantErr: errors.StatusInternalServerError},
		{name: "ignore-confirmed-missing", readErr: errors.NodeNotFound, parameters: map[string]string{"ignoreNonExisting": "true"}, wantIgnore: true},
		{name: "ignore-confirmed-object-missing", readErr: errors.ObjectNotFound, parameters: map[string]string{"ignoreNonExisting": "true"}, wantIgnore: true},
		{name: "ignore-does-not-hide-revocation", readErr: errors.StatusForbidden, parameters: map[string]string{"ignoreNonExisting": "true"}, wantErr: errors.StatusForbidden},
		{name: "ignore-does-not-hide-timeout", readErr: context.DeadlineExceeded, parameters: map[string]string{"ignoreNonExisting": "true"}, wantErr: context.DeadlineExceeded},
		{name: "ignore-does-not-hide-missing-scope", readErr: errors.WorkspaceNotFound, parameters: map[string]string{"ignoreNonExisting": "true"}, wantErr: errors.WorkspaceNotFound},
		{name: "missing-without-ignore", readErr: errors.NodeNotFound, wantErr: errors.NodeNotFound},
		{name: "list-failed-before-stream", root: folder, listErr: errors.StatusForbidden, wantErr: errors.StatusForbidden},
		{name: "list-missing-stream", root: folder, noStream: true, wantErr: errors.StatusInternalServerError},
		{name: "list-empty-confirmed", root: folder},
		{name: "list-interrupted-empty", root: folder, stream: &nativeDeleteStream{err: context.DeadlineExceeded}, wantErr: context.DeadlineExceeded},
		{name: "list-invalid-node", root: folder, stream: &nativeDeleteStream{nodes: []*tree.Node{nil}}, wantErr: errors.StatusInternalServerError},
		{name: "list-interrupted-after-side-effect", root: folder, stream: &nativeDeleteStream{nodes: []*tree.Node{leaf}, err: context.DeadlineExceeded}, responses: map[string]*tree.DeleteNodeResponse{leaf.Path: {Success: true}}, wantErr: context.DeadlineExceeded, wantCalls: 1, flat: true},
		{name: "recursive-confirmed", root: folder, stream: &nativeDeleteStream{nodes: []*tree.Node{leaf, second}}, responses: map[string]*tree.DeleteNodeResponse{leaf.Path: {Success: true}, second.Path: {Success: true}}, wantCalls: 2},
		{name: "recursive-negative-ack", root: folder, stream: &nativeDeleteStream{nodes: []*tree.Node{leaf, second}}, responses: map[string]*tree.DeleteNodeResponse{leaf.Path: {}, second.Path: {Success: true}}, wantErr: errors.StatusInternalServerError, wantCalls: 2, flat: true},
		{name: "recursive-multiple-errors", root: folder, stream: &nativeDeleteStream{nodes: []*tree.Node{leaf, second}}, deleteErrs: map[string]error{leaf.Path: context.DeadlineExceeded, second.Path: errors.StatusForbidden}, wantErrs: []error{context.DeadlineExceeded, errors.StatusForbidden}, wantCalls: 2},
		{name: "parent-negative-ack", root: folder, flat: true, responses: map[string]*tree.DeleteNodeResponse{folder.Path: {}}, wantErr: errors.StatusInternalServerError, wantCalls: 1},
		{name: "parent-confirmed", root: folder, flat: true, responses: map[string]*tree.DeleteNodeResponse{folder.Path: {Success: true}}, wantCalls: 1},
		{name: "children-only-negative-ack", root: folder, flat: true, parameters: map[string]string{"childrenOnly": "true"}, stream: &nativeDeleteStream{nodes: []*tree.Node{firstFolder}}, responses: map[string]*tree.DeleteNodeResponse{firstFolder.Path: {}}, wantErr: errors.StatusInternalServerError, wantCalls: 1},
		{name: "children-only-confirmed", root: folder, flat: true, parameters: map[string]string{"childrenOnly": "true"}, stream: &nativeDeleteStream{nodes: []*tree.Node{firstFolder}}, responses: map[string]*tree.DeleteNodeResponse{firstFolder.Path: {Success: true}}, wantCalls: 1},
		{name: "canceled-before-status", root: folder, stream: &nativeDeleteStream{nodes: []*tree.Node{leaf}}, cancel: true, wantErr: context.Canceled},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(global)
			defer cancel()
			handler := &nativeDeleteHandler{HandlerMock: &nodes.HandlerMock{}, root: test.root, readErr: test.readErr,
				flat: test.flat, listErr: test.listErr, responses: test.responses, deleteErrs: test.deleteErrs,
				deleted: make(chan string, 4)}
			if !test.noStream {
				if test.stream == nil {
					test.stream = &nativeDeleteStream{}
				}
				handler.stream = test.stream
			}
			status := make(chan string, 4)
			if test.cancel {
				cancel()
				status = make(chan string)
			}
			action := &DeleteAction{}
			if err := action.Init(ctx, &jobs.Job{}, &jobs.Action{Parameters: test.parameters}); err != nil {
				t.Fatal(err)
			}
			action.PresetHandler(handler)
			output, err := action.Run(ctx, &actions.RunnableChannels{StatusMsg: status}, &jobs.ActionMessage{Nodes: []*tree.Node{{Path: "/native"}}})
			if test.wantErr != nil || len(test.wantErrs) > 0 {
				matched := test.wantErr != nil && errors.Is(err, test.wantErr)
				for _, candidate := range test.wantErrs {
					matched = matched || errors.Is(err, candidate)
				}
				if !matched || output.GetLastOutput().Success {
					t.Fatalf("missing/incomplete native evidence was accepted: error=%v output=%v", err, output.GetLastOutput())
				}
			} else if err != nil || output.GetLastOutput().Ignored != test.wantIgnore || (!test.wantIgnore && !output.GetLastOutput().Success) {
				t.Fatalf("confirmed original result mismatch: error=%v output=%v", err, output.GetLastOutput())
			}
			if len(handler.deleted) != test.wantCalls {
				t.Fatalf("original delete dispatches=%d, want %d", len(handler.deleted), test.wantCalls)
			}
		})
	}
}
