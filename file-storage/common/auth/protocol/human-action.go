package protocol

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"
)

// HumanAction consumes the original NativeHumanActionRequest/Result contracts.
// An absent original AE is distinct from an unavailable request. In particular,
// a lost submit ACK never authorizes another key or a native write replay.
func (d Delivery) HumanAction(ctx context.Context, accessToken string, intent map[string]interface{}) (map[string]interface{}, bool, error) {
	refused := errors.New("native human action refused or unavailable")
	if err := d.validate(); err != nil || accessToken == "" || strings.ContainsAny(accessToken, "\r\n") ||
		int64(len(accessToken)) > d.MaxResponseBytes || len(intent) != 1 {
		return nil, false, refused
	}
	observing := false
	for key := range intent {
		switch key {
		case "command", "resolveResource":
		case "idempotencyKey":
			id, ok := intent[key].(string)
			if !ok || !canonicalUUID(id) {
				return nil, false, refused
			}
			observing = true
		default:
			return nil, false, refused
		}
	}
	endpoint, _ := endpoint(d.CorePEPURL)
	endpoint.Path = "/service/v1/adapter/human-action"
	payload := map[string]interface{}{"bindingId": d.BindingID}
	for key, value := range intent {
		payload[key] = value
	}
	var answer map[string]interface{}
	status, err := d.callback(ctx, endpoint.String(), accessToken, payload, &answer)
	if observing && status == http.StatusNotFound {
		return nil, false, nil
	}
	if err != nil || answer == nil {
		return nil, false, refused
	}
	return answer, true, nil
}

// NativeReadReceipt records the original synchronous HUMAN read's metadata.
// It deliberately uses SERVICE transport without renewing a HUMAN credential:
// revocation cannot erase work already performed or its actual usage.
func (d Delivery) NativeReadReceipt(ctx context.Context, receipt map[string]interface{}, interval time.Duration) (map[string]interface{}, error) {
	if err := d.validate(); err != nil {
		return nil, err
	}
	timeout, err := time.ParseDuration(d.RequestTimeout)
	if err != nil || interval <= 0 || interval >= timeout {
		return nil, errors.New("native read receipt timing unavailable")
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	endpoint, err := endpoint(d.CorePEPURL)
	if err != nil {
		return nil, err
	}
	endpoint.Path = "/service/v1/adapter/human-action"
	for {
		var answer map[string]interface{}
		status, err := d.callback(ctx, endpoint.String(), "", map[string]interface{}{"bindingId": d.BindingID, "readReceipt": receipt}, &answer)
		if err == nil && answer != nil {
			return answer, nil
		}
		// Only the already-recorded immutable receipt is repeated. An HTTP
		// refusal is not permission to repeat the original native read.
		if status != http.StatusServiceUnavailable {
			return nil, errors.New("native read completion unavailable")
		}
		timer := time.NewTimer(interval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
}
