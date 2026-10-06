package protocol

import (
	"context"
	"errors"
)

// WriteObservation is the closed machine schema's metadata-only native report.
// ResultRevision is set only after the native writer accepted the bytes AND
// Cells NodeVersions matched that writer's ETag/size to the exact VersionId.
type WriteObservation struct {
	Phase          string `json:"phase"`
	CorrelationRef string `json:"correlationRef"`
	Editors        string `json:"editors"`
	BaseModifiedAt string `json:"baseModifiedAt"`
	BytesWritten   int64  `json:"bytesWritten"`
	NativeETag     string `json:"nativeEtag,omitempty"`
	ResultRevision string `json:"resultRevision,omitempty"`
}

func (d Delivery) Report(ctx context.Context, sessionID, nodeID string, evidence WriteObservation) (string, error) {
	if !canonicalUUID(sessionID) || !canonicalUUID(nodeID) {
		return "", errors.New("invalid native write locator")
	}
	operation := "OBSERVE"
	if evidence.Phase == "STARTED" {
		operation = "WRITE"
	}
	var receipt struct {
		ProtocolSessionID string `json:"protocolSessionId"`
		State             string `json:"state"`
	}
	if err := d.request(ctx, map[string]interface{}{"protocolSessionId": sessionID, "nativeObjectRef": nodeID,
		"nativeOperation": operation, "bindingId": d.BindingID, "writeObservation": evidence}, &receipt); err != nil {
		return "", err
	}
	if receipt.ProtocolSessionID != sessionID {
		return "", errors.New("native write receipt differs from original session")
	}
	valid := false
	switch evidence.Phase {
	case "STARTED":
		valid = receipt.State == "DIRTY"
	case "ACCEPTED":
		valid = receipt.State == "SAVED" || receipt.State == "UNKNOWN"
	case "UNKNOWN":
		valid = receipt.State == "UNKNOWN"
	case "CONFLICT":
		valid = receipt.State == "CONFLICT" || receipt.State == "UNKNOWN"
	case "FAILED":
		valid = receipt.State == "FAILED" || receipt.State == "UNKNOWN"
	}
	if !valid {
		return "", errors.New("native write receipt has unknown state")
	}
	return receipt.State, nil
}
