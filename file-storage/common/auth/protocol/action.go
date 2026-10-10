package protocol

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
)

// AuthorizeAction reuses the binding's original authenticated PEP callback.
// The JWT payload is not trusted until that authority has verified the exact
// token/arguments against its locked AE, actor, delegation and generation.
// Maps deliberately consume the existing contracts instead of redefining them.
func (d Delivery) AuthorizeAction(ctx context.Context, token, arguments string) (map[string]interface{}, map[string]interface{}, error) {
	return d.AuthorizeOperation(ctx, token, arguments, "execute")
}

// SERVICE SOURCE reads use the existing three-field read-grant PEP response,
// not a HUMAN targetResource or an ExternalExecution. Core verifies the exact
// signed native root in arguments against the original Resource and binding.
func (d Delivery) AuthorizeSourceRead(ctx context.Context, token, arguments string) (map[string]interface{}, error) {
	refused := errors.New("native source read authority refused or unavailable")
	if err := d.validate(); err != nil || int64(len(token)+len(arguments)) > d.MaxResponseBytes {
		return nil, refused
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[0] == "" || parts[1] == "" || parts[2] == "" {
		return nil, refused
	}
	data, err := base64.RawURLEncoding.DecodeString(parts[1])
	var claims map[string]interface{}
	if err != nil || json.Unmarshal(data, &claims) != nil || claims == nil {
		return nil, refused
	}
	var result map[string]interface{}
	if err := d.request(ctx, map[string]interface{}{"bindingId": d.BindingID, "actionToken": token,
		"operation": "execute", "argumentsJson": arguments}, &result); err != nil {
		return nil, refused
	}
	ae, aeOK := result["actionExecutionId"].(string)
	op, opOK := result["operationId"].(string)
	zed, zedOK := result["authorizationMinZedToken"].(string)
	if len(result) != 3 || !aeOK || !opOK || !zedOK || zed == "" ||
		!canonicalUUID(ae) || !canonicalUUID(op) || claims["action_execution_id"] != ae || claims["operation_id"] != op {
		return nil, refused
	}
	for _, key := range []string{"initiating_human_principal_id", "agent_principal_id", "delegation_id", "delegation_version", "result_exposure_policy_id", "result_exposure_policy_version", "external_execution_id"} {
		if _, present := claims[key]; present {
			return nil, refused
		}
	}
	return claims, nil
}

// AuthorizeOperation observes the same frozen native Task without replaying an
// execute token. Core deliberately omits a resource body for an old observation.
func (d Delivery) AuthorizeOperation(ctx context.Context, token, arguments, operation string) (map[string]interface{}, map[string]interface{}, error) {
	refused := errors.New("native action authority refused or unavailable")
	if err := d.validate(); err != nil || int64(len(token)+len(arguments)) > d.MaxResponseBytes || (operation != "execute" && operation != "observe" && operation != "extract_usage") {
		return nil, nil, refused
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[0] == "" || parts[1] == "" || parts[2] == "" {
		return nil, nil, refused
	}
	data, err := base64.RawURLEncoding.DecodeString(parts[1])
	var claims map[string]interface{}
	if err != nil || json.Unmarshal(data, &claims) != nil || claims == nil {
		return nil, nil, refused
	}
	var result map[string]interface{}
	if err = d.request(ctx, map[string]interface{}{"bindingId": d.BindingID, "actionToken": token,
		"operation": operation, "argumentsJson": arguments}, &result); err != nil {
		// Never expose upstream bodies, service credentials or the action proof.
		return nil, nil, refused
	}
	ae, aeOK := result["actionExecutionId"].(string)
	op, opOK := result["operationId"].(string)
	zed, zedOK := result["authorizationMinZedToken"].(string)
	target, targetOK := result["targetResource"].(map[string]interface{})
	if !aeOK || !opOK || !zedOK || zed == "" ||
		!canonicalUUID(ae) || !canonicalUUID(op) || claims["action_execution_id"] != ae || claims["operation_id"] != op {
		return nil, nil, refused
	}
	if operation != "execute" {
		if len(result) != 3 || targetOK {
			return nil, nil, refused
		}
		return claims, nil, nil
	}
	if len(result) != 4 || !targetOK || len(target) != 5 {
		return nil, nil, refused
	}
	for _, key := range []string{"resourceId", "nativeType", "nativeRef", "nativeInstanceRef", "nativeScopeRef"} {
		value, ok := target[key].(string)
		if !ok || value == "" || strings.TrimSpace(value) != value {
			return nil, nil, refused
		}
	}
	if claims["target_type"] != "RESOURCE" || claims["target_id"] != target["resourceId"] ||
		!canonicalUUID(target["resourceId"].(string)) || !canonicalUUID(target["nativeRef"].(string)) {
		return nil, nil, refused
	}
	return claims, target, nil
}
