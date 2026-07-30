use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ManagedRuntime {
    Generic,
    Openclaw,
    OpenclawPro,
    Opencode,
    Codex,
    ClaudeCode,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentSize {
    Small,
    Medium,
    Large,
}

/// Flat launch contract accepted by `POST /deployments`.
///
/// Launch fields deliberately remain top-level. `config` is reserved for the
/// selected runtime's own non-launch configuration.
#[derive(Clone, Deserialize, Serialize)]
pub struct CreateDeploymentRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub handle: Option<String>,
    pub runtime: ManagedRuntime,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<AgentSize>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub config: BTreeMap<String, Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub env: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub routes: BTreeMap<String, Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub command: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub entrypoint: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sync_root: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sync_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sync_uid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sync_gid: Option<u32>,
    #[serde(default = "default_true")]
    pub start: bool,
    #[serde(default)]
    pub dry_run: bool,
}

impl CreateDeploymentRequest {
    pub fn new(runtime: ManagedRuntime) -> Self {
        Self {
            name: None,
            handle: None,
            runtime,
            size: None,
            config: BTreeMap::new(),
            tags: Vec::new(),
            env: BTreeMap::new(),
            routes: BTreeMap::new(),
            command: Vec::new(),
            entrypoint: Vec::new(),
            image: None,
            sync_root: None,
            sync_enabled: None,
            sync_uid: None,
            sync_gid: None,
            start: true,
            dry_run: false,
        }
    }
}

fn default_true() -> bool {
    true
}

#[derive(Clone, Default, Deserialize, Serialize)]
pub struct StartDeploymentRequest {
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub config: BTreeMap<String, Value>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub env: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub routes: BTreeMap<String, Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub command: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub entrypoint: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sync_root: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sync_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sync_uid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sync_gid: Option<u32>,
    #[serde(default)]
    pub dry_run: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Deployment {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub handle: Option<String>,
    #[serde(default)]
    pub runtime: Option<ManagedRuntime>,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub pod_id: Option<String>,
    #[serde(default)]
    pub hostname: Option<String>,
}
