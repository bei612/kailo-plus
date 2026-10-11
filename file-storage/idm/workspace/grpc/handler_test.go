//go:build storage || sql

package grpc

import (
	"context"
	"errors"
	"testing"

	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"

	"github.com/pydio/cells/v5/common/broker"
	cellserrors "github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/proto/idm"
	"github.com/pydio/cells/v5/common/proto/service"
	storagetest "github.com/pydio/cells/v5/common/storage/test"
	"github.com/pydio/cells/v5/idm/workspace"
	workspacesql "github.com/pydio/cells/v5/idm/workspace/dao/sql"
)

type workspaceWriteResult struct {
	addError, policyError error
	policyCalls           int
}

type workspaceWriteDAO struct {
	workspace.DAO
	result *workspaceWriteResult
}

func (d *workspaceWriteDAO) Add(ctx context.Context, value interface{}) (bool, error) {
	if d.result.addError != nil {
		return false, d.result.addError
	}
	return d.DAO.Add(ctx, value)
}

func (d *workspaceWriteDAO) AddPolicies(ctx context.Context, update bool, id string, policies []*service.ResourcePolicy) ([]*service.ResourcePolicy, error) {
	d.result.policyCalls++
	if d.result.policyError != nil {
		return nil, d.result.policyError
	}
	return d.DAO.AddPolicies(ctx, update, id, policies)
}

type workspaceWriteBroker struct {
	broker.Broker
	events []*idm.ChangeEvent
}

func (b *workspaceWriteBroker) Publish(_ context.Context, _ string, message proto.Message, _ ...broker.PublishOption) error {
	if event, ok := message.(*idm.ChangeEvent); ok {
		b.events = append(b.events, proto.Clone(event).(*idm.ChangeEvent))
	}
	return nil
}

func TestCreateWorkspacePreservesWriteFailure(t *testing.T) {
	state := &workspaceWriteResult{}
	cases := storagetest.TemplateSQL(func(db *gorm.DB) workspace.DAO {
		return &workspaceWriteDAO{DAO: workspacesql.NewDAO(db), result: state}
	})
	storagetest.RunStorageTests(cases, t, func(ctx context.Context) {
		original := broker.Default()
		events := &workspaceWriteBroker{Broker: original}
		broker.Register(events)
		defer broker.Register(original)
		handler := NewHandler()
		newRequest := func() *idm.CreateWorkspaceRequest {
			return &idm.CreateWorkspaceRequest{Workspace: &idm.Workspace{
				UUID: "workspace-write-fixture", Label: "Workspace write fixture", Scope: idm.WorkspaceScope_ROOM,
				Policies: []*service.ResourcePolicy{{Action: service.ResourcePolicyAction_OWNER, Subject: "fixture-owner"}},
			}}
		}
		for _, failure := range []error{context.Canceled, context.DeadlineExceeded, errors.New("workspace persistence failed")} {
			for _, withPolicies := range []bool{false, true} {
				*state = workspaceWriteResult{addError: failure}
				events.events = nil
				request := newRequest()
				if !withPolicies {
					request.Workspace.Policies = nil
				}
				response, err := handler.CreateWorkspace(ctx, request)
				if !errors.Is(err, failure) || response != nil || state.policyCalls != 0 || len(events.events) != 0 {
					t.Errorf("Add failure %v, policies=%v: response=%v error=%v policy calls=%d events=%d", failure, withPolicies, response, err, state.policyCalls, len(events.events))
				}
			}
		}
		*state = workspaceWriteResult{}
		events.events = nil
		for _, eventType := range []idm.ChangeEventType{idm.ChangeEventType_CREATE, idm.ChangeEventType_UPDATE} {
			response, err := handler.CreateWorkspace(ctx, newRequest())
			if err != nil || response.GetWorkspace().GetUUID() != "workspace-write-fixture" || len(events.events) != 1 || events.events[0].Type != eventType {
				t.Errorf("successful %v: response=%v error=%v events=%v", eventType, response, err, events.events)
			}
			events.events = nil
		}
		policyFailure := errors.New("workspace policy persistence failed")
		*state = workspaceWriteResult{policyError: policyFailure}
		response, err := handler.CreateWorkspace(ctx, newRequest())
		if !errors.Is(err, policyFailure) || response != nil || state.policyCalls != 1 || len(events.events) != 0 {
			t.Errorf("policy failure: response=%v error=%v policy calls=%d events=%d", response, err, state.policyCalls, len(events.events))
		}
	})
}

func TestUpdateWorkspaceNeverCreatesMissingWorkspace(t *testing.T) {
	cases := storagetest.TemplateSQL(workspacesql.NewDAO)
	storagetest.RunStorageTests(cases, t, func(ctx context.Context) {
		original := broker.Default()
		events := &workspaceWriteBroker{Broker: original}
		broker.Register(events)
		defer broker.Register(original)
		handler := NewHandler()
		request := &idm.CreateWorkspaceRequest{Workspace: &idm.Workspace{UUID: "update-only-workspace", Label: "Original", Scope: idm.WorkspaceScope_ROOM,
			Policies: []*service.ResourcePolicy{{Action: service.ResourcePolicyAction_OWNER, Subject: "native-owner"}},
		}}
		response, err := handler.UpdateWorkspace(ctx, request)
		if !errors.Is(err, cellserrors.WorkspaceNotFound) || response != nil || len(events.events) != 0 {
			t.Fatalf("missing workspace produced write or event: response=%v error=%v events=%v", response, err, events.events)
		}
		if _, err := handler.CreateWorkspace(ctx, request); err != nil {
			t.Fatal(err)
		}
		events.events = nil
		request.Workspace.Label = "Updated"
		response, err = handler.UpdateWorkspace(ctx, request)
		if err != nil || response.GetWorkspace().GetLabel() != "Updated" || len(response.GetWorkspace().GetPolicies()) != 1 || len(events.events) != 1 || events.events[0].Type != idm.ChangeEventType_UPDATE {
			t.Fatalf("existing update missing original ACK/event: response=%v error=%v events=%v", response, err, events.events)
		}
		events.events = nil
		response, err = handler.UpdateWorkspace(ctx, &idm.CreateWorkspaceRequest{})
		if !errors.Is(err, cellserrors.InvalidParameters) || response != nil || len(events.events) != 0 {
			t.Fatalf("empty workspace accepted: response=%v error=%v events=%v", response, err, events.events)
		}
	})
}
