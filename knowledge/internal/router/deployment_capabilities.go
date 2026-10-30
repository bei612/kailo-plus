package router

import (
	"github.com/Tencent/WeKnora/internal/handler"
	"github.com/Tencent/WeKnora/internal/sandbox"
)

func deploymentCapabilitiesFromRouter(params RouterParams) handler.DeploymentCapabilitiesData {
	// Kailo DD-163 (design 07 §4.8.8): custom agents, IM integrations and web
	// embedding are closed in Kailo mode (middleware.KailoConvergeGuard), so
	// the frontend hides their tabs, menus, routes and palette groups.
	kailo := params.Config != nil && params.Config.KailoEnabled()
	return handler.BuildDeploymentCapabilities(handler.Edition, handler.DeploymentFeatureAvailability{
		Organizations: params.OrganizationHandler != nil,
		Agents:        params.CustomAgentHandler != nil && !kailo,
		IM:            params.IMHandler != nil && !kailo,
		// Match RegisterEmbedChannelRoutes: management routes depend on handler only.
		Embed: params.EmbedChannelHandler != nil && !kailo,
		// Match RegisterMCPEndpointRoutes / RegisterMCPServerRoutes.
		MCPServer: params.MCPEndpointHandler != nil && params.MCPServer != nil && params.MCPEndpointService != nil,
		API:       params.TenantHandler != nil && params.TenantAPIKeyService != nil,
		MCP: params.MCPServiceHandler != nil &&
			params.MCPCredentialsHandler != nil &&
			params.MCPOAuthHandler != nil,
		WebSearch: params.WebSearchHandler != nil &&
			params.WebSearchProviderHandler != nil &&
			params.WebSearchCredentialsHandler != nil,
		VectorStore:   params.VectorStoreHandler != nil,
		Storage:       params.StorageBackendHandler != nil,
		Sandbox:       params.SandboxConfigHandler != nil,
		SandboxDocker: sandbox.DockerBackendEnabled(),
	})
}
