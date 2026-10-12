use hypercli_sdk::{
    agents_ws_url_from_product_base, default_runner_control_url, discover_agents_ws_url_from,
    DEFAULT_RUNNER_CONTROL_URL,
};
use std::collections::BTreeMap;

#[test]
fn runner_control_routes_preserve_explicit_origins_and_prefixes() {
    assert_eq!(
        DEFAULT_RUNNER_CONTROL_URL,
        "wss://api.agents.hypercli.com/ws/runners"
    );
    let vectors: Vec<[String; 2]> =
        serde_json::from_str(include_str!("fixtures/runner_control_urls.json")).unwrap();
    for [base, expected] in vectors {
        assert_eq!(default_runner_control_url(&base).unwrap(), expected, "{base}");
        let ws_url = expected.strip_suffix("/runners").unwrap();
        assert_eq!(
            agents_ws_url_from_product_base(&base).unwrap().as_str(),
            ws_url,
            "{base}"
        );
        let env = BTreeMap::from([("HYPER_AGENTS_API_BASE".to_owned(), base.clone())]);
        assert_eq!(
            discover_agents_ws_url_from(&env, None).unwrap().as_str(),
            ws_url,
            "{base}"
        );
    }
}
