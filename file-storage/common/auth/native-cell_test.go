package auth

import (
	"encoding/json"
	"testing"
)

func TestNativeCellRecipientUsesOriginalActorDelivery(t *testing.T) {
	const user = "00000000-0000-4000-8000-000000000001"
	const principal = "00000000-0000-4000-8000-000000000002"
	const tenant = "00000000-0000-4000-8000-000000000003"
	const service = "00000000-0000-4000-8000-000000000004"
	for _, scenario := range []string{"human", "agent", "missing", "duplicate-user", "duplicate-principal", "service", "malformed-unselected", "wrong-tenant"} {
		t.Run(scenario, func(t *testing.T) {
			links := []map[string]string{{"principalId": principal, "userUuid": user, "kind": "HUMAN"}}
			switch scenario {
			case "agent":
				links[0]["kind"] = "AGENT"
			case "missing":
				links = nil
			case "duplicate-user":
				links = append(links, map[string]string{"principalId": service, "userUuid": user, "kind": "HUMAN"})
			case "duplicate-principal":
				links = append(links, map[string]string{"principalId": principal, "userUuid": tenant, "kind": "HUMAN"})
			case "malformed-unselected":
				links = append(links, map[string]string{"principalId": "bad", "userUuid": tenant, "kind": "HUMAN"})
			}
			value := map[string]interface{}{"tenantId": tenant, "nativeScopeRef": tenant, "nativeRootRef": tenant, "nativeInstanceRef": "native-instance", "instanceServiceUuid": service, "actors": links}
			if scenario == "service" {
				value["instanceServiceUuid"] = user
			}
			if scenario == "wrong-tenant" {
				value["tenantId"] = ""
			}
			body, _ := json.Marshal(value)
			var delivery NativeActorDelivery
			if err := json.Unmarshal(body, &delivery); err != nil {
				t.Fatal(err)
			}
			actual, err := delivery.HumanPrincipal(user)
			if scenario == "human" {
				if err != nil || actual != principal {
					t.Fatalf("original unique HUMAN mapping not consumed: %q %v", actual, err)
				}
			} else if err == nil || actual != "" {
				t.Fatalf("ambiguous/non-HUMAN identity accepted: %s %q", scenario, actual)
			}
		})
	}
}
