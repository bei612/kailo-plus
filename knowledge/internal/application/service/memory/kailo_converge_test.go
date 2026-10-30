package memory

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/Tencent/WeKnora/internal/config"
	"github.com/Tencent/WeKnora/internal/types"
)

// Kailo DD-163: in Kailo mode memory is Kailo Agent memory. A workspace that
// had native memory switched on neither stores nor recalls anything, and the
// rows already stored stay in the database without being read out.
func TestKailoModeDisablesNativeMemory(t *testing.T) {
	svc, _, tenantRepo := newMemoryHarness(t)
	ctx := enabledCtx(t, tenantRepo, 1, "alice")

	_, err := svc.Remember(ctx, types.MemoryItem{
		Kind: types.MemoryKindPreference, Content: "回答请直接给结论，不要铺垫", Importance: 4,
	})
	require.NoError(t, err)
	require.Len(t, svc.Recall(ctx, "帮我看看这个报错").Items, 1)

	svc.config = &config.Config{Kailo: &config.KailoIntegrationConfig{Enable: true}}
	require.False(t, svc.workspaceConfig(ctx, 1).MemoryEnabled())

	_, err = svc.Remember(ctx, types.MemoryItem{
		Kind: types.MemoryKindPreference, Content: "以后用英文回答", Importance: 4,
	})
	require.ErrorIs(t, err, ErrMemoryDisabled)
	recall := svc.Recall(ctx, "帮我看看这个报错")
	require.Empty(t, recall.Items)
	require.Empty(t, recall.Prompt)

	svc.config = &config.Config{}
	require.True(t, svc.workspaceConfig(ctx, 1).MemoryEnabled())
}
