use std::time::Duration;

use crate::*;

#[apply(schema!)]
#[derive(Default, Eq, PartialEq)]
#[cfg_attr(feature = "schema", schemars(rename = "TimeoutPolicy"))]
pub struct Policy {
	/// Maximum time allowed from the start of downstream request processing until response headers
	/// are received. The response body is not included; use `responseIdleTimeout` to bound gaps
	/// between body frames.
	#[serde(
		default,
		skip_serializing_if = "Option::is_none",
		with = "serde_dur_option"
	)]
	#[cfg_attr(feature = "schema", schemars(with = "Option<String>"))]
	pub request_timeout: Option<Duration>,
	/// Maximum time allowed for the upstream backend request.
	#[serde(
		default,
		skip_serializing_if = "Option::is_none",
		with = "serde_dur_option"
	)]
	#[cfg_attr(feature = "schema", schemars(with = "Option<String>"))]
	pub backend_request_timeout: Option<Duration>,
	/// Maximum time to wait for a frame from the upstream response body.
	///
	/// Limits how long the gateway waits for more response data from the backend.
	/// Time spent processing the response or waiting for the client to receive it does not count.
	///
	/// This complements the other two rather than overlapping them: both `requestTimeout` and
	/// `backendRequestTimeout` stop applying once the response headers arrive, so neither places
	/// any bound on how long the response body may take, and neither can distinguish a stalled
	/// stream from a slow one.
	///
	/// The timeout is disabled when this field is unset or set to zero. It does not apply to
	/// responses that switch protocols, so upgraded WebSocket and CONNECT tunnels are never
	/// terminated by it.
	#[serde(
		default,
		skip_serializing_if = "Option::is_none",
		with = "serde_dur_option"
	)]
	#[cfg_attr(feature = "schema", schemars(with = "Option<String>"))]
	pub response_idle_timeout: Option<Duration>,
	/// After a downstream disconnect, maximum time to finish reading an already dispatched
	/// LLM stream for its original usage log. No request is replayed. Shutdown stops the drain.
	/// Unset preserves immediate cancellation; zero is invalid. Missing usage remains unknown.
	/// Streams with active streaming response guards retain immediate cancellation, because
	/// polling those guards can dispatch further webhook or moderation requests.
	#[serde(
		default,
		skip_serializing_if = "Option::is_none",
		serialize_with = "serde_dur_option::serialize",
		deserialize_with = "deserialize_usage_drain_timeout"
	)]
	#[cfg_attr(feature = "schema", schemars(with = "Option<String>"))]
	pub streaming_usage_drain_timeout: Option<Duration>,
}

fn deserialize_usage_drain_timeout<'de, D: serde::Deserializer<'de>>(
	deserializer: D,
) -> Result<Option<Duration>, D::Error> {
	let duration = serde_dur_option::deserialize(deserializer)?;
	if duration.is_some_and(|d| d.is_zero()) {
		return Err(serde::de::Error::custom(
			"streamingUsageDrainTimeout must be nonzero",
		));
	}
	Ok(duration)
}

/// Internal response extension. Only the actual LLM streaming consumer may enable this.
#[derive(Clone, Copy)]
pub(crate) struct StreamingUsageDrain(pub Duration);

/// Attach the idle timeout to the upstream body before response processing.
pub fn apply_response_idle_timeout(
	mut response: crate::http::Response,
	timeout: Duration,
) -> crate::http::Response {
	response.body_mut().set_idle_timeout(timeout);
	response
}

#[cfg(test)]
mod tests {
	use std::convert::Infallible;

	use bytes::Bytes;
	use futures_util::StreamExt;
	use http_body_util::BodyExt;

	use super::*;

	#[test]
	fn streaming_usage_drain_policy_preserves_absence_and_rejects_zero() {
		let absent: Policy = serde_json::from_str("{}").unwrap();
		assert_eq!(absent.streaming_usage_drain_timeout, None);
		let null: Policy = serde_json::from_str(r#"{"streamingUsageDrainTimeout":null}"#).unwrap();
		assert_eq!(null.streaming_usage_drain_timeout, None);
		let configured: Policy =
			serde_json::from_str(r#"{"streamingUsageDrainTimeout":"2s"}"#).unwrap();
		assert_eq!(
			configured.streaming_usage_drain_timeout,
			Some(Duration::from_secs(2))
		);
		for invalid in ["0s", "-1s", "invalid"] {
			assert!(
				serde_json::from_value::<Policy>(serde_json::json!({
					"streamingUsageDrainTimeout": invalid
				}))
				.is_err()
			);
		}
	}

	#[tokio::test(start_paused = true)]
	async fn idle_body_times_out() {
		let pending = futures_util::stream::pending::<Result<Bytes, Infallible>>();
		let mut body = apply_response_idle_timeout(
			crate::http::Response::new(crate::http::Body::from_stream(pending)),
			Duration::from_secs(1),
		)
		.into_body();

		let error = body
			.frame()
			.await
			.expect("timeout should produce a body frame")
			.expect_err("an idle body should time out");

		assert_eq!(error.to_string(), "response idle timeout");
	}

	#[tokio::test(start_paused = true)]
	async fn each_frame_restarts_the_idle_window() {
		// Four frames spaced just inside the window: the body outlives the timeout several times
		// over, but is never idle for a full window.
		let frames = futures_util::stream::iter(0..4).then(|_| async {
			tokio::time::sleep(Duration::from_millis(800)).await;
			Ok::<_, Infallible>(Bytes::from_static(b"data"))
		});
		let body = apply_response_idle_timeout(
			crate::http::Response::new(crate::http::Body::from_stream(frames)),
			Duration::from_secs(1),
		)
		.into_body();

		let collected = body
			.collect()
			.await
			.expect("frames arriving inside the window should not time out");
		assert_eq!(
			collected.to_bytes(),
			Bytes::from_static(b"datadatadatadata")
		);
	}
}
