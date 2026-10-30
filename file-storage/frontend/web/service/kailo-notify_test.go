package service

import (
	"context"
	"testing"

	"google.golang.org/protobuf/proto"

	"github.com/pydio/cells/v5/common/proto/activity"
	"github.com/pydio/cells/v5/common/proto/chat"
)

type kailoTestMessage struct{ event proto.Message }

func (m kailoTestMessage) Unmarshal(ctx context.Context, target proto.Message) (context.Context, error) {
	proto.Merge(target, m.event)
	return ctx, nil
}

func (m kailoTestMessage) RawData() (map[string]string, []byte) { return nil, nil }

// Kailo DD-163 (07 §4.8.8) and DD-138(4): a new comment on a file (NODE room)
// that mentions someone is projected to the Kailo inbox; shared-space chat,
// edits, deletions and comments without a mention are not.
func TestKailoNotifyOnChatProjectsCommentMentionsOnly(t *testing.T) {
	cases := []struct {
		name   string
		event  *chat.ChatEvent
		queued bool
	}{
		{"new file comment with a mention", &chat.ChatEvent{
			Room:    &chat.ChatRoom{Type: chat.RoomType_NODE, RoomTypeObject: "node-1"},
			Message: &chat.ChatMessage{Author: "qa-1", Message: "@qa-2 please review"},
		}, true},
		{"file comment without a mention", &chat.ChatEvent{
			Room:    &chat.ChatRoom{Type: chat.RoomType_NODE, RoomTypeObject: "node-1"},
			Message: &chat.ChatMessage{Author: "qa-1", Message: "looks good"},
		}, false},
		{"shared-space chat with a mention", &chat.ChatEvent{
			Room:    &chat.ChatRoom{Type: chat.RoomType_WORKSPACE, RoomTypeObject: "ws-1"},
			Message: &chat.ChatMessage{Author: "qa-1", Message: "@qa-2 hello"},
		}, false},
		{"edited file comment", &chat.ChatEvent{
			Room: &chat.ChatRoom{Type: chat.RoomType_NODE, RoomTypeObject: "node-1"},
			Message: &chat.ChatMessage{Author: "qa-1", Message: "@qa-2 again",
				Activity: &activity.Object{Items: []*activity.Object{{Markdown: "@qa-2 before"}}}},
		}, false},
		{"deleted file comment", &chat.ChatEvent{
			Details: "DELETE",
			Room:    &chat.ChatRoom{Type: chat.RoomType_NODE, RoomTypeObject: "node-1"},
			Message: &chat.ChatMessage{Author: "qa-1", Message: "@qa-2 bye"},
		}, false},
	}
	for _, tc := range cases {
		k := &kailoNotify{events: make(chan func(context.Context), 1)}
		if err := k.onChat(context.Background(), kailoTestMessage{event: tc.event}); err != nil {
			t.Fatalf("%s: onChat error %v", tc.name, err)
		}
		if got := len(k.events) == 1; got != tc.queued {
			t.Fatalf("%s: queued=%v, want %v", tc.name, got, tc.queued)
		}
	}
}
