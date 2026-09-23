package main

import (
	"context"
	"fmt"
	"os"

	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	"go.temporal.io/sdk/client"
	temporalotel "go.temporal.io/sdk/contrib/opentelemetry"
)

// serviceName 是发布单元名，出现在每条信号的 resource 上。它是身份不是配置。
const serviceName = "kailo-worker"

// initMetrics 以 OTLP 导出 Temporal SDK 的指标（ADR-05：应用侧只依赖 OTLP，
// 后端选择不进代码）。Activity 的尝试次数、失败与调度延迟都由 SDK 自己发出，
// 卡在重试里的收敛因此看得见。
//
// endpoint 与导出周期取 SDK 的标准变量 OTEL_EXPORTER_OTLP_ENDPOINT 与
// OTEL_METRIC_EXPORT_INTERVAL；前者缺失即拒绝启动，不静默地不导出。
func initMetrics(ctx context.Context) (*sdkmetric.MeterProvider, client.MetricsHandler, error) {
	if os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT") == "" {
		return nil, nil, fmt.Errorf("缺少 OTEL_EXPORTER_OTLP_ENDPOINT")
	}
	exporter, err := otlpmetrichttp.New(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("构造 OTLP 指标导出失败: %w", err)
	}
	provider := sdkmetric.NewMeterProvider(
		sdkmetric.WithReader(sdkmetric.NewPeriodicReader(exporter)),
		sdkmetric.WithResource(resource.NewSchemaless(semconv.ServiceName(serviceName))),
	)
	handler := temporalotel.NewMetricsHandler(temporalotel.MetricsHandlerOptions{
		Meter: provider.Meter(serviceName),
	})
	return provider, handler, nil
}
