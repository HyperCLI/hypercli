use hypercli_sdk::{
    default_hyper_acp_ws_url, discover_agents_api_base, discover_agents_ws_url,
    discover_client_config, HyperCliClient,
};
use std::process::Command;
use url::Url;

#[test]
fn independent_configured_bases() {
    if std::env::var_os("HYPERCLI_BASE_TEST_CHILD").is_some() {
        let config = discover_client_config().unwrap();
        assert_eq!(
            config.api_base.as_str(),
            std::env::var("EXPECTED_REST").unwrap()
        );
        // Native runners discover endpoints without constructing a root client.
        assert_eq!(discover_agents_api_base().unwrap(), config.api_base);
        let ws = std::env::var("EXPECTED_WS").unwrap();
        assert_eq!(
            default_hyper_acp_ws_url(config.api_base.as_str()).unwrap(),
            ws
        );
        let client = HyperCliClient::new(config).unwrap();
        let product = std::env::var("EXPECTED_PRODUCT").unwrap();
        assert_eq!(client.product_api_base(), product);
        assert_eq!(discover_agents_ws_url().unwrap().as_str(), ws);
        let explicit = HyperCliClient::new_with_product_api_base(
            discover_client_config().unwrap(),
            Url::parse("https://explicit.example/prefix/").unwrap(),
        )
        .unwrap();
        assert_eq!(
            explicit.product_api_base(),
            "https://explicit.example/prefix"
        );
        return;
    }
    for source in ["env", "config"] {
        for (control, rest, ws) in [
            (
                "https://api.agents.dev.hypercli.com",
                "https://api.agents.dev.hypercli.com/agents",
                "wss://api.agents.dev.hypercli.com/ws",
            ),
            (
                "http://control.example:8787/prefix/agents///",
                "http://control.example:8787/prefix/agents",
                "ws://control.example:8787/prefix/ws",
            ),
            (
                "https://api.agents.dev.hypercli.com/prefix/api/",
                "https://api.agents.dev.hypercli.com/prefix/agents",
                "wss://api.agents.dev.hypercli.com/prefix/ws",
            ),
        ] {
            for product in [Some("https://inference.example/prefix"), None] {
                let home = tempfile::tempdir().unwrap();
                let mut config = "HYPER_API_KEY=synthetic-key\n".to_owned();
                let mut command = Command::new(std::env::current_exe().unwrap());
                command
                    .env_clear()
                    .env("HYPER_HOME", home.path())
                    .env("HYPERCLI_BASE_TEST_CHILD", "1")
                    .env(
                        "EXPECTED_PRODUCT",
                        product.unwrap_or("https://api.hypercli.com"),
                    )
                    .env("EXPECTED_REST", rest)
                    .env("EXPECTED_WS", ws)
                    .arg("--exact")
                    .arg("independent_configured_bases");
                if source == "env" {
                    command.env("HYPER_AGENTS_API_BASE", control);
                    if let Some(base) = product {
                        command.env("HYPER_API_BASE", base);
                    }
                } else {
                    config.push_str(&format!("HYPER_AGENTS_API_BASE={control}\n"));
                    if let Some(base) = product {
                        config.push_str(&format!("HYPER_API_BASE={base}\n"));
                    }
                }
                std::fs::write(home.path().join("config"), config).unwrap();
                let output = command.output().unwrap();
                assert!(
                    output.status.success(),
                    "{}{}",
                    String::from_utf8_lossy(&output.stdout),
                    String::from_utf8_lossy(&output.stderr)
                );
            }
        }
    }
}
