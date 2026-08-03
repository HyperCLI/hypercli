use std::fs;

use assert_cmd::Command;
use buzz_backend_hypercli::{derive_agent_pubkey, ProviderRequest};
use mockito::{Matcher, Server};

const INFO_FIXTURE: &str = include_str!("fixtures/info-request.json");
const INFO_RESPONSE_FIXTURE: &str = include_str!("fixtures/info-response.json");
const DEPLOY_FIXTURE: &str = include_str!("fixtures/deploy-request.json");
const DEPLOY_RESPONSE_FIXTURE: &str = include_str!("fixtures/deploy-response.json");
const TEST_PUBLIC_HEX: &str = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";

fn expected_info_response() -> serde_json::Value {
    let mut expected: serde_json::Value = serde_json::from_str(INFO_RESPONSE_FIXTURE).unwrap();
    expected["version"] = serde_json::json!(env!("CARGO_PKG_VERSION"));
    expected
}

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
    let expected = expected_info_response();
    assert_eq!(response, expected);
    assert_eq!(
        response["config_schema"]["properties"],
        serde_json::json!({})
    );
}

#[test]
fn info_probe_is_repeatable_without_authentication_or_network_access() {
    let expected = expected_info_response();
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
fn built_info_probe_ignores_optional_request_metadata() {
    for input in [
        serde_json::json!({"op": "info"}),
        serde_json::json!({"op": "info", "request_id": {"future": true}}),
    ] {
        let output = Command::cargo_bin("buzz-backend-hypercli")
            .unwrap()
            .write_stdin(input.to_string())
            .output()
            .unwrap();
        assert_eq!(assert_stock_stdout(output), expected_info_response());
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
            "launch",
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
    assert_eq!(request["provider_config"], serde_json::json!({}));
    assert_eq!(request["agent"]["launch"]["command"], "goose");
    assert_eq!(
        request["agent"]["launch"]["args"],
        serde_json::json!(["acp"])
    );
    assert_eq!(
        request["agent"]["launch"]["env"]["USER_KEY"],
        "launch-value"
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
fn deploy_fixture_waits_for_control_plane_readiness() {
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
                "runtime": "goose",
                "image": "ghcr.io/hypercli/hypercli-buzz-goose:latest",
                "command": ["/usr/local/bin/buzz-acp"],
                "restart": false,
                "runtime_scopes": [
                    "agents:none",
                    "files:*",
                    "flows:*",
                    "models:*",
                    "voice:*",
                    "web:*",
                    "workspaces:*"
                ],
                "env": {
                    "BUZZ_RELAY_URL": "wss://buzz.example.invalid",
                    "BUZZ_PRIVATE_KEY": "nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqsmhltgl",
                    "BUZZ_ACP_AGENT_COMMAND": "/usr/local/bin/goose",
                    "BUZZ_ACP_AGENT_ARGS": "acp",
                    "BUZZ_ACP_MCP_COMMAND": "",
                    "BUZZ_ACP_LAZY_POOL": "true",
                    "BUZZ_ACP_RELAY_OBSERVER": "true",
                    "BUZZ_ACP_DISPLAY_NAME": "Fixture Agent",
                    "BUZZ_ACP_TEXT_MENTIONS": "true",
                    "BUZZ_ACP_REQUIRE_REPLY": "true",
                    "BUZZ_ACP_SESSION_TITLE": "Fixture Agent",
                    "BUZZ_ACP_MODEL": "launch-model-override",
                    "BUZZ_ACP_AGENTS": "10",
                    "BUZZ_ACP_RESPOND_TO": "allowlist",
                    "BUZZ_ACP_RESPOND_TO_ALLOWLIST":
                        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    "GOOSE_MODE": "auto",
                    "GOOSE_MODEL": "fixture-model",
                    "GOOSE_PROVIDER": "fixture-provider",
                    "USER_KEY": "launch-value",
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
                "runtime":"goose",
                "state":"pending"
            })
            .to_string(),
        )
        .create();
    let ready = server
        .mock("GET", "/agents/deployments/fixture-deployment")
        .match_header("authorization", "Bearer fixture-hypercli-credential")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            serde_json::json!({
                "id":"fixture-deployment",
                "handle":format!("buzz-{}", &TEST_PUBLIC_HEX[..48]),
                "runtime":"goose",
                "state":"running"
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
    lookup.assert();
    create.assert();
    ready.assert();
}

#[test]
fn dry_run_binary_validates_every_hosted_runtime_request_shape() {
    let handle = format!("buzz-{}", &TEST_PUBLIC_HEX[..48]);
    let golden: serde_json::Value = serde_json::from_str(include_str!(
        "../../tests/fixtures/buzz-launch-contract.json"
    ))
    .unwrap();
    let common = &golden["common"];
    let nonce_rule = &golden["dynamic_env"]["BUZZ_MANAGED_AGENT_START_NONCE"];
    assert_eq!(nonce_rule["format"], "lowercase-hex");
    assert_eq!(nonce_rule["fresh_per_launch"], true);
    let nonce_length = nonce_rule["length"].as_u64().unwrap() as usize;
    for (runtime, contract) in golden["runtimes"].as_object().unwrap() {
        let agent_command = contract["stock_agent_command"].as_str().unwrap();
        let image = contract["image"].as_str().unwrap();
        let child_command = contract["agent_command"].as_str().unwrap();
        let child_args = contract["agent_args"].as_str().unwrap();
        let mcp_command = contract["mcp_command"].as_str().unwrap();
        let claude_code_executable = contract["claude_code_executable"].as_str();
        let mut server = Server::new();
        let trace_dir = tempfile::tempdir().unwrap();
        let trace_file = trace_dir.path().join(format!("{runtime}.jsonl"));
        let mut expected = serde_json::json!({
            "name": format!("fizz-{}", &TEST_PUBLIC_HEX[..8]),
            "handle": handle,
            "runtime": runtime,
            "size": common["size"].clone(),
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
                "BUZZ_ACP_DISPLAY_NAME": "Fizz",
                "BUZZ_ACP_TEXT_MENTIONS": "true",
                "BUZZ_ACP_REQUIRE_REPLY": "true",
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
            "command": common["command"].clone(),
            "image": image,
            "sync_root": common["sync_root"].clone(),
            "sync_enabled": common["sync_enabled"].clone(),
            "sync_uid": common["sync_uid"].clone(),
            "sync_gid": common["sync_gid"].clone(),
            "restart": common["restart"].clone(),
            "runtime_scopes": golden["runtime_scopes"].clone(),
            "start": true,
            "dry_run": true
        });
        if runtime == "goose" {
            expected["env"]["GOOSE_MODEL"] = serde_json::json!("fixture-model");
            expected["env"]["GOOSE_PROVIDER"] = serde_json::json!("fixture-provider");
        }
        if let Some(executable) = claude_code_executable {
            expected["env"]["CLAUDE_CODE_EXECUTABLE"] = serde_json::json!(executable);
        }
        let create = server
            .mock("POST", "/agents/deployments")
            .match_body(Matcher::AllOf(vec![
                Matcher::PartialJson(expected.clone()),
                Matcher::Regex(format!(
                    r#"\"BUZZ_MANAGED_AGENT_START_NONCE\":\"[0-9a-f]{{{nonce_length}}}\""#
                )),
            ]))
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
        let mut request = serde_json::json!({
            "op": "deploy",
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
                    "LEGACY_ONLY": "must-not-survive"
                },
                "launch": {
                    "command": agent_command,
                    "args": if child_args.is_empty() {
                        Vec::<String>::new()
                    } else {
                        vec![child_args.to_owned()]
                    },
                    "policy_env": {
                        "BUZZ_ACP_LAZY_POOL": "true",
                        "BUZZ_ACP_RELAY_OBSERVER": "true",
                        "BUZZ_ACP_SESSION_TITLE": "Fizz",
                        "BUZZ_ACP_SYSTEM_PROMPT": "Build carefully",
                        "BUZZ_ACP_MODEL": "policy-model",
                        "BUZZ_ACP_IDLE_TIMEOUT": "320",
                        "BUZZ_ACP_MAX_TURN_DURATION": "7200",
                        "BUZZ_ACP_AGENTS": "3"
                    },
                    "env": {
                        "MODEL_API_KEY": "fixture-model-credential",
                        "BUZZ_ACP_MODEL": "fixture-model",
                        "BUZZ_RELAY_URL": "wss://attacker.invalid",
                        "BUZZ_ACP_AGENT_COMMAND": "/tmp/not-the-harness",
                        "cLaUdE_cOdE_eXeCuTaBlE": "/tmp/not-claude",
                        "BUZZ_ACP_SETUP_PAYLOAD": "forged",
                        "RUST_LOG": "debug"
                    },
                    "owner_pubkey":
                        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
                }
            },
            "provider_config": {
                "workspace": "fixture-workspace"
            }
        });

        if runtime == "goose" {
            request["agent"]["launch"]["env"]["GOOSE_MODEL"] = serde_json::json!("fixture-model");
            request["agent"]["launch"]["env"]["GOOSE_PROVIDER"] =
                serde_json::json!("fixture-provider");
        }

        let mut command = Command::cargo_bin("buzz-backend-hypercli").unwrap();
        command
            .arg("--dry-run")
            .env("HYPER_AGENTS_API_KEY", "fixture-hypercli-credential")
            .env("AGENTS_API_BASE_URL", format!("{}/agents", server.url()))
            .env("HYPER_HTTP_TRACE_FILE", &trace_file)
            .write_stdin(request.to_string());
        let output = command.output().unwrap();

        assert!(
            output.status.success(),
            "{runtime}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        let response: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(response["agent_id"], format!("dry-run-{runtime}"));
        let trace = fs::read_to_string(trace_file).unwrap();
        let trace_event: serde_json::Value = trace
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .find(|event: &serde_json::Value| event["operation"] == "create_deployment")
            .unwrap();
        let mut traced_request = trace_event["request"].clone();
        let nonce = traced_request["env"]["BUZZ_MANAGED_AGENT_START_NONCE"]
            .as_str()
            .unwrap();
        assert_eq!(nonce.len(), nonce_length);
        assert!(nonce.chars().all(|character| character.is_ascii_hexdigit()));
        traced_request["env"]["BUZZ_MANAGED_AGENT_START_NONCE"] = serde_json::json!("<dynamic>");
        expected["env"]["BUZZ_MANAGED_AGENT_START_NONCE"] = serde_json::json!("<dynamic>");
        for key in [
            "MODEL_API_KEY",
            "BUZZ_PRIVATE_KEY",
            "NOSTR_PRIVATE_KEY",
            "BUZZ_AUTH_TAG",
        ] {
            expected["env"][key] = serde_json::json!("<redacted>");
        }
        assert_eq!(
            traced_request, expected,
            "{runtime}: full launch request drift"
        );
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
