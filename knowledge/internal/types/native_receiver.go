package types

import "context"

// NativeReceiverAdmission carries only the original fresh PEP's frozen
// coordinates into the native database transaction. It is not a credential,
// is never serialized, and cannot authorize a delayed worker.
type NativeReceiverAdmission struct {
	BindingID       string
	Generation      int64
	TenantID        uint64
	KnowledgeBaseID string
}

type nativeReceiverAdmissionKey struct{}

func WithNativeReceiverAdmission(ctx context.Context, admission NativeReceiverAdmission) context.Context {
	return context.WithValue(ctx, nativeReceiverAdmissionKey{}, admission)
}

func NativeReceiverAdmissionFromContext(ctx context.Context) (NativeReceiverAdmission, bool) {
	admission, ok := ctx.Value(nativeReceiverAdmissionKey{}).(NativeReceiverAdmission)
	return admission, ok
}
