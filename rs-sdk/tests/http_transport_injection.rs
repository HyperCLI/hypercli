//! Caller-owned HTTP policy must reach both ordinary API calls and JWT issuance.
//! No app preferences or proxy defaults belong in the SDK.
use hypercli_sdk::{
    issue_api_key_from_jwt_with_http_clients, ClientConfig, HyperCliClient,
    IssueApiKeyFromJwtOptions,
};
use reqwest::header::{HeaderMap, HeaderValue};
use secrecy::SecretString;
use url::Url;

fn clients() -> (reqwest::blocking::Client, reqwest::Client) {
    let mut headers = HeaderMap::new();
    headers.insert("x-caller-transport", HeaderValue::from_static("injected"));
    (
        reqwest::blocking::Client::builder()
            .no_proxy()
            .default_headers(headers.clone())
            .build()
            .unwrap(),
        reqwest::Client::builder()
            .no_proxy()
            .default_headers(headers)
            .build()
            .unwrap(),
    )
}

#[test]
fn custom_http_client_is_used_for_authenticated_requests() {
    let mut server = mockito::Server::new();
    let response = server
        .mock("GET", "/agents/deployments")
        .match_header("x-caller-transport", "injected")
        .match_header("authorization", "Bearer test-key")
        .with_status(200)
        .with_body("[]")
        .create();
    let (http, async_http) = clients();
    let client = HyperCliClient::with_http_clients(
        ClientConfig {
            api_base: Url::parse(&format!("{}/agents", server.url())).unwrap(),
            api_key: SecretString::from("test-key"),
            trace_file: None,
            timeout: None,
        },
        Url::parse(&server.url()).unwrap(),
        http,
        async_http,
    )
    .unwrap();
    assert!(client.list_deployments().unwrap().is_empty());
    response.assert();
}

#[test]
fn jwt_issuance_uses_the_same_injected_transport_contract() {
    let mut server = mockito::Server::new();
    let response = server.mock("POST", "/api/keys")
        .match_header("x-caller-transport", "injected")
        .match_header("authorization", "Bearer test-jwt")
        .with_status(200)
        .with_body(r#"{"key_id":"issued","name":"test","tags":["agents:*"],"api_key":"test-issued","created_at":1,"is_active":true}"#)
        .create();
    let mut options = IssueApiKeyFromJwtOptions::new(vec!["agents:*".into()]);
    options.api_url = Some(server.url());
    let (http, async_http) = clients();
    let issued =
        issue_api_key_from_jwt_with_http_clients("test-jwt", options, http, async_http).unwrap();
    assert_eq!(issued.api_key.as_deref(), Some("test-issued"));
    response.assert();
}
