package service

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/Tencent/WeKnora/internal/types"
	"github.com/google/uuid"
)

// DD-89/13 §4.4: this is the original native Knowledge's import metadata,
// not a platform job or a second deletion ledger. The native Asynq task owns
// cleanup and its receipt. Keep both the old row and its task evidence.
const datasourceReplacementMetadataKey = "datasource_replacement"

type datasourceReplacement struct {
	KnowledgeID     string `json:"knowledge_id"`
	Revision        string `json:"revision"`
	DispatchStarted bool   `json:"dispatch_started,omitempty"`
	CompletedAt     string `json:"completed_at,omitempty"`
}

func (s *DataSourceService) finishDataSourceIngest(
	ctx context.Context, ds *types.DataSource, item *types.FetchedItem, current *types.Knowledge,
) error {
	if ds.Type == fileStorageConnectorType {
		return s.finishFileStorageIngest(ctx, ds, item, current)
	}
	if current == nil || current.ID == "" || current.TenantID != ds.TenantID ||
		current.KnowledgeBaseID != ds.KnowledgeBaseID || current.DeletedAt.Valid {
		return fmt.Errorf("native ingestion evidence is unavailable")
	}
	metadata := current.GetMetadata()
	if metadata["datasource_id"] != ds.ID || metadata["external_id"] != item.ExternalID {
		return fmt.Errorf("native ingestion does not belong to this source item")
	}
	if current.ParseStatus != types.ParseStatusCompleted {
		return fmt.Errorf("native ingestion is not ready; retain the previous cursor and source revision")
	}
	if raw := metadata[datasourceReplacementMetadataKey]; raw != "" {
		var previous datasourceReplacement
		if err := json.Unmarshal([]byte(raw), &previous); err != nil || previous.KnowledgeID == "" ||
			previous.KnowledgeID == current.ID {
			return fmt.Errorf("native replacement provenance is invalid")
		}
		if _, err := time.Parse(time.RFC3339Nano, previous.Revision); err != nil {
			return fmt.Errorf("native replacement revision is invalid")
		}
		if previous.CompletedAt != "" {
			if _, err := time.Parse(time.RFC3339Nano, previous.CompletedAt); err != nil || !previous.DispatchStarted {
				return fmt.Errorf("native replacement receipt is invalid")
			}
		} else {
			identity, err := json.Marshal([]string{ds.ID, current.ID, previous.KnowledgeID, previous.Revision})
			if err != nil {
				return err
			}
			taskID := uuid.NewSHA1(uuid.NameSpaceOID, identity).String()
			var result map[string]any
			if previous.DispatchStarted {
				// A missing/expired task after intent is UNKNOWN. Never turn a lost
				// queue acknowledgement or receipt into a second delete attempt.
				result, err = s.knowledgeService.ObserveKnowledgeDeleteTask(ctx, ds.KnowledgeBaseID,
					previous.KnowledgeID, previous.Revision, taskID)
			} else {
				previous.DispatchStarted = true
				if err := s.persistDataSourceReplacement(ctx, current, previous); err != nil {
					return err
				}
				result, err = s.knowledgeService.StartKnowledgeDeleteTask(ctx, ds.KnowledgeBaseID,
					previous.KnowledgeID, previous.Revision, taskID)
			}
			if err != nil {
				return fmt.Errorf("native replacement deletion remains unconfirmed: %w", err)
			}
			completedAt, _ := result["completed_at"].(string)
			if result["state"] != "SUCCEEDED" || result["task_id"] != taskID ||
				result["knowledge_id"] != previous.KnowledgeID || result["knowledge_base_id"] != ds.KnowledgeBaseID ||
				result["native_revision"] != previous.Revision {
				return fmt.Errorf("native replacement deletion remains unconfirmed")
			}
			if _, err := time.Parse(time.RFC3339Nano, completedAt); err != nil {
				return fmt.Errorf("native replacement completion evidence is invalid")
			}
			previous.CompletedAt = completedAt
			if err := s.persistDataSourceReplacement(ctx, current, previous); err != nil {
				return err
			}
		}
	}
	s.sweepStaleSubtree(ctx, ds, item)
	return nil
}

func (s *DataSourceService) persistDataSourceReplacement(ctx context.Context, current *types.Knowledge, previous datasourceReplacement) error {
	raw, err := json.Marshal(previous)
	if err != nil {
		return err
	}
	metadata := current.GetMetadata()
	metadata[datasourceReplacementMetadataKey] = string(raw)
	encoded, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	next := *current
	next.Metadata = types.JSON(encoded)
	if err := s.knowledgeService.GetRepository().UpdateKnowledgeForTransfer(ctx, current, &next); err != nil {
		return fmt.Errorf("persist native replacement fence: %w", err)
	}
	*current = next
	return nil
}
