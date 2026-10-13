package activities

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"apps/worker/internal/oidc"
)

// Core 的成功回应超过错误摘录上界时仍须完整解码；非 200 的错误消息仍按上界截取。
func TestCorePostReadsWholeSuccessBodyAndBoundsErrorExcerpt(t *testing.T) {
	large := strings.Repeat("x", 4*errorExcerptBytes)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/token":
			_, _ = io.WriteString(w, `{"access_token":"isolated-worker","expires_in":300}`)
		case "/ok":
			_, _ = io.WriteString(w, `{"state":"`+large+`"}`)
		default:
			w.WriteHeader(http.StatusConflict)
			_, _ = io.WriteString(w, large)
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

	var out SecretRefRehomeResult
	if err := api.post(context.Background(), "/ok", struct{}{}, &out); err != nil || out.State != large {
		t.Fatalf("large success body not decoded: err=%v len=%d", err, len(out.State))
	}
	err = api.post(context.Background(), "/conflict", struct{}{}, nil)
	if err == nil || len(err.Error()) > 2*errorExcerptBytes {
		t.Fatalf("error excerpt not bounded: %d bytes", len(err.Error()))
	}
}
