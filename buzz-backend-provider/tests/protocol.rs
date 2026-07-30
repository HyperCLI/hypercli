use std::fs;

use assert_cmd::Command;
use buzz_backend_hypercli::{derive_agent_pubkey, ProviderRequest};
use mockito::{Matcher, Server};

const INFO_FIXTURE: &str = include_str!("fixtures/info-request.json");
const INFO_RESPONSE_FIXTURE: &str = include_str!("fixtures/info-response.json");
const DEPLOY_FIXTURE: &str = include_str!("fixtures/deploy-request.json");
const DEPLOY_RESPONSE_FIXTURE: &str = include_str!("fixtures/deploy-response.json");
const TEST_PUBLIC_HEX: &str = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";

fn assert_stock_stdout(output: std::process::Output) -> serde_json::Value {
    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.ends_with('\n'));
    assert_eq!(stdout.lines().count(), 1);
    serde_json::from_str(stdout.trim_end()).unwrap()
}

#[test]
fn info_fixture_is_a_one_shot_json_exchange() {
    let output = Command::cargo_bin("buzz-backend-hypercli")
        .unwrap()
        .write_stdin(INFO_FIXTURE)
        .output()
        .unwrap();
    let response = assert_stock_stdout(output);
    let expected: serde_json::Value = serde_json::from_str(INFO_RESPONSE_FIXTURE).unwrap();
    assert_eq!(response, expected);
    assert_eq!(
        response["config_schema"]["properties"]["runtime"]["enum"],
        serde_json::json!(["opencode", "codex", "claude-code", "goose", "kimi-code"])
    );
    assert_eq!(
        response["config_schema"]["properties"]["size"]["enum"],
        serde_json::json!(["large"])
    );
}

#[test]
fn info_probe_is_repeatable_without_authentication_or_network_access() {
    let expected: serde_json::Value = serde_json::from_str(INFO_RESPONSE_FIXTURE).unwrap();
    for _ in 0..8 {
        let output = Command::cargo_bin("buzz-backend-hypercli")
            .unwrap()
            .env_remove("HYPER_AGENTS_API_KEY")
            .env_remove("HYPER_API_KEY")
            .write_stdin(INFO_FIXTURE)
            .output()
            .unwrap();
        assert_eq!(assert_stock_stdout(output), expected);
    }
}

#[test]
fn captured_deploy_fixture_preserves_stock_buzz_field_shape() {
    let request: serde_json::Value = serde_json::from_str(DEPLOY_FIXTURE).unwrap();
    assert_eq!(
        request
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect::<Vec<_>>(),
        ["agent", "op", "provider_config", "request_id"]
    );
    assert_eq!(
        request["agent"]
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect::<Vec<_>>(),
        [
            "agent_args",
            "agent_command",
            "auth_tag",
            "env_vars",
            "idle_timeout_seconds",
            "max_turn_duration_seconds",
            "model",
            "name",
            "parallelism",
            "private_key_nsec",
            "provider",
            "relay_url",
            "respond_to",
            "respond_to_allowlist",
            "system_prompt",
            "turn_timeout_seconds",
        ]
    );
    assert_eq!(request["agent"]["agent_args"], serde_json::json!([]));
    assert_eq!(
        request["agent"]["idle_timeout_seconds"],
        serde_json::Value::Null
    );
    assert_eq!(
        request["agent"]["max_turn_duration_seconds"],
        serde_json::Value::Null
    );
    assert_eq!(request["agent"]["model"], serde_json::Value::Null);
    assert_eq!(request["agent"]["provider"], serde_json::Value::Null);
    assert_eq!(request["agent"]["system_prompt"], serde_json::Value::Null);
    assert_eq!(request["agent"]["parallelism"], 10);
    assert_eq!(request["agent"]["turn_timeout_seconds"], 320);
    assert_eq!(
        request["provider_config"],
        serde_json::json!({
            "image": "",
            "runtime": "opencode",
            "size": "large",
            "workspace": ""
        })
    );
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
fn deploy_fixture_returns_control_plane_acceptance_for_a_pending_agent() {
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
                "name": format!("fixture-agent-{}", &TEST_PUBLIC_HEX[..8]),
                "runtime": "opencode",
                "image": "ghcr.io/hypercli/hypercli-buzz-opencode:latest",
                "command": ["/usr/local/bin/buzz-acp"],
                "restart": false,
                "env": {
                    "BUZZ_RELAY_URL": "wss://buzz.example.invalid",
                    "BUZZ_PRIVATE_KEY": "nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqsmhltgl",
                    "BUZZ_ACP_AGENT_COMMAND": "/usr/local/bin/opencode",
                    "BUZZ_ACP_AGENT_ARGS": "acp",
                    "BUZZ_ACP_MCP_COMMAND": "/usr/local/bin/buzz-dev-mcp",
                    "BUZZ_ACP_LAZY_POOL": "true",
                    "BUZZ_ACP_RELAY_OBSERVER": "true",
                    "BUZZ_ACP_SESSION_TITLE": "Fixture Agent",
                    "BUZZ_ACP_IDLE_TIMEOUT": "320",
                    "BUZZ_ACP_AGENTS": "10",
                    "BUZZ_ACP_RESPOND_TO": "owner-only",
                    "RUST_LOG": "buzz_acp=info,pool::prompt=info,acp::stream=off"
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
    let response = assert_stock_stdout(output);
    let expected: serde_json::Value = serde_json::from_str(DEPLOY_RESPONSE_FIXTURE).unwrap();
    assert_eq!(response, expected);
    // Stock Buzz marks the agent "deployed" as soon as this ID is returned.
    // A pending backend response does not mean buzz-acp or its worker pool is ready.
    lookup.assert();
    create.assert();
}

#[test]
fn dry_run_binary_validates_every_hosted_runtime_request_shape() {
    let handle = format!("buzz-{}", &TEST_PUBLIC_HEX[..48]);
    for (runtime, agent_command, image, child_command, child_args, mcp_command) in [
        (
            "opencode",
            "opencode",
            "ghcr.io/hypercli/hypercli-buzz-opencode:latest",
            "/usr/local/bin/opencode",
            "acp",
            "/usr/local/bin/buzz-dev-mcp",
        ),
        (
            "codex",
            "codex-acp",
            "ghcr.io/hypercli/hypercli-buzz-codex:latest",
            "/usr/local/bin/codex-acp",
            "",
            "/usr/local/bin/buzz-dev-mcp",
        ),
        (
            "claude-code",
            "claude-agent-acp",
            "ghcr.io/hypercli/hypercli-buzz-claude:latest",
            "/usr/local/bin/claude-agent-acp",
            "",
            "",
        ),
        (
            "goose",
            "goose",
            "ghcr.io/hypercli/hypercli-buzz-goose:latest",
            "/usr/local/bin/goose",
            "acp",
            "",
        ),
        (
            "kimi-code",
            "kimi",
            "ghcr.io/hypercli/hypercli-buzz-kimi-code:latest",
            "/usr/local/bin/kimi",
            "acp",
            "",
        ),
    ] {
        let mut server = Server::new();
        let trace_dir = tempfile::tempdir().unwrap();
        let trace_file = trace_dir.path().join(format!("{runtime}.jsonl"));
        let mut expected = serde_json::json!({
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
                "BUZZ_ACP_IDLE_TIMEOUT": "320",
                "BUZZ_ACP_MAX_TURN_DURATION": "7200",
                "BUZZ_ACP_AGENTS": "3",
                "BUZZ_ACP_RESPOND_TO": "allowlist",
                "BUZZ_ACP_RESPOND_TO_ALLOWLIST":
                    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
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
            "restart": false,
            "start": true,
            "dry_run": true
        });
        if runtime == "goose" {
            expected["env"]["GOOSE_MODEL"] = serde_json::json!("fixture-model");
            expected["env"]["GOOSE_PROVIDER"] = serde_json::json!("fixture-provider");
        }
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
                "provider": "fixture-provider",
                "turn_timeout_seconds": 320,
                "max_turn_duration_seconds": 7200,
                "parallelism": 3,
                "respond_to": "allowlist",
                "respond_to_allowlist": [
                    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
                ],
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
