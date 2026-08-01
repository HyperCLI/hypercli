//! Typed Rust client for the HyperCLI managed-agent API.
//!
//! This crate intentionally covers the deployment surface needed by backend
//! providers. It does not implement ACP or a Buzz relay client.

mod client;
mod config;
mod types;

pub use client::{HyperCliClient, HyperCliError};
pub use config::{
    discover_client_config, discover_client_config_from, normalize_agents_api_base, ClientConfig,
    ConfigError,
};
pub use types::{
    AgentSize, BuzzLaunchConfig, BuzzLaunchError, CreateDeploymentRequest, Deployment,
    ExecDeploymentRequest, ExecDeploymentResponse, ManagedRuntime, StartDeploymentRequest,
    BUZZ_RUNTIME_SCOPES,
};
