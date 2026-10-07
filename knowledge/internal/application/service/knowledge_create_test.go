package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http/httptest"
	"testing"

	"github.com/Tencent/WeKnora/internal/application/repository"
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/Tencent/WeKnora/internal/types/interfaces"
	"github.com/hibiken/asynq"
	"github.com/stretchr/testify/require"
)

type createKnowledgeFileRepoStub struct {
	interfaces.KnowledgeRepository

	createCalls      int
	createErr        error
	createdKnowledge *types.Knowledge
	updateErr        error
	assignedTags     []string
}

func (r *createKnowledgeFileRepoStub) SetKnowledgeTags(_ context.Context, _ string, ids []string) error {
	r.assignedTags = append([]string(nil), ids...)
	return nil
}

type createKnowledgeFileTagStub struct {
	interfaces.KnowledgeTagRepository
}

func (*createKnowledgeFileTagStub) GetByIDs(_ context.Context, _ uint64, ids []string) ([]*types.KnowledgeTag, error) {
	result := make([]*types.KnowledgeTag, 0, len(ids))
	for _, id := range ids {
		result = append(result, &types.KnowledgeTag{ID: id, KnowledgeBaseID: "kb-1"})
	}
	return result, nil
}

func TestCreateKnowledgeFromFileAtIDKeepsDataSourceTagsAndChannel(t *testing.T) {
	repo := &createKnowledgeFileRepoStub{}
	svc := &knowledgeService{repo: repo, fileSvc: &createKnowledgeFileServiceStub{}, task: &createKnowledgeTaskEnqueuerStub{},
		tagRepo: &createKnowledgeFileTagStub{}, kbService: &createKnowledgeFileKBServiceStub{kb: &types.KnowledgeBase{ID: "kb-1"}}}
	ctx := newCreateKnowledgeFileContext()
	id := "7263e13f-4153-4bb0-a91e-0a21490cf3a9"
	created, err := svc.CreateKnowledgeFromFileAtID(ctx, "kb-1", "doc.txt", []byte("body"), nil, id, []string{"source-tag"}, fileStorageConnectorType)
	require.NoError(t, err)
	require.Equal(t, fileStorageConnectorType, created.Channel)
	require.Equal(t, []string{"source-tag"}, repo.assignedTags)
	_, err = svc.CreateKnowledgeFromFileAtID(ctx, "kb-1", "doc.txt", []byte("body"), nil, id, []string{"different-tag"}, fileStorageConnectorType)
	require.Error(t, err)
	_, err = svc.CreateKnowledgeFromFileAtID(ctx, "kb-1", "doc.txt", []byte("body"), nil, id, []string{"source-tag"}, "mcp")
	require.Error(t, err)
	require.Equal(t, 1, repo.createCalls)
}

func (r *createKnowledgeFileRepoStub) CheckKnowledgeExists(
	ctx context.Context,
	tenantID uint64,
	kbID string,
	params *types.KnowledgeCheckParams,
) (bool, *types.Knowledge, error) {
	return false, nil, nil
}

func (r *createKnowledgeFileRepoStub) CreateKnowledge(ctx context.Context, knowledge *types.Knowledge) error {
	r.createCalls++
	copied := *knowledge
	r.createdKnowledge = &copied
	return r.createErr
}

func (r *createKnowledgeFileRepoStub) GetKnowledgeByID(_ context.Context, tenant uint64, id string) (*types.Knowledge, error) {
	if r.createdKnowledge == nil || r.createdKnowledge.ID != id || r.createdKnowledge.TenantID != tenant {
		return nil, repository.ErrKnowledgeNotFound
	}
	copy := *r.createdKnowledge
	return &copy, nil
}

func (r *createKnowledgeFileRepoStub) UpdateKnowledge(_ context.Context, knowledge *types.Knowledge) error {
	copy := *knowledge
	r.createdKnowledge = &copy
	return r.updateErr
}

// GetKnowledgeTags is invoked by setAndAttachKnowledgeTags after create even
// when no tags were supplied; a fresh knowledge has none, so return empty.
func (r *createKnowledgeFileRepoStub) GetKnowledgeTags(
	ctx context.Context,
	knowledgeIDs []string,
) (map[string][]*types.KnowledgeTag, error) {
	return map[string][]*types.KnowledgeTag{}, nil
}

type createKnowledgeFileKBServiceStub struct {
	interfaces.KnowledgeBaseService

	kb *types.KnowledgeBase
}

func (s *createKnowledgeFileKBServiceStub) GetKnowledgeBaseByID(
	ctx context.Context,
	id string,
) (*types.KnowledgeBase, error) {
	return s.kb, nil
}

type createKnowledgeFileServiceStub struct {
	saveErr              error
	saveCalls            int
	savedWithKnowledgeID string
	deleteCalls          int
	deletedPath          string
	beforeSave           func()
}

func (s *createKnowledgeFileServiceStub) CheckConnectivity(ctx context.Context) error {
	return nil
}

func (s *createKnowledgeFileServiceStub) SaveFile(
	ctx context.Context,
	file *multipart.FileHeader,
	tenantID uint64,
	knowledgeID string,
) (string, error) {
	if s.beforeSave != nil {
		s.beforeSave()
	}
	s.saveCalls++
	s.savedWithKnowledgeID = knowledgeID
	if s.saveErr != nil {
		return "", s.saveErr
	}
	return "stored/" + knowledgeID, nil
}

func TestCreateKnowledgeFromFileAtIDRetainsNativeIntentAcrossLostReceipts(t *testing.T) {
	for _, stage := range []string{"ok", "storage-unknown", "database-ack-lost"} {
		t.Run(stage, func(t *testing.T) {
			repo := &createKnowledgeFileRepoStub{}
			storage := &createKnowledgeFileServiceStub{}
			queue := &createKnowledgeTaskEnqueuerStub{}
			id := "366b0c6f-c070-40a1-ad6e-66b1a21aaf3c"
			storage.beforeSave = func() {
				require.NotNil(t, repo.createdKnowledge)
				require.Equal(t, id, repo.createdKnowledge.ID)
				require.Equal(t, types.ParseStatusPending, repo.createdKnowledge.ParseStatus)
			}
			if stage == "storage-unknown" {
				storage.saveErr = errors.New("unknown storage receipt")
			}
			if stage == "database-ack-lost" {
				repo.updateErr = errors.New("unknown database receipt")
			}
			svc := &knowledgeService{repo: repo, fileSvc: storage, task: queue,
				kbService: &createKnowledgeFileKBServiceStub{kb: &types.KnowledgeBase{ID: "kb-1"}}}
			ctx := newCreateKnowledgeFileContext()
			_, err := svc.CreateKnowledgeFromFileAtID(ctx, "kb-1", "doc.txt", []byte("original"), nil, id, nil, "mcp")
			if stage == "ok" {
				require.NoError(t, err)
			} else {
				require.Error(t, err)
			}
			prior, err := svc.CreateKnowledgeFromFileAtID(ctx, "kb-1", "doc.txt", []byte("original"), nil, id, nil, "mcp")
			require.NoError(t, err)
			// The pre-Connector representation had exactly these four fields.
			// Omitted new options must still read its stored durable intent.
			legacy, marshalErr := json.Marshal(struct {
				KB, Hash, Name string
				Metadata       map[string]string
			}{"kb-1", prior.FileHash, "doc.txt", nil})
			require.NoError(t, marshalErr)
			require.Equal(t, fmt.Sprintf("%x", sha256.Sum256(legacy)), prior.GetMetadata()[fileCreationDigestMetadataKey])
			_, err = svc.CreateKnowledgeFromFileAtID(ctx, "kb-1", "doc.txt", []byte("original"), nil, id, nil, "")
			require.Error(t, err) // Native empty channel means web, not MCP.
			require.Equal(t, id, prior.ID)
			require.NotEqual(t, types.ParseStatusCompleted, prior.ParseStatus)
			require.Equal(t, 1, storage.saveCalls)
			require.Zero(t, storage.deleteCalls)
			require.Equal(t, 1, repo.createCalls)
			if stage == "ok" {
				require.Equal(t, 1, queue.calls)
			} else {
				require.Zero(t, queue.calls)
			}
			_, err = svc.CreateKnowledgeFromFileAtID(ctx, "kb-1", "doc.txt", []byte("replacement"), nil, id, nil, "mcp")
			require.Error(t, err)
			require.Equal(t, 1, storage.saveCalls)
		})
	}
}

func (s *createKnowledgeFileServiceStub) SaveBytes(
	ctx context.Context,
	data []byte,
	tenantID uint64,
	fileName string,
	temp bool,
) (string, error) {
	return "", errors.New("not implemented")
}

func (s *createKnowledgeFileServiceStub) GetFile(ctx context.Context, filePath string) (io.ReadCloser, error) {
	return nil, errors.New("not implemented")
}

func (s *createKnowledgeFileServiceStub) GetFileURL(ctx context.Context, filePath string) (string, error) {
	return "", errors.New("not implemented")
}

func (s *createKnowledgeFileServiceStub) DeleteFile(ctx context.Context, filePath string) error {
	s.deleteCalls++
	s.deletedPath = filePath
	return nil
}

func (s *createKnowledgeFileServiceStub) CopyFile(ctx context.Context, srcPath string, tenantID uint64, knowledgeID string) (string, error) {
	return "", errors.New("not implemented")
}

type createKnowledgeTaskEnqueuerStub struct {
	calls int
}

func (s *createKnowledgeTaskEnqueuerStub) Enqueue(
	task *asynq.Task,
	opts ...asynq.Option,
) (*asynq.TaskInfo, error) {
	s.calls++
	return &asynq.TaskInfo{ID: "task-1", Queue: "default"}, nil
}

func TestCreateKnowledgeFromFileDoesNotPersistWhenStorageSaveFails(t *testing.T) {
	t.Parallel()

	repo := &createKnowledgeFileRepoStub{}
	fileSvc := &createKnowledgeFileServiceStub{saveErr: errors.New("storage unavailable")}
	svc := &knowledgeService{
		repo:      repo,
		kbService: &createKnowledgeFileKBServiceStub{kb: &types.KnowledgeBase{ID: "kb-1"}},
		fileSvc:   fileSvc,
	}

	knowledge, err := svc.CreateKnowledgeFromFile(
		newCreateKnowledgeFileContext(),
		"kb-1",
		newMultipartFileHeader(t, "doc.txt", "hello"),
		nil,
		nil,
		"",
		nil,
		"",
		nil,
	)

	require.Error(t, err)
	require.Nil(t, knowledge)
	require.Equal(t, 1, fileSvc.saveCalls)
	require.Zero(t, repo.createCalls)
}

func TestCreateKnowledgeFromFilePersistsStoredFilePathOnCreate(t *testing.T) {
	t.Parallel()

	repo := &createKnowledgeFileRepoStub{}
	fileSvc := &createKnowledgeFileServiceStub{}
	task := &createKnowledgeTaskEnqueuerStub{}
	svc := &knowledgeService{
		repo:      repo,
		kbService: &createKnowledgeFileKBServiceStub{kb: &types.KnowledgeBase{ID: "kb-1"}},
		fileSvc:   fileSvc,
		task:      task,
	}

	knowledge, err := svc.CreateKnowledgeFromFile(
		newCreateKnowledgeFileContext(),
		"kb-1",
		newMultipartFileHeader(t, "doc.txt", "hello"),
		nil,
		nil,
		"",
		nil,
		"",
		nil,
	)

	require.NoError(t, err)
	require.NotNil(t, knowledge)
	require.Equal(t, 1, fileSvc.saveCalls)
	require.NotEmpty(t, fileSvc.savedWithKnowledgeID)
	require.Equal(t, fileSvc.savedWithKnowledgeID, knowledge.ID)
	require.Equal(t, 1, repo.createCalls)
	require.NotNil(t, repo.createdKnowledge)
	require.Equal(t, "stored/"+knowledge.ID, repo.createdKnowledge.FilePath)
	require.Equal(t, 1, task.calls)
}

func TestCreateKnowledgeFromImageFallsBackWhenLegacyStorageConfigIsIncomplete(t *testing.T) {
	t.Parallel()

	repo := &createKnowledgeFileRepoStub{}
	fileSvc := &createKnowledgeFileServiceStub{}
	task := &createKnowledgeTaskEnqueuerStub{}
	kb := &types.KnowledgeBase{
		ID:        "kb-1",
		VLMConfig: types.VLMConfig{Enabled: true, ModelID: "vlm-1"},
	}
	kb.SetStorageProvider("cos")
	svc := &knowledgeService{
		repo:      repo,
		kbService: &createKnowledgeFileKBServiceStub{kb: kb},
		fileSvc:   fileSvc,
		task:      task,
	}
	ctx := context.WithValue(newCreateKnowledgeFileContext(), types.TenantInfoContextKey, &types.Tenant{
		StorageEngineConfig: &types.StorageEngineConfig{
			DefaultProvider: "cos",
			COS:             &types.COSEngineConfig{SecretID: "incomplete"},
		},
	})

	knowledge, err := svc.CreateKnowledgeFromFile(
		ctx,
		"kb-1",
		newMultipartFileHeader(t, "image.png", "image bytes"),
		nil,
		nil,
		"",
		nil,
		"",
		nil,
	)

	require.NoError(t, err)
	require.NotNil(t, knowledge)
	require.Equal(t, 1, fileSvc.saveCalls)
	require.Equal(t, 1, repo.createCalls)
	require.Equal(t, 1, task.calls)
}

func TestCreateKnowledgeFromFileDeletesStoredFileWhenCreateFails(t *testing.T) {
	t.Parallel()

	repo := &createKnowledgeFileRepoStub{createErr: errors.New("database unavailable")}
	fileSvc := &createKnowledgeFileServiceStub{}
	svc := &knowledgeService{
		repo:      repo,
		kbService: &createKnowledgeFileKBServiceStub{kb: &types.KnowledgeBase{ID: "kb-1"}},
		fileSvc:   fileSvc,
	}

	knowledge, err := svc.CreateKnowledgeFromFile(
		newCreateKnowledgeFileContext(),
		"kb-1",
		newMultipartFileHeader(t, "doc.txt", "hello"),
		nil,
		nil,
		"",
		nil,
		"",
		nil,
	)

	require.EqualError(t, err, "database unavailable")
	require.Nil(t, knowledge)
	require.Equal(t, 1, fileSvc.saveCalls)
	require.Equal(t, 1, repo.createCalls)
	require.Equal(t, 1, fileSvc.deleteCalls)
	require.Equal(t, "stored/"+fileSvc.savedWithKnowledgeID, fileSvc.deletedPath)
}

func TestCreateKnowledgeFromFile_PersistsProcessOverrides(t *testing.T) {
	t.Parallel()

	repo := &createKnowledgeFileRepoStub{}
	fileSvc := &createKnowledgeFileServiceStub{}
	task := &createKnowledgeTaskEnqueuerStub{}
	svc := &knowledgeService{
		repo:      repo,
		kbService: &createKnowledgeFileKBServiceStub{kb: &types.KnowledgeBase{ID: "kb-1"}},
		fileSvc:   fileSvc,
		task:      task,
	}

	chunkSize := 512
	overrides := &types.KnowledgeProcessOverrides{
		ChunkingConfig: &types.ChunkingConfig{ChunkSize: chunkSize},
		SummaryEnabled: processConfigBoolPtr(false),
	}

	knowledge, err := svc.CreateKnowledgeFromFile(
		newCreateKnowledgeFileContext(),
		"kb-1",
		newMultipartFileHeader(t, "doc.txt", "hello"),
		map[string]string{"source": "test"},
		nil,
		"",
		nil,
		"",
		overrides,
	)

	require.NoError(t, err)
	require.NotNil(t, knowledge)
	require.Equal(t, 1, repo.createCalls)
	require.NotNil(t, repo.createdKnowledge)

	parsed, err := repo.createdKnowledge.ProcessOverrides()
	require.NoError(t, err)
	require.NotNil(t, parsed)
	require.NotNil(t, parsed.SummaryEnabled)
	require.False(t, *parsed.SummaryEnabled)
	require.NotNil(t, parsed.ChunkingConfig)
	require.Equal(t, chunkSize, parsed.ChunkingConfig.ChunkSize)

	metadataMap, err := repo.createdKnowledge.Metadata.Map()
	require.NoError(t, err)
	require.Equal(t, "test", metadataMap["source"])
}

func newCreateKnowledgeFileContext() context.Context {
	ctx := context.WithValue(context.Background(), types.TenantIDContextKey, uint64(1))
	ctx = context.WithValue(ctx, types.TenantInfoContextKey, &types.Tenant{})
	return ctx
}

func newMultipartFileHeader(t *testing.T, filename string, content string) *multipart.FileHeader {
	t.Helper()

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", filename)
	require.NoError(t, err)
	_, err = part.Write([]byte(content))
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	req := httptest.NewRequest("POST", "/", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	require.NoError(t, req.ParseMultipartForm(1024))
	return req.MultipartForm.File["file"][0]
}
