package protocol

import (
	"context"
	"errors"
	"time"
)

// LifecycleFacts is explicitly not Facts: an expired/revoked HUMAN's original
// token can be inspected or destroyed without granting content access again.
type LifecycleFacts struct {
	Decision          string    `json:"decision"`
	ProtocolSessionID string    `json:"protocolSessionId"`
	NativeObjectRef   string    `json:"nativeObjectRef"`
	RequestedMode     string    `json:"requestedMode"`
	ExpiresAt         time.Time `json:"expiresAt"`
}

func (d Delivery) Lifecycle(ctx context.Context, sessionID, nodeID, operation string) (*LifecycleFacts, error) {
	if !canonicalUUID(sessionID) || !canonicalUUID(nodeID) ||
		(operation != "TOKEN_OBSERVE" && operation != "TOKEN_REVOKE") {
		return nil, errors.New("invalid original document token lifecycle reference")
	}
	var facts LifecycleFacts
	if err := d.request(ctx, map[string]interface{}{"protocolSessionId": sessionID, "nativeObjectRef": nodeID,
		"nativeOperation": operation, "bindingId": d.BindingID}, &facts); err != nil {
		return nil, err
	}
	if facts.Decision != "ALLOW" || facts.ProtocolSessionID != sessionID || facts.NativeObjectRef != nodeID ||
		(facts.RequestedMode != "VIEW" && facts.RequestedMode != "EDIT") || facts.ExpiresAt.IsZero() {
		return nil, errors.New("invalid original document token lifecycle facts")
	}
	return &facts, nil
}
