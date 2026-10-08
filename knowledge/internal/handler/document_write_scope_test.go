package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Tencent/WeKnora/internal/application/access"
	apperrors "github.com/Tencent/WeKnora/internal/errors"
	"github.com/Tencent/WeKnora/internal/middleware"
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/Tencent/WeKnora/internal/types/interfaces"
	"github.com/gin-gonic/gin"
	"github.com/hibiken/asynq"
	"github.com/stretchr/testify/require"
)

type documentWriteHandlerKnowledge struct {
	interfaces.KnowledgeService
	called bool
	err    error
}

func (s *documentWriteHandlerKnowledge) CreateKnowledgeFromFile(
	_ context.Context, kb string, _ *multipart.FileHeader, _ map[string]string, _ *bool, _ string,
	_ []string, _ string, _ *types.KnowledgeProcessOverrides,
) (*types.Knowledge, error) {
	s.called = true
	return &types.Knowledge{ID: "doc", TenantID: 7, KnowledgeBaseID: kb, ParseStatus: types.ParseStatusPending}, s.err
}

func TestNativeUploadUnknownQueueReplyRetainsErrorEnvelope(t *testing.T) {
	kg := &documentWriteHandlerKnowledge{err: apperrors.NewInternalServerError("Processing task submission could not be confirmed").WithDetails(map[string]any{
		"persisted_knowledge": map[string]string{"id": "doc", "knowledge_base_id": "kb", "parse_status": types.ParseStatusPending},
	})}
	h := &KnowledgeHandler{kgService: kg, kbService: &stubKBService{get: func(context.Context, string) (*types.KnowledgeBase, error) {
		return &types.KnowledgeBase{ID: "kb", TenantID: 7}, nil
	}}}
	r := documentHandlerRouter()
	r.POST("/:id/file", h.CreateKnowledgeFromFile)
	contentType, body := multipartBody(t, 1)
	req := httptest.NewRequest(http.MethodPost, "/kb/file", bytes.NewReader(body))
	req.Header.Set("Content-Type", contentType)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	require.True(t, kg.called)
	require.Equal(t, http.StatusInternalServerError, w.Code)
	var result map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
	require.Equal(t, map[string]any{
		"success": false,
		"error": map[string]any{
			"code": float64(apperrors.ErrInternalServer), "message": "Processing task submission could not be confirmed",
			"details": map[string]any{"persisted_knowledge": map[string]any{"id": "doc", "knowledge_base_id": "kb", "parse_status": "pending"}},
		},
	}, result)
}

func (*documentWriteHandlerKnowledge) GetKnowledgeByIDOnly(context.Context, string) (*types.Knowledge, error) {
	return &types.Knowledge{ID: "doc", TenantID: 7, KnowledgeBaseID: "kb"}, nil
}

func (s *documentWriteHandlerKnowledge) UpdateKnowledgeTagBatch(
	ctx context.Context,
	kb string,
	_ map[string][]string,
) error {
	if err := access.RequireKBWrite(ctx, &types.KnowledgeBase{ID: kb, TenantID: 7}); err != nil {
		return err
	}
	s.called = true
	return nil
}

type documentDeleteEnqueuer struct{ task *asynq.Task }

func (q *documentDeleteEnqueuer) Enqueue(task *asynq.Task, _ ...asynq.Option) (*asynq.TaskInfo, error) {
	q.task = task
	return &asynq.TaskInfo{ID: "delete-task"}, nil
}

func documentHandlerRouter() *gin.Engine {
	r := gin.New()
	r.Use(middleware.ErrorHandler(), func(c *gin.Context) {
		ctx := types.WithCaller(
			c.Request.Context(),
			types.Caller{TenantID: 7, UserID: "user", Role: types.TenantRoleAdmin},
		)
		ctx = types.WithExecutionTenant(ctx, 7)
		c.Set(types.TenantIDContextKey.String(), uint64(7))
		c.Request = c.Request.WithContext(ctx)
		c.Next()
	})
	return r
}

func TestDocumentTagBodyRouteIssuesWriteGrant(t *testing.T) {
	for _, body := range []string{`{"kb_id":"kb","updates":{"doc":["tag"]}}`, `{"updates":{"doc":["tag"]}}`} {
		t.Run(body, func(t *testing.T) {
			kg := &documentWriteHandlerKnowledge{}
			h := &KnowledgeHandler{
				kgService: kg,
				kbService: &stubKBService{get: func(context.Context, string) (*types.KnowledgeBase, error) {
					return &types.KnowledgeBase{ID: "kb", TenantID: 7}, nil
				}},
			}
			r := documentHandlerRouter()
			r.PUT("/tags", h.UpdateKnowledgeTagBatch)
			req := httptest.NewRequest(http.MethodPut, "/tags", strings.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			require.Equal(t, 200, w.Code, w.Body.String())
			require.True(t, kg.called)
		})
	}
}

func TestSingleDocumentDeletePersistsAuthorizedKBInTask(t *testing.T) {
	q := &documentDeleteEnqueuer{}
	h := &KnowledgeHandler{kgService: &documentWriteHandlerKnowledge{}, asynqClient: q}
	r := documentHandlerRouter()
	r.DELETE("/:id", h.DeleteKnowledge)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodDelete, "/doc", nil))
	require.Equal(t, 200, w.Code, w.Body.String())
	require.NotNil(t, q.task)
	var payload types.KnowledgeListDeletePayload
	require.NoError(t, json.Unmarshal(q.task.Payload(), &payload))
	require.Equal(t, uint64(7), payload.TenantID)
	require.Equal(t, "kb", payload.KnowledgeBaseID)
	require.Equal(t, []string{"doc"}, payload.KnowledgeIDs)
}
