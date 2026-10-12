use hypercli_sdk::{
    default_runner_control_url, DEFAULT_AGENTS_API_BASE, DEFAULT_RUNNER_CONTROL_URL,
};

#[test]
fn runner_control_routes_preserve_explicit_origins_and_prefixes() {
    assert_eq!(
        DEFAULT_RUNNER_CONTROL_URL,
        "wss://api.agents.hypercli.com/ws/runners"
    );
    for (base, expected) in [
        (DEFAULT_AGENTS_API_BASE, DEFAULT_RUNNER_CONTROL_URL),
        (
            "https://api.dev.hypercli.com/agents",
            "wss://api.agents.dev.hypercli.com/ws/runners",
        ),
        (
            "https://api.agents.hypercli.com/agents",
            DEFAULT_RUNNER_CONTROL_URL,
        ),
        (
            "http://127.0.0.1:8765/prefix/agents/",
            "ws://127.0.0.1:8765/prefix/ws/runners",
        ),
        ("https://custom.test/api", "wss://custom.test/ws/runners"),
    ] {
        assert_eq!(default_runner_control_url(base).unwrap(), expected);
    }
}
