package rest

import (
	"strings"
	"testing"
)

// Kailo (DD-133(1), DD-138(7), .design/07 §4.8.1): the native admin console
// has no upstream software update / upgrade entry and its dashboard root is
// not the upstream edition teaser.
func TestKailoSettingsMenuHasNoUpgradeEntry(t *testing.T) {
	if c := settingsNode.GetRootMetadata().GetComponent(); c != "AdminComponents.GridDashboard" {
		t.Fatalf("root component = %q", c)
	}
	for _, section := range settingsNode.GetSections() {
		for _, entry := range section.GetChildren() {
			key := strings.ToLower(entry.GetKey())
			component := entry.GetMetadata().GetComponent()
			if key == "update" || key == "updater" || key == "upgrade" || key == "support" ||
				strings.Contains(component, "Updater") || strings.Contains(component, "Upgrade") {
				t.Fatalf("section %s keeps upstream entry %s (%s)", section.GetKey(), entry.GetKey(), component)
			}
		}
	}
}
