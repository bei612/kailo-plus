package langfuse

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Tencent/WeKnora/internal/utils"
	"github.com/gin-gonic/gin"
	"github.com/hibiken/asynq"
)

const kailoTestTraceparent = "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01"

// Actual middleware/enqueue/worker/header consumers, with the optional native
// exporter disabled. No Redis, Gateway, provider or model request is sent.
func TestKailoNativeCorrelationWithoutLangfuse(t *testing.T) {
	_, _ = Init(Config{Enabled: false})
	router := gin.New()
	router.Use(GinMiddleware())
	router.POST("/api/v1/knowledge-bases/:id/knowledge/file", func(c *gin.Context) {
		payload := &dummyPayload{KnowledgeID: "native-task-knowledge"}
		InjectTracing(c.Request.Context(), payload)
		if payload.LangfuseTraceparent != kailoTestTraceparent {
			t.Fatalf("native task lost originating trace: %q", payload.LangfuseTraceparent)
		}
		raw, err := json.Marshal(payload)
		if err != nil {
			t.Fatal(err)
		}
		called := false
		worker := AsynqMiddleware()(asynq.HandlerFunc(func(ctx context.Context, task *asynq.Task) error {
			called = true
			req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://gateway.example/embeddings", nil)
			if err != nil {
				return err
			}
			utils.ApplyCustomHeaders(req, map[string]string{"traceparent": "static-model-spoof", "Authorization": "wrong"})
			if req.Header.Get("traceparent") != kailoTestTraceparent {
				t.Fatalf("native model request lost task trace: %q", req.Header.Get("traceparent"))
			}
			if req.Header.Get("Authorization") != "" {
				t.Fatal("correlation hook changed provider authentication")
			}
			return nil
		}))
		if err := worker.ProcessTask(context.Background(), asynq.NewTask("document:process", raw)); err != nil {
			t.Fatal(err)
		}
		if !called {
			t.Fatal("actual native task handler was not called")
		}
		c.Status(http.StatusNoContent)
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/knowledge-bases/kb/knowledge/file", nil)
	req.Header.Set("traceparent", kailoTestTraceparent)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, req)
	if response.Code != http.StatusNoContent {
		t.Fatalf("native consumer status=%d", response.Code)
	}
}

func TestKailoNativeCorrelationRejectsMalformedCarrier(t *testing.T) {
	_, _ = Init(Config{Enabled: false})
	worker := AsynqMiddleware()(asynq.HandlerFunc(func(ctx context.Context, _ *asynq.Task) error {
		req, _ := http.NewRequestWithContext(ctx, http.MethodPost, "https://gateway.example/embeddings", nil)
		utils.ApplyCustomHeaders(req, map[string]string{"traceparent": kailoTestTraceparent})
		if req.Header.Get("traceparent") != "" {
			t.Fatal("invalid task context or static model field invented a trace")
		}
		return nil
	}))
	if err := worker.ProcessTask(context.Background(), asynq.NewTask("document:process", []byte(`{"lf_traceparent":"malformed"}`))); err != nil {
		t.Fatal(err)
	}
}
