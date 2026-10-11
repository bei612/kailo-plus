package mcpserver

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"time"

	"github.com/Tencent/WeKnora/internal/types"
	"github.com/hibiken/asynq"
	"github.com/mark3labs/mcp-go/mcp"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// This private management seam shares the authenticated native MCP transport.
// It is not in the workspace tool catalog or model-facing tool discovery.
const nativeBindingReconcileTool = "kailo_binding_reconcile"

func (s *Server) handleNativeBindingReconcile(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	ep, err := endpointFromContext(ctx)
	if err != nil {
		return mcp.NewToolResultError("native endpoint unavailable"), nil
	}
	return s.reconcileNativeBinding(ctx, ep, req)
}

func (s *Server) reconcileNativeBinding(ctx context.Context, ep *types.MCPEndpoint, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	delivery, err := s.nativeAdapter(ctx, ep, false)
	if err != nil || delivery == nil || delivery.values == nil || s.db == nil {
		return mcp.NewToolResultError("native binding management unavailable"), nil
	}
	claims, _, operation, err := delivery.authorize(ctx, req.Header.Get(nativeActionProofHeader))
	var reference map[string]json.RawMessage
	if err != nil || operation != "reconcile" || json.Unmarshal(claims["native_arguments"], &reference) != nil || len(reference) != 6 ||
		nativeText(claims, "target_type") != "APPLICATION_BINDING" || nativeText(claims, "target_id") != delivery.ep.PlatformBindingID ||
		(nativeText(claims, "action_key") != "application_binding.disable" && nativeText(claims, "action_key") != "application_binding.create") ||
		nativeText(reference, "bindingId") != delivery.ep.PlatformBindingID || nativeNumber(reference, "generation") <= 0 ||
		nativeText(reference, "idempotencyKey") != nativeText(claims, "action_execution_id") ||
		nativeText(reference, "nativeScopeRef") != nativeText(delivery.values, "nativeKnowledgeBaseId") ||
		nativeText(reference, "configDigest") == "" || nativeText(reference, "nativeInstanceRef") == "" {
		return mcp.NewToolResultError("native binding management admission refused"), nil
	}
	var management, validation map[string]json.RawMessage
	if json.Unmarshal(delivery.values["management"], &management) != nil ||
		json.Unmarshal(management["validation"], &validation) != nil ||
		nativeText(validation, "nativeInstanceRef") != nativeText(reference, "nativeInstanceRef") {
		return mcp.NewToolResultError("native binding instance differs from controlled delivery"), nil
	}
	// The cutoff commits before observation, and survives observation failures.
	// Every native receiver create/transfer/delete-intent uses this same lock.
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var endpoints []types.MCPEndpoint
		if err := tx.Unscoped().Clauses(clause.Locking{Strength: "UPDATE"}).Where("tenant_id = ? AND platform_binding_id = ?", ep.TenantID, delivery.ep.PlatformBindingID).
			Order("id").Find(&endpoints).Error; err != nil {
			return err
		}
		found := false
		for _, current := range endpoints {
			if len(current.KnowledgeBaseIDs) != 1 || current.KnowledgeBaseIDs[0] != nativeText(reference, "nativeScopeRef") {
				return errors.New("native binding endpoint scope changed")
			}
			if current.ID == ep.ID {
				found = !current.DeletedAt.Valid && current.Enabled && current.TokenHash == ep.TokenHash
			}
		}
		if !found {
			return errors.New("native binding authenticated endpoint changed")
		}
		return tx.Unscoped().Model(&types.MCPEndpoint{}).Where("tenant_id = ? AND platform_binding_id = ? AND platform_closed_generation < ?",
			ep.TenantID, delivery.ep.PlatformBindingID, nativeNumber(reference, "generation")).
			UpdateColumn("platform_closed_generation", nativeNumber(reference, "generation")).Error
	})
	if err != nil {
		return mcp.NewToolResultErrorFromErr("native binding cutoff unavailable", err), nil
	}
	value, err := s.observeNativeBinding(ctx, delivery.ep, reference)
	if err != nil {
		return mcp.NewToolResultErrorFromErr("native binding observation unavailable", err), nil
	}
	// An observation does not bypass a withdrawal during database I/O.
	current, err := s.nativeAdapter(ctx, ep, false)
	if err != nil || current == nil || current.values == nil {
		return mcp.NewToolResultError("native binding delivery changed"), nil
	}
	if _, _, _, err := current.authorize(ctx, req.Header.Get(nativeActionProofHeader)); err != nil {
		return mcp.NewToolResultError("native binding observation disclosure refused"), nil
	}
	return jsonResult(value)
}

func (s *Server) observeNativeBinding(ctx context.Context, ep *types.MCPEndpoint, reference map[string]json.RawMessage) (map[string]any, error) {
	kb := nativeText(reference, "nativeScopeRef")
	observations := []map[string]any{}
	complete := true
	seen := map[string]bool{}
	finishedBatches := map[string]string{}
	finishedDocuments := map[string]string{}
	unknown := func(kind, key, nativeID string) {
		complete = false
		if !nativeUUID(key) || seen[kind+":"+key] {
			return
		}
		seen[kind+":"+key] = true
		observations = append(observations, map[string]any{"idempotencyKey": key, "nativeType": kind,
			"nativeId": nativeID, "platformStatus": "UNKNOWN", "cancelCapability": "UNSUPPORTED", "lastObservedAt": time.Now().UTC().Format(time.RFC3339Nano)})
	}
	// Retained native handoffs have original dedup keys, but historical payloads
	// do not carry frozen binding/generation. Do not assign the current delivery
	// generation or turn an ACK/intent into a terminal completion observation.
	rows, err := s.db.WithContext(ctx).Model(&types.TaskPendingOp{}).
		Where("tenant_id = ? AND scope = ? AND scope_id = ?", ep.TenantID, types.TaskScopeKnowledgeBase, kb).Rows()
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var op types.TaskPendingOp
		if err := s.db.ScanRows(rows, &op); err != nil {
			_ = rows.Close()
			return nil, err
		}
		unknown(op.TaskType, op.DedupKey, op.DedupKey)
	}
	readErr := rows.Err()
	_ = rows.Close()
	if readErr != nil {
		return nil, readErr
	}
	// Original SyncLogs remain the native batch identities; current config is
	// not evidence of which generation admitted a historical batch.
	rows, err = s.db.WithContext(ctx).Model(&types.SyncLog{}).
		Joins("JOIN data_sources ON data_sources.id = sync_logs.data_source_id AND data_sources.tenant_id = sync_logs.tenant_id").
		Where("sync_logs.tenant_id = ? AND data_sources.knowledge_base_id = ? AND (data_sources.platform_binding_id = ? OR (data_sources.platform_binding_id = '' AND data_sources.type = ?))", ep.TenantID, kb, ep.PlatformBindingID, "file_storage").
		Select("sync_logs.*").Rows()
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var log types.SyncLog
		if err := s.db.ScanRows(rows, &log); err != nil {
			_ = rows.Close()
			return nil, err
		}
		var result types.SyncResult
		var snapshot struct {
			BatchID    string `json:"batchId"`
			BindingID  string `json:"bindingId"`
			Generation int64  `json:"generation"`
			Groups     map[string]struct {
				KnowledgeID string `json:"knowledgeId"`
				Revision    string `json:"revision"`
			} `json:"groups"`
			Applying map[string]json.RawMessage `json:"applying"`
			Retiring map[string]json.RawMessage `json:"retiring"`
		}
		valid := json.Unmarshal(log.Result, &result) == nil && result.NextCursor != nil
		if valid {
			raw, marshalErr := json.Marshal(result.NextCursor.ConnectorCursor)
			valid = marshalErr == nil && json.Unmarshal(raw, &snapshot) == nil && snapshot.BatchID == log.ID &&
				snapshot.BindingID == ep.PlatformBindingID && snapshot.Generation > 0 && snapshot.Generation <= nativeNumber(reference, "generation") &&
				snapshot.Groups != nil && len(snapshot.Applying) == 0 && snapshot.Retiring != nil && len(snapshot.Retiring) == 0
		}
		if !valid || log.Status != types.SyncLogStatusSuccess || log.FinishedAt == nil || log.StartedAt.IsZero() ||
			log.FinishedAt.Before(log.StartedAt) || log.FinishedAt.After(time.Now()) ||
			result.NextCursor.LastSyncTime.IsZero() || result.NextCursor.LastSyncTime.After(*log.FinishedAt) {
			unknown(types.TypeDataSourceSync, log.ID, log.ID)
			continue
		}
		for _, group := range snapshot.Groups {
			revision, revisionErr := time.Parse(time.RFC3339Nano, group.Revision)
			if !nativeUUID(group.KnowledgeID) || revisionErr != nil || revision.IsZero() || revision.After(*log.FinishedAt) {
				valid = false
				break
			}
		}
		if !valid {
			unknown(types.TypeDataSourceSync, log.ID, log.ID)
			continue
		}
		finishedBatches[log.ID] = log.DataSourceID
		for _, group := range snapshot.Groups {
			prior, _ := time.Parse(time.RFC3339Nano, finishedDocuments[group.KnowledgeID])
			revision, _ := time.Parse(time.RFC3339Nano, group.Revision)
			if revision.After(prior) {
				finishedDocuments[group.KnowledgeID] = group.Revision
			}
		}
		if seen[types.TypeDataSourceSync+":"+log.ID] {
			continue
		}
		seen[types.TypeDataSourceSync+":"+log.ID] = true
		observations = append(observations, map[string]any{"idempotencyKey": log.ID, "nativeType": types.TypeDataSourceSync,
			"nativeId": log.ID, "nativeStatus": log.Status, "platformStatus": "SUCCEEDED", "cancelCapability": "UNSUPPORTED",
			"terminalAt": log.FinishedAt.UTC().Format(time.RFC3339Nano), "lastObservedAt": time.Now().UTC().Format(time.RFC3339Nano)})
	}
	readErr = rows.Err()
	_ = rows.Close()
	if readErr != nil {
		return nil, readErr
	}
	// Missing native task/receipt coordinates are not empty drainage. Inspect
	// retained managed and historical receiver documents without copying body.
	rows, err = s.db.WithContext(ctx).Unscoped().Model(&types.Knowledge{}).
		Select("id", "metadata", "channel", "parse_status", "pending_subtasks_count", "updated_at", "deleted_at").Where("tenant_id = ? AND knowledge_base_id = ?", ep.TenantID, kb).Rows()
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var document types.Knowledge
		if err := s.db.ScanRows(rows, &document); err != nil {
			_ = rows.Close()
			return nil, err
		}
		metadata := document.GetMetadata()
		binding := metadata["platform_receiver_binding_id"]
		if binding == ep.PlatformBindingID {
			generation, err := strconv.ParseInt(metadata["platform_receiver_generation"], 10, 64)
			if err == nil && generation > nativeNumber(reference, "generation") && strconv.FormatInt(generation, 10) == metadata["platform_receiver_generation"] {
				continue
			}
			if err == nil && generation > 0 && strconv.FormatInt(generation, 10) == metadata["platform_receiver_generation"] && !document.DeletedAt.Valid && document.ParseStatus == types.ParseStatusCompleted && document.PendingSubtasksCount == 0 &&
				finishedDocuments[document.ID] == document.UpdatedAt.UTC().Format(time.RFC3339Nano) {
				continue
			}
			complete = false
		} else if binding == "" && (document.Channel == "file_storage" || document.Channel == "mcp") {
			complete = false
		}
	}
	readErr = rows.Err()
	_ = rows.Close()
	if readErr != nil {
		return nil, readErr
	}
	// An acknowledged task no longer has a TaskPendingOp. Read the original
	// queue as well; absent Redis is unavailable evidence, not an empty queue.
	if s.redisClient == nil {
		complete = false
	} else {
		inspector := asynq.NewInspectorFromRedisClient(s.redisClient)
		queues, err := inspector.Queues()
		if err != nil {
			return nil, err
		}
		// A completed batch proves its own outcome, not the complete set of
		// other native tasks. Pagination cannot establish that missing set.
		if len(queues) != 0 {
			complete = false
		}
		for _, queue := range queues {
			for _, list := range []func(string, ...asynq.ListOption) ([]*asynq.TaskInfo, error){
				inspector.ListPendingTasks, inspector.ListScheduledTasks, inspector.ListRetryTasks,
				inspector.ListActiveTasks, inspector.ListArchivedTasks, inspector.ListCompletedTasks,
			} {
				for page := 1; ; page++ {
					if err := ctx.Err(); err != nil {
						return nil, err
					}
					tasks, err := list(queue, asynq.Page(page))
					if errors.Is(err, asynq.ErrQueueNotFound) {
						break
					}
					if err != nil {
						return nil, err
					}
					if len(tasks) == 0 {
						break
					}
					for _, task := range tasks {
						if task == nil {
							complete = false
							continue
						}
						belongs, err := s.nativeTaskMayBelong(ctx, ep, kb, task.Payload)
						if err != nil {
							return nil, err
						}
						if belongs {
							var batch types.DataSourceSyncPayload
							if task.Type == types.TypeDataSourceSync && json.Unmarshal(task.Payload, &batch) == nil && batch.SyncLogID == task.ID &&
								batch.TenantID == ep.TenantID && finishedBatches[task.ID] != "" && finishedBatches[task.ID] == batch.DataSourceID {
								continue
							}
							var payload types.DocumentProcessPayload
							if task.Type == types.TypeDocumentProcess && json.Unmarshal(task.Payload, &payload) == nil &&
								payload.TenantID == ep.TenantID && payload.KnowledgeBaseID == kb && finishedDocuments[payload.KnowledgeID] != "" {
								continue
							}
							unknown(task.Type, task.ID, task.ID)
						}
					}
				}
			}
		}
	}
	return map[string]any{"reference": reference, "complete": complete, "observations": observations}, nil
}

// Original task payloads vary by native worker. Missing/deleted coordinates
// cannot prove exclusion; no current binding/generation is assigned to them.
func (s *Server) nativeTaskMayBelong(ctx context.Context, ep *types.MCPEndpoint, kb string, payload []byte) (bool, error) {
	var fields map[string]json.RawMessage
	if json.Unmarshal(payload, &fields) != nil {
		return false, errors.New("native task scope is unavailable")
	}
	var tenant uint64
	if json.Unmarshal(fields["tenant_id"], &tenant) != nil || tenant == 0 {
		return false, errors.New("native task tenant is unavailable")
	}
	if tenant != ep.TenantID {
		return false, nil
	}
	if ref := nativeText(fields, "knowledge_base_id"); ref != "" {
		return ref == kb, nil
	}
	if ref := nativeText(fields, "data_source_id"); ref != "" {
		var source types.DataSource
		err := s.db.WithContext(ctx).Unscoped().Where("id = ? AND tenant_id = ?", ref, tenant).Take(&source).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, errors.New("native task source scope is unavailable")
		}
		if err != nil {
			return false, err
		}
		return source.KnowledgeBaseID == kb && (source.PlatformBindingID == "" || source.PlatformBindingID == ep.PlatformBindingID), nil
	}
	ids := []string{}
	if ref := nativeText(fields, "knowledge_id"); ref != "" {
		ids = append(ids, ref)
	}
	var batch []string
	if json.Unmarshal(fields["knowledge_ids"], &batch) == nil {
		ids = append(ids, batch...)
	}
	if len(ids) == 0 {
		return false, errors.New("native task document scope is unavailable")
	}
	for _, id := range ids {
		var document types.Knowledge
		err := s.db.WithContext(ctx).Unscoped().Select("knowledge_base_id", "metadata").Where("id = ? AND tenant_id = ?", id, tenant).Take(&document).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, errors.New("native task document scope is unavailable")
		}
		if err != nil {
			return false, err
		}
		binding := document.GetMetadata()["platform_receiver_binding_id"]
		if document.KnowledgeBaseID == kb && (binding == "" || binding == ep.PlatformBindingID) {
			return true, nil
		}
	}
	return false, nil
}
