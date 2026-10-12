//! Self-hosted runner registration. Mutation requests are sent once.
use secrecy::ExposeSecret;
use serde::{Deserialize, Serialize};

use crate::{HyperCliClient, HyperCliError};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct RunnerPlatform {
    pub os: String,
    pub arch: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct RunnerRegisterRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runner_id: Option<String>,
    pub name: String,
    pub tags: Vec<String>,
    pub version: String,
    pub platform: RunnerPlatform,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct Runner {
    pub runner_id: String,
    pub owner_user_id: String,
    pub name: String,
    pub tags: Vec<String>,
    pub version: String,
    pub platform: RunnerPlatform,
}

#[derive(Clone, Copy)]
pub struct RunnersClient<'a> {
    client: &'a HyperCliClient,
}

impl HyperCliClient {
    pub fn runners(&self) -> RunnersClient<'_> {
        RunnersClient { client: self }
    }
}

impl RunnersClient<'_> {
    /// Omit runner_id to allocate an identity. A lost reply may leave a row;
    /// this call never automatically retries an uncertain allocation.
    pub async fn register(&self, body: &RunnerRegisterRequest) -> Result<Runner, HyperCliError> {
        let response = self
            .client
            .async_http
            .post(self.client.endpoint("runners"))
            .bearer_auth(self.client.api_key.expose_secret())
            .json(body)
            .send()
            .await
            .map_err(|error| HyperCliError::Transport(error.without_url().to_string()))?;
        if !response.status().is_success() {
            return Err(HyperCliError::Status(response.status()));
        }
        response
            .json()
            .await
            .map_err(|error| HyperCliError::InvalidResponse(error.without_url().to_string()))
    }
}
