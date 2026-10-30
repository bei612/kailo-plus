package auth

// One collaboration system (Kailo DD-163, .design/07 §4.8.8). In Kailo mode
// the only native chat that stays is the file comment thread: a chat room of
// type NODE attached to one file or folder (SF-CEL-17). Shared-space chat
// (WORKSPACE rooms), user-to-user chat (USER) and the global room (GLOBAL)
// duplicate Kailo channels and direct messages, and their native access
// check is empty, so the server refuses to create, join, list, read, post to
// or delete from them. Existing rooms and messages of those types stay in the
// chat store untouched; no interface reads them out and Kailo imports none
// (Kailo channel messages are signed by each member's own key).

import (
	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/proto/chat"
)

// NativeKailoChatRoomAllowed reports whether chat rooms of this type are
// served. Outside Kailo mode every type keeps its native behaviour.
func NativeKailoChatRoomAllowed(roomType chat.RoomType) bool {
	if !NativeKailoMode() {
		return true
	}
	return roomType == chat.RoomType_NODE
}

// NativeKailoChatRoomRefusal is the error returned for a refused room type,
// nil when the type is served.
func NativeKailoChatRoomRefusal(roomType chat.RoomType) error {
	if NativeKailoChatRoomAllowed(roomType) {
		return nil
	}
	return errors.WithMessage(errors.StatusForbidden, "chat is provided by Kailo channels and direct messages; only file comments stay (DD-163)")
}
