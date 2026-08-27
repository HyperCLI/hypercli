//! Edit an existing agent's launch configuration.
//!
//! The backend stores a redacted launch-config projection on each deployment
//! (secrets stripped, see `DeploymentLaunchConfig`). Launch-affecting edits
//! are accepted only while the deployment is stopped, and the whole
//! projection must be re-submitted — so editing is: read the projection,
//! change the relevant env entries in place, and PATCH the full map back
//! (`update_deployment`). We never touch secrets or registry auth from here.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use hypercli_sdk::{AgentSize, DeploymentLaunchConfig, UpdateDeploymentRequest};

use crate::{checked_agent_id, managed_client};

/// Editable launch-config fields, pre-filled for the edit form. Anything not
/// surfaced here is left untouched on save.
#[derive(Serialize)]
pub struct AgentEditConfig {
    pub id: String,
    pub name: String,
    pub size: Option<String>,
    pub state: String,
    pub runtime: Option<String>,
    /// Buzz runtimes expose model/prompt/concurrency; OpenClaw agents don't.
    pub is_buzz: bool,
    pub model: Option<String>,
    pub instructions: Option<String>,
    pub concurrency: Option<u32>,
    /// Editing is only allowed while stopped (backend contract).
    pub editable: bool,
}

#[derive(Deserialize)]
pub struct AgentEditInput {
    pub name: Option<String>,
    pub size: Option<String>,
    pub model: Option<String>,
    pub instructions: Option<String>,
    pub concurrency: Option<u32>,
}

fn env_string(env: &serde_json::Map<String, Value>, key: &str) -> Option<String> {
    env.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn parse_size(value: &str) -> Result<AgentSize, String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "small" => Ok(AgentSize::Small),
        "medium" => Ok(AgentSize::Medium),
        "large" => Ok(AgentSize::Large),
        other => Err(format!("Invalid size {other:?} (small, medium, large)")),
    }
}

/// Read the stored launch-config projection for the edit form.
#[tauri::command]
pub fn get_agent_edit_config(agent_id: String) -> Result<AgentEditConfig, String> {
    let agent_id = checked_agent_id(&agent_id)?;
    let client = managed_client()?;
    let deployment = client
        .get_deployment(&agent_id)
        .map_err(|error| error.to_string())?;

    let launch = deployment.launch_config.as_map();
    let env = launch.get("env").and_then(Value::as_object);
    let is_buzz = deployment.is_buzz_managed();
    let editable = deployment.state.trim().eq_ignore_ascii_case("stopped");

    let model = env.and_then(|env| env_string(env, "BUZZ_ACP_MODEL"));
    let instructions = env.and_then(|env| env_string(env, "BUZZ_ACP_SYSTEM_PROMPT"));
    let concurrency = env
        .and_then(|env| env_string(env, "BUZZ_ACP_AGENTS"))
        .and_then(|value| value.parse::<u32>().ok());

    Ok(AgentEditConfig {
        id: deployment.id,
        name: deployment.name,
        size: deployment
            .requested_size
            .map(|size| format!("{size:?}").to_ascii_lowercase()),
        state: deployment.state,
        runtime: deployment
            .runtime
            .map(|runtime| format!("{runtime:?}").to_ascii_lowercase()),
        is_buzz,
        model,
        instructions,
        concurrency,
        editable,
    })
}

/// Apply an edit. Only stopped deployments can be edited (the backend rejects
/// launch-affecting changes otherwise). We re-submit the full stored
/// projection with the edited fields swapped in, so untouched settings are
/// preserved exactly.
#[tauri::command]
pub fn update_agent(agent_id: String, input: AgentEditInput) -> Result<(), String> {
    let agent_id = checked_agent_id(&agent_id)?;
    let client = managed_client()?;
    let deployment = client
        .get_deployment(&agent_id)
        .map_err(|error| error.to_string())?;

    if !deployment.state.trim().eq_ignore_ascii_case("stopped") {
        return Err("Stop the agent before editing its configuration.".to_owned());
    }

    // Start from the stored projection and edit only the surfaced env keys.
    let mut launch: BTreeMap<String, Value> = deployment
        .launch_config
        .as_map()
        .iter()
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();

    if input.model.is_some() || input.instructions.is_some() || input.concurrency.is_some() {
        let mut env = launch
            .get("env")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();

        let mut set_env = |key: &str, value: Option<String>| {
            match value {
                Some(text) if !text.is_empty() => {
                    env.insert(key.to_owned(), Value::String(text));
                }
                // Explicit blank clears the key (e.g. reset model to default).
                _ => {
                    env.remove(key);
                }
            }
        };

        if let Some(model) = input.model {
            set_env("BUZZ_ACP_MODEL", Some(model.trim().to_owned()));
        }
        if let Some(instructions) = input.instructions {
            set_env("BUZZ_ACP_SYSTEM_PROMPT", Some(instructions));
        }
        if let Some(concurrency) = input.concurrency {
            if !(1..=32).contains(&concurrency) {
                return Err("Concurrency must be between 1 and 32.".to_owned());
            }
            set_env("BUZZ_ACP_AGENTS", Some(concurrency.to_string()));
        }

        launch.insert("env".to_owned(), Value::Object(env));
    }

    let name = input
        .name
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    let size = match input.size {
        Some(value) => Some(parse_size(&value)?),
        None => None,
    };

    let request = UpdateDeploymentRequest {
        name,
        handle: None,
        size,
        launch_config: Some(DeploymentLaunchConfig::from_map(launch)),
    };

    client
        .update_deployment(&agent_id, &request)
        .map_err(|error| error.to_string())?;
    Ok(())
}
