package utils

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"go.opentelemetry.io/otel/propagation"
)

func TestApplyCustomHeaders_SkipReserved(t *testing.T) {
	req, _ := http.NewRequest("GET", "https://example.com", nil)
	req.Header.Set("Authorization", "Bearer original")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-goog-api-key", "google-original")

	ApplyCustomHeaders(req, map[string]string{
		"Authorization":  "Bearer injected",
		"Content-Type":   "text/plain",
		"x-goog-api-key": "google-injected",
		"X-Trace-Id":     "trace-123",
		"X-Route":        "edge",
		"":               "empty-key-should-be-skipped",
	})

	if got := req.Header.Get("Authorization"); got != "Bearer original" {
		t.Fatalf("authorization overwritten: %q", got)
	}
	if got := req.Header.Get("Content-Type"); got != "application/json" {
		t.Fatalf("content-type overwritten: %q", got)
	}
	if got := req.Header.Get("x-goog-api-key"); got != "google-original" {
		t.Fatalf("x-goog-api-key overwritten: %q", got)
	}
	if got := req.Header.Get("X-Trace-Id"); got != "trace-123" {
		t.Fatalf("X-Trace-Id not injected: %q", got)
	}
	if got := req.Header.Get("X-Route"); got != "edge" {
		t.Fatalf("X-Route not injected: %q", got)
	}
}

func TestApplyCustomHeaders_NilSafe(t *testing.T) {
	ApplyCustomHeaders(nil, map[string]string{"x": "y"})
	req, _ := http.NewRequest("GET", "https://example.com", nil)
	ApplyCustomHeaders(req, nil)
	if len(req.Header) != 0 {
		t.Fatalf("unexpected headers added: %+v", req.Header)
	}
}

func TestWrapHTTPClientWithHeaders(t *testing.T) {
	t.Setenv("SSRF_WHITELIST", "127.0.0.1,::1,localhost")
	ResetSSRFWhitelistForTest()
	t.Cleanup(ResetSSRFWhitelistForTest)
	gotTrace := ""
	gotAuth := ""
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotTrace = r.Header.Get("X-Trace-Id")
		gotAuth = r.Header.Get("Authorization")
		io.Copy(io.Discard, r.Body)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	client := WrapHTTPClientWithHeaders(nil, map[string]string{
		"X-Trace-Id":    "rt-1",
		"Authorization": "Bearer should-not-override",
	})

	req, _ := http.NewRequest("POST", srv.URL, strings.NewReader("{}"))
	req.Header.Set("Authorization", "Bearer kept")

	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	resp.Body.Close()

	if gotTrace != "rt-1" {
		t.Fatalf("expected custom header injected, got %q", gotTrace)
	}
	if gotAuth != "Bearer kept" {
		t.Fatalf("reserved header must not be overridden, got %q", gotAuth)
	}
}

func TestWrapHTTPClientWithHeaders_EmptyPreservesContextTransport(t *testing.T) {
	orig := &http.Client{}
	wrapped := WrapHTTPClientWithHeaders(orig, nil)
	if wrapped == orig || orig.Transport != nil {
		t.Fatalf("expected an independent context transport without mutating the original client")
	}
	if _, ok := wrapped.Transport.(*CustomHeadersRoundTripper); !ok {
		t.Fatalf("empty static headers must still install the live context transport")
	}
}

func TestKailoNativeContextTransportWithNoStaticHeaders(t *testing.T) {
	const traceparent = "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01"
	gotTrace := ""
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotTrace = r.Header.Get("traceparent")
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()
	ctx := propagation.TraceContext{}.Extract(context.Background(), propagation.MapCarrier{"traceparent": traceparent})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, srv.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	client := WrapHTTPClientWithHeaders(srv.Client(), nil)
	response, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if gotTrace != traceparent || req.Header.Get("traceparent") != "" {
		t.Fatalf("actual SDK transport: trace=%q; caller request was mutated=%t", gotTrace, req.Header.Get("traceparent") != "")
	}
}
