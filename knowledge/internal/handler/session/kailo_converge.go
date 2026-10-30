package session

import (
	"github.com/Tencent/WeKnora/internal/config"
	"github.com/Tencent/WeKnora/internal/errors"
	"github.com/Tencent/WeKnora/internal/types"
)

// kailoQuickAnswerOnly enforces Kailo DD-163 (design 07 §4.8.8) on a Q&A
// request: in Kailo mode the knowledge service answers only with the
// built-in quick answer (retrieval-based Q&A). Custom and shared agents and
// agent mode are Kailo Agent's (Kailo Agent + knowledge tools), so a request
// naming any other agent, a source workspace or agent mode is refused. An
// empty agent ID runs normal mode with defaults and stays allowed.
func kailoQuickAnswerOnly(cfg *config.Config, request *CreateKnowledgeQARequest) error {
	if cfg == nil || !cfg.KailoEnabled() || request == nil {
		return nil
	}
	if request.AgentEnabled || request.AgentSourceTenantID != 0 ||
		(request.AgentID != "" && request.AgentID != types.BuiltinQuickAnswerID) {
		return errors.NewForbiddenError("Managed by Kailo: only the built-in quick answer answers here (KAILO_MANAGED)")
	}
	return nil
}
