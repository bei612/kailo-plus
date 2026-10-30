package session

import (
	"context"

	"github.com/gin-gonic/gin"

	"github.com/Tencent/WeKnora/internal/application/service"
	"github.com/Tencent/WeKnora/internal/errors"
	"github.com/Tencent/WeKnora/internal/types"
)

// DD-165, 07 §4.8.9: in Kailo mode a knowledge answer is a Kailo quota item.
// A new question is admitted by Core before anything is retrieved or a model
// is called; a refused question gets the Kailo wording in place of the answer
// and no native side effect. A completed answer is reported once; a turn the
// user stopped is not an answer and is not counted.

// admitKailoAnswer returns nil when the question may start, else the error
// that answers the request (429 for an exhausted quota, 503 when the usage
// service cannot decide — never let through).
func (h *Handler) admitKailoAnswer(ctx context.Context, c *gin.Context) error {
	if h.kailoUsage == nil || !h.kailoUsage.Enabled() {
		return nil
	}
	userID, _ := types.UserIDFromContext(ctx)
	decision := h.kailoUsage.AdmitKnowledgeAnswer(ctx, userID)
	if decision == service.KailoUsageAllowed {
		return nil
	}
	text := service.KailoUsageRefusalText(decision, c.GetHeader("Accept-Language"))
	// DD-167: the decision travels with the text, so the page words the notice in
	// the Kailo language of the moment (and again after a language switch).
	details := kailoUsageRefusalDetails(decision)
	if decision == service.KailoUsageDependencyUnavailable || decision == service.KailoUsageQuotaNotConfigured {
		return errors.NewServiceUnavailableError(text).WithDetails(details)
	}
	return errors.NewTooManyRequestsError(text).WithDetails(details)
}

// reportKailoAnswer is called from completeAssistantMessage with the same
// stop rules as the long-answer notification.
func (h *Handler) reportKailoAnswer(ctx context.Context, msg *types.Message, userQuery string) {
	if h.kailoUsage == nil || !h.kailoUsage.Enabled() || msg == nil || userQuery == "" || kailoTurnStopped(ctx) {
		return
	}
	userID, ok := types.UserIDFromContext(ctx)
	if !ok {
		return
	}
	h.kailoUsage.ReportKnowledgeAnswer(ctx, userID, msg.ID, msg.UpdatedAt)
}

// kailoUsageRefusalDetails is the machine-readable part of a refusal:
// {"kailo_usage": "<decision>"}; the decision is one of the closed set of
// service.KailoUsage* refusals and carries no identity or quota figures.
func kailoUsageRefusalDetails(decision string) map[string]string {
	return map[string]string{"kailo_usage": decision}
}
