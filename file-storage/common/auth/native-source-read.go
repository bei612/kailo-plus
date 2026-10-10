package auth

import (
	"context"
	"net/http"
	"strings"

	"github.com/pydio/cells/v5/common/auth/claim"
	"github.com/pydio/cells/v5/common/errors"
)

// Source body delivery stays under this instance's native service identity.
// The receiving binding's SERVICE actor is authorized by Core, not mapped to
// a human, a native shared user, or a second local permission directory.
func nativeSourceReadAuthority(request *http.Request, delivery NativeActorDelivery, token, arguments string, args map[string]interface{}) (*NativeReadExecution, error) {
	refused := errors.WithStack(errors.StatusForbidden)
	ctx := request.Context()
	transport, ok := claim.FromContext(ctx)
	if !ok || !NativeActorUUID(delivery.InstanceServiceUUID) || transport.Subject != delivery.InstanceServiceUUID ||
		request.Method != http.MethodGet || request.Header.Get("Range") != "" {
		return nil, refused
	}
	claims, err := delivery.AuthorizeSourceRead(ctx, token, arguments)
	if err != nil || claims["tenant_id"] != delivery.TenantID || claims["action_key"] != "file_storage.read@v1" || claims["target_type"] != "RESOURCE" {
		return nil, refused
	}
	for _, key := range []string{"tenant_id", "actor_principal_id", "operation_id", "action_execution_id", "target_id", "idempotency_key", "jti"} {
		if !NativeActorUUID(text(claims, key)) {
			return nil, refused
		}
	}
	input, inputOK := args["input"].(map[string]interface{})
	if len(args) != 4 || args["targetType"] != "RESOURCE" || args["targetId"] != claims["target_id"] ||
		!NativeActorUUID(text(args, "authorizationTargetNativeRef")) || !inputOK || input["resourceId"] != claims["target_id"] ||
		!NativeActorUUID(text(input, "nativeObjectRef")) || len(input) != 5 {
		return nil, refused
	}
	for _, key := range []string{"nativeRevision", "displayName", "mediaType"} {
		if text(input, key) == "" {
			return nil, refused
		}
	}
	if strings.TrimSpace(text(input, "nativeRevision")) != text(input, "nativeRevision") {
		return nil, refused
	}
	keys, versions := request.Header.Values("Idempotency-Key"), request.URL.Query()["versionId"]
	if len(keys) != 1 || keys[0] != claims["idempotency_key"] || len(versions) != 1 || versions[0] != input["nativeRevision"] ||
		!NativeActorUUID(delivery.NativeRootRef) || !NativeActorUUID(delivery.NativeScopeRef) || delivery.NativeInstanceRef == "" {
		return nil, refused
	}
	if _, err := ResolveNativeUser(ctx, delivery.InstanceServiceUUID); err != nil {
		return nil, refused
	}
	read := &NativeReadExecution{Delivery: delivery, Claims: claims, Token: token, Args: arguments,
		Key: keys[0], Input: input, source: true,
		Target: map[string]interface{}{"nativeRef": args["authorizationTargetNativeRef"], "resourceId": claims["target_id"],
			"nativeInstanceRef": delivery.NativeInstanceRef, "nativeScopeRef": delivery.NativeScopeRef}}
	*request = *request.WithContext(context.WithValue(ctx, nativeReadContextKey{}, read))
	return read, nil
}

func (read *NativeReadExecution) IsServiceSource() bool { return read != nil && read.source }
