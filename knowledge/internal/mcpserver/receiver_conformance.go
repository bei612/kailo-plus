package mcpserver

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
	"time"

	"github.com/Tencent/WeKnora/internal/types"
	"github.com/mark3labs/mcp-go/mcp"
)

const nativeReceiverConformanceTool = "kailo_receiver_conformance"

// nativeReceiverAction is a NATIVE_MANAGED receiver key of a knowledge contract
// version this release serves (knowledge@3 is current, DD-124(3)).
func nativeReceiverAction(key string) bool {
	for _, version := range []string{"@v2", "@v3"} {
		if key == "knowledge.sync_apply"+version || key == "knowledge.sync_retire"+version {
			return true
		}
	}
	return false
}

// This private adapter seam is not in native tool discovery. Ordinary platform
// PEP does not admit conformance operations; an isolated fixture must deliver
// its own trusted identity/PEP, while the actual importer still calls the real
// isolated Core read-grant and bilateral receipt consumers.
func (s *Server) handleNativeReceiverConformance(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	ep, err := endpointFromContext(ctx)
	if err != nil || s.db == nil || s.dataSourceService == nil {
		return mcp.NewToolResultError("native receiver unavailable"), nil
	}
	delivery, err := s.nativeAdapter(ctx, ep, false)
	if err != nil || delivery == nil || delivery.values == nil {
		return mcp.NewToolResultError("native receiver binding unavailable"), nil
	}
	claims, admitted, operation, err := delivery.authorize(ctx, req.Header.Get(nativeActionProofHeader))
	var args map[string]json.RawMessage
	if err != nil || (operation != "receiver_start" && operation != "receiver_observe") ||
		json.Unmarshal(claims["native_arguments"], &args) != nil || len(args) != 5 ||
		nativeText(claims, "target_type") != "RESOURCE" || !nativeReceiverAction(nativeText(claims, "action_key")) ||
		!nativeUUID(nativeText(args, "idempotencyKey")) || !nativeUUID(nativeText(args, "importConfigRef")) ||
		nativeText(args, "bindingId") != delivery.ep.PlatformBindingID ||
		nativeNumber(args, "generation") <= 0 || nativeNumber(args, "generation") != nativeNumber(admitted, "bindingGeneration") {
		return mcp.NewToolResultError("native receiver frozen request refused"), nil
	}
	expires, err := time.Parse(time.RFC3339Nano, nativeText(args, "expiresAt"))
	if err != nil || expires.IsZero() || nativeText(claims, "normalized_parameter_hash") == "" {
		return mcp.NewToolResultError("native receiver request lifetime unavailable"), nil
	}
	request := types.NativeSyncRequest{
		Key: nativeText(args, "idempotencyKey"), DataSourceID: nativeText(args, "importConfigRef"),
		KnowledgeBaseID: nativeText(delivery.values, "nativeKnowledgeBaseId"),
		ResourceID:      nativeText(claims, "target_id"), ActionKey: nativeText(claims, "action_key"),
		BindingID: delivery.ep.PlatformBindingID, Generation: nativeNumber(args, "generation"),
		PrincipalID: nativeText(claims, "actor_principal_id"), OperationID: nativeText(claims, "operation_id"),
		ExpiresAt: expires,
	}
	encoded, err := json.Marshal(args)
	if err != nil {
		return mcp.NewToolResultError("native receiver request unavailable"), nil
	}
	digest := sha256.Sum256(encoded)
	request.ParameterHash = hex.EncodeToString(digest[:])
	var target map[string]json.RawMessage
	if json.Unmarshal(admitted["targetResource"], &target) != nil ||
		nativeText(target, "resourceId") != nativeText(claims, "target_id") ||
		nativeText(target, "nativeRef") != nativeText(delivery.values, "nativeKnowledgeBaseId") ||
		nativeText(target, "nativeScopeRef") != nativeText(delivery.values, "nativeKnowledgeBaseId") {
		return mcp.NewToolResultError("native receiver target scope unavailable"), nil
	}
	if !nativeUUID(request.PrincipalID) || !nativeUUID(request.OperationID) || !nativeUUID(request.ResourceID) {
		return mcp.NewToolResultError("native receiver request owner unavailable"), nil
	}
	var source types.DataSource
	if err := s.db.WithContext(ctx).Where("id = ? AND tenant_id = ? AND knowledge_base_id = ? AND platform_binding_id = ? AND type = ?",
		request.DataSourceID, ep.TenantID, nativeText(delivery.values, "nativeKnowledgeBaseId"), request.BindingID, "file_storage").First(&source).Error; err != nil {
		return mcp.NewToolResultError("native receiver source outside binding"), nil
	}
	var log *types.SyncLog
	if operation == "receiver_start" {
		// The deadline is part of the exact PEP-verified signed arguments, not
		// an untrusted header. A refreshed token cannot alter the frozen plan.
		if !expires.After(time.Now()) || source.SyncLogRetentionDays <= 0 ||
			expires.After(time.Now().AddDate(0, 0, source.SyncLogRetentionDays)) {
			return mcp.NewToolResultError("native receiver request expired"), nil
		}
		log, err = s.dataSourceService.ManualSync(types.WithNativeSyncRequest(ctx, request), source.ID)
	} else {
		log = &types.SyncLog{}
		err = s.db.WithContext(ctx).Where("request_key = ? AND tenant_id = ? AND data_source_id = ?", request.Key, ep.TenantID, source.ID).First(log).Error
		var original types.NativeSyncRequest
		if err == nil && (json.Unmarshal(log.RequestIdentity, &original) != nil || !original.Equal(request)) {
			err = errors.New("native receiver request identity changed")
		}
	}
	if err != nil || log == nil || !nativeUUID(log.ID) {
		return mcp.NewToolResultError("native receiver batch evidence unavailable"), nil
	}
	current, err := s.nativeAdapter(ctx, ep, false)
	if err != nil || current == nil || current.values == nil {
		return mcp.NewToolResultError("native receiver binding changed"), nil
	}
	_, fresh, freshOperation, err := current.authorize(ctx, req.Header.Get(nativeActionProofHeader))
	var freshTarget map[string]json.RawMessage
	if err != nil || freshOperation != operation || nativeNumber(fresh, "bindingGeneration") != request.Generation ||
		json.Unmarshal(fresh["targetResource"], &freshTarget) != nil ||
		nativeText(freshTarget, "resourceId") != request.ResourceID ||
		nativeText(freshTarget, "nativeRef") != request.KnowledgeBaseID ||
		nativeText(freshTarget, "nativeScopeRef") != request.KnowledgeBaseID {
		return mcp.NewToolResultError("native receiver observation disclosure refused"), nil
	}
	// This is native status only. Core must correlate the real read operations
	// and both receipts before a conformance step may claim a terminal result.
	var result types.SyncResult
	if len(log.Result) != 0 && json.Unmarshal(log.Result, &result) != nil {
		return mcp.NewToolResultError("native receiver snapshot unavailable"), nil
	}
	reads := []json.RawMessage{}
	completed := false
	if result.NextCursor != nil {
		encoded, encodeErr := json.Marshal(result.NextCursor.ConnectorCursor)
		var snapshot map[string]json.RawMessage
		if encodeErr != nil || json.Unmarshal(encoded, &snapshot) != nil {
			return mcp.NewToolResultError("native receiver snapshot unavailable"), nil
		}
		if nativeText(snapshot, "batchId") == log.ID && nativeText(snapshot, "bindingId") == request.BindingID &&
			nativeNumber(snapshot, "generation") == request.Generation {
			var operations map[string]json.RawMessage
			if raw := snapshot["readOperations"]; len(raw) != 0 && json.Unmarshal(raw, &operations) != nil {
				return mcp.NewToolResultError("native receiver read evidence unavailable"), nil
			}
			keys := make([]string, 0, len(operations))
			for key := range operations {
				keys = append(keys, key)
			}
			sort.Strings(keys)
			for _, key := range keys {
				reads = append(reads, operations[key])
			}
			var applying, retiring map[string]json.RawMessage
			// Applying is omitted by the original cursor when empty. Retiring
			// remains required; absence is not evidence that deletes finished.
			applyingValid := len(snapshot["applying"]) == 0 || json.Unmarshal(snapshot["applying"], &applying) == nil
			retiringValid := json.Unmarshal(snapshot["retiring"], &retiring) == nil && retiring != nil
			completed = applyingValid && retiringValid && len(applying) == 0 && len(retiring) == 0 &&
				len(reads) > 0 && result.Failed == 0 && log.Status == types.SyncLogStatusSuccess && log.FinishedAt != nil
		}
	}
	value := map[string]any{"request": args, "nativeBatchId": log.ID,
		"nativeStatus": log.Status, "startedAt": log.StartedAt.UTC().Format(time.RFC3339Nano),
		"completed": completed, "readOperations": reads}
	if log.FinishedAt != nil {
		value["finishedAt"] = log.FinishedAt.UTC().Format(time.RFC3339Nano)
	}
	return jsonResult(value)
}
