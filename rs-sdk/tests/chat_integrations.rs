use hypercli_sdk::build_chat_integration_config;
use serde_json::{json, Value};

#[test]
fn shared_launch_contract() {
    let fixtures: Value =
        serde_json::from_str(include_str!("../../tests/fixtures/chat-integrations.json")).unwrap();
    for case in fixtures["valid"].as_array().unwrap() {
        let values = serde_json::from_value(case["values"].clone()).unwrap();
        let result = build_chat_integration_config(case["integration"].as_str().unwrap(), &values)
            .unwrap_or_else(|_| panic!("valid fixture rejected: {}", case["name"]));
        assert_eq!(
            json!({"env": result.env, "secrets": result.secrets}),
            case["expected"],
            "{}",
            case["name"]
        );
    }
    for case in fixtures["invalid"].as_array().unwrap() {
        let values = serde_json::from_value(case["values"].clone()).unwrap();
        let result = build_chat_integration_config(case["integration"].as_str().unwrap(), &values);
        let error = result
            .err()
            .unwrap_or_else(|| panic!("invalid fixture accepted: {}", case["name"]));
        assert!(!error.contains("synthetic-private"));
    }
}
