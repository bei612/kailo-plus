package types

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
)

// Native task types of a bound HUMAN APPLICATION execution whose later steps
// run in WeKnora's own durable workers (SS-WEK-MATERIALIZATION).
const (
	PlatformNativeTaskAddDocument    = "add_document"
	PlatformNativeTaskDeleteDocument = "delete_document"
)

// PlatformNativeTask is the retained reference of one original platform
// execution (07 §5 request_native_task_execution_admission). It holds only
// identifiers frozen at the admitted execute: the binding, the original
// ActionExecution/ExternalExecution and idempotency key, the native task the
// execute created, the frozen binding generation, the non-extendable native
// task deadline and the digest of the admitted arguments. It never holds an
// ActionToken, credential or content; every later step obtains a fresh,
// request-local ticket from Core with it.
type PlatformNativeTask struct {
	BindingID           string `json:"bindingId"`
	ActionExecutionID   string `json:"actionExecutionId"`
	ExternalExecutionID string `json:"externalExecutionId"`
	IdempotencyKey      string `json:"idempotencyKey"`
	ActionKey           string `json:"actionKey"`
	NativeType          string `json:"nativeType"`
	NativeID            string `json:"nativeId"`
	Generation          int64  `json:"generation"`
	Deadline            string `json:"deadline"`
	ArgumentsDigest     string `json:"argumentsDigest"`
}

func canonicalPlatformUUID(value string) bool {
	id, err := uuid.Parse(value)
	return err == nil && id != uuid.Nil && id.String() == value
}

// Valid reports a complete reference whose deadline has not passed.
func (t *PlatformNativeTask) Valid() bool {
	if t == nil {
		return false
	}
	for _, value := range []string{t.BindingID, t.ActionExecutionID, t.ExternalExecutionID, t.IdempotencyKey} {
		if !canonicalPlatformUUID(value) {
			return false
		}
	}
	deadline, err := time.Parse(time.RFC3339Nano, t.Deadline)
	return err == nil && deadline.After(time.Now()) && t.Generation > 0 && t.ActionKey != "" &&
		t.NativeID != "" && len(t.ArgumentsDigest) == 64 &&
		(t.NativeType == PlatformNativeTaskAddDocument || t.NativeType == PlatformNativeTaskDeleteDocument)
}

// Same compares two retained references; nil equals only nil.
func (t *PlatformNativeTask) Same(other *PlatformNativeTask) bool {
	if t == nil || other == nil {
		return t == other
	}
	return *t == *other
}

// PlatformArgumentsDigest digests admitted execute arguments independent of
// their JSON spelling, so the native task binds the exact original arguments
// whether they arrive in the ingress proof or in Core's native task ticket.
func PlatformArgumentsDigest(raw string) (string, error) {
	decoder := json.NewDecoder(bytes.NewReader([]byte(raw)))
	decoder.UseNumber()
	var value map[string]any
	if err := decoder.Decode(&value); err != nil || value == nil || decoder.More() {
		return "", errors.New("platform execution arguments are not one JSON object")
	}
	canonical, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(canonical)
	return hex.EncodeToString(sum[:]), nil
}

type platformNativeTaskKey struct{}

// WithPlatformNativeTask carries the admitted execute's reference from the
// bound native tool to the service that creates the durable native task.
func WithPlatformNativeTask(ctx context.Context, task PlatformNativeTask) context.Context {
	return context.WithValue(ctx, platformNativeTaskKey{}, task)
}

// PlatformNativeTaskFrom returns a copy of the admitted reference, if any.
func PlatformNativeTaskFrom(ctx context.Context) (PlatformNativeTask, bool) {
	task, ok := ctx.Value(platformNativeTaskKey{}).(PlatformNativeTask)
	return task, ok
}
