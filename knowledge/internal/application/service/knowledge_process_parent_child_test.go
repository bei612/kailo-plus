package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Tencent/WeKnora/internal/application/access"
	"github.com/Tencent/WeKnora/internal/application/repository"
	"github.com/Tencent/WeKnora/internal/models/embedding"
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/Tencent/WeKnora/internal/types/interfaces"
	"github.com/hibiken/asynq"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type parentChildKnowledgeRepo struct {
	interfaces.KnowledgeRepository
	knowledge *types.Knowledge
}

func (r *parentChildKnowledgeRepo) GetKnowledgeByID(
	context.Context, uint64, string,
) (*types.Knowledge, error) {
	return r.knowledge, nil
}

func (r *parentChildKnowledgeRepo) UpdateKnowledge(
	context.Context, *types.Knowledge,
) error {
	return nil
}

func (r *parentChildKnowledgeRepo) UpdateKnowledgeForTransfer(_ context.Context, before, after *types.Knowledge) error {
	if r.knowledge.ID != before.ID {
		return errors.New("native row changed")
	}
	row := *after
	r.knowledge = &row
	return nil
}

type parentChildChunkService struct {
	interfaces.ChunkRepository
	created []*types.Chunk
}

func (s *parentChildChunkService) DeleteChunksByKnowledgeID(context.Context, uint64, string) error {
	return nil
}

func (s *parentChildChunkService) CreateChunks(_ context.Context, chunks []*types.Chunk) error {
	s.created = append([]*types.Chunk(nil), chunks...)
	return nil
}

type parentChildModelService struct {
	interfaces.ModelService
	embedder embedding.Embedder
	err      error
}

func (s parentChildModelService) GetEmbeddingModel(context.Context, string) (embedding.Embedder, error) {
	return s.embedder, s.err
}

type parentChildEmbedder struct{}

func (parentChildEmbedder) Embed(context.Context, string) ([]float32, error) {
	return []float32{1}, nil
}

func (parentChildEmbedder) BatchEmbed(context.Context, []string) ([][]float32, error) {
	return [][]float32{{1}}, nil
}

func (parentChildEmbedder) BatchEmbedWithPool(
	context.Context, embedding.Embedder, []string,
) ([][]float32, error) {
	return [][]float32{{1}}, nil
}

func (parentChildEmbedder) GetModelName() string { return "parent-child-test" }
func (parentChildEmbedder) GetDimensions() int   { return 1 }
func (parentChildEmbedder) GetModelID() string   { return "parent-child-test" }

type parentChildRetrieveEngine struct {
	interfaces.RetrieveEngineService
	indexed     []*types.IndexInfo
	deleteErr   error
	storageSize int64
	indexCalls  int
	afterIndex  func()
	indexErr    error
}

func (e *parentChildRetrieveEngine) EngineType() types.RetrieverEngineType {
	return types.PostgresRetrieverEngineType
}

func (e *parentChildRetrieveEngine) Support() []types.RetrieverType {
	return []types.RetrieverType{types.VectorRetrieverType}
}

func (e *parentChildRetrieveEngine) DeleteByKnowledgeIDList(
	context.Context, []string, int, string,
) error {
	if e.deleteErr != nil {
		return e.deleteErr
	}
	e.indexed = nil
	return nil
}

func (e *parentChildRetrieveEngine) EstimateStorageSize(
	context.Context, embedding.Embedder, []*types.IndexInfo, []types.RetrieverType,
) int64 {
	return e.storageSize
}

func (e *parentChildRetrieveEngine) BatchIndex(
	_ context.Context,
	_ embedding.Embedder,
	infos []*types.IndexInfo,
	_ []types.RetrieverType,
) error {
	e.indexed = append([]*types.IndexInfo(nil), infos...)
	e.indexCalls++
	if e.afterIndex != nil {
		e.afterIndex()
	}
	return e.indexErr
}

type parentChildRetrieveRegistry struct {
	interfaces.RetrieveEngineRegistry
	engine interfaces.RetrieveEngineService
}

func (r parentChildRetrieveRegistry) GetRetrieveEngineService(
	types.RetrieverEngineType,
) (interfaces.RetrieveEngineService, error) {
	return r.engine, nil
}

type parentChildGraphRepo struct {
	interfaces.RetrieveGraphRepository
}

func (parentChildGraphRepo) DelGraph(context.Context, []types.NameSpace) error {
	return nil
}

type parentChildTenantRepo struct {
	interfaces.TenantRepository
}

func (parentChildTenantRepo) AdjustStorageUsed(context.Context, uint64, int64) error {
	return nil
}

type parentChildTaskEnqueuer struct{}

func (parentChildTaskEnqueuer) Enqueue(*asynq.Task, ...asynq.Option) (*asynq.TaskInfo, error) {
	return nil, nil
}

func TestProcessChunksIndexesEveryTextChild(t *testing.T) {
	knowledge := &types.Knowledge{
		ID:              "knowledge-1",
		TenantID:        1,
		KnowledgeBaseID: "kb-1",
		ParseStatus:     types.ParseStatusProcessing,
	}
	chunkService := &parentChildChunkService{}
	retrieveEngine := &parentChildRetrieveEngine{}
	tenant := &types.Tenant{
		ID: 1,
		RetrieverEngines: types.RetrieverEngines{Engines: []types.RetrieverEngineParams{
			{
				RetrieverType:       types.VectorRetrieverType,
				RetrieverEngineType: types.PostgresRetrieverEngineType,
			},
		}},
	}
	ctx := context.WithValue(context.Background(), types.TenantInfoContextKey, tenant)
	svc := &knowledgeService{
		repo:           &parentChildKnowledgeRepo{knowledge: knowledge},
		chunkRepo:      chunkService,
		modelService:   parentChildModelService{embedder: parentChildEmbedder{}},
		retrieveEngine: parentChildRetrieveRegistry{engine: retrieveEngine},
		graphEngine:    parentChildGraphRepo{},
		tenantRepo:     parentChildTenantRepo{},
		task:           parentChildTaskEnqueuer{},
	}
	kb := &types.KnowledgeBase{
		ID:               "kb-1",
		TenantID:         1,
		EmbeddingModelID: "embedding-1",
		IndexingStrategy: types.IndexingStrategy{VectorEnabled: true},
	}
	chunks := []types.ParsedChunk{
		{Content: "linked child", Seq: 0, Start: 0, End: 12, ParentIndex: 0},
		{Content: "standalone child", Seq: 1, Start: 12, End: 28, ParentIndex: -1},
	}

	svc.processChunks(ctx, kb, knowledge, chunks, ProcessChunksOptions{
		ParentChunks: []types.ParsedParentChunk{
			{Content: "parent context", Seq: 0, Start: 0, End: 28},
		},
	})

	var textChunkIDs []string
	for _, chunk := range chunkService.created {
		if chunk.ChunkType == types.ChunkTypeText {
			textChunkIDs = append(textChunkIDs, chunk.ID)
		}
	}
	require.Len(t, textChunkIDs, 2)

	indexedSourceIDs := make([]string, 0, len(retrieveEngine.indexed))
	for _, info := range retrieveEngine.indexed {
		indexedSourceIDs = append(indexedSourceIDs, info.SourceID)
	}
	require.ElementsMatch(t, textChunkIDs, indexedSourceIDs)
}

func TestProcessChunksRetryKeepsOneNativeIndexAndStorageCheckpoint(t *testing.T) {
	f := transferFixture(t, access.KBTransferMove)
	require.NoError(t, f.db.Model(&types.Knowledge{}).Where("id = ?", "doc").Updates(map[string]any{
		"parse_status": types.ParseStatusProcessing, "storage_size": 0,
	}).Error)
	kb := f.kbs.values["kb"]
	kb.EmbeddingModelID = "native-embedding"
	kb.IndexingStrategy.VectorEnabled = true
	engine := &parentChildRetrieveEngine{storageSize: 17}
	f.svc.modelService = parentChildModelService{embedder: parentChildEmbedder{}}
	f.svc.retrieveEngine = parentChildRetrieveRegistry{engine: engine}
	f.svc.tenantRepo = repository.NewTenantRepository(f.db)
	f.svc.task = parentChildTaskEnqueuer{}
	ctx := context.WithValue(f.ctx, types.TenantInfoContextKey, &types.Tenant{
		ID: 7, RetrieverEngines: types.RetrieverEngines{Engines: []types.RetrieverEngineParams{{
			RetrieverType: types.VectorRetrieverType, RetrieverEngineType: types.PostgresRetrieverEngineType,
		}}},
	})
	load := func() *types.Knowledge {
		row, err := f.repo.GetKnowledgeByID(ctx, 7, "doc")
		require.NoError(t, err)
		return row
	}
	storage := func() int64 {
		tenant, err := f.svc.tenantRepo.GetTenantByID(ctx, 7)
		require.NoError(t, err)
		return tenant.StorageUsed
	}
	require.NoError(t, f.db.Exec(spanTrackerTestDDL).Error)
	f.svc.spanTracker = NewSpanTracker(repository.NewKnowledgeSpanRepository(f.db))
	beforeTracking := load()
	_, attempt, err := f.svc.tracker().OpenAttempt(ctx, "doc", "")
	require.NoError(t, err)
	require.Equal(t, beforeTracking.UpdatedAt, load().UpdatedAt, "native tracing must not invalidate processing's Knowledge checkpoint")
	ctx = withAttempt(ctx, attempt)
	chunks := []types.ParsedChunk{{Content: "native retry content", ParentIndex: -1}}
	failure := errors.New("native observation unavailable after index persistence")
	failRead := false
	engine.afterIndex = func() { failRead = true }
	require.NoError(t, f.db.Callback().Query().Before("gorm:query").Register("native-index-observation", func(tx *gorm.DB) {
		if tx.Statement.Table == "knowledges" && failRead {
			failRead = false
			tx.AddError(failure)
		}
	}))
	require.ErrorIs(t, f.svc.processChunks(ctx, kb, load(), chunks), failure)
	require.NoError(t, f.db.Callback().Query().Remove("native-index-observation"))
	engine.afterIndex = nil
	require.Len(t, engine.indexed, 1)
	require.Equal(t, int64(5), storage(), "UNKNOWN before the checkpoint must not charge persisted partial indexing")
	created := f.chunkRepo.writes
	engine.deleteErr = errors.New("native index cleanup unavailable")
	require.ErrorIs(t, f.svc.processChunks(ctx, kb, load(), chunks), engine.deleteErr)
	require.Equal(t, created+1, f.chunkRepo.writes, "only the idempotent previous-chunk delete may run before failed index cleanup")
	require.Equal(t, 1, engine.indexCalls, "cleanup uncertainty must not re-index")
	require.Len(t, engine.indexed, 1)
	require.Equal(t, int64(5), storage())
	engine.deleteErr = nil
	commitUnknown := errors.New("native checkpoint acknowledgement lost")
	f.svc.repo = &transferFaultRepo{KnowledgeRepository: f.repo, checkpointCommitError: commitUnknown}
	require.ErrorIs(t, f.svc.processChunks(ctx, kb, load(), chunks), commitUnknown)
	require.Equal(t, int64(17), load().StorageSize)
	require.Equal(t, int64(22), storage(), "the original transaction commits row size and storage delta together")
	require.NoError(t, f.svc.processChunks(ctx, kb, load(), chunks))
	require.Len(t, engine.indexed, 1, "retry replaces the same Knowledge index rather than adding another live index")
	require.Equal(t, int64(22), storage(), "the acknowledged retry must not charge the same native size again")
	var live int64
	require.NoError(t, f.db.Model(&types.Chunk{}).Where("knowledge_id = ?", "doc").Count(&live).Error)
	require.Equal(t, int64(1), live)
	require.Empty(t, (&HousekeepingService{db: f.db}).filterByLastSpanActivity(ctx, []types.Knowledge{*beforeTracking}, time.Now().Add(-time.Hour)),
		"the original span heartbeat still proves progress to housekeeping")
	engine.afterIndex = func() {
		require.NoError(t, f.db.Model(&types.Knowledge{}).Where("id = ?", "doc").Update("description", "concurrent native owner update").Error)
	}
	require.ErrorContains(t, f.svc.processChunks(ctx, kb, load(), chunks), "knowledge changed during transfer")
	require.Equal(t, "concurrent native owner update", load().Description, "a fresh observation cannot bless a stale worker's final state")
	require.Equal(t, int64(22), storage())
}

func TestManualCleanupRetryUsesOriginalStorageCAS(t *testing.T) {
	f := transferFixture(t, access.KBTransferMove)
	row, err := f.repo.GetKnowledgeByID(f.ctx, 7, "doc")
	require.NoError(t, err)
	storage := func() int64 {
		tenant, err := repository.NewTenantRepository(f.db).GetTenantByID(f.ctx, 7)
		require.NoError(t, err)
		return tenant.StorageUsed
	}
	f.graph.err = errors.New("native graph cleanup unavailable")
	require.ErrorIs(t, f.svc.cleanupKnowledgeResources(f.ctx, row), f.graph.err)
	require.Equal(t, int64(5), storage(), "failed cleanup cannot release accounted native storage")
	f.graph.err = nil
	commitUnknown := errors.New("native cleanup checkpoint acknowledgement lost")
	f.svc.repo = &transferFaultRepo{KnowledgeRepository: f.repo, checkpointCommitError: commitUnknown}
	require.ErrorIs(t, f.svc.cleanupKnowledgeResources(f.ctx, row), commitUnknown)
	require.Equal(t, int64(0), storage())
	row, err = f.repo.GetKnowledgeByID(f.ctx, 7, "doc")
	require.NoError(t, err)
	require.Zero(t, row.StorageSize, "the original durable row proves the release already happened")
	require.NoError(t, f.svc.cleanupKnowledgeResources(f.ctx, row))
	require.Equal(t, int64(0), storage(), "same-task retry must not release the old size twice")
}

func TestProcessChunksRetainsUnknownNativeEffects(t *testing.T) {
	for _, stage := range []string{"embedding-model", "empty-model", "chunk-write", "index-write", "quota-read"} {
		t.Run(stage, func(t *testing.T) {
			f := transferFixture(t, access.KBTransferMove)
			require.NoError(t, f.db.Model(&types.Knowledge{}).Where("id = ?", "doc").Updates(map[string]any{
				"parse_status": types.ParseStatusProcessing, "storage_size": 0,
			}).Error)
			require.NoError(t, f.db.Model(&types.Tenant{}).Where("id = ?", 7).Update("storage_quota", 100).Error)
			kb := f.kbs.values["kb"]
			kb.EmbeddingModelID = "native-embedding"
			kb.IndexingStrategy.VectorEnabled = true
			failure := errors.New("native processing acknowledgement unavailable")
			model := parentChildModelService{embedder: parentChildEmbedder{}}
			engine := &parentChildRetrieveEngine{storageSize: 17}
			switch stage {
			case "embedding-model":
				model.err = failure
			case "empty-model":
				model.embedder = nil
			case "chunk-write":
				require.NoError(t, f.db.Callback().Create().After("gorm:create").Register("native-chunk-ack", func(tx *gorm.DB) {
					if tx.Statement.Table == "chunks" {
						tx.AddError(failure)
					}
				}))
			case "index-write":
				engine.indexErr = failure
			case "quota-read":
				require.NoError(t, f.db.Callback().Query().Before("gorm:query").Register("native-quota-observation", func(tx *gorm.DB) {
					if tx.Statement.Table == "tenants" {
						tx.AddError(failure)
					}
				}))
			}
			f.svc.modelService = model
			f.svc.retrieveEngine = parentChildRetrieveRegistry{engine: engine}
			f.svc.tenantRepo = repository.NewTenantRepository(f.db)
			ctx := context.WithValue(f.ctx, types.TenantInfoContextKey, &types.Tenant{
				ID: 7, StorageQuota: 100,
				RetrieverEngines: types.RetrieverEngines{Engines: []types.RetrieverEngineParams{{
					RetrieverType: types.VectorRetrieverType, RetrieverEngineType: types.PostgresRetrieverEngineType,
				}}},
			})
			before, err := f.repo.GetKnowledgeByID(ctx, 7, "doc")
			require.NoError(t, err)
			err = f.svc.processChunks(ctx, kb, before, []types.ParsedChunk{{Content: "retained native content", ParentIndex: -1}})
			if stage == "empty-model" {
				require.ErrorContains(t, err, "native embedding model observation is empty")
			} else {
				require.ErrorIs(t, err, failure)
			}
			require.NotErrorIs(t, err, asynq.SkipRetry)
			after, err := f.repo.GetKnowledgeByID(ctx, 7, "doc")
			require.NoError(t, err)
			require.Equal(t, types.ParseStatusProcessing, after.ParseStatus, "an unknown effect is not a confirmed native failure")
			require.Equal(t, before.UpdatedAt, after.UpdatedAt)
			require.Zero(t, after.StorageSize)
			require.Zero(t, f.repo.writes, "processing must not fall back to the unfenced full-row writer")
			if stage == "index-write" {
				require.Len(t, engine.indexed, 1, "partial native persistence stays available for the same task's guarded cleanup")
			}
		})
	}
}

func TestProcessChunksStorageQuotaUsesReplacementDeltaAndOriginalCAS(t *testing.T) {
	f := transferFixture(t, access.KBTransferMove)
	require.NoError(t, f.db.Model(&types.Knowledge{}).Where("id = ?", "doc").Update("parse_status", types.ParseStatusProcessing).Error)
	require.NoError(t, f.db.Model(&types.Tenant{}).Where("id = ?", 7).Update("storage_quota", 5).Error)
	kb := f.kbs.values["kb"]
	kb.EmbeddingModelID = "native-embedding"
	kb.IndexingStrategy.VectorEnabled = true
	engine := &parentChildRetrieveEngine{storageSize: 5}
	f.svc.modelService = parentChildModelService{embedder: parentChildEmbedder{}}
	f.svc.retrieveEngine = parentChildRetrieveRegistry{engine: engine}
	f.svc.tenantRepo = repository.NewTenantRepository(f.db)
	f.svc.task = parentChildTaskEnqueuer{}
	ctx := context.WithValue(f.ctx, types.TenantInfoContextKey, &types.Tenant{
		ID: 7, StorageQuota: 5,
		RetrieverEngines: types.RetrieverEngines{Engines: []types.RetrieverEngineParams{{
			RetrieverType: types.VectorRetrieverType, RetrieverEngineType: types.PostgresRetrieverEngineType,
		}}},
	})
	load := func() *types.Knowledge {
		row, err := f.repo.GetKnowledgeByID(ctx, 7, "doc")
		require.NoError(t, err)
		return row
	}
	storage := func() int64 {
		row, err := f.svc.tenantRepo.GetTenantByID(ctx, 7)
		require.NoError(t, err)
		return row.StorageUsed
	}
	chunks := []types.ParsedChunk{{Content: "native replacement", ParentIndex: -1}}
	require.NoError(t, f.svc.processChunks(ctx, kb, load(), chunks), "same-size retry at quota must not charge the old size twice")
	require.Equal(t, int64(5), storage())
	require.NoError(t, f.db.Model(&types.Tenant{}).Where("id = ?", 7).Update("storage_quota", 10).Error)
	engine.storageSize = 8
	engine.afterIndex = func() {
		require.NoError(t, f.db.Model(&types.Tenant{}).Where("id = ?", 7).Update("storage_quota", 7).Error)
	}
	require.ErrorContains(t, f.svc.processChunks(ctx, kb, load(), chunks), "native tenant storage checkpoint rejected")
	require.Equal(t, int64(5), load().StorageSize, "quota refusal rolls back the Knowledge checkpoint as well")
	require.Equal(t, int64(5), storage())
	engine.afterIndex = nil
	require.NoError(t, f.db.Model(&types.Tenant{}).Where("id = ?", 7).Update("storage_quota", 10).Error)
	require.NoError(t, f.svc.processChunks(ctx, kb, load(), chunks))
	require.Equal(t, int64(8), load().StorageSize)
	require.Equal(t, int64(8), storage())
	require.Len(t, engine.indexed, 1)
}
