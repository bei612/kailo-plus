//! DD-149 protocol acceptance against an independent third-party MCP server
//! (`deploy/local/mcp-connector-test/server.py`). Ignored by default; the CI acceptance
//! script runs it with `MCP_ACCEPTANCE_*` pointing at isolated test containers and
//! `KAILO_EXTERNAL_MCP_DEV_CIDRS` naming only the test network (V-SCN-240–246).

use serde_json::{json, Map, Value};

use crate::mcp_client::{
    call_tool, probe, tools_digest, Credential, Limits, McpError, Target, Transport,
};
use crate::mcp_egress::{parse_endpoint, EgressError, EgressScope, PlatformEgress};

fn env(key: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| panic!("{key} is required for the acceptance run"))
}

fn platform() -> PlatformEgress {
    PlatformEgress::from_env().expect("egress configuration")
}

fn args(value: Value) -> Map<String, Value> {
    value.as_object().cloned().unwrap()
}

fn texts(result: &Value) -> Vec<String> {
    result["content"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|c| c["text"].as_str().map(str::to_owned))
        .collect()
}

#[tokio::test]
#[ignore = "acceptance: needs the CI connector test peers"]
async fn api_key_peer_probe_call_label_and_refusal() {
    let platform = platform();
    let scope = EgressScope {
        platform: &platform,
        tenant_suffixes: &[],
    };
    let url = parse_endpoint(&env("MCP_ACCEPTANCE_APIKEY_URL")).unwrap();
    let good = Credential {
        header: "x-api-key".into(),
        value: env("MCP_ACCEPTANCE_API_KEY"),
    };
    let wrong = Credential {
        header: "x-api-key".into(),
        value: "wrong-key".into(),
    };
    // V-SCN-240: a wrong key is a definite refusal before any tool is listed.
    let refused = probe(&Target {
        url: &url,
        transport: Transport::StreamableHttp,
        credential: Some(&wrong),
        scope,
        limits: Limits::probe(),
    })
    .await;
    assert!(
        matches!(refused, Err(McpError::Unauthorized { .. })),
        "{refused:?}"
    );
    let target = Target {
        url: &url,
        transport: Transport::StreamableHttp,
        credential: Some(&good),
        scope,
        limits: Limits::probe(),
    };
    let listed = probe(&target).await.expect("probe");
    assert_eq!(listed.server.name.as_deref(), Some("kailo-connector-test"));
    let names: Vec<&str> = listed.tools.iter().map(|t| t.name.as_str()).collect();
    for expected in ["echo", "add_note", "delete_notes", "inject"] {
        assert!(names.contains(&expected), "{names:?}");
    }
    // Annotation-based suggestions (DD-149(7)).
    let risk = |name: &str| {
        super::Risk::suggested(
            &listed
                .tools
                .iter()
                .find(|t| t.name == name)
                .unwrap()
                .annotations,
        )
    };
    assert_eq!(risk("echo"), super::Risk::ReadOnly);
    assert_eq!(risk("add_note"), super::Risk::Write);
    assert_eq!(risk("delete_notes"), super::Risk::Destructive);
    assert_eq!(
        tools_digest(&listed.tools),
        tools_digest(&probe(&target).await.unwrap().tools)
    );

    let call = Target {
        limits: Limits::call(),
        ..target
    };
    let echoed = call_tool(&call, "echo", args(json!({"text":"hello"})))
        .await
        .unwrap();
    assert_eq!(texts(&echoed), vec!["hello"]);
    let saved = call_tool(&call, "add_note", args(json!({"note":"n1"})))
        .await
        .unwrap();
    assert!(texts(&saved)[0].starts_with("saved"));
    // V-SCN-242: untrusted content is labelled and non-text content dropped.
    let injected = call_tool(&call, "inject", Map::new()).await.unwrap();
    let tool = super::tool::ExternalTool {
        resource_id: uuid::Uuid::new_v4(),
        name: "test__inject".into(),
        upstream_name: "inject".into(),
        title: None,
        description: None,
        input_schema: json!({"type":"object"}),
        action_key: super::INVOKE.into(),
        risk: "READ_ONLY".into(),
        mcp_connection_id: uuid::Uuid::new_v4(),
        display_name: "Acceptance".into(),
        endpoint_host: url.host_str().unwrap().into(),
        active_generation: 1,
        tenant_id: uuid::Uuid::new_v4(),
    };
    let labelled = super::tool::label(&tool, &injected);
    let lines = texts(&labelled);
    assert!(lines[0].contains("untrusted"));
    assert!(lines
        .iter()
        .any(|l| l.contains("IGNORE ALL PREVIOUS INSTRUCTIONS")));
    assert!(lines.iter().any(|l| l.contains("image")));
    assert!(!labelled.to_string().contains("\"data\""));
}

#[tokio::test]
#[ignore = "acceptance: needs the CI connector test peers"]
async fn legacy_sse_transport_round_trip() {
    let platform = platform();
    let scope = EgressScope {
        platform: &platform,
        tenant_suffixes: &[],
    };
    let url = parse_endpoint(&env("MCP_ACCEPTANCE_SSE_URL")).unwrap();
    let credential = Credential {
        header: "x-api-key".into(),
        value: env("MCP_ACCEPTANCE_API_KEY"),
    };
    let target = Target {
        url: &url,
        transport: Transport::Sse,
        credential: Some(&credential),
        scope,
        limits: Limits::probe(),
    };
    let listed = probe(&target).await.expect("legacy probe");
    assert!(listed.tools.iter().any(|t| t.name == "echo"));
    let echoed = call_tool(&target, "echo", args(json!({"text":"over sse"})))
        .await
        .unwrap();
    assert_eq!(texts(&echoed), vec!["over sse"]);
}

#[tokio::test]
#[ignore = "acceptance: needs the CI connector test peers"]
async fn egress_refuses_private_and_metadata_targets_without_dev_networks() {
    // V-SCN-241: the production policy (no dev CIDRs) refuses the test network itself,
    // loopback, link-local metadata and plain http before any request is sent.
    let production = PlatformEgress {
        dev_cidrs: Vec::new(),
        ..platform()
    };
    let scope = EgressScope {
        platform: &production,
        tenant_suffixes: &[],
    };
    for raw in [
        env("MCP_ACCEPTANCE_APIKEY_URL"),
        "https://127.0.0.1/mcp".into(),
        "https://169.254.169.254/latest".into(),
        "https://[::1]/mcp".into(),
        "https://10.0.0.1/mcp".into(),
    ] {
        let url = parse_endpoint(&raw).unwrap();
        let refused = crate::mcp_egress::resolve(&scope, &url).await;
        assert!(
            matches!(
                refused,
                Err(EgressError::SchemeNotAllowed | EgressError::AddressNotAllowed)
            ),
            "{raw}: {refused:?}"
        );
    }
    for raw in [
        "https://localhost/mcp",
        "https://user:pw@example.com/mcp",
        "https://example.com/mcp?key=1",
        "https://metadata/x",
    ] {
        assert!(parse_endpoint(raw).is_err(), "{raw}");
    }
    // A Tenant allowlist outside the host refuses it too.
    let platform = platform();
    let narrow = ["example.com".to_owned()];
    let scope = EgressScope {
        platform: &platform,
        tenant_suffixes: &narrow,
    };
    let url = parse_endpoint(&env("MCP_ACCEPTANCE_APIKEY_URL")).unwrap();
    assert_eq!(
        crate::mcp_egress::resolve(&scope, &url).await,
        Err(EgressError::NotInAllowlist)
    );
}

#[tokio::test]
#[ignore = "acceptance: needs the CI connector test peers"]
async fn oauth_discovery_registration_pkce_exchange_and_refresh() {
    let platform = platform();
    let scope = EgressScope {
        platform: &platform,
        tenant_suffixes: &[],
    };
    let url = parse_endpoint(&env("MCP_ACCEPTANCE_OAUTH_URL")).unwrap();
    // V-SCN-246: without a token the peer answers 401 with resource metadata.
    let anonymous = probe(&Target {
        url: &url,
        transport: Transport::StreamableHttp,
        credential: None,
        scope,
        limits: Limits::probe(),
    })
    .await;
    assert!(
        matches!(
            anonymous,
            Err(McpError::Unauthorized {
                resource_metadata: Some(_),
                ..
            })
        ),
        "{anonymous:?}"
    );
    let server = crate::mcp_oauth::discover(&scope, &url, Transport::StreamableHttp, None, None)
        .await
        .expect("discovery");
    assert_eq!(server.resource, url.as_str());
    let redirect = "https://kailo.example/api/v1/mcp-connections/oauth/callback";
    let client = crate::mcp_oauth::register(&scope, &server, redirect, "Kailo")
        .await
        .expect("registration");
    let pkce = crate::mcp_oauth::pkce();
    let state = crate::mcp_oauth::random_state();
    let authorize = crate::mcp_oauth::authorization_url(
        &server,
        &client.client_id,
        redirect,
        &state,
        &pkce.challenge,
    );
    // The browser step: the test AS consents automatically and redirects with the code.
    let browser = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .build()
        .unwrap();
    let answer = browser.get(authorize.as_str()).send().await.unwrap();
    assert_eq!(answer.status().as_u16(), 302);
    let location = reqwest::Url::parse(answer.headers()["location"].to_str().unwrap()).unwrap();
    let query: std::collections::HashMap<_, _> = location.query_pairs().into_owned().collect();
    assert_eq!(query["state"], state);
    // A wrong verifier is refused (PKCE), the right one exchanges once.
    let wrong = crate::mcp_oauth::exchange(
        &scope,
        &server,
        &client,
        &query["code"],
        "wrong-verifier",
        redirect,
    )
    .await;
    assert!(wrong.is_err());
    let answer = browser.get(authorize.as_str()).send().await.unwrap();
    let location = reqwest::Url::parse(answer.headers()["location"].to_str().unwrap()).unwrap();
    let query: std::collections::HashMap<_, _> = location.query_pairs().into_owned().collect();
    let tokens = crate::mcp_oauth::exchange(
        &scope,
        &server,
        &client,
        &query["code"],
        &pkce.verifier,
        redirect,
    )
    .await
    .expect("exchange");
    let replay = crate::mcp_oauth::exchange(
        &scope,
        &server,
        &client,
        &query["code"],
        &pkce.verifier,
        redirect,
    )
    .await;
    assert!(replay.is_err(), "a code is single use");
    let bearer = |tokens: &crate::mcp_oauth::TokenSet| Credential {
        header: "authorization".into(),
        value: format!("Bearer {}", tokens.access_token),
    };
    let credential = bearer(&tokens);
    let target = Target {
        url: &url,
        transport: Transport::StreamableHttp,
        credential: Some(&credential),
        scope,
        limits: Limits::call(),
    };
    let echoed = call_tool(&target, "echo", args(json!({"text":"oauth"})))
        .await
        .unwrap();
    assert_eq!(texts(&echoed), vec!["oauth"]);
    // Refresh rotates; the old refresh token is then an invalid grant.
    let old_refresh = tokens.refresh_token.clone().unwrap();
    let refreshed = crate::mcp_oauth::refresh(&scope, &server, &client, &old_refresh)
        .await
        .expect("refresh");
    assert_ne!(refreshed.access_token, tokens.access_token);
    assert_eq!(
        crate::mcp_oauth::refresh(&scope, &server, &client, &old_refresh).await,
        Err(crate::mcp_oauth::OAuthError::InvalidGrant)
    );
    let credential = bearer(&refreshed);
    let target = Target {
        credential: Some(&credential),
        ..target
    };
    assert!(call_tool(&target, "echo", args(json!({"text":"again"})))
        .await
        .is_ok());
}
