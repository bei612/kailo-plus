package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Tencent/WeKnora/internal/types"
	"github.com/Tencent/WeKnora/internal/types/interfaces"
	"github.com/gin-gonic/gin"
)

type stubDataSourceService struct {
	interfaces.DataSourceService
	getSyncLogs            func(ctx context.Context, dsID string, limit int, offset int) ([]*types.SyncLog, error)
	getDataSource          func(ctx context.Context, id string) (*types.DataSource, error)
	listFileStorageSources func(ctx context.Context, kbID string) ([]types.Resource, error)
}

func (s *stubDataSourceService) ListFileStorageSources(ctx context.Context, kbID string) ([]types.Resource, error) {
	return s.listFileStorageSources(ctx, kbID)
}

func (s *stubDataSourceService) GetSyncLogs(ctx context.Context, dsID string, limit int, offset int) ([]*types.SyncLog, error) {
	if s.getSyncLogs != nil {
		return s.getSyncLogs(ctx, dsID, limit, offset)
	}
	return nil, nil
}

func (s *stubDataSourceService) GetDataSource(ctx context.Context, id string) (*types.DataSource, error) {
	if s.getDataSource != nil {
		return s.getDataSource(ctx, id)
	}
	return nil, nil
}

type stubKBServiceForDS struct {
	interfaces.KnowledgeBaseService
	getByID func(ctx context.Context, id string) (*types.KnowledgeBase, error)
}

func (s *stubKBServiceForDS) GetKnowledgeBaseByID(ctx context.Context, id string) (*types.KnowledgeBase, error) {
	if s.getByID != nil {
		return s.getByID(ctx, id)
	}
	return nil, nil
}

func newDataSourceTestRouter(h *DataSourceHandler) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(errorCapture())
	r.Use(func(c *gin.Context) {
		if tenantID, ok := c.Request.Context().Value(types.TenantIDContextKey).(uint64); ok {
			c.Set(types.TenantIDContextKey.String(), tenantID)
		}
		c.Next()
	})
	r.GET("/datasource/:id/logs", h.GetSyncLogs)
	r.GET("/datasource/types", h.GetAvailableConnectors)
	return r
}

func TestFileStorageConnectorMetadataRequiresOwnedKnowledgeBase(t *testing.T) {
	for _, scenario := range []string{"available", "static", "missing-tenant", "different-tenant", "unavailable", "empty"} {
		t.Run(scenario, func(t *testing.T) {
			calls := 0
			service := &stubDataSourceService{listFileStorageSources: func(_ context.Context, kbID string) ([]types.Resource, error) {
				calls++
				if kbID != "owned-kb" {
					t.Fatalf("unexpected KB: %s", kbID)
				}
				if scenario == "unavailable" {
					return nil, fmt.Errorf("private service failure with secret detail")
				}
				if scenario == "empty" {
					return []types.Resource{}, nil
				}
				return []types.Resource{{ExternalID: "approved-resource", Name: "Approved source"}}, nil
			}}
			kbService := &stubKBServiceForDS{getByID: func(context.Context, string) (*types.KnowledgeBase, error) {
				tenantID := uint64(1)
				if scenario == "different-tenant" {
					tenantID = 2
				}
				return &types.KnowledgeBase{ID: "owned-kb", TenantID: tenantID}, nil
			}}
			path := "/datasource/types?kb_id=owned-kb"
			if scenario == "static" {
				path = "/datasource/types"
			}
			request := httptest.NewRequest(http.MethodGet, path, nil)
			if scenario != "missing-tenant" {
				request = withDSCtx(request, 1)
			}
			response := httptest.NewRecorder()
			newDataSourceTestRouter(NewDataSourceHandler(service, kbService)).ServeHTTP(response, request)
			want := http.StatusOK
			if scenario == "missing-tenant" {
				want = http.StatusUnauthorized
			}
			if scenario == "different-tenant" {
				want = http.StatusForbidden
			}
			if scenario == "unavailable" {
				want = http.StatusServiceUnavailable
			}
			if response.Code != want {
				t.Fatalf("status=%d want=%d body=%s", response.Code, want, response.Body.String())
			}
			if want != http.StatusOK {
				if scenario != "unavailable" && calls != 0 {
					t.Fatal("source discovery preceded native scope authorization")
				}
				if scenario == "unavailable" && response.Body.String() != "{\"error\":\"authorized source discovery is unavailable\"}" {
					t.Fatal("private failure detail leaked")
				}
				return
			}
			var connectors []struct {
				Type      string           `json:"type"`
				Resources []types.Resource `json:"resources"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &connectors); err != nil {
				t.Fatal(err)
			}
			found := false
			for _, connector := range connectors {
				if connector.Type == "file_storage" {
					found = true
					if len(connector.Resources) != 1 {
						t.Fatal("missing actual sources")
					}
				}
			}
			if found != (scenario == "available") {
				t.Fatalf("file_storage visibility=%v", found)
			}
			if scenario == "static" && calls != 0 {
				t.Fatal("static original connector list performed a service request")
			}
		})
	}
}

func withDSCtx(req *http.Request, tenantID uint64) *http.Request {
	ctx := req.Context()
	ctx = context.WithValue(ctx, types.TenantIDContextKey, tenantID)
	return req.WithContext(ctx)
}

func TestDataSource_GetSyncLogs_ValidLimitWithinBounds(t *testing.T) {
	var capturedLimit, capturedOffset int
	dsSvc := &stubDataSourceService{
		getDataSource: func(_ context.Context, id string) (*types.DataSource, error) {
			return &types.DataSource{ID: id, KnowledgeBaseID: "kb1"}, nil
		},
		getSyncLogs: func(_ context.Context, _ string, limit int, offset int) ([]*types.SyncLog, error) {
			capturedLimit = limit
			capturedOffset = offset
			return []*types.SyncLog{
				{ID: "log1", DataSourceID: "ds1"},
			}, nil
		},
	}
	kbSvc := &stubKBServiceForDS{
		getByID: func(_ context.Context, _ string) (*types.KnowledgeBase, error) {
			return &types.KnowledgeBase{ID: "kb1", TenantID: 1}, nil
		},
	}
	h := NewDataSourceHandler(dsSvc, kbSvc)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/datasource/ds1/logs?limit=50&offset=25", nil)
	req = withDSCtx(req, 1)
	newDataSourceTestRouter(h).ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", w.Code, w.Body.String())
	}
	if capturedLimit != 50 {
		t.Fatalf("expected limit=50, got %d", capturedLimit)
	}
	if capturedOffset != 25 {
		t.Fatalf("expected offset=25, got %d", capturedOffset)
	}
}

func TestDataSource_GetSyncLogs_LimitExceedingMaximum(t *testing.T) {
	dsSvc := &stubDataSourceService{
		getDataSource: func(_ context.Context, id string) (*types.DataSource, error) {
			return &types.DataSource{ID: id, KnowledgeBaseID: "kb1"}, nil
		},
		getSyncLogs: func(_ context.Context, _ string, _ int, _ int) ([]*types.SyncLog, error) {
			t.Fatalf("service must not be called when limit exceeds maximum")
			return nil, nil
		},
	}
	kbSvc := &stubKBServiceForDS{
		getByID: func(_ context.Context, _ string) (*types.KnowledgeBase, error) {
			return &types.KnowledgeBase{ID: "kb1", TenantID: 1}, nil
		},
	}
	h := NewDataSourceHandler(dsSvc, kbSvc)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/datasource/ds1/logs?limit=999", nil)
	req = withDSCtx(req, 1)
	newDataSourceTestRouter(h).ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for limit > 100, got %d body=%s", w.Code, w.Body.String())
	}
	var resp map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	errMsg, ok := resp["error"].(string)
	if !ok || errMsg == "" {
		t.Fatalf("expected error message in response")
	}
	if errMsg != "limit must be between 1 and 100" {
		t.Fatalf("expected specific error message, got %q", errMsg)
	}
}

func TestDataSource_GetSyncLogs_MissingLimitDefaultsCorrectly(t *testing.T) {
	var capturedLimit, capturedOffset int
	dsSvc := &stubDataSourceService{
		getDataSource: func(_ context.Context, id string) (*types.DataSource, error) {
			return &types.DataSource{ID: id, KnowledgeBaseID: "kb1"}, nil
		},
		getSyncLogs: func(_ context.Context, _ string, limit int, offset int) ([]*types.SyncLog, error) {
			capturedLimit = limit
			capturedOffset = offset
			return []*types.SyncLog{}, nil
		},
	}
	kbSvc := &stubKBServiceForDS{
		getByID: func(_ context.Context, _ string) (*types.KnowledgeBase, error) {
			return &types.KnowledgeBase{ID: "kb1", TenantID: 1}, nil
		},
	}
	h := NewDataSourceHandler(dsSvc, kbSvc)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/datasource/ds1/logs", nil)
	req = withDSCtx(req, 1)
	newDataSourceTestRouter(h).ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", w.Code, w.Body.String())
	}
	if capturedLimit != 10 {
		t.Fatalf("expected default limit=10, got %d", capturedLimit)
	}
	if capturedOffset != 0 {
		t.Fatalf("expected default offset=0 (page 1), got %d", capturedOffset)
	}
}

func TestDataSource_GetSyncLogs_NonNumericLimitRejected(t *testing.T) {
	dsSvc := &stubDataSourceService{
		getDataSource: func(_ context.Context, id string) (*types.DataSource, error) {
			return &types.DataSource{ID: id, KnowledgeBaseID: "kb1"}, nil
		},
		getSyncLogs: func(_ context.Context, _ string, _ int, _ int) ([]*types.SyncLog, error) {
			t.Fatalf("service must not be called with non-numeric limit")
			return nil, nil
		},
	}
	kbSvc := &stubKBServiceForDS{
		getByID: func(_ context.Context, _ string) (*types.KnowledgeBase, error) {
			return &types.KnowledgeBase{ID: "kb1", TenantID: 1}, nil
		},
	}
	h := NewDataSourceHandler(dsSvc, kbSvc)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/datasource/ds1/logs?limit=abc", nil)
	req = withDSCtx(req, 1)
	newDataSourceTestRouter(h).ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for non-numeric limit, got %d body=%s", w.Code, w.Body.String())
	}
}

func TestDataSource_GetSyncLogs_ZeroLimitRejected(t *testing.T) {
	dsSvc := &stubDataSourceService{
		getDataSource: func(_ context.Context, id string) (*types.DataSource, error) {
			return &types.DataSource{ID: id, KnowledgeBaseID: "kb1"}, nil
		},
		getSyncLogs: func(_ context.Context, _ string, _ int, _ int) ([]*types.SyncLog, error) {
			t.Fatalf("service must not be called with limit=0")
			return nil, nil
		},
	}
	kbSvc := &stubKBServiceForDS{
		getByID: func(_ context.Context, _ string) (*types.KnowledgeBase, error) {
			return &types.KnowledgeBase{ID: "kb1", TenantID: 1}, nil
		},
	}
	h := NewDataSourceHandler(dsSvc, kbSvc)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/datasource/ds1/logs?limit=0", nil)
	req = withDSCtx(req, 1)
	newDataSourceTestRouter(h).ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for limit=0, got %d body=%s", w.Code, w.Body.String())
	}
}

func TestDataSource_GetSyncLogs_NegativeLimitRejected(t *testing.T) {
	dsSvc := &stubDataSourceService{
		getDataSource: func(_ context.Context, id string) (*types.DataSource, error) {
			return &types.DataSource{ID: id, KnowledgeBaseID: "kb1"}, nil
		},
		getSyncLogs: func(_ context.Context, _ string, _ int, _ int) ([]*types.SyncLog, error) {
			t.Fatalf("service must not be called with negative limit")
			return nil, nil
		},
	}
	kbSvc := &stubKBServiceForDS{
		getByID: func(_ context.Context, _ string) (*types.KnowledgeBase, error) {
			return &types.KnowledgeBase{ID: "kb1", TenantID: 1}, nil
		},
	}
	h := NewDataSourceHandler(dsSvc, kbSvc)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/datasource/ds1/logs?limit=-5", nil)
	req = withDSCtx(req, 1)
	newDataSourceTestRouter(h).ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for negative limit, got %d body=%s", w.Code, w.Body.String())
	}
}
