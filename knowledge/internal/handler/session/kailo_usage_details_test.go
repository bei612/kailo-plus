package session

import (
	"testing"

	"github.com/Tencent/WeKnora/internal/application/service"
)

// DD-167: a refused question names its decision so the page can word the notice
// in the current Kailo language.
func TestKailoUsageRefusalDetailsNameTheDecision(t *testing.T) {
	for _, decision := range []string{
		service.KailoUsageTenantQuotaExhausted,
		service.KailoUsageMemberQuotaExhausted,
		service.KailoUsageQuotaNotConfigured,
		service.KailoUsageDependencyUnavailable,
	} {
		details := kailoUsageRefusalDetails(decision)
		if len(details) != 1 || details["kailo_usage"] != decision {
			t.Fatalf("details for %s = %v", decision, details)
		}
	}
}
