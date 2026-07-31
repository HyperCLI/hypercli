use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ManagedRuntime {
    Generic,
    Openclaw,
    OpenclawPro,
    Opencode,
    Codex,
    ClaudeCode,
    Goose,
    KimiCode,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentSize {
    Small,
    Medium,
    Large,
}

const DEFAULT_BUZZ_RUST_LOG: &str = "buzz_acp=info,pool::prompt=info,acp::stream=off";
pub const BUZZ_RUNTIME_SCOPES: [&str; 7] = [
    "agents:none",
    "files:*",
    "flows:*",
    "models:*",
    "voice:*",
    "web:*",
    "workspaces:*",
];
const BUZZ_RESERVED_ENV: &[&str] = &[
    "BUZZ_PRIVATE_KEY",
    "NOSTR_PRIVATE_KEY",
    "BUZZ_AUTH_TAG",
    "BUZZ_API_TOKEN",
    "BUZZ_ACP_PRIVATE_KEY",
    "BUZZ_ACP_API_TOKEN",
    "BUZZ_RELAY_URL",
    "BUZZ_ACP_AGENT_COMMAND",
    "BUZZ_ACP_AGENT_ARGS",
    "BUZZ_ACP_MCP_COMMAND",
    "BUZZ_ACP_LAZY_POOL",
    "BUZZ_ACP_RELAY_OBSERVER",
    "BUZZ_ACP_DISPLAY_NAME",
    "BUZZ_ACP_TEXT_MENTIONS",
    "BUZZ_ACP_SESSION_TITLE",
    "BUZZ_ACP_SYSTEM_PROMPT",
    "BUZZ_ACP_MODEL",
    "BUZZ_ACP_IDLE_TIMEOUT",
    "BUZZ_ACP_MAX_TURN_DURATION",
    "BUZZ_ACP_AGENTS",
    "BUZZ_ACP_RESPOND_TO",
    "BUZZ_ACP_RESPOND_TO_ALLOWLIST",
    "BUZZ_ACP_AGENT_OWNER",
    "BUZZ_ACP_MULTIPLE_EVENT_HANDLING",
    "BUZZ_ACP_DEDUP",
    "BUZZ_ACP_SETUP_PAYLOAD",
    "BUZZ_MANAGED_AGENT",
    "BUZZ_MANAGED_AGENT_START_NONCE",
];

/// First-class Buzz ACP launch contract for a hosted coding runtime.
///
/// This type deliberately does not implement `Debug` or `Serialize` because
/// it owns the agent's private Nostr identity. Use [`Self::apply_to`] to render
/// the deployment request with canonical runtime command and MCP defaults.
#[derive(Clone)]
pub struct BuzzLaunchConfig {
    pub private_key_nsec: String,
    pub relay_url: String,
    pub auth_tag: Option<String>,
    pub system_prompt: Option<String>,
    pub model: Option<String>,
    pub idle_timeout_seconds: Option<u64>,
    pub max_turn_duration_seconds: Option<u64>,
    pub parallelism: u32,
    pub respond_to: Option<String>,
    pub respond_to_allowlist: Vec<String>,
    pub display_name: Option<String>,
    pub text_mentions: bool,
    pub session_title: Option<String>,
    pub rust_log: Option<String>,
    pub restart: bool,
}

impl BuzzLaunchConfig {
    pub fn new(private_key_nsec: impl Into<String>, relay_url: impl Into<String>) -> Self {
        Self {
            private_key_nsec: private_key_nsec.into(),
            relay_url: relay_url.into(),
            auth_tag: None,
            system_prompt: None,
            model: None,
            idle_timeout_seconds: None,
            max_turn_duration_seconds: None,
            parallelism: 1,
            respond_to: None,
            respond_to_allowlist: Vec::new(),
            display_name: None,
            text_mentions: false,
            session_title: None,
            rust_log: None,
            restart: false,
        }
    }

    pub fn apply_to(
        &self,
        request: &mut CreateDeploymentRequest,
        default_session_title: Option<&str>,
    ) -> Result<(), BuzzLaunchError> {
        if self.private_key_nsec.trim().is_empty() {
            return Err(BuzzLaunchError::MissingPrivateKey);
        }
        if self.relay_url.trim().is_empty() {
            return Err(BuzzLaunchError::MissingRelayUrl);
        }
        if !(1..=32).contains(&self.parallelism) {
            return Err(BuzzLaunchError::InvalidParallelism);
        }
        let (agent_command, agent_args, mcp_command) = match request.runtime {
            ManagedRuntime::Opencode => (
                "/usr/local/bin/opencode",
                "acp",
                "/usr/local/bin/buzz-dev-mcp",
            ),
            ManagedRuntime::Codex => (
                "/usr/local/bin/codex-acp",
                "",
                "/usr/local/bin/buzz-dev-mcp",
            ),
            ManagedRuntime::ClaudeCode => ("/usr/local/bin/claude-agent-acp", "", ""),
            ManagedRuntime::Goose => ("/usr/local/bin/goose", "acp", ""),
            ManagedRuntime::KimiCode => ("/usr/local/bin/kimi", "acp", ""),
            _ => return Err(BuzzLaunchError::UnsupportedRuntime),
        };

        request.size = Some(AgentSize::Large);
        request.command = vec!["/usr/local/bin/buzz-acp".to_owned()];
        request.routes.clear();
        request.sync_root = Some("/home/node".to_owned());
        request.sync_enabled = Some(true);
        request.sync_uid = Some(1000);
        request.sync_gid = Some(1000);
        request.restart = Some(self.restart);
        request.runtime_scopes = BUZZ_RUNTIME_SCOPES
            .iter()
            .map(|scope| (*scope).to_owned())
            .collect();
        for key in BUZZ_RESERVED_ENV {
            request.env.remove(*key);
        }
        request
            .env
            .insert("BUZZ_PRIVATE_KEY".to_owned(), self.private_key_nsec.clone());
        request.env.insert(
            "NOSTR_PRIVATE_KEY".to_owned(),
            self.private_key_nsec.clone(),
        );
        request
            .env
            .insert("BUZZ_RELAY_URL".to_owned(), self.relay_url.clone());
        request.env.insert(
            "BUZZ_ACP_AGENT_COMMAND".to_owned(),
            agent_command.to_owned(),
        );
        request
            .env
            .insert("BUZZ_ACP_AGENT_ARGS".to_owned(), agent_args.to_owned());
        request
            .env
            .insert("BUZZ_ACP_MCP_COMMAND".to_owned(), mcp_command.to_owned());
        request
            .env
            .insert("BUZZ_ACP_LAZY_POOL".to_owned(), "true".to_owned());
        request
            .env
            .insert("BUZZ_ACP_RELAY_OBSERVER".to_owned(), "true".to_owned());
        request
            .env
            .insert("BUZZ_ACP_AGENTS".to_owned(), self.parallelism.to_string());
        request.env.insert(
            "BUZZ_ACP_MULTIPLE_EVENT_HANDLING".to_owned(),
            "steer".to_owned(),
        );
        request
            .env
            .insert("BUZZ_ACP_DEDUP".to_owned(), "queue".to_owned());
        if let Some(rust_log) = self.rust_log.as_ref().filter(|value| !value.is_empty()) {
            request.env.insert("RUST_LOG".to_owned(), rust_log.clone());
        } else {
            request
                .env
                .entry("RUST_LOG".to_owned())
                .or_insert_with(|| DEFAULT_BUZZ_RUST_LOG.to_owned());
        }

        insert_nonempty(&mut request.env, "BUZZ_AUTH_TAG", self.auth_tag.as_deref());
        insert_nonempty(
            &mut request.env,
            "BUZZ_ACP_DISPLAY_NAME",
            self.display_name.as_deref(),
        );
        if self.text_mentions {
            request
                .env
                .insert("BUZZ_ACP_TEXT_MENTIONS".to_owned(), "true".to_owned());
        }
        insert_nonempty(
            &mut request.env,
            "BUZZ_ACP_SESSION_TITLE",
            self.session_title.as_deref().or(default_session_title),
        );
        insert_nonempty(
            &mut request.env,
            "BUZZ_ACP_SYSTEM_PROMPT",
            self.system_prompt.as_deref(),
        );
        insert_nonempty(&mut request.env, "BUZZ_ACP_MODEL", self.model.as_deref());
        insert_nonempty(
            &mut request.env,
            "BUZZ_ACP_RESPOND_TO",
            self.respond_to.as_deref(),
        );
        if let Some(value) = self.idle_timeout_seconds {
            request
                .env
                .insert("BUZZ_ACP_IDLE_TIMEOUT".to_owned(), value.to_string());
        }
        if let Some(value) = self.max_turn_duration_seconds {
            request
                .env
                .insert("BUZZ_ACP_MAX_TURN_DURATION".to_owned(), value.to_string());
        }
        if !self.respond_to_allowlist.is_empty() {
            request.env.insert(
                "BUZZ_ACP_RESPOND_TO_ALLOWLIST".to_owned(),
                self.respond_to_allowlist.join(","),
            );
        }
        Ok(())
    }
}

fn insert_nonempty(env: &mut BTreeMap<String, String>, key: &str, value: Option<&str>) {
    if let Some(value) = value.filter(|value| !value.is_empty()) {
        env.insert(key.to_owned(), value.to_owned());
    }
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum BuzzLaunchError {
    #[error("Buzz private key is required")]
    MissingPrivateKey,
    #[error("Buzz relay URL is required")]
    MissingRelayUrl,
    #[error("Buzz parallelism must be between 1 and 32")]
    InvalidParallelism,
    #[error("Buzz requires a coding-agent runtime")]
    UnsupportedRuntime,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub restart: Option<bool>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub runtime_scopes: Vec<String>,
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
            restart: None,
            runtime_scopes: Vec::new(),
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub restart: Option<bool>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub runtime_scopes: Vec<String>,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buzz_launch_owns_reserved_env_and_uses_opencode_defaults() {
        let mut request = CreateDeploymentRequest::new(ManagedRuntime::Opencode);
        request.env.insert(
            "BUZZ_RELAY_URL".to_owned(),
            "wss://attacker.invalid".to_owned(),
        );
        request.env.insert(
            "BUZZ_ACP_AGENT_COMMAND".to_owned(),
            "/tmp/not-opencode".to_owned(),
        );
        request
            .env
            .insert("BUZZ_ACP_DISPLAY_NAME".to_owned(), "Wrong".to_owned());
        request
            .env
            .insert("BUZZ_ACP_TEXT_MENTIONS".to_owned(), "false".to_owned());
        request
            .env
            .insert("RUST_LOG".to_owned(), "debug".to_owned());

        let mut buzz = BuzzLaunchConfig::new("nsec1test", "wss://buzz.example.test");
        buzz.model = Some("hypercli/kimi-k2.6-anthropic".to_owned());
        buzz.parallelism = 3;
        buzz.display_name = Some("Fizz4".to_owned());
        buzz.text_mentions = true;
        buzz.apply_to(&mut request, Some("Fizz4")).unwrap();

        assert_eq!(request.size, Some(AgentSize::Large));
        assert_eq!(request.command, vec!["/usr/local/bin/buzz-acp"]);
        assert_eq!(request.restart, Some(false));
        assert_eq!(
            request.runtime_scopes,
            BUZZ_RUNTIME_SCOPES.map(str::to_owned)
        );
        assert!(request.routes.is_empty());
        assert_eq!(
            request.env.get("BUZZ_RELAY_URL").map(String::as_str),
            Some("wss://buzz.example.test")
        );
        assert_eq!(
            request
                .env
                .get("BUZZ_ACP_AGENT_COMMAND")
                .map(String::as_str),
            Some("/usr/local/bin/opencode")
        );
        assert_eq!(
            request.env.get("BUZZ_ACP_AGENT_ARGS").map(String::as_str),
            Some("acp")
        );
        assert_eq!(
            request.env.get("BUZZ_ACP_MCP_COMMAND").map(String::as_str),
            Some("/usr/local/bin/buzz-dev-mcp")
        );
        assert_eq!(
            request.env.get("BUZZ_ACP_DISPLAY_NAME").map(String::as_str),
            Some("Fizz4")
        );
        assert_eq!(
            request
                .env
                .get("BUZZ_ACP_TEXT_MENTIONS")
                .map(String::as_str),
            Some("true")
        );
        assert_eq!(
            request
                .env
                .get("BUZZ_ACP_SESSION_TITLE")
                .map(String::as_str),
            Some("Fizz4")
        );
        assert_eq!(
            request.env.get("RUST_LOG").map(String::as_str),
            Some("debug")
        );
    }

    #[test]
    fn buzz_launch_rejects_non_coding_runtime() {
        let mut request = CreateDeploymentRequest::new(ManagedRuntime::Openclaw);
        let buzz = BuzzLaunchConfig::new("nsec1test", "wss://buzz.example.test");

        assert_eq!(
            buzz.apply_to(&mut request, None),
            Err(BuzzLaunchError::UnsupportedRuntime)
        );
    }

    #[test]
    fn buzz_launch_disables_acp_content_logging_by_default() {
        let mut request = CreateDeploymentRequest::new(ManagedRuntime::Opencode);
        let buzz = BuzzLaunchConfig::new("nsec1test", "wss://buzz.example.test");

        buzz.apply_to(&mut request, None).unwrap();

        assert!(!request.env.contains_key("BUZZ_ACP_DISPLAY_NAME"));
        assert!(!request.env.contains_key("BUZZ_ACP_TEXT_MENTIONS"));
        assert_eq!(
            request.env.get("RUST_LOG").map(String::as_str),
            Some("buzz_acp=info,pool::prompt=info,acp::stream=off")
        );
    }

    #[test]
    fn generic_launch_omits_restart_but_buzz_serializes_false() {
        let generic = CreateDeploymentRequest::new(ManagedRuntime::Opencode);
        let generic_json = serde_json::to_value(&generic).unwrap();
        assert!(generic_json.get("restart").is_none());
        let generic_start = StartDeploymentRequest::default();
        let generic_start_json = serde_json::to_value(&generic_start).unwrap();
        assert!(generic_start_json.get("restart").is_none());

        let mut buzz_request = CreateDeploymentRequest::new(ManagedRuntime::Opencode);
        BuzzLaunchConfig::new("nsec1test", "wss://buzz.example.test")
            .apply_to(&mut buzz_request, None)
            .unwrap();
        assert_eq!(
            serde_json::to_value(&buzz_request).unwrap()["restart"],
            false
        );
    }

    #[test]
    fn runtime_scopes_are_omitted_by_default_and_serialize_when_set() {
        let create = CreateDeploymentRequest::new(ManagedRuntime::Opencode);
        let create_json = serde_json::to_value(&create).unwrap();
        assert!(create_json.get("runtime_scopes").is_none());

        let start = StartDeploymentRequest::default();
        let start_json = serde_json::to_value(&start).unwrap();
        assert!(start_json.get("runtime_scopes").is_none());

        let expected = BUZZ_RUNTIME_SCOPES.map(str::to_owned);
        let mut create = CreateDeploymentRequest::new(ManagedRuntime::Opencode);
        create.runtime_scopes = expected.to_vec();
        assert_eq!(
            serde_json::to_value(&create).unwrap()["runtime_scopes"],
            serde_json::json!(expected)
        );

        let start = StartDeploymentRequest {
            runtime_scopes: expected.to_vec(),
            ..Default::default()
        };
        assert_eq!(
            serde_json::to_value(&start).unwrap()["runtime_scopes"],
            serde_json::json!(expected)
        );
    }
}
