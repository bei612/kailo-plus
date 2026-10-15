package activities

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"apps/worker/internal/oidc"
	"go.temporal.io/sdk/temporal"
)

// Core 的确定持久化拒绝（422 PERSISTENCE_REJECTED）停止重试；普通 422 仍是请求
// 拒绝；503（含 40001 串行化冲突、连接与超时）仍交给 RetryPolicy。
func TestCorePostStopsOnPersistenceRejectionAndRetriesUnavailable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/token":
			_, _ = io.WriteString(w, `{"access_token":"isolated-worker","expires_in":300}`)
		case "/persistence":
			w.WriteHeader(http.StatusUnprocessableEntity)
			_, _ = io.WriteString(w, `{"code":"PERSISTENCE_REJECTED","sqlstate":"23514","constraint":"task_projection_execution_trace_check"}`)
		case "/invalid":
			w.WriteHeader(http.StatusUnprocessableEntity)
			_, _ = io.WriteString(w, `{"code":"INVALID_PARAMETERS"}`)
		default:
			w.WriteHeader(http.StatusServiceUnavailable)
		}
	}))
	defer server.Close()
	t.Setenv("OIDC_TOKEN_URL", server.URL+"/token")
	t.Setenv("OIDC_WORKER_CLIENT_ID", "isolated-worker")
	t.Setenv("OIDC_WORKER_CLIENT_SECRET", "isolated-fixture")
	tokens, err := oidc.FromEnv()
	if err != nil {
		t.Fatal(err)
	}
	api := &CoreAPI{base: server.URL, tokens: tokens, http: server.Client()}

	var app *temporal.ApplicationError
	err = api.post(context.Background(), "/persistence", struct{}{}, nil)
	if !errors.As(err, &app) || app.Type() != ErrTypePersistenceRejected || !app.NonRetryable() ||
		!strings.Contains(app.Error(), "task_projection_execution_trace_check") || !IsDeterministicFailure(err) {
		t.Fatalf("persistence rejection must stop retrying with its constraint: %v", err)
	}
	err = api.post(context.Background(), "/invalid", struct{}{}, nil)
	if !errors.As(err, &app) || app.Type() != ErrTypeRejected || !app.NonRetryable() {
		t.Fatalf("other 422 stays an ordinary rejection: %v", err)
	}
	err = api.post(context.Background(), "/unavailable", struct{}{}, nil)
	if err == nil || errors.As(err, &app) || IsDeterministicFailure(err) {
		t.Fatalf("503 must remain retryable: %v", err)
	}
}
