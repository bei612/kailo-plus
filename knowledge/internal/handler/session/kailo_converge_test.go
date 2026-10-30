package session

import (
	"net/http"
	"testing"

	"github.com/Tencent/WeKnora/internal/config"
	"github.com/Tencent/WeKnora/internal/errors"
	"github.com/Tencent/WeKnora/internal/types"
)

// Kailo DD-163: Kailo mode answers only with the built-in quick answer.
func TestKailoQuickAnswerOnly(t *testing.T) {
	kailo := &config.Config{Kailo: &config.KailoIntegrationConfig{Enable: true}}
	native := &config.Config{}
	cases := []struct {
		name    string
		req     CreateKnowledgeQARequest
		refused bool
	}{
		{"no agent (normal mode defaults)", CreateKnowledgeQARequest{}, false},
		{"built-in quick answer", CreateKnowledgeQARequest{AgentID: types.BuiltinQuickAnswerID}, false},
		{"smart reasoning", CreateKnowledgeQARequest{AgentID: "builtin-smart-reasoning"}, true},
		{"custom agent", CreateKnowledgeQARequest{AgentID: "6f1c0b9e-agent"}, true},
		{"shared agent", CreateKnowledgeQARequest{AgentID: types.BuiltinQuickAnswerID, AgentSourceTenantID: 7}, true},
		{"agent mode flag", CreateKnowledgeQARequest{AgentID: types.BuiltinQuickAnswerID, AgentEnabled: true}, true},
	}
	for _, tc := range cases {
		req := tc.req
		err := kailoQuickAnswerOnly(kailo, &req)
		if tc.refused {
			appErr, ok := err.(*errors.AppError)
			if !ok || appErr.HTTPCode != http.StatusForbidden {
				t.Errorf("%s: Kailo mode = %v, want 403", tc.name, err)
			}
		} else if err != nil {
			t.Errorf("%s: Kailo mode = %v, want allowed", tc.name, err)
		}
		if err := kailoQuickAnswerOnly(native, &req); err != nil {
			t.Errorf("%s: native mode = %v, want allowed", tc.name, err)
		}
	}
	if err := kailoQuickAnswerOnly(nil, &CreateKnowledgeQARequest{AgentID: "x"}); err != nil {
		t.Errorf("nil config = %v, want allowed", err)
	}
}
