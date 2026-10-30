package grpc

import (
	"context"
	"testing"

	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/nodes/mocks"
	"github.com/pydio/cells/v5/common/proto/chat"
	"github.com/pydio/cells/v5/common/storage/test"
	"github.com/pydio/cells/v5/common/utils/uuid"

	. "github.com/smartystreets/goconvey/convey"
)

// Kailo DD-163 (07 §4.8.8, V-SCN-271): in Kailo mode the chat service serves
// file comment rooms (NODE) only. Shared-space, user and global rooms are
// refused for every operation, including rooms stored before Kailo mode.
func TestChatHandler_KailoServesFileCommentsOnly(t *testing.T) {
	handler := &ChatHandler{}
	setMode := func(on bool) { auth.NativeKailoMode = func() bool { return on } }
	previous := auth.NativeKailoMode
	t.Cleanup(func() { auth.NativeKailoMode = previous })

	test.RunStorageTests(testcases[:1], t, func(ctx context.Context) {
		ctx = context.WithValue(ctx, "resolved-meta-client", &mocks.NodeReceiverClient{})
		workspaceRoom := &chat.ChatRoom{Type: chat.RoomType_WORKSPACE, Uuid: uuid.New(), RoomTypeObject: "ws-" + uuid.New()}
		nodeRoom := &chat.ChatRoom{Type: chat.RoomType_NODE, Uuid: uuid.New(), RoomTypeObject: "node-" + uuid.New()}

		Convey("A shared-space room stored outside Kailo mode", t, func() {
			setMode(false)
			_, e := handler.PutRoom(ctx, &chat.PutRoomRequest{Room: workspaceRoom})
			So(e, ShouldBeNil)
			resp, e := handler.PostMessage(ctx, &chat.PostMessageRequest{Messages: []*chat.ChatMessage{{
				RoomUuid: workspaceRoom.Uuid, Message: "before Kailo", Author: "tester",
			}}})
			So(e, ShouldBeNil)
			stored := resp.Messages[0]

			Convey("is neither created, listed, read, written nor deleted in Kailo mode", func() {
				setMode(true)
				forbidden := func(err error) { So(errors.Is(err, errors.StatusForbidden), ShouldBeTrue) }

				for _, roomType := range []chat.RoomType{chat.RoomType_WORKSPACE, chat.RoomType_USER, chat.RoomType_GLOBAL} {
					_, e = handler.PutRoom(ctx, &chat.PutRoomRequest{Room: &chat.ChatRoom{Type: roomType, Uuid: uuid.New(), RoomTypeObject: "x"}})
					forbidden(e)
					rooms := &roomsSrvStub{}
					rooms.Ctx = ctx
					forbidden(handler.ListRooms(&chat.ListRoomsRequest{ByType: roomType}, rooms))
					So(rooms.rr, ShouldBeEmpty)
				}

				messages := &msgSrvStub{}
				messages.Ctx = ctx
				forbidden(handler.ListMessages(&chat.ListMessagesRequest{RoomUuid: workspaceRoom.Uuid}, messages))
				So(messages.mm, ShouldBeEmpty)

				_, e = handler.PostMessage(ctx, &chat.PostMessageRequest{
					Messages: []*chat.ChatMessage{{RoomUuid: workspaceRoom.Uuid, Message: "after", Author: "tester"}},
					// A caller-supplied known room never overrides the stored type.
					KnownRooms: map[string]*chat.ChatRoom{workspaceRoom.Uuid: {Type: chat.RoomType_NODE, Uuid: workspaceRoom.Uuid}},
				})
				forbidden(e)
				_, e = handler.PostMessage(ctx, &chat.PostMessageRequest{Messages: []*chat.ChatMessage{{RoomUuid: "unknown-room", Message: "x", Author: "tester"}}})
				forbidden(e)
				_, e = handler.DeleteMessage(ctx, &chat.DeleteMessageRequest{Messages: []*chat.ChatMessage{stored}})
				forbidden(e)
				_, e = handler.DeleteRoom(ctx, &chat.DeleteRoomRequest{Room: workspaceRoom})
				forbidden(e)

				Convey("while file comments (NODE rooms) keep working", func() {
					_, e = handler.PutRoom(ctx, &chat.PutRoomRequest{Room: nodeRoom})
					So(e, ShouldBeNil)
					posted, e := handler.PostMessage(ctx, &chat.PostMessageRequest{Messages: []*chat.ChatMessage{{
						RoomUuid: nodeRoom.Uuid, Message: "@qa-2 please review", Author: "tester",
					}}})
					So(e, ShouldBeNil)
					So(posted.Messages, ShouldHaveLength, 1)
					rooms := &roomsSrvStub{}
					rooms.Ctx = ctx
					So(handler.ListRooms(&chat.ListRoomsRequest{ByType: chat.RoomType_NODE, TypeObject: nodeRoom.RoomTypeObject}, rooms), ShouldBeNil)
					So(rooms.rr, ShouldHaveLength, 1)
					comments := &msgSrvStub{}
					comments.Ctx = ctx
					So(handler.ListMessages(&chat.ListMessagesRequest{RoomUuid: nodeRoom.Uuid}, comments), ShouldBeNil)
					So(comments.mm, ShouldHaveLength, 1)
					_, e = handler.DeleteMessage(ctx, &chat.DeleteMessageRequest{Messages: []*chat.ChatMessage{posted.Messages[0]}})
					So(e, ShouldBeNil)
				})
			})
		})
	})
}
