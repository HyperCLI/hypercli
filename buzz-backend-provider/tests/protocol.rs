use std::fs;

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
        .with_body(r#"{"items":[]}"#)
        .create();
    let create = server
        .mock("POST", "/agents/deployments")
        .match_header("authorization", "Bearer fixture-hypercli-credential")
        .match_body(Matcher::PartialJsonString(
            serde_json::json!({
                "handle": handle,
                "name": format!("fizz-{}", &TEST_PUBLIC_HEX[..8]),
                "runtime": "opencode",
                "command": ["/usr/local/bin/buzz-acp"],
                "env": {
                    "BUZZ_RELAY_URL": "wss://buzz.example.com",
                    "BUZZ_PRIVATE_KEY": "nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqsmhltgl",
                    "BUZZ_ACP_AGENT_COMMAND": "/usr/local/bin/opencode",
                    "BUZZ_ACP_AGENT_ARGS": "acp",
                    "BUZZ_ACP_MCP_COMMAND": "/usr/local/bin/buzz-dev-mcp",
                    "BUZZ_ACP_LAZY_POOL": "true",
                    "BUZZ_ACP_RELAY_OBSERVER": "true",
                    "BUZZ_ACP_SESSION_TITLE": "Fizz",
                    "RUST_LOG": "info,pool::prompt=info,acp::stream=info"
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
fn dry_run_binary_covers_every_hosted_runtime_shape() {
    let handle = format!("buzz-{}", &TEST_PUBLIC_HEX[..48]);
    for (runtime, agent_command, image, child_command, child_args, mcp_command) in [
        (
            "opencode",
            "opencode",
            "ghcr.io/hypercli/hypercli-opencode:latest",
            "/usr/local/bin/opencode",
            "acp",
            "/usr/local/bin/buzz-dev-mcp",
        ),
        (
            "codex",
            "codex-acp",
            "ghcr.io/hypercli/hypercli-codex:latest",
            "/usr/local/bin/codex-acp",
            "",
            "/usr/local/bin/buzz-dev-mcp",
        ),
        (
            "claude-code",
            "claude-agent-acp",
            "ghcr.io/hypercli/hypercli-claude-code:latest",
            "/usr/local/bin/claude-agent-acp",
            "",
            "",
        ),
        (
            "goose",
            "goose",
            "ghcr.io/hypercli/hypercli-goose:latest",
            "/usr/local/bin/goose",
            "acp",
            "",
        ),
        (
            "kimi-code",
            "kimi",
            "ghcr.io/hypercli/hypercli-kimi-code:latest",
            "/usr/local/bin/kimi",
            "acp",
            "",
        ),
    ] {
        let mut server = Server::new();
        let trace_dir = tempfile::tempdir().unwrap();
        let trace_file = trace_dir.path().join(format!("{runtime}.jsonl"));
        let lookup = server
            .mock("GET", "/agents/deployments")
            .match_query(Matcher::UrlEncoded("handle".into(), handle.clone()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"items":[]}"#)
            .create();
        let expected = serde_json::json!({
            "name": format!("fizz-{}", &TEST_PUBLIC_HEX[..8]),
            "handle": handle,
            "runtime": runtime,
            "size": "large",
            "tags": [format!("buzz_agent={TEST_PUBLIC_HEX}")],
            "env": {
                "MODEL_API_KEY": "fixture-model-credential",
                "BUZZ_PRIVATE_KEY":
                    "nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqsmhltgl",
                "NOSTR_PRIVATE_KEY":
                    "nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqsmhltgl",
                "BUZZ_RELAY_URL": "wss://buzz.example.com",
                "BUZZ_AUTH_TAG": "[\"auth\",\"fixture\"]",
                "BUZZ_ACP_AGENT_COMMAND": child_command,
                "BUZZ_ACP_AGENT_ARGS": child_args,
                "BUZZ_ACP_MCP_COMMAND": mcp_command,
                "BUZZ_ACP_LAZY_POOL": "true",
                "BUZZ_ACP_RELAY_OBSERVER": "true",
                "BUZZ_ACP_SESSION_TITLE": "Fizz",
                "BUZZ_ACP_SYSTEM_PROMPT": "Build carefully",
                "BUZZ_ACP_MODEL": "fixture-model",
                "BUZZ_ACP_IDLE_TIMEOUT": "900",
                "BUZZ_ACP_MAX_TURN_DURATION": "7200",
                "BUZZ_ACP_AGENTS": "3",
                "BUZZ_ACP_RESPOND_TO": "owner-only",
                "BUZZ_ACP_MULTIPLE_EVENT_HANDLING": "steer",
                "BUZZ_ACP_DEDUP": "queue",
                "RUST_LOG": "debug",
                "HYPER_WORKSPACES_BOOT_SYNC": "1",
                "HYPER_WORKSPACES_DIR": "/home/node/workspaces",
                "HYPER_WORKSPACES_SYNC_READY_ONLY": "1",
                "HYPER_WORKSPACES_SYNC_WORKSPACE": "fixture-workspace"
            },
            "command": ["/usr/local/bin/buzz-acp"],
            "image": image,
            "sync_root": "/home/node",
            "sync_enabled": true,
            "sync_uid": 1000,
            "sync_gid": 1000,
            "start": true,
            "dry_run": true
        });
        let create = server
            .mock("POST", "/agents/deployments")
            .match_body(Matcher::JsonString(expected.to_string()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "id": format!("dry-run-{runtime}"),
                    "runtime": runtime,
                    "state": "pending"
                })
                .to_string(),
            )
            .create();
        let request = serde_json::json!({
            "op": "deploy",
            "request_id": format!("dry-run-{runtime}"),
            "agent": {
                "name": "Fizz",
                "relay_url": "wss://buzz.example.com",
                "private_key_nsec":
                    "nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqsmhltgl",
                "auth_tag": "[\"auth\",\"fixture\"]",
                "agent_command": agent_command,
                "agent_args": if child_args.is_empty() {
                    Vec::<String>::new()
                } else {
                    vec![child_args.to_owned()]
                },
                "system_prompt": "Build carefully",
                "model": "fixture-model",
                "idle_timeout_seconds": 900,
                "max_turn_duration_seconds": 7200,
                "parallelism": 3,
                "respond_to": "owner-only",
                "env_vars": {
                    "MODEL_API_KEY": "fixture-model-credential",
                    "BUZZ_RELAY_URL": "wss://attacker.invalid",
                    "BUZZ_ACP_AGENT_COMMAND": "/tmp/not-the-harness",
                    "BUZZ_ACP_SETUP_PAYLOAD": "forged",
                    "RUST_LOG": "debug"
                }
            },
            "provider_config": {
                "runtime": runtime,
                "size": "large",
                "workspace": "fixture-workspace"
            }
        });

        let output = Command::cargo_bin("buzz-backend-hypercli")
            .unwrap()
            .arg("--dry-run")
            .env("HYPER_AGENTS_API_KEY", "fixture-hypercli-credential")
            .env("AGENTS_API_BASE_URL", format!("{}/agents", server.url()))
            .env("HYPER_HTTP_TRACE_FILE", &trace_file)
            .write_stdin(request.to_string())
            .output()
            .unwrap();

        assert!(
            output.status.success(),
            "{runtime}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        let response: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(response["agent_id"], format!("dry-run-{runtime}"));
        let trace = fs::read_to_string(trace_file).unwrap();
        assert!(trace.contains(r#""operation":"create_deployment""#));
        assert!(trace.contains(r#""dry_run":true"#));
        assert!(trace.contains(&format!(r#""runtime":"{runtime}""#)));
        assert!(trace.contains(r#""BUZZ_PRIVATE_KEY":"<redacted>""#));
        assert!(trace.contains(r#""MODEL_API_KEY":"<redacted>""#));
        assert!(!trace.contains("nsec1qqqq"));
        assert!(!trace.contains("fixture-model-credential"));
        lookup.assert();
        create.assert();
    }
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

#[test]
fn stop_request_runs_the_provider_http_contract() {
    let mut server = Server::new();
    let stop = server
        .mock("POST", "/agents/deployments/deployment-1/stop")
        .match_header("authorization", "Bearer fixture-hypercli-credential")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "id": "deployment-1",
                "runtime": "opencode",
                "state": "stopped"
            })
            .to_string(),
        )
        .create();

    let output = Command::cargo_bin("buzz-backend-hypercli")
        .unwrap()
        .env("HYPER_AGENTS_API_KEY", "fixture-hypercli-credential")
        .env("AGENTS_API_BASE_URL", format!("{}/agents", server.url()))
        .write_stdin(
            serde_json::json!({
                "op": "stop",
                "request_id": "fixture-stop-1",
                "agent_id": "deployment-1"
            })
            .to_string(),
        )
        .output()
        .unwrap();

    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let response: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(response["agent_id"], "deployment-1");
    stop.assert();
}
