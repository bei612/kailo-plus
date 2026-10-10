package auth

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/pborman/uuid"
	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth/claim"
	"github.com/pydio/cells/v5/common/auth/protocol"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/errors"
)

// NativeActorDelivery links only pre-existing native users. Both the original
// node handlers and original native Task observer consume this same delivery.
type NativeActorDelivery struct {
	protocol.Delivery
	TenantID          string                     `json:"tenantId"`
	NativeInstanceRef string                     `json:"nativeInstanceRef"`
	NativeScopeRef    string                     `json:"nativeScopeRef"`
	NativeRootRef     string                     `json:"nativeRootRef"`
	DraftUploads      *NativeDraftUploadDelivery `json:"draftUploads,omitempty"`
	Read              *NativeReadDelivery        `json:"read,omitempty"`
	Actors            []struct {
		PrincipalID string `json:"principalId"`
		Kind        string `json:"kind"`
		UserUUID    string `json:"userUuid"`
	} `json:"actors"`
}

// These are native upload/cleanup bounds delivered through the original Cells
// config store, not Action/Quota policy and not the multipart cache lifetime.
// Absence has no default and cannot enable platform draft staging.
type NativeDraftUploadDelivery struct {
	Timeout        string `json:"timeout"`
	SweepInterval  string `json:"sweepInterval"`
	SweepBatchSize int64  `json:"sweepBatchSize"`
}

func (d NativeDraftUploadDelivery) Durations() (time.Duration, time.Duration, error) {
	timeout, timeoutErr := time.ParseDuration(d.Timeout)
	interval, intervalErr := time.ParseDuration(d.SweepInterval)
	if timeoutErr != nil || intervalErr != nil || timeout <= 0 || interval <= 0 || d.SweepBatchSize <= 0 {
		return 0, 0, errors.WithMessage(errors.InvalidParameters, "native draft upload lifetime and cleanup bounds must be explicitly delivered")
	}
	return timeout, interval, nil
}

func NativeActorUUID(value string) bool {
	id := uuid.Parse(value)
	return id != nil && id.String() == value && value != "00000000-0000-0000-0000-000000000000"
}

func (d NativeActorDelivery) User(tenant, principal, kind string) (string, error) {
	refused := errors.WithStack(errors.StatusForbidden)
	if !NativeActorUUID(d.TenantID) || tenant != d.TenantID || !NativeActorUUID(principal) || !NativeActorUUID(d.NativeScopeRef) || !NativeActorUUID(d.NativeRootRef) || d.NativeInstanceRef == "" {
		return "", refused
	}
	principals, users := map[string]bool{}, map[string]bool{}
	selected := ""
	for _, link := range d.Actors {
		if !NativeActorUUID(link.PrincipalID) || !NativeActorUUID(link.UserUUID) || (link.Kind != "HUMAN" && link.Kind != "AGENT") || principals[link.PrincipalID] || users[link.UserUUID] || link.UserUUID == d.InstanceServiceUUID {
			return "", refused
		}
		principals[link.PrincipalID], users[link.UserUUID] = true, true
		if link.PrincipalID == principal && link.Kind == kind {
			selected = link.UserUUID
		}
	}
	if selected == "" {
		return "", refused
	}
	return selected, nil
}

type NativeWriteDelivery struct {
	NativeActorDelivery
	WorkspaceID string `json:"workspaceId"`
	Write       struct {
		NativeJobID                 string `json:"nativeJobId,omitempty"`
		ActionVersion               int64  `json:"actionVersion"`
		NativeType                  string `json:"nativeType"`
		ResultExposurePolicyID      string `json:"resultExposurePolicyId"`
		ResultExposurePolicyVersion int64  `json:"resultExposurePolicyVersion"`
	} `json:"write"`
}

// TakeNativeProof removes credentials before any original handler diagnostics.
// No proof preserves the original independent native UI and its own ACLs.
func TakeNativeProof(request *http.Request) (string, bool, error) {
	values := request.Header.Values("X-Kailo-Native-Execution")
	request.Header.Del("X-Kailo-Native-Execution")
	if len(values) == 0 {
		return "", false, nil
	}
	if len(values) != 1 || values[0] == "" {
		return "", true, errors.WithStack(errors.StatusForbidden)
	}
	return values[0], true, nil
}

// NativeWriteAuthority consumes the existing Core PEP and original native user.
// Each original REST caller still evaluates its own PolicyEngine and ACLs. The
// native Task stores references/digests, never this proof.
func NativeWriteAuthority(request *http.Request, raw, operation string) (NativeWriteDelivery, map[string]interface{}, map[string]interface{}, string, error) {
	var delivery NativeWriteDelivery
	refused := errors.WithStack(errors.StatusForbidden)
	ctx := request.Context()
	if config.Get(ctx, "services", common.ServiceRestNamespace_+"n", "platform").Scan(&delivery) != nil || delivery.MaxResponseBytes <= 0 || int64(len(raw)) > delivery.MaxResponseBytes || delivery.Write.NativeJobID == "" || strings.TrimSpace(delivery.Write.NativeJobID) != delivery.Write.NativeJobID {
		return delivery, nil, nil, "", refused
	}
	transport, ok := claim.FromContext(ctx)
	if !ok || !NativeActorUUID(delivery.InstanceServiceUUID) || transport.Subject != delivery.InstanceServiceUUID {
		return delivery, nil, nil, "", refused
	}
	data, err := base64.RawURLEncoding.DecodeString(raw)
	var proof struct {
		ActionToken   string `json:"actionToken"`
		ArgumentsJSON string `json:"argumentsJson"`
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err != nil || decoder.Decode(&proof) != nil || decoder.Decode(new(interface{})) != io.EOF {
		return delivery, nil, nil, "", refused
	}
	claims, target, err := delivery.AuthorizeOperation(ctx, proof.ActionToken, proof.ArgumentsJSON, operation)
	if err != nil || claims["action_key"] != "file_storage.write@v1" || claims["tenant_id"] != delivery.TenantID || !NativeActorUUID(text(claims, "target_id")) || (delivery.WorkspaceID != "" && claims["workspace_id"] != delivery.WorkspaceID) || claims["action_definition_version"] != float64(delivery.Write.ActionVersion) || claims["result_exposure_policy_id"] != delivery.Write.ResultExposurePolicyID || claims["result_exposure_policy_version"] != float64(delivery.Write.ResultExposurePolicyVersion) {
		return delivery, nil, nil, "", refused
	}
	for _, key := range []string{"operation_id", "action_execution_id", "actor_principal_id", "initiating_human_principal_id"} {
		if !NativeActorUUID(text(claims, key)) {
			return delivery, nil, nil, "", refused
		}
	}
	if operation == "execute" && (!NativeActorUUID(text(claims, "idempotency_key")) || !NativeActorUUID(text(claims, "external_execution_id"))) {
		return delivery, nil, nil, "", refused
	}
	kind := "HUMAN"
	if agent, exists := claims["agent_principal_id"]; exists {
		kind = "AGENT"
		if agent != claims["actor_principal_id"] || !NativeActorUUID(text(claims, "delegation_id")) {
			return delivery, nil, nil, "", refused
		}
	} else if claims["actor_principal_id"] != claims["initiating_human_principal_id"] {
		return delivery, nil, nil, "", refused
	}
	userID, err := delivery.User(text(claims, "tenant_id"), text(claims, "actor_principal_id"), kind)
	if err != nil {
		return delivery, nil, nil, "", refused
	}
	user, err := ResolveNativeUser(ctx, userID)
	if err != nil {
		return delivery, nil, nil, "", refused
	}
	native := WithImpersonate(ctx, user)
	*request = *request.WithContext(native)
	return delivery, claims, target, proof.ArgumentsJSON, nil
}

func text(value map[string]interface{}, key string) string {
	valueText, _ := value[key].(string)
	return valueText
}

// AuthorizeNativeDataMutation preserves the independent native data gateway,
// but does not let a platform-bound UI bypass the original Action producer via
// a direct S3 or background-job write. The current native draft PUT changes its
// blob before the immutable Version ACK, so even "Draft-Mode" is not an
// admissible exception.
func AuthorizeNativeDataMutation(request *http.Request) error {
	if request.Method != http.MethodPut && request.Method != http.MethodPost && request.Method != http.MethodDelete && request.Method != http.MethodPatch {
		// Read proofs belong to the original GetObject/HEAD consumer. Do not
		// strip or interpret them in this mutation-only gateway boundary.
		return nil
	}
	// A proof is meaningful only to a handler which actually verifies and
	// consumes its admitted operation. Never silently treat it as independent
	// native authority, including on an instance without platform delivery.
	_, present, err := TakeNativeProof(request)
	if err != nil {
		return err
	}
	if present {
		return errors.WithStack(errors.StatusForbidden)
	}
	ctx := request.Context()
	if config.Get(ctx, "services", common.ServiceRestNamespace_+"n", "platform").Get() == nil {
		return nil
	}
	return errors.WithStack(errors.StatusForbidden)
}
