package mcpserver

import (
	"context"
	"encoding/base64"
	"encoding/json"
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
