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
    for axis in ["urlAuthorities", "urlPaths"] {
        for integration in ["buzz", "teams", "telegram"] {
            for valid in [true, false] {
                for candidate in fixtures[axis][if valid { "valid" } else { "invalid" }]
                    .as_array()
                    .unwrap()
                {
                    let template = fixtures["valid"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .find(|case| {
                            case["integration"] == integration
                                && (integration != "telegram"
                                    || case["values"]["TELEGRAM_MODE"] == "webhook")
                        })
                        .unwrap();
                    let mut values: std::collections::BTreeMap<String, String> =
                        serde_json::from_value(template["values"].clone()).unwrap();
                    let url = format!(
                        "{}://{}",
                        if integration == "buzz" {
                            "wss"
                        } else {
                            "https"
                        },
                        if axis == "urlAuthorities" {
                            format!("{}/", candidate.as_str().unwrap())
                        } else {
                            format!("example.com{}", candidate.as_str().unwrap())
                        }
                    );
                    let accepted = valid && (integration != "teams" || url.ends_with('/'));
                    let key = match integration {
                        "buzz" => "BUZZ_RELAY_URL",
                        "teams" => "TEAMS_TRUSTED_SERVICE_BASES",
                        _ => "TELEGRAM_WEBHOOK_URL",
                    };
                    values.insert(
                        key.into(),
                        if integration == "teams" {
                            json!([url]).to_string()
                        } else {
                            url
                        },
                    );
                    assert_eq!(
                        build_chat_integration_config(integration, &values).is_ok(),
                        accepted,
                        "{integration}: {axis} {candidate}"
                    );
                }
            }
        }
    }
}
