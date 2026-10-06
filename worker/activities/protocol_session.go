package activities

import (
	"context"
	"encoding/json"
	"strings"
	"unicode"

	"apps/worker/internal/contracts/generated"
	"go.temporal.io/sdk/temporal"
)

// All later-round evidence is read from the original Session, never supplied
// by a callback as a new Workflow target or inferred from a current head.
func (c *CoreAPI) AdvanceProtocolSession(ctx context.Context, in generated.ProtocolSessionReconcileRequest) (generated.ProtocolSessionReconcileResult, error) {
	var out generated.ProtocolSessionReconcileResult
	var raw json.RawMessage
	if err := c.post(ctx, "/service/v1/protocol-sessions/reconcile", in, &raw); err != nil {
		return out, err
	}
	if decodeConformanceJSON(raw, &out) != nil || !validProtocolSessionResult(in, out) {
		return out, temporal.NewNonRetryableApplicationError("ProtocolSession response not verifiable", ErrTypeUnknownExternalResult, nil)
	}
	return out, nil
}

func validProtocolSessionResult(in generated.ProtocolSessionReconcileRequest, out generated.ProtocolSessionReconcileResult) bool {
	if out.ProtocolSessionID != in.Target.ProtocolSessionID ||
		out.Round.SessionVersion < in.Target.SessionVersion || out.WaitingReason == "" {
		return false
	}
	state := string(out.Round.State)
	switch state {
	case "ADMITTED", "OPENING", "OPEN", "DIRTY", "SAVED", "READ_ONLY", "CONFLICT", "REVOKED", "CLOSED", "EXPIRED", "UNKNOWN", "FAILED":
	default:
		return false
	}
	if evidence := out.Round.WriteObservation; evidence != nil {
		text := func(value string) bool { return strings.IndexFunc(value, unicode.IsControl) < 0 }
		if evidence.CorrelationRef == "" || !text(evidence.CorrelationRef) || !text(evidence.Editors) ||
			evidence.BytesWritten < 0 || evidence.BaseModifiedAt.IsZero() ||
			evidence.BaseModifiedAt.Nanosecond() != 0 || evidence.BaseModifiedAt.Format("Z07:00") != "Z" ||
			(evidence.NativeEtag != nil && (*evidence.NativeEtag == "" || !text(*evidence.NativeEtag))) ||
			(evidence.ResultRevision != nil && (*evidence.ResultRevision == "" || !text(*evidence.ResultRevision))) {
			return false
		}
		switch string(evidence.Phase) {
		case "STARTED", "CONFLICT", "FAILED":
			if evidence.BytesWritten != 0 || evidence.NativeEtag != nil || evidence.ResultRevision != nil {
				return false
			}
		case "ACCEPTED":
			if evidence.NativeEtag == nil || evidence.ResultRevision == nil {
				return false
			}
		case "UNKNOWN":
			if evidence.ResultRevision != nil {
				return false
			}
		default:
			return false
		}
	}
	switch out.Status {
	case generated.TaskStatusRUNNING:
		return true
	case generated.Completed, generated.Canceled, generated.TaskStatusFAILED:
		terminal := state == "REVOKED" || state == "CLOSED" || state == "EXPIRED" || state == "FAILED"
		pending := state == "DIRTY" || (out.Round.WriteObservation != nil &&
			(string(out.Round.WriteObservation.Phase) == "STARTED" || string(out.Round.WriteObservation.Phase) == "UNKNOWN"))
		if terminal && !pending && out.WaitingReason == "NONE" {
			return true
		}
	}
	return false
}
