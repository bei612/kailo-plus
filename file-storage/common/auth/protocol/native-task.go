package protocol

import (
	"context"
	"errors"
	"time"
)

var ErrNativeTaskReferencePending = errors.New("retained native task reference is not yet observed")

// NativeTaskAdmission consumes the independent retained-task ingress. The
// binding SERVICE is transport identity, never a replacement HUMAN login.
// Returned tickets are request-local; callers retain only the original refs.
func (d Delivery) NativeTaskAdmission(ctx context.Context, executionID string, reference map[string]interface{}, deadline string) (string, string, error) {
	refused := errors.New("retained native task execution refused or unavailable")
	if err := d.validate(); err != nil || !canonicalUUID(executionID) || len(reference) != 4 {
		return "", "", refused
	}
	for _, key := range []string{"externalExecutionId", "idempotencyKey"} {
		value, ok := reference[key].(string)
		if !ok || !canonicalUUID(value) {
			return "", "", refused
		}
	}
	for _, key := range []string{"nativeType", "nativeId"} {
		value, ok := reference[key].(string)
		if !ok || value == "" {
			return "", "", refused
		}
	}
	end, err := time.Parse(time.RFC3339Nano, deadline)
	if err != nil || !end.After(time.Now()) {
		return "", "", refused
	}
	url, err := endpoint(d.CorePEPURL)
	if err != nil {
		return "", "", refused
	}
	url.Path = "/service/v1/adapter/request_native_task_execution_admission"
	var answer map[string]interface{}
	_, err = d.callback(ctx, url.String(), "", map[string]interface{}{
		"bindingId": d.BindingID, "actionExecutionId": executionID,
		"execution": reference, "nativeTaskDeadline": deadline,
	}, &answer)
	if err != nil || answer["nativeTaskDeadline"] != deadline {
		return "", "", refused
	}
	if len(answer) == 2 && answer["state"] == "PENDING_REFERENCE" {
		return "", "", ErrNativeTaskReferencePending
	}
	if len(answer) != 5 || answer["state"] != "ADMITTED" {
		return "", "", refused
	}
	token, tokenOK := answer["actionToken"].(string)
	arguments, argsOK := answer["argumentsJson"].(string)
	expires, expiresOK := answer["expiresAt"].(string)
	expiry, parseErr := time.Parse(time.RFC3339Nano, expires)
	if !tokenOK || token == "" || !argsOK || arguments == "" || !expiresOK || parseErr != nil ||
		!expiry.After(time.Now()) || expiry.After(end) {
		return "", "", refused
	}
	return token, arguments, nil
}
