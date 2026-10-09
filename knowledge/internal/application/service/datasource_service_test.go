package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	apprepo "github.com/Tencent/WeKnora/internal/application/repository"
	"github.com/Tencent/WeKnora/internal/config"
	"github.com/Tencent/WeKnora/internal/datasource"
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/Tencent/WeKnora/internal/types/interfaces"
	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestProcessSyncCancelsWhenKnowledgeBaseDeleted(t *testing.T) {
	ds := &types.DataSource{
		ID:              "ds-1",
		TenantID:        1,
		KnowledgeBaseID: "kb-deleted",
		Type:            types.ConnectorTypeRSS,
		Status:          types.DataSourceStatusActive,
	}
	dsRepo := newKBDeleteDSRepo("kb-deleted", ds)
	syncLog := &types.SyncLog{
		ID:           "log-1",
		DataSourceID: ds.ID,
		TenantID:     ds.TenantID,
		Status:       types.SyncLogStatusRunning,
		StartedAt:    time.Now().UTC(),
	}
	syncLogRepo := &processSyncSyncLogRepo{logs: map[string]*types.SyncLog{syncLog.ID: syncLog}}

	svc := &DataSourceService{
		dsRepo:      dsRepo,
		syncLogRepo: syncLogRepo,
		kbService:   &processSyncKBService{getErr: apprepo.ErrKnowledgeBaseNotFound},
	}

	payload, err := json.Marshal(types.DataSourceSyncPayload{
		DataSourceID: ds.ID,
		TenantID:     ds.TenantID,
		SyncLogID:    syncLog.ID,
	})
	require.NoError(t, err)

	err = svc.ProcessSync(context.Background(), asynq.NewTask(types.TypeDataSourceSync, payload))
	require.NoError(t, err)

	updated := syncLogRepo.logs[syncLog.ID]
	require.NotNil(t, updated)
	assert.Equal(t, types.SyncLogStatusCanceled, updated.Status)
	assert.Equal(t, "knowledge base has been deleted", updated.ErrorMessage)
	require.NotNil(t, updated.FinishedAt)
}

type processSyncKBService struct {
	getErr error
	kb     *types.KnowledgeBase
}

type fileStorageConfigRepository struct {
	*kbDeleteDSRepo
	writes int
}

func (r *fileStorageConfigRepository) Update(context.Context, *types.DataSource) error {
	r.writes++
	return nil
}

func (r *fileStorageConfigRepository) Create(context.Context, *types.DataSource) error {
	r.writes++
	return nil
}

func TestFileStorageEditValidatesResourceConfigurationWithoutNativeCredentials(t *testing.T) {
	resource := uuid.NewString()
	for _, name := range []string{"valid-selection", "valid-selection-omitted-type", "unchanged-selection", "omitted-config", "omitted-config-and-type", "empty-selection", "duplicate-selection", "invalid-reference", "native-url-setting", "malformed-config", "empty-selection-omitted-type", "duplicate-selection-omitted-type", "invalid-reference-omitted-type", "native-url-setting-omitted-type", "malformed-config-omitted-type"} {
		t.Run(name, func(t *testing.T) {
			original, err := (&types.DataSourceConfig{ResourceIDs: []string{resource}}).ToJSON()
			require.NoError(t, err)
			existing := &types.DataSource{ID: uuid.NewString(), TenantID: 1, KnowledgeBaseID: uuid.NewString(),
				Type: fileStorageConnectorType, Status: types.DataSourceStatusPaused, Config: original}
			existing.LastSyncCursor = types.JSON(`{"applying":{"knowledgeId":"original-native-reference"}}`)
			existing.LastSyncResult = types.JSON(`{"total":1}`)
			existing.CreatedAt = time.Now().Add(-time.Hour).UTC()
			repo := &fileStorageConfigRepository{kbDeleteDSRepo: newKBDeleteDSRepo(existing.KnowledgeBaseID, existing)}
			registry := datasource.NewConnectorRegistry()
			registry.Register(&fileStorageConnector{transport: &fileStorageTransport{config: &config.FileStorageSyncConfig{
				NativeTenantID: existing.TenantID, NativeKnowledgeBaseID: existing.KnowledgeBaseID,
			}}})
			svc := &DataSourceService{dsRepo: repo, connectorRegistry: registry, scheduler: datasource.NewScheduler(repo, nil, nil)}
			defer svc.scheduler.Stop()
			cfg := &types.DataSourceConfig{ResourceIDs: []string{uuid.NewString()}}
			switch name {
			case "unchanged-selection":
				cfg.ResourceIDs = []string{resource}
			case "empty-selection", "empty-selection-omitted-type":
				cfg.ResourceIDs = nil
			case "duplicate-selection", "duplicate-selection-omitted-type":
				cfg.ResourceIDs = append(cfg.ResourceIDs, cfg.ResourceIDs[0])
			case "invalid-reference", "invalid-reference-omitted-type":
				cfg.ResourceIDs = []string{"not-a-platform-resource"}
			case "native-url-setting", "native-url-setting-omitted-type":
				cfg.Settings = map[string]interface{}{"native_url": "https://native-source.invalid"}
			}
			next := *existing
			next.LastSyncCursor = types.JSON(`{"applying":{}}`)
			next.LastSyncResult = types.JSON(`{"total":999}`)
			next.CreatedAt = time.Now().Add(-2 * time.Hour).UTC()
			next.DeletedAt.Valid = true
			next.Config, err = cfg.ToJSON()
			require.NoError(t, err)
			if name == "malformed-config" || name == "malformed-config-omitted-type" {
				next.Config = types.JSON(`{"resource_ids":`)
			}
			if name == "omitted-config" || name == "omitted-config-and-type" {
				next.Config = nil
			}
			if name == "omitted-config-and-type" || strings.HasSuffix(name, "-omitted-type") {
				next.Type = ""
			}
			result, err := svc.UpdateDataSource(context.Background(), &next)
			if name == "omitted-config" || name == "omitted-config-and-type" {
				require.NoError(t, err)
				require.Same(t, &next, result)
				require.Equal(t, 1, repo.writes)
			} else if name == "valid-selection" || name == "valid-selection-omitted-type" || name == "unchanged-selection" {
				require.NoError(t, err)
				require.Equal(t, 1, repo.writes)
				actual, parseErr := result.ParseConfig()
				require.NoError(t, parseErr)
				require.Equal(t, cfg.ResourceIDs, actual.ResourceIDs)
				require.Empty(t, actual.Credentials)
			} else {
				require.Error(t, err)
				require.Nil(t, result)
				require.Zero(t, repo.writes, "invalid configuration must not be persisted or scheduled")
			}
			if err == nil {
				require.Equal(t, fileStorageConnectorType, result.Type, "validation, persistence and scheduling must use the same native connector")
				require.Equal(t, existing.LastSyncCursor, result.LastSyncCursor)
				require.Equal(t, existing.LastSyncResult, result.LastSyncResult)
				require.Equal(t, existing.CreatedAt, result.CreatedAt)
				require.Equal(t, existing.DeletedAt, result.DeletedAt)
			}
			require.Equal(t, original, existing.Config, "editing must not mutate the previous native row before validation")
		})
	}
}

func TestFileStorageCreationAcknowledgesOnlyTheOriginalPersistedPayload(t *testing.T) {
	ds := &types.DataSource{ID: uuid.NewString(), TenantID: 1, KnowledgeBaseID: uuid.NewString(), Type: fileStorageConnectorType}
	body := []byte("persisted source body")
	id := uuid.NewString()
	metadata := map[string]string{"datasource_id": ds.ID, "external_id": "native-hash:txt",
		"source_content_sha256": fileStorageDigest(body), "source_references": "original source set"}
	raw, err := json.Marshal(metadata)
	require.NoError(t, err)
	original := types.Knowledge{ID: id, TenantID: ds.TenantID, KnowledgeBaseID: ds.KnowledgeBaseID,
		FileHash: "native-hash", FileType: "txt", FileSize: int64(len(body)), UpdatedAt: time.Now().Add(-time.Second), Metadata: types.JSON(raw)}
	item := &types.FetchedItem{NativeCreationID: id, ExternalID: metadata["external_id"], Content: body, Metadata: metadata}
	svc := &DataSourceService{}
	for _, state := range []string{types.ParseStatusPending, types.ParseStatusProcessing, types.ParseStatusFinalizing, types.ParseStatusCompleted, types.ParseStatusFailed, "UNKNOWN"} {
		t.Run(state, func(t *testing.T) {
			current := original
			current.ParseStatus = state
			err := svc.acceptFileStorageCreation(ds, item, &current)
			if state == types.ParseStatusFailed || state == "UNKNOWN" {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
			}
		})
	}
	for name, change := range map[string]func(*types.Knowledge){
		"another-native-id":     func(k *types.Knowledge) { k.ID = uuid.NewString() },
		"another-tenant":        func(k *types.Knowledge) { k.TenantID++ },
		"another-kb":            func(k *types.Knowledge) { k.KnowledgeBaseID = uuid.NewString() },
		"another-content-group": func(k *types.Knowledge) { k.FileHash = "another-hash" },
		"another-size":          func(k *types.Knowledge) { k.FileSize++ },
		"missing-revision":      func(k *types.Knowledge) { k.UpdatedAt = time.Time{} },
		"future-revision":       func(k *types.Knowledge) { k.UpdatedAt = time.Now().Add(time.Hour) },
		"missing-provenance":    func(k *types.Knowledge) { k.Metadata = nil },
	} {
		t.Run(name, func(t *testing.T) {
			current := original
			current.ParseStatus = types.ParseStatusPending
			change(&current)
			require.Error(t, svc.acceptFileStorageCreation(ds, item, &current))
		})
	}
}

func TestFileStorageDataSourceRejectsDifferentControlledScope(t *testing.T) {
	for _, operation := range []string{"create", "edit", "edit-omitted-type-and-config"} {
		for _, state := range []string{"matching", "different-knowledge-base", "different-tenant", "missing-configuration", "missing-transport"} {
			t.Run(operation+"/"+state, func(t *testing.T) {
				blob, err := (&types.DataSourceConfig{ResourceIDs: []string{uuid.NewString()}}).ToJSON()
				require.NoError(t, err)
				ds := &types.DataSource{ID: uuid.NewString(), TenantID: 1, KnowledgeBaseID: uuid.NewString(),
					Type: fileStorageConnectorType, Status: types.DataSourceStatusPaused, Config: blob}
				cfg := &config.FileStorageSyncConfig{NativeTenantID: ds.TenantID, NativeKnowledgeBaseID: ds.KnowledgeBaseID}
				switch state {
				case "different-knowledge-base":
					cfg.NativeKnowledgeBaseID = uuid.NewString()
				case "different-tenant":
					cfg.NativeTenantID++
				case "missing-configuration":
					cfg = nil
				}
				connector := &fileStorageConnector{transport: &fileStorageTransport{config: cfg}}
				if state == "missing-transport" {
					connector.transport = nil
				}
				registry := datasource.NewConnectorRegistry()
				require.NoError(t, registry.Register(connector))
				repo := &fileStorageConfigRepository{kbDeleteDSRepo: newKBDeleteDSRepo(ds.KnowledgeBaseID, ds)}
				svc := &DataSourceService{dsRepo: repo, connectorRegistry: registry,
					kbService: &processSyncKBService{kb: &types.KnowledgeBase{ID: ds.KnowledgeBaseID, TenantID: ds.TenantID}},
					scheduler: datasource.NewScheduler(repo, nil, nil)}
				defer svc.scheduler.Stop()
				next := *ds
				var result *types.DataSource
				if operation == "create" {
					result, err = svc.CreateDataSource(context.Background(), &next)
				} else {
					if operation == "edit-omitted-type-and-config" {
						next.Type, next.Config = "", nil
					}
					result, err = svc.UpdateDataSource(context.Background(), &next)
				}
				if state == "matching" {
					require.NoError(t, err)
					require.Same(t, &next, result)
					require.Equal(t, 1, repo.writes)
				} else {
					require.Error(t, err)
					require.Nil(t, result)
					require.Zero(t, repo.writes, "wrong binding must not be saved or scheduled")
				}
				require.Equal(t, blob, ds.Config)
			})
		}
	}
}

func (s *processSyncKBService) CreateKnowledgeBase(context.Context, *types.KnowledgeBase) (*types.KnowledgeBase, error) {
	return nil, nil
}

func (s *processSyncKBService) GetKnowledgeBaseByID(context.Context, string) (*types.KnowledgeBase, error) {
	return s.kb, s.getErr
}

func (s *processSyncKBService) GetKnowledgeBaseByIDOnly(context.Context, string) (*types.KnowledgeBase, error) {
	return s.kb, s.getErr
}

func (s *processSyncKBService) GetKnowledgeBasesByIDsOnly(context.Context, []string) ([]*types.KnowledgeBase, error) {
	return nil, nil
}

func (s *processSyncKBService) FillKnowledgeBaseCounts(context.Context, *types.KnowledgeBase) error {
	return nil
}

func (s *processSyncKBService) ListKnowledgeBases(context.Context) ([]*types.KnowledgeBase, error) {
	return nil, nil
}

func (s *processSyncKBService) ListKnowledgeBasesByTenantID(context.Context, uint64) ([]*types.KnowledgeBase, error) {
	return nil, nil
}

func (s *processSyncKBService) UpdateKnowledgeBase(
	context.Context, string, string, string, *types.KnowledgeBaseConfig,
) (*types.KnowledgeBase, error) {
	return nil, nil
}
func (s *processSyncKBService) DeleteKnowledgeBase(context.Context, string) error { return nil }
func (s *processSyncKBService) TogglePinKnowledgeBase(context.Context, string) (*types.KnowledgeBase, error) {
	return nil, nil
}

func (s *processSyncKBService) HybridSearch(context.Context, string, types.SearchParams) ([]*types.SearchResult, error) {
	return nil, nil
}

func (s *processSyncKBService) GetQueryEmbedding(context.Context, string, string) ([]float32, error) {
	return nil, nil
}

func (s *processSyncKBService) ResolveEmbeddingModelKeys(context.Context, []*types.KnowledgeBase) map[string]string {
	return nil
}

func (s *processSyncKBService) CopyKnowledgeBase(context.Context, string, string) (*types.KnowledgeBase, *types.KnowledgeBase, error) {
	return nil, nil, nil
}

func (s *processSyncKBService) DuplicateKnowledgeBase(context.Context, string) (*types.KnowledgeBase, error) {
	return nil, nil
}
func (s *processSyncKBService) GetRepository() interfaces.KnowledgeBaseRepository { return nil }
func (s *processSyncKBService) ProcessKBDelete(context.Context, *asynq.Task) error {
	return nil
}

var _ interfaces.KnowledgeBaseService = (*processSyncKBService)(nil)

type processSyncSyncLogRepo struct {
	interfaces.SyncLogRepository
	logs      map[string]*types.SyncLog
	readErr   error
	updateErr error
	writes    int
}

func (r *processSyncSyncLogRepo) Create(_ context.Context, log *types.SyncLog) error {
	r.logs[log.ID] = log
	return nil
}

func (r *processSyncSyncLogRepo) FindByID(_ context.Context, id string) (*types.SyncLog, error) {
	if r.readErr != nil {
		return nil, r.readErr
	}
	log, ok := r.logs[id]
	if !ok {
		return nil, errors.New("sync log not found")
	}
	return log, nil
}

func (r *processSyncSyncLogRepo) FindByDataSource(context.Context, string, int, int) ([]*types.SyncLog, error) {
	return nil, nil
}

func (r *processSyncSyncLogRepo) FindLatest(context.Context, string) (*types.SyncLog, error) {
	return nil, nil
}

func (r *processSyncSyncLogRepo) HasRunningSync(context.Context, string) (bool, error) {
	return false, nil
}

func (r *processSyncSyncLogRepo) Update(_ context.Context, log *types.SyncLog) error {
	r.writes++
	if r.updateErr != nil {
		return r.updateErr
	}
	r.logs[log.ID] = log
	return nil
}

func (r *processSyncSyncLogRepo) UpdateResult(_ context.Context, log *types.SyncLog) error {
	return r.Update(context.Background(), log)
}

func (r *processSyncSyncLogRepo) CancelPendingByDataSource(context.Context, string) error {
	return nil
}
func (r *processSyncSyncLogRepo) CleanupOldLogs(context.Context, int) error { return nil }

type processSyncReadDSRepo struct {
	interfaces.DataSourceRepository
	ds    *types.DataSource
	err   error
	reads int
}

func (r *processSyncReadDSRepo) FindByID(context.Context, string) (*types.DataSource, error) {
	r.reads++
	return r.ds, r.err
}

func TestProcessSyncRequiresOriginalRunAndConfirmedDeletion(t *testing.T) {
	for _, scenario := range []string{"source-missing", "source-missing-wrapped", "source-read-unavailable", "log-read-unavailable",
		"log-missing", "log-null", "log-other-id", "log-other-source", "log-other-tenant", "source-null", "source-other-id", "source-other-tenant",
		"kb-read-unavailable", "kb-missing", "kb-missing-wrapped", "kb-null", "kb-other-id", "source-cancel-save-unavailable", "kb-cancel-save-unavailable"} {
		t.Run(scenario, func(t *testing.T) {
			ds := &types.DataSource{ID: "source-original", TenantID: 1, KnowledgeBaseID: "kb-original",
				LastSyncCursor: types.JSON(`{"original":"retained"}`)}
			original := &types.SyncLog{ID: "log-original", DataSourceID: ds.ID, TenantID: ds.TenantID,
				Status: types.SyncLogStatusRunning, Result: types.JSON(`{"original":"retained"}`)}
			dsRepo := &processSyncReadDSRepo{ds: ds}
			logRepo := &processSyncSyncLogRepo{logs: map[string]*types.SyncLog{original.ID: original}}
			kbSvc := &processSyncKBService{kb: &types.KnowledgeBase{ID: ds.KnowledgeBaseID, TenantID: ds.TenantID}}
			unavailable := errors.New("store temporarily unavailable")
			confirmed := scenario == "source-missing" || scenario == "source-missing-wrapped" || scenario == "kb-missing" || scenario == "kb-missing-wrapped"
			switch scenario {
			case "source-missing", "source-cancel-save-unavailable":
				dsRepo.err = datasource.ErrDataSourceNotFound
			case "source-missing-wrapped":
				dsRepo.err = fmt.Errorf("native read: %w", datasource.ErrDataSourceNotFound)
			case "source-read-unavailable":
				dsRepo.err = unavailable
			case "log-read-unavailable":
				logRepo.readErr = unavailable
			case "log-missing":
				logRepo.readErr = datasource.ErrSyncLogNotFound
			case "log-null":
				logRepo.logs[original.ID] = nil
			case "log-other-id":
				original.ID = "log-other"
			case "log-other-source":
				original.DataSourceID = "source-other"
			case "log-other-tenant":
				original.TenantID++
			case "source-null":
				dsRepo.ds = nil
			case "source-other-id":
				ds.ID = "source-other"
			case "source-other-tenant":
				ds.TenantID++
			case "kb-read-unavailable":
				kbSvc.getErr = unavailable
			case "kb-missing", "kb-cancel-save-unavailable":
				kbSvc.getErr = apprepo.ErrKnowledgeBaseNotFound
			case "kb-missing-wrapped":
				kbSvc.getErr = fmt.Errorf("native read: %w", apprepo.ErrKnowledgeBaseNotFound)
			case "kb-null":
				kbSvc.kb = nil
			case "kb-other-id":
				kbSvc.kb.ID = "kb-other"
			}
			if strings.Contains(scenario, "cancel-save") {
				logRepo.updateErr = unavailable
			}
			before := *original
			cursor := string(ds.LastSyncCursor)
			payload, err := json.Marshal(types.DataSourceSyncPayload{DataSourceID: "source-original", SyncLogID: "log-original", TenantID: 1})
			require.NoError(t, err)
			svc := &DataSourceService{dsRepo: dsRepo, syncLogRepo: logRepo, kbService: kbSvc}
			err = svc.ProcessSync(context.Background(), asynq.NewTask(types.TypeDataSourceSync, payload))
			if confirmed {
				require.NoError(t, err)
				require.Equal(t, 1, logRepo.writes)
				stored := logRepo.logs["log-original"]
				require.Equal(t, types.SyncLogStatusCanceled, stored.Status)
				require.NotNil(t, stored.FinishedAt)
				require.Equal(t, before.Result, stored.Result)
			} else {
				require.Error(t, err)
				if strings.Contains(scenario, "unavailable") {
					require.ErrorIs(t, err, unavailable)
				} else if scenario == "log-missing" {
					require.ErrorIs(t, err, datasource.ErrSyncLogNotFound)
				} else {
					require.ErrorIs(t, err, asynq.SkipRetry)
				}
				writes := 0
				if strings.Contains(scenario, "cancel-save") {
					writes = 1
				}
				require.Equal(t, writes, logRepo.writes)
			}
			require.Equal(t, before, *original, "unconfirmed writes cannot mutate retained run evidence in memory")
			require.Equal(t, cursor, string(ds.LastSyncCursor))
		})
	}
}

func TestProcessSyncObservesOnlyConfirmedTerminalRun(t *testing.T) {
	for _, status := range []string{types.SyncLogStatusSuccess, types.SyncLogStatusCanceled} {
		for _, scenario := range []string{"confirmed", "source-deleted", "source-unavailable", "missing-finish", "zero-finish",
			"missing-start", "finish-before-start", "future-finish", "wrong-tenant", "wrong-source", "wrong-log", "missing-tenant", "log-read-unavailable"} {
			t.Run(status+"/"+scenario, func(t *testing.T) {
				started := time.Now().Add(-time.Minute).UTC()
				finished := started.Add(time.Second)
				original := &types.SyncLog{ID: "original-log", DataSourceID: "original-source", TenantID: 1,
					Status: status, StartedAt: started, FinishedAt: &finished,
					ItemsTotal: 7, ItemsCreated: 3, ItemsUpdated: 2, ItemsDeleted: 1, ItemsSkipped: 1,
					ErrorMessage: "original observation", Result: types.JSON(`{"original":"retained"}`)}
				payload := types.DataSourceSyncPayload{DataSourceID: original.DataSourceID, SyncLogID: original.ID, TenantID: original.TenantID}
				source := &processSyncReadDSRepo{err: errors.New("current source is unavailable")}
				logs := &processSyncSyncLogRepo{logs: map[string]*types.SyncLog{original.ID: original}}
				confirmed := scenario == "confirmed" || scenario == "source-deleted" || scenario == "source-unavailable"
				switch scenario {
				case "source-deleted":
					source.err = datasource.ErrDataSourceNotFound
				case "missing-finish":
					original.FinishedAt = nil
				case "zero-finish":
					original.FinishedAt = timePtr(time.Time{})
				case "missing-start":
					original.StartedAt = time.Time{}
				case "finish-before-start":
					original.FinishedAt = timePtr(started.Add(-time.Second))
				case "future-finish":
					original.FinishedAt = timePtr(time.Now().Add(time.Hour))
				case "wrong-tenant":
					payload.TenantID++
				case "wrong-source":
					payload.DataSourceID = "another-source"
				case "wrong-log":
					original.ID = "another-log"
				case "missing-tenant":
					payload.TenantID = 0
				case "log-read-unavailable":
					logs.readErr = errors.New("original log is unavailable")
				}
				before := *original
				raw, err := json.Marshal(payload)
				require.NoError(t, err)
				svc := &DataSourceService{dsRepo: source, syncLogRepo: logs}
				err = svc.ProcessSync(context.Background(), asynq.NewTask(types.TypeDataSourceSync, raw))
				if confirmed {
					require.NoError(t, err, "trusted native terminal evidence does not depend on new source access")
				} else if logs.readErr != nil {
					require.ErrorIs(t, err, logs.readErr)
				} else {
					require.ErrorIs(t, err, asynq.SkipRetry, "missing evidence or a mismatched run cannot acknowledge completion")
				}
				require.Zero(t, source.reads, "terminal observation must not reenter current source configuration")
				require.Zero(t, logs.writes)
				require.Equal(t, before, *original, "retain the exact original finish time, counts and result")
			})
		}
	}
}

func TestProcessSyncPreservesNonterminalRetryAndRejectsUnknownState(t *testing.T) {
	for _, status := range []string{types.SyncLogStatusRunning, types.SyncLogStatusFailed, types.SyncLogStatusPartial, "", "unknown-native-state"} {
		t.Run(status, func(t *testing.T) {
			original := &types.SyncLog{ID: "original-log", DataSourceID: "original-source", TenantID: 1, Status: status}
			sourceUnavailable := errors.New("source is unavailable")
			source := &processSyncReadDSRepo{err: sourceUnavailable}
			logs := &processSyncSyncLogRepo{logs: map[string]*types.SyncLog{original.ID: original}}
			svc := &DataSourceService{dsRepo: source, syncLogRepo: logs}
			raw, err := json.Marshal(types.DataSourceSyncPayload{DataSourceID: original.DataSourceID, SyncLogID: original.ID, TenantID: original.TenantID})
			require.NoError(t, err)
			err = svc.ProcessSync(context.Background(), asynq.NewTask(types.TypeDataSourceSync, raw))
			if status == "" || status == "unknown-native-state" {
				require.ErrorIs(t, err, asynq.SkipRetry)
				require.Zero(t, source.reads)
			} else {
				require.ErrorIs(t, err, sourceUnavailable)
				require.NotErrorIs(t, err, asynq.SkipRetry, "original native retries must remain available")
				require.Equal(t, 1, source.reads)
			}
			require.Equal(t, status, original.Status)
			require.Nil(t, original.FinishedAt)
			require.Zero(t, logs.writes)
		})
	}
}

func TestProcessSyncTerminalReplayDoesNotRepeatStreaming(t *testing.T) {
	for _, status := range []string{types.SyncLogStatusSuccess, types.SyncLogStatusCanceled} {
		t.Run(status, func(t *testing.T) {
			h := newSyncDeletionHarness(t, true, "original-source", "original-log", nil, nil)
			connector := &recordingFullStreamConnector{}
			h.svc.connectorRegistry = datasource.NewConnectorRegistry()
			require.NoError(t, h.svc.connectorRegistry.Register(connector))
			h.ds.Type = connector.Type()
			h.ds.LastSyncCursor = makeConnectorCursor(t, map[string]map[string]string{"original-source": {"file": "original-revision"}})
			source := &recordingDSRepo{kbDeleteDSRepo: *newKBDeleteDSRepo(h.ds.KnowledgeBaseID, h.ds)}
			h.svc.dsRepo = source
			original := h.syncLogRepo.logs[h.syncLogID]
			original.Status = status
			original.StartedAt = time.Now().Add(-time.Minute).UTC()
			original.FinishedAt = timePtr(original.StartedAt.Add(time.Second))
			original.ItemsTotal, original.ItemsCreated = 7, 7
			original.Result = types.JSON(`{"original":"retained"}`)
			before := *original
			cursor := string(h.ds.LastSyncCursor)
			_, err := h.run(t)
			require.NoError(t, err)
			require.False(t, connector.streamCalled)
			require.False(t, connector.fullCalled, "redelivery cannot enumerate or consume the original stream again")
			require.Empty(t, h.knowledgeRepo.metadataUpdates)
			require.Empty(t, h.knowledgeRepo.externalID)
			require.Empty(t, h.knowledgeRepo.hardDeleted)
			require.Empty(t, source.updated, "no ingestion checkpoint or final cursor may be written")
			require.Zero(t, h.syncLogRepo.writes)
			require.Equal(t, before, *original)
			require.Equal(t, cursor, string(h.ds.LastSyncCursor))
		})
	}
}

func TestAllFetchedItemsFailedError(t *testing.T) {
	err := allFetchedItemsFailedError(&types.SyncResult{
		Total:  2,
		Failed: 2,
		Errors: []types.SyncItemError{{Message: "doc one: export failed"}},
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "all fetched items failed during sync (2/2)")
	assert.Contains(t, err.Error(), "doc one: export failed")
}

func TestAllFetchedItemsFailedErrorIgnoresPartialFailure(t *testing.T) {
	err := allFetchedItemsFailedError(&types.SyncResult{
		Total:   3,
		Created: 1,
		Failed:  2,
	})
	require.NoError(t, err)
}

func TestAllFetchedItemsFailedErrorIgnoresSkippedItems(t *testing.T) {
	err := allFetchedItemsFailedError(&types.SyncResult{
		Total:   3,
		Skipped: 3,
	})
	require.NoError(t, err)
}

func TestAllFetchedItemsFailedErrorTruncatesLongDetail(t *testing.T) {
	err := allFetchedItemsFailedError(&types.SyncResult{
		Total:  1,
		Failed: 1,
		Errors: []types.SyncItemError{{Message: strings.Repeat("x", 600)}},
	})
	require.Error(t, err)
	assert.LessOrEqual(t, len(err.Error()), 560)
	assert.Contains(t, err.Error(), "...")
}

const deletedItemConnectorType = "test-sync-deletion"

type deletedItemConnector struct{}

func (deletedItemConnector) Type() string { return deletedItemConnectorType }
func (deletedItemConnector) Validate(context.Context, *types.DataSourceConfig) error {
	return nil
}

func (deletedItemConnector) ListResources(context.Context, *types.DataSourceConfig, string) ([]types.Resource, error) {
	return nil, nil
}

func (deletedItemConnector) ResolveResourceAncestors(
	context.Context, *types.DataSourceConfig, []string,
) ([]string, error) {
	return nil, nil
}

func (deletedItemConnector) FetchAll(context.Context, *types.DataSourceConfig, []string) ([]types.FetchedItem, error) {
	return []types.FetchedItem{{
		ExternalID:       "file:gone",
		SourceResourceID: "folder:1",
		IsDeleted:        true,
	}}, nil
}

func (deletedItemConnector) FetchIncremental(
	context.Context, *types.DataSourceConfig, *types.SyncCursor,
) ([]types.FetchedItem, *types.SyncCursor, error) {
	items, err := (deletedItemConnector{}).FetchAll(context.Background(), nil, nil)
	return items, nil, err
}

type processSyncTenantRepo struct {
	interfaces.TenantRepository
	tenant *types.Tenant
}

func (r *processSyncTenantRepo) GetTenantByID(context.Context, uint64) (*types.Tenant, error) {
	return r.tenant, nil
}

type processSyncTagService struct {
	interfaces.KnowledgeTagService
	ctx context.Context
}

func (s *processSyncTagService) FindOrCreateTagByName(
	ctx context.Context,
	_ string,
	_ string,
) (*types.KnowledgeTag, error) {
	s.ctx = ctx
	return nil, nil
}

type deletionLookupKnowledgeRepo struct {
	interfaces.KnowledgeRepository
	knowledge         *types.Knowledge
	lookupErr         error
	metadataUpdates   []map[string]string // metadata persisted via UpdateKnowledge
	metadataUpdateErr error
	hardDeleted       []string
	hardDeleteErr     error
	tenantID          uint64
	knowledgeBaseID   string
	dataSourceID      string
	externalID        string
}

func (r *deletionLookupKnowledgeRepo) UpdateKnowledge(_ context.Context, knowledge *types.Knowledge) error {
	if r.metadataUpdateErr != nil {
		return r.metadataUpdateErr
	}
	metadata := map[string]string{}
	if len(knowledge.Metadata) > 0 {
		if err := json.Unmarshal(knowledge.Metadata, &metadata); err != nil {
			return err
		}
	}
	r.metadataUpdates = append(r.metadataUpdates, metadata)
	return nil
}

func (r *deletionLookupKnowledgeRepo) FindByDataSourceExternalID(
	_ context.Context, tenantID uint64, knowledgeBaseID, dataSourceID, externalID string,
) (*types.Knowledge, error) {
	if r.lookupErr != nil {
		return nil, r.lookupErr
	}
	r.tenantID = tenantID
	r.knowledgeBaseID = knowledgeBaseID
	r.dataSourceID = dataSourceID
	r.externalID = externalID
	return r.knowledge, nil
}

func (r *deletionLookupKnowledgeRepo) HardDeleteKnowledge(_ context.Context, _ uint64, id string) error {
	if r.hardDeleteErr != nil {
		return r.hardDeleteErr
	}
	r.hardDeleted = append(r.hardDeleted, id)
	return nil
}

func (r *deletionLookupKnowledgeRepo) HardDeleteKnowledgeList(_ context.Context, _ uint64, ids []string) error {
	for _, id := range ids {
		if err := r.HardDeleteKnowledge(context.Background(), 0, id); err != nil {
			return err
		}
	}
	return nil
}

// scopedDeletionRepo models two data sources sharing the same external_id.
type scopedDeletionRepo struct {
	interfaces.KnowledgeRepository
	live        map[string]*types.Knowledge
	hardDeleted []string
}

func (r *scopedDeletionRepo) FindByDataSourceExternalID(
	_ context.Context, _ uint64, _, dataSourceID, externalID string,
) (*types.Knowledge, error) {
	if r.live == nil {
		return nil, nil
	}
	return r.live[dataSourceID+"|"+externalID], nil
}

func (r *scopedDeletionRepo) HardDeleteKnowledge(_ context.Context, _ uint64, id string) error {
	r.hardDeleted = append(r.hardDeleted, id)
	return nil
}

func (r *scopedDeletionRepo) HardDeleteKnowledgeList(_ context.Context, _ uint64, ids []string) error {
	r.hardDeleted = append(r.hardDeleted, ids...)
	return nil
}

// keyedDeletionRepo maps external_id to live knowledge for multi-item sync tests.
type keyedDeletionRepo struct {
	interfaces.KnowledgeRepository
	items         map[string]*types.Knowledge
	hardDeleted   []string
	hardDeleteErr error
}

func (r *keyedDeletionRepo) FindByDataSourceExternalID(
	_ context.Context, _ uint64, _, _, externalID string,
) (*types.Knowledge, error) {
	if r.items == nil {
		return nil, nil
	}
	return r.items[externalID], nil
}

func (r *keyedDeletionRepo) HardDeleteKnowledge(_ context.Context, _ uint64, id string) error {
	if r.hardDeleteErr != nil {
		return r.hardDeleteErr
	}
	r.hardDeleted = append(r.hardDeleted, id)
	return nil
}

func (r *keyedDeletionRepo) HardDeleteKnowledgeList(_ context.Context, _ uint64, ids []string) error {
	for _, id := range ids {
		if err := r.HardDeleteKnowledge(context.Background(), 0, id); err != nil {
			return err
		}
	}
	return nil
}

// syncDeletionHarness wires a DataSourceService around a connector that always
// reports one deleted item, with overridable lookup/delete fakes.
type syncDeletionHarness struct {
	ds            *types.DataSource
	syncLogID     string
	syncLogRepo   *processSyncSyncLogRepo
	knowledgeRepo *deletionLookupKnowledgeRepo
	knowledgeSvc  *sweepFakeKS
	svc           *DataSourceService
}

// newSyncDeletionHarness builds a full-sync ProcessSync fixture. Passing nil
// for repo/ks selects the happy-path defaults: an existing knowledge item and
// no lookup/delete errors.
func newSyncDeletionHarness(
	t *testing.T, syncDeletions bool, dsID, logID string,
	repo *deletionLookupKnowledgeRepo, ks *sweepFakeKS,
) *syncDeletionHarness {
	t.Helper()
	configJSON, err := (&types.DataSourceConfig{Type: deletedItemConnectorType}).ToJSON()
	require.NoError(t, err)

	ds := &types.DataSource{
		ID:              dsID,
		TenantID:        1,
		KnowledgeBaseID: "kb-1",
		Name:            "Sync Deletion",
		Type:            deletedItemConnectorType,
		Config:          configJSON,
		SyncMode:        types.SyncModeFull,
		Status:          types.DataSourceStatusActive,
		SyncDeletions:   syncDeletions,
	}
	syncLog := &types.SyncLog{
		ID:           logID,
		DataSourceID: ds.ID,
		TenantID:     ds.TenantID,
		Status:       types.SyncLogStatusRunning,
		StartedAt:    time.Now().UTC(),
	}
	if repo == nil {
		repo = &deletionLookupKnowledgeRepo{knowledge: &types.Knowledge{ID: "knowledge-gone"}}
	}
	if ks == nil {
		ks = &sweepFakeKS{repo: repo}
	}
	syncLogRepo := &processSyncSyncLogRepo{logs: map[string]*types.SyncLog{syncLog.ID: syncLog}}
	registry := datasource.NewConnectorRegistry()
	require.NoError(t, registry.Register(deletedItemConnector{}))

	return &syncDeletionHarness{
		ds:            ds,
		syncLogID:     syncLog.ID,
		syncLogRepo:   syncLogRepo,
		knowledgeRepo: repo,
		knowledgeSvc:  ks,
		svc: &DataSourceService{
			dsRepo:            newKBDeleteDSRepo(ds.KnowledgeBaseID, ds),
			syncLogRepo:       syncLogRepo,
			knowledgeService:  ks,
			kbService:         &processSyncKBService{kb: &types.KnowledgeBase{ID: ds.KnowledgeBaseID, TenantID: ds.TenantID}},
			connectorRegistry: registry,
			tenantRepo:        &processSyncTenantRepo{tenant: &types.Tenant{ID: ds.TenantID}},
			tagService:        &processSyncTagService{},
		},
	}
}

// run executes a full sync and returns the persisted sync log plus the error
// ProcessSync returned (non-nil when every fetched item failed).
func (h *syncDeletionHarness) run(t *testing.T) (*types.SyncLog, error) {
	t.Helper()
	payload, err := json.Marshal(types.DataSourceSyncPayload{
		DataSourceID: h.ds.ID,
		TenantID:     h.ds.TenantID,
		SyncLogID:    h.syncLogID,
		ForceFull:    true,
	})
	require.NoError(t, err)
	err = h.svc.ProcessSync(context.Background(), asynq.NewTask(types.TypeDataSourceSync, payload))

	updated := h.syncLogRepo.logs[h.syncLogID]
	require.NotNil(t, updated)
	return updated, err
}

// deletionFailedCount extracts the SyncResult.deletion_failed counter without
// referencing the SyncResult type, so these tests stay independent of the
// field's commit.
func deletionFailedCount(t *testing.T, log *types.SyncLog) int {
	t.Helper()
	var counters struct {
		DeletionFailed int `json:"deletion_failed"`
	}
	require.NoError(t, json.Unmarshal(log.Result, &counters))
	return counters.DeletionFailed
}

// TestProcessSync_SyncDeletionsDeletesMatchingKnowledge verifies that a
// deleted source item removes the matching KB knowledge (counted as Deleted),
// and that the lookup is scoped to tenant, KB, data source and external ID.
// TestIngestItem_URLCreationAttachesDataSourceMetadata verifies that a
// URL-only item gets its datasource scoping keys attached right after
// creation, so a later source-side deletion can find it via
// FindByDataSourceExternalID (CreateKnowledgeFromURL itself persists no
// metadata).
func TestIngestItem_URLCreationAttachesDataSourceMetadata(t *testing.T) {
	ds := &types.DataSource{ID: "ds-1", TenantID: 1, KnowledgeBaseID: "kb-1"}
	repo := &deletionLookupKnowledgeRepo{}
	ks := &sweepFakeKS{repo: repo, createURLKnowledge: &types.Knowledge{ID: "url-knowledge-1"}}
	svc := &DataSourceService{knowledgeService: ks}

	isUpdate, err := svc.ingestItem(context.Background(), ds, &types.FetchedItem{
		ExternalID: "url:1",
		URL:        "https://example.com/doc",
	}, nil)
	require.NoError(t, err)
	assert.False(t, isUpdate)
	require.Len(t, repo.metadataUpdates, 1)
	assert.Equal(t, ds.ID, repo.metadataUpdates[0]["datasource_id"])
	assert.Equal(t, "url:1", repo.metadataUpdates[0]["external_id"])
}

// TestIngestItem_PersistsSourceUpdatedAt verifies that the connector-supplied
// last-modified time reaches the persisted metadata as an RFC3339 UTC string,
// and that an item without one gets no key rather than a zero time.
func TestIngestItem_PersistsSourceUpdatedAt(t *testing.T) {
	ds := &types.DataSource{ID: "ds-1", TenantID: 1, KnowledgeBaseID: "kb-1"}
	edited := time.Date(2023, 4, 5, 6, 7, 8, 0, time.FixedZone("CST", 8*3600))

	repo := &deletionLookupKnowledgeRepo{}
	ks := &sweepFakeKS{repo: repo, createURLKnowledge: &types.Knowledge{ID: "url-knowledge-1"}}
	svc := &DataSourceService{knowledgeService: ks}
	created := time.Date(2021, 1, 2, 3, 4, 5, 0, time.UTC)
	_, err := svc.ingestItem(context.Background(), ds, &types.FetchedItem{
		ExternalID: "url:1",
		URL:        "https://example.com/doc",
		UpdatedAt:  edited,
		CreatedAt:  created,
	}, nil)
	require.NoError(t, err)
	require.Len(t, repo.metadataUpdates, 1)
	assert.Equal(t, "2023-04-04T22:07:08Z", repo.metadataUpdates[0]["source_updated_at"])
	assert.Equal(t, "2021-01-02T03:04:05Z", repo.metadataUpdates[0]["source_created_at"])

	repo = &deletionLookupKnowledgeRepo{}
	ks = &sweepFakeKS{repo: repo, createURLKnowledge: &types.Knowledge{ID: "url-knowledge-2"}}
	svc = &DataSourceService{knowledgeService: ks}
	_, err = svc.ingestItem(context.Background(), ds, &types.FetchedItem{
		ExternalID: "url:2",
		URL:        "https://example.com/doc2",
	}, nil)
	require.NoError(t, err)
	require.Len(t, repo.metadataUpdates, 1)
	_, present := repo.metadataUpdates[0]["source_updated_at"]
	assert.False(t, present)
	_, present = repo.metadataUpdates[0]["source_created_at"]
	assert.False(t, present)
}

func TestProcessSync_SyncDeletionsDeletesMatchingKnowledge(t *testing.T) {
	h := newSyncDeletionHarness(t, true, "ds-delete-characterization", "log-delete-characterization", nil, nil)
	updated, err := h.run(t)
	require.NoError(t, err)

	assert.Equal(t, 1, updated.ItemsDeleted)
	assert.Equal(t, []string{"knowledge-gone"}, h.knowledgeSvc.deleted)
	assert.Equal(t, h.ds.TenantID, h.knowledgeRepo.tenantID)
	assert.Equal(t, h.ds.KnowledgeBaseID, h.knowledgeRepo.knowledgeBaseID)
	assert.Equal(t, h.ds.ID, h.knowledgeRepo.dataSourceID)
	assert.Equal(t, "file:gone", h.knowledgeRepo.externalID)
}

// TestProcessSync_SyncDeletionsDisabledSkipsDeletion verifies that with
// SyncDeletions off the item is neither deleted nor counted (Deleted=0,
// Skipped=0, no DeleteKnowledge call).
func TestProcessSync_SyncDeletionsDisabledSkipsDeletion(t *testing.T) {
	h := newSyncDeletionHarness(t, false, "ds-delete-disabled", "log-delete-disabled", nil, nil)
	updated, err := h.run(t)
	require.NoError(t, err)

	assert.Empty(t, h.knowledgeSvc.deleted)
	assert.Equal(t, 0, updated.ItemsDeleted)
	assert.Equal(t, 0, updated.ItemsSkipped)
}

// TestProcessSync_SyncDeletionsAlreadyGoneCountsSkipped verifies the
// idempotent path: the source item reports deletion but no KB knowledge
// matches, so the item counts as Skipped and nothing is deleted.
func TestProcessSync_SyncDeletionsAlreadyGoneCountsSkipped(t *testing.T) {
	h := newSyncDeletionHarness(t, true, "ds-delete-gone", "log-delete-gone", &deletionLookupKnowledgeRepo{}, nil)
	updated, err := h.run(t)
	require.NoError(t, err)

	assert.Empty(t, h.knowledgeSvc.deleted)
	assert.Equal(t, 0, updated.ItemsDeleted)
	assert.Equal(t, 1, updated.ItemsSkipped)
}

// TestProcessSync_SyncDeletionsLookupFailureCountsFailed verifies that a
// failing scoped lookup surfaces as a Failed item with the
// deletion_lookup_failed code, increments DeletionFailed, and never calls
// DeleteKnowledge.
func TestProcessSync_SyncDeletionsLookupFailureCountsFailed(t *testing.T) {
	repo := &deletionLookupKnowledgeRepo{lookupErr: errors.New("lookup failed")}
	h := newSyncDeletionHarness(t, true, "ds-delete-lookup-fail", "log-delete-lookup-fail", repo, nil)
	updated, err := h.run(t)
	require.Error(t, err)

	assert.Empty(t, h.knowledgeSvc.deleted)
	assert.Equal(t, 0, updated.ItemsDeleted)
	assert.Equal(t, 1, updated.ItemsFailed)
	result, err := updated.ParseResult()
	require.NoError(t, err)
	require.Len(t, result.Errors, 1)
	assert.Equal(t, "deletion_lookup_failed", result.Errors[0].Code)
	assert.Equal(t, 1, deletionFailedCount(t, updated))
}

// TestProcessSync_SyncDeletionsDeleteFailureCountsFailed verifies that a
// failing DeleteKnowledge call surfaces as a Failed item with the
// deletion_failed code and increments DeletionFailed without counting
// the item as Deleted.
func TestProcessSync_SyncDeletionsDeleteFailureCountsFailed(t *testing.T) {
	h := newSyncDeletionHarness(t, true, "ds-delete-fail", "log-delete-fail", nil, nil)
	h.knowledgeSvc.deleteErr = errors.New("delete failed")
	updated, err := h.run(t)
	require.Error(t, err)

	assert.Equal(t, []string{"knowledge-gone"}, h.knowledgeSvc.deleted)
	assert.Equal(t, 0, updated.ItemsDeleted)
	assert.Equal(t, 1, updated.ItemsFailed)
	result, err := updated.ParseResult()
	require.NoError(t, err)
	require.Len(t, result.Errors, 1)
	assert.Equal(t, "deletion_failed", result.Errors[0].Code)
	assert.Equal(t, 1, deletionFailedCount(t, updated))
}

func TestProcessSync_SyncDeletionsHardDeletesRow(t *testing.T) {
	h := newSyncDeletionHarness(t, true, "ds-delete-hard", "log-delete-hard", nil, nil)
	updated, err := h.run(t)
	require.NoError(t, err)

	assert.Equal(t, 1, updated.ItemsDeleted)
	assert.Equal(t, []string{"knowledge-gone"}, h.knowledgeSvc.deleted)
	assert.Equal(t, []string{"knowledge-gone"}, h.knowledgeRepo.hardDeleted)
}

func TestApplyFetchedItem_SyncDeletionScopedPerDataSource(t *testing.T) {
	repo := &scopedDeletionRepo{live: map[string]*types.Knowledge{
		"ds-a|file:shared": {ID: "knowledge-a"},
		"ds-b|file:shared": {ID: "knowledge-b"},
	}}
	ks := &sweepFakeKS{repo: repo}
	svc := &DataSourceService{knowledgeService: ks}

	result := &types.SyncResult{}
	dsA := &types.DataSource{
		ID: "ds-a", TenantID: 1, KnowledgeBaseID: "kb-1", SyncDeletions: true,
	}
	svc.applyFetchedItem(context.Background(), dsA, &types.FetchedItem{
		ExternalID: "file:shared",
		IsDeleted:  true,
	}, nil, result)

	assert.Equal(t, 1, result.Deleted)
	assert.Equal(t, []string{"knowledge-a"}, ks.deleted)
	assert.Equal(t, []string{"knowledge-a"}, repo.hardDeleted)
	assert.NotContains(t, ks.deleted, "knowledge-b")
}

type mixedSyncConnector struct{}

func (mixedSyncConnector) Type() string { return "test-sync-mixed" }
func (mixedSyncConnector) Validate(context.Context, *types.DataSourceConfig) error {
	return nil
}

func (mixedSyncConnector) ListResources(context.Context, *types.DataSourceConfig, string) ([]types.Resource, error) {
	return nil, nil
}

func (mixedSyncConnector) ResolveResourceAncestors(
	context.Context, *types.DataSourceConfig, []string,
) ([]string, error) {
	return nil, nil
}

func (mixedSyncConnector) FetchAll(context.Context, *types.DataSourceConfig, []string) ([]types.FetchedItem, error) {
	return []types.FetchedItem{
		{ExternalID: "file:gone", IsDeleted: true},
		{ExternalID: "file:new", Content: []byte("hello"), FileName: "new.txt"},
	}, nil
}

func (mixedSyncConnector) FetchIncremental(
	context.Context, *types.DataSourceConfig, *types.SyncCursor,
) ([]types.FetchedItem, *types.SyncCursor, error) {
	items, err := (mixedSyncConnector{}).FetchAll(context.Background(), nil, nil)
	return items, nil, err
}

func TestProcessSync_SyncDeletionsPartialWhenMixedResults(t *testing.T) {
	configJSON, err := (&types.DataSourceConfig{Type: "test-sync-mixed"}).ToJSON()
	require.NoError(t, err)

	ds := &types.DataSource{
		ID: "ds-mixed", TenantID: 1, KnowledgeBaseID: "kb-1",
		Type: "test-sync-mixed", Config: configJSON,
		SyncMode: types.SyncModeFull, Status: types.DataSourceStatusActive,
		SyncDeletions: true,
	}
	syncLog := &types.SyncLog{
		ID: "log-mixed", DataSourceID: ds.ID, TenantID: ds.TenantID,
		Status: types.SyncLogStatusRunning, StartedAt: time.Now().UTC(),
	}
	repo := &keyedDeletionRepo{
		items:         map[string]*types.Knowledge{"file:gone": {ID: "knowledge-gone"}},
		hardDeleteErr: errors.New("hard delete failed"),
	}
	ks := &sweepFakeKS{repo: repo}
	syncLogRepo := &processSyncSyncLogRepo{logs: map[string]*types.SyncLog{syncLog.ID: syncLog}}
	registry := datasource.NewConnectorRegistry()
	require.NoError(t, registry.Register(mixedSyncConnector{}))

	svc := &DataSourceService{
		dsRepo:            newKBDeleteDSRepo(ds.KnowledgeBaseID, ds),
		syncLogRepo:       syncLogRepo,
		knowledgeService:  ks,
		kbService:         &processSyncKBService{kb: &types.KnowledgeBase{ID: ds.KnowledgeBaseID, TenantID: ds.TenantID}},
		connectorRegistry: registry,
		tenantRepo:        &processSyncTenantRepo{tenant: &types.Tenant{ID: ds.TenantID}},
		tagService:        &processSyncTagService{},
	}

	payload, err := json.Marshal(types.DataSourceSyncPayload{
		DataSourceID: ds.ID, TenantID: ds.TenantID, SyncLogID: syncLog.ID, ForceFull: true,
	})
	require.NoError(t, err)
	err = svc.ProcessSync(context.Background(), asynq.NewTask(types.TypeDataSourceSync, payload))
	require.Error(t, err, "unconfirmed work must retain its cursor for retry")

	updated := syncLogRepo.logs[syncLog.ID]
	require.NotNil(t, updated)
	assert.Equal(t, types.SyncLogStatusRunning, updated.Status)
	assert.Nil(t, updated.FinishedAt, "missing retry evidence cannot terminate the original run")
	assert.Equal(t, 1, updated.ItemsFailed)
	assert.Equal(t, 1, updated.ItemsCreated)
	assert.Contains(t, updated.ErrorMessage, "deletion failure(s) retained at the previous cursor")
}

func TestIngestItem_URLCreationMetadataAttachFailure(t *testing.T) {
	ds := &types.DataSource{ID: "ds-1", TenantID: 1, KnowledgeBaseID: "kb-1"}
	repo := &deletionLookupKnowledgeRepo{metadataUpdateErr: errors.New("db unavailable")}
	ks := &sweepFakeKS{repo: repo, createURLKnowledge: &types.Knowledge{ID: "url-knowledge-1"}}
	svc := &DataSourceService{knowledgeService: ks}

	_, err := svc.ingestItem(context.Background(), ds, &types.FetchedItem{
		ExternalID: "url:1",
		URL:        "https://example.com/doc",
	}, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "attach datasource metadata")
}

type replacementKnowledgeRepo struct {
	deletionLookupKnowledgeRepo
	writes int
}

func (r *replacementKnowledgeRepo) UpdateKnowledgeForTransfer(_ context.Context, before, after *types.Knowledge) error {
	if r.metadataUpdateErr != nil {
		return r.metadataUpdateErr
	}
	r.writes++
	return nil
}

type replacementKnowledgeService struct {
	sweepFakeKS
	current              *types.Knowledge
	starts, observations int
	startErr             error
	state                string
}

func (s *replacementKnowledgeService) CreateKnowledgeFromFile(_ context.Context, kbID string, _ *multipart.FileHeader,
	metadata map[string]string, _ *bool, _ string, _ []string, _ string, _ *types.KnowledgeProcessOverrides,
) (*types.Knowledge, error) {
	if s.current != nil {
		return nil, types.NewDuplicateFileError(s.current)
	}
	raw, _ := json.Marshal(metadata)
	s.current = &types.Knowledge{ID: "replacement", TenantID: 1, KnowledgeBaseID: kbID,
		ParseStatus: types.ParseStatusPending, Metadata: types.JSON(raw), UpdatedAt: time.Now().UTC()}
	return s.current, nil
}

func (s *replacementKnowledgeService) StartKnowledgeDeleteTask(_ context.Context, kbID, id, revision, taskID string) (map[string]any, error) {
	s.starts++
	var intent datasourceReplacement
	if json.Unmarshal([]byte(s.current.GetMetadata()[datasourceReplacementMetadataKey]), &intent) != nil || !intent.DispatchStarted {
		return nil, errors.New("missing persisted dispatch fence")
	}
	if s.startErr != nil {
		return nil, s.startErr
	}
	return s.deleteResult(kbID, id, revision, taskID), nil
}

func (s *replacementKnowledgeService) ObserveKnowledgeDeleteTask(_ context.Context, kbID, id, revision, taskID string) (map[string]any, error) {
	s.observations++
	return s.deleteResult(kbID, id, revision, taskID), nil
}

func (s *replacementKnowledgeService) deleteResult(kbID, id, revision, taskID string) map[string]any {
	return map[string]any{"state": s.state, "knowledge_base_id": kbID, "knowledge_id": id,
		"native_revision": revision, "task_id": taskID, "completed_at": time.Now().UTC().Format(time.RFC3339Nano)}
}

func newReplacementFixture() (*DataSourceService, *replacementKnowledgeService, *replacementKnowledgeRepo, *types.DataSource, *types.FetchedItem) {
	r := &replacementKnowledgeRepo{deletionLookupKnowledgeRepo: deletionLookupKnowledgeRepo{
		knowledge: &types.Knowledge{ID: "original", UpdatedAt: time.Now().UTC()},
	}}
	ks := &replacementKnowledgeService{sweepFakeKS: sweepFakeKS{repo: r}, state: "RUNNING"}
	return &DataSourceService{knowledgeService: ks}, ks, r,
		&types.DataSource{ID: "ds", TenantID: 1, KnowledgeBaseID: "kb"},
		&types.FetchedItem{ExternalID: "node", FileName: "file.txt", Content: []byte("new bytes")}
}

func TestDataSourceReplacementWaitsForReadyAndRetainsOriginalDeleteReceipt(t *testing.T) {
	s, ks, repo, ds, item := newReplacementFixture()
	_, err := s.ingestItem(context.Background(), ds, item, nil)
	require.Error(t, err)
	assert.Zero(t, ks.starts)
	assert.Empty(t, ks.deleted)
	assert.Empty(t, repo.hardDeleted)
	for _, state := range []string{types.ParseStatusFailed, types.ParseStatusFinalizing, "future-state"} {
		ks.current.ParseStatus = state
		_, err = s.ingestItem(context.Background(), ds, item, nil)
		require.Error(t, err)
		assert.Zero(t, ks.starts)
	}
	ks.current.ParseStatus = types.ParseStatusCompleted
	_, err = s.ingestItem(context.Background(), ds, item, nil)
	require.Error(t, err)
	assert.Equal(t, 1, ks.starts)
	assert.Equal(t, 1, repo.writes)
	_, err = s.ingestItem(context.Background(), ds, item, nil)
	require.Error(t, err)
	assert.Equal(t, 1, ks.starts)
	assert.Equal(t, 1, ks.observations)
	ks.state = "SUCCEEDED"
	_, err = s.ingestItem(context.Background(), ds, item, nil)
	var duplicate *types.DuplicateKnowledgeError
	require.ErrorAs(t, err, &duplicate)
	assert.Equal(t, 2, repo.writes)
	// A retained native receipt makes subsequent cursor replay a no-op even
	// after the native task's retention window has elapsed.
	_, err = s.ingestItem(context.Background(), ds, item, nil)
	require.ErrorAs(t, err, &duplicate)
	assert.Equal(t, 1, ks.starts)
	assert.Equal(t, 2, ks.observations)
	assert.Empty(t, ks.deleted)
	assert.Empty(t, repo.hardDeleted)
}

func TestDataSourceReplacementLostAckAndCASFailureNeverRepeatDelete(t *testing.T) {
	s, ks, repo, ds, item := newReplacementFixture()
	_, _ = s.ingestItem(context.Background(), ds, item, nil)
	ks.current.ParseStatus = types.ParseStatusCompleted
	repo.metadataUpdateErr = errors.New("CAS conflict")
	_, err := s.ingestItem(context.Background(), ds, item, nil)
	require.Error(t, err)
	assert.Zero(t, ks.starts)
	repo.metadataUpdateErr = nil
	ks.startErr = errors.New("queue acknowledgement lost")
	_, err = s.ingestItem(context.Background(), ds, item, nil)
	require.Error(t, err)
	assert.Equal(t, 1, ks.starts)
	ks.state = "UNKNOWN"
	_, err = s.ingestItem(context.Background(), ds, item, nil)
	require.Error(t, err)
	assert.Equal(t, 1, ks.starts)
	assert.Equal(t, 1, ks.observations)
	assert.Empty(t, repo.hardDeleted)
}

type recoveredFileStorageKnowledge struct {
	*fileStorageApplicationService
	t                    *testing.T
	ds                   *types.DataSource
	key                  string
	completed            bool
	starts, observations int
}

func (s *recoveredFileStorageKnowledge) StartKnowledgeDeleteTask(_ context.Context, kb, id, revision, task string) (map[string]any, error) {
	s.starts++
	cursor, err := s.ds.ParseSyncCursor()
	require.NoError(s.t, err)
	state, err := fileStorageState(cursor)
	require.NoError(s.t, err)
	intent := state.Retiring[s.key]
	require.Equal(s.t, task, intent.Key, "the original native task must be checkpointed before dispatch")
	require.Equal(s.t, id, intent.Group.KnowledgeID)
	require.Equal(s.t, revision, intent.Group.Revision)
	return map[string]any{"state": "RUNNING", "task_id": task}, nil
}

func (s *recoveredFileStorageKnowledge) ObserveKnowledgeDeleteTask(_ context.Context, kb, id, revision, task string) (map[string]any, error) {
	s.observations++
	require.True(s.t, s.completed)
	return map[string]any{"state": "SUCCEEDED", "task_id": task, "knowledge_id": id,
		"knowledge_base_id": kb, "native_revision": revision, "completed_at": time.Now().Add(-time.Second).UTC().Format(time.RFC3339Nano)}, nil
}

func TestFileStorageRecoveredApplicationSurvivesNextBatchAndSourceRevocation(t *testing.T) {
	for _, outcome := range []string{"source-revoked", "source-empty", "checkpoint-failed", "receipt-failed", "usage-pending", "group-conflict"} {
		t.Run(outcome, func(t *testing.T) {
			source, node, receiver, root := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
			run := fileStorageRun{dataSourceID: uuid.NewString(), syncLogID: uuid.NewString(), knowledgeBaseID: uuid.NewString(), tenantID: 1, syncDeletions: true}
			oldBatch, nativeID, key := uuid.NewString(), uuid.NewString(), "original-hash:txt"
			body := []byte("original source bytes")
			ref := fileStorageTestWire(t, map[string]string{"resourceId": source, "nativeObjectRef": node, "nativeRevision": "original-source-revision", "displayName": "doc.txt", "mediaType": "text/plain"})
			refs, err := json.Marshal([]map[string]json.RawMessage{ref})
			require.NoError(t, err)
			metadata, err := json.Marshal(map[string]string{"datasource_id": run.dataSourceID, "external_id": key,
				"source_content_sha256": fileStorageDigest(body), "source_references": string(refs)})
			require.NoError(t, err)
			native := &types.Knowledge{ID: nativeID, TenantID: 1, KnowledgeBaseID: run.knowledgeBaseID, FileHash: "original-hash", FileType: "txt",
				FileSize: int64(len(body)), ParseStatus: types.ParseStatusCompleted, UpdatedAt: time.Now().Add(-time.Second).UTC(), Metadata: types.JSON(metadata)}
			pending := fileStorageApplication{KnowledgeID: nativeID, BatchID: oldBatch, Digest: fileStorageDigest(body), Bytes: int64(len(body)), References: []map[string]json.RawMessage{ref}}
			state := fileStorageCursor{Groups: map[string]fileStorageGroup{}, Retiring: map[string]fileStorageRetirement{}, Applying: map[string]fileStorageApplication{key: pending}}
			if outcome == "group-conflict" {
				state.Groups[key] = fileStorageGroup{KnowledgeID: uuid.NewString(), Revision: "other-native-revision", References: pending.References}
			}
			at := time.Now().Add(-time.Hour).UTC()
			fields := fileStorageTestWire(t, state)
			cursor := &types.SyncCursor{LastSyncTime: at, ConnectorCursor: map[string]any{}}
			for name, raw := range fields {
				var value any
				require.NoError(t, json.Unmarshal(raw, &value))
				cursor.ConnectorCursor[name] = value
			}
			initial, err := cursor.ToJSON()
			require.NoError(t, err)
			ds := &types.DataSource{ID: run.dataSourceID, LastSyncCursor: initial}
			dsRepo := &recordingDSRepo{}
			if outcome == "checkpoint-failed" {
				dsRepo.updateErr = errors.New("native checkpoint unavailable")
			}
			repo := &fileStorageApplicationRepo{createKnowledgeFileRepoStub: createKnowledgeFileRepoStub{createdKnowledge: native}}
			knowledge := &recoveredFileStorageKnowledge{fileStorageApplicationService: &fileStorageApplicationService{repo: repo}, t: t, ds: ds, key: key}
			readKey := fileStorageKey(oldBatch, source, node, "original-source-revision")
			retireKey := fileStorageKey(run.syncLogID, run.dataSourceID, key, nativeID, native.UpdatedAt.Format(time.RFC3339Nano), "retire")
			receipts := map[string]map[string]any{}
			var readGrants, discoveries, sourceCalls, receiverPEPs int
			var server *httptest.Server
			server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if r.URL.Path == "/oidc" {
					_, _ = w.Write([]byte(`{"access_token":"receiver-service-token","token_type":"Bearer","expires_in":3600}`))
					return
				}
				var request map[string]any
				require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
				if r.URL.Path != "/execute" {
					require.Equal(t, "Bearer receiver-service-token", r.Header.Get("Authorization"))
				}
				switch r.URL.Path {
				case "/service/v1/adapter/request_read_grant":
					id := request["idempotencyKey"].(string)
					response := map[string]any{"operationId": id, "actionExecutionId": id, "sourceBindingId": source}
					if id == readKey {
						readGrants++
						require.Equal(t, oldBatch, request["nativeBatch"].(map[string]any)["batchId"])
						response["outcome"] = "PENDING"
					} else {
						discoveries++
						require.Equal(t, run.syncLogID, request["nativeBatch"].(map[string]any)["batchId"])
						require.NotEqual(t, oldBatch, run.syncLogID)
						if outcome != "source-empty" {
							w.WriteHeader(http.StatusForbidden)
							return
						}
						var input any
						require.NoError(t, json.Unmarshal([]byte(request["inputJson"].(string)), &input))
						args, _ := json.Marshal(map[string]any{"actionKey": request["actionKey"], "idempotencyKey": id,
							"arguments": map[string]any{"targetType": "RESOURCE", "targetId": source, "authorizationTargetNativeRef": root, "input": input}})
						receiverArgs, _ := json.Marshal(map[string]any{"targetType": "RESOURCE", "targetId": receiver, "authorizationTargetNativeRef": run.knowledgeBaseID,
							"input": map[string]string{"sourceResourceId": source, "importConfigRef": run.dataSourceID, "batchId": run.syncLogID, "sourceReadActionExecutionId": id}})
						response["endpoint"], response["argumentsJson"], response["actionToken"], response["expiresAt"] = server.URL+"/execute", string(args), "source-only-token", time.Now().Add(time.Hour).Unix()
						response["receiverWrite"] = map[string]any{"actionExecutionId": fileStorageKey(id, "receiver"), "actionToken": "receiver-only-token", "expiresAt": time.Now().Add(time.Hour).Unix(), "argumentsJson": string(receiverArgs)}
						if id == retireKey && knowledge.starts > 0 {
							response = map[string]any{"operationId": id, "actionExecutionId": id, "sourceBindingId": source, "outcome": "PENDING"}
						}
					}
					if saved := receipts[id]; saved != nil && !(outcome == "usage-pending" && id == readKey) {
						response = map[string]any{"operationId": id, "actionExecutionId": id, "sourceBindingId": source, "outcome": "COMPLETED", "receiverReceipt": saved}
					}
					require.NoError(t, json.NewEncoder(w).Encode(response))
				case "/service/v1/adapter/read_receipt":
					if outcome == "receipt-failed" {
						w.WriteHeader(http.StatusServiceUnavailable)
						return
					}
					id := request["idempotencyKey"].(string)
					receipts[id] = request
					require.NoError(t, json.NewEncoder(w).Encode(map[string]string{"operationId": id, "receiptDigest": fileStorageDigest([]byte("receipt"))}))
				case "/service/v1/adapter/pep_check":
					receiverPEPs++
					var args map[string]any
					require.NoError(t, json.Unmarshal([]byte(request["argumentsJson"].(string)), &args))
					id := args["input"].(map[string]any)["sourceReadActionExecutionId"].(string)
					require.NotEqual(t, readKey, id, "observing the prior creation is not authorization for a new write")
					require.NoError(t, json.NewEncoder(w).Encode(map[string]string{"operationId": id, "actionExecutionId": fileStorageKey(id, "receiver"), "authorizationMinZedToken": "confirmed"}))
				case "/execute":
					sourceCalls++
					require.Equal(t, "Bearer source-only-token", r.Header.Get("Authorization"))
					require.Equal(t, "file_storage.list@v1", request["actionKey"], "recovery must not re-read or upload source bytes")
					require.NoError(t, json.NewEncoder(w).Encode(map[string]any{"resourceId": source, "nativeObjectRef": root, "operationId": request["idempotencyKey"],
						"items": []any{}, "listingDigest": fileStorageDigest([]byte("[]")), "nativeRevision": fileStorageDigest([]byte("[]"))}))
				default:
					t.Errorf("unexpected recovery endpoint %s", r.URL.Path)
					w.WriteHeader(http.StatusForbidden)
				}
			}))
			defer server.Close()
			secret := filepath.Join(t.TempDir(), "service-secret")
			require.NoError(t, os.WriteFile(secret, []byte("test-only-service-credential"), 0600))
			transport, err := newFileStorageTransport(&config.FileStorageSyncConfig{BindingID: uuid.NewString(), ReceiverResourceID: receiver, NativeKnowledgeBaseID: run.knowledgeBaseID, NativeTenantID: run.tenantID,
				CorePepURL: server.URL + "/service/v1/adapter/pep_check", OIDCTokenURL: server.URL + "/oidc", OIDCClientID: "receiver-service", OIDCClientSecretFile: secret,
				TimeoutMS: 1000, MaxBodyBytes: 10240, ListActionVersion: 1, ReadActionVersion: 1, ApplyActionKey: "knowledge.sync_apply@v2", ApplyActionVersion: 1, RetireActionKey: "knowledge.sync_retire@v2", RetireActionVersion: 1})
			require.NoError(t, err)
			connector := &fileStorageConnector{transport: transport, knowledge: knowledge}
			svc := &DataSourceService{dsRepo: dsRepo, syncLogRepo: &processSyncSyncLogRepo{logs: map[string]*types.SyncLog{}}}
			ctx := context.WithValue(context.Background(), fileStorageRunKey{}, run)
			input := &types.DataSourceConfig{ResourceIDs: []string{source}}
			next, err := connector.FetchStream(ctx, input, cursor, newStreamHandler(svc, ds, &types.SyncResult{}, &types.SyncLog{}))
			require.Error(t, err)
			require.Nil(t, next)
			require.Zero(t, repo.createCalls)
			if outcome == "source-revoked" || outcome == "source-empty" {
				retained, err := ds.ParseSyncCursor()
				require.NoError(t, err)
				tracked, err := fileStorageState(retained)
				require.NoError(t, err)
				require.Empty(t, tracked.Applying)
				require.Equal(t, nativeID, tracked.Groups[key].KnowledgeID)
				require.Equal(t, native.UpdatedAt.Format(time.RFC3339Nano), tracked.Groups[key].Revision)
				require.Equal(t, at, retained.LastSyncTime)
				if outcome == "source-empty" {
					require.Equal(t, 1, knowledge.starts)
					require.Len(t, tracked.Retiring, 1)
					knowledge.completed = true
					next, err = connector.FetchStream(ctx, input, retained, newStreamHandler(svc, ds, &types.SyncResult{}, &types.SyncLog{}))
					require.NoError(t, err)
					final, err := fileStorageState(next)
					require.NoError(t, err)
					require.Empty(t, final.Groups)
					require.Empty(t, final.Applying)
					require.Empty(t, final.Retiring)
					require.True(t, next.LastSyncTime.After(at))
					require.Equal(t, 1, knowledge.starts)
					require.Equal(t, 1, knowledge.observations)
					require.Equal(t, 2, sourceCalls)
				} else {
					require.Zero(t, knowledge.starts)
					require.Zero(t, sourceCalls)
					require.Zero(t, receiverPEPs)
				}
			} else {
				if outcome == "receipt-failed" || outcome == "usage-pending" {
					retained, err := ds.ParseSyncCursor()
					require.NoError(t, err)
					tracked, err := fileStorageState(retained)
					require.NoError(t, err)
					require.Len(t, tracked.Applying, 1)
					require.Equal(t, pending.KnowledgeID, tracked.Applying[key].KnowledgeID)
					require.Equal(t, native.UpdatedAt.Format(time.RFC3339Nano), tracked.Applying[key].Revision)
					require.False(t, tracked.Applying[key].ObservedAt.IsZero())
					require.Empty(t, tracked.Groups)
					require.Equal(t, at, retained.LastSyncTime)
					require.Len(t, dsRepo.updated, 1, "persist completion evidence without advancing the applied baseline")
				} else {
					require.Equal(t, initial, ds.LastSyncCursor)
					require.Empty(t, dsRepo.updated)
				}
				require.Zero(t, discoveries)
				require.Zero(t, sourceCalls)
				require.Zero(t, receiverPEPs)
				require.Zero(t, knowledge.starts)
				if outcome == "group-conflict" {
					require.Zero(t, readGrants)
				}
			}
		})
	}
}

func TestDataSourceEmbeddedImageUnconfirmedReplacementRetainsCursor(t *testing.T) {
	s, ks, _, ds, item := newReplacementFixture()
	item.Metadata = map[string]string{"embedded_image": "true"}
	ds.LastSyncCursor = types.JSON(`{"connector_cursor":{"page":"prior"}}`)
	baseline := append(types.JSON(nil), ds.LastSyncCursor...)
	dsRepo := &recordingDSRepo{}
	s.dsRepo = dsRepo
	for _, state := range []string{types.ParseStatusPending, types.ParseStatusCompleted, "UNKNOWN"} {
		if ks.current != nil {
			ks.current.ParseStatus = types.ParseStatusCompleted
		}
		if state == "UNKNOWN" {
			ks.state = "UNKNOWN"
		}
		result := &types.SyncResult{}
		handler := &streamSyncHandler{svc: s, ds: ds, result: result}
		require.Error(t, handler.Emit(context.Background(), *item), state)
		assert.Equal(t, 1, result.Failed, state)
		assert.Zero(t, result.Skipped, state)
		require.Error(t, handler.Checkpoint(context.Background(),
			&types.SyncCursor{ConnectorCursor: map[string]interface{}{"page": "next"}}), state)
		assert.Equal(t, baseline, ds.LastSyncCursor, state)
		assert.Empty(t, dsRepo.updated, state)
	}
	assert.Equal(t, 1, ks.starts)
	assert.Equal(t, 1, ks.observations)
}

type incompleteCursorConnector struct {
	deletedItemConnector
	err error
}

func (c incompleteCursorConnector) FetchIncremental(context.Context, *types.DataSourceConfig, *types.SyncCursor) ([]types.FetchedItem, *types.SyncCursor, error) {
	return []types.FetchedItem{{ExternalID: "file:gone", IsDeleted: true}},
		&types.SyncCursor{ConnectorCursor: map[string]interface{}{"page": "next"}}, c.err
}

func TestDataSourceFetchFailureDoesNotCommitCursorOrDeletion(t *testing.T) {
	for _, fetchErr := range []error{errors.New("source unavailable"), &datasource.PartialFetchError{Details: []string{"one page unavailable"}}} {
		h := newSyncDeletionHarness(t, true, "ds-incomplete", "sync-incomplete", nil, nil)
		h.ds.SyncMode = types.SyncModeIncremental
		baseline := makeConnectorCursor(t, map[string]map[string]string{"space": {"old": "1"}})
		h.ds.LastSyncCursor = baseline
		require.NoError(t, h.svc.connectorRegistry.Register(incompleteCursorConnector{err: fetchErr}))
		raw, err := json.Marshal(types.DataSourceSyncPayload{DataSourceID: h.ds.ID, TenantID: h.ds.TenantID, SyncLogID: h.syncLogID})
		require.NoError(t, err)
		err = h.svc.ProcessSync(context.Background(), asynq.NewTask(types.TypeDataSourceSync, raw))
		require.Error(t, err)
		assert.Equal(t, baseline, h.ds.LastSyncCursor)
		assert.Empty(t, h.knowledgeSvc.deleted)
		assert.Empty(t, h.knowledgeRepo.hardDeleted)
	}
}
