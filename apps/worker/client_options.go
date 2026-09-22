package main

import (
	"context"
	"fmt"
	"os"

	"go.temporal.io/sdk/client"
)

// bearerHeaders 把服务令牌注入每个 gRPC 请求的 authorization 头。
//
// 不用 SDK 的 NewAPIKeyStaticCredentials：它在 TLS 未显式设置时自动开启 TLS
// （internal/client.go 的 apiKeyCredentials.applyToOptions），把传输层决策
// 和凭据注入耦合在一起。传输层是否加密由部署拓扑决定，不由凭据形式决定。
type bearerHeaders struct{ token string }

func (b bearerHeaders) GetHeaders(context.Context) (map[string]string, error) {
	return map[string]string{"authorization": "Bearer " + b.token}, nil
}

// clientOptionsFromEnv 构造连接 Temporal 的选项。
//
// Temporal 公开 frontend 启用了 default authorizer，没有 claims 的非 health API
// 一律被拒（SF-TMP-06）。令牌由 OIDC 提供方以 client_credentials 签发，
// permissions 声明携带 "<namespace>:<role>"。缺令牌即拒绝启动，不降级为无凭据连接。
func clientOptionsFromEnv() (client.Options, error) {
	addr := os.Getenv("TEMPORAL_ADDRESS")
	if addr == "" {
		addr = client.DefaultHostPort
	}
	token := os.Getenv("TEMPORAL_TOKEN")
	if token == "" {
		return client.Options{}, fmt.Errorf("缺少 TEMPORAL_TOKEN：Temporal 已启用 authorizer，无凭据连接会被拒绝")
	}
	return client.Options{
		HostPort:        addr,
		Namespace:       os.Getenv("TEMPORAL_NAMESPACE"),
		HeadersProvider: bearerHeaders{token: token},
	}, nil
}
