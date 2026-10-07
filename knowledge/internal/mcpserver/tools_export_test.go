package mcpserver

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/Tencent/WeKnora/internal/types"
	"github.com/mark3labs/mcp-go/mcp"
	"github.com/stretchr/testify/require"
)

type exportKnowledgeService struct {
	stubKnowledgeService
	reads            int
	fileReads        int
	changeOnRead     bool
	body             string
	createdIDs       []string
	deletedRevisions []string
	plainDeletes     int
	deleteTaskStarts []string
	deleteTaskReads  []string
}

func (s *exportKnowledgeService) StartKnowledgeDeleteTask(_ context.Context, kb, id, revision, key string) (map[string]any, error) {
	s.deleteTaskStarts = append(s.deleteTaskStarts, key)
	return map[string]any{"task_id": key, "state": "RUNNING"}, nil
}

func (s *exportKnowledgeService) ObserveKnowledgeDeleteTask(_ context.Context, kb, id, revision, key string) (map[string]any, error) {
	s.deleteTaskReads = append(s.deleteTaskReads, key)
	return map[string]any{"task_id": key, "state": "UNKNOWN"}, nil
}

func TestDeleteDocumentDurableObservationDoesNotRequireOrResubmitDeletedRow(t *testing.T) {
	srv := newScopeTestServer(&types.KnowledgeBase{ID: "kb", TenantID: 1})
	service := &exportKnowledgeService{}
	srv.knowledgeService = service
	ep := &types.MCPEndpoint{ID: "ep", TenantID: 1, Tools: types.StringArray{types.MCPEndpointToolDeleteDocument}}
	args := map[string]any{"knowledge_base_id": "kb", "knowledge_id": "doc", "expected_revision": "revision", "idempotency_key": "366b0c6f-c070-40a1-ad6e-66b1a21aaf3c"}
	result, err := srv.handleDeleteDocument(mcpCallContext(1, ep), nativeToolRequest(t, args))
	require.NoError(t, err)
	require.False(t, result.IsError)
	require.Len(t, service.deleteTaskStarts, 1)
	delete(args, "knowledge_id")
	delete(args, "expected_revision")
	args["observe_only"] = true
	result, err = srv.handleDeleteDocument(mcpCallContext(1, ep), nativeToolRequest(t, args))
	require.NoError(t, err)
	require.False(t, result.IsError)
	require.Equal(t, service.deleteTaskStarts, service.deleteTaskReads)
	require.Len(t, service.deleteTaskStarts, 1)
	require.Zero(t, service.plainDeletes)
	args["knowledge_base_id"] = "foreign"
	result, err = srv.handleDeleteDocument(mcpCallContext(1, ep), nativeToolRequest(t, args))
	require.NoError(t, err)
	require.True(t, result.IsError)
	require.Len(t, service.deleteTaskReads, 1)
}

func (s *exportKnowledgeService) DeleteKnowledgeAtRevision(_ context.Context, _ string, revision string) error {
	s.deletedRevisions = append(s.deletedRevisions, revision)
	return nil
}

func (s *exportKnowledgeService) DeleteKnowledge(context.Context, string) error {
	s.plainDeletes++
	return nil
}

func TestDeleteDocumentPassesTheNativeRevisionWithoutFallback(t *testing.T) {
	for _, scenario := range []string{"current", "empty", "invalid", "absent", "foreign"} {
		t.Run(scenario, func(t *testing.T) {
			srv := newScopeTestServer(&types.KnowledgeBase{ID: "kb", TenantID: 1})
			doc := &types.Knowledge{ID: "doc", TenantID: 1, KnowledgeBaseID: "kb", UpdatedAt: time.Now()}
			service := &exportKnowledgeService{stubKnowledgeService: stubKnowledgeService{docs: map[string]*types.Knowledge{"doc": doc}}}
			srv.knowledgeService = service
			ep := &types.MCPEndpoint{ID: "ep", TenantID: 1, Tools: types.StringArray{types.MCPEndpointToolDeleteDocument}}
			revision := doc.UpdatedAt.UTC().Format(time.RFC3339Nano)
			args := map[string]any{"knowledge_id": "doc", "expected_revision": revision}
			switch scenario {
			case "empty":
				args["expected_revision"] = ""
			case "invalid":
				args["expected_revision"] = true
			case "absent":
				delete(args, "expected_revision")
			case "foreign":
				doc.TenantID = 2
			}
			result, err := srv.handleDeleteDocument(mcpCallContext(1, ep), nativeToolRequest(t, args))
			require.NoError(t, err)
			if scenario == "current" {
				require.False(t, result.IsError)
				require.Equal(t, []string{revision}, service.deletedRevisions)
				require.Zero(t, service.plainDeletes)
			} else if scenario == "absent" {
				require.False(t, result.IsError)
				require.Empty(t, service.deletedRevisions)
				require.Equal(t, 1, service.plainDeletes)
			} else {
				require.True(t, result.IsError)
				require.Empty(t, service.deletedRevisions)
				require.Zero(t, service.plainDeletes)
			}
		})
	}
}

func (s *exportKnowledgeService) GetKnowledgeByIDOnly(ctx context.Context, id string) (*types.Knowledge, error) {
	k, err := s.stubKnowledgeService.GetKnowledgeByIDOnly(ctx, id)
	s.reads++
	if err == nil && s.changeOnRead && s.reads > 1 {
		changed := *k
		changed.UpdatedAt = changed.UpdatedAt.Add(time.Second)
		return &changed, nil
	}
	return k, err
}

func (s *exportKnowledgeService) GetKnowledgeFile(context.Context, string) (io.ReadCloser, string, error) {
	s.fileReads++
	return io.NopCloser(strings.NewReader(s.body)), "native.md", nil
}

func (s *exportKnowledgeService) CreateKnowledgeFromManual(_ context.Context, kb string, payload *types.ManualKnowledgePayload, _ string) (*types.Knowledge, error) {
	s.createdIDs = append(s.createdIDs, payload.CreationID)
	return &types.Knowledge{ID: payload.CreationID, KnowledgeBaseID: kb, ParseStatus: types.ParseStatusPending}, nil
}

func (s *exportKnowledgeService) CreateKnowledgeFromFileAtID(_ context.Context, kb, filename string, data []byte, metadata map[string]string, creationID string, _ []string, _ string) (*types.Knowledge, error) {
	s.createdIDs = append(s.createdIDs, creationID)
	encoded, err := json.Marshal(metadata)
	if err != nil {
		return nil, err
	}
	if s.docs == nil {
		s.docs = map[string]*types.Knowledge{}
	}
	document := &types.Knowledge{ID: creationID, TenantID: 1, KnowledgeBaseID: kb, FileName: filename,
		FileSize: int64(len(data)), Type: "file", Metadata: types.JSON(encoded), ParseStatus: types.ParseStatusPending}
	s.docs[creationID] = document
	return document, nil
}

func (s *exportKnowledgeService) GetKnowledgeByID(ctx context.Context, id string) (*types.Knowledge, error) {
	return s.stubKnowledgeService.GetKnowledgeByIDOnly(ctx, id)
}

func TestAddDocumentFileObservationNeverRepeatsNativeCreation(t *testing.T) {
	srv := newScopeTestServer(&types.KnowledgeBase{ID: "kb", TenantID: 1})
	service := &exportKnowledgeService{}
	srv.knowledgeService = service
	ep := &types.MCPEndpoint{ID: "ep", TenantID: 1, Tools: types.StringArray{types.MCPEndpointToolAddDocument}}
	key := "366b0c6f-c070-40a1-ad6e-66b1a21aaf3c"
	readOperation := "6570487f-c171-45f4-9163-fd6b794d1984"
	reference := map[string]string{"resourceId": "e6653c7a-e555-423a-af39-c60a4848f955",
		"nativeObjectRef": "ac80e0be-3cfc-4abd-baf0-88920506a44d", "nativeRevision": "version-1",
		"displayName": "source.txt", "mediaType": "text/plain"}
	encoded, err := json.Marshal(reference)
	require.NoError(t, err)
	args := map[string]any{
		"knowledge_base_id": "kb", "title": "source.txt", "filename": "source.txt", "file_base64": "AP8B/g==",
		"source_reference_json": string(encoded), "idempotency_key": key}
	result, err := srv.handleAddDocument(mcpCallContext(1, ep), nativeToolRequest(t, args))
	require.NoError(t, err)
	require.True(t, result.IsError)
	require.Empty(t, service.createdIDs)
	args["read_operation_id"] = readOperation
	for field, value := range map[string]string{"secret": "must-not-be-persisted", "assetId": "not-a-uuid", "resourceId": "00000000-0000-0000-0000-000000000000", "displayName": " padded "} {
		invalid := map[string]string{}
		for key, original := range reference {
			invalid[key] = original
		}
		invalid[field] = value
		bad, encodeErr := json.Marshal(invalid)
		require.NoError(t, encodeErr)
		args["source_reference_json"] = string(bad)
		result, err = srv.handleAddDocument(mcpCallContext(1, ep), nativeToolRequest(t, args))
		require.NoError(t, err)
		require.True(t, result.IsError, field)
		require.Empty(t, service.createdIDs)
	}
	args["source_reference_json"] = string(encoded)
	result, err = srv.handleAddDocument(mcpCallContext(1, ep), nativeToolRequest(t, args))
	require.NoError(t, err)
	require.False(t, result.IsError)
	require.Len(t, service.createdIDs, 1)
	document := service.docs[service.createdIDs[0]]
	require.Equal(t, int64(4), document.FileSize)
	var references []map[string]string
	require.NoError(t, json.Unmarshal([]byte(document.GetMetadata()["source_references"]), &references))
	require.Equal(t, []map[string]string{reference}, references)
	for _, state := range []string{types.ParseStatusPending, types.ParseStatusFailed, types.ParseStatusCompleted} {
		document.ParseStatus = state
		result, err = srv.handleAddDocument(mcpCallContext(1, ep), nativeToolRequest(t, map[string]any{
			"knowledge_base_id": "kb", "idempotency_key": key, "observe_only": true}))
		require.NoError(t, err)
		require.False(t, result.IsError)
		require.Len(t, service.createdIDs, 1)
		value := result.StructuredContent.(map[string]any)
		require.Equal(t, "text/plain", value["media_type"])
		require.Equal(t, readOperation, value["read_operation_id"])
		require.Equal(t, fmt.Sprintf("%x", sha256.Sum256([]byte{0, 255, 1, 254})), value["source_content_sha256"])
		require.Equal(t, int64(4), value["source_content_bytes"])
		require.Equal(t, state, value["document"].(documentSummary).ParseStatus)
	}
	ep.ID = "other-endpoint"
	result, err = srv.handleAddDocument(mcpCallContext(1, ep), nativeToolRequest(t, map[string]any{
		"knowledge_base_id": "kb", "idempotency_key": key, "observe_only": true}))
	require.NoError(t, err)
	require.True(t, result.IsError)
	require.Len(t, service.createdIDs, 1)
}

func nativeToolRequest(t *testing.T, args map[string]any) mcp.CallToolRequest {
	t.Helper()
	body, err := json.Marshal(map[string]any{"params": map[string]any{"arguments": args}})
	require.NoError(t, err)
	var request mcp.CallToolRequest
	require.NoError(t, json.Unmarshal(body, &request))
	return request
}

func TestExportDocumentUsesOriginalBytesAndEditorScope(t *testing.T) {
	for _, scenario := range []string{"allowed", "read-only", "foreign", "changed"} {
		t.Run(scenario, func(t *testing.T) {
			kb := &types.KnowledgeBase{ID: "kb", TenantID: 1}
			srv := newScopeTestServer(kb)
			doc := &types.Knowledge{ID: "doc", TenantID: 1, KnowledgeBaseID: "kb", Type: types.KnowledgeTypeManual, UpdatedAt: time.Now()}
			service := &exportKnowledgeService{stubKnowledgeService: stubKnowledgeService{docs: map[string]*types.Knowledge{"doc": doc}}, body: "# original bytes\n", changeOnRead: scenario == "changed"}
			srv.knowledgeService = service
			ep := &types.MCPEndpoint{ID: "ep", TenantID: 1, Tools: types.StringArray{types.MCPEndpointToolExportDocument}}
			if scenario == "read-only" {
				ep.Tools = types.StringArray{types.MCPEndpointToolReadDocument}
			}
			if scenario == "foreign" {
				doc.TenantID = 2
			}
			result, err := srv.handleExportDocument(mcpCallContext(1, ep), nativeToolRequest(t, map[string]any{"knowledge_id": "doc"}))
			require.NoError(t, err)
			if scenario != "allowed" {
				require.True(t, result.IsError)
				require.Nil(t, result.StructuredContent)
				if scenario != "changed" {
					require.Zero(t, service.fileReads)
				}
				return
			}
			require.False(t, result.IsError)
			data := result.StructuredContent.(map[string]any)
			require.Equal(t, base64.StdEncoding.EncodeToString([]byte(service.body)), data["content_base64"])
			require.Equal(t, "text/markdown", data["media_type"])
			require.Equal(t, doc.UpdatedAt.UTC().Format(time.RFC3339Nano), data["native_revision"])
		})
	}
}

func TestAddDocumentRetryKeyUsesTheAuthenticatedNativeEndpoint(t *testing.T) {
	srv := newScopeTestServer(&types.KnowledgeBase{ID: "kb", TenantID: 1})
	service := &exportKnowledgeService{}
	srv.knowledgeService = service
	ep := &types.MCPEndpoint{ID: "ep", TenantID: 1, Tools: types.StringArray{types.MCPEndpointToolAddDocument}}
	args := map[string]any{"knowledge_base_id": "kb", "title": "title", "content": "body", "idempotency_key": "366b0c6f-c070-40a1-ad6e-66b1a21aaf3c"}
	for i := 0; i < 2; i++ {
		result, err := srv.handleAddDocument(mcpCallContext(1, ep), nativeToolRequest(t, args))
		require.NoError(t, err)
		require.False(t, result.IsError)
	}
	require.NotEmpty(t, service.createdIDs[0])
	require.Equal(t, service.createdIDs[0], service.createdIDs[1])
	ep.ID = "other-endpoint"
	result, err := srv.handleAddDocument(mcpCallContext(1, ep), nativeToolRequest(t, args))
	require.NoError(t, err)
	require.False(t, result.IsError)
	require.NotEqual(t, service.createdIDs[0], service.createdIDs[2])
	args["url"] = "https://example.invalid/document"
	result, err = srv.handleAddDocument(mcpCallContext(1, ep), nativeToolRequest(t, args))
	require.NoError(t, err)
	require.True(t, result.IsError)
	require.Len(t, service.createdIDs, 3)
}
