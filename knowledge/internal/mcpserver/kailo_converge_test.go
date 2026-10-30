package mcpserver

import (
	"context"
	"testing"

	"github.com/Tencent/WeKnora/internal/config"
	"github.com/Tencent/WeKnora/internal/types"
)

// Kailo DD-163: in Kailo mode the knowledge ask tool answers with the
// built-in quick answer whatever agent the endpoint names; the calling Kailo
// Agent is the only agent.
func TestKailoModeAskToolUsesQuickAnswer(t *testing.T) {
	agents := &stubAgentService{agents: map[string]*types.CustomAgent{
		types.BuiltinQuickAnswerID: {ID: types.BuiltinQuickAnswerID, TenantID: 1, IsBuiltin: true},
		"agent-own":                {ID: "agent-own", TenantID: 1},
	}}
	srv := &Server{agentService: agents, cfg: &config.Config{Kailo: &config.KailoIntegrationConfig{Enable: true}}}
	got, err := srv.resolveAskAgent(context.Background(),
		&types.MCPEndpoint{ID: "ep", TenantID: 1, DefaultAgentID: "agent-own"})
	if err != nil || got.ID != types.BuiltinQuickAnswerID {
		t.Fatalf("Kailo mode must answer with the quick answer: %v %v", got, err)
	}
}
