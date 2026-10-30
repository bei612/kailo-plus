package websocket

import (
	"testing"

	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/proto/chat"
)

// Kailo DD-163 (07 §4.8.8, V-SCN-271): the chat websocket serves file
// comment rooms (NODE) only in Kailo mode.
func TestChatMessageRoomServed(t *testing.T) {
	previous := auth.NativeKailoMode
	t.Cleanup(func() { auth.NativeKailoMode = previous })

	room := func(roomType chat.RoomType) *chat.ChatRoom {
		return &chat.ChatRoom{Type: roomType, Uuid: "room", RoomTypeObject: "object"}
	}
	named := []chat.WsMessageType{chat.WsMessageType_JOIN, chat.WsMessageType_LEAVE, chat.WsMessageType_HISTORY}

	auth.NativeKailoMode = func() bool { return true }
	for _, msgType := range named {
		if !chatMessageRoomServed(&chat.WebSocketMessage{Type: msgType, Room: room(chat.RoomType_NODE)}) {
			t.Fatalf("%s on a file comment room must be served", msgType)
		}
		for _, roomType := range []chat.RoomType{chat.RoomType_WORKSPACE, chat.RoomType_USER, chat.RoomType_GLOBAL} {
			if chatMessageRoomServed(&chat.WebSocketMessage{Type: msgType, Room: room(roomType)}) {
				t.Fatalf("%s on a %s room must be refused in Kailo mode", msgType, roomType)
			}
		}
		if chatMessageRoomServed(&chat.WebSocketMessage{Type: msgType}) {
			t.Fatalf("%s without a room must be refused in Kailo mode", msgType)
		}
	}
	// POST and DELETE_MSG act on a room joined in this session (JOIN decided).
	if !chatMessageRoomServed(&chat.WebSocketMessage{Type: chat.WsMessageType_POST, Message: &chat.ChatMessage{RoomUuid: "room"}}) {
		t.Fatal("POST is decided by the session's joined rooms")
	}
	// auth() refuses before touching the session or the tree.
	handler := &ChatHandler{}
	for _, roomType := range []chat.RoomType{chat.RoomType_WORKSPACE, chat.RoomType_USER, chat.RoomType_GLOBAL} {
		if _, err := handler.auth(nil, room(roomType)); !errors.Is(err, errors.StatusForbidden) {
			t.Fatalf("auth(%s) = %v, want StatusForbidden", roomType, err)
		}
	}

	auth.NativeKailoMode = func() bool { return false }
	for _, roomType := range []chat.RoomType{chat.RoomType_NODE, chat.RoomType_WORKSPACE, chat.RoomType_USER, chat.RoomType_GLOBAL} {
		if !chatMessageRoomServed(&chat.WebSocketMessage{Type: chat.WsMessageType_JOIN, Room: room(roomType)}) {
			t.Fatalf("outside Kailo mode %s rooms keep native behaviour", roomType)
		}
	}
}
