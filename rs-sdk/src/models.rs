//! OpenAI-compatible model catalog (`GET {product}/v1/models`).
//!
//! Mirrors the Python SDK's `hypercli/models.py`.

use secrecy::ExposeSecret;
use serde::Deserialize;
use serde_json::Value;

use crate::{HyperCliClient, HyperCliError};

/// One OpenAI-compatible model entry.
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
pub struct ApiModel {
    #[serde(default)]
    pub id: String,
    #[serde(default = "default_object")]
    pub object: String,
    #[serde(default)]
    pub owned_by: Option<String>,
}

fn default_object() -> String {
    "model".to_owned()
}

/// Blocking client for the models API, obtained through
/// [`HyperCliClient::models`].
pub struct ModelsClient<'a> {
    pub(crate) client: &'a HyperCliClient,
}

impl ModelsClient<'_> {
    /// List models; the server answers either `{"data": [...]}` or a bare
    /// array.
    pub fn list(&self) -> Result<Vec<ApiModel>, HyperCliError> {
        let url = self.client.product_endpoint("v1/models");
        let data: Value = self.client.send_json(
            "models.list",
            "GET",
            &url,
            None,
            self.client
                .http
                .get(&url)
                .bearer_auth(self.client.api_key.expose_secret()),
        )?;
        let items = data.get("data").cloned().unwrap_or(data);
        serde_json::from_value(items)
            .map_err(|error| HyperCliError::InvalidResponse(error.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ClientConfig;
    use mockito::Server;
    use secrecy::SecretString;
    use url::Url;

    #[test]
    fn list_unwraps_the_data_envelope() {
        let mut server = Server::new();
        let models = server
            .mock("GET", "/v1/models")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "data": [{"id": "qwen3", "object": "model", "owned_by": "hypercli"}]
                })
                .to_string(),
            )
            .expect(1)
            .create();
        let client = HyperCliClient::new(ClientConfig {
            api_base: Url::parse(&format!("{}/agents", server.url())).unwrap(),
            api_key: SecretString::from("test-credential"),
            trace_file: None,
            timeout: None,
        })
        .unwrap();

        let listed = client.models().list().unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, "qwen3");
        assert_eq!(listed[0].owned_by.as_deref(), Some("hypercli"));
        models.assert();
    }
}
