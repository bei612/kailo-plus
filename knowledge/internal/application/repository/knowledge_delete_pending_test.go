package repository

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/Tencent/WeKnora/internal/types"
	"github.com/Tencent/WeKnora/internal/types/interfaces"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func pendingDeletionFixture(t *testing.T) (*gorm.DB, interfaces.KnowledgeDeletionPendingOps, *types.KnowledgeListDeletePayload) {
	t.Helper()
	db := setupTaskQueueTestDB(t)
	require.NoError(t, db.Exec(taskQueueKnowledgeBaseTestDDL).Error)
	require.NoError(t, db.Exec(taskQueueKnowledgeTestDDL).Error)
	at := time.Now().UTC().Truncate(time.Microsecond)
	require.NoError(t, db.Exec("INSERT INTO knowledge_bases(id, tenant_id) VALUES (?, ?)", "kb", 7).Error)
	require.NoError(t, db.Exec("INSERT INTO knowledges(id,tenant_id,knowledge_base_id,parse_status,updated_at) VALUES (?,?,?,?,?)", "doc", 7, "kb", "completed", at).Error)
	payload := &types.KnowledgeListDeletePayload{TenantID: 7, KnowledgeBaseID: "kb", KnowledgeIDs: []string{"doc"}, ExpectedRevision: at.Format(time.RFC3339Nano), TaskID: uuid.NewString()}
	return db, NewTaskPendingOpsRepository(db).(interfaces.KnowledgeDeletionPendingOps), payload
}

func TestKnowledgeDeletionPendingPreservesOriginalIntentAndAcknowledgement(t *testing.T) {
	db, repo, payload := pendingDeletionFixture(t)
	ctx := context.Background()
	require.NoError(t, repo.StageKnowledgeDeletion(ctx, payload))
	require.NoError(t, repo.StageKnowledgeDeletion(ctx, payload))
	var rows []types.TaskPendingOp
	require.NoError(t, db.Find(&rows).Error)
	require.Len(t, rows, 1)
	original := string(rows[0].Payload)
	err := repo.VisitKnowledgeDeletions(ctx, payload.TaskID, func(op *types.TaskPendingOp, actual *types.KnowledgeListDeletePayload) (bool, error) {
		require.Equal(t, payload.TaskID, actual.TaskID)
		require.Nil(t, op.ClaimedAt)
		return false, errors.New("queue acknowledgement lost")
	})
	require.ErrorContains(t, err, "acknowledgement lost")
	var retained types.TaskPendingOp
	require.NoError(t, db.First(&retained).Error)
	require.Nil(t, retained.ClaimedAt)
	require.Equal(t, 1, retained.FailCount)
	require.Equal(t, original, string(retained.Payload))
	require.NoError(t, repo.VisitKnowledgeDeletions(ctx, "", func(op *types.TaskPendingOp, actual *types.KnowledgeListDeletePayload) (bool, error) {
		require.Nil(t, op.ClaimedAt)
		return true, nil
	}))
	require.NoError(t, db.First(&retained).Error)
	require.NotNil(t, retained.ClaimedAt)
	require.NoError(t, repo.VisitKnowledgeDeletions(ctx, "", func(op *types.TaskPendingOp, actual *types.KnowledgeListDeletePayload) (bool, error) {
		require.NotNil(t, op.ClaimedAt)
		require.Equal(t, original, string(op.Payload))
		return true, nil
	}))
	require.NoError(t, db.First(&retained).Error, "handoff alone cannot retire native pending evidence")
}

func TestKnowledgeDeletionPendingRejectsConflictingAndChangedTargets(t *testing.T) {
	for _, change := range []string{"tenant", "scope", "document", "revision", "key"} {
		t.Run(change, func(t *testing.T) {
			_, repo, payload := pendingDeletionFixture(t)
			require.NoError(t, repo.StageKnowledgeDeletion(context.Background(), payload))
			altered := *payload
			switch change {
			case "tenant":
				altered.TenantID++
			case "scope":
				altered.KnowledgeBaseID = "other"
			case "document":
				altered.KnowledgeIDs = []string{"other"}
			case "revision":
				altered.ExpectedRevision = time.Now().Add(time.Hour).Format(time.RFC3339Nano)
			case "key":
				altered.TaskID = "not-a-task"
			}
			require.Error(t, repo.StageKnowledgeDeletion(context.Background(), &altered))
		})
	}
	db, repo, payload := pendingDeletionFixture(t)
	require.NoError(t, db.Model(&types.Knowledge{}).Where("id = ?", "doc").UpdateColumn("updated_at", time.Now().Add(time.Second)).Error)
	require.ErrorContains(t, repo.StageKnowledgeDeletion(context.Background(), payload), "target changed")
	var count int64
	require.NoError(t, db.Model(&types.TaskPendingOp{}).Count(&count).Error)
	require.Zero(t, count)
}

func TestKnowledgeDeletionPendingScopeAndCorruptEvidenceNeverDispatch(t *testing.T) {
	for _, change := range []string{"deleted scope", "tenant", "task", "payload", "enqueue time"} {
		t.Run(change, func(t *testing.T) {
			db, repo, payload := pendingDeletionFixture(t)
			require.NoError(t, repo.StageKnowledgeDeletion(context.Background(), payload))
			switch change {
			case "deleted scope":
				require.NoError(t, db.Model(&types.KnowledgeBase{}).Where("id = ?", "kb").UpdateColumn("deleted_at", time.Now()).Error)
			case "tenant":
				require.NoError(t, db.Model(&types.TaskPendingOp{}).Where("dedup_key = ?", payload.TaskID).UpdateColumn("tenant_id", 8).Error)
			case "task":
				payload.TaskID = uuid.NewString()
				body, err := json.Marshal(payload)
				require.NoError(t, err)
				require.NoError(t, db.Model(&types.TaskPendingOp{}).Where("id > 0").UpdateColumn("payload", body).Error)
			case "payload":
				require.NoError(t, db.Model(&types.TaskPendingOp{}).Where("id > 0").UpdateColumn("payload", []byte("{}")).Error)
			case "enqueue time":
				require.NoError(t, db.Model(&types.TaskPendingOp{}).Where("id > 0").UpdateColumn("enqueued_at", time.Now().Add(time.Hour)).Error)
			}
			called := false
			err := repo.VisitKnowledgeDeletions(context.Background(), "", func(*types.TaskPendingOp, *types.KnowledgeListDeletePayload) (bool, error) {
				called = true
				return true, nil
			})
			require.Error(t, err)
			require.False(t, called)
		})
	}
}
