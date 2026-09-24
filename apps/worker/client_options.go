package main

import (
	"context"
	"fmt"
	"os"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	"github.com/kailo/apps/worker/internal/oidc"
	"go.temporal.io/sdk/client"
)

// bearerHeaders 把服务令牌注入每个 gRPC 请求的 authorization 头。
//
// 每次请求都向 Source 要一次，而不是启动时取一张存着：本部署签发 900 秒的
// 令牌，长期运行的 Worker 持静态令牌只是把失败推迟到第一次续期之后。
// Source 自己缓存到期前的令牌，因此这不会变成每请求一次 IdP 往返。
//
// 不用 SDK 的 NewAPIKeyStaticCredentials：它在 TLS 未显式设置时自动开启 TLS
// （internal/client.go 的 apiKeyCredentials.applyToOptions），把传输层决策
// 和凭据注入耦合在一起。传输层是否加密由部署拓扑决定，不由凭据形式决定。
type bearerHeaders struct{ src *oidc.Source }

func (b bearerHeaders) GetHeaders(ctx context.Context) (map[string]string, error) {
	token, err := b.src.Token(ctx)
	if err != nil {
		return nil, err
	}
	return map[string]string{"authorization": "Bearer " + token}, nil
}

// clientOptionsFromEnv 构造连接 Temporal 的选项。
//
// Temporal 公开 frontend 启用了 default authorizer，没有 claims 的非 health API
// 一律被拒（SF-TMP-06）。令牌由 OIDC 提供方以 client_credentials 签发，
// permissions 声明携带 "<namespace>:<role>"。取不到令牌即拒绝启动，
// 不降级为无凭据连接。
func clientOptionsFromEnv(src *oidc.Source) (client.Options, error) {
	addr := os.Getenv("TEMPORAL_ADDRESS")
	if addr == "" {
		return client.Options{}, fmt.Errorf("缺少 TEMPORAL_ADDRESS")
	}
	ns := os.Getenv("TEMPORAL_NAMESPACE")
	if ns == "" {
		return client.Options{}, fmt.Errorf("缺少 TEMPORAL_NAMESPACE：namespace 决定 permissions 声明的解析，写错即全部调用被拒")
	}
	return client.Options{
		HostPort:        addr,
		Namespace:       ns,
		HeadersProvider: bearerHeaders{src: src},
		ConnectionOptions: client.ConnectionOptions{
			DialOptions: []grpc.DialOption{
				grpc.WithChainUnaryInterceptor(retryOnStaleToken(src)),
			},
		},
	}, nil
}

// retryOnStaleToken 在 Temporal 以认证失败拒绝一次调用时，丢弃缓存的令牌、以新令牌
// 替换本次请求的 authorization 再试一次。
//
// IdP 轮换签名密钥后，缓存里那张令牌永远不会再被接受；不这样做，Worker 会一直
// 失败到令牌自然过期为止。直接改写本次请求的 metadata，而不依赖拦截器的先后
// 顺序——HeadersProvider 可能已经把旧令牌写进去了。第二次仍被拒就是真的无权。
func retryOnStaleToken(src *oidc.Source) grpc.UnaryClientInterceptor {
	return func(ctx context.Context, method string, req, reply any,
		cc *grpc.ClientConn, invoker grpc.UnaryInvoker, opts ...grpc.CallOption) error {
		err := invoker(ctx, method, req, reply, cc, opts...)
		switch status.Code(err) {
		case codes.Unauthenticated, codes.PermissionDenied:
		default:
			return err
		}
		src.Invalidate()
		token, terr := src.Token(ctx)
		if terr != nil {
			return err
		}
		md, _ := metadata.FromOutgoingContext(ctx)
		md = md.Copy()
		md.Set("authorization", "Bearer "+token)
		return invoker(metadata.NewOutgoingContext(ctx, md), method, req, reply, cc, opts...)
	}
}
