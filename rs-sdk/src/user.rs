//! User product API (`GET {product}/api/user`).
//!
//! Mirrors the Python SDK's `hypercli/user.py`. Auth introspection
//! (`GET {product}/api/auth/me`) lives on [`HyperCliClient::auth_me`].

use secrecy::ExposeSecret;
use serde::Deserialize;

use crate::{HyperCliClient, HyperCliError};

/// Current user profile.
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
pub struct ApiUser {
    #[serde(default)]
    pub user_id: String,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default = "default_active")]
    pub is_active: bool,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub email_verified: Option<bool>,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub user_type: Option<String>,
    #[serde(default)]
    pub meta: Option<String>,
}

const fn default_active() -> bool {
    true
}

/// Blocking client for the user API, obtained through
/// [`HyperCliClient::user`].
pub struct UserClient<'a> {
    pub(crate) client: &'a HyperCliClient,
}

impl UserClient<'_> {
    /// Get current user info.
    pub fn get(&self) -> Result<ApiUser, HyperCliError> {
        let url = self.client.product_endpoint("api/user");
        self.client.send_json(
            "user.get",
            "GET",
            &url,
            None,
            self.client
                .http
                .get(&url)
                .bearer_auth(self.client.api_key.expose_secret()),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ClientConfig;
    use mockito::Server;
    use secrecy::SecretString;
    use serde_json::json;
    use url::Url;

    #[test]
    fn get_parses_the_user_projection() {
        let mut server = Server::new();
        let user_mock = server
            .mock("GET", "/api/user")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({
                    "user_id": "user-1",
                    "email": "user@example.com",
                    "name": "Test User",
                    "is_active": true,
                    "created_at": "2026-01-01T00:00:00Z",
                    "email_verified": true
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

        let user = client.user().get().unwrap();
        assert_eq!(user.user_id, "user-1");
        assert_eq!(user.email.as_deref(), Some("user@example.com"));
        assert!(user.is_active);
        assert_eq!(user.email_verified, Some(true));
        user_mock.assert();
    }
}
