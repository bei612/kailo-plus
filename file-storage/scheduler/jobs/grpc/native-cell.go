package grpc

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/auth/claim"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/errors"
	proto "github.com/pydio/cells/v5/common/proto/jobs"
	"github.com/pydio/cells/v5/common/runtime/manager"
	"github.com/pydio/cells/v5/scheduler/jobs"
	"google.golang.org/grpc/metadata"
	"io"
)

// The proof is transient RPC metadata, never a Job field, broker event or
// persisted bearer. The original Core management PEP verifies its signature,
// lifecycle AE, current state, binding and generation before the DAO fence.
func (j *JobsHandler) nativeCellSnapshot(ctx context.Context, request *proto.ListJobsRequest, stream proto.JobService_ListJobsServer) (bool, error) {
	proofs := metadata.ValueFromIncomingContext(ctx, "x-kailo-binding-reconcile")
	if len(proofs) == 0 {
		return false, nil
	}
	refused := errors.WithStack(errors.StatusForbidden)
	var delivery auth.NativeCellShareDelivery
	if len(proofs) != 1 || config.Get(ctx, "services", common.ServiceRestNamespace_+"n", "platform").Scan(&delivery) != nil || delivery.Validate() != nil || int64(len(proofs[0])) > delivery.MaxResponseBytes {
		return true, refused
	}
	actor, ok := claim.FromContext(ctx)
	if !ok || actor.Subject != delivery.InstanceServiceUUID {
		return true, refused
	}
	raw, err := base64.RawURLEncoding.DecodeString(proofs[0])
	if err != nil {
		return true, refused
	}
	var envelope struct {
		ActionToken   string `json:"actionToken"`
		ArgumentsJSON string `json:"argumentsJson"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&envelope) != nil || decoder.Decode(new(interface{})) != io.EOF {
		return true, refused
	}
	var ref map[string]interface{}
	if json.Unmarshal([]byte(envelope.ArgumentsJSON), &ref) != nil || len(ref) != 6 || ref["bindingId"] != delivery.BindingID || ref["generation"] != float64(delivery.CellShare.BindingGeneration) || ref["nativeInstanceRef"] != delivery.NativeInstanceRef || ref["nativeScopeRef"] != delivery.NativeScopeRef {
		return true, refused
	}
	key, keyOK := ref["idempotencyKey"].(string)
	digest, digestOK := ref["configDigest"].(string)
	if !keyOK || !auth.NativeActorUUID(key) || !digestOK || len(digest) != 64 {
		return true, refused
	}
	if len(request.JobIDs) != 1 || request.JobIDs[0] != delivery.CellShare.NativeJobID || request.LoadTasks != proto.TaskStatus_Any || request.Owner != "" || request.EventsOnly || request.TimersOnly || request.TasksOffset != 0 || request.TasksLimit != 0 {
		return true, refused
	}
	claims, _, err := delivery.AuthorizeOperation(ctx, envelope.ActionToken, envelope.ArgumentsJSON, "reconcile")
	if err != nil || claims["tenant_id"] != delivery.TenantID || claims["target_id"] != delivery.BindingID || claims["target_type"] != "APPLICATION_BINDING" || claims["action_execution_id"] != key {
		return true, refused
	}
	if claims["action_key"] != "application_binding.disable" && claims["action_key"] != "application_binding.create" {
		return true, refused
	}
	store, err := manager.Resolve[jobs.DAO](ctx)
	if err != nil {
		return true, err
	}
	// Both disable and canceled create are already DISABLING at Core PEP.
	// Handshake/validation cannot reach this reconcile-only consumer.
	var write auth.NativeWriteDelivery
	if config.Get(ctx, "services", common.ServiceRestNamespace_+"n", "platform").Scan(&write) != nil {
		return true, refused
	}
	var sharing auth.NativeShareDelivery
	if config.Get(ctx, "services", common.ServiceRestNamespace_+"n", "platform").Scan(&sharing) != nil {
		return true, refused
	}
	snapshot, err := store.SnapshotNativeCells(ctx, delivery.BindingID, delivery.CellShare.BindingGeneration, delivery.CellShare.NativeJobID, true, delivery.MaxResponseBytes, write.Write.NativeJobID, sharing.Share.NativeJobID)
	if err != nil {
		return true, err
	}
	for _, job := range snapshot {
		if err := stream.Send(&proto.ListJobsResponse{Job: job}); err != nil {
			return true, err
		}
	}
	return true, ctx.Err()
}
