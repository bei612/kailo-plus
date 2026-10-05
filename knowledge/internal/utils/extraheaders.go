package utils

import (
	"net/http"
	"strings"

	"go.opentelemetry.io/otel/propagation"
)

// reservedHeaderKeys 列出不允许被用户自定义头覆盖的关键请求头。
// 这些头由各 provider 的签名、鉴权或 SSE 流程控制，覆盖后可能直接导致调用失败。
var reservedHeaderKeys = map[string]struct{}{
	"authorization":     {},
	"api-key":           {},
	"x-api-key":         {},
	"x-goog-api-key":    {},
	"content-type":      {},
	"content-length":    {},
	"accept-encoding":   {},
	"host":              {},
	"connection":        {},
	"transfer-encoding": {},
	// Correlation belongs to the live request/task, never a static model row.
	"traceparent": {},
	"tracestate":  {},
}

// IsReservedHeader 判断某个 header key 是否为保留 header，保留 header 不允许被自定义头覆盖。
func IsReservedHeader(key string) bool {
	_, ok := reservedHeaderKeys[strings.ToLower(strings.TrimSpace(key))]
	return ok
}

// ApplyCustomHeaders 将用户自定义的 header 写入 http.Request。
// 保留 header（Authorization、api-key、Content-Type 等）会被跳过以避免破坏鉴权/签名。
// 其它 header 会直接覆盖同名条目，允许用户替换默认值（例如 Accept）。
func ApplyCustomHeaders(req *http.Request, headers map[string]string) {
	if req == nil {
		return
	}
	if req.Header == nil {
		req.Header = make(http.Header)
	}
	for k, v := range headers {
		name := strings.TrimSpace(k)
		if name == "" {
			continue
		}
		if IsReservedHeader(name) {
			continue
		}
		req.Header.Set(name, v)
	}
	// The actual Chat/Embedding/Rerank callers all retain the original context.
	// Invalid/missing contexts inject nothing; this is not a billing authority.
	propagation.TraceContext{}.Inject(req.Context(), propagation.HeaderCarrier(req.Header))
}

// CustomHeadersRoundTripper 是一个 http.RoundTripper 包装器，
// 会在每个 HTTP 请求发出前注入用户自定义的 header。
// 用于无法直接拿到底层 *http.Request 的场景（如 go-openai SDK）。
type CustomHeadersRoundTripper struct {
	Headers map[string]string
	Base    http.RoundTripper
}

// RoundTrip 实现 http.RoundTripper 接口。
func (t *CustomHeadersRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	base := t.Base
	if base == nil {
		base = http.DefaultTransport
	}
	// Clone even with no static headers: the live request can carry correlation.
	cloned := req.Clone(req.Context())
	ApplyCustomHeaders(cloned, t.Headers)
	return base.RoundTrip(cloned)
}

// WrapHTTPClientWithHeaders 返回一个新的 *http.Client，在原有 client 基础上注入自定义 header。
// 空静态 headers 仍包装 transport，以传播逐请求 context。
func WrapHTTPClientWithHeaders(client *http.Client, headers map[string]string) *http.Client {
	if client == nil {
		client = NewSSRFSafeHTTPClient(DefaultSSRFSafeHTTPClientConfig())
	}
	base := client.Transport
	if base == nil {
		base = http.DefaultTransport
	}
	wrapped := *client
	wrapped.Transport = &CustomHeadersRoundTripper{Headers: headers, Base: base}
	return &wrapped
}
