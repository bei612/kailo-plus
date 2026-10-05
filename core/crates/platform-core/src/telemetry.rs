//! 运维信号的导出（ADR-05）：应用侧只依赖 OpenTelemetry SDK，以 OTLP 交给
//! Collector，后端选择不进代码。
//!
//! 指标标签只用封闭枚举（`07` §3 禁高基数自由文本）。Collector 的允许清单是
//! 第二道防线，新增的标签键必须同时在那里登记，否则会被丢弃。

use opentelemetry_otlp::{MetricExporter, WithExportConfig};

/// The fixed MCP SDK logs unexpected native messages and HTTP error bodies.
/// They are not platform audit metadata. This hard boundary is independent of
/// RUST_LOG; Core's own bounded refusal classes and original audits remain.
pub(crate) fn safe_log_target(target: &str) -> bool {
    target != "rmcp" && !target.starts_with("rmcp::")
}

use opentelemetry_sdk::metrics::{PeriodicReader, SdkMeterProvider};
use opentelemetry_sdk::Resource;

/// 发布单元名，出现在每条信号的 resource 上。它是身份不是配置。
const SERVICE_NAME: &str = "platform-core";

/// 以 `OTEL_EXPORTER_OTLP_ENDPOINT` 建立指标导出。缺失即拒绝启动：没有导出
/// 的进程照样能跑，而投影落后与对账缺口就只剩没人看的日志（ADR-05「应用侧的
/// OTLP 导出从第一行服务代码起就有」）。导出周期取 SDK 的标准变量
/// `OTEL_METRIC_EXPORT_INTERVAL`。
pub fn init() -> Result<SdkMeterProvider, String> {
    let endpoint = std::env::var("OTEL_EXPORTER_OTLP_ENDPOINT")
        .map_err(|_| "缺少 OTEL_EXPORTER_OTLP_ENDPOINT".to_owned())?;
    let exporter = MetricExporter::builder()
        .with_http()
        .with_endpoint(format!("{}/v1/metrics", endpoint.trim_end_matches('/')))
        .build()
        .map_err(|e| format!("构造 OTLP 指标导出失败: {e}"))?;
    let provider = SdkMeterProvider::builder()
        .with_reader(PeriodicReader::builder(exporter).build())
        .with_resource(Resource::builder().with_service_name(SERVICE_NAME).build())
        .build();
    opentelemetry::global::set_meter_provider(provider.clone());
    Ok(provider)
}

#[cfg(test)]
mod log_privacy_tests {
    use super::*;

    #[test]
    fn native_payload_targets_cannot_escape_through_transport_or_service_logs() {
        for target in [
            "rmcp",
            "rmcp::transport::common::reqwest",
            "rmcp::service::client",
        ] {
            assert!(!safe_log_target(target));
        }
        for target in [
            "platform_core::application_binding::peer",
            "rmcp_metrics",
            "other::rmcp",
        ] {
            assert!(safe_log_target(target));
        }
    }
}
