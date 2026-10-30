package router

import (
	"testing"

	"github.com/Tencent/WeKnora/internal/config"
	"github.com/Tencent/WeKnora/internal/handler"
)

// Kailo DD-163: Kailo mode reports custom agents, IM and web embedding as
// unsupported so the frontend renders none of their entries; independent
// deployments keep them.
func TestKailoModeHidesAgentsIMAndEmbedCapabilities(t *testing.T) {
	params := RouterParams{
		CustomAgentHandler:  &handler.CustomAgentHandler{},
		IMHandler:           &handler.IMHandler{},
		EmbedChannelHandler: &handler.EmbedChannelHandler{},
	}
	params.Config = &config.Config{Kailo: &config.KailoIntegrationConfig{Enable: true}}
	kailo := deploymentCapabilitiesFromRouter(params)
	for _, key := range []string{"agents", "integrations.im", "integrations.embed"} {
		if kailo.Capabilities[key].Supported {
			t.Errorf("Kailo mode capability %s supported, want hidden", key)
		}
	}
	params.Config = &config.Config{}
	native := deploymentCapabilitiesFromRouter(params)
	for _, key := range []string{"agents", "integrations.im", "integrations.embed"} {
		if !native.Capabilities[key].Supported {
			t.Errorf("native capability %s unsupported, want supported", key)
		}
	}
}
