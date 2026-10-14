use hypercli_sdk::{
    runner_api_base_from_control_url, runner_client_config, ClientConfig, HyperCliClient,
    RunnerRegisterRequest,
};
use secrecy::ExposeSecret;
use serde_json::Value;

#[test]
fn shared_registration_construction_and_response() {
    let fixture: Value =
        serde_json::from_str(include_str!("fixtures/runner_registration.json")).unwrap();
    let mut server = mockito::Server::new();
    let client = HyperCliClient::new(ClientConfig {
        api_base: format!("{}/prefix/agents", server.url()).parse().unwrap(),
        api_key: "key".into(),
        trace_file: None,
        timeout: None,
    })
    .unwrap();
    let runtime = tokio::runtime::Runtime::new().unwrap();
    for known in [false, true] {
        let mut body = fixture["request"].clone();
        if known {
            body["runner_id"] = fixture["runner_id"].clone();
        }
        let mut response = fixture["request"].clone();
        response["runner_id"] = fixture["runner_id"].clone();
        response["owner_user_id"] = "owner".into();
        let mock = server
            .mock("POST", "/prefix/agents/runners")
            .match_header("authorization", "Bearer key")
            .match_body(mockito::Matcher::Json(body.clone()))
            .with_status(200)
            .with_body(response.to_string())
            .expect(1)
            .create();
        let request: RunnerRegisterRequest = serde_json::from_value(body).unwrap();
        let runner = runtime
            .block_on(client.runners().register(&request))
            .unwrap();
        assert_eq!(runner.runner_id, fixture["runner_id"]);
        mock.assert();
    }
}

#[test]
fn custom_control_authority_and_token_are_preserved_for_registration() {
    for (control, expected) in [
        (
            "wss://api.agents.hypercli.com/ws/runners",
            "https://api.hypercli.com/agents",
        ),
        (
            "wss://api.agents.dev.hypercli.com/ws/runners",
            "https://api.dev.hypercli.com/agents",
        ),
        (
            "ws://127.0.0.1:1234/prefix/ws/runners",
            "http://127.0.0.1:1234/prefix/agents",
        ),
        ("wss://custom.test/control", "https://custom.test/agents"),
    ] {
        let url = format!("{control}?token=inline%26key#fragment");
        let base = runner_api_base_from_control_url(&url).unwrap();
        assert_eq!(base.as_str(), expected);
        let config = runner_client_config(&url, base).unwrap();
        assert_eq!(config.api_key.expose_secret(), "inline&key");
    }
}
