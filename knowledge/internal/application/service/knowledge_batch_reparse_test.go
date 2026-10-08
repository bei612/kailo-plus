package service

import (
	"context"
	"errors"
	"testing"

	"github.com/Tencent/WeKnora/internal/application/access"
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/Tencent/WeKnora/internal/types/interfaces"
	"github.com/hibiken/asynq"
	"github.com/stretchr/testify/require"
)

type reparseFailureKnowledgeRepo struct {
	interfaces.KnowledgeRepository
	knowledge   *types.Knowledge
	updateCalls int
}

func (r *reparseFailureKnowledgeRepo) GetKnowledgeByID(
	_ context.Context,
	_ uint64,
	_ string,
) (*types.Knowledge, error) {
	return r.knowledge, nil
}

func (r *reparseFailureKnowledgeRepo) UpdateKnowledge(
	_ context.Context,
	_ *types.Knowledge,
) error {
	r.updateCalls++
	return nil
}

func (r *reparseFailureKnowledgeRepo) UpdateKnowledgeColumn(
	_ context.Context,
	_ string,
	_ string,
	_ interface{},
) error {
	return nil
}

type reparseFailureKBService struct {
	interfaces.KnowledgeBaseService
	kb *types.KnowledgeBase
}

func (s *reparseFailureKBService) GetKnowledgeBaseByID(
	_ context.Context,
	_ string,
) (*types.KnowledgeBase, error) {
	return s.kb, nil
}

type failingReparseTaskEnqueuer struct {
	err error
}

func (e failingReparseTaskEnqueuer) Enqueue(
	_ *asynq.Task,
	_ ...asynq.Option,
) (*asynq.TaskInfo, error) {
	return nil, e.err
}

func TestReparseKnowledgeManualEnqueueFailureIsVisible(t *testing.T) {
	enqueueErr := errors.New("queue unavailable")
	knowledge := &types.Knowledge{
		ID:              "knowledge-1",
		TenantID:        7,
		KnowledgeBaseID: "kb-1",
		Type:            types.KnowledgeTypeManual,
		ParseStatus:     types.ParseStatusCompleted,
		EnableStatus:    "enabled",
	}
	require.NoError(t, knowledge.SetManualMetadata(
		types.NewManualKnowledgeMetadata("# content", types.ManualKnowledgeStatusPublish, 1),
	))
	repo := &reparseFailureKnowledgeRepo{knowledge: knowledge}
	svc := &knowledgeService{
		repo:      repo,
		kbService: &reparseFailureKBService{kb: &types.KnowledgeBase{ID: "kb-1", TenantID: 7}},
		task:      failingReparseTaskEnqueuer{err: enqueueErr},
	}
	ctx := context.WithValue(context.Background(), types.TenantIDContextKey, uint64(7))

	ctx, grantErr := access.WithKBTaskWrite(ctx, &types.KnowledgeBase{ID: "kb-1", TenantID: 7}, 7)
	require.NoError(t, grantErr)

	got, err := svc.ReparseKnowledge(ctx, knowledge.ID, nil)

	require.Error(t, err)
	require.NotNil(t, got)
	assertKnowledgeSubmissionUnknown(t, err, got)
	require.Equal(t, "disabled", got.EnableStatus)
	require.Equal(t, 1, repo.updateCalls, "only the original pending state is persisted")
}

func TestReparseQueueUnknownDoesNotOverwriteWorker(t *testing.T) {
	for _, source := range []string{"manual", "file", "file_url", "url"} {
		for _, observed := range []string{types.ParseStatusPending, types.ParseStatusCompleted, types.ParseStatusFailed} {
			t.Run(source+"/"+observed, func(t *testing.T) {
				f := newDocumentWriteFixture(t)
				row, err := f.repo.GetKnowledgeByID(f.ctx, 7, "doc")
				require.NoError(t, err)
				row.Type, row.StorageSize = source, 0
				row.ParseStatus = types.ParseStatusCompleted
				row.FileName, row.FileType = "doc.txt", "txt"
				switch source {
				case "manual":
					require.NoError(t, row.SetManualMetadata(types.NewManualKnowledgeMetadata("body", types.ManualKnowledgeStatusPublish, 1)))
				case "file":
					row.FilePath = "stored/doc"
				default:
					row.Source = "http://127.0.0.1/doc.txt"
				}
				require.NoError(t, f.repo.UpdateKnowledge(f.ctx, row))
				audit := &captureKBActivityAudit{}
				f.svc.audit = audit
				queue := &createKnowledgeTaskEnqueuerStub{err: errors.New("queue reply lost")}
				writesAtSubmission := 0
				queue.beforeEnqueue = func() {
					persisted, err := f.repo.GetKnowledgeByID(f.ctx, 7, "doc")
					require.NoError(t, err)
					require.Equal(t, types.ParseStatusPending, persisted.ParseStatus)
					writesAtSubmission = f.repo.writes
					require.NoError(t, f.db.Model(&types.Knowledge{}).Where("id = ?", "doc").Update("parse_status", observed).Error)
				}
				f.svc.task = queue
				got, err := f.svc.ReparseKnowledge(f.ctx, "doc", nil)
				assertKnowledgeSubmissionUnknown(t, err, got)
				require.Equal(t, writesAtSubmission, f.repo.writes)
				persisted, err := f.repo.GetKnowledgeByID(f.ctx, 7, "doc")
				require.NoError(t, err)
				require.Equal(t, observed, persisted.ParseStatus)
				require.Equal(t, 1, queue.calls)
				require.Equal(t, types.AuditOutcomePartial, audit.entry.Outcome)
			})
		}
	}
}

func TestRunKnowledgeListReparseSubmissionsReportsPartialFailure(t *testing.T) {
	firstErr := errors.New("first failed")
	secondErr := errors.New("second failed")
	var attempted []string

	outcome, err := runKnowledgeListReparseSubmissions(
		[]string{"ok-1", "bad-1", "ok-2", "bad-2"},
		func(id string) error {
			attempted = append(attempted, id)
			switch id {
			case "bad-1":
				return firstErr
			case "bad-2":
				return secondErr
			default:
				return nil
			}
		},
	)

	require.Equal(t, []string{"ok-1", "bad-1", "ok-2", "bad-2"}, attempted)
	require.Equal(t, knowledgeListReparseOutcome{Submitted: 2, Failed: 2}, outcome)
	require.ErrorIs(t, err, asynq.SkipRetry)
	require.ErrorIs(t, err, firstErr)
	require.ErrorIs(t, err, secondErr)
	require.ErrorContains(t, err, "knowledge bad-1")
	require.ErrorContains(t, err, "knowledge bad-2")
}

func TestRunKnowledgeListReparseSubmissionsSucceeds(t *testing.T) {
	outcome, err := runKnowledgeListReparseSubmissions(
		[]string{"knowledge-1", "knowledge-2"},
		func(string) error { return nil },
	)

	require.NoError(t, err)
	require.Equal(t, knowledgeListReparseOutcome{Submitted: 2}, outcome)
}

func TestReparseKnowledgePreservesOrChangesSummaryChoice(t *testing.T) {
	for _, tc := range []struct {
		name      string
		overrides *types.KnowledgeProcessOverrides
		want      bool
	}{
		{name: "reuse upload choice"},
		{
			name:      "explicitly keep disabled",
			overrides: &types.KnowledgeProcessOverrides{SummaryEnabled: processConfigBoolPtr(false)},
		},
		{
			name:      "enable on reparse",
			overrides: &types.KnowledgeProcessOverrides{SummaryEnabled: processConfigBoolPtr(true)},
			want:      true,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			knowledge := &types.Knowledge{
				ID: "knowledge-1", TenantID: 7, KnowledgeBaseID: "kb-1",
				Type: types.KnowledgeTypeManual, ParseStatus: types.ParseStatusCompleted,
			}
			metadata := types.NewManualKnowledgeMetadata("# content", types.ManualKnowledgeStatusPublish, 1)
			require.NoError(t, knowledge.SetManualMetadata(metadata))
			require.NoError(t, knowledge.SetProcessOverrides(&types.KnowledgeProcessOverrides{
				SummaryEnabled: processConfigBoolPtr(false),
			}))
			kb := &types.KnowledgeBase{ID: "kb-1", TenantID: 7}
			queue := &wikiEnqueueFailureTaskQueue{}
			svc := &knowledgeService{
				repo:      &reparseFailureKnowledgeRepo{knowledge: knowledge},
				kbService: &reparseFailureKBService{kb: kb}, task: queue,
			}
			ctx := context.WithValue(context.Background(), types.TenantIDContextKey, uint64(7))
			ctx, err := access.WithKBTaskWrite(ctx, kb, 7)
			require.NoError(t, err)
			got, err := svc.ReparseKnowledge(ctx, knowledge.ID, tc.overrides)
			require.NoError(t, err)
			require.Equal(t, []string{types.TypeManualProcess}, queue.taskTypes)
			overrides, err := got.ProcessOverrides()
			require.NoError(t, err)
			require.NotNil(t, overrides.SummaryEnabled)
			require.Equal(t, tc.want, *overrides.SummaryEnabled)
			require.Equal(t, tc.want, ResolveProcessConfig(kb, overrides).SummaryEnabled)
		})
	}
}
