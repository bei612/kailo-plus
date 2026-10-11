package frontend

import (
	"context"
	"testing"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/config"
)

func TestNativeReadBootHintDoesNotExportDelivery(t *testing.T) {
	for _, governed := range []bool{false, true} {
		ctx := config.WithStubStore(context.Background())
		if err := config.Set(ctx, "fixed-version-seed", "frontend", "versionSeed"); err != nil {
			t.Fatal(err)
		}
		if governed {
			if err := config.Set(ctx, map[string]interface{}{"bindingId": "private-binding", "clientSecretFile": "private-secret-ref"}, "services", common.ServiceRestNamespace_+"n", "platform"); err != nil {
				t.Fatal(err)
			}
		}
		pool := NewPluginsPool()
		pool.Messages = make(map[string]I18nMessages)
		result, err := ComputeBootConf(ctx, pool)
		if err != nil {
			t.Fatal(err)
		}
		if governed {
			if len(result.Other) != 2 || result.Other["nativeReadRequired"] != true || result.Other["nativeWriteRequired"] != true {
				t.Fatal("binding transport hint missing or private delivery leaked")
			}
		} else if result.Other != nil {
			t.Fatal("independent native boot metadata changed")
		}
	}
}
