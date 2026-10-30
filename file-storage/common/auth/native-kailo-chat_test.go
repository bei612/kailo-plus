package auth

import (
	"testing"

	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/proto/chat"
)

func withKailoChatMode(t *testing.T, on bool) {
	t.Helper()
	previous := NativeKailoMode
	NativeKailoMode = func() bool { return on }
	t.Cleanup(func() { NativeKailoMode = previous })
}

func TestNativeKailoChatRoomAllowedKailoMode(t *testing.T) {
	withKailoChatMode(t, true)
	if !NativeKailoChatRoomAllowed(chat.RoomType_NODE) || NativeKailoChatRoomRefusal(chat.RoomType_NODE) != nil {
		t.Fatal("file comment rooms (NODE) must stay served in Kailo mode")
	}
	for _, roomType := range []chat.RoomType{chat.RoomType_WORKSPACE, chat.RoomType_USER, chat.RoomType_GLOBAL, chat.RoomType_ANY} {
		if NativeKailoChatRoomAllowed(roomType) {
			t.Fatalf("%s rooms must be refused in Kailo mode", roomType)
		}
		if err := NativeKailoChatRoomRefusal(roomType); !errors.Is(err, errors.StatusForbidden) {
			t.Fatalf("%s refusal = %v, want StatusForbidden", roomType, err)
		}
	}
}

func TestNativeKailoChatRoomAllowedStandalone(t *testing.T) {
	withKailoChatMode(t, false)
	for _, roomType := range []chat.RoomType{chat.RoomType_NODE, chat.RoomType_WORKSPACE, chat.RoomType_USER, chat.RoomType_GLOBAL} {
		if !NativeKailoChatRoomAllowed(roomType) || NativeKailoChatRoomRefusal(roomType) != nil {
			t.Fatalf("%s rooms must keep native behaviour outside Kailo mode", roomType)
		}
	}
}
