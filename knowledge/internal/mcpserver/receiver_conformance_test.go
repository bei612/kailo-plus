package mcpserver

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/Tencent/WeKnora/internal/application/repository"
	"github.com/Tencent/WeKnora/internal/application/service"
	"github.com/Tencent/WeKnora/internal/ratelimit"
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/google/uuid"
	"github.com/mark3labs/mcp-go/mcp"
	"github.com/stretchr/testify/require"
)

func TestNativeReceiverConformanceUsesOriginalManualSyncAndObservesLostAck(t *testing.T) {
	f := newNativeBindingFixture(t)
	db := f.server.db
	require.NoError(t, db.AutoMigrate(&types.DataSource{}, &types.SyncLog{}, &types.TaskPendingOp{}))
	kb, binding := f.config["nativeKnowledgeBaseId"].(string), f.config["bindingId"].(string)
	source := &types.DataSource{ID: uuid.NewString(), TenantID: f.ep.TenantID, KnowledgeBaseID: kb,
		PlatformBindingID: binding, Type: "file_storage", Status: types.DataSourceStatusActive}
	sources, logs := repository.NewDataSourceRepository(db), repository.NewSyncLogRepository(db)
	require.NoError(t, sources.Create(context.Background(), source))
	f.server.dataSourceService = service.NewDataSourceService(sources, logs, nil, nil, nil, nil, nil, nil, nil, nil)
	f.server.limiter = ratelimit.New(nil, rateLimitKeyPrefix, time.Minute, "")
	f.operation = "receiver_start"
	f.claims["target_type"], f.claims["action_key"] = "RESOURCE", "knowledge.sync_apply@v2"
	f.claims["actor_principal_id"], f.claims["normalized_parameter_hash"] = uuid.NewString(), "verified-by-fixture-pep"
	f.arguments = map[string]any{"idempotencyKey": uuid.NewString(), "importConfigRef": source.ID,
		"bindingId": binding, "generation": float64(9), "expiresAt": time.Now().Add(time.Hour).UTC().Format(time.RFC3339Nano)}
	ctx := context.WithValue(context.Background(), types.MCPEndpointContextKey, f.ep)
	invoke := func() *mcp.CallToolResult {
		result, err := f.server.guardTool(f.server.handleNativeReceiverConformance)(ctx, f.request(t, nativeReceiverConformanceTool, nil))
		require.NoError(t, err)
		return result
	}
	first := invoke()
	require.False(t, first.IsError, "%+v", first)
	var value map[string]any
	require.NoError(t, json.Unmarshal([]byte(first.Content[0].(mcp.TextContent).Text), &value))
	batch := value["nativeBatchId"]
	require.NotEqual(t, f.arguments["idempotencyKey"], batch, "keep the real original SyncLog identity")
	for _, operation := range []string{"receiver_start", "receiver_observe"} {
		f.operation = operation
		result := invoke()
		require.False(t, result.IsError, "%+v", result)
		var repeated map[string]any
		require.NoError(t, json.Unmarshal([]byte(result.Content[0].(mcp.TextContent).Text), &repeated))
		require.Equal(t, batch, repeated["nativeBatchId"])
	}
	var count int64
	require.NoError(t, db.Model(&types.SyncLog{}).Count(&count).Error)
	require.EqualValues(t, 1, count)
	require.NoError(t, db.Model(&types.TaskPendingOp{}).Count(&count).Error)
	require.EqualValues(t, 1, count, "missing queue ACK retains original durable handoff")
	f.claims["action_key"] = "knowledge.sync_retire@v2"
	require.True(t, invoke().IsError, "another action cannot borrow the retained request")
	f.claims["action_key"] = "knowledge.sync_apply@v2"
	f.operation = "execute"
	require.True(t, invoke().IsError, "production execute is not receiver conformance admission")
	f.operation, f.deny = "receiver_observe", true
	require.True(t, invoke().IsError, "native endpoint token cannot bypass current PEP")
	f.deny = false
	f.arguments["idempotencyKey"] = uuid.NewString()
	require.True(t, invoke().IsError, "unknown request must not start a replacement native run")
	require.NoError(t, db.Model(&types.SyncLog{}).Count(&count).Error)
	require.EqualValues(t, 1, count)
	require.Empty(t, f.server.filterTools(ctx, []mcp.Tool{mcp.NewTool(nativeReceiverConformanceTool)}))
}
