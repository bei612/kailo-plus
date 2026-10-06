/*
 * Copyright (c) 2026. Abstrium SAS <team (at) pydio.com>
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

package wopi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gorilla/mux"
	"github.com/pydio/cells/v5/common"
	auth2 "github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/auth/protocol"
	clientgrpc "github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/nodes"
	"github.com/pydio/cells/v5/common/proto/idm"
	"github.com/pydio/cells/v5/common/proto/tree"
	json "github.com/pydio/cells/v5/common/utils/jsonx"
	"google.golang.org/grpc"

	. "github.com/smartystreets/goconvey/convey"
)

type onlyOfficeFileInfoFixture struct {
	nodes.Client
	grpc.ClientConnInterface
	node *tree.Node
}

func (f *onlyOfficeFileInfoFixture) ReadNode(_ context.Context, _ *tree.ReadNodeRequest, _ ...grpc.CallOption) (*tree.ReadNodeResponse, error) {
	return &tree.ReadNodeResponse{Node: f.node}, nil
}

func (f *onlyOfficeFileInfoFixture) Invoke(_ context.Context, method string, request any, response any, _ ...grpc.CallOption) error {
	if method != "/tree.NodeVersioner/HeadVersion" || request.(*tree.HeadVersionRequest).VersionId != "original-version" {
		panic("unexpected native revision query")
	}
	response.(*tree.HeadVersionResponse).Version = &tree.ContentRevision{VersionId: "original-version", Size: 7, MTime: 1768477881}
	return nil
}

func TestOnlyOfficeFileInfoProjectsFreshSession(t *testing.T) {
	nodeID := "00000000-0000-4000-8000-000000000001"
	fixture := &onlyOfficeFileInfoFixture{node: &tree.Node{Uuid: nodeID, Path: "/documents/report.docx", Size: 99,
		MetaStore: map[string]string{common.MetaNamespaceNodeName: `"report.docx"`}}}
	originalClient := client
	client = fixture
	t.Cleanup(func() { client = originalClient })
	clientgrpc.RegisterMock(common.ServiceVersionsGRPC, fixture)
	for _, mode := range []string{"VIEW", "EDIT"} {
		t.Run(mode, func(t *testing.T) {
			ctx := config.WithStubStore(context.Background())
			ctx = auth2.WithImpersonate(ctx, &idm.User{Uuid: "native-human", Login: "original-native-human"})
			ctx = context.WithValue(ctx, protocolFactsKey{}, &protocol.Facts{PlatformHumanID: "platform-human", DisplayName: "Original Human",
				AdmittedMode: mode, BaseRevision: "original-version", ExportAllowed: false, PostMessageOrigin: "https://platform.example"})
			request := mux.SetURLVars(httptest.NewRequest(http.MethodGet, "/wopi/files/"+nodeID, nil).WithContext(ctx), map[string]string{"uuid": nodeID})
			response := httptest.NewRecorder()
			getNodeInfos(response, request)
			if response.Code != http.StatusOK {
				t.Fatalf("actual CheckFileInfo consumer failed: %d", response.Code)
			}
			var info FileInfo
			if err := json.Unmarshal(response.Body.Bytes(), &info); err != nil {
				t.Fatal(err)
			}
			if info.PostMessageOrigin != "https://platform.example" || !info.EditNotificationPostMessage || !info.ClosePostMessage ||
				!info.DisableCopy || !info.DisableExport || !info.DisablePrint || !info.HideExportOption || !info.HidePrintOption ||
				info.Version != "original-version" || info.Size != 7 || info.UserId != "platform-human" || info.UserCanWrite != (mode == "EDIT") {
				t.Fatalf("fresh original Session projection was lost: %+v", info)
			}
		})
	}
}

func TestFileInfo(t *testing.T) {
	Convey("TestFileInfo", t, func() {
		builder := GetFileInfoResponseBuilder()
		ctx := context.Background()
		ctx = config.WithStubStore(ctx)
		ctx = auth2.WithImpersonate(ctx, &idm.User{
			Login: "user1",
			Attributes: map[string]string{
				idm.UserAttrDisplayName: "User One",
			},
		})
		mtime, _ := time.Parse(time.RFC3339, "2026-01-15T12:51:21+01:00")
		node := &tree.Node{
			Path:  "/path/to/file",
			Size:  36,
			MTime: mtime.Unix(),
			MetaStore: map[string]string{
				common.MetaNamespaceNodeName: "\"baseName.docs\"",
			},
		}
		f, e := builder.Build(ctx, node, nil)
		So(e, ShouldBeNil)
		bb, _ := json.Marshal(f)
		So(string(bb), ShouldEqual, `{"BaseFileName":"baseName.docs","OwnerId":"pydio","Size":36,"UserId":"user1","Version":"1768477881","UserFriendlyName":"User One","UserCanWrite":true,"LastModifiedTime":"2026-01-15T12:51:21+01:00","PydioPath":"/path/to/file"}`)

		Convey("With COLLABORA_DISABLE_PRINT=true", func() {
			So(config.Set(ctx, true, "frontend", "plugin", "editor.libreoffice", "COLLABORA_DISABLE_PRINT"), ShouldBeNil)
			f, e := builder.Build(ctx, node, nil)
			So(e, ShouldBeNil)
			So(f.HidePrintOption, ShouldBeTrue)
			So(f.DisablePrint, ShouldBeTrue)
		})

		Convey("With COLLABORA_DISABLE_EXPORT=true", func() {
			So(config.Set(ctx, true, "frontend", "plugin", "editor.libreoffice", "COLLABORA_DISABLE_EXPORT"), ShouldBeNil)
			f, e := builder.Build(ctx, node, nil)
			So(e, ShouldBeNil)
			So(f.HideExportOption, ShouldBeTrue)
			So(f.DisableExport, ShouldBeTrue)
		})

		Convey("With COLLABORA_DISABLE_SAVE=true", func() {
			So(config.Set(ctx, true, "frontend", "plugin", "editor.libreoffice", "COLLABORA_DISABLE_SAVE"), ShouldBeNil)
			f, e := builder.Build(ctx, node, nil)
			So(e, ShouldBeNil)
			So(f.HideSaveOption, ShouldBeTrue)
			So(f.UserCanNotWriteRelative, ShouldBeTrue)
		})

		Convey("With COLLABORA_DISABLE_COPY=true", func() {
			So(config.Set(ctx, true, "frontend", "plugin", "editor.libreoffice", "COLLABORA_DISABLE_COPY"), ShouldBeNil)
			f, e := builder.Build(ctx, node, nil)
			So(e, ShouldBeNil)
			So(f.DisableCopy, ShouldBeTrue)
		})

		Convey("With COLLABORA_DISABLE_MODE=readonly", func() {
			So(config.Set(ctx, "readonly", "frontend", "plugin", "editor.libreoffice", "COLLABORA_DISABLE_MODE"), ShouldBeNil)
			f, e := builder.Build(ctx, node, nil)
			So(e, ShouldBeNil)
			So(f.UserCanWrite, ShouldBeFalse)
		})

		Convey("With COLLABORA_DISABLE_MODE=comment", func() {
			So(config.Set(ctx, "comment", "frontend", "plugin", "editor.libreoffice", "COLLABORA_DISABLE_MODE"), ShouldBeNil)
			f, e := builder.Build(ctx, node, nil)
			So(e, ShouldBeNil)
			So(f.UserCanWrite, ShouldBeTrue)
			So(f.UserCanOnlyComment, ShouldBeTrue)
		})

		Convey("With COLLABORA_DISABLE_REPAIR=true", func() {
			So(config.Set(ctx, true, "frontend", "plugin", "editor.libreoffice", "COLLABORA_DISABLE_REPAIR"), ShouldBeNil)
			f, e := builder.Build(ctx, node, nil)
			So(e, ShouldBeNil)
			So(f.HideRepairOption, ShouldBeTrue)
		})

	})
}
