//go:build storage || sql

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

package sql

import (
	"context"
	"errors"
	"testing"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/anypb"
	"gorm.io/gorm"

	cellserrors "github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/proto/idm"
	service "github.com/pydio/cells/v5/common/proto/service"
	"github.com/pydio/cells/v5/common/runtime/manager"
	"github.com/pydio/cells/v5/common/storage/test"
	"github.com/pydio/cells/v5/idm/workspace"

	. "github.com/smartystreets/goconvey/convey"
)

var (
	testcases = test.TemplateSQL(NewDAO)
)

func TestWorkspaceUpdateExistingIsAtomic(t *testing.T) {
	test.RunStorageTests(testcases, t, func(ctx context.Context) {
		resolved, err := manager.Resolve[workspace.DAO](ctx)
		if err != nil {
			t.Fatal(err)
		}
		dao := resolved.(*sqlimpl)
		original := &idm.Workspace{UUID: "existing-workspace", Label: "Original", Slug: "existing-workspace", Scope: idm.WorkspaceScope_ROOM}
		if _, err := dao.Add(ctx, original); err != nil {
			t.Fatal(err)
		}
		original.Policies, err = dao.AddPolicies(ctx, false, original.UUID, []*service.ResourcePolicy{{Action: service.ResourcePolicyAction_OWNER, Subject: "original-owner"}})
		if err != nil || len(original.Policies) != 1 || original.Policies[0].Id == 0 {
			t.Fatalf("persisted policies missing from native acknowledgement: policies=%v error=%v", original.Policies, err)
		}
		request := proto.Clone(original).(*idm.Workspace)
		request.Label = "Updated"
		request.Policies[0].Subject = "updated-owner"
		updated, err := dao.UpdateExisting(ctx, request)
		if err != nil || updated.GetLabel() != request.Label || len(updated.GetPolicies()) != 1 || updated.Policies[0].Subject != "updated-owner" || updated.Policies[0].Id == 0 {
			t.Fatalf("existing update has no complete native acknowledgement: %v %v", updated, err)
		}
		var persisted idm.Workspace
		if err := dao.Session(ctx).First(&persisted, "uuid = ?", original.UUID).Error; err != nil || persisted.Label != "Updated" {
			t.Fatalf("workspace was not updated: %v %v", persisted.Label, err)
		}
		var policies []*service.ResourcePolicy
		if err := dao.Session(ctx).Where("resource = ?", original.UUID).Find(&policies).Error; err != nil || len(policies) != 1 || policies[0].Subject != "updated-owner" {
			t.Fatalf("policies were not replaced: %v %v", policies, err)
		}
		unchanged, err := dao.UpdateExisting(ctx, updated)
		if err != nil || unchanged.GetLabel() != updated.Label || len(unchanged.GetPolicies()) != 1 {
			t.Fatalf("unchanged existing workspace was refused: %v %v", unchanged, err)
		}

		policyFailure := errors.New("native policy write interrupted")
		hook := "workspace-update-policy-failure"
		if err := dao.DB.Callback().Create().Before("gorm:create").Register(hook, func(tx *gorm.DB) {
			if _, ok := tx.Statement.Dest.(*service.ResourcePolicy); ok {
				tx.AddError(policyFailure)
			}
		}); err != nil {
			t.Fatal(err)
		}
		request.Label = "Must roll back"
		request.Policies[0].Subject = "must-not-persist"
		failed, err := dao.UpdateExisting(ctx, request)
		if er := dao.DB.Callback().Create().Remove(hook); er != nil {
			t.Fatal(er)
		}
		if !errors.Is(err, policyFailure) || failed != nil {
			t.Errorf("policy failure became a workspace acknowledgement: %v %v", failed, err)
		}
		persisted = idm.Workspace{}
		policies = nil
		if err := dao.Session(ctx).First(&persisted, "uuid = ?", original.UUID).Error; err != nil || persisted.Label != "Updated" {
			t.Errorf("workspace update escaped rollback: %v %v", persisted.Label, err)
		}
		if err := dao.Session(ctx).Where("resource = ?", original.UUID).Find(&policies).Error; err != nil || len(policies) != 1 || policies[0].Subject != "updated-owner" {
			t.Errorf("policy replacement escaped rollback: %v %v", policies, err)
		}
		request.Label = "Updated"
		request.Policies = nil
		cleared, err := dao.UpdateExisting(ctx, request)
		if err != nil || cleared == nil || len(cleared.Policies) != 0 {
			t.Fatalf("empty replacement was not acknowledged: %v %v", cleared, err)
		}
		policies = nil
		if err := dao.Session(ctx).Where("resource = ?", original.UUID).Find(&policies).Error; err != nil || len(policies) != 0 {
			t.Fatalf("revoked policies remain persisted: %v %v", policies, err)
		}

		// Simulate the real order: caller read the workspace, another request
		// deleted it, and the caller now submits its previously read object.
		if err := dao.Session(ctx).Where("uuid = ?", original.UUID).Delete(&idm.Workspace{}).Error; err != nil {
			t.Fatal(err)
		}
		if err := dao.DeletePoliciesForResource(ctx, original.UUID); err != nil {
			t.Fatal(err)
		}
		missing, err := dao.UpdateExisting(ctx, request)
		if !errors.Is(err, cellserrors.WorkspaceNotFound) || missing != nil {
			t.Errorf("deleted workspace was not rejected: %v %v", missing, err)
		}
		var workspaceCount, policyCount int64
		if err := dao.Session(ctx).Model(&idm.Workspace{}).Where("uuid = ?", original.UUID).Count(&workspaceCount).Error; err != nil {
			t.Fatal(err)
		}
		if err := dao.Session(ctx).Model(&service.ResourcePolicy{}).Where("resource = ?", original.UUID).Count(&policyCount).Error; err != nil {
			t.Fatal(err)
		}
		if workspaceCount != 0 || policyCount != 0 {
			t.Errorf("deleted workspace resurrected: workspaces=%d policies=%d", workspaceCount, policyCount)
		}
	})
}

func TestUniqueSlug(t *testing.T) {

	test.RunStorageTests(testcases, t, func(ctx context.Context) {
		mockDAO, err := manager.Resolve[workspace.DAO](ctx)
		if err != nil {
			panic(err)
		}

		Convey("Test Unique Slug", t, func() {

			ws := &idm.Workspace{
				UUID:        "id1",
				Slug:        "my-slug",
				Label:       "label",
				Description: "description",
				Attributes:  "",
				Scope:       0,
			}

			update, err := mockDAO.Add(ctx, ws)
			So(update, ShouldBeFalse)
			So(err, ShouldBeNil)

			ws.Description = "description updated"
			update, err = mockDAO.Add(ctx, ws)
			So(update, ShouldBeTrue)
			So(err, ShouldBeNil)

			ws2 := &idm.Workspace{
				UUID:        "id2",
				Slug:        "my-slug",
				Label:       "label",
				Description: "description 2",
				Attributes:  "",
				Scope:       0,
			}

			update, err = mockDAO.Add(ctx, ws2)
			So(update, ShouldBeFalse)
			So(err, ShouldBeNil)
			So(ws2.Slug, ShouldEqual, "my-slug-1")

			ws3 := &idm.Workspace{
				UUID:        "id3",
				Slug:        "my-slug",
				Label:       "label",
				Description: "description 3",
				Attributes:  "",
				Scope:       0,
			}

			update, err = mockDAO.Add(ctx, ws3)
			So(update, ShouldBeFalse)
			So(err, ShouldBeNil)
			So(ws3.Slug, ShouldEqual, "my-slug-2")

			// Test Update
			ws3.Label = "label updated"
			ws3.Attributes = "JSON-ATTRIBUTES"
			ws3.Description = "description updated"
			update, err = mockDAO.Add(ctx, ws3)
			So(update, ShouldBeTrue)
			So(err, ShouldBeNil)
			So(ws3.Slug, ShouldEqual, "my-slug-2")

			q, _ := anypb.New(&idm.WorkspaceSingleQuery{
				Uuid: "id2",
			})
			workspaces := new([]interface{})
			er := mockDAO.Search(ctx, &service.Query{
				SubQueries: []*anypb.Any{q},
			}, workspaces)
			So(er, ShouldBeNil)
			So(workspaces, ShouldHaveLength, 1)
			for _, w := range *workspaces {
				result := w.(*idm.Workspace)
				So(result.UUID, ShouldEqual, "id2")
				So(result.Label, ShouldEqual, "label")
				So(result.Slug, ShouldEqual, "my-slug-1")
			}

			q, _ = anypb.New(&idm.WorkspaceSingleQuery{
				Uuid: "id3",
			})
			workspaces = new([]interface{})
			er = mockDAO.Search(ctx, &service.Query{
				SubQueries: []*anypb.Any{q},
			}, workspaces)
			So(er, ShouldBeNil)
			So(workspaces, ShouldHaveLength, 1)
			for _, w := range *workspaces {
				result := w.(*idm.Workspace)
				So(result.UUID, ShouldEqual, "id3")
				So(result.Label, ShouldEqual, "label updated")
				So(result.Attributes, ShouldEqual, "JSON-ATTRIBUTES")
				So(result.Description, ShouldEqual, "description updated")
				So(result.Slug, ShouldEqual, "my-slug-2")
			}
		})
	})
}

func TestSearch(t *testing.T) {

	test.RunStorageTests(testcases, t, func(ctx context.Context) {
		mockDAO, err := manager.Resolve[workspace.DAO](ctx)
		if err != nil {
			panic(err)
		}

		Convey("Query Builder", t, func() {

			workspaces := []*idm.Workspace{
				&idm.Workspace{
					UUID:        "ws1",
					Slug:        "admin-files",
					Label:       "Admin Files",
					Attributes:  "{}",
					Description: "Reserved for admin",
					Scope:       idm.WorkspaceScope_ADMIN,
				},

				&idm.Workspace{
					UUID:        "ws2",
					Slug:        "common",
					Label:       "Common",
					Attributes:  "{}",
					Description: "Shared files",
					Scope:       idm.WorkspaceScope_ROOM,
				},

				&idm.Workspace{
					UUID:        "ws3",
					Slug:        "admins-share",
					Label:       "Admin shared files",
					Attributes:  "{}",
					Description: "Shared files for admin ",
					Scope:       idm.WorkspaceScope_ADMIN,
				},

				&idm.Workspace{
					UUID:        "ws4",
					Slug:        "public",
					Label:       "Public",
					Attributes:  "{}",
					Description: "Public access files",
					Scope:       idm.WorkspaceScope_ANY,
				},
			}

			for _, ws := range workspaces {
				_, err := mockDAO.Add(ctx, ws)
				So(err, ShouldBeNil)
			}

			// Asked for worspace - with ROOM Scope
			singleq := new(idm.WorkspaceSingleQuery)
			singleq.Scope = idm.WorkspaceScope_ROOM
			a, err := anypb.New(singleq)
			So(err, ShouldBeNil)

			composedQuery := &service.Query{
				SubQueries: []*anypb.Any{a},
				Offset:     0,
				Limit:      10,
				Operation:  service.OperationType_AND,
			}

			var result []interface{}
			wdao := mockDAO.(*sqlimpl)
			err = wdao.Search(ctx, composedQuery, &result)
			So(err, ShouldBeNil)
			So(len(result), ShouldBeGreaterThan, 0)

			for _, wsi := range result {
				if ws, ok := wsi.(*idm.Workspace); ok {
					So(ws.Slug, ShouldBeIn, []string{"common"})
				}
			}

			result = []interface{}{}
			err = mockDAO.Search(ctx, composedQuery, &result)
			So(err, ShouldBeNil)
			So(len(result), ShouldBeGreaterThan, 0)
			for _, wsi := range result {
				if ws, ok := wsi.(*idm.Workspace); ok {
					So(ws.Slug, ShouldBeIn, []string{"common"})
				}
			}

			// Get any workspaces that relates to admins
			singleq.Scope = idm.WorkspaceScope_ADMIN
			singleq.Label = "*admin*"

			a, err = anypb.New(singleq)
			So(err, ShouldBeNil)
			composedQuery.SubQueries = []*anypb.Any{a}

			result = []interface{}{}
			err = wdao.Search(ctx, composedQuery, &result)
			So(err, ShouldBeNil)
			So(len(result), ShouldBeGreaterThan, 0)
			for _, wsi := range result {
				if ws, ok := wsi.(*idm.Workspace); ok {
					So(ws.Slug, ShouldBeIn, []string{"admin-files", "admins-share"})
				}
			}

			result = []interface{}{}
			err = mockDAO.Search(ctx, composedQuery, &result)
			So(err, ShouldBeNil)
			So(len(result), ShouldBeGreaterThan, 0)
			for _, wsi := range result {
				if ws, ok := wsi.(*idm.Workspace); ok {
					So(ws.Slug, ShouldBeIn, []string{"admin-files", "admins-share"})
				}
			}
		})
	})
}
