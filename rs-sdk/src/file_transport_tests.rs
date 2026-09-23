use super::*;
use mockito::{Matcher, Server};
use secrecy::SecretString;

fn vectors() -> Value {
    serde_json::from_str(include_str!("../tests/fixtures/agent-file-contract.json")).unwrap()
}

fn fixture_bytes(hex: &Value) -> Vec<u8> {
    hex.as_str()
        .unwrap()
        .as_bytes()
        .chunks(2)
        .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
        .collect()
}

fn client(base: &str) -> HyperCliClient {
    HyperCliClient::new(ClientConfig {
        api_base: Url::parse(&format!("{base}/agents")).unwrap(),
        api_key: SecretString::from("api-secret"),
        trace_file: None,
        timeout: Some(Duration::from_secs(2)),
    })
    .unwrap()
}

fn native() -> Value {
    json!({"transport":"runner", "executor":"process", "max_bytes":RUNNER_FILE_MAX_BYTES})
}

fn token(server: &mut Server, payload: Value) -> mockito::Mock {
    server
        .mock("POST", "/agents/deployments/agent-contract/files/token")
        .match_header("authorization", "Bearer api-secret")
        .with_status(200)
        .with_body(payload.to_string())
        .create()
}

#[test]
fn shared_relative_paths_and_literal_encoding() {
    let fixture = vectors();
    let reef = FileToken {
        url: "https://reef.example.test/_reef".into(),
        token: "reef-secret".into(),
        expires_at: "future".into(),
    };
    for case in fixture["paths"].as_array().unwrap() {
        let input = case["input"].as_str().unwrap();
        let path = reef_relative_path(input, false).unwrap();
        assert_eq!(path, case["normalized"].as_str().unwrap());
        native_file_path(&path).unwrap();
        let (url, same_path) = reef_file_url(&reef, input).unwrap();
        assert_eq!(path, same_path);
        assert!(url.query().is_none() && url.fragment().is_none());
        assert!(!url.as_str().contains("secret"));
    }
    assert!(reef_file_url(&reef, "a%2Fb")
        .unwrap()
        .0
        .as_str()
        .ends_with("/a%252Fb"));
    for path in fixture["invalid_paths"].as_array().unwrap() {
        assert!(reef_relative_path(path.as_str().unwrap(), false).is_err());
    }
}

#[test]
fn existing_byte_methods_dispatch_native_with_identical_vectors() {
    let mut server = Server::new();
    let sdk = client(&server.url());
    let fixture = vectors();
    let count = fixture["paths"].as_array().unwrap().len()
        * fixture["bytes_hex"].as_array().unwrap().len()
        * 2
        + 4;
    let discovery = token(&mut server, native()).expect(count);
    for case in fixture["paths"].as_array().unwrap() {
        for hex in fixture["bytes_hex"].as_array().unwrap() {
            let bytes = fixture_bytes(hex);
            let encoded = STANDARD.encode(&bytes);
            let path = case["normalized"].as_str().unwrap();
            let write = server
                .mock("POST", "/agents/deployments/agent-contract/files/write")
                .match_header("authorization", "Bearer api-secret")
                .match_body(Matcher::Json(json!({"path":path,"content_base64":encoded})))
                .with_status(200)
                .with_body(r#"{"ok":true}"#)
                .create();
            let read = server
                .mock("POST", "/agents/deployments/agent-contract/files/read")
                .match_body(Matcher::Json(
                    json!({"path":path,"max_bytes":RUNNER_FILE_MAX_BYTES}),
                ))
                .with_status(200)
                .with_body(json!({"content_base64":encoded}).to_string())
                .create();
            let input = case["input"].as_str().unwrap();
            let receipt = sdk
                .put_deployment_file("agent-contract", input, &bytes)
                .unwrap();
            assert_eq!(receipt.path, path);
            assert_eq!(receipt.size, bytes.len() as u64);
            assert_eq!(
                sdk.read_deployment_file_bytes("agent-contract", input, usize::MAX)
                    .unwrap(),
                bytes
            );
            write.assert();
            read.assert();
            write.remove();
            read.remove();
        }
    }
    for content in [
        "Hello 🌍",
        fixture["directory_shaped_json"].as_str().unwrap(),
    ] {
        let write = server
            .mock("POST", "/agents/deployments/agent-contract/files/write")
            .match_body(Matcher::Json(
                json!({"path":"text.json", "content_base64":STANDARD.encode(content)}),
            ))
            .with_status(200)
            .with_body(r#"{"ok":true}"#)
            .create();
        let read = server
            .mock("POST", "/agents/deployments/agent-contract/files/read")
            .with_status(200)
            .with_body(json!({"content_base64":STANDARD.encode(content)}).to_string())
            .create();
        sdk.put_deployment_file_text("agent-contract", "text.json", content)
            .unwrap();
        assert_eq!(
            sdk.read_deployment_file("agent-contract", "text.json", usize::MAX)
                .unwrap(),
            content
        );
        write.assert();
        read.assert();
        write.remove();
        read.remove();
    }
    discovery.assert();
}

#[test]
fn unsupported_listing_and_limits_never_dispatch_a_file_command() {
    let mut server = Server::new();
    let sdk = client(&server.url());
    let discovery = token(&mut server, native()).expect(2);
    assert_eq!(
        sdk.list_deployment_files("agent-contract", "")
            .unwrap_err()
            .status(),
        Some(StatusCode::NOT_IMPLEMENTED)
    );
    assert!(sdk
        .put_deployment_file("agent-contract", "x", &vec![0; RUNNER_FILE_MAX_BYTES + 1])
        .is_err());
    discovery.assert();
}

#[test]
fn malformed_discovery_and_backend_errors_do_not_fall_back() {
    let mut server = Server::new();
    let sdk = client(&server.url());
    for payload in [
        Value::Null,
        json!([]),
        json!({}),
        json!({"transport":"runner","executor":"docker","max_bytes":RUNNER_FILE_MAX_BYTES}),
        json!({"transport":"runner","executor":"process","max_bytes":1}),
        json!({"transport":"runner","executor":"process","max_bytes":RUNNER_FILE_MAX_BYTES,"extra":true}),
        json!({"url":"https://reef.example.test/_reef","token":"fixture","expires_at":"future","extra":true}),
    ] {
        let discovery = token(&mut server, payload);
        let error = sdk
            .read_deployment_file_bytes("agent-contract", "x", 1)
            .unwrap_err();
        assert!(matches!(error, HyperCliError::InvalidResponse(_)));
        assert!(!error.to_string().contains("secret"));
        discovery.assert();
        discovery.remove();
    }
    for status in vectors()["error_statuses"].as_array().unwrap() {
        let status = status.as_u64().unwrap() as u16;
        let discovery = server
            .mock("POST", "/agents/deployments/agent-contract/files/token")
            .with_status(status as usize)
            .with_body(r#"{"detail":"file unavailable"}"#)
            .create();
        assert_eq!(
            sdk.read_deployment_file_bytes("agent-contract", "x", 1)
                .unwrap_err()
                .status(),
            Some(StatusCode::from_u16(status).unwrap())
        );
        discovery.assert();
        discovery.remove();
    }
}

#[test]
fn native_read_rejects_invalid_base64_and_decoded_overflow() {
    let mut server = Server::new();
    let sdk = client(&server.url());
    let discovery = token(&mut server, native()).expect(3);
    for encoded in [
        "?".to_owned(),
        STANDARD.encode([1, 2]),
        STANDARD.encode(vec![0; RUNNER_FILE_MAX_BYTES + 1]),
    ] {
        let read = server
            .mock("POST", "/agents/deployments/agent-contract/files/read")
            .with_status(200)
            .with_body(json!({"content_base64":encoded}).to_string())
            .create();
        assert!(sdk
            .read_deployment_file_bytes("agent-contract", "x", 1)
            .is_err());
        read.assert();
        read.remove();
    }
    discovery.assert();
}

#[test]
fn native_operation_errors_after_discovery_preserve_status_without_fallback() {
    let mut server = Server::new();
    let sdk = client(&server.url());
    let fixture = vectors();
    let discovery = token(&mut server, native())
        .expect(fixture["error_statuses"].as_array().unwrap().len() * 2);
    for status in fixture["error_statuses"].as_array().unwrap() {
        let status = status.as_u64().unwrap() as u16;
        for operation in ["read", "write"] {
            let response = server
                .mock(
                    "POST",
                    format!("/agents/deployments/agent-contract/files/{operation}").as_str(),
                )
                .with_status(status as usize)
                .with_body(r#"{"detail":"operation rejected"}"#)
                .create();
            let error = if operation == "read" {
                sdk.read_deployment_file_bytes("agent-contract", "x", 10)
                    .unwrap_err()
            } else {
                sdk.put_deployment_file("agent-contract", "x", b"content")
                    .unwrap_err()
            };
            assert_eq!(error.status(), Some(StatusCode::from_u16(status).unwrap()));
            response.assert();
            response.remove();
        }
    }
    discovery.assert();
}

#[test]
fn native_utf8_preserves_bom_and_replaces_malformed_subsequences() {
    let mut server = Server::new();
    let sdk = client(&server.url());
    let fixture = vectors();
    let discovery =
        token(&mut server, native()).expect(fixture["text"].as_array().unwrap().len() * 3);
    for vector in fixture["text"].as_array().unwrap() {
        let bytes = fixture_bytes(&vector["hex"]);
        let decoded = vector["decoded"].as_str().unwrap();
        let read = server
            .mock("POST", "/agents/deployments/agent-contract/files/read")
            .with_status(200)
            .with_body(json!({"content_base64": STANDARD.encode(bytes)}).to_string())
            .create();
        assert_eq!(
            sdk.read_deployment_file("agent-contract", "text", 100)
                .unwrap(),
            decoded
        );
        read.assert();
        read.remove();
        let write = server
            .mock("POST", "/agents/deployments/agent-contract/files/write")
            .match_body(Matcher::Json(
                json!({"path":"text", "content_base64":STANDARD.encode(decoded)}),
            ))
            .with_status(200)
            .with_body(r#"{"ok":true}"#)
            .create();
        sdk.put_deployment_file_text("agent-contract", "text", decoded)
            .unwrap();
        write.assert();
        write.remove();
        let read_back = server
            .mock("POST", "/agents/deployments/agent-contract/files/read")
            .with_status(200)
            .with_body(json!({"content_base64": STANDARD.encode(decoded)}).to_string())
            .create();
        assert_eq!(
            sdk.read_deployment_file("agent-contract", "text", 100)
                .unwrap(),
            decoded
        );
        read_back.assert();
        read_back.remove();
    }
    discovery.assert();
}

#[test]
fn hosted_https_roundtrip_uses_the_existing_public_methods() {
    use std::io::{BufRead, BufReader};
    use std::process::{Child, Command, Stdio};

    struct Fixture(Child);
    impl Drop for Fixture {
        fn drop(&mut self) {
            drop(self.0.stdin.take());
            let _ = self.0.wait();
        }
    }

    let mut fixture = Fixture(
        Command::new("python3")
            .arg(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/tests/fixtures/reef_https.py"
            ))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap(),
    );
    let mut reef_url = String::new();
    BufReader::new(fixture.0.stdout.take().unwrap())
        .read_line(&mut reef_url)
        .unwrap();
    assert!(
        reef_url.starts_with("https://127.0.0.1:"),
        "Local HTTPS fixture did not start (python3/openssl required)"
    );
    let mut server = Server::new();
    let mut sdk = client(&server.url());
    // Trust only this test's ephemeral self-signed loopback fixture; production stays strict.
    sdk.http = HttpClient::builder()
        .danger_accept_invalid_certs(true)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(5))
        .no_proxy()
        .build()
        .unwrap();
    let discovery = token(
        &mut server,
        json!({"url":reef_url.trim(), "token":"reef-fixture", "expires_at":"future"}),
    )
    .expect_at_least(1);
    let golden = vectors();
    for path in golden["paths"].as_array().unwrap() {
        let input = path["input"].as_str().unwrap();
        for hex in golden["bytes_hex"].as_array().unwrap() {
            let bytes = fixture_bytes(hex);
            let receipt = sdk
                .put_deployment_file("agent-contract", input, &bytes)
                .unwrap();
            assert_eq!(receipt.path, path["normalized"].as_str().unwrap());
            assert_eq!(receipt.size, bytes.len() as u64);
            assert_eq!(
                sdk.read_deployment_file_bytes("agent-contract", input, 1024)
                    .unwrap(),
                bytes
            );
        }
    }
    for vector in golden["text"].as_array().unwrap() {
        let bytes = fixture_bytes(&vector["hex"]);
        let decoded = vector["decoded"].as_str().unwrap();
        sdk.put_deployment_file("agent-contract", "encoding", &bytes)
            .unwrap();
        assert_eq!(
            sdk.read_deployment_file("agent-contract", "encoding", 1024)
                .unwrap(),
            decoded
        );
        sdk.put_deployment_file_text("agent-contract", "encoding", decoded)
            .unwrap();
        assert_eq!(
            sdk.read_deployment_file("agent-contract", "encoding", 1024)
                .unwrap(),
            decoded
        );
    }
    let json_text = golden["directory_shaped_json"].as_str().unwrap();
    sdk.put_deployment_file_text("agent-contract", "regular.json", json_text)
        .unwrap();
    assert_eq!(
        sdk.read_deployment_file("agent-contract", "regular.json", 1024)
            .unwrap(),
        json_text
    );
    assert!(sdk
        .list_deployment_files("agent-contract", "")
        .unwrap()
        .iter()
        .any(|entry| entry.path == "a%2Fb"));
    discovery.assert();
}

#[test]
fn native_readiness_accepts_missing_file_but_not_missing_agent() {
    let mut server = Server::new();
    let sdk = client(&server.url());
    let state = server
        .mock("GET", "/agents/deployments/agent-contract")
        .with_status(200)
        .with_body(r#"{"id":"agent-contract","state":"STOPPED"}"#)
        .expect(2)
        .create();
    let discovery = token(&mut server, native()).expect(2);
    let read = server
        .mock("POST", "/agents/deployments/agent-contract/files/read")
        .with_status(404)
        .with_body(r#"{"detail":"Runner file not_found"}"#)
        .create();
    let options = || FileApiReadyOptions {
        timeout: Duration::ZERO,
        consecutive: 1,
        poll_interval: Duration::ZERO,
    };
    sdk.wait_deployment_file_api_ready("agent-contract", options())
        .unwrap();
    discovery.assert();
    discovery.remove();
    read.assert();
    read.remove();
    let inaccessible = server
        .mock("POST", "/agents/deployments/agent-contract/files/token")
        .with_status(404)
        .with_body(r#"{"detail":"Agent not found"}"#)
        .create();
    assert!(sdk
        .wait_deployment_file_api_ready("agent-contract", options())
        .is_err());
    inaccessible.assert();
    state.assert();
}

#[test]
fn native_maximum_bytes_and_zero_read_budget() {
    let mut server = Server::new();
    let sdk = client(&server.url());
    let discovery = token(&mut server, native()).expect(3);
    let bytes = vec![255; RUNNER_FILE_MAX_BYTES];
    let write = server
        .mock("POST", "/agents/deployments/agent-contract/files/write")
        .match_body(Matcher::Json(
            json!({"path":"max", "content_base64":STANDARD.encode(&bytes)}),
        ))
        .with_status(200)
        .with_body(r#"{"ok":true}"#)
        .create();
    sdk.put_deployment_file("agent-contract", "max", &bytes)
        .unwrap();
    let read = server
        .mock("POST", "/agents/deployments/agent-contract/files/read")
        .match_body(Matcher::Json(
            json!({"path":"max", "max_bytes":RUNNER_FILE_MAX_BYTES}),
        ))
        .with_status(200)
        .with_body(json!({"content_base64":STANDARD.encode(&bytes)}).to_string())
        .create();
    assert_eq!(
        sdk.read_deployment_file_bytes("agent-contract", "max", usize::MAX)
            .unwrap(),
        bytes
    );
    let empty = server
        .mock("POST", "/agents/deployments/agent-contract/files/read")
        .match_body(Matcher::Json(json!({"path":"empty", "max_bytes":0})))
        .with_status(200)
        .with_body(r#"{"content_base64":""}"#)
        .create();
    assert!(sdk
        .read_deployment_file_bytes("agent-contract", "empty", 0)
        .unwrap()
        .is_empty());
    write.assert();
    read.assert();
    empty.assert();
    discovery.assert();
}

#[test]
fn streaming_body_limit_does_not_wait_for_the_rest() {
    let mut server = Server::new();
    let body = server
        .mock("GET", "/bytes")
        .with_status(200)
        .with_chunked_body(|writer| {
            writer.write_all(b"12345")?;
            writer.flush()?;
            // No terminator yet: a bounded reader must finish without waiting.
            std::thread::sleep(Duration::from_millis(400));
            Ok(())
        })
        .create();
    let response = HttpClient::new()
        .get(format!("{}/bytes", server.url()))
        .send()
        .unwrap();
    let start = Instant::now();
    assert!(bounded_file_body(response, 4).is_err());
    assert!(start.elapsed() < Duration::from_millis(350));
    body.assert();
}

#[test]
fn lost_write_response_never_replays_over_an_intervening_edit() {
    use std::net::TcpListener;
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    listener.set_nonblocking(true).unwrap();
    let worker = std::thread::spawn(move || {
        let mut writes = 0;
        let mut content = String::new();
        let mut deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            let Ok((mut stream, _)) = listener.accept() else {
                std::thread::sleep(Duration::from_millis(5));
                continue;
            };
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut request = Vec::new();
            let mut byte = [0];
            while !request.ends_with(b"\r\n\r\n") {
                stream.read_exact(&mut byte).unwrap();
                request.push(byte[0]);
            }
            let headers = String::from_utf8(request).unwrap();
            let length = headers
                .lines()
                .find_map(|line| {
                    line.to_ascii_lowercase()
                        .strip_prefix("content-length: ")
                        .and_then(|n| n.parse::<usize>().ok())
                })
                .unwrap_or(0);
            let mut body = vec![0; length];
            stream.read_exact(&mut body).unwrap();
            if headers.starts_with("POST /agents/deployments/agent-contract/files/token ") {
                let response = native().to_string();
                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    response.len(),
                    response
                )
                .unwrap();
            } else {
                assert!(headers.starts_with("POST /agents/deployments/agent-contract/files/write "));
                writes += 1;
                let body: Value = serde_json::from_slice(&body).unwrap();
                content = body["content_base64"].as_str().unwrap().to_owned();
                if writes == 1 {
                    content = "intervening edit".into();
                }
                deadline = Instant::now() + Duration::from_millis(300);
                // Commit followed by connection close without a response.
            }
        }
        (writes, content)
    });
    let error = client(&base)
        .put_deployment_file("agent-contract", "x", b"original")
        .unwrap_err();
    assert!(matches!(error, HyperCliError::Transport(_)));
    assert!(!error.to_string().contains("api-secret"));
    assert_eq!(worker.join().unwrap(), (1, "intervening edit".into()));
}
