#![allow(missing_docs)]

use std::process::Command;

#[test]
fn compatibility_binary_exposes_full_harness_help() {
    let output = Command::new(env!("CARGO_BIN_EXE_buzz-acp"))
        .arg("--help")
        .output()
        .unwrap();

    assert!(
        output.status.success(),
        "buzz-acp --help exited with {:?}: {}",
        output.status,
        String::from_utf8_lossy(&output.stderr),
    );
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("ACP harness that bridges Buzz events to AI agents"));
    assert!(stdout.contains("--private-key"));
}

#[test]
fn compatibility_binary_exposes_helper_subcommands() {
    for subcommand in ["models", "auth-methods", "authenticate", "auth-tag"] {
        let output = Command::new(env!("CARGO_BIN_EXE_buzz-acp"))
            .arg(subcommand)
            .arg("--help")
            .output()
            .unwrap();

        assert!(
            output.status.success(),
            "buzz-acp {subcommand} --help exited with {:?}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr),
        );
        let stdout = String::from_utf8(output.stdout).unwrap();
        if subcommand == "auth-tag" {
            assert!(stdout.contains("Compute a NIP-OA owner attestation auth tag"));
        } else {
            assert!(
                stdout.contains("--agent-command"),
                "missing helper agent flags in {subcommand} help: {stdout}"
            );
        }
    }
}

#[test]
fn compatibility_binary_computes_auth_tag() {
    let output = Command::new(env!("CARGO_BIN_EXE_buzz-acp"))
        .arg("auth-tag")
        .arg("0000000000000000000000000000000000000000000000000000000000000003")
        .arg("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        .output()
        .unwrap();

    assert!(
        output.status.success(),
        "buzz-acp auth-tag exited with {:?}: {}",
        output.status,
        String::from_utf8_lossy(&output.stderr),
    );
    let value: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value[0], "auth");
    assert_eq!(
        value[1],
        "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9"
    );
    assert_eq!(value[2], "");
}
