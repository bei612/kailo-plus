package service

import (
	"bytes"
	"context"
	"crypto/md5"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Tencent/WeKnora/internal/application/repository"
	"github.com/Tencent/WeKnora/internal/config"
	apperrors "github.com/Tencent/WeKnora/internal/errors"
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/Tencent/WeKnora/internal/types/interfaces"
	secutils "github.com/Tencent/WeKnora/internal/utils"
	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/stretchr/testify/require"
)

type createKnowledgeFileRepoStub struct {
	interfaces.KnowledgeRepository

	createCalls      int
	createErr        error
	createdKnowledge *types.Knowledge
	updateErr        error
	updateCalls      int
	assignedTags     []string
	afterCheck       func()
	afterCreate      func()
	afterTagRead     func()
	existing         *types.Knowledge
	columnUpdates    int
}

func (r *createKnowledgeFileRepoStub) SetKnowledgeTags(_ context.Context, _ string, ids []string) error {
	r.assignedTags = append([]string(nil), ids...)
	return nil
}

type createKnowledgeFileTagStub struct {
	interfaces.KnowledgeTagRepository
	kbID      string
	afterRead func()
}

func (s *createKnowledgeFileTagStub) GetByIDs(_ context.Context, _ uint64, ids []string) ([]*types.KnowledgeTag, error) {
	if s.afterRead != nil {
		s.afterRead()
	}
	kbID := s.kbID
	if kbID == "" {
		kbID = "kb-1"
	}
	result := make([]*types.KnowledgeTag, 0, len(ids))
	for _, id := range ids {
		result = append(result, &types.KnowledgeTag{ID: id, KnowledgeBaseID: kbID})
	}
	return result, nil
}

func TestCreateKnowledgeFromFileAtIDKeepsDataSourceTagsAndChannel(t *testing.T) {
	run := fileStorageRun{tenantID: 1, knowledgeBaseID: uuid.NewString(), dataSourceID: uuid.NewString(), syncLogID: uuid.NewString()}
	repo := &createKnowledgeFileRepoStub{}
	svc := &knowledgeService{repo: repo, fileSvc: &createKnowledgeFileServiceStub{}, task: &createKnowledgeTaskEnqueuerStub{},
		tagRepo: &createKnowledgeFileTagStub{kbID: run.knowledgeBaseID}, kbService: &createKnowledgeFileKBServiceStub{kb: &types.KnowledgeBase{ID: run.knowledgeBaseID}}}
	ctx := newFileStorageWriteContext(t, run, func() bool { return false })
	metadata := map[string]string{"datasource_id": run.dataSourceID, "external_id": fmt.Sprintf("%x:txt", md5.Sum([]byte("body")))}
	id := "7263e13f-4153-4bb0-a91e-0a21490cf3a9"
	ctx.Value(fileStorageWriteKey{}).(*fileStorageWrite).nativeID = id
	created, err := svc.CreateKnowledgeFromFileAtID(ctx, run.knowledgeBaseID, "doc.txt", []byte("body"), metadata, id, []string{"source-tag"}, fileStorageConnectorType)
	require.NoError(t, err)
	require.Equal(t, fileStorageConnectorType, created.Channel)
	require.Equal(t, []string{"source-tag"}, repo.assignedTags)
	_, err = svc.CreateKnowledgeFromFileAtID(ctx, run.knowledgeBaseID, "doc.txt", []byte("body"), metadata, id, []string{"different-tag"}, fileStorageConnectorType)
	require.Error(t, err)
	_, err = svc.CreateKnowledgeFromFileAtID(ctx, run.knowledgeBaseID, "doc.txt", []byte("body"), metadata, id, []string{"source-tag"}, "mcp")
	require.Error(t, err)
	require.Equal(t, 1, repo.createCalls)
}

// Use the actual receiver transport and HTTP PEP consumer. Revocation is
// injected by completed native awaits, not by replacing authorization with
// an optional successful callback in the production writer.
func newFileStorageWriteContext(t *testing.T, run fileStorageRun, revoked func() bool) context.Context {
	t.Helper()
	operation, execution := uuid.NewString(), uuid.NewString()
	binding, resource := uuid.NewString(), uuid.NewString()
	arguments, err := json.Marshal(map[string]any{"targetType": "RESOURCE", "targetId": resource,
		"authorizationTargetNativeRef": run.knowledgeBaseID, "input": map[string]string{"importConfigRef": run.dataSourceID,
			"batchId": run.syncLogID, "sourceReadActionExecutionId": operation}})
	require.NoError(t, err)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/oidc" {
			_, _ = w.Write([]byte(`{"access_token":"receiver-service-token","token_type":"Bearer","expires_in":3600}`))
			return
		}
		require.Equal(t, "/service/v1/adapter/pep_check", r.URL.Path)
		require.Equal(t, "Bearer receiver-service-token", r.Header.Get("Authorization"))
		var request map[string]any
		require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
		require.Equal(t, binding, request["bindingId"])
		require.Equal(t, "receiver-only-token", request["actionToken"])
		require.Equal(t, string(arguments), request["argumentsJson"])
		if revoked() {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		require.NoError(t, json.NewEncoder(w).Encode(map[string]string{"operationId": operation,
			"actionExecutionId": execution, "authorizationMinZedToken": "confirmed"}))
	}))
	t.Cleanup(server.Close)
	secret := filepath.Join(t.TempDir(), "receiver-secret")
	require.NoError(t, os.WriteFile(secret, []byte("test-only-receiver-secret"), 0600))
	transport, err := newFileStorageTransport(&config.FileStorageSyncConfig{BindingID: binding, ReceiverResourceID: resource,
		NativeKnowledgeBaseID: run.knowledgeBaseID, NativeTenantID: run.tenantID,
		CorePepURL: server.URL + "/service/v1/adapter/pep_check", OIDCTokenURL: server.URL + "/oidc",
		OIDCClientID: "receiver", OIDCClientSecretFile: secret, TimeoutMS: 1000, MaxBodyBytes: 10240,
		ListActionVersion: 1, ReadActionVersion: 1, ApplyActionKey: "knowledge.sync_apply@v2", ApplyActionVersion: 1,
		RetireActionKey: "knowledge.sync_retire@v2", RetireActionVersion: 1})
	require.NoError(t, err)
	grant := &fileStorageGrant{key: operation,
		value: fileStorageTestWire(t, map[string]string{"operationId": operation}),
		receiver: fileStorageTestWire(t, map[string]any{"actionExecutionId": execution, "argumentsJson": string(arguments),
			"actionToken": "receiver-only-token", "expiresAt": time.Now().Add(time.Hour).Unix()})}
	return context.WithValue(newCreateKnowledgeFileContext(), fileStorageWriteKey{},
		&fileStorageWrite{transport: transport, run: run, grants: []*fileStorageGrant{grant}, nativeID: uuid.NewString()})
}

func TestFileStorageWriterReauthorizesNativeSideEffects(t *testing.T) {
	for _, stage := range []string{"missing-execution", "wrong-tenant", "wrong-kb", "wrong-source", "missing-external-id", "empty-grants", "expired-grant",
		"dedupe-read", "intent-read", "intent-insert", "storage-save", "tag-read", "tag-attach", "parse-enqueue"} {
		t.Run(stage, func(t *testing.T) {
			run := fileStorageRun{tenantID: 1, knowledgeBaseID: uuid.NewString(), dataSourceID: uuid.NewString(), syncLogID: uuid.NewString()}
			revoked := false
			ctx := newFileStorageWriteContext(t, run, func() bool { return revoked })
			repo, storage, queue := &createKnowledgeFileRepoStub{}, &createKnowledgeFileServiceStub{}, &createKnowledgeTaskEnqueuerStub{}
			tags := &createKnowledgeFileTagStub{kbID: run.knowledgeBaseID}
			svc := &knowledgeService{repo: repo, fileSvc: storage, task: queue, tagRepo: tags,
				kbService: &createKnowledgeFileKBServiceStub{kb: &types.KnowledgeBase{ID: run.knowledgeBaseID}}}
			metadata := map[string]string{"datasource_id": run.dataSourceID, "external_id": fmt.Sprintf("%x:txt", md5.Sum([]byte("source body")))}
			filename := "doc.txt"
			kbID := run.knowledgeBaseID
			switch stage {
			case "missing-execution":
				ctx = newCreateKnowledgeFileContext()
			case "wrong-tenant":
				ctx = context.WithValue(ctx, types.TenantIDContextKey, uint64(2))
			case "wrong-kb":
				kbID = uuid.NewString()
			case "wrong-source":
				metadata["datasource_id"] = uuid.NewString()
			case "missing-external-id":
				delete(metadata, "external_id")
			case "empty-grants":
				ctx.Value(fileStorageWriteKey{}).(*fileStorageWrite).grants = nil
			case "expired-grant":
				ctx.Value(fileStorageWriteKey{}).(*fileStorageWrite).grants[0].receiver["expiresAt"] = json.RawMessage(`0`)
			case "dedupe-read":
				repo.existing = &types.Knowledge{ID: uuid.NewString()}
				repo.afterCheck = func() { revoked = true }
			case "intent-read":
				repo.afterCheck = func() { revoked = true }
			case "intent-insert":
				repo.afterCreate = func() { revoked = true }
			case "storage-save":
				storage.beforeSave = func() { revoked = true }
			case "tag-read":
				tags.afterRead = func() { revoked = true }
			case "tag-attach":
				repo.afterTagRead = func() { revoked = true }
			case "parse-enqueue":
				filename = "data.csv"
				metadata["external_id"] = fmt.Sprintf("%x:csv", md5.Sum([]byte("source body")))
				queue.beforeEnqueue = func() { revoked = true }
			}
			id := uuid.NewString()
			if write, ok := ctx.Value(fileStorageWriteKey{}).(*fileStorageWrite); ok {
				write.nativeID = id
			}
			_, err := svc.CreateKnowledgeFromFileAtID(ctx, kbID, filename, []byte("source body"), metadata, id, []string{"source-tag"}, fileStorageConnectorType)
			require.Error(t, err)
			require.Zero(t, repo.columnUpdates, "revocation after duplicate lookup must prevent its timestamp write")
			require.Zero(t, storage.deleteCalls, "partial native writes remain owned; revocation is not rollback")
			switch stage {
			case "intent-insert", "storage-save", "tag-read", "tag-attach", "parse-enqueue":
				require.Equal(t, 1, repo.createCalls)
				require.Equal(t, id, repo.createdKnowledge.ID)
				require.Equal(t, types.ParseStatusPending, repo.createdKnowledge.ParseStatus)
				if stage == "intent-insert" {
					require.Zero(t, storage.saveCalls)
				} else {
					require.Equal(t, 1, storage.saveCalls)
					require.Equal(t, "stored/"+id, repo.createdKnowledge.FilePath, "store ACK remains recorded after permission changes")
				}
				if stage == "tag-attach" || stage == "parse-enqueue" {
					require.Equal(t, []string{"source-tag"}, repo.assignedTags)
				} else {
					require.Empty(t, repo.assignedTags)
				}
			default:
				require.Zero(t, repo.createCalls)
				require.Zero(t, storage.saveCalls)
			}
			if stage == "parse-enqueue" {
				require.Equal(t, 1, queue.calls)
			} else {
				require.Zero(t, queue.calls)
			}
			// An already consumed or refused original invocation must not turn
			// revocation into another upload, row, or parsing submission.
			beforeCreate, beforeSave, beforeEnqueue := repo.createCalls, storage.saveCalls, queue.calls
			_, err = svc.CreateKnowledgeFromFileAtID(ctx, kbID, filename, []byte("source body"), metadata, id, []string{"source-tag"}, fileStorageConnectorType)
			require.Error(t, err)
			require.Equal(t, beforeCreate, repo.createCalls)
			require.Equal(t, beforeSave, storage.saveCalls)
			require.Equal(t, beforeEnqueue, queue.calls)
		})
	}
}

func TestFileStorageIngestCannotReplaceReceiverChannel(t *testing.T) {
	run := fileStorageRun{tenantID: 1, knowledgeBaseID: uuid.NewString(), dataSourceID: uuid.NewString(), syncLogID: uuid.NewString()}
	revoked := false
	ctx := newFileStorageWriteContext(t, run, func() bool { return revoked })
	repo, storage, queue := &fileStorageApplicationRepo{}, &createKnowledgeFileServiceStub{}, &createKnowledgeTaskEnqueuerStub{}
	native := &fileStorageApplicationService{repo: repo, creator: &knowledgeService{repo: repo, fileSvc: storage, task: queue,
		kbService: &createKnowledgeFileKBServiceStub{kb: &types.KnowledgeBase{ID: run.knowledgeBaseID}}}}
	svc := &DataSourceService{knowledgeService: native}
	ds := &types.DataSource{ID: run.dataSourceID, TenantID: run.tenantID, KnowledgeBaseID: run.knowledgeBaseID, Type: fileStorageConnectorType}
	item := &types.FetchedItem{ExternalID: fmt.Sprintf("%x:txt", md5.Sum([]byte("source body"))), FileName: "doc.txt", Content: []byte("source body"),
		NativeCreationID: uuid.NewString(), Metadata: map[string]string{"channel": "mcp"}}
	ctx.Value(fileStorageWriteKey{}).(*fileStorageWrite).nativeID = item.NativeCreationID
	_, err := svc.ingestItem(newCreateKnowledgeFileContext(), ds, item, nil)
	require.Error(t, err)
	require.Zero(t, repo.createCalls)
	storage.beforeSave = func() { revoked = true }
	_, err = svc.ingestItem(ctx, ds, item, nil)
	require.Error(t, err)
	require.Equal(t, fileStorageConnectorType, repo.createdKnowledge.Channel)
	require.Equal(t, 1, storage.saveCalls)
	require.Zero(t, storage.deleteCalls)
	require.Zero(t, queue.calls)
}

func (r *createKnowledgeFileRepoStub) CheckKnowledgeExists(
	ctx context.Context,
	tenantID uint64,
	kbID string,
	params *types.KnowledgeCheckParams,
) (bool, *types.Knowledge, error) {
	if r.afterCheck != nil {
		r.afterCheck()
	}
	if r.existing != nil {
		return true, r.existing, nil
	}
	return false, nil, nil
}

func (r *createKnowledgeFileRepoStub) UpdateKnowledgeColumn(context.Context, string, string, interface{}) error {
	r.columnUpdates++
	return nil
}

func (r *createKnowledgeFileRepoStub) CreateKnowledge(ctx context.Context, knowledge *types.Knowledge) error {
	r.createCalls++
	copied := *knowledge
	r.createdKnowledge = &copied
	if r.afterCreate != nil {
		r.afterCreate()
	}
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
	r.updateCalls++
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
	if r.afterTagRead != nil {
		r.afterTagRead()
	}
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
	calls         int
	err           error
	beforeEnqueue func()
}

func (s *createKnowledgeTaskEnqueuerStub) Enqueue(
	task *asynq.Task,
	opts ...asynq.Option,
) (*asynq.TaskInfo, error) {
	s.calls++
	if s.beforeEnqueue != nil {
		s.beforeEnqueue()
	}
	if s.err != nil {
		return nil, s.err
	}
	return &asynq.TaskInfo{ID: "task-1", Queue: "default"}, nil
}

func TestKnowledgeCreateQueueUnknownRetainsPersistedReference(t *testing.T) {
	secutils.SetSSRFWhitelistFromRaw("127.0.0.1")
	t.Cleanup(secutils.ResetSSRFWhitelistForTest)
	for _, source := range []string{"file", "file-at-id", "url", "file-url", "passage", "manual"} {
		for _, observed := range []string{types.ParseStatusPending, types.ParseStatusCompleted, types.ParseStatusFailed} {
			t.Run(source+"/"+observed, func(t *testing.T) {
				repo := &createKnowledgeFileRepoStub{}
				queue := &createKnowledgeTaskEnqueuerStub{err: errors.New("native queue reply lost with private credential")}
				storage := &createKnowledgeFileServiceStub{}
				audit := &captureKBActivityAudit{}
				svc := &knowledgeService{repo: repo, fileSvc: storage, task: queue, audit: audit,
					kbService: &createKnowledgeFileKBServiceStub{kb: &types.KnowledgeBase{ID: "kb-1", TenantID: 1}}}
				ctx := newCreateKnowledgeFileContext()
				updatesAtSubmission := 0
				queue.beforeEnqueue = func() {
					require.NotNil(t, repo.createdKnowledge)
					require.Equal(t, types.ParseStatusPending, repo.createdKnowledge.ParseStatus)
					updatesAtSubmission = repo.updateCalls
					// A real worker may commit before Redis loses the enqueue reply.
					copy := *repo.createdKnowledge
					copy.ParseStatus = observed
					repo.createdKnowledge = &copy
				}
				id := "366b0c6f-c070-40a1-ad6e-66b1a21aaf3c"
				var got *types.Knowledge
				var err error
				switch source {
				case "file":
					got, err = svc.CreateKnowledgeFromFile(ctx, "kb-1", newMultipartFileHeader(t, "doc.txt", "body"), nil, nil, "", nil, "", nil)
				case "file-at-id":
					got, err = svc.CreateKnowledgeFromFileAtID(ctx, "kb-1", "doc.txt", []byte("body"), nil, id, nil, "mcp")
				case "url":
					got, err = svc.CreateKnowledgeFromURL(ctx, "kb-1", "http://127.0.0.1/article", "", "", nil, "article", nil, "", nil)
				case "file-url":
					got, err = svc.CreateKnowledgeFromURL(ctx, "kb-1", "http://127.0.0.1/doc.txt", "doc.txt", "txt", nil, "doc", nil, "", nil)
				case "passage":
					got, err = svc.CreateKnowledgeFromPassage(ctx, "kb-1", []string{"body"}, "")
				case "manual":
					got, err = svc.CreateKnowledgeFromManual(ctx, "kb-1", &types.ManualKnowledgePayload{
						CreationID: id, Title: "manual", Content: "body", Status: types.ManualKnowledgeStatusPublish,
					}, "mcp")
				}
				require.NotNil(t, got)
				assertKnowledgeSubmissionUnknown(t, err, got)
				require.Equal(t, 1, queue.calls)
				require.Equal(t, updatesAtSubmission, repo.updateCalls, "unknown enqueue must not persist a fabricated terminal state")
				require.Equal(t, observed, repo.createdKnowledge.ParseStatus, "do not overwrite the original worker's result")
				require.NotNil(t, audit.entry)
				require.Equal(t, types.AuditOutcomePartial, audit.entry.Outcome)
				var details map[string]any
				require.NoError(t, json.Unmarshal(audit.entry.Details, &details))
				require.Equal(t, types.ParseStatusPending, details["processing_status"])
				require.Equal(t, "enqueue", details["failure_stage"])
				if source == "file-at-id" {
					prior, err := svc.CreateKnowledgeFromFileAtID(ctx, "kb-1", "doc.txt", []byte("body"), nil, id, nil, "mcp")
					require.NoError(t, err)
					require.Equal(t, observed, prior.ParseStatus)
					require.Equal(t, 1, queue.calls)
					require.Equal(t, 1, storage.saveCalls)
				}
				if source == "manual" {
					prior, err := svc.CreateKnowledgeFromManual(ctx, "kb-1", &types.ManualKnowledgePayload{
						CreationID: id, Title: "manual", Content: "body", Status: types.ManualKnowledgeStatusPublish,
					}, "mcp")
					require.NoError(t, err)
					require.Equal(t, observed, prior.ParseStatus)
					require.Equal(t, 1, queue.calls)
				}
			})
		}
	}
}

func assertKnowledgeSubmissionUnknown(t *testing.T, err error, knowledge *types.Knowledge) {
	t.Helper()
	var appErr *apperrors.AppError
	require.ErrorAs(t, err, &appErr)
	require.Equal(t, 500, appErr.HTTPCode)
	require.Equal(t, apperrors.ErrInternalServer, appErr.Code)
	require.Equal(t, "Processing task submission could not be confirmed", appErr.Message)
	require.Equal(t, map[string]any{"persisted_knowledge": map[string]string{
		"id": knowledge.ID, "knowledge_base_id": knowledge.KnowledgeBaseID, "parse_status": types.ParseStatusPending,
	}}, appErr.Details)
	require.Equal(t, types.ParseStatusPending, knowledge.ParseStatus)
	require.Empty(t, knowledge.ErrorMessage)
}

func TestManualUpdateQueueUnknownDoesNotOverwriteWorker(t *testing.T) {
	for _, observed := range []string{types.ParseStatusPending, types.ParseStatusCompleted, types.ParseStatusFailed} {
		t.Run(observed, func(t *testing.T) {
			f := newDocumentWriteFixture(t)
			audit := &captureKBActivityAudit{}
			f.svc.audit = audit
			queue := &createKnowledgeTaskEnqueuerStub{err: errors.New("queue reply lost")}
			writesAtSubmission := 0
			queue.beforeEnqueue = func() {
				row, err := f.repo.GetKnowledgeByID(f.ctx, 7, "doc")
				require.NoError(t, err)
				require.Equal(t, types.ParseStatusPending, row.ParseStatus)
				writesAtSubmission = f.repo.writes
				require.NoError(t, f.db.Model(&types.Knowledge{}).Where("id = ?", "doc").Update("parse_status", observed).Error)
			}
			f.svc.task = queue
			got, err := f.svc.UpdateManualKnowledge(f.ctx, "doc", &types.ManualKnowledgePayload{
				Title: "updated", Content: "updated body", Status: types.ManualKnowledgeStatusPublish,
			})
			assertKnowledgeSubmissionUnknown(t, err, got)
			require.Equal(t, writesAtSubmission, f.repo.writes)
			row, err := f.repo.GetKnowledgeByID(f.ctx, 7, "doc")
			require.NoError(t, err)
			require.Equal(t, observed, row.ParseStatus)
			require.Equal(t, 1, queue.calls)
			require.Equal(t, types.AuditOutcomePartial, audit.entry.Outcome)
		})
	}
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
