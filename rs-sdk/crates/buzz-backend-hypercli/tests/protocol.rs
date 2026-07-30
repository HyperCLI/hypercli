use assert_cmd::Command;
use buzz_backend_hypercli::{derive_agent_pubkey, ProviderRequest};
use mockito::{Matcher, Server};

const INFO_FIXTURE: &str = include_str!("fixtures/info-request.json");
const DEPLOY_FIXTURE: &str = include_str!("fixtures/deploy-request.json");
const TEST_PUBLIC_HEX: &str = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";

#[test]
fn info_fixture_is_a_one_shot_json_exchange() {
    let output = Command::cargo_bin("buzz-backend-hypercli")
        .unwrap()
        .write_stdin(INFO_FIXTURE)
        .output()
        .unwrap();
    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let response: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(response["ok"], true);
    assert_eq!(response["name"], "HyperCLI");
    assert_eq!(response["config_schema"]["additionalProperties"], false);
}

#[test]
fn deploy_fixture_contains_a_derivable_nsec_identity() {
    let request: ProviderRequest = serde_json::from_str(DEPLOY_FIXTURE).unwrap();
    let ProviderRequest::Deploy { agent, .. } = request else {
        panic!("deploy fixture parsed as another operation");
    };
    assert_eq!(
        derive_agent_pubkey(&agent.private_key_nsec).unwrap(),
        TEST_PUBLIC_HEX
    );
}

#[test]
fn deploy_fixture_runs_the_provider_http_contract() {
    let mut server = Server::new();
    let handle = format!("buzz-{}", &TEST_PUBLIC_HEX[..48]);
    let lookup = server
        .mock("GET", "/agents/deployments")
        .match_header("authorization", "Bearer fixture-hypercli-credential")
        .match_query(Matcher::UrlEncoded("handle".into(), handle.clone()))
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body("[]")
        .create();
    let create = server
        .mock("POST", "/agents/deployments")
        .match_header("authorization", "Bearer fixture-hypercli-credential")
        .match_body(Matcher::PartialJsonString(
            serde_json::json!({
                "handle": handle,
                "runtime": "opencode",
                "command": ["/usr/local/bin/buzz-acp"],
                "env": {
                    "BUZZ_RELAY_URL": "wss://buzz.example.com",
                    "BUZZ_PRIVATE_KEY": "nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqsmhltgl"
                }
            })
            .to_string(),
        ))
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "id":"fixture-deployment",
                "handle":format!("buzz-{}", &TEST_PUBLIC_HEX[..48]),
                "runtime":"opencode",
                "state":"pending"
            })
            .to_string(),
        )
        .create();

    let output = Command::cargo_bin("buzz-backend-hypercli")
        .unwrap()
        .env("HYPER_AGENTS_API_KEY", "fixture-hypercli-credential")
        .env("AGENTS_API_BASE_URL", format!("{}/agents", server.url()))
        .write_stdin(DEPLOY_FIXTURE)
        .output()
        .unwrap();
    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let response: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(response["agent_id"], "fixture-deployment");
    assert!(response.get("ok").is_none());
    lookup.assert();
    create.assert();
}

#[test]
fn malformed_request_returns_only_a_redacted_protocol_error() {
    let secret = "nsec1must-not-appear";
    let output = Command::cargo_bin("buzz-backend-hypercli")
        .unwrap()
        .write_stdin(format!(r#"{{"op":"deploy","agent":"{secret}"}}"#))
        .output()
        .unwrap();
    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let response: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(response["ok"], false);
    assert!(!String::from_utf8_lossy(&output.stdout).contains(secret));
}
