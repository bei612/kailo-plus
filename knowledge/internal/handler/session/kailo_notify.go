package session

import (
	"context"
	"time"

	"github.com/Tencent/WeKnora/internal/types"
)

// DD-138(4), 07 §4.8.3: an answer that took long (the asker may have left the
// page; the turn keeps running in the background) is announced to the person
// who asked as a Kailo TASK_COMPLETED notification. A turn ended by the
// user's stop is never announced, and neither are answers delivered to other
// channels (API, IM bots) where nobody waits in the embedded page.

type kailoTurnStoppedKey struct{}

// withKailoTurnStopped marks the completion context of a turn the user stopped.
func withKailoTurnStopped(ctx context.Context) context.Context {
	return context.WithValue(ctx, kailoTurnStoppedKey{}, true)
}

func kailoTurnStopped(ctx context.Context) bool {
	stopped, _ := ctx.Value(kailoTurnStoppedKey{}).(bool)
	return stopped
}

// notifyKailoAnswerCompleted is called from completeAssistantMessage, the one
// completion sink of normal and agent turns. A stopped turn arrives either
// with an empty query (stop handler) or with the stopped mark (agent path).
func (h *Handler) notifyKailoAnswerCompleted(ctx context.Context, msg *types.Message, userQuery string) {
	if h.kailoNotifier == nil || !h.kailoNotifier.Enabled() || msg == nil || userQuery == "" || kailoTurnStopped(ctx) {
		return
	}
	if msg.Channel != "" && msg.Channel != types.ChannelWeb {
		return
	}
	userID, ok := types.UserIDFromContext(ctx)
	if !ok {
		return
	}
	finished := msg.UpdatedAt
	if finished.IsZero() {
		finished = time.Now()
	}
	h.kailoNotifier.NotifyAnswerCompleted(userID, msg.SessionID, msg.ID, userQuery, msg.CreatedAt, finished)
}
